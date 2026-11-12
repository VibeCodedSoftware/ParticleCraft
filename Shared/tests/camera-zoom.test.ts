// While playing: the mouse wheel zooms a following camera, zooming all the way in goes to first person, V switches.
import { describe, expect, it } from 'vitest';
import { doc, scene } from './helpers';
import { Runtime } from '../src/runtime/runtime';
import { behaviorDefaults } from '../src/runtime/behaviors';

const bh = (type: string, props: Record<string, any> = {}) => ({ type, props: { ...behaviorDefaults(type), ...props } });
function play(o: Record<string, any> = {}) {
  const rt = new Runtime(scene([
    { uid: 1, type: 'Floor', kind: 'box' as const, x: 0, y: -0.5, z: 0, sx: 40, sy: 1, sz: 40, behaviors: [bh('solid')] },
    { uid: 2, type: 'Player', kind: 'box' as const, x: 0, y: 0.9, z: 0, sx: 0.6, sy: 1.8, sz: 0.6, behaviors: [bh('platform')] },
    { uid: 3, type: 'Camera', kind: 'camera' as const, x: 0, y: 3, z: 8, behaviors: [bh('follow', { target: 'Player', offsetX: 0, offsetY: 3, offsetZ: 6, smoothing: 0, ...o })], camera: { active: true, focalLength: 35, clipStart: 0.1, clipEnd: 500 } } as any,
  ], '3d'), doc([], [], 'xz'), { app: 'gamecraft' });
  const cam = () => rt.world.of('Camera')[0], player = () => rt.world.of('Player')[0];
  const dist = () => Math.hypot(cam().x - player().x, cam().y - player().y - 0.9, cam().z - player().z);
  const ticks = (n: number) => { for (let i = 0; i < n; i++) rt.tick(); };
  const wheel = (d: number) => { rt.input.mouse.wheel = d; rt.tick(); ticks(10); };
  const tap = (k: string) => { rt.input.keyDown(k); rt.tick(); rt.input.keyUp(k); ticks(10); };
  ticks(20);
  return { rt, cam, player, dist, wheel, tap, ticks, fp: () => !!cam().state.follow?.fpOn };
}

describe('Play camera zoom and view switch', () => {
  it('the wheel moves the camera out and in', () => {
    const g = play(); const d0 = g.dist();
    g.wheel(600); const out = g.dist();
    expect(out).toBeGreaterThan(d0 * 1.5);
    g.wheel(-600); expect(g.dist()).toBeLessThan(out * 0.8);
    expect(g.fp()).toBe(false);
  });
  it('zooming all the way in goes to first person; scrolling out comes back', () => {
    const g = play();
    for (let i = 0; i < 12; i++) g.wheel(-600);
    expect(g.fp()).toBe(true);
    expect(g.dist()).toBeLessThan(1); // the eye, at the player's head
    g.wheel(300);
    expect(g.fp()).toBe(false);
    expect(g.dist()).toBeGreaterThan(2);
  });
  it('V switches between first and third person, and can be turned off', () => {
    const g = play();
    g.tap('V'); expect(g.fp()).toBe(true);
    g.tap('V'); expect(g.fp()).toBe(false);
    const off = play({ switchKey: '', zoomWithWheel: false }); const d0 = off.dist();
    off.tap('V'); expect(off.fp()).toBe(false);
    off.wheel(600); expect(off.dist()).toBeCloseTo(d0, 1);
  });
});
