// Template 5: combat arena, blue player vs red enemies with a pathfinding state machine.
import { makeInstance } from '@shared/src/runtime/scene';
import { PACK_BY_ID, installPack, packDefaults } from '@shared/src/packs';
import { B, E, G, Kit, LIB, animatedHuman, bh, makeProject, v } from './kit';

export function combatTemplate() {
  const k = new Kit('Arena', '3d');
  k.scene.settings.background = '#1f232a';
  k.scene.settings.world = { color: '#8d98ab', strength: 0.5, viewTransform: 'agx', exposure: 0 };
  k.scene.settings.bounds = { min: [-22, -5, -22], max: [22, 20, 22] };
  k.box('Floor', 0, -0.5, 0, 44, 1, 44, '#4a505b');
  for (const [x, z, sx, sz] of [[0, -21, 44, 2], [0, 21, 44, 2], [-21, 0, 2, 44], [21, 0, 2, 44]] as const) k.box('Wall', x, 1.5, z, sx, 3, sz, '#30353e');
  // Obstacles enemies must navigate around.
  for (const [x, z, sx, sz] of [[-8, -6, 8, 1.5], [8, 6, 8, 1.5], [0, 0, 1.5, 7], [-12, 10, 1.5, 6], [12, -10, 1.5, 6], [6, -14, 5, 1.5], [-6, 14, 5, 1.5]] as const) k.box('Obstacle', x, 1.25, z, sx, 2.5, sz, '#6b5d4d');
  // Player and enemies are the animated LowPolyHuman (idle / walk / punch / hit / death clips).
  const player = k.model('Player', LIB.humanAnim, 0.95, { name: 'Player', x: 0, z: 15, color: '#3a7bff', mesh: animatedHuman(true), vars: { weapon: 'Sword', ammo: 8 }, behaviors: [bh('eightdir', { maxSpeed: 6.5, setAngle: false }), bh('health', { maxHp: 100, hp: 100, invulnerableTime: 0.4 })] }, [0.6, 1.83, 0.6]);
  // Weapons are children of the player, shown/hidden by "Equip weapon" (local units are the model's meters).
  k.model('Sword', LIB.sword, 0.09, { name: 'Sword', parent: player.uid, parentBone: 'DEF-handR', x: 0, y: 0.09, z: 0.02, rx: 90, tags: ['weapon'], collider: { shape: 'none', size: [1, 1, 1], offset: [0, 0, 0] } });
  k.model('Gun', LIB.gun, 0.11, { name: 'Gun', parent: player.uid, parentBone: 'DEF-handR', x: 0, y: 0.1, z: 0.03, rx: 90, visible: false, tags: ['weapon'], collider: { shape: 'none', size: [1, 1, 1], offset: [0, 0, 0] } });
  const spots = [[-14, -14], [14, -16], [-15, 4], [15, 12]];
  spots.forEach(([x, z], n) => k.model('Enemy', LIB.humanAnim, 0.95, {
    name: 'Enemy ' + (n + 1), x, z, color: '#ff3b3b', mesh: animatedHuman(true),
    vars: { state: 'patrol', cooldown: 0, detectRadius: 11, attackRange: 1.9, attackCooldown: 1.1, damage: 12 },
    behaviors: [bh('pathfinding', { maxSpeed: 3.6, cellSize: 0.5, agentRadius: 0.45 }), bh('health', { maxHp: 70, hp: 70 }), bh('timer')],
  }, [0.6, 1.83, 0.6]));
  k.typeVars('Enemy', [v('state', 'patrol'), v('cooldown', 0), v('detectRadius', 11), v('attackRange', 1.9), v('attackCooldown', 1.1), v('damage', 12)]);
  k.typeVars('Player', [v('weapon', 'Sword'), v('ammo', 8)]);
  const bullet = makeInstance(0, 'Bullet', 'sphere', { sx: 0.25, sy: 0.25, sz: 0.25, color: '#ffe066', material: { roughness: 0.3, metalness: 0, emissive: '#ffcc33', emissiveStrength: 2 }, collider: { shape: 'box', size: [1, 1, 1], offset: [0, 0, 0] }, behaviors: [bh('bullet', { speed: 34, lifetime: 1.5 })] });
  k.template(bullet);
  k.camera({ x: 0, y: 18, z: 26 }, { focalLength: 32 }, { target: 'Player', offsetX: 0, offsetY: 17, offsetZ: 10, smoothing: 0.85 });
  k.sun(2.4, -65, 20, { y: 30, z: 10 });
  k.point('Torch', -19, 3, -19, 1500, '#ff9a4a'); k.point('Torch', 19, 3, 19, 1500, '#ff9a4a');
  k.emitter('TorchFire', 'fire', -19, 2.2, -19); k.emitter('TorchFire', 'fire', 19, 2.2, 19);

  k.text('HPText', 'Health', 'tl', 16, 12, 18, '#4fd1ff');
  k.text('WeaponText', 'Weapon: Sword', 'bl', 16, 40, 20, '#ffffff');
  k.text('AmmoText', 'Ammo: 8 / 8', 'bl', 16, 14, 18, '#ffe066');
  k.text('KillsText', 'Kills: 0', 'tr', 16, 12, 22, '#ff6b6b');
  k.text('Hint', 'WASD move · click attack · 1 / 2 weapon · R reload · F lock on · G next · E dash', 'tc', 0, 14, 15, '#c7cdd6');

  const st = (s: string) => B('object.compare_var', { variable: 'state', op: '=', value: `"${s}"` }, 'Enemy');
  // How he stands with each weapon: the pistol aimed, or the sword ready. (Walking keeps these arms' stance by clip choice.)
  const SWORD_STANCE = () => [B('anim.set_role', { role: 'idle', clip: 'Sword_Idle' }, 'Player'), B('anim.set_role', { role: 'walk', clip: '' }, 'Player')];
  const GUN_STANCE = () => [B('anim.set_role', { role: 'idle', clip: 'Pistol_Aim_Neutral' }, 'Player'), B('anim.set_role', { role: 'walk', clip: '' }, 'Player')];
  const events = [
    G('Player', [
      E([B('system.on_start_of_layout')], [B('combat.equip', { weapon: 'Sword' }, 'Player'), ...SWORD_STANCE(), B('ui.set_bar', { value: 'Player.Health.HP', max: 'Player.Health.MaxHP' }, 'HPText'), B('audio.play_music', { sound: 'music:adventure', volume: '20' })]),
      E([B('system.every_tick')], [B('object.look_at_position', { x: 'Mouse.X', y: 'Player.Y', z: 'Mouse.Z' }, 'Player')]),
      E([B('input.on_key_pressed', { key: '1' })], [B('combat.equip', { weapon: 'Sword' }, 'Player'), ...SWORD_STANCE(), B('ui.set_text', { text: '"Weapon: Sword"' }, 'WeaponText')]),
      E([B('input.on_key_pressed', { key: '2' })], [B('combat.equip', { weapon: 'Gun' }, 'Player'), ...GUN_STANCE(), B('ui.set_text', { text: '"Weapon: Gun"' }, 'WeaponText')]),
      E([B('input.on_key_pressed', { key: 'Q' })], [B('combat.switch_weapon', { weapons: 'Sword,Gun' }, 'Player'), B('ui.set_text', { text: '"Weapon: " & Player.weapon' }, 'WeaponText'), B('audio.play', { sound: 'click', volume: '40' })], [
        E([B('object.compare_var', { variable: 'weapon', op: '=', value: '"Gun"' }, 'Player')], GUN_STANCE()),
        E([], SWORD_STANCE(), [], { isElse: true }),
      ]),
      E([B('input.on_mouse_click', { button: 'left' })], [], [
        E([B('object.compare_var', { variable: 'weapon', op: '=', value: '"Gun"' }, 'Player')], [], [
          E([B('object.compare_var', { variable: 'ammo', op: '>', value: '0' }, 'Player')], [
            B('combat.shoot', { object: 'Bullet', speed: '34', spread: '2', damage: '25' }, 'Player'), B('object.add_var', { variable: 'ammo', value: '-1' }, 'Player'),
            B('particles.spawn_at', { preset: 'muzzle' }, 'Gun'), B('audio.play', { sound: 'shoot', volume: '55' }),
            B('anim.play', { name: 'Pistol_Shoot', loop: 'once' }, 'Player'),
          ]),
          E([], [B('ui.show_message', { text: '"Out of ammo — press R to reload"', seconds: '1.2' }), B('audio.play', { sound: 'click', volume: '50' })], [], { isElse: true }),
        ]),
        E([B('object.compare_var', { variable: 'weapon', op: '=', value: '"Sword"' }, 'Player')], [
          // The real swing clip: the sword is on the hand, so it follows.
          B('anim.play', { name: 'Sword_Attack', loop: 'once' }, 'Player'),
          B('combat.melee', { victims: 'Enemy', range: '2.6', arc: '120', damage: '34' }, 'Player'), B('audio.play', { sound: 'swing', volume: '60' }),
        ]),
      ]),
      E([B('input.on_key_pressed', { key: 'R' }), B('object.compare_var', { variable: 'weapon', op: '=', value: '"Gun"' }, 'Player'), B('object.compare_var', { variable: 'ammo', op: '<', value: '8' }, 'Player')], [
        B('ui.show_message', { text: '"Reloading…"', seconds: '1' }), B('audio.play', { sound: 'reload' }), B('system.wait', { seconds: '1' }), B('object.set_var', { variable: 'ammo', value: '8' }, 'Player'),
      ]),
      E([B('system.every_tick')], [B('ui.set_text', { text: '"Ammo: " & Player.ammo & " / 8"' }, 'AmmoText'), B('ui.set_text', { text: '"Health " & Player.Health.HP' }, 'HPText'), B('ui.set_bar', { value: 'Player.Health.HP', max: 'Player.Health.MaxHP' }, 'HPText')]),
      E([B('health.on_damaged', {}, 'Player')], [B('camera.shake', { intensity: '0.3', duration: '0.2' }), B('particles.spawn_at', { preset: 'sword' }, 'Player')]),
      E([B('health.on_died', {}, 'Player')], [B('audio.play', { sound: 'lose' }), B('game.defeat', { title: '"Defeated"', message: '"Kills: " & kills & " — press Restart"' })]),
    ]),
    G('Enemy AI state machine', [
      E([B('system.every_tick'), B('object.compare_var', { variable: 'cooldown', op: '>', value: '0' }, 'Enemy')], [B('object.add_var', { variable: 'cooldown', value: '-dt' }, 'Enemy')]),
      E([B('system.every_tick'), st('patrol')], [], [
        E([B('object.is_within_distance', { distance: 'Enemy.detectRadius', other: 'Player' }, 'Enemy'), B('pathfinding.has_line_of_sight', { other: 'Player' }, 'Enemy')], [
          B('ai.set_state', { state: 'chase' }, 'Enemy'), B('particles.spawn_at', { preset: 'sparks' }, 'Enemy'), B('audio.play_at', { sound: 'click', volume: '50' }, 'Enemy'),
        ]),
        E([B('object.pick_by_expression', { expression: 'Self.Pathfinding.IsMoving = 0' }, 'Enemy')], [B('ai.patrol', { radius: '7' }, 'Enemy')], [], { isElse: true }),
      ]),
      E([B('system.every_tick'), st('chase')], [], [
        E([B('object.is_within_distance', { distance: 'Enemy.attackRange', other: 'Player' }, 'Enemy')], [B('pathfinding.stop', {}, 'Enemy'), B('ai.set_state', { state: 'attack' }, 'Enemy')]),
        E([B('object.is_within_distance', { distance: 'Enemy.detectRadius * 1.8', other: 'Player' }, 'Enemy', { invert: true })], [B('pathfinding.stop', {}, 'Enemy'), B('ai.set_state', { state: 'patrol' }, 'Enemy')]),
        E([B('object.compare_var', { variable: 'state', op: '=', value: '"chase"' }, 'Enemy')], [B('pathfinding.move_to_object', { other: 'Player' }, 'Enemy')]),
      ]),
      E([B('system.every_tick'), st('attack')], [B('object.look_at', { other: 'Player' }, 'Enemy')], [
        E([B('object.is_within_distance', { distance: 'Enemy.attackRange * 1.3', other: 'Player' }, 'Enemy', { invert: true })], [B('ai.set_state', { state: 'chase' }, 'Enemy')]),
        E([B('object.compare_var', { variable: 'cooldown', op: '<=', value: '0' }, 'Enemy'), B('object.compare_var', { variable: 'state', op: '=', value: '"attack"' }, 'Enemy')], [
          B('anim.play', { name: 'attack', loop: 'once' }, 'Enemy'),
          B('health.damage', { amount: 'Enemy.damage' }, 'Player'), B('object.set_var', { variable: 'cooldown', value: 'Enemy.attackCooldown' }, 'Enemy'), B('audio.play_at', { sound: 'hit', volume: '60' }, 'Enemy'),
        ]),
      ]),
      E([B('combat.on_hit', {}, 'Enemy')], [B('anim.play', { name: 'hit', loop: 'once' }, 'Enemy'), B('particles.spawn_at', { preset: 'sword' }, 'Enemy'), B('combat.knockback', { other: 'Player', strength: '5' }, 'Enemy'), B('ai.set_state', { state: 'recover' }, 'Enemy'), B('pathfinding.stop', {}, 'Enemy'), B('timer.start', { tag: 'recover', duration: '0.45', mode: 'once' }, 'Enemy'), B('audio.play_at', { sound: 'hit', volume: '50' }, 'Enemy')]),
      E([B('timer.on_timer', { tag: 'recover' }, 'Enemy'), B('health.is_dead', {}, 'Enemy', { invert: true })], [B('ai.set_state', { state: 'chase' }, 'Enemy')]),
      E([B('system.every_tick'), st('recover')], [B('object.set_velocity', { vx: 'Self.VX * 0.85', vy: '0', vz: 'Self.VZ * 0.85' }, 'Enemy'), B('object.move', { dx: 'Self.VX * dt', dy: '0', dz: 'Self.VZ * dt' }, 'Enemy')]),
      // Death: play the death clip, then remove the body.
      E([B('health.on_died', {}, 'Enemy')], [
        B('ai.set_state', { state: 'defeated' }, 'Enemy'), B('pathfinding.stop', {}, 'Enemy'), B('behavior.set_enabled', { behavior: 'pathfinding', state: 'disabled' }, 'Enemy'),
        B('anim.play', { name: 'death', loop: 'once' }, 'Enemy'), B('audio.play_at', { sound: 'explosion', volume: '40' }, 'Enemy'),
        B('var.add', { variable: 'kills', value: '1' }), B('ui.set_text', { text: '"Kills: " & kills' }, 'KillsText'),
        B('system.wait', { seconds: '1.6' }), B('particles.spawn_at', { preset: 'debris' }, 'Enemy'), B('object.destroy', {}, 'Enemy'),
      ]),
    ]),
    G('Win condition', [
      E([B('system.every_tick'), B('system.compare_count', { object: 'Enemy', op: '=', value: '0' }), B('system.trigger_once')], [B('audio.play', { sound: 'win' }), B('game.victory', { title: '"Arena cleared!"', message: '"All " & kills & " enemies defeated"' })]),
    ]),
  ];
  const project = makeProject({
    name: 'Combat Arena', template: 'combat', scenes: [k.scene], events, plane: 'xz',
    globals: [v('kills', 0)],
    tutorial: [
      { title: 'Fight', text: 'Move with WASD and aim with the mouse. Click to swing the sword; press 2 for the gun (8 shots, R reloads). F locks onto the nearest enemy (red circle), G switches target, E dashes to it and strikes.', target: 'play' },
      { title: 'Real AI', text: 'Enemies run a state machine: patrol → (see you within detectRadius and with line of sight) → chase with A* pathfinding around walls → attack when in attackRange → recover after being hit.', target: 'eventsheet' },
      { title: 'Tune enemies', text: 'Select an Enemy: instance variables detectRadius, attackRange, attackCooldown, damage; Pathfinding max speed; Health max HP.', target: 'inspector' },
      { title: 'Weapons', text: 'The Sword and Gun models are children of the Player tagged "weapon". "Equip weapon" shows the matching child.', target: 'outliner' },
    ],
  });
  // Lock-on and dash attack: the reusable pack (Packs › Combat), seen from above, so targets all around count.
  const lockon = PACK_BY_ID['combat.lockon'];
  installPack(project.logic, project.logic.sheets[0].id, k.scene, lockon, { ...packDefaults(lockon), angle: 360, range: 16, damage: 40 }, { app: 'gamecraft', mode: '3d' });
  return project;
}
