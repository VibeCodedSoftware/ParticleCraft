// Template: first-person shooter. The user's LowPolyArms hold the Gun in front of the camera; waves of
// LowPolyHuman enemies hunt the player through a crate-filled warehouse with the same pathfinding state
// machine as Combat Arena. Shots are instant hit-scans along the view (Fire hitscan), walls stop them.
import { makeInstance } from '@shared/src/runtime/scene';
import { B, E, G, Kit, LIB, animatedHuman, bh, makeProject, postfx, v } from './kit';

const NOCOL = { shape: 'none' as const, size: [1, 1, 1] as [number, number, number], offset: [0, 0, 0] as [number, number, number] };
/** Where the arms sit under the camera; the rig is 1 unit = 1 cm. */
const ARMS_Y = -0.64, ARMS_Z = 0.05;
/** The gun on the hand bone: its size in the Arms' centimetres, and its turn to lie along the grip. */
const GUN_SIZE = 7, GUN_ROT = [68.8, -55.6, -58.9], GUN_POS = [0.49, 10.36, -4.54];

/** A hand closed round a handle: palm facing `palmTo`, four fingers wrapped, the thumb across them. */
const grip = (s: 'R' | 'L', palmTo: [number, number, number]) => ({
  across: [`palm04${s}`, `palm01${s}`] as [string, string], middle: `f_middle01${s}`, thumb: `thumb01${s}`, palmTo,
  fingers: [
    ...['index', 'middle', 'ring', 'pinky'].map((f) => ({ bones: ['01', '02', '03'].map((n) => `f_${f}${n}${s}`), curl: [55, 70, 45] })),
    { bones: ['02', '03'].map((n) => `thumb${n}${s}`), curl: [25, 25] },
  ],
});

