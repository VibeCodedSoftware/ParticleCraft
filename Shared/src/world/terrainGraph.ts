// Terrain node graph: land built from connected nodes, worked out on a square grid. Generators (Mountain, Pattern,
// Shape) make heights; others change them (Warp, Adjust, Terrace, Erosion) or join them (Combine); Mask turns land
// into a 0..1 selection; Colorize gives colours; Output says how tall the land is and which colours it wears.
// Heights between nodes are 0..1 (Output scales them to metres). Ideas for the noise kinds, pattern mixing, terrace
// modes and edge falloff were taken from landscape tools in general; the code is this project's own.
import { erodeGrid, type ErosionResult } from './erosion';
import { noise2 } from './random';
import { LOOK_PALETTES } from './biomes';
import { baseHeight } from './terrain';
import type { TerrainCfg } from './document';

export type PortKind = 'height' | 'mask' | 'color';
export interface GraphNode { id: string; type: NodeType; x: number; y: number; params: Record<string, number | string> }
/** A link from one node's output port into another node's input port. */
export interface GraphLink { from: string; fromPort: string; to: string; toPort: string }
export interface TerrainGraph { nodes: GraphNode[]; links: GraphLink[] }

export type NodeType = 'world' | 'mountain' | 'pattern' | 'shape' | 'combine' | 'warp' | 'adjust' | 'terrace' | 'erosion' | 'mask' | 'colorize' | 'output';
interface ParamDef { key: string; label: string; kind: 'num' | 'choice'; min?: number; max?: number; step?: number; options?: [string, string][]; def: number | string; tip?: string }
export interface NodeDef { type: NodeType; name: string; tip: string; inputs: { port: string; kind: PortKind; label: string }[]; outputs: { port: string; kind: PortKind; label: string }[]; params: ParamDef[] }

const num = (key: string, label: string, min: number, max: number, step: number, def: number, tip?: string): ParamDef => ({ key, label, kind: 'num', min, max, step, def, tip });
const choice = (key: string, label: string, options: [string, string][], def: string, tip?: string): ParamDef => ({ key, label, kind: 'choice', options, def, tip });
const H = (port = 'height', label = 'Height') => ({ port, kind: 'height' as const, label });
const M = (port = 'mask', label = 'Mask') => ({ port, kind: 'mask' as const, label });

