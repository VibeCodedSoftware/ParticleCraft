// Scratch-style block canvas. It renders the SAME event tree as the event sheet:
// a hat block for the trigger, an "if" C-block for the other conditions, stacked action blocks and nested
// sub-event stacks. Drag from the palette, snap into stacks, edit parameters inline.
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { CATEGORY_ICON, Icon } from './icons';
import { PackList } from './PacksPanel';
import { BLOCK_DEFS, BLOCK_LIST, CATEGORIES, type BlockDef } from '../src/blocks/definitions';
import { newId, reassignIds, type BlockInstance, type EventBlock, type EventNode, type LogicDocument } from '../src/schema';
import type { Issue } from '../src/validate';
import * as ops from './logicOps';
import { soundNames } from '../src/sounds';
import { BlockDialog, ExprHints, ParamInput, docFunctions, type EditorEnv, type TypeSummary } from './ParamEditor';

export interface CanvasProps {
  doc: LogicDocument;
  sheetId?: string;
  app: EditorEnv['app'];
  types: TypeSummary[];
  onChange: (doc: LogicDocument, label: string) => void;
  issues?: Issue[];
  trace?: Set<string>;
  showPalette?: boolean;
  particlePresets?: string[];
  focusBlockId?: string | null;
  onSelectBlock?: (blockId: string | null, eventId: string | null) => void;
  defaultObject?: string;
  /** "scratch": colorful snap blocks (LogicCraft). "pro": compact professional blocks with an outline (GameCraft). */
  variant?: 'scratch' | 'pro';
  /** Scene names offered by "Load scene" style parameters. */
  sceneNames?: string[];
}

/** Where the "+" attach menu inserts: after a block (index), at the end (-1), or into a new stack's first slot. */
interface Attach { evId: string; slot: 'conditions' | 'actions'; index: number; x: number; y: number; target?: string; category?: string; /** Top of loose blocks: offer "when …" triggers first. */ hat?: boolean }

/**
 * "+" menu: the blocks that can attach at a point (actions after an action, conditions after a condition),
 * searchable, with blocks from the same category suggested first.
 */
function AttachMenu({ at, app, onPick, onSubEvent, onClose }: { at: Attach; app: EditorEnv['app']; onPick: (d: BlockDef) => void; onSubEvent?: () => void; onClose: () => void }) {
  const [q, setQ] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const out = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('pointerdown', out, true); window.addEventListener('keydown', esc);
    return () => { window.removeEventListener('pointerdown', out, true); window.removeEventListener('keydown', esc); };
  }, [onClose]);
  const kind = at.slot === 'conditions' ? 'condition' : 'action';
  // Triggers ("when …") start stacks: only offered on top of loose blocks, where they make the blocks run.
  const fits = BLOCK_LIST.filter((d) => d.kind === kind && (at.hat || !d.trigger) && d.apps.includes(app));
  const ql = q.trim().toLowerCase();
  const found = ql ? fits.filter((d) => (d.name + ' ' + d.doc + ' ' + (d.c2 ?? '')).toLowerCase().includes(ql)) : fits;
  const suggested = !ql && at.hat ? found.filter((d) => d.trigger || d.id === 'system.every_tick' || d.id === 'system.forever').slice(0, 10)
    : !ql && at.category ? found.filter((d) => d.category === at.category).slice(0, 6) : [];
  const groups = CATEGORIES.map((c) => ({ c, list: found.filter((d) => d.category === c.id) })).filter((g) => g.list.length);
  // Keep the menu on screen.
  const left = Math.min(at.x, window.innerWidth - 330), top = Math.min(at.y, window.innerHeight - 420);
  const item = (d: BlockDef) => {
    const c = CATEGORIES.find((x) => x.id === d.category);
    return (
      <button key={d.id} className="bc-att-item" title={d.doc} onClick={() => onPick(d)}>
        <span className={'bc-att-chip ' + (d.kind === 'condition' ? 'cond' : 'act')} style={{ background: c?.color }} />
        <span className="bc-att-name">{d.name}</span>
      </button>
    );
  };
  return (
    <div className="bc-att" ref={ref} style={{ left, top }} onPointerDown={(e) => e.stopPropagation()}>
      <div className="bc-att-head">{at.hat ? 'Start these blocks when…' : kind === 'condition' ? 'Add a condition' : 'Add an action'}</div>
      <input className="lx-input search" autoFocus placeholder="Search blocks…" value={q} onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && found[0]) onPick(found[0]); }} />
      <div className="bc-att-list">
        {onSubEvent && !ql && <button className="bc-att-item sub" onClick={onSubEvent}><span className="bc-att-chip sub" /><span className="bc-att-name">Sub-event (if … then …)</span></button>}
        {suggested.length > 0 && <><div className="bc-att-cat">{at.hat ? 'Start when' : 'Suggested'}</div>{suggested.map(item)}</>}
        {groups.map((g) => (
          <React.Fragment key={g.c.id}>
            <div className="bc-att-cat"><span style={{ background: g.c.color }} />{g.c.name}</div>
            {g.list.map(item)}
          </React.Fragment>
        ))}
        {!found.length && <div className="bc-att-none">No {kind} matches "{q}".</div>}
      </div>
    </div>
  );
}

