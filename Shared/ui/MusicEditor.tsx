// The music editor in the Sounds panel: bars across, channels down, a note grid for the bar you pick. Notes snap to the
// song's scale, so anything you click in sounds right. Everything is saved in the project; the song is a sound name like
// any other ("Play music" blocks loop it).
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Glyph } from './icons';
import { audio, type SongPlayback } from './audio';
import { DRUMS, ENVELOPES, KEY_NAMES, SCALES, WAVES, encodeWav, newChannel, noteName, renderSong, scaleNotes, setBars, stepsInBar, surpriseSong, type MusicChannel, type MusicInstrument, type MusicNote, type Song } from '../src/music';

const ROW_H = 16, LABEL_W = 62;
const COLORS = ['#b78cff', '#5ec8ff', '#6fdc8c', '#ffb454', '#ff7d9c', '#ffe06b', '#7de3d3', '#c9d1e0'];

export function MusicEditor({ song: songProp, name, onChange: commit, onRename, onSaveWav, onClose }: { song: Song; name: string; onChange: (s: Song, label: string) => void; onRename: (to: string) => void; onSaveWav?: (f: File) => Promise<void>; onClose: () => void }) {
  // The latest song, even before React has drawn it: a note dragged out edits what the press just added.
  const songRef = useRef(songProp); songRef.current = songProp;
  const song = songProp;
  const onChange = (s: Song, label: string) => { songRef.current = s; commit(s, label); };
  const [chan, setChan] = useState(0);
  const [bar, setBar] = useState(0);
  const [low, setLow] = useState(48);
  const [playing, setPlaying] = useState<SongPlayback | null>(null);
  const [head, setHead] = useState(0);
  const [status, setStatus] = useState('');
  const ch = song.channels[Math.min(chan, song.channels.length - 1)] ?? song.channels[0];
  const ci = song.channels.indexOf(ch);
  const color = COLORS[ci % COLORS.length];
  const patIndex = ch.seq[bar] ?? 0;
  const barSteps = stepsInBar(song);

  const editChan = (fn: (c: MusicChannel) => MusicChannel, label: string) => { const now = songRef.current; onChange({ ...now, channels: now.channels.map((c, k) => (k === ci ? fn(c) : c)) }, label); };
  const setIns = (patch: Partial<MusicInstrument>) => editChan((c) => ({ ...c, ins: { ...c.ins, ...patch } }), 'Instrument');
  /** Edit the bar's pattern; an empty bar gets a pattern of its own the moment a note goes in. */
  const editNotes = (fn: (n: MusicNote[]) => MusicNote[], label: string) => editChan((c) => {
    let at = c.seq[bar] ?? 0;
    const patterns = c.patterns.map((p) => p), seq = [...c.seq];
    if (!at) { let free = patterns.findIndex((p, k) => !p.length && !seq.includes(k + 1)); if (free < 0) { patterns.push([]); free = patterns.length - 1; } at = free + 1; seq[bar] = at; }
    patterns[at - 1] = fn(patterns[at - 1]);
    return { ...c, patterns, seq };
  }, label);
  const setCell = (c: number, b: number, v: number) => onChange({ ...song, channels: song.channels.map((x, k) => { if (k !== c) return x; const seq = [...x.seq]; seq[b] = Math.max(0, v); const patterns = [...x.patterns]; while (patterns.length < v) patterns.push([]); return { ...x, seq, patterns }; }) }, 'Pick pattern');
  const copyToNew = () => editChan((c) => { const src = c.patterns[(c.seq[bar] ?? 0) - 1] ?? []; const patterns = [...c.patterns, src.map((n) => ({ ...n }))]; const seq = [...c.seq]; seq[bar] = patterns.length; return { ...c, patterns, seq }; }, 'Copy pattern');

  // Playing: rendered once, re-rendered when the song changes, carrying on from the same place.
  const stop = () => { playing?.stop(); setPlaying(null); };
  const start = (from = 0) => { playing?.stop(); const p = audio.playSongPreview(songRef.current, from); setPlaying(p); };
  useEffect(() => () => { playing?.stop(); }, [playing]);
  useEffect(() => { if (!playing) return; const t = setTimeout(() => start(playing.position()), 250); return () => clearTimeout(t); }, [song]);
  useEffect(() => { if (!playing) { setHead(0); return; } let raf = 0; const tick = () => { setHead(playing.position()); raf = requestAnimationFrame(tick); }; raf = requestAnimationFrame(tick); return () => cancelAnimationFrame(raf); }, [playing]);
  const secPerBar = (song.beats * 60) / song.bpm;
  const headBar = head / secPerBar;

  const wav = () => {
    const blob = new Blob([encodeWav(renderSong(song))], { type: 'audio/wav' });
    return new File([blob], `${name}.wav`, { type: 'audio/wav' });
  };
  const num = (label: string, v: number, min: number, max: number, step: number, on: (n: number) => void, fmt = (x: number) => String(Math.round(x * 100) / 100)) => (
    <label className="mus-field"><span>{label}</span><input type="range" min={min} max={max} step={step} value={v} onChange={(e) => on(Number(e.target.value))} /><em>{fmt(v)}</em></label>
  );
  const pct = (x: number) => Math.round(x * 100) + '%';
  return (
    <div className="lx-modal-back" onMouseDown={onClose}>
      <div className="lx-modal wide mus" onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') onClose(); }}>
        <div className="lx-modal-head mus-head">
          <button className={'lx-btn' + (playing ? '' : ' primary')} onClick={() => (playing ? stop() : start(0))}><Glyph e={playing ? '■' : '▶'} i={playing ? 'square' : 'play'} size={12} /> {playing ? 'Stop' : 'Play'}</button>
          <input className="lx-input mus-name" defaultValue={name} key={name} onBlur={(e) => onRename(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} title="The name Play music blocks use" />
          <label className="mus-mini"><span>Key</span><select className="lx-input" value={song.key} onChange={(e) => onChange({ ...song, key: Number(e.target.value) }, 'Key')}>{KEY_NAMES.map((k, i) => <option key={k} value={i}>{k}</option>)}</select></label>
          <label className="mus-mini"><span>Scale</span><select className="lx-input" value={song.scale} onChange={(e) => onChange({ ...song, scale: e.target.value }, 'Scale')}>{Object.keys(SCALES).map((s) => <option key={s}>{s}</option>)}</select></label>
          <label className="mus-mini"><span>Tempo</span><input className="lx-input" type="number" min={30} max={300} value={song.bpm} onChange={(e) => onChange({ ...song, bpm: Math.max(30, Math.min(300, Number(e.target.value) || 120)) }, 'Tempo')} /></label>
          <label className="mus-mini"><span>Bars</span><input className="lx-input" type="number" min={1} max={128} value={song.bars} onChange={(e) => onChange(setBars(song, Number(e.target.value) || 1), 'Bars')} /></label>
          <label className="mus-mini"><span>Beats</span><input className="lx-input" type="number" min={2} max={12} value={song.beats} onChange={(e) => onChange({ ...song, beats: Math.max(2, Math.min(12, Number(e.target.value) || 4)) }, 'Beats')} /></label>
          <label className="mus-mini"><span>Steps</span><select className="lx-input" value={song.steps} onChange={(e) => onChange({ ...song, steps: Number(e.target.value) }, 'Steps per beat')}>{[1, 2, 3, 4, 6, 8].map((n) => <option key={n}>{n}</option>)}</select></label>
          <label className="mus-mini check"><input type="checkbox" checked={song.loop} onChange={(e) => onChange({ ...song, loop: e.target.checked }, 'Loop')} /><span>Loop</span></label>
          <button className="lx-btn" title="Fill the song with a new starting idea in this key and scale, to change as you like. Undo brings yours back." onClick={() => { if (song.channels.every((c) => c.patterns.every((p) => !p.length)) || window.confirm('Replace this song with a new idea? Undo brings it back.')) onChange(surpriseSong(song, (Date.now() ^ (Math.random() * 1e9)) >>> 0), 'Surprise me'); }}>Surprise me</button>
          <button className="lx-btn" style={{ marginLeft: 'auto' }} onClick={onClose}>Done</button>
        </div>
        <div className="mus-seq">
          <div className="mus-seq-grid" style={{ gridTemplateColumns: `104px repeat(${song.bars}, 34px) 24px` }}>
            {song.channels.map((c, k) => (
              <React.Fragment key={k}>
                <div className={'mus-chan' + (k === ci ? ' on' : '')} style={{ borderLeftColor: COLORS[k % COLORS.length] }} onClick={() => setChan(k)}>
                  <span>{c.name}</span>
                  <button className={'mus-m' + (c.mute ? ' on' : '')} title="Mute" onClick={(e) => { e.stopPropagation(); onChange({ ...song, channels: song.channels.map((x, j) => (j === k ? { ...x, mute: !x.mute } : x)) }, 'Mute'); }}>M</button>
                </div>
                {Array.from({ length: song.bars }, (_, b) => {
                  const v = c.seq[b] ?? 0;
                  return <button key={b} className={'mus-cell' + (k === ci && b === bar ? ' sel' : '') + (Math.floor(headBar) === b && playing ? ' now' : '')} style={v ? { background: COLORS[k % COLORS.length] + '55', borderColor: COLORS[k % COLORS.length] } : undefined}
                    title="Click to edit this bar. Scroll or use + and - to pick its pattern. 0 is silence."
                    onClick={() => { setChan(k); setBar(b); }} onWheel={(e) => { e.preventDefault(); setChan(k); setBar(b); setCell(k, b, Math.min(c.patterns.length + 1, Math.max(0, v + (e.deltaY < 0 ? 1 : -1)))); }}>{v || ''}</button>;
                })}
                <span />
              </React.Fragment>
            ))}
          </div>
          <div className="mus-seq-tools">
            <span className="mus-label" style={{ color }}>{ch.name}, bar {bar + 1}</span>
            <span className="mus-stepper"><button className="lx-btn" onClick={() => setCell(ci, bar, Math.max(0, patIndex - 1))}>-</button><b title="Pattern in this bar. Bars with the same number share their notes.">Pattern {patIndex || 'none'}</b><button className="lx-btn" onClick={() => setCell(ci, bar, Math.min(ch.patterns.length + 1, patIndex + 1))}>+</button></span>
            <button className="lx-btn" disabled={!patIndex} title="Give this bar its own copy, to change without changing the other bars" onClick={copyToNew}>Make a copy</button>
            <button className="lx-btn" disabled={!patIndex} title="Repeat this pattern in every bar after this one" onClick={() => editChan((c) => ({ ...c, seq: c.seq.map((v, b) => (b > bar ? patIndex : v)) }), 'Repeat pattern')}>Repeat to the end</button>
            <button className="lx-btn" disabled={song.channels.length >= 8} onClick={() => onChange({ ...song, channels: [...song.channels, newChannel(`Channel ${song.channels.length + 1}`, false, song.bars)] }, 'Add channel')}>+ Channel</button>
            <button className="lx-btn" disabled={song.channels.length >= 8} onClick={() => onChange({ ...song, channels: [...song.channels, newChannel(`Drums ${song.channels.length + 1}`, true, song.bars)] }, 'Add drums')}>+ Drums</button>
            <button className="lx-btn danger" disabled={song.channels.length <= 1} onClick={() => { onChange({ ...song, channels: song.channels.filter((_, k) => k !== ci) }, 'Remove channel'); setChan(Math.max(0, ci - 1)); }}>Remove channel</button>
          </div>
        </div>
        <div className="mus-main">
          <NoteGrid song={song} ch={ch} color={color} notes={ch.patterns[patIndex - 1] ?? []} low={low} setLow={setLow} barSteps={barSteps} onNotes={editNotes} headStep={playing && Math.floor(headBar) === bar ? (headBar - bar) * barSteps : -1} />
          <div className="mus-ins">
            <input className="lx-input" value={ch.name} onChange={(e) => editChan((c) => ({ ...c, name: e.target.value }), 'Channel name')} />
            {!ch.drum && <>
              <label className="mus-field"><span>Sound</span><select className="lx-input" value={ch.ins.wave} onChange={(e) => setIns({ wave: e.target.value as MusicInstrument['wave'] })}>{WAVES.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></label>
              <label className="mus-field"><span>Shape</span><select className="lx-input" value={ch.ins.envelope} onChange={(e) => setIns({ envelope: e.target.value as MusicInstrument['envelope'] })}>{ENVELOPES.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></label>
            </>}
            {num('Volume', ch.ins.volume, 0, 1, 0.01, (v) => setIns({ volume: v }), pct)}
            {num('Left / right', ch.ins.pan, -1, 1, 0.05, (v) => setIns({ pan: v }), (x) => (Math.abs(x) < 0.03 ? 'centre' : x < 0 ? 'L ' + pct(-x) : 'R ' + pct(x)))}
            {!ch.drum && <>
              {num('Brightness', ch.ins.brightness, 0, 1, 0.01, (v) => setIns({ brightness: v }), pct)}
              {num('Vibrato', ch.ins.vibrato, 0, 1, 0.01, (v) => setIns({ vibrato: v }), pct)}
              {num('Chorus', ch.ins.chorus, 0, 1, 0.01, (v) => setIns({ chorus: v }), pct)}
            </>}
            {num('Echo', ch.ins.echo, 0, 1, 0.01, (v) => setIns({ echo: v }), pct)}
            <div className="mus-tools">
              <button className="lx-btn" title="Download the song as a WAV file" onClick={() => { const f = wav(); const a = document.createElement('a'); a.href = URL.createObjectURL(f); a.download = f.name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); }}>Download WAV</button>
              {onSaveWav && <button className="lx-btn" title="Also keep it as an audio file in this project's sounds" onClick={async () => { setStatus('Saving…'); try { await onSaveWav(wav()); setStatus('Saved in the sound list.'); } catch (e: any) { setStatus(String(e?.message ?? e)); } }}>Save as sound file</button>}
            </div>
            {status && <div className="lx-doc">{status}</div>}
            <p className="lx-doc">Use it in the game with a Play music block named <b>{name}</b>. It needs no files, so it stays small.</p>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Rows of notes (only the scale's) or drums, steps across. Click to place and drag out its length; click a note to remove it; drag a note to move it. */
function NoteGrid({ song, ch, color, notes, low, setLow, barSteps, onNotes, headStep }: { song: Song; ch: MusicChannel; color: string; notes: MusicNote[]; low: number; setLow: (n: number) => void; barSteps: number; onNotes: (fn: (n: MusicNote[]) => MusicNote[], label: string) => void; headStep: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 600, h: 280 });
  const span = 25;
  const rows = useMemo(() => ch.drum ? DRUMS.map((_, i) => i).reverse() : scaleNotes(song, low, low + span + 11).reverse(), [ch.drum, song.key, song.scale, low]);
  const rowH = ch.drum ? Math.max(ROW_H, Math.floor(size.h / rows.length)) : Math.max(ROW_H, Math.floor(size.h / rows.length));
  const stepW = Math.max(6, (size.w - LABEL_W) / barSteps);
  useEffect(() => {
    const el = box.current; if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el); setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    const c = canvas.current; if (!c) return;
    const dpr = window.devicePixelRatio || 1, W = size.w, H = rows.length * rowH;
    c.width = W * dpr; c.height = H * dpr; c.style.width = W + 'px'; c.style.height = H + 'px';
    const x = c.getContext('2d')!; x.scale(dpr, dpr);
    x.fillStyle = '#14161c'; x.fillRect(0, 0, W, H);
    rows.forEach((m, r) => {
      const root = !ch.drum && ((m - song.key) % 12 + 12) % 12 === 0;
      x.fillStyle = root ? '#242a38' : r % 2 ? '#191c24' : '#16181f';
      x.fillRect(LABEL_W, r * rowH, W - LABEL_W, rowH - 1);
      x.fillStyle = root ? '#fff' : '#99a3b5'; x.font = '10px system-ui, sans-serif'; x.textBaseline = 'middle';
      x.fillText(ch.drum ? DRUMS[m] : noteName(m), 5, r * rowH + rowH / 2);
    });
    for (let s = 0; s <= barSteps; s++) {
      x.fillStyle = s % song.steps === 0 ? '#3a4152' : '#22262f';
      x.fillRect(LABEL_W + s * stepW, 0, 1, H);
    }
    for (const n of notes) {
      const r = rows.indexOf(n.p); if (r < 0 || n.s >= barSteps) continue;
      x.fillStyle = color; x.fillRect(LABEL_W + n.s * stepW + 1, r * rowH + 1, (ch.drum ? 1 : n.l) * stepW - 2, rowH - 3);
      x.fillStyle = 'rgba(255,255,255,.35)'; x.fillRect(LABEL_W + n.s * stepW + 1, r * rowH + 1, 3, rowH - 3);
    }
    if (headStep >= 0) { x.fillStyle = '#fff'; x.fillRect(LABEL_W + headStep * stepW, 0, 2, H); }
  }, [rows, notes, size, color, barSteps, song.steps, song.key, ch.drum, headStep, rowH, stepW]);

  const at = (e: { clientX: number; clientY: number }) => {
    const r = canvas.current!.getBoundingClientRect();
    return { step: Math.floor((e.clientX - r.left - LABEL_W) / stepW), row: Math.floor((e.clientY - r.top) / rowH), px: e.clientX - r.left - LABEL_W };
  };
  const hear = (p: number, steps = 1) => audio.playMusicNote(ch, p, Math.min(0.6, (steps * 60) / song.bpm / song.steps));
  const onDown = (e: React.PointerEvent) => {
    const a = at(e); if (a.step < 0 || a.step >= barSteps || a.row < 0 || a.row >= rows.length) return;
    e.preventDefault();
    const pitch = rows[a.row];
    const hit = notes.find((n) => n.p === pitch && a.step >= n.s && a.step < n.s + (ch.drum ? 1 : n.l));
    let moved = false;
    if (hit) {
      // Drag moves it; the far end stretches it; a click with no drag removes it.
      const edge = !ch.drum && a.px > (hit.s + hit.l) * stepW - 6;
      const key = { ...hit }; let cur = { ...hit };
      const move = (ev: PointerEvent) => {
        const b = at(ev);
        const next = edge ? { ...cur, l: Math.max(1, Math.min(barSteps - cur.s, b.step - cur.s + 1)) }
          : { ...cur, s: Math.max(0, Math.min(barSteps - 1, key.s + b.step - a.step)), p: rows[Math.max(0, Math.min(rows.length - 1, b.row))] };
        if (next.s === cur.s && next.p === cur.p && next.l === cur.l) return;
        moved = true;
        const from = cur; cur = next;
        if (next.p !== from.p) hear(next.p);
        onNotes((ns) => ns.map((n) => (n.s === from.s && n.p === from.p && n.l === from.l ? next : n)), 'Move note');
      };
      const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); if (!moved) onNotes((ns) => ns.filter((n) => !(n.s === key.s && n.p === key.p)), 'Remove note'); };
      window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
      return;
    }
    const placed: MusicNote = { s: a.step, l: 1, p: pitch };
    hear(pitch);
    onNotes((ns) => [...ns, placed], 'Add note');
    if (ch.drum) return;
    let cur = placed;
    const move = (ev: PointerEvent) => {
      const b = at(ev), l = Math.max(1, Math.min(barSteps - placed.s, b.step - placed.s + 1));
      if (l === cur.l) return;
      const from = cur; cur = { ...cur, l };
      onNotes((ns) => ns.map((n) => (n.s === from.s && n.p === from.p ? cur : n)), 'Stretch note');
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };
  return (
    <div className="mus-grid">
      {!ch.drum && <div className="mus-oct"><button className="lx-btn" title="Higher notes" onClick={() => setLow(Math.min(84, low + 12))}>▲</button><span>{noteName(low)}</span><button className="lx-btn" title="Lower notes" onClick={() => setLow(Math.max(24, low - 12))}>▼</button></div>}
      <div className="mus-canvas" ref={box}><canvas ref={canvas} onPointerDown={onDown} /></div>
    </div>
  );
}
