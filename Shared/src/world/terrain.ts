// The terrain as a pure function of position: height(x, z) needs no neighbouring data, so chunks anywhere in an endless
// world match at their edges and come out the same whenever they are generated. Hand sculpting, rivers and roads are
// layered on the same function, so they carry over chunk borders too.
import { clamp, fbm, lerp, noise2, smoothstep } from './random';
import type { EditGrid, TerrainCfg, TerrainLayer, WorldConfig, WorldEdits } from './document';
import { regionHeight } from './planet';

export const TERRAIN_PRESETS: Record<string, Partial<TerrainCfg>> = {
  // A flat canvas: nothing but the level ground, to sculpt or paint from nothing.
  Blank: { height: 0, noiseScale: 150, noiseIntensity: 1, octaves: 1, sharpness: 0, valleyDepth: 0, plateau: 0, terraces: 0, canyon: 0, island: 0, islands: 0, flatten: 0, erosion: 0, smooth: 0, warp: 0, baseHeight: 10 },
  // Many islands in one sea, in a finite world or an endless one.
  Islands: { height: 44, noiseScale: 110, noiseIntensity: 1, octaves: 6, sharpness: 0.4, valleyDepth: 0.3, plateau: 0, terraces: 0, canyon: 0, island: 0, islands: 1, islandSize: 190, islandLand: 0.42, flatten: 0, erosion: 0.45, warp: 0.3, baseHeight: 7 },
  'Rolling landscape': { height: 26, noiseScale: 150, octaves: 5, sharpness: 0.1, valleyDepth: 0.2, plateau: 0, terraces: 0, canyon: 0, island: 0, flatten: 0, erosion: 0.3, warp: 0.25, baseHeight: 6 },
  Mountains: { height: 150, noiseScale: 300, octaves: 7, gain: 0.46, sharpness: 0.9, valleyDepth: 0.9, plateau: 0, terraces: 0, canyon: 0, island: 0, flatten: 0, erosion: 0.75, warp: 0.35, baseHeight: 4 },
  Hills: { height: 34, noiseScale: 130, octaves: 5, sharpness: 0.2, valleyDepth: 0.25, plateau: 0, terraces: 0, canyon: 0, island: 0, flatten: 0, erosion: 0.3, warp: 0.2, baseHeight: 8 },
  Valleys: { height: 70, noiseScale: 240, octaves: 6, sharpness: 0.35, valleyDepth: 0.9, plateau: 0, terraces: 0, canyon: 0, island: 0, flatten: 0, erosion: 0.55, warp: 0.3, baseHeight: 16 },
  Cliffs: { height: 55, noiseScale: 150, octaves: 5, sharpness: 0.3, valleyDepth: 0.3, plateau: 0, terraces: 3, canyon: 0, island: 0, flatten: 0, erosion: 0.2, warp: 0.2, baseHeight: 10 },
  Plateaus: { height: 60, noiseScale: 200, octaves: 5, sharpness: 0.2, valleyDepth: 0.2, plateau: 0.8, terraces: 0, canyon: 0, island: 0, flatten: 0, erosion: 0.4, warp: 0.25, baseHeight: 6 },
  Canyons: { height: 60, noiseScale: 220, octaves: 5, sharpness: 0.2, valleyDepth: 0.2, plateau: 0.55, terraces: 2, canyon: 0.9, island: 0, flatten: 0, erosion: 0.4, warp: 0.5, baseHeight: 40 },
  Island: { height: 48, noiseScale: 170, octaves: 6, sharpness: 0.45, valleyDepth: 0.3, plateau: 0, terraces: 0, canyon: 0, island: 1, flatten: 0, erosion: 0.5, warp: 0.3, baseHeight: 10 },
  Flatlands: { height: 5, noiseScale: 200, octaves: 3, sharpness: 0, valleyDepth: 0, plateau: 0, terraces: 0, canyon: 0, island: 0, flatten: 0.6, erosion: 0, warp: 0.1, baseHeight: 8 }, // (well above the water: lower, the whole plain counts as shore and turns to beach)
  Desert: { height: 18, noiseScale: 90, octaves: 3, sharpness: 0.6, valleyDepth: 0.05, plateau: 0, terraces: 0, canyon: 0, island: 0, flatten: 0, erosion: 0, warp: 0.6, baseHeight: 5 },
  'Infinite Noise': { height: 80, noiseScale: 260, octaves: 7, sharpness: 0.55, valleyDepth: 0.5, plateau: 0, terraces: 0, canyon: 0, island: 0, flatten: 0, erosion: 0.6, warp: 0.35, baseHeight: 10, endless: true },
};

