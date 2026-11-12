// P1 VR foundation: the VR Player behavior (move where you look, snap turn, teleport arc, grab / hold / throw) and the
// VR action bindings, driven headless through the same input a headset (WebXR) or the desktop preview feeds.
import { describe, expect, it } from 'vitest';
import { block, doc, event, num, scene } from './helpers';
import { Runtime } from '../src/runtime/runtime';
import { behaviorDefaults } from '../src/runtime/behaviors';
import { VR_ACTIONS } from '../src/runtime/input';
import { DEFAULT_VR, vrEffective } from '../src/vr';

const bh = (type: string, props: Record<string, any> = {}) => ({ type, props: { ...behaviorDefaults(type), ...props } });
const floor = { uid: 1, type: 'Floor', kind: 'box' as const, x: 0, y: -0.5, z: 0, sx: 60, sy: 1, sz: 60, behaviors: [bh('solid')] };
const rig = (o: any = {}, props: any = {}) => ({ uid: 2, type: 'Rig', kind: 'box' as const, x: 0, y: 0.9, z: 0, sx: 0.4, sy: 1.8, sz: 0.4, behaviors: [bh('vrplayer', props)], ...o });
function make(insts: any[], events: any[] = [], vars: any[] = []) {
  const rt = new Runtime(scene(insts, '3d'), doc(events, vars, 'xz'), { app: 'gamecraft' });
  rt.input.xr.active = true;
  return rt;
}
const hand = (rt: Runtime, h: 'left' | 'right', buttons: Record<string, boolean>, stick: [number, number] = [0, 0], pos: [number, number, number] = [0.3, 1.2, -0.3], dir: [number, number, number] = [0, 0, -1]) => rt.input.setXrHand(h, buttons, stick, { pos, dir });

describe('VR player', () => {
  it('left stick moves where the player looks', () => {
    const rt = make([floor, rig()]);
    const r = rt.world.of('Rig')[0];
    rt.input.xr.head.yaw = 90; // looking toward −X
    for (let i = 0; i < 60; i++) { hand(rt, 'left', {}, [0, 1]); rt.tick(); }
    expect(r.x).toBeLessThan(-2); expect(Math.abs(r.z)).toBeLessThan(0.1);
  });

  it('snap turn: one push = one step of the snap angle', () => {
    const rt = make([floor, rig({}, { snapAngle: 45 })]);
    const r = rt.world.of('Rig')[0];
    for (let i = 0; i < 20; i++) { hand(rt, 'right', {}, [1, 0]); rt.tick(); } // held: still one step
    expect(r.ry).toBeCloseTo(-45);
    for (let i = 0; i < 5; i++) { hand(rt, 'right', {}, [0, 0]); rt.tick(); }
    hand(rt, 'right', {}, [1, 0]); rt.tick();
    expect(r.ry).toBeCloseTo(-90);
  });

  it('teleport: aim with the right stick, land on the floor ahead, never into a wall', () => {
    const wall = { uid: 3, type: 'Wall', kind: 'box' as const, x: 0, y: 2, z: -12, sx: 20, sy: 4, sz: 1, behaviors: [bh('solid')] };
    const rt = make([floor, wall, rig({}, { teleportRange: 10, locomotion: 'teleport' })], [event([block('vr.on_teleported', {}, 'Rig')], [block('var.add', { variable: 'tp', value: '1' })])], [num('tp')]);
    const r = rt.world.of('Rig')[0];
    for (let i = 0; i < 10; i++) { hand(rt, 'right', {}, [0, 1], [0.2, 1.3, -0.2], [0, 0.4, -1]); rt.tick(); }
    const target = r.state.vr.teleport;
    expect(target).not.toBeNull(); expect(target[1]).toBeCloseTo(0, 1); expect(target[2]).toBeLessThan(-2);
    hand(rt, 'right', {}, [0, 0], [0.2, 1.3, -0.2], [0, 0.4, -1]); rt.tick();
    expect(r.z).toBeCloseTo(target[2], 1); expect(r.y).toBeGreaterThan(0.8); expect(rt.globals.tp).toBe(1);
    // Aiming at the wall (horizontal, straight at it) gives no target.
    rt.world.of('Rig')[0].z = -8;
    for (let i = 0; i < 3; i++) { hand(rt, 'right', {}, [0, 1], [0, 1.5, -8.3], [0, 0, -1]); rt.tick(); }
    expect(r.state.vr.teleport).toBeNull();
  });

  it('grab a physics object with the grip, it follows the hand, and is thrown with the hand\'s motion', () => {
    const cube = { uid: 4, type: 'Cube', kind: 'box' as const, x: 0.3, y: 1.2, z: -0.4, sx: 0.2, sy: 0.2, sz: 0.2, behaviors: [bh('physics', { mass: 0.5 })] };
    const rt = make([floor, rig(), cube], [event([block('vr.on_grabbed', {}, 'Rig')], [block('var.add', { variable: 'g', value: '1' })])], [num('g')]);
    const c = rt.world.of('Cube')[0], r = rt.world.of('Rig')[0];
    hand(rt, 'right', { grip: true }, [0, 0], [0.3, 1.2, -0.3]); rt.tick();
    expect(r.state.vr.held.right).toBe(4); expect(rt.globals.g).toBe(1);
    for (let i = 0; i < 10; i++) { hand(rt, 'right', { grip: true }, [0, 0], [0.3 + i * 0.05, 1.3, -0.3]); rt.tick(); }
    expect(c.x).toBeCloseTo(0.75, 1); expect(c.y).toBeCloseTo(1.3, 1);
    hand(rt, 'right', { grip: false }, [0, 0], [0.85, 1.3, -0.3]); rt.tick();
    expect(c.state.physics.heldBy).toBe(0);
    expect(c.vx).toBeGreaterThan(2); // moving right at ~3 m/s when let go
  });

  it('VR actions and performance profiles', () => {
    for (const a of ['Grab', 'Release', 'Teleport', 'Move', 'Turn', 'Interact', 'Primary', 'Secondary']) expect(VR_ACTIONS[a]?.length).toBeGreaterThan(0);
    const rt = make([floor]);
    rt.doc.inputActions = { ...VR_ACTIONS };
    hand(rt, 'right', { a: true }); expect(rt.actionBindings('Primary').some((b) => rt.input.binding(b, 'pressed'))).toBe(true);
    hand(rt, 'left', {}, [0, -0.8]); expect(rt.actionValue('Move')).toBeCloseTo(0.8);
    expect(rt.input.device).toBe('vr');
    const q = vrEffective({ ...DEFAULT_VR, profile: 'quest' }), pc = vrEffective({ ...DEFAULT_VR, profile: 'pcvr', resolutionScale: 1.2 });
    expect(q.resolutionScale).toBeLessThan(1); expect(q.foveation).toBe(1); expect(q.quality).toBe('low');
    expect(pc.resolutionScale).toBe(1.2); expect(pc.quality).toBe('high');
  });
});
