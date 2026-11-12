// Sprite-sheet animation: picking the playing animation, frame timing, and grid layout.
import { describe, expect, it } from 'vitest';
import { animFrame, frameCell, pickSpriteAnim } from '../src/runtime/spriteAnim';
import type { SpriteData } from '../src/runtime/scene';

const sheet: SpriteData = { image: 'img:hero', frames: 8, rows: 2, fps: 8, animation: 'idle', animations: { idle: { from: 0, to: 1, fps: 4, loop: true }, walk: { from: 2, to: 5, fps: 10, loop: true }, jump: { from: 6, to: 7, fps: 6, loop: false } } };

describe('sprite animation', () => {
  it('plays the movement animation when the sprite has it, else its default', () => {
    expect(pickSpriteAnim(sheet, 'walk').name).toBe('walk');
    expect(pickSpriteAnim(sheet, 'fall').name).toBe('idle'); // no "fall": default animation
    expect(pickSpriteAnim({ ...sheet, animation: '', animations: {} }, 'walk').anim).toMatchObject({ from: 0, to: 7, loop: true });
  });

  it('loops or holds the last frame', () => {
    const walk = sheet.animations!.walk, jump = sheet.animations!.jump;
    expect(animFrame(walk, 0)).toBe(2);
    expect(animFrame(walk, 0.35)).toBe(5);
    expect(animFrame(walk, 0.4)).toBe(2); // wrapped
    expect(animFrame(jump, 5)).toBe(7); // once: stays on the last frame
  });

  it('finds frames in a grid sheet, left to right then top to bottom', () => {
    expect(frameCell(sheet, 0)).toEqual({ col: 0, row: 0, cols: 4, rows: 2 });
    expect(frameCell(sheet, 5)).toEqual({ col: 1, row: 1, cols: 4, rows: 2 });
    expect(frameCell({ frames: 6 }, 4)).toEqual({ col: 4, row: 0, cols: 6, rows: 1 });
  });
});
