// Template 3: 2D side scroller (pixel-art sprites, Platform behavior, parallax, enemies, lives).
import { DEFAULT_CAMERA } from '@shared/src/runtime/scene';
import { B, E, G, Kit, bh, makeProject, v } from './kit';

export function sideScrollerTemplate() {
  const k = new Kit('Level 1', '2d');
  k.scene.settings.background = '#7ec8f2';
  const tile = (x: number, y: number, img = 'proc:grass') => k.add('Tile', 'sprite', { x, y, sprite: { image: img, frames: 1, fps: 1, animation: 'idle', pixelArt: true }, collider: { shape: 'none', size: [1, 1, 1], offset: [0, 0, 0] } });
  const solid = (x0: number, x1: number, y: number, h = 1, img = 'proc:grass') => {
    for (let x = x0; x <= x1; x++) for (let yy = 0; yy < h; yy++) tile(x, y - yy, yy === 0 ? img : 'proc:brick');
    k.box('Ground', (x0 + x1) / 2, y - (h - 1) / 2, 0, x1 - x0 + 1, h, 1, '#000', true, { visible: false });
  };
  solid(-4, 18, 0, 3);
  solid(22, 34, 0, 3);
  solid(27, 30, 4, 1, 'proc:brick');
  solid(38, 41, 2, 1, 'proc:brick');
  solid(44, 47, 4, 1, 'proc:brick');
  solid(50, 70, 0, 3);
  solid(56, 59, 4, 1, 'proc:brick');
  solid(74, 98, 0, 3);
  solid(80, 82, 3, 1, 'proc:brick');
  for (let y = 1; y <= 8; y++) k.box('Wall', -5, y, 0, 1, 1, 1, '#000', true, { visible: false });
  // Hazards and pickups.
  for (const x of [12, 13, 61, 62, 86]) k.add('Spike', 'sprite', { x, y: 1, sprite: { image: 'proc:spike', frames: 1, fps: 1, animation: 'idle' }, collider: { shape: 'box', size: [0.8, 0.5, 1], offset: [0, -0.2, 0] } });
  for (const [x, y] of [[5, 2], [6, 2], [7, 2], [28, 6], [29, 6], [39, 4], [45, 6], [46, 6], [57, 6], [58, 6], [81, 5], [90, 2], [91, 2]]) k.add('Coin', 'sprite', { x, y, sx: 0.7, sy: 0.7, sprite: { image: 'proc:coin', frames: 4, fps: 8, animation: 'spin' } });
  const slime = (x: number, y: number) => k.add('Slime', 'sprite', { x, y, sprite: { image: 'proc:slime', frames: 2, fps: 4, animation: 'idle' }, collider: { shape: 'box', size: [0.8, 0.6, 1], offset: [0, -0.2, 0] }, vars: { dir: -1 }, behaviors: [bh('platform', { maxSpeed: 2, defaultControls: false, acceleration: 20 })] });
  slime(16, 1.5); slime(31, 1.5); slime(65, 1.5); slime(93, 1.5);
  for (const x of [-3, 18.5, 22.5, 33.5, 50.5, 69.5, 74.5, 97.5]) k.box('Turner', x, 1.5, 0, 0.4, 2, 1, '#f0f', false, { visible: false, collider: { shape: 'box', size: [1, 1, 1], offset: [0, 0, 0], isTrigger: true } });
  k.add('Flag', 'sprite', { x: 96, y: 2.5, sy: 2, sprite: { image: 'proc:flag', frames: 2, fps: 3, animation: 'idle' }, collider: { shape: 'box', size: [0.6, 1, 1], offset: [0, 0, 0], isTrigger: true } });
  // Parallax background layers (move with the camera at a fraction of its speed).
  for (let n = 0; n < 8; n++) k.add('Parallax', 'sprite', { x: n * 16, y: 3, z: -6, sx: 16, sy: 8, layer: -2, vars: { baseX: n * 16, factor: 0.6 }, sprite: { image: 'proc:hills', frames: 1, fps: 1, animation: 'idle' }, collider: { shape: 'none', size: [1, 1, 1], offset: [0, 0, 0] } });
  for (let n = 0; n < 10; n++) k.add('Parallax', 'sprite', { x: n * 13 + 4, y: 9 + (n % 3), z: -8, sx: 4, sy: 2, layer: -3, vars: { baseX: n * 13 + 4, factor: 0.85 }, sprite: { image: 'proc:cloud', frames: 1, fps: 1, animation: 'idle' }, collider: { shape: 'none', size: [1, 1, 1], offset: [0, 0, 0] } });
  k.typeVars('Parallax', [v('baseX', 0), v('factor', 0.5)]);
  k.typeVars('Slime', [v('dir', -1)]);

  k.add('Player', 'sprite', { name: 'Player', x: 0, y: 2, layer: 5, sprite: { image: 'proc:hero', frames: 6, fps: 8, animation: 'idle', pixelArt: true }, collider: { shape: 'box', size: [0.7, 0.95, 1], offset: [0, -0.02, 0] }, behaviors: [bh('platform', { maxSpeed: 7, jumpStrength: 13.5, gravity: 36, acceleration: 45, deceleration: 50 }), bh('timer')] });
  k.camera({ x: 10, y: 4, z: 20 }, { ...DEFAULT_CAMERA, type: 'orthographic', orthoScale: 24, postfx: [], pixelPerfect: true }, { target: 'Player', offsetX: 3, offsetY: 2, offsetZ: 20, smoothing: 0.85, lookAt: false });

  k.text('LivesText', 'Lives: 3', 'tl', 16, 12, 24, '#ff6b6b');
  k.text('ScoreText', 'Score: 0', 'tr', 16, 12, 24, '#ffffff');
  k.text('Hint', '← → / A D move · Space / W jump · stomp slimes · avoid spikes', 'bc', 0, 14, 15, '#0b2a40');

  const events = [
    G('Camera & parallax', [
      E([B('system.every_tick')], [B('object.set_position', { x: 'Self.baseX + Camera.X * Self.factor', y: 'Self.Y', z: 'Self.Z' }, 'Parallax')]),
      E([B('system.every_tick'), B('object.compare_property', { property: 'X', op: '<', value: '8' }, 'Camera')], [B('object.set_position', { x: '8', y: 'Self.Y', z: 'Self.Z' }, 'Camera')]),
      E([B('system.every_tick'), B('object.compare_property', { property: 'X', op: '>', value: '90' }, 'Camera')], [B('object.set_position', { x: '90', y: 'Self.Y', z: 'Self.Z' }, 'Camera')]),
      E([B('system.every_tick'), B('object.compare_property', { property: 'Y', op: '<', value: '4' }, 'Camera')], [B('object.set_position', { x: 'Self.X', y: '4', z: 'Self.Z' }, 'Camera')]),
    ]),
    G('Enemies', [
      E([B('system.every_tick'), B('object.compare_var', { variable: 'dir', op: '<', value: '0' }, 'Slime')], [B('platform.simulate_control', { control: 'left' }, 'Slime')]),
      E([B('system.every_tick'), B('object.compare_var', { variable: 'dir', op: '>', value: '0' }, 'Slime')], [B('platform.simulate_control', { control: 'right' }, 'Slime')]),
      E([B('object.on_collision', { other: 'Turner' }, 'Slime')], [B('object.set_var', { variable: 'dir', value: '-Self.dir' }, 'Slime')]),
      E([B('object.on_collision', { other: 'Slime' }, 'Player')], [], [
        E([B('object.compare_property', { property: 'VY', op: '<', value: '-0.5' }, 'Player')], [
          B('particles.spawn_at', { preset: 'debris' }, 'Slime'), B('object.destroy', {}, 'Slime'),
          B('object.set_velocity', { vx: 'Player.VX', vy: '11', vz: '0' }, 'Player'),
          B('var.add', { variable: 'score', value: '100' }), B('audio.play', { sound: 'hit', volume: '60' }),
        ]),
        E([], [B('function.call', { name: 'Hurt', args: '' })], [], { isElse: true }),
      ]),
      E([B('object.on_collision', { other: 'Spike' }, 'Player')], [B('function.call', { name: 'Hurt', args: '' })]),
    ]),
    G('Player', [
      E([B('platform.on_jump', {}, 'Player')], [B('audio.play', { sound: 'jump', volume: '40' })]),
      E([B('object.on_collision', { other: 'Coin' }, 'Player')], [B('particles.spawn_at', { preset: 'coin' }, 'Coin'), B('object.destroy', {}, 'Coin'), B('var.add', { variable: 'score', value: '10' }), B('audio.play', { sound: 'coin', volume: '60' })]),
      E([B('object.compare_property', { property: 'Y', op: '<', value: '-6' }, 'Player')], [B('function.call', { name: 'Hurt', args: '' }), B('game.respawn_checkpoint', {}, 'Player')]),
      E([B('system.every_tick'), B('timer.is_running', { tag: 'invuln' }, 'Player')], [B('object.set_opacity', { value: '(floor(time * 12) % 2) * 70 + 30' }, 'Player')]),
      E([], [B('object.set_opacity', { value: '100' }, 'Player')], [], { isElse: true }),
      E([B('system.every_tick')], [B('ui.set_text', { text: '"Lives: " & lives' }, 'LivesText'), B('ui.set_text', { text: '"Score: " & score' }, 'ScoreText')]),
      E([B('object.on_collision', { other: 'Flag' }, 'Player')], [B('audio.play', { sound: 'win' }), B('game.victory', { title: '"Level complete!"', message: '"Score: " & score' })]),
      E([B('input.on_key_pressed', { key: 'R' })], [B('game.restart')]),
    ]),
    G('Functions', [
      E([B('function.on_function', { name: 'Hurt' }), B('timer.is_running', { tag: 'invuln' }, 'Player', { invert: true })], [
        B('var.subtract', { variable: 'lives', value: '1' }), B('timer.start', { tag: 'invuln', duration: '1.2', mode: 'once' }, 'Player'),
        B('object.set_velocity', { vx: '-Player.VX', vy: '8', vz: '0' }, 'Player'), B('audio.play', { sound: 'hit', volume: '70' }), B('camera.shake', { intensity: '0.15', duration: '0.2' }),
      ], [
        E([B('system.compare_variable', { variable: 'lives', op: '<=', value: '0' })], [B('audio.play', { sound: 'lose' }), B('game.defeat', { title: '"Game over"', message: '"Score: " & score' })]),
      ]),
    ]),
  ];
  return makeProject({
    name: '2D Side Scroller', template: 'sidescroller', scenes: [k.scene], events, plane: 'xy',
    globals: [v('lives', 3), v('score', 0)],
    tutorial: [
      { title: 'Play', text: 'Run with ←/→, jump with Space. Stomp slimes from above; touching them from the side costs a life.', target: 'play' },
      { title: 'Movement settings', text: 'Select Player › Platform: Max speed, Jump strength, Gravity, Acceleration and Deceleration change the feel instantly.', target: 'inspector' },
      { title: 'Enemy patrol', text: 'Slimes use Platform with Default controls off. Events "Simulate control" left/right based on their dir variable and flip at invisible Turner triggers.', target: 'eventsheet' },
      { title: 'Functions', text: 'The Hurt function handles lives, invulnerability (a Timer), knockback and the defeat screen. It is called from three places.', target: 'eventsheet' },
      { title: 'Parallax', text: 'Hills and clouds move with Camera.X × factor. Change a Parallax object\'s factor variable to make it nearer or farther.', target: 'inspector' },
    ],
  });
}
