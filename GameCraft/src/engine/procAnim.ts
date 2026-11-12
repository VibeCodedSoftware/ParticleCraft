// Procedural animation for rigged models (the Procedural Animation behavior). The skeleton is read as chains of
// bones (a run of single children from a branch to a tip) and each chain gets a role: legs step with planted feet and
// FABRIK IK, arms swing, the head looks, a spine slithers (snakes), tentacles curl and trail (octopus). The body bobs
// and tilts to the feet, turns onto walls while climbing, and a ragdoll topples the body while the limbs fall as
// verlet chains onto the ground. Works on any three.js bone hierarchy: imported .blend rigs (generic "Bone.001"
// names: roles come from shape, not names), glTF and FBX.
import * as THREE from 'three';
import type { ProcRigType } from '@shared/src/runtime/procAnim';
import type { HoldPose } from '@shared/src/runtime/scene';

export type ChainRole = 'leg' | 'arm' | 'head' | 'spine' | 'tail' | 'tentacle' | 'ignore';
export type RigKind = Exclude<ProcRigType, 'auto'>;
export const CHAIN_ROLES: ChainRole[] = ['leg', 'arm', 'head', 'spine', 'tail', 'tentacle', 'ignore'];

export interface Chain {
  /** First bone's name (the key in the bone mapping). */
  name: string;
  bones: THREE.Bone[];
  role: ChainRole;
  /** Role from the skeleton's shape (before the user's mapping). */
  auto: ChainRole;
  /** The last bone's tail, in that bone's space. */
  tip: THREE.Vector3;
  length: number;
  /** Ends at a tip (a limb, head or tail); false for the runs between branches (body / spine). */
  leaf: boolean;
}
export interface RigInfo { kind: RigKind; auto: RigKind; chains: Chain[] }

export interface GroundHit { point: THREE.Vector3; normal: THREE.Vector3 }
export interface ProcFrame {
  dt: number;
  time: number;
  /** World velocity of the object (m/s). */
  velocity: THREE.Vector3;
  /** Ray from `from` along `dir` (unit) up to `max`: the first surface, or null. */
  ground: (from: THREE.Vector3, dir: THREE.Vector3, max: number) => GroundHit | null;
  props: Record<string, any>;
  ragdoll: { since: number; push: [number, number, number] } | null;
  /** Outward normal of the wall being climbed. */
  climb: [number, number, number] | null;
  /** World point to look at. */
  lookAt: THREE.Vector3 | null;
  /** Reach / grab: tentacles (two) or an arm stretch toward this point, curling round it when they get there. */
  reach?: THREE.Vector3 | null;
}

const UP = new THREE.Vector3(0, 1, 0);
const v = () => new THREE.Vector3();

const tipOf = (c: Chain) => c.bones[c.bones.length - 1].localToWorld(c.tip.clone());

function boneKids(b: THREE.Object3D) { return b.children.filter((c) => (c as THREE.Bone).isBone) as THREE.Bone[]; }

/** A bone's tail in its own space: Blender's length when known, else the length of the bone before it. */
function tailOf(b: THREE.Bone): THREE.Vector3 {
  const kids = boneKids(b);
  if (kids.length === 1) return kids[0].position.clone();
  const len = Number(b.userData.length) || b.position.length() * 0.6 || 0.1;
  return new THREE.Vector3(0, len, 0);
}

/** Chains of the skeleton under `root`: leaf runs (limbs) and the runs between branches (spine, body). */
export function findChains(root: THREE.Object3D): Chain[] {
  const bones: THREE.Bone[] = [];
  root.traverse((o) => { if ((o as THREE.Bone).isBone) bones.push(o as THREE.Bone); });
  const isBone = (o: THREE.Object3D | null): o is THREE.Bone => !!o && !!(o as THREE.Bone).isBone;
  const used = new Set<THREE.Bone>();
  const chains: Chain[] = [];
  const make = (list: THREE.Bone[]): Chain => {
    const tip = tailOf(list[list.length - 1]);
    let length = tip.length();
    for (let k = 1; k < list.length; k++) length += list[k].position.length();
    return { name: list[0].name, bones: list, role: 'ignore', auto: 'ignore', tip, length, leaf: !boneKids(list[list.length - 1]).length };
  };
  // Limbs: from each leaf up through single-child bones until a branch (or the skeleton's top).
  for (const leaf of bones) {
    if (boneKids(leaf).length) continue;
    const list = [leaf];
    let cur = leaf.parent;
    while (isBone(cur) && boneKids(cur).length === 1) { list.unshift(cur); cur = cur.parent; }
    list.forEach((b) => used.add(b));
    chains.push(make(list));
  }
  // Inner runs (body / spine): a top bone or a branch's child, down to the next branch, inclusive.
  for (const b of bones) {
    if (used.has(b)) continue;
    if (isBone(b.parent) && !used.has(b.parent) && boneKids(b.parent).length === 1) continue; // not a run start
    const list = [b];
    let cur: THREE.Bone = b;
    while (boneKids(cur).length === 1 && !used.has(boneKids(cur)[0])) { cur = boneKids(cur)[0]; list.push(cur); }
    list.forEach((x) => used.add(x));
    chains.push(make(list));
  }
  return chains;
}

/** Positions of a chain's joints (heads, then the tip) in `space`'s coordinates. */
function jointsIn(c: Chain, space: THREE.Object3D): THREE.Vector3[] {
  const inv = new THREE.Matrix4().copy(space.matrixWorld).invert();
  const pts = c.bones.map((b) => b.getWorldPosition(v()).applyMatrix4(inv));
  pts.push(c.bones[c.bones.length - 1].localToWorld(c.tip.clone()).applyMatrix4(inv));
  return pts;
}

