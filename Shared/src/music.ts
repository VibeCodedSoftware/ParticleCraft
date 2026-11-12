// Songs made in the Sounds panel's music editor: a few channels, each with short numbered patterns laid out bar by bar,
// notes locked to a key and scale so everything sounds right. Rendered to samples here (own synth, no audio files, no
// browser needed), so the same song plays in the editor and in an exported game and can be saved as a WAV.

export interface MusicNote { /** First step in the pattern. */ s: number; /** Length in steps. */ l: number; /** MIDI note; on a drum channel, the DRUMS row. */ p: number }
export type MusicWave = 'sine' | 'triangle' | 'square' | 'pulse' | 'saw' | 'organ' | 'bell' | 'bass';
export type MusicEnvelope = 'pluck' | 'piano' | 'held' | 'swell' | 'short';
export interface MusicInstrument {
  wave: MusicWave; envelope: MusicEnvelope;
  /** 0-1 loudness; -1..1 left/right. */
  volume: number; pan: number;
  /** 0-1: dark to bright. */
  brightness: number;
  /** 0-1 each. */
  vibrato: number; chorus: number; echo: number;
}
export interface MusicChannel {
  name: string; drum: boolean; mute?: boolean; ins: MusicInstrument;
  patterns: MusicNote[][];
  /** Per bar: which pattern plays (1 = the first), 0 = silence. */
  seq: number[];
}
export interface Song {
  bpm: number; key: number; scale: string;
  /** Beats in a bar, steps in a beat. */
  beats: number; steps: number;
  bars: number; loop: boolean;
  channels: MusicChannel[];
}

export const SCALES: Record<string, number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10],
  'major pentatonic': [0, 2, 4, 7, 9], 'minor pentatonic': [0, 3, 5, 7, 10],
  blues: [0, 3, 5, 6, 7, 10], dorian: [0, 2, 3, 5, 7, 9, 10], mixolydian: [0, 2, 4, 5, 7, 9, 10],
  'harmonic minor': [0, 2, 3, 5, 7, 8, 11], spooky: [0, 1, 4, 5, 7, 8, 11], 'every note': [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
};
export const KEY_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const noteName = (midi: number) => KEY_NAMES[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1);
export const DRUMS = ['Kick', 'Snare', 'Closed hat', 'Open hat', 'Clap', 'Low tom', 'High tom', 'Rim'];
export const WAVES: { id: MusicWave; name: string }[] = [
  { id: 'square', name: 'Chiptune square' }, { id: 'pulse', name: 'Thin pulse' }, { id: 'triangle', name: 'Soft triangle' }, { id: 'saw', name: 'Bright saw' },
  { id: 'sine', name: 'Pure sine' }, { id: 'organ', name: 'Organ' }, { id: 'bell', name: 'Bell' }, { id: 'bass', name: 'Round bass' },
];
export const ENVELOPES: { id: MusicEnvelope; name: string }[] = [
  { id: 'short', name: 'Short blip' }, { id: 'pluck', name: 'Plucked' }, { id: 'piano', name: 'Struck, fades' }, { id: 'held', name: 'Held' }, { id: 'swell', name: 'Slow swell' },
];

export const defaultInstrument = (o: Partial<MusicInstrument> = {}): MusicInstrument => ({ wave: 'square', envelope: 'pluck', volume: 0.6, pan: 0, brightness: 0.7, vibrato: 0, chorus: 0, echo: 0, ...o });
export const newChannel = (name: string, drum: boolean, bars: number, ins: Partial<MusicInstrument> = {}): MusicChannel => ({ name, drum, ins: defaultInstrument(drum ? { wave: 'sine', envelope: 'short', volume: 0.8, brightness: 1, ...ins } : ins), patterns: [[]], seq: new Array(bars).fill(0) });
export function newSong(): Song {
  const bars = 8;
  return {
    bpm: 120, key: 0, scale: 'major pentatonic', beats: 4, steps: 4, bars, loop: true,
    channels: [
      newChannel('Melody', false, bars, { wave: 'square', envelope: 'pluck', volume: 0.5 }),
      newChannel('Harmony', false, bars, { wave: 'triangle', envelope: 'held', volume: 0.45, chorus: 0.4 }),
      newChannel('Bass', false, bars, { wave: 'bass', envelope: 'pluck', volume: 0.7, brightness: 0.45 }),
      newChannel('Drums', true, bars),
    ],
  };
}

