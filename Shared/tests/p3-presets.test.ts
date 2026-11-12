// P3: every preset builds real, known blocks; saving a group as your own preset and applying it to another object
// type; the preview; touch presets; trails (particles / paint, nothing while standing, oldest cleaned up); the paint
// gun; enemies that move only when unseen / only when you move.
import { describe, expect, it } from 'vitest';
import { block, doc, event, num, scene } from './helpers';
import { Runtime } from '../src/runtime/runtime';
import { behaviorDefaults } from '../src/runtime/behaviors';
import { ACTIONS } from '../src/runtime/blockImpl';
import { BLOCK_DEFS } from '../src/blocks/definitions';
import { PACKS, customToPack, installPack, packDefaults, presetFromGroup, previewPack, resolvePack } from '../src/packs';
import { group, walkEvents } from '../src/schema';

const bh = (t: string, p: Record<string, any> = {}) => ({ type: t, props: { ...behaviorDefaults(t), ...p } });

describe('presets', () => {
  it('every preset builds in both modes with only known blocks and behaviors', () => {
    for (const pk of PACKS) for (const mode of ['2d', '3d'] as const) {
      if (pk.modes && !pk.modes.includes(mode)) continue;
      const r = pk.build(packDefaults(pk), { app: 'gamecraft', mode });
      walkEvents(r.events, (n) => { if (n.kind === 'event') for (const b of [...n.conditions, ...n.actions]) expect(BLOCK_DEFS[b.block], `${pk.id}: ${b.block}`).toBeDefined(); });
      for (const b of r.behaviors ?? []) expect(behaviorDefaults(b.type), `${pk.id}: ${b.type}`).toBeDefined();
    }
    for (const id of ['move.double', 'move.triple', 'move.dash', 'move.walljump', 'move.glide', 'move.climb', 'platform.oneway', 'touch.thirdperson', 'trail.paint', 'combat.paintgun', 'ai.unseen', 'ai.mimic']) expect(PACKS.some((p) => p.id === id), id).toBe(true);
  });
  it('the preview lists what it adds', () => {
    const pv = previewPack(PACKS.find((p) => p.id === 'move.dash')!, {}, { app: 'gamecraft', mode: '3d' });
    expect(pv.behaviors).toEqual(['platform on Player']);
    expect(pv.blocks).toContain('platform.set_ability'); expect(pv.blocks).toContain('platform.on_dash');
  });
  it('save a group as your own preset, then apply it to another object type (blocks and behaviors follow)', () => {
    const d = doc([group('Hero tricks', [event([block('platform.on_jump', {}, 'Hero')], [block('particles.spawn_at', { preset: 'dust' }, 'Hero')]), event([block('input.on_key_pressed', { key: 'Q' })], [block('platform.dash', {}, 'Hero')])])]);
    const sc = scene([{ uid: 1, type: 'Hero', behaviors: [bh('platform', { dash: true, jumpCount: 2 })] }, { uid: 2, type: 'Robot', behaviors: [] }]);
    const gid = d.sheets[0].events[0].id;
    const cp = presetFromGroup(d, gid, sc, { name: 'Hero tricks' })!;
    expect(cp.target).toBe('Hero'); expect(cp.behaviors![0]).toMatchObject({ type: 'platform', props: { dash: true, jumpCount: 2 } });
    const pack = resolvePack('custom:' + cp.id, d)!;
    expect(pack.category).toBe('My presets');
    const report = installPack(d, d.sheets[0].id, sc, pack, { target: 'Robot' }, { app: 'logiccraft', mode: '2d' });
    expect(report.join()).toMatch(/Added the platform behavior on "Robot"/);
    expect(sc.instances[1].behaviors[0].props).toMatchObject({ dash: true, jumpCount: 2 });
    const added = d.sheets[0].events[1] as any;
    expect(added.children[0].conditions[0].target).toBe('Robot');
    expect(customToPack(cp).options[0].default).toBe('Hero');
  });
  it('a touch preset sets the on-screen layout and its bindings', () => {
    const d = doc([]), sc = scene([]);
    installPack(d, undefined, sc, PACKS.find((p) => p.id === 'touch.platformer')!, {}, { app: 'logiccraft', mode: '2d' });
    expect(d.touchControls?.preset).toBe('platformer');
    expect(d.inputActions?.Jump).toContain('touch:Jump');
  });
});

