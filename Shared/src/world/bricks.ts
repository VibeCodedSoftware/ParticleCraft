// World bricks: ordinary logic blocks (same definitions, same editors, same document as GameCraft's), offered only in
// WorldCraft, because they drive generators rather than a running game. Each brick's effect is written next to its
// definition, so a brick can't exist without doing something. "On generate" runs them top to bottom over a copy of the
// world's settings; the panels show what a brick has taken over.
import { evalExpr, parseExpr, toNum, truthy, compareValues, type ExprContext } from '../expr';
import type { BlockInstance, EventNode, LogicDocument, ParamValue } from '../schema';
import { stream } from './random';
import { newTerrainLayer, TERRAIN_LAYER_TYPES, TERRAIN_PRESETS } from './terrain';
import { deepCopy, type ScatterLayer, type StructureSpawn, type WorldConfig } from './document';
import { makeLayer } from './scatter';
import { TREE_PRESETS, ROCK_PRESETS } from './generators';
import { BIOME_IDS, LOOK_PALETTES } from './biomes';

export type ParamSpec = { name: string; label: string; type: 'expr' | 'text' | 'choice' | 'boolean' | 'color'; default: ParamValue; options?: string[]; doc?: string };
type P = Record<string, any>;
interface Brick { id: string; category: string; name: string; text: string; params: ParamSpec[]; doc: string; apply: (c: WorldConfig, p: P, set: (path: string) => void) => void; condition?: (c: WorldConfig, p: P) => boolean; trigger?: boolean }

const n = (name: string, label: string, def: number, doc?: string): ParamSpec => ({ name, label, type: 'expr', default: String(def), doc });
const b = (name: string, label: string, def: boolean, doc?: string): ParamSpec => ({ name, label, type: 'boolean', default: def, doc });
const ch = (name: string, label: string, def: string, options: readonly string[], doc?: string): ParamSpec => ({ name, label, type: 'choice', default: def, options: [...options], doc });
const col = (name: string, label: string, def: string): ParamSpec => ({ name, label, type: 'color', default: def });
const tx = (name: string, label: string, def: string, doc?: string): ParamSpec => ({ name, label, type: 'text', default: def, doc });

const SEEDS = ['all', 'terrain', 'biomes', 'scatter', 'trees', 'rocks', 'grass', 'structures', 'water', 'snow', 'seasons', 'caves'] as const;
const LAYER_KINDS = ['tree', 'rock', 'grass', 'flower', 'bush', 'prop', 'debris'] as const;
const SEASONS = ['spring', 'summer', 'autumn', 'winter'] as const;
const WEATHER = ['clear', 'rain', 'snow', 'fog', 'storm', 'dust', 'mist'] as const;
const CANOPIES = ['round', 'cone', 'wide', 'droop', 'palm', 'none'] as const;
const PROFILES = ['high', 'balanced', 'performance', 'mobile', 'openworld'] as const;

/** Copies params straight onto one section of the settings. */
const into = (section: keyof WorldConfig, map: Record<string, string>) => (c: WorldConfig, p: P, set: (s: string) => void) => {
  for (const [param, key] of Object.entries(map)) if (p[param] !== undefined) { (c[section] as any)[key] = p[param]; set(`${section}.${key}`); }
};

export const OPTIMIZE_PROFILES: Record<string, { lodDistance: number; cull: number; grassDistance: number; impostors: boolean; densityScale: number }> = {
  high: { lodDistance: 180, cull: 900, grassDistance: 240, impostors: true, densityScale: 1 },
  balanced: { lodDistance: 120, cull: 600, grassDistance: 170, impostors: true, densityScale: 0.8 },
  performance: { lodDistance: 80, cull: 400, grassDistance: 90, impostors: true, densityScale: 0.55 },
  mobile: { lodDistance: 50, cull: 250, grassDistance: 45, impostors: true, densityScale: 0.3 },
  openworld: { lodDistance: 140, cull: 1400, grassDistance: 100, impostors: true, densityScale: 0.6 },
};

/** A layer, found by name or created by a brick that names it. */
function layerOf(c: WorldConfig, name: string, kind: ScatterLayer['kind'] = 'prop', sources: string[] = []): ScatterLayer {
  let l = c.layers.find((x) => x.name === name);
  if (!l) { l = makeLayer({ id: 'l_' + name.replace(/[^A-Za-z0-9]+/g, '_').toLowerCase(), name, kind, sources }); c.layers.push(l); }
  return l;
}
const treeOf = (c: WorldConfig, id: string) => c.trees.find((t) => t.id === id || t.name === id)?.cfg;
const rockOf = (c: WorldConfig, id: string) => c.rocks.find((t) => t.id === id || t.name === id)?.cfg;
const spawnOf = (c: WorldConfig, name: string): StructureSpawn => {
  let s = c.spawns.find((x) => x.name === name);
  if (!s) { s = { id: 's_' + name.replace(/[^A-Za-z0-9]+/g, '_').toLowerCase(), name, enabled: true, seed: 1, assets: [], mode: 'scatter', fixed: [], region: { x: 0, z: 0, w: 400, d: 400 }, cell: 80, chance: 0.5, minDistance: 40, minHeight: -1000, maxHeight: 10000, maxSlope: 0.15, biomes: [], fixedRotation: 0, randomRotation: true, scale: 1, persistent: true }; c.spawns.push(s); }
  return s;
};
const LAYER_NAME = tx('layer', 'Scatter layer', 'Trees', 'Which scatter layer (made if it is new).');
const onLayer = (map: Record<string, string>) => (c: WorldConfig, p: P, set: (s: string) => void) => { const l = layerOf(c, p.layer); for (const [param, key] of Object.entries(map)) if (p[param] !== undefined) { (l as any)[key] = p[param]; set(`layer:${l.id}.${key}`); } };
const TREE_NAME = ch('tree', 'Tree preset', 'oak', TREE_PRESETS.map((t) => t.id));
const ROCK_NAME = ch('rock', 'Rock preset', 'boulder', ROCK_PRESETS.map((t) => t.id));
const onTree = (map: Record<string, string>) => (c: WorldConfig, p: P, set: (s: string) => void) => { const t = treeOf(c, p.tree); if (t) for (const [param, key] of Object.entries(map)) if (p[param] !== undefined) { (t as any)[key] = p[param]; set(`tree:${p.tree}.${key}`); } };
const onRock = (map: Record<string, string>) => (c: WorldConfig, p: P, set: (s: string) => void) => { const t = rockOf(c, p.rock); if (t) for (const [param, key] of Object.entries(map)) if (p[param] !== undefined) { (t as any)[key] = p[param]; set(`rock:${p.rock}.${key}`); } };
const SPAWN_NAME = tx('spawn', 'Structure set', 'Forest Cabins', 'Which structure set (made if it is new).');
const onSpawn = (map: Record<string, string>) => (c: WorldConfig, p: P, set: (s: string) => void) => { const s = spawnOf(c, p.spawn); for (const [param, key] of Object.entries(map)) if (p[param] !== undefined) { (s as any)[key] = p[param]; set(`spawn:${s.id}.${key}`); } };
const list = (s: unknown) => String(s ?? '').split(',').map((x) => x.trim()).filter(Boolean);

