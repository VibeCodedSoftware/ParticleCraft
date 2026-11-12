// Grid-based A* pathfinding on the world plane. Obstacles are Solid instances; the grid is rebuilt
// when solids change (World.solidsVersion).
import type { RInstance, World } from './world';

export interface NavGrid {
  version: number; cell: number; radius: number;
  originA: number; originB: number; w: number; h: number;
  blocked: Uint8Array;
  floorTop: number;
}

const grids = new WeakMap<World, Map<string, NavGrid>>();

/** Plane coordinates: (a, b) = (x, z) in 3D, (x, y) in 2D. */
export function planeAB(world: World, i: { x: number; y: number; z: number }): [number, number] {
  return world.plane === 'xz' ? [i.x, i.z] : [i.x, i.y];
}

export function getGrid(world: World, cell: number, radius: number, agentBottom: number): NavGrid {
  let m = grids.get(world);
  if (!m) { m = new Map(); grids.set(world, m); }
  const key = `${cell}|${radius}|${Math.round(agentBottom * 4)}`;
  const g = m.get(key);
  if (g && g.version === world.solidsVersion) return g;
  const built = buildGrid(world, cell, radius, agentBottom);
  m.set(key, built);
  return built;
}

function buildGrid(world: World, cell: number, radius: number, agentBottom: number): NavGrid {
  const solids = world.solids();
  const b = world.scene.settings.bounds;
  let minA = -50, minB = -50, maxA = 50, maxB = 50;
  if (b) {
    [minA, minB] = world.plane === 'xz' ? [b.min[0], b.min[2]] : [b.min[0], b.min[1]];
    [maxA, maxB] = world.plane === 'xz' ? [b.max[0], b.max[2]] : [b.max[0], b.max[1]];
  } else if (solids.length) {
    minA = minB = Infinity; maxA = maxB = -Infinity;
    for (const s of solids) {
      const bb = world.aabb(s);
      const [a0, b0, a1, b1] = world.plane === 'xz' ? [bb[0], bb[2], bb[3], bb[5]] : [bb[0], bb[1], bb[3], bb[4]];
      minA = Math.min(minA, a0); minB = Math.min(minB, b0); maxA = Math.max(maxA, a1); maxB = Math.max(maxB, b1);
    }
    minA -= 4; minB -= 4; maxA += 4; maxB += 4;
  }
  const w = Math.min(512, Math.max(1, Math.ceil((maxA - minA) / cell)));
  const h = Math.min(512, Math.max(1, Math.ceil((maxB - minB) / cell)));
  const blocked = new Uint8Array(w * h);
  for (const bb of solids.flatMap((s) => world.aabbs(s))) {
    // In 3D, floor slabs below the agent's feet are walkable; only things rising above them block.
    if (world.plane === 'xz' && bb[4] <= agentBottom + 0.3) continue;
    const [a0, b0, a1, b1] = world.plane === 'xz' ? [bb[0], bb[2], bb[3], bb[5]] : [bb[0], bb[1], bb[3], bb[4]];
    const i0 = Math.max(0, Math.floor((a0 - radius - minA) / cell)), i1 = Math.min(w - 1, Math.floor((a1 + radius - minA) / cell));
    const j0 = Math.max(0, Math.floor((b0 - radius - minB) / cell)), j1 = Math.min(h - 1, Math.floor((b1 + radius - minB) / cell));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      // Cell is blocked if its center (expanded by agent radius) overlaps the obstacle.
      const ca = minA + (i + 0.5) * cell, cb = minB + (j + 0.5) * cell;
      if (ca > a0 - radius && ca < a1 + radius && cb > b0 - radius && cb < b1 + radius) blocked[j * w + i] = 1;
    }
  }
  return { version: world.solidsVersion, cell, radius, originA: minA, originB: minB, w, h, blocked, floorTop: agentBottom };
}

