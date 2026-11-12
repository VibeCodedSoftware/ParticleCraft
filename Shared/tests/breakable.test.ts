// Breakable objects: durability, impacts, destroy, attacks and projectiles all shatter them (an event for the renderer).
import { describe, expect, it } from 'vitest';
import { block, doc, event, num, scene } from './helpers';
import { Runtime } from '../src/runtime/runtime';
import { behaviorDefaults } from '../src/runtime/behaviors';

const bh = (type: string, props: Record<string, any> = {}) => ({ type, props: { ...behaviorDefaults(type), ...props } });
const ticks = (rt: Runtime, n: number) => { for (let i = 0; i < n; i++) rt.tick(); };
const floor = { uid: 100, type: 'Floor', kind: 'box' as const, x: 0, y: -0.5, z: 0, sx: 60, sy: 1, sz: 60, behaviors: [bh('solid')] };
const crate = (o: Record<string, any> = {}) => ({ uid: 1, type: 'Crate', kind: 'box' as const, x: 0, y: 0.5, z: 0, sx: 1, sy: 1, sz: 1, behaviors: [bh('solid'), bh('breakable', o)] });
const broke = event([block('breakable.on_broken', {}, 'Crate')], [block('var.add', { variable: 'n', value: '1' })]);

describe('Breakable', () => {
  it('Deal damage wears durability down and shatters it at zero', () => {
    const rt = new Runtime(scene([floor, crate({ durability: 25 })], '3d'), doc([broke, event([block('input.on_key_pressed', { key: 'K' })], [block('health.damage', { amount: '10' }, 'Crate')])], [num('n')], 'xz'), { app: 'gamecraft' });
    ticks(rt, 2);
    for (let k = 0; k < 2; k++) { rt.input.keyDown('K'); rt.tick(); rt.input.keyUp('K'); rt.tick(); }
    expect(rt.world.of('Crate').length).toBe(1);
    expect(rt.world.of('Crate')[0].state.breakable.hp).toBe(5);
    rt.input.keyDown('K'); rt.tick(); rt.input.keyUp('K'); ticks(rt, 2);
    expect(rt.world.of('Crate').length).toBe(0);
    expect(rt.globals.n).toBe(1);
    expect(rt.shatters).toHaveLength(1);
    expect(rt.shatters[0].pieces).toBe(120);
  });

  it('something moving into it fast enough breaks it; slow does not', () => {
    const s = scene([floor, crate({ impactSpeed: 4, pieces: 300 }),
      { uid: 2, type: 'Ball', kind: 'sphere', x: -3, y: 0.5, z: 0, sx: 0.5, sy: 0.5, sz: 0.5, behaviors: [bh('physics', { mass: 1 })] }], '3d');
    const rt = new Runtime(s, doc([broke], [num('n')], 'xz'), { app: 'gamecraft' });
    const ball = rt.world.of('Ball')[0];
    ball.vx = 1.5; ticks(rt, 60);
    expect(rt.world.of('Crate').length).toBe(1);
    ball.x = -3; ball.y = 1; ball.vx = 12; ticks(rt, 30); // thrown (a ball rolling on the floor is slowed by friction)
    expect(rt.world.of('Crate').length).toBe(0);
    expect(rt.shatters[0].pieces).toBe(300);
    expect(rt.shatters[0].speed).toBeGreaterThan(4);
  });

  it('Destroy object shatters it too (unless turned off); Health death breaks it', () => {
    const rt = new Runtime(scene([floor, crate(), { uid: 3, type: 'Vase', kind: 'box', x: 4, y: 0.5, z: 0, behaviors: [bh('breakable', { shatterOnDestroy: false })] },
      { uid: 4, type: 'Pot', kind: 'box', x: 8, y: 0.5, z: 0, behaviors: [bh('breakable'), bh('health', { maxHp: 5, hp: 5 })] }], '3d'),
    doc([event([block('system.on_start_of_layout')], [block('object.destroy', {}, 'Crate'), block('object.destroy', {}, 'Vase')])], [], 'xz'), { app: 'gamecraft' });
    ticks(rt, 3);
    expect(rt.shatters.map((e) => e.uid)).toEqual([1]);
    rt.damage(rt.world.of('Pot')[0], 10); ticks(rt, 2);
    expect(rt.shatters.map((e) => e.uid)).toEqual([1, 4]);
    expect(rt.world.of('Pot').length).toBe(0);
  });

  it('projectiles and melee damage breakables without Health', () => {
    const s = scene([floor, crate({ durability: 10 }), { uid: 5, type: 'Hero', kind: 'box', x: -1.2, y: 0.5, z: 0 }], '3d');
    const rt = new Runtime(s, doc([event([block('input.on_key_pressed', { key: 'M' })], [block('combat.melee', { victims: 'Crate', range: '3', arc: '360', damage: '20' }, 'Hero')])], [], 'xz'), { app: 'gamecraft' });
    ticks(rt, 2); rt.input.keyDown('M'); rt.tick(); rt.input.keyUp('M'); ticks(rt, 2);
    expect(rt.world.of('Crate').length).toBe(0);
  });
});
