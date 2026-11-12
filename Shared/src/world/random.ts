// Deterministic randomness for world generation. Every subsystem draws from its own stream, named and keyed by what it
// is generating, so changing how many trees a chunk has can't move a rock, a structure or the next chunk's terrain.

/** FNV-1a over a string: stable across runs, machines and JS engines. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

/** Mixes numbers into a 32-bit hash (no floating point involved, so results can't drift between machines). */
export function hashInts(...v: number[]): number {
  let h = 0x9e3779b9;
  for (const x of v) {
    let k = Math.imul(x | 0, 0xcc9e2d51); k = (k << 15) | (k >>> 17); k = Math.imul(k, 0x1b873593);
    h ^= k; h = (h << 13) | (h >>> 19); h = Math.imul(h, 5) + 0xe6546b64;
  }
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return h >>> 0;
}

/** Small seeded generator (mulberry32): `next()` is 0..1. */
export class Rng {
  private s: number;
  constructor(seed: number) { this.s = seed >>> 0; }
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a: number, b: number) { return a + (b - a) * this.next(); }
  int(a: number, b: number) { return Math.floor(this.range(a, b + 1)); }
  pick<T>(list: readonly T[]): T { return list[Math.floor(this.next() * list.length) % list.length]; }
  chance(p: number) { return this.next() < p; }
}

/** The random stream of one subsystem and place: stream(worldSeed, 'trees', chunkX, chunkZ). */
export function stream(seed: number, name: string, ...key: number[]): Rng {
  return new Rng(hashInts(seed, hashString(name), ...key));
}

/** A fresh seed for the Randomize buttons. Not used by generation itself. */
export const randomSeed = () => Math.floor(Math.random() * 2147483647);

// ------------------------------------------------------------------------------------------------ noise

const grad2 = (h: number, x: number, y: number) => {
  switch (h & 7) {
    case 0: return x + y; case 1: return x - y; case 2: return -x + y; case 3: return -x - y;
    case 4: return x * 1.414; case 5: return -x * 1.414; case 6: return y * 1.414; default: return -y * 1.414;
  }
};
const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);

/** Gradient noise, about -1..1. */
export function noise2(seed: number, x: number, y: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = fade(xf), v = fade(yf);
  const a = grad2(hashInts(seed, xi, yi), xf, yf), b = grad2(hashInts(seed, xi + 1, yi), xf - 1, yf);
  const c = grad2(hashInts(seed, xi, yi + 1), xf, yf - 1), d = grad2(hashInts(seed, xi + 1, yi + 1), xf - 1, yf - 1);
  return (a + (b - a) * u + (c - a + (a - b + d - c) * u) * v) * 0.7;
}

/** 3D value noise, about -1..1 (rocks, caves). */
export function noise3(seed: number, x: number, y: number, z: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const u = fade(x - xi), v = fade(y - yi), w = fade(z - zi);
  const n = (a: number, b: number, c: number) => (hashInts(seed, a, b, c) / 4294967295) * 2 - 1;
  const l = (a: number, b: number, t: number) => a + (b - a) * t;
  return l(
    l(l(n(xi, yi, zi), n(xi + 1, yi, zi), u), l(n(xi, yi + 1, zi), n(xi + 1, yi + 1, zi), u), v),
    l(l(n(xi, yi, zi + 1), n(xi + 1, yi, zi + 1), u), l(n(xi, yi + 1, zi + 1), n(xi + 1, yi + 1, zi + 1), u), v),
    w,
  );
}

export interface FbmOpts { octaves: number; lacunarity: number; gain: number }

/** Layers of noise, about -1..1. */
export function fbm(seed: number, x: number, y: number, o: FbmOpts): number {
  let amp = 1, f = 1, sum = 0, norm = 0;
  for (let i = 0; i < o.octaves; i++) {
    sum += noise2(seed + i * 1013, x * f, y * f) * amp;
    norm += amp; amp *= o.gain; f *= o.lacunarity;
  }
  return sum / Math.max(1e-6, norm);
}

export const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smoothstep = (a: number, b: number, v: number) => { const t = clamp((v - a) / (b - a || 1e-6)); return t * t * (3 - 2 * t); };
