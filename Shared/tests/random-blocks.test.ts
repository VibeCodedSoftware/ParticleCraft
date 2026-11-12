// P0: random seed blocks — set / randomize the seed, numbers, choices, positions, rotations; fixed vs random seed.
import { describe, expect, it } from 'vitest';
import { block, doc, event, num, scene } from './helpers';
import { Runtime } from '../src/runtime/runtime';
import { BLOCK_DEFS } from '../src/blocks/definitions';

const play = (actions: any[], vars: any[], over: any = {}, insts: any[] = []) => {
  const s = scene(insts, '3d'); Object.assign(s.settings, over);
  const rt = new Runtime(s, doc([event([block('system.on_start_of_layout')], actions)], vars, 'xz'), { app: 'gamecraft' });
  rt.tick();
  return rt;
};
const list = (name: string, v: any[]) => ({ name, type: 'array', value: v } as any);
const str = (name: string) => ({ name, type: 'string', value: '' } as any);

describe('random blocks', () => {
  it('exist in a Random category for both apps', () => {
    for (const id of ['random.set_seed', 'random.randomize_seed', 'random.number', 'random.choose', 'random.choose_values', 'random.position', 'random.rotation']) {
      expect(BLOCK_DEFS[id]?.category).toBe('random');
      expect(BLOCK_DEFS[id].apps).toEqual(['gamecraft', 'logiccraft']);
    }
  });

  it('the same seed gives the same results; a different seed different ones', () => {
    const roll = (seed: number) => play([block('random.set_seed', { seed: String(seed) }), ...[0, 1, 2, 3, 4].map((k) => block('random.number', { variable: 'r' + k, kind: 'integer', min: '1', max: '1000' }))], [0, 1, 2, 3, 4].map((k) => num('r' + k))).globals;
    expect(roll(42)).toEqual(roll(42));
    expect(roll(42)).not.toEqual(roll(43));
  });

  it('integers stay in range with both ends reachable; decimals stay in range', () => {
    const ints = play([block('random.set_seed', { seed: '3' }), ...Array.from({ length: 50 }, (_, k) => block('random.number', { variable: 'i' + k, kind: 'integer', min: '1', max: '6' }))], Array.from({ length: 50 }, (_, k) => num('i' + k))).globals;
    const vals = Object.values(ints) as number[];
    expect(vals.every((v) => Number.isInteger(v) && v >= 1 && v <= 6)).toBe(true);
    expect(new Set(vals).size).toBe(6);
    const dec = play([block('random.number', { variable: 'd', kind: 'decimal', min: '2', max: '3' })], [num('d')]).globals.d;
    expect(dec).toBeGreaterThanOrEqual(2); expect(dec).toBeLessThan(3); expect(Number.isInteger(dec)).toBe(false);
  });

  it('chooses from a list variable and from values', () => {
    const g = play([block('random.choose', { variable: 'a', list: 'items' }), block('random.choose_values', { variable: 'b', values: '"red", "green", "blue"' })], [list('items', ['sword', 'shield', 'potion']), str('a'), str('b')]).globals;
    expect(['sword', 'shield', 'potion']).toContain(g.a);
    expect(['red', 'green', 'blue']).toContain(g.b);
  });

  it('random position stays inside the area; random rotation inside its range', () => {
    const rt = play([block('random.position', { x1: '-2', y1: '1', z1: '10', x2: '2', y2: '1', z2: '12' }, 'Crate'), block('random.rotation', { axis: 'heading', min: '30', max: '60' }, 'Crate')], [], {},
      [{ uid: 1, type: 'Crate', kind: 'box', x: 0, y: 0, z: 0 }]);
    const c = rt.world.of('Crate')[0];
    expect(c.x).toBeGreaterThanOrEqual(-2); expect(c.x).toBeLessThanOrEqual(2);
    expect(c.y).toBe(1);
    expect(c.z).toBeGreaterThanOrEqual(10); expect(c.z).toBeLessThanOrEqual(12);
    expect(c.ry).toBeGreaterThanOrEqual(30); expect(c.ry).toBeLessThanOrEqual(60);
  });

  it('fixed seed mode repeats every play; random mode and Randomize seed change the seed', () => {
    const seedOf = (over: any, actions: any[] = []) => play(actions, [num('s')], over).seedValue;
    expect(seedOf({ seed: 99 })).toBe(99);
    expect(seedOf({ seed: 99, seedMode: 'fixed' })).toBe(99);
    const r1 = seedOf({ seed: 99, seedMode: 'random' });
    expect(r1).not.toBe(99);
    const rt = play([block('random.randomize_seed'), block('var.set', { variable: 's', value: 'randomseed' })], [num('s')], { seed: 5 });
    expect(rt.globals.s).toBe(rt.seedValue);
    expect(rt.seedValue).not.toBe(5);
  });
});
