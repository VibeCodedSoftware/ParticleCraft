// Converts a parsed .blend into a three.js scene: objects and hierarchy, meshes (Blender 3.x legacy layers,
// 4.x generic attributes, 5.0 AttributeStorage), flat/smooth/auto-smooth normals, UVs, material slots,
// Principled/Emission/Diffuse node materials with packed or external image textures, lights, cameras,
// armatures with skinning, and actions (legacy F-Curves and Blender 4.4+/5 layered actions) as AnimationClips.
// Supported modifiers: Armature, Array (relative/constant offset), Mirror, "Smooth by Angle".
// Others are reported in `warnings` and skipped (the mesh is used as stored).
import * as THREE from 'three';
import { BlendFile, type Ptr, type SView } from './blendFile';

export interface BlendLight { type: 'point' | 'sun' | 'spot' | 'area'; color: string; power: number; radius: number; spotSize: number; spotBlend: number; sizeX: number; sizeY: number; castShadow: boolean }
export interface BlendObjectInfo { name: string; type: string; parent: string | null; vertices: number; materials: string[]; hidden: boolean; animations: string[]; skinned: boolean }
export interface BlendResult {
  root: THREE.Group;
  byName: Map<string, THREE.Object3D>;
  animations: THREE.AnimationClip[];
  objects: BlendObjectInfo[];
  warnings: string[];
  version: number;
  fps: number;
}
export interface BlendOptions {
  /** Turn image bytes into a texture (browser). When absent, textures are skipped (e.g. in tests). */
  makeTexture?: (bytes: Uint8Array, name: string, mime: string) => THREE.Texture | null;
  /** Map an external (non-packed) image path to a URL. */
  resolveImage?: (path: string) => string | null;
  /** Create a three.js light from Blender settings (GameCraft passes its Blender-unit converter). */
  makeLight?: (l: BlendLight) => THREE.Object3D | null;
}

import { bakeNetwork, canBake, normalFromHeight, tileOf } from './proceduralBake';

const OB = { EMPTY: 0, MESH: 1, CURVE: 2, SURF: 3, FONT: 4, LIGHT: 10, CAMERA: 11, ARMATURE: 25 } as const;
const MOD = { ARRAY: 12, MIRROR: 5, ARMATURE: 8, BOOLEAN: 11, NODES: 57, SUBSURF: 1, BEVEL: 24, SOLIDIFY: 33, DISPLACE: 14, TRIANGULATE: 44, WEIGHTED_NORMAL: 54, WELD: 55, EDGE_SPLIT: 13 } as const;
const MOD_NAMES: Record<number, string> = { 1: 'Subdivision Surface', 3: 'Curve', 6: 'Decimate', 11: 'Boolean', 14: 'Displace', 16: 'Smooth', 24: 'Bevel', 28: 'Simple Deform', 33: 'Solidify', 41: 'Remesh', 54: 'Weighted Normal', 55: 'Weld', 57: 'Geometry Nodes' };

const sanitize = (n: string) => THREE.PropertyBinding.sanitizeNodeName(n);

// ------------------------------------------------------------------ mesh data
interface MeshData {
  pos: Float32Array;
  faceStart: Int32Array; // length faces + 1
  corners: Int32Array; // vertex index per corner
  mat: Int32Array | null; // per face
  flat: Uint8Array; // per face: 1 = flat shaded
  uv: Float32Array | null; // per corner (2 floats)
  dverts: { g: number[]; w: number[] }[] | null;
  groups: string[];
  autoSmooth: number; // radians, 0 = off
}

interface Attr { name: string; domain: number; type: number; bytes: Uint8Array; count: number; itemSize: number }

function readAttributes(bf: BlendFile, me: SView): Map<string, Attr> {
  const out = new Map<string, Attr>();
  // Blender 5.0+: AttributeStorage
  const as = me.sub('attribute_storage');
  if (as && as.num('dna_attributes_num') > 0) {
    const blk = as.block('dna_attributes');
    const size = bf.structByName.get('Attribute')!.size;
    for (let i = 0; i < as.num('dna_attributes_num') && blk; i++) {
      const a = bf.view('Attribute', blk.offset + i * size, me.owner);
      const name = bf.stringAt(a.ptr('name'), me.owner);
      const arr = a.get('data', a.num('storage_type') === 0 ? 'AttributeArray' : 'AttributeSingle');
      const db = arr?.block('data');
      if (!db) continue;
      const count = arr!.num('size') || db.nr;
      out.set(name, { name, domain: a.num('domain'), type: a.num('data_type'), bytes: bf.bytes.subarray(db.offset, db.offset + db.len), count, itemSize: count ? Math.floor(db.len / count) : 0 });
    }
  }
  // Blender 3.5 – 4.x generic CustomData layers (named)
  const lsize = bf.structByName.get('CustomDataLayer')!.size;
  const domains: [string, number][] = [['vdata', 0], ['edata', 1], ['pdata', 2], ['ldata', 3]];
  for (const [cdName, domain] of domains) {
    const cd = me.sub(cdName); if (!cd) continue;
    const blk = cd.block('layers');
    for (let i = 0; i < cd.num('totlayer') && blk; i++) {
      const l = bf.view('CustomDataLayer', blk.offset + i * lsize, me.owner);
      const db = l.block('data'); if (!db) continue;
      const t = l.num('type');
      let name = l.str('name');
      // Legacy typed layers get synthetic names so the code below can treat them uniformly.
      if (t === 0) name = '#MVert'; else if (t === 25) name = '#MPoly'; else if (t === 26) name = '#MLoop'; else if (t === 16) name = '#MLoopUV:' + name; else if (t === 2) name = '#MDeformVert';
      if (!out.has(name)) out.set(name, { name, domain, type: 1000 + t, bytes: bf.bytes.subarray(db.offset, db.offset + db.len), count: db.nr, itemSize: db.nr ? Math.floor(db.len / db.nr) : 0 });
    }
  }
  return out;
}

const f32 = (a: Attr) => new Float32Array(a.bytes.buffer.slice(a.bytes.byteOffset, a.bytes.byteOffset + a.bytes.byteLength));
const i32 = (a: Attr) => new Int32Array(a.bytes.buffer.slice(a.bytes.byteOffset, a.bytes.byteOffset + Math.floor(a.bytes.byteLength / 4) * 4));