// Every other preset turns islands off, so switching away from Islands really leaves them.
for (const p of Object.values(TERRAIN_PRESETS)) p.islands ??= 0;

export const terrainDefaults = (): TerrainCfg => ({
  seed: 12345, preset: 'Rolling landscape', width: 512, depth: 512, chunkSize: 64, resolution: 32,
  height: 26, noiseScale: 150, noiseIntensity: 1, octaves: 5, lacunarity: 2.03, gain: 0.5,
  sharpness: 0.1, valleyDepth: 0.2, plateau: 0, terraces: 0, canyon: 0, island: 0, flatten: 0, erosion: 0.3, smooth: 0, warp: 0.25, baseHeight: 6,
  endless: false, viewChunks: 4, unloadMargin: 1, budget: 2,
});

/** Base shape only (no hand edits): metres above zero. */
export function baseHeight(t: TerrainCfg, x: number, z: number): number {
  const s = 1 / Math.max(1, t.noiseScale);
  const fb = { octaves: Math.round(clamp(t.octaves, 1, 10)), lacunarity: t.lacunarity, gain: t.gain };
  // Domain warp: bends the pattern so it isn't visibly a grid of bumps.
  const wx = x + t.warp * t.noiseScale * noise2(t.seed + 11, x * s * 0.5, z * s * 0.5);
  const wz = z + t.warp * t.noiseScale * noise2(t.seed + 23, x * s * 0.5 + 40, z * s * 0.5 - 17);
  const round = fbm(t.seed, wx * s, wz * s, fb); // -1..1
  // Ridged layers: sharp crests. Each finer layer weakens where the layers so far are steep, which leaves the branching
  // ridges and smooth run-off valleys of eroded mountains, with no neighbouring data needed.
  let ridge = 0, amp = 0.5, f = 1, weight = 1, gx = 0, gz = 0;
  const damp = 0.3 * clamp(t.erosion);
  for (let i = 0; i < fb.octaves; i++) {
    const px = wx * s * f, pz = wz * s * f, sd = t.seed + 500 + i * 71, e = 0.04;
    const n = 1 - Math.abs(noise2(sd, px, pz));
    const dx = (1 - Math.abs(noise2(sd, px + e, pz)) - n) / e, dz = (1 - Math.abs(noise2(sd, px, pz + e)) - n) / e;
    gx += dx * amp * weight; gz += dz * amp * weight;
    const r = (n * n * weight) / (1 + damp * (gx * gx + gz * gz));
    weight = clamp(r * 1.8);
    ridge += r * amp; amp *= t.gain; f *= t.lacunarity;
  }
  let h = lerp(round * 0.5 + 0.5, ridge * 1.45, clamp(t.sharpness));
  // Valley depth: low ground sinks further, peaks stay.
  h = Math.pow(clamp(h), 1 + clamp(t.valleyDepth) * 1.1);
  // Erosion: fine detail fades on smooth low ground and bites where it is high and steep (no neighbouring data needed).
  if (t.erosion > 0) {
    const gully = Math.abs(noise2(t.seed + 900, wx * s * 7, wz * s * 7));
    const fine = fbm(t.seed + 950, wx * s * 9, wz * s * 9, { octaves: 3, lacunarity: 2.1, gain: 0.5 });
    h -= t.erosion * h * (1 - gully) * (1 - gully) * 0.16;
    h += t.erosion * fine * 0.03 * smoothstep(0.25, 0.8, h);
  }
  h = clamp(h * t.noiseIntensity, 0, 2);
  if (t.plateau > 0) { const cap = lerp(1, 0.32, clamp(t.plateau)); h = h > cap ? cap + (h - cap) * 0.08 : h; }
  if (t.terraces > 0) { const n = Math.max(1, Math.round(t.terraces)) * 3; const q = h * n, base = Math.floor(q), fr = q - base; h = (base + smoothstep(0.42, 0.58, fr)) / n; }
  if (t.flatten > 0) h *= 1 - clamp(t.flatten);
  let out = h * t.height;
  if (t.canyon > 0) {
    // Winding cuts through the land.
    const c = Math.abs(noise2(t.seed + 1300, wx * s * 0.8, wz * s * 0.8));
    out -= (1 - smoothstep(0.02, 0.13, c)) * t.canyon * t.height * 0.75;
  }
  out += t.baseHeight;
  if (t.island > 0) {
    const r = Math.hypot(x / (t.width / 2), z / (t.depth / 2));
    out = lerp(out, -t.height * 0.25, smoothstep(0.45, 1, r) * clamp(t.island));
  }
  if (t.islands && t.islands > 0) {
    // Land only where slow noise rises: separate islands in one sea, each with its own shape. The seabed stays below the
    // water; a finite world's edge is always sea.
    const size = Math.max(10, t.islandSize ?? 190), land = clamp(t.islandLand ?? 0.42);
    const n = fbm(t.seed + 1700, (x + (wx - x) * 0.5) / size, (z + (wz - z) * 0.5) / size, { octaves: 3, lacunarity: 2.1, gain: 0.45 });
    const cut = lerp(0.42, -0.42, land);
    let m = smoothstep(cut - 0.05, cut + 0.14, n);
    if (!t.endless) m *= 1 - smoothstep(0.78, 0.98, Math.max(Math.abs(x) / (t.width / 2), Math.abs(z) / (t.depth / 2)));
    out = lerp(out, lerp(-Math.max(6, t.height * 0.3), out, m), clamp(t.islands));
  }
  if (t.planet?.enabled) {
    // A region of a planet: the planet's land, with this world's own noise as the close-up detail (calmer under the sea).
    const p = regionHeight(t.planet, x, z);
    out = p.h + (out - t.baseHeight) * clamp(t.planet.detail) * lerp(0.35, 1, p.land);
  }
  if (t.layers?.length) out = applyTerrainLayers(t, x, z, out);
  return out;
}

