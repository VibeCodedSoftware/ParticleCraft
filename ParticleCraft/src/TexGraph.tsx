// Texture node graph on the VFX canvas: evaluation (cached, re-run only for nodes whose settings or inputs changed),
// node cards with live thumbnails, click-to-connect sockets, and the inspector (settings, inputs, big preview,
// save to the texture library, use in the selected system).
import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { VfxGraph, VfxTexNode } from '@shared/src/vfx/vfx';
import { newBlock } from '@shared/src/vfx/vfx';
import { TEX_NODE, fromImage, img as newImg, sample, texNodeDefaults, toCanvas, type Img } from './texNodes';
import { addTextureResolver, saveCanvasToLibrary } from './textureLib';
import { resolveTexture } from '@shared/src/vfx/vfx';
import { pc } from './store';
import { PropInput } from './VfxEditor';

export const TEX_NODE_W = 172;
const THUMB = 104;
export const texNodeHeight = (t: VfxTexNode) => (t.collapsed ? 28 : 28 + Math.max(0, (TEX_NODE[t.type]?.inputs.length ?? 0)) * 18 + THUMB + 10);

// ------------------------------------------------------------------ evaluation store
interface Out { img: Img; url: string; key: string; ms: number; error?: string }
const outputs = new Map<string, Out>();
const imgCache = new Map<string, Img>(); // key → result (shared across nodes / times)
const pictures = new Map<string, Img | 'loading'>();
let rev = 0;
const subs = new Set<() => void>();
const emit = () => { rev++; subs.forEach((f) => f()); };
addTextureResolver((ref) => (ref.startsWith('node:') ? outputs.get(ref.slice(5))?.url : undefined));

let pendingGraph: VfxGraph | null = null, timer: any = 0;
function schedule(g: VfxGraph) { pendingGraph = g; clearTimeout(timer); timer = setTimeout(() => { if (pendingGraph) evaluateAll(pendingGraph); }, 90); }

function picture(ref: string): Img | null {
  const url = resolveTexture(ref);
  if (!url) return null;
  const hit = pictures.get(url);
  if (hit === 'loading') return null;
  if (hit) return hit;
  pictures.set(url, 'loading');
  const el = new Image(); if (!url.startsWith('data:')) el.crossOrigin = 'anonymous';
  el.onload = () => { pictures.set(url, fromImage(el)); if (pendingGraph) schedule(pendingGraph); };
  el.onerror = () => pictures.delete(url);
  el.src = url;
  return null;
}

