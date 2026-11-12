// Parent to a bone (Bone view, instance.parentBone): the child hangs on a "socket", an empty node on the owner that is
// moved to the bone's position and rotation every frame, after the animation, procedural animation and Bone Edit have
// posed it. The socket leaves out the bone's own scale: rigs are often in centimetres or have a fitted size inside,
// and a gun on a hand keeps the size it has in the Inspector (the owner's scale still applies, as for any parent).
import * as THREE from 'three';
import { bonesByName } from './bonePose';

export interface BoneSocket { group: THREE.Group; bone: THREE.Bone }
const m = new THREE.Matrix4(), inv = new THREE.Matrix4(), s = new THREE.Vector3();

/** The socket for a bone on `owner` (null while the model is not loaded, or it has no such bone). */
export function socketFor(sockets: Map<string, BoneSocket>, owner: THREE.Object3D, model: THREE.Object3D | undefined, name: string): BoneSocket | null {
  if (!model) return null;
  let k = sockets.get(name);
  // A swapped model has new bones: look the name up again.
  if (k) { let o: THREE.Object3D | null = k.bone; while (o && o !== model) o = o.parent; if (!o) k = undefined; }
  if (!k) {
    const bone = bonesByName(model).get(name);
    if (!bone) { sockets.get(name)?.group.removeFromParent(); sockets.delete(name); return null; }
    const old = sockets.get(name);
    const group = old?.group ?? new THREE.Group();
    group.name = 'bone socket: ' + name; group.userData.boneSocket = true;
    k = { group, bone }; sockets.set(name, k);
  }
  if (k.group.parent !== owner) owner.add(k.group);
  return k;
}

/** Move a socket to where its bone is now. */
export function updateSocket(k: BoneSocket, owner: THREE.Object3D) {
  owner.updateWorldMatrix(true, false);
  k.bone.updateWorldMatrix(true, false);
  m.multiplyMatrices(inv.copy(owner.matrixWorld).invert(), k.bone.matrixWorld);
  m.decompose(k.group.position, k.group.quaternion, s);
  k.group.scale.set(1, 1, 1);
  k.group.updateMatrix();
}

/** The socket's transform in its owner's space, for keeping a child where it is when it is parented. */
export function socketMatrix(k: BoneSocket, owner: THREE.Object3D): THREE.Matrix4 {
  updateSocket(k, owner);
  return k.group.matrix.clone();
}
