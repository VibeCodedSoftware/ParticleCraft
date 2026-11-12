// Ready-made keyframe animations (Animation tab › Presets). Character presets only use rotation and scale tracks
// (keyframe values are offsets added to the object's own value every frame, so position tracks would pin a moving
// character in place); each has a movement role so it plays by itself while the character idles, walks, jumps...
// Motion presets (float, shake, fade...) are played with "Play animation".
import type { AnimationClip } from './runtime/scene';

export interface AnimPreset { name: string; group: 'Character' | 'Motion'; role?: string; doc: string; clip: Omit<AnimationClip, 'name'> }

type K = [number, number];
const tr = (property: string, keys: K[], ease = 'easeInOut') => ({ property, keys: keys.map(([t, v]) => ({ t, v, ease })) });

export const ANIM_PRESETS: AnimPreset[] = [
  { name: 'Idle breathe', group: 'Character', role: 'idle', doc: 'A slow breath while standing still.', clip: { duration: 2, loop: true, tracks: [tr('ScaleY', [[0, 0], [1, 0.035], [2, 0]]), tr('ScaleX', [[0, 0], [1, -0.015], [2, 0]])] } },
  { name: 'Walk waddle', group: 'Character', role: 'walk', doc: 'Side-to-side rocking with a small bounce in each step.', clip: { duration: 0.6, loop: true, tracks: [tr('RotZ', [[0, 0], [0.15, 6], [0.3, 0], [0.45, -6], [0.6, 0]]), tr('ScaleY', [[0, 0], [0.15, -0.04], [0.3, 0], [0.45, -0.04], [0.6, 0]])] } },
  { name: 'Run lean', group: 'Character', role: 'run', doc: 'Quicker, stronger rocking for running.', clip: { duration: 0.4, loop: true, tracks: [tr('RotZ', [[0, 0], [0.1, 9], [0.2, 0], [0.3, -9], [0.4, 0]]), tr('ScaleY', [[0, 0], [0.1, -0.06], [0.2, 0.02], [0.3, -0.06], [0.4, 0]])] } },
  { name: 'Hop squash', group: 'Character', role: 'jump', doc: 'Squash before the jump, stretch in the air.', clip: { duration: 0.45, loop: false, tracks: [tr('ScaleY', [[0, 0], [0.08, -0.2], [0.22, 0.15], [0.45, 0]]), tr('ScaleX', [[0, 0], [0.08, 0.15], [0.22, -0.08], [0.45, 0]])] } },
  { name: 'Fall stretch', group: 'Character', role: 'fall', doc: 'Stretched tall while falling.', clip: { duration: 0.3, loop: true, tracks: [tr('ScaleY', [[0, 0.08], [0.3, 0.08]]), tr('ScaleX', [[0, -0.05], [0.3, -0.05]])] } },
  { name: 'Swim paddle', group: 'Character', role: 'swim', doc: 'Slow tilting while swimming.', clip: { duration: 1.2, loop: true, tracks: [tr('RotZ', [[0, -10], [0.6, 10], [1.2, -10]])] } },
  { name: 'Attack lunge', group: 'Character', role: 'attack', doc: 'A quick forward thrust.', clip: { duration: 0.35, loop: false, tracks: [tr('ScaleX', [[0, 0], [0.1, 0.25], [0.35, 0]], 'easeOut'), tr('RotZ', [[0, 0], [0.1, -12], [0.35, 0]])] } },
  { name: 'Hurt flinch', group: 'Character', role: 'hit', doc: 'Recoils when damaged.', clip: { duration: 0.3, loop: false, tracks: [tr('RotZ', [[0, 0], [0.08, 15], [0.18, -8], [0.3, 0]]), tr('ScaleY', [[0, 0], [0.08, -0.1], [0.3, 0]])] } },
  { name: 'Death topple', group: 'Character', role: 'death', doc: 'Falls over and flattens.', clip: { duration: 0.8, loop: false, tracks: [tr('RotZ', [[0, 0], [0.8, 90]], 'easeIn'), tr('ScaleY', [[0, 0], [0.8, -0.2]])] } },
  { name: 'Celebrate spin', group: 'Character', doc: 'A happy spin (play it on a win).', clip: { duration: 0.8, loop: false, tracks: [tr('RotY', [[0, 0], [0.8, 360]]), tr('ScaleY', [[0, 0], [0.4, 0.12], [0.8, 0]])] } },
  { name: 'Nod', group: 'Character', doc: 'Two small nods (yes / greeting).', clip: { duration: 0.8, loop: false, tracks: [tr('RotX', [[0, 0], [0.2, 14], [0.4, 0], [0.6, 14], [0.8, 0]])] } },
  { name: 'Float', group: 'Motion', doc: 'Gentle up-and-down hovering (pickups, ghosts).', clip: { duration: 2, loop: true, tracks: [tr('Y', [[0, 0], [1, 0.25], [2, 0]])] } },
  { name: 'Pulse', group: 'Motion', doc: 'Grows and shrinks (attention, heartbeats).', clip: { duration: 0.8, loop: true, tracks: [tr('ScaleX', [[0, 0], [0.4, 0.12], [0.8, 0]]), tr('ScaleY', [[0, 0], [0.4, 0.12], [0.8, 0]]), tr('ScaleZ', [[0, 0], [0.4, 0.12], [0.8, 0]])] } },
  { name: 'Spin', group: 'Motion', doc: 'One full turn per second.', clip: { duration: 1, loop: true, tracks: [tr('RotY', [[0, 0], [1, 360]], 'linear')] } },
  { name: 'Shake', group: 'Motion', doc: 'A short rattle (locked doors, impacts).', clip: { duration: 0.4, loop: false, tracks: [tr('X', [[0, 0], [0.05, 0.08], [0.1, -0.08], [0.15, 0.06], [0.2, -0.06], [0.3, 0.03], [0.4, 0]], 'linear')] } },
  { name: 'Pop in', group: 'Motion', doc: 'Appears with a springy grow.', clip: { duration: 0.4, loop: false, tracks: ['ScaleX', 'ScaleY', 'ScaleZ'].map((p) => tr(p, [[0, -0.95], [0.25, 0.12], [0.4, 0]], 'easeOut')) } },
  { name: 'Fade out', group: 'Motion', doc: 'Fades to invisible.', clip: { duration: 0.8, loop: false, tracks: [tr('Opacity', [[0, 0], [0.8, -100]], 'linear')] } },
];
