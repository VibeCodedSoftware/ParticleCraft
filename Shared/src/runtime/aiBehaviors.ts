// Ready-made character AI behaviors, configured in the Inspector like any other behavior:
//   Follower       - a pet or companion that stays near its leader, catches up, and finds its way around walls
//   Path follower  - walks a route drawn in the scene (loop, back-and-forth or once; pauses at points)
//   Wander         - roams randomly around its start within a radius, idling between moves
//   NPC interaction - notices the player, walks up, talks (Dialogue editor) and goes back to what it was doing
//   Slime          - hopping enemy: wander, spot, chase, contact attack, death
//   Flying enemy   - hovers at a height, roams, pursues, dives to attack, falls when defeated
// They only move in the world plane (x/z in 3D, x/y in 2D); Path follower also follows the height of its points.
// This module must not import behaviors.ts (that file spreads AI_BEHAVIORS into BEHAVIORS).
import type { RInstance, World } from './world';
import type { BehaviorDef, BehaviorHost, PropDef } from './behaviors';
import { moveAndCollide } from './physics';
import { findPath, getGrid, planeAB, lineOfSight } from './pathfinding';

type Vec = [number, number];

function approach(v: number, target: number, amount: number) {
  return v < target ? Math.min(target, v + amount) : v > target ? Math.max(target, v - amount) : v;
}
function angleLerp(a: number, b: number, maxStep: number) {
  const d = ((b - a + 540) % 360) - 180;
  return Math.abs(d) <= maxStep ? b : a + Math.sign(d) * maxStep;
}
const xz = (w: World) => w.plane === 'xz';
/** Height axis value: y in both planes (3D up; 2D side-view up). */
const plane = (w: World, i: { x: number; y: number; z: number }): Vec => planeAB(w, i);

/** Move along the world plane, colliding with solids. Returns true when something blocked the move. */
function movePlanar(host: BehaviorHost, inst: RInstance, da: number, db: number, dh = 0): boolean {
  const w = host.world;
  const hits = xz(w) ? moveAndCollide(w, inst, da, dh, db, w.blockersFor(inst)) : moveAndCollide(w, inst, da, db + dh, 0, w.blockersFor(inst));
  return hits.some((h) => h.axis !== 1 || !xz(w));
}
/** Turn toward a planar direction (and flip 2D sprites). */
function face(w: World, inst: RInstance, ua: number, ub: number, degPerSec: number, dt: number) {
  if (!ua && !ub) return;
  const heading = xz(w) ? (Math.atan2(-ub, ua) * 180) / Math.PI : (Math.atan2(ub, ua) * 180) / Math.PI;
  if (xz(w)) w.setAngle(inst, angleLerp(w.angle(inst), heading, degPerSec * dt));
  else if (inst.sprite && Math.abs(ua) > 0.05) inst.sprite.flipX = ua < 0;
}
function nearest(w: World, from: RInstance, type: string): RInstance | null {
  let best: RInstance | null = null, bd = Infinity;
  for (const o of w.of(type)) { if (o === from) continue; const d = w.planarDistance(from, o); if (d < bd) { bd = d; best = o; } }
  return best;
}
function home(inst: RInstance): [number, number, number] {
  return (inst.state.home ??= [inst.x, inst.y, inst.z]);
}
/** A random point within `r` of home, in plane coordinates. */
function randomAround(w: World, inst: RInstance, r: number, rnd: () => number): Vec {
  const [ha, hb] = plane(w, { x: home(inst)[0], y: home(inst)[1], z: home(inst)[2] });
  const a = rnd() * Math.PI * 2, d = r * Math.sqrt(0.15 + 0.85 * rnd());
  return [ha + Math.cos(a) * d, hb + Math.sin(a) * d];
}
/** Deterministic per-instance random numbers (the same game plays the same way in both apps and in tests). */
function rand(inst: RInstance): () => number {
  return () => {
    let s = (inst.state.aiSeed ??= (inst.uid * 2654435761) >>> 0 || 1);
    s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0;
    inst.state.aiSeed = s;
    return s / 4294967296;
  };
}
function trig(host: BehaviorHost, id: string, inst: RInstance, data?: any) { host.queueTrigger(id, { [inst.type]: [inst] }, data); }
/** True while an NPC interaction (or a dialogue it started) has taken over this character. */
const busy = (inst: RInstance) => !!inst.state.npcBusy;
const dead = (inst: RInstance) => !!inst.state.health?.dead;

const targetProp = (doc = 'Object type this character reacts to.'): PropDef => ({ key: 'target', label: 'Player object', type: 'objectType', default: 'Player', doc });
const enabledProp: PropDef = { key: 'enabled', label: 'Enabled', type: 'boolean', default: true };
const animProps = (move: string, idle: string): PropDef[] => [
  { key: 'moveAnim', label: 'Moving animation', type: 'string', default: move, doc: 'Animation (clip or role) while moving. Empty = leave animations alone.', advanced: true },
  { key: 'idleAnim', label: 'Standing animation', type: 'string', default: idle, doc: 'Animation while standing still.', advanced: true },
];
function anim(inst: RInstance, p: Record<string, any>, moving: boolean) {
  const a = String(moving ? p.moveAnim ?? '' : p.idleAnim ?? '');
  if (a) inst.animation = a;
}

/** Shared enemy pieces: hitting the target and the death sequence. */
function hitTarget(host: BehaviorHost, inst: RInstance, target: RInstance, p: Record<string, any>) {
  const st = inst.state.enemy;
  st.cooldown = Number(p.attackCooldown);
  host.damage?.(target, Number(p.damage));
  const w = host.world;
  const [a1, b1] = plane(w, inst), [a2, b2] = plane(w, target);
  const da = a2 - a1, db = b2 - b1, l = Math.hypot(da, db) || 1, k = Number(p.knockback ?? 6);
  if (k > 0) { target.vx += (da / l) * k; if (xz(w)) { target.vz += (db / l) * k; target.vy += k * 0.3; } else target.vy += Math.abs(db / l) * k * 0.5 + k * 0.3; }
  trig(host, 'enemy.on_attack', inst);
}
function setState(host: BehaviorHost, inst: RInstance, s: string) {
  const st = inst.state.enemy;
  if (st.state === s) return;
  st.state = s; st.t = 0;
  inst.vars.state = s;
  if (s === 'chase') trig(host, 'enemy.on_spotted', inst);
}
/** Returns true while dying (caller stops). Destroys the enemy after `deathTime`. */
function dying(host: BehaviorHost, inst: RInstance, p: Record<string, any>, dt: number): boolean {
  if (!dead(inst)) return false;
  const st = inst.state.enemy;
  if (st.state !== 'dead') { setState(host, inst, 'dead'); inst.animation = 'death'; inst.vx = inst.vz = 0; if (!xz(host.world)) inst.vy = 0; }
  st.t += dt;
  if (p.destroyOnDeath !== false && st.t >= Number(p.deathTime ?? 0.8)) host.world.destroy(inst);
  return true;
}
/** Look for the target: in range and (3D) not behind a wall. */
function sees(host: BehaviorHost, inst: RInstance, target: RInstance | null, range: number): boolean {
  if (!target || dead(target)) return false;
  if (host.world.planarDistance(inst, target) > range) return false;
  return lineOfSight(host.world, inst, target);
}

