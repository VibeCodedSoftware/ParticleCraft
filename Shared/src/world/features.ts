// Everything that shapes the land beyond noise (rivers, lakes, road beds, caves) and the plain mesh data of terrain
// chunks and ribbons. All deterministic and renderer-free. Also what a new world starts with.
import { clamp, lerp, noise3, stream } from './random';
import { baseHeight, chunkBounds, insideWorld, lakeDistance, landHeightAt, newTerrainLayer, slopeAt, TERRAIN_PRESETS, terrainDefaults, terrainHeightAt, type Carve, type HeightSampler } from './terrain';
import { biomeDefaults, groundColor, snowAt, surfaceDefaults } from './biomes';
import { applyWorldStyle, leafDefaults, ROCK_PRESETS, surfaceNets, TREE_PRESETS, voxelize, type MeshData } from './generators';
import { makeLayer } from './scatter';
import { caveChunk, makeCaves, type Caves } from './caves';
import { deepCopy, WORLD_FORMAT, WORLD_VERSION, type CaveCfg, type RoadPath, type TerrainLayer, type TreeCfg, type WorldConfig, type WorldDoc, type WorldEdits } from './document';
import { block, createLogicDocument, event, newId } from '../schema';

/** A new world: realistic look (trees, leaves, grass and rocks of one kind; switch under World look). */
export const defaultConfig = (): WorldConfig => { const c = baseConfig(); applyWorldStyle(c, 'realistic'); return c; };
const baseConfig = (): WorldConfig => ({
  terrain: terrainDefaults(), surface: surfaceDefaults(), biomes: biomeDefaults(), leaves: leafDefaults(),
  trees: deepCopy(TREE_PRESETS), rocks: deepCopy(ROCK_PRESETS),
  layers: [
    // (The very detailed Tree1-8 models are in the library to use on purpose: hundreds of thousands of triangles each.)
    makeLayer({ id: 'l_trees', name: 'Trees', kind: 'tree', sources: ['tree:oak', 'tree:pine', 'tree:birch', 'tree:maple', 'lib:world/trees/StylizedTree1.fbx'], density: 0.5, maxSlope: 0.5, clustering: 0.6, clusterSize: 40, minScale: 0.75, maxScale: 1.3, align: 0.05, avoid: true }),
    makeLayer({ id: 'l_rocks', name: 'Rocks', kind: 'rock', sources: ['rock:boulder', 'rock:stone', 'rock:jagged'], density: 0.35, maxSlope: 0.7, clustering: 0.5, minScale: 0.6, maxScale: 1.6, align: 0.8 }),
    // (Thick and even: a meadow with no bare gaps between tufts. Lower the density for slower computers.)
    makeLayer({ id: 'l_grass', name: 'Grass', kind: 'grass', sources: ['lib:world/grass/RealisticGrass.fbx'], copyGround: true, density: 800, maxSlope: 0.42, clustering: 0, clusterSize: 14, minScale: 0.8, maxScale: 1.3, align: 0.5 }),
  ],
  water: { enabled: true, level: 1.5, waves: 0.3, waveDirection: 20, waveSpeed: 1, color: '#2a7fd4', opacity: 60, foam: true, rivers: 0, riverSeed: 3, riverWidth: 6, riverDepth: 2.5, meander: 0.5, branching: 0, lakes: 0 },
  snow: { enabled: false, coverage: 1, startHeight: 60, blendHeight: 20, maxSlope: 0.35, color: '#eef3f6', onObjects: 0.7, thickness: 0.5, variation: 0.3, seed: 1, fall: 0, footprints: true, footprintDepth: 0.08, footprintSize: 0.35, recovery: 0.5, trackLife: 60, resistance: 0.3 },
  season: { enabled: false, season: 'summer', next: 'autumn', blend: 0, speed: 0, intensity: 1, preserve: 0, brightness: 1, saturation: 1, hue: 0, variation: 0.3, seed: 1, treeLeaves: true, grass: true, bushes: true, flowers: true },
  weather: { type: 'clear', intensity: 0.5, windDirection: 30, windSpeed: 2, windStrength: 1, gusts: 0.3, fog: 0.05, clouds: 0.4, sway: true, grassSway: true, swayAmount: 1 },
  sky: { time: 11, dayNight: true, sunStrength: 3, ambient: 0.6, stars: true },
  optimize: { profile: 'balanced', lodDistance: 120, cull: 600, grassDistance: 170, impostors: true },
  spawns: [],
  cave: { enabled: false, seed: 1, x: 0, y: 6, z: 0, size: 70, tunnels: 6, tunnelWidth: 4, chamber: 9, roughness: 0.5, branching: 0.4, voxel: 1, stalactites: 0.3, style: 'smooth', depth: 36, entrances: 0.3 },
  voxel: { enabled: false, size: 1, smooth: false, target: 'terrain' },
});

export const emptyEdits = (): WorldEdits => ({ cell: 2, height: {}, paint: {}, density: {}, snow: {}, biome: {}, holes: {}, removed: [] });

export function newWorld(name: string): WorldDoc {
  const t = new Date().toISOString();
  const logic = createLogicDocument(name, 'worldcraft', 'xz');
  logic.sheets[0].name = 'World Ecosystem';
  logic.sheets[0].events = [event([block('world.on_generate')], [])];
  return { format: WORLD_FORMAT, schemaVersion: WORLD_VERSION, id: name.replace(/[^A-Za-z0-9]+/g, '-').toLowerCase() + '-' + Date.now().toString(36), name, created: t, modified: t, config: defaultConfig(), edits: emptyEdits(), placed: [], roads: [], particles: [], sounds: [], logic, assets: [], favorites: [], presets: {} };
}

/** The Infinite Noise Terrain preset: every step visible and editable as bricks. */
export function infiniteNoiseEvents() {
  return [event([block('world.on_generate')], [
    block('terrain.generator', { preset: 'Infinite Noise' }),
    block('terrain.noise', { scale: '260', intensity: '1', octaves: '7', lacunarity: '2.03', gain: '0.5', warp: '0.35' }),
    block('terrain.height', { height: '80', base: '10' }),
    block('terrain.shape', { sharpness: '0.55', valley: '0.5', plateau: '0', terraces: '0', canyon: '0', island: '0', flatten: '0' }),
    block('terrain.erosion', { amount: '0.6' }),
    block('terrain.smoothing', { amount: '0' }),
    block('terrain.biome', { enabled: true, size: '420', temperature: '0', moisture: '0', transition: '0.12' }),
    block('terrain.endless', { on: true }),
    block('terrain.chunk_loading', { view: '5' }),
    block('world.random_seed', { what: 'terrain', seed: '12345' }),
  ])];
}

