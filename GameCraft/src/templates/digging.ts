// Template 6: first-person digging on voxel terrain (excavation and terraforming). Hold left click to dig with
// the shovel, right click to pile earth back up. Treasure chests are buried in the ground; a metal detector
// tells you how close the nearest one is. Gold ore in the stone layer adds to your gold.
import { DEFAULT_VOXEL, generateVoxels, surfaceY, type VoxelData } from '@shared/src/runtime/voxel';
import { B, E, G, Kit, LIB, bh, makeProject, postfx, v } from './kit';

const NOCOL = { shape: 'none' as const, size: [1, 1, 1] as [number, number, number], offset: [0, 0, 0] as [number, number, number] };

export function diggingTemplate() {
  const k = new Kit('Dig Site', '3d');
  k.scene.settings.background = '#9fd2ff';
  k.scene.settings.world = { color: '#ffe9c4', strength: 0.7, viewTransform: 'agx', exposure: 0, fogEnabled: true, fogColor: '#cfe6ff', fogDensity: 0.012 };

  // ---- Voxel terrain: 40 x 11 x 40 m of 0.5 m blocks (grass, dirt, stone with gold ore, bedrock).
  const voxel: VoxelData = { ...DEFAULT_VOXEL, size: [80, 22, 80], cell: 0.5, seed: 11, surface: 13, hills: 4, gold: 0.025 };
  const TY = -7; // terrain bottom
  k.add('Terrain', 'voxel', { name: 'Terrain', x: 0, y: TY, z: 0, voxel, collider: { shape: 'box', size: [1, 1, 1], offset: [0, 0, 0] }, behaviors: [bh('solid')], vars: { lastDug: 0, lastGold: 0, hitX: 0, hitY: 0, hitZ: 0 } });
  k.typeVars('Terrain', [v('lastDug', 0), v('lastGold', 0), v('hitX', 0), v('hitY', 0), v('hitZ', 0)]);
  // Surface heights at build time, to place the player and the buried treasure.
  const grid = generateVoxels(voxel, [0, TY, 0]);
  const ground = (x: number, z: number) => surfaceY(grid, x, z);

  // Buried treasure: 1.5 to 3.5 m under the surface.
  const spots: [number, number, number][] = [[-9, -5, 2], [8, -9, 2.5], [-14, -15, 3], [15, 2, 1.8], [2, 9, 3.2], [-6, 16, 2.2], [11, 15, 3.5], [16, -16, 2.8]];
  spots.forEach(([x, z, depth], n) => k.add('Treasure', 'mesh', { name: 'Treasure ' + (n + 1), x, y: ground(x, z) - depth, z, sx: 1.4, sy: 1.4, sz: 1.4, color: '#ffffff', mesh: { asset: LIB.coin.asset, rotY: 0 }, collider: { shape: 'box', size: [0.9, 0.9, 0.9], offset: [0, 0.45, 0], isTrigger: true }, behaviors: [bh('rotate', { speed: 120 })] }));

  // ---- Player: first person with the shovel held in view.
  const sy = ground(0, 0);
  k.add('Player', 'box', { name: 'Player', x: 0, y: sy + 0.05, z: 0, ry: 90, visible: false, color: '#ffffff',
    collider: { shape: 'box', size: [0.6, 1.7, 0.6], offset: [0, 0.85, 0] },
    behaviors: [bh('platform', { maxSpeed: 4.5, runMultiplier: 1.5, jumpStrength: 7, turnSpeed: 0 })] });
  const cam = k.camera({ x: 0, y: sy + 1.6, z: 0 }, { focalLength: 24, clipStart: 0.03, clipEnd: 200, postfx: [...postfx('vignette')] },
    { target: 'Player', firstPerson: true, eyeHeight: 1.55, sensitivity: 0.22, lookAt: false });
  k.add('HeldShovel', 'mesh', { name: 'HeldShovel', parent: cam.uid, x: 0.42, y: -0.55, z: -0.75, rx: -20, ry: 0, rz: 10, sx: 0.07, sy: 0.07, sz: 0.07, color: '#ffffff', mesh: { asset: LIB.shovel.asset, rotY: 90 }, collider: NOCOL, tags: ['viewmodel'] });
  k.add('DigFx', 'empty', { name: 'DigFx', x: 0, y: -50, z: 0, collider: NOCOL });
  k.sun(3.4, -55, 40, { behaviors: [bh('follow', { target: 'Player', offsetX: 10, offsetY: 30, offsetZ: 20, lookAt: false, smoothing: 0 })] });

  // ---- HUD: crosshair, score, detector.
  k.text('Crosshair', '+', 'cc', 0, 0, 24, '#ffffff', { opacity: 80 });
  k.text('ScoreText', 'Treasure 0/8 · Gold 0', 'tl', 16, 14, 18, '#ffd23f');
  k.text('DetectorText', 'Detector', 'bc', 0, 18, 15, '#e8ffe0');

  const events = [
    G('Digging', [
      E([B('system.on_start_of_layout')], [B('ui.show_message', { text: '"Click to look around · hold left click to dig · right click to pile earth · find the buried treasure"', seconds: '4' }), B('audio.play_music', { sound: 'music:calm', volume: '22' })]),
      // Hold the left button: one shovel stroke every digDelay seconds.
      E([B('input.mouse_is_down', { button: 'left' }), B('system.compare_variable', { variable: 'cooldown', op: '<=', value: '0' })], [
        B('var.set', { variable: 'cooldown', value: 'digDelay' }),
        B('voxel.dig_view', { from: 'Player', radius: 'digRadius', reach: '4' }, 'Terrain'),
        B('anim.tween', { property: 'RotX', value: '-60', duration: '0.1', ease: 'easeOut' }, 'HeldShovel'), B('anim.tween', { property: 'Z', value: '-1', duration: '0.1', ease: 'easeOut' }, 'HeldShovel'),
        B('system.wait', { seconds: '0.12' }),
        B('anim.tween', { property: 'RotX', value: '-20', duration: '0.16', ease: 'easeInOut' }, 'HeldShovel'), B('anim.tween', { property: 'Z', value: '-0.75', duration: '0.16', ease: 'easeInOut' }, 'HeldShovel'),
      ]),
      E([B('input.mouse_is_down', { button: 'right' }), B('system.compare_variable', { variable: 'cooldown', op: '<=', value: '0' })], [
        B('var.set', { variable: 'cooldown', value: 'digDelay' }),
        B('voxel.build_view', { from: 'Player', radius: '0.55', reach: '4', material: '2' }, 'Terrain'),
        B('anim.tween', { property: 'RotX', value: '10', duration: '0.1', ease: 'easeOut' }, 'HeldShovel'), B('system.wait', { seconds: '0.12' }), B('anim.tween', { property: 'RotX', value: '-20', duration: '0.16', ease: 'easeInOut' }, 'HeldShovel'),
      ]),
      E([B('system.every_tick'), B('system.compare_variable', { variable: 'cooldown', op: '>', value: '0' })], [B('var.subtract', { variable: 'cooldown', value: 'dt' })]),
      E([B('voxel.on_dug', {}, 'Terrain')], [
        B('object.set_position', { x: 'Terrain.hitX', y: 'Terrain.hitY', z: 'Terrain.hitZ' }, 'DigFx'), B('particles.spawn_at', { preset: 'dirt' }, 'DigFx'), B('audio.play', { sound: 'dig', volume: '60' }),
      ], [
        E([B('object.compare_var', { variable: 'lastGold', op: '>', value: '0' }, 'Terrain')], [B('var.add', { variable: 'gold', value: 'Terrain.lastGold' }), B('particles.spawn_at', { preset: 'coin' }, 'DigFx'), B('audio.play', { sound: 'coin', volume: '50' }), B('ui.show_message', { text: '"Gold ore! +" & Terrain.lastGold', seconds: '1' })]),
      ]),
      E([B('voxel.on_built', {}, 'Terrain')], [B('audio.play', { sound: 'hit', volume: '30' })]),
    ]),
    G('Treasure', [
      E([B('object.on_collision', { other: 'Treasure' }, 'Player')], [B('particles.spawn_at', { preset: 'magic' }, 'Treasure'), B('audio.play', { sound: 'pickup' }), B('object.destroy', {}, 'Treasure'), B('var.add', { variable: 'treasure', value: '1' }), B('ui.show_message', { text: '"Treasure found!"', seconds: '1.5' })], [
        E([B('system.compare_variable', { variable: 'treasure', op: '>=', value: 'goal' })], [B('audio.play', { sound: 'win' }), B('game.victory', { title: '"Treasure hunter!"', message: '"All treasure found · " & gold & " gold ore"' })]),
      ]),
      E([B('system.every_tick')], [B('ui.set_text', { text: '"Treasure " & treasure & "/" & goal & " · Gold " & gold' }, 'ScoreText')]),
      // Metal detector: how close the nearest buried treasure is, with a beep that speeds up.
      E([B('timer.every_x_seconds', { seconds: '0.5' }), B('object.pick_nearest', { x: 'Player.X', y: 'Player.Y', z: 'Player.Z' }, 'Treasure')], [
        B('var.set', { variable: 'signal', value: 'distance3(Player.X, Player.Y, Player.Z, Treasure.X, Treasure.Y, Treasure.Z)' }),
        B('ui.set_text', { text: 'signal < 3 ? "Detector: ▮▮▮▮▮ dig here!" : signal < 6 ? "Detector: ▮▮▮▮▯ very close" : signal < 10 ? "Detector: ▮▮▮▯▯ close" : signal < 16 ? "Detector: ▮▮▯▯▯ warmer" : "Detector: ▮▯▯▯▯ nothing nearby"' }, 'DetectorText'),
      ], [
        E([B('system.if', { condition: 'signal < 6' })], [B('audio.play', { sound: 'click', volume: '35' })]),
      ]),
      E([B('input.on_key_pressed', { key: 'R' })], [B('game.restart')]),
    ]),
  ];
  return makeProject({
    name: 'Digging Treasure Hunt', template: 'digging', scenes: [k.scene], events, plane: 'xz',
    globals: [v('treasure', 0), v('goal', spots.length), v('gold', 0), v('cooldown', 0), v('digDelay', 0.28), v('digRadius', 0.75), v('signal', 99)],
    tutorial: [
      { title: 'Dig', text: 'First person: click the view to look around. Hold left click to dig where you look, right click to pile earth back. You can dig all the way down to bedrock — and climb out by building steps.', target: 'play' },
      { title: 'Find the treasure', text: 'Eight treasures are buried 1.5–3.5 m deep. Follow the detector at the bottom of the screen; when it says "dig here", dig down and walk into the treasure. Gold ore in the stone counts too.', target: 'play' },
      { title: 'Voxel terrain', text: 'The Terrain object is voxel terrain (Add › Mesh › Voxel terrain): set its size, block size, seed, ground height, hills and gold amount in the Inspector. "Dig terrain" and "Build terrain" edit it; "On terrain dug" reports what was removed.', target: 'inspector' },
      { title: 'Tune', text: 'Global variables digRadius and digDelay set how big and how fast each shovel stroke is.', target: 'eventsheet' },
    ],
  });
}
