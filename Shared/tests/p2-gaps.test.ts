// P2 gaps filled: Procedural Animation stage blocks, planets blending their pulls, finer tile roles in room building,
// treasure / enemy spawns with difficulty, and the floating state of things in water (with its blocks and events, on
// the existing buoyancy — no Float behavior) plus tipping resistance.
import { describe, expect, it } from 'vitest';
import { block, doc, event, num, scene } from './helpers';
import { Runtime } from '../src/runtime/runtime';
import { behaviorDefaults } from '../src/runtime/behaviors';
import { ACTIONS } from '../src/runtime/blockImpl';
import { planetPull } from '../src/runtime/planets';
import { CELL, buildTilemap, generateRooms, placeSpawns, roleFromName, wallKind, type RoomsLayout } from '../src/rooms';
import { emptyTilemap } from '../src/tilemap';

const bh = (t: string, p: Record<string, any> = {}) => ({ type: t, props: { ...behaviorDefaults(t), ...p } });

describe('procedural animation stage blocks', () => {
  it('each stage writes the behavior settings the renderer reads', () => {
    const rt = new Runtime(scene([{ uid: 1, type: 'Spider', behaviors: [bh('procanim')] }], '3d'), doc([], [], 'xz'), { app: 'gamecraft' });
    const sp = rt.world.of('Spider')[0], run = (id: string, params: Record<string, string>) => ACTIONS[id](rt, block(id, params, 'Spider') as any, {} as any, sp as any);
    run('proc.legs', { stride: '1.2', height: '0.5', speed: '7' });
    run('proc.ground', { state: 'off', adapt: '0.4' });
    run('proc.feet', { resp: '2', bob: '0.3' });
    run('proc.body', { arms: '0', wave: '2', idle: '0.5', speed: '1.5' });
    run('proc.climb', { state: 'on', speed: '3' });
    expect(sp.behaviors[0].props).toMatchObject({ stepLength: 1.2, stepHeight: 0.5, stepSpeed: 7, groundDetect: false, surfaceAdapt: 0.4, responsiveness: 2, bob: 0.3, armSwing: 0, wave: 2, idle: 0.5, animSpeed: 1.5, climbWalls: true, climbSpeed: 3 });
  });
});

describe('planets', () => {
  const planet = (uid: number, x: number, p: Record<string, any> = {}) => ({ uid, type: 'Planet', kind: 'sphere' as const, x, y: 0, z: 0, sx: 4, sy: 4, sz: 4, behaviors: [bh('planet', { range: 10, ...p })] });
  it('blending: between two blending planets the pulls add up (cancel in the middle); without blending only the nearest pulls', () => {
    const mk = (blend: boolean) => new Runtime(scene([planet(1, -6, { blend }), planet(2, 6, { blend }), { uid: 3, type: 'Rock', x: 0.5, y: 0, z: 0 }], '3d'), doc([], [], 'xz'), { app: 'gamecraft' });
    const a = mk(true), b = mk(false);
    const ga = planetPull(a.world, a.world.of('Rock')[0])!.g, gb = planetPull(b.world, b.world.of('Rock')[0])!.g;
    expect(Math.abs(ga[0])).toBeLessThan(1); // nearly balanced
    expect(gb[0]).toBeCloseTo(18); // pulled toward the nearer planet only (the one at x = 6)
  });
  it('falloff: full pull at the surface, none at the edge of the range', () => {
    const rt = new Runtime(scene([planet(1, 0, { falloff: true }), { uid: 2, type: 'Near', x: 2.1, y: 0, z: 0 }, { uid: 3, type: 'Far', x: 9.5, y: 0, z: 0 }], '3d'), doc([], [], 'xz'), { app: 'gamecraft' });
    const near = Math.hypot(...planetPull(rt.world, rt.world.of('Near')[0])!.g), far = Math.hypot(...planetPull(rt.world, rt.world.of('Far')[0])!.g);
    expect(near).toBeGreaterThan(17); expect(far).toBeLessThan(2);
  });
});

