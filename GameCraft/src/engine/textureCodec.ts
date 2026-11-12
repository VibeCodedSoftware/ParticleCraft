// GPU texture block encoders: BC1 and BC3 (desktop graphics cards), ETC2 and ETC2+EAC (phones and tablets). Pictures in
// these formats stay compressed in graphics memory, 4 to 8 times smaller than plain RGBA. Plain code with no browser
// parts: it runs in a worker (textureCodecWorker.ts) so play never stalls. Fast encoders, not archival ones: lossy, so
// it is an option, and normal maps and pixel art are never put through it.

export type BlockFormat = 'bc1' | 'bc3' | 'etc2' | 'etc2a';
export interface EncodedLevel { data: Uint8Array; width: number; height: number }

export const blockBytes = (f: BlockFormat) => (f === 'bc1' || f === 'etc2' ? 8 : 16);

const to565 = (r: number, g: number, b: number) => (((r * 31 + 127.5) / 255) << 11) | (((g * 63 + 127.5) / 255) << 5) | ((b * 31 + 127.5) / 255);
const from565 = (c: number, out: number[], at: number) => {
  const r = (c >> 11) & 31, g = (c >> 5) & 63, b = c & 31;
  out[at] = (r << 3) | (r >> 2); out[at + 1] = (g << 2) | (g >> 4); out[at + 2] = (b << 3) | (b >> 2);
};

const palette = new Array(12).fill(0);
/** One 4×4 colour block, 8 bytes. `px` holds 16 RGBA pixels. */
function encodeColorBlock(px: Uint8ClampedArray | number[], out: Uint8Array, at: number) {
  // The colours of a block mostly lie along a line: find it (principal axis, a few power iterations).
  let mr = 0, mg = 0, mb = 0;
  for (let i = 0; i < 16; i++) { mr += px[i * 4]; mg += px[i * 4 + 1]; mb += px[i * 4 + 2]; }
  mr /= 16; mg /= 16; mb /= 16;
  let rr = 0, rg = 0, rb = 0, gg = 0, gb = 0, bb = 0;
  for (let i = 0; i < 16; i++) {
    const r = px[i * 4] - mr, g = px[i * 4 + 1] - mg, b = px[i * 4 + 2] - mb;
    rr += r * r; rg += r * g; rb += r * b; gg += g * g; gb += g * b; bb += b * b;
  }
  let ax = 1, ay = 1, az = 1;
  for (let k = 0; k < 4; k++) {
    const x = rr * ax + rg * ay + rb * az, y = rg * ax + gg * ay + gb * az, z = rb * ax + gb * ay + bb * az;
    const m = Math.max(Math.abs(x), Math.abs(y), Math.abs(z));
    if (m < 1e-6) break;
    ax = x / m; ay = y / m; az = z / m;
  }
  let lo = Infinity, hi = -Infinity, loI = 0, hiI = 0;
  for (let i = 0; i < 16; i++) {
    const d = px[i * 4] * ax + px[i * 4 + 1] * ay + px[i * 4 + 2] * az;
    if (d < lo) { lo = d; loI = i; }
    if (d > hi) { hi = d; hiI = i; }
  }
  let c0 = to565(px[hiI * 4], px[hiI * 4 + 1], px[hiI * 4 + 2]), c1 = to565(px[loI * 4], px[loI * 4 + 1], px[loI * 4 + 2]);
  if (c0 < c1) { const t = c0; c0 = c1; c1 = t; }
  let indices = 0;
  if (c0 !== c1) {
    from565(c0, palette, 0); from565(c1, palette, 3);
    for (let k = 0; k < 3; k++) { palette[6 + k] = (2 * palette[k] + palette[3 + k] + 1) / 3 | 0; palette[9 + k] = (palette[k] + 2 * palette[3 + k] + 1) / 3 | 0; }
    for (let i = 15; i >= 0; i--) {
      let best = 0, bestD = Infinity;
      for (let n = 0; n < 4; n++) {
        const dr = px[i * 4] - palette[n * 3], dg = px[i * 4 + 1] - palette[n * 3 + 1], db = px[i * 4 + 2] - palette[n * 3 + 2], d = dr * dr + dg * dg + db * db;
        if (d < bestD) { bestD = d; best = n; }
      }
      indices = (indices * 4 + best) >>> 0;
    }
  }
  out[at] = c0 & 255; out[at + 1] = c0 >> 8; out[at + 2] = c1 & 255; out[at + 3] = c1 >> 8;
  out[at + 4] = indices & 255; out[at + 5] = (indices >>> 8) & 255; out[at + 6] = (indices >>> 16) & 255; out[at + 7] = (indices >>> 24) & 255;
}

