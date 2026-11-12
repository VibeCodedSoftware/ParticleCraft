// Tree and rock generators: plain arrays of vertices, with no renderer involved, so the same seed gives the same mesh
// in every app. Branches are tubes that taper and recurse; leaves are cards placed along the outer twigs.
import { clamp, hashString, lerp, noise3, Rng, stream } from './random';
import { hexRgb } from './biomes';
import type { GeneratorPreset, LeafCfg, LeafStyle, RockCfg, TreeCfg, TreeSkeleton, WorldConfig, WorldStyle } from './document';

export interface MeshData { positions: number[]; normals: number[]; colors: number[]; uvs: number[]; indices: number[]; /** Per vertex, 0 at the trunk's foot to 1 at a twig's tip: how far the wind moves it. */ flex?: number[]; /** Per vertex: one random number per leaf (the same on all its corners), so each leaf can take its own colour. */ roll?: number[];
  /** Terrain: how much snow lies at each vertex (0..1), when it is drawn apart from the colours. */ snow?: number[] }
const empty = (): MeshData => ({ positions: [], normals: [], colors: [], uvs: [], indices: [] });

type V3 = [number, number, number];
const add = (a: V3, b: V3, s = 1): V3 => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
const norm = (a: V3): V3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Rotate `v` around unit `axis`. */
const rotate = (v: V3, axis: V3, ang: number): V3 => {
  const c = Math.cos(ang), s = Math.sin(ang), d = dot(axis, v) * (1 - c), x = cross(axis, v);
  return [v[0] * c + x[0] * s + axis[0] * d, v[1] * c + x[1] * s + axis[1] * d, v[2] * c + x[2] * s + axis[2] * d];
};
const perpendicular = (d: V3): V3 => norm(Math.abs(d[1]) < 0.9 ? cross(d, [0, 1, 0]) : cross(d, [1, 0, 0]));

/** `d`: the way the leaf points; its stem is at p, so it stays attached to its branch. */
export interface LeafPoint { p: V3; n: V3; d?: V3; size: number; seed: number; flex: number }
export interface TreeMesh { wood: MeshData; leaves: LeafPoint[]; height: number; radius: number; triangles: number; /** Its branches, node by node. */ skeleton?: TreeSkeleton }

export const treeDefaults = (): TreeCfg => ({ height: 9, trunk: 0.32, branches: 6, levels: 3, angle: 42, length: 0.55, randomness: 0.3, taper: 0.7, roots: 4, leafSize: 0.5, leafDensity: 1, leafSpread: 0.5, canopy: 'round', bark: '#5a4632', leaf: '#4f8a35', leafAsset: 'lib:world/leaves/Leaves-Stylized.png', barkAsset: 'lib:world/woods/Wood1/Wood1_Diffuse.jpg', leafOriginal: false, age: 1, pixelLeaves: false, upAttraction: 0.15, stiffness: 0.35, splitChance: 0.2, splitAngle: 32, breakChance: 0, flatness: 0.1, phyllotaxis: 137.5, light: 0.5, flare: 0.6, lumps: 0.12, stages: [] });