describe('tile roles and room spawns', () => {
  it('names give fine roles; wall cells know which piece they need', () => {
    expect(['Wall_Corner_Inner.png', 'wall-corner.png', 'DoorFrame_01', 'stairs_down', 'TopEdge', 'chest_gold', 'Floor_A'].map(roleFromName))
      .toEqual(['inner-corner', 'outer-corner', 'door-frame', 'stairs', 'wall-top', 'treasure', 'floor']);
    // . = empty, # = wall, f = floor
    const rows = ['#####', '#fff#', '#fff#', '#####'], W = 5;
    const at = (c: number, r: number) => (c < 0 || r < 0 || c >= W || r >= rows.length ? CELL.empty : rows[r][c] === 'f' ? CELL.floor : CELL.wall);
    expect(wallKind(at, 2, 0)).toBe('wall-top'); expect(wallKind(at, 2, 3)).toBe('wall-bottom');
    expect(wallKind(at, 0, 1)).toBe('wall-left'); expect(wallKind(at, 4, 1)).toBe('wall-right');
    expect(wallKind(at, 0, 0)).toBe('outer-corner');
  });
  it('building uses a fine role where it has one, falls back to plain walls, and a tile set solid lands on the Walls layer', () => {
    const L = generateRooms({ seed: 5, width: 30, height: 24, rooms: 4 });
    const map = emptyTilemap();
    map.roles = { 0: 'floor', 1: 'wall', 2: 'wall-top', 3: 'entrance', 4: 'exit', 5: 'decor' };
    map.tileInfo = { 5: { collision: 'solid' } };
    const k = buildTilemap(map, L, map.roles, 5, 1);
    const walls = Object.values(map.layers[k.walls].cells);
    expect(walls).toContain(2); expect(walls).toContain(1);
    expect(map.layers[k.decor].cells[`${L.start[0]},${L.start[1]}`]).toBe(3);
    expect(map.layers[k.decor].cells[`${L.end[0]},${L.end[1]}`]).toBe(4);
    expect(walls).toContain(5); // decoration marked solid is placed with the walls
  });
  it('spawns: the start room stays safe, the same seed gives the same spots, harder means more enemies', () => {
    const L: RoomsLayout = generateRooms({ seed: 11, width: 50, height: 40, rooms: 8 });
    const easy = placeSpawns(L, { seed: 3, enemies: 0.6, difficulty: 1, treasure: 0.5 }), hard = placeSpawns(L, { seed: 3, enemies: 0.6, difficulty: 9, treasure: 0.5 });
    expect(placeSpawns(L, { seed: 3, enemies: 0.6, difficulty: 1, treasure: 0.5 })).toEqual(easy);
    expect(hard.spawns.filter((s) => s.kind === 'enemy').length).toBeGreaterThan(easy.spawns.filter((s) => s.kind === 'enemy').length);
    expect([...easy.spawns, ...hard.spawns].every((s) => s.room !== 0)).toBe(true);
    expect(easy.treasureRooms.length).toBeGreaterThan(0);
  });
});

describe('floating state (existing buoyancy)', () => {
  const pool = { uid: 1, type: 'Pool', kind: 'box' as const, x: 0, y: -1, z: 0, sx: 20, sy: 2, sz: 20, collider: { shape: 'box' as const, size: [1, 1, 1] as [number, number, number], offset: [0, 0, 0] as [number, number, number] }, behaviors: [bh('water')] };
  const floor = { uid: 9, type: 'Floor', kind: 'box' as const, x: 0, y: -2.5, z: 0, sx: 30, sy: 1, sz: 30, behaviors: [bh('solid')] };
  it('a light crate floats (partly under, event once); a heavy one sinks (event once); expressions give the share under water and the depth', () => {
    const d = doc([
      event([block('water.on_start_floating', {}, 'Crate')], [block('var.add', { variable: 'floats', value: '1' })]),
      event([block('water.on_start_sinking', {}, 'Anvil')], [block('var.add', { variable: 'sinks', value: '1' })]),
      event([block('system.every_tick')], [block('var.set', { variable: 'under', value: 'Crate.Submerged' }), block('var.set', { variable: 'depth', value: 'Crate.WaterDepth' })]),
    ], [num('floats'), num('sinks'), num('under'), num('depth')], 'xz');
    const rt = new Runtime(scene([floor, pool, { uid: 2, type: 'Crate', x: -3, y: 1, z: 0, behaviors: [bh('physics', { mass: 0.2 })] }, { uid: 3, type: 'Anvil', x: 3, y: 1, z: 0, behaviors: [bh('physics', { mass: 50 })] }], '3d'), d, { app: 'gamecraft' });
    for (let k = 0; k < 300; k++) rt.tick();
    expect(rt.globals.floats).toBe(1);
    expect(rt.globals.sinks).toBe(1);
    expect(rt.globals.under as number).toBeGreaterThan(0.02); expect(rt.globals.under as number).toBeLessThan(0.98);
    expect(rt.globals.depth).toBeCloseTo(2, 1);
    const crate = rt.world.of('Crate')[0];
    expect(ACTIONS && crate.state.float.floating).toBe(true);
  });
  it('tipping resistance rights a tilted raft sooner', () => {
    const tiltAfter = (stability: number) => {
      const p = { ...pool, behaviors: [bh('water', { stability })] };
      const rt = new Runtime(scene([floor, p, { uid: 2, type: 'Raft', x: 0, y: 0.2, z: 0, sx: 3, sy: 0.3, sz: 2, rz: 35, behaviors: [bh('physics', { mass: 1.5 })] }], '3d'), doc([], [], 'xz'), { app: 'gamecraft' });
      for (let k = 0; k < 30; k++) rt.tick();
      return Math.abs(rt.world.of('Raft')[0].rz);
    };
    expect(tiltAfter(3)).toBeLessThan(tiltAfter(0));
  });
});