/** BC3's alpha block, 8 bytes. */
function encodeAlphaBlock(px: Uint8ClampedArray | number[], out: Uint8Array, at: number) {
  let a0 = 0, a1 = 255;
  for (let i = 0; i < 16; i++) { const a = px[i * 4 + 3]; if (a > a0) a0 = a; if (a < a1) a1 = a; }
  out[at] = a0; out[at + 1] = a1;
  for (let k = 2; k < 8; k++) out[at + k] = 0;
  if (a0 === a1) return;
  const pal = [a0, a1, (6 * a0 + a1) / 7, (5 * a0 + 2 * a1) / 7, (4 * a0 + 3 * a1) / 7, (3 * a0 + 4 * a1) / 7, (2 * a0 + 5 * a1) / 7, (a0 + 6 * a1) / 7];
  let bit = 0;
  for (let i = 0; i < 16; i++) {
    let best = 0, bestD = Infinity;
    for (let n = 0; n < 8; n++) { const d = Math.abs(px[i * 4 + 3] - pal[n]); if (d < bestD) { bestD = d; best = n; } }
    for (let b = 0; b < 3; b++, bit++) if (best & (1 << b)) out[at + 2 + (bit >> 3)] |= 1 << (bit & 7);
  }
}

// ---- ETC2 (its base mode, which every ETC2 decoder reads; individual or differential colours per half block)
const ETC_MODS = [[2, 8], [5, 17], [9, 29], [13, 42], [18, 60], [24, 80], [33, 106], [47, 183]];
/** Which half each of a block's pixels is in, as x*4+y lists. */
const ETC_SIDE = [[[0, 1, 2, 3, 4, 5, 6, 7], [8, 9, 10, 11, 12, 13, 14, 15]], [[0, 4, 8, 12, 1, 5, 9, 13], [2, 6, 10, 14, 3, 7, 11, 15]]];
const exp4 = (v: number) => v * 17, exp5 = (v: number) => (v << 3) | (v >> 2);
const clamp8 = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);

function etcHalf(px: Uint8ClampedArray | number[], list: number[], base: number[]): { table: number; err: number; idx: number[] } {
  let best = { table: 0, err: Infinity, idx: [] as number[] };
  for (let table = 0; table < 8; table++) {
    const [a, b] = ETC_MODS[table], mods = [a, b, -a, -b];
    let err = 0; const idx: number[] = [];
    for (const k of list) {
      const x = k >> 2, y = k & 3, p = (y * 4 + x) * 4;
      let bd = Infinity, bi = 0;
      for (let m = 0; m < 4; m++) {
        const dr = px[p] - clamp8(base[0] + mods[m]), dg = px[p + 1] - clamp8(base[1] + mods[m]), db = px[p + 2] - clamp8(base[2] + mods[m]), d = dr * dr + dg * dg + db * db;
        if (d < bd) { bd = d; bi = m; }
      }
      err += bd; idx.push(bi);
      if (err >= best.err) break;
    }
    if (err < best.err) best = { table, err, idx };
  }
  return best;
}

