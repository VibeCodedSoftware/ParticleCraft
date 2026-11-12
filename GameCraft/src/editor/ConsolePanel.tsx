// Console with errors linked to blocks, plus a live debugger: variables, instance inspection, stats.
import React, { useEffect, useRef, useState } from 'react';
import { store, useStore } from '../project/store';
import { editorRefs } from './session';
import { perfWarnings } from '../engine/profiler';

export function ConsolePanel() {
  const logs = useStore((s) => s.logs);
  const [filter, setFilter] = useState<'all' | 'error' | 'warn' | 'info'>('all');
  const shown = logs.filter((l) => filter === 'all' || l.level === filter);
  const ref = React.useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.scrollTo(0, 1e9); }, [logs.length]);
  return (
    <div className="console">
      <div className="panel-tools">
        <div className="seg">{(['all', 'error', 'warn', 'info'] as const).map((f) => <button key={f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>{f} {f !== 'all' && `(${logs.filter((l) => l.level === f).length})`}</button>)}</div>
        <button className="btn small" onClick={() => store.set({ logs: [] })}>Clear</button>
      </div>
      <div className="con-list" ref={ref}>
        {shown.map((l, i) => (
          <div key={i} className={'con ' + l.level} onClick={() => l.blockId && store.set({ focusBlockId: l.blockId, bottomTab: 'Event sheet' })} title={l.blockId ? 'Click to show the block' : ''}>
            <span className="con-t">{new Date(l.time).toLocaleTimeString()}</span>{l.message}{l.blockId && <span className="con-link"> → block</span>}
          </div>
        ))}
        {!shown.length && <div className="hint">No messages. "Log to console" blocks and runtime errors appear here.</div>}
      </div>
    </div>
  );
}

