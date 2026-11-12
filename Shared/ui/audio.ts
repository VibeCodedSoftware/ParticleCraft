// WebAudio: synthesized built-in sounds (no audio files needed), imported audio assets,
// looping music, spatial playback and global effects (echo, underwater, radio).
import { categoryOf, type SoundLibrary, type SynthSound } from '../src/sounds';
import { renderNote, renderSong, type MusicChannel, type Song } from '../src/music';
type Note = [number, number]; // [midi, beats]
/** A song playing in the music editor. */
export interface SongPlayback { stop: () => void; position: () => number }

export class AudioSystem {
  ctx: AudioContext | null = null;
  master!: GainNode;
  private fxIn!: GainNode;
  private music: { stop: () => void } | null = null;
  private buffers = new Map<string, Promise<AudioBuffer>>();
  private active = new Set<AudioScheduledSourceNode>();
  volume = 0.8;
  listener: [number, number, number] = [0, 0, 0];
  resolveUrl: (name: string) => string | null = () => null;
  /** The project's Sound panel library (custom sounds, imported files, per-sound settings, category volumes). */
  library: SoundLibrary | null = null;
  /** Pitch of the sound being started (synth tones scale their frequencies by it). */
  private pitch = 1;

  private ensure() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return this.ctx; }
    const C = window.AudioContext ?? (window as any).webkitAudioContext;
    this.ctx = new C();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    this.fxIn = this.ctx.createGain();
    this.fxIn.connect(this.master);
    this.master.connect(this.ctx.destination);
    return this.ctx;
  }

  setVolume(v: number) { this.volume = Math.max(0, Math.min(1, v)); if (this.ctx) this.master.gain.value = this.volume; }

  /** The player's own volume per category (an options menu: music, sound effects…), on top of the project's mix. */
  playerBus: Record<string, number> = {};
  /** The music playing now: its gain and the volume it would have at a category volume of 1. */
  private musicOut: { gain: GainNode; base: number } | null = null;
  setBus(category: string, v: number) {
    const k = Math.max(0, Math.min(1, v));
    this.playerBus[category] = k;
    if (category === 'music' && this.musicOut) this.musicOut.gain.gain.value = this.musicOut.base * k;
  }

  setEffect(kind: string) {
    const c = this.ensure();
    this.fxIn.disconnect();
    if (kind === 'echo') {
      const d = c.createDelay(); d.delayTime.value = 0.28; const fb = c.createGain(); fb.gain.value = 0.38;
      this.fxIn.connect(this.master); this.fxIn.connect(d); d.connect(fb); fb.connect(d); d.connect(this.master);
    } else if (kind === 'underwater') {
      const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 600; this.fxIn.connect(f); f.connect(this.master);
    } else if (kind === 'radio') {
      const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1800; f.Q.value = 1.4;
      const ws = c.createWaveShaper(); const curve = new Float32Array(256); for (let i = 0; i < 256; i++) { const x = i / 128 - 1; curve[i] = Math.tanh(x * 3); } ws.curve = curve;
      this.fxIn.connect(f); f.connect(ws); ws.connect(this.master);
    } else this.fxIn.connect(this.master);
  }

  stop(what: string) {
    if (what === 'music' || what === 'all') { this.music?.stop(); this.music = null; }
    if (what === 'all') { for (const s of this.active) try { s.stop(); } catch { /* already stopped */ } this.active.clear(); }
  }

  play(name: string, volume = 0.8, opts: { loop?: boolean; music?: boolean; position?: [number, number, number] } = {}) {
    const c = this.ensure();
    const lib = this.library, set = lib?.settings[name];
    const cat = categoryOf(name, lib ?? undefined);
    const base = volume * (set?.volume ?? 1) * (lib?.buses[cat] ?? 1);
    let vol = base * (this.playerBus[cat] ?? 1);
    const spread = set?.pitchVariation ?? 0;
    this.pitch = Math.max(0.1, (set?.pitch ?? 1) * (1 + (Math.random() * 2 - 1) * spread));
    let pan = 0;
    if (opts.position) {
      const [x, y, z] = opts.position; const [lx, ly, lz] = this.listener;
      const d = Math.hypot(x - lx, y - ly, z - lz);
      vol *= 1 / (1 + d * 0.15);
      pan = Math.max(-1, Math.min(1, (x - lx) / 10));
    }
    const out = c.createGain(); out.gain.value = vol;
    const p = c.createStereoPanner(); p.pan.value = pan;
    out.connect(p); p.connect(this.fxIn);
    const file = lib?.files[name];
    const url = file ? (file.startsWith('data:') ? file : this.resolveUrl(file)) : this.resolveUrl(name);
    // An imported file marked as Music replaces the current music and loops.
    const asMusic = opts.music || (!!url && categoryOf(name, lib ?? undefined) === 'music');
    // Music follows the player's Music volume even when started as another category (a looped file marked music).
    const music = (start: () => { stop: () => void }) => { this.music?.stop(); out.gain.value = base * (this.playerBus.music ?? 1); this.musicOut = { gain: out, base }; this.music = start(); };
    const song = lib?.songs?.[name];
    if (song) { music(() => this.playSong(song, out)); return; }
    if (!url && (opts.music || name.startsWith('music:'))) { music(() => this.playMusic(name, out)); return; }
    if (url) {
      if (asMusic) { music(() => this.playFile(url, out, true)); return; }
      this.playFile(url, out, !!opts.loop);
      return;
    }
    const custom = lib?.custom[name];
    if (custom) { this.synthCustom(custom, out); return; }
    this.synth(name, out);
  }

  // ---- songs from the music editor: rendered to a buffer once per version of the song
  private songBuffers = new Map<string, AudioBuffer>();
  private songBuffer(song: Song): AudioBuffer {
    const key = JSON.stringify(song);
    let b = this.songBuffers.get(key);
    if (!b) {
      const c = this.ensure();
      const r = renderSong(song, c.sampleRate);
      b = c.createBuffer(2, r.left.length, r.sampleRate);
      b.copyToChannel(r.left, 0); b.copyToChannel(r.right, 1);
      this.songBuffers.set(key, b);
      if (this.songBuffers.size > 8) this.songBuffers.delete(this.songBuffers.keys().next().value!);
    }
    return b;
  }
  private playSong(song: Song, out: AudioNode): { stop: () => void } {
    const c = this.ctx!, s = c.createBufferSource();
    s.buffer = this.songBuffer(song); s.loop = song.loop; s.connect(out); s.start();
    this.track(s);
    return { stop: () => { try { s.stop(); } catch { /* ended */ } } };
  }
  /** The music editor's Play: from a place in the song, telling where it has got to. */
  playSongPreview(song: Song, from = 0): SongPlayback {
    const c = this.ensure(), s = c.createBufferSource(), buf = this.songBuffer(song);
    s.buffer = buf; s.loop = song.loop;
    const g = c.createGain(); g.gain.value = 0.9; s.connect(g); g.connect(this.fxIn);
    const at = Math.max(0, from % buf.duration), t0 = c.currentTime + 0.02;
    s.start(t0, at);
    return { stop: () => { try { s.stop(); } catch { /* ended */ } s.disconnect(); g.disconnect(); }, position: () => { const p = Math.max(0, c.currentTime - t0) + at; return song.loop ? p % buf.duration : Math.min(p, buf.duration); } };
  }
  /** One note, heard as it is placed. */
  playMusicNote(ch: Pick<MusicChannel, 'drum' | 'ins'>, pitch: number, seconds: number) {
    const c = this.ensure(), d = renderNote(ch, pitch, seconds, c.sampleRate), b = c.createBuffer(1, d.length, c.sampleRate);
    b.copyToChannel(d, 0);
    const s = c.createBufferSource(); s.buffer = b; s.connect(this.fxIn); s.start(); this.track(s);
  }

  private playFile(url: string, out: GainNode, loop: boolean): { stop: () => void } {
    const c = this.ctx!;
    const rate = this.pitch;
    let b = this.buffers.get(url);
    if (!b) { b = fetch(url).then((r) => r.arrayBuffer()).then((a) => c.decodeAudioData(a)); this.buffers.set(url, b); }
    let src: AudioBufferSourceNode | null = null, stopped = false;
    b.then((buf) => { if (stopped) return; const s = c.createBufferSource(); s.buffer = buf; s.loop = loop; s.playbackRate.value = rate; s.connect(out); s.start(); this.track(s); src = s; }).catch(() => this.synth('click', out));
    return { stop: () => { stopped = true; try { src?.stop(); } catch { /* ended */ } } };
  }

  /** Duration of a decoded file in seconds (null until loaded / on failure). */
  async fileDuration(url: string): Promise<number | null> {
    const c = this.ensure();
    let b = this.buffers.get(url);
    if (!b) { b = fetch(url).then((r) => r.arrayBuffer()).then((a) => c.decodeAudioData(a)); this.buffers.set(url, b); }
    return b.then((x) => x.duration).catch(() => null);
  }

  /** A Sound-panel synth sound: an oscillator sweep with optional noise, vibrato and repeats. */
  private synthCustom(s: SynthSound, out: AudioNode) {
    const c = this.ctx!;
    const p = this.pitch;
    const t0 = c.currentTime + 0.005;
    for (let k = 0; k <= Math.min(16, s.repeats); k++) {
      const t = t0 + k * (s.duration + s.repeatGap) / p;
      const step = Math.pow(2, (k * s.repeatStep) / 12) * p;
      const dur = Math.max(0.01, s.duration / p);
      const toneGain = s.gain * (1 - s.noise);
      if (toneGain > 0.001) {
        const o = c.createOscillator(); o.type = s.wave;
        o.frequency.setValueAtTime(Math.max(20, s.startFreq * step), t);
        o.frequency.exponentialRampToValueAtTime(Math.max(20, s.endFreq * step), t + dur);
        if (s.vibrato > 0) {
          const lfo = c.createOscillator(); lfo.frequency.value = s.vibratoSpeed;
          const depth = c.createGain(); depth.gain.value = s.startFreq * step * s.vibrato * 0.5;
          lfo.connect(depth); depth.connect(o.frequency); lfo.start(t); lfo.stop(t + dur + 0.02);
        }
        const g = c.createGain();
        g.gain.setValueAtTime(s.attack > 0 ? 0.0001 : toneGain, t);
        if (s.attack > 0) g.gain.exponentialRampToValueAtTime(toneGain, t + Math.min(s.attack, dur * 0.9));
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(g); g.connect(out); o.start(t); o.stop(t + dur + 0.02); this.track(o);
      }
      if (s.noise > 0) this.noise(out, t, dur, s.noiseFreq * p, s.gain * s.noise * 1.4);
    }
  }

  private track(s: AudioScheduledSourceNode) { this.active.add(s); s.onended = () => this.active.delete(s); }

  private tone(out: AudioNode, type: OscillatorType, f0: number, f1: number, t0: number, dur: number, gain = 0.4) {
    const c = this.ctx!;
    const o = c.createOscillator(); o.type = type;
    f0 *= this.pitch; f1 *= this.pitch;
    o.frequency.setValueAtTime(f0, t0); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
    const g = c.createGain(); g.gain.setValueAtTime(gain, t0); g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    o.connect(g); g.connect(out); o.start(t0); o.stop(t0 + dur + 0.02); this.track(o);
  }

  private noise(out: AudioNode, t0: number, dur: number, freq: number, gain = 0.5, q = 0.8) {
    const c = this.ctx!;
    const len = Math.ceil(c.sampleRate * dur);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0); for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const s = c.createBufferSource(); s.buffer = buf;
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain(); g.gain.setValueAtTime(gain, t0); g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    s.connect(f); f.connect(g); g.connect(out); s.start(t0); this.track(s);
  }

  private synth(name: string, out: AudioNode) {
    const t = this.ctx!.currentTime;
    switch (name) {
      case 'coin': this.tone(out, 'square', 988, 988, t, 0.07, 0.25); this.tone(out, 'square', 1319, 1319, t + 0.07, 0.25, 0.25); break;
      case 'jump': this.tone(out, 'square', 220, 660, t, 0.18, 0.25); break;
      case 'shoot': this.noise(out, t, 0.18, 3000, 0.5); this.tone(out, 'sawtooth', 600, 80, t, 0.15, 0.25); break;
      case 'hit': this.noise(out, t, 0.12, 900, 0.6); this.tone(out, 'triangle', 180, 60, t, 0.12, 0.4); break;
      case 'explosion': this.noise(out, t, 0.9, 500, 0.9, 0.5); this.tone(out, 'sine', 90, 30, t, 0.7, 0.6); break;
      case 'dig': this.noise(out, t, 0.12, 700, 0.5); this.noise(out, t + 0.08, 0.15, 400, 0.4); break;
      case 'pickup': this.tone(out, 'triangle', 440, 880, t, 0.12, 0.3); break;
      case 'throw': case 'swing': this.noise(out, t, 0.25, 1800, 0.35, 4); break;
      case 'win': [523, 659, 784, 1047].forEach((f, i) => this.tone(out, 'square', f, f, t + i * 0.12, 0.2, 0.22)); break;
      case 'lose': [392, 330, 262, 196].forEach((f, i) => this.tone(out, 'triangle', f, f * 0.98, t + i * 0.18, 0.3, 0.3)); break;
      case 'reload': this.tone(out, 'square', 1200, 1100, t, 0.04, 0.2); this.tone(out, 'square', 900, 850, t + 0.25, 0.05, 0.2); break;
      case 'step': this.noise(out, t, 0.06, 500, 0.3); break;
      case 'engine': this.tone(out, 'sawtooth', 70, 90, t, 0.4, 0.12); break;
      case 'click': default: this.tone(out, 'square', 1500, 1500, t, 0.03, 0.15);
    }
  }

  private playMusic(name: string, out: GainNode): { stop: () => void } {
    const c = this.ctx!;
    const songs: Record<string, { bpm: number; lead: Note[]; bass: Note[] }> = {
      'music:adventure': { bpm: 132, lead: [[72, 1], [74, 1], [76, 2], [79, 1], [76, 1], [74, 2], [72, 1], [71, 1], [72, 2], [67, 2], [69, 1], [71, 1], [72, 2], [74, 2], [72, 4]], bass: [[48, 4], [43, 4], [45, 4], [41, 4], [48, 4], [43, 4]] },
      'music:calm': { bpm: 84, lead: [[64, 2], [67, 2], [69, 4], [67, 2], [64, 2], [62, 4], [60, 4], [62, 4]], bass: [[48, 8], [45, 8], [41, 8], [43, 8]] },
    };
    const song = songs[name] ?? songs['music:adventure'];
    const beat = 60 / song.bpm;
    const hz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
    let stopped = false;
    const len = (notes: Note[]) => notes.reduce((a, n) => a + n[1], 0);
    const loopBeats = Math.max(len(song.lead), len(song.bass));
    let start = c.currentTime + 0.05;
    const pitch = this.pitch;
    const schedule = () => {
      if (stopped) return;
      const was = this.pitch; this.pitch = pitch;
      let t = start;
      for (const [m, b] of song.lead) { this.tone(out, 'square', hz(m), hz(m), t, b * beat * 0.9, 0.08); t += b * beat; }
      t = start;
      for (const [m, b] of song.bass) { this.tone(out, 'triangle', hz(m), hz(m), t, b * beat * 0.95, 0.12); t += b * beat; }
      this.pitch = was;
      start += loopBeats * beat;
      timer = window.setTimeout(schedule, Math.max(50, (start - c.currentTime - 0.5) * 1000));
    };
    let timer = 0;
    schedule();
    return { stop: () => { stopped = true; clearTimeout(timer); out.gain.setTargetAtTime(0, c.currentTime, 0.05); } };
  }
}

export const audio = new AudioSystem();
