// Sculpt-layer settings, the erosion simulation's sliding pass and wear map, and the data-driven ground look.
import { describe, expect, it } from 'vitest';
import { erodeGrid, erosionDefaults } from '../src/world/erosion';
import { applyTerrainPreset, buildFeatures, defaultConfig, worldHeight } from '../src/world/features';
import { groundColor, LOOK_PALETTES } from '../src/world/biomes';
import { packGrid } from '../src/world/terrain';
import type { WorldEdits } from '../src/world/document';

const edits = (): WorldEdits => ({ cell: 2, height: { '10,10': 6, '11,10': -6 }, paint: {}, density: {}, snow: {}, biome: {}, holes: {}, removed: [] });

describe('Sculpt layer settings', () => {
  const cfg = defaultConfig(); applyTerrainPreset(cfg, 'Flatlands');
  const f = buildFeatures(cfg, []);
  const at = (e: WorldEdits, x: number) => worldHeight(cfg, e, f)(x, 20);
  const base = worldHeight(cfg, null, f);
  it('Height scale multiplies the sculpting; 0 hides it', () => {
    const e = edits();
    expect(at(e, 20) - base(20, 20)).toBeCloseTo(6, 3);
    e.layer = { scale: 2 }; expect(at(e, 20) - base(20, 20)).toBeCloseTo(12, 3);
    e.layer = { scale: 0 }; expect(at(e, 20)).toBeCloseTo(base(20, 20), 3);
  });
  it('Raise only / Lower only keep one half', () => {
    const e = edits();
    e.layer = { op: 'raise' }; expect(at(e, 22)).toBeCloseTo(base(22, 20), 3); expect(at(e, 20) - base(20, 20)).toBeCloseTo(6, 3);
    e.layer = { op: 'lower' }; expect(at(e, 20)).toBeCloseTo(base(20, 20), 3); expect(at(e, 22) - base(22, 20)).toBeCloseTo(-6, 3);
  });
  it('Height offset lifts only where sculpted; blending fades the sculpting in and out', () => {
    const e = edits(); e.layer = { offset: 3 };
    expect(at(e, 20) - base(20, 20)).toBeCloseTo(9, 3);
    expect(at(e, 60)).toBeCloseTo(base(60, 20), 3);
    e.layer = { blend: 0.5 }; expect(at(e, 20) - base(20, 20)).toBeCloseTo(3, 3);
    e.layer = { blend: 0 }; expect(at(e, 20)).toBeCloseTo(base(20, 20), 3);
  });
  it('Snap to level step puts sculpted ground on the steps, and leaves the rest alone', () => {
    const e = edits(); e.layer = { step: 4 };
    expect(at(e, 20) % 4).toBeCloseTo(0, 2);
    expect(at(e, 60)).toBeCloseTo(base(60, 20), 3);
  });
});

describe('Erosion simulation', () => {
  // A smooth round hill.
  const N = 65, hill = () => { const h = new Float32Array(N * N); for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) h[j * N + i] = Math.max(0, 30 - Math.hypot(i - 32, j - 32)) * 1.6; return h; };
  it('sliding treats every direction alike (a round hill stays round: no streaks along the grid)', async () => {
    const h = hill();
    await erodeGrid(h, N, N, 1, { ...erosionDefaults(), rain: 0, thermal: 1, talus: 0.3 }, () => true);
    // Same distance from the top in four directions: the same height.
    for (const d of [8, 16, 24]) {
      const v = [h[32 * N + 32 + d], h[32 * N + 32 - d], h[(32 + d) * N + 32], h[(32 - d) * N + 32]];
      expect(Math.max(...v) - Math.min(...v)).toBeLessThan(0.05);
    }
  });
  it('gives a wear map where the land was worn down, and none where it filled up', async () => {
    const h = hill(), start = Float32Array.from(h);
    const r = (await erodeGrid(h, N, N, 1, { ...erosionDefaults(), rain: 1, strength: 0.8 }, () => true))!;
    let worn = 0, wrong = 0;
    for (let k = 0; k < h.length; k++) { if (r.wear[k] > 0.3) { worn++; if (h[k] > start[k] + 0.2) wrong++; } }
    expect(worn).toBeGreaterThan(20);
    expect(wrong).toBe(0);
  });
});

describe('Ground look', () => {
  it('colours from height and slope through the palette; erosion maps darken channels and pale the fans', () => {
    const cfg = defaultConfig(); applyTerrainPreset(cfg, 'Hills'); cfg.biomes.enabled = false; cfg.water.enabled = false; cfg.snow.enabled = false;
    const off = groundColor(cfg, null, 5, 5, 20, 0.05, { snow: false });
    cfg.surface.look = { palette: 'canyon', strength: 1 };
    const on = groundColor(cfg, null, 5, 5, 20, 0.05, { snow: false });
    expect(on).not.toEqual(off);
    // Canyon: red-brown ground.
    expect(on[0]).toBeGreaterThan(on[2] * 1.3);
    // A grid whose flow map says "channel" here, and another point it says "sediment".
    const n = 4, flow = new Uint8Array(n * n).fill(255), dep = new Uint8Array(n * n).fill(0), dep2 = new Uint8Array(n * n).fill(255);
    const e = (d: Uint8Array, fl: Uint8Array): WorldEdits => ({ cell: 2, height: {}, paint: {}, density: {}, snow: {}, biome: {}, holes: {}, removed: [], grids: [{ id: 'g', label: 'Erosion', x0: 0, z0: 0, nx: n, nz: n, cell: 4, maps: { flow: packGrid(fl), wear: packGrid(new Uint8Array(n * n)), deposit: packGrid(d) } }] });
    const lum = (c: number[]) => c[0] + c[1] + c[2];
    const channel = groundColor(cfg, e(dep, flow), 5, 5, 20, 0.05, { snow: false });
    const fan = groundColor(cfg, e(dep2, new Uint8Array(n * n)), 5, 5, 20, 0.05, { snow: false });
    expect(lum(channel)).toBeLessThan(lum(on));
    expect(lum(fan)).toBeGreaterThan(lum(on));
    expect(Object.keys(LOOK_PALETTES).length).toBeGreaterThanOrEqual(5);
  });
});