/** World Ecosystem: seasons drive foliage, snow and falling things through ordinary bricks the user can edit. */
export function ecosystemEvents() {
  const on = (season: string, ...actions: ReturnType<typeof block>[]) => event([block('world.if_season', { season })], actions);
  return [event([block('world.on_generate')], [block('season.control', { season: 'autumn', enabled: true })], [
    on('spring', block('leaf.browning', { amount: '0' }), block('snow.generator', { enabled: false, coverage: '0' })),
    on('summer', block('leaf.browning', { amount: '0' }), block('snow.generator', { enabled: false, coverage: '0' })),
    on('autumn', block('leaf.control', { healthy: '15', yellow: '30', orange: '30', brown: '25', variation: '0.3' }), block('snow.generator', { enabled: false, coverage: '0' })),
    on('winter', block('leaf.browning', { amount: '1' }), block('snow.generator', { enabled: true, coverage: '1' }), block('snow.terrain', { start: '-100', blend: '10', slope: '0.5' }), block('snow.fall', { amount: '0.5' }), block('weather.control', { type: 'snow', intensity: '0.5' })),
  ])];
}
export const newId_ = newId;

/**
 * A tree species' construction as logic bricks, with its current values: trunk, branches, shape, forks, growth forces,
 * leaves, leaf type, roots, age and individuals, in the order they build the tree. Edit a brick and the species follows.
 */
export function treeLogicEvent(id: string, c: TreeCfg) {
  const s = (v: unknown) => String(v ?? '');
  return event([block('world.on_generate')], [
    block('tree.trunk', { tree: id, height: s(c.height), trunk: s(c.trunk), taper: s(c.taper) }),
    block('tree.branch', { tree: id, count: s(c.branches), levels: s(c.levels), angle: s(c.angle), length: s(c.length), random: s(c.randomness) }),
    block('tree.shape', { tree: id, asymmetry: s(c.asymmetry ?? 0), curvature: s(c.curvature ?? 0), spread: s(c.leafSpread) }),
    block('tree.fork', { tree: id, chance: s(c.splitChance ?? 0.2), angle: s(c.splitAngle ?? 32), snap: s(c.breakChance ?? 0) }),
    block('tree.growth', { tree: id, light: s(c.light ?? 0.5), up: s(c.upAttraction ?? 0.15), gravity: s(c.gravity ?? 0.2), stiffness: s(c.stiffness ?? 0.35), phyllotaxis: s(c.phyllotaxis ?? 137.5) }),
    block('tree.leaf', { tree: id, size: s(c.leafSize), density: s(c.leafDensity), spread: s(c.leafSpread), canopy: c.canopy, color: c.leaf }),
    ...(c.leafStyle ? [block('tree.leaf_type', { tree: id, style: c.leafStyle })] : []),
    block('tree.root', { tree: id, roots: s(c.roots) }),
    block('tree.variation', { tree: id, age: s(c.age) }),
    block('tree.individuals', { tree: id, count: s(c.variants ?? 6) }),
  ]);
}

// ---------------------------------------------------------------------------------- rivers, lakes, road beds

/** `levels`: the water's surface at each point; `widths`: how wide the water is there (its shore is where it meets the bank). */
export interface RiverPath { points: [number, number][]; levels: number[]; widths: number[] }
/** `radius`: the water's reach (the shore is where it meets the land); `shape`: how far, round a ring of angles. */
export interface LakeShape { x: number; z: number; radius: number; level: number; shape: number[] }
export interface Features { rivers: RiverPath[]; lakes: LakeShape[]; carves: Carve[]; /** Caves through the world, when on. */ caves: Caves | null;
  /** The surface of a river or lake here, or -Infinity. */ water: (x: number, z: number) => number;
  /** Is this spot on a road? */ onRoad: (x: number, z: number) => boolean;
  /** The nearest road within 3 m of its edge: distance from that edge (negative on it) and whether it is ploughed. */ roadEdge: (x: number, z: number) => { d: number; ploughed: boolean } | null }

