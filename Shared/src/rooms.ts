// Procedural rooms: a seeded dungeon layout (rooms joined by corridors, or a cave), the roles of a tile group (which
// tiles are floors, walls, doors, decoration — guessed from the pictures, or from model names and shapes for 3D kits,
// and correctable), and building the layout into a tilemap (2D, pixel-art, isometric) or into 3D pieces. The same seed
// always gives the same rooms.
import { Rng } from './runtime/rng';
import { footprintPx, isIso, type TilemapData } from './tilemap';

// ------------------------------------------------------------------ layout

export const CELL = { empty: 0, floor: 1, wall: 2, door: 3 } as const;
export type CellKind = (typeof CELL)[keyof typeof CELL];

export interface RoomsOptions {
  seed: number;
  /** Grid size in cells. */
  width: number; height: number;
  /** How many rooms to try to place (rooms style). */
  rooms: number;
  minRoom: number; maxRoom: number;
  /** Corridor width in cells (1–3). */
  corridor: number;
  /** Rooms joined by corridors, or one connected cave. */
  style: 'rooms' | 'cave';
  /** Chance (0..1) that a room (not the start) is a treasure room. */
  treasure?: number;
  /** Enemies per room (0..1 of a room's spare floor, scaled by difficulty); never in the start room. */
  enemies?: number;
  /** 1 (easy) .. 10 (hard): more enemies, farther rooms get more. */
  difficulty?: number;
}
export const DEFAULT_ROOMS: RoomsOptions = { seed: 1, width: 40, height: 30, rooms: 8, minRoom: 4, maxRoom: 9, corridor: 1, style: 'rooms', treasure: 0.2, enemies: 0, difficulty: 3 };

/** Something to place in a built layout: an enemy or treasure spot (cell). */
export interface RoomSpawn { c: number; r: number; kind: 'enemy' | 'treasure'; room: number }

export interface Room { x: number; y: number; w: number; h: number; cx: number; cy: number }
export interface RoomsLayout {
  w: number; h: number;
  /** Row-major cell kinds (CELL). */
  cells: Uint8Array;
  rooms: Room[];
  /** Start (first room's centre) and end (the room farthest from the start by walking). */
  start: [number, number]; end: [number, number];
  /** Floor cells next to a wall, away from doors: spots for decoration and props. */
  props: [number, number][];
  /** Enemy and treasure spots (Treasure / Enemies / Difficulty options). */
  spawns?: RoomSpawn[];
  /** Indices of treasure rooms. */
  treasureRooms?: number[];
}

