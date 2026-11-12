// Procedural Animation behavior: a rigged model animates itself from how it moves, with no clips. Feet are planted on
// the ground and stepped with IK (humans, robots, quadrupeds, spiders), snakes slither, octopus tentacles curl and
// trail. The posing runs in the renderer (GameCraft engine/procAnim.ts); this is the game side: wall climbing for
// spiders, the ragdoll state (on death or from a block) and a look-at target for the head.
import type { BehaviorDef, BehaviorHost } from './behaviors';
import type { RInstance } from './world';
import { moveAndCollide, raycast } from './physics';

export const PROC_RIGS = ['auto', 'human', 'robot', 'quadruped', 'spider', 'snake', 'octopus'] as const;
export type ProcRigType = (typeof PROC_RIGS)[number];

/** What the renderer reads (inst.state.procanim). */
export interface ProcAnimState {
  /** Ragdoll since this game time, with an initial push (m/s, world). Null = animated. */
  ragdoll: { since: number; push: [number, number, number] } | null;
  /** Climbing a wall: the wall's outward normal (the body turns to stand on it). */
  climb: [number, number, number] | null;
  /** Head / eyes follow this object (uid). */
  lookAt: number | null;
  /** Set by the death check so On died fires the ragdoll once. */
  diedHandled?: boolean;
}

export function procState(inst: RInstance): ProcAnimState {
  return (inst.state.procanim ??= { ragdoll: null, climb: null, lookAt: null } as ProcAnimState);
}

/** Start a ragdoll (Ragdoll block, Ragdoll on death): movement stops, the renderer lets the bones fall. */
export function startRagdoll(host: { time: number }, inst: RInstance, push: [number, number, number] = [0, 0, 0]) {
  const st = procState(inst);
  if (st.ragdoll) return;
  st.ragdoll = { since: host.time, push: [push[0] + inst.vx, push[1] + inst.vy, push[2] + inst.vz] };
  st.climb = null;
}