/** Rivers run downhill from high ground, chosen by the river seed. Endless worlds keep them near the origin. */
export function buildFeatures(cfg: WorldConfig, roads: RoadPath[], edits: WorldEdits | null = null): Features {
  const t = cfg.terrain, w = cfg.water;
  // (The land as it is, with an applied node graph and erosion runs: rivers routed over the generated land alone ran
  // through the air or cut gashes wherever those had changed it.)
  const h0 = edits?.grids?.length ? (x: number, z: number) => landHeightAt(cfg, edits, x, z) : (x: number, z: number) => baseHeight(t, x, z);
  // Rivers read the land's broad shape, so small bumps don't turn them into a ridge.
  const broad = (x: number, z: number) => { const r = 14; return (h0(x, z) + h0(x + r, z) + h0(x - r, z) + h0(x, z + r) + h0(x, z - r)) / 5; };
  const span = t.endless ? 800 : Math.min(t.width, t.depth);
  const rivers: RiverPath[] = [], lakes: LakeShape[] = [], carves: Carve[] = [];
  const stop = w.enabled ? w.level - 0.5 : -1e9;
  const riverCut: { core: number; F: number; depth: number }[] = [];
  /** A lake: its uneven shore, the water's reach, and the land carved to hold it. */
  const addLake = (bx: number, bz: number, R: number, level: number, key: number) => {
    if (w.enabled && level < w.level + 0.3) return; // (it would be part of the sea)
    const r = stream(w.riverSeed, 'lakeshape', key);
    const N = 24, ph = r.next() * 10, shape = Array.from({ length: N }, (_, i) => { const a = (i / N) * Math.PI * 2; return clamp(1 + 0.22 * Math.sin(a * 2 + ph) + 0.12 * Math.sin(a * 3 - ph * 1.7) + r.range(-0.06, 0.06), 0.65, 1.4); });
    const core = R * 0.8, F = Math.max(3, R * 0.3);
    lakes.push({ x: bx, z: bz, radius: core + F * 0.8, level, shape });
    carves.push({ points: [[bx - 0.01, bz], [bx + 0.01, bz]], width: core * 2, falloff: F * 2, water: [level], depth: 2 + R * 0.08, lake: { x: bx, z: bz, shape }, strength: 1 });
  };
  const trace = (sx: number, sz: number, seedKey: number, width: number, depth: number) => {
    const r = stream(w.riverSeed, 'river', seedKey);
    const pts: [number, number][] = [[sx, sz]];
    const step = 8;
    let x = sx, z = sz, ang = r.next() * Math.PI * 2, low = Infinity, sea = false;
    for (let i = 0; i < 500; i++) {
      // Downhill, with a slow swing for the meander, and never straight back.
      const e = 10, gx = broad(x + e, z) - broad(x - e, z), gz = broad(x, z + e) - broad(x, z - e);
      const down = Math.atan2(-gz, -gx);
      let d = down - ang; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2;
      ang += clamp(d, -0.7, 0.7) + Math.sin(i * 0.3 + seedKey) * 0.22 * w.meander + r.range(-0.06, 0.06);
      x += Math.cos(ang) * step; z += Math.sin(ang) * step;
      const here = h0(x, z);
      // Water doesn't climb: a river that would have to cut a trench through a ridge ends in the hollow before it.
      if (here > low + Math.max(14, depth * 6)) break;
      low = Math.min(low, here);
      pts.push([x, z]);
      if (here < stop) { sea = true; break; }
      if (!t.endless && !insideWorld(t, x, z)) { sea = true; break; }
      if (Math.abs(x) > span && Math.abs(z) > span) break;
      if (w.branching > 0 && seedKey < 100 && i > 25 && i % 40 === 0 && r.chance(clamp(w.branching))) trace(x, z, seedKey * 13 + 100 + i, width * 0.6, depth * 0.7);
    }
    if (pts.length < 6) return;
    // The surface only ever goes down along the river, so the water can't run uphill.
    const levels: number[] = []; let lv = Infinity;
    for (const [px, pz] of pts) { lv = Math.min(lv, h0(px, pz) - depth * 0.35); levels.push(lv); }
    // Water fills the channel and reaches up the bank to where it meets the land: the land is cut to hold it (below, once
    // every lake is known, so a river ends where it meets one).
    const core = width * 0.5, F = Math.max(2.5, width * 0.7);
    rivers.push({ points: pts, levels, widths: pts.map(() => (core + F * 0.8) * 2) });
    riverCut.push({ core, F, depth });
    // A river that doesn't reach the sea ends in a lake, in the hollow that stopped it: rivers and lakes are one water.
    if (!sea && pts.length > 10) { const [ex, ez] = pts[pts.length - 1]; addLake(ex, ez, Math.max(9, width * 2.4), levels[levels.length - 1], seedKey + 900); }
  };
  for (let k = 0; k < Math.round(w.rivers); k++) {
    const r = stream(w.riverSeed, 'riverstart', k);
    // Rivers rise in the hills, from springs partway up (not on the summits, where they would cut a gash straight down
    // a mountain face): of a few tries, the one nearest two thirds of the way up the land's range.
    const tries = Array.from({ length: 24 }, () => { const x = r.range(-span / 2, span / 2) * 0.9, z = r.range(-span / 2, span / 2) * 0.9; return { x, z, h: h0(x, z) }; });
    const lo = Math.min(...tries.map((p) => p.h)), hi = Math.max(...tries.map((p) => p.h)), want = lo + (hi - lo) * 0.62;
    const best = tries.reduce((a, p) => (Math.abs(p.h - want) < Math.abs(a.h - want) ? p : a));
    const bx = best.x, bz = best.z;
    trace(bx, bz, k, w.riverWidth, w.riverDepth);
  }
  for (let k = 0; k < Math.round(w.lakes); k++) {
    const r = stream(w.riverSeed, 'lake', k);
    let bx = 0, bz = 0, best = Infinity;
    for (let n = 0; n < 20; n++) { const x = r.range(-span / 2, span / 2) * 0.8, z = r.range(-span / 2, span / 2) * 0.8; const { slope } = slopeAt((a, b) => h0(a, b), x, z, 6); if (slope < best) { best = slope; bx = x; bz = z; } }
    const radius = r.range(14, 34);
    // Its level: the land round it, a little below.
    let sum = 0; for (let a = 0; a < 12; a++) sum += h0(bx + Math.cos(a / 12 * Math.PI * 2) * radius, bz + Math.sin(a / 12 * Math.PI * 2) * radius);
    addLake(bx, bz, radius, Math.min(sum / 12, h0(bx, bz)) - 0.3, k);
  }
  // Rivers meet the water they flow into: one ends where it enters a lake or the sea, its surface coming down to that
  // water's level over its last stretch, so no river runs on top of a lake as a strip of higher water.
  rivers.forEach((r, n) => {
    let end = r.points.length - 1, target = -Infinity;
    for (let i = 3; i < r.points.length; i++) {
      const [x, z] = r.points[i];
      const lake = lakes.find((l) => lakeDistance({ x: l.x, z: l.z, shape: l.shape }, x, z).d <= l.radius * 0.9);
      const sea = w.enabled && r.levels[i] <= w.level + 0.15;
      if (lake || sea) { end = i; target = lake ? lake.level : w.level; break; }
    }
    if (target > -Infinity) {
      r.points = r.points.slice(0, end + 1); r.levels = r.levels.slice(0, end + 1); r.widths = r.widths.slice(0, end + 1);
      // (Only ever down: a lake higher than the river just covers its end.)
      const k = Math.min(8, r.levels.length - 1), from = r.levels.length - 1 - k;
      for (let i = from; i < r.levels.length; i++) { const t = (i - from) / Math.max(1, k); r.levels[i] = Math.max(Math.min(r.levels[i], lerp(r.levels[from], target, t * t * (3 - 2 * t))), Math.min(target, r.levels[i])); }
    }
    const c = riverCut[n];
    carves.push({ points: r.points, width: c.core * 2, falloff: c.F * 2, water: r.levels, depth: c.depth, strength: 1 });
  });
  for (const road of roads) {
    if (road.points.length < 2 || road.conform <= 0) continue;
    // Grade: heights smoothed along the road, more for a higher conform value.
    const raw = road.points.map(([x, z]) => h0(x, z) + 0.15);
    const passes = Math.round(road.conform * 40);
    let lv = raw;
    for (let p = 0; p < passes; p++) lv = lv.map((v, i) => (lv[Math.max(0, i - 1)] + v + lv[Math.min(lv.length - 1, i + 1)]) / 3);
    carves.push({ points: road.points, width: road.width * 1.15, falloff: road.width * (1 + road.conform * 1.6), level: lv, strength: road.conform > 0.05 ? 1 : road.conform * 20 });
  }
  const caves = cfg.cave.enabled ? makeCaves(cfg) : null;
  const roadEdge = roadSampler(roads);
  return { rivers, lakes, carves, caves, water: waterSampler(rivers, lakes), onRoad: (x, z) => { const e = roadEdge(x, z); return !!e && e.d < 0.4; }, roadEdge };
}

