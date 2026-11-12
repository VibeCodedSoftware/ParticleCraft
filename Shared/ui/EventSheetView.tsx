// Construct 2-style event sheet: conditions on the left, actions on the right, sub-events nested,
// groups, comments, Else / OR, global and local variables. Edits go through logicOps on the shared IR.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CATEGORY_ICON, Glyph } from './icons';
import { BLOCK_DEFS, CATEGORIES, blockSentence } from '../src/blocks/definitions';
import { deepClone, defaultValueFor, newId, reassignIds, type BlockInstance, type EventBlock, type EventNode, type LogicDocument, type VarType } from '../src/schema';
import type { Issue } from '../src/validate';
import * as ops from './logicOps';
import { soundNames } from '../src/sounds';
import { BlockDialog, BlockPicker, docFunctions, type EditorEnv, type TypeSummary } from './ParamEditor';

export interface SheetProps {
  doc: LogicDocument;
  sheetId?: string;
  app: EditorEnv['app'];
  types: TypeSummary[];
  onChange: (doc: LogicDocument, label: string) => void;
  issues?: Issue[];
  trace?: Set<string>;
  particlePresets?: string[];
  focusBlockId?: string | null;
  readOnly?: boolean;
  sceneNames?: string[];
}

type Menu = { x: number; y: number; items: { label: string; action: () => void; danger?: boolean; sep?: boolean }[] } | null;
let clipboard: ops.LogicClipboard | null = null;
const VAR_TYPES: VarType[] = ['number', 'string', 'boolean', 'array', 'dict'];

