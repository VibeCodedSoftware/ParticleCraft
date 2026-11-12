// Bone Edit (Model & animations › Bones, mesh.bonePose): per-bone turns, moves and sizes layered on top of the
// animation. Each frame the edited bones go back to their rest pose before the animation mixer runs (so bones the
// clip doesn't animate never accumulate the edit), then the edit is applied after the animation and procedural
// animation have posed them.
import * as THREE from 'three';
import type { BoneEdit } from '@shared/src/runtime/scene';

interface Rest { pos: THREE.Vector3; quat: THREE.Quaternion; scale: THREE.Vector3 }
const euler = new THREE.Euler(), q = new THREE.Quaternion();

/** The bones of a model by name (first one wins when names repeat). */
export function bonesByName(root: THREE.Object3D): Map<string, THREE.Bone> {
  const out = new Map<string, THREE.Bone>();
  root.traverse((o) => { if ((o as THREE.Bone).isBone && o.name && !out.has(o.name)) out.set(o.name, o as THREE.Bone); });
  return out;
}

function rest(b: THREE.Bone): Rest {
  return (b.userData.boneRest ??= { pos: b.position.clone(), quat: b.quaternion.clone(), scale: b.scale.clone() }) as Rest;
}

/** Before the animation: edited bones back to their rest pose. */
export function resetBonePose(root: THREE.Object3D, pose: Record<string, BoneEdit> | undefined) {
  if (!pose) return;
  const bones = bonesByName(root);
  for (const name of Object.keys(pose)) { const b = bones.get(name); if (!b) continue; const r = rest(b); b.position.copy(r.pos); b.quaternion.copy(r.quat); b.scale.copy(r.scale); }
}

/** After the animation: the edits on top (turn in the bone's own axes, move in its parent's units, uniform size). */
export function applyBonePose(root: THREE.Object3D, pose: Record<string, BoneEdit> | undefined) {
  if (!pose) return;
  const bones = bonesByName(root);
  for (const [name, e] of Object.entries(pose)) {
    const b = bones.get(name); if (!b) continue;
    rest(b);
    if (e.rot && (e.rot[0] || e.rot[1] || e.rot[2])) { euler.set(THREE.MathUtils.degToRad(e.rot[0]), THREE.MathUtils.degToRad(e.rot[1]), THREE.MathUtils.degToRad(e.rot[2]), 'XYZ'); b.quaternion.multiply(q.setFromEuler(euler)); }
    if (e.pos) b.position.add(new THREE.Vector3(...e.pos));
    if (e.scale !== undefined && e.scale !== 1) b.scale.multiplyScalar(Math.max(0.01, e.scale));
  }
}

/** Is there anything to apply (non-empty, not all zero)? */
export const hasBonePose = (pose: Record<string, BoneEdit> | undefined) => !!pose && Object.values(pose).some((e) => e.rot?.some(Boolean) || e.pos?.some(Boolean) || (e.scale !== undefined && e.scale !== 1));
