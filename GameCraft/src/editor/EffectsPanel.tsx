// Post-processing per camera (one-click presets, stack order, toggles, reset, save custom preset)
// and World settings (Blender World + Color Management).
import React, { useEffect, useState } from 'react';
import { FX_CODE_HELP, fxValue, parseFxCode } from '@shared/src/fxCode';
import { fxCodeStatus } from '../engine/postfx';
import { EFFECTS, POSTFX_PRESETS, makeEffect } from '@shared/src/postfx';
import { deepClone } from '@shared/src/schema';
import type { PostFxEffect } from '@shared/src/runtime/scene';
import { cloudDefaults, DEFAULT_SKY } from '@shared/src/runtime/sky';
import { store, useStore } from '../project/store';
import { curScene } from './actions';
import { useAssets } from './ObjectContextMenu';
import { LightingSection } from './LightingSection';
import { Check, Color, Num, Row, Section, Select, Slider } from './ui';

export function EffectsPanel() {
  const project = useStore((s) => s.project);
  const selection = useStore((s) => s.selection);
  useStore((s) => s.rev);
  const [preset, setPreset] = useState('ps1');
  if (!project) return null;
  const scene = curScene(project);
  const cams = scene.instances.filter((i) => i.kind === 'camera');
  const selCam = cams.find((c) => selection.includes(c.uid));
  const cam = selCam ?? cams.find((c) => c.camera?.active) ?? cams[0];
  const custom = project.postfxPresets;
  const editStack = (label: string, fn: (s: PostFxEffect[]) => PostFxEffect[] | void, key?: string) => store.mutate(label, (p) => {
    const c = curScene(p).instances.find((i) => i.uid === cam!.uid);
    if (!c?.camera) return;
    const r = fn(c.camera.postfx);
    if (r) c.camera.postfx = r;
  }, key);
  const stack = cam?.camera?.postfx ?? [];
  const textures = project.assets.filter((a) => a.kind === 'texture');
  return (
    <div className="effects">
      <Section title="Camera post-processing">
        {!cam ? <div className="hint">Add a camera (Shift+A › Camera) to use post-processing.</div> : <>
          <Row label="Camera"><Select value={String(cam.uid)} options={cams.map((c) => String(c.uid))} labels={Object.fromEntries(cams.map((c) => [String(c.uid), c.name + (c.camera?.active ? ' (active)' : '')]))} onChange={(v) => store.set({ selection: [Number(v)] })} /></Row>
          <div className="preset-grid">
            {Object.entries(POSTFX_PRESETS).filter(([k]) => k !== 'none').map(([k, p]) => (
              <button key={k} className={'preset' + (preset === k ? ' on' : '')} title={p.description} onClick={() => setPreset(k)}>{p.name}</button>
            ))}
            {Object.keys(custom).map((k) => <button key={'c' + k} className={'preset custom' + (preset === 'custom:' + k ? ' on' : '')} onClick={() => setPreset('custom:' + k)}>★ {k}</button>)}
          </div>
          <div className="hint">{preset.startsWith('custom:') ? 'Your saved preset.' : POSTFX_PRESETS[preset]?.description}</div>
          <div className="btn-row">
            <button className="btn primary" onClick={() => editStack(`Apply ${preset}`, () => preset.startsWith('custom:') ? deepClone(custom[preset.slice(7)]) : POSTFX_PRESETS[preset].stack())}>Apply</button>
            <button className="btn" onClick={() => editStack(`Add ${preset}`, (s) => [...s, ...(preset.startsWith('custom:') ? deepClone(custom[preset.slice(7)]) : POSTFX_PRESETS[preset].stack())])}>Stack on top</button>
            <button className="btn" onClick={() => editStack('Clear effects', () => [])}>Clear</button>
            <button className="btn" onClick={() => { const n = window.prompt('Preset name'); if (n) store.mutate('Save preset', (p) => { p.postfxPresets[n] = deepClone(stack); }); }}>Save as preset…</button>
          </div>
          {store.get().shading !== 'rendered' && <div className="warn">Switch the viewport to Rendered shading (◐ or Z) to preview effects.</div>}
          <div className="fx-stack">
            {stack.map((e, idx) => {
              const def = EFFECTS[e.type];
              return (
                <div key={e.id} className={'fx' + (e.enabled ? '' : ' off')}>
                  <div className="fx-head">
                    <Check value={e.enabled} onChange={(v) => editStack('Toggle effect', (s) => { s[idx].enabled = v; })} />
                    <b>{def?.name ?? e.type}</b>
                    <span className={'fid ' + def?.fidelity} title={def?.note}>{def?.fidelity === 'approximation' ? 'approx.' : 'accurate'}</span>
                    <span className="grow" />
                    <button className="x" title="Move up" disabled={idx === 0} onClick={() => editStack('Reorder', (s) => { [s[idx - 1], s[idx]] = [s[idx], s[idx - 1]]; })}>▲</button>
                    <button className="x" title="Move down" disabled={idx === stack.length - 1} onClick={() => editStack('Reorder', (s) => { [s[idx + 1], s[idx]] = [s[idx], s[idx + 1]]; })}>▼</button>
                    <button className="x" title="Reset parameters" onClick={() => editStack('Reset effect', (s) => { s[idx] = { ...makeEffect(e.type), id: e.id }; })}>⟲</button>
                    <button className="x" title="Remove" onClick={() => editStack('Remove effect', (s) => s.filter((_, j) => j !== idx))}>✕</button>
                  </div>
                  {e.type === 'customfx' && <FxCodeEditor effect={e} textures={textures} set={(fn, key) => editStack('FX code', (s) => { fn(s[idx].params); }, key)} />}
                  {def?.params.filter((pd) => pd.type !== 'code').map((pd) => (
                    <Row key={pd.key} label={pd.label}>
                      {pd.type === 'boolean' ? <Check value={!!e.params[pd.key]} onChange={(v) => editStack('Effect', (s) => { s[idx].params[pd.key] = v; })} />
                        : pd.type === 'color' ? <Color value={String(e.params[pd.key])} onChange={(v) => editStack('Effect', (s) => { s[idx].params[pd.key] = v; }, 'fx' + idx + pd.key)} />
                          : pd.type === 'choice' ? <Select value={String(e.params[pd.key])} options={pd.options ?? []} onChange={(v) => editStack('Effect', (s) => { s[idx].params[pd.key] = v; })} />
                            : <Slider value={Number(e.params[pd.key])} min={pd.min ?? 0} max={pd.max ?? 1} step={pd.step ?? 0.01} onChange={(v) => editStack('Effect', (s) => { s[idx].params[pd.key] = v; }, 'fx' + idx + pd.key)} />}
                    </Row>
                  ))}
                </div>
              );
            })}
          </div>
          <select className="sel" value="" onChange={(e) => e.target.value && editStack('Add effect', (s) => [...s, makeEffect(e.target.value)])}>
            <option value="">+ Add effect…</option>
            {Object.values(EFFECTS).map((d) => <option key={d.type} value={d.type}>{d.name}</option>)}
          </select>
        </>}
      </Section>
      <WorldPanel />
    </div>
  );
}

