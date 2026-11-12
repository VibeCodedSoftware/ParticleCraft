// Canvas 2D particle painter shared by LogicCraft's stage and ParticleCraft's preview fallback: color over life,
// additive / normal / multiply / screen blending, textures, flipbooks (frame blending, custom order, sheet margins),
// stretched particles, glow halos, pixel-art filtering and motion trails. `project` maps world → screen (with a
// depth scale). Pictures are tinted by the particle colour through a small cache of coloured copies.
import { hexToRgb, type Emitter } from '../src/runtime/particles';

export type Project = (x: number, y: number, z: number) => { x: number; y: number; s: number } | null;

const pictures = new Map<string, HTMLImageElement>();
function pictureOf(url: string): HTMLImageElement | null {
  let img = pictures.get(url);
  if (!img) { img = new Image(); if (!url.startsWith('data:')) img.crossOrigin = 'anonymous'; img.src = url; pictures.set(url, img); }
  return img.complete && img.naturalWidth ? img : null;
}

/** Coloured copies of a picture (multiply tint, alpha kept), 8 levels per channel, at most 1024 px, 48 per picture. */
const tints = new Map<HTMLImageElement, Map<number, HTMLCanvasElement>>();
function tinted(img: HTMLImageElement, r: number, g: number, b: number): CanvasImageSource {
  const q = (v: number) => Math.max(0, Math.min(7, Math.round(v * 7)));
  const key = (q(r) << 6) | (q(g) << 3) | q(b);
  if (key === 511) return img; // white: the picture as it is
  let m = tints.get(img);
  if (!m) { m = new Map(); tints.set(img, m); }
  let c = m.get(key);
  if (!c) {
    const k = Math.min(1, 1024 / Math.max(img.naturalWidth, img.naturalHeight));
    c = document.createElement('canvas'); c.width = Math.max(1, Math.round(img.naturalWidth * k)); c.height = Math.max(1, Math.round(img.naturalHeight * k));
    const x = c.getContext('2d')!;
    x.drawImage(img, 0, 0, c.width, c.height);
    x.globalCompositeOperation = 'multiply';
    x.fillStyle = `rgb(${Math.round((q(r) / 7) * 255)},${Math.round((q(g) / 7) * 255)},${Math.round((q(b) / 7) * 255)})`; x.fillRect(0, 0, c.width, c.height);
    x.globalCompositeOperation = 'destination-in'; x.drawImage(img, 0, 0, c.width, c.height);
    if (m.size >= 48) m.delete(m.keys().next().value!);
    m.set(key, c);
  }
  return c;
}

