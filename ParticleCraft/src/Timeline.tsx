// Timeline (sequence editor): one track per system. The solid bar is when the system emits (start delay → end of its
// duration; looping systems run to the end), the faded tail is how long its last particles live. Drag a bar to move
// the system in time, drag a one-shot's right edge to change its duration. The playhead follows the preview; click or
// drag the ruler to scrub (the effect is re-simulated, so scrubbing backwards is exact).
import React, { useRef, useState, useSyncExternalStore } from 'react';
import type { EmitterParams } from '@shared/src/runtime/particles';
import type { VfxGraph, VfxSystem } from '@shared/src/vfx/vfx';
import { previewBus } from './Preview';

const NAME_W = 130, ROW = 22;

export function Timeline({ graph, layers, onChange, onSelect, selected }: {
  graph: VfxGraph; layers: { name: string; params: EmitterParams }[]; selected?: string;
  onChange: (fn: (g: VfxGraph) => void) => void; onSelect: (sysId: string) => void;
}) {
  const t = useSyncExternalStore((f) => { previewBus.subs.add(f); return () => previewBus.subs.delete(f); }, () => previewBus.t);
  const area = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: string; kind: 'move' | 'end'; x0: number; v0: number } | null>(null);
  const [live, setLive] = useState<{ id: string; kind: 'move' | 'end'; v: number } | null>(null);
  const enabled = graph.systems.filter((s) => s.enabled);
  const paramsOf = (s: VfxSystem) => { const i = enabled.indexOf(s); return i >= 0 ? layers[i]?.params : undefined; };
  let length = previewBus.length;
  for (const s of graph.systems) { const p = paramsOf(s); if (p) length = Math.max(length, (p.delay ?? 0) + (p.looping ? 0 : p.duration / (p.timeScale ?? 1)) + (p.lifetime + p.lifetimeVar) / (p.timeScale ?? 1)); }
  length = Math.min(60, Math.max(1, length));
  const width = () => Math.max(50, (area.current?.clientWidth ?? 400) - NAME_W - 8);
  const X = (sec: number) => (sec / length) * 100;
  const secOf = (clientX: number) => { const r = area.current!.getBoundingClientRect(); return Math.max(0, Math.min(length, ((clientX - r.left - NAME_W) / width()) * length)); };
  const ticks = length <= 2 ? 0.25 : length <= 6 ? 0.5 : length <= 15 ? 1 : 5;
  const scrub = (e: React.PointerEvent) => previewBus.seek?.(Math.round(secOf(e.clientX) * 60) / 60);
  return (
    <div className="tl2" ref={area}
      onPointerMove={(e) => {
        const d = drag.current; if (!d) return;
        const dt = ((e.clientX - d.x0) / width()) * length, v = Math.max(0, Math.round((d.v0 + dt) * 20) / 20);
        setLive({ id: d.id, kind: d.kind, v });
      }}
      onPointerUp={() => {
        const l = live; drag.current = null; setLive(null); if (!l) return;
        onChange((g) => {
          const s = g.systems.find((x) => x.id === l.id); if (!s) return;
          if (l.kind === 'move') s.timing = { delay: l.v, timeScale: s.timing?.timeScale ?? 1 };
          else { const b = s.contexts.spawn.find((x) => x.type === 'duration'); if (b) b.props.duration = Math.max(0.01, l.v); }
        });
      }}>
      <div className="tl2-ruler" onPointerDown={(e) => { (e.target as Element).setPointerCapture?.(e.pointerId); scrub(e); }} onPointerMove={(e) => { if (e.buttons) scrub(e); }}>
        <span className="tl2-name">Timeline · {length.toFixed(1)} s</span>
        <div className="tl2-track">
          {Array.from({ length: Math.floor(length / ticks) + 1 }, (_, k) => <span key={k} className="tl2-tick" style={{ left: X(k * ticks) + '%' }}>{+(k * ticks).toFixed(2)}</span>)}
        </div>
      </div>
      <div className="tl2-rows">
        {graph.systems.map((s) => {
          const p = paramsOf(s);
          const delay = live?.id === s.id && live.kind === 'move' ? live.v : s.timing?.delay ?? 0, ts = p?.timeScale ?? 1;
          const dur = live?.id === s.id && live.kind === 'end' ? live.v : p?.duration ?? 0;
          const end = p ? (p.looping ? length : delay + dur / ts) : delay;
          const tail = p ? end + (p.lifetime + p.lifetimeVar) / ts : end;
          const durBlock = s.contexts.spawn.find((b) => b.type === 'duration' && b.enabled);
          const subOnly = p && p.rate <= 0 && p.burst <= 0 && !p.bursts?.length;
          return (
            <div key={s.id} className={'tl2-row' + (selected === s.id ? ' sel' : '') + (s.enabled ? '' : ' off')} style={{ height: ROW }}>
              <span className="tl2-name" onClick={() => onSelect(s.id)} title={s.name}><i style={{ background: s.color ?? '#5b8def' }} />{s.name}</span>
              <div className="tl2-track">
                {p && !subOnly && <>
                  <span className="tl2-tail" style={{ left: X(end) + '%', width: Math.max(0, X(Math.min(length, tail) - end)) + '%' }} />
                  <span className={'tl2-bar' + (p.looping ? ' loop' : '')} style={{ left: X(delay) + '%', width: Math.max(0.5, X(Math.min(length, end) - delay)) + '%', background: s.color ?? '#5b8def' }}
                    title={`${s.name}: starts at ${delay.toFixed(2)} s${p.looping ? ', loops' : `, emits for ${(p.duration / ts).toFixed(2)} s`} — drag to move`}
                    onPointerDown={(e) => { e.stopPropagation(); (e.target as Element).setPointerCapture?.(e.pointerId); onSelect(s.id); drag.current = { id: s.id, kind: 'move', x0: e.clientX, v0: delay }; }}>
                    {!p.looping && durBlock && <span className="tl2-handle" title="Drag to change the duration" onPointerDown={(e) => { e.stopPropagation(); (e.target as Element).setPointerCapture?.(e.pointerId); drag.current = { id: s.id, kind: 'end', x0: e.clientX, v0: Number(durBlock.props.duration) }; }} />}
                  </span>
                </>}
                {subOnly && <span className="tl2-sub" title="Spawned by another system's sub-emitter events">event-driven</span>}
                {!s.enabled && <span className="tl2-sub">disabled</span>}
              </div>
            </div>
          );
        })}
      </div>
      <span className="tl2-playhead" style={{ left: `calc(${NAME_W}px + (100% - ${NAME_W + 8}px) * ${Math.min(1, t / length)})` }} />
    </div>
  );
}
