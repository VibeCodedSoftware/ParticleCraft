// VFX graph editor: systems (Spawn → Initialize → Update → Output contexts with stacked blocks) on a pannable
// canvas, shape/object nodes, texture nodes, comment frames, a blackboard of exposed parameters wired to block
// properties, an inspector and the live preview.
import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '@shared/ui/icons';
import { newId } from '@shared/src/schema';
import { BLOCK_CATEGORIES, CONTEXTS, VFX_BLOCK, VFX_BLOCKS, VFX_PRESETS, compileGraph, newBlock, newSystem, type BlockType, type ContextId, type PropDef, type VfxBlock, type VfxComment, type VfxGraph, type VfxParam, type VfxSystem } from '@shared/src/vfx/vfx';
import type { Curve } from '@shared/src/runtime/particles';
import { SHAPE_KINDS, newShape, type ShapeKind, type VfxShape } from '@shared/src/vfx/shapes';
import { particlePictureData } from '@shared/src/vfx/particlePicture';
import { addBlenderObject, resetBlenderSystem } from '@shared/src/vfx/blender';
import { importObjectFiles } from './importObject';
import { api, pc, usePC } from './store';
import { Preview } from './Preview';
import { ColorsInput, CurveEditor, GradientEditor, PointsInput } from './widgets';
import { TexturePicker } from './TextureLibrary';
import { sampleImagePoints } from './imageSample';
import { useTexLib } from './textureLib';
import { TexNodesLayer, TexNodeInspector, TEX_NODE_W, connectNodeToSystem, texLink, texNodeHeight, useTexNodeOutputs } from './TexGraph';
import { TEX_NODE_TYPES, TEX_RECIPES } from './texNodes';
import { FlipbookTiming } from './FlipbookPanel';
import { MaterialLibrary, MaterialPreview } from './MaterialPreview';
import { Timeline } from './Timeline';
import { extractFragment, insertFragment, type VfxFragment } from '@shared/src/vfx/compose';

const SW = 270, CH = 26, BH = 30, ADD = 24, GAP = 16, HEAD = 34;

const sysHeight = (s: VfxSystem) => (s.collapsed ? HEAD + 8 : HEAD + CONTEXTS.reduce((a, c) => a + CH + s.contexts[c.id].length * BH + ADD + GAP, 0));
/** Y of a block row (relative to the system) for wires. */
function blockY(s: VfxSystem, blockId: string) {
  if (s.collapsed) return HEAD / 2;
  let y = HEAD;
  for (const c of CONTEXTS) {
    y += CH;
    const i = s.contexts[c.id].findIndex((b) => b.id === blockId);
    if (i >= 0) return y + i * BH + BH / 2;
    y += s.contexts[c.id].length * BH + ADD + GAP;
  }
  return HEAD;
}

const fmt = (v: any) => Array.isArray(v) ? (v.length > 3 ? `${v.length} items` : v.map((x) => (typeof x === 'number' ? Math.round(x * 100) / 100 : typeof x === 'object' ? '·' : x)).join(', ')) : typeof v === 'number' ? String(Math.round(v * 100) / 100) : typeof v === 'boolean' ? (v ? 'on' : 'off') : v && typeof v === 'object' ? 'curve' : String(v ?? '');
function summary(b: VfxBlock) {
  const t = VFX_BLOCK[b.type];
  return (t?.props ?? []).filter((p) => p.type !== 'color' && p.type !== 'text' && p.type !== 'texture' && p.type !== 'system' && p.label).slice(0, 2).map((p) => fmt(b.props[p.key])).filter(Boolean).join(' · ');
}
const catColor = (t?: BlockType) => BLOCK_CATEGORIES.find((c) => c.id === t?.category)?.color ?? '#888';

type Sel = { kind: 'block'; sys: string; block: string } | { kind: 'system'; sys: string } | { kind: 'param'; id: string } | { kind: 'shape'; id: string } | { kind: 'comment'; id: string } | { kind: 'tex'; id: string } | null;
const SHW = 210, SHH = 88;

/** What property editors need from the graph. */
interface EdCtx { systems: VfxSystem[]; texNodes: { id: string; name: string }[]; curves: { name: string; curve: Curve }[]; saveCurve: (name: string, c: Curve) => void }
const EditorContext = createContext<EdCtx>({ systems: [], texNodes: [], curves: [], saveCurve: () => undefined });
const CURVES_DOC = '_curves';
const GROUPS_DOC = '_groups';

