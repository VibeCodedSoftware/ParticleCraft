// Node-graph coding style. Every event becomes a chain of nodes joined by execution wires:
//   event head (its trigger, or "every tick") → conditions → actions, and sub-events hang off the head's
//   "sub-events" port. Optional data-flow wires show which nodes read and write each global variable.
// The graph is DERIVED from the shared event tree on every render; editing a node, wiring, detaching or deleting
// calls the same logicOps the block and sheet views use. Only node positions are stored (sheet.nodeLayout).
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Glyph } from './icons';
import { BLOCK_DEFS, CATEGORIES, type BlockDef } from '../src/blocks/definitions';
import { reassignIds, type BlockInstance, type EventBlock, type EventNode, type LogicDocument } from '../src/schema';
import * as ops from './logicOps';
import { soundNames } from '../src/sounds';
import { docFunctions, type EditorEnv } from './ParamEditor';
import type { CanvasProps } from './BlockCanvas';
import { BlockMenu } from './BlockMenu';
import { BlockInspector, EventInspector } from './BlockInspector';

const W = 214, HEAD = 26, ROW = 17, COLW = 250;

type Kind = 'head' | 'cond' | 'act' | 'var' | 'note';
interface GNode {
  id: string; kind: Kind; ev?: EventBlock; block?: BlockInstance; slotIndex?: number;
  x: number; y: number; h: number; title: string; color: string; rows: [string, string][]; depth: number;
  badge?: string; noteText?: string;
}
interface GWire { from: string; to: string; kind: 'exec' | 'sub' | 'else' | 'read' | 'write' }

const fmtVal = (v: unknown) => { const s = String(v); return s.length > 22 ? s.slice(0, 21) + '…' : s; };

function blockRows(b: BlockInstance): [string, string][] {
  const def = BLOCK_DEFS[b.block];
  const rows: [string, string][] = [];
  if (b.target) rows.push(['object', b.target]);
  for (const p of def?.params ?? []) rows.push([p.label, fmtVal(b.params[p.name] ?? p.default)]);
  return rows.slice(0, 6);
}

