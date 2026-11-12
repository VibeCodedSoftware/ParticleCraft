// Standing on physics objects must never make them "dance": for every shape and a range of masses, a character
// dropped onto the object stands still on it (or, for unstable shapes, is shed) while the object stays calm.
import { describe, expect, it } from 'vitest';
import { doc, scene } from './helpers';
import { Runtime } from '../src/runtime/runtime';
import { behaviorDefaults } from '../src/runtime/behaviors';

const bh = (type: string, props: Record<string, any> = {}) => ({ type, props: { ...behaviorDefaults(type), ...props } });
const floor = { uid: 1, type: 'Floor', kind: 'box' as const, x: 0, y: -0.5, z: 0, sx: 40, sy: 1, sz: 40, behaviors: [bh('solid')] };

describe('standing on physics objects stays calm', () => {
  for (const shape of ['box', 'cylinder', 'sphere', 'cone', 'capsule']) {
    for (const mass of [0.1, 0.3, 1, 5]) {
      for (const size of [0.3, 1]) {
        it(`${shape}, ${mass} kg, ${size} m`, () => {
          const rt = new Runtime(scene([floor,
            { uid: 2, type: 'Body', kind: shape as any, x: 0, y: size / 2, z: 0, sx: size, sy: size, sz: size, collider: { shape: shape as any, size: [1, 1, 1], offset: [0, 0, 0] }, behaviors: [bh('physics', { mass })] },
            { uid: 9, type: 'Player', kind: 'box', x: 0.05, y: size + 2, z: 0.02, sx: 0.6, sy: 1.8, sz: 0.6, behaviors: [bh('platform', { defaultControls: false })] }], '3d'), doc([], [], 'xz'), { app: 'gamecraft' });
          const b = rt.world.of('Body')[0], p = rt.world.of('Player')[0];
          let maxSpeed = 0, maxSpin = 0, maxP = 0, at2s = [0, 0];
          for (let i = 0; i < 360; i++) {
            rt.tick();
            if (i === 120) at2s = [b.x, b.z];
            if (i > 120) { // after landing and any shedding
              maxSpeed = Math.max(maxSpeed, Math.hypot(b.vx, b.vz)); // horizontal: vertical holds the pending weight push
              maxSpin = Math.max(maxSpin, Math.hypot(...((b.state.rigid?.w ?? [0, 0, 0]) as number[])));
              maxP = Math.max(maxP, Math.hypot(p.vx, p.vz));
            }
          }
          // Calm: nothing is flung around or shaking long after the landing.
          // (A light ball or cone underfoot, like a beach ball, is kicked a few metres; nothing flies off.)
          expect(Math.hypot(b.x, b.z)).toBeLessThan(mass < 0.5 ? 12 : 6);
          expect(maxSpeed).toBeLessThan(3);
          expect(maxSpin * (size / 2)).toBeLessThan(3); // spin as surface speed (a small ball spins faster)
          expect(maxP).toBeLessThan(3);
          expect(Number.isFinite(b.y) && b.y > -0.5).toBe(true);
          // Flat-topped shapes big enough to stand on hold the character still on top.
          if ((shape === 'box' || shape === 'cylinder') && size === 1 && mass >= 1) {
            expect(p.state.platform.standingOn).toBe(2);
            expect(Math.hypot(b.x, b.z)).toBeLessThan(0.2);
            expect(Math.hypot(b.x - at2s[0], b.z - at2s[1])).toBeLessThan(0.05); // no creeping
          }
        });
      }
    }
  }
});
