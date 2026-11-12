// Sprite sheets with a margin around them and gaps between frames.
import { describe, expect, it } from 'vitest';
import { sheetGrid } from '../src/sheetDetect';

describe('sheet grid', () => {
  it('no margin or spacing behaves as a plain grid', () => {
    expect(sheetGrid(64, 32, 'grid', 2, 1, 0, 0)).toEqual({ c: 2, r: 1, w: 32, h: 32 });
    expect(sheetGrid(64, 32, 'size', 0, 0, 16, 16)).toEqual({ c: 4, r: 2, w: 16, h: 16 });
  });
  it('by columns and rows: the frame size allows for both', () => {
    // 2 + 16 + 1 + 16 + 1 + 16 + 2 = 54 across, 2 + 16 + 1 + 16 + 2 = 37 down.
    expect(sheetGrid(54, 37, 'grid', 3, 2, 0, 0, 2, 1)).toEqual({ c: 3, r: 2, w: 16, h: 16 });
  });
  it('by frame size: counts what fits, and a last frame needs no gap after it', () => {
    expect(sheetGrid(54, 37, 'size', 0, 0, 16, 16, 2, 1)).toEqual({ c: 3, r: 2, w: 16, h: 16 });
    expect(sheetGrid(53, 37, 'size', 0, 0, 16, 16, 2, 1).c).toBe(2); // one pixel short of the third
  });
  it('a silly setting still gives at least one frame by size', () => {
    expect(sheetGrid(8, 8, 'size', 0, 0, 16, 16, 20, 5)).toMatchObject({ c: 1, r: 1 });
  });
});