/** Evaluates node `id` at `time` (memoised by settings + inputs). */
function evalNode(g: VfxGraph, id: string, time: number, stack: Set<string>): { img: Img | null; key: string } {
  const node = g.texNodes?.find((t) => t.id === id);
  const T = node && TEX_NODE[node.type];
  if (!node || !T) return { img: null, key: 'none' };
  if (stack.has(id)) throw new Error('Texture nodes are connected in a loop');
  stack.add(id);
  const p = { ...texNodeDefaults(node.type), ...node.props };
  const ins: Record<string, { img: Img | null; key: string }> = {};
  for (const name of T.inputs) { const from = node.inputs[name]; ins[name] = from ? evalNode(g, from, time, stack) : { img: null, key: '-' }; }
  stack.delete(id);
  const animated = isAnimated(g, id);
  const key = JSON.stringify([node.type, p, Object.entries(ins).map(([k, v]) => k + v.key), animated ? time : 0, node.type === 'textureInput' ? resolveTexture(p.texture) : '']);
  const hit = imgCache.get(key);
  if (hit) return { img: hit, key };
  let out: Img | null;
  if (node.type === 'sequence') out = bakeSequence(g, node, p);
  else out = T.eval({ p, input: (k) => ins[k]?.img ?? null, time, picture });
  if (out) { imgCache.set(key, out); if (imgCache.size > 300) imgCache.delete(imgCache.keys().next().value!); }
  return { img: out, key };
}
function isAnimated(g: VfxGraph, id: string, seen = new Set<string>()): boolean {
  if (seen.has(id)) return false; seen.add(id);
  const n = g.texNodes?.find((t) => t.id === id); if (!n || n.type === 'sequence') return false;
  if (TEX_NODE[n.type]?.animated && (n.props.evolve ?? 1) > 0) return true;
  return Object.values(n.inputs).some((x) => x && isAnimated(g, x, seen));
}
/** Texture sequence: the input rendered at evenly spaced times into a sheet (optionally cross-faded to loop). */
function bakeSequence(g: VfxGraph, node: VfxTexNode, p: Record<string, any>): Img | null {
  const from = node.inputs.in; if (!from) return null;
  const cols = Math.round(p.cols), rows = Math.round(p.rows), N = cols * rows, fs = Math.round(p.frameSize), T = p.duration;
  const o = newImg(cols * fs, rows * fs), a = [0, 0, 0, 0], b = [0, 0, 0, 0];
  for (let k = 0; k < N; k++) {
    const t = (k / N) * T;
    const A = evalNode(g, from, t, new Set()).img; if (!A) return null;
    const B = p.loop ? evalNode(g, from, t + T, new Set()).img : null;
    const w = k / N;
    const ox = (k % cols) * fs, oy = Math.floor(k / cols) * fs;
    for (let y = 0; y < fs; y++) for (let x = 0; x < fs; x++) {
      sample(A, (x + 0.5) / fs, (y + 0.5) / fs, false, a);
      if (B) { sample(B, (x + 0.5) / fs, (y + 0.5) / fs, false, b); for (let q = 0; q < 4; q++) a[q] = a[q] * (1 - w) + b[q] * w; }
      o.d.set(a, ((oy + y) * o.w + ox + x) * 4);
    }
  }
  o.sheet = { cols, rows, frames: N };
  return o;
}
function evaluateAll(g: VfxGraph) {
  let changed = false;
  const live = new Set((g.texNodes ?? []).map((t) => t.id));
  for (const id of [...outputs.keys()]) if (!live.has(id)) { outputs.delete(id); changed = true; }
  for (const n of g.texNodes ?? []) {
    const t0 = performance.now();
    try {
      const r = evalNode(g, n.id, 0, new Set());
      const prev = outputs.get(n.id);
      if (!r.img) { if (prev) { outputs.delete(n.id); changed = true; } continue; }
      if (prev?.key === r.key) continue;
      outputs.set(n.id, { img: r.img, url: toCanvas(r.img).toDataURL('image/png'), key: r.key, ms: performance.now() - t0 });
      changed = true;
    } catch (e: any) {
      outputs.set(n.id, { img: newImg(1, 1), url: '', key: 'err', ms: 0, error: e.message });
      changed = true;
    }
  }
  if (changed) emit();
}

export function useTexNodeOutputs(g: VfxGraph) {
  useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => rev);
  useEffect(() => { schedule(g); }, [JSON.stringify(g.texNodes ?? [])]);
  return { rev, get: (id: string) => outputs.get(id) };
}
export type TexOutputs = ReturnType<typeof useTexNodeOutputs>;

// ------------------------------------------------------------------ click-to-connect
interface Pending { from: string }
let pending: Pending | null = null;
const linkSubs = new Set<() => void>();
export const texLink = {
  get: () => pending,
  set(p: Pending | null) { pending = p; linkSubs.forEach((f) => f()); },
  subscribe: (f: () => void) => { linkSubs.add(f); return () => linkSubs.delete(f); },
};
export function useTexLink() { return useSyncExternalStore(texLink.subscribe, texLink.get); }

/** Connects a texture node to a system: the Flipbook node if it has one (for sheets), else a Texture node. */
export function connectNodeToSystem(g: VfxGraph, nodeId: string, sysId: string) {
  const s = g.systems.find((x) => x.id === sysId); if (!s) return;
  const out = outputs.get(nodeId)?.img;
  const fb = s.contexts.output.find((b) => b.type === 'flipbook');
  if (out?.sheet || fb) {
    const b = fb ?? newBlock('flipbook');
    b.props.texture = 'node:' + nodeId;
    if (out?.sheet) Object.assign(b.props, { cols: out.sheet.cols, rows: out.sheet.rows, frames: out.sheet.frames, sheetSize: [out.w, out.h] });
    if (!fb) s.contexts.output.push(b);
    return;
  }
  const tb = s.contexts.output.find((b) => b.type === 'texture') ?? (() => { const b = newBlock('texture'); s.contexts.output.push(b); return b; })();
  tb.props.texture = 'node:' + nodeId;
}

