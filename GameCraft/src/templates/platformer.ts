// Template 2: 3D platformer with moving platforms, checkpoints, collectibles and fall respawn.
import { B, E, G, Kit, LIB, animatedHuman, bh, makeProject, v } from './kit';

/** The flag stands 3 m tall; its trigger is wide enough to run through. */
const FLAG_SCALE = 3 / LIB.flag.size[1];
const FLAG_ZONE = { shape: 'box' as const, size: [1.5 / FLAG_SCALE, 8 / FLAG_SCALE, 1.5 / FLAG_SCALE] as [number, number, number], offset: [0, 4 / FLAG_SCALE, 0] as [number, number, number], isTrigger: true };

export function platformerTemplate() {
  const k = new Kit('Sky Steps', '3d');
  k.scene.settings.background = '#87b8f5';
  k.scene.settings.world = { color: '#cfe3ff', strength: 0.75, viewTransform: 'agx', exposure: 0, fogEnabled: true, fogColor: '#a9c8f0', fogDensity: 0.012 };
  const plat = (x: number, y: number, z: number, sx: number, sz: number, color = '#7cb26a', o = {}) => k.box('Platform', x, y - 0.5, z, sx, 1, sz, color, true, o);
  plat(0, 0, 0, 10, 10);
  plat(0, 1, -10, 4, 4, '#c9a46a');
  plat(5, 2.2, -16, 4, 4, '#c9a46a');
  plat(11, 3.4, -16, 3, 3, '#c9a46a');
  // Moving platforms (Sine behavior on solids carries the player).
  k.box('MovingPlatform', 17, 3.0, -16, 3, 0.6, 3, '#e8892b', true, { behaviors: [bh('solid'), bh('sine', { movement: 'horizontal', period: 4, magnitude: 3 })] });
  plat(25, 3.4, -16, 4, 4);
  k.model('Checkpoint', LIB.flag, FLAG_SCALE, { x: 25, y: 3.8, z: -16, collider: FLAG_ZONE });
  k.box('MovingPlatform', 25, 5, -23, 3, 0.6, 3, '#e8892b', true, { behaviors: [bh('solid'), bh('sine', { movement: 'vertical', period: 5, magnitude: 2.2 })] });
  plat(25, 7.4, -30, 3, 3, '#c9a46a');
  plat(19, 8.6, -34, 2.5, 2.5, '#c9a46a');
  plat(13, 9.8, -34, 2.5, 2.5, '#c9a46a');
  k.box('MovingPlatform', 6, 9.5, -34, 3, 0.6, 3, '#e8892b', true, { behaviors: [bh('solid'), bh('sine', { movement: 'depth', period: 3.5, magnitude: 3 })] });
  plat(-1, 10, -34, 5, 5);
  k.model('Checkpoint', LIB.flag, FLAG_SCALE, { x: -1, y: 10, z: -34, collider: FLAG_ZONE });
  plat(-8, 11.2, -38, 3, 3, '#c9a46a');
  plat(-14, 12.4, -42, 3, 3, '#c9a46a');
  plat(-14, 13, -52, 8, 8, '#7cb26a');
  k.model('Goal', LIB.arch, 0.9, { x: -14, y: 13, z: -54, collider: { shape: 'box', size: [7, 6.8, 3], offset: [0, 3.4, 0], isTrigger: true } });
  // Collectibles above platforms.
  ([[0, 2.2, -10], [5, 3.4, -16], [11, 4.6, -16], [17, 4.4, -16], [25, 8.6, -30], [13, 11, -34], [-8, 12.4, -38], [-14, 13.6, -42]] as const).forEach(([x, y, z]) =>
    k.model('Gem', LIB.coin, 1.1, { x, y, z, behaviors: [bh('rotate', { speed: 120 }), bh('sine', { movement: 'vertical', period: 2, magnitude: 0.2 })] }));
  // Real clouds, drifting below and far off (Clouds, in Post-FX & World).
  k.scene.settings.clouds = { enabled: true, coverage: 0.42, base: -26, thickness: 14, scale: 70, density: 0.8, steps: 20, style: 'volumetric', puffs: 3, span: 220, windX: 1.2, windZ: 0.4 };

  // Animated LowPolyHuman: idle, walk, jump and fall clips follow the Platform behavior automatically.
  k.model('Player', LIB.humanAnim, 0.97, { name: 'Player', y: 0.01, z: 2, ry: 90, mesh: animatedHuman(), behaviors: [bh('platform', { maxSpeed: 6, jumpStrength: 10.5, gravity: 28, airControl: 0.75 })] }, [0.6, 1.83, 0.6]);
  k.camera({ x: 0, y: 5, z: 10 }, { focalLength: 32 }, { target: 'Player', orbitWithMouse: true, distance: 9, sensitivity: 0.25, offsetX: 0, offsetY: 4, offsetZ: 8, smoothing: 0.75 });
  k.sun(3.5, -50, 25, { behaviors: [bh('follow', { target: 'Player', offsetX: 10, offsetY: 30, offsetZ: 20, lookAt: false, smoothing: 0 })] });

  k.typeVars('Checkpoint', [v('reached', false)]);
  k.text('GemsText', 'Gems: 0', 'tl', 16, 12, 26, '#7df9ff');
  k.text('Hint', 'WASD move · Shift run · Space jump · Mouse look (click the view) · Esc release mouse', 'bc', 0, 16, 15, '#ffffff');

  const events = [
    G('Start', [
      E([B('system.on_start_of_layout')], [B('game.set_checkpoint', {}, 'Player'), B('var.set', { variable: 'totalGems', value: 'Gem.Count' }), B('ui.set_text', { text: '"Gems: 0 / " & totalGems' }, 'GemsText'), B('audio.play_music', { sound: 'music:calm', volume: '25' })]),
    ]),
    G('Player', [
      E([B('platform.on_jump', {}, 'Player')], [B('audio.play', { sound: 'jump', volume: '45' })]),
      E([B('platform.on_landed', {}, 'Player')], [B('particles.spawn_at', { preset: 'footsteps' }, 'Player')]),
      E([B('object.compare_property', { property: 'Y', op: '<', value: '-12' }, 'Player')], [
        B('game.respawn_checkpoint', {}, 'Player'), B('var.add', { variable: 'falls', value: '1' }), B('ui.show_message', { text: '"Oops! Back to the checkpoint"', seconds: '1.5' }), B('audio.play', { sound: 'lose', volume: '40' }),
      ]),
    ]),
    G('Collectibles & checkpoints', [
      E([B('object.on_collision', { other: 'Gem' }, 'Player')], [B('particles.spawn_at', { preset: 'magic' }, 'Gem'), B('audio.play', { sound: 'coin', volume: '60' }), B('object.destroy', {}, 'Gem'), B('var.add', { variable: 'gems', value: '1' }), B('ui.set_text', { text: '"Gems: " & gems & " / " & totalGems' }, 'GemsText')]),
      E([B('object.on_collision', { other: 'Checkpoint' }, 'Player'), B('object.is_var_true', { variable: 'reached' }, 'Checkpoint', { invert: true })], [
        B('game.set_checkpoint', {}, 'Player'), B('object.set_var', { variable: 'reached', value: 'true' }, 'Checkpoint'),
        B('particles.spawn_at', { preset: 'teleport' }, 'Checkpoint'), B('ui.show_message', { text: '"Checkpoint!"', seconds: '1.5' }), B('audio.play', { sound: 'pickup', volume: '60' }),
      ]),
      E([B('object.on_collision', { other: 'Goal' }, 'Player')], [B('audio.play', { sound: 'win' }), B('game.victory', { title: '"You reached the top!"', message: '"Gems: " & gems & " / " & totalGems & "  ·  Falls: " & falls' })]),
      E([B('input.on_key_pressed', { key: 'R' })], [B('game.restart')]),
    ]),
  ];
  return makeProject({
    name: '3D Platformer', template: 'platformer', scenes: [k.scene], events, plane: 'xz',
    globals: [v('gems', 0), v('totalGems', 0), v('falls', 0)],
    tutorial: [
      { title: 'Play', text: 'Press Play, click the view to capture the mouse and climb to the arch. WASD moves relative to the camera, Space jumps.', target: 'play' },
      { title: 'Jump height & gravity', text: 'Select Player › Platform behavior: Jump strength, Gravity, Max speed and Air control are all live-editable.', target: 'inspector' },
      { title: 'Moving platforms', text: 'Orange platforms use the Sine behavior (horizontal, vertical, depth). Solids that move carry the player.', target: 'inspector' },
      { title: 'Checkpoints', text: 'In the Event sheet, touching a Checkpoint stores the player position with "Set checkpoint"; falling below Y -12 uses "Respawn at checkpoint".', target: 'eventsheet' },
      { title: 'Camera sensitivity', text: 'Select the Camera › Follow: Mouse sensitivity and Orbit distance.', target: 'inspector' },
    ],
  });
}
