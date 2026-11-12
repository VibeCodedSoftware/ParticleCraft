// Graphics memory for textures, while playing. Two options (Project settings › Textures):
//  - Compressed textures: pictures become BC or ETC2 blocks in a worker, then replace the plain ones, 4 to 8 times smaller.
//    Normal maps, pixel art and pictures that can't be read stay as they are. Lossy, so off unless chosen.
//  - Texture streaming: each picture is kept on the graphics card only as large as it is seen on screen right now, within
//    a memory budget. The decoded pictures stay in main memory, so raising a texture is immediate; what this saves is
//    graphics memory. Nothing is loaded from disk piece by piece.
import * as THREE from 'three';
import { chainBytes, type BlockFormat, type EncodedLevel } from './textureCodec';

const THREE_FORMAT: Record<BlockFormat, THREE.CompressedPixelFormat> = {
  bc1: THREE.RGB_S3TC_DXT1_Format, bc3: THREE.RGBA_S3TC_DXT5_Format, etc2: THREE.RGB_ETC2_Format, etc2a: THREE.RGBA_ETC2_EAC_Format,
};
/** Slots holding colours or plain values, where a little loss doesn't show. Normal maps are excluded: blocks break them. */
const COMPRESSIBLE = new Set(['map', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'alphaMap', 'lightMap', 'bumpMap']);

// A clone of a compressed texture (sprites and tiled materials clone theirs) must count as compressed too.
const compressedSources = new WeakSet<object>();
Object.defineProperty(THREE.Texture.prototype, 'isCompressedTexture', {
  configurable: true,
  get(this: THREE.Texture & { _isCompressed?: boolean }) { return this._isCompressed === true || compressedSources.has(this.source); },
  set(this: THREE.Texture & { _isCompressed?: boolean }, v: boolean) { this._isCompressed = v; },
});

export const nearestPot = (n: number) => Math.max(1, Math.min(4096, 2 ** Math.round(Math.log2(Math.max(1, n)))));

interface Rec {
  source: THREE.Source; clones: Set<THREE.Texture>; full: { width: number; height: number } & CanvasImageSource;
  slotOk: boolean; flipY: boolean; generateMipmaps: boolean; format: THREE.PixelFormat | THREE.CompressedPixelFormat;
  encoded?: { format: BlockFormat; levels: EncodedLevel[] }; encoding?: boolean; failed?: boolean;
  /** Halvings taken off the top now, and what the screen has asked for. */
  level: number; want: number; wantAt: number; applied: boolean;
}
export interface TextureStats { managed: number; compressed: number; waiting: number; bytes: number; fullBytes: number; unsupported: string }
export interface TextureOptions { compress: boolean; streaming: boolean; budgetMb: number }

const plainBytes = (w: number, h: number) => w * h * 4 * 4 / 3;

export class TextureManager {
  private recs = new Map<THREE.Source, Rec>();
  private worker: Worker | null = null;
  private jobs = new Map<number, Rec>();
  private nextId = 1;
  private busy = false;
  private queue: Rec[] = [];
  private opts: TextureOptions = { compress: false, streaming: false, budgetMb: 0 };
  private clock = 0;
  stats: TextureStats = { managed: 0, compressed: 0, waiting: 0, bytes: 0, fullBytes: 0, unsupported: '' };

  constructor(private renderer: THREE.WebGLRenderer) {}

  /** Which block family this graphics card reads, with sRGB pictures, or why none. */
  family(): 'bc' | 'etc' | null {
    const ex = this.renderer.extensions;
    if (ex.has('WEBGL_compressed_texture_s3tc') && ex.has('WEBGL_compressed_texture_s3tc_srgb')) return 'bc';
    if (ex.has('WEBGL_compressed_texture_etc')) return 'etc';
    return null;
  }

  get active() { return this.opts.compress || this.opts.streaming; }

  setOptions(o: TextureOptions) {
    const was = this.opts;
    this.opts = o;
    if (was.compress !== o.compress || was.streaming !== o.streaming) {
      if (!this.active) this.restoreAll();
      else for (const r of this.recs.values()) { if (!o.streaming) r.level = 0; r.applied = false; this.apply(r); }
      this.refreshStats(this.family());
    }
  }

  /** Find every picture the materials of these objects use. */
  scan(materials: Iterable<THREE.Material>) {
    for (const m of materials) for (const [slot, v] of Object.entries(m)) {
      const t = v as THREE.Texture;
      if (t?.isTexture && slot.endsWith('Map') || (t?.isTexture && slot === 'map')) this.add(t, slot);
    }
  }

