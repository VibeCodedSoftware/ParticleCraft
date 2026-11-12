// Asset browser: starter primitives & sprites, your model library, imported assets, prefabs,
// favorites and recent. Drag anything into the viewport.
import React, { useEffect, useMemo, useState } from 'react';
import { store, useStore } from '../project/store';
import { api, assetUrl } from '../project/api';
import type { AssetRef } from '../project/types';
import { MODEL_EXTS, TEXTURE_EXTS, AUDIO_EXTS, VIDEO_EXTS, extOf, loadBlend } from '../engine/assets';
import { materialSphereThumb, modelThumb, primitiveThumb } from '../engine/thumbnails';
import { groupPbrSets, newSlot, type MapSlot, type PbrSet } from '@shared/src/materialMaps';
import { PARTICLE_PRESETS } from '@shared/src/runtime/particles';
import { PROCEDURAL_SPRITES, spriteThumb } from '../engine/sprites';
import { ADD_MENU, addModel, addObject, curScene, placePrefab, registerAsset } from './actions';
import { ImportWizard } from './ImportWizard';
import { importAnimation } from './spriteImport';
import { Icon } from '@shared/ui/icons';
import { editorRefs } from './session';

/** The folder an imported asset is shown in: its own, or the one for its kind. */
const KIND_FOLDER: Record<AssetRef['kind'], string> = { model: 'Models', texture: 'Textures', audio: 'Audio', video: 'Videos', font: 'Fonts' };
export const folderOf = (a: AssetRef) => a.folder || KIND_FOLDER[a.kind] || 'Other';

