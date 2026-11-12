// Grid turn system: a Grid Board object (behavior gridboard: size, cell size, centre, orientation) and Grid Piece
// objects (gridpiece: side, how it moves, range). The player moves a piece between valid cells; only when that move has
// finished do the enemies move, one after the other in a fixed order, and only then is it the player's turn again.
// Everything is plain data in inst.state (saved with the game); the renderer draws the grid and highlights from it.
import type { BlockInstance } from '../schema';
import { toNum } from '../expr';
import type { BehaviorHost } from './behaviors';
import type { Ctx, Runtime } from './runtime';
import type { RInstance } from './world';

export type Cell = [number, number]; // column, row
export const PIECE_STYLES = ['walk', 'walk diagonal', 'rook', 'bishop', 'queen', 'king', 'knight', 'pawn'];

export interface GridProps { cols: number; rows: number; cellSize: number; orientation: string; rotation: number }
export interface GridState {
  phase: 'player' | 'enemy'; started: boolean;
  selected: number | null; reachable: Cell[];
  /** Cells closed by the Set cell blocked block ("col,row"), and by solid objects standing on them. */
  blocked: string[]; solid: string[];
  moving: { uid: number; path: Cell[]; step: number; t: number } | null;
  /** Enemy pieces still to move this turn, and the short pause before the next one. */
  queue: number[]; wait: number; movesLeft: number;
  /** A refused cell, shown red for a moment. */
  rejected: { cell: Cell; at: number } | null;
  /** Captured pieces waiting to be removed. */
  captured?: number[];
  /** Enemy moves left this turn (0 = no limit), and how many limited turns have passed (whose go it is). */
  enemyMoves?: number; enemyTurn?: number;
}
export interface PieceState { c: number; r: number; moved: boolean }
const key = (c: number, r: number) => `${c},${r}`;
const RAD = Math.PI / 180;

// ------------------------------------------------------------------ cells and the world
/** World position of a cell's middle. The board object's position is the middle of the board. */
export function cellCentre(b: { x: number; y: number; z: number }, p: GridProps, c: number, r: number): [number, number, number] {
  const u = (c + 0.5 - p.cols / 2) * p.cellSize, v = (r + 0.5 - p.rows / 2) * p.cellSize, a = (p.rotation || 0) * RAD, cs = Math.cos(a), sn = Math.sin(a);
  const ru = u * cs - v * sn, rv = u * sn + v * cs;
  return p.orientation === 'upright' ? [b.x + ru, b.y + rv, b.z] : [b.x + ru, b.y, b.z + rv];
}
/** The cell at a world position (null off the board); `h` / `v` are X and Z when flat, X and Y when upright. */
export function cellAtPoint(b: { x: number; y: number; z: number }, p: GridProps, h: number, v: number): Cell | null {
  const a = -(p.rotation || 0) * RAD, cs = Math.cos(a), sn = Math.sin(a), du = h - b.x, dv = v - (p.orientation === 'upright' ? b.y : b.z);
  const c = Math.floor((du * cs - dv * sn) / p.cellSize + p.cols / 2), r = Math.floor((du * sn + dv * cs) / p.cellSize + p.rows / 2);
  return c >= 0 && r >= 0 && c < p.cols && r < p.rows ? [c, r] : null;
}

// ------------------------------------------------------------------ where a piece can go
export interface MoveQuery {
  cols: number; rows: number;
  blocked(c: number, r: number): boolean;
  /** Who stands there: 'player', 'enemy' or null. */
  sideAt(c: number, r: number): string | null;
  capture: boolean;
  piece: { c: number; r: number; side: string; style: string; range: number; pathfinding: boolean; moved: boolean };
}
const D4: Cell[] = [[1, 0], [-1, 0], [0, 1], [0, -1]], DX: Cell[] = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
const JUMPS: Cell[] = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];