/** Read the rig: chain roles from their shape and the rig kind from the legs (then the user's choices). */
export function analyzeRig(root: THREE.Object3D, rig: ProcRigType = 'auto', boneMap: Record<string, ChainRole> = {}): RigInfo {
  root.updateMatrixWorld(true);
  const chains = findChains(root);
  const box = new THREE.Box3();
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  root.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && m.geometry) { m.geometry.computeBoundingBox(); box.union(m.geometry.boundingBox!.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld))); } });
  for (const c of chains) for (const p of jointsIn(c, root)) box.expandByPoint(p);
  const H = Math.max(1e-3, box.max.y - box.min.y), cx = (box.min.x + box.max.x) / 2, cz = (box.min.z + box.max.z) / 2;
  const span = Math.max(box.max.x - box.min.x, box.max.z - box.min.z, H);
  // Feet: the lowest chain tips (the mesh may reach lower than the feet, and rest poses rarely put every foot down).
  const lowTip = Math.min(...chains.map((c) => { const j = jointsIn(c, root); return j[j.length - 1].y; }));
  for (const c of chains) {
    const j = jointsIn(c, root), s = j[0], t = j[j.length - 1];
    const drop = s.y - t.y, reach = Math.hypot(t.x - cx, t.z - cz);
    let role: ChainRole;
    if (c.length < span * 0.06) role = 'ignore';
    else if (!c.leaf) role = 'spine';
    else if (t.y < lowTip + H * 0.35 && drop > c.length * 0.25) role = 'leg';
    else if (t.y > s.y && t.y > box.max.y - H * 0.35 && reach < span * 0.25) role = 'head';
    else if (Math.abs(drop) < c.length * 0.5 && reach > span * 0.15) role = 'arm';
    else role = 'spine';
    c.auto = role;
  }
  // The rig kind from what was found.
  const legs = chains.filter((c) => c.auto === 'leg');
  const long = chains.filter((c) => c.bones.length >= 3);
  let auto: RigKind;
  if (long.length >= 5 && long.length >= legs.length) auto = 'octopus';
  else if (legs.length >= 5) auto = 'spider';
  else if (legs.length >= 3) auto = 'quadruped';
  else if (legs.length >= 1) auto = 'human';
  else auto = 'snake';
  const kind: RigKind = rig === 'auto' ? auto : rig;
  // Kind-specific roles: octopus arms are tentacles, a snake's longest run is its spine.
  for (const c of chains) {
    let r = c.auto;
    if (kind === 'octopus' && c.bones.length >= 2 && r !== 'head') r = 'tentacle';
    if ((kind === 'human' || kind === 'robot') && r === 'spine' && c.leaf && c.length > H * 0.25 && Math.abs(jointsIn(c, root)[0].x - cx) > span * 0.12) r = 'arm';
    if ((kind === 'quadruped' || kind === 'spider') && r === 'arm') r = 'tail';
    c.auto = r;
  }
  if (kind === 'snake') {
    const spine = [...chains].sort((a, b) => b.bones.length - a.bones.length || b.length - a.length)[0];
    for (const c of chains) if (c.auto === 'leg' || c === spine) c.auto = c === spine ? 'spine' : 'tail';
  }
  for (const c of chains) c.role = boneMap[c.name] ?? c.auto;
  return { kind, auto, chains };
}

/** The Bone mapping property: { "first bone name": role } as JSON (anything else = no overrides). */
export function parseBoneMap(s: unknown): Record<string, ChainRole> {
  if (typeof s !== 'string' || !s.trim()) return {};
  try {
    const o = JSON.parse(s);
    return Object.fromEntries(Object.entries(o ?? {}).filter(([, r]) => CHAIN_ROLES.includes(r as ChainRole))) as Record<string, ChainRole>;
  } catch { return {}; }
}

// ------------------------------------------------------------------------------------------------- IK

/** Turn each bone so it points from its joint to the next solved joint (top of the chain first). */
export function poseChain(bones: THREE.Bone[], tip: THREE.Vector3, pts: THREE.Vector3[]) {
  const q = new THREE.Quaternion(), wq = new THREE.Quaternion(), pq = new THREE.Quaternion();
  for (let i = 0; i < bones.length; i++) {
    const b = bones[i];
    b.updateWorldMatrix(true, false);
    const head = b.getWorldPosition(v());
    const next = i < bones.length - 1 ? bones[i + 1].getWorldPosition(v()) : b.localToWorld(tip.clone());
    const cur = next.sub(head), want = pts[i + 1].clone().sub(head);
    if (cur.lengthSq() < 1e-12 || want.lengthSq() < 1e-12) continue;
    q.setFromUnitVectors(cur.normalize(), want.normalize());
    b.getWorldQuaternion(wq).premultiply(q);
    (b.parent ? b.parent.getWorldQuaternion(pq) : pq.identity()).invert();
    b.quaternion.copy(pq.multiply(wq));
    b.updateMatrixWorld(true);
  }
}

/**
 * Joints along a circular arc from the chain's base to `target`, lying in the plane that holds both and `up`'s normal:
 * a tentacle with slack bends sideways (`side` = which way) as one curve, with its whole length in that plane.
 */
export function floorArc(bones: THREE.Bone[], tip: THREE.Vector3, target: THREE.Vector3, up: THREE.Vector3, side: 1 | -1): THREE.Vector3[] {
  bones[0].updateWorldMatrix(true, true);
  const p = bones.map((b) => b.getWorldPosition(v()));
  p.push(bones[bones.length - 1].localToWorld(tip.clone()));
  const d: number[] = []; let total = 0;
  for (let i = 0; i + 1 < p.length; i++) { d.push(p[i + 1].distanceTo(p[i])); total += d[i]; }
  const base = p[0], chord = target.clone().sub(base), c = chord.length();
  if (c < 1e-6 || total < 1e-6) return p;
  const along = chord.clone().divideScalar(c), across = new THREE.Vector3().crossVectors(along, up);
  if (across.lengthSq() < 1e-8) across.set(1, 0, 0); else across.normalize();
  // The arc's half angle a: chord / length = sin(a) / a. Bisection; a tight arm stops short of a full circle.
  const ratio = Math.min(1, c / total);
  let lo = 1e-3, hi = 3;
  for (let i = 0; i < 24; i++) { const a = (lo + hi) / 2; if (Math.sin(a) / a > ratio) lo = a; else hi = a; }
  const a = (lo + hi) / 2, r = c / (2 * Math.sin(a));
  const out = [base.clone()]; let run = 0;
  for (let i = 0; i < d.length; i++) {
    run += d[i];
    const t = -a + (2 * a * run) / total; // from -a at the base to +a at the tip
    out.push(base.clone().addScaledVector(along, c / 2 + r * Math.sin(t)).addScaledVector(across, side * r * (Math.cos(t) - Math.cos(a))));
  }
  return out;
}

/**
 * FABRIK: joints from the chain's base to `target`, bent toward `pole` (a world point: where knees / elbows point).
 * Returns the solved joints (base first).
 */
export function solveFabrik(bones: THREE.Bone[], tip: THREE.Vector3, target: THREE.Vector3, pole: THREE.Vector3 | null, iterations = 12): THREE.Vector3[] {
  bones[0].updateWorldMatrix(true, true);
  const p = bones.map((b) => b.getWorldPosition(v()));
  p.push(bones[bones.length - 1].localToWorld(tip.clone()));
  const n = p.length - 1, d: number[] = [];
  for (let i = 0; i < n; i++) d.push(p[i + 1].distanceTo(p[i]));
  const total = d.reduce((a, b) => a + b, 0), base = p[0].clone();
  if (base.distanceTo(target) >= total * 0.999 || n === 1) {
    const dir = target.clone().sub(base).normalize();
    for (let i = 1; i <= n; i++) p[i] = p[i - 1].clone().addScaledVector(dir, d[i - 1]);
    return p;
  }
  // Start bent toward the pole so the solution keeps knees forward / elbows back.
  if (pole) for (let i = 1; i < n; i++) p[i].lerp(pole, 0.25);
  for (let it = 0; it < iterations; it++) {
    p[n].copy(target);
    for (let i = n - 1; i >= 0; i--) p[i] = p[i + 1].clone().add(p[i].clone().sub(p[i + 1]).setLength(d[i]));
    p[0].copy(base);
    for (let i = 1; i <= n; i++) p[i] = p[i - 1].clone().add(p[i].clone().sub(p[i - 1]).setLength(d[i - 1]));
    if (p[n].distanceTo(target) < total * 1e-3) break;
  }
  // Pole: turn each inner joint around the line through its neighbours toward the pole.
  if (pole) for (let i = 1; i < n; i++) {
    const a = p[i - 1], c = p[i + 1], axis = c.clone().sub(a);
    if (axis.lengthSq() < 1e-10) continue;
    axis.normalize();
    const proj = (x: THREE.Vector3) => { const r = x.clone().sub(a); return r.sub(axis.clone().multiplyScalar(r.dot(axis))); };
    const j = proj(p[i]), pl = proj(pole);
    if (j.lengthSq() < 1e-10 || pl.lengthSq() < 1e-10) continue;
    const ang = Math.atan2(j.clone().cross(pl).dot(axis), j.dot(pl));
    p[i] = p[i].clone().sub(a).applyAxisAngle(axis, ang).add(a);
  }
  return p;
}

