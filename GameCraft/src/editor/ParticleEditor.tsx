// Particle editor with live preview (the selected emitter keeps simulating in the viewport) and presets.
import React from 'react';
import { DEFAULT_EMITTER, PARTICLE_PRESETS, type EmitterParams } from '@shared/src/runtime/particles';
import { store, useStore } from '../project/store';
import { curScene, addObject } from './actions';
import { Check, Color, Num, Row, Section, Select, Slider, Vec3 } from './ui';
import { VfxImportDialog } from '@shared/ui/VfxImport';
import { particlePictureData } from '@shared/src/vfx/particlePicture';
import { api } from '../project/api';
import { importVfx } from './vfxImport';

const NUMS: [keyof EmitterParams, string, number, number, number][] = [
  ['rate', 'Emission rate (/s)', 0, 1000, 1], ['burst', 'Burst count', 0, 500, 1], ['lifetime', 'Lifetime (s)', 0.02, 10, 0.05], ['lifetimeVar', 'Lifetime random', 0, 5, 0.05],
  ['speed', 'Initial speed', 0, 50, 0.1], ['speedVar', 'Speed random', 0, 20, 0.1], ['spread', 'Spread (°)', 0, 180, 1], ['gravity', 'Gravity', -40, 40, 0.5],
  ['drag', 'Drag', 0, 5, 0.05], ['sizeStart', 'Size start', 0, 5, 0.01], ['sizeEnd', 'Size end', 0, 5, 0.01], ['sizeVar', 'Size random', 0, 2, 0.01],
  ['alphaStart', 'Alpha start', 0, 1, 0.01], ['alphaEnd', 'Alpha end', 0, 1, 0.01], ['rotation', 'Rotation (°)', 0, 360, 1], ['rotationSpeed', 'Rotation speed', 0, 1000, 5],
  ['maxParticles', 'Max particles', 1, 5000, 1], ['duration', 'Duration (non-loop)', 0.01, 20, 0.05], ['seed', 'Random seed', 0, 9999, 1],
];

function ParticlePicture({ value, onChange }: { value?: string; onChange: (v: string | undefined) => void }) {
  return <span className="pair">
    {value && <img src={value} alt="" style={{ width: 22, height: 22, objectFit: 'contain', background: '#111' }} />}
    <label className="btn small">{value ? 'Change…' : 'Import…'}<input type="file" accept="image/*" hidden onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onChange(await particlePictureData(f)); }} /></label>
    {value && <button className="btn small" onClick={() => onChange(undefined)}>Remove</button>}
  </span>;
}

