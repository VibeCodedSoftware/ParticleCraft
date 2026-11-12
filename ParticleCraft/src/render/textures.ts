// Built-in particle pictures (white on transparent, tinted by the particle colour). Drawn procedurally once; smoke uses
// fractal noise so it reads as a real puff rather than a flat gradient.
import { fbm3, turbulence3 } from '@shared/src/runtime/noise';

const cache = new Map<string, HTMLCanvasElement>();

export const BUILTIN_TEXTURES = ['circle', 'square', 'spark', 'smoke', 'star', 'debris', 'ring', 'glow', 'pixel', 'flare', 'drop', 'leaf'] as const;

export function builtinTexture(kind: string): HTMLCanvasElement {
  let c = cache.get(kind);
  if (c) return c;
  const S = kind === 'pixel' ? 8 : 128;
  c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d')!;
  const h = S / 2;
  const radial = (stops: [number, number][]) => { const r = g.createRadialGradient(h, h, 0, h, h, h); stops.forEach(([o, a]) => r.addColorStop(o, `rgba(255,255,255,${a})`)); g.fillStyle = r; g.fillRect(0, 0, S, S); };
  switch (kind) {
    case 'square': g.fillStyle = '#fff'; g.fillRect(S * 0.12, S * 0.12, S * 0.76, S * 0.76); break;
    case 'pixel': g.fillStyle = '#fff'; g.fillRect(1, 1, 6, 6); break;
    case 'debris': g.fillStyle = '#fff'; g.beginPath(); g.moveTo(S * 0.16, S * 0.12); g.lineTo(S * 0.88, S * 0.28); g.lineTo(S * 0.7, S * 0.88); g.lineTo(S * 0.1, S * 0.7); g.closePath(); g.fill(); break;
    case 'spark': radial([[0, 1], [0.15, 0.95], [0.35, 0.35], [1, 0]]); g.fillStyle = '#fff'; g.fillRect(h - 1.5, S * 0.06, 3, S * 0.88); g.fillRect(S * 0.06, h - 1.5, S * 0.88, 3); break;
    case 'star': g.fillStyle = '#fff'; g.beginPath(); for (let i = 0; i < 10; i++) { const r = i % 2 ? S * 0.17 : S * 0.47, a = (i * Math.PI) / 5 - Math.PI / 2; g.lineTo(h + Math.cos(a) * r, h + Math.sin(a) * r); } g.fill(); break;
    case 'ring': { g.strokeStyle = '#fff'; g.lineWidth = S * 0.08; g.shadowColor = '#fff'; g.shadowBlur = S * 0.08; g.beginPath(); g.arc(h, h, S * 0.38, 0, Math.PI * 2); g.stroke(); break; }
    case 'glow': radial([[0, 1], [0.2, 0.55], [0.5, 0.15], [1, 0]]); break;
    case 'flare': { radial([[0, 1], [0.1, 0.7], [0.4, 0.12], [1, 0]]); const lg = g.createLinearGradient(0, 0, S, 0); lg.addColorStop(0, 'rgba(255,255,255,0)'); lg.addColorStop(0.5, 'rgba(255,255,255,0.9)'); lg.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = lg; g.fillRect(0, h - 1.5, S, 3); break; }
    case 'drop': { g.fillStyle = '#fff'; g.beginPath(); g.moveTo(h, S * 0.08); g.bezierCurveTo(h + S * 0.28, S * 0.45, h + S * 0.3, S * 0.9, h, S * 0.9); g.bezierCurveTo(h - S * 0.3, S * 0.9, h - S * 0.28, S * 0.45, h, S * 0.08); g.fill(); break; }
    case 'leaf': { g.fillStyle = '#fff'; g.beginPath(); g.moveTo(h, S * 0.06); g.quadraticCurveTo(S * 0.95, h, h, S * 0.94); g.quadraticCurveTo(S * 0.05, h, h, S * 0.06); g.fill(); break; }
    case 'smoke': {
      const img = g.createImageData(S, S);
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const u = x / S - 0.5, v = y / S - 0.5, r = Math.hypot(u, v) * 2;
        const n = 0.55 + 0.45 * fbm3(u * 4, v * 4, 1.7, 4) + 0.25 * (turbulence3(u * 7, v * 7, 3.1, 3) - 0.4);
        const fall = Math.max(0, 1 - r); const a = Math.max(0, Math.min(1, fall * fall * (3 - 2 * fall) * n * 1.35));
        const o = (y * S + x) * 4; img.data[o] = img.data[o + 1] = img.data[o + 2] = 255; img.data[o + 3] = a * 255;
      }
      g.putImageData(img, 0, 0); break;
    }
    default: radial([[0, 1], [0.6, 0.6], [1, 0]]);
  }
  cache.set(kind, c);
  return c;
}

/** Decoded pictures by URL (data URLs, library assets); `onload` lets renderers refresh when one arrives. */
const images = new Map<string, HTMLImageElement>();
export function pictureOf(url: string, onload?: () => void): HTMLImageElement | null {
  let img = images.get(url);
  if (!img) { img = new Image(); if (!url.startsWith('data:') && !url.startsWith('blob:')) img.crossOrigin = 'anonymous'; img.decoding = 'async'; img.onload = () => onload?.(); img.src = url; images.set(url, img); if (images.size > 256) images.delete(images.keys().next().value!); }
  return img.complete && img.naturalWidth ? img : null;
}

/** A 256×1 strip of a gradient (for gradient maps). */
export function gradientStrip(stops: { t: number; c: string; a?: number }[]): HTMLCanvasElement {
  const key = 'grad:' + JSON.stringify(stops);
  let c = cache.get(key);
  if (c) return c;
  c = document.createElement('canvas'); c.width = 256; c.height = 1;
  const g = c.getContext('2d')!;
  const lg = g.createLinearGradient(0, 0, 256, 0);
  for (const s of stops) { const h = s.c.replace('#', ''); const n = parseInt(h.padEnd(6, '0').slice(0, 6), 16); lg.addColorStop(Math.max(0, Math.min(1, s.t)), `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${s.a ?? 1})`); }
  g.fillStyle = lg; g.fillRect(0, 0, 256, 1);
  if (cache.size > 512) cache.clear();
  cache.set(key, c);
  return c;
}
