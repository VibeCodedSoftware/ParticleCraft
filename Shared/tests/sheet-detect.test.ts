// P1: sprite-sheet auto-slicing (the user corrects the guess in the slicer).
import { describe, expect, it } from 'vitest';
import { detectSheet } from '../src/sheetDetect';

/** A w×h RGBA image with blobs drawn by `paint(x, y) → [r,g,b,a] | null`. */
function img(w: number, h: number, paint: (x: number, y: number) => number[] | null, bg = [0, 0, 0, 0]) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) d.set(paint(x, y) ?? bg, (y * w + x) * 4);
  return d;
}

describe('sprite sheet auto-slicing', () => {
  it('transparent gutters: 4 × 2 frames of 16 px, last row half full → 6 frames', () => {
    const d = img(64, 32, (x, y) => { const c = Math.floor(x / 16), r = Math.floor(y / 16), fx = x % 16, fy = y % 16; if (r === 1 && c >= 2) return null; return fx > 2 && fx < 13 && fy > 1 && fy < 14 ? [200, 50, 50, 255] : null; });
    const g = detectSheet(d, 64, 32);
    expect([g.cols, g.rows, g.frameW, g.frameH, g.frames, g.how]).toEqual([4, 2, 16, 16, 6, 'gutters']);
  });

  it('opaque sheet with a solid background colour works the same', () => {
    const bg = [255, 0, 255, 255];
    const d = img(96, 24, (x, y) => (x % 24 > 4 && x % 24 < 20 && y > 3 && y < 20 ? [30, 140, 60, 255] : null), bg);
    const g = detectSheet(d, 96, 24);
    expect([g.cols, g.rows, g.frames]).toEqual([4, 1, 4]);
  });

  it('frames touching with no gutter are found by their repeat period', () => {
    const d = img(120, 20, (x, y) => { const f = x % 20; return [f * 12, (y * 11) % 255, 128, 255]; });
    const g = detectSheet(d, 120, 20);
    expect(g.cols).toBe(6); expect(g.rows).toBe(1); expect(g.how).toBe('period');
  });

  it('a single picture stays one frame', () => {
    const d = img(40, 30, (x, y) => (Math.hypot(x - 20, y - 15) < 10 ? [255, 255, 0, 255] : null));
    const g = detectSheet(d, 40, 30);
    expect([g.cols, g.rows, g.frames]).toEqual([1, 1, 1]);
  });
});
