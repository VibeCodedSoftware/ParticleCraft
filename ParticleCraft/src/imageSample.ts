// "Spawn from image / texture": samples a picture (or one frame of a sprite sheet) into emitter points with colours.
// Points lie in the XY plane, centred, `width` metres wide; each keeps its pixel's colour.
import { resolveTexture } from '@shared/src/vfx/vfx';

export interface ImageSampleOpts { use: 'alpha' | 'brightness'; threshold: number; width: number; cols: number; rows: number; frame: number; max?: number }

export async function loadImage(url: string): Promise<HTMLImageElement> {
  const img = new Image();
  if (!url.startsWith('data:') && !url.startsWith('blob:')) img.crossOrigin = 'anonymous';
  img.src = url;
  await img.decode();
  return img;
}

export async function sampleImagePoints(ref: string, o: ImageSampleOpts): Promise<{ pts: number[]; cols: number[] }> {
  const url = resolveTexture(ref);
  if (!url) return { pts: [], cols: [] };
  const img = await loadImage(url);
  const cols = Math.max(1, Math.round(o.cols)), rows = Math.max(1, Math.round(o.rows));
  const fw = Math.floor(img.naturalWidth / cols), fh = Math.floor(img.naturalHeight / rows);
  const f = Math.max(0, Math.min(cols * rows - 1, Math.round(o.frame)));
  const sx = (f % cols) * fw, sy = Math.floor(f / cols) * fh;
  // Work on at most 160 px across.
  const k = Math.min(1, 160 / Math.max(fw, fh));
  const w = Math.max(1, Math.round(fw * k)), h = Math.max(1, Math.round(fh * k));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(img, sx, sy, fw, fh, 0, 0, w, h);
  const d = g.getImageData(0, 0, w, h).data;
  const cand: number[] = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    const v = o.use === 'alpha' ? d[i + 3] / 255 : ((d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) / 255) * (d[i + 3] / 255);
    if (v >= o.threshold) cand.push(x, y, i);
  }
  const max = o.max ?? 2048, n = cand.length / 3, step = Math.max(1, n / max);
  const scale = o.width / w;
  const pts: number[] = [], colors: number[] = [];
  for (let q = 0; q < n && pts.length / 6 < max; q += step) {
    const j = Math.floor(q) * 3, x = cand[j], y = cand[j + 1], i = cand[j + 2];
    pts.push(Math.round((x - w / 2) * scale * 1e4) / 1e4, Math.round((h / 2 - y) * scale * 1e4) / 1e4, 0, 0, 0, 1);
    colors.push(Math.round((d[i] / 255) * 1000) / 1000, Math.round((d[i + 1] / 255) * 1000) / 1000, Math.round((d[i + 2] / 255) * 1000) / 1000);
  }
  return { pts, cols: colors };
}
