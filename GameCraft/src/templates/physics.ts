// Template 4: gravity, walking, pick up, carry, drop and throw.
import { B, E, G, Kit, LIB, animatedHuman, bh, makeProject, v } from './kit';

export function physicsTemplate() {
  const k = new Kit('Physics Lab', '3d');
  k.scene.settings.background = '#2b3038';
  k.scene.settings.world = { color: '#9aa6b8', strength: 0.55, viewTransform: 'agx', exposure: 0 };
  k.box('Floor', 0, -0.5, 0, 40, 1, 40, '#59606b');
  for (const [x, z, sx, sz] of [[0, -20, 40, 1], [0, 20, 40, 1], [-20, 0, 1, 40], [20, 0, 1, 40]] as const) k.box('Wall', x, 1.5, z, sx, 3, sz, '#3f4652');
  k.add('Ramp', 'ramp', { x: 8, y: 1, z: -8, sx: 6, sy: 2, sz: 4, ry: 180, color: '#8a94a6', behaviors: [bh('solid')] });
  k.box('Ledge', 12, 1, -8, 3, 2, 4, '#8a94a6');
  const prop = (name: string, kind: any, x: number, y: number, z: number, s: number, color: string, phys: Record<string, any>) =>
    k.add('Prop', kind, { name, x, y, z, sx: s, sy: s, sz: s, color, behaviors: [bh('physics', phys)] });
  // A stack of crates and a range of physical properties to compare.
  for (let n = 0; n < 3; n++) prop('Crate', 'box', -6, 0.5 + n, -4, 1, '#b07a3c', { mass: 2, friction: 0.7, bounce: 0.05 });
  prop('Bouncy ball', 'sphere', -2, 3, -2, 0.8, '#e5484d', { mass: 0.5, friction: 0.2, bounce: 0.85 });
  prop('Beach ball', 'sphere', 2, 2, -3, 1.2, '#4c97ff', { mass: 0.3, friction: 0.3, bounce: 0.6, linearDamping: 0.6 });
  prop('Boulder', 'sphere', 5, 1, 2, 1.4, '#6b7280', { mass: 12, friction: 0.9, bounce: 0.05 });
  prop('Ice cube', 'box', -4, 1, 4, 0.8, '#bfe9ff', { mass: 1, friction: 0.02, bounce: 0.1 });
  prop('Feather box', 'box', 0, 4, 4, 0.6, '#f5f0d5', { mass: 0.2, friction: 0.5, bounce: 0.3, gravityScale: 0.25, linearDamping: 1.5 });
  // Animated LowPolyHuman: idle, walk, jump and fall clips follow the Platform behavior automatically.
  k.model('Player', LIB.humanAnim, 0.97, { name: 'Player', x: 0, z: 8, ry: 90, mesh: animatedHuman(), behaviors: [bh('platform', { maxSpeed: 5.5, jumpStrength: 9 })] }, [0.6, 1.83, 0.6]);
  k.camera({ x: 0, y: 6, z: 16 }, { focalLength: 30 }, { target: 'Player', orbitWithMouse: true, distance: 8, sensitivity: 0.25, offsetX: 0, offsetY: 4, offsetZ: 8, smoothing: 0.7 });
  k.sun(2.6, -60, 30, { y: 25, z: 10 });
  k.point('Lamp', -10, 6, -10, 2500, '#ffd9a0', {}, true);
  k.text('Hint', 'E pick up / drop · F or left click throw · X explosion · G toggle moon gravity · WASD/Space move', 'bc', 0, 14, 15, '#ffffff');
  k.text('Status', 'Holding: nothing', 'tl', 16, 12, 22, '#7df9ff');
  k.text('Settings', '', 'tr', 16, 12, 16, '#c7cdd6');

  const events = [
    G('Pick up, drop and throw (reusable)', [
      E([B('input.on_key_pressed', { key: 'E' })], [], [
        E([B('physics.is_holding', {}, 'Player')], [B('physics.drop', {}, 'Player'), B('audio.play', { sound: 'click', volume: '50' }), B('ui.set_text', { text: '"Holding: nothing"' }, 'Status')]),
        E([], [B('physics.grab_nearest', { object: 'Prop', distance: 'pickupDistance' }, 'Player')], [
          E([B('physics.is_holding', {}, 'Player')], [B('audio.play', { sound: 'pickup', volume: '50' }), B('ui.set_text', { text: '"Holding: " & Prop.name & " (" & Prop.Physics.Mass & " kg)"' }, 'Status')]),
          E([], [B('ui.show_message', { text: '"Nothing within reach (pickupDistance = " & pickupDistance & ")"', seconds: '1.5' })], [], { isElse: true }),
        ], { isElse: true }),
      ]),
      E([B('input.on_key_pressed', { key: 'F' }), B('physics.is_holding', {}, 'Player')], [B('physics.throw', { strength: 'throwStrength', up: '3' }, 'Player'), B('audio.play', { sound: 'throw', volume: '60' }), B('ui.set_text', { text: '"Holding: nothing"' }, 'Status')]),
      E([B('input.on_mouse_click', { button: 'left' }), B('physics.is_holding', {}, 'Player')], [B('physics.throw', { strength: 'throwStrength', up: '3' }, 'Player'), B('audio.play', { sound: 'throw', volume: '60' }), B('ui.set_text', { text: '"Holding: nothing"' }, 'Status')]),
    ]),
    G('World', [
      E([B('physics.on_impact', {}, 'Prop')], [B('audio.play_at', { sound: 'hit', volume: '35' }, 'Prop'), B('particles.spawn_at', { preset: 'dust' }, 'Prop')]),
      E([B('input.on_key_pressed', { key: 'X' })], [B('physics.explode', { x: 'Player.X', y: 'Player.Y', z: 'Player.Z', radius: '7', force: '18' }), B('particles.spawn', { preset: 'explosion', x: 'Player.X', y: 'Player.Y + 1', z: 'Player.Z' }), B('audio.play', { sound: 'explosion', volume: '70' }), B('camera.shake', { intensity: '0.4', duration: '0.4' })]),
      E([B('input.on_key_pressed', { key: 'G' })], [B('var.toggle', { variable: 'moonGravity' })], [
        E([B('system.is_boolean_set', { variable: 'moonGravity' })], [B('physics.set_world_gravity', { value: '-3.5' }), B('platform.set_gravity', { value: '8' }, 'Player'), B('ui.show_message', { text: '"Moon gravity"', seconds: '1.2' })]),
        E([], [B('physics.set_world_gravity', { value: '-20' }), B('platform.set_gravity', { value: '28' }, 'Player'), B('ui.show_message', { text: '"Earth gravity"', seconds: '1.2' })], [], { isElse: true }),
      ]),
      E([B('system.every_tick')], [B('ui.set_text', { text: '"pickupDistance " & pickupDistance & " · throwStrength " & throwStrength & " · moon " & moonGravity' }, 'Settings')]),
      E([B('object.compare_property', { property: 'Y', op: '<', value: '-10' }, 'Prop')], [B('object.respawn', { x: '0', y: '5', z: '0' }, 'Prop')]),
    ]),
  ];
  return makeProject({
    name: 'Physics Playground', template: 'physics', scenes: [k.scene], events, plane: 'xz',
    globals: [v('pickupDistance', 2.5), v('throwStrength', 14), v('moonGravity', false)],
    tutorial: [
      { title: 'Play', text: 'Walk up to an object and press E to pick it up. Press F (or click) to throw it, E again to drop.', target: 'play' },
      { title: 'Compare materials', text: 'Each Prop has its own Physics behavior: the ice cube has almost no friction, the bouncy ball has high bounce, the boulder is heavy and hard to throw far.', target: 'inspector' },
      { title: 'Adjust the system', text: 'pickupDistance and throwStrength are global variables (top of the Event sheet). Change them and Play again.', target: 'eventsheet' },
      { title: 'Rebuild it yourself', text: 'The whole interaction is 3 reusable blocks: "Grab nearest object", "Drop object", "Throw object" plus "Is holding an object".', target: 'blocks' },
    ],
  });
}
