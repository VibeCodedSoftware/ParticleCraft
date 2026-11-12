// Inspector editors for ParticleCraft 2.0 property types: curves, gradients, colour lists and point paths.
import React, { useRef, useState } from 'react';
import type { Curve, GradientStop } from '@shared/src/runtime/particles';
import { evalCurve, evalGradient } from '@shared/src/runtime/particles';
import { CURVE_PRESETS } from '@shared/src/vfx/vfx';

const W = 236, H = 120, PAD = 8;

/** Curve editor: drag points; double-click to add; right-click (or Alt-click) to remove; interpolation; presets;
 *  your own saved curves (reusable across effects). */
export function CurveEditor({ value, onChange, saved = [], onSave }: { value: Curve; onChange: (c: Curve) => void; saved?: { name: string; curve: Curve }[]; onSave?: (name: string, c: Curve) => void }) {
  const c: Curve = value && Array.isArray(value.p) && value.p.length ? value : { p: [[0, 1], [1, 1]], mode: 'smooth' };
  const vals = c.p.map((q) => q[1]);
  const [range, setRange] = useState<[number, number]>(() => [Math.min(0, ...vals), Math.max(1, ...vals)]);
  const lo = Math.min(range[0], ...vals), hi = Math.max(range[1], ...vals);
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<number | null>(null);
  const [sel, setSel] = useState(0);
  const X = (t: number) => PAD + t * (W - PAD * 2), Y = (v: number) => H - PAD - ((v - lo) / Math.max(1e-6, hi - lo)) * (H - PAD * 2);
  const inv = (e: React.PointerEvent | React.MouseEvent) => { const r = svg.current!.getBoundingClientRect(); const x = ((e.clientX - r.left) / r.width) * W, y = ((e.clientY - r.top) / r.height) * H; return [Math.max(0, Math.min(1, (x - PAD) / (W - PAD * 2))), lo + ((H - PAD - y) / (H - PAD * 2)) * (hi - lo)] as [number, number]; };
  const set = (p: [number, number][], mode = c.mode) => onChange({ p: [...p].sort((a, b) => a[0] - b[0]), mode });
  const path = Array.from({ length: 61 }, (_, i) => { const t = i / 60; return `${i ? 'L' : 'M'}${X(t).toFixed(1)},${Y(evalCurve(c, t)).toFixed(1)}`; }).join(' ');
  const r3 = (n: number) => Math.round(n * 1000) / 1000;
  return (
    <div className="ce">
      <svg ref={svg} viewBox={`0 0 ${W} ${H}`} className="ce-svg"
        onDoubleClick={(e) => { const [t, v] = inv(e); set([...c.p, [r3(t), r3(v)]]); }}
        onPointerMove={(e) => { if (drag.current == null) return; const [t, v] = inv(e); const p = c.p.map((q) => [...q] as [number, number]); const k = drag.current; const first = k === 0, last = k === p.length - 1; p[k] = [first ? 0 : last ? 1 : r3(t), r3(v)]; onChange({ p, mode: c.mode }); }}
        onPointerUp={() => { if (drag.current != null) { drag.current = null; set(c.p); } }}>
        <rect x={PAD} y={PAD} width={W - PAD * 2} height={H - PAD * 2} className="ce-bg" />
        {lo < 0 && hi > 0 && <line x1={PAD} x2={W - PAD} y1={Y(0)} y2={Y(0)} className="ce-zero" />}
        {[0.25, 0.5, 0.75].map((t) => <line key={t} x1={X(t)} x2={X(t)} y1={PAD} y2={H - PAD} className="ce-grid" />)}
        <path d={path} className="ce-line" />
        {c.p.map((q, k) => (
          <circle key={k} cx={X(q[0])} cy={Y(q[1])} r={k === sel ? 5 : 4} className={'ce-pt' + (k === sel ? ' sel' : '')}
            onPointerDown={(e) => { e.stopPropagation(); if (e.altKey || e.button === 2) { if (c.p.length > 2) set(c.p.filter((_, j) => j !== k)); return; } (e.target as Element).setPointerCapture?.(e.pointerId); drag.current = k; setSel(k); }}
            onContextMenu={(e) => { e.preventDefault(); if (c.p.length > 2) set(c.p.filter((_, j) => j !== k)); }} />
        ))}
        <text x={PAD + 2} y={PAD + 9} className="ce-lbl">{r3(hi)}</text><text x={PAD + 2} y={H - PAD - 2} className="ce-lbl">{r3(lo)}</text>
      </svg>
      <div className="ce-row">
        {c.p[sel] && <>
          <input type="number" step={0.01} min={0} max={1} title="Time (0–1)" value={c.p[sel][0]} disabled={sel === 0 || sel === c.p.length - 1} onChange={(e) => { const p = c.p.map((q) => [...q] as [number, number]); p[sel][0] = Math.max(0, Math.min(1, Number(e.target.value))); set(p); }} />
          <input type="number" step={0.05} title="Value" value={c.p[sel][1]} onChange={(e) => { const p = c.p.map((q) => [...q] as [number, number]); p[sel][1] = Number(e.target.value); onChange({ p, mode: c.mode }); }} />
        </>}
        <select value={c.mode ?? 'linear'} title="Interpolation" onChange={(e) => set(c.p, e.target.value as Curve['mode'])}><option value="linear">Linear</option><option value="smooth">Smooth</option><option value="step">Step</option></select>
      </div>
      <div className="ce-row">
        <select value="" onChange={(e) => { const all = [...CURVE_PRESETS, ...saved]; const pr = all.find((x) => x.name === e.target.value); if (pr) { const scale = hi - lo > 1.5 ? hi : 1; onChange({ p: pr.curve.p.map(([t, v]) => [t, r3(v * scale)] as [number, number]), mode: pr.curve.mode }); } }}>
          <option value="">Presets…</option>
          <optgroup label="Built-in">{CURVE_PRESETS.map((p) => <option key={p.name}>{p.name}</option>)}</optgroup>
          {saved.length > 0 && <optgroup label="Your curves">{saved.map((p) => <option key={p.name}>{p.name}</option>)}</optgroup>}
        </select>
        <input type="number" step={0.5} title="Graph top" value={range[1]} onChange={(e) => setRange([range[0], Number(e.target.value)])} />
        {onSave && <button title="Save this curve to reuse it anywhere" onClick={() => { const n = window.prompt('Save curve as'); if (n) onSave(n, c); }}>Save</button>}
      </div>
      <span className="vx-doc">Double-click: add point · drag: move · right-click: remove</span>
    </div>
  );
}

