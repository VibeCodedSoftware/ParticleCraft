// Planets: the land as a pure function of direction on a sphere, so the whole globe, a region cut from it and the
// close-up chunks of that region all come from the same heights. Continents and oceans from slow noise, mountain belts of
// ridged noise, canyons, craters at several sizes, and a climate (latitude, height, moisture) that sets biomes and ice
// caps. Presets give Earth-like, Moon-like and Mars-like worlds and a few others; every number stays editable.
// (All procedural: no textures, maps or data from real planets are used.)
import { clamp, hashInts, lerp, noise3, smoothstep } from './random';
import type { PlanetCfg, PlanetRegion } from './document';

export type PlanetPalette = PlanetCfg['palette'];

export const PLANET_PRESETS: Record<string, Omit<PlanetCfg, 'seed' | 'preset'>> = {
  Earth: { radius: 60, ocean: 0.62, continentSize: 26, mountains: 0.6, relief: 520, depth: 260, craters: 0, canyons: 0.15, iceCaps: 0.35, temperature: 0, moisture: 0.55, palette: 'earth', atmosphere: 1, clouds: 0.55 },
  Moon: { radius: 30, ocean: 0, continentSize: 18, mountains: 0.25, relief: 360, depth: 0, craters: 0.9, canyons: 0, iceCaps: 0, temperature: -0.2, moisture: 0, palette: 'moon', atmosphere: 0, clouds: 0 },
  Mars: { radius: 40, ocean: 0, continentSize: 22, mountains: 0.45, relief: 620, depth: 0, craters: 0.45, canyons: 0.7, iceCaps: 0.22, temperature: -0.35, moisture: 0.05, palette: 'mars', atmosphere: 0.3, clouds: 0.05 },
  'Ice world': { radius: 45, ocean: 0.4, continentSize: 20, mountains: 0.5, relief: 420, depth: 200, craters: 0.05, canyons: 0.2, iceCaps: 1, temperature: -0.9, moisture: 0.4, palette: 'ice', atmosphere: 0.8, clouds: 0.6 },
  'Desert world': { radius: 50, ocean: 0.08, continentSize: 30, mountains: 0.35, relief: 380, depth: 120, craters: 0.1, canyons: 0.5, iceCaps: 0.08, temperature: 0.6, moisture: 0.05, palette: 'desert', atmosphere: 0.7, clouds: 0.12 },
  'Ocean world': { radius: 55, ocean: 0.88, continentSize: 12, mountains: 0.5, relief: 300, depth: 320, craters: 0, canyons: 0, iceCaps: 0.25, temperature: 0.2, moisture: 0.8, palette: 'earth', atmosphere: 1, clouds: 0.7 },
  'Volcanic world': { radius: 35, ocean: 0.25, continentSize: 16, mountains: 0.9, relief: 560, depth: 150, craters: 0.2, canyons: 0.35, iceCaps: 0, temperature: 0.9, moisture: 0.1, palette: 'volcanic', atmosphere: 0.6, clouds: 0.35 },
  'Alien world': { radius: 45, ocean: 0.45, continentSize: 20, mountains: 0.6, relief: 480, depth: 220, craters: 0.1, canyons: 0.3, iceCaps: 0.2, temperature: 0.2, moisture: 0.6, palette: 'alien', atmosphere: 0.9, clouds: 0.45 },
  // The solar system's kinds of planet (made from noise like the rest, not from maps of the real ones).
  Mercury: { radius: 24, ocean: 0, continentSize: 14, mountains: 0.2, relief: 300, depth: 0, craters: 1, canyons: 0.1, iceCaps: 0, temperature: 0.6, moisture: 0, palette: 'mercury', atmosphere: 0, clouds: 0 },
  Venus: { radius: 58, ocean: 0, continentSize: 28, mountains: 0.4, relief: 420, depth: 0, craters: 0.1, canyons: 0.2, iceCaps: 0, temperature: 1, moisture: 0, palette: 'venus', atmosphere: 1, clouds: 1 },
  Jupiter: { radius: 200, ocean: 0, continentSize: 60, mountains: 0, relief: 50, depth: 0, craters: 0, canyons: 0, iceCaps: 0, temperature: -0.5, moisture: 0, palette: 'jupiter', atmosphere: 0.5, clouds: 0, kind: 'gas', bands: 1, storms: 1, rings: 0 },
  Saturn: { radius: 180, ocean: 0, continentSize: 60, mountains: 0, relief: 50, depth: 0, craters: 0, canyons: 0, iceCaps: 0, temperature: -0.6, moisture: 0, palette: 'saturn', atmosphere: 0.4, clouds: 0, kind: 'gas', bands: 0.55, storms: 0.15, rings: 1, ringTilt: 26 },
  Uranus: { radius: 110, ocean: 0, continentSize: 60, mountains: 0, relief: 50, depth: 0, craters: 0, canyons: 0, iceCaps: 0, temperature: -0.9, moisture: 0, palette: 'uranus', atmosphere: 0.6, clouds: 0, kind: 'gas', bands: 0.2, storms: 0.05, rings: 0.3, ringTilt: 82 },
  Neptune: { radius: 105, ocean: 0, continentSize: 60, mountains: 0, relief: 50, depth: 0, craters: 0, canyons: 0, iceCaps: 0, temperature: -1, moisture: 0, palette: 'neptune', atmosphere: 0.7, clouds: 0, kind: 'gas', bands: 0.45, storms: 0.7, rings: 0 },
  Pluto: { radius: 12, ocean: 0, continentSize: 10, mountains: 0.35, relief: 250, depth: 0, craters: 0.45, canyons: 0.15, iceCaps: 0.4, temperature: -1, moisture: 0, palette: 'pluto', atmosphere: 0.1, clouds: 0 },
};

