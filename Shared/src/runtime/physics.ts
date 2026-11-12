// Deterministic AABB collision and kinematics. Chosen over a general rigid-body engine so the exact same
// results can be reproduced in GameCraft, LogicCraft and headless conformance tests (see docs/ADR-001).
import { aabbOverlap, isRound, type AABB, type RInstance, type World } from './world';
import { voxelRaycast } from './voxel';

export interface Hit { axis: 0 | 1 | 2; sign: number; other: RInstance }

const EPS = 1e-4;

/**
 * Move an instance by (dx, dy, dz), resolving collisions against `blockers` one axis at a time.
 * `stepHeight` > 0 lets a grounded character walk up ledges up to that height (stairs, curbs) instead of stopping.
 */
export function moveAndCollide(world: World, inst: RInstance, dx: number, dy: number, dz: number, blockers: RInstance[], stepHeight = 0): Hit[] {
  const hits: Hit[] = [];
  const box = world.aabb(inst);
  const minHalf = Math.max(0.05, Math.min(box[3] - box[0], box[4] - box[1], box[5] - box[2]) / 2);
  const steps = Math.min(16, Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) / minHalf)));
  const others = blockers.filter((b) => b !== inst && !b.destroyed);
  depenetrate(world, inst, others, hits);
  for (let s = 0; s < steps; s++) {
    // Vertical first so standing characters are grounded before sliding horizontally.
    stepAxis(world, inst, 1, dy / steps, others, hits, 0);
    const grounded = stepHeight > 0 && hits.some((h) => h.axis === 1 && h.sign < 0);
    stepAxis(world, inst, 0, dx / steps, others, hits, grounded ? stepHeight : 0);
    stepAxis(world, inst, 2, dz / steps, others, hits, grounded ? stepHeight : 0);
  }
  return hits;
}

function boxesOf(world: World, o: RInstance, me: AABB): AABB[] {
  // A ramp blocks only below its slope: its box is cut down to the slope height under the mover's footprint.
  const sl = world.slope(o);
  if (sl) { const b = world.aabb(o); return [[b[0], b[1], b[2], b[3], Math.min(b[4], sl.surface(me)), b[5]]]; }
  // Compound colliders (imported rooms) are tested box by box; the bounding box rejects far ones cheaply.
  // Voxel terrain only yields the cells around the mover.
  return o.voxel ? world.aabbs(o, [me[0] - 0.01, me[1] - 0.01, me[2] - 0.01, me[3] + 0.01, me[4] + 0.01, me[5] + 0.01])
    : o.collider.boxes?.length || isRound(o.collider.shape) || world.oriented(o) ?(aabbOverlap(me, world.aabb(o)) ? world.aabbs(o) : []) : [world.aabb(o)];
}

/**
 * Something moved into the mover (a pushed or tumbling body, a platform): leave it the shortest way that does not
 * end inside something else — up, sideways, or down only when it is mostly below what it overlaps — at most 1 m a
 * frame. Without this the axis steps "resolved" such overlaps along their own direction: a jump next to a crate
 * shoved into the character pushed it down through the floor.
 */