export const TERRAIN_LAYER_TYPES = ['mountains', 'hills', 'ridges', 'dunes', 'craters', 'canyons', 'outcrops', 'ramp', 'terraces', 'plateau'] as const;
export const newTerrainLayer = (type: TerrainLayer['type'], n: number): TerrainLayer => ({
  id: 'tl_' + Date.now().toString(36) + n, name: type[0].toUpperCase() + type.slice(1), type, enabled: true, seed: 1000 + n * 77,
  blend: type === 'canyons' ? 'subtract' : type === 'terraces' || type === 'plateau' ? 'replace' : type === 'craters' ? 'add' : 'add',
  scale: { mountains: 380, hills: 120, ridges: 220, dunes: 40, craters: 90, canyons: 260, outcrops: 70, ramp: 250, terraces: 12, plateau: 40 }[type],
  height: { mountains: 90, hills: 18, ridges: 40, dunes: 4, craters: 12, canyons: 30, outcrops: 14, ramp: 30, terraces: 8, plateau: 40 }[type],
  minHeight: -1000, maxHeight: 10000, fade: 10, patchiness: 0, patchScale: 400, direction: 30,
});

/** Applies the layer stack: each layer's shape blended into the land so far, where its masks let it. */
function applyTerrainLayers(t: TerrainCfg, x: number, z: number, h0: number): number {
  let h = h0;
  for (const L of t.layers!) {
    if (!L.enabled) continue;
    // Masks: a band of height (on the land as it is so far, soft-edged by fade) and patches of slow noise.
    let w = smoothstep(L.minHeight - L.fade, L.minHeight, h) * (1 - smoothstep(L.maxHeight, L.maxHeight + L.fade, h));
    if (L.patchiness > 0) w *= smoothstep(-0.1, 0.25, noise2(L.seed + 61, x / Math.max(10, L.patchScale), z / Math.max(10, L.patchScale)) + 0.4 - L.patchiness * 0.8);
    if (w <= 0) continue;
    const s = 1 / Math.max(1, L.scale), sd = L.seed;
    let v = 0;
    switch (L.type) {
      case 'mountains': { let amp = 0.5, f = 1, wt = 1; for (let i = 0; i < 6; i++) { const n = 1 - Math.abs(noise2(sd + i * 13, x * s * f, z * s * f)); const r = n * n * wt; wt = clamp(r * 2); v += r * amp; amp *= 0.5; f *= 2.05; } v = Math.pow(clamp(v * 1.2), 1.4); break; }
      case 'hills': v = fbm(sd, x * s, z * s, { octaves: 4, lacunarity: 2, gain: 0.5 }) * 0.5 + 0.5; break;
      case 'ridges': { const n = 1 - Math.abs(fbm(sd, x * s, z * s, { octaves: 4, lacunarity: 2.1, gain: 0.45 })); v = n * n * n; break; }
      case 'dunes': {
        // Wind-shaped: a gentle windward slope and a steep lee face, the crests wandering.
        const a = (L.direction * Math.PI) / 180, u = (x * Math.cos(a) + z * Math.sin(a)) * s + noise2(sd, x * s * 0.3, z * s * 0.3) * 1.5;
        const p = u - Math.floor(u); v = (p < 0.78 ? p / 0.78 : (1 - p) / 0.22) * (0.6 + 0.4 * (noise2(sd + 3, x * s * 0.15, z * s * 0.15) * 0.5 + 0.5)); v = v * v * (3 - 2 * v); break;
      }
      case 'craters': {
        // A crater per cell (if its dice say so): a bowl with a raised rim.
        const cx = Math.floor(x * s), cz = Math.floor(z * s);
        for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
          const hx = noise2(sd, (cx + a) * 7.13, (cz + b) * 3.71) * 0.5 + 0.5, hz = noise2(sd + 9, (cx + a) * 5.31, (cz + b) * 8.17) * 0.5 + 0.5, hr = noise2(sd + 19, (cx + a) * 2.9, (cz + b) * 6.3) * 0.5 + 0.5;
          if (hr < 0.35) continue;
          const px = (cx + a + 0.2 + hx * 0.6) / s, pz = (cz + b + 0.2 + hz * 0.6) / s, R = (0.15 + hr * 0.3) / s, d = Math.hypot(x - px, z - pz) / R;
          if (d < 1.6) v += d < 1 ? (d * d - 1) * 0.8 + Math.exp(-((d - 1) ** 2) * 30) * 0.4 : Math.exp(-((d - 1) ** 2) * 6) * 0.4;
        }
        break;
      }
      case 'canyons': { const c = Math.abs(noise2(sd, x * s + noise2(sd + 5, x * s * 0.5, z * s * 0.5) * 0.6, z * s)); v = 1 - smoothstep(0.02, 0.12, c); break; }
      // A ramp (tilt): the land rising toward the wind direction over `scale` m, e.g. from a shore up to the hills.
      case 'ramp': { const a = (L.direction * Math.PI) / 180, u = (x * Math.cos(a) + z * Math.sin(a) - (L.offset ?? 0) + (noise2(sd + 1, x / 90, z / 90) + 0.5 * noise2(sd + 2, x / 30, z / 30)) * (L.amount ?? 0) * 60) * s + noise2(sd, x * s * 0.8, z * s * 0.8) * 0.25; v = smoothstep(-1, 1, u); break; }
      case 'outcrops': {
        // Rock masses: patches of fractured stone standing out of the land, with steep broken sides and flat-ish tops
        // (where grass takes hold), split into blocks by cracks, a few loose boulders round their feet.
        const warpX = noise2(sd + 7, x * s * 0.7, z * s * 0.7) * 0.5, warpZ = noise2(sd + 9, x * s * 0.7 + 3, z * s * 0.7) * 0.5;
        const mass = fbm(sd, x * s + warpX, z * s + warpZ, { octaves: 4, lacunarity: 2.2, gain: 0.5 }) * 0.5 + 0.5;
        const cut = lerp(0.56, 0.36, clamp(L.amount ?? 0.5));
        const body = smoothstep(cut, cut + 0.015, mass); // steep sides
        const blocks = Math.floor((mass - cut + 0.02) * 14 + noise2(sd + 11, x * s * 3, z * s * 3) * 1.2) / 14; // stepped tiers
        const crack = smoothstep(0.0, 0.07, Math.abs(noise2(sd + 13, x * s * 4.5, z * s * 4.5))) * smoothstep(0.0, 0.06, Math.abs(noise2(sd + 15, x * s * 9, z * s * 9)));
        // Crags inside the mass: ridged knobs of stone, so a wide rock band is broken up, not one smooth slab.
        const crag = Math.pow(1 - Math.abs(noise2(sd + 19, x * s * 2.6, z * s * 2.6)), 3) * 0.35 + Math.pow(1 - Math.abs(noise2(sd + 21, x * s * 7, z * s * 7)), 4) * 0.15;
        const top = 0.45 + clamp(blocks, 0, 0.5) + crag + noise2(sd + 17, x * s * 12, z * s * 12) * 0.06;
        v = body * top * (0.55 + 0.45 * crack);
        break;
      }
      case 'terraces': { const step = Math.max(0.5, L.height), q = h / step, base = Math.floor(q); v = (base + smoothstep(0.35, 0.65, q - base)) * step; break; }
      case 'plateau': v = Math.min(h, L.height + (h - L.height) * 0.08 * (h > L.height ? 1 : 0)); break;
    }
    // (Terraces and plateaus reshape the land itself; the others are shapes of their own height.)
    const own = L.type === 'terraces' || L.type === 'plateau' ? v : v * L.height;
    let next = h;
    switch (L.blend) {
      case 'add': next = h + own; break;
      case 'subtract': next = h - own; break;
      case 'max': next = Math.max(h, t.baseHeight + own); break;
      case 'min': next = Math.min(h, t.baseHeight + own); break;
      case 'smooth': { const k = Math.max(1, L.height * 0.3), a2 = h, b2 = t.baseHeight + own, hh = clamp(0.5 + 0.5 * (b2 - a2) / k); next = lerp(a2, b2, hh) + k * hh * (1 - hh); break; }
      case 'replace': next = L.type === 'terraces' || L.type === 'plateau' ? own : t.baseHeight + own; break;
    }
    h = lerp(h, next, w);
    // A layer that paints: its material wherever it shapes the land (read by terrainLayerPaint).
    // (Fading in with the layer's height, so its edges blend: full strength at the first 8% made hard, blotchy patches.)
    if (paintOut && L.paint) { const a = clamp(Math.abs(v) / 0.45), cov = w * a * a * (3 - 2 * a); if (cov > (paintOut[L.paint] ?? 0)) paintOut[L.paint] = cov; }
  }
  return h;
}
let paintOut: Record<string, number> | null = null;
/** The ground materials the terrain layers paint at a point (material → weight 0..1); empty if none paint. */
export function terrainLayerPaint(t: TerrainCfg, x: number, z: number): Record<string, number> {
  if (!t.layers?.some((L) => L.enabled && L.paint)) return {};
  paintOut = {};
  try { baseHeight(t, x, z); return paintOut; } finally { paintOut = null; }
}