/** A gas giant's cloud bands (light zones and dark belts), and the colour of its storms. */
const GAS: Partial<Record<PlanetPalette, { bands: RGB[]; storm: RGB }>> = {
  jupiter: { bands: [[0.86, 0.79, 0.66], [0.7, 0.53, 0.38], [0.92, 0.87, 0.77], [0.6, 0.42, 0.3], [0.82, 0.7, 0.55], [0.75, 0.62, 0.48]], storm: [0.74, 0.33, 0.22] },
  saturn: { bands: [[0.9, 0.83, 0.64], [0.8, 0.71, 0.5], [0.94, 0.88, 0.72], [0.74, 0.64, 0.45]], storm: [0.95, 0.92, 0.82] },
  uranus: { bands: [[0.64, 0.84, 0.86], [0.6, 0.8, 0.83], [0.7, 0.87, 0.88]], storm: [0.85, 0.95, 0.96] },
  neptune: { bands: [[0.22, 0.38, 0.78], [0.18, 0.32, 0.7], [0.28, 0.45, 0.85], [0.2, 0.35, 0.74]], storm: [0.1, 0.17, 0.42] },
};
export const isGasGiant = (p: PlanetCfg) => p.kind === 'gas';

/** A gas giant's colour in the direction (x, y, z): bands by latitude, bent by turbulence, with storm ovals. */
export function gasColor(p: PlanetCfg, x: number, y: number, z: number): RGB {
  const G = GAS[p.palette] ?? GAS.jupiter!, B = clamp(p.bands ?? 0.6);
  // Turbulence bends the bands (more along their edges), as cloud belts shear against each other.
  const w = fbm3(p.seed + 31, x * 3, y * 9, z * 3, 5) * 0.08 + fbm3(p.seed + 47, x * 12, y * 30, z * 12, 3) * 0.02;
  const lat = y + w, t = (lat * 0.5 + 0.5) * G.bands.length * 3.2;
  const i = Math.floor(t), f = smoothstep(0.35, 0.65, t - i);
  let c = mix(G.bands[((i % G.bands.length) + G.bands.length) % G.bands.length], G.bands[(((i + 1) % G.bands.length) + G.bands.length) % G.bands.length], f);
  // Band contrast: low for pale worlds, high for strongly banded ones.
  const avg = G.bands.reduce((a, b) => [a[0] + b[0] / G.bands.length, a[1] + b[1] / G.bands.length, a[2] + b[2] / G.bands.length] as RGB, [0, 0, 0] as RGB);
  c = mix(avg, c, 0.25 + 0.75 * B);
  // Fine streaks along the bands.
  c = mix(c, mix(c, [1, 1, 1], 0.25), smoothstep(0.55, 0.9, fbm3(p.seed + 61, x * 4, y * 60, z * 4, 3) * 0.5 + 0.5) * 0.4 * B);
  // Storm ovals: a few, stretched along the bands.
  const S = clamp(p.storms ?? 0);
  if (S > 0) for (let k = 0; k < 5; k++) {
    const h = hashInts(p.seed, 900 + k); if ((h & 255) / 255 > S) continue;
    const sl = ((h >>> 8) & 255) / 255 * 1.2 - 0.6, sa = ((h >>> 16) & 255) / 255 * Math.PI * 2, size = 0.05 + ((h >>> 24) & 255) / 255 * 0.12 * (k === 0 ? 1.6 : 1);
    const cx = Math.cos(sl) * Math.cos(sa), cz = Math.cos(sl) * Math.sin(sa), cy = Math.sin(sl);
    const dx = x - cx, dy = (y - cy) * 2.2, dz = z - cz, d = Math.hypot(dx, dy, dz) / size;
    if (d < 1.4) c = mix(c, G.storm, (1 - smoothstep(0.55, 1.1, d)) * 0.85);
  }
  return c;
}
export const planetDefaults = (preset = 'Earth', seed = 4242): PlanetCfg => ({ preset, seed, ...PLANET_PRESETS[preset] ?? PLANET_PRESETS.Earth });