/** The notes a row can hold: in the song's key and scale, from `low` to `high`. */
export function scaleNotes(song: Pick<Song, 'key' | 'scale'>, low: number, high: number): number[] {
  const degrees = SCALES[song.scale] ?? SCALES.major, out: number[] = [];
  for (let m = low; m <= high; m++) if (degrees.includes((((m - song.key) % 12) + 12) % 12)) out.push(m);
  return out;
}
export const stepsInBar = (s: Pick<Song, 'beats' | 'steps'>) => s.beats * s.steps;
export const songSeconds = (s: Pick<Song, 'bars' | 'beats' | 'bpm'>) => (s.bars * s.beats * 60) / Math.max(1, s.bpm);

/** Bars changed: every channel's sequence keeps up. */
export function setBars(song: Song, bars: number): Song {
  const n = Math.max(1, Math.min(128, Math.round(bars)));
  return { ...song, bars: n, channels: song.channels.map((c) => ({ ...c, seq: Array.from({ length: n }, (_, i) => c.seq[i] ?? 0) })) };
}

// ---- synthesis
const TAU = Math.PI * 2;
const hz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
function oscillator(wave: MusicWave, ph: number): number {
  const t = ph - Math.floor(ph);
  switch (wave) {
    case 'sine': return Math.sin(t * TAU);
    case 'triangle': return 4 * Math.abs(t - 0.5) - 1;
    case 'square': return t < 0.5 ? 0.7 : -0.7;
    case 'pulse': return t < 0.2 ? 0.7 : -0.7;
    case 'saw': return (2 * t - 1) * 0.7;
    case 'organ': return (Math.sin(t * TAU) + 0.5 * Math.sin(t * TAU * 2) + 0.28 * Math.sin(t * TAU * 3) + 0.14 * Math.sin(t * TAU * 4)) * 0.55;
    case 'bell': return Math.sin(t * TAU + 1.6 * Math.sin(t * TAU * 3.5));
    case 'bass': return Math.sin(t * TAU) * 0.85 + (4 * Math.abs(t - 0.5) - 1) * 0.25;
  }
}
/** Loudness over a note: t seconds since it began, `len` seconds it is held. */
function envelope(kind: MusicEnvelope, t: number, len: number): number {
  const rel = kind === 'swell' ? 0.25 : kind === 'held' ? 0.08 : kind === 'piano' ? 0.18 : 0.05;
  let v: number;
  switch (kind) {
    case 'short': v = Math.exp(-t * 16); break;
    case 'pluck': v = 0.25 + 0.75 * Math.exp(-t * 7); break;
    case 'piano': v = 0.1 + 0.9 * Math.exp(-t * 2.4); break;
    case 'swell': v = Math.min(1, t / Math.min(0.4, Math.max(0.02, len * 0.8))); break;
    default: v = 1;
  }
  v *= Math.min(1, t / 0.004);
  return t > len ? v * Math.max(0, 1 - (t - len) / rel) : v;
}
const releaseOf = (k: MusicEnvelope) => (k === 'swell' ? 0.25 : k === 'held' ? 0.08 : k === 'piano' ? 0.18 : 0.05);

