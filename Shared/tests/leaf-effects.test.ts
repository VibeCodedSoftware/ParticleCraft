// ParticleCraft's leaf effects: real editable graphs, using the supplied leaf pictures, falling and wind-blown behaving
// differently, in all three styles.
import { describe, expect, it } from 'vitest';
import { VFX_PRESETS, compileGraph, parseVfxAsset, newAsset, finalizeAsset } from '../src/vfx/vfx';

const leaves = VFX_PRESETS.filter((p) => p.category === 'Leaves');

describe('leaf effects', () => {
  it('falling and wind-blown, each realistic, stylized and pixel art', () => {
    expect(leaves.map((p) => p.id).sort()).toEqual(['falling-leaves-pixel', 'falling-leaves-realistic', 'falling-leaves-stylized', 'wind-leaves-pixel', 'wind-leaves-realistic', 'wind-leaves-stylized']);
  });
  it('compile without warnings, with a picture on every layer', () => {
    for (const p of leaves) {
      const r = compileGraph(p.build());
      expect(r.warnings, p.id).toEqual([]);
      expect(r.layers.length, p.id).toBeGreaterThan(0);
      for (const l of r.layers) expect(l.params.textureImage, p.id).toMatch(/^data:image\/png;base64,/);
    }
  });
  it('realistic mixes several pictures; wind pushes sideways, falling lands on the floor', () => {
    expect(compileGraph(leaves.find((p) => p.id === 'falling-leaves-realistic')!.build()).layers.length).toBe(4);
    const wind = compileGraph(leaves.find((p) => p.id === 'wind-leaves-realistic')!.build()).layers[0].params;
    const fall = compileGraph(leaves.find((p) => p.id === 'falling-leaves-realistic')!.build()).layers[0].params;
    expect(Math.abs(wind.acceleration[0])).toBeGreaterThan(0);
    expect(fall.collideFloor).toBe(true);
    expect(Math.abs(wind.gravity)).toBeLessThan(Math.abs(fall.gravity));
  });
  it('survive saving and loading', () => {
    const a = finalizeAsset(newAsset('Leaves', leaves[0].build(), 'Leaves'));
    expect(parseVfxAsset(JSON.stringify(a)).name).toBe('Leaves');
  });
});
