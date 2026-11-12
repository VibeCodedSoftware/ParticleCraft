import { describe, expect, it } from 'vitest';
import { createLogicDocument } from '../src/schema';
import { exportPackage, importPackage } from '../src/interchange';
import { SYNTH_PRESETS, categoryOf, emptyLibrary, soundName, soundNames } from '../src/sounds';

describe('sound library', () => {
  it('lists built-in, designed and imported sounds for Play sound blocks', () => {
    const lib = emptyLibrary();
    lib.custom.zap = SYNTH_PRESETS.laser.make(() => 0.5);
    lib.files.theme = 'proj:imported/files/theme.ogg';
    const names = soundNames(lib);
    expect(names).toContain('coin');
    expect(names).toContain('zap');
    expect(names).toContain('theme');
  });

  it('categories default sensibly and can be overridden', () => {
    const lib = emptyLibrary();
    expect(categoryOf('music:calm', lib)).toBe('music');
    expect(categoryOf('coin', lib)).toBe('sfx');
    lib.settings.theme = { category: 'music' };
    expect(categoryOf('theme', lib)).toBe('music');
  });

  it('presets make playable values', () => {
    for (const p of Object.values(SYNTH_PRESETS)) {
      const s = p.make(Math.random);
      expect(s.duration).toBeGreaterThan(0);
      expect(s.startFreq).toBeGreaterThan(20);
      expect(s.gain).toBeGreaterThan(0);
    }
  });

  it('file names become safe sound names', () => {
    expect(soundName('Big Boom (final).wav')).toBe('Big_Boom_final');
  });

  it('the library travels with logic between the apps', () => {
    const doc = createLogicDocument('t', 'gamecraft', 'xz');
    doc.sounds = { ...emptyLibrary(), custom: { zap: SYNTH_PRESETS.laser.make(() => 0.3) } };
    const back = importPackage(exportPackage(doc, null, 'gamecraft'), 'logiccraft');
    expect(back.doc.sounds?.custom.zap.wave).toBe(doc.sounds.custom.zap.wave);
  });
});