/** One step towards a point: straight when it can see the way there, else along a path, looked for now and then. */
function stepToward(host: BehaviorHost, inst: RInstance, st: { path?: Vec[] | null; pathAt?: number }, ga: number, gb: number, speed: number, to: RInstance | null, p: Record<string, any>, dt: number) {
  const w = host.world, [a, b] = plane(w, inst);
  let ta = ga, tb = gb;
  const blocked = p.pathfinding !== false && !p.flying && !!to && !lineOfSight(w, inst, to);
  if (blocked) {
    if (!st.path?.length || host.time >= (st.pathAt ?? 0)) {
      const bb = w.aabb(inst), g = getGrid(w, 0.5, 0.4, xz(w) ? bb[1] : 0);
      st.path = findPath(g, a, b, ga, gb) ?? null;
      st.pathAt = host.time + 0.6;
    }
    while (st.path?.length && Math.hypot(st.path[0][0] - a, st.path[0][1] - b) < 0.3) st.path.shift();
    if (st.path?.length) [ta, tb] = st.path[0];
  } else st.path = null;
  const dx = ta - a, dy = tb - b, l = Math.hypot(dx, dy) || 1, step = Math.min(speed * dt, l);
  const ua = dx / l, ub = dy / l;
  if (xz(w)) moveAndCollide(w, inst, ua * step, 0, ub * step, w.blockersFor(inst), Number(p.stepHeight ?? 0.4));
  else moveAndCollide(w, inst, ua * step, p.flying ? ub * step : 0, 0, w.blockersFor(inst));
  face(w, inst, ua, ub, Number(p.turnSpeed ?? 540), dt);
}

/** A follower's place near its leader: behind, to a side, or wherever it already is on the way there. */
function followSpot(w: World, leader: RInstance, from: Vec, dist: number, side: string): Vec {
  const [la, lb] = plane(w, leader);
  if (side === 'nearest') { const dx = from[0] - la, dy = from[1] - lb, l = Math.hypot(dx, dy) || 1; return [la + (dx / l) * dist, lb + (dy / l) * dist]; }
  const f = w.forward(w.angle(leader)), fa = f[0], fb = xz(w) ? f[2] : f[1];
  // Side view: only ever behind or ahead along the ground.
  if (!xz(w)) { const back = Math.sign(fa) || 1; return [la - back * dist * (side === 'ahead' ? -1 : 1), lb]; }
  if (side === 'left') return [la + fb * dist, lb - fa * dist];
  if (side === 'right') return [la - fb * dist, lb + fa * dist];
  return [la - fa * dist, lb - fb * dist];
}