function encodeEtcBlock(px: Uint8ClampedArray | number[], out: Uint8Array, at: number) {
  let bestErr = Infinity;
  for (let flip = 0; flip < 2; flip++) {
    const sides = ETC_SIDE[flip], avg = sides.map((list) => {
      let r = 0, g = 0, b = 0;
      for (const k of list) { const x = k >> 2, y = k & 3, p = (y * 4 + x) * 4; r += px[p]; g += px[p + 1]; b += px[p + 2]; }
      return [r / 8, g / 8, b / 8];
    });
    const q5 = avg.map((c) => c.map((v) => Math.round((v * 31) / 255)));
    const d = [q5[1][0] - q5[0][0], q5[1][1] - q5[0][1], q5[1][2] - q5[0][2]];
    const differential = d.every((v) => v >= -4 && v <= 3);
    const q4 = avg.map((c) => c.map((v) => Math.round((v * 15) / 255)));
    const bases = differential ? q5.map((c) => c.map(exp5)) : q4.map((c) => c.map(exp4));
    const h0 = etcHalf(px, sides[0], bases[0]), h1 = etcHalf(px, sides[1], bases[1]);
    const err = h0.err + h1.err;
    if (err >= bestErr) continue;
    bestErr = err;
    if (differential) for (let c = 0; c < 3; c++) out[at + c] = (q5[0][c] << 3) | (d[c] & 7);
    else for (let c = 0; c < 3; c++) out[at + c] = (q4[0][c] << 4) | q4[1][c];
    out[at + 3] = (h0.table << 5) | (h1.table << 2) | (differential ? 2 : 0) | flip;
    let msb = 0, lsb = 0;
    const put = (k: number, m: number) => {
      // Index in the block: 0 = +small, 1 = +large, 2 = -small, 3 = -large, as the two bits 00, 01, 10, 11.
      if (m & 1) lsb |= 1 << k;
      if (m & 2) msb |= 1 << k;
    };
    sides[0].forEach((k, n) => put(k, h0.idx[n]));
    sides[1].forEach((k, n) => put(k, h1.idx[n]));
    out[at + 4] = (msb >> 8) & 255; out[at + 5] = msb & 255; out[at + 6] = (lsb >> 8) & 255; out[at + 7] = lsb & 255;
  }
}

const EAC = [[-3, -6, -9, -15, 2, 5, 8, 14], [-3, -7, -10, -13, 2, 6, 9, 12], [-2, -5, -8, -13, 1, 4, 7, 12], [-2, -4, -6, -13, 1, 3, 5, 12], [-3, -6, -8, -12, 2, 5, 7, 11], [-3, -7, -9, -11, 2, 6, 8, 10], [-4, -7, -8, -11, 3, 6, 7, 10], [-3, -5, -8, -11, 2, 4, 7, 10], [-2, -6, -8, -10, 1, 5, 7, 9], [-2, -5, -8, -10, 1, 4, 7, 9], [-2, -4, -8, -10, 1, 3, 7, 9], [-2, -5, -7, -10, 1, 4, 6, 9], [-3, -4, -7, -10, 2, 3, 6, 9], [-1, -2, -3, -10, 0, 1, 2, 9], [-4, -6, -8, -9, 3, 5, 7, 8], [-3, -5, -7, -9, 2, 4, 6, 8]];
function encodeEacBlock(px: Uint8ClampedArray | number[], out: Uint8Array, at: number) {
  let lo = 255, hi = 0;
  for (let i = 0; i < 16; i++) { const a = px[i * 4 + 3]; if (a < lo) lo = a; if (a > hi) hi = a; }
  const base = (lo + hi + 1) >> 1;
  let bestErr = Infinity, bestT = 0, bestM = 1, bestIdx: number[] = [];
  const mults = hi === lo ? [1] : [Math.max(1, Math.ceil((hi - lo) / 22)), Math.max(1, Math.ceil((hi - lo) / 26)), Math.min(15, Math.ceil((hi - lo) / 18) || 1)];
  for (const m of mults) for (let t = 0; t < 16; t++) {
    let err = 0; const idx: number[] = [];
    for (let x = 0; x < 4; x++) for (let y = 0; y < 4; y++) {
      const a = px[(y * 4 + x) * 4 + 3];
      let bd = Infinity, bi = 0;
      for (let n = 0; n < 8; n++) { const d = Math.abs(a - clamp8(base + EAC[t][n] * m)); if (d < bd) { bd = d; bi = n; } }
      err += bd * bd; idx.push(bi);
    }
    if (err < bestErr) { bestErr = err; bestT = t; bestM = m; bestIdx = idx; if (err === 0) break; }
  }
  out[at] = base; out[at + 1] = (bestM << 4) | bestT;
  let v0 = 0, v1 = 0; // 48 index bits, first pixel in the top bits
  for (let i = 0; i < 16; i++) { if (i < 8) v0 = (v0 * 8 + bestIdx[i]) >>> 0; else v1 = (v1 * 8 + bestIdx[i]) >>> 0; }
  out[at + 2] = (v0 >>> 16) & 255; out[at + 3] = (v0 >>> 8) & 255; out[at + 4] = v0 & 255;
  out[at + 5] = (v1 >>> 16) & 255; out[at + 6] = (v1 >>> 8) & 255; out[at + 7] = v1 & 255;
}

