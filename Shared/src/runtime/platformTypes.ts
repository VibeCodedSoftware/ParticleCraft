// Platform types (on a Solid object): solid, one-way (land on it from above, jump up through it, drop through with
// middle mouse or Down + Jump), pass-through (characters walk through it, other things still collide) and toggleable
// (switched on / off by blocks or a timer). Optional fade while a character passes through or while switched off. The
// world asks `platformBlocks` when it lists what blocks a mover.
import type { BehaviorDef } from './behaviors';
import type { RInstance, World } from './world';

export const PLATFORM_KINDS = ['solid', 'one-way', 'pass-through', 'toggle'] as const;

export const PLATFORM_TYPE: BehaviorDef = {
  id: 'platformtype', name: 'Platform type',  icon: '▭',
  doc: 'With Solid: what kind of platform this is. One-way: land on it from above and jump up through it; drop through with middle mouse or Down + Jump (Platform). Pass-through: characters move through it, everything else still collides. Toggle: solid while on (blocks "Switch platform", or the timer). Other objects and players are never affected by one player passing or dropping through.',
  props: [
    { key: 'kind', label: 'Type', type: 'choice', default: 'one-way', options: [...PLATFORM_KINDS] },
    { key: 'fade', label: 'Fade when passed through', type: 'boolean', default: false, doc: 'Turns see-through while a character is inside it (and while switched off), then back.' },
    { key: 'fadeOpacity', label: 'Faded opacity (0–1)', type: 'number', default: 0.35, min: 0, max: 1, step: 0.05 },
    { key: 'fadeTime', label: 'Fade time (s)', type: 'number', default: 0.25, min: 0, max: 3, step: 0.05 },
    { key: 'onTime', label: 'Toggle: on for (s, 0 = until switched)', type: 'number', default: 0, min: 0, step: 0.1 },
    { key: 'offTime', label: 'Toggle: off for (s)', type: 'number', default: 0, min: 0, step: 0.1 },
    { key: 'enabled', label: 'Enabled', type: 'boolean', default: true },
  ],
  expressions: { IsOn: (i) => (i.state.platformType?.on === false ? 0 : 1) },
  init(inst) { inst.state.platformType = { on: true, t: 0, base: inst.opacity, shown: 1 }; },
  tick(inst, p, host, dt) {
    const st = (inst.state.platformType ??= { on: true, t: 0, base: inst.opacity, shown: 1 });
    const w = host.world;
    // Timed toggling.
    if (p.kind === 'toggle' && (Number(p.onTime) > 0 || Number(p.offTime) > 0)) {
      st.t += dt;
      const len = st.on ? Number(p.onTime) : Number(p.offTime);
      if (len > 0 && st.t >= len) { st.on = !st.on; st.t = 0; w.solidsVersion++; host.queueTrigger('platformtype.on_switched', { [inst.type]: [inst] }); }
    }
    // Fade: see-through while a character is inside it, or while it is switched off.
    if (p.fade) {
      const inside = p.kind !== 'solid' && w.instances.some((o) => o !== inst && !o.destroyed && isCharacter(w, o) && w.overlapping(o, inst));
      const want = inside || (p.kind === 'toggle' && st.on === false) ? Number(p.fadeOpacity ?? 0.35) : 1;
      const k = Number(p.fadeTime) > 0 ? Math.min(1, dt / Number(p.fadeTime)) : 1;
      st.shown += (want - st.shown) * k;
      inst.opacity = st.base * st.shown;
    }
  },
};

/** Characters: what passes through pass-through platforms and drops through one-way ones. */
export function isCharacter(w: World, i: RInstance): boolean {
  return w.hasBehavior(i, 'platform') || w.hasBehavior(i, 'eightdir') || w.hasBehavior(i, 'surfacewalker') || w.hasBehavior(i, 'vrplayer');
}

/** Does platform `s` block `mover` right now? (Solid objects without a Platform type always do.) */
export function platformBlocks(w: World, s: RInstance, mover: RInstance): boolean {
  const b = s.behaviors.find((x) => x.type === 'platformtype');
  if (!b || b.props.enabled === false) return true;
  const kind = String(b.props.kind ?? 'one-way');
  if (kind === 'toggle') return s.state.platformType?.on !== false;
  if (kind === 'pass-through') return !isCharacter(w, mover);
  if (kind === 'one-way') {
    // This mover dropping through this platform (only this one: everyone else still stands on it).
    const pl = mover.state.platform;
    if (pl?.dropT > 0 && pl.dropUid === s.uid) return false;
    // Only from above: the mover's feet at or above the top (a little leeway for the frame's fall), not going up.
    const mb = w.aabb(mover), sb = w.aabb(s);
    return mover.vy <= 0.01 && mb[1] >= sb[4] - Math.max(0.06, Math.abs(mover.vy) * 0.05);
  }
  return true;
}
