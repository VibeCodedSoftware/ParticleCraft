// Shape-aware physics (P0): grounding by collider shape, pushing, tipping, rolling, floating tilt, and collision that
// follows the final transform (rotated solids, Sine / Rotate platforms).
import { describe, expect, it } from 'vitest';
import { doc, scene } from './helpers';
import { Runtime } from '../src/runtime/runtime';
import { behaviorDefaults } from '../src/runtime/behaviors';
import { World } from '../src/runtime/world';
import { quatFromEuler, quatMatrix } from '../src/runtime/orient';

const bh = (type: string, props: Record<string, any> = {}) => ({ type, props: { ...behaviorDefaults(type), ...props } });
const floor = { uid: 1, type: 'Floor', kind: 'box' as const, x: 0, y: -0.5, z: 0, sx: 40, sy: 1, sz: 40, behaviors: [bh('solid')] };
const player = (o: any = {}) => ({ uid: 9, type: 'Player', kind: 'box' as const, x: 0, y: 5, z: 0, sx: 0.6, sy: 1.8, sz: 0.6, behaviors: [bh('platform', { defaultControls: false })], ...o });
const body = (kind: string, o: any = {}, props: any = {}) => ({ uid: 2, type: 'Body', kind: kind as any, x: 0, y: 0.5, z: 0, sx: 1, sy: 1, sz: 1, collider: { shape: kind === 'box' ? 'box' : kind, size: [1, 1, 1], offset: [0, 0, 0] }, behaviors: [bh('physics', props)], ...o });
function world(insts: any[]) { return new Runtime(scene(insts, '3d'), doc([], [], 'xz'), { app: 'gamecraft' }); }
const run = (rt: Runtime, n: number, each?: () => void) => { for (let i = 0; i < n; i++) { each?.(); rt.tick(); } };
/** Degrees between the body's up axis and world up (Euler-wrap safe). */
const tilt = (i: { rx: number; ry: number; rz: number }) => (Math.acos(Math.max(-1, Math.min(1, quatMatrix(quatFromEuler(i.rx, i.ry, i.rz))[4]))) * 180) / Math.PI;

describe('shape-aware physics: cubes', () => {
  it('a cube dropped on the floor lands flat, stays upright and falls asleep', () => {
    const rt = world([floor, body('box', { y: 3 })]);
    run(rt, 240);
    const c = rt.world.of('Body')[0];
    expect(c.y).toBeCloseTo(0.5, 1);
    expect(tilt(c)).toBeLessThan(1);
    expect(c.state.rigid.asleep).toBe(true);
  });

  it('a character can stand on a cube', () => {
    const rt = world([floor, body('box', { sx: 1.5, sy: 1, sz: 1.5 }), player({ y: 4 })]);
    run(rt, 180);
    const p = rt.world.of('Player')[0];
    expect(p.y).toBeCloseTo(1 + 0.9, 1); // on the cube's top
    expect(p.state.platform.standingOn).toBe(2);
    expect(tilt(rt.world.of('Body')[0])).toBeLessThan(2);
  });

  it('a character pushes a cube along the floor; it slides upright', () => {
    const rt = world([floor, body('box', { x: 2 }), player({ x: 0, y: 0.9 })]);
    const p = rt.world.of('Player')[0];
    run(rt, 150, () => { p.vx = 4; });
    const c = rt.world.of('Body')[0];
    expect(c.x).toBeGreaterThan(5);
    expect(tilt(c)).toBeLessThan(10);
    expect(p.x).toBeGreaterThan(3.5); // the character kept walking with it
  });

  it('a cube pushed past the edge of a ledge tips over and falls', () => {
    const ledge = { uid: 3, type: 'Ledge', kind: 'box' as const, x: -2, y: 1.5, z: 0, sx: 4, sy: 1, sz: 4, behaviors: [bh('solid')] };
    const rt = world([floor, ledge, body('box', { x: -0.3, y: 2.5 })]); // centre of mass 0.3 past the ledge edge (x = 0)
    run(rt, 240);
    const c = rt.world.of('Body')[0];
    expect(c.y).toBeLessThan(1.2); // fell off
    expect(c.x).toBeGreaterThan(0);
  });

  it('a stack of three cubes stands and settles', () => {
    const rt = world([floor, body('box', { uid: 2, y: 0.5 }), body('box', { uid: 3, y: 1.52 }), body('box', { uid: 4, y: 2.54 })]);
    run(rt, 360);
    for (const c of rt.world.of('Body')) expect(tilt(c)).toBeLessThan(2);
    expect(Math.max(...rt.world.of('Body').map((c) => c.y))).toBeCloseTo(2.5, 1);
    expect(Math.max(...rt.world.of('Body').map((c) => Math.abs(c.x)))).toBeLessThan(0.05);
  });

  it('a cube balanced well inside a ledge stays put', () => {
    const ledge = { uid: 3, type: 'Ledge', kind: 'box' as const, x: -2, y: 1.5, z: 0, sx: 4, sy: 1, sz: 4, behaviors: [bh('solid')] };
    const rt = world([floor, ledge, body('box', { x: -0.7, y: 2.5 })]); // 0.2 of the cube hangs over, centre still supported
    run(rt, 240);
    const c = rt.world.of('Body')[0];
    expect(c.y).toBeCloseTo(2.5, 1);
    expect(tilt(c)).toBeLessThan(2);
  });
});