/**
 * FX Code editor: the shader text, then a control for each uniform it declares (Godot-style Shader Parameters):
 * sliders from hint_range, colour pickers for source_color, checkboxes for bool, texture pickers for sampler2D.
 * Below, whether it compiled (the renderer's message and line when not).
 */
function FxCodeEditor({ effect, textures, set }: { effect: PostFxEffect; textures: { id: string; name: string }[]; set: (fn: (p: Record<string, any>) => void, key?: string) => void }) {
  const code = String(effect.params.code ?? '');
  const parsed = parseFxCode(code);
  // The renderer reports compile results after it next draws: look again a few times a second.
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 400); return () => clearInterval(t); }, []);
  const status = parsed.errors.length ? parsed.errors.join('\n') : fxCodeStatus.get(effect.id);
  return <div className="fx-code">
    <textarea className="txt" spellCheck={false} rows={Math.min(18, Math.max(6, code.split('\n').length + 1))} style={{ width: '100%', fontFamily: 'monospace', fontSize: 11.5, whiteSpace: 'pre', tabSize: 2 }}
      value={code} onChange={(ev) => set((p) => { p.code = ev.target.value; }, 'fxcode' + effect.id)} onKeyDown={(ev) => { ev.stopPropagation(); if (ev.key === 'Tab') { ev.preventDefault(); const t = ev.currentTarget, a = t.selectionStart; set((p) => { p.code = code.slice(0, a) + '  ' + code.slice(t.selectionEnd); }, 'fxcode' + effect.id); } }} />
    <div className="hint">{FX_CODE_HELP}</div>
    {status === undefined ? <div className="hint">Compiles when shown: switch the viewport to Rendered (◐) or press Play.</div>
      : status ? <div className="warn" style={{ whiteSpace: 'pre-wrap' }}>{status}</div> : <div className="hint">✓ Compiled and running.</div>}
    {parsed.uniforms.length > 0 && <h5 style={{ margin: '6px 0 2px' }}>Shader parameters</h5>}
    {parsed.uniforms.map((u) => {
      const v = fxValue(effect.params, u), key = 'u:' + u.name;
      return <Row key={u.name} label={u.name.replace(/_/g, ' ')}>
        {u.type === 'bool' ? <Check value={!!v} onChange={(x) => set((p) => { p[key] = x; })} />
          : u.type === 'vec3' ? <Color value={String(v)} onChange={(x) => set((p) => { p[key] = x; }, 'fxu' + effect.id + u.name)} />
            : u.type === 'sampler2D' ? <Select value={String(v)} options={['', ...textures.map((t) => t.id)]} labels={{ '': 'None (black)', ...Object.fromEntries(textures.map((t) => [t.id, t.name])) }} onChange={(x) => set((p) => { p[key] = x; })} />
              : <Slider value={Number(v)} min={u.min ?? 0} max={u.max ?? 1} step={u.step ?? (((u.max ?? 1) - (u.min ?? 0)) / 100 || 0.01)} onChange={(x) => set((p) => { p[key] = x; }, 'fxu' + effect.id + u.name)} />}
        <button className="x" title="Back to the default in the code" onClick={() => set((p) => { delete p[key]; })}>⟲</button>
      </Row>;
    })}
  </div>;
}

