// Biomes and ground colour. Temperature and moisture come from slow noise, cooled by height; painting a biome overrides
// them locally. Everything is a pure function of position, so it matches across chunks.
import { clamp, lerp, noise2, smoothstep } from './random';
import { gridMask, sampleEdits, terrainLayerPaint } from './terrain';
import type { BiomeCfg, SurfaceCfg, TerrainCfg, WorldConfig, WorldEdits } from './document';

export const BIOME_IDS = ['forest', 'grassland', 'desert', 'snow', 'tundra', 'tropical', 'rocky', 'swamp', 'beach', 'wetlands'] as const;
export type BiomeId = (typeof BIOME_IDS)[number] | string;

/** density: trees, rocks and the like. grass: its own, since a grassland has few trees and plenty of grass. */
export const BIOME_INFO: Record<string, { name: string; t: number; m: number; ground: string; density: number; grass: number }> = {
  forest: { name: 'Forest', t: 0.55, m: 0.65, ground: '#4c7a36', density: 1.3, grass: 1 },
  grassland: { name: 'Grassland', t: 0.6, m: 0.4, ground: '#6f9a45', density: 0.7, grass: 1 },
  desert: { name: 'Desert', t: 0.92, m: 0.08, ground: '#d6bd83', density: 0.1, grass: 0.06 },
  snow: { name: 'Snow', t: 0.05, m: 0.5, ground: '#e9eef2', density: 0.4, grass: 0.25 },
  tundra: { name: 'Tundra', t: 0.2, m: 0.28, ground: '#8d9270', density: 0.3, grass: 0.6 },
  tropical: { name: 'Tropical', t: 0.9, m: 0.85, ground: '#3f8f46', density: 1.5, grass: 1 },
  rocky: { name: 'Rocky Mountains', t: 0.3, m: 0.2, ground: '#7c7972', density: 0.25, grass: 0.35 },
  swamp: { name: 'Swamp', t: 0.65, m: 0.95, ground: '#4b5d36', density: 0.9, grass: 1 },
  beach: { name: 'Beach', t: 0.7, m: 0.3, ground: '#dcc995', density: 0.1, grass: 0.05 },
  wetlands: { name: 'Wetlands', t: 0.5, m: 0.85, ground: '#55763f', density: 1, grass: 1 },
};

export const biomeDefaults = (): BiomeCfg => ({ enabled: true, seed: 777, size: 900, temperature: 0, moisture: 0, transition: 0.12, custom: [] });
export const surfaceDefaults = (): SurfaceCfg => ({ grass: '#5f8f3d', dirt: '#6d553a', rock: '#7b7872', sand: '#d9c792', snow: '#eef3f6', mud: '#4a3b2a', gravel: '#8b8780', slopeRock: 0.22, beachWidth: 3, snowLine: 95, blend: 0.08, greens: true, greenAmount: 0.85, greenScale: 30, greenA: '#3f7a2c', greenB: '#6a9c3a', greenC: '#9ab04a' });

export interface Climate { temperature: number; moisture: number }

export function climateAt(cfg: { biomes: BiomeCfg; terrain: TerrainCfg }, x: number, z: number, height: number): Climate {
  const b = cfg.biomes, s = 1 / Math.max(10, b.size);
  // Around a temperate middle: only very high ground or a colder setting reaches snow.
  const t = 0.58 + 0.42 * noise2(b.seed, x * s, z * s) + b.temperature - Math.max(0, height - (cfg.terrain.planet?.enabled ? cfg.terrain.baseHeight : 0)) / Math.max(60, cfg.terrain.height * 3.5);
  const m = 0.52 + 0.55 * noise2(b.seed + 91, x * s * 1.1 + 31, z * s * 1.1 - 12) + b.moisture;
  return { temperature: clamp(t), moisture: clamp(m) };
}

