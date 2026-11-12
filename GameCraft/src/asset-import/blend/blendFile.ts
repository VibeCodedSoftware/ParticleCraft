// Native .blend reader (no Blender required). Reads the file-block list and the SDNA type catalogue that
// every .blend embeds, then exposes typed struct access by field name. Supports the classic header
// ("BLENDER-v306", 24-byte block headers, Blender 2.8 – 4.x) and the Blender 5.0 header
// ("BLENDER17-01v0500", 32-byte block headers with 64-bit lengths). Little-endian, 64-bit pointers.
// zstd-compressed files are decompressed first (Blender's "Compress" save option).
import { decompress as zstdDecompress } from 'fzstd';

/** Pointers are exact 64-bit values (Blender 5 writes hashed ids that do not fit a JS number). 0n = null. */
export type Ptr = bigint;
/** `owner` is the index of the ID block a DATA block was written after. Blender 5 only guarantees pointer
 *  uniqueness inside one ID's data, so pointers are resolved within the owner's scope first. */
export interface BlendBlock { code: string; len: number; old: Ptr; sdna: number; nr: number; offset: number; idx: number; owner: number }
export interface DnaField { name: string; raw: string; type: string; offset: number; size: number; isPtr: boolean; dims: number[]; count: number }
export interface DnaStruct { name: string; size: number; fields: Map<string, DnaField>; list: DnaField[] }

const PRIM: Record<string, number> = { char: 1, uchar: 1, int8_t: 1, uint8_t: 1, short: 2, ushort: 2, int: 4, uint: 4, float: 4, double: 8, int64_t: 8, uint64_t: 8, long: 8, ulong: 8, int16_t: 2, uint16_t: 2, int32_t: 4, uint32_t: 4, bool: 1 };

export class BlendFile {
  dv: DataView;
  bytes: Uint8Array;
  version = 0;
  ptrSize = 8;
  blocks: BlendBlock[] = [];
  byAddr = new Map<Ptr, BlendBlock>();
  private idByAddr = new Map<Ptr, BlendBlock>();
  private scoped = new Map<number, Map<Ptr, BlendBlock>>();

  /** Resolve a pointer: inside the owning ID's data first, then ID blocks, then anything. */
  resolve(ptr: Ptr, owner = -1): BlendBlock | null {
    if (!ptr) return null;
    return (owner >= 0 ? this.scoped.get(owner)?.get(ptr) : undefined) ?? this.idByAddr.get(ptr) ?? this.byAddr.get(ptr) ?? null;
  }
  structs: DnaStruct[] = [];
  structByName = new Map<string, DnaStruct>();
  private types: string[] = [];
  private tlen: number[] = [];
  private textDecoder = new TextDecoder('utf-8');

