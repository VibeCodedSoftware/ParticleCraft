// Boolean: box subtraction for collision, a wall with a door cutter (walk through the doorway while playing, cutter
// hidden and pass-through), holes cut while playing (Cut hole block, hitscan "cut hole"), kept in saves.
import { describe, expect, it } from 'vitest';
import { block, doc, event } from './helpers';
import { Runtime } from '../src/runtime/runtime';
import { emptyScene, makeInstance } from '../src/runtime/scene';
import { subtractBoxes } from '../src/runtime/boolean';

const vol = (bs: number[][]) => bs.reduce((a, b) => a + (b[3] - b[0]) * (b[4] - b[1]) * (b[5] - b[2]), 0);

function wallScene() {
  const s = emptyScene('t', '3d');
  s.instances = [
    makeInstance(1, 'Wall', 'box', { x: 0, y: 1.5, z: 0, sx: 6, sy: 3, sz: 0.3, behaviors: [{ type: 'solid', props: {} }], boolean: { ops: [{ with: 2, op: 'difference' }] } }),
    makeInstance(2, 'Cutter', 'box', { x: 0, y: 1, z: 0, sx: 1.2, sy: 2, sz: 1 }),
  ];
  return s;
}
const blocked = (rt: Runtime, x: number, y: number, z: number) => rt.world.aabbs(rt.world.byUid.get(1)!).some((b) => x > b[0] && x < b[3] && y > b[1] && y < b[4] && z > b[2] && z < b[5]);

describe('boolean', () => {
  it('box minus boxes keeps exactly the rest', () => {
    const parts = subtractBoxes([0, 0, 0, 4, 3, 1], [[1.5, -1, -1, 2.5, 2, 2]]);
    expect(vol(parts)).toBeCloseTo(4 * 3 - 1 * 2);
    expect(subtractBoxes([0, 0, 0, 1, 1, 1], [[5, 5, 5, 6, 6, 6]])).toEqual([[0, 0, 0, 1, 1, 1]]);
  });

  it('a door cutter: the wall blocks except in the doorway; the cutter is hidden and pass-through', () => {
    const rt = new Runtime(wallScene(), doc([]), { app: 'gamecraft' });
    const cutter = rt.world.byUid.get(2)!;
    expect(cutter.visible).toBe(false);
    expect(cutter.collider.shape).toBe('none');
    expect(blocked(rt, 0, 1, 0)).toBe(false);   // in the doorway
    expect(blocked(rt, 0, 2.6, 0)).toBe(true);  // above the door (lintel)
    expect(blocked(rt, 2, 1, 0)).toBe(true);    // beside it
  });

  it('Cut hole while playing opens the wall there (and is kept in a save)', () => {
    const s = wallScene();
    s.instances[0].boolean = undefined;
    const store = new Map<string, string>();
    const d = doc([event([block('system.on_start_of_layout')], [block('object.cut_hole', { shape: 'box', size: '1', x: '2', y: '1.5', z: '0' }, 'Wall')])]);
    const rt = new Runtime(s, d, { app: 'gamecraft', host: { storage: { get: (k) => store.get(k) ?? null, set: (k, v) => void store.set(k, v) } } });
    expect(blocked(rt, 2, 1.5, 0)).toBe(true);
    rt.tick();
    expect(blocked(rt, 2, 1.5, 0)).toBe(false);
    expect(blocked(rt, -2, 1.5, 0)).toBe(true);
    expect(rt.world.byUid.get(1)!.state.cuts).toHaveLength(1);
    rt.saveGame('s');
    const again = new Runtime(s, d, { app: 'gamecraft', host: { storage: { get: (k) => store.get(k) ?? null, set: (k, v) => void store.set(k, v) } } });
    again.loadGame('s');
    expect(again.world.byUid.get(1)!.state.cuts).toHaveLength(1);
    expect(blocked(again, 2, 1.5, 0)).toBe(false);
  });

  it('hitscan with Bullet holes = cut hole cuts where the shot lands', () => {
    const s = emptyScene('t', '3d');
    s.instances = [
      makeInstance(1, 'Wall', 'box', { x: 0, y: 1.5, z: -5, sx: 6, sy: 3, sz: 0.2, behaviors: [{ type: 'solid', props: {} }] }),
      makeInstance(2, 'Gun', 'box', { x: 0, y: 1.5, z: 0, ry: 90 }),
    ];
    const d = doc([event([block('system.on_start_of_layout')], [block('combat.hitscan', { victims: 'Enemy', range: '50', damage: '10', spread: '0', impact: '', decal: 'cut hole' }, 'Gun')])]);
    const rt = new Runtime(s, d, { app: 'gamecraft' });
    rt.tick();
    const cuts = rt.world.byUid.get(1)!.state.cuts;
    expect(cuts?.length).toBe(1);
    expect(rt.decals.length).toBe(0); // a real hole instead of a picture
  });
});
