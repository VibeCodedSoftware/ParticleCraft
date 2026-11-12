// Rope / zipline in 2D and 3D: reaches the ground or not, holds an object at its end, climbing and zipping.
import { describe, expect, it } from 'vitest';
import { block, doc, event, num, scene } from './helpers';
import { Runtime } from '../src/runtime/runtime';
import { behaviorDefaults } from '../src/runtime/behaviors';
import { ropeCurve, ropeLength, ropeNearest } from '../src/runtime/rope';

const bh = (type: string, props: Record<string, any> = {}) => ({ type, props: { ...behaviorDefaults(type), ...props } });
const ticks = (rt: Runtime, n: number) => { for (let i = 0; i < n; i++) rt.tick(); };
const NOCOL = { shape: 'none' as const, size: [1, 1, 1] as [number, number, number], offset: [0, 0, 0] as [number, number, number] };
const floor = { uid: 100, type: 'Floor', kind: 'box' as const, x: 0, y: -0.5, z: 0, sx: 60, sy: 1, sz: 60, behaviors: [bh('solid')] };
const rope = (o: Record<string, any>, at: Record<string, any> = {}) => ({ uid: 1, type: 'Rope', kind: 'sphere' as const, x: 0, y: 6, z: 0, sx: 0.16, sy: 0.16, sz: 0.16, collider: NOCOL, behaviors: [bh('rope', { sway: 0, ...o })], ...at });
const player = (x = 0, y = 0.9, z = 0) => ({ uid: 2, type: 'Player', kind: 'box' as const, x, y, z, sx: 0.6, sy: 1.8, sz: 0.6, behaviors: [bh('platform')] });
const press = (rt: Runtime, k: string) => { rt.input.keyDown(k); rt.tick(); rt.input.keyUp(k); rt.tick(); };
const ropeOf = (rt: Runtime) => rt.world.of('Rope')[0];

describe('Rope shape', () => {
  it('hanging: its own length, or all the way to the ground', () => {
    const air = ropeCurve([0, 6, 0], { style: 'hanging', length: 2 }, 'xz', () => 0);
    expect(air[air.length - 1][1]).toBeCloseTo(4); expect(ropeLength(air)).toBeCloseTo(2);
    const down = ropeCurve([0, 6, 0], { style: 'hanging', length: 2, touchGround: true }, 'xz', () => 1);
    expect(down[down.length - 1][1]).toBeCloseTo(1);
  });
  it('between two points: reaches the end, sags, and in 2D stays in the plane', () => {
    const c = ropeCurve([0, 6, 5], { style: 'between two points', endX: 10, endY: -2, endZ: 7, slack: 1 }, 'xy', () => null);
    expect(c[c.length - 1]).toEqual([10, 4, 5]);
    expect(c[10][1]).toBeCloseTo(4); // halfway height 5, minus 1 of sag
    expect(c.every((p) => p[2] === 5)).toBe(true);
    expect(ropeNearest(c, 0, 6, 99, true).d).toBeCloseTo(0);
    const down = ropeCurve([0, 6, 0], { style: 'between two points', endX: 5, endY: -2, endZ: 0, slack: 0, touchGround: true }, 'xz', () => 0);
    expect(down[down.length - 1][1]).toBe(0);
  });
});