/**
 * The nearest road within a few metres: how far from its edge (negative on the road itself), and whether it is a
 * ploughed road (its snow pushed to the sides) or one left under the snow.
 */
function roadSampler(roads: RoadPath[]): Features['roadEdge'] {
  const segs: { ax: number; az: number; bx: number; bz: number; half: number; ploughed: boolean }[] = [];
  for (const r of roads) for (let i = 0; i + 1 < r.points.length; i++) segs.push({ ax: r.points[i][0], az: r.points[i][1], bx: r.points[i + 1][0], bz: r.points[i + 1][1], half: r.width / 2, ploughed: r.snow !== 'covered' });
  if (!segs.length) return () => null;
  const reach = 3, cell = 24, map = new Map<number, number[]>(), keyOf = (a: number, b: number) => (a + 32768) * 65536 + (b + 32768);
  segs.forEach((s, n) => {
    const R = s.half + reach;
    for (let a = Math.floor((Math.min(s.ax, s.bx) - R) / cell); a <= Math.floor((Math.max(s.ax, s.bx) + R) / cell); a++) for (let b = Math.floor((Math.min(s.az, s.bz) - R) / cell); b <= Math.floor((Math.max(s.az, s.bz) + R) / cell); b++) {
      const k = keyOf(a, b); let l = map.get(k); if (!l) { l = []; map.set(k, l); } l.push(n);
    }
  });
  return (x, z) => {
    const list = map.get(keyOf(Math.floor(x / cell), Math.floor(z / cell)));
    if (!list) return null;
    let best: { d: number; ploughed: boolean } | null = null;
    for (const n of list) {
      const s = segs[n], dx = s.bx - s.ax, dz = s.bz - s.az, t = clamp(((x - s.ax) * dx + (z - s.az) * dz) / (dx * dx + dz * dz || 1e-6));
      const d = Math.hypot(x - s.ax - dx * t, z - s.az - dz * t) - s.half;
      if (d < reach && (!best || d < best.d)) best = { d, ploughed: s.ploughed };
    }
    return best;
  };
}

/** Where rivers and lakes are, quickly: their segments and lakes filed by grid cell. */
function waterSampler(rivers: RiverPath[], lakes: LakeShape[]): Features['water'] {
  if (!rivers.length && !lakes.length) return () => -Infinity;
  // (A number for each cell, not a string: this is asked for every blade of grass.)
  const cell = 32, map = new Map<number, number[]>(), keyOf = (a: number, b: number) => (a + 32768) * 65536 + (b + 32768);
  const items: { kind: 'r' | 'l'; r?: RiverPath; i?: number; l?: LakeShape }[] = [];
  const file = (ax: number, az: number, bx: number, bz: number, reach: number, n: number) => {
    for (let a = Math.floor((Math.min(ax, bx) - reach) / cell); a <= Math.floor((Math.max(ax, bx) + reach) / cell); a++) for (let b = Math.floor((Math.min(az, bz) - reach) / cell); b <= Math.floor((Math.max(az, bz) + reach) / cell); b++) {
      const k = keyOf(a, b); let l = map.get(k); if (!l) { l = []; map.set(k, l); } l.push(n);
    }
  };
  for (const r of rivers) for (let i = 0; i + 1 < r.points.length; i++) { items.push({ kind: 'r', r, i }); file(r.points[i][0], r.points[i][1], r.points[i + 1][0], r.points[i + 1][1], r.widths[i] / 2, items.length - 1); }
  for (const l of lakes) { items.push({ kind: 'l', l }); const reach = l.radius * Math.max(...l.shape); file(l.x, l.z, l.x, l.z, reach, items.length - 1); }
  return (x, z) => {
    const list = map.get(keyOf(Math.floor(x / cell), Math.floor(z / cell)));
    if (!list) return -Infinity;
    let top = -Infinity;
    for (const n of list) {
      const it = items[n];
      if (it.kind === 'l') { const l = it.l!; if (lakeDistance({ x: l.x, z: l.z, shape: l.shape }, x, z).d <= l.radius) top = Math.max(top, l.level); continue; }
      const r = it.r!, i = it.i!, [ax, az] = r.points[i], [bx, bz] = r.points[i + 1];
      const dx = bx - ax, dz = bz - az, t = clamp(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1e-6));
      if (Math.hypot(x - ax - dx * t, z - az - dz * t) <= r.widths[i] / 2) top = Math.max(top, lerp(r.levels[i], r.levels[i + 1], t));
    }
    return top;
  };
}

/** A river's water: a strip at its surface, a few vertices across so waves can bend it. World-space UVs (4 m a repeat). */
export function riverWaterMesh(r: RiverPath, across = 6): MeshData {
  const m: MeshData = { positions: [], normals: [], colors: [], uvs: [], indices: [] };
  const pts = r.points, row = across + 1;
  // (UVs run along the river, V downstream in 4 m steps, so ripples can be made to flow with it.)
  let along = 0;
  const prev: [number, number][] = [];
  for (let i = 0; i < pts.length; i++) {
    if (i > 0) along += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    // (Its direction over a few points either side, so a kink doesn't swing a whole row round.)
    const a = pts[Math.max(0, i - 2)], b = pts[Math.min(pts.length - 1, i + 2)];
    const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1, tx = dx / l, tz = dz / l, nx = -tz, nz = tx, hw = r.widths[i] / 2;
    // (The far ends reach on a little, under the bank or into the lake or sea they join.)
    const ext = i === 0 ? -hw * 0.6 : i === pts.length - 1 ? hw * 0.6 : 0, ex = tx * ext, ez = tz * ext;
    for (let s = 0; s <= across; s++) {
      const k = (s / across) * 2 - 1;
      let x = pts[i][0] + nx * hw * k + ex, z = pts[i][1] + nz * hw * k + ez;
      // On the inside of a tight bend the edge would run backwards and fold the water over itself (a pinched star of
      // ripples): it's kept moving downstream instead.
      if (i > 0) { const p = prev[s], adv = (x - p[0]) * tx + (z - p[1]) * tz; if (adv < 0.25) { x += tx * (0.25 - adv); z += tz * (0.25 - adv); } }
      prev[s] = [x, z];
      m.positions.push(x, r.levels[i], z); m.normals.push(0, 1, 0); m.colors.push(1, 1, 1); m.uvs.push((k * hw) / 4, along / 4);
    }
    if (i + 1 < pts.length) for (let s = 0; s < across; s++) { const q = i * row + s; m.indices.push(q, q + 1, q + row, q + 1, q + row + 1, q + row); }
  }
  return m;
}

