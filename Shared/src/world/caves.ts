// Caves like Minecraft's: winding tunnels everywhere under the land, a few per area, with chambers now and then, some
// branching, and some climbing to the surface where they open a hole in the ground. Every tunnel point sits a chosen
// depth below the real ground under it, so caves follow hills and valleys instead of floating where the land drops.
// All decided per 96 m cell by the seed: any chunk, built anywhere (the view, its worker, an export), gets the same caves.
import { clamp, noise3, stream } from './random';
import { chunkBounds, type HeightSampler } from './terrain';
import { surfaceNets, voxelize, type MeshData } from './generators';
import type { CaveCfg, WorldConfig } from './document';

type V3 = [number, number, number];
export interface Worm { pts: V3[]; rad: number[]; entrance: boolean }
const CELL = 96;
const STEP = 2.5;

/** Settings with their defaults (older worlds lack the newer ones). */
export function caveSettings(c: CaveCfg) {
  return {
    seed: c.seed, perCell: Math.max(0, c.tunnels) * 0.35, width: Math.max(1, c.tunnelWidth), chamber: Math.max(2, c.chamber),
    length: Math.max(10, c.size), shallow: Math.max(2, c.y), deep: Math.max(Math.max(2, c.y) + 4, c.depth ?? 40),
    entrances: clamp(c.entrances ?? 0.3), branching: clamp(c.branching), roughness: clamp(c.roughness), detail: Math.max(0.6, c.voxel),
  };
}

/** One cell's tunnels. `h` is the ground height; worms are worked out once per cell and kept. */
function cellWorms(c: ReturnType<typeof caveSettings>, h: HeightSampler, ci: number, cj: number): Worm[] {
  const r = stream(c.seed, 'cave-cell', ci, cj);
  const n = Math.floor(c.perCell) + (r.next() < c.perCell % 1 ? 1 : 0);
  const out: Worm[] = [];
  const grow = (x: number, z: number, yaw: number, length: number, depth0: number, entrance: boolean, branchable: boolean) => {
    const w: Worm = { pts: [], rad: [], entrance };
    const steps = Math.max(3, Math.round(length / STEP));
    let depth = depth0, turn = 0, chamberLeft = 0, chamberSize = 0;
    const entryLen = entrance ? Math.min(steps - 1, Math.round(16 / STEP)) : 0;
    for (let s = 0; s < steps; s++) {
      // Wanders: a slowly changing turn, and drifts up and down within the depth band.
      turn = turn * 0.82 + (r.next() - 0.5) * 0.32; yaw += turn;
      depth = clamp(depth + (r.next() - 0.5) * 1.6, c.shallow, c.deep);
      if (!chamberLeft && r.next() < 0.03 + c.branching * 0.03) { chamberLeft = 3 + r.int(0, 3); chamberSize = c.chamber * (0.4 + r.next() * 0.35); }
      let rad = c.width * 0.5 * (0.8 + 0.4 * (0.5 + 0.5 * Math.sin(s * 0.7 + ci * 3.1 + cj)));
      if (chamberLeft) { rad = Math.max(rad, chamberSize * Math.sin((Math.PI * (chamberLeft - 0.5)) / 6 + 0.3)); chamberLeft--; }
      // An entrance climbs out: from just above the ground down to its depth over the first metres.
      let d = Math.max(depth, rad + 1.8);
      if (s < entryLen) { const k = s / entryLen; d = -rad * 0.35 + (d + rad * 0.35) * k * k * (3 - 2 * k); }
      w.pts.push([x, h(x, z) - d, z]); w.rad.push(rad);
      if (branchable && s > 4 && s < steps - 4 && r.next() < c.branching * 0.05) {
        grow(x, z, yaw + (r.next() < 0.5 ? -1 : 1) * (0.7 + r.next() * 0.8), length * 0.5, depth, false, false);
      }
      x += Math.cos(yaw) * STEP; z += Math.sin(yaw) * STEP;
    }
    out.push(w);
  };
  for (let k = 0; k < n; k++) {
    const x = (ci + r.next()) * CELL, z = (cj + r.next()) * CELL, yaw = r.next() * Math.PI * 2;
    const length = c.length * (0.5 + r.next()), depth0 = c.shallow + r.next() * (c.deep - c.shallow), open = r.next() < c.entrances;
    // Openings only on gentler ground: on a steep side the tunnel would come out sideways under an overhang the
    // terrain can't make, and you'd see straight through it.
    const steep = Math.hypot(h(x + 2, z) - h(x - 2, z), h(x, z + 2) - h(x, z - 2)) / 4;
    grow(x, z, yaw, length, depth0, open && steep < 0.35, true);
  }
  return out;
}

