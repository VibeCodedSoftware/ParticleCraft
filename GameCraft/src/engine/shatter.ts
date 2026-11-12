// Shattering (Breakable behavior): like Blender's Cell Fracture, the object's OWN mesh is cut into pieces. Each cut
// slices every triangle of a piece by a plane (keeping positions, normals, UVs and materials, so the outside keeps
// its textures) and closes the cut with a cap in the "inside" material, so pieces are solid chunks. Pieces fly
// apart from the hit, tumble, bounce on the floor and walls and shrink away. They are visual only: hundreds of
// them never slow the game's physics.
import * as THREE from 'three';
import type { ShatterEvent } from '@shared/src/runtime/breakable';
import type { World } from '@shared/src/runtime/world';

/** Triangles of one piece: 3 vertices per triangle (pos/nrm xyz, uv xy) and a material index per triangle. */
interface Soup { pos: number[]; nrm: number[]; uv: number[]; mat: number[] }
export interface Fracture { pieces: { geo: THREE.BufferGeometry; center: THREE.Vector3; radius: number }[]; materials: THREE.Material[] }

function rng(seed: number) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }

/** All triangles of a visual, in the space of `root` (so a cached fracture follows the object wherever it is). */
export function collect(root: THREE.Object3D): { soup: Soup; materials: THREE.Material[] } | null {
  const soup: Soup = { pos: [], nrm: [], uv: [], mat: [] };
  const materials: THREE.Material[] = [];
  root.updateWorldMatrix(true, true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const v = new THREE.Vector3(), n = new THREE.Vector3();
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    // (Never the wireframe box drawn while a model loads: pieces of that came out as a purple cube.)
    if (!m.isMesh || !m.visible || (m as any).isInstancedMesh || o.userData.editorOnly || o.name === 'placeholder') return;
    const g = m.geometry; const pa = g.getAttribute('position'); if (!pa) return;
    const na = g.getAttribute('normal'), ua = g.getAttribute('uv');
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    const base = materials.length; materials.push(...mats);
    const toRoot = new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld);
    const nm = new THREE.Matrix3().getNormalMatrix(toRoot);
    // An animated model's vertices are where its skeleton has them now (and morphs), not where the file put them.
    const posed = (m as THREE.SkinnedMesh).isSkinnedMesh || !!g.morphAttributes?.position?.length;
    const scaleAll = root.getWorldScale(new THREE.Vector3()), unit = Math.max(Math.abs(scaleAll.x), Math.abs(scaleAll.y), Math.abs(scaleAll.z)) || 1;
    const idx = g.index;
    const count = idx ? idx.count : pa.count;
    const groups = g.groups.length ? g.groups : [{ start: 0, count, materialIndex: 0 }];
    for (const gr of groups) for (let k = gr.start; k < Math.min(count, gr.start + gr.count); k++) {
      const i = idx ? idx.getX(k) : k;
      if (posed) m.getVertexPosition(i, v); else v.fromBufferAttribute(pa, i);
      v.applyMatrix4(toRoot); soup.pos.push(v.x, v.y, v.z);
      if (na) { n.fromBufferAttribute(na, i).applyMatrix3(nm).normalize(); soup.nrm.push(n.x, n.y, n.z); } else soup.nrm.push(0, 1, 0);
      if (ua) soup.uv.push(ua.getX(i), ua.getY(i));
      else {
        // No UVs in the mesh: project an image from the side the surface faces (about once per 2 m of the object).
        const ax = na ? Math.abs(n.x) : 0, ay = na ? Math.abs(n.y) : 0, az = na ? Math.abs(n.z) : 1;
        if (ax >= ay && ax >= az) soup.uv.push(v.z * unit * 0.5, v.y * unit * 0.5);
        else if (ay >= az) soup.uv.push(v.x * unit * 0.5, v.z * unit * 0.5);
        else soup.uv.push(v.x * unit * 0.5, v.y * unit * 0.5);
      }
      // A single material draws every group (group indexes only matter with a material array).
      if ((k - gr.start) % 3 === 0) soup.mat.push(base + (Array.isArray(m.material) ? Math.min(mats.length - 1, gr.materialIndex ?? 0) : 0));
    }
  });
  return soup.mat.length ? { soup, materials } : null;
}