/** Clouds (scene.settings.clouds): a marched volume and/or fog-particle billboards. */
function CloudsSection() {
  const project = useStore((s) => s.project)!;
  const scene = curScene(project);
  const s = { ...cloudDefaults(), enabled: false, ...scene.settings.clouds };
  const set = (patch: Partial<typeof s>, key?: string) => store.mutate('Clouds', (p) => { const sc = curScene(p); sc.settings.clouds = { ...s, ...sc.settings.clouds, ...patch }; }, key);
  return (
    <Section title="Clouds" defaultOpen={!!scene.settings.clouds?.enabled}>
      <Row label="Clouds" tip="Shown in Rendered shading and while playing"><Check value={s.enabled} onChange={(v) => set({ enabled: v })} /></Row>
      {s.enabled && <>
        <Row label="Kind"><Select value={s.style} options={['both', 'volumetric', 'particles']} labels={{ both: 'Volumetric and fog particles', volumetric: 'Volumetric', particles: 'Fog particles' }} onChange={(v) => set({ style: v as typeof s.style })} /></Row>
        <Row label="Coverage"><Slider value={s.coverage} min={0} max={1} step={0.01} onChange={(v) => set({ coverage: v }, 'cc')} /></Row>
        <Row label="Height (m)"><Num value={s.base} step={10} precision={0} onChange={(v) => set({ base: v }, 'cb')} /></Row>
        <Row label="Thickness (m)"><Num value={s.thickness} step={10} min={5} precision={0} onChange={(v) => set({ thickness: Math.max(5, v) }, 'ct')} /></Row>
        <Row label="Cloud size (m)"><Num value={s.scale} step={10} min={10} precision={0} onChange={(v) => set({ scale: Math.max(10, v) }, 'cs')} /></Row>
        <Row label="Density"><Slider value={s.density} min={0.1} max={2} step={0.05} onChange={(v) => set({ density: v }, 'cd')} /></Row>
        {s.style !== 'particles' && <Row label="Quality (steps)" tip="More is finer and slower"><Slider value={s.steps} min={8} max={64} step={1} onChange={(v) => set({ steps: v }, 'cq')} /></Row>}
        {s.style !== 'volumetric' && <Row label="Fog particles (thousands)"><Slider value={s.puffs} min={1} max={30} step={1} onChange={(v) => set({ puffs: v }, 'cp')} /></Row>}
      </>}
    </Section>
  );
}

