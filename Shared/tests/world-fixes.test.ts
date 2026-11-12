// The Desert preset, snow only where it should be, grass in poor biomes, and the solar-system planets.
import { describe, expect, it } from 'vitest';
import { applyTerrainPreset, defaultConfig, riverWaterAttrs, riverWaterMesh, type LakeShape, type RiverPath } from '../src/world/features';
import { riverOptions, waterOptions } from '../src/world/waterLook';
import { biomeAt, snowAt } from '../src/world/biomes';
import { gasColor, isGasGiant, PLANET_PRESETS, planetColor, planetClimate, planetDefaults, planetHeight } from '../src/world/planet';

describe('River water', () => {
  // A river that turns hard left and runs into a round lake.
  const r: RiverPath = { points: [[0, 0], [8, 0], [16, 0], [20, 6], [18, 14], [14, 22], [14, 30]], levels: [10, 9.8, 9.6, 9.4, 9.2, 9, 9], widths: [6, 6, 6, 6, 6, 6, 6] };
  const lake: LakeShape = { x: 14, z: 40, radius: 12, level: 9, shape: [1, 1, 1, 1, 1, 1, 1, 1] };
  it('never folds back on itself at a tight bend (the pinched star)', () => {
    const m = riverWaterMesh(r), row = 7;
    for (let s = 0; s < row; s++) for (let i = 1; i < r.points.length; i++) {
      const a = r.points[Math.max(0, i - 2)], b = r.points[Math.min(r.points.length - 1, i + 2)], l = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const p = (i - 1) * row + s, q = i * row + s;
      const adv = ((m.positions[q * 3] - m.positions[p * 3]) * (b[0] - a[0]) + (m.positions[q * 3 + 2] - m.positions[p * 3 + 2]) * (b[1] - a[1])) / l;
      expect(adv).toBeGreaterThan(0.2);
    }
  });
  it('rounds off a source on land and melts into the lake it runs into', () => {
    const at = riverWaterAttrs(r, [lake], null);
    expect(at.capStart).toBe(true);
    expect(at.capEnd).toBe(false);
    const row = 7, last = (r.points.length - 1) * row + 3, first = 3;
    expect(at.show[first]).toBe(1);
    expect(at.show[last]).toBeLessThan(1);
    expect(at.from[first]).toBe(0); expect(at.to[last]).toBe(0);
    // Into the sea too.
    expect(riverWaterAttrs(r, [], 9.05).capEnd).toBe(false);
    expect(riverWaterAttrs(r, [], null).capEnd).toBe(true);
  });
  it("rivers and lakes reach their deep colour within their depth and keep the foam to a thin shore line", () => {
    const w = defaultConfig().water;
    const o = riverOptions(w), sea = waterOptions(w, 400);
    expect(o.clarity).toBeLessThanOrEqual(2.5);
    expect(o.foamWidth).toBeLessThanOrEqual(0.3);
    expect(o.deepColor).toBe(sea.deepColor);
  });
});

describe('Desert preset', () => {
  it('is a sand desert: dunes, sand colours, no plants or water, no biome meadows; leaving it brings the meadow back', () => {
    const c = defaultConfig(); applyTerrainPreset(c, 'Desert');
    expect(c.terrain.layers?.some((l) => l.type === 'dunes')).toBe(true);
    expect(c.surface.greens).toBe(false);
    expect(c.water.enabled).toBe(false);
    expect(c.biomes.enabled).toBe(false);
    expect(c.layers.filter((l) => ['tree', 'grass', 'flower', 'bush'].includes(l.kind)).every((l) => !l.enabled)).toBe(true);
    applyTerrainPreset(c, 'Hills');
    expect(c.terrain.layers?.some((l) => l.name === 'Desert dunes')).toBe(false);
    expect(c.surface.greens).toBe(true);
    expect(c.layers.find((l) => l.id === 'l_grass')?.enabled).toBe(true);
  });
});

describe('Snow with Snow off', () => {
  it('no snow and no snow biome on plateaus or hills; only on the peaks of tall mountains', () => {
    const c = defaultConfig(); applyTerrainPreset(c, 'Plateaus'); c.snow.enabled = false;
    const top = c.terrain.baseHeight + c.terrain.height;
    let snow = 0, white = 0;
    for (let x = -400; x < 400; x += 37) for (let z = -400; z < 400; z += 41) { snow += snowAt(c, null, x, z, top, 0.05); if (biomeAt(c, null, x, z, top).id === 'snow') white++; }
    expect(snow).toBe(0); expect(white).toBe(0);
    const m = defaultConfig(); applyTerrainPreset(m, 'Mountains'); m.snow.enabled = false; m.terrain.height = 150;
    expect(snowAt(m, null, 0, 0, m.terrain.baseHeight + 150, 0.05)).toBeGreaterThan(0.5);
    expect(snowAt(m, null, 0, 0, m.terrain.baseHeight + 60, 0.05)).toBe(0);
  });
});

describe('Planets', () => {
  it('every preset gives finite land and colours', () => {
    for (const name of Object.keys(PLANET_PRESETS)) {
      const p = planetDefaults(name);
      for (const [x, y, z] of [[1, 0, 0], [0, 1, 0], [0.6, 0.6, 0.53], [-0.3, -0.9, 0.3]]) {
        const s = planetHeight(p, x, y, z), c = isGasGiant(p) ? gasColor(p, x, y, z) : planetColor(p, s, planetClimate(p, x, y, z, s.h));
        expect(Number.isFinite(s.h), name).toBe(true);
        for (const v of c) expect(v >= 0 && v <= 1.0001, name).toBe(true);
      }
    }
    for (const n of ['Mercury', 'Venus', 'Jupiter', 'Saturn', 'Uranus', 'Neptune', 'Pluto']) expect(PLANET_PRESETS[n]).toBeDefined();
  });
  it('gas giants have no ground and are banded; Saturn has rings', () => {
    const j = planetDefaults('Jupiter');
    expect(planetHeight(j, 0.3, 0.4, 0.86).h).toBe(0);
    const lum = (c: number[]) => c[0] + c[1] + c[2];
    const down = Array.from({ length: 40 }, (_, i) => { const y = -0.9 + i * 0.045, r = Math.sqrt(1 - y * y); return lum(gasColor(j, r, y, 0)); });
    expect(Math.max(...down) - Math.min(...down)).toBeGreaterThan(0.25);
    expect(planetDefaults('Saturn').rings).toBeGreaterThan(0.5);
  });
});
