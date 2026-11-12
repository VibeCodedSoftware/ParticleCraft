// Side-panel editors for one block or one event, shared by the node graph and logic-brick styles.
import React from 'react';
import { BLOCK_DEFS, CATEGORIES, blockSentence } from '../src/blocks/definitions';
import type { BlockInstance, EventBlock } from '../src/schema';
import { BEHAVIORS } from '../src/runtime/behaviors';
import { ExprHints, ParamInput, type EditorEnv } from './ParamEditor';

export function BlockInspector({ block, env, onPatch, onDelete, extra }: {
  block: BlockInstance; env: EditorEnv; onPatch: (p: Partial<BlockInstance>) => void; onDelete?: () => void; extra?: React.ReactNode;
}) {
  const def = BLOCK_DEFS[block.block];
  if (!def) return <div className="lx-insp"><div className="lx-insp-head">Unknown block</div><p className="lx-doc">{block.block} is kept unchanged (it comes from a newer version or an extension).</p></div>;
  const cat = CATEGORIES.find((c) => c.id === def.category);
  return (
    <div className="lx-insp">
      <ExprHints env={env} />
      <div className="lx-insp-head" style={{ borderColor: cat?.color }}>
        <span className="lx-chip" style={{ background: cat?.color }}>{cat?.name}</span>
        <b>{def.trigger ? 'When ' : ''}{def.name}</b>
      </div>
      <p className="lx-doc">{def.doc}</p>
      <div className="lx-form">
        {def.target === 'object' && (
          <label><span>Object</span>
            <select className="lx-input" value={block.target} onChange={(e) => onPatch({ target: e.target.value })}>
              {!env.types.some((t) => t.name === block.target) && <option>{block.target}</option>}
              {env.types.map((t) => <option key={t.name} value={t.name}>{t.name}{def.behavior && !t.behaviors.includes(def.behavior) ? ` (no ${BEHAVIORS[def.behavior]?.name})` : ''}</option>)}
            </select>
          </label>
        )}
        {def.params.map((p) => (
          <label key={p.name} title={p.doc}><span>{p.label}</span>
            <ParamInput p={p} value={block.params[p.name] ?? p.default} env={env} target={block.target} siblings={block.params}
              onChange={(v) => onPatch({ params: { ...block.params, [p.name]: v } })} onChangeMany={(patch) => onPatch({ params: { ...block.params, ...patch } })} />
          </label>
        ))}
        {def.kind === 'condition' && !def.trigger && (
          <label><span>Invert (NOT)</span><input type="checkbox" checked={!!block.invert} onChange={(e) => onPatch({ invert: e.target.checked || undefined })} /></label>
        )}
        <label><span>Disabled</span><input type="checkbox" checked={!!block.disabled} onChange={(e) => onPatch({ disabled: e.target.checked || undefined })} /></label>
        <label><span>Comment</span><input className="lx-input" value={block.comment ?? ''} onChange={(e) => onPatch({ comment: e.target.value || undefined })} /></label>
      </div>
      <div className="lx-preview">{blockSentence(def, block.params, block.target)}</div>
      {extra}
      {onDelete && <button className="lx-btn danger" onClick={onDelete}>Delete block</button>}
    </div>
  );
}

export function EventInspector({ ev, onPatch, onDelete, extra }: { ev: EventBlock; onPatch: (p: Partial<EventBlock>) => void; onDelete: () => void; extra?: React.ReactNode }) {
  return (
    <div className="lx-insp">
      <div className="lx-insp-head"><b>{ev.loose ? 'Loose blocks (not running)' : ev.isElse ? 'Else event' : 'Event'}</b></div>
      <div className="lx-form">
        {ev.loose && <button className="lx-btn primary" onClick={() => onPatch({ loose: false })}>Run these blocks every tick</button>}
        <label title="Any condition true passes, instead of all"><span>OR conditions</span><input type="checkbox" checked={!!ev.isOr} onChange={(e) => onPatch({ isOr: e.target.checked || undefined })} /></label>
        <label title="Runs only when the event before it did not run"><span>Else</span><input type="checkbox" checked={!!ev.isElse} onChange={(e) => onPatch({ isElse: e.target.checked || undefined })} /></label>
        <label><span>Disabled</span><input type="checkbox" checked={!!ev.disabled} onChange={(e) => onPatch({ disabled: e.target.checked || undefined })} /></label>
        <label><span>Breakpoint</span><input type="checkbox" checked={!!ev.breakpoint} onChange={(e) => onPatch({ breakpoint: e.target.checked || undefined })} /></label>
      </div>
      <div className="lx-doc">{ev.conditions.length} condition(s) · {ev.actions.length} action(s) · {ev.children.length} sub-event(s){ev.locals?.length ? ` · ${ev.locals.length} local variable(s)` : ''}</div>
      {extra}
      <button className="lx-btn danger" onClick={onDelete}>Delete event</button>
    </div>
  );
}