const cellKey = (x: number, z: number) => `${x},${z}`;

/** Bilinear read of a sparse grid of cells. */
export function sampleEdits(grid: Record<string, number> | undefined, cell: number, x: number, z: number, fallback = 0): number {
  if (!grid) return fallback;
  const fx = x / cell, fz = z / cell, ix = Math.floor(fx), iz = Math.floor(fz), u = fx - ix, v = fz - iz;
  const at = (a: number, b: number) => { const r = grid[cellKey(a, b)]; return r === undefined ? fallback : r; };
  return lerp(lerp(at(ix, iz), at(ix + 1, iz), u), lerp(at(ix, iz + 1), at(ix + 1, iz + 1), u), v);
}

// ---------------------------------------------------------------- dense edit grids (simulation results)
const decoded = new WeakMap<object, Map<string, Int16Array | Uint8Array>>();
const b64 = (s: string) => { const bin = atob(s), out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; };
/** Packs an array as base64 (for EditGrid). */
export function packGrid(a: Int16Array | Uint8Array): string {
  const u = new Uint8Array(a.buffer, a.byteOffset, a.byteLength); let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000) as unknown as number[]);
  return btoa(s);
}
function gridArray(g: EditGrid, key: string, data: string, i16: boolean) {
  let m = decoded.get(g); if (!m) decoded.set(g, (m = new Map()));
  let a = m.get(key); if (!a) { const u = b64(data); a = i16 ? new Int16Array(u.buffer, 0, u.byteLength >> 1) : u; m.set(key, a); }
  return a;
}
/** Bilinear read of one array of a grid at a world point; `undefined` outside it. Heights in metres, masks 0..1. */
function gridAt(g: EditGrid, a: Int16Array | Uint8Array, scale: number, x: number, z: number): number | undefined {
  const fx = (x - g.x0) / g.cell, fz = (z - g.z0) / g.cell;
  if (fx < 0 || fz < 0 || fx > g.nx - 1 || fz > g.nz - 1) return undefined;
  const i = Math.min(g.nx - 2, Math.floor(fx)), j = Math.min(g.nz - 2, Math.floor(fz)), u = fx - i, v = fz - j, k = j * g.nx + i;
  return (lerp(lerp(a[k], a[k + 1], u), lerp(a[k + g.nx], a[k + g.nx + 1], u), v)) * scale;
}
/** The grids' height change at a point (m). */
export function gridHeight(edits: WorldEdits, x: number, z: number): number {
  let h = 0;
  for (const g of edits.grids ?? []) if (g.height && !g.absolute) h += gridAt(g, gridArray(g, 'h', g.height, true), 0.01, x, z) ?? 0;
  return h;
}
/** The land an absolute grid (the node graph) sets here (m), or `undefined` where none covers. */
export function gridAbsolute(edits: WorldEdits | null, x: number, z: number): number | undefined {
  let out: number | undefined;
  for (const g of edits?.grids ?? []) if (g.height && g.absolute) { const v = gridAt(g, gridArray(g, 'h', g.height, true), 0.05, x, z); if (v !== undefined) out = v; }
  return out;
}
/** The grids' weight of a material (or density of a scatter layer) at a point (0..1), or `undefined` if no grid has it there. */
export function gridMask(edits: WorldEdits | null, kind: 'paint' | 'density' | 'maps', name: string, x: number, z: number): number | undefined {
  let out: number | undefined;
  for (const g of edits?.grids ?? []) { const d = g[kind]?.[name]; if (!d) continue; const v = gridAt(g, gridArray(g, kind + ':' + name, d, false), 1 / 255, x, z); if (v !== undefined) out = Math.max(out ?? 0, v); }
  return out;
}

