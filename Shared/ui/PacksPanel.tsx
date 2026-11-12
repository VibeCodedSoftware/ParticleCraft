// Presets UI (formerly Packs): ready-made systems and the user's own saved setups. Drag a card onto the logic editor
// (or click it), pick which objects it applies to — with a preview of what it adds — and it becomes an ordinary,
// editable group of events. Any group in the sheet can be saved as your own preset.
import React, { useEffect, useMemo, useState } from 'react';
import { Glyph } from './icons';
import { createPortal } from 'react-dom';
import { PACK_CATEGORIES, PACKS, customToPack, packAvailable, packDefaults, previewPack, resolvePack, type LogicPack, type PackContext } from '../src/packs';
import { BLOCK_DEFS } from '../src/blocks/definitions';
import type { CustomPreset, ParamValue } from '../src/schema';

const DROP_EVENT = 'craft-pack-drop';
const SAVE_EVENT = 'craft-preset-save';
const MIME = 'x-craft-pack';

/** Wrap the logic editor: dropping a preset card on it opens the preset's setup. */
export function PackDropZone({ children }: { children: React.ReactNode }) {
  const [over, setOver] = useState(false);
  const has = (e: React.DragEvent) => e.dataTransfer.types.includes(MIME);
  return (
    <div className={'pk-drop' + (over ? ' over' : '')}
      onDragOverCapture={(e) => { if (has(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setOver(true); } }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(false); }}
      onDropCapture={(e) => { if (!has(e)) return; e.preventDefault(); e.stopPropagation(); setOver(false); window.dispatchEvent(new CustomEvent(DROP_EVENT, { detail: e.dataTransfer.getData(MIME) })); }}>
      {children}
      {over && <div className="pk-drop-hint">Drop to add this preset</div>}
    </div>
  );
}

/** The app's context (which app, 2D / 3D) and the document's own presets, set by PacksHost; the palette list reads them. */
let currentCtx: PackContext | null = null;
let currentCustom: CustomPreset[] = [];
let deleteCustom: ((id: string) => void) | null = null;

/**
 * Presets in the blocks palette (its Presets category): search, browse by category, drag a card onto the logic
 * editor or click it to set it up (with a preview). "Save a group as preset…" keeps one of your groups for reuse.
 */
export function PackList() {
  const [q, setQ] = useState('');
  const [, redraw] = useState(0);
  const ctx = currentCtx;
  const all = useMemo(() => [...currentCustom.map(customToPack), ...PACKS], [currentCustom.length, ctx?.app, ctx?.mode]);
  const list = all.filter((p) => (!ctx || packAvailable(p, ctx)) && (!q || (p.name + p.description + p.category).toLowerCase().includes(q.toLowerCase())));
  return (
    <div className="pk-list">
      <p className="lx-doc">Presets: ready-made setups (movement, platforms, touch controls, enemy AI, trails, health bars, inventory, menus) and your own. Drag one onto your logic, or click it: it becomes normal blocks in one group you can read and change.</p>
      <input className="lx-input pk-search" placeholder="Search presets…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
      <button className="lx-btn pk-save" title="Keep one of your groups (with its object's behaviors) as a preset to reuse here and on other objects" onClick={() => window.dispatchEvent(new CustomEvent(SAVE_EVENT))}>★ Save a group as preset…</button>
      {PACK_CATEGORIES.map((c) => {
        const items = list.filter((p) => p.category === c.id);
        if (!items.length) return null;
        return (
          <div key={c.id} className="pk-cat">
            <div className="pk-cat-name">{c.id}</div>
            {items.map((p) => (
              <div key={p.id} className="pk-card" draggable title="Drag onto the logic editor, or click to set up"
                onDragStart={(e) => { e.dataTransfer.setData(MIME, p.id); e.dataTransfer.setData('text/plain', p.name); e.dataTransfer.effectAllowed = 'copy'; }}
                onClick={() => window.dispatchEvent(new CustomEvent(DROP_EVENT, { detail: p.id }))}>
                <span className="pk-txt"><b>{p.name}</b><span>{p.description}</span></span>
                {p.id.startsWith('custom:') && <button className="lx-btn pk-del" title="Delete this preset" onClick={(e) => { e.stopPropagation(); if (window.confirm(`Delete the preset "${p.name}"?`)) { deleteCustom?.(p.id.slice(7)); redraw((n) => n + 1); } }}>✕</button>}
              </div>
            ))}
          </div>
        );
      })}
      {!list.length && <i className="lx-doc">No presets match.</i>}
    </div>
  );
}