function depenetrate(world: World, inst: RInstance, others: RInstance[], hits: Hit[]) {
  for (let iter = 0; iter < 4; iter++) {
    const me = world.aabb(inst);
    // Everything of the first object found overlapping, as one box (a tilted raft or a rotated crate is several
    // slab boxes: leaving one of them only to land in the next is no way out).
    let ob: AABB | null = null, by: RInstance | null = null;
    for (const o of others) {
      by = o;
      for (const b of boxesOf(world, o, me)) if (aabbOverlap(me, b)) ob = ob ? [Math.min(ob[0], b[0]), Math.min(ob[1], b[1]), Math.min(ob[2], b[2]), Math.max(ob[3], b[3]), Math.max(ob[4], b[4]), Math.max(ob[5], b[5])] : [...b] as AABB;
      if (ob) break;
    }
    if (!ob) return;
    const cands: [0 | 1 | 2, number][] = [[1, ob[4] - me[1] + EPS], [0, ob[3] - me[0] + EPS], [0, -(me[3] - ob[0] + EPS)], [2, ob[5] - me[2] + EPS], [2, -(me[5] - ob[2] + EPS)]];
    if ((me[1] + me[4]) / 2 < (ob[1] + ob[4]) / 2) cands.push([1, -(me[4] - ob[1] + EPS)]);
    if (world.plane === 'xy') for (let k = cands.length - 1; k >= 0; k--) if (cands[k][0] === 2) cands.splice(k, 1);
    cands.sort((a, b) => Math.abs(a[1]) - Math.abs(b[1]));
    let moved = false;
    for (const [axis, amt] of cands) {
      if (Math.abs(amt) > 1) break;
      const t: AABB = [...me] as AABB; t[axis] += amt; t[axis + 3] += amt;
      if (others.some((o) => boxesOf(world, o, t).some((b) => aabbOverlap(t, b)))) continue;
      const key = axis === 0 ? 'x' : axis === 1 ? 'y' : 'z';
      (inst as any)[key] += amt; moved = true;
      // Lifted out of what rose into it (a bobbing raft, a lift): that is standing on it.
      if (axis === 1 && amt > 0 && by) hits.push({ axis: 1, sign: -1, other: by });
      break;
    }
    if (!moved) return; // wedged: leave it to the axis steps rather than teleporting
  }
}

function stepAxis(world: World, inst: RInstance, axis: 0 | 1 | 2, d: number, others: RInstance[], hits: Hit[], stepHeight: number) {
  if (d === 0) return;
  const key = axis === 0 ? 'x' : axis === 1 ? 'y' : 'z';
  // Overlaps that were there before this step are not this step's to resolve (see depenetrate).
  const before = world.aabb(inst);
  (inst as any)[key] += d;
  const me = world.aabb(inst);
  // Step up: if everything we bumped into is a low ledge with free space above it, climb onto it.
  // Moving along a ramp climbs its slope (by as much as the slope rises over this step), for any mover.
  if (axis !== 1) {
    let rise = 0, blocked = false;
    for (const o of others) {
      const sl = world.slope(o);
      const limit = sl ? Math.max(stepHeight, Math.abs(d) * sl.grad * 1.5 + 0.02) : stepHeight;
      for (const ob of boxesOf(world, o, me)) {
        if (!aabbOverlap(me, ob)) continue;
        const up = ob[4] - me[1];
        if (up > 0 && up <= limit) rise = Math.max(rise, up + EPS); else blocked = true;
      }
    }
    if (rise > 0 && !blocked) {
      const raised: AABB = [me[0], me[1] + rise, me[2], me[3], me[4] + rise, me[5]];
      const free = others.every((o) => boxesOf(world, o, raised).every((ob) => !aabbOverlap(raised, ob)));
      if (free) { inst.y += rise; return; }
    }
  }
  for (const o of others) {
    if (boxesOf(world, o, before).some((ob) => aabbOverlap(before, ob))) continue; // wedged already: never fling
    const boxes = boxesOf(world, o, me);
    let hit = false;
    for (const ob of boxes) {
      if (!aabbOverlap(me, ob)) continue;
      if (d > 0) (inst as any)[key] -= me[axis + 3] - ob[axis] + EPS;
      else (inst as any)[key] += ob[axis + 3] - me[axis] + EPS;
      hit = true;
      me.splice(0, 6, ...world.aabb(inst));
    }
    if (hit) hits.push({ axis, sign: Math.sign(d), other: o });
  }
}

export interface RayHit { inst: RInstance; dist: number; point: [number, number, number]; normal: [number, number, number] }

