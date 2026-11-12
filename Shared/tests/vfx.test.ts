// ParticleCraft effects: graph compilation, presets, asset round trip and playing them in the shared runtime.
import { describe, expect, it } from 'vitest';
import { block, doc, event, scene } from './helpers';
import { VFX_PRESETS, compileGraph, finalizeAsset, newAsset, newBlock, newSystem, parseVfxAsset } from '../src/vfx/vfx';
import { Emitter, customVfxExposed } from '../src/runtime/particles';
import { Runtime, customParticlePresets } from '../src/runtime/runtime';

describe('VFX graph', () => {
  it('every preset compiles to playable layers without warnings', () => {
    for (const p of VFX_PRESETS) {
      const r = compileGraph(p.build());
      expect(r.layers.length, p.id).toBeGreaterThan(0);
      expect(r.warnings, p.id).toEqual([]);
      // Every layer spawns: a rate, a burst, repeating bursts, or another layer's sub-emitter feeding it.
      const fed = new Set(r.layers.flatMap((l) => (l.params.subEmitters ?? []).map((s) => s.layer)));
      r.layers.forEach((l, i) => expect(l.params.rate > 0 || l.params.burst > 0 || !!l.params.bursts?.length || fed.has(i), `${p.id}/${l.name}`).toBe(true));
    }
  });

  it('blocks map onto engine parameters; disabled blocks and systems are skipped', () => {
    const s = newSystem('A', 0, 0, { spawn: [newBlock('rate', { rate: 50 })], init: [newBlock('lifetime', { min: 1, max: 3 })], update: [newBlock('vortex', { strength: 4, pull: 1 }), { ...newBlock('gravity', { strength: -9 }), enabled: false }], output: [newBlock('render', { texture: 'star' }), newBlock('colorOverLife', { start: '#ff0000', useMid: true, mid: '#00ff00', end: '#0000ff' })] });
    const off = { ...newSystem('B'), enabled: false };
    const r = compileGraph({ systems: [s, off], params: [] });
    expect(r.layers).toHaveLength(1);
    const p = r.layers[0].params;
    expect([p.rate, p.lifetime, p.lifetimeVar, p.vortex, p.vortexPull, p.gravity, p.texture, p.colorMid]).toEqual([50, 2, 1, 4, 1, 0, 'star', '#00ff00']);
  });

  it('exposed parameters override block values and name the engine field they drive', () => {
    const g = VFX_PRESETS.find((p) => p.id === 'tornado')!.build();
    g.params[0].value = 20;
    const r = compileGraph(g);
    expect(r.layers[0].params.vortex).toBe(20);
    expect(r.exposed).toEqual([{ name: 'Spin', type: 'number', value: 20, targets: [{ layer: 0, param: 'vortex' }] }]);
  });

  it('assets round trip and report what each game cannot reproduce', () => {
    const a = finalizeAsset(newAsset('Rain', VFX_PRESETS.find((p) => p.id === 'rain')!.build()));
    const back = parseVfxAsset(JSON.stringify(a));
    expect(back.layers?.[0].params.trail).toBeGreaterThan(0);
    expect(back.compatibility?.gamecraft.join()).toMatch(/trails/);
    expect(() => parseVfxAsset('{"format":"other"}')).toThrow(/ParticleCraft/);
  });
});

describe('Particle engine additions', () => {
  it('vortex swirls particles around the emitter; turbulence changes paths', () => {
    const base = { rate: 0, burst: 50, lifetime: 5, lifetimeVar: 0, speed: 0, speedVar: 0, shape: 'circle' as const, shapeSize: [1, 0, 1] as [number, number, number], seed: 3 };
    const calm = new Emitter('a', base), swirl = new Emitter('b', { ...base, vortex: 5 }), noisy = new Emitter('c', { ...base, turbulence: 3 });
    for (const e of [calm, swirl, noisy]) for (let i = 0; i < 30; i++) e.update(1 / 60);
    const moved = (e: Emitter) => Math.hypot(e.px[0] - calm.px[0], e.pz[0] - calm.pz[0], e.py[0] - calm.py[0]);
    expect(moved(swirl)).toBeGreaterThan(0.05);
    expect(moved(noisy)).toBeGreaterThan(0.05);
    // Pure swirl keeps the distance from the axis roughly the same (tangential motion).
    for (let k = 0; k < 10; k++) {
      const r0 = Math.hypot(calm.px[k], calm.pz[k]), r1 = Math.hypot(swirl.px[k], swirl.pz[k]);
      expect(Math.abs(r1 - r0)).toBeLessThan(0.15);
    }
  });

  it('color over life passes through the middle color', () => {
    const e = new Emitter('c', { rate: 0, burst: 1, lifetime: 1, lifetimeVar: 0, colorStart: '#ff0000', colorMid: '#00ff00', colorEnd: '#0000ff' });
    e.update(0.5);
    const [r, g, b] = e.colorAt(0);
    expect(g).toBeGreaterThan(0.9); expect(r).toBeLessThan(0.1); expect(b).toBeLessThan(0.1);
  });
});

describe('Imported effects in the games', () => {
  it('sub-emitters work in the game runtime: layers are linked and event-only layers are kept alive', () => {
    const g = VFX_PRESETS.find((p) => p.id === 'r-droplets')!.build();
    const r = compileGraph(g);
    r.layers.forEach((l, i) => customParticlePresets.set(i ? `Drips#${i + 1}` : 'Drips', l.params));
    const d = doc([event([block('system.on_start_of_layout')], [block('particles.attach', { preset: 'Drips' }, 'Box')])]);
    const rt = new Runtime(scene([{ type: 'Box', kind: 'box' }], '3d'), d, { app: 'gamecraft' });
    let most = 0;
    for (let k = 0; k < 60 * 4; k++) { rt.tick(); most = Math.max(most, [...rt.emitters.values()].find((e) => e.presetName === 'Drips#2')?.count ?? 0); }
    const ems = [...rt.emitters.values()];
    const splash = ems.find((e) => e.presetName === 'Drips#2')!;
    expect(ems.find((e) => e.presetName === 'Drips')!.links).toContain(splash);
    expect(most).toBeGreaterThan(0); // drops hit the ground and spawned splashes
    expect(splash.done).toBe(false); // fed by a running layer: never "done"
  });

  it('a multi-system effect spawns every layer, and exposed parameters change at runtime', () => {
    const g = VFX_PRESETS.find((p) => p.id === 'tornado')!.build();
    const r = compileGraph(g);
    r.layers.forEach((l, i) => customParticlePresets.set(i ? `Twister#${i + 1}` : 'Twister', l.params));
    customVfxExposed.set('Twister', r.exposed.map((e) => ({ name: e.name, targets: e.targets })));
    const d = doc([event([block('system.on_start_of_layout')], [block('particles.attach', { preset: 'Twister' }, 'Box'), block('particles.set_exposed', { name: 'Spin', value: '25' }, 'Box')])]);
    const rt = new Runtime(scene([{ type: 'Box', kind: 'box' }], '3d'), d, { app: 'gamecraft' });
    rt.tick();
    const ems = [...rt.emitters.values()];
    expect(ems.map((e) => e.presetName).sort()).toEqual(['Twister', 'Twister#2']);
    expect(ems.find((e) => e.presetName === 'Twister')!.params.vortex).toBe(25);
    expect(ems.find((e) => e.presetName === 'Twister#2')!.params.vortex).toBe(r.layers[1].params.vortex); // only layer 0 is bound
  });
});
