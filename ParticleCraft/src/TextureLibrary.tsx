// Texture library UI: the sidebar panel (import, preview, rename, folders, favourites, search, replace, delete,
// sprite-sheet grid) and the picker used by Texture / Flipbook / Material / Spawn-from-image nodes.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { detectSheet } from '@shared/src/sheetDetect';
import { assetUrl, importBakedFlipbook, importTextureFiles, texLib, useTexLib, type TexAsset } from './textureLib';
import { api, pc } from './store';

const ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,.png,.jpg,.jpeg,.webp,.gif,.json';

/** Animated preview of a sheet's frames (or the plain picture). */
export function SheetPreview({ a, size = 96, playing = true }: { a: TexAsset; size?: number; playing?: boolean }) {
  const [f, setF] = useState(0);
  const s = a.sheet;
  useEffect(() => {
    if (!s || s.frames <= 1 || !playing) return;
    const id = setInterval(() => setF((x) => (x + 1) % s.frames), 1000 / (s.fps ?? 12));
    return () => clearInterval(id);
  }, [s?.frames, s?.fps, playing]);
  if (!s || s.frames <= 1) return <img className="tl-thumb checker" src={assetUrl(a)} alt="" style={{ width: size, height: size }} draggable={false} />;
  const cw = a.w / s.cols, ch = a.h / s.rows, k = size / Math.max(cw, ch);
  return (
    <span className="tl-thumb checker" style={{ width: size, height: size }}>
      <span style={{ display: 'block', width: cw * k, height: ch * k, backgroundImage: `url("${assetUrl(a)}")`, backgroundSize: `${a.w * k}px ${a.h * k}px`, backgroundPosition: `${-(f % s.cols) * cw * k}px ${-Math.floor(f / s.cols) * ch * k}px`, margin: 'auto' }} />
    </span>
  );
}

/** Picks a texture: library assets, texture-graph outputs, or a new import. Value: "asset:<id>" / "node:<id>" / data URL. */
export function TexturePicker({ value, onChange, nodes = [], wantSheet }: { value: string; onChange: (ref: string, a?: TexAsset) => void; nodes?: { id: string; name: string }[]; wantSheet?: boolean }) {
  const lib = useTexLib();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const cur = value?.startsWith('asset:') ? lib.items.find((x) => x.id === value.slice(6)) : undefined;
  const node = value?.startsWith('node:') ? nodes.find((n) => n.id === value.slice(5)) : undefined;
  const list = lib.items.filter((a) => !q || (a.name + a.folder).toLowerCase().includes(q.toLowerCase())).sort((a, b) => Number(!!b.favorite) - Number(!!a.favorite) || (wantSheet ? Number(b.kind === 'sheet') - Number(a.kind === 'sheet') : 0) || a.name.localeCompare(b.name));
  return (
    <span className="tp">
      <button className="tp-cur" onClick={() => setOpen(!open)} title="Choose a picture">
        {cur ? <SheetPreview a={cur} size={28} playing={false} /> : value?.startsWith('data:') ? <img className="tl-thumb checker" src={value} alt="" style={{ width: 28, height: 28 }} /> : <span className="tl-thumb empty" style={{ width: 28, height: 28 }} />}
        <span>{cur ? cur.name : node ? `Node: ${node.name}` : value?.startsWith('data:') ? 'Embedded picture' : value ? 'Missing picture' : 'None'}</span>
      </button>
      {open && (
        <div className="tp-pop" onPointerLeave={() => setOpen(false)}>
          <input autoFocus placeholder="Search textures…" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="tp-grid">
            <button className="tp-item" onClick={() => { onChange(''); setOpen(false); }}><span className="tl-thumb empty" style={{ width: 44, height: 44 }} /><small>None</small></button>
            {nodes.map((n) => <button key={n.id} className={'tp-item' + (node?.id === n.id ? ' on' : '')} onClick={() => { onChange('node:' + n.id); setOpen(false); }}><span className="tl-thumb node" style={{ width: 44, height: 44 }}>◆</span><small>{n.name}</small></button>)}
            {list.map((a) => <button key={a.id} className={'tp-item' + (cur?.id === a.id ? ' on' : '')} title={`${a.name} · ${a.w}×${a.h}${a.sheet ? ` · ${a.sheet.cols}×${a.sheet.rows} sheet` : ''}`} onClick={() => { onChange('asset:' + a.id, a); setOpen(false); }}><SheetPreview a={a} size={44} playing={false} /><small>{a.favorite ? '★ ' : ''}{a.name}</small></button>)}
          </div>
          <label className="tl-import">Import…<input type="file" accept={ACCEPT} hidden onChange={async (e) => { const f = [...(e.target.files ?? [])]; e.target.value = ''; if (!f.length) return; const r = await importTextureFiles(f, '', wantSheet); if (r.added[0]) { onChange('asset:' + r.added[0].id, r.added[0]); setOpen(false); } if (r.notes.length) pc.set({ status: r.notes.join(' · ') }); }} /></label>
        </div>
      )}
    </span>
  );
}

