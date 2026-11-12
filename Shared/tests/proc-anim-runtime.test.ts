// Procedural Animation, game side: ragdoll on death (movement stops, the object drops to the ground), the Ragdoll /
// Get up / Look at blocks, and wall climbing with Platform movement.
import { describe, expect, it } from 'vitest';
import { doc, scene } from './helpers';
import { Runtime } from '../src/runtime/runtime';
import { behaviorDefaults } from '../src/runtime/behaviors';
import { ACTIONS, CONDITIONS } from '../src/runtime/blockImpl';

const bh = (type: string, props: Record<string, any> = {}) => ({ type, props: { ...behaviorDefaults(type), ...props } });
const floor = { uid: 1, type: 'Floor', kind: 'box' as const, x: 0, y: -0.5, z: 0, sx: 60, sy: 1, sz: 60, behaviors: [bh('solid')] };
const spider = (o: Record<string, any> = {}, props: Record<string, any> = {}) => ({ uid: 2, type: 'Spider', kind: 'box' as const, x: 0, y: 0.5, z: 0, sx: 1, sy: 1, sz: 1, behaviors: [bh('platform'), bh('procanim', props)], ...o });
const make = (insts: any[]) => new Runtime(scene(insts, '3d'), doc([], [], 'xz'), { app: 'gamecraft' });
const ticks = (rt: Runtime, n: number) => { for (let k = 0; k < n; k++) rt.tick(); };
const act = (rt: Runtime, id: string, inst: any, params: Record<string, any> = {}) => ACTIONS[id](rt, { id: 'b', type: id, params } as any, {} as any, inst);

describe('procedural animation: ragdoll', () => {
  it('on death: goes limp, ignores the controls and drops to the ground', () => {
    const rt = make([floor, spider({ y: 3 })]);
    const s = rt.world.of('Spider')[0];
    ticks(rt, 5);
    s.state.health = { hp: 0, dead: true };
    rt.input.keyDown('W');
    ticks(rt, 90);
    expect(s.state.procanim.ragdoll).toBeTruthy();
    expect(Math.hypot(s.x, s.z)).toBeLessThan(0.3); // the controls no longer move it
    expect(s.y).toBeCloseTo(0.5, 1); // fell onto the floor
  });
  it('blocks: Ragdoll (with a push), Is ragdoll, Get up, Look at', () => {
    const rt = make([floor, spider(), { uid: 3, type: 'Player', kind: 'box', x: 5, y: 0.5, z: 0 }]);
    const s = rt.world.of('Spider')[0];
    ticks(rt, 3);
    const isRagdoll = () => CONDITIONS['proc.is_ragdoll'].test!(rt, {} as any, {} as any, s);
    act(rt, 'proc.ragdoll', s, { force: '4' });
    expect(isRagdoll()).toBe(true);
    expect(Math.hypot(...s.state.procanim.ragdoll.push)).toBeCloseTo(4, 1);
    act(rt, 'proc.get_up', s);
    expect(isRagdoll()).toBe(false);
    rt.input.keyDown('W'); ticks(rt, 20);
    expect(Math.hypot(s.x, s.z)).toBeGreaterThan(0.3); // moves again
    act(rt, 'proc.look_at', s, { target: 'Player' });
    expect(s.state.procanim.lookAt).toBe(3);
  });
});

describe('procedural animation: wall climbing', () => {
  it('walks up a wall it pushes into, and steps onto the top', () => {
    // Which way W goes (3D Platform moves relative to the camera).
    const probe = make([floor, spider()]);
    probe.input.keyDown('W'); ticks(probe, 2);
    const [ix, iz] = probe.world.of('Spider')[0].state.platform.intent as [number, number];
    // A 3 m wall 2 m ahead, 2 m thick.
    const wall = { uid: 4, type: 'Wall', kind: 'box' as const, x: ix * 3, y: 1.5, z: iz * 3, sx: Math.abs(ix) > 0.5 ? 2 : 6, sy: 3, sz: Math.abs(ix) > 0.5 ? 6 : 2, behaviors: [bh('solid')] };
    for (const climbWalls of [false, true]) {
      const rt = make([floor, spider({}, { climbWalls }), wall]);
      const s = rt.world.of('Spider')[0];
      rt.input.keyDown('W');
      let climbed = false, top = 0;
      let onTop = 0;
      for (let k = 0; k < 240; k++) {
        rt.tick();
        if (s.state.procanim?.climb) climbed = true;
        top = Math.max(top, s.y);
        if (!s.state.procanim?.climb && Math.abs(s.y - 3.5) < 0.05) onTop++; // standing on the wall's top (3 m)
      }
      if (!climbWalls) { expect(climbed).toBe(false); expect(top).toBeLessThan(1); continue; }
      expect(climbed).toBe(true);
      expect(onTop).toBeGreaterThan(10); // stepped over the edge and walked on top (then off the far side)
      expect(s.state.procanim.climb).toBeNull();
    }
  });
});
