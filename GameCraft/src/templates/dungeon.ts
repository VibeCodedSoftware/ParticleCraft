// Template 7: Dungeon Bound - the user's level from DungeonBound_4.blend (read natively): parkour platforms
// to a key, a locked gate, a crate-on-pressure-plate door, a spike-trap corridor, the user's two levers that
// open the next gate, a second key and the high exit door. Coins along the way. The player is the user's
// wizard with its Idle / Walk / Jump animations; the HUD hearts are the user's heart meshes.
// Every level piece keeps its Blender position (scaled by S) and gets compound colliders generated from its
// mesh (scripts/blend-assets.ts). Uses the user-supplied PublicPixel font.
import { DEFAULT_LIGHT, type InstanceData } from '@shared/src/runtime/scene';
import { B, E, G, Kit, bh, makeProject, postfx, v } from './kit';
import { DEFAULT_IMPORT, type AssetRef } from '../project/types';
import { BLEND_DATA } from './blendData';

const FONT = 'lib:library/dungeonbound/PublicPixel.ttf';
const BLEND = 'lib:library/dungeonbound/DungeonBound_4.blend';
const obj = (name: string) => `${BLEND}#${name}`;
const D = BLEND_DATA.dungeon as any;
const NAMED = D.named as Record<string, { size: number[] }>;
const LEVEL = D.level as Record<string, { world: number[]; size: number[]; min: number[]; boxes?: number[][] }>;
const FLOORS = D.floors as Record<string, number>;
/** Blender units -> meters: the wizard (5.88 units tall in the .blend) becomes 1.9 m, and the level with it. */
const S = Math.round((1.9 / NAMED['Wizard.001'].size[1]) * 10000) / 10000;
const m = (u: number) => Math.round(u * S * 1000) / 1000;
const HEART = (n: number) => ({ icon: obj(`Heart${n}-`) });
const NOCOL = { shape: 'none' as const, size: [1, 1, 1] as [number, number, number], offset: [0, 0, 0] as [number, number, number] };

