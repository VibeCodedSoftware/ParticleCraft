// The Growth Stack: how WorldCraft grows a tree. A stack of stages (trunk, branches, smaller branches, twigs) each grow
// from the one below. Every branch is walked step by step under the forces on it: it wanders, reaches for light, sags
// under its own length, may fork, may snap. Three things are particular to this system:
//  - Light: new branches look round for the least crowded direction, and shaded twigs die back.
//  - Pipe rule: where a branch forks, the two sides share the parent's wood (area is kept), so joints look grown.
//  - Flex: every vertex records how far it is from the trunk along the wood, which is what the wind moves.
// Plain arrays only, no renderer: the same seed and settings give the same tree in every app.
import { clamp, hashInts, lerp, Rng, stream } from './random';
import { hexRgb } from './biomes';
import type { GrowthStage, TreeBranch, TreeCfg, TreeSkeleton } from './document';
import type { LeafPoint, MeshData, TreeMesh } from './generators';
import { alongBranch, growLeaf, hairDefaults } from './leafHair';

type V3 = [number, number, number];
const add = (a: V3, b: V3, s = 1): V3 => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
const norm = (a: V3): V3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const rotate = (v: V3, axis: V3, ang: number): V3 => { const c = Math.cos(ang), s = Math.sin(ang), d = dot(axis, v) * (1 - c), x = cross(axis, v); return [v[0] * c + x[0] * s + axis[0] * d, v[1] * c + x[1] * s + axis[1] * d, v[2] * c + x[2] * s + axis[2] * d]; };
const sideOf = (d: V3): V3 => norm(Math.abs(d[1]) < 0.9 ? cross(d, [0, 1, 0]) : cross(d, [1, 0, 0]));

/** Golden angle: each branch turns this far from the last, the spacing plants use so none sits right above another. */
const GOLDEN = 137.508;
/** Pipe rule: two forks keep the parent's wood when r1^2.4 + r2^2.4 = r^2.4. */
const FORK_RADIUS = Math.pow(0.5, 1 / 2.4);

export interface ResolvedStage { count: number; length: number; angle: number; radius: number; start: number; end: number; up: number; gravity: number; split: number; splitAngle: number; flat: number; brk: number }

export const STAGE_NAMES = (levels: number) => Array.from({ length: levels + 1 }, (_, i) => (i === 0 ? 'Trunk' : i === levels && levels > 1 ? 'Twigs' : i === 1 ? 'Branches' : 'Smaller branches'));

/** A stage's values: the tree's overall settings, then whatever this stage changes. */
export function stageOf(c: TreeCfg, level: number): ResolvedStage {
  const s: GrowthStage = c.stages?.[level] ?? {};
  const start = c.start ?? (c.canopy === 'palm' ? 0.96 : c.canopy === 'cone' ? 0.2 : c.canopy === 'droop' ? 0.35 : 0.42);
  const up = c.upAttraction ?? 0.15, gravity = c.gravity ?? (c.canopy === 'droop' ? 1.5 : c.canopy === 'palm' ? 0.9 : 0.15), split = c.splitChance ?? 0.2;
  return {
    count: s.count ?? 1, length: s.length ?? 1, angle: s.angle ?? 0, radius: s.radius ?? 1,
    start: s.start ?? (level <= 1 ? start : 0.25), end: s.end ?? (level <= 1 ? 0.98 : 1),
    up: s.up ?? (level === 0 ? 0.5 : up), gravity: s.gravity ?? (level === 0 ? 0 : gravity),
    split: s.split ?? (level === 0 ? split * 0.3 : split), splitAngle: s.splitAngle ?? c.splitAngle ?? 32,
    flat: s.flat ?? (level === 0 ? 0 : c.flatness ?? 0.1), brk: s.brk ?? (c.breakChance ?? 0) * (level === 0 ? 0.2 : 1),
  };
}

