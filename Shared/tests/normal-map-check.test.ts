// Normal map check: tangent-space maps in either green convention are recognised; world / object-space passes (the
// green-yellow and pink pictures Blender's Normal pass gives) are flagged.
import { describe, expect, it } from 'vitest';
import { checkNormalMap } from '../src/normalMapCheck';

const enc = (v: number) => Math.round((Math.max(-1, Math.min(1, v)) * 0.5 + 0.5) * 255);

/** A 4 × 3 sheet of shaded balls (like a sprite sheet), coloured by `fn` from the ball's normal. */
function sheet(fn: (x: number, y: number, z: number) => [number, number, number], background?: [number, number, number, number]) {
  const W = 240, H = 180, C = 60, data = new Uint8ClampedArray(W * H * 4);
  if (background) for (let k = 0; k < W * H; k++) data.set(background, k * 4);
  for (let f = 0; f < 12; f++) {
    const cx = (f % 4) * C + 30, cy = Math.floor(f / 4) * C + 30;
    for (let y = -22; y <= 22; y++) for (let x = -22; x <= 22; x++) {
      const nx = x / 22, ny = -y / 22, d = nx * nx + ny * ny; if (d > 1) continue;
      data.set([...fn(nx, ny, Math.sqrt(1 - d)), 255], ((cy + y) * W + cx + x) * 4);
    }
  }
  return { data, W, H };
}

describe('normal map check', () => {
  it('OpenGL tangent-space map', () => {
    const s = sheet((x, y, z) => [enc(x), enc(y), enc(z)]);
    expect(checkNormalMap(s.data, s.W, s.H)).toEqual({ tangent: true, format: 'opengl' });
  });
  it('DirectX tangent-space map (green flipped)', () => {
    const s = sheet((x, y, z) => [enc(x), enc(-y), enc(z)]);
    expect(checkNormalMap(s.data, s.W, s.H)).toEqual({ tangent: true, format: 'directx' });
  });
  it('green-yellow world-space pass is not tangent-space', () => {
    const s = sheet((x, y, z) => [enc(0.35 + x * 0.4), enc(0.7 + y * 0.2), enc(-0.1 + z * 0.1)]);
    const r = checkNormalMap(s.data, s.W, s.H);
    expect(r.tangent).toBe(false); expect(r.reason).toMatch(/blue/);
  });
  it('pink object-space pass is not tangent-space', () => {
    const s = sheet((x, y, z) => [enc(0.6 + x * 0.3), enc(y * 0.4), enc(z)]);
    const r = checkNormalMap(s.data, s.W, s.H);
    expect(r.tangent).toBe(false); expect(r.reason).toMatch(/red \/ pink/);
  });
  it('opaque flat background: tangent, convention unknown', () => {
    const s = sheet((x, y, z) => [enc(x), enc(y), enc(z)], [128, 128, 255, 255]);
    expect(checkNormalMap(s.data, s.W, s.H)).toEqual({ tangent: true, format: 'unknown' });
  });
});
