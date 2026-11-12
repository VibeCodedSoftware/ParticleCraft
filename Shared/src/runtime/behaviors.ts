// Construct-style behaviors. Each behavior has documented properties (shown in the inspector) and a
// deterministic tick. Behaviors tick before the event sheet each frame (see docs/compatibility.md).
import type { RInstance, World } from './world';
import { aabbOverlap } from './world';
import { moveAndCollide, raycast, resolveBodies } from './physics';
import { findPath, getGrid, lineOfSight, planeAB } from './pathfinding';
import type { InputState } from './input';
import { waterAt } from './water';
import { floatSpare, impulseAt, isRigid, stepRigid, surfaceAt, surfaceVelocity } from './rigid';
import { AI_BEHAVIORS } from './aiBehaviors';
import { BREAKABLE } from './breakable';
import { ROPE } from './rope';
import { INTERACTABLE, VEHICLE } from './vehicle';
import { initBoard, tickBoard } from './gridTurns';
import { VR_PLAYER } from './vrPlayer';
import { PROC_ANIM } from './procAnim';
import { SURFACE_WALKER } from './surfaceWalker';
import { PLANET, planetPull } from './planets';
import { PLATFORM_TYPE } from './platformTypes';
import { TRAIL } from './trails';

/** Camera blend (vehicle enter/exit): ease from where the camera was to where Follow puts it now. */
function applyBlend(inst: RInstance, dt: number) {
  const b = inst.state.follow?.blend as { from: [number, number, number]; t: number; dur: number } | undefined;
  if (!b) return;
  b.t += dt;
  const k = Math.min(1, b.t / Math.max(1e-3, b.dur)), e = k * k * (3 - 2 * k);
  inst.x = b.from[0] + (inst.x - b.from[0]) * e; inst.y = b.from[1] + (inst.y - b.from[1]) * e; inst.z = b.from[2] + (inst.z - b.from[2]) * e;
  if (k >= 1) inst.state.follow.blend = undefined;
}

export interface BehaviorHost {
  world: World;
  input: InputState;
  time: number;
  gravity: number;
  /** Unit forward of the active camera projected on the ground plane (3D controls are camera-relative). */
  cameraForward: [number, number];
  queueTrigger(blockId: string, picks: Record<string, any[]>, data?: any): void;
  /** Deal damage through the Health behavior (fires On damaged / On died). */
  damage?(inst: RInstance, amount: number): boolean;
  /** Open a conversation from the Dialogue editor / whether one is showing (NPC interaction). */
  openDialogue?(name: string): void;
  dialogueOpen?(): boolean;
  /** Shatter a Breakable object now (hit: what broke it and how hard). */
  breakObject?(inst: RInstance, hit: { dir: [number, number, number]; speed: number; by?: RInstance } | null): void;
  /** Is this object on screen for the game camera (3D), optionally not hidden behind Solid walls? */
  cameraSees?(inst: RInstance, walls?: boolean): boolean;
  /** A one-shot particle burst (trails). */
  spawnParticles?(preset: string, pos: [number, number, number], heading?: number, color?: string): void;
  /** A mark on a surface (paint trails): see addDecal. */
  addMark?(on: RInstance, point: [number, number, number], normal: [number, number, number], size: number, o: { color?: string; alpha?: number; life?: number; pool?: string; max?: number }): void;
  /** A local player's action held / just pressed (their own bindings and profile; Controls = player1-4). */
  playerAction?(player: number, action: string, pressed: boolean): boolean;
  /** A local player's movement vector (their keys and their gamepad's left stick). */
  playerMove?(player: number): [number, number];
  /** "{Interact}" placeholders → the button for the device in use. */
  fillPrompts?(text: string): string;
  /** A key's bindings plus those of every action bound to it (E → also pad X through Interact). */
  keyBindings?(key: string): string[];
}

/** color, particle and sound are text values that hosts can offer a picker for. */
export type PropType = 'number' | 'boolean' | 'string' | 'choice' | 'objectType' | 'color' | 'particle' | 'sound' | 'image';
export interface PropDef { key: string; label: string; type: PropType; default: any; min?: number; max?: number; step?: number; options?: string[]; doc?: string; advanced?: boolean }
export interface BehaviorDef {
  id: string; name: string; doc: string; icon: string;
  /** Only GameCraft offers it (3D-only: VR, planets, wall walking, procedural animation). Default: both apps. */
  gamecraftOnly?: boolean;
  props: PropDef[];
  /** Expressions available as Object.Behavior.Name */
  expressions: Record<string, (inst: RInstance, host: BehaviorHost) => any>;
  init?(inst: RInstance, host: BehaviorHost): void;
  tick?(inst: RInstance, props: Record<string, any>, host: BehaviorHost, dt: number): void;
}

export const KEYS = {
  left: ['ArrowLeft', 'A'], right: ['ArrowRight', 'D'], up: ['ArrowUp', 'W'], down: ['ArrowDown', 'S'],
  jump2d: ['Space', 'ArrowUp', 'W'], jump3d: ['Space'],
};

export function approach(v: number, target: number, amount: number) {
  if (v < target) return Math.min(target, v + amount);
  if (v > target) return Math.max(target, v - amount);
  return v;
}
export function angleLerp(a: number, b: number, maxStep: number) {
  let d = ((b - a + 540) % 360) - 180;
  if (Math.abs(d) <= maxStep) return b;
  return a + Math.sign(d) * maxStep;
}

/** Who drives a character: everyone (default), one half of the keyboard, one gamepad, or an online player. */
export const CONTROL_SCHEMES = ['default', 'player1', 'player2', 'player3', 'player4', 'wasd', 'arrows', 'gamepad1', 'gamepad2', 'gamepad3', 'gamepad4', 'online2', 'online3', 'online4'];
export const controlsProp: PropDef = { key: 'controls', label: 'Controls (player)', type: 'choice', default: 'default', options: CONTROL_SCHEMES, doc: 'default = keyboard (arrows/WASD) and gamepad 1. player1-4 = that local player\'s own device, actions and profile (Input editor › Players), so each player can rebind and tune separately. wasd / arrows / gamepadN are fixed layouts; online2-4 are players who joined over the network.' };
/** Behavior controls → the input actions a local player's bindings come from (scheme player1-4). */
const CONTROL_ACTIONS: Record<string, string> = { left: 'Left', right: 'Right', up: 'Up', down: 'Down', jump: 'Jump', run: 'Sprint', dash: 'Dash', crouch: 'Crouch', drop: 'Down' };
const SCHEME_KEYS: Record<string, Record<string, string[]>> = {
  wasd: { left: ['A'], right: ['D'], up: ['W'], down: ['S'], jump: ['Space'], jump2d: ['W', 'Space'], run: ['Shift'] },
  arrows: { left: ['ArrowLeft'], right: ['ArrowRight'], up: ['ArrowUp'], down: ['ArrowDown'], jump: ['Enter'], jump2d: ['ArrowUp', 'Enter'], run: ['/'] },
};
const PAD_CONTROL: Record<string, (pad: { down: Set<string>; pressed: Set<string>; axes: number[] }, pressed: boolean) => boolean> = {
  left: (p) => p.down.has('Left') || p.axes[0] < -0.4, right: (p) => p.down.has('Right') || p.axes[0] > 0.4,
  up: (p) => p.down.has('Up') || p.axes[1] < -0.4, down: (p) => p.down.has('Down') || p.axes[1] > 0.4,
  jump: (p, pr) => (pr ? p.pressed : p.down).has('A'), run: (p) => p.down.has('X') || p.down.has('LB'),
  dash: (p, pr) => (pr ? p.pressed : p.down).has('RB'), crouch: (p) => p.down.has('B'),
};

/** Simulated controls set by the "Simulate control" action are consumed every tick. */
export function control(inst: RInstance, name: string, keys: string[], props: any, host: BehaviorHost, pressed = false): boolean {
  const sim = inst.state.sim as Set<string> | undefined;
  if (sim?.has(name)) return true;
  if (props.defaultControls === false) return false;
  const scheme = String(props.controls ?? 'default');
  const input = host.input;
  if (scheme === 'default') {
    // Keys, or any binding ("mouse:middle", "pad:B", "touch:Dash"…).
    if (keys.some((k) => (k.includes(':') ? input.binding(k, pressed ? 'pressed' : 'held') : pressed ? input.pressed.has(k) : input.down.has(k)))) return true;
    return input.pad.connected && !!PAD_CONTROL[name]?.(input.pad, pressed);
  }
  if (scheme.startsWith('player')) {
    // A local player's own actions (their profile, kept to their device) and their gamepad's stick.
    const n = Number(scheme.slice(6)) || 1;
    if (host.playerAction?.(n, CONTROL_ACTIONS[name] ?? name, pressed)) return true;
    if (pressed || !host.playerMove || !['left', 'right', 'up', 'down'].includes(name)) return false;
    const [x, y] = host.playerMove(n);
    return name === 'left' ? x < -0.4 : name === 'right' ? x > 0.4 : name === 'up' ? y > 0.4 : y < -0.4;
  }
  if (scheme.startsWith('gamepad')) { const pad = input.pads[Number(scheme.slice(7)) - 1]; return !!pad?.connected && !!PAD_CONTROL[name]?.(pad, pressed); }
  if (scheme.startsWith('online')) {
    const r = input.remotes.get(Number(scheme.slice(6)));
    if (!r) return false;
    return (pressed ? r.anyPressed(keys) : r.anyDown(keys)) || (r.pad.connected && !!PAD_CONTROL[name]?.(r.pad, pressed));
  }
  const map = SCHEME_KEYS[scheme];
  const k = map?.[name === 'jump' && keys.includes('W') ? 'jump2d' : name];
  return !!k && (pressed ? input.anyPressed(k) : input.anyDown(k));
}

export function physicsBodies(host: BehaviorHost) {
  return host.world.instances.filter((i) => !i.destroyed && host.world.hasBehavior(i, 'physics'));
}
function blockersFor(host: BehaviorHost, inst: RInstance) {
  return host.world.blockersFor(inst);
}
/**
 * A character walking into a physics body pushes it along that axis at its centre height (so it slides rather than
 * flipping; it still tips over ledges and obstacles), up to `strength` newtons. Returns the character's new speed on
 * that axis: it keeps up with what it pushes.
 */
