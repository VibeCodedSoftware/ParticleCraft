// NPC and enemy presets: Path follower, Wander, NPC interaction, Slime, Flying enemy.
import { describe, expect, it } from 'vitest';
import { block, doc, event, num, scene } from './helpers';
import { Runtime } from '../src/runtime/runtime';
import { behaviorDefaults } from '../src/runtime/behaviors';
import { PACK_BY_ID, installPack } from '../src/packs';
import { validateDocument } from '../src/validate';

const bh = (type: string, props: Record<string, any> = {}) => ({ type, props: { ...behaviorDefaults(type), ...props } });
const ticks = (rt: Runtime, n: number) => { for (let i = 0; i < n; i++) rt.tick(); };
const floor = { uid: 100, type: 'Floor', kind: 'box' as const, x: 0, y: -0.5, z: 0, sx: 60, sy: 1, sz: 60, behaviors: [bh('solid')] };
const count = (name: string, trig: string, target: string) => event([block(trig, {}, target)], [block('var.add', { variable: name, value: '1' })]);

describe('Path follower', () => {
  const route: [number, number, number][] = [[0, 0.5, 0], [4, 0.5, 0], [4, 0.5, 4]];

  it('loops around the drawn route and reports every point', () => {
    const s = scene([floor, { uid: 1, type: 'NPC', x: 0, y: 0.5, z: 0, sx: 0.6, sy: 1, sz: 0.6, path: { points: route }, behaviors: [bh('pathfollow', { speed: 4 })] }], '3d');
    const rt = new Runtime(s, doc([count('pts', 'npc.on_point', 'NPC'), count('laps', 'npc.on_path_end', 'NPC')], [num('pts'), num('laps')], 'xz'), { app: 'gamecraft' });
    ticks(rt, 60 * 6); // route is 4 + 4 + 5.66 m = 13.7 m per lap at 4 m/s
    expect(rt.globals.laps).toBeGreaterThanOrEqual(1);
    expect(rt.globals.pts).toBeGreaterThanOrEqual(4);
    const n = rt.world.of('NPC')[0];
    expect(n.animation).toBe('walk');
  });

  it('"stop" mode ends at the last point and waits at points with a wait time', () => {
    const s = scene([floor, { uid: 1, type: 'NPC', x: 0, y: 0.5, z: 0, sx: 0.6, sy: 1, sz: 0.6, path: { points: route, waits: [0, 1.5, 0] }, behaviors: [bh('pathfollow', { speed: 4, mode: 'stop' })] }], '3d');
    const rt = new Runtime(s, doc([], [], 'xz'), { app: 'gamecraft' });
    ticks(rt, 60 * 1.3); // reaches point 1 after 1 s, then waits 1.5 s
    const n = rt.world.of('NPC')[0];
    expect(n.x).toBeCloseTo(4, 1);
    expect(n.z).toBeCloseTo(0, 1);
    expect(n.state.pathf.wait).toBeGreaterThan(0);
    ticks(rt, 60 * 4);
    expect(n.x).toBeCloseTo(4, 1);
    expect(n.z).toBeCloseTo(4, 1);
    expect(n.state.pathf.done).toBe(true);
    expect(n.animation).toBe('idle');
  });

  it('back-and-forth mode walks the route in reverse', () => {
    const s = scene([{ uid: 1, type: 'NPC', x: 0, y: 0, path: { points: [[0, 0, 0], [3, 0, 0]] }, behaviors: [bh('pathfollow', { speed: 3, mode: 'back and forth' })] }], '2d');
    const rt = new Runtime(s, doc([]), { app: 'logiccraft' });
    ticks(rt, 60 * 1.5); // out (1 s) and half way back
    const n = rt.world.of('NPC')[0];
    expect(n.x).toBeGreaterThan(1); expect(n.x).toBeLessThan(2.5);
    expect(n.state.pathf.dir).toBe(-1);
  });
});

describe('Wander', () => {
  it('moves around but stays within its radius of home', () => {
    const s = scene([floor, { uid: 1, type: 'Sheep', x: 2, y: 0.5, z: 2, sx: 0.6, sy: 1, sz: 0.6, behaviors: [bh('wander', { radius: 3, minWait: 0.2, maxWait: 0.5 })] }], '3d');
    const rt = new Runtime(s, doc([], [], 'xz'), { app: 'gamecraft' });
    let maxD = 0, moved = 0, last = [2, 2];
    for (let i = 0; i < 60 * 20; i++) {
      rt.tick();
      const n = rt.world.of('Sheep')[0];
      maxD = Math.max(maxD, Math.hypot(n.x - 2, n.z - 2));
      moved += Math.hypot(n.x - last[0], n.z - last[1]); last = [n.x, n.z];
    }
    expect(moved).toBeGreaterThan(5);
    expect(maxD).toBeLessThanOrEqual(3.05);
  });
});