/** Split a triangle soup by the plane n·p = d into the parts above and below, plus the cut segments. */
function slice(s: Soup, n: THREE.Vector3, d: number, capMat: number, capUv = 0.5): [Soup, Soup] {
  const A: Soup = { pos: [], nrm: [], uv: [], mat: [] }, B: Soup = { pos: [], nrm: [], uv: [], mat: [] };
  const segs: number[] = [];
  const vert = (t: number, c: number) => ({ p: [s.pos[t * 9 + c * 3], s.pos[t * 9 + c * 3 + 1], s.pos[t * 9 + c * 3 + 2]], n: [s.nrm[t * 9 + c * 3], s.nrm[t * 9 + c * 3 + 1], s.nrm[t * 9 + c * 3 + 2]], u: [s.uv[t * 6 + c * 2], s.uv[t * 6 + c * 2 + 1]] });
  type V = ReturnType<typeof vert>;
  const lerp = (a: V, b: V, t: number): V => ({ p: a.p.map((x, i) => x + (b.p[i] - x) * t), n: a.n.map((x, i) => x + (b.n[i] - x) * t), u: a.u.map((x, i) => x + (b.u[i] - x) * t) });
  const emit = (o: Soup, a: V, b: V, c: V, m: number) => { for (const x of [a, b, c]) { o.pos.push(...x.p); o.nrm.push(...x.n); o.uv.push(...x.u); } o.mat.push(m); };
  const dist = (x: V) => n.x * x.p[0] + n.y * x.p[1] + n.z * x.p[2] - d;
  for (let t = 0; t < s.mat.length; t++) {
    const vs = [vert(t, 0), vert(t, 1), vert(t, 2)], ds = vs.map(dist), m = s.mat[t];
    const pos = ds.map((x) => x >= 0);
    const np = pos.filter(Boolean).length;
    if (np === 3) { emit(A, vs[0], vs[1], vs[2], m); continue; }
    if (np === 0) { emit(B, vs[0], vs[1], vs[2], m); continue; }
    // The lone vertex on one side, then the two others in winding order.
    const lone = np === 1 ? pos.indexOf(true) : pos.indexOf(false);
    const a = vs[lone], b = vs[(lone + 1) % 3], c = vs[(lone + 2) % 3];
    const da = ds[lone], db = ds[(lone + 1) % 3], dc = ds[(lone + 2) % 3];
    const ab = lerp(a, b, da / (da - db)), ac = lerp(a, c, da / (da - dc));
    const [single, pair] = np === 1 ? [A, B] : [B, A];
    emit(single, a, ab, ac, m);
    emit(pair, ab, b, c, m); emit(pair, ab, c, ac, m);
    segs.push(...ab.p, ...ac.p);
  }
  // Caps: chain the cut segments into loops, triangulate each in the plane, add to both sides (facing outward).
  if (segs.length >= 18) {
    const u = new THREE.Vector3(), w = new THREE.Vector3();
    u.copy(Math.abs(n.x) < 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0)).cross(n).normalize(); w.crossVectors(n, u);
    const key = (x: number, y: number, z: number) => `${Math.round(x * 2000)},${Math.round(y * 2000)},${Math.round(z * 2000)}`;
    const nodes = new Map<string, { p: number[]; links: string[] }>();
    for (let i = 0; i < segs.length; i += 6) {
      const k1 = key(segs[i], segs[i + 1], segs[i + 2]), k2 = key(segs[i + 3], segs[i + 4], segs[i + 5]);
      if (k1 === k2) continue;
      if (!nodes.has(k1)) nodes.set(k1, { p: segs.slice(i, i + 3), links: [] });
      if (!nodes.has(k2)) nodes.set(k2, { p: segs.slice(i + 3, i + 6), links: [] });
      nodes.get(k1)!.links.push(k2); nodes.get(k2)!.links.push(k1);
    }
    const used = new Set<string>();
    for (const [start] of nodes) {
      if (used.has(start)) continue;
      const loop: string[] = [start]; used.add(start);
      let cur = start, prev = '';
      for (let guard = 0; guard < 100000; guard++) {
        const next = nodes.get(cur)!.links.find((l) => l !== prev && !used.has(l)) ?? nodes.get(cur)!.links.find((l) => l !== prev);
        if (!next || next === start || used.has(next)) break;
        loop.push(next); used.add(next); prev = cur; cur = next;
      }
      if (loop.length < 3) continue;
      const pts = loop.map((k) => nodes.get(k)!.p);
      const flat = pts.map((p) => new THREE.Vector2(p[0] * u.x + p[1] * u.y + p[2] * u.z, p[0] * w.x + p[1] * w.y + p[2] * w.z));
      let tris: number[][];
      try { tris = THREE.ShapeUtils.triangulateShape(flat, []); } catch { continue; }
      for (const [i0, i1, i2] of tris) {
        const P = [pts[i0], pts[i1], pts[i2]], U = [flat[i0], flat[i1], flat[i2]].map((f) => [f.x, f.y]);
        // (u, w, n) is right-handed, so a counter-clockwise triangle in (u, w) faces +n. Side A (above the plane) is
        // closed by a face looking down (-n), side B by one looking up (+n): order each triangle to match.
        const ccw = (U[1][0] - U[0][0]) * (U[2][1] - U[0][1]) - (U[1][1] - U[0][1]) * (U[2][0] - U[0][0]) > 0;
        const up = ccw ? [0, 1, 2] : [0, 2, 1], down = [up[0], up[2], up[1]];
        const order = down, rev = up;
        for (const [o, nn, ord] of [[A, [-n.x, -n.y, -n.z], order], [B, [n.x, n.y, n.z], rev]] as const) {
          for (const j of ord) { o.pos.push(...P[j]); o.nrm.push(...nn); o.uv.push(U[j][0] * capUv, U[j][1] * capUv); }
          o.mat.push(capMat);
        }
      }
    }
  }
  return [A, B];
}

