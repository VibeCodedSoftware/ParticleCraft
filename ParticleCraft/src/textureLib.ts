// Texture & image asset library: imported pictures, sprite sheets, GIFs (turned into sheets) and textures made by the
// texture node graph. App-wide and persistent: the index is the "_textures" library document, the pictures are files
// beside it (original bytes, so PNG transparency is kept). Effects reference an asset as "asset:<id>"; replacing an
// asset keeps its id, so every node using it keeps working.
import { useSyncExternalStore } from 'react';
import { detectSheet } from '@shared/src/sheetDetect';
import { newId } from '@shared/src/schema';
import { setTextureResolver } from '@shared/src/vfx/vfx';
import { api, BASE_URL } from './store';

export const TEX_DOC = '_textures';
export interface SheetInfo { cols: number; rows: number; frames: number; padding: number; spacing: number; fps?: number }
export interface TexAsset {
  id: string; name: string; folder: string; favorite?: boolean;
  /** File name inside the library folder. */
  file: string; mime: string; w: number; h: number;
  kind: 'image' | 'sheet' | 'generated';
  sheet?: SheetInfo;
  created: string; modified: string;
  /** Where it came from (original file name, "Texture graph", "SpriteCraft"…). */
  source?: string;
}
interface TexIndex { format: 'craft.textures'; items: TexAsset[]; folders: string[] }

let index: TexIndex = { format: 'craft.textures', items: [], folders: [] };
let loaded = false;
const subs = new Set<() => void>();
let rev = 0;
const emit = () => { rev++; subs.forEach((f) => f()); };

/** In-memory data URLs for assets (filled after load) so exports can embed pictures. */
const dataCache = new Map<string, string>();

export const assetUrl = (a: TexAsset) => `${BASE_URL}/api/projects/${TEX_DOC}/files/${encodeURIComponent(a.file)}?v=${encodeURIComponent(a.modified)}`;

/** Extra resolvers (texture node graph) consulted for refs the library does not know. */
const extraResolvers: ((ref: string) => string | undefined)[] = [];
export function addTextureResolver(fn: (ref: string) => string | undefined) { extraResolvers.push(fn); }

function resolve(ref: string): string | undefined {
  if (ref.startsWith('asset:')) { const a = index.items.find((x) => x.id === ref.slice(6)); return a ? assetUrl(a) : undefined; }
  for (const f of extraResolvers) { const u = f(ref); if (u) return u; }
  return undefined;
}
setTextureResolver(resolve);

export const texLib = {
  get: () => index,
  rev: () => rev,
  subscribe: (f: () => void) => { subs.add(f); return () => subs.delete(f); },
  find: (id: string) => index.items.find((x) => x.id === id),
  async load() {
    const d = await api.getDoc<TexIndex | null>(TEX_DOC, null);
    if (d && Array.isArray(d.items)) index = { format: 'craft.textures', items: d.items, folders: d.folders ?? [] };
    loaded = true; emit();
  },
  loaded: () => loaded,
  async save() { await api.putDoc(TEX_DOC, { id: TEX_DOC, name: 'Texture library', ...index }); emit(); },
  async update(id: string, fn: (a: TexAsset) => void) { const a = index.items.find((x) => x.id === id); if (!a) return; fn(a); index = { ...index, items: [...index.items] }; await texLib.save(); },
  async addFolder(name: string) { if (name && !index.folders.includes(name)) { index = { ...index, folders: [...index.folders, name] }; await texLib.save(); } },
  async remove(id: string) {
    const a = index.items.find((x) => x.id === id);
    index = { ...index, items: index.items.filter((x) => x.id !== id) };
    await texLib.save();
    if (a) { try { await fetch(`${BASE_URL}/api/projects/${TEX_DOC}/files/${encodeURIComponent(a.file)}`, { method: 'DELETE' }); } catch { /* the file may already be gone */ } }
  },
  /** Stores a picture (bytes) as a new asset, or replaces an existing one keeping its id. */
  async put(bytes: Blob, o: { name: string; mime: string; w: number; h: number; kind: TexAsset['kind']; sheet?: SheetInfo; folder?: string; source?: string; replace?: string }): Promise<TexAsset> {
    const ext = o.mime === 'image/jpeg' ? 'jpg' : o.mime === 'image/webp' ? 'webp' : 'png';
    const old = o.replace ? index.items.find((x) => x.id === o.replace) : undefined;
    const id = old?.id ?? newId('tex');
    const file = `${id}_${Date.now().toString(36)}.${ext}`;
    const r = await fetch(`${BASE_URL}/api/projects/${TEX_DOC}/files/${encodeURIComponent(file)}`, { method: 'PUT', body: bytes });
    if (!r.ok) throw new Error('Could not store the picture');
    const t = new Date().toISOString();
    const a: TexAsset = { id, name: old?.name ?? o.name, folder: old?.folder ?? o.folder ?? '', favorite: old?.favorite, file, mime: o.mime, w: o.w, h: o.h, kind: o.kind, sheet: o.sheet ?? (old?.kind === o.kind ? old?.sheet : undefined), created: old?.created ?? t, modified: t, source: o.source };
    index = { ...index, items: old ? index.items.map((x) => (x.id === id ? a : x)) : [...index.items, a] };
    if (!loaded) await texLib.load().catch(() => undefined);
    await texLib.save();
    if (old) { dataCache.delete(old.id); try { await fetch(`${BASE_URL}/api/projects/${TEX_DOC}/files/${encodeURIComponent(old.file)}`, { method: 'DELETE' }); } catch { /* ignore */ } }
    return a;
  },
  /** The asset as a data URL (for effect files that must carry their pictures). */
  async dataUrl(id: string): Promise<string | undefined> {
    const hit = dataCache.get(id); if (hit) return hit;
    const a = index.items.find((x) => x.id === id); if (!a) return undefined;
    const b = await (await fetch(assetUrl(a))).blob();
    const url = await new Promise<string>((res) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result)); fr.readAsDataURL(b); });
    dataCache.set(id, url);
    return url;
  },
};