export const TREE_PRESETS: GeneratorPreset<TreeCfg>[] = [
  { id: 'oak', name: 'Oak', cfg: { ...treeDefaults(), height: 11, trunk: 0.5, branches: 7, angle: 48, length: 0.6, canopy: 'wide', leaf: '#4f8a35', leafSize: 1.5, upAttraction: 0.05, gravity: 0.25, splitChance: 0.45, flatness: 0.2, lumps: 0.2, flare: 0.8 } },
  { id: 'pine', name: 'Pine', cfg: { ...treeDefaults(), height: 15, trunk: 0.34, branches: 14, levels: 2, angle: 78, length: 0.32, randomness: 0.15, canopy: 'cone', bark: '#4a3a2b', barkAsset: 'lib:world/woods/Wood3/Wood3_Diffuse.jpg', leafAsset: 'lib:world/leaves/Pine1.png', leaf: '#2f6339', leafSize: 1.1, leafDensity: 1.6, roots: 3, upAttraction: 0, gravity: 0.5, splitChance: 0, flatness: 0.5, lumps: 0.05, stages: [{ up: 0.9 }] } },
  { id: 'birch', name: 'Birch', cfg: { ...treeDefaults(), height: 12, trunk: 0.2, branches: 6, angle: 34, length: 0.42, canopy: 'round', bark: '#d8d4c6', barkAsset: 'lib:world/woods/Wood4/Wood4_Diffuse.jpg', leaf: '#7da63f', leafSize: 1.1, roots: 2, upAttraction: 0.35, gravity: 0.3, splitChance: 0.1, lumps: 0.03, flare: 0.25 } },
  { id: 'willow', name: 'Willow', cfg: { ...treeDefaults(), height: 10, trunk: 0.46, branches: 8, angle: 55, length: 0.62, canopy: 'droop', leaf: '#7a9c3c', leafSize: 0.5, leafDensity: 1.5, gravity: 1.8, stiffness: 0.2, upAttraction: 0.25, splitChance: 0.3 } },
  { id: 'maple', name: 'Maple', cfg: { ...treeDefaults(), height: 10, trunk: 0.36, branches: 7, angle: 44, length: 0.5, canopy: 'round', barkAsset: 'lib:world/woods/Wood2/Wood2_Diffuse.jpg', leafAsset: 'lib:world/leaves/Leaf5.png', leaf: '#5d8f33', leafSize: 0.8, splitChance: 0.35, upAttraction: 0.25 } },
  { id: 'palm', name: 'Palm', cfg: { ...treeDefaults(), height: 10, trunk: 0.22, branches: 11, levels: 1, angle: 60, length: 0.34, randomness: 0.12, taper: 0.85, canopy: 'palm', bark: '#7a6548', leaf: '#4f9140', leafSize: 0.62, roots: 0 } },
  { id: 'shrub', name: 'Shrub', cfg: { ...treeDefaults(), height: 1.7, trunk: 0.05, branches: 9, levels: 2, angle: 62, length: 0.85, randomness: 0.45, roots: 0, flare: 0, lumps: 0, canopy: 'round', barkAsset: 'lib:world/woods/Wood2/Wood2_Diffuse.jpg', leaf: '#4c8a33', leafSize: 0.42, leafDensity: 1.1, start: 0.05, upAttraction: 0.3, hair: { start: 0.1, angle: 70, random: 0.5 } } },
  { id: 'dead', name: 'Dead tree', cfg: { ...treeDefaults(), height: 8, trunk: 0.34, branches: 5, angle: 50, length: 0.48, randomness: 0.55, canopy: 'none', bark: '#57504a', barkAsset: 'lib:world/woods/Wood1/Wood1_Diffuse.jpg', leafDensity: 0, breakChance: 0.5, splitChance: 0.3 } },
  // Sakura: the Japanese cherry in blossom; a short, wide-spreading crown of pink over dark bark. (Its id stays
  // 'fantasy', the name it was first made under, so worlds that use it keep it.)
  { id: 'fantasy', name: 'Sakura', cfg: { ...treeDefaults(), height: 9, trunk: 0.55, branches: 6, angle: 64, length: 0.75, randomness: 0.6, canopy: 'wide', bark: '#4a3532', leaf: '#f4a9c8', leafSize: 0.7, roots: 5 } },
];

export { generateTree, treeFromSkeleton, moveSkeletonNode, deleteSkeletonBranch, strokeBranch } from './growth';

// ---------------------------------------------------------------------------------- styles and variants

/**
 * A generated source: "tree:oak", "tree:oak@toon", "rock:boulder~3". After @ the look it wears; after ~ which of its
 * random shapes (each a different seed and slightly different proportions, so no two neighbours are the same tree).
 */
