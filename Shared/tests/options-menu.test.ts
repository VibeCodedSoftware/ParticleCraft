// Global options menu (Options screen pack): volumes per category, graphics quality, full screen, sensitivity; saved
// between sessions, and only these settings (loading them never rolls back the score).
import { describe, expect, it } from 'vitest';
import { doc, num } from './helpers';
import { Runtime } from '../src/runtime/runtime';
import { emptyScene } from '../src/runtime/scene';
import { PACK_BY_ID, installPack } from '../src/packs';

describe('options from the pause menu', () => {
  it('takes the pause menu\'s place, Back returns, also after loading a save', () => {
    const store = new Map<string, string>();
    const s = emptyScene('t', '3d'), d = doc([]);
    const ctx = { app: 'gamecraft' as const, mode: '3d' as const };
    installPack(d, undefined, s, PACK_BY_ID['menu.pause'], { key: 'Escape', slot: 'save1', saving: true, quit: true }, ctx);
    installPack(d, undefined, s, PACK_BY_ID['menu.options'], {}, ctx);
    const rt = new Runtime(s, d, { app: 'gamecraft', host: { storage: { get: (k: string) => store.get(k) ?? null, set: (k: string, v: string) => void store.set(k, v) } } });
    rt.tick();
    const shown = (n: string) => rt.world.findByName(n)!.visible;
    const click = (n: string) => { rt.input.uiButtons.push(n); rt.tick(); };
    const esc = () => { rt.input.keyDown('Escape'); rt.tick(); rt.input.keyUp('Escape'); rt.tick(); };
    const check = () => {
      esc();
      expect(shown('ResumeButton')).toBe(true); expect(shown('OptionsPanel')).toBe(false);
      click('PauseOptionsButton');
      expect(shown('OptionsPanel')).toBe(true); expect(shown('ResumeButton')).toBe(false);
      click('OptionsBack');
      expect(shown('OptionsPanel')).toBe(false); expect(shown('ResumeButton')).toBe(true);
    };
    check();
    click('SaveButton');
    click('LoadButton');
    expect(shown('ResumeButton')).toBe(false);
    expect(rt.timeScale).toBe(1);
    check(); // the same after a load
    // While paused the labels still follow the buttons.
    click('PauseOptionsButton');
    click('VolumeUp');
    expect(rt.globals.volume).toBe(90);
    rt.tick();
    expect(rt.world.findByName('VolumeText')!.text!.text).toBe('Volume 90');
    click('QualityButton');
    expect(rt.world.findByName('QualityText')!.text!.text).toBe('Graphics: Ultra');
  });
});

describe('options menu', () => {
  it('applies and saves the options only', () => {
    const store = new Map<string, string>();
    const calls: string[] = [];
    const host = {
      storage: { get: (k: string) => store.get(k) ?? null, set: (k: string, v: string) => void store.set(k, v) },
      setVolume: (v: number) => calls.push(`master ${v}`), setBusVolume: (c: string, v: number) => calls.push(`${c} ${v}`),
      setQuality: (q: string) => calls.push(`quality ${q}`), setFullscreen: (on: boolean) => calls.push(`fullscreen ${on}`),
    };
    const make = () => {
      const s = emptyScene('t', '3d'), d = doc([], [num('score')]);
      installPack(d, undefined, s, PACK_BY_ID['menu.options'], {}, { app: 'gamecraft', mode: '3d' });
      return new Runtime(s, d, { app: 'gamecraft', host });
    };
    const rt = make();
    rt.tick();
    expect(calls).toContain('music 0.8'); expect(calls).toContain('quality high');
    const click = (n: string) => { rt.input.uiButtons.push(n); rt.tick(); };
    click('MusicDown'); click('MusicDown');
    expect(calls).toContain('music 0.6');
    click('QualityButton'); click('QualityButton'); // high → ultra → low
    expect(calls.slice(-3).some((c) => c === 'quality low')).toBe(true);
    click('FullscreenButton');
    expect(calls).toContain('fullscreen true');
    expect(rt.world.findByName('FullscreenText')!.text!.text).toBe('Full screen: On');
    rt.globals.score = 500;
    click('VolumeDown'); // saves again
    const saved = JSON.parse(store.get('craft.save.options')!);
    expect(saved).toMatchObject({ music: 60, quality: 0, volume: 70 });
    expect('score' in saved).toBe(false);
    // Next session: the options come back, the score starts fresh.
    calls.length = 0;
    const next = make();
    next.tick();
    expect(next.globals.music).toBe(60); expect(next.globals.quality).toBe(0); expect(next.globals.score).toBe(0);
    expect(calls).toContain('music 0.6'); expect(calls).toContain('quality low');
  });
});
