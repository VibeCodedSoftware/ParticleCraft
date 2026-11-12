// P1: the Outline effect gets transparency and an optional (default OFF) animated noise with an intensity control.
import { describe, expect, it } from 'vitest';
import { OBJECT_FX, canvasFilter, makeObjectFx } from '../src/objectFx';

describe('outline effect', () => {
  it('has opacity, and noise that is off by default with intensity and speed', () => {
    const keys = OBJECT_FX.outline.params.map((p) => p.key);
    expect(keys).toEqual(expect.arrayContaining(['width', 'color', 'opacity', 'noise', 'noiseAmount', 'noiseSpeed']));
    const o = makeObjectFx('outline');
    expect(o.params.noise).toBe(0);
    expect(o.params.opacity).toBe(1);
    expect(OBJECT_FX.outline.params.find((p) => p.key === 'noiseAmount')!.when).toBe('noise');
  });

  it('2D: opacity becomes the line colour\'s alpha; without noise the line never changes over time', () => {
    const o = makeObjectFx('outline'); o.params.color = '#ff0000'; o.params.opacity = 0.4;
    expect(canvasFilter([o], 0)).toContain('rgba(255, 0, 0, 0.4)');
    expect(canvasFilter([o], 0)).toBe(canvasFilter([o], 3.7));
  });

  it('2D: with noise on, width and alpha move over time, scaled by intensity', () => {
    const o = makeObjectFx('outline'); o.params.noise = 1; o.params.noiseAmount = 1;
    const frames = [0.1, 0.4, 0.9, 1.3].map((t) => canvasFilter([o], t));
    expect(new Set(frames).size).toBeGreaterThan(1);
    o.params.noiseAmount = 0;
    expect(new Set([0.1, 0.4, 0.9].map((t) => canvasFilter([o], t))).size).toBe(1);
  });
});
