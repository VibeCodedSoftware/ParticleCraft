// Shared block library. Every block has a stable ID, category, typed parameters with defaults,
// a sentence template, documentation, app support, and (in runtime/blockImpl.ts) one runtime
// implementation used by BOTH GameCraft and LogicCraft. Never rename an ID; add a migration instead.
import type { AppId, ParamValue } from '../schema';
import { WORLD_CATEGORIES, worldBlockDefs } from '../world/bricks';
import { AXES, PAD_BUTTONS } from '../runtime/input';
import { readPaths } from './pathParam';
/** Whose input an action block reads: anyone's bindings, or one local player's own (Input editor › Players). */
const PLAYER_CHOICES = ['any player', 'player 1', 'player 2', 'player 3', 'player 4'];
const PROFILE_PLAYERS = ['every player', 'player 1', 'player 2', 'player 3', 'player 4'];
const BLOOD_MODES = ['none', 'on hit', 'on kill', 'hit and kill'];

export type ParamType =
  | 'expr' // any expression (number/string/bool), e.g. Player.X + 1, "Hello"
  | 'text' // literal text, no quotes required (names, tags)
  | 'choice' | 'key' | 'mouse' | 'objectType' | 'variable' | 'instanceVar' | 'compare' | 'boolean'
  | 'particlePreset' | 'postfxPreset' | 'effectType' | 'sound' | 'behavior' | 'color' | 'function'
  | 'code' // source text in the language named by the block's "language" parameter
  | 'language' | 'dialogue' | 'scene' | 'video' | 'picture'
  | 'path'; // routes drawn in the scene from a button on the brick (see pathParam.ts)

export interface ParamDef { name: string; label: string; type: ParamType; default: ParamValue; options?: string[]; doc?: string }

export type CategoryId =
  | 'events' | 'input' | 'conditions' | 'loops' | 'variables' | 'lists' | 'random' | 'functions' | 'objects' | 'movement'
  | 'physics' | 'vr' | 'combat' | 'ai' | 'timers' | 'audio' | 'particles' | 'camera' | 'ui' | 'game' | 'animation' | 'dialogue' | 'code' | 'world' | 'video'
  | 'wsystem' | 'wterrain' | 'wendless' | 'wtree' | 'wrock' | 'wscatter' | 'wwater' | 'wroad' | 'wsnow' | 'wseason' | 'wweather' | 'wstruct' | 'wcave' | 'winteract';

export interface BlockDef {
  id: string;
  kind: 'condition' | 'action';
  /** Triggers run out-of-band when something happens (Construct's green arrow). Must be the first condition. */
  trigger?: boolean;
  /** Looping conditions repeat the rest of the event (Repeat, For each...). */
  looping?: boolean;
  category: CategoryId;
  name: string;
  /** Sentence shown in both views. {param} is replaced by its value. */
  text: string;
  target: 'none' | 'object';
  /** Behavior the target must have (Platform, Physics...). */
  behavior?: string;
  params: ParamDef[];
  doc: string;
  apps: AppId[];
  /** Name of the matching Construct 2 condition/action, so C2 tutorials map 1:1. */
  c2?: string;
  /** Supported by the source-code exporters (codegen). */
  codegen?: boolean;
  since: number;
}

export interface CategoryDef { id: CategoryId; name: string; color: string; icon: string; /** Standard device emoji (LogicCraft palette). */ emoji?: string; doc: string }

export const CATEGORIES: CategoryDef[] = [
  { id: 'events', name: 'Events', color: '#e6a100', icon: '⚡', emoji: '⚡', doc: 'Triggers that start an event: scene start, collisions, timers, custom events.' },
  { id: 'input', name: 'Input', color: '#2f9fd6', icon: '⌨', emoji: '⌨️', doc: 'Keyboard and mouse.' },
  { id: 'conditions', name: 'Conditions', color: '#3fa34d', icon: '◇', emoji: '❓', doc: 'Tests and comparisons. Several conditions = AND; right-click the event for OR; invert for NOT.' },
  { id: 'loops', name: 'Loops & flow', color: '#e8892b', icon: '↻', emoji: '🔁', doc: 'Repeat, While, For, For each, Wait and Stop loop.' },
  { id: 'variables', name: 'Variables', color: '#f07818', icon: '𝑥', emoji: '🔢', doc: 'Global, local and instance variables.' },
  { id: 'lists', name: 'Lists & dictionaries', color: '#e4572e', icon: '☰', emoji: '📋', doc: 'Array and dictionary variables.' },
  { id: 'random', name: 'Random', color: '#7a5af5', icon: '⚄', emoji: '🎲', doc: 'Seeded random numbers, choices, positions and rotations. A fixed seed gives the same results every play (levels you can share); Randomize seed makes every play different.' },
  { id: 'functions', name: 'Functions', color: '#e5577e', icon: 'ƒ', emoji: '🧩', doc: 'Reusable functions and custom events.' },
  { id: 'objects', name: 'Objects', color: '#3b6fd6', icon: '◼', emoji: '📦', doc: 'Create, destroy, pick and change objects.' },
  { id: 'movement', name: 'Movement', color: '#4c97ff', icon: '➜', emoji: '🏃', doc: 'Position, rotation and movement behaviors.' },
  { id: 'physics', name: 'Physics', color: '#18a3b8', icon: '⚛', emoji: '🧲', doc: 'Forces, gravity, collisions, raycasts, grab and throw.' },
  { id: 'vr', name: 'VR', color: '#3a8fd9', icon: '◎', emoji: '🥽', doc: 'Virtual reality (Quest, SteamVR through WebXR): the VR Player behavior, teleports, grabbing and the VR actions (Grab, Teleport, Move, Turn, Interact, Primary, Secondary).' },
  { id: 'combat', name: 'Combat', color: '#d93b3b', icon: '⚔', emoji: '⚔️', doc: 'Health, damage, weapons and projectiles.' },
  { id: 'ai', name: 'AI', color: '#8b5cf6', icon: '◉', emoji: '🤖', doc: 'Pathfinding, patrol, chase, flee, line of sight.' },
  { id: 'timers', name: 'Timers', color: '#b08a1e', icon: '⏱', emoji: '⏱️', doc: 'Every X seconds and named timers.' },
  { id: 'audio', name: 'Audio', color: '#c45ccf', icon: '♪', emoji: '🔊', doc: 'Sounds, music and volume.' },
  { id: 'particles', name: 'Particles', color: '#ff7a45', icon: '✦', emoji: '✨', doc: 'Particle emitters and presets.' },
  { id: 'camera', name: 'Camera & effects', color: '#0fa37f', icon: '◎', emoji: '🎥', doc: 'Camera shake, targets and post-processing.' },
  { id: 'ui', name: 'UI', color: '#5b67f0', icon: '▤', emoji: '🖼️', doc: 'Messages, text, bars and menus.' },
  { id: 'game', name: 'Game flow', color: '#6b7a90', icon: '⚑', emoji: '🏁', doc: 'Pause, restart, scenes, checkpoints, win and lose.' },
  { id: 'animation', name: 'Animation', color: '#c04fc0', icon: '▶', emoji: '🎞️', doc: 'Animation clips and tweens.' },
  { id: 'dialogue', name: 'Dialogue', color: '#d4609a', icon: '❝', emoji: '💬', doc: 'Branching conversations made in the Dialogue editor: start, continue, choose, and react to lines, choices and endings.' },
  { id: 'video', name: 'Cutscenes & video', color: '#b4532a', icon: '▣', emoji: '🎬', doc: 'Play video files as cutscenes and react when they reach a time or finish.' },
  { id: 'world', name: 'World & lights', color: '#2b8a9e', icon: '☀', emoji: '🌤️', doc: 'Sky and time of day, water, lights and glow.' },
  { id: 'code', name: 'Code', color: '#2f6fb5', icon: '{}', emoji: '💻', doc: 'Code blocks in a chosen language: JavaScript runs sandboxed, HTML/CSS make UI panels, others are checked and exported.' },
  ...(WORLD_CATEGORIES as CategoryDef[]),
];

const BOTH: AppId[] = ['gamecraft', 'logiccraft'];
const GC: AppId[] = ['gamecraft'];
/** Screen transitions (same list as story.ts TRANSITION_KINDS). */
const TRANSITIONS = ['none', 'fade', 'fade-white', 'wipe', 'curtain', 'blinds', 'iris', 'diamond', 'star', 'heart', 'dissolve', 'shape', 'map'];
/** Picture choices of a transition: its shape / fade map (for shape and map) and an optional cover picture. */
const TRANSITION_PICTURES = () => [p('picture', 'Shape or fade map (Pictures)', 'picture', '', { doc: 'shape: the transition closes on this picture\'s shape. map: a greyscale picture, dark parts cover first.' }), p('cover', 'Cover picture (empty = the colour)', 'picture', '')];

const p = (name: string, label: string, type: ParamType, def: ParamValue, extra: Partial<ParamDef> = {}): ParamDef => ({ name, label, type, default: def, ...extra });
const cmp = (name = 'op') => p(name, 'Comparison', 'compare', '=');
const ot = (name = 'object', label = 'Object', def = 'Player') => p(name, label, 'objectType', def);
const ex = (name: string, label: string, def: ParamValue = '0') => p(name, label, 'expr', def);

type Opts = Partial<BlockDef>;
const defs: BlockDef[] = [];
function C(id: string, category: CategoryId, name: string, text: string, params: ParamDef[], doc: string, o: Opts = {}) {
  defs.push({ id, kind: 'condition', category, name, text, target: 'none', params, doc, apps: BOTH, since: 1, ...o });
}
function A(id: string, category: CategoryId, name: string, text: string, params: ParamDef[], doc: string, o: Opts = {}) {
  defs.push({ id, kind: 'action', category, name, text, target: 'none', params, doc, apps: BOTH, since: 1, ...o });
}
const T = { trigger: true } as const;
const OBJ = { target: 'object' } as const;
const PROPS = ['X', 'Y', 'Z', 'Angle', 'RotX', 'RotY', 'RotZ', 'ScaleX', 'ScaleY', 'ScaleZ', 'Opacity', 'VX', 'VY', 'VZ', 'Speed'];
const EFFECT_TYPES = ['bloom', 'dof', 'pixelate', 'palette', 'ps1', 'crt', 'vhs', 'grain', 'vignette', 'chromatic', 'colorgrade', 'outline', 'posterize', 'halftone', 'distortion', 'motionblur', 'letterbox', 'fog', 'noir', 'celshade', 'dither', 'ascii', 'volumetric'];
export const POSTFX_PRESET_IDS = ['none', 'ps1', 'pixelart', 'cinematic', 'vhs', 'crt', 'noir', 'anime', 'comic', 'dreamy', 'horror', 'underwater', 'heat', 'dither', 'ascii', 'volumetric', 'bloom', 'dof', 'motionblur', 'chromatic', 'vignette', 'grain', 'colorgrade', 'celshade', 'outline', 'fog'];

