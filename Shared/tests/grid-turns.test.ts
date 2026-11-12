// Grid turn system: cells, movement rules, the turn order, events, saves.
import { describe, expect, it } from 'vitest';
import { block, doc, event } from './helpers';
import { Runtime } from '../src/runtime/runtime';
import { emptyScene, makeInstance } from '../src/runtime/scene';
import { behaviorDefaults } from '../src/runtime/behaviors';
import { cellAtPoint, cellCentre, chooseEnemyMove, reachableCells, selectCell, type Cell, type GridState, type MoveQuery } from '../src/runtime/gridTurns';

const bh = (type: string, props: any = {}) => ({ type, props: { ...behaviorDefaults(type), ...props } });
const P = { cols: 8, rows: 6, cellSize: 2, orientation: 'flat', rotation: 0 };

describe('cells and the world', () => {
  it('a cell\'s middle maps back to that cell, whatever the placement', () => {
    for (const p of [P, { ...P, rotation: 30 }, { ...P, orientation: 'upright' }, { ...P, cellSize: 0.5, cols: 3, rows: 3 }]) {
      const at = { x: 5, y: 1, z: -3 };
      for (let c = 0; c < p.cols; c++) for (let r = 0; r < p.rows; r++) {
        const q = cellCentre(at, p, c, r);
        expect(cellAtPoint(at, p, q[0], p.orientation === 'upright' ? q[1] : q[2])).toEqual([c, r]);
      }
    }
  });
  it('off the board is no cell; the board is centred on its object', () => {
    expect(cellAtPoint({ x: 0, y: 0, z: 0 }, P, 8.1, 0)).toBeNull();
    expect(cellAtPoint({ x: 0, y: 0, z: 0 }, P, 0, -6.1)).toBeNull();
    expect(cellCentre({ x: 0, y: 0, z: 0 }, P, 0, 0)).toEqual([-7, 0, -5]);
  });
});

describe('where a piece can go', () => {
  const q = (piece: Partial<MoveQuery['piece']>, o: { blocked?: Cell[]; pieces?: [number, number, string][]; capture?: boolean } = {}): MoveQuery => ({
    cols: 8, rows: 8, capture: !!o.capture,
    blocked: (c, r) => !!o.blocked?.some((b) => b[0] === c && b[1] === r),
    sideAt: (c, r) => o.pieces?.find((p) => p[0] === c && p[1] === r)?.[2] ?? null,
    piece: { c: 3, r: 3, side: 'player', style: 'walk', range: 2, pathfinding: true, moved: false, ...piece },
  });
  const ends = (m: Map<string, Cell[]>) => [...m.keys()].sort();

  it('walk goes around blocked cells within range; without pathfinding only straight', () => {
    const wall: Cell[] = [[4, 3], [4, 2], [4, 4]];
    expect(reachableCells(q({ range: 5 }, { blocked: wall })).has('5,3')).toBe(false); // around is 6 steps
    expect(reachableCells(q({ range: 6 }, { blocked: wall })).has('5,3')).toBe(true);
    expect(reachableCells(q({ range: 6 }, { blocked: wall })).get('5,3')!.length).toBe(6); // the route, cell by cell
    expect(reachableCells(q({ range: 6, pathfinding: false }, { blocked: wall })).has('5,3')).toBe(false);
  });
  it('occupied cells are closed, unless capture is on and it is an opponent', () => {
    const pieces: [number, number, string][] = [[4, 3, 'enemy'], [3, 4, 'player']];
    expect(reachableCells(q({ range: 1 }, { pieces })).has('4,3')).toBe(false);
    const cap = reachableCells(q({ range: 2 }, { pieces, capture: true }));
    expect(cap.has('4,3')).toBe(true);
    expect(cap.has('3,4')).toBe(false); // never your own
    expect(cap.has('5,3')).toBe(false); // nor through the piece you capture
  });
  it('the board\'s edge is the end', () => {
    expect(ends(reachableCells(q({ c: 0, r: 0, range: 1 })))).toEqual(['0,1', '1,0']);
  });
  it('chess movement', () => {
    expect(reachableCells(q({ style: 'knight' })).size).toBe(8);
    expect(reachableCells(q({ style: 'king' })).size).toBe(8);
    expect(reachableCells(q({ style: 'rook', range: 8 })).size).toBe(14);
    expect(reachableCells(q({ style: 'bishop', range: 8 })).size).toBe(13);
    expect(reachableCells(q({ style: 'queen', range: 8 })).size).toBe(27);
    const blocked = reachableCells(q({ style: 'rook', range: 8 }, { pieces: [[3, 1, 'player']] }));
    expect(blocked.has('3,2')).toBe(true); expect(blocked.has('3,1')).toBe(false); expect(blocked.has('3,0')).toBe(false);
    const jumps = reachableCells(q({ style: 'knight' }, { pieces: [[3, 2, 'player'], [4, 3, 'player']] }));
    expect(jumps.size).toBe(8); // jumps over pieces
  });
  it('pawns: forward, two at first, diagonal only to capture, each side its own way', () => {
    expect(ends(reachableCells(q({ style: 'pawn', c: 3, r: 6 })))).toEqual(['3,4', '3,5']);
    expect(ends(reachableCells(q({ style: 'pawn', c: 3, r: 6, moved: true })))).toEqual(['3,5']);
    expect(ends(reachableCells(q({ style: 'pawn', c: 3, r: 1, side: 'enemy', moved: true })))).toEqual(['3,2']);
    expect(ends(reachableCells(q({ style: 'pawn', c: 3, r: 6, moved: true }, { pieces: [[3, 5, 'enemy'], [4, 5, 'enemy'], [2, 5, 'player']], capture: true })))).toEqual(['4,5']);
  });
  it('the enemy\'s choice: a capture first, else closer; the same every time; stays if it cannot gain', () => {
    const moves = reachableCells(q({ c: 0, r: 0, side: 'enemy', range: 2 }, { pieces: [[0, 2, 'player']], capture: true }));
    const at = (c: number, r: number) => c === 0 && r === 2;
    expect(chooseEnemyMove(moves, [0, 0], [[0, 2]], at)!.at(-1)).toEqual([0, 2]);
    const far = reachableCells(q({ c: 0, r: 0, side: 'enemy', range: 1 }));
    const a = chooseEnemyMove(far, [0, 0], [[5, 5]], () => false), b = chooseEnemyMove(far, [0, 0], [[5, 5]], () => false);
    expect(a).toEqual(b);
    expect(a!.at(-1)).toEqual([1, 0]); // equally close: the lower row wins
    expect(chooseEnemyMove(reachableCells(q({ c: 5, r: 5, side: 'enemy', range: 1, style: 'walk' }, { pieces: [[5, 6, 'player']] })), [5, 5], [[5, 6]], () => false)).toBeNull();
  });
});

