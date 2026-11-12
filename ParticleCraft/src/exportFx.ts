// Effect → pictures: runs the compiled layers on the shared engine at a fixed frame rate (from a clean start, or
// warmed up so looping effects are already full), frames the effect automatically and draws every frame on a
// transparent (or solid) background. Used for the single sprite, PNG sequence, GIF and sprite sheet exports and
// for "Send to LogicCraft".
import { Emitter, linkEmitters, type EmitterParams } from '@shared/src/runtime/particles';
import { ParticleRenderer } from './render/gl';
import { drawEmitter2D } from '@shared/ui/particles2d';
import { encodeGif } from '@shared/src/export/gif';
import { makeZip } from '@shared/src/export/zip';
import { drawShapes } from './Preview';
import type { VfxShape } from '@shared/src/vfx/shapes';

export interface RenderOpts {
  width: number; height: number; fps: number;
  /** Seconds of animation; frames [start, end) of it are kept (frame numbers, end exclusive). */
  duration: number; startFrame?: number; endFrame?: number;
  /** Looping effects start already running (no empty first frames). */
  warmUp: boolean;
  view: 'front' | '3d'; yaw?: number; pitch?: number;
  transparent: boolean; background: string;
  /** Supersampling for smoother particles (1 = off). */
  quality: 1 | 2 | 3;
  /** Shapes shown with the effect. */
  shapes?: VfxShape[];
  /** Bloom strength (0 = off). */
  bloom?: number;
}

type Layer = { name: string; params: EmitterParams };

function makeEmitters(layers: Layer[], plane: 'xy' | 'xz') {
  const es = layers.map((l, i) => { const e = new Emitter('x' + i, l.params, l.name); e.plane = plane; return e; });
  linkEmitters(es);
  return es;
}
/** One shared off-screen WebGL renderer for exports (null when WebGL2 is unavailable: the 2D painter is used). */
let exportGL: { canvas: HTMLCanvasElement; r: ParticleRenderer | null } | undefined;
function glFor(w: number, h: number) {
  if (!exportGL) { const canvas = document.createElement('canvas'); exportGL = { canvas, r: ParticleRenderer.create(canvas) }; }
  if (exportGL.canvas.width !== w || exportGL.canvas.height !== h) { exportGL.canvas.width = w; exportGL.canvas.height = h; }
  return exportGL;
}

/** Rotates a point for the 3D view (orthographic, so sizes stay constant). */
function viewOf(o: RenderOpts) {
  const yaw = o.yaw ?? 0.6, pitch = o.pitch ?? 0.3, cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  return (x: number, y: number, z: number): [number, number, number] => {
    if (o.view === 'front') return [x, y, z];
    const x1 = x * cy - z * sy, z1 = x * sy + z * cy;
    return [x1, y * cp - z1 * sp, y * sp + z1 * cp];
  };
}