/** One tuned note added into `out`. */
function addNote(out: Float32Array, at: number, sr: number, midi: number, len: number, ins: MusicInstrument) {
  const f = hz(midi), total = Math.ceil((len + releaseOf(ins.envelope)) * sr);
  const coef = 1 - Math.exp((-TAU * (300 + 12000 * ins.brightness * ins.brightness)) / sr);
  let lp = 0;
  const vib = ins.vibrato * 0.012, det = 1 + ins.chorus * 0.006;
  for (let i = 0, n = Math.min(total, out.length - at); i < n; i++) {
    const t = i / sr;
    const wob = vib ? 1 + vib * Math.sin(TAU * 5.5 * t) * Math.min(1, t * 3) : 1;
    let s = oscillator(ins.wave, f * t * wob);
    if (ins.chorus > 0) s = (s + oscillator(ins.wave, f * det * t * wob + 0.3)) * 0.6;
    lp += (s - lp) * coef;
    out[at + i] += lp * envelope(ins.envelope, t, len);
  }
}
/** One drum hit added into `out`. */
function addDrum(out: Float32Array, at: number, sr: number, row: number, seed: number) {
  let n = (seed * 2654435761 >>> 0) || 1;
  const noise = () => { n ^= n << 13; n >>>= 0; n ^= n >> 17; n ^= n << 5; n >>>= 0; return n / 2147483648 - 1; };
  const dur = [0.28, 0.2, 0.06, 0.3, 0.2, 0.3, 0.2, 0.05][row] ?? 0.2;
  const total = Math.min(Math.ceil(dur * sr), out.length - at);
  let hp = 0, prev = 0, ph = 0, lp = 0;
  for (let i = 0; i < total; i++) {
    const t = i / sr, k = 1 - t / dur, d = noise();
    let v = 0;
    switch (row) {
      case 0: ph += (45 + 110 * Math.exp(-t * 32)) / sr; v = Math.sin(ph * TAU) * Math.pow(k, 1.4) * 1.3; break; // kick: a falling thump
      case 1: ph += (190 + 60 * Math.exp(-t * 30)) / sr; lp += (d - lp) * 0.55; v = (Math.sin(ph * TAU) * 0.5 * Math.exp(-t * 22) + lp * 0.8 * Math.pow(k, 1.6)); break;
      case 2: case 3: hp = 0.86 * (hp + d - prev); prev = d; v = hp * 0.45 * Math.pow(k, row === 2 ? 2 : 1.5); break; // hats: only the highs of noise
      case 4: { lp += (d - lp) * 0.5; const burst = t < 0.03 ? (Math.floor(t / 0.01) % 2 ? 0.3 : 1) : Math.exp(-(t - 0.03) * 24); v = lp * burst * 0.9; break; }
      case 5: case 6: ph += ((row === 5 ? 95 : 165) * (1 + 0.5 * Math.exp(-t * 25))) / sr; v = Math.sin(ph * TAU) * Math.pow(k, 1.5) * 0.9; break;
      default: ph += 1500 / sr; v = (Math.sin(ph * TAU) * 0.5 + d * 0.25) * Math.pow(k, 2);
    }
    out[at + i] += v;
  }
}

export interface RenderedSong { sampleRate: number; left: Float32Array; right: Float32Array; seconds: number }
/** The whole song as samples. A looping song's tail is folded back onto its start, so it loops without a seam. */
export function renderSong(song: Song, sampleRate = 44100): RenderedSong {
  const seconds = songSeconds(song), stepSec = 60 / Math.max(1, song.bpm) / Math.max(1, song.steps), barSteps = stepsInBar(song);
  const body = Math.max(1, Math.ceil(seconds * sampleRate)), tail = Math.ceil(2 * sampleRate), size = body + tail;
  const left = new Float32Array(size), right = new Float32Array(size);
  const buf = new Float32Array(size);
  song.channels.forEach((ch, ci) => {
    if (ch.mute) return;
    buf.fill(0);
    let any = false;
    for (let bar = 0; bar < song.bars; bar++) {
      const pat = ch.patterns[(ch.seq[bar] ?? 0) - 1];
      if (!pat) continue;
      for (const nt of pat) {
        if (nt.s >= barSteps || nt.s < 0) continue;
        any = true;
        const at = Math.round((bar * barSteps + nt.s) * stepSec * sampleRate);
        if (ch.drum) addDrum(buf, at, sampleRate, nt.p, (bar + 1) * 131 + nt.s * 17 + nt.p + ci * 7);
        else addNote(buf, at, sampleRate, nt.p, Math.max(1, Math.min(nt.l, barSteps * 4)) * stepSec, ch.ins);
      }
    }
    if (!any) return;
    if (ch.ins.echo > 0) {
      const delay = Math.round(stepSec * song.steps * 0.75 * sampleRate), fb = 0.45 * ch.ins.echo + 0.05, wet = 0.5 * ch.ins.echo;
      for (let i = delay; i < size; i++) buf[i] += buf[i - delay] * fb * (wet > 0 ? 1 : 0);
    }
    const a = ((Math.max(-1, Math.min(1, ch.ins.pan)) + 1) * Math.PI) / 4, gl = Math.cos(a) * Math.SQRT2, gr = Math.sin(a) * Math.SQRT2, v = ch.ins.volume * 0.5;
    for (let i = 0; i < size; i++) { const s = buf[i] * v; left[i] += s * gl; right[i] += s * gr; }
  });
  if (song.loop) for (let i = 0; i < tail; i++) { left[i % body] += left[body + i]; right[i % body] += right[body + i]; }
  // Gentle limiter: loud songs saturate instead of clipping.
  const end = song.loop ? body : size;
  for (let i = 0; i < end; i++) { left[i] = Math.tanh(left[i] * 1.1); right[i] = Math.tanh(right[i] * 1.1); }
  return { sampleRate, left: left.slice(0, end), right: right.slice(0, end), seconds: end / sampleRate };
}
/** A single note or drum hit (hearing a note as it is placed). */
export function renderNote(ch: Pick<MusicChannel, 'drum' | 'ins'>, pitch: number, seconds: number, sampleRate = 44100): Float32Array {
  const out = new Float32Array(Math.ceil((seconds + 0.4) * sampleRate));
  if (ch.drum) addDrum(out, 0, sampleRate, pitch, pitch + 1); else addNote(out, 0, sampleRate, pitch, seconds, ch.ins);
  const v = ch.ins.volume * 0.7;
  for (let i = 0; i < out.length; i++) out[i] *= v;
  return out;
}
/** 16-bit stereo WAV. */
export function encodeWav(r: RenderedSong): ArrayBuffer {
  const n = r.left.length, data = n * 4, b = new ArrayBuffer(44 + data), d = new DataView(b);
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) d.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); d.setUint32(4, 36 + data, true); str(8, 'WAVEfmt '); d.setUint32(16, 16, true); d.setUint16(20, 1, true); d.setUint16(22, 2, true);
  d.setUint32(24, r.sampleRate, true); d.setUint32(28, r.sampleRate * 4, true); d.setUint16(32, 4, true); d.setUint16(34, 16, true); str(36, 'data'); d.setUint32(40, data, true);
  for (let i = 0, o = 44; i < n; i++, o += 4) {
    d.setInt16(o, Math.max(-1, Math.min(1, r.left[i])) * 32767, true); d.setInt16(o + 2, Math.max(-1, Math.min(1, r.right[i])) * 32767, true);
  }
  return b;
}