/** Every cell the piece can move to, with the cells it passes through (ending on that cell). */
export function reachableCells(q: MoveQuery): Map<string, Cell[]> {
  const { piece: me } = q, out = new Map<string, Cell[]>();
  const on = (c: number, r: number) => c >= 0 && r >= 0 && c < q.cols && r < q.rows && !q.blocked(c, r);
  const foe = (c: number, r: number) => { const s = q.sideAt(c, r); return !!s && s !== me.side; };
  const free = (c: number, r: number) => !q.sideAt(c, r);
  const endable = (c: number, r: number) => free(c, r) || (q.capture && foe(c, r));
  const rays = (dirs: Cell[], range: number) => {
    for (const [dc, dr] of dirs) {
      const path: Cell[] = [];
      for (let k = 1; k <= range; k++) {
        const c = me.c + dc * k, r = me.r + dr * k;
        if (!on(c, r)) break;
        if (endable(c, r)) { path.push([c, r]); out.set(key(c, r), [...path]); }
        if (!free(c, r)) break; // nothing passes through a piece
      }
    }
  };
  const flood = (dirs: Cell[], range: number) => {
    // Breadth first in a fixed direction order, so the route to a cell is always the same.
    const seen = new Set([key(me.c, me.r)]);
    let front: { c: number; r: number; path: Cell[] }[] = [{ c: me.c, r: me.r, path: [] }];
    for (let k = 0; k < range && front.length; k++) {
      const next: typeof front = [];
      for (const n of front) for (const [dc, dr] of dirs) {
        const c = n.c + dc, r = n.r + dr, id = key(c, r);
        if (seen.has(id) || !on(c, r)) continue;
        seen.add(id);
        if (!endable(c, r)) continue;
        const path: Cell[] = [...n.path, [c, r]];
        out.set(id, path);
        if (free(c, r)) next.push({ c, r, path }); // a captured piece ends the route
      }
      front = next;
    }
  };
  const range = Math.max(0, Math.floor(me.range));
  switch (me.style) {
    case 'walk diagonal': if (me.pathfinding) flood([...D4, ...DX], range); else rays([...D4, ...DX], range); break;
    case 'rook': rays(D4, range); break;
    case 'bishop': rays(DX, range); break;
    case 'queen': rays([...D4, ...DX], range); break;
    case 'king': rays([...D4, ...DX], 1); break;
    case 'knight': for (const [dc, dr] of JUMPS) { const c = me.c + dc, r = me.r + dr; if (on(c, r) && endable(c, r)) out.set(key(c, r), [[c, r]]); } break;
    case 'pawn': {
      // Forward onto free cells (two from its first cell), diagonally forward only to capture. The player's side
      // advances up the rows' numbers towards row 0, the enemy's the other way.
      const f = me.side === 'player' ? -1 : 1, one = me.r + f;
      if (on(me.c, one) && free(me.c, one)) {
        out.set(key(me.c, one), [[me.c, one]]);
        if (!me.moved && on(me.c, one + f) && free(me.c, one + f)) out.set(key(me.c, one + f), [[me.c, one], [me.c, one + f]]);
      }
      if (q.capture) for (const dc of [-1, 1]) if (on(me.c + dc, one) && foe(me.c + dc, one)) out.set(key(me.c + dc, one), [[me.c + dc, one]]);
      break;
    }
    default: if (me.pathfinding) flood(D4, range); else rays(D4, range);
  }
  return out;
}

/** The enemy's choice among its cells: a capture, else as close to the nearest opposing piece as it can get. Null: stay. */
export function chooseEnemyMove(moves: Map<string, Cell[]>, from: Cell, foes: Cell[], foeAt: (c: number, r: number) => boolean): Cell[] | null {
  const dist = (c: number, r: number) => foes.reduce((m, f) => Math.min(m, Math.abs(f[0] - c) + Math.abs(f[1] - r)), Infinity);
  let best: Cell[] | null = null, bestScore = Infinity;
  const entries = [...moves.values()].map((path) => ({ path, end: path[path.length - 1] }))
    .sort((a, b) => a.end[1] - b.end[1] || a.end[0] - b.end[0]); // ties always go the same way
  for (const { path, end } of entries) {
    const score = foeAt(end[0], end[1]) ? -1 : dist(end[0], end[1]);
    if (score < bestScore) { bestScore = score; best = path; }
  }
  return best && (bestScore < dist(from[0], from[1]) || bestScore === -1) ? best : null;
}