/** Build nodes/wires from the event tree. Auto layout: one row per event, sub-events below and indented. */
function buildGraph(sheet: ReturnType<typeof ops.sheetOf>, doc: LogicDocument, showData: boolean) {
  const nodes: GNode[] = [];
  const wires: GWire[] = [];
  const frames: { name: string; ids: string[]; active: boolean }[] = [];
  const L = sheet.nodeLayout ?? {};
  let y = 40;
  const place = (n: GNode) => { const p = L[n.id]; if (p) { n.x = p.x; n.y = p.y; } nodes.push(n); return n; };
  const hOf = (rows: number) => HEAD + Math.max(1, rows) * ROW + 8;

  const walk = (list: EventNode[], depth: number, parentHead: string | null, frameIds: string[] | null) => {
    let prevHead: string | null = null;
    for (const n of list) {
      const x0 = 40 + depth * 70;
      if (n.kind === 'comment') {
        const g = place({ id: n.id, kind: 'note', x: x0, y, h: 70, title: 'Note', color: '#e6c84f', rows: [], depth, noteText: n.text });
        frameIds?.push(g.id); y += 100; prevHead = null; continue;
      }
      if (n.kind === 'group') {
        const ids: string[] = [];
        y += 26;
        walk(n.children, depth, parentHead, ids);
        frames.push({ name: n.name, ids, active: n.active });
        frameIds?.push(...ids);
        y += 20; prevHead = null; continue;
      }
      const ev = n;
      const trig = ev.conditions[0] && BLOCK_DEFS[ev.conditions[0].block]?.trigger ? ev.conditions[0] : null;
      const tdef = trig ? BLOCK_DEFS[trig.block] : null;
      const tc = CATEGORIES.find((c) => c.id === tdef?.category);
      const headRows = trig ? blockRows(trig) : [];
      const head = place({
        id: 'ev:' + ev.id, kind: 'head', ev, block: trig ?? undefined, x: x0, y, h: hOf(headRows.length || 1),
        title: ev.loose ? 'Not running' : ev.isElse ? 'Else' : trig ? 'When ' + (tdef?.name ?? trig.block) : 'Every tick',
        color: ev.loose ? '#6b6b6b' : tc?.color ?? (ev.isElse ? '#6b7a90' : '#e8892b'),
        rows: headRows.length ? headRows : [['runs', ev.loose ? 'never (attach a trigger)' : ev.isElse ? 'when the event above did not' : trig ? 'when it happens' : 'every frame']], depth,
        badge: [ev.isOr ? 'OR' : '', ev.disabled ? 'off' : '', ev.breakpoint ? '●' : ''].filter(Boolean).join(' '),
      });
      frameIds?.push(head.id);
      if (parentHead) wires.push({ from: parentHead, to: head.id, kind: 'sub' });
      if (ev.isElse && prevHead) wires.push({ from: prevHead, to: head.id, kind: 'else' });
      let prev = head.id, col = 1, rowH = head.h;
      const chain: [BlockInstance, 'cond' | 'act', number][] = [
        ...ev.conditions.map((b, i) => [b, 'cond', i] as [BlockInstance, 'cond', number]).filter(([b]) => b !== trig),
        ...ev.actions.map((b, i) => [b, 'act', i] as [BlockInstance, 'act', number]),
      ];
      for (const [b, kind, i] of chain) {
        const def = BLOCK_DEFS[b.block];
        const c = CATEGORIES.find((x) => x.id === def?.category);
        const rows = blockRows(b);
        const g = place({ id: b.id, kind, ev, block: b, slotIndex: i, x: x0 + col * COLW, y, h: hOf(rows.length), title: (b.invert ? 'NOT ' : '') + (def?.name ?? b.block), color: c?.color ?? '#777', rows, depth, badge: b.disabled ? 'off' : undefined });
        frameIds?.push(g.id);
        wires.push({ from: prev, to: g.id, kind: 'exec' });
        prev = g.id; col++; rowH = Math.max(rowH, g.h);
      }
      y += rowH + 46;
      walk(ev.children, depth + 1, head.id, frameIds);
      prevHead = head.id;
    }
  };
  walk(sheet.events, 0, null, null);

  // Data flow: which nodes read / write each global variable.
  if (showData && doc.globals.length) {
    const names = doc.globals.map((g) => g.name);
    const used = new Set<string>();
    const reads: GWire[] = [];
    for (const n of nodes) {
      if (!n.block) continue;
      const def = BLOCK_DEFS[n.block.block];
      for (const p of def?.params ?? []) {
        const v = String(n.block.params[p.name] ?? '');
        if (p.type === 'variable') { if (names.includes(v)) { used.add(v); reads.push({ from: n.id, to: 'var:' + v, kind: def?.kind === 'action' ? 'write' : 'read' }); } continue; }
        if (p.type !== 'expr') continue;
        for (const nm of names) if (new RegExp(`(^|[^A-Za-z0-9_.])${nm}($|[^A-Za-z0-9_])`).test(v)) { used.add(nm); reads.push({ from: 'var:' + nm, to: n.id, kind: 'read' }); }
      }
    }
    let vy = 40;
    const minX = Math.min(40, ...nodes.map((n) => n.x));
    for (const nm of names.filter((x) => used.has(x))) {
      const g = doc.globals.find((x) => x.name === nm)!;
      place({ id: 'var:' + nm, kind: 'var', x: minX - 230, y: vy, h: HEAD + ROW + 8, title: nm, color: '#f07818', rows: [[g.type, fmtVal(JSON.stringify(g.value))]], depth: 0 });
      vy += 70;
    }
    wires.push(...reads);
  }
  return { nodes, wires, frames };
}

type Drag =
  | { kind: 'pan'; x: number; y: number; vx: number; vy: number }
  | { kind: 'node'; id: string; x: number; y: number; nx: number; ny: number; moved: boolean }
  | { kind: 'wire'; from: string; x: number; y: number };

