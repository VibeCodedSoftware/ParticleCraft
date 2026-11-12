// Animation retargeting (Import animation): clips from another file (a Mixamo FBX, a GLB) are renamed onto this
// model's bones by matching humanoid bone names, the root (hips) movement is rescaled to this skeleton's size and
// other bone translations are dropped (so limbs keep this model's proportions). Bones it can't match are skipped.
import * as THREE from 'three';

/** Humanoid canonical bone ← name patterns (after normalising: no prefix, lowercase, no separators). */
const SIDES: [RegExp, string][] = [[/^(left|l)(?=[a-z])|(left|l)$/, 'L'], [/^(right|r)(?=[a-z])|(right|r)$/, 'R']];
const PARTS: [RegExp, string][] = [
  [/^(hips?|pelvis|root|cog)$/, 'hips'],
  [/^spine2$|^chest$|^spine02$|^upperchest$/, 'chest'], [/^spine1$|^spine01$/, 'spine1'], [/^spine$|^spine0$|^torso$/, 'spine'],
  [/^neck$/, 'neck'], [/^head$/, 'head'],
  [/^shoulder$|^clavicle$|^collar$/, 'shoulder'],
  [/^(upper)?arm$|^upperarm$|^humerus$/, 'upperArm'], [/^(fore|lower)arm$|^elbow$/, 'lowerArm'], [/^hand$|^wrist$/, 'hand'],
  // Mixamo: UpLeg = thigh, Leg = shin (so a plain "leg" is the lower leg).
  [/^(upleg|upperleg|thigh|femur)$/, 'upperLeg'], [/^(leg|lowerleg|lowleg|shin|calf|knee)$/, 'lowerLeg'],
  [/^foot$|^ankle$/, 'foot'], [/^toe(base)?s?$|^ball$/, 'toes'],
];

/** "mixamorig:LeftUpLeg" → "upperLeg.L"; "thigh.L" → "upperLeg.L"; unknown names → normalised name. */
export function canonicalBone(name: string): string {
  // Rig prefixes: Mixamo, 3ds Max Biped, Rigify deform / original / mechanism bones.
  let n = name.replace(/^.*[:|]/, '').replace(/^(mixamorig\d*|armature|bip0?1|b[-_]|def[-_]|org[-_]|mch[-_])/i, '');
  // Side markers as separate tokens (".L", "_l", " L"), a capital L/R glued to a lowercase name (Rigify "upper_armL"),
  // or prefixes / suffixes (LeftArm, ArmLeft, L_Arm).
  let side = '';
  const sep = /[._ -](l|r|left|right)$/i.exec(n) ?? /^(l|r|left|right)[._ -]/i.exec(n) ?? /(?<=[a-z0-9])([LR])$/.exec(n);
  if (sep) { side = sep[1].toLowerCase().startsWith('l') ? 'L' : 'R'; n = n.slice(0, sep.index) + n.slice(sep.index + sep[0].length); }
  n = n.replace(/[._ -]/g, '').toLowerCase();
  // Spine segments: Mixamo Spine / Spine1 / Spine2, Rigify spine.001 / .002 / .003 (zero-padded counts from 1).
  const sp = /^spine(0*)(\d*)$/.exec(n);
  if (sp && !side) { const k = sp[2] === '' ? 0 : parseInt(sp[2], 10) - (sp[1] ? 1 : 0); return k <= 0 ? 'spine' : k === 1 ? 'spine1' : 'chest'; }
  if (!side) for (const [re, s] of SIDES) if (re.test(n)) { const m = re.exec(n)!; const rest = n.replace(m[0], ''); if (rest.length >= 3) { side = s; n = rest; } break; }
  for (const [re, part] of PARTS) if (re.test(n)) return side ? `${part}.${side}` : part;
  return side ? `${n}.${side}` : n;
}

export interface RetargetReport { matched: number; skipped: string[] }

/**
 * A copy of `clip` driving `target`'s bones. Rotations follow by canonical name; the hips translation is scaled by
 * `hipScale` (target hip height / source hip height); every other translation and any scale track is dropped.
 */
export function retargetClip(clip: THREE.AnimationClip, targetBones: string[], hipScale: number): { clip: THREE.AnimationClip; report: RetargetReport } {
  const byCanon = new Map<string, string>();
  for (const b of targetBones) { const c = canonicalBone(b); if (!byCanon.has(c)) byCanon.set(c, b); }
  const tracks: THREE.KeyframeTrack[] = [];
  const skipped = new Set<string>();
  let matched = 0;
  for (const t of clip.tracks) {
    const dot = t.name.lastIndexOf('.');
    const bone = t.name.slice(0, dot), prop = t.name.slice(dot + 1);
    const canon = canonicalBone(bone), dst = byCanon.get(canon);
    if (!dst) { skipped.add(bone); continue; }
    if (prop === 'quaternion') { const c = t.clone(); c.name = `${dst}.quaternion`; tracks.push(c); matched++; continue; }
    if (prop === 'position' && canon === 'hips') {
      const c = t.clone(); c.name = `${dst}.position`;
      for (let k = 0; k < c.values.length; k++) c.values[k] *= hipScale;
      tracks.push(c); matched++;
    }
  }
  return { clip: new THREE.AnimationClip(clip.name, clip.duration, tracks), report: { matched, skipped: [...skipped] } };
}

/** Height of the hips bone above the lowest bone in the rest pose (for scaling root motion between skeletons). */
export function hipHeight(root: THREE.Object3D): number {
  let hips: THREE.Object3D | null = null, low = Infinity;
  const v = new THREE.Vector3();
  root.updateMatrixWorld(true);
  root.traverse((o) => { if ((o as THREE.Bone).isBone) { o.getWorldPosition(v); low = Math.min(low, v.y); if (!hips && canonicalBone(o.name) === 'hips') hips = o; } });
  if (!hips || low === Infinity) return 0;
  return (hips as THREE.Object3D).getWorldPosition(v).y - low;
}

export function boneNames(root: THREE.Object3D): string[] {
  const out: string[] = [];
  root.traverse((o) => { if ((o as THREE.Bone).isBone) out.push(o.name); });
  return out;
}
