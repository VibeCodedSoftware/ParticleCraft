// Shape nodes (ParticleCraft): basic 3D shapes and imported objects that particles are born on and can cling to.
// A shape is turned into triangles (with its size, scale, rotation and position applied), then sampled into points
// with a direction each: the surface normal (surface / volume) or the edge direction (edges). The samples go into
// the effect's layers, so GameCraft and LogicCraft play shape effects on the same engine without the geometry.
import { Rng } from '../runtime/rng';

export type ShapeKind = 'cube' | 'sphere' | 'cylinder' | 'capsule' | 'plane' | 'cone' | 'torus' | 'mesh';
export type EmitFrom = 'surface' | 'volume' | 'edges';

export interface VfxShape {
  id: string; name: string; kind: ShapeKind;
  /** Box-like size (cube, plane, cylinder/cone/capsule height). */
  width: number; height: number; depth: number;
  /** Round shapes: radius (torus: ring radius; `tube` is the thickness). */
  radius: number; tube?: number;
  scale: number;
  rotation: [number, number, number]; // degrees, applied X then Y then Z
  position: [number, number, number];
  /** Hidden by default so the effect is not covered; untick to see the shape with the particles. */
  hideOriginal: boolean;
  color?: string;
  /** Node position in the graph editor. */
  x: number; y: number;
  /** Imported object ("Object node"): its triangles, in metres, centred on the origin. */
  mesh?: { tris: number[]; source?: string };
}

export const SHAPE_KINDS: { kind: ShapeKind; name: string }[] = [
  { kind: 'cube', name: 'Cube' }, { kind: 'sphere', name: 'Sphere' }, { kind: 'cylinder', name: 'Cylinder' }, { kind: 'capsule', name: 'Capsule' },
  { kind: 'plane', name: 'Plane' }, { kind: 'cone', name: 'Cone' }, { kind: 'torus', name: 'Torus' },
];

export function newShape(kind: ShapeKind, id: string, x = 0, y = 0): VfxShape {
  const name = SHAPE_KINDS.find((k) => k.kind === kind)?.name ?? 'Object';
  return { id, name, kind, width: 1, height: kind === 'plane' ? 0 : 1, depth: 1, radius: 0.5, tube: 0.18, scale: 1, rotation: [0, 0, 0], position: [0, kind === 'plane' ? 0 : 0.6, 0], hideOriginal: true, color: '#8fa3bf', x, y };
}

// ------------------------------------------------------------------ triangles
type V3 = [number, number, number];
const SEG = 24;

/** Triangles of a ring-swept profile: points (r, y) revolved around Y. */
function lathe(profile: [number, number][], seg = SEG): number[] {
  const out: number[] = [];
  for (let i = 0; i < profile.length - 1; i++) {
    const [r0, y0] = profile[i], [r1, y1] = profile[i + 1];
    for (let s = 0; s < seg; s++) {
      const a0 = (s / seg) * Math.PI * 2, a1 = ((s + 1) / seg) * Math.PI * 2;
      const p = (r: number, y: number, a: number): V3 => [Math.cos(a) * r, y, Math.sin(a) * r];
      const A = p(r0, y0, a0), B = p(r0, y0, a1), C = p(r1, y1, a1), D = p(r1, y1, a0);
      if (r0 > 1e-6) out.push(...A, ...C, ...B);
      if (r1 > 1e-6) out.push(...A, ...D, ...C);
    }
  }
  return out;
}

/** Unit-ish shape triangles before scale/rotation/position (local units = the shape's own sizes). */
function baseTriangles(s: VfxShape): number[] {
  const w = s.width / 2, h = s.height / 2, d = s.depth / 2, r = s.radius;
  switch (s.kind) {
    case 'cube': {
      const c: V3[] = [[-w, -h, -d], [w, -h, -d], [w, h, -d], [-w, h, -d], [-w, -h, d], [w, -h, d], [w, h, d], [-w, h, d]];
      const q = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [3, 7, 6, 2], [0, 4, 7, 3], [1, 2, 6, 5]];
      return q.flatMap(([a, b, cc, dd]) => [...c[a], ...c[b], ...c[cc], ...c[a], ...c[cc], ...c[dd]]);
    }
    case 'plane': return [-w, 0, -d, w, 0, d, w, 0, -d, -w, 0, -d, -w, 0, d, w, 0, d];
    case 'sphere': { const prof: [number, number][] = []; for (let k = 0; k <= 12; k++) { const a = -Math.PI / 2 + (k / 12) * Math.PI; prof.push([Math.cos(a) * r, Math.sin(a) * r]); } return lathe(prof); }
    case 'cylinder': return lathe([[0, -h], [r, -h], [r, h], [0, h]]);
    case 'cone': return lathe([[0, -h], [r, -h], [0, h]]);
    case 'capsule': {
      const prof: [number, number][] = [], body = Math.max(0, h - r);
      for (let k = 0; k <= 6; k++) { const a = -Math.PI / 2 + (k / 6) * (Math.PI / 2); prof.push([Math.cos(a) * r, -body + Math.sin(a) * r]); }
      for (let k = 0; k <= 6; k++) { const a = (k / 6) * (Math.PI / 2); prof.push([Math.cos(a) * r, body + Math.sin(a) * r]); }
      return lathe(prof);
    }
    case 'torus': {
      const t = s.tube ?? 0.18, out: number[] = [], seg2 = 12;
      const P = (u: number, v: number): V3 => [(r + t * Math.cos(v)) * Math.cos(u), t * Math.sin(v), (r + t * Math.cos(v)) * Math.sin(u)];
      for (let i = 0; i < SEG; i++) for (let j = 0; j < seg2; j++) {
        const u0 = (i / SEG) * Math.PI * 2, u1 = ((i + 1) / SEG) * Math.PI * 2, v0 = (j / seg2) * Math.PI * 2, v1 = ((j + 1) / seg2) * Math.PI * 2;
        out.push(...P(u0, v0), ...P(u1, v1), ...P(u1, v0), ...P(u0, v0), ...P(u0, v1), ...P(u1, v1));
      }
      return out;
    }
    case 'mesh': return s.mesh?.tris ?? [];
  }
}