export const PROC_ANIM: BehaviorDef = {
  id: 'procanim', name: 'Procedural Animation', icon: '🦿', gamecraftOnly: true,
  doc: 'Animates a rigged model from its movement, without animation clips: feet step and stay planted on the ground (IK), bodies bob and tilt, snakes slither, tentacles curl. Works with any movement behavior. Rig: Auto reads the skeleton (legs are the bone chains reaching the ground); pick one, or map bones in Bone mapping, when the guess is wrong. Ragdoll on death lets the body collapse when Health runs out.',
  props: [
    { key: 'rig', label: 'Rig', type: 'choice', default: 'auto', options: [...PROC_RIGS], doc: 'Auto: 2 legs = human, 4 = quadruped, 6+ = spider, no legs and one long chain = snake, many hanging chains = octopus.' },
    { key: 'stepLength', label: 'Step length (× leg)', type: 'number', default: 0.8, min: 0.1, max: 3, step: 0.05, doc: 'How far a foot may trail before it steps, relative to the leg length.' },
    { key: 'stepHeight', label: 'Step height (× leg)', type: 'number', default: 0.3, min: 0, max: 2, step: 0.05 },
    { key: 'stepSpeed', label: 'Step speed (steps/s)', type: 'number', default: 5, min: 0.5, max: 20, step: 0.5 },
    { key: 'bob', label: 'Body bob', type: 'number', default: 1, min: 0, max: 3, step: 0.1, doc: 'Up and down movement of the body while walking (0 = none).' },
    { key: 'armSwing', label: 'Arm swing', type: 'number', default: 1, min: 0, max: 3, step: 0.1 },
    { key: 'wave', label: 'Slither / curl', type: 'number', default: 1, min: 0, max: 3, step: 0.1, doc: 'Snakes: how far the body waves. Octopus: how much the tentacles curl.' },
    { key: 'animSpeed', label: 'Animation speed', type: 'number', default: 1, min: 0, max: 4, step: 0.05, doc: 'Speeds up or slows down all the procedural motion (1 = normal).' },
    { key: 'groundDetect', label: 'Ground detection', type: 'boolean', default: true, doc: 'Feet find the ground under them (stairs, slopes). Off = feet step on a flat plane at the body\'s level.' },
    { key: 'surfaceAdapt', label: 'Surface adaptation', type: 'number', default: 1, min: 0, max: 1, step: 0.05, doc: 'How much the body leans with the ground under its feet (0 = stays level).' },
    { key: 'responsiveness', label: 'Responsiveness', type: 'number', default: 1, min: 0.2, max: 3, step: 0.1, doc: 'How quickly the body settles to new ground and tilt (higher = snappier).' },
    { key: 'idle', label: 'Idle motion', type: 'number', default: 1, min: 0, max: 3, step: 0.1, doc: 'Breathing and looking around while standing still (0 = perfectly still).' },
    { key: 'climbWalls', label: 'Climb walls', type: 'boolean', default: false, doc: 'Walking into a wall climbs it (spiders). With Platform movement.' },
    { key: 'climbSpeed', label: 'Climb speed (m/s)', type: 'number', default: 2.5, min: 0.1, step: 0.1 },
    { key: 'ragdollOnDeath', label: 'Ragdoll on death', type: 'boolean', default: true, doc: 'When Health reaches 0 the body goes limp and falls (needs Health).' },
    { key: 'boneMap', label: 'Bone mapping', type: 'string', default: '', advanced: true, doc: 'Set with Bone mapping… in the Inspector: which bone chains are legs, arms, spine, head, tail or tentacles.' },
    { key: 'enabled', label: 'Enabled', type: 'boolean', default: true },
  ],
  expressions: {
    IsRagdoll: (i) => (i.state.procanim?.ragdoll ? 1 : 0),
    IsClimbing: (i) => (i.state.procanim?.climb ? 1 : 0),
  },
  tick(inst, p, host, dt) {
    const st = procState(inst);
    // Ragdoll on death (Health); the body stays where it fell.
    if (p.ragdollOnDeath !== false && inst.state.health?.dead && !st.diedHandled) { st.diedHandled = true; startRagdoll(host, inst); }
    if (st.ragdoll) {
      // Movement behaviors are paused: the object itself just drops to the ground (the bones do the falling over).
      inst.vx = 0; inst.vz = 0;
      inst.vy = Math.max(-40, inst.vy - Math.abs(host.gravity || 20) * dt);
      if (moveAndCollide(host.world, inst, 0, inst.vy * dt, 0, host.world.blockersFor(inst)).some((h) => h.axis === 1)) inst.vy = 0;
      return;
    }
    if (p.climbWalls && host.world.plane === 'xz') climb(inst, p, host, dt, st);
  },
};

/** Spider wall climbing: pushing into a wall walks up it; over the top, step onto it. */
function climb(inst: RInstance, p: Record<string, any>, host: BehaviorHost, dt: number, st: ProcAnimState) {
  const w = host.world, plat = inst.state.platform;
  const intent = plat?.intent as [number, number] | null | undefined;
  const bb = w.aabb(inst), half = Math.max(bb[3] - bb[0], bb[5] - bb[2]) / 2, mid = (bb[1] + bb[4]) / 2;
  const solids = w.blockersFor(inst);
  const ahead = (dir: [number, number], y: number) => raycast(w, [inst.x, y, inst.z], [dir[0], 0, dir[1]], half + 0.12, solids, inst);
  if (!intent) { st.climb = null; return; }
  const hit = ahead(intent, mid) ?? ahead(intent, bb[1] + 0.05);
  if (hit && Math.abs(hit.normal[1]) < 0.5 && hit.normal[0] * intent[0] + hit.normal[2] * intent[1] < -0.5) {
    // Up the wall: no falling, no sliding back.
    st.climb = hit.normal;
    moveAndCollide(w, inst, 0, Number(p.climbSpeed ?? 2.5) * dt, 0, solids);
    inst.vy = 0;
    if (plat) { plat.grounded = true; plat.jumps = 0; }
  } else if (st.climb) {
    // Was climbing and the wall ended: the top edge. Step forward onto it.
    const back: [number, number] = [-st.climb[0], -st.climb[2]];
    moveAndCollide(w, inst, 0, 0.15, 0, solids);
    moveAndCollide(w, inst, back[0] * (half + 0.2), 0, back[1] * (half + 0.2), solids);
    inst.vy = 0; st.climb = null;
  }
}