export const BRICKS: Brick[] = [
  // ---- flow
  { id: 'world.on_generate', category: 'wsystem', name: 'On generate', text: 'When the world generates', params: [], doc: 'Runs every time the world is generated, top to bottom. Each brick below changes the settings the generators then use.', apply() {}, trigger: true },
  { id: 'world.if_season', category: 'wsystem', name: 'Season is', text: 'Season is {season}', params: [ch('season', 'Season', 'autumn', SEASONS)], doc: 'Lets the rest of the event depend on the season set above it (World Ecosystem).', apply() {}, condition: (c, p) => c.season.season === p.season },
  { id: 'world.if_weather', category: 'wsystem', name: 'Weather is', text: 'Weather is {weather}', params: [ch('weather', 'Weather', 'rain', WEATHER)], doc: 'Lets the rest of the event depend on the weather set above it.', apply() {}, condition: (c, p) => c.weather.type === p.weather },
  { id: 'world.if_endless', category: 'wsystem', name: 'World is endless', text: 'World is endless', params: [], doc: 'True when Endless Terrain is on.', apply() {}, condition: (c) => c.terrain.endless },
  { id: 'world.random_seed', category: 'wsystem', name: 'Random Seed', text: 'Seed of {what} = {seed}', params: [ch('what', 'For', 'all', SEEDS, 'Each part has its own seed: changing one leaves the others where they are.'), n('seed', 'Seed', 12345)], doc: 'Sets a generator\'s seed. The same seed and settings always give the same result.', apply(c, p, set) {
    const s = Math.round(p.seed), w = p.what;
    const t = (k: string, f: () => void) => { if (w === 'all' || w === k) { f(); set(`${k === 'terrain' ? 'terrain' : k}.seed`); } };
    t('terrain', () => { c.terrain.seed = s; }); t('biomes', () => { c.biomes.seed = s; }); t('water', () => { c.water.riverSeed = s; }); t('snow', () => { c.snow.seed = s; }); t('seasons', () => { c.season.seed = s; }); t('caves', () => { c.cave.seed = s; });
    t('scatter', () => { c.layers.forEach((l, i) => { l.seed = s + i; }); });
    if (w === 'trees' || w === 'all') c.layers.filter((l) => l.kind === 'tree').forEach((l, i) => { l.seed = s + i; });
    if (w === 'rocks' || w === 'all') c.layers.filter((l) => l.kind === 'rock').forEach((l, i) => { l.seed = s + i; });
    if (w === 'grass' || w === 'all') c.layers.filter((l) => l.kind === 'grass').forEach((l, i) => { l.seed = s + i; });
    if (w === 'structures' || w === 'all') c.spawns.forEach((x, i) => { x.seed = s + i; });
  } },

  // ---- terrain
  { id: 'terrain.generator', category: 'wterrain', name: 'Terrain Generator', text: 'Terrain: {preset}', params: [ch('preset', 'Shape', 'Rolling landscape', Object.keys(TERRAIN_PRESETS))], doc: 'Starts from a terrain shape. Bricks after it adjust it.', apply(c, p, set) { Object.assign(c.terrain, TERRAIN_PRESETS[p.preset] ?? {}, { preset: p.preset }); for (const k of Object.keys(TERRAIN_PRESETS[p.preset] ?? {})) set(`terrain.${k}`); set('terrain.preset'); } },
  { id: 'terrain.height', category: 'wterrain', name: 'Terrain Height', text: 'Height {height} m above {base} m', params: [n('height', 'Height (m)', 60), n('base', 'Base height (m)', 6)], doc: 'How tall the land is.', apply: into('terrain', { height: 'height', base: 'baseHeight' }) },
  { id: 'terrain.noise', category: 'wterrain', name: 'Terrain Noise', text: 'Noise scale {scale}, intensity {intensity}', params: [n('scale', 'Noise scale (m)', 200), n('intensity', 'Noise intensity', 1), n('octaves', 'Layers', 6), n('lacunarity', 'Layer detail', 2.03), n('gain', 'Layer strength', 0.5), n('warp', 'Warp', 0.3)], doc: 'The noise the land is built from: multiple layers, each finer and weaker.', apply: into('terrain', { scale: 'noiseScale', intensity: 'noiseIntensity', octaves: 'octaves', lacunarity: 'lacunarity', gain: 'gain', warp: 'warp' }) },
  { id: 'terrain.shape', category: 'wterrain', name: 'Terrain Shape', text: 'Sharpness {sharpness}, valleys {valley}', params: [n('sharpness', 'Mountain sharpness (0-1)', 0.5), n('valley', 'Valley depth (0-1)', 0.4), n('plateau', 'Plateaus (0-1)', 0), n('terraces', 'Terraces', 0), n('canyon', 'Canyons (0-1)', 0), n('island', 'Island (0-1)', 0), n('flatten', 'Flatten (0-1)', 0)], doc: 'Mountains, valleys, plateaus, cliffs, canyons, islands.', apply: into('terrain', { sharpness: 'sharpness', valley: 'valleyDepth', plateau: 'plateau', terraces: 'terraces', canyon: 'canyon', island: 'island', flatten: 'flatten' }) },
  { id: 'terrain.erosion', category: 'wterrain', name: 'Terrain Erosion', text: 'Erosion {amount}', params: [n('amount', 'Erosion (0-1)', 0.5)], doc: 'Gullies on high ground, smoother low ground. Worked out per point, so it matches across chunks of an endless world (not a water simulation).', apply: into('terrain', { amount: 'erosion' }) },
  { id: 'terrain.layer', category: 'wterrain', name: 'Terrain Layer', text: 'Layer {name}: {type}, {blend} {height} m', params: [tx('name', 'Layer name', 'Ridges', 'Which layer (made if it is new).'), ch('type', 'Shape', 'ridges', [...TERRAIN_LAYER_TYPES]), ch('blend', 'Blend', 'add', ['add', 'subtract', 'max', 'min', 'smooth', 'replace']), n('scale', 'Scale (m)', 220), n('height', 'Height (m)', 40), n('minHeight', 'Only above (m)', -1000), n('maxHeight', 'Only below (m)', 10000), n('fade', 'Mask fade (m)', 10), n('patchiness', 'Patchiness (0-1)', 0), n('seed', 'Seed', 1000)], doc: 'One layer of the terrain stack: a shape blended into the land so far, where its height and patch masks allow. Layers apply in the order their bricks run.', apply(c, p, set) {
    const list = (c.terrain.layers ??= []);
    let L = list.find((l) => l.name === p.name);
    if (!L) { L = { ...newTerrainLayer(p.type, list.length), name: p.name }; list.push(L); }
    Object.assign(L, { type: p.type, blend: p.blend, scale: p.scale, height: p.height, minHeight: p.minHeight, maxHeight: p.maxHeight, fade: p.fade, patchiness: p.patchiness, seed: p.seed, enabled: true });
    set('terrain.layers');
  } },
  { id: 'terrain.smoothing', category: 'wterrain', name: 'Terrain Smoothing', text: 'Smoothing {amount}', params: [n('amount', 'Smoothing (0-1)', 0.3)], doc: 'Averages each point with its neighbours.', apply: into('terrain', { amount: 'smooth' }) },
  { id: 'terrain.texture', category: 'wterrain', name: 'Terrain Texture', text: 'Ground: grass {grass}, rock {rock}', params: [col('grass', 'Grass', '#5f8f3d'), col('dirt', 'Dirt', '#6d553a'), col('rock', 'Rock', '#7b7872'), col('sand', 'Sand', '#d9c792'), n('slopeRock', 'Rock on slopes from', 0.22), n('beach', 'Beach width (m)', 3), n('blend', 'Blend', 0.08)], doc: 'Ground colours and how they blend by slope and height.', apply: into('surface', { grass: 'grass', dirt: 'dirt', rock: 'rock', sand: 'sand', slopeRock: 'slopeRock', beach: 'beachWidth', blend: 'blend' }) },
  // The node graph and the bricks together: a brick decides how much of the applied graph's land shows (fade it, or
  // switch it off for a season or a variant), and which ground look colours the land.
  { id: 'terrain.graph_land', category: 'wterrain', name: 'Node graph land', text: 'Node graph land {amount}', params: [n('amount', 'Amount (0-1)', 1, '1: the applied node graph\'s land; 0: the land from the terrain settings and bricks; between: a mix.')], doc: 'How much of the land applied from the Node graph window shows, in place of the land the terrain settings and bricks make. Nothing changes if no graph has been applied.', apply(c, p, set) { c.terrain.graphBlend = Math.max(0, Math.min(1, Number(p.amount))); set('terrain.graphBlend'); } },
  { id: 'terrain.look', category: 'wterrain', name: 'Ground Look', text: 'Ground look {palette}, strength {strength}', params: [ch('palette', 'Palette', 'temperate', ['off', ...Object.keys(LOOK_PALETTES)]), n('strength', 'Strength (0-1)', 0.8)], doc: "Colours the land from its own data (height, slope, and an erosion run's or the node graph's flow, wear and sediment) through a palette. Off: biome colours.", apply(c, p, set) { c.surface.look = { palette: p.palette === 'off' ? '' : String(p.palette), strength: Math.max(0, Math.min(1, Number(p.strength))) }; set('surface.look'); } },
  { id: 'terrain.water_level', category: 'wterrain', name: 'Terrain Water Level', text: 'Water level {level} m', params: [n('level', 'Level (m)', 2)], doc: 'Height of the sea and lakes.', apply(c, p, set) { c.water.level = p.level; c.water.enabled = true; set('water.level'); set('water.enabled'); } },
  { id: 'terrain.resolution', category: 'wterrain', name: 'Terrain Resolution', text: 'Resolution {res} per chunk', params: [n('res', 'Quads per chunk side', 32)], doc: 'Detail of the terrain mesh.', apply: into('terrain', { res: 'resolution' }) },
  { id: 'terrain.subdivision', category: 'wterrain', name: 'Terrain Subdivision', text: 'Subdivide × {levels}', params: [n('levels', 'Doublings', 1)], doc: 'Doubles the resolution this many times (up to 256 per chunk).', apply(c, p, set) { c.terrain.resolution = Math.min(256, c.terrain.resolution * 2 ** Math.max(0, Math.round(p.levels))); set('terrain.resolution'); } },
  { id: 'terrain.biome', category: 'wterrain', name: 'Terrain Biome', text: 'Biomes {enabled}, size {size} m', params: [b('enabled', 'Biomes', true), n('size', 'Biome size (m)', 420), n('temperature', 'Temperature shift', 0), n('moisture', 'Moisture shift', 0), n('transition', 'Transition', 0.12)], doc: 'Where the biomes fall.', apply: into('biomes', { enabled: 'enabled', size: 'size', temperature: 'temperature', moisture: 'moisture', transition: 'transition' }) },

  // ---- endless
  { id: 'terrain.endless', category: 'wendless', name: 'Endless Terrain', text: 'Endless terrain {on}', params: [b('on', 'Endless', true)], doc: 'On: chunks generate around the camera with no edge. Off: a finite world of the size below.', apply: into('terrain', { on: 'endless' }) },
  { id: 'terrain.size', category: 'wendless', name: 'Finite Terrain Size', text: 'Size {width} × {depth} m', params: [n('width', 'Width (m)', 512), n('depth', 'Depth (m)', 512)], doc: 'Size when Endless Terrain is off.', apply: into('terrain', { width: 'width', depth: 'depth' }) },
  { id: 'terrain.chunk', category: 'wendless', name: 'Terrain Chunk', text: 'Chunk size {size} m', params: [n('size', 'Chunk size (m)', 64)], doc: 'Width of one terrain chunk.', apply: into('terrain', { size: 'chunkSize' }) },
  { id: 'terrain.chunk_resolution', category: 'wendless', name: 'Chunk Resolution', text: 'Chunk resolution {res}', params: [n('res', 'Quads per side', 32)], doc: 'Detail of the nearest chunks; further ones use less.', apply: into('terrain', { res: 'resolution' }) },
  { id: 'terrain.chunk_loading', category: 'wendless', name: 'Chunk Loading', text: 'Load {view} chunks round the camera', params: [n('view', 'Radius (chunks)', 4)], doc: 'How far the world extends from the camera.', apply: into('terrain', { view: 'viewChunks' }) },
  { id: 'terrain.chunk_unloading', category: 'wendless', name: 'Chunk Unloading', text: 'Unload past {margin} more chunks', params: [n('margin', 'Margin (chunks)', 1)], doc: 'Chunks this far past the load radius are recycled.', apply: into('terrain', { margin: 'unloadMargin' }) },
  { id: 'terrain.streaming', category: 'wendless', name: 'Terrain Streaming', text: 'Build up to {budget} chunks a frame', params: [n('budget', 'Chunks per frame', 2)], doc: 'Lower is smoother while moving; higher fills in faster.', apply: into('terrain', { budget: 'budget' }) },
  { id: 'terrain.chunk_seed', category: 'wendless', name: 'Chunk Seed', text: 'World seed {seed}', params: [n('seed', 'Seed', 12345)], doc: 'Every chunk is worked out from this and its position, so it is the same on every visit.', apply: into('terrain', { seed: 'seed' }) },

  // ---- trees
  { id: 'tree.generator', category: 'wtree', name: 'Tree Generator', text: 'Trees in {layer}: {tree}', params: [LAYER_NAME, TREE_NAME, n('density', 'Trees per 100 m²', 1)], doc: 'Scatters a generated tree preset (several bricks on one layer mix species).', apply(c, p, set) { const l = layerOf(c, p.layer, 'tree'); l.kind = 'tree'; const src = 'tree:' + p.tree; if (!l.sources.includes(src)) l.sources.push(src); l.density = p.density; set(`layer:${l.id}.sources`); set(`layer:${l.id}.density`); } },
  { id: 'tree.trunk', category: 'wtree', name: 'Trunk Generation', text: '{tree}: height {height}, trunk {trunk}', params: [TREE_NAME, n('height', 'Height (m)', 10), n('trunk', 'Thickness (m)', 0.4), n('taper', 'Taper (0-1)', 0.7)], doc: 'The trunk.', apply: onTree({ height: 'height', trunk: 'trunk', taper: 'taper' }) },
  { id: 'tree.branch', category: 'wtree', name: 'Branch Generation', text: '{tree}: {count} branches at {angle}°', params: [TREE_NAME, n('count', 'Branches', 6), n('levels', 'Levels (branches, twigs)', 3), n('angle', 'Angle (°)', 42), n('length', 'Length', 0.55), n('random', 'Randomness', 0.3)], doc: 'Branches, secondary branches and twigs.', apply: onTree({ count: 'branches', levels: 'levels', angle: 'angle', length: 'length', random: 'randomness' }) },
  { id: 'tree.leaf', category: 'wtree', name: 'Leaf Generation', text: '{tree}: leaves {size} m, density {density}', params: [TREE_NAME, n('size', 'Leaf size (m)', 0.5), n('density', 'Density', 1), n('spread', 'Distribution', 0.5), ch('canopy', 'Canopy', 'round', CANOPIES), col('color', 'Colour', '#4f8a35')], doc: 'Leaves on the outer twigs and the crown\'s shape.', apply: onTree({ size: 'leafSize', density: 'leafDensity', spread: 'leafSpread', canopy: 'canopy', color: 'leaf' }) },
  { id: 'tree.root', category: 'wtree', name: 'Root Generation', text: '{tree}: {roots} roots', params: [TREE_NAME, n('roots', 'Roots', 4)], doc: 'Roots at the base.', apply: onTree({ roots: 'roots' }) },
  { id: 'tree.variation', category: 'wtree', name: 'Tree Variation', text: '{tree}: age {age}', params: [TREE_NAME, n('age', 'Age (0.1-1.5)', 1)], doc: 'Young to old: scales the whole tree.', apply: onTree({ age: 'age' }) },
  { id: 'tree.randomization', category: 'wtree', name: 'Tree Randomization', text: '{tree}: randomness {random}', params: [TREE_NAME, n('random', 'Randomness (0-1)', 0.4)], doc: 'How much individuals differ.', apply: onTree({ random: 'randomness' }) },
  { id: 'tree.growth', category: 'wtree', name: 'Tree Growth', text: '{tree}: light {light}, sky {up}, weight {gravity}', params: [TREE_NAME, n('light', 'Light competition (0-1)', 0.5), n('up', 'Reach for the sky', 0.15), n('gravity', 'Weight (sag)', 0.2), n('stiffness', 'Stiffness', 0.35), n('phyllotaxis', 'Turn between branches (°)', 137.5)], doc: 'The forces branches grow under.', apply: onTree({ light: 'light', up: 'upAttraction', gravity: 'gravity', stiffness: 'stiffness', phyllotaxis: 'phyllotaxis' }) },
  { id: 'tree.leaf_particles', category: 'wtree', name: 'Leaf Particles', text: '{tree}: leaves × {amount} at {angle}°, stalk {length} m', params: [TREE_NAME, n('amount', 'Amount ×', 1), n('angle', 'Away from the branch (°)', 55), n('length', 'Stalk (m)', 0), n('random', 'Random direction (0-1)', 0.35), n('droop', 'Droop', 0.25), n('clumps', 'Leaves per spot', 1)], doc: 'Leaves grown out of each branch, like hair particles.', apply: (c: WorldConfig, p: P, set: (s: string) => void) => { const t = treeOf(c, p.tree); if (!t) return; const h: any = (t.hair ??= {}); for (const k of ['amount', 'angle', 'length', 'random', 'droop', 'clumps']) if (p[k] !== undefined) { h[k] = p[k]; set(`tree:${p.tree}.hair.${k}`); } } },
  { id: 'tree.fork', category: 'wtree', name: 'Tree Forks', text: '{tree}: fork chance {chance}, snapped {snap}', params: [TREE_NAME, n('chance', 'Fork chance (0-1)', 0.2), n('angle', 'Fork angle (°)', 32), n('snap', 'Snapped branches (0-1)', 0)], doc: 'Forks share the parent\'s wood; snapped branches end in a stub.', apply: onTree({ chance: 'splitChance', angle: 'splitAngle', snap: 'breakChance' }) },
  { id: 'tree.shape', category: 'wtree', name: 'Tree Shape', text: '{tree}: asymmetry {asymmetry}, curvature {curvature}', params: [TREE_NAME, n('asymmetry', 'Asymmetry (0 even - 1 one-sided)', 0.2), n('curvature', 'Branch curvature (0-1)', 0.2), n('spread', 'Crown spread (leaf distribution)', 0.5)], doc: 'How lopsided the crown is (each tree leans and reaches toward its own side) and how much its branches bend as they grow.', apply: onTree({ asymmetry: 'asymmetry', curvature: 'curvature', spread: 'leafSpread' }) },
  { id: 'tree.individuals', category: 'wtree', name: 'Tree Individuals', text: '{tree}: {count} different shapes', params: [TREE_NAME, n('count', 'Random shapes (1-24)', 6)], doc: 'How many different random individuals a scattered species comes in. Each also gets its own height, width and lean.', apply: onTree({ count: 'variants' }) },
  { id: 'tree.leaf_type', category: 'wtree', name: 'Leaf Type', text: '{tree}: {style} leaves', params: [TREE_NAME, ch('style', 'Leaf type', 'realistic', ['realistic', 'stylized', 'toon', 'pixel'])], doc: 'The kind of leaf the species wears, with the leaf shapes that suit it.', apply: onTree({ style: 'leafStyle' }) },
  { id: 'tree.stage', category: 'wtree', name: 'Growth Stage', text: '{tree}, stage {stage}: count × {count}, length × {length}', params: [TREE_NAME, n('stage', 'Stage (0 trunk, 1 branches…)', 1), n('count', 'Count ×', 1), n('length', 'Length ×', 1), n('angle', 'Angle + (°)', 0), n('radius', 'Thickness ×', 1)], doc: 'Changes one stage of the Growth Stack.', apply(c, p, set) { const t = treeOf(c, p.tree); if (!t) return; t.stages = t.stages ?? []; const i = Math.max(0, Math.round(p.stage)); while (t.stages.length <= i) t.stages.push({}); Object.assign(t.stages[i], { count: p.count, length: p.length, angle: p.angle, radius: p.radius }); set(`tree:${p.tree}.stages`); } },
  { id: 'tree.seed', category: 'wtree', name: 'Tree Seed', text: 'Seed of {layer}: {seed}', params: [LAYER_NAME, n('seed', 'Seed', 1)], doc: 'Different seed, different arrangement and individuals; nothing else moves.', apply: onLayer({ seed: 'seed' }) },
  { id: 'leaf.control', category: 'wtree', name: 'Leaf Control', text: 'Leaves: {healthy}% green, {yellow}% yellow, {orange}% orange, {brown}% brown', params: [n('healthy', 'Healthy %', 100), n('yellow', 'Yellow %', 0), n('orange', 'Orange %', 0), n('brown', 'Brown %', 0), n('sizeMin', 'Min size ×', 0.8), n('sizeMax', 'Max size ×', 1.2), n('variation', 'Colour variation', 0.15), n('brightness', 'Brightness', 1), n('saturation', 'Saturation', 1), n('opacity', 'Transparency', 1), n('seed', 'Seed', 5)], doc: 'Size, colour share and look of all leaves.', apply: into('leaves', { healthy: 'healthy', yellow: 'yellow', orange: 'orange', brown: 'brown', sizeMin: 'sizeMin', sizeMax: 'sizeMax', variation: 'variation', brightness: 'brightness', saturation: 'saturation', opacity: 'opacity', seed: 'seed' }) },
  { id: 'leaf.browning', category: 'wtree', name: 'Leaf Browning', text: 'Browning {amount}', params: [n('amount', 'Browning (0 green - 1 dead)', 0.5)], doc: 'Healthy through yellow and orange to brown.', apply(c, p, set) { const a = Math.max(0, Math.min(1, p.amount)); const seg = (m: number) => Math.max(0, 1 - Math.abs(a - m) * 3); const t = seg(0) + seg(0.33) + seg(0.66) + seg(1) || 1; c.leaves.healthy = (seg(0) / t) * 100; c.leaves.yellow = (seg(0.33) / t) * 100; c.leaves.orange = (seg(0.66) / t) * 100; c.leaves.brown = (seg(1) / t) * 100; for (const k of ['healthy', 'yellow', 'orange', 'brown']) set('leaves.' + k); } },

  // ---- rocks
  { id: 'rock.generator', category: 'wrock', name: 'Rock Generator', text: 'Rocks in {layer}: {rock}', params: [{ ...LAYER_NAME, default: 'Rocks' }, ROCK_NAME, n('density', 'Rocks per 100 m²', 0.5)], doc: 'Scatters a generated rock preset.', apply(c, p, set) { const l = layerOf(c, p.layer, 'rock'); l.kind = 'rock'; const src = 'rock:' + p.rock; if (!l.sources.includes(src)) l.sources.push(src); l.density = p.density; set(`layer:${l.id}.sources`); set(`layer:${l.id}.density`); } },
  { id: 'rock.shape', category: 'wrock', name: 'Rock Shape', text: '{rock}: size {size}, stretch {elongate}', params: [ROCK_NAME, n('size', 'Size (m)', 1.5), n('elongate', 'Stretch', 0.2), n('sharp', 'Edge sharpness', 0.4), b('lowPoly', 'Low-poly', false)], doc: 'Size and silhouette.', apply: onRock({ size: 'size', elongate: 'elongate', sharp: 'sharpness', lowPoly: 'lowPoly' }) },
  { id: 'rock.deformation', category: 'wrock', name: 'Rock Deformation', text: '{rock}: deform {deform}, fractures {fractures}', params: [ROCK_NAME, n('deform', 'Deformation', 0.45), n('fractures', 'Fractures', 0.25)], doc: 'Lumps and broken faces.', apply: onRock({ deform: 'deform', fractures: 'fractures' }) },
  { id: 'rock.noise', category: 'wrock', name: 'Rock Noise', text: '{rock}: rough {rough}, smooth {smooth}', params: [ROCK_NAME, n('rough', 'Roughness', 0.5), n('smooth', 'Smoothness', 0.2)], doc: 'Surface detail.', apply: onRock({ rough: 'roughness', smooth: 'smooth' }) },
  { id: 'rock.material', category: 'wrock', name: 'Rock Material', text: '{rock}: colour {color}', params: [ROCK_NAME, col('color', 'Colour', '#807c76'), n('variation', 'Colour variation', 0.2)], doc: 'Rock colour.', apply: onRock({ color: 'color', variation: 'variation' }) },
  { id: 'rock.resolution', category: 'wrock', name: 'Rock Resolution', text: '{rock}: detail {detail}', params: [ROCK_NAME, n('detail', 'Detail (0-5)', 3)], doc: 'Mesh detail.', apply: onRock({ detail: 'detail' }) },
  { id: 'rock.seed', category: 'wrock', name: 'Rock Seed', text: 'Seed of {layer}: {seed}', params: [{ ...LAYER_NAME, default: 'Rocks' }, n('seed', 'Seed', 1)], doc: 'A different arrangement and different individual rocks.', apply: onLayer({ seed: 'seed' }) },

  // ---- scatter
  { id: 'scatter.generator', category: 'wscatter', name: 'Scatter Generator', text: 'Scatter {source} as {layer}', params: [LAYER_NAME, ch('kind', 'Kind', 'prop', LAYER_KINDS), tx('source', 'Assets', '', 'Library assets, separated by commas.'), n('density', 'Per 100 m²', 2)], doc: 'Scatters imported assets across the terrain.', apply(c, p, set) { const l = layerOf(c, p.layer, p.kind); l.kind = p.kind; for (const s of list(p.source)) if (!l.sources.includes(s)) l.sources.push(s); l.density = p.density; set(`layer:${l.id}.sources`); set(`layer:${l.id}.density`); set(`layer:${l.id}.kind`); } },
  { id: 'scatter.density', category: 'wscatter', name: 'Scatter Density', text: '{layer}: {density} per 100 m²', params: [LAYER_NAME, n('density', 'Per 100 m²', 2)], doc: 'How many.', apply: onLayer({ density: 'density' }) },
  { id: 'scatter.scale', category: 'wscatter', name: 'Scatter Random Scale', text: '{layer}: scale {min} to {max}', params: [LAYER_NAME, n('min', 'Min', 0.8), n('max', 'Max', 1.25)], doc: 'Random size.', apply: onLayer({ min: 'minScale', max: 'maxScale' }) },
  { id: 'scatter.rotation', category: 'wscatter', name: 'Scatter Rotation', text: '{layer}: random rotation {on}', params: [LAYER_NAME, b('on', 'Random rotation', true)], doc: 'Random turn around the vertical.', apply: onLayer({ on: 'randomRotation' }) },
  { id: 'scatter.distribution', category: 'wscatter', name: 'Scatter Distribution', text: '{layer}: spacing {spacing} m', params: [LAYER_NAME, n('spacing', 'Minimum spacing (m)', 0)], doc: 'Nothing closer than this.', apply: onLayer({ spacing: 'spacing' }) },
  { id: 'scatter.clustering', category: 'wscatter', name: 'Scatter Clustering', text: '{layer}: clusters {amount}, size {size} m', params: [LAYER_NAME, n('amount', 'Clustering (0-1)', 0.5), n('size', 'Cluster size (m)', 22)], doc: 'Groups and gaps instead of an even spread.', apply: onLayer({ amount: 'clustering', size: 'clusterSize' }) },
  { id: 'scatter.alignment', category: 'wscatter', name: 'Scatter Surface Alignment', text: '{layer}: align {amount}', params: [LAYER_NAME, n('amount', '0 upright - 1 with the ground', 0.5)], doc: 'Lean with the slope.', apply: onLayer({ amount: 'align' }) },
  { id: 'scatter.slope', category: 'wscatter', name: 'Scatter Slope Restriction', text: '{layer}: slope {min} to {max}', params: [LAYER_NAME, n('min', 'Min slope (0-1)', 0), n('max', 'Max slope (0-1)', 0.35)], doc: 'Only on ground this steep.', apply: onLayer({ min: 'minSlope', max: 'maxSlope' }) },
  { id: 'scatter.height', category: 'wscatter', name: 'Scatter Height Restriction', text: '{layer}: height {min} to {max} m', params: [LAYER_NAME, n('min', 'Min (m)', -1000), n('max', 'Max (m)', 10000)], doc: 'Only at these heights.', apply: onLayer({ min: 'minHeight', max: 'maxHeight' }) },
  { id: 'scatter.biome', category: 'wscatter', name: 'Scatter Biome Restriction', text: '{layer}: only in {biomes}', params: [LAYER_NAME, tx('biomes', 'Biomes', 'forest', `Separated by commas: ${BIOME_IDS.join(', ')}. Empty: every biome.`)], doc: 'Only in these biomes.', apply(c, p, set) { const l = layerOf(c, p.layer); l.biomes = list(p.biomes); set(`layer:${l.id}.biomes`); } },
  { id: 'scatter.collision', category: 'wscatter', name: 'Scatter Collision', text: '{layer}: avoid others {on}', params: [LAYER_NAME, b('on', 'Avoid other objects', true)], doc: 'Keeps clear of what earlier layers, placed objects and structures occupy.', apply: onLayer({ on: 'avoid' }) },
  { id: 'scatter.seed', category: 'wscatter', name: 'Scatter Seed', text: 'Seed of {layer}: {seed}', params: [LAYER_NAME, n('seed', 'Seed', 1)], doc: 'Only this layer moves.', apply: onLayer({ seed: 'seed' }) },
  { id: 'grass.billboard', category: 'wscatter', name: 'Grass Billboard', text: '{layer}: face camera {face}', params: [{ ...LAYER_NAME, default: 'Grass' }, b('face', 'Face camera', true), n('min', 'Min scale', 0.8), n('max', 'Max scale', 1.25), n('density', 'Per 100 m²', 40), n('seed', 'Seed', 1)], doc: '2D grass cards: turned to the camera each frame, or left standing crossed.', apply: onLayer({ face: 'faceCamera', min: 'minScale', max: 'maxScale', density: 'density', seed: 'seed' }) },

  // ---- water
  { id: 'water.generator', category: 'wwater', name: 'Water Generator', text: 'Water {enabled} at {level} m', params: [b('enabled', 'Water', true), n('level', 'Level (m)', 2)], doc: 'Sea and lakes: everything below the level.', apply: into('water', { enabled: 'enabled', level: 'level' }) },
  { id: 'water.ocean', category: 'wwater', name: 'Ocean Generator', text: 'Ocean: waves {waves}, direction {direction}°', params: [n('waves', 'Wave intensity', 0.4), n('direction', 'Wave direction (°)', 0), n('speed', 'Wave speed', 1)], doc: 'Waves on the water.', apply: into('water', { waves: 'waves', direction: 'waveDirection', speed: 'waveSpeed' }) },
  { id: 'water.lake', category: 'wwater', name: 'Lake Generator', text: '{lakes} lakes', params: [n('lakes', 'Lakes', 3)], doc: 'Basins dug into the land and filled to the water level.', apply: into('water', { lakes: 'lakes' }) },
  { id: 'water.river', category: 'wwater', name: 'River Generator', text: '{count} rivers, {width} m wide', params: [n('count', 'Rivers', 2), n('width', 'Width (m)', 6), n('depth', 'Depth (m)', 2.5), n('seed', 'Seed', 3)], doc: 'Rivers that run downhill from high ground and carve the land.', apply: into('water', { count: 'rivers', width: 'riverWidth', depth: 'riverDepth', seed: 'riverSeed' }) },
  { id: 'water.flow', category: 'wwater', name: 'Water Flow', text: 'Flow: meander {meander}, branching {branching}', params: [n('meander', 'Meander (0-1)', 0.5), n('branching', 'Branching', 0)], doc: 'How rivers wind and fork.', apply: into('water', { meander: 'meander', branching: 'branching' }) },
  { id: 'water.material', category: 'wwater', name: 'Water Material', text: 'Water colour {color}, opacity {opacity}', params: [col('color', 'Colour', '#2a7fd4'), n('opacity', 'Opacity (0-100)', 60), b('foam', 'Foam', true)], doc: 'Uses GameCraft\'s water material.', apply: into('water', { color: 'color', opacity: 'opacity', foam: 'foam' }) },
  { id: 'water.shoreline', category: 'wwater', name: 'Shoreline', text: 'Beach width {width} m', params: [n('width', 'Width (m)', 3)], doc: 'Sand where land meets water.', apply: into('surface', { width: 'beachWidth' }) },

  // ---- roads
  { id: 'road.generator', category: 'wroad', name: 'Road Generator', text: 'Road ({kind}) from {x1}, {z1} to {x2}, {z2}', params: [ch('kind', 'Type', 'dirt', ['dirt', 'gravel', 'asphalt', 'highway', 'forest trail', 'footpath', 'boardwalk', 'stone']), n('x1', 'From X', -100), n('z1', 'From Z', 0), n('x2', 'To X', 100), n('z2', 'To Z', 0), n('width', 'Width (m)', 5), n('conform', 'Conform (0 follows ground - 1 graded)', 0.6)], doc: 'A road between two points, following or grading the terrain. Draw more by hand in the Road tool.', apply() {} },

  // ---- snow
  { id: 'snow.generator', category: 'wsnow', name: 'Snow Generator', text: 'Snow {enabled}, coverage {coverage}', params: [b('enabled', 'Snow', true), n('coverage', 'Coverage (0-1)', 1)], doc: 'Snow on the world.', apply: into('snow', { enabled: 'enabled', coverage: 'coverage' }) },
  { id: 'snow.terrain', category: 'wsnow', name: 'Snow Terrain', text: 'Snow above {start} m', params: [n('start', 'From height (m)', 60), n('blend', 'Blend (m)', 20), n('slope', 'Steepest (0-1)', 0.35)], doc: 'Where snow lies: height and slope.', apply: into('snow', { start: 'startHeight', blend: 'blendHeight', slope: 'maxSlope' }) },
  { id: 'snow.accumulation', category: 'wsnow', name: 'Snow Accumulation', text: 'Snow on objects {amount}', params: [n('amount', 'On upward faces (0-1)', 0.7), n('thickness', 'Thickness', 0.5)], doc: 'Caps on the tops of rocks, branches, leaves and props.', apply: into('snow', { amount: 'onObjects', thickness: 'thickness' }) },
  { id: 'snow.coverage', category: 'wsnow', name: 'Snow Coverage', text: 'Coverage {coverage}, variation {variation}', params: [n('coverage', 'Coverage (0-1)', 1), n('variation', 'Patchiness (0-1)', 0.3)], doc: 'How complete.', apply: into('snow', { coverage: 'coverage', variation: 'variation' }) },
  { id: 'snow.material', category: 'wsnow', name: 'Snow Material', text: 'Snow colour {color}', params: [col('color', 'Colour', '#eef3f6')], doc: 'Snow colour.', apply: into('snow', { color: 'color' }) },
  { id: 'snow.fall', category: 'wsnow', name: 'Snowfall', text: 'Snowfall {amount}', params: [n('amount', 'Intensity (0-1)', 0.5)], doc: 'Falling snow in the view.', apply: into('snow', { amount: 'fall' }) },
  { id: 'snow.footprint', category: 'wsnow', name: 'Snow Footprint', text: 'Footprints {on}, depth {depth}', params: [b('on', 'Footprints', true), n('depth', 'Depth (m)', 0.08), n('size', 'Size (m)', 0.35), n('life', 'Track life (s, 0 = keep)', 60), n('recovery', 'Recovery speed', 0.5)], doc: 'Saved with the world and passed to GameCraft on export.', apply: into('snow', { on: 'footprints', depth: 'footprintDepth', size: 'footprintSize', life: 'trackLife', recovery: 'recovery' }) },
  { id: 'snow.seed', category: 'wsnow', name: 'Snow Random Seed', text: 'Snow seed {seed}', params: [n('seed', 'Seed', 1)], doc: 'Where the patches fall.', apply: into('snow', { seed: 'seed' }) },
  { id: 'snow.movement', category: 'wsnow', name: 'Snow Movement', text: 'Deep snow slows by {resistance}', params: [n('resistance', 'Resistance (0-1)', 0.3)], doc: 'Saved with the world and passed to GameCraft on export.', apply: into('snow', { resistance: 'resistance' }) },

  // ---- seasons
  { id: 'season.control', category: 'wseason', name: 'Season Control', text: 'Season: {season}', params: [ch('season', 'Season', 'summer', SEASONS), b('enabled', 'Seasonal colours', true)], doc: 'Changes foliage colours only: nothing is replaced or regenerated, and originals are untouched.', apply: into('season', { season: 'season', enabled: 'enabled' }) },
  { id: 'season.foliage', category: 'wseason', name: 'Seasonal Foliage Control', text: 'Intensity {intensity}, keep {preserve} original', params: [n('intensity', 'Colour intensity', 1), n('preserve', 'Original colour kept (0-1)', 0), b('trees', 'Tree leaves', true), b('grass', 'Grass', true), b('bushes', 'Bushes', true), b('flowers', 'Flowers', true)], doc: 'Which foliage changes, and how far.', apply: into('season', { intensity: 'intensity', preserve: 'preserve', trees: 'treeLeaves', grass: 'grass', bushes: 'bushes', flowers: 'flowers' }) },
  { id: 'season.hue', category: 'wseason', name: 'Foliage Hue', text: 'Hue shift {hue}', params: [n('hue', 'Hue shift (-1..1)', 0)], doc: 'Turns all foliage colours.', apply: into('season', { hue: 'hue' }) },
  { id: 'season.saturation', category: 'wseason', name: 'Foliage Saturation', text: 'Saturation {saturation}', params: [n('saturation', 'Saturation', 1)], doc: 'Foliage colour strength.', apply: into('season', { saturation: 'saturation' }) },
  { id: 'season.brightness', category: 'wseason', name: 'Foliage Brightness', text: 'Brightness {brightness}', params: [n('brightness', 'Brightness', 1)], doc: 'Foliage brightness.', apply: into('season', { brightness: 'brightness' }) },
  { id: 'season.random', category: 'wseason', name: 'Seasonal Randomization', text: 'Colour variation {variation}, seed {seed}', params: [n('variation', 'Variation (0-1)', 0.3), n('seed', 'Seed', 1)], doc: 'Different plants, different shades, always the same ones for one seed.', apply: into('season', { variation: 'variation', seed: 'seed' }) },
  { id: 'season.transition', category: 'wseason', name: 'Seasonal Transition', text: 'Toward {next}: {blend}', params: [ch('next', 'Next season', 'autumn', SEASONS), n('blend', 'Amount (0-1)', 0), n('speed', 'Seasons per minute (0 = hold)', 0)], doc: 'Smoothly blends the colours between two seasons.', apply: into('season', { next: 'next', blend: 'blend', speed: 'speed' }) },

  // ---- weather
  { id: 'weather.control', category: 'wweather', name: 'Weather Control', text: 'Weather: {type}, {intensity}', params: [ch('type', 'Weather', 'clear', WEATHER), n('intensity', 'Intensity (0-1)', 0.5)], doc: 'Rain, snow, fog, storm, dust or mist in the view.', apply: into('weather', { type: 'type', intensity: 'intensity' }) },
  { id: 'weather.wind', category: 'wweather', name: 'Wind', text: 'Wind {speed} from {direction}°', params: [n('direction', 'Direction (°)', 0), n('speed', 'Speed', 2), n('strength', 'Strength', 1), n('gusts', 'Gusts (0-1)', 0.3)], doc: 'Moves leaves, grass and particles.', apply: into('weather', { direction: 'windDirection', speed: 'windSpeed', strength: 'windStrength', gusts: 'gusts' }) },
  { id: 'weather.fog', category: 'wweather', name: 'Fog', text: 'Fog {fog}', params: [n('fog', 'Density (0-1)', 0.2)], doc: 'Haze.', apply: into('weather', { fog: 'fog' }) },
  { id: 'weather.clouds', category: 'wweather', name: 'Clouds', text: 'Cloud cover {clouds}', params: [n('clouds', 'Coverage (0-1)', 0.4)], doc: 'Uses the 2D clouds.', apply: into('weather', { clouds: 'clouds' }) },
  { id: 'veg.layer_moves', category: 'wweather', name: 'Layer Moves In Wind', text: '{layer}: moves in the wind {on}', params: [{ ...LAYER_NAME, default: 'Grass' }, b('on', 'Moves', true)], doc: 'One scatter or painted layer moves with the wind, or stands still.', apply: onLayer({ on: 'moves' }) },
  { id: 'veg.leaf_sway', category: 'wweather', name: 'Leaf Swaying', text: 'Leaf swaying {on}, amount {amount}', params: [b('on', 'Leaf swaying', true), n('amount', 'Amount', 1)], doc: 'Leaves move with the wind; each tree a little differently.', apply: into('weather', { on: 'sway', amount: 'swayAmount' }) },
  { id: 'veg.grass_sway', category: 'wweather', name: 'Grass Swaying', text: 'Grass swaying {on}', params: [b('on', 'Grass swaying', true)], doc: 'Grass moves with the wind; each blade a little differently.', apply: into('weather', { on: 'grassSway' }) },
  { id: 'sky.time', category: 'wweather', name: 'Time of Day', text: 'Time {time}:00', params: [n('time', 'Hour (0-24)', 12), n('sun', 'Sun strength', 3), n('ambient', 'Ambient', 0.6), b('stars', 'Stars', true)], doc: 'Sun position, sky and ambient light.', apply: into('sky', { time: 'time', sun: 'sunStrength', ambient: 'ambient', stars: 'stars' }) },

  // ---- structures
  { id: 'struct.spawn', category: 'wstruct', name: 'Structure Spawn', text: '{spawn}: {mode}', params: [SPAWN_NAME, ch('mode', 'Where', 'scatter', ['fixed', 'region', 'scatter']), b('enabled', 'Enabled', true)], doc: 'Imported buildings, at the same spots for one seed, in finite or endless worlds. Nothing is modelled.', apply: onSpawn({ mode: 'mode', enabled: 'enabled' }) },
  { id: 'struct.collection', category: 'wstruct', name: 'Structure Collection', text: '{spawn} uses {assets}', params: [SPAWN_NAME, tx('assets', 'Assets', '', 'Your imported buildings, separated by commas.')], doc: 'Which buildings.', apply(c, p, set) { const s = spawnOf(c, p.spawn); s.assets = list(p.assets); set(`spawn:${s.id}.assets`); } },
  { id: 'struct.placement', category: 'wstruct', name: 'Structure Placement', text: '{spawn}: 1 in {cell} m, chance {chance}', params: [SPAWN_NAME, n('cell', 'One attempt every (m)', 80), n('chance', 'Chance (0-1)', 0.5)], doc: 'How often.', apply: onSpawn({ cell: 'cell', chance: 'chance' }) },
  { id: 'struct.seed', category: 'wstruct', name: 'Structure Seed', text: '{spawn}: seed {seed}', params: [SPAWN_NAME, n('seed', 'Seed', 1)], doc: 'Different layout; terrain and scatter stay.', apply: onSpawn({ seed: 'seed' }) },
  { id: 'struct.location', category: 'wstruct', name: 'Structure Location', text: '{spawn} at {x}, {z}', params: [SPAWN_NAME, n('x', 'X (m)', 0), n('z', 'Z (m)', 0), n('ry', 'Rotation (°)', 0)], doc: 'A building at this exact spot, always (sets the set to Fixed).', apply(c, p, set) { const s = spawnOf(c, p.spawn); s.mode = 'fixed'; if (!s.fixed.some((f) => f.x === p.x && f.z === p.z)) s.fixed.push({ x: p.x, z: p.z, ry: p.ry }); set(`spawn:${s.id}.fixed`); set(`spawn:${s.id}.mode`); } },
  { id: 'struct.rotation', category: 'wstruct', name: 'Structure Rotation', text: '{spawn}: rotation {angle}°, random {random}', params: [SPAWN_NAME, n('angle', 'Rotation (°)', 0), b('random', 'Random', true)], doc: 'Which way they face.', apply: onSpawn({ angle: 'fixedRotation', random: 'randomRotation' }) },
  { id: 'struct.spacing', category: 'wstruct', name: 'Structure Spacing', text: '{spawn}: at least {distance} m apart', params: [SPAWN_NAME, n('distance', 'Minimum distance (m)', 40)], doc: 'Worked out the same whichever chunk loads first.', apply: onSpawn({ distance: 'minDistance' }) },
  { id: 'struct.biome', category: 'wstruct', name: 'Structure Biome Restriction', text: '{spawn}: only in {biomes}', params: [SPAWN_NAME, tx('biomes', 'Biomes', 'forest', 'Separated by commas. Empty: every biome.'), n('slope', 'Steepest (0-1)', 0.15), n('min', 'Min height (m)', -1000), n('max', 'Max height (m)', 10000)], doc: 'Where they may stand.', apply(c, p, set) { const s = spawnOf(c, p.spawn); s.biomes = list(p.biomes); s.maxSlope = p.slope; s.minHeight = p.min; s.maxHeight = p.max; set(`spawn:${s.id}.biomes`); set(`spawn:${s.id}.maxSlope`); } },
  { id: 'struct.persistence', category: 'wstruct', name: 'Structure Persistence', text: '{spawn}: keep changes {on}', params: [SPAWN_NAME, b('on', 'Keep state', true)], doc: 'A building removed in the world stays removed (saved with the world).', apply: onSpawn({ on: 'persistent' }) },

  // ---- caves and voxels
  { id: 'cave.generator', category: 'wcave', name: 'Cave Generator', text: 'Caves {enabled}: {y} to {depth} m down, openings {entrances}', params: [b('enabled', 'Caves', true), n('y', 'Shallowest (m below ground)', 6), n('depth', 'Deepest (m below ground)', 36), n('size', 'Tunnel length (m)', 70), n('entrances', 'Openings at the surface (0-1)', 0.3)], doc: 'Winding tunnels under the whole world, always below the ground above them; some open at the surface.', apply: into('cave', { enabled: 'enabled', y: 'y', depth: 'depth', size: 'size', entrances: 'entrances' }) },
  { id: 'cave.tunnel', category: 'wcave', name: 'Tunnel Generator', text: '{tunnels} tunnels, {width} m wide', params: [n('tunnels', 'Tunnels per area', 6), n('width', 'Width (m)', 4), n('branching', 'Branching', 0.4)], doc: 'How many tunnels, how wide, and how often they branch.', apply: into('cave', { tunnels: 'tunnels', width: 'tunnelWidth', branching: 'branching' }) },
  { id: 'cave.chamber', category: 'wcave', name: 'Chamber Generator', text: 'Chambers {size} m', params: [n('size', 'Chamber size (m)', 9)], doc: 'Large rooms.', apply: into('cave', { size: 'chamber' }) },
  { id: 'cave.noise', category: 'wcave', name: 'Cave Noise', text: 'Wall roughness {rough}', params: [n('rough', 'Roughness (0-1)', 0.5), n('stalactites', 'Stalactites (0-1)', 0.3)], doc: 'Rough walls and hanging rock.', apply: into('cave', { rough: 'roughness', stalactites: 'stalactites' }) },
  { id: 'cave.seed', category: 'wcave', name: 'Cave Seed', text: 'Cave seed {seed}', params: [n('seed', 'Seed', 1)], doc: 'A different network.', apply: into('cave', { seed: 'seed' }) },
  { id: 'voxel.remesh', category: 'wcave', name: 'Voxel Remesh', text: 'Voxel remesh {enabled}, size {size} m', params: [b('enabled', 'Voxel Remesh', true), n('size', 'Voxel size (m)', 1), b('smooth', 'Smooth shading', false), ch('target', 'Applies to', 'terrain', ['terrain', 'objects', 'all'])], doc: 'Rebuilds as voxels. The original settings stay: turn it off to go back.', apply: into('voxel', { enabled: 'enabled', size: 'size', smooth: 'smooth', target: 'target' }) },

  // ---- interaction
  { id: 'interact.player', category: 'winteract', name: 'Player Interaction', text: '{layer}: {action}, within {distance} m', params: [LAYER_NAME, b('enabled', 'Player Interaction', true), ch('action', 'Action', 'pickup', ['pickup', 'chop', 'mine', 'cut']), n('distance', 'Distance (m)', 2.2), n('duration', 'Duration (s)', 0.6)], doc: 'Set here, played in GameCraft: each exported object gets the Interaction point behavior and blocks that do this.', apply(c, p, set) { const l = layerOf(c, p.layer); l.interact = { fall: 'remain', resource: '', quantity: 1, physics: false, ...(l.interact ?? {}), enabled: p.enabled, action: p.action, distance: p.distance, duration: p.duration }; set(`layer:${l.id}.interact`); } },
  { id: 'interact.tree_fall', category: 'winteract', name: 'Tree Falling', text: '{layer}: when cut, {fall}', params: [LAYER_NAME, ch('fall', 'Then', 'remain', ['remain', 'logs', 'drop', 'vanish']), b('physics', 'Physics', true)], doc: 'What a chopped tree does in GameCraft.', apply(c, p, set) { const l = layerOf(c, p.layer); l.interact = { enabled: true, action: 'chop', distance: 2.5, duration: 1, resource: 'wood', quantity: 3, ...(l.interact ?? {}), fall: p.fall, physics: p.physics }; set(`layer:${l.id}.interact`); } },
  { id: 'interact.resource', category: 'winteract', name: 'Resource Drop', text: '{layer}: gives {quantity} {resource}', params: [LAYER_NAME, tx('resource', 'Resource', 'wood', 'Added to the inventory variable of this name.'), n('quantity', 'Quantity', 1)], doc: 'What the player gets.', apply(c, p, set) { const l = layerOf(c, p.layer); l.interact = { enabled: true, action: 'pickup', distance: 2.2, duration: 0.5, physics: false, fall: 'vanish', ...(l.interact ?? {}), resource: p.resource, quantity: p.quantity }; set(`layer:${l.id}.interact`); } },
  { id: 'interact.regen', category: 'winteract', name: 'Regeneration', text: '{layer}: regrows in {seconds} s', params: [LAYER_NAME, b('enabled', 'Regeneration', true), n('seconds', 'Regrow time (s)', 120), n('variation', 'Variation (0-1)', 0.2)], doc: 'Collected or felled objects come back.', apply(c, p, set) { const l = layerOf(c, p.layer); l.regen = { enabled: p.enabled, seconds: p.seconds, variation: p.variation }; set(`layer:${l.id}.regen`); } },

  // ---- optimisation
  { id: 'optimize.profile', category: 'wsystem', name: 'Optimization Profile', text: 'Optimize for {profile}', params: [ch('profile', 'Profile', 'balanced', PROFILES)], doc: 'Detail by distance, draw distance, grass distance and density.', apply(c, p, set) { const o = OPTIMIZE_PROFILES[p.profile]; c.optimize.profile = p.profile; if (o) { c.optimize.lodDistance = o.lodDistance; c.optimize.cull = o.cull; c.optimize.grassDistance = o.grassDistance; c.optimize.impostors = o.impostors; } for (const k of ['profile', 'lodDistance', 'cull', 'grassDistance', 'impostors']) set('optimize.' + k); } },
];

