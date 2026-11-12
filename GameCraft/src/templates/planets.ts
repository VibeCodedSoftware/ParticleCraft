// Template: Mini Planets. A Surface Walker walks all the way round two little planets (Planet behavior: gravity toward
// their centres), rocks fall onto them, and a tower on the start pad can be walked up and over (Walk on walls).
import { Kit, LIB, animatedHuman, bh, makeProject } from './kit';

export function planetsTemplate() {
  const k = new Kit('Planets', '3d');
  k.scene.settings.background = '#0d1022';
  k.scene.settings.world = { color: '#8090b8', strength: 0.5, viewTransform: 'agx', exposure: 0 };
  const planet = (name: string, x: number, y: number, z: number, d: number, color: string, gravity: number) =>
    k.add('Planet', 'sphere', { name, x, y, z, sx: d, sy: d, sz: d, color, collider: { shape: 'sphere', size: [1, 1, 1], offset: [0, 0, 0] }, behaviors: [bh('solid'), bh('planet', { gravity, range: d })] }); // range = twice the radius
  // Start pad with a tower to walk up, over and down (no planet pulls here: normal gravity).
  k.box('Pad', 0, -0.5, 0, 14, 1, 14, '#3b4256');
  k.box('Tower', 3, 1.5, -3, 3, 3, 3, '#6b7a99');
  planet('Green', 0, 4, -22, 12, '#4f9a5b', 16);
  planet('Moon', 18, 10, -30, 7, '#a9a9b8', 9);
  // Stepping stones to the green planet (the last one inside its pull).
  k.box('Step', 0, 0.2, -8.5, 3, 0.4, 3, '#3b4256');
  k.box('Step', 0, 0.6, -12, 3, 0.4, 3, '#3b4256');
  for (const [x, z, c] of [[1, -16, '#e5484d'], [-2, -18, '#f5a524'], [3, -20, '#4c97ff']] as const)
    k.add('Rock', 'sphere', { name: 'Rock', x, y: 13, z, sx: 0.8, sy: 0.8, sz: 0.8, color: c, collider: { shape: 'sphere', size: [1, 1, 1], offset: [0, 0, 0] }, behaviors: [bh('physics', { mass: 1, bounce: 0.3 })] });
  k.model('Player', LIB.humanAnim, 0.95, { name: 'Player', x: 0, y: 0, z: 2, color: '#ffd166', mesh: animatedHuman(true), collider: { shape: 'box', size: [0.6, 1.83, 0.6], offset: [0, 0.915, 0] }, behaviors: [bh('surfacewalker', { walkOnWalls: true, maxSpeed: 5 })] });
  k.camera({ x: 0, y: 4, z: 9 }, { focalLength: 26 }, { target: 'Player', offsetY: 2.5, offsetZ: 6, smoothing: 0.85 });
  k.sun(3, -40, 30);
  k.text('Hint', 'WASD walk · Space jump · walk into the tower to climb it · head for the green planet and walk all the way round', 'bc', 0, 14, 15, '#ffffff');
  return makeProject({
    name: 'Mini Planets', template: 'planets', scenes: [k.scene], events: [], plane: 'xz', globals: [],
    tutorial: [
      { title: 'Spherical gravity', text: 'The planets have the Planet behavior: inside their range everything is pulled toward their centre. Walk onto the green one and keep going: you can walk all the way round.', target: 'play' },
      { title: 'Walk on walls', text: 'The player uses Surface Walker with Walk on walls: walk into the tower to climb it, over the top and down the other side.', target: 'inspector' },
    ],
  });
}