function readMesh(bf: BlendFile, me: SView, ob: SView, warnings: string[]): MeshData | null {
  const attrs = readAttributes(bf, me);
  const dv = bf.dv;
  const nFaces = me.num(['faces_num', 'totpoly']);
  let pos: Float32Array, faceStart: Int32Array, corners: Int32Array, mat: Int32Array | null = null, flat: Uint8Array, uv: Float32Array | null = null;
  const posA = attrs.get('position');
  if (posA) {
    pos = f32(posA);
    corners = i32(attrs.get('.corner_vert')!);
    const offs = me.block(['face_offset_indices', 'poly_offset_indices']);
    faceStart = offs ? new Int32Array(bf.bytes.buffer.slice(offs.offset, offs.offset + (nFaces + 1) * 4)) : new Int32Array([0]);
    const mi = attrs.get('material_index'); if (mi) mat = i32(mi);
    const sharp = attrs.get('sharp_face');
    flat = new Uint8Array(nFaces);
    if (sharp) for (let f = 0; f < nFaces; f++) flat[f] = sharp.bytes[f] ? 1 : 0;
    // Active UV map: a float2 corner attribute that is not internal (".xxx").
    const activeUv = bf.stringAt(me.ptr('active_uv_map_attribute'), me.owner);
    const uvA = (activeUv && attrs.get(activeUv)) || [...attrs.values()].find((a) => a.domain === 3 && !a.name.startsWith('.') && a.itemSize === 8 && a.name !== '.corner_vert');
    if (uvA) uv = f32(uvA);
  } else if (attrs.get('#MVert')) {
    // Legacy (Blender <= 3.6 writes these for compatibility)
    const mv = attrs.get('#MVert')!, mp = attrs.get('#MPoly'), ml = attrs.get('#MLoop');
    pos = new Float32Array(mv.count * 3);
    const vOff = mv.bytes.byteOffset;
    for (let i = 0; i < mv.count; i++) for (let k = 0; k < 3; k++) pos[i * 3 + k] = dv.getFloat32(vOff - bf.bytes.byteOffset + i * mv.itemSize + k * 4, true);
    if (!mp || !ml) return { pos, faceStart: new Int32Array([0]), corners: new Int32Array(0), mat: null, flat: new Uint8Array(0), uv: null, dverts: null, groups: [], autoSmooth: 0 };
    const mpS = bf.structByName.get('MPoly')!;
    const fLoop = mpS.fields.get('loopstart')!.offset, fTot = mpS.fields.get('totloop')!.offset, fMat = mpS.fields.get('mat_nr')!.offset, fFlag = mpS.fields.get('flag')!.offset;
    faceStart = new Int32Array(mp.count + 1); mat = new Int32Array(mp.count); flat = new Uint8Array(mp.count);
    const pOff = mp.bytes.byteOffset - bf.bytes.byteOffset;
    for (let f = 0; f < mp.count; f++) {
      const o = pOff + f * mp.itemSize;
      faceStart[f] = dv.getInt32(o + fLoop, true);
      mat[f] = dv.getInt16(o + fMat, true);
      flat[f] = dv.getUint8(o + fFlag) & 1 ? 0 : 1; // ME_SMOOTH
      if (f === mp.count - 1) faceStart[f + 1] = faceStart[f] + dv.getInt32(o + fTot, true);
    }
    corners = new Int32Array(ml.count);
    const lOff = ml.bytes.byteOffset - bf.bytes.byteOffset;
    for (let c = 0; c < ml.count; c++) corners[c] = dv.getInt32(lOff + c * ml.itemSize, true);
    const uvA = [...attrs.values()].find((a) => a.name.startsWith('#MLoopUV:'));
    if (uvA) { uv = new Float32Array(uvA.count * 2); const uOff = uvA.bytes.byteOffset - bf.bytes.byteOffset; for (let c = 0; c < uvA.count; c++) { uv[c * 2] = dv.getFloat32(uOff + c * uvA.itemSize, true); uv[c * 2 + 1] = dv.getFloat32(uOff + c * uvA.itemSize + 4, true); } }
  } else {
    if (me.num(['verts_num', 'totvert'])) warnings.push(`Mesh ${me.idName()}: unrecognised vertex storage, skipped`);
    return null;
  }
  // Deform weights (vertex groups)
  let dverts: MeshData['dverts'] = null;
  const dvA = attrs.get('#MDeformVert');
  const nv = pos.length / 3;
  const dvBlock = dvA ? null : me.block('dvert');
  if (dvA || dvBlock) {
    dverts = [];
    const base = dvA ? dvA.bytes.byteOffset - bf.bytes.byteOffset : dvBlock!.offset;
    const stride = dvA ? dvA.itemSize : bf.structByName.get('MDeformVert')!.size;
    for (let i = 0; i < nv; i++) {
      const o = base + i * stride;
      const tot = dv.getInt32(o + 8, true);
      const wb = bf.resolve(bf.ptrAt(o), me.owner);
      const g: number[] = [], w: number[] = [];
      if (wb) for (let k = 0; k < tot; k++) { g.push(dv.getInt32(wb.offset + k * 8, true)); w.push(dv.getFloat32(wb.offset + k * 8 + 4, true)); }
      dverts.push({ g, w });
    }
  }
  let groups = bf.list(me.sub('vertex_group_names')).map((g) => g.str('name'));
  if (!groups.length) groups = bf.list(ob.sub('defbase')).map((g) => g.str('name'));
  // Auto smooth (3.x mesh flag) — 4.1+ uses the "Smooth by Angle" modifier, handled by the caller.
  const ME_AUTOSMOOTH = 1 << 5;
  const autoSmooth = me.num('flag') & ME_AUTOSMOOTH ? me.num('smoothresh') || Math.PI / 6 : 0;
  return { pos, faceStart, corners, mat, flat, uv, dverts, groups, autoSmooth };
}

/** Array modifier (count, relative and/or constant offset). */
function applyArray(md: MeshData, m: SView): MeshData {
  const count = Math.max(1, m.num('count'));
  const offsetType = m.num('offset_type');
  const rel = m.nums('scale'), cst = m.nums('offset');
  let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < md.pos.length; i += 3) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], md.pos[i + k]); mx[k] = Math.max(mx[k], md.pos[i + k]); }
  const step = [0, 0, 0];
  for (let k = 0; k < 3; k++) {
    if (offsetType & 2) step[k] += rel[k] * (mx[k] - mn[k]); // MOD_ARR_OFF_RELATIVE
    if (offsetType & 1) step[k] += cst[k]; // MOD_ARR_OFF_CONST
  }
  return repeatMesh(md, count, (i, v) => [v[0] + step[0] * i, v[1] + step[1] * i, v[2] + step[2] * i]);
}

/** Mirror modifier (X/Y/Z flags, mirror across the object origin). */
function applyMirror(md: MeshData, m: SView): MeshData {
  const flag = m.num('flag');
  let out = md;
  for (let axis = 0; axis < 3; axis++) {
    if (!(flag & (1 << (axis + 3)) || (axis === 0 && !(flag & 0b111000)))) continue; // MOD_MIR_AXIS_X = 1<<3
    out = repeatMesh(out, 2, (i, v) => { const r = [...v] as [number, number, number]; if (i === 1) r[axis] = -r[axis]; return r; }, true);
  }
  return out;
}

/** Solidify modifier (simple mode): offset shell along vertex normals plus rim faces on open edges. */
function applySolidify(md: MeshData, m: SView): MeshData {
  const thickness = m.num('offset'); // Blender stores Solidify "Thickness" in `offset`
  const offsetFac = m.has('offset_fac') ? m.num('offset_fac') : -1;
  const rim = (m.num('flag') & 1) !== 0; // MOD_SOLIDIFY_RIM
  const nv = md.pos.length / 3, nf = md.faceStart.length - 1, P = md.pos;
  // Area-weighted vertex normals.
  const vn = new Float32Array(nv * 3);
  for (let f = 0; f < nf; f++) {
    const s = md.faceStart[f], e = md.faceStart[f + 1];
    let x = 0, y = 0, z = 0;
    for (let c = s; c < e; c++) { const a = md.corners[c] * 3, b = md.corners[c + 1 < e ? c + 1 : s] * 3; x += (P[a + 1] - P[b + 1]) * (P[a + 2] + P[b + 2]); y += (P[a + 2] - P[b + 2]) * (P[a] + P[b]); z += (P[a] - P[b]) * (P[a + 1] + P[b + 1]); }
    for (let c = s; c < e; c++) { const v = md.corners[c]; vn[v * 3] += x; vn[v * 3 + 1] += y; vn[v * 3 + 2] += z; }
  }
  for (let v = 0; v < nv; v++) { const l = Math.hypot(vn[v * 3], vn[v * 3 + 1], vn[v * 3 + 2]) || 1; vn[v * 3] /= l; vn[v * 3 + 1] /= l; vn[v * 3 + 2] /= l; }
  const outer = (thickness * (offsetFac + 1)) / 2, inner = (thickness * (offsetFac - 1)) / 2;
  const pos = new Float32Array(nv * 6);
  for (let v = 0; v < nv; v++) for (let k = 0; k < 3; k++) { pos[v * 3 + k] = P[v * 3 + k] + vn[v * 3 + k] * outer; pos[(nv + v) * 3 + k] = P[v * 3 + k] + vn[v * 3 + k] * inner; }
  // Open edges (used by exactly one face) get rim quads.
  const edgeCount = new Map<string, [number, number, number]>();
  for (let f = 0; f < nf; f++) { const s = md.faceStart[f], e = md.faceStart[f + 1]; for (let c = s; c < e; c++) { const a = md.corners[c], b = md.corners[c + 1 < e ? c + 1 : s]; const k = a < b ? `${a}_${b}` : `${b}_${a}`; const cur = edgeCount.get(k); edgeCount.set(k, cur ? [cur[0] + 1, cur[1], cur[2]] : [1, a, b]); } }
  const rimEdges = rim ? [...edgeCount.values()].filter((e) => e[0] === 1) : [];
  const nc = md.corners.length;
  const corners = new Int32Array(nc * 2 + rimEdges.length * 4), faceStart = new Int32Array(nf * 2 + rimEdges.length + 1);
  const mat = new Int32Array(nf * 2 + rimEdges.length), flat = new Uint8Array(nf * 2 + rimEdges.length);
  const uv = md.uv ? new Float32Array((nc * 2 + rimEdges.length * 4) * 2) : null;
  let c2 = 0, f2 = 0;
  for (let pass = 0; pass < 2; pass++) for (let f = 0; f < nf; f++) {
    const s = md.faceStart[f], e = md.faceStart[f + 1];
    faceStart[f2] = c2; mat[f2] = md.mat?.[f] ?? 0; flat[f2] = md.flat[f];
    for (let i = 0; i < e - s; i++) {
      const src = pass === 0 ? s + i : e - 1 - i; // inner shell is reversed
      corners[c2] = md.corners[src] + (pass ? nv : 0);
      if (uv && md.uv) { uv[c2 * 2] = md.uv[src * 2]; uv[c2 * 2 + 1] = md.uv[src * 2 + 1]; }
      c2++;
    }
    f2++;
  }
  for (const [, a, b] of rimEdges) { faceStart[f2] = c2; mat[f2] = 0; flat[f2] = 1; corners.set([b, a, a + nv, b + nv], c2); c2 += 4; f2++; }
  faceStart[f2] = c2;
  const dverts = md.dverts ? [...md.dverts, ...md.dverts] : null;
  return { ...md, pos, faceStart, corners, mat, flat, uv, dverts };
}

