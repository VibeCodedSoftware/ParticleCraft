// New water must be glossy, or its ripples and glints can't show; a finish someone chose stays.
import { describe, expect, it } from 'vitest';
import { makeInstance } from '../src/runtime/scene';
import { WATER_LOOK, applyWaterLook, isWaterSurface, migrateMatteWater } from '../src/runtime/water';

describe('water setup', () => {
  it('a new object given the Water behavior is glossy water', () => {
    const i = makeInstance(1, 'Lake', 'box', {});
    expect(i.material!.roughness).toBe(0.6); // what every object starts with
    applyWaterLook(i);
    expect(i.material).toMatchObject({ surface: 'water', ripples: true, roughness: 0.08, metalness: 0.1 });
    expect(isWaterSurface(i)).toBe(true);
    expect(i.color).toBe(WATER_LOOK.color);
  });
  it('keeps a finish that was chosen', () => {
    const i = makeInstance(1, 'Lake', 'box', {});
    i.material = { ...i.material!, roughness: 0.3, metalness: 0.5 };
    applyWaterLook(i);
    expect(i.material).toMatchObject({ roughness: 0.3, metalness: 0.5 });
  });
  it('leaves an object whose surface was already set alone', () => {
    const i = makeInstance(1, 'Lake', 'box', {});
    i.material = { ...i.material!, surface: 'standard' };
    applyWaterLook(i);
    expect(i.material.surface).toBe('standard');
  });
  it('old water saved matte gets its gloss, and every look setting stays', () => {
    const i = makeInstance(1, 'Lake', 'box', {});
    const water = { waves: true, waveHeight: 0.4, foam: true, foamWidth: 1, toonFoam: 0.5, caustics: true };
    i.material = { ...i.material!, surface: 'water', water };
    expect(migrateMatteWater(i)).toBe(true);
    expect(i.material).toMatchObject({ roughness: 0.08, metalness: 0.1, water });
  });
  it('old water with a chosen finish, and anything that is not water, is left alone', () => {
    const a = makeInstance(1, 'Lake', 'box', {});
    a.material = { ...a.material!, surface: 'water', roughness: 0.2 };
    expect(migrateMatteWater(a)).toBe(false);
    expect(migrateMatteWater(makeInstance(2, 'Cube', 'box', {}))).toBe(false);
  });
});