/**
 * Preset setup and install for an app's logic editor (mount once): a preset dropped or clicked in the palette opens
 * its setup; `onInstall` performs the (undoable) change and returns its report. `groups` (the sheet's groups) and
 * `onSaveGroup` let the user save their own presets; `custom` lists them.
 */
export function PacksHost({ ctx, types, onInstall, custom = [], groups = [], onSaveGroup, onDeleteCustom }: {
  ctx: PackContext; types: string[]; onInstall: (packId: string, opts: Record<string, ParamValue>) => string[];
  custom?: CustomPreset[]; groups?: { id: string; name: string }[];
  onSaveGroup?: (groupId: string, meta: { name: string; category: string; description: string }) => void;
  onDeleteCustom?: (id: string) => void;
}) {
  const [setup, setSetup] = useState<LogicPack | null>(null);
  const [report, setReport] = useState<string[] | null>(null);
  const [saving, setSaving] = useState(false);
  currentCtx = ctx; currentCustom = custom; deleteCustom = onDeleteCustom ?? null;
  useEffect(() => {
    const h = (e: Event) => { const p = resolvePack((e as CustomEvent<string>).detail, { customPresets: currentCustom } as any); if (p) setSetup(p); };
    const s = () => setSaving(true);
    window.addEventListener(DROP_EVENT, h); window.addEventListener(SAVE_EVENT, s);
    return () => { window.removeEventListener(DROP_EVENT, h); window.removeEventListener(SAVE_EVENT, s); };
  }, []);
  return (
    <>
      {setup && createPortal(<PackSetup pack={setup} ctx={ctx} types={types} onCancel={() => setSetup(null)} onAdd={(opts) => { const r = onInstall(setup.id, opts); setSetup(null); setReport(r); }} />, document.body)}
      {saving && createPortal(<SavePreset groups={groups} onCancel={() => setSaving(false)} onSave={(g, meta) => { onSaveGroup?.(g, meta); setSaving(false); setReport([`Saved "${meta.name}" in Presets › My presets. Apply it to any object type; it is kept with this project.`]); }} />, document.body)}
      {report && createPortal(
        <div className="lx-modal-back" onMouseDown={() => setReport(null)}>
          <div className="lx-modal" onMouseDown={(e) => e.stopPropagation()}>
            <div className="lx-modal-head"><b>Preset</b></div>
            <ul className="pk-report">{report.map((r, i) => <li key={i} className={r.startsWith('⚠') ? 'warn' : r.startsWith('ⓘ') ? 'info' : ''}>{r.startsWith('⚠') ? <><Glyph e="⚠" i="alert-triangle" size={12} />{r.slice(1)}</> : r.startsWith('ⓘ') ? <><Glyph e="ⓘ" i="info" size={12} />{r.slice(1)}</> : r}</li>)}</ul>
            <p className="lx-doc">Undo (Ctrl+Z) removes everything the preset added.</p>
            <div className="lx-modal-foot"><button className="lx-btn primary" onClick={() => setReport(null)}>OK</button></div>
          </div>
        </div>, document.body,
      )}
    </>
  );
}

