// Material preview (Material node inspector): one particle of the system drawn large with the real renderer, lit by a
// light that orbits it, at a chosen moment of its life — so lighting, normal/height maps, rim, emission, dissolve and
// flipbook frames can be judged before playing the whole effect. Also the saved-materials library.
import React, { useEffect, useRef, useState } from 'react';
import { Emitter, type EmitterParams } from '@shared/src/runtime/particles';
import { ParticleRenderer } from './render/gl';
import { api, pc } from './store';

export function MaterialPreview({ params }: { params: EmitterParams }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [life, setLife] = useState(0.35);
  const [bg, setBg] = useState<'dark' | 'checker' | 'light'>('dark');
  const [spin, setSpin] = useState(true);
  const st = useRef({ params, life, bg, spin });
  st.current = { params, life, bg, spin };
  useEffect(() => {
    const c = canvas.current!;
    const R = ParticleRenderer.create(c);
    if (!R) return;
    const back = document.createElement('canvas'); back.width = c.width; back.height = c.height;
    let raf = 0; const t0 = performance.now();
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const s = st.current, p = s.params;
      const lifeS = 10;
      const preview: Partial<EmitterParams> = { ...p, rate: 0, burst: 1, speed: 0, speedVar: 0, spread: 0, lifetime: lifeS, lifetimeVar: 0, sizeVar: 0, shape: 'point', offset: undefined, emitterRotation: undefined, emitterScale: undefined, forces: undefined, colliders: undefined, killVolumes: undefined, subEmitters: undefined, delay: 0, prewarm: 0, gravity: 0, acceleration: [0, 0, 0], rotation: 0, rotationSpeed: 0, rotationVar: undefined, spinVar: undefined, randomColors: undefined, meshColors: undefined, maxParticles: 1, renderer: p.renderer === 'ribbon' || p.renderer === 'trail' || p.renderer === 'point' || p.renderer === 'stretched' ? 'billboard' : p.renderer, softness: 0, flipbook: p.flipbook ? { ...p.flipbook, randomStart: false, speedVar: 0 } : undefined };
      const a = ((performance.now() - t0) / 1000) * (s.spin ? 0.9 : 0);
      preview.lightDir = [Math.cos(a) * 0.8, 0.6, Math.sin(a) * 0.8 + 0.3];
      const e = new Emitter('mp', preview);
      e.update(0.0001);
      if (!e.count) return;
      e.px[0] = e.py[0] = e.pz[0] = 0; e.vx[0] = e.vy[0] = e.vz[0] = 0; e.age[0] = lifeS * Math.min(0.999, s.life); e.rot[0] = 0;
      const size = Math.max(0.01, e.sizeAt(0)) * (p.glow ? Math.max(1, (p.glowSize ?? 2.5) * 0.6) : 1);
      const g = back.getContext('2d')!;
      if (s.bg === 'checker') { g.fillStyle = '#2a2d33'; g.fillRect(0, 0, back.width, back.height); g.fillStyle = '#383c44'; for (let y = 0; y < back.height; y += 10) for (let x = (y / 10) % 2 ? 10 : 0; x < back.width; x += 20) g.fillRect(x, y, 10, 10); }
      else { g.fillStyle = s.bg === 'light' ? '#d9dde4' : '#0d0f14'; g.fillRect(0, 0, back.width, back.height); }
      const horiz = p.renderer === 'horizontal';
      R.render([e], { persp: false, yaw: 0, pitch: horiz ? Math.PI / 2 - 0.25 : 0, dist: 5, target: [0, 0, 0], f: 1, ppu: (Math.min(c.width, c.height) * 0.8) / size, viewC: [0, 0], anchor: [c.width / 2, c.height / 2], width: c.width, height: c.height }, { background: back, bloom: 0.4, time: (performance.now() - t0) / 1000 });
    };
    loop();
    return () => { cancelAnimationFrame(raf); R.dispose(); };
  }, []);
  return (
    <div className="mp">
      <canvas ref={canvas} width={220} height={160} className="mp-canvas" />
      <div className="ce-row">
        <span className="vx-doc">Life</span><input type="range" min={0} max={1} step={0.01} value={life} onChange={(e) => setLife(Number(e.target.value))} title="Moment of the particle's life shown" />
        <select value={bg} onChange={(e) => setBg(e.target.value as any)}><option value="dark">Dark</option><option value="checker">Checker</option><option value="light">Light</option></select>
        <button className={spin ? 'on' : ''} onClick={() => setSpin(!spin)} title="Orbit the light">Light</button>
      </div>
    </div>
  );
}

const MAT_DOC = '_materials';
/** Saved materials: store this Material node's settings by name and apply them to any Material node. */
export function MaterialLibrary({ props, onApply }: { props: Record<string, any>; onApply: (p: Record<string, any>) => void }) {
  const [items, setItems] = useState<{ name: string; props: Record<string, any> }[]>([]);
  useEffect(() => { api.getDoc<{ items: { name: string; props: Record<string, any> }[] }>(MAT_DOC, { items: [] }).then((d) => setItems(d.items ?? [])); }, []);
  const save = async () => {
    const name = window.prompt('Save this material as'); if (!name) return;
    const next = [...items.filter((x) => x.name !== name), { name, props: JSON.parse(JSON.stringify(props)) }];
    setItems(next); await api.putDoc(MAT_DOC, { id: MAT_DOC, name: 'Materials', items: next });
    pc.set({ status: `Saved material "${name}"` });
  };
  return (
    <div className="ce-row">
      <select value="" onChange={(e) => { const m = items.find((x) => x.name === e.target.value); if (m) onApply(JSON.parse(JSON.stringify(m.props))); }}>
        <option value="">{items.length ? 'Saved materials…' : 'No saved materials'}</option>{items.map((m) => <option key={m.name}>{m.name}</option>)}
      </select>
      <button onClick={save} title="Reuse these settings on other systems and effects">Save material</button>
    </div>
  );
}