export function drawEmitter2D(ctx: CanvasRenderingContext2D, e: Emitter, project: Project, ppu: number) {
  const p = e.params;
  const prevOp = ctx.globalCompositeOperation, prevSmooth = ctx.imageSmoothingEnabled;
  const mode = p.blendMode ?? (p.blending === 'additive' ? 'additive' : 'alpha');
  ctx.globalCompositeOperation = mode === 'additive' ? 'lighter' : mode === 'multiply' ? 'multiply' : mode === 'screen' ? 'screen' : 'source-over';
  ctx.imageSmoothingEnabled = !(p.style === 'pixel' || p.filter === 'nearest');
  const order = mode === 'alpha' || mode === 'premultiplied' ? sortByDepth(e) : null;
  const own = p.textureImage ? pictureOf(p.textureImage) : null;
  const fb = p.flipbook;
  const base = p.material?.baseColor ? hexToRgb(p.material.baseColor) : null, opa = p.material?.opacity ?? 1;
  const glowC = p.glowColor ? hexToRgb(p.glowColor) : null;
  for (let n = 0; n < e.count; n++) {
    const k = order ? order[n] : n;
    const s = project(e.px[k], e.py[k], e.pz[k]);
    if (!s) continue;
    let [r, g, b] = e.colorAt(k);
    if (base) { r *= base[0]; g *= base[1]; b *= base[2]; }
    const a = Math.max(0, Math.min(1, e.alphaAt(k) * opa));
    if (a <= 0.003) continue;
    const rgb = `${Math.min(255, (r * 255) | 0)},${Math.min(255, (g * 255) | 0)},${Math.min(255, (b * 255) | 0)}`;
    const rad = Math.max(0.6, e.sizeAt(k) * ppu * 0.5 * s.s);
    // Glow halo behind the particle.
    const gl = p.glow ? e.glowAt(k) : 0;
    if (gl > 0) {
      const gr = rad * (p.glowSize ?? 2.5), gc = glowC ? `${(glowC[0] * 255) | 0},${(glowC[1] * 255) | 0},${(glowC[2] * 255) | 0}` : rgb;
      const prev = ctx.globalCompositeOperation; ctx.globalCompositeOperation = 'lighter';
      const grad = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, gr);
      grad.addColorStop(0, `rgba(${gc},${Math.min(1, a * gl)})`); grad.addColorStop(1, `rgba(${gc},0)`);
      ctx.globalAlpha = 1; ctx.fillStyle = grad; ctx.beginPath(); ctx.arc(s.x, s.y, gr, 0, Math.PI * 2); ctx.fill();
      ctx.globalCompositeOperation = prev;
    }
    ctx.globalAlpha = a;
    if (p.trail > 0) {
      const t = project(e.px[k] - e.vx[k] * p.trail, e.py[k] - e.vy[k] * p.trail, e.pz[k] - e.vz[k] * p.trail);
      if (t) { ctx.strokeStyle = `rgb(${rgb})`; ctx.lineWidth = Math.max(1, rad * 0.9); ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(t.x, t.y); ctx.lineTo(s.x, s.y); ctx.stroke(); }
    }
    // Stretched along the motion (screen space).
    let angle = (e.rotAt(k) * Math.PI) / 180, sx = 1, sy = 1;
    if (p.renderer === 'stretched') {
      const q = project(e.px[k] + e.vx[k] * 0.01, e.py[k] + e.vy[k] * 0.01, e.pz[k] + e.vz[k] * 0.01);
      if (q) { const dx = q.x - s.x, dy = q.y - s.y, len = Math.hypot(dx, dy) * 100; angle = Math.atan2(dy, dx) + Math.PI / 2; sy = 1 + (len * (p.stretch ?? 0.08)) / Math.max(1, rad); }
    }
    if (own) {
      const src = tinted(own, Math.min(1, r), Math.min(1, g), Math.min(1, b));
      const SW = src === own ? own.naturalWidth : (src as HTMLCanvasElement).width, SH = src === own ? own.naturalHeight : (src as HTMLCanvasElement).height;
      ctx.save(); ctx.translate(s.x, s.y); ctx.rotate(angle); ctx.scale(sx * (p.uv?.flipX ? -1 : 1), sy * (p.uv?.flipY ? -1 : 1));
      if (fb) {
        let f = e.frameAt(k);
        if (f < 0) { ctx.restore(); continue; }
        const drawCell = (idx: number, alpha: number) => {
          const cell = fb.order?.length ? fb.order[idx % fb.order.length] : idx;
          const frames = Math.max(1, fb.frames), c = cell % frames;
          const W = SW, H = SH;
          const fw = (W * (1 - 2 * (fb.margin?.[0] ?? 0) - (fb.cols - 1) * (fb.gap?.[0] ?? 0))) / fb.cols, fh = (H * (1 - 2 * (fb.margin?.[1] ?? 0) - (fb.rows - 1) * (fb.gap?.[1] ?? 0))) / fb.rows;
          const x0 = W * (fb.margin?.[0] ?? 0) + (c % fb.cols) * (fw + W * (fb.gap?.[0] ?? 0)), y0 = H * (fb.margin?.[1] ?? 0) + Math.floor(c / fb.cols) * (fh + H * (fb.gap?.[1] ?? 0));
          ctx.globalAlpha = a * alpha;
          ctx.drawImage(src, x0, y0, fw, fh, -rad, -rad, rad * 2, rad * 2);
        };
        const w = Math.floor(f), fr = f - w;
        drawCell(w, 1);
        if (fb.blend && fr > 0.01) drawCell(w + 1, fr);
      } else ctx.drawImage(src, -rad, -rad, rad * 2, rad * 2);
      ctx.restore();
      continue;
    }
    switch (p.texture) {
      case 'smoke': case 'glow': {
        const gr = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, rad);
        gr.addColorStop(0, `rgba(${rgb},1)`); gr.addColorStop(p.texture === 'glow' ? 0.2 : 0.5, `rgba(${rgb},0.5)`); gr.addColorStop(1, `rgba(${rgb},0)`);
        ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(s.x, s.y, rad, 0, Math.PI * 2); ctx.fill(); break;
      }
      case 'square': case 'debris': case 'pixel': {
        ctx.fillStyle = `rgb(${rgb})`; ctx.save(); ctx.translate(s.x, s.y); ctx.rotate(angle); ctx.scale(sx, sy);
        if (p.texture === 'debris') { ctx.beginPath(); ctx.moveTo(-rad, -rad * 0.6); ctx.lineTo(rad * 0.8, -rad); ctx.lineTo(rad, rad * 0.7); ctx.lineTo(-rad * 0.5, rad); ctx.closePath(); ctx.fill(); }
        else ctx.fillRect(-rad, -rad, rad * 2, rad * 2);
        ctx.restore(); break;
      }
      case 'star': {
        ctx.fillStyle = `rgb(${rgb})`; ctx.save(); ctx.translate(s.x, s.y); ctx.rotate(angle); ctx.beginPath();
        for (let j = 0; j < 10; j++) { const rr = j % 2 ? rad * 0.45 : rad; const an = (j * Math.PI) / 5; ctx.lineTo(Math.cos(an) * rr, Math.sin(an) * rr); }
        ctx.closePath(); ctx.fill(); ctx.restore(); break;
      }
      case 'ring': {
        ctx.strokeStyle = `rgb(${rgb})`; ctx.lineWidth = Math.max(1, rad * 0.15); ctx.beginPath(); ctx.ellipse(s.x, s.y, rad * 0.8, rad * 0.8 * (p.renderer === 'horizontal' ? 0.35 : 1), 0, 0, Math.PI * 2); ctx.stroke(); break;
      }
      case 'spark': case 'flare': case 'drop': {
        ctx.save(); ctx.translate(s.x, s.y); ctx.rotate(angle); ctx.scale(sx, sy);
        const gr = ctx.createRadialGradient(0, 0, 0, 0, 0, rad * 1.6);
        gr.addColorStop(0, '#fff'); gr.addColorStop(0.25, `rgba(${rgb},1)`); gr.addColorStop(1, `rgba(${rgb},0)`);
        ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(0, 0, rad * 1.6, 0, Math.PI * 2); ctx.fill(); ctx.restore(); break;
      }
      default:
        ctx.fillStyle = `rgb(${rgb})`; ctx.save(); ctx.translate(s.x, s.y); ctx.rotate(angle); ctx.scale(sx, sy); ctx.beginPath(); ctx.arc(0, 0, rad, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    }
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = prevOp;
  ctx.imageSmoothingEnabled = prevSmooth;
}

/** Back-to-front order for normal blending (far particles first). */
function sortByDepth(e: Emitter): number[] {
  const idx = Array.from({ length: e.count }, (_, i) => i);
  return idx.sort((a, b) => e.pz[a] - e.pz[b]);
}
