// Tilemaps for 2D levels (like Tiled / Godot TileMap): a tileset image cut into tiles, painted into layers of cells.
// Layers can be visible or hidden and can collide; each tile can have its own collision shapes (drawn in the tile
// collision editor; default: the full tile). Auto-tiling picks edge / corner / centre tiles from a terrain from the
// neighbours. The collision becomes the tilemap object's compound collider (collider.boxes), so the game's physics
// (Platform, 8-direction, Physics, Pathfinding...) handle it with no special case.
// Cells are (column, row) with rows going DOWN the screen; the object's position is the top-left corner of cell (0,0).
import type { InstanceData } from './runtime/scene';

/** Collision rectangle inside a tile, in tile units (0..1), from the tile's top-left. */
export type TileRect = [number, number, number, number];

export interface TileLayer {
  name: string; visible: boolean; collision: boolean; opacity?: number;
  /** "col,row" -> tile index in the tileset (left to right, top to bottom, 0-based). */
  cells: Record<string, number>;
}

/**
 * Auto-tile terrain: tile for each 4-neighbour mask (bit 1 = up, 2 = right, 4 = down, 8 = left; -1 = unset), and the
 * user's own connection rules, checked first.
 */
export interface Terrain { name: string; tiles: number[]; rules?: TileRule[] }

/**
 * What one neighbour must be for a rule: any tile or none, this terrain ("same"), not this terrain (empty or
 * something else: "other"), or one exact tile index.
 */
export type NeighbourCheck = 'any' | 'same' | 'other' | number;
/** Neighbour order of TileRule.around: up, up-right, right, down-right, down, down-left, left, up-left. */
export const RULE_DIRS: [number, number][] = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]];
/**
 * A user-authored connection rule (like Godot's terrain peering bits / Tiled's rule maps): when all 8 neighbours
 * match, the cell becomes one of `tiles` (several = a random one per cell, the same every time). Rules are checked
 * in order; the first match wins; if none matches, the 16-way terrain table decides.
 */
export interface TileRule { name?: string; around: NeighbourCheck[]; tiles: number[] }
export const newRule = (tile: number): TileRule => ({ around: Array(8).fill('any'), tiles: tile >= 0 ? [tile] : [] });

/** Collision polygon of a tile: points in the tile's footprint (0..1 across, 0..1 down). */
export type TilePoly = [number, number][];

export interface TilemapData {
  /** Tileset image (asset id in GameCraft, image key in LogicCraft). */
  tileset: string;
  /** Texture region of one tile in the tileset image (pixels) and spacing between tiles. */
  tileW: number; tileH: number; spacing?: number; margin?: number;
  /** Width of one cell in world units. */
  cell: number;
  /** Cell shape: square (default) or isometric diamonds. */
  shape?: 'square' | 'isometric';
  /** Isometric layout: diamond (rows run diagonally) or stacked (each row shifted half a cell). */
  layout?: 'diamond' | 'stacked';
  /** Footprint of a cell in pixels ("tile size", e.g. 16×8 for isometric); default: the texture region (square) or half as tall (isometric). */
  gridW?: number; gridH?: number;
  /** Texture region placed this many pixels above the footprint's top (tall isometric tiles: cubes, walls). */
  texOffsetY?: number;
  layers: TileLayer[];
  /** Per tile index: collision rectangles (older maps). Missing = the full tile; [] = no collision. */
  shapes?: Record<number, TileRect[]>;
  /** Per tile index: collision polygons (they win over `shapes`). [] = no collision. */
  polys?: Record<number, TilePoly[]>;
  terrains?: Terrain[];
  /** Per tile index: its role for procedural rooms (floor, wall, door, decor, none); see rooms.ts. */
  /** Per-tile settings (rotation, collision override), set in the Tile roles panel. */
  tileInfo?: Record<number, import('./rooms').TileInfo>;
  roles?: Record<number, import('./rooms').TileRole>;
}

