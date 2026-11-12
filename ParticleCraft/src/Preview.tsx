// Real-time preview: runs the compiled layers in the SAME particle engine the games use. Draws them with the WebGL2
// hybrid renderer (every system keeps its own renderer/style/blend; all sort together), over a background layer
// with the grid, ground and shape nodes. Orbit camera (3D) or a flat front view (2D, as LogicCraft shows it).
// Playback: play/pause/restart, speed, and a timeline you can scrub (the effect is re-simulated deterministically
// from its seeds, so scrubbing backwards shows exactly the same particles).
import React, { useEffect, useRef, useState } from 'react';
import { Icon } from '@shared/ui/icons';
import { Emitter, linkEmitters, type EmitterParams } from '@shared/src/runtime/particles';
import { drawEmitter2D } from '@shared/ui/particles2d';
import { shapeTriangles, type VfxShape } from '@shared/src/vfx/shapes';
import { ParticleRenderer, type GLCamera } from './render/gl';

export interface Cam { yaw: number; pitch: number; dist: number; tx: number; ty: number }

/** World → screen for the orbit camera. */
export function makeProjector(cam: Cam, w: number, h: number, flat: boolean) {
  const ppu = Math.min(w, h) / (flat ? cam.dist : 9);
  if (flat) return { ppu, project: (x: number, y: number) => ({ x: w / 2 + (x - cam.tx) * ppu, y: h * 0.62 - (y - cam.ty) * ppu, s: 1 }) };
  const cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw), cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
  const f = Math.min(w, h) * 1.1;
  return {
    ppu: f / cam.dist,
    project: (x: number, y: number, z: number) => {
      const X = x - cam.tx, Y = y - cam.ty, Z = z;
      const x1 = X * cy - Z * sy, z1 = X * sy + Z * cy;
      const y2 = Y * cp - z1 * sp, z2 = Y * sp + z1 * cp;
      const d = cam.dist + z2;
      if (d < 0.2) return null;
      const s = cam.dist / d;
      return { x: w / 2 + (x1 * f) / d, y: h * 0.6 - (y2 * f) / d, s };
    },
  };
}
/** The same camera for the WebGL renderer. */
export function glCamera(cam: Cam, w: number, h: number, flat: boolean): GLCamera {
  if (flat) return { persp: false, yaw: 0, pitch: 0, dist: cam.dist, target: [cam.tx, cam.ty, 0], f: 1, ppu: Math.min(w, h) / cam.dist, viewC: [cam.tx, cam.ty], anchor: [w / 2, h * 0.62], width: w, height: h };
  return { persp: true, yaw: cam.yaw, pitch: cam.pitch, dist: cam.dist, target: [cam.tx, cam.ty, 0], f: Math.min(w, h) * 1.1, ppu: 1, viewC: [0, 0], anchor: [w / 2, h * 0.6], width: w, height: h };
}

export function drawGrid(ctx: CanvasRenderingContext2D, proj: ReturnType<typeof makeProjector>, flat: boolean, w: number, light = false) {
  const a = light ? '0,0,0' : '255,255,255';
  ctx.strokeStyle = `rgba(${a},.07)`; ctx.lineWidth = 1;
  if (flat) { const g = proj.project(0, 0, 0)!; ctx.beginPath(); ctx.moveTo(0, g.y); ctx.lineTo(w, g.y); ctx.stroke(); return; }
  for (let k = -5; k <= 5; k++) {
    for (const [p0, p1] of [[[k, 0, -5], [k, 0, 5]], [[-5, 0, k], [5, 0, k]]] as const) {
      const p = proj.project(p0[0], p0[1], p0[2]), q = proj.project(p1[0], p1[1], p1[2]);
      if (!p || !q) continue;
      ctx.strokeStyle = k === 0 ? `rgba(${a},.16)` : `rgba(${a},.06)`;
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke();
    }
  }
}