/** Rotation (degrees, X then Y then Z) and the rest of the transform, as a function on points. */
function transformOf(s: VfxShape) {
  const [rx, ry, rz] = s.rotation.map((a) => (a * Math.PI) / 180);
  const cx = Math.cos(rx), sx = Math.sin(rx), cy = Math.cos(ry), sy = Math.sin(ry), cz = Math.cos(rz), sz = Math.sin(rz);
  const rot = (x: number, y: number, z: number): V3 => {
    let y1 = y * cx - z * sx, z1 = y * sx + z * cx; // X
    const x2 = x * cy + z1 * sy; z1 = -x * sy + z1 * cy; // Y
    const x3 = x2 * cz - y1 * sz; y1 = x2 * sz + y1 * cz; // Z
    return [x3, y1, z1];
  };
  const k = s.scale || 1, [px, py, pz] = s.position;
  return { point: (x: number, y: number, z: number): V3 => { const [a, b, c] = rot(x * k, y * k, z * k); return [a + px, b + py, c + pz]; }, dir: rot };
}

/** The shape's triangles in effect space (9 numbers per triangle). */
export function shapeTriangles(s: VfxShape): Float32Array {
  const base = baseTriangles(s), t = transformOf(s), out = new Float32Array(base.length);
  for (let i = 0; i < base.length; i += 3) { const p = t.point(base[i], base[i + 1], base[i + 2]); out[i] = p[0]; out[i + 1] = p[1]; out[i + 2] = p[2]; }
  return out;
}

// ------------------------------------------------------------------ sampling
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const tri = (t: Float32Array, i: number): [V3, V3, V3] => [[t[i], t[i + 1], t[i + 2]], [t[i + 3], t[i + 4], t[i + 5]], [t[i + 6], t[i + 7], t[i + 8]]];

/** Is a point inside the closed triangle soup? (ray parity along +X, jittered off edges) */
function inside(t: Float32Array, p: V3): boolean {
  let hits = 0;
  const o: V3 = [p[0], p[1] + 1.37e-4, p[2] + 2.91e-4];
  for (let i = 0; i < t.length; i += 9) {
    const [a, b, c] = tri(t, i);
    // Möller–Trumbore with direction (1,0,0).
    const e1 = sub(b, a), e2 = sub(c, a), pv = cross([1, 0, 0], e2), det = e1[0] * pv[0] + e1[1] * pv[1] + e1[2] * pv[2];
    if (Math.abs(det) < 1e-12) continue;
    const tv = sub(o, a), u = (tv[0] * pv[0] + tv[1] * pv[1] + tv[2] * pv[2]) / det; if (u < 0 || u > 1) continue;
    const q = cross(tv, e1), v = q[0] / det; if (v < 0 || u + v > 1) continue;
    if ((e2[0] * q[0] + e2[1] * q[1] + e2[2] * q[2]) / det > 0) hits++;
  }
  return (hits & 1) === 1;
}

/** Sharp or open edges (cube edges, cylinder rims); smooth shapes fall back to every triangle edge. */
function featureEdges(t: Float32Array): [V3, V3][] {
  const key = (p: V3) => p.map((x) => Math.round(x * 1e4)).join(',');
  const map = new Map<string, { a: V3; b: V3; n: V3[] }>();
  for (let i = 0; i < t.length; i += 9) {
    const [a, b, c] = tri(t, i), n = cross(sub(b, a), sub(c, a)), nl = len(n) || 1;
    const nn: V3 = [n[0] / nl, n[1] / nl, n[2] / nl];
    for (const [p, q] of [[a, b], [b, c], [c, a]] as [V3, V3][]) {
      const ka = key(p), kb = key(q), k = ka < kb ? ka + '|' + kb : kb + '|' + ka;
      const e = map.get(k); if (e) e.n.push(nn); else map.set(k, { a: p, b: q, n: [nn] });
    }
  }
  const sharp: [V3, V3][] = [], all: [V3, V3][] = [];
  for (const e of map.values()) {
    all.push([e.a, e.b]);
    if (e.n.length === 1 || (e.n.length === 2 && e.n[0][0] * e.n[1][0] + e.n[0][1] * e.n[1][1] + e.n[0][2] * e.n[1][2] < Math.cos((30 * Math.PI) / 180))) sharp.push([e.a, e.b]);
  }
  return sharp.length ? sharp : all;
}

