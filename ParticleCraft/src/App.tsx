// ParticleCraft shell: home, library (presets, your effects, simulations), VFX graph / Simulation modes, export.
import React, { useEffect, useMemo, useState } from 'react';
import { Icon } from '@shared/ui/icons';
import { VFX_CATEGORIES, VFX_PRESETS, compileGraph, compatibilityOf, finalizeAsset, newAsset, type VfxAsset } from '@shared/src/vfx/vfx';
import { newId } from '@shared/src/schema';
import { api, exchangeName, pc, usePC } from './store';
import { VfxEditor } from './VfxEditor';
import { BakedView, SimulationView, newSimDoc } from './Simulation';
import { SIM_TYPES } from './sim/sims';
import { animatedWebp, bytesOf, download, gifOf, pngSequenceZip, renderFrames, sheetWithJson, spriteSheet, webmVideo, type RenderOpts } from './exportFx';
import { TextureLibraryPanel } from './TextureLibrary';
import { packEffect, unpackEffect } from './effectFile';
import { makeVariation } from '@shared/src/vfx/compose';
import { texLib } from './textureLib';
import { newBlock } from '@shared/src/vfx/vfx';

const KIND_LABEL: Record<string, string> = { realtime: 'Real-time', baked: 'Baked', simulation: 'Simulation' };
const KIND_DOC: Record<string, string> = {
  realtime: 'Game-ready: plays live in GameCraft (3D) and LogicCraft (2D) on the shared particle engine.',
  baked: 'Game-ready: a flipbook sprite sheet recorded from a simulation.',
  simulation: 'ParticleCraft only: bake it or convert it to use it in a game.',
};

function fromPreset(id: string): VfxAsset {
  const p = VFX_PRESETS.find((x) => x.id === id)!;
  const a = newAsset(p.name, p.build(), p.category);
  a.description = p.description;
  return a;
}