/** Poses a rig once by IK, for a pose it has no clip for: each chain's end goes to its target (model units). */
export function applyHoldPose(root: THREE.Object3D, pose: HoldPose[] | undefined) {
  if (!pose?.length) return;
  root.updateMatrixWorld(true);
  const named = (n: string) => root.getObjectByName(n) as THREE.Bone | undefined;
  const at = (n: string) => named(n)?.getWorldPosition(v());
  const turn = (b: THREE.Object3D, axis: THREE.Vector3, angle: number) => {
    b.updateWorldMatrix(true, false);
    const wq = b.getWorldQuaternion(new THREE.Quaternion()).premultiply(new THREE.Quaternion().setFromAxisAngle(axis, angle));
    b.quaternion.copy((b.parent ? b.parent.getWorldQuaternion(new THREE.Quaternion()).invert() : new THREE.Quaternion()).multiply(wq));
    b.updateMatrixWorld(true);
  };
  for (const c of pose) {
    const bones = c.bones.map(named);
    if (bones.some((b) => !b) || bones.length < 2) continue;
    const list = bones.slice(0, -1) as THREE.Bone[], end = bones[bones.length - 1]!;
    const toWorld = (p: [number, number, number]) => root.localToWorld(new THREE.Vector3(...p));
    poseChain(list, end.position.clone(), solveFabrik(list, end.position.clone(), toWorld(c.target), toWorld(c.pole)));
    const g = c.grip; if (!g) continue;
    // How the hand lies: along it to the middle knuckle, and the palm's side, the one the thumb sits toward.
    const lay = () => {
      const hand = end.getWorldPosition(v()), a = at(g.across[0]), b = at(g.across[1]), m = at(g.middle), t = at(g.thumb);
      if (!a || !b || !m || !t) return null;
      const dir = m.clone().sub(hand).normalize(), palm = new THREE.Vector3().crossVectors(b.clone().sub(a), dir).normalize();
      if (palm.dot(t.clone().sub(a.clone().add(b).multiplyScalar(0.5))) < 0) palm.negate();
      return { dir, palm };
    };
    const l = lay(); if (!l) continue;
    // Roll the hand round its length till the palm faces the way asked.
    const facing = new THREE.Vector3(...g.palmTo).transformDirection(root.matrixWorld).projectOnPlane(l.dir).normalize();
    turn(end, l.dir, Math.atan2(new THREE.Vector3().crossVectors(l.palm, facing).dot(l.dir), l.palm.dot(facing)));
    const l2 = lay(); if (!l2) continue;
    // Fingers close toward the palm's side.
    const close = new THREE.Vector3().crossVectors(l2.dir, l2.palm).normalize();
    for (const f of g.fingers) f.bones.forEach((n, k) => { const b = named(n); if (b) turn(b, close, ((f.curl[k] ?? 0) * Math.PI) / 180); });
  }
  root.updateMatrixWorld(true);
}

// ------------------------------------------------------------------------------------------ animator

interface Leg {
  chain: Chain;
  /** Rest foot position in the model's space (root-local). */
  home: THREE.Vector3;
  /** How far the foot's tip stands above the ground, in the model's units (its sole is below the tip). */
  sole: number;
  /** The foot's height in the parent's space at rest on flat ground. */
  restY: number;
  group: 0 | 1;
  /** A flat last bone (a foot): IK stops at the ankle and the foot stays level. offset: tip → ankle, root space. */
  foot: { bone: THREE.Bone; offset: THREE.Vector3; q: THREE.Quaternion } | null;
  planted: THREE.Vector3 | null;
  step: { from: THREE.Vector3; to: THREE.Vector3; t: number } | null;
}
interface Limp { chain: Chain; pts: THREE.Vector3[]; prev: THREE.Vector3[]; lens: number[] }

export class ProcAnimator {
  info: RigInfo;
  private rest = new Map<THREE.Bone, THREE.Quaternion>();
  private restPos: THREE.Vector3;
  private restQ: THREE.Quaternion;
  private legs: Leg[] = [];
  private legLen = 0.5;
  private height = 1;
  private footFloor = 0;
  /** The model's bottom (where it stands) in its own space: feet stand this far above the ground. */
  private groundRest = 0;
  private importPos: THREE.Vector3;
  private importQ: THREE.Quaternion;
  private phase = 0;
  private bodyY = 0;
  private octoDrop = 0;
  /** Where each foot is this frame, world: arms swing against the leg on their side. */
  private feet = new Map<Leg, THREE.Vector3>();
  private tilt = new THREE.Quaternion();
  private fall: { axis: THREE.Vector3; angle: number; speed: number; limbs: Limp[]; pivot: THREE.Vector3 } | null = null;
  private recover = 0;