// ------------------------------------------------------------------ canvas layer
export function TexNodesLayer({ graph, hidden, sel, pos, outputs: outs, onSelect, onDragStart, onChange }: {
  graph: VfxGraph; hidden?: Set<string>; sel: string | null; pos: (n: { id: string; x: number; y: number }) => { x: number; y: number }; outputs: TexOutputs;
  onSelect: (id: string) => void; onDragStart: (id: string, e: React.PointerEvent) => void; onChange: (fn: (g: VfxGraph) => void) => void;
}) {
  const link = useTexLink();
  const nodes = (graph.texNodes ?? []).filter((t) => !hidden?.has(t.id));
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') texLink.set(null); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, []);
  const inY = (t: VfxTexNode, i: number) => 28 + i * 18 + 9;
  return (
    <>
      <svg className="vx-wires" width="1" height="1">
        {nodes.flatMap((t) => (TEX_NODE[t.type]?.inputs ?? []).map((name, i) => {
          const from = t.inputs[name] && nodes.find((x) => x.id === t.inputs[name]); if (!from) return null;
          const a0 = pos(from), b0 = pos(t);
          const a = { x: a0.x + TEX_NODE_W, y: a0.y + 16 }, b = { x: b0.x, y: b0.y + (t.collapsed ? 14 : inY(t, i)) };
          const dx = Math.max(40, Math.abs(b.x - a.x) / 2);
          return <path key={t.id + name} className="vx-wire texture" d={`M${a.x},${a.y} C${a.x + dx},${a.y} ${b.x - dx},${b.y} ${b.x},${b.y}`} />;
        }))}
      </svg>
      {nodes.map((t) => {
        const T = TEX_NODE[t.type], p = pos(t), o = outs.get(t.id);
        return (
          <div key={t.id} className={'vx-tex' + (sel === t.id ? ' sel' : '') + (link?.from === t.id ? ' linking' : '')} style={{ left: p.x, top: p.y, width: TEX_NODE_W, height: texNodeHeight(t) }}
            onPointerDown={(e) => { e.stopPropagation(); onSelect(t.id); onDragStart(t.id, e); }}>
            <div className="vx-tex-head" title={T?.doc}>
              <button className="vx-collapse" onPointerDown={(e) => e.stopPropagation()} onClick={() => onChange((g) => { const n = g.texNodes!.find((x) => x.id === t.id)!; n.collapsed = !n.collapsed; })}>{t.collapsed ? '▸' : '▾'}</button>
              <span className="vx-tex-name">{t.name ?? T?.name ?? t.type}</span>
              <span className={'vx-tex-out' + (link?.from === t.id ? ' on' : '')} title="Output: click, then click an input socket or a system to connect"
                onPointerDown={(e) => { e.stopPropagation(); texLink.set(link?.from === t.id ? null : { from: t.id }); }} />
            </div>
            {!t.collapsed && <>
              {(T?.inputs ?? []).map((name, i) => {
                const from = t.inputs[name] ? nodes.find((x) => x.id === t.inputs[name]) : undefined;
                return (
                  <div key={name} className={'vx-tex-in' + (link && link.from !== t.id ? ' target' : '')}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      if (link && link.from !== t.id) {
                        const src = link.from;
                        onChange((g) => {
                          const n = g.texNodes!.find((x) => x.id === t.id)!; n.inputs[name] = src;
                          try { evalNode(g, t.id, 0, new Set()); } catch { n.inputs[name] = undefined; pc.set({ status: 'That connection would make a loop — not connected' }); }
                        });
                        texLink.set(null);
                      } else if (from) onChange((g) => { g.texNodes!.find((x) => x.id === t.id)!.inputs[name] = undefined; });
                    }} title={from ? `${name} ← ${from.name ?? from.type} (click to disconnect)` : `${name}: click an output, then here`}>
                    <span className={'vx-tex-sock' + (from ? ' on' : '')} />{name}{from ? <small>← {from.name ?? from.type}</small> : null}
                  </div>
                );
              })}
              <div className="vx-tex-thumb checker">{o?.error ? <span className="vx-tex-err">{o.error}</span> : o?.url ? <img src={o.url} alt="" draggable={false} /> : <span className="vx-doc">{T?.inputs.length ? 'connect an input' : t.type === 'textureInput' ? 'pick a picture' : '…'}</span>}</div>
            </>}
          </div>
        );
      })}
    </>
  );
}

