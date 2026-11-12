// Per-scene indirect light and reflections (World panel, scene.settings.lighting), and the plain data work behind them:
// planning a light probe volume, storing a bake in the project, patching up probes that ended up inside walls.
// The GPU side (capture and shading) is GameCraft's engine/lighting.ts.
export type GiMode = 'off' | 'baked' | 'realtime';
export type GiQuality = 'low' | 'medium' | 'high';

export interface GiBake {
  min: [number, number, number]; size: [number, number, number]; dims: [number, number, number];
  /** Six RGB half floats per probe, for +X -X +Y -Y +Z -Z, base64. */
  data: string;
  /** What the scene looked like when baked: a different signature means the bake is out of date. */
  sig: string; bounces: number; bakedAt: string;
}
export interface LightingSettings {
  gi?: GiMode; giStrength?: number; giQuality?: GiQuality; giBounces?: number; giBake?: GiBake;
  /** Screen-space reflections: strength (0 = off), how far they reach, how thick surfaces count as. */
  ssr?: number; ssrDistance?: number; ssrThickness?: number;
}

/** Metres between probes, and the most probes a volume may have. Real-time updates need far fewer. */
export const GI_QUALITY: Record<GiQuality, { spacing: number; maxProbes: number; realtimeMax: number; label: string }> = {
  low: { spacing: 4, maxProbes: 1500, realtimeMax: 300, label: 'Low (a probe every 4 m)' },
  medium: { spacing: 2.5, maxProbes: 4000, realtimeMax: 600, label: 'Medium (every 2.5 m)' },
  high: { spacing: 1.5, maxProbes: 10000, realtimeMax: 1000, label: 'High (every 1.5 m)' },
};

/** A probe grid over a box: at the quality's spacing, spread wider when that would be too many probes. */
export function planVolume(min: number[], max: number[], quality: GiQuality = 'medium', realtime = false): { min: [number, number, number]; size: [number, number, number]; dims: [number, number, number] } {
  const q = GI_QUALITY[quality], limit = realtime ? q.realtimeMax : q.maxProbes;
  const size = [0, 1, 2].map((k) => Math.max(0.5, max[k] - min[k]));
  let spacing = q.spacing;
  const dimsAt = (s: number) => size.map((v) => Math.max(2, Math.ceil(v / s) + 1));
  let dims = dimsAt(spacing);
  while (dims[0] * dims[1] * dims[2] > limit) { spacing *= 1.15; dims = dimsAt(spacing); }
  return { min: [min[0], min[1], min[2]], size: [size[0], size[1], size[2]], dims: [dims[0], dims[1], dims[2]] };
}

const FACES = 6, RGB = 3;
export const probeIndex = (dims: number[], x: number, y: number, z: number) => (x + y * dims[0] + z * dims[0] * dims[1]) * FACES * RGB;

/**
 * Probes inside solid objects saw nothing useful: each takes the average of its valid neighbours, spreading inwards, so
 * walls don't print dark edges on the rooms beside them. Changes `values`; `valid` has one entry per probe.
 */
export function fillInvalidProbes(values: Float32Array, valid: Uint8Array, dims: number[]) {
  const [w, h, d] = dims, at = (x: number, y: number, z: number) => x + y * w + z * w * h;
  const ok = Uint8Array.from(valid);
  if (!ok.some(Boolean)) return;
  for (let changed = true; changed;) {
    changed = false;
    const next = Uint8Array.from(ok);
    for (let z = 0; z < d; z++) for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (ok[at(x, y, z)]) continue;
      const sum = new Float32Array(FACES * RGB); let n = 0;
      for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
        const X = x + dx, Y = y + dy, Z = z + dz;
        if (X < 0 || Y < 0 || Z < 0 || X >= w || Y >= h || Z >= d || !ok[at(X, Y, Z)]) continue;
        const from = probeIndex(dims, X, Y, Z);
        for (let k = 0; k < sum.length; k++) sum[k] += values[from + k];
        n++;
      }
      if (!n) continue;
      const to = probeIndex(dims, x, y, z);
      for (let k = 0; k < sum.length; k++) values[to + k] = sum[k] / n;
      next[at(x, y, z)] = 1; changed = true;
    }
    ok.set(next);
  }
}

// ---- bakes in the project file: half floats (plenty for light), as text
const f32 = new Float32Array(1), i32 = new Int32Array(f32.buffer);
export function toHalf(v: number): number {
  f32[0] = Math.max(0, Math.min(65000, v));
  const x = i32[0], e = ((x >> 23) & 0xff) - 112, m = x & 0x7fffff;
  if (e <= 0) return 0;
  return (e << 10) | (m >> 13);
}
export function fromHalf(h: number): number {
  const e = (h >> 10) & 0x1f, m = h & 0x3ff;
  if (!e) return (m / 1024) * 2 ** -14;
  return (1 + m / 1024) * 2 ** (e - 15);
}
export function encodeProbes(values: Float32Array): string {
  const bytes = new Uint8Array(values.length * 2);
  for (let k = 0; k < values.length; k++) { const h = toHalf(values[k]); bytes[k * 2] = h & 255; bytes[k * 2 + 1] = h >> 8; }
  let s = '';
  for (let k = 0; k < bytes.length; k += 0x8000) s += String.fromCharCode(...bytes.subarray(k, k + 0x8000));
  return btoa(s);
}
export function decodeProbes(data: string): Float32Array {
  const s = atob(data), out = new Float32Array(s.length >> 1);
  for (let k = 0; k < out.length; k++) out[k] = fromHalf(s.charCodeAt(k * 2) | (s.charCodeAt(k * 2 + 1) << 8));
  return out;
}

/** What a bake depends on: the things that stay put, their colours, the lights and the ambient light. */
export function bakeSignature(scene: { instances: any[]; settings: any }): string {
  const parts = scene.instances
    .filter((i) => i.kind === 'light' || (!isMoving(i) && i.kind !== 'camera' && i.kind !== 'text' && i.kind !== 'emitter' && i.kind !== 'sprite' && i.visible !== false))
    .map((i) => [i.uid, i.kind, i.x, i.y, i.z, i.rx, i.ry, i.rz, i.sx, i.sy, i.sz, i.color, i.mesh?.asset, i.light?.power, i.light?.color, i.material?.emissive, i.material?.emissiveStrength].join());
  const w = scene.settings.world ?? {};
  parts.push(`${w.color}|${w.strength}`);
  let h = 2166136261;
  const text = parts.join(';');
  for (let k = 0; k < text.length; k++) { h ^= text.charCodeAt(k); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}

const MOVERS = new Set(['platform', 'eightdir', 'car', 'pathfinding', 'pathfollow', 'bullet', 'physics', 'rigidbody', 'sine', 'rotate', 'vrplayer', 'wander', 'gridpiece']);
/** Moving things stay out of a bake: they would leave a lasting glow where they happened to stand. */
export const isMoving = (i: { behaviors?: { type: string }[] }) => !!i.behaviors?.some((b) => MOVERS.has(b.type));
