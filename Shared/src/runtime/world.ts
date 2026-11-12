// Runtime world: live instances created from SceneData. Engine-agnostic so both apps (and headless tests) share it.
import type { InstanceData, ObjectTypeDef, SceneData } from './scene';
import { deepClone } from '../schema';
import { platformBlocks } from './platformTypes';
import { generateVoxels, voxelBounds, voxelBoxesIn, type VoxelGrid } from './voxel';
import { hullPoints, mulMat, quatFromEuler, quatMatrix, slabBoxes, stripBoxes2D, type V3 } from './orient';

export interface RInstance extends InstanceData {
  iid: number;
  vx: number; vy: number; vz: number;
  destroyed: boolean;
  /** Per-behavior runtime state, keyed by behavior type. */
  state: Record<string, any>;
  /** Set by the renderer for sprite / mesh animation. */
  animation?: string;
  animFinished?: boolean;
}

export type AABB = [number, number, number, number, number, number];

/** Collider shapes built from slices rather than one box. */
export const isRound = (s: string) => s === 'sphere' || s === 'capsule' || s === 'cylinder' || s === 'cone';

/** Characters keep an upright collision box so turning never changes their size. */
const MOVERS = new Set(['platform', 'eightdir', 'car', 'pathfinding', 'vehicle', 'surfacewalker']);
interface Oriented { k: number[]; shape: string; bounds: AABB; boxes: AABB[] }

export class World {
  instances: RInstance[] = [];
  byUid = new Map<number, RInstance>();
  private byType = new Map<string, RInstance[]>();
  types = new Map<string, ObjectTypeDef>();
  plane: 'xy' | 'xz';
  /** Bumps whenever solids move, appear or disappear (used to invalidate pathfinding grids). */
  solidsVersion = 0;
  /** Simulation tick counter (per-tick caches key on it). */
  tick = 0;
  private uidCounter = 1;
  private pendingDestroy: RInstance[] = [];
  /** Initial instance data per type, used as the spawn template (Construct uses the first placed instance). */
  private templates = new Map<string, InstanceData>();
  onCreated?: (inst: RInstance) => void;
  onDestroyed?: (inst: RInstance) => void;

  constructor(public scene: SceneData) {
    this.plane = scene.plane;
    for (const t of scene.objectTypes) this.types.set(t.name.toLowerCase(), t);
    for (const d of scene.instances) {
      const key = d.type.toLowerCase();
      if (!this.types.has(key)) this.types.set(key, { name: d.type, kind: d.kind, vars: [] });
      if (!this.templates.has(key)) this.templates.set(key, d);
    }
    const sorted = [...scene.instances];
    for (const d of sorted) this.addInstance(deepClone(d), false);
    this.uidCounter = Math.max(0, ...scene.instances.map((i) => i.uid)) + 1;
  }

  private addInstance(d: InstanceData, fireCreated: boolean): RInstance {
    const type = this.types.get(d.type.toLowerCase());
    // Instance variables default from the type definition.
    if (type) for (const v of type.vars) if (!(v.name in d.vars)) d.vars[v.name] = deepClone(v.value);
    const list = this.listFor(d.type);
    const inst: RInstance = Object.assign(d as any, { iid: list.length, vx: 0, vy: 0, vz: 0, destroyed: false, state: {} });
    list.push(inst);
    this.instances.push(inst);
    this.byUid.set(inst.uid, inst);
    if (this.hasBehavior(inst, 'solid')) this.solidsVersion++;
    if (fireCreated) this.onCreated?.(inst);
    return inst;
  }

  listFor(type: string): RInstance[] {
    const key = type.toLowerCase();
    let l = this.byType.get(key);
    if (!l) { l = []; this.byType.set(key, l); }
    return l;
  }

  of(type: string): RInstance[] {
    return this.byType.get(type.toLowerCase())?.filter((i) => !i.destroyed) ?? [];
  }

  typeExists(type: string) { return this.types.has(type.toLowerCase()); }
  typeName(type: string) { return this.types.get(type.toLowerCase())?.name ?? type; }

  hasBehavior(inst: InstanceData, type: string) { return inst.behaviors.some((b) => b.type === type && b.props.enabled !== false); }
  behavior(inst: InstanceData, type: string) { return inst.behaviors.find((b) => b.type === type); }