export function findPath(g: NavGrid, fromA: number, fromB: number, toA: number, toB: number, maxNodes = 40000): [number, number][] | null {
  const toCell = (a: number, b: number): [number, number] => [Math.floor((a - g.originA) / g.cell), Math.floor((b - g.originB) / g.cell)];
  const inside = (i: number, j: number) => i >= 0 && j >= 0 && i < g.w && j < g.h;
  const free = (i: number, j: number) => inside(i, j) && !g.blocked[j * g.w + i];
  let [si, sj] = toCell(fromA, fromB);
  let [ti, tj] = toCell(toA, toB);
  if (!inside(si, sj) || !inside(ti, tj)) return null;
  const nearestFree = (i: number, j: number): [number, number] | null => {
    if (free(i, j)) return [i, j];
    for (let r = 1; r < 12; r++) for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
      if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
      if (free(i + di, j + dj)) return [i + di, j + dj];
    }
    return null;
  };
  const s = nearestFree(si, sj); const t = nearestFree(ti, tj);
  if (!s || !t) return null;
  [si, sj] = s; [ti, tj] = t;
  const N = g.w * g.h;
  const gScore = new Float32Array(N).fill(Infinity);
  const came = new Int32Array(N).fill(-1);
  const closed = new Uint8Array(N);
  const start = sj * g.w + si, goal = tj * g.w + ti;
  const heur = (i: number, j: number) => { const dx = Math.abs(i - ti), dy = Math.abs(j - tj); return dx + dy + (Math.SQRT2 - 2) * Math.min(dx, dy); };
  // Binary heap of [f, node].
  const heap: [number, number][] = [];
  const push = (f: number, n: number) => { heap.push([f, n]); let k = heap.length - 1; while (k > 0) { const p = (k - 1) >> 1; if (heap[p][0] <= heap[k][0]) break; [heap[p], heap[k]] = [heap[k], heap[p]]; k = p; } };
  const pop = () => { const top = heap[0]; const last = heap.pop()!; if (heap.length) { heap[0] = last; let k = 0; for (;;) { const l = 2 * k + 1, r = l + 1; let m = k; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === k) break; [heap[m], heap[k]] = [heap[k], heap[m]]; k = m; } } return top; };
  gScore[start] = 0; push(heur(si, sj), start);
  let expanded = 0;
  while (heap.length) {
    const [, cur] = pop();
    if (closed[cur]) continue;
    if (cur === goal) break;
    closed[cur] = 1;
    if (++expanded > maxNodes) return null;
    const ci = cur % g.w, cj = (cur - ci) / g.w;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      if (!di && !dj) continue;
      const ni = ci + di, nj = cj + dj;
      if (!free(ni, nj)) continue;
      if (di && dj && (!free(ci + di, cj) || !free(ci, cj + dj))) continue; // no corner cutting
      const n = nj * g.w + ni;
      if (closed[n]) continue;
      const ng = gScore[cur] + (di && dj ? Math.SQRT2 : 1);
      if (ng < gScore[n]) { gScore[n] = ng; came[n] = cur; push(ng + heur(ni, nj), n); }
    }
  }
  if (came[goal] === -1 && goal !== start) return null;
  const cells: number[] = [];
  for (let c = goal; c !== -1; c = came[c]) { cells.push(c); if (c === start) break; }
  cells.reverse();
  const pts = cells.map((c): [number, number] => { const i = c % g.w, j = (c - i) / g.w; return [g.originA + (i + 0.5) * g.cell, g.originB + (j + 0.5) * g.cell]; });
  pts[pts.length - 1] = [toA, toB];
  return smoothPath(g, pts);
}

/** Remove intermediate waypoints that have clear grid line-of-sight. */
function smoothPath(g: NavGrid, pts: [number, number][]): [number, number][] {
  if (pts.length <= 2) return pts.slice(1);
  const out: [number, number][] = [];
  let anchor = pts[0];
  for (let k = 1; k < pts.length; k++) {
    if (k + 1 < pts.length && gridLos(g, anchor, pts[k + 1])) continue;
    out.push(pts[k]); anchor = pts[k];
  }
  return out;
}

export function gridLos(g: NavGrid, a: [number, number], b: [number, number]): boolean {
  const dist = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const steps = Math.ceil(dist / (g.cell * 0.25));
  for (let s = 0; s <= steps; s++) {
    const t = steps ? s / steps : 0;
    const pa = a[0] + (b[0] - a[0]) * t, pb = a[1] + (b[1] - a[1]) * t;
    const i = Math.floor((pa - g.originA) / g.cell), j = Math.floor((pb - g.originB) / g.cell);
    if (i < 0 || j < 0 || i >= g.w || j >= g.h || g.blocked[j * g.w + i]) return false;
  }
  return true;
}

/** True if no solid blocks the straight segment between two instances (checked at mid-body height). */
export function lineOfSight(world: World, a: RInstance, b: RInstance, solids = world.solids()): boolean {
  const A = world.aabb(a), B = world.aabb(b);
  const o: [number, number, number] = [(A[0] + A[3]) / 2, (A[1] + A[4]) / 2, (A[2] + A[5]) / 2];
  const t: [number, number, number] = [(B[0] + B[3]) / 2, (B[1] + B[4]) / 2, (B[2] + B[5]) / 2];
  const d = [t[0] - o[0], t[1] - o[1], t[2] - o[2]];
  const len = Math.hypot(d[0], d[1], d[2]);
  if (len < 1e-6) return true;
  for (const bb of solids.filter((s) => s !== a && s !== b).flatMap((s) => world.aabbs(s))) {
    let tmin = 0, tmax = len, hit = true;
    for (let k = 0; k < 3; k++) {
      const dk = d[k] / len;
      if (Math.abs(dk) < 1e-9) { if (o[k] < bb[k] || o[k] > bb[k + 3]) { hit = false; break; } continue; }
      let t1 = (bb[k] - o[k]) / dk, t2 = (bb[k + 3] - o[k]) / dk;
      if (t1 > t2) [t1, t2] = [t2, t1];
      tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
      if (tmin > tmax) { hit = false; break; }
    }
    if (hit) return false;
  }
  return true;
}
