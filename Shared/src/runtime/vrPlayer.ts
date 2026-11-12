// VR Player behavior: the player's rig in VR (and in the desktop VR preview). Smooth movement relative to where you
// look, snap or smooth turning, teleport along an arc from the right hand to walkable ground, and grabbing Physics
// objects with either hand (held in the hand, thrown with the hand's motion). Reads the VR actions from input.ts.
import type { BehaviorDef, BehaviorHost } from './behaviors';
import type { RInstance } from './world';
import { moveAndCollide, raycast } from './physics';

type V3 = [number, number, number];
const pressed = (host: BehaviorHost, b: string[]) => b.some((x) => host.input.binding(x, 'pressed'));
const released = (host: BehaviorHost, b: string[]) => b.some((x) => host.input.binding(x, 'released'));
const held = (host: BehaviorHost, b: string[]) => b.some((x) => host.input.binding(x, 'held'));

/** Where a teleport arc from `from` along `dir` lands on Solid ground (null = nowhere valid within range). */
export function teleportTarget(host: BehaviorHost, me: RInstance, from: V3, dir: V3, range: number): V3 | null {
  const w = host.world, solids = w.blockersFor(me);
  const speed = Math.max(4, range * 0.9), g = 9.8;
  const l = Math.hypot(...dir) || 1;
  const v: V3 = [(dir[0] / l) * speed, (dir[1] / l) * speed, (dir[2] / l) * speed];
  let p: V3 = [...from];
  for (let t = 0; t < 3; t += 0.04) {
    const q: V3 = [from[0] + v[0] * t, from[1] + v[1] * t - 0.5 * g * t * t, from[2] + v[2] * t];
    const seg: V3 = [q[0] - p[0], q[1] - p[1], q[2] - p[2]], sl = Math.hypot(...seg);
    if (sl > 1e-6) {
      const hit = raycast(w, p, seg, sl, solids, me);
      if (hit) {
        // Only floors (facing up) within range count.
        if (hit.normal[1] < 0.7) return null;
        if (Math.hypot(hit.point[0] - me.x, hit.point[2] - me.z) > range) return null;
        return hit.point;
      }
    }
    p = q;
    if (p[1] < me.y - 50) return null;
  }
  return null;
}