export function VfxEditor() {
  const doc = usePC((s) => s.doc)!;
  const rev = usePC((s) => s.rev);
  const g = doc.graph!;
  useTexLib(); // recompile when the library changes (pictures resolve)
  const texOut = useTexNodeOutputs(g);
  const [view, setView] = useState({ x: 220, y: 30, z: 0.85 });
  const [sel, setSelState] = useState<Sel>(null);
  const setSel = (s: Sel) => { setSelState(s); pc.set({ selSys: s && (s.kind === 'system' || s.kind === 'block') ? s.sys : pc.get().selSys }); };
  const [menu, setMenu] = useState<{ sys: string; ctx: ContextId; x: number; y: number } | null>(null);
  const [comps, setComps] = useState<{ name: string; system: VfxSystem; version?: number }[]>([]);
  const [curves, setCurves] = useState<{ name: string; curve: Curve }[]>([]);
  const [showTimeline, setShowTimeline] = useState(true);
  const area = useRef<HTMLDivElement>(null);
  const drag = useRef<{ kind: 'pan' | 'sys' | 'shape' | 'comment' | 'resize' | 'tex'; id?: string; x: number; y: number; vx: number; vy: number; members?: { id: string; kind: 'sys' | 'shape' | 'tex'; x: number; y: number }[] } | null>(null);
  const [live, setLive] = useState<{ id: string; x: number; y: number; w?: number; h?: number; dx?: number; dy?: number } | null>(null);
  const [effects, setEffects] = useState<{ id: string; name: string }[]>([]);
  const [groups, setGroups] = useState<{ name: string; version: number; fragment: VfxFragment; doc?: string }[]>([]);
  useEffect(() => { api.getDoc<{ items: typeof groups }>(GROUPS_DOC, { items: [] }).then((d) => setGroups(d.items ?? [])); }, []);
  const saveGroup = async (c: VfxComment) => {
    const sysIds = g.systems.filter((s) => inFrame(c, s)).map((s) => s.id), texIds = texNodes.filter((t) => inFrame(c, t)).map((t) => t.id), shIds = (g.shapes ?? []).filter((s) => inFrame(c, s)).map((s) => s.id);
    if (!sysIds.length && !texIds.length) { pc.set({ status: 'Put some systems or texture nodes inside the frame first' }); return; }
    const name = window.prompt('Save this group as', c.text || 'Group'); if (!name) return;
    const frag = extractFragment(g, sysIds, texIds, shIds);
    // Positions are stored relative to the frame.
    for (const n of [...frag.systems, ...(frag.texNodes ?? []), ...(frag.shapes ?? [])]) { n.x -= c.x; n.y -= c.y; }
    const prev = groups.find((x) => x.name === name);
    const next = [...groups.filter((x) => x.name !== name), { name, version: (prev?.version ?? 0) + 1, fragment: frag, doc: `${frag.systems.length} system(s), ${frag.texNodes?.length ?? 0} texture node(s), ${frag.params?.length ?? 0} exposed parameter(s)` }];
    setGroups(next); await api.putDoc(GROUPS_DOC, { id: GROUPS_DOC, name: 'Node groups', items: next });
    pc.set({ status: `Saved node group "${name}" — insert it in any effect from "+ Insert…"` });
  };
  const insertGroup = (grp: { name: string; fragment: VfxFragment }) => {
    const r = area.current!.getBoundingClientRect();
    const x0 = Math.round((r.width / 2 - view.x) / view.z - 200), y0 = Math.round((r.height / 3 - view.y) / view.z);
    set((gg) => {
      insertFragment(gg, grp.fragment, x0, y0);
      const xs = grp.fragment.systems.map((s) => s.x).concat((grp.fragment.texNodes ?? []).map((t) => t.x)), ys = grp.fragment.systems.map((s) => s.y + sysHeight(s)).concat((grp.fragment.texNodes ?? []).map((t) => t.y + texNodeHeight(t)));
      (gg.comments ??= []).push({ id: newId('vc'), x: x0 - 20, y: y0 - 40, w: Math.max(...xs, 0) + SW + 40, h: Math.max(...ys, 100) + 60, text: grp.name, color: '#22c55e' });
    });
    pc.set({ status: `Inserted "${grp.name}"` });
  };
  useEffect(() => { api.components().then(setComps); api.getDoc<{ items: { name: string; curve: Curve }[] }>(CURVES_DOC, { items: [] }).then((d) => setCurves(d.items ?? [])); }, []);
  const saveCurve = (name: string, curve: Curve) => { const next = [...curves.filter((c) => c.name !== name), { name, curve }]; setCurves(next); api.putDoc(CURVES_DOC, { id: CURVES_DOC, name: 'Curves', items: next }).then(() => pc.set({ status: `Saved curve "${name}"` })); };
  const comments = g.comments ?? [];
  const texNodes = g.texNodes ?? [];
  /** Nodes inside collapsed frames are hidden (they still play). */
  const inFrame = (c: VfxComment, n: { x: number; y: number }) => n.x >= c.x && n.y >= c.y && n.x <= c.x + c.w && n.y <= c.y + c.h;
  const membersOf = (c: VfxComment) => [...g.systems.filter((s) => inFrame(c, s)).map((s) => s.id), ...(g.shapes ?? []).filter((s) => inFrame(c, s)).map((s) => s.id), ...texNodes.filter((t) => inFrame(c, t)).map((t) => t.id)];
  const hidden = new Set<string>();
  for (const c of comments) if (c.collapsed) for (const id of membersOf(c)) hidden.add(id);
  /** Frame every node in view. */
  const fit = () => {
    const el = area.current; if (!el) return;
    const xs = g.systems.map((s) => s.x), ys = g.systems.map((s) => s.y), sh = g.shapes ?? [], tn = g.texNodes ?? [], cm = g.comments ?? [];
    const minX = Math.min(Math.min(0, ...xs) - (g.params.length ? 340 : 20), ...sh.map((s) => s.x - 20), ...tn.map((t) => t.x - 20), ...cm.map((c) => c.x - 10)), maxX = Math.max(SW, ...xs.map((x) => x + SW), ...cm.map((c) => c.x + c.w)) + 20;
    const minY = Math.min(0, ...ys, ...sh.map((s) => s.y), ...tn.map((t) => t.y), ...cm.map((c) => c.y)) - 10, maxY = Math.max(400, ...g.systems.map((s) => s.y + sysHeight(s)), ...sh.map((s) => s.y + 100), ...tn.map((t) => t.y + texNodeHeight(t)), ...cm.map((c) => c.y + c.h)) + 10;
    const r = el.getBoundingClientRect();
    const z = Math.max(0.2, Math.min(1, Math.min((r.width - 20) / (maxX - minX), (r.height - 60) / (maxY - minY))));
    setView({ z, x: 10 - minX * z, y: 50 - minY * z });
  };
  useEffect(() => { requestAnimationFrame(fit); }, [doc.id]);

  const compiled = useMemo(() => compileGraph(g), [rev, texOut.rev]);
  const set = (fn: (gg: VfxGraph) => void) => pc.mutate((d) => fn(d.graph!));
  const sysById = (gg: VfxGraph, id: string) => gg.systems.find((s) => s.id === id)!;
  const pos = (s: { id: string; x: number; y: number }) => {
    if (live?.id === s.id && live.dx == null) return live;
    if (live?.dx != null && drag.current?.members?.some((m) => m.id === s.id)) return { ...s, x: s.x + live.dx, y: s.y + live.dy! };
    return s;
  };

  const onMove = (e: React.PointerEvent) => {
    const d = drag.current; if (!d) return;
    const dx = (e.clientX - d.x) / view.z, dy = (e.clientY - d.y) / view.z;
    if (d.kind === 'pan') setView((v) => ({ ...v, x: d.vx + e.clientX - d.x, y: d.vy + e.clientY - d.y }));
    else if (d.kind === 'resize') setLive({ id: d.id!, x: 0, y: 0, w: Math.max(120, d.vx + dx), h: Math.max(60, d.vy + dy) });
    else if (d.kind === 'comment') setLive({ id: d.id!, x: d.vx + dx, y: d.vy + dy, dx, dy });
    else setLive({ id: d.id!, x: d.vx + dx, y: d.vy + dy });
  };
  const onUp = () => {
    const d = drag.current; drag.current = null;
    const l = live; setLive(null);
    if (!d || !l) return;
    const snap = (v: number) => Math.round(v / 10) * 10;
    if (d.kind === 'sys') set((gg) => { const s = sysById(gg, l.id); s.x = snap(l.x); s.y = snap(l.y); });
    if (d.kind === 'shape') set((gg) => { const s = gg.shapes?.find((x) => x.id === l.id); if (s) { s.x = snap(l.x); s.y = snap(l.y); } });
    if (d.kind === 'tex') set((gg) => { const s = gg.texNodes?.find((x) => x.id === l.id); if (s) { s.x = snap(l.x); s.y = snap(l.y); } });
    if (d.kind === 'resize') set((gg) => { const c = gg.comments?.find((x) => x.id === l.id); if (c) { c.w = snap(l.w!); c.h = snap(l.h!); } });
    if (d.kind === 'comment') set((gg) => {
      const c = gg.comments?.find((x) => x.id === l.id); if (!c) return;
      c.x = snap(l.x); c.y = snap(l.y);
      // Nodes inside the frame move with it.
      for (const m of d.members ?? []) {
        const list: { id: string; x: number; y: number }[] = m.kind === 'sys' ? gg.systems : m.kind === 'shape' ? gg.shapes ?? [] : gg.texNodes ?? [];
        const n = list.find((x) => x.id === m.id); if (n) { n.x = snap(m.x + l.dx!); n.y = snap(m.y + l.dy!); }
      }
    });
  };

  const addSystem = (from?: VfxSystem, comp?: { name: string; version?: number }) => {
    const maxX = Math.max(-SW, ...g.systems.map((s) => s.x));
    let made: VfxSystem | undefined;
    set((gg) => {
      const s: VfxSystem = from ? { ...JSON.parse(JSON.stringify(from)), id: newId('vs') } : newSystem('System ' + (gg.systems.length + 1));
      for (const c of CONTEXTS) s.contexts[c.id] = s.contexts[c.id].map((b) => ({ ...b, id: newId('vb') }));
      if (comp) s.component = { name: comp.name, version: comp.version ?? 1 };
      if (from && !comp) s.name = from.name + ' copy';
      s.x = maxX + SW + 60; s.y = 0;
      gg.systems.push(s); made = s;
    });
    if (made) setSel({ kind: 'system', sys: made.id });
  };

  const shapes = g.shapes ?? [];
  const selShape = sel?.kind === 'shape' ? shapes.find((s) => s.id === sel.id) : undefined;
  const addShape = (kind: ShapeKind) => {
    const minX = Math.min(g.params.length ? -360 : 0, ...g.systems.map((s) => s.x));
    const sh = newShape(kind, newId('vsh'), minX - SHW - 50, shapes.length * (SHH + 20));
    set((gg) => { (gg.shapes ??= []).push(sh); });
    setSel({ kind: 'shape', id: sh.id });
    return sh;
  };
  /** A new system born on a shape (fire, electricity, smoke, liquid…), placed next to it. */
  const emitFrom = (sh: VfxShape) => {
    const maxX = Math.max(-SW, ...g.systems.map((s) => s.x));
    set((gg) => {
      const s = newSystem(`${sh.name} particles`, maxX + SW + 60, 0, { init: [newBlock('lifetime', { min: 0.6, max: 1 }), newBlock('shapeEmit'), newBlock('size', { size: 0.12, random: 0.03 }), newBlock('color')], update: [newBlock('cling', { strength: 0.4 })] });
      s.source = sh.id;
      gg.systems.push(s);
    });
  };
  const addComment = () => {
    const r = area.current!.getBoundingClientRect();
    const c: VfxComment = { id: newId('vc'), x: Math.round((r.width / 2 - view.x) / view.z - 160), y: Math.round((80 - view.y) / view.z), w: 320, h: 200, text: 'Comment', color: '#3b82f6' };
    set((gg) => { (gg.comments ??= []).push(c); });
    setSel({ kind: 'comment', id: c.id });
  };
  const sysOfShape = (id: string) => g.systems.filter((s) => s.source === id);
  // Preview: shown originals solid; a selected hidden one as a faint outline so you can place it.
  const previewShapes = shapes.filter((s) => !s.hideOriginal || s.id === selShape?.id).map((s) => ({ shape: s, ghost: s.hideOriginal }));
  const selSys = sel && (sel.kind === 'system' || sel.kind === 'block') ? g.systems.find((s) => s.id === sel.sys) : undefined;
  const selBlock = sel?.kind === 'block' && selSys ? CONTEXTS.flatMap((c) => selSys.contexts[c.id]).find((b) => b.id === sel.block) : undefined;
  const selParam = sel?.kind === 'param' ? g.params.find((p) => p.id === sel.id) : undefined;
  const selComment = sel?.kind === 'comment' ? comments.find((c) => c.id === sel.id) : undefined;
  const selTex = sel?.kind === 'tex' ? texNodes.find((t) => t.id === sel.id) : undefined;
  const boundTo = (sysId: string, blockId: string, prop: string) => g.params.find((p) => p.bindings.some((b) => b.system === sysId && b.block === blockId && b.prop === prop));
  const ctxValue: EdCtx = { systems: g.systems, texNodes: texNodes.filter((t) => t.type !== 'material').map((t) => ({ id: t.id, name: t.name ?? t.type })), curves, saveCurve };

  // Keyboard: Delete removes the selection, Ctrl+D duplicates.
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.('input,textarea,select')) return;
      if (e.key === 'Delete' && sel?.kind === 'comment') { set((gg) => { gg.comments = gg.comments?.filter((c) => c.id !== sel.id); }); setSel(null); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd' && sel?.kind === 'system' && selSys) { e.preventDefault(); addSystem(selSys); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd' && sel?.kind === 'block' && selSys && selBlock) { e.preventDefault(); duplicateBlock(selSys.id, selBlock.id); }
    };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  });
  const duplicateBlock = (sysId: string, blockId: string) => set((gg) => { const s = sysById(gg, sysId); for (const c of CONTEXTS) { const l = s.contexts[c.id]; const i = l.findIndex((b) => b.id === blockId); if (i >= 0) l.splice(i + 1, 0, { ...JSON.parse(JSON.stringify(l[i])), id: newId('vb') }); } });

  return (
    <EditorContext.Provider value={ctxValue}>
    <div className="vx">
      <div className="vx-canvas" ref={area}
        onPointerDown={(e) => { if (e.target === area.current || (e.target as HTMLElement).classList.contains('vx-world')) { setSel(null); drag.current = { kind: 'pan', x: e.clientX, y: e.clientY, vx: view.x, vy: view.y }; } }}
        onPointerMove={onMove} onPointerUp={onUp}
        onDragOver={(e) => { if (e.dataTransfer.types.includes('text/x-craft-texture')) e.preventDefault(); }}
        onDrop={(e) => {
          const id = e.dataTransfer.getData('text/x-craft-texture'); if (!id) return;
          e.preventDefault();
          const r = area.current!.getBoundingClientRect();
          set((gg) => { (gg.texNodes ??= []).push({ id: newId('vt'), type: 'textureInput', x: Math.round((e.clientX - r.left - view.x) / view.z), y: Math.round((e.clientY - r.top - view.y) / view.z), props: { texture: 'asset:' + id }, inputs: {}, name: 'Texture' }); });
        }}
        onWheel={(e) => { const r = area.current!.getBoundingClientRect(); const mx = e.clientX - r.left, my = e.clientY - r.top; const z = Math.min(1.6, Math.max(0.2, view.z * (e.deltaY < 0 ? 1.1 : 0.9))); setView({ z, x: mx - ((mx - view.x) / view.z) * z, y: my - ((my - view.y) / view.z) * z }); }}>
        <div className="vx-world" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.z})` }}>
          {comments.map((c) => {
            const p = pos(c), sz0 = live?.id === c.id && live.w ? { w: live.w, h: live.h! } : c, sz = c.collapsed ? { w: sz0.w, h: 30 } : sz0;
            return (
              <div key={c.id} className={'vx-comment' + (sel?.kind === 'comment' && sel.id === c.id ? ' sel' : '')} style={{ left: p.x, top: p.y, width: sz.w, height: sz.h, ['--cc' as any]: c.color }}>
                <div className="vx-comment-head" onPointerDown={(e) => {
                  e.stopPropagation(); setSel({ kind: 'comment', id: c.id });
                  const inside = (n: { x: number; y: number }) => n.x >= c.x && n.y >= c.y && n.x <= c.x + c.w && n.y <= c.y + c.h;
                  const members = [...g.systems.filter(inside).map((s) => ({ id: s.id, kind: 'sys' as const, x: s.x, y: s.y })), ...shapes.filter(inside).map((s) => ({ id: s.id, kind: 'shape' as const, x: s.x, y: s.y })), ...texNodes.filter(inside).map((s) => ({ id: s.id, kind: 'tex' as const, x: s.x, y: s.y }))];
                  drag.current = { kind: 'comment', id: c.id, x: e.clientX, y: e.clientY, vx: c.x, vy: c.y, members };
                }}>
                  <button className="vx-collapse" onPointerDown={(e) => e.stopPropagation()} onClick={() => set((gg) => { const x = gg.comments!.find((k) => k.id === c.id)!; x.collapsed = !x.collapsed; })} title={c.collapsed ? 'Expand the group' : 'Collapse the group (its nodes keep playing)'}><Icon name={c.collapsed ? 'chevron-right' : 'chevron-down'} size={12} /></button>
                  {c.text}{c.collapsed ? ` (${membersOf(c).length} nodes)` : ''}
                </div>
                {!c.collapsed && <span className="vx-comment-resize" onPointerDown={(e) => { e.stopPropagation(); setSel({ kind: 'comment', id: c.id }); drag.current = { kind: 'resize', id: c.id, x: e.clientX, y: e.clientY, vx: c.w, vy: c.h }; }} />}
              </div>
            );
          })}
          <svg className="vx-wires" width="1" height="1">
            {g.params.flatMap((p, pi) => p.bindings.map((b, bi) => {
              const s = g.systems.find((x) => x.id === b.system); if (!s || hidden.has(s.id)) return null;
              const sp = pos(s);
              const a = { x: -150, y: 30 + pi * 64 + 20 }, q = { x: sp.x, y: sp.y + blockY(s, b.block) };
              const dx = Math.max(60, (q.x - a.x) / 2);
              return <path key={p.id + bi} className={'vx-wire ' + p.type} d={`M${a.x},${a.y} C${a.x + dx},${a.y} ${q.x - dx},${q.y} ${q.x},${q.y}`} />;
            }))}
            {g.systems.map((s) => {
              const sh = s.source ? shapes.find((x) => x.id === s.source) : undefined; if (!sh || hidden.has(sh.id) || hidden.has(s.id)) return null;
              const spp = pos(sh), p = pos(s);
              const a = { x: spp.x + SHW, y: spp.y + SHH / 2 }, q = { x: p.x, y: p.y + HEAD / 2 };
              const dx = Math.max(60, Math.abs(q.x - a.x) / 2);
              return <path key={'sh' + s.id} className="vx-wire shape" d={`M${a.x},${a.y} C${a.x + dx},${a.y} ${q.x - dx},${q.y} ${q.x},${q.y}`} />;
            })}
            {/* Texture node → block wires (a block's texture property set to node:<id>). */}
            {g.systems.flatMap((s) => CONTEXTS.flatMap((c) => s.contexts[c.id].flatMap((b) => Object.entries(b.props).filter(([, v]) => typeof v === 'string' && v.startsWith('node:')).map(([k, v]) => {
              const t = texNodes.find((x) => x.id === (v as string).slice(5)); if (!t || hidden.has(t.id) || hidden.has(s.id)) return null;
              const tp = pos(t), sp = pos(s);
              const a = { x: tp.x + TEX_NODE_W, y: tp.y + 16 }, q = { x: sp.x, y: sp.y + blockY(s, b.id) };
              const dx = Math.max(60, Math.abs(q.x - a.x) / 2);
              return <path key={'t' + b.id + k} className="vx-wire texture" d={`M${a.x},${a.y} C${a.x + dx},${a.y} ${q.x - dx},${q.y} ${q.x},${q.y}`} />;
            }))))}
            {/* Sub-emitter event wires between systems. */}
            {g.systems.flatMap((s) => s.contexts.update.filter((b) => b.type === 'subEmitter' && b.props.target).map((b) => {
              const t = g.systems.find((x) => x.id === b.props.target); if (!t || hidden.has(t.id) || hidden.has(s.id)) return null;
              const sp = pos(s), tp = pos(t);
              const a = { x: sp.x + SW, y: sp.y + blockY(s, b.id) }, q = { x: tp.x + SW / 2, y: tp.y };
              return <path key={'ev' + b.id} className="vx-wire event" d={`M${a.x},${a.y} C${a.x + 80},${a.y} ${q.x},${q.y - 80} ${q.x},${q.y}`} />;
            }))}
          </svg>
          <TexNodesLayer graph={g} hidden={hidden} sel={sel?.kind === 'tex' ? sel.id : null} pos={pos} outputs={texOut}
            onSelect={(id) => setSel({ kind: 'tex', id })}
            onDragStart={(id, e) => { const t = texNodes.find((x) => x.id === id)!; drag.current = { kind: 'tex', id, x: e.clientX, y: e.clientY, vx: t.x, vy: t.y }; }}
            onChange={(fn) => set(fn)} />
          {shapes.filter((sh) => !hidden.has(sh.id)).map((sh) => {
            const p = pos(sh);
            const n = sysOfShape(sh.id).length;
            return (
              <div key={sh.id} className={'vx-shape' + (sh.kind === 'mesh' ? ' obj' : '') + (sel?.kind === 'shape' && sel.id === sh.id ? ' sel' : '')} style={{ left: p.x, top: p.y, width: SHW, height: SHH }}
                onPointerDown={(e) => { e.stopPropagation(); setSel({ kind: 'shape', id: sh.id }); drag.current = { kind: 'shape', id: sh.id, x: e.clientX, y: e.clientY, vx: sh.x, vy: sh.y }; }}>
                <div className="vx-shape-head"><span className="vx-shape-ic">{sh.kind === 'mesh' ? '◆' : '▣'}</span>{sh.name}<span className="vx-shape-port" /></div>
                <div className="vx-shape-body">
                  <span>{sh.kind === 'mesh' ? `Object node · ${Math.floor((sh.mesh?.tris.length ?? 0) / 9)} triangles` : `Shape node · ${SHAPE_KINDS.find((k) => k.kind === sh.kind)?.name}`}</span>
                  <span>{n ? `→ ${n} system${n > 1 ? 's' : ''}` : 'not connected'}</span>
                  <label onPointerDown={(e) => e.stopPropagation()} title="Hide the shape itself so only the particles show"><input type="checkbox" checked={sh.hideOriginal} onChange={(e) => set((gg) => { gg.shapes!.find((x) => x.id === sh.id)!.hideOriginal = e.target.checked; })} /> Hide original shape</label>
                </div>
              </div>
            );
          })}
          {g.params.map((p, pi) => (
            <div key={p.id} className={'vx-param ' + p.type + (sel?.kind === 'param' && sel.id === p.id ? ' sel' : '')} style={{ left: -330, top: 30 + pi * 64 }} onPointerDown={(e) => { e.stopPropagation(); setSel({ kind: 'param', id: p.id }); }}>
              <b>{p.name}</b><span>{p.type} · {fmt(p.value)}</span><i>{p.bindings.length} link(s)</i>
            </div>
          ))}
          {g.systems.filter((s) => !hidden.has(s.id)).map((s) => {
            const p = pos(s);
            const errs = compiled.warnings.filter((w) => w.startsWith(s.name + ':'));
            const layer = compiled.layers.findIndex((l) => l.name === s.name);
            const lp = layer >= 0 ? compiled.layers[layer].params : undefined;
            return (
              <div key={s.id} className={'vx-sys' + (s.enabled ? '' : ' off') + (s.collapsed ? ' collapsed' : '') + (sel && (sel.kind === 'system' || sel.kind === 'block') && sel.sys === s.id ? ' sel' : '') + (s.origin ? ' blender' : '')} style={{ left: p.x, top: p.y, width: SW, height: sysHeight(s), ['--sc' as any]: s.color ?? '#5b8def' }}>
                <div className="vx-sys-head" onPointerDown={(e) => { e.stopPropagation(); const lk = texLink.get(); if (lk) { set((gg) => connectNodeToSystem(gg, lk.from, s.id)); texLink.set(null); pc.set({ status: `Connected the texture node to "${s.name}"` }); return; } setSel({ kind: 'system', sys: s.id }); drag.current = { kind: 'sys', id: s.id, x: e.clientX, y: e.clientY, vx: s.x, vy: s.y }; }}>
                  <button className="vx-collapse" title={s.collapsed ? 'Expand' : 'Collapse'} onPointerDown={(e) => e.stopPropagation()} onClick={() => set((gg) => { sysById(gg, s.id).collapsed = !s.collapsed; })}><Icon name={s.collapsed ? 'chevron-right' : 'chevron-down'} size={12} /></button>
                  <span className="vx-dot" />{s.name}
                  {s.label && <span className="vx-label">{s.label}</span>}
                  {lp && (lp.style || lp.renderer) && <span className="vx-style" title="Render style / renderer">{[lp.style, lp.renderer].filter(Boolean).join(' · ')}</span>}
                  {s.component && <span className="vx-label" title={`From component "${s.component.name}" v${s.component.version}`}>⧉</span>}
                  {errs.length > 0 && <span className="vx-warn" title={errs.join('\n')}><Icon name="alert-triangle" size={12} /></span>}
                  <label onPointerDown={(e) => e.stopPropagation()} title="Enable system"><input type="checkbox" checked={s.enabled} onChange={(e) => set((gg) => { sysById(gg, s.id).enabled = e.target.checked; })} /></label>
                </div>
                {!s.collapsed && CONTEXTS.map((c, ci) => (
                  <div key={c.id} className="vx-ctx" style={{ ['--c' as any]: c.color }}>
                    <div className="vx-ctx-head" title={c.doc}>{c.name}</div>
                    {s.contexts[c.id].map((b) => {
                      const t = VFX_BLOCK[b.type];
                      const isSel = sel?.kind === 'block' && sel.block === b.id;
                      const color = t?.props.find((pp) => pp.type === 'color');
                      return (
                        <div key={b.id} className={'vx-block' + (b.enabled ? '' : ' off') + (isSel ? ' sel' : '')} style={{ ['--bc' as any]: catColor(t) }} title={b.comment ? `${t?.name}: ${b.comment}` : t?.doc} onPointerDown={(e) => { e.stopPropagation(); setSel({ kind: 'block', sys: s.id, block: b.id }); }}>
                          <input type="checkbox" checked={b.enabled} onPointerDown={(e) => e.stopPropagation()} onChange={(e) => set((gg) => { const x = sysById(gg, s.id).contexts[c.id].find((k) => k.id === b.id)!; x.enabled = e.target.checked; })} />
                          <span className="vx-bname">{t?.name ?? b.type}</span>
                          {b.comment && <span className="vx-note" />}
                          {color && <span className="vx-swatch" style={{ background: b.props[color.key] }} />}
                          <span className="vx-bsum">{summary(b)}</span>
                          {g.params.some((pp) => pp.bindings.some((x) => x.block === b.id)) && <span className="vx-port" />}
                        </div>
                      );
                    })}
                    <button className="vx-add" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => setMenu({ sys: s.id, ctx: c.id, x: e.clientX, y: e.clientY })}>+ node</button>
                    {ci < 3 && <div className="vx-flow">▼</div>}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
        <div className="vx-tools">
          <button onClick={() => addSystem()}>+ System</button>
          <label className="vx-import" title="A 3D model (.blend, .glb, .gltf, .fbx, .obj) as an Object node to emit from; Blender particle systems in a .blend (or a .craftfx.json from the Craft Export add-on) become Blender Particle Effect nodes">Import object…<input type="file" multiple hidden accept=".blend,.glb,.gltf,.fbx,.obj,.json" onChange={async (e) => {
            const files = [...(e.target.files ?? [])]; e.target.value = '';
            if (!files.length) return;
            try {
              pc.set({ status: 'Importing…' });
              const r = await importObjectFiles(files);
              let made = 0, psys = 0;
              set((gg) => { for (const o of r.objects) { const x = addBlenderObject(gg, r.file, o); made++; psys += x.systems.length; } });
              pc.set({ status: `Imported ${made} object(s)${psys ? ` with ${psys} Blender particle system(s)` : ''} from ${r.file}` });
              if (r.notes.length) window.alert(r.notes.join('\n'));
              requestAnimationFrame(fit);
            } catch (err: any) { window.alert('Could not import: ' + (err?.message ?? err)); pc.set({ status: '' }); }
          }} /></label>
          <select value="" title="A 3D shape that particles are born on and cling to" onChange={(e) => { if (e.target.value) addShape(e.target.value as ShapeKind); }}><option value="">+ Shape…</option>{SHAPE_KINDS.map((k) => <option key={k.kind} value={k.kind}>{k.name}</option>)}</select>
          <TexNodeAddMenu onRecipe={(rname) => {
            const rc = TEX_RECIPES.find((x) => x.name === rname); if (!rc) return;
            const r = area.current!.getBoundingClientRect(); const x0 = Math.round((r.width / 2 - view.x) / view.z - 400), y0 = Math.round((r.height / 2 - view.y) / view.z - 80);
            const ids = rc.steps.map(() => newId('vt'));
            set((gg) => { rc.steps.forEach((st, i) => { (gg.texNodes ??= []).push({ id: ids[i], type: st.type, name: st.name, x: x0 + i * (TEX_NODE_W + 40), y: y0 + (st.inputs ? 0 : (i % 2) * 40), props: { ...(st.props ?? {}) }, inputs: Object.fromEntries(Object.entries(st.inputs ?? {}).map(([k, j]) => [k, ids[j]])) }); }); });
            setSel({ kind: 'tex', id: ids[ids.length - 1] }); pc.set({ status: `Added the "${rc.name}" recipe: ${rc.doc}` });
          }} onAdd={(type, name) => { const r = area.current!.getBoundingClientRect(); const id = newId('vt'); set((gg) => { (gg.texNodes ??= []).push({ id, type, name, x: Math.round((r.width / 2 - view.x) / view.z - 100), y: Math.round((r.height / 2 - view.y) / view.z - 60), props: {}, inputs: {} }); }); setSel({ kind: 'tex', id }); }} />
          {<select value="" title="Insert a saved component, node group, one of your effects or a preset into this effect" onFocus={() => api.list().then((l) => setEffects(l.filter((x) => x.id !== doc.id)))} onChange={async (e) => {
            const v = e.target.value;
            if (v.startsWith('c:')) { const c = comps[Number(v.slice(2))]; if (c) addSystem(c.system, c); }
            else if (v.startsWith('g:')) { const gr = groups[Number(v.slice(2))]; if (gr) insertGroup(gr); }
            else if (v.startsWith('e:') || v.startsWith('p:')) {
              const src = v.startsWith('e:') ? (await api.load(v.slice(2))).graph : VFX_PRESETS.find((p) => p.id === v.slice(2))?.build();
              const name = v.startsWith('e:') ? effects.find((x) => x.id === v.slice(2))?.name ?? 'Effect' : VFX_PRESETS.find((p) => p.id === v.slice(2))!.name;
              if (!src) return;
              const frag = extractFragment(src, src.systems.map((s) => s.id), (src.texNodes ?? []).map((t) => t.id), (src.shapes ?? []).map((s) => s.id));
              const mx = Math.min(...frag.systems.map((s) => s.x), ...(frag.texNodes ?? []).map((t) => t.x), 0), my = Math.min(...frag.systems.map((s) => s.y), ...(frag.texNodes ?? []).map((t) => t.y), 0);
              for (const n of [...frag.systems, ...(frag.texNodes ?? []), ...(frag.shapes ?? [])]) { n.x -= mx; n.y -= my; }
              insertGroup({ name, fragment: frag });
            }
          }}>
            <option value="">+ Insert…</option>
            {effects.length > 0 && <optgroup label="My effects">{effects.map((x) => <option key={x.id} value={'e:' + x.id}>{x.name}</option>)}</optgroup>}
            <optgroup label="Presets">{VFX_PRESETS.map((p) => <option key={p.id} value={'p:' + p.id}>{p.name}</option>)}</optgroup>
            {comps.length > 0 && <optgroup label="Components (one system)">{comps.map((c, i) => <option key={i} value={'c:' + i}>{c.name}{c.version ? ` (v${c.version})` : ''}</option>)}</optgroup>}
            {groups.length > 0 && <optgroup label="Node groups">{groups.map((gr, i) => <option key={i} value={'g:' + i} title={gr.doc}>{gr.name} (v{gr.version})</option>)}</optgroup>}
          </select>}
          <button onClick={() => set((gg) => { gg.params.push({ id: newId('vp'), name: 'Param ' + (gg.params.length + 1), type: 'number', value: 1, bindings: [] }); })}>+ Parameter</button>
          <button onClick={addComment} title="A frame with a note; nodes inside move with it">+ Comment</button>
          <button onClick={() => autoLayout(set)} title="Line the systems up in a row, shape and texture nodes in columns to their left">Tidy</button>
          <button onClick={fit}>Fit view</button>
          <button className={showTimeline ? 'on' : ''} onClick={() => setShowTimeline(!showTimeline)} title="Show or hide the timeline (one track per system)">Timeline</button>
        </div>
        {showTimeline && g.systems.length > 0 && <Timeline graph={g} layers={compiled.layers} selected={selSys?.id} onChange={(fn) => set(fn)} onSelect={(id) => setSel({ kind: 'system', sys: id })} />}
        {compiled.warnings.length > 0 && <div className="vx-warnings">{compiled.warnings.slice(0, 4).map((w, i) => <div key={i}><Icon name="alert-triangle" size={12} /> {w}</div>)}{compiled.warnings.length > 4 && <div>…and {compiled.warnings.length - 4} more</div>}</div>}
        {menu && <NodeMenu ctx={menu.ctx} x={menu.x} y={menu.y} onClose={() => setMenu(null)} onPick={(t) => {
          const nb = newBlock(t.type);
          set((gg) => { sysById(gg, menu.sys).contexts[t.context].push(nb); });
          setSel({ kind: 'block', sys: menu.sys, block: nb.id }); setMenu(null);
        }} />}
      </div>
      <div className="vx-side">
        <Preview layers={compiled.layers} version={rev + texOut.rev * 1000} shapes={previewShapes} />
        <div className="vx-insp">
          {selTex ? (
            <TexNodeInspector key={selTex.id} graph={g} node={selTex} outputs={texOut} onChange={(fn) => set(fn)} onDelete={() => { set((gg) => { gg.texNodes = gg.texNodes?.filter((t) => t.id !== selTex.id); for (const t of gg.texNodes ?? []) for (const k of Object.keys(t.inputs)) if (t.inputs[k] === selTex.id) t.inputs[k] = undefined; for (const s of gg.systems) for (const c of CONTEXTS) for (const b of s.contexts[c.id]) for (const [k, v] of Object.entries(b.props)) if (v === 'node:' + selTex.id) b.props[k] = ''; }); setSel(null); }} />
          ) : selComment ? (
            <div className="vx-form">
              <h4>Comment</h4>
              <label>Text<textarea value={selComment.text} rows={3} onChange={(e) => set((gg) => { gg.comments!.find((c) => c.id === selComment.id)!.text = e.target.value; })} /></label>
              <label>Colour<input type="color" value={selComment.color} onChange={(e) => set((gg) => { gg.comments!.find((c) => c.id === selComment.id)!.color = e.target.value; })} /></label>
              <p className="vx-doc">Drag the title to move the frame with everything inside it; drag the corner to resize. Collapse it to tidy the graph — the systems inside keep playing. {membersOf(selComment).length} node(s) inside.</p>
              <div className="vx-row">
                <button onClick={() => set((gg) => { const x = gg.comments!.find((k) => k.id === selComment.id)!; x.collapsed = !x.collapsed; })}>{selComment.collapsed ? 'Expand' : 'Collapse'}</button>
                <button onClick={() => saveGroup(selComment)} title="Save the systems, texture and shape nodes inside (with their exposed parameters) as a node group you can insert into any effect">Save as node group</button>
              </div>
              <button className="danger" onClick={() => { set((gg) => { gg.comments = gg.comments!.filter((c) => c.id !== selComment.id); }); setSel(null); }}>Delete comment</button>
            </div>
          ) : selShape ? (
            <ShapeInspector key={selShape.id} shape={selShape} systems={sysOfShape(selShape.id).length}
              onChange={(fn) => set((gg) => { const s = gg.shapes!.find((x) => x.id === selShape.id); if (s) fn(s); })}
              onEmit={() => emitFrom(selShape)}
              onDelete={() => { set((gg) => { gg.shapes = gg.shapes!.filter((x) => x.id !== selShape.id); for (const s of gg.systems) if (s.source === selShape.id) delete s.source; }); setSel(null); }} />
          ) : selBlock && selSys ? (
            <BlockInspector key={selBlock.id} block={selBlock} sys={selSys} params={g.params} boundTo={boundTo} layer={compiled.layers.find((l) => l.name === selSys.name)?.params}
              onProp={(k, v) => set((gg) => { const s = sysById(gg, selSys.id); const b = CONTEXTS.flatMap((c) => s.contexts[c.id]).find((x) => x.id === selBlock.id)!; b.props[k] = v; })}
              onProps={(o) => set((gg) => { const s = sysById(gg, selSys.id); const b = CONTEXTS.flatMap((c) => s.contexts[c.id]).find((x) => x.id === selBlock.id)!; Object.assign(b.props, o); })}
              onComment={(t) => set((gg) => { const s = sysById(gg, selSys.id); const b = CONTEXTS.flatMap((c) => s.contexts[c.id]).find((x) => x.id === selBlock.id)!; b.comment = t || undefined; })}
              onExpose={(prop, pdef) => set((gg) => {
                const existing = gg.params.find((p) => p.bindings.some((b) => b.block === selBlock.id && b.prop === prop));
                if (existing) { existing.bindings = existing.bindings.filter((b) => !(b.block === selBlock.id && b.prop === prop)); return; }
                const type: VfxParam['type'] = pdef.type === 'color' ? 'color' : pdef.type === 'vector' ? 'vector' : pdef.type === 'bool' ? 'bool' : pdef.type === 'curve' ? 'curve' : pdef.type === 'gradient' ? 'gradient' : 'number';
                const same = gg.params.find((p) => p.type === type && p.name === pdef.label);
                const prm: VfxParam = same ?? { id: newId('vp'), name: pdef.label, type, value: JSON.parse(JSON.stringify(selBlock.props[prop])), bindings: [] };
                if (!same) gg.params.push(prm);
                prm.bindings.push({ system: selSys.id, block: selBlock.id, prop });
              })}
              onDuplicate={() => duplicateBlock(selSys.id, selBlock.id)}
              onDelete={() => { set((gg) => { const s = sysById(gg, selSys.id); for (const c of CONTEXTS) s.contexts[c.id] = s.contexts[c.id].filter((b) => b.id !== selBlock.id); for (const p of gg.params) p.bindings = p.bindings.filter((b) => b.block !== selBlock.id); }); setSel(null); }}
              onMove={(dir) => set((gg) => { const s = sysById(gg, selSys.id); for (const c of CONTEXTS) { const l = s.contexts[c.id]; const i = l.findIndex((b) => b.id === selBlock.id); if (i >= 0) { const j = i + dir; if (j >= 0 && j < l.length) { [l[i], l[j]] = [l[j], l[i]]; } } } })} />
          ) : selSys ? (
            <SystemInspector sys={selSys} shapes={shapes} layer={compiled.layers.find((l) => l.name === selSys.name)?.params}
              onChange={(fn) => set((gg) => fn(sysById(gg, selSys.id)))}
              onDuplicate={() => addSystem(selSys)}
              onSaveComponent={async () => {
                const name = window.prompt('Save this system as a reusable component named', selSys.component?.name ?? selSys.name); if (!name) return;
                const prev = comps.find((c) => c.name === name);
                const version = (prev?.version ?? 0) + 1;
                const next = [...comps.filter((c) => c.name !== name), { name, system: { ...selSys, component: undefined }, version }];
                await api.saveComponents(next as any); setComps(next);
                set((gg) => { sysById(gg, selSys.id).component = { name, version }; });
                pc.set({ status: `Saved component "${name}" (version ${version}). Effects using older versions keep their copy until you update them.` });
              }}
              component={selSys.component ? comps.find((c) => c.name === selSys.component!.name) : undefined}
              onUpdateFromComponent={(c) => set((gg) => {
                const i = gg.systems.findIndex((s) => s.id === selSys.id); const old = gg.systems[i];
                const fresh: VfxSystem = { ...JSON.parse(JSON.stringify(c.system)), id: old.id, x: old.x, y: old.y, timing: old.timing, transform: old.transform, component: { name: c.name, version: c.version ?? 1 } };
                for (const ctx of CONTEXTS) fresh.contexts[ctx.id] = fresh.contexts[ctx.id].map((b) => ({ ...b, id: newId('vb') }));
                gg.systems[i] = fresh;
                for (const p of gg.params) p.bindings = p.bindings.filter((b) => b.system !== old.id);
              })}
              onDelete={() => { set((gg) => { gg.systems = gg.systems.filter((s) => s.id !== selSys.id); for (const p of gg.params) p.bindings = p.bindings.filter((b) => b.system !== selSys.id); for (const s of gg.systems) for (const b of s.contexts.update) if (b.props.target === selSys.id) b.props.target = ''; }); setSel(null); }}
              onResetBlender={() => { if (window.confirm('Replace this system\'s blocks with the ones made from the Blender settings?')) set((gg) => { const i = gg.systems.findIndex((s) => s.id === selSys.id); gg.systems[i] = resetBlenderSystem(gg.systems[i]); }); }} />
          ) : selParam ? (
            <div className="vx-form">
              <h4>Exposed parameter</h4>
              <label>Name<input value={selParam.name} onChange={(e) => set((gg) => { gg.params.find((p) => p.id === selParam.id)!.name = e.target.value; })} /></label>
              <label>Value<PropInput def={{ key: 'v', label: '', type: selParam.type === 'color' ? 'color' : selParam.type === 'vector' ? 'vector' : selParam.type === 'bool' ? 'bool' : selParam.type === 'curve' ? 'curve' : selParam.type === 'gradient' ? 'gradient' : 'number', default: 0, step: 0.1 }} value={selParam.value} onChange={(v) => set((gg) => { gg.params.find((p) => p.id === selParam.id)!.value = v; })} /></label>
              <p className="vx-doc">Drives {selParam.bindings.length} block propert{selParam.bindings.length === 1 ? 'y' : 'ies'}. {selParam.type === 'curve' || selParam.type === 'gradient' ? 'A shared curve/gradient: every linked node follows it.' : 'In the games, change it with the "Set effect parameter" block.'} Link it from a block's property with the ⊕ button.</p>
              <button className="danger" onClick={() => { set((gg) => { gg.params = gg.params.filter((p) => p.id !== selParam.id); }); setSel(null); }}>Delete parameter</button>
            </div>
          ) : (
            <div className="vx-form">
              <h4>{doc.name}</h4>
              <p className="vx-doc">{compiled.layers.length} system(s) · {compiled.layers.reduce((a, l) => a + l.params.maxParticles, 0)} particles max. Click a node to edit it, drag a system's title to move it, wheel to zoom. Add nodes with "+ node" (searchable library), textures by dragging them from the Textures tab onto the canvas.</p>
              <p className="vx-doc">Each system keeps its own renderer and style (pixel-art sparks, realistic smoke, low-poly debris…): they all play and sort together. This effect runs on the same CPU particle engine as GameCraft and LogicCraft.</p>
            </div>
          )}
        </div>
      </div>
    </div>
    </EditorContext.Provider>
  );
}

/** Lines systems up in a row (by their current order) and stacks shape and texture nodes to their left. */
function autoLayout(set: (fn: (gg: VfxGraph) => void) => void) {
  set((gg) => {
    [...gg.systems].sort((a, b) => a.x - b.x).forEach((s, i) => { s.x = i * (SW + 60); s.y = 0; });
    const left = gg.params.length ? -360 : 0;
    (gg.shapes ?? []).forEach((s, i) => { s.x = left - SHW - 50; s.y = i * (SHH + 20); });
    let y = 0;
    (gg.texNodes ?? []).forEach((t) => { t.x = left - SHW - 50 - TEX_NODE_W - 60; t.y = y; y += texNodeHeight(t) + 20; });
  });
}

/** Searchable node library: every block, grouped by category; picks from other contexts go to their own context. */
function NodeMenu({ ctx, x, y, onPick, onClose }: { ctx: ContextId; x: number; y: number; onPick: (t: BlockType) => void; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [all, setAll] = useState(false);
  const ql = q.trim().toLowerCase();
  const list = VFX_BLOCKS.filter((b) => (all || ql || b.context === ctx) && (!ql || (b.name + ' ' + b.category + ' ' + b.doc + ' ' + b.type).toLowerCase().includes(ql)));
  const top = Math.min(y, window.innerHeight - 440), left = Math.min(x, window.innerWidth - 300);
  return (
    <div className="vx-menu nl" style={{ left, top }} onPointerDown={(e) => e.stopPropagation()}>
      <div className="nl-head">
        <input autoFocus placeholder="Search nodes…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') onClose(); if (e.key === 'Enter' && list[0]) onPick(list[0]); }} />
        <button onClick={onClose} title="Close">✕</button>
      </div>
      <label className="nl-all"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> All contexts ({CONTEXTS.find((c) => c.id === ctx)!.name} first)</label>
      <div className="nl-list">
        {BLOCK_CATEGORIES.map((c) => {
          const items = list.filter((b) => b.category === c.id).sort((a, b) => Number(b.context === ctx) - Number(a.context === ctx));
          return items.length ? (
            <React.Fragment key={c.id}>
              <div className="nl-cat" style={{ ['--bc' as any]: c.color }}>{c.id}</div>
              {items.map((b) => <button key={b.type} title={b.doc} onClick={() => onPick(b)}><b>{b.name}</b>{b.context !== ctx && <span className="nl-ctx">{CONTEXTS.find((x) => x.id === b.context)!.name}</span>}<small>{b.doc}</small></button>)}
            </React.Fragment>
          ) : null;
        })}
        {!list.length && <p className="vx-doc">No node matches "{q}".</p>}
      </div>
    </div>
  );
}

/** "+ Texture node" menu (texture graph). */
function TexNodeAddMenu({ onAdd, onRecipe }: { onAdd: (type: string, name: string) => void; onRecipe: (name: string) => void }) {
  return <TexNodeMenuSelect onAdd={onAdd} onRecipe={onRecipe} />;
}
function TexNodeMenuSelect({ onAdd, onRecipe }: { onAdd: (type: string, name: string) => void; onRecipe: (name: string) => void }) {
  const cats = [...new Set(TEX_NODE_TYPES.map((t) => t.category))];
  return (
    <select value="" title="Texture nodes: inputs, procedural generators, filters, flipbook tools — or a ready-made recipe" onChange={(e) => { const v = e.target.value; if (v.startsWith('recipe:')) { onRecipe(v.slice(7)); return; } const t = TEX_NODE_TYPES.find((x) => x.type === v); if (t) onAdd(t.type, t.name); }}>
      <optgroup label="Recipes (ready-made chains)">{TEX_RECIPES.map((r) => <option key={r.name} value={'recipe:' + r.name} title={r.doc}>{r.name}</option>)}</optgroup>
      <option value="">+ Texture node…</option>
      {cats.map((c) => <optgroup key={c} label={c}>{TEX_NODE_TYPES.filter((t) => t.category === c).map((t) => <option key={t.type} value={t.type}>{t.name}</option>)}</optgroup>)}
    </select>
  );
}

function SystemInspector({ sys, shapes, layer, component, onChange, onDuplicate, onSaveComponent, onUpdateFromComponent, onDelete, onResetBlender }: {
  sys: VfxSystem; shapes: VfxShape[]; layer?: import('@shared/src/runtime/particles').EmitterParams;
  component?: { name: string; system: VfxSystem; version?: number };
  onChange: (fn: (s: VfxSystem) => void) => void; onDuplicate: () => void; onSaveComponent: () => void; onUpdateFromComponent: (c: { name: string; system: VfxSystem; version?: number }) => void; onDelete: () => void; onResetBlender: () => void;
}) {
  const tm = sys.timing ?? { delay: 0, timeScale: 1 }, tr = sys.transform ?? { offset: [0, 0, 0] as [number, number, number], rotation: [0, 0, 0] as [number, number, number], scale: 1 };
  const vec = (label: string, v: [number, number, number], on: (n: [number, number, number]) => void, step = 0.1) => (
    <label>{label}<span className="vx-vec">{[0, 1, 2].map((i) => <input key={i} type="number" step={step} value={Math.round(v[i] * 1000) / 1000} onChange={(e) => { const n = [...v] as [number, number, number]; n[i] = Number(e.target.value); on(n); }} />)}</span></label>
  );
  const need = layer && layer.rate > 0 ? Math.ceil(layer.rate * (layer.lifetime + layer.lifetimeVar)) : 0;
  return (
    <div className="vx-form">
      <h4>System</h4>
      <label>Name<input value={sys.name} onChange={(e) => onChange((s) => { s.name = e.target.value; })} /></label>
      <label>Label<input value={sys.label ?? ''} placeholder="e.g. realistic, pixel" onChange={(e) => onChange((s) => { s.label = e.target.value || undefined; })} /></label>
      <label>Node colour<input type="color" value={sys.color ?? '#5b8def'} onChange={(e) => onChange((s) => { s.color = e.target.value; })} /></label>
      <h5>Timeline</h5>
      <label title="Seconds after the effect starts before this system begins">Start delay (s)<input type="number" min={0} step={0.05} value={tm.delay} onChange={(e) => onChange((s) => { s.timing = { ...tm, delay: Math.max(0, Number(e.target.value)) }; })} /></label>
      <label title="This system's own playback speed">Speed ×<input type="number" min={0.05} step={0.05} value={tm.timeScale} onChange={(e) => onChange((s) => { s.timing = { ...tm, timeScale: Math.max(0.05, Number(e.target.value)) }; })} /></label>
      <h5>Transform in the effect</h5>
      {vec('Offset', tr.offset, (n) => onChange((s) => { s.transform = { ...tr, offset: n }; }))}
      {vec('Rotation (°)', tr.rotation, (n) => onChange((s) => { s.transform = { ...tr, rotation: n }; }), 5)}
      <label>Scale<input type="number" min={0.01} step={0.1} value={tr.scale} onChange={(e) => onChange((s) => { s.transform = { ...tr, scale: Math.max(0.01, Number(e.target.value)) }; })} /></label>
      <label title="Which systems draw on top when not sorted together (multiply/screen layers, equal depths)">Draw order<input type="number" step={1} value={sys.sortOrder ?? 0} onChange={(e) => onChange((s) => { s.sortOrder = Number(e.target.value) || undefined; })} /></label>
      <label title="Particles are born on this shape (add an 'Mesh surface emitter' node to choose surface, volume or edges; 'Cling to shape' keeps them on it)">Source shape
        <select value={sys.source ?? ''} onChange={(e) => onChange((s) => { if (e.target.value) { s.source = e.target.value; if (!s.contexts.init.some((b) => b.type === 'shapeEmit')) s.contexts.init.splice(1, 0, newBlock('shapeEmit')); } else delete s.source; })}>
          <option value="">None (emitter nodes)</option>{shapes.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select></label>
      {layer && <p className="vx-doc">Up to {layer.maxParticles} particles{need ? ` · a steady stream needs about ${need}${need > layer.maxParticles ? ' — raise Capacity, or particles will be skipped' : ''}` : ''}.</p>}
      {sys.origin && (
        <div className="vx-origin">
          <b>Blender Particle Effect node</b>
          <span>"{sys.origin.system}" on {sys.origin.object} ({sys.origin.file})</span>
          <span className="vx-doc">Its Blender settings became the blocks below: edit them, or add more blocks (turbulence, color over life…) like any system.</span>
          <details><summary>Blender settings</summary>{Object.entries(sys.origin.settings).map(([k, v]) => <div key={k} className="vx-doc">{k}: {Array.isArray(v) ? v.map((x) => Math.round(Number(x) * 100) / 100).join(', ') : typeof v === 'number' ? Math.round(v * 1000) / 1000 : String(v)}</div>)}</details>
          {sys.origin.notes.length > 0 && <div><span className="vx-doc">Approximated:</span>{sys.origin.notes.map((n, i) => <div key={i} className="vx-doc">· {n}</div>)}</div>}
          <button onClick={onResetBlender}>Reset to Blender settings</button>
        </div>
      )}
      {sys.component && (
        <div className="vx-origin">
          <b>Component "{sys.component.name}" · v{sys.component.version}</b>
          {component && (component.version ?? 1) > sys.component.version
            ? <><span className="vx-doc">A newer version (v{component.version}) was saved. This effect keeps its own copy until you update it.</span><button onClick={() => onUpdateFromComponent(component)}>Update to v{component.version}</button></>
            : <span className="vx-doc">{component ? 'Up to date.' : 'The component is no longer in the library; this copy keeps working.'}</span>}
          <button onClick={() => onChange((s) => { delete s.component; })}>Detach from component</button>
        </div>
      )}
      <p className="vx-doc">Each system is one particle layer. Several systems make one effect (flash + fireball + smoke + sparks + shockwave + debris).</p>
      <div className="vx-row">
        <button onClick={onDuplicate} title="Ctrl+D">Duplicate</button>
        <button onClick={onSaveComponent}>Save as component</button>
        <button className="danger" onClick={onDelete}>Delete</button>
      </div>
    </div>
  );
}

/** Shape node properties: kind, size, scale, rotation, position, visibility. The effect updates as you edit. */
function ShapeInspector({ shape, systems, onChange, onEmit, onDelete }: { shape: VfxShape; systems: number; onChange: (fn: (s: VfxShape) => void) => void; onEmit: () => void; onDelete: () => void }) {
  const num = (label: string, v: number, on: (n: number) => void, step = 0.05, min?: number) => (
    <label>{label}<span className="vx-num"><input type="number" step={step} min={min} value={Math.round(v * 1000) / 1000} onChange={(e) => on(Number(e.target.value))} /></span></label>
  );
  const vec = (label: string, v: [number, number, number], on: (n: [number, number, number]) => void, step = 0.1) => (
    <label>{label}<span className="vx-vec">{[0, 1, 2].map((i) => <input key={i} type="number" step={step} value={Math.round(v[i] * 1000) / 1000} onChange={(e) => { const n = [...v] as [number, number, number]; n[i] = Number(e.target.value); on(n); }} />)}</span></label>
  );
  const k = shape.kind, round = k === 'sphere' || k === 'cylinder' || k === 'cone' || k === 'capsule' || k === 'torus';
  return (
    <div className="vx-form">
      <h4>{k === 'mesh' ? 'Object node' : 'Shape node'}</h4>
      <p className="vx-doc">{k === 'mesh' ? `Imported object${shape.mesh?.source ? ` (${shape.mesh.source})` : ''}.` : 'A basic 3D shape.'} Connect systems to it (System › Source shape, or the button below): particles are born on its surface, inside it or along its edges, and "Cling to shape" keeps them on it. {systems ? `${systems} system(s) use it.` : ''}</p>
      <label>Name<input value={shape.name} onChange={(e) => onChange((s) => { s.name = e.target.value; })} /></label>
      {k !== 'mesh' && <label>Shape<select value={k} onChange={(e) => onChange((s) => { s.kind = e.target.value as ShapeKind; })}>{SHAPE_KINDS.map((x) => <option key={x.kind} value={x.kind}>{x.name}</option>)}</select></label>}
      {(k === 'cube' || k === 'plane') && num('Width', shape.width, (n) => onChange((s) => { s.width = Math.max(0, n); }), 0.05, 0)}
      {(k === 'cube' || k === 'cylinder' || k === 'cone' || k === 'capsule') && num('Height', shape.height, (n) => onChange((s) => { s.height = Math.max(0, n); }), 0.05, 0)}
      {(k === 'cube' || k === 'plane') && num('Depth', shape.depth, (n) => onChange((s) => { s.depth = Math.max(0, n); }), 0.05, 0)}
      {round && num('Radius', shape.radius, (n) => onChange((s) => { s.radius = Math.max(0.01, n); }), 0.05, 0.01)}
      {k === 'torus' && num('Thickness', shape.tube ?? 0.18, (n) => onChange((s) => { s.tube = Math.max(0.01, n); }), 0.02, 0.01)}
      {num('Scale', shape.scale, (n) => onChange((s) => { s.scale = Math.max(0.01, n); }), 0.1, 0.01)}
      {vec('Rotation (°)', shape.rotation, (n) => onChange((s) => { s.rotation = n; }), 5)}
      {vec('Position', shape.position, (n) => onChange((s) => { s.position = n; }))}
      <label className="chk"><input type="checkbox" checked={shape.hideOriginal} onChange={(e) => onChange((s) => { s.hideOriginal = e.target.checked; })} /> Hide original shape (show only the particles)</label>
      {!shape.hideOriginal && <label>Shape color<input type="color" value={shape.color ?? '#8fa3bf'} onChange={(e) => onChange((s) => { s.color = e.target.value; })} /></label>}
      <div className="vx-row"><button onClick={onEmit}>Emit particles from it</button><button className="danger" onClick={onDelete}>Delete</button></div>
    </div>
  );
}

function BlockInspector({ block, sys, params, boundTo, layer, onProp, onProps, onComment, onExpose, onDuplicate, onDelete, onMove }: {
  block: VfxBlock; sys: VfxSystem; params: VfxParam[]; boundTo: (s: string, b: string, p: string) => VfxParam | undefined; layer?: import('@shared/src/runtime/particles').EmitterParams;
  onProp: (k: string, v: any) => void; onProps: (o: Record<string, any>) => void; onComment: (t: string) => void; onExpose: (k: string, d: PropDef) => void; onDuplicate: () => void; onDelete: () => void; onMove: (dir: number) => void;
}) {
  const t = VFX_BLOCK[block.type];
  const lib = useTexLib();
  // Spawn from image: (re)sample the picture into points when its settings change.
  const sampleKey = block.type === 'imageEmitter' ? JSON.stringify([block.props.image, block.props.use, block.props.threshold, block.props.width, block.props.cols, block.props.rows, block.props.frame, lib.items.find((a) => 'asset:' + a.id === block.props.image)?.modified]) : '';
  useEffect(() => {
    if (block.type !== 'imageEmitter' || block.props.sampledKey === sampleKey) return;
    if (!block.props.image) return;
    let dead = false;
    sampleImagePoints(block.props.image, { use: block.props.use, threshold: block.props.threshold, width: block.props.width, cols: block.props.cols, rows: block.props.rows, frame: block.props.frame })
      .then((r) => { if (!dead) onProps({ points: r, sampledKey: sampleKey }); }).catch((e) => pc.set({ status: 'Could not sample the picture: ' + e.message }));
    return () => { dead = true; };
  }, [sampleKey]);
  if (!t) return <div className="vx-form"><h4>Unknown block</h4><p className="vx-doc">"{block.type}" is kept but ignored.</p></div>;
  void params;
  return (
    <div className="vx-form">
      <h4><span className="vx-catdot" style={{ background: catColor(t) }} />{t.name} <small className="vx-cat">{t.category}</small></h4>
      <p className="vx-doc">{t.doc}</p>
      {block.type === 'flipbook' && layer?.flipbook && <FlipbookTiming params={layer} />}
      {block.type === 'material' && layer && <><MaterialPreview params={layer} /><MaterialLibrary props={block.props} onApply={(p) => onProps(p)} /></>}
      {block.type === 'imageEmitter' && <p className="vx-doc">{block.props.points?.pts?.length ? `${block.props.points.pts.length / 6} spawn points sampled.` : 'Pick a picture to sample.'}</p>}
      {t.props.filter((p) => p.label).map((p) => {
        const bound = boundTo(sys.id, block.id, p.key);
        const exposable = p.type !== 'image' && p.type !== 'texture' && p.type !== 'system' && p.type !== 'text' && p.type !== 'colors' && p.type !== 'points' && p.type !== 'choice';
        const wide = p.type === 'curve' || p.type === 'gradient' || p.type === 'points' || p.type === 'colors';
        return (
          <label key={p.key} className={(bound ? 'bound ' : '') + (wide ? 'wide' : '')} title={p.doc}>{p.label}
            <span className="vx-propline">
              {bound ? <em className="vx-bound">← {bound.name}</em> : <PropInput def={p} value={block.props[p.key]} onChange={(v, extra) => (extra ? onProps({ [p.key]: v, ...extra }) : onProp(p.key, v))} blockType={block.type} />}
              {exposable && <button className={'vx-expose' + (bound ? ' on' : '')} title={bound ? 'Unlink from the parameter' : p.type === 'curve' || p.type === 'gradient' ? 'Share as a curve/gradient parameter (reuse it on other nodes)' : 'Expose as a parameter (controllable from the games)'} onClick={(e) => { e.preventDefault(); onExpose(p.key, p); }}>⊕</button>}
            </span>
          </label>
        );
      })}
      <label>Note<input value={block.comment ?? ''} placeholder="A comment shown on the node" onChange={(e) => onComment(e.target.value)} /></label>
      <div className="vx-row"><button onClick={() => onMove(-1)}>↑</button><button onClick={() => onMove(1)}>↓</button><button onClick={onDuplicate} title="Ctrl+D">Duplicate</button><button className="danger" onClick={onDelete}>Delete node</button></div>
    </div>
  );
}

export function PropInput({ def, value, onChange, blockType }: { def: PropDef; value: any; onChange: (v: any, extra?: Record<string, any>) => void; blockType?: string }) {
  const ed = useContext(EditorContext);
  if (def.type === 'bool') return <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} />;
  if (def.type === 'color') return <input type="color" value={String(value)} onChange={(e) => onChange(e.target.value)} />;
  if (def.type === 'choice') return <select value={String(value)} onChange={(e) => onChange(e.target.value)}>{def.options!.map((o) => <option key={o}>{o}</option>)}</select>;
  if (def.type === 'text') return <input value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} />;
  if (def.type === 'curve') return <CurveEditor value={value} onChange={onChange} saved={ed.curves} onSave={ed.saveCurve} />;
  if (def.type === 'gradient') return <GradientEditor value={value} onChange={onChange} />;
  if (def.type === 'colors') return <ColorsInput value={value} onChange={onChange} />;
  if (def.type === 'points') return <PointsInput value={value} onChange={onChange} />;
  if (def.type === 'system') return <select value={String(value ?? '')} onChange={(e) => onChange(e.target.value)}><option value="">(choose a system)</option>{ed.systems.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>;
  if (def.type === 'texture') return (
    <TexturePicker value={String(value ?? '')} nodes={ed.texNodes} wantSheet={blockType === 'flipbook'}
      onChange={(ref, a) => {
        // Picking a sprite sheet fills the Flipbook / Spawn-from-image grid from the library.
        if (a?.sheet && (blockType === 'flipbook' || blockType === 'imageEmitter')) onChange(ref, { cols: a.sheet.cols, rows: a.sheet.rows, ...(blockType === 'flipbook' ? { frames: a.sheet.frames, padding: a.sheet.padding, spacing: a.sheet.spacing, sheetSize: [a.w, a.h], fps: a.sheet.fps ?? 24 } : {}) });
        else if (a && blockType === 'flipbook') onChange(ref, { sheetSize: [a.w, a.h] });
        else onChange(ref);
      }} />
  );
  if (def.type === 'image') return (
    <span className="vx-row">
      {!!value && <img src={String(value)} alt="" style={{ width: 24, height: 24, objectFit: 'contain', background: '#111' }} />}
      <label className="vx-file">{value ? 'Change…' : 'Import…'}<input type="file" accept="image/*" hidden onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onChange(await particlePictureData(f)); }} /></label>
      {!!value && <button onClick={() => onChange('')}>Remove</button>}
    </span>
  );
  if (def.type === 'vector') {
    const v = (Array.isArray(value) ? value : [0, 0, 0]) as number[];
    return <span className="vx-vec">{[0, 1, 2].map((i) => <input key={i} type="number" step={0.1} value={v[i]} onChange={(e) => { const n = [...v]; n[i] = Number(e.target.value); onChange(n); }} />)}</span>;
  }
  const num = Number(value);
  return (
    <span className="vx-num">
      {def.min != null && def.max != null && <input type="range" min={def.min} max={def.max} step={def.step ?? 0.01} value={num} onChange={(e) => onChange(Number(e.target.value))} />}
      <input type="number" step={def.step ?? 0.1} value={Math.round(num * 1000) / 1000} onChange={(e) => onChange(Number(e.target.value))} />
    </span>
  );
}