  findByName(name: string): RInstance | undefined {
    const n = name.toLowerCase();
    return this.instances.find((i) => !i.destroyed && i.name.toLowerCase() === n) ?? this.of(name)[0];
  }

  spawn(type: string, x: number, y: number, z: number, from?: Partial<InstanceData>): RInstance | null {
    const key = type.toLowerCase();
    const t = this.types.get(key);
    const tpl = this.templates.get(key) ?? (t?.template ? { ...t.template, uid: 0 } as InstanceData : undefined);
    if (!tpl) return null;
    const d: InstanceData = deepClone(tpl);
    d.uid = this.uidCounter++;
    d.x = x; d.y = y; d.z = z;
    d.parent = undefined;
    if (from) Object.assign(d, deepClone(from));
    d.vars = {};
    const typeDef = this.types.get(key);
    for (const v of typeDef?.vars ?? []) d.vars[v.name] = deepClone(v.value);
    for (const k in tpl.vars) if (!(k in d.vars)) d.vars[k] = deepClone(tpl.vars[k]);
    return this.addInstance(d, true);
  }

  /** Adds an instance made at run time, from scratch rather than from a type's template (streamed terrain). */
  addRuntime(d: InstanceData): RInstance {
    const key = d.type.toLowerCase();
    if (!this.types.has(key)) this.types.set(key, { name: d.type, kind: d.kind, vars: [] });
    d.uid = this.uidCounter++;
    return this.addInstance(d, true);
  }

  destroy(inst: RInstance) {
    if (inst.destroyed) return;
    inst.destroyed = true;
    this.pendingDestroy.push(inst);
    // Children are destroyed with their parent.
    for (const c of this.instances) if (c.parent === inst.uid) this.destroy(c);
    if (this.hasBehavior(inst, 'solid')) this.solidsVersion++;
    this.onDestroyed?.(inst);
  }

  /**
   * Loading a saved game: the objects `remove` leave quietly (no On destroyed, no shattering) and the saved ones take
   * their place with their own uids. Returns the added instances (the runtime initialises their behaviors).
   */
  restore(remove: RInstance[], saved: InstanceData[]): RInstance[] {
    const gone = new Set(remove);
    this.instances = this.instances.filter((i) => !gone.has(i));
    for (const i of remove) this.byUid.delete(i.uid);
    for (const [k, l] of this.byType) this.byType.set(k, l.filter((i) => !gone.has(i)));
    this.pendingDestroy = this.pendingDestroy.filter((i) => !gone.has(i));
    const added = saved.map((d) => this.addInstance(deepClone(d), false));
    for (const l of this.byType.values()) l.forEach((i, n) => (i.iid = n));
    this.uidCounter = Math.max(this.uidCounter, ...this.instances.map((i) => i.uid + 1));
    this.solidsVersion++;
    return added;
  }

  flushDestroyed() {
    if (!this.pendingDestroy.length) return;
    const dead = new Set(this.pendingDestroy);
    this.pendingDestroy = [];
    this.instances = this.instances.filter((i) => !dead.has(i));
    for (const d of dead) this.byUid.delete(d.uid);
    for (const [k, l] of this.byType) {
      const f = l.filter((i) => !dead.has(i));
      f.forEach((i, n) => (i.iid = n));
      this.byType.set(k, f);
    }
  }

  // ---- geometry helpers ----
  angle(inst: InstanceData): number { return this.plane === 'xz' ? inst.ry : inst.rz; }
  setAngle(inst: InstanceData, a: number) {
    const n = ((a % 360) + 540) % 360 - 180;
    if (this.plane === 'xz') inst.ry = n; else inst.rz = n;
  }
  /** Forward unit vector for a heading in degrees. xz: 0° = +X, counter-clockwise seen from above. */
  forward(a: number): [number, number, number] {
    const r = (a * Math.PI) / 180;
    return this.plane === 'xz' ? [Math.cos(r), 0, -Math.sin(r)] : [Math.cos(r), Math.sin(r), 0];
  }
  /** Heading (degrees) from a to b in the world plane. */
  headingTo(ax: number, ay: number, az: number, bx: number, by: number, bz: number): number {
    return this.plane === 'xz' ? (Math.atan2(-(bz - az), bx - ax) * 180) / Math.PI : (Math.atan2(by - ay, bx - ax) * 180) / Math.PI;
  }
  /** Distance in the world plane (ignores height in 3D, depth in 2D) - matches Construct's distance(). */
  planarDistance(a: InstanceData, b: InstanceData) {
    // Children (parcels riding in a truck) are measured from where they really are.
    const [ax, ay, az] = a.parent != null ? this.worldPos(a) : [a.x, a.y, a.z];
    const [bx, by, bz] = b.parent != null ? this.worldPos(b) : [b.x, b.y, b.z];
    return this.plane === 'xz' ? Math.hypot(ax - bx, az - bz) : Math.hypot(ax - bx, ay - by);
  }