// ------------------------------------------------------------------ cell geometry
// Local coordinates: x right, y UP, origin at the object. Square cells: cell (0,0)'s top-left corner at the origin,
// rows going down. Isometric diamond: cell (0,0)'s top point at the origin, columns going down-right and rows
// down-left. Isometric stacked: rows half a cell apart, odd rows shifted half a cell right.
export const isIso = (m: TilemapData) => m.shape === 'isometric';
/** Footprint size of a cell in pixels. */
export function footprintPx(m: TilemapData) {
  const gw = m.gridW ?? m.tileW;
  return { gw, gh: m.gridH ?? (isIso(m) ? Math.max(1, Math.round(gw / 2)) : m.tileH) };
}
/** Footprint size of a cell in world units (width = cell). */
export function cellSize(m: TilemapData) {
  if (!isIso(m) && m.gridW == null && m.gridH == null) return { w: m.cell, h: m.cell };
  const { gw, gh } = footprintPx(m);
  return { w: m.cell, h: (m.cell * gh) / gw };
}
/** Bounding box of a cell's footprint: left x, top y (local), width, height. */
export function cellBox(m: TilemapData, c: number, r: number) {
  const { w, h } = cellSize(m);
  if (!isIso(m)) return { x: c * w, top: -r * h, w, h };
  if (m.layout === 'stacked') return { x: c * w + (r & 1 ? w / 2 : 0), top: (-r * h) / 2, w, h };
  return { x: ((c - r - 1) * w) / 2, top: (-(c + r) * h) / 2, w, h };
}
/** Outline of a cell (local points): its square, or its diamond (top, right, bottom, left). */
export function cellPolygon(m: TilemapData, c: number, r: number): [number, number][] {
  const b = cellBox(m, c, r);
  if (!isIso(m)) return [[b.x, b.top], [b.x + b.w, b.top], [b.x + b.w, b.top - b.h], [b.x, b.top - b.h]];
  return [[b.x + b.w / 2, b.top], [b.x + b.w, b.top - b.h / 2], [b.x + b.w / 2, b.top - b.h], [b.x, b.top - b.h / 2]];
}
/** Local point -> cell. */
export function cellAtLocal(m: TilemapData, lx: number, ly: number): [number, number] {
  const { w, h } = cellSize(m);
  // (+ 0 turns -0 into 0.)
  if (!isIso(m)) return [Math.floor(lx / w) + 0, Math.floor(-ly / h) + 0];
  if (m.layout !== 'stacked') {
    const a = lx / (w / 2), b = -ly / (h / 2) - 1;
    return [Math.round((a + b) / 2) + 0, Math.round((b - a) / 2) + 0];
  }
  // Stacked: the nearest diamond among the rows around the point.
  const r0 = Math.floor(-ly / (h / 2));
  let best: [number, number] = [0, r0], bd = Infinity;
  for (let r = r0 - 1; r <= r0 + 1; r++) {
    const c = Math.round((lx - (r & 1 ? w / 2 : 0)) / w - 0.5);
    for (const cc of [c - 1, c, c + 1]) {
      const b = cellBox(m, cc, r), d = Math.abs(lx - (b.x + w / 2)) / (w / 2) + Math.abs(ly - (b.top - h / 2)) / (h / 2);
      if (d < bd) { bd = d; best = [cc, r]; }
    }
  }
  return best;
}
/** The default collision of a tile: its whole footprint. */
export const fullPoly = (m: TilemapData): TilePoly => (isIso(m) ? [[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]] : [[0, 0], [1, 0], [1, 1], [0, 1]]);
/** Collision polygons of tile `t` (footprint units); null = the whole footprint. */
export function tilePolys(m: TilemapData, t: number): TilePoly[] | null {
  const p = m.polys?.[t];
  if (p) return p;
  const s = m.shapes?.[t];
  if (s) return s.map(([x, y, w, h]) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]]);
  return null;
}
/** Painted cells of a layer in drawing order (isometric: back to front). */
export function cellsInDrawOrder(m: TilemapData, l: TileLayer): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (const k in l.cells) { const [c, r] = parseKey(k); out.push([c, r, l.cells[k]]); }
  if (isIso(m)) out.sort(m.layout === 'stacked' ? (a, b) => a[1] - b[1] || a[0] - b[0] : (a, b) => a[0] + a[1] - (b[0] + b[1]) || a[0] - b[0]);
  return out;
}

