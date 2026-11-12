// P1 material rework: water's look (colour, opacity, animated surface) lives in the object's Material, not on the
// Water behavior, which only does the physics.
import { describe, expect, it } from 'vitest';
import { makeInstance } from '../src/runtime/scene';
import { BEHAVIORS, behaviorDefaults } from '../src/runtime/behaviors';
import { applyWaterLook, isWaterSurface, migrateWaterLook, WATER_LOOK } from '../src/runtime/water';

describe('water look in the material', () => {
  it('the Water behavior has only physics properties', () => {
    const keys = BEHAVIORS.water.props.map((p) => p.key);
    expect(keys).toEqual(expect.arrayContaining(['density', 'drag', 'swimSpeed', 'enabled']));
    for (const k of ['color', 'opacity', 'waves']) expect(keys).not.toContain(k);
  });

  it('older projects move Color, Opacity and Animated surface into the object', () => {
    const i = makeInstance(1, 'Pool', 'box', { behaviors: [{ type: 'water', props: { ...behaviorDefaults('water'), color: '#123456', opacity: 0.4, waves: false } }] });
    expect(migrateWaterLook(i)).toBe(true);
    expect(i.color).toBe('#123456');
    expect(i.opacity).toBe(40);
    expect(i.material?.surface).toBe('water');
    expect(i.material?.ripples).toBe(false);
    expect(i.behaviors[0].props).not.toHaveProperty('color');
    expect(migrateWaterLook(i)).toBe(false); // already moved
  });

  it('adding Water makes it look like water, but never overrides a chosen material', () => {
    const a = makeInstance(1, 'Pool', 'box', { behaviors: [{ type: 'water', props: behaviorDefaults('water') }] });
    expect(isWaterSurface(a)).toBe(true); // no surface chosen yet: the behavior implies it
    applyWaterLook(a);
    expect(a.material?.surface).toBe('water'); expect(a.color).toBe(WATER_LOOK.color); expect(a.opacity).toBe(WATER_LOOK.opacity);
    const b = makeInstance(2, 'Lava', 'box', { color: '#ff5500', behaviors: [{ type: 'water', props: behaviorDefaults('water') }] });
    b.material = { ...b.material!, surface: 'standard' };
    applyWaterLook(b);
    expect(isWaterSurface(b)).toBe(false); expect(b.color).toBe('#ff5500');
  });
});