export function NodeGraphView(props: CanvasProps) {
  const { doc, app, types, onChange, trace, issues = [] } = props;
  const sheet = ops.sheetOf(doc, props.sheetId);
  const [view, setView] = useState({ x: 260, y: 20, z: 0.9 });
  const [sel, setSel] = useState<string | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [live, setLive] = useState<Record<string, { x: number; y: number }>>({});
  const [menu, setMenu] = useState<{ x: number; y: number; wx: number; wy: number; after?: string } | null>(null);
  const [showData, setShowData] = useState(true);
  const areaRef = useRef<HTMLDivElement>(null);
  const env: EditorEnv = { app, types, variables: doc.globals, functions: docFunctions(doc), particlePresets: props.particlePresets, dialogues: (doc.dialogues ?? []).map((d) => d.name), scenes: props.sceneNames, sounds: soundNames(doc.sounds), videos: (doc.videos ?? []).map((v) => v.name), pictures: (doc.pictures ?? []).map((v) => v.name) };
  const issueIds = useMemo(() => new Set(issues.map((i) => i.blockId).filter(Boolean)), [issues]);

  const { nodes, wires, frames } = useMemo(() => buildGraph(sheet, doc, showData), [sheet, doc, showData]);
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const pos = (n: GNode) => live[n.id] ?? { x: n.x, y: n.y };

  useEffect(() => { if (props.focusBlockId && byId.has(props.focusBlockId)) setSel(props.focusBlockId); }, [props.focusBlockId, byId]);

  const change = (label: string, fn: (s: ReturnType<typeof ops.sheetOf>) => void) => onChange(ops.edit(doc, (d) => fn(ops.sheetOf(d, props.sheetId))), label);
  const toWorld = (cx: number, cy: number) => { const r = areaRef.current!.getBoundingClientRect(); return { x: (cx - r.left - view.x) / view.z, y: (cy - r.top - view.y) / view.z }; };

  /** Drop events left with nothing in them after a node was moved out (never ones with sub-events). */
  const prune = (s: ReturnType<typeof ops.sheetOf>, evId?: string) => {
    if (!evId) return;
    const f = ops.findNode(s.events, evId); const n = f?.list[f.index];
    if (n?.kind === 'event' && !n.conditions.length && !n.actions.length && !n.children.length) ops.removeNode(s, evId);
  };

  /** Wire semantics: connecting A → B puts B right after A in A's chain (or makes B's event a sub-event of A's). */
  const connect = (fromId: string, toId: string) => {
    const F = byId.get(fromId), T = byId.get(toId);
    if (!F || !T || F === T || !F.ev || T.kind === 'var' || T.kind === 'note' || F.kind === 'var') return;
    if (T.kind === 'head') { change('Make sub-event', (s) => ops.moveNode(s, T.ev!.id, F.ev!.id, -1)); return; }
    const b = T.block!;
    const isCond = BLOCK_DEFS[b.block]?.kind === 'condition';
    const fev = F.ev;
    const trigOffset = fev.conditions[0] && BLOCK_DEFS[fev.conditions[0].block]?.trigger ? 1 : 0;
    let slot: ops.Slot, index: number;
    if (F.kind === 'head') { slot = isCond ? 'conditions' : 'actions'; index = isCond ? trigOffset : 0; }
    else if (F.kind === 'cond') { slot = isCond ? 'conditions' : 'actions'; index = isCond ? F.slotIndex! + 1 : 0; }
    else { slot = isCond ? 'conditions' : 'actions'; index = isCond ? -1 : F.slotIndex! + 1; }
    const oldEv = T.ev?.id;
    change('Connect nodes', (s) => { ops.moveBlock(s, b.id, fev.id, slot, index); if (oldEv !== fev.id) prune(s, oldEv); });
  };

  const addBlock = (d: BlockDef) => {
    if (!menu) return;
    const b = ops.newBlock(d.id, props.defaultObject ?? types[0]?.name);
    const at = { x: Math.round(menu.wx / 10) * 10, y: Math.round(menu.wy / 10) * 10 };
    const after = menu.after ? byId.get(menu.after) : undefined;
    setMenu(null);
    if (after?.ev && !d.trigger) {
      change('Add node', (s) => {
        const isCond = d.kind === 'condition';
        const ev = after.ev!;
        const trigOffset = ev.conditions[0] && BLOCK_DEFS[ev.conditions[0].block]?.trigger ? 1 : 0;
        const idx = after.kind === 'head' ? (isCond ? trigOffset : 0) : after.kind === 'cond' ? (isCond ? after.slotIndex! + 1 : 0) : (isCond ? -1 : after.slotIndex! + 1);
        ops.addBlockTo(s, ev.id, isCond ? 'conditions' : 'actions', b, idx);
        s.nodeLayout = { ...(s.nodeLayout ?? {}), [b.id]: at };
      });
    } else {
      change('Add node', (s) => {
        const ev = d.kind === 'condition' ? ops.newEvent([b]) : ops.newEvent([], [b]);
        if (!d.trigger) ev.loose = true;
        s.events.push(ev);
        s.nodeLayout = { ...(s.nodeLayout ?? {}), ['ev:' + ev.id]: at, [b.id]: d.trigger ? at : { x: at.x + COLW, y: at.y } };
      });
    }
    setSel(d.trigger ? null : b.id);
  };

  const remove = (id: string) => {
    const n = byId.get(id);
    if (!n) return;
    if (n.kind === 'head') change('Delete event', (s) => { ops.removeNode(s, n.ev!.id); });
    else if (n.kind === 'note') change('Delete note', (s) => { ops.removeNode(s, id); });
    else if (n.block) change('Delete node', (s) => { ops.removeBlock(s, id); prune(s, n.ev?.id); });
    setSel(null);
  };

  const detach = (id: string) => {
    const n = byId.get(id);
    if (!n?.block || n.kind === 'head') return;
    const p = pos(n);
    change('Detach node', (s) => {
      const b = ops.removeBlock(s, id)!;
      const ev = BLOCK_DEFS[b.block]?.kind === 'condition' ? ops.newEvent([b]) : ops.newEvent([], [b]);
      ev.loose = true;
      s.events.push(ev);
      s.nodeLayout = { ...(s.nodeLayout ?? {}), ['ev:' + ev.id]: { x: p.x - COLW, y: p.y + 120 }, [b.id]: { x: p.x, y: p.y + 120 } };
      prune(s, n.ev?.id);
    });
  };

  // Pointer handling outside React state for smooth dragging.
  useEffect(() => {
    if (!drag) return;
    const move = (e: PointerEvent) => {
      if (drag.kind === 'pan') setView((v) => ({ ...v, x: drag.vx + e.clientX - drag.x, y: drag.vy + e.clientY - drag.y }));
      else if (drag.kind === 'node') {
        const dx = (e.clientX - drag.x) / view.z, dy = (e.clientY - drag.y) / view.z;
        if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 3) return;
        drag.moved = true;
        setLive({ [drag.id]: { x: drag.nx + dx, y: drag.ny + dy } });
      } else setCursor(toWorld(e.clientX, e.clientY));
    };
    const up = (e: PointerEvent) => {
      if (drag.kind === 'node' && drag.moved) {
        const p = live[drag.id] ?? { x: drag.nx + (e.clientX - drag.x) / view.z, y: drag.ny + (e.clientY - drag.y) / view.z };
        const id = drag.id;
        change('Move node', (s) => { s.nodeLayout = { ...(s.nodeLayout ?? {}), [id]: { x: Math.round(p.x / 10) * 10, y: Math.round(p.y / 10) * 10 } }; });
      }
      if (drag.kind === 'wire') {
        const target = document.elementsFromPoint(e.clientX, e.clientY).map((el) => (el as HTMLElement).dataset?.nodeIn).find(Boolean);
        if (target) connect(drag.from, target);
        else { const w = toWorld(e.clientX, e.clientY); setMenu({ x: e.clientX, y: e.clientY, wx: w.x, wy: w.y, after: drag.from }); }
      }
      setDrag(null); setLive({}); setCursor(null);
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag, live, view.z]);

  const onWheel = (e: React.WheelEvent) => {
    const r = areaRef.current!.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    const z = Math.min(2, Math.max(0.25, view.z * (e.deltaY < 0 ? 1.1 : 0.9)));
    setView({ z, x: mx - ((mx - view.x) / view.z) * z, y: my - ((my - view.y) / view.z) * z });
  };
  const onKey = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).closest('input,select,textarea')) return;
    if ((e.key === 'Delete' || e.key === 'Backspace') && sel) remove(sel);
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd' && sel) {
      e.preventDefault();
      const n = byId.get(sel);
      if (n?.block && n.kind !== 'head') change('Duplicate node', (s) => { const f = ops.findBlock(s.events, sel); if (f) f.ev[f.slot].splice(f.index + 1, 0, reassignIds(f.ev[f.slot][f.index])); });
      else if (n?.kind === 'head') change('Duplicate event', (s) => { ops.duplicateNode(s, n.ev!.id); });
    }
    if (e.key === ' ' || e.key === 'Tab') {
      e.preventDefault();
      const r = areaRef.current!.getBoundingClientRect();
      const w = toWorld(r.left + r.width / 2, r.top + r.height / 2);
      setMenu({ x: r.left + r.width / 2 - 150, y: r.top + 60, wx: w.x, wy: w.y, after: sel ?? undefined });
    }
  };
  const frameAll = () => {
    if (!nodes.length || !areaRef.current) return;
    const xs = nodes.map((n) => n.x), ys = nodes.map((n) => n.y);
    const minX = Math.min(...xs), minY = Math.min(...ys), maxX = Math.max(...xs) + W, maxY = Math.max(...ys) + 120;
    const r = areaRef.current.getBoundingClientRect();
    const z = Math.min(1.2, Math.max(0.25, Math.min(r.width / (maxX - minX + 80), r.height / (maxY - minY + 80))));
    setView({ z, x: -minX * z + 40, y: -minY * z + 40 });
  };

  const port = (n: GNode, side: 'in' | 'out' | 'sub') => {
    const p = pos(n);
    if (side === 'in') return { x: p.x, y: p.y + HEAD / 2 };
    if (side === 'out') return { x: p.x + W, y: p.y + HEAD / 2 };
    return { x: p.x + 18, y: p.y + n.h };
  };
  const wirePath = (a: { x: number; y: number }, b: { x: number; y: number }, vertical = false) => {
    if (vertical) { const dy = Math.max(30, Math.abs(b.y - a.y) / 2); return `M${a.x},${a.y} C${a.x},${a.y + dy} ${b.x - 60},${b.y} ${b.x},${b.y}`; }
    const dx = Math.max(40, Math.abs(b.x - a.x) / 2);
    return `M${a.x},${a.y} C${a.x + dx},${a.y} ${b.x - dx},${b.y} ${b.x},${b.y}`;
  };

  const selNode = sel ? byId.get(sel) : undefined;

  return (
    <div className="ng-root" tabIndex={0} onKeyDown={onKey}>
      <div className="ng-area" ref={areaRef} onWheel={onWheel}
        onPointerDown={(e) => { if (e.button === 0 || e.button === 1) { setSel(null); setDrag({ kind: 'pan', x: e.clientX, y: e.clientY, vx: view.x, vy: view.y }); } }}
        onContextMenu={(e) => { e.preventDefault(); const w = toWorld(e.clientX, e.clientY); setMenu({ x: e.clientX, y: e.clientY, wx: w.x, wy: w.y }); }}>
        <div className="ng-world" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.z})` }}>
          {frames.map((f, i) => {
            const ns = f.ids.map((id) => byId.get(id)).filter(Boolean) as GNode[];
            if (!ns.length) return null;
            const x0 = Math.min(...ns.map((n) => pos(n).x)) - 16, y0 = Math.min(...ns.map((n) => pos(n).y)) - 30;
            const x1 = Math.max(...ns.map((n) => pos(n).x + W)) + 16, y1 = Math.max(...ns.map((n) => pos(n).y + n.h)) + 16;
            return <div key={i} className={'ng-frame' + (f.active ? '' : ' off')} style={{ left: x0, top: y0, width: x1 - x0, height: y1 - y0 }}><span>▣ {f.name}</span></div>;
          })}
          <svg className="ng-wires" width="1" height="1">
            <defs><marker id="ng-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#9aa7b8" /></marker></defs>
            {wires.map((w, i) => {
              const a = byId.get(w.from), b = byId.get(w.to);
              if (!a || !b) return null;
              if (w.kind === 'exec') return <path key={i} className="ng-wire exec" d={wirePath(port(a, 'out'), port(b, 'in'))} markerEnd="url(#ng-arrow)" />;
              if (w.kind === 'sub') return <path key={i} className="ng-wire sub" d={wirePath(port(a, 'sub'), port(b, 'in'), true)} markerEnd="url(#ng-arrow)" />;
              if (w.kind === 'else') return <path key={i} className="ng-wire else" d={wirePath(port(a, 'sub'), port(b, 'in'), true)} />;
              const from = w.kind === 'read' ? port(a, 'out') : port(a, 'out');
              return <path key={i} className={'ng-wire data ' + w.kind} d={wirePath(from, { x: pos(b).x, y: pos(b).y + HEAD + 8 })} />;
            })}
            {drag?.kind === 'wire' && cursor && byId.get(drag.from) && <path className="ng-wire temp" d={wirePath(port(byId.get(drag.from)!, 'out'), cursor)} />}
          </svg>
          {nodes.map((n) => {
            const p = pos(n);
            const ran = n.kind === 'head' && n.ev && trace?.has(n.ev.id);
            if (n.kind === 'note') {
              return (
                <div key={n.id} className={'ng-note' + (sel === n.id ? ' sel' : '')} style={{ left: p.x, top: p.y }} onPointerDown={(e) => { e.stopPropagation(); setSel(n.id); setDrag({ kind: 'node', id: n.id, x: e.clientX, y: e.clientY, nx: p.x, ny: p.y, moved: false }); }}>
                  <textarea value={n.noteText} onPointerDown={(e) => e.stopPropagation()} onChange={(e) => change('Edit comment', (s) => { const l = ops.findNode(s.events, n.id); if (l) (l.list[l.index] as any).text = e.target.value; })} />
                </div>
              );
            }
            return (
              <div key={n.id} data-ev-id={n.kind === 'head' ? n.ev?.id : undefined} className={`ng-node ${n.kind}` + (sel === n.id ? ' sel' : '') + (ran ? ' ran' : '') + (n.block && issueIds.has(n.block.id) ? ' issue' : '') + (n.badge === 'off' ? ' off' : '')}
                style={{ left: p.x, top: p.y, width: W, ['--c' as any]: n.color }}
                title={n.block ? BLOCK_DEFS[n.block.block]?.doc : undefined}
                onPointerDown={(e) => { if (e.button !== 0) return; e.stopPropagation(); setSel(n.id); setDrag({ kind: 'node', id: n.id, x: e.clientX, y: e.clientY, nx: p.x, ny: p.y, moved: false }); }}
                onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setSel(n.id); }}>
                {n.kind !== 'var' && <span className="ng-port in" data-node-in={n.id} title="Execution in: drop a wire here" />}
                <div className="ng-head">
                  <span className="ng-kind">{n.kind === 'head' ? <Glyph e="▶" i="play" size={11} /> : n.kind === 'cond' ? '◆' : n.kind === 'var' ? '𝑥' : '●'}</span>
                  <span className="ng-title">{n.title}</span>
                  {n.badge && <span className="ng-badge">{n.badge}</span>}
                </div>
                <div className="ng-body">
                  {n.rows.map(([k, v], i) => <div key={i} className="ng-row"><span>{k}</span><b>{v}</b></div>)}
                </div>
                {n.kind !== 'var' && <span className="ng-port out" title="Execution out: drag to another node to connect, or to empty space to add" onPointerDown={(e) => { e.stopPropagation(); setDrag({ kind: 'wire', from: n.id, x: e.clientX, y: e.clientY }); setCursor(toWorld(e.clientX, e.clientY)); }} />}
                {n.kind === 'head' && <span className="ng-port sub" title="Sub-events: drag onto another event's head" onPointerDown={(e) => { e.stopPropagation(); setDrag({ kind: 'wire', from: n.id, x: e.clientX, y: e.clientY }); }} />}
              </div>
            );
          })}
        </div>
        {!nodes.length && <div className="bc-empty">Right-click (or press Space) to add a node. Start with a <b>When …</b> trigger.</div>}
        <div className="ng-tools">
          <label title="Show which nodes read and write global variables"><input type="checkbox" checked={showData} onChange={(e) => setShowData(e.target.checked)} /> Data flow</label>
          <button onClick={frameAll} title="Fit the whole graph">Fit</button>
          <button onClick={() => setView((v) => ({ ...v, z: Math.min(2, v.z * 1.2) }))}>+</button>
          <button onClick={() => setView((v) => ({ ...v, z: Math.max(0.25, v.z / 1.2) }))}>−</button>
        </div>
        <div className="ng-legend"><span className="l exec" />execution <span className="l sub" />sub-event <span className="l read" />reads <span className="l write" />writes variable</div>
      </div>
      <div className="ng-side">
        {selNode?.kind === 'head' && selNode.ev ? (
          <>
            {selNode.block && <BlockInspector block={selNode.block} env={env} onPatch={(p) => change('Edit trigger', (s) => ops.updateBlock(s, selNode.block!.id, p))} />}
            <EventInspector ev={selNode.ev} onPatch={(p) => change('Edit event', (s) => { const f = ops.findNode(s.events, selNode.ev!.id); if (f) Object.assign(f.list[f.index], p); })} onDelete={() => remove(selNode.id)} />
          </>
        ) : selNode?.block ? (
          <BlockInspector block={selNode.block} env={env} onPatch={(p) => change('Edit node', (s) => ops.updateBlock(s, selNode.block!.id, p))} onDelete={() => remove(selNode.id)}
            extra={<button className="lx-btn" onClick={() => detach(selNode.id)} title="Take this node out of its chain (it stops running)">Detach from chain</button>} />
        ) : selNode?.kind === 'var' ? (
          <div className="lx-insp"><div className="lx-insp-head"><b>Variable {selNode.title}</b></div><p className="lx-doc">Orange wires show nodes that read this variable; red wires show nodes that change it. Edit variables in the Variables panel.</p></div>
        ) : (
          <div className="lx-insp">
            <div className="lx-insp-head"><b>Node graph</b></div>
            <ul className="lx-help">
              <li><b>Right-click</b> or <b>Space</b>: add a node.</li>
              <li>Drag a node's <b>right port</b> onto another node to run it next; drop on empty space to add one there.</li>
              <li>Drag a head's <b>bottom port</b> onto another event to make it a sub-event.</li>
              <li><b>Del</b> deletes, <b>Ctrl+D</b> duplicates, wheel zooms, drag empty space to pan.</li>
            </ul>
          </div>
        )}
      </div>
      {menu && <BlockMenu x={menu.x} y={menu.y} app={app} title={menu.after ? 'Add a node after the selected one' : 'Add a node'}
        filter={(d) => (menu.after ? !d.trigger : true)} onPick={addBlock} onClose={() => setMenu(null)} />}
    </div>
  );
}
