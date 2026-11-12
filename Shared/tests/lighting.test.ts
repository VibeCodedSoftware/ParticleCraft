// The plain-data side of GI: probe grids, bakes in the project file, probes inside walls, out-of-date detection.
import { describe, expect, it } from 'vitest';
import { GI_QUALITY, bakeSignature, decodeProbes, encodeProbes, fillInvalidProbes, fromHalf, planVolume, probeIndex, toHalf } from '../src/runtime/lighting';
import { emptyScene, makeInstance } from '../src/runtime/scene';

describe('probe volume', () => {
  it('covers the box at the quality\'s spacing, and better quality means more probes', () => {
    const count = (q: any) => { const v = planVolume([0, 0, 0], [20, 4, 20], q); return v.dims[0] * v.dims[1] * v.dims[2]; };
    expect(count('low')).toBeLessThan(count('medium'));
    expect(count('medium')).toBeLessThan(count('high'));
    const v = planVolume([-10, 1, -5], [10, 5, 5], 'low');
    expect(v.min).toEqual([-10, 1, -5]); expect(v.size).toEqual([20, 4, 10]); expect(v.dims).toEqual([6, 2, 4]);
  });
  it('a huge scene never goes over the limit, and real-time has a lower one', () => {
    for (const q of ['low', 'medium', 'high'] as const) {
      const big = planVolume([0, 0, 0], [900, 50, 900], q), rt = planVolume([0, 0, 0], [900, 50, 900], q, true);
      expect(big.dims[0] * big.dims[1] * big.dims[2]).toBeLessThanOrEqual(GI_QUALITY[q].maxProbes);
      expect(rt.dims[0] * rt.dims[1] * rt.dims[2]).toBeLessThanOrEqual(GI_QUALITY[q].realtimeMax);
    }
  });
  it('a tiny or flat scene still has a real grid', () => {
    const v = planVolume([1, 1, 1], [1, 1, 1]);
    expect(v.dims.every((d) => d >= 2)).toBe(true);
    expect(v.size.every((s) => s > 0)).toBe(true);
  });
});

describe('probes inside walls', () => {
  it('take their neighbours\' light, spreading inwards; good probes don\'t change', () => {
    const dims = [3, 1, 1], values = new Float32Array(3 * 18), valid = Uint8Array.from([1, 0, 0]);
    for (let k = 0; k < 18; k++) values[k] = 2;
    fillInvalidProbes(values, valid, dims);
    expect(values[probeIndex(dims, 1, 0, 0)]).toBeCloseTo(2);
    expect(values[probeIndex(dims, 2, 0, 0) + 5]).toBeCloseTo(2);
    expect(values[0]).toBe(2);
  });
  it('with none valid, nothing happens (and it ends)', () => {
    const values = new Float32Array(18 * 2);
    fillInvalidProbes(values, new Uint8Array(2), [2, 1, 1]);
    expect(values.every((v) => v === 0)).toBe(true);
  });
});

describe('a bake in the project file', () => {
  it('half floats keep light values closely', () => {
    for (const v of [0, 0.001, 0.25, 1, 3.5, 40, 1000]) expect(fromHalf(toHalf(v))).toBeCloseTo(v, v < 1 ? 2 : 0);
    expect(toHalf(-1)).toBe(0);
  });
  it('round trips through text', () => {
    const values = Float32Array.from({ length: 180 }, (_, k) => (k % 17) * 0.13);
    const back = decodeProbes(encodeProbes(values));
    expect(back.length).toBe(values.length);
    for (let k = 0; k < values.length; k++) expect(Math.abs(back[k] - values[k])).toBeLessThan(0.002);
  });
  it('survives the size of a large volume', () => {
    const values = new Float32Array(10000 * 18).fill(0.5);
    expect(decodeProbes(encodeProbes(values)).length).toBe(values.length);
  });
});

describe('knowing a bake is out of date', () => {
  const scene = () => { const s = emptyScene('S', '3d'); s.instances = [makeInstance(1, 'Wall', 'box', { color: '#ff0000' }), makeInstance(2, 'Hero', 'box', { behaviors: [{ type: 'platform', props: {} }] }), makeInstance(3, 'Lamp', 'light', { light: { power: 100 } as any })]; return s; };
  it('a wall or a light changing counts; a moving character does not', () => {
    const base = bakeSignature(scene());
    expect(bakeSignature(scene())).toBe(base);
    const wall = scene(); wall.instances[0].x = 3;
    expect(bakeSignature(wall)).not.toBe(base);
    const colour = scene(); colour.instances[0].color = '#00ff00';
    expect(bakeSignature(colour)).not.toBe(base);
    const lamp = scene(); lamp.instances[2].light!.power = 500;
    expect(bakeSignature(lamp)).not.toBe(base);
    const hero = scene(); hero.instances[1].x = 9;
    expect(bakeSignature(hero)).toBe(base);
  });
});
