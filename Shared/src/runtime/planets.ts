// Spherical gravity: an object with the Planet behavior (a sphere) pulls things toward its centre within its range,
// instead of the scene's downward gravity. Surface Walker characters walk all the way round it; Physics bodies fall
// onto it. The pull is the same strength anywhere in range (game feel), from the nearest planet whose range you are in.
import type { BehaviorDef } from './behaviors';
import type { RInstance, World } from './world';

type V3 = [number, number, number];

export const PLANET: BehaviorDef = {
  id: 'planet', name: 'Planet (gravity)', icon: '🪐', gamecraftOnly: true,
  doc: 'Turns a sphere into a little planet: Surface Walker characters walk all the way round it and Physics bodies fall onto it, pulled toward its centre instead of down. Add Solid too so other things stand on it.',
  props: [
    { key: 'gravity', label: 'Gravity (m/s²)', type: 'number', default: 18, min: 0, step: 0.5 },
    { key: 'range', label: 'Range (m, 0 = 3 × radius)', type: 'number', default: 0, min: 0, step: 0.5, doc: 'Measured from the centre. Outside it the scene\'s normal gravity applies.' },
    { key: 'falloff', label: 'Weaker farther out', type: 'boolean', default: false, doc: 'Influence fades from full at the surface to nothing at the edge of the range (off = the same pull everywhere in range).' },
    { key: 'blend', label: 'Blend with other planets', type: 'boolean', default: false, doc: 'Where ranges overlap, the pulls add up (a point between two planets feels both, so you can fly from one to the other). Off = only the nearest planet pulls.' },
    { key: 'enabled', label: 'Enabled', type: 'boolean', default: true },
  ],
  expressions: {},
};

export interface PlanetPull {
  planet: RInstance;
  center: V3;
  /** The planet's surface distance from its centre. */
  radius: number;
  /** Unit vector from the centre to the object (its "up" here). */
  up: V3;
  /** Acceleration toward the centre (m/s², a vector). */
  g: V3;
  dist: number;
}

/** Centre and radius of a planet (its collider sphere, or its scaled size). */
export function planetShape(w: World, pl: RInstance): { center: V3; radius: number } {
  const [x, y, z] = pl.parent != null ? w.worldPos(pl) : [pl.x, pl.y, pl.z];
  const c = pl.collider;
  const size = c && c.shape !== 'none' ? c.size : [1, 1, 1];
  const off = c ? c.offset : [0, 0, 0];
  const radius = Math.max(Math.abs(size[0] * pl.sx), Math.abs(size[1] * pl.sy), Math.abs(size[2] * pl.sz)) / 2;
  return { center: [x + off[0] * pl.sx, y + off[1] * pl.sy, z + off[2] * pl.sz], radius };
}

/** The planet pulling `inst` (the one whose surface is nearest, among those in range), or null. */
export function planetPull(w: World, inst: RInstance, point?: V3): PlanetPull | null {
  const p = point ?? (inst.parent != null ? w.worldPos(inst) : [inst.x, inst.y, inst.z]);
  let best: PlanetPull | null = null;
  const sum: V3 = [0, 0, 0];
  let blended = 0;
  for (const pl of w.instances) {
    if (pl === inst || pl.destroyed) continue;
    const b = pl.behaviors.find((x) => x.type === 'planet');
    if (!b || b.props.enabled === false) continue;
    const { center, radius } = planetShape(w, pl);
    const d: V3 = [p[0] - center[0], p[1] - center[1], p[2] - center[2]];
    const dist = Math.hypot(...d);
    const range = Number(b.props.range) > 0 ? Number(b.props.range) : radius * 3;
    if (dist > range) continue;
    const up: V3 = dist > 1e-6 ? [d[0] / dist, d[1] / dist, d[2] / dist] : [0, 1, 0];
    // Influence: full in range, or fading from the surface to the edge of the range.
    const fade = b.props.falloff ? Math.max(0, Math.min(1, (range - dist) / Math.max(1e-3, range - radius))) : 1;
    const k = Math.max(0, Number(b.props.gravity ?? 18)) * fade;
    if (b.props.blend) { sum[0] -= up[0] * k; sum[1] -= up[1] * k; sum[2] -= up[2] * k; blended++; }
    if (best && dist - radius >= best.dist - best.radius) continue;
    best = { planet: pl, center, radius, up, g: [-up[0] * k, -up[1] * k, -up[2] * k], dist };
  }
  // Blending: the pulls of every blending planet in range add up (the nearest one is still the one walked on).
  if (best && blended > 1 && best.planet.behaviors.find((x) => x.type === 'planet')?.props.blend) best.g = sum;
  return best;
}