describe('shape-aware physics: cylinders, spheres, cones', () => {
  const slope = { uid: 3, type: 'Ramp', kind: 'ramp' as const, x: 0, y: 1, z: 0, sx: 6, sy: 2, sz: 8, behaviors: [bh('solid')] };

  it('an upright cylinder stands on its flat base and a character can stand on its flat top', () => {
    const rt = world([floor, body('cylinder', { sx: 1.4, sz: 1.4 }), player({ y: 4 })]);
    run(rt, 180);
    const c = rt.world.of('Body')[0], p = rt.world.of('Player')[0];
    expect(tilt(c)).toBeLessThan(2);
    expect(p.y).toBeCloseTo(1 + 0.9, 1);
  });

  it('a cylinder lying on its side rolls down a slope', () => {
    const rt = world([floor, slope, body('cylinder', { x: 0, y: 2.6, z: -2.5, rz: 90, sx: 0.8, sy: 1.6, sz: 0.8 }, { friction: 0.8 })]); // axis along X, rolls along Z
    run(rt, 180);
    const c = rt.world.of('Body')[0];
    expect(c.z).toBeGreaterThan(3); // rolled downhill (+Z)
    expect(Math.abs(c.state.rigid.w[0])).toBeGreaterThan(0.5); // spinning about its axis, not sliding
  });

  it('a sphere rolls down a slope and keeps rolling across the floor', () => {
    const rt = world([floor, slope, body('sphere', { x: 0, y: 2.6, z: -2.5, sx: 0.8, sy: 0.8, sz: 0.8 }, { friction: 0.8 })]);
    run(rt, 150);
    const s = rt.world.of('Body')[0];
    expect(s.z).toBeGreaterThan(5);
    expect(Math.hypot(...(s.state.rigid.w as number[]))).toBeGreaterThan(1);
  });

  it('a sphere is not a stable platform: a character dropped on it ends up off it', () => {
    const rt = world([floor, body('sphere', { y: 0.75, sx: 1.5, sy: 1.5, sz: 1.5 }, { mass: 2 }), player({ x: 0.15, y: 3.5 })]);
    run(rt, 300);
    const p = rt.world.of('Player')[0];
    expect(p.y).toBeLessThan(1.2); // back on the floor, not balanced on the ball
  });

  it('a cone stands on its base but falls over when stood on its point', () => {
    const rt = world([floor, body('cone')]);
    run(rt, 180);
    expect(tilt(rt.world.of('Body')[0])).toBeLessThan(2);
    const rt2 = world([floor, body('cone', { y: 0.6, rx: 180, rz: 4 })]); // upside down, slightly off balance
    run(rt2, 300);
    const c = rt2.world.of('Body')[0];
    expect(180 - tilt(c)).toBeGreaterThan(30); // tipped away from point-down
  });

  it('a character slides off the point of a cone', () => {
    const rt = world([floor, body('cone', { sx: 1.6, sy: 1.6, sz: 1.6, y: 0.8 }, { mass: 20 }), player({ x: 0.1, y: 4 })]);
    run(rt, 240);
    expect(rt.world.of('Player')[0].y).toBeLessThan(1.2);
  });
});