export interface GenId { kind: 'tree' | 'rock'; preset: string; style?: LeafStyle; variant: number }
export function parseGenId(id: string): GenId | null {
  const m = /^(tree|rock):([^@~#]+)(?:@(realistic|stylized|toon|pixel))?(?:~(\d+))?/.exec(id);
  return m ? { kind: m[1] as GenId['kind'], preset: m[2], style: m[3] as LeafStyle | undefined, variant: m[4] ? Number(m[4]) : 0 } : null;
}
export const genId = (g: GenId) => `${g.kind}:${g.preset}${g.style ? '@' + g.style : ''}${g.variant ? '~' + g.variant : ''}`;
/** Random shapes per generated species and rock kind, in scattered layers. */
export const GEN_VARIANTS = { tree: 6, rock: 6 };
/** How many random shapes this generated source comes in (a species can set its own). */
export function variantCount(cfg: Pick<WorldConfig, 'trees'> | null | undefined, g: GenId) {
  if (g.kind === 'tree') { const n = cfg?.trees.find((t) => t.id === g.preset)?.cfg.variants; if (n !== undefined) return Math.max(1, Math.min(24, Math.round(n))); }
  return GEN_VARIANTS[g.kind];
}

/** Any source's look: "@toon" on a generated id or after a model's path; models named Stylized or PixelArt are those. */
export function styleOf(src: string): LeafStyle | null {
  const m = /@(realistic|stylized|toon|pixel)/.exec(src);
  if (m) return m[1] as LeafStyle;
  if (/pixel/i.test(src)) return 'pixel';
  if (/styli[sz]ed/i.test(src)) return 'stylized';
  if (/realist|realsitc/i.test(src)) return 'realistic';
  return null;
}
/** A model source without its look: what to load. */
export const baseSource = (src: string) => (src.startsWith('tree:') || src.startsWith('rock:') ? src : src.replace(/@(realistic|stylized|toon|pixel)$/, ''));

/** Leaf pictures for each kind of leaf. Toon pictures are drawn by the app ("gen:"). */
export function leafPicture(style: LeafStyle, preset: string, canopy: TreeCfg['canopy']): { asset: string; pixel: boolean; original: boolean } {
  const needle = canopy === 'cone' || /pine|fir|spruce/i.test(preset);
  switch (style) {
    case 'stylized': return { asset: 'lib:world/leaves/Leaves-Stylized.png', pixel: false, original: false };
    case 'toon': return { asset: needle ? 'gen:leaf-toon-needle' : 'gen:leaf-toon', pixel: false, original: false };
    case 'pixel': return { asset: 'lib:world/leaves/PixelArt-TreeLeafs.png', pixel: true, original: false };
    default: return { asset: needle ? 'lib:world/leaves/Pine1.png' : ({ oak: 'lib:world/leaves/Leaf2.png', maple: 'lib:world/leaves/Leaf3.png', birch: 'lib:world/leaves/Leaf4.png', willow: 'lib:world/leaves/Leaf4.png' } as Record<string, string>)[preset] ?? 'lib:world/leaves/Leaf1.png', pixel: false, original: false };
  }
}

/** A species wearing a kind of leaf: its picture, and the shapes that suit it. */
export function withLeafStyle(c: TreeCfg, style: LeafStyle, preset: string): TreeCfg {
  const pic = leafPicture(style, preset, c.canopy);
  const o: TreeCfg = { ...c, leafStyle: style, leafAsset: pic.asset, pixelLeaves: pic.pixel, leafOriginal: pic.original };
  // Cartoon leaves read as bigger, fewer clumps; pixel ones as chunky tiles.
  // (Bigger leaves need fewer of them to fill a crown, which also keeps these looks light to draw.)
  if (style === 'stylized') { o.leafSize = c.leafSize * 1.4; o.leafDensity = c.leafDensity * 0.55; }
  if (style === 'toon') { o.leafSize = c.leafSize * 1.6; o.leafDensity = c.leafDensity * 0.45; o.randomness = c.randomness * 0.7; }
  if (style === 'pixel') { o.leafSize = c.leafSize * 1.45; o.leafDensity = c.leafDensity * 0.5; }
  return o;
}

/** One random shape of a species: its own seed and a little difference in height, spread and branching. */
function varyTree(c: TreeCfg, variant: number): TreeCfg {
  if (!variant) return c;
  const r = stream(variant, 'tree-variant');
  return { ...c, height: c.height * r.range(0.82, 1.18), branches: Math.max(1, Math.round(c.branches + r.range(-1.6, 1.6))), angle: c.angle + r.range(-7, 7), length: c.length * r.range(0.88, 1.12), randomness: clamp(c.randomness * r.range(0.8, 1.35), 0, 1), phyllotaxis: (c.phyllotaxis ?? 137.5) + r.range(-6, 6), leafSpread: c.leafSpread * r.range(0.85, 1.2),
    // (No two quite alike: a little one-sidedness, and a little more or less bend, of their own.)
    asymmetry: clamp((c.asymmetry ?? 0) + r.range(0.05, 0.3)), curvature: clamp((c.curvature ?? 0) + r.range(-0.1, 0.2)), trunk: c.trunk * r.range(0.85, 1.18) };
}
function varyRock(c: RockCfg, variant: number): RockCfg {
  if (!variant) return c;
  const r = stream(variant, 'rock-variant');
  return { ...c, size: c.size * r.range(0.75, 1.25), elongate: clamp(c.elongate + r.range(-0.25, 0.3)), deform: clamp(c.deform + r.range(-0.15, 0.2)), fractures: clamp(c.fractures + r.range(-0.15, 0.2)), roughness: clamp(c.roughness + r.range(-0.12, 0.12)) };
}
/** Rocks in each look. */
function rockStyle(c: RockCfg, style: LeafStyle | undefined): RockCfg {
  switch (style) {
    case 'realistic': return { ...c, lowPoly: false, detail: Math.max(3, c.detail), sharpness: Math.min(c.sharpness, 0.6) };
    case 'stylized': return { ...c, lowPoly: true, detail: Math.min(2, Math.max(1, c.detail)), roughness: c.roughness * 0.6 };
    case 'toon': return { ...c, lowPoly: true, detail: Math.min(2, Math.max(1, c.detail)), roughness: 0.2, fractures: Math.max(0.3, c.fractures), smooth: 0.4 };
    case 'pixel': return { ...c, lowPoly: true, detail: 1, roughness: 0.3, sharpness: 0.8 };
    default: return c;
  }
}

/** A generated tree source's settings and seed (the same in the view and in every export). */
export function resolveTree(cfg: Pick<WorldConfig, 'trees'>, id: string): { cfg: TreeCfg; seed: number; style?: LeafStyle } | null {
  const g = parseGenId(id); if (!g || g.kind !== 'tree') return null;
  const p = cfg.trees.find((t) => t.id === g.preset)?.cfg; if (!p) return null;
  const style = g.style ?? p.leafStyle;
  const c = varyTree(style ? withLeafStyle(p, style, g.preset) : p, g.variant);
  return { cfg: c, seed: 1 + hashString('tree:' + g.preset) + g.variant * 7919, style };
}
export function resolveRock(cfg: Pick<WorldConfig, 'rocks'>, id: string): { cfg: RockCfg; seed: number; style?: LeafStyle } | null {
  const g = parseGenId(id); if (!g || g.kind !== 'rock') return null;
  const p = cfg.rocks.find((t) => t.id === g.preset)?.cfg; if (!p) return null;
  return { cfg: varyRock(rockStyle(p, g.style), g.variant), seed: 7 + hashString('rock:' + g.preset) + g.variant * 7919, style: g.style };
}

/** Which trees and rocks each look scatters (only generated ones: they share one way of drawing). Mixed has all of them, a look to each region of the world. */
export const STYLE_SOURCES: Record<LeafStyle, { trees: string[]; rocks: string[] }> = {
  realistic: { trees: ['tree:oak@realistic', 'tree:pine@realistic', 'tree:birch@realistic', 'tree:maple@realistic'], rocks: ['rock:boulder@realistic', 'rock:stone@realistic', 'rock:jagged@realistic', 'rock:large@realistic'] },
  stylized: { trees: ['tree:oak@stylized', 'tree:pine@stylized', 'tree:birch@stylized', 'tree:maple@stylized'], rocks: ['rock:stylized@stylized', 'rock:lowpoly@stylized', 'rock:boulder@stylized'] },
  toon: { trees: ['tree:oak@toon', 'tree:pine@toon', 'tree:birch@toon', 'tree:maple@toon'], rocks: ['rock:stylized@toon', 'rock:boulder@toon', 'rock:stone@toon'] },
  pixel: { trees: ['tree:oak@pixel', 'tree:pine@pixel', 'tree:birch@pixel'], rocks: ['rock:lowpoly@pixel', 'rock:stone@pixel'] },
};

/**
 * The grasses each look can wear (one at a time), and how thick each grows (per 100 m²) to cover the ground with no bare
 * gaps between tufts (the earlier figures left gaps everywhere; the density slider lowers it for slower computers).
 */
export const LOOK_GRASSES: Record<LeafStyle, { id: string; name: string; density: number }[]> = {
  realistic: [
    { id: 'lib:world/grass/RealisticGrass.fbx', name: 'Realistic (card)', density: 800 },
    { id: 'lib:world/grass/Realistic Grass.fbx', name: 'Realistic, wider card', density: 650 },
    { id: 'lib:world/grass/Realistic_Grass_2.fbx', name: 'Realistic, crossed cards', density: 650 },
    { id: 'lib:world/grass/Realsitc-ish Grass.fbx', name: 'Realistic 3D blades', density: 600 },
  ],
  stylized: [
    { id: 'lib:world/grass/StylizedGrass_2.blend', name: 'Stylized tall blades', density: 700 },
    { id: 'lib:world/grass/StylizedGrass.blend', name: 'Stylized clumps', density: 180 },
  ],
  toon: [
    { id: 'lib:world/grass/StylizedGrass_2.blend@toon', name: 'Toon tall blades', density: 700 },
    { id: 'lib:world/grass/StylizedGrass.blend@toon', name: 'Toon clumps', density: 180 },
  ],
  pixel: [
    { id: 'lib:world/grass/PixelArtGrass.fbx', name: 'Pixel art', density: 700 },
    { id: 'lib:world/grass/PixelArtGrass2.fbx', name: 'Pixel art 2', density: 700 },
  ],
};
/** The grass a look wears in this world: the one picked, or the look's first. */
export const lookGrass = (c: Pick<WorldConfig, 'grassChoice'>, look: LeafStyle) => LOOK_GRASSES[look].find((g) => g.id === c.grassChoice?.[look]) ?? LOOK_GRASSES[look][0];

/** Switches the world's look: the tree, rock and grass layers take that look's sources. Other layers are left alone. */
export function applyWorldStyle(c: WorldConfig, style: WorldStyle) {
  c.style = style;
  const looks: LeafStyle[] = style === 'mixed' ? ['realistic', 'stylized', 'toon', 'pixel'] : [style];
  for (const l of c.layers) {
    const k = l.kind === 'tree' ? 'trees' : l.kind === 'rock' ? 'rocks' : l.kind === 'grass' && !l.paintOnly ? 'grass' : null;
    if (!k) continue;
    l.regional = style === 'mixed';
    if (k === 'grass') {
      // One grass per look, thick enough for that grass to cover the ground.
      const gs = looks.map((s) => lookGrass(c, s));
      l.sources = gs.map((g) => g.id);
      l.density = Math.max(...gs.map((g) => g.density));
      l.clustering = 0; // (an even cover, not patches with bare ground between)
      l.sourceDensity = gs.length > 1 ? Object.fromEntries(gs.map((g) => [g.id, g.density])) : undefined;
      // Realistic grass takes the ground's greens; the other looks keep their own colours.
      l.copyGround = style === 'realistic';
      // (Grass doesn't cling to steep slopes.)
      l.maxSlope = Math.min(l.maxSlope, 0.42);
    } else l.sources = looks.flatMap((s) => STYLE_SOURCES[s][k]);
  }
}

/** In a mixed world, which look a place has: large regions, the same for every layer, so a toon wood has toon grass. */
export function regionStyle(seed: number, x: number, z: number): LeafStyle {
  const wx = x + noise3(seed + 71, x / 300, 0, z / 300) * 120, wz = z + noise3(seed + 72, x / 300, 0, z / 300) * 120;
  const a = noise3(seed + 73, wx / 260, 0.5, wz / 260), b = noise3(seed + 74, wx / 260, 0.5, wz / 260);
  return a >= 0 ? (b >= 0 ? 'realistic' : 'stylized') : b >= 0 ? 'toon' : 'pixel';
}

export const leafDefaults = (): LeafCfg => ({ sizeMin: 0.8, sizeMax: 1.2, healthy: 100, yellow: 0, orange: 0, brown: 0, variation: 0.15, brightness: 1, saturation: 1, opacity: 1, cluster: 0.5, seed: 5 });

/** Share of each colour for one leaf: picks healthy, yellow, orange or brown by the percentages. */
export function leafColorOf(l: LeafCfg, base: string, roll: number, shade: number): [number, number, number] {
  const total = Math.max(1e-3, l.healthy + l.yellow + l.orange + l.brown);
  let v = roll * total;
  let c: [number, number, number] = hexRgb(base);
  if ((v -= l.healthy) >= 0) { c = hexRgb('#c7b238'); if ((v -= l.yellow) >= 0) { c = hexRgb('#c9702a'); if ((v -= l.orange) >= 0) c = hexRgb('#6d4a2b'); } }
  const k = l.brightness * (1 + (shade - 0.5) * l.variation * 2);
  const g = (c[0] + c[1] + c[2]) / 3;
  return [clamp((g + (c[0] - g) * l.saturation) * k), clamp((g + (c[1] - g) * l.saturation) * k), clamp((g + (c[2] - g) * l.saturation) * k)];
}

/** Leaf cards: two triangles each, facing out from the branch, coloured by the leaf rules. */
export function leafMesh(tree: TreeMesh, l: LeafCfg, base: string): MeshData {
  const m: MeshData = { ...empty(), flex: [], roll: [] };
  for (const leaf of tree.leaves) {
    const r = new Rng(leaf.seed ^ l.seed);
    const roll = new Rng((leaf.seed * 2654435761) ^ 0x5bd1e995).next();
    const size = leaf.size * lerp(l.sizeMin, l.sizeMax, r.next());
    const n = leaf.n, s = size / 2, base0 = m.positions.length / 3;
    const b = leaf.d ?? cross(n, perpendicular(n)), a = leaf.d ? norm(cross(b, n)) : perpendicular(n);
    const c = leafColorOf(l, base, r.next(), r.next());
    // Lit as a soft crown, not as flat cards: the normal leans up, so the underside of a card isn't black.
    const lit = norm([n[0], n[1] + 1.4, n[2]]);
    // With a direction, the picture's bottom edge (where leaf pictures have their stems) sits on the branch.
    const low = leaf.d ? 0 : -s, high = leaf.d ? size : s;
    const corners: [number, number, number, number][] = [[-s, low, 0, 0], [s, low, 1, 0], [s, high, 1, 1], [-s, high, 0, 1]];
    for (const [u, v, tu, tv] of corners) {
      m.positions.push(leaf.p[0] + a[0] * u + b[0] * v, leaf.p[1] + a[1] * u + b[1] * v, leaf.p[2] + a[2] * u + b[2] * v);
      m.normals.push(lit[0], lit[1], lit[2]); m.colors.push(c[0], c[1], c[2]); m.uvs.push(tu, tv); m.flex!.push(leaf.flex); m.roll!.push(roll);
    }
    m.indices.push(base0, base0 + 1, base0 + 2, base0, base0 + 2, base0 + 3);
  }
  return m;
}

export const rockDefaults = (): RockCfg => ({ size: 1.2, detail: 3, roughness: 0.5, smooth: 0.2, deform: 0.45, fractures: 0.25, sharpness: 0.4, variation: 0.2, color: '#807c76', lowPoly: false, elongate: 0.2 });
export const ROCK_PRESETS: GeneratorPreset<RockCfg>[] = [
  { id: 'stone', name: 'Small stone', cfg: { ...rockDefaults(), size: 0.3, detail: 2, deform: 0.3, fractures: 0.05 } },
  { id: 'boulder', name: 'Boulder', cfg: { ...rockDefaults(), size: 1.8, detail: 3 } },
  { id: 'large', name: 'Large rock', cfg: { ...rockDefaults(), size: 3.2, detail: 4, deform: 0.55, fractures: 0.35 } },
  { id: 'jagged', name: 'Jagged', cfg: { ...rockDefaults(), size: 2.2, detail: 3, roughness: 0.8, deform: 0.75, fractures: 0.7, sharpness: 0.95, smooth: 0, elongate: 0.5 } },
  { id: 'smooth', name: 'Smooth stone', cfg: { ...rockDefaults(), size: 0.9, detail: 4, roughness: 0.1, deform: 0.2, fractures: 0, smooth: 1, sharpness: 0, color: '#8c8a84' } },
  { id: 'broken', name: 'Broken rock', cfg: { ...rockDefaults(), size: 1.5, detail: 3, deform: 0.5, fractures: 0.95, sharpness: 0.8 } },
  { id: 'formation', name: 'Rock formation', cfg: { ...rockDefaults(), size: 4.5, detail: 4, deform: 0.8, fractures: 0.5, elongate: 0.75, sharpness: 0.6 } },
  { id: 'lowpoly', name: 'Low-poly', cfg: { ...rockDefaults(), size: 1.4, detail: 1, roughness: 0.3, lowPoly: true, sharpness: 0.5, color: '#8e8a80' } },
  { id: 'stylized', name: 'Stylized', cfg: { ...rockDefaults(), size: 1.6, detail: 2, roughness: 0.25, lowPoly: true, fractures: 0.4, color: '#a28f7c', sharpness: 0.7 } },
];

const icoFaces = (detail: number): { v: V3[]; f: [number, number, number][] } => {
  const t = (1 + Math.sqrt(5)) / 2;
  let v: V3[] = ([[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]] as V3[]).map(norm);
  let f: [number, number, number][] = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  for (let d = 0; d < detail; d++) {
    const mid = new Map<string, number>(), nf: typeof f = [];
    const m = (a: number, b: number) => { const k = a < b ? `${a}_${b}` : `${b}_${a}`; let i = mid.get(k); if (i === undefined) { i = v.length; v = [...v, norm([(v[a][0] + v[b][0]) / 2, (v[a][1] + v[b][1]) / 2, (v[a][2] + v[b][2]) / 2])]; mid.set(k, i); } return i; };
    for (const [a, b, c] of f) { const ab = m(a, b), bc = m(b, c), ca = m(c, a); nf.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]); }
    f = nf;
  }
  return { v, f };
};

