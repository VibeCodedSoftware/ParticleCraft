// Floating (the existing Water buoyancy): a character standing near a raft's edge tilts it a few degrees toward
// them and stays on board; the raft levels again within a second after they step off; a block with a low centre of
// mass rights itself and stops rocking; a top-heavy one turns over and settles.
import { describe, expect, it } from 'vitest';
import { doc, scene } from './helpers';
import { Runtime } from '../src/runtime/runtime';
import { behaviorDefaults } from '../src/runtime/behaviors';

const bh = (t: string, p: Record<string, any> = {}) => ({ type: t, props: { ...behaviorDefaults(t), ...p } });
const pool = { uid: 1, type: 'Pool', kind: 'box' as const, x: 0, y: -1, z: 0, sx: 20, sy: 2, sz: 20, collider: { shape: 'box' as const, size: [1, 1, 1] as [number, number, number], offset: [0, 0, 0] as [number, number, number] }, behaviors: [bh('water')] };
const floor = { uid: 9, type: 'Floor', kind: 'box' as const, x: 0, y: -2.5, z: 0, sx: 30, sy: 1, sz: 30, behaviors: [bh('solid')] };
const make = (insts: any[]) => new Runtime(scene(insts, '3d'), doc([], [], 'xz'), { app: 'gamecraft' });
const ticks = (rt: Runtime, n: number, each?: () => void) => { for (let k = 0; k < n; k++) { rt.tick(); each?.(); } };

describe('floating', () => {
  for (const weight of [1, 4]) it(`a raft holds a player (weight ${weight}) near its edge, tilting a little, and levels when they leave`, () => {
    const rt = make([floor, pool, { uid: 2, type: 'Raft', kind: 'box', x: 0, y: 0.2, z: 0, sx: 3, sy: 0.3, sz: 2, behaviors: [bh('physics', { mass: 1.5 })] }, { uid: 3, type: 'Hero', kind: 'box', x: 1.2, y: 1.5, z: 0, sx: 0.5, sy: 1, sz: 0.5, behaviors: [bh('platform', { weight })] }]);
    const r = rt.world.of('Raft')[0], h = rt.world.of('Hero')[0];
    let maxTilt = 0;
    ticks(rt, 300, () => { maxTilt = Math.max(maxTilt, Math.abs(r.rz)); });
    expect(h.state.platform.grounded).toBe(true); // still on board
    expect(h.y).toBeGreaterThan(0.3);
    expect(Math.abs(r.rz)).toBeGreaterThan(1); // leans toward the player…
    expect(maxTilt).toBeLessThan(12); // …a little
    h.x = 50; h.y = 50;
    ticks(rt, 60);
    expect(Math.abs(r.rz)).toBeLessThan(1.5); // level again within a second
  });
  it('a low centre of mass rights itself and stops rocking; a top-heavy block turns over and settles', () => {
    for (const [com, want] of [[-0.8, 0], [0.6, 180]] as const) {
      const rt = make([floor, pool, { uid: 4, type: 'Tall', kind: 'box', x: 0, y: 0.5, z: 0, rz: 25, sx: 0.8, sy: 2, sz: 0.8, behaviors: [bh('physics', { mass: 1.2, centerOfMassY: com })] }]);
      const t = rt.world.of('Tall')[0];
      ticks(rt, 240);
      const off = (a: number) => Math.abs(((a - want + 540) % 360) - 180);
      expect(off(t.rz)).toBeLessThan(2);
      const before = t.rz; ticks(rt, 60);
      expect(Math.abs(((t.rz - before + 540) % 360) - 180)).toBeLessThan(1); // not rocking any more (±180° is the same)
    }
  });
});