export function fpsTemplate() {
  const k = new Kit('Warehouse', '3d');
  k.scene.settings.background = '#15171c';
  k.scene.settings.world = { color: '#7d889c', strength: 0.45, viewTransform: 'agx', exposure: 0.1 };
  k.scene.settings.bounds = { min: [-26, -5, -26], max: [26, 12, 26] };

  // ---- Warehouse: floor, walls, crates and shelves for cover.
  k.box('Floor', 0, -0.5, 0, 52, 1, 52, '#3d4048');
  for (const [x, z, sx, sz] of [[0, -25, 52, 2], [0, 25, 52, 2], [-25, 0, 2, 52], [25, 0, 2, 52]] as const) k.box('Wall', x, 3, z, sx, 6, sz, '#2c3038');
  const crates: [number, number, number][] = [[-8, -6, 2], [-6, -6, 1.4], [9, 7, 2], [10.5, 9, 1.4], [0, 12, 2], [-14, 10, 2], [14, -11, 2], [-3, -15, 1.6], [6, -2, 1.4], [-17, -16, 2], [17, 17, 2]];
  for (const [x, z, s] of crates) k.box('Crate', x, s / 2, z, s, s, s, '#8a6236');
  for (const [x, z, sx, sz] of [[-12, 0, 1.2, 9], [12, 0, 1.2, 9], [0, -9, 9, 1.2], [0, 20, 10, 1.2]] as const) k.box('Shelf', x, 1.6, z, sx, 3.2, sz, '#59616e');
  k.sun(1.4, -60, 30, { y: 30 });
  for (const [x, z] of [[-12, -12], [12, -12], [-12, 12], [12, 12], [0, 0]]) k.point('Lamp', x, 5.2, z, 1400, '#ffe2b0');

  // ---- Player: first person, the user's arms holding the gun (children of the camera, which looks along -Z).
  k.add('Player', 'box', { name: 'Player', x: 0, y: 0.05, z: 18, ry: 90, visible: false, color: '#ffffff', vars: { ammo: 12 },
    collider: { shape: 'box', size: [0.6, 1.75, 0.6], offset: [0, 0.875, 0] },
    behaviors: [bh('platform', { maxSpeed: 5.5, runMultiplier: 1.6, jumpStrength: 6.5, turnSpeed: 0 }), bh('health', { maxHp: 100, hp: 100, invulnerableTime: 0.35 })] });
  k.typeVars('Player', [v('ammo', 12)]);
  const cam = k.camera({ x: 0, y: 1.6, z: 18 }, { focalLength: 24, clipStart: 0.03, clipEnd: 200, postfx: [...postfx('vignette'), ...postfx('bloom')] },
    { target: 'Player', firstPerson: true, eyeHeight: 1.6, sensitivity: 0.22, lookAt: false });
  // Arms: modelled facing +Z, so turned 180° to point where the camera looks.
  // Held off to the right (classic FPS view model), so the crosshair and the middle of the screen stay clear.
  // The rig has no clips: its hands are posed by IK (in the model's units; it faces +Z, right hand at -X), the right holding the gun, the left supporting it.
  const arms = k.add('Arms', 'mesh', { name: 'Arms', parent: cam.uid, x: 0, y: ARMS_Y, z: ARMS_Z, sx: 0.01, sy: 0.01, sz: 0.01, color: '#e0b48f', mesh: { asset: LIB.arms.asset, rotY: 180, tint: true, holdPose: [
    { bones: ['upper_armR', 'forearmR', 'handR'], target: [-24, 39, 49], pole: [-55, 5, 15], grip: grip('R', [1, 0, 0]) },
    { bones: ['upper_armL', 'forearmL', 'handL'], target: [-14, 36, 42], pole: [40, 0, 15], grip: grip('L', [-1, 0, 0]) },
  ] }, collider: NOCOL, tags: ['viewmodel'] });
  // The gun is on the hand bone: it goes where the hand goes.
  k.add('HeldGun', 'mesh', { name: 'HeldGun', parent: arms.uid, parentBone: 'handR', x: GUN_POS[0], y: GUN_POS[1], z: GUN_POS[2], rx: GUN_ROT[0], ry: GUN_ROT[1], rz: GUN_ROT[2], sx: GUN_SIZE, sy: GUN_SIZE, sz: GUN_SIZE, color: '#ffffff', mesh: { asset: LIB.gun.asset, rotY: 90 }, collider: NOCOL, tags: ['viewmodel'] });

  // ---- Enemies (LowPolyHuman) and their spawn points.
  const spawns = [[-21, -21], [21, -21], [-21, 4], [21, 4], [0, -22]];
  spawns.forEach(([x, z], n) => k.add('SpawnPoint', 'empty', { name: 'Spawn ' + (n + 1), x, y: 0, z, collider: NOCOL }));
  k.template(makeInstance(0, 'Enemy', 'mesh', {
    sx: 0.95, sy: 0.95, sz: 0.95, color: '#d6453d', mesh: animatedHuman(true),
    collider: { shape: 'box', size: [0.6, 1.83, 0.6], offset: [0, 0.915, 0] },
    vars: { state: 'chase', cooldown: 0 },
    behaviors: [bh('pathfinding', { maxSpeed: 3.4, cellSize: 0.5, agentRadius: 0.4 }), bh('health', { maxHp: 60, hp: 60 }), bh('timer')],
  }), [v('state', 'chase'), v('cooldown', 0)]);
  // Bullet impact spark (lives a fraction of a second).
  k.template(makeInstance(0, 'Impact', 'sphere', { sx: 0.12, sy: 0.12, sz: 0.12, color: '#ffd76a', material: { roughness: 0.4, metalness: 0, emissive: '#ffb020', emissiveStrength: 4 }, collider: NOCOL, vars: { age: 0 } }), [v('age', 0)]);

  // ---- HUD: crosshair, health, ammo, wave.
  k.text('Crosshair', '+', 'cc', 0, 0, 24, '#ffffff', { opacity: 80 });
  k.text('HealthBar', 'Health', 'bl', 18, 18, 15, '#ff5a5a');
  k.text('AmmoText', '12 / 12', 'br', 20, 18, 22, '#ffe066');
  k.text('WaveText', 'Wave 1', 'tc', 0, 14, 18, '#e8ecf2');

  const st = (s: string) => B('object.compare_var', { variable: 'state', op: '=', value: `"${s}"` }, 'Enemy');
  const events = [
    G('Shooting', [
      E([B('system.on_start_of_layout')], [B('ui.show_message', { text: '"Click to look around · WASD move · click shoot · R reload"', seconds: '3.5' }), B('audio.play_music', { sound: 'music:adventure', volume: '15' })]),
      // (Not while reloading.)
      E([B('input.on_mouse_click', { button: 'left' }), B('system.is_boolean_set', { variable: 'reloading' }, undefined, { invert: true })], [], [
        E([B('object.compare_var', { variable: 'ammo', op: '>', value: '0' }, 'Player')], [
          B('combat.hitscan', { victims: 'Enemy', range: '80', damage: '25', spread: '0.6', impact: 'Impact', blood: 'hit and kill' }, 'Player'),
          B('object.add_var', { variable: 'ammo', value: '-1' }, 'Player'),
          B('audio.play', { sound: 'shoot', volume: '55' }), B('camera.shake', { intensity: '0.04', duration: '0.06' }),
          // Recoil: the arms and gun kick back and settle.
          B('anim.tween', { property: 'Z', value: String(ARMS_Z + 0.05), duration: '0.05', ease: 'easeOut' }, 'Arms'),
          B('system.wait', { seconds: '0.06' }),
          B('anim.tween', { property: 'Z', value: String(ARMS_Z), duration: '0.12', ease: 'easeInOut' }, 'Arms'),
        ]),
        E([], [B('audio.play', { sound: 'click', volume: '50' }), B('ui.show_message', { text: '"Empty — press R"', seconds: '0.8' })], [], { isElse: true }),
      ]),
      E([B('input.on_key_pressed', { key: 'R' }), B('object.compare_var', { variable: 'ammo', op: '<', value: '12' }, 'Player'), B('system.is_boolean_set', { variable: 'reloading' }, undefined, { invert: true })], [
        B('var.set', { variable: 'reloading', value: 'true' }), B('audio.play', { sound: 'reload' }),
        B('anim.tween', { property: 'Y', value: String(ARMS_Y - 0.35), duration: '0.25', ease: 'easeIn' }, 'Arms'),
        B('system.wait', { seconds: '1' }), B('object.set_var', { variable: 'ammo', value: '12' }, 'Player'),
        B('anim.tween', { property: 'Y', value: String(ARMS_Y), duration: '0.25', ease: 'easeOut' }, 'Arms'),
        B('var.set', { variable: 'reloading', value: 'false' }),
      ]),
      E([B('system.every_tick')], [B('object.add_var', { variable: 'age', value: 'dt' }, 'Impact')], [
        E([B('object.compare_var', { variable: 'age', op: '>', value: '0.18' }, 'Impact')], [B('object.destroy', {}, 'Impact')]),
      ]),
    ]),
    G('Waves', [
      E([B('system.on_start_of_layout')], [B('function.call', { name: 'SpawnWave', args: '' })]),
      E([B('function.on_function', { name: 'SpawnWave' })], [B('var.add', { variable: 'wave', value: '1' }), B('ui.set_text', { text: '"Wave " & wave' }, 'WaveText'), B('ui.show_message', { text: '"Wave " & wave', seconds: '1.5' })], [
        E([B('system.repeat', { count: '2 + wave * 2' })], [], [
          E([B('object.pick_random', {}, 'SpawnPoint')], [B('object.create', { object: 'Enemy', x: 'SpawnPoint.X + random(-1.5, 1.5)', y: '0.02', z: 'SpawnPoint.Z + random(-1.5, 1.5)' })]),
        ]),
      ]),
      E([B('system.every_tick'), B('system.compare_count', { object: 'Enemy', op: '=', value: '0' }), B('system.trigger_once')], [B('audio.play', { sound: 'powerup' }), B('health.heal', { amount: '25' }, 'Player'), B('system.wait', { seconds: '2' }), B('function.call', { name: 'SpawnWave', args: '' })]),
    ]),
    G('Enemy AI', [
      E([B('system.every_tick'), B('object.compare_var', { variable: 'cooldown', op: '>', value: '0' }, 'Enemy')], [B('object.add_var', { variable: 'cooldown', value: '-dt' }, 'Enemy')]),
      E([B('system.every_tick'), st('chase')], [B('pathfinding.move_to_object', { other: 'Player' }, 'Enemy')], [
        E([B('object.is_within_distance', { distance: '1.7', other: 'Player' }, 'Enemy')], [B('pathfinding.stop', {}, 'Enemy'), B('ai.set_state', { state: 'attack' }, 'Enemy')]),
      ]),
      E([B('system.every_tick'), st('attack')], [B('object.look_at', { other: 'Player' }, 'Enemy')], [
        E([B('object.is_within_distance', { distance: '2.3', other: 'Player' }, 'Enemy', { invert: true })], [B('ai.set_state', { state: 'chase' }, 'Enemy')]),
        E([B('object.compare_var', { variable: 'cooldown', op: '<=', value: '0' }, 'Enemy'), B('object.compare_var', { variable: 'state', op: '=', value: '"attack"' }, 'Enemy')], [
          B('anim.play', { name: 'attack', loop: 'once' }, 'Enemy'),
          B('health.damage', { amount: '10' }, 'Player'), B('object.set_var', { variable: 'cooldown', value: '1.2' }, 'Enemy'), B('audio.play_at', { sound: 'hit', volume: '60' }, 'Enemy'),
        ]),
      ]),
      E([B('combat.on_hit', {}, 'Enemy'), B('health.is_dead', {}, 'Enemy', { invert: true })], [B('anim.play', { name: 'hit', loop: 'once' }, 'Enemy'), B('particles.spawn_at', { preset: 'debris' }, 'Enemy'), B('audio.play_at', { sound: 'hit', volume: '45' }, 'Enemy')]),
      // Death: the death clip plays, the body stops blocking, then it is removed.
      E([B('health.on_died', {}, 'Enemy')], [
        B('ai.set_state', { state: 'dead' }, 'Enemy'), B('pathfinding.stop', {}, 'Enemy'), B('behavior.set_enabled', { behavior: 'pathfinding', state: 'disabled' }, 'Enemy'),
        B('anim.play', { name: 'death', loop: 'once' }, 'Enemy'), B('audio.play_at', { sound: 'explosion', volume: '35' }, 'Enemy'), B('var.add', { variable: 'kills', value: '1' }),
        B('system.wait', { seconds: '1.6' }), B('object.destroy', {}, 'Enemy'),
      ]),
    ]),
    G('Player', [
      E([B('system.every_tick')], [B('ui.set_bar', { value: 'Player.Health.HP', max: '100' }, 'HealthBar'), B('ui.set_text', { text: 'Player.ammo & " / 12"' }, 'AmmoText')]),
      E([B('health.on_damaged', {}, 'Player')], [B('camera.shake', { intensity: '0.15', duration: '0.18' }), B('postfx.set_param', { effect: 'vignette', param: 'amount', value: '0.8' }), B('system.wait', { seconds: '0.25' }), B('postfx.set_param', { effect: 'vignette', param: 'amount', value: '0.35' })]),
      E([B('health.on_died', {}, 'Player')], [B('audio.play', { sound: 'lose' }), B('game.defeat', { title: '"You were overrun"', message: '"Reached wave " & wave & " · " & kills & " kills"' })]),
    ]),
  ];
  return makeProject({
    name: 'Arms Shooter', template: 'fps', scenes: [k.scene], events, plane: 'xz',
    globals: [v('wave', 0), v('kills', 0), v('reloading', false)],
    tutorial: [
      { title: 'Shoot', text: 'Click the view to capture the mouse. WASD moves, Shift runs, Space jumps, left click fires, R reloads (12 rounds).', target: 'play' },
      { title: 'Hitscan', text: '"Fire hitscan" shoots along the camera view: walls and crates stop the shot, the first enemy hit takes damage and fires "On hit by attack".', target: 'eventsheet' },
      { title: 'Your arms', text: 'Arms (your LowPolyArms model) and HeldGun are children of the Camera, so they follow the view. Move them in the Inspector to adjust the pose; the recoil tweens use their positions.', target: 'outliner' },
      { title: 'Waves', text: 'SpawnWave creates 2 + 2×wave enemies at random SpawnPoints. Clearing a wave heals you and starts the next one.', target: 'eventsheet' },
    ],
  });
}
