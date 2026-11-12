// Texture node graph: node types and their (CPU, deterministic) evaluation. Every node outputs a picture (RGBA,
// straight alpha, 0..1 floats); system blocks use a node's output as `node:<id>`. Generators take a size and a time
// (so a Texture sequence node can bake an animated generator into a flipbook sheet).
import type { PropDef } from '@shared/src/vfx/vfx';
import { fbm3, perlin3, turbulence3, voronoi2 } from '@shared/src/runtime/noise';
import { evalGradient, hexToRgb, type GradientStop } from '@shared/src/runtime/particles';

export interface Img { w: number; h: number; d: Float32Array; sheet?: { cols: number; rows: number; frames: number } }
export interface EvalCtx { p: Record<string, any>; input: (name: string) => Img | null; time: number; picture: (ref: string) => Img | null }
export interface TexNodeType { type: string; name: string; category: string; doc: string; inputs: string[]; props: PropDef[]; animated?: boolean; eval: (c: EvalCtx) => Img | null }

const n = (key: string, label: string, def: number, min?: number, max?: number, step?: number): PropDef => ({ key, label, type: 'number', default: def, min, max, step });
const ch = (key: string, label: string, def: string, options: string[]): PropDef => ({ key, label, type: 'choice', default: def, options });
const col = (key: string, label: string, def: string): PropDef => ({ key, label, type: 'color', default: def });
const bool = (key: string, label: string, def: boolean): PropDef => ({ key, label, type: 'bool', default: def });
const grd = (key: string, label: string, stops: GradientStop[]): PropDef => ({ key, label, type: 'gradient', default: stops });
const SIZE = n('size', 'Size (px)', 256, 16, 1024, 16);
const SEED = n('seed', 'Seed', 1, 0, 9999, 1);
const EVOLVE = n('evolve', 'Evolve (animation speed)', 1, 0, 20, 0.05);

