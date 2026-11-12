// Drivable vehicles and interaction points.
//   Vehicle           - on a Car: the driver walks up and presses a key to get in (their movement is switched off and
//                       they ride in the seat), drives with the Car behavior (or custom keys), and gets out at the door.
//                       The camera can switch to first person (from the seat) or a third-person chase view, blending
//                       smoothly. Triggers: Vehicle › On entered / On exited vehicle.
//   Interaction point - "Press E to knock": shows a prompt when the player is close and fires On interacted on the key.
// This module must not import behaviors.ts (it spreads these into BEHAVIORS).
import type { RInstance, World } from './world';
import type { BehaviorDef, BehaviorHost } from './behaviors';
import { buttonPrompt, padStyle } from './input';

/** "Rotate model part": a named part of a model swinging on a hinge (the 3D view turns it; see sceneView). */
export interface PartSwing { hinge: string; from: number; to: number; t0: number; dur: number }
/** The part's angle at time `t` (smooth in and out). */
export function partAngle(s: PartSwing, t: number): number {
  const k = s.dur <= 0 ? 1 : Math.min(1, Math.max(0, (t - s.t0) / s.dur));
  return s.from + (s.to - s.from) * (k * k * (3 - 2 * k));
}

const MOVERS = ['platform', 'eightdir', 'car', 'pathfinding', 'physics', 'wander', 'pathfollow'];