export function EventSheetView(props: SheetProps) {
  const { doc, app, types, onChange, issues = [], trace } = props;
  const sheet = ops.sheetOf(doc, props.sheetId);
  const [sel, setSel] = useState<{ kind: 'node' | 'block'; id: string } | null>(null);
  const [picker, setPicker] = useState<{ kind: 'condition' | 'action'; eventId: string | null; parentId?: string | null; afterId?: string } | null>(null);
  const [dialog, setDialog] = useState<BlockInstance | null>(null);
  const [menu, setMenu] = useState<Menu>(null);
  const [filter, setFilter] = useState('');
  const [drop, setDrop] = useState<{ id: string; where: 'before' | 'after' | 'into' } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const issueByBlock = useMemo(() => { const m = new Map<string, Issue>(); for (const i of issues) if (i.blockId && (!m.has(i.blockId) || i.level === 'error')) m.set(i.blockId, i); return m; }, [issues]);
  const issueByEvent = useMemo(() => { const m = new Map<string, Issue>(); for (const i of issues) if (i.eventId && i.level === 'error') m.set(i.eventId, i); return m; }, [issues]);
  const typeColor = (t?: string) => types.find((x) => x.name === t)?.color ?? '#8a8f98';

  useEffect(() => {
    if (!props.focusBlockId) return;
    setSel({ kind: 'block', id: props.focusBlockId });
    rootRef.current?.querySelector(`[data-block="${props.focusBlockId}"]`)?.scrollIntoView({ block: 'center' });
  }, [props.focusBlockId]);

  const change = (label: string, fn: (s: ReturnType<typeof ops.sheetOf>, d: LogicDocument) => void) => {
    if (props.readOnly) return;
    onChange(ops.edit(doc, (d) => fn(ops.sheetOf(d, props.sheetId), d)), label);
  };

  const envFor = (eventId?: string): EditorEnv => ({ app, types, variables: ops.variablesInScope(doc, sheet, eventId), functions: docFunctions(doc), particlePresets: props.particlePresets, dialogues: (doc.dialogues ?? []).map((d) => d.name), scenes: props.sceneNames, sounds: soundNames(doc.sounds), videos: (doc.videos ?? []).map((v) => v.name), pictures: (doc.pictures ?? []).map((v) => v.name) });

  const addEventWith = (b: BlockInstance) => {
    const ev = ops.newEvent([b]);
    change('Add event', (s) => {
      if (picker?.afterId) ops.insertAfter(s, picker.afterId, ev);
      else ops.insertNode(s, ev, picker?.parentId ?? null);
    });
    setSel({ kind: 'node', id: ev.id });
  };

  const onPicked = (b: BlockInstance) => {
    if (!picker) return;
    if (picker.eventId === null) addEventWith(b);
    else change(picker.kind === 'condition' ? 'Add condition' : 'Add action', (s) => {
      ops.addBlockTo(s, picker.eventId!, picker.kind === 'condition' ? 'conditions' : 'actions', b);
      // A condition added to loose blocks (from the block canvas) makes them a running event.
      if (picker.kind === 'condition') { const f = ops.findNode(s.events, picker.eventId!); const ev = f?.list[f.index]; if (ev?.kind === 'event') ev.loose = false; }
    });
    setPicker(null);
  };

  const copySel = () => {
    if (!sel) return;
    if (sel.kind === 'node') { const l = ops.findNode(sheet.events, sel.id); if (l) clipboard = ops.clipboardOf([l.list[l.index]]); }
    else { const f = ops.findBlock(sheet.events, sel.id); if (f) clipboard = ops.clipboardOf([], [f.ev[f.slot][f.index]]); }
    try { navigator.clipboard?.writeText(JSON.stringify(clipboard)); } catch { /* clipboard permission */ }
  };
  const paste = () => {
    if (!clipboard) return;
    const cb = clipboard;
    change('Paste', (s) => {
      if (cb.nodes?.length) for (const n of cb.nodes) { const c = reassignIds(n); if (sel?.kind === 'node') ops.insertAfter(s, sel.id, c); else s.events.push(c); }
      if (cb.blocks?.length) {
        const target = sel?.kind === 'node' ? sel.id : sel?.kind === 'block' ? ops.findBlock(s.events, sel.id)?.ev.id : null;
        if (!target) return;
        for (const b of cb.blocks) { const c = reassignIds(b); ops.addBlockTo(s, target, BLOCK_DEFS[c.block]?.kind === 'condition' ? 'conditions' : 'actions', c); }
      }
    });
  };
  const deleteSel = () => {
    if (!sel) return;
    if (sel.kind === 'node') change('Delete event', (s) => { ops.removeNode(s, sel.id); });
    else change('Delete block', (s) => { ops.removeBlock(s, sel.id); });
    setSel(null);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).closest('input,textarea,select')) return;
    const mod = e.ctrlKey || e.metaKey;
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSel(); }
    else if (mod && e.key.toLowerCase() === 'c') { e.preventDefault(); copySel(); }
    else if (mod && e.key.toLowerCase() === 'v') { e.preventDefault(); paste(); }
    else if (mod && e.key.toLowerCase() === 'd' && sel?.kind === 'node') { e.preventDefault(); change('Duplicate', (s) => { ops.duplicateNode(s, sel.id); }); }
    else if (e.key.toLowerCase() === 'i' && sel?.kind === 'block') { const f = ops.findBlock(sheet.events, sel.id); if (f?.slot === 'conditions' && !BLOCK_DEFS[f.ev.conditions[f.index].block]?.trigger) change('Invert', (s) => ops.updateBlock(s, sel.id, { invert: !f.ev.conditions[f.index].invert })); }
    else if (e.key === 'Enter' && sel?.kind === 'block') { const f = ops.findBlock(sheet.events, sel.id); if (f) setDialog(f.ev[f.slot][f.index]); }
  };

  const eventMenu = (e: React.MouseEvent, n: EventNode) => {
    e.preventDefault(); e.stopPropagation();
    setSel({ kind: 'node', id: n.id });
    const items: NonNullable<Menu>['items'] = [];
    if (n.kind === 'event') {
      items.push({ label: 'Add condition…', action: () => setPicker({ kind: 'condition', eventId: n.id }) });
      items.push({ label: 'Add action…', action: () => setPicker({ kind: 'action', eventId: n.id }) });
      items.push({ label: 'Add sub-event…', action: () => setPicker({ kind: 'condition', eventId: null, parentId: n.id }) });
      items.push({ label: 'Add "Else" after', action: () => change('Add else', (s) => ops.insertAfter(s, n.id, { ...ops.newEvent(), isElse: true })) });
      items.push({ label: 'Add local variable', action: () => change('Add local variable', (s) => { const l = ops.findNode(s.events, n.id)!; const ev = l.list[l.index] as EventBlock; ev.locals = [...(ev.locals ?? []), { name: ops.uniqueName('local', (ev.locals ?? []).map((v) => v.name)), type: 'number', value: 0 }]; }) });
      items.push({ label: n.isOr ? 'Make AND block' : 'Make OR block', action: () => change('Toggle OR', (s) => { const l = ops.findNode(s.events, n.id)!; (l.list[l.index] as EventBlock).isOr = !n.isOr; }) });
      items.push({ label: n.breakpoint ? 'Remove breakpoint' : 'Toggle breakpoint', action: () => change('Breakpoint', (s) => { const l = ops.findNode(s.events, n.id)!; (l.list[l.index] as EventBlock).breakpoint = !n.breakpoint; }) });
      items.push({ label: n.disabled ? 'Enable' : 'Disable', action: () => change('Toggle event', (s) => { const l = ops.findNode(s.events, n.id)!; (l.list[l.index] as EventBlock).disabled = !n.disabled; }) });
    }
    if (n.kind === 'group') {
      items.push({ label: 'Add event to group…', action: () => setPicker({ kind: 'condition', eventId: null, parentId: n.id }) });
      items.push({ label: n.active ? 'Deactivate group' : 'Activate group', action: () => change('Toggle group', (s) => { const l = ops.findNode(s.events, n.id)!; (l.list[l.index] as any).active = !n.active; }) });
    }
    items.push({ label: 'Add comment after', sep: true, action: () => change('Add comment', (s) => ops.insertAfter(s, n.id, { kind: 'comment', id: newId('cm'), text: 'Comment' })) });
    items.push({ label: 'Add group after', action: () => change('Add group', (s) => ops.insertAfter(s, n.id, { kind: 'group', id: newId('grp'), name: 'Group', active: true, children: [] })) });
    items.push({ label: 'Duplicate  (Ctrl+D)', action: () => change('Duplicate', (s) => { ops.duplicateNode(s, n.id); }) });
    items.push({ label: 'Copy  (Ctrl+C)', action: () => { clipboard = ops.clipboardOf([n]); } });
    items.push({ label: 'Paste after  (Ctrl+V)', action: () => paste() });
    items.push({ label: 'Move up', action: () => change('Move', (s) => { const l = ops.findNode(s.events, n.id)!; if (l.index > 0) l.list.splice(l.index - 1, 0, l.list.splice(l.index, 1)[0]); }) });
    items.push({ label: 'Move down', action: () => change('Move', (s) => { const l = ops.findNode(s.events, n.id)!; if (l.index < l.list.length - 1) l.list.splice(l.index + 1, 0, l.list.splice(l.index, 1)[0]); }) });
    items.push({ label: 'Delete', danger: true, sep: true, action: () => change('Delete event', (s) => { ops.removeNode(s, n.id); }) });
    setMenu({ x: e.clientX, y: e.clientY, items });
  };

  const blockMenu = (e: React.MouseEvent, b: BlockInstance) => {
    e.preventDefault(); e.stopPropagation();
    setSel({ kind: 'block', id: b.id });
    const def = BLOCK_DEFS[b.block];
    const items: NonNullable<Menu>['items'] = [{ label: 'Edit…  (Enter)', action: () => setDialog(b) }];
    if (def?.kind === 'condition' && !def.trigger) items.push({ label: b.invert ? 'Remove invert' : 'Invert  (I)', action: () => change('Invert', (s) => ops.updateBlock(s, b.id, { invert: !b.invert })) });
    items.push({ label: b.disabled ? 'Enable' : 'Disable', action: () => change('Toggle block', (s) => ops.updateBlock(s, b.id, { disabled: !b.disabled })) });
    items.push({ label: 'Copy', action: () => { clipboard = ops.clipboardOf([], [b]); } });
    items.push({ label: 'Duplicate', action: () => change('Duplicate block', (s) => { const f = ops.findBlock(s.events, b.id)!; f.ev[f.slot].splice(f.index + 1, 0, reassignIds(b)); }) });
    items.push({ label: 'Delete', danger: true, sep: true, action: () => change('Delete block', (s) => { ops.removeBlock(s, b.id); }) });
    setMenu({ x: e.clientX, y: e.clientY, items });
  };

  const matches = (n: EventNode): boolean => {
    if (!filter) return true;
    const q = filter.toLowerCase();
    if (n.kind === 'comment') return n.text.toLowerCase().includes(q);
    if (n.kind === 'group') return n.name.toLowerCase().includes(q) || n.children.some(matches);
    return [...n.conditions, ...n.actions].some((b) => (blockSentence(BLOCK_DEFS[b.block], b.params, b.target) + ' ' + b.block).toLowerCase().includes(q)) || n.children.some(matches);
  };

  const onDragOverRow = (e: React.DragEvent, n: EventNode) => {
    if (!e.dataTransfer.types.includes('x-craft-node') && !e.dataTransfer.types.includes('x-craft-block')) return;
    e.preventDefault(); e.stopPropagation();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const y = (e.clientY - r.top) / r.height;
    const where = e.dataTransfer.types.includes('x-craft-block') ? 'into' : y < 0.3 ? 'before' : y > 0.7 || n.kind === 'comment' ? 'after' : 'into';
    setDrop({ id: n.id, where });
  };
  const onDropRow = (e: React.DragEvent, n: EventNode, slot?: ops.Slot) => {
    e.preventDefault(); e.stopPropagation();
    const nodeId = e.dataTransfer.getData('x-craft-node');
    const blockId = e.dataTransfer.getData('x-craft-block');
    const where = drop?.where ?? 'after';
    setDrop(null);
    if (blockId && n.kind === 'event') {
      const def = BLOCK_DEFS[ops.findBlock(sheet.events, blockId)?.ev[ops.findBlock(sheet.events, blockId)!.slot][ops.findBlock(sheet.events, blockId)!.index].block ?? ''];
      change('Move block', (s) => ops.moveBlock(s, blockId, n.id, slot ?? (def?.kind === 'condition' ? 'conditions' : 'actions'), -1));
      return;
    }
    if (!nodeId || nodeId === n.id) return;
    change('Move event', (s) => {
      if (where === 'into' && n.kind !== 'comment') ops.moveNode(s, nodeId, n.id, -1);
      else {
        const l = ops.findNode(s.events, n.id); if (!l) return;
        const parentId = l.parent?.id ?? null;
        ops.moveNode(s, nodeId, parentId, l.index + (where === 'after' ? 1 : 0));
      }
    });
  };

  const renderBlock = (b: BlockInstance, ev: EventBlock, slot: ops.Slot, i: number) => {
    const def = BLOCK_DEFS[b.block];
    const cat = CATEGORIES.find((c) => c.id === def?.category);
    const issue = issueByBlock.get(b.id);
    const selected = sel?.kind === 'block' && sel.id === b.id;
    return (
      <div key={b.id} data-block={b.id}
        className={'es-block' + (selected ? ' sel' : '') + (b.disabled ? ' off' : '') + (issue ? ' issue ' + issue.level : '') + (!def ? ' unknown' : '') + (def && !def.apps.includes(app) ? ' foreign' : '')}
        title={(issue ? issue.message + '\n' : '') + (def ? def.doc : `Unknown block "${b.block}" (preserved, not executed)`) + (b.comment ? '\n// ' + b.comment : '')}
        draggable={!props.readOnly}
        onDragStart={(e) => { e.stopPropagation(); e.dataTransfer.setData('x-craft-block', b.id); }}
        onClick={(e) => { e.stopPropagation(); setSel({ kind: 'block', id: b.id }); }}
        onDoubleClick={(e) => { e.stopPropagation(); if (def) setDialog(b); }}
        onContextMenu={(e) => blockMenu(e, b)}>
        {slot === 'conditions' && ev.isOr && i > 0 && <span className="es-or">or</span>}
        <span className="es-obj" style={{ background: def?.target === 'object' ? typeColor(b.target) : cat?.color ?? '#666' }} title={b.target ?? 'System'}>
          {def?.target === 'object' ? (b.target ?? '?').slice(0, 1) : cat ? <Glyph e={cat.icon} i={CATEGORY_ICON[cat.id] ?? 'box'} size={12} /> : '?'}
        </span>
        <span className="es-objname">{def?.target === 'object' ? b.target : 'System'}</span>
        {def?.trigger && <span className="es-trigger" title="Trigger"><Glyph e="⚡" i="zap" size={12} /></span>}
        {def?.looping && <span className="es-trigger" title="Loop">↻</span>}
        {b.invert && <span className="es-invert" title="Inverted (NOT)">✗</span>}
        <span className="es-text">{def ? blockSentence(def, b.params, b.target) : b.block}</span>
        {b.comment && <span className="es-cmt"><Glyph e="💬" i="message-square" size={12} /></span>}
      </div>
    );
  };

  const renderNodes = (nodes: EventNode[], depth: number, num: { n: number }): React.ReactNode[] => nodes.map((n) => {
    const dim = !matches(n);
    const dropCls = drop?.id === n.id ? ' drop-' + drop.where : '';
    const common = {
      draggable: !props.readOnly,
      onDragStart: (e: React.DragEvent) => { e.stopPropagation(); e.dataTransfer.setData('x-craft-node', n.id); e.dataTransfer.effectAllowed = 'move'; },
      onDragOver: (e: React.DragEvent) => onDragOverRow(e, n),
      onDragLeave: () => setDrop(null),
      onDrop: (e: React.DragEvent) => onDropRow(e, n),
      onContextMenu: (e: React.MouseEvent) => eventMenu(e, n),
      onClick: (e: React.MouseEvent) => { e.stopPropagation(); setSel({ kind: 'node', id: n.id }); },
    };
    const selected = sel?.kind === 'node' && sel.id === n.id;
    if (n.kind === 'comment') {
      return (
        <div key={n.id} className={'es-comment' + (selected ? ' sel' : '') + (dim ? ' dim' : '') + dropCls} style={{ marginLeft: depth * 22 }} {...common}>
          <textarea value={n.text} rows={Math.max(1, n.text.split('\n').length)} readOnly={props.readOnly}
            onChange={(e) => change('Edit comment', (s) => { const l = ops.findNode(s.events, n.id)!; (l.list[l.index] as any).text = e.target.value; })} />
        </div>
      );
    }
    if (n.kind === 'group') {
      return (
        <div key={n.id} className={'es-group' + (n.active ? '' : ' inactive') + (dim ? ' dim' : '')} style={{ marginLeft: depth * 22 }}>
          <div className={'es-group-head' + (selected ? ' sel' : '') + dropCls} {...common}>
            <button className="es-twisty" onClick={(e) => { e.stopPropagation(); change('Collapse', (s) => { const l = ops.findNode(s.events, n.id)!; (l.list[l.index] as any).collapsed = !n.collapsed; }); }}>{n.collapsed ? '▸' : '▾'}</button>
            <input type="checkbox" checked={n.active} title="Active" onChange={() => change('Toggle group', (s) => { const l = ops.findNode(s.events, n.id)!; (l.list[l.index] as any).active = !n.active; })} />
            <input className="es-group-name" value={n.name} onChange={(e) => change('Rename group', (s) => { const l = ops.findNode(s.events, n.id)!; (l.list[l.index] as any).name = e.target.value; })} />
            <span className="es-group-desc">{n.description}</span>
          </div>
          {!n.collapsed && <div className="es-group-body">{renderNodes(n.children, 0, num)}
            <button className="es-add small" onClick={() => setPicker({ kind: 'condition', eventId: null, parentId: n.id })}>+ Add event to group</button></div>}
        </div>
      );
    }
    num.n++;
    const ran = trace?.has(n.id);
    const evIssue = issueByEvent.get(n.id);
    return (
      <div key={n.id} className={'es-event-wrap' + (dim ? ' dim' : '')} style={{ marginLeft: depth * 22 }}>
        <div data-ev-id={n.id} className={'es-event' + (selected ? ' sel' : '') + (n.disabled || n.loose ? ' off' : '') + (ran ? ' ran' : '') + dropCls} {...common}>
          <div className="es-margin" title={evIssue?.message ?? 'Drag to move. Right-click for options.'}>
            {n.breakpoint && <span className="es-bp" title="Breakpoint">●</span>}
            {evIssue && <span className="es-err">!</span>}
            <span className="es-num">{num.n}</span>
          </div>
          <div className="es-conds" onDragOver={(e) => onDragOverRow(e, n)} onDrop={(e) => onDropRow(e, n, 'conditions')}>
            {n.isElse && <div className="es-block else"><span className="es-obj" style={{ background: '#6b7a90' }}><Glyph e="⚙" i="settings" size={12} /></span><span className="es-text">Else</span></div>}
            {n.conditions.map((b, i) => renderBlock(b, n, 'conditions', i))}
            {n.loose && <div className="es-block every" title="Loose blocks from the block canvas: they do not run until a condition is added">Not running — add a condition</div>}
            {!n.loose && !n.conditions.length && !n.isElse && <div className="es-block every">Every tick</div>}
            {!props.readOnly && <button className="es-add-inline" onClick={(e) => { e.stopPropagation(); setPicker({ kind: 'condition', eventId: n.id }); }}>+ condition</button>}
          </div>
          <div className="es-acts" onDragOver={(e) => onDragOverRow(e, n)} onDrop={(e) => onDropRow(e, n, 'actions')}>
            {n.actions.map((b, i) => renderBlock(b, n, 'actions', i))}
            {!props.readOnly && <button className="es-add-action" onClick={(e) => { e.stopPropagation(); setPicker({ kind: 'action', eventId: n.id }); }}>Add action</button>}
          </div>
        </div>
        {(n.locals ?? []).map((v, vi) => (
          <VarRow key={v.name + vi} scope="Local" v={v} indent={22}
            onChange={(nv) => change('Edit local variable', (s) => { const l = ops.findNode(s.events, n.id)!; (l.list[l.index] as EventBlock).locals![vi] = nv; })}
            onDelete={() => change('Delete local variable', (s) => { const l = ops.findNode(s.events, n.id)!; (l.list[l.index] as EventBlock).locals!.splice(vi, 1); })} />
        ))}
        {n.children.length > 0 && <div className="es-children">{renderNodes(n.children, 1, num)}</div>}
      </div>
    );
  });

  return (
    <div className="es-root" ref={rootRef} tabIndex={0} onKeyDown={onKey} onClick={() => { setSel(null); setMenu(null); }}>
      <div className="es-toolbar">
        <button className="lx-btn primary" disabled={props.readOnly} onClick={(e) => { e.stopPropagation(); setPicker({ kind: 'condition', eventId: null }); }}>+ Add event</button>
        <button className="lx-btn" disabled={props.readOnly} onClick={(e) => { e.stopPropagation(); change('Add group', (s) => s.events.push({ kind: 'group', id: newId('grp'), name: 'New group', active: true, children: [] })); }}>+ Group</button>
        <button className="lx-btn" disabled={props.readOnly} onClick={(e) => { e.stopPropagation(); change('Add comment', (s) => s.events.push({ kind: 'comment', id: newId('cm'), text: 'Comment' })); }}>+ Comment</button>
        <button className="lx-btn" disabled={props.readOnly} onClick={(e) => { e.stopPropagation(); change('Add global variable', (_s, d) => d.globals.push({ name: ops.uniqueName('variable', d.globals.map((g) => g.name)), type: 'number', value: 0 })); }}>+ Global variable</button>
        <input className="lx-input search" placeholder="Search events…" value={filter} onChange={(e) => setFilter(e.target.value)} onClick={(e) => e.stopPropagation()} />
        <span className="es-hint">Double-click to edit · Right-click for options · Drag to reorder · Del / Ctrl+C / Ctrl+V / I = invert</span>
      </div>
      <div className="es-scroll">
        {doc.globals.map((v, i) => (
          <VarRow key={'g' + i} scope="Global" v={v}
            onChange={(nv) => change('Edit global variable', (_s, d) => {
              const old = d.globals[i].name; d.globals[i] = nv;
              if (old !== nv.name) renameVariable(d, old, nv.name);
            })}
            onDelete={() => change('Delete global variable', (_s, d) => { d.globals.splice(i, 1); })} />
        ))}
        {renderNodes(sheet.events, 0, { n: 0 })}
        {!sheet.events.length && <div className="es-empty">No events yet. Click <b>+ Add event</b> and pick a trigger such as <i>System › On start of scene</i> or <i>Keyboard › On key pressed</i>.</div>}
      </div>
      {picker && <BlockPicker kind={picker.kind} env={envFor(picker.eventId ?? undefined)} onClose={() => setPicker(null)} onPick={onPicked} />}
      {dialog && BLOCK_DEFS[dialog.block] && (
        <BlockDialog block={dialog} def={BLOCK_DEFS[dialog.block]} env={envFor(ops.findBlock(sheet.events, dialog.id)?.ev.id)} onClose={() => setDialog(null)}
          onSave={(nb) => { change('Edit ' + BLOCK_DEFS[dialog.block].name, (s) => ops.updateBlock(s, dialog.id, { params: nb.params, target: nb.target, invert: nb.invert, comment: nb.comment })); setDialog(null); }} />
      )}
      {menu && (
        <div className="lx-menu" style={{ left: menu.x, top: menu.y }} onClick={(e) => e.stopPropagation()}>
          {menu.items.map((it, i) => (
            <React.Fragment key={i}>{it.sep && <hr />}<button className={it.danger ? 'danger' : ''} onClick={() => { setMenu(null); it.action(); }}>{it.label}</button></React.Fragment>
          ))}
        </div>
      )}
    </div>
  );
}