/** Ray against instance AABBs (slab method). `dir` need not be normalized. */
export function raycast(world: World, origin: [number, number, number], dir: [number, number, number], maxDist: number, candidates: RInstance[], ignore?: RInstance): RayHit | null {
  const len = Math.hypot(dir[0], dir[1], dir[2]) || 1;
  const d = [dir[0] / len, dir[1] / len, dir[2] / len];
  let best: RayHit | null = null;
  for (const c of candidates) {
    if (c === ignore || c.destroyed || c.collider.shape === 'none') continue;
    const vg = world.voxelGrid(c);
    if (vg) {
      const h = voxelRaycast(vg, origin, d as [number, number, number], maxDist);
      if (h && (!best || h.dist < best.dist)) best = { inst: c, dist: h.dist, point: h.point, normal: h.normal };
      continue;
    }
    if (c.collider.boxes?.length && !rayAabb(origin, d, world.aabb(c))) continue;
    for (const b of world.aabbs(c)) {
      const r = rayAabb(origin, d, b);
      if (r && r.t <= maxDist && (!best || r.t < best.dist)) {
        best = { inst: c, dist: r.t, point: [origin[0] + d[0] * r.t, origin[1] + d[1] * r.t, origin[2] + d[2] * r.t], normal: r.n };
      }
    }
  }
  return best;
}

export function rayAabb(o: number[], d: number[], b: AABB): { t: number; n: [number, number, number] } | null {
  let tmin = -Infinity, tmax = Infinity;
  let n: [number, number, number] = [0, 0, 0];
  for (let a = 0; a < 3; a++) {
    if (Math.abs(d[a]) < 1e-9) {
      if (o[a] < b[a] || o[a] > b[a + 3]) return null;
      continue;
    }
    let t1 = (b[a] - o[a]) / d[a];
    let t2 = (b[a + 3] - o[a]) / d[a];
    if (t1 > t2) [t1, t2] = [t2, t1];
    if (t1 > tmin) { tmin = t1; n = [0, 0, 0]; n[a] = d[a] > 0 ? -1 : 1; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  if (tmax < 0) return null;
  return { t: Math.max(0, tmin), n };
}

/** Resolve overlaps between dynamic physics bodies with an impulse along the axis of least penetration. */
export function resolveBodies(world: World, bodies: RInstance[], massOf: (i: RInstance) => number, bounceOf: (i: RInstance) => number) {
  for (let i = 0; i < bodies.length; i++) {
    for (let j = i + 1; j < bodies.length; j++) {
      const a = bodies[i], b = bodies[j];
      if (a.destroyed || b.destroyed) continue;
      // Dynamic (non-blocking) objects and layer masks let bodies pass through each other.
      if (a.collider.nonBlocking || b.collider.nonBlocking || a.collider.isTrigger || b.collider.isTrigger || !world.layersCollide(a, b)) continue;
      const A = world.aabb(a), B = world.aabb(b);
      if (!aabbOverlap(A, B)) continue;
      const pen = [Math.min(A[3] - B[0], B[3] - A[0]), Math.min(A[4] - B[1], B[4] - A[1]), Math.min(A[5] - B[2], B[5] - A[2])];
      let axis = 0; if (pen[1] < pen[axis]) axis = 1; if (pen[2] < pen[axis]) axis = 2;
      const ca = (A[axis] + A[axis + 3]) / 2, cb = (B[axis] + B[axis + 3]) / 2;
      const dir = ca < cb ? -1 : 1; // direction to push a
      const ma = massOf(a), mb = massOf(b);
      const ia = ma <= 0 ? 0 : 1 / ma, ib = mb <= 0 ? 0 : 1 / mb;
      if (ia + ib === 0) continue;
      const key = axis === 0 ? 'x' : axis === 1 ? 'y' : 'z';
      const vkey = axis === 0 ? 'vx' : axis === 1 ? 'vy' : 'vz';
      const corr = pen[axis] + EPS;
      (a as any)[key] += dir * corr * (ia / (ia + ib));
      (b as any)[key] -= dir * corr * (ib / (ia + ib));
      const rel = (a as any)[vkey] - (b as any)[vkey];
      if (rel * dir < 0) {
        const e = Math.min(bounceOf(a), bounceOf(b));
        const jImp = (-(1 + e) * rel) / (ia + ib);
        (a as any)[vkey] += jImp * ia;
        (b as any)[vkey] -= jImp * ib;
      }
    }
  }
}
