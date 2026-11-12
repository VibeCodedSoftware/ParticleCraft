// Applying a camera view preset to a camera object (editor and the Set camera view block): orthographic, the preset's
// rotation, and its offset from what it looks at — the Follow behavior's target, or the point on the ground it was
// aiming at.
import { cameraPose, type CameraPresetId } from './cameraPresets';
import { DEFAULT_CAMERA, type InstanceData } from './runtime/scene';

/** Where a camera's view meets the ground (y = 0), or the point 20 m ahead. */
function aimPoint(c: InstanceData): [number, number, number] {
  const rx = (c.rx * Math.PI) / 180, ry = (c.ry * Math.PI) / 180;
  const f = [-Math.sin(ry) * Math.cos(rx), Math.sin(rx), -Math.cos(ry) * Math.cos(rx)];
  const t = f[1] < -0.05 ? -c.y / f[1] : 20;
  return [c.x + f[0] * t, c.y + f[1] * t, c.z + f[2] * t];
}

/** Put a camera into a view preset (turn = quarter-turns around). Returns the distance used. */
export function applyCameraView(c: InstanceData, id: CameraPresetId, turn: number): number {
  const follow = c.behaviors.find((b) => b.type === 'follow');
  const cam = c.camera ?? { ...DEFAULT_CAMERA };
  const t = ((Math.round(turn) % 4) + 4) % 4;
  let dist: number;
  if (follow) {
    const p = follow.props;
    dist = Math.hypot(Number(p.offsetX) || 0, Number(p.offsetY) || 0, Number(p.offsetZ) || 0) || 16;
    const pose = cameraPose(id, dist, t);
    Object.assign(p, { offsetX: round(pose.offset[0]), offsetY: round(pose.offset[1]), offsetZ: round(pose.offset[2]), lookAt: true, rotateWithTarget: false, orbitWithMouse: false, firstPerson: false });
    c.rx = pose.rx; c.ry = pose.ry; c.rz = 0;
  } else {
    const target = aimPoint(c);
    dist = Math.hypot(c.x - target[0], c.y - target[1], c.z - target[2]) || 20;
    const pose = cameraPose(id, dist, t);
    c.x = round(target[0] + pose.offset[0]); c.y = round(target[1] + pose.offset[1]); c.z = round(target[2] + pose.offset[2]);
    c.rx = pose.rx; c.ry = pose.ry; c.rz = 0;
  }
  c.camera = { ...cam, type: 'orthographic', orthoScale: cam.type === 'orthographic' ? cam.orthoScale : 14, preset: { id, turn: t } };
  return dist;
}

const round = (n: number) => Math.round(n * 1000) / 1000;
