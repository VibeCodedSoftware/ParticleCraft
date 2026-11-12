// Orientation maths and oriented collision shapes. Rotated colliders (a tilted plank, a tumbling crate, a spinning
// door) are turned into boxes the AABB solver understands: the shape's convex hull is cut into horizontal slabs and
// each slab's cross-section is covered by a few strips. Deterministic and cheap enough to cache per transform.
export type V3 = [number, number, number];
export type Quat = [number, number, number, number]; // x, y, z, w
type AABB = [number, number, number, number, number, number];

const DEG = Math.PI / 180;

/**
 * Quaternion from Euler degrees in YXZ order: the renderer's rotation (every object's rotation.order is 'YXZ' in
 * the viewport, and the editor's parenting and collider outlines use it too). XYZ here made colliders of objects
 * turned about two axes (a tumbling crate) point another way than the drawn object.
 */
export function quatFromEuler(rx: number, ry: number, rz: number): Quat {
  const c1 = Math.cos((rx * DEG) / 2), c2 = Math.cos((ry * DEG) / 2), c3 = Math.cos((rz * DEG) / 2);
  const s1 = Math.sin((rx * DEG) / 2), s2 = Math.sin((ry * DEG) / 2), s3 = Math.sin((rz * DEG) / 2);
  return [s1 * c2 * c3 + c1 * s2 * s3, c1 * s2 * c3 - s1 * c2 * s3, c1 * c2 * s3 - s1 * s2 * c3, c1 * c2 * c3 + s1 * s2 * s3];
}

/** Rotation matrix (row-major 3x3) of a unit quaternion. */
export function quatMatrix(q: Quat): number[] {
  const [x, y, z, w] = q;
  return [
    1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w),
    2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w),
    2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y),
  ];
}

/** Euler degrees (YXZ order, as the renderer) of a unit quaternion. */
export function eulerFromQuat(q: Quat): V3 {
  const m = quatMatrix(q);
  const rx = Math.asin(-Math.max(-1, Math.min(1, m[5])));
  let ry: number, rz: number;
  if (Math.abs(m[5]) < 0.9999999) { ry = Math.atan2(m[2], m[8]); rz = Math.atan2(m[3], m[4]); }
  else { ry = Math.atan2(-m[6], m[0]); rz = 0; }
  return [rx / DEG, ry / DEG, rz / DEG];
}

export function mulMat(m: number[], v: V3): V3 {
  return [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];
}
/** Transpose (inverse rotation) times v. */
export function mulMatT(m: number[], v: V3): V3 {
  return [m[0] * v[0] + m[3] * v[1] + m[6] * v[2], m[1] * v[0] + m[4] * v[1] + m[7] * v[2], m[2] * v[0] + m[5] * v[1] + m[8] * v[2]];
}

/** Advance orientation q by angular velocity w (rad/s, world) over h seconds. */
export function quatIntegrate(q: Quat, w: V3, h: number): Quat {
  const [x, y, z, s] = q, [a, b, c] = w;
  const n: Quat = [
    x + 0.5 * h * (a * s + b * z - c * y),
    y + 0.5 * h * (b * s + c * x - a * z),
    z + 0.5 * h * (c * s + a * y - b * x),
    s + 0.5 * h * (-a * x - b * y - c * z),
  ];
  const l = Math.hypot(n[0], n[1], n[2], n[3]) || 1;
  return [n[0] / l, n[1] / l, n[2] / l, n[3] / l];
}

export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/**
 * Corner points of a primitive collider (local, after scale, relative to the collider centre). Round shapes use
 * rims of `n` points; a sphere is its own case (rotation never changes it).
 */
export function hullPoints(shape: string, hx: number, hy: number, hz: number, n = 12): V3[] {
  const ring = (y: number, rx: number, rz: number): V3[] => Array.from({ length: n }, (_, k) => { const a = (k / n) * Math.PI * 2; return [Math.cos(a) * rx, y, Math.sin(a) * rz] as V3; });
  switch (shape) {
    case 'cylinder': return [...ring(-hy, hx, hz), ...ring(hy, hx, hz)];
    case 'cone': return [...ring(-hy, hx, hz), [0, hy, 0]];
    case 'capsule': {
      const r = Math.min(hx, hy), e = Math.max(0, hy - r), pts: V3[] = [];
      for (const s of [-1, 1]) { pts.push(...ring(s * e, hx, hz), ...ring(s * (e + r * 0.7), hx * 0.71, hz * 0.71), [0, s * hy, 0]); }
      return pts;
    }
    case 'sphere': {
      const pts: V3[] = [[0, hy, 0], [0, -hy, 0]];
      for (const t of [-0.7, 0, 0.7]) pts.push(...ring(t * hy, hx * Math.sqrt(1 - t * t), hz * Math.sqrt(1 - t * t)));
      return pts;
    }
    default: {
      const out: V3[] = [];
      for (const x of [-hx, hx]) for (const y of [-hy, hy]) for (const z of [-hz, hz]) out.push([x, y, z]);
      return out;
    }
  }
}