export function generateRock(c: RockCfg, seed: number): MeshData {
  const r = stream(seed, 'rock');
  const { v, f } = icoFaces(Math.round(clamp(c.detail, 0, 5)));
  const m = empty();
  const stretch: V3 = [1 + c.elongate * r.range(-0.3, 0.9), 0.7 + c.elongate * r.range(-0.2, 0.8), 1 + c.elongate * r.range(-0.4, 0.5)];
  // Cutting planes make the broken faces.
  const cuts = Array.from({ length: Math.round(c.fractures * 9) }, () => { const n = norm([r.range(-1, 1), r.range(-0.4, 1), r.range(-1, 1)]); return { n, d: r.range(0.45, 0.85) }; });
  const baseC = hexRgb(c.color);
  const pos: V3[] = v.map((p) => {
    let q: V3 = [...p];
    const big = noise3(seed, p[0] * 1.2 + 9, p[1] * 1.2, p[2] * 1.2);
    let k = 1 + big * c.deform * 0.7;
    let amp = c.roughness * 0.25, fr = 3;
    for (let o = 0; o < 3; o++) { const n = noise3(seed + o * 57, p[0] * fr, p[1] * fr, p[2] * fr); k += (c.sharpness > 0.5 ? (Math.abs(n) * 2 - 0.6) : n) * amp; amp *= 0.5; fr *= 2.1; }
    k = lerp(k, 1 + big * c.deform * 0.35, clamp(c.smooth));
    q = [q[0] * k, q[1] * k, q[2] * k];
    for (const cut of cuts) { const d = dot(q, cut.n) - cut.d; if (d > 0) q = add(q, cut.n, -d * (0.35 + 0.6 * c.sharpness)); }
    return [q[0] * stretch[0] * c.size * 0.5, q[1] * stretch[1] * c.size * 0.5, q[2] * stretch[2] * c.size * 0.5];
  });
  const minY = Math.min(...pos.map((p) => p[1]));
  for (const p of pos) p[1] -= minY * 0.85; // sits slightly into the ground
  const shade = (p: V3) => { const n = noise3(seed + 400, p[0] * 2, p[1] * 2, p[2] * 2); const k = 1 + n * (0.22 + c.variation * 0.3); return [clamp(baseC[0] * k), clamp(baseC[1] * k), clamp(baseC[2] * k)]; };
  const faceted = c.lowPoly || c.sharpness > 0.65;
  if (faceted) {
    for (const [a, b, cc] of f) {
      const pa = pos[a], pb = pos[b], pc = pos[cc];
      const n = norm(cross([pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]], [pc[0] - pa[0], pc[1] - pa[1], pc[2] - pa[2]]));
      const i = m.positions.length / 3, col = shade(pa);
      for (const q of [pa, pb, pc]) { m.positions.push(q[0], q[1], q[2]); m.normals.push(n[0], n[1], n[2]); m.colors.push(col[0], col[1], col[2]); m.uvs.push(q[0] * 0.4, q[2] * 0.4); }
      m.indices.push(i, i + 1, i + 2);
    }
    return m;
  }
  const nors: V3[] = pos.map(() => [0, 0, 0]);
  for (const [a, b, cc] of f) {
    const pa = pos[a], pb = pos[b], pc = pos[cc];
    const n = cross([pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]], [pc[0] - pa[0], pc[1] - pa[1], pc[2] - pa[2]]);
    for (const i of [a, b, cc]) nors[i] = add(nors[i], n);
    m.indices.push(a, b, cc);
  }
  pos.forEach((p, i) => { const n = norm(nors[i]), col = shade(p); m.positions.push(p[0], p[1], p[2]); m.normals.push(n[0], n[1], n[2]); m.colors.push(col[0], col[1], col[2]); m.uvs.push(p[0] * 0.4, p[2] * 0.4); });
  return m;
}