export function dungeonTemplate() {
  const k = new Kit('Dungeon', '3d');
  k.scene.settings.background = '#0b0b10';
  k.scene.settings.world = { color: '#6a6488', strength: 0.55, viewTransform: 'agx', exposure: 0.35 };

  // ---- The user's level: one instance per Blender object, at its Blender position.
  const piece = (type: string, name: string, o: Partial<InstanceData> = {}, solid = true) => {
    const l = LEVEL[name];
    const boxes = l.boxes?.length ? l.boxes : undefined;
    return k.add(type, 'mesh', {
      name, x: m(l.world[0]), y: m(l.world[1]), z: m(l.world[2]), sx: S, sy: S, sz: S, color: '#ffffff',
      mesh: { asset: obj(name), rotY: 0 },
      collider: boxes ? { shape: 'box', size: l.size as [number, number, number], offset: [l.min[0] + l.size[0] / 2, l.min[1] + l.size[1] / 2, l.min[2] + l.size[2] / 2], boxes } : NOCOL,
      behaviors: solid && boxes ? [bh('solid')] : [],
      ...o,
    });
  };
  const typeOf = (n: string) => /^Platform/.test(n) ? 'Platform' : /^Cube\.00[8-9]|^Cube\.01/.test(n) ? 'Pedestal' : /^Cube/.test(n) ? 'Wall' : /^rock/.test(n) ? 'Rock' : /^DoorFrame/.test(n) ? 'DoorFrame' : /^Tourch/.test(n) ? 'TorchModel' : n.replace(/[^A-Za-z]/g, '');
  const SPECIAL = /^(Door|Door2.*|Key.*|Circle.*|Lever\d|Tourch.*)$/;
  for (const name of Object.keys(LEVEL)) if (!SPECIAL.test(name)) piece(typeOf(name), name, {}, !/^Tourch/.test(name));

  // Doors: the start door stays shut (scenery); the others are puzzle gates that slide down when opened.
  piece('StartDoor', 'Door');
  const gate = (type: string, name: string) => piece(type, name, { vars: { open: false, closedY: m(LEVEL[name].world[1]) } });
  gate('LockedGate', 'Door2');       // needs the first key
  gate('PlateGate', 'Door2.001');    // crate on the pressure plate
  gate('LeverGate', 'Door2.003');    // both levers
  gate('ExitDoor', 'Door2.002');     // needs the second key
  for (const t of ['LockedGate', 'PlateGate', 'LeverGate', 'ExitDoor']) k.typeVars(t, [v('open', false), v('closedY', 0)]);

  // Keys and levers (the user's models).
  const pickup = (type: string, name: string) => piece(type, name, { collider: { shape: 'box', size: [4, 5, 4], offset: [0, 0, 0], isTrigger: true }, behaviors: [bh('rotate', { speed: 90 })] }, false);
  pickup('Key', 'Key');
  pickup('ExitKey', 'Key.001');
  // Levers: a pivot at the base standing on the pedestal, holding the user's lever model at half size, so a pull
  // tilts the handle around its base.
  const LEVER_SCALE = 0.5;
  for (const [name, pedestal] of [['Lever1', 'Cube.008'], ['Lever2', 'Cube.010']] as const) {
    const l = LEVEL[name], p = LEVEL[pedestal];
    const pedTop = p.world[1] + p.min[1] + p.size[1];
    const pivot = k.add('Lever', 'empty', { name, x: m(l.world[0]), y: m(pedTop), z: m(l.world[2]), vars: { on: false }, collider: NOCOL });
    k.add('LeverModel', 'mesh', { name: name + ' model', parent: pivot.uid, x: 0, y: m(-l.min[1] * LEVER_SCALE), z: 0, sx: S * LEVER_SCALE, sy: S * LEVER_SCALE, sz: S * LEVER_SCALE, color: '#ffffff', mesh: { asset: obj(name), rotY: 0 }, collider: NOCOL });
  }
  k.typeVars('Lever', [v('on', false)]);

  // Coins: the user's three gold coins (Circle, Circle.001, Circle.002), where they were placed in Blender.
  const coinAt = (x: number, y: number, z: number, n: number) => k.add('Coin', 'mesh', { name: 'Coin ' + n, x: m(x), y: m(y), z: m(z), sx: S, sy: S, sz: S, color: '#ffffff', mesh: { asset: obj('Circle'), rotY: 0 }, collider: { shape: 'box', size: [3, 3, 3], offset: [0, 0, 0], isTrigger: true }, behaviors: [bh('rotate', { speed: 120 })] });
  const coinSpots: number[][] = [...['Circle', 'Circle.001', 'Circle.002'].map((n) => { const w = LEVEL[n].world; return [w[0], w[1] + 1.4, w[2]]; })];
  coinSpots.forEach((c, n) => coinAt(c[0], c[1], c[2], n + 1));

  // The crate and pressure plate (added here - not in the .blend yet) in the room behind the locked gate.
  const fl = (x: number, z: number) => m(FLOORS[`${x},${z}`] ?? -1.48);
  k.box('Plate', m(0), fl(0, -195) + 0.03, m(-195), 1.8, 0.06, 1.8, '#8c8c8c', false, { collider: { shape: 'box', size: [1, 30, 1], offset: [0, 0, 0], isTrigger: true } });
  k.box('Crate', m(12), fl(12, -172) + 0.65, m(-172), 1.3, 1.3, 1.3, '#8b5a2b', false, { behaviors: [bh('physics', { mass: 3, friction: 0.85, bounce: 0 })] });

  // Spike trap across the corridor behind the plate gate (rows rise and fall out of phase).
  for (let row = 0; row < 4; row++) for (const x of [-2, 2, 6, 10]) {
    k.add('Spike', 'cone', { x: m(x), y: fl(6, -232) - 0.3, z: m(-222 - row * 7), sx: 0.7, sy: 1, sz: 0.7, color: '#c8ccd4', collider: { shape: 'box', size: [1.2, 1, 1.2], offset: [0, 0, 0], isTrigger: true }, behaviors: [bh('sine', { movement: 'vertical', period: 2.4, magnitude: 0.6, phase: row * 0.22 })] });
  }
  // Exit: stepping through the open exit door at the top of the stairs wins.
  const ex = LEVEL['Door2.002'].world;
  k.box('ExitZone', m(ex[0] + 4), m(ex[1]), m(ex[2]), 1.5, 4, 3.5, '#000', false, { visible: false, collider: { shape: 'box', size: [1, 1, 1], offset: [0, 0, 0], isTrigger: true } });

  // ---- Lights: sun outside, torches on the user's torch models, lamps along the dungeon.
  k.sun(2.6, -40, -120);
  // The user's torches hang on the hall walls; lowered to just above head height (~3 m) so their flames are in view.
  const TORCH_Y = 9; // Blender units above the hall floor (the .blend has them ~28 up)
  for (const t of ['Tourch', 'Tourch2']) {
    const w = LEVEL[t].world, top = TORCH_Y + LEVEL[t].min[1] + LEVEL[t].size[1];
    piece('TorchModel', t, { y: m(TORCH_Y) }, false);
    k.emitter('TorchFire', 'fire', m(w[0]), m(top + 0.4), m(w[2]), { rate: 35, sizeStart: 0.35 });
    k.point('Torch', m(w[0]), m(top + 1.5), m(w[2] + 2), 1600, '#ff8a3d');
  }
  for (const z of [-180, -232, -300, -380, -420]) k.point('Lamp', m(4), m(14), m(z), 2600, '#ffb46b');
  k.point('Lamp', m(100), m(52), m(-356), 2000, '#ffb46b');

  // ---- Player: the user's wizard.
  const wiz = NAMED['Wizard.001'].size;
  const spawn = [0, FLOORS['0,0'] ?? -1.3, 0];
  k.add('Player', 'mesh', { name: 'Player', x: 0, y: m(spawn[1]) + 0.05, z: 0, ry: 90, sx: S, sy: S, sz: S, color: '#ffffff',
    mesh: { asset: obj('Wizard.001'), rotY: -90, animMap: { fall: 'Jump' } },
    collider: { shape: 'box', size: [1.7, wiz[1], 1.7], offset: [0, wiz[1] / 2, 0] },
    // Jump 10 m/s reaches ~1.8 m: enough for the 1.3 m stair steps with room to spare.
    behaviors: [bh('platform', { maxSpeed: 5, jumpStrength: 10, stepHeight: 0.4 }), bh('health', { maxHp: 3, hp: 3, invulnerableTime: 1.2 })] });
  // Third-person camera like the original Dungeon Bound: high behind the player looking down. Move the mouse
  // to orbit (click the view to capture it); it slides in front of walls instead of disappearing behind them.
  k.camera({ x: 0, y: 8, z: 6 }, { focalLength: 30, clipStart: 0.1, clipEnd: 400, postfx: [...postfx('pixelart'), ...postfx('vignette')] },
    { target: 'Player', orbitWithMouse: true, distance: 9, sensitivity: 0.3, offsetX: 0, offsetY: 7, offsetZ: 5.5, smoothing: 0.8, avoidWalls: true });

  // ---- HUD
  const t = (name: string, text: string, anchor: string, x: number, y: number, size: number, color: string, o = {}, extra: Record<string, any> = {}) => k.text(name, text, anchor, x, y, size, color, o, { font: FONT, ...extra });
  // Minimal HUD: hearts, coins and keys only (controls are in the tutorial).
  [1, 2, 3].forEach((n) => t('Heart' + n, '', 'tl', 12 + (n - 1) * 46, 10, 26, '#ffffff', {}, HEART(n)));
  t('CoinText', '0/3', 'tr', 16, 14, 16, '#ffd23f', {}, { icon: obj('Circle') });
  t('KeyText', '', 'tr', 16, 50, 14, '#ffd23f');

  const isOpen = (type: string, invert = false) => B('object.is_var_true', { variable: 'open' }, type, { invert });
  const openGate = (type: string) => [B('object.set_var', { variable: 'open', value: 'true' }, type), B('anim.tween', { property: 'Y', value: `Self.closedY - ${m(13)}`, duration: '1', ease: 'easeInOut' }, type), B('behavior.set_enabled', { behavior: 'solid', state: 'disabled' }, type), B('audio.play', { sound: 'reload', volume: '70' }), B('camera.shake', { intensity: '0.12', duration: '0.5' }),
    B('var.set', { variable: 'cpX', value: 'Player.X' }), B('var.set', { variable: 'cpY', value: 'Player.Y + 0.2' }), B('var.set', { variable: 'cpZ', value: 'Player.Z' })];
  const closeGate = (type: string) => [B('object.set_var', { variable: 'open', value: 'false' }, type), B('anim.tween', { property: 'Y', value: 'Self.closedY', duration: '0.6', ease: 'easeIn' }, type), B('behavior.set_enabled', { behavior: 'solid', state: 'enabled' }, type), B('audio.play', { sound: 'hit', volume: '50' })];
  const useLocked = (type: string, flag: string, msg: string) => E([B('input.on_key_pressed', { key: 'E' }), B('object.is_within_distance', { distance: '3.5', other: 'Player' }, type), isOpen(type, true)], [], [
    E([B('system.is_boolean_set', { variable: flag })], openGate(type)),
    E([], [B('ui.show_message', { text: `"${msg}"`, seconds: '2' }), B('audio.play', { sound: 'click' })], [], { isElse: true }),
  ]);

  const events = [
    E([B('system.on_start_of_layout')], [B('audio.play_music', { sound: 'music:calm', volume: '18' }), B('audio.set_effect', { effect: 'echo' }), B('ui.show_message', { text: '"Find the way out of the dungeon"', seconds: '3' }),
      B('var.set', { variable: 'cpX', value: 'Player.X' }), B('var.set', { variable: 'cpY', value: 'Player.Y + 0.2' }), B('var.set', { variable: 'cpZ', value: 'Player.Z' })]),
    G('Coins', [
      E([B('object.on_collision', { other: 'Coin' }, 'Player')], [B('var.add', { variable: 'coins', value: '1' }), B('particles.spawn_at', { preset: 'coin' }, 'Coin'), B('audio.play', { sound: 'coin' }), B('object.destroy', {}, 'Coin')]),
      E([B('system.every_tick')], [B('ui.set_text', { text: `coins & "/${coinSpots.length}"` }, 'CoinText')]),
    ]),
    G('Gate 1 - the key on the west platforms', [
      E([B('object.on_collision', { other: 'Key' }, 'Player')], [B('var.set', { variable: 'hasKey', value: 'true' }), B('particles.spawn_at', { preset: 'magic' }, 'Key'), B('object.destroy', {}, 'Key'), B('audio.play', { sound: 'pickup' }), B('ui.show_message', { text: '"You found a key - the gate ahead will open"', seconds: '2.5' })]),
      useLocked('LockedGate', 'hasKey', 'Locked. A key must be out on the platforms…'),
    ]),
    G('Gate 2 - pressure plate', [
      E([B('system.every_tick'), B('object.is_overlapping', { other: 'Crate' }, 'Plate')], [B('object.set_color', { color: '#3fd17a' }, 'Plate')], [
        E([isOpen('PlateGate', true)], openGate('PlateGate')),
      ]),
      E([], [B('object.set_color', { color: '#8c8c8c' }, 'Plate')], [
        E([isOpen('PlateGate'), B('object.is_overlapping', { other: 'Player' }, 'PlateGate', { invert: true })], closeGate('PlateGate')),
      ], { isElse: true }),
    ]),
    G('Spike trap', [
      E([B('system.every_tick'), B('object.is_overlapping', { other: 'Player' }, 'Spike'), B('object.compare_property', { property: 'Y', op: '>', value: `${(FLOORS['6,-232'] ?? -1) * S} - 0.05` }, 'Spike')], [B('health.damage', { amount: '1' }, 'Player')]),
    ]),
    G('Gate 3 - the two levers', [
      E([B('input.on_key_pressed', { key: 'E' }), B('object.is_within_distance', { distance: '3', other: 'Player' }, 'Lever'), B('object.pick_nearest', { x: 'Player.X', y: 'Player.Y', z: 'Player.Z' }, 'Lever')], [B('object.toggle_var', { variable: 'on' }, 'Lever'), B('audio.play', { sound: 'click', volume: '70' })], [
        // The pivot tilts the handle from its base: pulled = 40° over, released = upright.
        E([B('object.is_var_true', { variable: 'on' }, 'Lever')], [B('anim.tween', { property: 'RotZ', value: '-40', duration: '0.3', ease: 'bounce' }, 'Lever'), B('var.add', { variable: 'leversOn', value: '1' }), B('ui.show_message', { text: '"Lever " & leversOn & " of 2"', seconds: '1.5' })]),
        E([], [B('anim.tween', { property: 'RotZ', value: '0', duration: '0.3', ease: 'easeOut' }, 'Lever'), B('var.subtract', { variable: 'leversOn', value: '1' })], [], { isElse: true }),
      ]),
      E([B('system.every_tick'), B('system.compare_variable', { variable: 'leversOn', op: '>=', value: '2' }), isOpen('LeverGate', true)], [...openGate('LeverGate'), B('ui.show_message', { text: '"Something heavy moved…"', seconds: '2' })]),
    ]),
    G('Exit - second key and the high door', [
      E([B('object.on_collision', { other: 'ExitKey' }, 'Player')], [B('var.set', { variable: 'hasExitKey', value: 'true' }), B('particles.spawn_at', { preset: 'magic' }, 'ExitKey'), B('object.destroy', {}, 'ExitKey'), B('audio.play', { sound: 'pickup' }), B('ui.show_message', { text: '"The exit key! Climb the stairs to the door"', seconds: '2.5' })]),
      useLocked('ExitDoor', 'hasExitKey', 'The exit is locked. The last key is deeper inside.'),
      E([B('object.on_collision', { other: 'ExitZone' }, 'Player')], [B('audio.play', { sound: 'win' }), B('game.victory', { title: '"ESCAPED!"', message: '"Coins: " & coins & "/' + coinSpots.length + '"' })]),
    ]),
    G('Player', [
      E([B('system.every_tick')], [
        ...[1, 2, 3].map((n) => B('object.set_opacity', { value: `Player.Health.HP >= ${n} ? 100 : 18` }, 'Heart' + n)),
        B('ui.set_text', { text: '(hasKey ? "KEY" : "") & (hasExitKey ? " + EXIT KEY" : "")' }, 'KeyText'),
      ]),
      // Falling off the platforms costs a heart and returns you to the last checkpoint (last gate opened).
      E([B('system.every_tick'), B('object.compare_property', { property: 'Y', op: '<', value: String(m(-40)) }, 'Player')], [B('object.set_position', { x: 'cpX', y: 'cpY', z: 'cpZ' }, 'Player'), B('health.damage', { amount: '1' }, 'Player'), B('ui.show_message', { text: '"You fell!"', seconds: '1.2' })]),
      E([B('health.on_damaged', {}, 'Player')], [B('audio.play', { sound: 'hit' }), B('camera.shake', { intensity: '0.2', duration: '0.25' }), B('particles.spawn_at', { preset: 'sword' }, 'Player')]),
      E([B('health.on_died', {}, 'Player')], [B('audio.play', { sound: 'lose' }), B('game.defeat', { title: '"YOU FELL"', message: '"Out of hearts"' })]),
      E([B('input.on_key_pressed', { key: 'R' })], [B('game.restart')]),
    ]),
  ];

  // Level pieces keep their Blender origin; the wizard is centred with its feet on the ground (pivot at the
  // bottom, matching its collider), otherwise it sinks into the floor.
  const levelAssets: AssetRef[] = [
    ...Object.keys(LEVEL).map((n): AssetRef => ({ id: obj(n), name: n, kind: 'model', source: 'library', importSettings: { ...DEFAULT_IMPORT, center: false, ground: false } })),
    { id: obj('Wizard.001'), name: 'Wizard', kind: 'model', source: 'library', importSettings: { ...DEFAULT_IMPORT }, meta: { animations: ['Idle', 'Walk', 'Jump', 'Walk.001'] } },
  ];
  return makeProject({
    name: 'Dungeon Bound', template: 'dungeon', scenes: [k.scene], events, plane: 'xz',
    globals: [v('leversOn', 0), v('hasKey', false), v('hasExitKey', false), v('coins', 0), v('cpX', 0), v('cpY', 0), v('cpZ', 0)],
    extraAssets: [
      { id: FONT, name: 'PublicPixel', kind: 'font', source: 'library' },
      ...levelAssets,
      ...[1, 2, 3].map((n) => ({ id: obj(`Heart${n}-`), name: `Heart${n}-`, kind: 'model' as const, source: 'library' as const, importSettings: { ...DEFAULT_IMPORT, center: true, ground: false } })),
    ],
    tutorial: [
      { title: 'Parkour and the first key', text: 'Jump along the platforms (Space). Take the west branch to the key, then press E at the gate. Coins are on every platform.', target: 'play' },
      { title: 'Pressure plate', text: 'Push the crate onto the grey plate to open the next gate. Take it off and the gate closes again.', target: 'play' },
      { title: 'Spikes and levers', text: 'Time your run through the spike corridor (each row has its own Sine phase), then pull both of your levers (E) to open the gate to the last key.', target: 'eventsheet' },
      { title: 'The exit', text: 'Grab the second key, climb the stairs and open the exit door. Falling costs a heart and returns you to the last gate you opened.', target: 'play' },
      { title: 'Your Blender file', text: 'Every piece of this level is read straight from DungeonBound_4.blend (asset-library/dungeonbound) - move them, or drag more objects from the .blend in the Assets panel.', target: 'assets' },
    ],
  });
}