export const BRICK_MAP: Record<string, Brick> = Object.fromEntries(BRICKS.map((x) => [x.id, x]));

export const WORLD_CATEGORIES: { id: string; name: string; color: string; icon: string; doc: string }[] = [
  { id: 'wsystem', name: 'World', color: '#7c5ccf', icon: '◈', doc: 'When the world generates, seeds and conditions.' },
  { id: 'wterrain', name: 'Terrain', color: '#7a8f3c', icon: '⛰', doc: 'Terrain shape, noise, erosion, resolution and biomes.' },
  { id: 'wendless', name: 'Endless terrain', color: '#4e8d7a', icon: '∞', doc: 'Chunks, streaming and seeds.' },
  { id: 'wtree', name: 'Trees & leaves', color: '#3f8f46', icon: '♣', doc: 'Tree generator, leaves, browning.' },
  { id: 'wrock', name: 'Rocks', color: '#807c76', icon: '◆', doc: 'Rock generator.' },
  { id: 'wscatter', name: 'Scatter', color: '#b48a2e', icon: '⁘', doc: 'Scatter assets over the land, grass billboards.' },
  { id: 'wwater', name: 'Water', color: '#2a7fd4', icon: '≈', doc: 'Sea, lakes, rivers.' },
  { id: 'wroad', name: 'Roads', color: '#6b6b6b', icon: '═', doc: 'Roads and paths.' },
  { id: 'wsnow', name: 'Snow', color: '#a9c6d8', icon: '❄', doc: 'Snow on land and objects.' },
  { id: 'wseason', name: 'Seasons', color: '#c9702a', icon: '❀', doc: 'Foliage colours through the year.' },
  { id: 'wweather', name: 'Weather & wind', color: '#5a7fa8', icon: '☁', doc: 'Weather, wind, swaying, time of day.' },
  { id: 'wstruct', name: 'Structures', color: '#a0553b', icon: '⌂', doc: 'Your imported buildings at repeatable places.' },
  { id: 'wcave', name: 'Caves & voxels', color: '#55506b', icon: '◍', doc: 'Caves and voxel remeshing.' },
  { id: 'winteract', name: 'Interaction', color: '#b04a7c', icon: '✋', doc: 'What objects do when players use them in GameCraft.' },
];