export function App() {
  const doc = usePC((s) => s.doc);
  const mode = usePC((s) => s.mode);
  const dirty = usePC((s) => s.dirty);
  const status = usePC((s) => s.status);
  const [mine, setMine] = useState<VfxAsset[]>([]);
  const [tab, setTab] = useState<'presets' | 'mine' | 'textures'>('presets');
  const [q, setQ] = useState('');
  const [look, setLook] = useState<'all' | 'stylized' | 'realistic' | 'hybrid' | 'fav'>('all');
  const [favs, setFavs] = useState<string[]>([]);
  useEffect(() => { api.getDoc<{ favPresets?: string[] }>('_prefs', {}).then((d) => setFavs(d.favPresets ?? [])); }, []);
  const toggleFav = (id: string) => { const next = favs.includes(id) ? favs.filter((x) => x !== id) : [...favs, id]; setFavs(next); api.getDoc<Record<string, any>>('_prefs', {}).then((d) => api.putDoc('_prefs', { ...d, id: '_prefs', name: 'Preferences', favPresets: next })); };
  const [exporting, setExporting] = useState(false);
  const [err, setErr] = useState('');
  const refresh = async () => {
    try { const list = await api.list(); setMine((await Promise.all(list.map((x) => api.load(x.id).catch(() => null)))).filter(Boolean) as VfxAsset[]); }
    catch (e: any) { setErr('Cannot reach the project folder: ' + e.message); }
  };
  useEffect(() => { refresh(); texLib.load().catch(() => undefined); }, []);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); pc.save().then(refresh); }
      if ((e.target as HTMLElement)?.closest?.('input,textarea,select')) return;
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? pc.redo() : pc.undo(); }
      if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); pc.redo(); }
    };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, []);
  useEffect(() => { if (status) { const t = setTimeout(() => pc.set({ status: '' }), 4000); return () => clearTimeout(t); } }, [status]);

  const open = (a: VfxAsset) => { if (pc.get().dirty && !window.confirm('Discard unsaved changes?')) return; pc.open(a); };
  const switchMode = (m: 'vfx' | 'sim') => {
    if (m === 'sim' && doc?.kind !== 'simulation') open(newSimDoc('fire'));
    else if (m === 'vfx' && doc?.kind === 'simulation') open(fromPreset('campfire'));
    else pc.set({ mode: m });
  };

  if (!doc) return <Home mine={mine} err={err} onOpen={open} onRefresh={refresh} />;
  const ql = q.toLowerCase();
  const presets = VFX_PRESETS.filter((p) => (!ql || (p.name + p.category + p.description).toLowerCase().includes(ql)) && (look === 'all' || (look === 'fav' ? favs.includes(p.id) : (p.look ?? 'stylized') === look)));

  return (
    <div className="pc">
      <div className="pc-top">
        <img src="/icon.png" className="pc-logo" alt="" onClick={() => { if (!dirty || window.confirm('Leave without saving?')) pc.set({ doc: null }); refresh(); }} title="Home" />
        <b>ParticleCraft</b>
        <div className="pc-seg">
          <button className={mode === 'vfx' ? 'on' : ''} onClick={() => switchMode('vfx')}><Icon name="sparkles" size={14} /> VFX Graph</button>
          <button className={mode === 'sim' ? 'on' : ''} onClick={() => switchMode('sim')}><Icon name="tornado" size={14} /> Simulation</button>
        </div>
        <input className="pc-name" value={doc.name} onChange={(e) => pc.mutate((d) => { d.name = e.target.value; })} />
        <span className={'pc-kind ' + doc.kind} title={KIND_DOC[doc.kind]}>{KIND_LABEL[doc.kind]}</span>
        <span className="grow" />
        {status && <span className="pc-status">{status}</span>}
        <button className="tb" onClick={() => pc.undo()} title="Undo (Ctrl+Z)">↶</button>
        <button className="tb" onClick={() => pc.redo()} title="Redo (Ctrl+Shift+Z)">↷</button>
        <button className="tb" onClick={() => { const c: VfxAsset = { ...JSON.parse(JSON.stringify(doc)), id: newId('vfx'), name: doc.name + ' copy' }; pc.open(c); pc.save().then(refresh); }}>Duplicate</button>
        {doc.kind === 'realtime' && doc.graph && <button className="tb" title="A copy with new random seeds and slightly different settings (save it as its own effect)" onClick={() => { const c: VfxAsset = { ...JSON.parse(JSON.stringify(doc)), id: newId('vfx'), name: doc.name + ' variation', variationOf: doc.id, graph: makeVariation(doc.graph!, 0.15) }; pc.open(c); pc.save().then(refresh); }}>Variation</button>}
        <button className="tb" onClick={() => pc.save().then(refresh)}>Save{dirty ? ' •' : ''}</button>
        <button className="tb accent" disabled={doc.kind === 'simulation'} title={doc.kind === 'simulation' ? 'Bake or convert the simulation first' : 'Send to GameCraft and LogicCraft, or export pictures (sprite, PNG sequence, GIF, sprite sheet)'} onClick={() => setExporting(true)}>Export…</button>
      </div>
      <div className="pc-main">
        <div className="pc-lib">
          <div className="pc-tabs"><button className={tab === 'presets' ? 'on' : ''} onClick={() => setTab('presets')}>Presets</button><button className={tab === 'mine' ? 'on' : ''} onClick={() => { setTab('mine'); refresh(); }}>My library ({mine.length})</button><button className={tab === 'textures' ? 'on' : ''} onClick={() => setTab('textures')}>Textures</button></div>
          {tab === 'textures' ? <TextureLibraryPanel onUse={doc.kind === 'realtime' ? (a, as) => {
            const sysId = pc.get().selSys, s = doc.graph?.systems.find((x) => x.id === sysId);
            if (!s) { pc.set({ status: 'Select a system in the graph first' }); return; }
            pc.mutate((d) => { const sy = d.graph!.systems.find((x) => x.id === s.id)!; const ex = sy.contexts.output.find((b) => b.type === as); const b = ex ?? newBlock(as); b.props.texture = 'asset:' + a.id; if (as === 'flipbook' && a.sheet) Object.assign(b.props, { cols: a.sheet.cols, rows: a.sheet.rows, frames: a.sheet.frames, padding: a.sheet.padding, spacing: a.sheet.spacing, sheetSize: [a.w, a.h] }); if (!ex) sy.contexts.output.push(b); });
            pc.set({ status: `"${a.name}" is now the ${as} of "${s.name}"` });
          } : undefined} /> : <>
          <input className="pc-search" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
          {tab === 'presets' && <div className="pc-looks">{(['all', 'stylized', 'realistic', 'hybrid', 'fav'] as const).map((k) => <button key={k} className={look === k ? 'on' : ''} onClick={() => setLook(k)}>{k === 'fav' ? '★' : k[0].toUpperCase() + k.slice(1)}</button>)}</div>}
          <div className="pc-list">
            {tab === 'presets' ? VFX_CATEGORIES.map((c) => {
              const list = presets.filter((p) => p.category === c);
              return list.length ? (
                <React.Fragment key={c}>
                  <div className="lib-head">{c}</div>
                  {list.map((p) => <div key={p.id} className="lib-item" title={p.description} onClick={() => open(fromPreset(p.id))}><b>{p.name}{p.look && p.look !== 'stylized' ? <span className={'pc-look ' + p.look}>{p.look}</span> : null}</b><small>{p.description}</small><button className={'lib-fav' + (favs.includes(p.id) ? ' on' : '')} title={favs.includes(p.id) ? 'Remove from favourites' : 'Add to favourites'} onClick={(e) => { e.stopPropagation(); toggleFav(p.id); }}>{favs.includes(p.id) ? '★' : '☆'}</button></div>)}
                </React.Fragment>
              ) : null;
            }) : (
              <>
                {(['realtime', 'baked', 'simulation'] as const).map((k) => {
                  const list = mine.filter((a) => a.kind === k && (!ql || a.name.toLowerCase().includes(ql)));
                  return (
                    <React.Fragment key={k}>
                      <div className="lib-head" title={KIND_DOC[k]}>{KIND_LABEL[k]} <span>{list.length}</span></div>
                      {list.map((a) => (
                        <div key={a.id} className={'lib-item mine' + (a.id === doc.id ? ' on' : '')} onClick={() => open(a)}>
                          {a.flipbook && <img src={a.flipbook.image} className="lib-thumb" alt="" />}
                          <b>{a.name}</b><small>{a.category} · {new Date(a.modified).toLocaleDateString()}</small>
                          <button className="lib-del" title="Delete" onClick={async (e) => { e.stopPropagation(); if (window.confirm(`Delete "${a.name}"?`)) { await api.remove(a.id); refresh(); } }}>✕</button>
                        </div>
                      ))}
                    </React.Fragment>
                  );
                })}
              </>
            )}
          </div>
          </>}
        </div>
        <div className="pc-work">
          {doc.kind === 'simulation' ? <SimulationView /> : doc.kind === 'baked' ? <BakedView /> : <VfxEditor />}
        </div>
      </div>
      {exporting && <ExportDialog doc={doc} onClose={() => setExporting(false)} />}
    </div>
  );
}

