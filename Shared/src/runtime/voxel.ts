// Voxel terrain: a block grid that can be dug out and built up at runtime (terraforming / excavation).
// Engine-agnostic: generation, editing, ray picking and collision boxes live here; renderers mesh the grid.
// The grid sits on the instance position: x/z centered, bottom at instance Y. Instance rotation/scale are ignored
// (the cell size sets the scale).
import type { AABB } from './world';

export interface VoxelData {
  /** Cells along X, Y, Z. */
  size: [number, number, number];
  /** Cell edge in meters. */
  cell: number;
  seed: number;
  /** Average ground height in cells, and how much hills vary (cells). */
  surface: number;
  hills: number;
  /** Chance (0..1) that a stone cell is gold ore. */
  gold: number;
  colors?: Partial<Record<'grass' | 'dirt' | 'stone' | 'gold' | 'bedrock' | 'sand', string>>;
}

/** Cell materials. 0 = air. Bedrock cannot be dug. */
export const VOXEL = { air: 0, grass: 1, dirt: 2, stone: 3, gold: 4, bedrock: 5, sand: 6 } as const;
export const VOXEL_COLORS: Record<number, string> = { 1: '#5fa043', 2: '#7a5232', 3: '#7d7f86', 4: '#e8c33a', 5: '#3b3c40', 6: '#d9c38a' };

export interface VoxelGrid {
  nx: number; ny: number; nz: number; cell: number;
  /** World position of the grid's min corner. */
  origin: [number, number, number];
  data: Uint8Array;
  /** Bumped on every edit (renderers rebuild when it changes). */
  version: number;
}

export const DEFAULT_VOXEL: VoxelData = { size: [80, 20, 80], cell: 0.5, seed: 7, surface: 12, hills: 3, gold: 0.02 };

