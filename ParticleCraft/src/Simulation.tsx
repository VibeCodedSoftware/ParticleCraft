// Simulation Mode: run, tweak and save physics simulations; bake them to game-ready flipbooks or convert them to a
// real-time particle approximation. Simulations themselves never run inside the games.
import React, { useEffect, useRef, useState } from 'react';
import { Icon } from '@shared/ui/icons';
import { newAsset, VFX_PRESETS, type VfxAsset } from '@shared/src/vfx/vfx';
import { newId } from '@shared/src/schema';
import { SIM_TYPES, bakeFlipbook, defaultsOf, type Simulation } from './sim/sims';
import { pc, usePC } from './store';

export function newSimDoc(typeId: string): VfxAsset {
  const t = SIM_TYPES.find((s) => s.id === typeId) ?? SIM_TYPES[0];
  const a = newAsset(t.name + ' simulation', { systems: [], params: [] }, 'Simulations');
  a.kind = 'simulation'; a.graph = undefined; a.simulation = { type: t.id, params: defaultsOf(t) };
  return a;
}

export function SimulationView() {
  const doc = usePC((s) => s.doc)!;
  const sim = doc.simulation!;
  const type = SIM_TYPES.find((s) => s.id === sim.type) ?? SIM_TYPES[0];
  const params = { ...defaultsOf(type), ...(sim.params as Record<string, number>) };
  const canvas = useRef<HTMLCanvasElement>(null);
  const run = useRef<Simulation | null>(null);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [resetKey, setResetKey] = useState(0);
  const [bake, setBake] = useState({ frames: 16, size: 128, fps: 12, warmup: 2 });
  const [baking, setBaking] = useState(false);
  const view = useRef({ yaw: 0.5, pitch: 0.15 });
  const st = useRef({ playing, speed }); st.current = { playing, speed };
  const paramsRef = useRef(params); paramsRef.current = params;

  // Structural parameters (counts, grid) need a restart; others apply live because solvers read the shared object.
  const live = useRef<Record<string, number>>({ ...params });
  useEffect(() => { Object.assign(live.current, params); }, [JSON.stringify(params)]);
  useEffect(() => { live.current = { ...paramsRef.current }; run.current = type.create(live.current); }, [type.id, resetKey]);

  useEffect(() => {
    let raf = 0, acc = 0, last = performance.now();
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const now = performance.now(); const dt = Math.min(0.05, (now - last) / 1000); last = now;
      const c = canvas.current; if (!c || !run.current) return;
      const r = c.getBoundingClientRect();
      if (c.width !== Math.round(r.width) || c.height !== Math.round(r.height)) { c.width = Math.max(1, Math.round(r.width)); c.height = Math.max(1, Math.round(r.height)); }
      if (st.current.playing) { acc += dt * st.current.speed; let k = 0; while (acc >= 1 / 60 && k++ < 4) { run.current.step(1 / 60); acc -= 1 / 60; } }
      run.current.draw(c.getContext('2d')!, c.width, c.height, false, view.current);
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, []);

  const setParam = (k: string, v: number) => pc.mutate((d) => { d.simulation!.params[k] = v; });
  const restartKeys = ['count', 'particles', 'debris', 'cols', 'rows', 'height'];

  const doBake = async () => {
    setBaking(true);
    await new Promise((r) => setTimeout(r, 30));
    try {
      const fb = bakeFlipbook(type, params, { ...bake, view: view.current });
      const a = newAsset(`${doc.name.replace(/ simulation$/i, '')} (baked)`, { systems: [], params: [] }, 'Baked');
      a.kind = 'baked'; a.graph = undefined; a.flipbook = fb; a.simulation = { ...sim };
      a.description = `${bake.frames} frames of the ${type.name} simulation at ${bake.size}px, ${bake.fps} fps.`;
      a.compatibility = { gamecraft: ['Plays as an animated sprite (billboard), not as 3D volume'], logiccraft: [] };
      pc.open(a); await pc.save();
      pc.set({ status: `Baked ${bake.frames} frames. Export it to use it in GameCraft or LogicCraft.` });
    } finally { setBaking(false); }
  };
  const toRealtime = () => {
    const pre = VFX_PRESETS.find((p) => p.id === type.approx?.preset);
    if (!pre) return;
    const g = pre.build();
    // Carry the obvious settings over (wind, swirl strength) so the approximation matches the look.
    for (const s of g.systems) for (const b of [...s.contexts.update]) {
      if (b.type === 'vortex' && params.swirl) b.props.strength = Math.round(params.swirl * 0.65 * 10) / 10;
      if (b.type === 'force' && params.wind) b.props.force = [params.wind * 2, 0, 0];
    }
    if (params.wind && type.id !== 'wind') for (const s of g.systems) if (!s.contexts.update.some((b) => b.type === 'force')) s.contexts.update.push({ id: newId('vb'), type: 'force', enabled: true, props: { force: [params.wind * 2, 0, 0] } });
    const a = newAsset(`${type.name} (real-time)`, g, pre.category);
    a.description = `Real-time particle approximation of the ${type.name} simulation (${type.approx!.note}).`;
    pc.open(a);
    pc.set({ mode: 'vfx', status: 'Opened a real-time approximation as an editable VFX graph.' });
  };

  return (
    <div className="sim">
      <div className="sim-types">
        <div className="lib-head">Simulations</div>
        {SIM_TYPES.map((t) => (
          <button key={t.id} className={'sim-type' + (t.id === type.id ? ' on' : '')} onClick={() => pc.mutate((d) => { d.simulation = { type: t.id, params: defaultsOf(t) }; if (/simulation$/i.test(d.name)) d.name = t.name + ' simulation'; })}>
            <span className="emo"><Icon name={t.icon} size={22} /></span><span><b>{t.name}</b><small>{t.description}</small></span>
          </button>
        ))}
        <div className="sim-note">Simulations run here only. To use one in a game, <b>bake</b> it to a flipbook or convert it to a <b>real-time</b> particle effect.</div>
      </div>
      <div className="sim-view">
        <canvas ref={canvas} className="sim-canvas"
          onPointerDown={(e) => { const r = (e.target as HTMLElement).getBoundingClientRect(); const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height; if (type.view3d) { (e.target as HTMLElement).setPointerCapture(e.pointerId); (e.target as any)._d = { x: e.clientX, y: e.clientY, ...view.current }; } else run.current?.poke?.(x, y); }}
          onPointerMove={(e) => { const d = (e.target as any)._d; if (d && e.buttons) view.current = { yaw: d.yaw + (e.clientX - d.x) * 0.008, pitch: Math.max(-0.6, Math.min(1.2, d.pitch + (e.clientY - d.y) * 0.005)) }; }}
          onPointerUp={(e) => { (e.target as any)._d = null; }} />
        <div className="pv-bar">
          <button onClick={() => setPlaying(!playing)}><Icon name={playing ? 'pause' : 'play'} size={13} /></button>
          <button onClick={() => run.current?.step(1 / 60)} title="Step one frame"><Icon name="skip-forward" size={13} /></button>
          <button onClick={() => setResetKey((k) => k + 1)} title="Reset">⟲</button>
          <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>{[0.25, 0.5, 1, 2].map((s) => <option key={s} value={s}>{s}×</option>)}</select>
          <span className="pv-stats"><Icon name={type.icon} size={12} /> {type.name} · {type.view3d ? 'drag to orbit' : 'click to interact'}</span>
        </div>
      </div>
      <div className="sim-side">
        <div className="vx-form">
          <h4>{type.name} settings</h4>
          {type.params.map((p) => (
            <label key={p.key}>{p.label}{restartKeys.includes(p.key) && <em className="sim-restart" title="Applies after Reset">⟲</em>}
              <span className="vx-num"><input type="range" min={p.min} max={p.max} step={p.step} value={params[p.key]} onChange={(e) => setParam(p.key, Number(e.target.value))} /><input type="number" step={p.step} value={params[p.key]} onChange={(e) => setParam(p.key, Number(e.target.value))} /></span>
            </label>
          ))}
          <div className="vx-row"><button onClick={() => pc.mutate((d) => { d.simulation!.params = defaultsOf(type); })}>Defaults</button><button onClick={() => setResetKey((k) => k + 1)}>Reset sim</button><button className="primary" onClick={() => pc.save()}>Save setup</button></div>
        </div>
        <div className="vx-form">
          <h4>Make it game-ready</h4>
          <p className="vx-doc"><b>Bake flipbook</b>: records the simulation into a sprite sheet that GameCraft and LogicCraft play as an animated sprite.</p>
          <label>Frames<input type="number" min={4} max={64} value={bake.frames} onChange={(e) => setBake({ ...bake, frames: Math.max(2, Math.min(64, Number(e.target.value))) })} /></label>
          <label>Frame size (px)<select value={bake.size} onChange={(e) => setBake({ ...bake, size: Number(e.target.value) })}>{[64, 96, 128, 192, 256].map((s) => <option key={s}>{s}</option>)}</select></label>
          <label>Frames per second<input type="number" min={4} max={30} value={bake.fps} onChange={(e) => setBake({ ...bake, fps: Math.max(1, Math.min(60, Number(e.target.value))) })} /></label>
          <label>Warm-up (s)<input type="number" min={0} max={10} step={0.5} value={bake.warmup} onChange={(e) => setBake({ ...bake, warmup: Number(e.target.value) })} /></label>
          <button className="primary" disabled={baking} onClick={doBake}>{baking ? 'Baking…' : <><Icon name="film" size={13} /> Bake flipbook</>}</button>
          {type.approx && <>
            <p className="vx-doc"><b>Real-time approximation</b>: opens an editable particle effect ({type.approx.note}) that runs live in the games. It looks similar but is not the same simulation.</p>
            <button onClick={toRealtime}><Icon name="sparkles" size={13} /> Convert to real-time effect</button>
          </>}
        </div>
      </div>
    </div>
  );
}

/** A baked flipbook: plays the sprite sheet. */
export function BakedView() {
  const doc = usePC((s) => s.doc)!;
  const fb = doc.flipbook!;
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const img = new Image(); img.src = fb.image;
    let raf = 0; const t0 = performance.now();
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const c = canvas.current; if (!c || !img.complete) return;
      const ctx = c.getContext('2d')!;
      const fw = img.naturalWidth / fb.frames, f = Math.floor(((performance.now() - t0) / 1000) * fb.fps) % fb.frames;
      ctx.fillStyle = '#0d0f14'; ctx.fillRect(0, 0, c.width, c.height);
      const s = Math.min(c.width, c.height) * 0.8;
      ctx.drawImage(img, f * fw, 0, fw, img.naturalHeight, (c.width - s) / 2, (c.height - s) / 2, s, s);
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, [fb.image]);
  return (
    <div className="baked">
      <canvas ref={canvas} width={520} height={520} className="baked-canvas" />
      <div className="vx-form">
        <h4>{doc.name}</h4>
        <p className="vx-doc">Baked flipbook · {fb.frames} frames · {fb.width / fb.frames}×{fb.height}px · {fb.fps} fps. {doc.description}</p>
        <img src={fb.image} className="baked-strip" alt="sprite sheet" />
        <p className="vx-doc">Export it, then in GameCraft or LogicCraft choose <b>Import from ParticleCraft</b>: it arrives as an animated sprite.</p>
      </div>
    </div>
  );
}