/** The biome here, with how far it is from its neighbour (0 = on the border, 1 = well inside). */
export function biomeAt(cfg: WorldConfig, edits: WorldEdits | null, x: number, z: number, height: number): { id: string; strength: number } {
  if (!cfg.biomes.enabled) return { id: 'grassland', strength: 1 };
  if (edits) {
    const painted = edits.biome[`${Math.round(x / edits.cell)},${Math.round(z / edits.cell)}`];
    if (painted) return { id: painted, strength: 1 };
  }
  const water = cfg.water.enabled ? cfg.water.level : -1e9;
  if (height < water + cfg.surface.beachWidth && height > water - 8) return { id: 'beach', strength: 1 };
  const c = climateAt(cfg, x, z, height);
  let best = 'grassland', bd = Infinity, second = Infinity;
  const test = (id: string, t: number, m: number) => { if (id === 'beach') return; const d = Math.hypot(c.temperature - t, c.moisture - m); if (d < bd) { second = bd; bd = d; best = id; } else if (d < second) second = d; };
  // (The snow biome, white ground, only where it can snow: Snow on, or the peaks of tall mountains. High plateaus and
  // hilltops otherwise turned white in patches.)
  const snowy = cfg.snow.enabled || (cfg.terrain.height >= 90 && height > cfg.terrain.baseHeight + cfg.terrain.height * 0.8);
  for (const id of Object.keys(BIOME_INFO)) if (id !== 'snow' || snowy) test(id, BIOME_INFO[id].t, BIOME_INFO[id].m);
  for (const k of cfg.biomes.custom) test(k.id, k.temperature, k.moisture);
  return { id: best, strength: clamp((second - bd) / Math.max(0.01, cfg.biomes.transition)) };
}

export const biomeDensity = (cfg: WorldConfig, id: string) => BIOME_INFO[id]?.density ?? cfg.biomes.custom.find((k) => k.id === id)?.density ?? 1;
export const biomeGrass = (cfg: WorldConfig, id: string) => BIOME_INFO[id]?.grass ?? cfg.biomes.custom.find((k) => k.id === id)?.density ?? 1;
export const biomeGround = (cfg: WorldConfig, id: string) => BIOME_INFO[id]?.ground ?? cfg.biomes.custom.find((k) => k.id === id)?.ground ?? cfg.surface.grass;

