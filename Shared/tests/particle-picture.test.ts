// An effect's own particle picture goes from the block into the emitter, and pickers for Breakable's fields are offered.
import { describe, expect, it } from 'vitest';
import { VFX_BLOCK } from '../src/vfx/vfx';
import { BEHAVIORS } from '../src/runtime/behaviors';
import { EFFECTS, POSTFX_PRESETS } from '../src/postfx';

describe('particle pictures', () => {
  it('the output block offers one, and it reaches the emitter', () => {
    expect(VFX_BLOCK.render.props.find((p) => p.key === 'image')?.type).toBe('image');
    const p: Record<string, unknown> = {};
    VFX_BLOCK.render.apply(p as never, { texture: 'smoke', image: 'data:image/png;base64,AAAA', blending: 'normal', space: 'world' });
    expect(p.textureImage).toBe('data:image/png;base64,AAAA');
    VFX_BLOCK.render.apply(p as never, { texture: 'smoke', image: '', blending: 'normal', space: 'world' });
    expect(p.textureImage).toBeUndefined();
  });
});

describe('Breakable fields', () => {
  it('are pickers, not text boxes', () => {
    const type = (k: string) => BEHAVIORS.breakable.props.find((p) => p.key === k)?.type;
    expect(type('inside')).toBe('color');
    expect(type('particles')).toBe('particle');
    expect(type('sound')).toBe('sound');
  });
});

describe('volumetric fog', () => {
  it('is an effect with a preset', () => {
    expect(EFFECTS.volumetric.params.map((p) => p.key)).toEqual(['density', 'height', 'falloff', 'color', 'sun', 'wisps', 'distance']);
    expect(POSTFX_PRESETS.volumetric.stack()[0].type).toBe('volumetric');
  });
});