export function generateRooms(o: Partial<RoomsOptions>): RoomsLayout {
  const opt = { ...DEFAULT_ROOMS, ...o };
  const W = Math.max(8, Math.min(256, Math.round(opt.width))), H = Math.max(8, Math.min(256, Math.round(opt.height)));
  const rng = new Rng(Math.round(opt.seed) || 1);
  const ri = (a: number, b: number) => Math.floor(rng.range(a, b + 1));
  const cells = new Uint8Array(W * H);
  const at = (c: number, r: number) => (c < 0 || r < 0 || c >= W || r >= H ? CELL.empty : cells[r * W + c]);
  const set = (c: number, r: number, v: number) => { if (c > 0 && r > 0 && c < W - 1 && r < H - 1) cells[r * W + c] = v; };
  const rooms: Room[] = [];
  if (opt.style === 'cave') {
    // Cellular automaton, then keep the biggest connected cave.
    for (let r = 1; r < H - 1; r++) for (let c = 1; c < W - 1; c++) cells[r * W + c] = rng.next() < 0.47 ? CELL.floor : CELL.empty;
    for (let it = 0; it < 5; it++) {
      const next = cells.slice();
      for (let r = 1; r < H - 1; r++) for (let c = 1; c < W - 1; c++) {
        let n = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && at(c + dx, r + dy) === CELL.floor) n++;
        next[r * W + c] = n >= 5 || (n >= 4 && cells[r * W + c] === CELL.floor) ? CELL.floor : CELL.empty;
      }
      cells.set(next);
    }
    const biggest = largestRegion(cells, W, H);
    for (let k = 0; k < cells.length; k++) if (cells[k] === CELL.floor && !biggest.has(k)) cells[k] = CELL.empty;
    // "Rooms" for placing things: a few spread-out floor spots.
    const floors = [...biggest].sort((a, b) => a - b);
    for (let k = 0; k < Math.min(opt.rooms, floors.length); k++) { const i = floors[Math.floor((k + 0.5) * floors.length / Math.max(1, opt.rooms))]; const c = i % W, r = Math.floor(i / W); rooms.push({ x: c, y: r, w: 1, h: 1, cx: c, cy: r }); }
  } else {
    for (let tries = 0; tries < opt.rooms * 30 && rooms.length < opt.rooms; tries++) {
      const w = ri(opt.minRoom, opt.maxRoom), h = ri(opt.minRoom, opt.maxRoom);
      const x = ri(2, W - w - 3), y = ri(2, H - h - 3);
      if (x < 2 || y < 2) continue;
      if (rooms.some((q) => x < q.x + q.w + 2 && x + w + 2 > q.x && y < q.y + q.h + 2 && y + h + 2 > q.y)) continue; // a wall between rooms
      rooms.push({ x, y, w, h, cx: x + Math.floor(w / 2), cy: y + Math.floor(h / 2) });
    }
    for (const q of rooms) for (let r = q.y; r < q.y + q.h; r++) for (let c = q.x; c < q.x + q.w; c++) set(c, r, CELL.floor);
    // Join each room to the nearest already-joined one (a tree, so everything connects), with L-shaped corridors.
    const cw = Math.max(1, Math.min(3, Math.round(opt.corridor)));
    const corridor = (a: [number, number], b: [number, number]) => {
      const horizFirst = rng.next() < 0.5;
      const carve = (c: number, r: number) => { for (let k = 0; k < cw; k++) for (let j = 0; j < cw; j++) if (at(c + k, r + j) !== CELL.floor) set(c + k, r + j, CELL.door); };
      const [x0, y0] = a, [x1, y1] = b;
      const cx = horizFirst ? x1 : x0, cy = horizFirst ? y0 : y1;
      for (let c = Math.min(x0, x1); c <= Math.max(x0, x1); c++) carve(c, cy);
      for (let r = Math.min(y0, y1); r <= Math.max(y0, y1); r++) carve(cx, r);
    };
    for (let k = 1; k < rooms.length; k++) {
      let best = 0, bd = Infinity;
      for (let j = 0; j < k; j++) { const d = Math.abs(rooms[j].cx - rooms[k].cx) + Math.abs(rooms[j].cy - rooms[k].cy); if (d < bd) { bd = d; best = j; } }
      corridor([rooms[best].cx, rooms[best].cy], [rooms[k].cx, rooms[k].cy]);
    }
    // Corridor cells are floor; the ones where a corridor meets a room are doors.
    const inRoom = (c: number, r: number) => rooms.some((q) => c >= q.x && c < q.x + q.w && r >= q.y && r < q.y + q.h);
    const doorAt = (c: number, r: number) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => inRoom(c + dx, r + dy));
    for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) if (cells[r * W + c] === CELL.door) cells[r * W + c] = doorAt(c, r) ? CELL.door : CELL.floor;
  }
  // Walls: empty cells touching floor (8 neighbours).
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
    if (at(c, r) !== CELL.empty) continue;
    let touch = false;
    for (let dy = -1; dy <= 1 && !touch; dy++) for (let dx = -1; dx <= 1; dx++) { const v = at(c + dx, r + dy); if (v === CELL.floor || v === CELL.door) { touch = true; break; } }
    if (touch) cells[r * W + c] = CELL.wall;
  }
  const start: [number, number] = rooms.length ? [rooms[0].cx, rooms[0].cy] : firstFloor(cells, W);
  // End: the room centre farthest from the start by walking.
  const dist = walkDistances(cells, W, H, start);
  let end = start, far = -1;
  for (const q of rooms) { const d = dist[q.cy * W + q.cx]; if (d > far) { far = d; end = [q.cx, q.cy]; } }
  const props: [number, number][] = [];
  for (let r = 1; r < H - 1; r++) for (let c = 1; c < W - 1; c++) {
    if (at(c, r) !== CELL.floor || (c === start[0] && r === start[1]) || (c === end[0] && r === end[1])) continue;
    const nWall = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dy]) => at(c + dx, r + dy) === CELL.wall).length;
    const nearDoor = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => at(c + dx, r + dy) === CELL.door);
    if (nWall >= 1 && !nearDoor) props.push([c, r]);
  }
  const layout: RoomsLayout = { w: W, h: H, cells, rooms, start, end, props };
  Object.assign(layout, placeSpawns(layout, opt));
  return layout;
}

