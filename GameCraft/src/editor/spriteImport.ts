// Animated sprites from GIFs and image sequences (packed by Shared/ui/animImport.ts): the sheet and the source
// files are kept in their own Assets folder (Sprites/<name>).
import { api } from '../project/api';
import { store } from '../project/store';
import type { AssetRef } from '../project/types';
import { packAnimation, sequenceKey } from '@shared/ui/animImport';

export { animName, sequenceKey, sheetLayout } from '@shared/ui/animImport';

type Anim = { from: number; to: number; fps: number; loop: boolean };
export interface ImportedSheet { image: string; frames: number; rows: number; fps: number; animation: string; animations: Record<string, Anim> }

const safe = (s: string) => s.replace(/[^A-Za-z0-9_.-]+/g, '_');

/**
 * Import GIFs and/or numbered pictures as one animated sprite. Returns the sprite settings to apply; the sheet and
 * the source files are added to the project under Assets › Imported › Sprites/<name>.
 */
export async function importAnimation(files: File[], name?: string): Promise<ImportedSheet> {
  const p = store.get().project!;
  const pk = await packAnimation(files);
  const base = safe(name || sequenceKey(files[0].name).group.split(/[_\-\s]/)[0] || 'Sprite');
  const folder = `Sprites/${base}`, dir = `imported/sprites/${base}`;
  const blob = await new Promise<Blob>((res, rej) => pk.sheet.toBlob((b) => (b ? res(b) : rej(new Error('could not encode the sheet'))), 'image/png'));
  await api.putFile(p.id, `${dir}/${base}_sheet.png`, await blob.arrayBuffer());
  const sources: AssetRef[] = [];
  for (const f of files) {
    const rel = `${dir}/${safe(f.name)}`;
    await api.putFile(p.id, rel, await f.arrayBuffer());
    sources.push({ id: `proj:${rel}`, name: f.name.replace(/\.[^.]+$/, ''), kind: 'texture', source: 'imported', folder, meta: { sourceFile: f.name, importedAt: new Date().toISOString() } });
  }
  const image = `proj:${dir}/${base}_sheet.png`;
  const sheetMeta = { frames: pk.frames, rows: pk.rows, fps: pk.fps, animations: pk.animations };
  store.mutate('Import animation', (pp) => {
    const add = (a: AssetRef) => { const i = pp.assets.findIndex((x) => x.id === a.id); if (i >= 0) pp.assets[i] = a; else pp.assets.push(a); };
    add({ id: image, name: `${base} (sheet)`, kind: 'texture', source: 'imported', folder, meta: { sourceFile: files.map((f) => f.name).join(', '), importedAt: new Date().toISOString(), sheet: sheetMeta } });
    sources.forEach(add);
  });
  return { image, frames: pk.frames, rows: pk.rows, fps: pk.fps, animation: pk.animation, animations: pk.animations };
}