function Home({ mine, err, onOpen, onRefresh }: { mine: VfxAsset[]; err: string; onOpen: (a: VfxAsset) => void; onRefresh: () => void }) {
  const recent = useMemo(() => [...mine].sort((a, b) => b.modified.localeCompare(a.modified)).slice(0, 12), [mine]);
  return (
    <div className="home">
      <aside className="home-side">
        <div className="home-brand"><img src="/icon.png" alt="" /><span>ParticleCraft</span></div>
        <nav><a className="on">Home</a><a onClick={onRefresh}>Refresh library</a></nav>
        <div className="grow" />
        <div className="home-foot">Effects export to GameCraft and LogicCraft through the shared exchange folder.</div>
      </aside>
      <main className="home-main">
        <header className="home-head"><div><h1>Create an effect</h1><p>Build particle effects in a node graph, or experiment with physics simulations. Every preset is an editable graph.</p></div></header>
        {err && <div className="warn">{err}</div>}
        <section className="home-blank">
          <button className="blank-card" onClick={() => onOpen(newAsset('New effect', { systems: [], params: [] }))}><span className="blank-icon"><Icon name="sparkles" size={26} /></span><span><b>Empty VFX graph</b><small>Start from nothing and add systems</small></span></button>
          <label className="blank-card" title="An effect file (.vfx.json) exported from ParticleCraft on any computer: its pictures join your texture library"><span className="blank-icon"><Icon name="download" size={26} /></span><span><b>Import effect file…</b><small>Effects (with their textures) from other projects</small></span>
            <input type="file" accept=".json,application/json" hidden onChange={async (e) => {
              const f = e.target.files?.[0]; e.target.value = ''; if (!f) return;
              try { const r = await unpackEffect(await f.text()); await api.save(r.asset); onOpen(r.asset); onRefresh(); if (r.notes.length) pc.set({ status: r.notes.join(' · ') }); }
              catch (err: any) { window.alert('Could not import: ' + (err?.message ?? err)); }
            }} /></label>
          <button className="blank-card" onClick={() => onOpen(newSimDoc('fire'))}><span className="blank-icon"><Icon name="tornado" size={26} /></span><span><b>Simulation lab</b><small>Fire, smoke, water, tornado, wind, destruction</small></span></button>
        </section>
        <section>
          <div className="home-sec-head"><h2>Presets</h2></div>
          <div className="pc-grid">
            {VFX_PRESETS.map((p) => <button key={p.id} className="pc-card" onClick={() => onOpen(fromPreset(p.id))}><b>{p.name}</b><span>{p.category}</span><small>{p.description}</small></button>)}
            {SIM_TYPES.map((t) => <button key={t.id} className="pc-card sim" onClick={() => onOpen(newSimDoc(t.id))}><b><Icon name={t.icon} size={14} /> {t.name}</b><span>Simulation</span><small>{t.description}</small></button>)}
          </div>
        </section>
        {recent.length > 0 && (
          <section>
            <div className="home-sec-head"><h2>Recent</h2></div>
            <div className="pc-grid">{recent.map((a) => <button key={a.id} className="pc-card" onClick={() => onOpen(a)}><b>{a.name}</b><span>{KIND_LABEL[a.kind]}</span><small>{new Date(a.modified).toLocaleString()}</small></button>)}</div>
          </section>
        )}
      </main>
    </div>
  );
}

