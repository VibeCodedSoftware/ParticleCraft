// Ramp (wedge) collision: things rest on the slope, not on its bounding box; they can climb it and slide down it.
import { describe, expect, it } from 'vitest';
import { doc, scene } from './helpers';
import { Runtime } from '../src/runtime/runtime';
import { behaviorDefaults } from '../src/runtime/behaviors';

const bh = (type: string, props: Record<string, any> = {}) => ({ type, props: { ...behaviorDefaults(type), ...props } });
// Ramp 6 long (z), 2 high: rises toward -Z, so with ry = 0 its top edge is at z = -3.
const ramp = (o: any = {}) => ({ uid: 1, type: 'Ramp', kind: 'ramp' as const, x: 0, y: 1, z: 0, sx: 4, sy: 2, sz: 6, behaviors: [bh('solid')], ...o });
const floor = { uid: 2, type: 'Floor', kind: 'box' as const, x: 0, y: -0.5, z: 0, sx: 40, sy: 1, sz: 40, behaviors: [bh('solid')] };

function run(cube: any, rampOver: any = {}, ticks = 120) {
  const rt = new Runtime(scene([floor, ramp(rampOver), { uid: 3, type: 'Cube', kind: 'box', sx: 0.5, sy: 0.5, sz: 0.5, ...cube }], '3d'), doc([], [], 'xz'), { app: 'gamecraft' });
  for (let i = 0; i < ticks; i++) rt.tick();
  return rt.world.of('Cube')[0];
}
const slopeY = (z: number) => 1 + (0 - z / 6) * 2; // surface height at z (bottom 0, top 2)

describe('Ramp collision', () => {
  it('an immovable cube dropped on the ramp rests on the slope, not on the top of the bounding box', () => {
    const c = run({ x: 0, y: 4, z: 1.5, behaviors: [bh('physics', { friction: 1 })] }, {}, 90);
    const bottom = c.y - 0.25;
    expect(bottom).toBeLessThan(1.9); // the bounding-box top is 2
    expect(bottom).toBeGreaterThan(slopeY(c.z + 0.25) - 0.05); // never sinks into the slope
  });

  it('a physics cube slides down the slope and ends up on the floor, never inside the ramp', () => {
    const rt = new Runtime(scene([floor, ramp(), { uid: 3, type: 'Cube', kind: 'box', x: 0, y: 2.6, z: -2, sx: 0.5, sy: 0.5, sz: 0.5, behaviors: [bh('physics', { friction: 0.2 })] }], '3d'), doc([], [], 'xz'), { app: 'gamecraft' });
    let worst = 0;
    for (let i = 0; i < 240; i++) {
      rt.tick();
      const c = rt.world.of('Cube')[0];
      if (Math.abs(c.z) < 3 && Math.abs(c.x) < 2) worst = Math.max(worst, slopeY(Math.min(3, c.z + 0.25)) - (c.y - 0.25));
    }
    const c = rt.world.of('Cube')[0];
    expect(worst).toBeLessThan(0.06); // never sank into the slope
    expect(c.z).toBeGreaterThan(1); // slid downhill (+Z)
  });

  it('a platform character walks up the ramp instead of being stopped by it', () => {
    const rt = new Runtime(scene([floor, ramp(), { uid: 3, type: 'Player', kind: 'box', x: 0, y: 0.5, z: 4, sx: 0.6, sy: 1, sz: 0.6, behaviors: [bh('platform', { defaultControls: false })] }], '3d'), doc([], [], 'xz'), { app: 'gamecraft' });
    const p = rt.world.of('Player')[0];
    let worst = 0;
    for (let i = 0; i < 200 && p.z > -1.5; i++) {
      p.vz = -3; rt.tick();
      if (p.z < 2.7) worst = Math.max(worst, slopeY(p.z + 0.3) - (p.y - 0.5));
    }
    expect(p.z).toBeLessThan(-1.4); // made it most of the way up
    expect(worst).toBeLessThan(0.1); // on the slope, never inside it
  });

  it('rotated ramps use rotated bounds and slope', () => {
    const c = run({ x: 1.5, y: 4, z: 0, behaviors: [bh('physics', { friction: 1 })] }, { ry: 90, sx: 4, sz: 6 }, 90);
    // ry = 90 turns local -Z (the tall side) toward world -X.
    expect(c.y - 0.25).toBeLessThan(1.6);
  });
});