describe('NPC interaction', () => {
  it('walks up to the player, interacts, then goes back to wandering', () => {
    const s = scene([floor,
      { uid: 1, type: 'Villager', x: 0, y: 0.5, z: 0, sx: 0.6, sy: 1, sz: 0.6, behaviors: [bh('npctalk', { chance: 100, checkEvery: 0.3, talkTime: 1, stopDistance: 1.5 }), bh('wander', { minWait: 5, maxWait: 5 })] },
      { uid: 2, type: 'Player', x: 4, y: 0.5, z: 0, sx: 0.6, sy: 1, sz: 0.6 }], '3d');
    const rt = new Runtime(s, doc([count('a', 'npc.on_approach', 'Villager'), count('i', 'npc.on_interact', 'Villager'), count('e', 'npc.on_interact_end', 'Villager')], [num('a'), num('i'), num('e')], 'xz'), { app: 'gamecraft' });
    ticks(rt, 60 * 2.5);
    const v = rt.world.of('Villager')[0];
    expect(rt.globals.a).toBe(1);
    expect(rt.globals.i).toBe(1);
    expect(Math.hypot(v.x - 4, v.z)).toBeLessThan(1.7);
    ticks(rt, 60 * 1.5);
    expect(rt.globals.e).toBe(1);
    expect(v.state.npcBusy).toBe(false);
  });

  it('opens its dialogue and finishes when the dialogue closes; the talk key starts it too', () => {
    const d = doc([count('e', 'npc.on_interact_end', 'Clerk')], [num('e')], 'xz');
    d.dialogues = [{ id: 'd1', name: 'Package', start: 'n1', speakers: [], nodes: [{ id: 'n1', speaker: 'Clerk', text: 'Do you have my package?', choices: [{ id: 'c1', text: 'Yes' }, { id: 'c2', text: 'No' }] }] } as any];
    const s = scene([floor,
      { uid: 1, type: 'Clerk', x: 0, y: 0.5, z: 0, sx: 0.6, sy: 1, sz: 0.6, behaviors: [bh('npctalk', { approach: false, dialogue: 'Package' })] },
      { uid: 2, type: 'Player', x: 1.5, y: 0.5, z: 0, sx: 0.6, sy: 1, sz: 0.6 }], '3d');
    const rt = new Runtime(s, d, { app: 'gamecraft' });
    ticks(rt, 10);
    expect(rt.dialogue).toBeNull(); // does not walk up on its own
    rt.input.keyDown('E'); rt.tick(); rt.input.keyUp('E');
    expect(rt.dialogue?.text).toBe('Do you have my package?');
    rt.dialogueChoose(1);
    ticks(rt, 3);
    expect(rt.dialogue).toBeNull();
    expect(rt.globals.e).toBe(1);
  });
});

describe('Slime enemy', () => {
  it('spots the player, hops over, hurts them and can be defeated', () => {
    const s = scene([floor,
      { uid: 1, type: 'Slime', x: 0, y: 0.4, z: 0, sx: 0.8, sy: 0.8, sz: 0.8, behaviors: [bh('slime', { detectRange: 8 }), bh('health', { maxHp: 20, hp: 20 })] },
      { uid: 2, type: 'Player', x: 5, y: 0.5, z: 0, sx: 0.6, sy: 1, sz: 0.6, behaviors: [bh('health')] }], '3d');
    const rt = new Runtime(s, doc([count('spot', 'enemy.on_spotted', 'Slime'), count('hit', 'enemy.on_attack', 'Slime')], [num('spot'), num('hit')], 'xz'), { app: 'gamecraft' });
    let maxY = 0;
    for (let i = 0; i < 60 * 6; i++) { rt.tick(); maxY = Math.max(maxY, rt.world.of('Slime')[0]?.y ?? 0); }
    const pl = rt.world.of('Player')[0];
    expect(rt.globals.spot).toBe(1);
    expect(rt.globals.hit).toBeGreaterThan(0);
    expect(pl.state.health.hp).toBeLessThan(100);
    expect(maxY).toBeGreaterThan(0.9); // it hops
    const sl = rt.world.of('Slime')[0];
    rt.damage(sl, 50);
    ticks(rt, 60);
    expect(rt.world.of('Slime').length).toBe(0);
  });

  it('top-down 2D: hops toward the player without gravity', () => {
    const s = scene([
      { uid: 1, type: 'Slime', x: 0, y: 0, behaviors: [bh('slime', { detectRange: 8 })] },
      { uid: 2, type: 'Player', x: 4, y: 3, behaviors: [bh('health')] }], '2d');
    const rt = new Runtime(s, doc([]), { app: 'logiccraft' });
    ticks(rt, 60 * 5);
    const sl = rt.world.of('Slime')[0];
    expect(Math.hypot(sl.x - 4, sl.y - 3)).toBeLessThan(2);
    expect(rt.world.of('Player')[0].state.health.hp).toBeLessThan(100);
  });
});