/** Gradient editor: click the bar to add a stop, drag stops, edit colour and opacity, remove. */
export function GradientEditor({ value, onChange }: { value: GradientStop[]; onChange: (g: GradientStop[]) => void }) {
  const g = Array.isArray(value) && value.length ? value : [{ t: 0, c: '#ffffff', a: 1 }, { t: 1, c: '#000000', a: 1 }];
  const [sel, setSel] = useState(0);
  const bar = useRef<HTMLDivElement>(null);
  const drag = useRef<number | null>(null);
  const css = `linear-gradient(90deg, ${Array.from({ length: 17 }, (_, i) => { const t = i / 16, [r, gg, b, a] = evalGradient(g, t); return `rgba(${(r * 255) | 0},${(gg * 255) | 0},${(b * 255) | 0},${a.toFixed(2)}) ${(t * 100).toFixed(1)}%`; }).join(',')})`;
  const tOf = (e: React.PointerEvent | React.MouseEvent) => { const r = bar.current!.getBoundingClientRect(); return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)); };
  const put = (n: GradientStop[]) => onChange([...n].sort((a, b) => a.t - b.t));
  const s = g[Math.min(sel, g.length - 1)];
  return (
    <div className="ge">
      <div className="ge-bar checker" ref={bar}
        onPointerMove={(e) => { if (drag.current == null) return; const n = g.map((x) => ({ ...x })); n[drag.current].t = Math.round(tOf(e) * 1000) / 1000; onChange(n); }}
        onPointerUp={() => { if (drag.current != null) { drag.current = null; put(g); } }}
        onDoubleClick={(e) => { const t = tOf(e), [r, gg, b, a] = evalGradient(g, t); const hex = '#' + [r, gg, b].map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join(''); const n = [...g, { t, c: hex, a }].sort((x, y) => x.t - y.t); onChange(n); setSel(n.findIndex((x) => x.t === t)); }}>
        <div className="ge-fill" style={{ background: css }} />
        {g.map((x, k) => <span key={k} className={'ge-stop' + (k === sel ? ' sel' : '')} style={{ left: `${x.t * 100}%`, background: x.c }} onPointerDown={(e) => { e.stopPropagation(); (e.target as Element).setPointerCapture?.(e.pointerId); drag.current = k; setSel(k); }} />)}
      </div>
      {s && (
        <div className="ce-row">
          <input type="color" value={s.c} onChange={(e) => { const n = g.map((x) => ({ ...x })); n[sel].c = e.target.value; onChange(n); }} />
          <input type="number" min={0} max={1} step={0.05} title="Opacity" value={s.a ?? 1} onChange={(e) => { const n = g.map((x) => ({ ...x })); n[sel].a = Math.max(0, Math.min(1, Number(e.target.value))); onChange(n); }} />
          <input type="number" min={0} max={1} step={0.01} title="Position" value={s.t} onChange={(e) => { const n = g.map((x) => ({ ...x })); n[sel].t = Math.max(0, Math.min(1, Number(e.target.value))); put(n); }} />
          <button disabled={g.length <= 2} onClick={() => { put(g.filter((_, k) => k !== sel)); setSel(0); }}>✕</button>
        </div>
      )}
      <span className="vx-doc">Double-click the bar: add a stop · drag stops</span>
    </div>
  );
}