export function renderFrames(layers: Layer[], o: RenderOpts): HTMLCanvasElement[] {
  const fps = Math.max(1, Math.min(60, o.fps)), dt = 1 / fps;
  const total = Math.max(1, Math.round(o.duration * fps));
  const start = Math.max(0, Math.min(total - 1, o.startFrame ?? 0)), end = Math.max(start + 1, Math.min(total, o.endFrame ?? total));
  const plane = o.view === 'front' ? 'xy' : 'xz';
  const rot = viewOf(o);
  const prewarm = (es: Emitter[]) => { if (!o.warmUp) return; const loopLen = Math.max(...layers.map((l) => (l.params.looping ? l.params.lifetime + l.params.lifetimeVar : 0)), 0); for (let t = 0; t < loopLen; t += dt) for (const e of es) e.update(dt); };
  // Pass 1: where does the effect go? Edges of the clearly visible particles over the kept frames (view space),
  // ignoring the faintest and the 1 % furthest out so a few stray particles do not shrink the effect.
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  {
    const es = makeEmitters(layers, plane); prewarm(es);
    const lx: number[] = [], hx: number[] = [], ly: number[] = [], hy: number[] = [];
    for (let f = 0; f < end; f++) {
      for (const e of es) e.update(dt);
      if (f < start) continue;
      for (const e of es) for (let i = 0; i < e.count; i++) {
        if (e.alphaAt(i) < 0.12) continue;
        const [vx, vy] = rot(e.px[i], e.py[i], e.pz[i]), r = e.sizeAt(i) * 0.35;
        lx.push(vx - r); hx.push(vx + r); ly.push(vy - r); hy.push(vy + r);
      }
    }
    if (lx.length) {
      const q = (a: number[], f: number) => { a.sort((m, n) => m - n); return a[Math.min(a.length - 1, Math.max(0, Math.floor(a.length * f)))]; };
      x0 = q(lx, 0.01); x1 = q(hx, 0.99); y0 = q(ly, 0.01); y1 = q(hy, 0.99);
    }
    for (const s of o.shapes ?? []) { x0 = Math.min(x0, s.position[0] - s.scale); x1 = Math.max(x1, s.position[0] + s.scale); y0 = Math.min(y0, s.position[1] - s.scale); y1 = Math.max(y1, s.position[1] + s.scale); }
    if (x0 === Infinity) { x0 = -1; x1 = 1; y0 = -1; y1 = 1; }
  }
  const q = o.quality, W = o.width * q, H = o.height * q;
  const bw = Math.max(0.01, x1 - x0), bh = Math.max(0.01, y1 - y0);
  const ppu = Math.min((W * 0.9) / bw, (H * 0.9) / bh), cx = (x0 + x1) / 2, cyy = (y0 + y1) / 2;
  const project = (x: number, y: number, z: number) => { const [vx, vy] = rot(x, y, z); return { x: W / 2 + (vx - cx) * ppu, y: H / 2 - (vy - cyy) * ppu, s: 1 }; };
  // Pass 2: draw (same seeds, so the same particles).
  const es = makeEmitters(layers, plane); prewarm(es);
  const out: HTMLCanvasElement[] = [];
  const big = document.createElement('canvas'); big.width = W; big.height = H;
  const g = big.getContext('2d')!;
  // The same WebGL renderer as the preview (flipbooks, styles, blend modes, glow, distortion), over a background
  // layer with the shown shapes; the 2D painter when WebGL2 is unavailable.
  const gl = glFor(W, H);
  const yaw = o.view === 'front' ? 0 : o.yaw ?? 0.6, pitch = o.view === 'front' ? 0 : o.pitch ?? 0.3;
  const cam = { persp: false, yaw, pitch, dist: 10, target: [0, 0, 0] as [number, number, number], f: 1, ppu, viewC: [cx, cyy] as [number, number], anchor: [W / 2, H / 2] as [number, number], width: W, height: H };
  for (let f = 0; f < end; f++) {
    for (const e of es) e.update(dt);
    if (f < start) continue;
    g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
    g.clearRect(0, 0, W, H);
    if (!o.transparent) { g.fillStyle = o.background; g.fillRect(0, 0, W, H); }
    if (o.shapes?.length) drawShapes(g, o.shapes.map((shape) => ({ shape, ghost: false })), { ppu, project });
    if (gl.r) {
      gl.r.render(es, cam, { background: big, clear: [0, 0, 0, 0], bloom: o.bloom ?? 0, time: f * dt });
      g.clearRect(0, 0, W, H); g.drawImage(gl.canvas, 0, 0);
    } else for (const e of es) drawEmitter2D(g, e, project, ppu);
    const c = document.createElement('canvas'); c.width = o.width; c.height = o.height;
    const cc = c.getContext('2d')!; cc.imageSmoothingQuality = 'high'; cc.drawImage(big, 0, 0, o.width, o.height);
    out.push(c);
  }
  return out;
}

const blobOf = (c: HTMLCanvasElement, type = 'image/png', quality?: number) => new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('could not encode the picture'))), type, quality));
export const bytesOf = async (c: HTMLCanvasElement, type = 'image/png', quality = 0.92) => new Uint8Array(await (await blobOf(c, type, quality)).arrayBuffer());

export async function pngSequenceZip(frames: HTMLCanvasElement[], base: string, jpg = false): Promise<Uint8Array> {
  const files: { name: string; data: Uint8Array }[] = [];
  for (let k = 0; k < frames.length; k++) files.push({ name: `${base}_${String(k + 1).padStart(4, '0')}.${jpg ? 'jpg' : 'png'}`, data: await bytesOf(frames[k], jpg ? 'image/jpeg' : 'image/png') });
  return makeZip(files);
}

export function gifOf(frames: HTMLCanvasElement[], fps: number, loop: boolean, transparent: boolean, background: string, colors: number): Uint8Array {
  const w = frames[0].width, h = frames[0].height;
  const bg = parseInt(background.replace('#', ''), 16);
  return encodeGif(frames.map((c) => ({ rgba: c.getContext('2d')!.getImageData(0, 0, w, h).data, delayMs: 1000 / fps })), { width: w, height: h, loop, transparent, background: [(bg >> 16) & 255, (bg >> 8) & 255, bg & 255], colors });
}

/** Frames in a grid (columns × rows, reading order), with padding between cells. */
export function spriteSheet(frames: HTMLCanvasElement[], cols: number, rows: number, padding: number): HTMLCanvasElement {
  const w = frames[0].width, h = frames[0].height;
  const c = document.createElement('canvas'); c.width = cols * w + (cols - 1) * padding; c.height = rows * h + (rows - 1) * padding;
  const g = c.getContext('2d')!;
  frames.slice(0, cols * rows).forEach((f, k) => g.drawImage(f, (k % cols) * (w + padding), Math.floor(k / cols) * (h + padding)));
  return c;
}