function SavePreset({ groups, onCancel, onSave }: { groups: { id: string; name: string }[]; onCancel: () => void; onSave: (groupId: string, meta: { name: string; category: string; description: string }) => void }) {
  const [g, setG] = useState(groups[0]?.id ?? '');
  const [name, setName] = useState(groups[0]?.name ?? '');
  const [description, setDescription] = useState('');
  return (
    <div className="lx-modal-back" onMouseDown={onCancel}>
      <div className="lx-modal" onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') onCancel(); }}>
        <div className="lx-modal-head"><b>Save a group as preset</b></div>
        {!groups.length ? <p className="lx-doc">This sheet has no groups yet. Put the events you want to reuse in a group (or add a preset and change it), then save it here.</p> : <>
          <p className="lx-doc">The group's blocks and the behaviors (with their settings) of the object they act on are saved. Applying it later can point the blocks at another object type.</p>
          <div className="pk-form">
            <label className="pk-row"><span>Group</span><select className="lx-input" value={g} onChange={(e) => { setG(e.target.value); setName(groups.find((x) => x.id === e.target.value)?.name ?? name); }}>{groups.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
            <label className="pk-row"><span>Name</span><input className="lx-input" value={name} onChange={(e) => setName(e.target.value)} /></label>
            <label className="pk-row"><span>Description</span><input className="lx-input" value={description} placeholder="What it does" onChange={(e) => setDescription(e.target.value)} /></label>
          </div>
        </>}
        <div className="lx-modal-foot"><button className="lx-btn" onClick={onCancel}>Cancel</button>{groups.length > 0 && <button className="lx-btn primary" disabled={!g || !name.trim()} onClick={() => onSave(g, { name: name.trim(), category: 'My presets', description })}>Save preset</button>}</div>
      </div>
    </div>
  );
}

function PackSetup({ pack, ctx, types, onCancel, onAdd }: { pack: LogicPack; ctx: PackContext; types: string[]; onCancel: () => void; onAdd: (o: Record<string, ParamValue>) => void }) {
  // Object options default to the preset's suggestion when the scene has it, otherwise keep the name (reported as missing).
  const [o, setO] = useState<Record<string, ParamValue>>(() => packDefaults(pack));
  const set = (k: string, v: ParamValue) => setO({ ...o, [k]: v });
  const pv = useMemo(() => { try { return previewPack(pack, o, ctx); } catch { return null; } }, [pack, JSON.stringify(o), ctx.app, ctx.mode]);
  const names = pv ? [...new Set(pv.blocks.map((b) => BLOCK_DEFS[b]?.name ?? b))] : [];
  return (
    <div className="lx-modal-back" onMouseDown={onCancel}>
      <div className="lx-modal" onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') onCancel(); }}>
        <div className="lx-modal-head"><b>{pack.name}</b></div>
        <p className="lx-doc">{pack.description}</p>
        <div className="pk-form">
          {pack.options.map((op) => (
            <label key={op.key} className="pk-row" title={op.doc}>
              <span>{op.label}</span>
              {op.type === 'objectType' ? (
                <span className="pk-obj">
                  <select className="lx-input" value={types.includes(String(o[op.key])) ? String(o[op.key]) : ''} onChange={(e) => set(op.key, e.target.value)}>
                    {!types.includes(String(o[op.key])) && <option value="">{String(o[op.key])} (not in scene)</option>}
                    {types.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                  {!types.includes(String(o[op.key])) && <input className="lx-input" value={String(o[op.key])} onChange={(e) => set(op.key, e.target.value.replace(/[^A-Za-z0-9_]/g, ''))} title="Type name to use" />}
                </span>
              ) : op.type === 'boolean' ? <input type="checkbox" checked={!!o[op.key]} onChange={(e) => set(op.key, e.target.checked)} />
                : op.type === 'choice' ? <select className="lx-input" value={String(o[op.key])} onChange={(e) => set(op.key, e.target.value)}>{op.options!.map((c) => <option key={c} value={c}>{c.startsWith('#') ? '■ ' + c : c}</option>)}</select>
                  : op.type === 'number' ? <input className="lx-input" type="number" value={Number(o[op.key])} onChange={(e) => set(op.key, Number(e.target.value))} />
                    : <input className="lx-input" value={String(o[op.key])} onChange={(e) => set(op.key, e.target.value)} />}
            </label>
          ))}
          {!pack.options.length && <i className="lx-doc">Nothing to set up.</i>}
        </div>
        {pv && <div className="pk-preview">
          <b>Adds</b>
          <ul>
            {pv.events > 0 && <li>{pv.events} event{pv.events === 1 ? '' : 's'} in one group: {names.slice(0, 10).join(', ')}{names.length > 10 ? '…' : ''}</li>}
            {pv.behaviors.map((b) => <li key={b}>Behavior: {b}</li>)}
            {pv.objects.length > 0 && <li>Objects: {pv.objects.join(', ')}</li>}
            {!pv.events && !pv.behaviors.length && !pv.objects.length && <li>Settings only (see the description)</li>}
          </ul>
        </div>}
        <div className="lx-modal-foot"><button className="lx-btn" onClick={onCancel}>Cancel</button><button className="lx-btn primary" onClick={() => onAdd(o)}>Add to logic</button></div>
      </div>
    </div>
  );
}