/** Vehicle-local offset (x forward, y up, z right) -> world position, using the vehicle's heading. */
export function vehiclePoint(w: World, v: RInstance, lx: number, ly: number, lz: number): [number, number, number] {
  const [px, py, pz] = w.worldPos(v);
  const a = (w.angle(v) * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  if (w.plane === 'xz') return [px + lx * c + lz * s, py + ly, pz - lx * s + lz * c];
  return [px + lx * c - ly * s, py + lx * s + ly * c, pz];
}

function camerasFollowing(w: World, who: RInstance): RInstance[] {
  return w.instances.filter((c) => !c.destroyed && c.behaviors.some((b) => b.type === 'follow' && (String(b.props.target).toLowerCase() === who.type.toLowerCase() || String(b.props.target).toLowerCase() === who.name.toLowerCase())));
}
/** Smoothly move the camera from where it is now to its new framing (see the Follow behavior's blend). */
function blendCamera(cam: RInstance, seconds: number) {
  if (seconds <= 0) return;
  (cam.state.follow ??= {}).blend = { from: [cam.x, cam.y, cam.z], t: 0, dur: seconds };
}
/** The key, or any binding of an action bound to it (E → also gamepad X through the Interact action). */
const pressed = (host: BehaviorHost, key: string) => !!key.trim() && (host.keyBindings ? host.keyBindings(key).some((b) => host.input.binding(b, 'pressed')) : host.input.anyPressed([key.trim()]));

/**
 * The prompt for the device in use: {Action} placeholders filled, and the key written in it ("Press E") shown as the
 * button that does it on a gamepad or touch screen ("Press X", "Press Square").
 */
function promptText(host: BehaviorHost, text: string, key: string): string {
  let t = host.fillPrompts ? host.fillPrompts(text) : text;
  const k = key.trim(), dev = host.input.device;
  if (k && host.keyBindings && dev !== 'keyboard' && dev !== 'mouse') {
    const label = buttonPrompt(host.keyBindings(k), dev, padStyle(host.input.padIds[host.input.lastPad]));
    t = t.replace(new RegExp(`(^|\\s)${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=\\s|$|[.,!?])`), `$1${label}`);
  }
  return t;
}

export function enterVehicle(host: BehaviorHost, v: RInstance, d: RInstance, p: Record<string, any>) {
  const w = host.world, st = (v.state.vehicle ??= { driver: 0, cooldown: 0, saved: null });
  st.driver = d.uid; st.cooldown = 0.3;
  st.saved = {
    behaviors: d.behaviors.filter((b) => MOVERS.includes(b.type)).map((b) => ({ type: b.type, enabled: b.props.enabled !== false })),
    visible: d.visible, nonBlocking: !!d.collider.nonBlocking, cams: [] as { uid: number; props: Record<string, any> }[],
  };
  for (const b of d.behaviors) if (MOVERS.includes(b.type)) b.props.enabled = false;
  d.vx = d.vy = d.vz = 0;
  d.visible = !p.hideDriver;
  d.collider = { ...d.collider, nonBlocking: true };
  d.state.inVehicle = v.uid;
  if (p.seatedAnim) d.animation = String(p.seatedAnim);
  swingDoor(host, v, p);
  // Camera: first person from the seat, or a chase view behind the vehicle.
  for (const cam of camerasFollowing(w, d)) {
    const f = cam.behaviors.find((b) => b.type === 'follow')!;
    st.saved.cams.push({ uid: cam.uid, props: { ...f.props } });
    if (p.camera === 'first person') {
      Object.assign(f.props, { target: d.name || d.type, firstPerson: true, lookAt: false }, Number(p.seatEye) > 0 ? { eyeHeight: Number(p.seatEye), eyeForward: Number(p.seatEyeForward) || 0 } : {});
      const fs = (cam.state.follow ??= {}); fs.fpYaw = (w.angle(v) * Math.PI) / 180; fs.fpPitch = -0.08;
    } else if (p.camera === 'third person') {
      Object.assign(f.props, { target: v.name || v.type, firstPerson: false, orbitWithMouse: false, rotateWithTarget: true, offsetX: -Number(p.thirdDistance), offsetY: Number(p.thirdHeight), offsetZ: 0, lookAt: true, smoothing: 0.85, avoidWalls: true });
      if (cam.state.follow) cam.state.follow.snapped = false;
    }
    if (p.camera !== 'unchanged') blendCamera(cam, Number(p.transition));
  }
  host.queueTrigger('vehicle.on_enter', { [v.type]: [v], [d.type]: [d] });
}

/** Getting in or out: the vehicle's door part swings open, and shuts again a moment later (tick). */
function swingDoor(host: BehaviorHost, v: RInstance, p: Record<string, any>) {
  const part = String(p.doorPart ?? '').trim(); if (!part) return;
  const parts = (v.state.parts ??= {}) as Record<string, PartSwing>;
  const prev = parts[part];
  parts[part] = { hinge: String(p.doorHinge), from: prev ? partAngle(prev, host.time) : 0, to: Number(p.doorAngle), t0: host.time, dur: 0.35 };
  v.state.vehicle.doorShut = host.time + 1.1;
}

export function exitVehicle(host: BehaviorHost, v: RInstance, p: Record<string, any>) {
  const w = host.world, st = v.state.vehicle;
  const d = w.byUid.get(st.driver);
  st.driver = 0; st.cooldown = 0.3;
  if (v.state.sim) v.state.sim.clear();
  if (!d || d.destroyed) return;
  // Parked nearly straight: line it up (keeps a walk-in vehicle's box walls snug).
  const snap = Number(p.parkSnap) || 0;
  if (snap > 0) {
    const a = w.angle(v), t = Math.round(a / snap) * snap;
    if (Math.abs(a - t) <= Math.min(25, snap / 2)) w.setAngle(v, t);
  }
  swingDoor(host, v, p);
  // Out of the door (or the other side, or on top when both are blocked).
  const ex = Number(p.exitX), ey = Number(p.exitY), ez = Number(p.exitZ);
  const spots = [vehiclePoint(w, v, ex, ey, ez), vehiclePoint(w, v, ex, ey, -ez), vehiclePoint(w, v, 0, Math.max(ey, 0) + 2, 0)];
  const blockers = w.blockersFor(d).filter((b) => b !== v);
  for (const [x, y, z] of spots) {
    d.x = x; d.y = y; d.z = z;
    const box = w.aabb(d);
    if (!blockers.some((b) => w.aabbs(b).some((bb) => box[0] < bb[3] && box[3] > bb[0] && box[1] < bb[4] && box[4] > bb[1] && box[2] < bb[5] && box[5] > bb[2]))) break;
  }
  w.setAngle(d, w.angle(v));
  const saved = st.saved ?? { behaviors: [], visible: true, nonBlocking: false, cams: [] };
  for (const s of saved.behaviors) { const b = d.behaviors.find((x) => x.type === s.type); if (b) b.props.enabled = s.enabled; }
  d.visible = saved.visible;
  d.collider = { ...d.collider, nonBlocking: saved.nonBlocking };
  d.vx = d.vy = d.vz = 0;
  d.state.inVehicle = 0;
  if (d.animation === String(p.seatedAnim)) d.animation = 'idle';
  for (const c of saved.cams) {
    const cam = w.byUid.get(c.uid); const f = cam?.behaviors.find((b) => b.type === 'follow');
    if (!cam || !f) continue;
    Object.assign(f.props, c.props);
    if (c.props.firstPerson) { const fs = (cam.state.follow ??= {}); fs.fpYaw = (w.angle(d) * Math.PI) / 180; fs.fpPitch = 0; }
    else if (cam.state.follow) cam.state.follow.snapped = false;
    blendCamera(cam, Number(p.transition));
  }
  st.saved = null;
  host.queueTrigger('vehicle.on_exit', { [v.type]: [v], [d.type]: [d] });
}

export const VEHICLE: BehaviorDef = {
  id: 'vehicle', name: 'Vehicle (enter / exit)', icon: '⛟',
  doc: 'Makes a Car drivable by a character: walk up and press the key to get in, drive, press it again to get out at the door. The driver\'s own movement is paused while seated; the camera switches to first person (from the seat) or a third-person chase view with a smooth move. Seat and door are offsets from the vehicle (X forward, Y up, Z right). Needs the Car behavior for driving.',
  props: [
    { key: 'driver', label: 'Driver object', type: 'objectType', default: 'Player' },
    { key: 'enterKey', label: 'Enter / exit key', type: 'string', default: 'E' },
    { key: 'enterDistance', label: 'Get in within (m)', type: 'number', default: 3, min: 0.5, step: 0.25, doc: 'From the vehicle or its door.' },
    { key: 'camera', label: 'Camera while driving', type: 'choice', default: 'third person', options: ['first person', 'third person', 'unchanged'] },
    { key: 'thirdDistance', label: 'Chase distance (m)', type: 'number', default: 8, min: 1, step: 0.5 },
    { key: 'thirdHeight', label: 'Chase height (m)', type: 'number', default: 3.2, min: 0, step: 0.25 },
    { key: 'transition', label: 'Camera blend (s)', type: 'number', default: 0.6, min: 0, step: 0.1 },
    { key: 'seatX', label: 'Seat X (forward)', type: 'number', default: 0.3, step: 0.05, doc: 'Where the driver sits (their feet), from the vehicle origin.' },
    { key: 'seatY', label: 'Seat Y (up)', type: 'number', default: 0.5, step: 0.05 },
    { key: 'seatZ', label: 'Seat Z (right)', type: 'number', default: -0.45, step: 0.05 },
    { key: 'exitX', label: 'Door X (forward)', type: 'number', default: 0.3, step: 0.05, doc: 'Where the driver steps out.' },
    { key: 'exitY', label: 'Door Y (up)', type: 'number', default: 0, step: 0.05 },
    { key: 'exitZ', label: 'Door Z (right)', type: 'number', default: -2.4, step: 0.05 },
    { key: 'seatEye', label: 'Seated eye height (m)', type: 'number', default: 0, min: 0, step: 0.05, advanced: true, doc: 'First person: the eyes above the seat point while driving. 0 = the camera\'s own eye height.' },
    { key: 'seatEyeForward', label: 'Seated eyes forward (m)', type: 'number', default: 0, step: 0.05, advanced: true, doc: 'With a seated eye height: eyes ahead of (negative: behind) the seat point, to sit in the seated head.' },
    { key: 'hideDriver', label: 'Hide the driver', type: 'boolean', default: true, doc: 'Off: the driver stays visible in the seat (plays the seated animation).' },
    { key: 'seatedAnim', label: 'Driver seated animation', type: 'string', default: 'sit', advanced: true },
    { key: 'driveAnim', label: 'Vehicle driving animation', type: 'string', default: '', advanced: true, doc: 'Played on the vehicle while it moves (e.g. wheels). Empty = none.' },
    { key: 'doorPart', label: 'Door part', type: 'string', default: '', advanced: true, doc: 'Name of the model part that swings open while getting in or out (e.g. Door1). Empty = none.' },
    { key: 'doorHinge', label: 'Door hinge', type: 'choice', default: 'front edge', options: ['front edge', 'back edge', 'left edge', 'right edge', 'top edge', 'bottom edge'], advanced: true },
    { key: 'doorAngle', label: 'Door opens to (°)', type: 'number', default: 70, step: 5, advanced: true },
    { key: 'parkSnap', label: 'Park straight to (°)', type: 'number', default: 0, min: 0, step: 15, advanced: true, doc: 'Getting out while the vehicle is within 25° of a multiple of this lines it up. 0 = off.' },
    { key: 'maxExitSpeed', label: 'Can get out below (m/s)', type: 'number', default: 3, min: 0, step: 0.5 },
    { key: 'keyForward', label: 'Accelerate key', type: 'string', default: '', doc: 'Empty = the Car behavior\'s keys (W / ↑).', advanced: true },
    { key: 'keyBack', label: 'Brake / reverse key', type: 'string', default: '', advanced: true },
    { key: 'keyLeft', label: 'Steer left key', type: 'string', default: '', advanced: true },
    { key: 'keyRight', label: 'Steer right key', type: 'string', default: '', advanced: true },
    { key: 'enabled', label: 'Enabled', type: 'boolean', default: true },
  ],
  expressions: {
    IsOccupied: (i) => (i.state.vehicle?.driver ? 1 : 0),
    Driver: (i) => i.state.vehicle?.driver ?? 0,
  },
  tick(v, p, host, dt) {
    const w = host.world;
    const st = (v.state.vehicle ??= { driver: 0, cooldown: 0, saved: null });
    st.cooldown = Math.max(0, st.cooldown - dt);
    if (st.doorShut && host.time >= st.doorShut) {
      st.doorShut = 0;
      const part = String(p.doorPart ?? '').trim(), parts = v.state.parts as Record<string, PartSwing> | undefined;
      if (part && parts?.[part]) parts[part] = { ...parts[part], from: partAngle(parts[part], host.time), to: 0, t0: host.time, dur: 0.35 };
    }
    const car = v.behaviors.find((b) => b.type === 'car');
    const custom = ['keyForward', 'keyBack', 'keyLeft', 'keyRight'].some((k) => String(p[k] ?? '').trim());
    if (!st.driver) {
      if (car) car.props.defaultControls = false; // nobody at the wheel
      if (st.cooldown > 0 || !pressed(host, String(p.enterKey))) return;
      const door = vehiclePoint(w, v, Number(p.exitX), Number(p.exitY), Number(p.exitZ));
      let best: RInstance | null = null, bd = Number(p.enterDistance);
      for (const d of w.of(String(p.driver))) {
        if (d.state.inVehicle) continue;
        const dist = Math.min(w.planarDistance(v, d), Math.hypot(d.x - door[0], w.plane === 'xz' ? d.z - door[2] : d.y - door[1]));
        if (dist <= bd) { bd = dist; best = d; }
      }
      if (best) enterVehicle(host, v, best, p);
      return;
    }
    const d = w.byUid.get(st.driver);
    if (!d || d.destroyed) { st.driver = 0; return; }
    // Drive: the Car behavior's own keys, or the custom ones fed as simulated controls.
    if (car) car.props.defaultControls = !custom;
    if (custom) {
      const sim: Set<string> = (v.state.sim ??= new Set());
      const map: [string, string][] = [['keyForward', 'up'], ['keyBack', 'down'], ['keyLeft', 'left'], ['keyRight', 'right']];
      for (const [k, c] of map) { const key = String(p[k] ?? '').trim(); if (key && host.input.anyDown([key])) sim.add(c); }
    }
    // The driver rides in the seat.
    const [sx, sy, sz] = vehiclePoint(w, v, Number(p.seatX), Number(p.seatY), Number(p.seatZ));
    d.x = sx; d.y = sy; d.z = sz;
    w.setAngle(d, w.angle(v)); // seated facing forward as the vehicle turns
    if (p.driveAnim) v.animation = Math.abs(v.state.car?.speed ?? 0) > 0.3 ? String(p.driveAnim) : 'idle';
    // Get out.
    if (st.cooldown <= 0 && pressed(host, String(p.enterKey))) {
      if (Math.abs(v.state.car?.speed ?? Math.hypot(v.vx, v.vz)) <= Number(p.maxExitSpeed)) exitVehicle(host, v, p);
    }
  },
};

export const INTERACTABLE: BehaviorDef = {
  id: 'interactable', name: 'Interaction point', icon: '⌁',
  doc: 'Something to use: doors to knock on, parcels to pick up, levers, signs. When the player is close a prompt shows above it ("Press E to knock"); pressing the key fires Interaction › On interacted (with this object and the player picked).',
  props: [
    { key: 'who', label: 'Player object', type: 'objectType', default: 'Player' },
    { key: 'key', label: 'Key', type: 'string', default: 'E' },
    { key: 'distance', label: 'Within (m)', type: 'number', default: 2, min: 0.2, step: 0.25 },
    { key: 'prompt', label: 'Prompt', type: 'string', default: 'Press E', doc: 'Shown above the object while the player is close. Empty = no prompt. The key in it follows the device in use ("Press E" reads "Press X" on a gamepad when the Interact action has pad:X); {Action} names are filled the same way.' },
    { key: 'once', label: 'Only once', type: 'boolean', default: false },
    { key: 'cooldown', label: 'Wait between uses (s)', type: 'number', default: 0.5, min: 0, step: 0.1 },
    { key: 'enabled', label: 'Enabled', type: 'boolean', default: true },
  ],
  expressions: { IsNear: (i) => (i.state.interact?.near ? 1 : 0), Uses: (i) => i.state.interact?.uses ?? 0 },
  tick(inst, p, host, dt) {
    const w = host.world;
    const st = (inst.state.interact ??= { near: false, uses: 0, wait: 0 });
    st.wait = Math.max(0, st.wait - dt);
    let who: RInstance | null = null;
    const iy = inst.parent != null ? w.worldPos(inst)[1] : inst.y;
    for (const o of w.of(String(p.who))) if (!o.state.inVehicle && w.planarDistance(inst, o) <= Number(p.distance) && Math.abs(o.y - iy) < Math.max(2, Number(p.distance))) { who = o; break; }
    st.near = !!who;
    if (!who || (p.once && st.uses > 0)) return;
    if (String(p.prompt ?? '').trim()) inst.state.bubble = { kind: 'say', text: promptText(host, String(p.prompt), String(p.key)), until: host.time + 0.15 };
    if (st.wait <= 0 && pressed(host, String(p.key))) {
      st.uses++; st.wait = Number(p.cooldown);
      inst.state.bubble = undefined;
      host.queueTrigger('interact.on_interact', { [inst.type]: [inst], [who.type]: [who] });
    }
  },
};
