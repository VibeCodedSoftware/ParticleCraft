// Non-destructive scattering: instances are worked out from the layer's rules, per chunk and from the seed, every time.
// Change a rule and the world updates; change nothing and every object comes back in the same place, in any chunk order.
import { clamp, hashInts, noise2, smoothstep, stream } from './random';
import { gridMask, sampleEdits, slopeAt, terrainLayerPaint, type HeightSampler } from './terrain';
import { biomeAt, biomeDensity, biomeGrass, snowAt } from './biomes';
import { parseGenId, regionStyle, styleOf, variantCount } from './generators';
import type { Placed, ScatterLayer, StructureSpawn, WorldConfig, WorldEdits } from './document';

/** Every random shape a source can come in: generated trees and rocks have several, anything else one. */
export function sourceVariants(src: string, cfg?: Pick<WorldConfig, 'trees'>): string[] {
  const g = parseGenId(src);
  if (!g || g.variant) return [src];
  return Array.from({ length: variantCount(cfg, g) }, (_, v) => (v ? `${src}~${v}` : src));
}

export interface ScatterInstance { x: number; y: number; z: number; ry: number; scale: number; nx: number; ny: number; nz: number; source: string; /** Stable id: survives reloads, used for "collected" state. */ uid: string; tint: number }

const DEFAULT_LAYER: Omit<ScatterLayer, 'id' | 'name' | 'kind' | 'sources'> = {
  enabled: true, seed: 1, density: 2, minScale: 0.8, maxScale: 1.25, randomRotation: true, align: 0.5, minSlope: 0, maxSlope: 0.35,
  minHeight: -1000, maxHeight: 10000, biomes: [], clustering: 0.3, clusterSize: 22, spacing: 0, avoid: false, faceCamera: false, moves: true,
};
export const makeLayer = (o: Partial<ScatterLayer> & { id: string; name: string; kind: ScatterLayer['kind']; sources: string[] }): ScatterLayer => ({ ...DEFAULT_LAYER, ...o });

/** Fall colours for "Randomize colour": yellow, orange, red, brown. */
export const FALL_COLORS = ['#d9a521', '#d9701f', '#b8392a', '#8a5a30'];
/** Which fall colour this plant takes, or -1 for its own. Decided by its seeded tint, so it's the same every time and in every app. */
export const fallIndex = (l: ScatterLayer, tint: number) => { const s = l.fallShare ?? 0.4; return l.randomColor && s > 0 && tint < s ? Math.min(3, Math.floor((tint / s) * 4)) : -1; };

export interface ScatterContext { cfg: WorldConfig; edits: WorldEdits | null; height: HeightSampler; /** Other things already standing: { x, z, r }. */ obstacles?: { x: number; z: number; r: number }[];
  /** The surface of rivers and lakes here, or -Infinity: nothing grows under water. */ water?: (x: number, z: number) => number;
  /** Roads: nothing grows on them. */ onRoad?: (x: number, z: number) => boolean }