/** The Textures tab of the sidebar. `onUse` adds the asset to the selected system (as a Texture or Flipbook node). */
export function TextureLibraryPanel({ onUse }: { onUse?: (a: TexAsset, as: 'texture' | 'flipbook') => void }) {
  const lib = useTexLib();
  const [q, setQ] = useState('');
  const [folder, setFolder] = useState<string>('*');
  const [favOnly, setFavOnly] = useState(false);
  const [sel, setSel] = useState<string | null>(null);
  const [busy, setBusy] = useState('');
  const replaceRef = useRef<HTMLInputElement>(null);
  const [exch, setExch] = useState<{ path: string; name: string; frames: number }[] | null>(null);
  const openExchange = async () => {
    try {
      const files = (await api.exchangeList()).filter((x) => x.path.endsWith('.vfx.json'));
      const found: { path: string; name: string; frames: number }[] = [];
      for (const x of files) { try { const a = await api.exchangeGet(x.path); if (a?.kind === 'baked' && a.flipbook) found.push({ path: x.path, name: a.name, frames: a.flipbook.frames }); } catch { /* skip unreadable */ } }
      setExch(found);
    } catch (e: any) { setBusy('Exchange folder unavailable: ' + e.message); }
  };
  useEffect(() => { if (!texLib.loaded()) texLib.load().catch((e) => setBusy('Library unavailable: ' + e.message)); }, []);
  const folders = useMemo(() => [...new Set([...lib.folders, ...lib.items.map((a) => a.folder).filter(Boolean)])].sort(), [lib]);
  const items = lib.items.filter((a) => (folder === '*' || a.folder === folder) && (!favOnly || a.favorite) && (!q || (a.name + ' ' + a.folder + ' ' + (a.source ?? '')).toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => Number(!!b.favorite) - Number(!!a.favorite) || b.modified.localeCompare(a.modified));
  const a = sel ? lib.items.find((x) => x.id === sel) : undefined;
  const doImport = async (files: File[]) => {
    if (!files.length) return;
    setBusy('Importing…');
    try { const r = await importTextureFiles(files, folder === '*' ? '' : folder); setBusy(r.notes.join(' · ') || `Imported ${r.added.length}`); if (r.added[0]) setSel(r.added[0].id); }
    catch (e: any) { setBusy('Import failed: ' + e.message); }
  };
  return (
    <div className="tl" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); doImport([...e.dataTransfer.files]); }}>
      <div className="tl-tools">
        <label className="tl-import">Import images…<input type="file" multiple accept={ACCEPT} hidden onChange={(e) => { const f = [...(e.target.files ?? [])]; e.target.value = ''; doImport(f); }} /></label>
        <button title="Animations sent from SpriteCraft (and baked ParticleCraft effects) in the shared exchange folder" onClick={openExchange}>From SpriteCraft…</button>
        <button title="New folder" onClick={async () => { const n = window.prompt('Folder name'); if (n) { await texLib.addFolder(n.trim()); setFolder(n.trim()); } }}>+ Folder</button>
      </div>
      <input className="pc-search" placeholder="Search textures…" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="tl-filters">
        <select value={folder} onChange={(e) => setFolder(e.target.value)}><option value="*">All folders</option><option value="">(No folder)</option>{folders.map((f) => <option key={f}>{f}</option>)}</select>
        <label><input type="checkbox" checked={favOnly} onChange={(e) => setFavOnly(e.target.checked)} /> ★ only</label>
      </div>
      {busy && <div className="tl-busy">{busy}</div>}
      {exch && (
        <div className="tl-exch">
          <div className="vx-row"><b>Shared exchange folder</b><button onClick={() => setExch(null)}>✕</button></div>
          {exch.length ? exch.map((x) => <button key={x.path} onClick={async () => { setBusy('Importing…'); const a0 = await api.exchangeGet(x.path); const a = await importBakedFlipbook(a0); setSel(a.id); setBusy(`"${a.name}" imported as a ${a.sheet?.cols}×${a.sheet?.rows} flipbook`); setExch(null); }}>{x.name} <small>{x.frames} frames</small></button>)
            : <span className="vx-doc">No animations yet. In SpriteCraft use "Send to the Craft apps" (or bake an effect here).</span>}
        </div>
      )}
      <div className="tl-grid">
        {items.map((x) => (
          <button key={x.id} className={'tl-item' + (x.id === sel ? ' on' : '')} onClick={() => setSel(x.id)} title={`${x.name} (${x.w}×${x.h})`}
            draggable onDragStart={(e) => e.dataTransfer.setData('text/x-craft-texture', x.id)}>
            <SheetPreview a={x} size={64} playing={x.id === sel} />
            <small>{x.favorite ? '★ ' : ''}{x.name}</small>
          </button>
        ))}
        {!items.length && <p className="vx-doc">No textures{q || folder !== '*' || favOnly ? ' match' : ' yet'}. Import PNG, JPG, WebP or GIF files (or drop them here): transparency is kept, sprite sheets are detected, GIF frames become a sheet.</p>}
      </div>
      {a && (
        <div className="tl-detail">
          <SheetPreview a={a} size={140} />
          <label>Name<input value={a.name} onChange={(e) => texLib.update(a.id, (x) => { x.name = e.target.value; })} /></label>
          <label>Folder<select value={a.folder} onChange={(e) => texLib.update(a.id, (x) => { x.folder = e.target.value; })}><option value="">(No folder)</option>{folders.map((f) => <option key={f}>{f}</option>)}</select></label>
          <span className="vx-doc">{a.w}×{a.h} px · {a.mime.replace('image/', '').toUpperCase()}{a.source ? ` · from ${a.source}` : ''}</span>
          <label className="chk"><input type="checkbox" checked={a.kind === 'sheet'} onChange={(e) => texLib.update(a.id, (x) => { x.kind = e.target.checked ? 'sheet' : 'image'; x.sheet = e.target.checked ? x.sheet ?? { cols: 4, rows: 4, frames: 16, padding: 0, spacing: 0 } : undefined; })} /> Sprite sheet / flipbook</label>
          {a.sheet && <SheetEditor a={a} />}
          <div className="vx-row">
            <button onClick={() => texLib.update(a.id, (x) => { x.favorite = !x.favorite; })}>{a.favorite ? '★ Unfavourite' : '☆ Favourite'}</button>
            <button title="Load a new picture into this asset; every node using it updates" onClick={() => replaceRef.current?.click()}>Replace…</button>
            <button className="danger" onClick={async () => { if (window.confirm(`Delete "${a.name}" from the library? Effects that use it will show a missing-picture warning.`)) { await texLib.remove(a.id); setSel(null); } }}>Delete</button>
          </div>
          {onUse && <div className="vx-row"><button onClick={() => onUse(a, 'texture')}>Use as Texture</button><button disabled={!a.sheet} onClick={() => onUse(a, 'flipbook')}>Use as Flipbook</button></div>}
          <input ref={replaceRef} type="file" accept={ACCEPT} hidden onChange={async (e) => {
            const f = e.target.files?.[0]; e.target.value = ''; if (!f) return;
            const bmp = await createImageBitmap(f);
            await texLib.put(f, { name: a.name, mime: f.type || 'image/png', w: bmp.width, h: bmp.height, kind: a.kind, sheet: a.sheet, replace: a.id, source: f.name });
            bmp.close(); setBusy(`Replaced "${a.name}" — node connections kept`);
          }} />
        </div>
      )}
    </div>
  );
}

