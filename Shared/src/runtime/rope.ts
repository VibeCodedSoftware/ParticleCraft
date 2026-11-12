// Rope / zipline: a rope from its object to a second point, or hanging from it. A player can climb it or zip along it,
// it can reach the ground or stop in the air, it sways, and any object can hang from its end (a hanging lantern).
// Works the same in 2D and 3D. This module must not import behaviors.ts. The curve goes to the renderer as
// inst.state.rope.pts (GameCraft: engine/ropeView.ts); the editor draws it with ropeCurve too.
import type { RInstance, World } from './world';
import type { BehaviorDef, BehaviorHost } from './behaviors';

export type V3 = [number, number, number];
const SEGMENTS = 20;
const MOVERS = ['platform', 'eightdir', 'car', 'pathfinding', 'physics', 'wander', 'pathfollow', 'surfacewalker'];

/** The rope's points from its object outward. `ground` is the height of what's under a point, or null for nothing. */
export function ropeCurve(a: V3, p: Record<string, any>, plane: 'xz' | 'xy', ground: (x: number, y: number, z: number) => number | null, sway: [number, number] = [0, 0]): V3[] {
  const pts: V3[] = [];
  const flat = plane !== 'xz';
  if (p.style === 'hanging') {
    let len = Math.max(0.05, Number(p.length) || 0);
    if (p.touchGround) { const g = ground(a[0], a[1], a[2]); if (g != null && g < a[1]) len = a[1] - g; }
    for (let i = 0; i <= SEGMENTS; i++) {
      const t = i / SEGMENTS, bend = t * t; // bends more toward the free end
      pts.push([a[0] + sway[0] * len * bend, a[1] - len * t, flat ? a[2] : a[2] + sway[1] * len * bend]);
    }
    return pts;
  }
  const b: V3 = [a[0] + Number(p.endX || 0), a[1] + Number(p.endY || 0), flat ? a[2] : a[2] + Number(p.endZ || 0)];
  if (p.touchGround) { const g = ground(b[0], b[1], b[2]); if (g != null) b[1] = g; }
  const sag = Math.max(0, Number(p.slack) || 0);
  for (let i = 0; i <= SEGMENTS; i++) {
    const t = i / SEGMENTS;
    pts.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - sag * 4 * t * (1 - t), a[2] + (b[2] - a[2]) * t]);
  }
  return pts;
}
export const ropeLength = (pts: V3[]) => { let d = 0; for (let i = 1; i < pts.length; i++) d += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2]); return d; };
/** The point at t (0 = its object, 1 = the far end). */
export function ropeAt(pts: V3[], t: number): V3 {
  const f = Math.max(0, Math.min(1, t)) * (pts.length - 1), i = Math.min(pts.length - 2, Math.floor(f)), k = f - i;
  return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * k, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * k, pts[i][2] + (pts[i + 1][2] - pts[i][2]) * k];
}
/** The closest place on the rope to a point: its t and how far away. */
export function ropeNearest(pts: V3[], x: number, y: number, z: number, flat: boolean): { t: number; d: number } {
  let best = { t: 0, d: Infinity };
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay, az] = pts[i], ex = pts[i + 1][0] - ax, ey = pts[i + 1][1] - ay, ez = flat ? 0 : pts[i + 1][2] - az;
    const q = ex * ex + ey * ey + ez * ez;
    const s = q > 1e-9 ? Math.max(0, Math.min(1, ((x - ax) * ex + (y - ay) * ey + (flat ? 0 : (z - az) * ez)) / q)) : 0;
    const d = Math.hypot(x - ax - ex * s, y - ay - ey * s, flat ? 0 : z - az - ez * s);
    if (d < best.d) best = { t: (i + s) / (pts.length - 1), d };
  }
  return best;
}

function groundOf(w: World, self: RInstance, skip?: RInstance) {
  return (x: number, y: number, z: number): number | null => {
    let top: number | null = null;
    for (const s of w.solids()) {
      if (s === self || s === skip) continue;
      for (const b of w.aabbs(s)) {
        if (x < b[0] || x > b[3] || (w.plane === 'xz' && (z < b[2] || z > b[5]))) continue;
        if (b[4] <= y + 1e-3 && (top == null || b[4] > top)) top = b[4];
      }
    }
    return top;
  };
}
const pressedKey = (host: BehaviorHost, key: string) => !!key.trim() && (host.keyBindings ? host.keyBindings(key).some((b) => host.input.binding(b, 'pressed')) : host.input.anyPressed([key.trim()]));