function repeatMesh(md: MeshData, count: number, tf: (i: number, v: [number, number, number]) => [number, number, number], flipOdd = false): MeshData {
  const nv = md.pos.length / 3, nf = md.faceStart.length - 1, nc = md.corners.length;
  const pos = new Float32Array(nv * 3 * count), faceStart = new Int32Array(nf * count + 1), corners = new Int32Array(nc * count);
  const mat = md.mat ? new Int32Array(nf * count) : null, flat = new Uint8Array(nf * count), uv = md.uv ? new Float32Array(nc * 2 * count) : null;
  for (let i = 0; i < count; i++) {
    for (let v = 0; v < nv; v++) { const p = tf(i, [md.pos[v * 3], md.pos[v * 3 + 1], md.pos[v * 3 + 2]]); pos.set(p, (i * nv + v) * 3); }
    for (let f = 0; f < nf; f++) {
      const s = md.faceStart[f], e = md.faceStart[f + 1];
      faceStart[i * nf + f] = i * nc + s;
      const reverse = flipOdd && i % 2 === 1;
      for (let c = s; c < e; c++) {
        const src = reverse ? e - 1 - (c - s) : c;
        corners[i * nc + c] = md.corners[src] + i * nv;
        if (uv && md.uv) { uv[(i * nc + c) * 2] = md.uv[src * 2]; uv[(i * nc + c) * 2 + 1] = md.uv[src * 2 + 1]; }
      }
      if (mat && md.mat) mat[i * nf + f] = md.mat[f];
      flat[i * nf + f] = md.flat[f];
    }
  }
  faceStart[nf * count] = nc * count;
  const dverts = md.dverts ? Array.from({ length: count }, () => md.dverts!).flat() : null;
  return { ...md, pos, faceStart, corners, mat, flat, uv, dverts };
}

/** Triangulated, non-indexed BufferGeometry with material groups, normals, UVs and optional skin attributes. */
function buildGeometry(md: MeshData, boneIndexOfGroup: number[] | null): THREE.BufferGeometry {
  const nv = md.pos.length / 3, nf = md.faceStart.length - 1;
  const P = md.pos;
  // Face normals (Newell's method handles n-gons).
  const fn = new Float32Array(nf * 3);
  for (let f = 0; f < nf; f++) {
    let x = 0, y = 0, z = 0;
    const s = md.faceStart[f], e = md.faceStart[f + 1];
    for (let c = s; c < e; c++) {
      const a = md.corners[c] * 3, b = md.corners[c + 1 < e ? c + 1 : s] * 3;
      x += (P[a + 1] - P[b + 1]) * (P[a + 2] + P[b + 2]);
      y += (P[a + 2] - P[b + 2]) * (P[a] + P[b]);
      z += (P[a] - P[b]) * (P[a + 1] + P[b + 1]);
    }
    const l = Math.hypot(x, y, z) || 1;
    fn[f * 3] = x / l; fn[f * 3 + 1] = y / l; fn[f * 3 + 2] = z / l;
  }
  // Faces around each vertex (for smooth normals).
  const vf: number[][] = Array.from({ length: nv }, () => []);
  for (let f = 0; f < nf; f++) for (let c = md.faceStart[f]; c < md.faceStart[f + 1]; c++) { const v = md.corners[c]; if (v >= 0 && v < nv) vf[v].push(f); }
  const cosLimit = md.autoSmooth > 0 ? Math.cos(md.autoSmooth) - 1e-4 : -2;
  const cornerNormal = (f: number, v: number): [number, number, number] => {
    if (md.flat[f]) return [fn[f * 3], fn[f * 3 + 1], fn[f * 3 + 2]];
    let x = 0, y = 0, z = 0;
    for (const g of vf[v]) {
      if (md.flat[g]) continue;
      if (md.autoSmooth > 0 && fn[f * 3] * fn[g * 3] + fn[f * 3 + 1] * fn[g * 3 + 1] + fn[f * 3 + 2] * fn[g * 3 + 2] < cosLimit) continue;
      x += fn[g * 3]; y += fn[g * 3 + 1]; z += fn[g * 3 + 2];
    }
    const l = Math.hypot(x, y, z);
    return l > 1e-8 ? [x / l, y / l, z / l] : [fn[f * 3], fn[f * 3 + 1], fn[f * 3 + 2]];
  };
  // Triangles grouped by material slot.
  const byMat = new Map<number, number[]>(); // mat -> list of [face, c0, c1, c2]
  for (let f = 0; f < nf; f++) {
    const s = md.faceStart[f], e = md.faceStart[f + 1];
    if (e - s < 3) continue;
    const m = md.mat ? md.mat[f] : 0;
    let list = byMat.get(m); if (!list) byMat.set(m, (list = []));
    if (e - s <= 4) { for (let c = s + 1; c < e - 1; c++) list.push(f, s, c, c + 1); continue; }
    // N-gons can be concave (e.g. a wall face with a door-shaped notch): a fan would fill the notch, so
    // project onto the face plane and ear-clip.
    const nx = Math.abs(fn[f * 3]), ny = Math.abs(fn[f * 3 + 1]), nz = Math.abs(fn[f * 3 + 2]);
    const [ax, ay] = nx >= ny && nx >= nz ? [1, 2] : ny >= nz ? [2, 0] : [0, 1];
    const flip = (nx >= ny && nx >= nz ? fn[f * 3] : ny >= nz ? fn[f * 3 + 1] : fn[f * 3 + 2]) < 0;
    const contour: THREE.Vector2[] = [];
    for (let c = s; c < e; c++) { const v = md.corners[c] * 3; contour.push(new THREE.Vector2(P[v + ax], flip ? -P[v + ay] : P[v + ay])); }
    const tris = THREE.ShapeUtils.triangulateShape(contour, []);
    if (tris.length) for (const [a, b, c] of tris) list.push(f, s + a, s + b, s + c);
    else for (let c = s + 1; c < e - 1; c++) list.push(f, s, c, c + 1);
  }
  const mats = [...byMat.keys()].sort((a, b) => a - b);
  const triCount = [...byMat.values()].reduce((a, l) => a + l.length / 4, 0);
  const position = new Float32Array(triCount * 9), normal = new Float32Array(triCount * 9);
  const uv = md.uv ? new Float32Array(triCount * 6) : null;
  const skin = md.dverts && boneIndexOfGroup ? { idx: new Uint16Array(triCount * 12), w: new Float32Array(triCount * 12) } : null;
  const geo = new THREE.BufferGeometry();
  let t = 0;
  for (const m of mats) {
    const list = byMat.get(m)!;
    const start = t * 3;
    for (let i = 0; i < list.length; i += 4) {
      const f = list[i];
      for (let k = 0; k < 3; k++) {
        const c = list[i + 1 + k];
        const v = md.corners[c];
        const o = (t * 3 + k) * 3;
        position[o] = P[v * 3]; position[o + 1] = P[v * 3 + 1]; position[o + 2] = P[v * 3 + 2];
        const n = cornerNormal(f, v);
        normal[o] = n[0]; normal[o + 1] = n[1]; normal[o + 2] = n[2];
        if (uv && md.uv) { uv[(t * 3 + k) * 2] = md.uv[c * 2]; uv[(t * 3 + k) * 2 + 1] = md.uv[c * 2 + 1]; }
        if (skin && md.dverts) {
          const d = md.dverts[v];
          const pairs = d ? d.g.map((g, j) => [boneIndexOfGroup![g] ?? -1, d.w[j]] as [number, number]).filter(([b, w]) => b >= 0 && w > 0).sort((a, b) => b[1] - a[1]).slice(0, 4) : [];
          const sum = pairs.reduce((a, p) => a + p[1], 0) || 1;
          pairs.forEach(([b, w], j) => { skin.idx[(t * 3 + k) * 4 + j] = b; skin.w[(t * 3 + k) * 4 + j] = w / sum; });
          if (!pairs.length) skin.w[(t * 3 + k) * 4] = 1; // unweighted vertices follow bone 0
        }
      }
      t++;
    }
    geo.addGroup(start, t * 3 - start, Math.max(0, m));
  }
  geo.setAttribute('position', new THREE.BufferAttribute(position, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  if (uv) geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  if (skin) { geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skin.idx, 4)); geo.setAttribute('skinWeight', new THREE.BufferAttribute(skin.w, 4)); }
  geo.computeBoundingBox(); geo.computeBoundingSphere();
  return geo;
}

// ------------------------------------------------------------------ materials
class MaterialBuilder {
  private cache = new Map<Ptr, THREE.Material>();
  private texCache = new Map<string, THREE.Texture | null>();
  constructor(private bf: BlendFile, private opts: BlendOptions, private warnings: string[]) {}