export interface LogicRun { config: WorldConfig; /** Settings set by a brick (shown as such in the panels), with its block id. */ sources: Record<string, string>; errors: { block: string; message: string }[]; roads: { kind: string; x1: number; z1: number; x2: number; z2: number; width: number; conform: number }[]; ran: number }

/** Runs the On generate events over a copy of the settings. Deterministic: random() in a param follows the terrain seed. */
export function runWorldLogic(doc: LogicDocument | undefined, base: WorldConfig): LogicRun {
  const config = deepCopy(base);
  const out: LogicRun = { config, sources: {}, errors: [], roads: [], ran: 0 };
  if (!doc) return out;
  const vars = new Map<string, unknown>(doc.globals.map((g) => [g.name, g.value]));
  const rng = stream(base.terrain.seed, 'logic');
  const ctx: ExprContext = {
    ident: (name: string) => vars.get(name) ?? 0, member: () => 0, rng: () => rng.next(),
  } as unknown as ExprContext;
  const params = (def: Brick, blk: BlockInstance): P => {
    const p: P = {};
    for (const s of def.params) {
      const raw = blk.params[s.name] ?? s.default;
      if (s.type === 'expr') p[s.name] = toNum(evalExpr(parseExpr(raw as string), ctx));
      else if (s.type === 'boolean') p[s.name] = raw === true || raw === 'true';
      else p[s.name] = String(raw);
    }
    return p;
  };
  const condition = (blk: BlockInstance): boolean => {
    let v = true;
    if (blk.block === 'system.compare_variable') v = compareValues(vars.get(String(blk.params.variable)), String(blk.params.op ?? '='), evalExpr(parseExpr((blk.params.value ?? 0) as string), ctx));
    else if (blk.block === 'system.is_boolean_set') v = truthy(vars.get(String(blk.params.variable)));
    else { const def = BRICK_MAP[blk.block]; if (def?.condition) v = def.condition(config, params(def, blk)); }
    return blk.invert ? !v : v;
  };
  const act = (blk: BlockInstance) => {
    if (blk.disabled) return;
    try {
      if (blk.block === 'var.set') { vars.set(String(blk.params.variable), evalExpr(parseExpr((blk.params.value ?? 0) as string), ctx)); return; }
      if (blk.block === 'var.add') { vars.set(String(blk.params.variable), toNum(vars.get(String(blk.params.variable))) + toNum(evalExpr(parseExpr((blk.params.value ?? 1) as string), ctx))); return; }
      const def = BRICK_MAP[blk.block];
      if (!def) { out.errors.push({ block: blk.id, message: `"${blk.block}" does nothing in WorldCraft` }); return; }
      const p = params(def, blk);
      if (blk.block === 'road.generator') out.roads.push({ kind: p.kind, x1: p.x1, z1: p.z1, x2: p.x2, z2: p.z2, width: p.width, conform: p.conform });
      def.apply(config, p, (path) => { out.sources[path] = blk.id; });
      out.ran++;
    } catch (e: any) { out.errors.push({ block: blk.id, message: e?.message ?? String(e) }); }
  };
  const runList = (nodes: EventNode[]) => {
    let prevRan = false;
    for (const nd of nodes) {
      if (nd.kind === 'comment') continue;
      if (nd.kind === 'group') { if (nd.active !== false) runList(nd.children); continue; }
      if (nd.disabled || nd.loose) continue;
      const conds = nd.conditions.filter((c) => !c.disabled && c.block !== 'world.on_generate');
      let pass: boolean;
      try { pass = nd.isOr ? (conds.length ? conds.some(condition) : true) : conds.every(condition); } catch (e: any) { out.errors.push({ block: nd.id, message: e?.message ?? String(e) }); pass = false; }
      if (nd.isElse && prevRan) pass = false;
      if (pass) { nd.actions.forEach(act); runList(nd.children); }
      prevRan = pass;
    }
  };
  // Top level: only what hangs from On generate runs; loose blocks and other triggers wait.
  for (const sheet of doc.sheets) {
    const walk = (nodes: EventNode[]) => {
      for (const nd of nodes) {
        if (nd.kind === 'group') { if (nd.active !== false) walk(nd.children); continue; }
        if (nd.kind === 'event' && !nd.disabled && !nd.loose && nd.conditions[0]?.block === 'world.on_generate') runList([nd]);
      }
    };
    walk(sheet.events);
  }
  return out;
}

/** The definitions for the block editors. */
export function worldBlockDefs(): any[] {
  return BRICKS.map((x) => ({
    id: x.id, kind: x.trigger || x.condition ? 'condition' : 'action', trigger: x.trigger, category: x.category, name: x.name, text: x.text, target: 'none',
    params: x.params.map((p) => ({ name: p.name, label: p.label, type: p.type, default: p.default, options: p.options, doc: p.doc })),
    doc: x.doc, apps: ['worldcraft'], since: 1,
  }));
}
