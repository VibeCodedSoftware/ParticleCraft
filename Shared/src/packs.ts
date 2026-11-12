// Block packs: ready-made systems (player controls, enemy AI, health bars, inventory, combat, menus) that are
// dragged onto the logic editor. A pack becomes ordinary events in one group - every block stays visible and
// editable in any coding style - plus what those events need in the scene: behaviors and variables on the
// chosen objects, HUD texts, and spawn templates. Nothing is hidden, and a pack is undone like any edit.
import { block, event, group, reassignIds, type AppId, type EventNode, type LogicDocument, type ParamValue, type VariableDef } from './schema';
import { behaviorDefaults } from './runtime/behaviors';
import { makeInstance, nextUid, type InstanceData, type InstanceKind, type SceneData } from './runtime/scene';
import { DEFAULT_ACTIONS } from './runtime/input';
import { TOUCH_PRESETS, withTouchBindings } from './touchControls';
import { deepClone, walkEvents, type CustomPreset } from './schema';

export type PackCategory = 'Player controls' | 'Movement' | 'Platforms' | 'Touch controls' | 'NPCs' | 'Enemy AI' | 'Trails & effects' | 'Health & HUD' | 'Inventory & items' | 'Combat' | 'Menus & screens' | 'My presets';
export const PACK_CATEGORIES: { id: PackCategory; icon: string }[] = [
  { id: 'My presets', icon: '★' },
  { id: 'Player controls', icon: '🕹️' }, { id: 'Movement', icon: '🏃' }, { id: 'Platforms', icon: '▭' }, { id: 'Touch controls', icon: '📱' }, { id: 'NPCs', icon: '🧑' }, { id: 'Enemy AI', icon: '👾' },
  { id: 'Trails & effects', icon: '✨' }, { id: 'Health & HUD', icon: '❤️' }, { id: 'Inventory & items', icon: '🎒' }, { id: 'Combat', icon: '⚔️' }, { id: 'Menus & screens', icon: '🖥️' },
];

export interface PackOption {
  key: string; label: string;
  type: 'objectType' | 'number' | 'text' | 'key' | 'boolean' | 'choice';
  default: ParamValue; options?: string[]; doc?: string;
}

export interface PackContext { app: AppId; mode: '2d' | '3d' }
type Opts = Record<string, ParamValue>;

/** What a pack adds. Objects and templates are only created when the scene has none of that type yet. */
export interface PackResult {
  events: EventNode[];
  globals?: VariableDef[];
  /** Behaviors put on every object of `target` (props override defaults; `replaces` are removed first). */
  behaviors?: { target: string; type: string; props?: Record<string, any>; replaces?: string[] }[];
  /** Instance variables added to every object of `target` (existing values are kept). */
  vars?: { target: string; vars: Record<string, any> }[];
  objects?: { type: string; kind: InstanceKind; data: Partial<InstanceData> }[];
  /** Spawn-only object types (bullets...). */
  templates?: { type: string; kind: InstanceKind; data: Partial<InstanceData> }[];
  inputActions?: Record<string, string[]>;
  /** Multiplayer pack: who players who join play as. */
  multiplayer?: { player: string; maxPlayers: number };
  /** On-screen touch controls (Touch controls presets): the layout, with its bindings added to the actions. */
  touch?: { preset: string };
  /** Tags added to every object of `target` (ladders, climbable…). */
  tags?: { target: string; tags: string[] }[];
  /** Shown after installing: what to do next. */
  notes?: string[];
}

export interface LogicPack {
  id: string; name: string; icon: string; category: PackCategory; description: string;
  /** Default: both apps, both modes. */
  apps?: AppId[]; modes?: ('2d' | '3d')[];
  options: PackOption[];
  build(o: Opts, ctx: PackContext): PackResult;
}

// ---- helpers
const B = (id: string, params: Record<string, ParamValue> = {}, target?: string, extra: { invert?: boolean } = {}) => block(id, params, target, extra);
const E = (conds: ReturnType<typeof B>[], acts: ReturnType<typeof B>[], children: EventNode[] = [], extra: { isElse?: boolean } = {}) => event(conds, acts, children, extra);
const s = (o: Opts, k: string) => String(o[k]);
const n = (o: Opts, k: string) => String(Number(o[k]));
const gv = (name: string, value: any, comment?: string): VariableDef => ({ name, type: typeof value === 'number' ? 'number' : typeof value === 'boolean' ? 'boolean' : Array.isArray(value) ? 'array' : 'string', value, comment });
const running = () => B('system.compare_values', { a: 'timescale', op: '>', b: '0' });
const obj = (key = 'player', label = 'Player object', def = 'Player'): PackOption => ({ key, label, type: 'objectType', default: def });
const num = (key: string, label: string, def: number, doc?: string): PackOption => ({ key, label, type: 'number', default: def, doc });
const key = (k: string, label: string, def: string): PackOption => ({ key: k, label, type: 'key', default: def });
const hud = (name: string, text: string, anchor: string, x: number, y: number, extra: Record<string, any> = {}, o: Partial<InstanceData> = {}): { type: string; kind: InstanceKind; data: Partial<InstanceData> } =>
  ({ type: name, kind: 'text', data: { name, x, y, ...o, text: { text, size: 22, color: '#ffffff', align: 'left', hud: true, anchor: anchor as any, ...extra } as InstanceData['text'] } });
const MOVERS = ['platform', 'eightdir', 'car'];

/** A plain enemy to start from when the scene has none. */
const enemyObject = (type: string, mode: '2d' | '3d', at: Partial<InstanceData>): { type: string; kind: InstanceKind; data: Partial<InstanceData> } => ({
  type, kind: mode === '3d' ? 'capsule' : 'sprite',
  data: mode === '3d' ? { y: 0.6, sx: 0.8, sy: 1.2, sz: 0.8, color: '#d6453d', collider: { shape: 'box', size: [0.7, 1, 0.7], offset: [0, 0, 0] }, ...at } : { y: 2, color: '#d6453d', ...at },
});
const spawnerObject = (type: string, mode: '2d' | '3d'): { type: string; kind: InstanceKind; data: Partial<InstanceData> } => ({
  type, kind: 'empty', data: { x: 5, y: mode === '3d' ? 0.6 : 2, collider: { shape: 'none', size: [1, 1, 1], offset: [0, 0, 0] } },
});