/**
 * A smooth surface where `field` crosses zero (negative inside the open space): surface nets, one vertex per cell the
 * surface passes through, at the average of where it crosses the cell's edges, joined into quads. Normals from the
 * field's slope point into the open space. `keep` leaves out faces (an opening).
 */
export function surfaceNets(field: (x: number, y: number, z: number) => number, min: V3, max: V3, size: number, color: (x: number, y: number, z: number) => V3, keep: (x: number, y: number, z: number) => boolean = () => true, limit = 400000): MeshData {
  const m = empty();
  const nx = Math.ceil((max[0] - min[0]) / size) + 1, ny = Math.ceil((max[1] - min[1]) / size) + 1, nz = Math.ceil((max[2] - min[2]) / size) + 1;
  const at = (i: number, j: number, k: number) => i + nx * (j + ny * k);
  const val = new Float32Array(nx * ny * nz);
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) val[at(i, j, k)] = field(min[0] + i * size, min[1] + j * size, min[2] + k * size);
  const vert = new Int32Array(nx * ny * nz).fill(-1);
  const pos: V3[] = [];
  const corners: [number, number, number][] = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
  const edges: [number, number][] = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  for (let k = 0; k < nz - 1; k++) for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const v = corners.map(([a, b, c]) => val[at(i + a, j + b, k + c)]);
    let inside = 0; for (const x of v) if (x < 0) inside++;
    if (inside === 0 || inside === 8) continue;
    let sx = 0, sy = 0, sz = 0, n = 0;
    for (const [a, b] of edges) {
      if ((v[a] < 0) === (v[b] < 0)) continue;
      const t = v[a] / (v[a] - v[b]), ca = corners[a], cb = corners[b];
      sx += ca[0] + (cb[0] - ca[0]) * t; sy += ca[1] + (cb[1] - ca[1]) * t; sz += ca[2] + (cb[2] - ca[2]) * t; n++;
    }
    vert[at(i, j, k)] = pos.length;
    pos.push([min[0] + (i + sx / n) * size, min[1] + (j + sy / n) * size, min[2] + (k + sz / n) * size]);
  }
  const e = size * 0.5;
  for (const p of pos) {
    const g = norm([field(p[0] + e, p[1], p[2]) - field(p[0] - e, p[1], p[2]), field(p[0], p[1] + e, p[2]) - field(p[0], p[1] - e, p[2]), field(p[0], p[1], p[2] + e) - field(p[0], p[1], p[2] - e)]);
    const c = color(p[0], p[1], p[2]);
    m.positions.push(p[0], p[1], p[2]); m.normals.push(-g[0], -g[1], -g[2]); m.colors.push(c[0], c[1], c[2]); m.uvs.push(p[0] * 0.25 + p[1] * 0.1, p[2] * 0.25 + p[1] * 0.1);
  }
  // A quad round every grid edge the surface crosses, from the four cells sharing it; wound to face the open space.
  const quad = (a: number, b: number, c: number, d: number, flip: boolean) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    const pa = pos[a], pc = pos[c];
    if (!keep((pa[0] + pc[0]) / 2, (pa[1] + pc[1]) / 2, (pa[2] + pc[2]) / 2)) return;
    if (m.indices.length >= limit * 3) return;
    if (flip) m.indices.push(a, c, b, a, d, c); else m.indices.push(a, b, c, a, c, d);
  };
  for (let k = 1; k < nz - 1; k++) for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
    const v0 = val[at(i, j, k)] < 0;
    if (v0 !== val[at(i + 1, j, k)] < 0) quad(vert[at(i, j - 1, k - 1)], vert[at(i, j, k - 1)], vert[at(i, j, k)], vert[at(i, j - 1, k)], !v0);
    if (v0 !== val[at(i, j + 1, k)] < 0) quad(vert[at(i - 1, j, k - 1)], vert[at(i - 1, j, k)], vert[at(i, j, k)], vert[at(i, j, k - 1)], !v0);
    if (v0 !== val[at(i, j, k + 1)] < 0) quad(vert[at(i - 1, j - 1, k)], vert[at(i, j - 1, k)], vert[at(i, j, k)], vert[at(i - 1, j, k)], !v0);
  }
  return m;
}