  constructor(readonly root: THREE.Object3D, rig: ProcRigType = 'auto', boneMap: Record<string, ChainRole> = {}) {
    this.importPos = root.position.clone(); this.importQ = root.quaternion.clone();
    this.restPos = root.position.clone(); this.restQ = root.quaternion.clone();
    root.traverse((o) => { if ((o as THREE.Bone).isBone) this.rest.set(o as THREE.Bone, (o as THREE.Bone).quaternion.clone()); });
    this.info = analyzeRig(root, rig, boneMap);
    this.fixParts();
    if (this.info.kind === 'snake') this.layDown();
    const box = new THREE.Box3().setFromObject(root);
    const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
    box.applyMatrix4(inv);
    this.height = Math.max(0.05, box.max.y - box.min.y);
    this.groundRest = box.min.y;
    // An octopus lies flat: its body on the floor, arms spread out along it. They crawl: an arm reaches out, grips, and
    // pulls the body along while the others do the same in turn.
    const octo = this.info.kind === 'octopus';
    const legChains = this.info.chains.filter((c) => c.role === 'leg' || (octo && c.role === 'tentacle'));
    const many = legChains.length >= 3;
    const tipC = v(); legChains.forEach((c) => { const j = jointsIn(c, root); tipC.add(j[j.length - 1]); }); if (legChains.length) tipC.divideScalar(legChains.length);
    for (const c of legChains) {
      const j = jointsIn(c, root), home = j[j.length - 1];
      let sole = home.y - this.groundRest;
      // Many-legged bodies: each foot stands on the lowest point of its own lower-leg part, so no leg hangs in the air
      // (rest poses put the feet at different heights).
      if (many && !octo) {
        const low = this.lowestOf(c.bones[c.bones.length - 1]); if (low !== null) sole = Math.max(0, home.y - low);
        // No foot rests at full stretch: a straight leg can't step, and it's what made some legs jerk while others walked.
        let len = 0; for (let n = 1; n < j.length; n++) len += j[n].distanceTo(j[n - 1]);
        const base = j[0], dist = Math.hypot(home.x - base.x, home.z - base.z), most = len * 0.72;
        if (dist > most) { home.x = base.x + ((home.x - base.x) * most) / dist; home.z = base.z + ((home.z - base.z) * most) / dist; }
      }
      if (octo) {
        // Flat out from the body along the floor, most of the arm's length.
        let len = 0; for (let n = 1; n < j.length; n++) len += j[n].distanceTo(j[n - 1]);
        const out = new THREE.Vector3(j[0].x - tipC.x, 0, j[0].z - tipC.z);
        if (out.lengthSq() < 1e-8) out.set(home.x - tipC.x, 0, home.z - tipC.z);
        if (out.lengthSq() < 1e-8) out.set(Math.cos(legChains.indexOf(c) * 2.4), 0, Math.sin(legChains.indexOf(c) * 2.4));
        out.setLength(len * 0.6); // (room left to reach as the body moves past a gripping tip)
        home.x = j[0].x + out.x; home.z = j[0].z + out.z;
        sole = this.height * 0.02; home.y = this.groundRest + sole;
      }
      const standing = home.clone().setY(this.groundRest + sole);
      const restY = standing.multiply(root.scale).applyQuaternion(this.restQ).add(this.restPos).y;
      let foot: Leg['foot'] = null;
      const last = c.bones[c.bones.length - 1], d = home.clone().sub(j[j.length - 2]);
      // (Two-legged rigs only. On a spider this caught whichever legs happened to end flat, and only those moved differently.)
      if (!octo && !many && c.bones.length >= 2 && d.lengthSq() > 1e-8 && Math.abs(d.normalize().y) < 0.5) {
        const q = root.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(last.getWorldQuaternion(new THREE.Quaternion()));
        foot = { bone: last, offset: j[j.length - 2].clone().sub(home), q };
      }
      this.legs.push({ chain: c, home, sole, restY, group: 0, foot, planted: null, step: null });
    }
    // Leg length in world units (the model is usually scaled to fit its object).
    const worldLen = (c: Chain) => { const s = c.bones.map((b) => b.getWorldPosition(v())); s.push(c.bones[c.bones.length - 1].localToWorld(c.tip.clone())); let L = 0; for (let k = 1; k < s.length; k++) L += s[k].distanceTo(s[k - 1]); return L; };
    const worldH = this.height * root.getWorldScale(v()).y;
    this.legLen = legChains.length ? legChains.reduce((a, c) => a + worldLen(c), 0) / legChains.length : worldH * 0.4;
    this.footFloor = this.legs.length ? Math.min(...this.legs.map((l) => l.home.y)) : box.min.y;
    // Octopus: how far the body comes down so the arms' roots are nearly on the floor.
    if (octo && legChains.length) {
      const baseY = legChains.reduce((a, c) => a + jointsIn(c, root)[0].y, 0) / legChains.length;
      this.octoDrop = Math.max(0, baseY - this.groundRest - this.height * 0.06) * root.scale.y;
    }
    // Alternate gait groups around the body: left / right, diagonal pairs, alternating tetrapods.
    const c = new THREE.Vector3(); this.legs.forEach((l) => c.add(l.home)); if (this.legs.length) c.divideScalar(this.legs.length);
    [...this.legs].sort((a, b) => Math.atan2(a.home.z - c.z, a.home.x - c.x) - Math.atan2(b.home.z - c.z, b.home.x - c.x)).forEach((l, k) => { l.group = (k % 2) as 0 | 1; });
  }

  get kind() { return this.info.kind; }

