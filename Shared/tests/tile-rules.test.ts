// User-authored tile connection rules: 8-neighbour patterns (any / same terrain / not this terrain / exact tile)
// checked in order before the 16-way terrain table, with stable random picks among several result tiles.
import { describe, expect, it } from 'vitest';
import { autotile, newRule, ruleTile, terrainPaintTile, type Terrain, type TileLayer } from '../src/tilemap';

const layer = (): TileLayer => ({ name: 'L', visible: true, collision: false, cells: {} });
const paintCells = (l: TileLayer, t: Terrain, cells: [number, number][]) => { for (const [c, r] of cells) l.cells[`${c},${r}`] = terrainPaintTile(t, 0); autotile(l, t, cells); };

describe('tile connection rules', () => {
  // Rules only: a grass top (nothing above), dirt below it, and an inner-corner tile seen through a diagonal.
  const terrain = (): Terrain => {
    const top = newRule(10); top.around[0] = 'other';                          // nothing above → grass top
    const corner = newRule(30); corner.around[0] = 'same'; corner.around[2] = 'same'; corner.around[1] = 'other'; // diagonal gap
    const fill = newRule(20); fill.tiles.push(21);                             // anything else: dirt (two looks)
    return { name: 'Ground', tiles: Array(16).fill(-1), rules: [top, corner, fill] };
  };

  it('the first matching rule decides, from the 8 neighbours', () => {
    const t = terrain(), l = layer();
    const cells: [number, number][] = [];
    for (let c = 0; c < 4; c++) for (let r = 0; r < 3; r++) cells.push([c, r]);
    paintCells(l, t, cells);
    for (let c = 0; c < 4; c++) expect(l.cells[`${c},0`]).toBe(10); // top row: nothing above
    expect([20, 21]).toContain(l.cells['1,1']);
    // Carve the cell up-right of (1,1): (1,1) now sees a diagonal gap with same up and right → inner corner.
    delete l.cells['2,0'];
    autotile(l, t, [[2, 0]]);
    expect(l.cells['1,1']).toBe(30);
  });

  it('several result tiles: a random one per cell, the same every time', () => {
    const t: Terrain = { name: 'T', tiles: Array(16).fill(-1), rules: [{ around: Array(8).fill('any'), tiles: [1, 2, 3] }] };
    const at = () => undefined;
    const picks = new Set<number>();
    for (let c = 0; c < 40; c++) { const a = ruleTile(t, at, c, 7)!; expect(ruleTile(t, at, c, 7)).toBe(a); picks.add(a); }
    expect(picks.size).toBe(3);
  });

  it('an exact-tile neighbour, and the 16-way table when no rule matches', () => {
    const t: Terrain = { name: 'Wall', tiles: Array(16).fill(-1), rules: [Object.assign(newRule(50), { around: ['any', 'any', 'any', 'any', 99, 'any', 'any', 'any'] })] };
    t.tiles[15] = 40; t.tiles[0] = 41;
    const l = layer();
    l.cells['0,1'] = 99; // a door tile below (not part of the terrain)
    paintCells(l, t, [[0, 0]]);
    expect(l.cells['0,0']).toBe(50); // the door rule
    paintCells(l, t, [[5, 5]]);
    expect(l.cells['5,5']).toBe(41); // no rule: the table's single tile
  });
});
