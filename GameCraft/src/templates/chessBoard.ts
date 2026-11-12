// Template: turn-based tactics with the library's chess pieces on the Grid Board. Click one of your white pieces, click
// a green cell; when it has arrived black answers with one move. Take the black king to win.
import { B, E, G, Kit, bh, makeProject, v } from './kit';
import type { InstanceData } from '@shared/src/runtime/scene';

const CELL = 2, SIZE = 8;
const chess = (name: string) => `lib:library/chess/${name}.fbx`;
const SCALE = 0.42;
const NOCOL = { shape: 'none' as const, size: [1, 1, 1] as [number, number, number], offset: [0, 0, 0] as [number, number, number] };
/** Which piece moves how, and how far. */
const MOVES: Record<string, { style: string; range: number }> = { Pawn: { style: 'pawn', range: 1 }, Rook: { style: 'rook', range: 8 }, Knight: { style: 'knight', range: 1 }, Bishop: { style: 'bishop', range: 8 }, Queen: { style: 'queen', range: 8 }, King: { style: 'king', range: 1 } };
const BACK = ['Rook', 'Knight', 'Bishop', 'Queen', 'King', 'Bishop', 'Knight', 'Rook'];

export function chessBoardTemplate() {
  const k = new Kit('Board', '3d');
  k.scene.settings.background = '#20232a';
  k.scene.settings.world = { color: '#a4adbd', strength: 0.75, viewTransform: 'agx', exposure: 0 };
  const at = (n: number) => (n + 0.5 - SIZE / 2) * CELL;
  k.box('Table', 0, -0.6, 0, SIZE * CELL + 2, 1, SIZE * CELL + 2, '#3a2a1e');
  for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) k.box((c + r) % 2 ? 'DarkTile' : 'LightTile', at(c), -0.05, at(r), CELL, 0.1, CELL, (c + r) % 2 ? '#4f3b2a' : '#d9c7a3', false);
  // The board lies at floor height, so Mouse.X and Mouse.Z are points on it.
  k.add('Board', 'empty', { name: 'Board', collider: NOCOL, behaviors: [bh('gridboard', { cols: SIZE, rows: SIZE, cellSize: CELL, capture: true, moveSpeed: 5, enemyMovesPerTurn: 1, lineColor: '#000000' })] });

  const piece = (kind: string, side: 'player' | 'enemy', c: number, r: number) => {
    const white = side === 'player', m = MOVES[kind];
    k.add(white ? 'WhitePiece' : 'BlackPiece', 'mesh', {
      name: (white ? 'White ' : 'Black ') + kind, x: at(c), y: 0, z: at(r), sx: SCALE, sy: SCALE, sz: SCALE, noMarks: true, color: white ? '#f2ead8' : '#2a2a30',
      mesh: { asset: chess(kind), rotY: 0, tint: true }, tags: kind === 'King' ? ['king'] : [],
      collider: { shape: 'box', size: [3.4, 6, 3.4], offset: [0, 3, 0] },
      behaviors: [bh('gridpiece', { side, style: m.style, range: m.range, col: c, row: r })],
    } as Partial<InstanceData>);
  };
  BACK.forEach((kind, c) => { piece(kind, 'player', c, 7); piece(kind, 'enemy', c, 0); });
  for (let c = 0; c < SIZE; c++) { piece('Pawn', 'player', c, 6); piece('Pawn', 'enemy', c, 1); }

  k.camera({ x: 0, y: 19, z: 15, rx: -52 }, { focalLength: 30, clipEnd: 200 });
  k.sun(2.2, -55, 30, { y: 30 });
  k.text('TurnText', 'Your turn', 'tc', 0, 14, 26, '#ffffff');
  k.text('TakenText', 'Taken: 0', 'tr', 16, 14, 18, '#ffe066');
  k.text('Hint', 'Click a white piece, then a green cell. Black moves when you have finished.', 'bc', 0, 14, 15, '#c7cdd6');

  const events = [
    G('Moves', [
      E([B('input.on_mouse_click', { button: 'left' }), B('grid.is_player_turn')], [B('grid.select_at', { x: 'Mouse.X', y: 'Mouse.Z' })]),
      E([B('grid.on_move_rejected')], [B('audio.play', { sound: 'click', volume: '40' })]),
      E([B('grid.on_move_completed', {}, 'WhitePiece')], [B('audio.play', { sound: 'click', volume: '60' })]),
      E([B('grid.on_move_completed', {}, 'BlackPiece')], [B('audio.play', { sound: 'click', volume: '35' })]),
    ]),
    G('Turns', [
      E([B('grid.on_player_turn_started')], [B('ui.set_text', { text: '"Your turn"' }, 'TurnText')]),
      E([B('grid.on_enemy_turn_started')], [B('ui.set_text', { text: '"Black is moving…"' }, 'TurnText')]),
    ]),
    G('Captures', [
      E([B('grid.on_piece_captured', {}, 'BlackPiece')], [B('var.add', { variable: 'taken', value: '1' }), B('ui.set_text', { text: '"Taken: " & taken' }, 'TakenText'), B('particles.spawn_at', { preset: 'sparks' }, 'BlackPiece'), B('audio.play', { sound: 'hit', volume: '60' })], [
        E([B('object.has_tag', { tag: 'king' }, 'BlackPiece')], [B('audio.play', { sound: 'win' }), B('game.victory', { title: '"You took the king!"', message: '"Pieces taken: " & taken' })]),
      ]),
      E([B('grid.on_piece_captured', {}, 'WhitePiece')], [B('particles.spawn_at', { preset: 'sparks' }, 'WhitePiece'), B('audio.play', { sound: 'hit', volume: '45' })], [
        E([B('object.has_tag', { tag: 'king' }, 'WhitePiece')], [B('audio.play', { sound: 'lose' }), B('game.defeat', { title: '"Your king was taken"', message: '"Pieces taken: " & taken' })]),
      ]),
    ]),
  ];
  return makeProject({
    name: 'Chess', template: 'chessboard', scenes: [k.scene], events, plane: 'xz', globals: [v('taken', 0)],
    tutorial: [
      { title: 'Your move', text: 'Click a white piece: its cell turns gold and the cells it can reach turn green. Click a green cell to move there. While you think, black stands still.', target: 'play' },
      { title: 'Turn order', text: 'When your piece has arrived, black answers with one move (Grid Board › Enemy moves per turn; 0 moves every enemy, one after the other, always in the same order), and then it is your turn again.', target: 'play' },
      { title: 'Board and pieces', text: 'The Board object has the Grid Board behavior (size, cell size, capture). Each piece has Grid Piece (side, how it moves, range). Change them in the Properties panel.', target: 'inspector' },
      { title: 'Grid events', text: 'The Grid blocks (On player turn started, On grid move completed, On grid piece captured and more) are ordinary events: add your own rules.', target: 'eventsheet' },
    ],
  });
}
