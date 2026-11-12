// Walking trails: while an object moves it leaves particles (dust, footsteps, sparkles) and / or paint marks on the
// ground under it, every so many metres, stopping when it stands still. Paint marks stay (or fade after a while) and
// the oldest are cleaned up past a maximum, so a long walk never slows the game down.
import type { BehaviorDef } from './behaviors';
import { raycast } from './physics';

export const TRAIL: BehaviorDef = {
  id: 'trail', name: 'Trail', icon: '∴',
  doc: 'Leaves a trail while the object moves: particles (dust, footprints, sparkles), paint on the ground, or both. Stops when it stands still.',
  props: [
    { key: 'mode', label: 'Trail', type: 'choice', default: 'particles', options: ['particles', 'paint', 'both'] },
    { key: 'preset', label: 'Particles', type: 'choice', default: 'dust', options: ['dust', 'footsteps', 'magic', 'sparks', 'smoke', 'fire', 'snow', 'coin', 'dirt'] },
    { key: 'color', label: 'Colour', type: 'string', default: '#3aa0ff', doc: 'Paint colour (and the particles\' colour unless "Preset colours" is on).' },
    { key: 'presetColors', label: 'Preset colours (particles)', type: 'boolean', default: true },
    { key: 'spacing', label: 'Spacing (m)', type: 'number', default: 0.35, min: 0.05, step: 0.05, doc: 'A particle burst / paint mark every this many metres moved.' },
    { key: 'size', label: 'Brush size (m)', type: 'number', default: 0.5, min: 0.05, step: 0.05 },
    { key: 'opacity', label: 'Paint opacity (0–1)', type: 'number', default: 0.9, min: 0, max: 1, step: 0.05 },
    { key: 'lifetime', label: 'Paint lasts (s, 0 = stays)', type: 'number', default: 0, min: 0, step: 1, doc: 'Paint fades away after this long (0 = stays until cleaned up).' },
    { key: 'maxMarks', label: 'Paint marks kept', type: 'number', default: 400, min: 10, max: 2000, step: 10, doc: 'Oldest marks are cleaned up past this many.' },
    { key: 'groundOnly', label: 'Only on the ground', type: 'boolean', default: true, doc: 'No trail while jumping or flying.' },
    { key: 'enabled', label: 'Enabled', type: 'boolean', default: true },
  ],
  expressions: { Marks: (i) => Number(i.state.trail?.count ?? 0) },
  tick(inst, p, host) {
    const w = host.world;
    const st = (inst.state.trail ??= { last: null as number[] | null, count: 0 });
    const [x, y, z] = w.worldPos(inst);
    if (!st.last) { st.last = [x, y, z]; return; }
    const moved = Math.hypot(x - st.last[0], w.plane === 'xz' ? z - st.last[2] : y - st.last[1]);
    if (moved < Math.max(0.05, Number(p.spacing ?? 0.35))) return;
    st.last = [x, y, z];
    const grounded = inst.state.platform ? !!inst.state.platform.grounded : true;
    if (p.groundOnly !== false && !grounded) return;
    const bb = w.aabb(inst);
    const feet: [number, number, number] = w.plane === 'xz' ? [x, bb[1], z] : [x, bb[1], (bb[2] + bb[5]) / 2];
    const mode = String(p.mode ?? 'particles');
    const color = String(p.color ?? '#3aa0ff');
    if (mode !== 'paint') host.spawnParticles?.(String(p.preset ?? 'dust'), feet, w.angle(inst), p.presetColors === false ? color : undefined);
    if (mode !== 'particles') {
      // The ground under the feet (top-down 2D: the object's own spot on the floor below it).
      const blockers = w.solids().filter((s) => s !== inst);
      let on = undefined as typeof inst | undefined, point = feet, normal: [number, number, number] = [0, 1, 0];
      if (w.plane === 'xy' && !inst.state.platform) {
        // Top-down: paint lies on whatever is under it in the picture (the floor), seen from above.
        on = w.instances.find((o) => o !== inst && !o.destroyed && o.layer < inst.layer && o.kind !== 'text' && w.overlapping(inst, o)) ?? undefined;
        normal = [0, 0, 1];
      } else {
        const hit = raycast(w, [feet[0], feet[1] + 0.2, feet[2]], [0, -1, 0], 0.6, blockers, inst);
        if (hit) { on = hit.inst; point = hit.point; normal = hit.normal; }
      }
      if (on) {
        host.addMark?.(on, point, normal, Number(p.size ?? 0.5), { color, alpha: Number(p.opacity ?? 0.9), life: Number(p.lifetime ?? 0), pool: 'paint:' + inst.uid, max: Number(p.maxMarks ?? 400) });
        st.count++;
      }
    }
  },
};