// ---------------- Events (triggers) ----------------
C('system.on_start_of_layout', 'events', 'On start of scene', 'On start of scene', [], 'Runs once when the scene starts (or restarts).', { ...T, c2: 'System: On start of layout', codegen: true });
C('system.on_game_start', 'events', 'On game start', 'On game start', [], 'Runs once when the game is first launched (not on restarts).', { ...T, codegen: true });
C('system.every_tick', 'events', 'Every tick', 'Every tick', [], 'True every frame (60 fixed ticks per second). Use dt for frame-independent movement.', { c2: 'System: Every tick', codegen: true });
C('system.on_fixed_update', 'events', 'On fixed physics update', 'On fixed physics update', [], 'Runs every fixed step right after behaviors and physics move objects, before the rest of the sheet.', T);
C('system.on_signal', 'events', 'On custom event', 'On custom event {name}', [p('name', 'Event name', 'text', 'my_event')], 'Runs when "Trigger custom event" is used with the same name.', { ...T, c2: 'System: On signal', codegen: true });
C('object.on_collision', 'events', 'On collision with', '{Self} on collision with {other}', [ot('other', 'Other object', 'Coin')], 'Runs once when the object starts overlapping another object. Both objects are picked.', { ...T, ...OBJ, c2: 'Object: On collision with another object' });
C('object.on_collision_end', 'events', 'On collision exited', '{Self} stopped overlapping {other}', [ot('other', 'Other object', 'Coin')], 'Runs once when two objects stop overlapping.', { ...T, ...OBJ });
C('object.on_trigger_enter', 'events', 'On trigger entered', '{Self} entered trigger {other}', [ot('other', 'Trigger object', 'Zone')], 'Like On collision, but only for objects whose collider is marked "Is trigger".', { ...T, ...OBJ });
C('object.on_created', 'events', 'On created', 'On {Self} created', [], 'Runs when an instance is created or spawned.', { ...T, ...OBJ, c2: 'Object: On created' });
C('object.on_destroyed', 'events', 'On destroyed', 'On {Self} destroyed', [], 'Runs when an instance is destroyed.', { ...T, ...OBJ, c2: 'Object: On destroyed' });
C('object.on_clicked', 'input', 'On object clicked', 'On {Self} clicked', [], 'Runs when the object is clicked with the left mouse button. Picks the clicked instance.', { ...T, ...OBJ, c2: 'Mouse: On object clicked' });
C('var.on_changed', 'events', 'On variable changed', 'On {variable} changed', [p('variable', 'Global variable', 'variable', 'score')], 'Runs whenever a global variable changes value.', T);
C('health.on_damaged', 'combat', 'On damaged', 'On {Self} damaged', [], 'Runs when the object takes damage.', { ...T, ...OBJ, behavior: 'health' });
C('health.on_healed', 'combat', 'On health changed', 'On {Self} health changed', [], 'Runs when health goes up or down.', { ...T, ...OBJ, behavior: 'health' });
C('health.on_died', 'combat', 'On died', 'On {Self} died', [], 'Runs once when health reaches 0.', { ...T, ...OBJ, behavior: 'health' });
C('voxel.on_dug', 'objects', 'On terrain dug', 'On {Self} dug', [], 'Runs after "Dig terrain" removes cells. Self.lastDug / Self.lastGold hold how many cells (and gold ore) were removed; hitX/Y/Z where.', { ...T, ...OBJ, apps: GC });
C('voxel.on_built', 'objects', 'On terrain built', 'On {Self} built', [], 'Runs after "Build terrain" adds cells.', { ...T, ...OBJ, apps: GC });
C('combat.on_hit', 'combat', 'On hit by attack', 'On {Self} hit by attack', [], 'Runs when a melee attack or projectile hits this object.', { ...T, ...OBJ });
// Spawner behavior.
C('spawner.on_spawned', 'ai', 'On spawned', 'On {Self} spawned an object', [], 'This spawner just made one (the new object is picked too).', { ...T, ...OBJ, behavior: 'spawner' });
A('spawner.start', 'ai', 'Start spawner', '{Self} start spawning', [], 'Turns the spawner on.', { ...OBJ, behavior: 'spawner' });
A('spawner.stop', 'ai', 'Stop spawner', '{Self} stop spawning', [], 'Turns the spawner off; what it made stays.', { ...OBJ, behavior: 'spawner' });
A('spawner.spawn_now', 'ai', 'Spawn now', '{Self} spawn now', [], 'Turns the spawner on and makes the next lot straight away.', { ...OBJ, behavior: 'spawner' });
// Follower behavior (pets and companions).
C('follower.on_teleported', 'ai', 'On follower caught up by jumping', 'On {Self} appeared beside its leader', [], 'It was left so far behind that it appeared at the leader\'s side.', { ...T, ...OBJ, behavior: 'follower' });
C('follower.on_attack', 'ai', 'On follower attacked', 'On {Self} hit an enemy', [], 'The follower hit an enemy (Follower › Can attack); the enemy is picked too.', { ...T, ...OBJ, behavior: 'follower' });
C('follower.on_returned', 'ai', 'On follower returned', 'On {Self} back from a fight', [], 'The fight is over and the follower is back at its place near its leader.', { ...T, ...OBJ, behavior: 'follower' });
C('follower.is_following', 'ai', 'Is following', '{Self} is following', [], 'False after Stay, true after Follow.', { ...OBJ, behavior: 'follower' });
A('follower.stay', 'ai', 'Stay', '{Self} stay here', [], 'The follower waits where it is until told to Follow.', { ...OBJ, behavior: 'follower' });
A('follower.follow', 'ai', 'Follow', '{Self} follow again', [], 'The follower goes back to following its leader.', { ...OBJ, behavior: 'follower' });
// Grid turn system (runtime/gridTurns.ts): behaviors Grid Board and Grid Piece.
const GRIDT = { ...T, apps: GC };
const GRIDP = { ...T, ...OBJ, apps: GC };
const GRIDA = { apps: GC };
const CELL = () => [ex('col', 'Column', '0'), ex('row', 'Row', '0')];
C('grid.on_cell_selected', 'world', 'On grid cell selected', 'On grid cell selected', [], 'A cell was chosen (Select grid cell). The Grid Board\'s variables cellCol and cellRow say which.', GRIDT);
C('grid.on_move_started', 'world', 'On grid move started', 'On {Self} grid move started', [], 'This piece begins a move.', GRIDP);
C('grid.on_move_completed', 'world', 'On grid move completed', 'On {Self} grid move completed', [], 'This piece has finished its move.', GRIDP);
C('grid.on_move_rejected', 'world', 'On grid move rejected', 'On grid move rejected', [], 'A move was refused: a closed or occupied cell, out of range, not its turn, or something is already moving.', GRIDT);
C('grid.on_player_turn_started', 'world', 'On player turn started', 'On player turn started', [], 'The player can move now (also at the start of the game).', GRIDT);
C('grid.on_player_turn_ended', 'world', 'On player turn ended', 'On player turn ended', [], 'The player\'s move has finished; the enemies are next.', GRIDT);
C('grid.on_enemy_turn_started', 'world', 'On enemy turn started', 'On enemy turn started', [], 'The enemies begin to move, one after the other.', GRIDT);
C('grid.on_enemy_turn_ended', 'world', 'On enemy turn ended', 'On enemy turn ended', [], 'Every enemy has moved.', GRIDT);
C('grid.on_cell_entered', 'world', 'On grid cell entered', 'On {Self} entered a grid cell', [], 'This piece arrived on a cell (each cell of a route). Its variables gridCol and gridRow say which.', GRIDP);
C('grid.on_cell_left', 'world', 'On grid cell left', 'On {Self} left a grid cell', [], 'This piece is leaving its cell for the next one.', GRIDP);
C('grid.on_piece_captured', 'world', 'On grid piece captured', 'On {Self} captured', [], 'This piece was captured (Grid Board › Pieces can capture); it is removed right after.', GRIDP);
C('grid.is_player_turn', 'world', 'Is player\'s grid turn', 'It is the player\'s grid turn', [], 'True when the player can move: their turn, nothing moving.', GRIDA);
C('grid.is_enemy_turn', 'world', 'Is enemies\' grid turn', 'It is the enemies\' grid turn', [], 'True from the end of the player\'s move until every enemy has moved.', GRIDA);
C('grid.is_moving', 'world', 'A grid piece is moving', 'A grid piece is moving', [], 'True while a piece is on its way.', GRIDA);
C('grid.cell_free', 'world', 'Grid cell is free', 'Grid cell ({col}, {row}) is free', CELL(), 'True when the cell is on the board, open and empty.', GRIDA);
A('grid.select_at', 'world', 'Select grid cell at point', 'Select grid cell at ({x}, {y})', [ex('x', 'X', 'Mouse.X'), ex('y', 'Z (Y on an upright board)', 'Mouse.Z')], 'What a click does: picks a player piece, or moves the picked piece there if it can go there. Off the board: nothing.', GRIDA);
A('grid.select_cell', 'world', 'Select grid cell', 'Select grid cell ({col}, {row})', CELL(), 'The same, from a cell number (a keyboard or gamepad cursor).', GRIDA);
A('grid.deselect', 'world', 'Deselect grid piece', 'Deselect grid piece', [], 'Nothing selected, no highlights.', GRIDA);
A('grid.move_piece', 'world', 'Move piece on grid', 'Move {Self} to grid cell ({col}, {row})', CELL(), 'Moves this piece by its own movement rules (for scripted turns). Refused cells fire On grid move rejected.', { ...OBJ, ...GRIDA });
A('grid.end_turn', 'world', 'End grid turn', 'End the current grid turn', [], 'Ends the player\'s turn without a move (a pass), or finishes a scripted enemy turn.', GRIDA);
A('grid.set_blocked', 'world', 'Set grid cell blocked', 'Grid cell ({col}, {row}) blocked: {blocked}', [...CELL(), p('blocked', 'Blocked', 'boolean', true)], 'Closes or opens a cell.', GRIDA);
A('grid.place_piece', 'world', 'Place piece on grid', 'Place {Self} on grid cell ({col}, {row})', CELL(), 'Puts the piece straight there, not a turn.', { ...OBJ, ...GRIDA });
A('grid.set_range', 'world', 'Set piece range', '{Self} grid range {value}', [ex('value', 'Cells', '3')], 'How many cells this piece can go.', { ...OBJ, ...GRIDA });
// Lock-On / Dash Attack (runtime/lockon.ts). The character (Self) holds the lock; its target is picked too in the triggers.
const LOCK = { ...OBJ, apps: GC };
const LOCKT = { ...T, ...LOCK };
const VAL = (label: string, def: string) => [ex('value', label, def)];
const ONOFF = (label: string, def = true) => [p('on', label, 'boolean', def)];
C('lockon.on_target_acquired', 'combat', 'On target acquired', 'On {Self} target acquired', [], 'This character locked onto a target when it had none (the target is picked too).', LOCKT);
C('lockon.on_target_lost', 'combat', 'On target lost', 'On {Self} target lost', [], 'The lock ended: the target died, was removed, went out of range or out of sight, or Clear target ran.', LOCKT);
C('lockon.on_target_changed', 'combat', 'On target changed', 'On {Self} target changed', [], 'The lock moved from one target to another (Switch target, Set target).', LOCKT);
C('lockon.on_dash_started', 'combat', 'On dash started', 'On {Self} dash started', [], 'A Dash to target began.', LOCKT);
C('lockon.on_dash_completed', 'combat', 'On dash completed', 'On {Self} dash completed', [], 'The dash reached attack distance from the target.', LOCKT);
C('lockon.on_dash_cancelled', 'combat', 'On dash cancelled', 'On {Self} dash cancelled', [], 'The dash ended early: Cancel dash, the target was lost, a wall stopped it, or it ran out of time or distance.', LOCKT);
C('lockon.on_attack_started', 'combat', 'On attack started', 'On {Self} lock-on attack started', [], 'The attack at the end of a dash begins (play its animation here).', LOCKT);
C('lockon.on_attack_hit', 'combat', 'On attack hit', 'On {Self} lock-on attack hit', [], 'The attack hit the target.', LOCKT);
C('lockon.on_attack_missed', 'combat', 'On attack missed', 'On {Self} lock-on attack missed', [], 'The target was no longer in reach or in sight when the attack came.', LOCKT);
C('lockon.on_attack_completed', 'combat', 'On attack completed', 'On {Self} lock-on attack completed', [], 'The attack is over, hit or missed.', LOCKT);
C('lockon.is_valid', 'combat', 'Is target valid', '{Self} has a valid target', [], 'True while the lock holds a living target.', LOCK);
C('lockon.current_target', 'combat', 'Get current target', '{Self} is locked onto a {type} (pick it)', [p('type', 'Target object', 'objectType', 'Enemy')], 'True when the current target is of this object type, and picks it, so the actions here work on the target.', LOCK);
C('lockon.is_dashing', 'combat', 'Is dashing', '{Self} is dashing to its target', [], 'True while a Dash to target is under way.', LOCK);
C('lockon.dash_ready', 'combat', 'Dash is ready', '{Self} can dash', [], 'True when a dash would start: there is a target, no dash under way, and the cooldown is over.', LOCK);
C('lockon.compare_distance', 'combat', 'Distance to target', 'Distance from {Self} to its target {op} {value}', [p('op', 'Comparison', 'compare', '<'), ex('value', 'Metres', '5')], 'Compares the distance along the ground to the current target. False with no target.', LOCK);
A('lockon.acquire', 'combat', 'Acquire target', '{Self} acquire target: {targets} (tag {tag})', [ot('targets', 'Target object', 'Enemy'), p('tag', 'Only with tag (optional)', 'text', '')], 'Locks onto the best target of this type within range, view angle and line of sight, by the target priority. Nothing in reach: the lock stays as it was. The tag lets you pick by team or faction.', LOCK);
A('lockon.click_target', 'combat', 'Lock onto clicked target', '{Self} lock onto the clicked {targets} (dash: {dash})', [ot('targets', 'Target object', 'Enemy'), p('dash', 'Dash to it and attack', 'boolean', true)], 'Use with On mouse click: locks onto the object of this type under the cursor (the red circle appears), within the target range, and dashes to it. A click on nothing does nothing. In first person, the cursor is the middle of the screen.', LOCK);
A('lockon.set_target', 'combat', 'Set lock-on target', '{Self} lock onto {other}', [ot('other', 'Target object', 'Enemy')], 'Locks onto a picked object directly (range and view angle are not checked).', LOCK);
A('lockon.clear', 'combat', 'Clear target', '{Self} clear target', [], 'Ends the lock; a dash under way is cancelled.', LOCK);
A('lockon.switch', 'combat', 'Switch target', '{Self} switch target: {direction}', [p('direction', 'Direction', 'choice', 'next', { options: ['next', 'previous'] })], 'Moves the lock to the next candidate around the view.', LOCK);
A('lockon.set_priority', 'combat', 'Set target priority', '{Self} target priority {priority}', [p('priority', 'Priority', 'choice', 'nearest', { options: ['nearest', 'most centred', 'lowest health', 'highest health'] })], 'Which candidate Acquire target prefers.', LOCK);
A('lockon.set_range', 'combat', 'Set target range', '{Self} target range {value} m', VAL('Range (m)', '15'), 'How far away a target can be acquired. The lock lets go at 1.25 times this.', LOCK);
A('lockon.set_angle', 'combat', 'Set target angle', '{Self} target angle {value}°', VAL('Angle (degrees)', '120'), 'The view cone targets are acquired in: the whole angle, centred on where the character looks. 360 = all around.', LOCK);
A('lockon.set_line_of_sight', 'combat', 'Set target line of sight', '{Self} needs line of sight: {on}', ONOFF('Needs line of sight'), 'On: no targets behind walls, and a target hidden for half a second is lost.', LOCK);
A('lockon.show_marker', 'combat', 'Show target marker', '{Self} show target marker', [], 'Shows the circle on the current target (shown by default).', LOCK);
A('lockon.hide_marker', 'combat', 'Hide target marker', '{Self} hide target marker', [], 'Hides the circle.', LOCK);
A('lockon.marker_color', 'combat', 'Set marker colour', '{Self} marker colour {color}', [p('color', 'Colour', 'color', '"#ff2a2a"')], 'The colour of the circle on the target.', LOCK);
A('lockon.marker_size', 'combat', 'Set marker size', '{Self} marker size {value}', VAL('Size (1 = the target\'s width)', '1'), 'The size of the circle.', LOCK);
A('lockon.marker_offset', 'combat', 'Set marker offset', '{Self} marker offset ({x}, {y}, {z})', [ex('x', 'X', '0'), ex('y', 'Y', '0.03'), ex('z', 'Z', '0')], 'Where the circle sits, from the bottom middle of the target.', LOCK);
A('lockon.marker_animation', 'combat', 'Set marker animation', '{Self} marker animation {animation}', [p('animation', 'Animation', 'choice', 'pulse', { options: ['pulse', 'spin', 'none'] })], 'How the circle moves.', LOCK);
A('lockon.dash', 'combat', 'Dash to target', '{Self} dash to target', [], 'Dashes to the current target through collisions (never through walls), stopping at attack distance. Does nothing with no target, during a dash, or during the cooldown.', LOCK);
A('lockon.set_dash_speed', 'combat', 'Set dash speed', '{Self} dash speed {value} m/s', VAL('Speed (m/s)', '18'), 'How fast the dash moves.', LOCK);
A('lockon.set_dash_duration', 'combat', 'Set dash duration', '{Self} dash lasts at most {value} s', VAL('Longest (s)', '0.8'), 'A dash that has not arrived by then is cancelled.', LOCK);
A('lockon.set_dash_distance', 'combat', 'Set dash distance', '{Self} dash goes at most {value} m', VAL('Longest (m)', '16'), 'A dash that has not arrived after this far is cancelled.', LOCK);
A('lockon.set_attack_distance', 'combat', 'Set attack distance', '{Self} attack distance {value} m', VAL('Distance (m)', '1.6'), 'The dash stops this far from the target, and the attack reaches a little further.', LOCK);
A('lockon.cancel_dash', 'combat', 'Cancel dash', '{Self} cancel dash', [], 'Stops the dash where it is (the cooldown keeps running).', LOCK);
A('lockon.set_dash_cooldown', 'combat', 'Set dash cooldown', '{Self} dash cooldown {value} s', VAL('Cooldown (s)', '1'), 'Time from the start of one dash until the next can start.', LOCK);
A('lockon.attack_on_arrival', 'combat', 'Attack target on arrival', '{Self} attack on arrival: {on}', ONOFF('Attack on arrival'), 'On: the dash ends in one attack on the target.', LOCK);
A('lockon.set_attack_damage', 'combat', 'Set attack damage', '{Self} attack damage {value}', VAL('Damage', '25'), 'How much health the attack takes.', LOCK);
A('lockon.set_attack_type', 'combat', 'Set attack type', '{Self} attack type {attack}', [p('attack', 'Type', 'choice', 'strike', { options: ['strike', 'sweep', 'knockback'] })], 'Strike: the target only. Sweep: every object of its type in reach. Knockback: the target, and it is thrown back.', LOCK);
A('lockon.set_attack_repeat', 'combat', 'Set attack repeat', '{Self} repeat attacks: {on} every {every} s', [...ONOFF('Repeat', false), ex('every', 'Every (s)', '0.6')], 'Off (normal): one attack per dash. On: keeps attacking while the target stays in reach.', LOCK);
C('platform.on_jump', 'movement', 'On jump', '{Self} on jump', [], 'Runs when a Platform character jumps.', { ...T, ...OBJ, behavior: 'platform', c2: 'Platform: On jump' });
C('platform.on_landed', 'movement', 'On landed', '{Self} on landed', [], 'Runs when a Platform character lands.', { ...T, ...OBJ, behavior: 'platform', c2: 'Platform: On landed' });
C('car.on_hit', 'movement', 'On car hit', '{Self} hit an obstacle', [], 'Runs when a Car hits a solid at speed.', { ...T, ...OBJ, behavior: 'car' });
C('bullet.on_hit_solid', 'physics', 'On bullet hit solid', '{Self} hit a solid', [], 'Runs when a Bullet hits a solid (just before it is destroyed).', { ...T, ...OBJ, behavior: 'bullet' });
C('physics.on_impact', 'physics', 'On impact', '{Self} on impact', [], 'Runs when a physics body hits something hard.', { ...T, ...OBJ, behavior: 'physics' });
C('pathfinding.on_arrived', 'ai', 'On arrived', '{Self} on arrived', [], 'Runs when a Pathfinding object reaches the end of its path.', { ...T, ...OBJ, behavior: 'pathfinding', c2: 'Pathfinding: On arrived' });
C('pathfinding.on_path_found', 'ai', 'On path found', '{Self} on path found', [], 'Runs when Find path succeeds.', { ...T, ...OBJ, behavior: 'pathfinding', c2: 'Pathfinding: On path found' });
C('pathfinding.on_failed', 'ai', 'On failed to find path', '{Self} on failed to find path', [], 'Runs when no route exists.', { ...T, ...OBJ, behavior: 'pathfinding', c2: 'Pathfinding: On failed to find path' });
C('timer.on_timer', 'timers', 'On timer', 'On {Self} timer "{tag}"', [p('tag', 'Tag', 'text', 'tick')], 'Runs when a named timer started with "Start timer" finishes.', { ...T, ...OBJ, behavior: 'timer', c2: 'Timer: On timer' });
C('anim.on_finished', 'animation', 'On animation finished', 'On {Self} animation "{name}" finished', [p('name', 'Animation', 'text', 'dig')], 'Runs when a non-looping animation finishes.', { ...T, ...OBJ, c2: 'Sprite: On animation finished' });
C('ui.on_button_clicked', 'ui', 'On button clicked', 'On button "{button}" clicked', [p('button', 'Button name', 'text', 'Restart')], 'Runs when a HUD button (text object marked as button) or screen button is clicked.', { ...T, c2: 'Button: On clicked' });
C('function.on_function', 'functions', 'On function', 'On function {name}', [p('name', 'Function name', 'function', 'myFunction')], 'Defines a function. Its actions run when "Call function" is used. Read parameters with param(0), param(1)...', { ...T, c2: 'Function: On function', codegen: true });