// ---- a starting point
const PROGRESSIONS = [[0, 4, 5, 3], [0, 3, 4, 3], [5, 3, 0, 4], [0, 5, 3, 4]];
/** A short song in the current key and scale, to change rather than start from nothing. */
export function surpriseSong(base: Song, seed = Date.now()): Song {
  let s = (seed >>> 0) || 1;
  const r = () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  const barSteps = stepsInBar(base), beat = base.steps;
  const low = base.key + 48, notes = scaleNotes(base, low, low + 36);
  const deg = (d: number) => notes[Math.max(0, Math.min(notes.length - 1, d))];
  const per = (SCALES[base.scale] ?? SCALES.major).length;
  const prog = PROGRESSIONS[Math.floor(r() * PROGRESSIONS.length)].map((d) => Math.min(d, per - 1));
  const mel: MusicNote[][] = [], har: MusicNote[][] = [], bas: MusicNote[][] = [];
  prog.forEach((root) => {
    har.push([0, 2, 4].map((k) => ({ s: 0, l: barSteps, p: deg(root + k + per) })));
    bas.push(Array.from({ length: base.beats }, (_, b) => ({ s: b * beat, l: Math.max(1, beat - 1), p: deg(root) - 12 })));
    const m: MusicNote[] = [];
    let at = 0, d = root + per + (r() < 0.5 ? 2 : 4);
    while (at < barSteps) {
      const l = beat * [0.5, 0.5, 1, 1, 2][Math.floor(r() * 5)] || 1;
      if (r() > 0.18) m.push({ s: at, l: Math.max(1, Math.round(l)), p: deg(d) });
      d += Math.round((r() - 0.5) * 4);
      d = Math.max(root + per, Math.min(root + per * 2 + 1, d)); // about an octave above the chords: room to move
      at += Math.max(1, Math.round(l));
    }
    mel.push(m);
  });
  const drums: MusicNote[] = [];
  for (let b = 0; b < base.beats; b++) {
    drums.push({ s: b * beat, l: 1, p: b % 2 ? 1 : 0 });
    drums.push({ s: b * beat, l: 1, p: 2 });
    if (beat > 1) drums.push({ s: b * beat + Math.floor(beat / 2), l: 1, p: 2 });
  }
  const seqOf = (n: number) => Array.from({ length: base.bars }, (_, i) => (i % n) + 1);
  const mk = (name: string, patterns: MusicNote[][], ins: Partial<MusicInstrument>) => ({ ...newChannel(name, false, base.bars, ins), patterns, seq: seqOf(patterns.length) });
  return {
    ...base,
    channels: [
      mk('Melody', mel, { wave: 'square', envelope: 'pluck', volume: 0.45, echo: 0.3 }),
      mk('Harmony', har, { wave: 'triangle', envelope: 'held', volume: 0.32, chorus: 0.5 }),
      mk('Bass', bas, { wave: 'bass', envelope: 'pluck', volume: 0.75, brightness: 0.45 }),
      { ...newChannel('Drums', true, base.bars), patterns: [drums], seq: seqOf(1) },
    ],
  };
}