/**
 * Per vertex of riverWaterMesh (same layout): across the river (-1 bank … 1 bank), half its width (m), metres from its
 * start and to its end, and how much of it shows where it runs into a lake or the sea (1 → 0 going in, so it melts
 * into that water instead of lying over it in a second layer). `capStart` / `capEnd`: whether the ends are rounded off
 * (a source on land, or an end that doesn't reach other water).
 */
export function riverWaterAttrs(r: RiverPath, lakes: LakeShape[], seaLevel: number | null, across = 6) {
  const pts = r.points, n = pts.length, row = across + 1;
  const k = new Float32Array(n * row), hw = new Float32Array(n * row), from = new Float32Array(n * row), to = new Float32Array(n * row), show = new Float32Array(n * row);
  // Metres along, the ends' reach included.
  const along: number[] = []; let acc = (r.widths[0] / 2) * 0.6;
  for (let i = 0; i < n; i++) { if (i) acc += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); along.push(acc); }
  const total = acc + (r.widths[n - 1] / 2) * 0.6;
  /** How far (m) the point is inside a lake or the sea (0: not in one). */
  const inside = (x: number, z: number, level: number) => {
    let d = 0;
    for (const l of lakes) {
      if (Math.abs(l.level - level) > 2.5) continue;
      const q = lakeDistance(l, x, z); if (q.d < l.radius) d = Math.max(d, (l.radius - q.d) * q.k);
    }
    if (seaLevel !== null && level <= seaLevel + 0.15) d = Math.max(d, 50);
    return d;
  };
  const endIn = inside(pts[n - 1][0], pts[n - 1][1], r.levels[n - 1]) > 0, startIn = inside(pts[0][0], pts[0][1], r.levels[0]) > 0;
  for (let i = 0; i < n; i++) {
    const h = r.widths[i] / 2, fadeLen = Math.max(3, h * 1.5);
    const a = pts[Math.max(0, i - 2)], b = pts[Math.min(n - 1, i + 2)], dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1;
    for (let s = 0; s <= across; s++) {
      const v = i * row + s, kk = (s / across) * 2 - 1;
      const x = pts[i][0] - (dz / l) * h * kk, z = pts[i][1] + (dx / l) * h * kk;
      k[v] = kk; hw[v] = h; from[v] = i === 0 ? 0 : along[i]; to[v] = i === n - 1 ? 0 : total - along[i];
      show[v] = 1 - smoothstep01(inside(x, z, r.levels[i]) / fadeLen);
    }
  }
  return { k, hw, from, to, show, capStart: !startIn, capEnd: !endIn };
}
const smoothstep01 = (t: number) => { const x = clamp(t); return x * x * (3 - 2 * x); };

/** A lake's water: a disc out to its uneven reach, in rings so waves can bend it. World-space UVs. */
export function lakeWaterMesh(l: LakeShape, segments = 48, rings = 6): MeshData {
  const m: MeshData = { positions: [], normals: [], colors: [], uvs: [], indices: [] };
  const lk = { x: l.x, z: l.z, shape: l.shape };
  m.positions.push(l.x, l.level, l.z); m.normals.push(0, 1, 0); m.colors.push(1, 1, 1); m.uvs.push(l.x / 4, l.z / 4);
  for (let q = 1; q <= rings; q++) for (let s = 0; s < segments; s++) {
    const a = (s / segments) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
    const k = lakeDistance(lk, l.x + ca, l.z + sa).k, rr = (q / rings) * l.radius * k;
    const x = l.x + ca * rr, z = l.z + sa * rr;
    m.positions.push(x, l.level, z); m.normals.push(0, 1, 0); m.colors.push(1, 1, 1); m.uvs.push(x / 4, z / 4);
  }
  for (let s = 0; s < segments; s++) m.indices.push(0, 1 + ((s + 1) % segments), 1 + s);
  for (let q = 1; q < rings; q++) for (let s = 0; s < segments; s++) {
    const a = 1 + (q - 1) * segments + s, b = 1 + (q - 1) * segments + ((s + 1) % segments), c = a + segments, d = b + segments;
    m.indices.push(a, b, d, a, d, c);
  }
  return m;
}

/** The world's height everywhere: base, carves, hand sculpting, smoothing. */
export function worldHeight(cfg: WorldConfig, edits: WorldEdits | null, f: Features): HeightSampler {
  const raw: HeightSampler = (x, z) => terrainHeightAt(cfg, edits, f.carves, x, z);
  const s = clamp(cfg.terrain.smooth);
  if (s <= 0) return raw;
  const r = 2 + s * 10;
  return (x, z) => lerp(raw(x, z), (raw(x + r, z) + raw(x - r, z) + raw(x, z + r) + raw(x, z - r)) / 4, s);
}

/** Road's ribbon or river's: vertices follow the ground (or the given level) just above it. */
export function ribbonMesh(points: [number, number][], width: (i: number) => number, y: (x: number, z: number, i: number) => number, color: [number, number, number]): MeshData {
  const m: MeshData = { positions: [], normals: [], colors: [], uvs: [], indices: [] };
  let along = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[Math.max(0, i - 1)], b = points[Math.min(points.length - 1, i + 1)];
    const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1, nx = -dz / l, nz = dx / l, hw = width(i) / 2;
    if (i) along += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
    for (const s of [-1, 1]) {
      const x = points[i][0] + nx * hw * s, z = points[i][1] + nz * hw * s;
      m.positions.push(x, y(x, z, i), z); m.normals.push(0, 1, 0); m.colors.push(color[0], color[1], color[2]); m.uvs.push(s * 0.5 + 0.5, along / Math.max(1, hw * 2));
    }
    if (i + 1 < points.length) { const k = i * 2; m.indices.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
  }
  return m;
}

/** Road surfaces: plain colour (exports, far away) and the pattern the view draws on it. */
export const ROAD_KINDS: Record<string, { color: string; width: number; surface: RoadSurface }> = {
  dirt: { color: '#7a6248', width: 4, surface: 'dirt' }, gravel: { color: '#8e8a82', width: 5, surface: 'gravel' }, asphalt: { color: '#3d3f43', width: 7, surface: 'asphalt' }, highway: { color: '#34363a', width: 12, surface: 'highway' },
  'mountain road': { color: '#5c5a55', width: 5, surface: 'gravel' }, 'forest trail': { color: '#5e4e38', width: 2, surface: 'trail' }, footpath: { color: '#a69676', width: 1.5, surface: 'trail' }, boardwalk: { color: '#7d5c38', width: 2.5, surface: 'planks' }, stone: { color: '#8a8780', width: 3.5, surface: 'flagstone' },
  cobblestone: { color: '#7b7670', width: 4, surface: 'cobble' }, brick: { color: '#8f4e3a', width: 4, surface: 'brick' }, sand: { color: '#cdb98a', width: 4, surface: 'sand' }, mud: { color: '#5a4630', width: 4, surface: 'mud' }, concrete: { color: '#9b9a96', width: 6, surface: 'concrete' }, 'snow path': { color: '#e6ecf0', width: 3, surface: 'snow' },
};
export type RoadSurface = 'dirt' | 'gravel' | 'asphalt' | 'highway' | 'trail' | 'planks' | 'flagstone' | 'cobble' | 'brick' | 'sand' | 'mud' | 'concrete' | 'snow';