// ------------------------------------------------------------------ the running game
type Host = BehaviorHost;
const propsOf = (host: Host, b: RInstance) => host.world.behavior(b, 'gridboard')!.props as GridProps & Record<string, any>;
export const boardOf = (host: Host): RInstance | undefined => host.world.instances.find((i) => !i.destroyed && !!i.state.grid);
const piecesOn = (host: Host) => host.world.instances.filter((i) => !i.destroyed && i.state.gridPiece);
const pieceProps = (host: Host, p: RInstance) => host.world.behavior(p, 'gridpiece')!.props;
const sideOf = (host: Host, p: RInstance) => String(pieceProps(host, p).side);
function pieceAt(host: Host, c: number, r: number): RInstance | undefined { return piecesOn(host).find((p) => p.state.gridPiece.c === c && p.state.gridPiece.r === r); }
function fire(host: Host, id: string, ...objs: (RInstance | undefined)[]) {
  const picks: Record<string, RInstance[]> = {};
  for (const o of objs) if (o) (picks[o.type] ??= []).push(o);
  host.queueTrigger('grid.' + id, picks);
}
function place(host: Host, board: RInstance, p: RInstance, c: number, r: number) {
  const st = p.state.gridPiece as PieceState, [x, y, z] = cellCentre(board, propsOf(host, board), c, r);
  st.c = c; st.r = r; p.vars.gridCol = c; p.vars.gridRow = r;
  p.x = x; p.z = z;
  if (propsOf(host, board).orientation === 'upright') p.y = y;
}

export function initBoard(inst: RInstance) {
  inst.state.grid ??= { phase: 'player', started: false, selected: null, reachable: [], blocked: [], solid: [], moving: null, queue: [], wait: 0, movesLeft: 1, rejected: null } satisfies GridState;
}

/** First tick: pieces onto their cells, solid objects close theirs, and the player's turn begins. */
function begin(host: Host, board: RInstance, g: GridState) {
  const p = propsOf(host, board);
  g.started = true; g.movesLeft = Math.max(1, Number(p.movesPerTurn) || 1);
  for (const o of host.world.instances) {
    if (o.destroyed || !host.world.hasBehavior(o, 'gridpiece') || o.state.gridPiece) continue;
    const pp = pieceProps(host, o), at = cellAtPoint(board, p, o.x, p.orientation === 'upright' ? o.y : o.z);
    const c = Number(pp.col) >= 0 ? Number(pp.col) : at?.[0] ?? 0, r = Number(pp.row) >= 0 ? Number(pp.row) : at?.[1] ?? 0;
    o.state.gridPiece = { c, r, moved: false } satisfies PieceState;
    place(host, board, o, c, r);
  }
  if (p.solidsBlock !== false) {
    const solids = host.world.solids().filter((s) => s !== board && !s.state.gridPiece);
    for (let r = 0; r < p.rows; r++) for (let c = 0; c < p.cols; c++) {
      const [x, y, z] = cellCentre(board, p, c, r);
      const upright = p.orientation === 'upright';
      // Standing on the cell: covers its middle and is above the board (the floor under the board does not count).
      if (solids.some((s) => { const a = host.world.aabb(s); return x > a[0] && x < a[3] && (upright ? y > a[1] && y < a[4] : z > a[2] && z < a[5] && a[4] > y + 0.05); })) g.solid.push(key(c, r));
    }
  }
  fire(host, 'on_player_turn_started', board);
}