export interface Carve { /** World positions along the path. */ points: [number, number][]; width: number; falloff: number; depth?: number; level?: number[]; strength: number;
  /**
   * Water held in the land (rivers, lakes): the surface at each point. Inside `width` the ground is the bed, `depth`
   * under the water; across the bank (half the falloff) it climbs to just above the water, and past that a low bank
   * keeps the water in where the land outside is lower. So water never stands above the ground round it.
   */
  water?: number[];
  /** A lake: centre and how far its shore reaches at each of a ring of angles (multiplying `width`). */
  lake?: { x: number; z: number; shape: number[] };
}

/** Distance from a point to a polyline, and where along it. */
export function nearestOnPath(points: [number, number][], x: number, z: number): { d: number; i: number; t: number } {
  let best = Infinity, bi = 0, bt = 0;
  for (let i = 0; i + 1 < points.length; i++) {
    const [ax, az] = points[i], [bx, bz] = points[i + 1];
    const dx = bx - ax, dz = bz - az, l = dx * dx + dz * dz || 1e-6;
    const t = clamp(((x - ax) * dx + (z - az) * dz) / l);
    const px = ax + dx * t, pz = az + dz * t, d = (x - px) * (x - px) + (z - pz) * (z - pz);
    if (d < best) { best = d; bi = i; bt = t; }
  }
  return { d: Math.sqrt(best), i: bi, t: bt };
}

