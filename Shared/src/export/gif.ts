// Animated GIF writer (GIF89a): each frame gets its own colour table (up to 256 colours, the most used ones), an
// optional transparent colour, a delay, and the file can loop forever. Partial transparency is not possible in a
// GIF: pixels are either drawn (opacity >= the threshold) or transparent; without transparency frames are first
// laid over the background colour.

export interface GifFrame { rgba: Uint8ClampedArray | Uint8Array; delayMs: number }
export interface GifOptions { width: number; height: number; loop: boolean; transparent: boolean; background?: [number, number, number]; colors?: number; alphaThreshold?: number }

class ByteOut {
  buf = new Uint8Array(1 << 16); n = 0;
  byte(b: number) { if (this.n >= this.buf.length) { const nb = new Uint8Array(this.buf.length * 2); nb.set(this.buf); this.buf = nb; } this.buf[this.n++] = b & 255; }
  word(w: number) { this.byte(w); this.byte(w >> 8); }
  bytes(a: ArrayLike<number>) { for (let i = 0; i < a.length; i++) this.byte(a[i]); }
  str(s: string) { for (let i = 0; i < s.length; i++) this.byte(s.charCodeAt(i)); }
  done() { return this.buf.slice(0, this.n); }
}

/** Palette of the most used colours (5 bits per channel buckets, averaged) and each pixel's index into it. */
export function quantize(rgba: ArrayLike<number>, opts: { colors: number; transparent: boolean; threshold: number; background: [number, number, number] }) {
  const n = rgba.length / 4, max = Math.max(2, Math.min(256, opts.colors)) - (opts.transparent ? 1 : 0);
  const count = new Uint32Array(32768), sr = new Float64Array(32768), sg = new Float64Array(32768), sb = new Float64Array(32768);
  const keys = new Int32Array(n);
  const [br, bg, bb] = opts.background;
  for (let i = 0; i < n; i++) {
    let r = rgba[i * 4], g = rgba[i * 4 + 1], b = rgba[i * 4 + 2]; const a = rgba[i * 4 + 3];
    if (opts.transparent) { if (a < opts.threshold) { keys[i] = -1; continue; } }
    else { const f = a / 255; r = r * f + br * (1 - f); g = g * f + bg * (1 - f); b = b * f + bb * (1 - f); }
    const k = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    keys[i] = k; count[k]++; sr[k] += r; sg[k] += g; sb[k] += b;
  }
  const used: number[] = [];
  for (let k = 0; k < 32768; k++) if (count[k]) used.push(k);
  used.sort((a, b) => count[b] - count[a]);
  const top = used.slice(0, max);
  const pal: number[] = [];
  for (const k of top) pal.push(Math.round(sr[k] / count[k]), Math.round(sg[k] / count[k]), Math.round(sb[k] / count[k]));
  if (!pal.length) pal.push(0, 0, 0);
  const tIndex = opts.transparent ? pal.length / 3 : -1;
  if (opts.transparent) pal.push(0, 0, 0);
  // Each bucket maps to its nearest palette colour (cached per bucket).
  const map = new Int16Array(32768).fill(-1);
  const nearest = (k: number) => {
    const r = ((k >> 10) & 31) * 8 + 4, g = ((k >> 5) & 31) * 8 + 4, b = (k & 31) * 8 + 4;
    let best = 0, bd = Infinity;
    for (let j = 0; j < top.length; j++) { const dr = pal[j * 3] - r, dg = pal[j * 3 + 1] - g, db = pal[j * 3 + 2] - b, d = dr * dr * 2 + dg * dg * 3 + db * db; if (d < bd) { bd = d; best = j; } }
    return best;
  };
  const index = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const k = keys[i];
    if (k < 0) { index[i] = tIndex; continue; }
    let m = map[k]; if (m < 0) { m = nearest(k); map[k] = m; }
    index[i] = m;
  }
  return { palette: pal, index, transparentIndex: tIndex };
}

/** LZW-compress colour indices for GIF (variable code size, clear code when the table is full). */
export function lzw(index: Uint8Array, minCodeSize: number): Uint8Array {
  const out = new ByteOut();
  const clear = 1 << minCodeSize, eoi = clear + 1;
  let codeSize = minCodeSize + 1, next = eoi + 1;
  let dict = new Map<number, number>();
  let cur = 0, bits = 0;
  const block: number[] = [];
  const emit = (code: number) => {
    cur |= code << bits; bits += codeSize;
    while (bits >= 8) { block.push(cur & 255); cur >>>= 8; bits -= 8; if (block.length === 255) { out.byte(255); out.bytes(block); block.length = 0; } }
  };
  emit(clear);
  let prefix = index.length ? index[0] : 0;
  for (let i = 1; i < index.length; i++) {
    const c = index[i], key = (prefix << 8) | c;
    const hit = dict.get(key);
    if (hit !== undefined) { prefix = hit; continue; }
    emit(prefix);
    if (next < 4096) { dict.set(key, next++); if (next > (1 << codeSize) && codeSize < 12) codeSize++; }
    else { emit(clear); dict = new Map(); codeSize = minCodeSize + 1; next = eoi + 1; }
    prefix = c;
  }
  if (index.length) emit(prefix);
  emit(eoi);
  if (bits > 0) block.push(cur & 255);
  if (block.length) { out.byte(block.length); out.bytes(block); }
  out.byte(0);
  return out.done();
}

export function encodeGif(frames: GifFrame[], o: GifOptions): Uint8Array {
  const out = new ByteOut();
  out.str('GIF89a'); out.word(o.width); out.word(o.height);
  out.byte(0x70); out.byte(0); out.byte(0); // no global colour table, 8-bit colour resolution
  if (o.loop) { out.byte(0x21); out.byte(0xff); out.byte(11); out.str('NETSCAPE2.0'); out.byte(3); out.byte(1); out.word(0); out.byte(0); }
  for (const f of frames) {
    const q = quantize(f.rgba, { colors: o.colors ?? 256, transparent: o.transparent, threshold: o.alphaThreshold ?? 128, background: o.background ?? [0, 0, 0] });
    // Graphic control: delay, transparency, and "restore to background" so transparent frames do not pile up.
    out.byte(0x21); out.byte(0xf9); out.byte(4);
    out.byte((o.transparent ? 2 << 2 : 1 << 2) | (o.transparent ? 1 : 0));
    out.word(Math.max(2, Math.round(f.delayMs / 10)));
    out.byte(o.transparent ? q.transparentIndex : 0); out.byte(0);
    // Image with a local colour table of 2^(k+1) entries.
    let k = 0; while ((2 << k) < q.palette.length / 3) k++;
    out.byte(0x2c); out.word(0); out.word(0); out.word(o.width); out.word(o.height); out.byte(0x80 | k);
    for (let i = 0; i < (2 << k); i++) { out.byte(q.palette[i * 3] ?? 0); out.byte(q.palette[i * 3 + 1] ?? 0); out.byte(q.palette[i * 3 + 2] ?? 0); }
    const minCode = Math.max(2, k + 1);
    out.byte(minCode);
    out.bytes(lzw(q.index, minCode));
  }
  out.byte(0x3b);
  return out.done();
}