  worldPos(inst: InstanceData): [number, number, number] {
    if (inst.parent == null) return [inst.x, inst.y, inst.z];
    // On a bone: where the renderer last posed it (with no renderer, the plain parent sum below).
    const bw = inst.parentBone ? (inst as RInstance).state?.boneWorld as [number, number, number] | undefined : undefined;
    if (bw) return [bw[0], bw[1], bw[2]];
    const p = this.byUid.get(inst.parent);
    if (!p) return [inst.x, inst.y, inst.z];
    const [px, py, pz] = this.worldPos(p);
    // Parent rotation (yaw only for the logic-level position; full transforms are handled by the renderer).
    const a = (this.plane === 'xz' ? p.ry : p.rz) * Math.PI / 180;
    const c = Math.cos(a), s = Math.sin(a);
    if (this.plane === 'xz') return [px + (inst.x * c + inst.z * s) * p.sx, py + inst.y * p.sy, pz + (-inst.x * s + inst.z * c) * p.sz];
    return [px + (inst.x * c - inst.y * s) * p.sx, py + (inst.x * s + inst.y * c) * p.sy, pz + inst.z];
  }

  /** Runtime voxel grid of a voxel terrain instance (generated on first use, then edited in place). */
  voxelGrid(inst: InstanceData): VoxelGrid | null {
    if (!inst.voxel) return null;
    const st = (inst as RInstance).state;
    if (!st) return generateVoxels(inst.voxel, [inst.x, inst.y, inst.z]);
    return (st.voxelGrid ??= generateVoxels(inst.voxel, this.worldPos(inst)));
  }

  /**
   * Collision boxes in world space: one per compound box (e.g. each wall of an imported room), the solid cells of
   * voxel terrain (only those inside `region` when given), or the single collider.
   */
  aabbs(inst: InstanceData, region?: AABB): AABB[] {
    const vg = this.voxelGrid(inst);
    if (vg) return voxelBoxesIn(vg, region ?? voxelBounds(vg));
    if (this.oriented(inst)) return this.orientedShape(inst).boxes;
    const boxes = this.plane === 'xz' && inst.kind === 'tilemap' ? groundTileBoxes(inst.collider.boxes) : inst.collider.boxes;
    if (!boxes?.length) return isRound(inst.collider.shape) ? this.roundBoxes(inst) : [this.aabb(inst)];
    const [x, y, z] = inst.parent != null ? this.worldPos(inst) : [inst.x, inst.y, inst.z];
    // Yaw rotation of the instance (the ground-plane heading), applied to box centers and extents.
    const a = ((this.plane === 'xz' ? inst.ry : inst.rz) * Math.PI) / 180;
    const c = Math.cos(a), s = Math.sin(a), ac = Math.abs(c), as = Math.abs(s);
    const out: AABB[] = [];
    for (const b of boxes) {
      let cx = b[0] * inst.sx, cy = b[1] * inst.sy, cz = b[2] * inst.sz;
      let hx = Math.abs(b[3] * inst.sx) / 2, hy = Math.abs(b[4] * inst.sy) / 2, hz = Math.abs(b[5] * inst.sz) / 2;
      if (a) {
        if (this.plane === 'xz') { const nx = cx * c + cz * s, nz = -cx * s + cz * c; cx = nx; cz = nz; const nhx = hx * ac + hz * as, nhz = hx * as + hz * ac; hx = nhx; hz = nhz; }
        else { const nx = cx * c - cy * s, ny = cx * s + cy * c; cx = nx; cy = ny; const nhx = hx * ac + hy * as, nhy = hx * as + hy * ac; hx = nhx; hy = nhy; }
      }
      out.push([x + cx - hx, y + cy - hy, z + cz - hz, x + cx + hx, y + cy + hy, z + cz + hz]);
    }
    return out;
  }