export function useTexLib() { useSyncExternalStore(texLib.subscribe, texLib.rev); return texLib.get(); }

// ------------------------------------------------------------------ importing

const canvasBlob = (c: HTMLCanvasElement) => new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('encode failed'))), 'image/png'));

/** Pixels of a picture for grid detection. */
function pixels(img: CanvasImageSource, w: number, h: number) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true })!; g.drawImage(img, 0, 0);
  return g.getImageData(0, 0, w, h).data;
}

/** Frames of an animated GIF / WebP (WebCodecs ImageDecoder), laid out as a sprite sheet. */
async function animatedToSheet(file: File): Promise<{ canvas: HTMLCanvasElement; frames: number; cols: number; rows: number; fps: number } | null> {
  const ID = (globalThis as any).ImageDecoder;
  if (!ID) return null;
  try {
    const dec = new ID({ data: await file.arrayBuffer(), type: file.type });
    await dec.tracks.ready;
    const n = Math.min(256, dec.tracks.selectedTrack?.frameCount ?? 1);
    if (n <= 1) return null;
    const frames: { img: any; dur: number }[] = [];
    for (let i = 0; i < n; i++) { const r = await dec.decode({ frameIndex: i }); frames.push({ img: r.image, dur: (r.image.duration ?? 100000) / 1000 }); }
    const w = frames[0].img.displayWidth, h = frames[0].img.displayHeight;
    const cols = Math.ceil(Math.sqrt(n)), rows = Math.ceil(n / cols);
    const c = document.createElement('canvas'); c.width = cols * w; c.height = rows * h;
    const g = c.getContext('2d')!;
    frames.forEach((f, i) => { g.drawImage(f.img, (i % cols) * w, Math.floor(i / cols) * h); f.img.close?.(); });
    const avg = frames.reduce((a, f) => a + f.dur, 0) / n;
    return { canvas: c, frames: n, cols, rows, fps: Math.max(1, Math.min(60, Math.round(1000 / Math.max(10, avg)))) };
  } catch { return null; }
}

/** Grid of a sheet from its JSON description ("array" or "hash" frames: SpriteCraft, Aseprite, TexturePacker). */
export function gridFromSheetJson(j: any): (SheetInfo & { image?: string }) | null {
  const fr: any[] = Array.isArray(j?.frames) ? j.frames : j?.frames && typeof j.frames === 'object' ? Object.values(j.frames) : [];
  const rects = fr.map((f) => f?.frame).filter((r) => r && Number.isFinite(r.x) && Number.isFinite(r.w));
  if (!rects.length) return null;
  const xs = [...new Set(rects.map((r) => r.x))].sort((a, b) => a - b), ys = [...new Set(rects.map((r) => r.y))].sort((a, b) => a - b);
  const w = rects[0].w, durs = fr.map((f) => Number(f?.duration)).filter((d) => d > 0);
  return { cols: xs.length, rows: ys.length, frames: rects.length, padding: xs[0], spacing: xs.length > 1 ? xs[1] - xs[0] - w : 0, fps: durs.length ? Math.max(1, Math.round(1000 / (durs.reduce((a, b) => a + b, 0) / durs.length))) : undefined, image: j?.meta?.image };
}

