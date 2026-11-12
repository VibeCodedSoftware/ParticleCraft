// Camera presets: an orthographic isometric view (2:1 for pixel-art tiles: 30° down; true isometric: 35.26°), or
// straight top-down, at 45° steps around. The camera looks at a target from `distance` away; a Follow behavior gets
// the same view as its offset (and looks at its target).

export type CameraPresetId = 'iso21' | 'iso' | 'topdown';
export const CAMERA_PRESETS: { id: CameraPresetId; label: string; pitch: number; doc: string }[] = [
  { id: 'iso21', label: 'Isometric 2:1 (pixel art)', pitch: 30, doc: '30° down, 45° around: tiles look like 2:1 diamonds, as in most isometric pixel-art games.' },
  { id: 'iso', label: 'Isometric (true)', pitch: (Math.atan(1 / Math.SQRT2) * 180) / Math.PI, doc: '35.26° down, 45° around: all three axes equally foreshortened.' },
  { id: 'topdown', label: 'Top-down', pitch: 90, doc: 'Straight down.' },
];

export interface CameraPose {
  /** Rotation (degrees, YXZ as the renderer). */
  rx: number; ry: number;
  /** Camera position relative to the target. */
  offset: [number, number, number];
}

/**
 * The pose of a preset seen from `distance`, turned `turn` quarter-turns (0..3) around the target (isometric views
 * look from a corner: 45°, 135°, 225°, 315°).
 */
export function cameraPose(id: CameraPresetId, distance: number, turn = 0): CameraPose {
  const p = CAMERA_PRESETS.find((x) => x.id === id)!;
  const pitch = Math.min(89.9, p.pitch) * (Math.PI / 180);
  const yawDeg = id === 'topdown' ? 90 * turn : 45 + 90 * turn;
  const yaw = (yawDeg * Math.PI) / 180;
  // The camera looks down −Z turned by ry: it sits behind that direction (+sin, +cos) and above the target.
  const h = Math.cos(pitch) * distance;
  const offset: [number, number, number] = [Math.sin(yaw) * h, Math.sin(pitch) * distance, Math.cos(yaw) * h];
  return { rx: -Math.min(89.9, p.pitch), ry: ((yawDeg % 360) + 360) % 360, offset };
}