function grab(host: BehaviorHost, rope: RInstance, who: RInstance, p: Record<string, any>, t: number) {
  const st = rope.state.rope, pts: V3[] = st.pts;
  st.holder = who.uid; st.t = t; st.cool = 0.25; st.v = 0;
  st.saved = { behaviors: who.behaviors.filter((b) => MOVERS.includes(b.type)).map((b) => ({ type: b.type, enabled: b.props.enabled !== false })), nonBlocking: !!who.collider.nonBlocking };
  for (const b of who.behaviors) if (MOVERS.includes(b.type)) b.props.enabled = false;
  who.collider = { ...who.collider, nonBlocking: true };
  who.state.onRope = rope.uid;
  // A zipline runs to the lower end, or on a level one to whichever end is further.
  const lower = pts[0][1] - pts[pts.length - 1][1];
  st.dir = Math.abs(lower) > 0.2 ? (lower > 0 ? 1 : -1) : t < 0.5 ? 1 : -1;
  if (p.holdAnim) who.animation = String(p.holdAnim);
  host.queueTrigger('rope.on_grab', { [rope.type]: [rope], [who.type]: [who] });
}
/** Let go. `jump`: push off upward; otherwise carry on with the speed it had. */
export function releaseRope(host: BehaviorHost, rope: RInstance, jump = 0) {
  const st = rope.state.rope; if (!st?.holder) return;
  const who = host.world.byUid.get(st.holder);
  st.holder = 0; st.cool = 0.35;
  if (!who || who.destroyed) { st.saved = null; return; }
  for (const s of st.saved?.behaviors ?? []) { const b = who.behaviors.find((x) => x.type === s.type); if (b) b.props.enabled = s.enabled; }
  who.collider = { ...who.collider, nonBlocking: !!st.saved?.nonBlocking };
  who.state.onRope = 0;
  if (jump) who.vy = Math.max(who.vy, jump);
  const p = host.world.behavior(rope, 'rope')?.props;
  if (p?.holdAnim && who.animation === String(p.holdAnim)) who.animation = 'idle';
  st.saved = null;
  host.queueTrigger('rope.on_release', { [rope.type]: [rope], [who.type]: [who] });
}

