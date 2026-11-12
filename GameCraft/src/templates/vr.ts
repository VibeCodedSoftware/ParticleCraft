// Template: Empty VR Project. A room to stand in, a VR Player rig (teleport, smooth move, snap turn, grabbing), some
// objects to pick up and throw, and the VR actions. Plays in a headset through WebXR (Meta Quest browser, SteamVR in
// Chrome / Edge) via Enter VR, or in the desktop VR preview (mouse look, WASD, ← / →, hold T to teleport, E to grab).
import { VR_ACTIONS } from '@shared/src/runtime/input';
import { DEFAULT_VR } from '@shared/src/vr';
import { B, E, Kit, bh, makeProject } from './kit';

export function vrTemplate() {
  const k = new Kit('VR Room', '3d');
  k.scene.settings.background = '#1d2230';
  k.scene.settings.world = { color: '#a8b4c8', strength: 0.6, viewTransform: 'agx', exposure: 0 };
  k.box('Floor', 0, -0.5, 0, 30, 1, 30, '#5a6272');
  for (const [x, z, sx, sz] of [[0, -15, 30, 1], [0, 15, 30, 1], [-15, 0, 1, 30], [15, 0, 1, 30]] as const) k.box('Wall', x, 1.5, z, sx, 3, sz, '#3e4554');
  // Tables at hand height with things to grab.
  k.box('Table', 0, 0.45, -1.4, 1.6, 0.9, 0.8, '#8a6a46');
  k.box('Table', 2.6, 0.45, 0.5, 0.8, 0.9, 1.6, '#8a6a46');
  const prop = (name: string, kind: 'box' | 'sphere', x: number, y: number, z: number, s: number, color: string, mass = 0.5) =>
    k.add('Grabbable', kind, { name, x, y, z, sx: s, sy: s, sz: s, color, behaviors: [bh('physics', { mass, friction: 0.6, bounce: 0.25 })] });
  prop('Cube', 'box', -0.4, 1.0, -1.4, 0.18, '#e5484d');
  prop('Cube', 'box', 0.0, 1.0, -1.4, 0.18, '#4c97ff');
  prop('Ball', 'sphere', 0.45, 1.0, -1.4, 0.2, '#f5a524', 0.3);
  prop('Crate', 'box', 2.6, 1.05, 0.5, 0.3, '#b07a3c', 1.2);
  // Teleport targets further away.
  k.box('Platform', -6, 0.15, -6, 3, 0.3, 3, '#6b8f71');
  k.box('Platform', 6, 0.15, -8, 3, 0.3, 3, '#6b8f71');
  // The player: the VR rig stands here; in the preview the camera is its eyes.
  k.add('Player', 'box', { name: 'Player', x: 0, y: 0.05, z: 1.2, ry: 90, visible: false, color: '#ffffff', collider: { shape: 'box', size: [0.4, 1.7, 0.4], offset: [0, 0.85, 0] }, behaviors: [bh('vrplayer')] });
  k.camera({ x: 0, y: 1.6, z: 1.2 }, { focalLength: 22, clipStart: 0.03, clipEnd: 200 }, { target: 'Player', firstPerson: true, eyeHeight: 1.6, sensitivity: 0.22, lookAt: false });
  k.sun(2.4, -55, 35, { y: 20 });
  k.point('Lamp', 0, 2.8, 0, 900, '#fff1d6');
  k.text('Hint', 'Grab with the grip (E) · teleport with the right stick (hold T) · move with the left stick (WASD)', 'bc', 0, 14, 15, '#ffffff');
  const events = [
    E([B('vr.on_grabbed', {}, 'Player')], [B('audio.play', { sound: 'pickup', volume: '40' })]),
    E([B('vr.on_teleported', {}, 'Player')], [B('audio.play', { sound: 'click', volume: '30' })]),
    E([B('object.compare_property', { property: 'Y', op: '<', value: '-5' }, 'Grabbable')], [B('object.respawn', { x: '0', y: '1.2', z: '-1.4' }, 'Grabbable')]),
  ];
  const p = makeProject({
    name: 'Empty VR Project', template: 'vr', scenes: [k.scene], events, plane: 'xz', globals: [],
    tutorial: [
      { title: 'Try it without a headset', text: 'Play: the VR preview uses the mouse to look, WASD to move, ← / → to turn, hold T to aim a teleport, E to grab.', target: 'play' },
      { title: 'In a headset', text: 'Export for Web and open it in the Meta Quest browser (or Chrome / Edge with SteamVR running), then press Enter VR.', target: 'play' },
      { title: 'VR settings', text: 'Edit › Preferences › VR: Quest or PC VR profile, standing or seated, comfort vignette. The VR Player behavior sets teleport / smooth movement and snap turning.', target: 'inspector' },
    ],
  });
  p.logic.inputActions = { ...VR_ACTIONS };
  p.settings.vr = { ...DEFAULT_VR, enabled: true };
  return p;
}
