// Sound panel: every sound the project can play (built-in, designed in the synth, imported files) with preview,
// per-sound volume / pitch / variation / category, a synth sound designer, and category volumes (mixer).
// Everything is saved in the logic document (doc.sounds), so "Play sound" blocks and the runtime see it.
import React, { useMemo, useState } from 'react';
import { Glyph } from './icons';
import { createPortal } from 'react-dom';
import type { LogicDocument } from '../src/schema';
import { BUILTIN_SOUNDS } from '../src/blocks/definitions';
import { DEFAULT_SYNTH, SOUND_CATEGORIES, SYNTH_PRESETS, categoryOf, emptyLibrary, soundName, type SoundCategory, type SoundLibrary, type SoundSetting, type SynthSound } from '../src/sounds';
import { audio } from './audio';
import { MusicEditor } from './MusicEditor';
import { newSong, type Song } from '../src/music';

type Filter = 'all' | 'builtin' | 'custom' | 'files' | 'song' | SoundCategory;
const AUDIO_ACCEPT = '.wav,.mp3,.ogg,.m4a,.flac,.webm';

export function SoundButton(props: SoundPanelProps) {
  const [open, setOpen] = useState(false);
  const n = Object.keys(props.doc.sounds?.custom ?? {}).length + Object.keys(props.doc.sounds?.files ?? {}).length;
  return (
    <>
      <button className="csp-btn" title="Sounds: preview, design your own, import files, volumes and pitch" onClick={() => setOpen(true)}>Sounds{n ? ` (${n})` : ''}</button>
      {open && createPortal(<SoundPanel {...props} onClose={() => setOpen(false)} />, document.body)}
    </>
  );
}

export interface SoundPanelProps {
  doc: LogicDocument;
  onChange: (doc: LogicDocument, label: string) => void;
  /** Store an imported file and return the reference to keep (asset id or data URL). */
  importFile?: (f: File) => Promise<string>;
  /** Asset reference -> playable URL (data URLs are used as they are). */
  resolve?: (ref: string) => string | null;
}

