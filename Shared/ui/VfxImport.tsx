// "Import from ParticleCraft": lists effects exported to the shared exchange folder, shows what this app can
// and cannot reproduce, and hands the chosen asset to the host app (which adds it to its project).
import React, { useEffect, useState } from 'react';
import { Glyph } from './icons';
import { parseVfxAsset, type VfxAsset } from '../src/vfx/vfx';
import { craftFxToAsset, parseCraftFx } from '../src/vfx/blender';
import type { AppId } from '../src/schema';

export function VfxImportDialog({ app, list, get, onImport, onClose }: {
  app: AppId;
  list: () => Promise<{ path: string; modified: number }[]>;
  get: (name: string) => Promise<string>;
  onImport: (a: VfxAsset, addToScene: boolean) => Promise<void> | void;
  onClose: () => void;
}) {
  const [items, setItems] = useState<{ path: string; asset?: VfxAsset; error?: string }[] | null>(null);
  const [sel, setSel] = useState<number>(-1);
  const [msg, setMsg] = useState('');
  const [place, setPlace] = useState(true);
  // ParticleCraft effects (.vfx.json) and Blender add-on exports (.craftfx.json, converted to effects here).
  const parse = (path: string, text: string) => (/\.craftfx\.json$/i.test(path) ? craftFxToAsset(parseCraftFx(text), path.split(/[\\/]/).pop()!) : parseVfxAsset(text));
  useEffect(() => {
    list().then(async (files) => {
      const vfx = files.filter((f) => /\.(vfx|craftfx)\.json$/i.test(f.path)).sort((a, b) => b.modified - a.modified);
      setItems(await Promise.all(vfx.map(async (f) => { try { return { path: f.path, asset: parse(f.path, await get(f.path)) }; } catch (e: any) { return { path: f.path, error: e.message }; } })));
    }).catch((e) => setMsg('Exchange folder unavailable: ' + e.message));
  }, []);
  const loadFile = async (f: File) => { try { const a = parse(f.name, await f.text()); setItems((x) => [{ path: f.name, asset: a }, ...(x ?? [])]); setSel(0); } catch (e: any) { setMsg('Not an effect: ' + e.message); } };
  const cur = items?.[sel]?.asset;
  const notes = cur ? (app === 'gamecraft' ? cur.compatibility?.gamecraft : cur.compatibility?.logiccraft) ?? [] : [];
  const usable = cur && cur.kind !== 'simulation' && (cur.kind === 'baked' ? !!cur.flipbook : !!cur.layers?.length);
  return (
    <div className="lx-modal-back" onMouseDown={onClose}>
      <div className="lx-modal wide" onMouseDown={(e) => e.stopPropagation()}>
        <div className="lx-modal-head"><b>Import from ParticleCraft or Blender</b><label className="lx-btn" style={{ marginLeft: 'auto' }}>Open file…<input type="file" accept=".json" hidden onChange={(e) => e.target.files?.[0] && loadFile(e.target.files[0])} /></label></div>
        <div className="vi-body">
          <div className="vi-list">
            {items === null && <div className="lx-doc">Loading…</div>}
            {items?.length === 0 && <div className="lx-doc">No effects yet. In ParticleCraft use <b>Export</b>, or in Blender the <b>Craft Export</b> add-on.</div>}
            {items?.map((it, i) => (
              <button key={it.path} className={'vi-item' + (i === sel ? ' on' : '')} onClick={() => setSel(i)}>
                {it.asset?.flipbook && <img src={it.asset.flipbook.image} alt="" style={it.asset.flipbook.pixelArt ? { imageRendering: 'pixelated' } : undefined} />}
                <b>{it.asset?.name ?? it.path}</b>
                <small>{it.error ? <><Glyph e="⚠" i="alert-triangle" size={11} /> {it.error}</> :`${it.asset!.kind === 'realtime' ? 'Real-time effect' : it.asset!.kind === 'baked' ? 'Baked flipbook' : 'Simulation (not importable)'} · ${it.asset!.category}`}</small>
              </button>
            ))}
          </div>
          <div className="vi-detail">
            {cur ? (
              <>
                <h3>{cur.name}</h3>
                <p className="lx-doc">{cur.description}</p>
                {cur.blender && <p className="lx-doc">Made from Blender particle systems ({cur.blender.objects.map((o) => `${o.name}: ${o.systems}`).join(', ')}).{app === 'gamecraft' && cur.blender.model ? ` If the add-on also sent the model (${cur.blender.model}), it comes in with the effect on it.` : ''}</p>}
                {cur.kind === 'realtime' && <p className="lx-doc">{cur.layers?.length} layer(s): {cur.layers?.map((l) => l.name).join(', ')}. Plays on the shared particle engine{app === 'gamecraft' ? ' in 3D' : ' on the 2D stage'}; spawn it with the Particles blocks{cur.exposed?.length ? `; exposed parameters (${cur.exposed.map((e) => e.name).join(', ')}) change with "Set effect parameter"` : ''}.</p>}
                {cur.kind === 'baked' && cur.flipbook && <><p className="lx-doc">Arrives as an animated sprite: {cur.flipbook.frames} frames at {cur.flipbook.fps} fps.</p><img className="vi-strip" src={cur.flipbook.image} alt="" style={cur.flipbook.pixelArt ? { imageRendering: 'pixelated' } : undefined} /></>}
                {cur.kind === 'simulation' && <div className="pc-warn"><Glyph e="⚠" i="alert-triangle" size={12} /> Simulation setups only run in ParticleCraft. Bake it to a flipbook or convert it to a real-time effect there first.</div>}
                {notes.map((n, i) => <div key={i} className="vi-warn"><Glyph e="⚠" i="alert-triangle" size={12} /> {n}</div>)}
                {usable && notes.length === 0 && <div className="vi-ok"><Glyph e="✓" i="check" size={12} /> Everything in this effect is reproduced in {app === 'gamecraft' ? 'GameCraft' : 'LogicCraft'}.</div>}
                {usable && <label className="vi-place"><input type="checkbox" checked={place} onChange={(e) => setPlace(e.target.checked)} /> Also add it to the {app === 'gamecraft' ? 'scene' : 'stage'}</label>}
              </>
            ) : <p className="lx-doc">Choose an effect.</p>}
            {msg && <div className="lx-preview">{msg}</div>}
          </div>
        </div>
        <div className="lx-modal-foot">
          <button className="lx-btn" onClick={onClose}>Close</button>
          <button className="lx-btn primary" disabled={!usable} onClick={async () => { try { await onImport(cur!, place); setMsg(`Imported "${cur!.name}".`); } catch (e: any) { setMsg('Import failed: ' + e.message); } }}>Import</button>
        </div>
      </div>
    </div>
  );
}

/** PNG data URL → bytes (for hosts that store images as project files). */
export function dataUrlBytes(url: string): Uint8Array {
  const b = atob(url.split(',')[1] ?? '');
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
}