  private add(t: THREE.Texture, slot: string) {
    const anyT = t as THREE.Texture & { isRenderTargetTexture?: boolean; isVideoTexture?: boolean; isDataTexture?: boolean; isCanvasTexture?: boolean; _isCompressed?: boolean };
    if (anyT.isRenderTargetTexture || anyT.isVideoTexture || anyT.isDataTexture || anyT.isCanvasTexture || anyT._isCompressed) return;
    if (t.magFilter === THREE.NearestFilter || t.minFilter === THREE.NearestFilter) return; // pixel art stays crisp
    const known = this.recs.get(t.source);
    if (known) {
      if (!known.clones.has(t)) { known.clones.add(t); known.slotOk &&= COMPRESSIBLE.has(slot); if (known.level || known.encoded) { this.setOn(known, t); } }
      return;
    }
    const img = t.image as ({ width: number; height: number } & CanvasImageSource) | null;
    if (!img?.width || !img.height || (img as unknown as { data?: unknown }).data) return; // not loaded yet: asked again later
    const r: Rec = { source: t.source, clones: new Set([t]), full: img, slotOk: COMPRESSIBLE.has(slot), flipY: t.flipY, generateMipmaps: t.generateMipmaps, format: t.format, level: 0, want: Math.max(img.width, img.height), wantAt: 0, applied: false };
    this.recs.set(t.source, r);
  }

  /** How large each object's pictures are on screen now (only used with streaming). */
  request(materials: THREE.Material[], pixels: number) {
    if (!this.opts.streaming) return;
    for (const m of materials) for (const [slot, v] of Object.entries(m)) {
      const t = v as THREE.Texture;
      if (!t?.isTexture || !(slot === 'map' || slot.endsWith('Map'))) continue;
      const r = this.recs.get(t.source); if (!r) continue;
      const need = pixels * Math.max(1, Math.abs(t.repeat.x), Math.abs(t.repeat.y));
      if (r.wantAt !== this.clock || need > r.want) r.want = r.wantAt === this.clock ? Math.max(r.want, need) : need;
      r.wantAt = this.clock;
    }
  }

  /** A few times a second. */
  tick(now: number) {
    this.clock = now;
    const family = this.family();
    if (this.opts.compress && family) {
      for (const r of this.recs.values()) if (r.slotOk && !r.encoded && !r.encoding && !r.failed) this.enqueue(r);
      this.pump(family);
    }
    if (this.opts.streaming) this.stream(now);
    this.refreshStats(family);
  }

  // ---------------------------------------------------------------- compression
  private enqueue(r: Rec) { r.encoding = true; this.queue.push(r); }

  private pump(family: 'bc' | 'etc') {
    if (this.busy) return;
    const r = this.queue.shift();
    if (!r) return;
    try { this.worker ??= new Worker(new URL('./textureCodecWorker.ts', import.meta.url), { type: 'module' }); } catch { r.failed = true; r.encoding = false; return; }
    this.worker.onmessage = (ev: MessageEvent<{ id: number; format?: BlockFormat; levels?: EncodedLevel[]; error?: string }>) => {
      const job = this.jobs.get(ev.data.id);
      this.jobs.delete(ev.data.id);
      this.busy = false;
      if (job) {
        job.encoding = false;
        if (ev.data.levels && ev.data.format) { job.encoded = { format: ev.data.format, levels: ev.data.levels }; if (this.opts.compress) this.apply(job); }
        else job.failed = true;
      }
      this.pump(family);
    };
    // Blocks need power-of-two sizes to make a full mipmap chain, and upside-down rows when the picture is flipped on upload.
    const w = nearestPot(r.full.width), h = nearestPot(r.full.height);
    let data: ImageData;
    try {
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const g = c.getContext('2d', { willReadFrequently: true })!;
      if (r.flipY) { g.translate(0, h); g.scale(1, -1); }
      g.drawImage(r.full, 0, 0, w, h);
      data = g.getImageData(0, 0, w, h);
    } catch { r.failed = true; r.encoding = false; this.pump(family); return; }
    const id = this.nextId++;
    this.jobs.set(id, r);
    this.busy = true;
    this.worker.postMessage({ id, data: data.data, width: w, height: h, family }, [data.data.buffer]);
  }

  // ---------------------------------------------------------------- applying a state to the pictures
  private usesBlocks(r: Rec) { return this.opts.compress && !!r.encoded; }

  /** Put one texture object in the record's current state. */
  private setOn(r: Rec, t: THREE.Texture) {
    if (this.usesBlocks(r)) {
      const lv = r.encoded!.levels, from = Math.min(r.level, lv.length - 1);
      t.mipmaps = lv.slice(from) as unknown as THREE.Texture['mipmaps'];
      t.format = THREE_FORMAT[r.encoded!.format];
      t.generateMipmaps = false; t.flipY = false;
    } else {
      t.mipmaps = []; t.format = r.format as THREE.PixelFormat; t.generateMipmaps = r.generateMipmaps; t.flipY = r.flipY;
    }
    t.dispose(); // a different size can't reuse the old storage on the graphics card
    t.needsUpdate = true;
  }