function game(extra: any[] = [], events: any[] = [], globals: any[] = [], boardProps: any = {}, storage?: any) {
  const scene = emptyScene('Board', '3d');
  scene.instances = [
    makeInstance(1, 'Board', 'empty', { behaviors: [bh('gridboard', { cols: 8, rows: 8, cellSize: 2, ...boardProps })] }),
    makeInstance(2, 'Hero', 'box', { behaviors: [bh('gridpiece', { side: 'player', style: 'walk', range: 2, col: 1, row: 1 })] }),
    makeInstance(3, 'Foe', 'box', { behaviors: [bh('gridpiece', { side: 'enemy', style: 'walk', range: 1, col: 6, row: 6 })] }),
    makeInstance(4, 'Foe', 'box', { behaviors: [bh('gridpiece', { side: 'enemy', style: 'walk', range: 1, col: 7, row: 7 })] }),
    ...extra,
  ];
  const rt = new Runtime(scene, doc(events, globals), { app: 'gamecraft', host: { storage } });
  rt.tick();
  const board = rt.world.byUid.get(1)!, hero = rt.world.byUid.get(2)!, f1 = rt.world.byUid.get(3)!, f2 = rt.world.byUid.get(4)!;
  const g = board.state.grid as GridState;
  return { rt, board, hero, f1, f2, g, run: (s: number) => { for (let k = 0; k < s * 60; k++) rt.tick(); }, untilPlayer: () => { for (let k = 0; k < 2000 && (g.phase !== 'player' || g.moving); k++) rt.tick(); } };
}
const cellOf = (p: any) => [p.state.gridPiece.c, p.state.gridPiece.r];