type PicFormat = 'sprite' | 'png' | 'jpg' | 'gif' | 'webp' | 'webm' | 'sheet' | 'sheetjson';
const PIC_FORMATS: [PicFormat, string][] = [['sprite', 'Sprite (one PNG frame)'], ['png', 'PNG image sequence (.zip)'], ['jpg', 'JPG image sequence (.zip)'], ['gif', 'Animated GIF'], ['webp', 'Animated WebP (smooth transparency)'], ['webm', 'Video (WebM)'], ['sheet', 'Sprite sheet (PNG grid)'], ['sheetjson', 'Sprite sheet + JSON (SpriteCraft, engines)']];

function ExportDialog({ doc, onClose }: { doc: VfxAsset; onClose: () => void }) {
  const [msg, setMsg] = useState('');
  const [tab, setTab] = useState<'games' | 'pictures'>('games');
  const asset = doc.kind === 'realtime' ? finalizeAsset(doc) : doc;
  const r = doc.kind === 'realtime' && doc.graph ? compileGraph(doc.graph) : null;
  const compat = asset.compatibility ?? (r ? compatibilityOf(r.layers) : { gamecraft: [], logiccraft: [] });
  // Picture settings (shared by "Send to LogicCraft").
  const [o, setO] = useState({ format: 'gif' as PicFormat, width: 256, height: 256, fps: 24, duration: 2, start: 0, end: 0, loop: true, warmUp: true, transparent: true, background: '#000000', quality: 2 as 1 | 2 | 3, view: 'front' as 'front' | '3d', yaw: 35, pitch: 20, cols: 0, rows: 0, padding: 0, colors: 256, at: 1, webpQuality: 0.9, bloom: 0.5 });
  const up = (p: Partial<typeof o>) => setO((x) => ({ ...x, ...p }));
  const totalFrames = Math.max(1, Math.round(o.duration * o.fps));
  const base = doc.name.replace(/[^A-Za-z0-9_-]+/g, '_') || 'effect';
  const shownShapes = (doc.graph?.shapes ?? []).filter((s) => !s.hideOriginal && doc.graph!.systems.some((sy) => sy.enabled && sy.source === s.id));
  const frames = (opts?: Partial<RenderOpts>) => renderFrames(r!.layers, {
    width: o.width, height: o.height, fps: o.fps, duration: o.duration, startFrame: o.start, endFrame: o.end > o.start ? o.end : undefined, warmUp: o.warmUp,
    view: o.view, yaw: (o.yaw * Math.PI) / 180, pitch: (o.pitch * Math.PI) / 180, transparent: o.transparent, background: o.background, quality: o.quality, shapes: shownShapes, bloom: o.bloom, ...opts,
  });
  const grid = (n: number) => { const cols = o.cols > 0 ? o.cols : Math.ceil(Math.sqrt(n)); return { cols, rows: o.rows > 0 ? o.rows : Math.ceil(n / cols) }; };
  const exportPictures = async () => {
    if (!r) return;
    setMsg('Rendering…'); await new Promise((res) => setTimeout(res, 30));
    try {
      if (o.format === 'sprite') { const f = frames({ startFrame: Math.min(totalFrames - 1, Math.round(o.at * o.fps)), endFrame: Math.min(totalFrames, Math.round(o.at * o.fps) + 1) }); download(await bytesOf(f[0]), `${base}.png`, 'image/png'); }
      else {
        const fs = frames();
        if (o.format === 'png' || o.format === 'jpg') download(await pngSequenceZip(fs, base, o.format === 'jpg'), `${base}_frames.zip`, 'application/zip');
        else if (o.format === 'gif') download(gifOf(fs, o.fps, o.loop, o.transparent, o.background, o.colors), `${base}.gif`, 'image/gif');
        else if (o.format === 'webp') download(await animatedWebp(fs, o.fps, o.loop, o.webpQuality), `${base}.webp`, 'image/webp');
        else if (o.format === 'webm') { setMsg(`Recording ${fs.length} frames (${(fs.length / o.fps).toFixed(1)} s)…`); download(await webmVideo(fs, o.fps), `${base}.webm`, 'video/webm'); }
        else if (o.format === 'sheetjson') { const gr = grid(fs.length); download(await sheetWithJson(fs, gr.cols, gr.rows, o.padding, o.fps, base), `${base}_sheet.zip`, 'application/zip'); }
        else { const gr = grid(fs.length); download(await bytesOf(spriteSheet(fs, gr.cols, gr.rows, o.padding)), `${base}_sheet_${gr.cols}x${gr.rows}.png`, 'image/png'); }
        setMsg(`Exported ${fs.length} frame(s).`);
        return;
      }
      setMsg('Exported 1 frame.');
    } catch (e: any) { setMsg('Export failed: ' + (e.message ?? e)); }
  };
  const sendGame = async () => {
    try {
      await api.save(doc);
      // Pictures travel inside the file (the games cannot reach this library).
      const packed = await packEffect(doc);
      await api.exchangePut(exchangeName(packed), JSON.stringify(packed, null, 1));
      setMsg(`Sent "${exchangeName(asset)}" (the 3D effect itself). In GameCraft choose "Import from ParticleCraft".`);
    } catch (e: any) { setMsg('Export failed: ' + e.message); }
  };
  /** LogicCraft is 2D: the effect is rendered into a flipbook strip (an animated sprite) with these settings. */
  const sendLogic = async () => {
    if (!r) return;
    try {
      setMsg('Rendering…'); await new Promise((res) => setTimeout(res, 30));
      const fs = frames().slice(0, Math.floor(8192 / o.width));
      const strip = spriteSheet(fs, fs.length, 1, 0);
      const t = new Date().toISOString();
      const pixelArt = r.layers.some((l) => l.params.style === 'pixel') || undefined;
      const baked: VfxAsset = { format: asset.format, schemaVersion: asset.schemaVersion, id: newId('vfx'), name: doc.name + ' (2D)', kind: 'baked', category: doc.category, created: t, modified: t, flipbook: { image: strip.toDataURL('image/png'), frames: fs.length, fps: o.fps, loop: o.loop, width: o.width, height: o.height, pixelArt } };
      await api.exchangePut(exchangeName(baked), JSON.stringify(baked));
      setMsg(`Sent "${exchangeName(baked)}" (${fs.length} frames, ${o.width}×${o.height}). In LogicCraft choose "+ ParticleCraft…" to add it as an animated sprite; in SpriteCraft open it from the exchange folder to retouch the frames.`);
    } catch (e: any) { setMsg('Export failed: ' + (e.message ?? e)); }
  };
  const downloadFile = async () => { const packed = await packEffect(doc); download(new Blob([JSON.stringify(packed, null, 1)], { type: 'application/json' }), exchangeName(packed)); setMsg(`Saved the effect file${packed.assets?.length ? ` with ${packed.assets.length} picture(s) inside` : ''}. Import it with "Import effect file…" on the home screen.`); };
  const num = (label: string, v: number, on: (n: number) => void, min = 0, step = 1, title?: string) => <label title={title}>{label}<input type="number" min={min} step={step} value={v} onChange={(e) => on(Number(e.target.value))} /></label>;
  const settings = (
    <div className="pc-expform">
      {num('Width (px)', o.width, (n) => up({ width: Math.max(8, Math.min(2048, n)) }), 8, 8)}
      {num('Height (px)', o.height, (n) => up({ height: Math.max(8, Math.min(2048, n)) }), 8, 8)}
      {num('Frame rate', o.fps, (n) => up({ fps: Math.max(1, Math.min(60, n)) }), 1)}
      {num('Duration (s)', o.duration, (n) => up({ duration: Math.max(0.05, Math.min(30, n)) }), 0.05, 0.1)}
      {num('From frame', o.start, (n) => up({ start: Math.max(0, Math.min(totalFrames - 1, Math.round(n))) }), 0, 1, `0–${totalFrames - 1}`)}
      {num('To frame (0 = end)', o.end, (n) => up({ end: Math.max(0, Math.min(totalFrames, Math.round(n))) }), 0, 1, `Up to ${totalFrames}`)}
      <label title="Looping effects start already running, so the first frames are not empty"><input type="checkbox" checked={o.warmUp} onChange={(e) => up({ warmUp: e.target.checked })} /> Start warmed up</label>
      <label><input type="checkbox" checked={o.loop} onChange={(e) => up({ loop: e.target.checked })} /> Looping animation</label>
      <label><input type="checkbox" checked={o.transparent} onChange={(e) => up({ transparent: e.target.checked })} /> Transparent background</label>
      {!o.transparent && <label>Background<input type="color" value={o.background} onChange={(e) => up({ background: e.target.value })} /></label>}
      <label>Quality<select value={o.quality} onChange={(e) => up({ quality: Number(e.target.value) as 1 | 2 | 3 })}><option value={1}>Draft</option><option value={2}>Good (2× smoothing)</option><option value={3}>Best (3×)</option></select></label>
      <label>View<select value={o.view} onChange={(e) => up({ view: e.target.value as any })}><option value="front">Front (as in 2D games)</option><option value="3d">3D angle</option></select></label>
      {o.view === '3d' && <>{num('Turn (°)', o.yaw, (n) => up({ yaw: n }), -360, 5)}{num('Tilt (°)', o.pitch, (n) => up({ pitch: Math.max(-89, Math.min(89, n)) }), -89, 5)}</>}
    </div>
  );
  return (
    <div className="lx-modal-back" onMouseDown={onClose}>
      <div className="lx-modal pc-export" onMouseDown={(e) => e.stopPropagation()}>
        <div className="lx-modal-head"><b>Export "{doc.name}"</b><span className={'pc-kind ' + doc.kind}>{KIND_LABEL[doc.kind]}</span></div>
        <div className="pc-tabs"><button className={tab === 'games' ? 'on' : ''} onClick={() => setTab('games')}>Send to the games</button><button className={tab === 'pictures' ? 'on' : ''} disabled={!r} onClick={() => setTab('pictures')}>Export pictures</button></div>
        {tab === 'games' ? <>
          <p className="lx-doc">{KIND_DOC[doc.kind]}</p>
          {r && <p className="lx-doc">{r.layers.length} layer(s){r.exposed.length ? ` · exposed parameters: ${r.exposed.map((x) => x.name).join(', ')} (change them with "Set effect parameter")` : ''}.</p>}
          {r?.warnings.map((w, i) => <div key={i} className="pc-warn">{w}</div>)}
          <div className="pc-compat">
            <div><b>GameCraft (3D)</b><span className="lx-doc">The real-time 3D effect itself.</span>{compat.gamecraft.length ? compat.gamecraft.map((c, i) => <div key={i} className="pc-warn">{c}</div>) : <div className="pc-ok">Everything is reproduced</div>}
              <button className="lx-btn primary" onClick={sendGame}>Send to GameCraft</button></div>
            <div><b>LogicCraft (2D)</b><span className="lx-doc">Real-time on the 2D stage, or rendered into an animated sprite ({o.width}×{o.height}, {o.fps} fps, {o.duration}s: change it under Export pictures).</span>{compat.logiccraft.length ? compat.logiccraft.map((c, i) => <div key={i} className="pc-warn">{c}</div>) : <div className="pc-ok">Everything is reproduced</div>}
              <span className="btn-row"><button className="lx-btn" onClick={sendGame} title="The effect itself, played by LogicCraft's 2D particle engine">Send real-time</button><button className="lx-btn primary" disabled={!r} onClick={sendLogic}>Send as animated sprite</button></span></div>
          </div>
        </> : <>
          <label className="pc-expfmt">Format<select value={o.format} onChange={(e) => up({ format: e.target.value as PicFormat })}>{PIC_FORMATS.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select></label>
          {settings}
          <div className="pc-expform">
            {o.format === 'sprite' && num('Frame at (s)', o.at, (n) => up({ at: Math.max(0, Math.min(o.duration, n)) }), 0, 0.1)}
            {o.format === 'webp' && <label title="Higher is sharper and bigger">WebP quality<input type="number" min={0.1} max={1} step={0.05} value={o.webpQuality} onChange={(e) => up({ webpQuality: Math.max(0.1, Math.min(1, Number(e.target.value))) })} /></label>}
            {o.format === 'webm' && <span className="lx-doc">Recorded in real time ({(o.duration).toFixed(1)} s). Some players show transparent areas as black.</span>}
            {o.format !== 'sprite' && <label title="Glow spread around bright particles">Bloom<input type="number" min={0} max={2} step={0.1} value={o.bloom} onChange={(e) => up({ bloom: Math.max(0, Math.min(2, Number(e.target.value))) })} /></label>}
            {o.format === 'gif' && <label title="Fewer colours make smaller files">Colours<select value={o.colors} onChange={(e) => up({ colors: Number(e.target.value) })}>{[32, 64, 128, 256].map((c) => <option key={c}>{c}</option>)}</select></label>}
            {(o.format === 'sheet' || o.format === 'sheetjson') && <>{num('Columns (0 = auto)', o.cols, (n) => up({ cols: Math.max(0, Math.round(n)) }))}{num('Rows (0 = auto)', o.rows, (n) => up({ rows: Math.max(0, Math.round(n)) }))}{num('Padding (px)', o.padding, (n) => up({ padding: Math.max(0, Math.round(n)) }))}</>}
          </div>
          <p className="lx-doc">{o.format === 'sprite' ? 'One frame' : `${Math.max(1, (o.end > o.start ? o.end : totalFrames) - o.start)} frames`} at {o.width}×{o.height}{o.format === 'sheet' || o.format === 'sheetjson' ? (() => { const n = Math.max(1, (o.end > o.start ? o.end : totalFrames) - o.start), gr = grid(n); return ` in a ${gr.cols}×${gr.rows} sheet (${gr.cols * o.width + (gr.cols - 1) * o.padding}×${gr.rows * o.height + (gr.rows - 1) * o.padding} px), ready for LogicCraft's sprite sheet slicer`; })() : ''}.{o.format === 'gif' && o.transparent ? ' GIF transparency is on/off per pixel, so soft glows get a hard edge: turn transparency off for a smoother look over a colour.' : ''}</p>
        </>}
        {msg && <div className="lx-preview">{msg}</div>}
        <div className="lx-modal-foot">
          <button className="lx-btn" onClick={downloadFile}>Download effect file</button>
          <button className="lx-btn" onClick={onClose}>Close</button>
          {tab === 'pictures' && <button className="lx-btn primary" onClick={exportPictures}>Export</button>}
        </div>
      </div>
    </div>
  );
}
