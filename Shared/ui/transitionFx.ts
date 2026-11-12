// Screen transitions drawn over the game (both apps): wipe, curtain, blinds; shapes closing on the middle (circle,
// diamond, star, heart, or your own picture: its opaque part is the hole); dissolve and your own fade map (a greyscale
// picture: dark parts cover first, light parts last). The cover is a colour or your own picture. Fade stays a plain
// see-through layer (drawn by the overlay).
import type { TransitionStyle } from '../src/runtime/story';

export interface TransitionDraw { style: TransitionStyle; color: string; shape?: string | null; cover?: string | null }

const images = new Map<string, HTMLImageElement>();
/** A picture by URL, loading in the background (null until it has loaded). */
function image(url: string | null | undefined): HTMLImageElement | null {
  if (!url) return null;
  let im = images.get(url);
  if (!im) { im = new Image(); im.crossOrigin = 'anonymous'; im.src = url; images.set(url, im); }
  return im.complete && im.naturalWidth ? im : null;
}

/** Built-in shapes as white silhouettes on a transparent square. */
const shapes = new Map<string, HTMLCanvasElement>();
function builtinShape(name: 'circle' | 'diamond' | 'star' | 'heart'): HTMLCanvasElement {
  let c = shapes.get(name);
  if (c) return c;
  c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d')!; g.fillStyle = '#fff'; g.beginPath();
  if (name === 'circle') g.arc(128, 128, 128, 0, Math.PI * 2);
  else if (name === 'diamond') { g.moveTo(128, 0); g.lineTo(256, 128); g.lineTo(128, 256); g.lineTo(0, 128); }
  else if (name === 'star') for (let k = 0; k < 10; k++) { const r = k % 2 ? 52 : 128, a = -Math.PI / 2 + (k * Math.PI) / 5; const x = 128 + Math.cos(a) * r, y = 136 + Math.sin(a) * r; if (k) g.lineTo(x, y); else g.moveTo(x, y); }
  else { g.moveTo(128, 236); g.bezierCurveTo(-30, 130, 30, -20, 128, 62); g.bezierCurveTo(226, -20, 286, 130, 128, 236); }
  g.closePath(); g.fill();
  shapes.set(name, c);
  return c;
}

/** Brightness per pixel of a fade map at the canvas size (cached per picture and size). */
const maps = new Map<string, Float32Array>();
function lumaOf(key: string, w: number, h: number, draw: (g: CanvasRenderingContext2D) => boolean): Float32Array | null {
  const k = `${key}|${w}x${h}`;
  const hit = maps.get(k); if (hit) return hit;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  if (!draw(g)) return null;
  const d = g.getImageData(0, 0, w, h).data, out = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) out[i] = (0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2]) / 255;
  if (maps.size > 12) maps.delete(maps.keys().next().value!);
  maps.set(k, out);
  return out;
}

/** The cover (colour, or the cover picture filling the screen) drawn into `g`. */
function paintCover(g: CanvasRenderingContext2D, w: number, h: number, t: TransitionDraw) {
  g.globalCompositeOperation = 'source-over';
  g.fillStyle = t.color; g.fillRect(0, 0, w, h);
  const im = image(t.cover);
  if (im) { const s = Math.max(w / im.naturalWidth, h / im.naturalHeight); g.drawImage(im, (w - im.naturalWidth * s) / 2, (h - im.naturalHeight * s) / 2, im.naturalWidth * s, im.naturalHeight * s); }
}

/** Draw coverage `a` (0 clear … 1 covered) of a transition into `canvas` (sized to the view, half resolution). */
export function drawTransition(canvas: HTMLCanvasElement, a: number, t: TransitionDraw) {
  const host = canvas.parentElement, W = Math.max(2, Math.round((host?.clientWidth ?? 640) / 2)), H = Math.max(2, Math.round((host?.clientHeight ?? 360) / 2));
  if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
  const g = canvas.getContext('2d', { willReadFrequently: t.style === 'dissolve' || t.style === 'map' })!;
  g.clearRect(0, 0, W, H);
  if (a <= 0) return;
  const s = t.style;
  if (s === 'wipe' || s === 'curtain' || s === 'blinds') {
    paintCover(g, W, H, t);
    g.globalCompositeOperation = 'destination-in'; g.fillStyle = '#000'; g.beginPath();
    if (s === 'wipe') g.rect(0, 0, W * a, H);
    else if (s === 'curtain') g.rect(0, 0, W, H * a);
    else { const n = 8, bh = H / n; for (let k = 0; k < n; k++) g.rect(0, k * bh, W, bh * a); }
    g.fill(); g.globalCompositeOperation = 'source-over';
    return;
  }
  if (s === 'iris' || s === 'diamond' || s === 'star' || s === 'heart' || s === 'shape') {
    // Covered, with a hole in the shape that shrinks to nothing on the middle.
    paintCover(g, W, H, t);
    const sh: CanvasImageSource | null = s === 'shape' ? image(t.shape) : builtinShape(s === 'iris' ? 'circle' : s);
    if (sh && a < 1) {
      const diag = Math.hypot(W, H), size = (1 - a) * diag * (s === 'star' ? 2.4 : s === 'heart' ? 1.9 : 1.5);
      const iw = (sh as any).naturalWidth ?? (sh as HTMLCanvasElement).width, ih = (sh as any).naturalHeight ?? (sh as HTMLCanvasElement).height;
      const k = size / Math.max(iw, ih);
      g.globalCompositeOperation = 'destination-out';
      g.drawImage(sh, W / 2 - (iw * k) / 2, H / 2 - (ih * k) / 2, iw * k, ih * k);
      g.globalCompositeOperation = 'source-over';
    }
    return;
  }
  // Dissolve / fade map: pixels darker than the coverage are covered (soft edge).
  const luma = s === 'map'
    ? lumaOf('map:' + t.shape, W, H, (gg) => { const im = image(t.shape); if (!im) return false; gg.drawImage(im, 0, 0, W, H); return true; })
    : lumaOf('dissolve', W, H, (gg) => {
      // Blocky noise, so the dissolve reads as chunks rather than grain.
      const cell = Math.max(2, Math.round(W / 60)); let seed = 1;
      const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
      for (let y = 0; y < H; y += cell) for (let x = 0; x < W; x += cell) { const v = Math.floor(rnd() * 255); gg.fillStyle = `rgb(${v},${v},${v})`; gg.fillRect(x, y, cell, cell); }
      return true;
    });
  paintCover(g, W, H, t);
  if (!luma) { g.globalAlpha = 1; return; } // map still loading: plain cover
  const img = g.getImageData(0, 0, W, H), d = img.data, soft = 0.06, edge = a * (1 + soft);
  for (let i = 0; i < W * H; i++) {
    const v = (edge - luma[i]) / soft;
    d[i * 4 + 3] = v >= 1 ? 255 : v <= 0 ? 0 : Math.round(v * 255);
  }
  g.putImageData(img, 0, 0);
}
