// Follower AI: stays near its leader, catches up, goes around walls, waits when told, comes along in saves.
import { describe, expect, it } from 'vitest';
import { doc } from './helpers';
import { Runtime } from '../src/runtime/runtime';
import { emptyScene, makeInstance } from '../src/runtime/scene';
import { behaviorDefaults } from '../src/runtime/behaviors';
import { ACTIONS } from '../src/runtime/blockImpl';
import { PACK_BY_ID, installPack, packDefaults } from '../src/packs';

const bh = (type: string, props: any = {}) => ({ type, props: { ...behaviorDefaults(type), ...props } });
const body = () => ({ shape: 'box' as const, size: [0.6, 1, 0.6] as [number, number, number], offset: [0, 0.5, 0] as [number, number, number] });
function setup(props: any = {}, extra: any[] = []) {
  const scene = emptyScene('S', '3d');
  scene.instances = [
    makeInstance(1, 'Floor', 'box', { y: -0.5, sx: 100, sz: 100, behaviors: [bh('solid')] }),
    makeInstance(2, 'Player', 'box', { x: 0, collider: body() }),
    makeInstance(3, 'Pet', 'box', { x: 6, collider: body(), behaviors: [bh('follower', props)] }),
    ...extra,
  ];
  const rt = new Runtime(scene, doc([]), { app: 'gamecraft' });
  const pl = rt.world.byUid.get(2)!, pet = rt.world.byUid.get(3)!;
  return { rt, pl, pet, run: (s: number) => { for (let k = 0; k < s * 60; k++) rt.tick(); }, gap: () => Math.hypot(pl.x - pet.x, pl.z - pet.z) };
}

describe('follower', () => {
  it('walks to its place near the leader and stops there, on the ground', () => {
    const t = setup({ distance: 2 });
    t.run(4);
    expect(t.gap()).toBeLessThan(2.9);
    expect(t.gap()).toBeGreaterThan(1.1);
    expect(t.pet.y).toBeCloseTo(0, 1);
    const x = t.pet.x, z = t.pet.z;
    t.run(1);
    expect(Math.hypot(t.pet.x - x, t.pet.z - z)).toBeLessThan(0.01); // no twitching
    expect(t.pet.state.follower.moving).toBe(false);
  });

  it('follows when the leader moves, and runs when far', () => {
    const t = setup({ distance: 2, speed: 4, runSpeed: 8, runAt: 5 });
    t.run(3);
    t.pl.x = -14;
    const x0 = t.pet.x;
    t.run(0.5);
    expect(x0 - t.pet.x).toBeGreaterThan(3); // 8 m/s, not 4
    t.run(4);
    expect(t.gap()).toBeLessThan(3);
  });

  it('stands on the side it was given', () => {
    const t = setup({ distance: 3, side: 'behind' });
    t.pl.ry = 0; // leader faces +X: behind is -X
    t.run(6);
    expect(t.pet.x).toBeLessThan(-1.5);
    expect(Math.abs(t.pet.z)).toBeLessThan(1);
  });

  it('goes around a wall to reach the leader', () => {
    const wall = makeInstance(9, 'Wall', 'box', { x: 3, y: 2, sx: 0.5, sy: 4, sz: 12, behaviors: [bh('solid')] });
    const t = setup({ distance: 1.5, side: 'nearest', teleportAt: 0 }, [wall]);
    t.run(12);
    expect(t.pet.x).toBeLessThan(2.7); // past the wall, on the leader's side
    expect(t.gap()).toBeLessThan(2.6);
  });

  it('never walks through the wall on the way', () => {
    const wall = makeInstance(9, 'Wall', 'box', { x: 3, y: 2, sx: 0.5, sy: 4, sz: 12, behaviors: [bh('solid')] });
    const t = setup({ distance: 1.5, side: 'nearest', teleportAt: 0, pathfinding: false }, [wall]);
    t.run(6);
    expect(t.pet.x).toBeGreaterThan(3); // with no pathfinding it just stays behind it
  });

  it('appears beside the leader when left far behind', () => {
    const t = setup({ distance: 2, teleportAt: 20 });
    t.run(2);
    t.pl.x = -60;
    t.rt.tick();
    expect(t.gap()).toBeLessThan(3);
  });

  it('Stay and Follow', () => {
    const t = setup({ distance: 2 });
    ACTIONS['follower.stay'](t.rt, {} as any, {} as any, t.pet);
    const x = t.pet.x;
    t.run(2);
    expect(t.pet.x).toBe(x);
    ACTIONS['follower.follow'](t.rt, {} as any, {} as any, t.pet);
    t.run(3);
    expect(t.gap()).toBeLessThan(3);
  });

  it('flying floats at the leader\'s height', () => {
    const t = setup({ flying: true, hover: 1.5 });
    t.pl.y = 4;
    t.run(3);
    expect(t.pet.y).toBeCloseTo(5.5, 0);
  });

  it('does nothing when dead, and doesn\'t fail with no leader', () => {
    const t = setup();
    t.rt.world.destroy(t.pl);
    t.run(1);
    expect(t.pet.destroyed).toBeFalsy();
  });
});