export function ColorsInput({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const v = Array.isArray(value) ? value : [];
  return (
    <span className="vx-colors">
      {v.map((c, i) => <span key={i} className="vx-colorchip"><input type="color" value={c} onChange={(e) => { const n = [...v]; n[i] = e.target.value; onChange(n); }} /><button onClick={() => onChange(v.filter((_, j) => j !== i))} disabled={v.length <= 1}>✕</button></span>)}
      <button onClick={() => onChange([...v, v[v.length - 1] ?? '#ffffff'])} disabled={v.length >= 8}>+</button>
    </span>
  );
}

/** A path as a list of x, y, z points. */
export function PointsInput({ value, onChange }: { value: number[]; onChange: (v: number[]) => void }) {
  const v = Array.isArray(value) ? value : [];
  const pts = Array.from({ length: Math.floor(v.length / 3) }, (_, i) => [v[i * 3], v[i * 3 + 1], v[i * 3 + 2]]);
  const put = (p: number[][]) => onChange(p.flat());
  return (
    <span className="vx-points">
      {pts.map((p, i) => (
        <span key={i} className="vx-vec">
          {[0, 1, 2].map((k) => <input key={k} type="number" step={0.1} value={p[k]} onChange={(e) => { const n = pts.map((q) => [...q]); n[i][k] = Number(e.target.value); put(n); }} />)}
          <button onClick={() => put(pts.filter((_, j) => j !== i))} disabled={pts.length <= 2}>✕</button>
        </span>
      ))}
      <button onClick={() => { const l = pts[pts.length - 1] ?? [0, 0, 0]; put([...pts, [l[0] + 0.5, l[1], l[2]]]); }}>+ point</button>
    </span>
  );
}