/** The caves of a world, worked out as needed and kept per ground height (edits change where they lie). */
export function makeCaves(cfg: WorldConfig) {
  const c = caveSettings(cfg.cave);
  const byHeight = new WeakMap<HeightSampler, Map<string, Worm[]>>();
  const reach = Math.ceil((c.length * 1.5) / CELL) + 1;
  const cell = (h: HeightSampler, i: number, j: number) => {
    let m = byHeight.get(h); if (!m) { m = new Map(); byHeight.set(h, m); }
    const k = `${i},${j}`; let w = m.get(k);
    if (!w) { w = cellWorms(c, h, i, j); if (m.size > 4096) m.delete(m.keys().next().value!); m.set(k, w); }
    return w;
  };
  /** Tunnels that may pass through this box (x0..x1, z0..z1). */
  const near = (h: HeightSampler, x0: number, z0: number, x1: number, z1: number): Worm[] => {
    const out: Worm[] = [];
    const pad = c.chamber + c.width;
    for (let i = Math.floor(x0 / CELL) - reach; i <= Math.floor(x1 / CELL) + reach; i++) for (let j = Math.floor(z0 / CELL) - reach; j <= Math.floor(z1 / CELL) + reach; j++) {
      for (const w of cell(h, i, j)) if (w.pts.some((p) => p[0] > x0 - pad && p[0] < x1 + pad && p[2] > z0 - pad && p[2] < z1 + pad)) out.push(w);
    }
    return out;
  };
  /** The holes in the ground in a box: where a climbing tunnel is at or above the surface, its width round those points. */
  const openingsIn = (h: HeightSampler, x0: number, z0: number, x1: number, z1: number) => {
    const out: { x: number; z: number; r: number }[] = [];
    for (const w of near(h, x0, z0, x1, z1)) {
      if (!w.entrance) continue;
      for (let s = 0; s < Math.min(6, w.pts.length); s++) {
        const p = w.pts[s];
        if (p[1] + w.rad[s] * 0.55 >= h(p[0], p[2])) out.push({ x: p[0], z: p[2], r: w.rad[s] * 0.95 });
      }
    }
    return out;
  };
  const inside = (list: { x: number; z: number; r: number }[], x: number, z: number) => list.some((o) => (x - o.x) ** 2 + (z - o.z) ** 2 < o.r * o.r);
  /** Is the ground opened here by a tunnel reaching the surface? */
  const opening = (h: HeightSampler, x: number, z: number) => inside(openingsIn(h, x - 1, z - 1, x + 1, z + 1), x, z);
  return { settings: c, near, opening, openingsIn, inside };
}
export type Caves = ReturnType<typeof makeCaves>;