const fbm3 = (seed: number, x: number, y: number, z: number, oct: number, gain = 0.5) => {
  let a = 1, f = 1, s = 0, n = 0;
  for (let i = 0; i < oct; i++) { s += noise3(seed + i * 131, x * f + i * 17.3, y * f - i * 9.1, z * f + i * 5.7) * a; n += a; a *= gain; f *= 2.03; }
  return s / n;
};
const ridged = (seed: number, x: number, y: number, z: number, oct: number) => {
  let a = 0.5, f = 1, s = 0, w = 1;
  for (let i = 0; i < oct; i++) { const r = 1 - Math.abs(noise3(seed + i * 71, x * f + i * 3.1, y * f, z * f - i * 2.7)); const v = r * r * w; s += v * a; w = clamp(v * 1.8); a *= 0.5; f *= 2.05; }
  return s;
};

/** Craters at one size: a bowl with a raised rim, the centres scattered over a 3D grid of `cell` metres. */
function craterField(seed: number, x: number, y: number, z: number, cell: number, chance: number): number {
  const ci = Math.floor(x / cell), cj = Math.floor(y / cell), ck = Math.floor(z / cell);
  let out = 0;
  for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) {
    const h = hashInts(seed, ci + a, cj + b, ck + c);
    if ((h & 1023) / 1023 > chance) continue;
    const ox = ((h >>> 10) & 255) / 255, oy = ((h >>> 18) & 255) / 255, oz = (hashInts(h, 7) & 255) / 255;
    const r = cell * (0.18 + 0.3 * ((hashInts(h, 9) & 255) / 255));
    const d = Math.hypot(x - (ci + a + ox) * cell, y - (cj + b + oy) * cell, z - (ck + c + oz) * cell) / r;
    if (d > 1.6) continue;
    // Bowl (âˆ’1 at the middle), rim (+0.25 at the edge), fading out beyond. Depth grows with size.
    const bowl = d < 1 ? (d * d - 1) : 0;
    const rim = 0.28 * Math.exp(-((d - 1) * (d - 1)) / 0.04);
    out += (bowl + rim) * r * 0.22;
  }
  return out;
}

