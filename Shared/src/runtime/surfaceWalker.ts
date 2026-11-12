// Surface Walker: a character controller whose "up" can point any way. On a Planet it walks all the way round (up =
// away from the centre, the sphere walked on exactly); with Walk on walls, walking into a wall makes it the floor and
// walking off an edge wraps round it, onto the next face (ceilings too). Movement is relative to the camera, laid
// onto the surface it stands on. The body turns to stand on the surface (rx, ry, rz); its collision box turns with it.
import { angleLerp, approach, control, KEYS, type BehaviorDef, type BehaviorHost } from './behaviors';
import type { RInstance } from './world';
import { moveAndCollide, raycast } from './physics';
import { planetPull, planetShape } from './planets';

type V3 = [number, number, number];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const add = (a: V3, b: V3, k = 1): V3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const scale = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const norm = (a: V3, fb: V3 = [0, 1, 0]): V3 => { const l = len(a); return l > 1e-9 ? scale(a, 1 / l) : fb; };
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const flat = (v: V3, up: V3): V3 => add(v, up, -dot(v, up));
/** The axis (0 x, 1 y, 2 z) a vector mostly points along. */
const major = (v: V3) => (Math.abs(v[0]) >= Math.abs(v[1]) && Math.abs(v[0]) >= Math.abs(v[2]) ? 0 : Math.abs(v[1]) >= Math.abs(v[2]) ? 1 : 2);
const axisUnit = (a: number, s: number): V3 => { const v: V3 = [0, 0, 0]; v[a] = s < 0 ? -1 : 1; return v; };

export interface WalkerState {
  up: V3; vt: V3; vUp: number; grounded: boolean; heading: V3; air: number; jumps: number;
  /** The collider as authored (height along y); turned to stand along `up` on walls. */
  base?: { size: V3; offset: V3 };
  /** Drawn up (eased toward `up`, so turning onto a wall looks smooth). */
  look: V3;
}

export function walkerState(inst: RInstance): WalkerState {
  return (inst.state.walker ??= { up: [0, 1, 0], vt: [0, 0, 0], vUp: 0, grounded: false, heading: [1, 0, 0], air: 0, jumps: 0, look: [0, 1, 0] } as WalkerState);
}

