// Deterministic seeded RNG (mulberry32). Both apps use it so `random()` matches in conformance tests.

/** A fresh seed from the clock (Randomize seed, or a scene set to a random seed every play). */
export function clockSeed(): number { return ((Date.now() ^ (Math.floor(performance.now() * 1000) << 7)) >>> 0) % 2147483647 || 1; }
export class Rng {
  private s: number;
  constructor(seed = 1) { this.s = seed >>> 0 || 1; }
  next(): number {
    let t = (this.s += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a: number, b: number) { return a + this.next() * (b - a); }
  seed(v: number) { this.s = v >>> 0 || 1; }
}
