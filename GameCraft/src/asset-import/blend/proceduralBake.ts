// Bakes simple Blender procedural shader networks into textures, so procedural materials (tiles from Voronoi,
// grime from Noise, colour ramps, mixes, inversion, bump) look like they do in Blender instead of becoming one
// average colour. Evaluated on the CPU over UV space (Blender's default "Generated" coordinates map the
// object's box to 0..1, which matches UV-unwrapped planes and boxes).
import * as THREE from 'three';
import type { BlendFile, SView } from './blendFile';

type Link = { node: SView | null; sockIdent: string } | null;
export interface BakeCtx {
  bf: BlendFile;
  linkInto: (n: SView, ident: string) => Link;
  value: (n: SView, ident: string) => number[] | null;
}

const PROCEDURAL = /ShaderNodeTex(Voronoi|Noise)/;
const SUPPORTED = /ShaderNodeTex(Voronoi|Noise)|ShaderNodeValToRGB|ShaderNodeMix|ShaderNodeMixRGB|ShaderNodeInvert|NodeReroute|ShaderNodeRGB$|ShaderNodeValue$|ShaderNodeMath/;

/** True when a network only uses nodes the baker understands and contains at least one procedural texture. */
export function canBake(node: SView | null, ctx: BakeCtx, depth = 0, seen = new Set<number>()): { ok: boolean; procedural: boolean } {
  if (!node || depth > 24) return { ok: !!node || depth > 0, procedural: false };
  if (seen.has(node.offset)) return { ok: true, procedural: false };
  seen.add(node.offset);
  const id = node.str('idname');
  if (!SUPPORTED.test(id)) return { ok: false, procedural: false };
  let procedural = PROCEDURAL.test(id), ok = true;
  for (const s of ctx.bf.list(node.sub('inputs'))) {
    const l = ctx.linkInto(node, s.str('identifier'));
    if (!l?.node) continue;
    if (s.str('identifier') === 'Vector') return { ok: false, procedural }; // custom coordinates: not baked
    const r = canBake(l.node, ctx, depth + 1, seen);
    ok = ok && r.ok; procedural = procedural || r.procedural;
  }
  return { ok, procedural };
}

/**
 * The repeat count when a network is a regular tile grid: every Voronoi in it has no randomness (feature points on
 * the integer lattice, so the pattern repeats every cell) at one whole-number scale ≥ 2, and any Noise is fine
 * detail (≥ 8 × finer than a cell). Such a material is baked as ONE cell at full resolution and repeated: a drop
 * ceiling of 30 × 30 tiles baked whole into 512 px had 17 px tiles and 1 px seams that blurred away in game.
 */
export function tileOf(node: SView | null, ctx: BakeCtx): number | null {
  let tile: number | null = null, ok = true;
  const seen = new Set<number>(), nodes: SView[] = [];
  const walk = (n: SView | null, depth: number) => {
    if (!n || depth > 24 || seen.has(n.offset) || !ok) return;
    seen.add(n.offset); nodes.push(n);
    const id = n.str('idname'), sc = ctx.value(n, 'Scale')?.[0];
    if (id === 'ShaderNodeTexVoronoi') {
      const rnd = ctx.value(n, 'Randomness')?.[0] ?? 1;
      if (ctx.linkInto(n, 'Scale')?.node || ctx.linkInto(n, 'Randomness')?.node || rnd > 1e-4 || !sc || Math.abs(sc - Math.round(sc)) > 1e-3 || sc < 2) { ok = false; return; }
      if (tile !== null && tile !== Math.round(sc)) { ok = false; return; }
      tile = Math.round(sc);
    }
    for (const s of ctx.bf.list(n.sub('inputs'))) walk(ctx.linkInto(n, s.str('identifier'))?.node ?? null, depth + 1);
  };
  walk(node, 0);
  if (!ok || tile === null) return null;
  // Noise coarser than ~8 cells per noise period would visibly repeat: bake it whole instead.
  for (const n of nodes) {
    if (n.str('idname') === 'ShaderNodeTexNoise' && (ctx.value(n, 'Scale')?.[0] ?? 5) < (tile as number) * 8) return null;
  }
  return tile;
}