describe.each([['3d', 'xz'], ['2d', 'xy']] as const)('Rope in %s', (mode, plane) => {
  const make = (objs: any[], events: any[] = [], vars: any[] = []) => new Runtime(scene(objs, mode), doc(events, vars, plane), { app: 'gamecraft' });
  it('holds a placed object at its end, and it follows when the rope gets longer', () => {
    const lantern = { uid: 3, type: 'Lantern', kind: 'box' as const, x: 9, y: 9, z: 0, sx: 0.4, sy: 0.4, sz: 0.4, collider: NOCOL, behaviors: [] };
    const rt = make([floor, rope({ use: 'decoration', length: 2, hangObject: 'Lantern' }), lantern], [event([block('input.on_key_pressed', { key: 'K' })], [block('rope.set_length', { length: '3' }, 'Rope')])]);
    ticks(rt, 3);
    const l = rt.world.of('Lantern')[0];
    expect(rt.world.of('Lantern').length).toBe(1);
    expect(l.x).toBeCloseTo(0); expect(rt.world.aabb(l)[4]).toBeCloseTo(4, 1); // its top on the rope's end
    press(rt, 'K'); ticks(rt, 2);
    expect(rt.world.aabb(l)[4]).toBeCloseTo(3, 1);
  });
  it('makes one to hang when none was placed free', () => {
    const lantern = { uid: 3, type: 'Lantern', kind: 'box' as const, x: 9, y: 9, z: 0, sx: 0.4, sy: 0.4, sz: 0.4, collider: NOCOL, behaviors: [] };
    const rt = make([floor, rope({ use: 'decoration', hangObject: 'Lantern' }), rope({ use: 'decoration', hangObject: 'Lantern' }, { uid: 4, x: 5 }), lantern]);
    ticks(rt, 3);
    expect(rt.world.of('Lantern').length).toBe(2);
    expect(rt.world.of('Lantern').map((i) => Math.round(i.x)).sort()).toEqual([0, 5]);
  });
  it('a player out of reach cannot grab; in reach grabs, climbs up and down, Space jumps off', () => {
    const rt = make([floor, rope({ use: 'climb', length: 5.5, reach: 1.5 }), player(4)]);
    ticks(rt, 5); press(rt, 'E');
    expect(ropeOf(rt).state.rope.holder).toBe(0);
    const P = rt.world.of('Player')[0];
    P.x = 0.5; ticks(rt, 2); press(rt, 'E');
    expect(ropeOf(rt).state.rope.holder).toBe(2);
    expect(P.state.onRope).toBe(1);
    expect(rt.world.behavior(P, 'platform')!.props.enabled).toBe(false);
    const y0 = P.y; rt.input.keyDown('W'); ticks(rt, 30); rt.input.keyUp('W');
    expect(P.y).toBeGreaterThan(y0 + 0.8);
    expect(P.x).toBeCloseTo(0, 1);
    const y1 = P.y; rt.input.keyDown('S'); ticks(rt, 15); rt.input.keyUp('S');
    expect(P.y).toBeLessThan(y1 - 0.3);
    ticks(rt, 20); // past the grab's short pause
    press(rt, 'Space');
    expect(ropeOf(rt).state.rope.holder).toBe(0);
    expect(rt.world.behavior(P, 'platform')!.props.enabled).toBe(true);
    expect(P.state.onRope).toBe(0);
  });
  it('a zipline carries the player to its lower end, says so, and lets go', () => {
    const rt = make([floor, rope({ style: 'between two points', use: 'zipline', endX: 12, endY: -3, endZ: 0, slack: 0.2, zipSpeed: 9 }), player(0.5, 4.5)],
      [event([block('rope.on_end', {}, 'Rope')], [block('var.add', { variable: 'n', value: '1' })])], [num('n')]);
    const P = rt.world.of('Player')[0];
    rt.world.behavior(P, 'platform')!.props.gravity = 0; // waits in the air at the top
    ticks(rt, 2); press(rt, 'E');
    expect(ropeOf(rt).state.rope.holder).toBe(2);
    const x0 = P.x; ticks(rt, 30);
    expect(P.x).toBeGreaterThan(x0 + 1);
    ticks(rt, 240);
    expect(P.x).toBeGreaterThan(11.5); // at the end, and it carries on a little with the speed it had
    expect(P.x).toBeLessThan(15);
    expect(rt.globals.n).toBe(1);
    expect(ropeOf(rt).state.rope.holder).toBe(0);
  });
  it('a decoration rope cannot be grabbed', () => {
    const rt = make([floor, rope({ use: 'decoration', length: 5.5 }), player(0.2)]);
    ticks(rt, 3); press(rt, 'E');
    expect(ropeOf(rt).state.rope.holder).toBe(0);
  });
});
