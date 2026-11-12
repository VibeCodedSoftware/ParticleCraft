// Procedural pixel-art sprite sheets (original art drawn in code) for the starter library and 2D template.
// Every sheet is a horizontal strip of frames; animations reference frame ranges.
import * as THREE from 'three';

export interface SpriteSheet { texture: THREE.CanvasTexture; frames: number; w: number; h: number; animations: Record<string, { from: number; to: number; fps: number; loop: boolean }> }

type Painter = (g: CanvasRenderingContext2D, frame: number, px: (x: number, y: number, c: string, w?: number, h?: number) => void) => void;
const defs: Record<string, { w: number; h: number; frames: number; anims: SpriteSheet['animations']; paint: Painter }> = {
  hero: {
    w: 16, h: 16, frames: 6,
    anims: { idle: { from: 0, to: 1, fps: 2, loop: true }, walk: { from: 2, to: 4, fps: 10, loop: true }, jump: { from: 5, to: 5, fps: 1, loop: true }, fall: { from: 5, to: 5, fps: 1, loop: true } },
    paint: (_g, f, px) => {
      const bob = f === 1 ? 1 : 0;
      px(5, 1 + bob, '#2a63d8', 6, 2); // cap
      px(4, 3 + bob, '#2a63d8', 8, 1);
      px(5, 4 + bob, '#f2c29b', 6, 4); // face
      px(9, 5 + bob, '#1b1b1b'); px(7, 5 + bob, '#1b1b1b');
      px(4, 8, '#3a86ff', 8, 4); // body
      px(4, 8, '#1f4fae', 1, 4);
      const leg = f >= 2 && f <= 4 ? [[5, 6], [6, 5], [4, 7]][f - 2] : f === 5 ? [4, 8] : [5, 9];
      px(leg[0], 12, '#22324d', 2, 3); px(leg[1], 12, '#22324d', 2, 3);
      px(leg[0], 15, '#5b3a1e', 2, 1); px(leg[1], 15, '#5b3a1e', 2, 1);
      if (f === 5) { px(2, 8, '#f2c29b', 2, 2); px(12, 7, '#f2c29b', 2, 2); }
    },
  },
  slime: {
    w: 16, h: 16, frames: 2, anims: { idle: { from: 0, to: 1, fps: 3, loop: true }, walk: { from: 0, to: 1, fps: 6, loop: true } },
    paint: (_g, f, px) => {
      const s = f ? 1 : 0;
      px(3 - s, 7 + s, '#d93b3b', 10 + 2 * s, 8 - s); px(5, 5 + s, '#d93b3b', 6, 2);
      px(5, 9 + s, '#fff', 2, 2); px(9, 9 + s, '#fff', 2, 2); px(6, 10 + s, '#000'); px(10, 10 + s, '#000');
      px(4 - s, 14, '#9e1f1f', 8 + 2 * s, 1);
    },
  },
  coin: {
    w: 12, h: 12, frames: 4, anims: { spin: { from: 0, to: 3, fps: 8, loop: true }, idle: { from: 0, to: 3, fps: 8, loop: true } },
    paint: (_g, f, px) => {
      const w = [8, 6, 2, 6][f];
      px(6 - w / 2, 2, '#ffd23f', w, 8); px(6 - w / 2 + (w > 2 ? 1 : 0), 1, '#ffd23f', Math.max(1, w - 2), 10);
      if (w > 2) px(6 - w / 2 + 1, 3, '#fff2a6', 1, 4);
      px(6 - w / 2, 9, '#c9971c', w, 1);
    },
  },
  flag: {
    w: 16, h: 32, frames: 2, anims: { idle: { from: 0, to: 1, fps: 3, loop: true } },
    paint: (_g, f, px) => { px(3, 2, '#ddd', 2, 30); px(5, 3, '#3fd17a', 9, 6 - f); px(5, 9 - f, '#2a9d5a', 7 + f, 2); },
  },
  spike: { w: 16, h: 16, frames: 1, anims: { idle: { from: 0, to: 0, fps: 1, loop: true } }, paint: (_g, _f, px) => { for (let i = 0; i < 4; i++) for (let y = 0; y < 8; y++) px(i * 4 + Math.floor(y / 4), 8 + y, '#bfc6d1', 4 - Math.floor(y / 2) * 2 > 0 ? 4 - Math.floor((8 - y) / 2) : 1, 1); px(0, 15, '#6b7280', 16, 1); } },
  grass: { w: 16, h: 16, frames: 1, anims: { idle: { from: 0, to: 0, fps: 1, loop: true } }, paint: (_g, _f, px) => { px(0, 0, '#8a5a2b', 16, 16); px(0, 0, '#4caf50', 16, 4); for (let i = 0; i < 16; i += 3) px(i, 4, '#3b8f3e', 2, 1); px(3, 9, '#6e4521', 2, 2); px(11, 12, '#6e4521', 2, 2); } },
  brick: { w: 16, h: 16, frames: 1, anims: { idle: { from: 0, to: 0, fps: 1, loop: true } }, paint: (_g, _f, px) => { px(0, 0, '#b5532d', 16, 16); for (let y = 0; y < 16; y += 4) { px(0, y, '#7a3417', 16, 1); for (let x = (y / 4) % 2 ? 4 : 0; x < 16; x += 8) px(x, y, '#7a3417', 1, 4); } } },
  heart: { w: 9, h: 8, frames: 1, anims: { idle: { from: 0, to: 0, fps: 1, loop: true } }, paint: (_g, _f, px) => { px(1, 0, '#e5484d', 2, 1); px(6, 0, '#e5484d', 2, 1); px(0, 1, '#e5484d', 9, 3); px(1, 4, '#e5484d', 7, 1); px(2, 5, '#e5484d', 5, 1); px(3, 6, '#e5484d', 3, 1); px(4, 7, '#e5484d'); } },
  cloud: { w: 32, h: 16, frames: 1, anims: { idle: { from: 0, to: 0, fps: 1, loop: true } }, paint: (_g, _f, px) => { px(6, 6, '#fff', 20, 8); px(10, 2, '#fff', 8, 6); px(18, 4, '#fff', 6, 4); px(6, 13, '#dbe7f3', 20, 1); } },
  // A Smiler: wide white eyes and an impossible grin, drawn to be seen in the dark (frame 2 is a twitch).
  smiler: {
    w: 32, h: 16, frames: 2, anims: { idle: { from: 0, to: 1, fps: 2, loop: true } },
    paint: (_g, f, px) => {
      const t = f;
      px(6, 3, '#f4f4ee', 6, 4); px(20, 3 - t, '#f4f4ee', 6, 4); px(8, 4, '#111', 2, 2); px(22, 4 - t, '#111', 2, 2);
      px(3, 10, '#f4f4ee', 26, 2); px(4, 12, '#f4f4ee', 24, 1); px(6, 13, '#f4f4ee', 20, 1); px(2, 9, '#f4f4ee', 2, 1); px(28, 9, '#f4f4ee', 2, 1);
      for (let x = 5; x < 28; x += 3) px(x, 11, '#2a2a26', 1, 2);
    },
  },
  hills: { w: 64, h: 32, frames: 1, anims: { idle: { from: 0, to: 0, fps: 1, loop: true } }, paint: (g) => { g.fillStyle = '#5aa76b'; g.beginPath(); g.moveTo(0, 32); g.quadraticCurveTo(16, 4, 32, 26); g.quadraticCurveTo(48, 10, 64, 32); g.fill(); } },
};