  get(ptr: Ptr, owner: number): THREE.Material {
    const hit = this.cache.get(ptr);
    if (hit) return hit;
    const ma = this.bf.deref(ptr, undefined, owner);
    const m = ma ? this.build(ma) : new THREE.MeshStandardMaterial({ color: 0xcccccc, roughness: 0.6 });
    this.cache.set(ptr, m);
    return m;
  }

  private build(ma: SView): THREE.Material {
    const name = ma.idName();
    const base = { color: new THREE.Color(ma.num('r'), ma.num('g'), ma.num('b')), roughness: ma.num('roughness') || 0.5, metalness: ma.num('metallic') };
    const tree = ma.get('nodetree');
    if (!tree || !ma.num('use_nodes')) return Object.assign(new THREE.MeshStandardMaterial(base), { name });
    const nodes = this.bf.list(tree.sub('nodes'));
    const links = this.bf.list(tree.sub('links'));
    const nodeById = new Map(nodes.map((n) => [n.from, n]));
    const inputOf = (node: SView, ident: string) => this.bf.list(node.sub('inputs')).find((s) => s.str('identifier') === ident || s.str('name') === ident);
    const linkInto = (node: SView, ident: string) => {
      const sock = inputOf(node, ident);
      if (!sock) return null;
      const l = links.find((k) => k.ptr('tonode') === node.from && k.ptr('tosock') === sock.from);
      return l ? { node: nodeById.get(l.ptr('fromnode')) ?? null, sockIdent: this.bf.deref(l.ptr('fromsock'), undefined, tree.owner)?.str('identifier') ?? '' } : null;
    };
    const value = (node: SView, ident: string): number[] | null => {
      const sock = inputOf(node, ident); if (!sock) return null;
      const dvv = sock.get('default_value'); if (!dvv) return null;
      return dvv.nums('value');
    };
    const out = nodes.find((n) => n.str('idname') === 'ShaderNodeOutputMaterial' && n.num('flag') & 2 /* NODE_DO_OUTPUT */) ?? nodes.find((n) => n.str('idname') === 'ShaderNodeOutputMaterial');
    let shader = out ? linkInto(out, 'Surface')?.node ?? null : null;
    // Mix/Add shader: shade with the non-transparent branch, but keep what the Transparent BSDF branch meant:
    //  - an image alpha cut-out (Add + Transparent(Invert(Image.Alpha)), or Mix whose factor is Image.Alpha)
    //  - a constant see-through amount (Mix factor toward the Transparent branch)
    let cutout: SView | null = null; // the Image Texture node whose alpha shapes the surface
    let mixOpacity = 1;
    const alphaImage = (n: SView | null | undefined, sock: string, depth = 0): SView | null => {
      if (!n || depth > 4) return null;
      const id = n.str('idname');
      if (id === 'ShaderNodeTexImage') return sock === 'Alpha' ? n : null;
      if (id === 'NodeReroute') { const l = linkInto(n, 'Input'); return alphaImage(l?.node, l?.sockIdent ?? '', depth + 1); }
      if (id === 'ShaderNodeInvert') { const l = linkInto(n, 'Color'); return l?.node?.str('idname') === 'ShaderNodeTexImage' && l.sockIdent === 'Alpha' ? null : alphaImage(l?.node, l?.sockIdent ?? '', depth + 1); }
      return null;
    };
    /** Transparent BSDF colour = 1 - Image.Alpha (Invert of the alpha): visible where the image is opaque. */
    const invertedAlphaImage = (tr: SView): SView | null => {
      const l = linkInto(tr, 'Color');
      if (l?.node?.str('idname') !== 'ShaderNodeInvert') return null;
      const il = linkInto(l.node, 'Color');
      return il?.node?.str('idname') === 'ShaderNodeTexImage' && il.sockIdent === 'Alpha' ? il.node : null;
    };
    for (let guard = 0; shader && guard < 4 && /ShaderNode(MixShader|AddShader)/.test(shader.str('idname')); guard++) {
      const isMix = shader.str('idname') === 'ShaderNodeMixShader';
      const a = linkInto(shader, 'Shader')?.node, b = linkInto(shader, 'Shader_001')?.node;
      const trA = !!a && /Transparent/.test(a.str('idname')), trB = !!b && /Transparent/.test(b.str('idname'));
      if (trA || trB) {
        const tr = (trB ? b : a)!;
        if (isMix) {
          const fl = linkInto(shader, 'Fac');
          const img = fl ? alphaImage(fl.node, fl.sockIdent) : null;
          if (img) cutout ??= img;
          else if (!fl) { const f = value(shader, 'Fac')?.[0] ?? 0.5; mixOpacity *= trB ? 1 - f : f; }
        } else {
          const img = invertedAlphaImage(tr);
          if (img) cutout ??= img;
        }
      }
      shader = (b && !trB ? b : a) ?? b ?? null;
    }
    const mat = new THREE.MeshStandardMaterial(base);
    mat.name = name;
    if (!shader) return mat;
    const id = shader.str('idname');
    // Procedural color networks (noise/voronoi through color ramps and mixes) become their average color.
    const approx = (node: SView | null, depth = 0): THREE.Color | null => {
      if (!node || depth > 8) return null;
      const id = node.str('idname');
      if (id === 'NodeReroute') return approx(linkInto(node, 'Input')?.node ?? null, depth + 1);
      if (id === 'ShaderNodeValToRGB') {
        const cb = node.get('storage', 'ColorBand'); const data = cb?.sub('data'); const st = this.bf.structByName.get('CBData');
        if (!cb || !data || !st) return null;
        const n = Math.max(1, cb.num('tot')); const acc = new THREE.Color(0, 0, 0);
        for (let i = 0; i < n; i++) { const o = data.offset + i * st.size; acc.r += this.bf.dv.getFloat32(o, true) / n; acc.g += this.bf.dv.getFloat32(o + 4, true) / n; acc.b += this.bf.dv.getFloat32(o + 8, true) / n; }
        return acc;
      }
      if (id === 'ShaderNodeMix' || id === 'ShaderNodeMixRGB') {
        const side = (a: string, b: string) => approx(linkInto(node, a)?.node ?? linkInto(node, b)?.node ?? null, depth + 1) ?? (() => { const v = value(node, a) ?? value(node, b); return v ? new THREE.Color(v[0], v[1], v[2]) : null; })();
        const A = side('A_Color', 'Color1'), Bc = side('B_Color', 'Color2');
        const f = linkInto(node, 'Factor_Float') || linkInto(node, 'Fac') ? 0.5 : (value(node, 'Factor_Float') ?? value(node, 'Fac') ?? [0.5])[0];
        return A && Bc ? A.clone().lerp(Bc, f) : A ?? Bc;
      }
      if (id === 'ShaderNodeInvert') { const c = approx(linkInto(node, 'Color')?.node ?? null, depth + 1); return c ? new THREE.Color(1 - c.r, 1 - c.g, 1 - c.b) : null; }
      if (/ShaderNodeTex(Noise|Voronoi|Musgrave|Wave|Gradient|Magic|Checker|Brick)/.test(id)) return new THREE.Color(0.5, 0.5, 0.5);
      return null;
    };
    const bakeCtx = { bf: this.bf, linkInto, value };
    const colorFrom = (node: SView, ident: string, target: 'map' | 'emissiveMap') => {
      const v = value(node, ident);
      const link = linkInto(node, ident);
      const tex = link?.node ? this.textureFrom(link.node, linkInto, value) : null;
      if (tex) { (mat as any)[target] = tex; return new THREE.Color(1, 1, 1); }
      // Procedural networks (Voronoi / Noise through ramps and mixes) are baked to a texture.
      if (link?.node) {
        const b = canBake(link.node, bakeCtx);
        if (b.ok && b.procedural) {
          try {
            // Regular tile grids bake one sharp cell and repeat it (see tileOf).
            const tile = tileOf(link.node, bakeCtx);
            const t = bakeNetwork(link as { node: SView; sockIdent: string }, bakeCtx, tile ? 256 : 512, null, tile ?? 1).color;
            if (tile) t.repeat.set(tile, tile);
            (mat as any)[target] = t; return new THREE.Color(1, 1, 1);
          }
          catch (e: any) { this.warnings.push(`Material ${name}: procedural texture not baked (${e?.message ?? e})`); }
        }
      }
      // Shader to RGB of a glass / transparent mix: a light glass tint.
      if (link?.node?.str('idname') === 'ShaderNodeShaderToRGB') {
        let s = linkInto(link.node, 'Shader')?.node ?? null;
        for (let g = 0; s && g < 4 && /MixShader|AddShader/.test(s.str('idname')); g++) s = linkInto(s, 'Shader')?.node ?? linkInto(s, 'Shader_001')?.node ?? null;
        if (s && /Glass|Transparent|Refraction/.test(s.str('idname'))) { const gc = value(s, 'Color'); return gc ? new THREE.Color(gc[0], gc[1], gc[2]) : new THREE.Color(0.95, 0.97, 1); }
      }
      const pc = link?.node ? approx(link.node) : null;
      if (pc) return pc;
      return v ? new THREE.Color(v[0], v[1], v[2]) : null;
    };
    if (id === 'ShaderNodeBsdfPrincipled') {
      const c = colorFrom(shader, 'Base Color', 'map'); if (c) mat.color.copy(c);
      const r = value(shader, 'Roughness'); if (r) mat.roughness = r[0];
      const mt = value(shader, 'Metallic'); if (mt) mat.metalness = mt[0];
      const a = value(shader, 'Alpha'); const al = linkInto(shader, 'Alpha');
      if (al?.node) {
        // Alpha from a texture: its own alpha channel (Image.Alpha) or its brightness (Image.Color -> alphaMap).
        const img = alphaImage(al.node, al.sockIdent);
        if (img) cutout ??= img;
        else { const t = this.textureFrom(al.node, linkInto, value, false); if (t) { mat.alphaMap = t; mat.transparent = true; } }
      } else if (a && a[0] < 0.999) { mat.transparent = true; mat.opacity = a[0]; }
      const e = colorFrom(shader, 'Emission Color', 'emissiveMap') ?? colorFrom(shader, 'Emission', 'emissiveMap');
      const es = value(shader, 'Emission Strength');
      if (e && (e.r + e.g + e.b) > 0 && (!es || es[0] > 0)) { mat.emissive.copy(e); mat.emissiveIntensity = es ? es[0] : 1; }
      const nl = linkInto(shader, 'Normal');
      if (nl?.node?.str('idname') === 'ShaderNodeNormalMap') { const t = this.textureFrom(linkInto(nl.node, 'Color')?.node ?? null, linkInto, value, false); if (t) mat.normalMap = t; }
      // Bump node over a procedural height (e.g. ceiling tile grooves) → baked normal map.
      if (nl?.node?.str('idname') === 'ShaderNodeBump') {
        const hl = linkInto(nl.node, 'Height');
        const b = hl?.node ? canBake(hl.node, bakeCtx) : null;
        if (hl?.node && b?.ok && b.procedural) {
          try {
            const tile = tileOf(hl.node, bakeCtx);
            const r = bakeNetwork(hl as { node: SView; sockIdent: string }, bakeCtx, tile ? 256 : 512, hl as { node: SView; sockIdent: string }, tile ?? 1);
            if (r.height) { mat.normalMap = normalFromHeight(r.height, r.size, value(nl.node, 'Strength')?.[0] ?? 1); if (tile) mat.normalMap.repeat.set(tile, tile); r.color.dispose(); }
          }
          catch { /* keep flat */ }
        }
      }
      // See-through materials must not hide what is behind them in the depth buffer.
      if (mat.transparent && mat.opacity < 1) mat.depthWrite = false;
    } else if (id === 'ShaderNodeEmission') {
      const c = colorFrom(shader, 'Color', 'emissiveMap') ?? new THREE.Color(1, 1, 1);
      const s = value(shader, 'Strength')?.[0] ?? 1;
      mat.color.set(0x000000); mat.emissive.copy(c); mat.emissiveIntensity = s; mat.roughness = 1;
    } else if (id === 'ShaderNodeBsdfDiffuse' || id === 'ShaderNodeBsdfGlossy' || id === 'ShaderNodeBsdfAnisotropic') {
      const c = colorFrom(shader, 'Color', 'map'); if (c) mat.color.copy(c);
      if (id !== 'ShaderNodeBsdfDiffuse') { mat.roughness = value(shader, 'Roughness')?.[0] ?? 0.2; mat.metalness = 1; }
    } else if (id === 'ShaderNodeBsdfTransparent') {
      mat.transparent = true; mat.opacity = 0; mat.depthWrite = false;
    } else if (id === 'ShaderNodeBsdfGlass' || id === 'ShaderNodeBsdfRefraction') {
      const c = colorFrom(shader, 'Color', 'map'); if (c) mat.color.copy(c);
      mat.transparent = true; mat.opacity = 0.35; mat.roughness = value(shader, 'Roughness')?.[0] ?? 0.05;
    } else if (id === 'ShaderNodeBackground' || id === 'ShaderNodeHoldout') {
      // nothing sensible on a surface
    } else {
      this.warnings.push(`Material ${name}: shader ${id} approximated with its base color`);
    }
    // Transparency from the shader graph (see the Mix/Add walk above).
    if (cutout) {
      const t = this.textureFrom(cutout, linkInto, value);
      if (t) {
        // The texture's alpha shapes the surface. For emission-only materials the colour stays black, so only the
        // alpha of `map` matters; with a base colour map already set it is the same image in practice.
        if (!mat.map) mat.map = t;
        mat.transparent = true; mat.alphaTest = Math.max(mat.alphaTest, 0.02); mat.depthWrite = false;
      } else this.warnings.push(`Material ${name}: its transparency comes from an image that could not be loaded`);
    }
    if (mixOpacity < 0.999) {
      mat.transparent = true; mat.opacity *= mixOpacity; mat.depthWrite = false;
      // A see-through glow (Emission mixed with Transparent) reads as light: blend it additively.
      if (id === 'ShaderNodeEmission') { mat.blending = THREE.AdditiveBlending; mat.opacity = Math.max(mat.opacity, 0.35); }
    }
    // Blender shows both sides of a face unless "Backface Culling" is on (MA_BL_CULL_BACKFACE).
    if (!(ma.num('blend_flag') & 1)) mat.side = THREE.DoubleSide;
    // Blend modes: 3 = Alpha Clip (threshold), 4 = Alpha Hashed (dithered: a hard cut at 0.5 is the closest), 5 = Alpha Blend.
    const bm = ma.num('blend_method');
    if (bm === 3 || bm === 4) { if (mat.map || mat.alphaMap) { mat.alphaTest = bm === 3 ? ma.num('alpha_threshold') || 0.5 : Math.max(mat.alphaTest, 0.5); if (!cutout && mat.opacity >= 0.999) mat.transparent = false; } }
    if (bm === 5 && !mat.transparent) mat.transparent = true;
    // Fully opaque "transparent" materials still write depth, so they are not drawn through by later objects.
    if (mat.transparent && mat.opacity >= 0.999 && !mat.map && !mat.alphaMap && !cutout) mat.depthWrite = true;
    if (mat.map || mat.emissiveMap || mat.alphaMap) mat.needsUpdate = true;
    return mat;
  }

