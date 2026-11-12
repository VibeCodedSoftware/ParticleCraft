// Automatic instancing (Project settings › Culling): while playing, objects that would look identical apart from their
// transform (same mesh, same material values) are drawn together in one draw call.
//
// Logic can move, hide or recolour any object at any moment, so nothing is assumed to be static: membership is worked
// out again every frame from what is really there. An object that stops matching simply goes back to drawing itself.
// The original meshes stay in the scene, on a layer no camera draws: picking, culling, bounds, children and logic see
// them exactly as before. Each group covers one area of the level, so three's frustum culling still skips what is off
// screen, in the camera's view and in each light's shadow view.
import * as THREE from 'three';

/** The layer of a mesh a batch is drawing for it. */
export const BATCHED_LAYER = 31;
const HIDDEN_MASK = (1 << BATCHED_LAYER) >>> 0; // as three stores it: unsigned
/** Size of a batch's area, in world units. */
const CELL = 16;
const FRAMES_TO_KEEP = 120;

export interface Batchable {
  uid: number; obj: THREE.Object3D; visual: THREE.Object3D;
  model?: THREE.Object3D; mixer?: unknown; proc?: unknown; pivots?: unknown; water?: unknown; camera?: unknown; displaced?: boolean;
  animMaps?: unknown[]; spriteState?: { frames: number; sheet: unknown };
}
export interface BatchOptions {
  mode2d: boolean; frustum: boolean;
  /** Why this object may not join a batch, whatever its look (an effect on its own layer, a Breakable about to be cut up…). */
  excluded?: (uid: number) => boolean;
}
export interface BatchStats { batches: number; objects: number; drawCallsSaved: number }

interface Group { key: string; mesh: THREE.InstancedMesh; last: Float64Array; count: number; idle: number; z: number }
interface Member { mesh: THREE.Mesh; sprite: boolean }

const TEXTURE_SLOTS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap', 'bumpMap', 'alphaMap', 'lightMap', 'displacementMap', 'envMap'] as const;

/** Everything about a material that shows. Two meshes with the same text look the same. */
export function materialKey(m: THREE.Material): string {
  const a = m as THREE.MeshStandardMaterial;
  const out: (string | number | boolean | undefined)[] = [m.type, m.customProgramCacheKey(), m.opacity, m.transparent, m.alphaTest, m.side, m.depthWrite, m.depthTest, a.fog, m.vertexColors, a.wireframe, a.flatShading,
    a.color?.getHex(), a.emissive?.getHex(), a.emissiveIntensity, a.roughness, a.metalness, a.normalScale?.x, a.normalScale?.y, a.bumpScale, a.aoMapIntensity, a.envMapIntensity];
  for (const s of TEXTURE_SLOTS) {
    const t = a[s] as THREE.Texture | null | undefined;
    // Sprites clone their texture to hold a frame: what counts is the picture and the part of it shown.
    if (t) out.push(s, t.source?.uuid, t.offset.x, t.offset.y, t.repeat.x, t.repeat.y, t.rotation, t.wrapS, t.wrapT, t.magFilter);
  }
  return out.join(',');
}

const shaderTiedToObject = (m: THREE.Material) => m.customProgramCacheKey().includes('craft-'); // texture sheets and random tiling work per object

// Worked out every frame for every object, so the slow parts (the shader's cache key is a long text) are remembered, and
// only looked at again when one of the values that can change while playing has changed.
interface MatMemo { version: number; values: number[]; key: string; id: number; tied: boolean }
const memo = new WeakMap<THREE.Material, MatMemo>();
const keyIds = new Map<string, number>();
let nextKeyId = 1;
const liveValues = (m: THREE.Material, out: number[]) => {
  const a = m as THREE.MeshStandardMaterial, c = a.color, e = a.emissive, t = a.map, ns = a.normalScale;
  out[0] = m.opacity; out[1] = m.transparent ? 1 : 0; out[2] = c ? c.r : -1; out[3] = c ? c.g : -1; out[4] = c ? c.b : -1;
  out[5] = e ? e.r : -1; out[6] = e ? e.g : -1; out[7] = e ? e.b : -1; out[8] = a.emissiveIntensity ?? -1; out[9] = a.roughness ?? -1; out[10] = a.metalness ?? -1;
  out[11] = m.depthWrite ? 1 : 0; out[12] = t ? t.offset.x : -1; out[13] = t ? t.offset.y : -1; out[14] = ns ? ns.x : -1; out[15] = ns ? ns.y : -1; out[16] = a.bumpScale ?? -1; out[17] = a.aoMapIntensity ?? -1;
  return out;
};
const scratch: number[] = [];
function memoOf(m: THREE.Material): MatMemo {
  let r = memo.get(m);
  liveValues(m, scratch);
  if (r && r.version === m.version) {
    let same = true;
    for (let k = 0; k < scratch.length && same; k++) same = scratch[k] === r.values[k];
    if (same) return r;
  }
  const key = materialKey(m);
  let id = keyIds.get(key);
  if (id === undefined) {
    if (keyIds.size > 20000) keyIds.clear(); // a colour animated every frame makes a new look each time
    id = nextKeyId++; keyIds.set(key, id);
  }
  r = { version: m.version, values: scratch.slice(), key, id, tied: shaderTiedToObject(m) };
  memo.set(m, r);
  return r;
}