// ------------------------------------------------------------------ inspector
export function TexNodeInspector({ graph, node, outputs: outs, onChange, onDelete }: { graph: VfxGraph; node: VfxTexNode; outputs: TexOutputs; onChange: (fn: (g: VfxGraph) => void) => void; onDelete: () => void }) {
  const T = TEX_NODE[node.type];
  const o = outs.get(node.id);
  const selSys = pc.get().selSys;
  const sys = selSys ? graph.systems.find((s) => s.id === selSys) : undefined;
  const props = { ...texNodeDefaults(node.type), ...node.props };
  const up = (fn: (n: VfxTexNode) => void) => onChange((g) => { const n = g.texNodes!.find((x) => x.id === node.id); if (n) fn(n); });
  const [bigBg, setBigBg] = useState<'checker' | 'black' | 'white'>('checker');
  const cRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => { /* keep */ }, []);
  if (!T) return <div className="vx-form"><h4>Unknown texture node</h4><button className="danger" onClick={onDelete}>Delete</button></div>;
  return (
    <div className="vx-form">
      <h4>{T.name} <small className="vx-cat">{T.category}</small></h4>
      <p className="vx-doc">{T.doc}</p>
      <div className={'vx-tex-big ' + bigBg} onClick={() => setBigBg(bigBg === 'checker' ? 'black' : bigBg === 'black' ? 'white' : 'checker')} title="Click to change the background">
        {o?.url ? <img src={o.url} alt="" /> : <span className="vx-doc">{o?.error ?? 'No output yet'}</span>}
      </div>
      {o?.img && <span className="vx-doc">{o.img.w}×{o.img.h}{o.img.sheet ? ` · ${o.img.sheet.cols}×${o.img.sheet.rows} sheet (${o.img.sheet.frames} frames)` : ''} · {o.ms.toFixed(0)} ms</span>}
      <label>Name<input value={node.name ?? ''} placeholder={T.name} onChange={(e) => up((n) => { n.name = e.target.value || undefined; })} /></label>
      {T.inputs.map((name) => (
        <label key={name}>Input "{name}"<select value={node.inputs[name] ?? ''} onChange={(e) => onChange((g) => { const n = g.texNodes!.find((x) => x.id === node.id)!; const prev = n.inputs[name]; n.inputs[name] = e.target.value || undefined; try { evalNode(g, n.id, 0, new Set()); } catch { n.inputs[name] = prev; pc.set({ status: 'That connection would make a loop — not connected' }); } })}>
          <option value="">(none)</option>{(graph.texNodes ?? []).filter((x) => x.id !== node.id).map((x) => <option key={x.id} value={x.id}>{x.name ?? TEX_NODE[x.type]?.name}</option>)}
        </select></label>
      ))}
      {T.props.map((p) => (
        <label key={p.key} className={p.type === 'gradient' ? 'wide' : ''}>{p.label}<span className="vx-propline"><PropInput def={p} value={props[p.key]} onChange={(v) => up((n) => { n.props[p.key] = v; })} /></span></label>
      ))}
      <canvas ref={cRef} hidden />
      <div className="vx-row">
        <button disabled={!o?.img || !!o.error} title="Store this picture in the texture library (reuse it in any effect, export it)" onClick={async () => {
          if (!o?.img) return;
          const name = window.prompt('Save texture as', node.name ?? T.name); if (!name) return;
          const a = await saveCanvasToLibrary(toCanvas(o.img), name, { sheet: o.img.sheet ? { ...o.img.sheet, padding: 0, spacing: 0 } : undefined });
          pc.set({ status: `Saved "${a.name}" to the texture library` });
        }}>Save to library</button>
        <button disabled={!sys} title={sys ? `Connect to "${sys.name}"` : 'Select a system first'} onClick={() => sys && onChange((g) => connectNodeToSystem(g, node.id, sys.id))}>{sys ? `Use in "${sys.name}"` : 'Use in system'}</button>
      </div>
      <div className="vx-row">
        <button onClick={() => texLink.set({ from: node.id })} title="Then click an input socket or a system">Connect output…</button>
        <button className="danger" onClick={onDelete}>Delete node</button>
      </div>
    </div>
  );
}
