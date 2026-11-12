// Boolean (like Blender's Boolean modifier): an object's mesh cut by (Difference), joined with (Union) or kept only
// where it overlaps (Intersect) other objects, and holes cut while playing (bullets, explosions, a door sawn into a
// wall). The renderer does the mesh work (GameCraft/src/engine/booleanMesh.ts, three-bvh-csg); this module keeps the
// data and the collision: a box wall with box-shaped cuts gets compound collision boxes around the holes, so you can
// walk through a cut doorway. Other shapes keep their collision (the cut is visual).
import type { InstanceData } from './scene';
import type { RInstance, World } from './world';

export type BooleanOpKind = 'difference' | 'union' | 'intersect';
export interface BooleanOp { /** The other object (its uid). */ with: number; op: BooleanOpKind }
export type CutShape = 'sphere' | 'box' | 'cylinder';
/** A hole cut while playing, in the object's own (unscaled, unrotated) units, so it moves with the object. */
export interface Cut { shape: CutShape; center: [number, number, number]; size: [number, number, number] }

/** How many holes an object keeps (the oldest are filled back in), so shooting a wall forever stays fast. */
export const MAX_CUTS = 48;

/** A world point → the object's own units (its heading undone, then its scale; same as the renderer's object space). */
export function toLocal(w: World, inst: InstanceData, point: [number, number, number]): [number, number, number] {
  const [x, y, z] = inst.parent != null ? w.worldPos(inst) : [inst.x, inst.y, inst.z];
  let dx = point[0] - x, dy = point[1] - y, dz = point[2] - z;
  const a = (-(w.plane === 'xz' ? inst.ry : inst.rz) * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  if (w.plane === 'xz') { const nx = dx * c + dz * s, nz = -dx * s + dz * c; dx = nx; dz = nz; }
  else { const nx = dx * c - dy * s, ny = dx * s + dy * c; dx = nx; dy = ny; }
  return [dx / (inst.sx || 1), dy / (inst.sy || 1), dz / (inst.sz || 1)];
}

/** Cut a hole in an object while playing (world point, size in metres). */
export function cutHole(w: World, inst: RInstance, shape: CutShape, point: [number, number, number], size: [number, number, number]) {
  const center = toLocal(w, inst, point);
  const local: [number, number, number] = [Math.abs(size[0] / (inst.sx || 1)), Math.abs(size[1] / (inst.sy || 1)), Math.abs(size[2] / (inst.sz || 1))];
  const cuts = ((inst.state.cuts ??= []) as Cut[]);
  cuts.push({ shape, center, size: local });
  if (cuts.length > MAX_CUTS) cuts.splice(0, cuts.length - MAX_CUTS);
  inst.state.cutsVersion = (inst.state.cutsVersion ?? 0) + 1;
  updateBooleanCollision(w, inst);
}

type Box = [number, number, number, number, number, number]; // min x y z, max x y z

/** `base` minus every hole: the leftover as boxes (split along the hole's faces). Capped so it stays cheap. */
export function subtractBoxes(base: Box, holes: Box[], max = 160): Box[] {
  let parts: Box[] = [base];
  for (const h of holes) {
    const next: Box[] = [];
    for (const p of parts) {
      if (h[0] >= p[3] || h[3] <= p[0] || h[1] >= p[4] || h[4] <= p[1] || h[2] >= p[5] || h[5] <= p[2]) { next.push(p); continue; }
      const q: Box = [...p];
      // Slabs outside the hole on each axis, then shrink to the overlap.
      for (let ax = 0; ax < 3; ax++) {
        if (h[ax] > q[ax]) { const s: Box = [...q]; s[ax + 3] = h[ax]; next.push(s); q[ax] = h[ax]; }
        if (h[ax + 3] < q[ax + 3]) { const s: Box = [...q]; s[ax] = h[ax + 3]; next.push(s); q[ax + 3] = h[ax + 3]; }
      }
    }
    parts = next;
    if (parts.length > max) return parts; // enough detail: later holes stay solid
  }
  return parts;
}

const boxOf = (c: [number, number, number], s: [number, number, number]): Box => [c[0] - s[0] / 2, c[1] - s[1] / 2, c[2] - s[2] / 2, c[0] + s[0] / 2, c[1] + s[1] / 2, c[2] + s[2] / 2];

/**
 * Collision after the cuts: for a box-collider object (a wall, a floor), the collider becomes the boxes left around
 * box-shaped holes (Difference with box cutters, cuts while playing — round holes count as their square). Union /
 * Intersect and other collider shapes keep their collision.
 */
export function updateBooleanCollision(w: World, inst: RInstance) {
  const col = inst.collider;
  const base0 = (inst.state.boolBase ??= { size: col.size, offset: col.offset, boxes: col.boxes }) as { size: [number, number, number]; offset: [number, number, number]; boxes?: number[][] };
  if (col.shape !== 'box' || base0.boxes?.length) return;
  const holes: Box[] = [];
  for (const op of inst.boolean?.ops ?? []) {
    if (op.op !== 'difference') continue;
    const cutter = w.byUid.get(op.with);
    if (!cutter || cutter === inst) continue;
    const bb = w.aabb(cutter), size: [number, number, number] = [bb[3] - bb[0], bb[4] - bb[1], bb[5] - bb[2]];
    const center = toLocal(w, inst, [(bb[0] + bb[3]) / 2, (bb[1] + bb[4]) / 2, (bb[2] + bb[5]) / 2]);
    holes.push(boxOf(center, [Math.abs(size[0] / (inst.sx || 1)), Math.abs(size[1] / (inst.sy || 1)), Math.abs(size[2] / (inst.sz || 1))]));
  }
  for (const c of (inst.state.cuts ?? []) as Cut[]) holes.push(boxOf(c.center, c.size));
  if (!holes.length) return;
  const base = boxOf(base0.offset, base0.size);
  const parts = subtractBoxes(base, holes);
  inst.collider = { ...col, boxes: parts.map((p) => [(p[0] + p[3]) / 2, (p[1] + p[4]) / 2, (p[2] + p[5]) / 2, p[3] - p[0], p[4] - p[1], p[5] - p[2]]) };
  w.solidsVersion++;
}

/** Objects used as cutters by a Boolean: hidden and non-blocking while playing (they only shape the other mesh). */
export function cutterUids(insts: InstanceData[]): Set<number> {
  const out = new Set<number>();
  for (const i of insts) for (const op of i.boolean?.ops ?? []) if (i.boolean?.hideCutters !== false) out.add(op.with);
  return out;
}