export function DebugPanel() {
  const playing = useStore((s) => s.play);
  const [, tick] = useState(0);
  const [watch, setWatch] = useState<number | null>(null);
  useEffect(() => { if (playing === 'edit') return; const id = setInterval(() => tick((n) => n + 1), 250); return () => clearInterval(id); }, [playing]);
  const rt = editorRefs.session?.rt;
  if (!rt) return <div className="hint pad">Press Play to inspect variables, objects and performance live. Right-click an event › Toggle breakpoint to pause there.</div>;
  const info = rt.inspect();
  const inst = watch != null ? rt.world.byUid.get(watch) : null;
  return (
    <div className="debug">
      <div className="dbg-col">
        <h4>Runtime</h4>
        <div>Time {info.time.toFixed(2)} s · tick {info.tick} · {info.instances} objects · {info.particles} particles · {info.waits} waits · {info.errors} errors</div>
        {rt.pausedAtBreakpoint && <div className="warn">Paused at breakpoint. <button className="btn small" onClick={() => { rt.resumeFromBreakpoint(); store.set({ play: 'play' }); }}>Continue</button></div>}
        {rt.halted && <div className="warn">Halted by the loop safety limit — see Console.</div>}
        <h4>Global variables</h4>
        <table className="vars"><tbody>{Object.entries(info.globals).map(([k, v]) => <tr key={k}><td>{k}</td><td className="mono">{typeof v === 'object' ? JSON.stringify(v).slice(0, 80) : String(typeof v === 'number' ? Math.round(v * 1000) / 1000 : v)}</td></tr>)}</tbody></table>
      </div>
      <div className="dbg-col">
        <h4>Objects</h4>
        <select className="sel small" value={watch ?? ''} onChange={(e) => setWatch(e.target.value ? Number(e.target.value) : null)}>
          <option value="">Inspect an object…</option>
          {rt.world.instances.slice(0, 500).map((i) => <option key={i.uid} value={i.uid}>{i.name} ({i.type} #{i.uid})</option>)}
        </select>
        {inst && <table className="vars"><tbody>
          {[['position', `${inst.x.toFixed(2)}, ${inst.y.toFixed(2)}, ${inst.z.toFixed(2)}`], ['angle', rt.world.angle(inst).toFixed(1)], ['velocity', `${inst.vx.toFixed(2)}, ${inst.vy.toFixed(2)}, ${inst.vz.toFixed(2)}`], ['animation', inst.animation ?? ''],
            ...Object.entries(inst.vars).map(([k, v]) => [k, String(v)]), ...Object.entries(inst.state).filter(([, v]) => v && typeof v === 'object').map(([k, v]) => [k, JSON.stringify(v, (_, x) => (typeof x === 'number' ? Math.round(x * 100) / 100 : x instanceof Set ? [...x] : x)).slice(0, 120)])].map(([k, v]) => <tr key={k}><td>{k}</td><td className="mono">{v}</td></tr>)}
        </tbody></table>}
      </div>
      <PerformanceColumn />
    </div>
  );
}

/** Debug tab › Performance: only what can really be measured here. */
function PerformanceColumn() {
  const view = editorRefs.view, graph = useRef<HTMLCanvasElement>(null);
  const prof = view?.profiler;
  useEffect(() => { if (view?.profiler) view.profiler.detail = true; return () => { if (view?.profiler) view.profiler.detail = false; }; }, [view?.profiler]);
  useEffect(() => {
    const c = graph.current; if (!c || !prof) return;
    const g = c.getContext('2d')!, H = c.height, W = c.width, top = 50; // ms at the top of the graph
    g.clearRect(0, 0, W, H);
    g.fillStyle = 'rgba(255,255,255,.05)'; g.fillRect(0, 0, W, H);
    const line = (ms: number, color: string) => { g.strokeStyle = color; g.beginPath(); const y = H - (ms / top) * H; g.moveTo(0, y); g.lineTo(W, y); g.stroke(); };
    line(16.67, 'rgba(90,220,120,.5)'); line(33.3, 'rgba(240,180,60,.5)');
    const h = prof.history, step = W / 300;
    h.forEach((s, k) => { const v = Math.min(top, s.frameMs); g.fillStyle = s.frameMs > 33.3 ? '#f05050' : s.frameMs > 17.5 ? '#e8b040' : '#5ac878'; g.fillRect(W - (h.length - k) * step, H - (v / top) * H, Math.max(1, step), (v / top) * H); });
  });
  if (!view || !prof) return <div className="dbg-col"><h4>Performance</h4></div>;
  const stats = view.culler.stats, info = view.renderer.info.render, batch = view.batcher.stats;
  const f = prof.figures(view.scene, info.calls, info.triangles);
  const warnings = perfWarnings(f);
  const ms = (v: number) => `${v.toFixed(1)} ms`;
  const rows: [string, string, string?][] = [
    ['Frame rate', `${f.fps} fps (slowest 1%: ${f.lowFps} fps)`],
    ['Frame time', `${ms(f.frameMs)} (worst ${ms(f.worstMs)})`],
    ['Event sheets', ms(f.logicMs), 'Your logic, per drawn frame'],
    ['Movement & physics', ms(f.moveMs), 'Behaviors and collisions'],
    ['Drawing (CPU)', ms(f.drawMs), 'Preparing and submitting the frame'],
    ['Graphics card', f.gpuMs != null ? ms(f.gpuMs) : f.gpuTimer ? 'measuring…' : 'not available here', 'Needs a timer the browser or driver may not offer'],
    ['Draw calls', String(f.calls)],
    ['Instancing', batch.batches ? `${batch.objects} objects share ${batch.batches} batches` : 'nothing to share', 'Project settings › Automatic instancing. Draw calls above is the real count: objects off screen were not being drawn anyway'],
    ['Triangles', f.triangles.toLocaleString()],
    ['Objects', `${stats.objects} (hidden: ${stats.occluded} behind walls, ${stats.distance} far, ${stats.range} out of range; ${stats.lod} LOD)`],
    ['Textures / meshes / shaders', `${f.textures} / ${f.geometries} / ${f.programs}`],
    ...(view.textures?.active ? [['Textures on the card', `about ${(view.textures.stats.bytes / 1048576).toFixed(0)} MB of ${(view.textures.stats.fullBytes / 1048576).toFixed(0)} MB (${view.textures.stats.compressed} compressed${view.textures.stats.waiting ? `, ${view.textures.stats.waiting} waiting` : ''})`, view.textures.stats.unsupported || 'Compressed textures and streaming, Project settings › Textures'] as [string, string, string]] : []),
    ['Script memory', f.heapMb != null ? `${f.heapMb.toFixed(0)} MB` : 'not available here'],
    ['Texture and shadow memory (estimate)', `about ${f.vramMb.toFixed(0)} MB`, 'From the sizes of textures and shadow maps. Browsers do not report real graphics memory'],
  ];
  return <div className="dbg-col">
    <h4>Performance</h4>
    <canvas ref={graph} width={300} height={56} style={{ width: '100%', maxWidth: 300, height: 56, display: 'block' }} title="Frame time, newest on the right. Lines at 60 and 30 frames a second" />
    <table className="vars"><tbody>{rows.map(([k, v, tip]) => <tr key={k} title={tip}><td>{k}</td><td className="mono">{v}</td></tr>)}</tbody></table>
    {warnings.map((w) => <div key={w} className="warn small">{w}</div>)}
  </div>;
}
