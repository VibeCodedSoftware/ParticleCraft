// Tilemaps: painting tools, auto-tiling, collision (merged boxes, per-tile shapes) and characters standing on them.
import { describe, expect, it } from 'vitest';
import { doc, scene } from './helpers';
import { Runtime } from '../src/runtime/runtime';
import { behaviorDefaults } from '../src/runtime/behaviors';
import { autotile, brushCells, cellAtLocal, cellBox, emptyTilemap, fill, paint, polyBoxes, rectCells, syncTilemapCollider, terrainFromBlock3x3, tilemapBoxes, type TilemapData } from '../src/tilemap';
import { fromTiled, toTiled } from '../src/tiled';

describe('tilemap tools', () => {
  it('brush, erase, rectangle and flood fill', () => {
    const m = emptyTilemap('tiles'); const L = m.layers[0];
    paint(L, brushCells(5, 5, 3), 2);
    expect(Object.keys(L.cells)).toHaveLength(9);
    paint(L, [[5, 5]], -1);
    expect(L.cells['5,5']).toBeUndefined();
    paint(L, rectCells(0, 0, 9, 0), 1);
    expect(Object.values(L.cells).filter((t) => t === 1)).toHaveLength(10);
    // Fill the hole left by the eraser with tile 3 (only that empty region inside the 3x3 ring).
    const changed = fill(L, 5, 5, 3, { c0: 4, r0: 4, c1: 6, r1: 6 });
    expect(changed).toEqual([[5, 5]]);
  });

  it('auto-tiling picks corners, edges and centre from a 3x3 block', () => {
    const cols = 10, t = terrainFromBlock3x3('Grass', 0, cols); const m = emptyTilemap('tiles'); const L = m.layers[0];
    const area = rectCells(0, 0, 2, 2);
    paint(L, area, t.tiles[15]);
    autotile(L, t, area);
    expect(L.cells['0,0']).toBe(0); // top-left corner
    expect(L.cells['1,0']).toBe(1); // top edge
    expect(L.cells['1,1']).toBe(cols + 1); // centre
    expect(L.cells['2,2']).toBe(2 * cols + 2); // bottom-right corner
  });

  it('collision: full tiles merge into row boxes, custom shapes, non-colliding layers', () => {
    const m: TilemapData = { ...emptyTilemap('tiles'), cell: 0.5, shapes: { 7: [[0, 0.5, 1, 0.5]] } };
    paint(m.layers[0], rectCells(0, 3, 7, 3), 1); // a floor of 8 tiles
    paint(m.layers[0], [[2, 1]], 7); // a half-height ledge
    paint(m.layers[1], rectCells(0, 0, 7, 0), 4); // decoration: no collision
    const boxes = tilemapBoxes(m);
    expect(boxes).toHaveLength(2);
    const floor = boxes.find((b) => b[3] === 4)!; // 8 tiles x 0.5
    expect(floor[1]).toBeCloseTo(-(3.5 * 0.5));
    const ledge = boxes.find((b) => b[4] === 0.25)!;
    expect(ledge[1]).toBeCloseTo(-(1 + 0.75) * 0.5);
  });
});

describe('tilemap in the game', () => {
  it('a platform character lands and walks on painted tiles', () => {
    const s = scene([
      { uid: 1, type: 'Level', kind: 'tilemap' as any, x: -5, y: 0, collider: { shape: 'box', size: [1, 1, 1], offset: [0, 0, 0] } },
      { uid: 2, type: 'Player', kind: 'box', x: 0, y: 3, sx: 0.8, sy: 0.8, behaviors: [{ type: 'platform', props: behaviorDefaults('platform') }] },
    ]);
    const map = emptyTilemap('tiles'); paint(map.layers[0], rectCells(0, 2, 20, 2), 0); // row 2 = y from -2 to -3
    s.instances[0].tilemap = map; syncTilemapCollider(s.instances[0]);
    const rt = new Runtime(s, doc([]), { app: 'logiccraft' });
    for (let i = 0; i < 120; i++) rt.tick();
    const p = rt.world.of('Player')[0];
    expect(p.y).toBeCloseTo(-2 + 0.4, 1); // standing on top of the tiles
    rt.input.keyDown('D'); for (let i = 0; i < 60; i++) rt.tick();
    expect(p.x).toBeGreaterThan(2);
    expect(p.y).toBeCloseTo(-1.6, 1);
  });

  it('in 3D the map lies on the ground: painted tiles are a floor at the object height (map up = -Z)', () => {
    const s = scene([
      { uid: 1, type: 'Level', kind: 'tilemap' as any, x: 0, y: 2, z: 0, collider: { shape: 'box', size: [1, 1, 1], offset: [0, 0, 0] } },
      { uid: 2, type: 'Player', kind: 'box', x: 1.5, y: 5, z: 3.5, sx: 0.6, sy: 1, sz: 0.6, behaviors: [{ type: 'platform', props: { ...behaviorDefaults('platform'), defaultControls: false } }] },
      { uid: 3, type: 'Faller', kind: 'box', x: 8.5, y: 5, z: 3.5, sx: 0.6, sy: 1, sz: 0.6, behaviors: [{ type: 'platform', props: { ...behaviorDefaults('platform'), defaultControls: false } }] },
    ], '3d');
    const map = emptyTilemap('tiles'); paint(map.layers[0], rectCells(0, 2, 4, 4), 0); // x 0..5, rows 2..4 (map y -2..-5) → z 2..5 (map up = -Z)
    s.instances[0].tilemap = map; syncTilemapCollider(s.instances[0]);
    const rt = new Runtime(s, doc([], [], 'xz'), { app: 'gamecraft' });
    for (let i = 0; i < 120; i++) rt.tick();
    expect(rt.world.of('Player')[0].y).toBeCloseTo(2.5, 1); // standing on the tiles' top at y = 2
    expect(rt.world.of('Faller')[0].y).toBeLessThan(0); // no tile under it
  });
});