/**
 * Treasure rooms and enemy spots for a layout (their own seeded stream, so the rooms themselves don't change with
 * these settings): the start room stays safe; rooms farther from the start by walking get up to twice the enemies.
 */
export function placeSpawns(L: RoomsLayout, opt: { seed: number; treasure?: number; enemies?: number; difficulty?: number }): { spawns: RoomSpawn[]; treasureRooms: number[] } {
  const W = L.w, at = (c: number, r: number) => (c < 0 || r < 0 || c >= W || r >= L.h ? CELL.empty : L.cells[r * W + c]);
  const dist = walkDistances(L.cells, W, L.h, L.start);
  const srng = new Rng(((Math.round(opt.seed) || 1) * 2654435761) >>> 0 || 7);
  const spawns: RoomSpawn[] = [], treasureRooms: number[] = [];
  const diff = Math.max(1, Math.min(10, opt.difficulty ?? 3)), maxD = Math.max(1, ...L.rooms.map((q) => dist[q.cy * W + q.cx]));
  const free = (q: Room) => { const out: [number, number][] = []; for (let r = q.y; r < q.y + q.h; r++) for (let c = q.x; c < q.x + q.w; c++) if (at(c, r) === CELL.floor && !(c === L.start[0] && r === L.start[1]) && !(c === L.end[0] && r === L.end[1])) out.push([c, r]); return out; };
  L.rooms.forEach((q, k) => {
    if (k === 0) return;
    const spots = free(q);
    if (!spots.length) return;
    const take = () => spots.splice(Math.floor(srng.next() * spots.length), 1)[0];
    if (srng.next() < (opt.treasure ?? 0)) { treasureRooms.push(k); const s = take(); if (s) spawns.push({ c: s[0], r: s[1], kind: 'treasure', room: k }); }
    const depth = 1 + Math.max(0, dist[q.cy * W + q.cx]) / maxD;
    const n = Math.round((opt.enemies ?? 0) * Math.max(1, spots.length * 0.08) * (diff / 3) * depth);
    for (let i = 0; i < n && spots.length; i++) { const s = take(); spawns.push({ c: s[0], r: s[1], kind: 'enemy', room: k }); }
  });
  return { spawns, treasureRooms };
}

function firstFloor(cells: Uint8Array, W: number): [number, number] { const i = cells.indexOf(CELL.floor); return i < 0 ? [0, 0] : [i % W, Math.floor(i / W)]; }

function largestRegion(cells: Uint8Array, W: number, H: number): Set<number> {
  const seen = new Uint8Array(cells.length); let best = new Set<number>();
  for (let s = 0; s < cells.length; s++) {
    if (cells[s] !== CELL.floor || seen[s]) continue;
    const region = new Set<number>(), stack = [s]; seen[s] = 1;
    while (stack.length) {
      const i = stack.pop()!; region.add(i);
      const c = i % W, r = Math.floor(i / W);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nc = c + dx, nr = r + dy; if (nc < 0 || nr < 0 || nc >= W || nr >= H) continue; const j = nr * W + nc; if (!seen[j] && cells[j] === CELL.floor) { seen[j] = 1; stack.push(j); } }
    }
    if (region.size > best.size) best = region;
  }
  return best;
}

/** Steps from `from` to every floor / door cell (-1 = unreachable). */
export function walkDistances(cells: Uint8Array, W: number, H: number, from: [number, number]): Int32Array {
  const d = new Int32Array(cells.length).fill(-1);
  const q: number[] = [from[1] * W + from[0]]; d[q[0]] = 0;
  for (let h = 0; h < q.length; h++) {
    const i = q[h], c = i % W, r = Math.floor(i / W);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nc = c + dx, nr = r + dy; if (nc < 0 || nr < 0 || nc >= W || nr >= H) continue;
      const j = nr * W + nc; if (d[j] >= 0 || (cells[j] !== CELL.floor && cells[j] !== CELL.door)) continue;
      d[j] = d[i] + 1; q.push(j);
    }
  }
  return d;
}