  /** Follow color links back to an Image Texture node (through Mix/MixRGB/Gamma/Hue nodes). */
  private textureFrom(node: SView | null, linkInto: (n: SView, id: string) => { node: SView | null } | null, value: (n: SView, id: string) => number[] | null, srgb = true, depth = 0): THREE.Texture | null {
    if (depth > 6) return null;
    for (let guard = 0; node && guard < 6; guard++) {
      const id = node.str('idname');
      if (id === 'ShaderNodeTexImage') {
        const im = node.get('id');
        if (!im) return null;
        let tex = this.imageTexture(im, srgb);
        if (tex) {
          // Mapping node (possibly behind reroutes) -> texture repeat/rotation/offset. Each mapping gets its own
          // texture object (sharing the image), since many materials reuse one image at different scales.
          let vec = linkInto(node, 'Vector')?.node ?? null;
          while (vec && vec.str('idname') === 'NodeReroute') vec = linkInto(vec, 'Input')?.node ?? null;
          if (vec?.str('idname') === 'ShaderNodeMapping') {
            const s = value(vec, 'Scale') ?? [1, 1, 1], r = value(vec, 'Rotation') ?? [0, 0, 0], l = value(vec, 'Location') ?? [0, 0, 0];
            // Blender: uv' = R(rz) * (S * uv) + L. three: uv' = S' * R(-rot) * uv, so rot = -rz and the scale
            // is the rotated one (axes swap for quarter turns).
            const rz = r[2] || 0, c = Math.abs(Math.cos(rz)), sn = Math.abs(Math.sin(rz));
            const sx = s[0] || 1, sy = s[1] || 1;
            tex = tex.clone();
            tex.repeat.set(sx * c + sy * sn, sx * sn + sy * c);
            tex.rotation = -rz;
            tex.offset.set(l[0] || 0, l[1] || 0);
            tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
            tex.needsUpdate = true;
          }
          const ext = node.get('storage');
          if (ext && ext.has('interpolation') && ext.num('interpolation') === 1) { tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter; } // Closest
        }
        return tex;
      }
      // Pass-through color nodes (Mix, MixRGB, Gamma, Hue...): search their color inputs, A side first, then B
      // (e.g. AO-mix nodes leave A unlinked and bring the wallpaper in on B).
      const inputs = ['Color', 'Color1', 'A', 'A_Color', 'Image', 'Color2', 'B', 'B_Color'];
      for (const ident of inputs) {
        const l = linkInto(node, ident)?.node;
        if (!l) continue;
        const t = this.textureFrom(l, linkInto, value, srgb, depth + 1);
        if (t) return t;
      }
      return null;
    }
    return null;
  }

