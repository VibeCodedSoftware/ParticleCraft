// Vehicles: get in with a key, drive (the Car behavior), get out at the door; cameras switch and blend.
// Interaction points: prompt when close, event on the key.
import { describe, expect, it } from 'vitest';
import { block, doc, event, num, scene } from './helpers';
import { Runtime } from '../src/runtime/runtime';
import { behaviorDefaults } from '../src/runtime/behaviors';

const bh = (type: string, props: Record<string, any> = {}) => ({ type, props: { ...behaviorDefaults(type), ...props } });
const ticks = (rt: Runtime, n: number) => { for (let i = 0; i < n; i++) rt.tick(); };
const press = (rt: Runtime, k: string) => { rt.input.keyDown(k); rt.tick(); rt.input.keyUp(k); rt.tick(); };
const floor = { uid: 100, type: 'Floor', kind: 'box' as const, x: 0, y: -0.5, z: 0, sx: 200, sy: 1, sz: 200, behaviors: [bh('solid')] };
function world(camera: 'first person' | 'third person') {
  return scene([floor,
    { uid: 1, type: 'Truck', kind: 'box', x: 0, y: 0.6, z: 0, sx: 4, sy: 1.2, sz: 2, behaviors: [bh('car'), bh('vehicle', { camera, transition: 0.5 })] },
    { uid: 2, type: 'Player', kind: 'box', x: 0.3, y: 0, z: -2.6, sx: 0.6, sy: 1.7, sz: 0.6, collider: { shape: 'box', size: [1, 1, 1], offset: [0, 0.5, 0] }, behaviors: [bh('platform')] },
    { uid: 3, type: 'Camera', kind: 'camera', x: 0, y: 3, z: -8, behaviors: [bh('follow', { target: 'Player', orbitWithMouse: true, distance: 6, smoothing: 0 })] }], '3d');
}

describe('Vehicle', () => {
  it('third person: E gets in, W drives, the chase camera blends in, E gets out at the door', () => {
    const d = doc([
      event([block('vehicle.on_enter', {}, 'Truck')], [block('var.add', { variable: 'in', value: '1' })]),
      event([block('vehicle.on_exit', {}, 'Truck')], [block('var.add', { variable: 'out', value: '1' })]),
    ], [num('in'), num('out')], 'xz');
    const rt = new Runtime(world('third person'), d, { app: 'gamecraft' });
    ticks(rt, 30);
    const truck = rt.world.of('Truck')[0], pl = rt.world.of('Player')[0], cam = rt.world.of('Camera')[0];
    rt.input.keyDown('W'); ticks(rt, 30); rt.input.keyUp('W');
    expect(Math.abs(truck.x)).toBeLessThan(0.01); // nobody at the wheel: W does not drive it
    press(rt, 'E');
    expect(rt.globals.in).toBe(1);
    expect(pl.state.inVehicle).toBe(truck.uid);
    expect(pl.visible).toBe(false);
    expect(cam.behaviors.find((b) => b.type === 'follow')!.props.target).toBe(truck.name || truck.type);
    expect(cam.state.follow.blend).toBeTruthy(); // smooth move to the chase view
    rt.input.keyDown('W'); ticks(rt, 90); rt.input.keyUp('W');
    expect(truck.x).toBeGreaterThan(5);
    expect(Math.hypot(pl.x - truck.x, pl.z - truck.z)).toBeLessThan(1); // the driver rides along
    // Too fast to get out; brake, then get out.
    press(rt, 'E');
    expect(pl.state.inVehicle).toBe(truck.uid);
    ticks(rt, 240);
    press(rt, 'E');
    expect(rt.globals.out).toBe(1);
    expect(pl.state.inVehicle).toBe(0);
    expect(pl.visible).toBe(true);
    expect(Math.hypot(pl.x - truck.x, pl.z - truck.z)).toBeGreaterThan(1.5); // at the door
    expect(cam.behaviors.find((b) => b.type === 'follow')!.props.target).toBe('Player');
    // Walking again; the truck stays put.
    const tx = truck.x;
    rt.input.keyDown('W'); ticks(rt, 40); rt.input.keyUp('W');
    expect(truck.x).toBeCloseTo(tx, 1);
  });

  it('first person: the camera sits in the seat looking forward', () => {
    const rt = new Runtime(world('first person'), doc([], [], 'xz'), { app: 'gamecraft' });
    ticks(rt, 10);
    press(rt, 'E');
    ticks(rt, 60);
    const truck = rt.world.of('Truck')[0], cam = rt.world.of('Camera')[0];
    const f = cam.behaviors.find((b) => b.type === 'follow')!.props;
    expect(f.firstPerson).toBe(true);
    expect(Math.hypot(cam.x - truck.x, cam.z - truck.z)).toBeLessThan(1);
    expect(cam.y).toBeGreaterThan(truck.y + 1);
  });

  it('Get into vehicle block works without the key', () => {
    const rt = new Runtime(world('third person'), doc([event([block('system.on_start_of_layout')], [block('vehicle.enter', { vehicle: 'Truck' }, 'Player')])], [], 'xz'), { app: 'gamecraft' });
    ticks(rt, 3);
    expect(rt.world.of('Player')[0].state.inVehicle).toBe(1);
  });
});

describe('Interaction point', () => {
  it('shows its prompt when close and fires On interacted on the key', () => {
    const s = scene([floor,
      { uid: 1, type: 'Door', kind: 'box', x: 3, y: 1, z: 0, behaviors: [bh('interactable', { prompt: 'Press E to knock' })] },
      { uid: 2, type: 'Player', kind: 'box', x: 0, y: 0.5, z: 0 }], '3d');
    const rt = new Runtime(s, doc([event([block('interact.on_interact', {}, 'Door')], [block('var.add', { variable: 'k', value: '1' })])], [num('k')], 'xz'), { app: 'gamecraft' });
    ticks(rt, 2);
    press(rt, 'E');
    expect(rt.globals.k).toBe(0); // too far
    rt.world.of('Player')[0].x = 2; ticks(rt, 2);
    expect(rt.world.of('Door')[0].state.bubble?.text).toBe('Press E to knock');
    press(rt, 'E');
    expect(rt.globals.k).toBe(1);
  });
});
