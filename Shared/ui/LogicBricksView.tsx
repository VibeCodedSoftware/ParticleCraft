// Logic-brick coding style, laid out like Blender / UPBGE's logic editor:
//   Sensors | Controllers | Actuators columns, each grouped under object bars ("Frankie  | Add Sensor"),
//   compact brick rows (▸ type name 📌 ▲▼ ☑ ✕) joined by link wires, and a Properties panel of game properties.
// Mapping to the shared event tree: each EVENT is a controller (AND / OR / ELSE), its conditions are the sensors
// wired into it and its actions are the actuators it drives; sub-events are controllers fed by their parent.
// Every edit goes through logicOps, so the program is identical in every coding style.
import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Glyph } from './icons';
import { BLOCK_DEFS, type BlockDef } from '../src/blocks/definitions';
import type { BlockInstance, EventBlock, EventNode, VarType } from '../src/schema';
import * as ops from './logicOps';
import { soundNames } from '../src/sounds';
import { ExprHints, ParamInput, docFunctions, type EditorEnv } from './ParamEditor';
import type { CanvasProps } from './BlockCanvas';
import { BlockMenu } from './BlockMenu';

const SCENE = 'Scene';

/** Blender-style brick type names for our blocks. */
function sensorType(b: BlockInstance): string {
  const id = b.block;
  if (/^input\.(key|on_key)/.test(id)) return 'Keyboard';
  if (/^input\.(mouse|on_mouse)|clicked|cursor/.test(id)) return 'Mouse';
  if (/collision|trigger_enter|overlap|touching/.test(id)) return 'Collision';
  if (/every_tick|forever|on_start|game_start|fixed_update/.test(id)) return 'Always';
  if (/^var\.|compare_var|instance_var|is_true|on_changed/.test(id)) return 'Property';
  if (/timer|every_x|delay|wait/.test(id)) return 'Delay';
  if (/ray|line_of_sight|sees/.test(id)) return 'Ray';
  if (/signal|custom|function/.test(id)) return 'Message';
  if (/^dialogue\./.test(id)) return 'Dialogue';
  if (/near|distance|radar/.test(id)) return 'Near';
  return 'Property';
}
function actuatorType(b: BlockInstance): string {
  const id = b.block;
  if (/move|rotate|set_position|set_angle|velocity|impulse|force|jump|glide|bounce|look_at|point_toward|go_random/.test(id)) return 'Motion';
  if (/^var\.|set_var|add_var|toggle_var|list\.|dict\./.test(id)) return 'Property';
  if (/create|destroy|spawn|set_parent|attach/.test(id)) return 'Edit Object';
  if (/scene|restart/.test(id)) return 'Scene';
  if (/^audio\./.test(id)) return 'Sound';
  if (/^anim\.|costume|^sprite\./.test(id)) return 'Action';
  if (/^camera\.|^postfx\./.test(id)) return 'Camera';
  if (/^game\.|pause|resume|timescale/.test(id)) return 'Game';
  if (/signal|^function\./.test(id)) return 'Message';
  if (/^code\./.test(id)) return 'Python';
  if (/^ui\.|looks\./.test(id)) return 'Text';
  if (/^dialogue\./.test(id)) return 'Dialogue';
  if (/^particles\./.test(id)) return 'Effect';
  return 'Property';
}

interface Ctrl { ev: EventBlock; depth: number; parent?: string; owner: string }
interface Group { owner: string; ctrls: Ctrl[] }

/** Object that "owns" an event: the first object its blocks refer to (Blender bricks live on objects). */
function ownerOf(ev: EventBlock): string {
  return [...ev.conditions, ...ev.actions].find((b) => b.target)?.target ?? SCENE;
}

const VAR_LABEL: Record<string, string> = { number: 'Float', string: 'String', boolean: 'Boolean', array: 'List', dict: 'Dict', vector: 'Vector', object: 'Object' };

