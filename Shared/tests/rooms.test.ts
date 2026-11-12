// Procedural rooms: the same seed gives the same layout, every room is reachable, walls surround the walkable cells,
// tiles are classified from their pictures (square and isometric), 3D kit models by name and shape, and the layout is
// built into a tilemap (solid walls) and into 3D pieces.
import { describe, expect, it } from 'vitest';
import { CELL, buildTilemap, classifyModel, classifyTiles, generateRooms, pieces3D, roleGroup, walkDistances } from '../src/rooms';
import { cellAt, emptyTilemap } from '../src/tilemap';
import { block, doc, event, num, scene } from './helpers';
import { Runtime } from '../src/runtime/runtime';
import { behaviorDefaults } from '../src/runtime/behaviors';
import { ACTIONS } from '../src/runtime/blockImpl';

describe('room layout', () => {
  it('is the same for the same seed and different for another', () => {
    const a = generateRooms({ seed: 7 }), b = generateRooms({ seed: 7 }), c = generateRooms({ seed: 8 });
    expect(Buffer.from(a.cells).equals(Buffer.from(b.cells))).toBe(true);
    expect(Buffer.from(a.cells).equals(Buffer.from(c.cells))).toBe(false);
  });
  for (const style of ['rooms', 'cave'] as const) it(`${style}: everything walkable is connected and walled in`, () => {
    for (const seed of [1, 2, 3, 42, 999]) {
      const L = generateRooms({ seed, style, width: 40, height: 30, rooms: 8 });
      const d = walkDistances(L.cells, L.w, L.h, L.start);
      let walkable = 0;
      for (let k = 0; k < L.cells.length; k++) {
        const v = L.cells[k];
        if (v === CELL.floor || v === CELL.door) { walkable++; expect(d[k]).toBeGreaterThanOrEqual(0); }
        const c = k % L.w, r = Math.floor(k / L.w);
        if (v === CELL.floor || v === CELL.door) expect(c > 0 && r > 0 && c < L.w - 1 && r < L.h - 1).toBe(true); // never on the edge: always walled
      }
      expect(walkable).toBeGreaterThan(40);
      if (style === 'rooms') expect(L.rooms.length).toBeGreaterThanOrEqual(4);
      expect(d[L.end[1] * L.w + L.end[0]]).toBeGreaterThan(0); // the end is somewhere else, reachable
      for (const [c, r] of L.props) expect(L.cells[r * L.w + c]).toBe(CELL.floor);
    }
  });
});

describe('tile roles', () => {
  /** A 4-tile 8×8 strip: transparent, light floor, dark wall, half-transparent prop. */
  function strip() {
    const W = 32, H = 8, px = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const t = Math.floor(x / 8), k = (y * W + x) * 4;
      if (t === 1) px.set([200, 190, 170, 255], k);
      if (t === 2) px.set([60, 60, 70, 255], k);
      if (t === 3 && x % 8 < 4) px.set([150, 90, 40, 255], k);
    }
    return { px, W };
  }
  it('square tiles: none, floor, wall, decor', () => {
    const { px, W } = strip();
    const m = { ...emptyTilemap('t'), tileW: 8, tileH: 8 };
    expect(classifyTiles(px, W, m, 4, 1)).toEqual({ 0: 'none', 1: 'floor', 2: 'wall', 3: 'decor' });
  });
  it('isometric: a flat diamond is floor, a raised block is wall', () => {
    const W = 32, H = 16, px = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const k = (y * W + x) * 4;
      if (x < 16) { const u = Math.abs(x - 7.5) / 8, v = Math.abs(y - 11.5) / 4; if (u + v <= 1) px.set([90, 180, 90, 255], k); } // diamond on the ground
      else if (Math.abs(x - 23.5) / 8 + Math.max(0, Math.abs(y - 8) - 4) / 4 <= 1) px.set([120, 120, 120, 255], k); // block
    }
    const m = { ...emptyTilemap('t'), tileW: 16, tileH: 16, shape: 'isometric' as const };
    const r = classifyTiles(px, W, m, 2, 1);
    expect(r[0]).toBe('floor'); expect(r[1]).toBe('wall');
  });
  it('3D kit models by name, then by shape', () => {
    expect(classifyModel('Dungeon_Floor_2x2')).toBe('floor');
    // Finer kinds where the name says so, still in the wall / door groups the builder needs.
    expect(classifyModel('wall_corner')).toBe('outer-corner'); expect(roleGroup(classifyModel('wall_corner'))).toBe('wall');
    expect(classifyModel('Doorway')).toBe('door-frame'); expect(roleGroup(classifyModel('Doorway'))).toBe('door');
    expect(classifyModel('mesh_01', [2, 0.1, 2])).toBe('floor');
    expect(classifyModel('mesh_02', [2, 3, 0.3])).toBe('wall');
    expect(classifyModel('Barrel', [0.6, 0.9, 0.6])).toBe('decor');
  });
});

