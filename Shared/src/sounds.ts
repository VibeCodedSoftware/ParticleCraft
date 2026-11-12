// Project sound library, stored in the logic document so both apps (and the runtime) share it:
// custom synthesized sounds, imported audio files, per-sound mix settings and category volumes.
import { BUILTIN_SOUNDS } from './blocks/definitions';
import type { Song } from './music';

export type SoundCategory = 'sfx' | 'music' | 'ui' | 'ambience';
export const SOUND_CATEGORIES: { id: SoundCategory; name: string }[] = [
  { id: 'sfx', name: 'Sound effects' }, { id: 'music', name: 'Music' }, { id: 'ui', name: 'Interface' }, { id: 'ambience', name: 'Ambience' },
];

/** A sound made from oscillators and noise (no file needed). Frequencies in Hz, times in seconds. */
export interface SynthSound {
  wave: 'square' | 'sine' | 'triangle' | 'sawtooth';
  startFreq: number; endFreq: number;
  duration: number;
  /** 0-1 mix of filtered noise (hits, explosions, footsteps). */
  noise: number;
  noiseFreq: number;
  /** Seconds to fade in. */
  attack: number;
  /** Vibrato depth (0-1) and speed (Hz). */
  vibrato: number; vibratoSpeed: number;
  /** Extra repeats (arpeggio/echo) and the pitch step between repeats (semitones). */
  repeats: number; repeatGap: number; repeatStep: number;
  gain: number;
}

export interface SoundSetting {
  /** 0-2 multiplier on the block's volume. */
  volume?: number;
  /** Playback rate / pitch multiplier (1 = normal). */
  pitch?: number;
  /** Random pitch spread per play (0-0.5), so repeated sounds do not feel mechanical. */
  pitchVariation?: number;
  category?: SoundCategory;
}

export interface SoundLibrary {
  custom: Record<string, SynthSound>;
  /** Imported files: sound name -> asset id (GameCraft) or data URL (LogicCraft). */
  files: Record<string, string>;
  settings: Record<string, SoundSetting>;
  /** Songs from the music editor. */
  songs?: Record<string, Song>;
  /** Category volumes 0-1. */
  buses: Record<SoundCategory, number>;
}

export const emptyLibrary = (): SoundLibrary => ({ custom: {}, files: {}, settings: {}, buses: { sfx: 1, music: 1, ui: 1, ambience: 1 } });

export const DEFAULT_SYNTH: SynthSound = { wave: 'square', startFreq: 440, endFreq: 880, duration: 0.15, noise: 0, noiseFreq: 2000, attack: 0, vibrato: 0, vibratoSpeed: 8, repeats: 0, repeatGap: 0.08, repeatStep: 4, gain: 0.3 };

/** Starting points for the sound designer (and the "Randomize" button). */
export const SYNTH_PRESETS: Record<string, { name: string; make: (r: () => number) => SynthSound }> = {
  coin: { name: 'Coin / pickup', make: (r) => ({ ...DEFAULT_SYNTH, wave: 'square', startFreq: 700 + r() * 500, endFreq: 900 + r() * 700, duration: 0.08 + r() * 0.08, repeats: 1, repeatGap: 0.07, repeatStep: 5 + Math.round(r() * 4), gain: 0.25 }) },
  jump: { name: 'Jump', make: (r) => ({ ...DEFAULT_SYNTH, wave: r() < 0.5 ? 'square' : 'triangle', startFreq: 160 + r() * 140, endFreq: 500 + r() * 500, duration: 0.15 + r() * 0.12, gain: 0.25 }) },
  laser: { name: 'Laser', make: (r) => ({ ...DEFAULT_SYNTH, wave: r() < 0.5 ? 'sawtooth' : 'square', startFreq: 900 + r() * 900, endFreq: 80 + r() * 200, duration: 0.12 + r() * 0.15, gain: 0.22 }) },
  hit: { name: 'Hit / hurt', make: (r) => ({ ...DEFAULT_SYNTH, wave: 'triangle', startFreq: 200 + r() * 200, endFreq: 50 + r() * 50, duration: 0.1 + r() * 0.1, noise: 0.5 + r() * 0.4, noiseFreq: 800 + r() * 1200, gain: 0.4 }) },
  explosion: { name: 'Explosion', make: (r) => ({ ...DEFAULT_SYNTH, wave: 'sine', startFreq: 80 + r() * 60, endFreq: 25 + r() * 15, duration: 0.6 + r() * 0.6, noise: 0.9, noiseFreq: 300 + r() * 500, gain: 0.6 }) },
  powerup: { name: 'Power-up', make: (r) => ({ ...DEFAULT_SYNTH, wave: 'square', startFreq: 300 + r() * 200, endFreq: 600 + r() * 400, duration: 0.09, repeats: 3 + Math.round(r() * 2), repeatGap: 0.07, repeatStep: 3 + Math.round(r() * 3), vibrato: 0.1, gain: 0.2 }) },
  blip: { name: 'Menu blip', make: (r) => ({ ...DEFAULT_SYNTH, wave: 'sine', startFreq: 900 + r() * 600, endFreq: 900 + r() * 600, duration: 0.04 + r() * 0.04, gain: 0.25 }) },
  step: { name: 'Footstep', make: (r) => ({ ...DEFAULT_SYNTH, wave: 'sine', startFreq: 120, endFreq: 60, duration: 0.05 + r() * 0.04, noise: 0.9, noiseFreq: 400 + r() * 400, gain: 0.35 }) },
  alarm: { name: 'Alarm', make: (r) => ({ ...DEFAULT_SYNTH, wave: 'sawtooth', startFreq: 600 + r() * 200, endFreq: 600 + r() * 200, duration: 0.25, vibrato: 0.3, vibratoSpeed: 6 + r() * 6, repeats: 2, repeatGap: 0.1, repeatStep: 0, gain: 0.18 }) },
};

/** Every sound name a "Play sound" block can use in this project. */
export function soundNames(lib: SoundLibrary | undefined): string[] {
  return [...BUILTIN_SOUNDS, ...Object.keys(lib?.custom ?? {}), ...Object.keys(lib?.files ?? {}), ...Object.keys(lib?.songs ?? {})];
}

export function categoryOf(name: string, lib?: SoundLibrary): SoundCategory {
  return lib?.settings[name]?.category ?? (name.startsWith('music:') || lib?.songs?.[name] ? 'music' : name === 'click' ? 'ui' : 'sfx');
}

/** Safe sound name from a file name or user text. */
export const soundName = (s: string) => s.replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9_ -]/g, '').trim().replace(/\s+/g, '_') || 'sound';
