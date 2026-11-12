// Effect files that travel: exporting embeds the library pictures an effect uses (so another computer, another
// project or GameCraft gets them) and turns picture links in the compiled layers into data; importing puts the
// pictures into this texture library (reusing ones already there) and rewires the effect to them.
import { finalizeAsset, newAsset, parseVfxAsset, type VfxAsset } from '@shared/src/vfx/vfx';
import { assetRefs, remapAssets } from '@shared/src/vfx/compose';
import { newId } from '@shared/src/schema';
import { texLib } from './textureLib';

async function toDataUrl(url: string): Promise<string> {
  if (url.startsWith('data:')) return url;
  const b = await (await fetch(url)).blob();
  return new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result)); fr.readAsDataURL(b); });
}

/** A finished, self-contained effect: layers compiled, pictures as data, library pictures embedded. */
export async function packEffect(doc: VfxAsset): Promise<VfxAsset> {
  const a = doc.kind === 'realtime' ? finalizeAsset(doc) : JSON.parse(JSON.stringify(doc));
  if (a.graph) {
    const assets: NonNullable<VfxAsset['assets']> = [];
    for (const id of assetRefs(a.graph)) {
      const t = texLib.find(id); const data = await texLib.dataUrl(id);
      if (t && data) assets.push({ id, name: t.name, data, w: t.w, h: t.h, sheet: t.sheet });
    }
    if (assets.length) a.assets = assets;
  }
  // Compiled layers must not point at this computer's library server.
  const cache = new Map<string, string>();
  for (const l of a.layers ?? []) {
    const p = l.params as any;
    for (const [obj, key] of [[p, 'textureImage'], ...(p.material ? ['normalMap', 'heightMap', 'emissionMap', 'alphaMap', 'motionVectors'].map((k) => [p.material, k]) : [])] as [any, string][]) {
      const u = obj?.[key]; if (typeof u !== 'string' || u.startsWith('data:')) continue;
      if (!cache.has(u)) { try { cache.set(u, await toDataUrl(u)); } catch { cache.set(u, ''); } }
      obj[key] = cache.get(u) || undefined;
    }
  }
  return a;
}

/** Reads an effect file; its embedded pictures join the library and the effect points at them. */
export async function unpackEffect(text: string): Promise<{ asset: VfxAsset; notes: string[] }> {
  const a = parseVfxAsset(text);
  const notes: string[] = [];
  const map = new Map<string, string>();
  if (!texLib.loaded()) await texLib.load().catch(() => undefined);
  for (const e of a.assets ?? []) {
    const have = texLib.find(e.id) ?? texLib.get().items.find((x) => x.name === e.name && x.w === e.w && x.h === e.h);
    if (have) { map.set(e.id, have.id); continue; }
    const blob = await (await fetch(e.data)).blob();
    const t = await texLib.put(blob, { name: e.name, mime: blob.type || 'image/png', w: e.w, h: e.h, kind: e.sheet ? 'sheet' : 'image', sheet: e.sheet, folder: 'Imported effects', source: a.name });
    map.set(e.id, t.id); notes.push(`Added "${e.name}" to the texture library`);
  }
  if (a.graph) remapAssets(a.graph, map);
  const t = new Date().toISOString();
  const out: VfxAsset = { ...a, id: newId('vfx'), created: t, modified: t, assets: undefined };
  if (out.kind === 'realtime' && !out.graph) { notes.push('This file has no node graph (only compiled layers); it opens empty.'); return { asset: { ...newAsset(a.name, { systems: [], params: [] }, a.category), layers: a.layers }, notes }; }
  return { asset: out, notes };
}