export const emptyTilemap = (tileset = ''): TilemapData => ({ tileset, tileW: 16, tileH: 16, cell: 1, layers: [{ name: 'Ground', visible: true, collision: true, cells: {} }, { name: 'Decor', visible: true, collision: false, cells: {} }] });
const key = (c: number, r: number) => `${c},${r}`;
export const parseKey = (k: string): [number, number] => { const i = k.indexOf(','); return [Number(k.slice(0, i)), Number(k.slice(i + 1))]; };

/** Columns / rows of tiles in the tileset image. */
export function tilesetGrid(map: TilemapData, imgW: number, imgH: number) {
  const m = map.margin ?? 0, s = map.spacing ?? 0;
  const cols = Math.max(1, Math.floor((imgW - m * 2 + s) / (map.tileW + s))), rows = Math.max(1, Math.floor((imgH - m * 2 + s) / (map.tileH + s)));
  return { cols, rows, count: cols * rows, src: (t: number) => ({ x: m + (t % cols) * (map.tileW + s), y: m + Math.floor(t / cols) * (map.tileH + s) }) };
}

// ------------------------------------------------------------------ painting tools
/** Cells of a square brush of `size` centred on (c, r). */
export function brushCells(c: number, r: number, size: number): [number, number][] {
  const out: [number, number][] = [], h = Math.floor((size - 1) / 2);
  for (let y = -h; y < size - h; y++) for (let x = -h; x < size - h; x++) out.push([c + x, r + y]);
  return out;
}
/** Paint (tile >= 0) or erase (tile < 0) cells. Returns the cells that changed. */
export function paint(layer: TileLayer, cells: [number, number][], tile: number): [number, number][] {
  const changed: [number, number][] = [];
  for (const [c, r] of cells) {
    const k = key(c, r);
    if (tile < 0) { if (k in layer.cells) { delete layer.cells[k]; changed.push([c, r]); } }
    else if (layer.cells[k] !== tile) { layer.cells[k] = tile; changed.push([c, r]); }
  }
  return changed;
}
export function rectCells(c0: number, r0: number, c1: number, r1: number): [number, number][] {
  const out: [number, number][] = [];
  for (let r = Math.min(r0, r1); r <= Math.max(r0, r1); r++) for (let c = Math.min(c0, c1); c <= Math.max(c0, c1); c++) out.push([c, r]);
  return out;
}
/** Flood fill the connected area of the same tile (or of empty cells) with `tile`, within `limit` cells and bounds. */
export function fill(layer: TileLayer, c: number, r: number, tile: number, bounds = { c0: -64, r0: -64, c1: 256, r1: 256 }, limit = 20000): [number, number][] {
  const from = layer.cells[key(c, r)] ?? -1;
  if (from === tile) return [];
  const seen = new Set<string>(), queue: [number, number][] = [[c, r]], area: [number, number][] = [];
  while (queue.length && area.length < limit) {
    const [x, y] = queue.pop()!;
    const k = key(x, y);
    if (seen.has(k) || x < bounds.c0 || y < bounds.r0 || x > bounds.c1 || y > bounds.r1) continue;
    seen.add(k);
    if ((layer.cells[k] ?? -1) !== from) continue;
    area.push([x, y]);
    queue.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }
  return paint(layer, area, tile);
}
/** Bounds of the painted cells over all layers (for "fill empty area" and drawing). */
export function usedBounds(map: TilemapData) {
  let c0 = Infinity, r0 = Infinity, c1 = -Infinity, r1 = -Infinity;
  for (const l of map.layers) for (const k in l.cells) { const [c, r] = parseKey(k); c0 = Math.min(c0, c); r0 = Math.min(r0, r); c1 = Math.max(c1, c); r1 = Math.max(r1, r); }
  return c0 === Infinity ? null : { c0, r0, c1, r1 };
}
/** Copy a rectangle of cells (selection) to a stamp, relative to its top-left. */
export function copyRect(layer: TileLayer, c0: number, r0: number, c1: number, r1: number): { w: number; h: number; tiles: (number | -1)[] } {
  const w = Math.abs(c1 - c0) + 1, h = Math.abs(r1 - r0) + 1, x0 = Math.min(c0, c1), y0 = Math.min(r0, r1);
  const tiles: (number | -1)[] = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) tiles.push(layer.cells[key(x0 + x, y0 + y)] ?? -1);
  return { w, h, tiles };
}
export function pasteStamp(layer: TileLayer, stamp: { w: number; h: number; tiles: (number | -1)[] }, c: number, r: number) {
  for (let y = 0; y < stamp.h; y++) for (let x = 0; x < stamp.w; x++) { const t = stamp.tiles[y * stamp.w + x]; if (t >= 0) layer.cells[key(c + x, r + y)] = t; }
}