/** A shaded ground plane (soft particles fade into it). */
function drawGround(ctx: CanvasRenderingContext2D, proj: ReturnType<typeof makeProjector>, light: boolean) {
  const c = [[-6, 0, -6], [6, 0, -6], [6, 0, 6], [-6, 0, 6]].map((p) => proj.project(p[0], p[1], p[2]));
  if (c.some((p) => !p)) return;
  ctx.fillStyle = light ? 'rgba(0,0,0,.08)' : 'rgba(120,140,170,.08)';
  ctx.beginPath(); c.forEach((p, i) => (i ? ctx.lineTo(p!.x, p!.y) : ctx.moveTo(p!.x, p!.y))); ctx.closePath(); ctx.fill();
}

/** Shape nodes drawn flat-shaded (shown originals solid, the selected hidden one as a faint outline). */
export function drawShapes(ctx: CanvasRenderingContext2D, shapes: { shape: VfxShape; ghost: boolean }[], proj: ReturnType<typeof makeProjector>) {
  const faces: { pts: { x: number; y: number }[]; z: number; shade: number; color: string; ghost: boolean }[] = [];
  for (const { shape, ghost } of shapes) {
    const t = shapeTriangles(shape);
    for (let i = 0; i < t.length; i += 9) {
      const p = [proj.project(t[i], t[i + 1], t[i + 2]), proj.project(t[i + 3], t[i + 4], t[i + 5]), proj.project(t[i + 6], t[i + 7], t[i + 8])];
      if (p.some((q) => !q)) continue;
      const ax = t[i + 3] - t[i], ay = t[i + 4] - t[i + 1], az = t[i + 5] - t[i + 2], bx = t[i + 6] - t[i], by = t[i + 7] - t[i + 1], bz = t[i + 8] - t[i + 2];
      const nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx, nl = Math.hypot(nx, ny, nz) || 1;
      const shade = 0.45 + 0.55 * Math.max(0, (nx * 0.4 + ny * 0.8 + nz * 0.45) / nl);
      faces.push({ pts: p as { x: number; y: number }[], z: (p[0]!.s + p[1]!.s + p[2]!.s) / 3, shade, color: shape.color ?? '#8fa3bf', ghost });
    }
  }
  faces.sort((a, b) => a.z - b.z); // far (small scale) first
  for (const f of faces) {
    ctx.beginPath(); ctx.moveTo(f.pts[0].x, f.pts[0].y); ctx.lineTo(f.pts[1].x, f.pts[1].y); ctx.lineTo(f.pts[2].x, f.pts[2].y); ctx.closePath();
    if (f.ghost) { ctx.strokeStyle = 'rgba(120,200,255,.18)'; ctx.lineWidth = 1; ctx.stroke(); continue; }
    const c = parseInt(f.color.slice(1), 16), r = ((c >> 16) & 255) * f.shade, g = ((c >> 8) & 255) * f.shade, b = (c & 255) * f.shade;
    ctx.fillStyle = `rgb(${r | 0},${g | 0},${b | 0})`; ctx.fill(); ctx.strokeStyle = ctx.fillStyle; ctx.lineWidth = 0.5; ctx.stroke();
  }
}

export type PreviewBg = 'dark' | 'light' | 'checker' | 'color';
const BG: Record<Exclude<PreviewBg, 'checker' | 'color'>, string> = { dark: '#0d0f14', light: '#d9dde4' };

function checker(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const s = 12;
  ctx.fillStyle = '#2a2d33'; ctx.fillRect(0, 0, w, h); ctx.fillStyle = '#383c44';
  for (let y = 0; y < h; y += s) for (let x = (y / s) % 2 ? s : 0; x < w; x += s * 2) ctx.fillRect(x, y, s, s);
}

/** How long the timeline is: one-shots end when their last particle can die; looping effects show 5 s. */
export function effectLength(layers: { params: EmitterParams }[]) {
  let t = 0, looping = false;
  for (const l of layers) { const p = l.params; if (p.looping) looping = true; t = Math.max(t, (p.delay ?? 0) + (p.looping ? 0 : p.duration) + p.lifetime + p.lifetimeVar + Math.max(0, ...(p.bursts ?? []).map((b) => b.time + b.cycles * b.interval))); }
  return Math.max(looping ? 5 : 0.5, Math.min(60, t));
}

/** Preview clock shared with the timeline: current time, length, and a way to scrub. */
export const previewBus = { t: 0, length: 5, playing: true, seek: null as null | ((t: number) => void), subs: new Set<() => void>(), emit() { previewBus.subs.forEach((f) => f()); } };