// ---------------- Input ----------------
C('input.on_key_pressed', 'input', 'On key pressed', 'On {key} pressed', [p('key', 'Key', 'key', 'Space')], 'Runs once when the key goes down.', { ...T, c2: 'Keyboard: On key pressed', codegen: true });
C('input.on_key_released', 'input', 'On key released', 'On {key} released', [p('key', 'Key', 'key', 'Space')], 'Runs once when the key is released.', { ...T, c2: 'Keyboard: On key released', codegen: true });
C('input.key_is_down', 'input', 'Key is held down', '{key} is held down', [p('key', 'Key', 'key', 'ArrowRight')], 'HELD: true on every frame while the key is down (use for continuous things like walking). For one-shot actions use "Key was just pressed".', { c2: 'Keyboard: Key is down', codegen: true });
C('input.key_pressed', 'input', 'Key was just pressed', '{key} was just pressed', [p('key', 'Key', 'key', 'Space')], 'PRESSED: true only on the single frame the key goes from up to down (jump, shoot, open a menu). Holding the key does not repeat it. Works inside any event, unlike the "On key pressed" trigger.', { c2: 'Keyboard: On key pressed (as a condition)' });
C('input.key_released', 'input', 'Key was just released', '{key} was just released', [p('key', 'Key', 'key', 'Space')], 'RELEASED: true only on the single frame the key goes from down to up (charge-and-release attacks, variable jump height).', { c2: 'Keyboard: On key released (as a condition)' });
C('input.mouse_pressed', 'input', 'Mouse button was just pressed', '{button} mouse button was just pressed', [p('button', 'Button', 'mouse', 'left')], 'PRESSED: true only on the frame the mouse button goes down.', {});
C('input.mouse_released', 'input', 'Mouse button was just released', '{button} mouse button was just released', [p('button', 'Button', 'mouse', 'left')], 'RELEASED: true only on the frame the mouse button goes up.', {});
C('input.on_mouse_released', 'input', 'On mouse released', 'On {button} released', [p('button', 'Button', 'mouse', 'left')], 'Runs once when a mouse button is released.', T);
C('input.gamepad_pressed', 'input', 'Gamepad button was just pressed', 'Gamepad {button} was just pressed', [p('button', 'Button', 'choice', 'A', { options: PAD_BUTTONS })], 'PRESSED: true only on the frame the gamepad button goes down (first connected gamepad, standard layout: A/B/X/Y, LB/RB, LT/RT, D-pad).', {});
C('input.gamepad_down', 'input', 'Gamepad button is held', 'Gamepad {button} is held', [p('button', 'Button', 'choice', 'A', { options: PAD_BUTTONS })], 'HELD: true every frame while the gamepad button is down.', {});
C('input.gamepad_released', 'input', 'Gamepad button was just released', 'Gamepad {button} was just released', [p('button', 'Button', 'choice', 'A', { options: PAD_BUTTONS })], 'RELEASED: true only on the frame the gamepad button goes up.', {});
C('input.gamepad_connected', 'input', 'Gamepad is connected', 'A gamepad is connected', [], 'True while a gamepad is plugged in (press any button once so the browser reports it).', {});
C('input.action_began', 'input', 'Input action began', 'Action {action} began for {player}', [p('action', 'Action', 'text', 'Jump'), p('player', 'Player', 'choice', 'any player', { options: PLAYER_CHOICES })], 'PRESSED: true on the frame any binding of the action is pressed (an action groups keys, mouse and gamepad buttons, e.g. Jump = Space or pad A). Edit actions in Project settings.', {});
C('input.action_held', 'input', 'Input action is held', 'Action {action} is held by {player}', [p('action', 'Action', 'text', 'Jump'), p('player', 'Player', 'choice', 'any player', { options: PLAYER_CHOICES })], 'HELD: true while any binding of the action is down.', {});
C('input.action_ended', 'input', 'Input action ended', 'Action {action} ended for {player}', [p('action', 'Action', 'text', 'Jump'), p('player', 'Player', 'choice', 'any player', { options: PLAYER_CHOICES })], 'RELEASED: true on the frame the last held binding of the action is released.', {});
C('input.on_device_changed', 'input', 'On input device changed', 'When the player switches to {device}', [p('device', 'Device', 'choice', 'any', { options: ['any', 'keyboard', 'mouse', 'gamepad', 'touch'] })], 'Fires when the player starts using another kind of device (switch button prompts, show or hide touch controls). The current one is the expression inputdevice. Device-free values for your logic: movex / movey (movement vector, -1..1, from keys, sticks, touch stick or VR stick), lookx / looky (look vector), actionvalue("Gas") (an action\'s analog amount; actionvalue("Gas", 2) for local player 2). Button prompts: prompt("Jump") is the button to show for the device in use (Space, A, Cross on PlayStation, B on Nintendo, the touch button); in a text, {Jump} is replaced the same way ("Press {Jump} to start").', { ...T });
C('touch.on_gesture', 'input', 'On touch gesture', 'On {gesture}', [p('gesture', 'Gesture', 'choice', 'double tap', { options: ['tap', 'double tap', 'long press', 'drag start', 'drag end', 'pinch', 'two-finger pan'] })], 'Touch screens: a finger on the free part of the screen (not on a touch control). Pinch: the expression pinch is how much the fingers spread this tick (+ zoom in); two-finger pan: panx / pany. Drag: touchx / touchy is the finger. Timing is set in Input › Touch controls.', { ...T });
C('touch.on_object', 'input', 'On object touched', 'On {Self} {state}', [p('state', 'State', 'choice', 'touched', { options: ['touched', 'released', 'held', 'double-tapped'] })], 'A finger on this object: touched (finger down), released (finger up), held (long press — pick it up, open a menu), double-tapped. Several fingers can touch several objects at once.', { ...T, ...OBJ });
C('touch.is_touching', 'input', 'Screen is touched', '{count}+ fingers on the screen', [ex('count', 'Fingers', '1')], 'True while at least this many fingers touch the screen (touchcount is the number; touchx / touchy the first finger).', {});
C('input.on_device_connected', 'input', 'On input device connected', 'When {device} is connected', [p('device', 'Device', 'choice', 'any', { options: ['any', 'gamepad', 'gamepad 1', 'gamepad 2', 'gamepad 3', 'gamepad 4', 'vr'] })], 'Fires when a gamepad is plugged in (or wakes up) or a VR headset starts. Use it to add a player or switch prompts.', { ...T });
C('input.on_device_disconnected', 'input', 'On input device disconnected', 'When {device} is disconnected', [p('device', 'Device', 'choice', 'any', { options: ['any', 'gamepad', 'gamepad 1', 'gamepad 2', 'gamepad 3', 'gamepad 4', 'vr'] })], 'Fires when a gamepad is unplugged or the VR headset is taken off: a good moment to pause.', { ...T });
A('input.set_binding', 'input', 'Set input binding', '{how} {binding} for action {action}', [p('how', 'How', 'choice', 'replace', { options: ['replace', 'add', 'remove'] }), p('action', 'Action', 'text', 'Jump'), p('binding', 'Binding', 'text', 'Space')], 'Rebind controls while playing (an options menu): "replace" makes it the only binding, "add" adds another, "remove" takes one away. Bindings look like Space, mouse:left, pad:A, axis:LeftX-, touch:Jump, xr:right:trigger.', {});
A('input.enable_device', 'input', 'Enable / disable input device', 'Turn {device} input {state}', [p('device', 'Device', 'choice', 'touch', { options: ['keyboard', 'mouse', 'gamepad', 'touch', 'vr'] }), p('state', 'State', 'choice', 'off', { options: ['on', 'off'] })], 'Ignore a kind of device (e.g. keyboard off while a gamepad player is in a menu). Everything bound to it reads as not pressed.', {});
A('input.change_profile', 'input', 'Change input profile', 'Use input profile {profile} for {player}', [p('profile', 'Profile', 'text', 'Left-handed'), p('player', 'Player', 'choice', 'every player', { options: PROFILE_PLAYERS })], 'Switch to a control layout saved in the Input editor › Profiles. Every player: its bindings replace those actions. One player: only that player\'s controls change (local multiplayer: each player keeps their own layout and feel).', {});
C('input.device_is', 'input', 'Input device is', 'Player is using {device}', [p('device', 'Device', 'choice', 'gamepad', { options: ['keyboard', 'mouse', 'gamepad', 'touch'] })], 'True while the last input came from this kind of device.', {});
A('input.set_context', 'input', 'Set input context', 'Turn input context {context} {state}', [p('context', 'Context', 'text', 'Menu'), p('state', 'State', 'choice', 'on', { options: ['on', 'off', 'only'] })], 'Input contexts group actions (Gameplay, Menu, Vehicle…): an action in contexts works only while one of them is on. "only" turns every other context off (open a menu, leave gameplay controls behind). Edit contexts in Input actions.', {});
C('input.axis_compare', 'input', 'Compare input axis', 'Axis {axis} {op} {value}', [p('axis', 'Axis', 'choice', 'Horizontal', { options: AXES }), cmp(), ex('value', 'Threshold (-1 … 1)', '0.5')], 'Analog input crossing a threshold. Horizontal/Vertical combine arrows, WASD and the left stick; LeftX/Y, RightX/Y are sticks; Triggers is RT minus LT. Also readable in expressions as Input.Horizontal etc.', {});
C('input.on_mouse_click', 'input', 'On mouse click', 'On {button} click', [p('button', 'Button', 'mouse', 'left')], 'Runs when a mouse button is pressed. Mouse.X/Y/Z give the cursor position in the world.', { ...T, c2: 'Mouse: On click' });
A('input.set_cursor', 'input', 'Set mouse cursor', 'Set mouse cursor {mode}', [p('mode', 'Cursor', 'choice', 'locked', { options: ['visible', 'hidden', 'locked'] })], 'visible: normal cursor. hidden: invisible over the game. locked: invisible and held in the center (mouse look; Esc releases it, clicking the game locks it again).', { c2: 'Mouse: Set cursor style / Pointer lock' });
C('input.cursor_is_locked', 'input', 'Mouse is locked', 'Mouse cursor is locked', [], 'True while the mouse is captured by the game.', { c2: 'Mouse: Is pointer locked' });
C('input.mouse_is_down', 'input', 'Mouse button is down', '{button} mouse button is down', [p('button', 'Button', 'mouse', 'left')], 'True while the mouse button is held.', { c2: 'Mouse: Mouse button is down' });

// ---------------- Conditions ----------------
C('system.if', 'conditions', 'If', 'If {condition}', [ex('condition', 'Condition', 'score > 10')], 'True when the expression is true. Supports and, or, not, =, <>, <, >, <=, >=.', { codegen: true });
C('system.compare_values', 'conditions', 'Compare two values', '{a} {op} {b}', [ex('a', 'First value', '0'), cmp(), ex('b', 'Second value', '0')], 'Compares two expressions.', { c2: 'System: Compare two values', codegen: true });
C('system.compare_variable', 'conditions', 'Compare variable', '{variable} {op} {value}', [p('variable', 'Variable', 'variable', 'score'), cmp(), ex('value', 'Value', '0')], 'Compares a global or local variable (Variable equals value).', { c2: 'System: Compare variable', codegen: true });
C('system.is_boolean_set', 'conditions', 'Is variable true','{variable} is true', [p('variable', 'Boolean variable', 'variable', 'isPaused')], 'True if a boolean variable is true.', { c2: 'System: Is boolean set', codegen: true });
C('system.trigger_once', 'conditions', 'Only once when true','Trigger once', [], 'Makes the event run only the first tick its other conditions become true.', { c2: 'System: Trigger once while true' });
C('system.random_chance', 'conditions', 'Random chance', '{percent}% chance', [ex('percent', 'Chance (%)', '50')], 'True with the given probability (uses the seeded random generator).', { codegen: true });
C('system.object_exists', 'conditions', 'Object exists', '{object} exists', [ot('object', 'Object', 'Enemy')], 'True if at least one instance exists.', { codegen: true });
C('system.compare_count', 'conditions', 'Compare object count', 'Count of {object} {op} {value}', [ot('object', 'Object', 'Enemy'), cmp(), ex('value', 'Count', '0')], 'Compares how many instances of an object exist.', { codegen: true });
C('object.compare_property', 'conditions', 'Compare property', '{Self} {property} {op} {value}', [p('property', 'Property', 'choice', 'X', { options: PROPS }), cmp(), ex('value', 'Value', '0')], 'Picks instances whose property matches (Compare X, Compare Y...).', { ...OBJ, c2: 'Object: Compare X / Y / Angle / Opacity', codegen: true });
C('object.compare_var', 'conditions', 'Compare object variable','{Self}.{variable} {op} {value}', [p('variable', 'Instance variable', 'instanceVar', 'health'), cmp(), ex('value', 'Value', '0')], 'Picks instances whose instance variable matches.', { ...OBJ, c2: 'Object: Compare instance variable', codegen: true });
C('object.is_var_true', 'conditions', 'Is object variable true','{Self}.{variable} is true', [p('variable', 'Instance variable', 'instanceVar', 'active')], 'Picks instances whose boolean instance variable is true.', { ...OBJ, c2: 'Object: Is boolean instance variable set', codegen: true });
C('object.is_visible', 'conditions', 'Is visible', '{Self} is visible', [], 'Picks visible instances.', { ...OBJ, c2: 'Object: Is visible' });
C('object.is_overlapping', 'conditions', 'Is overlapping', '{Self} is overlapping {other}', [ot('other', 'Other object', 'Enemy')], 'Picks instances currently overlapping another object (Is colliding).', { ...OBJ, c2: 'Object: Is overlapping another object' });
C('object.is_within_distance', 'conditions', 'Is within distance', '{Self} is within {distance} of {other}', [ex('distance', 'Distance', '3'), ot('other', 'Other object', 'Player')], 'Picks instances within a planar distance of any instance of the other object.', OBJ);
C('object.is_moving', 'conditions', 'Is moving', '{Self} is moving', [], 'Picks instances whose speed is above 0.05 m/s.', { ...OBJ, c2: 'Platform/8Direction: Is moving' });
C('object.has_tag', 'conditions', 'Has tag', '{Self} has tag "{tag}"', [p('tag', 'Tag', 'text', 'enemy')], 'Picks instances that have a tag (Tags and groups).', OBJ);
C('object.pick_nearest', 'conditions', 'Pick nearest', 'Pick {Self} nearest to ({x}, {y}, {z})', [ex('x', 'X', 'Player.X'), ex('y', 'Y', 'Player.Y'), ex('z', 'Z', 'Player.Z')], 'Picks the single closest instance.', { ...OBJ, c2: 'Object: Pick nearest/furthest' });
C('object.pick_by_uid', 'conditions', 'Pick by UID', 'Pick {Self} with UID {uid}', [ex('uid', 'UID', '0')], 'Picks the instance with a unique ID (object reference).', { ...OBJ, c2: 'Object: Pick by unique ID' });
C('object.pick_random', 'conditions', 'Pick random instance', 'Pick a random {Self}', [], 'Picks one random instance.', { ...OBJ, c2: 'System: Pick random instance' });
C('object.pick_by_expression', 'conditions', 'Pick where…','Pick {Self} where {expression}', [ex('expression', 'Expression (use Self)', 'Self.X > 0')], 'Picks every instance for which the expression is true. Self is the instance being tested.', { ...OBJ, c2: 'System: Pick by evaluate' });
C('object.pick_all', 'conditions', 'Pick all', 'Pick all {Self}', [], 'Resets picking for this object so later conditions see every instance.', { ...OBJ, c2: 'System: Pick all' });
C('platform.is_on_floor', 'conditions', 'Is on floor', '{Self} is on floor', [], 'True when a Platform character is standing on a solid (Is grounded).', { ...OBJ, behavior: 'platform', c2: 'Platform: Is on floor' });
C('platform.is_jumping', 'conditions', 'Is jumping', '{Self} is jumping', [], 'True while moving upwards.', { ...OBJ, behavior: 'platform', c2: 'Platform: Is jumping' });
C('platform.is_falling', 'conditions', 'Is falling', '{Self} is falling', [], 'True while moving downwards in the air.', { ...OBJ, behavior: 'platform', c2: 'Platform: Is falling' });
C('physics.is_holding', 'physics', 'Is holding an object', '{Self} is holding an object', [], 'True if the object has grabbed something.', OBJ);
C('physics.detect_ground', 'physics', 'Detect ground', '{Self} has ground within {distance}', [ex('distance', 'Distance', '0.2')], 'Raycasts downward against solids.', OBJ);
C('physics.detect_wall', 'physics', 'Detect wall', '{Self} has wall within {distance} ahead', [ex('distance', 'Distance', '1')], 'Raycasts forward (along the angle) against solids.', OBJ);
C('physics.raycast', 'physics', 'Raycast hits', '{Self} raycast {distance} ahead hits {other}', [ex('distance', 'Distance', '20'), ot('other', 'Hit object', 'Enemy')], 'Casts a ray along the object angle. If the first thing hit is the other object, it is picked. Solids block the ray.', OBJ);
C('pathfinding.has_line_of_sight', 'ai', 'Has line of sight', '{Self} has line of sight to {other}', [ot('other', 'Other object', 'Player')], 'True if no solid blocks the straight line to the other object.', { ...OBJ, c2: 'Line of sight: Has LOS to object' });
C('health.compare_hp', 'combat', 'Compare health', '{Self} health {op} {value}', [cmp(), ex('value', 'Value', '0')], 'Has sufficient health? Compares current hit points.', { ...OBJ, behavior: 'health' });
C('health.is_dead', 'combat', 'Is dead', '{Self} is dead', [], 'True when health has reached 0.', { ...OBJ, behavior: 'health' });
C('timer.is_running', 'timers', 'Is timer running', '{Self} timer "{tag}" is running', [p('tag', 'Tag', 'text', 'tick')], 'Invert to test "Timer finished".', { ...OBJ, behavior: 'timer', c2: 'Timer: Is timer running' });
C('timer.every_x_seconds', 'timers', 'Every X seconds', 'Every {seconds} seconds', [ex('seconds', 'Seconds', '1')], 'True once every interval.', { c2: 'System: Every X seconds', codegen: true });
C('anim.is_playing', 'animation', 'Is animation playing', '{Self} animation "{name}" is playing', [p('name', 'Animation', 'text', 'walk')], 'True if the named animation is the current animation.', { ...OBJ, c2: 'Sprite: Is playing' });
C('list.contains', 'lists', 'List contains', '{variable} contains {value}', [p('variable', 'List variable', 'variable', 'inventory'), ex('value', 'Value', '"key"')], 'Has item? True if the list contains the value.', { codegen: true });

// ---------------- Loops ----------------
C('system.repeat', 'loops', 'Repeat', 'Repeat {count} times', [ex('count', 'Count', '10')], 'Repeats the rest of the event. loopindex gives the current iteration.', { looping: true, c2: 'System: Repeat', codegen: true });
C('system.while', 'loops', 'Repeat while', 'While {condition}', [ex('condition', 'Condition', 'i < 10')], 'Repeats the rest of the event while the expression is true (max 10 000 iterations per tick).', { looping: true, c2: 'System: While', codegen: true });
C('system.for', 'loops', 'For', 'For "{name}" from {start} to {end}', [p('name', 'Loop name', 'text', 'i'), ex('start', 'Start', '0'), ex('end', 'End', '9')], 'Counts from start to end inclusive. loopindex("name") gives the value.', { looping: true, c2: 'System: For', codegen: true });
C('system.for_each', 'loops', 'For each object', 'For each {object}', [ot('object', 'Object', 'Enemy')], 'Runs the rest of the event once per picked instance.', { looping: true, c2: 'System: For each', codegen: true });
C('system.for_each_ordered', 'loops', 'For each (ordered)', 'For each {object} ordered by {value} {order}', [ot('object', 'Object', 'Enemy'), ex('value', 'Order by', 'Self.X'), p('order', 'Order', 'choice', 'ascending', { options: ['ascending', 'descending'] })], 'Like For each, sorted by an expression evaluated per instance.', { looping: true, c2: 'System: For each (ordered)' });
C('list.for_each_item', 'loops', 'For each item', 'For each item in {variable}', [p('variable', 'List variable', 'variable', 'inventory')], 'Runs the rest of the event per list item. Use item() and loopindex.', { looping: true, codegen: true });
C('system.repeat_until', 'loops', 'Repeat until', 'Repeat until {condition}', [ex('condition', 'Condition', 'i >= 10')], 'Repeats the rest of the event until the expression is true, all within one frame (max 10 000 times). To wait across frames use "Wait until".', { looping: true, c2: 'System: While (inverted)' });
C('system.forever', 'loops', 'Forever', 'Forever', [], 'Runs the event every frame, like Scratch "forever" (the same as Every tick). Use per-second movement blocks inside it.', { c2: 'System: Every tick' });
A('system.wait', 'loops', 'Wait', 'Wait {seconds} seconds', [ex('seconds', 'Seconds', '1')], 'Pauses the remaining actions and sub-events of this event, keeping picked objects, then continues.', { c2: 'System: Wait' });
A('system.wait_until', 'loops', 'Wait until', 'Wait until {condition}', [ex('condition', 'Condition', 'Player.X > 5')], 'Pauses the remaining actions and sub-events of this event until the expression becomes true (checked every frame), then continues.', { c2: 'System: Wait for signal / condition' });
A('system.stop_loop', 'loops', 'Stop loop', 'Stop loop', [], 'Ends the current Repeat / For / While loop after this iteration (Break).', { c2: 'System: Stop loop', codegen: true });

