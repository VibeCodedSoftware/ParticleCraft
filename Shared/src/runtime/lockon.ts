// Player Lock-On / Dash Attack (the blocks of that pack, GameCraft): a character locks onto a target by range, view
// cone, line of sight and type or tag; a marker circle follows the target (drawn by the renderer from this state); the
// character dashes to it without passing through walls, stops at attack distance and attacks once on arrival.
// All of it lives in inst.state.lockon as plain data, so it is in saved games, and the host's runtime runs it online.
import { compareValues, toNum, toStr } from '../expr';
import type { BlockInstance } from '../schema';
import { moveAndCollide } from './physics';
import { lineOfSight } from './pathfinding';
import type { Ctx, Runtime } from './runtime';
import type { RInstance } from './world';

export const LOCK_PRIORITIES = ['nearest', 'most centred', 'lowest health', 'highest health'];
export const LOCK_SWITCH = ['next', 'previous'];
export const MARKER_ANIMS = ['pulse', 'spin', 'none'];
export const ATTACK_TYPES = ['strike', 'sweep', 'knockback'];

export interface LockOnState {
  target: number | null;
  /** Object type candidates must be ("" = any with Health), and a tag they must carry ("" = any). */
  type: string; tag: string;
  range: number; /** Full view cone in degrees (360 = all around). */ angle: number; los: boolean; priority: string;
  /** How long the target has been out of sight (a moment behind a pillar keeps the lock). */
  hidden: number;
  marker: { on: boolean; color: string; size: number; offset: [number, number, number]; anim: string };
  speed: number; /** Longest a dash lasts, in seconds. */ duration: number; /** Longest a dash travels, in metres. */ distance: number;
  attackDistance: number; cooldown: number; cooldownLeft: number;
  /** The dash under way. A dash from a click may go further than the usual limits: as far as it takes to get there. */
  dash: { time: number; travelled: number; stuck: number; maxTime?: number; maxDistance?: number } | null;
  /** A clicked target stays locked out to this distance, even beyond the range (0 = just the range). */
  holdRange?: number;
  attackOnArrival: boolean; damage: number; attackType: string; repeat: boolean; repeatEvery: number;
  /** Standing at the target after a dash (repeating attacks), and when the next one is due. */
  engaged: boolean; nextAttack: number;
}

/** A character's lock-on state, created with the defaults at first use. */
export function lockOf(inst: RInstance): LockOnState {
  return (inst.state.lockon ??= {
    target: null, type: '', tag: '', range: 15, angle: 120, los: true, priority: 'nearest', hidden: 0,
    marker: { on: true, color: '#ff2a2a', size: 1, offset: [0, 0.03, 0], anim: 'pulse' },
    speed: 18, duration: 0.8, distance: 16, attackDistance: 1.6, cooldown: 1, cooldownLeft: 0, dash: null,
    attackOnArrival: true, damage: 25, attackType: 'strike', repeat: false, repeatEvery: 0.6, engaged: false, nextAttack: 0,
  } satisfies LockOnState);
}

const alive = (t: RInstance | undefined): t is RInstance => !!t && !t.destroyed && !t.state.health?.dead;
const targetOf = (rt: Runtime, st: LockOnState) => { const t = st.target == null ? undefined : rt.world.byUid.get(st.target); return alive(t) ? t : undefined; };
const both = (a: RInstance, b?: RInstance) => (b && b.type !== a.type ? { [a.type]: [a], [b.type]: [b] } : { [a.type]: b && b !== a ? [a, b] : [a] });
const fire = (rt: Runtime, id: string, a: RInstance, b?: RInstance) => rt.queueTrigger('lockon.' + id, both(a, b));

