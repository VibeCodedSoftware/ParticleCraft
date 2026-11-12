// Bullet holes (Fire hitscan): left on walls and props, never on the targets; older blocks without the setting get
// them too; "none" turns them off; at most 64; they move with the object they are on. Stylised water's texture slot.
import { describe, expect, it } from 'vitest';
import { doc, scene } from './helpers';
import { Runtime } from '../src/runtime/runtime';
import { behaviorDefaults } from '../src/runtime/behaviors';
import { ACTIONS, BULLET_HOLE, addDecal } from '../src/runtime/blockImpl';
import { WATER_STYLISED, isStylisedWater, stylisedWaterSlot } from '../src/runtime/water';
import { makeInstance } from '../src/runtime/scene';

const make = () => new Runtime(scene([
  { uid: 1, type: 'Shooter', kind: 'box', x: 0, y: 1, z: 0, ry: 0 },
  { uid: 2, type: 'Wall', kind: 'box', x: 10, y: 1, z: 0, sx: 1, sy: 4, sz: 6, behaviors: [{ type: 'solid', props: behaviorDefaults('solid') }] },
  { uid: 3, type: 'Enemy', kind: 'box', x: 5, y: 1, z: 3 },
], '3d'), doc([], [], 'xz'), { app: 'gamecraft' });
const fire = (rt: Runtime, params: Record<string, string>) => ACTIONS['combat.hitscan'](rt, { id: 'b', type: 'combat.hitscan', params: { victims: 'Enemy', range: '60', damage: '10', spread: '0', impact: '', ...params } } as any, {} as any, rt.world.byUid.get(1)!);

describe('bullet holes', () => {
  it('a shot leaves one on the wall, facing out of it; old blocks (no setting) do too', () => {
    const rt = make();
    fire(rt, {});
    expect(rt.decals).toHaveLength(1);
    const d = rt.decals[0];
    expect(d.image).toBe(BULLET_HOLE);
    expect(d.uid).toBe(2);
    expect(d.normal).toEqual([-1, 0, 0]); // the face toward the shooter
    expect(d.offset[0]).toBeCloseTo(-0.5, 5); // on that face (wall centre x 10, half width 0.5)
  });
  it('"none" leaves none, and a hit target gets none', () => {
    const rt = make();
    fire(rt, { decal: 'none' });
    expect(rt.decals).toHaveLength(0);
    rt.world.byUid.get(3)!.z = 0; // the enemy steps into the line of fire
    fire(rt, { decal: 'bullet hole' });
    expect(rt.decals).toHaveLength(0);
  });
  it('keeps the newest 64 and moves with its object', () => {
    const rt = make();
    for (let k = 0; k < 70; k++) fire(rt, {});
    expect(rt.decals).toHaveLength(64);
    expect(rt.decals[0].id).toBe(7);
    const wall = rt.world.byUid.get(2)!;
    const before = wall.x + rt.decals[0].offset[0];
    wall.x += 2;
    expect(wall.x + rt.decals[0].offset[0]).toBeCloseTo(before + 2, 5);
    addDecal(rt, wall, [11, 1, 0], [1, 0, 0], 'proj:custom.png', 0.2);
    expect(rt.decals[63].image).toBe('proj:custom.png');
  });
});

describe('stylised water', () => {
  it('plays the 40-frame sheet on Base color', () => {
    const i = makeInstance(1, 'Pool', 'box', {});
    i.material = { roughness: 0.1, metalness: 0, emissive: '#000000', emissiveStrength: 0, surface: 'water', maps: { color: stylisedWaterSlot() } } as any;
    expect(isStylisedWater(i)).toBe(true);
    expect(i.material!.maps!.color!.asset).toBe(WATER_STYLISED);
    expect(i.material!.maps!.color!.animated).toMatchObject({ frames: 40, cols: 8, rows: 5 });
  });
});