// ---------------- Variables ----------------
A('var.set', 'variables', 'Set value', 'Set {variable} to {value}', [p('variable', 'Variable', 'variable', 'score'), ex('value', 'Value', '0')], 'Sets a global or local variable.', { c2: 'System: Set value', codegen: true });
A('var.add', 'variables', 'Add to', 'Add {value} to {variable}', [p('variable', 'Variable', 'variable', 'score'), ex('value', 'Value', '1')], 'Adds to a number variable.', { c2: 'System: Add to', codegen: true });
A('var.subtract', 'variables', 'Subtract from', 'Subtract {value} from {variable}', [p('variable', 'Variable', 'variable', 'score'), ex('value', 'Value', '1')], 'Subtracts from a number variable.', { c2: 'System: Subtract from', codegen: true });
A('var.toggle', 'variables', 'Flip true/false','Toggle {variable}', [p('variable', 'Boolean variable', 'variable', 'isPaused')], 'Flips a boolean variable.', { c2: 'System: Toggle boolean', codegen: true });
A('object.set_var', 'variables', 'Set object variable','Set {Self}.{variable} to {value}', [p('variable', 'Instance variable', 'instanceVar', 'health'), ex('value', 'Value', '0')], 'Sets an instance variable on each picked instance.', { ...OBJ, c2: 'Object: Set instance variable', codegen: true });
A('object.add_var', 'variables', 'Add to object variable','Add {value} to {Self}.{variable}', [p('variable', 'Instance variable', 'instanceVar', 'health'), ex('value', 'Value', '1')], 'Adds to an instance variable.', { ...OBJ, c2: 'Object: Add to instance variable', codegen: true });
A('object.toggle_var', 'variables', 'Flip object variable','Toggle {Self}.{variable}', [p('variable', 'Instance variable', 'instanceVar', 'active')], 'Flips a boolean instance variable.', { ...OBJ, codegen: true });
A('game.save', 'variables', 'Save variables', 'Save variables to slot "{slot}"', [p('slot', 'Slot', 'text', 'save1'), p('only', 'Only these (comma list, empty = all)', 'text', '')], 'Saves the global variables (all of them, or only the ones listed: e.g. volume, music, quality for an options menu, so loading them never rolls back the score).', { c2: 'System: Save' });
A('game.save_game', 'game', 'Save game', 'Save the game in slot "{slot}"', [ex('slot', 'Slot', '"save1"')], 'Saves the whole game: the scene, global variables and every game object as it is now (position, rotation, size, speed, variables, behavior settings, health…), kept between sessions on this device. Screen texts and buttons (menus) are not saved. Fires On game saved.', {});
A('game.load_game', 'game', 'Load game', 'Load the game from slot "{slot}"', [ex('slot', 'Slot', '"save1"')], 'Puts the game back as it was saved: switches to the saved scene if it is another one, restores the global variables and the game objects. Fires On game loaded. An empty slot is reported and nothing changes.', {});
A('object.cut_hole', 'objects', 'Cut hole', 'Cut a {shape} hole {size} m in {Self} at {x}, {y}, {z}', [p('shape', 'Shape', 'choice', 'sphere', { options: ['sphere', 'box', 'cylinder'] }), ex('size', 'Size (m)', '0.3'), ex('x', 'X', 'Self.X'), ex('y', 'Y', 'Self.Y'), ex('z', 'Z', 'Self.Z')], 'Boolean while playing: really cuts the mesh (see-through holes in thin walls, craters in thick ones), like Blender\'s Boolean Difference. Holes move with the object; the newest 48 are kept. A box-collision wall also gets collision around box-shaped holes (round holes count as their square), so a big enough hole can be walked through. Fire hitscan with Bullet holes = cut hole does this where bullets land.', { ...OBJ, apps: GC });
A('audio.set_category_volume', 'audio', 'Set category volume', 'Set {category} volume to {volume}%', [p('category', 'Category', 'choice', 'music', { options: ['music', 'sfx', 'ui', 'ambience'] }), ex('volume', 'Volume (0-100)', '80')], 'The player\'s own volume for one kind of sound (an options menu: Music, Sound effects, Interface, Ambience), on top of the mix set in the Sound panel. Music already playing changes at once.', {});
A('game.set_quality', 'game', 'Set graphics quality', 'Set graphics quality to {quality}', [p('quality', 'Quality', 'choice', 'high', { options: ['low', 'medium', 'high', 'ultra'] })], 'Shadow quality and resolution, for an options menu (low runs faster on weak computers and phones). Same presets as Preferences › Rendering.', { apps: GC });
A('game.set_fullscreen', 'game', 'Set full screen', 'Full screen {state}', [p('state', 'State', 'choice', 'toggle', { options: ['on', 'off', 'toggle'] })], 'Full screen on or off (a button in an options menu; browsers only allow it right after a click or key press).', {});
A('game.quit', 'game', 'Quit game', 'Quit the game', [], 'Closes the game: the Windows player app exits; in the editor, play stops. In a web browser (or the Android app) a page cannot close itself, so the game goes back to its start (the title screen). Save first if progress should be kept.', {});
C('game.has_save', 'game', 'Has saved game', 'Slot "{slot}" has a saved game', [ex('slot', 'Slot', '"save1"')], 'True when the slot holds a saved game (show a Continue button only then).', {});
A('game.delete_save', 'game', 'Delete saved game', 'Delete the saved game in slot "{slot}"', [ex('slot', 'Slot', '"save1"')], 'Empties the slot (New game, or after a permadeath).', {});
C('game.on_game_saved', 'game', 'On game saved', 'When the game is saved', [], 'Fires after Save game (show "Game saved").', { ...T });
C('game.on_game_loaded', 'game', 'On game loaded', 'When a saved game is loaded', [], 'Fires after Load game has put the objects back (also after it switched scene).', { ...T });
A('game.load', 'variables', 'Load variables', 'Load variables from slot "{slot}"', [p('slot', 'Slot', 'text', 'save1'), p('only', 'Only these (comma list, empty = all)', 'text', '')], 'Loads global variables saved with "Save variables" (all in the slot, or only the ones listed).', { c2: 'System: Load' });
A('system.log', 'variables', 'Log to console', 'Log {message}', [ex('message', 'Message', '"Hello"')], 'Writes to the console. Great for debugging.', { c2: 'Browser: Log in console', codegen: true });

// ---------------- Lists ----------------
C('vr.on_teleported', 'vr', 'On teleported', 'When {Self} teleported', [], 'Fires after the VR player jumps to the teleport target.', { ...T, ...OBJ, behavior: 'vrplayer', apps: GC });
C('vr.on_grabbed', 'vr', 'On grabbed', 'When {Self} grabbed something', [], 'Fires when the VR player picks up a Physics object with either hand (the object is picked as well).', { ...T, ...OBJ, behavior: 'vrplayer', apps: GC });
C('vr.on_released', 'vr', 'On released', 'When {Self} let go of something', [], 'Fires when the VR player opens a hand and lets an object go (thrown with the motion of the hand).', { ...T, ...OBJ, behavior: 'vrplayer', apps: GC });
C('vr.is_active', 'vr', 'Is in VR', 'Playing in a VR headset', [], 'True while the game runs in a headset (not in the desktop preview).', { apps: GC });
A('vr.vibrate', 'vr', 'Vibrate controller', 'Vibrate {hand} controller at {strength} for {seconds} s', [p('hand', 'Hand', 'choice', 'right', { options: ['left', 'right', 'both'] }), ex('strength', 'Strength (0–1)', '0.6'), ex('seconds', 'Seconds', '0.1')], 'Haptic feedback: a buzz in the controller (hits, pickups, recoil). Scaled by Project settings › VR › Haptics strength; nothing happens without a headset.', { apps: GC });
// ---- Random (seeded: the same seed gives the same numbers, positions and choices every play)
A('random.set_seed', 'random', 'Set random seed', 'Set random seed to {seed}', [ex('seed', 'Seed', '12345')], 'Restarts the random numbers from this seed: everything random after it (numbers, choices, positions, generated rooms) comes out the same every play. Use it for daily challenges or levels players can share by number.');
A('random.randomize_seed', 'random', 'Randomize seed', 'Randomize seed', [], 'Picks a new seed from the clock so this play differs from the last. The seed in use is the expression randomseed (show it so players can share a run).');
A('random.number', 'random', 'Random number', 'Set {variable} to a random {kind} from {min} to {max}', [p('variable', 'Variable', 'variable', 'roll'), p('kind', 'Kind', 'choice', 'integer', { options: ['integer', 'decimal'] }), ex('min', 'From', '1'), ex('max', 'To', '6')], 'Integer: a whole number from From to To, both included (1 to 6 = a die). Decimal: any number from From up to To.');
A('random.choose', 'random', 'Choose from list', 'Set {variable} to a random item of {list}', [p('variable', 'Variable', 'variable', 'pick'), p('list', 'List variable', 'variable', 'items')], 'Picks one item of a list variable at random (empty list: an empty text).');
A('random.choose_values', 'random', 'Choose from values', 'Set {variable} to one of {values}', [p('variable', 'Variable', 'variable', 'pick'), ex('values', 'Values (comma separated)', '"red", "green", "blue"')], 'Picks one of the values at random.');
A('random.position', 'random', 'Random position in area', '{Self} go to a random position between ({x1}, {y1}, {z1}) and ({x2}, {y2}, {z2})', [ex('x1', 'From X', '-5'), ex('y1', 'From Y', '0'), ex('z1', 'From Z', '-5'), ex('x2', 'To X', '5'), ex('y2', 'To Y', '0'), ex('z2', 'To Z', '5')], 'Moves the object to a random point inside the box between the two corners (use the same height twice to stay on the ground).', { ...OBJ });
A('random.rotation', 'random', 'Random rotation', '{Self} turn to a random {axis} angle from {min}° to {max}°', [p('axis', 'Axis', 'choice', 'heading', { options: ['heading', 'all axes', 'x', 'y', 'z'] }), ex('min', 'From (°)', '0'), ex('max', 'To (°)', '360')], 'Heading = the turn on the ground (2D: the angle). All axes tumbles it (3D).', { ...OBJ });
A('list.push', 'lists', 'Add item', 'Add {value} to list {variable}', [p('variable', 'List variable', 'variable', 'inventory'), ex('value', 'Value', '"key"')], 'Appends to the end of a list.', { c2: 'Array: Push back', codegen: true });
A('list.set_at', 'lists', 'Set item', 'Set {variable}[{index}] to {value}', [p('variable', 'List variable', 'variable', 'inventory'), ex('index', 'Index', '0'), ex('value', 'Value', '0')], 'Replaces an item (0-based).', { c2: 'Array: Set at X', codegen: true });
A('list.remove_at', 'lists', 'Remove item', 'Remove item {index} from {variable}', [p('variable', 'List variable', 'variable', 'inventory'), ex('index', 'Index', '0')], 'Removes an item by index.', { c2: 'Array: Delete', codegen: true });
A('list.remove_value', 'lists', 'Remove value', 'Remove {value} from {variable}', [p('variable', 'List variable', 'variable', 'inventory'), ex('value', 'Value', '"key"')], 'Removes the first matching item.', { codegen: true });
A('list.clear', 'lists', 'Clear list', 'Clear {variable}', [p('variable', 'List or dictionary', 'variable', 'inventory')], 'Removes every item.', { c2: 'Array: Clear', codegen: true });
A('dict.set', 'lists', 'Set key', 'Set {variable}[{key}] to {value}', [p('variable', 'Dictionary variable', 'variable', 'stats'), ex('key', 'Key', '"name"'), ex('value', 'Value', '0')], 'Adds or replaces a dictionary key.', { c2: 'Dictionary: Add key', codegen: true });
A('dict.delete', 'lists', 'Delete key', 'Delete key {key} from {variable}', [p('variable', 'Dictionary variable', 'variable', 'stats'), ex('key', 'Key', '"name"')], 'Removes a dictionary key.', { c2: 'Dictionary: Delete key', codegen: true });

// ---------------- Functions ----------------
A('function.call', 'functions', 'Call function', 'Call {name}({args})', [p('name', 'Function', 'function', 'myFunction'), p('args', 'Parameters (comma separated expressions)', 'expr', '')], 'Runs every "On function" event with this name, immediately. Use call("name", ...) in expressions to get a return value.', { c2: 'Function: Call function', codegen: true });
A('function.set_return', 'functions', 'Set return value', 'Return {value}', [ex('value', 'Value', '0')], 'Sets the value returned to call(...).', { c2: 'Function: Set return value', codegen: true });
A('system.signal', 'functions', 'Trigger custom event', 'Trigger custom event {name}', [p('name', 'Event name', 'text', 'my_event')], 'Runs every "On custom event" with the same name.', { c2: 'System: Signal', codegen: true });

// ---------------- Objects ----------------
A('object.create', 'objects', 'Create object', 'Create {object} at ({x}, {y}, {z})', [ot('object', 'Object', 'Coin'), ex('x', 'X'), ex('y', 'Y'), ex('z', 'Z')], 'Creates a new instance. It becomes the picked instance for the following actions.', { c2: 'System: Create object', codegen: true });
A('object.create_by_name', 'objects', 'Create object by name', 'Create object named {name} at ({x}, {y}, {z}) attached to {attach}', [ex('name', 'Object name', '"Room" & int(random(1, 4))'), ex('x', 'X'), ex('y', 'Y'), ex('z', 'Z'), p('attach', 'Attach to (optional object type)', 'text', '')], 'Creates an instance of the object type whose name is computed by an expression (for example a random room). It becomes the picked instance of that type. If "Attach to" names a type, the new object is attached to its picked instance (it moves with it and is destroyed with it).', { c2: 'System: Create object (by name)' });
A('object.spawn', 'objects', 'Spawn another object', '{Self} spawn {object} (forward {offset})', [ot('object', 'Object', 'Bullet'), ex('offset', 'Forward offset', '0.8')], 'Creates an object at this object, facing the same way.', { ...OBJ, c2: 'Object: Spawn another object' });
A('object.destroy', 'objects', 'Destroy', 'Destroy {Self}', [], 'Removes the picked instances (and their children).', { ...OBJ, c2: 'Object: Destroy', codegen: true });
A('object.set_visible', 'objects', 'Set visible', 'Set {Self} {visible}', [p('visible', 'Visibility', 'choice', 'visible', { options: ['visible', 'invisible', 'toggle'] })], 'Shows or hides the object.', { ...OBJ, c2: 'Object: Set visible' });
A('object.set_opacity', 'objects', 'Set opacity', 'Set {Self} opacity to {value}', [ex('value', 'Opacity (0-100)', '100')], 'Sets transparency (0 = invisible, 100 = solid).', { ...OBJ, c2: 'Object: Set opacity' });
A('object.set_color', 'objects', 'Set color', 'Set {Self} color to {color}', [p('color', 'Color', 'color', '#ff4444')], 'Tints the object.', OBJ);
A('object.set_scale', 'objects', 'Set scale', 'Set {Self} scale to ({sx}, {sy}, {sz})', [ex('sx', 'Scale X', '1'), ex('sy', 'Scale Y', '1'), ex('sz', 'Scale Z', '1')], 'Sets the scale.', { ...OBJ, c2: 'Object: Set scale' });
A('object.change_size', 'objects', 'Change size by', 'Change {Self} size by {percent}%', [ex('percent', 'Percent', '10')], 'Grows (or shrinks, with a negative number) by a percentage of its starting size.', { ...OBJ, c2: 'Object: Set scale' });
A('object.set_size', 'objects', 'Set size to', 'Set {Self} size to {percent}%', [ex('percent', 'Percent', '100')], 'Sets the size as a percentage of its starting size (100 = normal).', { ...OBJ, c2: 'Object: Set scale' });
A('sprite.next_costume', 'objects', 'Next costume', 'Switch {Self} to the next costume', [], 'Cycles through the sprite\'s Costumes list (set it on the object). Wraps around to the first.', { ...OBJ, c2: 'Sprite: Set animation frame' });
A('sprite.set_costume', 'objects', 'Switch costume', 'Switch {Self} costume to {costume}', [ex('costume', 'Costume (number or emoji/image)', '1')], 'A number picks from the Costumes list (1 = first); text sets that emoji or image directly.', { ...OBJ, c2: 'Sprite: Set animation frame' });
A('object.attach_to', 'objects', 'Attach to object', 'Attach {Self} to {other}', [ot('other', 'Parent object', 'Player')], 'Makes the object a child of the first picked instance of another object, keeping its offset.', { ...OBJ, c2: 'Pin: Pin to object' });
A('object.add_tag', 'objects', 'Add tag', 'Add tag "{tag}" to {Self}', [p('tag', 'Tag', 'text', 'enemy')], 'Adds a tag (group).', OBJ);
A('object.remove_tag', 'objects', 'Remove tag', 'Remove tag "{tag}" from {Self}', [p('tag', 'Tag', 'text', 'enemy')], 'Removes a tag.', OBJ);
A('behavior.set_enabled', 'objects', 'Turn behavior on/off','Set {Self} {behavior} {state}', [p('behavior', 'Behavior', 'behavior', 'platform'), p('state', 'State', 'choice', 'enabled', { options: ['enabled', 'disabled'] })], 'Enables or disables a behavior (e.g. turn movement on/off).', { ...OBJ, c2: 'Behavior: Set enabled' });