export interface PlanetSample { /** Metres above sea level (or the mean surface of a dry world). */ h: number; /** 0 sea .. 1 land. */ land: number }

/** The planet's height in the direction (x, y, z) (unit length). */
export function planetHeight(p: PlanetCfg, x: number, y: number, z: number): PlanetSample {
  // (A gas giant has no ground: its cloud tops are smooth.)
  if (p.kind === 'gas') return { h: 0, land: 1 };
  const R = Math.max(1, p.radius) * 1000, X = x * R, Y = y * R, Z = z * R;
  const cs = 1 / Math.max(500, p.continentSize * 1000);
  const oct = Math.max(3, Math.min(9, Math.ceil(Math.log2(p.continentSize / 0.3))));
  const cont = fbm3(p.seed, X * cs, Y * cs, Z * cs, oct, 0.52);
  let h: number, land: number;
  if (p.ocean > 0.001) {
    const cut = (clamp(p.ocean) - 0.5) * 0.55, e = cont - cut;
    land = smoothstep(-0.01, 0.04, e);
    h = e > 0 ? (0.012 + smoothstep(0, 0.3, e) * 0.3) * p.relief : -Math.max(5, p.depth) * (0.08 + 0.92 * smoothstep(0, 0.14, -e));
  } else { land = 1; h = cont * 0.3 * p.relief; }
  // Hills everywhere on land, softer under the sea.
  h += fbm3(p.seed + 77, X / 2600, Y / 2600, Z / 2600, 5) * p.relief * 0.09 * lerp(0.4, 1, land);
  // Mountain belts: ridged noise, only where a slow band of noise rises.
  if (p.mountains > 0) {
    const ms = cs * 5;
    const belt = smoothstep(0.02, 0.3, fbm3(p.seed + 300, X * cs * 1.4, Y * cs * 1.4, Z * cs * 1.4, 3)) * clamp(p.mountains);
    if (belt > 0) h += belt * ridged(p.seed + 400, X * ms, Y * ms, Z * ms, 6) * p.relief * 1.1 * lerp(0.25, 1, land);
  }
  // Canyons: long winding cuts.
  if (p.canyons > 0) {
    const c = Math.abs(fbm3(p.seed + 900, X * cs * 2, Y * cs * 2, Z * cs * 2, 4));
    h -= (1 - smoothstep(0.015, 0.07, c)) * p.canyons * p.relief * 0.45 * land;
  }
  // Craters at three sizes.
  if (p.craters > 0) {
    const k = clamp(p.craters);
    h += craterField(p.seed + 1200, X, Y, Z, p.continentSize * 260, 0.35 * k) + craterField(p.seed + 1300, X, Y, Z, p.continentSize * 70, 0.55 * k) + craterField(p.seed + 1400, X, Y, Z, 900, 0.6 * k);
  }
  return { h, land };
}