interface KeyMemo { key: string; sprite: boolean; look: string | number; cx: number; cy: number; cz: number; shape: number; z: number; flags: number; order: number }
const keyMemo = new WeakMap<THREE.Mesh, KeyMemo>();

export class Batcher {
  stats: BatchStats = { batches: 0, objects: 0, drawCallsSaved: 0 };
  readonly root = new THREE.Group();
  private groups = new Map<string, Group>();
  private hidden = new Set<THREE.Mesh>();

  constructor() { this.root.name = 'batches'; this.root.userData.editorOnly = false; }

  /** Should this mesh draw itself? Returns its group key if it could share a draw call. */
  private keyOf(o: THREE.Mesh, e: Batchable, opts: BatchOptions): { key: string; sprite: boolean } | null {
    if (!o.isMesh || (o as THREE.SkinnedMesh).isSkinnedMesh || o.morphTargetInfluences?.length || o.userData.editorOnly || o.userData.billboard || o.name === 'placeholder') return null;
    if (o.layers.mask !== 1 && o.layers.mask !== HIDDEN_MASK) return null; // an effect has it on its own layer
    const sprite = !!e.spriteState;
    let look: string | number;
    if (Array.isArray(o.material)) {
      const ms = o.material.map(memoOf);
      if (ms.some((x) => x.tied) || (!sprite && o.material.some((m) => m.transparent))) return null;
      look = ms.map((x) => x.id).join(';');
    } else {
      const x = memoOf(o.material);
      if (x.tied || (!sprite && o.material.transparent)) return null; // see-through things are drawn back to front; 2D sprites sit on planes, so a batch can hold that order
      look = x.id;
    }
    // A mirrored object turns its faces inside out, which only works per object.
    if (!sprite && o.matrixWorld.determinant() < 0) return null;
    const w = o.matrixWorld.elements;
    const cx = Math.floor(w[12] / CELL), cy = Math.floor(w[13] / CELL), cz = opts.mode2d ? 0 : Math.floor(w[14] / CELL);
    // Sprites have a plane each, all the same; everything else shares the geometry object when the mesh is the same.
    const shape = sprite ? 0 : o.geometry.id, z = sprite ? w[14] : 0, flags = (o.castShadow ? 1 : 0) + (o.receiveShadow ? 2 : 0) + (o.customDepthMaterial ? 4 : 0);
    // The same answer as last frame, nearly always: no need to build the text again.
    const c = keyMemo.get(o);
    if (c && c.look === look && c.cx === cx && c.cy === cy && c.cz === cz && c.shape === shape && c.z === z && c.flags === flags && c.order === o.renderOrder) return c;
    const key = `${shape}|${look}|${flags}|${o.renderOrder}|${z}|${cx},${cy},${cz}`;
    const r: KeyMemo = { key, sprite, look, cx, cy, cz, shape, z, flags, order: o.renderOrder };
    keyMemo.set(o, r);
    return r;
  }

  private eligible(e: Batchable, opts: BatchOptions): boolean {
    if (e.water || e.camera || e.displaced || e.mixer || e.proc || e.pivots || e.animMaps?.length) return false;
    const u = e.visual.userData;
    if (!u.cull || u.noCull) return false;
    if (e.spriteState) { if (!opts.mode2d || e.spriteState.frames > 1) return false; }
    return !opts.excluded?.(e.uid);
  }

  private static seen(o: THREE.Object3D): boolean {
    for (let a: THREE.Object3D | null = o; a; a = a.parent) if (!a.visible) return false;
    return true;
  }