  private imageTexture(im: SView, srgb: boolean): THREE.Texture | null {
    const name = im.idName();
    const key = name + (srgb ? '' : '#lin');
    if (this.texCache.has(key)) return this.texCache.get(key)!;
    let tex: THREE.Texture | null = null;
    const pf = im.get('packedfile') ?? this.bf.list(im.sub('packedfiles')).map((p) => p.get('packedfile')).find(Boolean) ?? null;
    if (pf && this.opts.makeTexture) {
      const db = pf.block('data');
      if (db) {
        const bytes = this.bf.bytes.slice(db.offset, db.offset + Math.min(db.len, pf.num('size') || db.len));
        const mime = bytes[0] === 0x89 ? 'image/png' : bytes[0] === 0xff ? 'image/jpeg' : bytes[0] === 0x52 ? 'image/webp' : 'application/octet-stream';
        tex = this.opts.makeTexture(bytes, name, mime);
      }
    } else if (!pf) {
      const path = im.str(['filepath', 'name']);
      const url = this.opts.resolveImage?.(path) ?? null;
      if (url) tex = new THREE.TextureLoader().load(url);
      else if (path) this.warnings.push(`Image ${name} is not packed and was not found (${path}). Pack it in Blender (File › External Data › Pack Resources) or copy it next to the .blend.`);
    }
    // (Blender's UVs start at the picture's bottom edge, as three's do for a picture loaded the usual way, flipped: not
    // flipping it showed every packed texture upside down, a tree's trunk taking the wrong colour from a palette.)
    if (tex) { tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.flipY = true; }
    this.texCache.set(key, tex);
    return tex;
  }
}

// ------------------------------------------------------------------ transforms
function eulerOrder(rotmode: number): THREE.EulerOrder {
  // Blender XYZ (= apply X, then Y, then Z) equals three's 'ZYX' order, etc.
  return (['ZYX', 'ZYX', 'YZX', 'ZXY', 'XZY', 'YXZ', 'XYZ'] as THREE.EulerOrder[])[rotmode] ?? 'ZYX';
}

function basisOf(ob: SView): THREE.Matrix4 {
  const loc = ob.nums('loc'), dloc = ob.nums('dloc');
  const size = ob.nums(['scale', 'size']), dscale = ob.nums('dscale');
  const rotmode = ob.num('rotmode');
  let q: THREE.Quaternion;
  if (rotmode === 0) { const w = ob.nums('quat'); q = new THREE.Quaternion(w[1], w[2], w[3], w[0]).normalize(); }
  else if (rotmode === -1) { const ax = ob.nums('rotAxis'); q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(ax[0], ax[1], ax[2]).normalize(), ob.num('rotAngle')); }
  else { const r = ob.nums('rot'); const dr = ob.nums('drot'); q = new THREE.Quaternion().setFromEuler(new THREE.Euler(r[0] + (dr[0] || 0), r[1] + (dr[1] || 0), r[2] + (dr[2] || 0), eulerOrder(rotmode))); }
  const s = new THREE.Vector3(size[0] * (dscale[0] || 1), size[1] * (dscale[1] || 1), size[2] * (dscale[2] || 1));
  return new THREE.Matrix4().compose(new THREE.Vector3(loc[0] + (dloc[0] || 0), loc[1] + (dloc[1] || 0), loc[2] + (dloc[2] || 0)), q, s);
}

const mat4From = (nums: number[]) => new THREE.Matrix4().fromArray(nums); // Blender float[4][4] is column-major like three

// ------------------------------------------------------------------ animation
interface Curve { path: string; index: number; keys: { x: number; y: number; hl: [number, number]; hr: [number, number]; ipo: number }[] }

function readCurve(bf: BlendFile, fc: SView): Curve | null {
  const path = bf.stringAt(fc.ptr('rna_path'), fc.owner);
  const n = fc.num('totvert');
  const b = fc.block('bezt');
  if (!path || !b || !n) return null;
  const size = bf.structByName.get('BezTriple')!.size;
  const ipoOff = bf.structByName.get('BezTriple')!.fields.get('ipo')!.offset;
  const keys: Curve['keys'] = [];
  for (let i = 0; i < n; i++) {
    const o = b.offset + i * size;
    const v = (k: number) => bf.dv.getFloat32(o + k * 4, true);
    keys.push({ hl: [v(0), v(1)] as [number, number], x: v(3), y: v(4), hr: [v(6), v(7)] as [number, number], ipo: bf.dv.getInt8(o + ipoOff) });
  }
  return { path, index: fc.num('array_index'), keys };
}

function evalCurve(c: Curve, t: number): number {
  const k = c.keys;
  if (t <= k[0].x) return k[0].y;
  if (t >= k[k.length - 1].x) return k[k.length - 1].y;
  let i = 0; while (i < k.length - 2 && t > k[i + 1].x) i++;
  const a = k[i], b = k[i + 1];
  if (a.ipo === 0) return a.y; // constant
  if (a.ipo === 1 || b.x - a.x < 1e-6) return a.y + ((b.y - a.y) * (t - a.x)) / (b.x - a.x); // linear
  // Bezier: solve x(s) = t, then evaluate y(s).
  const x0 = a.x, x1 = Math.min(Math.max(a.hr[0], a.x), b.x), x2 = Math.max(Math.min(b.hl[0], b.x), a.x), x3 = b.x;
  const bz = (p0: number, p1: number, p2: number, p3: number, s: number) => { const u = 1 - s; return u * u * u * p0 + 3 * u * u * s * p1 + 3 * u * s * s * p2 + s * s * s * p3; };
  let lo = 0, hi = 1, s = (t - x0) / (x3 - x0);
  for (let it = 0; it < 30; it++) { const x = bz(x0, x1, x2, x3, s); if (Math.abs(x - t) < 1e-5) break; if (x < t) lo = s; else hi = s; s = (lo + hi) / 2; }
  return bz(a.y, a.hr[1], b.hl[1], b.y, s);
}

/** All F-Curves of an action: legacy `curves` list, or layered action channel bags (Blender 4.4+). */
function actionCurves(bf: BlendFile, act: SView): Curve[] {
  const out: Curve[] = [];
  if (act.has('layer_array') && act.num('layer_array_num') > 0) {
    const kd = bf.ptrArray(act.ptr('strip_keyframe_data_array'), act.num('strip_keyframe_data_array_num'), act.owner);
    for (const p of kd) {
      const data = bf.deref(p, 'ActionStripKeyframeData', act.owner); if (!data) continue;
      for (const cbp of bf.ptrArray(data.ptr('channelbag_array'), data.num('channelbag_array_num'), act.owner)) {
        const bag = bf.deref(cbp, 'ActionChannelBag', act.owner); if (!bag) continue;
        for (const fp of bf.ptrArray(bag.ptr('fcurve_array'), bag.num('fcurve_array_num'), act.owner)) {
          const fc = bf.deref(fp, 'FCurve', act.owner); const c = fc && readCurve(bf, fc); if (c) out.push(c);
        }
      }
    }
    if (out.length) return out;
  }
  for (const fc of bf.list(act.sub('curves'), 'FCurve')) { const c = readCurve(bf, fc); if (c) out.push(c); }
  return out;
}

interface Channels { loc?: Curve[]; quat?: Curve[]; eul?: Curve[]; scale?: Curve[] }

function groupChannels(curves: Curve[]) {
  const bones = new Map<string, Channels>();
  const object: Channels = {};
  for (const c of curves) {
    const m = /^pose\.bones\["(.+?)"\]\.(location|rotation_quaternion|rotation_euler|scale)$/.exec(c.path);
    const target = m ? (bones.get(m[1]) ?? (bones.set(m[1], {}), bones.get(m[1])!)) : object;
    const prop = m ? m[2] : c.path;
    const key = prop === 'location' ? 'loc' : prop === 'rotation_quaternion' ? 'quat' : prop === 'rotation_euler' ? 'eul' : prop === 'scale' ? 'scale' : null;
    if (!key) continue;
    ((target as any)[key] ??= [])[c.index] = c;
  }
  return { bones, object };
}

function channelMatrix(ch: Channels, t: number, rotmode: number): THREE.Matrix4 {
  const v = (arr: Curve[] | undefined, i: number, d: number) => (arr?.[i] ? evalCurve(arr[i], t) : d);
  const pos = new THREE.Vector3(v(ch.loc, 0, 0), v(ch.loc, 1, 0), v(ch.loc, 2, 0));
  let q = new THREE.Quaternion();
  if (ch.quat) q.set(v(ch.quat, 1, 0), v(ch.quat, 2, 0), v(ch.quat, 3, 0), v(ch.quat, 0, 1)).normalize();
  else if (ch.eul) q.setFromEuler(new THREE.Euler(v(ch.eul, 0, 0), v(ch.eul, 1, 0), v(ch.eul, 2, 0), eulerOrder(rotmode || 1)));
  const s = new THREE.Vector3(v(ch.scale, 0, 1), v(ch.scale, 1, 1), v(ch.scale, 2, 1));
  return new THREE.Matrix4().compose(pos, q, s);
}

