// The regular Enemy behavior and the Spawner behavior, with their presets.
import { describe, expect, it } from 'vitest';
import { doc } from './helpers';
import { Runtime } from '../src/runtime/runtime';
import { BEHAVIORS, behaviorDefaults } from '../src/runtime/behaviors';
import { emptyScene, makeInstance } from '../src/runtime/scene';
import { PACK_BY_ID, installPack, packDefaults } from '../src/packs';

const bh = (type: string, props: any = {}) => ({ type, props: { ...behaviorDefaults(type), ...props } });
const body = () => ({ shape: 'box' as const, size: [0.6, 1.6, 0.6] as [number, number, number], offset: [0, 0.8, 0] as [number, number, number] });
function setup(enemyX = 8, props: any = {}, extra: any[] = []) {
  const scene = emptyScene('S', '3d');
  scene.instances = [
    makeInstance(1, 'Floor', 'box', { y: -0.5, sx: 200, sz: 200, behaviors: [bh('solid')] }),
    makeInstance(2, 'Player', 'box', { collider: body(), behaviors: [bh('health', { maxHp: 100, hp: 100, invulnerableTime: 0 })] }),
    makeInstance(3, 'Enemy', 'box', { x: enemyX, collider: body(), behaviors: [bh('enemy', { patrolRadius: 0, ...props }), bh('health', { maxHp: 30, hp: 30 })] }),
    ...extra,
  ];
  const rt = new Runtime(scene, doc([]), { app: 'gamecraft' });
  const pl = rt.world.byUid.get(2)!, en = rt.world.byUid.get(3)!;
  return { rt, pl, en, run: (s: number) => { for (let k = 0; k < s * 60; k++) rt.tick(); } };
}

describe('enemy', () => {
  it('is in the behavior list', () => {
    expect(BEHAVIORS.enemy.name).toBe('Enemy');
    expect(BEHAVIORS.spawner.name).toBe('Spawner');
  });
  it('stays put until it sees the player, then chases and hits, at its cooldown', () => {
    const far = setup(30);
    far.run(2);
    expect(far.en.x).toBe(30);
    const t = setup(8, { damage: 10, attackCooldown: 1, knockback: 0 });
    t.run(3);
    expect(t.rt.world.planarDistance(t.en, t.pl)).toBeLessThan(1.7);
    expect(t.en.state.enemy.state).toBe('attack');
    t.run(3);
    const lost = 100 - t.pl.state.health.hp;
    expect(lost).toBeGreaterThanOrEqual(30);
    expect(lost).toBeLessThanOrEqual(50);
  });
  it('gives up when the player gets far away', () => {
    const t = setup(8, { loseRange: 12, knockback: 0 });
    t.run(0.5);
    expect(t.en.state.enemy.state).toBe('chase');
    t.pl.x = -100;
    t.run(0.2);
    expect(t.en.state.enemy.state).toBe('patrol');
  });
  it('goes around a wall', () => {
    const wall = makeInstance(9, 'Wall', 'box', { x: 4, y: 2, sx: 0.5, sy: 4, sz: 8, behaviors: [bh('solid')] });
    const t = setup(7, { detectRange: 30, speed: 4, knockback: 0 }, [wall]);
    t.en.state.enemy = { state: 'chase', t: 0, cooldown: 0, vy: 0, wait: 0, goal: null, path: null, pathAt: 0 };
    t.run(8);
    expect(t.rt.world.planarDistance(t.en, t.pl)).toBeLessThan(2.1);
    expect(t.en.x).toBeLessThan(3.7); // on the player's side, not through it
  });
  it('wanders near home when it has nothing to chase', () => {
    const t = setup(40, { patrolRadius: 4 });
    t.run(6);
    expect(Math.hypot(t.en.x - 40, t.en.z)).toBeGreaterThan(0.2);
    expect(Math.hypot(t.en.x - 40, t.en.z)).toBeLessThan(5);
    expect(t.en.y).toBeCloseTo(0, 1);
  });
  it('dies and is removed', () => {
    const t = setup(30);
    t.rt.damage(t.en, 999);
    t.run(1.2);
    expect(t.en.destroyed).toBe(true);
  });
});

