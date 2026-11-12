// Gradient (Perlin) noise, fractal sums, Voronoi and curl noise. Deterministic (fixed permutation, optional seed),
// used by the particle forces (turbulence / curl noise / wind gusts) and ParticleCraft's procedural textures.

function makePerm(seed: number): Uint8Array {
  const p = new Uint8Array(512);
  const a = Array.from({ length: 256 }, (_, i) => i);
  let s = (seed * 2654435761) >>> 0 || 1;
  for (let i = 255; i > 0; i--) { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; const j = (s >>> 0) % (i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  for (let i = 0; i < 512; i++) p[i] = a[i & 255];
  return p;
}
const perms = new Map<number, Uint8Array>();
const permOf = (seed: number) => { let p = perms.get(seed); if (!p) { p = makePerm(seed); perms.set(seed, p); } return p; };

const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
function grad3(h: number, x: number, y: number, z: number) {
  const k = h & 15, u = k < 8 ? x : y, v = k < 4 ? y : k === 12 || k === 14 ? x : z;
  return ((k & 1) ? -u : u) + ((k & 2) ? -v : v);
}

/** 3D Perlin noise in about [-1, 1]. */
export function perlin3(x: number, y: number, z: number, seed = 0): number {
  const P = permOf(seed);
  const X = Math.floor(x), Y = Math.floor(y), Z = Math.floor(z);
  x -= X; y -= Y; z -= Z;
  const xi = X & 255, yi = Y & 255, zi = Z & 255;
  const u = fade(x), v = fade(y), w = fade(z);
  const A = P[xi] + yi, AA = P[A] + zi, AB = P[A + 1] + zi, B = P[xi + 1] + yi, BA = P[B] + zi, BB = P[B + 1] + zi;
  const l = (a: number, b: number, t: number) => a + t * (b - a);
  return l(
    l(l(grad3(P[AA], x, y, z), grad3(P[BA], x - 1, y, z), u), l(grad3(P[AB], x, y - 1, z), grad3(P[BB], x - 1, y - 1, z), u), v),
    l(l(grad3(P[AA + 1], x, y, z - 1), grad3(P[BA + 1], x - 1, y, z - 1), u), l(grad3(P[AB + 1], x, y - 1, z - 1), grad3(P[BB + 1], x - 1, y - 1, z - 1), u), v),
    w,
  );
}

/** Fractal (fBm) sum of Perlin octaves, about [-1, 1]. */
export function fbm3(x: number, y: number, z: number, octaves = 4, lacunarity = 2, gain = 0.5, seed = 0): number {
  let a = 1, f = 1, s = 0, n = 0;
  for (let o = 0; o < octaves; o++) { s += perlin3(x * f, y * f, z * f, seed + o) * a; n += a; a *= gain; f *= lacunarity; }
  return s / (n || 1);
}

/** Turbulence: sum of |noise| (billowy, smoke-like), 0..1. */
export function turbulence3(x: number, y: number, z: number, octaves = 4, seed = 0): number {
  let a = 1, f = 1, s = 0, n = 0;
  for (let o = 0; o < octaves; o++) { s += Math.abs(perlin3(x * f, y * f, z * f, seed + o)) * a; n += a; a *= 0.5; f *= 2; }
  return Math.min(1, (s / (n || 1)) * 1.6);
}

const hash2 = (x: number, y: number, seed: number) => { let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return (h >>> 0) / 4294967296; };

/** 2D Voronoi (cellular) noise: F1, F2 distances and the nearest cell's random id. `period` > 0 makes it tile. */
export function voronoi2(x: number, y: number, seed = 0, jitter = 1, period = 0): { f1: number; f2: number; id: number } {
  const X = Math.floor(x), Y = Math.floor(y);
  let f1 = 9, f2 = 9, id = 0;
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    let cx = X + i, cy = Y + j;
    const hx = period > 0 ? ((cx % period) + period) % period : cx, hy = period > 0 ? ((cy % period) + period) % period : cy;
    const px = cx + 0.5 + (hash2(hx, hy, seed) - 0.5) * jitter, py = cy + 0.5 + (hash2(hx, hy, seed + 17) - 0.5) * jitter;
    const d = Math.hypot(px - x, py - y);
    if (d < f1) { f2 = f1; f1 = d; id = hash2(hx, hy, seed + 31); } else if (d < f2) f2 = d;
  }
  return { f1, f2, id };
}

/** Divergence-free curl noise velocity at a point (finite differences of three Perlin potentials). Writes into `out`. */
export function curl3(x: number, y: number, z: number, t: number, out: [number, number, number], seed = 0): [number, number, number] {
  const e = 0.1;
  // Potential components from offset noise fields (time animates them).
  const A = (px: number, py: number, pz: number) => perlin3(px, py + t * 0.31, pz, seed);
  const B = (px: number, py: number, pz: number) => perlin3(px + 31.4, py, pz + t * 0.27, seed + 1);
  const C = (px: number, py: number, pz: number) => perlin3(px + t * 0.23, py + 71.9, pz, seed + 2);
  const dCdy = (C(x, y + e, z) - C(x, y - e, z)) / (2 * e), dBdz = (B(x, y, z + e) - B(x, y, z - e)) / (2 * e);
  const dAdz = (A(x, y, z + e) - A(x, y, z - e)) / (2 * e), dCdx = (C(x + e, y, z) - C(x - e, y, z)) / (2 * e);
  const dBdx = (B(x + e, y, z) - B(x - e, y, z)) / (2 * e), dAdy = (A(x, y + e, z) - A(x, y - e, z)) / (2 * e);
  out[0] = dCdy - dBdz; out[1] = dAdz - dCdx; out[2] = dBdx - dAdy;
  return out;
}