  constructor(buffer: ArrayBuffer | Uint8Array) {
    let u8 = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    if (u8[0] === 0x28 && u8[1] === 0xb5 && u8[2] === 0x2f && u8[3] === 0xfd) u8 = zstdDecompress(u8);
    else if (u8[0] === 0x1f && u8[1] === 0x8b) throw new Error('This .blend is gzip-compressed (Blender 2.x "Compress"). Re-save it in Blender 3+ or without compression.');
    this.bytes = u8;
    this.dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    const magic = this.str(0, 7);
    if (magic !== 'BLENDER') throw new Error('Not a .blend file');
    let pos: number;
    let large = false;
    if (u8[7] === 0x2d || u8[7] === 0x5f) {
      // Classic: BLENDER + '-'/'_' (pointer size) + 'v'/'V' (endian) + "306"
      if (u8[7] !== 0x2d) throw new Error('32-bit .blend files are not supported');
      if (u8[8] !== 0x76) throw new Error('Big-endian .blend files are not supported');
      this.version = Number(this.str(9, 3));
      pos = 12;
    } else {
      // Blender 5.0+: "BLENDER" + header size (2 digits) + "-" + format version (2 digits) + "v" + version (4 digits)
      const headerSize = Number(this.str(7, 2));
      const fmt = Number(this.str(10, 2));
      if (fmt !== 1) throw new Error(`Unsupported .blend file format version ${fmt}`);
      this.version = Number(this.str(13, 4));
      pos = headerSize;
      large = true;
    }
    // File blocks
    let lastOwner = -1;
    for (;;) {
      if (pos + (large ? 32 : 24) > u8.length) break;
      const code = this.code(pos);
      let len: number, old: Ptr, sdna: number, nr: number, hsize: number;
      if (large) {
        sdna = this.dv.getInt32(pos + 4, true); old = this.ptrAt(pos + 8); len = this.u64(pos + 16); nr = this.u64(pos + 24); hsize = 32;
      } else {
        len = this.dv.getInt32(pos + 4, true); old = this.ptrAt(pos + 8); sdna = this.dv.getInt32(pos + 16, true); nr = this.dv.getInt32(pos + 20, true); hsize = 24;
      }
      if (code === 'ENDB') break;
      const idx = this.blocks.length;
      if (code !== 'DATA') lastOwner = idx;
      const b: BlendBlock = { code, len, old, sdna, nr, offset: pos + hsize, idx, owner: lastOwner };
      this.blocks.push(b);
      if (old) {
        if (!this.byAddr.has(old)) this.byAddr.set(old, b);
        if (code !== 'DATA') this.idByAddr.set(old, b);
        let sc = this.scoped.get(lastOwner);
        if (!sc) this.scoped.set(lastOwner, (sc = new Map()));
        if (!sc.has(old)) sc.set(old, b);
      }
      pos += hsize + len;
    }
    const dna = this.blocks.find((b) => b.code === 'DNA1');
    if (!dna) throw new Error('Missing SDNA block');
    this.readDna(dna.offset);
  }

  // ---------------------------------------------------------------- primitives
  str(off: number, n: number) { let s = ''; for (let i = 0; i < n; i++) s += String.fromCharCode(this.bytes[off + i]); return s; }
  code(off: number) { let s = ''; for (let i = 0; i < 4; i++) { const c = this.bytes[off + i]; if (c) s += String.fromCharCode(c); } return s; }
  u64(off: number) { return this.dv.getUint32(off, true) + this.dv.getUint32(off + 4, true) * 4294967296; }
  ptrAt(off: number): Ptr { return this.dv.getBigUint64(off, true); }
  cstr(off: number, max: number) { let e = off; while (e < off + max && this.bytes[e]) e++; return this.textDecoder.decode(this.bytes.subarray(off, e)); }