export function SoundPanel({ doc, onChange, importFile, resolve, onClose }: SoundPanelProps & { onClose: () => void }) {
  const lib: SoundLibrary = { ...emptyLibrary(), ...(doc.sounds ?? {}), buses: { ...emptyLibrary().buses, ...(doc.sounds?.buses ?? {}) } };
  const [filter, setFilter] = useState<Filter>('all');
  const [sel, setSel] = useState<string>(Object.keys(lib.custom)[0] ?? 'coin');
  const [q, setQ] = useState('');
  const [err, setErr] = useState('');
  const save = (next: SoundLibrary, label: string) => onChange({ ...doc, sounds: next }, label);
  const preview = (name: string) => {
    audio.library = lib;
    const prev = audio.resolveUrl;
    if (resolve) audio.resolveUrl = (n) => resolve(n) ?? prev(n);
    audio.play(name, 0.8);
    audio.resolveUrl = prev;
  };
  const all = useMemo(() => {
    const rows = [
      ...BUILTIN_SOUNDS.map((n) => ({ name: n, src: 'builtin' as const })),
      ...Object.keys(lib.custom).map((n) => ({ name: n, src: 'custom' as const })),
      ...Object.keys(lib.files).map((n) => ({ name: n, src: 'files' as const })),
      ...Object.keys(lib.songs ?? {}).map((n) => ({ name: n, src: 'song' as const })),
    ];
    return rows.filter((r) => (filter === 'all' || filter === r.src || filter === categoryOf(r.name, lib)) && (!q || r.name.toLowerCase().includes(q.toLowerCase())));
  }, [doc.sounds, filter, q]);
  const songs = lib.songs ?? {};
  const unique = (base: string) => { let n = base, k = 2; while (BUILTIN_SOUNDS.includes(n) || lib.custom[n] || lib.files[n] || songs[n]) n = `${base}_${k++}`; return n; };
  // The music editor: a song is edited in a window of its own over this panel.
  const [editing, setEditing] = useState<string | null>(null);
  const newSongNow = () => { const name = unique('my_song'); save({ ...lib, songs: { ...songs, [name]: newSong() } }, 'New song'); setSel(name); setFilter('all'); setEditing(name); };
  if (editing && songs[editing]) {
    return <MusicEditor song={songs[editing]} name={editing} onClose={() => setEditing(null)}
      onChange={(s, label) => save({ ...lib, songs: { ...songs, [editing]: s } }, label)}
      onRename={(to) => { const name = soundName(to); if (!name || name === editing || BUILTIN_SOUNDS.includes(name) || lib.custom[name] || lib.files[name] || songs[name]) return; const o: Record<string, Song> = {}; for (const [k, v] of Object.entries(songs)) o[k === editing ? name : k] = v; save({ ...lib, songs: o }, 'Rename song'); setSel(name); setEditing(name); }}
      onSaveWav={importFile ? async (f) => { const ref = await importFile(f); const name = unique(editing + '_file'); save({ ...lib, files: { ...lib.files, [name]: ref }, settings: { ...lib.settings, [name]: { category: 'music' } } }, 'Save song as file'); } : undefined} />;
  }
  const newSynth = (preset = 'coin') => {
    const name = unique(preset === 'coin' ? 'my_sound' : preset);
    save({ ...lib, custom: { ...lib.custom, [name]: SYNTH_PRESETS[preset].make(Math.random) } }, 'New sound');
    setSel(name); setFilter('all');
    setTimeout(() => preview(name), 30);
  };
  const onFiles = async (files: FileList | null) => {
    if (!files?.length || !importFile) return;
    setErr('');
    const added: Record<string, string> = {};
    for (const f of [...files]) {
      if (!/\.(wav|mp3|ogg|m4a|flac|webm)$/i.test(f.name)) { setErr(`${f.name}: not an audio file (use WAV, MP3, OGG, M4A, FLAC or WebM).`); continue; }
      try { added[unique(soundName(f.name))] = await importFile(f); } catch (e: any) { setErr(`${f.name}: ${e?.message ?? e}`); }
    }
    if (Object.keys(added).length) { save({ ...lib, files: { ...lib.files, ...added } }, 'Import sounds'); setSel(Object.keys(added)[0]); setFilter('files'); }
  };
  const src = lib.custom[sel] ? 'custom' : lib.files[sel] ? 'files' : songs[sel] ? 'song' : BUILTIN_SOUNDS.includes(sel) ? 'builtin' : null;
  const setting: SoundSetting = lib.settings[sel] ?? {};
  const setSetting = (patch: Partial<SoundSetting>, label = 'Sound setting') => save({ ...lib, settings: { ...lib.settings, [sel]: { ...setting, ...patch } } }, label);
  const synth = lib.custom[sel];
  const setSynth = (patch: Partial<SynthSound>) => save({ ...lib, custom: { ...lib.custom, [sel]: { ...synth, ...patch } } }, 'Edit sound');
  const remove = () => {
    const c = { ...lib.custom }, f = { ...lib.files }, s = { ...lib.settings }, m = { ...songs };
    delete c[sel]; delete f[sel]; delete s[sel]; delete m[sel];
    save({ ...lib, custom: c, files: f, settings: s, songs: m }, 'Delete sound'); setSel('coin');
  };
  const rename = (to: string) => {
    const name = soundName(to);
    if (!name || name === sel || BUILTIN_SOUNDS.includes(name) || lib.custom[name] || lib.files[name] || songs[name]) return;
    const mv = <T,>(m: Record<string, T>) => { const o: Record<string, T> = {}; for (const [k, v] of Object.entries(m)) o[k === sel ? name : k] = v; return o; };
    save({ ...lib, custom: mv(lib.custom), files: mv(lib.files), settings: mv(lib.settings), songs: mv(songs) }, 'Rename sound');
    setSel(name);
  };
  const num = (label: string, v: number, min: number, max: number, step: number, on: (n: number) => void, fmt = (x: number) => x.toFixed(2)) => (
    <label className="snd-row"><span>{label}</span><input type="range" min={min} max={max} step={step} value={v} onChange={(e) => on(Number(e.target.value))} /><em>{fmt(v)}</em></label>
  );
  return (
    <div className="lx-modal-back" onMouseDown={onClose}>
      <div className="lx-modal wide snd" onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') onClose(); }}>
        <div className="lx-modal-head"><b>Sounds</b><span className="lx-doc" style={{ margin: 0 }}>Names here work in every "Play sound" block.</span><button className="lx-btn" style={{ marginLeft: 'auto' }} onClick={onClose}>Done</button></div>
        <div className="snd-body">
          <div className="snd-list">
            <div className="snd-tools">
              <button className="lx-btn primary" onClick={() => newSynth()}>+ Design a sound</button>
              <button className="lx-btn primary" title="Write your own music: channels, patterns and notes that stay in key" onClick={newSongNow}>+ Make music</button>
              {importFile && <label className="lx-btn">Import file…<input type="file" accept={AUDIO_ACCEPT} multiple hidden onChange={(e) => { onFiles(e.target.files); e.target.value = ''; }} /></label>}
            </div>
            <input className="lx-input" placeholder="Search sounds…" value={q} onChange={(e) => setQ(e.target.value)} />
            <div className="snd-filters">{([['all', 'All'], ['builtin', 'Built-in'], ['custom', 'Designed'], ['song', 'Songs'], ['files', 'Files'], ...SOUND_CATEGORIES.map((c) => [c.id, c.name])] as [Filter, string][]).map(([k, l]) => <button key={k} className={'chip' + (filter === k ? ' on' : '')} onClick={() => setFilter(k)}>{l}</button>)}</div>
            {err && <div className="snd-err"><Glyph e="⚠" i="alert-triangle" size={12} /> {err}</div>}
            <div className="snd-items">
              {all.map((r) => (
                <div key={r.name} className={'snd-item' + (sel === r.name ? ' on' : '')} onClick={() => setSel(r.name)}>
                  <button className="snd-play" title="Preview" onClick={(e) => { e.stopPropagation(); preview(r.name); }}><Glyph e="▶" i="play" size={12} /></button>
                  <span className="snd-name">{r.name}</span>
                  <span className="snd-tag">{r.src === 'builtin' ? 'built-in' : r.src === 'custom' ? 'designed' : r.src === 'song' ? 'song' : 'file'} · {SOUND_CATEGORIES.find((c) => c.id === categoryOf(r.name, lib))?.name}</span>
                </div>
              ))}
              {!all.length && <i className="lx-doc">No sounds match.</i>}
            </div>
          </div>
          <div className="snd-detail">
            {src && <>
              <div className="snd-title">
                <button className="lx-btn primary" onClick={() => preview(sel)}><Glyph e="▶" i="play" size={12} /> Play</button>
                {src === 'builtin' ? <b>{sel}</b> : <input className="lx-input" defaultValue={sel} key={sel} onBlur={(e) => rename(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} title="Rename (blocks using the old name must be updated)" />}
                {src !== 'builtin' && <button className="lx-btn danger" onClick={remove}>Delete</button>}
              </div>
              {src === 'song' && <div className="snd-tools"><button className="lx-btn primary" onClick={() => setEditing(sel)}>Edit music</button><button className="lx-btn" onClick={() => audio.stop('music')}>Stop</button></div>}
              <h4>Mix</h4>
              {num('Volume', setting.volume ?? 1, 0, 2, 0.05, (v) => setSetting({ volume: v }), (x) => Math.round(x * 100) + '%')}
              {num('Pitch', setting.pitch ?? 1, 0.25, 3, 0.05, (v) => setSetting({ pitch: v }), (x) => x.toFixed(2) + '×')}
              {num('Random pitch', setting.pitchVariation ?? 0, 0, 0.5, 0.01, (v) => setSetting({ pitchVariation: v }), (x) => '±' + Math.round(x * 100) + '%')}
              <label className="snd-row"><span>Category</span><select className="lx-input" value={categoryOf(sel, lib)} onChange={(e) => setSetting({ category: e.target.value as SoundCategory })}>{SOUND_CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select><em /></label>
              {src === 'files' && <p className="lx-doc">Files in the Music category loop and replace the current music when played.</p>}
              {synth && <>
                <h4>Sound designer</h4>
                <div className="snd-presets">{Object.entries(SYNTH_PRESETS).map(([k, p]) => <button key={k} className="chip" title="Randomize from this preset" onClick={() => { setSynth(p.make(Math.random)); setTimeout(() => preview(sel), 30); }}>{p.name}</button>)}</div>
                <label className="snd-row"><span>Wave</span><select className="lx-input" value={synth.wave} onChange={(e) => setSynth({ wave: e.target.value as SynthSound['wave'] })}>{['square', 'sine', 'triangle', 'sawtooth'].map((w) => <option key={w}>{w}</option>)}</select><em /></label>
                {num('Start pitch', synth.startFreq, 40, 2500, 1, (v) => setSynth({ startFreq: v }), (x) => Math.round(x) + ' Hz')}
                {num('End pitch', synth.endFreq, 20, 2500, 1, (v) => setSynth({ endFreq: v }), (x) => Math.round(x) + ' Hz')}
                {num('Length', synth.duration, 0.02, 2, 0.01, (v) => setSynth({ duration: v }), (x) => x.toFixed(2) + ' s')}
                {num('Fade in', synth.attack, 0, 0.5, 0.01, (v) => setSynth({ attack: v }), (x) => x.toFixed(2) + ' s')}
                {num('Noise', synth.noise, 0, 1, 0.01, (v) => setSynth({ noise: v }), (x) => Math.round(x * 100) + '%')}
                {synth.noise > 0 && num('Noise tone', synth.noiseFreq, 100, 8000, 10, (v) => setSynth({ noiseFreq: v }), (x) => Math.round(x) + ' Hz')}
                {num('Vibrato', synth.vibrato, 0, 1, 0.01, (v) => setSynth({ vibrato: v }), (x) => Math.round(x * 100) + '%')}
                {synth.vibrato > 0 && num('Vibrato speed', synth.vibratoSpeed, 1, 30, 0.5, (v) => setSynth({ vibratoSpeed: v }), (x) => x.toFixed(1) + ' Hz')}
                {num('Repeats', synth.repeats, 0, 8, 1, (v) => setSynth({ repeats: v }), (x) => String(x))}
                {synth.repeats > 0 && num('Repeat step', synth.repeatStep, -12, 12, 1, (v) => setSynth({ repeatStep: v }), (x) => (x > 0 ? '+' : '') + x + ' semitones')}
                {synth.repeats > 0 && num('Repeat gap', synth.repeatGap, 0, 0.5, 0.01, (v) => setSynth({ repeatGap: v }), (x) => x.toFixed(2) + ' s')}
                {num('Loudness', synth.gain, 0.02, 1, 0.01, (v) => setSynth({ gain: v }), (x) => Math.round(x * 100) + '%')}
                <div className="snd-tools"><button className="lx-btn" onClick={() => setSynth({ ...DEFAULT_SYNTH })}>Reset</button><button className="lx-btn" onClick={() => { const n = unique(sel); save({ ...lib, custom: { ...lib.custom, [n]: { ...synth } } }, 'Duplicate sound'); setSel(n); }}>Duplicate</button></div>
              </>}
              {src === 'builtin' && <p className="lx-doc">Built-in sounds are synthesized, so they need no files. Use "Design a sound" for your own, or change this one's volume and pitch above.</p>}
            </>}
          </div>
          <div className="snd-mixer">
            <h4>Mixer</h4>
            {SOUND_CATEGORIES.map((c) => num(c.name, lib.buses[c.id] ?? 1, 0, 1, 0.05, (v) => save({ ...lib, buses: { ...lib.buses, [c.id]: v } }, 'Mixer'), (x) => Math.round(x * 100) + '%'))}
            <p className="lx-doc">Category volumes multiply every sound in that category. The "Set volume" block still controls the overall volume.</p>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Read a file as a data URL (LogicCraft keeps imported sounds inside the project). */
export function fileToDataUrl(f: File): Promise<string> {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(r.error); r.readAsDataURL(f); });
}