// ------------------------------------------------------------------ auto-tiling
export const MASK_NAMES = ['single', 'end up', 'end right', 'corner up-right', 'end down', 'vertical', 'corner down-right', 'edge right', 'end left', 'corner up-left', 'horizontal', 'edge up', 'corner down-left', 'edge left', 'edge down', 'centre'];
/** Which cells belong to a terrain: the set of its tiles (the 16-way table and every rule's results). */
export const terrainSet = (t: Terrain) => new Set([...t.tiles, ...(t.rules ?? []).flatMap((r) => r.tiles)].filter((x) => x >= 0));
/** The tile painting a terrain lays down before auto-tiling (its centre, else its first rule's tile). */
export const terrainPaintTile = (t: Terrain, fallback: number) => (t.tiles[15] >= 0 ? t.tiles[15] : t.rules?.find((r) => r.tiles.length)?.tiles[0] ?? fallback);
/** A stable pick per cell (the same tile every time the map is auto-tiled). */
const cellHash = (c: number, r: number) => { let h = (c * 374761393 + r * 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return (h ^ (h >>> 16)) >>> 0; };

/** The first of the terrain's rules matching the cell's neighbours, and its tile for this cell; null if none. */
export function ruleTile(terrain: Terrain, cellTile: (c: number, r: number) => number | undefined, c: number, r: number, set = terrainSet(terrain)): number | null {
  for (const rule of terrain.rules ?? []) {
    if (!rule.tiles.length) continue;
    const ok = rule.around.every((want, k) => {
      if (want === 'any') return true;
      const t = cellTile(c + RULE_DIRS[k][0], r + RULE_DIRS[k][1]);
      if (want === 'same') return t != null && set.has(t);
      if (want === 'other') return t == null || !set.has(t);
      return t === want;
    });
    if (ok) return rule.tiles[cellHash(c, r) % rule.tiles.length];
  }
  return null;
}

/** Pick each terrain cell's tile from its neighbours (call after painting; also updates the cells around). */
export function autotile(layer: TileLayer, terrain: Terrain, around: [number, number][]) {
  const set = terrainSet(terrain);
  const isT = (c: number, r: number) => set.has(layer.cells[key(c, r)] ?? -2);
  const at = (c: number, r: number) => layer.cells[key(c, r)];
  // Rules can look at diagonals: then the 8 cells around change too.
  const near = terrain.rules?.length ? [[0, 0], ...RULE_DIRS] : [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]];
  const todo = new Map<string, [number, number]>();
  for (const [c, r] of around) for (const [dx, dy] of near) todo.set(key(c + dx, r + dy), [c + dx, r + dy]);
  const next: [string, number][] = [];
  for (const [k, [c, r]] of todo) {
    if (!isT(c, r)) continue;
    const byRule = ruleTile(terrain, at, c, r, set);
    if (byRule != null) { next.push([k, byRule]); continue; }
    const mask = (isT(c, r - 1) ? 1 : 0) | (isT(c + 1, r) ? 2 : 0) | (isT(c, r + 1) ? 4 : 0) | (isT(c - 1, r) ? 8 : 0);
    const t = terrain.tiles[mask] >= 0 ? terrain.tiles[mask] : terrain.tiles[15] >= 0 ? terrain.tiles[15] : layer.cells[k];
    next.push([k, t]);
  }
  for (const [k, t] of next) layer.cells[k] = t;
}
/**
 * A terrain from the common 4x4 auto-tile layout starting at tile `first` (columns: none/right-only... in mask order).
 * Many tilesets use a 3x3 block (corners, edges, centre) instead: `fromBlock3x3` maps that.
 */