/** Sky dome and day/night cycle (scene.settings.sky). */
function SkySection() {
  const project = useStore((s) => s.project)!;
  const scene = curScene(project);
  const s = { ...DEFAULT_SKY, ...scene.settings.sky };
  const set = (patch: Partial<typeof s>, key?: string) => store.mutate('Sky', (p) => { const sc = curScene(p); sc.settings.sky = { ...DEFAULT_SKY, ...sc.settings.sky, ...patch }; }, key);
  const hh = Math.floor(s.time), mm = Math.round((s.time - hh) * 60);
  const textures = useAssets('texture');
  return (
    <Section title="Sky & time of day" defaultOpen={!!scene.settings.sky?.enabled}>
      {scene.mode === '2d' && <div className="hint">2D scenes tint the background by time of day instead of drawing a sky dome.</div>}
      <Row label="Sky" tip="Physical sky with a sun that follows the time; stars at night"><Check value={s.enabled} onChange={(v) => set({ enabled: v })} /></Row>
      {s.enabled && <>
        <Row label={`Time ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`}><Slider value={s.time} min={0} max={24} step={0.05} onChange={(v) => set({ time: v }, 'skyt')} /></Row>
        <Row label="Day/night cycle" tip="Time passes while playing"><Check value={s.cycle} onChange={(v) => set({ cycle: v })} /></Row>
        {s.cycle && <Row label="Seconds per day"><Num value={s.dayLength} step={10} min={5} precision={0} suffix=" s" onChange={(v) => set({ dayLength: Math.max(5, v) }, 'skyd')} /></Row>}
        <Row label="Sun strength"><Slider value={s.sunStrength} min={0} max={3} step={0.05} onChange={(v) => set({ sunStrength: v }, 'skys')} /></Row>
        <Row label="Sun direction" tip="Compass direction of sunrise"><Slider value={s.sunAzimuth} min={0} max={360} step={1} onChange={(v) => set({ sunAzimuth: v }, 'skya')} /></Row>
        <Row label="Haze"><Slider value={s.haze} min={1} max={10} step={0.1} onChange={(v) => set({ haze: v }, 'skyh')} /></Row>
        <Row label="Stars at night"><Check value={s.stars} onChange={(v) => set({ stars: v })} /></Row>
        <Row label="Sun picture" tip="Your own picture for the sun (a PNG with transparency works best). None = the drawn sun. The glow around it stays"><Select value={s.sunTexture ?? ''} options={['', ...textures.map((t) => t.id)]} labels={{ '': 'Drawn sun', ...Object.fromEntries(textures.map((t) => [t.id, t.name])) }} onChange={(v) => set({ sunTexture: v || undefined })} /></Row>
        {s.sunTexture && <Row label="Sun size (°)" tip="How wide it looks, in degrees of the sky (the real sun is about 0.5)"><Slider value={s.sunSize ?? 3} min={0.5} max={20} step={0.1} onChange={(v) => set({ sunSize: v }, 'skyss')} /></Row>}
        <Row label="Moon" tip="Shown at night, opposite the sun"><Check value={s.moon !== false} onChange={(v) => set({ moon: v })} /></Row>
        {s.moon !== false && <>
          <Row label="Moon picture"><Select value={s.moonTexture ?? ''} options={['', ...textures.map((t) => t.id)]} labels={{ '': 'Built-in moon', ...Object.fromEntries(textures.map((t) => [t.id, t.name])) }} onChange={(v) => set({ moonTexture: v || undefined })} /></Row>
          <Row label="Moon size (°)"><Slider value={s.moonSize ?? 3} min={0.5} max={20} step={0.1} onChange={(v) => set({ moonSize: v }, 'skyms')} /></Row>
        </>}
        <div className="hint">The sky brings its own sun and moonlight. Use the Sky blocks (World & lights) to change the time from logic, and "When night falls" / "When day breaks" to react.</div>
      </>}
    </Section>
  );
}