/** A smooth path through hand-drawn points. */
export function smoothPath(points: [number, number][], every = 4): [number, number][] {
  if (points.length < 3) return points;
  const at = (i: number) => points[Math.max(0, Math.min(points.length - 1, i))];
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < points.length; i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    const n = Math.max(1, Math.round(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / every));
    for (let k = 0; k < n; k++) {
      const t = k / n, t2 = t * t, t3 = t2 * t;
      out.push([
        0.5 * (2 * p1[0] + (p2[0] - p0[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (3 * p1[0] - p0[0] - 3 * p2[0] + p3[0]) * t3),
        0.5 * (2 * p1[1] + (p2[1] - p0[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (3 * p1[1] - p0[1] - 3 * p2[1] + p3[1]) * t3),
      ]);
    }
  }
  out.push(points[points.length - 1]);
  return out;
}

// ---------------------------------------------------------------------------------- terrain chunks

/**
 * Picks a terrain preset for a world. Blank is a truly empty canvas (nothing scattered, no water or rivers, no biomes);
 * Islands needs a sea to stand in; leaving Blank brings the scatter layers back.
 */
/** Whole scenes in one go (land, layers, water, ground, plants), each a starting point to change. */
export const SCENE_TEMPLATES = ['Rocky coast', 'Desert mountains'] as const;
export function applySceneTemplate(c: WorldConfig, name: typeof SCENE_TEMPLATES[number]) {
  const L = (type: TerrainLayer['type'], n: number, o: Partial<TerrainLayer>): TerrainLayer => ({ ...newTerrainLayer(type, n), ...o });
  const t = c.terrain;
  t.endless = false; t.island = 0; t.islands = 0; t.canyon = 0; t.terraces = 0; t.plateau = 0; t.flatten = 0;
  if (t.planet) t.planet.enabled = false;
  c.snow.enabled = false; c.season.enabled = false; c.weather.type = 'clear'; c.weather.fog = 0;
  // (A few high clouds: low ones would sit over a scene this size like fog.)
  c.weather.clouds = 0.12; c.weather.cloudHeight = Math.max(c.weather.cloudHeight ?? 0, 220);
  const layer = (id: string) => c.layers.find((l) => l.id === id);
  if (name === 'Rocky coast') {
    // Three bands, from the sea up: a wide flat beach of pale sand; an eroded rocky hill (an escarpment of fused,
    // fractured rock, grass on its ledges, rubble at its foot); and a forest on the level ground above. Clear turquoise
    // shallows with a line of foam, a few rocks standing in the surf.
    Object.assign(t, { preset: 'Rocky coast', width: 512, depth: 512, resolution: 64, height: 2.5, baseHeight: -8, noiseScale: 120, octaves: 5, sharpness: 0.1, valleyDepth: 0.1, erosion: 0.2, warp: 0.3 });
    t.layers = [
      // (The seabed falls away just off the beach, so the surf breaks on a line, not over a wide flat.)
      L('ramp', 0, { name: 'Sea shelf', height: 6, scale: 14, direction: 90, offset: -135 }),
      L('ramp', 1, { name: 'Beach slope', height: 2.5, scale: 260, direction: 90, offset: -60 }),
      L('ramp', 2, { name: 'Escarpment', height: 15, scale: 20, direction: 90, offset: 15, amount: 0.6 }),
      // The rocky hill: nearly continuous fractured rock over the escarpment's face and lip, tiered, with steep broken
      // sides (not on the beach below, not in the forest above).
      // (Broader and lower than before: big weathered masses, not a row of spikes.)
      L('outcrops', 3, { name: 'Eroded rocky hill', blend: 'add', height: 6, scale: 42, minHeight: 1.8, maxHeight: 14, fade: 2.5, amount: 0.8, paint: 'rock' }),
      L('outcrops', 4, { name: 'Rocks in the surf', blend: 'add', height: 3, scale: 14, minHeight: -2, maxHeight: 0.6, fade: 0.6, amount: 0.3, patchiness: 0.65, patchScale: 120 }),
      L('hills', 5, { name: 'Forest floor', height: 3, scale: 70, minHeight: 15, maxHeight: 60, fade: 3 }),
    ];
    Object.assign(c.water, { enabled: true, level: 0, rivers: 0, lakes: 0, color: '#38c3c0', deepColor: '#0c6a7c', clarity: 0.85, foam: true, foamWidth: 1.4, waves: 0.35 });
    Object.assign(c.surface, { sand: '#e8dcc2', beachWidth: 2.6, rock: '#86817a', dirt: '#7a6a52', slopeRock: 0.3, greens: true, greenA: '#3f5f2a', greenB: '#5d7a35', greenC: '#7f8f45' });
    // One temperate meadow (no biome patchwork): the grass colour and its random greens.
    c.biomes.enabled = false; c.surface.grass = '#5b7a34';
    // Forest only on the level ground above the hill; grass on the hill's ledges and under the trees.
    // Forest: mostly pines with some broadleaf, in stands and clearings, of mixed ages (not one even carpet).
    const tr = layer('l_trees'); if (tr) Object.assign(tr, { enabled: true, sources: ['tree:pine', 'tree:pine', 'tree:pine', 'tree:oak', 'tree:birch'], density: 2.1, minHeight: 15.5, maxSlope: 0.35, clustering: 0.6, clusterSize: 34, minScale: 0.6, maxScale: 1.45 });
    // Grass: thick on the level ground above, and up onto the hill's gentler ledges.
    const gr = layer('l_grass'); if (gr) Object.assign(gr, { enabled: true, minHeight: 6, maxSlope: 0.5, density: Math.max(gr.density, 320), clustering: 0.15 });
    // The hill's rock masses: big weathered boulders crowded along the escarpment, overlapping into one fused mass
    // with overhangs and hollows (the ground itself can't overhang), turned so they lean out over the beach.
    let mass = layer('l_coast_masses');
    if (!mass) { mass = makeLayer({ id: 'l_coast_masses', name: 'Rock masses', kind: 'rock', sources: ['rock:boulder', 'rock:jagged', 'rock:boulder'] }); c.layers.push(mass); }
    // (Only on the escarpment's face: the steep ground. On the beach they were just loose boulders.)
    Object.assign(mass, { name: 'Rock masses', enabled: true, density: 5, minHeight: 2.5, maxHeight: 15, minSlope: 0.3, maxSlope: 3, clustering: 0.6, clusterSize: 22, minScale: 3, maxScale: 7, align: 0.45, randomRotation: true, avoid: false });
    // Loose stones: a few on the beach and in the surf.
    const rk = layer('l_rocks'); if (rk) Object.assign(rk, { enabled: true, density: 0.25, minHeight: -1.5, maxHeight: 3, minScale: 0.25, maxScale: 1.1 });
    // Rubble fallen from the hill: clumps of small rocks at its foot and on its lower face (sizes in metres, like the
    // stones round a real escarpment, not boulders the size of houses).
    let big = layer('l_coast_rocks');
    if (!big) { big = makeLayer({ id: 'l_coast_rocks', name: 'Rubble', kind: 'rock', sources: ['rock:jagged', 'rock:stone', 'rock:boulder'] }); c.layers.push(big); }
    Object.assign(big, { name: 'Rubble', enabled: true, density: 3, minHeight: 1.5, maxHeight: 7, maxSlope: 1.2, clustering: 0.9, clusterSize: 9, minScale: 0.3, maxScale: 1.8, align: 0.7, randomRotation: true });
  } else {
    // Sand sea with wind-shaped dunes, eroded rocky ranges rising out of it, scattered outcrops; dry, no plants.
    Object.assign(t, { preset: 'Desert mountains', width: 1024, depth: 1024, height: 8, baseHeight: 6, noiseScale: 160, octaves: 4, sharpness: 0.4, valleyDepth: 0.1, erosion: 0.7, warp: 0.5 });
    t.layers = [
      L('dunes', 0, { name: 'Dunes', height: 3.5, scale: 46, direction: 35 }),
      L('mountains', 1, { name: 'Ranges', blend: 'max', height: 120, scale: 300, patchiness: 0.55, patchScale: 520 }),
      // Dark crags: the ranges' rock bare from their lower slopes up, in tiers, so they stand out against the sand.
      L('outcrops', 2, { name: 'Rock tiers', height: 7, scale: 60, minHeight: 14, maxHeight: 400, fade: 8, amount: 0.85 }),
    ];
    c.water.enabled = false; c.water.rivers = 0; c.water.lakes = 0;
    Object.assign(c.surface, { grass: '#cfae7c', dirt: '#b88f5e', rock: '#6a5040', sand: '#dcc193', gravel: '#9d8366', greens: false, slopeRock: 0.2 });
    c.biomes.temperature = 0.6; c.biomes.moisture = -0.7;
    for (const l of c.layers) if (l.kind !== 'rock') l.enabled = false;
    const rk = layer('l_rocks'); if (rk) Object.assign(rk, { enabled: true, density: 0.25, minHeight: -100, maxHeight: 1000 });
  }
}

export function applyTerrainPreset(c: WorldConfig, name: string) {
  const was = c.terrain.preset;
  Object.assign(c.terrain, TERRAIN_PRESETS[name], { preset: name });
  if (name === 'Blank') {
    for (const l of c.layers) l.enabled = false;
    for (const s of c.spawns) s.enabled = false;
    c.water.enabled = false; c.water.rivers = 0; c.water.lakes = 0; c.biomes.enabled = false; c.snow.enabled = false;
  } else {
    if (was === 'Blank') { for (const l of c.layers) l.enabled = true; for (const s of c.spawns) s.enabled = true; }
    if (name === 'Islands') { c.water.enabled = true; c.water.level = Math.max(c.terrain.baseHeight * 0.45, 2); c.water.rivers = 0; }
    // A desert is more than its shape: sand everywhere in wind-shaped dunes, bare rock, no meadow, trees or water. (It
    // only changed the shape, so it came out as green hills like any other preset.)
    if (name === 'Desert') {
      c.terrain.layers = [...(c.terrain.layers ?? []).filter((l) => l.name !== 'Desert dunes'), { ...newTerrainLayer('dunes', 0), name: 'Desert dunes', height: 3, scale: 42, direction: 35 }];
      Object.assign(c.surface, { grass: '#d8bd86', dirt: '#c49d68', rock: '#8a6447', sand: '#e0c897', gravel: '#a88d6c', greens: false, slopeRock: 0.35, look: { palette: 'desert', strength: 0.45 } });
      c.biomes.enabled = false;
      c.water.enabled = false; c.water.rivers = 0; c.water.lakes = 0; c.snow.enabled = false;
      for (const l of c.layers) if (['tree', 'grass', 'flower', 'bush'].includes(l.kind)) l.enabled = false;
      const rk = c.layers.find((l) => l.id === 'l_rocks'); if (rk) Object.assign(rk, { enabled: true });
    } else if (was === 'Desert') {
      // Leaving the desert: the meadow, plants and the rest come back.
      const d = defaultConfig();
      c.terrain.layers = (c.terrain.layers ?? []).filter((l) => l.name !== 'Desert dunes');
      c.surface = d.surface; c.biomes.enabled = d.biomes.enabled; c.water.enabled = d.water.enabled; c.water.rivers = d.water.rivers; c.water.lakes = d.water.lakes;
      for (const l of c.layers) if (['tree', 'grass', 'flower', 'bush'].includes(l.kind)) l.enabled = true;
    }
  }
}

/** One chunk: a grid with a skirt, so lower-detail neighbours don't show cracks. Same height function everywhere. */
/** `caveHoles`: open the ground where tunnels reach it (only where the caves themselves are built: near the camera). */
export function chunkMesh(cfg: WorldConfig, edits: WorldEdits | null, f: Features, h: HeightSampler, cx: number, cz: number, res: number, snowApart = false, caveHoles = true): MeshData {
  const b = chunkBounds(cfg.terrain, cx, cz), n = Math.max(2, Math.round(res)), step = b.size / n;
  const m: MeshData = { positions: [], normals: [], colors: [], uvs: [], indices: [], ...(snowApart ? { snow: [] as number[] } : {}) };
  const row = n + 1;
  const e = Math.max(0.5, step);
  // Heights once each on the grid with a border round it: a vertex's slope comes from its neighbours (when the grid step
  // is the slope's own step), five times fewer samples than asking for each.
  const G = n + 3, grid = step >= 0.5 ? new Float64Array(G * G) : null;
  if (grid) for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) grid[j * G + i] = h(b.x0 + (i - 1) * step, b.z0 + (j - 1) * step);
  const at = (i: number, j: number) => grid![(j + 1) * G + (i + 1)];
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
    const x = b.x0 + i * step, z = b.z0 + j * step;
    let y: number, slope: number, normal: [number, number, number];
    if (grid) {
      y = at(i, j);
      const dx = (at(i + 1, j) - at(i - 1, j)) / (2 * step), dz = (at(i, j + 1) - at(i, j - 1)) / (2 * step), l = Math.hypot(dx, 1, dz);
      slope = 1 - 1 / l; normal = [-dx / l, 1 / l, -dz / l];
    } else { y = h(x, z); ({ slope, normal } = slopeAt(h, x, z, e)); }
    // (Snow apart: the view lays it per pixel from this amount, rather than as a white tint between vertices.)
    const c = groundColor(cfg, edits, x, z, y, slope, snowApart ? { snow: false } : {});
    if (m.snow) {
      let sn = snowAt(cfg, edits, x, z, y, slope, normal);
      // Ploughed roads: their own strip cleared, the snow piled in a bank along each side (over 1, so it stands taller
      // than the snow round it: the view raises the land by this amount).
      const e = sn > 0.03 ? f.roadEdge(x, z) : null;
      if (e?.ploughed) sn = e.d < 0.1 ? 0 : e.d < 2.4 ? sn * (1 + 1.4 * Math.sin(Math.PI * Math.min(1, (e.d - 0.1) / 2.3))) : sn;
      m.snow.push(sn);
    }
    m.positions.push(x, y, z); m.normals.push(normal[0], normal[1], normal[2]); m.colors.push(c[0], c[1], c[2]); m.uvs.push(x / 8, z / 8);
  }
  const openings = f.caves && caveHoles ? f.caves.openingsIn(h, b.x0, b.z0, b.x0 + b.size, b.z0 + b.size) : [];
  const hole = (x: number, z: number) => {
    if (openings.length && f.caves!.inside(openings, x, z)) return true;
    if (edits && edits.holes[`${Math.round(x / edits.cell)},${Math.round(z / edits.cell)}`]) return true;
    return !insideWorld(cfg.terrain, x, z);
  };
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    if (hole(b.x0 + (i + 0.5) * step, b.z0 + (j + 0.5) * step)) continue;
    const a = j * row + i, c = a + row;
    m.indices.push(a, c, a + 1, a + 1, c, c + 1);
  }
  // Skirt: a strip hanging down along each edge.
  const drop = Math.max(2, step * 2);
  const addEdge = (ids: number[]) => {
    const base = m.positions.length / 3;
    for (const id of ids) {
      m.positions.push(m.positions[id * 3], m.positions[id * 3 + 1] - drop, m.positions[id * 3 + 2]);
      m.normals.push(m.normals[id * 3], m.normals[id * 3 + 1], m.normals[id * 3 + 2]);
      m.colors.push(m.colors[id * 3], m.colors[id * 3 + 1], m.colors[id * 3 + 2]);
      m.uvs.push(m.uvs[id * 2], m.uvs[id * 2 + 1]);
      if (m.snow) m.snow.push(m.snow[id]);
    }
    // (Not past a finite world's edge: a chunk reaching over it would leave strips hanging in the air out there.)
    for (let k = 0; k + 1 < ids.length; k++) {
      const a = ids[k] * 3, b2 = ids[k + 1] * 3;
      if (!cfg.terrain.endless && !insideWorld(cfg.terrain, (m.positions[a] + m.positions[b2]) / 2, (m.positions[a + 2] + m.positions[b2 + 2]) / 2)) continue;
      m.indices.push(ids[k], ids[k + 1], base + k, ids[k + 1], base + k + 1, base + k);
    }
  };
  addEdge(Array.from({ length: row }, (_, i) => i));
  addEdge(Array.from({ length: row }, (_, i) => n * row + (n - i)));
  addEdge(Array.from({ length: row }, (_, j) => (n - j) * row));
  addEdge(Array.from({ length: row }, (_, j) => j * row + n));
  return m;
}