export function terrainFromBlock3x3(name: string, topLeft: number, tilesetCols: number): Terrain {
  const at = (x: number, y: number) => topLeft + y * tilesetCols + x;
  const t = Array(16).fill(-1);
  // Edges and corners of a 3x3 block; masks that need a missing variant fall back to the closest look.
  t[15] = at(1, 1);
  t[6] = at(0, 0); t[14] = at(1, 0); t[12] = at(2, 0);
  t[7] = at(0, 1); t[13] = at(2, 1);
  t[3] = at(0, 2); t[11] = at(1, 2); t[9] = at(2, 2);
  t[0] = at(1, 1); t[5] = at(1, 1); t[10] = at(1, 0);
  t[1] = at(1, 2); t[4] = at(1, 0); t[2] = at(0, 1); t[8] = at(2, 1);
  return { name, tiles: t };
}

// ------------------------------------------------------------------ collision
/** Compound collider boxes (local units, origin at the object) for the colliding layers. Full tiles are merged in rows. */
export function tilemapBoxes(map: TilemapData): number[][] {
  const out: number[][] = [];
  const { w: cw, h: ch } = cellSize(map), depth = map.cell;
  const iso = isIso(map);
  const full = new Map<number, number[]>(); // square maps: row -> columns with full-tile collision (merged below)
  for (const l of map.layers) {
    if (!l.collision) continue;
    for (const k in l.cells) {
      const t = l.cells[k], [c, r] = parseKey(k);
      const polys = tilePolys(map, t);
      if (!polys && !iso) { (full.get(r) ?? full.set(r, []).get(r)!).push(c); continue; }
      const b = cellBox(map, c, r);
      for (const poly of polys ?? [fullPoly(map)]) {
        if (poly.length < 3) continue;
        polyBoxes(poly.map(([u, v]) => [b.x + u * cw, b.top - v * ch] as [number, number]), depth, out);
      }
    }
  }
  for (const [r, cols] of full) {
    const sorted = [...new Set(cols)].sort((a, b) => a - b);
    for (let i = 0; i < sorted.length;) {
      let j = i; while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
      const c0 = sorted[i], n = j - i + 1;
      out.push([(c0 + n / 2) * cw, -(r + 0.5) * ch, 0, n * cw, ch, depth]);
      i = j + 1;
    }
  }
  return out;
}

/**
 * A polygon as boxes the physics understands: an upright rectangle stays one box; any other shape becomes
 * horizontal slabs, each as wide as the polygon across that slab.
 */
export function polyBoxes(pts: [number, number][], depth: number, out: number[][] = [], slabs = 3): number[][] {
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  if (x1 - x0 < 1e-6 || y1 - y0 < 1e-6) return out;
  const rect = pts.length === 4 && pts.every(([x, y]) => (Math.abs(x - x0) < 1e-6 || Math.abs(x - x1) < 1e-6) && (Math.abs(y - y0) < 1e-6 || Math.abs(y - y1) < 1e-6));
  if (rect) { out.push([(x0 + x1) / 2, (y0 + y1) / 2, 0, x1 - x0, y1 - y0, depth]); return out; }
  for (let s = 0; s < slabs; s++) {
    const a = y0 + ((y1 - y0) * s) / slabs, b = y0 + ((y1 - y0) * (s + 1)) / slabs, mid = (a + b) / 2;
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < pts.length; i++) {
      const [px, py] = pts[i], [qx, qy] = pts[(i + 1) % pts.length];
      if ((py <= mid && qy >= mid) || (qy <= mid && py >= mid)) { const x = Math.abs(qy - py) < 1e-9 ? px : px + ((mid - py) / (qy - py)) * (qx - px); lo = Math.min(lo, x); hi = Math.max(hi, x); }
    }
    if (hi - lo > 1e-6) out.push([(lo + hi) / 2, mid, 0, hi - lo, b - a, depth]);
  }
  return out;
}
/** Keep the object's collider in step with its tiles (call after every edit). */
export function syncTilemapCollider(inst: InstanceData) {
  const map = inst.tilemap; if (!map) return;
  const boxes = tilemapBoxes(map);
  inst.collider = { ...inst.collider, shape: boxes.length ? 'box' : 'none', boxes: boxes.length ? boxes : undefined, size: [1, 1, 1], offset: [0, 0, 0] };
  if (boxes.length && !inst.behaviors.some((b) => b.type === 'solid')) inst.behaviors.push({ type: 'solid', props: { enabled: true } });
}