  private readDna(off: number) {
    const base = off;
    const align4 = (o: number) => base + ((o - base + 3) & ~3);
    const expect = (s: string) => { if (this.str(off, 4) !== s) throw new Error(`Bad SDNA (expected ${s})`); off += 4; };
    expect('SDNA'); expect('NAME');
    const nNames = this.dv.getInt32(off, true); off += 4;
    const names: string[] = [];
    for (let i = 0; i < nNames; i++) { let e = off; while (this.bytes[e]) e++; names.push(this.str(off, e - off)); off = e + 1; }
    off = align4(off);
    expect('TYPE');
    const nTypes = this.dv.getInt32(off, true); off += 4;
    for (let i = 0; i < nTypes; i++) { let e = off; while (this.bytes[e]) e++; this.types.push(this.str(off, e - off)); off = e + 1; }
    off = align4(off);
    expect('TLEN');
    for (let i = 0; i < nTypes; i++) { this.tlen.push(this.dv.getUint16(off, true)); off += 2; }
    off = align4(off);
    expect('STRC');
    const nStructs = this.dv.getInt32(off, true); off += 4;
    for (let s = 0; s < nStructs; s++) {
      const t = this.dv.getUint16(off, true); const nf = this.dv.getUint16(off + 2, true); off += 4;
      const fields = new Map<string, DnaField>(); const list: DnaField[] = [];
      let fo = 0;
      for (let f = 0; f < nf; f++) {
        const ft = this.dv.getUint16(off, true); const fnRaw = names[this.dv.getUint16(off + 2, true)]; off += 4;
        const isPtr = fnRaw.startsWith('*') || fnRaw.startsWith('(*');
        const dims = [...fnRaw.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1]));
        const count = dims.reduce((a, b) => a * b, 1);
        const size = (isPtr ? this.ptrSize : this.tlen[ft]) * count;
        const clean = fnRaw.replace(/^\(?\*+/, '').replace(/\).*$/, '').replace(/\[.*$/, '').replace(/^\*+/, '');
        const fd: DnaField = { name: clean, raw: fnRaw, type: this.types[ft], offset: fo, size, isPtr, dims, count };
        fields.set(clean, fd); list.push(fd);
        fo += size;
      }
      const st: DnaStruct = { name: this.types[t], size: this.tlen[t], fields, list };
      this.structs.push(st);
      this.structByName.set(st.name, st);
    }
  }

  structOf(b: BlendBlock): DnaStruct { return this.structs[b.sdna]; }
  hasStruct(name: string) { return this.structByName.has(name); }

  /** Struct view at an absolute offset. */
  view(structName: string, offset: number, owner = -1): SView { const s = this.structByName.get(structName); if (!s) throw new Error(`Struct ${structName} not in this file`); return new SView(this, s, offset, owner); }
  viewBlock(b: BlendBlock, i = 0): SView { const s = this.structOf(b); return new SView(this, s, b.offset + i * s.size, b.owner); }

  /** Dereference a pointer to a struct (first element of the block it points into). */
  deref(ptr: Ptr, structName?: string, owner = -1): SView | null {
    const b = this.resolve(ptr, owner);
    if (!b) return null;
    const v = structName ? this.view(structName, b.offset, b.owner) : this.viewBlock(b);
    v.from = ptr;
    return v;
  }

  /** i-th pointer of a pointer array (e.g. Material **mat, FCurve **fcurve_array). */
  ptrArray(arrayPtr: Ptr, count: number, owner: number): Ptr[] {
    const b = this.resolve(arrayPtr, owner); if (!b) return [];
    return Array.from({ length: Math.min(count, Math.floor(b.len / 8)) }, (_, i) => this.ptrAt(b.offset + i * 8));
  }
  /** C string a char* points to. */
  stringAt(ptr: Ptr, owner: number): string { const b = this.resolve(ptr, owner); return b ? this.cstr(b.offset, b.len) : ''; }

  /** All ID blocks of a type, e.g. "OB", "ME", "MA", "IM", "AC", "AR". */
  idBlocks(code: string): SView[] { return this.blocks.filter((b) => b.code === code).map((b) => this.viewBlock(b)); }

  /** Raw bytes a pointer refers to. */
  bytesAt(ptr: Ptr, owner = -1): Uint8Array | null { const b = this.resolve(ptr, owner); return b ? this.bytes.subarray(b.offset, b.offset + b.len) : null; }
  blockAt(ptr: Ptr, owner = -1) { return this.resolve(ptr, owner); }

  /** Typed arrays over pointed-to data. */
  floatsAt(ptr: Ptr, count?: number, owner = -1): Float32Array | null {
    const b = this.resolve(ptr, owner); if (!b) return null;
    const n = count ?? Math.floor(b.len / 4);
    return copyF32(this.bytes, b.offset, n);
  }
  intsAt(ptr: Ptr, count?: number, owner = -1): Int32Array | null {
    const b = this.resolve(ptr, owner); if (!b) return null;
    const n = count ?? Math.floor(b.len / 4);
    const out = new Int32Array(n);
    for (let i = 0; i < n; i++) out[i] = this.dv.getInt32(b.offset + i * 4, true);
    return out;
  }

  /** Walk a ListBase (first/last) of linked structs with a `next` pointer at offset 0. */
  list(lb: SView | null, structName?: string): SView[] {
    const out: SView[] = [];
    if (!lb) return out;
    let p = lb.ptr('first');
    let guard = 0;
    while (p && guard++ < 100000) {
      const v = this.deref(p, structName, lb.owner);
      if (!v) break;
      out.push(v);
      p = v.ptr('next');
    }
    return out;
  }
}