  /** Once a frame, after world matrices are up to date. */
  update(entries: Iterable<Batchable>, opts: BatchOptions) {
    const buckets = new Map<string, Member[]>();
    for (const e of entries) {
      if (!this.eligible(e, opts) || !Batcher.seen(e.visual)) continue;
      e.visual.traverse((c) => {
        const o = c as THREE.Mesh;
        if (!o.isMesh || !Batcher.seen(o)) return;
        const k = this.keyOf(o, e, opts);
        if (!k) return;
        let b = buckets.get(k.key);
        if (!b) buckets.set(k.key, (b = []));
        b.push({ mesh: o, sprite: k.sprite });
      });
    }
    const hiddenNow = new Set<THREE.Mesh>();
    let batches = 0, objects = 0;
    for (const [key, list] of buckets) {
      if (list.length < 2) continue; // nothing to share
      this.fill(key, list, opts);
      batches++; objects += list.length;
      for (const { mesh } of list) { hiddenNow.add(mesh); if (mesh.layers.mask !== HIDDEN_MASK) mesh.layers.set(BATCHED_LAYER); }
    }
    for (const o of this.hidden) if (!hiddenNow.has(o) && o.layers.mask === HIDDEN_MASK) o.layers.set(0);
    this.hidden = hiddenNow;
    for (const [key, g] of this.groups) {
      if (hiddenNow.size && buckets.get(key) && (buckets.get(key)!.length >= 2)) { g.idle = 0; continue; }
      g.mesh.visible = false; g.count = 0;
      // Kept a moment: an object stepping in and out of a group must not re-create it every time.
      if (++g.idle > FRAMES_TO_KEEP) { g.mesh.removeFromParent(); g.mesh.dispose(); this.groups.delete(key); }
    }
    this.stats = { batches, objects, drawCallsSaved: objects - batches };
  }

  private fill(key: string, list: Member[], opts: BatchOptions) {
    const first = list[0].mesh, sprite = list[0].sprite;
    let g = this.groups.get(key);
    if (!g || g.mesh.instanceMatrix.count < list.length) {
      if (g) { g.mesh.removeFromParent(); g.mesh.dispose(); }
      const capacity = Math.max(8, list.length * 2);
      const mesh = new THREE.InstancedMesh(first.geometry, first.material, capacity);
      mesh.raycast = () => undefined; // the originals are what gets clicked
      mesh.castShadow = first.castShadow; mesh.receiveShadow = first.receiveShadow; mesh.renderOrder = first.renderOrder;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.matrixAutoUpdate = false;
      // See-through sprites are sorted by the position of the object, and all of these lie at one depth.
      const z = sprite ? first.matrixWorld.elements[14] : 0;
      mesh.position.z = z; mesh.updateMatrix();
      this.root.add(mesh);
      g = { key, mesh, last: new Float64Array(capacity * 16), count: 0, idle: 0, z };
      this.groups.set(key, g);
    }
    const m = g.mesh;
    m.visible = true; g.idle = 0;
    // A member's own material and geometry: whichever member is first (the last one may have been removed).
    m.material = first.material; m.geometry = first.geometry;
    m.frustumCulled = opts.frustum;
    // Same place in draw order as the first of them, for sprites on one layer at one depth.
    let order = Infinity;
    for (const x of list) order = Math.min(order, x.mesh.id);
    m.userData.sortId = order;
    let dirty = g.count !== list.length;
    const arr = m.instanceMatrix.array as Float32Array, last = g.last;
    for (let n = 0; n < list.length; n++) {
      const w = list[n].mesh.matrixWorld.elements, at = n * 16;
      for (let k = 0; k < 16; k++) {
        const v = k === 14 ? w[k] - g.z : w[k];
        if (last[at + k] !== v) { last[at + k] = v; arr[at + k] = v; dirty = true; }
      }
    }
    if (dirty) {
      m.count = list.length; g.count = list.length;
      m.instanceMatrix.needsUpdate = true;
      m.computeBoundingSphere();
    }
  }

  /** Everything back to drawing itself (leaving play, or the setting turned off). */
  clear(dispose = false) {
    for (const o of this.hidden) if (o.layers.mask === HIDDEN_MASK) o.layers.set(0);
    this.hidden.clear();
    this.stats = { batches: 0, objects: 0, drawCallsSaved: 0 };
    if (!this.groups.size) return;
    for (const g of this.groups.values()) { g.mesh.removeFromParent(); g.mesh.dispose(); }
    this.groups.clear();
    void dispose;
  }

  get active() { return this.hidden.size > 0; }
}

/** The default transparent order, except that a batch takes the place of the first object in it. */
export function batchAwareSort(a: { groupOrder: number; renderOrder: number; z: number; id: number; object: THREE.Object3D }, b: typeof a): number {
  if (a.groupOrder !== b.groupOrder) return a.groupOrder - b.groupOrder;
  if (a.renderOrder !== b.renderOrder) return a.renderOrder - b.renderOrder;
  if (a.z !== b.z) return b.z - a.z;
  return (a.object.userData.sortId ?? a.id) - (b.object.userData.sortId ?? b.id);
}