  private apply(r: Rec) {
    if (this.usesBlocks(r)) {
      const lv = r.encoded!.levels, from = Math.min(r.level, lv.length - 1);
      compressedSources.add(r.source);
      r.source.data = { width: lv[from].width, height: lv[from].height };
    } else {
      compressedSources.delete(r.source);
      if (r.level === 0) r.source.data = r.full;
      else {
        const w = Math.max(1, r.full.width >> r.level), h = Math.max(1, r.full.height >> r.level);
        const c = document.createElement('canvas'); c.width = w; c.height = h;
        c.getContext('2d')!.drawImage(r.full, 0, 0, w, h);
        r.source.data = c;
      }
    }
    for (const t of r.clones) this.setOn(r, t);
    r.applied = true;
  }

  private restoreAll() {
    for (const r of this.recs.values()) {
      r.level = 0;
      compressedSources.delete(r.source);
      r.source.data = r.full;
      for (const t of r.clones) { t.mipmaps = []; t.format = r.format as THREE.PixelFormat; t.generateMipmaps = r.generateMipmaps; t.flipY = r.flipY; t.dispose(); t.needsUpdate = true; }
    }
  }

  /** Leaving play: every picture back as it was. What was compressed is kept for next time. */
  stop() {
    if (this.active) this.restoreAll();
    for (const r of this.recs.values()) { r.clones.clear(); r.applied = false; }
    this.opts = { compress: false, streaming: false, budgetMb: 0 };
    this.recs.forEach((r, k) => { if (!r.encoded) this.recs.delete(k); });
    this.refreshStats(null);
  }
  dispose() { this.worker?.terminate(); this.worker = null; }

  // ---------------------------------------------------------------- streaming
  private sizeOf(r: Rec, level = r.level) {
    if (this.usesBlocks(r)) return chainBytes(r.encoded!.levels, Math.min(level, r.encoded!.levels.length - 1));
    return plainBytes(Math.max(1, r.full.width >> level), Math.max(1, r.full.height >> level));
  }
  private maxLevel(r: Rec) { return Math.max(0, Math.floor(Math.log2(Math.max(r.full.width, r.full.height))) - 6); } // never below 64 pixels

  /** The level that gives at least this many pixels. */
  levelFor(r: { full: { width: number; height: number } }, pixels: number, max: number) {
    let level = 0;
    const side = Math.max(r.full.width, r.full.height);
    while (level < max && side >> (level + 1) >= pixels) level++;
    return level;
  }

  private stream(now: number) {
    const budget = this.opts.budgetMb > 0 ? this.opts.budgetMb * 1048576 : Infinity;
    let total = 0;
    const list = [...this.recs.values()];
    for (const r of list) total += this.sizeOf(r);
    // One change per tick (each is an upload): the most-needed raise first, then what memory or time say can come down.
    let raise: Rec | null = null, raiseGap = 0, raiseTo = 0;
    for (const r of list) {
      if (r.wantAt !== now) continue; // not on screen this time
      const to = this.levelFor(r, r.want, this.maxLevel(r));
      if (to < r.level && r.level - to > raiseGap) { raise = r; raiseGap = r.level - to; raiseTo = to; }
    }
    if (raise) {
      const growth = this.sizeOf(raise, raiseTo) - this.sizeOf(raise);
      if (total + growth <= budget) { raise.level = raiseTo; this.apply(raise); return; }
      // Over budget: only worth it if something unseen can make room (below).
    }
    let lower: Rec | null = null, lowerSave = 0;
    for (const r of list) {
      const onScreen = r.wantAt > now - 5000; // seen in the last 5 seconds: keep it, unless memory is short
      const to = onScreen ? this.levelFor(r, r.want, this.maxLevel(r)) : this.maxLevel(r);
      if (to <= r.level) continue;
      if (onScreen && total <= budget) { if (r.wantAt === now && to > r.level + 1) { /* far away now */ } else continue; }
      const save = this.sizeOf(r) - this.sizeOf(r, to);
      if (save > lowerSave) { lower = r; lowerSave = save; }
    }
    if (lower) { lower.level = lower.wantAt > now - 5000 ? Math.min(this.maxLevel(lower), lower.level + 1) : this.maxLevel(lower); this.apply(lower); return; }
    // Still over budget: the largest texture gives up its top level.
    if (total > budget) {
      let big: Rec | null = null, bigSize = 0;
      for (const r of list) if (r.level < this.maxLevel(r) && this.sizeOf(r) > bigSize) { big = r; bigSize = this.sizeOf(r); }
      if (big) { big.level++; this.apply(big); }
    }
  }

  private refreshStats(family: 'bc' | 'etc' | null) {
    let bytes = 0, fullBytes = 0, compressed = 0, waiting = 0;
    for (const r of this.recs.values()) {
      fullBytes += plainBytes(r.full.width, r.full.height);
      bytes += this.sizeOf(r);
      if (this.usesBlocks(r)) compressed++;
      else if (this.opts.compress && r.slotOk && !r.failed) waiting++;
    }
    this.stats = { managed: this.recs.size, compressed, waiting, bytes, fullBytes, unsupported: this.opts.compress && !family && this.recs.size ? 'This graphics card reads no block format the engine writes' : '' };
  }
}