function bounds(s: Soup) {
  const b = new THREE.Box3();
  for (let i = 0; i < s.pos.length; i += 3) b.expandByPoint(new THREE.Vector3(s.pos[i], s.pos[i + 1], s.pos[i + 2]));
  return b;
}

/** Cut the soup into about `count` pieces (largest piece first, planes across its longest side). */
export function fracture(src: Soup, materials: THREE.Material[], count: number, seed: number, inside: THREE.Material): Fracture {
  const r = rng(seed);
  const capMat = materials.length;
  type P = { s: Soup; box: THREE.Box3; size: number };
  const mk = (s: Soup): P => { const box = bounds(s); return { s, box, size: box.getSize(new THREE.Vector3()).length() }; };
  let pieces: P[] = [mk(src)];
  const minSize = pieces[0].size / 400;
  const capUv = 2 / Math.max(1e-6, pieces[0].size); // an inner texture repeats about twice across the object, whatever its units
  let guard = 0;
  while (pieces.length < count && guard++ < count * 3) {
    pieces.sort((a, b) => b.size - a.size);
    const p = pieces[0];
    if (p.size < minSize || p.s.mat.length < 1) break;
    const size = p.box.getSize(new THREE.Vector3()), c = p.box.getCenter(new THREE.Vector3());
    // Normal mostly along the longest side (chunky pieces), with some randomness for natural, angled cuts.
    const axis = size.x >= size.y && size.x >= size.z ? new THREE.Vector3(1, 0, 0) : size.y >= size.z ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1);
    const n = axis.multiplyScalar(1.2).add(new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5)).normalize();
    const at = c.add(new THREE.Vector3((r() - 0.5) * size.x, (r() - 0.5) * size.y, (r() - 0.5) * size.z).multiplyScalar(0.75));
    const [a, b] = slice(p.s, n, n.dot(at), capMat, capUv);
    if (!a.mat.length || !b.mat.length) { p.size *= 0.7; continue; } // missed it: try another plane next time
    pieces = [...pieces.slice(1), mk(a), mk(b)];
  }
  const mats = [...materials, inside];
  return {
    materials: mats,
    pieces: pieces.map((p) => {
      const center = p.box.getCenter(new THREE.Vector3());
      const g = new THREE.BufferGeometry();
      const pos = new Float32Array(p.s.pos.length);
      for (let i = 0; i < pos.length; i += 3) { pos[i] = p.s.pos[i] - center.x; pos[i + 1] = p.s.pos[i + 1] - center.y; pos[i + 2] = p.s.pos[i + 2] - center.z; }
      // Group triangles by material.
      const order = p.s.mat.map((m, t) => [m, t]).sort((x, y) => x[0] - y[0]);
      const P2 = new Float32Array(pos.length), N2 = new Float32Array(pos.length), U2 = new Float32Array(p.s.uv.length);
      let start = 0, last = -1, k = 0;
      for (const [m, t] of order) {
        if (m !== last) { if (last >= 0) g.addGroup(start * 3, (k - start) * 3, last); start = k; last = m; }
        P2.set(pos.subarray(t * 9, t * 9 + 9), k * 9); N2.set(p.s.nrm.slice(t * 9, t * 9 + 9), k * 9); U2.set(p.s.uv.slice(t * 6, t * 6 + 6), k * 6);
        k++;
      }
      if (last >= 0) g.addGroup(start * 3, (k - start) * 3, last);
      g.setAttribute('position', new THREE.BufferAttribute(P2, 3)); g.setAttribute('normal', new THREE.BufferAttribute(N2, 3)); g.setAttribute('uv', new THREE.BufferAttribute(U2, 2));
      g.computeBoundingSphere();
      return { geo: g, center, radius: g.boundingSphere?.radius ?? 0.05 };
    }).filter((x) => x.geo.getAttribute('position').count > 0),
  };
}