export const NODE_DEFS: Record<NodeType, NodeDef> = {
  world: { type: 'world', name: 'World terrain', tip: "The land this world's terrain settings and logic bricks make (Terrain Generator, Height, Noise…), to build on: erode it, terrace it, colour it.", inputs: [], outputs: [H()], params: [] },
  mountain: { type: 'mountain', name: 'Mountain', tip: 'Land from layered noise, in many kinds.', inputs: [], outputs: [H()], params: [
    choice('kind', 'Kind', [['fbm', 'Rolling (fBm)'], ['ridged', 'Ridged peaks'], ['hybrid', 'Hybrid (smooth valleys, rough peaks)'], ['hetero', 'Hetero terrain'], ['shattered', 'Shattered rock'], ['strata', 'Strata terrain'], ['slick', 'Slick rock'], ['billow', 'Billowy hills']], 'ridged'),
    num('scale', 'Scale', 0.2, 8, 0.05, 1.6, 'Bigger: larger, fewer forms.'), num('octaves', 'Detail (octaves)', 1, 9, 1, 6), num('roughness', 'Roughness', 0.2, 0.8, 0.01, 0.5, 'How strong each finer layer is.'),
    num('lacunarity', 'Lacunarity', 1.5, 3, 0.01, 2.05), num('seed', 'Seed', 0, 9999, 1, 1)] },
  pattern: { type: 'pattern', name: 'Pattern', tip: 'Regular forms to mix in: waves, rings, cracks, blocks, spikes, dunes.', inputs: [], outputs: [H()], params: [
    choice('kind', 'Kind', [['waves', 'Waves'], ['rings', 'Rings'], ['cracks', 'Cracks'], ['blocks', 'Blocks'], ['spikes', 'Spikes'], ['dunes', 'Dunes'], ['gradient', 'Gradient']], 'waves'),
    num('scale', 'Scale', 0.5, 20, 0.1, 4), num('rotation', 'Rotation (°)', 0, 360, 1, 0), num('wobble', 'Wobble', 0, 1, 0.01, 0.3, 'Noise bending the pattern.'), num('seed', 'Seed', 0, 9999, 1, 3)] },
  shape: { type: 'shape', name: 'Shape', tip: 'A base shape (round or square), soft at its edge: for islands, single peaks, and fading the land out at the border.', inputs: [], outputs: [H('height', 'Shape')], params: [
    choice('kind', 'Kind', [['round', 'Round'], ['square', 'Square'], ['ridge', 'Ridge (line)']], 'round'), num('size', 'Size', 0.1, 1.5, 0.01, 0.8), num('falloff', 'Edge softness', 0.01, 1, 0.01, 0.4)] },
  combine: { type: 'combine', name: 'Combine', tip: 'Joins two inputs: add, subtract, multiply, min, max, screen, difference or blend; an optional mask says where.', inputs: [H('a', 'A'), H('b', 'B'), M('mask', 'Mask (optional)')], outputs: [H()], params: [
    choice('mode', 'Mode', [['add', 'Add'], ['subtract', 'Subtract'], ['multiply', 'Multiply'], ['min', 'Min'], ['max', 'Max'], ['screen', 'Screen'], ['difference', 'Difference'], ['blend', 'Blend']], 'add'),
    num('amount', 'Amount of B', 0, 2, 0.01, 0.5)] },
  warp: { type: 'warp', name: 'Warp', tip: 'Bends the input sideways with noise: twisting ridges and valleys.', inputs: [H()], outputs: [H()], params: [num('strength', 'Strength', 0, 0.5, 0.005, 0.08), num('scale', 'Scale', 0.5, 10, 0.1, 2.5), num('seed', 'Seed', 0, 9999, 1, 7)] },
  adjust: { type: 'adjust', name: 'Adjust', tip: 'Height scale, offset, invert, clamp, curve and softening.', inputs: [H()], outputs: [H()], params: [
    num('scale', 'Scale', 0, 3, 0.01, 1), num('offset', 'Offset', -1, 1, 0.01, 0), choice('invert', 'Invert', [['no', 'No'], ['yes', 'Yes']], 'no'), num('curve', 'Curve (gamma)', 0.2, 4, 0.01, 1, 'Over 1: flatter lowlands and sharper peaks.'),
    num('min', 'Clamp low', 0, 1, 0.01, 0), num('max', 'Clamp high', 0, 1, 0.01, 1), num('smooth', 'Soften (passes)', 0, 20, 1, 0)] },
  terrace: { type: 'terrace', name: 'Terrace', tip: 'Steps: smooth benches, sharp ledges, or a mix.', inputs: [H(), M('mask', 'Mask (optional)')], outputs: [H()], params: [
    num('steps', 'Steps', 2, 40, 1, 10), choice('mode', 'Mode', [['smooth', 'Smooth benches'], ['sharp', 'Sharp ledges'], ['mixed', 'Mixed']], 'smooth'), num('strength', 'Strength', 0, 1, 0.01, 0.8), num('wobble', 'Uneven steps', 0, 1, 0.01, 0.3)] },
  erosion: { type: 'erosion', name: 'Erosion', tip: 'Rain and sliding wear the land: gullies, fans and scree. Gives the flow, wear and sediment it left as masks too.', inputs: [H()], outputs: [H(), M('flow', 'Flow'), M('wear', 'Wear'), M('deposit', 'Sediment')], params: [
    num('rain', 'Rain', 0, 1, 0.01, 0.8), num('strength', 'Strength', 0, 1, 0.01, 0.6), num('thermal', 'Sliding', 0, 1, 0.01, 0.3), num('talus', 'Resting slope', 0.05, 1.5, 0.01, 0.6), num('shore', 'Shore level (0 off)', 0, 1, 0.01, 0, 'Flattens the land into beaches near this height.'), num('seed', 'Seed', 0, 9999, 1, 1)] },
  mask: { type: 'mask', name: 'Mask', tip: 'A selection from the land: by height, by slope, or a mask input brightened or narrowed.', inputs: [H('height', 'Height or mask')], outputs: [M()], params: [
    choice('by', 'Select by', [['height', 'Height'], ['slope', 'Slope'], ['value', 'Input value (for masks)']], 'height'), num('low', 'From', 0, 1, 0.01, 0.4), num('high', 'To', 0, 1, 0.01, 1), num('softness', 'Softness', 0, 0.5, 0.01, 0.08), choice('invert', 'Invert', [['no', 'No'], ['yes', 'Yes']], 'no')] },
  colorize: { type: 'colorize', name: 'Colorize', tip: "Colours from the land's data through a palette: height, slope, and flow / wear / sediment masks if connected.", inputs: [H(), M('flow', 'Flow'), M('wear', 'Wear'), M('deposit', 'Sediment')], outputs: [{ port: 'color', kind: 'color', label: 'Colour' }], params: [
    choice('palette', 'Palette', Object.entries(LOOK_PALETTES).map(([k, p]) => [k, p.name] as [string, string]), 'temperate'), num('strength', 'Strength', 0, 1, 0.01, 0.8)] },
  output: { type: 'output', name: 'Output', tip: 'The land the graph makes: its height in metres and the colours it wears.', inputs: [H(), { port: 'color', kind: 'color', label: 'Colour (optional)' }, M('flow', 'Flow (for the look)'), M('wear', 'Wear (for the look)'), M('deposit', 'Sediment (for the look)')], outputs: [], params: [
    num('base', 'Lowest point (m)', -50, 200, 1, 0), num('height', 'Height (m)', 5, 600, 1, 150)] },
};

