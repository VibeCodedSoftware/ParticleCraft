// Songs: the notes that are written are the notes that come out, loops are seamless in length, and WAVs are valid.
import { describe, expect, it } from 'vitest';
import { categoryOf, emptyLibrary, soundNames } from '../src/sounds';
import { encodeWav, newChannel, newSong, renderNote, renderSong, scaleNotes, setBars, songSeconds, surpriseSong, type Song } from '../src/music';

const rms = (a: Float32Array, from = 0, to = a.length) => { let s = 0; for (let i = from; i < to; i++) s += a[i] * a[i]; return Math.sqrt(s / Math.max(1, to - from)); };
/** Strongest frequency by autocorrelation-free zero crossings: good enough for a pure tone. */
const pitchOf = (a: Float32Array, sr: number, from: number, to: number) => { let z = 0; for (let i = from + 1; i < to; i++) if (a[i - 1] <= 0 && a[i] > 0) z++; return (z / (to - from)) * sr; };
function oneNote(p = 69, s = 0, l = 16): Song {
  const c = newChannel('A', false, 1, { wave: 'sine', envelope: 'held', volume: 1, brightness: 1 });
  c.patterns = [[{ s, l, p }]]; c.seq = [1];
  return { bpm: 120, key: 0, scale: 'major', beats: 4, steps: 4, bars: 1, loop: false, channels: [c] };
}

describe('Scales', () => {
  it('rows hold only the notes of the key and scale', () => {
    expect(scaleNotes({ key: 0, scale: 'major' }, 60, 72)).toEqual([60, 62, 64, 65, 67, 69, 71, 72]);
    expect(scaleNotes({ key: 9, scale: 'minor pentatonic' }, 57, 69)).toEqual([57, 60, 62, 64, 67, 69]);
  });
});
describe('Rendering', () => {
  it('a written A plays at 440 Hz for its written length, then silence', () => {
    const sr = 22050, r = renderSong(oneNote(69, 0, 8), sr);
    expect(songSeconds(oneNote())).toBe(2);
    expect(pitchOf(r.left, sr, 2000, 10000)).toBeGreaterThan(430);
    expect(pitchOf(r.left, sr, 2000, 10000)).toBeLessThan(450);
    expect(rms(r.left, 0, sr)).toBeGreaterThan(0.1); // 8 steps at 120 bpm = 1 s
    expect(rms(r.left, Math.round(sr * 1.3), Math.round(sr * 2))).toBeLessThan(0.001);
  });
  it('a note on a later step starts later; a muted channel and an empty bar are silent', () => {
    const sr = 22050, late = renderSong(oneNote(69, 8, 4), sr);
    expect(rms(late.left, 0, Math.round(sr * 0.9))).toBeLessThan(0.001);
    expect(rms(late.left, Math.round(sr * 1.05), Math.round(sr * 1.4))).toBeGreaterThan(0.1);
    const m = oneNote(); m.channels[0].mute = true;
    expect(rms(renderSong(m, sr).left)).toBe(0);
    const e = oneNote(); e.channels[0].seq = [0];
    expect(rms(renderSong(e, sr).left)).toBe(0);
  });
  it('pan moves the sound; bars of a shared pattern repeat it', () => {
    const sr = 22050, p = oneNote(); p.channels[0].ins.pan = -1;
    const left = renderSong(p, sr);
    expect(rms(left.left)).toBeGreaterThan(0.1); expect(rms(left.right)).toBeLessThan(1e-4);
    const two = setBars(oneNote(69, 0, 4), 2); two.channels[0].seq = [1, 1];
    const r = renderSong(two, sr);
    expect(rms(r.left, Math.round(sr * 2.05), Math.round(sr * 2.4))).toBeGreaterThan(0.1);
  });
  it('a looping song is exactly its bars long, its tail folded onto its start', () => {
    const sr = 22050, s = oneNote(69, 15, 8); s.loop = true; // rings past the end of the bar
    const r = renderSong(s, sr);
    expect(r.left.length).toBe(Math.ceil(2 * sr));
    expect(rms(r.left, 0, Math.round(sr * 0.5))).toBeGreaterThan(0.05);
  });
  it('every drum row and instrument makes sound and never exceeds full scale', () => {
    const d = newChannel('D', true, 1);
    for (let k = 0; k < 8; k++) expect(rms(renderNote(d, k, 0.1, 22050))).toBeGreaterThan(0.005);
    for (const wave of ['sine', 'triangle', 'square', 'pulse', 'saw', 'organ', 'bell', 'bass'] as const) for (const envelope of ['short', 'pluck', 'piano', 'held', 'swell'] as const)
      expect(rms(renderNote({ drum: false, ins: { ...d.ins, wave, envelope, volume: 1, brightness: 1 } }, 60, 0.2, 22050))).toBeGreaterThan(0.005);
    const big = surpriseSong(newSong(), 5);
    big.channels.forEach((c) => { c.ins.volume = 1; });
    const r = renderSong(big, 11025);
    for (const v of r.left) expect(Math.abs(v)).toBeLessThanOrEqual(1);
    expect(rms(r.left)).toBeGreaterThan(0.05);
  });
  it('the same song renders the same, so a game sounds as it did in the editor', () => {
    const s = surpriseSong(newSong(), 9);
    expect(renderSong(s, 8000).left).toEqual(renderSong(s, 8000).left);
    expect(JSON.stringify(surpriseSong(newSong(), 9))).toBe(JSON.stringify(s));
    expect(JSON.stringify(surpriseSong(newSong(), 10))).not.toBe(JSON.stringify(s));
  });
  it('Surprise me writes a melody that moves, not one note', () => {
    for (const seed of [1, 2, 3, 4, 5]) for (const scale of ['major', 'major pentatonic', 'blues']) {
      const mel = surpriseSong({ ...newSong(), scale }, seed).channels[0];
      expect(new Set(mel.patterns.flat().map((n) => n.p)).size).toBeGreaterThan(2);
    }
  });
  it('Surprise me keeps melody and harmony in the scale', () => {
    const base = { ...newSong(), key: 2, scale: 'minor' };
    const allowed = new Set(scaleNotes(base, 0, 127));
    for (const c of surpriseSong(base, 3).channels) if (!c.drum) for (const p of c.patterns) for (const n of p) expect(allowed.has(n.p)).toBe(true);
  });
  it('a WAV has a proper header and every sample', () => {
    const r = renderSong(oneNote(), 8000), b = encodeWav(r), d = new DataView(b);
    expect(String.fromCharCode(d.getUint8(0), d.getUint8(1), d.getUint8(2), d.getUint8(3))).toBe('RIFF');
    expect(d.getUint32(24, true)).toBe(8000); expect(d.getUint16(22, true)).toBe(2);
    expect(b.byteLength).toBe(44 + r.left.length * 4);
  });
});
describe('In the sound list', () => {
  it('a song is a sound name in the music category', () => {
    const lib = { ...emptyLibrary(), songs: { my_song: newSong() } };
    expect(soundNames(lib)).toContain('my_song');
    expect(categoryOf('my_song', lib)).toBe('music');
    expect(categoryOf('coin', lib)).toBe('sfx');
  });
  it('setBars keeps what is there and extends with silence', () => {
    const s = oneNote(); s.channels[0].seq = [1];
    expect(setBars(s, 3).channels[0].seq).toEqual([1, 0, 0]);
    expect(setBars(setBars(s, 3), 1).channels[0].seq).toEqual([1]);
  });
});
