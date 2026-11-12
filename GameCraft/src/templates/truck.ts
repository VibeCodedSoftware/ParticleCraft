// Template 1: low-poly truck coin collector.
import { B, E, G, Kit, LIB, bh, makeProject, v } from './kit';

export function truckTemplate() {
  const k = new Kit('Coin Road', '3d');
  k.scene.settings.background = '#9cc9ef';
  k.scene.settings.world = { color: '#bcd7f2', strength: 0.7, viewTransform: 'agx', exposure: 0, fogEnabled: true, fogColor: '#c9dcef', fogDensity: 0.008 };
  k.box('Ground', 0, -0.5, -60, 260, 1, 260, '#6aa84f');

  // Winding road made of segments between waypoints (x, z).
  const path: [number, number][] = [[0, 10], [0, -30], [12, -55], [38, -70], [62, -62], [76, -38], [70, -10], [48, 6], [30, 24], [10, 40], [-14, 46]];
  for (let s = 0; s < path.length - 1; s++) {
    const [ax, az] = path[s], [bx, bz] = path[s + 1];
    const len = Math.hypot(bx - ax, bz - az) + 7;
    const heading = (Math.atan2(-(bz - az), bx - ax) * 180) / Math.PI;
    k.box('Road', (ax + bx) / 2, 0.02, (az + bz) / 2, len, 0.04, 9, '#3d4148', false, { ry: heading, collider: { shape: 'none', size: [1, 1, 1], offset: [0, 0, 0] } });
  }
  // Coins spaced along the road.
  let coins = 0;
  for (let s = 0; s < path.length - 1; s++) {
    const [ax, az] = path[s], [bx, bz] = path[s + 1];
    for (const t of s === 0 ? [0.55] : [0.3, 0.75]) {
      const side = coins % 3 === 0 ? 0 : coins % 3 === 1 ? 2 : -2;
      const nx = -(bz - az), nz = bx - ax, nl = Math.hypot(nx, nz) || 1;
      k.model('Coin', LIB.coin, 1.4, { x: ax + (bx - ax) * t + (nx / nl) * side, y: 0.6, z: az + (bz - az) * t + (nz / nl) * side, behaviors: [bh('rotate', { speed: 160 })] });
      coins++;
    }
  }
  // Obstacles: crates and barriers to steer around.
  const obstacles: [number, number][] = [[-1.5, -14], [2, -40], [24, -63], [55, -66], [74, -24], [58, -2], [38, 15]];
  obstacles.forEach(([x, z], n) => k.box(n % 2 ? 'Barrier' : 'Crate', x, n % 2 ? 0.5 : 0.75, z, n % 2 ? 3 : 1.5, n % 2 ? 1 : 1.5, n % 2 ? 0.6 : 1.5, n % 2 ? '#e4572e' : '#a0703a'));
  for (let n = 0; n < 24; n++) {
    const a = (n / 24) * Math.PI * 2, r = 70 + (n % 3) * 9;
    k.add('Tree', 'cone', { x: 30 + Math.cos(a) * r, y: 3, z: -20 + Math.sin(a) * r, sx: 3, sy: 6, sz: 3, color: '#2f7d32', behaviors: [bh('solid')] });
  }

  k.model('StartArch', LIB.arch, 1.2, { x: 0, z: 4, collider: { shape: 'none', size: [1, 1, 1], offset: [0, 0, 0] } });
  k.model('Finish', LIB.arch, 1.2, { x: -14, z: 46, ry: 90, collider: { shape: 'box', size: [8, 6.8, 8], offset: [0, 3.4, 0], isTrigger: true } });

  const truck = k.model('Truck', LIB.truck, 0.65, { name: 'Truck', y: 0.2, ry: 90, mesh: { asset: LIB.truck.asset, rotY: -90 }, behaviors: [bh('car', { maxSpeed: 26, acceleration: 14, braking: 34, steerSpeed: 115, drift: 0.12 })] }, [4.5, 2.3, 4.5]);
  void truck;
  k.camera({ x: -10, y: 6, z: 0 }, { focalLength: 35 }, { target: 'Truck', offsetX: -11, offsetY: 5, offsetZ: 0, rotateWithTarget: true, smoothing: 0.88 });
  k.sun(3.2, -55, 30, { behaviors: [bh('follow', { target: 'Truck', offsetX: 10, offsetY: 30, offsetZ: 20, lookAt: false, smoothing: 0 })] });

  k.text('CoinsText', 'Coins: 0', 'tl', 16, 12, 26, '#ffd23f');
  k.text('TimeText', 'Time: 0.0 s', 'tr', 16, 12, 26, '#ffffff');
  k.text('Hint', 'W/S or ↑/↓ drive · A/D or ←/→ steer · R restart', 'bc', 0, 16, 16, '#e8eef6');

  const events = [
    G('Game setup', [
      E([B('system.on_start_of_layout')], [
        B('var.set', { variable: 'totalCoins', value: 'Coin.Count' }),
        B('ui.set_text', { text: '"Coins: 0 / " & totalCoins' }, 'CoinsText'),
        B('audio.play_music', { sound: 'music:adventure', volume: '25' }),
        B('ui.show_message', { text: '"Collect every coin, then drive through the finish arch!"', seconds: '3.5' }),
        B('game.set_checkpoint', {}, 'Truck'),
      ]),
      E([B('system.every_tick'), B('system.is_boolean_set', { variable: 'finished' }, undefined, { invert: true })], [
        B('var.add', { variable: 'time', value: 'dt' }),
        B('ui.set_text', { text: '"Time: " & round(time * 10) / 10 & " s"' }, 'TimeText'),
      ]),
    ]),
    G('Coins', [
      E([B('object.on_collision', { other: 'Coin' }, 'Truck')], [
        B('particles.spawn_at', { preset: 'coin' }, 'Coin'),
        B('audio.play', { sound: 'coin', volume: '70' }),
        B('var.add', { variable: 'coins', value: '1' }),
        B('object.destroy', {}, 'Coin'),
        B('ui.set_text', { text: '"Coins: " & coins & " / " & totalCoins' }, 'CoinsText'),
      ]),
    ]),
    G('Finish line', [
      E([B('object.on_collision', { other: 'Finish' }, 'Truck')], [], [
        E([B('system.compare_variable', { variable: 'coins', op: '>=', value: 'totalCoins' })], [
          B('var.set', { variable: 'finished', value: 'true' }),
          B('particles.spawn_at', { preset: 'magic' }, 'Truck'),
          B('audio.play', { sound: 'win', volume: '80' }),
          B('game.victory', { title: '"Finished!"', message: '"Time: " & round(time * 10) / 10 & " s  ·  Coins: " & coins & " / " & totalCoins' }),
        ]),
        E([], [B('ui.show_message', { text: '"Collect all the coins first! (" & coins & " / " & totalCoins & ")"', seconds: '2' })], [], { isElse: true }),
      ]),
    ]),
    G('Handling', [
      E([B('car.on_hit', {}, 'Truck')], [B('camera.shake', { intensity: '0.25', duration: '0.25' }), B('audio.play', { sound: 'hit', volume: '60' }), B('particles.spawn_at', { preset: 'dust' }, 'Truck')]),
      E([B('object.compare_property', { property: 'Y', op: '<', value: '-6' }, 'Truck')], [B('game.respawn_checkpoint', {}, 'Truck')]),
      E([B('input.on_key_pressed', { key: 'R' })], [B('game.restart')]),
    ]),
  ];
  return makeProject({
    name: 'Truck Coin Collector', template: 'truck', scenes: [k.scene], events, plane: 'xz',
    globals: [v('coins', 0), v('totalCoins', 0), v('time', 0), v('finished', false)],
    tutorial: [
      { title: 'Drive!', text: 'Press ▶ Play (F5). Drive with W/S and steer with A/D. Collect every coin, then cross the finish arch.', target: 'play' },
      { title: 'Tune the handling', text: 'Stop, select the Truck in the Outliner and open the Car behavior in the Inspector: change Top speed, Acceleration, Braking, Steering and Drift.', target: 'inspector' },
      { title: 'Camera smoothing', text: 'Select the Camera. Its Follow behavior has Smoothing (0 = rigid, 0.95 = floaty) and the offset behind the truck.', target: 'inspector' },
      { title: 'How coins work', text: 'Open the Event sheet. "Truck on collision with Coin" spawns coin particles, plays a sound, adds 1 to coins, destroys the coin and updates the text.', target: 'eventsheet' },
      { title: 'Same logic as blocks', text: 'Switch the bottom panel to Blocks: it is the same logic shown as Scratch-style blocks. Edit either one.', target: 'blocks' },
      { title: 'Make it yours', text: 'Duplicate a coin (Shift+D), move it with G, and press Play — the coin counter adapts automatically because totalCoins = Coin.Count.', target: 'viewport' },
    ],
  });
}