export const paramDefaults = (t: NodeType) => Object.fromEntries(NODE_DEFS[t].params.map((p) => [p.key, p.def]));
let idn = 0;
export const newNode = (type: NodeType, x: number, y: number): GraphNode => ({ id: `n${Date.now().toString(36)}${(idn++).toString(36)}`, type, x, y, params: paramDefaults(type) });

/** A graph to start from: ridged mountains, warped, eroded and coloured. */
export function defaultGraph(): TerrainGraph {
  const m = { ...newNode('mountain', 20, 40), id: 'mtn' }, s = { ...newNode('shape', 20, 230), id: 'shp' }, c = { ...newNode('combine', 230, 120), id: 'cmb' };
  c.params.mode = 'multiply'; c.params.amount = 1; s.params.size = 1.1; s.params.falloff = 0.5;
  const w = { ...newNode('warp', 430, 120), id: 'wrp' }, e = { ...newNode('erosion', 630, 120), id: 'ero' }, col = { ...newNode('colorize', 850, 260), id: 'col' }, o = { ...newNode('output', 1060, 120), id: 'out' };
  return { nodes: [m, s, c, w, e, col, o], links: [
    { from: 'mtn', fromPort: 'height', to: 'cmb', toPort: 'a' }, { from: 'shp', fromPort: 'height', to: 'cmb', toPort: 'b' }, { from: 'cmb', fromPort: 'height', to: 'wrp', toPort: 'height' },
    { from: 'wrp', fromPort: 'height', to: 'ero', toPort: 'height' }, { from: 'ero', fromPort: 'height', to: 'out', toPort: 'height' },
    { from: 'ero', fromPort: 'height', to: 'col', toPort: 'height' }, { from: 'ero', fromPort: 'flow', to: 'col', toPort: 'flow' }, { from: 'ero', fromPort: 'wear', to: 'col', toPort: 'wear' }, { from: 'ero', fromPort: 'deposit', to: 'col', toPort: 'deposit' },
    { from: 'col', fromPort: 'color', to: 'out', toPort: 'color' }, { from: 'ero', fromPort: 'flow', to: 'out', toPort: 'flow' }, { from: 'ero', fromPort: 'wear', to: 'out', toPort: 'wear' }, { from: 'ero', fromPort: 'deposit', to: 'out', toPort: 'deposit' },
  ] };
}

/** Would linking `from` into `to` make a loop? */
export function makesLoop(g: TerrainGraph, from: string, to: string): boolean {
  const seen = new Set<string>(), stack = [from];
  while (stack.length) { const n = stack.pop()!; if (n === to) return true; if (seen.has(n)) continue; seen.add(n); for (const l of g.links) if (l.to === n) stack.push(l.from); }
  return false;
}

// ---------------------------------------------------------------- evaluation
/** What a node gives on each output port: heights and masks as N×N arrays (0..1), colours as N×N×3. */
export type NodeResult = Record<string, Float32Array>;
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const sstep = (a: number, b: number, x: number) => { const t = clamp01((x - a) / (b - a || 1e-6)); return t * t * (3 - 2 * t); };
const hexRGB = (h: string): [number, number, number] => { const v = parseInt(h.replace('#', ''), 16); return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255]; };