// ---------------- Movement ----------------
A('object.set_position', 'movement', 'Set position', 'Set {Self} position to ({x}, {y}, {z})', [ex('x', 'X', 'Self.X'), ex('y', 'Y', 'Self.Y'), ex('z', 'Z', 'Self.Z')], 'Moves instantly (Teleport).', { ...OBJ, c2: 'Object: Set position', codegen: true });
A('object.teleport_to', 'movement', 'Set position to object', 'Teleport {Self} to {other}', [ot('other', 'Other object', 'Checkpoint')], 'Moves to the first picked instance of another object.', { ...OBJ, c2: 'Object: Set position to another object' });
A('object.move', 'movement', 'Move by', 'Move {Self} by ({dx}, {dy}, {dz})', [ex('dx', 'dX', '0'), ex('dy', 'dY', '0'), ex('dz', 'dZ', '0')], 'Moves relative to the current position, respecting solids if the object has a movement behavior.', { ...OBJ, codegen: true });
A('object.move_forward', 'movement', 'Move forward', 'Move {Self} forward {distance}', [ex('distance', 'Distance', '5 * dt')], 'Moves along the object angle. Use "speed * dt" for smooth movement.', { ...OBJ, c2: 'Object: Move forward', codegen: true });
A('object.move_toward', 'movement', 'Move toward position', 'Move {Self} {distance} toward ({x}, {y}, {z})', [ex('distance', 'Distance', '3 * dt'), ex('x', 'X', 'Player.X'), ex('y', 'Y', 'Self.Y'), ex('z', 'Z', 'Player.Z')], 'Moves straight toward a point without overshooting.', OBJ);
A('object.move_toward_object', 'movement', 'Move toward object', 'Move {Self} toward {other} at {speed} m/s', [ot('other', 'Target', 'Player'), ex('speed', 'Speed', '3')], 'Moves straight toward another object (use AI > Find path to route around walls).', OBJ);
A('object.set_velocity', 'movement', 'Set velocity', 'Set {Self} velocity to ({vx}, {vy}, {vz})', [ex('vx', 'VX'), ex('vy', 'VY'), ex('vz', 'VZ')], 'Sets the velocity used by Platform, Physics and 8 Direction behaviors.', OBJ);
A('object.set_angle', 'movement', 'Set angle', 'Set {Self} angle to {angle}°', [ex('angle', 'Angle', '0')], 'Sets the heading in degrees (0 = +X, counter-clockwise).', { ...OBJ, c2: 'Object: Set angle', codegen: true });
A('object.rotate', 'movement', 'Rotate', 'Rotate {Self} by {degrees}°', [ex('degrees', 'Degrees', '90 * dt')], 'Turns counter-clockwise (negative = clockwise).', { ...OBJ, c2: 'Object: Rotate clockwise', codegen: true });
A('object.rotate_per_second', 'movement', 'Turn (per second)', 'Turn {Self} {degrees}° per second', [ex('degrees', 'Degrees per second', '90')], 'Turns smoothly at a steady speed while the event runs (put it under Forever / Every tick). No "* dt" needed; negative turns clockwise.', { ...OBJ, c2: 'Rotate behavior / Object: Rotate' });
A('object.move_per_second', 'movement', 'Move forward (per second)', 'Move {Self} forward {speed} m/s', [ex('speed', 'Speed (m/s)', '5')], 'Moves along the object angle at a steady speed while the event runs (under Forever / Every tick). No "* dt" needed.', { ...OBJ, c2: 'Object: Move forward' });
A('object.glide_to', 'movement', 'Glide to position', '{Self} glide to ({x}, {y}, {z}) in {seconds} s', [ex('x', 'X', '0'), ex('y', 'Y', '0'), ex('z', 'Z', 'Self.Z'), ex('seconds', 'Seconds', '1')], 'Moves smoothly to a point over the given time (Scratch "glide").', { ...OBJ, c2: 'MoveTo: Move to position' });
A('object.point_toward_mouse', 'movement', 'Point toward mouse', '{Self} point toward the mouse', [], 'Turns to face the mouse pointer.', { ...OBJ, c2: 'Object: Set angle toward position (Mouse)' });
A('object.go_random', 'movement', 'Go to random position', '{Self} go to a random position', [], 'Jumps to a random spot inside the stage (the scene bounds when set, else what the camera shows).', OBJ);
A('object.bounce_on_edge', 'movement', 'Bounce off edge', 'If {Self} is on the edge, bounce', [], 'When the object reaches the edge of the stage (or the scene bounds) it turns around and stays inside. Use under Forever / Every tick.', { ...OBJ, c2: 'Bound to layout + reflect angle' });
A('object.set_rotation', 'movement', 'Set rotation (3D)', 'Set {Self} rotation to ({rx}, {ry}, {rz})', [ex('rx', 'X°'), ex('ry', 'Y°'), ex('rz', 'Z°')], 'Sets full Euler rotation in degrees.', { ...OBJ, apps: GC });
A('object.look_at', 'movement', 'Look at object', '{Self} look at {other}', [ot('other', 'Target', 'Player')], 'Turns to face another object (Set angle toward position).', { ...OBJ, c2: 'Object: Set angle toward position' });
A('object.look_at_position', 'movement', 'Look at position', '{Self} look at ({x}, {y}, {z})', [ex('x', 'X', 'Mouse.X'), ex('y', 'Y', 'Mouse.Y'), ex('z', 'Z', 'Mouse.Z')], 'Turns to face a point (e.g. the mouse).', OBJ);
A('movement.set_speed', 'movement', 'Set movement speed', 'Set {Self} movement speed to {speed}', [ex('speed', 'Speed (m/s)', '6')], 'Sets the max speed of Platform, 8 Direction, Car, Pathfinding or Bullet on the object.', OBJ);
A('platform.simulate_control', 'movement', 'Simulate control', '{Self} simulate {control}', [p('control', 'Control', 'choice', 'right', { options: ['left', 'right', 'up', 'down', 'jump', 'run', 'dash', 'crouch', 'drop'] })], 'Walk, run or jump as if a key were pressed this tick (for AI and custom controls).', { ...OBJ, c2: 'Platform: Simulate control' });
A('platform.jump', 'movement', 'Jump', '{Self} jump', [], 'Makes a Platform character jump if it is on the floor.', { ...OBJ, behavior: 'platform' });
A('platform.set_jump_strength', 'movement', 'Set jump strength', 'Set {Self} jump strength to {value}', [ex('value', 'Jump strength', '10')], 'Changes how high the character jumps.', { ...OBJ, behavior: 'platform', c2: 'Platform: Set jump strength' });
A('platform.set_gravity', 'movement', 'Set platform gravity', 'Set {Self} gravity to {value}', [ex('value', 'Gravity', '28')], 'Changes the Platform gravity.', { ...OBJ, behavior: 'platform', c2: 'Platform: Set gravity' });
A('platform.set_jumps', 'movement', 'Set jump count', 'Set {Self} jumps to {count}', [ex('count', 'Jumps (1 = normal, 2 = double…; 0 = unlimited)', '2')], 'How many jumps in a row (in the air too): power-ups that give a double or triple jump.', { ...OBJ, behavior: 'platform' });
A('platform.set_ability', 'movement', 'Set movement ability', '{Self} {ability} {state}', [p('ability', 'Ability', 'choice', 'dash', { options: ['jumping', 'sprinting', 'swimming', 'crouching', 'dash', 'wall sliding', 'wall jumping', 'slow descent', 'climbing', 'flying', 'drop through'] }), p('state', 'State', 'choice', 'on', { options: ['on', 'off'] })], 'Switch one ability of the Platform movement on or off (unlock a dash, take away jumping in a cutscene); the rest keeps working.', { ...OBJ, behavior: 'platform' });
A('platform.dash', 'movement', 'Dash', '{Self} dash', [], 'Dash now (needs Dash on, and its cooldown over).', { ...OBJ, behavior: 'platform' });
C('platform.on_dash', 'movement', 'On dash', '{Self} on dash', [], 'Runs when a Platform character dashes (trail, sound).', { ...T, ...OBJ, behavior: 'platform' });
C('platform.on_wall_jump', 'movement', 'On wall jump', '{Self} on wall jump', [], 'Runs when a Platform character jumps off a wall.', { ...T, ...OBJ, behavior: 'platform' });
C('platform.is_state', 'conditions', 'Movement state is', '{Self} is {state}', [p('state', 'State', 'choice', 'wall sliding', { options: ['wall sliding', 'dashing', 'crouching', 'climbing', 'gliding', 'flying'] })], 'True while the Platform character is in this state.', { ...OBJ, behavior: 'platform' });
A('platformtype.switch', 'world', 'Switch platform', 'Turn {Self} {state}', [p('state', 'State', 'choice', 'toggle', { options: ['on', 'off', 'toggle'] })], 'Toggle platforms (Platform type: Toggle): on = solid, off = everything passes through (fades if Fade is on).', { ...OBJ, behavior: 'platformtype' });
A('platformtype.set_kind', 'world', 'Set platform type', 'Make {Self} a {kind} platform', [p('kind', 'Type', 'choice', 'one-way', { options: ['solid', 'one-way', 'pass-through', 'toggle'] })], 'Change what kind of platform this is while playing.', { ...OBJ, behavior: 'platformtype' });
C('platformtype.is_on', 'world', 'Platform is on', '{Self} is on', [], 'True while a toggle platform is switched on (solid).', { ...OBJ, behavior: 'platformtype' });
C('platformtype.on_switched', 'world', 'On platform switched', 'When {Self} switches', [], 'Runs when a toggle platform turns on or off (by its timer).', { ...T, ...OBJ, behavior: 'platformtype' });
A('movement.fly', 'movement', 'Fly', '{Self} fly upward at {speed} m/s', [ex('speed', 'Speed', '5')], 'Sets the vertical speed of a Platform or Physics object (hold to hover).', OBJ);
A('follow.set_target', 'camera', 'Change follow target', '{Self} follow {other}', [ot('other', 'Target', 'Player')], 'Changes what a Follow behavior (e.g. the camera) follows.', { ...OBJ, behavior: 'follow' });

// ---------------- Physics ----------------
A('physics.apply_force', 'physics', 'Apply force', 'Apply force ({fx}, {fy}, {fz}) to {Self}', [ex('fx', 'Force X'), ex('fy', 'Force Y'), ex('fz', 'Force Z')], 'Continuous force in newtons (use every tick).', { ...OBJ, c2: 'Physics: Apply force' });
A('physics.apply_impulse', 'physics', 'Apply impulse', 'Apply impulse ({ix}, {iy}, {iz}) to {Self}', [ex('ix', 'Impulse X'), ex('iy', 'Impulse Y', '5'), ex('iz', 'Impulse Z')], 'Instant push (changes velocity by impulse / mass).', { ...OBJ, c2: 'Physics: Apply impulse' });
A('physics.set_world_gravity', 'physics', 'Set gravity', 'Set world gravity to {value}', [ex('value', 'Gravity (m/s²)', '-20')], 'Changes gravity for Physics objects (negative = down).', { c2: 'Physics: Set world gravity' });
A('physics.set_mass', 'physics', 'Change mass', 'Set {Self} mass to {value}', [ex('value', 'Mass (kg)', '1')], 'Heavier objects are harder to push and throw.', { ...OBJ, behavior: 'physics' });
A('physics.set_friction', 'physics', 'Change friction', 'Set {Self} friction to {value}', [ex('value', 'Friction (0-1)', '0.5')], 'How quickly the object stops sliding on the ground.', { ...OBJ, behavior: 'physics', c2: 'Physics: Set friction' });
A('physics.set_bounce', 'physics', 'Change bounce', 'Set {Self} bounce to {value}', [ex('value', 'Bounce (0-1)', '0.3')], 'Restitution: 0 = no bounce, 1 = perfect bounce.', { ...OBJ, behavior: 'physics', c2: 'Physics: Set elasticity' });
A('physics.add_body', 'physics', 'Make physics object','Make {Self} a physics body (mass {mass})', [ex('mass', 'Mass', '1')], 'Adds the Physics behavior at runtime.', OBJ);
A('physics.set_collider', 'physics', 'Set collision shape','Set {Self} collider {shape} size ({w}, {h}, {d})', [p('shape', 'Shape', 'choice', 'box', { options: ['box', 'sphere', 'none'] }), ex('w', 'Width', '1'), ex('h', 'Height', '1'), ex('d', 'Depth', '1')], 'Changes the collision shape.', OBJ);
A('physics.grab_nearest', 'physics', 'Grab nearest object', '{Self} grab nearest {object} within {distance}', [ot('object', 'Object to grab', 'Crate'), ex('distance', 'Pickup distance', '2')], 'Picks up the closest Physics object in range and carries it in front.', OBJ);
A('physics.drop', 'physics', 'Drop object', '{Self} drop held object', [], 'Releases the carried object.', OBJ);
A('physics.throw', 'physics', 'Throw object', '{Self} throw held object with strength {strength}', [ex('strength', 'Throw strength', '12'), ex('up', 'Upward strength', '4')], 'Releases the carried object with an impulse along the facing direction.', OBJ);
A('physics.explode', 'physics', 'Apply explosion force', 'Explosion at ({x}, {y}, {z}) radius {radius} force {force}', [ex('x', 'X'), ex('y', 'Y'), ex('z', 'Z'), ex('radius', 'Radius', '5'), ex('force', 'Force', '15')], 'Pushes every Physics object away from a point, weaker with distance.', {});

// ---------------- Vehicles and interaction points (runtime/vehicle.ts) ----------------
C('vehicle.on_enter', 'movement', 'On entered vehicle', 'When someone gets into {Self}', [], 'Vehicle: the driver just got in (the driver is picked too).', { ...T, ...OBJ, behavior: 'vehicle' });
C('vehicle.on_exit', 'movement', 'On exited vehicle', 'When someone gets out of {Self}', [], 'Vehicle: the driver just got out at the door (the driver is picked too).', { ...T, ...OBJ, behavior: 'vehicle' });
C('vehicle.is_occupied', 'movement', 'Vehicle is occupied', '{Self} has a driver', [], 'Vehicle: someone is at the wheel.', { ...OBJ, behavior: 'vehicle' });
C('vehicle.is_driving', 'movement', 'Is in a vehicle', '{Self} is in a vehicle', [], 'True while this character is driving (or riding in) a vehicle.', OBJ);
A('vehicle.enter', 'movement', 'Get into vehicle', '{Self} get into the nearest {vehicle}', [ot('vehicle', 'Vehicle', 'Truck')], 'Puts the character in the nearest vehicle of that type (no key needed): cutscenes, starting a level in the car.', OBJ);
A('vehicle.exit', 'movement', 'Get out of vehicle', 'Driver gets out of {Self}', [], 'Vehicle: the driver steps out at the door.', { ...OBJ, behavior: 'vehicle' });
C('interact.on_interact', 'input', 'On interacted', 'When the player uses {Self}', [], 'Interaction point: the player pressed the key while close (this object and the player are picked).', { ...T, ...OBJ, behavior: 'interactable' });
C('interact.is_near', 'input', 'Player is near', 'The player is near {Self}', [], 'Interaction point: the player is within reach (its prompt is showing).', { ...OBJ, behavior: 'interactable' });
A('interact.set_prompt', 'input', 'Set interaction prompt', 'Set {Self} prompt to {text}', [ex('text', 'Prompt', '"Press E to knock"')], 'Interaction point: changes the text shown when the player is close ("" hides it).', { ...OBJ, behavior: 'interactable' });

// ---------------- Per-object effects (objectFx.ts) ----------------
const FX_TYPES = ['glow', 'pixelate', 'blur', 'outline', 'tint'];
A('fx.set_object_effect', 'camera', 'Set object effect', '{Self} effect {effect} {on}', [p('effect', 'Effect', 'choice', 'glow', { options: FX_TYPES }), p('on', 'On', 'boolean', true)], 'Turns an effect on this object only on or off (added with default settings if it has none). The camera\'s Post-FX are untouched.', OBJ);
A('fx.set_object_effect_param', 'camera', 'Set object effect setting', '{Self} {effect} {param} = {value}', [p('effect', 'Effect', 'choice', 'glow', { options: FX_TYPES }), p('param', 'Setting', 'choice', 'intensity', { options: ['intensity', 'radius', 'color', 'size', 'width', 'amount'] }), ex('value', 'Value', '1')], 'Changes a setting of an object effect (e.g. tint amount for a damage flash). Colours as "#ff0000".', OBJ);

// ---------------- Breakables (behavior in runtime/breakable.ts) ----------------
C('breakable.on_broken', 'physics', 'On broken', 'When {Self} breaks', [], 'Breakable: the object just shattered (pieces are flying). Good for scores, loot and sounds.', { ...T, ...OBJ, behavior: 'breakable' });
C('breakable.on_damaged', 'physics', 'On break damage', 'When {Self} takes break damage', [], 'Breakable without Health: it was hit but has durability left (crack sounds, shake).', { ...T, ...OBJ, behavior: 'breakable' });
C('breakable.is_broken', 'physics', 'Is broken', '{Self} is broken', [], 'Breakable: true once it has shattered.', { ...OBJ, behavior: 'breakable' });
A('breakable.break', 'physics', 'Shatter now', 'Shatter {Self}', [], 'Breakable: breaks it into pieces right away.', { ...OBJ, behavior: 'breakable' });
A('breakable.damage', 'physics', 'Damage breakable', 'Damage {Self} by {amount}', [ex('amount', 'Damage', '10')], 'Breakable: wears its durability down; it shatters at 0. (Deal damage works too.)', { ...OBJ, behavior: 'breakable' });
A('breakable.set_durability', 'physics', 'Set durability', 'Set {Self} durability to {value}', [ex('value', 'Durability', '20')], 'Breakable: how much more damage it takes before breaking.', { ...OBJ, behavior: 'breakable' });

// ---------------- Combat ----------------
A('health.damage', 'combat', 'Deal damage', '{Self} take {amount} damage', [ex('amount', 'Damage', '10')], 'Subtracts health (respects invulnerability time). Fires On damaged / On died.', { ...OBJ, behavior: 'health' });
A('health.heal', 'combat', 'Heal', 'Heal {Self} by {amount}', [ex('amount', 'Amount', '10')], 'Adds health up to the maximum.', { ...OBJ, behavior: 'health' });
A('health.set_hp', 'combat', 'Set health', 'Set {Self} health to {value}', [ex('value', 'Health', '100')], 'Sets current health (and revives if above 0).', { ...OBJ, behavior: 'health' });
A('combat.shoot', 'combat', 'Shoot projectile', '{Self} shoot {object} at {speed} m/s (spread {spread}°)', [ot('object', 'Projectile', 'Bullet'), ex('speed', 'Speed', '30'), ex('spread', 'Spread', '2'), ex('damage', 'Damage', '25')], 'Spawns a projectile facing the shooter angle. Projectiles damage objects with Health that they hit (not their owner).', OBJ);
A('combat.melee', 'combat', 'Perform melee attack', '{Self} melee {victims} range {range} arc {arc}° damage {damage}', [ot('victims', 'Targets', 'Enemy'), ex('range', 'Range', '2.2'), ex('arc', 'Arc (degrees)', '120'), ex('damage', 'Damage', '34'), p('blood', 'Blood', 'choice', 'none', { options: BLOOD_MODES })], 'Damages every target inside the range and arc in front of the attacker (Detect hit). Fires On hit by attack.', OBJ);
A('voxel.dig_view', 'objects', 'Dig terrain (where you look)', 'Dig {Self} where {from} looks: radius {radius} reach {reach}', [ot('from', 'Digger', 'Player'), ex('radius', 'Radius (m)', '0.8'), ex('reach', 'Reach (m)', '4')], 'Removes a ball of voxel terrain at the point the camera (first person) or the digger faces, up to the reach. Bedrock cannot be dug.', { ...OBJ, c2: 'Voxel terrain: excavate', apps: GC });
A('voxel.build_view', 'objects', 'Build terrain (where you look)', 'Build {Self} where {from} looks: radius {radius} reach {reach}', [ot('from', 'Builder', 'Player'), ex('radius', 'Radius (m)', '0.6'), ex('reach', 'Reach (m)', '4'), p('material', 'Material (1 grass 2 dirt 3 stone 6 sand)', 'text', '2')], 'Fills air next to the surface you look at (never inside you or other solids).', { ...OBJ, c2: 'Voxel terrain: raise / fill', apps: GC });
A('voxel.dig_at', 'objects', 'Dig terrain at point', 'Dig {Self} at ({x}, {y}, {z}) radius {radius}', [ex('x', 'X'), ex('y', 'Y'), ex('z', 'Z'), ex('radius', 'Radius (m)', '1.5')], 'Removes a ball of terrain at a world point (explosions, scripted caves).', { ...OBJ, apps: GC });
A('combat.hitscan', 'combat', 'Fire hitscan', '{Self} fire at {victims} range {range} damage {damage} (spread {spread}°, impact {impact}, {decal})', [ot('victims', 'Targets', 'Enemy'), ex('range', 'Range', '60'), ex('damage', 'Damage', '25'), ex('spread', 'Spread (degrees)', '0.5'), p('impact', 'Impact object (optional)', 'text', ''), p('decal', 'Bullet holes', 'choice', 'bullet hole', { options: ['bullet hole', 'cut hole', 'none'] }), p('blood', 'Blood', 'choice', 'none', { options: BLOOD_MODES })], 'Instant shot along the camera view (first person) or the facing direction. Walls stop it; the first target hit takes damage and fires On hit by attack. Optionally creates an impact object at the hit point, leaves a bullet hole on walls and props, and makes the target bleed onto the floor (sizes, lifetimes, limits and on / off: Project settings › Marks & blood).', { ...OBJ, c2: 'Raycast / instant hit (Line of sight + Health)' });
A('combat.blood', 'combat', 'Blood splatter', '{Self} bleed (big {big})', [p('big', 'Big (a kill)', 'boolean', false)], 'A burst of blood from this object, with speckled patches on the floor under it (Project settings › Marks & blood). For hits that do not come from Fire hitscan or Melee: projectiles, traps, falls.', OBJ);
A('paint.shoot', 'combat', 'Shoot paint', '{Self} shoot paint {color} size {size} m, range {range}', [ex('color', 'Colour', '"#ff3b8d"'), ex('size', 'Splat size (m)', '0.6'), ex('range', 'Range (m)', '40'), p('impact', 'Impact effect', 'choice', 'sparks', { options: ['none', 'sparks', 'magic', 'dust', 'smoke'] })], 'Paint gun: paints where the object aims (first person: where the camera looks; else its facing), with a splash. Marks stay until cleared (oldest go past 500). The painted object runs On painted.', OBJ);
A('paint.splat', 'combat', 'Splat paint', '{Self} splat paint {color} size {size} m', [ex('color', 'Colour', '"#ff3b8d"'), ex('size', 'Splat size (m)', '0.6')], 'Paints the surface this object is touching or heading into (a paint ball hitting a wall: On bullet hit solid → Splat paint → Destroy).', OBJ);
A('paint.clear', 'combat', 'Clear paint', 'Clear paint {what}', [p('what', 'Which', 'choice', 'all', { options: ['all', 'trails', 'paint guns'] })], 'Removes paint marks (trails and / or paint guns).', {});
C('paint.on_painted', 'combat', 'On painted', 'When {Self} is painted', [], 'Runs when paint (gun or splat) lands on this object (score the colour, change its look).', { ...T, ...OBJ });
A('combat.knockback', 'combat', 'Apply knockback', 'Knock {Self} back from {other} with strength {strength}', [ot('other', 'From', 'Player'), ex('strength', 'Strength', '8')], 'Pushes away from another object.', OBJ);
A('combat.equip', 'combat', 'Equip weapon', '{Self} equip {weapon}', [p('weapon', 'Weapon name', 'text', 'Sword')], 'Sets the "weapon" instance variable and shows only the child object with that name or type (others tagged "weapon" are hidden). Use "none" to unequip.', OBJ);
A('combat.switch_weapon', 'combat', 'Switch weapon', '{Self} switch weapon ({weapons})', [p('weapons', 'Weapons (comma separated)', 'text', 'Sword,Gun')], 'Cycles to the next weapon in the list.', OBJ);
A('object.respawn', 'combat', 'Respawn', 'Respawn {Self} at ({x}, {y}, {z})', [ex('x', 'X', '0'), ex('y', 'Y', '1'), ex('z', 'Z', '0')], 'Moves the object, stops it and restores full health.', OBJ);