/** Where the character looks: along the camera in first person, else its facing. */
function lookDir(rt: Runtime, i: RInstance): [number, number] {
  const xz = rt.world.plane === 'xz', cam = xz ? rt.activeCamera() : undefined, la = cam?.state.lookAt as [number, number, number] | undefined;
  if (cam && la && cam.behaviors.some((b) => b.type === 'follow' && b.props.firstPerson)) { const dx = la[0] - cam.x, dz = la[2] - cam.z, l = Math.hypot(dx, dz); if (l > 1e-3) return [dx / l, dz / l]; }
  const f = rt.world.forward(rt.world.angle(i));
  return xz ? [f[0], f[2]] : [f[0], f[1]];
}
const centre = (rt: Runtime, i: RInstance) => { const b = rt.world.aabb(i); return [(b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2]; };
/** Signed angle (degrees) from the look direction to a candidate, and its distance along the ground. */
function bearing(rt: Runtime, i: RInstance, c: RInstance): { deg: number; dist: number } {
  const xz = rt.world.plane === 'xz', a = centre(rt, i), b = centre(rt, c);
  const dx = b[0] - a[0], dy = xz ? b[2] - a[2] : b[1] - a[1], [lx, ly] = lookDir(rt, i);
  return { deg: (Math.atan2(lx * dy - ly * dx, lx * dx + ly * dy) * 180) / Math.PI, dist: rt.world.planarDistance(i, c) };
}

/** Everything this character could lock onto now. */
export function lockCandidates(rt: Runtime, i: RInstance, st = lockOf(i)): RInstance[] {
  const solids = rt.world.solids();
  const pool = st.type ? rt.world.of(st.type) : rt.world.instances.filter((o) => !!o.state.health);
  return pool.filter((c) => {
    if (c === i || !alive(c) || (st.tag && !c.tags.includes(st.tag))) return false;
    const { deg, dist } = bearing(rt, i, c);
    return dist <= st.range && Math.abs(deg) <= st.angle / 2 && (!st.los || lineOfSight(rt.world, i, c, solids));
  });
}

function bestOf(rt: Runtime, i: RInstance, st: LockOnState, list: RInstance[]): RInstance | undefined {
  const score = (c: RInstance) => {
    const hp = Number(c.state.health?.hp ?? 0), { deg, dist } = bearing(rt, i, c);
    return st.priority === 'most centred' ? Math.abs(deg) : st.priority === 'lowest health' ? hp : st.priority === 'highest health' ? -hp : dist;
  };
  // Lowest score; ties by object id, so the same scene always picks the same target.
  return [...list].sort((a, b) => score(a) - score(b) || a.uid - b.uid)[0];
}

/** Change the lock, firing On target acquired / changed / lost. */
export function setLock(rt: Runtime, i: RInstance, t: RInstance | undefined) {
  const st = lockOf(i), old = st.target == null ? undefined : rt.world.byUid.get(st.target);
  if ((t?.uid ?? null) === st.target) return;
  st.target = t?.uid ?? null; st.hidden = 0; st.engaged = false; st.holdRange = 0;
  if (st.dash) cancelDash(rt, i, st);
  if (t) { fire(rt, old ? 'on_target_changed' : 'on_target_acquired', i, t); }
  else fire(rt, 'on_target_lost', i, old);
}

/** Why a dash cannot start right now, or null when it can. */
function dashBlocked(rt: Runtime, st: LockOnState): string | null {
  if (st.dash) return 'dashing';
  if (st.cooldownLeft > 0) return 'cooldown';
  return targetOf(rt, st) ? null : 'no target';
}

export function startDash(rt: Runtime, i: RInstance, allTheWay = false): boolean {
  const st = lockOf(i);
  if (dashBlocked(rt, st)) return false;
  const t = targetOf(rt, st)!;
  st.dash = { time: 0, travelled: 0, stuck: 0 }; st.engaged = false; st.cooldownLeft = st.cooldown;
  if (allTheWay) { const gap = rt.world.planarDistance(i, t); st.dash.maxTime = gap / st.speed + 0.5; st.dash.maxDistance = gap + 2; }
  fire(rt, 'on_dash_started', i, t);
  return true;
}

function endDash(i: RInstance, st: LockOnState) { st.dash = null; i.vx = 0; i.vz = 0; }
function cancelDash(rt: Runtime, i: RInstance, st: LockOnState) {
  if (!st.dash) return;
  endDash(i, st);
  fire(rt, 'on_dash_cancelled', i, st.target == null ? undefined : rt.world.byUid.get(st.target));
}

/** One attack on the target from here: hits only if it is really still in reach and in sight. */
function attack(rt: Runtime, i: RInstance, st: LockOnState) {
  const t = targetOf(rt, st);
  fire(rt, 'on_attack_started', i, t);
  const reach = st.attackDistance * 1.25;
  const inReach = (c: RInstance) => rt.world.planarDistance(i, c) <= reach && lineOfSight(rt.world, i, c);
  if (t && inReach(t)) {
    const hit = st.attackType === 'sweep' ? rt.world.of(t.type).filter((c) => alive(c) && inReach(c)) : [t];
    for (const c of hit) {
      rt.damage(c, st.damage);
      if (st.attackType === 'knockback') { const a = centre(rt, i), b = centre(rt, c), dx = b[0] - a[0], dz = rt.world.plane === 'xz' ? b[2] - a[2] : 0, l = Math.hypot(dx, dz) || 1; c.vx += (dx / l) * 9; if (rt.world.plane === 'xz') c.vz += (dz / l) * 9; c.vy += 3; }
      rt.queueTrigger('combat.on_hit', { [c.type]: [c] });
    }
    fire(rt, 'on_attack_hit', i, t);
  } else fire(rt, 'on_attack_missed', i, t);
  fire(rt, 'on_attack_completed', i, t);
  st.nextAttack = rt.time + st.repeatEvery;
}

/** The dash: towards the target through collisions (so never through a wall), in steps short enough not to tunnel. */
function stepDash(rt: Runtime, i: RInstance, st: LockOnState, t: RInstance, dt: number) {
  const w = rt.world, d = st.dash!, xz = w.plane === 'xz';
  d.time += dt;
  const gap = () => w.planarDistance(i, t);
  if (gap() > st.attackDistance) {
    const a = centre(rt, i), b = centre(rt, t), want = Math.min(st.speed * dt, gap() - st.attackDistance);
    const dx = b[0] - a[0], dy = xz ? b[2] - a[2] : b[1] - a[1], l = Math.hypot(dx, dy) || 1;
    w.setAngle(i, w.headingTo(a[0], a[1], a[2], b[0], xz ? a[1] : b[1], xz ? b[2] : a[2]));
    const blockers = w.blockersFor(i).filter((o) => o !== t);
    const steps = Math.max(1, Math.ceil(want / 0.15)), x0 = i.x, y0 = i.y, z0 = i.z;
    for (let k = 0; k < steps; k++) moveAndCollide(w, i, (dx / l) * want / steps, xz ? 0 : (dy / l) * want / steps, xz ? (dy / l) * want / steps : 0, blockers, 0.3);
    const moved = Math.hypot(i.x - x0, xz ? i.z - z0 : i.y - y0);
    d.travelled += moved;
    d.stuck = moved < want * 0.2 ? d.stuck + dt : 0;
    i.vx = 0; i.vz = 0;
  }
  if (gap() <= st.attackDistance + 1e-3) {
    endDash(i, st);
    st.engaged = true;
    fire(rt, 'on_dash_completed', i, t);
    if (st.attackOnArrival) attack(rt, i, st);
  } else if (d.time >= Math.max(st.duration, d.maxTime ?? 0) || d.travelled >= Math.max(st.distance, d.maxDistance ?? 0) || d.stuck > 0.12) cancelDash(rt, i, st); // out of time or road, or against a wall
}

/** Every tick, for each character using lock-on: cooldown, is the target still there, the dash, repeated attacks. */
export function stepLockOn(rt: Runtime, dt: number) {
  if (dt <= 0) return;
  for (const i of rt.world.instances) {
    const st = i.state.lockon as LockOnState | undefined;
    if (!st || i.destroyed) continue;
    st.cooldownLeft = Math.max(0, st.cooldownLeft - dt);
    if (st.target == null) continue;
    const t = targetOf(rt, st);
    let lost = !t;
    if (t) {
      st.hidden = !st.los || lineOfSight(rt.world, i, t) ? 0 : st.hidden + dt;
      if (st.hidden > 0.5 || rt.world.planarDistance(i, t) > Math.max(st.range, st.holdRange ?? 0) * 1.25) lost = true;
    }
    if (lost) {
      // Dead, removed, out of range or hidden: drop it (a dash under way stops safely with it).
      const old = st.target == null ? undefined : rt.world.byUid.get(st.target);
      if (st.dash) cancelDash(rt, i, st);
      st.target = null; st.engaged = false; st.hidden = 0;
      fire(rt, 'on_target_lost', i, old && !old.destroyed ? old : undefined);
      continue;
    }
    if (st.dash) stepDash(rt, i, st, t!, dt);
    else if (st.engaged && st.repeat && rt.time >= st.nextAttack) {
      if (rt.world.planarDistance(i, t!) <= st.attackDistance * 1.25) attack(rt, i, st); else st.engaged = false;
    }
  }
}

// ------------------------------------------------------------------ blocks
type Act = (rt: Runtime, b: BlockInstance, ctx: Ctx, i?: RInstance) => void;
const N = (rt: Runtime, b: BlockInstance, ctx: Ctx, n: string) => toNum(rt.param(b, n, ctx));
const num = (field: 'range' | 'angle' | 'speed' | 'duration' | 'distance' | 'attackDistance' | 'cooldown' | 'damage', min: number): Act =>
  (rt, b, ctx, i) => { lockOf(i!)[field] = Math.max(min, N(rt, b, ctx, 'value')); };
const onOff = (v: unknown) => v === true || v === 'true' || v === 'on';

export const LOCKON_ACTIONS: Record<string, Act> = {
  'lockon.acquire': (rt, b, _ctx, i) => {
    const st = lockOf(i!), type = String(b.params.targets ?? '').trim(), tag = String(b.params.tag ?? '').trim();
    if (type) st.type = type;
    st.tag = tag;
    const t = bestOf(rt, i!, st, lockCandidates(rt, i!, st));
    if (t) setLock(rt, i!, t);
  },
  'lockon.click_target': (rt, b, _ctx, i) => {
    // What the click landed on, else (a small figure seen from far above) the nearest one around the click on the ground.
    // A click is a clear choice of something the player can see: the range is for the lock-on key's automatic pick.
    const st = lockOf(i!), type = String(b.params.targets ?? '').trim();
    if (type) st.type = type;
    const list = (st.type ? rt.world.of(st.type) : rt.world.instances.filter((o) => !!o.state.health)).filter((c) => c !== i && alive(c));
    let t = list.find((c) => rt.input.clickedUids.includes(c.uid));
    if (!t && !rt.input.mouse.locked) {
      const m = rt.input.mouse, xz = rt.world.plane === 'xz';
      let bd = 1.5;
      for (const c of list) { const d = Math.hypot(c.x - m.x, xz ? c.z - m.z : c.y - m.y); if (d < bd) { bd = d; t = c; } }
    }
    if (!t) return;
    setLock(rt, i!, t);
    st.holdRange = rt.world.planarDistance(i!, t);
    if (b.params.dash !== false && b.params.dash !== 'false') startDash(rt, i!, true);
  },
  'lockon.set_target': (rt, b, ctx, i) => { const t = rt.picked(ctx, String(b.params.other))[0]; if (alive(t)) setLock(rt, i!, t); },
  'lockon.clear': (rt, _b, _c, i) => setLock(rt, i!, undefined),
  'lockon.switch': (rt, b, _c, i) => {
    const st = lockOf(i!), list = lockCandidates(rt, i!, st).sort((x, y) => bearing(rt, i!, x).deg - bearing(rt, i!, y).deg || x.uid - y.uid);
    if (!list.length) return;
    const k = list.findIndex((c) => c.uid === st.target), step = b.params.direction === 'previous' ? -1 : 1;
    setLock(rt, i!, k < 0 ? bestOf(rt, i!, st, list) : list[(k + step + list.length) % list.length]);
  },
  'lockon.set_priority': (_rt, b, _c, i) => { lockOf(i!).priority = String(b.params.priority); },
  'lockon.set_range': num('range', 0.1),
  'lockon.set_angle': (rt, b, ctx, i) => { lockOf(i!).angle = Math.max(1, Math.min(360, N(rt, b, ctx, 'value'))); },
  'lockon.set_line_of_sight': (_rt, b, _c, i) => { lockOf(i!).los = onOff(b.params.on); },
  'lockon.show_marker': (_rt, _b, _c, i) => { lockOf(i!).marker.on = true; },
  'lockon.hide_marker': (_rt, _b, _c, i) => { lockOf(i!).marker.on = false; },
  'lockon.marker_color': (rt, b, ctx, i) => { lockOf(i!).marker.color = toStr(rt.param(b, 'color', ctx)); },
  'lockon.marker_size': (rt, b, ctx, i) => { lockOf(i!).marker.size = Math.max(0.05, N(rt, b, ctx, 'value')); },
  'lockon.marker_offset': (rt, b, ctx, i) => { lockOf(i!).marker.offset = [N(rt, b, ctx, 'x'), N(rt, b, ctx, 'y'), N(rt, b, ctx, 'z')]; },
  'lockon.marker_animation': (_rt, b, _c, i) => { lockOf(i!).marker.anim = String(b.params.animation); },
  'lockon.dash': (rt, _b, _c, i) => { startDash(rt, i!); },
  'lockon.set_dash_speed': num('speed', 0.1),
  'lockon.set_dash_duration': num('duration', 0.05),
  'lockon.set_dash_distance': num('distance', 0.1),
  'lockon.set_attack_distance': num('attackDistance', 0.05),
  'lockon.set_dash_cooldown': num('cooldown', 0),
  'lockon.cancel_dash': (rt, _b, _c, i) => cancelDash(rt, i!, lockOf(i!)),
  'lockon.attack_on_arrival': (_rt, b, _c, i) => { lockOf(i!).attackOnArrival = onOff(b.params.on); },
  'lockon.set_attack_damage': num('damage', 0),
  'lockon.set_attack_type': (_rt, b, _c, i) => { lockOf(i!).attackType = String(b.params.attack); },
  'lockon.set_attack_repeat': (rt, b, ctx, i) => { const st = lockOf(i!); st.repeat = onOff(b.params.on); st.repeatEvery = Math.max(0.05, N(rt, b, ctx, 'every')); },
};

type Cond = { test: (rt: Runtime, b: BlockInstance, ctx: Ctx, i?: RInstance) => any };
const always: Cond = { test: () => true };
export const LOCKON_CONDITIONS: Record<string, Cond> = {
  'lockon.on_target_acquired': always, 'lockon.on_target_lost': always, 'lockon.on_target_changed': always,
  'lockon.on_dash_started': always, 'lockon.on_dash_completed': always, 'lockon.on_dash_cancelled': always,
  'lockon.on_attack_started': always, 'lockon.on_attack_completed': always, 'lockon.on_attack_hit': always, 'lockon.on_attack_missed': always,
  'lockon.is_valid': { test: (rt, _b, _c, i) => { const st = i!.state.lockon as LockOnState | undefined; return !!st && !!targetOf(rt, st); } },
  'lockon.current_target': {
    test: (rt, b, ctx, i) => {
      const st = i!.state.lockon as LockOnState | undefined, t = st && targetOf(rt, st);
      if (!t || t.type.toLowerCase() !== String(b.params.type).toLowerCase()) return false;
      if (ctx.pickAdd) { const k = t.type.toLowerCase(); let s = ctx.pickAdd.get(k); if (!s) ctx.pickAdd.set(k, (s = new Set())); s.add(t); }
      return true;
    },
  },
  'lockon.is_dashing': { test: (_rt, _b, _c, i) => !!(i!.state.lockon as LockOnState | undefined)?.dash },
  'lockon.dash_ready': { test: (rt, _b, _c, i) => !dashBlocked(rt, lockOf(i!)) },
  'lockon.compare_distance': {
    test: (rt, b, ctx, i) => {
      const st = i!.state.lockon as LockOnState | undefined, t = st && targetOf(rt, st);
      return !!t && compareValues(rt.world.planarDistance(i!, t), String(b.params.op), rt.param(b, 'value', ctx));
    },
  },
};