export const VR_PLAYER: BehaviorDef = {
  id: 'vrplayer', name: 'VR Player', icon: '◎', gamecraftOnly: true,
  doc: 'The player in VR (Quest / SteamVR through WebXR, or the desktop VR preview). Left stick moves where you look, right stick turns (snap or smooth) and, pushed forward, aims a teleport; grip grabs Physics objects, which you can throw. Uses the VR actions (Grab, Teleport, Move, Turn…), so you can also use them in blocks.',
  props: [
    { key: 'locomotion', label: 'Locomotion', type: 'choice', default: 'both', options: ['teleport', 'smooth', 'both'], doc: 'Teleport is the most comfortable; smooth walks with the stick.' },
    { key: 'moveSpeed', label: 'Move speed (m/s)', type: 'number', default: 2.5, min: 0.5, max: 8, step: 0.1 },
    { key: 'turn', label: 'Turning', type: 'choice', default: 'snap', options: ['snap', 'smooth'] },
    { key: 'snapAngle', label: 'Snap angle (°)', type: 'number', default: 30, min: 10, max: 90, step: 5 },
    { key: 'turnSpeed', label: 'Smooth turn (°/s)', type: 'number', default: 120, min: 30, max: 360, step: 10 },
    { key: 'teleportRange', label: 'Teleport range (m)', type: 'number', default: 8, min: 1, max: 30, step: 0.5 },
    { key: 'grabRange', label: 'Grab reach (m)', type: 'number', default: 0.35, min: 0.1, max: 2, step: 0.05, doc: 'Interaction distance: how far from the hand things can be grabbed.' },
    { key: 'haptics', label: 'Haptics', type: 'boolean', default: true, doc: 'A short buzz in the controller when you grab, let go or teleport.' },
    { key: 'gravity', label: 'Gravity', type: 'number', default: 20, min: 0, step: 1 },
    { key: 'enabled', label: 'Enabled', type: 'boolean', default: true },
  ],
  expressions: {
    IsTeleporting: (i) => (i.state.vr?.teleport ? 1 : 0),
    HeldLeft: (i) => i.state.vr?.held?.left ?? 0,
    HeldRight: (i) => i.state.vr?.held?.right ?? 0,
  },
  tick(inst, p, host, dt) {
    const w = host.world, inp = host.input;
    const st = (inst.state.vr ??= { teleport: null as V3 | null, held: { left: 0, right: 0 } as Record<'left' | 'right', number>, last: { left: [0, 0, 0], right: [0, 0, 0] } as Record<'left' | 'right', V3>, vy: 0, turnArmed: true });
    const yawDeg = inp.xr.head.yaw; // where the player looks (degrees, 0 = −Z)
    // ---- Turning: right stick X (snap fires once per push past the middle; ← / → in the preview).
    const rx = inp.xr.right.stick[0] + (inp.xr.active ? 0 : (inp.isDown('ArrowRight') ? 1 : 0) - (inp.isDown('ArrowLeft') ? 1 : 0));
    if (p.turn === 'smooth') w.setAngle(inst, w.angle(inst) - rx * Number(p.turnSpeed) * dt);
    else if (Math.abs(rx) > 0.6) { if (st.turnArmed) { w.setAngle(inst, w.angle(inst) - Math.sign(rx) * Number(p.snapAngle)); st.turnArmed = false; } }
    else if (Math.abs(rx) < 0.3) st.turnArmed = true;
    // ---- Smooth movement: left stick (WASD in the preview), relative to the view direction.
    let mx = inp.xr.left.stick[0], mz = inp.xr.left.stick[1];
    if (!inp.xr.active) { mx += (inp.isDown('D') ? 1 : 0) - (inp.isDown('A') ? 1 : 0); mz += (inp.isDown('W') ? 1 : 0) - (inp.isDown('S') ? 1 : 0); }
    const ml = Math.hypot(mx, mz);
    let vx = 0, vz = 0;
    if (p.locomotion !== 'teleport' && ml > 0.01) {
      const k = Math.min(1, ml) / ml * Number(p.moveSpeed), a = (yawDeg * Math.PI) / 180;
      // forward = (−sin a, −cos a) on the ground for yaw a (0 = −Z), right = (cos a, −sin a)
      vx = (-Math.sin(a) * mz + Math.cos(a) * mx) * k; vz = (-Math.cos(a) * mz - Math.sin(a) * mx) * k;
    }
    st.vy = Math.max(-40, st.vy - Number(p.gravity) * dt);
    const hits = moveAndCollide(w, inst, vx * dt, st.vy * dt, vz * dt, w.blockersFor(inst), 0.3);
    if (hits.some((h) => h.axis === 1)) st.vy = 0;
    inst.vx = vx; inst.vz = vz;
    // ---- Teleport: right stick forward (T in the preview) aims from the right hand; letting go jumps there.
    const aim = ['xrstick:right:Y+', 'T'];
    if (p.locomotion !== 'smooth' && held(host, aim)) st.teleport = teleportTarget(host, inst, inp.xr.right.pos, inp.xr.right.dir, Number(p.teleportRange));
    else if (st.teleport && released(host, aim)) {
      inst.x = st.teleport[0]; inst.z = st.teleport[2]; inst.y = st.teleport[1] - (w.aabb(inst)[1] - inst.y) + 0.01; st.vy = 0;
      host.queueTrigger('vr.on_teleported', { [inst.type]: [inst] });
      if (p.haptics !== false) inp.vibrate('right', 0.3, 40);
      st.teleport = null;
    } else if (!held(host, aim)) st.teleport = null;
    // ---- Grab / release / throw with either hand.
    for (const hand of ['left', 'right'] as const) {
      const h = inp.xr[hand], grip = [`xr:${hand}:grip`, ...(hand === 'right' && !inp.xr.active ? ['E'] : [])];
      const vel: V3 = [(h.pos[0] - st.last[hand][0]) / Math.max(dt, 1e-3), (h.pos[1] - st.last[hand][1]) / Math.max(dt, 1e-3), (h.pos[2] - st.last[hand][2]) / Math.max(dt, 1e-3)];
      st.last[hand] = [...h.pos];
      const cur = st.held[hand] ? w.byUid.get(st.held[hand]) : undefined;
      if (cur && !cur.destroyed) {
        // Held: follows the hand (the Physics behavior reads the hold point).
        cur.state.physics = { ...(cur.state.physics ?? {}), heldBy: inst.uid };
        (inst.state.vr.holdPoints ??= {})[cur.uid] = h.pos;
        if (released(host, grip)) {
          cur.state.physics.heldBy = 0; delete inst.state.vr.holdPoints[cur.uid];
          cur.vx = vel[0]; cur.vy = vel[1]; cur.vz = vel[2]; // thrown with the hand's motion
          st.held[hand] = 0;
          host.queueTrigger('vr.on_released', { [inst.type]: [inst], [cur.type]: [cur] });
          if (p.haptics !== false) inp.vibrate(hand, 0.2, 25);
        }
        continue;
      }
      st.held[hand] = 0;
      if (pressed(host, grip)) {
        let best: RInstance | null = null, bd = Number(p.grabRange);
        for (const o of w.instances) {
          if (o.destroyed || o === inst || !w.hasBehavior(o, 'physics') || o.state.physics?.heldBy) continue;
          const b = w.aabb(o);
          // Distance from the hand to the object's box (0 inside).
          const dx = Math.max(b[0] - h.pos[0], 0, h.pos[0] - b[3]), dy = Math.max(b[1] - h.pos[1], 0, h.pos[1] - b[4]), dz = Math.max(b[2] - h.pos[2], 0, h.pos[2] - b[5]);
          const d = Math.hypot(dx, dy, dz);
          if (d <= bd) { bd = d; best = o; }
        }
        if (best) {
          st.held[hand] = best.uid; best.state.physics = { ...(best.state.physics ?? {}), heldBy: inst.uid };
          (inst.state.vr.holdPoints ??= {})[best.uid] = h.pos;
          host.queueTrigger('vr.on_grabbed', { [inst.type]: [inst], [best.type]: [best] });
          if (p.haptics !== false) inp.vibrate(hand, 0.5, 35);
        }
      }
    }
  },
};