  aabb(inst: InstanceData): AABB {
    const vg = this.voxelGrid(inst);
    if (vg) return voxelBounds(vg);
    if (this.oriented(inst)) return [...this.orientedShape(inst).bounds] as AABB;
    if (inst.collider.boxes?.length) {
      const all = this.aabbs(inst);
      const u: AABB = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
      for (const b of all) for (let k = 0; k < 3; k++) { u[k] = Math.min(u[k], b[k]); u[k + 3] = Math.max(u[k + 3], b[k + 3]); }
      return u;
    }
    const [x, y, z] = inst.parent != null ? this.worldPos(inst) : [inst.x, inst.y, inst.z];
    const c = inst.collider;
    let hx = Math.abs(c.size[0] * inst.sx) / 2, hy = Math.abs(c.size[1] * inst.sy) / 2, hz = Math.abs(c.size[2] * inst.sz) / 2;
    const ox = c.offset[0] * inst.sx, oy = c.offset[1] * inst.sy, oz = c.offset[2] * inst.sz;
    // Ramps are static wedges: their bounds follow their yaw (other movers keep an unrotated box so turning
    // never changes their collision size).
    if (inst.kind === 'ramp' && this.plane === 'xz' && inst.ry) {
      const a = (inst.ry * Math.PI) / 180, ac = Math.abs(Math.cos(a)), as = Math.abs(Math.sin(a));
      const nhx = hx * ac + hz * as, nhz = hx * as + hz * ac; hx = nhx; hz = nhz;
    }
    return [x + ox - hx, y + oy - hy, z + oz - hz, x + ox + hx, y + oy + hy, z + oz + hz];
  }

  private orientCache = new WeakMap<InstanceData, Oriented>();
  /**
   * Whether a collider follows its full rotation (a tilted plank, a tumbling crate, a door turned 90°): any rotated
   * box, or a round shape tilted off upright. Characters (Platform, 8 Direction, Car…) keep an upright box.
   */
  oriented(inst: InstanceData): boolean {
    const c = inst.collider;
    if (c.shape === 'none' || c.boxes?.length || inst.voxel || inst.kind === 'ramp' || inst.kind === 'tilemap') return false;
    if (this.plane === 'xz') { if (c.shape === 'sphere' || (!inst.rx && !inst.rz && (!inst.ry || isRound(c.shape)))) return false; }
    else if (!inst.rz || c.shape === 'sphere') return false;
    return !inst.behaviors?.some((b) => MOVERS.has(b.type));
  }
  /** Oriented collider as slab boxes (cached until the transform or collider changes). */
  private orientedShape(inst: InstanceData): Oriented {
    const [x, y, z] = inst.parent != null ? this.worldPos(inst) : [inst.x, inst.y, inst.z];
    const c = inst.collider;
    const k = [x, y, z, inst.rx, inst.ry, inst.rz, inst.sx, inst.sy, inst.sz, ...c.size, ...c.offset];
    const hit = this.orientCache.get(inst);
    if (hit && hit.shape === c.shape && hit.k.every((v, n) => v === k[n])) return hit;
    const hx = Math.abs(c.size[0] * inst.sx) / 2, hy = Math.abs(c.size[1] * inst.sy) / 2, hz = Math.abs(c.size[2] * inst.sz) / 2;
    const off: V3 = [c.offset[0] * inst.sx, c.offset[1] * inst.sy, c.offset[2] * inst.sz];
    let boxes: AABB[];
    if (this.plane === 'xz') {
      const m = quatMatrix(quatFromEuler(inst.rx, inst.ry, inst.rz));
      const shape = isRound(c.shape) ? c.shape : 'box';
      const pts = hullPoints(shape, hx, hy, hz, 12).map((p) => { const r = mulMat(m, [p[0] + off[0], p[1] + off[1], p[2] + off[2]]); return [x + r[0], y + r[1], z + r[2]] as V3; });
      const tilted = !!(inst.rx || inst.rz);
      // Tilted: slabs about 4 cm tall (6–24) so a sloped top is a fine staircase, not 13 cm steps that shift under
      // a character's feet as a raft rocks.
      let y0 = Infinity, y1 = -Infinity; for (const q of pts) { y0 = Math.min(y0, q[1]); y1 = Math.max(y1, q[1]); }
      const fine = Math.max(6, Math.min(24, Math.ceil((y1 - y0) / 0.04)));
      boxes = slabBoxes(pts, shape === 'box' ? (tilted ? fine : 1) : Math.max(8, Math.min(16, fine)));
    } else {
      const a = (inst.rz * Math.PI) / 180, cs = Math.cos(a), sn = Math.sin(a);
      const loc: [number, number][] = c.shape === 'cone' ? [[-hx, -hy], [hx, -hy], [0, hy]] : [[-hx, -hy], [hx, -hy], [hx, hy], [-hx, hy]];
      boxes = stripBoxes2D(loc.map(([u, v]) => { const px = u + off[0], py = v + off[1]; return [x + px * cs - py * sn, y + px * sn + py * cs] as [number, number]; }), z + off[2] - hz, z + off[2] + hz);
    }
    const bounds: AABB = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    for (const b of boxes) for (let n = 0; n < 3; n++) { bounds[n] = Math.min(bounds[n], b[n]); bounds[n + 3] = Math.max(bounds[n + 3], b[n + 3]); }
    if (!boxes.length) { const u: AABB = [x + off[0] - hx, y + off[1] - hy, z + off[2] - hz, x + off[0] + hx, y + off[1] + hy, z + off[2] + hz]; boxes = [u]; bounds.splice(0, 6, ...u); }
    const out = { k, shape: c.shape, bounds, boxes };
    this.orientCache.set(inst, out);
    return out;
  }

