// Keyframe animation editor: clips with tracks per property, a scrubbable timeline, key insertion from
// the selected object's current values and live preview. Clips play at runtime via "Play animation".
import React, { useEffect, useRef, useState } from 'react';
import { Icon } from '@shared/ui/icons';
import { sampleTrack } from '@shared/src/runtime/runtime';
import type { AnimationClip } from '@shared/src/runtime/scene';
import { PROPERTY_NAMES } from '@shared/src/blocks/definitions';
import { renameAnimationRefs } from '@shared/ui/logicOps';
import { ANIM_PRESETS, type AnimPreset } from '@shared/src/animPresets';
import { store, useStore } from '../project/store';
import { api } from '../project/api';
import { curScene } from './actions';
import { editorRefs } from './session';
import { Check, Num } from './ui';

const PROP_OF: Record<string, (i: any) => number> = { X: (i) => i.x, Y: (i) => i.y, Z: (i) => i.z, RotX: (i) => i.rx, RotY: (i) => i.ry, RotZ: (i) => i.rz, ScaleX: (i) => i.sx, ScaleY: (i) => i.sy, ScaleZ: (i) => i.sz, Opacity: (i) => i.opacity, Angle: (i) => i.ry };

/** Import animation: copy the files into the project (Assets › Imported › Animations) and add them to the model. */
async function importModelAnimations(uid: number, files: File[]) {
  const p = store.get().project; if (!p) return;
  const ids: string[] = [];
  for (const f of files) {
    const rel = `imported/animations/${f.name.replace(/[^A-Za-z0-9_.@-]/g, '_')}`;
    await api.putFile(p.id, rel, await f.arrayBuffer());
    ids.push(`proj:${rel}`);
  }
  store.mutate('Import animation', (pp) => {
    for (const [k, id] of ids.entries()) if (!pp.assets.some((a) => a.id === id)) pp.assets.push({ id, name: files[k].name.replace(/\.[^.]+$/, ''), kind: 'model', source: 'imported', folder: 'Animations' });
    const t = curScene(pp).instances.find((x) => x.uid === uid);
    if (t?.mesh) t.mesh.animSources = [...new Set([...(t.mesh.animSources ?? []), ...ids])];
  });
  store.log('info', `Imported ${files.length} animation file(s); their clips are retargeted onto the model's bones.`);
}

