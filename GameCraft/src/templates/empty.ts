import { DEFAULT_CAMERA } from '@shared/src/runtime/scene';
import { B, E, Kit, makeProject } from './kit';

export function emptyProject(mode: '2d' | '3d') {
  const k = new Kit('Scene 1', mode);
  if (mode === '3d') {
    k.box('Ground', 0, -0.5, 0, 30, 1, 30, '#7a8696');
    k.add('Cube', 'box', { y: 0.5, color: '#a78bfa' });
    k.sun(3);
    k.camera({ x: 7, y: 5, z: 9, rx: -25, ry: 38 });
  } else {
    k.add('Ground', 'box', { y: -1, sx: 20, sy: 1, color: '#4caf50', behaviors: [{ type: 'solid', props: { enabled: true } }] });
    k.camera({ z: 20 }, { ...DEFAULT_CAMERA, type: 'orthographic', orthoScale: 20, postfx: [] });
  }
  return makeProject({
    name: mode === '3d' ? 'New 3D game' : 'New 2D game', template: 'empty' + mode, scenes: [k.scene], plane: mode === '3d' ? 'xz' : 'xy',
    events: [E([B('system.on_start_of_layout')], [B('system.log', { message: '"Hello from GameCraft!"' })])], globals: [],
    tutorial: [
      { title: 'Add objects', text: 'Press Shift+A in the viewport (or drag from the Asset browser) to add objects.', target: 'viewport' },
      { title: 'Move them', text: 'Blender keys: G move, R rotate, S scale, then X/Y/Z to lock an axis. Click to confirm, right-click or Esc to cancel.', target: 'viewport' },
      { title: 'Add logic', text: 'In the Event sheet click "+ Add event", pick System › On start of scene, then add an action.', target: 'eventsheet' },
    ],
  });
}