function normalize(a: Float32Array) { let lo = Infinity, hi = -Infinity; for (const v of a) { if (v < lo) lo = v; if (v > hi) hi = v; } const r = hi - lo || 1; for (let k = 0; k < a.length; k++) a[k] = (a[k] - lo) / r; return a; }
function blur(a: Float32Array, N: number, passes: number) {
  const t = new Float32Array(a.length);
  for (let p = 0; p < passes; p++) {
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const k = j * N + i, l = i > 0 ? k - 1 : k, r = i < N - 1 ? k + 1 : k, u = j > 0 ? k - N : k, d = j < N - 1 ? k + N : k; t[k] = (a[k] * 4 + a[l] + a[r] + a[u] + a[d]) / 8; }
    a.set(t);
  }
  return a;
}
function sample(a: Float32Array, N: number, x: number, y: number) {
  x = Math.max(0, Math.min(N - 1.001, x)); y = Math.max(0, Math.min(N - 1.001, y));
  const i = Math.floor(x), j = Math.floor(y), u = x - i, v = y - j, k = j * N + i;
  return (a[k] * (1 - u) + a[k + 1] * u) * (1 - v) + (a[k + N] * (1 - u) + a[k + N + 1] * u) * v;
}

/** One noise value for the Mountain kinds, at (x, y) in the graph's 0..1 square times its scale. */
function mountainAt(kind: string, s: number, x: number, y: number, oct: number, gain: number, lac: number): number {
  let f = 1, a = 1, sum = 0, norm = 0, w = 1;
  switch (kind) {
    case 'ridged': { for (let o = 0; o < oct; o++) { let r = 1 - Math.abs(noise2(s + o, x * f, y * f)); r *= r; r *= w; w = clamp01(r * 2); sum += r * a; norm += a; a *= gain; f *= lac; } return sum / norm; }
    case 'hybrid': { let v = (noise2(s, x, y) * 0.5 + 0.5); sum = v; norm = 1; w = v; for (let o = 1; o < oct; o++) { f *= lac; a *= gain; const n = (noise2(s + o, x * f, y * f) * 0.5 + 0.5) * a; sum += n * w; norm += a * 0.6; w = clamp01(w * n * 4); } return sum / norm; }
    case 'hetero': { let v = noise2(s, x, y) * 0.5 + 0.5; for (let o = 1; o < oct; o++) { f *= lac; a *= gain; v += (noise2(s + o, x * f, y * f) * 0.5 + 0.5) * a * v; } return v / 2; }
    case 'shattered': { const base = mountainAt('hetero', s, x, y, oct, gain, lac), c = cells(s + 50, x * 3, y * 3); return base * 0.8 + (c[1] - c[0]) * 0.6; }
    case 'strata': { const base = mountainAt('hetero', s, x, y, oct, gain, lac), st = base * 9 + noise2(s + 77, x * 2, y * 2) * 0.6; return (Math.floor(st) + sstep(0.65, 1, st - Math.floor(st))) / 9; }
    case 'slick': { const wx = noise2(s + 31, x * 1.3, y * 1.3) * 0.35, wy = noise2(s + 37, x * 1.3, y * 1.3) * 0.35; return mountainAt('ridged', s, x + wx, y + wy, oct, gain, lac) * 0.75 + mountainAt('fbm', s + 9, x, y, Math.min(4, oct), gain, lac) * 0.35; }
    case 'billow': { for (let o = 0; o < oct; o++) { sum += Math.abs(noise2(s + o, x * f, y * f)) * a; norm += a; a *= gain; f *= lac; } return sum / norm; }
    default: { for (let o = 0; o < oct; o++) { sum += (noise2(s + o, x * f, y * f) * 0.5 + 0.5) * a; norm += a; a *= gain; f *= lac; } return sum / norm; }
  }
}
/** Distances to the nearest and second-nearest cell point (Voronoi F1, F2). */
function cells(s: number, x: number, y: number): [number, number] {
  const xi = Math.floor(x), yi = Math.floor(y); let d1 = 9, d2 = 9;
  for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) {
    const cx = xi + a, cy = yi + b, h = Math.sin(cx * 127.1 + cy * 311.7 + s * 74.7) * 43758.5453, px = cx + (h - Math.floor(h)), h2 = Math.sin(cx * 269.5 + cy * 183.3 + s * 21.1) * 43758.5453, py = cy + (h2 - Math.floor(h2));
    const d = Math.hypot(x - px, y - py); if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
  }
  return [d1, d2];
}