function curveRange(chs: Channels[]): [number, number] {
  let a = Infinity, b = -Infinity;
  for (const ch of chs) for (const arr of [ch.loc, ch.quat, ch.eul, ch.scale]) for (const c of arr ?? []) if (c) for (const k of c.keys) { a = Math.min(a, k.x); b = Math.max(b, k.x); }
  return a <= b ? [a, b] : [0, 0];
}

// ------------------------------------------------------------------ main
export function blendToThree(input: ArrayBuffer | Uint8Array | BlendFile, opts: BlendOptions = {}): BlendResult {
  const bf = input instanceof BlendFile ? input : new BlendFile(input);
  const warnings: string[] = [];
  const mats = new MaterialBuilder(bf, opts, warnings);
  const root = new THREE.Group();
  root.name = 'blend_root';
  root.rotation.x = -Math.PI / 2; // Blender Z-up -> three Y-up
  const byName = new Map<string, THREE.Object3D>();
  const objects: BlendObjectInfo[] = [];
  const animations: THREE.AnimationClip[] = [];
  const sc = bf.idBlocks('SC')[0];
  const rd = sc?.sub('r');
  const fps = rd ? (rd.num('frs_sec') || 24) / (rd.num('frs_sec_base') || 1) : 24;

  const obViews = bf.idBlocks('OB');
  const obByPtr = new Map<Ptr, SView>();
  for (const b of bf.blocks) if (b.code === 'OB') obByPtr.set(b.old, bf.viewBlock(b));
  const nodes = new Map<Ptr, { node: THREE.Object3D; inner: THREE.Object3D; ob: SView }>();
  const skeletons = new Map<Ptr, { bones: THREE.Bone[]; boneByName: Map<string, THREE.Bone>; rest: Map<string, THREE.Matrix4>; rotmodes: Map<string, number> }>();
  const pendingSkins: { mesh: THREE.SkinnedMesh; armPtr: Ptr }[] = [];
  const actions = bf.idBlocks('AC');
  const actionCurveCache = new Map<SView, Curve[]>();
  const curvesOf = (a: SView) => { let c = actionCurveCache.get(a); if (!c) { c = actionCurves(bf, a); actionCurveCache.set(a, c); } return c; };

  // 1) Build a node per object.
  for (const [ptr, ob] of obByPtr) {
    const name = ob.idName();
    const type = ob.num('type');
    const holder = new THREE.Group();
    holder.name = sanitize(name);
    holder.userData.blenderName = name;
    holder.applyMatrix4(basisOf(ob));
    const hidden = (ob.num('restrictflag') & 4) !== 0 || ob.num('dt') <= 2 || (ob.num('visibility_flag') & 4) !== 0;
    holder.visible = !hidden;
    let verts = 0; const matNames: string[] = []; let skinned = false;
    const data = ob.get('data');
    if (type === OB.MESH && data) {
      let md: MeshData | null = null;
      try { md = readMesh(bf, data, ob, warnings); } catch (e: any) { warnings.push(`${name}: mesh could not be read (${e?.message ?? e})`); }
      const mods = bf.list(ob.sub('modifiers'));
      let armPtr: Ptr = 0n;
      if (md) for (const m of mods) {
        const base = m.sub('modifier') ?? m; const t = base.num('type'); const mname = base.str('name');
        if (!(base.num('mode') & 1)) continue; // disabled in viewport
        if (t === MOD.ARRAY) md = applyArray(md, m);
        else if (t === MOD.MIRROR) md = applyMirror(md, m);
        else if (t === MOD.SOLIDIFY) md = applySolidify(md, m);
        else if (t === MOD.ARMATURE) armPtr = m.ptr('object');
        else if (t === MOD.NODES && /smooth by angle/i.test(mname)) md.autoSmooth = Math.PI / 6;
        else if (t === MOD.BOOLEAN && !m.ptr('object') && !m.ptr('collection')) { /* no operand: no effect in Blender either */ }
        else if (t === MOD.TRIANGULATE || t === MOD.EDGE_SPLIT) { /* geometry is triangulated / split normals approximated */ }
        else warnings.push(`${name}: ${MOD_NAMES[t] ?? 'modifier ' + t} "${mname}" is not evaluated (apply it in Blender for an exact match)`);
      }
      if (md) {
        verts = md.pos.length / 3;
        const totcol = data.num('totcol');
        const meshMatPtrs = bf.ptrArray(data.ptr('mat'), totcol, data.owner);
        const obMatPtrs = bf.ptrArray(ob.ptr('mat'), ob.num('totcol'), ob.owner);
        const matbits = ob.block('matbits');
        const slotMats = Array.from({ length: Math.max(1, totcol) }, (_, i) => {
          const useOb = matbits && bf.bytes[matbits.offset + i] && obMatPtrs[i];
          const p = useOb ? obMatPtrs[i] : meshMatPtrs[i];
          return p ? mats.get(p, useOb ? ob.owner : data.owner) : new THREE.MeshStandardMaterial({ color: 0xcccccc, roughness: 0.6 });
        });
        matNames.push(...slotMats.map((m) => m.name));
        armPtr ||= ob.num('partype') === 0 && ob.get('parent')?.num('type') === OB.ARMATURE ? ob.ptr('parent') : 0n;
        const arm = armPtr ? obByPtr.get(armPtr) : null;
        let boneIndexOfGroup: number[] | null = null;
        if (arm && md.dverts) {
          ensureSkeleton(armPtr, arm);
          const sk = skeletons.get(armPtr)!;
          boneIndexOfGroup = md.groups.map((g) => sk.bones.findIndex((b) => b.userData.blenderName === g));
        }
        const geo = buildGeometry(md, boneIndexOfGroup);
        const material = slotMats.length === 1 ? slotMats[0] : slotMats;
        let mesh: THREE.Mesh;
        if (boneIndexOfGroup) { mesh = new THREE.SkinnedMesh(geo, material); pendingSkins.push({ mesh: mesh as THREE.SkinnedMesh, armPtr }); skinned = true; }
        else mesh = new THREE.Mesh(geo, material);
        mesh.name = sanitize(name) + '_mesh';
        mesh.castShadow = true; mesh.receiveShadow = true;
        holder.add(mesh);
      }
    } else if (type === OB.LIGHT && data) {
      const t = data.num('type');
      const l: BlendLight = {
        type: t === 1 ? 'sun' : t === 2 ? 'spot' : t === 4 ? 'area' : 'point',
        color: '#' + new THREE.Color(data.num('r'), data.num('g'), data.num('b')).getHexString(),
        power: data.num('energy'), radius: data.num(['radius', 'area_size']), spotSize: (data.num('spotsize') * 180) / Math.PI, spotBlend: data.num('spotblend'),
        sizeX: data.num('area_size'), sizeY: data.num('area_sizey') || data.num('area_size'), castShadow: (data.num('mode') & 1) !== 0,
      };
      holder.userData.blenderLight = l;
      const lo = opts.makeLight?.(l);
      if (lo) holder.add(lo);
    } else if (type === OB.CAMERA && data) {
      holder.userData.blenderCamera = { type: data.num('type') === 1 ? 'orthographic' : 'perspective', focalLength: data.num('lens'), sensorWidth: data.num('sensor_x') || 36, clipStart: data.num(['clip_start', 'clipsta']), clipEnd: data.num(['clip_end', 'clipend']), orthoScale: data.num('ortho_scale') };
    } else if (type === OB.ARMATURE && data) {
      ensureSkeleton(ptr, ob);
    } else if (type !== OB.EMPTY) {
      warnings.push(`${name}: ${type === OB.FONT ? 'text' : type === OB.CURVE ? 'curve' : 'object type ' + type} objects are not converted (convert to mesh in Blender to include them)`);
    }
    nodes.set(ptr, { node: holder, inner: holder, ob });
    byName.set(name, holder);
    objects.push({ name, type: ({ 0: 'empty', 1: 'mesh', 10: 'light', 11: 'camera', 25: 'armature', 4: 'text', 2: 'curve' } as Record<number, string>)[type] ?? String(type), parent: ob.get('parent')?.idName() ?? null, vertices: verts, materials: matNames, hidden, animations: [], skinned });
  }

  function ensureSkeleton(armPtr: Ptr, armOb: SView) {
    if (skeletons.has(armPtr)) return;
    const arm = armOb.get('data');
    const bones: THREE.Bone[] = []; const boneByName = new Map<string, THREE.Bone>(); const rest = new Map<string, THREE.Matrix4>(); const rotmodes = new Map<string, number>();
    const pose = armOb.get('pose');
    if (pose) for (const pc of bf.list(pose.sub('chanbase'), 'bPoseChannel')) rotmodes.set(pc.str('name'), pc.num('rotmode'));
    const walk = (list: SView[], parent: THREE.Object3D | null, parentMat: THREE.Matrix4 | null) => {
      for (const b of list) {
        const name = b.str('name');
        const armMat = mat4From(b.nums('arm_mat'));
        const local = parentMat ? parentMat.clone().invert().multiply(armMat) : armMat.clone();
        const bone = new THREE.Bone();
        bone.name = sanitize(name);
        bone.userData.blenderName = name;
        bone.userData.length = b.num('length');
        local.decompose(bone.position, bone.quaternion, bone.scale);
        rest.set(name, local);
        bones.push(bone); boneByName.set(name, bone);
        if (parent) parent.add(bone);
        walk(bf.list(b.sub('childbase'), 'Bone'), bone, armMat);
      }
    };
    if (arm) walk(bf.list(arm.sub('bonebase'), 'Bone'), null, null);
    skeletons.set(armPtr, { bones, boneByName, rest, rotmodes });
  }

  // 2) Parent: parent node -> (parentinv) -> object basis.
  for (const [, n] of nodes) {
    const parentPtr = n.ob.ptr('parent');
    const parent = parentPtr ? nodes.get(parentPtr) : null;
    const pinv = mat4From(n.ob.nums('parentinv'));
    let target: THREE.Object3D = parent ? parent.node : root;
    // Bone parent (rigid rigs: a piece per bone): Blender places the child at the bone's tail.
    if (parent && n.ob.num('partype') === 7 && parent.ob.num('type') === OB.ARMATURE) {
      ensureSkeleton(parentPtr, parent.ob);
      const bone = skeletons.get(parentPtr)?.boneByName.get(n.ob.str('parsubstr'));
      if (bone) {
        let tail = bone.children.find((c) => c.userData.boneTail) as THREE.Object3D | undefined;
        if (!tail) { tail = new THREE.Group(); tail.name = bone.name + '_tail'; tail.userData.boneTail = true; tail.position.y = Number(bone.userData.length) || 0; bone.add(tail); }
        target = tail;
      }
    }
    if (parent && !pinv.equals(new THREE.Matrix4())) {
      const pi = new THREE.Group(); pi.name = n.node.name + '_parentinv'; pi.applyMatrix4(pinv);
      pi.add(n.node); target.add(pi);
    } else target.add(n.node);
  }
  // Root bones live under their armature object.
  for (const [ptr, sk] of skeletons) { const n = nodes.get(ptr); if (n) for (const b of sk.bones) if (!b.parent) n.node.add(b); }
  root.updateMatrixWorld(true);
  for (const { mesh, armPtr } of pendingSkins) {
    const sk = skeletons.get(armPtr)!;
    mesh.bind(new THREE.Skeleton(sk.bones), mesh.matrixWorld);
  }

  // 3) Animations: bone actions per armature, object actions per object.
  const objectActions = new Map<Ptr, SView[]>();
  for (const [ptr, n] of nodes) { const act = n.ob.get('adt')?.get('action'); if (act) objectActions.set(ptr, [act]); }
  for (const [armPtr, sk] of skeletons) {
    const armNode = nodes.get(armPtr)!;
    const info = objects.find((o) => o.name === armNode.ob.idName());
    for (const act of actions) {
      const { bones } = groupChannels(curvesOf(act));
      const relevant = [...bones.keys()].filter((b) => sk.boneByName.has(b));
      if (!relevant.length) continue;
      const [a, b] = curveRange(relevant.map((r) => bones.get(r)!));
      const frames: number[] = []; for (let f = a; f <= b + 1e-6; f++) frames.push(f);
      if (frames.length < 2) frames.push(a + 1);
      const times = frames.map((f) => (f - a) / fps);
      const tracks: THREE.KeyframeTrack[] = [];
      for (const bn of relevant) {
        const ch = bones.get(bn)!; const restM = sk.rest.get(bn)!; const bone = sk.boneByName.get(bn)!;
        const P: number[] = [], Q: number[] = [], S: number[] = [];
        const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
        for (const f of frames) { restM.clone().multiply(channelMatrix(ch, f, sk.rotmodes.get(bn) ?? 0)).decompose(p, q, s); P.push(p.x, p.y, p.z); Q.push(q.x, q.y, q.z, q.w); S.push(s.x, s.y, s.z); }
        tracks.push(new THREE.VectorKeyframeTrack(`${bone.name}.position`, times, P), new THREE.QuaternionKeyframeTrack(`${bone.name}.quaternion`, times, Q), new THREE.VectorKeyframeTrack(`${bone.name}.scale`, times, S));
      }
      const clip = new THREE.AnimationClip(act.idName(), times[times.length - 1], tracks);
      (clip as any).userData = { armature: armNode.ob.idName(), fps, frameStart: a, frameEnd: b };
      animations.push(clip);
      info?.animations.push(act.idName());
    }
  }
  for (const [ptr, acts] of objectActions) {
    const n = nodes.get(ptr)!;
    if (n.ob.num('type') === OB.ARMATURE) continue;
    for (const act of acts) {
      const { object } = groupChannels(curvesOf(act));
      if (!object.loc && !object.eul && !object.quat && !object.scale) continue;
      const [a, b] = curveRange([object]);
      const frames: number[] = []; for (let f = a; f <= b + 1e-6; f++) frames.push(f);
      if (frames.length < 2) continue;
      const times = frames.map((f) => (f - a) / fps);
      const base = basisOf(n.ob); const bp = new THREE.Vector3(), bq = new THREE.Quaternion(), bs = new THREE.Vector3(); base.decompose(bp, bq, bs);
      const P: number[] = [], Q: number[] = [], S: number[] = [];
      const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
      for (const f of frames) {
        // Unanimated channels keep the object's own values.
        const ch: Channels = { ...object };
        const m = channelMatrix(ch, f, n.ob.num('rotmode'));
        m.decompose(p, q, s);
        if (!object.loc) p.copy(bp); if (!object.eul && !object.quat) q.copy(bq); if (!object.scale) s.copy(bs);
        P.push(p.x, p.y, p.z); Q.push(q.x, q.y, q.z, q.w); S.push(s.x, s.y, s.z);
      }
      const tracks = [new THREE.VectorKeyframeTrack(`${n.node.name}.position`, times, P), new THREE.QuaternionKeyframeTrack(`${n.node.name}.quaternion`, times, Q), new THREE.VectorKeyframeTrack(`${n.node.name}.scale`, times, S)];
      const clip = new THREE.AnimationClip(act.idName(), times[times.length - 1], tracks);
      (clip as any).userData = { object: n.ob.idName(), fps };
      animations.push(clip);
      objects.find((o) => o.name === n.ob.idName())?.animations.push(act.idName());
    }
  }
  return { root, byName, animations, objects, warnings, version: bf.version, fps };
}

