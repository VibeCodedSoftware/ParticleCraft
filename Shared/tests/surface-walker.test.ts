// Spherical gravity and wall walking: a Surface Walker walks all the way round a Planet with its feet on the surface;
// a Physics body falls sideways onto a planet; with Walk on walls a walker climbs a wall, wraps over its top edge and
// down the far side; without it the wall just blocks. Its drawn rotation stands on the surface.
import { describe, expect, it } from 'vitest';
import { doc, scene } from './helpers';
import { Runtime } from '../src/runtime/runtime';
import { behaviorDefaults } from '../src/runtime/behaviors';
import { quatFromEuler, quatMatrix } from '../src/runtime/orient';

const bh = (type: string, props: Record<string, any> = {}) => ({ type, props: { ...behaviorDefaults(type), ...props } });
const make = (insts: any[]) => new Runtime(scene(insts, '3d'), doc([], [], 'xz'), { app: 'gamecraft' });
const box = (o: any) => ({ kind: 'box', collider: { shape: 'box', size: [1, 1, 1], offset: [0, 0, 0] }, ...o });
const upOf = (i: any) => { const m = quatMatrix(quatFromEuler(i.rx, i.ry, i.rz)); return [m[1], m[4], m[7]]; };

describe('planets', () => {
  const planet = { uid: 1, type: 'Planet', kind: 'sphere', x: 0, y: 20, z: 0, sx: 6, sy: 6, sz: 6, collider: { shape: 'sphere', size: [1, 1, 1], offset: [0, 0, 0] }, behaviors: [bh('solid'), bh('planet', { gravity: 18 })] };
  it('a walker goes all the way round, feet on the surface', () => {
    const rt = make([planet, box({ uid: 2, type: 'Hero', x: 0, y: 23.6, z: 0, sx: 0.6, sy: 1, sz: 0.6, behaviors: [bh('surfacewalker', { maxSpeed: 5 })] })]);
    const h = rt.world.of('Hero')[0];
    for (let k = 0; k < 30; k++) rt.tick(); // settle onto the top
    rt.input.keyDown('D');
    let minUpY = 1, worst = 0;
    for (let k = 0; k < 360; k++) {
      rt.tick();
      const st = h.state.walker, d = Math.hypot(h.x, h.y - 20, h.z);
      if (st.grounded) worst = Math.max(worst, Math.abs(d - 3.5)); // radius 3 + half height 0.5
      minUpY = Math.min(minUpY, st.up[1]);
    }
    expect(minUpY).toBeLessThan(-0.9); // reached the underside without falling off
    expect(worst).toBeLessThan(0.02);
    const u = upOf(h), want = h.state.walker.look; // drawn standing on the surface
    expect(u[0] * want[0] + u[1] * want[1] + u[2] * want[2]).toBeGreaterThan(0.99);
  });
  it('with a follow camera: W walks round the planet and the camera stays above the walker', () => {
    const cam = { uid: 4, type: 'Camera', kind: 'camera', x: -6, y: 27, z: 0, camera: { active: true }, behaviors: [bh('follow', { target: 'Hero', offsetX: 0, offsetY: 3, offsetZ: 6, smoothing: 0.6 })] };
    const rt = make([planet, cam, box({ uid: 2, type: 'Hero', x: 0, y: 23.6, z: 0, sx: 0.6, sy: 1, sz: 0.6, behaviors: [bh('surfacewalker', { maxSpeed: 5 })] })]);
    const h = rt.world.of('Hero')[0], c = rt.world.of('Camera')[0];
    for (let k = 0; k < 30; k++) rt.tick();
    rt.input.keyDown('W');
    let minUpY = 1, below = 0;
    for (let k = 0; k < 420; k++) {
      rt.tick();
      const u = h.state.walker.up;
      minUpY = Math.min(minUpY, u[1]);
      if ((c.x - h.x) * u[0] + (c.y - h.y) * u[1] + (c.z - h.z) * u[2] < 0.5) below++;
    }
    expect(minUpY).toBeLessThan(-0.9);
    expect(below).toBeLessThan(10); // the camera stays on the walker's sky side
  });
  it('a physics body falls sideways onto it', () => {
    const rt = make([planet, box({ uid: 3, type: 'Rock', x: 7, y: 20, z: 0, sx: 0.5, sy: 0.5, sz: 0.5, behaviors: [bh('physics', { mass: 1 })] })]);
    const r = rt.world.of('Rock')[0];
    for (let k = 0; k < 180; k++) rt.tick();
    const d = Math.hypot(r.x, r.y - 20, r.z);
    expect(d).toBeLessThan(4.2); // pulled in from 7 m
    expect(d).toBeGreaterThan(2.9); // stopped by the surface, not inside
  });
});

describe('wall walking', () => {
  const floor = box({ uid: 1, type: 'Floor', x: 0, y: -0.5, z: 0, sx: 40, sy: 1, sz: 40, behaviors: [bh('solid')] });
  // Which way W goes (relative to the camera): measure it, then put the wall there.
  const dir = (() => { const rt = make([floor, box({ uid: 2, type: 'Hero', x: 0, y: 0.5, z: 0, behaviors: [bh('surfacewalker')] })]); rt.tick(); rt.input.keyDown('W'); for (let k = 0; k < 20; k++) rt.tick(); const h = rt.world.of('Hero')[0]; const l = Math.hypot(h.x, h.z); return [h.x / l, h.z / l]; })();
  const wall = box({ uid: 3, type: 'Wall', x: dir[0] * 4, y: 2, z: dir[1] * 4, sx: Math.abs(dir[0]) > 0.5 ? 2 : 8, sy: 4, sz: Math.abs(dir[0]) > 0.5 ? 8 : 2, behaviors: [bh('solid')] });
  it('climbs a wall, wraps over the top and down the far side', () => {
    const rt = make([floor, wall, box({ uid: 2, type: 'Hero', x: 0, y: 0.5, z: 0, behaviors: [bh('surfacewalker', { walkOnWalls: true, maxSpeed: 4 })] })]);
    const h = rt.world.of('Hero')[0];
    rt.tick(); rt.input.keyDown('W');
    const seen: string[] = [];
    let top = 0;
    for (let k = 0; k < 400; k++) {
      rt.tick();
      const u = h.state.walker.up.map((x: number) => Math.round(x)).join(',');
      if (seen[seen.length - 1] !== u) seen.push(u);
      top = Math.max(top, h.y);
    }
    const back = `${Math.round(-dir[0])},0,${Math.round(-dir[1])}`.replace('-0', '0'), front = `${Math.round(dir[0])},0,${Math.round(dir[1])}`.replace('-0', '0');
    expect(seen.slice(0, 4)).toEqual(['0,1,0', back, '0,1,0', front]); // floor → wall face → top → far face
    expect(top).toBeGreaterThan(4.4); // stood on top (4 m)
  });
  it('without Walk on walls the wall just blocks', () => {
    const rt = make([floor, wall, box({ uid: 2, type: 'Hero', x: 0, y: 0.5, z: 0, behaviors: [bh('surfacewalker')] })]);
    const h = rt.world.of('Hero')[0];
    rt.tick(); rt.input.keyDown('W');
    for (let k = 0; k < 200; k++) rt.tick();
    expect(h.y).toBeCloseTo(0.5, 1);
    expect(Math.hypot(h.x, h.z)).toBeLessThan(3.1); // against the wall (its face at 3 m)
  });
});