function movesFor(host: Host, board: RInstance, g: GridState, piece: RInstance) {
  const p = propsOf(host, board), pp = pieceProps(host, piece), st = piece.state.gridPiece as PieceState;
  return reachableCells({
    cols: p.cols, rows: p.rows, capture: !!p.capture,
    blocked: (c, r) => g.blocked.includes(key(c, r)) || g.solid.includes(key(c, r)),
    sideAt: (c, r) => { const o = pieceAt(host, c, r); return o ? sideOf(host, o) : null; },
    piece: { c: st.c, r: st.r, side: String(pp.side), style: String(pp.style), range: Number(pp.range), pathfinding: pp.pathfinding !== false, moved: st.moved },
  });
}

function deselect(g: GridState) { g.selected = null; g.reachable = []; }
function reject(host: Host, board: RInstance, g: GridState, cell: Cell, piece?: RInstance) {
  g.rejected = { cell, at: host.time };
  fire(host, 'on_move_rejected', board, piece);
}
function startMove(host: Host, board: RInstance, g: GridState, piece: RInstance, path: Cell[]) {
  g.moving = { uid: piece.uid, path, step: 0, t: 0 };
  deselect(g);
  fire(host, 'on_move_started', board, piece);
}

/** A click or a chosen cell in the player's turn: selects a player piece, or moves the selected one there. */
export function selectCell(host: Host, board: RInstance, c: number, r: number) {
  const g = board.state.grid as GridState;
  board.vars.cellCol = c; board.vars.cellRow = r;
  fire(host, 'on_cell_selected', board);
  const sel = g.selected != null ? host.world.byUid.get(g.selected) : undefined;
  if (g.phase !== 'player' || g.moving) { reject(host, board, g, [c, r], sel); return; }
  const there = pieceAt(host, c, r);
  if (there && sideOf(host, there) === 'player') {
    g.selected = there.uid;
    g.reachable = [...movesFor(host, board, g, there).values()].map((path) => path[path.length - 1]);
    return;
  }
  if (!sel || sel.destroyed) { deselect(g); return; }
  const path = movesFor(host, board, g, sel).get(key(c, r));
  if (path) startMove(host, board, g, sel, path); else reject(host, board, g, [c, r], sel);
}

function arrive(host: Host, board: RInstance, g: GridState, piece: RInstance) {
  const st = piece.state.gridPiece as PieceState, side = sideOf(host, piece);
  st.moved = true; g.moving = null;
  fire(host, 'on_move_completed', board, piece);
  if (side === 'player') { if (--g.movesLeft <= 0) endPlayerTurn(host, board, g); }
}

export function endPlayerTurn(host: Host, board: RInstance, g: GridState) {
  deselect(g);
  fire(host, 'on_player_turn_ended', board);
  g.phase = 'enemy'; g.wait = 0.3;
  // A fixed order: by object id, every time.
  g.queue = piecesOn(host).filter((p) => sideOf(host, p) === 'enemy').map((p) => p.uid).sort((a, b) => a - b);
  // Limited moves: pieces that can capture go first, then the rest taking turns from where the last turn stopped.
  g.enemyMoves = Math.max(0, Math.floor(Number(propsOf(host, board).enemyMovesPerTurn) || 0));
  if (g.enemyMoves) {
    const n = g.queue.length, start = n ? (g.enemyTurn = (g.enemyTurn ?? -1) + 1) % n : 0;
    const turned = [...g.queue.slice(start), ...g.queue.slice(0, start)];
    const canTake = (uid: number) => {
      const piece = host.world.byUid.get(uid)!;
      return [...movesFor(host, board, g, piece).values()].some((path) => { const end = path[path.length - 1], o = pieceAt(host, end[0], end[1]); return !!o && sideOf(host, o) !== 'enemy'; });
    };
    g.queue = [...turned.filter(canTake), ...turned.filter((u) => !canTake(u))];
  }
  fire(host, 'on_enemy_turn_started', board);
}
export function endEnemyTurn(host: Host, board: RInstance, g: GridState) {
  fire(host, 'on_enemy_turn_ended', board);
  g.phase = 'player'; g.queue = []; g.moving = null; g.movesLeft = Math.max(1, Number(propsOf(host, board).movesPerTurn) || 1);
  fire(host, 'on_player_turn_started', board);
}