/**
 * `n` points on the shape, 6 numbers each: position, then the outward normal (surface, volume: towards the nearest
 * surface's normal) or the edge direction (edges). Deterministic for a seed.
 */
export function sampleShape(s: VfxShape, from: EmitFrom, n: number, seed = 1): number[] {
  const t = shapeTriangles(s);
  if (!t.length) return [];
  const rng = new Rng(seed), out: number[] = [];
  // Area table for surface sampling.
  const areas: number[] = []; let total = 0;
  for (let i = 0; i < t.length; i += 9) { const [a, b, c] = tri(t, i); total += len(cross(sub(b, a), sub(c, a))) / 2; areas.push(total); }
  const surfacePoint = (): [V3, V3] => {
    const x = rng.next() * total; let lo = 0, hi = areas.length - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (areas[m] < x) lo = m + 1; else hi = m; }
    const [a, b, c] = tri(t, lo * 9); let u = rng.next(), v = rng.next(); if (u + v > 1) { u = 1 - u; v = 1 - v; }
    const nn = cross(sub(b, a), sub(c, a)), nl = len(nn) || 1;
    return [[a[0] + (b[0] - a[0]) * u + (c[0] - a[0]) * v, a[1] + (b[1] - a[1]) * u + (c[1] - a[1]) * v, a[2] + (b[2] - a[2]) * u + (c[2] - a[2]) * v], [nn[0] / nl, nn[1] / nl, nn[2] / nl]];
  };
  if (from === 'surface' || total === 0 || s.kind === 'plane') {
    for (let k = 0; k < n; k++) { const [p, d] = surfacePoint(); out.push(...p, ...d); }
    return out;
  }
  if (from === 'edges') {
    const edges = featureEdges(t), el = edges.map(([a, b]) => len(sub(b, a))), L: number[] = []; let acc = 0;
    for (const l of el) { acc += l; L.push(acc); }
    for (let k = 0; k < n; k++) {
      const x = rng.next() * acc; let j = L.findIndex((v) => v >= x); if (j < 0) j = L.length - 1;
      const [a, b] = edges[j], f = rng.next(), d = sub(b, a), dl = el[j] || 1;
      out.push(a[0] + d[0] * f, a[1] + d[1] * f, a[2] + d[2] * f, d[0] / dl, d[1] / dl, d[2] / dl);
    }
    return out;
  }
  // Volume: points inside the bounds that are inside the shape; direction away from the centre.
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < t.length; i += 3) { x0 = Math.min(x0, t[i]); x1 = Math.max(x1, t[i]); y0 = Math.min(y0, t[i + 1]); y1 = Math.max(y1, t[i + 1]); z0 = Math.min(z0, t[i + 2]); z1 = Math.max(z1, t[i + 2]); }
  const c: V3 = [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2];
  for (let tries = 0; out.length < n * 6 && tries < n * 40; tries++) {
    const p: V3 = [x0 + rng.next() * (x1 - x0), y0 + rng.next() * (y1 - y0), z0 + rng.next() * (z1 - z0)];
    if (!inside(t, p)) continue;
    const d = sub(p, c), dl = len(d) || 1;
    out.push(...p, d[0] / dl, d[1] / dl, d[2] / dl);
  }
  while (out.length < n * 6) { const [p, d] = surfacePoint(); out.push(...p, ...d); } // thin shapes: fall back to the surface
  return out;
}

/** Imported triangles, centred on the origin and scaled to fit `fit` metres when bigger (kept otherwise). */
export function normalizeMesh(tris: ArrayLike<number>, fit = 3, maxTris = 4000): number[] {
  const n = Math.floor(tris.length / 9), step = Math.max(1, Math.ceil(n / maxTris));
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < n * 9; i += 3) { x0 = Math.min(x0, tris[i]); x1 = Math.max(x1, tris[i]); y0 = Math.min(y0, tris[i + 1]); y1 = Math.max(y1, tris[i + 1]); z0 = Math.min(z0, tris[i + 2]); z1 = Math.max(z1, tris[i + 2]); }
  const size = Math.max(x1 - x0, y1 - y0, z1 - z0), k = size > fit ? fit / size : 1;
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, cz = (z0 + z1) / 2;
  const out: number[] = [];
  for (let t = 0; t < n; t += step) for (let v = 0; v < 3; v++) { const i = t * 9 + v * 3; out.push(+((tris[i] - cx) * k).toFixed(4), +((tris[i + 1] - cy) * k).toFixed(4), +((tris[i + 2] - cz) * k).toFixed(4)); }
  return out;
}