/** A layer's instances in one square of the world. Cells straddling the edge belong to the chunk holding their centre. */
export function scatterSquare(ctx: ScatterContext, layer: ScatterLayer, x0: number, z0: number, size: number, limit = 400000): ScatterInstance[] {
  if (!layer.enabled || layer.density <= 0 || !layer.sources.length) return [];
  const out: ScatterInstance[] = [];
  const { cfg, edits } = ctx;
  // One candidate per grid cell: the grid is global, so results don't depend on chunk size or which chunk asks first.
  const cell = Math.max(0.25, Math.sqrt(100 / layer.density));
  // Dense grass: tens of thousands of blades a chunk, so the land's height is read from a 2 m grid (about the terrain
  // mesh's own detail) instead of being worked out for each one. The grid is global too, so chunks still agree.
  const fast = layer.kind === 'grass' && cell < 2.5;
  const cached = new Map<number, number>();
  const gridH = (i: number, j: number) => { const k = (i + 1048576) * 2097152 + (j + 1048576); let v = cached.get(k); if (v === undefined) { v = ctx.height(i * 2, j * 2); cached.set(k, v); } return v; };
  const height: HeightSampler = !fast ? ctx.height : (px, pz) => {
    const fx = px / 2, fz = pz / 2, i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
    return (gridH(i, j) * (1 - u) + gridH(i + 1, j) * u) * (1 - v) + (gridH(i, j + 1) * (1 - u) + gridH(i + 1, j + 1) * u) * v;
  };
  // Rock painted by terrain layers, from a 4 m grid (it's a whole hillside, not a detail).
  const paintsRock = !!cfg.terrain.layers?.some((L) => L.enabled && L.paint === 'rock');
  const rockCache = new Map<number, number>();
  const rockHere = (x: number, z: number) => { const k = (Math.floor(x / 4) + 1048576) * 2097152 + (Math.floor(z / 4) + 1048576); let r = rockCache.get(k); if (r === undefined) { r = terrainLayerPaint(cfg.terrain, Math.floor(x / 4) * 4 + 2, Math.floor(z / 4) * 4 + 2).rock ?? 0; rockCache.set(k, r); } return r; };
  const biomeCache = new Map<number, string>();
  const biomeHere = (x: number, z: number, y: number) => {
    if (!fast) return biomeAt(cfg, edits, x, z, y).id;
    // (A 4 m grid: at 8 m the grass's edge along a biome border came out as big square steps.)
    const k = (Math.floor(x / 4) + 1048576) * 2097152 + (Math.floor(z / 4) + 1048576);
    let b = biomeCache.get(k); if (b === undefined) { b = biomeAt(cfg, edits, x, z, y).id; biomeCache.set(k, b); }
    return b;
  };
  const small = layer.kind === 'grass' || layer.kind === 'flower' || layer.kind === 'debris' || layer.kind === 'bush';
  const winter = !!cfg.season?.enabled && cfg.season.season === 'winter';
  // (Snow for dense grass from a 3 m grid, like its height: tens of thousands of blades a chunk.)
  const snowCache = new Map<number, number>();
  const snowHere = (x: number, z: number, y: number, slope: number, normal: [number, number, number]) => {
    if (!fast) return snowAt(cfg, edits, x, z, y, slope, normal);
    const k = (Math.floor(x / 3) + 1048576) * 2097152 + (Math.floor(z / 3) + 1048576);
    let s = snowCache.get(k); if (s === undefined) { s = snowAt(cfg, edits, x, z, y, slope, normal); snowCache.set(k, s); }
    return s;
  };
  const ax = Math.floor(x0 / cell), bx = Math.ceil((x0 + size) / cell), az = Math.floor(z0 / cell), bz = Math.ceil((z0 + size) / cell);
  const spaced: { x: number; z: number }[] = [];
  for (let i = ax; i < bx; i++) for (let j = az; j < bz; j++) {
    const r = stream(hashInts(cfg.terrain.seed, layer.seed), layer.id, i, j);
    const x = (i + r.next()) * cell, z = (j + r.next()) * cell;
    const roll = r.next(), ry = r.next(), sc = r.next(), pick = r.next(), tint = r.next();
    if (x < x0 || x >= x0 + size || z < z0 || z >= z0 + size) continue;
    if (!cfg.terrain.endless && (Math.abs(x) > cfg.terrain.width / 2 || Math.abs(z) > cfg.terrain.depth / 2)) continue;
    // Painted density: 0 erases; none painted = 1 (0 on a layer that only grows where painted).
    const unpainted = layer.paintOnly ? 0 : 1;
    let paint = edits?.density[layer.id] ? sampleEdits(edits.density[layer.id], edits.cell, x, z, unpainted) : unpainted;
    // (Plants don't root in rock a terrain layer paints, except on its flat ledges.)
    if (paintsRock && layer.kind !== 'rock' && layer.kind !== 'prop' && layer.kind !== 'debris' && rockHere(x, z) > 0.5 && (layer.kind === 'tree' || slopeAt(height, x, z).slope > 0.12)) continue;
    if (layer.paintOnly && edits?.grids?.length) paint = Math.max(paint, gridMask(edits, 'density', layer.id, x, z) ?? 0);
    if (paint <= 0) continue;
    // Grass grows as real grass does: in dense patches with soft edges, never as a scattering of lone tufts. Everything
    // that thins it (clumping, slope, snow, winter, dry biomes) adds up to one smooth "how grassy is it here", and a
    // spot either has grass at the full density or none: patches, and bare ground between them.
    const isGrass = layer.kind === 'grass';
    let keep = paint, patch = 1;
    if (layer.clustering > 0) {
      const n = noise2(layer.seed + 3331, x / Math.max(1, layer.clusterSize), z / Math.max(1, layer.clusterSize));
      if (isGrass) patch = clamp(0.62 + n * layer.clustering * 1.5 + (1 - layer.clustering) * 0.3);
      else keep *= clamp(1 - layer.clustering + n * layer.clustering * 3.4);
    }
    if (!isGrass && roll > keep) continue;
    const y = height(x, z);
    if (y < layer.minHeight || y > layer.maxHeight) continue;
    if (cfg.water.enabled && y < cfg.water.level + 0.2) continue;
    if (ctx.water && y < ctx.water(x, z) + 0.15) continue;
    if (ctx.onRoad?.(x, z)) continue;
    const { slope, normal } = slopeAt(height, x, z, Math.max(0.5, cell * 0.25));
    if (slope < layer.minSlope || slope > layer.maxSlope) continue;
    if (isGrass) {
      let here = Math.min(1, paint) * patch;
      // Steep ground: grass thins out well before the steepest slope it may grow on, so none clings to a steep face.
      here *= 1 - smoothstep(layer.maxSlope * 0.55, layer.maxSlope, slope);
      // Snow covers it (only its edges let grass through); winter grass is thinner.
      const sn = snowHere(x, z, y, slope, normal);
      if (sn > 0.02) here *= 1 - smoothstep(0.05, 0.45, sn);
      if (winter) here *= 0.75;
      if (cfg.biomes.enabled) {
        const b = biomeHere(x, z, y);
        if (layer.biomes.length && !layer.biomes.includes(b)) continue;
        // (Thinner where a biome is poor for grass, but still a cover: rocky ground and tundra were left bare in patches
        // of their own colour. Desert and beach, almost none.)
        if (!layer.biomes.length) { const g = biomeGrass(cfg, b); here *= g >= 0.2 ? clamp(0.72 + g * 0.4) : g * 3; }
      }
      // The patch edge: a smooth wandering line (not each blade's own dice), softened a little.
      const edge = 0.4 + (noise2(layer.seed + 777, x * 0.35, z * 0.35) * 0.55 + noise2(layer.seed + 778, x * 1.1, z * 1.1) * 0.2) * 0.45;
      if (here < edge + (roll - 0.5) * 0.08) continue;
    } else {
      // Snow covers small plants: where it lies, flowers, bushes and debris thin out. Trees and rocks stand in snow.
      if (small) {
        const sn = snowHere(x, z, y, slope, normal), r2 = (ry * 7.31) % 1;
        if (sn > 0.02 && r2 < Math.pow(sn, 0.6) * 0.98) continue;
      }
      if (cfg.biomes.enabled) {
        const b = biomeHere(x, z, y);
        if (layer.biomes.length ? !layer.biomes.includes(b) : roll > keep * clamp(biomeDensity(cfg, b))) continue;
      }
    }
    if (layer.avoid && ctx.obstacles?.some((o) => (o.x - x) ** 2 + (o.z - z) ** 2 < o.r * o.r)) continue;
    if (layer.spacing > 0) {
      if (spaced.some((p) => (p.x - x) ** 2 + (p.z - z) ** 2 < layer.spacing * layer.spacing)) continue;
      spaced.push({ x, z });
    }
    const a = clamp(layer.align);
    const nl = Math.hypot(normal[0] * a, 1 - a + normal[1] * a, normal[2] * a) || 1;
    // Mixed worlds: only the sources of this region's look (sources with no look of their own go anywhere).
    let pool = layer.sources;
    if (layer.regional && pool.length > 1) {
      const here = regionStyle(cfg.terrain.seed, x, z);
      const mine = pool.filter((s) => { const st = styleOf(s); return st === here || st === null; });
      if (mine.length) pool = mine;
    }
    const f = pick * pool.length, src = pool[Math.floor(f) % pool.length];
    // A source that grows thinner than the layer (a mixed world's clump grass beside its blade grass): thinned to its own.
    const own = layer.sourceDensity?.[src];
    if (own !== undefined && own < layer.density && roll / Math.max(1e-6, keep) > own / layer.density) continue;
    // A generated tree or rock: one of its random shapes, so neighbours differ.
    const g = parseGenId(src), variant = g && !g.variant ? Math.floor((f - Math.floor(f)) * variantCount(cfg, g)) : 0;
    out.push({
      x, y, z, ry: layer.randomRotation ? ry * 360 : 0, scale: layer.minScale + (layer.maxScale - layer.minScale) * sc,
      nx: (normal[0] * a) / nl, ny: (1 - a + normal[1] * a) / nl, nz: (normal[2] * a) / nl,
      source: variant ? `${src}~${variant}` : src, uid: `${layer.id}:${i}:${j}`, tint,
    });
    if (out.length >= limit) return out;
  }
  return out;
}