  /**
   * Sphere / capsule / cylinder / cone as boxes the AABB solver understands: horizontal slices following the
   * shape's profile, each made of two crossed boxes so the footprint is round in every direction (in 2D, one box
   * per slice). The overall bounds stay `aabb()`.
   */
  roundBoxes(inst: InstanceData): AABB[] {
    const [x0, y0, z0, x1, y1, z1] = this.aabb(inst);
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, rx = (x1 - x0) / 2, rz = (z1 - z0) / 2, h = y1 - y0;
    const shape = inst.collider.shape, N = 8, out: AABB[] = [];
    const flat = this.plane === 'xy';
    // Radius factor (0..1) at height fraction t (0 = bottom, 1 = top).
    const prof = (t: number) => {
      if (shape === 'cylinder') return 1;
      if (shape === 'cone') return Math.max(0.05, 1 - t);
      if (shape === 'sphere') return Math.sqrt(Math.max(0, 1 - (2 * t - 1) ** 2));
      // capsule: hemispheres of radius = half width at both ends
      const capH = Math.min(0.5, rx / Math.max(h, 1e-6));
      if (t < capH) { const u = 1 - t / capH; return Math.sqrt(Math.max(0, 1 - u * u)); }
      if (t > 1 - capH) { const u = (t - (1 - capH)) / capH; return Math.sqrt(Math.max(0, 1 - u * u)); }
      return 1;
    };
    for (let k = 0; k < N; k++) {
      const ta = k / N, tb = (k + 1) / N;
      // The slice is as wide as the shape is anywhere inside it (never smaller than the real shape).
      const f = Math.max(prof(ta), prof(tb), prof((ta + tb) / 2));
      if (f <= 0.001) continue;
      const ya = y0 + ta * h, yb = y0 + tb * h;
      if (flat) { out.push([cx - rx * f, ya, z0, cx + rx * f, yb, z1]); continue; }
      out.push([cx - rx * f, ya, cz - rz * f * 0.72, cx + rx * f, yb, cz + rz * f * 0.72]);
      out.push([cx - rx * f * 0.72, ya, cz - rz * f, cx + rx * f * 0.72, yb, cz + rz * f]);
    }
    return out.length ? out : [this.aabb(inst)];
  }

  /** Whether two colliders' layers and masks let them collide. */
  layersCollide(a: InstanceData, b: InstanceData): boolean {
    const la = a.collider.layer ?? 0, lb = b.collider.layer ?? 0;
    return (((a.collider.mask ?? 0xff) >> lb) & 1) === 1 && (((b.collider.mask ?? 0xff) >> la) & 1) === 1;
  }

