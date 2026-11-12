// LogicCraft is 2D: blocks and behaviors that only do something in 3D (model clips and parts, tilting on X/Y, voxel
// terrain, emission, VR, planets, wall walking, procedural animation, 3D rooms, 3D camera settings) are GameCraft-only,
// so LogicCraft's palette and behavior list don't offer them. Older LogicCraft logic that used one keeps it (greyed,
// skipped when running).
import { describe, expect, it } from 'vitest';
import { BLOCK_DEFS, BLOCK_LIST } from '../src/blocks/definitions';
import { BEHAVIORS } from '../src/runtime/behaviors';

const GC_ONLY = ['voxel.on_dug', 'voxel.on_built', 'voxel.dig_view', 'voxel.build_view', 'voxel.dig_at', 'object.set_rotation', 'anim.set_role', 'model.rotate_part', 'anim.set_speed', 'light.set_emission',
  'proc.ragdoll', 'proc.look_at', 'vr.is_active', 'world.generate_rooms_3d', 'camera.set_view', 'postfx.set_ps1', 'postfx.set_dof'];

describe('GameCraft-only (3D) blocks and behaviors', () => {
  it('3D-only blocks are not in LogicCraft', () => {
    for (const id of GC_ONLY) expect(BLOCK_DEFS[id]?.apps, id).toEqual(['gamecraft']);
  });
  it('blocks that work in 2D stay in both apps', () => {
    for (const id of ['object.set_angle', 'anim.play', 'anim.stop', 'water.is_in_water', 'light.set_power', 'light.set_ambient', 'world.generate_rooms', 'sky.set_time', 'physics.grab_nearest'])
      expect(BLOCK_DEFS[id]?.apps, id).toEqual(['gamecraft', 'logiccraft']);
    expect(BLOCK_LIST.filter((d) => d.apps.includes('logiccraft')).length).toBeGreaterThan(250);
  });
  it('3D-only behaviors are marked; the rest are offered in both', () => {
    const only = Object.values(BEHAVIORS).filter((b) => b.gamecraftOnly).map((b) => b.id).sort();
    expect(only).toEqual(['gridboard', 'gridpiece', 'planet', 'procanim', 'rope', 'surfacewalker', 'vrplayer']);
  });
});