describe('spawner', () => {
  const game = (props: any = {}) => {
    const scene = emptyScene('S', '3d');
    scene.objectTypes.push({ name: 'Rock', kind: 'box', vars: [], template: makeInstance(0, 'Rock', 'box', {}) } as any);
    scene.instances = [makeInstance(1, 'Spot', 'empty', { x: 10, behaviors: [bh('spawner', { object: 'Rock', every: 1, startDelay: 0.5, radius: 2, maxAlive: 3, ...props })] })];
    const rt = new Runtime(scene, doc([]), { app: 'gamecraft' });
    return { rt, spot: rt.world.byUid.get(1)!, run: (s: number) => { for (let k = 0; k < s * 60; k++) rt.tick(); }, rocks: () => rt.world.of('Rock') };
  };
  it('makes them near itself, on time, up to the limit, and more when some go', () => {
    const t = game();
    t.run(0.3);
    expect(t.rocks().length).toBe(0);
    t.run(0.4);
    expect(t.rocks().length).toBe(1);
    t.run(5);
    expect(t.rocks().length).toBe(3);
    for (const r of t.rocks()) expect(Math.hypot(r.x - 10, r.z)).toBeLessThanOrEqual(2.01);
    t.rt.world.destroy(t.rocks()[0]);
    t.run(1.2);
    expect(t.rocks().length).toBe(3);
  });
  it('honours a total, several at a time, and being off', () => {
    const t = game({ total: 4, count: 3, maxAlive: 0 });
    t.run(5);
    expect(t.rocks().length).toBe(4);
    const off = game({ active: false });
    off.run(3);
    expect(off.rocks().length).toBe(0);
  });
  it('a type that does not exist is harmless', () => {
    const t = game({ object: 'Nothing' });
    t.run(3);
    expect(t.spot.state.spawner.made).toBe(0);
  });
});

describe('presets', () => {
  const scene3 = () => { const s = emptyScene('S', '3d'); s.instances = [makeInstance(1, 'Floor', 'box', { y: -0.5, sx: 100, sz: 100, behaviors: [bh('solid')] }), makeInstance(2, 'Player', 'box', { collider: body(), behaviors: [bh('health')] })]; return s; };
  const install = (id: string, s = scene3()) => { const d = doc([]), pack = PACK_BY_ID[id]; installPack(d, undefined, s, pack, packDefaults(pack), { app: 'gamecraft', mode: '3d' }); return { d, s }; };

  it('Enemy makes an enemy, or fits the one you have', () => {
    const { s } = install('ai.enemy');
    expect(s.instances.find((i) => i.type === 'Enemy')!.behaviors.map((b) => b.type).sort()).toEqual(['enemy', 'health']);
    const mine = scene3();
    mine.instances.push(makeInstance(5, 'Enemy', 'mesh', { behaviors: [bh('eightdir')] }));
    install('ai.enemy', mine);
    const e = mine.instances.filter((i) => i.type === 'Enemy');
    expect(e.length).toBe(1);
    expect(e[0].kind).toBe('mesh');
    expect(e[0].behaviors.map((b) => b.type).sort()).toEqual(['enemy', 'health']);
  });
  it('Enemy Spawner brings working enemies', () => {
    const { s, d } = install('ai.spawner');
    const rt = new Runtime(s, d, { app: 'gamecraft' });
    for (let k = 0; k < 60 * 6; k++) rt.tick();
    const made = rt.world.of('Enemy');
    expect(made.length).toBeGreaterThan(0);
    expect(made[0].behaviors.map((b) => b.type).sort()).toEqual(['enemy', 'health']);
    expect(made[0].state.health).toBeTruthy();
  });
  it('Object Spawner makes its object', () => {
    const { s, d } = install('items.spawner');
    const rt = new Runtime(s, d, { app: 'gamecraft' });
    for (let k = 0; k < 60 * 7; k++) rt.tick();
    expect(rt.world.of('Pickup').length).toBeGreaterThan(0);
  });
});