describe('floating bodies (existing buoyancy, now with tilt)', () => {
  const pool = { uid: 5, type: 'Pool', kind: 'box' as const, x: 0, y: -2, z: 0, sx: 20, sy: 4, sz: 20, behaviors: [bh('water')] }; // surface y = 0
  const bottom = { uid: 6, type: 'Bottom', kind: 'box' as const, x: 0, y: -4.5, z: 0, sx: 40, sy: 1, sz: 40, behaviors: [bh('solid')] };
  it('a raft floats level, tilts toward a character standing near its edge, and holds the character up', () => {
    const raft = body('box', { y: 0, sx: 3, sy: 0.4, sz: 3 }, { mass: 4 }); // floats about half under, like a real raft
    const rt = world([pool, bottom, raft]);
    run(rt, 240);
    const r = rt.world.of('Body')[0];
    expect(r.y).toBeGreaterThan(-0.3);
    expect(tilt(r)).toBeLessThan(2);
    const rt2 = world([pool, bottom, raft, player({ x: 1.1, y: 2, sy: 1.8, behaviors: [bh('platform', { defaultControls: false, weight: 1 })] })]);
    run(rt2, 300);
    const r2 = rt2.world.of('Body')[0], p = rt2.world.of('Player')[0];
    expect(tilt(r2)).toBeGreaterThan(1);
    expect(quatMatrix(quatFromEuler(r2.rx, r2.ry, r2.rz))[3]).toBeLessThan(0); // its +X edge (where the character stands) is the low one
    expect(p.state.platform.standingOn).toBe(2);
    expect(p.y).toBeGreaterThan(0.5); // standing on it, not swimming
  });
});

describe('collision follows the final world transform', () => {
  it('a rotated plank collides along its rotated length, not its unrotated box', () => {
    const w = new World(scene([{ uid: 1, type: 'Plank', kind: 'box', x: 0, y: 0, z: 0, sx: 4, sy: 0.2, sz: 0.4, ry: 90, behaviors: [bh('solid')] }], '3d'));
    const b = w.aabb(w.of('Plank')[0]);
    expect(b[3] - b[0]).toBeCloseTo(0.4, 2); // turned: 0.4 wide along X
    expect(b[5] - b[2]).toBeCloseTo(4, 2); // and 4 long along Z
  });

  it('a 45° plank is covered closely (corners of its bounding box stay free)', () => {
    const w = new World(scene([{ uid: 1, type: 'Plank', kind: 'box', x: 0, y: 0, z: 0, sx: 4, sy: 0.2, sz: 0.4, ry: 45, behaviors: [bh('solid')] }], '3d'));
    const boxes = w.aabbs(w.of('Plank')[0]);
    const inside = (x: number, z: number) => boxes.some((b) => x > b[0] && x < b[3] && z > b[2] && z < b[5]);
    expect(inside(0, 0)).toBe(true);
    expect(inside(1.2, -1.2)).toBe(true); // along the plank
    expect(inside(1.2, 1.2)).toBe(false); // empty corner of the bounding square
  });

  it('a character rides a Sine platform without sinking, whatever the object order', () => {
    const plat = { uid: 3, type: 'Lift', kind: 'box' as const, x: 0, y: 1, z: 0, sx: 3, sy: 0.4, sz: 3, behaviors: [bh('solid'), bh('sine', { movement: 'vertical', period: 2, magnitude: 1.5 })] };
    for (const order of [[player({ y: 2.5 }), plat], [plat, player({ y: 2.5 })]]) {
      const rt = world([floor, ...order]);
      let worst = 0;
      run(rt, 360, () => {
        const p = rt.world.of('Player')[0], l = rt.world.of('Lift')[0];
        if (p.state.platform?.standingOn === 3) worst = Math.max(worst, (l.y + 0.2) - (p.y - 0.9));
      });
      expect(worst).toBeLessThan(0.05);
      expect(rt.world.of('Player')[0].state.platform.standingOn).toBe(3);
    }
  });

  it('a character turns with a spinning (Rotate) platform', () => {
    const disc = { uid: 3, type: 'Disc', kind: 'box' as const, x: 0, y: 0.25, z: 0, sx: 6, sy: 0.5, sz: 6, collider: { shape: 'cylinder', size: [1, 1, 1], offset: [0, 0, 0] }, behaviors: [bh('solid'), bh('rotate', { speed: 90, axis: 'y' })] };
    const rt = world([floor, disc, player({ x: 2, y: 2 })]);
    run(rt, 60);
    const p = rt.world.of('Player')[0];
    const a0 = Math.atan2(-p.z, p.x);
    run(rt, 60); // a further second: a quarter turn
    const a1 = Math.atan2(-p.z, p.x);
    expect(Math.abs(((a1 - a0) * 180) / Math.PI - 90)).toBeLessThan(10);
    expect(Math.hypot(p.x, p.z)).toBeCloseTo(2, 0);
  });
});