// ---- noise primitives (deterministic) ----
function hash3(x: number, y: number, z: number, k = 0) {
  let h = (x * 374761393 + y * 668265263 + z * 2147483647 + k * 1442695041) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
function grad(ix: number, iy: number, iz: number, x: number, y: number, z: number) {
  const h = Math.floor(hash3(ix, iy, iz, 7) * 12);
  const g = [[1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0], [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1], [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1]][h];
  return g[0] * (x - ix) + g[1] * (y - iy) + g[2] * (z - iz);
}
function perlin(x: number, y: number, z: number) {
  const x0 = Math.floor(x), y0 = Math.floor(y), z0 = Math.floor(z);
  const u = fade(x - x0), v = fade(y - y0), w = fade(z - z0);
  const L = (a: number, b: number, t: number) => a + (b - a) * t;
  return L(L(L(grad(x0, y0, z0, x, y, z), grad(x0 + 1, y0, z0, x, y, z), u), L(grad(x0, y0 + 1, z0, x, y, z), grad(x0 + 1, y0 + 1, z0, x, y, z), u), v),
    L(L(grad(x0, y0, z0 + 1, x, y, z), grad(x0 + 1, y0, z0 + 1, x, y, z), u), L(grad(x0, y0 + 1, z0 + 1, x, y, z), grad(x0 + 1, y0 + 1, z0 + 1, x, y, z), u), v), w);
}
/** Blender-like fBm noise in 0..1. Octaves finer than the bake resolution are replaced by their mean (no aliasing). */
function fbm(x: number, y: number, z: number, detail: number, rough: number, nyquist: number, freq: number) {
  let sum = 0, amp = 1, norm = 0, f = 1;
  const oct = Math.max(1, Math.min(8, Math.floor(detail) + 1));
  for (let o = 0; o < oct; o++) {
    if (freq * f < nyquist) sum += perlin(x * f, y * f, z * f) * amp;
    norm += amp; amp *= rough; f *= 2;
  }
  return 0.5 + 0.5 * (sum / norm) * 1.4;
}

export interface BakeResult { color: THREE.DataTexture; height?: Float32Array; size: number }

/** Bake the network feeding `link` (a Base Color input) to an RGBA texture. */
export function bakeNetwork(link: { node: SView; sockIdent: string }, ctx: BakeCtx, size = 512, heightLink?: { node: SView; sockIdent: string } | null, tile = 1): BakeResult {
  // A tiling network (see tileOf) is evaluated over one cell, 0..1/tile, and repeated `tile` times by the caller.
  const span = 1 / tile;
  const { bf } = ctx;
  // Links, socket values and node settings are read from the .blend once per bake, not once per pixel
  // (reading them per pixel made a 512² bake take ~20 s).
  // Per node: its id, settings and resolved inputs (a link to another node, or a constant), filled on first use.
  type NodeMemo = { id: string; ints: Map<string, number>; inputs: Map<string, { link: Link; val: number[] | null }> };
  const memo = new Map<number, NodeMemo>();
  const memoOf = (n: SView): NodeMemo => { let m = memo.get(n.offset); if (!m) { m = { id: n.str('idname'), ints: new Map(), inputs: new Map() }; memo.set(n.offset, m); } return m; };
  const input = (n: SView, ident: string) => {
    const m = memoOf(n); let r = m.inputs.get(ident);
    if (!r) { r = { link: ctx.linkInto(n, ident), val: ctx.value(n, ident) }; m.inputs.set(ident, r); }
    return r;
  };
  const value = (n: SView, ident: string) => input(n, ident).val;
  const idOf = (n: SView) => memoOf(n).id;
  const intOf = (n: SView, key: string, read: () => number) => { const m = memoOf(n); let v = m.ints.get(key); if (v === undefined) { v = read(); m.ints.set(key, v); } return v; };
  const nyquist = size / 2;
  const ramps = new Map<number, { pos: number; c: number[] }[] & { constant?: boolean }>();
  const voronoiSettings = new Map<number, { metric: number; feature: number; dims: number }>();
  const ramp = (node: SView) => {
    let r = ramps.get(node.offset);
    if (r) return r;
    const cb = node.get('storage', 'ColorBand'), data = cb?.sub('data'), st = bf.structByName.get('CBData');
    const list: { pos: number; c: number[] }[] & { constant?: boolean } = [];
    if (cb && data && st) {
      for (let i = 0; i < Math.max(1, cb.num('tot')); i++) {
        const o = data.offset + i * st.size;
        list.push({ c: [0, 4, 8, 12].map((k) => bf.dv.getFloat32(o + k, true)), pos: bf.dv.getFloat32(o + 16, true) });
      }
      list.sort((a, b) => a.pos - b.pos);
      list.constant = cb.num('ipotype') === 1;
    }
    ramps.set(node.offset, list);
    return list;
  };
  const num = (v: number[]) => (v.length >= 3 ? (v[0] + v[1] + v[2]) / 3 : v[0]);
  // Evaluate one output of a node at (u, v); colors are [r, g, b, a], scalars are repeated.
  const evalNode = (node: SView, out: string, u: number, v: number, depth = 0): number[] => {
    if (depth > 30) return [0, 0, 0, 1];
    const id = idOf(node);
    const one = (k: string): number[] | null => {
      const r = input(node, k);
      if (r.link?.node) return evalNode(r.link.node, r.link.sockIdent, u, v, depth + 1);
      const d = r.val;
      return d ? (d.length === 1 ? [d[0], d[0], d[0], 1] : d) : null;
    };
    const inp = (ident: string | string[], fallback: number[]): number[] => {
      if (typeof ident === 'string') return one(ident) ?? fallback;
      for (const k of ident) { const r = one(k); if (r) return r; }
      return fallback;
    };
    if (id === 'NodeReroute') return inp('Input', [0, 0, 0, 1]);
    if (id === 'ShaderNodeTexVoronoi') {
      const scale = num(inp('Scale', [5])), rnd = Math.max(0, Math.min(1, num(inp('Randomness', [1]))));
      // Node settings: distance metric (0 Euclidean, 1 Manhattan, 2 Chebyshev, 3 Minkowski) and feature
      // (0 F1, 1 F2, 2 Smooth F1, 3 Distance to edge). Chebyshev with no randomness = square tiles (drop ceilings).
      let vs = voronoiSettings.get(node.offset);
      if (!vs) { const st = node.get('storage', 'NodeTexVoronoi'); vs = { metric: st ? st.num('distance') : 0, feature: st ? st.num('feature') : 0, dims: st ? st.num('dimensions') : 3 }; voronoiSettings.set(node.offset, vs); }
      const { metric, feature, dims } = vs;
      const expo = Math.max(0.1, num(inp('Exponent', [0.5])));
      const dist = (dx: number, dy: number, dz: number) => {
        const ax = Math.abs(dx), ay = Math.abs(dy), az = Math.abs(dz);
        if (metric === 1) return ax + ay + az;
        if (metric === 2) return Math.max(ax, ay, az);
        if (metric === 3) return Math.pow(Math.pow(ax, expo) + Math.pow(ay, expo) + Math.pow(az, expo), 1 / expo);
        return Math.hypot(dx, dy, dz);
      };
      const x = u * scale, y = v * scale, z = 0;
      const cx = Math.floor(x), cy = Math.floor(y);
      // Nearest and second-nearest feature points (no allocations: this runs for every pixel).
      let d1 = Infinity, d2 = Infinity, b1x = 0, b1y = 0, b1z = 0, b2x = 0, b2y = 0, b2z = 0;
      const k0 = dims === 2 ? 0 : -1, k1 = dims === 2 ? 0 : 1;
      for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) for (let k = k0; k <= k1; k++) {
        const px = cx + i + hash3(cx + i, cy + j, k, 1) * rnd, py = cy + j + hash3(cx + i, cy + j, k, 2) * rnd, pz = dims === 2 ? 0 : k + hash3(cx + i, cy + j, k, 3) * rnd;
        const d = dist(px - x, py - y, pz - z);
        if (d < d1) { d2 = d1; b2x = b1x; b2y = b1y; b2z = b1z; d1 = d; b1x = cx + i; b1y = cy + j; b1z = k; }
        else if (d < d2) { d2 = d; b2x = cx + i; b2y = cy + j; b2z = k; }
      }
      const second = feature === 1;
      const [bx, by, bz] = second ? [b2x, b2y, b2z] : [b1x, b1y, b1z];
      if (out === 'Color') return [hash3(bx, by, bz, 11), hash3(bx, by, bz, 12), hash3(bx, by, bz, 13), 1];
      const d = feature === 3 ? (d2 - d1) / 2 : second ? d2 : d1; // feature 3: distance to the edge between cells
      return [d, d, d, 1];
    }
    if (id === 'ShaderNodeTexNoise') {
      const scale = num(inp('Scale', [5])), detail = num(inp('Detail', [2])), rough = num(inp('Roughness', [0.5]));
      const f = fbm(u * scale, v * scale, 0.37, detail, rough, nyquist, scale * span);
      if (out === 'Color') return [f, fbm(u * scale + 17.1, v * scale, 0.37, detail, rough, nyquist, scale), fbm(u * scale, v * scale + 31.7, 0.37, detail, rough, nyquist, scale), 1];
      return [f, f, f, 1];
    }
    if (id === 'ShaderNodeValToRGB') {
      const t = num(inp('Fac', [0.5]));
      const r = ramp(node);
      if (!r.length) return [t, t, t, 1];
      let c: number[];
      if (t <= r[0].pos) c = r[0].c;
      else if (t >= r[r.length - 1].pos) c = r[r.length - 1].c;
      else {
        let k = 0; while (k < r.length - 1 && r[k + 1].pos < t) k++;
        const a = r[k], b = r[k + 1];
        const f = r.constant ? 0 : (t - a.pos) / Math.max(1e-6, b.pos - a.pos);
        c = a.c.map((x, n) => x + (b.c[n] - x) * f);
      }
      return out === 'Alpha' ? [c[3], c[3], c[3], 1] : c;
    }
    if (id === 'ShaderNodeInvert') {
      const f = num(inp('Fac', [1])), c = inp('Color', [0, 0, 0, 1]);
      return [c[0] + (1 - 2 * c[0]) * f, c[1] + (1 - 2 * c[1]) * f, c[2] + (1 - 2 * c[2]) * f, 1];
    }
    if (id === 'ShaderNodeMix' || id === 'ShaderNodeMixRGB') {
      const blend = intOf(node, 'blend', () => { const st = node.get('storage', 'NodeShaderMix'); return st ? st.num('blend_type') : node.num('custom1'); });
      const f = Math.max(0, Math.min(1, num(inp(['Factor_Float', 'Fac'], [0.5]))));
      const A = inp(['A_Color', 'Color1'], [0, 0, 0, 1]), Bc = inp(['B_Color', 'Color2'], [1, 1, 1, 1]);
      return [0, 1, 2].map((n) => {
        const a = A[n], b = Bc[n];
        const r = blend === 2 ? a * b : blend === 1 ? a + b : blend === 3 ? a - b : blend === 4 ? 1 - (1 - a) * (1 - b) : blend === 6 ? Math.abs(a - b) : blend === 7 ? Math.min(a, b) : blend === 8 ? Math.max(a, b)
          : blend === 9 ? (a < 0.5 ? 2 * a * b : 1 - 2 * (1 - a) * (1 - b)) : b;
        return a + (r - a) * f;
      }).concat(1);
    }
    if (id === 'ShaderNodeMath') {
      const a = num(inp(['Value', 'Value_001'].slice(0, 1), [0.5])), b = num(inp('Value_001', [0.5]));
      const op = intOf(node, 'op', () => node.num('custom1'));
      const r = op === 0 ? a + b : op === 1 ? a - b : op === 2 ? a * b : op === 3 ? a / (b || 1e-6) : op === 4 ? Math.sin(a) : op === 18 ? Math.pow(Math.max(0, a), b) : op === 20 ? Math.min(a, b) : op === 21 ? Math.max(a, b) : a;
      return [r, r, r, 1];
    }
    if (id === 'ShaderNodeRGB' || id === 'ShaderNodeValue') return value(node, 'Color') ?? [0.5, 0.5, 0.5, 1];
    return [0.5, 0.5, 0.5, 1];
  };

  const data = new Uint8Array(size * size * 4);
  const height = heightLink?.node ? new Float32Array(size * size) : undefined;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = ((x + 0.5) / size) * span, v = ((y + 0.5) / size) * span;
    const c = evalNode(link.node!, link.sockIdent, u, v);
    const o = (y * size + x) * 4;
    // Ramp colors are linear; store sRGB so the texture can be tagged sRGB like image textures.
    const s = (l: number) => Math.round(255 * Math.max(0, Math.min(1, l <= 0.0031308 ? l * 12.92 : 1.055 * Math.pow(l, 1 / 2.4) - 0.055)));
    data[o] = s(c[0]); data[o + 1] = s(c[1]); data[o + 2] = s(c[2]); data[o + 3] = 255;
    if (height) { const h = evalNode(heightLink!.node!, heightLink!.sockIdent, u, v); height[y * size + x] = (h[0] + h[1] + h[2]) / 3; }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace; tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.generateMipmaps = true; tex.flipY = false;
  tex.needsUpdate = true;
  return { color: tex, height, size };
}

/** Tangent-space normal map from a height field (Blender Bump node look). */
export function normalFromHeight(h: Float32Array, size: number, strength: number): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  const at = (x: number, y: number) => h[((y + size) % size) * size + ((x + size) % size)];
  const k = strength * 6;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = (at(x + 1, y) - at(x - 1, y)) * k, dy = (at(x, y + 1) - at(x, y - 1)) * k;
    const len = Math.hypot(dx, dy, 1);
    const o = (y * size + x) * 4;
    data[o] = Math.round(127.5 * (-dx / len + 1)); data[o + 1] = Math.round(127.5 * (-dy / len + 1)); data[o + 2] = Math.round(127.5 * (1 / len + 1)); data[o + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.colorSpace = THREE.NoColorSpace; tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.flipY = false;
  tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}
