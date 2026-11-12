// Sprite-sheet animation shared by both renderers: which frame of which named animation shows at time t,
// and where that frame sits in a strip or grid sheet.
import type { SpriteData } from './scene';

export type SpriteAnim = { from: number; to: number; fps: number; loop: boolean };

/**
 * The animation a sprite shows: the playing one (Play animation, or idle/walk/jump/fall set by the Platform
 * and 8 Direction behaviors) when the sprite has it, else its default animation, else all frames in a loop.
 */
export function pickSpriteAnim(s: SpriteData, playing?: string, anims: Record<string, SpriteAnim> | undefined = s.animations): { name: string; anim: SpriteAnim } {
  const list = anims ?? {};
  for (const n of [playing, s.animation]) if (n && list[n]) return { name: n, anim: list[n] };
  // A moving character without its own "walk" still looks right on the default loop.
  return { name: '', anim: { from: 0, to: Math.max(1, s.frames) - 1, fps: s.fps || 8, loop: true } };
}

/** Frame index (into the whole sheet) after `t` seconds of the animation. */
export function animFrame(a: SpriteAnim, t: number): number {
  const n = Math.max(1, a.to - a.from + 1);
  const k = Math.floor(Math.max(0, t) * Math.max(0.01, a.fps));
  return a.from + (a.loop ? k % n : Math.min(n - 1, k));
}

/** Grid cell of frame `f`: columns = ceil(frames / rows). */
export function frameCell(s: Pick<SpriteData, 'frames' | 'rows'>, f: number) {
  const frames = Math.max(1, s.frames | 0), rows = Math.max(1, Math.min(frames, (s.rows ?? 1) | 0));
  const cols = Math.ceil(frames / rows);
  const i = Math.max(0, Math.min(frames - 1, f | 0));
  return { col: i % cols, row: Math.floor(i / cols), cols, rows };
}