/** A baked effect / SpriteCraft animation (craft.vfx, kind "baked") from the exchange folder → a sheet asset. */
export async function importBakedFlipbook(a: { name: string; flipbook: { image: string; frames: number; fps: number; width: number; height: number; pixelArt?: boolean } }, folder = 'SpriteCraft'): Promise<TexAsset> {
  const fb = a.flipbook;
  const blob = await (await fetch(fb.image)).blob();
  const bmp = await createImageBitmap(blob);
  const cols = Math.max(1, Math.round(bmp.width / Math.max(1, fb.width))), rows = Math.max(1, Math.round(bmp.height / Math.max(1, fb.height)));
  const asset = await texLib.put(blob, { name: a.name, mime: 'image/png', w: bmp.width, h: bmp.height, kind: 'sheet', sheet: { cols, rows, frames: fb.frames, padding: 0, spacing: 0, fps: fb.fps }, folder, source: fb.pixelArt ? 'SpriteCraft (pixel art)' : 'Exchange folder' });
  bmp.close();
  return asset;
}

export async function importTextureFiles(files: File[], folder = '', asSheet?: boolean): Promise<{ added: TexAsset[]; notes: string[] }> {
  const added: TexAsset[] = [], notes: string[] = [];
  // Sheet descriptions travel with their pictures; a baked craft.vfx is imported as its flipbook.
  const grids = new Map<string, SheetInfo>();
  for (const f of files.filter((x) => /\.json$/i.test(x.name))) {
    try {
      const j = JSON.parse(await f.text());
      if (j?.format === 'craft.vfx' && j.kind === 'baked' && j.flipbook) { added.push(await importBakedFlipbook(j, folder)); notes.push(`${f.name}: flipbook with ${j.flipbook.frames} frames`); continue; }
      const g = gridFromSheetJson(j);
      if (g) grids.set((g.image ?? f.name.replace(/\.json$/i, '.png')).toLowerCase(), g); else notes.push(`${f.name}: no frames found in this JSON`);
    } catch { notes.push(`${f.name}: not readable JSON`); }
  }
  files = files.filter((x) => !/\.json$/i.test(x.name));
  for (const f of files) {
    const type = f.type || (/\.png$/i.test(f.name) ? 'image/png' : /\.jpe?g$/i.test(f.name) ? 'image/jpeg' : /\.webp$/i.test(f.name) ? 'image/webp' : /\.gif$/i.test(f.name) ? 'image/gif' : '');
    if (!/^image\/(png|jpeg|webp|gif)$/.test(type)) { notes.push(`${f.name}: not a PNG, JPG, WebP or GIF`); continue; }
    const name = f.name.replace(/\.[^.]+$/, '');
    if (type === 'image/gif' || type === 'image/webp') {
      const anim = await animatedToSheet(f);
      if (anim) {
        added.push(await texLib.put(await canvasBlob(anim.canvas), { name, mime: 'image/png', w: anim.canvas.width, h: anim.canvas.height, kind: 'sheet', sheet: { cols: anim.cols, rows: anim.rows, frames: anim.frames, padding: 0, spacing: 0, fps: anim.fps }, folder, source: f.name }));
        notes.push(`${f.name}: ${anim.frames} animation frames became a ${anim.cols}×${anim.rows} sprite sheet`);
        continue;
      }
      if (type === 'image/gif') notes.push(`${f.name}: imported as a still picture (this system cannot read GIF frames)`);
    }
    const bmp = await createImageBitmap(f);
    let sheet: SheetInfo | undefined;
    const g = detectSheet(pixels(bmp, bmp.width, bmp.height), bmp.width, bmp.height);
    const described = grids.get(f.name.toLowerCase());
    if (described) { sheet = described; notes.push(`${f.name}: ${described.cols}×${described.rows} grid from its JSON`); }
    else if ((asSheet ?? true) && g.frames > 1 && g.how !== 'single') sheet = { cols: g.cols, rows: g.rows, frames: g.frames, padding: 0, spacing: 0 };
    if (asSheet && !sheet) sheet = { cols: 1, rows: 1, frames: 1, padding: 0, spacing: 0 };
    const keepPng = type === 'image/gif' ? false : true;
    const blob = keepPng ? f : await (async () => { const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height; c.getContext('2d')!.drawImage(bmp, 0, 0); return canvasBlob(c); })();
    added.push(await texLib.put(blob, { name, mime: keepPng ? type : 'image/png', w: bmp.width, h: bmp.height, kind: sheet ? 'sheet' : 'image', sheet, folder, source: f.name }));
    if (sheet) notes.push(`${f.name}: looks like a ${sheet.cols}×${sheet.rows} sprite sheet (${sheet.frames} frames) — correct it in the library if needed`);
    bmp.close();
  }
  return { added, notes };
}

/** Saves a canvas (texture graph output, processed picture) into the library. */
export async function saveCanvasToLibrary(c: HTMLCanvasElement, name: string, o: { folder?: string; sheet?: SheetInfo; source?: string; replace?: string } = {}) {
  return texLib.put(await canvasBlob(c), { name, mime: 'image/png', w: c.width, h: c.height, kind: o.sheet ? 'sheet' : 'generated', sheet: o.sheet, folder: o.folder ?? 'Generated', source: o.source ?? 'Texture graph', replace: o.replace });
}