const hex = (s: string): [number, number, number] => {
  const n = parseInt((s.startsWith('#') ? s.slice(1) : s).padEnd(6, '0'), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};
export const hexRgb = hex;
const mix3 = (a: [number, number, number], b: [number, number, number], t: number): [number, number, number] => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

/**
 * How much snow lies here, 0..1, the way snow lies: from a snow line that wanders with the land (not a level cut),
 * thicker toward the peaks, more where the climate is cold, sliding off steep ground, lingering on slopes that face
 * away from the sun, broken up by drifts; and whatever was painted. Tall land with Snow off still gets snow on its
 * highest ground, as the view draws it. `normal`: the ground's facing, for shade-side snow.
 */
export function snowAt(cfg: WorldConfig, edits: WorldEdits | null, x: number, z: number, height: number, slope: number, normal?: [number, number, number]): number {
  const s = cfg.snow;
  let v = 0;
  if (s.enabled) {
    const blend = Math.max(0.1, s.blendHeight), n1 = noise2(s.seed, x * 0.011, z * 0.011), n2 = noise2(s.seed + 7, x * 0.07, z * 0.07);
    // The line wanders by a good part of its blend, so it follows ridges and gullies rather than a contour.
    const line = smoothstep(s.startHeight - blend * 0.3, s.startHeight + blend, height + n1 * blend * 0.9);
    const peaks = smoothstep(s.startHeight, s.startHeight + Math.max(30, cfg.terrain.height * 0.5), height) * (s.peaks ?? 0.6);
    // Cold places hold snow lower down: climate (biomes on) or the season.
    const winter = cfg.season?.enabled && cfg.season.season === 'winter' ? 0.55 : 0;
    const cold = (cfg.biomes.enabled ? 1 - smoothstep(0.22, 0.6, climateAt(cfg, x, z, height).temperature) : 0) * (s.temperature ?? 0.6);
    v = clamp(Math.max(line, cold, winter * (0.6 + 0.4 * n1)) + peaks) * s.coverage;
    v *= 1 - smoothstep(s.maxSlope * 0.8, s.maxSlope * 1.2, slope);
    if (normal) v *= clamp(1 + (s.aspect ?? 0.5) * 0.45 * -normal[2], 0, 1.5); // (the sun is to the south, +z)
    v *= clamp(1 + s.variation * n2 * 1.4);
  } else if (cfg.terrain.height >= 90 && !cfg.surface.look?.palette) {
    // Snow off: only the peaks of real mountains keep a cap (the top fifth of land at least 90 m tall). (It covered the top
    // half of anything over 40 m, so plateaus and hills looked like winter in patches all year round.)
    const line = cfg.terrain.baseHeight + cfg.terrain.height * 0.8;
    v = smoothstep(line - 6, line + 10, height + noise2(cfg.terrain.seed + 77, x * 0.09, z * 0.09) * 8) * (1 - smoothstep(0.32, 0.58, slope));
  }
  if (edits) v += sampleEdits(edits.snow, edits.cell, x, z);
  return clamp(v);
}

/**
 * Palettes for the look: low, middle and high ground; rock on slopes; worn rock; water channels; sediment; and, for
 * layered country, strata bands. Original colours picked for each kind of land.
 */
export interface LookPalette { name: string; low: string; mid: string; high: string; rock: string; wear: string; flow: string; deposit: string; bands?: number; band?: string }
export const LOOK_PALETTES: Record<string, LookPalette> = {
  // (Worn rock is fresher, so lighter than the weathered rock round it; water channels darker; sediment pale.)
  temperate: { name: 'Temperate', low: '#4f6e31', mid: '#6b7944', high: '#8b8473', rock: '#6a645a', wear: '#a09582', flow: '#2c271f', deposit: '#a8956f' },
  alpine: { name: 'Alpine', low: '#4b6038', mid: '#6e6b5d', high: '#a8a49a', rock: '#6f6c66', wear: '#aaa69c', flow: '#26292e', deposit: '#9a917f' },
  desert: { name: 'Desert', low: '#c8a274', mid: '#b48258', high: '#9a6a48', rock: '#94603f', wear: '#d0a179', flow: '#5a3b28', deposit: '#e2c799', bands: 0.35, band: '#c79a6c' },
  volcanic: { name: 'Volcanic', low: '#3c3734', mid: '#2d2927', high: '#4b4541', rock: '#34302c', wear: '#6e5c4e', flow: '#161413', deposit: '#7a6d62' },
  canyon: { name: 'Canyon', low: '#b7714a', mid: '#a55a38', high: '#c88e62', rock: '#8e4c2f', wear: '#cf9468', flow: '#4d2f20', deposit: '#e0bd92', bands: 0.6, band: '#d9a273' },
  tundra: { name: 'Tundra', low: '#6d7458', mid: '#8a8a76', high: '#b9b8ad', rock: '#6f6e68', wear: '#a9a89f', flow: '#383b3f', deposit: '#aaa491' },
};

const PAINTABLE = ['grass', 'dirt', 'rock', 'sand', 'snow', 'mud', 'gravel'] as const;
export const SURFACE_LAYERS = PAINTABLE;

/** Patches of different greens, from the seed: dark to light through the three colours chosen. */
export function groundGreen(cfg: WorldConfig, x: number, z: number): [number, number, number] {
  const sf = cfg.surface, s = Math.max(1, sf.greenScale ?? 30);
  const t = clamp(0.5 + noise2(cfg.terrain.seed + 5151, x / s, z / s) * 0.8 + noise2(cfg.terrain.seed + 5177, x / (s * 0.3), z / (s * 0.3)) * 0.3);
  const a = hex(sf.greenA ?? '#3f7a2c'), b = hex(sf.greenB ?? '#6a9c3a'), c = hex(sf.greenC ?? '#9ab04a');
  return t < 0.5 ? mix3(a, b, t * 2) : mix3(b, c, (t - 0.5) * 2);
}

/**
 * Ground colour here: biome, then rock on slopes, sand at the shore, hand paint, then snow. `o.snow` false: without the
 * snow (the view draws it per pixel from its own amount); `o.plants` true: the colour plants growing here take (no rock).
 */
export function groundColor(cfg: WorldConfig, edits: WorldEdits | null, x: number, z: number, height: number, slope: number, o: { snow?: boolean; plants?: boolean } = {}): [number, number, number] {
  if (o.plants) slope = 0;
  const sf = cfg.surface;
  const biome = biomeAt(cfg, edits, x, z, height);
  let c = hex(cfg.biomes.enabled ? biomeGround(cfg, biome.id) : sf.grass); // (biomes off: the Grass colour you chose)
  if (biome.strength < 1) c = mix3(mix3(hex(sf.grass), c, 0.5), c, biome.strength);
  // A little variety in the ground.
  const n = noise2(cfg.terrain.seed + 4242, x * 0.09, z * 0.09);
  c = mix3(c, hex(sf.dirt), clamp(n * 0.45 - 0.05));
  // The greens lie over grassy ground only: sand, dirt and a purple fantasy meadow keep their own colours.
  if (sf.greens) c = mix3(c, groundGreen(cfg, x, z), clamp(sf.greenAmount ?? 0.85) * smoothstep(0.01, 0.06, c[1] - Math.max(c[0], c[2] * 0.9)));
  c = mix3(c, hex(sf.rock), smoothstep(sf.slopeRock * (1 - sf.blend * 4), sf.slopeRock * (1 + sf.blend * 4), slope));
  // (Sand on the shore, but not over rock faces standing on it.)
  if (cfg.water.enabled) c = mix3(c, hex(sf.sand), (1 - smoothstep(cfg.water.level + sf.beachWidth * 0.5, cfg.water.level + sf.beachWidth * 1.4, height)) * (1 - smoothstep(sf.slopeRock, sf.slopeRock * 1.8 + 0.05, slope)));
  // Materials the terrain layers paint (rock over a rocky hill), giving way to grass on its flat ledges.
  for (const [name, w] of Object.entries(terrainLayerPaint(cfg.terrain, x, z))) {
    const col = (sf as any)[name]; if (!col || w <= 0) continue;
    c = mix3(c, hex(col), clamp(w) * (name === 'rock' ? 0.45 + 0.55 * smoothstep(0.12, 0.35, slope) : 1));
  }
  // The look: colour from the land's own data through a palette (height ramp, rock by slope, strata, and the erosion
  // run's flow, wear and sediment).
  const L = sf.look, P = L?.palette ? LOOK_PALETTES[L.palette] : undefined;
  if (P && L!.strength > 0) {
    const t = clamp((height - cfg.terrain.baseHeight) / Math.max(10, cfg.terrain.height) + noise2(cfg.terrain.seed + 611, x * 0.02, z * 0.02) * 0.12);
    let g = t < 0.5 ? mix3(hex(P.low), hex(P.mid), t * 2) : mix3(hex(P.mid), hex(P.high), (t - 0.5) * 2);
    if (P.bands) g = mix3(g, hex(P.band ?? P.rock), smoothstep(0.5, 0.85, 0.5 + 0.5 * Math.sin(height * 0.8 + noise2(cfg.terrain.seed + 619, x * 0.01, z * 0.01) * 4)) * P.bands);
    g = mix3(g, hex(P.rock), smoothstep(0.3, 0.65, slope));
    if (edits?.grids?.length) {
      const wear = gridMask(edits, 'maps', 'wear', x, z) ?? 0, dep = gridMask(edits, 'maps', 'deposit', x, z) ?? 0, flow = gridMask(edits, 'maps', 'flow', x, z) ?? 0;
      g = mix3(g, hex(P.wear), smoothstep(0.15, 0.8, wear) * 0.85);
      g = mix3(g, hex(P.deposit), smoothstep(0.3, 0.8, dep) * 0.8);
      g = mix3(g, hex(P.flow), smoothstep(0.3, 0.85, flow) * 0.85);
    }
    c = mix3(c, g, clamp(L!.strength));
  }
  if (edits) for (const name of PAINTABLE) { const w = Math.max(sampleEdits(edits.paint[name], edits.cell, x, z), edits.grids?.length ? gridMask(edits, 'paint', name, x, z) ?? 0 : 0); if (w > 0) c = mix3(c, hex((sf as any)[name]), clamp(w)); }
  // Ground that isn't green is a little cooler, and on upper slopes and in patches it dries to tan. (This was done in
  // the view's shader, so grass, which copies this colour, never matched the ground under it.)
  const grassy = smoothstep(0.01, 0.08, c[1] - c[0]);
  // (Not where the greens are off, as in a desert: it turned sand olive.)
  if (sf.greens !== false) c = [c[0] * lerp(0.72, 1, grassy), c[1] * lerp(0.86, 1, grassy), c[2] * lerp(0.68, 1, grassy)];
  if (!sf.greens && grassy < 1) {
    const water = cfg.water.enabled ? cfg.water.level : -1e9, line = cfg.terrain.baseHeight + cfg.terrain.height * 0.52;
    const fb = (noise2(cfg.terrain.seed + 911, x * 0.018, z * 0.018) * 0.5 + 0.5) * 0.7 + (noise2(cfg.terrain.seed + 913, x * 0.05, z * 0.05) * 0.5 + 0.5) * 0.3;
    const dry = smoothstep(0.35, 0.7, fb * 0.6 + ((height - water) / Math.max(40, line - water)) * 0.7);
    c = mix3(c, [0.39, 0.335, 0.232], dry * 0.8 * (1 - grassy));
  }
  if (o.snow === false || o.plants) return c;
  const snow = snowAt(cfg, edits, x, z, height, slope);
  if (snow > 0) c = mix3(c, hex(cfg.snow.color), snow);
  return c;
}