describe('Flying enemy', () => {
  it('hovers at its flight height, then swoops at the player and climbs back', () => {
    const s = scene([floor,
      { uid: 1, type: 'Bat', x: 0, y: 1, z: 0, sx: 0.5, sy: 0.5, sz: 0.5, behaviors: [bh('flyer', { height: 3, detectRange: 6 })] },
      { uid: 2, type: 'Player', x: 30, y: 0.5, z: 0, sx: 0.6, sy: 1, sz: 0.6, behaviors: [bh('health')] }], '3d');
    const rt = new Runtime(s, doc([count('hit', 'enemy.on_attack', 'Bat')], [num('hit')], 'xz'), { app: 'gamecraft' });
    ticks(rt, 60 * 3);
    const bat = rt.world.of('Bat')[0];
    expect(bat.y).toBeGreaterThan(3.4); expect(bat.y).toBeLessThan(4.6); // home 1 + height 3, with bob
    // Bring the player close.
    const pl = rt.world.of('Player')[0]; pl.x = bat.x + 3; pl.z = bat.z;
    let minY = 99, states = new Set<string>();
    for (let i = 0; i < 60 * 6; i++) { rt.tick(); minY = Math.min(minY, bat.y); states.add(bat.state.enemy.state); }
    expect(states.has('dive')).toBe(true);
    expect(states.has('climb')).toBe(true);
    expect(minY).toBeLessThan(2);
    expect(rt.globals.hit).toBeGreaterThan(0);
    expect(pl.state.health.hp).toBeLessThan(100);
  });

  it('falls and disappears when defeated', () => {
    const s = scene([floor, { uid: 1, type: 'Bat', x: 0, y: 4, z: 0, sx: 0.5, sy: 0.5, sz: 0.5, behaviors: [bh('flyer'), bh('health', { maxHp: 5, hp: 5 })] }], '3d');
    const rt = new Runtime(s, doc([], [], 'xz'), { app: 'gamecraft' });
    ticks(rt, 10);
    rt.damage(rt.world.of('Bat')[0], 10);
    ticks(rt, 30);
    expect(rt.world.of('Bat')[0].y).toBeLessThan(4);
    ticks(rt, 120);
    expect(rt.world.of('Bat').length).toBe(0);
  });
});

describe('NPC and enemy packs', () => {
  for (const id of ['npc.path', 'npc.wander', 'npc.talker', 'ai.slime', 'ai.flyer']) {
    it(`${id} installs, validates and runs`, () => {
      const s = scene([floor, { uid: 1, type: 'NPC', x: 0, y: 0.5, z: 0 }, { uid: 2, type: 'Slime', x: 3, y: 0.5, z: 0 }, { uid: 3, type: 'Bat', x: -3, y: 1, z: 0 }, { uid: 4, type: 'Player', x: 0, y: 0.5, z: 5 }], '3d');
      const d = doc([], [], 'xz');
      const pack = PACK_BY_ID[id];
      installPack(d, undefined, s, pack, {}, { app: 'gamecraft', mode: '3d' });
      const errors = validateDocument(d, { app: 'gamecraft', types: ['NPC', 'Slime', 'Bat', 'Player', 'Floor'].map((name) => ({ name, vars: ['state'], behaviors: s.instances.filter((i) => i.type === name).flatMap((i) => i.behaviors.map((b) => b.type)) })) }).filter((x) => x.level === 'error');
      expect(errors).toEqual([]);
      const rt = new Runtime(s, d, { app: 'gamecraft' });
      ticks(rt, 120);
      expect(rt.errors).toEqual([]);
    });
  }
});
