// A child's position is relative to its parent. A tween on one must start from there, not from its place in the world:
// otherwise a gun held by a camera far from the origin flies away for the length of its recoil.
import { describe, expect, it } from 'vitest';
import { block, doc, event } from './helpers';
import { Runtime } from '../src/runtime/runtime';
import { emptyScene, makeInstance } from '../src/runtime/scene';
import { ACTIONS } from '../src/runtime/blockImpl';

function setup() {
  const scene = emptyScene('Test', '3d');
  scene.instances = [
    makeInstance(1, 'Holder', 'box', { x: 5, y: 2, z: 18 }),
    makeInstance(2, 'Gun', 'box', { parent: 1, x: 0.3, y: -0.2, z: -0.6 }),
    makeInstance(3, 'Crate', 'box', { x: 1, z: 2 }),
  ];
  const rt = new Runtime(scene, doc([], [], 'xz'), { app: 'gamecraft' });
  rt.tick();
  return { rt, gun: rt.world.byUid.get(2)!, holder: rt.world.byUid.get(1)!, crate: rt.world.byUid.get(3)! };
}
const run = (rt: Runtime, id: string, params: Record<string, unknown>, target: any) => (ACTIONS as any)[id](rt, { id: 't', block: id, params }, { sol: new Map(), scopes: [], loops: [] }, target);

describe('tweening a parented object', () => {
  it('stays near its holder all the way through', () => {
    const { rt, gun } = setup();
    run(rt, 'anim.tween', { property: 'Z', value: '-0.5', duration: '0.2', ease: 'linear' }, gun);
    for (let k = 0; k < 20; k++) { rt.tick(); expect(gun.z).toBeGreaterThanOrEqual(-0.6001); expect(gun.z).toBeLessThanOrEqual(-0.4999); }
    expect(gun.z).toBeCloseTo(-0.5);
  });
  it('gliding starts from where it is on its holder too', () => {
    const { rt, gun } = setup();
    run(rt, 'object.glide_to', { x: '0.3', y: '-0.2', z: '-1', seconds: '0.2' }, gun);
    rt.tick();
    expect(Math.abs(gun.z)).toBeLessThan(1.01);
    expect(Math.abs(gun.x)).toBeLessThan(0.31);
  });
  it('an unparented object works as before', () => {
    const { rt, crate } = setup();
    run(rt, 'anim.tween', { property: 'X', value: '3', duration: '0.1', ease: 'linear' }, crate);
    for (let k = 0; k < 12; k++) rt.tick();
    expect(crate.x).toBeCloseTo(3);
  });
  it('reading a child position still gives its place in the world', () => {
    const { rt, gun } = setup();
    expect(rt.prop(gun, 'Z')).toBeCloseTo(17.4);
    expect(rt.settable(gun, 'Z')).toBeCloseTo(-0.6);
  });
});