export interface PreviewSettings { bg: PreviewBg; bgColor: string; grid: boolean; ground: boolean; res: number; bloom: number; quality: 'low' | 'medium' | 'high' }
const DEFAULTS: PreviewSettings = { bg: 'dark', bgColor: '#203040', grid: true, ground: false, res: 1, bloom: 0.6, quality: 'high' };

export function Preview({ layers, version, shapes = [], height }: { layers: { name: string; params: EmitterParams }[]; version: number; shapes?: { shape: VfxShape; ghost: boolean }[]; height?: number }) {
  const shapesRef = useRef(shapes);
  shapesRef.current = shapes;
  const canvas = useRef<HTMLCanvasElement>(null);
  const emitters = useRef<Emitter[]>([]);
  const renderer = useRef<ParticleRenderer | null | undefined>(undefined);
  /** WebGL could not start: a fresh canvas is used with the 2D painter. */
  const [glFailed, setGlFailed] = useState(false);
  const glFailedRef = useRef(false);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [flat, setFlat] = useState(false);
  const [moving, setMoving] = useState(false);
  const [stats, setStats] = useState('');
  const [time, setTime] = useState(0);
  const [showSettings, setShowSettings] = useState(false);
  const [set, setSet] = useState<PreviewSettings>(() => { try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem('pc.preview') ?? '{}') }; } catch { return DEFAULTS; } });
  useEffect(() => { try { localStorage.setItem('pc.preview', JSON.stringify(set)); } catch { /* private mode */ } }, [set]);
  const cam = useRef<Cam>({ yaw: 0.6, pitch: 0.3, dist: 5.5, tx: 0, ty: 1 });
  const clock = useRef({ t: 0, scrubTo: -1 });
  const length = effectLength(layers);
  const st = useRef({ playing, speed, flat, moving, set, length });
  st.current = { playing, speed, flat, moving, set, length };
  const layersRef = useRef(layers);
  layersRef.current = layers;

  const make = () => {
    const es = layersRef.current.map((l, i) => { const e = new Emitter('pv' + i, l.params, l.name); e.plane = st.current.flat ? 'xy' : 'xz'; e.qualityScale = st.current.set.quality === 'low' ? 0.35 : st.current.set.quality === 'medium' ? 0.7 : 1; return e; });
    linkEmitters(es);
    return es;
  };
  const rebuild = (keep: boolean) => {
    const old = emitters.current;
    if (keep && old.length === layers.length && old.every((e, i) => e.params.maxParticles === layers[i].params.maxParticles)) {
      old.forEach((e, i) => { e.setParams(layers[i].params); e.plane = flat ? 'xy' : 'xz'; });
      linkEmitters(old);
      return;
    }
    emitters.current = make();
    clock.current.t = 0;
  };
  // Parameter edits update live (no restart); structural changes rebuild.
  useEffect(() => { rebuild(emitters.current.length === layers.length); }, [version, layers]);
  useEffect(() => { rebuild(false); }, [flat, set.quality]);

  /** Re-simulate from the start to time t (deterministic: same seeds → same particles). */
  const seek = (t: number) => {
    const es = make();
    const dt = 1 / 60;
    for (let x = 0; x < t; x += dt) for (const e of es) { e.position = [0, 0, 0]; e.update(dt); }
    emitters.current = es; clock.current.t = t; setTime(t);
    previewBus.t = t; previewBus.emit();
  };
  previewBus.seek = (t: number) => { setPlaying(false); seek(t); };
  previewBus.length = length;
  previewBus.playing = playing;

  useEffect(() => {
    let raf = 0, last = performance.now(), frames = 0, fpsT = performance.now(), simMs = 0;
    const bg = document.createElement('canvas');
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const now = performance.now(); const dt = Math.min(0.05, (now - last) / 1000); last = now;
      const c = canvas.current; if (!c) return;
      const s = st.current;
      const r = c.getBoundingClientRect();
      const W = Math.max(1, Math.round(r.width * s.set.res * (window.devicePixelRatio > 1 && s.set.res >= 1 ? Math.min(2, window.devicePixelRatio) : 1)));
      const H = Math.max(1, Math.round(r.height * (W / Math.max(1, r.width))));
      if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
      if (renderer.current === undefined) {
        renderer.current = glFailedRef.current ? null : ParticleRenderer.create(c);
        if (!renderer.current && !glFailedRef.current) { glFailedRef.current = true; renderer.current = undefined; setGlFailed(true); return; }
      }
      const t0 = performance.now();
      if (s.playing) {
        const step = dt * s.speed;
        clock.current.t += step;
        const tt = clock.current.t;
        for (const e of emitters.current) {
          if (s.moving && !s.flat) e.position = [Math.cos(tt * 1.4) * 2.5, 0.5, Math.sin(tt * 1.4) * 2.5];
          else if (s.moving) e.position = [Math.cos(tt * 1.4) * 2.5, 0.5 + Math.sin(tt * 2.8) * 0.8, 0];
          else e.position = [0, 0, 0];
          e.update(step);
        }
        // One-shot effects replay so you can keep watching them.
        if (emitters.current.length && emitters.current.every((e) => e.params.looping || e.done) && emitters.current.some((e) => !e.params.looping) && clock.current.t > 0.2) {
          for (const e of emitters.current) if (!e.params.looping) { e.count = 0; e.restart(); }
          clock.current.t = 0;
        }
        if (frames % 6 === 0) { const tt2 = clock.current.t % Math.max(0.01, s.length); setTime(tt2); previewBus.t = tt2; previewBus.length = s.length; previewBus.emit(); }
      }
      simMs = simMs * 0.9 + (performance.now() - t0) * 0.1;
      // Background layer.
      if (bg.width !== W || bg.height !== H) { bg.width = W; bg.height = H; }
      const g = bg.getContext('2d')!;
      g.setTransform(1, 0, 0, 1, 0, 0);
      const light = s.set.bg === 'light';
      if (s.set.bg === 'checker') checker(g, W, H);
      else { g.fillStyle = s.set.bg === 'color' ? s.set.bgColor : BG[s.set.bg]; g.fillRect(0, 0, W, H); }
      const proj = makeProjector(cam.current, W, H, s.flat);
      if (s.set.ground && !s.flat) drawGround(g, proj, light);
      if (s.set.grid) drawGrid(g, proj, s.flat, W, light);
      if (shapesRef.current.length) drawShapes(g, shapesRef.current, proj);
      const R = renderer.current;
      let calls = 0;
      if (R) {
        R.render(emitters.current, glCamera(cam.current, W, H, s.flat), { background: bg, bloom: s.set.quality === 'low' ? 0 : s.set.bloom, ground: 0, time: clock.current.t });
        calls = R.stats.drawCalls;
      } else {
        // 2D fallback (no WebGL2): the shared canvas painter.
        const ctx = c.getContext('2d');
        if (!ctx) return;
        ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(bg, 0, 0);
        for (const e of emitters.current) drawEmitter2D(ctx, e, (x, y, z) => proj.project(x, y, z), proj.ppu);
      }
      frames++;
      if (now - fpsT > 500) {
        const n = emitters.current.reduce((a, e) => a + e.count, 0);
        setStats(`${n} particles · ${Math.round((frames * 1000) / (now - fpsT))} fps · sim ${simMs.toFixed(1)} ms${R ? ` · ${calls} draws` : ' · 2D'}`);
        frames = 0; fpsT = now;
      }
    };
    loop();
    return () => { cancelAnimationFrame(raf); renderer.current?.dispose(); renderer.current = undefined; };
  }, []);

  const drag = useRef<{ x: number; y: number; yaw: number; pitch: number; pan: boolean; tx: number; ty: number } | null>(null);
  const up = (p: Partial<PreviewSettings>) => setSet((x) => ({ ...x, ...p }));
  return (
    <div className="pv" style={height ? { height } : undefined}>
      <canvas key={glFailed ? '2d' : 'gl'} ref={canvas} className="pv-canvas"
        onPointerDown={(e) => { (e.target as HTMLElement).setPointerCapture(e.pointerId); drag.current = { x: e.clientX, y: e.clientY, yaw: cam.current.yaw, pitch: cam.current.pitch, pan: e.button !== 0 || e.shiftKey, tx: cam.current.tx, ty: cam.current.ty }; }}
        onPointerMove={(e) => { const d = drag.current; if (!d) return; if (d.pan) { cam.current.tx = d.tx - (e.clientX - d.x) * 0.01; cam.current.ty = d.ty + (e.clientY - d.y) * 0.01; } else { cam.current.yaw = d.yaw + (e.clientX - d.x) * 0.008; cam.current.pitch = Math.max(-1.4, Math.min(1.4, d.pitch + (e.clientY - d.y) * 0.006)); } }}
        onPointerUp={() => { drag.current = null; }}
        onWheel={(e) => { cam.current.dist = Math.max(1, Math.min(80, cam.current.dist * (e.deltaY > 0 ? 1.1 : 0.9))); }}
        onDoubleClick={() => { cam.current = { yaw: 0.6, pitch: 0.3, dist: 5.5, tx: 0, ty: 1 }; }}
        onContextMenu={(e) => e.preventDefault()} />
      <div className="pv-bar">
        <button onClick={() => setPlaying(!playing)} title="Play / pause"><Icon name={playing ? 'pause' : 'play'} size={13} /></button>
        <button onClick={() => { emitters.current = make(); clock.current.t = 0; setTime(0); }} title="Restart"><Icon name="refresh-cw" size={12} /></button>
        <input className="pv-scrub" type="range" min={0} max={length} step={1 / 60} value={Math.min(time, length)} title={`Timeline: ${time.toFixed(2)} s of ${length.toFixed(1)} s — drag to scrub (forwards and backwards)`}
          onChange={(e) => { setPlaying(false); seek(Number(e.target.value)); }} />
        <span className="pv-time">{time.toFixed(2)}s</span>
        <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))} title="Playback speed">{[0.1, 0.25, 0.5, 1, 2, 4].map((s) => <option key={s} value={s}>{s}×</option>)}</select>
        <button className={flat ? 'on' : ''} onClick={() => setFlat(!flat)} title="2D front view, as LogicCraft shows it">{flat ? '2D' : '3D'}</button>
        <button className={moving ? 'on' : ''} onClick={() => setMoving(!moving)} title="Move the emitter (see trails and local space)"><Icon name="move" size={12} /></button>
        <button className={showSettings ? 'on' : ''} onClick={() => setShowSettings(!showSettings)} title="Preview settings: background, grid, ground, resolution, quality, bloom"><Icon name="settings" size={12} /></button>
      </div>
      <span className="pv-stats">{stats}</span>
      {showSettings && (
        <div className="pv-settings" onPointerDown={(e) => e.stopPropagation()}>
          <label>Background<select value={set.bg} onChange={(e) => up({ bg: e.target.value as PreviewBg })}><option value="dark">Dark</option><option value="light">Light</option><option value="checker">Transparent (checker)</option><option value="color">Colour</option></select></label>
          {set.bg === 'color' && <label>Colour<input type="color" value={set.bgColor} onChange={(e) => up({ bgColor: e.target.value })} /></label>}
          <label className="chk"><input type="checkbox" checked={set.grid} onChange={(e) => up({ grid: e.target.checked })} /> Grid</label>
          <label className="chk"><input type="checkbox" checked={set.ground} onChange={(e) => up({ ground: e.target.checked })} /> Ground plane</label>
          <label>Resolution<select value={set.res} onChange={(e) => up({ res: Number(e.target.value) })}><option value={0.5}>50%</option><option value={0.75}>75%</option><option value={1}>100%</option></select></label>
          <label title="Low: fewer particles (35%) and no bloom">Quality<select value={set.quality} onChange={(e) => up({ quality: e.target.value as PreviewSettings['quality'] })}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></label>
          <label>Bloom<input type="range" min={0} max={2} step={0.05} value={set.bloom} onChange={(e) => up({ bloom: Number(e.target.value) })} /></label>
          <span className="vx-doc">Drag: orbit · Shift/right-drag: pan · Wheel: zoom · Double-click: reset view</span>
        </div>
      )}
    </div>
  );
}
