// Right-click menu for objects (viewport and Outliner): parenting that keeps world transforms, and edits that apply to
// every selected object at once: rename, object type, collision, texture, model (logic kept), duplicate, group, delete.
import React, { useEffect, useState } from 'react';
import { store, useStore } from '../project/store';
import { api } from '../project/api';
import type { AssetRef } from '../project/types';
import {
  COLLISION_MODES, applyTextureToSelection, curScene, deleteSelection, duplicateSelection, groupSelection,
  renameSelection, replaceModelOfSelection, setCollisionOfSelection, setParent, setTypeOfSelection,
} from './actions';

const MODEL_EXT = /\.(glb|gltf|fbx|obj|blend)$/i, TEXTURE_EXT = /\.(png|jpe?g|webp|gif)$/i;

/** Project assets of a kind plus the asset library's files of that kind (library ones are registered when used). */
export function useAssets(kind: 'model' | 'texture'): AssetRef[] {
  const project = useStore((s) => s.project);
  const [lib, setLib] = useState<AssetRef[]>([]);
  useEffect(() => {
    let live = true;
    api.library().then((ls) => {
      if (!live) return;
      const re = kind === 'model' ? MODEL_EXT : TEXTURE_EXT;
      setLib(ls.flatMap((l) => l.files.filter((f) => re.test(f.path)).map((f) => ({ id: `lib:${l.id}/${f.path}`, name: f.path.split('/').pop()!.replace(/\.[^.]+$/, ''), kind, source: 'library' as const }))));
    }).catch(() => { /* library offline: project assets only */ });
    return () => { live = false; };
  }, [kind]);
  const own = (project?.assets ?? []).filter((a) => a.kind === kind);
  return [...own, ...lib.filter((l) => !own.some((a) => a.id === l.id))];
}

type Mode = 'menu' | 'rename' | 'type' | 'texture' | 'model';