describe('blocks', () => {
  it('2D: Generate rooms paints the tilemap (solid walls), Move to room puts the player on a floor', () => {
    const tm = { ...emptyTilemap('t'), roles: { 0: 'floor', 1: 'wall' } as any };
    const d = doc([
      event([block('system.on_start_of_layout')], [block('world.generate_rooms', { seed: '11', rooms: '6', width: '30', height: '24', style: 'rooms', decor: '0' }, 'Level')]),
      event([block('world.on_rooms_generated', {}, 'Level')], [block('var.add', { variable: 'made', value: '1' }), block('world.move_to_room', { object: 'Hero', which: 'start' }, 'Level')]),
    ], [num('made')]);
    const s = scene([{ uid: 1, type: 'Level', kind: 'tilemap', x: 0, y: 0, tilemap: tm, collider: { shape: 'box', size: [1, 1, 1], offset: [0, 0, 0] } }, { uid: 2, type: 'Hero', kind: 'box', x: -50, y: -50, sx: 0.5, sy: 0.5 }]);
    const rt = new Runtime(s, d, { app: 'logiccraft' });
    rt.tick();
    expect(rt.globals.made).toBe(1);
    const lvl = rt.world.of('Level')[0], hero = rt.world.of('Hero')[0];
    expect(lvl.collider.boxes!.length).toBeGreaterThan(5); // the walls collide
    const [c, r] = cellAt(lvl, hero.x, hero.y);
    const st = lvl.state.rooms;
    expect([c, r]).toEqual(st.layout.start);
    expect(lvl.tilemap!.layers.find((l) => l.name === 'Floor')!.cells[`${c},${r}`]).toBe(0);
  });
  it('3D: Build 3D rooms places the pieces; building again replaces them', () => {
    const bh = (t: string) => ({ type: t, props: behaviorDefaults(t) });
    const d = doc([
      event([block('system.on_start_of_layout')], [block('world.generate_rooms_3d', { floor: 'Floor', wall: 'Wall', door: '', decorType: '', seed: '4', rooms: '5', width: '20', height: '16', cell: '2', style: 'rooms', decor: '0' }, 'Dungeon'), block('world.move_to_room', { object: 'Hero', which: 'end' }, 'Dungeon')]),
    ]);
    const s = scene([
      { uid: 1, type: 'Dungeon', kind: 'empty', x: 10, y: 0, z: 5 },
      { uid: 2, type: 'Floor', kind: 'box', x: 0, y: -100, z: 0, sx: 2, sy: 0.2, sz: 2, behaviors: [bh('solid')] },
      { uid: 3, type: 'Wall', kind: 'box', x: 0, y: -100, z: 0, sx: 2, sy: 3, sz: 0.4, behaviors: [bh('solid')] },
      { uid: 4, type: 'Hero', kind: 'box', x: 0, y: 50, z: 0 },
    ], '3d');
    const rt = new Runtime(s, d, { app: 'gamecraft' });
    rt.tick();
    const st = rt.world.of('Dungeon')[0].state.rooms;
    const ps = pieces3D(st.layout, 4, 0);
    expect(st.spawned.length).toBe(ps.filter((p) => p.role === 'floor' || p.role === 'wall').length); // no door object: no frames
    const floors = () => rt.world.of('Floor').filter((f) => !f.destroyed).length;
    const n1 = floors();
    expect(n1).toBe(ps.filter((p) => p.role === 'floor').length + 1); // + the template
    const hero = rt.world.of('Hero')[0];
    expect(hero.x).toBeCloseTo(10 + st.layout.end[0] * 2, 5); expect(hero.z).toBeCloseTo(5 + st.layout.end[1] * 2, 5);
    // Build again: same seed, same count (the old pieces are gone).
    ACTIONS['world.generate_rooms_3d'](rt, block('world.generate_rooms_3d', { floor: 'Floor', wall: 'Wall', seed: '4', rooms: '5', width: '20', height: '16', cell: '2', style: 'rooms', decor: '0' }) as any, rt.baseCtx(), rt.world.of('Dungeon')[0]);
    rt.tick();
    expect(floors()).toBe(n1);
  });
});

describe('building', () => {
  it('into a tilemap: floors, solid walls, decoration', () => {
    const L = generateRooms({ seed: 5 });
    const m = emptyTilemap('t');
    const k = buildTilemap(m, L, { 0: 'floor', 1: 'floor', 2: 'wall', 3: 'decor' }, 5, 1);
    expect(m.layers.map((l) => l.name).slice(-3)).toEqual(['Floor', 'Walls', 'Decor']); // decoration drawn on top
    expect([k.floor, k.walls, k.decor]).toEqual([m.layers.length - 3, m.layers.length - 2, m.layers.length - 1]);
    expect(m.layers[k.walls].collision).toBe(true);
    expect(m.layers[k.floor].collision).toBe(false);
    const walls = Object.values(m.layers[k.walls].cells), floors = Object.values(m.layers[k.floor].cells);
    expect(walls.length).toBe(L.cells.filter((v) => v === CELL.wall).length);
    expect(floors.length).toBe(L.cells.filter((v) => v === CELL.floor || v === CELL.door).length);
    expect(walls.every((t) => t === 2)).toBe(true);
    expect(new Set(floors)).toEqual(new Set([0, 1])); // both floor tiles used
    expect(Object.keys(m.layers[k.decor].cells).length).toBe(L.props.length);
  });
  it('into 3D pieces: walls face the room', () => {
    const L = generateRooms({ seed: 9 });
    const ps = pieces3D(L, 9, 0);
    for (const p of ps.filter((x) => x.role === 'wall')) {
      const dir = [[1, 0], [0, -1], [-1, 0], [0, 1]][p.ry / 90];
      const v = L.cells[(p.r + dir[1]) * L.w + p.c + dir[0]];
      if (v !== CELL.empty && v !== CELL.wall) expect([CELL.floor, CELL.door]).toContain(v);
    }
    expect(ps.filter((x) => x.role === 'floor').length).toBe(L.cells.filter((v) => v === CELL.floor || v === CELL.door).length);
  });
});