// ------------------------------------------------------------------ animated WebP
/** RIFF chunks of a still WebP. */
function chunks(b: Uint8Array): { id: string; data: Uint8Array }[] {
  const out: { id: string; data: Uint8Array }[] = [];
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  for (let o = 12; o + 8 <= b.length;) {
    const id = String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]), len = dv.getUint32(o + 4, true);
    out.push({ id, data: b.subarray(o + 8, o + 8 + len) });
    o += 8 + len + (len & 1);
  }
  return out;
}
function chunk(id: string, data: Uint8Array): Uint8Array {
  const pad = data.length & 1, c = new Uint8Array(8 + data.length + pad);
  for (let i = 0; i < 4; i++) c[i] = id.charCodeAt(i);
  new DataView(c.buffer).setUint32(4, data.length, true);
  c.set(data, 8);
  return c;
}
const u24 = (v: number) => [v & 255, (v >> 8) & 255, (v >> 16) & 255];
const concat = (parts: Uint8Array[]) => { const n = parts.reduce((a, p) => a + p.length, 0), o = new Uint8Array(n); let k = 0; for (const p of parts) { o.set(p, k); k += p.length; } return o; };

/** Animated WebP (with transparency): the browser encodes each frame as a still WebP; they are wrapped in ANMF chunks. */
export async function animatedWebp(frames: HTMLCanvasElement[], fps: number, loop: boolean, quality = 0.9): Promise<Uint8Array> {
  const w = frames[0].width, h = frames[0].height, dur = Math.max(1, Math.round(1000 / fps));
  const anmf: Uint8Array[] = [];
  for (const f of frames) {
    const still = await bytesOf(f, 'image/webp', quality);
    if (String.fromCharCode(...still.subarray(8, 12)) !== 'WEBP') throw new Error('This system cannot encode WebP pictures');
    const body = chunks(still).filter((c) => c.id === 'ALPH' || c.id === 'VP8 ' || c.id === 'VP8L').map((c) => chunk(c.id, c.data));
    // x/2, y/2, width-1, height-1, duration, flags (no blending: each frame replaces the canvas)
    anmf.push(chunk('ANMF', concat([new Uint8Array([...u24(0), ...u24(0), ...u24(w - 1), ...u24(h - 1), ...u24(dur), 0b10]), ...body])));
  }
  const vp8x = chunk('VP8X', new Uint8Array([0x12, 0, 0, 0, ...u24(w - 1), ...u24(h - 1)])); // animation + alpha
  const anim = chunk('ANIM', new Uint8Array([0, 0, 0, 0, loop ? 0 : 1, 0])); // transparent background, loop count
  const body = concat([new TextEncoder().encode('WEBP'), vp8x, anim, ...anmf]);
  const head = new Uint8Array(8); head.set(new TextEncoder().encode('RIFF')); new DataView(head.buffer).setUint32(4, body.length, true);
  return concat([head, body]);
}

/** WebM video (VP9, or VP8) recorded from the frames at the given rate. Plays back in real time while recording. */
export async function webmVideo(frames: HTMLCanvasElement[], fps: number): Promise<Blob> {
  const c = document.createElement('canvas'); c.width = frames[0].width; c.height = frames[0].height;
  const g = c.getContext('2d')!;
  const stream = (c as any).captureStream(0) as MediaStream;
  const track = stream.getVideoTracks()[0] as any;
  const type = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((t) => (window as any).MediaRecorder?.isTypeSupported?.(t));
  if (!type) throw new Error('This system cannot record WebM video');
  const rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 6_000_000 });
  const parts: Blob[] = [];
  rec.ondataavailable = (e) => { if (e.data.size) parts.push(e.data); };
  const done = new Promise<void>((res) => { rec.onstop = () => res(); });
  rec.start();
  for (const f of frames) {
    g.clearRect(0, 0, c.width, c.height); g.drawImage(f, 0, 0);
    track.requestFrame?.();
    await new Promise((r) => setTimeout(r, 1000 / fps));
  }
  rec.stop();
  await done;
  return new Blob(parts, { type: 'video/webm' });
}

/** Sprite sheet + JSON description ("array" frames, as SpriteCraft, Aseprite and most engines read), zipped. */
export async function sheetWithJson(frames: HTMLCanvasElement[], cols: number, rows: number, padding: number, fps: number, base: string, tags: { name: string; from: number; to: number }[] = []): Promise<Uint8Array> {
  const sheet = spriteSheet(frames, cols, rows, padding);
  const w = frames[0].width, h = frames[0].height, n = Math.min(frames.length, cols * rows);
  const json = {
    frames: Array.from({ length: n }, (_, i) => ({ filename: `${base} ${i}`, frame: { x: (i % cols) * (w + padding), y: Math.floor(i / cols) * (h + padding), w, h }, rotated: false, trimmed: false, spriteSourceSize: { x: 0, y: 0, w, h }, sourceSize: { w, h }, duration: Math.round(1000 / fps) })),
    meta: { app: 'ParticleCraft', version: '2.0', image: `${base}.png`, format: 'RGBA8888', size: { w: sheet.width, h: sheet.height }, scale: '1', frameTags: tags.length ? tags : [{ name: base, from: 0, to: n - 1, direction: 'forward' }] },
  };
  return makeZip([{ name: `${base}.png`, data: await bytesOf(sheet) }, { name: `${base}.json`, data: new TextEncoder().encode(JSON.stringify(json, null, 1)) }]);
}

export function download(data: Blob | Uint8Array, name: string, type = 'application/octet-stream') {
  const blob = data instanceof Blob ? data : new Blob([data as BlobPart], { type });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 3000);
}