function pushBody(host: BehaviorHost, inst: RInstance, body: RInstance, axis: 0 | 1 | 2, want: number, strength: number, dt: number): number {
  const w = host.world, p = w.behavior(body, 'physics')?.props;
  if (!p || p.immovable || !want) return 0;
  const key = axis === 0 ? 'vx' : 'vz';
  const m = Math.max(0.01, Number(p.mass ?? 1));
  const cur = (body as any)[key] as number;
  const J = Math.sign(want) * Math.min(Math.max(0, (Math.abs(want) - cur * Math.sign(want)) * m), strength * dt);
  if (J) {
    const me = w.aabb(inst), bb = w.aabb(body);
    const y = Math.min((me[1] + me[4]) / 2, (bb[1] + bb[4]) / 2);
    const point: [number, number, number] = [axis === 0 ? (want > 0 ? bb[0] : bb[3]) : (bb[0] + bb[3]) / 2, y, axis === 2 ? (want > 0 ? bb[2] : bb[5]) : (bb[2] + bb[5]) / 2];
    impulseAt(w, body, point, axis === 0 ? [J, 0, 0] : [0, 0, J]);
  }
  const after = (body as any)[key] as number;
  return Math.sign(after) === Math.sign(want) ? Math.min(Math.abs(after), Math.abs(want)) * Math.sign(want) : 0;
}

/** Characters push physics bodies they walk into. */
function pushBodies(host: BehaviorHost, inst: RInstance, vx: number, vz: number) {
  const me = host.world.aabb(inst);
  for (const b of physicsBodies(host)) {
    if (b === inst || b.state.physics?.heldBy || b.collider.nonBlocking || !host.world.layersCollide(inst, b)) continue;
    if (!aabbOverlap(me, host.world.aabb(b))) continue;
    const mass = Math.max(0.1, Number(host.world.behavior(b, 'physics')?.props.mass ?? 1));
    b.vx += (vx * 0.6) / mass; b.vz += (vz * 0.6) / mass;
    if (host.world.plane === 'xy') b.vy += 0;
  }
}

