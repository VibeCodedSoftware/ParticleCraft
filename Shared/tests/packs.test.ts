// Block packs: every pack installs into a scene with the objects it names, validates, and runs without errors.
import { describe, expect, it } from 'vitest';
import { createLogicDocument } from '../src/schema';
import { emptyScene, makeInstance } from '../src/runtime/scene';
import { behaviorDefaults } from '../src/runtime/behaviors';
import { Runtime } from '../src/runtime/runtime';
import { validateDocument } from '../src/validate';
import { installPack, packAvailable, PACKS, PACK_BY_ID } from '../src/packs';

function world(mode: '2d' | '3d') {
  const s = emptyScene('Test', mode);
  let uid = 1;
  const add = (type: string, kind: any, o: any = {}) => s.instances.push(makeInstance(uid++, type, kind, o));
  const z = mode === '2d' ? 0 : 3;
  add('Floor', 'box', mode === '2d' ? { y: -1, sx: 60, sy: 1, behaviors: [{ type: 'solid', props: behaviorDefaults('solid') }] } : { y: -0.5, sx: 60, sz: 60, behaviors: [{ type: 'solid', props: behaviorDefaults('solid') }] });
  add('Player', 'box', { y: 0.5 });
  for (const t of ['Enemy', 'Turret', 'Critter', 'Coin', 'Pickup', 'Door', 'Potion', 'Car', 'Checkpoint', 'NPC', 'Slime', 'Bat', 'Crate', 'Platform', 'Ladder']) add(t, 'box', { x: 4, y: 0.5, z });
  add('Camera', 'camera', { z: mode === '2d' ? 20 : 10, y: 4 });
  return s;
}

describe('block packs', () => {
  for (const pack of PACKS) for (const mode of ['2d', '3d'] as const) {
    for (const app of ['gamecraft', 'logiccraft'] as const) {
      const ctx = { app, mode };
      if (!packAvailable(pack, ctx) || (app === 'logiccraft' && mode === '3d')) continue;
      it(`${pack.name} (${app}, ${mode}) installs, validates and runs`, () => {
        const scene = world(mode);
        const doc = createLogicDocument('t', app, mode === '2d' ? 'xy' : 'xz');
        const report = installPack(doc, undefined, scene, pack, {}, ctx);
        expect(report.filter((r) => r.startsWith('⚠'))).toEqual([]);
        const types = [...new Set([...scene.instances.map((i) => i.type), ...scene.objectTypes.map((t) => t.name)])].map((name) => {
          const inst = scene.instances.find((i) => i.type === name) ?? scene.objectTypes.find((t) => t.name === name)?.template;
          return { name, vars: Object.keys(inst?.vars ?? {}), behaviors: (inst?.behaviors ?? []).map((b) => b.type) };
        });
        const errors = validateDocument(doc, { app, types }).filter((i) => i.level === 'error');
        expect(errors.map((e) => e.message)).toEqual([]);
        const rt = new Runtime(scene, doc, { app });
        for (let i = 0; i < 180; i++) rt.tick();
        expect(rt.errors.map((e) => e.message)).toEqual([]);
      });
    }
  }

  it('platformer controls replace other movement and keep unrelated behaviors', () => {
    const scene = world('2d');
    const p = scene.instances.find((i) => i.type === 'Player')!;
    p.behaviors.push({ type: 'eightdir', props: behaviorDefaults('eightdir') }, { type: 'health', props: behaviorDefaults('health') });
    const doc = createLogicDocument('t', 'gamecraft', 'xy');
    const report = installPack(doc, undefined, scene, PACK_BY_ID['controls.platformer'], { speed: 9 }, { app: 'gamecraft', mode: '2d' });
    expect(p.behaviors.map((b) => b.type).sort()).toEqual(['health', 'platform']);
    expect(p.behaviors.find((b) => b.type === 'platform')!.props.maxSpeed).toBe(9);
    expect(report.join(' ')).toContain('replaced eightdir');
    expect(doc.sheets[0].events[0].kind).toBe('group');
  });

  it('chaser enemy hunts and damages the player', () => {
    const scene = world('3d');
    const doc = createLogicDocument('t', 'gamecraft', 'xz');
    installPack(doc, undefined, scene, PACK_BY_ID['ai.chaser'], { see: 12, attack: 1.8 }, { app: 'gamecraft', mode: '3d' });
    const rt = new Runtime(scene, doc, { app: 'gamecraft' });
    for (let i = 0; i < 60 * 6; i++) rt.tick();
    const enemy = rt.world.of('Enemy')[0], player = rt.world.of('Player')[0];
    expect(enemy.vars.state).toBe('chase');
    expect(player.state.health.hp).toBeLessThan(100);
  });

  it('missing objects are reported, not invented', () => {
    const scene = emptyScene('Empty', '2d');
    const report = installPack(createLogicDocument('t', 'gamecraft', 'xy'), undefined, scene, PACK_BY_ID['ai.walker'], {}, { app: 'gamecraft', mode: '2d' });
    expect(report.some((r) => r.startsWith('⚠') && r.includes('"Enemy"'))).toBe(true);
  });

  it('menus create their HUD buttons once', () => {
    const scene = world('2d');
    const doc = createLogicDocument('t', 'gamecraft', 'xy');
    installPack(doc, undefined, scene, PACK_BY_ID['menu.start'], {}, { app: 'gamecraft', mode: '2d' });
    installPack(doc, undefined, scene, PACK_BY_ID['menu.start'], {}, { app: 'gamecraft', mode: '2d' });
    expect(scene.instances.filter((i) => i.type === 'PlayButton').length).toBe(1);
    const rt = new Runtime(scene, doc, { app: 'gamecraft' });
    rt.tick(); rt.tick();
    expect(rt.timeScale).toBe(0);
    rt.input.uiButtons.push('PlayButton');
    rt.tick(); rt.tick();
    expect(rt.timeScale).toBe(1);
    expect(rt.world.of('PlayButton')[0].visible).toBe(false);
  });
});