// ------------------------------------------------------------------ tile roles

/**
 * What a tile is for. The four groups the builder needs (floor, wall, door, decoration) plus finer kinds it uses when
 * a tile group has them: wall edges by the side the floor is on (a "top edge" runs along the top of a room, floor
 * below it), outer / inner corners, door frames, windows, pillars, ceilings, stairs, platforms, entrance / exit and
 * treasure. A finer kind missing from a tile group falls back to its group.
 */
export type TileRole =
  | 'floor' | 'platform' | 'stairs' | 'ceiling'
  | 'wall' | 'wall-top' | 'wall-bottom' | 'wall-left' | 'wall-right' | 'outer-corner' | 'inner-corner' | 'window' | 'pillar'
  | 'door' | 'door-frame' | 'entrance' | 'exit'
  | 'decor' | 'treasure' | 'none';
export const TILE_ROLES: TileRole[] = ['floor', 'wall', 'door', 'decor', 'none', 'wall-top', 'wall-bottom', 'wall-left', 'wall-right', 'outer-corner', 'inner-corner', 'window', 'pillar', 'door-frame', 'entrance', 'exit', 'platform', 'stairs', 'ceiling', 'treasure'];
export const ROLE_LABELS: Record<TileRole, string> = {
  floor: 'Floor', platform: 'Platform', stairs: 'Stairs', ceiling: 'Ceiling', wall: 'Wall', 'wall-top': 'Top edge', 'wall-bottom': 'Bottom edge', 'wall-left': 'Left edge', 'wall-right': 'Right edge',
  'outer-corner': 'Outer corner', 'inner-corner': 'Inner corner', window: 'Window', pillar: 'Pillar', door: 'Door', 'door-frame': 'Door frame', entrance: 'Entrance', exit: 'Exit', decor: 'Decoration', treasure: 'Treasure', none: 'Not used',
};
/** The group a role belongs to (what the builder falls back to). */
export function roleGroup(r: TileRole): 'floor' | 'wall' | 'door' | 'decor' | 'ceiling' | 'none' {
  if (r === 'floor' || r === 'platform' || r === 'stairs') return 'floor';
  if (r === 'door' || r === 'door-frame' || r === 'entrance' || r === 'exit') return 'door';
  if (r === 'decor' || r === 'treasure') return 'decor';
  if (r === 'ceiling') return 'ceiling';
  if (r === 'none') return 'none';
  return 'wall';
}

/** A tile's own settings (Tile roles panel): rotation in quarter turns and collision overriding its role's. */
export interface TileInfo { rotation?: 0 | 90 | 180 | 270; collision?: 'auto' | 'solid' | 'none' }

/**
 * Guess each tile's role from its pixels (RGBA of the whole tileset). Square tiles: empty (transparent) → none, partly
 * transparent → decor, opaque: darker or busier than the typical opaque tile → wall, else floor. Isometric tiles: a
 * flat diamond covers about one cell footprint → floor, a raised block (cube, wall) clearly more → wall.
 */