export function ObjectContextMenu({ x, y, onClose }: { x: number; y: number; onClose: () => void }) {
  const project = useStore((s) => s.project);
  const selection = useStore((s) => s.selection);
  const [mode, setMode] = useState<Mode>('menu');
  const [text, setText] = useState('');
  const [numbered, setNumbered] = useState(true);
  const [filter, setFilter] = useState('');
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, []);
  if (!project || !selection.length) return null;
  const s = curScene(project);
  const sel = s.instances.filter((i) => selection.includes(i.uid));
  const active = s.instances.find((i) => i.uid === selection[selection.length - 1]);
  const anyParented = sel.some((i) => i.parent != null);
  const n = sel.length;
  const run = (fn: () => void) => { fn(); onClose(); };
  // Keep the menu inside the window.
  const left = Math.min(x, window.innerWidth - 260), top = Math.min(y, window.innerHeight - 380);
  const style = { left, top, maxHeight: '70vh', overflowY: 'auto' as const };

  if (mode === 'rename' || mode === 'type') {
    const types = [...new Set(s.instances.map((i) => i.type))].sort();
    const ok = () => run(() => (mode === 'rename' ? renameSelection(text, numbered) : setTypeOfSelection(text)));
    return <div className="lx-menu" style={{ ...style, padding: 8, width: 240 }} onPointerDown={(e) => e.stopPropagation()}>
      <div className="menu-title">{mode === 'rename' ? `Rename ${n} object${n > 1 ? 's' : ''}` : `Object type of ${n}`}</div>
      <input autoFocus value={text} list={mode === 'type' ? 'ctx-types' : undefined} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') ok(); }} style={{ width: '100%', margin: '4px 0' }} />
      {mode === 'type' && <datalist id="ctx-types">{types.map((t) => <option key={t} value={t} />)}</datalist>}
      {mode === 'rename' && n > 1 && <label style={{ fontSize: 11, display: 'block', margin: '2px 0 6px' }}><input type="checkbox" checked={numbered} onChange={(e) => setNumbered(e.target.checked)} /> Number them ({text || 'Name'} 1, {text || 'Name'} 2…)</label>}
      {mode === 'type' && <div style={{ fontSize: 11, opacity: 0.75, margin: '0 0 6px' }}>Event blocks pick objects by type: the selection then follows {text ? `"${text}"` : 'that type'}'s events. Its behaviors and variables stay.</div>}
      <div style={{ display: 'flex', gap: 6 }}><button className="btn small" onClick={ok}>OK</button><button className="btn small" onClick={onClose}>Cancel</button></div>
    </div>;
  }
  if (mode === 'texture' || mode === 'model') return <AssetPicker kind={mode} style={style} filter={filter} setFilter={setFilter} count={n}
    onPick={(a) => run(() => (mode === 'texture' ? applyTextureToSelection(a) : replaceModelOfSelection(a)))} onClose={onClose} />;

  const is3d = s.mode !== '2d';
  return <div className="lx-menu" style={style} onPointerDown={(e) => e.stopPropagation()} onContextMenu={(e) => e.preventDefault()}>
    <div className="menu-title">{n === 1 ? sel[0].name : `${n} objects`}</div>
    {n > 1 && active && <button title="The last selected object becomes the parent; everything keeps its place, rotation and size" onClick={() => run(() => setParent(selection.slice(0, -1), active.uid))}>Parent to {active.name} <span style={{ float: 'right', opacity: 0.6 }}>Ctrl+P</span></button>}
    {anyParented && <button title="Out of its parent, keeping its place, rotation and size" onClick={() => run(() => setParent(selection, null))}>Clear parent <span style={{ float: 'right', opacity: 0.6 }}>Alt+P</span></button>}
    {(n > 1 || anyParented) && <hr />}
    <button onClick={() => { setText(n === 1 ? sel[0].name : (active?.name ?? '').replace(/[ .]\d+$/, '')); setMode('rename'); }}>Rename{n > 1 ? ` ${n}` : ''}…</button>
    <button onClick={() => { setText(active?.type ?? ''); setMode('type'); }}>Change object type…</button>
    <div className="menu-sub">Collision</div>
    {COLLISION_MODES.map(([m, label]) => <button key={m} onClick={() => run(() => setCollisionOfSelection(m))}>{label}</button>)}
    <hr />
    <button onClick={() => { setFilter(''); setMode('texture'); }}>Apply texture…</button>
    {is3d && <button title="Swap the model; name, type (its events), behaviors, variables and transform are kept" onClick={() => { setFilter(''); setMode('model'); }}>Replace model (keep logic)…</button>}
    <hr />
    <button onClick={() => run(duplicateSelection)}>Duplicate <span style={{ float: 'right', opacity: 0.6 }}>Shift+D</span></button>
    {n > 1 && <button onClick={() => run(groupSelection)}>Group <span style={{ float: 'right', opacity: 0.6 }}>Ctrl+G</span></button>}
    <button className="danger" onClick={() => run(deleteSelection)}>Delete{n > 1 ? ` ${n}` : ''} <span style={{ float: 'right', opacity: 0.6 }}>Del</span></button>
  </div>;
}

function AssetPicker({ kind, style, filter, setFilter, count, onPick, onClose }: { kind: 'texture' | 'model'; style: React.CSSProperties; filter: string; setFilter: (s: string) => void; count: number; onPick: (a: AssetRef) => void; onClose: () => void }) {
  const all = useAssets(kind);
  const f = filter.toLowerCase();
  const list = all.filter((a) => !f || a.name.toLowerCase().includes(f) || a.id.toLowerCase().includes(f)).slice(0, 200);
  return <div className="lx-menu" style={{ ...style, padding: 8, width: 280 }} onPointerDown={(e) => e.stopPropagation()}>
    <div className="menu-title">{kind === 'texture' ? 'Texture' : 'Model'} for {count} object{count > 1 ? 's' : ''}</div>
    <input autoFocus placeholder="Search…" value={filter} onChange={(e) => setFilter(e.target.value)} style={{ width: '100%', margin: '4px 0' }} />
    <div style={{ maxHeight: 260, overflowY: 'auto' }}>
      {list.map((a) => <button key={a.id} title={a.id} onClick={() => onPick(a)}>{a.name}<span style={{ float: 'right', opacity: 0.5, fontSize: 10 }}>{a.source === 'library' ? 'library' : 'project'}</span></button>)}
      {!list.length && <div style={{ fontSize: 11, opacity: 0.7, padding: 6 }}>Nothing found. Import one in the Assets panel.</div>}
    </div>
    <button className="btn small" style={{ marginTop: 6 }} onClick={onClose}>Cancel</button>
  </div>;
}
