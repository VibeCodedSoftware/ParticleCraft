// 3D room pieces: decoration never lands on the cell of the entrance, the exit stairs, treasure or an enemy spot
// (seen in the app: an enemy standing inside a crate).
import { describe, expect, it } from 'vitest';
import { DEFAULT_ROOMS, generateRooms, pieces3D } from '../src/rooms';

describe('3D room pieces', () => {
  it('special cells are never decorated', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const layout = generateRooms({ ...DEFAULT_ROOMS, seed, width: 24, height: 18, rooms: 6, treasure: 0.6, enemies: 0.6, difficulty: 3 });
      const pieces = pieces3D(layout, seed, 1, { ceiling: true });
      const special = new Set(pieces.filter((p) => ['entrance', 'stairs', 'treasure', 'enemy'].includes(p.role)).map((p) => `${p.c},${p.r}`));
      const clash = pieces.filter((p) => p.role === 'decor' && special.has(`${p.c},${p.r}`));
      expect(clash, `seed ${seed}`).toEqual([]);
      // Ceilings: one over every floor cell.
      expect(pieces.filter((p) => p.role === 'ceiling').length).toBe(pieces.filter((p) => p.role === 'floor').length);
    }
  });
});