describe('trails and paint', () => {
  const floor = { uid: 1, type: 'Floor', x: 0, y: -0.5, sx: 60, sy: 1, behaviors: [bh('solid')] };
  it('a paint trail paints while walking, not while standing; the oldest marks are cleaned up', () => {
    const rt = new Runtime(scene([floor, { uid: 2, type: 'Hero', x: 0, y: 0.5, sx: 0.8, sy: 1, behaviors: [bh('platform'), bh('trail', { mode: 'paint', spacing: 0.3, maxMarks: 10 })] }]), doc([]), { app: 'logiccraft' });
    for (let k = 0; k < 30; k++) rt.tick();
    expect(rt.decals.length).toBe(0); // standing still
    rt.input.keyDown('D'); for (let k = 0; k < 120; k++) rt.tick();
    expect(rt.decals.length).toBe(10); // capped
    expect(rt.decals.every((d) => d.uid === 1 && d.color === '#3aa0ff' && d.life === 0)).toBe(true);
  });
  it('a particle trail puffs while moving', () => {
    const rt = new Runtime(scene([floor, { uid: 2, type: 'Hero', x: 0, y: 0.5, sx: 0.8, sy: 1, behaviors: [bh('platform'), bh('trail', { mode: 'particles', preset: 'dust' })] }]), doc([]), { app: 'logiccraft' });
    for (let k = 0; k < 10; k++) rt.tick();
    const before = rt.emitters.size;
    rt.input.keyDown('D'); for (let k = 0; k < 30; k++) rt.tick();
    expect(rt.emitters.size).toBeGreaterThan(before);
  });
  it('the paint gun paints what it hits (On painted); Clear paint removes it', () => {
    const d = doc([event([block('paint.on_painted', {}, 'Wall')], [block('var.add', { variable: 'hits', value: '1' })])], [num('hits')], 'xz');
    const rt = new Runtime(scene([{ uid: 1, type: 'Wall', x: 5, y: 1, z: 0, sx: 1, sy: 3, sz: 4, behaviors: [bh('solid')] }, { uid: 2, type: 'Hero', x: 0, y: 1, z: 0 }], '3d'), d, { app: 'gamecraft' });
    const hero = rt.world.of('Hero')[0];
    ACTIONS['paint.shoot'](rt, block('paint.shoot', { color: '"#00ff00"', size: '0.6', range: '20', impact: 'none' }, 'Hero') as any, {} as any, hero as any);
    rt.tick();
    expect(rt.decals).toHaveLength(1); expect(rt.decals[0]).toMatchObject({ uid: 1, color: '#00ff00', pool: 'paintgun' });
    expect(rt.globals.hits).toBe(1);
    ACTIONS['paint.clear'](rt, block('paint.clear', { what: 'paint guns' }) as any, {} as any, undefined as any);
    expect(rt.decals).toHaveLength(0);
  });
});

describe('special enemy AI', () => {
  const mk = (type: string) => new Runtime(scene([
    { uid: 1, type: 'Player', x: 0, y: 0.5, z: 0, behaviors: [bh('health')] },
    { uid: 2, type: 'Enemy', x: 10, y: 0.5, z: 0, behaviors: [bh(type, { target: 'Player', speed: 4, viewer: 'player facing' })] },
  ], '3d'), doc([], [], 'xz'), { app: 'gamecraft' });
  it('moves when unseen: frozen while the player faces it, creeps closer when they turn away', () => {
    const rt = mk('unseen'), e = rt.world.of('Enemy')[0], pl = rt.world.of('Player')[0];
    pl.ry = 0; // facing +x, toward the enemy
    for (let k = 0; k < 60; k++) rt.tick();
    expect(e.x).toBeCloseTo(10, 3); expect(e.state.enemy.seen).toBe(true);
    pl.ry = 180; // looking away
    for (let k = 0; k < 60; k++) rt.tick();
    expect(e.x).toBeLessThan(7); expect(e.state.enemy.seen).toBe(false);
  });
  it('watched by the camera: on screen = frozen (any camera style), off screen or behind a wall = moves', () => {
    const cam = { uid: 9, type: 'Camera', kind: 'camera' as const, x: 0, y: 10, z: 12, rx: -40, ry: 0 };
    const rt = new Runtime(scene([cam, { uid: 1, type: 'Player', x: 0, y: 0.5, z: 2, behaviors: [bh('health')] },
      { uid: 2, type: 'Enemy', x: -3, y: 0.5, z: -2, behaviors: [bh('unseen', { target: 'Player', speed: 4 })] },
      { uid: 3, type: 'Hidden', x: 3, y: 0.5, z: -6, behaviors: [] }, { uid: 4, type: 'Wall', x: 3, y: 2, z: -4, sx: 4, sy: 4, sz: 0.5, behaviors: [bh('solid')] },
      { uid: 5, type: 'Behind', x: 0, y: 0.5, z: 30, behaviors: [] }], '3d'), doc([], [], 'xz'), { app: 'gamecraft' });
    rt.tick();
    const of = (t: string) => rt.world.of(t)[0];
    expect(rt.cameraSees(of('Enemy'))).toBe(true);
    expect(rt.cameraSees(of('Behind'))).toBe(false); // behind the camera
    expect(rt.cameraSees(of('Hidden'))).toBe(false); // behind the wall
    expect(rt.cameraSees(of('Hidden'), false)).toBe(true); // walls ignored
    for (let k = 0; k < 60; k++) rt.tick();
    expect(of('Enemy').x).toBeCloseTo(-3, 3); // on screen the whole time: never moved
  });
  it('moves when you move: still while the player stands, comes while they walk', () => {
    const rt = mk('mimic'), e = rt.world.of('Enemy')[0], pl = rt.world.of('Player')[0];
    for (let k = 0; k < 60; k++) rt.tick();
    expect(e.x).toBeCloseTo(10, 3);
    for (let k = 0; k < 60; k++) { pl.z += 0.05; rt.tick(); }
    expect(e.x).toBeLessThan(7);
    const x = e.x; for (let k = 0; k < 60; k++) rt.tick();
    expect(e.x).toBeCloseTo(x, 3); // stopped with the player
  });
});