  /** The lowest point (root space) of the rigid meshes on a bone, or null when it has none. */
  private lowestOf(bone: THREE.Bone): number | null {
    const inv = new THREE.Matrix4().copy(this.root.matrixWorld).invert();
    let low: number | null = null;
    const walk = (o: THREE.Object3D) => {
      for (const c of o.children) {
        if ((c as THREE.Bone).isBone) continue;
        const m = c as THREE.Mesh;
        if (m.isMesh && !(m as THREE.SkinnedMesh).isSkinnedMesh) {
          const pos = m.geometry.getAttribute('position'), mat = new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld), p = v();
          for (let k = 0; k < pos.count; k++) { const y = p.fromBufferAttribute(pos, k).applyMatrix4(mat).y; if (low === null || y < low) low = y; }
        }
        walk(c);
      }
    };
    walk(bone);
    return low;
  }

  /**
   * A snake moves like one: the head leads and swings from side to side, and every part of the body follows the same
   * path through the world, so the S-curve stays put on the ground while the snake slides along it. Works out which
   * way the bones run from the chain itself (they may start at the tail, as in the supplied model).
   */
  private slither(f: ProcFrame, dt: number, vel: THREE.Vector3, speed: number) {
    const spine = this.info.chains.find((c) => c.role === 'spine');
    if (!spine) return;
    const rest = spine.bones.map((b) => b.getWorldPosition(v()));
    rest.push(tipOf(spine));
    const floor = this.root.localToWorld(new THREE.Vector3(0, this.groundRest, 0)).y;
    const segs = rest.slice(1).map((q, i) => q.distanceTo(rest[i]));
    const L = Math.max(1e-3, segs.reduce((a, b) => a + b, 0));
    const anchor = (this.root.parent ?? this.root).getWorldPosition(v());
    if (!this.snake) this.snake = { heading: rest[rest.length - 1].clone().sub(rest[0]).setY(0).normalize(), phase: 0, amp: 0 };
    const s = this.snake;
    // About one bend per 5 bones (more would alias on a short chain). The wave runs back along the body exactly as fast as
    // the snake goes forward, so each bend stays put on the ground while the body slides through it: how a real snake moves.
    const bends = Math.max(1.1, Math.min(2.5, spine.bones.length / 5));
    const k = (Math.PI * 2 * bends) / L, moving = speed > 0.05, wave = Number(f.props.wave ?? 1);
    if (moving) {
      // The head turns toward where it is going, no faster than a snake can.
      const to = vel.clone().normalize();
      const a = Math.atan2(s.heading.clone().cross(to).y, s.heading.dot(to));
      s.heading.applyAxisAngle(UP, Math.sign(a) * Math.min(Math.abs(a), dt * 3)).normalize();
      s.phase += speed * dt * k;
    } else s.phase += dt * 0.5; // (at rest, the slowest ripple: it's alive)
    s.amp += ((moving ? 0.14 : 0.04) * L * wave - s.amp) * (1 - Math.exp(-dt * 4));
    const side = new THREE.Vector3().crossVectors(s.heading, UP).normalize();
    // Head first, then back along the body, each joint at its bone's length from the one before.
    const pts: THREE.Vector3[] = new Array(rest.length);
    const onWave = (arc: number) => {
      const fade = 0.55 + 0.45 * Math.min(1, arc / (L * 0.25)); // the head swings less than the body
      return anchor.clone().addScaledVector(s.heading, L * 0.45 - arc).addScaledVector(side, Math.sin(s.phase - k * arc) * s.amp * fade);
    };
    pts[rest.length - 1] = onWave(0);
    let arc = 0;
    for (let n = rest.length - 2; n >= 0; n--) {
      arc += segs[n];
      const dir = onWave(arc).sub(pts[n + 1]);
      pts[n] = pts[n + 1].clone().add(dir.lengthSq() > 1e-10 ? dir.setLength(segs[n]) : s.heading.clone().multiplyScalar(-segs[n]));
    }
    // On the ground: each joint keeps its height above whatever is under it.
    pts.forEach((q, n) => {
      const hit = f.props.groundDetect === false ? null : f.ground(q.clone().setY(anchor.y + L * 0.3), new THREE.Vector3(0, -1, 0), L);
      q.y = (hit ? hit.point.y : floor) + (rest[n].y - floor);
    });
    // The first bone is at whichever end: the whole model moves so that bone sits on its path.
    const parent = this.root.parent;
    if (parent) { parent.updateWorldMatrix(true, false); this.root.position.add(parent.worldToLocal(pts[0].clone()).sub(parent.worldToLocal(rest[0].clone()))); }
    else this.root.position.add(pts[0].clone().sub(rest[0]));
    this.root.updateMatrixWorld(true);
    poseChain(spine.bones, spine.tip, pts);
  }
  private snake: { heading: THREE.Vector3; phase: number; amp: number } | null = null;

  /**
   * Rigid parts parented to the wrong bone in the model (a body cube on a leg bone, a thigh on the spine) would swing
   * with that bone: each part moves to the bone it lies along, when that bone is clearly closer. Undone by reset().
   */
  private fixParts() {
    const bones: THREE.Bone[] = [];
    this.root.traverse((o) => { if ((o as THREE.Bone).isBone) bones.push(o as THREE.Bone); });
    if (bones.length < 2) return;
    const seg = new Map<THREE.Bone, [THREE.Vector3, THREE.Vector3]>();
    for (const b of bones) seg.set(b, [b.getWorldPosition(v()), b.localToWorld(tailOf(b))]);
    const dist = (p: THREE.Vector3, b: THREE.Bone) => new THREE.Line3(...seg.get(b)!).closestPointToPoint(p, true, v()).distanceTo(p);
    const parts: { node: THREE.Object3D; bone: THREE.Bone }[] = [];
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || (m as THREE.SkinnedMesh).isSkinnedMesh) return;
      // The part's top node under its bone (Blender's "<bone>_tail" / "_parentinv" helpers move with it).
      let node: THREE.Object3D = m, p = m.parent;
      while (p && !(p as THREE.Bone).isBone && !(p.name.endsWith('_tail') && (p.parent as THREE.Bone)?.isBone)) { node = p; p = p.parent; }
      if (!p) return;
      const bone = ((p as THREE.Bone).isBone ? p : p.parent) as THREE.Bone;
      if (!parts.some((x) => x.node === node)) parts.push({ node, bone });
    });
    for (const { node, bone } of parts) {
      const box = new THREE.Box3().setFromObject(node);
      if (box.isEmpty()) continue;
      const c = box.getCenter(v());
      const own = dist(c, bone);
      let best = bone, bd = own;
      for (const b of bones) { const d = dist(c, b); if (d < bd) { bd = d; best = b; } }
      if (best === bone || bd > own * 0.5) continue;
      this.moved.push({ node, parent: node.parent! });
      best.attach(node);
    }
  }
  private moved: { node: THREE.Object3D; parent: THREE.Object3D }[] = [];

  /**
   * A snake modelled standing up (spine mostly vertical) lies down: head forward (+X, the object's heading), body on
   * the ground, centred where it stood.
   */
  private layDown() {
    const spine = this.info.chains.find((c) => c.role === 'spine');
    if (!spine) return;
    const j = jointsIn(spine, this.root), dir = j[j.length - 1].clone().sub(j[0]);
    if (dir.lengthSq() < 1e-8 || Math.abs(dir.normalize().y) < 0.6) return;
    const parent = this.root.parent;
    const box0 = new THREE.Box3().setFromObject(this.root);
    const lay = new THREE.Quaternion().setFromUnitVectors(dir, new THREE.Vector3(1, 0, 0));
    this.root.quaternion.copy(this.restQ).multiply(lay);
    this.root.updateMatrixWorld(true);
    const box1 = new THREE.Box3().setFromObject(this.root);
    // Back to the same footprint centre and floor (world boxes; the parent is unrotated relative to its own space).
    const shift = new THREE.Vector3((box0.min.x + box0.max.x - box1.min.x - box1.max.x) / 2, box0.min.y - box1.min.y, (box0.min.z + box0.max.z - box1.min.z - box1.max.z) / 2);
    if (parent) shift.applyQuaternion(parent.getWorldQuaternion(new THREE.Quaternion()).invert()).divide(parent.getWorldScale(new THREE.Vector3()));
    this.root.position.add(shift);
    this.root.updateMatrixWorld(true);
    this.restPos = this.root.position.clone(); this.restQ = this.root.quaternion.clone();
  }

  /** Back to the model as imported (play stopped). */
  reset() {
    this.snake = null;
    for (const [b, q] of this.rest) b.quaternion.copy(q);
    this.root.position.copy(this.importPos); this.root.quaternion.copy(this.importQ);
    this.root.updateMatrixWorld(true);
    for (const { node, parent } of this.moved.splice(0).reverse()) parent.attach(node);
  }

  private restChains() { for (const c of this.info.chains) if (c.role !== 'ignore') for (const b of c.bones) b.quaternion.copy(this.rest.get(b)!); }

  update(f: ProcFrame) {
    const dt = Math.min(0.1, Math.max(0, f.dt));
    if (f.ragdoll) { this.snake = null; this.ragdoll(f, dt); return; }
    if (this.fall) { this.recover = 0.45; this.fall = null; for (const l of this.legs) { l.planted = null; l.step = null; } }
    const p = f.props, kind = this.info.kind;
    const vel = f.velocity.clone(); vel.y = 0;
    const speed = vel.length();
    const robot = kind === 'robot';
    this.restChains();
    // ---- body: wall alignment, tilt to the feet, height and bob
    this.root.position.copy(this.restPos); this.root.quaternion.copy(this.restQ);
    const parent = this.root.parent;
    parent?.updateWorldMatrix(true, false);
    const pq = parent ? parent.getWorldQuaternion(new THREE.Quaternion()) : new THREE.Quaternion();
    const want = new THREE.Quaternion();
    if (f.climb) {
      // Stand on the wall: the body's up turns to the wall's outward normal.
      const n = new THREE.Vector3(...f.climb).applyQuaternion(pq.clone().invert());
      want.setFromUnitVectors(UP, n.normalize());
    } else if (this.legs.length >= 3 && this.legs.every((l) => l.planted)) {
      // Lean with the ground under the feet (front / back, left / right).
      const inv = new THREE.Matrix4().copy(parent ? parent.matrixWorld : new THREE.Matrix4()).invert();
      const loc = this.legs.map((l) => ({ h: l.home, g: l.planted!.clone().applyMatrix4(inv), r: l.restY }));
      const mx = loc.reduce((a, x) => a + x.h.x, 0) / loc.length, mz = loc.reduce((a, x) => a + x.h.z, 0) / loc.length;
      const fit = (axis: 'x' | 'z') => { let sw = 0, s = 0; for (const { h, g, r } of loc) { const k = h[axis] - (axis === 'x' ? mx : mz); s += k * (g.y - r); sw += k * k; } return sw > 1e-6 ? s / sw : 0; };
      const sx = Math.max(-1, Math.min(1, fit('x'))), sz = Math.max(-1, Math.min(1, fit('z')));
      want.setFromUnitVectors(UP, new THREE.Vector3(-sx, 1, -sz).normalize());
      want.slerp(new THREE.Quaternion(), 1 - Math.max(0, Math.min(1, Number(p.surfaceAdapt ?? 1)))); // Surface adaptation
    }
    const resp = Math.max(0.2, Number(p.responsiveness ?? 1));
    this.tilt.slerp(want, 1 - Math.exp(-dt * (f.climb ? 8 : 5) * resp));
    this.root.quaternion.premultiply(this.tilt);
    // Moving: the body bobs once per step (twice per stride for two legs).
    const stepLen = this.stepLength(p);
    this.phase += (speed * dt) / stepLen * Math.PI;
    if (speed < 0.05) this.phase += dt * 0.6 * Number(p.idle ?? 1); // idle breathing
    const bob = Number(p.bob ?? 1) * (robot ? 0.4 : 1);
    let lift = 0;
    if (this.legs.length && kind !== 'octopus') {
      const planted = this.legs.filter((l) => l.planted);
      if (planted.length) {
        // Feet on lower or higher ground move the body with them.
        const inv = new THREE.Matrix4().copy(parent ? parent.matrixWorld : new THREE.Matrix4()).invert();
        const avg = planted.reduce((a, l) => a + l.planted!.clone().applyMatrix4(inv).y - l.restY, 0) / planted.length;
        lift = Math.max(-this.legLen * 0.5, Math.min(this.legLen * 0.3, avg));
      }
      lift -= Math.abs(Math.sin(this.phase)) * 0.06 * this.legLen * bob * Math.min(1, speed / 1.5);
      // Walking with bent knees: rigs often stand with straight legs, which can't reach a foot in front or behind.
      lift -= this.crouch(speed);
    } else if (kind === 'octopus') {
      // Down on the floor, breathing a little.
      lift = -this.octoDrop + (0.5 + 0.5 * Math.sin(f.time * 1.6)) * 0.02 * this.height * this.root.scale.y * bob;
    }
    this.bodyY += (lift - this.bodyY) * (1 - Math.exp(-dt * 12 * resp));
    this.root.position.y += this.bodyY;
    if (this.recover > 0) { this.recover -= dt; }
    this.root.updateMatrixWorld(true);
    // ---- legs
    if (this.legs.length && kind !== 'snake') this.walk(f, dt, vel, speed);
    if (kind === 'snake') this.slither(f, dt, vel, speed);
    // ---- the rest of the body
    const side = new THREE.Vector3().crossVectors(speed > 0.05 ? vel.clone().normalize() : new THREE.Vector3(1, 0, 0).applyQuaternion(pq), UP).normalize();
    const n = this.info.chains;
    for (const c of n) {
      if (c.role === 'arm') {
        // Upper arm and forearm: with a shoulder bone first in the chain, they come after it.
        const m = c.bones.length, u = m >= 4 ? 1 : 0, upper = c.bones[u], fore = c.bones[Math.min(m - 1, u + 1)];
        // Rigs are usually modelled in a T-pose: arms that stick out hang down at the sides (a little away from them).
        if (kind === 'human' || kind === 'robot') {
          const base = upper.getWorldPosition(v()), dir = tipOf(c).sub(base).normalize();
          const down = new THREE.Vector3(0, -1, 0).applyQuaternion(this.root.getWorldQuaternion(new THREE.Quaternion()));
          const axis = new THREE.Vector3().crossVectors(dir, down);
          const ang = dir.angleTo(down) - 0.18;
          if (axis.lengthSq() > 1e-6 && ang > 0.3) this.turn(upper, axis.normalize(), ang);
        }
        // Against the leg on the same side: left foot forward, left arm back, and it follows the feet exactly. Which side
        // is judged across the way it's walking.
        const centre = this.root.getWorldPosition(v()), onSide = Math.sign(upper.getWorldPosition(v()).sub(centre).dot(side)) || 1;
        const heading = speed > 0.05 ? vel.clone().normalize() : new THREE.Vector3(1, 0, 0).applyQuaternion(pq);
        let stride = Math.sin(this.phase) * onSide;
        const leg = this.legs.find((l) => Math.sign(l.chain.bones[0].getWorldPosition(v()).sub(centre).dot(side)) === onSide), foot = leg && this.feet.get(leg);
        if (leg && foot) stride = Math.max(-1, Math.min(1, foot.clone().sub(leg.chain.bones[0].getWorldPosition(v())).dot(heading) / (stepLen * 0.5)));
        const pace = Math.min(1, speed / 1.5), amount = Number(p.armSwing ?? 1) * (robot ? 0.5 : 1);
        const swing = -stride * 0.6 * pace * amount;
        this.turn(upper, side, swing);
        // The elbow: always a little bent, more as the arm comes forward, and never backward.
        if (fore !== upper) this.turn(fore, side, (0.2 + pace * (0.3 + 0.55 * Math.max(0, -stride))) * Math.min(1.4, amount || 0.4));
      } else if (c.role === 'tail') {
        c.bones.forEach((b, i) => this.turn(b, UP, Math.sin(f.time * 2.2 - i * 0.6) * 0.12 * Number(p.wave ?? 1)));
      } else if (c.role === 'tentacle' && !this.legs.some((l) => l.chain === c)) {
        // Tentacles lie on the ground: they curl sideways (a wave along the arm), lift only slightly at the tips,
        // and bend round to trail behind while moving. Small per-bone angles: they add up along the arm.
        const k = n.indexOf(c), w = Number(p.wave ?? 1), m = c.bones.length;
        const radial = c.bones[0].getWorldPosition(v()).sub(this.root.getWorldPosition(v())).setY(0);
        const back = vel.clone().negate();
        const trail = speed > 0.05 && radial.lengthSq() > 1e-8
          ? Math.atan2(radial.clone().cross(back).y, radial.dot(back)) * Math.min(1, speed * 0.4) / m : 0;
        c.bones.forEach((b, i) => {
          this.turn(b, UP, w * 0.12 * Math.sin(f.time * 1.8 + i * 0.8 + k * 1.3) + trail * 0.6);
          const axis = new THREE.Vector3().crossVectors(UP, radial).normalize();
          if (axis.lengthSq() > 0.5 && i >= m - 2) this.turn(b, axis, -w * 0.08 * (0.5 + 0.5 * Math.sin(f.time * 2.3 + k)));
        });
      } else if (c.role === 'head') {
        if (f.lookAt) {
          const head = c.bones[0].getWorldPosition(v());
          const to = f.lookAt.clone().sub(head); to.y = 0;
          const fwd = new THREE.Vector3(1, 0, 0).applyQuaternion(pq); fwd.y = 0;
          if (to.lengthSq() > 1e-6 && fwd.lengthSq() > 1e-6) {
            const a = Math.atan2(fwd.clone().cross(to).y, fwd.dot(to));
            this.turn(c.bones[0], UP, Math.max(-1.2, Math.min(1.2, a)));
          }
        } else this.turn(c.bones[0], UP, Math.sin(f.time * 0.5) * 0.05 * Number(p.idle ?? 1));
      }
    }
    if (f.reach) this.reachFor(f.reach);
  }

  /** Reach / grab: the limbs closest to the target bend toward it (IK), never stretching past their length. */
  private reachFor(target: THREE.Vector3) {
    const limbs = this.info.chains.filter((c) => c.role === 'tentacle' || c.role === 'arm');
    if (!limbs.length) return;
    const count = limbs[0].role === 'tentacle' ? 2 : 1;
    const tipW = (c: typeof limbs[number]) => c.bones[c.bones.length - 1].localToWorld(c.tip.clone());
    for (const c of limbs.sort((a, z) => tipW(a).distanceTo(target) - tipW(z).distanceTo(target)).slice(0, count)) {
      const pts = [...c.bones.map((b) => b.getWorldPosition(v())), tipW(c)];
      let len = 0; for (let i = 1; i < pts.length; i++) len += pts[i].distanceTo(pts[i - 1]);
      const base = pts[0], to = target.clone().sub(base);
      if (to.length() > len * 0.98) to.setLength(len * 0.98);
      poseChain(c.bones, c.tip, solveFabrik(c.bones, c.tip, base.clone().add(to), null));
    }
  }

  /** How far the body lowers while moving (bent knees). */
  private crouch(speed: number) { return this.stiff ? 0 : 0.1 * this.legLen * Math.min(1, speed / Math.max(0.2, this.legLen * 0.5)); }

  /** Legs with no knee (one bone above the foot): they swing straight from the hip. */
  private get stiff() { return this.legs.every((l) => l.chain.bones.length - (l.foot ? 1 : 0) < 2); }

  /** Step length (world): the setting, but never more than a bent leg can reach in front and behind. */
  private stepLength(p: Record<string, any>) {
    const L = this.legLen, h = L - 0.1 * L;
    if (this.info.kind === 'octopus') return Math.max(0.05 * L, Number(p.stepLength ?? 0.8) * L * 0.4); // short, many steps
    const reach = this.stiff ? L * 0.45 : Math.sqrt(Math.max(0, L * L - h * h)); // horizontal reach from the crouched hip
    // (Long legs splayed wide: a stride as long as the leg swept a foot under the body and across its neighbour.)
    return Math.max(0.05 * L, Math.min(Number(p.stepLength ?? 0.8) * L, this.legs.length <= 2 ? reach * 1.5 : Math.min(reach * 2.4, L * 0.5)));
  }

  /** Rotate a bone by `angle` around a world axis. */
  private turn(b: THREE.Bone, axis: THREE.Vector3, angle: number) {
    if (!angle) return;
    b.updateWorldMatrix(true, false);
    const wq = b.getWorldQuaternion(new THREE.Quaternion()).premultiply(new THREE.Quaternion().setFromAxisAngle(axis, angle));
    const pq = b.parent ? b.parent.getWorldQuaternion(new THREE.Quaternion()).invert() : new THREE.Quaternion();
    b.quaternion.copy(pq.multiply(wq));
    b.updateMatrixWorld(true);
  }

  private walk(f: ProcFrame, dt: number, vel: THREE.Vector3, speed: number) {
    const p = f.props;
    const down = new THREE.Vector3(0, -1, 0).applyQuaternion(this.root.getWorldQuaternion(new THREE.Quaternion()));
    const up = down.clone().negate();
    const stepLen = this.stepLength(p);
    // Two legs barely lift the foot (a walk, not a march); many legs lift high to clear the ground.
    const octo = this.info.kind === 'octopus';
    const stepH = Number(p.stepHeight ?? 0.3) * this.legLen * (this.legs.length <= 2 ? 0.45 : octo ? 0.06 : 1); // an octopus's arms are long: they barely leave the floor
    // Faster movement steps faster: a foot never falls more than a step behind.
    const rate = Math.max(Number(p.stepSpeed ?? 5) * (this.info.kind === 'robot' ? 1.2 : octo ? 0.6 : 1), (speed / stepLen) * 2.2);
    // Feet land about half a stride ahead, so a planted foot travels from in front of the hip to behind it.
    const lead = speed > 0.05 ? vel.clone().setLength(stepLen * 0.45) : new THREE.Vector3();
    const stepping = [false, false];
    for (const l of this.legs) if (l.step) stepping[l.group] = true;
    const targets: THREE.Vector3[] = [];
    let airborne = 0;
    for (const l of this.legs) {
      const homeW = this.root.localToWorld(l.home.clone().setY(this.groundRest));
      // How far the foot's tip is above the ground at rest, in world units (the sole below the tip, raised claws).
      const lift = l.sole * this.root.getWorldScale(v()).y;
      const from = homeW.clone().add(lead).addScaledVector(up, this.legLen);
      // Ground detection off: feet step on a flat plane at the body's resting level.
      // (The octopus's body is lowered, so its flat plane is measured from its object, not from where the body is now.)
      const flat = homeW.clone().add(lead);
      if (octo && this.root.parent) flat.y = this.root.parent.localToWorld(new THREE.Vector3(0, l.restY, 0)).y;
      if (octo) from.y = flat.y + this.legLen;
      const hit = p.groundDetect === false ? { point: flat } : f.ground(from, down, this.legLen * 2.2);
      const desired = hit ? hit.point.clone().addScaledVector(up, lift) : null;
      if (!desired) { airborne++; l.planted = null; l.step = null; targets.push(this.root.localToWorld(l.home.clone())); continue; }
      if (!l.planted) l.planted = desired.clone();
      if (l.step) {
        l.step.to.copy(desired); // keep aiming where the foot should land
        // A foot with far to go (the body is turning) hurries, or it would still be behind when it lands.
        l.step.t += dt * rate * Math.max(1, l.step.from.distanceTo(l.step.to) / stepLen);
        if (l.step.t >= 1) { l.planted = l.step.to.clone(); l.step = null; }
      } else {
        const far = l.planted.distanceTo(desired);
        const restless = speed < 0.05 && far > stepLen * 0.15; // standing: settle feet under the body
        // Taking turns keeps the gait, but never at the cost of a foot dragged across under the body.
        const left = far > stepLen * 1.5 && this.legs.length >= 3;
        if (left || ((far > stepLen || restless || this.recover > 0) && !stepping[1 - l.group])) {
          l.step = { from: l.planted.clone(), to: desired.clone(), t: 0 };
          stepping[l.group] = true;
        }
      }
      if (l.step) {
        const t = l.step.t, e = t * t * (3 - 2 * t);
        targets.push(l.step.from.clone().lerp(l.step.to, e).addScaledVector(up, Math.sin(Math.PI * t) * stepH));
      } else targets.push(l.planted.clone());
    }
    void airborne;
    // IK: knees forward for two legs, up and out for many.
    const fwd = speed > 0.05 ? vel.clone().normalize() : new THREE.Vector3(1, 0, 0).applyQuaternion(this.root.parent?.getWorldQuaternion(new THREE.Quaternion()) ?? new THREE.Quaternion());
    const centre = this.root.getWorldPosition(v());
    const rootQ = this.root.getWorldQuaternion(new THREE.Quaternion());
    this.legs.forEach((l, k) => {
      const base = l.chain.bones[0].getWorldPosition(v());
      this.feet.set(l, targets[k]);
      let bones = l.chain.bones, tip = l.chain.tip, target = targets[k];
      if (octo) {
        // Along the floor: an arm with slack curves out sideways in one smooth arc, never folding up off the ground.
        poseChain(bones, tip, floorArc(bones, tip, target, up, k % 2 ? 1 : -1));
        return;
      }
      if (l.foot) {
        // The ankle sits where it does at rest relative to the foot's tip; the foot bone keeps its rest angle.
        bones = bones.slice(0, -1); tip = l.foot.bone.position.clone();
        target = target.clone().add(l.foot.offset.clone().applyMatrix4(this.root.matrixWorld).sub(centre));
      }
      const mid = base.clone().lerp(target, 0.5);
      const pole = this.legs.length <= 2
        ? mid.clone().addScaledVector(fwd, this.legLen).addScaledVector(up, this.legLen * 0.2)
        : mid.clone().addScaledVector(up, this.legLen).add(base.clone().sub(centre).projectOnPlane(up).setLength(this.legLen * 0.5));
      poseChain(bones, tip, solveFabrik(bones, tip, target, pole));
      if (l.foot) {
        const b = l.foot.bone, pq = b.parent!.getWorldQuaternion(new THREE.Quaternion()).invert();
        b.quaternion.copy(pq.multiply(rootQ.clone().multiply(l.foot.q)));
        b.updateMatrixWorld(true);
      }
    });
  }

  // ---------------------------------------------------------------------------------------- ragdoll

  private ragdoll(f: ProcFrame, dt: number) {
    const parent = this.root.parent;
    if (!this.fall) {
      // Topple away from the push (or forward), around the feet; limbs go limp from their current pose.
      const pq = parent ? parent.getWorldQuaternion(new THREE.Quaternion()) : new THREE.Quaternion();
      const push = new THREE.Vector3(...f.ragdoll!.push); push.y = 0;
      const dirW = push.lengthSq() > 0.01 ? push.clone().normalize() : new THREE.Vector3(1, 0, 0).applyQuaternion(pq).setY(0).normalize();
      const dirL = dirW.applyQuaternion(pq.clone().invert()); dirL.y = 0; dirL.normalize();
      const axis = new THREE.Vector3().crossVectors(UP, dirL).normalize();
      const limbs: Limp[] = [];
      for (const c of this.info.chains) {
        if (c.role === 'ignore') continue;
        const pts = c.bones.map((b) => b.getWorldPosition(v())); pts.push(c.bones[c.bones.length - 1].localToWorld(c.tip.clone()));
        const lens = pts.slice(1).map((q, i) => q.distanceTo(pts[i]));
        const kick = new THREE.Vector3(...f.ragdoll!.push).multiplyScalar(dt || 1 / 60);
        limbs.push({ chain: c, pts, prev: pts.map((q) => q.clone().sub(kick)), lens });
      }
      const lying = this.info.kind === 'snake';
      this.fall = { axis, angle: 0, speed: lying ? 0 : 0.6 + Math.min(4, push.length() * 0.5), limbs, pivot: new THREE.Vector3(0, this.footFloor, 0) };
      if (lying) this.fall.angle = 0;
    }
    const fl = this.fall;
    // The body: a stick falling over (faster the further it leans), stopped by the ground with a small bounce.
    const limit = this.info.kind === 'snake' ? 0 : this.info.kind === 'octopus' || this.info.kind === 'spider' ? 0.35 : Math.PI / 2 * 0.92;
    if (fl.angle < limit) {
      fl.speed += (3 * 9.8) / (2 * this.height) * Math.sin(fl.angle + 0.08) * dt;
      fl.angle += fl.speed * dt;
      if (fl.angle >= limit) { fl.angle = limit; fl.speed = -fl.speed * 0.2; if (Math.abs(fl.speed) < 0.3) fl.speed = 0; }
    } else if (fl.speed < 0) { fl.angle += fl.speed * dt; fl.speed += 6 * dt; if (fl.speed >= 0) { fl.speed = 0; } }
    const q = new THREE.Quaternion().setFromAxisAngle(fl.axis, fl.angle);
    this.root.quaternion.copy(q).multiply(this.restQ);
    this.root.position.copy(this.restPos.clone().sub(fl.pivot).applyQuaternion(q).add(fl.pivot));
    // Lying down, the body rests on its side: lift it by how far the pivot sinks below the floor.
    this.root.position.y += Math.sin(fl.angle) * this.height * 0.08;
    this.root.updateMatrixWorld(true);
    // Limbs: verlet chains pinned at their base, pulled by gravity, kept off the ground.
    const g = new THREE.Vector3(0, -9.8 * dt * dt, 0), down = new THREE.Vector3(0, -1, 0);
    for (const L of fl.limbs) {
      const base = L.chain.bones[0].getWorldPosition(v());
      L.pts[0].copy(base); L.prev[0].copy(base);
      for (let i = 1; i < L.pts.length; i++) {
        const cur = L.pts[i], vel = cur.clone().sub(L.prev[i]).multiplyScalar(0.96);
        L.prev[i].copy(cur);
        cur.add(vel).add(g);
      }
      for (let it = 0; it < 6; it++) {
        for (let i = 0; i < L.lens.length; i++) {
          const a = L.pts[i], b = L.pts[i + 1], d = b.clone().sub(a), len = d.length() || 1e-6;
          const diff = (len - L.lens[i]) / len;
          if (i === 0) b.addScaledVector(d, -diff); else { a.addScaledVector(d, diff * 0.5); b.addScaledVector(d, -diff * 0.5); }
        }
      }
      for (let i = 1; i < L.pts.length; i++) {
        const pt = L.pts[i];
        const hit = f.ground(pt.clone().setY(pt.y + 1), down, 3);
        if (hit && pt.y < hit.point.y + 0.02) {
          pt.y = hit.point.y + 0.02;
          // Ground friction: lose most of the sideways speed.
          L.prev[i].x = pt.x - (pt.x - L.prev[i].x) * 0.3; L.prev[i].z = pt.z - (pt.z - L.prev[i].z) * 0.3; L.prev[i].y = pt.y;
        }
      }
      poseChain(L.chain.bones, L.chain.tip, L.pts);
    }
  }
}