// ---------------- AI ----------------
A('pathfinding.find_path', 'ai', 'Find path', '{Self} find path to ({x}, {y}, {z})', [ex('x', 'X', 'Player.X'), ex('y', 'Y', 'Player.Y'), ex('z', 'Z', 'Player.Z')], 'Plans a route around solids with A* and starts moving (Move to target).', { ...OBJ, behavior: 'pathfinding', c2: 'Pathfinding: Find path' });
A('pathfinding.move_to_object', 'ai', 'Chase object', '{Self} chase {other}', [ot('other', 'Target', 'Player')], 'Finds a path to the nearest instance of the target (Chase player / Navigate around walls).', { ...OBJ, behavior: 'pathfinding' });
A('pathfinding.stop', 'ai', 'Stop moving', '{Self} stop moving', [], 'Clears the current path.', { ...OBJ, behavior: 'pathfinding', c2: 'Pathfinding: Stop' });
A('ai.patrol', 'ai', 'Patrol', '{Self} patrol within {radius} of its start', [ex('radius', 'Radius', '6')], 'Walks to a random reachable point near where it started.', { ...OBJ, behavior: 'pathfinding' });
A('ai.flee', 'ai', 'Flee', '{Self} flee from {other} by {distance}', [ot('other', 'Threat', 'Player'), ex('distance', 'Distance', '6')], 'Finds a path to a point away from the threat.', { ...OBJ, behavior: 'pathfinding' });
// NPC and enemy presets (behaviors in runtime/aiBehaviors.ts).
C('npc.on_point', 'ai', 'On reached path point', 'When {Self} reaches a path point', [], 'Path follower: runs at every point of the route. PathFollower.PointIndex tells which (0 = first).', { ...T, ...OBJ, behavior: 'pathfollow' });
C('npc.on_path_end', 'ai', 'On path finished', 'When {Self} finishes its path', [], 'Path follower: runs at the end of the route (every lap when looping).', { ...T, ...OBJ, behavior: 'pathfollow' });
C('npc.on_approach', 'ai', 'On approaching player', 'When {Self} starts walking up to the player', [], 'NPC interaction: the NPC decided to come over.', { ...T, ...OBJ, behavior: 'npctalk' });
C('npc.on_interact', 'ai', 'On interaction', 'When {Self} starts an interaction', [], 'NPC interaction: the NPC reached the player (or the player pressed the talk key). Its dialogue, if set, opens now.', { ...T, ...OBJ, behavior: 'npctalk' });
C('npc.on_interact_end', 'ai', 'On interaction ended', 'When {Self} finishes an interaction', [], 'NPC interaction: the conversation closed; the NPC goes back to its routine.', { ...T, ...OBJ, behavior: 'npctalk' });
C('npc.is_interacting', 'ai', 'Is interacting', '{Self} is interacting', [], 'NPC interaction: true while walking up to the player or talking.', { ...OBJ, behavior: 'npctalk' });
C('enemy.on_spotted', 'ai', 'On spotted player', 'When {Self} spots the player', [], 'Slime / Flying enemy: started chasing.', { ...T, ...OBJ });
C('enemy.on_seen', 'ai', 'On seen by the player', 'When {Self} is seen', [], 'Moves when unseen: the player just looked at it (it froze). Play a sting, flicker the lights…', { ...T, ...OBJ, behavior: 'unseen' });
C('enemy.is_seen', 'ai', 'Is being watched', '{Self} is being watched', [], 'Moves when unseen: true while the player looks at it (it can\'t move).', { ...OBJ, behavior: 'unseen' });
C('enemy.is_moving', 'ai', 'Enemy is moving', '{Self} is moving', [], 'Moves when unseen / Moves when you move: true while it is moving toward the player.', OBJ);
C('enemy.on_attack', 'ai', 'On enemy attack', 'When {Self} attacks', [], 'Slime / Flying enemy: hit the player (damage already dealt). Good for sounds and effects.', { ...T, ...OBJ });
C('enemy.state_is', 'ai', 'Enemy state is', '{Self} enemy state is {state}', [p('state', 'State', 'choice', 'chase', { options: ['idle', 'hover', 'wander', 'chase', 'dive', 'climb', 'dead'] })], 'Slime / Flying enemy: what it is doing now.', OBJ);
A('npc.set_path_paused', 'ai', 'Pause / resume path', '{Self} path paused: {paused}', [p('paused', 'Paused', 'boolean', true)], 'Path follower: stop where it is (true) or carry on (false).', { ...OBJ, behavior: 'pathfollow' });
A('npc.restart_path', 'ai', 'Restart path', '{Self} restart path from point {index}', [ex('index', 'Point (0 = first)', '0')], 'Path follower: walk the route again from a point (also after "stop" mode finished).', { ...OBJ, behavior: 'pathfollow' });
A('npc.interact_now', 'ai', 'Start interaction', '{Self} start interaction now', [], 'NPC interaction: talk right away (wherever the player is).', { ...OBJ, behavior: 'npctalk' });
A('npc.end_interaction', 'ai', 'End interaction', '{Self} end interaction', [], 'NPC interaction: finish now and go back to the routine (closes its dialogue).', { ...OBJ, behavior: 'npctalk' });
A('enemy.set_target', 'ai', 'Set enemy target', '{Self} target {other}', [ot('other', 'Target', 'Player')], 'Slime / Flying enemy / NPC interaction: react to a different object type.', OBJ);
A('ai.set_state', 'ai', 'Set AI state', 'Set {Self} state to "{state}"', [p('state', 'State', 'choice', 'chase', { options: ['idle', 'patrol', 'chase', 'attack', 'recover', 'flee', 'defeated'] })], 'Sets the "state" instance variable used by state machines (Choose behavior). Compare it with Compare instance variable.', OBJ);

// ---------------- Timers ----------------
A('timer.start', 'timers', 'Start timer', '{Self} start timer "{tag}" for {duration}s ({mode})', [p('tag', 'Tag', 'text', 'tick'), ex('duration', 'Duration', '1'), p('mode', 'Mode', 'choice', 'once', { options: ['once', 'regular'] })], 'Starts a named timer. Adds the Timer behavior if missing.', { ...OBJ, c2: 'Timer: Start timer' });
A('timer.stop', 'timers', 'Stop timer', '{Self} stop timer "{tag}"', [p('tag', 'Tag', 'text', 'tick')], 'Cancels a timer.', { ...OBJ, c2: 'Timer: Stop timer' });

// ---------------- Audio ----------------
const SOUNDS = ['coin', 'jump', 'shoot', 'hit', 'explosion', 'dig', 'pickup', 'throw', 'win', 'lose', 'click', 'swing', 'reload', 'step', 'engine', 'music:adventure', 'music:calm'];
export const BUILTIN_SOUNDS = SOUNDS;
A('audio.play', 'audio', 'Play sound', 'Play sound {sound} at {volume}%', [p('sound', 'Sound', 'sound', 'coin', { options: SOUNDS }), ex('volume', 'Volume %', '80')], 'Plays a built-in synthesized sound or an imported audio asset.', { c2: 'Audio: Play' });
A('audio.play_at', 'audio', 'Play spatial sound', 'Play {sound} at {Self} ({volume}%)', [p('sound', 'Sound', 'sound', 'hit', { options: SOUNDS }), ex('volume', 'Volume %', '80')], 'Plays a sound positioned at the object (louder when the camera is near).', { ...OBJ, c2: 'Audio: Play at object' });
A('audio.play_music', 'audio', 'Play music', 'Play music {sound} at {volume}%', [p('sound', 'Music', 'sound', 'music:adventure', { options: SOUNDS }), ex('volume', 'Volume %', '40')], 'Loops background music (replaces current music).', {});
A('audio.stop', 'audio', 'Stop sound', 'Stop {what}', [p('what', 'What', 'choice', 'music', { options: ['music', 'all'] })], 'Stops music or every sound.', { c2: 'Audio: Stop' });
A('audio.set_volume', 'audio', 'Change volume', 'Set master volume to {volume}%', [ex('volume', 'Volume %', '80')], 'Changes the master volume.', { c2: 'Audio: Set master volume' });
A('audio.set_effect', 'audio', 'Trigger audio effect', 'Set audio effect {effect}', [p('effect', 'Effect', 'choice', 'none', { options: ['none', 'echo', 'underwater', 'radio'] })], 'Applies an effect to all sounds.', { c2: 'Audio: Add effect' });

// ---------------- Particles ----------------
A('particles.spawn', 'particles', 'Spawn particle system', 'Spawn {preset} particles at ({x}, {y}, {z})', [p('preset', 'Preset', 'particlePreset', 'explosion'), ex('x', 'X'), ex('y', 'Y'), ex('z', 'Z')], 'Creates a one-shot emitter from a preset.', {});
A('particles.spawn_at', 'particles', 'Spawn particles at object', 'Spawn {preset} particles at {Self}', [p('preset', 'Preset', 'particlePreset', 'coin')], 'Creates a one-shot emitter at each picked instance.', OBJ);
A('particles.attach', 'particles', 'Attach effect to object', 'Attach {preset} effect to {Self}', [p('preset', 'Preset', 'particlePreset', 'fire')], 'Adds a continuous emitter that follows the object.', OBJ);
A('particles.burst', 'particles', 'Trigger burst', '{Self} emit {count} particles', [ex('count', 'Count', '30')], 'Emits particles from the emitter object (or its attached effect).', OBJ);
A('particles.start', 'particles', 'Start emission', '{Self} start emitting', [], 'Starts or restarts an emitter.', OBJ);
A('particles.stop', 'particles', 'Stop emission', '{Self} stop emitting', [], 'Stops emitting (existing particles finish their life).', OBJ);
A('particles.set_param', 'particles', 'Set particle property', 'Set {Self} particle {param} to {value}', [p('param', 'Property', 'choice', 'rate', { options: ['rate', 'lifetime', 'speed', 'gravity', 'sizeStart', 'sizeEnd', 'spread', 'drag', 'alphaStart', 'rotationSpeed'] }), ex('value', 'Value', '30')], 'Changes emission rate, lifetime, speed, gravity, size...', OBJ);
A('particles.set_color', 'particles', 'Set particle color', 'Set {Self} particle colors {start} → {end}', [p('start', 'Start color', 'color', '#ffffff'), p('end', 'End color', 'color', '#ff8800')], 'Changes color over lifetime.', OBJ);