export const SURFACE_WALKER: BehaviorDef = {
  id: 'surfacewalker', name: 'Surface Walker (planets, walls)', icon: '🧲', gamecraftOnly: true,
  doc: 'A 3D character that walks on whatever it stands on: all the way round Planet objects, and (with Walk on walls) up walls and across ceilings, wrapping round edges. WASD moves relative to the camera, Space jumps. Use instead of Platform.',
  props: [
    { key: 'maxSpeed', label: 'Speed (m/s)', type: 'number', default: 5, min: 0, step: 0.5 },
    { key: 'runMultiplier', label: 'Run multiplier (Shift)', type: 'number', default: 1.6, min: 1, step: 0.1 },
    { key: 'acceleration', label: 'Acceleration', type: 'number', default: 40, min: 0 },
    { key: 'jumpStrength', label: 'Jump strength', type: 'number', default: 8, min: 0, step: 0.5 },
    { key: 'jumpCount', label: 'Jumps', type: 'number', default: 1, min: 1, step: 1, doc: '1 = normal jump, 2 = double jump, 3 = triple jump… in the air.' },
    { key: 'unlimitedJumps', label: 'Unlimited jumps', type: 'boolean', default: false },
    { key: 'gravity', label: 'Gravity (m/s²)', type: 'number', default: 25, min: 0, doc: 'Toward the surface it walks on (a Planet uses its own gravity).' },
    { key: 'walkOnWalls', label: 'Walk on walls', type: 'boolean', default: false, doc: 'Walking into a wall climbs onto it; walking off an edge wraps round it. Jumping off and staying in the air a moment drops back to normal gravity.' },
    { key: 'planets', label: 'Planets pull it', type: 'boolean', default: true },
    { key: 'turnSpeed', label: 'Turn speed (°/s)', type: 'number', default: 720, advanced: true },
    { key: 'defaultControls', label: 'Default controls', type: 'boolean', default: true },
    // + Controls (player), inserted by behaviors.ts once it is defined (the two modules import each other).
    { key: 'enabled', label: 'Enabled', type: 'boolean', default: true },
  ],
  expressions: {
    Speed: (i) => len(walkerState(i).vt),
    IsOnFloor: (i) => (walkerState(i).grounded ? 1 : 0),
    UpX: (i) => walkerState(i).up[0], UpY: (i) => walkerState(i).up[1], UpZ: (i) => walkerState(i).up[2],
  },
  tick(inst, p, host, dt) {
    const w = host.world;
    if (w.plane !== 'xz' || dt <= 0) return;
    const st = walkerState(inst);
    st.base ??= { size: [...inst.collider.size] as V3, offset: [...inst.collider.offset] as V3 };
    const pull = p.planets !== false ? planetPull(w, inst) : null;
    if (pull) st.up = pull.up;
    else if (!p.walkOnWalls || (st.air > 0.35 && !st.grounded)) st.up = [0, 1, 0];
    const up = st.up;
    standAlong(inst, st, up);
    // Input: the camera's forward and right, laid onto the surface.
    // On a wall the part of the camera's forward that goes into the surface means "up the surface" (W climbs a
    // wall you face); on floors that part is zero.
    const [cfx, cfz] = host.cameraForward;
    const cam: V3 = cameraForward3(host) ?? [cfx, 0, cfz];
    const fv = add(flat(cam, up), norm(flat([0, 1, 0], up), [0, 0, 0]), Math.max(0, -dot(cam, up)));
    let fwd = norm(fv, st.heading);
    if (len(fv) < 0.2) fwd = norm(flat(st.heading, up), [1, 0, 0]); // looking straight along up (planet poles)
    const right = norm(cross(fwd, up), [0, 0, 1]);
    const f = (control(inst, 'up', KEYS.up, p, host) ? 1 : 0) - (control(inst, 'down', KEYS.down, p, host) ? 1 : 0);
    const r = (control(inst, 'right', KEYS.right, p, host) ? 1 : 0) - (control(inst, 'left', KEYS.left, p, host) ? 1 : 0);
    const run = control(inst, 'run', ['Shift'], p, host) ? Number(p.runMultiplier ?? 1) : 1;
    const want = scale(norm(add(scale(fwd, f), right, r), [0, 0, 0]), (f || r ? 1 : 0) * Number(p.maxSpeed) * run);
    st.vt = flat(st.vt, up);
    const acc = Number(p.acceleration) * (st.grounded ? 1 : 0.6) * dt;
    st.vt = [approach(st.vt[0], want[0], acc), approach(st.vt[1], want[1], acc), approach(st.vt[2], want[2], acc)];
    if (st.grounded) st.jumps = 0;
    if (control(inst, 'jump', KEYS.jump3d, p, host, true)) {
      // Jumps in a row, as on Platform: walking off a ledge spends the ground jump.
      if (!st.grounded && !st.jumps) st.jumps = 1;
      if (st.grounded || p.unlimitedJumps || st.jumps < Math.max(1, Number(p.jumpCount ?? 1))) { st.vUp = Number(p.jumpStrength); st.grounded = false; st.jumps++; host.queueTrigger('platform.on_jump', { [inst.type]: [inst] }); }
    }
    const g = pull ? len(pull.g) : Number(p.gravity ?? 25);
    st.vUp = Math.max(-40, st.vUp - g * dt);
    const wasGrounded = st.grounded;
    const move = add(st.vt, up, st.vUp);
    const blockers = w.blockersFor(inst).filter((b) => b !== pull?.planet);
    const hits = moveAndCollide(w, inst, move[0] * dt, move[1] * dt, move[2] * dt, blockers);
    st.grounded = false;
    const ua = major(up), us = Math.sign(up[ua]);
    for (const h of hits) {
      if (h.axis === ua && h.sign === -us) { st.grounded = true; if (st.vUp < 0) st.vUp = 0; continue; } // the floor we stand on
      if (h.axis === ua) { if (st.vUp > 0) st.vUp = 0; continue; } // head bump
      // A wall: climb onto it (Walk on walls), else stop against it.
      const into = axisUnit(h.axis, h.sign);
      if (p.walkOnWalls && !pull && dot(st.vt, into) > 0.5) {
        const nUp = axisUnit(h.axis, -h.sign), speed = dot(st.vt, into);
        st.vt = add(flat(st.vt, into), up, speed); // the push into the wall turns into climbing up it
        st.up = nUp; st.vUp = 0; st.grounded = true;
        standAlong(inst, st, nUp);
      } else st.vt = flat(st.vt, into);
    }
    // Planet: the sphere itself, exactly (feet on its surface).
    if (pull) {
      const { center, radius } = planetShape(w, pull.planet);
      const foot = footDistance(inst, st);
      const pos: V3 = [inst.x, inst.y, inst.z], d = add(pos, center, -1), dist = len(d);
      if (dist < radius + foot + 0.002) {
        const n = norm(d);
        [inst.x, inst.y, inst.z] = add(center, n, radius + foot);
        if (st.vUp < 0) st.vUp = 0;
        st.grounded = true;
      }
      st.up = norm(add([inst.x, inst.y, inst.z], center, -1));
    } else if (p.walkOnWalls && wasGrounded && !st.grounded && st.vUp <= 0) wrapEdge(inst, st, host);
    st.air = st.grounded ? 0 : st.air + dt;
    // Velocity for other systems (camera, animation, Speed).
    const v = add(st.vt, st.up, st.vUp); inst.vx = v[0]; inst.vy = v[1]; inst.vz = v[2];
    face(inst, st, p, dt);
  },
};