export const BEHAVIORS: Record<string, BehaviorDef> = {
  solid: {
    id: 'solid', name: 'Solid', icon: '▣', doc: 'Blocks Platform, 8-Direction, Car, Bullet, Physics and Pathfinding movement.',
    props: [{ key: 'enabled', label: 'Enabled', type: 'boolean', default: true }],
    expressions: {},
  },

  platform: {
    id: 'platform', name: 'Platform', icon: '🏃', doc: 'Side-view (2D) or third-person (3D) character controller: run, jump, gravity, ground detection. 3D movement is relative to the active camera.',
    props: [
      { key: 'maxSpeed', label: 'Max speed', type: 'number', default: 6, min: 0, step: 0.5, doc: 'm/s' },
      { key: 'runMultiplier', label: 'Run multiplier (Shift)', type: 'number', default: 1.6, min: 1, step: 0.1 },
      { key: 'acceleration', label: 'Acceleration', type: 'number', default: 40, min: 0 },
      { key: 'deceleration', label: 'Deceleration', type: 'number', default: 40, min: 0 },
      { key: 'jumpStrength', label: 'Jump strength', type: 'number', default: 10, min: 0, step: 0.5, doc: 'Initial upward speed (m/s)' },
      { key: 'gravity', label: 'Gravity', type: 'number', default: 28, min: 0, doc: 'm/s² (Platform has its own gravity, like Construct)' },
      { key: 'maxFallSpeed', label: 'Max fall speed', type: 'number', default: 40, min: 0 },
      { key: 'airControl', label: 'Air control', type: 'number', default: 0.7, min: 0, max: 1, step: 0.05 },
      { key: 'doubleJump', label: 'Double jump', type: 'boolean', default: false, advanced: true, doc: 'Older setting: the same as Jumps 2.' },
      // Abilities (each can be switched off without breaking the rest of the movement).
      { key: 'jumping', label: 'Jumping', type: 'boolean', default: true, doc: 'Off: no jumping at all (walking games).' },
      { key: 'jumpCount', label: 'Jumps', type: 'number', default: 1, min: 1, max: 10, step: 1, doc: '1 = normal jump, 2 = double jump, 3 = triple jump… in the air.' },
      { key: 'unlimitedJumps', label: 'Unlimited jumps', type: 'boolean', default: false, doc: 'Jump again and again in the air (flappy / swimming-in-air games).' },
      { key: 'sprinting', label: 'Sprinting', type: 'boolean', default: true, doc: 'Hold Shift (gamepad X) to run faster (Run multiplier).' },
      { key: 'swimming', label: 'Swimming', type: 'boolean', default: true, doc: 'In Water: swim up with Jump. Off: the character just sinks and walks on the bottom.' },
      { key: 'crouching', label: 'Crouching', type: 'boolean', default: false, doc: 'Hold C (gamepad B) to crouch: slower, animation "crouch".' },
      { key: 'crouchSpeed', label: 'Crouch speed (×)', type: 'number', default: 0.45, min: 0, max: 1, step: 0.05 },
      { key: 'dash', label: 'Dash', type: 'boolean', default: false, doc: 'Press Q (gamepad RB) for a quick burst in the facing / moving direction.' },
      { key: 'dashSpeed', label: 'Dash speed (m/s)', type: 'number', default: 18, min: 1, step: 1 },
      { key: 'dashTime', label: 'Dash time (s)', type: 'number', default: 0.18, min: 0.05, max: 1, step: 0.01 },
      { key: 'dashCooldown', label: 'Dash cooldown (s)', type: 'number', default: 0.6, min: 0, step: 0.05 },
      { key: 'wallSlide', label: 'Wall sliding', type: 'boolean', default: false, doc: 'Falling while pushing into a wall slides down it slowly.' },
      { key: 'wallSlideSpeed', label: 'Wall slide speed (m/s)', type: 'number', default: 2.5, min: 0, step: 0.25 },
      { key: 'wallJump', label: 'Wall jumping', type: 'boolean', default: false, doc: 'Jump off a wall you are touching in the air: up and away from it.' },
      { key: 'wallJumpPush', label: 'Wall jump push (m/s)', type: 'number', default: 7, min: 0, step: 0.5 },
      { key: 'slowDescent', label: 'Slow descent (glide)', type: 'boolean', default: false, doc: 'Hold Jump while falling to float down slowly (parachute, cape, leaf).' },
      { key: 'glideFallSpeed', label: 'Glide fall speed (m/s)', type: 'number', default: 1.8, min: 0.1, step: 0.1 },
      { key: 'climbing', label: 'Climbing', type: 'boolean', default: true, doc: 'On objects tagged "ladder" or "climbable": Up / Down climb, no gravity.' },
      { key: 'climbSpeed', label: 'Climb speed (m/s)', type: 'number', default: 3, min: 0.1, step: 0.1 },
      { key: 'flying', label: 'Flying', type: 'boolean', default: false, doc: 'No gravity: Jump flies up, Crouch (C) flies down (3D: plus WASD). Free movement in the air.' },
      { key: 'flySpeed', label: 'Fly up / down speed (m/s)', type: 'number', default: 5, min: 0, step: 0.5 },
      { key: 'dropThrough', label: 'Drop through one-way platforms', type: 'boolean', default: true, doc: 'Middle mouse, or Down + Jump, drops through a one-way platform you stand on.' },
      { key: 'turnSpeed', label: 'Turn speed (3D)', type: 'number', default: 720, advanced: true },
      { key: 'stepHeight', label: 'Step height', type: 'number', default: 0.3, min: 0, step: 0.05, doc: 'Ledges up to this height (m) are walked up without jumping (stairs, curbs). 3D only.' },
      { key: 'pushStrength', label: 'Push strength (N)', type: 'number', default: 80, min: 0, step: 5, advanced: true, doc: 'How hard the character pushes Physics objects it walks into.' },
      { key: 'weight', label: 'Weight on objects (kg)', type: 'number', default: 1, min: 0, step: 0.5, advanced: true, doc: 'How heavily the character presses on Physics objects it stands on (floating boards tilt, balls roll away).' },
      { key: 'defaultControls', label: 'Default controls', type: 'boolean', default: true, doc: '2D: arrows/WASD + Space. 3D: WASD + Space, Shift to run.' },
      controlsProp,
      { key: 'enabled', label: 'Enabled', type: 'boolean', default: true },
    ],
    expressions: {
      Speed: (i) => Math.hypot(i.vx, i.vz),
      VectorX: (i) => i.vx, VectorY: (i) => i.vy, VectorZ: (i) => i.vz,
      IsOnFloor: (i) => (i.state.platform?.grounded ? 1 : 0),
      JumpsLeft: (i) => Math.max(0, (i.state.platform?.maxJumps ?? 1) - (i.state.platform?.jumps ?? 0)),
      IsDashing: (i) => (i.state.platform?.dashT > 0 ? 1 : 0),
      IsCrouching: (i) => (i.state.platform?.crouched ? 1 : 0),
      IsWallSliding: (i) => (i.state.platform?.wallSliding ? 1 : 0),
      IsClimbing: (i) => (i.state.platform?.climbing ? 1 : 0),
      IsGliding: (i) => (i.state.platform?.gliding ? 1 : 0),
    },
    tick(inst, p, host, dt) {
      const w = host.world;
      const st = (inst.state.platform ??= { grounded: false, jumps: 0, standingOn: -1, wasMoving: false });
      const swimOn = p.swimming !== false;
      const water = swimOn ? waterAt(w, inst) : null;
      const run = p.sprinting !== false && control(inst, 'run', ['Shift'], p, host) ? Number(p.runMultiplier ?? 1) : 1;
      // Crouch: slower (and its own animation).
      st.crouched = !!p.crouching && !p.flying && st.grounded && control(inst, 'crouch', ['C'], p, host);
      const maxSpeed = Number(p.maxSpeed) * run * (water ? Number(water.props.swimSpeed ?? 0.6) : 1) * (st.crouched ? Number(p.crouchSpeed ?? 0.45) : 1);
      // How many jumps in a row (Jumps setting; older projects' Double jump = 2).
      st.maxJumps = p.unlimitedJumps ? Infinity : Math.max(1, Math.round(Number(p.jumpCount ?? 1)), p.doubleJump ? 2 : 1);
      const wasDashing = (st.dashT ?? 0) > 0;
      st.dashT = Math.max(0, (st.dashT ?? 0) - dt); st.dashCd = Math.max(0, (st.dashCd ?? 0) - dt);
      // A dash ends at the normal top speed (no long coast at dash speed).
      if (wasDashing && st.dashT <= 0) { const sp = Math.hypot(inst.vx, w.plane === 'xz' ? inst.vz : 0), k = sp > maxSpeed ? maxSpeed / sp : 1; inst.vx *= k; if (w.plane === 'xz') inst.vz *= k; }
      const accelBase = st.grounded ? Number(p.acceleration) : Number(p.acceleration) * Number(p.airControl);
      const decelBase = st.grounded ? Number(p.deceleration) : Number(p.deceleration) * Number(p.airControl);
      // Right after a wall jump, steering waits a moment (holding toward the wall would cancel the push away).
      st.wallJumpLock = Math.max(0, (st.wallJumpLock ?? 0) - dt);
      const locked = st.wallJumpLock > 0;
      if (w.plane === 'xy') {
        const dir = locked ? 0 : (control(inst, 'right', KEYS.right, p, host) ? 1 : 0) - (control(inst, 'left', KEYS.left, p, host) ? 1 : 0);
        if (locked) { /* keep the wall jump's speed */ }
        else if (dir) { inst.vx = approach(inst.vx, dir * maxSpeed, (Math.sign(inst.vx) !== dir ? accelBase + decelBase : accelBase) * dt); if (inst.sprite) inst.sprite.flipX = dir < 0; }
        else inst.vx = approach(inst.vx, 0, decelBase * dt);
      } else {
        const [fx, fz] = host.cameraForward;
        const rx = -fz, rz = fx; // camera right on ground plane
        const f = (control(inst, 'up', KEYS.up, p, host) ? 1 : 0) - (control(inst, 'down', KEYS.down, p, host) ? 1 : 0);
        const r = (control(inst, 'right', KEYS.right, p, host) ? 1 : 0) - (control(inst, 'left', KEYS.left, p, host) ? 1 : 0);
        let mx = fx * f + rx * r, mz = fz * f + rz * r;
        const ml = Math.hypot(mx, mz);
        st.intent = ml > 0 ? [mx / ml, mz / ml] : null; // where the player wants to go (wall climbing reads it)
        if (locked) { /* keep the wall jump's speed */ }
        else if (ml > 0) {
          mx /= ml; mz /= ml;
          inst.vx = approach(inst.vx, mx * maxSpeed, accelBase * dt);
          inst.vz = approach(inst.vz, mz * maxSpeed, accelBase * dt);
          w.setAngle(inst, angleLerp(w.angle(inst), (Math.atan2(-mz, mx) * 180) / Math.PI, Number(p.turnSpeed ?? 720) * dt));
        } else {
          const sp = Math.hypot(inst.vx, inst.vz);
          const ns = Math.max(0, sp - decelBase * dt);
          if (sp > 0) { inst.vx *= ns / sp; inst.vz *= ns / sp; }
        }
      }
      const jumpKeys = w.plane === 'xy' ? KEYS.jump2d : KEYS.jump3d;
      if (water) {
        // Swimming: light gravity, hold jump to rise (or leap out at the surface), slow sinking, drag.
        const buoy = Number(water.props.density ?? 1);
        const rise = control(inst, 'jump', jumpKeys, p, host);
        if (rise && water.depth < 0.5 && control(inst, 'jump', jumpKeys, p, host, true)) { inst.vy = Number(p.jumpStrength) * 0.85; host.queueTrigger('platform.on_jump', { [inst.type]: [inst] }); }
        else if (rise) inst.vy = approach(inst.vy, 3.2, 14 * dt);
        else { const sink = -0.6 / Math.max(0.2, buoy); inst.vy = approach(inst.vy, sink, (inst.vy < sink ? 30 : Number(p.gravity) * 0.12) * dt); } // a dive is braked quickly
        inst.vy *= Math.max(0, 1 - Number(water.props.drag ?? 2) * 0.2 * dt);
        st.jumps = 0;
      } else {
        const jumpPressed = p.jumping !== false && control(inst, 'jump', jumpKeys, p, host, true);
        const jumpHeld = p.jumping !== false && control(inst, 'jump', jumpKeys, p, host);
        const upDown = (control(inst, 'up', KEYS.up, p, host) ? 1 : 0) - (control(inst, 'down', KEYS.down, p, host) ? 1 : 0);
        const jump = () => { inst.vy = Number(p.jumpStrength); st.jumps++; st.grounded = false; host.queueTrigger('platform.on_jump', { [inst.type]: [inst] }); };
        st.wallSliding = false; st.gliding = false;
        // Drop through a one-way platform: middle mouse, or Down + Jump while standing on it.
        const under = st.grounded && st.standingOn >= 0 ? w.byUid.get(st.standingOn) : undefined;
        const oneWay = under && String(w.behavior(under, 'platformtype')?.props.kind ?? '') === 'one-way';
        const drop = p.dropThrough !== false && oneWay && (control(inst, 'drop', ['mouse:middle'], p, host, true) || (jumpPressed && upDown < 0));
        if (drop) { st.dropUid = under!.uid; st.dropT = 0.35; st.grounded = false; inst.vy = Math.min(inst.vy, -1); }
        // Ladders: objects tagged "ladder" / "climbable" overlapping the character.
        const ladder = p.climbing !== false ? w.instances.find((o) => o !== inst && !o.destroyed && (o.tags.includes('ladder') || o.tags.includes('climbable')) && w.overlapping(inst, o)) : undefined;
        if (ladder && upDown && !st.climbing) st.climbing = true;
        if (st.climbing && (!ladder || jumpPressed)) st.climbing = false;
        if (drop) { /* falling through */ }
        else if (st.climbing) { inst.vy = upDown * Number(p.climbSpeed ?? 3); st.jumps = 0; }
        else if (p.flying) {
          // Free flight: Jump up, Crouch (C) down, no gravity.
          const v = (jumpHeld ? 1 : 0) - (control(inst, 'crouch', ['C'], p, host) ? 1 : 0);
          inst.vy = approach(inst.vy, v * Number(p.flySpeed ?? 5), 30 * dt); st.jumps = 0;
        } else {
          const wallAge = st.wallAgo ?? Infinity;
          if (jumpPressed) {
            if (st.grounded) jump();
            else if (p.wallJump && st.wall && wallAge < 0.15) {
              // Up and away from the wall.
              inst.vy = Number(p.jumpStrength); st.jumps = 1;
              const k = Number(p.wallJumpPush ?? 7);
              inst.vx = -st.wall[0] * k; if (w.plane === 'xz') inst.vz = -st.wall[1] * k;
              if (inst.sprite && st.wall[0]) inst.sprite.flipX = st.wall[0] > 0;
              st.wallAgo = Infinity;
              st.wallJumpLock = 0.22; // a moment where holding toward the wall doesn't cancel the push away
              host.queueTrigger('platform.on_wall_jump', { [inst.type]: [inst] });
            } else {
              // Air jumps: walking off a ledge spends the ground jump.
              if (st.jumps === 0) st.jumps = 1;
              if (st.jumps < st.maxJumps) jump();
            }
          }
          // Climbing a wall (Procedural Animation): it holds on, no gravity.
          if (!inst.state.procanim?.climb) inst.vy = Math.max(-Number(p.maxFallSpeed), inst.vy - Number(p.gravity) * dt);
          // Wall sliding: falling while pushing into the wall touched last frame.
          if (p.wallSlide && st.wall && wallAge < 0.08 && inst.vy < 0) {
            const into = w.plane === 'xy' ? Math.sign((control(inst, 'right', KEYS.right, p, host) ? 1 : 0) - (control(inst, 'left', KEYS.left, p, host) ? 1 : 0)) === Math.sign(st.wall[0]) && st.wall[0] !== 0
              : !!st.intent && st.intent[0] * st.wall[0] + st.intent[1] * st.wall[1] > 0.3;
            if (into) { inst.vy = Math.max(inst.vy, -Number(p.wallSlideSpeed ?? 2.5)); st.wallSliding = true; st.jumps = 0; }
          }
          // Slow descent: hold Jump while falling.
          if (p.slowDescent && jumpHeld && !st.wallSliding && inst.vy < -Number(p.glideFallSpeed ?? 1.8)) { inst.vy = -Number(p.glideFallSpeed ?? 1.8); st.gliding = true; }
        }
        // Dash: a short burst along the input (or facing) direction; no gravity while it lasts.
        if (p.dash && st.dashCd <= 0 && control(inst, 'dash', ['Q'], p, host, true)) {
          let dx: number, dz = 0;
          if (w.plane === 'xy') { const d = (control(inst, 'right', KEYS.right, p, host) ? 1 : 0) - (control(inst, 'left', KEYS.left, p, host) ? 1 : 0); dx = d || (inst.sprite?.flipX ? -1 : 1); }
          else if (st.intent) [dx, dz] = st.intent;
          else { const a = (w.angle(inst) * Math.PI) / 180; dx = Math.cos(a); dz = -Math.sin(a); }
          st.dashDir = [dx, dz]; st.dashT = Number(p.dashTime ?? 0.18); st.dashCd = Number(p.dashCooldown ?? 0.6) + st.dashT;
          host.queueTrigger('platform.on_dash', { [inst.type]: [inst] });
        }
        if (st.dashT > 0 && st.dashDir) { const s = Number(p.dashSpeed ?? 18); inst.vx = st.dashDir[0] * s; if (w.plane === 'xz') inst.vz = st.dashDir[1] * s; inst.vy = Math.max(0, inst.vy); }
      }
      st.dropT = Math.max(0, (st.dropT ?? 0) - dt);
      // Ride moving platforms.
      if (st.standingOn >= 0) {
        const plat = w.byUid.get(st.standingOn);
        const mv = plat?.state.sine?.moved;
        if (mv) { inst.x += mv[0]; inst.y += mv[1]; inst.z += mv[2]; }
        const spin = plat?.state.rotate?.yaw;
        if (spin && plat && w.plane === 'xz') {
          // A spinning platform carries the rider around its centre and turns them with it.
          const a = (spin * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a), dx = inst.x - plat.x, dz = inst.z - plat.z;
          inst.x = plat.x + dx * c + dz * s; inst.z = plat.z - dx * s + dz * c; w.setAngle(inst, w.angle(inst) + spin);
        }
        if (plat && w.hasBehavior(plat, 'physics') && !st.slipping) {
          // Physics objects carry a rider standing firmly on them (not one sliding off a ball), never faster than
          // a run: riding a spinning surface at full speed fed back into more spin and flung both around.
          const bb = w.aabb(inst), sv = surfaceVelocity(w, plat, [inst.x, bb[1], inst.z]);
          const sp = Math.hypot(sv[0], w.plane === 'xz' ? sv[2] : 0), k = sp > 8 ? 8 / sp : 1;
          inst.x += sv[0] * k * dt; if (w.plane === 'xz') inst.z += sv[2] * k * dt;
        }
      }
      const wasGrounded = st.grounded;
      // Physics objects are solid to characters: stand on them, bump into them and push them.
      const bodies = physicsBodies(host).filter((b) => b !== inst && !b.state.physics?.heldBy && !b.collider.nonBlocking && !b.collider.isTrigger && b.collider.shape !== 'none' && w.layersCollide(inst, b));
      const want = [inst.vx, inst.vy, inst.vz];
      const slip = (st.slip ??= [0, 0]) as number[];
      const blockers = [...blockersFor(host, inst), ...bodies];
      const hits = moveAndCollide(w, inst, (inst.vx + slip[0]) * dt, inst.vy * dt, w.plane === 'xz' ? (inst.vz + slip[1]) * dt : 0, blockers, w.plane === 'xz' ? Number(p.stepHeight ?? 0.3) : 0);
      // Stay on ground that drops away a little (a tilting raft, a bobbing body, the top of a slope) instead of
      // flickering into the air.
      if (wasGrounded && inst.vy <= 0 && !inst.state.procanim?.climb && !hits.some((h) => h.axis === 1 && h.sign < 0)) {
        const y0 = inst.y, snap = moveAndCollide(w, inst, 0, -0.08, 0, blockers).filter((h) => h.axis === 1 && h.sign < 0);
        if (snap.length) hits.push(...snap); else inst.y = y0;
      }
      st.grounded = false; st.standingOn = -1;
      // A wall touched this frame (for wall sliding and wall jumps): which side, as a unit direction on the ground.
      st.wallAgo = (st.wallAgo ?? Infinity) + dt;
      for (const h of hits) if (h.axis !== 1 && !bodies.includes(h.other)) { st.wall = h.axis === 0 ? [h.sign, 0] : [0, h.sign]; st.wallAgo = 0; }
      for (const h of hits) {
        if (h.axis === 1) { if (h.sign < 0) { st.grounded = true; st.jumps = 0; st.standingOn = h.other.uid; } inst.vy = 0; continue; }
        const k = h.axis === 0 ? 'vx' : 'vz';
        if (bodies.includes(h.other)) (inst as any)[k] = pushBody(host, inst, h.other, h.axis, want[h.axis], Number(p.pushStrength ?? 80), dt);
        else (inst as any)[k] = 0;
      }
      if (st.grounded && !wasGrounded) host.queueTrigger('platform.on_landed', { [inst.type]: [inst] });
      const under = st.standingOn >= 0 ? w.byUid.get(st.standingOn) : undefined;
      if (under && bodies.includes(under)) {
        const bb = w.aabb(inst), foot: [number, number, number] = [inst.x, bb[1], w.plane === 'xz' ? inst.z : (bb[2] + bb[5]) / 2];
        // On a curved top (ball, capsule, lying cylinder) there is no foothold: the slope under the feet pulls the
        // character off from the moment it lands, it is never carried by the spinning surface, and its weight goes
        // straight down through the object (a weight on the ball's side drove it along under the character, and
        // the two chased each other across the floor).
        const { n, curved } = surfaceAt(w, under, foot);
        // The weight presses where it stands on flat tops (floating boards tilt, a cube on a ledge tips). A tiny
        // object is pressed with at most three times its own weight, so it is nudged, never launched.
        const bp = w.behavior(under, 'physics')?.props;
        const bodyWeight = Math.max(0.01, Number(bp?.mass ?? 1)) * Math.max(0.05, Math.abs(Number(bp?.gravityScale ?? 1)));
        // Floating (Water): at most an eighth of what it can still carry, so rafts and boards tilt toward where you
        // stand but hold you up instead of tipping you into the water.
        const spare = floatSpare(w, under);
        const weight = Math.min(Number(p.weight ?? 1), bodyWeight * 3, spare > 0 ? Math.max(0.05, spare * 0.125) : Infinity);
        const at: [number, number, number] = curved ? [under.x, foot[1], w.plane === 'xz' ? under.z : foot[2]] : foot;
        impulseAt(w, under, at, [0, -weight * Math.abs(host.gravity) * dt, 0]);
        // Too steep to stand (a ball's side, a cone, a lying cylinder off its top): slide off. Sliding is its own
        // velocity (capped) so the character's braking cannot cancel it; the object is pushed the other way.
        const side = Math.hypot(n[0], n[2]);
        st.slipping = n[1] < 0.77 || (curved && side > 0.01);
        if (st.slipping) {
          const g = Number(p.gravity) * (curved ? 2 * Math.max(0.15, side) / Math.max(1e-6, side) : 1 - n[1]);
          slip[0] += n[0] * g * dt; if (w.plane === 'xz') slip[1] += n[2] * g * dt;
          const sl = Math.hypot(slip[0], slip[1]); if (sl > 4) { slip[0] *= 4 / sl; slip[1] *= 4 / sl; }
          if (Math.hypot(under.vx, w.plane === 'xz' ? under.vz : 0) < 1.5) impulseAt(w, under, foot, [-n[0] * g * weight * dt * 0.3, 0, w.plane === 'xz' ? -n[2] * g * weight * dt * 0.3 : 0]);
          return void (inst.animation = 'fall');
        }
      } else st.slipping = false;
      slip[0] *= Math.max(0, 1 - 8 * dt); slip[1] *= Math.max(0, 1 - 8 * dt);
      const moving = Math.hypot(inst.vx, w.plane === 'xz' ? inst.vz : 0) > 0.05;
      inst.animation = st.dashT > 0 ? 'dash' : st.climbing ? 'climb' : water && !st.grounded ? 'swim' : p.flying && !st.grounded ? 'fly'
        : st.wallSliding ? 'wallslide' : st.gliding ? 'glide' : !st.grounded ? (inst.vy > 0 ? 'jump' : 'fall') : st.crouched ? 'crouch' : moving ? 'walk' : 'idle';
    },
  },

  eightdir: {
    id: 'eightdir', name: '8 Direction', icon: '✥', doc: 'Top-down movement in 8 directions (arrows / WASD). In 3D, up is -Z (away from a default camera).',
    props: [
      { key: 'maxSpeed', label: 'Max speed', type: 'number', default: 6, min: 0 },
      { key: 'acceleration', label: 'Acceleration', type: 'number', default: 50, min: 0 },
      { key: 'deceleration', label: 'Deceleration', type: 'number', default: 50, min: 0 },
      { key: 'setAngle', label: 'Set angle', type: 'boolean', default: true },
      { key: 'defaultControls', label: 'Default controls', type: 'boolean', default: true },
      controlsProp,
      { key: 'enabled', label: 'Enabled', type: 'boolean', default: true },
    ],
    expressions: { Speed: (i) => Math.hypot(i.vx, i.vy, i.vz), VectorX: (i) => i.vx, VectorY: (i) => i.vy, VectorZ: (i) => i.vz },
    tick(inst, p, host, dt) {
      const w = host.world;
      const h = (control(inst, 'right', KEYS.right, p, host) ? 1 : 0) - (control(inst, 'left', KEYS.left, p, host) ? 1 : 0);
      const v = (control(inst, 'up', KEYS.up, p, host) ? 1 : 0) - (control(inst, 'down', KEYS.down, p, host) ? 1 : 0);
      let mx = h, mv = v; const l = Math.hypot(mx, mv); if (l) { mx /= l; mv /= l; }
      const water = w.plane === 'xz' ? waterAt(w, inst) : null; // top-down 2D maps have no "inside" water
      const ms = Number(p.maxSpeed) * (water ? Number(water.props.swimSpeed ?? 0.6) : 1);
      const tx = mx * ms, tv = mv * ms;
      const cur2 = w.plane === 'xz' ? -inst.vz : inst.vy;
      inst.vx = approach(inst.vx, tx, (tx ? Number(p.acceleration) : Number(p.deceleration)) * dt);
      const nv = approach(cur2, tv, (tv ? Number(p.acceleration) : Number(p.deceleration)) * dt);
      if (w.plane === 'xz') inst.vz = -nv; else inst.vy = nv;
      const hits = moveAndCollide(w, inst, inst.vx * dt, w.plane === 'xy' ? inst.vy * dt : 0, w.plane === 'xz' ? inst.vz * dt : 0, blockersFor(host, inst));
      for (const hh of hits) { if (hh.axis === 0) inst.vx = 0; else if (hh.axis === 1) inst.vy = 0; else inst.vz = 0; }
      if (p.setAngle && l) w.setAngle(inst, (Math.atan2(mv, mx) * 180) / Math.PI);
      pushBodies(host, inst, inst.vx, inst.vz);
      inst.animation = l ? 'walk' : 'idle';
    },
  },

  car: {
    id: 'car', name: 'Car', icon: '🚚', doc: 'Vehicle handling: throttle (Up/W), brake & reverse (Down/S), steer (Left/Right, A/D). Steering scales with speed; drift keeps some sideways velocity.',
    props: [
      { key: 'maxSpeed', label: 'Top speed', type: 'number', default: 24, min: 0, doc: 'm/s' },
      { key: 'acceleration', label: 'Acceleration', type: 'number', default: 14, min: 0 },
      { key: 'braking', label: 'Braking', type: 'number', default: 34, min: 0 },
      { key: 'reverseSpeed', label: 'Reverse speed', type: 'number', default: 8, min: 0 },
      { key: 'steerSpeed', label: 'Steering (°/s)', type: 'number', default: 120, min: 0 },
      { key: 'friction', label: 'Rolling friction', type: 'number', default: 5, min: 0 },
      { key: 'drift', label: 'Drift', type: 'number', default: 0.12, min: 0, max: 0.95, step: 0.01 },
      { key: 'gravity', label: 'Gravity', type: 'number', default: 25, min: 0 },
      { key: 'defaultControls', label: 'Default controls', type: 'boolean', default: true },
      controlsProp,
      { key: 'enabled', label: 'Enabled', type: 'boolean', default: true },
    ],
    expressions: { Speed: (i) => i.state.car?.speed ?? 0, VectorX: (i) => i.vx, VectorZ: (i) => i.vz },
    tick(inst, p, host, dt) {
      const w = host.world;
      const st = (inst.state.car ??= { speed: 0 });
      // Driving into water bogs the car down.
      if (w.plane === 'xz' && waterAt(w, inst)) st.speed *= Math.max(0, 1 - 2.5 * dt);
      const thr = control(inst, 'up', KEYS.up, p, host);
      const brk = control(inst, 'down', KEYS.down, p, host);
      if (thr) st.speed += (st.speed < 0 ? Number(p.braking) : Number(p.acceleration)) * dt;
      else if (brk) st.speed -= (st.speed > 0 ? Number(p.braking) : Number(p.acceleration)) * dt;
      else st.speed = approach(st.speed, 0, Number(p.friction) * dt);
      st.speed = Math.max(-Number(p.reverseSpeed), Math.min(Number(p.maxSpeed), st.speed));
      const steer = (control(inst, 'left', KEYS.left, p, host) ? 1 : 0) - (control(inst, 'right', KEYS.right, p, host) ? 1 : 0);
      const grip = Math.min(1, Math.abs(st.speed) / Math.max(0.01, Number(p.maxSpeed) * 0.25));
      w.setAngle(inst, w.angle(inst) + steer * Number(p.steerSpeed) * grip * Math.sign(st.speed) * dt);
      const f = w.forward(w.angle(inst));
      const k = 1 - Number(p.drift);
      inst.vx = inst.vx + (f[0] * st.speed - inst.vx) * k;
      if (w.plane === 'xz') { inst.vz = inst.vz + (f[2] * st.speed - inst.vz) * k; inst.vy -= Number(p.gravity) * dt; }
      else inst.vy = inst.vy + (f[1] * st.speed - inst.vy) * k;
      const hits = moveAndCollide(w, inst, inst.vx * dt, inst.vy * dt, w.plane === 'xz' ? inst.vz * dt : 0, blockersFor(host, inst));
      for (const h of hits) {
        if (w.plane === 'xz' && h.axis === 1) { inst.vy = 0; continue; }
        if (Math.abs(st.speed) > 3) host.queueTrigger('car.on_hit', { [inst.type]: [inst] });
        st.speed *= -0.3;
        if (h.axis === 0) inst.vx *= -0.3; else if (h.axis === 2) inst.vz *= -0.3; else inst.vy *= -0.3;
      }
      pushBodies(host, inst, inst.vx, inst.vz);
    },
  },

  bullet: {
    id: 'bullet', name: 'Bullet', icon: '➤', doc: 'Moves forward along its angle. Optional gravity, lifetime, and destroy-on-solid.',
    props: [
      { key: 'speed', label: 'Speed', type: 'number', default: 30, min: 0 },
      { key: 'gravity', label: 'Gravity', type: 'number', default: 0, min: 0 },
      { key: 'destroyOnSolid', label: 'Destroy on solid', type: 'boolean', default: true },
      { key: 'lifetime', label: 'Lifetime (s, 0 = forever)', type: 'number', default: 3, min: 0 },
      { key: 'enabled', label: 'Enabled', type: 'boolean', default: true },
    ],
    expressions: { Speed: (i) => Math.hypot(i.vx, i.vy, i.vz) },
    tick(inst, p, host, dt) {
      const w = host.world;
      const st = (inst.state.bullet ??= { age: 0, fall: 0 });
      st.age += dt;
      if (Number(p.lifetime) > 0 && st.age >= Number(p.lifetime)) { w.destroy(inst); return; }
      const f = w.forward(w.angle(inst));
      st.fall += Number(p.gravity) * dt;
      inst.vx = f[0] * Number(p.speed); inst.vy = f[1] * Number(p.speed) - st.fall; inst.vz = f[2] * Number(p.speed);
      const hits = moveAndCollide(w, inst, inst.vx * dt, inst.vy * dt, inst.vz * dt, blockersFor(host, inst));
      if (hits.length && p.destroyOnSolid) { host.queueTrigger('bullet.on_hit_solid', { [inst.type]: [inst] }); w.destroy(inst); }
    },
  },

  physics: {
    id: 'physics', name: 'Physics', icon: '⚛', doc: 'Rigid body with gravity, mass, friction and bounce. In 3D it follows its collider shape: cubes and upright cylinders rest on flat faces and tip over edges, spheres and lying cylinders roll, cones stand on their base only; floating bodies tilt. Characters can stand on it and push it. Can be grabbed, dropped and thrown.',
    props: [
      { key: 'mass', label: 'Mass (kg)', type: 'number', default: 1, min: 0.01, step: 0.1 },
      { key: 'friction', label: 'Friction', type: 'number', default: 0.5, min: 0, max: 1, step: 0.05, doc: 'Sliding (dynamic) friction.' },
      { key: 'staticFriction', label: 'Static friction', type: 'number', default: 0, min: 0, max: 2, step: 0.05, advanced: true, doc: 'Grip before it starts to slide. 0 = automatic (1.2 × Friction).' },
      { key: 'bounce', label: 'Bounce', type: 'number', default: 0.3, min: 0, max: 1, step: 0.05, doc: 'Restitution.' },
      { key: 'gravityScale', label: 'Gravity scale', type: 'number', default: 1, step: 0.1 },
      { key: 'linearDamping', label: 'Linear damping', type: 'number', default: 0.05, min: 0, step: 0.01 },
      { key: 'angularDamping', label: 'Angular damping', type: 'number', default: 0.1, min: 0, step: 0.01, advanced: true },
      { key: 'rollingResistance', label: 'Rolling resistance', type: 'number', default: 0.8, min: 0, step: 0.05, advanced: true, doc: 'How quickly rolling balls and cylinders slow down on the ground.' },
      { key: 'centerOfMassY', label: 'Centre of mass height', type: 'number', default: 0, min: -1, max: 1, step: 0.05, advanced: true, doc: 'Shift from the shape\'s own centre of mass, as a fraction of half the height (-1 = bottom-heavy, like a weighted toy).' },
      { key: 'lockRotation', label: 'Lock rotation', type: 'boolean', default: false, doc: 'Never tip or roll (the older upright box behaviour). 2D always keeps rotation locked.' },
      { key: 'immovable', label: 'Immovable', type: 'boolean', default: false },
      { key: 'enabled', label: 'Enabled', type: 'boolean', default: true },
    ],
    expressions: { VelocityX: (i) => i.vx, VelocityY: (i) => i.vy, VelocityZ: (i) => i.vz, Speed: (i) => Math.hypot(i.vx, i.vy, i.vz), Mass: (i, h) => Number(h.world.behavior(i, 'physics')?.props.mass ?? 0), IsHeld: (i) => (i.state.physics?.heldBy ? 1 : 0) },
    tick(inst, p, host, dt) {
      const w = host.world;
      const st = (inst.state.physics ??= { heldBy: 0, grounded: false });
      if (p.immovable) { inst.vx = inst.vy = inst.vz = 0; return; }
      if (st.heldBy) {
        const holder = w.byUid.get(st.heldBy);
        if (!holder || holder.destroyed) { st.heldBy = 0; return; }
        const f = w.forward(w.angle(holder));
        const hb = w.aabb(holder);
        const dist = Number(holder.state.holdDistance ?? 1.4);
        // Held in a VR hand: at the hand; otherwise in front of the holder.
        const hp = holder.state.vr?.holdPoints?.[inst.uid] as [number, number, number] | undefined;
        const tx = hp ? hp[0] : holder.x + f[0] * dist, tz = hp ? hp[2] : holder.z + f[2] * dist;
        const ty = hp ? hp[1] : w.plane === 'xz' ? (hb[1] + hb[4]) / 2 + 0.4 : holder.y + f[1] * dist + 0.3;
        inst.vx = (tx - inst.x) / dt; inst.vy = (ty - inst.y) / dt; inst.vz = (tz - inst.z) / dt;
        inst.x = tx; inst.y = ty; inst.z = tz;
        if (inst.state.rigid) { inst.state.rigid.w = [0, 0, 0]; inst.state.rigid.asleep = false; }
        return;
      }
      if (isRigid(w, inst, p)) { stepRigid(w, inst, p, host, dt, st); return; }
      // Toward a planet's centre in its range (Planet behavior), else the scene's gravity.
      const pull = w.plane === 'xz' ? planetPull(w, inst) : null;
      if (pull) { const k = Number(p.gravityScale) * dt; inst.vx += pull.g[0] * k; inst.vy += pull.g[1] * k; inst.vz += pull.g[2] * k; }
      else inst.vy += host.gravity * Number(p.gravityScale) * dt;
      const damp = Math.max(0, 1 - Number(p.linearDamping) * dt);
      inst.vx *= damp; inst.vy *= damp; inst.vz *= damp;
      // Buoyancy: the submerged share of the body pushes it up by the weight of water it displaces
      // (light objects bob at the surface, heavy ones sink slowly), plus water drag.
      const bb = w.aabb(inst);
      const water = waterAt(w, inst) ?? (() => { const top = { ...inst, y: inst.y - (bb[4] - bb[1]) * 0.5 } as RInstance; return waterAt(w, top); })();
      if (water) {
        const hgt = Math.max(0.01, bb[4] - bb[1]);
        const sub = Math.max(0, Math.min(1, (water.surface - bb[1]) / hgt));
        const vol = hgt * Math.max(0.01, bb[3] - bb[0]) * (w.plane === 'xz' ? Math.max(0.01, bb[5] - bb[2]) : 1);
        const ratio = Math.min(4, (Number(water.props.density ?? 1) * 1000 * vol * 0.002) / Math.max(0.01, Number(p.mass)));
        inst.vy += -host.gravity * Number(p.gravityScale) * ratio * sub * dt;
        const drag = Math.max(0, 1 - Number(water.props.drag ?? 2) * sub * dt);
        inst.vx *= drag; inst.vy *= drag; inst.vz *= drag;
      }
      const hits = moveAndCollide(w, inst, inst.vx * dt, inst.vy * dt, inst.vz * dt, blockersFor(host, inst));
      st.grounded = false;
      const bounce = Number(p.bounce);
      for (const h of hits) {
        const key = h.axis === 0 ? 'vx' : h.axis === 1 ? 'vy' : 'vz';
        const v = (inst as any)[key];
        (inst as any)[key] = Math.abs(v) < 0.6 ? 0 : -v * bounce;
        if ((w.plane === 'xz' || w.plane === 'xy') && h.axis === 1 && h.sign < 0) st.grounded = true;
        if (Math.abs(v) > 2) host.queueTrigger('physics.on_impact', { [inst.type]: [inst] });
      }
      if (st.grounded) {
        const fr = Math.max(0, 1 - Number(p.friction) * 8 * dt);
        inst.vx *= fr; if (w.plane === 'xz') inst.vz *= fr;
        // Resting on a ramp: gravity pulls the body down the slope (less with more friction).
        const ground = hits.find((h) => h.axis === 1 && h.sign < 0)?.other;
        const sl = ground && w.slope(ground);
        if (sl) {
          const sin = sl.grad / Math.hypot(1, sl.grad);
          const acc = Math.abs(host.gravity * Number(p.gravityScale)) * sin * Math.max(0, 1 - Number(p.friction) * 0.6);
          inst.vx += sl.downhill[0] * acc * dt; inst.vz += sl.downhill[1] * acc * dt;
        }
      }
    },
  },

  water: {
    id: 'water', name: 'Water', icon: '🌊', doc: 'Makes this object a body of water: its box is the volume and its top is the surface. Platform characters swim (hold Jump to rise), physics objects float or sink, cars bog down, and the camera underwater muffles sound and tints the view. Triggers: Water › On entered / On left water.',
    props: [
      { key: 'density', label: 'Buoyancy', type: 'number', default: 1, min: 0, max: 3, step: 0.05, doc: 'How strongly things float (1 = water, higher = salty / lava-like).' },
      { key: 'stability', label: 'Tipping resistance', type: 'number', default: 0, min: 0, max: 3, step: 0.1, doc: 'Helps floating objects stay upright (0 = only their own shape and weight decide; higher = rafts and boats right themselves sooner and capsize less).' },
      { key: 'drag', label: 'Drag', type: 'number', default: 2, min: 0, max: 10, step: 0.1 },
      { key: 'swimSpeed', label: 'Swim speed', type: 'number', default: 0.6, min: 0.05, max: 1.5, step: 0.05, doc: 'Multiplier on movement speed while in the water.' },
      // How the water looks (colour, opacity, ripples) is the object's Material › Surface: Water.
      { key: 'enabled', label: 'Enabled', type: 'boolean', default: true },
    ],
    expressions: {},
  },

  sine: {
    id: 'sine', name: 'Sine', icon: '∿', doc: 'Oscillates a property: perfect for moving platforms, bobbing pickups and pulsing lights. Moving Solids carry Platform characters.',
    props: [
      { key: 'movement', label: 'Movement', type: 'choice', default: 'vertical', options: ['horizontal', 'vertical', 'depth', 'angle', 'size'] },
      { key: 'period', label: 'Period (s)', type: 'number', default: 4, min: 0.05 },
      { key: 'magnitude', label: 'Magnitude', type: 'number', default: 2 },
      { key: 'phase', label: 'Phase (0-1)', type: 'number', default: 0, min: 0, max: 1, step: 0.05 },
      { key: 'enabled', label: 'Enabled', type: 'boolean', default: true },
    ],
    expressions: { Value: (i) => i.state.sine?.value ?? 0 },
    tick(inst, p, host, dt) {
      const st = (inst.state.sine ??= { base: { x: inst.x, y: inst.y, z: inst.z, a: host.world.angle(inst), s: inst.sx }, t: 0, moved: [0, 0, 0], value: 0 });
      st.t += dt;
      const v = Number(p.magnitude) * Math.sin(2 * Math.PI * (st.t / Number(p.period) + Number(p.phase)));
      st.value = v;
      const ox = inst.x, oy = inst.y, oz = inst.z;
      switch (p.movement) {
        case 'horizontal': inst.x = st.base.x + v; break;
        case 'vertical': inst.y = st.base.y + v; break;
        case 'depth': inst.z = st.base.z + v; break;
        case 'angle': host.world.setAngle(inst, st.base.a + v); break;
        case 'size': { const s = Math.max(0.01, st.base.s * (1 + v / 10)); inst.sx = s; inst.sy = s; inst.sz = s; break; }
      }
      // Riders read `moved`; pathfinding grids keep using the start position of moving solids.
      st.moved = [inst.x - ox, inst.y - oy, inst.z - oz];
    },
  },

  rotate: {
    id: 'rotate', name: 'Rotate', icon: '⟳', doc: 'Spins continuously around an axis.',
    props: [
      { key: 'speed', label: 'Speed (°/s)', type: 'number', default: 90 },
      { key: 'axis', label: 'Axis', type: 'choice', default: 'y', options: ['x', 'y', 'z'] },
      { key: 'enabled', label: 'Enabled', type: 'boolean', default: true },
    ],
    expressions: {},
    tick(inst, p, _h, dt) {
      const k = p.axis === 'x' ? 'rx' : p.axis === 'z' ? 'rz' : 'ry';
      (inst as any)[k] = (((inst as any)[k] + Number(p.speed) * dt + 540) % 360) - 180;
      // Riders on a spinning (yaw) platform turn with it this frame.
      inst.state.rotate = { yaw: k === 'ry' ? Number(p.speed) * dt : 0 };
    },
  },

  pathfinding: {
    id: 'pathfinding', name: 'Pathfinding', icon: '⌖', doc: 'Finds routes around Solid obstacles with grid A* and follows them. Use "Find path" then wait for "On arrived".',
    props: [
      { key: 'maxSpeed', label: 'Max speed', type: 'number', default: 4, min: 0 },
      { key: 'cellSize', label: 'Cell size', type: 'number', default: 0.5, min: 0.1, step: 0.1 },
      { key: 'agentRadius', label: 'Agent radius', type: 'number', default: 0.45, min: 0, step: 0.05 },
      { key: 'rotateSpeed', label: 'Rotate speed (°/s)', type: 'number', default: 540 },
      { key: 'enabled', label: 'Enabled', type: 'boolean', default: true },
    ],
    expressions: {
      IsMoving: (i) => (i.state.path?.points?.length ? 1 : 0),
      NodeCount: (i) => i.state.path?.points?.length ?? 0,
    },
    tick(inst, p, host, dt) {
      const w = host.world;
      const st = inst.state.path;
      if (!st?.points?.length) {
        inst.vx = inst.vz = 0; if (w.plane === 'xy') inst.vy = 0;
        // Standing still: back to idle (custom animations started by blocks are left alone).
        if (inst.animation === 'walk') inst.animation = 'idle';
        return;
      }
      const [ta, tb] = st.points[0];
      const [ca, cb] = planeAB(w, inst);
      const da = ta - ca, db = tb - cb;
      const d = Math.hypot(da, db);
      const step = Number(p.maxSpeed) * dt;
      if (d <= Math.max(0.05, step)) {
        st.points.shift();
        if (!st.points.length) { host.queueTrigger('pathfinding.on_arrived', { [inst.type]: [inst] }); return; }
      }
      const ua = da / (d || 1), ub = db / (d || 1);
      const ma = ua * Math.min(step, d), mb = ub * Math.min(step, d);
      if (w.plane === 'xz') { inst.vx = ua * Number(p.maxSpeed); inst.vz = ub * Number(p.maxSpeed); moveAndCollide(w, inst, ma, 0, mb, blockersFor(host, inst)); }
      else { inst.vx = ua * Number(p.maxSpeed); inst.vy = ub * Number(p.maxSpeed); moveAndCollide(w, inst, ma, mb, 0, blockersFor(host, inst)); }
      const heading = w.plane === 'xz' ? (Math.atan2(-ub, ua) * 180) / Math.PI : (Math.atan2(ub, ua) * 180) / Math.PI;
      w.setAngle(inst, angleLerp(w.angle(inst), heading, Number(p.rotateSpeed) * dt));
      inst.animation = 'walk';
    },
  },

  health: {
    id: 'health', name: 'Health', icon: '♥', doc: 'Hit points with damage, healing, invulnerability frames, and On damaged / On died triggers.',
    props: [
      { key: 'maxHp', label: 'Max health', type: 'number', default: 100, min: 1 },
      { key: 'hp', label: 'Start health', type: 'number', default: 100, min: 0 },
      { key: 'invulnerableTime', label: 'Invulnerable after hit (s)', type: 'number', default: 0, min: 0, step: 0.05 },
      { key: 'enabled', label: 'Enabled', type: 'boolean', default: true },
    ],
    expressions: {
      HP: (i) => i.state.health?.hp ?? 0,
      MaxHP: (i) => i.state.health?.max ?? 0,
      Percent: (i) => (i.state.health ? (100 * i.state.health.hp) / i.state.health.max : 0),
      IsDead: (i) => (i.state.health?.dead ? 1 : 0),
    },
    init(inst, host) {
      const p = host.world.behavior(inst, 'health')!.props;
      inst.state.health = { hp: Number(p.hp ?? p.maxHp), max: Number(p.maxHp), invuln: 0, dead: false };
    },
    tick(inst, _p, _h, dt) {
      const st = inst.state.health; if (st && st.invuln > 0) st.invuln = Math.max(0, st.invuln - dt);
      if (st?.hitT > 0) st.hitT = Math.max(0, st.hitT - dt);
    },
  },

  gridboard: {
    id: 'gridboard', name: 'Grid Board', icon: '▦', gamecraftOnly: true, doc: 'A grid of cells for turn-based games, centred on this object. Grid Piece objects move on it: the enemies only move after the player\'s move has finished (see the Grid blocks).',
    props: [
      { key: 'cols', label: 'Columns', type: 'number', default: 8, min: 1, step: 1 },
      { key: 'rows', label: 'Rows', type: 'number', default: 8, min: 1, step: 1 },
      { key: 'cellSize', label: 'Cell size (m)', type: 'number', default: 2, min: 0.05, step: 0.1 },
      { key: 'orientation', label: 'Orientation', type: 'choice', default: 'flat', options: ['flat', 'upright'], doc: 'Flat lies on the ground (X and Z); upright stands up (X and Y, for 2D games).' },
      { key: 'rotation', label: 'Rotation (degrees)', type: 'number', default: 0, step: 15 },
      { key: 'moveSpeed', label: 'Move speed (cells/s)', type: 'number', default: 4, min: 0.1, step: 0.5 },
      { key: 'movesPerTurn', label: 'Player moves per turn', type: 'number', default: 1, min: 1, step: 1 },
      { key: 'enemyMovesPerTurn', label: 'Enemy moves per turn', type: 'number', default: 0, min: 0, step: 1, doc: '0: every enemy moves, one after the other. 1 or more: only that many, a capture first, otherwise taking turns.' },
      { key: 'capture', label: 'Pieces can capture', type: 'boolean', default: false, doc: 'On: moving onto an opposing piece removes it. Off: occupied cells are closed.' },
      { key: 'solidsBlock', label: 'Solid objects block cells', type: 'boolean', default: true },
      { key: 'autoEnemyTurn', label: 'Enemies move by themselves', type: 'boolean', default: true, doc: 'Off: your logic moves them (Move piece on grid) in On enemy turn started, then runs End grid turn.' },
      { key: 'showLines', label: 'Show grid lines', type: 'boolean', default: true },
      { key: 'lineColor', label: 'Line colour', type: 'string', default: '#ffffff' },
      { key: 'selectColor', label: 'Selected colour', type: 'string', default: '#ffc640' },
      { key: 'reachColor', label: 'Reachable colour', type: 'string', default: '#3fd07a' },
      { key: 'enabled', label: 'Enabled', type: 'boolean', default: true },
    ],
    expressions: { IsPlayerTurn: (i) => (i.state.grid?.phase === 'player' ? 1 : 0), SelectedCol: (i) => i.vars.cellCol ?? -1, SelectedRow: (i) => i.vars.cellRow ?? -1 },
    init(inst) { initBoard(inst); },
    tick(inst, p, host, dt) { initBoard(inst); tickBoard(inst, p, host, dt); },
  },

  gridpiece: {
    id: 'gridpiece', name: 'Grid Piece', icon: '♟', gamecraftOnly: true, doc: 'This object moves on the Grid Board, cell by cell, on its side\'s turn.',
    props: [
      { key: 'side', label: 'Side', type: 'choice', default: 'player', options: ['player', 'enemy'] },
      { key: 'style', label: 'Moves like', type: 'choice', default: 'walk', options: ['walk', 'walk diagonal', 'rook', 'bishop', 'queen', 'king', 'knight', 'pawn'], doc: 'Walk: to the neighbouring cells, up to the range. Rook, bishop, queen: in straight lines; king: one cell; knight: jumps; pawn: forward, capturing diagonally.' },
      { key: 'range', label: 'Range (cells)', type: 'number', default: 3, min: 0, step: 1 },
      { key: 'pathfinding', label: 'Finds a way around', type: 'boolean', default: true, doc: 'Walk: goes around blocked cells. Off: straight lines only.' },
      { key: 'ai', label: 'As an enemy', type: 'choice', default: 'chase', options: ['chase', 'stay'], doc: 'Chase: moves towards the nearest opposing piece, and captures when it can.' },
      { key: 'col', label: 'Start column (-1 = where it stands)', type: 'number', default: -1, min: -1, step: 1 },
      { key: 'row', label: 'Start row (-1 = where it stands)', type: 'number', default: -1, min: -1, step: 1 },
      { key: 'enabled', label: 'Enabled', type: 'boolean', default: true },
    ],
    expressions: { Col: (i) => i.state.gridPiece?.c ?? -1, Row: (i) => i.state.gridPiece?.r ?? -1 },
  },

  timer: {
    id: 'timer', name: 'Timer', icon: '⏱', doc: 'Named countdown timers that fire "On timer".',
    props: [{ key: 'enabled', label: 'Enabled', type: 'boolean', default: true }],
    expressions: {},
    tick(inst, _p, host, dt) {
      const timers = inst.state.timers as Record<string, { left: number; dur: number; repeat: boolean }> | undefined;
      if (!timers) return;
      for (const tag of Object.keys(timers)) {
        const t = timers[tag];
        t.left -= dt;
        if (t.left <= 0) {
          host.queueTrigger('timer.on_timer', { [inst.type]: [inst] }, { tag });
          if (t.repeat) t.left += t.dur; else delete timers[tag];
        }
      }
    },
  },

  follow: {
    id: 'follow', name: 'Follow (camera rig)', icon: '🎥', doc: 'Smoothly follows a target. With "Orbit with mouse" the camera orbits the target (drag / pointer lock). Use on cameras or any object.',
    props: [
      { key: 'target', label: 'Target', type: 'objectType', default: 'Player' },
      { key: 'offsetX', label: 'Offset X', type: 'number', default: 0 },
      { key: 'offsetY', label: 'Offset Y', type: 'number', default: 6 },
      { key: 'offsetZ', label: 'Offset Z', type: 'number', default: 10 },
      { key: 'rotateWithTarget', label: 'Rotate offset with target', type: 'boolean', default: false },
      { key: 'smoothing', label: 'Smoothing', type: 'number', default: 0.85, min: 0, max: 0.99, step: 0.01 },
      { key: 'lookAt', label: 'Look at target', type: 'boolean', default: true },
      { key: 'orbitWithMouse', label: 'Orbit with mouse', type: 'boolean', default: false },
      { key: 'sensitivity', label: 'Mouse sensitivity', type: 'number', default: 0.25, min: 0, step: 0.05 },
      { key: 'distance', label: 'Orbit distance', type: 'number', default: 8, min: 0.5 },
      { key: 'avoidWalls', label: 'Keep in front of walls', type: 'boolean', default: false, doc: 'Moves the camera closer when a Solid is between it and the target (3D).' },
      { key: 'firstPerson', label: 'First person (mouse look)', type: 'boolean', default: false },
      { key: 'eyeHeight', label: 'Eye height', type: 'number', default: 1.6, step: 0.05 },
      { key: 'eyeForward', label: 'Eye forward', type: 'number', default: 0, step: 0.05, advanced: true, doc: 'First person: eyes this far ahead of (negative: behind) the target\'s origin.' },
      { key: 'zoomWithWheel', label: 'Zoom with the mouse wheel', type: 'boolean', default: true, doc: 'While playing: the wheel moves the camera nearer or farther (between the closest and farthest distance below).' },
      { key: 'minDistance', label: 'Closest zoom', type: 'number', default: 1.5, min: 0.3, step: 0.1 },
      { key: 'maxDistance', label: 'Farthest zoom', type: 'number', default: 40, min: 1, step: 1 },
      { key: 'wheelSwitch', label: 'Zoom into first person', type: 'boolean', default: true, doc: 'Zooming all the way in goes to first person; scrolling out of first person goes back to third person.' },
      { key: 'switchKey', label: 'Key: first / third person', type: 'string', default: 'V', doc: 'Pressing it switches between first person and third person while playing. Empty: no switching.' },
      { key: 'frameAll', label: 'Frame every target (multiplayer)', type: 'boolean', default: false, doc: 'Follow the middle of all objects of the target type and pull back as they spread apart (shared-screen local multiplayer).' },
      { key: 'enabled', label: 'Enabled', type: 'boolean', default: true },
    ],
    // LookPitch: first-person vertical look angle in degrees (up is positive).
    expressions: { LookPitch: (i) => ((i.state.follow?.fpPitch ?? 0) * 180) / Math.PI },
    tick(inst, p, host, dt) {
      const w = host.world;
      let t = w.findByName(String(p.target));
      if (!t) return;
      let spread = 0;
      if (p.frameAll && !p.firstPerson) {
        const all = w.of(String(p.target));
        if (all.length > 1) {
          const cx = all.reduce((a, i) => a + i.x, 0) / all.length, cy = all.reduce((a, i) => a + i.y, 0) / all.length, cz = all.reduce((a, i) => a + i.z, 0) / all.length;
          spread = Math.max(...all.map((i) => Math.hypot(i.x - cx, (i.y - cy) * 0.5, i.z - cz)));
          t = { ...t, x: cx, y: cy, z: cz } as RInstance;
        }
      }
      // While playing: the wheel zooms, a key (V) or zooming all the way in switches between first and third person.
      const vs = (inst.state.follow ??= {}) as { fpOn?: boolean; dist?: number; yaw?: number; pitch?: number; fpProp?: boolean };
      // (The player's own switch is remembered, but a change to the setting itself, e.g. getting into a vehicle with a
      // first-person seat, wins over it.)
      if (vs.fpProp !== !!p.firstPerson) { vs.fpProp = !!p.firstPerson; vs.fpOn = !!p.firstPerson; }
      let fpOn = vs.fpOn ?? !!p.firstPerson;
      const baseDist = p.orbitWithMouse ? Number(p.distance) : Math.hypot(Number(p.offsetX), Number(p.offsetY), Number(p.offsetZ)) || Number(p.distance) || 6;
      if (w.plane === 'xz') {
        const key = String(p.switchKey ?? 'V').trim();
        if (key && host.input.pressed.has(key.length === 1 ? key.toUpperCase() : key)) { fpOn = !fpOn; if (!fpOn) { vs.yaw = NaN; vs.pitch = NaN; } }
        const wheel = Number(host.input.mouse.wheel) || 0;
        if (wheel && p.zoomWithWheel !== false) {
          const lo = Math.max(0.3, Number(p.minDistance) || 1.5), hi = Math.max(lo + 0.5, Number(p.maxDistance) || 40);
          if (fpOn) { if (wheel > 0 && p.wheelSwitch !== false) { fpOn = false; vs.yaw = NaN; vs.pitch = NaN; vs.dist = Math.max(lo * 2, Math.min(hi, 4)); } }
          else {
            const was = vs.dist ?? baseDist;
            vs.dist = Math.max(lo, Math.min(hi, was * Math.exp(wheel * 0.0012)));
            if (wheel < 0 && was <= lo + 1e-3 && p.wheelSwitch !== false) fpOn = true;
          }
        }
      }
      vs.fpOn = fpOn;
      // Third person after starting in first person: orbit round the target with the mouse.
      const orbitNow = !!p.orbitWithMouse || (!!p.firstPerson && !fpOn);
      if (fpOn && w.plane === 'xz') {
        // Camera sits in the target's head; the mouse turns the target (yaw) and tilts the view (pitch).
        const fp = (inst.state.follow ??= { fpYaw: (w.angle(t) * Math.PI) / 180, fpPitch: 0 });
        fp.fpYaw ??= (w.angle(t) * Math.PI) / 180; fp.fpPitch ??= 0;
        const sens = Number(p.sensitivity) * 0.01;
        fp.fpYaw -= host.input.mouse.dx * sens;
        fp.fpPitch = Math.max(-1.45, Math.min(1.45, fp.fpPitch - host.input.mouse.dy * sens));
        // Riding a vehicle: the view turns with it (looking around is relative) and the vehicle sets the body's heading.
        const veh = t.state.inVehicle ? w.byUid.get(t.state.inVehicle) : undefined;
        if (veh) { const va = (w.angle(veh) * Math.PI) / 180; if (fp.vehYaw != null) fp.fpYaw += va - fp.vehYaw; fp.vehYaw = va; }
        else { fp.vehYaw = undefined; w.setAngle(t, (fp.fpYaw * 180) / Math.PI); }
        const [px, py, pz] = w.worldPos(t);
        // Eyes forward/back of the origin along the body's heading (a seated pose puts the head behind it).
        const ef = Number(p.eyeForward) || 0, ba = (w.angle(t) * Math.PI) / 180;
        inst.x = px + Math.cos(ba) * ef; inst.y = py + Number(p.eyeHeight); inst.z = pz - Math.sin(ba) * ef;
        const cp = Math.cos(fp.fpPitch);
        applyBlend(inst, dt);
        inst.state.lookAt = [inst.x + Math.cos(fp.fpYaw) * cp, inst.y + Math.sin(fp.fpPitch), inst.z - Math.sin(fp.fpYaw) * cp];
        return;
      }
      const st = (inst.state.follow ??= { yaw: Math.atan2(Number(p.offsetX), Number(p.offsetZ)), pitch: Math.atan2(Number(p.offsetY), Math.hypot(Number(p.offsetX), Number(p.offsetZ))) });
      let ox = Number(p.offsetX), oy = Number(p.offsetY), oz = Number(p.offsetZ);
      // Coming back from first person (getting out of a vehicle): start the orbit behind the target.
      if (!Number.isFinite(st.yaw)) { const a = (w.angle(t) * Math.PI) / 180; st.yaw = Math.atan2(-Math.cos(a), Math.sin(a)); }
      if (!Number.isFinite(st.pitch)) st.pitch = 0.35;
      if (orbitNow && w.plane === 'xz') {
        st.yaw -= host.input.mouse.dx * Number(p.sensitivity) * 0.01;
        st.pitch = Math.max(-0.2, Math.min(1.35, st.pitch + host.input.mouse.dy * Number(p.sensitivity) * 0.01));
        const d = vs.dist ?? Number(p.distance);
        ox = Math.sin(st.yaw) * Math.cos(st.pitch) * d; oz = Math.cos(st.yaw) * Math.cos(st.pitch) * d; oy = Math.sin(st.pitch) * d;
      } else if (p.rotateWithTarget) {
        // Offset is expressed relative to the target facing +X (behind = negative forward).
        const a = (w.angle(t) * Math.PI) / 180;
        if (w.plane === 'xz') { const c = Math.cos(a), s = Math.sin(a); const nx = ox * c + oz * s; const nz = -ox * s + oz * c; ox = nx; oz = nz; }
      }
      // Following a Surface Walker on a planet or a wall: frame it in its own "up" (above it, keeping the side the camera
      // is on, rolled with it), so walking under a planet or up a wall stays playable.
      const wk = t.state.walker as { up: [number, number, number]; heading: [number, number, number] } | undefined;
      if (wk && w.plane === 'xz' && !p.orbitWithMouse && (wk.up[1] < 0.98 || inst.state.camUp)) {
        const u = wk.up, d0 = [inst.x - t.x, inst.y - t.y, inst.z - t.z], du = d0[0] * u[0] + d0[1] * u[1] + d0[2] * u[2];
        let b = [d0[0] - u[0] * du, d0[1] - u[1] * du, d0[2] - u[2] * du];
        let bl = Math.hypot(b[0], b[1], b[2]);
        if (bl < 0.2) { b = [-wk.heading[0], -wk.heading[1], -wk.heading[2]]; bl = 1; }
        const back = Math.hypot(ox, oz);
        const cu = (inst.state.camUp ??= [0, 1, 0]) as number[], kk = 1 - Math.pow(0.9, dt * 60);
        for (let a = 0; a < 3; a++) cu[a] += (u[a] - cu[a]) * kk;
        const cl = Math.hypot(cu[0], cu[1], cu[2]) || 1; for (let a = 0; a < 3; a++) cu[a] /= cl;
        if (wk.up[1] >= 0.98 && cu[1] > 0.999) inst.state.camUp = undefined; // back on level ground: normal follow again
        ox = (b[0] / bl) * back + u[0] * oy; oz = (b[2] / bl) * back + u[2] * oy; oy = (b[1] / bl) * back + u[1] * oy;
      }
      // Zoomed with the wheel: a fixed offset keeps its direction at the new distance.
      if (!orbitNow && vs.dist && w.plane === 'xz') { const L = Math.hypot(ox, oy, oz) || 1; ox *= vs.dist / L; oy *= vs.dist / L; oz *= vs.dist / L; }
      if (spread > 0 && w.plane === 'xz') { const k = 1 + spread * 0.12; ox *= k; oy *= k; oz *= k; }
      if (spread > 0 && w.plane === 'xy') inst.state.frameSpread = spread;
      let tx = t.x + ox, ty = t.y + oy, tz = t.z + oz;
      let pulledIn = false;
      if (p.avoidWalls && w.plane === 'xz') {
        // Ray from the target's head to the wanted camera spot; stop just in front of the first solid.
        const tb = w.aabb(t);
        const o: [number, number, number] = [(tb[0] + tb[3]) / 2, tb[4] - 0.2, (tb[2] + tb[5]) / 2];
        const d: [number, number, number] = [tx - o[0], ty - o[1], tz - o[2]];
        const len = Math.hypot(d[0], d[1], d[2]);
        const hit = len > 0.01 ? raycast(w, o, d, len, w.solids().filter((s) => s !== t), t) : null;
        if (hit) {
          const keep = Math.max(0.6, hit.dist - 0.35) / len;
          tx = o[0] + d[0] * keep; ty = o[1] + d[1] * keep; tz = o[2] + d[2] * keep;
          pulledIn = true;
        }
      }
      // Snap (no smoothing lag) while pulled in, so the camera never sits inside a wall.
      const k = st.snapped && !pulledIn ? 1 - Math.pow(Number(p.smoothing), dt * 60) : 1;
      st.snapped = true;
      if (!Number.isFinite(inst.x + inst.y + inst.z)) { inst.x = tx; inst.y = ty; inst.z = tz; }
      inst.x += (tx - inst.x) * k; inst.y += (ty - inst.y) * k; inst.z += (tz - inst.z) * k;
      if (w.plane === 'xy') inst.z = tz;
      applyBlend(inst, dt);
      const lu = inst.state.camUp as number[] | undefined;
      if (p.lookAt || orbitNow) inst.state.lookAt = lu ? [t.x + lu[0], t.y + lu[1], t.z + lu[2]] : [t.x, t.y + (w.plane === 'xz' ? 1 : 0), t.z];
    },
  },
  // NPC and enemy presets (Path follower, Wander, NPC interaction, Slime, Flying enemy).
  ...AI_BEHAVIORS,
  breakable: BREAKABLE,
  rope: ROPE,
  vehicle: VEHICLE,
  interactable: INTERACTABLE,
  vrplayer: VR_PLAYER,
  procanim: PROC_ANIM,
  surfacewalker: SURFACE_WALKER,
  planet: PLANET,
  platformtype: PLATFORM_TYPE,
  trail: TRAIL,
};
// Surface Walker's player-controls choice (its module loads before this one has defined controlsProp).
if (!SURFACE_WALKER.props.some((x) => x.key === 'controls')) SURFACE_WALKER.props.splice(SURFACE_WALKER.props.length - 1, 0, controlsProp);