/** Sprite-sheet grid: auto-detect, rows, columns, frame count, padding/spacing, frame rate, frame strip. */
function SheetEditor({ a }: { a: TexAsset }) {
  const s = a.sheet!;
  const set = (p: Partial<typeof s>) => texLib.update(a.id, (x) => { x.sheet = { ...x.sheet!, ...p }; const cells = x.sheet.cols * x.sheet.rows; if (x.sheet.frames > cells || p.cols || p.rows) x.sheet.frames = Math.min(p.frames ?? cells, cells); });
  const auto = async () => {
    const img = new Image(); img.crossOrigin = 'anonymous'; img.src = assetUrl(a); await img.decode();
    const c = document.createElement('canvas'); c.width = a.w; c.height = a.h; const g = c.getContext('2d', { willReadFrequently: true })!; g.drawImage(img, 0, 0);
    const d = detectSheet(g.getImageData(0, 0, a.w, a.h).data, a.w, a.h);
    set({ cols: d.cols, rows: d.rows, frames: d.frames });
    pc.set({ status: `Detected ${d.cols}×${d.rows} (${d.frames} frames, by ${d.how})` });
  };
  const num = (label: string, v: number, k: keyof typeof s, min = 0) => <label>{label}<input type="number" min={min} value={v} onChange={(e) => set({ [k]: Math.max(min, Math.round(Number(e.target.value))) } as any)} /></label>;
  const cw = a.w / s.cols, ch = a.h / s.rows;
  return (
    <div className="tl-sheet">
      <div className="vx-row"><button onClick={auto}>Detect grid</button></div>
      {num('Columns', s.cols, 'cols', 1)}{num('Rows', s.rows, 'rows', 1)}{num('Frames', s.frames, 'frames', 1)}
      {num('Padding (px)', s.padding, 'padding')}{num('Spacing (px)', s.spacing, 'spacing')}
      <label>Preview fps<input type="number" min={1} max={60} value={s.fps ?? 12} onChange={(e) => set({ fps: Math.max(1, Math.min(60, Number(e.target.value))) })} /></label>
      <div className="tl-frames">
        {Array.from({ length: Math.min(s.frames, 64) }, (_, f) => (
          <span key={f} title={`Frame ${f}`} className="tl-frame checker" style={{ backgroundImage: `url("${assetUrl(a)}")`, backgroundSize: `${(a.w / cw) * 28}px ${(a.h / ch) * 28}px`, backgroundPosition: `${-(f % s.cols) * 28}px ${-Math.floor(f / s.cols) * 28}px` }} />
        ))}
      </div>
    </div>
  );
}