// ------------------------------------------------------------------ drawing
/** Draw a tilemap with a 2D canvas. `toScreen` maps world points; only cells inside the view are drawn. */
export function drawTilemap(ctx: CanvasRenderingContext2D, inst: InstanceData, img: CanvasImageSource & { width: number; height: number }, toScreen: (x: number, y: number) => { x: number; y: number }, ppu: number, view: { w: number; h: number }, opts: { showCollision?: boolean; highlightLayer?: number } = {}) {
  const map = inst.tilemap!; const grid = tilesetGrid(map, img.width, img.height);
  const iso = isIso(map), { gw } = footprintPx(map);
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  map.layers.forEach((l, li) => {
    if (!l.visible) return;
    ctx.globalAlpha = (l.opacity ?? 1) * (opts.highlightLayer != null && opts.highlightLayer !== li ? 0.45 : 1);
    for (const [c, r, t] of cellsInDrawOrder(map, l)) {
      if (t >= grid.count) continue;
      const b = cellBox(map, c, r);
      // Square: the region fills the cell. Isometric: the region keeps its proportions (cell width = footprint
      // width), centred on the cell, its top at the footprint's top (raised by the texture offset).
      const k = iso ? b.w / gw : 0;
      const iw = iso ? map.tileW * k : b.w, ih = iso ? map.tileH * k : b.h;
      const p = toScreen(inst.x + b.x + (b.w - iw) / 2, inst.y + b.top + (iso ? (map.texOffsetY ?? 0) * k : 0));
      const sw = iw * ppu, sh = ih * ppu;
      if (p.x > view.w || p.y > view.h || p.x + sw < 0 || p.y + sh < 0) continue;
      const s = grid.src(t), rot = iso ? 0 : map.tileInfo?.[t]?.rotation ?? 0;
      if (!rot) ctx.drawImage(img, s.x, s.y, map.tileW, map.tileH, Math.floor(p.x), Math.floor(p.y), Math.ceil(sw), Math.ceil(sh));
      else {
        // A tile turned in quarter turns (Tile roles › rotation): one corner piece serves all four corners.
        ctx.save(); ctx.translate(Math.floor(p.x) + Math.ceil(sw) / 2, Math.floor(p.y) + Math.ceil(sh) / 2); ctx.rotate((rot * Math.PI) / 180);
        ctx.drawImage(img, s.x, s.y, map.tileW, map.tileH, -Math.ceil(sw) / 2, -Math.ceil(sh) / 2, Math.ceil(sw), Math.ceil(sh));
        ctx.restore();
      }
    }
  });
  ctx.globalAlpha = 1;
  if (opts.showCollision) drawTileCollision(ctx, inst, toScreen);
  ctx.restore();
}
/** Collision overlay: each colliding cell's polygons (full square tiles as their merged boxes). */
export function drawTileCollision(ctx: CanvasRenderingContext2D, inst: InstanceData, toScreen: (x: number, y: number) => { x: number; y: number }, limit = 5000) {
  const map = inst.tilemap!; const { w, h } = cellSize(map);
  ctx.fillStyle = 'rgba(255,60,60,.28)'; ctx.strokeStyle = 'rgba(255,60,60,.9)'; ctx.lineWidth = 1;
  const shape = (pts: [number, number][]) => { ctx.beginPath(); pts.forEach(([x, y], i) => { const p = toScreen(inst.x + x, inst.y + y); if (i) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y); }); ctx.closePath(); ctx.fill(); ctx.stroke(); };
  let n = 0;
  for (const l of map.layers) {
    if (!l.collision) continue;
    for (const k in l.cells) {
      if (n++ > limit) return;
      const [c, r] = parseKey(k), polys = tilePolys(map, l.cells[k]), b = cellBox(map, c, r);
      for (const poly of polys ?? [fullPoly(map)]) if (poly.length >= 3) shape(poly.map(([u, v]) => [b.x + u * w, b.top - v * h] as [number, number]));
    }
  }
}
/** World point -> cell. */
export function cellAt(inst: InstanceData, x: number, y: number): [number, number] {
  return cellAtLocal(inst.tilemap!, x - inst.x, y - inst.y);
}