type Folder ='starter' | 'library' | 'imported' | 'prefabs' | 'favorites' | 'recent';
interface Item { id: string; name: string; kind: AssetRef['kind'] | 'primitive' | 'sprite' | 'prefab' | 'material' | 'particle'; source: string; ref?: AssetRef; thumb?: string; primitive?: string; size?: number; modified?: number; pbr?: PbrSet }
/** Type tabs above the grid (within whichever folder is open). */
const TABS = [['all', 'All'], ['models', 'Models'], ['materials', 'Materials'], ['textures', 'Textures'], ['sprites', 'Sprites'], ['audio', 'Audio'], ['animations', 'Animations'], ['particles', 'Particles'], ['prefabs', 'Prefabs']] as const;
type TypeTab = typeof TABS[number][0];
/** Model files that only carry animation clips (Mixamo-style), shown under Animations. */
const isAnimationFile = (it: Item) => it.kind === 'model' && (/(^|\/)animations\//i.test(it.id) || /anim|@/i.test(it.name) && !!it.ref?.meta?.animations?.length && !(it.ref?.meta?.vertices));
function inTab(it: Item, tab: TypeTab): boolean {
  switch (tab) {
    case 'all': return true;
    case 'models': return (it.kind === 'model' && !isAnimationFile(it)) || it.kind === 'primitive';
    case 'materials': return it.kind === 'material';
    case 'textures': return it.kind === 'texture' && !it.ref?.meta?.sheet;
    case 'sprites': return it.kind === 'sprite' || (it.kind === 'texture' && !!it.ref?.meta?.sheet);
    case 'audio': return it.kind === 'audio';
    case 'animations': return isAnimationFile(it) || (it.kind === 'texture' && !!it.ref?.meta?.sheet?.animations);
    case 'particles': return it.kind === 'particle';
    case 'prefabs': return it.kind === 'prefab';
  }
}

export function AssetBrowser() {
  const project = useStore((s) => s.project);
  useStore((s) => s.rev);
  const [folder, setFolder] = useState<Folder>('library');
  const [q, setQ] = useState('');
  const [lib, setLib] = useState<Awaited<ReturnType<typeof api.library>>>([]);
  const [sel, setSel] = useState<Item | null>(null);
  const [wizard, setWizard] = useState<File[] | null>(null);
  const [tab, setTab] = useState<TypeTab>('all');
  /** Folder inside Imported being shown ('' = all of them). */
  const [sub, setSub] = useState('');
  const [libError, setLibError] = useState('');
  const [blendObjects, setBlendObjects] = useState<Record<string, string[]>>({});
  const openBlend = (id: string) => {
    if (blendObjects[id]) return;
    setBlendObjects((b) => ({ ...b, [id]: [] }));
    loadBlend(assetUrl(project!.id, id)!).then((res) => {
      const objs = res.objects.filter((o) => (o.type === 'mesh' || o.type === 'armature') && !o.hidden && !(o.skinned && o.parent) && !res.objects.some((p) => p.name === o.parent && (p.type === 'mesh' || p.type === 'armature')));
      setBlendObjects((b) => ({ ...b, [id]: objs.map((o) => o.name) }));
    }).catch((e) => setLibError('Could not read ' + id + ': ' + e.message));
  };
  // The "runtime" library only holds the game player used by Export game; it is not an asset folder.
  const refresh = () => api.library().then((l) => { setLib(l.filter((x) => x.id !== 'runtime')); setLibError(''); }).catch((e) => setLibError(e.message));
  useEffect(() => { refresh(); }, []);
  useEffect(() => { (window as any).__gcOpenImport = (files: File[]) => setWizard(files); }, []);

  const items = useMemo<Item[]>(() => {
    if (!project) return [];
    const recent: string[] = project.recent ?? [];
    // The demos' own textures (Backrooms carpet / wallpapers / HUD icons, DungeonBound stonework) only clutter
    // other projects: show them in their demo only. Room.png is a reference photo, not a texture.
    // The two demo levels (Backrooms_V10.blend, DungeonBound_4.blend) stay on disk because the demos load them,
    // but they are not offered as browsable asset folders.
    const DEMO_BLENDS = /^(backrooms\/Backrooms_V10|dungeonbound\/DungeonBound_4)\.blend$/i;
    const DEMO_DIRS: Record<string, string> = { backrooms: 'backrooms', dungeonbound: 'dungeon' };
    const demoTexture = (p: string) => { const d = p.split('/')[0].toLowerCase(); return d in DEMO_DIRS && project.template !== DEMO_DIRS[d] && TEXTURE_EXTS.includes(extOf(p)); };
    const hidden = (libId: string, p: string) => libId === 'library' && (demoTexture(p) || DEMO_BLENDS.test(p) || /^backrooms\/Room\.png$/i.test(p));
    const libItems: Item[] = lib.flatMap((l) => l.files.filter((f) => !f.path.startsWith('.') && !/\.(mtl|txt|psd|json|blend1)$/i.test(f.path) && !hidden(l.id, f.path)).flatMap((f) => {
      const ext = extOf(f.path);
      const kind: Item['kind'] = MODEL_EXTS.includes(ext) ? 'model' : TEXTURE_EXTS.includes(ext) ? 'texture' : AUDIO_EXTS.includes(ext) ? 'audio' : VIDEO_EXTS.includes(ext) ? 'video' : ext === 'ttf' || ext === 'otf' ? 'font' : 'texture';
      const id = `lib:${l.id}/${f.path}`;
      const existing = project.assets.find((a) => a.id === id);
      const ref: AssetRef = existing ?? { id, name: f.path.split('/').pop()!.replace(/\.[^.]+$/, ''), kind: kind as any, source: 'library', extra: ext === 'obj' ? [id.replace(/\.obj$/i, '.mtl')] : undefined };
      const item: Item = { id, name: ref.name + (ext === 'blend' ? ' (.blend)' : ''), kind, source: l.label, ref, size: f.size, modified: f.modified };
      if (ext !== 'blend') return [item];
      // A .blend expands into its objects once opened (selecting it reads the file natively).
      const objs = (blendObjects[id] ?? []).map((o): Item => {
        const oid = id + '#' + o;
        const r = project.assets.find((a) => a.id === oid) ?? { id: oid, name: o, kind: 'model', source: 'library' };
        return { id: oid, name: o, kind: 'model', source: l.label + ' › ' + ref.name, ref: r };
      });
      return [item, ...objs];
    }));
    const imported: Item[] = project.assets.filter((a) => a.source === 'imported' && (!sub || folderOf(a) === sub || folderOf(a).startsWith(sub + '/'))).map((a) => ({ id: a.id, name: a.name, kind: a.kind, source: 'Imported › ' + folderOf(a), ref: a }));
    const starter: Item[] = [
      ...ADD_MENU[0].items.map((it) => ({ id: 'prim:' + it.kind, name: it.label, kind: 'primitive' as const, source: 'Starter', primitive: `${it.kind}|${it.type}` })),
      ...PROCEDURAL_SPRITES.map((s) => ({ id: 'proc:' + s, name: s, kind: 'sprite' as const, source: 'Starter sprites', thumb: spriteThumb(s) ?? undefined })),
    ];
    const prefabs: Item[] = project.prefabs.map((p) => ({ id: 'prefab:' + p.name, name: p.name, kind: 'prefab' as const, source: 'Prefabs' }));
    // PBR material sets: textures in one folder that share a name (carpet_basecolor / _normal / _roughness …).
    const materialsOf = (list: Item[], source: string): Item[] => groupPbrSets(list.filter((i) => i.kind === 'texture').map((i) => ({ id: i.id, path: i.id.replace(/^(lib:[^/]+|proj:)\/?/, '') })))
      .map((s) => ({ id: 'mat:' + s.maps.color, name: s.name, kind: 'material' as const, source: source + (s.folder ? ' › ' + s.folder : ''), pbr: s }));
    const particles: Item[] = [...Object.entries(PARTICLE_PRESETS).map(([k, v]) => ({ id: 'particle:' + k, name: v.name, kind: 'particle' as const, source: 'Starter effects' })),
      ...Object.keys(project.particlePresets).filter((k) => !k.includes('#')).map((k) => ({ id: 'particle:' + k, name: k, kind: 'particle' as const, source: 'Project effects' }))];
    const libAll = [...libItems, ...materialsOf(libItems, 'Library')], impAll = [...imported, ...materialsOf(imported, 'Imported')];
    const all = [...starter, ...particles, ...libAll, ...impAll, ...prefabs];
    let list = folder === 'starter' ? [...starter, ...particles] : folder === 'library' ? libAll : folder === 'imported' ? impAll : folder === 'prefabs' ? prefabs
      : folder === 'favorites' ? all.filter((i) => project.favorites.includes(i.id)) : recent.map((r) => all.find((i) => i.id === r)).filter(Boolean) as Item[];
    list = list.filter((i) => inTab(i, tab));
    if (q) list = list.filter((i) => (i.name + ' ' + i.id).toLowerCase().includes(q.toLowerCase()));
    return list;
  }, [project, lib, folder, q, tab, sub, blendObjects]);
  if (!project) return null;
  // Folders of imported assets: their own folder, else one per kind; plus empty ones made with New folder.
  const subFolders = [...new Set([...project.assets.filter((a) => a.source === 'imported').map(folderOf), ...(project.assetFolders ?? [])])].sort();
  const moveTo = (id: string, to: string) => store.mutate('Move asset', (p) => { const a = p.assets.find((x) => x.id === id); if (a) a.folder = to; });
  const newFolder = () => {
    const n = window.prompt('New folder name (use / for a folder inside another, e.g. Sprites/Enemies)', sub ? sub + '/' : '');
    const clean = n?.split('/').map((s) => s.trim()).filter(Boolean).join('/');
    if (clean) { store.mutate('New asset folder', (p) => { p.assetFolders = [...new Set([...(p.assetFolders ?? []), clean])]; }); setSub(clean); }
  };
  const importAnim = async (files: File[]) => {
    try {
      const r = await importAnimation(files);
      if (curScene(project).mode === '2d') addObject('sprite', r.image.split('/').slice(-2)[0].replace(/[^A-Za-z0-9_]/g, '') || 'Sprite', { sprite: { image: r.image, frames: r.frames, rows: r.rows, fps: r.fps, animation: r.animation, animations: r.animations, pixelArt: true } });
      store.log('info', `Imported ${Object.keys(r.animations).join(', ')} into Assets › Imported › ${r.image.split('/').slice(-2)[0]}`);
      setFolder('imported');
    } catch (e: any) { store.log('error', `Animation import failed: ${e.message ?? e}`); }
  };

  const usage = (id: string) => project.scenes.reduce((n, s) => n + s.instances.filter((i) => i.mesh?.asset === id || i.sprite?.image === id || i.material?.map === id || i.text?.font === id || i.text?.icon === id).length, 0);
  const touchRecent = (id: string) => store.mutate('Recent asset', (p) => { p.recent = [id, ...(p.recent ?? []).filter((x) => x !== id)].slice(0, 20); });
  const dragStart = (e: React.DragEvent, it: Item) => {
    if (it.kind === 'primitive') e.dataTransfer.setData('x-gc-primitive', it.primitive!);
    else if (it.kind === 'prefab') e.dataTransfer.setData('x-gc-prefab', it.name);
    else if (it.kind === 'sprite') e.dataTransfer.setData('x-gc-asset', JSON.stringify({ id: it.id, name: it.name, kind: 'sprite' }));
    else if (it.ref) { if (it.ref.kind !== 'model') registerAsset(it.ref); e.dataTransfer.setData('x-gc-asset', JSON.stringify(it.ref)); }
    touchRecent(it.id);
  };
  const place = (it: Item) => {
    touchRecent(it.id);
    if (it.kind === 'primitive') { const [k, t] = it.primitive!.split('|'); addObject(k as any, t); }
    else if (it.kind === 'material' && it.pbr) applyMaterialSet(it.pbr);
    else if (it.kind === 'particle') addObject('emitter', it.name.replace(/[^A-Za-z0-9_]/g, '') || 'Effect', { emitter: { preset: it.id.slice(9), params: {}, playing: true } });
    else if (it.kind === 'prefab') placePrefab(it.name);
    else if (it.kind === 'sprite') addObject('sprite', it.name, { sprite: { image: it.id, frames: 1, fps: 8, animation: '', pixelArt: true } });
    else if (it.ref?.kind === 'model') addModel(it.ref);
    else if (it.ref?.kind === 'texture' && curScene(project!).mode === '2d') {
      // In 2D an image becomes a sprite, keeping any sprite-sheet slicing remembered on the image.
      registerAsset(it.ref);
      const sh = (it.ref.meta as any)?.sheet;
      addObject('sprite', it.name.replace(/[^A-Za-z0-9_]/g, '') || 'Sprite', { sprite: { image: it.id, frames: sh?.frames ?? 1, rows: sh?.rows ?? 1, fps: sh?.fps ?? 8, animation: '', animations: sh?.animations, pixelArt: true } });
    }
    else if (it.ref) { registerAsset(it.ref); store.log('info', `"${it.name}" added to the project. Assign it in the Inspector (Texture / Font / Icon) or drop it on an object.`); }
  };
  /** A PBR set goes onto the selected objects' materials, one texture per slot (ambient occlusion is preview-only). */
  const applyMaterialSet = (s: PbrSet) => {
    const sel = store.get().selection;
    if (!sel.length) { store.log('warn', `Select the object(s) to give the "${s.name}" material, then double-click it again (or drop it on an object).`); return; }
    for (const id of Object.values(s.maps)) { const r = items.find((x) => x.id === id)?.ref ?? lib.flatMap((l) => l.files.map((f) => `lib:${l.id}/${f.path}`)).filter((x) => x === id).map((x) => ({ id: x, name: x.split('/').pop()!.replace(/\.[^.]+$/, ''), kind: 'texture' as const, source: 'library' as const }))[0]; if (r) registerAsset(r as AssetRef); }
    store.mutate(`Material: ${s.name}`, (p) => {
      for (const i of curScene(p).instances) {
        if (!sel.includes(i.uid) || !i.material) continue;
        const maps: Partial<Record<MapSlot, ReturnType<typeof newSlot>>> = {};
        for (const [slot, id] of Object.entries(s.maps)) if (id) maps[slot as MapSlot] = newSlot(id);
        i.material = { ...i.material, map: undefined, maps, surface: 'standard', roughness: s.maps.roughness ? 1 : i.material.roughness, metalness: s.maps.metalness ? 1 : i.material.metalness };
        i.color = '#ffffff';
      }
    });
    store.log('info', `Applied the "${s.name}" material (${Object.keys(s.maps).join(', ')}).`);
  };
  const replace = (from: Item) => {
    const to = window.prompt(`Replace every use of "${from.name}" with which asset id?\n(e.g. ${project.assets.find((a) => a.kind === from.kind && a.id !== from.id)?.id ?? 'lib:models/Coin.obj'})`);
    if (!to) return;
    store.mutate(`Replace ${from.name}`, (p) => { for (const s of p.scenes) for (const i of s.instances) { if (i.mesh?.asset === from.id) i.mesh.asset = to; if (i.sprite?.image === from.id) i.sprite.image = to; if (i.material?.map === from.id) i.material.map = to; } });
  };
  const remove = (it: Item) => {
    const n = usage(it.id);
    if (!window.confirm(`Remove "${it.name}" from the project?${n ? `\n${n} object(s) still use it and will show a placeholder.` : ''}\nThe file itself is kept on disk.`)) return;
    store.mutate('Remove asset', (p) => { p.assets = p.assets.filter((a) => a.id !== it.id); });
    setSel(null);
  };

  return (
    <div className="assets">
      <div className="as-folders">
        {([['starter', '🧊', 'Starter'], ['library', '📁', 'Library'], ['imported', 'download', 'Imported'], ['prefabs', 'layers', 'Prefabs'], ['favorites', 'star', 'Favorites'], ['recent', 'clock', 'Recent']] as const).map(([f, ic, l]) => (
          <button key={f} className={folder === f ? 'on' : ''} onClick={() => { setFolder(f); setSub(''); }}>{ic.length <= 2 ? ic : <Icon name={ic} size={14} />} {l}</button>
        ))}
        <label className="btn primary small imp">Import…<input type="file" multiple hidden onChange={(e) => e.target.files && setWizard([...e.target.files])} /></label>
        <label className="btn small" title="GIFs or numbered pictures (walk_01.png…): one sprite sheet with a named animation each, in its own folder">Import animation…<input type="file" multiple accept=".gif,.png,.jpg,.jpeg,.webp" hidden onChange={(e) => { const fs = [...(e.target.files ?? [])]; e.target.value = ''; if (fs.length) importAnim(fs); }} /></label>
        <button className="btn small" onClick={refresh} title="Rescan library folders"><Icon name="refresh-cw" size={13} /> Rescan</button>
      </div>
      <div className="as-main">
      {folder === 'imported' && (
        <div className="as-subfolders">
          {['', ...subFolders].map((f) => (
            <button key={f || '(all)'} className={sub === f ? 'on' : ''} onClick={() => setSub(f)} title={f ? 'Drop an asset here to move it into this folder' : 'Every imported asset'}
              onDragOver={(e) => { if (f && e.dataTransfer.types.includes('x-gc-asset')) e.preventDefault(); }}
              onDrop={(e) => { const a = e.dataTransfer.getData('x-gc-asset'); if (f && a) { e.preventDefault(); moveTo(JSON.parse(a).id, f); } }}>
              <Icon name="folder" size={13} /> {f || 'All'}
            </button>
          ))}
          <button className="btn small" onClick={newFolder}><Icon name="folder-plus" size={13} /> New folder</button>
        </div>
      )}
        <div className="seg as-tabs">{TABS.map(([id, l]) => <button key={id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>{l}</button>)}</div>
        <div className="panel-tools">
          <input className="txt small" placeholder="Search assets…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />

          {libError && <span className="warn small">Library: {libError}</span>}
          {folder === 'library' && <span className="hint small">Drop your own models into GameCraft/Assets or GameCraft/asset-library, then Rescan.</span>}
        </div>
        <div className="as-grid" onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); }} onDrop={(e) => { if (e.dataTransfer.files.length) { e.preventDefault(); setWizard([...e.dataTransfer.files]); } }}>
          {items.map((it) => (
            <div key={it.id} className={'as-item' + (sel?.id === it.id ? ' sel' : '')} draggable onDragStart={(e) => dragStart(e, it)} onClick={() => { setSel(it); if (extOf(it.id) === 'blend' && !it.id.includes('#')) openBlend(it.id); }} onDoubleClick={() => place(it)} title={`${it.name}\n${it.id}\nDouble-click to add, or drag into the viewport`}>
              <Thumb it={it} projectId={project.id} />
              <div className="as-name">{project.favorites.includes(it.id) ? '★ ' : ''}{it.name}</div>
              <div className="as-kind">{it.kind}</div>
            </div>
          ))}
          {!items.length && <div className="hint">Nothing here yet.{folder === 'imported' ? ' Use Import… or drop files here.' : ''}</div>}
        </div>
      </div>
      {sel && (
        <div className="as-info">
          <b>{sel.name}</b>
          <div className="dim small">{sel.id}</div>
          <div>Type: {sel.kind} · Source: {sel.source}</div>
          {sel.pbr && <div className="as-maps">{Object.entries(sel.pbr.maps).map(([slot, id]) => <figure key={slot} title={id}><img src={assetUrl(project.id, id!) ?? undefined} alt="" /><figcaption>{slot === 'ao' ? 'AO' : slot}</figcaption></figure>)}</div>}
          {sel.pbr && <div className="hint small">Double-click (or Add to scene) applies it to the selected object(s), one texture per material property.</div>}
          {sel.size != null && <div>File size: {(sel.size / 1024).toFixed(1)} KB</div>}
          {sel.ref?.meta?.vertices != null && <div>{sel.ref.meta.meshes} mesh(es), {sel.ref.meta.vertices} vertices</div>}
          {sel.ref?.meta?.materials && <div>Materials: {sel.ref.meta.materials.join(', ')}</div>}
          {sel.ref?.meta?.animations?.length ? <div>Animations: {sel.ref.meta.animations.join(', ')}</div> : null}
          {sel.ref?.meta?.size && <div>Size: {sel.ref.meta.size.map((n) => n.toFixed(2)).join(' × ')} m</div>}
          <div>Used by {usage(sel.id)} object(s)</div>
          <div className="btn-row">
            <button className="btn small" onClick={() => place(sel)}>Add to scene</button>
            <button className="btn small" onClick={() => store.mutate('Favorite', (p) => { p.favorites = p.favorites.includes(sel.id) ? p.favorites.filter((f) => f !== sel.id) : [...p.favorites, sel.id]; })}>{project.favorites.includes(sel.id) ? '☆ Unfavorite' : '★ Favorite'}</button>
            {sel.ref && sel.kind !== 'prefab' && <button className="btn small" onClick={() => replace(sel)}>Replace uses…</button>}
            {sel.ref?.source === 'imported' && <button className="btn small" onClick={() => setWizard([])}>Reimport…</button>}
            {sel.ref?.source === 'imported' && <button className="btn small" onClick={() => { const n = window.prompt('Display name', sel.name); if (n) store.mutate('Rename asset', (p) => { const a = p.assets.find((x) => x.id === sel.id); if (a) a.name = n; }); }}>Rename</button>}
            {sel.ref && sel.ref.source !== 'starter' && <button className="btn small danger" onClick={() => remove(sel)}>Remove</button>}
            {sel.kind === 'prefab' && <button className="btn small danger" onClick={() => { if (window.confirm('Delete prefab?')) store.mutate('Delete prefab', (p) => { p.prefabs = p.prefabs.filter((x) => x.name !== sel.name); }); }}>Delete prefab</button>}
          </div>
        </div>
      )}
      {wizard && <ImportWizard files={wizard} reimport={wizard.length === 0 ? sel?.ref : undefined} onClose={() => { setWizard(null); refresh(); }} />}
    </div>
  );
}

