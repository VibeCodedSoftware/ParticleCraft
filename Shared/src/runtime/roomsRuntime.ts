// Procedural rooms while the game runs: Generate rooms paints a fresh layout into a tilemap object (2D, pixel-art,
// isometric; its tile roles say which tiles are floors and walls), Build 3D rooms places copies of floor / wall / door /
// decoration object types on a grid around an origin object, and Move to room puts objects in the start, end or a
// random room. The layout is kept on the object (state.rooms) for Move to room.
import { buildTilemap, generateRooms, pieces3D, placeSpawns, type RoomsLayout, type RoomsOptions } from '../rooms';
import { cellBox, syncTilemapCollider } from '../tilemap';
import type { RInstance, World } from './world';

type V3 = [number, number, number];

export interface RoomsState { layout: RoomsLayout; kind: 'tilemap' | '3d'; cell: number; origin: V3; spawned: number[] }

/** The world position of a layout cell's centre on the object that holds it. */
export function roomCellWorld(w: World, holder: RInstance, st: RoomsState, c: number, r: number): V3 {
  if (st.kind === '3d') return [st.origin[0] + c * st.cell, st.origin[1], st.origin[2] + r * st.cell];
  const m = holder.tilemap!, b = cellBox(m, c, r);
  const lx = b.x + b.w / 2, ly = b.top - b.h / 2;
  const [x, y, z] = holder.parent != null ? w.worldPos(holder) : [holder.x, holder.y, holder.z];
  // 2D: the map is the picture plane; 3D: it lies on the ground with map-up toward −Z.
  return w.plane === 'xz' ? [x + lx, y + 0.5, z - ly] : [x + lx, y + ly, z];
}

/** Paint a new layout into a tilemap object (its collision follows). */
export function generateIntoTilemap(w: World, inst: RInstance, o: Partial<RoomsOptions>, decor: number): RoomsState {
  if (!inst.tilemap) throw new Error(`${inst.name} is not a tilemap: Generate rooms paints into a Tilemap object`);
  const layout = generateRooms(o);
  buildTilemap(inst.tilemap, layout, inst.tilemap.roles, o.seed ?? 1, decor);
  syncTilemapCollider(inst);
  const st: RoomsState = { layout, kind: 'tilemap', cell: inst.tilemap.cell, origin: [inst.x, inst.y, inst.z], spawned: [] };
  inst.state.rooms = st;
  return st;
}

/** Build a layout in 3D from object types (floor, wall, optional door / decoration) around `origin`; replaces the last build. */
export function generate3D(w: World, origin: RInstance, o: Partial<RoomsOptions>, types: { floor: string; wall: string; door?: string; decor?: string }, cell: number, decor: number): RoomsState {
  const prev = origin.state.rooms as RoomsState | undefined;
  for (const uid of prev?.spawned ?? []) { const x = w.byUid.get(uid); if (x && !x.destroyed) w.destroy(x); }
  const layout = generateRooms(o);
  const st: RoomsState = { layout, kind: '3d', cell, origin: [origin.x, origin.y, origin.z], spawned: [] };
  for (const p of pieces3D(layout, o.seed ?? 1, decor)) {
    if (p.role !== 'floor' && p.role !== 'wall' && p.role !== 'door' && p.role !== 'decor') continue; // the rest: Populate rooms
    const type = p.role === 'floor' ? types.floor : p.role === 'wall' ? types.wall : p.role === 'door' ? types.door : types.decor;
    if (!type || !w.typeExists(type)) continue;
    const [x, y, z] = [st.origin[0] + p.c * cell, st.origin[1], st.origin[2] + p.r * cell];
    const n = w.spawn(type, x, y, z);
    if (!n) continue;
    n.ry = p.ry;
    st.spawned.push(n.uid);
  }
  origin.state.rooms = st;
  return st;
}

/**
 * Populate rooms: copies of an enemy type and a treasure type at the layout's spots (chosen again for these settings);
 * replaces what the last Populate placed. Returns how many of each.
 */
export function populateRooms(w: World, holder: RInstance, o: { seed: number; treasure: number; enemies: number; difficulty: number }, types: { enemy?: string; treasure?: string }): { enemies: number; treasure: number } {
  const st = holder.state.rooms as RoomsState | undefined;
  if (!st) throw new Error(`${holder.name} has no rooms yet: use Generate rooms (or Build 3D rooms) first`);
  for (const uid of (holder.state.roomSpawns as number[] | undefined) ?? []) { const x = w.byUid.get(uid); if (x && !x.destroyed) w.destroy(x); }
  const { spawns, treasureRooms } = placeSpawns(st.layout, o);
  st.layout.spawns = spawns; st.layout.treasureRooms = treasureRooms;
  const made: number[] = [], count = { enemies: 0, treasure: 0 };
  for (const s of spawns) {
    const type = s.kind === 'enemy' ? types.enemy : types.treasure;
    if (!type || !w.typeExists(type)) continue;
    const [x, y, z] = roomCellWorld(w, holder, st, s.c, s.r);
    const n = w.spawn(type, x, y, z);
    if (!n) continue;
    made.push(n.uid);
    if (s.kind === 'enemy') count.enemies++; else count.treasure++;
  }
  holder.state.roomSpawns = made;
  return count;
}

/** Where Move to room puts things: the start, the end, a random room's centre, or a random free floor spot. */
export function roomSpot(st: RoomsState, which: string, rnd: () => number): [number, number] {
  const L = st.layout;
  if (which === 'end') return L.end;
  if (which === 'random room' && L.rooms.length) { const q = L.rooms[Math.floor(rnd() * L.rooms.length)]; return [q.cx, q.cy]; }
  if (which === 'random spot') {
    const free: number[] = [];
    for (let k = 0; k < L.cells.length; k++) if (L.cells[k] === 1) free.push(k);
    if (free.length) { const k = free[Math.floor(rnd() * free.length)]; return [k % L.w, Math.floor(k / L.w)]; }
  }
  return L.start;
}