type P2 = [number, number];
/** Convex hull (monotone chain), counter-clockwise. */
export function hull2(pts: P2[]): P2[] {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const crossZ = (o: P2, a: P2, b: P2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo: P2[] = [], up: P2[] = [];
  for (const q of p) { while (lo.length >= 2 && crossZ(lo[lo.length - 2], lo[lo.length - 1], q) <= 1e-12) lo.pop(); lo.push(q); }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (up.length >= 2 && crossZ(up[up.length - 2], up[up.length - 1], q) <= 1e-12) up.pop(); up.push(q); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}

/**
 * Cover a convex polygon (u, v) with strips along its longer side: each strip spans the polygon's full extent
 * across it. Returns [u0, v0, u1, v1] rectangles. Nearly rectangular outlines stay one rectangle.
 */
export function stripCover(poly: P2[], maxStrips = 5): [number, number, number, number][] {
  if (poly.length < 3) return [];
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity, area = 0;
  for (let i = 0; i < poly.length; i++) {
    const [a, b] = poly[i], [c, d] = poly[(i + 1) % poly.length];
    u0 = Math.min(u0, a); u1 = Math.max(u1, a); v0 = Math.min(v0, b); v1 = Math.max(v1, b);
    area += a * d - c * b;
  }
  const rect = (u1 - u0) * (v1 - v0);
  if (rect < 1e-12) return [];
  const fill = Math.abs(area) / 2 / rect;
  const n = fill > 0.92 ? 1 : fill > 0.75 ? Math.min(3, maxStrips) : maxStrips;
  if (n === 1) return [[u0, v0, u1, v1]];
  // Strip along the longer axis so thin diagonal planks stay thin.
  const alongU = u1 - u0 >= v1 - v0;
  const out: [number, number, number, number][] = [];
  const lo0 = alongU ? u0 : v0, hi0 = alongU ? u1 : v1;
  for (let k = 0; k < n; k++) {
    const a = lo0 + ((hi0 - lo0) * k) / n, b = lo0 + ((hi0 - lo0) * (k + 1)) / n;
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i], q = poly[(i + 1) % poly.length];
      const pu = alongU ? p[0] : p[1], pv = alongU ? p[1] : p[0], qu = alongU ? q[0] : q[1], qv = alongU ? q[1] : q[0];
      if (pu >= a - 1e-9 && pu <= b + 1e-9) { lo = Math.min(lo, pv); hi = Math.max(hi, pv); }
      for (const s of [a, b]) if ((pu - s) * (qu - s) < 0) { const v = pv + ((s - pu) / (qu - pu)) * (qv - pv); lo = Math.min(lo, v); hi = Math.max(hi, v); }
    }
    if (hi - lo < 1e-9) continue;
    out.push(alongU ? [a, lo, b, hi] : [lo, a, hi, b]);
  }
  return out;
}

/** Oriented convex point set (world) → horizontal slabs of strips (3D) for the AABB solver. */
export function slabBoxes(pts: V3[], slabs: number): AABB[] {
  let y0 = Infinity, y1 = -Infinity;
  for (const p of pts) { y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
  const out: AABB[] = [];
  if (!(y1 > y0)) return out;
  const n = Math.max(1, slabs);
  for (let k = 0; k < n; k++) {
    const ya = y0 + ((y1 - y0) * k) / n, yb = y0 + ((y1 - y0) * (k + 1)) / n;
    const sec: P2[] = [];
    for (const p of pts) if (p[1] >= ya - 1e-9 && p[1] <= yb + 1e-9) sec.push([p[0], p[2]]);
    // The hull's cross-section at a plane is spanned by where the edges between corners cross it.
    for (const y of [ya, yb]) for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
      const a = pts[i], b = pts[j];
      if ((a[1] - y) * (b[1] - y) < 0) { const t = (y - a[1]) / (b[1] - a[1]); sec.push([a[0] + (b[0] - a[0]) * t, a[2] + (b[2] - a[2]) * t]); }
    }
    for (const [u0, v0, u1, v1] of stripCover(hull2(sec))) out.push([u0, ya, v0, u1, yb, v1]);
  }
  return out;
}

/** Rotated 2D outline (x, y) → strips spanning the depth z0..z1. */
export function stripBoxes2D(poly: P2[], z0: number, z1: number): AABB[] {
  return stripCover(hull2(poly)).map(([u0, v0, u1, v1]) => [u0, v0, z0, u1, v1, z1] as AABB);
}