export function classifyTiles(data: Uint8ClampedArray | Uint8Array, imgW: number, map: TilemapData, cols: number, rows: number): Record<number, TileRole> {
  const sp = map.spacing ?? 0, mg = map.margin ?? 0;
  const stats: { t: number; cover: number; lum: number; dev: number }[] = [];
  for (let t = 0; t < cols * rows; t++) {
    const x0 = mg + (t % cols) * (map.tileW + sp), y0 = mg + Math.floor(t / cols) * (map.tileH + sp);
    let n = 0, sum = 0, sum2 = 0, total = 0;
    for (let y = y0; y < y0 + map.tileH; y++) for (let x = x0; x < x0 + map.tileW; x++) {
      const k = (y * imgW + x) * 4; total++;
      if (data[k + 3] < 128) continue;
      const l = 0.2126 * data[k] + 0.7152 * data[k + 1] + 0.0722 * data[k + 2];
      n++; sum += l; sum2 += l * l;
    }
    const lum = n ? sum / n : 0;
    stats.push({ t, cover: total ? n / total : 0, lum, dev: n ? Math.sqrt(Math.max(0, sum2 / n - lum * lum)) : 0 });
  }
  const out: Record<number, TileRole> = {};
  if (isIso(map)) {
    // Measured against the cell's diamond: a flat tile covers about one diamond, a raised block (its sides showing)
    // clearly more, a prop less.
    const { gw, gh } = footprintPx(map), diamond = Math.max(1, (gw * gh) / 2), rect = map.tileW * map.tileH;
    for (const s of stats) {
      const k = (s.cover * rect) / diamond;
      out[s.t] = k < 0.05 ? 'none' : k >= 1.4 ? 'wall' : k >= 0.6 ? 'floor' : 'decor';
    }
    return out;
  }
  const solid = stats.filter((s) => s.cover >= 0.9);
  const med = (a: number[]) => { const b = [...a].sort((x, y) => x - y); return b.length ? b[Math.floor(b.length / 2)] : 0; };
  const mLum = med(solid.map((s) => s.lum)), mDev = med(solid.map((s) => s.dev));
  for (const s of stats) {
    if (s.cover < 0.05) out[s.t] = 'none';
    else if (s.cover < 0.9) out[s.t] = 'decor';
    else out[s.t] = s.lum < mLum * 0.82 || s.dev > mDev * 1.6 ? 'wall' : 'floor';
  }
  return out;
}

/** A tile or model's role from its file / model name (Wall_Corner_Inner, door_frame, stairs01…), or null. */
export function roleFromName(name: string): TileRole | null {
  const n = name.toLowerCase().replace(/[_\-.]+/g, ' ');
  if (/inner corner|corner in|in corner|inside corner|concave/.test(n)) return 'inner-corner';
  if (/outer corner|corner out|out corner|outside corner|convex|\bcorner\b/.test(n)) return 'outer-corner';
  if (/door ?frame|doorway|arch/.test(n)) return 'door-frame';
  if (/entrance|\bentry\b|\bstart\b/.test(n)) return 'entrance';
  if (/\bexit\b|\bgoal\b|\bend\b/.test(n)) return 'exit';
  if (/door|gate/.test(n)) return 'door';
  if (/window/.test(n)) return 'window';
  if (/stair|steps|ladder/.test(n)) return 'stairs';
  if (/pillar|column|post/.test(n)) return 'pillar';
  if (/ceiling|roof/.test(n)) return 'ceiling';
  if (/platform|ledge/.test(n)) return 'platform';
  if (/chest|treasure|coin|gem|loot/.test(n)) return 'treasure';
  if (/(top|upper|north) ?(edge|wall)|wall ?(top|north)/.test(n)) return 'wall-top';
  if (/(bottom|lower|south) ?(edge|wall)|wall ?(bottom|south)/.test(n)) return 'wall-bottom';
  if (/(left|west) ?(edge|wall)|wall ?(left|west)/.test(n)) return 'wall-left';
  if (/(right|east) ?(edge|wall)|wall ?(right|east)/.test(n)) return 'wall-right';
  if (/wall|fence/.test(n)) return 'wall';
  if (/floor|ground|tile|plank|carpet|grass/.test(n)) return 'floor';
  if (/decor|prop|plant|barrel|crate|torch|rock|bush/.test(n)) return 'decor';
  return null;
}

/** 3D kits: a model's role from its name, else its shape (flat → floor, thin and tall → wall, else decor). */
export function classifyModel(name: string, size?: readonly number[]): TileRole {
  const named = roleFromName(name);
  if (named) return named;
  if (size && size.length >= 3) {
    const [x, y, z] = size.map(Math.abs);
    if (y < 0.25 * Math.max(x, z)) return 'floor';
    if (Math.min(x, z) < 0.35 * Math.max(x, z) && y > 0.6 * Math.max(x, z)) return 'wall';
  }
  return 'decor';
}

// ------------------------------------------------------------------ building

/** The tiles of each role, and of each group (a fine role's tiles also count for its group). */
export function tilesByRole(roles: Record<number, TileRole> | undefined): Record<TileRole, number[]> & { groups: Record<string, number[]> } {
  const out = Object.fromEntries(TILE_ROLES.map((r) => [r, [] as number[]])) as Record<TileRole, number[]>;
  const groups: Record<string, number[]> = { floor: [], wall: [], door: [], decor: [], ceiling: [], none: [] };
  for (const [t, r] of Object.entries(roles ?? {})) { if (!out[r]) continue; out[r].push(Number(t)); groups[roleGroup(r)].push(Number(t)); }
  return Object.assign(out, { groups });
}

