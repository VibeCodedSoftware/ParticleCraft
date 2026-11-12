// Phase 4 world systems: day/night clock, water (swimming, floating, sinking), light blocks, per-player controls.
import { describe, expect, it } from 'vitest';
import { block, doc, event, num, scene } from './helpers';
import { Runtime } from '../src/runtime/runtime';
import { behaviorDefaults } from '../src/runtime/behaviors';
import { DEFAULT_SKY, isNight, skyState } from '../src/runtime/sky';

const bh = (type: string, props: Record<string, any> = {}) => ({ type, props: { ...behaviorDefaults(type), ...props } });
const ticks = (rt: Runtime, n: number) => { for (let i = 0; i < n; i++) rt.tick(); };

describe('sky', () => {
  it('sun is up at noon and down at midnight', () => {
    expect(skyState({ ...DEFAULT_SKY, time: 12 }).elevation).toBeGreaterThan(60);
    expect(isNight({ ...DEFAULT_SKY, time: 0 })).toBe(true);
    expect(isNight({ ...DEFAULT_SKY, time: 12 })).toBe(false);
  });

  it('the cycle advances time and fires nightfall and daybreak', () => {
    const s = scene([]);
    s.settings.sky = { ...DEFAULT_SKY, enabled: true, cycle: true, time: 17.5, dayLength: 24 }; // 1 hour per second
    const rt = new Runtime(s, doc([
      event([block('sky.on_nightfall')], [block('var.add', { variable: 'n', value: '1' })]),
      event([block('sky.on_daybreak')], [block('var.add', { variable: 'd', value: '1' })]),
    ], [num('n'), num('d')]), { app: 'logiccraft' });
    ticks(rt, 60 * 14); // 17:30 -> 07:30
    expect(rt.globals.n).toBe(1);
    expect(rt.globals.d).toBe(1);
    expect(rt.scene.settings.sky!.time).toBeGreaterThan(7);
    expect(rt.scene.settings.sky!.time).toBeLessThan(8);
  });

  it('Set time of day turns the sky on', () => {
    const rt = new Runtime(scene([]), doc([event([block('system.on_start_of_layout')], [block('sky.set_time', { hours: '22' })])]), { app: 'logiccraft' });
    ticks(rt, 2);
    expect(rt.scene.settings.sky?.enabled).toBe(true);
    expect(isNight(rt.scene.settings.sky!)).toBe(true);
  });
});

describe('water', () => {
  const pool = { uid: 1, type: 'Pool', kind: 'box' as const, x: 0, y: -2, z: 0, sx: 20, sy: 4, sz: 20, behaviors: [bh('water')] }; // surface at y = 0
  const floor = { uid: 2, type: 'Floor', kind: 'box' as const, x: 0, y: -4.5, z: 0, sx: 40, sy: 1, sz: 40, behaviors: [bh('solid')] };

  it('a light physics box floats up to the surface; a heavy one sinks', () => {
    const s = scene([pool, floor, { uid: 3, type: 'Crate', kind: 'box', x: -3, y: -2.5, sx: 1, sy: 1, sz: 1, behaviors: [bh('physics', { mass: 0.5 })] },
      { uid: 4, type: 'Anchor', kind: 'box', x: 3, y: -1, sx: 1, sy: 1, sz: 1, behaviors: [bh('physics', { mass: 20 })] }], '3d');
    const rt = new Runtime(s, doc([], [], 'xz'), { app: 'gamecraft' });
    ticks(rt, 60 * 6);
    const crate = rt.world.of('Crate')[0], anchor = rt.world.of('Anchor')[0];
    expect(crate.y).toBeGreaterThan(-0.6); // bobbing at the surface
    expect(anchor.y).toBeLessThan(-3.4); // resting on the bottom
  });

  it('platform characters swim: slow sink, rise while Jump is held, and report entering water', () => {
    const s = scene([pool, floor, { uid: 3, type: 'Player', kind: 'box', x: 0, y: 2, sx: 0.6, sy: 1, sz: 0.6, behaviors: [bh('platform')] }], '3d');
    const rt = new Runtime(s, doc([event([block('water.on_enter', {}, 'Player')], [block('var.add', { variable: 'n', value: '1' })])], [num('n')], 'xz'), { app: 'gamecraft' });
    ticks(rt, 60 * 2);
    const p = rt.world.of('Player')[0];
    expect(rt.globals.n).toBe(1);
    expect(p.state.inWater).toBe(true);
    expect(p.y).toBeGreaterThan(-3.4); // still sinking slowly, not dropped to the floor
    const y0 = p.y;
    rt.input.keyDown('Space');
    ticks(rt, 30);
    expect(p.y).toBeGreaterThan(y0);
    expect(p.animation).toBe('swim');
  });
});

describe('lights', () => {
  it('power, flicker and scene glow', () => {
    const s = scene([{ uid: 1, type: 'Lamp', kind: 'light' }], '3d');
    const rt = new Runtime(s, doc([
      event([block('system.on_start_of_layout')], [block('light.flicker', { seconds: '0.5' }, 'Lamp'), block('light.set_emission', { percent: '0' })]),
    ], [], 'xz'), { app: 'gamecraft' });
    const base = rt.world.of('Lamp')[0].light!.power;
    ticks(rt, 10);
    expect(rt.scene.settings.emissionScale).toBe(0);
    ticks(rt, 40);
    expect(rt.world.of('Lamp')[0].light!.power).toBe(base);
  });
});

describe('per-player controls', () => {
  it('WASD and Arrows drive different players; gamepad 2 and online players drive theirs', () => {
    const mk = (uid: number, controls: string, x: number) => ({ uid, type: 'Player', kind: 'box' as const, x, y: 0, sx: 1, sy: 1, behaviors: [bh('eightdir', { controls })] });
    const s = scene([mk(1, 'wasd', 0), mk(2, 'arrows', 10), mk(3, 'gamepad2', 20), mk(4, 'online2', 30)]);
    const rt = new Runtime(s, doc([]), { app: 'logiccraft' });
    rt.input.keyDown('D');
    rt.input.setGamepad([], [-1, 0], 0, 1); // second pad: stick left
    const remote = new (rt.input.constructor as any)();
    remote.applySnapshot({ keys: ['ArrowUp'], pad: null, axes: [0, 0, 0, 0] });
    rt.input.remotes.set(2, remote);
    ticks(rt, 30);
    const [a, b, c, d] = rt.world.of('Player');
    expect(a.x).toBeGreaterThan(0.5);
    expect(b.x).toBeCloseTo(10);
    expect(c.x).toBeLessThan(19.5);
    expect(d.y).toBeGreaterThan(0.5);
  });
});
