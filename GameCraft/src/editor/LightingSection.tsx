// World panel: this scene's global illumination and reflections. The status lines report what is really on, so nothing
// claims to be baked or dynamic when it isn't.
import React, { useEffect, useState } from 'react';
import { store, useStore } from '../project/store';
import { curScene } from './actions';
import { editorRefs } from './session';
import { Num, Row, Section, Select, Slider } from './ui';
import { GI_QUALITY, bakeSignature, type GiMode, type GiQuality, type LightingSettings } from '@shared/src/runtime/lighting';

const dim = { opacity: 0.75, fontSize: 11, lineHeight: 1.4 } as const;

export function LightingSection() {
  const project = useStore((s) => s.project)!;
  useStore((s) => s.rev);
  const scene = curScene(project), li = scene.settings.lighting ?? {};
  const set = (patch: Partial<LightingSettings>, key?: string) => store.mutate('Lighting', (p) => { const s = curScene(p); s.settings.lighting = { ...s.settings.lighting, ...patch }; }, key);
  const [progress, setProgress] = useState<number | null>(null);
  const [debug, setDebug] = useState<'none' | 'indirect' | 'probes'>('none');
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 1000); return () => clearInterval(t); }, []);
  useEffect(() => () => editorRefs.view?.setGiDebug('none'), []);
  const view = editorRefs.view;
  const mode = li.gi ?? 'off', status = view?.giStatus();
  const stale = li.giBake && li.giBake.sig !== bakeSignature(scene);

  const bake = async () => {
    if (!view || progress != null) return;
    setProgress(0);
    try {
      const b = await view.bakeGi(curScene(store.get().project!), setProgress);
      store.mutate('Bake lighting', (p) => { const s = curScene(p); s.settings.lighting = { ...s.settings.lighting, gi: 'baked', giBake: b }; });
    } catch (e: any) { store.log('error', 'Lighting bake failed: ' + (e?.message ?? e)); }
    setProgress(null);
  };
  const giLine = mode === 'off' ? 'Off: ambient light and direct lights only.'
    : mode === 'realtime' ? (status?.mode === 'realtime' ? `Real-time: ${status.probes} probes refreshing in turn, moving things included. Costs frame time.` : 'Real-time: starts in the Rendered view and in play.')
    : !li.giBake ? 'Baked, but not baked yet: no indirect light until you press Bake.'
    : stale ? `Baked ${new Date(li.giBake.bakedAt).toLocaleString()}, out of date: the scene has changed. Bake again.`
    : `Baked ${new Date(li.giBake.bakedAt).toLocaleString()}: ${li.giBake.dims[0] * li.giBake.dims[1] * li.giBake.dims[2]} probes, ${li.giBake.bounces} bounce(s). Moving objects receive it but don't add to it.`;
  const probes = scene.instances.filter((i) => i.reflectionProbe).length, mirrors = scene.instances.filter((i) => i.mirror).length;
  const refLine = [
    probes ? `${probes} reflection probe(s) capturing this scene` : 'No reflection probes (Add › Reflection probe)',
    mirrors ? `${mirrors} planar mirror(s)` : 'no mirrors (object properties › Mirror)',
    (li.ssr ?? 0) > 0 ? 'screen-space on' : 'screen-space off',
  ].join(', ') + (!probes && !mirrors && !li.ssr ? '. Reflections show only the environment image.' : '.');

  return <Section title="Global illumination & reflections" defaultOpen={mode !== 'off'}>
    <Row label="Indirect light (GI)" tip="Light bouncing off surfaces, read from a grid of light probes"><Select value={mode} options={['off', 'baked', 'realtime']} labels={{ off: 'Off', baked: 'Baked', realtime: 'Real-time probes' }} onChange={(v) => set({ gi: v as GiMode })} /></Row>
    <div className="hint" style={dim}>{giLine}</div>
    {mode !== 'off' && <>
      <Row label="Strength"><Slider value={li.giStrength ?? 1} min={0} max={4} step={0.05} onChange={(v) => set({ giStrength: v }, 'gis')} /></Row>
      <Row label="Quality" tip="How close together the probes are: more detail, a longer bake, more memory. Real-time uses far fewer"><Select value={li.giQuality ?? 'medium'} options={Object.keys(GI_QUALITY)} labels={Object.fromEntries(Object.entries(GI_QUALITY).map(([k, q]) => [k, q.label]))} onChange={(v) => set({ giQuality: v as GiQuality })} /></Row>
    </>}
    {mode === 'baked' && <>
      <Row label="Bounces" tip="How many times light bounces. Each one is another pass over all the probes"><Num value={li.giBounces ?? 2} step={1} min={1} max={3} precision={0} onChange={(v) => set({ giBounces: Math.round(v) }, 'gib')} /></Row>
      <Row label="Bake"><button className="btn small" disabled={progress != null} onClick={bake}>{progress != null ? `Baking ${Math.round(progress * 100)}%` : li.giBake ? 'Bake again' : 'Bake'}</button></Row>
    </>}
    {mode !== 'off' && <Row label="Debug view" tip="See the indirect light alone, or the probes themselves in the colour they captured"><Select value={debug} options={['none', 'indirect', 'probes']} labels={{ none: 'None', indirect: 'Indirect light only', probes: 'Show the probes' }} onChange={(v) => { setDebug(v as any); view?.setGiDebug(v as any); }} /></Row>}
    <Row label="Screen-space reflections" tip="Shiny metal (metalness above 0.5, roughness below 0.6) reflects what is on screen, and nothing off screen. Costs frame time, and edges lose some smoothing. Strength 0 = off"><Slider value={li.ssr ?? 0} min={0} max={1} step={0.05} onChange={(v) => set({ ssr: v }, 'ssr')} /></Row>
    {(li.ssr ?? 0) > 0 && <>
      <Row label="Reach (m)" tip="Higher finds more, at a higher cost"><Slider value={li.ssrDistance ?? 30} min={1} max={150} step={1} onChange={(v) => set({ ssrDistance: v }, 'ssrd')} /></Row>
      <Row label="Thickness" tip="How thick surfaces count as: lower is more exact but leaves more gaps"><Slider value={li.ssrThickness ?? 0.5} min={0.01} max={3} step={0.01} onChange={(v) => set({ ssrThickness: v }, 'ssrt')} /></Row>
    </>}
    {probes > 0 && <Row label="Reflection probes"><button className="btn small" onClick={() => view?.recaptureReflections()}>Capture again</button></Row>}
    <div className="hint" style={dim}>{refLine}</div>
  </Section>;
}