function VarRow({ scope, v, onChange, onDelete, indent = 0 }: { scope: string; v: any; onChange: (v: any) => void; onDelete: () => void; indent?: number }) {
  const valueText = typeof v.value === 'object' ? JSON.stringify(v.value) : String(v.value);
  return (
    <div className="es-var" style={{ marginLeft: indent }} onClick={(e) => e.stopPropagation()}>
      <span className="es-var-scope">{scope}{v.isStatic ? ' static' : ''}{v.isConstant ? ' const' : ''}</span>
      <select value={v.type} onChange={(e) => onChange({ ...v, type: e.target.value, value: defaultValueFor(e.target.value as VarType) })}>
        {VAR_TYPES.map((t) => <option key={t}>{t}</option>)}
      </select>
      <input className="es-var-name" value={v.name} onChange={(e) => onChange({ ...v, name: e.target.value.replace(/[^A-Za-z0-9_]/g, '') || v.name })} />
      <span>=</span>
      {v.type === 'boolean'
        ? <input type="checkbox" checked={!!v.value} onChange={(e) => onChange({ ...v, value: e.target.checked })} />
        : <input className="es-var-val" defaultValue={valueText} key={valueText} onBlur={(e) => {
          const t = e.target.value;
          let value: any = t;
          if (v.type === 'number') value = Number(t) || 0;
          else if (v.type === 'array' || v.type === 'dict') { try { value = JSON.parse(t); } catch { value = v.value; } }
          onChange({ ...v, value });
        }} />}
      {scope === 'Local' && <label title="Static locals keep their value between ticks"><input type="checkbox" checked={!!v.isStatic} onChange={(e) => onChange({ ...v, isStatic: e.target.checked })} />static</label>}
      {scope === 'Global' && <label title="Constants cannot be changed by actions"><input type="checkbox" checked={!!v.isConstant} onChange={(e) => onChange({ ...v, isConstant: e.target.checked })} />const</label>}
      <button className="es-x" title="Delete variable" onClick={onDelete}>✕</button>
    </div>
  );
}

/** Rename a variable everywhere it is referenced by a variable parameter. */
export function renameVariable(d: LogicDocument, from: string, to: string) {
  const fix = (ns: EventNode[]) => ns.forEach((n) => {
    if (n.kind === 'event') for (const b of [...n.conditions, ...n.actions]) {
      const def = BLOCK_DEFS[b.block];
      for (const p of def?.params ?? []) if (p.type === 'variable' && b.params[p.name] === from) b.params[p.name] = to;
    }
    if (n.kind !== 'comment') fix(n.children);
  });
  d.sheets.forEach((s) => fix(s.events));
  void deepClone;
}
