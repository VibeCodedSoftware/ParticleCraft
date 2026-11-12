// Template: Procedural Creatures. The rigged characters from ProceduralCharacters.blend animated with no clips: the
// player (a human) walks with planted feet, a robot, a four-legged robot, a spider, a snake and an octopus roam.
// Stairs show feet finding uneven ground; R makes the player go limp (ragdoll), F gets up.
import { B, E, Kit, bh, makeProject } from './kit';

const BLEND = 'lib:library/characters/ProceduralCharacters.blend';
const obj = (name: string) => `${BLEND}#${name}`;

export function proceduralTemplate() {
  const k = new Kit('Creatures', '3d');
  k.scene.settings.background = '#9fb7cf';
  k.box('Ground', 0, -0.5, 0, 50, 1, 50, '#7d8a6a');
  // Stairs and a wall: feet land on each step; a spider with Climb walls and Platform could walk up the wall.
  for (let s = 0; s < 5; s++) k.box('Stairs', 6 + s * 0.8, 0.12 + s * 0.12, -4, 0.8, 0.24 + s * 0.24, 4, '#a39a88');
  k.box('Wall', -8, 1.5, -8, 6, 3, 1, '#8c8c96');
  const creature = (name: string, blend: string, x: number, z: number, scale: number, size: [number, number, number], rig: string, extra: any[] = [], rotY = 0) =>
    k.add(name, 'mesh', {
      name, x, y: 0, z, sx: scale, sy: scale, sz: scale, color: '#ffffff',
      mesh: { asset: obj(blend), rotY },
      collider: { shape: 'box', size, offset: [0, size[1] / 2, 0] },
      behaviors: [...extra, bh('procanim', { rig })],
    });
  // Model sizes are in the .blend's units (the human is 11 tall): the scales make a person about 1.8 m.
  creature('Player', 'ProceduralHuman', 0, 0, 0.16, [3.5, 11.2, 3], 'human', [bh('platform', { maxSpeed: 4 })]);
  // Turning at a walking pace, so feet and body can keep up with each other.
  const wander = (r = 6, speed = 1.4) => bh('wander', { radius: r, speed, minWait: 0.5, maxWait: 2.5, turnSpeed: 110 });
  creature('Robot', 'TwoLeggedCube', -4, 4, 0.35, [2.5, 4.2, 2.5], 'robot', [wander()]);
  creature('RoboDog', '4LeggedCube', 4, 6, 0.3, [3.5, 4, 3.5], 'quadruped', [wander(7, 1.8)]);
  creature('Spider', 'ProceduralsPIDER', -6, -2, 0.18, [10, 4, 10], 'spider', [wander(5, 1.2)]);
  creature('Snake', 'ProceduralSnake', 2, -8, 0.2, [12, 1.5, 2], 'snake', [wander(6, 1)]);
  creature('Octopus', 'ProceduralOcto', 8, 4, 0.35, [8, 2.4, 8], 'octopus', [wander(4, 0.8)]);
  k.camera({ x: 0, y: 4, z: 8 }, { focalLength: 28 }, { target: 'Player', offsetY: 3, offsetZ: 6, smoothing: 0.85 });
  k.sun(3, -50, 40);
  k.text('Hint', 'WASD to walk · R: go limp (ragdoll) · F: get up', 'bc', 0, 14, 15, '#ffffff');
  const events = [
    E([B('input.on_key_pressed', { key: 'R' })], [B('proc.ragdoll', { force: '3' }, 'Player')]),
    E([B('input.on_key_pressed', { key: 'F' })], [B('proc.get_up', {}, 'Player')]),
  ];
  return makeProject({
    name: 'Procedural Creatures', template: 'procedural', scenes: [k.scene], events, plane: 'xz', globals: [],
    tutorial: [
      { title: 'No animation clips', text: 'Every creature here is animated by the Procedural Animation behavior: feet plant and step with IK, snakes slither, tentacles curl. Walk with WASD and watch the feet on the stairs.', target: 'play' },
      { title: 'Bone mapping', text: 'Select a creature: Procedural Animation lists the bone chains it found (legs, arms, head, tentacles). Change a role when the guess is wrong; Rig picks the gait.', target: 'inspector' },
      { title: 'Ragdoll', text: 'R makes the player go limp, F gets up (the Ragdoll and Get up blocks). With Health, Ragdoll on death does it when the health runs out.', target: 'play' },
    ],
  });
}