export function behaviorDefaults(type: string): Record<string, any> {
  const d = BEHAVIORS[type];
  const out: Record<string, any> = {};
  for (const p of d?.props ?? []) out[p.key] = p.default;
  return out;
}

/** Physics world step after individual behaviors: body-body contacts. */
export function stepBodyContacts(host: BehaviorHost) {
  // Rigid (3D shape-aware) bodies resolve their own contacts, other bodies included.
  const bodies = physicsBodies(host).filter((b) => !b.state.physics?.heldBy && !isRigid(host.world, b, host.world.behavior(b, 'physics')!.props));
  if (bodies.length < 2) return;
  resolveBodies(host.world, bodies,
    (i) => (host.world.behavior(i, 'physics')?.props.immovable ? 0 : Number(host.world.behavior(i, 'physics')?.props.mass ?? 1)),
    (i) => Number(host.world.behavior(i, 'physics')?.props.bounce ?? 0.3));
}

export function requestPath(host: BehaviorHost, inst: RInstance, toA: number, toB: number): boolean {
  const w = host.world;
  const p = w.behavior(inst, 'pathfinding')?.props;
  if (!p) return false;
  const bb = w.aabb(inst);
  const g = getGrid(w, Number(p.cellSize), Number(p.agentRadius), w.plane === 'xz' ? bb[1] : 0);
  const [a, b] = planeAB(w, inst);
  const pts = findPath(g, a, b, toA, toB);
  inst.state.path = { points: pts ?? [], target: [toA, toB] };
  if (!pts) { host.queueTrigger('pathfinding.on_failed', { [inst.type]: [inst] }); return false; }
  host.queueTrigger('pathfinding.on_path_found', { [inst.type]: [inst] });
  return true;
}

export { lineOfSight };