/**
 * Works out every node feeding `target` (or the Output node) on an N×N grid over the 0..1 square. Results are cached by
 * each node's settings and inputs, so changing one node redoes only it and what follows it. `progress` may return
 * false to stop (then null).
 */
export class GraphEvaluator {
  private cache = new Map<string, { key: string; out: NodeResult }>();
  /**
   * `world`: for the World terrain node, the world's terrain settings as the bricks leave them and the side of the square
   * the graph covers (m, centred on the world's middle).
   */
  constructor(public N = 128, public world?: { terrain: TerrainCfg; side: number }) {}
  async run(g: TerrainGraph, target?: string, progress: (f: number) => boolean | void = () => true): Promise<{ node: GraphNode; out: NodeResult } | null> {
    const t = target ? g.nodes.find((n) => n.id === target) : g.nodes.find((n) => n.type === 'output');
    if (!t) return null;
    const keys = new Map<string, string>(), visiting = new Set<string>();
    const evalNode = async (n: GraphNode): Promise<NodeResult> => {
      if (visiting.has(n.id)) throw new Error('loop');
      visiting.add(n.id);
      const ins: Record<string, Float32Array | undefined> = {}; const inKeys: string[] = [];
      for (const l of g.links.filter((x) => x.to === n.id)) {
        const src = g.nodes.find((x) => x.id === l.from); if (!src) continue;
        const r = await evalNode(src); ins[l.toPort] = r[l.fromPort]; inKeys.push(`${l.toPort}<${keys.get(src.id)}.${l.fromPort}`);
      }
      visiting.delete(n.id);
      const key = `${n.type}|${JSON.stringify(n.params)}|${inKeys.sort().join(',')}|${this.N}${n.type === 'world' ? '|' + JSON.stringify(this.world ?? null) : ''}`;
      keys.set(n.id, key);
      const hit = this.cache.get(n.id); if (hit && hit.key === key) return hit.out;
      if (progress(0) === false) throw new Error('stopped');
      const out = await this.compute(n, ins, progress);
      this.cache.set(n.id, { key, out });
      return out;
    };
    try { return { node: t, out: await evalNode(t) }; } catch (e) { if ((e as Error).message === 'stopped') return null; throw e; }
  }