export function ParticleEditor() {
  const project = useStore((s) => s.project);
  const selection = useStore((s) => s.selection);
  const [importing, setImporting] = React.useState(false);
  useStore((s) => s.rev);
  if (!project) return null;
  const importBtn = (
    <>
      <button className="btn small" title="Effects made in ParticleCraft (real-time or baked flipbooks)" onClick={() => setImporting(true)}>⇩ Import from ParticleCraft</button>
      {importing && <VfxImportDialog app="gamecraft" list={() => api.exchangeList()} get={(n) => api.exchangeGet(n)} onImport={importVfx} onClose={() => setImporting(false)} />}
    </>
  );
  const scene = curScene(project);
  const em = scene.instances.find((i) => i.uid === selection[selection.length - 1] && i.kind === 'emitter');
  if (!em?.emitter) {
    return <div className="hint pad">{importBtn}<br /><br />Select a particle emitter to edit it live, or <button className="btn small" onClick={() => addObject('emitter', 'Emitter', { y: 1 })}>add an emitter</button>. Emitters preview continuously in the viewport. Logic blocks in the Particles category spawn presets, burst, start/stop and change any property at runtime.<br /><br />Presets: {Object.values(PARTICLE_PRESETS).map((p) => p.name).join(', ')}.</div>;
  }
  const base = { ...DEFAULT_EMITTER, ...(PARTICLE_PRESETS[em.emitter.preset]?.params ?? {}), ...(project.particlePresets[em.emitter.preset] ?? {}) };
  const p: EmitterParams = { ...base, ...em.emitter.params } as EmitterParams;
  const set = (patch: Partial<EmitterParams>, key?: string) => store.mutate('Particles', (pp) => { const i = curScene(pp).instances.find((x) => x.uid === em.uid); if (i?.emitter) i.emitter.params = { ...i.emitter.params, ...patch }; }, key);
  return (
    <div className="particles">
      <div className="panel-tools">
        <b>{em.name}</b>
        <span className="dim">Preset</span>
        <Select value={em.emitter.preset} options={[...Object.keys(PARTICLE_PRESETS), ...Object.keys(project.particlePresets)]} labels={Object.fromEntries(Object.entries(PARTICLE_PRESETS).map(([k, v]) => [k, v.name]))} onChange={(v) => store.mutate('Preset', (pp) => { const i = curScene(pp).instances.find((x) => x.uid === em.uid); if (i?.emitter) i.emitter = { ...i.emitter, preset: v, params: {} }; })} />
        <button className="btn small" onClick={() => store.mutate('Reset particles', (pp) => { const i = curScene(pp).instances.find((x) => x.uid === em.uid); if (i?.emitter) i.emitter.params = {}; })}>Reset to preset</button>
        <button className="btn small primary" onClick={() => { const n = window.prompt('Save as custom preset named', em.emitter!.preset + '_custom'); if (n) store.mutate('Save particle preset', (pp) => { pp.particlePresets[n] = p; }); }}>Save preset…</button>
        {importBtn}
        <span className="hint small">Quality: project setting scales max particles ({Math.round(project.settings.quality * 100)}%)</span>
      </div>
      <div className="pe-grid">
        <Section title="Emission" id="pe-em">
          {NUMS.slice(0, 2).map(([k, l, mn, mx, st]) => <Row key={k} label={l}><Slider value={Number(p[k])} min={mn} max={mx} step={st} onChange={(v) => set({ [k]: v } as any, 'pe' + k)} /></Row>)}
          <Row label="Looping"><Check value={p.looping} onChange={(v) => set({ looping: v })} /></Row>
          <Row label="Shape"><Select value={p.shape} options={['point', 'sphere', 'box', 'circle', 'cone']} onChange={(v) => set({ shape: v as any })} /></Row>
          <Row label="Shape size"><Vec3 v={p.shapeSize} onChange={(v) => set({ shapeSize: v }, 'pess')} /></Row>
          <Row label="Space"><Select value={p.space} options={['world', 'local']} onChange={(v) => set({ space: v as any })} /></Row>
        </Section>
        <Section title="Motion" id="pe-mo">
          {NUMS.slice(2, 9).map(([k, l, mn, mx, st]) => <Row key={k} label={l}><Slider value={Number(p[k])} min={mn} max={mx} step={st} onChange={(v) => set({ [k]: v } as any, 'pe' + k)} /></Row>)}
          <Row label="Direction"><Vec3 v={p.direction} onChange={(v) => set({ direction: v }, 'pedir')} /></Row>
          <Row label="Acceleration"><Vec3 v={p.acceleration} onChange={(v) => set({ acceleration: v }, 'peacc')} /></Row>
          <Row label="Collide with floor"><Check value={p.collideFloor} onChange={(v) => set({ collideFloor: v })} /></Row>
          {p.collideFloor && <><Row label="Floor Y"><Num value={p.floorY} onChange={(v) => set({ floorY: v }, 'pefy')} /></Row><Row label="Bounce"><Slider value={p.bounce} min={0} max={1} step={0.01} onChange={(v) => set({ bounce: v }, 'pebo')} /></Row></>}
        </Section>
        <Section title="Appearance" id="pe-ap">
          {NUMS.slice(9, 16).map(([k, l, mn, mx, st]) => <Row key={k} label={l}><Slider value={Number(p[k])} min={mn} max={mx} step={st} onChange={(v) => set({ [k]: v } as any, 'pe' + k)} /></Row>)}
          <Row label="Color start"><Color value={p.colorStart} onChange={(v) => set({ colorStart: v }, 'pecs')} /></Row>
          <Row label="Color end"><Color value={p.colorEnd} onChange={(v) => set({ colorEnd: v }, 'pece')} /></Row>
          <Row label="Texture"><Select value={p.texture} options={['circle', 'square', 'spark', 'smoke', 'star', 'debris']} onChange={(v) => set({ texture: v as any })} /></Row>
          <Row label="Your own picture" tip="PNG or JPG used for every particle instead of the shape above. Shrunk to 256 pixels at most; it is stored with the effect"><ParticlePicture value={p.textureImage} onChange={(v) => set({ textureImage: v })} /></Row>
          <Row label="Blending"><Select value={p.blending} options={['additive', 'normal']} onChange={(v) => set({ blending: v as any })} /></Row>
        </Section>
        <Section title="Limits" id="pe-li">
          {NUMS.slice(16).map(([k, l, mn, mx, st]) => <Row key={k} label={l}><Num value={Number(p[k])} min={mn} max={mx} step={st} onChange={(v) => set({ [k]: v } as any, 'pe' + k)} /></Row>)}
        </Section>
      </div>
    </div>
  );
}