// ---------------- Camera & effects ----------------
A('camera.shake', 'camera', 'Shake camera', 'Shake camera {intensity} for {duration}s', [ex('intensity', 'Intensity', '0.3'), ex('duration', 'Duration', '0.3')], 'Shakes the active camera.', { c2: 'ScrollTo: Shake' });
A('camera.set_active', 'camera', 'Set active camera', 'Make {Self} the active camera', [], 'Switches rendering to this camera.', { ...OBJ, apps: GC });
A('camera.set_focal_length', 'camera', 'Set focal length', 'Set {Self} focal length {mm} mm', [ex('mm', 'Focal length (mm)', '50')], 'Blender-style lens zoom.', { ...OBJ, apps: GC });
A('camera.set_clipping', 'camera', 'Set camera clipping', 'Set {Self} clip {near} – {far}', [ex('near', 'Clip start', '0.1'), ex('far', 'Clip end', '1000')], 'Blender "Clip Start / End".', { ...OBJ, apps: GC });
A('camera.set_zoom', 'camera', 'Set 2D zoom', 'Set camera zoom to {zoom}', [ex('zoom', 'Zoom', '1')], 'Zooms 2D / orthographic views (1 = 100%).', {});
// Security-camera style views: place several cameras, switch between them from keys, buttons or anything else.
const camGroup = () => p('group', 'Only cameras of this object (empty = every camera)', 'text', '');
A('camera.view_step', 'camera', 'Next / previous camera', 'Switch to the {direction} camera {group}', [p('direction', 'Which', 'choice', 'next', { options: ['next', 'previous'] }), camGroup()], 'Cycles through the cameras in the scene, in the order they were added, wrapping round at the ends. Camera.ViewNumber tells which one is showing.', { apps: GC });
A('camera.view_number', 'camera', 'Switch to camera number', 'Switch to camera number {number} {group}', [ex('number', 'Number (1 = first)', '1'), camGroup()], 'Shows one of the cameras by its number, for a row of buttons (1, 2, 3...). A number that does not exist changes nothing.', { apps: GC });
A('camera.view_named', 'camera', 'Switch to camera named', 'Switch to the camera named {name}', [p('name', 'Camera name', 'text', 'Camera')], 'Shows the camera with this name in the Outliner.', { apps: GC });
C('camera.view_is', 'camera', 'Camera view is', 'The camera showing is number {number} {group}', [ex('number', 'Number (1 = first)', '1'), camGroup()], 'True while this camera is the one showing: for "is the player watching the hallway?".', { apps: GC });
C('camera.on_view_changed', 'camera', 'On camera view changed', 'When the camera view changes', [], 'Runs after a switch brick changes the view. Camera.ViewNumber tells which one is showing now.', { ...T, apps: GC });
// Routes drawn from a button on the brick. An object can have many, chosen at random or in turn.
A('path.follow', 'ai', 'Follow path', '{Self} follow {paths}: {pick}, speed {speed}, at the end {mode}, wait {wait} s', [
  p('paths', 'Paths', 'path', '', { doc: 'Press Draw path on the brick, then click in the scene. Add more paths for it to choose between.' }),
  p('pick', 'Which path', 'choice', 'random', { options: ['random', 'in order', 'first'], doc: 'random: any of them each time this brick runs. in order: the next one each time, wrapping round.' }),
  ex('speed', 'Speed (m/s)', '2.5'),
  p('mode', 'At the end', 'choice', 'stop', { options: ['stop', 'loop', 'back and forth'] }),
  ex('wait', 'Wait at each point (s)', '0'),
  p('face', 'Face where it walks', 'boolean', true),
], 'Walks the object along a route you draw right here, from the brick, with no behavior to add. Works from any event: a timer can send a monster down one of several routes. Then use On path finished, or On reached path point, and "Is on path number" to react to which way it went.', { ...OBJ, apps: GC });
A('path.stop', 'ai', 'Stop following path', '{Self} stop following its path', [], 'Stops where it is. Follow path starts it off again.', { ...OBJ, apps: GC });
A('path.set_paused', 'ai', 'Pause following path', '{Self} path paused: {paused}', [p('paused', 'Paused', 'boolean', true)], 'Holds it where it is (true) or carries on from there (false).', { ...OBJ, apps: GC });
A('path.set_speed', 'ai', 'Set path speed', '{Self} path speed {speed}', [ex('speed', 'Speed (m/s)', '2.5')], 'Changes the speed while it walks: faster every night, slower when watched.', { ...OBJ, apps: GC });
C('path.on_point', 'ai', 'On reached point of drawn path', 'When {Self} reaches a point of its path', [], 'Runs at every point of the route.', { ...T, ...OBJ, apps: GC });
C('path.on_end', 'ai', 'On finished drawn path', 'When {Self} finishes its path', [], 'Runs at the end of the route (every lap when looping).', { ...T, ...OBJ, apps: GC });
C('path.is_following', 'ai', 'Is following a path', '{Self} is following a path', [], 'True from Follow path until it stops at the end or a Stop brick.', { ...OBJ, apps: GC });
C('path.is_on_number', 'ai', 'Is on path number', '{Self} is on path number {number}', [ex('number', 'Path number (1 = first)', '1')], 'Which of the drawn paths Follow path chose: different routes can end in different places.', { ...OBJ, apps: GC });
// Rope / zipline.
C('rope.on_grab', 'movement', 'On rope grabbed', 'When someone grabs {Self}', [], 'Runs when a player takes hold of this rope. The rope and the player are picked.', { ...T, ...OBJ, behavior: 'rope', apps: GC });
C('rope.on_release', 'movement', 'On rope let go', 'When someone lets go of {Self}', [], 'Runs when a player comes off this rope, for whatever reason.', { ...T, ...OBJ, behavior: 'rope', apps: GC });
C('rope.on_end', 'movement', 'On zipline end reached', 'When someone reaches the end of {Self}', [], 'Runs when a player zips to the end of this rope, just before they let go.', { ...T, ...OBJ, behavior: 'rope', apps: GC });
C('rope.is_held', 'movement', 'Rope is held', 'Someone is on {Self}', [], 'True while a player is on this rope.', { ...OBJ, behavior: 'rope', apps: GC });
A('rope.release', 'movement', 'Let go of rope', 'Whoever is on {Self} lets go', [], 'Drops the player off this rope.', { ...OBJ, behavior: 'rope', apps: GC });
A('rope.set_length', 'movement', 'Set rope length', 'Set {Self} hanging length to {length} m', [ex('length', 'Length (m)', '4')], 'Lowers or raises a hanging rope (and whatever hangs from it).', { ...OBJ, behavior: 'rope', apps: GC });
// The player's microphone and webcam: read here on this computer, nothing is recorded or sent.
const pctCmp = () => cmp();
A('mic.start', 'input', 'Start microphone', 'Start the microphone, "loud" above {threshold}', [ex('threshold', 'Loud above (0-100)', '30')], 'Asks the player for the microphone and starts listening. Nothing is recorded or sent anywhere: the game only reads how loud it is. Microphone.Level is 0-100 (talking is about 20-40, shouting 60 or more).', { apps: GC });
A('mic.stop', 'input', 'Stop microphone', 'Stop the microphone', [], 'Stops listening and releases it. Stopping the game also releases it.', { apps: GC });
A('mic.monitor', 'input', 'Hear microphone in the game', 'Play the microphone through the game: {on}, volume {volume}%', [p('on', 'On', 'boolean', true), ex('volume', 'Volume %', '100')], 'The player hears their own voice through the game. Use headphones: speakers feed back into the microphone. Only on this computer, not to other players.', { apps: GC });
C('mic.on_noise', 'input', 'On microphone heard noise', 'When the microphone hears a noise', [], 'Runs once when the level rises above the "loud" setting of Start microphone. It must die down before this can run again.', { ...T, apps: GC });
C('mic.on_ready', 'input', 'On microphone ready', 'When the microphone is on', [], 'Runs when the player has allowed it and it is listening.', { ...T, apps: GC });
C('mic.on_denied', 'input', 'On microphone refused', 'When the microphone is refused', [], 'Runs when the player said no, or this computer has none: keep the game playable without it.', { ...T, apps: GC });
C('mic.level_is', 'input', 'Microphone level', 'Microphone level {op} {value}', [pctCmp(), ex('value', 'Level (0-100)', '30')], 'Compares how loud it is right now.', { apps: GC });
C('mic.is_on', 'input', 'Microphone is on', 'The microphone is on', [], 'True while it is listening.', { apps: GC });
A('webcam.start', 'input', 'Start webcam', 'Start the webcam, "moving" above {threshold}', [ex('threshold', 'Moving above (0-100)', '15')], 'Asks the player for the camera on their computer. Nothing is recorded or sent anywhere. Webcam.Motion is how much of the picture is changing (0-100) and Webcam.Brightness how bright the room is.', { apps: GC });
A('webcam.stop', 'input', 'Stop webcam', 'Stop the webcam', [], 'Turns the camera off and takes the picture off every object. Stopping the game also turns it off.', { apps: GC });
A('webcam.show_on', 'input', 'Show webcam on object', 'Show the webcam on {Self}: {on}', [p('on', 'Show', 'boolean', true)], 'Draws the live picture on this object in place of its texture: a TV, a mirror, a sign. Off puts its own look back.', { ...OBJ, apps: GC });
C('webcam.on_motion', 'input', 'On webcam saw movement', 'When the webcam sees movement', [], 'Runs once when movement rises above the "moving" setting of Start webcam. It must settle before this can run again.', { ...T, apps: GC });
C('webcam.on_ready', 'input', 'On webcam ready', 'When the webcam is on', [], 'Runs when the player has allowed it and the picture is live.', { ...T, apps: GC });
C('webcam.on_denied', 'input', 'On webcam refused', 'When the webcam is refused', [], 'Runs when the player said no, or this computer has none.', { ...T, apps: GC });
C('webcam.is_on', 'input', 'Webcam is on', 'The webcam is on', [], 'True while the picture is live.', { apps: GC });
A('postfx.apply_preset', 'camera', 'Apply post-processing preset', 'Apply {preset} look', [p('preset', 'Preset', 'postfxPreset', 'ps1', { options: POSTFX_PRESET_IDS })], 'Replaces the active camera effect stack with a preset. (LogicCraft draws the 2D-capable effects: glow, color, vignette, grain, pixelation, CRT, motion blur, letterbox.)');
A('postfx.set_enabled', 'camera', 'Enable or disable effect', 'Set {effect} effect {state}', [p('effect', 'Effect', 'effectType', 'bloom', { options: EFFECT_TYPES }), p('state', 'State', 'choice', 'enabled', { options: ['enabled', 'disabled'] })], 'Turns one effect on the active camera on or off (adds it if missing).');
A('postfx.set_param', 'camera', 'Set effect parameter', 'Set {effect}.{param} to {value}', [p('effect', 'Effect', 'effectType', 'bloom', { options: EFFECT_TYPES }), p('param', 'Parameter', 'text', 'strength'), ex('value', 'Value', '1')], 'Changes any parameter: bloom strength, vignette amount, pixel size, saturation, focus distance...');
A('postfx.set_bloom', 'camera', 'Set bloom intensity', 'Set bloom intensity to {value}', [ex('value', 'Strength', '1')], 'Enables bloom with the given strength.');
A('postfx.set_pixelation', 'camera', 'Enable pixelation', 'Set pixelation to {value}px', [ex('value', 'Pixel size (0 = off)', '4')], 'Pixelates the image (0 disables).');
A('postfx.set_ps1', 'camera', 'Enable PS1-style effects', 'Set PS1 effects {state}', [p('state', 'State', 'choice', 'enabled', { options: ['enabled', 'disabled'] })], 'Low resolution, vertex snapping, affine textures, dithering and color banding.', { apps: GC });
A('postfx.set_vignette', 'camera', 'Set vignette', 'Set vignette to {value}', [ex('value', 'Amount (0-1)', '0.5')], 'Darkens the edges.');
A('postfx.set_dof', 'camera', 'Change depth of field', 'Set depth of field focus {focus} f/{fstop}', [ex('focus', 'Focus distance', '10'), ex('fstop', 'F-stop', '2.8')], 'Blender-style depth of field on the active camera.', { apps: GC });
A('postfx.color_grade', 'camera', 'Change color grading', 'Color grade: saturation {saturation}, contrast {contrast}, temperature {temperature}', [ex('saturation', 'Saturation', '1'), ex('contrast', 'Contrast', '1'), ex('temperature', 'Temperature', '0')], 'Adjusts saturation, contrast and warmth.');

// ---------------- UI ----------------
A('looks.say', 'ui', 'Say', '{Self} say {text} for {seconds} s', [ex('text', 'Text', '"Hello!"'), ex('seconds', 'Seconds (0 = keep showing)', '2')], 'Shows a speech bubble above the object. An empty text removes it.', { ...OBJ, c2: 'Text: Set text (speech bubble)' });
A('looks.think', 'ui', 'Think', '{Self} think {text} for {seconds} s', [ex('text', 'Text', '"Hmm…"'), ex('seconds', 'Seconds (0 = keep showing)', '2')], 'Shows a thought bubble above the object. An empty text removes it.', OBJ);
A('ui.ask', 'ui', 'Ask and wait', 'Ask {question} and put the answer in {variable}', [ex('question', 'Question', '"What is your name?"'), p('variable', 'Answer variable', 'variable', 'answer')], 'Shows a text box and pauses the remaining actions until the player types an answer and presses Enter; the answer goes into the variable.', { c2: 'TextInput + Wait for signal' });
A('ui.show_message', 'ui', 'Show message', 'Show message {text} for {seconds}s', [ex('text', 'Message', '"Hello!"'), ex('seconds', 'Seconds', '2')], 'Shows a banner in the middle of the screen.', {});
A('ui.set_text', 'ui', 'Update text', 'Set {Self} text to {text}', [ex('text', 'Text', '"Coins: " & coins')], 'Changes a text object.', { ...OBJ, c2: 'Text: Set text' });
A('ui.set_bar', 'ui', 'Update health bar', 'Set {Self} bar to {value} / {max}', [ex('value', 'Value', 'Player.Health.HP'), ex('max', 'Maximum', '100')], 'Turns a text object into a progress/health bar.', OBJ);
A('ui.show_menu', 'ui', 'Show menu', 'Show menu "{tag}"', [p('tag', 'Menu tag', 'text', 'pause_menu')], 'Shows every object tagged with the menu tag.', {});
A('ui.hide_menu', 'ui', 'Hide menu', 'Hide menu "{tag}"', [p('tag', 'Menu tag', 'text', 'pause_menu')], 'Hides every object tagged with the menu tag.', {});

// ---------------- Game flow ----------------
A('game.pause', 'game', 'Pause game', 'Pause game', [], 'Sets time scale to 0. Events still run so you can resume with a key.', { c2: 'System: Set time scale (0)' });
A('game.resume', 'game', 'Resume game', 'Resume game', [], 'Sets time scale back to 1.', {});
A('system.set_timescale', 'game', 'Set time scale', 'Set time scale to {scale}', [ex('scale', 'Scale', '1')], 'Slow motion (<1) or fast forward (>1).', { c2: 'System: Set time scale' });
A('game.restart', 'game', 'Restart scene', 'Restart scene', [], 'Resets the scene to its starting state.', { c2: 'System: Restart layout' });
A('game.load_scene', 'game', 'Load scene', 'Go to scene {scene} ({transition})', [
  p('scene', 'Scene name', 'scene', 'Level 2'),
  p('transition', 'Transition', 'choice', 'fade', { options: TRANSITIONS }),
  ex('duration', 'Transition seconds', '0.5'),
  p('keep', 'Keep variables', 'text', 'all', { doc: '"all", "none", or variable names separated by commas' }),
  ex('data', 'Data for the next scene', '""'),
  p('color', 'Transition colour', 'color', '#000000'),
  ...TRANSITION_PICTURES(),
], 'Changes level. Transitions: fade, wipe, curtain, blinds, iris / diamond / star / heart (closing on the middle), dissolve, or your own: shape (closes on a picture\'s shape) and map (a greyscale picture: dark parts cover first), in any colour or over your own cover picture (Pictures panel); the next scene opens the same way. The next scene keeps the chosen global variables and reads SceneData and PreviousScene. A scene that does not exist is reported and the game stays where it is.', { c2: 'System: Go to layout' });
A('game.previous_scene', 'game', 'Go to previous scene', 'Go back to the previous scene ({transition})', [p('transition', 'Transition', 'choice', 'fade', { options: TRANSITIONS }), p('keep', 'Keep variables', 'text', 'all'), p('color', 'Transition colour', 'color', '#000000'), ...TRANSITION_PICTURES()], 'Returns to the scene you came from (for menus, shops and houses).', {});
A('camera.set_view', 'camera', 'Set camera view', '{Self} view: {preset}, turn {turn}', [p('preset', 'View', 'choice', 'iso21', { options: ['iso21', 'iso', 'topdown'] }), p('turn', 'Turn', 'choice', 'left', { options: ['keep', 'left', 'right', '0', '1', '2', '3'] })], 'Puts this camera in an orthographic view preset: iso21 = isometric for 2:1 pixel-art tiles, iso = true isometric, topdown. Turn left / right rotates the view 90° around what it looks at (Q / E in isometric games); 0–3 sets the quarter-turn. Works with Follow.', { ...OBJ, apps: GC });
A('world.generate_rooms', 'world', 'Generate rooms', '{Self} generate rooms (seed {seed}, {rooms} rooms, {width} × {height}, {style})', [ex('seed', 'Seed', 'RandomSeed'), ex('rooms', 'Rooms', '8'), ex('width', 'Width (cells)', '40'), ex('height', 'Height (cells)', '30'), p('style', 'Style', 'choice', 'rooms', { options: ['rooms', 'cave'] }), ex('decor', 'Decoration (0–1)', '0.15')], 'Paints a new dungeon into this tilemap (2D, pixel art or isometric): floors, solid walls, doors and decoration, picked by the tileset\'s tile roles (Tilemap panel › Procedural rooms). The same seed always gives the same rooms. Then use Move to room.', OBJ);
A('world.generate_rooms_3d', 'world', 'Build 3D rooms', '{Self} build 3D rooms from {floor}, {wall}, {door} (seed {seed}, {rooms} rooms, {width} × {height}, cell {cell} m, {style})', [ot('floor', 'Floor object', 'Floor'), ot('wall', 'Wall object', 'Wall'), p('door', 'Door object (optional)', 'text', ''), p('decorType', 'Decoration object (optional)', 'text', ''), ex('seed', 'Seed', 'RandomSeed'), ex('rooms', 'Rooms', '6'), ex('width', 'Width (cells)', '24'), ex('height', 'Height (cells)', '18'), ex('cell', 'Cell size (m)', '2'), p('style', 'Style', 'choice', 'rooms', { options: ['rooms', 'cave'] }), ex('decor', 'Decoration (0–1)', '0.15')], 'Builds a dungeon in 3D from copies of your floor, wall (facing into the room), door and decoration objects, laid out on a grid starting at this object. Building again replaces the last build. Then use Move to room.', { ...OBJ, apps: GC });
A('world.populate_rooms', 'world', 'Populate rooms', '{Self} populate rooms: {enemy} enemies ({enemies}, difficulty {difficulty}), {treasure} treasure ({chance} chance per room), seed {seed}', [ot('enemy', 'Enemy object', 'Enemy'), ex('enemies', 'Enemies (0–1)', '0.5'), ex('difficulty', 'Difficulty (1–10)', '3'), ot('treasure', 'Treasure object', 'Chest'), ex('chance', 'Treasure room chance (0–1)', '0.25'), ex('seed', 'Seed', 'RandomSeed')], 'After Generate rooms / Build 3D rooms: places copies of an enemy and a treasure object in the rooms. The start room stays safe, farther rooms get more enemies, harder difficulty more again; some rooms become treasure rooms. Populating again replaces the last ones. The same seed gives the same spots.', OBJ);
A('world.move_to_room', 'world', 'Move to room', 'Move {object} to the {which} of {Self}\'s rooms', [ot('object', 'Object', 'Player'), p('which', 'Where', 'choice', 'start', { options: ['start', 'end', 'random room', 'random spot'] })], 'Puts objects in the generated rooms: the start room, the end room (farthest walk from the start), a random room, or a random free floor cell.', OBJ);
C('world.on_rooms_generated', 'world', 'On rooms generated', 'On {Self} rooms generated', [], 'Runs right after Generate rooms / Build 3D rooms on this object (place the player, enemies and treasure).', { ...T, ...OBJ });
C('game.on_scene_enter', 'game', 'On entering scene', 'On entering this scene from {from}', [p('from', 'From scene (empty = any)', 'scene', '')], 'Runs when this scene starts, after On start of scene. With a scene name, only when coming from that scene (put the player at the right door).', T);
C('game.on_transition_done', 'game', 'On transition finished', 'On transition finished', [], 'Runs when a transition has fully cleared the screen: after a scene opens, or after Uncover screen (start a cutscene or give back control).', T);
A('game.cover_screen', 'game', 'Cover screen', 'Cover the screen ({transition}, {duration}s)', [p('transition', 'Transition', 'choice', 'fade', { options: TRANSITIONS.filter((t) => t !== 'none') }), ex('duration', 'Seconds', '0.5'), p('color', 'Colour', 'color', '#000000'), ...TRANSITION_PICTURES()], 'Covers the screen without changing scene (it stays covered until Uncover screen). On screen covered runs when it is fully covered: teleport the player, swap the set, then uncover.', {});
A('game.uncover_screen', 'game', 'Uncover screen', 'Uncover the screen ({duration}s)', [ex('duration', 'Seconds', '0.5')], 'Clears a covered screen the same way it was covered. On transition finished runs when it is clear.', {});
C('game.on_screen_covered', 'game', 'On screen covered', 'On screen fully covered', [], 'Runs when Cover screen has fully covered the screen.', T);
C('game.screen_covered', 'game', 'Screen is covered', 'The screen is covered', [], 'True while the screen is fully covered by Cover screen (or by a scene change just before it switches).', {});
C('game.on_scene_end', 'game', 'On scene end', 'On leaving this scene', [], 'Runs just before the scene changes or restarts (save progress here).', T);
C('game.on_scene_error', 'game', 'On scene not found', 'On scene not found', [], 'Runs when Load scene names a scene that does not exist (the game stays in this scene).', T);
C('game.scene_is', 'game', 'Scene is', 'Current scene is {scene}', [p('scene', 'Scene name', 'scene', 'Level 1')], 'True in the named scene. Useful when several scenes share one event sheet.', {});

A('particles.set_exposed', 'particles', 'Set effect parameter', 'Set {Self} effect parameter {name} to {value}', [p('name', 'Exposed parameter', 'text', 'Spin'), ex('value', 'Value', '5')], 'Changes an exposed parameter of a ParticleCraft effect on this object (e.g. tornado Spin, fountain Pressure). Colors use "#rrggbb".', OBJ);

// ---------------- Code ----------------
A('code.run', 'code', 'Code block', 'Run {language} code {code}', [
  p('language', 'Language', 'language', 'javascript'),
  p('code', 'Code', 'code', '// game.get("score"), game.set("score", 1), game.objects("Player")\ngame.log("Hello from JavaScript");\n'),
  p('name', 'Panel name (HTML / CSS)', 'text', 'panel'),
], 'A code block in the language you choose. JavaScript runs in the game (sandboxed: only the game API). HTML shows an interface panel and CSS styles it. Python, Lua, C# and C++ are checked and included when you export to that language; TypeScript and Java are edit-only. The block says which.', {});
A('ui.hide_html', 'code', 'Hide HTML panel', 'Hide HTML panel "{name}"', [p('name', 'Panel name', 'text', 'panel')], 'Hides a panel shown by an HTML code block.', {});