export const AI_BEHAVIORS: Record<string, BehaviorDef> = {
  enemy: {
    id: 'enemy', name: 'Enemy', icon: '👹',
    doc: 'A regular enemy: walks around near where it started, chases the player when it sees them, finds its way around walls, attacks in reach, and dies when its Health runs out. Add the Health behavior so it can be hurt.',
    props: [
      targetProp('Who it hunts.'),
      { key: 'detectRange', label: 'Sees the player within (m)', type: 'number', default: 10, min: 0, step: 0.5 },
      { key: 'loseRange', label: 'Gives up beyond (m)', type: 'number', default: 18, min: 0, step: 0.5 },
      { key: 'speed', label: 'Chase speed (m/s)', type: 'number', default: 3.5, min: 0, step: 0.5 },
      { key: 'attackRange', label: 'Attack reach (m)', type: 'number', default: 1.6, min: 0.1, step: 0.1 },
      { key: 'damage', label: 'Attack damage', type: 'number', default: 10, min: 0, step: 1 },
      { key: 'attackCooldown', label: 'Time between attacks (s)', type: 'number', default: 1, min: 0.05, step: 0.1 },
      { key: 'knockback', label: 'Knockback (m/s)', type: 'number', default: 4, min: 0, step: 0.5 },
      { key: 'patrolRadius', label: 'Wanders within (m; 0 = stands)', type: 'number', default: 5, min: 0, step: 0.5 },
      { key: 'patrolSpeed', label: 'Wander speed (m/s)', type: 'number', default: 1.5, min: 0, step: 0.25 },
      { key: 'pathfinding', label: 'Finds a way around walls', type: 'boolean', default: true },
      { key: 'canJump', label: 'Can jump', type: 'boolean', default: false, doc: 'Jumps up to a target above it, and over what blocks its way while chasing.' },
      { key: 'jumpStrength', label: 'Jump strength (m/s)', type: 'number', default: 8, min: 0, step: 0.5 },
      { key: 'destroyOnDeath', label: 'Removed after dying', type: 'boolean', default: true },
      { key: 'deathTime', label: 'Death animation time (s)', type: 'number', default: 0.8, min: 0, step: 0.1, advanced: true },
      { key: 'gravity', label: 'Gravity', type: 'number', default: 24, min: 0, advanced: true },
      { key: 'stepHeight', label: 'Step height (m)', type: 'number', default: 0.4, min: 0, step: 0.1, advanced: true },
      { key: 'turnSpeed', label: 'Turn speed (°/s)', type: 'number', default: 540, min: 0, advanced: true },
      ...animProps('walk', 'idle'),
      enabledProp,
    ],
    expressions: {
      IsChasing: (i) => (i.state.enemy?.state === 'chase' ? 1 : 0),
      IsAttacking: (i) => (i.state.enemy?.state === 'attack' ? 1 : 0),
    },
    tick(inst, p, host, dt) {
      const w = host.world, st = (inst.state.enemy ??= { state: 'patrol', t: 0, cooldown: 0, vy: 0, wait: 0, goal: null as Vec | null, path: null as Vec[] | null, pathAt: 0 });
      if (!dying(host, inst, p, dt)) {
        st.t += dt; st.cooldown = Math.max(0, st.cooldown - dt);
        const target = nearest(w, inst, String(p.target)), gap = target ? w.planarDistance(inst, target) : Infinity;
        const alive = !!target && !dead(target);
        if (st.state === 'patrol' && sees(host, inst, target, Number(p.detectRange))) setState(host, inst, 'chase');
        if (st.state === 'chase' && alive && gap <= Number(p.attackRange)) setState(host, inst, 'attack');
        if (st.state === 'attack' && (!alive || gap > Number(p.attackRange) * 1.25)) setState(host, inst, alive ? 'chase' : 'patrol');
        if (st.state === 'chase' && (!alive || gap > Number(p.loseRange))) { st.goal = null; setState(host, inst, 'patrol'); }
        let moving = false;
        if (st.state === 'chase' && target) {
          const [ta, tb] = plane(w, target), from = [inst.x, inst.y, inst.z];
          stepToward(host, inst, st, ta, xz(w) ? tb : inst.y, Number(p.speed), target, p, dt);
          moving = true;
          // Can jump: on the ground, with the target above it or its way blocked.
          if (p.canJump && st.grounded) {
            const moved = Math.hypot(inst.x - from[0], xz(w) ? inst.z - from[2] : 0), up = (xz(w) ? target.y - inst.y : inst.y - target.y) > 0.8;
            st.stuck = moved < Number(p.speed) * dt * 0.3 ? (st.stuck ?? 0) + dt : 0;
            if (up || st.stuck > 0.25) { st.vy = Number(p.jumpStrength); st.stuck = 0; st.grounded = false; }
          }
        } else if (st.state === 'attack' && target) {
          face(w, inst, target.x - inst.x, xz(w) ? target.z - inst.z : 0, Number(p.turnSpeed), dt);
          if (st.cooldown <= 0) { hitTarget(host, inst, target, p); inst.animation = 'attack'; st.swing = 0.35; }
        } else if (Number(p.patrolRadius) > 0) {
          if (st.wait > 0) st.wait -= dt;
          else {
            if (!st.goal) { st.goal = randomAround(w, inst, Number(p.patrolRadius), rand(inst)); st.t = 0; }
            const [a, b] = plane(w, inst), gy = xz(w) ? st.goal[1] : inst.y;
            if (Math.hypot(st.goal[0] - a, gy - b) < 0.25 || st.t > 6) { st.goal = null; st.wait = 1 + rand(inst)() * 2; }
            else { stepToward(host, inst, st, st.goal[0], gy, Number(p.patrolSpeed), null, { ...p, pathfinding: false }, dt); moving = true; }
          }
        }
        st.swing = Math.max(0, (st.swing ?? 0) - dt);
        if (st.swing <= 0) anim(inst, p, moving);
      }
      const hits = moveAndCollide(w, inst, 0, (st.vy -= Number(p.gravity) * dt) * dt, 0, w.blockersFor(inst));
      st.grounded = hits.some((h) => h.axis === 1) && st.vy <= 0;
      if (hits.some((h) => h.axis === 1)) st.vy = 0;
    },
  },
  spawner: {
    id: 'spawner', name: 'Spawner', icon: '🏭',
    doc: 'Makes copies of an object here, one lot every so often, up to a limit at a time: enemies, pickups, falling rocks.',
    props: [
      { key: 'object', label: 'Spawns', type: 'objectType', default: 'Enemy' },
      { key: 'every', label: 'Every (s)', type: 'number', default: 3, min: 0.05, step: 0.5 },
      { key: 'count', label: 'How many each time', type: 'number', default: 1, min: 1, step: 1 },
      { key: 'maxAlive', label: 'Most at once (0 = no limit)', type: 'number', default: 5, min: 0, step: 1 },
      { key: 'total', label: 'Stop after (0 = never)', type: 'number', default: 0, min: 0, step: 1 },
      { key: 'radius', label: 'Within (m of here)', type: 'number', default: 2, min: 0, step: 0.5 },
      { key: 'startDelay', label: 'First one after (s)', type: 'number', default: 1, min: 0, step: 0.5 },
      { key: 'active', label: 'Starts on', type: 'boolean', default: true },
      enabledProp,
    ],
    expressions: { Made: (i) => i.state.spawner?.made ?? 0, Alive: (i) => i.state.spawner?.mine?.length ?? 0 },
    tick(inst, p, host, dt) {
      const w = host.world, st = (inst.state.spawner ??= { t: Number(p.startDelay), made: 0, mine: [] as number[], on: p.active !== false });
      st.mine = st.mine.filter((u: number) => { const o = w.byUid.get(u); return o && !o.destroyed; });
      if (!st.on) return;
      st.t -= dt;
      if (st.t > 0) return;
      st.t = Number(p.every);
      const rnd = rand(inst), type = String(p.object), total = Number(p.total), max = Number(p.maxAlive);
      for (let k = 0; k < Math.max(1, Number(p.count)); k++) {
        if ((max > 0 && st.mine.length >= max) || (total > 0 && st.made >= total)) break;
        const a = rnd() * Math.PI * 2, r = Number(p.radius) * Math.sqrt(rnd()), [x, y, z] = w.worldPos(inst);
        const o = xz(w) ? w.spawn(type, x + Math.cos(a) * r, y, z + Math.sin(a) * r) : w.spawn(type, x + Math.cos(a) * r, y, z);
        if (!o) { st.on = false; return; } // no such object type: nothing to make
        st.mine.push(o.uid); st.made++;
        host.queueTrigger('spawner.on_spawned', o.type === inst.type ? { [inst.type]: [inst, o] } : { [inst.type]: [inst], [o.type]: [o] });
      }
    },
  },
  follower: {
    id: 'follower', name: 'Follower', icon: '🐾',
    doc: 'A pet or companion: stays close to its leader, runs to catch up, finds its way around walls, and appears beside the leader if it gets left far behind. Stay and Follow blocks tell it to wait.',
    props: [
      targetProp('Who it follows.'),
      { key: 'distance', label: 'Keeps this close (m)', type: 'number', default: 2, min: 0.2, step: 0.25 },
      { key: 'side', label: 'Where it walks', type: 'choice', default: 'behind', options: ['behind', 'left', 'right', 'ahead', 'nearest'], doc: 'Its place around the leader. Nearest: any side, whichever it reaches first.' },
      { key: 'speed', label: 'Walk speed (m/s)', type: 'number', default: 4, min: 0, step: 0.5 },
      { key: 'runSpeed', label: 'Catch-up speed (m/s)', type: 'number', default: 8, min: 0, step: 0.5 },
      { key: 'runAt', label: 'Runs when further than (m)', type: 'number', default: 7, min: 0, step: 0.5 },
      { key: 'teleportAt', label: 'Appears beside when further than (m)', type: 'number', default: 35, min: 0, step: 1, doc: '0 = never.' },
      { key: 'pathfinding', label: 'Finds a way around walls', type: 'boolean', default: true },
      { key: 'attack', label: 'Can attack', type: 'boolean', default: false, doc: 'Goes after nearby enemies, hits them, then returns to its leader.' },
      { key: 'enemy', label: 'Attacks', type: 'objectType', default: 'Enemy', doc: 'The object type it goes after (they need the Health behavior).' },
      { key: 'attackRange', label: 'Notices enemies within (m)', type: 'number', default: 8, min: 0, step: 0.5 },
      { key: 'leash', label: 'Strays from leader at most (m)', type: 'number', default: 14, min: 0, step: 1, doc: 'Past this it gives up the chase and returns.' },
      { key: 'attackReach', label: 'Attack reach (m)', type: 'number', default: 1.6, min: 0.1, step: 0.1 },
      { key: 'attackDamage', label: 'Attack damage', type: 'number', default: 10, min: 0, step: 1 },
      { key: 'attackCooldown', label: 'Time between attacks (s)', type: 'number', default: 0.8, min: 0.05, step: 0.1 },
      { key: 'attackAnim', label: 'Attack animation', type: 'string', default: 'attack', advanced: true },
      { key: 'takesDamage', label: 'Takes damage', type: 'boolean', default: true, doc: 'Off: nothing can hurt it. On: give it the Health behavior so it has health to lose.' },
      { key: 'flying', label: 'Flying', type: 'boolean', default: false, doc: 'Floats at the leader\'s height plus Hover height, with no gravity.' },
      { key: 'hover', label: 'Hover height (m)', type: 'number', default: 1.2, step: 0.1 },
      { key: 'gravity', label: 'Gravity', type: 'number', default: 24, min: 0, advanced: true },
      { key: 'stepHeight', label: 'Step height (m)', type: 'number', default: 0.4, min: 0, step: 0.1, advanced: true },
      { key: 'turnSpeed', label: 'Turn speed (°/s)', type: 'number', default: 540, min: 0, advanced: true },
      ...animProps('walk', 'idle'),
      enabledProp,
    ],
    expressions: {
      IsMoving: (i) => (i.state.follower?.moving ? 1 : 0),
      IsFollowing: (i) => (i.state.follower?.stay ? 0 : 1),
      Distance: (i) => i.state.follower?.dist ?? 0,
      IsAttacking: (i) => (i.state.follower?.foe != null ? 1 : 0),
    },
    tick(inst, p, host, dt) {
      const w = host.world, st = (inst.state.follower ??= { stay: false, moving: false, dist: 0, vy: 0, path: null as Vec[] | null, pathAt: 0 });
      if (dead(inst) || busy(inst)) return;
      const leader = nearest(w, inst, String(p.target));
      let moving = false;
      st.attackIn = Math.max(0, (st.attackIn ?? 0) - dt);
      st.swing = Math.max(0, (st.swing ?? 0) - dt);
      if (leader && !leader.destroyed) {
        const [a, b] = plane(w, inst);
        const [ga, gb] = followSpot(w, leader, [a, b], Number(p.distance), String(p.side));
        const dist = w.planarDistance(inst, leader);
        st.dist = dist;
        const far = Number(p.teleportAt);
        const walk = (ga: number, gb: number, to: RInstance) => {
          stepToward(host, inst, st, ga, gb, Number(dist > Number(p.runAt) || to !== leader ? p.runSpeed : p.speed), to, p, dt);
          moving = true;
        };
        // Attacking: the nearest living enemy it can see, near it and near enough to the leader. When told to stay it
        // holds its ground and only hits what comes within reach.
        let foe: RInstance | null = null;
        if (p.attack && host.damage && dist <= Number(p.leash)) {
          const old = st.foe != null ? w.byUid.get(st.foe) : undefined;
          const usable = (o: RInstance | undefined): o is RInstance => !!o && !o.destroyed && !!o.state.health && !o.state.health.dead && w.planarDistance(leader, o) <= Number(p.leash);
          const reach = st.stay ? Number(p.attackReach) : Number(p.attackRange);
          if (usable(old) && w.planarDistance(inst, old) <= reach * 1.5) foe = old;
          else {
            let bd = reach;
            for (const o of w.of(String(p.enemy))) {
              if (o === inst || !usable(o)) continue;
              const d = w.planarDistance(inst, o);
              if (d <= bd && lineOfSight(w, inst, o)) { bd = d; foe = o; }
            }
          }
        }
        if (foe) {
          if (st.foe !== foe.uid) { st.foe = foe.uid; st.path = null; st.fought = true; }
          const [fa, fb] = plane(w, foe), gap = w.planarDistance(inst, foe);
          if (gap > Number(p.attackReach)) { if (!st.stay) walk(fa, fb, foe); }
          else {
            face(w, inst, foe.x - inst.x, xz(w) ? foe.z - inst.z : 0, Number(p.turnSpeed), dt);
            if (st.attackIn <= 0) {
              st.attackIn = Number(p.attackCooldown); st.swing = 0.35;
              host.damage!(foe, Number(p.attackDamage));
              host.queueTrigger('combat.on_hit', { [foe.type]: [foe] });
              host.queueTrigger('follower.on_attack', foe.type === inst.type ? { [inst.type]: [inst, foe] } : { [inst.type]: [inst], [foe.type]: [foe] });
            }
          }
        } else if (st.foe != null) { st.foe = null; st.path = null; }
        if (!foe && !st.stay && far > 0 && dist > far) {
          // Left far behind: appear at its place (where nothing solid is in the way, else on the leader).
          if (xz(w)) { inst.x = ga; inst.z = gb; inst.y = leader.y; } else { inst.x = ga; inst.y = gb; }
          const box = w.aabb(inst);
          const clash = w.blockersFor(inst).some((s) => { const o = w.aabb(s); return box[0] < o[3] && box[3] > o[0] && box[1] < o[4] && box[4] > o[1] && box[2] < o[5] && box[5] > o[2]; });
          if (clash) { inst.x = leader.x; inst.z = leader.z; inst.y = leader.y; }
          st.path = null; st.vy = 0;
          trig(host, 'follower.on_teleported', inst);
        } else if (!foe && !st.stay) {
          const off = Math.hypot(ga - a, gb - b);
          // A little slack at the place, so it stands still instead of twitching as the leader shifts.
          if (off > 0.35 + (st.moving ? 0 : 0.5)) walk(ga, gb, leader);
          else {
            face(w, inst, leader.x - inst.x, xz(w) ? leader.z - inst.z : 0, Number(p.turnSpeed) * 0.3, dt);
            if (st.fought) { st.fought = false; trig(host, 'follower.on_returned', inst); }
          }
        }
        if (p.flying) inst.y += (leader.y + Number(p.hover) - inst.y) * Math.min(1, dt * 4);
      }
      // On the ground: falls, and rides up steps through the move above.
      if (!p.flying) {
        st.vy -= Number(p.gravity) * dt;
        const hits = moveAndCollide(w, inst, 0, st.vy * dt, 0, w.blockersFor(inst));
        if (hits.some((h) => h.axis === 1)) st.vy = 0;
      }
      st.moving = moving;
      if (st.swing > 0 && p.attackAnim) inst.animation = String(p.attackAnim);
      else anim(inst, p, moving);
    },
  },
  pathfollow: {
    id: 'pathfollow', name: 'Path follower', icon: '⤳',
    doc: 'Walks a route you draw in the scene (select the object, then "Draw path" in its Path section). Loop around, go back and forth, or stop at the end. Pauses at points that have a wait time. Triggers: AI › On reached path point / On path finished.',
    props: [
      { key: 'speed', label: 'Speed', type: 'number', default: 2.5, min: 0, step: 0.25, doc: 'm/s' },
      { key: 'mode', label: 'At the end', type: 'choice', default: 'loop', options: ['loop', 'back and forth', 'stop'], doc: 'loop: continue to the first point; back and forth: walk the route in reverse; stop: stay at the last point.' },
      { key: 'wait', label: 'Wait at each point (s)', type: 'number', default: 0, min: 0, step: 0.25, doc: 'Pause at every point. A point\'s own wait time (Path section) replaces this.' },
      { key: 'startDelay', label: 'Start delay (s)', type: 'number', default: 0, min: 0, step: 0.25 },
      { key: 'faceDirection', label: 'Face where it walks', type: 'boolean', default: true },
      { key: 'turnSpeed', label: 'Turn speed (°/s)', type: 'number', default: 360, min: 0, advanced: true },
      { key: 'followHeight', label: 'Follow point heights', type: 'boolean', default: true, doc: '3D: also move up and down to each point\'s height (stairs, ramps). Off: keep the current height.' },
      ...animProps('walk', 'idle'),
      enabledProp,
    ],
    expressions: {
      PointIndex: (i) => i.state.pathf?.index ?? 0,
      PointCount: (i) => i.path?.points.length ?? 0,
      IsWaiting: (i) => (i.state.pathf?.wait > 0 ? 1 : 0),
      IsFinished: (i) => (i.state.pathf?.done ? 1 : 0),
    },
    tick(inst, p, host, dt) {
      const w = host.world;
      const pts = inst.path?.points ?? [];
      const st = (inst.state.pathf ??= { index: 0, dir: 1, wait: Number(p.startDelay), done: false, paused: false });
      if (busy(inst) || st.paused || st.done || pts.length === 0 || dead(inst)) { if (!busy(inst)) anim(inst, p, false); return; }
      if (st.wait > 0) { st.wait -= dt; anim(inst, p, false); return; }
      const idx = Math.min(st.index, pts.length - 1);
      const [tx, ty, tz] = pts[idx];
      const [ta, tb] = plane(w, { x: tx, y: ty, z: tz });
      const [ca, cb] = plane(w, inst);
      const da = ta - ca, db = tb - cb, d = Math.hypot(da, db);
      const step = Number(p.speed) * dt;
      if (d <= Math.max(0.05, step)) {
        // Arrived at a point.
        movePlanar(host, inst, da, db);
        trig(host, 'npc.on_point', inst, { index: idx }); trig(host, 'path.on_point', inst, { index: idx });
        st.wait = Number(inst.path?.waits?.[idx] ?? 0) || Number(p.wait);
        const last = st.dir > 0 ? idx >= pts.length - 1 : idx <= 0;
        if (last) {
          if (p.mode === 'stop') { st.done = true; trig(host, 'npc.on_path_end', inst); trig(host, 'path.on_end', inst); anim(inst, p, false); return; }
          if (p.mode === 'back and forth' && pts.length > 1) st.dir = -st.dir;
          else st.index = -1; // loop: next is 0
          trig(host, 'npc.on_path_end', inst); trig(host, 'path.on_end', inst);
        }
        st.index = Math.max(0, Math.min(pts.length - 1, st.index + st.dir));
        return;
      }
      const ua = da / d, ub = db / d;
      const m = Math.min(step, d);
      // Height: glide toward the point's height in 3D (ramps, stairs) when asked.
      const dh = xz(w) && p.followHeight !== false ? approach(inst.y, ty, Math.abs(ty - inst.y) * (m / d) + 1e-6) - inst.y : 0;
      inst.vx = ua * Number(p.speed); if (xz(w)) inst.vz = ub * Number(p.speed); else inst.vy = ub * Number(p.speed);
      if (movePlanar(host, inst, ua * m, ub * m, dh)) {
        // Blocked (another character in the way): wait a moment and try again.
        st.blockedT = (st.blockedT ?? 0) + dt;
        if (st.blockedT > 2) { st.blockedT = 0; st.index = Math.max(0, Math.min(pts.length - 1, st.index + st.dir)); }
      } else st.blockedT = 0;
      if (p.faceDirection) face(w, inst, ua, ub, Number(p.turnSpeed), dt);
      anim(inst, p, true);
    },
  },

  wander: {
    id: 'wander', name: 'Wander', icon: '∾',
    doc: 'Roams randomly around where it started: walks to a random spot inside the radius, stands for a while, then picks another. Walls make it choose a new spot.',
    props: [
      { key: 'radius', label: 'Wander radius', type: 'number', default: 5, min: 0.5, step: 0.5, doc: 'Distance from the start position it may go.' },
      { key: 'speed', label: 'Speed', type: 'number', default: 1.8, min: 0, step: 0.25 },
      { key: 'minWait', label: 'Idle at least (s)', type: 'number', default: 1, min: 0, step: 0.25 },
      { key: 'maxWait', label: 'Idle at most (s)', type: 'number', default: 4, min: 0, step: 0.25 },
      { key: 'maxWalk', label: 'Longest walk (s)', type: 'number', default: 6, min: 0.5, step: 0.5, doc: 'Gives up on a spot it cannot reach in time.' },
      { key: 'faceDirection', label: 'Face where it walks', type: 'boolean', default: true },
      { key: 'turnSpeed', label: 'Turn speed (°/s)', type: 'number', default: 300, min: 0, advanced: true },
      ...animProps('walk', 'idle'),
      enabledProp,
    ],
    expressions: { IsMoving: (i) => (i.state.wander?.target ? 1 : 0) },
    tick(inst, p, host, dt) {
      const w = host.world;
      const rnd = rand(inst);
      const st = (inst.state.wander ??= { target: null as Vec | null, wait: Number(p.minWait) * rnd(), walkT: 0 });
      home(inst);
      if (busy(inst) || dead(inst)) { st.target = null; return; }
      if (!st.target) {
        anim(inst, p, false);
        st.wait -= dt;
        if (st.wait > 0) return;
        st.target = randomAround(w, inst, Number(p.radius), rnd); st.walkT = 0;
      }
      const [ca, cb] = plane(w, inst);
      const da = st.target[0] - ca, db = st.target[1] - cb, d = Math.hypot(da, db);
      const step = Number(p.speed) * dt;
      st.walkT += dt;
      const rest = () => { st.target = null; const lo = Number(p.minWait), hi = Math.max(lo, Number(p.maxWait)); st.wait = lo + (hi - lo) * rnd(); inst.vx = inst.vz = 0; if (!xz(w)) inst.vy = 0; };
      if (d <= Math.max(0.08, step) || st.walkT > Number(p.maxWalk)) { rest(); return; }
      const ua = da / d, ub = db / d;
      inst.vx = ua * Number(p.speed); if (xz(w)) inst.vz = ub * Number(p.speed); else inst.vy = ub * Number(p.speed);
      if (movePlanar(host, inst, ua * Math.min(step, d), ub * Math.min(step, d))) { rest(); return; }
      if (p.faceDirection) face(w, inst, ua, ub, Number(p.turnSpeed), dt);
      anim(inst, p, true);
    },
  },

  npctalk: {
    id: 'npctalk', name: 'NPC interaction', icon: '❝',
    doc: 'Makes a character social: now and then it notices the player nearby, walks up, stops at talking distance and starts a conversation (pick one from the Dialogue editor) or just fires "On interaction". The player can also walk up and press the talk key. Afterwards it goes back to its Path follower / Wander routine. Triggers: AI › On approaching player / On interaction / On interaction ended.',
    props: [
      targetProp('Who it talks to.'),
      { key: 'dialogue', label: 'Dialogue to start', type: 'string', default: '', doc: 'Name of a conversation from the Dialogue editor. Empty: no dialogue, only the triggers (and the talk time below).' },
      { key: 'detectRange', label: 'Notice player within', type: 'number', default: 6, min: 0, step: 0.5 },
      { key: 'approach', label: 'Walks up on its own', type: 'boolean', default: true },
      { key: 'chance', label: 'Chance to approach (%)', type: 'number', default: 50, min: 0, max: 100, step: 5, doc: 'Each time it checks (every few seconds) while the player is in range.' },
      { key: 'checkEvery', label: 'Check every (s)', type: 'number', default: 3, min: 0.2, step: 0.5 },
      { key: 'stopDistance', label: 'Talking distance', type: 'number', default: 1.6, min: 0.2, step: 0.1 },
      { key: 'speed', label: 'Walk speed', type: 'number', default: 2.5, min: 0, step: 0.25 },
      { key: 'talkKey', label: 'Player talk key', type: 'string', default: 'E', doc: 'Pressing this key near the NPC starts the interaction. Empty: only the NPC starts it.' },
      { key: 'talkTime', label: 'Talk time without dialogue (s)', type: 'number', default: 3, min: 0, step: 0.5 },
      { key: 'cooldown', label: 'Wait before approaching again (s)', type: 'number', default: 20, min: 0, step: 1 },
      { key: 'giveUp', label: 'Give up after (s)', type: 'number', default: 8, min: 1, step: 1, doc: 'Stops walking up if it has not reached the player by then.' },
      ...animProps('walk', 'idle'),
      enabledProp,
    ],
    expressions: {
      IsInteracting: (i) => (i.state.npc?.mode === 'talk' ? 1 : 0),
      IsApproaching: (i) => (i.state.npc?.mode === 'approach' ? 1 : 0),
    },
    tick(inst, p, host, dt) {
      const w = host.world;
      const rnd = rand(inst);
      const st = (inst.state.npc ??= { mode: 'idle', t: 0, check: Number(p.checkEvery) * rnd(), cooldown: 0, ownDialogue: false });
      const target = nearest(w, inst, String(p.target));
      if (dead(inst)) { inst.state.npcBusy = false; return; }
      st.cooldown = Math.max(0, st.cooldown - dt); st.t += dt;
      const dist = target ? w.planarDistance(inst, target) : Infinity;
      const facePlayer = () => { if (!target) return; const [a1, b1] = plane(w, inst), [a2, b2] = plane(w, target); face(w, inst, a2 - a1, b2 - b1, 720, dt); };
      const begin = () => {
        st.mode = 'talk'; st.t = 0; inst.state.npcBusy = true;
        inst.vx = inst.vz = 0; if (!xz(w)) inst.vy = 0;
        trig(host, 'npc.on_interact', inst);
        const name = String(p.dialogue ?? '').trim();
        st.ownDialogue = !!name && !!host.openDialogue && !host.dialogueOpen?.();
        if (st.ownDialogue) host.openDialogue!(name);
      };
      const end = () => { st.mode = 'idle'; st.t = 0; st.cooldown = Number(p.cooldown); inst.state.npcBusy = false; trig(host, 'npc.on_interact_end', inst); };
      // The player can start it: talk key while close.
      const key = String(p.talkKey ?? '').trim();
      if (st.mode !== 'talk' && key && target && dist <= Number(p.stopDistance) + 0.8 && host.input.anyPressed([key]) && !host.dialogueOpen?.()) { begin(); return; }
      switch (st.mode) {
        case 'idle': {
          if (!p.approach || !target || st.cooldown > 0 || host.dialogueOpen?.()) return;
          st.check -= dt;
          if (st.check > 0) return;
          st.check = Number(p.checkEvery);
          if (dist <= Number(p.detectRange) && rnd() * 100 < Number(p.chance) && lineOfSight(w, inst, target)) {
            st.mode = 'approach'; st.t = 0; inst.state.npcBusy = true;
            trig(host, 'npc.on_approach', inst);
          }
          return;
        }
        case 'approach': {
          if (!target || st.t > Number(p.giveUp) || dist > Number(p.detectRange) * 2) { st.mode = 'idle'; st.cooldown = Number(p.cooldown) * 0.5; inst.state.npcBusy = false; return; }
          if (dist <= Number(p.stopDistance)) { facePlayer(); begin(); return; }
          const [a1, b1] = plane(w, inst), [a2, b2] = plane(w, target);
          const da = a2 - a1, db = b2 - b1, l = Math.hypot(da, db) || 1;
          const m = Math.min(Number(p.speed) * dt, dist - Number(p.stopDistance));
          movePlanar(host, inst, (da / l) * m, (db / l) * m);
          face(w, inst, da, db, 540, dt);
          anim(inst, p, true);
          return;
        }
        case 'talk': {
          facePlayer();
          anim(inst, p, false);
          const finished = st.ownDialogue ? !host.dialogueOpen?.() : st.t >= Number(p.talkTime);
          // Also end when the player walks away from a dialogue-less chat.
          if (finished || (!st.ownDialogue && dist > Number(p.detectRange) * 1.5)) end();
          return;
        }
      }
    },
  },

  slime: {
    id: 'slime', name: 'Slime enemy', icon: '◒',
    doc: 'A hopping enemy. It idles and hops around its start, spots the player in range, hops after them and hurts them on contact (with a cooldown and knockback). Add Health to make it defeatable: it plays "death" and disappears. 2D: top-down unless "Side view" is on. Triggers: AI › On spotted player / On enemy attack.',
    props: [
      targetProp('Who it chases and hurts.'),
      { key: 'detectRange', label: 'Spot player within', type: 'number', default: 7, min: 0, step: 0.5 },
      { key: 'loseRange', label: 'Give up beyond', type: 'number', default: 12, min: 0, step: 0.5 },
      { key: 'hopEvery', label: 'Hop every (s)', type: 'number', default: 0.9, min: 0.1, step: 0.05 },
      { key: 'hopSpeed', label: 'Hop distance speed', type: 'number', default: 3, min: 0, step: 0.25, doc: 'Horizontal speed during a hop (m/s).' },
      { key: 'hopHeight', label: 'Hop strength', type: 'number', default: 6, min: 0, step: 0.5, doc: 'Upward speed of a hop (3D and side view).' },
      { key: 'chaseFaster', label: 'Chase hop multiplier', type: 'number', default: 1.5, min: 1, step: 0.1 },
      { key: 'wanderRadius', label: 'Wander radius', type: 'number', default: 4, min: 0, step: 0.5 },
      { key: 'attackRange', label: 'Attack range', type: 'number', default: 1.1, min: 0.1, step: 0.1 },
      { key: 'damage', label: 'Damage', type: 'number', default: 10, min: 0 },
      { key: 'attackCooldown', label: 'Seconds between attacks', type: 'number', default: 1, min: 0, step: 0.1 },
      { key: 'knockback', label: 'Knockback', type: 'number', default: 6, min: 0 },
      { key: 'gravity', label: 'Gravity', type: 'number', default: 22, min: 0, advanced: true },
      { key: 'sideView', label: 'Side view (2D)', type: 'boolean', default: false, doc: '2D platformers: hop up with gravity and move left/right only.' },
      { key: 'destroyOnDeath', label: 'Remove when defeated', type: 'boolean', default: true },
      { key: 'deathTime', label: 'Death animation time (s)', type: 'number', default: 0.8, min: 0, step: 0.1 },
      enabledProp,
    ],
    expressions: { State: (i) => i.state.enemy?.state ?? 'idle', IsAirborne: (i) => (i.state.slime?.air ? 1 : 0) },
    tick(inst, p, host, dt) {
      const w = host.world;
      const rnd = rand(inst);
      const st = (inst.state.enemy ??= { state: 'idle', t: 0, cooldown: 0 });
      const sl = (inst.state.slime ??= { air: false, hopT: Number(p.hopEvery) * rnd(), dir: [0, 0] as Vec, wanderTo: null as Vec | null, burst: 0 });
      home(inst);
      st.t += dt; st.cooldown = Math.max(0, st.cooldown - dt);
      const gravityAxis = xz(w) || !!p.sideView;
      // Fall / land (3D and side view).
      if (gravityAxis) {
        inst.vy = Math.max(-40, inst.vy - Number(p.gravity) * dt);
        const hv = sl.air ? 1 : 0;
        const hits = xz(w)
          ? moveAndCollide(w, inst, inst.vx * dt * hv, inst.vy * dt, inst.vz * dt * hv, w.blockersFor(inst))
          : moveAndCollide(w, inst, inst.vx * dt * hv, inst.vy * dt, 0, w.blockersFor(inst));
        const landed = hits.some((h) => h.axis === 1 && h.sign < 0);
        if (hits.some((h) => h.axis === 1)) inst.vy = 0;
        if (hits.some((h) => h.axis !== 1)) { inst.vx = 0; inst.vz = 0; }
        if (landed && sl.air) { sl.air = false; inst.vx = inst.vz = 0; inst.animation = 'land'; }
      }
      if (dying(host, inst, p, dt)) return;
      const target = nearest(w, inst, String(p.target));
      const dist = target ? w.planarDistance(inst, target) : Infinity;
      // Think: spot, give up, attack.
      if (st.state !== 'chase' && sees(host, inst, target, Number(p.detectRange))) setState(host, inst, 'chase');
      else if (st.state === 'chase' && (!target || dead(target) || dist > Number(p.loseRange))) setState(host, inst, 'wander');
      if (target && st.state === 'chase' && st.cooldown <= 0) {
        const near = dist <= Number(p.attackRange) && Math.abs(target.y - inst.y) < Math.max(1.2, Number(p.attackRange) + 0.5);
        if (near) hitTarget(host, inst, target, p);
      }
      // Top-down 2D: a hop is a short burst of movement.
      if (!gravityAxis && sl.burst > 0) {
        sl.burst -= dt;
        const sp = Number(p.hopSpeed) * (st.state === 'chase' ? Number(p.chaseFaster) : 1) * Math.sin(Math.PI * Math.max(0, sl.burst) / 0.45) * 1.6;
        if (movePlanar(host, inst, sl.dir[0] * sp * dt, sl.dir[1] * sp * dt)) sl.burst = 0;
        inst.animation = 'jump';
        if (sl.burst <= 0) { sl.air = false; inst.animation = 'land'; }
        return;
      }
      if (sl.air) return;
      sl.hopT -= dt;
      if (sl.hopT > 0) { if (inst.animation !== 'land' || sl.hopT < Number(p.hopEvery) * 0.6) inst.animation = 'idle'; return; }
      // Choose where to hop.
      const [ca, cb] = plane(w, inst);
      let to: Vec;
      if (st.state === 'chase' && target) to = plane(w, target);
      else {
        if (st.state === 'idle' && st.t > 1.5) setState(host, inst, 'wander');
        if (!sl.wanderTo || Math.hypot(sl.wanderTo[0] - ca, sl.wanderTo[1] - cb) < 0.6 || rnd() < 0.25) sl.wanderTo = randomAround(w, inst, Number(p.wanderRadius), rnd);
        to = sl.wanderTo!;
      }
      const chase = st.state === 'chase';
      sl.hopT = Number(p.hopEvery) * (chase ? 0.7 : 1 + rnd() * 0.8);
      let da = to[0] - ca, db = to[1] - cb;
      if (!xz(w) && p.sideView) db = 0; // side view: left/right only
      const l = Math.hypot(da, db) || 1;
      sl.dir = [da / l, db / l];
      face(w, inst, sl.dir[0], sl.dir[1], 9999, 1);
      const sp = Number(p.hopSpeed) * (chase ? Number(p.chaseFaster) : 1);
      sl.air = true; inst.animation = 'jump';
      if (gravityAxis) {
        inst.vy = Number(p.hopHeight) * (chase ? 1.1 : 1);
        inst.vx = sl.dir[0] * sp; if (xz(w)) inst.vz = sl.dir[1] * sp;
      } else sl.burst = 0.45;
    },
  },

  flyer: {
    id: 'flyer', name: 'Flying enemy', icon: '⋎',
    doc: 'A flying enemy (bat, bird, drone, ghost). It hovers at a set height above its start, bobbing, roams the air around home, chases the player when it spots them and swoops down to attack, then climbs back up. With Health it falls and disappears when defeated. In 2D the height is up the screen (side view). Triggers: AI › On spotted player / On enemy attack.',
    props: [
      targetProp('Who it chases and attacks.'),
      { key: 'height', label: 'Flight height', type: 'number', default: 3, min: 0, step: 0.25, doc: 'Height above where it was placed.' },
      { key: 'speed', label: 'Flying speed', type: 'number', default: 3.5, min: 0, step: 0.25 },
      { key: 'wanderRadius', label: 'Roam radius', type: 'number', default: 6, min: 0, step: 0.5 },
      { key: 'detectRange', label: 'Spot player within', type: 'number', default: 10, min: 0, step: 0.5 },
      { key: 'loseRange', label: 'Give up beyond', type: 'number', default: 16, min: 0, step: 0.5 },
      { key: 'attackRange', label: 'Swoop when within', type: 'number', default: 3, min: 0.2, step: 0.25, doc: 'Horizontal distance at which it dives at the player.' },
      { key: 'diveSpeed', label: 'Swoop speed', type: 'number', default: 8, min: 0, step: 0.5 },
      { key: 'damage', label: 'Damage', type: 'number', default: 10, min: 0 },
      { key: 'attackCooldown', label: 'Seconds between attacks', type: 'number', default: 1.5, min: 0, step: 0.1 },
      { key: 'knockback', label: 'Knockback', type: 'number', default: 5, min: 0 },
      { key: 'bob', label: 'Hover bob (m)', type: 'number', default: 0.25, min: 0, step: 0.05 },
      { key: 'bobSpeed', label: 'Bob speed', type: 'number', default: 2, min: 0, step: 0.25, advanced: true },
      { key: 'destroyOnDeath', label: 'Remove when defeated', type: 'boolean', default: true },
      { key: 'deathTime', label: 'Fall time when defeated (s)', type: 'number', default: 1.2, min: 0, step: 0.1 },
      enabledProp,
    ],
    expressions: { State: (i) => i.state.enemy?.state ?? 'hover', Altitude: (i) => i.y - (i.state.home?.[1] ?? i.y) },
    tick(inst, p, host, dt) {
      const w = host.world;
      const rnd = rand(inst);
      const st = (inst.state.enemy ??= { state: 'hover', t: 0, cooldown: 0 });
      const fl = (inst.state.flyer ??= { to: null as Vec | null, phase: rnd() * 6.28 });
      const h0 = home(inst);
      st.t += dt; st.cooldown = Math.max(0, st.cooldown - dt); fl.phase += dt * Number(p.bobSpeed);
      if (dead(inst)) {
        // Fall out of the sky, then disappear.
        inst.vy = Math.max(-25, inst.vy - 20 * dt);
        moveAndCollide(w, inst, 0, inst.vy * dt, 0, w.blockersFor(inst));
        dying(host, inst, p, dt);
        return;
      }
      const target = nearest(w, inst, String(p.target));
      const dist = target ? w.planarDistance(inst, target) : Infinity;
      const cruise = h0[1] + Number(p.height);
      const [ca, cb] = plane(w, inst);
      // 2D side view: "planar" movement is x only; height is y.
      const side = !xz(w);
      let goalA = ca, goalB = side ? 0 : cb, goalY = cruise + Math.sin(fl.phase) * Number(p.bob), sp = Number(p.speed);
      if (st.state !== 'chase' && st.state !== 'dive' && st.state !== 'climb' && sees(host, inst, target, Number(p.detectRange))) setState(host, inst, 'chase');
      if ((st.state === 'chase' || st.state === 'climb') && (!target || dead(target) || dist > Number(p.loseRange))) setState(host, inst, 'hover');
      switch (st.state) {
        case 'hover': case 'wander': {
          if (!fl.to || Math.hypot(fl.to[0] - ca, side ? 0 : fl.to[1] - cb) < 0.5) {
            if (st.state === 'hover' && st.t < 1 + rnd() * 2) break;
            fl.to = randomAround(w, inst, Number(p.wanderRadius), rnd);
            setState(host, inst, 'wander');
          }
          goalA = fl.to[0]; if (!side) goalB = fl.to[1];
          sp *= 0.7;
          if (st.t > 8) { setState(host, inst, 'hover'); fl.to = null; }
          break;
        }
        case 'chase': {
          const [ta, tb] = plane(w, target!);
          goalA = ta; if (!side) goalB = tb;
          goalY = Math.max(target!.y + Number(p.height) * 0.6, target!.y + 1.2) + Math.sin(fl.phase) * Number(p.bob);
          if (dist <= Number(p.attackRange) && st.cooldown <= 0) setState(host, inst, 'dive');
          break;
        }
        case 'dive': {
          const [ta, tb] = plane(w, target!);
          goalA = ta; if (!side) goalB = tb; goalY = target!.y + 0.4; sp = Number(p.diveSpeed);
          inst.animation = 'attack';
          const close = dist <= 0.9 && Math.abs(inst.y - (target!.y + 0.5)) < 1.1;
          if (close) { hitTarget(host, inst, target!, p); setState(host, inst, 'climb'); }
          else if (st.t > 1.6) { st.cooldown = Number(p.attackCooldown) * 0.5; setState(host, inst, 'climb'); }
          break;
        }
        case 'climb': {
          goalY = cruise; sp = Number(p.speed) * 1.2;
          // Back off a little while climbing.
          if (target) { const [ta, tb] = plane(w, target); const da = ca - ta, db = side ? 0 : cb - tb, l = Math.hypot(da, db) || 1; goalA = ca + (da / l) * 2; if (!side) goalB = cb + (db / l) * 2; }
          if (Math.abs(inst.y - cruise) < 0.3 || st.t > 2) setState(host, inst, target && dist <= Number(p.loseRange) ? 'chase' : 'hover');
          break;
        }
      }
      // Fly toward the goal (planar + height), colliding with solids.
      const da = goalA - ca, db = side ? 0 : goalB - cb, dy = goalY - inst.y;
      const len = Math.hypot(da, db, dy);
      const step = sp * dt;
      if (len > 0.02) {
        const k = Math.min(step, len) / len;
        inst.vx = (da / len) * sp; inst.vy = (dy / len) * sp; if (xz(w)) inst.vz = (db / len) * sp;
        if (xz(w)) moveAndCollide(w, inst, da * k, dy * k, db * k, w.blockersFor(inst));
        else moveAndCollide(w, inst, da * k, dy * k, 0, w.blockersFor(inst));
        if (Math.hypot(da, db) > 0.05) face(w, inst, da, db, 540, dt);
      } else { inst.vx = inst.vy = inst.vz = 0; }
      if (st.state !== 'dive') inst.animation = Math.hypot(da, db) > 0.3 ? 'fly' : 'idle';
    },
  },

  // Moves only while the player is not looking at it (and freezes the moment it is seen).
  unseen: {
    id: 'unseen', name: 'Moves when unseen', icon: '◐',
    doc: 'A creepy enemy: it freezes while the player looks at it (it is inside the player\'s view and not hidden behind walls) and creeps closer while they look away. Touching the player attacks. 3D: the view is the camera; 2D: the way the player faces.',
    props: [
      targetProp('The player whose gaze freezes it.'),
      { key: 'detectRange', label: 'Detection distance', type: 'number', default: 25, min: 0, step: 1, doc: 'It only hunts players closer than this.' },
      { key: 'speed', label: 'Speed (m/s)', type: 'number', default: 4, min: 0, step: 0.25 },
      { key: 'viewAngle', label: 'Player view angle (°)', type: 'number', default: 100, min: 10, max: 360, step: 5, doc: 'How wide the player sees: inside this cone it counts as watched.' },
      { key: 'viewer', label: 'Watched by', type: 'choice', default: 'camera', options: ['camera', 'player facing'], doc: '3D: camera = whenever it is on screen (the game camera\'s real view, any camera style; the view angle is not used); player facing = inside the player\'s own view cone.' },
      { key: 'walls', label: 'Walls hide it', type: 'boolean', default: true, doc: 'Behind a Solid wall it is not seen (and moves).' },
      { key: 'checkEvery', label: 'Look check every (s)', type: 'number', default: 0.05, min: 0, step: 0.05, doc: 'Update frequency of the seen / unseen check.' },
      { key: 'damage', label: 'Damage', type: 'number', default: 20, min: 0 },
      { key: 'attackRange', label: 'Attack reach (m)', type: 'number', default: 0.8, min: 0, step: 0.1 },
      { key: 'attackCooldown', label: 'Attack cooldown (s)', type: 'number', default: 1, min: 0, step: 0.1 },
      { key: 'knockback', label: 'Knockback', type: 'number', default: 4, min: 0, step: 0.5, advanced: true },
      ...animProps('walk', 'idle'),
      enabledProp,
    ],
    expressions: { IsSeen: (i) => (i.state.enemy?.seen ? 1 : 0), IsMoving: (i) => (i.state.enemy?.moving ? 1 : 0) },
    tick(inst, p, host, dt) {
      const w = host.world;
      const st = (inst.state.enemy ??= { state: 'idle', t: 0, cooldown: 0, seen: false, moving: false, check: 0 });
      if (dying(host, inst, p, dt)) return;
      st.cooldown = Math.max(0, st.cooldown - dt);
      const target = nearest(w, inst, String(p.target ?? 'Player'));
      if (!target || dead(target) || w.planarDistance(inst, target) > Number(p.detectRange ?? 25)) { st.moving = false; anim(inst, p, false); return; }
      st.check -= dt;
      if (st.check <= 0) {
        st.check = Number(p.checkEvery ?? 0.05);
        // Inside the viewer's cone and not hidden behind a wall = seen.
        const [ta, tb] = plane(w, target), [ia, ib] = plane(w, inst);
        let fa: number, fb: number;
        if (xz(w) && p.viewer !== 'player facing') [fa, fb] = host.cameraForward;
        else { const a = (w.angle(target) * Math.PI) / 180; fa = Math.cos(a); fb = xz(w) ? -Math.sin(a) : Math.sin(a); if (!xz(w) && target.sprite) { fa = target.sprite.flipX ? -1 : 1; fb = 0; } }
        const da = ia - ta, db = ib - tb, l = Math.hypot(da, db) || 1, fl = Math.hypot(fa, fb) || 1;
        const cos = (da * fa + db * fb) / (l * fl);
        const inCone = cos >= Math.cos(((Number(p.viewAngle ?? 100) / 2) * Math.PI) / 180);
        const wasSeen = st.seen;
        // 3D with "camera": on the player's screen, from the game camera itself (third person, top-down, first
        // person alike). Otherwise the player's own view cone.
        if (xz(w) && p.viewer !== 'player facing' && host.cameraSees) st.seen = host.cameraSees(inst, p.walls !== false);
        else st.seen = inCone && (p.walls === false || lineOfSight(w, target, inst));
        if (st.seen && !wasSeen) trig(host, 'enemy.on_seen', inst);
      }
      if (st.seen) { inst.vx = 0; inst.vz = 0; if (!xz(w)) inst.vy = 0; st.moving = false; anim(inst, p, false); return; }
      // Not watched: creep closer; attack when close.
      const [ta, tb] = plane(w, target), [ia, ib] = plane(w, inst);
      const da = ta - ia, db = tb - ib, d = Math.hypot(da, db);
      if (d <= Number(p.attackRange ?? 0.8) + 0.4 && st.cooldown <= 0) hitTarget(host, inst, target, p);
      if (d > Number(p.attackRange ?? 0.8)) {
        const sp = Number(p.speed ?? 4);
        movePlanar(host, inst, (da / d) * sp * dt, (db / d) * sp * dt);
        face(w, inst, da, db, 720, dt);
        st.moving = true;
      } else st.moving = false;
      anim(inst, p, st.moving);
    },
  },

  // Moves only while the player moves (stops the moment they stand still).
  mimic: {
    id: 'mimic', name: 'Moves when you move', icon: '⇆',
    doc: 'An enemy that moves only while the player moves and stops dead when they stand still (a game of statues). It heads for the player; touching them attacks.',
    props: [
      targetProp('The player it watches.'),
      { key: 'detectRange', label: 'Detection distance', type: 'number', default: 30, min: 0, step: 1 },
      { key: 'speed', label: 'Speed (m/s)', type: 'number', default: 3.5, min: 0, step: 0.25 },
      { key: 'matchSpeed', label: 'Match the player\'s speed', type: 'boolean', default: false, doc: 'Move as fast as the player is moving (times Speed ÷ 5) instead of a fixed speed.' },
      { key: 'threshold', label: 'Counts as moving above (m/s)', type: 'number', default: 0.3, min: 0, step: 0.05 },
      { key: 'checkEvery', label: 'Check every (s)', type: 'number', default: 0, min: 0, step: 0.05, doc: 'Update frequency (0 = every tick). A delay makes it react late — fairer, or creepier.' },
      { key: 'damage', label: 'Damage', type: 'number', default: 20, min: 0 },
      { key: 'attackRange', label: 'Attack reach (m)', type: 'number', default: 0.8, min: 0, step: 0.1 },
      { key: 'attackCooldown', label: 'Attack cooldown (s)', type: 'number', default: 1, min: 0, step: 0.1 },
      { key: 'knockback', label: 'Knockback', type: 'number', default: 4, min: 0, step: 0.5, advanced: true },
      ...animProps('walk', 'idle'),
      enabledProp,
    ],
    expressions: { IsMoving: (i) => (i.state.enemy?.moving ? 1 : 0) },
    tick(inst, p, host, dt) {
      const w = host.world;
      const st = (inst.state.enemy ??= { state: 'idle', t: 0, cooldown: 0, moving: false, check: 0, go: false, last: null as number[] | null, pspeed: 0 });
      if (dying(host, inst, p, dt)) return;
      st.cooldown = Math.max(0, st.cooldown - dt);
      const target = nearest(w, inst, String(p.target ?? 'Player'));
      if (!target || dead(target) || w.planarDistance(inst, target) > Number(p.detectRange ?? 30)) { st.moving = false; anim(inst, p, false); return; }
      // The player's speed, measured from its movement (works for any controller).
      const [ta, tb] = plane(w, target);
      const pspeed = st.last && dt > 0 ? Math.hypot(ta - st.last[0], tb - st.last[1]) / dt : 0;
      st.last = [ta, tb];
      st.check -= dt;
      if (st.check <= 0) { st.check = Number(p.checkEvery ?? 0); st.go = pspeed > Number(p.threshold ?? 0.3); st.pspeed = pspeed; }
      const [ia, ib] = plane(w, inst);
      const da = ta - ia, db = tb - ib, d = Math.hypot(da, db);
      if (st.go && d <= Number(p.attackRange ?? 0.8) + 0.4 && st.cooldown <= 0) hitTarget(host, inst, target, p);
      if (st.go && d > Number(p.attackRange ?? 0.8)) {
        const sp = p.matchSpeed ? st.pspeed * Number(p.speed ?? 3.5) / 5 : Number(p.speed ?? 3.5);
        movePlanar(host, inst, (da / d) * sp * dt, (db / d) * sp * dt);
        face(w, inst, da, db, 720, dt);
        st.moving = true;
      } else { st.moving = false; inst.vx = 0; inst.vz = 0; }
      anim(inst, p, st.moving);
    },
  },
};