describe('isometric tilemaps, polygon collision and Tiled maps', () => {
  const iso = (layout: 'diamond' | 'stacked' = 'diamond'): TilemapData => ({ ...emptyTilemap('t'), tileW: 16, tileH: 16, gridW: 16, gridH: 8, cell: 1, shape: 'isometric', layout });
  it('diamond and stacked cells: centres, and points map back to their cell', () => {
    for (const layout of ['diamond', 'stacked'] as const) {
      const m = iso(layout);
      for (let c = -3; c <= 3; c++) for (let r = -3; r <= 3; r++) {
        const b = cellBox(m, c, r);
        expect(cellAtLocal(m, b.x + b.w / 2, b.top - b.h / 2)).toEqual([c, r]);
        expect(cellAtLocal(m, b.x + b.w / 2 + 0.2, b.top - b.h / 2 + 0.05)).toEqual([c, r]); // inside the diamond
      }
    }
    // Diamond: cell (1,0) is half a cell right and down of (0,0); a diamond is half as tall as wide.
    const m = iso(); const a = cellBox(m, 0, 0), b = cellBox(m, 1, 0);
    expect(b.x - a.x).toBeCloseTo(0.5); expect(a.top - b.top).toBeCloseTo(0.25); expect(a.h).toBeCloseTo(0.5);
  });
  it('a diamond tile collides as slabs inside its diamond; polygons and "no collision" per tile', () => {
    const m = iso(); m.layers[0].cells['0,0'] = 0; m.layers[0].cells['1,0'] = 1; m.polys = { 1: [] };
    const boxes = tilemapBoxes(m);
    expect(boxes.length).toBe(3); // tile 0: three slabs, tile 1: none
    for (const [cx, cy, , w, h] of boxes) { expect(Math.abs(cx) + w / 2).toBeLessThanOrEqual(0.5 + 1e-6); expect(cy - h / 2).toBeGreaterThanOrEqual(-0.5 - 1e-6); expect(cy + h / 2).toBeLessThanOrEqual(1e-6); }
    expect(polyBoxes([[0, 0], [2, 0], [2, 1], [0, 1]], 1)).toEqual([[1, 0.5, 0, 2, 1, 1]]); // an upright rectangle stays one box
  });
  it('imports a Tiled isometric map (layers, collision property, tile polygons) and exports it back', () => {
    const tmj = {
      type: 'map', orientation: 'isometric', width: 3, height: 2, tilewidth: 16, tileheight: 8, infinite: false,
      layers: [
        { type: 'tilelayer', name: 'Ground', width: 3, height: 2, data: [1, 2, 0, 0, 3, 0x80000002], properties: [{ name: 'collision', type: 'bool', value: true }] },
        { type: 'group', layers: [{ type: 'tilelayer', name: 'Deco', width: 3, height: 2, data: [0, 0, 4, 0, 0, 0] }] },
        { type: 'objectgroup', name: 'Spawns', objects: [] },
      ],
      tilesets: [{ firstgid: 1, name: 'iso', image: '../art/isometric_tiles.png', imagewidth: 64, imageheight: 16, tilewidth: 16, tileheight: 16, columns: 4, tilecount: 4,
        tiles: [{ id: 1, objectgroup: { objects: [{ x: 0, y: 0, polygon: [{ x: 8, y: 8 }, { x: 16, y: 12 }, { x: 8, y: 16 }, { x: 0, y: 12 }] }] } }] }],
    };
    const r = fromTiled(tmj);
    expect(r.image).toBe('isometric_tiles.png');
    expect(r.map.shape).toBe('isometric'); expect(r.map.gridH).toBe(8); expect(r.map.texOffsetY).toBe(8);
    expect(r.map.layers.map((l) => [l.name, l.collision])).toEqual([['Ground', true], ['Deco', false]]);
    expect(r.map.layers[0].cells).toEqual({ '0,0': 0, '1,0': 1, '1,1': 2, '2,1': 1 }); // flip flags dropped
    expect(r.map.polys?.[1]?.[0]).toEqual([[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]]); // the diamond under a cube's top face
    const back = toTiled(r.map, 'isometric_tiles.png', [64, 16]);
    expect(back.orientation).toBe('isometric'); expect([back.tilewidth, back.tileheight]).toEqual([16, 8]);
    const again = fromTiled(back);
    expect(again.map.layers[0].cells).toEqual(r.map.layers[0].cells);
    expect(again.map.polys?.[1]).toEqual(r.map.polys?.[1]);
    expect(() => fromTiled({ type: 'map', orientation: 'orthogonal', layers: [], tilesets: [{ firstgid: 1, source: 'tiles.tsj' }] })).toThrow(/Embed Tilesets/);
  });
});
