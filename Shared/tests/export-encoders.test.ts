// GIF and ZIP writers used by ParticleCraft's exports: the GIF decodes back to the same pixels, the ZIP lists its files.
import { describe, expect, it } from 'vitest';
import { encodeGif, lzw, quantize } from '../src/export/gif';
import { crc32, makeZip } from '../src/export/zip';

/** Reference GIF LZW decoder (for the test only). */
function unlzw(data: Uint8Array, minCode: number, count: number): number[] {
  const bytes: number[] = []; let p = 0;
  while (data[p]) { const n = data[p++]; for (let k = 0; k < n; k++) bytes.push(data[p++]); }
  const clear = 1 << minCode, eoi = clear + 1;
  let size = minCode + 1, dict: number[][] = [], prev: number[] | null = null, bit = 0;
  const reset = () => { dict = []; for (let i = 0; i < clear; i++) dict[i] = [i]; dict[clear] = []; dict[eoi] = []; size = minCode + 1; prev = null; };
  reset();
  const out: number[] = [];
  while (out.length < count) {
    let code = 0; for (let k = 0; k < size; k++) { code |= ((bytes[(bit >> 3)] >> (bit & 7)) & 1) << k; bit++; }
    if (code === clear) { reset(); continue; }
    if (code === eoi) break;
    let entry: number[];
    if (dict[code]) entry = dict[code]; else entry = [...prev!, prev![0]];
    out.push(...entry);
    if (prev) dict.push([...prev, entry[0]]);
    prev = entry;
    if (dict.length === (1 << size) && size < 12) size++;
  }
  return out;
}

describe('export encoders', () => {
  it('GIF LZW round-trips long and repetitive index streams', () => {
    for (const make of [(i: number) => i % 7, (i: number) => (i * 7919) % 200, () => 3]) {
      const idx = Uint8Array.from({ length: 30000 }, (_, i) => make(i));
      expect(unlzw(lzw(idx, 8), 8, idx.length)).toEqual([...idx]);
    }
  });
  it('quantizes to the used colours with a transparent index', () => {
    const px = new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 255, 255, 0, 0, 0, 0, 255, 0, 0, 255]);
    const q = quantize(px, { colors: 256, transparent: true, threshold: 128, background: [0, 0, 0] });
    expect(q.palette.length / 3).toBe(3); // red, blue + transparent
    expect(q.index[2]).toBe(q.transparentIndex);
    expect(q.index[0]).toBe(q.index[3]);
    expect(q.palette.slice(q.index[0] * 3, q.index[0] * 3 + 3)).toEqual([255, 0, 0]);
  });
  it('writes a looping, transparent GIF89a', () => {
    const f = (c: number) => ({ rgba: new Uint8ClampedArray(4 * 4 * 4).map((_, i) => (i % 4 === 3 ? (i < 32 ? 255 : 0) : c)), delayMs: 50 });
    const g = encodeGif([f(200), f(40)], { width: 4, height: 4, loop: true, transparent: true });
    expect(String.fromCharCode(...g.slice(0, 6))).toBe('GIF89a');
    expect(g[g.length - 1]).toBe(0x3b);
    expect(new TextDecoder().decode(g).includes('NETSCAPE2.0')).toBe(true);
    expect([...g].filter((b, i) => b === 0x21 && g[i + 1] === 0xf9).length).toBe(2); // one control block per frame
  });
  it('makes a ZIP with the files and their checksums', () => {
    const z = makeZip([{ name: 'frame_0001.png', data: new Uint8Array([1, 2, 3]) }, { name: 'frame_0002.png', data: new Uint8Array([4]) }]);
    const dv = new DataView(z.buffer);
    expect(dv.getUint32(0, true)).toBe(0x04034b50);
    const end = z.length - 22;
    expect(dv.getUint32(end, true)).toBe(0x06054b50);
    expect(dv.getUint16(end + 10, true)).toBe(2);
    expect(dv.getUint32(14, true)).toBe(crc32(new Uint8Array([1, 2, 3])));
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });
});