/** A new structure set: scattered thinly, on flat-ish ground. */
export const makeSpawn = (id: string, name: string): StructureSpawn => ({ id, name, enabled: true, seed: 4217, assets: [], mode: 'scatter', fixed: [], region: { x: 0, z: 0, w: 400, d: 400 }, cell: 80, chance: 0.5, minDistance: 40, minHeight: -1000, maxHeight: 10000, maxSlope: 0.15, biomes: [], fixedRotation: 0, randomRotation: true, scale: 1, persistent: true });

export interface SpawnedStructure { spawn: string; asset: string; x: number; y: number; z: number; ry: number; scale: number; uid: string }

/**
 * Where structures stand. Decided only by the seed and the rules for each cell of the spawn grid, so a chunk that is
 * unloaded and revisited gets exactly the same buildings, and a building never depends on which chunks came first.
 */
export function structuresInSquare(ctx: ScatterContext, sp: StructureSpawn, x0: number, z0: number, size: number): SpawnedStructure[] {
  if (!sp.enabled || !sp.assets.length) return [];
  const { cfg, edits, height } = ctx, out: SpawnedStructure[] = [];
  const asset = (r: { next(): number }) => sp.assets[Math.floor(r.next() * sp.assets.length) % sp.assets.length];
  const ok = (x: number, z: number, y: number) => {
    if (y < sp.minHeight || y > sp.maxHeight) return false;
    if (slopeAt(height, x, z, 2).slope > sp.maxSlope) return false;
    if (cfg.water.enabled && y < cfg.water.level + 0.5) return false;
    if (sp.biomes.length && !sp.biomes.includes(biomeAt(cfg, edits, x, z, y).id)) return false;
    return true;
  };
  if (sp.mode === 'fixed') {
    sp.fixed.forEach((f, n) => {
      if (f.x < x0 || f.x >= x0 + size || f.z < z0 || f.z >= z0 + size) return;
      const r = stream(sp.seed, sp.id, n);
      out.push({ spawn: sp.id, asset: asset(r), x: f.x, y: height(f.x, f.z), z: f.z, ry: f.ry, scale: sp.scale, uid: `${sp.id}:f${n}` });
    });
    return out;
  }
  const cell = Math.max(4, sp.cell);
  // Candidates in a wider area than asked for: the minimum distance is checked against neighbours whichever chunk asks.
  const cand = (i: number, j: number) => {
    const r = stream(sp.seed, sp.id, i, j);
    if (r.next() > sp.chance) return null;
    const x = (i + 0.15 + r.next() * 0.7) * cell, z = (j + 0.15 + r.next() * 0.7) * cell;
    const a = asset(r), ry = sp.randomRotation ? r.next() * 360 : sp.fixedRotation;
    if (sp.mode === 'region' && (Math.abs(x - sp.region.x) > sp.region.w / 2 || Math.abs(z - sp.region.z) > sp.region.d / 2)) return null;
    if (!cfg.terrain.endless && (Math.abs(x) > cfg.terrain.width / 2 || Math.abs(z) > cfg.terrain.depth / 2)) return null;
    const y = height(x, z);
    return ok(x, z, y) ? { x, y, z, a, ry, key: hashInts(i, j, sp.seed) } : null;
  };
  const ax = Math.floor(x0 / cell), bx = Math.ceil((x0 + size) / cell), az = Math.floor(z0 / cell), bz = Math.ceil((z0 + size) / cell);
  const reach = Math.ceil(sp.minDistance / cell);
  for (let i = ax; i < bx; i++) for (let j = az; j < bz; j++) {
    const c = cand(i, j);
    if (!c || c.x < x0 || c.x >= x0 + size || c.z < z0 || c.z >= z0 + size) continue;
    // Too close to a neighbour: the one with the lower key stands. Symmetric, so both chunks agree.
    let beaten = false;
    for (let a = -reach; a <= reach && !beaten; a++) for (let b = -reach; b <= reach && !beaten; b++) {
      if (!a && !b) continue;
      const o = cand(i + a, j + b);
      if (o && Math.hypot(o.x - c.x, o.z - c.z) < sp.minDistance && o.key < c.key) beaten = true;
    }
    if (!beaten) out.push({ spawn: sp.id, asset: c.a, x: c.x, y: c.y, z: c.z, ry: c.ry, scale: sp.scale, uid: `${sp.id}:${i}:${j}` });
  }
  return out;
}

/** Y of a placed object that snaps to the ground. */
export const placedY = (p: Placed, height: HeightSampler) => (p.snap ? height(p.x, p.z) : p.y);