/** The cave walls inside one terrain chunk (empty where no tunnel passes). */
export function caveChunk(cfg: WorldConfig, caves: Caves, h: HeightSampler, cx: number, cz: number): MeshData | null {
  const b = chunkBounds(cfg.terrain, cx, cz), c = caves.settings;
  const worms = caves.near(h, b.x0, b.z0, b.x0 + b.size, b.z0 + b.size);
  if (!worms.length) return null;
  // Segments in or near the chunk, as capsules.
  const segs: { a: V3; b: V3; ra: number; rb: number; minX: number; maxX: number; minZ: number; maxZ: number }[] = [];
  let low = Infinity, high = -Infinity;
  for (const w of worms) for (let s = 0; s + 1 < w.pts.length; s++) {
    const a = w.pts[s], e = w.pts[s + 1], ra = w.rad[s], rb = w.rad[s + 1], m = Math.max(ra, rb) + 1.5 + c.roughness * 2;
    const minX = Math.min(a[0], e[0]) - m, maxX = Math.max(a[0], e[0]) + m, minZ = Math.min(a[2], e[2]) - m, maxZ = Math.max(a[2], e[2]) + m;
    if (maxX < b.x0 || minX > b.x0 + b.size || maxZ < b.z0 || minZ > b.z0 + b.size) continue;
    segs.push({ a, b: e, ra, rb, minX, maxX, minZ, maxZ });
    low = Math.min(low, a[1] - m, e[1] - m); high = Math.max(high, a[1] + m, e[1] + m);
  }
  if (!segs.length) return null;
  const size = c.detail, rough = c.roughness * 1.6;
  // Per column of the sampling grid, only the segments that can reach it (worked out once a column).
  const size0 = c.detail, ncol = Math.ceil(b.size / size0) + 3;
  const cols: (typeof segs | undefined)[] = new Array(ncol * ncol);
  const dist = (x: number, y: number, z: number) => {
    const ci = Math.round((x - b.x0) / size0) + 1, ck = Math.round((z - b.z0) / size0) + 1;
    const key = ci >= 0 && ci < ncol && ck >= 0 && ck < ncol ? ci + ck * ncol : -1;
    let colSegs = key >= 0 ? cols[key] : undefined;
    if (!colSegs) { colSegs = segs.filter((s) => x >= s.minX && x <= s.maxX && z >= s.minZ && z <= s.maxZ); if (key >= 0) cols[key] = colSegs; }
    if (!colSegs.length) return 1e9;
    let best = 1e9;
    for (const s of colSegs) {
      const dx = s.b[0] - s.a[0], dy = s.b[1] - s.a[1], dz = s.b[2] - s.a[2];
      const t = clamp(((x - s.a[0]) * dx + (y - s.a[1]) * dy + (z - s.a[2]) * dz) / (dx * dx + dy * dy + dz * dz || 1));
      best = Math.min(best, Math.hypot(x - s.a[0] - dx * t, y - s.a[1] - dy * t, z - s.a[2] - dz * t) - (s.ra + (s.rb - s.ra) * t));
    }
    return best;
  };
  // Stone, darker the further it is from daylight (the walls are lit like everything else, so depth does the shading).
  const tint = (x: number, y: number, z: number): V3 => {
    const n = 0.4 + noise3(c.seed + 9, x * 0.3, y * 0.3, z * 0.3) * 0.08 + noise3(c.seed + 11, x * 0.05, y * 0.12, z * 0.05) * 0.06;
    const dark = 0.18 + 0.82 * Math.exp(-Math.max(0, h(x, z) - y) / 7);
    return [n * 1.02 * dark, n * 0.97 * dark, n * 0.9 * dark];
  };
  // (Inside the chunk only: the next chunk draws its own part, so walls meet at the seam without doubling.)
  const min: V3 = [b.x0, low, b.z0], max: V3 = [b.x0 + b.size, high, b.z0 + b.size];
  if ((cfg.cave.style ?? 'smooth') === 'voxel') {
    return voxelize((x, y, z) => { if (y > h(x, z)) return false; const d = dist(x, y, z) + noise3(c.seed, x * 0.22, y * 0.22, z * 0.22) * rough; return d > 0 && d < size * 2; }, min, max, size, tint, 300000);
  }
  // Stalactites from the roofs of the wider parts (chambers), each from its own spot so chunks agree.
  const drips: { x: number; z: number; top: number; len: number; w: number }[] = [];
  const dripCount = Math.round(clamp(cfg.cave.stalactites ?? 0.3) * 4);
  if (dripCount) for (const w of worms) for (let s = 0; s < w.pts.length; s++) {
    const p = w.pts[s], rad = w.rad[s];
    if (rad < c.width * 0.75 || p[0] < b.x0 - rad || p[0] > b.x0 + b.size + rad || p[2] < b.z0 - rad || p[2] > b.z0 + b.size + rad) continue;
    const r = stream(c.seed, 'drip', Math.round(p[0] * 4), Math.round(p[2] * 4));
    for (let k = 0; k < dripCount; k++) { const a = r.next() * Math.PI * 2, d = r.next() * rad * 0.7; drips.push({ x: p[0] + Math.cos(a) * d, z: p[2] + Math.sin(a) * d, top: p[1] + rad * 0.85, len: (0.6 + r.next() * 1.6) * Math.max(1, rad * 0.25), w: 0.18 + r.next() * 0.27 }); }
  }
  const field = (x: number, y: number, z: number) => {
    let d = dist(x, y, z);
    if (d > 6) return d;
    d += noise3(c.seed, x * 0.22, y * 0.22, z * 0.22) * rough + noise3(c.seed + 5, x * 0.7, y * 0.7, z * 0.7) * rough * 0.3;
    for (const s of drips) { const t = (s.top - y) / s.len; if (t < -0.2 || t > 1) continue; const rr = s.w * (1 - Math.max(0, t)); d = Math.max(d, rr - Math.hypot(x - s.x, z - s.z)); }
    return d;
  };
  // Only underground: where a tunnel reaches the surface it simply opens (the terrain has its hole there).
  return surfaceNets(field, min, max, size, tint, (x, y, z) => y < h(x, z) + 0.4, 300000);
}
