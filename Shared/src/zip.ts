// Minimal ZIP writer (stored, no compression - models, images and audio are already compressed) used to export
// games. Produces a standard archive that Windows Explorer, macOS and every unzip tool open.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export class ZipWriter {
  private parts: Uint8Array[] = [];
  private central: Uint8Array[] = [];
  private offset = 0;
  private names = new Set<string>();

  get size() { return this.offset; }
  has(name: string) { return this.names.has(name); }

  add(name: string, data: Uint8Array | string) {
    const path = name.replace(/\\/g, '/').replace(/^\/+/, '');
    if (this.names.has(path)) return;
    this.names.add(path);
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
    const fname = new TextEncoder().encode(path);
    const crc = crc32(bytes);
    const d = new Date();
    const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(6, 0x0800, true); // UTF-8 names
    local.setUint16(8, 0, true); local.setUint16(10, time, true); local.setUint16(12, date, true);
    local.setUint32(14, crc, true); local.setUint32(18, bytes.length, true); local.setUint32(22, bytes.length, true);
    local.setUint16(26, fname.length, true); local.setUint16(28, 0, true);
    const cen = new DataView(new ArrayBuffer(46));
    cen.setUint32(0, 0x02014b50, true); cen.setUint16(4, 20, true); cen.setUint16(6, 20, true); cen.setUint16(8, 0x0800, true);
    cen.setUint16(10, 0, true); cen.setUint16(12, time, true); cen.setUint16(14, date, true);
    cen.setUint32(16, crc, true); cen.setUint32(20, bytes.length, true); cen.setUint32(24, bytes.length, true);
    cen.setUint16(28, fname.length, true); cen.setUint32(42, this.offset, true);
    this.parts.push(new Uint8Array(local.buffer), fname, bytes);
    this.central.push(new Uint8Array(cen.buffer), fname);
    this.offset += 30 + fname.length + bytes.length;
  }

  finish(): Blob {
    const cenSize = this.central.reduce((a, p) => a + p.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, this.names.size, true); end.setUint16(10, this.names.size, true);
    end.setUint32(12, cenSize, true); end.setUint32(16, this.offset, true);
    return new Blob([...this.parts, ...this.central, new Uint8Array(end.buffer)] as BlobPart[], { type: 'application/zip' });
  }
}