/** A self-contained copy of one object and its children, with world placement baked into a wrapper. */
export function extractObject(res: BlendResult, name: string, cloneFn: (o: THREE.Object3D) => THREE.Object3D): { group: THREE.Group; animations: THREE.AnimationClip[] } | null {
  let node = res.byName.get(name);
  if (!node) return null;
  // A skinned mesh needs its skeleton: extract the armature object that owns the bones instead.
  let skinned: THREE.SkinnedMesh | null = null;
  node.traverse((o) => { if ((o as THREE.SkinnedMesh).isSkinnedMesh && !skinned) skinned = o as THREE.SkinnedMesh; });
  if (skinned) {
    const bone0 = (skinned as THREE.SkinnedMesh).skeleton.bones[0];
    let inside = false; node.traverse((o) => { if (o === bone0) inside = true; });
    if (!inside) { let a: THREE.Object3D | null = bone0; while (a && !(a.userData.blenderName && !(a as THREE.Bone).isBone)) a = a.parent; if (a) node = a; }
  }
  res.root.updateMatrixWorld(true);
  const copy = cloneFn(node);
  copy.visible = true;
  // Keep the world transform (Z-up -> Y-up, parents, parent-inverse) but drop the world position,
  // so the asset's pivot is its own origin.
  const m = node.matrixWorld.clone();
  const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  m.decompose(p, q, s);
  copy.position.set(0, 0, 0); copy.quaternion.copy(q); copy.scale.copy(s);
  const g = new THREE.Group(); g.name = 'blend:' + name; g.add(copy);
  // Clips that target this object or bones inside it.
  const names = new Set<string>(); copy.traverse((o) => names.add(o.name));
  const animations = res.animations.filter((c) => c.tracks.some((t) => names.has(t.name.split('.')[0])));
  return { group: g, animations };
}
