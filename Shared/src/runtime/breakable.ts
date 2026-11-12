// Breakable objects: like Blender's Cell Fracture, the object shatters into many real pieces of itself when it runs
// out of durability (damage, attacks, projectiles), when something hits it hard enough, or when it is destroyed.
// The runtime decides WHEN it breaks and records a shatter event; the renderer (GameCraft: engine/shatter.ts,
// LogicCraft: stage.ts) cuts the object's own mesh / sprite into pieces and throws them about. Pieces are visual,
// so a thousand of them never slow the game's physics. This module must not import behaviors.ts.
import type { RInstance, World } from './world';
import type { BehaviorDef, BehaviorHost } from './behaviors';
import { aabbOverlap } from './world';

/** What the renderer needs to shatter an object (consumed from Runtime.shatters). */
export interface ShatterEvent {
  uid: number;
  /** World position and the direction/speed of the blow (pieces fly away from the hit point). */
  pos: [number, number, number]; dir: [number, number, number]; speed: number;
  pieces: number; force: number; lifetime: number; seed: number;
  /** Colour for the cut faces inside. */
  inside: string;
  /** high = many real pieces, medium = fewer real pieces, low = a burst of little bits on the object's surface. */
  quality?: 'high' | 'medium' | 'low';
  /** Images (asset ids) replacing the outer surface / the cut faces. Empty = the object's own look, the inside colour. */
  outsideTexture?: string; insideTexture?: string;
}

const MOVERS = ['physics', 'platform', 'eightdir', 'car', 'bullet', 'pathfinding', 'slime', 'flyer'];
const speedOf = (w: World, i: RInstance) => (w.plane === 'xz' ? Math.hypot(i.vx, i.vy, i.vz) : Math.hypot(i.vx, i.vy));

export const BREAKABLE: BehaviorDef = {
  id: 'breakable', name: 'Breakable (shatter)', icon: '✧',
  doc: 'The object shatters into many real pieces of itself (like Blender\'s Cell Fracture) when its durability runs out (Deal damage, attacks, projectiles), when something hits it hard enough, or when it is destroyed. With Health on the object, it breaks when Health dies. Triggers: Physics › On broken / On break damage.',
  props: [
    { key: 'durability', label: 'Durability', type: 'number', default: 20, min: 0, step: 1, doc: 'Damage it can take before breaking (0 = breaks at the first hit). Ignored when the object has Health.' },
    { key: 'breakOnImpact', label: 'Break when hit hard', type: 'boolean', default: true },
    { key: 'impactSpeed', label: 'Impact speed to break (m/s)', type: 'number', default: 4, min: 0.1, step: 0.5, doc: 'Something moving into it at least this fast (a thrown crate, a running player, a car, a bullet) breaks it. Its own fall counts too.' },
    { key: 'quality', label: 'Break quality', type: 'choice', options: ['high', 'medium', 'low'], default: 'high', doc: 'High: the model itself is cut into the number of Pieces. Medium: the same real cuts, a quarter as many pieces (at most 30), gone sooner. Low: no cutting at all, little bits burst off the object\'s surface in its colours. One draw call, the cheapest choice for lots of objects.' },
    { key: 'pieces', label: 'Pieces', type: 'number', default: 120, min: 2, max: 1000, step: 1, doc: 'How many pieces it shatters into (up to 1000). On Low, how many bits burst out (at most 400).' },
    { key: 'force', label: 'Explosion force', type: 'number', default: 4, min: 0, step: 0.5, doc: 'How hard the pieces fly apart.' },
    { key: 'lifetime', label: 'Pieces last (s)', type: 'number', default: 5, min: 0.5, step: 0.5 },
    { key: 'outsideTexture', label: 'Outer texture', type: 'image', default: '', doc: 'Image on the pieces\' outer surface. None = the object keeps its own look.' },
    { key: 'insideTexture', label: 'Inner texture', type: 'image', default: '', doc: 'Image on the freshly cut faces, tinted by Inside colour when one is set. None = the Inside colour only.' },
    { key: 'inside', label: 'Inside colour', type: 'color', default: '', doc: 'Colour of the freshly cut faces (empty = a darker shade of the object\'s average colour).' },
    { key: 'shatterOnDestroy', label: 'Shatter when destroyed', type: 'boolean', default: true, doc: 'Destroy object (blocks, falling out of the level...) also shatters it.' },
    { key: 'debris', label: 'Spawn object when broken', type: 'objectType', default: '', doc: 'Optional object type created where it broke (loot, a smoking wreck).' },
    { key: 'particles', label: 'Particles when broken', type: 'particle', default: '', doc: 'Particle preset (smoke, sparks, explosion...). Empty = none.' },
    { key: 'sound', label: 'Sound when broken', type: 'sound', default: 'hit', doc: 'Empty = silent.' },
    { key: 'enabled', label: 'Enabled', type: 'boolean', default: true },
  ],
  expressions: {
    Durability: (i) => i.state.breakable?.hp ?? 0,
    IsBroken: (i) => (i.state.breakable?.broken ? 1 : 0),
  },
  init(inst, host) {
    const p = host.world.behavior(inst, 'breakable')!.props;
    inst.state.breakable = { hp: Number(p.durability), broken: false, lastSpeed: 0 };
  },
  tick(inst, p, host) {
    const w = host.world;
    const st = (inst.state.breakable ??= { hp: Number(p.durability), broken: false, lastSpeed: 0 });
    if (st.broken) return;
    // With Health: break when it dies.
    if (inst.state.health?.dead) { host.breakObject?.(inst, null); return; }
    if (!p.breakOnImpact) return;
    const need = Number(p.impactSpeed);
    // Its own hard stop (dropped, thrown into a wall).
    const sp = speedOf(w, inst);
    if (st.lastSpeed - sp >= need && st.lastSpeed >= need) { host.breakObject?.(inst, { dir: [inst.vx, inst.vy, inst.vz], speed: st.lastSpeed }); return; }
    st.lastSpeed = sp;
    // Something moving into it. A mover that hits a solid breakable is stopped in the same tick it arrives, so the
    // speed it had on the previous tick counts too.
    const box = w.aabb(inst);
    const grown: typeof box = [box[0] - 0.08, box[1] - 0.08, box[2] - 0.08, box[3] + 0.08, box[4] + 0.08, box[5] + 0.08];
    const near: typeof box = [box[0] - 3, box[1] - 3, box[2] - 3, box[3] + 3, box[4] + 3, box[5] + 3];
    const prev: Map<number, { s: number; d: [number, number, number] }> = (st.prev ??= new Map());
    const seen = new Map<number, { s: number; d: [number, number, number] }>();
    for (const o of w.instances) {
      if (o === inst || o.destroyed || o.parent === inst.uid || !o.behaviors.some((b) => MOVERS.includes(b.type))) continue;
      const ob = w.aabb(o);
      if (!aabbOverlap(near, ob)) continue;
      const now = { s: speedOf(w, o), d: [o.vx, o.vy, o.vz] as [number, number, number] };
      const before = prev.get(o.uid);
      seen.set(o.uid, now);
      const hit = now.s >= need ? now : before && before.s >= need ? before : null;
      if (!hit || !aabbOverlap(grown, ob)) continue;
      host.breakObject?.(inst, { dir: hit.d, speed: hit.s, by: o });
      if (o.behaviors.some((b) => b.type === 'bullet')) w.destroy(o);
      return;
    }
    st.prev = seen;
  },
};