interface Piece { mesh: THREE.Mesh; vel: THREE.Vector3; axis: THREE.Vector3; spin: number; age: number; life: number; radius: number; rest: number }

/** What a material looks like on average: its colour, times its image's when it has one. */
const pictureCache = new WeakMap<object, { w: number; h: number; data: Uint8ClampedArray } | null>();
function pictureOf(tex: THREE.Texture | null | undefined) {
  const img = tex?.image as CanvasImageSource | undefined;
  if (!tex || !img || typeof document === 'undefined') return null;
  let got = pictureCache.get(tex);
  if (got === undefined) {
    try {
      const c = document.createElement('canvas'); c.width = c.height = 48;
      const x = c.getContext('2d', { willReadFrequently: true })!; x.drawImage(img, 0, 0, 48, 48);
      got = { w: 48, h: 48, data: x.getImageData(0, 0, 48, 48).data };
    } catch { got = null; } // not readable (or not loaded): colours alone
    if (got || (img as HTMLImageElement).complete !== false) pictureCache.set(tex, got);
  }
  return got ?? null;
}
const srgbToLinear = (b: number) => new THREE.Color().setRGB(b / 255, b / 255, b / 255, THREE.SRGBColorSpace).r;
function colorAt(mat: THREE.Material, u: number, v: number, out: THREE.Color) {
  const m = mat as THREE.MeshStandardMaterial;
  out.copy(m.color ?? WHITE);
  const pic = pictureOf(m.map);
  if (pic) {
    const px = Math.floor(((u % 1) + 1) % 1 * pic.w), py = Math.floor((1 - ((v % 1) + 1) % 1) * pic.h) % pic.h, i = (py * pic.w + px) * 4;
    out.r *= srgbToLinear(pic.data[i]); out.g *= srgbToLinear(pic.data[i + 1]); out.b *= srgbToLinear(pic.data[i + 2]);
  }
  return out;
}
const WHITE = new THREE.Color(1, 1, 1);
/** The average colour of a soup, by surface area: what a cut through this object would look like. */
export function averageColor(soup: Soup, materials: THREE.Material[]): THREE.Color {
  const sum = new THREE.Color(0, 0, 0), c = new THREE.Color();
  const a = new THREE.Vector3(), b = new THREE.Vector3(), d = new THREE.Vector3();
  let total = 0;
  const step = Math.max(1, Math.floor(soup.mat.length / 4000));
  for (let t = 0; t < soup.mat.length; t += step) {
    a.set(soup.pos[t * 9 + 3] - soup.pos[t * 9], soup.pos[t * 9 + 4] - soup.pos[t * 9 + 1], soup.pos[t * 9 + 5] - soup.pos[t * 9 + 2]);
    b.set(soup.pos[t * 9 + 6] - soup.pos[t * 9], soup.pos[t * 9 + 7] - soup.pos[t * 9 + 1], soup.pos[t * 9 + 8] - soup.pos[t * 9 + 2]);
    const area = d.crossVectors(a, b).length() * 0.5;
    colorAt(materials[soup.mat[t]], soup.uv[t * 6], soup.uv[t * 6 + 1], c);
    sum.r += c.r * area; sum.g += c.g * area; sum.b += c.b * area; total += area;
  }
  return total > 0 ? sum.multiplyScalar(1 / total) : new THREE.Color(0.5, 0.5, 0.5);
}