/** Which path segments can reach each grid cell: heights are sampled constantly, and paths can be long. */
const carveCells = new WeakMap<Carve, { cell: number; map: Map<string, number[]> }>();
function carveIndex(k: Carve) {
  let ix = carveCells.get(k);
  if (ix) return ix;
  const reach = k.width / 2 + k.falloff, cell = Math.max(16, reach * 2), map = new Map<string, number[]>();
  for (let i = 0; i + 1 < k.points.length; i++) {
    const [ax, az] = k.points[i], [bx, bz] = k.points[i + 1];
    for (let a = Math.floor((Math.min(ax, bx) - reach) / cell); a <= Math.floor((Math.max(ax, bx) + reach) / cell); a++) for (let b = Math.floor((Math.min(az, bz) - reach) / cell); b <= Math.floor((Math.max(az, bz) + reach) / cell); b++) {
      const key = a + ',' + b; let l = map.get(key); if (!l) { l = []; map.set(key, l); } l.push(i);
    }
  }
  ix = { cell, map }; carveCells.set(k, ix);
  return ix;
}
/** nearestOnPath for a carve, or null when it is out of its reach. */
function nearestOnCarve(k: Carve, x: number, z: number): { d: number; i: number; t: number } | null {
  const ix = carveIndex(k), segs = ix.map.get(Math.floor(x / ix.cell) + ',' + Math.floor(z / ix.cell));
  if (!segs) return null;
  let best = Infinity, bi = 0, bt = 0;
  for (const i of segs) {
    const [ax, az] = k.points[i], [bx, bz] = k.points[i + 1];
    const dx = bx - ax, dz = bz - az, l = dx * dx + dz * dz || 1e-6;
    const t = clamp(((x - ax) * dx + (z - az) * dz) / l);
    const px = ax + dx * t, pz = az + dz * t, d = (x - px) * (x - px) + (z - pz) * (z - pz);
    if (d < best) { best = d; bi = i; bt = t; }
  }
  return { d: Math.sqrt(best), i: bi, t: bt };
}