describe('turns', () => {
  it('pieces start on their cells, and it is the player\'s turn; enemies stay still during it', () => {
    const t = game();
    expect(cellOf(t.hero)).toEqual([1, 1]);
    expect(t.hero.x).toBeCloseTo(-5); expect(t.hero.z).toBeCloseTo(-5);
    expect(t.g.phase).toBe('player');
    const a = [t.f1.x, t.f1.z];
    t.run(3);
    expect([t.f1.x, t.f1.z]).toEqual(a);
  });

  it('select, move, and only after it arrives do the enemies move, one at a time, in a fixed order', () => {
    const t = game();
    selectCell(t.rt, t.board, 1, 1);
    expect(t.g.selected).toBe(2);
    expect(t.g.reachable.length).toBeGreaterThan(4);
    selectCell(t.rt, t.board, 3, 1);
    expect(t.g.moving?.uid).toBe(2);
    const order: number[] = [];
    let heroMoved = false;
    for (let k = 0; k < 1000; k++) {
      t.rt.tick();
      const m = t.g.moving?.uid;
      if (m === 2) { expect(cellOf(t.f1)).toEqual([6, 6]); expect(cellOf(t.f2)).toEqual([7, 7]); heroMoved = true; }
      if (m != null && m !== 2 && order[order.length - 1] !== m) order.push(m);
      if (t.g.phase === 'player' && !t.g.moving && heroMoved) break;
    }
    expect(cellOf(t.hero)).toEqual([3, 1]);
    expect(order).toEqual([3, 4]);
    expect(t.hero.x).toBeCloseTo(-1);
    expect(cellOf(t.f1)).not.toEqual([6, 6]);
    expect(cellOf(t.f2)).not.toEqual([7, 7]);
    expect(t.g.phase).toBe('player');
  });

  it('refused: out of range, a closed cell, the wrong turn, while moving', () => {
    const names = ['on_move_rejected'];
    const t = game([], [event([block('grid.on_move_rejected')], [block('var.add', { variable: 'on_move_rejected', value: '1' })])], names.map((n) => ({ name: n, type: 'number', value: 0 })));
    selectCell(t.rt, t.board, 1, 1);
    selectCell(t.rt, t.board, 7, 1); // too far
    t.g.blocked.push('2,1');
    selectCell(t.rt, t.board, 2, 1); // closed
    t.run(0.05);
    expect(t.rt.globals.on_move_rejected).toBe(2);
    expect(t.g.moving).toBeNull();
    expect(t.g.rejected?.cell).toEqual([2, 1]);
    t.g.blocked = [];
    selectCell(t.rt, t.board, 1, 2);
    expect(t.g.moving).toBeTruthy();
    selectCell(t.rt, t.board, 3, 3); // while moving
    t.run(0.05);
    expect(t.rt.globals.on_move_rejected).toBe(3);
    t.g.phase = 'enemy'; t.g.moving = null;
    selectCell(t.rt, t.board, 1, 1); // not the player's turn
    expect(t.g.selected).toBeNull();
  });

  it('a solid object closes its cell; the floor under the board does not', () => {
    const t = game([
      makeInstance(8, 'Floor', 'box', { y: -0.5, sx: 40, sz: 40, behaviors: [bh('solid')] }),
      makeInstance(9, 'Rock', 'box', { x: -3, y: 0.5, z: -5, sx: 1.5, sz: 1.5, behaviors: [bh('solid')] }),
    ]);
    expect(t.g.solid).toEqual(['2,1']);
  });

  it('all the events fire, in the order of a turn', () => {
    const ids = ['on_cell_selected', 'on_move_started', 'on_cell_left', 'on_cell_entered', 'on_move_completed', 'on_player_turn_ended', 'on_enemy_turn_started', 'on_enemy_turn_ended', 'on_player_turn_started'];
    const pieceEvents = new Set(['on_move_started', 'on_cell_left', 'on_cell_entered', 'on_move_completed']);
    const log: string[] = [];
    const t = game([], ids.map((id) => event([block('grid.' + id, {}, pieceEvents.has(id) ? 'Hero' : undefined)], [block('var.add', { variable: id, value: '1' })])), ids.map((n) => ({ name: n, type: 'number', value: 0 })));
    const before = { ...t.rt.globals };
    selectCell(t.rt, t.board, 1, 1);
    selectCell(t.rt, t.board, 3, 1); // two cells: left, entered, left, entered
    t.untilPlayer();
    t.run(0.1);
    for (const id of ids) log.push(`${id}:${t.rt.globals[id] - before[id]}`);
    expect(log).toEqual(['on_cell_selected:2', 'on_move_started:1', 'on_cell_left:2', 'on_cell_entered:2', 'on_move_completed:1', 'on_player_turn_ended:1', 'on_enemy_turn_started:1', 'on_enemy_turn_ended:1', 'on_player_turn_started:1']);
    // (Foe has its own move events: they are not counted on Hero's triggers.)
  });

  it('capture removes the piece and fires its event while it still exists', () => {
    const t = game([], [event([block('grid.on_piece_captured', {}, 'Foe')], [block('var.add', { variable: 'taken', value: '1' })])], [{ name: 'taken', type: 'number', value: 0 }], { capture: true });
    t.rt.world.behavior(t.f1, 'gridpiece')!.props.ai = 'stay';
    t.rt.world.behavior(t.f2, 'gridpiece')!.props.ai = 'stay';
    t.f1.state.gridPiece.c = 3; t.f1.state.gridPiece.r = 1;
    selectCell(t.rt, t.board, 1, 1);
    selectCell(t.rt, t.board, 3, 1);
    t.untilPlayer();
    t.run(0.1);
    expect(t.rt.globals.taken).toBe(1);
    expect(t.f1.destroyed).toBe(true);
    expect(cellOf(t.hero)).toEqual([3, 1]);
  });

  it('a capture only fires for the captured piece\'s type, not the capturer\'s', () => {
    const t = game([], [event([block('grid.on_piece_captured', {}, 'Hero')], [block('var.add', { variable: 'lost', value: '1' })])], [{ name: 'lost', type: 'number', value: 0 }], { capture: true });
    t.rt.world.behavior(t.f1, 'gridpiece')!.props.ai = 'stay';
    t.rt.world.behavior(t.f2, 'gridpiece')!.props.ai = 'stay';
    t.f1.state.gridPiece.c = 3; t.f1.state.gridPiece.r = 1;
    selectCell(t.rt, t.board, 1, 1);
    selectCell(t.rt, t.board, 3, 1);
    t.untilPlayer();
    t.run(0.1);
    expect(t.f1.destroyed).toBe(true);
    expect(t.rt.globals.lost).toBe(0);
  });

  it('enemy moves per turn: only that many, a capture first, otherwise taking turns', () => {
    const t = game([], [], [], { enemyMovesPerTurn: 1 });
    const moved = () => [cellOf(t.f1).join(), cellOf(t.f2).join()];
    const turn = (to: [number, number]) => { const [c, r] = cellOf(t.hero); selectCell(t.rt, t.board, c, r); selectCell(t.rt, t.board, to[0], to[1]); t.untilPlayer(); };
    const a = moved();
    turn([1, 2]);
    const b = moved();
    expect(b.filter((x, k) => x !== a[k]).length).toBe(1);
    turn([1, 3]);
    const c = moved();
    expect(c.filter((x, k) => x !== b[k]).length).toBe(1);
    expect(c[0] !== b[0]).not.toBe(b[0] !== a[0]); // the other one this time
    // An enemy that can capture goes first, whoever's go it was.
    const cap = game([], [], [], { enemyMovesPerTurn: 1, capture: true });
    cap.f2.state.gridPiece.c = 2; cap.f2.state.gridPiece.r = 2;
    selectCell(cap.rt, cap.board, 1, 1); selectCell(cap.rt, cap.board, 1, 2);
    cap.untilPlayer(); cap.run(0.1);
    expect(cellOf(cap.f1)).toEqual([6, 6]); // first in the order, but it could not capture
    expect(cap.hero.destroyed).toBe(true);
  });

  it('a save keeps the grid, the pieces and whose turn it is', () => {
    const m = new Map<string, string>(), storage = { get: (k: string) => m.get(k) ?? null, set: (k: string, v: string) => void m.set(k, v) };
    const t = game([], [], [], {}, storage);
    selectCell(t.rt, t.board, 1, 1); selectCell(t.rt, t.board, 2, 1);
    t.untilPlayer();
    t.g.blocked.push('5,5');
    t.rt.saveGame('s');
    selectCell(t.rt, t.board, 2, 1); selectCell(t.rt, t.board, 4, 1);
    t.untilPlayer();
    expect(cellOf(t.hero)).toEqual([4, 1]);
    t.rt.loadGame('s'); t.rt.tick();
    const hero = t.rt.world.byUid.get(2)!, g = t.rt.world.byUid.get(1)!.state.grid as GridState;
    expect(cellOf(hero)).toEqual([2, 1]);
    expect(hero.x).toBeCloseTo(-3);
    expect(g.blocked).toContain('5,5');
    expect(g.phase).toBe('player');
    expect(g.started).toBe(true);
  });
});