export function LogicBricksView(props: CanvasProps) {
  const { doc, app, types, onChange, trace } = props;
  const sheet = ops.sheetOf(doc, props.sheetId);
  const env: EditorEnv = { app, types, variables: doc.globals, functions: docFunctions(doc), particlePresets: props.particlePresets, dialogues: (doc.dialogues ?? []).map((d) => d.name), scenes: props.sceneNames, sounds: soundNames(doc.sounds), videos: (doc.videos ?? []).map((v) => v.name), pictures: (doc.pictures ?? []).map((v) => v.name) };
  const change = (label: string, fn: (s: ReturnType<typeof ops.sheetOf>) => void) => onChange(ops.edit(doc, (d) => fn(ops.sheetOf(d, props.sheetId))), label);

  const [active, setActive] = useState<string | null>(null);
  const [flags, setFlags] = useState({ sel: false, act: true, link: true, state: true });
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<{ x: number; y: number; kind: 'sensor' | 'controller' | 'actuator'; owner: string } | null>(null);
  const [wire, setWire] = useState<{ sx: number; sy: number; x: number; y: number } | null>(null);
  const [paths, setPaths] = useState<{ d: string; cls: string }[]>([]);
  const [propsOpen, setPropsOpen] = useState(true);
  const boxRef = useRef<HTMLDivElement>(null);

  // Controllers grouped by owning object, in sheet order (groups and comments flatten into the list).
  const groups = useMemo(() => {
    const map = new Map<string, Group>();
    const walk = (list: EventNode[], depth: number, parent?: string) => {
      for (const n of list) {
        if (n.kind === 'comment') continue;
        if (n.kind === 'group') { walk(n.children, depth, parent); continue; }
        const owner = ownerOf(n);
        if (!map.has(owner)) map.set(owner, { owner, ctrls: [] });
        map.get(owner)!.ctrls.push({ ev: n, depth, parent, owner });
        walk(n.children, depth + 1, n.id);
      }
    };
    walk(sheet.events, 0);
    // Objects without bricks still get a bar so you can add to them.
    for (const t of types) if (!map.has(t.name) && t.kind !== 'camera') map.set(t.name, { owner: t.name, ctrls: [] });
    const list = [...map.values()];
    return flags.sel && active ? list.filter((g) => g.owner === active) : list;
  }, [sheet, types, flags.sel, active]);
  const curOwner = active ?? groups[0]?.owner ?? SCENE;

  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box || !flags.link) { setPaths([]); return; }
    const r0 = box.getBoundingClientRect();
    const at = (el: Element) => { const r = el.getBoundingClientRect(); return { x: r.left - r0.left + r.width / 2 + box.scrollLeft, y: r.top - r0.top + r.height / 2 + box.scrollTop }; };
    const q = (s: string) => box.querySelector(s);
    const curve = (a: { x: number; y: number }, b: { x: number; y: number }) => { const dx = Math.max(24, (b.x - a.x) * 0.45); return `M${a.x},${a.y} C${a.x + dx},${a.y} ${b.x - dx},${b.y} ${b.x},${b.y}`; };
    const out: { d: string; cls: string }[] = [];
    for (const g of groups) for (const c of g.ctrls) {
      const cin = q(`[data-ctrl-in="${c.ev.id}"]`), cout = q(`[data-ctrl-out="${c.ev.id}"]`);
      if (!cin || !cout) continue;
      for (const b of c.ev.conditions) { const s = q(`[data-sensor-out="${b.id}"]`); if (s) out.push({ d: curve(at(s), at(cin)), cls: b.disabled ? 'off' : '' }); }
      for (const b of c.ev.actions) { const a = q(`[data-act-in="${b.id}"]`); if (a) out.push({ d: curve(at(cout), at(a)), cls: b.disabled ? 'off' : '' }); }
      if (c.parent) { const pc = q(`[data-ctrl-out="${c.parent}"]`); if (pc) out.push({ d: curve(at(pc), at(cin)), cls: 'sub' }); }
    }
    setPaths(out);
  }, [groups, open, doc, flags]);

  const findEv = (s: ReturnType<typeof ops.sheetOf>, id: string) => { const f = ops.findNode(s.events, id); return f?.list[f.index] as EventBlock | undefined; };
  const dropEmpty = (s: ReturnType<typeof ops.sheetOf>, evId?: string) => { if (!evId) return; const e = findEv(s, evId); if (e && !e.conditions.length && !e.actions.length && !e.children.length) ops.removeNode(s, evId); };

  /** Link by dragging sockets: sensor → controller, controller → actuator, controller → controller (sub-event). */
  const link = (from: { id: string; kind: 'sensor' | 'ctrl' | 'act' }, to: { id: string; kind: 'ctrl-in' | 'ctrl-out' | 'act-in' }) => {
    if (from.kind === 'sensor' && to.kind === 'ctrl-in') {
      const f = ops.findBlock(sheet.events, from.id); if (!f || f.ev.id === to.id) return;
      change('Link sensor', (s) => { ops.moveBlock(s, from.id, to.id, 'conditions', -1); dropEmpty(s, f.ev.id); });
    } else if (from.kind === 'ctrl' && to.kind === 'act-in') {
      const f = ops.findBlock(sheet.events, to.id); if (!f || f.ev.id === from.id) return;
      change('Link actuator', (s) => { ops.moveBlock(s, to.id, from.id, 'actions', -1); dropEmpty(s, f.ev.id); });
    } else if (from.kind === 'act' && to.kind === 'ctrl-out') {
      const f = ops.findBlock(sheet.events, from.id); if (!f || f.ev.id === to.id) return;
      change('Link actuator', (s) => { ops.moveBlock(s, from.id, to.id, 'actions', -1); dropEmpty(s, f.ev.id); });
    } else if (from.kind === 'ctrl' && to.kind === 'ctrl-in' && from.id !== to.id) {
      change('Make sub-controller', (s) => ops.moveNode(s, to.id, from.id, -1));
    }
  };
  const startWire = (e: React.PointerEvent, from: string, kind: 'sensor' | 'ctrl' | 'act') => {
    e.stopPropagation(); e.preventDefault();
    const box = boxRef.current!; const r0 = box.getBoundingClientRect();
    const toBox = (cx: number, cy: number) => ({ x: cx - r0.left + box.scrollLeft, y: cy - r0.top + box.scrollTop });
    const start = toBox(e.clientX, e.clientY);
    setWire({ sx: start.x, sy: start.y, ...start });
    const move = (ev: PointerEvent) => setWire({ sx: start.x, sy: start.y, ...toBox(ev.clientX, ev.clientY) });
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
      setWire(null);
      const el = document.elementsFromPoint(ev.clientX, ev.clientY).find((x) => (x as HTMLElement).dataset?.ctrlIn || (x as HTMLElement).dataset?.ctrlOut || (x as HTMLElement).dataset?.actIn) as HTMLElement | undefined;
      if (!el) return;
      if (el.dataset.ctrlIn) link({ id: from, kind }, { id: el.dataset.ctrlIn, kind: 'ctrl-in' });
      else if (el.dataset.ctrlOut) link({ id: from, kind }, { id: el.dataset.ctrlOut, kind: 'ctrl-out' });
      else if (el.dataset.actIn) link({ id: from, kind }, { id: el.dataset.actIn, kind: 'act-in' });
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };

  const addBrick = (d: BlockDef) => {
    if (!menu) return;
    const owner = menu.owner === SCENE ? (props.defaultObject ?? types[0]?.name) : menu.owner;
    const b = ops.newBlock(d.id, owner);
    const g = groups.find((x) => x.owner === menu.owner);
    const last = g?.ctrls[g.ctrls.length - 1]?.ev.id;
    setMenu(null);
    change(menu.kind === 'sensor' ? 'Add sensor' : 'Add actuator', (s) => {
      // A new sensor gets its own controller (as in Blender); a new actuator joins the object's last controller.
      if (d.kind === 'condition' || !last) s.events.push(d.kind === 'condition' ? ops.newEvent([b]) : ops.newEvent([], [b]));
      else ops.addBlockTo(s, last, 'actions', b);
    });
    setOpen((o) => new Set(o).add(b.id));
  };

  const toggleOpen = (id: string) => setOpen((o) => { const n = new Set(o); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const reorderBlock = (b: BlockInstance, dir: number) => change('Move brick', (s) => {
    const f = ops.findBlock(s.events, b.id); if (!f) return;
    const l = f.ev[f.slot]; const j = f.index + dir; if (j < 0 || j >= l.length) return;
    [l[f.index], l[j]] = [l[j], l[f.index]];
  });
  const reorderEvent = (id: string, dir: number) => change('Move controller', (s) => {
    const f = ops.findNode(s.events, id); if (!f) return;
    const j = f.index + dir; if (j < 0 || j >= f.list.length) return;
    [f.list[f.index], f.list[j]] = [f.list[j], f.list[f.index]];
  });

  const fields = (b: BlockInstance) => {
    const def = BLOCK_DEFS[b.block];
    if (!def) return <div className="lb2-fields"><i>Unknown block "{b.block}" (kept unchanged)</i></div>;
    return (
      <div className="lb2-fields">
        {def.target === 'object' && (
          <label><span>Object</span>
            <select className="lx-input" value={b.target} onChange={(e) => change('Change object', (s) => ops.updateBlock(s, b.id, { target: e.target.value }))}>
              {!types.some((t) => t.name === b.target) && <option>{b.target}</option>}
              {types.map((t) => <option key={t.name}>{t.name}</option>)}
            </select>
          </label>
        )}
        {def.params.map((p) => (
          <label key={p.name} title={p.doc}><span>{p.label}</span>
            <ParamInput p={p} value={b.params[p.name] ?? p.default} env={env} target={b.target} siblings={b.params}
              onChange={(v) => change('Edit brick', (s) => ops.updateBlock(s, b.id, { params: { ...b.params, [p.name]: v } }))}
              onChangeMany={(patch) => change('Edit brick', (s) => ops.updateBlock(s, b.id, { params: { ...b.params, ...patch } }))} />
          </label>
        ))}
        <div className="lb2-doc">{def.doc}</div>
      </div>
    );
  };

  const brick = (b: BlockInstance, kind: 'sensor' | 'act') => {
    if (!flags.act && b.disabled) return null;
    const def = BLOCK_DEFS[b.block];
    const isOpen = open.has(b.id);
    return (
      <div key={b.id} className={'lb2-brick ' + kind + (b.disabled ? ' off' : '')}>
        {kind === 'act' && <span className="lb2-sock in" data-act-in={b.id} title="Drag to a controller's output to link" onPointerDown={(e) => startWire(e, b.id, 'act')} />}
        <div className="lb2-row">
          <button className="lb2-tw" onClick={() => toggleOpen(b.id)}>{isOpen ? '▾' : '▸'}</button>
          <span className="lb2-type">{kind === 'sensor' ? sensorType(b) : actuatorType(b)}</span>
          <input className="lb2-name" value={b.comment ?? (def ? def.name : b.block)} title={def?.doc} spellCheck={false}
            onChange={(e) => change('Rename brick', (s) => ops.updateBlock(s, b.id, { comment: e.target.value || undefined }))} />
          {kind === 'sensor' && def?.kind === 'condition' && !def.trigger
            ? <button className={'lb2-ic pin' + (b.invert ? ' on' : '')} title="Invert this sensor (NOT)" onClick={() => change('Invert', (s) => ops.updateBlock(s, b.id, { invert: !b.invert || undefined }))}><Glyph e="📌" i="pin" size={12} /></button>
            : <span className="lb2-ic pin dim"><Glyph e="📌" i="pin" size={12} /></span>}
          <span className="lb2-arrows"><button title="Move up" onClick={() => reorderBlock(b, -1)}>▲</button><button title="Move down" onClick={() => reorderBlock(b, 1)}>▼</button></span>
          <input type="checkbox" className="lb2-chk" checked={!b.disabled} title="Active" onChange={(e) => change('Toggle brick', (s) => ops.updateBlock(s, b.id, { disabled: !e.target.checked || undefined }))} />
          <button className="lb2-x" title="Delete" onClick={() => change('Delete brick', (s) => { const f = ops.findBlock(s.events, b.id); ops.removeBlock(s, b.id); dropEmpty(s, f?.ev.id); })}>✕</button>
        </div>
        {isOpen && fields(b)}
        {kind === 'sensor' && <span className="lb2-sock out" data-sensor-out={b.id} title="Drag to a controller's input to link" onPointerDown={(e) => startWire(e, b.id, 'sensor')} />}
      </div>
    );
  };

  const controller = (c: Ctrl) => {
    const ev = c.ev;
    if (!flags.act && ev.disabled) return null;
    const mode = ev.isElse ? 'Else' : ev.isOr ? 'Or' : 'And';
    const first = ev.conditions[0] && BLOCK_DEFS[ev.conditions[0].block];
    const name = ev.loose ? 'not running' : first ? (first.trigger ? first.name : 'check ' + first.name) : 'always';
    const isOpen = open.has(ev.id);
    return (
      <div key={ev.id} data-ev-id={ev.id} className={'lb2-brick ctrl' + (ev.disabled ? ' off' : '') + (trace?.has(ev.id) ? ' ran' : '')}>
        <span className="lb2-sock in" data-ctrl-in={ev.id} title="Sensors connect here" />
        <div className="lb2-row">
          <button className="lb2-tw" onClick={() => toggleOpen(ev.id)}>{isOpen ? '▾' : '▸'}</button>
          {c.depth > 0 && <span className="lb2-sub" title="Sub-controller: runs after its parent fires">↳</span>}
          <select className="lb2-mode" value={mode} title="And: all sensors true · Or: any sensor true · Else: when the controller above did not fire"
            onChange={(e) => change('Controller type', (s) => { const n = findEv(s, ev.id); if (!n) return; n.isOr = e.target.value === 'Or' || undefined; n.isElse = e.target.value === 'Else' || undefined; n.loose = undefined; })}>
            <option>And</option><option>Or</option><option>Else</option>
          </select>
          <span className="lb2-cname" title={name}>{name}</span>
          {flags.state && <span className="lb2-state">Sta 1</span>}
          <button className={'lb2-ic' + (ev.breakpoint ? ' on' : '')} title="Breakpoint (pause the game when this controller fires)" onClick={() => change('Breakpoint', (s) => { const n = findEv(s, ev.id); if (n) n.breakpoint = !ev.breakpoint || undefined; })}><Glyph e="🔖" i="bookmark" size={12} /></button>
          <span className="lb2-arrows"><button title="Move up" onClick={() => reorderEvent(ev.id, -1)}>▲</button><button title="Move down" onClick={() => reorderEvent(ev.id, 1)}>▼</button></span>
          <input type="checkbox" className="lb2-chk" checked={!ev.disabled && !ev.loose} title="Active"
            onChange={(e) => change('Toggle controller', (s) => { const n = findEv(s, ev.id); if (!n) return; n.disabled = !e.target.checked || undefined; if (e.target.checked) n.loose = undefined; })} />
          <button className="lb2-x" title="Delete controller and its bricks" onClick={() => change('Delete controller', (s) => { ops.removeNode(s, ev.id); })}>✕</button>
        </div>
        {isOpen && (
          <div className="lb2-fields">
            <div className="lb2-doc">{ev.conditions.length} sensor(s) → {ev.actions.length} actuator(s){ev.children.length ? ` · ${ev.children.length} sub-controller(s)` : ''}{ev.locals?.length ? ` · ${ev.locals.length} local variable(s) (edit in Event sheet)` : ''}</div>
            <button className="lb2-btn" onClick={() => change('Add sub-controller', (s) => ops.insertNode(s, ops.newEvent(), ev.id))}>Add sub-controller</button>
          </div>
        )}
        <span className="lb2-sock out" data-ctrl-out={ev.id} title="Drag to an actuator (or another controller) to link" onPointerDown={(e) => startWire(e, ev.id, 'ctrl')} />
      </div>
    );
  };

  const bar = (g: Group, kind: 'sensor' | 'controller' | 'actuator') => (
    <div className="lb2-bar">
      <button className={'lb2-obj' + (g.owner === curOwner ? ' on' : '')} onClick={() => setActive(g.owner)} title="Select this object">{g.owner}</button>
      {kind === 'controller'
        ? <button className="lb2-add" onClick={() => change('Add controller', (s) => { const e = ops.newEvent(); if (g.owner !== SCENE) e.loose = undefined; s.events.push(e); })}>Add Controller <span>⌄</span></button>
        : <button className="lb2-add" onClick={(e) => setMenu({ x: e.clientX, y: e.clientY + 8, kind, owner: g.owner })}>Add {kind === 'sensor' ? 'Sensor' : 'Actuator'} <span>⌄</span></button>}
    </div>
  );

  const head = (label: string, keys: (keyof typeof flags)[]) => (
    <div className="lb2-head">
      <select className="lb2-headsel" value={label} onChange={() => undefined}><option>{label}</option></select>
      {keys.map((k) => (
        <label key={k} title={{ sel: 'Only the selected object', act: 'Show inactive bricks', link: 'Show links', state: 'Show states' }[k]}>
          <input type="checkbox" checked={flags[k]} onChange={(e) => setFlags({ ...flags, [k]: e.target.checked })} />{{ sel: 'Sel', act: 'Act', link: 'Link', state: 'State' }[k]}
        </label>
      ))}
    </div>
  );

  const setVar = (i: number, patch: Partial<(typeof doc.globals)[number]>) => onChange(ops.edit(doc, (d) => { Object.assign(d.globals[i], patch); }), 'Edit property');

  return (
    <div className="lb2-root">
      <ExprHints env={env} />
      <div className="lb2-main">
        <div className="lb2-heads">{head('Sensors', ['sel', 'act', 'link', 'state'])}{head('Controllers', ['sel', 'act', 'link'])}{head('Actuators', ['sel', 'act', 'link', 'state'])}</div>
        <div className="lb2-box" ref={boxRef}>
          <svg className="lb2-wires">
            {paths.map((p, i) => <path key={i} d={p.d} className={p.cls} />)}
            {wire && <path className="temp" d={`M${wire.sx},${wire.sy} L${wire.x},${wire.y}`} />}
          </svg>
          {groups.map((g) => (
            <div key={g.owner} className="lb2-group">
              <div className="lb2-col">
                {bar(g, 'sensor')}
                {g.ctrls.flatMap((c) => c.ev.conditions.map((b) => brick(b, 'sensor')))}
                {g.ctrls.some((c) => !c.ev.conditions.length && !c.ev.loose) && <div className="lb2-brick sensor always-note"><div className="lb2-row"><span className="lb2-tw" /><span className="lb2-type">Always</span><span className="lb2-name ro">(controllers without sensors run every tick)</span></div></div>}
              </div>
              <div className="lb2-col">
                {bar(g, 'controller')}
                {g.ctrls.map(controller)}
              </div>
              <div className="lb2-col">
                {bar(g, 'actuator')}
                {g.ctrls.flatMap((c) => c.ev.actions.map((b) => brick(b, 'act')))}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className={'lb2-props' + (propsOpen ? '' : ' closed')}>
        <div className="lb2-props-head" onClick={() => setPropsOpen(!propsOpen)}><Glyph e={propsOpen ? '▼' : '▶'} i={propsOpen ? 'chevron-down' : 'chevron-right'} size={12} /> Properties</div>
        {propsOpen && (
          <>
            <button className="lb2-addprop" onClick={() => onChange(ops.edit(doc, (d) => { d.globals.push({ name: ops.uniqueName('prop', d.globals.map((g) => g.name)), type: 'number', value: 0 }); }), 'Add property')}>⊕ Add Game Property</button>
            {doc.globals.map((g, i) => (
              <div key={i} className="lb2-prop">
                <input className="lb2-pname" value={g.name} onChange={(e) => setVar(i, { name: e.target.value.replace(/[^A-Za-z0-9_]/g, '') || g.name })} />
                <select className="lb2-ptype" value={g.type} onChange={(e) => setVar(i, { type: e.target.value as VarType, value: e.target.value === 'number' ? 0 : e.target.value === 'boolean' ? false : e.target.value === 'string' ? '' : e.target.value === 'array' ? [] : {} })}>
                  {['number', 'string', 'boolean', 'array', 'dict'].map((t) => <option key={t} value={t}>{VAR_LABEL[t]}</option>)}
                </select>
                {g.type === 'boolean'
                  ? <input type="checkbox" className="lb2-chk" checked={!!g.value} onChange={(e) => setVar(i, { value: e.target.checked })} />
                  : <input className="lb2-pval" value={typeof g.value === 'object' ? JSON.stringify(g.value) : String(g.value)}
                      onChange={(e) => { const t = e.target.value; setVar(i, { value: g.type === 'number' ? (Number(t) || 0) : g.type === 'string' ? t : (() => { try { return JSON.parse(t); } catch { return g.value; } })() }); }} />}
                <button className="lb2-ic" title={g.comment || 'No description'}><Glyph e="ℹ" i="info" size={12} /></button>
                <span className="lb2-arrows">
                  <button onClick={() => i > 0 && onChange(ops.edit(doc, (d) => { [d.globals[i - 1], d.globals[i]] = [d.globals[i], d.globals[i - 1]]; }), 'Move property')}>▲</button>
                  <button onClick={() => i < doc.globals.length - 1 && onChange(ops.edit(doc, (d) => { [d.globals[i + 1], d.globals[i]] = [d.globals[i], d.globals[i + 1]]; }), 'Move property')}>▼</button>
                </span>
                <button className="lb2-x plain" title="Delete property" onClick={() => onChange(ops.edit(doc, (d) => { d.globals.splice(i, 1); }), 'Delete property')}>✕</button>
              </div>
            ))}
          </>
        )}
      </div>
      {menu && <BlockMenu x={menu.x} y={menu.y} app={app} title={menu.kind === 'sensor' ? `Add Sensor to ${menu.owner}` : `Add Actuator to ${menu.owner}`}
        filter={(d) => (menu.kind === 'sensor' ? d.kind === 'condition' : d.kind === 'action')} onPick={addBrick} onClose={() => setMenu(null)} />}
    </div>
  );
}
