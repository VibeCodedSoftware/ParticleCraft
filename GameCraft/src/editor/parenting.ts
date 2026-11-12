// Parenting that keeps where things are: an object's local transform (position, rotation, scale under its parent)
// recomputed so its world position, rotation and size stay the same when it gets a new parent or loses one. The
// viewport composes transforms like three.js (rotation order YXZ), so this uses the same maths.
import * as THREE from 'three';
import type { InstanceData, SceneData } from '@shared/src/runtime/scene';

const RAD = Math.PI / 180;
/** Rounded (and no −0) so values in the Inspector read cleanly. */
const tidy = (n: number, k = 1e5) => { const r = Math.round(n * k) / k; return r === 0 ? 0 : r; };

export function localMatrix(i: InstanceData): THREE.Matrix4 {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(i.rx * RAD, i.ry * RAD, i.rz * RAD, 'YXZ'));
  return new THREE.Matrix4().compose(new THREE.Vector3(i.x, i.y, i.z), q, new THREE.Vector3(i.sx, i.sy, i.sz));
}

/** Where a bone is posed now, in its owner's space (the viewport sets this; without it a bone counts as the owner). */
export const boneSockets: { at: ((owner: number, bone: string) => THREE.Matrix4 | null) | null } = { at: null };

export function worldMatrix(s: SceneData, i: InstanceData, seen = new Set<number>()): THREE.Matrix4 {
  const m = localMatrix(i);
  if (i.parent == null || seen.has(i.uid)) return m;
  seen.add(i.uid);
  const p = s.instances.find((x) => x.uid === i.parent);
  if (!p) return m;
  const w = worldMatrix(s, p, seen), socket = i.parentBone ? boneSockets.at?.(p.uid, i.parentBone) : null;
  return (socket ? w.multiply(socket) : w).multiply(m);
}

/** Is `a` inside `b`'s hierarchy (b itself, a child, a grandchild…)? */
export function isWithin(s: SceneData, a: InstanceData, b: number): boolean {
  let cur: InstanceData | undefined = a;
  for (let n = 0; cur && n < 1000; n++) { if (cur.uid === b) return true; cur = cur.parent != null ? s.instances.find((x) => x.uid === cur!.parent) : undefined; }
  return false;
}

/**
 * Give `children` the parent `parentUid` (null = none), keeping each one's world transform. Children that would
 * create a loop (the parent is inside them) are skipped. Returns how many were changed. A rotated child under a
 * parent scaled unevenly (2 × 1 × 1) would need a slant that position / rotation / scale cannot hold: its position
 * stays exact and its rotation and size are the closest fit (counted in `approx`).
 */
export function reparent(s: SceneData, childUids: number[], parentUid: number | null, approx?: { count: number }, bone?: string): number {
  const par = parentUid == null ? null : s.instances.find((i) => i.uid === parentUid) ?? null;
  const items = s.instances.filter((i) => childUids.includes(i.uid) && i.uid !== parentUid && !(par && isWithin(s, par, i.uid)));
  // All world transforms first: moving one child must not change another's (a child of a child in the selection).
  const worlds = new Map(items.map((i) => [i.uid, worldMatrix(s, i)]));
  const socket = par && bone ? boneSockets.at?.(par.uid, bone) : null;
  const inv = par ? (socket ? worldMatrix(s, par).multiply(socket) : worldMatrix(s, par)).invert() : new THREE.Matrix4();
  let changed = 0;
  for (const i of items) {
    if ((i.parent ?? null) === (par?.uid ?? null) && (i.parentBone ?? null) === (bone ?? null)) continue;
    const local = inv.clone().multiply(worlds.get(i.uid)!);
    const p = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
    local.decompose(p, q, sc);
    const e = new THREE.Euler().setFromQuaternion(q, 'YXZ');
    i.parent = par?.uid;
    if (bone && par) i.parentBone = bone; else delete i.parentBone;
    i.x = tidy(p.x); i.y = tidy(p.y); i.z = tidy(p.z);
    i.rx = tidy(e.x / RAD); i.ry = tidy(e.y / RAD); i.rz = tidy(e.z / RAD);
    i.sx = tidy(sc.x); i.sy = tidy(sc.y); i.sz = tidy(sc.z);
    if (approx) { const w = worldMatrix(s, i).elements, want = worlds.get(i.uid)!.elements; if (w.some((x, k) => Math.abs(x - want[k]) > 1e-3)) approx.count++; }
    changed++;
  }
  return changed;
}