function stepMove(host: Host, board: RInstance, g: GridState, dt: number) {
  const m = g.moving!, piece = host.world.byUid.get(m.uid), p = propsOf(host, board);
  if (!piece || piece.destroyed) { g.moving = null; return; }
  const st = piece.state.gridPiece as PieceState, to = m.path[m.step], from = cellCentre(board, p, st.c, st.r), end = cellCentre(board, p, to[0], to[1]);
  const span = Math.max(Math.abs(to[0] - st.c), Math.abs(to[1] - st.r), 1);
  m.t = Math.min(1, m.t + (dt * Math.max(0.1, Number(p.moveSpeed) || 4)) / span);
  const k = m.t * m.t * (3 - 2 * m.t);
  piece.x = from[0] + (end[0] - from[0]) * k; piece.z = from[2] + (end[2] - from[2]) * k;
  if (p.orientation === 'upright') piece.y = from[1] + (end[1] - from[1]) * k;
  if (m.t < 1) return;
  // On the new cell. Its old cell is left, this one entered; a piece on the last cell of the move is captured.
  fire(host, 'on_cell_left', board, piece);
  const victim = m.step === m.path.length - 1 ? pieceAt(host, to[0], to[1]) : undefined;
  place(host, board, piece, to[0], to[1]);
  fire(host, 'on_cell_entered', board, piece);
  if (victim && victim !== piece) {
    // Off the board now; removed next tick, so On piece captured can still work on it (only the captured piece is
    // picked: a trigger on the capturer's type must not fire).
    fire(host, 'on_piece_captured', board, victim);
    victim.state.gridPiece = undefined; victim.visible = false;
    (g.captured ??= []).push(victim.uid);
  }
  m.step++; m.t = 0;
  if (m.step >= m.path.length) arrive(host, board, g, piece);
}

/** The board's behavior tick. */
export function tickBoard(board: RInstance, props: Record<string, any>, host: Host, dt: number) {
  const g = board.state.grid as GridState;
  if (!g.started) begin(host, board, g);
  if (g.captured?.length) { for (const uid of g.captured) { const o = host.world.byUid.get(uid); if (o) host.world.destroy(o); } g.captured = []; }
  if (g.moving) { stepMove(host, board, g, dt); return; }
  if (g.phase !== 'enemy' || props.autoEnemyTurn === false) return;
  if (g.wait > 0) { g.wait -= dt; return; }
  // Next enemy in the order that can do something.
  while (g.queue.length) {
    const piece = host.world.byUid.get(g.queue.shift()!);
    if (!piece || piece.destroyed || pieceProps(host, piece).ai === 'stay') continue;
    const st = piece.state.gridPiece as PieceState, side = sideOf(host, piece);
    const foes = piecesOn(host).filter((o) => sideOf(host, o) !== side).map((o) => [o.state.gridPiece.c, o.state.gridPiece.r] as Cell);
    const path = chooseEnemyMove(movesFor(host, board, g, piece), [st.c, st.r], foes, (c, r) => { const o = pieceAt(host, c, r); return !!o && sideOf(host, o) !== side; });
    if (path) {
      startMove(host, board, g, piece, path); g.wait = 0.2;
      if (g.enemyMoves && --g.enemyMoves <= 0) g.queue = []; // that was the last move this turn
      return;
    }
  }
  endEnemyTurn(host, board, g);
}

// ------------------------------------------------------------------ blocks
type Act = (rt: Runtime, b: BlockInstance, ctx: Ctx, i?: RInstance) => void;
const N = (rt: Runtime, b: BlockInstance, ctx: Ctx, n: string) => toNum(rt.param(b, n, ctx));
const running = (rt: Runtime) => { const board = boardOf(rt); return board && (board.state.grid as GridState).started ? board : undefined; };