// ---- packs
export const PACKS: LogicPack[] = [
  // ======================= Player controls
  {
    id: 'controls.platformer', name: 'Platformer controls', icon: '🏃', category: 'Player controls',
    description: 'Run and jump with arrows/WASD + Space (gamepad too). Falling off the level respawns you at the last checkpoint.',
    options: [obj(), num('speed', 'Run speed', 6), num('jump', 'Jump strength', 10), { key: 'double', label: 'Double jump', type: 'boolean', default: false }, num('killY', 'Respawn below height', -20, 'Falling below this Y respawns the player'), { key: 'checkpoint', label: 'Checkpoint object', type: 'objectType', default: 'Checkpoint' }],
    build: (o, c) => ({
      behaviors: [{ target: s(o, 'player'), type: 'platform', props: { maxSpeed: Number(o.speed), jumpStrength: Number(o.jump), doubleJump: !!o.double }, replaces: MOVERS }],
      events: [
        E([B('system.on_start_of_layout')], [B('game.set_checkpoint', {}, s(o, 'player'))]),
        E([B('object.on_collision', { other: s(o, 'checkpoint') }, s(o, 'player'))], [B('game.set_checkpoint', {}, s(o, 'player'))]),
        E([B('system.every_tick'), B('object.compare_property', { property: 'Y', op: '<', value: n(o, 'killY') }, s(o, 'player'))], [B('game.respawn_checkpoint', {}, s(o, 'player')), ...(c.mode === '2d' ? [] : [B('camera.shake', { intensity: '0.15', duration: '0.2' })])]),
        E([B('platform.on_jump', {}, s(o, 'player'))], [B('audio.play', { sound: 'jump', volume: '60' })]),
      ],
      notes: [`Place a "${s(o, 'checkpoint')}" object anywhere to save the respawn point when touched.`],
    }),
  },
  {
    id: 'controls.topdown', name: 'Top-down controls', icon: '✥', category: 'Player controls',
    description: 'Move in 8 directions with arrows/WASD or the left stick. Optionally face the mouse.',
    options: [obj(), num('speed', 'Speed', 6), { key: 'faceMouse', label: 'Face the mouse', type: 'boolean', default: false }],
    build: (o) => ({
      behaviors: [{ target: s(o, 'player'), type: 'eightdir', props: { maxSpeed: Number(o.speed), setAngle: !o.faceMouse }, replaces: MOVERS }],
      events: o.faceMouse ? [E([B('system.every_tick'), running()], [B('object.point_toward_mouse', {}, s(o, 'player'))])] : [E([B('system.on_start_of_layout')], [B('movement.set_speed', { speed: n(o, 'speed') }, s(o, 'player'))])],
    }),
  },
  {
    id: 'controls.fps', name: 'First-person controls', icon: '👁️', category: 'Player controls', modes: ['3d'],
    description: 'Mouse look, WASD to walk, Shift to run, Space to jump. Click the game to capture the mouse; Esc releases it.',
    options: [obj(), { key: 'camera', label: 'Camera object', type: 'objectType', default: 'Camera' }, num('speed', 'Walk speed', 5), num('sensitivity', 'Mouse sensitivity', 0.25), num('eye', 'Eye height (m)', 1.6)],
    build: (o) => ({
      behaviors: [
        { target: s(o, 'player'), type: 'platform', props: { maxSpeed: Number(o.speed) }, replaces: MOVERS },
        { target: s(o, 'camera'), type: 'follow', props: { target: s(o, 'player'), firstPerson: true, sensitivity: Number(o.sensitivity), eyeHeight: Number(o.eye), orbitWithMouse: false, lookAt: false, smoothing: 0 } },
      ],
      events: [E([B('system.on_start_of_layout')], [B('input.set_cursor', { mode: 'locked' })])],
      notes: [`The "${s(o, 'camera')}" object becomes the player's eyes.`],
    }),
  },
  {
    id: 'controls.thirdperson', name: 'Third-person controls', icon: '🧍', category: 'Player controls', modes: ['3d'],
    description: 'Camera orbits the player with the mouse and stays in front of walls; WASD moves relative to the camera.',
    options: [obj(), { key: 'camera', label: 'Camera object', type: 'objectType', default: 'Camera' }, num('speed', 'Run speed', 6), num('distance', 'Camera distance (m)', 6)],
    build: (o) => ({
      behaviors: [
        { target: s(o, 'player'), type: 'platform', props: { maxSpeed: Number(o.speed) }, replaces: MOVERS },
        { target: s(o, 'camera'), type: 'follow', props: { target: s(o, 'player'), orbitWithMouse: true, distance: Number(o.distance), avoidWalls: true, firstPerson: false, lookAt: true, offsetY: 2 } },
      ],
      events: [E([B('system.on_start_of_layout')], [B('input.set_cursor', { mode: 'locked' })])],
    }),
  },
  {
    id: 'controls.car', name: 'Car driving', icon: '🏎️', category: 'Player controls',
    description: 'Throttle, brake/reverse and steering with arrows/WASD; a chase camera follows the car.',
    options: [obj('car', 'Car object', 'Car'), { key: 'camera', label: 'Camera object', type: 'objectType', default: 'Camera' }, num('speed', 'Top speed', 24)],
    build: (o, c) => ({
      behaviors: [
        { target: s(o, 'car'), type: 'car', props: { maxSpeed: Number(o.speed) }, replaces: MOVERS },
        { target: s(o, 'camera'), type: 'follow', props: c.mode === '3d' ? { target: s(o, 'car'), rotateWithTarget: true, offsetX: -8, offsetY: 3.5, offsetZ: 0, lookAt: true } : { target: s(o, 'car'), offsetX: 0, offsetY: 0, offsetZ: 20, lookAt: false } },
      ],
      events: [E([B('car.on_hit', {}, s(o, 'car'))], [B('audio.play', { sound: 'hit', volume: '60' }), B('camera.shake', { intensity: '0.25', duration: '0.25' })])],
    }),
  },
  {
    id: 'controls.click', name: 'Click to move', icon: '🖱️', category: 'Player controls',
    description: 'Click the ground and the player walks there around walls (pathfinding). Good for strategy and point-and-click games.',
    options: [obj(), num('speed', 'Speed', 5)],
    build: (o) => ({
      behaviors: [{ target: s(o, 'player'), type: 'pathfinding', props: { maxSpeed: Number(o.speed) }, replaces: MOVERS }],
      events: [E([B('input.on_mouse_click', { button: 'left' })], [B('pathfinding.find_path', { x: 'Mouse.X', y: 'Mouse.Y', z: 'Mouse.Z' }, s(o, 'player')), B('particles.spawn', { preset: 'magic', x: 'Mouse.X', y: 'Mouse.Y', z: 'Mouse.Z' })])],
    }),
  },

  ...(['first person', 'third person'] as const).map((view): LogicPack => ({
    id: view === 'first person' ? 'controls.vehicle_fp' : 'controls.vehicle_tp', name: `Drivable vehicle (${view})`, icon: '⛟', category: 'Player controls', modes: ['3d'],
    description: `Walk up to the vehicle and press E to get in, drive with W/A/S/D, press E again to get out at the door. ${view === 'first person' ? 'You drive from the seat, looking out of the windscreen.' : 'A chase camera follows the vehicle; you are back to your character when you get out.'}`,
    options: [obj(), obj('vehicle', 'Vehicle object', 'Car'), { key: 'camera', label: 'Camera object', type: 'objectType', default: 'Camera' }, num('speed', 'Top speed (m/s)', 22), { key: 'key', label: 'Enter / exit key', type: 'key', default: 'E' }],
    build: (o) => {
      const pl = s(o, 'player'), ve = s(o, 'vehicle');
      const walking = view === 'first person'
        ? [{ target: pl, type: 'platform', props: { maxSpeed: 5 }, replaces: MOVERS }, { target: s(o, 'camera'), type: 'follow', props: { target: pl, firstPerson: true, eyeHeight: 1.6, orbitWithMouse: false, lookAt: false, smoothing: 0 } }]
        : [{ target: pl, type: 'platform', props: { maxSpeed: 6 }, replaces: MOVERS }, { target: s(o, 'camera'), type: 'follow', props: { target: pl, orbitWithMouse: true, distance: 6, avoidWalls: true, firstPerson: false, lookAt: true, offsetY: 2 } }];
      return {
        behaviors: [...walking, { target: ve, type: 'car', props: { maxSpeed: Number(o.speed) }, replaces: ['platform', 'eightdir'] }, { target: ve, type: 'vehicle', props: { driver: pl, enterKey: s(o, 'key'), camera: view } }, { target: ve, type: 'solid' }],
        events: [
          E([B('system.on_start_of_layout')], [B('input.set_cursor', { mode: 'locked' })]),
          E([B('vehicle.on_enter', {}, ve)], [B('ui.show_message', { text: `"Driving - press ${s(o, 'key')} to get out"`, seconds: '2' }), B('audio.play', { sound: 'engine', volume: '40' })]),
          E([B('vehicle.on_exit', {}, ve)], [B('audio.play', { sound: 'click', volume: '60' })]),
        ],
        notes: [`Seat and door positions are on "${ve}"'s Vehicle behavior (X forward, Y up, Z right). Set them to fit your model.`],
      };
    },
  })),
  {
    id: 'items.interact', name: 'Interaction point', icon: '⌁', category: 'Inventory & items',
    description: 'Doors to knock on, parcels to pick up, levers and signs: a "Press E" prompt when you are close, and an event when you press it.',
    options: [obj('target', 'Object to use', 'Door'), obj(), { key: 'prompt', label: 'Prompt', type: 'text', default: 'Press E to knock' }, { key: 'key', label: 'Key', type: 'key', default: 'E' }, num('distance', 'Reach (m)', 2)],
    build: (o) => ({
      behaviors: [{ target: s(o, 'target'), type: 'interactable', props: { who: s(o, 'player'), prompt: s(o, 'prompt'), key: s(o, 'key'), distance: Number(o.distance) } }],
      events: [E([B('interact.on_interact', {}, s(o, 'target'))], [B('audio.play', { sound: 'click', volume: '70' }), B('ui.show_message', { text: '"Knock knock!"', seconds: '1.5' })])],
      notes: ['Replace the message with what should happen: start a dialogue, open a door, give an item...'],
    }),
  },

  // ======================= Enemy AI
  {
    id: 'ai.chaser', name: 'Chase & attack', icon: '👹', category: 'Enemy AI',
    description: 'Enemies wander near home, chase the player when they see them, attack up close with a cooldown, and give up when the player escapes.',
    options: [obj('enemy', 'Enemy object', 'Enemy'), obj(), num('see', 'Sight range', 10), num('attack', 'Attack range', 1.6), num('damage', 'Damage', 10), num('cooldown', 'Seconds between attacks', 1), num('patrol', 'Wander radius', 5), num('speed', 'Speed', 3.5)],
    build: (o) => {
      const en = s(o, 'enemy'), pl = s(o, 'player');
      const st = (v: string, inv = false) => B('object.compare_var', { variable: 'state', op: inv ? '<>' : '=', value: `"${v}"` }, en);
      return {
        behaviors: [{ target: en, type: 'pathfinding', props: { maxSpeed: Number(o.speed) } }, { target: en, type: 'health', props: { maxHp: 50, hp: 50 } }, { target: pl, type: 'health' }],
        vars: [{ target: en, vars: { state: 'patrol', cooldown: 0 } }],
        events: [
          E([B('system.on_start_of_layout')], [B('ai.set_state', { state: 'patrol' }, en)]),
          E([B('system.every_tick')], [B('object.add_var', { variable: 'cooldown', value: '-dt' }, en)]),
          // Notice the player.
          E([B('timer.every_x_seconds', { seconds: '0.3' }), st('patrol'), B('object.is_within_distance', { distance: n(o, 'see'), other: pl }, en), B('pathfinding.has_line_of_sight', { other: pl }, en)], [B('ai.set_state', { state: 'chase' }, en), B('looks.say', { text: '"!"', seconds: '0.8' }, en)]),
          E([B('timer.every_x_seconds', { seconds: '3' }), st('patrol')], [B('ai.patrol', { radius: n(o, 'patrol') }, en)]),
          // Chase, re-planning a few times a second.
          E([B('timer.every_x_seconds', { seconds: '0.4' }), st('chase')], [B('pathfinding.move_to_object', { other: pl }, en)]),
          E([B('timer.every_x_seconds', { seconds: '0.5' }), st('chase'), B('object.is_within_distance', { distance: String(Number(o.see) * 1.6), other: pl }, en, { invert: true })], [B('ai.set_state', { state: 'patrol' }, en), B('pathfinding.stop', {}, en)]),
          // Attack.
          E([B('system.every_tick'), running(), st('chase'), B('object.is_within_distance', { distance: n(o, 'attack'), other: pl }, en), B('object.compare_var', { variable: 'cooldown', op: '<=', value: '0' }, en)],
            [B('object.set_var', { variable: 'cooldown', value: n(o, 'cooldown') }, en), B('anim.play', { name: 'attack', loop: 'once' }, en), B('health.damage', { amount: n(o, 'damage') }, pl), B('combat.knockback', { other: pl, strength: '6' }, en), B('audio.play', { sound: 'hit', volume: '70' })]),
          E([B('health.on_died', {}, en)], [B('particles.spawn_at', { preset: 'explosion' }, en), B('audio.play', { sound: 'explosion', volume: '60' }), B('object.destroy', {}, en)]),
        ],
        notes: [`"${en}" uses Pathfinding, so walls need the Solid behavior. Play an "attack" animation role on the model if it has one.`],
      };
    },
  },
  {
    id: 'ai.walker', name: 'Platformer walker', icon: '🐌', category: 'Enemy AI', modes: ['2d'],
    description: 'Walks left and right, turns at walls, hurts the player on touch, and is defeated by jumping on its head.',
    options: [obj('enemy', 'Enemy object', 'Enemy'), obj(), num('speed', 'Walk speed', 2), num('damage', 'Damage on touch', 10)],
    build: (o) => {
      const en = s(o, 'enemy'), pl = s(o, 'player');
      const dir = (d: number) => B('object.compare_var', { variable: 'dir', op: '=', value: String(d) }, en);
      return {
        behaviors: [{ target: en, type: 'platform', props: { maxSpeed: Number(o.speed), defaultControls: false }, replaces: MOVERS }, { target: pl, type: 'health' }],
        vars: [{ target: en, vars: { dir: 1 } }],
        events: [
          E([B('system.every_tick'), dir(1)], [B('platform.simulate_control', { control: 'right' }, en)]),
          E([B('system.every_tick'), dir(-1)], [B('platform.simulate_control', { control: 'left' }, en)]),
          E([B('system.every_tick'), B('physics.detect_wall', { distance: '0.6' }, en)], [B('object.set_var', { variable: 'dir', value: '-Self.dir' }, en)]),
          // Stomp: the player lands on top while falling.
          E([B('object.on_collision', { other: en }, pl), B('platform.is_falling', {}, pl), B('object.compare_property', { property: 'Y', op: '>', value: `${en}.Y + 0.3` }, pl)], [B('platform.jump', {}, pl), B('particles.spawn_at', { preset: 'explosion' }, en), B('audio.play', { sound: 'hit' }), B('object.destroy', {}, en)]),
          E([B('object.on_collision', { other: en }, pl)], [B('health.damage', { amount: n(o, 'damage') }, pl), B('combat.knockback', { other: pl, strength: '8' }, en)], [], { isElse: true }),
        ],
      };
    },
  },
  {
    id: 'ai.turret', name: 'Turret / shooter', icon: '🗼', category: 'Enemy AI',
    description: 'Turns toward the player in range and fires projectiles at a steady rate.',
    options: [obj('enemy', 'Turret object', 'Turret'), obj(), num('range', 'Range', 12), num('rate', 'Seconds between shots', 1.2), num('damage', 'Damage per shot', 10), { key: 'bullet', label: 'Projectile object', type: 'objectType', default: 'EnemyBullet' }],
    build: (o, c) => {
      const en = s(o, 'enemy'), pl = s(o, 'player'), bu = s(o, 'bullet');
      return {
        behaviors: [{ target: pl, type: 'health' }],
        templates: [{ type: bu, kind: 'sphere', data: { sx: 0.25, sy: 0.25, sz: 0.25, color: '#ff5533', behaviors: [{ type: 'bullet', props: { ...behaviorDefaults('bullet'), speed: 14, lifetime: 3 } }], ...(c.mode === '2d' ? {} : { material: { roughness: 0.4, metalness: 0, emissive: '#ff3311', emissiveStrength: 3 } }) } }],
        events: [
          E([B('system.every_tick'), running(), B('object.is_within_distance', { distance: n(o, 'range'), other: pl }, en)], [B('object.look_at', { other: pl }, en)], [
            E([B('timer.every_x_seconds', { seconds: n(o, 'rate') })], [B('combat.shoot', { object: bu, speed: '14', spread: '3', damage: n(o, 'damage') }, en), B('audio.play_at', { sound: 'shoot', volume: '50' }, en)]),
          ]),
        ],
      };
    },
  },
  {
    id: 'ai.flee', name: 'Skittish critter', icon: '🐇', category: 'Enemy AI',
    description: 'Wanders around and runs away when the player comes close. Good for animals and collectibles that escape.',
    options: [obj('enemy', 'Critter object', 'Critter'), obj(), num('scare', 'Scare distance', 5), num('speed', 'Speed', 5)],
    build: (o) => {
      const en = s(o, 'enemy'), pl = s(o, 'player');
      return {
        behaviors: [{ target: en, type: 'pathfinding', props: { maxSpeed: Number(o.speed) } }],
        events: [
          E([B('timer.every_x_seconds', { seconds: '0.5' }), B('object.is_within_distance', { distance: n(o, 'scare'), other: pl }, en)], [B('ai.flee', { other: pl, distance: String(Number(o.scare) * 1.5) }, en)]),
          E([B('timer.every_x_seconds', { seconds: '4' }), B('object.is_within_distance', { distance: n(o, 'scare'), other: pl }, en, { invert: true })], [B('ai.patrol', { radius: '4' }, en)]),
        ],
      };
    },
  },

  {
    id: 'ai.slime', name: 'Slime', icon: '◒', category: 'Enemy AI',
    description: 'Hops around, spots the player, hops after them and hurts on contact. Defeat it to see it go. Uses the Slime enemy behavior (all settings in the Inspector).',
    options: [obj('enemy', 'Slime object', 'Slime'), obj(), num('see', 'Spot range', 7), num('damage', 'Damage on touch', 10), num('hp', 'Slime health', 30), { key: 'side', label: 'Side view (2D platformer)', type: 'boolean', default: false }],
    build: (o, c) => {
      const en = s(o, 'enemy'), pl = s(o, 'player');
      return {
        behaviors: [
          { target: en, type: 'slime', props: { target: pl, detectRange: Number(o.see), damage: Number(o.damage), sideView: c.mode === '2d' && !!o.side }, replaces: [...MOVERS, 'pathfinding', 'flyer', 'wander'] },
          { target: en, type: 'health', props: { maxHp: Number(o.hp), hp: Number(o.hp) } }, { target: pl, type: 'health' },
        ],
        events: [
          E([B('enemy.on_spotted', {}, en)], [B('looks.say', { text: '"!"', seconds: '0.6' }, en)]),
          E([B('enemy.on_attack', {}, en)], [B('audio.play', { sound: 'hit', volume: '60' }), ...(c.mode === '3d' ? [B('camera.shake', { intensity: '0.12', duration: '0.15' })] : [])]),
          E([B('health.on_died', {}, en)], [B('particles.spawn_at', { preset: 'magic' }, en), B('audio.play', { sound: 'pickup', volume: '60' })]),
        ],
        notes: [`Hurt the slime with any attack (Melee / Ranged packs, or "Deal damage").`, c.mode === '3d' ? 'Slimes need a Solid floor to land on.' : 'In side view the slime needs a Solid floor.'],
      };
    },
  },
  {
    id: 'ai.flyer', name: 'Flying enemy', icon: '⋎', category: 'Enemy AI',
    description: 'Hovers at a height, roams the air, chases the player and swoops down to attack, then climbs back up. Falls when defeated. Uses the Flying enemy behavior.',
    options: [obj('enemy', 'Flying object', 'Bat'), obj(), num('height', 'Flight height', 3), num('see', 'Spot range', 10), num('damage', 'Damage per swoop', 10), num('hp', 'Health', 20)],
    build: (o) => {
      const en = s(o, 'enemy'), pl = s(o, 'player');
      return {
        behaviors: [
          { target: en, type: 'flyer', props: { target: pl, height: Number(o.height), detectRange: Number(o.see), damage: Number(o.damage) }, replaces: [...MOVERS, 'pathfinding', 'slime', 'wander', 'physics'] },
          { target: en, type: 'health', props: { maxHp: Number(o.hp), hp: Number(o.hp) } }, { target: pl, type: 'health' },
        ],
        events: [
          E([B('enemy.on_attack', {}, en)], [B('audio.play', { sound: 'swing', volume: '60' })]),
          E([B('health.on_died', {}, en)], [B('particles.spawn_at', { preset: 'smoke' }, en)]),
        ],
      };
    },
  },

  {
    id: 'combat.breakable', name: 'Breakable object', icon: '✧', category: 'Combat',
    description: 'Crates, vases, glass and walls that shatter into many pieces of themselves when hit, shot, knocked into or destroyed (like Blender\'s Cell Fracture).',
    options: [obj('target', 'Breakable object', 'Crate'), num('durability', 'Durability (damage to break)', 20), num('pieces', 'Pieces (up to 1000)', 150), num('impact', 'Breaks when hit at (m/s)', 4), { key: 'particles', label: 'Dust when it breaks', type: 'boolean', default: true }, { key: 'loot', label: 'Leaves loot (object type, optional)', type: 'text', default: '' }],
    build: (o) => {
      const t = s(o, 'target');
      return {
        behaviors: [{ target: t, type: 'breakable', props: { durability: Number(o.durability), pieces: Math.max(2, Math.min(1000, Number(o.pieces))), impactSpeed: Number(o.impact), particles: o.particles ? 'smoke' : '', debris: s(o, 'loot') } }],
        events: [
          E([B('breakable.on_damaged', {}, t)], [B('audio.play_at', { sound: 'hit', volume: '50' }, t)]),
          E([B('breakable.on_broken', {}, t)], [B('system.log', { message: `"${t} smashed!"` })]),
        ],
        notes: [`Attacks, projectiles, "Deal damage", fast objects (thrown crates, cars, running players) and "Destroy object" all shatter "${t}". Settings are on its Breakable behavior.`],
      };
    },
  },

  // ======================= NPCs
  {
    id: 'npc.path', name: 'Path walker NPC', icon: '⤳', category: 'NPCs',
    description: 'Walks a route you draw in the scene: loop, back and forth, or once. Select the NPC and use "Draw path" in its Path section, then set waits on any point.',
    options: [obj('npc', 'NPC object', 'NPC'), num('speed', 'Walk speed', 2.5), { key: 'mode', label: 'At the end', type: 'choice', default: 'loop', options: ['loop', 'back and forth', 'stop'] }, num('wait', 'Wait at each point (s)', 0)],
    build: (o) => ({
      behaviors: [{ target: s(o, 'npc'), type: 'pathfollow', props: { speed: Number(o.speed), mode: s(o, 'mode'), wait: Number(o.wait) }, replaces: [...MOVERS, 'pathfinding', 'wander'] }],
      events: [E([B('npc.on_path_end', {}, s(o, 'npc'))], [B('system.log', { message: `"${s(o, 'npc')} finished its route"` })])],
      notes: [`Select "${s(o, 'npc')}" and click "Draw path" in the Inspector, then click in the scene to place points (Esc to finish).`],
    }),
  },
  {
    id: 'npc.wander', name: 'Wandering NPC', icon: '∾', category: 'NPCs',
    description: 'Strolls randomly around where it was placed, stopping now and then. Good for villagers, animals and crowds.',
    options: [obj('npc', 'NPC object', 'NPC'), num('radius', 'Wander radius', 5), num('speed', 'Walk speed', 1.8), num('idle', 'Longest pause (s)', 4)],
    build: (o) => ({
      behaviors: [{ target: s(o, 'npc'), type: 'wander', props: { radius: Number(o.radius), speed: Number(o.speed), maxWait: Number(o.idle) }, replaces: [...MOVERS, 'pathfinding', 'pathfollow'] }],
      events: [],
      notes: ['All wander settings (pauses, animations) are on the Wander behavior in the Inspector.'],
    }),
  },
  {
    id: 'npc.talker', name: 'Friendly NPC (talks to you)', icon: '❝', category: 'NPCs',
    description: 'Now and then walks up to the player and starts a conversation; the player can also walk up and press E. Then it goes back to wandering (or its path).',
    options: [obj('npc', 'NPC object', 'NPC'), obj(), { key: 'dialogue', label: 'Dialogue (from the Dialogue editor)', type: 'text', default: '' }, num('range', 'Notices player within', 6), num('chance', 'Chance to come over (%)', 50), { key: 'key', label: 'Talk key', type: 'text', default: 'E' }, { key: 'roam', label: 'Wander when not talking', type: 'boolean', default: true }],
    build: (o) => {
      const npc = s(o, 'npc');
      return {
        behaviors: [
          { target: npc, type: 'npctalk', props: { target: s(o, 'player'), dialogue: s(o, 'dialogue'), detectRange: Number(o.range), chance: Number(o.chance), talkKey: s(o, 'key') } },
          ...(o.roam ? [{ target: npc, type: 'wander', props: {}, replaces: [...MOVERS, 'pathfinding'] }] : []),
        ],
        events: [
          E([B('npc.on_approach', {}, npc)], [B('looks.say', { text: '"Hey!"', seconds: '1' }, npc)]),
          ...(s(o, 'dialogue') ? [] : [E([B('npc.on_interact', {}, npc)], [B('looks.say', { text: '"Nice day, isn\'t it?"', seconds: '2.5' }, npc)])]),
        ],
        notes: [s(o, 'dialogue') ? `It opens the "${s(o, 'dialogue')}" dialogue - make sure it exists in the Dialogue editor.` : 'No dialogue chosen: it says a line instead. Pick a dialogue later in the NPC interaction behavior.'],
      };
    },
  },

  {
    id: 'ai.enemy', name: 'Enemy', icon: '👹', category: 'Enemy AI',
    description: 'A regular enemy: wanders, chases the player on sight, goes around walls, attacks in reach and dies. Everything is on its Enemy and Health behaviors, ready to tune.',
    options: [{ key: 'enemy', label: 'Enemy object', type: 'objectType', default: 'Enemy' }, obj('player', 'Hunts'), num('hp', 'Health', 50), num('damage', 'Attack damage', 10), num('speed', 'Chase speed (m/s)', 3.5), num('detect', 'Sees the player within (m)', 10)],
    build: (o, c) => {
      const en = s(o, 'enemy');
      return {
        behaviors: [{ target: en, type: 'enemy', props: { target: s(o, 'player'), damage: Number(o.damage), speed: Number(o.speed), detectRange: Number(o.detect) }, replaces: MOVERS }, { target: en, type: 'health', props: { maxHp: Number(o.hp), hp: Number(o.hp) } }],
        objects: [enemyObject(en, c.mode, { x: 5 })],
        events: [],
        notes: [`Your own model or sprite can be swapped in: only ${en}'s Enemy and Health behaviors matter.`],
      };
    },
  },
  {
    id: 'ai.spawner', name: 'Enemy Spawner', icon: '🏭', category: 'Enemy AI',
    description: 'Enemies appear here again and again, up to a limit at a time. Move the spawner object where you want them to come from.',
    options: [{ key: 'enemy', label: 'Enemy object', type: 'objectType', default: 'Enemy' }, obj('player', 'They hunt'), num('every', 'Every (s)', 4), num('count', 'How many each time', 1), num('maxAlive', 'Most at once', 5), num('radius', 'Within (m)', 2)],
    build: (o, c) => {
      const en = s(o, 'enemy');
      return {
        templates: [enemyObject(en, c.mode, {})],
        behaviors: [{ target: en, type: 'enemy', props: { target: s(o, 'player') }, replaces: MOVERS }, { target: en, type: 'health' }, { target: 'EnemySpawner', type: 'spawner', props: { object: en, every: Number(o.every), count: Number(o.count), maxAlive: Number(o.maxAlive), radius: Number(o.radius) } }],
        objects: [spawnerObject('EnemySpawner', c.mode)],
        events: [],
        notes: ['The EnemySpawner object marks where they come from. Copy it for more spawn points.'],
      };
    },
  },
  {
    id: 'items.spawner', name: 'Object Spawner', icon: '📦', category: 'Inventory & items',
    description: 'Any object appears here again and again: pickups, crates, falling rocks. Choose the object and how often.',
    options: [{ key: 'object', label: 'Object to make', type: 'objectType', default: 'Pickup' }, num('every', 'Every (s)', 5), num('count', 'How many each time', 1), num('maxAlive', 'Most at once (0 = no limit)', 5), num('total', 'Stop after (0 = never)', 0), num('radius', 'Within (m)', 2)],
    build: (o, c) => {
      const ob = s(o, 'object');
      return {
        templates: [{ type: ob, kind: c.mode === '3d' ? 'box' : 'sprite', data: c.mode === '3d' ? { sx: 0.6, sy: 0.6, sz: 0.6, color: '#f5c542', collider: { shape: 'box', size: [1, 1, 1], offset: [0, 0, 0] } } : { color: '#f5c542' } }],
        behaviors: [{ target: 'ObjectSpawner', type: 'spawner', props: { object: ob, every: Number(o.every), count: Number(o.count), maxAlive: Number(o.maxAlive), total: Number(o.total), radius: Number(o.radius) } }],
        objects: [spawnerObject('ObjectSpawner', c.mode)],
        events: [],
        notes: [`If there was no "${ob}" object yet, a plain one was made as a spawn-only type: change it in the Outliner's object types, or pick another object in the Spawner behavior.`],
      };
    },
  },
  {
    id: 'npc.follower', name: 'Follower (pet or companion)', icon: '🐾', category: 'NPCs',
    description: 'A pet or friend that follows the player: stays close, runs to catch up, goes around walls. A key tells it to stay or come along.',
    options: [{ key: 'pet', label: 'Follower object', type: 'objectType', default: 'Pet' }, obj('player', 'Follows'), num('distance', 'Keeps this close (m)', 2), num('speed', 'Walk speed (m/s)', 4), key('key', 'Stay / follow key', 'T'),
      { key: 'side', label: 'Where it walks', type: 'choice', default: 'behind', options: ['behind', 'left', 'right', 'ahead', 'nearest'] }, { key: 'flying', label: 'Flying', type: 'boolean', default: false },
      { key: 'attack', label: 'Attacks nearby enemies, then returns', type: 'boolean', default: false }, { key: 'enemy', label: 'Enemy object', type: 'objectType', default: 'Enemy' }, num('damage', 'Attack damage', 10),
      { key: 'takesDamage', label: 'Takes damage', type: 'boolean', default: false }],
    build: (o, c) => {
      const pet = s(o, 'pet'), pl = s(o, 'player');
      return {
        behaviors: [
          { target: pet, type: 'follower', props: { target: pl, distance: Number(o.distance), speed: Number(o.speed), runSpeed: Number(o.speed) * 2, side: s(o, 'side'), flying: !!o.flying, attack: !!o.attack, enemy: s(o, 'enemy'), attackDamage: Number(o.damage), takesDamage: !!o.takesDamage } },
          ...(o.takesDamage ? [{ target: pet, type: 'health' }] : []),
        ],
        objects: [{ type: pet, kind: c.mode === '3d' ? 'sphere' : 'sprite', data: c.mode === '3d' ? { x: 2, y: 0.5, sx: 0.6, sy: 0.6, sz: 0.6, color: '#f0a84a', collider: { shape: 'box', size: [1, 1, 1], offset: [0, 0, 0] } } : { x: 2, y: 2, color: '#f0a84a' } }],
        events: [
          E([B('input.on_key_pressed', { key: s(o, 'key') }), running()], [], [
            E([B('follower.is_following', {}, pet)], [B('follower.stay', {}, pet)]),
            E([], [B('follower.follow', {}, pet)], [], { isElse: true }),
          ]),
        ],
        notes: [`Press ${s(o, 'key')} in the game to tell ${pet} to stay or follow. Swap in your own model or sprite: only the object's Follower behavior matters.`],
      };
    },
  },

  // ======================= Health & HUD
  {
    id: 'hud.healthbar', name: 'Health bar', icon: '❤️', category: 'Health & HUD',
    description: 'A HUD bar showing the player\'s health, a red flash and shake when hurt, and a game-over screen at zero.',
    options: [obj(), num('max', 'Max health', 100), { key: 'color', label: 'Bar color', type: 'choice', default: '#e5484d', options: ['#e5484d', '#3fd17a', '#f5a524', '#4aa3ff'] }, { key: 'look', label: 'Look (double-click it later to change)', type: 'choice', default: 'bar', options: ['bar', 'ticks', 'hearts'] }, { key: 'gameOver', label: 'Game over at zero', type: 'boolean', default: true }],
    build: (o) => {
      const pl = s(o, 'player'), bar = pl + 'HealthBar', look = (s(o, 'look') || 'bar') as 'bar' | 'ticks' | 'hearts';
      return {
        behaviors: [{ target: pl, type: 'health', props: { maxHp: Number(o.max), hp: Number(o.max), invulnerableTime: 0.5 } }],
        objects: [hud(bar, 'Health', 'tl', 16, 16, { color: s(o, 'color'), barStyle: { kind: look, label: look === 'bar' } })],
        notes: ['Double-click the bar in the viewport to change its look: regular bar, tick bar, hearts or your own picture, and its text, font and background. Menus work the same way.'],
        events: [
          E([B('system.every_tick')], [B('ui.set_bar', { value: `${pl}.Health.HP`, max: `${pl}.Health.MaxHP` }, bar)]),
          E([B('health.on_damaged', {}, pl)], [B('camera.shake', { intensity: '0.2', duration: '0.2' }), B('object.set_opacity', { value: '50' }, pl), B('anim.tween', { property: 'Opacity' as any, value: '100', duration: '0.3', ease: 'easeOut' }, pl)]),
          ...(o.gameOver ? [E([B('health.on_died', {}, pl)], [B('audio.play', { sound: 'explosion' }), B('game.defeat', { title: '"Game over"', message: '"Press Restart to try again"' })])] : []),
        ],
      };
    },
  },
  {
    id: 'hud.score', name: 'Coins & score', icon: '🪙', category: 'Health & HUD',
    description: 'Collect coins for points with a sound and sparkle; the score shows on screen and the best score is saved.',
    options: [obj(), { key: 'coin', label: 'Coin object', type: 'objectType', default: 'Coin' }, num('points', 'Points per coin', 1)],
    build: (o) => {
      const pl = s(o, 'player'), co = s(o, 'coin');
      return {
        globals: [gv('score', 0, 'Points from coins'), gv('best', 0, 'Best score (saved)')],
        behaviors: [{ target: co, type: 'rotate', props: { speed: 120 } }],
        objects: [hud('ScoreText', 'Score: 0', 'tr', -16, 16, { align: 'right', size: 26, style: { bold: true, outline: '#000000', outlineWidth: 3 } })],
        events: [
          E([B('system.on_start_of_layout')], [B('game.load', { slot: 'best' })]),
          E([B('object.on_collision', { other: co }, pl)], [B('var.add', { variable: 'score', value: n(o, 'points') }), B('particles.spawn_at', { preset: 'coin' }, co), B('audio.play', { sound: 'coin' }), B('object.destroy', {}, co)], [
            E([B('system.compare_variable', { variable: 'score', op: '>', value: 'best' })], [B('var.set', { variable: 'best', value: 'score' }), B('game.save', { slot: 'best' })]),
          ]),
          E([B('system.every_tick')], [B('ui.set_text', { text: '"Score: " & score & "   Best: " & best' }, 'ScoreText')]),
        ],
      };
    },
  },
  {
    id: 'hud.feedback', name: 'Hit feedback', icon: '💥', category: 'Health & HUD',
    description: 'Any object with Health shows the damage it took, flashes, and throws sparks when hit.',
    options: [obj('target', 'Object', 'Enemy')],
    build: (o) => {
      const t = s(o, 'target');
      return {
        behaviors: [{ target: t, type: 'health' }],
        vars: [{ target: t, vars: { lastHp: 100 } }],
        events: [
          E([B('system.on_start_of_layout')], [B('object.set_var', { variable: 'lastHp', value: 'Self.Health.HP' }, t)]),
          E([B('health.on_damaged', {}, t)], [B('looks.say', { text: '"-" & round(Self.lastHp - Self.Health.HP)', seconds: '0.6' }, t), B('object.set_var', { variable: 'lastHp', value: 'Self.Health.HP' }, t), B('particles.spawn_at', { preset: 'sparks' }, t), B('object.set_opacity', { value: '40' }, t), B('anim.tween', { property: 'Opacity' as any, value: '100', duration: '0.25', ease: 'easeOut' }, t)]),
        ],
      };
    },
  },

  // ======================= Inventory & items
  {
    id: 'items.inventory', name: 'Inventory', icon: '🎒', category: 'Inventory & items',
    description: 'Walk into pickups to collect them into a list; press the key to open the inventory. Doors and logic can check "list contains".',
    options: [obj(), { key: 'pickup', label: 'Pickup object', type: 'objectType', default: 'Pickup' }, key('key', 'Open inventory key', 'I'), num('slots', 'Max items', 8)],
    build: (o) => {
      const pl = s(o, 'player'), pk = s(o, 'pickup');
      return {
        globals: [gv('inventory', [], 'Item names the player carries')],
        vars: [{ target: pk, vars: { item: 'Key' } }],
        behaviors: [{ target: pk, type: 'sine', props: { movement: 'vertical', magnitude: 0.15, period: 1.6 } }],
        objects: [
          hud('InventoryPanel', 'Inventory', 'cc', 0, 0, { size: 20, align: 'center', style: { bg: '#0c0b08', bgOpacity: 0.85, padding: 14, radius: 8, border: '#ffffff', borderWidth: 1, maxWidth: 360 } }, { tags: ['inventory'], visible: false }),
          hud('ItemHint', '', 'bc', 0, -40, { size: 18, align: 'center', style: { shadow: '#000000', shadowBlur: 4 } }),
        ],
        events: [
          E([B('system.on_start_of_layout')], [B('ui.hide_menu', { tag: 'inventory' })]),
          E([B('object.on_collision', { other: pk }, pl)], [], [
            E([B('system.compare_values', { a: 'len(inventory)', op: '<', b: n(o, 'slots') })], [B('list.push', { variable: 'inventory', value: `${pk}.item` }), B('ui.set_text', { text: `"Picked up " & ${pk}.item` }, 'ItemHint'), B('audio.play', { sound: 'pickup' }), B('object.destroy', {}, pk)]),
            E([], [B('ui.set_text', { text: '"Inventory full"' }, 'ItemHint')], [], { isElse: true }),
          ]),
          E([B('input.on_key_pressed', { key: s(o, 'key') })], [B('var.toggle', { variable: 'invOpen' })], [
            E([B('system.is_boolean_set', { variable: 'invOpen' })], [B('ui.show_menu', { tag: 'inventory' })]),
            E([], [B('ui.hide_menu', { tag: 'inventory' })], [], { isElse: true }),
          ]),
          E([B('system.every_tick')], [B('ui.set_text', { text: `"INVENTORY (" & len(inventory) & "/${n(o, 'slots')})\\n" & (len(inventory) ? inventory : "empty")` }, 'InventoryPanel')]),
        ],
        notes: [`Set each "${pk}" object's "item" variable to its name (Key, Potion...). Check it with "List contains" (inventory, "Key").`],
      };
    },
  },
  {
    id: 'items.door', name: 'Locked door', icon: '🚪', category: 'Inventory & items',
    description: 'A door that opens with E when the player carries the right item (uses the Inventory pack\'s list).',
    options: [obj(), { key: 'door', label: 'Door object', type: 'objectType', default: 'Door' }, { key: 'item', label: 'Needed item', type: 'text', default: 'Key' }, key('key', 'Use key', 'E')],
    build: (o) => {
      const pl = s(o, 'player'), d = s(o, 'door'), item = s(o, 'item').replace(/"/g, '');
      return {
        globals: [gv('inventory', [])],
        behaviors: [{ target: d, type: 'solid' }],
        events: [
          E([B('input.on_key_pressed', { key: s(o, 'key') }), B('object.is_within_distance', { distance: '2.5', other: pl }, d)], [], [
            E([B('list.contains', { variable: 'inventory', value: `"${item}"` })], [B('behavior.set_enabled', { behavior: 'solid', state: 'disabled' }, d), B('anim.tween', { property: 'Opacity' as any, value: '0', duration: '0.5', ease: 'easeOut' }, d), B('list.remove_value', { variable: 'inventory', value: `"${item}"` }), B('audio.play', { sound: 'pickup' })]),
            E([], [B('ui.show_message', { text: `"You need: ${item}"`, seconds: '1.5' })], [], { isElse: true }),
          ]),
        ],
      };
    },
  },
  {
    id: 'items.consumable', name: 'Health potions', icon: '🧪', category: 'Inventory & items',
    description: 'Potions heal on pickup, or are stored and drunk with a key when "store" is on.',
    options: [obj(), { key: 'potion', label: 'Potion object', type: 'objectType', default: 'Potion' }, num('heal', 'Heal amount', 30), { key: 'store', label: 'Store instead of drinking', type: 'boolean', default: false }, key('key', 'Drink key', 'Q')],
    build: (o) => {
      const pl = s(o, 'player'), po = s(o, 'potion');
      return o.store ? {
        globals: [gv('potions', 0)], behaviors: [{ target: pl, type: 'health' }],
        events: [
          E([B('object.on_collision', { other: po }, pl)], [B('var.add', { variable: 'potions', value: '1' }), B('audio.play', { sound: 'pickup' }), B('object.destroy', {}, po)]),
          E([B('input.on_key_pressed', { key: s(o, 'key') }), B('system.compare_variable', { variable: 'potions', op: '>', value: '0' })], [B('var.subtract', { variable: 'potions', value: '1' }), B('health.heal', { amount: n(o, 'heal') }, pl), B('particles.spawn_at', { preset: 'magic' }, pl)]),
        ],
      } : {
        behaviors: [{ target: pl, type: 'health' }],
        events: [E([B('object.on_collision', { other: po }, pl)], [B('health.heal', { amount: n(o, 'heal') }, pl), B('particles.spawn_at', { preset: 'magic' }, pl), B('audio.play', { sound: 'pickup' }), B('object.destroy', {}, po)])],
      };
    },
  },

  // ======================= Combat
  {
    id: 'combat.melee', name: 'Melee attack', icon: '🗡️', category: 'Combat',
    description: 'Swing at enemies in front of you with a cooldown, an attack animation and knockback.',
    options: [obj(), { key: 'enemy', label: 'Enemy object', type: 'objectType', default: 'Enemy' }, key('key', 'Attack key', 'J'), { key: 'mouse', label: 'Also left mouse button', type: 'boolean', default: true }, num('damage', 'Damage', 25), num('range', 'Reach', 2.2), num('cooldown', 'Cooldown (s)', 0.45)],
    build: (o) => {
      const pl = s(o, 'player'), en = s(o, 'enemy');
      const swing = [B('object.set_var', { variable: 'attackCd', value: n(o, 'cooldown') }, pl), B('anim.play', { name: 'attack', loop: 'once' }, pl), B('combat.melee', { victims: en, range: n(o, 'range'), arc: '120', damage: n(o, 'damage') }, pl), B('audio.play', { sound: 'throw', volume: '60' })];
      const ready = B('object.compare_var', { variable: 'attackCd', op: '<=', value: '0' }, pl);
      return {
        vars: [{ target: pl, vars: { attackCd: 0 } }],
        behaviors: [{ target: en, type: 'health' }],
        events: [
          E([B('system.every_tick')], [B('object.add_var', { variable: 'attackCd', value: '-dt' }, pl)]),
          E([B('input.on_key_pressed', { key: s(o, 'key') }), ready, running()], swing),
          ...(o.mouse ? [E([B('input.on_mouse_click', { button: 'left' }), ready, running()], swing)] : []),
          E([B('combat.on_hit', {}, en)], [B('combat.knockback', { other: en, strength: '6' }, pl), B('particles.spawn_at', { preset: 'sword' }, en)]),
        ],
      };
    },
  },
  {
    id: 'combat.ranged', name: 'Ranged weapon', icon: '🔫', category: 'Combat',
    description: 'Shoot projectiles with a fire rate and limited ammo; reload with R.',
    options: [obj(), key('key', 'Fire key', 'K'), { key: 'mouse', label: 'Also left mouse button', type: 'boolean', default: true }, num('damage', 'Damage', 20), num('rate', 'Seconds between shots', 0.2), num('ammo', 'Magazine size', 12), { key: 'bullet', label: 'Projectile object', type: 'objectType', default: 'Bullet' }],
    build: (o, c) => {
      const pl = s(o, 'player'), bu = s(o, 'bullet');
      const can = [B('object.compare_var', { variable: 'fireCd', op: '<=', value: '0' }, pl), B('system.compare_variable', { variable: 'ammo', op: '>', value: '0' }), running()];
      const fire = [B('object.set_var', { variable: 'fireCd', value: n(o, 'rate') }, pl), B('var.subtract', { variable: 'ammo', value: '1' }), B('combat.shoot', { object: bu, speed: '30', spread: '1.5', damage: n(o, 'damage') }, pl), B('audio.play', { sound: 'shoot', volume: '55' })];
      return {
        globals: [gv('ammo', Number(o.ammo), 'Shots left in the magazine')],
        vars: [{ target: pl, vars: { fireCd: 0 } }],
        templates: [{ type: bu, kind: 'sphere', data: { sx: 0.15, sy: 0.15, sz: 0.15, color: '#ffd84a', behaviors: [{ type: 'bullet', props: { ...behaviorDefaults('bullet'), speed: 30, lifetime: 2 } }], ...(c.mode === '2d' ? {} : { material: { roughness: 0.4, metalness: 0, emissive: '#ffcc33', emissiveStrength: 4 } }) } }],
        objects: [hud('AmmoText', 'Ammo', 'br', -16, -16, { align: 'right', size: 22, style: { bold: true, shadow: '#000000', shadowBlur: 4 } })],
        events: [
          E([B('system.every_tick')], [B('object.add_var', { variable: 'fireCd', value: '-dt' }, pl), B('ui.set_text', { text: '"Ammo " & ammo & " / ' + n(o, 'ammo') + '"' }, 'AmmoText')]),
          E([B('input.key_is_down', { key: s(o, 'key') }), ...can], fire),
          ...(o.mouse ? [E([B('input.mouse_is_down', { button: 'left' }), ...can], fire)] : []),
          E([B('input.on_key_pressed', { key: 'R' })], [B('var.set', { variable: 'ammo', value: n(o, 'ammo') }), B('audio.play', { sound: 'pickup', volume: '50' }), B('ui.show_message', { text: '"Reloaded"', seconds: '0.8' })]),
        ],
      };
    },
  },
  {
    id: 'combat.lockon', name: 'Player Lock-On / Dash Attack', icon: '🎯', category: 'Combat', apps: ['gamecraft'],
    description: 'Click an enemy: a red circle appears on it, your character dashes to it without passing through walls and attacks on arrival. Also keys and gamepad buttons (input actions LockOn, SwitchTarget, DashAttack).',
    options: [obj(), { key: 'enemy', label: 'Enemy object', type: 'objectType', default: 'Enemy' }, { key: 'click', label: 'Click an enemy to lock on and dash', type: 'boolean', default: true }, key('lockKey', 'Lock-on key', 'F'), key('switchKey', 'Switch target key', 'G'), key('dashKey', 'Dash attack key', 'E'),
      num('range', 'Lock-on key range (m); a click reaches what you can see', 15), num('angle', 'Target angle (360 = all around)', 120), num('dashSpeed', 'Dash speed (m/s)', 18), num('dashCooldown', 'Dash cooldown (s)', 1), num('attackDistance', 'Attack distance (m)', 1.6), num('damage', 'Damage', 30)],
    build: (o) => {
      const pl = s(o, 'player'), en = s(o, 'enemy');
      return {
        behaviors: [{ target: en, type: 'health' }],
        inputActions: { LockOn: [s(o, 'lockKey'), 'pad:LB'], SwitchTarget: [s(o, 'switchKey'), 'pad:Y'], DashAttack: [s(o, 'dashKey'), 'pad:RB'] },
        events: [
          E([B('system.on_start_of_layout')], [
            B('lockon.set_range', { value: n(o, 'range') }, pl), B('lockon.set_angle', { value: n(o, 'angle') }, pl), B('lockon.set_dash_speed', { value: n(o, 'dashSpeed') }, pl),
            B('lockon.set_dash_cooldown', { value: n(o, 'dashCooldown') }, pl), B('lockon.set_attack_distance', { value: n(o, 'attackDistance') }, pl), B('lockon.set_attack_damage', { value: n(o, 'damage') }, pl),
          ]),
          ...(o.click !== false ? [E([B('input.on_mouse_click', { button: 'left' }), running()], [B('lockon.click_target', { targets: en, dash: true }, pl)])] : []),
          E([B('input.action_began', { action: 'LockOn' }), running()], [], [
            E([B('lockon.is_valid', {}, pl)], [B('lockon.clear', {}, pl)]),
            E([], [B('lockon.acquire', { targets: en }, pl)], [], { isElse: true }),
          ]),
          E([B('input.action_began', { action: 'SwitchTarget' }), running()], [B('lockon.switch', { direction: 'next' }, pl)]),
          E([B('input.action_began', { action: 'DashAttack' }), running(), B('lockon.dash_ready', {}, pl)], [B('lockon.dash', {}, pl)]),
          E([B('lockon.on_target_acquired', {}, pl)], [B('audio.play', { sound: 'click', volume: '45' })]),
          E([B('lockon.on_dash_started', {}, pl)], [B('audio.play', { sound: 'throw', volume: '55' })]),
          E([B('lockon.on_attack_started', {}, pl)], [B('anim.play', { name: 'attack', loop: 'once' }, pl), B('audio.play', { sound: 'swing', volume: '60' })]),
          E([B('lockon.on_attack_hit', {}, pl)], [B('particles.spawn_at', { preset: 'sword' }, en)]),
        ],
      };
    },
  },
  {
    id: 'combat.rpg', name: 'XP & levels', icon: '⭐', category: 'Combat',
    description: 'Defeated enemies give XP; levelling up restores health and raises max health. A HUD line shows level and XP.',
    options: [obj(), { key: 'enemy', label: 'Enemy object', type: 'objectType', default: 'Enemy' }, num('xp', 'XP per enemy', 20), num('perLevel', 'XP for level 2', 100)],
    build: (o) => {
      const pl = s(o, 'player'), en = s(o, 'enemy');
      return {
        globals: [gv('xp', 0), gv('level', 1), gv('xpNext', Number(o.perLevel))],
        behaviors: [{ target: pl, type: 'health' }, { target: en, type: 'health' }],
        objects: [hud('LevelText', 'Level 1', 'tl', 16, 48, { size: 18, style: { bold: true, shadow: '#000000', shadowBlur: 4 } })],
        events: [
          E([B('health.on_died', {}, en)], [B('var.add', { variable: 'xp', value: n(o, 'xp') })]),
          E([B('system.every_tick'), B('system.compare_variable', { variable: 'xp', op: '>=', value: 'xpNext' })], [
            B('var.subtract', { variable: 'xp', value: 'xpNext' }), B('var.add', { variable: 'level', value: '1' }), B('var.set', { variable: 'xpNext', value: 'round(xpNext * 1.5)' }),
            B('health.set_hp', { value: `${pl}.Health.MaxHP` }, pl), B('particles.spawn_at', { preset: 'magic' }, pl), B('audio.play', { sound: 'coin' }), B('ui.show_message', { text: '"Level up! Level " & level', seconds: '2' }),
          ]),
          E([B('system.every_tick')], [B('ui.set_text', { text: '"Level " & level & "   XP " & xp & "/" & xpNext' }, 'LevelText')]),
        ],
      };
    },
  },

  // ======================= Menus & screens
  {
    id: 'menu.start', name: 'Start screen', icon: '🎬', category: 'Menus & screens',
    description: 'A title screen with Play, Multiplayer and Options buttons; the game waits until Play is clicked (Enter works too). Multiplayer: Create shows a code to send a friend, Join lets them type it.',
    options: [{ key: 'title', label: 'Game title', type: 'text', default: 'My Game' }, { key: 'subtitle', label: 'Subtitle', type: 'text', default: 'Press Play to start' },
      { key: 'multiplayer', label: 'Multiplayer button (GameCraft)', type: 'boolean', default: true }],
    build: (o, c) => {
      const title = s(o, 'title').replace(/"/g, ''), sub = s(o, 'subtitle').replace(/"/g, '');
      const start = [B('ui.hide_menu', { tag: 'start_menu' }), B('game.resume'), B('audio.play', { sound: 'coin', volume: '50' })];
      // Multiplayer button: delete the MultiplayerButton object (or untick the option) if the game is single-player.
      const mp = !!o.multiplayer && c.app === 'gamecraft';
      return {
        globals: [gv('started', false)],
        objects: [
          hud('MenuBackdrop', ' ', 'cc', 0, 0, { size: 10, style: { bg: '#05060a', bgOpacity: 0.75, padding: 400 } }, { tags: ['start_menu'] }),
          hud('TitleText', title, 'cc', 0, -90, { size: 56, align: 'center', style: { bold: true, outline: '#000000', outlineWidth: 5, shadow: '#000000', shadowBlur: 10 } }, { tags: ['start_menu'] }),
          hud('SubtitleText', sub, 'cc', 0, -30, { size: 18, align: 'center', color: '#d0d4dc' }, { tags: ['start_menu'] }),
          hud('PlayButton', 'Play', 'cc', 0, 40, { size: 26, align: 'center', button: true, style: { bg: '#a733f0', bgOpacity: 1, padding: 10, radius: 999, bold: true } }, { tags: ['start_menu'] }),
          hud('OptionsButton', 'Options', 'cc', 0, mp ? 150 : 100, { size: 20, align: 'center', button: true, style: { bg: '#ffffff', bgOpacity: 0.15, padding: 8, radius: 999 } }, { tags: ['start_menu'] }),
          ...(mp ? [hud('MultiplayerButton', 'Multiplayer', 'cc', 0, 98, { size: 20, align: 'center', button: true, style: { bg: '#ffffff', bgOpacity: 0.15, padding: 8, radius: 999 } }, { tags: ['start_menu'] })] : []),
        ],
        events: [
          E([B('system.on_start_of_layout'), B('system.is_boolean_set', { variable: 'started' }, undefined, { invert: true })], [B('ui.show_menu', { tag: 'start_menu' }), B('game.pause')]),
          E([B('ui.on_button_clicked', { button: 'PlayButton' })], [B('var.set', { variable: 'started', value: 'true' }), ...start]),
          E([B('input.on_key_pressed', { key: 'Enter' }), B('system.is_boolean_set', { variable: 'started' }, undefined, { invert: true })], [B('var.set', { variable: 'started', value: 'true' }), ...start]),
          E([B('ui.on_button_clicked', { button: 'OptionsButton' })], [B('ui.show_menu', { tag: 'options_menu' })]),
          ...(mp ? [
            E([B('ui.on_button_clicked', { button: 'MultiplayerButton' })], [B('net.show_menu')]),
            E([B('net.on_hosting')], [B('var.set', { variable: 'started', value: 'true' }), ...start]),
          ] : []),
        ],
        notes: ['Add the "Options screen" pack to make the Options button do something.'],
      };
    },
  },
  {
    id: 'menu.pause', name: 'Pause menu', icon: '⏸️', category: 'Menus & screens',
    description: 'Esc (or P) pauses the game and shows Resume, Save game, Load game, Restart, Options and Quit. Saving keeps the whole game (scene, objects, variables) between sessions.',
    options: [key('key', 'Pause key', 'Escape'), { key: 'slot', label: 'Save slot', type: 'text', default: 'save1' },
      { key: 'saving', label: 'Save and Load buttons', type: 'boolean', default: true }, { key: 'quit', label: 'Quit button', type: 'boolean', default: true },
      { key: 'invite', label: 'Invite button: online play with a code (GameCraft)', type: 'boolean', default: false }],
    build: (o, c) => {
      const slot = `"${s(o, 'slot').replace(/"/g, '') || 'save1'}"`;
      const open = [B('game.pause'), B('ui.show_menu', { tag: 'pause_menu' }), B('input.set_cursor', { mode: 'visible' }), B('var.set', { variable: 'paused', value: 'true' })];
      const close = [B('ui.hide_menu', { tag: 'pause_menu' }), B('ui.hide_menu', { tag: 'options_menu' }), B('game.resume'), B('var.set', { variable: 'paused', value: 'false' })];
      const saving = o.saving !== false, quit = o.quit !== false, invite = !!o.invite && c.app === 'gamecraft';
      // Buttons stacked down the middle, 52 px apart.
      const rows = ['ResumeButton', 'RestartButton', ...(saving ? ['SaveButton', 'LoadButton'] : []), ...(invite ? ['InviteButton'] : []), 'PauseOptionsButton', ...(quit ? ['QuitButton'] : [])];
      const y = (name: string) => -40 + rows.indexOf(name) * 52;
      const plainBtn = (name: string, label: string) => hud(name, label, 'cc', 0, y(name), { size: 20, align: 'center', button: true, style: { bg: '#ffffff', bgOpacity: 0.15, padding: 8, radius: 999 } }, { tags: ['pause_menu'], visible: false });
      return {
        globals: [gv('paused', false)],
        objects: [
          hud('PauseTitle', 'Paused', 'cc', 0, -120, { size: 44, align: 'center', style: { bold: true, outline: '#000000', outlineWidth: 4, bg: '#05060a', bgOpacity: 0.6, padding: 16, radius: 10 } }, { tags: ['pause_menu'], visible: false }),
          hud('ResumeButton', 'Resume', 'cc', 0, y('ResumeButton'), { size: 24, align: 'center', button: true, style: { bg: '#a733f0', bgOpacity: 1, padding: 8, radius: 999, bold: true } }, { tags: ['pause_menu'], visible: false }),
          plainBtn('RestartButton', 'Restart'),
          ...(saving ? [plainBtn('SaveButton', 'Save game'), plainBtn('LoadButton', 'Load game')] : []),
          ...(invite ? [plainBtn('InviteButton', 'Invite a friend')] : []),
          plainBtn('PauseOptionsButton', 'Options'),
          ...(quit ? [plainBtn('QuitButton', 'Quit')] : []),
        ],
        events: [
          E([B('system.on_start_of_layout')], [B('ui.hide_menu', { tag: 'pause_menu' })]),
          E([B('input.on_key_pressed', { key: s(o, 'key') })], [], [E([B('system.is_boolean_set', { variable: 'paused' })], close), E([], open, [], { isElse: true })]),
          E([B('input.on_key_pressed', { key: 'P' })], [], [E([B('system.is_boolean_set', { variable: 'paused' })], close), E([], open, [], { isElse: true })]),
          E([B('ui.on_button_clicked', { button: 'ResumeButton' })], close),
          E([B('ui.on_button_clicked', { button: 'RestartButton' })], [B('game.restart')]),
          // Options takes the pause menu's place; its Back button brings it back.
          E([B('ui.on_button_clicked', { button: 'PauseOptionsButton' })], [B('ui.hide_menu', { tag: 'pause_menu' }), B('ui.show_menu', { tag: 'options_menu' })]),
          E([B('ui.on_button_clicked', { button: 'OptionsBack' }), B('system.is_boolean_set', { variable: 'paused' })], [B('ui.show_menu', { tag: 'pause_menu' })]),
          ...(saving ? [
            // Save while paused: the menu itself is not saved, so loading puts you back in the game, paused off.
            E([B('ui.on_button_clicked', { button: 'SaveButton' })], [B('game.save_game', { slot }), B('ui.show_message', { text: '"Game saved"', seconds: '1.5' })]),
            E([B('ui.on_button_clicked', { button: 'LoadButton' })], [], [
              E([B('game.has_save', { slot })], [...close, B('game.load_game', { slot })]),
              E([], [B('ui.show_message', { text: '"No saved game yet"', seconds: '1.5' })], [], { isElse: true }),
            ]),
            // The save was made from this menu (paused = true): a loaded game always continues unpaused.
            E([B('game.on_game_loaded')], [B('var.set', { variable: 'paused', value: 'false' }), B('game.resume')]),
          ] : []),
          ...(quit ? [E([B('ui.on_button_clicked', { button: 'QuitButton' })], [...close, B('game.quit')])] : []),
          // Online play with a code: the multiplayer menu opens over the game (Create shows the code to send).
          ...(invite ? [E([B('ui.on_button_clicked', { button: 'InviteButton' })], [B('net.show_menu')])] : []),
        ],
        notes: [
          ...(saving ? ['Save game keeps the scene, every game object and the global variables in the slot (on this device, between sessions); Load game puts them back. Add a Continue button to your start screen with "Has saved game" + "Load game".'] : []),
          ...(quit ? ['Quit closes the Windows game and stops play in the editor; in a web browser it goes back to the start screen.'] : []),
          ...(invite ? ['Invite a friend opens the multiplayer menu: Create gives a 6-character code to send; friends type it under Join. Players 2-4 control objects whose movement behavior has Controls = online2-4.'] : []),
        ],
      };
    },
  },
  {
    id: 'menu.multiplayer', name: 'Multiplayer', icon: '🌐', category: 'Menus & screens', apps: ['gamecraft'],
    description: 'Makes your game multiplayer, in the exported game too: a Multiplayer button opens Create (a short code to send a friend) and Join. Each friend who joins gets their own copy of your player object.',
    options: [obj('player', 'Player object'), { key: 'players', label: 'Most players', type: 'choice', default: '4', options: ['2', '3', '4'] }, { key: 'button', label: 'Multiplayer button on screen', type: 'boolean', default: true }, key('key', 'Multiplayer key', 'M')],
    build: (o) => ({
      multiplayer: { player: s(o, 'player'), maxPlayers: Number(o.players) },
      objects: o.button !== false ? [hud('MultiplayerButton', 'Multiplayer', 'cr', 10, 0, { size: 14, button: true, style: { bg: '#000000', bgOpacity: 0.45, padding: 6, radius: 6 } })] : [],
      events: [
        ...(o.button !== false ? [E([B('ui.on_button_clicked', { button: 'MultiplayerButton' })], [B('net.show_menu')])] : []),
        E([B('input.on_key_pressed', { key: s(o, 'key') })], [B('net.show_menu')]),
        E([B('net.on_player_joined')], [B('ui.show_message', { text: '"A player joined"', seconds: '2' })]),
        E([B('net.on_player_left')], [B('ui.show_message', { text: '"A player left"', seconds: '2' })]),
      ],
      notes: ['In the exported game the button (or the key) opens the same Create / Join menu as the editor\'s Multiplayer button. Connections need the internet; the game itself runs directly between the players, with the first player as host.'],
    }),
  },
  {
    id: 'menu.options', name: 'Options screen', icon: '⚙️', category: 'Menus & screens',
    description: 'Global options: master, music and effects volume, graphics quality, full screen and mouse sensitivity — saved between sessions (only these settings, never the game\'s progress). Opened by the Start or Pause menu.',
    options: [{ key: 'performance', label: 'Graphics settings (GameCraft)', type: 'boolean', default: true }],
    build: (o, c) => {
      const perf = o.performance !== false && c.app === 'gamecraft';
      const tag = { tags: ['options_menu'], visible: false };
      const btn = (name: string, label: string, x: number, y: number, size = 22) => hud(name, label, 'cc', x, y, { size, align: 'center', button: true, style: { bg: '#ffffff', bgOpacity: 0.18, padding: 4, radius: 6, bold: true } }, tag);
      const label = (name: string, text: string, y: number) => hud(name, text, 'cc', 0, y, { size: 20, align: 'center' }, tag);
      // Saved: only the option variables (loading them never rolls back the score or a level).
      const SAVED = ['volume', 'music', 'effects', 'sensitivity', ...(perf ? ['quality'] : [])].join(', ');
      const save = B('game.save', { slot: 'options', only: SAVED });
      const tick = B('audio.play', { sound: 'click', volume: '60' });
      // Rows down the panel.
      const rows = ['Volume', 'Music', 'Effects', ...(perf ? ['Quality', 'Fullscreen'] : []), 'Sens'];
      const y = (r: string) => -95 + rows.indexOf(r) * 42;
      const slider = (r: string, text: string) => [label(r + 'Text', text, y(r)), btn(r + 'Down', '−', -130, y(r)), btn(r + 'Up', '+', 130, y(r))];
      const vol = (r: string, v: string, apply: () => ReturnType<typeof B>[]) => [
        E([B('ui.on_button_clicked', { button: r + 'Up' })], [B('var.set', { variable: v, value: `min(100, ${v} + 10)` }), ...apply(), tick, save]),
        E([B('ui.on_button_clicked', { button: r + 'Down' })], [B('var.set', { variable: v, value: `max(0, ${v} - 10)` }), ...apply(), tick, save]),
      ];
      const applyAudio = () => [B('audio.set_volume', { volume: 'volume' }), B('audio.set_category_volume', { category: 'music', volume: 'music' }), B('audio.set_category_volume', { category: 'sfx', volume: 'effects' })];
      // Quality 0-3 → the preset and its label.
      const QUALITY = ['low', 'medium', 'high', 'ultra'];
      const applyQuality = QUALITY.map((q, k) => E([B('system.compare_variable', { variable: 'quality', op: '=', value: String(k) })], [B('game.set_quality', { quality: q }), B('ui.set_text', { text: `"Graphics: ${q[0].toUpperCase() + q.slice(1)}"` }, 'QualityText')]));
      return {
        globals: [gv('volume', 80, 'Master volume 0-100 (saved)'), gv('music', 80, 'Music volume 0-100 (saved)'), gv('effects', 80, 'Sound effects volume 0-100 (saved)'),
          gv('sensitivity', 1, 'Mouse sensitivity multiplier (saved)'), ...(perf ? [gv('quality', 2, 'Graphics quality 0-3: low, medium, high, ultra (saved)'), gv('fullscreen', false, 'Full screen on (not saved: browsers need a click)')] : [])],
        objects: [
          hud('OptionsPanel', 'Options', 'cc', 0, -150, { size: 26, align: 'center', style: { bold: true, bg: '#0c0b08', bgOpacity: 0.92, padding: 18, radius: 10, border: '#ffffff', borderWidth: 1 } }, tag),
          ...slider('Volume', 'Volume 80'), ...slider('Music', 'Music 80'), ...slider('Effects', 'Effects 80'),
          ...(perf ? [label('QualityText', 'Graphics: High', y('Quality')), btn('QualityButton', '⟳', 130, y('Quality')), label('FullscreenText', 'Full screen: Off', y('Fullscreen')), btn('FullscreenButton', '⟳', 130, y('Fullscreen'))] : []),
          ...slider('Sens', 'Sensitivity 1'),
          btn('OptionsBack', 'Back', 0, y('Sens') + 55, 20),
        ],
        events: [
          E([B('system.on_start_of_layout')], [B('ui.hide_menu', { tag: 'options_menu' }), B('game.load', { slot: 'options', only: SAVED }), ...applyAudio()], perf ? applyQuality : []),
          ...vol('Volume', 'volume', applyAudio), ...vol('Music', 'music', applyAudio), ...vol('Effects', 'effects', applyAudio),
          ...(perf ? [
            E([B('ui.on_button_clicked', { button: 'QualityButton' })], [B('var.add', { variable: 'quality', value: '1' }), tick], [
              E([B('system.compare_variable', { variable: 'quality', op: '>=', value: '4' })], [B('var.set', { variable: 'quality', value: '0' })]),
              ...applyQuality, E([], [save]),
            ]),
            E([B('ui.on_button_clicked', { button: 'FullscreenButton' })], [B('var.toggle', { variable: 'fullscreen' }), B('game.set_fullscreen', { state: 'toggle' }), tick], [
              E([B('system.is_boolean_set', { variable: 'fullscreen' })], [B('ui.set_text', { text: '"Full screen: On"' }, 'FullscreenText')]),
              E([], [B('ui.set_text', { text: '"Full screen: Off"' }, 'FullscreenText')], [], { isElse: true }),
            ]),
          ] : []),
          E([B('ui.on_button_clicked', { button: 'SensUp' })], [B('var.set', { variable: 'sensitivity', value: 'min(3, round((sensitivity + 0.1) * 10) / 10)' }), tick, save]),
          E([B('ui.on_button_clicked', { button: 'SensDown' })], [B('var.set', { variable: 'sensitivity', value: 'max(0.1, round((sensitivity - 0.1) * 10) / 10)' }), tick, save]),
          E([B('ui.on_button_clicked', { button: 'OptionsBack' })], [B('ui.hide_menu', { tag: 'options_menu' })]),
          E([B('system.every_tick')], [B('ui.set_text', { text: '"Volume " & volume' }, 'VolumeText'), B('ui.set_text', { text: '"Music " & music' }, 'MusicText'), B('ui.set_text', { text: '"Effects " & effects' }, 'EffectsText'), B('ui.set_text', { text: '"Sensitivity " & sensitivity' }, 'SensText')]),
        ],
        notes: [
          'Saved in the slot "options" (only volume, music, effects, sensitivity' + (perf ? ', quality' : '') + '). Use the "sensitivity" variable in your camera logic to change mouse look speed.',
          'Music and Effects follow the Sound panel\'s categories (a sound marked Music is music).',
        ],
      };
    },
  },
  {
    id: 'menu.gameover', name: 'Game over & retry', icon: '💀', category: 'Menus & screens',
    description: 'When the player dies: slow motion, a Game Over panel with Retry and Quit to start buttons.',
    options: [obj()],
    build: (o) => {
      const pl = s(o, 'player');
      return {
        behaviors: [{ target: pl, type: 'health' }],
        objects: [
          hud('GameOverTitle', 'GAME OVER', 'cc', 0, -60, { size: 52, align: 'center', color: '#ff4b4b', style: { bold: true, outline: '#000000', outlineWidth: 5 } }, { tags: ['gameover_menu'], visible: false }),
          hud('RetryButton', 'Retry', 'cc', 0, 20, { size: 24, align: 'center', button: true, style: { bg: '#a733f0', bgOpacity: 1, padding: 8, radius: 999, bold: true } }, { tags: ['gameover_menu'], visible: false }),
        ],
        events: [
          E([B('system.on_start_of_layout')], [B('ui.hide_menu', { tag: 'gameover_menu' })]),
          E([B('health.on_died', {}, pl)], [B('system.set_timescale', { scale: '0.25' }), B('camera.shake', { intensity: '0.4', duration: '0.5' }), B('system.wait', { seconds: '0.4' }), B('system.set_timescale', { scale: '0' }), B('ui.show_menu', { tag: 'gameover_menu' }), B('input.set_cursor', { mode: 'visible' })]),
          E([B('ui.on_button_clicked', { button: 'RetryButton' })], [B('system.set_timescale', { scale: '1' }), B('game.restart')]),
        ],
      };
    },
  },
];

PACKS.push(...movementPresets(), ...touchPresets(), ...trailPresets(), ...specialAiPresets());

export const PACK_BY_ID: Record<string, LogicPack> = Object.fromEntries(PACKS.map((p) => [p.id, p]));

// ---- the user's own presets

/** A saved preset as a pack: its events, retargeted to the object type chosen when applying, plus its behaviors. */
export function customToPack(cp: CustomPreset): LogicPack {
  return {
    id: 'custom:' + cp.id, name: cp.name, icon: '★', category: 'My presets', description: cp.description || `Your preset (blocks for "${cp.target}").`,
    options: [{ key: 'target', label: 'Object', type: 'objectType', default: cp.target, doc: `Its blocks were made for "${cp.target}"; pick another object type to use them on that.` }],
    build: (o) => {
      const to = String(o.target || cp.target);
      const events = deepClone(cp.events);
      for (const e of events) walkEvents([e], (n) => { if (n.kind === 'event') for (const b of [...n.conditions, ...n.actions]) { if (b.target === cp.target) b.target = to; for (const [k, v] of Object.entries(b.params)) if (v === cp.target && /^(other|object|target|type|player)$/.test(k)) b.params[k] = to; } });
      return { events, behaviors: (cp.behaviors ?? []).map((b) => ({ target: to, type: b.type, props: deepClone(b.props) })) };
    },
  };
}

/** Find a preset by id: built in, or one of the document's own. */
export function resolvePack(id: string, doc?: LogicDocument): LogicPack | undefined {
  if (PACK_BY_ID[id]) return PACK_BY_ID[id];
  const cp = id.startsWith('custom:') ? doc?.customPresets?.find((x) => 'custom:' + x.id === id) : undefined;
  return cp && customToPack(cp);
}

/**
 * Save a group of events as the user's own preset: its blocks, for the object type they mostly act on, with that
 * type's behaviors (and their settings) from the scene. Returns the new preset.
 */
export function presetFromGroup(doc: LogicDocument, groupId: string, scene: SceneData | undefined, meta: { name: string; category?: string; description?: string }): CustomPreset | null {
  let g: EventNode | undefined;
  for (const sh of doc.sheets) walkEvents(sh.events, (n) => { if (n.id === groupId) g = n; });
  if (!g || g.kind === 'comment') return null;
  const nodes: EventNode[] = g.kind === 'group' ? g.children : [g];
  const count = new Map<string, number>();
  walkEvents(nodes, (n) => { if (n.kind === 'event') for (const b of [...n.conditions, ...n.actions]) if (b.target) count.set(b.target, (count.get(b.target) ?? 0) + 1); });
  const target = [...count.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'Player';
  const inst = scene?.instances.find((i) => i.type === target);
  const cp: CustomPreset = {
    id: Math.random().toString(36).slice(2, 10), name: meta.name.trim() || (g.kind === 'group' ? g.name : 'My preset'),
    category: meta.category || 'My presets', description: meta.description ?? (g.kind === 'group' ? g.description ?? '' : ''),
    target, events: deepClone(nodes), behaviors: inst ? deepClone(inst.behaviors) : [],
  };
  doc.customPresets = [...(doc.customPresets ?? []), cp];
  return cp;
}

/** What applying a preset would add (for the preview): events and blocks by name, behaviors, objects. */
export function previewPack(pack: LogicPack, opts: Opts, ctx: PackContext): { events: number; blocks: string[]; behaviors: string[]; objects: string[]; notes: string[] } {
  const r = pack.build({ ...packDefaults(pack), ...opts }, ctx);
  const blocks: string[] = [];
  walkEvents(r.events, (n) => { if (n.kind === 'event') for (const b of [...n.conditions, ...n.actions]) blocks.push(b.block); });
  return {
    events: countEvents(r.events), blocks,
    behaviors: (r.behaviors ?? []).map((b) => `${b.type} on ${b.target}`),
    objects: [...(r.objects ?? []).map((x) => x.type), ...(r.templates ?? []).map((x) => x.type)],
    notes: r.notes ?? [],
  };
}

export function packAvailable(p: LogicPack, ctx: PackContext) {
  return (!p.apps || p.apps.includes(ctx.app)) && (!p.modes || p.modes.includes(ctx.mode));
}

export function packDefaults(p: LogicPack): Opts { return Object.fromEntries(p.options.map((x) => [x.key, x.default])); }

/**
 * Add a pack to a document and its scene (both mutated in place - call inside the app's undoable mutate).
 * Returns what was done, in plain sentences, for the user.
 */
export function installPack(doc: LogicDocument, sheetId: string | undefined, scene: SceneData, pack: LogicPack, opts: Opts, ctx: PackContext): string[] {
  const o = { ...packDefaults(pack), ...opts };
  const r = pack.build(o, ctx);
  const report: string[] = [];
  const sheet = doc.sheets.find((x) => x.id === sheetId) ?? doc.sheets[0];
  const mainTarget = pack.options.find((x) => x.type === 'objectType');
  // Packs reuse block lists between events; fresh IDs make every block its own.
  const g = reassignIds(group(`${pack.name}${mainTarget ? ` (${o[mainTarget.key]})` : ''}`, r.events, { description: pack.description }));
  sheet.events.push(g);
  report.push(`Added the "${pack.name}" group (${countEvents(r.events)} events) to "${sheet.name}".`);
  for (const v of r.globals ?? []) if (!doc.globals.some((x) => x.name.toLowerCase() === v.name.toLowerCase())) { doc.globals.push({ ...v }); report.push(`New global variable "${v.name}".`); }
  // Variables used but not declared by the pack (e.g. invOpen) are declared as booleans/numbers.
  for (const name of undeclaredVars(r.events)) if (!doc.globals.some((x) => x.name.toLowerCase() === name.toLowerCase())) doc.globals.push({ name, type: 'boolean', value: false });
  if (r.inputActions) doc.inputActions = { ...(doc.inputActions ?? {}), ...r.inputActions };
  if (r.multiplayer) doc.multiplayer = r.multiplayer;
  if (r.touch && TOUCH_PRESETS[r.touch.preset]) {
    doc.touchControls = TOUCH_PRESETS[r.touch.preset].layout();
    doc.inputActions = withTouchBindings(doc.inputActions ?? DEFAULT_ACTIONS, r.touch.preset);
    report.push(`On-screen touch controls: ${TOUCH_PRESETS[r.touch.preset].name} (shown on touch screens; edit them in Input › Touch controls).`);
  }
  for (const t of r.tags ?? []) for (const i of scene.instances.filter((x) => x.type.toLowerCase() === t.target.toLowerCase())) for (const tag of t.tags) if (!i.tags.includes(tag)) i.tags.push(tag);

  const ofType = (t: string) => scene.instances.filter((i) => i.type.toLowerCase() === t.toLowerCase());
  const typeDef = (t: string) => scene.objectTypes.find((x) => x.name.toLowerCase() === t.toLowerCase());
  const missing = new Set<string>();
  // Objects first: a pack's behaviors can go on an object it has just made.
  let uid = nextUid(scene);
  for (const ob of r.objects ?? []) {
    if (ofType(ob.type).length) continue;
    const i = makeInstance(uid++, ob.type, ob.kind, ob.data);
    if (ob.kind === 'text' && i.text) i.collider = { ...i.collider, shape: 'none' };
    scene.instances.push(i);
    report.push(`Created the ${ob.kind === 'text' ? 'HUD ' : ''}object "${ob.type}".`);
  }
  for (const t of r.templates ?? []) {
    if (ofType(t.type).length || typeDef(t.type)) continue;
    const { uid: _u, ...tpl } = makeInstance(0, t.type, t.kind, t.data);
    scene.objectTypes.push({ name: t.type, kind: t.kind, vars: [], template: tpl });
    report.push(`Created the spawnable object type "${t.type}".`);
  }
  for (const b of r.behaviors ?? []) {
    const list = [...ofType(b.target), ...(typeDef(b.target)?.template ? [typeDef(b.target)!.template as InstanceData] : [])];
    if (!list.length) { missing.add(b.target); continue; }
    let added = false, removed: string[] = [];
    for (const i of list) {
      // Surface Walker is its own movement ("use instead of Platform"): jump settings go on it, and a second mover
      // would fight it.
      const walker = b.type === 'platform' ? i.behaviors.find((x) => x.type === 'surfacewalker') : undefined;
      if (walker) {
        for (const k of ['jumpCount', 'unlimitedJumps', 'jumpStrength']) if (b.props && k in b.props) walker.props[k] = b.props[k];
        continue;
      }
      if (b.replaces) { const gone = i.behaviors.filter((x) => b.replaces!.includes(x.type) && x.type !== b.type).map((x) => x.type); removed = [...new Set([...removed, ...gone])]; i.behaviors = i.behaviors.filter((x) => !gone.includes(x.type)); }
      const ex = i.behaviors.find((x) => x.type === b.type);
      if (ex) Object.assign(ex.props, b.props ?? {});
      else { i.behaviors.push({ type: b.type, props: { ...behaviorDefaults(b.type), ...(b.props ?? {}) } }); added = true; }
    }
    report.push(`${added ? 'Added' : 'Updated'} the ${b.type} behavior on "${b.target}"${removed.length ? ` (replaced ${removed.join(', ')})` : ''}.`);
  }
  for (const v of r.vars ?? []) {
    const list = [...ofType(v.target), ...(typeDef(v.target)?.template ? [typeDef(v.target)!.template as InstanceData] : [])];
    if (!list.length) { missing.add(v.target); continue; }
    for (const i of list) for (const [k, val] of Object.entries(v.vars)) if (!(k in i.vars)) i.vars[k] = val;
  }
  for (const m of missing) report.push(`⚠ No "${m}" object in this scene yet - add one (or rename an object's type to "${m}"), then add the pack again or set its behaviors by hand.`);
  for (const note of r.notes ?? []) report.push('ⓘ ' + note);
  return report;
}

function countEvents(nodes: EventNode[]): number {
  let c = 0;
  for (const nd of nodes) if (nd.kind === 'event') c += 1 + countEvents(nd.children); else if (nd.kind === 'group') c += countEvents(nd.children);
  return c;
}

/** Global variable names referenced by var.* / list.* blocks. */
function undeclaredVars(nodes: EventNode[]): string[] {
  const out = new Set<string>();
  const walk = (ns: EventNode[]) => {
    for (const nd of ns) {
      if (nd.kind === 'group') walk(nd.children);
      if (nd.kind !== 'event') continue;
      for (const b of [...nd.conditions, ...nd.actions]) if (/^(var\.|system\.is_boolean_set|system\.compare_variable)/.test(b.block) && typeof b.params.variable === 'string') out.add(b.params.variable);
      walk(nd.children);
    }
  };
  walk(nodes);
  return [...out];
}

// ---- Movement presets: abilities of the Platform movement, each switched on by a visible block (change or remove
// it to change the game) and with its settings on the behavior.
function movementPresets(): LogicPack[] {
  const ability = (id: string, name: string, icon: string, description: string, ab: string, props: Record<string, any>, extra: (o: Opts) => EventNode[] = () => [], opts: PackOption[] = []): LogicPack => ({
    id: 'move.' + id, name, icon, category: 'Movement', description, options: [obj(), ...opts],
    build: (o) => ({
      behaviors: [{ target: s(o, 'player'), type: 'platform', props: { ...props, ...Object.fromEntries(opts.filter((x) => x.key in props).map((x) => [x.key, o[x.key]])) } }],
      events: [E([B('system.on_start_of_layout')], ab ? [B('platform.set_ability', { ability: ab, state: 'on' }, s(o, 'player'))] : []), ...extra(o)].filter((e) => e.kind !== 'event' || e.actions.length || e.conditions[0]?.block !== 'system.on_start_of_layout'),
    }),
  });
  const jumps = (id: string, name: string, n: number): LogicPack => ({
    id: 'move.' + id, name, icon: '⤒', category: 'Movement', description: `${n} jumps in a row: jump again in the air ${n - 1} time${n === 2 ? '' : 's'}. Landing gives them back.`,
    options: [obj()],
    build: (o) => ({
      behaviors: [{ target: s(o, 'player'), type: 'platform', props: { jumping: true, jumpCount: n }, replaces: MOVERS }],
      events: [E([B('system.on_start_of_layout')], [B('platform.set_jumps', { count: String(n) }, s(o, 'player'))]), E([B('platform.on_jump', {}, s(o, 'player'))], [B('particles.spawn_at', { preset: 'dust' }, s(o, 'player'))])],
    }),
  });
  const list: LogicPack[] = [
    ability('eightdir', '8 Directional', '✥', 'Top-down movement in 8 directions (arrows / WASD, left stick); faces where it moves.', '', {}, () => [], []),
    {
      id: 'move.free', name: 'Free movement (flying)', icon: '🕊', category: 'Movement', description: 'Move freely in the air: no gravity, Jump flies up, C flies down (3D: WASD too). For ghosts, drones, spaceships, editors.',
      options: [obj(), num('flySpeed', 'Up / down speed', 5)],
      build: (o) => ({ behaviors: [{ target: s(o, 'player'), type: 'platform', props: { flying: true, flySpeed: Number(o.flySpeed) } }], events: [E([B('system.on_start_of_layout')], [B('platform.set_ability', { ability: 'flying', state: 'on' }, s(o, 'player'))])] }),
    },
    ability('swim', 'Swimming', '🏊', 'In Water objects: swim up with Jump, sink slowly otherwise, leap out at the surface. (Add the Water behavior to a box to make water.)', 'swimming', { swimming: true }, (o) => [E([B('water.on_enter', {}, s(o, 'player'))], [B('particles.spawn_at', { preset: 'dust' }, s(o, 'player'))])]),
    ability('flying', 'Flying (toggle)', '🪽', 'Press F to take off and land: flying has no gravity (Jump up, C down).', '', {}, (o) => [
      E([B('input.on_key_pressed', { key: 'F' })], [], [E([B('platform.is_state', { state: 'flying' }, s(o, 'player'))], [B('platform.set_ability', { ability: 'flying', state: 'off' }, s(o, 'player'))]), E([], [B('platform.set_ability', { ability: 'flying', state: 'on' }, s(o, 'player'))], [], { isElse: true })]),
    ]),
    ability('wallslide', 'Wall sliding', '⇣', 'Falling while pushing into a wall slides down it slowly.', 'wall sliding', { wallSlide: true, wallSlideSpeed: 2.5 }, () => [], [num('wallSlideSpeed', 'Slide speed (m/s)', 2.5)]),
    ability('walljump', 'Wall jumping', '⇱', 'Jump off a wall you touch in the air (with wall sliding): up and away from it.', 'wall jumping', { wallJump: true, wallSlide: true, wallJumpPush: 7 }, (o) => [E([B('platform.on_wall_jump', {}, s(o, 'player'))], [B('particles.spawn_at', { preset: 'dust' }, s(o, 'player'))])], [num('wallJumpPush', 'Push away (m/s)', 7)]),
    ability('glide', 'Slow descent (glide)', '🪂', 'Hold Jump while falling to float down slowly.', 'slow descent', { slowDescent: true, glideFallSpeed: 1.8 }, () => [], [num('glideFallSpeed', 'Fall speed while gliding (m/s)', 1.8)]),
    jumps('double', 'Double jump', 2),
    jumps('triple', 'Triple jump', 3),
    {
      id: 'move.multijump', name: 'Multi-jump (any number)', icon: '⤒', category: 'Movement', description: 'Choose how many jumps in a row (0 = unlimited).',
      options: [obj(), num('count', 'Jumps (0 = unlimited)', 4)],
      build: (o) => ({ behaviors: [{ target: s(o, 'player'), type: 'platform', props: { jumping: true, jumpCount: Math.max(1, Number(o.count)), unlimitedJumps: Number(o.count) <= 0 }, replaces: MOVERS }], events: [E([B('system.on_start_of_layout')], [B('platform.set_jumps', { count: n(o, 'count') }, s(o, 'player'))])] }),
    },
    ability('dash', 'Dash', '⇶', 'Q (gamepad RB) dashes forward; a puff of particles shows it.', 'dash', { dash: true, dashSpeed: 18, dashTime: 0.18, dashCooldown: 0.6 }, (o) => [E([B('platform.on_dash', {}, s(o, 'player'))], [B('particles.spawn_at', { preset: 'dust' }, s(o, 'player')), B('audio.play', { sound: 'step', volume: '60' })])], [num('dashSpeed', 'Dash speed (m/s)', 18), num('dashCooldown', 'Cooldown (s)', 0.6)]),
    ability('sprint', 'Sprint', '⏩', 'Hold Shift (gamepad X) to run faster.', 'sprinting', { sprinting: true, runMultiplier: 1.7 }, () => [], [num('runMultiplier', 'Sprint speed (×)', 1.7)]),
    ability('crouch', 'Crouch', '⤓', 'Hold C (gamepad B) to crouch: slower, animation "crouch".', 'crouching', { crouching: true, crouchSpeed: 0.45 }, () => [], [num('crouchSpeed', 'Crouch speed (×)', 0.45)]),
    {
      id: 'move.climb', name: 'Climbing (ladders)', icon: '🪜', category: 'Movement', description: 'Objects of the ladder type become climbable: Up / Down climb, Jump lets go.',
      options: [obj(), { key: 'ladder', label: 'Ladder object', type: 'objectType', default: 'Ladder' }],
      build: (o) => ({ behaviors: [{ target: s(o, 'player'), type: 'platform', props: { climbing: true } }], tags: [{ target: s(o, 'ladder'), tags: ['ladder'] }], events: [E([B('system.on_start_of_layout')], [B('platform.set_ability', { ability: 'climbing', state: 'on' }, s(o, 'player'))])], notes: [`Objects of type "${s(o, 'ladder')}" got the tag "ladder" (any object tagged ladder or climbable can be climbed).`] }),
    },
    {
      id: 'platform.oneway', name: 'One-way platform', icon: '▭', category: 'Platforms', description: 'Jump up through it from below and land on top; drop through with middle mouse or Down + Jump. Fades while you pass.',
      options: [obj('platform', 'Platform object', 'Platform'), { key: 'fade', label: 'Fade while passing through', type: 'boolean', default: true }],
      build: (o) => ({ behaviors: [{ target: s(o, 'platform'), type: 'solid' }, { target: s(o, 'platform'), type: 'platformtype', props: { kind: 'one-way', fade: !!o.fade } }], events: [E([B('system.on_start_of_layout')], [B('platformtype.set_kind', { kind: 'one-way' }, s(o, 'platform'))])] }),
    },
    {
      id: 'platform.passthrough', name: 'Pass-through platform', icon: '▯', category: 'Platforms', description: 'Characters walk and jump through it (it fades); crates, balls and bullets still hit it.',
      options: [obj('platform', 'Platform object', 'Platform')],
      build: (o) => ({ behaviors: [{ target: s(o, 'platform'), type: 'solid' }, { target: s(o, 'platform'), type: 'platformtype', props: { kind: 'pass-through', fade: true } }], events: [] }),
    },
    {
      id: 'platform.toggle', name: 'Toggling platform', icon: '◫', category: 'Platforms', description: 'Switches on and off on a timer (or with the Switch platform block); fades while off.',
      options: [obj('platform', 'Platform object', 'Platform'), num('onTime', 'On for (s)', 2), num('offTime', 'Off for (s)', 1.5)],
      build: (o) => ({ behaviors: [{ target: s(o, 'platform'), type: 'solid' }, { target: s(o, 'platform'), type: 'platformtype', props: { kind: 'toggle', fade: true, onTime: Number(o.onTime), offTime: Number(o.offTime) } }], events: [E([B('platformtype.on_switched', {}, s(o, 'platform'))], [B('audio.play', { sound: 'blip', volume: '40' })])] }),
    },
  ];
  return list.map((p) => (p.id === 'move.eightdir' ? { ...p, build: (o: Opts) => ({ behaviors: [{ target: s(o, 'player'), type: 'eightdir', props: {}, replaces: MOVERS }], events: [] }) } : p));
}

// ---- Touch controls presets: the on-screen layouts, wired to the input actions (so the same logic works with keys).
function touchPresets(): LogicPack[] {
  return Object.entries(TOUCH_PRESETS).map(([k, t]) => ({
    id: 'touch.' + k, name: `Touch: ${t.name}`, icon: '📱', category: 'Touch controls' as PackCategory, description: t.doc + ' Shown on touch screens; each button is a binding of the input action with its name.',
    options: [],
    build: () => ({ touch: { preset: k }, events: [] }),
  }));
}

// ---- Trails and the paint gun
function trailPresets(): LogicPack[] {
  const colour = (def: string): PackOption => ({ key: 'color', label: 'Colour', type: 'choice', default: def, options: ['#3aa0ff', '#ff3b8d', '#ffd84a', '#3fd17a', '#ffffff', '#222222', '#a77bff', '#ff8a3d'] });
  return [
    {
      id: 'trail.walk', name: 'Walking trail (particles)', icon: '∴', category: 'Trails & effects', description: 'Puffs of particles (dust, footprints, sparkles…) behind the character while it walks; none while it stands still.',
      options: [obj(), { key: 'preset', label: 'Particles', type: 'choice', default: 'dust', options: ['dust', 'footsteps', 'magic', 'sparks', 'smoke', 'snow', 'dirt'] }, num('spacing', 'Spacing (m)', 0.4), { key: 'tint', label: 'Use my colour', type: 'boolean', default: false }, colour('#3aa0ff')],
      build: (o) => ({ behaviors: [{ target: s(o, 'player'), type: 'trail', props: { mode: 'particles', preset: s(o, 'preset'), spacing: Number(o.spacing), presetColors: !o.tint, color: s(o, 'color') } }], events: [] }),
    },
    {
      id: 'trail.paint', name: 'Paint trail', icon: '🖌', category: 'Trails & effects', description: 'The character paints the ground where it walks. Marks stay (or fade), the oldest are cleaned up; C clears them.',
      options: [obj(), colour('#ff3b8d'), num('size', 'Brush size (m)', 0.5), num('opacity', 'Opacity (0–1)', 0.9), num('lifetime', 'Fades after (s, 0 = stays)', 0), key('clear', 'Clear key', 'C')],
      build: (o) => ({
        behaviors: [{ target: s(o, 'player'), type: 'trail', props: { mode: 'paint', color: s(o, 'color'), size: Number(o.size), opacity: Number(o.opacity), lifetime: Number(o.lifetime), spacing: Math.max(0.1, Number(o.size) * 0.5) } }],
        events: [E([B('input.on_key_pressed', { key: s(o, 'clear') })], [B('paint.clear', { what: 'trails' })])],
      }),
    },
    {
      id: 'combat.paintgun', name: 'Paint gun', icon: '🎨', category: 'Combat', description: 'Fire paint where you aim: instant (a spray that paints the spot) or paint balls that splat where they land. Colour key 1–4 changes the paint; painted objects run On painted.',
      options: [obj(), { key: 'mode', label: 'Shoots', type: 'choice', default: 'instant', options: ['instant', 'paint balls'] }, key('key', 'Fire key', 'K'), { key: 'mouse', label: 'Also left mouse button', type: 'boolean', default: true }, num('size', 'Splat size (m)', 0.7), num('rate', 'Seconds between shots', 0.15), colour('#ff3b8d')],
      build: (o, c) => {
        const pl = s(o, 'player'), balls = o.mode === 'paint balls';
        const can = [B('object.compare_var', { variable: 'paintCd', op: '<=', value: '0' }, pl), running()];
        const fire = [B('object.set_var', { variable: 'paintCd', value: n(o, 'rate') }, pl),
          balls ? B('combat.shoot', { object: 'PaintBall', speed: '22', spread: '1', damage: '0' }, pl) : B('paint.shoot', { color: 'paintColor', size: n(o, 'size'), range: '40', impact: 'sparks' }, pl),
          B('audio.play', { sound: 'laser', volume: '40' })];
        return {
          globals: [gv('paintColor', s(o, 'color'), 'The paint colour (keys 1–4 change it)')],
          vars: [{ target: pl, vars: { paintCd: 0 } }],
          templates: balls ? [{ type: 'PaintBall', kind: 'sphere', data: { sx: 0.18, sy: 0.18, sz: 0.18, color: s(o, 'color'), behaviors: [{ type: 'bullet', props: { ...behaviorDefaults('bullet'), speed: 22, lifetime: 3, gravity: c.mode === '3d' ? 6 : 0, destroyOnSolid: false } }] } }] : [],
          events: [
            E([B('system.every_tick')], [B('object.add_var', { variable: 'paintCd', value: '-dt' }, pl)]),
            E([B('input.key_is_down', { key: s(o, 'key') }), ...can], fire),
            ...(o.mouse ? [E([B('input.mouse_is_down', { button: 'left' }), ...can], fire)] : []),
            ...(balls ? [E([B('bullet.on_hit_solid', {}, 'PaintBall')], [B('paint.splat', { color: 'paintColor', size: n(o, 'size') }, 'PaintBall'), B('object.destroy', {}, 'PaintBall')])] : []),
            ...['#ff3b8d', '#3aa0ff', '#ffd84a', '#3fd17a'].map((col, k) => E([B('input.on_key_pressed', { key: String(k + 1) })], [B('var.set', { variable: 'paintColor', value: `"${col}"` })])),
          ],
          notes: balls ? ['Paint balls splat in the current paint colour (paintColor) where they land.'] : [],
        };
      },
    },
  ];
}

// ---- Special enemy AI
function specialAiPresets(): LogicPack[] {
  const ai = (id: string, type: string, name: string, icon: string, description: string, extra: (o: Opts) => EventNode[]): LogicPack => ({
    id: 'ai.' + id, name, icon, category: 'Enemy AI', description,
    options: [obj('enemy', 'Enemy object', 'Enemy'), obj(), num('speed', 'Speed (m/s)', id === 'unseen' ? 4 : 3.5), num('damage', 'Damage', 20), num('range', 'Detection distance', 25)],
    build: (o) => ({
      behaviors: [{ target: s(o, 'enemy'), type, props: { target: s(o, 'player'), speed: Number(o.speed), damage: Number(o.damage), detectRange: Number(o.range) } }, { target: s(o, 'player'), type: 'health' }],
      events: [E([B('enemy.on_attack', {}, s(o, 'enemy'))], [B('camera.shake', { intensity: '0.3', duration: '0.25' }), B('audio.play', { sound: 'hit', volume: '70' })]), ...extra(o)],
    }),
  });
  return [
    ai('unseen', 'unseen', 'Moves only when you\'re not looking', '◐', 'It freezes while you look at it and creeps closer when you look away (walls hide it). Touching you hurts.',
      (o) => [E([B('enemy.on_seen', {}, s(o, 'enemy'))], [B('audio.play', { sound: 'alarm', volume: '35' })])]),
    ai('mimic', 'mimic', 'Moves only when you move', '⇆', 'Statues: it comes for you only while you move, and stops dead when you stand still.', () => []),
  ];
}