/** Rebuilds one chunk as voxels: nothing is lost, turning Voxel Remesh off goes back to the smooth mesh. */
/** A chunk of ground as the world's settings say: smooth, or blocks in voxel mode. `lod` 0 is full detail. */
/** `snowApart`: snow as its own per-vertex amount (MeshData.snow) instead of tinted into the colours (WorldCraft's view). */
export function terrainChunk(cfg: WorldConfig, edits: WorldEdits | null, f: Features, h: HeightSampler, cx: number, cz: number, res: number, lod = 0, snowApart = false): MeshData & { cave?: MeshData } {
  const m: MeshData & { cave?: MeshData } = cfg.voxel.enabled && cfg.voxel.target !== 'objects' ? voxelChunk(cfg, edits, h, cx, cz, Math.max(cfg.voxel.size, cfg.terrain.chunkSize / 128) * 2 ** lod) : chunkMesh(cfg, edits, f, h, cx, cz, res, snowApart, lod <= 1);
  // The caves under it, near the camera (far away nobody sees inside them, and the ground stays closed there).
  if (f.caves && lod <= 1) { const c = caveChunk(cfg, f.caves, h, cx, cz); if (c && c.indices.length) m.cave = c; }
  return m;
}

export function voxelChunk(cfg: WorldConfig, edits: WorldEdits | null, h: HeightSampler, cx: number, cz: number, size: number): MeshData {
  const b = chunkBounds(cfg.terrain, cx, cz);
  const sz = Math.max(0.25, size);
  let low = Infinity, high = -Infinity;
  const samp = Math.max(sz, b.size / 16);
  for (let x = b.x0; x <= b.x0 + b.size; x += samp) for (let z = b.z0; z <= b.z0 + b.size; z += samp) { const y = h(x, z); low = Math.min(low, y); high = Math.max(high, y); }
  const top = high + sz, bottom = low - sz * 3;
  return voxelize(
    (x, y, z) => x >= b.x0 && x < b.x0 + b.size && z >= b.z0 && z < b.z0 + b.size && y >= bottom && y <= h(x, z),
    [b.x0, bottom, b.z0], [b.x0 + b.size, top, b.z0 + b.size], sz,
    (x, y, z) => groundColor(cfg, edits, x, z, y, 0), 200000,
  );
}


/** Numbers for the optimizer's readout. */
export interface WorldStats { chunks: number; terrainTriangles: number; objects: number; instanced: number; objectTriangles: number; drawCalls: number; memoryMb: number; /** Actually drawn last frame, after culling. */ drawnTriangles?: number }