export interface PlanetClimate { temperature: number; moisture: number; ice: number; lat: number }
/** Latitude, height and moisture: temperature âˆ’1..1, moisture 0..1, ice 0..1 (caps and frozen heights). */
export function planetClimate(p: PlanetCfg, x: number, y: number, z: number, h: number): PlanetClimate {
  const lat = Math.asin(clamp(y, -1, 1));
  const R = p.radius * 1000, s = 1 / Math.max(500, p.continentSize * 600);
  const wobble = fbm3(p.seed + 2000, x * R * s, y * R * s, z * R * s, 3) * 0.25;
  const temperature = clamp(Math.cos(lat) * 1.5 - 0.75 + p.temperature * 0.6 + wobble - Math.max(0, h) / Math.max(50, p.relief) * 0.7, -1, 1);
  // Rain belts by latitude, as air circulates on a real planet: wet tropics, dry subtropics (~30°: the deserts), wet
  // mid-latitudes (~55°), dry poles. Only where there is water to rain.
  const belts = p.ocean > 0.001 ? 0.24 * Math.cos(lat * 6) : 0;
  const moisture = clamp(p.moisture + belts + fbm3(p.seed + 2100, x * R * s * 1.5, y * R * s * 1.5, z * R * s * 1.5, 4) * 0.8 - (p.ocean > 0 ? 0 : 0.2));
  const capLat = (90 - clamp(p.iceCaps) * 62) * Math.PI / 180;
  const ice = p.iceCaps > 0 ? Math.max(smoothstep(capLat - 0.06, capLat + 0.06, Math.abs(lat) + wobble * 0.25), smoothstep(-0.55, -0.8, temperature) * clamp(p.iceCaps * 2)) : 0;
  return { temperature, moisture, ice, lat };
}

