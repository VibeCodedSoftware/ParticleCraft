// Bone view: every rigged model's skeleton drawn over the scene (lines between bones, a dot per joint, always on top),
// the picked bone highlighted. The dots are fixed-size on screen, and picking is by screen distance, so small bones
// such as fingers stay clickable from far away.
import * as THREE from 'three';
import { bonesByName } from './bonePose';

interface Rig { model: THREE.Object3D; lines: THREE.SkeletonHelper; bones: THREE.Bone[]; dots: THREE.Points }
export interface BonePick { uid: number; bone: string }

let dotTex: THREE.Texture | null = null;
function dotTexture() {
  if (dotTex) return dotTex;
  const c = document.createElement('canvas'); c.width = c.height = 32;
  const g = c.getContext('2d')!; g.fillStyle = '#fff'; g.beginPath(); g.arc(16, 16, 14, 0, Math.PI * 2); g.fill();
  return (dotTex = new THREE.CanvasTexture(c));
}

export class BoneOverlay {
  group = new THREE.Group();
  picked: BonePick | null = null;
  private rigs = new Map<number, Rig>();
  private dotMat: THREE.PointsMaterial;
  private pickMat: THREE.PointsMaterial;
  private pickDot = new THREE.Points(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(3), 3)));

  constructor() {
    const dot = (color: number, size: number) => new THREE.PointsMaterial({ color, size, sizeAttenuation: false, map: dotTexture(), alphaTest: 0.5, depthTest: false, transparent: true });
    this.dotMat = dot(0x5ab0ff, 7); this.pickMat = dot(0xffb020, 13);
    this.group.name = 'bone view'; this.group.userData.editorOnly = true; this.group.visible = false;
    this.pickDot.material = this.pickMat; this.pickDot.renderOrder = 12; this.pickDot.frustumCulled = false; this.pickDot.visible = false;
    this.group.add(this.pickDot);
  }

  /** Follow the scene's rigged models this frame: add new ones, drop gone or swapped ones, move the dots to the pose. */
  update(models: Map<number, THREE.Object3D>) {
    for (const [uid, r] of this.rigs) if (models.get(uid) !== r.model) this.drop(uid);
    for (const [uid, model] of models) {
      let r = this.rigs.get(uid);
      if (!r) {
        const bones = [...bonesByName(model).values()];
        if (!bones.length) continue;
        const lines = new THREE.SkeletonHelper(model);
        const lm = lines.material as THREE.LineBasicMaterial; lm.depthTest = false; lm.transparent = true;
        lines.renderOrder = 10; lines.frustumCulled = false;
        const geo = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(bones.length * 3), 3));
        const dots = new THREE.Points(geo, this.dotMat); dots.renderOrder = 11; dots.frustumCulled = false;
        this.group.add(lines, dots);
        r = { model, lines, bones, dots }; this.rigs.set(uid, r);
      }
      const pos = r.dots.geometry.getAttribute('position') as THREE.BufferAttribute;
      r.bones.forEach((b, k) => { const e = b.matrixWorld.elements; pos.setXYZ(k, e[12], e[13], e[14]); });
      pos.needsUpdate = true;
    }
    const p = this.picked, bone = p && this.rigs.get(p.uid)?.bones.find((b) => b.name === p.bone);
    this.pickDot.visible = !!bone;
    if (bone) { const e = bone.matrixWorld.elements, pos = this.pickDot.geometry.getAttribute('position') as THREE.BufferAttribute; pos.setXYZ(0, e[12], e[13], e[14]); pos.needsUpdate = true; }
  }

  /** The bone nearest a screen point (px within the view), within `reach` pixels. */
  pick(x: number, y: number, toScreen: (x: number, y: number, z: number) => { x: number; y: number } | null, reach = 12): BonePick | null {
    let best: BonePick | null = null, bd = reach;
    for (const [uid, r] of this.rigs) for (const b of r.bones) {
      const e = b.matrixWorld.elements, q = toScreen(e[12], e[13], e[14]); if (!q) continue;
      const d = Math.hypot(q.x - x, q.y - y);
      if (d < bd) { bd = d; best = { uid, bone: b.name }; }
    }
    return best;
  }

  /** The bones of one rig in tree order, with their depth (for the panel's list). */
  list(uid: number): { name: string; depth: number }[] {
    const r = this.rigs.get(uid); if (!r) return [];
    const known = new Set(r.bones);
    const depth = (b: THREE.Object3D) => { let n = 0; for (let o = b.parent; o; o = o.parent) if (known.has(o as THREE.Bone)) n++; return n; };
    return r.bones.map((b) => ({ name: b.name, depth: depth(b) }));
  }

  get rigCount() { return this.rigs.size; }

  private drop(uid: number) {
    const r = this.rigs.get(uid); if (!r) return;
    r.lines.removeFromParent(); r.lines.dispose();
    r.dots.removeFromParent(); r.dots.geometry.dispose();
    this.rigs.delete(uid);
  }

  dispose() {
    for (const uid of [...this.rigs.keys()]) this.drop(uid);
    this.pickDot.geometry.dispose(); this.dotMat.dispose(); this.pickMat.dispose();
    this.group.removeFromParent();
  }
}