/**
 * Which wall piece a wall cell needs, from where the floor is around it: an edge (floor on one side; a "top edge"
 * has the floor below it), an inner corner (floor on two neighbouring sides), an outer corner (floor only diagonally).
 */
export function wallKind(at: (c: number, r: number) => number, c: number, r: number): TileRole {
  const open = (dc: number, dr: number) => { const v = at(c + dc, r + dr); return v === CELL.floor || v === CELL.door; };
  const n = open(0, -1), s = open(0, 1), w = open(-1, 0), e = open(1, 0);
  const sides = [n, s, w, e].filter(Boolean).length;
  if (sides === 0) return open(-1, -1) || open(1, -1) || open(-1, 1) || open(1, 1) ? 'outer-corner' : 'wall';
  if (sides >= 2 && (n || s) && (w || e)) return 'inner-corner';
  if (s && !n) return 'wall-top';
  if (n && !s) return 'wall-bottom';
  if (e && !w) return 'wall-left';
  if (w && !e) return 'wall-right';
  return 'wall';
}

/**
 * Paint a layout into a tilemap: floors (and doors) on a "Floor" layer, walls on a solid "Walls" layer, some
 * decoration on a "Decor" layer (density 0..1). Existing cells of those layers are replaced. Returns the layer indices.
 */
export function buildTilemap(map: TilemapData, layout: RoomsLayout, roles: Record<number, TileRole> | undefined, seed: number, decor = 0.15) {
  const by = tilesByRole(roles), info = map.tileInfo ?? {};
  const rng = new Rng((Math.round(seed) || 1) ^ 0x5bd1e995);
  const pick = (list: number[], fb: number) => (list.length ? list[Math.floor(rng.next() * list.length)] : fb);
  const layer = (name: string, collision: boolean) => {
    let k = map.layers.findIndex((l) => l.name === name);
    if (k < 0) { map.layers.push({ name, visible: true, collision, cells: {} }); k = map.layers.length - 1; }
    map.layers[k].cells = {}; map.layers[k].collision = collision;
    return k;
  };
  layer('Floor', false); layer('Walls', true); layer('Decor', false);
  // Drawn in this order on top of any other layers (floors under walls under decoration).
  const ours = ['Floor', 'Walls', 'Decor'].map((n) => map.layers.find((l) => l.name === n)!);
  map.layers = [...map.layers.filter((l) => !ours.includes(l)), ...ours];
  const fl = map.layers.length - 3, wl = fl + 1, dl = fl + 2;
  // Other layers that used to collide would block the new rooms: they stop colliding.
  map.layers.forEach((l, k) => { if (k !== wl && l.collision) l.collision = false; });
  const G = by.groups;
  const floorFb = (by.floor[0] ?? G.floor[0]) ?? 0, wallFb = (by.wall[0] ?? G.wall[0]) ?? floorFb;
  // A fine role's tiles, else the plain role's, else any of the group's.
  const choose = (role: TileRole, plain: TileRole, fb: number) => (by[role].length ? pick(by[role], fb) : by[plain].length ? pick(by[plain], fb) : pick(G[roleGroup(plain)] ?? [], fb));
  // A tile's own collision setting moves it between the solid Walls layer and the walk-through layers.
  const place = (layerIfAuto: number, k: string, t: number) => {
    const col = info[t]?.collision ?? 'auto';
    const L = col === 'solid' ? wl : col === 'none' && layerIfAuto === wl ? fl : layerIfAuto;
    map.layers[L].cells[k] = t;
  };
  const at = (c: number, r: number) => (c < 0 || r < 0 || c >= layout.w || r >= layout.h ? CELL.empty : layout.cells[r * layout.w + c]);
  for (let r = 0; r < layout.h; r++) for (let c = 0; c < layout.w; c++) {
    const v = layout.cells[r * layout.w + c], k = `${c},${r}`;
    if (v === CELL.floor) place(fl, k, pick(by.floor.length ? by.floor : G.floor, floorFb));
    else if (v === CELL.door) place(fl, k, by.door.length ? pick(by.door, floorFb) : G.door.length ? pick(G.door, floorFb) : pick(by.floor, floorFb));
    else if (v === CELL.wall) place(wl, k, choose(wallKind(at, c, r), 'wall', wallFb));
  }
  // Entrance and exit pieces at the start and end, treasure in treasure rooms, decoration along the walls.
  const mark = (cell: [number, number], role: TileRole) => { if (by[role].length) map.layers[dl].cells[`${cell[0]},${cell[1]}`] = pick(by[role], by[role][0]); };
  mark(layout.start, 'entrance'); mark(layout.end, 'exit');
  // Treasure only with treasure tiles (tilesets without them build exactly as before).
  for (const s of layout.spawns ?? []) if (s.kind === 'treasure') mark([s.c, s.r], 'treasure');
  const decorTiles = by.decor.length ? by.decor : G.decor.filter((t) => roles?.[t] !== 'treasure');
  if (decorTiles.length) for (const [c, r] of layout.props) if (rng.next() < decor && !map.layers[dl].cells[`${c},${r}`]) place(dl, `${c},${r}`, pick(decorTiles, decorTiles[0]));
  return { floor: fl, walls: wl, decor: dl };
}