function hash(x: number, y: number, s: number) {
  let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
function smooth(t: number) { return t * t * (3 - 2 * t); }
/** 2D value noise in [0, 1]. */
function noise(x: number, y: number, s: number) {
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = smooth(x - x0), fy = smooth(y - y0);
  const a = hash(x0, y0, s), b = hash(x0 + 1, y0, s), c = hash(x0, y0 + 1, s), d = hash(x0 + 1, y0 + 1, s);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

export function generateVoxels(v: VoxelData, pos: [number, number, number] = [0, 0, 0]): VoxelGrid {
  const [nx, ny, nz] = v.size;
  const data = new Uint8Array(nx * ny * nz);
  const g: VoxelGrid = { nx, ny, nz, cell: v.cell, origin: [pos[0] - (nx * v.cell) / 2, pos[1], pos[2] - (nz * v.cell) / 2], data, version: 1 };
  for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) {
    const n = noise(x / 14, z / 14, v.seed) * 0.7 + noise(x / 5, z / 5, v.seed + 1) * 0.3;
    const h = Math.max(2, Math.min(ny - 1, Math.round(v.surface + (n - 0.5) * 2 * v.hills)));
    for (let y = 0; y < h; y++) {
      let m: number = y === 0 ? VOXEL.bedrock : y >= h - 1 ? VOXEL.grass : y >= h - 4 ? VOXEL.dirt : VOXEL.stone;
      if (m === VOXEL.stone && hash(x * 31 + y, z * 17 + y * 7, v.seed + 9) < v.gold) m = VOXEL.gold;
      data[(y * nz + z) * nx + x] = m;
    }
  }
  return g;
}

export const vidx = (g: VoxelGrid, x: number, y: number, z: number) => (y * g.nz + z) * g.nx + x;
export function voxelAt(g: VoxelGrid, x: number, y: number, z: number) {
  return x < 0 || y < 0 || z < 0 || x >= g.nx || y >= g.ny || z >= g.nz ? 0 : g.data[vidx(g, x, y, z)];
}
/** Cell containing a world point. */
export function cellOf(g: VoxelGrid, p: [number, number, number]): [number, number, number] {
  return [Math.floor((p[0] - g.origin[0]) / g.cell), Math.floor((p[1] - g.origin[1]) / g.cell), Math.floor((p[2] - g.origin[2]) / g.cell)];
}
/** World center of a cell. */
export function cellCenter(g: VoxelGrid, c: [number, number, number]): [number, number, number] {
  return [g.origin[0] + (c[0] + 0.5) * g.cell, g.origin[1] + (c[1] + 0.5) * g.cell, g.origin[2] + (c[2] + 0.5) * g.cell];
}
/** Height of the highest solid cell top in a column (world Y), or the grid bottom. */
export function surfaceY(g: VoxelGrid, wx: number, wz: number): number {
  const x = Math.floor((wx - g.origin[0]) / g.cell), z = Math.floor((wz - g.origin[2]) / g.cell);
  for (let y = g.ny - 1; y >= 0; y--) if (voxelAt(g, x, y, z)) return g.origin[1] + (y + 1) * g.cell;
  return g.origin[1];
}

/**
 * Set every cell within `radius` (meters) of a world point to `material` (0 digs). Returns how many cells of each
 * material were changed. Bedrock is never removed; when building, cells overlapping `keepClear` boxes are skipped.
 */
export function editSphere(g: VoxelGrid, center: [number, number, number], radius: number, material: number, keepClear: AABB[] = []): Record<number, number> {
  const out: Record<number, number> = {};
  const c = cellOf(g, center), r = Math.ceil(radius / g.cell);
  for (let y = c[1] - r; y <= c[1] + r; y++) for (let z = c[2] - r; z <= c[2] + r; z++) for (let x = c[0] - r; x <= c[0] + r; x++) {
    if (x < 0 || y < 0 || z < 0 || x >= g.nx || y >= g.ny || z >= g.nz) continue;
    const w = cellCenter(g, [x, y, z]);
    if (Math.hypot(w[0] - center[0], w[1] - center[1], w[2] - center[2]) > radius + g.cell * 0.25) continue;
    const i = vidx(g, x, y, z), old = g.data[i];
    if (old === material || old === VOXEL.bedrock) continue;
    if (material) {
      if (old) continue; // building only fills air
      const half = g.cell / 2;
      if (keepClear.some((b) => w[0] + half > b[0] && w[0] - half < b[3] && w[1] + half > b[1] && w[1] - half < b[4] && w[2] + half > b[2] && w[2] - half < b[5])) continue;
    }
    g.data[i] = material;
    const k = material ? material : old;
    out[k] = (out[k] ?? 0) + 1;
  }
  if (Object.keys(out).length) g.version++;
  return out;
}

export interface VoxelHit { dist: number; cell: [number, number, number]; normal: [number, number, number]; point: [number, number, number]; material: number }

/** First solid cell along a ray (Amanatides–Woo grid traversal). */
export function voxelRaycast(g: VoxelGrid, o: [number, number, number], dir: [number, number, number], maxDist: number): VoxelHit | null {
  const len = Math.hypot(dir[0], dir[1], dir[2]) || 1;
  const d = [dir[0] / len, dir[1] / len, dir[2] / len];
  // Start at the grid's bounding box if the origin is outside it.
  const lo = g.origin, hi = [g.origin[0] + g.nx * g.cell, g.origin[1] + g.ny * g.cell, g.origin[2] + g.nz * g.cell];
  let t0 = 0, t1 = maxDist;
  for (let a = 0; a < 3; a++) {
    if (Math.abs(d[a]) < 1e-9) { if (o[a] < lo[a] || o[a] > hi[a]) return null; continue; }
    let ta = (lo[a] - o[a]) / d[a], tb = (hi[a] - o[a]) / d[a];
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
    if (t0 > t1) return null;
  }
  const p = [o[0] + d[0] * (t0 + 1e-6), o[1] + d[1] * (t0 + 1e-6), o[2] + d[2] * (t0 + 1e-6)];
  const c = cellOf(g, p as [number, number, number]).map((v, a) => Math.min([g.nx, g.ny, g.nz][a] - 1, Math.max(0, v)));
  const step = d.map((v) => (v > 0 ? 1 : -1));
  const tMax = [0, 1, 2].map((a) => { if (Math.abs(d[a]) < 1e-9) return Infinity; const edge = g.origin[a] + (c[a] + (step[a] > 0 ? 1 : 0)) * g.cell; return t0 + (edge - p[a]) / d[a]; });
  const tDelta = d.map((v) => (Math.abs(v) < 1e-9 ? Infinity : g.cell / Math.abs(v)));
  let t = t0;
  let normal: [number, number, number] = [0, 0, 0];
  for (let n = 0; n < 4096 && t <= t1; n++) {
    const m = voxelAt(g, c[0], c[1], c[2]);
    if (m) return { dist: t, cell: [c[0], c[1], c[2]], normal, point: [o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t], material: m };
    const a = tMax[0] < tMax[1] ? (tMax[0] < tMax[2] ? 0 : 2) : tMax[1] < tMax[2] ? 1 : 2;
    c[a] += step[a]; t = tMax[a]; tMax[a] += tDelta[a];
    normal = [0, 0, 0]; normal[a] = -step[a];
    if (c[a] < 0 || c[a] >= [g.nx, g.ny, g.nz][a]) return null;
  }
  return null;
}

/** Solid cells overlapping a world box, merged into x-runs, as AABBs (for collision). */
export function voxelBoxesIn(g: VoxelGrid, r: AABB): AABB[] {
  const out: AABB[] = [];
  const x0 = Math.max(0, Math.floor((r[0] - g.origin[0]) / g.cell)), x1 = Math.min(g.nx - 1, Math.floor((r[3] - g.origin[0]) / g.cell));
  const y0 = Math.max(0, Math.floor((r[1] - g.origin[1]) / g.cell)), y1 = Math.min(g.ny - 1, Math.floor((r[4] - g.origin[1]) / g.cell));
  const z0 = Math.max(0, Math.floor((r[2] - g.origin[2]) / g.cell)), z1 = Math.min(g.nz - 1, Math.floor((r[5] - g.origin[2]) / g.cell));
  for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) {
    let x = x0;
    while (x <= x1) {
      if (!g.data[vidx(g, x, y, z)]) { x++; continue; }
      const s = x; while (x <= x1 && g.data[vidx(g, x, y, z)]) x++;
      out.push([g.origin[0] + s * g.cell, g.origin[1] + y * g.cell, g.origin[2] + z * g.cell, g.origin[0] + x * g.cell, g.origin[1] + (y + 1) * g.cell, g.origin[2] + (z + 1) * g.cell]);
    }
  }
  return out;
}

/** Full bounds of the grid volume. */
export function voxelBounds(g: VoxelGrid): AABB {
  return [g.origin[0], g.origin[1], g.origin[2], g.origin[0] + g.nx * g.cell, g.origin[1] + g.ny * g.cell, g.origin[2] + g.nz * g.cell];
}