export function WorldPanel() {
  const project = useStore((s) => s.project);
  useStore((s) => s.rev);
  if (!project) return null;
  const scene = curScene(project);
  const w = scene.settings.world ?? { color: '#5c6370', strength: 0.6 };
  const setW = (patch: Partial<typeof w>, key?: string) => store.mutate('World', (p) => { const s = curScene(p); s.settings.world = { ...(s.settings.world ?? w), ...patch }; }, key);
  const setS = (label: string, fn: (s: typeof scene) => void, key?: string) => store.mutate(label, (p) => fn(curScene(p)), key);
  const l2 = scene.settings.lighting2d ?? { enabled: false, ambient: '#3a4466', ambientStrength: 0.35 };
  const setL = (patch: Partial<typeof l2>, key?: string) => setS('2D lighting', (s) => { s.settings.lighting2d = { ...l2, ...patch }; }, key);
  return (
    <>
      {scene.mode === '2d' && <Section title="2D lighting" defaultOpen={l2.enabled}>
        <Row label="Lighting" tip="The scene is dark but for the ambient light and the lights (Add › 2D light); sprites are shaded by their normal maps"><Check value={l2.enabled} onChange={(v) => setL({ enabled: v })} /></Row>
        {l2.enabled && <>
          <Row label="Ambient color"><Color value={l2.ambient} onChange={(v) => setL({ ambient: v }, 'l2a')} /></Row>
          <Row label="Ambient strength"><Slider value={l2.ambientStrength} min={0} max={1} step={0.01} onChange={(v) => setL({ ambientStrength: v }, 'l2s')} /></Row>
          <div className="hint">Lights reach as far as their Custom distance. Give a sprite a normal map (Properties › Sprite) for shading from the light's side.</div>
        </>}
      </Section>}
      <Section title="World">
        <Row label="Background"><Color value={scene.settings.background} onChange={(v) => setS('Background', (s) => { s.settings.background = v; }, 'bg')} /></Row>
        <Row label="Ambient color"><Color value={w.color} onChange={(v) => setW({ color: v }, 'wc')} /></Row>
        <Row label="Ambient strength"><Slider value={w.strength} min={0} max={3} step={0.01} onChange={(v) => setW({ strength: v }, 'ws')} /></Row>
        <Row label="Fog"><Check value={!!w.fogEnabled} onChange={(v) => setW({ fogEnabled: v })} /></Row>
        {w.fogEnabled && <><Row label="Fog color"><Color value={w.fogColor ?? '#9aa4b2'} onChange={(v) => setW({ fogColor: v }, 'fc')} /></Row>
          <Row label="Fog density"><Slider value={w.fogDensity ?? 0.01} min={0} max={0.2} step={0.001} onChange={(v) => setW({ fogDensity: v }, 'fd')} /></Row></>}
        {scene.mode === '3d' && <>
          <Row label="Environment" tip="An HDRI (.hdr) or a panorama picture that lights reflections and ambient light. Import one in Assets"><Select value={w.envMap ?? ''} options={['', ...project.assets.filter((a) => a.kind === 'texture').map((a) => a.id)]} labels={{ '': 'None', ...Object.fromEntries(project.assets.filter((a) => a.kind === 'texture').map((a) => [a.id, a.name])) }} onChange={(v) => setW({ envMap: v || undefined })} /></Row>
          {w.envMap && <>
            <Row label="Environment strength"><Slider value={w.envStrength ?? 1} min={0} max={4} step={0.05} onChange={(v) => setW({ envStrength: v }, 'wes')} /></Row>
            <Row label="Show as background"><Check value={!!w.envBackground} onChange={(v) => setW({ envBackground: v })} /></Row>
            {w.envBackground && <Row label="Background blur"><Slider value={w.envBlur ?? 0} min={0} max={1} step={0.01} onChange={(v) => setW({ envBlur: v }, 'web')} /></Row>}
          </>}
        </>}
      </Section>
      <SkySection />
      <CloudsSection />
      {scene.mode === '3d' && <LightingSection />}
      <Section title="Color management">
        <Row label="View transform" tip="Same names as Blender's Color Management"><Select value={w.viewTransform ?? 'agx'} options={['standard', 'filmic', 'agx', 'neutral']} labels={{ standard: 'Standard', filmic: 'Filmic (ACES)', agx: 'AgX', neutral: 'Khronos PBR Neutral' }} onChange={(v) => setW({ viewTransform: v as any })} /></Row>
        <Row label="Exposure"><Slider value={w.exposure ?? 0} min={-5} max={5} step={0.05} onChange={(v) => setW({ exposure: v }, 'we')} /></Row>
      </Section>
      <Section title="Scene">
        <Row label="Name"><input className="txt" value={scene.name} onChange={(e) => setS('Rename scene', (s) => { s.name = e.target.value; }, 'sn')} onKeyDown={(e) => e.stopPropagation()} /></Row>
        <Row label="Mode"><span className="dim">{scene.mode === '2d' ? '2D (X/Y plane, orthographic)' : '3D (X/Z ground plane, Y up)'}</span></Row>
        <Row label="Presentation" tip="Text story: the game is shown as a full-screen story told by Dialogue (text adventures)"><Select value={scene.settings.presentation ?? 'scene'} options={['scene', 'text']} labels={{ scene: 'Scene view', text: 'Text story (full screen)' }} onChange={(v) => setS('Presentation', (s) => { s.settings.presentation = v as any; })} /></Row>
        <Row label="Random seed" tip="Fixed: random blocks give the same results every play (shareable levels, testing). Random each play: a new seed every time. Blocks: Random › Set random seed / Randomize seed"><span className="pair">
        <select value={scene.settings.seedMode ?? 'fixed'} onChange={(e) => setS('Random seed', (s) => { s.settings.seedMode = e.target.value as 'fixed' | 'random'; })}><option value="fixed">Fixed</option><option value="random">Random each play</option></select>
        {(scene.settings.seedMode ?? 'fixed') === 'fixed' && <Num value={scene.settings.seed ?? 1} step={1} onChange={(v) => setS('Random seed', (s) => { s.settings.seed = Math.max(1, Math.floor(v)); }, 'seed')} />}
      </span></Row>
      <Row label="Gravity (physics)"><Num value={scene.settings.gravity} step={0.5} suffix=" m/s²" onChange={(v) => setS('Gravity', (s) => { s.settings.gravity = v; }, 'grav')} /></Row>
        <Row label="Fixed timestep"><Num value={1 / scene.settings.fixedTimestep} step={10} min={10} max={240} precision={0} suffix=" Hz" onChange={(v) => setS('Timestep', (s) => { s.settings.fixedTimestep = 1 / v; })} /></Row>
        <Row label="Random seed"><Num value={scene.settings.seed} step={1} precision={0} onChange={(v) => setS('Seed', (s) => { s.settings.seed = Math.round(v); })} /></Row>
      </Section>
    </>
  );
}