/** One picture to blocks. Rows run from the first texture row up; a level smaller than a block repeats its edge pixels. */
export function encodeLevel(rgba: Uint8ClampedArray, width: number, height: number, format: BlockFormat): Uint8Array {
  const bw = Math.ceil(width / 4), bh = Math.ceil(height / 4), size = blockBytes(format);
  const out = new Uint8Array(bw * bh * size), px = new Uint8ClampedArray(64);
  for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) {
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
      const sx = Math.min(width - 1, bx * 4 + x), sy = Math.min(height - 1, by * 4 + y), s = (sy * width + sx) * 4, d = (y * 4 + x) * 4;
      px[d] = rgba[s]; px[d + 1] = rgba[s + 1]; px[d + 2] = rgba[s + 2]; px[d + 3] = rgba[s + 3];
    }
    const at = (by * bw + bx) * size;
    if (format === 'bc1') encodeColorBlock(px, out, at);
    else if (format === 'bc3') { encodeAlphaBlock(px, out, at); encodeColorBlock(px, out, at + 8); }
    else if (format === 'etc2') encodeEtcBlock(px, out, at);
    else { encodeEacBlock(px, out, at); encodeEtcBlock(px, out, at + 8); }
  }
  return out;
}

/** Half size, averaging four pixels (weighted by alpha, so see-through pixels don't darken edges). */
export function halfImage(rgba: Uint8ClampedArray, w: number, h: number): { data: Uint8ClampedArray; width: number; height: number } {
  const nw = Math.max(1, w >> 1), nh = Math.max(1, h >> 1), out = new Uint8ClampedArray(nw * nh * 4);
  for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    const xs = w > 1 ? [x * 2, x * 2 + 1] : [0], ys = h > 1 ? [y * 2, y * 2 + 1] : [0];
    for (const sy of ys) for (const sx of xs) {
      const p = (sy * w + sx) * 4, pa = rgba[p + 3];
      r += rgba[p] * pa; g += rgba[p + 1] * pa; b += rgba[p + 2] * pa; a += pa;
    }
    const d = (y * nw + x) * 4, n = xs.length * ys.length;
    if (a > 0) { out[d] = r / a; out[d + 1] = g / a; out[d + 2] = b / a; }
    else { const p = (ys[0] * w + xs[0]) * 4; out[d] = rgba[p]; out[d + 1] = rgba[p + 1]; out[d + 2] = rgba[p + 2]; }
    out[d + 3] = a / n;
  }
  return { data: out, width: nw, height: nh };
}

export function hasAlpha(rgba: Uint8ClampedArray): boolean {
  for (let i = 3; i < rgba.length; i += 4) if (rgba[i] < 250) return true;
  return false;
}

/** The whole mipmap chain, largest first. `wantAlpha`: the format to use when the picture is see-through. */
export function encodeChain(rgba: Uint8ClampedArray, width: number, height: number, family: 'bc' | 'etc'): { format: BlockFormat; levels: EncodedLevel[] } {
  const format: BlockFormat = hasAlpha(rgba) ? (family === 'bc' ? 'bc3' : 'etc2a') : family === 'bc' ? 'bc1' : 'etc2';
  const levels: EncodedLevel[] = [];
  let cur = { data: rgba, width, height };
  for (;;) {
    levels.push({ data: encodeLevel(cur.data, cur.width, cur.height, format), width: cur.width, height: cur.height });
    if (cur.width === 1 && cur.height === 1) break;
    cur = halfImage(cur.data, cur.width, cur.height);
  }
  return { format, levels };
}

/** Bytes a chain takes in graphics memory, from a level down. */
export function chainBytes(levels: EncodedLevel[], from = 0): number {
  let n = 0;
  for (let i = from; i < levels.length; i++) n += levels[i].data.length;
  return n;
}