/** A 3D piece of a built layout: what (role), where (cell centre, in cells) and which way a wall faces (degrees). */
export interface Piece3D { role: 'floor' | 'wall' | 'door' | 'decor' | 'ceiling' | 'stairs' | 'entrance' | 'treasure' | 'enemy'; c: number; r: number; ry: number }

/**
 * The pieces of a 3D build: a floor under every walkable cell, a wall per wall cell (facing the floor), door frames,
 * optional ceilings over every walkable cell, an entrance at the start, stairs down at the exit, treasure and enemy
 * spots (from the layout's spawns).
 */
export function pieces3D(layout: RoomsLayout, seed: number, decor = 0.15, opts: { ceiling?: boolean } = {}): Piece3D[] {
  const out: Piece3D[] = [], W = layout.w;
  const at = (c: number, r: number) => (c < 0 || r < 0 || c >= W || r >= layout.h ? CELL.empty : layout.cells[r * W + c]);
  const rng = new Rng((Math.round(seed) || 1) ^ 0x2545f491);
  for (let r = 0; r < layout.h; r++) for (let c = 0; c < W; c++) {
    const v = at(c, r);
    if (v === CELL.floor || v === CELL.door) { out.push({ role: 'floor', c, r, ry: 0 }); if (opts.ceiling) out.push({ role: 'ceiling', c, r, ry: 0 }); }
    if (v === CELL.door) {
      // Door frames span the passage: across a corridor running along x they face ±x.
      const alongX = at(c - 1, r) !== CELL.wall && at(c + 1, r) !== CELL.wall;
      out.push({ role: 'door', c, r, ry: alongX ? 90 : 0 });
    }
    if (v === CELL.wall) {
      // Face the first walkable neighbour (heading 0 = +X).
      const dirs: [number, number, number][] = [[1, 0, 0], [0, -1, 90], [-1, 0, 180], [0, 1, 270]];
      const f = dirs.find(([dx, dy]) => { const n = at(c + dx, r + dy); return n === CELL.floor || n === CELL.door; });
      out.push({ role: 'wall', c, r, ry: f ? f[2] : 0 });
    }
  }
  // The entrance, exit stairs, treasure and enemy spots claim their cells first; decoration never shares one.
  const taken = new Set<string>([`${layout.start[0]},${layout.start[1]}`, `${layout.end[0]},${layout.end[1]}`, ...(layout.spawns ?? []).map((s) => `${s.c},${s.r}`)]);
  for (const [c, r] of layout.props) {
    if (rng.next() >= decor) continue;
    const ry = Math.floor(rng.next() * 4) * 90; // drawn as before, so a seed keeps its look apart from the clash
    if (!taken.has(`${c},${r}`)) out.push({ role: 'decor', c, r, ry });
  }
  out.push({ role: 'entrance', c: layout.start[0], r: layout.start[1], ry: 0 }, { role: 'stairs', c: layout.end[0], r: layout.end[1], ry: 0 });
  for (const s of layout.spawns ?? []) out.push({ role: s.kind, c: s.c, r: s.r, ry: Math.floor(rng.next() * 4) * 90 });
  return out;
}