  /**
   * Ramp (wedge) collider: solid only below its sloped top. The wedge rises toward local -Z (its tall back
   * face), is yawed by `ry`, and spans the instance's scale. Returns null for anything that is not a ramp.
   * Only the 3D ground plane has ramps; in 2D they keep their box collider.
   */
  slope(inst: InstanceData): { grad: number; surface: (b: AABB) => number; downhill: [number, number] } | null {
    if (inst.kind !== 'ramp' || this.plane !== 'xz' || inst.collider.shape === 'none' || inst.collider.boxes?.length || inst.voxel) return null;
    const [x, y, z] = inst.parent != null ? this.worldPos(inst) : [inst.x, inst.y, inst.z];
    const sx = Math.abs(inst.sx) || 1e-6, sy = Math.abs(inst.sy), sz = Math.abs(inst.sz) || 1e-6;
    const a = (inst.ry * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
    // World (dx, dz) → local (lx, lz) is the inverse of three.js' Y rotation.
    const toLocal = (px: number, pz: number) => { const dx = px - x, dz = pz - z; return [dx * c - dz * s, dx * s + dz * c]; };
    const bottom = y - sy / 2;
    return {
      grad: sy / sz,
      // Highest point of the slope under a footprint (its corners clamped into the ramp's rectangle).
      surface: (b) => {
        let t = 0;
        for (const [px, pz] of [[b[0], b[2]], [b[3], b[2]], [b[0], b[5]], [b[3], b[5]]]) {
          const [, lz] = toLocal(px, pz);
          const u = Math.max(-0.5, Math.min(0.5, lz / sz));
          t = Math.max(t, 0.5 - u);
        }
        return bottom + t * sy;
      },
      // Unit direction (world x, z) pointing down the slope (local +Z).
      downhill: [s, c],
    };
  }

  /** Solid blockers that `mover` can bump into (respecting collision layers). */
  blockersFor(mover: RInstance): RInstance[] {
    // Platform types decide per mover (one-way from above, pass-through for characters, toggles).
    return this.solids().filter((s) => s !== mover && !s.collider.nonBlocking && this.layersCollide(mover, s) && (!this.hasBehavior(s, 'platformtype') || platformBlocks(this, s, mover)));
  }

  solids(): RInstance[] {
    // A toggle platform switched off is not solid for anything.
    return this.instances.filter((i) => !i.destroyed && i.collider.shape !== 'none' && !i.collider.isTrigger && this.hasBehavior(i, 'solid') && i.state.platformType?.on !== false);
  }

  overlapping(a: RInstance, b: RInstance): boolean {
    if (a === b || a.destroyed || b.destroyed) return false;
    if (a.collider.shape === 'none' || b.collider.shape === 'none') return false;
    const compound = (i: RInstance) => !!(i.collider.boxes?.length || i.voxel || isRound(i.collider.shape) || this.oriented(i));
    if (!compound(a) && !compound(b)) return aabbOverlap(this.aabb(a), this.aabb(b));
    if (!aabbOverlap(this.aabb(a), this.aabb(b))) return false;
    // Voxel terrain only needs the cells near the other object.
    const A = this.aabbs(a, b.voxel ? undefined : this.aabb(b)), B = this.aabbs(b, this.aabb(a));
    return A.some((x) => B.some((y) => aabbOverlap(x, y)));
  }
}

/**
 * A 3D tilemap lies flat on the ground (map up = -Z): its map-space boxes (x, y, depth) become slabs whose top is
 * the object's height.
 */
const groundBoxes = new WeakMap<number[][], number[][]>();
function groundTileBoxes(boxes: number[][] | undefined): number[][] | undefined {
  if (!boxes?.length) return boxes;
  let g = groundBoxes.get(boxes);
  if (!g) { g = boxes.map((b) => [b[0], -b[5] / 2, -b[1], b[3], b[5], b[4]]); groundBoxes.set(boxes, g); }
  return g;
}

export function aabbOverlap(a: AABB, b: AABB, eps = 1e-6): boolean {
  return a[0] < b[3] - eps && a[3] > b[0] + eps && a[1] < b[4] - eps && a[4] > b[1] + eps && a[2] < b[5] - eps && a[5] > b[2] + eps;
}