/** How far branches reach at a height on the trunk (0 base, 1 top): the crown's outline. */
function outline(canopy: TreeCfg['canopy'], t: number) {
  switch (canopy) {
    case 'cone': return lerp(1.25, 0.22, t);
    case 'wide': return 0.55 + 0.75 * Math.sin(Math.PI * clamp(t * 0.92 + 0.08));
    case 'droop': return 0.7 + 0.5 * Math.sin(Math.PI * t);
    case 'palm': return 1;
    case 'none': return 0.6 + 0.6 * Math.sin(Math.PI * t);
    default: return 0.45 + 0.7 * Math.sin(Math.PI * clamp(t * 0.85 + 0.12));
  }
}

interface Branch { level: number; path: V3[]; radii: number[]; flex: number[]; along: number[]; dirEnd: V3; len: number; kids: number; rng: Rng; roll: number; /** Own id, the id of the branch it grows from (-1 none), and that branch's node it starts at. */ id: number; parent: number; at: number }

export function generateTree(c: TreeCfg, seed: number): TreeMesh {
  const wood: MeshData = { positions: [], normals: [], colors: [], uvs: [], indices: [], flex: [] };
  const age = clamp(c.age, 0.1, 1.5), H = c.height * age, levels = Math.max(0, Math.round(c.levels));
  const light = clamp(c.light ?? 0.5);
  let maxR = 0, top = 0, counter = 0, ids = 0;
  const VERT_LIMIT = 70000;

  // Where wood already is, in cells of about a seventh of the tree. Crowding is judged from this.
  const cell = Math.max(0.6, H / 7), crowd = new Map<number, number>();
  const cellKey = (p: V3) => hashInts(Math.floor(p[0] / cell), Math.floor(p[1] / cell), Math.floor(p[2] / cell));
  const crowdAt = (p: V3) => crowd.get(cellKey(p)) ?? 0;

  const grow = (level: number, from: V3, dir: V3, length: number, radius: number, flex0: number, forkDepth = 0, parent = -1, at = 0): Branch => {
    const st = stageOf(c, level);
    const r = stream(seed, 'grow', counter++);
    const rings = level === 0 ? 14 : level === 1 ? 9 : 5;
    const step = length / rings;
    const wob = c.randomness * (level === 0 ? 0.1 : 0.26) * (1 + (c.curvature ?? 0) * 2.5);
    const flexRate = level === 0 ? 0.14 : 0.32 + 0.14 * level;
    const b: Branch = { level, path: [from], radii: [radius], flex: [flex0], along: [0], dirEnd: dir, len: length, kids: 0, rng: r, roll: r.next() * 360, id: ids++, parent, at };
    let d = dir, p = from, drift: V3 = [0, 0, 0], walked = 0;
    for (let i = 1; i <= rings; i++) {
      const t = i / rings;
      // Direction changes slowly: the wander is itself a slow drift, so branches curve rather than jitter.
      drift = norm([drift[0] * 0.75 + r.range(-1, 1), drift[1] * 0.75 + r.range(-0.6, 0.6), drift[2] * 0.75 + r.range(-1, 1)]);
      d = add(d, drift, wob);
      d = add(d, [0, 1, 0], (st.up * 1.6) / rings);
      // Sag: the further along, the more wood it carries; thick wood resists.
      const stiff = (c.stiffness ?? 0.35) + radius * 1.2;
      d = add(d, [0, -1, 0], (st.gravity * t * t * 2.2) / rings / stiff);
      if (st.flat > 0) d = [d[0], d[1] * (1 - (st.flat * 3) / rings), d[2]];
      d = norm(d);
      p = add(p, d, step); walked += step;
      const rad = Math.max(0.006, radius * Math.pow(1 - t * clamp(c.taper, 0.05, 0.98), 0.85));
      b.path.push(p); b.radii.push(rad); b.flex.push(Math.min(1, flex0 + t * flexRate)); b.along.push(walked);
      maxR = Math.max(maxR, Math.hypot(p[0], p[2])); top = Math.max(top, p[1]);
      const key = cellKey(p); crowd.set(key, (crowd.get(key) ?? 0) + 1);
      // Fork: the wood divides, and the two sides lean apart.
      if (t > 0.15 && t < 0.85 && forkDepth < 2 && wood.positions.length / 3 < VERT_LIMIT && r.chance((st.split * 2.4) / rings)) {
        const a = (st.splitAngle * Math.PI) / 180, axis = norm(cross(d, sideOf(d)));
        const spin = rotate(axis, d, r.next() * Math.PI * 2);
        const rest = length - walked;
        const forkDir = norm(rotate(d, spin, a));
        d = norm(rotate(d, spin, -a * 0.55));
        forks.push({ level, from: p, dir: forkDir, length: rest * 0.9, radius: rad * FORK_RADIUS, flex: b.flex[b.flex.length - 1], depth: forkDepth + 1, parent: b.id, at: b.path.length - 1 });
        radius *= FORK_RADIUS;
      }
      if (st.brk > 0 && t > 0.3 && r.chance((st.brk * 3) / rings)) break; // Snapped: a stub, nothing further.
    }
    b.dirEnd = d; b.len = walked;
    return b;
  };
  let forks: { level: number; from: V3; dir: V3; length: number; radius: number; flex: number; depth: number; parent: number; at: number }[] = [];

  const pointAt = (b: Branch, s: number) => {
    const f = clamp(s) * (b.path.length - 1), i = Math.min(b.path.length - 2, Math.floor(f)), k = f - i;
    const a = b.path[i], e = b.path[i + 1];
    return { p: [lerp(a[0], e[0], k), lerp(a[1], e[1], k), lerp(a[2], e[2], k)] as V3, r: lerp(b.radii[i], b.radii[i + 1], k), flex: lerp(b.flex[i], b.flex[i + 1], k), dir: norm([e[0] - a[0], e[1] - a[1], e[2] - a[2]]) };
  };

  const all: Branch[] = [];
  // Asymmetry: each tree has a side (from its seed) its trunk leans to and its branches favour and reach further toward.
  const asym = clamp(c.asymmetry ?? 0), leanA = stream(seed, 'lean').next() * Math.PI * 2, lean: V3 = [Math.cos(leanA), 0, Math.sin(leanA)];
  let layer: Branch[] = [grow(0, [0, 0, 0], norm(add([0, 1, 0], lean, asym * 0.18)), H, c.trunk * age, 0)];
  const drainForks = (out: Branch[]) => { while (forks.length) { const q = forks; forks = []; for (const f of q) out.push(grow(f.level, f.from, f.dir, f.length, f.radius, f.flex, f.depth, f.parent, f.at)); } };
  drainForks(layer);
  for (let level = 1; level <= levels; level++) {
    const st = stageOf(c, level);
    const next: Branch[] = [];
    for (const parent of layer) {
      if (wood.positions.length / 3 > VERT_LIMIT) break;
      const share = parent.level === 0 ? c.branches : Math.max(2, Math.round(c.branches * 0.55));
      const count = Math.max(0, Math.round(share * st.count * (parent.level === 0 ? 1 : Math.min(1.4, parent.len / Math.max(0.5, H * c.length * 0.5)))));
      let spin = parent.roll;
      for (let k = 0; k < count; k++) {
        const s = lerp(st.start, st.end, (k + 0.5 + parent.rng.range(-0.3, 0.3)) / count);
        const at = pointAt(parent, s);
        spin += c.phyllotaxis ?? GOLDEN;
        const baseAngle = ((c.angle + st.angle + parent.rng.range(-12, 12) * c.randomness * 2) * Math.PI) / 180;
        // Light: of a few directions round the parent, the branch takes the least crowded.
        const reach = (parent.level === 0 ? H * c.length * outline(c.canopy, s) : parent.len * c.length * 0.85 * lerp(1, 0.55, s)) * st.length * parent.rng.range(0.82, 1.15);
        let bestDir: V3 | null = null, best = Infinity;
        const tries = 1 + Math.round(light * 3);
        for (let q = 0; q < tries; q++) {
          const az = ((spin + (q ? parent.rng.range(-40, 40) : 0)) * Math.PI) / 180;
          const dir = norm(add(norm(rotate(at.dir, rotate(sideOf(at.dir), at.dir, az), baseAngle)), lean, asym * 0.55));
          const tip = add(at.p, dir, reach);
          const score = crowdAt(tip) + (q ? 0.01 : 0);
          if (score < best) { best = score; bestDir = dir; }
        }
        // Shaded twigs die back: crowded small wood isn't worth growing.
        if (level >= 2 && best > 5 && parent.rng.chance(light * 0.75)) continue;
        const radius = Math.max(0.008, Math.min(at.r * 0.85, at.r * 0.62 * st.radius));
        // Starts inside the parent, so the joint has no gap. (Toward its side, an asymmetric tree's branches reach further.)
        const atNode = Math.round(clamp(s) * (parent.path.length - 1));
        const side = 1 + asym * 0.5 * (bestDir![0] * lean[0] + bestDir![2] * lean[2]);
        const b = grow(level, add(at.p, bestDir!, -at.r * 0.4), bestDir!, reach * side, radius, at.flex, 0, parent.id, atNode);
        next.push(b); parent.kids++;
      }
    }
    drainForks(next);
    all.push(...layer);
    layer = next;
    if (!layer.length) break;
  }
  all.push(...layer);
  const out = dressTree(c, all, seed, levels, H, c.trunk * age, wood);
  out.skeleton = skeletonOf(all);
  out.radius = Math.max(out.radius, maxR); out.height = Math.max(out.height, top, H);
  return out;
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;
/** The branches as a plain skeleton: what can be saved, edited node by node, and grown again. */
function skeletonOf(all: Branch[]): TreeSkeleton {
  const index = new Map<number, number>();
  all.forEach((b, i) => index.set(b.id, i));
  return { branches: all.map((b): TreeBranch => ({ l: b.level, p: b.path.map((q) => [r3(q[0]), r3(q[1]), r3(q[2])] as [number, number, number]), r: b.radii.map(r3), parent: b.parent >= 0 ? index.get(b.parent) ?? -1 : -1, at: b.at })) };
}

/** A tree from its skeleton (edited nodes, or drawn by hand): the same wood, roots and leaves the generator gives. */
export function treeFromSkeleton(c: TreeCfg, sk: TreeSkeleton, seed: number): TreeMesh {
  const all: Branch[] = [];
  let top = 0, levels = 0;
  sk.branches.forEach((sb, i) => {
    if (sb.p.length < 2) { all.push({ level: sb.l, path: sb.p.map((q) => [...q] as V3), radii: [...sb.r], flex: sb.p.map(() => 0), along: sb.p.map(() => 0), dirEnd: [0, 1, 0], len: 0, kids: 0, rng: stream(seed, 'sk', i), roll: 0, id: i, parent: sb.parent, at: sb.at }); return; }
    const path = sb.p.map((q) => [q[0], q[1], q[2]] as V3);
    const along = [0]; for (let k = 1; k < path.length; k++) along.push(along[k - 1] + Math.hypot(path[k][0] - path[k - 1][0], path[k][1] - path[k - 1][1], path[k][2] - path[k - 1][2]));
    const len = Math.max(1e-3, along[along.length - 1]);
    const par = sb.parent >= 0 && sb.parent < i ? all[sb.parent] : null;
    const flex0 = par ? par.flex[Math.min(par.flex.length - 1, Math.max(0, sb.at))] ?? 0 : 0;
    const rate = sb.l === 0 ? 0.14 : 0.32 + 0.14 * sb.l;
    const n = path.length - 1, d = norm([path[n][0] - path[n - 1][0], path[n][1] - path[n - 1][1], path[n][2] - path[n - 1][2]]);
    const radii = path.map((_, k) => Math.max(0.006, sb.r[k] ?? sb.r[sb.r.length - 1] ?? 0.05));
    all.push({ level: sb.l, path, radii, flex: along.map((a) => Math.min(1, flex0 + (a / len) * rate)), along, dirEnd: d, len, kids: 0, rng: stream(seed, 'sk', i), roll: 0, id: i, parent: par ? sb.parent : -1, at: sb.at });
    if (par) par.kids++;
    levels = Math.max(levels, sb.l);
    for (const q of path) top = Math.max(top, q[1]);
  });
  const trunk = all.find((b) => b.level === 0 && b.path.length > 1);
  return dressTree(c, all.filter((b) => b.path.length > 1), seed, levels, Math.max(1, top), trunk ? trunk.radii[0] : 0, { positions: [], normals: [], colors: [], uvs: [], indices: [], flex: [] });
}

/**
 * Moves one node of a skeleton. The rest of that branch beyond it goes along (the branch bends at the node before), and
 * so does everything growing from the moved part, so nothing comes loose.
 */
export function moveSkeletonNode(sk: TreeSkeleton, bi: number, ni: number, to: [number, number, number]): TreeSkeleton {
  const out: TreeSkeleton = { branches: sk.branches.map((b) => ({ ...b, p: b.p.map((q) => [...q] as [number, number, number]), r: [...b.r] })) };
  const b = out.branches[bi]; if (!b || !b.p[ni]) return out;
  const d: [number, number, number] = [to[0] - b.p[ni][0], to[1] - b.p[ni][1], to[2] - b.p[ni][2]];
  const moved = new Set<number>();
  const shift = (i: number, from: number) => {
    const br = out.branches[i];
    for (let k = from; k < br.p.length; k++) { br.p[k][0] += d[0]; br.p[k][1] += d[1]; br.p[k][2] += d[2]; }
    moved.add(i);
    out.branches.forEach((c, j) => { if (c.parent === i && !moved.has(j) && c.at >= from) shift(j, 0); });
  };
  shift(bi, ni);
  return out;
}

/** Takes a branch away, with everything growing from it. */
export function deleteSkeletonBranch(sk: TreeSkeleton, bi: number): TreeSkeleton {
  const gone = new Set<number>([bi]);
  for (let changed = true; changed;) { changed = false; sk.branches.forEach((b, i) => { if (!gone.has(i) && gone.has(b.parent)) { gone.add(i); changed = true; } }); }
  const map = new Map<number, number>(); let n = 0;
  sk.branches.forEach((_, i) => { if (!gone.has(i)) map.set(i, n++); });
  return { branches: sk.branches.filter((_, i) => !gone.has(i)).map((b) => ({ ...b, parent: b.parent >= 0 ? map.get(b.parent) ?? -1 : -1 })) };
}

/**
 * A hand-drawn stroke as a branch: points every so often along it, thick where it starts and thin at its end. A first
 * stroke is the trunk; later ones grow from the node they start at.
 */
export function strokeBranch(points: [number, number, number][], parent: TreeBranch | null, parentIndex: number, at: number, trunkRadius: number): TreeBranch | null {
  if (points.length < 2) return null;
  let total = 0; for (let k = 1; k < points.length; k++) total += Math.hypot(points[k][0] - points[k - 1][0], points[k][1] - points[k - 1][1], points[k][2] - points[k - 1][2]);
  if (total < 0.15) return null;
  const n = Math.max(3, Math.min(parent ? 9 : 14, Math.round(total / 0.5)));
  const out: [number, number, number][] = [];
  let k = 0, walked = 0;
  for (let s = 0; s <= n; s++) {
    const want = (s / n) * total;
    while (k < points.length - 2 && walked + Math.hypot(points[k + 1][0] - points[k][0], points[k + 1][1] - points[k][1], points[k + 1][2] - points[k][2]) < want) { walked += Math.hypot(points[k + 1][0] - points[k][0], points[k + 1][1] - points[k][1], points[k + 1][2] - points[k][2]); k++; }
    const a = points[k], e = points[Math.min(points.length - 1, k + 1)], seg = Math.hypot(e[0] - a[0], e[1] - a[1], e[2] - a[2]) || 1, t = clamp((want - walked) / seg);
    out.push([r3(lerp(a[0], e[0], t)), r3(lerp(a[1], e[1], t)), r3(lerp(a[2], e[2], t))]);
  }
  const r0 = parent ? Math.max(0.02, Math.min((parent.r[Math.min(parent.r.length - 1, at)] ?? trunkRadius) * 0.72, trunkRadius * 0.6)) : Math.max(0.03, trunkRadius);
  const end = parent ? 0.015 : r0 * 0.3;
  return { l: parent ? parent.l + 1 : 0, p: out, r: out.map((_, i) => r3(lerp(r0, end, Math.pow(i / n, 0.9)))), parent: parent ? parentIndex : -1, at };
}

/** Wood, roots and leaves for a set of branches. */
function dressTree(c: TreeCfg, all: Branch[], seed: number, levels: number, H: number, trunkR: number, wood: MeshData): TreeMesh {
  const leaves: LeafPoint[] = [];
  const bark = hexRgb(c.bark);
  let maxR = 0, top = 0;
  const VERT_LIMIT = 70000;
  for (const b of all) for (const p of b.path) { maxR = Math.max(maxR, Math.hypot(p[0], p[2])); top = Math.max(top, p[1]); }
  const pointAt = (b: Branch, s: number) => {
    const f = clamp(s) * (b.path.length - 1), i = Math.min(b.path.length - 2, Math.floor(f)), k = f - i;
    const a = b.path[i], e = b.path[i + 1];
    return { p: [lerp(a[0], e[0], k), lerp(a[1], e[1], k), lerp(a[2], e[2], k)] as V3, r: lerp(b.radii[i], b.radii[i + 1], k), flex: lerp(b.flex[i], b.flex[i + 1], k), dir: norm([e[0] - a[0], e[1] - a[1], e[2] - a[2]]) };
  };
  // Wood.
  // Small wood is mostly inside the crown: fewer sides, and every other ring (the path, and so the shape, is the same).
  const sidesOf = (b: Branch) => (b.level === 0 ? 10 : b.level === 1 ? (b.radii[0] > 0.12 ? 6 : 5) : 3);
  const thin = (b: Branch): Branch => {
    if (b.level < 2 || b.path.length < 5) return b;
    const keep = b.path.map((_, i) => i).filter((i) => i % 2 === 0 || i === b.path.length - 1);
    return { ...b, path: keep.map((i) => b.path[i]), radii: keep.map((i) => b.radii[i]), flex: keep.map((i) => b.flex[i]), along: keep.map((i) => b.along[i]) };
  };
  for (const b of all) {
    if (wood.positions.length / 3 > VERT_LIMIT * 1.3) break;
    const flare = b.level === 0 && b.along[0] === 0 && Math.abs(b.path[0][1]) < 0.05 ? c.flare ?? 0.6 : 0;
    tube(wood, thin(b), sidesOf(b), bark, flare, b.level === 0 ? c.lumps ?? 0.12 : 0, seed);
  }
  // Roots grow out of the flare.
  const rr = stream(seed, 'roots');
  for (let k = 0; k < c.roots && trunkR > 0; k++) {
    const a = (k / c.roots) * Math.PI * 2 + rr.range(-0.3, 0.3), d: V3 = [Math.cos(a), -0.18, Math.sin(a)], tr = trunkR;
    const start: V3 = [d[0] * tr * 0.55, tr * 0.3, d[2] * tr * 0.55], rl = tr * rr.range(1.8, 3.2);
    const path: V3[] = [start, add(start, d, rl * 0.5), add(add(start, d, rl), [0, -1, 0], rl * 0.18)];
    tube(wood, { level: 1, path, radii: [tr * 0.46, tr * 0.24, 0.015], flex: [0, 0, 0], along: [0, rl * 0.5, rl], dirEnd: d, len: rl, kids: 0, rng: rr, roll: 0, id: -1, parent: -1, at: 0 }, 5, bark, 0, 0, seed);
  }

  // Leaves, grown out of the wood like hair particles: each one starts on the surface of its own branch.
  if (c.canopy !== 'none' && c.leafDensity > 0) {
    const lr = stream(seed, 'leaves');
    const h = { ...hairDefaults(), ...(c.canopy === 'palm' ? { start: 0.1, droop: 0.6 } : c.canopy === 'droop' ? { droop: 1.4, angle: 30 } : {}), ...c.hair };
    // A hand-drawn tree has a few long branches, not hundreds of twigs: leaves all along them, in clumps, so it's as full.
    const sparse = all.length < 40;
    if (sparse) { h.where = 'all'; h.fromStage = levels > 0 ? 1 : 0; h.start = Math.min(h.start, 0.25); h.clumps = Math.max(h.clumps, 3); h.clumpSize = Math.max(h.clumpSize, 0.7); }
    const boost = sparse ? clamp(60 / Math.max(1, all.length), 2, 14) : 1;
    for (const b of all) {
      if (b.level < h.fromStage) continue;
      if (h.where === 'tips' && ((b.kids > 0 && b.level < levels) || (b.level === 0 && levels > 0))) continue;
      const count = Math.round(boost * c.leafDensity * h.amount * (c.canopy === 'palm' ? 34 : b.level >= levels ? 12 : 8) * clamp(b.len / Math.max(0.4, H * 0.08), 0.5, 1.5));
      for (let i = 0; i < count && leaves.length < h.limit; i++) {
        const at = pointAt(b, alongBranch(h, lr));
        const ang = lr.next() * Math.PI * 2, side = sideOf(at.dir);
        const radial = rotate(side, at.dir, ang);
        const before = leaves.length;
        growLeaf(leaves, h, lr, add(at.p, radial, at.r), at.dir, radial, c.leafSize, at.flex, c.leafSpread * c.leafSize * 0.5);
        for (let k = before; k < leaves.length; k++) { const p = leaves[k].p; maxR = Math.max(maxR, Math.hypot(p[0], p[2])); top = Math.max(top, p[1]); }
      }
    }
  }
  return { wood, leaves, height: Math.max(top, H), radius: maxR, triangles: wood.indices.length / 3 + leaves.length * 2 };
}

/** A branch as a tube. Bark repeats by real distance, so it doesn't stretch on long or thin wood. */
function tube(m: MeshData, b: Branch, sides: number, color: V3, flare: number, lumps: number, seed: number) {
  const base = m.positions.length / 3, n = b.path.length;
  if (n < 2) return;
  let side = sideOf(norm([b.path[1][0] - b.path[0][0], b.path[1][1] - b.path[0][1], b.path[1][2] - b.path[0][2]]));
  const girth = 2 * Math.PI * b.radii[0], wraps = Math.max(1, Math.round(girth / 1.4));
  for (let i = 0; i < n; i++) {
    const a = b.path[Math.max(0, i - 1)], e = b.path[Math.min(n - 1, i + 1)];
    const dir = norm([e[0] - a[0], e[1] - a[1], e[2] - a[2]]);
    side = norm(add(side, dir, -dot(side, dir)));
    const up = cross(dir, side);
    const hgt = b.along[i] / Math.max(1e-3, b.len);
    const swell = flare > 0 ? 1 + flare * Math.pow(Math.max(0, 1 - hgt * 7), 2) : 1;
    for (let s = 0; s <= sides; s++) {
      const ang = (s / sides) * Math.PI * 2, co = Math.cos(ang), si = Math.sin(ang);
      const nor: V3 = [side[0] * co + up[0] * si, side[1] * co + up[1] * si, side[2] * co + up[2] * si];
      // Trunks aren't round: slow lobes, strongest at the base.
      const lobes = lumps > 0 ? 1 + lumps * (Math.sin(ang * 3 + seed) * 0.6 + Math.sin(ang * 5 + i * 0.5 + seed * 2) * 0.4) * (0.4 + 0.6 * (1 - hgt)) : 1;
      const r = b.radii[i] * swell * lobes;
      m.positions.push(b.path[i][0] + nor[0] * r, b.path[i][1] + nor[1] * r, b.path[i][2] + nor[2] * r);
      m.normals.push(nor[0], nor[1], nor[2]);
      m.colors.push(color[0], color[1], color[2]);
      m.uvs.push((s / sides) * wraps, b.along[i] / Math.max(0.4, girth / wraps));
      m.flex!.push(b.flex[i]);
    }
  }
  const row = sides + 1;
  for (let i = 0; i + 1 < n; i++) for (let s = 0; s < sides; s++) {
    const a = base + i * row + s, c = a + row;
    // Counter-clockwise from outside: round the ring, then along the branch. The other way round the outside is culled
    // and you look into the tree.
    m.indices.push(a, a + 1, c, a + 1, c + 1, c);
  }
}