/** Height including hand sculpting and carves (rivers, road beds). */
/** Distance from a lake's middle, scaled so its uneven shore is at its nominal radius; and the scale. */
export function lakeDistance(lake: NonNullable<Carve['lake']>, x: number, z: number) {
  const dx = x - lake.x, dz = z - lake.z, n = lake.shape.length;
  const f = ((Math.atan2(dz, dx) / (Math.PI * 2) + 1) % 1) * n, i = Math.floor(f) % n, t = f - Math.floor(f);
  const k = lerp(lake.shape[i], lake.shape[(i + 1) % n], t * t * (3 - 2 * t));
  return { d: Math.hypot(dx, dz) / Math.max(0.2, k), k };
}

/**
 * The land rivers and lakes are laid out on: generated (or the node graph's, where applied, by the terrain's graph blend
 * that the "Node graph land" brick sets), with simulation runs (erosion). Hand sculpting isn't in it, so a brush stroke
 * doesn't send a river somewhere else.
 */
export function landHeightAt(c: { terrain: TerrainCfg }, edits: WorldEdits | null, x: number, z: number): number {
  let h = baseHeight(c.terrain, x, z);
  if (edits?.grids?.length) {
    const a = gridAbsolute(edits, x, z); if (a !== undefined) h = lerp(h, a, Math.max(0, Math.min(1, c.terrain.graphBlend ?? 1)));
    h += gridHeight(edits, x, z);
  }
  return h;
}

export function terrainHeightAt(c: { terrain: TerrainCfg }, edits: WorldEdits | null, carves: Carve[], x: number, z: number): number {
  let h = landHeightAt(c, edits, x, z);
  // Hand sculpting, before the water and roads cut the land: a river's bed is always under its water, whatever was
  // raised, lowered, eroded or applied from a node graph (when it came after, water floated over lowered land and land
  // rose through rivers).
  if (edits) {
    let e = sampleEdits(edits.height, edits.cell, x, z);
    const L = edits.layer, h0 = h;
    if (L) {
      e *= L.scale ?? 1;
      if (L.op === 'raise') e = Math.max(0, e); else if (L.op === 'lower') e = Math.min(0, e);
      // (The offset where there is sculpting, fading in over its first half metre so its edge isn't a step.)
      if (L.offset && e !== 0) e += L.offset * Math.min(1, Math.abs(e) / 0.5);
    }
    h += e;
    // Snapped to level steps where the land was sculpted (a short slope between steps, fading in at the edge of the
    // sculpting), as terraced fields and quarry benches are.
    if (L?.step && L.step > 0 && e !== 0) {
      const q = h / L.step, base = Math.floor(q), fr = q - base;
      h = lerp(h, (base + smoothstep(0.75, 1, fr)) * L.step, Math.min(1, Math.abs(e) / 0.5));
    }
    if (L && L.blend !== undefined && L.blend < 1) h = lerp(h0, h, Math.max(0, L.blend));
  }
  // Water carves are worked out together after the others: where one's channel meets another's bank (a river running
  // into a lake), the channel wins, so the water stays joined.
  let channel = Infinity, bank = -Infinity, wet = false;
  for (const k of carves) {
    if (k.water) {
      let d: number, wl: number;
      const core = k.width / 2, F = k.falloff / 2;
      if (k.lake) { d = lakeDistance(k.lake, x, z).d; if (d > core + 2 * F) continue; wl = k.water[0]; }
      else {
        if (k.points.length < 2) continue;
        const n = nearestOnCarve(k, x, z); if (!n || n.d > core + 2 * F) continue;
        d = n.d; wl = lerp(k.water[n.i], k.water[n.i + 1] ?? k.water[n.i], n.t);
      }
      wet = true;
      const bed = wl - (k.depth ?? 2), top = wl + 0.45;
      // (In the channel itself, ground already deeper than the bed stays deeper.)
      if (d < core) channel = Math.min(channel, h, bed);
      else if (d < core + F) channel = Math.min(channel, lerp(bed, Math.max(h, top), smoothstep(core, core + F, d)));
      else if (h < top) bank = Math.max(bank, lerp(top, h, smoothstep(core + F, core + 2 * F, d)));
      continue;
    }
    if (k.points.length < 2) continue;
    const n = nearestOnCarve(k, x, z);
    if (!n) continue;
    const half = k.width / 2;
    if (n.d > half + k.falloff) continue;
    const blend = (1 - smoothstep(half, half + k.falloff, n.d)) * k.strength;
    if (k.level) {
      // Road bed: towards the road's own smoothed level.
      const lvl = lerp(k.level[n.i], k.level[n.i + 1] ?? k.level[n.i], n.t);
      h = lerp(h, lvl, blend);
    } else if (k.depth) h -= blend * k.depth;
  }
  if (wet) h = channel < Infinity ? channel : Math.max(h, bank);
  return h;
}