  private async compute(n: GraphNode, ins: Record<string, Float32Array | undefined>, progress: (f: number) => boolean | void): Promise<NodeResult> {
    const N = this.N, P = n.params, NN = N * N, p = (k: string) => Number(P[k]), s = (k: string) => String(P[k]);
    const zero = () => new Float32Array(NN);
    const each = (f: (x: number, y: number, k: number) => number) => { const a = zero(); for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) a[j * N + i] = f(i / (N - 1), j / (N - 1), j * N + i); return a; };
    switch (n.type) {
      case 'world': {
        // The generated land (not any applied graph: that would feed the graph its own output), as 0..1 between the
        // terrain's base height and its top, the way Output turns it back into metres with the same numbers.
        const w = this.world; if (!w) return { height: zero() };
        const lo = w.terrain.baseHeight, span = Math.max(1, w.terrain.height);
        return { height: each((x, y) => clamp01((baseHeight(w.terrain, (x - 0.5) * w.side, (y - 0.5) * w.side) - lo) / span)) };
      }
      case 'mountain': {
        const sc = p('scale') * 3, seed = p('seed') * 13 + 1, oct = Math.round(p('octaves'));
        return { height: normalize(each((x, y) => mountainAt(s('kind'), seed, x * sc, y * sc, oct, p('roughness'), p('lacunarity')))) };
      }
      case 'pattern': {
        const sc = p('scale'), a = (p('rotation') * Math.PI) / 180, c = Math.cos(a), sn = Math.sin(a), wob = p('wobble'), seed = p('seed') * 7 + 3;
        return { height: normalize(each((x0, y0) => {
          const cx = x0 - 0.5, cy = y0 - 0.5, wx = noise2(seed, x0 * 3, y0 * 3) * wob * 0.15, wy = noise2(seed + 1, x0 * 3, y0 * 3) * wob * 0.15;
          const x = (cx * c - cy * sn + wx) * sc, y = (cx * sn + cy * c + wy) * sc;
          switch (s('kind')) {
            case 'rings': return 0.5 + 0.5 * Math.sin(Math.hypot(x, y) * Math.PI * 2);
            case 'cracks': { const [d1, d2] = cells(seed, x, y); return sstep(0, 0.12, d2 - d1); }
            case 'blocks': return (Math.abs(Math.floor(x) + Math.floor(y) * 3) % 4) / 3;
            case 'spikes': { const [d1] = cells(seed, x, y); return Math.pow(clamp01(1 - d1 * 1.6), 2.5); }
            case 'dunes': { const t = ((x % 1) + 1) % 1; return t < 0.75 ? t / 0.75 : (1 - t) / 0.25; }
            case 'gradient': return x / sc + 0.5;
            default: return 0.5 + 0.5 * Math.sin(x * Math.PI * 2);
          }
        })) };
      }
      case 'shape': {
        const size = p('size') * 0.5, fall = Math.max(0.01, p('falloff')) * 0.5;
        return { height: each((x, y) => { const dx = x - 0.5, dy = y - 0.5, d = s('kind') === 'square' ? Math.max(Math.abs(dx), Math.abs(dy)) : s('kind') === 'ridge' ? Math.abs(dy) * 1.0 + Math.max(0, Math.abs(dx) - size) : Math.hypot(dx, dy); return 1 - sstep(size - fall, size, d); }) };
      }
      case 'combine': {
        const A = ins.a ?? zero(), B = ins.b ?? zero(), Mk = ins.mask, amt = p('amount'), mode = s('mode');
        return { height: each((_x, _y, k) => {
          const a = A[k], b = B[k] * amt; let v: number;
          switch (mode) {
            case 'subtract': v = a - b; break; case 'multiply': v = a * (1 - amt + B[k] * amt); break; case 'min': v = Math.min(a, b); break; case 'max': v = Math.max(a, b); break;
            case 'screen': v = 1 - (1 - a) * (1 - b); break; case 'difference': v = Math.abs(a - b); break; case 'blend': v = a + (B[k] - a) * Math.min(1, amt); break; default: v = a + b;
          }
          return Mk ? a + (v - a) * Mk[k] : v;
        }) };
      }
      case 'warp': {
        const A = ins.height ?? zero(), st = p('strength'), sc = p('scale'), seed = p('seed') * 5 + 11;
        return { height: each((x, y) => sample(A, N, (x + noise2(seed, x * sc, y * sc) * st) * (N - 1), (y + noise2(seed + 1, x * sc, y * sc) * st) * (N - 1))) };
      }
      case 'adjust': {
        const A = ins.height ?? zero(), inv = s('invert') === 'yes', g = p('curve'), lo = p('min'), hi = p('max');
        const out = each((_x, _y, k) => { let v = A[k]; if (inv) v = 1 - v; v = Math.pow(clamp01(v), g) * p('scale') + p('offset'); return Math.max(lo, Math.min(hi, v)); });
        return { height: p('smooth') > 0 ? blur(out, N, Math.round(p('smooth'))) : out };
      }
      case 'terrace': {
        const A = ins.height ?? zero(), Mk = ins.mask, steps = p('steps'), st = p('strength'), wob = p('wobble'), mode = s('mode');
        return { height: each((x, y, k) => {
          const v = A[k], q = v * steps + noise2(91, x * 4, y * 4) * wob * 0.5, b = Math.floor(q), fr = q - b;
          const smooth = (b + sstep(0.7, 1, fr)) / steps, sharp = (b + (fr > 0.92 ? (fr - 0.92) / 0.08 : 0)) / steps;
          const t = mode === 'sharp' ? sharp : mode === 'mixed' ? (smooth + sharp) / 2 : smooth;
          return v + (t - v) * st * (Mk ? Mk[k] : 1);
        }) };
      }
      case 'erosion': {
        // The heights as metres on a grid of 1 m cells, so the simulation's slopes are as on real land of this size.
        const A = ins.height ?? zero(), h = new Float32Array(NN), scaleM = N * 0.35;
        for (let k = 0; k < NN; k++) h[k] = A[k] * scaleM;
        const r: ErosionResult | null = await erodeGrid(h, N, N, 1, { rain: p('rain'), strength: p('strength'), thermal: p('thermal'), talus: p('talus'), seed: p('seed'), materials: 0, debris: 0 }, (f) => progress(f));
        if (!r) throw new Error('stopped');
        const out = new Float32Array(NN); for (let k = 0; k < NN; k++) out[k] = h[k] / scaleM;
        // Shore: land near the shore level eases flat, as beaches are.
        const shore = p('shore'); if (shore > 0) for (let k = 0; k < NN; k++) { const d = out[k] - shore; if (Math.abs(d) < 0.06) out[k] = shore + d * sstep(0, 0.06, Math.abs(d)); }
        return { height: out, flow: r.flow, wear: r.wear, deposit: r.deposit };
      }
      case 'mask': {
        const A = ins.height ?? zero(), lo = p('low'), hi = p('high'), sf = Math.max(1e-3, p('softness')), inv = s('invert') === 'yes';
        const val = s('by') === 'slope' ? each((_x, _y, k) => { const i = k % N, j = (k / N) | 0, l = A[j * N + Math.max(0, i - 1)], r = A[j * N + Math.min(N - 1, i + 1)], u = A[Math.max(0, j - 1) * N + i], d = A[Math.min(N - 1, j + 1) * N + i]; return clamp01(Math.hypot(r - l, d - u) * N * 0.35 / 2 / 1.5); }) : A;
        return { mask: each((_x, _y, k) => { const v = val[k], m = sstep(lo - sf, lo + sf, v) * (1 - sstep(hi - sf, hi + sf, v)); return inv ? 1 - m : m; }) };
      }
      case 'colorize': {
        const A = ins.height ?? zero(), pal = LOOK_PALETTES[s('palette')] ?? LOOK_PALETTES.temperate, st = p('strength');
        const C = (h: string) => hexRGB(h), low = C(pal.low), mid = C(pal.mid), high = C(pal.high), rock = C(pal.rock), wear = C(pal.wear), flow = C(pal.flow), dep = C(pal.deposit), band = C(pal.band ?? pal.rock);
        const col = new Float32Array(NN * 3);
        for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
          const k = j * N + i, v = A[k], l = A[j * N + Math.max(0, i - 1)], r = A[j * N + Math.min(N - 1, i + 1)], u = A[Math.max(0, j - 1) * N + i], d = A[Math.min(N - 1, j + 1) * N + i];
          const slope = Math.hypot(r - l, d - u) * N * 0.35 / 2;
          const mix = (a: number[], b: number[], t: number) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
          let c = v < 0.5 ? mix(low, mid, v * 2) : mix(mid, high, (v - 0.5) * 2);
          if (pal.bands) c = mix(c, band, sstep(0.5, 0.85, 0.5 + 0.5 * Math.sin(v * 60)) * pal.bands);
          c = mix(c, rock, sstep(0.3, 0.65, slope));
          if (ins.wear) c = mix(c, wear, sstep(0.15, 0.8, ins.wear[k]) * 0.85);
          if (ins.deposit) c = mix(c, dep, sstep(0.3, 0.8, ins.deposit[k]) * 0.8);
          if (ins.flow) c = mix(c, flow, sstep(0.3, 0.85, ins.flow[k]) * 0.85);
          col[k * 3] = c[0]; col[k * 3 + 1] = c[1]; col[k * 3 + 2] = c[2];
        }
        void st;
        return { color: col };
      }
      case 'output': return { height: ins.height ?? zero(), ...(ins.color ? { color: ins.color } : {}), ...(ins.flow ? { flow: ins.flow } : {}), ...(ins.wear ? { wear: ins.wear } : {}), ...(ins.deposit ? { deposit: ins.deposit } : {}) };
    }
  }
}

/** The Output node's settings and the palette its Colorize uses (for applying a graph to a world). */
export function graphOutputInfo(g: TerrainGraph): { base: number; height: number; palette: string | null; strength: number } {
  const o = g.nodes.find((n) => n.type === 'output');
  const link = o && g.links.find((l) => l.to === o.id && l.toPort === 'color'), col = link && g.nodes.find((n) => n.id === link.from && n.type === 'colorize');
  return { base: Number(o?.params.base ?? 0), height: Number(o?.params.height ?? 150), palette: col ? String(col.params.palette) : null, strength: col ? Number(col.params.strength) : 0 };
}
