// Small Adobe-style property widgets: scrubbable numbers, vectors, colors, sections.
import React, { useEffect, useRef, useState } from 'react';

export function Section({ title, children, defaultOpen = true, right, id }: { title: string; children: React.ReactNode; defaultOpen?: boolean; right?: React.ReactNode; id?: string }) {
  const key = 'gc.sec.' + (id ?? title);
  const [open, setOpen] = useState(() => { try { const v = localStorage.getItem(key); return v == null ? defaultOpen : v === '1'; } catch { return defaultOpen; } });
  return (
    <div className="sec">
      <div className="sec-head" onClick={() => { setOpen(!open); try { localStorage.setItem(key, open ? '0' : '1'); } catch { /* ignore */ } }}>
        <span className="sec-tw">{open ? '▾' : '▸'}</span><span className="sec-title">{title}</span><span className="sec-right" onClick={(e) => e.stopPropagation()}>{right}</span>
      </div>
      {open && <div className="sec-body">{children}</div>}
    </div>
  );
}

export function Row({ label, children, tip }: { label: string; children: React.ReactNode; tip?: string }) {
  return <div className="row" title={tip}><label>{label}</label><div className="row-v">{children}</div></div>;
}

/** Number field you can type in or drag horizontally (like Blender/Photoshop scrubby sliders). */
export function Num({ value, onChange, step = 0.1, min, max, precision = 3, suffix, width }: { value: number; onChange: (v: number) => void; step?: number; min?: number; max?: number; precision?: number; suffix?: string; width?: number }) {
  const [text, setText] = useState<string | null>(null);
  const drag = useRef<{ x: number; v: number; moved: boolean } | null>(null);
  const clamp = (v: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v));
  const fmt = (v: number) => (Number.isFinite(v) ? String(Math.round(v * 10 ** precision) / 10 ** precision) : '0');
  useEffect(() => {
    const move = (e: PointerEvent) => {
      const d = drag.current; if (!d) return;
      const dx = e.clientX - d.x; if (Math.abs(dx) > 2) d.moved = true;
      if (d.moved) onChange(clamp(d.v + Math.round(dx / 2) * step * (e.shiftKey ? 0.1 : e.ctrlKey ? 10 : 1)));
    };
    const up = () => { if (drag.current && !drag.current.moved) setText(fmt(value)); drag.current = null; };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
  });
  if (text !== null) {
    return <input className="num editing" style={{ width }} autoFocus value={text} onChange={(e) => setText(e.target.value)}
      onBlur={() => { const v = evalNum(text); if (v !== null) onChange(clamp(v)); setText(null); }}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setText(null); e.stopPropagation(); }} />;
  }
  return <div className="num" style={{ width }} onPointerDown={(e) => { drag.current = { x: e.clientX, v: value, moved: false }; }} title="Drag to scrub (Shift = fine, Ctrl = coarse), click to type">{fmt(value)}{suffix && <span className="suf">{suffix}</span>}</div>;
}

/** Allow simple math in number fields ("2*3", "10/4"). */
function evalNum(s: string): number | null {
  if (!/^[0-9+\-*/().\s eE]+$/.test(s)) { const n = parseFloat(s); return Number.isNaN(n) ? null : n; }
  try { const v = Function(`"use strict";return (${s})`)(); return typeof v === 'number' && Number.isFinite(v) ? v : null; } catch { return null; }
}

export function Vec3({ v, onChange, step = 0.1, labels = ['X', 'Y', 'Z'] }: { v: [number, number, number]; onChange: (v: [number, number, number]) => void; step?: number; labels?: string[] }) {
  return (
    <div className="vec3">
      {v.map((x, i) => (
        <div key={i} className={'vec-c c' + i}><span>{labels[i]}</span><Num value={x} step={step} onChange={(n) => { const c = [...v] as [number, number, number]; c[i] = n; onChange(c); }} /></div>
      ))}
    </div>
  );
}

export function Color({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return <span className="color"><input type="color" value={value.length === 7 ? value : '#ffffff'} onChange={(e) => onChange(e.target.value)} /><input className="txt mono" value={value} onChange={(e) => onChange(e.target.value)} /></span>;
}

export function Select({ value, options, onChange, labels }: { value: string; options: string[]; onChange: (v: string) => void; labels?: Record<string, string> }) {
  return <select className="sel" value={value} onChange={(e) => onChange(e.target.value)}>{!options.includes(value) && <option>{value}</option>}{options.map((o) => <option key={o} value={o}>{labels?.[o] ?? o}</option>)}</select>;
}

export function Check({ value, onChange, label }: { value: boolean; onChange: (v: boolean) => void; label?: string }) {
  return <label className="chk"><input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />{label}</label>;
}

export function Text({ value, onChange, mono, placeholder }: { value: string; onChange: (v: string) => void; mono?: boolean; placeholder?: string }) {
  return <input className={'txt' + (mono ? ' mono' : '')} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />;
}

export function Slider({ value, min, max, step, onChange }: { value: number; min: number; max: number; step: number; onChange: (v: number) => void }) {
  return <span className="slider"><input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} /><Num value={value} min={min} max={max} step={step} onChange={onChange} width={56} /></span>;
}

export function Modal({ title, children, onClose, wide, footer, tabs }: { title: string; children: React.ReactNode; onClose: () => void; wide?: boolean; footer?: React.ReactNode; /** Page tabs shown in the header beside the title. */ tabs?: React.ReactNode }) {
  return (
    <div className="modal-back" onMouseDown={onClose}>
      <div className={'modal' + (wide ? ' wide' : '')} onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => { if (e.key === 'Escape') onClose(); e.stopPropagation(); }}>
        <div className="modal-head"><b>{title}</b>{tabs && <div className="tabs modal-tabs" style={{ marginLeft: 18, display: 'flex', gap: 4 }}>{tabs}</div>}<span style={{ flex: 1 }} /><button className="x" onClick={onClose}>✕</button></div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function confirmDialog(message: string) { return window.confirm(message); }