function Thumb({ it, projectId }: { it: Item; projectId: string }) {
  const [src, setSrc] = useState<string | undefined>(it.thumb);
  useEffect(() => {
    if (it.thumb) { setSrc(it.thumb); return; }
    if (it.kind === 'primitive' && it.primitive) {
      let live = true;
      const kind = it.primitive.split('|')[0];
      if (kind === 'light' || kind === 'camera' || kind === 'empty' || kind === 'text' || kind === 'emitter') return;
      primitiveThumb(kind === 'voxel' ? 'box' : kind, kind === 'voxel' ? '#7a9b4a' : '#8fa3bf').then((d) => live && setSrc(d)).catch(() => undefined);
      return () => { live = false; };
    }
    if (it.kind === 'texture' && it.ref) { setSrc(assetUrl(projectId, it.ref.id) ?? undefined); return; }
    if (it.kind === 'material' && it.pbr) {
      // PBR set: lit sphere with every map (base colour, normal, roughness, metallic, AO, emission, opacity).
      let live = true;
      const urls = Object.fromEntries(Object.entries(it.pbr.maps).map(([k, id]) => [k, assetUrl(projectId, id!) ?? undefined]));
      materialSphereThumb(urls).then((d) => live && setSrc(d)).catch(() => undefined);
      return () => { live = false; };
    }
    // A whole .blend is a container (its objects get their own thumbnails).
    if (it.kind === 'model' && it.ref && !(extOf(it.ref.id) === 'blend' && !it.ref.id.includes('#'))) {
      const url = assetUrl(projectId, it.ref.id); if (!url) return;
      let live = true;
      const mtl = it.ref.extra?.find((x) => x.endsWith('.mtl'));
      modelThumb(url, it.ref.importSettings, mtl ? assetUrl(projectId, mtl) ?? undefined : undefined, it.modified ?? 0).then((d) => live && setSrc(d)).catch(() => live && setSrc(undefined));
      return () => { live = false; };
    }
  }, [it.id, it.modified]);
  const icon = ({ primitive: 'square', prefab: 'layers', audio: 'music', video: 'film', font: 'type', model: 'box', texture: 'image', sprite: 'person-standing', material: 'circle', particle: 'sparkles' } as const)[it.kind as 'model'] ?? 'help-circle';
  return <div className="as-thumb">{src ? <img src={src} alt="" draggable={false} /> : <Icon name={icon} size={30} />}</div>;
}

export { curScene, editorRefs };
