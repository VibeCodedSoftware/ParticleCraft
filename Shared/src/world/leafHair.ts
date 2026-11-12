// Leaf particles: leaves grown out of the surface of the wood, the way a hair particle system grows strands from a mesh.
// Every leaf starts on a branch and points out from it, so it is attached to that branch. Works on generated branches and
// on the triangles of a supplied tree model. Same seed and settings, same leaves.
import { clamp, lerp, Rng } from './random';
import type { LeafHairCfg } from './document';
import type { LeafPoint } from './generators';

type V3 = [number, number, number];
const norm = (a: V3): V3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

export const hairDefaults = (): LeafHairCfg => ({ amount: 1, where: 'tips', fromStage: 0, start: 0.3, end: 1, tipBias: 0.35, length: 0, angle: 55, random: 0.35, droop: 0.25, sizeRandom: 0.25, clumps: 1, clumpSize: 0.3, limit: 11000 });
/** For a supplied model: there is no list of branches, so thin wood is told by how small its triangles are. */
export const modelHairDefaults = (): LeafHairCfg => ({ ...hairDefaults(), start: 0.3, tipBias: 0.2, clumps: 2, clumpSize: 0.5, amount: 1, limit: 6000, size: 4, thinOnly: 0.5, picture: 'lib:world/leaves/Leaves-Stylized.png' });

/** One leaf (or a clump) on the wood. `radial` points out of the surface; `dir` runs along the branch. */
export function growLeaf(out: LeafPoint[], h: LeafHairCfg, r: Rng, surface: V3, dir: V3, radial: V3, size: number, flex: number, scatter = 0) {
  const a = (clamp(h.angle, 0, 180) * Math.PI) / 180, co = Math.cos(a), si = Math.sin(a);
  const clumps = Math.max(1, Math.round(h.clumps));
  for (let k = 0; k < clumps && out.length < h.limit; k++) {
    const rnd = h.random * (k ? 1.3 : 1);
    let d: V3 = norm([dir[0] * co + radial[0] * si + r.range(-1, 1) * rnd, dir[1] * co + radial[1] * si + r.range(-1, 1) * rnd - h.droop, dir[2] * co + radial[2] * si + r.range(-1, 1) * rnd]);
    if (!Number.isFinite(d[0])) d = radial;
    // Faces the sky as far as it can while pointing along d, with some random roll.
    const up: V3 = norm([r.range(-1, 1) * h.random, 1, r.range(-1, 1) * h.random]);
    let n: V3 = [up[0] - d[0] * dot(up, d), up[1] - d[1] * dot(up, d), up[2] - d[2] * dot(up, d)];
    if (Math.hypot(n[0], n[1], n[2]) < 0.05) n = cross(d, [1, 0, 0]);
    n = norm(n);
    const off = k ? size * h.clumpSize : 0, reach = h.length + scatter * r.next();
    out.push({
      p: [surface[0] + d[0] * reach + r.range(-off, off), surface[1] + d[1] * reach + r.range(-off, off), surface[2] + d[2] * reach + r.range(-off, off)],
      n, d, size: size * (1 + r.range(-1, 1) * clamp(h.sizeRandom)), seed: r.int(0, 1 << 30), flex,
    });
  }
}

/** How many leaves, weighted to the tip: where along a branch (0 base, 1 tip) the next one goes. */
export const alongBranch = (h: LeafHairCfg, r: Rng) => lerp(h.start, Math.max(h.start, h.end), Math.pow(r.next(), 1 - clamp(h.tipBias) * 0.85));

/**
 * Leaves over the triangles of a model, weighted by area, like hair emitted from faces. Heights run from the base (0) to
 * the top (1) instead of along each branch. `tri` gives triangle i's three corners in the model's own space.
 */
export function hairOnMesh(triCount: number, tri: (i: number, a: V3, b: V3, c: V3) => void, h: LeafHairCfg, seed: number): LeafPoint[] {
  const out: LeafPoint[] = [];
  const a: V3 = [0, 0, 0], b: V3 = [0, 0, 0], c: V3 = [0, 0, 0];
  // A sample of triangles is plenty, and keeps a 500,000-triangle tree quick.
  const every = Math.max(1, Math.floor(triCount / 60000));
  const edges: number[] = [], ids: number[] = [], areas: number[] = [];
  let minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < triCount; i += every) {
    tri(i, a, b, c);
    minY = Math.min(minY, a[1], b[1], c[1]); maxY = Math.max(maxY, a[1], b[1], c[1]);
    const ab: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], ac: V3 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const cr = cross(ab, ac);
    edges.push(Math.max(Math.hypot(ab[0], ab[1], ab[2]), Math.hypot(ac[0], ac[1], ac[2]), Math.hypot(b[0] - c[0], b[1] - c[1], b[2] - c[2])));
    ids.push(i); areas.push(Math.hypot(cr[0], cr[1], cr[2]) / 2);
  }
  if (!ids.length || maxY <= minY) return out;
  const H = maxY - minY;
  const sorted = [...edges].sort((x, y) => x - y);
  const maxEdge = sorted[Math.min(sorted.length - 1, Math.floor(clamp(h.thinOnly ?? 1) * (sorted.length - 1)))];
  const picks: number[] = [], cum: number[] = []; let total = 0;
  for (let k = 0; k < ids.length; k++) {
    if (edges[k] > maxEdge) continue;
    tri(ids[k], a, b, c);
    const y = ((a[1] + b[1] + c[1]) / 3 - minY) / H;
    if (y < h.start || y > h.end) continue;
    // Tip bias here: higher wood is more likely.
    total += areas[k] * lerp(1, y * y * 4, clamp(h.tipBias));
    picks.push(ids[k]); cum.push(total);
  }
  if (!picks.length || total <= 0) return out;
  const r = new Rng(seed);
  const size = (H * (h.size ?? 4)) / 100, count = Math.min(h.limit, Math.round(3000 * Math.max(0, h.amount)));
  for (let n = 0; n < count && out.length < h.limit; n++) {
    const t = r.next() * total;
    let lo = 0, hi = cum.length - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (cum[m] < t) lo = m + 1; else hi = m; }
    tri(picks[lo], a, b, c);
    const u = Math.sqrt(r.next()), v = r.next();
    const p: V3 = [a[0] * (1 - u) + (b[0] * (1 - v) + c[0] * v) * u, a[1] * (1 - u) + (b[1] * (1 - v) + c[1] * v) * u, a[2] * (1 - u) + (b[2] * (1 - v) + c[2] * v) * u];
    const radial = norm(cross([b[0] - a[0], b[1] - a[1], b[2] - a[2]], [c[0] - a[0], c[1] - a[1], c[2] - a[2]]));
    // Along the branch: a cylinder's long edge runs along it. Pointing away from the base.
    const pairs: [V3, V3][] = [[a, b], [b, c], [c, a]];
    let best: V3 = [0, 1, 0], len = 0;
    for (const [e, f] of pairs) { const g: V3 = [f[0] - e[0], f[1] - e[1], f[2] - e[2]], l = Math.hypot(g[0], g[1], g[2]); if (l > len) { len = l; best = g; } }
    let dir = norm(best); if (dir[1] < 0) dir = [-dir[0], -dir[1], -dir[2]];
    growLeaf(out, { ...h, length: (h.length * H) / 12 }, r, p, dir, radial, size, 1);
  }
  return out;
}