/** Finite worlds end at their edges; endless ones never do. */
export const insideWorld = (t: TerrainCfg, x: number, z: number) => t.endless || (Math.abs(x) <= t.width / 2 && Math.abs(z) <= t.depth / 2);

export interface ChunkBounds { cx: number; cz: number; x0: number; z0: number; size: number }
export const chunkBounds = (t: TerrainCfg, cx: number, cz: number): ChunkBounds => ({ cx, cz, x0: cx * t.chunkSize, z0: cz * t.chunkSize, size: t.chunkSize });

/** Chunks of a finite world, or around a point of an endless one, nearest first. */
export function chunksAround(t: TerrainCfg, x: number, z: number, radius = t.viewChunks): [number, number][] {
  const ccx = Math.floor(x / t.chunkSize), ccz = Math.floor(z / t.chunkSize), out: [number, number][] = [];
  if (t.endless) {
    for (let a = -radius; a <= radius; a++) for (let b = -radius; b <= radius; b++) if (a * a + b * b <= radius * radius + 1) out.push([ccx + a, ccz + b]);
  } else {
    const ax = Math.floor(-t.width / 2 / t.chunkSize), bx = Math.ceil(t.width / 2 / t.chunkSize), az = Math.floor(-t.depth / 2 / t.chunkSize), bz = Math.ceil(t.depth / 2 / t.chunkSize);
    for (let a = ax; a < bx; a++) for (let b = az; b < bz; b++) out.push([a, b]);
  }
  return out.sort((p, q) => (p[0] - ccx) ** 2 + (p[1] - ccz) ** 2 - ((q[0] - ccx) ** 2 + (q[1] - ccz) ** 2));
}

/** Slope 0 (flat) .. 1 (vertical) and normal, from neighbouring heights. */
export function slopeAt(h: (x: number, z: number) => number, x: number, z: number, e = 1): { slope: number; normal: [number, number, number] } {
  const dx = (h(x + e, z) - h(x - e, z)) / (2 * e), dz = (h(x, z + e) - h(x, z - e)) / (2 * e);
  const l = Math.hypot(dx, 1, dz);
  return { slope: 1 - 1 / l, normal: [-dx / l, 1 / l, -dz / l] };
}

export interface HeightSampler { (x: number, z: number): number }
export function makeHeightSampler(cfg: WorldConfig, edits: WorldEdits | null, carves: Carve[]): HeightSampler {
  return (x, z) => terrainHeightAt(cfg, edits, carves, x, z);
}

/** Heightmap of a finite world as metres, row by row, for export. */
export function bakeHeightmap(h: HeightSampler, t: TerrainCfg, size: number): { data: Float32Array; min: number; max: number } {
  const data = new Float32Array(size * size);
  let min = Infinity, max = -Infinity;
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    const v = h((i / (size - 1) - 0.5) * t.width, (j / (size - 1) - 0.5) * t.depth);
    data[j * size + i] = v; if (v < min) min = v; if (v > max) max = v;
  }
  return { data, min, max };
}