/** Marching-free voxel remesh: solid cubes wherever a sample says inside. Faces between solid cells are left out. */
export function voxelize(solid: (x: number, y: number, z: number) => boolean, min: V3, max: V3, size: number, color: (x: number, y: number, z: number) => V3, limit = 400000): MeshData & { truncated: boolean } {
  const m = { ...empty(), truncated: false };
  const nx = Math.ceil((max[0] - min[0]) / size), ny = Math.ceil((max[1] - min[1]) / size), nz = Math.ceil((max[2] - min[2]) / size);
  const at = (i: number, j: number, k: number) => solid(min[0] + (i + 0.5) * size, min[1] + (j + 0.5) * size, min[2] + (k + 0.5) * size);
  const FACES: { d: V3; c: V3[] }[] = [
    { d: [1, 0, 0], c: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]] }, { d: [-1, 0, 0], c: [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0]] },
    { d: [0, 1, 0], c: [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]] }, { d: [0, -1, 0], c: [[0, 0, 1], [0, 0, 0], [1, 0, 0], [1, 0, 1]] },
    { d: [0, 0, 1], c: [[1, 0, 1], [1, 1, 1], [0, 1, 1], [0, 0, 1]] }, { d: [0, 0, -1], c: [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]] },
  ];
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) for (let k = 0; k < nz; k++) {
    if (!at(i, j, k)) continue;
    const col = color(min[0] + (i + 0.5) * size, min[1] + (j + 0.5) * size, min[2] + (k + 0.5) * size);
    for (const fc of FACES) {
      if (at(i + fc.d[0], j + fc.d[1], k + fc.d[2])) continue;
      if (m.indices.length >= limit * 3) { m.truncated = true; return m; }
      const base = m.positions.length / 3;
      for (const q of fc.c) { m.positions.push(min[0] + (i + q[0]) * size, min[1] + (j + q[1]) * size, min[2] + (k + q[2]) * size); m.normals.push(fc.d[0], fc.d[1], fc.d[2]); m.colors.push(col[0], col[1], col[2]); m.uvs.push(q[0], q[2]); }
      m.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
  return m;
}