/** Low quality's bits: points on the object's surface (root space) with the surface's colour there. */
export interface BitSamples { pos: Float32Array; col: Float32Array; size: number; center: THREE.Vector3 }
export function sampleSurface(soup: Soup, materials: THREE.Material[], count: number, seed: number): BitSamples {
  const r = rng(seed), tris = soup.mat.length;
  const cdf = new Float64Array(tris);
  let total = 0;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), d = new THREE.Vector3();
  const box = new THREE.Box3(), p = new THREE.Vector3();
  for (let t = 0; t < tris; t++) {
    a.set(soup.pos[t * 9 + 3] - soup.pos[t * 9], soup.pos[t * 9 + 4] - soup.pos[t * 9 + 1], soup.pos[t * 9 + 5] - soup.pos[t * 9 + 2]);
    b.set(soup.pos[t * 9 + 6] - soup.pos[t * 9], soup.pos[t * 9 + 7] - soup.pos[t * 9 + 1], soup.pos[t * 9 + 8] - soup.pos[t * 9 + 2]);
    total += d.crossVectors(a, b).length() * 0.5; cdf[t] = total;
    box.expandByPoint(p.set(soup.pos[t * 9], soup.pos[t * 9 + 1], soup.pos[t * 9 + 2]));
    box.expandByPoint(p.set(soup.pos[t * 9 + 3], soup.pos[t * 9 + 4], soup.pos[t * 9 + 5]));
    box.expandByPoint(p.set(soup.pos[t * 9 + 6], soup.pos[t * 9 + 7], soup.pos[t * 9 + 8]));
  }
  const pos = new Float32Array(count * 3), col = new Float32Array(count * 3), c = new THREE.Color();
  for (let n = 0; n < count; n++) {
    const want = r() * total; let lo = 0, hi = tris - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (cdf[mid] < want) lo = mid + 1; else hi = mid; }
    const t = lo; let u = r(), v = r(); if (u + v > 1) { u = 1 - u; v = 1 - v; } const w = 1 - u - v;
    for (let k = 0; k < 3; k++) pos[n * 3 + k] = soup.pos[t * 9 + k] * w + soup.pos[t * 9 + 3 + k] * u + soup.pos[t * 9 + 6 + k] * v;
    colorAt(materials[soup.mat[t]], soup.uv[t * 6] * w + soup.uv[t * 6 + 2] * u + soup.uv[t * 6 + 4] * v, soup.uv[t * 6 + 1] * w + soup.uv[t * 6 + 3] * u + soup.uv[t * 6 + 5] * v, c);
    col[n * 3] = c.r; col[n * 3 + 1] = c.g; col[n * 3 + 2] = c.b;
  }
  return { pos, col, size: Math.sqrt(Math.max(1e-9, total) / Math.max(1, count)) * 0.8, center: box.getCenter(new THREE.Vector3()) };
}

interface Burst { mesh: THREE.InstancedMesh; pos: Float32Array; vel: Float32Array; size: Float32Array; floor: number; age: number; life: number; n: number }
const BIT_GEO = new THREE.IcosahedronGeometry(0.5, 0);
const BIT_MAT = new THREE.MeshStandardMaterial({ roughness: 0.85, flatShading: true });

/** The cut settings a break uses, per quality. */
export function piecesFor(quality: string | undefined, pieces: number) {
  return quality === 'low' ? Math.max(20, Math.min(400, pieces)) : quality === 'medium' ? Math.max(4, Math.min(30, Math.round(pieces / 4))) : pieces;
}
/** One cached fracture per model and look. */
export function shatterKey(sig: string, o: { pieces: number; quality?: string; inside?: string; outsideTexture?: string; insideTexture?: string }) {
  return [sig, piecesFor(o.quality, o.pieces), o.quality === 'low' ? 'low' : 'cut', o.inside ?? '', o.outsideTexture ?? '', o.insideTexture ?? ''].join('|');
}

/** Flying pieces: gravity, bounce on Solid boxes near the break, tumbling, then shrinking away. */
export class DebrisSystem {
  private pieces: Piece[] = [];
  private bursts: Burst[] = [];
  private solids: THREE.Box3[] = [];
  private solidsAt = new THREE.Vector3(Infinity, 0, 0);
  private cache = new Map<string, Fracture>();
  private bitCache = new Map<string, BitSamples>();
  /** A picture for an asset id (the game's own asset store). */
  textureOf: ((id: string) => THREE.Texture | null) | null = null;
  constructor(private parent: THREE.Object3D) {}
  get count() { return this.pieces.length + this.bursts.reduce((a, b) => a + b.n, 0); }

