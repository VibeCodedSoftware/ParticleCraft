// P1: per-property texture inputs — tiling, offset, rotation, animated sheets / scrolling / spin, random tiling.
import { describe, expect, it } from 'vitest';
import { cellRandom, groupPbrSets, materialSlots, newAnimation, newSlot, slotRepeat, slotTransform } from '../src/materialMaps';

describe('material texture slots', () => {
  it('the older single texture becomes the Base color slot', () => {
    const s = materialSlots({ map: 'proj:a.png' });
    expect(s.color?.asset).toBe('proj:a.png');
    expect(materialSlots({ map: 'proj:a.png', maps: { color: newSlot('proj:b.png') } }).color?.asset).toBe('proj:b.png');
  });

  it('automatic tiling is about one repeat every 2 m; set tiling wins per axis', () => {
    const s = newSlot('x');
    expect(slotRepeat(s, 10, 1, 4)).toEqual([5, 2]);
    expect(slotRepeat(s, 1, 1, 1)).toEqual([1, 1]);
    expect(slotRepeat({ ...s, tiling: [3, 0] }, 10, 1, 4)).toEqual([3, 2]);
  });

  it('offset and rotation pass through for a still texture', () => {
    const x = slotTransform({ ...newSlot('x'), offset: [0.25, 0.5], rotation: 90 }, [2, 2], 5);
    expect(x.repeat).toEqual([2, 2]); expect(x.offset).toEqual([0.25, 0.5]); expect(x.rotation).toBeCloseTo(Math.PI / 2);
    expect(x.frame).toBe(0);
  });

  it('an animated sheet shows one frame per tile, stepping at fps, top row first', () => {
    const s = { ...newSlot('x'), animated: newAnimation(8, 4, 2, 10) };
    const f0 = slotTransform(s, [1, 1], 0), f1 = slotTransform(s, [1, 1], 0.1), f5 = slotTransform(s, [1, 1], 0.5);
    expect(f0.repeat).toEqual([0.25, 0.5]);
    expect([f0.frame, f1.frame, f5.frame]).toEqual([0, 1, 5]);
    expect(f0.offset).toEqual([0, 0.5]); // frame 0: top-left (top row is v 0.5..1)
    expect(f5.offset[0]).toBeCloseTo(0.25); expect(f5.offset[1]).toBeCloseTo(0); // frame 5: second column, bottom row
    expect(slotTransform(s, [1, 1], 0.8).frame).toBe(0); // loops
  });

  it('scroll and spin move the texture over time', () => {
    const s = { ...newSlot('x'), animated: { ...newAnimation(), scroll: [0.5, 0] as [number, number], spin: 90 } };
    const a = slotTransform(s, [1, 1], 0), b = slotTransform(s, [1, 1], 2);
    expect(b.offset[0] - a.offset[0]).toBeCloseTo(1);
    expect(b.rotation - a.rotation).toBeCloseTo(Math.PI);
  });

  it('groups PBR texture sets by folder and base name; lone pictures are not sets', () => {
    const f = (p: string) => ({ id: 'lib:library/' + p, path: p });
    const sets = groupPbrSets([
      f('backrooms/carpet/carpet_basecolor.png'), f('backrooms/carpet/carpet_normal.png'), f('backrooms/carpet/carpet_roughness.png'), f('backrooms/carpet/carpet_metallic.png'),
      f('stone/Rock01_Albedo.jpg'), f('stone/Rock01_NormalGL.jpg'), f('stone/Rock01_AO.jpg'),
      f('ui/Health.png'), f('wallpapers/BR_Dots.jpg'), f('other/Lonely_Color.png'),
    ]);
    expect(sets.map((s) => s.name)).toEqual(['carpet', 'Rock01']);
    expect(Object.keys(sets[0].maps).sort()).toEqual(['color', 'metalness', 'normal', 'roughness']);
    expect(sets[1].maps.ao).toBe('lib:library/stone/Rock01_AO.jpg');
  });

  it('random tiling cells are deterministic per seed and vary between cells and seeds', () => {
    expect(cellRandom(3, 4, 1)).toBe(cellRandom(3, 4, 1));
    const cells = Array.from({ length: 16 }, (_, k) => cellRandom(k % 4, Math.floor(k / 4), 1));
    expect(new Set(cells.map((v) => Math.floor(v * 4))).size).toBeGreaterThan(2);
    expect(cellRandom(3, 4, 1)).not.toBe(cellRandom(3, 4, 2));
  });
});