export const ROPE: BehaviorDef = {
  id: 'rope', name: 'Rope / zipline', icon: '⌇', gamecraftOnly: true,
  doc: 'A rope that starts at this object: stretched to a second point or hanging down, in 2D or 3D. Climb it (W / S, Up / Down) or zip along it to its lower end. Press the key to grab, the key again or Space to let go. It can reach the ground or stop in the air, take a colour or an image, sway, and hold an object at its end, such as a hanging lantern. Triggers: Movement › On rope grabbed / let go / end reached.',
  props: [
    { key: 'style', label: 'Shape', type: 'choice', options: ['between two points', 'hanging'], default: 'hanging', doc: 'Between two points: from this object to the End position (set it to the other surface). Hanging: straight down from this object.' },
    { key: 'use', label: 'Use', type: 'choice', options: ['climb', 'zipline', 'decoration'], default: 'climb', doc: 'What a player does with it. Decoration: just a rope, no grabbing.' },
    { key: 'length', label: 'Length, hanging (m)', type: 'number', default: 4, min: 0.05, step: 0.25, doc: 'How far it hangs. Ignored when it reaches the ground.' },
    { key: 'touchGround', label: 'Reach the ground', type: 'boolean', default: false, doc: 'On: hanging, it goes all the way down to whatever is below; between two points, its end comes down to the ground under the End position. Off: it stops where you set it, in the air if that is where it is.' },
    { key: 'endX', label: 'End X (from the object)', type: 'number', default: 8, step: 0.25, doc: 'Between two points: where the far end is, relative to this object.' },
    { key: 'endY', label: 'End Y', type: 'number', default: -2, step: 0.25 },
    { key: 'endZ', label: 'End Z (3D)', type: 'number', default: 0, step: 0.25 },
    { key: 'slack', label: 'Slack (m)', type: 'number', default: 0.2, min: 0, step: 0.05, doc: 'How far its middle sags between two points.' },
    { key: 'thickness', label: 'Thickness (m)', type: 'number', default: 0.05, min: 0.005, step: 0.01 },
    { key: 'color', label: 'Colour', type: 'color', default: '#8a6a45' },
    { key: 'texture', label: 'Image', type: 'image', default: '', doc: 'A picture wrapped round the rope, tinted by Colour (set Colour to white for its own colours).' },
    { key: 'textureRepeat', label: 'Image repeats per metre', type: 'number', default: 2, min: 0.01, step: 0.25 },
    { key: 'sway', label: 'Sway', type: 'number', default: 0.04, min: 0, max: 0.5, step: 0.01, doc: 'A hanging rope swings gently. 0 = hangs still.' },
    { key: 'swaySpeed', label: 'Sway speed', type: 'number', default: 1, min: 0, step: 0.1, advanced: true },
    { key: 'hangObject', label: 'Hang at the end', type: 'objectType', default: '', doc: 'An object held at the end of the rope: a lantern, a sign, a weight. One you placed that nothing else holds is used; if there is none, one is made. It swings with the rope.' },
    { key: 'hangGap', label: 'Gap above the object (m)', type: 'number', default: 0, step: 0.05, advanced: true },
    { key: 'player', label: 'Who can grab', type: 'objectType', default: 'Player' },
    { key: 'key', label: 'Grab / let go key', type: 'string', default: 'E' },
    { key: 'prompt', label: 'Prompt', type: 'string', default: 'Press E', doc: 'Shown above the player when in reach. Empty = none.' },
    { key: 'reach', label: 'Reach (m)', type: 'number', default: 1.5, min: 0.1, step: 0.1 },
    { key: 'climbSpeed', label: 'Climb speed (m/s)', type: 'number', default: 2.5, min: 0, step: 0.25 },
    { key: 'zipSpeed', label: 'Zip speed (m/s)', type: 'number', default: 9, min: 0, step: 0.5, doc: 'Top speed along a zipline. It gets there faster down a steep one.' },
    { key: 'letGoJump', label: 'Jump when letting go (m/s)', type: 'number', default: 6, min: 0, step: 0.5, doc: 'Space on the rope pushes off upward at this speed.' },
    { key: 'holdAnim', label: 'Animation while holding', type: 'string', default: '', advanced: true, doc: 'Clip played on the player while on the rope. Empty = no change.' },
    { key: 'enabled', label: 'Enabled', type: 'boolean', default: true },
  ],
  expressions: {
    Length: (i) => ropeLength(i.state.rope?.pts ?? []),
    IsHeld: (i) => (i.state.rope?.holder ? 1 : 0),
    Position: (i) => i.state.rope?.t ?? 0,
  },
  tick(inst, p, host, dt) {
    const w = host.world, flat = w.plane !== 'xz';
    const st = (inst.state.rope ??= { pts: [] as V3[], holder: 0, t: 0, dir: 1, v: 0, cool: 0, saved: null, hung: 0, ver: 0, sig: '' });
    st.cool = Math.max(0, st.cool - dt);
    const a = w.worldPos(inst);
    // The curve: swaying ropes every tick, still ones when something about them changes.
    const swinging = p.style === 'hanging' && Number(p.sway) > 0;
    const sig = `${a[0]},${a[1]},${a[2]},${p.style},${p.length},${p.endX},${p.endY},${p.endZ},${p.slack},${p.touchGround}`;
    if (swinging || sig !== st.sig || !st.pts.length) {
      const ph = inst.uid * 1.7, sp = Number(p.swaySpeed ?? 1), s = Number(p.sway) || 0;
      const hold = st.holder ? 0.4 : 1;
      const sway: [number, number] = swinging ? [Math.sin(host.time * 1.3 * sp + ph) * s * hold, Math.sin(host.time * 0.9 * sp + ph * 2.1) * s * 0.7 * hold] : [0, 0];
      st.pts = ropeCurve(a, p, flat ? 'xy' : 'xz', groundOf(w, inst), sway);
      st.sig = sig; st.ver++;
    }
    const pts: V3[] = st.pts;
    // The object at the end.
    const hangType = String(p.hangObject ?? '').trim();
    if (hangType) {
      let o = st.hung ? w.byUid.get(st.hung) : undefined;
      if (o?.destroyed) o = undefined; // (taken or broken: the rope stays empty)
      if (!o && !st.hungOnce && w.typeExists(hangType)) {
        o = w.of(hangType).find((x) => x !== inst && !x.destroyed && !x.state.onRopeEnd) ?? w.spawn(hangType, a[0], a[1], a[2]) ?? undefined;
        if (o) { o.state.onRopeEnd = inst.uid; st.hung = o.uid; st.hungOnce = true; }
      }
      if (o) {
        const e = pts[pts.length - 1];
        // The object's top meets the rope's end, wherever its origin is.
        const box = w.aabb(o), top = box[4] - o.y;
        o.x = e[0]; o.y = e[1] - top - (Number(p.hangGap) || 0); if (!flat) o.z = e[2];
        o.vx = o.vy = o.vz = 0;
      }
    }
    // Someone on it.
    if (st.holder) {
      const who = w.byUid.get(st.holder);
      if (!who || who.destroyed || p.enabled === false) { releaseRope(host, inst); return; }
      const L = Math.max(0.1, ropeLength(pts));
      let atEnd = false;
      if (p.use === 'zipline') {
        const here = ropeAt(pts, st.t), next = ropeAt(pts, st.t + st.dir * 0.02);
        const down = (here[1] - next[1]) / Math.max(1e-3, Math.hypot(next[0] - here[0], next[1] - here[1], next[2] - here[2]));
        const top = Number(p.zipSpeed);
        st.v = Math.min(top, Math.max(top * 0.35, st.v + (6 + 14 * down) * dt));
        const nt = st.t + (st.dir * st.v * dt) / L;
        if (nt <= 0 || nt >= 1) atEnd = true;
        st.t = Math.max(0, Math.min(1, nt));
      } else {
        // Up is toward the higher end.
        const upDir = pts[0][1] >= pts[pts.length - 1][1] ? -1 : 1;
        const go = (host.input.anyDown(['W', 'ArrowUp']) ? 1 : 0) - (host.input.anyDown(['S', 'ArrowDown']) ? 1 : 0);
        st.t = Math.max(0, Math.min(1, st.t + (go * upDir * Number(p.climbSpeed) * dt) / L));
      }
      const at = ropeAt(pts, st.t), box = w.aabb(who), hands = (box[4] - who.y) * 0.92;
      const nx = at[0], ny = at[1] - hands, nz = flat ? who.z : at[2];
      const d = Math.max(dt, 1e-4);
      who.vx = (nx - who.x) / d; who.vy = (ny - who.y) / d; if (!flat) who.vz = (nz - who.z) / d;
      who.x = nx; who.y = ny; who.z = nz;
      if (atEnd) { host.queueTrigger('rope.on_end', { [inst.type]: [inst], [who.type]: [who] }); releaseRope(host, inst); return; }
      if (st.cool <= 0) {
        if (host.input.anyPressed(['Space'])) { releaseRope(host, inst, Number(p.letGoJump)); return; }
        if (pressedKey(host, String(p.key))) releaseRope(host, inst);
      }
      return;
    }
    // Grabbing.
    if (p.use === 'decoration' || p.enabled === false || st.cool > 0 || !String(p.player ?? '').trim() || !w.typeExists(String(p.player))) return;
    for (const who of w.of(String(p.player))) {
      if (who.destroyed || who.state.onRope || who.state.inVehicle || who.state.health?.dead) continue;
      const box = w.aabb(who);
      // From the feet to the head counts: whichever part of the body is nearest the rope.
      const cy = Math.max(box[1], Math.min(box[4], ropeAt(pts, 0.5)[1]));
      const near = [ropeNearest(pts, who.x, box[4], who.z, flat), ropeNearest(pts, who.x, cy, who.z, flat), ropeNearest(pts, who.x, box[1], who.z, flat)].sort((m, n) => m.d - n.d)[0];
      if (near.d > Number(p.reach)) continue;
      if (String(p.prompt ?? '').trim()) who.state.bubble = { kind: 'say', text: host.fillPrompts ? host.fillPrompts(String(p.prompt)) : String(p.prompt), until: host.time + 0.15 };
      if (pressedKey(host, String(p.key))) { grab(host, inst, who, p, near.t); }
      return;
    }
  },
};