const sheets = new Map<string, SpriteSheet>();

export function spriteSheet(name: string): SpriteSheet | null {
  const key = name.replace(/^proc:/, '');
  const hit = sheets.get(key);
  if (hit) return hit;
  const d = defs[key];
  if (!d) return null;
  const c = document.createElement('canvas');
  c.width = d.w * d.frames; c.height = d.h;
  const g = c.getContext('2d')!;
  for (let f = 0; f < d.frames; f++) {
    g.save(); g.translate(f * d.w, 0);
    const px = (x: number, y: number, col: string, w = 1, h = 1) => { g.fillStyle = col; g.fillRect(Math.round(x), Math.round(y), Math.max(1, Math.round(w)), Math.max(1, Math.round(h))); };
    d.paint(g, f, px);
    g.restore();
  }
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.colorSpace = THREE.SRGBColorSpace;
  const s = { texture: t, frames: d.frames, w: d.w, h: d.h, animations: d.anims };
  sheets.set(key, s);
  return s;
}

export const PROCEDURAL_SPRITES = Object.keys(defs);

/** Data URL thumbnail for the asset browser. */
export function spriteThumb(name: string): string | null {
  const s = spriteSheet(name);
  if (!s) return null;
  const c = document.createElement('canvas'); c.width = 64; c.height = 64;
  const g = c.getContext('2d')!; g.imageSmoothingEnabled = false;
  const img = s.texture.image as HTMLCanvasElement;
  const k = Math.min(64 / s.w, 64 / s.h);
  g.drawImage(img, 0, 0, s.w, s.h, (64 - s.w * k) / 2, (64 - s.h * k) / 2, s.w * k, s.h * k);
  return c.toDataURL();
}
