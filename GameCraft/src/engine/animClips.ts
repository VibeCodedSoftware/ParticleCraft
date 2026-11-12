// Maps behavior animation names (idle, walk, jump, fall, attack...) to a model's animation clips.
import * as THREE from 'three';
import { poseChain, solveFabrik } from './procAnim';

/** Behavior animations a model may not have, and what to play instead (in order). */
const ANIM_FALLBACK: Record<string, string[]> = { fall: ['jump', 'idle'], jump: ['fall', 'idle'], run: ['walk'], idle: ['walk'], walk: ['run'], attack: ['idle'], swim: ['walk', 'idle'], drive: ['sit', 'idle'],
  // Platform abilities: their own clips when the model has them, else the nearest look.
  dash: ['run', 'walk'], climb: ['jump', 'idle'], fly: ['fall', 'jump', 'idle'], wallslide: ['fall', 'idle'], glide: ['fall', 'idle'], crouch: ['idle'], sit: ['idle'], carry: ['idle'] };

/** Pick the model clip for a behavior animation: per-instance map, exact name, prefix match ("walk" -> "Walk.002"), then fallbacks. */
export function resolveClip(clips: THREE.AnimationClip[], anim: string | undefined, map?: Record<string, string>): THREE.AnimationClip | undefined {
  if (!anim) return undefined;
  const find = (n: string) => {
    const l = n.toLowerCase();
    return clips.find((c) => c.name.toLowerCase() === l) ?? clips.find((c) => c.name.toLowerCase().startsWith(l)) ?? clips.find((c) => c.name.toLowerCase().includes(l));
  };
  const mapped = map?.[anim] ?? map?.[anim.toLowerCase()];
  if (mapped) { const c = clips.find((x) => x.name === mapped) ?? find(mapped); if (c) return c; }
  const direct = find(anim);
  if (direct) return direct;
  for (const alt of ANIM_FALLBACK[anim.toLowerCase()] ?? []) {
    const c = (map?.[alt] && find(map[alt])) || find(alt);
    if (c) return c;
  }
  return undefined;
}


/** Where the carried box sits in the model (model space, metres, facing +Z): centre and size (width, height, depth). */
export const HELD_BOX = { centre: [0, 0.98, 0.34], size: [0.4, 0.26, 0.3] } as const;

/**
 * Clips made from the rig's own: carrying a box in both hands while standing or walking (the legs of Idle / Walk,
 * the upper body held steady from Idle). The arms are solved with two-bone IK on the idle pose so each wrist rests
 * on a side of HELD_BOX, elbows bent down and out; the hands keep their idle roll (palms toward the box).
 * Models without those clips are left as they are.
 */
export function withDerivedClips(clips: THREE.AnimationClip[], root?: THREE.Object3D): THREE.AnimationClip[] {
  const byName = (n: string) => clips.find((c) => c.name === n);
  const idle = byName('Idle_Loop');
  if (!idle || !root || clips.some((c) => c.name === 'Hold_Box_Idle')) return clips;
  const arm = (s: 'L' | 'R') => ['upper_arm', 'forearm', 'hand'].map((n) => root.getObjectByName(`DEF-${n}${s}`) as THREE.Bone | undefined);
  const sides = (['L', 'R'] as const).map((s) => ({ s, bones: arm(s) })).filter((x) => x.bones.every(Boolean)) as { s: 'L' | 'R'; bones: THREE.Bone[] }[];
  if (sides.length !== 2) return clips;
  const mixer = new THREE.AnimationMixer(root);
  mixer.clipAction(idle).reset().play(); mixer.setTime(0); root.updateMatrixWorld(true);
  const toWorld = (p: readonly number[]) => root.localToWorld(new THREE.Vector3(p[0], p[1], p[2]));
  const [cx, cy, cz] = HELD_BOX.centre, half = HELD_BOX.size[0] / 2;
  const held: THREE.QuaternionKeyframeTrack[] = [];
  for (const { s, bones } of sides) {
    const k = s === 'L' ? 1 : -1; // the model's left is +X
    const [upper, fore, hand] = bones;
    const target = toWorld([cx + k * (half + 0.02), cy, cz - 0.06]);
    const pole = toWorld([k * 0.5, cy - 0.15, -0.15]);
    poseChain([upper, fore], hand.position, solveFabrik([upper, fore], hand.position, target, pole));
    for (const b of [upper, fore]) held.push(new THREE.QuaternionKeyframeTrack(`${b.name}.quaternion`, [0], b.quaternion.toArray()));
  }
  // The upper body from Idle (no walking sway, so the hands stay on the box).
  const steady = /hips|spine|neck|head|shoulder/i;
  const upperIdle = idle.tracks.filter((tr) => steady.test(tr.name) && tr.name.endsWith('.quaternion'));
  mixer.stopAllAction(); mixer.uncacheRoot(root);
  const out = [...clips];
  for (const [name, base] of [['Hold_Box_Idle', 'Idle_Loop'], ['Hold_Box_Walk', 'Walk_Loop']] as const) {
    const src = byName(base); if (!src) continue;
    const replaced = new Set([...held, ...(base === 'Idle_Loop' ? [] : upperIdle)].map((tr) => tr.name));
    const body = src.tracks.filter((tr) => !replaced.has(tr.name)).map((tr) => tr.clone());
    const extra = base === 'Idle_Loop' ? [] : upperIdle.map((tr) => tr.clone());
    out.push(new THREE.AnimationClip(name, src.duration, [...body, ...extra, ...held.map((tr) => tr.clone())]));
  }
  return out;
}