export function AnimationPanel() {
  const project = useStore((s) => s.project);
  const selection = useStore((s) => s.selection);
  useStore((s) => s.rev);
  const [clipName, setClipName] = useState<string | null>(null);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [prop, setProp] = useState('Y');
  const [presets, setPresets] = useState(false);
  const raf = useRef(0);
  const scene = project ? curScene(project) : null;
  const clips = scene?.animations ?? [];
  const clip = clips.find((c) => c.name === clipName) ?? clips[0];
  const target = scene?.instances.find((i) => i.uid === selection[selection.length - 1]);

  // Live preview: apply the clip (relative to the object's stored values) to the viewport object.
  useEffect(() => {
    const e = target && editorRefs.view?.entries.get(target.uid);
    if (!e || !clip) return;
    for (const tr of clip.tracks) {
      const v = sampleTrack(tr.keys, time);
      const base = PROP_OF[tr.property]?.(target) ?? 0;
      const val = base + v;
      const r = (d: number) => (d * Math.PI) / 180;
      switch (tr.property) {
        case 'X': e.obj.position.x = val; break; case 'Y': e.obj.position.y = val; break; case 'Z': e.obj.position.z = val; break;
        case 'RotX': e.obj.rotation.x = r(val); break; case 'RotY': case 'Angle': e.obj.rotation.y = r(val); break; case 'RotZ': e.obj.rotation.z = r(val); break;
        case 'ScaleX': e.obj.scale.x = val; break; case 'ScaleY': e.obj.scale.y = val; break; case 'ScaleZ': e.obj.scale.z = val; break;
      }
    }
  }, [time, clip, target]);
  useEffect(() => {
    if (!playing || !clip) return;
    let last = performance.now();
    const loop = () => { raf.current = requestAnimationFrame(loop); const n = performance.now(); setTime((t) => { const nt = t + (n - last) / 1000; return nt > clip.duration ? (clip.loop ? nt % clip.duration : (setPlaying(false), clip.duration)) : nt; }); last = n; };
    loop();
    return () => cancelAnimationFrame(raf.current);
  }, [playing, clip]);
  if (!project || !scene) return null;

  const edit = (label: string, fn: (c: AnimationClip) => void) => store.mutate(label, (p) => { const s = curScene(p); const c = s.animations?.find((x) => x.name === clip!.name); if (c) fn(c); });
  const addKey = () => {
    if (!clip) return;
    edit('Add key', (c) => {
      let tr = c.tracks.find((t) => t.property === prop);
      if (!tr) { tr = { property: prop, keys: [{ t: 0, v: 0 }] }; c.tracks.push(tr); }
      tr.keys = tr.keys.filter((k) => Math.abs(k.t - time) > 1e-3);
      tr.keys.push({ t: Math.round(time * 100) / 100, v: 0, ease: 'easeInOut' });
      tr.keys.sort((a, b) => a.t - b.t);
    });
  };
  // Presets: add the clip to the scene (once) and, with a character selected, make it play for its movement role.
  const applyPreset = (p: AnimPreset) => {
    store.mutate(`Preset: ${p.name}`, (pp) => {
      const s = curScene(pp);
      if (!(s.animations ?? []).some((c) => c.name === p.name)) s.animations = [...(s.animations ?? []), { name: p.name, ...JSON.parse(JSON.stringify(p.clip)) }];
      const t = target && s.instances.find((x) => x.uid === target.uid);
      if (t && p.role) t.animRoles = { ...(t.animRoles ?? {}), [p.role]: p.name };
    });
    setClipName(p.name); setTime(0); setPlaying(true);
    store.log('info', target && p.role ? `Added "${p.name}": ${target.name} plays it while ${p.role === 'idle' ? 'standing still' : p.role + 'ing'}.` : `Added the clip "${p.name}" (play it with "Play animation").`);
  };
  const W = 600;
  return (
    <div className="anim">
      <div className="panel-tools">
        <select className="sel small" value={clip?.name ?? ''} onChange={(e) => setClipName(e.target.value)}>{clips.map((c) => <option key={c.name}>{c.name}</option>)}</select>
        <button className="btn small" onClick={() => { const n = window.prompt('Clip name', 'clip' + (clips.length + 1)); if (n) { store.mutate('New clip', (p) => { const s = curScene(p); s.animations = [...(s.animations ?? []), { name: n, duration: 1, loop: false, tracks: [] }]; }); setClipName(n); } }}>+ Clip</button>
        <button className={'btn small' + (presets ? ' primary' : '')} title="Ready-made character and object animations" onClick={() => setPresets(!presets)}>Presets</button>
        {clip && <>
          <span className="dim">Length</span><Num value={clip.duration} step={0.1} min={0.05} onChange={(v) => edit('Clip length', (c) => { c.duration = v; })} width={60} />
          <Check value={clip.loop} label="Loop" onChange={(v) => edit('Loop', (c) => { c.loop = v; })} />
          <button className="btn small" onClick={() => { setTime(0); setPlaying(!playing); }}><Icon name={playing ? 'pause' : 'play'} size={12} /> Preview</button>
          <span className="dim">Track</span>
          <select className="sel small" value={prop} onChange={(e) => setProp(e.target.value)}>{PROPERTY_NAMES.slice(0, 11).map((p) => <option key={p}>{p}</option>)}</select>
          <button className="btn small primary" onClick={addKey} title="Insert a key at the playhead (value is an offset from the object's own value)">◆ Insert key</button>
          <button className="btn small" title="Rename the clip (Play animation blocks that use it follow)" onClick={() => {
            const n = window.prompt('Rename clip', clip.name)?.trim();
            if (!n || n === clip.name) return;
            if (clips.some((c) => c.name === n)) { store.log('warn', `There is already a clip called "${n}".`); return; }
            let refs = 0;
            store.mutate('Rename clip', (p) => {
              const s = curScene(p), c = (s.animations ?? []).find((x) => x.name === clip.name); if (c) c.name = n;
              for (const i of s.instances) if (i.animRoles) for (const [r, v] of Object.entries(i.animRoles)) if (v === clip.name) i.animRoles[r] = n;
              refs = renameAnimationRefs(p.logic, clip.name, n);
            });
            setClipName(n);
            if (refs) store.log('info', `Renamed "${clip.name}" to "${n}" in ${refs} block${refs === 1 ? '' : 's'} too.`);
          }}>Rename</button>
          <button className="btn small" title="Copy this clip" onClick={() => {
            let n = clip.name + ' copy', k = 2; while (clips.some((c) => c.name === n)) n = `${clip.name} copy ${k++}`;
            store.mutate('Duplicate clip', (p) => { const s = curScene(p); s.animations = [...(s.animations ?? []), { ...JSON.parse(JSON.stringify(clip)), name: n }]; });
            setClipName(n);
          }}>Duplicate</button>
          <button className="btn small danger" onClick={() => { if (window.confirm(`Delete clip ${clip.name}?`)) store.mutate('Delete clip', (p) => { const s = curScene(p); s.animations = (s.animations ?? []).filter((c) => c.name !== clip.name); }); }}>Delete</button>
        </>}
        <span className="grow" />
        {target?.kind === 'mesh' && <label className="btn small" title="Add animations from another file (e.g. Mixamo FBX, GLB): they are retargeted onto this model's bones by name (hips, spine, arms, legs…), so one animation works on many characters">Import animation…<input type="file" multiple accept=".fbx,.glb,.gltf" hidden onChange={(e) => { const fs = [...(e.target.files ?? [])]; e.target.value = ''; if (fs.length) void importModelAnimations(target.uid, fs); }} /></label>}
        <span className="hint small">Preview on: {target ? target.name : 'select an object'} · use "Play animation" in logic</span>
      </div>
      {target?.kind === 'mesh' && !!target.mesh?.animSources?.length && (
        <div className="anim-sources">
          <span className="dim">Imported animations on {target.name}:</span>
          {target.mesh.animSources.map((s) => (
            <span key={s} className="tag">{s.split('/').pop()}<button className="x" title="Remove" onClick={() => store.mutate('Remove imported animation', (p) => { const t = curScene(p).instances.find((x) => x.uid === target.uid); if (t?.mesh) t.mesh.animSources = (t.mesh.animSources ?? []).filter((x) => x !== s); })}>✕</button></span>
          ))}
          <span className="hint small">Their clips play by name with "Play animation" (and can be assigned to idle / walk / jump in the Model panel).</span>
        </div>
      )}
      {presets && (
        <div className="anim-presets">
          <div className="hint">Double-click a preset to add it{target ? <> and apply it to <b>{target.name}</b></> : ' (select your character first to apply it)'}. Character presets with a role play by themselves when the character is in that state (walking, jumping…); the others play with "Play animation".</div>
          {(['Character', 'Motion'] as const).map((g) => (
            <div key={g} className="anim-preset-group">
              <b>{g === 'Character' ? 'Character animations' : 'Object motions'}</b>
              <div className="anim-preset-grid">
                {ANIM_PRESETS.filter((p) => p.group === g).map((p) => {
                  const added = clips.some((c) => c.name === p.name);
                  const applied = !!(p.role && target?.animRoles?.[p.role] === p.name);
                  return (
                    <div key={p.name} className={'anim-preset' + (applied ? ' on' : '')} title={p.doc + '\nDouble-click to add' + (p.role ? ' and apply' : '')}
                      onClick={() => { if (added) { setClipName(p.name); setTime(0); setPlaying(true); } }}
                      onDoubleClick={() => applyPreset(p)}>
                      <span className="ap-name">{p.name}</span>
                      <span className="ap-meta">{p.role ? `plays on: ${p.role}` : 'Play animation'}{added ? ' · added' : ''}{applied ? ' · applied' : ''}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
      {!clip ? <div className="hint pad">No clips yet. Create one, choose a property track and insert keys. Values are offsets added to the object's own value, so one clip works on many objects.</div> : (
        <div className="timeline">
          <div className="tl-ruler" style={{ width: W }} onPointerDown={(e) => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); setTime(Math.max(0, Math.min(clip.duration, ((e.clientX - r.left) / W) * clip.duration))); }}>
            {Array.from({ length: 11 }, (_, n) => <span key={n} style={{ left: (n / 10) * W }}>{((n / 10) * clip.duration).toFixed(2)}</span>)}
            <div className="tl-head" style={{ left: (time / clip.duration) * W }} />
          </div>
          {clip.tracks.map((tr, ti) => (
            <div key={tr.property} className="tl-track">
              <span className="tl-name">{tr.property}</span>
              <div className="tl-lane" style={{ width: W }}>
                {tr.keys.map((k, ki) => (
                  <span key={ki} className="tl-key" style={{ left: (k.t / clip.duration) * W }} title={`t=${k.t}s value=${k.v}`} onClick={() => setTime(k.t)} />
                ))}
                <div className="tl-head" style={{ left: (time / clip.duration) * W }} />
              </div>
              <div className="tl-keys">
                {tr.keys.map((k, ki) => (
                  <span key={ki} className="tl-kv">t<Num value={k.t} step={0.05} min={0} max={clip.duration} width={44} onChange={(v) => edit('Key time', (c) => { c.tracks[ti].keys[ki].t = v; c.tracks[ti].keys.sort((a, b) => a.t - b.t); })} />
                    v<Num value={k.v} step={1} width={52} onChange={(v) => edit('Key value', (c) => { c.tracks[ti].keys[ki].v = v; })} />
                    <button className="x" onClick={() => edit('Delete key', (c) => { c.tracks[ti].keys.splice(ki, 1); })}>✕</button></span>
                ))}
                <button className="x" title="Delete track" onClick={() => edit('Delete track', (c) => { c.tracks.splice(ti, 1); })}><Icon name="trash-2" size={13} /></button>
              </div>
            </div>
          ))}
          <div className="hint">Time {time.toFixed(2)} s · imported glTF/FBX clips and sprite animations are played by name with the same block.</div>
        </div>
      )}
    </div>
  );
}