export const img = (w: number, h: number): Img => ({ w, h, d: new Float32Array(w * h * 4) });
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
/** Fill from a per-pixel function of uv (0..1, v down) returning [r, g, b, a]. */
function gen(w: number, h: number, f: (u: number, v: number, x: number, y: number) => [number, number, number, number] | number): Img {
  const o = img(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const r = f((x + 0.5) / w, (y + 0.5) / h, x, y), i = (y * w + x) * 4;
    if (typeof r === 'number') { o.d[i] = o.d[i + 1] = o.d[i + 2] = 1; o.d[i + 3] = clamp01(r); }
    else { o.d[i] = r[0]; o.d[i + 1] = r[1]; o.d[i + 2] = r[2]; o.d[i + 3] = r[3]; }
  }
  return o;
}
/** Bilinear sample (wrap or clamp). */
export function sample(s: Img, u: number, v: number, wrap = false, out: number[] = [0, 0, 0, 0]): number[] {
  let x = u * s.w - 0.5, y = v * s.h - 0.5;
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
  const px = (xx: number, yy: number, k: number) => {
    if (wrap) { xx = ((xx % s.w) + s.w) % s.w; yy = ((yy % s.h) + s.h) % s.h; } else { xx = xx < 0 ? 0 : xx >= s.w ? s.w - 1 : xx; yy = yy < 0 ? 0 : yy >= s.h ? s.h - 1 : yy; }
    return s.d[(yy * s.w + xx) * 4 + k];
  };
  for (let k = 0; k < 4; k++) out[k] = (px(x0, y0, k) * (1 - fx) + px(x0 + 1, y0, k) * fx) * (1 - fy) + (px(x0, y0 + 1, k) * (1 - fx) + px(x0 + 1, y0 + 1, k) * fx) * fy;
  return out;
}
/** Map over pixels of an input. */
function map(s: Img, f: (r: number, g: number, b: number, a: number, u: number, v: number) => [number, number, number, number]): Img {
  const o = img(s.w, s.h);
  for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) {
    const i = (y * s.w + x) * 4, r = f(s.d[i], s.d[i + 1], s.d[i + 2], s.d[i + 3], (x + 0.5) / s.w, (y + 0.5) / s.h);
    o.d[i] = r[0]; o.d[i + 1] = r[1]; o.d[i + 2] = r[2]; o.d[i + 3] = r[3];
  }
  o.sheet = s.sheet;
  return o;
}
/** Warp: each output pixel samples the input at f(u, v). */
function warp(s: Img, f: (u: number, v: number) => [number, number], wrap = false): Img {
  const o = img(s.w, s.h), t = [0, 0, 0, 0];
  for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) {
    const [u, v] = f((x + 0.5) / s.w, (y + 0.5) / s.h);
    sample(s, u, v, wrap, t);
    o.d.set(t, (y * s.w + x) * 4);
  }
  return o;
}
const lum = (r: number, g: number, b: number) => r * 0.299 + g * 0.587 + b * 0.114;
/** Separable box blur ×3 ≈ Gaussian, on premultiplied colour so edges don't darken. */
export function blur(s: Img, radius: number, wrap = false): Img {
  const r = Math.max(0, Math.round(radius));
  if (!r) return s;
  let a = new Float32Array(s.d.length), b = new Float32Array(s.d.length);
  for (let i = 0; i < s.d.length; i += 4) { const al = s.d[i + 3]; a[i] = s.d[i] * al; a[i + 1] = s.d[i + 1] * al; a[i + 2] = s.d[i + 2] * al; a[i + 3] = al; }
  const W = s.w, H = s.h;
  const pass = (src: Float32Array, dst: Float32Array, horiz: boolean) => {
    const len = horiz ? W : H, lines = horiz ? H : W, win = r * 2 + 1;
    for (let l = 0; l < lines; l++) for (let k = 0; k < 4; k++) {
      let sum = 0;
      const at = (p: number) => { let q = wrap ? ((p % len) + len) % len : p < 0 ? 0 : p >= len ? len - 1 : p; return horiz ? (l * W + q) * 4 + k : (q * W + l) * 4 + k; };
      for (let p = -r; p <= r; p++) sum += src[at(p)];
      for (let p = 0; p < len; p++) { dst[at(p)] = sum / win; sum += src[at(p + r + 1)] - src[at(p - r)]; }
    }
  };
  for (let it = 0; it < 3; it++) { pass(a, b, true); pass(b, a, false); }
  const o = img(W, H);
  for (let i = 0; i < a.length; i += 4) { const al = a[i + 3]; o.d[i] = al > 1e-5 ? a[i] / al : 0; o.d[i + 1] = al > 1e-5 ? a[i + 1] / al : 0; o.d[i + 2] = al > 1e-5 ? a[i + 2] / al : 0; o.d[i + 3] = al; }
  o.sheet = s.sheet;
  return o;
}
function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn, s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  const h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
}
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (!s) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = (t: number) => { t = ((t % 1) + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 0.5 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
  return [f(h + 1 / 3), f(h), f(h - 1 / 3)];
}
const sizeOf = (c: EvalCtx) => Math.max(16, Math.min(1024, Math.round(c.p.size ?? 256)));
const tileFreq = (c: EvalCtx) => Math.max(1, Math.round(c.p.scale ?? 4));

/** Perlin noise that tiles over `per` cells (blend of 4 offset copies). */
function tiled(f: (x: number, y: number) => number, u: number, v: number, per: number, tile: boolean) {
  if (!tile) return f(u * per, v * per);
  const x = u * per, y = v * per;
  const a = f(x, y), b = f(x - per, y), c = f(x, y - per), d = f(x - per, y - per);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

export const TEX_NODE_TYPES: TexNodeType[] = [
  // ---------------------------------------------------------------- inputs
  { type: 'textureInput', name: 'Texture input', category: 'Inputs', doc: 'A picture from the texture library (or imported here).', inputs: [], props: [{ key: 'texture', label: 'Picture', type: 'texture', default: '' }], eval: (c) => (c.p.texture ? c.picture(c.p.texture) : null) },
  { type: 'solid', name: 'Solid colour', category: 'Inputs', doc: 'One colour and opacity.', inputs: [], props: [SIZE, col('color', 'Colour', '#ffffff'), n('alpha', 'Opacity', 1, 0, 1, 0.01)], eval: (c) => { const [r, g, b] = hexToRgb(c.p.color); return gen(64, 64, () => [r, g, b, c.p.alpha]); } },
  // ---------------------------------------------------------------- procedural
  { type: 'perlin', name: 'Perlin noise', category: 'Procedural', doc: 'Smooth gradient noise (white with the noise as opacity, or as grey).', inputs: [], animated: true, props: [SIZE, n('scale', 'Scale (cells)', 4, 1, 64, 1), bool('tile', 'Tileable', true), ch('out', 'Output', 'grey', ['grey', 'alpha']), SEED, EVOLVE],
    eval: (c) => { const s = sizeOf(c), per = tileFreq(c), z = c.time * c.p.evolve * 0.5; return gen(s, s, (u, v) => { const x = clamp01(0.5 + 0.5 * tiled((a, b) => perlin3(a, b, z, c.p.seed), u, v, per, c.p.tile)); return c.p.out === 'alpha' ? x : [x, x, x, 1]; }); } },
  { type: 'fractal', name: 'Fractal noise', category: 'Procedural', doc: 'fBm: several octaves of Perlin noise (smoke, clouds, dirt).', inputs: [], animated: true, props: [SIZE, n('scale', 'Scale (cells)', 3, 1, 64, 1), n('octaves', 'Octaves', 5, 1, 8, 1), n('gain', 'Roughness', 0.5, 0.1, 0.9, 0.05), bool('tile', 'Tileable', true), ch('out', 'Output', 'grey', ['grey', 'alpha']), SEED, EVOLVE],
    eval: (c) => { const s = sizeOf(c), per = tileFreq(c), z = c.time * c.p.evolve * 0.5; return gen(s, s, (u, v) => { const x = clamp01(0.5 + 0.7 * tiled((a, b) => fbm3(a, b, z, c.p.octaves, 2, c.p.gain, c.p.seed), u, v, per, c.p.tile)); return c.p.out === 'alpha' ? x : [x, x, x, 1]; }); } },
  { type: 'turbulence', name: 'Turbulence', category: 'Procedural', doc: 'Billowy |noise| sum: fire tongues, thick smoke, energy.', inputs: [], animated: true, props: [SIZE, n('scale', 'Scale (cells)', 3, 1, 64, 1), n('octaves', 'Octaves', 5, 1, 8, 1), bool('tile', 'Tileable', true), ch('out', 'Output', 'grey', ['grey', 'alpha']), SEED, EVOLVE],
    eval: (c) => { const s = sizeOf(c), per = tileFreq(c), z = c.time * c.p.evolve * 0.5; return gen(s, s, (u, v) => { const x = clamp01(tiled((a, b) => turbulence3(a, b, z, c.p.octaves, c.p.seed), u, v, per, c.p.tile)); return c.p.out === 'alpha' ? x : [x, x, x, 1]; }); } },
  { type: 'clouds', name: 'Clouds', category: 'Procedural', doc: 'Soft fractal clouds with coverage and softness (puffs, fog, nebulae).', inputs: [], animated: true, props: [SIZE, n('scale', 'Scale (cells)', 3, 1, 32, 1), n('coverage', 'Coverage', 0.5, 0, 1, 0.01), n('softness', 'Softness', 0.25, 0.01, 1, 0.01), bool('tile', 'Tileable', true), SEED, EVOLVE],
    eval: (c) => { const s = sizeOf(c), per = tileFreq(c), z = c.time * c.p.evolve * 0.3; return gen(s, s, (u, v) => { const x = 0.5 + 0.6 * tiled((a, b) => fbm3(a, b, z, 6, 2, 0.55, c.p.seed), u, v, per, c.p.tile); const a = clamp01((x - (1 - c.p.coverage)) / c.p.softness); return a; }); } },
  { type: 'voronoi', name: 'Voronoi', category: 'Procedural', doc: 'Cells: distance to the nearest point (F1), cell borders (F2−F1) or a random value per cell. Cracks, scales, caustics, magic.', inputs: [], animated: true, props: [SIZE, n('scale', 'Cells across', 6, 1, 64, 1), ch('mode', 'Mode', 'F1', ['F1', 'F2-F1', 'cells', 'crackle']), n('jitter', 'Randomness', 1, 0, 1, 0.01), bool('invert', 'Invert', false), SEED, EVOLVE],
    eval: (c) => { const s = sizeOf(c), per = tileFreq(c); return gen(s, s, (u, v) => { const r = voronoi2(u * per + Math.sin(c.time * c.p.evolve) * 0.0, v * per, c.p.seed + Math.floor(c.time * c.p.evolve * 0), c.p.jitter, per); let x = c.p.mode === 'F1' ? r.f1 : c.p.mode === 'F2-F1' ? (r.f2 - r.f1) * 1.5 : c.p.mode === 'cells' ? r.id : 1 - clamp01((r.f2 - r.f1) * 6); x = clamp01(x); if (c.p.invert) x = 1 - x; return [x, x, x, 1]; }); } },
  { type: 'cellular', name: 'Cellular noise', category: 'Procedural', doc: 'Worley noise layered over octaves: organic cells, foam, dissolve masks.', inputs: [], props: [SIZE, n('scale', 'Cells across', 5, 1, 32, 1), n('octaves', 'Octaves', 3, 1, 5, 1), bool('invert', 'Invert', true), SEED],
    eval: (c) => { const s = sizeOf(c), per = tileFreq(c); return gen(s, s, (u, v) => { let a = 1, sum = 0, tot = 0; for (let o = 0; o < c.p.octaves; o++) { const p = per * (1 << o); sum += voronoi2(u * p, v * p, c.p.seed + o, 1, p).f1 * a; tot += a; a *= 0.5; } let x = clamp01(sum / tot * 1.4); if (c.p.invert) x = 1 - x; return [x, x, x, 1]; }); } },
  { type: 'voronoiMask', name: 'Voronoi mask', category: 'Procedural', doc: 'Cell borders (cracks, energy webs) or filled cells with soft gaps (scales, debris shards, broken glass) as an opacity mask.', inputs: [], animated: true, props: [SIZE, n('scale', 'Cells across', 6, 1, 64, 1), ch('mode', 'Mask', 'borders', ['borders', 'cells']), n('width', 'Border width', 0.08, 0.005, 0.5, 0.005), n('soft', 'Softness', 0.04, 0, 0.5, 0.005), n('jitter', 'Randomness', 1, 0, 1, 0.01), bool('invert', 'Invert', false), SEED, n('evolve', 'Evolve (animation speed)', 0, 0, 20, 0.05)],
    eval: (c) => { const s = sizeOf(c), per = tileFreq(c); return gen(s, s, (u, v) => { const r = voronoi2(u * per, v * per, c.p.seed + Math.floor(c.time * c.p.evolve), c.p.jitter, per); const edge = r.f2 - r.f1; let m = c.p.mode === 'borders' ? 1 - clamp01((edge - c.p.width) / Math.max(1e-4, c.p.soft) + 0.5) : clamp01((edge - c.p.width) / Math.max(1e-4, c.p.soft) + 0.5); if (c.p.invert) m = 1 - m; return m; }); } },
  { type: 'linearGradient', name: 'Linear gradient', category: 'Procedural', doc: 'A gradient across the picture at an angle.', inputs: [], props: [SIZE, n('angle', 'Angle (°)', 90, -360, 360, 1), grd('gradient', 'Gradient', [{ t: 0, c: '#ffffff', a: 1 }, { t: 1, c: '#ffffff', a: 0 }])],
    eval: (c) => { const s = sizeOf(c), a = (c.p.angle * Math.PI) / 180, dx = Math.cos(a), dy = Math.sin(a); return gen(s, s, (u, v) => evalGradient(c.p.gradient, clamp01(0.5 + (u - 0.5) * dx + (v - 0.5) * dy)) as any); } },
  { type: 'radialGradient', name: 'Radial gradient', category: 'Procedural', doc: 'Soft round glow from the centre (the classic particle texture).', inputs: [], props: [SIZE, n('radius', 'Radius', 0.5, 0.01, 1, 0.01), n('falloff', 'Falloff power', 2, 0.2, 8, 0.1), grd('gradient', 'Gradient', [{ t: 0, c: '#ffffff', a: 1 }, { t: 1, c: '#ffffff', a: 0 }])],
    eval: (c) => { const s = sizeOf(c); return gen(s, s, (u, v) => evalGradient(c.p.gradient, clamp01(Math.pow(clamp01(Math.hypot(u - 0.5, v - 0.5) / c.p.radius), 1 / Math.max(0.01, c.p.falloff / 2)))) as any); } },
  { type: 'shape', name: 'Shape mask', category: 'Procedural', doc: 'Circle, ring, square, star, polygon, diamond, cross or flare with a soft edge — like drawing with symmetry in a paint program.', inputs: [], props: [SIZE, ch('shape', 'Shape', 'circle', ['circle', 'ring', 'square', 'star', 'polygon', 'diamond', 'cross', 'flare', 'heart']), n('radius', 'Radius', 0.4, 0.01, 0.5, 0.01), n('points', 'Points / sides', 5, 2, 24, 1), n('inner', 'Inner radius / thickness', 0.45, 0.01, 1, 0.01), n('soft', 'Edge softness', 0.04, 0, 0.5, 0.005), n('rotation', 'Rotation (°)', 0, -360, 360, 1)],
    eval: (c) => {
      const s = sizeOf(c), R = c.p.radius, k = Math.round(c.p.points), rot = (c.p.rotation * Math.PI) / 180, soft = Math.max(1e-4, c.p.soft);
      return gen(s, s, (u, v) => {
        let x = u - 0.5, y = v - 0.5; const cr = Math.cos(rot), sr = Math.sin(rot); [x, y] = [x * cr - y * sr, x * sr + y * cr];
        const r = Math.hypot(x, y), ang = Math.atan2(y, x);
        let d: number; // signed distance-ish (negative inside)
        switch (c.p.shape) {
          case 'ring': d = Math.abs(r - R) - R * c.p.inner * 0.3; break;
          case 'square': d = Math.max(Math.abs(x), Math.abs(y)) - R; break;
          case 'diamond': d = (Math.abs(x) + Math.abs(y)) / Math.SQRT2 - R * 0.75; break;
          case 'cross': d = Math.min(Math.max(Math.abs(x) - R * c.p.inner * 0.3, Math.abs(y) - R), Math.max(Math.abs(y) - R * c.p.inner * 0.3, Math.abs(x) - R)); break;
          case 'star': case 'polygon': { const seg = (Math.PI * 2) / k, a = ((ang % seg) + seg) % seg - seg / 2; const edge = c.p.shape === 'polygon' ? (R * Math.cos(Math.PI / k)) / Math.cos(a) : R * (c.p.inner + (1 - c.p.inner) * Math.pow(Math.abs(Math.cos((a / seg) * Math.PI)), 6)); d = r - edge; break; }
          case 'flare': { const rays = Math.pow(Math.abs(Math.cos(ang * k / 2)), 40) * R; d = r - Math.max(R * 0.15, rays * (1 - r / (R * 1.2))); break; }
          case 'heart': { const X = x / R * 1.2, Y = -y / R * 1.2 + 0.25; d = (Math.pow(X * X + Y * Y - 1, 3) - X * X * Y * Y * Y) * R * 0.3; break; }
          default: d = r - R;
        }
        return clamp01(0.5 - d / soft);
      });
    } },
  // ---------------------------------------------------------------- adjust (non-destructive filters)
  { type: 'adjust', name: 'Colour adjust', category: 'Adjust', doc: 'Brightness, contrast, saturation, hue and opacity.', inputs: ['in'], props: [n('brightness', 'Brightness', 0, -1, 1, 0.01), n('contrast', 'Contrast', 1, 0, 4, 0.01), n('saturation', 'Saturation', 1, 0, 3, 0.01), n('hue', 'Hue shift (°)', 0, -180, 180, 1), n('alpha', 'Opacity ×', 1, 0, 4, 0.01)],
    eval: (c) => { const s = c.input('in'); if (!s) return null; return map(s, (r, g, b, a) => { let [h, sa, l] = rgbToHsl(r, g, b); h += c.p.hue / 360; sa = clamp01(sa * c.p.saturation); let [R, G, B] = hslToRgb(h, sa, l); const f = (x: number) => clamp01((x - 0.5) * c.p.contrast + 0.5 + c.p.brightness); return [f(R), f(G), f(B), clamp01(a * c.p.alpha)]; }); } },
  { type: 'levels', name: 'Levels', category: 'Adjust', doc: 'Input black/white points and gamma (tweak levels of photos and renders).', inputs: ['in'], props: [n('black', 'Black point', 0, 0, 1, 0.01), n('white', 'White point', 1, 0, 1, 0.01), n('gamma', 'Gamma', 1, 0.1, 5, 0.01), bool('alpha', 'Apply to opacity too', false)],
    eval: (c) => { const s = c.input('in'); if (!s) return null; const f = (x: number) => Math.pow(clamp01((x - c.p.black) / Math.max(1e-4, c.p.white - c.p.black)), 1 / c.p.gamma); return map(s, (r, g, b, a) => [f(r), f(g), f(b), c.p.alpha ? f(a) : a]); } },
  { type: 'invert', name: 'Invert', category: 'Adjust', doc: 'Invert colour, opacity or both.', inputs: ['in'], props: [ch('what', 'Invert', 'colour', ['colour', 'alpha', 'both'])], eval: (c) => { const s = c.input('in'); if (!s) return null; const w = c.p.what; return map(s, (r, g, b, a) => [w !== 'alpha' ? 1 - r : r, w !== 'alpha' ? 1 - g : g, w !== 'alpha' ? 1 - b : b, w !== 'colour' ? 1 - a : a]); } },
  { type: 'colorize', name: 'Colorize', category: 'Adjust', doc: 'Tints by brightness: keeps the shading, replaces the colour.', inputs: ['in'], props: [col('color', 'Colour', '#ff8a2a'), n('amount', 'Amount', 1, 0, 1, 0.01)], eval: (c) => { const s = c.input('in'); if (!s) return null; const [R, G, B] = hexToRgb(c.p.color); return map(s, (r, g, b, a) => { const l = lum(r, g, b), k = c.p.amount; return [r + (R * l - r) * k, g + (G * l - g) * k, b + (B * l - b) * k, a]; }); } },
  { type: 'colorReplace', name: 'Colour replace', category: 'Adjust', doc: 'Swaps one colour (within a tolerance) for another.', inputs: ['in'], props: [col('from', 'Replace', '#ffffff'), col('to', 'With', '#ff3300'), n('tolerance', 'Tolerance', 0.25, 0, 1.8, 0.01), n('soft', 'Softness', 0.1, 0, 1, 0.01)], eval: (c) => { const s = c.input('in'); if (!s) return null; const F = hexToRgb(c.p.from), T = hexToRgb(c.p.to); return map(s, (r, g, b, a) => { const d = Math.hypot(r - F[0], g - F[1], b - F[2]); const k = 1 - clamp01((d - c.p.tolerance) / Math.max(1e-4, c.p.soft)); return [r + (T[0] - r) * k, g + (T[1] - g) * k, b + (T[2] - b) * k, a]; }); } },
  { type: 'gradientMap', name: 'Gradient map', category: 'Adjust', doc: 'Colours a grayscale picture by brightness through a gradient (fire from grey smoke, energy from noise).', inputs: ['in'], props: [grd('gradient', 'Gradient', [{ t: 0, c: '#000000', a: 0 }, { t: 0.4, c: '#8a1a00', a: 1 }, { t: 0.75, c: '#ff8a10', a: 1 }, { t: 1, c: '#fff8d0', a: 1 }]), ch('by', 'By', 'brightness', ['brightness', 'alpha'])], eval: (c) => { const s = c.input('in'); if (!s) return null; return map(s, (r, g, b, a) => { const t = c.p.by === 'alpha' ? a : lum(r, g, b); const q = evalGradient(c.p.gradient, clamp01(t)); return [q[0], q[1], q[2], q[3] * (c.p.by === 'alpha' ? 1 : a)]; }); } },
  { type: 'gradientOverlay', name: 'Gradient overlay', category: 'Adjust', doc: 'Multiplies the picture by a linear or radial gradient.', inputs: ['in'], props: [ch('shape', 'Shape', 'linear', ['linear', 'radial']), n('angle', 'Angle (°)', 90, -360, 360, 1), grd('gradient', 'Gradient', [{ t: 0, c: '#ffffff', a: 1 }, { t: 1, c: '#ff5a00', a: 1 }])], eval: (c) => { const s = c.input('in'); if (!s) return null; const a0 = (c.p.angle * Math.PI) / 180; return map(s, (r, g, b, a, u, v) => { const t = c.p.shape === 'radial' ? clamp01(Math.hypot(u - 0.5, v - 0.5) * 2) : clamp01(0.5 + (u - 0.5) * Math.cos(a0) + (v - 0.5) * Math.sin(a0)); const q = evalGradient(c.p.gradient, t); return [r * q[0], g * q[1], b * q[2], a * q[3]]; }); } },
  { type: 'posterize', name: 'Posterize (toon)', category: 'Adjust', doc: 'Fewer colour levels: a cartoon / cel-shaded look.', inputs: ['in'], props: [n('levels', 'Levels', 4, 2, 32, 1), bool('alpha', 'Also opacity', true)], eval: (c) => { const s = c.input('in'); if (!s) return null; const L = c.p.levels - 1, q = (x: number) => Math.round(x * L) / L; return map(s, (r, g, b, a) => [q(r), q(g), q(b), c.p.alpha ? q(a) : a]); } },
  { type: 'threshold', name: 'Threshold', category: 'Adjust', doc: 'Hard (or soft) cut-off by brightness or opacity.', inputs: ['in'], props: [n('level', 'Level', 0.5, 0, 1, 0.01), n('soft', 'Softness', 0.02, 0, 0.5, 0.005), ch('by', 'By', 'brightness', ['brightness', 'alpha'])], eval: (c) => { const s = c.input('in'); if (!s) return null; return map(s, (r, g, b, a) => { const t = c.p.by === 'alpha' ? a : lum(r, g, b) * a; const k = clamp01((t - c.p.level) / Math.max(1e-4, c.p.soft) + 0.5); return c.p.by === 'alpha' ? [r, g, b, k] : [k, k, k, a > 0 ? 1 : 0]; }); } },
  { type: 'alphaAdjust', name: 'Alpha adjust', category: 'Adjust', doc: 'Opacity from brightness (black → transparent: use renders on black), opacity × and edge softness.', inputs: ['in'], props: [bool('fromLum', 'Opacity from brightness', false), n('mul', 'Opacity ×', 1, 0, 4, 0.01), n('pow', 'Opacity curve', 1, 0.1, 5, 0.01)], eval: (c) => { const s = c.input('in'); if (!s) return null; return map(s, (r, g, b, a) => { let al = c.p.fromLum ? lum(r, g, b) * a : a; al = clamp01(Math.pow(al, c.p.pow) * c.p.mul); const m = Math.max(r, g, b, 1e-4); return c.p.fromLum ? [r / m, g / m, b / m, al] : [r, g, b, al]; }); } },
  { type: 'channel', name: 'Channel extract', category: 'Adjust', doc: 'One channel (R, G, B, A or brightness) as a grayscale picture or as opacity.', inputs: ['in'], props: [ch('channel', 'Channel', 'R', ['R', 'G', 'B', 'A', 'brightness']), ch('out', 'Output', 'grey', ['grey', 'alpha'])], eval: (c) => { const s = c.input('in'); if (!s) return null; const k = c.p.channel; return map(s, (r, g, b, a) => { const x = k === 'R' ? r : k === 'G' ? g : k === 'B' ? b : k === 'A' ? a : lum(r, g, b); return c.p.out === 'alpha' ? [1, 1, 1, x] : [x, x, x, 1]; }); } },
  // ---------------------------------------------------------------- filters
  { type: 'blur', name: 'Blur', category: 'Filters', doc: 'Gaussian-like blur.', inputs: ['in'], props: [n('radius', 'Radius (px)', 4, 0, 64, 1), bool('wrap', 'Wrap edges (tileable)', false)], eval: (c) => { const s = c.input('in'); return s ? blur(s, c.p.radius, c.p.wrap) : null; } },
  { type: 'glow', name: 'Glow', category: 'Filters', doc: 'Adds blurred copies on top (duplicate the layer + Gaussian blur, repeated) for a glowing look.', inputs: ['in'], props: [n('radius', 'Radius (px)', 8, 1, 64, 1), n('strength', 'Strength', 1, 0, 5, 0.05), n('layers', 'Layers', 2, 1, 4, 1), col('tint', 'Glow tint', '#ffffff')], eval: (c) => { const s = c.input('in'); if (!s) return null; const T = hexToRgb(c.p.tint); const out = map(s, (r, g, b, a) => [r * a, g * a, b * a, a]); for (let k = 1; k <= c.p.layers; k++) { const bl = blur(s, c.p.radius * k); for (let i = 0; i < out.d.length; i += 4) { const a = bl.d[i + 3] * c.p.strength / c.p.layers; out.d[i] += bl.d[i] * a * T[0]; out.d[i + 1] += bl.d[i + 1] * a * T[1]; out.d[i + 2] += bl.d[i + 2] * a * T[2]; out.d[i + 3] = Math.max(out.d[i + 3], clamp01(out.d[i + 3] + a)); } } for (let i = 0; i < out.d.length; i += 4) { const a = out.d[i + 3] || 1; out.d[i] = clamp01(out.d[i] / a); out.d[i + 1] = clamp01(out.d[i + 1] / a); out.d[i + 2] = clamp01(out.d[i + 2] / a); } return out; } },
  { type: 'sharpen', name: 'Sharpen', category: 'Filters', doc: 'Unsharp mask.', inputs: ['in'], props: [n('amount', 'Amount', 1, 0, 5, 0.05), n('radius', 'Radius (px)', 1, 1, 8, 1)], eval: (c) => { const s = c.input('in'); if (!s) return null; const b = blur(s, c.p.radius); const o = img(s.w, s.h); for (let i = 0; i < s.d.length; i++) o.d[i] = clamp01(s.d[i] + (s.d[i] - b.d[i]) * c.p.amount); o.sheet = s.sheet; return o; } },
  { type: 'edgeDetect', name: 'Edge detection', category: 'Filters', doc: 'Sobel edges of brightness/opacity (outlines, rims, electric edges).', inputs: ['in'], props: [n('strength', 'Strength', 2, 0.1, 10, 0.1), ch('by', 'By', 'alpha', ['alpha', 'brightness'])], eval: (c) => { const s = c.input('in'); if (!s) return null; const v = (x: number, y: number) => { x = Math.max(0, Math.min(s.w - 1, x)); y = Math.max(0, Math.min(s.h - 1, y)); const i = (y * s.w + x) * 4; return c.p.by === 'alpha' ? s.d[i + 3] : lum(s.d[i], s.d[i + 1], s.d[i + 2]) * s.d[i + 3]; }; return gen(s.w, s.h, (_u, _v, x, y) => { const gx = -v(x - 1, y - 1) - 2 * v(x - 1, y) - v(x - 1, y + 1) + v(x + 1, y - 1) + 2 * v(x + 1, y) + v(x + 1, y + 1); const gy = -v(x - 1, y - 1) - 2 * v(x, y - 1) - v(x + 1, y - 1) + v(x - 1, y + 1) + 2 * v(x, y + 1) + v(x + 1, y + 1); return clamp01(Math.hypot(gx, gy) * c.p.strength * 0.25); }); } },
  { type: 'soften', name: 'Edge softness', category: 'Filters', doc: 'Feathers the edges of the opacity (soft particle masks), keeping the colour.', inputs: ['in'], props: [n('radius', 'Radius (px)', 6, 1, 64, 1), n('vignette', 'Fade to the border', 0.15, 0, 0.5, 0.01)], eval: (c) => { const s = c.input('in'); if (!s) return null; const b = blur(s, c.p.radius); return map(s, (r, g, bb, a, u, v) => { const i = (Math.min(s.h - 1, Math.floor(v * s.h)) * s.w + Math.min(s.w - 1, Math.floor(u * s.w))) * 4; const e = Math.min(u, v, 1 - u, 1 - v); const vg = c.p.vignette > 0 ? clamp01(e / c.p.vignette) : 1; return [r, g, bb, Math.min(a, b.d[i + 3]) * vg]; }); } },
  { type: 'erode', name: 'Erode / dilate', category: 'Filters', doc: 'Morphology: shrink (erode) or grow (dilate) the opaque areas — dissolving edges for lava and fire.', inputs: ['in'], props: [n('radius', 'Radius (px)', 2, 1, 16, 1), ch('mode', 'Mode', 'erode', ['erode', 'dilate'])], eval: (c) => { const s = c.input('in'); if (!s) return null; const r = Math.round(c.p.radius), er = c.p.mode === 'erode'; const o = img(s.w, s.h); o.d.set(s.d); for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) { let m = er ? 1 : 0; for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { if (dx * dx + dy * dy > r * r) continue; const xx = Math.max(0, Math.min(s.w - 1, x + dx)), yy = Math.max(0, Math.min(s.h - 1, y + dy)); const a = s.d[(yy * s.w + xx) * 4 + 3]; m = er ? Math.min(m, a) : Math.max(m, a); } o.d[(y * s.w + x) * 4 + 3] = m; } o.sheet = s.sheet; return o; } },
  { type: 'dissolve', name: 'Dissolve', category: 'Filters', doc: 'Eats the picture away with a noise threshold and a glowing edge (burning paper, disintegration). Optional mask input drives it.', inputs: ['in', 'mask'], props: [n('amount', 'Amount', 0.4, 0, 1, 0.01), n('edge', 'Edge width', 0.06, 0, 0.5, 0.005), col('edgeColor', 'Edge colour', '#ffa030'), n('scale', 'Noise scale', 6, 1, 32, 1), SEED], eval: (c) => { const s = c.input('in'); if (!s) return null; const m = c.input('mask'); const E = hexToRgb(c.p.edgeColor), t = [0, 0, 0, 0]; return map(s, (r, g, b, a, u, v) => { const nz = m ? lum(...(sample(m, u, v, false, t) as [number, number, number])) : 0.5 + 0.5 * fbm3(u * c.p.scale, v * c.p.scale, 0.3, 4, 2, 0.5, c.p.seed); if (nz < c.p.amount) return [r, g, b, 0]; const k = clamp01((nz - c.p.amount) / Math.max(1e-4, c.p.edge)); return [r + (E[0] - r) * (1 - k), g + (E[1] - g) * (1 - k), b + (E[2] - b) * (1 - k), a]; }); } },
  // ---------------------------------------------------------------- transform & warp
  { type: 'transform', name: 'Texture transform', category: 'Transform', doc: 'Scale, rotate, offset, tile and flip.', inputs: ['in'], props: [n('scale', 'Scale', 1, 0.05, 16, 0.05), n('rotation', 'Rotation (°)', 0, -360, 360, 1), n('offX', 'Offset X', 0, -1, 1, 0.01), n('offY', 'Offset Y', 0, -1, 1, 0.01), n('tileX', 'Tiling X', 1, 1, 16, 1), n('tileY', 'Tiling Y', 1, 1, 16, 1), bool('flipX', 'Flip horizontally', false), bool('flipY', 'Flip vertically', false)],
    eval: (c) => { const s = c.input('in'); if (!s) return null; const a = (-c.p.rotation * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a); const tile = c.p.tileX > 1 || c.p.tileY > 1; return warp(s, (u, v) => { let x = (u * c.p.tileX) % 1 - 0.5, y = (v * c.p.tileY) % 1 - 0.5; if (c.p.flipX) x = -x; if (c.p.flipY) y = -y; [x, y] = [x * ca - y * sa, x * sa + y * ca]; return [x / c.p.scale + 0.5 - c.p.offX, y / c.p.scale + 0.5 - c.p.offY]; }, tile || c.p.offX !== 0 || c.p.offY !== 0); } },
  { type: 'distort', name: 'Distortion (warp)', category: 'Transform', doc: 'Displaces the picture by a second picture (usually noise): wobbly fire, heat haze, magic swirls.', inputs: ['in', 'by'], props: [n('strength', 'Strength', 0.08, -1, 1, 0.005), bool('wrap', 'Wrap edges', false)], eval: (c) => { const s = c.input('in'), d = c.input('by'); if (!s) return null; if (!d) return s; const t = [0, 0, 0, 0]; return warp(s, (u, v) => { sample(d, u, v, true, t); return [u + (t[0] - 0.5) * c.p.strength * 2, v + (t[1] - 0.5) * c.p.strength * 2]; }, c.p.wrap); } },
  { type: 'twirl', name: 'Twirl / spiral', category: 'Transform', doc: 'Swirls the picture around the centre (vortex, portal, spiral).', inputs: ['in'], props: [n('angle', 'Twist (°)', 180, -1440, 1440, 5), n('radius', 'Radius', 0.5, 0.05, 1, 0.01)], eval: (c) => { const s = c.input('in'); if (!s) return null; const A = (c.p.angle * Math.PI) / 180; return warp(s, (u, v) => { const x = u - 0.5, y = v - 0.5, r = Math.hypot(x, y), k = Math.max(0, 1 - r / c.p.radius), a = A * k * k, ca = Math.cos(a), sa = Math.sin(a); return [x * ca - y * sa + 0.5, x * sa + y * ca + 0.5]; }); } },
  { type: 'polar', name: 'Polar coordinates', category: 'Transform', doc: 'Wraps a picture around the centre (stripes → rings, noise → explosion streaks), or unwraps it.', inputs: ['in'], props: [ch('dir', 'Direction', 'to polar', ['to polar', 'to rectangular'])], eval: (c) => { const s = c.input('in'); if (!s) return null; return warp(s, (u, v) => { if (c.p.dir === 'to polar') { const x = u - 0.5, y = v - 0.5; return [(Math.atan2(y, x) / (Math.PI * 2) + 1) % 1, Math.min(0.999, Math.hypot(x, y) * 2)]; } const a = u * Math.PI * 2, r = v * 0.5; return [0.5 + Math.cos(a) * r, 0.5 + Math.sin(a) * r]; }, c.p.dir === 'to polar'); } },
  { type: 'symmetry', name: 'Radial symmetry (kaleidoscope)', category: 'Transform', doc: 'Mirrors one wedge around the centre N times, like a multibrush: stars, snowflakes, magic circles.', inputs: ['in'], props: [n('count', 'Copies', 6, 2, 32, 1), bool('mirror', 'Mirror each wedge', true), n('rotation', 'Rotation (°)', 0, -360, 360, 1)], eval: (c) => { const s = c.input('in'); if (!s) return null; const seg = (Math.PI * 2) / c.p.count, rot = (c.p.rotation * Math.PI) / 180; return warp(s, (u, v) => { const x = u - 0.5, y = v - 0.5, r = Math.hypot(x, y); let a = Math.atan2(y, x) - rot; a = ((a % seg) + seg) % seg; if (c.p.mirror && a > seg / 2) a = seg - a; a += rot; return [0.5 + Math.cos(a) * r, 0.5 + Math.sin(a) * r]; }); } },
  { type: 'spherize', name: 'Spherize', category: 'Transform', doc: 'Bulges the picture as if wrapped on a sphere (orbs, planets, bubbles).', inputs: ['in'], props: [n('amount', 'Amount', 1, -1, 2, 0.05), bool('clip', 'Round cut-out', true)], eval: (c) => { const s = c.input('in'); if (!s) return null; const o = warp(s, (u, v) => { const x = (u - 0.5) * 2, y = (v - 0.5) * 2, r = Math.hypot(x, y); if (r >= 1) return [u, v]; const k = r > 0 ? (Math.asin(r) / (Math.PI / 2) / r) ** c.p.amount : 1; return [0.5 + x * k * 0.5, 0.5 + y * k * 0.5]; }); if (c.p.clip) for (let y = 0; y < o.h; y++) for (let x = 0; x < o.w; x++) { const r = Math.hypot((x + 0.5) / o.w - 0.5, (y + 0.5) / o.h - 0.5) * 2; if (r > 1) o.d[(y * o.w + x) * 4 + 3] = 0; } return o; } },
  { type: 'tileable', name: 'Make tileable', category: 'Transform', doc: 'Blends the edges so the picture repeats seamlessly (scrolling textures, trails).', inputs: ['in'], props: [n('blend', 'Edge blend', 0.25, 0.01, 0.5, 0.01)], eval: (c) => { const s = c.input('in'); if (!s) return null; const t1 = [0, 0, 0, 0], t2 = [0, 0, 0, 0], t3 = [0, 0, 0, 0], t4 = [0, 0, 0, 0]; const b = c.p.blend; const wgt = (x: number) => clamp01(x < b ? 0.5 + 0.5 * (x / b) : x > 1 - b ? 0.5 + 0.5 * ((1 - x) / b) : 1); return gen(s.w, s.h, (u, v) => { const wu = wgt(u), wv = wgt(v); sample(s, u, v, true, t1); sample(s, (u + 0.5) % 1, v, true, t2); sample(s, u, (v + 0.5) % 1, true, t3); sample(s, (u + 0.5) % 1, (v + 0.5) % 1, true, t4); return [0, 1, 2, 3].map((k) => (t1[k] * wu + t2[k] * (1 - wu)) * wv + (t3[k] * wu + t4[k] * (1 - wu)) * (1 - wv)) as any; }); } },
  // ---------------------------------------------------------------- combine
  { type: 'blend', name: 'Texture blend', category: 'Combine', doc: 'Combines two pictures: mix, multiply, add, screen, overlay, subtract, max, min.', inputs: ['a', 'b'], props: [ch('mode', 'Mode', 'multiply', ['mix', 'multiply', 'add', 'screen', 'overlay', 'subtract', 'max', 'min']), n('amount', 'Amount', 1, 0, 1, 0.01)],
    eval: (c) => { const A = c.input('a'), B = c.input('b'); if (!A) return B; if (!B) return A; const t = [0, 0, 0, 0], k = c.p.amount; return map(A, (r, g, b, a, u, v) => { sample(B, u, v, true, t); const f = (x: number, y: number) => { switch (c.p.mode) { case 'multiply': return x * y; case 'add': return x + y; case 'screen': return 1 - (1 - x) * (1 - y); case 'overlay': return x < 0.5 ? 2 * x * y : 1 - 2 * (1 - x) * (1 - y); case 'subtract': return x - y; case 'max': return Math.max(x, y); case 'min': return Math.min(x, y); default: return y; } }; const md = c.p.mode, m = k * (md === 'multiply' ? 1 : t[3]); const al = md === 'multiply' ? a * (1 - k + k * t[3]) : md === 'subtract' || md === 'min' || md === 'overlay' ? a : a + (1 - a) * t[3] * k; return [clamp01(r + (f(r, t[0]) - r) * m), clamp01(g + (f(g, t[1]) - g) * m), clamp01(b + (f(b, t[2]) - b) * m), clamp01(al)]; }); } },
  { type: 'mask', name: 'Texture mask', category: 'Combine', doc: 'Uses the mask\'s brightness (or opacity) as the opacity of the picture.', inputs: ['in', 'mask'], props: [ch('by', 'Mask by', 'brightness', ['brightness', 'alpha']), bool('invert', 'Invert mask', false)], eval: (c) => { const s = c.input('in'), m = c.input('mask'); if (!s) return null; if (!m) return s; const t = [0, 0, 0, 0]; return map(s, (r, g, b, a, u, v) => { sample(m, u, v, false, t); let k = c.p.by === 'alpha' ? t[3] : lum(t[0], t[1], t[2]) * t[3]; if (c.p.invert) k = 1 - k; return [r, g, b, a * k]; }); } },
  { type: 'normalFromHeight', name: 'Normal map from height', category: 'Combine', doc: 'Makes a normal map from a height (brightness) picture, like Materialize: lit particles get depth.', inputs: ['height'], props: [n('strength', 'Strength', 4, 0.1, 30, 0.1), n('blur', 'Smooth (px)', 1, 0, 16, 1), bool('fromAlpha', 'Height from opacity', true)],
    eval: (c) => { let s = c.input('height'); if (!s) return null; if (c.p.blur > 0) s = blur(s, c.p.blur); const S = s; const hgt = (x: number, y: number) => { x = Math.max(0, Math.min(S.w - 1, x)); y = Math.max(0, Math.min(S.h - 1, y)); const i = (y * S.w + x) * 4; return c.p.fromAlpha ? S.d[i + 3] : lum(S.d[i], S.d[i + 1], S.d[i + 2]); }; return gen(S.w, S.h, (_u, _v, x, y) => { const dx = (hgt(x + 1, y) - hgt(x - 1, y)) * c.p.strength, dy = (hgt(x, y + 1) - hgt(x, y - 1)) * c.p.strength; const l = Math.hypot(dx, dy, 1); return [0.5 - dx / l * 0.5, 0.5 + dy / l * 0.5, 0.5 + 0.5 / l, 1]; }); } },
  { type: 'heightFromImage', name: 'Height from picture', category: 'Combine', doc: 'Grayscale height from brightness and opacity (for the normal-map node or a Material).', inputs: ['in'], props: [n('contrast', 'Contrast', 1.2, 0.1, 5, 0.05), n('blur', 'Smooth (px)', 2, 0, 16, 1)], eval: (c) => { let s = c.input('in'); if (!s) return null; s = map(s, (r, g, b, a) => { const h = clamp01((lum(r, g, b) * a - 0.5) * c.p.contrast + 0.5); return [h, h, h, 1]; }); return c.p.blur > 0 ? blur(s, c.p.blur) : s; } },
  // ---------------------------------------------------------------- flipbook / atlas tools
  { type: 'sequence', name: 'Texture sequence (bake flipbook)', category: 'Flipbooks', doc: 'Renders an animated node (anything using noise with "Evolve") over time into a sprite sheet: animated smoke, fire, energy without external tools.', inputs: ['in'], props: [n('cols', 'Columns', 4, 1, 16, 1), n('rows', 'Rows', 4, 1, 16, 1), n('frameSize', 'Frame size (px)', 128, 16, 512, 16), n('duration', 'Time span', 2, 0.05, 30, 0.05), bool('loop', 'Seamless loop (cross-fade)', true)],
    eval: () => null },
  { type: 'atlas', name: 'Texture atlas', category: 'Flipbooks', doc: 'Packs up to 8 pictures into one grid (a random-frame atlas for debris, leaves, sparks: use a Flipbook node with Random start and speed 0).', inputs: ['1', '2', '3', '4', '5', '6', '7', '8'], props: [n('cell', 'Cell size (px)', 128, 16, 512, 16)],
    eval: (c) => { const ins = ['1', '2', '3', '4', '5', '6', '7', '8'].map((k) => c.input(k)).filter(Boolean) as Img[]; if (!ins.length) return null; const n2 = ins.length, cols = Math.ceil(Math.sqrt(n2)), rows = Math.ceil(n2 / cols), cs = c.p.cell; const o = img(cols * cs, rows * cs), t = [0, 0, 0, 0]; ins.forEach((s, k) => { const ox = (k % cols) * cs, oy = Math.floor(k / cols) * cs; for (let y = 0; y < cs; y++) for (let x = 0; x < cs; x++) { sample(s, (x + 0.5) / cs, (y + 0.5) / cs, false, t); o.d.set(t, ((oy + y) * o.w + ox + x) * 4); } }); o.sheet = { cols, rows, frames: n2 }; return o; } },
  { type: 'channelPack', name: 'Channel pack (R, G, B)', category: 'Flipbooks', doc: 'Packs three grayscale pictures or sheets into the red, green and blue channels: 3× the flipbook frames in one texture. Use with Flipbook › Channel-packed and a gradient map.', inputs: ['r', 'g', 'b'], props: [ch('from', 'Value from', 'alpha', ['alpha', 'brightness'])],
    eval: (c) => { const R = c.input('r'), G = c.input('g'), B = c.input('b'); const base = R ?? G ?? B; if (!base) return null; const t = [0, 0, 0, 0]; const v = (s: Img | null, u: number, vv: number) => { if (!s) return 0; sample(s, u, vv, false, t); return c.p.from === 'alpha' ? t[3] : lum(t[0], t[1], t[2]) * t[3]; }; const o = gen(base.w, base.h, (u, vv) => [v(R, u, vv), v(G, u, vv), v(B, u, vv), 1]); o.sheet = base.sheet; return o; } },
];
/** Texture recipes: ready-made node chains for common VFX textures (inputs refer to earlier steps by index). */
export interface TexRecipe { name: string; doc: string; steps: { type: string; props?: Record<string, any>; inputs?: Record<string, number>; name?: string }[] }
const GR = (s: [number, string, number?][]) => s.map(([t, c, a]) => ({ t, c, a: a ?? 1 }));
export const TEX_RECIPES: TexRecipe[] = [
  { name: 'Smoke puff', doc: 'Billowy turbulence in a soft round mask, coloured grey with transparent gaps.', steps: [
    { type: 'turbulence', props: { scale: 3, octaves: 5 }, name: 'Billows' }, { type: 'radialGradient', props: { falloff: 1.6 }, name: 'Soft mask' },
    { type: 'blend', props: { mode: 'multiply' }, inputs: { a: 0, b: 1 } }, { type: 'gradientMap', props: { gradient: GR([[0, '#9a9a9a', 0], [0.18, '#9a9a9a', 0], [0.45, '#c8c8c8', 0.65], [1, '#ffffff', 1]]) }, inputs: { in: 2 }, name: 'Smoke colour' }] },
  { name: 'Fire', doc: 'Turbulence warped by noise, masked and mapped through a fire gradient.', steps: [
    { type: 'turbulence', props: { scale: 3, octaves: 4 } }, { type: 'perlin', props: { scale: 3 } }, { type: 'distort', props: { strength: 0.12 }, inputs: { in: 0, by: 1 }, name: 'Flicker warp' },
    { type: 'shape', props: { shape: 'circle', radius: 0.42, soft: 0.35 }, name: 'Flame mask' }, { type: 'blend', props: { mode: 'multiply' }, inputs: { a: 2, b: 3 } },
    { type: 'gradientMap', props: { gradient: GR([[0, '#000000', 0], [0.25, '#7a1200', 0.8], [0.55, '#ff6a10'], [0.8, '#ffd060'], [1, '#fffbe8']]) }, inputs: { in: 4 }, name: 'Fire colour' }] },
  { name: 'Explosion flipbook', doc: 'An evolving fireball baked into a 4×4 sprite sheet (connect it to a Flipbook node).', steps: [
    { type: 'turbulence', props: { scale: 2, octaves: 5, evolve: 2.2 } }, { type: 'radialGradient', props: { falloff: 1.6 } }, { type: 'blend', props: { mode: 'multiply' }, inputs: { a: 0, b: 1 } },
    { type: 'gradientMap', props: { gradient: GR([[0, '#000000', 0], [0.2, '#3a0a00', 0.7], [0.45, '#ff4a00'], [0.75, '#ffb030'], [1, '#ffffff']]) }, inputs: { in: 2 } },
    { type: 'sequence', props: { cols: 4, rows: 4, frameSize: 128, duration: 1.2, loop: false }, inputs: { in: 3 }, name: 'Explosion sheet' }] },
  { name: 'Energy pattern', doc: 'A glowing cyan cell web.', steps: [
    { type: 'voronoiMask', props: { scale: 5, mode: 'borders', width: 0.04, soft: 0.06, evolve: 1 } }, { type: 'glow', props: { radius: 6, strength: 1.5 }, inputs: { in: 0 } }, { type: 'colorize', props: { color: '#5ce1ff' }, inputs: { in: 1 }, name: 'Energy colour' }] },
  { name: 'Clouds', doc: 'Soft tileable clouds with feathered edges.', steps: [{ type: 'clouds', props: { coverage: 0.55, softness: 0.3 } }, { type: 'soften', props: { radius: 4, vignette: 0.2 }, inputs: { in: 0 } }] },
  { name: 'Magic circle', doc: 'Ring and star mirrored 8 ways, glowing violet — use with a Horizontal billboard.', steps: [
    { type: 'shape', props: { shape: 'ring', radius: 0.42, inner: 0.15 } }, { type: 'shape', props: { shape: 'star', points: 8, radius: 0.36, inner: 0.3 } }, { type: 'blend', props: { mode: 'max' }, inputs: { a: 0, b: 1 } },
    { type: 'symmetry', props: { count: 8 }, inputs: { in: 2 } }, { type: 'glow', props: { radius: 5, strength: 1.2, tint: '#b07cff' }, inputs: { in: 3 } }, { type: 'colorize', props: { color: '#c49bff' }, inputs: { in: 4 }, name: 'Circle colour' }] },
  { name: 'Glow', doc: 'A soft round glow (the classic additive particle).', steps: [{ type: 'radialGradient', props: { falloff: 3.5 } }] },
  { name: 'Distortion map', doc: 'A soft ring turned into a normal map: use as a Material normal map with Refraction for shockwaves.', steps: [
    { type: 'shape', props: { shape: 'ring', radius: 0.38, inner: 0.5, soft: 0.05 } }, { type: 'blur', props: { radius: 6 }, inputs: { in: 0 } }, { type: 'normalFromHeight', props: { strength: 8, fromAlpha: true }, inputs: { height: 1 }, name: 'Distortion normals' }] },
  { name: 'Spark', doc: 'A four-point flare with glow.', steps: [{ type: 'shape', props: { shape: 'flare', points: 4, radius: 0.48 } }, { type: 'glow', props: { radius: 4, strength: 1.4 }, inputs: { in: 0 }, name: 'Spark glow' }] },
  { name: 'Debris mask', doc: 'Irregular shards cut from Voronoi cells (atlas them for random debris).', steps: [{ type: 'voronoiMask', props: { scale: 3, mode: 'cells', width: 0.05, soft: 0.01 } }, { type: 'erode', props: { radius: 2, mode: 'erode' }, inputs: { in: 0 } }, { type: 'shape', props: { shape: 'circle', radius: 0.45, soft: 0.02 } }, { type: 'mask', props: { by: 'alpha' }, inputs: { in: 1, mask: 2 }, name: 'Shards' }] },
  { name: 'Soft particle mask', doc: 'A round mask with noisy, feathered edges for smoke and dust.', steps: [{ type: 'radialGradient', props: { falloff: 1.2 } }, { type: 'fractal', props: { scale: 4, out: 'alpha' } }, { type: 'mask', props: { by: 'alpha' }, inputs: { in: 0, mask: 1 } }, { type: 'soften', props: { radius: 5 }, inputs: { in: 2 }, name: 'Soft mask' }] },
  { name: 'Electric crackle', doc: 'Thin crackling lines twisted into an electric ball.', steps: [{ type: 'voronoi', props: { scale: 6, mode: 'crackle', evolve: 3 } }, { type: 'twirl', props: { angle: 120 }, inputs: { in: 0 } }, { type: 'threshold', props: { level: 0.55, soft: 0.08 }, inputs: { in: 1 } }, { type: 'channel', props: { channel: 'brightness', out: 'alpha' }, inputs: { in: 2 } }, { type: 'glow', props: { radius: 4, strength: 1.5, tint: '#7ac8ff' }, inputs: { in: 3 }, name: 'Electric' }] },
];

export const TEX_NODE = Object.fromEntries(TEX_NODE_TYPES.map((t) => [t.type, t])) as Record<string, TexNodeType>;

export function texNodeDefaults(type: string): Record<string, any> {
  const t = TEX_NODE[type];
  return Object.fromEntries((t?.props ?? []).map((p) => [p.key, Array.isArray(p.default) ? JSON.parse(JSON.stringify(p.default)) : p.default]));
}

/** Image → canvas (straight alpha). */
export function toCanvas(s: Img): HTMLCanvasElement {
  const c = document.createElement('canvas'); c.width = s.w; c.height = s.h;
  const g = c.getContext('2d')!, id = g.createImageData(s.w, s.h);
  for (let i = 0; i < s.d.length; i++) id.data[i] = Math.round(clamp01(s.d[i]) * 255);
  g.putImageData(id, 0, 0);
  return c;
}
/** Canvas / image element → Img (at most `max` px across). */
export function fromImage(el: CanvasImageSource & { width: number; height: number; naturalWidth?: number; naturalHeight?: number }, max = 1024): Img {
  const w0 = el.naturalWidth || el.width, h0 = el.naturalHeight || el.height, k = Math.min(1, max / Math.max(w0, h0));
  const w = Math.max(1, Math.round(w0 * k)), h = Math.max(1, Math.round(h0 * k));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true })!; g.drawImage(el, 0, 0, w, h);
  const d = g.getImageData(0, 0, w, h).data, o = img(w, h);
  for (let i = 0; i < d.length; i++) o.d[i] = d[i] / 255;
  return o;
}