type RGB = [number, number, number];
const mix = (a: RGB, b: RGB, t: number): RGB => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
/** The colours of a palette's ground: sea floor/sea, low ground, mid, high, dry, wet and ice. */
const PALETTES: Record<PlanetPalette, { deep: RGB; shallow: RGB; shore: RGB; low: RGB; lush: RGB; dry: RGB; high: RGB; cold: RGB; ice: RGB }> = {
  earth: { deep: [0.03, 0.1, 0.26], shallow: [0.08, 0.32, 0.5], shore: [0.82, 0.75, 0.52], low: [0.34, 0.52, 0.2], lush: [0.12, 0.32, 0.12], dry: [0.78, 0.66, 0.42], high: [0.44, 0.41, 0.38], cold: [0.5, 0.5, 0.42], ice: [0.93, 0.95, 0.98] },
  moon: { deep: [0.25, 0.25, 0.26], shallow: [0.3, 0.3, 0.3], shore: [0.5, 0.5, 0.49], low: [0.33, 0.33, 0.34], lush: [0.42, 0.42, 0.42], dry: [0.6, 0.6, 0.58], high: [0.68, 0.67, 0.65], cold: [0.55, 0.55, 0.55], ice: [0.85, 0.86, 0.88] },
  mars: { deep: [0.3, 0.14, 0.08], shallow: [0.42, 0.2, 0.11], shore: [0.62, 0.35, 0.2], low: [0.55, 0.26, 0.14], lush: [0.38, 0.2, 0.14], dry: [0.74, 0.42, 0.24], high: [0.6, 0.38, 0.28], cold: [0.66, 0.5, 0.42], ice: [0.94, 0.9, 0.88] },
  ice: { deep: [0.04, 0.12, 0.25], shallow: [0.2, 0.4, 0.55], shore: [0.7, 0.76, 0.8], low: [0.62, 0.7, 0.76], lush: [0.5, 0.58, 0.62], dry: [0.75, 0.8, 0.85], high: [0.5, 0.52, 0.56], cold: [0.85, 0.9, 0.95], ice: [0.95, 0.97, 1] },
  desert: { deep: [0.06, 0.2, 0.3], shallow: [0.15, 0.4, 0.45], shore: [0.88, 0.78, 0.55], low: [0.82, 0.68, 0.44], lush: [0.5, 0.5, 0.28], dry: [0.9, 0.74, 0.48], high: [0.62, 0.46, 0.32], cold: [0.7, 0.62, 0.5], ice: [0.93, 0.93, 0.92] },
  volcanic: { deep: [0.6, 0.15, 0.02], shallow: [0.95, 0.42, 0.06], shore: [0.18, 0.15, 0.14], low: [0.16, 0.14, 0.13], lush: [0.25, 0.2, 0.16], dry: [0.32, 0.26, 0.22], high: [0.12, 0.11, 0.11], cold: [0.4, 0.38, 0.36], ice: [0.8, 0.8, 0.8] },
  alien: { deep: [0.12, 0.04, 0.28], shallow: [0.15, 0.45, 0.5], shore: [0.75, 0.7, 0.85], low: [0.45, 0.2, 0.55], lush: [0.12, 0.55, 0.45], dry: [0.7, 0.55, 0.3], high: [0.35, 0.3, 0.45], cold: [0.6, 0.65, 0.8], ice: [0.9, 0.95, 1] },
  mercury: { deep: [0.3, 0.28, 0.26], shallow: [0.35, 0.33, 0.3], shore: [0.5, 0.47, 0.43], low: [0.42, 0.39, 0.36], lush: [0.36, 0.34, 0.31], dry: [0.55, 0.51, 0.46], high: [0.6, 0.57, 0.52], cold: [0.5, 0.48, 0.45], ice: [0.8, 0.8, 0.8] },
  venus: { deep: [0.5, 0.36, 0.2], shallow: [0.6, 0.45, 0.26], shore: [0.7, 0.55, 0.32], low: [0.62, 0.46, 0.28], lush: [0.55, 0.4, 0.24], dry: [0.74, 0.56, 0.32], high: [0.48, 0.36, 0.24], cold: [0.6, 0.5, 0.36], ice: [0.8, 0.75, 0.6] },
  pluto: { deep: [0.4, 0.33, 0.28], shallow: [0.5, 0.42, 0.36], shore: [0.75, 0.68, 0.6], low: [0.62, 0.52, 0.44], lush: [0.5, 0.36, 0.28], dry: [0.78, 0.7, 0.6], high: [0.42, 0.32, 0.27], cold: [0.85, 0.8, 0.74], ice: [0.94, 0.92, 0.9] },
  jupiter: { deep: [0.7, 0.55, 0.4], shallow: [0.7, 0.55, 0.4], shore: [0.8, 0.7, 0.55], low: [0.8, 0.7, 0.55], lush: [0.8, 0.7, 0.55], dry: [0.8, 0.7, 0.55], high: [0.8, 0.7, 0.55], cold: [0.8, 0.7, 0.55], ice: [0.9, 0.85, 0.75] },
  saturn: { deep: [0.85, 0.77, 0.58], shallow: [0.85, 0.77, 0.58], shore: [0.88, 0.8, 0.62], low: [0.88, 0.8, 0.62], lush: [0.88, 0.8, 0.62], dry: [0.88, 0.8, 0.62], high: [0.88, 0.8, 0.62], cold: [0.88, 0.8, 0.62], ice: [0.92, 0.88, 0.75] },
  uranus: { deep: [0.62, 0.82, 0.85], shallow: [0.62, 0.82, 0.85], shore: [0.66, 0.85, 0.87], low: [0.66, 0.85, 0.87], lush: [0.66, 0.85, 0.87], dry: [0.66, 0.85, 0.87], high: [0.66, 0.85, 0.87], cold: [0.66, 0.85, 0.87], ice: [0.8, 0.92, 0.93] },
  neptune: { deep: [0.2, 0.35, 0.75], shallow: [0.2, 0.35, 0.75], shore: [0.24, 0.4, 0.8], low: [0.24, 0.4, 0.8], lush: [0.24, 0.4, 0.8], dry: [0.24, 0.4, 0.8], high: [0.24, 0.4, 0.8], cold: [0.24, 0.4, 0.8], ice: [0.6, 0.7, 0.9] },
};