describe('attacking and taking damage', () => {
  const enemy = (uid: number, x: number, z = 0, hp = 30) => makeInstance(uid, 'Enemy', 'box', { x, z, collider: body(), behaviors: [bh('health', { maxHp: hp, hp })] });
  const opts = { distance: 2, attack: true, attackRange: 8, attackDamage: 10, attackCooldown: 0.5, attackReach: 1.6, leash: 14 };
  const near = (t: any) => { t.pet.x = 2; t.run(0.05); };

  it('off by default: it ignores enemies', () => {
    const t = setup({ distance: 2 }, [enemy(5, 6)]);
    t.run(3);
    expect(t.rt.world.byUid.get(5)!.state.health.hp).toBe(30);
  });

  it('goes to a nearby enemy, hits it until it dies, then returns to the player', () => {
    const t = setup(opts, [enemy(5, -6, 0, 500)]);
    near(t);
    const foe = t.rt.world.byUid.get(5)!;
    t.run(3);
    expect(Math.hypot(t.pet.x - foe.x, t.pet.z - foe.z)).toBeLessThan(1.7); // went over there
    expect(foe.state.health.hp).toBeLessThan(500);
    foe.state.health.hp = 5;
    t.run(1);
    expect(foe.state.health.dead).toBe(true);
    expect(t.pet.state.follower.foe).toBeNull();
    t.run(4);
    expect(t.gap()).toBeLessThan(3); // back with the leader
  });

  it('attacks at its cooldown, not every frame', () => {
    const t = setup(opts, [enemy(5, 3, 0, 1000)]);
    t.pet.x = 3; t.pet.z = 1;
    t.run(1.1);
    const lost = 1000 - t.rt.world.byUid.get(5)!.state.health.hp;
    expect(lost).toBeGreaterThanOrEqual(20);
    expect(lost).toBeLessThanOrEqual(40);
  });

  it('ignores enemies too far away, and past the leash it gives up and returns', () => {
    const far = setup(opts, [enemy(5, 30)]);
    near(far);
    far.run(1);
    expect(far.pet.state.follower.foe ?? null).toBeNull();
    const t = setup({ ...opts, leash: 6, teleportAt: 0 }, [enemy(5, 7, 0, 1000)]);
    t.run(1);
    t.pl.x = -20; // the leader walks away: the enemy is now too far from the leader
    t.run(6);
    expect(t.pet.state.follower.foe ?? null).toBeNull();
    expect(t.pet.x).toBeLessThan(-10);
  });

  it('doesn\'t see through walls; a dead or removed enemy ends the fight', () => {
    const wall = makeInstance(9, 'Wall', 'box', { x: -3, y: 2, sx: 0.5, sy: 4, sz: 30, behaviors: [bh('solid')] });
    const t = setup(opts, [wall, enemy(5, -6)]);
    near(t);
    t.run(1);
    expect(t.pet.state.follower.foe ?? null).toBeNull();
    const r = setup(opts, [enemy(5, -4, 0, 1000)]);
    near(r);
    r.run(0.5);
    expect(r.pet.state.follower.foe).toBe(5);
    r.rt.world.destroy(r.rt.world.byUid.get(5)!);
    r.run(0.2);
    expect(r.pet.state.follower.foe).toBeNull();
  });

  it('told to stay it holds its ground, and hits only what reaches it', () => {
    const t = setup(opts, [enemy(5, -5, 0, 1000)]);
    near(t);
    ACTIONS['follower.stay'](t.rt, {} as any, {} as any, t.pet);
    const x = t.pet.x;
    t.run(1);
    expect(t.pet.x).toBeCloseTo(x);
    const foe = t.rt.world.byUid.get(5)!;
    expect(foe.state.health.hp).toBe(1000);
    foe.x = x + 1;
    t.run(1);
    expect(foe.state.health.hp).toBeLessThan(1000);
    expect(t.pet.x).toBeCloseTo(x);
  });

  it('Takes damage: off nothing hurts it, on it loses health', () => {
    const scene = (takesDamage: boolean) => {
      const t = setup({ takesDamage });
      t.pet.behaviors.push(bh('health', { maxHp: 50, hp: 50 }));
      t.rt.initInstance(t.pet);
      t.run(0.05);
      return t;
    };
    const safe = scene(false);
    expect(safe.rt.damage(safe.pet, 20)).toBe(false);
    expect(safe.pet.state.health.hp).toBe(50);
    const hurt = scene(true);
    expect(hurt.rt.damage(hurt.pet, 20)).toBe(true);
    expect(hurt.pet.state.health.hp).toBe(30);
  });
});

describe('the pack', () => {
  it('adds a follower object and a working stay / follow key', () => {
    const scene = emptyScene('S', '3d');
    scene.instances = [makeInstance(1, 'Floor', 'box', { y: -0.5, sx: 100, sz: 100, behaviors: [bh('solid')] }), makeInstance(2, 'Player', 'box', { collider: body() })];
    const d = doc([]);
    const pack = PACK_BY_ID['npc.follower'];
    installPack(d, undefined, scene, pack, packDefaults(pack), { app: 'gamecraft', mode: '3d' });
    const rt = new Runtime(scene, d, { app: 'gamecraft' });
    const pet = rt.world.of('Pet')[0];
    expect(pet.behaviors.some((b) => b.type === 'follower')).toBe(true);
    const press = () => { rt.input.keyDown('T'); rt.tick(); rt.input.keyUp('T'); rt.tick(); };
    rt.tick();
    press();
    expect(pet.state.follower.stay).toBe(true);
    press();
    expect(pet.state.follower.stay).toBe(false);
  });
});