export const GRID_ACTIONS: Record<string, Act> = {
  'grid.select_at': (rt, b, ctx) => {
    const board = running(rt); if (!board) return;
    const at = cellAtPoint(board, propsOf(rt, board), N(rt, b, ctx, 'x'), N(rt, b, ctx, 'y'));
    if (at) selectCell(rt, board, at[0], at[1]);
  },
  'grid.select_cell': (rt, b, ctx) => { const board = running(rt); if (board) selectCell(rt, board, Math.floor(N(rt, b, ctx, 'col')), Math.floor(N(rt, b, ctx, 'row'))); },
  'grid.deselect': (rt) => { const board = running(rt); if (board) deselect(board.state.grid); },
  'grid.move_piece': (rt, b, ctx, i) => {
    // For scripted turns: the piece's own side's rules, whoever's turn it is, one move at a time.
    const board = running(rt); if (!board || !i?.state.gridPiece) return;
    const g = board.state.grid as GridState, c = Math.floor(N(rt, b, ctx, 'col')), r = Math.floor(N(rt, b, ctx, 'row'));
    if (g.moving) { reject(rt, board, g, [c, r], i); return; }
    const path = movesFor(rt, board, g, i).get(key(c, r));
    if (path) startMove(rt, board, g, i, path); else reject(rt, board, g, [c, r], i);
  },
  'grid.end_turn': (rt) => {
    const board = running(rt); if (!board) return;
    const g = board.state.grid as GridState;
    if (g.moving) return;
    if (g.phase === 'player') endPlayerTurn(rt, board, g); else endEnemyTurn(rt, board, g);
  },
  'grid.set_blocked': (rt, b, ctx) => {
    const board = running(rt); if (!board) return;
    const g = board.state.grid as GridState, id = key(Math.floor(N(rt, b, ctx, 'col')), Math.floor(N(rt, b, ctx, 'row')));
    g.blocked = g.blocked.filter((x) => x !== id);
    if (b.params.blocked !== false && b.params.blocked !== 'false') g.blocked.push(id);
  },
  'grid.place_piece': (rt, b, ctx, i) => { const board = running(rt); if (board && i?.state.gridPiece) place(rt, board, i, Math.floor(N(rt, b, ctx, 'col')), Math.floor(N(rt, b, ctx, 'row'))); },
  'grid.set_range': (rt, b, ctx, i) => { const bh = rt.world.behavior(i!, 'gridpiece'); if (bh) bh.props.range = Math.max(0, N(rt, b, ctx, 'value')); },
};

type Cond = { test: (rt: Runtime, b: BlockInstance, ctx: Ctx, i?: RInstance) => any };
const always: Cond = { test: () => true };
export const GRID_CONDITIONS: Record<string, Cond> = {
  'grid.on_cell_selected': always, 'grid.on_move_started': always, 'grid.on_move_completed': always, 'grid.on_move_rejected': always,
  'grid.on_player_turn_started': always, 'grid.on_player_turn_ended': always, 'grid.on_enemy_turn_started': always, 'grid.on_enemy_turn_ended': always,
  'grid.on_cell_entered': always, 'grid.on_cell_left': always, 'grid.on_piece_captured': always,
  'grid.is_player_turn': { test: (rt) => { const board = boardOf(rt); return !!board && board.state.grid.phase === 'player' && !board.state.grid.moving; } },
  'grid.is_enemy_turn': { test: (rt) => boardOf(rt)?.state.grid.phase === 'enemy' },
  'grid.is_moving': { test: (rt) => !!boardOf(rt)?.state.grid.moving },
  'grid.cell_free': {
    test: (rt, b, ctx) => {
      const board = boardOf(rt); if (!board) return false;
      const g = board.state.grid as GridState, p = propsOf(rt, board), c = Math.floor(N(rt, b, ctx, 'col')), r = Math.floor(N(rt, b, ctx, 'row')), id = key(c, r);
      return c >= 0 && r >= 0 && c < p.cols && r < p.rows && !g.blocked.includes(id) && !g.solid.includes(id) && !pieceAt(rt, c, r);
    },
  },
};