/** The colour of the planet at a point (for the globe, and for a region's ground colours). */
export function planetColor(p: PlanetCfg, s: PlanetSample, c: PlanetClimate): RGB {
  const P = PALETTES[p.palette] ?? PALETTES.earth;
  if (s.land < 0.5 && p.ocean > 0.001) return mix(P.deep, P.shallow, smoothstep(-p.depth, -p.depth * 0.05, s.h));
  const up = clamp(s.h / Math.max(50, p.relief));
  let col = mix(P.low, P.lush, smoothstep(0.35, 0.8, c.moisture));
  col = mix(col, P.dry, smoothstep(0.35, 0.05, c.moisture) * smoothstep(-0.2, 0.4, c.temperature));
  col = mix(col, P.cold, smoothstep(-0.1, -0.5, c.temperature));
  col = mix(col, P.high, smoothstep(0.35, 0.75, up));
  if (p.ocean > 0.001) col = mix(P.shore, col, smoothstep(2, 14, s.h));
  return mix(col, P.ice, c.ice);
}

/** The direction on the sphere of a latitude and longitude (degrees), with its east and north. */
export function planetFrame(lat: number, lon: number) {
  const la = lat * Math.PI / 180, lo = lon * Math.PI / 180;
  const c: RGB = [Math.cos(la) * Math.cos(lo), Math.sin(la), Math.cos(la) * Math.sin(lo)];
  const e: RGB = [-Math.sin(lo), 0, Math.cos(lo)];
  const n: RGB = [-Math.sin(la) * Math.cos(lo), Math.cos(la), -Math.sin(la) * Math.sin(lo)];
  return { c, e, n };
}

/** A world point (x east, z south, in metres) of a region to its direction on the planet. */
export function regionDir(r: PlanetRegion, x: number, z: number): RGB {
  const f = frameCache(r), R = r.planet.radius * 1000;
  const px = f.c[0] + (x * f.e[0] - z * f.n[0]) / R, py = f.c[1] + (x * f.e[1] - z * f.n[1]) / R, pz = f.c[2] + (x * f.e[2] - z * f.n[2]) / R;
  const l = Math.hypot(px, py, pz);
  return [px / l, py / l, pz / l];
}
let lastFrame: { lat: number; lon: number; f: ReturnType<typeof planetFrame> } | null = null;
const frameCache = (r: PlanetRegion) => { if (!lastFrame || lastFrame.lat !== r.lat || lastFrame.lon !== r.lon) lastFrame = { lat: r.lat, lon: r.lon, f: planetFrame(r.lat, r.lon) }; return lastFrame.f; };

/** A region's land at a world point: sea level plus the planet's height there. */
export function regionHeight(r: PlanetRegion, x: number, z: number): PlanetSample {
  const d = regionDir(r, x, z);
  const s = planetHeight(r.planet, d[0], d[1], d[2]);
  return { h: r.sea + s.h, land: s.land };
}

const hex = (c: RGB) => '#' + c.map((v) => Math.round(clamp(v) * 255).toString(16).padStart(2, '0')).join('');
/** What a region on the planet looks like: ground colours, whether it has sea, how cold it is (for snow and biomes). */
export function regionLook(p: PlanetCfg, lat: number, lon: number) {
  const { c } = planetFrame(lat, lon);
  const s = planetHeight(p, c[0], c[1], c[2]), cl = planetClimate(p, c[0], c[1], c[2], s.h);
  const P = PALETTES[p.palette] ?? PALETTES.earth;
  const ground = planetColor(p, { h: Math.max(s.h, 20), land: 1 }, cl);
  return {
    sample: s, climate: cl, life: p.palette === 'earth' || p.palette === 'alien' || p.palette === 'desert',
    surface: { grass: hex(ground), dirt: hex(mix(P.dry, P.low, 0.4)), rock: hex(P.high), sand: hex(P.shore), snow: hex(P.ice), gravel: hex(mix(P.high, P.dry, 0.5)), mud: hex(mix(P.low, [0.1, 0.08, 0.06], 0.5)) },
    sea: p.ocean > 0.001, seaColor: hex(P.shallow), deepColor: hex(P.deep),
  };
}