/** The active camera's full view direction (with height), when a camera looks at something (Follow). */
function cameraForward3(host: BehaviorHost): V3 | null {
  const cams = host.world.instances.filter((i) => i.kind === 'camera' && !i.destroyed);
  const cam = cams.find((c) => c.camera?.active) ?? cams[0];
  const la = cam?.state.lookAt as V3 | undefined;
  if (!cam || !la) return null;
  const d: V3 = [la[0] - cam.x, la[1] - cam.y, la[2] - cam.z];
  return len(d) > 1e-6 ? norm(d) : null;
}

/** How far the feet are from the object's position along its up (centre-pivot boxes: half the height). */
function footDistance(inst: RInstance, st: WalkerState): number {
  const b = st.base!;
  return Math.abs(b.size[1] * inst.sy) / 2 - b.offset[1] * inst.sy;
}

/** Turn the collision box so its height runs along `up` (standing on a wall or ceiling). */
function standAlong(inst: RInstance, st: WalkerState, up: V3) {
  const b = st.base!, a = major(up), s = Math.sign(up[a]) || 1;
  // Height along the up axis; width and depth on the other two (in order).
  const others = [0, 1, 2].filter((x) => x !== a);
  const size: V3 = [0, 0, 0]; size[a] = b.size[1]; size[others[0]] = b.size[0]; size[others[1]] = b.size[2];
  const offset: V3 = [0, 0, 0]; offset[a] = b.offset[1] * s;
  const c = inst.collider;
  if (c.size[0] !== size[0] || c.size[1] !== size[1] || c.size[2] !== size[2] || c.offset[0] !== offset[0] || c.offset[1] !== offset[1] || c.offset[2] !== offset[2]) inst.collider = { ...c, size, offset };
}

/** Walked off the edge of a face with nothing under: carry on round the edge onto the face below it. */
function wrapEdge(inst: RInstance, st: WalkerState, host: BehaviorHost) {
  const w = host.world, up = st.up;
  const blockers = w.blockersFor(inst);
  const foot = footDistance(inst, st);
  // Still ground just under (a small step down)? Then it is not an edge.
  if (raycast(w, [inst.x, inst.y, inst.z], scale(up, -1), foot + 0.25, blockers, inst)) return;
  const dir = norm(flat(st.vt, up), [0, 0, 0]);
  if (len(dir) < 0.5) return;
  const na = major(dir), nUp = axisUnit(na, dir[na]); // the face round the edge looks the way we were walking
  // Find it: just behind us, below the edge.
  const probe = add(add([inst.x, inst.y, inst.z], up, -(foot + 0.3)), nUp, 0.6);
  const hit = raycast(w, probe, scale(nUp, -1), 1.5, blockers, inst);
  if (!hit || dot(hit.normal as V3, nUp) < 0.9) return;
  const speed = len(st.vt);
  st.up = nUp; standAlong(inst, st, nUp);
  // Stand on that face, just below the edge; the forward speed now runs down it.
  const target = add(add(hit.point as V3, nUp, footDistance(inst, st) + 0.01), up, 0);
  inst.x = target[0]; inst.y = target[1]; inst.z = target[2];
  st.vt = scale(up, -speed); st.vUp = 0; st.grounded = true;
}

/** Turn the body: up along the surface normal (eased), facing where it walks. */
function face(inst: RInstance, st: WalkerState, p: Record<string, any>, dt: number) {
  const k = 1 - Math.exp(-dt * 10);
  st.look = norm(add(st.look, add(st.up, st.look, -1), k), st.up);
  const up = st.look;
  const moving = len(st.vt) > 0.3;
  const want = moving ? norm(flat(st.vt, up)) : norm(flat(st.heading, up), [1, 0, 0]);
  // Turn the heading toward the movement at the turn speed, in the surface plane.
  const cur = norm(flat(st.heading, up), want);
  const ang = Math.atan2(dot(cross(cur, want), up), dot(cur, want)) * 180 / Math.PI;
  const step = angleLerp(0, ang, Number(p.turnSpeed ?? 720) * dt) * Math.PI / 180;
  const c = Math.cos(step), s = Math.sin(step), side = cross(up, cur);
  st.heading = norm(add(scale(cur, c), side, s));
  // Basis: X forward (heading 0 = +X), Y up, Z = X × Y; as Euler YXZ degrees (the renderer's order).
  const X = st.heading, Y = up, Z = cross(X, Y);
  const m23 = Z[1], rx = Math.asin(-Math.max(-1, Math.min(1, m23)));
  let ry: number, rz: number;
  if (Math.abs(m23) < 0.9999999) { ry = Math.atan2(Z[0], Z[2]); rz = Math.atan2(X[1], Y[1]); }
  else { ry = Math.atan2(-X[2], X[0]); rz = 0; }
  inst.rx = rx * 180 / Math.PI; inst.ry = ry * 180 / Math.PI; inst.rz = rz * 180 / Math.PI;
}