type Drag =
  // sx/sy: where the press started; a block only starts dragging after the pointer moves a few pixels,
  // so a plain click selects it (and never detaches it into a new stack).
  | { kind: 'palette'; def: BlockDef; x: number; y: number; sx: number; sy: number }
  | { kind: 'block'; id: string; x: number; y: number; sx: number; sy: number }
  | { kind: 'stack'; id: string; x: number; y: number; ox: number; oy: number; sx: number; sy: number }
  | { kind: 'pan'; x: number; y: number; px: number; py: number };

export function BlockCanvas(props: CanvasProps) {
  const { doc, app, types, onChange, issues = [], trace } = props;
  const sheet = ops.sheetOf(doc, props.sheetId);
  const [view, setView] = useState({ x: 40, y: 30, z: 1 });
  const [drag, setDrag] = useState<Drag | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  /** A block category, or 'packs' (ready-made systems, last in the list). */
  const [cat, setCat] = useState<string>((CATEGORIES.find((c) => BLOCK_LIST.some((d) => d.category === c.id && d.apps.includes(props.app))) ?? CATEGORIES[0]).id);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<string | null>(null);
  const [dialog, setDialog] = useState<BlockInstance | null>(null);
  const [attach, setAttach] = useState<Attach | null>(null);
  /** Open the "+" menu under an element for inserting into an event's slot at `index`. */
  const openAttach = (e: React.MouseEvent, evId: string, slot: 'conditions' | 'actions', index: number, near?: BlockInstance, hat = false) => {
    e.stopPropagation();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setAttach({ evId, slot, index, x: r.left, y: r.bottom + 4, target: near?.target, category: near ? BLOCK_DEFS[near.block]?.category : undefined, hat });
  };
  const pickAttach = (d: BlockDef) => {
    if (!attach) return;
    const b = ops.newBlock(d.id, attach.target ?? paletteObj);
    change('Add block', (s) => { ops.addBlockTo(s, attach.evId, attach.slot, b, attach.index); if (attach.hat) activate(s, attach.evId); });
    setSel(b.id); setAttach(null);
  };
  const [paletteObj, setPaletteObj] = useState<string>(props.defaultObject ?? types[0]?.name ?? 'Player');
  const areaRef = useRef<HTMLDivElement>(null);
  const issueByBlock = useMemo(() => new Map(issues.filter((i) => i.blockId).map((i) => [i.blockId!, i])), [issues]);
  const env: EditorEnv = { app, types, variables: ops.variablesInScope(doc, sheet), functions: docFunctions(doc), particlePresets: props.particlePresets, dialogues: (doc.dialogues ?? []).map((d) => d.name), scenes: props.sceneNames, sounds: soundNames(doc.sounds), videos: (doc.videos ?? []).map((v) => v.name), pictures: (doc.pictures ?? []).map((v) => v.name) };

  useEffect(() => { if (props.focusBlockId) setSel(props.focusBlockId); }, [props.focusBlockId]);

  // When a stack grows (a block added with "+"), stacks below it in the same column slide down instead of
  // overlapping. Display only: saved positions change when the user moves a stack.
  useLayoutEffect(() => {
    const world = worldRef.current;
    if (!world || drag) return;
    const els = [...world.querySelectorAll<HTMLElement>(':scope > .bc-stack')];
    const boxes = els.map((el) => {
      const id = el.dataset.stack!;
      const p = posOf(id, 0);
      return { el, x: p.x, y: p.y, w: el.offsetWidth, h: el.offsetHeight };
    }).sort((a, b) => a.y - b.y);
    const placed: { x: number; y: number; w: number; h: number }[] = [];
    for (const b of boxes) {
      let y = b.y;
      for (const o of placed) if (b.x < o.x + o.w && o.x < b.x + b.w && y < o.y + o.h + 16 && y + b.h > o.y) y = o.y + o.h + 16;
      if (`${y}px` !== b.el.style.top) b.el.style.top = `${y}px`;
      placed.push({ x: b.x, y, w: b.w, h: b.h });
    }
  });

  const change = (label: string, fn: (s: ReturnType<typeof ops.sheetOf>, d: LogicDocument) => void) =>
    onChange(ops.edit(doc, (d) => {
      const s = ops.sheetOf(d, props.sheetId);
      fn(s, d);
      // Loose stacks whose last block was dragged away disappear.
      s.events = s.events.filter((e) => !(e.kind === 'event' && e.loose && !e.conditions.length && !e.actions.length && !e.children.length));
    }), label);
  /** Putting a condition on top of loose blocks (a "when …", every tick, forever, if …) makes them a running event. */
  const activate = (s: ReturnType<typeof ops.sheetOf>, evId: string) => { const f = ops.findNode(s.events, evId); const n = f?.list[f.index]; if (n?.kind === 'event') n.loose = false; };

  // Stacks without a saved position flow down one column, spaced by their estimated height.
  const autoPos = useMemo(() => {
    const est = (n: EventNode): number => n.kind === 'comment' ? 80 : n.kind === 'group' ? 40 + n.children.reduce((a, c) => a + est(c) + 12, 0)
      : 64 + Math.max(0, n.conditions.length - 1) * 46 + n.actions.length * 44 + n.children.reduce((a, c) => a + est(c) + 14, 0) + 34;
    const out = new Map<string, { x: number; y: number }>();
    let y = 20;
    for (const n of sheet.events) { out.set(n.id, { x: 20, y }); y += est(n) + 30; }
    return out;
  }, [sheet.events]);
  const posOf = (id: string, _i: number) => sheet.layout?.[id] ?? autoPos.get(id) ?? { x: 20, y: 20 };

  const toCanvas = (cx: number, cy: number) => {
    const r = areaRef.current!.getBoundingClientRect();
    return { x: (cx - r.left - view.x) / view.z, y: (cy - r.top - view.y) / view.z };
  };

  const dropTargetAt = (cx: number, cy: number): string | null => {
    for (const el of document.elementsFromPoint(cx, cy)) {
      const d = (el as HTMLElement).dataset?.drop;
      if (d) return d;
    }
    return null;
  };

  // Dragging is done outside React: the pointer position goes to the dragged element (ghost, stack or the whole
  // world when panning) once per animation frame. React only re-renders when the hovered drop slot changes and
  // on release, so large sheets stay smooth.
  const ghostRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const hoverRef = useRef<string | null>(null);
  useEffect(() => {
    if (!drag) return;
    let px = drag.x, py = drag.y, raf = 0;
    const DRAG_PX = 5;
    const movedFar = (x: number, y: number) => drag.kind === 'pan' || Math.abs(x - (drag as any).sx) + Math.abs(y - (drag as any).sy) >= DRAG_PX;
    let started = drag.kind === 'pan' || drag.kind === 'stack';
    const stackEl = drag.kind === 'stack' ? (areaRef.current?.querySelector(`[data-stack="${drag.id}"]`) as HTMLElement | null) : null;
    const frame = () => {
      raf = 0;
      if (drag.kind === 'pan') {
        if (worldRef.current) worldRef.current.style.transform = `translate(${drag.px + px - drag.x}px, ${drag.py + py - drag.y}px) scale(${view.z})`;
        return;
      }
      if (drag.kind === 'stack') {
        if (stackEl) { const p = toCanvas(px, py); stackEl.style.left = `${p.x - drag.ox}px`; stackEl.style.top = `${p.y - drag.oy}px`; }
        return;
      }
      if (!started) { if (!movedFar(px, py)) return; started = true; }
      if (ghostRef.current) { ghostRef.current.style.transform = `translate(${px + 8}px, ${py + 8}px)`; ghostRef.current.style.visibility = 'visible'; }
      const h = dropTargetAt(px, py);
      if (h !== hoverRef.current) { hoverRef.current = h; setHover(h); }
    };
    const move = (e: PointerEvent) => { px = e.clientX; py = e.clientY; if (!raf) raf = requestAnimationFrame(frame); };
    const up = (e: PointerEvent) => {
      cancelAnimationFrame(raf);
      if (drag.kind === 'pan') setView((v) => ({ ...v, x: drag.px + e.clientX - drag.x, y: drag.py + e.clientY - drag.y }));
      // A click (no real movement) on a block or palette entry only selects: nothing is moved or created.
      else if ((drag.kind === 'block' || drag.kind === 'palette') && !started && !movedFar(e.clientX, e.clientY)) { /* click */ }
      else finishDrag(drag, drag.kind === 'stack' ? null : dropTargetAt(e.clientX, e.clientY), e.clientX, e.clientY);
      if (drag.kind === 'stack' && stackEl) {
        // Leave the stack exactly where the saved layout will put it (snapped), or back where it was for a click.
        const moved = Math.abs(e.clientX - drag.sx) + Math.abs(e.clientY - drag.sy) >= 4;
        const p = toCanvas(e.clientX, e.clientY);
        const at = moved ? { x: Math.round((p.x - drag.ox) / 10) * 10, y: Math.round((p.y - drag.oy) / 10) * 10 } : posOf(drag.id, 0);
        stackEl.style.left = `${at.x}px`; stackEl.style.top = `${at.y}px`;
      }
      hoverRef.current = null;
      setDrag(null); setHover(null);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag]);

  const finishDrag = (d: Drag, target: string | null, cx: number, cy: number) => {
    if (d.kind === 'stack') {
      const p = toCanvas(cx, cy);
      if (Math.abs(cx - d.sx) + Math.abs(cy - d.sy) < 4) return;
      change('Move stack', (s) => { s.layout = { ...(s.layout ?? {}), [d.id]: { x: Math.round((p.x - d.ox) / 10) * 10, y: Math.round((p.y - d.oy) / 10) * 10 } }; });
      return;
    }
    if (d.kind !== 'palette' && d.kind !== 'block') return;
    const overPalette = document.elementsFromPoint(cx, cy).some((el) => (el as HTMLElement).classList?.contains('bc-palette'));
    if (d.kind === 'block' && overPalette) { change('Delete block', (s) => { ops.removeBlock(s, d.id); }); return; }
    const isCond = d.kind === 'palette' ? d.def.kind === 'condition' : BLOCK_DEFS[ops.findBlock(sheet.events, d.id)?.ev[ops.findBlock(sheet.events, d.id)!.slot][ops.findBlock(sheet.events, d.id)!.index].block ?? '']?.kind === 'condition';
    const make = () => d.kind === 'palette' ? ops.newBlock(d.def.id, paletteObj) : null;
    if (target && target !== 'canvas') {
      const [kind, evId, idxS] = target.split(':');
      const idx = Number(idxS ?? -1);
      if (kind === 'child') {
        change('Add sub-event', (s) => {
          const b = d.kind === 'palette' ? make()! : ops.removeBlock(s, d.id)!;
          const ev = isCond ? ops.newEvent([b]) : ops.newEvent([], [b]);
          ops.insertNode(s, ev, evId);
        });
        return;
      }
      const slot: ops.Slot = kind === 'cond' ? 'conditions' : 'actions';
      if ((slot === 'conditions') !== isCond) return; // shape does not fit
      // Dropping a condition on the top bar of loose blocks starts them running.
      const onLooseTop = slot === 'conditions' && idx === -1;
      if (d.kind === 'palette') change('Add block', (s) => { ops.addBlockTo(s, evId, slot, make()!, idx); if (onLooseTop) activate(s, evId); });
      else change('Move block', (s) => { ops.moveBlock(s, d.id, evId, slot, idx); if (onLooseTop) activate(s, evId); });
      return;
    }
    // Dropped on empty canvas: the block lies there on its own (Scratch-style loose blocks, not running) —
    // unless it is a "when …" trigger, which starts a new running stack.
    const p = toCanvas(cx, cy);
    change(d.kind === 'palette' ? 'New stack' : 'Detach block', (s) => {
      const b = d.kind === 'palette' ? make()! : ops.removeBlock(s, d.id)!;
      const ev = isCond ? ops.newEvent([b]) : ops.newEvent([], [b]);
      if (!BLOCK_DEFS[b.block]?.trigger) ev.loose = true;
      s.events.push(ev);
      s.layout = { ...(s.layout ?? {}), [ev.id]: { x: Math.round(p.x / 10) * 10, y: Math.round(p.y / 10) * 10 } };
    });
  };

  const onWheel = (e: React.WheelEvent) => {
    if (!areaRef.current) return;
    const r = areaRef.current.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    const z = Math.min(2, Math.max(0.3, view.z * (e.deltaY < 0 ? 1.1 : 0.9)));
    setView({ z, x: mx - ((mx - view.x) / view.z) * z, y: my - ((my - view.y) / view.z) * z });
  };

  const onKey = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).closest('input,select,textarea')) return;
    if ((e.key === 'Delete' || e.key === 'Backspace') && sel) {
      if (ops.findBlock(sheet.events, sel)) change('Delete block', (s) => { ops.removeBlock(s, sel); });
      else change('Delete stack', (s) => { ops.removeNode(s, sel); });
      setSel(null);
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd' && sel) {
      e.preventDefault();
      change('Duplicate', (s) => {
        const f = ops.findBlock(s.events, sel);
        if (f) f.ev[f.slot].splice(f.index + 1, 0, reassignIds(f.ev[f.slot][f.index]));
        else { const c = ops.duplicateNode(s, sel); if (c && s.layout?.[sel]) s.layout[c.id] = { x: s.layout[sel].x + 30, y: s.layout[sel].y + 30 }; }
      });
    }
  };

  const setParam = (b: BlockInstance, name: string, v: any) => change('Edit parameter', (s) => ops.updateBlock(s, b.id, { params: { ...b.params, [name]: v } }));

  const renderInline = (b: BlockInstance, def: BlockDef) => {
    const parts = def.text.split(/(\{\w+\})/g).filter(Boolean);
    return parts.map((part, i) => {
      const m = /^\{(\w+)\}$/.exec(part);
      if (!m) return <span key={i}>{part}</span>;
      const key = m[1];
      if (key === 'Self') {
        return (
          <select key={i} className="bc-in obj" value={b.target} onPointerDown={(e) => e.stopPropagation()} onChange={(e) => change('Change object', (s) => ops.updateBlock(s, b.id, { target: e.target.value }))}>
            {!types.some((t) => t.name === b.target) && <option>{b.target}</option>}
            {types.map((t) => <option key={t.name}>{t.name}</option>)}
          </select>
        );
      }
      const p = def.params.find((pp) => pp.name === key);
      if (!p) return <span key={i}>{part}</span>;
      return (
        <span key={i} className="bc-slot" onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
          <ParamInput p={p} value={b.params[p.name] ?? p.default} env={env} target={b.target} siblings={b.params} onChange={(v) => setParam(b, p.name, v)}
            onChangeMany={(patch) => change('Edit parameters', (s) => ops.updateBlock(s, b.id, { params: { ...b.params, ...patch } }))} />
        </span>
      );
    });
  };

  const renderBlock = (b: BlockInstance, ev: EventBlock, slot: ops.Slot, i: number) => {
    const def = BLOCK_DEFS[b.block];
    const c = CATEGORIES.find((x) => x.id === def?.category);
    const issue = issueByBlock.get(b.id);
    return (
      <React.Fragment key={b.id}>
        <div className={'bc-drop line' + (hover === `${slot === 'conditions' ? 'cond' : 'act'}:${ev.id}:${i}` ? ' hot' : '')} data-drop={`${slot === 'conditions' ? 'cond' : 'act'}:${ev.id}:${i}`} />
        <div className="bc-blockwrap">
          <div className={'bc-block ' + (slot === 'conditions' ? 'cond' : 'act') + (sel === b.id ? ' sel' : '') + (b.disabled ? ' off' : '') + (issue ? ' issue' : '') + (!def ? ' unknown' : '') + (def && !def.apps.includes(app) ? ' foreign' : '')}
            style={{ ['--c' as any]: c?.color ?? '#777' }}
            title={(issue ? issue.message + '\n' : '') + (def?.doc ?? `Unknown block ${b.block} (preserved)`)}
            onPointerDown={(e) => { if (e.button !== 0) return; e.stopPropagation(); setSel(b.id); props.onSelectBlock?.(b.id, ev.id); setDrag({ kind: 'block', id: b.id, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY }); }}
            onDoubleClick={(e) => { e.stopPropagation(); if (def) setDialog(b); }}
            onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); if (def) setDialog(b); }}>
            {b.invert && <span className="bc-not">not</span>}
            {def ? renderInline(b, def) : <span>{b.block}</span>}
          </div>
          {/* "+" underneath: attach the next block here (shown on hover or when selected). */}
          <button className={'bc-plus' + (sel === b.id ? ' show' : '')} title={slot === 'conditions' ? 'Add a condition below' : 'Add an action below'}
            onPointerDown={(e) => e.stopPropagation()} onClick={(e) => openAttach(e, ev.id, slot, i + 1, b)}>+</button>
        </div>
      </React.Fragment>
    );
  };

  const renderEvent = (ev: EventBlock, nested: boolean): React.ReactNode => {
    if (ev.loose && !nested) return renderLoose(ev);
    const conds = ev.conditions;
    const trig = conds[0] && BLOCK_DEFS[conds[0].block]?.trigger ? conds[0] : null;
    const rest = trig ? conds.slice(1) : conds;
    const trigDef = trig ? BLOCK_DEFS[trig.block] : null;
    const tc = CATEGORIES.find((c) => c.id === trigDef?.category);
    const ran = trace?.has(ev.id);
    return (
      <div data-ev-id={ev.id} className={'bc-event' + (ev.disabled ? ' off' : '') + (ran ? ' ran' : '') + (sel === ev.id ? ' sel' : '') + (nested ? ' nested' : '')}>
        <div className="bc-hat" style={{ ['--c' as any]: tc?.color ?? (ev.isElse ? '#6b7a90' : '#e8892b') }}
          onPointerDown={(e) => { if (nested || e.button !== 0) return; e.stopPropagation(); setSel(ev.id); const p = toCanvas(e.clientX, e.clientY); const se = (e.currentTarget as HTMLElement).closest('.bc-stack') as HTMLElement | null; const pos = se ? { x: se.offsetLeft, y: se.offsetTop } : posOf(ev.id, sheet.events.indexOf(ev)); setDrag({ kind: 'stack', id: ev.id, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, ox: p.x - pos.x, oy: p.y - pos.y }); }}
          onClick={(e) => { e.stopPropagation(); setSel(ev.id); }}>
          {ev.breakpoint && <span className="bc-bp">●</span>}
          {ev.isElse ? <b>else</b> : trig ? <>{renderBlockHat(trig, ev)}</> : <b>{rest.length ? 'every tick, if…' : 'every tick'}</b>}
          <div className={'bc-drop slot' + (hover === `cond:${ev.id}:-1` ? ' hot' : '')} data-drop={`cond:${ev.id}:-1`} title="Drop a condition here" />
          <button className="bc-plus hat" title="Add a condition (if …)" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => openAttach(e, ev.id, 'conditions', -1, trig ?? undefined)}>+ if</button>
        </div>
        {rest.length > 0 && (
          <div className={'bc-if' + (ev.isOr ? ' or' : '')}>
            <span className="bc-if-label">{ev.isOr ? 'if any' : 'if'}</span>
            <div className="bc-if-conds">{rest.map((b) => renderBlock(b, ev, 'conditions', conds.indexOf(b)))}</div>
          </div>
        )}
        <div className={'bc-body' + (rest.length ? ' inside' : '')}>
          {ev.actions.map((b, i) => renderBlock(b, ev, 'actions', i))}
          <div className={'bc-drop end' + (hover === `act:${ev.id}:-1` ? ' hot' : '')} data-drop={`act:${ev.id}:-1`}>
            {ev.actions.length ? '' : <button className="bc-plus empty" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => openAttach(e, ev.id, 'actions', -1)}>+ add an action</button>}
          </div>
          {ev.children.map((ch) => <div key={ch.id} className="bc-sub">{renderNode(ch, true)}</div>)}
          <div className={'bc-drop child' + (hover === `child:${ev.id}` ? ' hot' : '')} data-drop={`child:${ev.id}`}>+ sub-event</div>
        </div>
        {rest.length > 0 && <div className="bc-if-end" />}
      </div>
    );
  };

  /** Loose blocks: just the blocks, with a slim bar to move them and to attach a "when …" block. */
  const renderLoose = (ev: EventBlock): React.ReactNode => (
    <div className={'bc-event bc-loose' + (sel === ev.id ? ' sel' : '')}>
      <div className="bc-loose-bar" title="These blocks are not running. Drop a “when …” block here (or use + when…) to make them run. Drag this bar to move them."
        onPointerDown={(e) => { if (e.button !== 0) return; e.stopPropagation(); setSel(ev.id); const p = toCanvas(e.clientX, e.clientY); const se = (e.currentTarget as HTMLElement).closest('.bc-stack') as HTMLElement | null; const pos = se ? { x: se.offsetLeft, y: se.offsetTop } : posOf(ev.id, 0); setDrag({ kind: 'stack', id: ev.id, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, ox: p.x - pos.x, oy: p.y - pos.y }); }}>
        <span className="bc-loose-grip">⋮⋮</span><span className="bc-loose-label">not running</span>
        <div className={'bc-drop slot' + (hover === `cond:${ev.id}:-1` ? ' hot' : '')} data-drop={`cond:${ev.id}:-1`} />
        <button className="bc-plus hat" title="Attach a “when …” block so these run" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => openAttach(e, ev.id, 'conditions', -1, undefined, true)}>+ when…</button>
      </div>
      {ev.conditions.map((b, i) => renderBlock(b, ev, 'conditions', i))}
      {ev.actions.map((b, i) => renderBlock(b, ev, 'actions', i))}
      {ev.actions.length > 0 && <div className={'bc-drop end' + (hover === `act:${ev.id}:-1` ? ' hot' : '')} data-drop={`act:${ev.id}:-1`} />}
    </div>
  );

  const renderBlockHat = (b: BlockInstance, ev: EventBlock) => {
    const def = BLOCK_DEFS[b.block]!;
    return (
      <span className="bc-hat-text" onDoubleClick={(e) => { e.stopPropagation(); setDialog(b); }} title={def.doc}>
        <span className="bc-when">when</span> {renderInline(b, def)}
        <button className="bc-mini" title="Edit trigger" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); setDialog(b); }}>⋯</button>
        {void ev}
      </span>
    );
  };

  const renderNode = (n: EventNode, nested: boolean): React.ReactNode => {
    if (n.kind === 'comment') {
      return <div className="bc-note"><textarea value={n.text} onPointerDown={(e) => e.stopPropagation()} onChange={(e) => change('Edit comment', (s) => { const l = ops.findNode(s.events, n.id)!; (l.list[l.index] as any).text = e.target.value; })} /></div>;
    }
    if (n.kind === 'group') {
      return (
        <div className={'bc-group' + (n.active ? '' : ' inactive')}>
          <div className="bc-group-head">▣ {n.name}{!n.active && ' (inactive)'}</div>
          {n.children.map((c) => <div key={c.id} className="bc-sub">{renderNode(c, true)}</div>)}
          {!n.children.length && <div className="bc-group-empty">No blocks in this group</div>}
        </div>
      );
    }
    return renderEvent(n, nested);
  };

  const palette = useMemo(() => {
    const ql = q.toLowerCase();
    // Only this app's blocks (LogicCraft is 2D: GameCraft's 3D-only blocks are not offered; older logic that has one
    // still shows it, greyed).
    return BLOCK_LIST.filter((d) => d.apps.includes(app) && (q ? (d.name + d.doc + (d.c2 ?? '')).toLowerCase().includes(ql) : d.category === cat));
  }, [q, cat, app]);
  const cats = useMemo(() => CATEGORIES.filter((c) => BLOCK_LIST.some((d) => d.category === c.id && d.apps.includes(app))), [app]);

  const ghost = drag && (drag.kind === 'palette' || drag.kind === 'block') ? (() => {
    const def = drag.kind === 'palette' ? drag.def : BLOCK_DEFS[ops.findBlock(sheet.events, drag.id)?.ev[ops.findBlock(sheet.events, drag.id)!.slot][ops.findBlock(sheet.events, drag.id)!.index].block ?? ''];
    const c = CATEGORIES.find((x) => x.id === def?.category);
    // Hidden until the pointer actually moves (a click shows no ghost).
    return <div ref={ghostRef} className={'bc-ghost ' + (def?.kind === 'condition' ? 'cond' : 'act')} style={{ left: 0, top: 0, visibility: 'hidden', transform: `translate(${drag.x + 8}px, ${drag.y + 8}px)`, ['--c' as any]: c?.color }}>{def?.name}</div>;
  })() : null;

  return (
    <div className={'bc-root ' + (props.variant ?? 'scratch')} tabIndex={0} onKeyDown={onKey}>
      <ExprHints env={env} />
      {props.showPalette !== false && (
        <div className="bc-palette">
          <div className="bc-cats">
            {cats.map((c) => (
              <button key={c.id} className={'bc-cat' + (cat === c.id && !q ? ' on' : '')} onClick={() => { setCat(c.id); setQ(''); }} title={c.doc}>
                <span style={{ background: c.color }}>{app === 'logiccraft' ? c.emoji ?? c.icon : <Icon name={CATEGORY_ICON[c.id] ?? 'box'} size={13} />}</span>{c.name}
              </button>
            ))}
            <button className={'bc-cat' + (cat === 'packs' && !q ? ' on' : '')} onClick={() => { setCat('packs'); setQ(''); }} title="Presets: ready-made setups (movement, platforms, touch controls, enemy AI, trails, health, inventory, menus) and your own, to drag into your logic">
              <span style={{ background: '#8a6d3b' }}>{app === 'logiccraft' ? '📦' : <Icon name="box" size={13} />}</span>Presets
            </button>
          </div>
          <div className="bc-pal-list">
            {cat === 'packs' && !q ? <PackList /> : <>
            <input className="lx-input search" placeholder="Search blocks…" value={q} onChange={(e) => setQ(e.target.value)} />
            <label className="bc-pal-obj">Object for new blocks
              <select className="lx-input" value={paletteObj} onChange={(e) => setPaletteObj(e.target.value)}>{types.map((t) => <option key={t.name}>{t.name}</option>)}</select>
            </label>
            {palette.map((d) => {
              const c = CATEGORIES.find((x) => x.id === d.category);
              return (
                <div key={d.id} className={'bc-pal-block ' + (d.kind === 'condition' ? (d.trigger ? 'hat' : 'cond') : 'act')} style={{ ['--c' as any]: c?.color }}
                  title={d.doc}
                  onPointerDown={(e) => { e.preventDefault(); setDrag({ kind: 'palette', def: d, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY }); }}>
                  {d.trigger ? 'when ' : ''}{d.name}{d.target === 'object' ? (app === 'logiccraft' ? ' (object)' : ` (${paletteObj})`) : ''}
                </div>
              );
            })}
            <div className="bc-pal-tip">Drag blocks onto the canvas. Drop on a stack to snap in; drop back here to delete.</div>
            </>}
          </div>
        </div>
      )}
      <div className="bc-area" ref={areaRef} data-drop="canvas" onWheel={onWheel}
        onPointerDown={(e) => { if (e.button === 0 || e.button === 1) { setSel(null); setDrag({ kind: 'pan', x: e.clientX, y: e.clientY, px: view.x, py: view.y }); } }}>
        <div className="bc-world" ref={worldRef} style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.z})` }}>
          {sheet.events.map((n, i) => {
            const p = posOf(n.id, i);
            return <div key={n.id} className={'bc-stack' + (drag?.kind === 'stack' && drag.id === n.id ? ' dragging' : '')} data-stack={n.id} style={{ left: p.x, top: p.y }}>{renderNode(n, false)}</div>;
          })}
        </div>
        <div className="bc-zoom">
          <button onClick={() => setView((v) => ({ ...v, z: Math.min(2, v.z * 1.2) }))}>+</button>
          <button onClick={() => setView({ x: 40, y: 30, z: 1 })}>⟲</button>
          <button onClick={() => setView((v) => ({ ...v, z: Math.max(0.3, v.z / 1.2) }))}>−</button>
          <button title="Tidy layout" onClick={() => change('Tidy layout', (s) => { s.layout = {}; })}>▦</button>
        </div>
        {!sheet.events.length && <div className="bc-empty">Drag a <b>when …</b> block from the palette to start.</div>}
        {props.variant === 'pro' && sheet.events.length > 0 && (
          // Outline: every top-level stack, numbered like the canvas; click to jump there.
          <div className="bc-outline" onPointerDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()}>
            <div className="bc-outline-head">Outline <span>{sheet.events.length}</span></div>
            {sheet.events.map((n, i) => {
              const label = n.kind === 'comment' ? '✎ ' + n.text.split('\n')[0] : n.kind === 'group' ? '▣ ' + n.name
                : n.loose ? 'not running' : n.isElse ? 'else' : n.conditions[0] && BLOCK_DEFS[n.conditions[0].block]?.trigger ? 'when ' + (BLOCK_DEFS[n.conditions[0].block]?.name ?? '') : 'every tick';
              const c = n.kind === 'event' && n.conditions[0] ? CATEGORIES.find((x) => x.id === BLOCK_DEFS[n.conditions[0].block]?.category)?.color : undefined;
              return (
                <button key={n.id} data-ev-id={n.kind === 'event' ? n.id : undefined} className={'bc-outline-item' + (sel === n.id ? ' on' : '') + (n.kind === 'event' && trace?.has(n.id) ? ' ran' : '')} style={{ ['--c' as any]: c ?? '#6b7a90' }}
                  onClick={() => { const p = posOf(n.id, i); setSel(n.id); setView((v) => ({ ...v, x: 60 - p.x * v.z, y: 40 - p.y * v.z })); }}>
                  <span className="n">{i + 1}</span><span className="t">{label}</span>
                  {n.kind === 'event' && <span className="k">{n.conditions.length + n.actions.length}</span>}
                </button>
              );
            })}
          </div>
        )}
      </div>
      {ghost}
      {attach && (
        <AttachMenu at={attach} app={app} onPick={pickAttach} onClose={() => setAttach(null)}
          onSubEvent={attach.slot === 'actions' ? () => { const id = attach.evId; change('Add sub-event', (s) => ops.insertNode(s, ops.newEvent(), id)); setAttach(null); } : undefined} />
      )}
      {dialog && BLOCK_DEFS[dialog.block] && (
        <BlockDialog block={dialog} def={BLOCK_DEFS[dialog.block]} env={env} onClose={() => setDialog(null)}
          onSave={(nb) => { change('Edit block', (s) => ops.updateBlock(s, dialog.id, { params: nb.params, target: nb.target, invert: nb.invert, comment: nb.comment })); setDialog(null); }} />
      )}
      {void newId}
    </div>
  );
}