// ---------------- Cutscenes & video ----------------
const vid = (def: ParamValue = 'Intro') => p('video', 'Video', 'video', def);
const vidAny = () => p('video', 'Video (empty = any)', 'video', '');
A('video.play', 'video', 'Play video', 'Play video {video} (fullscreen {fullscreen}, loop {loop}, volume {volume}%)', [
  vid(), p('fullscreen', 'Fullscreen', 'boolean', true), p('loop', 'Loop', 'boolean', false), ex('volume', 'Volume %', '100'),
  p('fit', 'Fit', 'choice', 'contain', { options: ['contain', 'cover', 'stretch'], doc: 'contain: whole video with bars; cover: fill and crop; stretch: fill and distort.' }),
  ex('x', 'Centre X % (windowed)', '50'), ex('y', 'Centre Y % (windowed)', '50'), ex('w', 'Width % (windowed)', '60'),
  p('skip', 'Skip key', 'choice', 'none', { options: ['none', 'Escape', 'Space', 'Enter', 'Any key'] }),
  p('lock', 'Lock player controls', 'boolean', true), p('wait', 'Wait until it ends', 'boolean', false),
], 'Plays a video from the Videos panel as a cutscene. Fullscreen covers the game; otherwise it shows in a window placed by Centre X/Y and Width (% of the screen). "Lock player controls" hides keys and mouse from the game while it plays. With "Wait until it ends", the following actions run after the video ends.', {});
C('video.on_end', 'video', 'On video finished', 'When video {video} finishes', [vidAny(), p('skipped', 'Also when skipped', 'boolean', true)], 'Runs when a video plays to its end (and, unless unticked, when the player skips it). Use it to give control back, start the next level or a dialogue.', T);
C('video.on_time', 'video', 'On video time', 'When video {video} reaches {seconds} s', [vidAny(), ex('seconds', 'Seconds', '5')], 'Runs once when the playing video passes this time (again on each loop). Trigger dialogue, animations or sounds in sync with a cutscene.', T);
C('video.is_playing', 'video', 'Video is playing', 'Video {video} is playing', [vidAny()], 'True while a video is showing (paused counts).', {});
A('video.pause', 'video', 'Pause video', 'Pause video', [], 'Pauses the playing video (controls come back while paused).', {});
A('video.resume', 'video', 'Resume video', 'Resume video', [], 'Continues a paused video.', {});
A('video.stop', 'video', 'Stop video', 'Stop video', [], 'Removes the video without firing "On video finished".', {});
A('video.skip', 'video', 'Skip video', 'Skip video', [], 'Ends the video as if the player skipped it (fires "On video finished" when it allows skips).', {});

// ---------------- Dialogue ----------------
A('dialogue.start', 'dialogue', 'Start dialogue', 'Start dialogue {dialogue}', [p('dialogue', 'Dialogue', 'dialogue', 'Guard'), p('wait', 'Wait until it ends', 'boolean', false)], 'Opens a conversation from the Dialogue editor. Players continue with click / Space and pick choices with click or 1-9. With "wait", the following actions run after it ends.', {});
A('dialogue.continue', 'dialogue', 'Continue dialogue', 'Continue dialogue', [], 'Moves past a line that has no choices.', {});
A('dialogue.choose', 'dialogue', 'Choose dialogue option', 'Choose option {index}', [ex('index', 'Option number', '1')], 'Picks a visible choice by its number (1 = first).', {});
A('dialogue.jump', 'dialogue', 'Jump to dialogue line', 'Jump to line {line}', [p('line', 'Line id', 'text', '')], 'Moves the open conversation to another line.', {});
A('dialogue.end', 'dialogue', 'End dialogue', 'End dialogue', [], 'Closes the open conversation.', {});
C('dialogue.on_start', 'dialogue', 'On dialogue start', 'On dialogue {dialogue} start', [p('dialogue', 'Dialogue (empty = any)', 'dialogue', '')], 'Runs when a conversation opens.', T);
C('dialogue.on_line', 'dialogue', 'On dialogue line', 'On line {line} by {speaker} in {dialogue}', [p('dialogue', 'Dialogue (empty = any)', 'dialogue', ''), p('speaker', 'Speaker (empty = any)', 'text', ''), p('line', 'Line id (empty = any)', 'text', '')], 'Runs each time a line is shown (play a voice, animate the speaker). With a line id, only that line (the id is shown in the Dialogue editor).', T);
C('dialogue.on_choice', 'dialogue', 'On dialogue choice', 'On choice {choice} in {dialogue}', [p('dialogue', 'Dialogue (empty = any)', 'dialogue', ''), p('choice', 'Choice text or number (empty = any)', 'text', '')], 'Runs when the player picks a choice.', T);
C('dialogue.on_event', 'dialogue', 'On dialogue event', 'On dialogue event {name}', [p('name', 'Event name', 'text', 'open_gate')], 'Runs when a line or choice with this event name is reached (trigger quests, animations, items).', T);
C('dialogue.on_end', 'dialogue', 'On dialogue end', 'On dialogue {dialogue} end with {ending}', [p('dialogue', 'Dialogue (empty = any)', 'dialogue', ''), p('ending', 'Ending (empty = any)', 'text', '')], 'Runs when a conversation closes; endings are named on end lines.', T);
C('dialogue.is_active', 'dialogue', 'Dialogue is open', 'A dialogue is open', [], 'True while a conversation is on screen (pause movement with it).', {});
A('game.set_checkpoint', 'game', 'Set checkpoint', 'Set checkpoint at {Self}', [], 'Remembers the position of the picked object (use with Respawn at checkpoint).', OBJ);
A('game.respawn_checkpoint', 'game', 'Respawn at checkpoint', 'Respawn {Self} at checkpoint', [], 'Moves the object to the last checkpoint (or its start).', OBJ);
A('game.victory', 'game', 'Display victory screen', 'Victory: {title}', [ex('title', 'Title', '"You win!"'), ex('message', 'Message', '"Well done"')], 'Shows the victory screen with Restart, and stops gameplay.', {});
A('game.defeat', 'game', 'Display defeat screen', 'Defeat: {title}', [ex('title', 'Title', '"Game over"'), ex('message', 'Message', '"Try again"')], 'Shows the defeat screen with Restart, and stops gameplay.', {});

// ---------------- Animation ----------------
A('anim.play', 'animation', 'Play animation', '{Self} play animation "{name}" ({loop})', [p('name', 'Animation', 'text', 'dig'), p('loop', 'Loop', 'choice', 'once', { options: ['once', 'loop'] })], 'Plays a keyframe clip from the Animation editor, an imported (glTF/FBX) clip, or a sprite animation.', { ...OBJ, c2: 'Sprite: Set animation' });
A('anim.stop', 'animation', 'Stop animation', '{Self} stop animation', [], 'Stops the current animation.', OBJ);
A('anim.set_role', 'animation', 'Set animation role', '{Self} use clip "{clip}" for {role}', [p('role', 'Role', 'choice', 'idle', { options: ['idle', 'walk', 'run', 'jump', 'fall', 'attack', 'sit', 'drive', 'carry'] }), p('clip', 'Clip (empty = the model\'s own)', 'text', 'Hold_Box_Idle')], 'Changes which model clip plays for a movement state, e.g. walk and idle become the box-carrying clips while holding a parcel. Empty restores the original.', { ...OBJ, apps: GC });
A('model.rotate_part', 'animation', 'Rotate model part', '{Self} swing part "{part}" to {angle}° on its {hinge} over {seconds}s', [p('part', 'Part name (from the model)', 'text', 'Door1'), ex('angle', 'Angle (°, 0 = as modelled)', '90'), p('hinge', 'Hinge', 'choice', 'front edge', { options: ['front edge', 'back edge', 'left edge', 'right edge', 'top edge', 'bottom edge'] }), ex('seconds', 'Seconds', '0.5')], 'Opens doors, lids and hatches: turns one named part of an imported model around a hinge on one of its edges (front = the object\'s forward side). Positive angles turn counter-clockwise seen from above (top/bottom hinges: outward).', { ...OBJ, apps: GC });
// The Procedural Animation controller as stages you can see and change in logic (Inspector › Show as blocks writes them).
A('proc.legs', 'animation', 'Procedural leg controller', '{Self} legs: stride {stride} × leg, step height {height}, {speed} steps/s', [ex('stride', 'Stride (× leg length)', '0.8'), ex('height', 'Step height (× leg)', '0.3'), ex('speed', 'Step speed (steps/s)', '5')], 'Leg controller of a Procedural Animation character: how far a foot trails before it steps (stride), how high it lifts, how fast it steps.', { ...OBJ, behavior: 'procanim', apps: GC });
A('proc.ground', 'animation', 'Ground detection', '{Self} ground detection {state}, surface adaptation {adapt}', [p('state', 'Ground detection', 'choice', 'on', { options: ['on', 'off'] }), ex('adapt', 'Surface adaptation (0–1)', '1')], 'Feet find the ground under them (stairs, slopes, rocks) and the body leans with it (adaptation 0 = stays level). Off: feet step on a flat plane.', { ...OBJ, behavior: 'procanim', apps: GC });
A('proc.feet', 'animation', 'Foot placement', '{Self} foot placement: responsiveness {resp}, body bob {bob}', [ex('resp', 'Responsiveness', '1'), ex('bob', 'Body bob', '1')], 'How quickly the body settles onto where the feet land, and how much it bobs per step.', { ...OBJ, behavior: 'procanim', apps: GC });
A('proc.body', 'animation', 'Procedural body motion', '{Self} body: arm swing {arms}, slither / curl {wave}, idle {idle}, speed {speed}×', [ex('arms', 'Arm swing', '1'), ex('wave', 'Slither / tentacle curl', '1'), ex('idle', 'Idle motion', '1'), ex('speed', 'Animation speed', '1')], 'Joint and body movement: arms swing, snake bodies wave, tentacles curl; idle breathing; overall animation speed.', { ...OBJ, behavior: 'procanim', apps: GC });
A('proc.climb', 'animation', 'Wall climbing', '{Self} wall climbing {state} at {speed} m/s', [p('state', 'Climb walls', 'choice', 'on', { options: ['on', 'off'] }), ex('speed', 'Climb speed (m/s)', '2.5')], 'Walking into a wall climbs it: the body turns onto the wall and the legs keep stepping (spiders; needs Platform movement).', { ...OBJ, behavior: 'procanim', apps: GC });
A('proc.reach', 'animation', 'Reach / grab with limbs', '{Self} reach for {target}', [ot('target', 'Object', 'Player')], 'Octopus tentacles (and arms) stretch toward the nearest object of this type and curl round it when close. Pick nothing to stop reaching.', { ...OBJ, behavior: 'procanim', apps: GC });
A('proc.ragdoll', 'animation', 'Ragdoll', '{Self} go limp (ragdoll), pushed {force} m/s', [ex('force', 'Push forward (m/s)', '0')], 'The model\'s bones stop animating and fall under gravity (Procedural Animation). Movement stops. Use Get up to animate again.', { ...OBJ, behavior: 'procanim', apps: GC });
A('proc.get_up', 'animation', 'Get up', '{Self} get up from ragdoll', [], 'Ends the ragdoll: the body animates and moves again.', { ...OBJ, behavior: 'procanim', apps: GC });
A('proc.look_at', 'animation', 'Look at', '{Self} look at {target}', [ot('target', 'Object', 'Player')], 'The head turns toward the nearest object of this type (Procedural Animation). Pick nothing to look ahead again.', { ...OBJ, behavior: 'procanim', apps: GC });
C('proc.is_ragdoll', 'animation', 'Is ragdoll', '{Self} is limp (ragdoll)', [], 'True while the object is a ragdoll.', { ...OBJ, behavior: 'procanim', apps: GC });
C('proc.is_climbing', 'animation', 'Is climbing', '{Self} is climbing a wall', [], 'True while a Procedural Animation object with Climb walls walks up a wall.', { ...OBJ, behavior: 'procanim', apps: GC });
A('anim.set_speed','animation', 'Set animation speed', 'Set {Self} animation speed to {speed}×', [ex('speed', 'Speed (1 = normal, 0 = frozen)', '1')], 'Plays the object\'s model animation faster or slower (e.g. a monster walks slowly while wandering and fast while chasing).', { ...OBJ, apps: GC });
A('anim.tween', 'animation', 'Tween property', 'Tween {Self} {property} to {value} over {duration}s ({ease})', [p('property', 'Property', 'choice', 'Y', { options: PROPS.slice(0, 11) }), ex('value', 'Target', 'Self.Y + 1'), ex('duration', 'Duration', '0.5'), p('ease', 'Easing', 'choice', 'easeOut', { options: ['linear', 'easeIn', 'easeOut', 'easeInOut', 'bounce'] })], 'Smoothly animates a property.', { ...OBJ, c2: 'Tween: Tween one property' });

// ---------------- World: sky, water, lights ----------------
A('sky.set_time', 'world', 'Set time of day', 'Set time of day to {hours}:00', [ex('hours', 'Hours (0-24, 12 = noon)', '12')], 'Moves the sun (and the stars at night). Turns the sky on if it was off.');
A('sky.set_cycle', 'world', 'Day/night cycle', 'Day/night cycle {state}, one day lasts {seconds}s', [p('state', 'State', 'choice', 'on', { options: ['on', 'off'] }), ex('seconds', 'Seconds per day', '240')], 'Makes time pass on its own.');
C('sky.is_night', 'world', 'Is night', 'It is night', [], 'True while the sun is below the horizon.');
C('sky.on_nightfall', 'world', 'On nightfall', 'When night falls', [], 'Fires when the sun sets (day/night cycle).', T);
C('sky.on_daybreak', 'world', 'On daybreak', 'When day breaks', [], 'Fires when the sun rises.', T);
C('water.is_in_water', 'world', 'Is in water', '{Self} is in water', [], 'True while the object\'s center is inside an object with the Water behavior.', OBJ);
C('water.on_enter', 'world', 'On entered water', 'When {Self} enters water', [], 'Fires when the object goes into water (splash sounds, swim animations).', { ...T, ...OBJ });
C('water.on_exit', 'world', 'On left water', 'When {Self} leaves water', [], 'Fires when the object comes out of water.', { ...T, ...OBJ });
C('water.is_floating', 'world', 'Is floating', '{Self} is floating', [], 'True while the object is partly under the surface of a water (held up by the Water\'s buoyancy). Its share under water is Self.Submerged (0–1).', OBJ);
C('water.is_sinking', 'world', 'Is sinking', '{Self} is sinking', [], 'True while the object is all under water and going down (or lying on the bottom) — too heavy to float.', OBJ);
C('water.compare_submerged', 'world', 'Compare submersion', '{Self} is {op} {percent}% under water', [p('op', 'Compare', 'choice', '>', { options: ['>', '<', '>=', '<=', '='] }), ex('percent', 'Percent', '50')], 'How much of the object is below the water surface (0–100%). Also Self.Submerged (0–1) and Self.WaterDepth (m) in expressions.', OBJ);
C('water.on_start_floating', 'world', 'On start floating', 'When {Self} starts floating', [], 'Fires when the object comes to float at the surface (dropped in, or rising after being pushed under).', { ...T, ...OBJ });
C('water.on_start_sinking', 'world', 'On start sinking', 'When {Self} starts sinking', [], 'Fires when the object goes all the way under and keeps going down (overloaded raft, heavy crate).', { ...T, ...OBJ });
C('water.on_tipped_over', 'world', 'On floating object tipped over', 'When {Self} tips over', [], 'Fires when a Physics object in water rolls more than 60° from upright (capsized boat, flipped raft).', { ...T, ...OBJ });
A('light.set_power', 'world', 'Set light power', 'Set {Self} light power to {value}', [ex('value', 'Power (W, sun: strength)', '1000')], 'Changes a light\'s brightness (0 = off).', OBJ);
A('light.set_color', 'world', 'Set light color', 'Set {Self} light color to {color}', [p('color', 'Color', 'color', '#ffd9a0')], 'Changes a light\'s colour.', OBJ);
A('light.flicker', 'world', 'Flicker light', 'Flicker {Self} for {seconds}s', [ex('seconds', 'Seconds', '1.5')], 'Makes a light stutter on and off (failing bulbs, horror), then return to its power.', OBJ);
A('light.set_emission', 'world', 'Set scene glow', 'Set glow of all glowing materials to {percent}%', [ex('percent', 'Percent (0 = dark, 100 = normal)', '100')], 'Scales every emissive (glowing) material in the scene: lamps, screens, signs. Use 0 for a blackout.', { apps: GC });
A('light.set_ambient', 'world', 'Set ambient light', 'Set ambient light to {value}', [ex('value', 'Strength (0 = black)', '0.6')], 'Changes the world (ambient) light strength.');
C('net.player_connected', 'game', 'Online player connected', 'Online player {player} is connected', [ex('player', 'Player number (2-4)', '2')], 'True while that player is in the online game (see Multiplayer).');
C('net.on_player_joined', 'game', 'On player joined', 'When an online player joins', [], 'Fires on the host when someone joins. The player number is TriggerData("player").', T);
C('net.on_player_left', 'game', 'On player left', 'When an online player leaves', [], 'Fires on the host when someone disconnects. The player number is TriggerData("player").', T);
A('net.show_menu', 'game', 'Show multiplayer menu', 'Show the multiplayer menu (Create / Join)', [], 'Opens the Multiplayer window: Create shows a short code to send a friend, Join lets them type it in. Put it on a menu button.', { apps: GC });
C('net.on_hosting', 'game', 'On started hosting', 'When this player starts hosting', [], 'Fires after Create in the multiplayer menu, when the host clicks Continue (start the game here).', { ...T, apps: GC });

// WorldCraft's bricks are blocks like these, in the same editors, offered only there. A few plain logic blocks are
// shared with them; the rest of GameCraft's blocks need a running game, which WorldCraft doesn't have.
defs.push(...(worldBlockDefs() as BlockDef[]));
for (const d of defs) if (['var.set', 'var.add', 'system.compare_variable', 'system.is_boolean_set'].includes(d.id)) d.apps = [...d.apps, 'worldcraft'];

export const BLOCK_DEFS: Record<string, BlockDef> = Object.fromEntries(defs.map((d) => [d.id, d]));
export const BLOCK_LIST: BlockDef[] = defs;
export const PROPERTY_NAMES = PROPS;
export const EFFECT_TYPE_IDS = EFFECT_TYPES;

export function categoryOf(id: string): CategoryDef {
  const d = BLOCK_DEFS[id];
  return CATEGORIES.find((c) => c.id === d?.category) ?? { id: 'events', name: 'Unknown', color: '#777', icon: '?', doc: '' };
}

export function defaultParams(def: BlockDef): Record<string, ParamValue> {
  return Object.fromEntries(def.params.map((p) => [p.name, p.default]));
}

/** Human-readable sentence for a block instance (used by both views and docs). */
export function blockSentence(def: BlockDef | undefined, params: Record<string, ParamValue>, target?: string): string {
  if (!def) return 'Unknown block';
  return def.text.replace(/\{(\w+)\}/g, (_, k) => {
    if (k === 'Self') return target ?? '(object)';
    const v = params[k];
    if (def.params.some((x) => x.name === k && x.type === 'path')) { const n = readPaths(v).paths.filter((r) => r.length).length; return n === 1 ? '1 drawn path' : `${n} drawn paths`; }
    return v === undefined || v === '' ? (k === 'args' ? '' : '…') : String(v);
  });
}