function copyF32(bytes: Uint8Array, off: number, n: number) {
  const out = new Float32Array(n);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < n; i++) out[i] = dv.getFloat32(off + i * 4, true);
  return out;
}

/** Typed view of one struct instance. */
export class SView {
  /** Pointer value this view was reached through (used to match links such as bNodeLink.fromnode). */
  from: Ptr = 0n;
  constructor(public f: BlendFile, public s: DnaStruct, public offset: number, public owner = -1) {}
  has(name: string) { return this.s.fields.has(name); }
  field(name: string) { return this.s.fields.get(name); }
  private fd(names: string | string[]): DnaField | null {
    for (const n of Array.isArray(names) ? names : [names]) { const fd = this.s.fields.get(n); if (fd) return fd; }
    return null;
  }
  /** Numeric field (first element). Accepts alternative names for renamed fields. */
  num(names: string | string[], index = 0): number {
    const fd = this.fd(names); if (!fd) return 0;
    const dv = this.f.dv; const o = this.offset + fd.offset;
    if (fd.isPtr) return this.f.ptrAt(o + index * 8) ? 1 : 0; // use ptr() for the actual pointer
    switch (fd.type) {
      case 'float': return dv.getFloat32(o + index * 4, true);
      case 'double': return dv.getFloat64(o + index * 8, true);
      case 'int': case 'int32_t': return dv.getInt32(o + index * 4, true);
      case 'uint': case 'uint32_t': return dv.getUint32(o + index * 4, true);
      case 'short': case 'int16_t': return dv.getInt16(o + index * 2, true);
      case 'ushort': case 'uint16_t': return dv.getUint16(o + index * 2, true);
      case 'char': case 'int8_t': return dv.getInt8(o + index);
      case 'uchar': case 'uint8_t': case 'bool': return dv.getUint8(o + index);
      case 'int64_t': case 'long': return Number(dv.getBigInt64(o + index * 8, true));
      case 'uint64_t': case 'ulong': return Number(dv.getBigUint64(o + index * 8, true));
    }
    return 0;
  }
  nums(names: string | string[]): number[] { const fd = this.fd(names); if (!fd) return []; return Array.from({ length: fd.count }, (_, i) => this.num(fd.name, i)); }
  ptr(names: string | string[], index = 0): Ptr { const fd = this.fd(names); if (!fd || !fd.isPtr) return 0n; return this.f.ptrAt(this.offset + fd.offset + index * 8); }
  str(names: string | string[]): string { const fd = this.fd(names); if (!fd) return ''; return this.f.cstr(this.offset + fd.offset, fd.size); }
  /** Embedded struct field. */
  sub(names: string | string[]): SView | null {
    const fd = this.fd(names); if (!fd || fd.isPtr) return null;
    const st = this.f.structByName.get(fd.type); if (!st) return null;
    return new SView(this.f, st, this.offset + fd.offset, this.owner);
  }
  /** Pointer field dereferenced (resolved within this struct's owning ID first). */
  get(names: string | string[], structName?: string): SView | null { return this.f.deref(this.ptr(names), structName, this.owner); }
  /** Block a pointer field refers to (owner-scoped). */
  block(names: string | string[], index = 0) { return this.f.resolve(this.ptr(names, index), this.owner); }
  /** Name of an ID (strips the 2-letter type prefix). */
  idName(): string { const id = this.sub('id'); return id ? id.str('name').slice(2) : ''; }
  /** Address this struct was saved at (for matching pointers). */
  get addr(): Ptr { const b = this.f.blocks.find((x) => this.offset >= x.offset && this.offset < x.offset + x.len); return b ? b.old + BigInt(this.offset - b.offset) : 0n; }
}

export { PRIM };