  private looks(ev: Pick<ShatterEvent, 'outsideTexture' | 'insideTexture'>) {
    const tiled = (id?: string) => { const t = id ? this.textureOf?.(id) ?? null : null; if (t) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; } return t; };
    return { outer: tiled(ev.outsideTexture), inner: tiled(ev.insideTexture) };
  }
  /** The object's own materials, with the Outer texture on them when one is set. */
  private outerMaterials(materials: THREE.Material[], outer: THREE.Texture | null) {
    return materials.map((m) => {
      const c = m.clone() as THREE.MeshStandardMaterial;
      if (outer && 'map' in c) { c.map = outer; c.color?.set(0xffffff); c.needsUpdate = true; }
      return c as THREE.Material;
    });
  }

  /** Shatter `visual` (the object's rendered group) for event `ev`. `key` caches the cut pattern per model. */
  /** The cut pattern for a model (made once and cached, like Blender's pre-fracture). */
  private fractureOf(visual: THREE.Object3D, key: string, ev: Pick<ShatterEvent, 'pieces' | 'quality' | 'inside' | 'outsideTexture' | 'insideTexture'>, seed: number): Fracture | null {
    let fr = this.cache.get(key);
    if (fr) return fr;
    visual.updateWorldMatrix(true, true);
    const got = collect(visual);
    if (!got) return null;
    const { outer, inner } = this.looks(ev);
    const outside = this.outerMaterials(got.materials, outer);
    // The cut faces: the chosen colour, else a darker shade of the whole object's colours (not of whichever part came first).
    const insideColor = ev.inside ? new THREE.Color(ev.inside) : inner ? new THREE.Color(0xffffff) : averageColor(got.soup, outside).multiplyScalar(0.55);
    const inside = new THREE.MeshStandardMaterial({ color: insideColor, map: inner, roughness: 0.95 });
    fr = fracture(got.soup, outside, piecesFor(ev.quality, ev.pieces), seed, inside);
    this.cache.set(key, fr);
    if (this.cache.size > 24) this.cache.delete(this.cache.keys().next().value!);
    return fr;
  }
  private bitsOf(visual: THREE.Object3D, key: string, ev: Pick<ShatterEvent, 'pieces' | 'outsideTexture'>, seed: number): BitSamples | null {
    let b = this.bitCache.get(key);
    if (b) return b;
    visual.updateWorldMatrix(true, true);
    const got = collect(visual);
    if (!got) return null;
    b = sampleSurface(got.soup, this.outerMaterials(got.materials, this.looks(ev).outer), piecesFor('low', ev.pieces), seed);
    this.bitCache.set(key, b);
    if (this.bitCache.size > 24) this.bitCache.delete(this.bitCache.keys().next().value!);
    return b;
  }
  /** Get a breakable ready while the game runs, so breaking it later costs nothing. True when it was ready. */
  prepare(visual: THREE.Object3D, key: string, ev: Pick<ShatterEvent, 'pieces' | 'quality' | 'inside' | 'outsideTexture' | 'insideTexture'>): boolean {
    if (this.cache.has(key) || this.bitCache.has(key)) return true;
    let meshes = 0; visual.traverse((o) => { if ((o as THREE.Mesh).isMesh && !o.userData.editorOnly && o.name !== 'placeholder') meshes++; });
    if (!meshes) return false; // model still loading: try again next frame
    if (ev.quality === 'low') this.bitsOf(visual, key, ev, 12345); else this.fractureOf(visual, key, ev, 12345);
    return true;
  }

  /** Low quality: bits burst off the surface in its colours. One instanced draw call, however many. */
  private burst(visual: THREE.Object3D, ev: ShatterEvent, key: string, plane2d: boolean) {
    const s = this.bitsOf(visual, key, ev, ev.seed);
    if (!s) return;
    const r = rng(ev.seed + 31), m = visual.matrixWorld, n = s.pos.length / 3;
    const scale = visual.getWorldScale(new THREE.Vector3()), unit = Math.max(Math.abs(scale.x), Math.abs(scale.y), Math.abs(scale.z)) || 1;
    const mesh = new THREE.InstancedMesh(BIT_GEO, BIT_MAT, n);
    mesh.frustumCulled = false;
    const pos = new Float32Array(n * 3), vel = new Float32Array(n * 3), size = new Float32Array(n);
    const hit = new THREE.Vector3(...ev.dir); if (hit.lengthSq() > 0) hit.normalize();
    const c = s.center.clone().applyMatrix4(m), p = new THREE.Vector3(), col = new THREE.Color();
    const box = new THREE.Box3();
    for (let i = 0; i < n; i++) {
      p.set(s.pos[i * 3], s.pos[i * 3 + 1], s.pos[i * 3 + 2]).applyMatrix4(m);
      box.expandByPoint(p);
      pos[i * 3] = p.x; pos[i * 3 + 1] = p.y; pos[i * 3 + 2] = p.z;
      const out = p.clone().sub(c); if (out.lengthSq() < 1e-8) out.set(r() - 0.5, 1, r() - 0.5); out.normalize();
      const f = ev.force * (0.5 + r() * 1.1) * 1.3;
      vel[i * 3] = out.x * f + hit.x * Math.min(ev.speed, 18) * 0.3 + (r() - 0.5);
      vel[i * 3 + 1] = out.y * f + hit.y * Math.min(ev.speed, 18) * 0.3 + ev.force * 0.5 * r();
      vel[i * 3 + 2] = plane2d ? 0 : out.z * f + hit.z * Math.min(ev.speed, 18) * 0.3 + (r() - 0.5);
      size[i] = s.size * unit * (0.6 + r() * 0.9);
      mesh.setColorAt(i, col.setRGB(s.col[i * 3], s.col[i * 3 + 1], s.col[i * 3 + 2]));
    }
    this.parent.add(mesh);
    this.bursts.push({ mesh, pos, vel, size, floor: box.min.y, age: 0, life: Math.min(ev.lifetime, 2.5), n });
    this.stepBursts(0, 0);
  }

  private stepBursts(dt: number, gravity: number) {
    const e = new THREE.Matrix4();
    this.bursts = this.bursts.filter((b) => {
      b.age += dt;
      if (b.age >= b.life) { b.mesh.removeFromParent(); b.mesh.dispose(); return false; }
      const k = Math.min(1, (b.life - b.age) / (b.life * 0.4));
      for (let i = 0; i < b.n; i++) {
        b.vel[i * 3 + 1] += gravity * dt;
        let y = b.pos[i * 3 + 1] + b.vel[i * 3 + 1] * dt;
        if (y < b.floor) { y = b.floor; b.vel[i * 3 + 1] *= -0.35; b.vel[i * 3] *= 0.7; b.vel[i * 3 + 2] *= 0.7; }
        b.pos[i * 3] += b.vel[i * 3] * dt; b.pos[i * 3 + 1] = y; b.pos[i * 3 + 2] += b.vel[i * 3 + 2] * dt;
        const s = b.size[i] * k;
        e.set(s, 0, 0, b.pos[i * 3], 0, s, 0, y, 0, 0, s, b.pos[i * 3 + 2], 0, 0, 0, 1);
        b.mesh.setMatrixAt(i, e);
      }
      b.mesh.instanceMatrix.needsUpdate = true;
      return true;
    });
  }

  shatter(visual: THREE.Object3D, ev: ShatterEvent, key: string, world: World | null, plane2d: boolean) {
    visual.updateWorldMatrix(true, true);
    if (ev.quality === 'low') { this.burst(visual, ev, key, plane2d); return; }
    const fr = this.fractureOf(visual, key, ev, ev.seed);
    if (!fr) return;
    const medium = ev.quality === 'medium';
    const r = rng(ev.seed + 17);
    const m = visual.matrixWorld;
    const origin = new THREE.Vector3(...ev.pos);
    const hit = new THREE.Vector3(...ev.dir);
    if (hit.lengthSq() > 0) hit.normalize();
    // The blow comes from the side the hitter came from (pieces fly on through), else from the middle.
    const from = origin.clone().addScaledVector(hit, -0.3);
    const q = new THREE.Quaternion(), sc = new THREE.Vector3(), tr = new THREE.Vector3();
    m.decompose(tr, q, sc);
    this.refreshSolids(origin, world);
    for (const p of fr.pieces) {
      const mesh = new THREE.Mesh(p.geo, fr.materials);
      mesh.castShadow = !medium;
      mesh.position.copy(p.center).applyMatrix4(m);
      mesh.quaternion.copy(q); mesh.scale.copy(sc);
      const out = mesh.position.clone().sub(from); if (out.lengthSq() < 1e-6) out.set(r() - 0.5, 1, r() - 0.5); out.normalize();
      const f = ev.force * (0.4 + r() * 0.9);
      const vel = out.multiplyScalar(f).addScaledVector(hit, Math.min(ev.speed, 18) * 0.35 * (0.5 + r()));
      vel.y += ev.force * 0.35 * r();
      if (plane2d) vel.z = 0;
      const axis = plane2d ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5).normalize();
      this.parent.add(mesh);
      this.pieces.push({ mesh, vel, axis, spin: (r() - 0.5) * 18, age: 0, life: ev.lifetime * (medium ? 0.6 : 1) * (0.75 + r() * 0.5), radius: p.radius * Math.max(sc.x, sc.y, sc.z), rest: 0 });
    }
    // Hard cap on live pieces: the oldest go first.
    while (this.pieces.length > 3000) this.remove(this.pieces.shift()!);
  }

  private refreshSolids(at: THREE.Vector3, world: World | null) {
    if (!world || at.distanceTo(this.solidsAt) < 8) return;
    this.solidsAt.copy(at);
    this.solids = [];
    for (const s of world.solids()) for (const b of world.aabbs(s)) {
      const box = new THREE.Box3(new THREE.Vector3(b[0], b[1], b[2]), new THREE.Vector3(b[3], b[4], b[5]));
      if (box.distanceToPoint(at) < 25) this.solids.push(box);
    }
  }

  update(dt: number, gravity: number) {
    this.stepBursts(dt, gravity);
    const keep: Piece[] = [];
    const p0 = new THREE.Vector3();
    for (const p of this.pieces) {
      p.age += dt;
      if (p.age >= p.life) { this.remove(p); continue; }
      if (p.rest < 1) {
        p.vel.y += gravity * dt;
        p0.copy(p.mesh.position);
        p.mesh.position.addScaledVector(p.vel, dt);
        p.mesh.rotateOnAxis(p.axis, p.spin * dt);
        // Bounce off Solid boxes: push out along the shallowest side and lose energy.
        const r = Math.max(0.01, p.radius * 0.6), pos = p.mesh.position;
        for (const b of this.solids) {
          if (pos.x < b.min.x - r || pos.x > b.max.x + r || pos.y < b.min.y - r || pos.y > b.max.y + r || pos.z < b.min.z - r || pos.z > b.max.z + r) continue;
          const pen = [pos.x - (b.min.x - r), b.max.x + r - pos.x, pos.y - (b.min.y - r), b.max.y + r - pos.y, pos.z - (b.min.z - r), b.max.z + r - pos.z];
          let k = 0; for (let i = 1; i < 6; i++) if (pen[i] < pen[k]) k = i;
          const ax = (['x', 'x', 'y', 'y', 'z', 'z'] as const)[k], sign = k % 2 ? 1 : -1;
          pos[ax] += sign * pen[k];
          if (sign * p.vel[ax] < 0) p.vel[ax] *= -0.32;
          if (ax === 'y' && sign > 0) { p.vel.x *= 0.82; p.vel.z *= 0.82; p.spin *= 0.8; if (Math.abs(p.vel.y) < 0.6 && p.vel.x * p.vel.x + p.vel.z * p.vel.z < 0.04) { p.rest++; p.vel.set(0, 0, 0); } }
        }
      }
      // Shrink away over the last 30% of life.
      const k = Math.min(1, (p.life - p.age) / (p.life * 0.3));
      if (k < 1) p.mesh.scale.copy(p.mesh.userData.s0 ??= p.mesh.scale.clone()).multiplyScalar(Math.max(0.001, k));
      keep.push(p);
    }
    this.pieces = keep;
  }

  private remove(p: Piece) { p.mesh.removeFromParent(); }
  clear() { for (const b of this.bursts) { b.mesh.removeFromParent(); b.mesh.dispose(); } this.bursts = []; for (const p of this.pieces) this.remove(p); this.pieces = []; this.solids = []; this.solidsAt.set(Infinity, 0, 0); }
}
