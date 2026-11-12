// True height displacement for primitives (Material › Height as: Displacement): a subdivided copy of the primitive,
// built at the object's real size so the height map moves the surface by real metres on every face.
import * as THREE from 'three';
import type { InstanceData } from '@shared/src/runtime/scene';

/** The size a displaced primitive's geometry is built at (the object's scale, to the quarter metre). */
export function displacedSize(i: InstanceData): [number, number, number] {
  return [i.sx, i.sy, i.sz].map((s) => Math.max(0.25, Math.round(Math.abs(s) * 4) / 4)) as [number, number, number];
}

/**
 * The primitive subdivided to about 16 points per metre × detail on each side (capped at 256), or null when the
 * object doesn't displace or its kind has no dense version. The mesh undoes the object's scale (1 / displacedSize).
 */
export function displacedGeometry(i: InstanceData): THREE.BufferGeometry | null {
  const m = i.material;
  if (!m?.displace || !m.maps?.height?.asset) return null;
  const d = Math.max(0.25, Math.min(4, m.displaceDetail ?? 1));
  const [x, y, z] = displacedSize(i);
  const seg = (s: number) => Math.max(8, Math.min(256, Math.round(s * 16 * d)));
  const round = Math.max(16, Math.min(256, Math.round(24 * d * Math.max(x, z, 1))));
  let g: THREE.BufferGeometry;
  switch (i.kind) {
    case 'box': g = new THREE.BoxGeometry(x, y, z, seg(x), seg(y), seg(z)); break;
    case 'plane': g = new THREE.BoxGeometry(x, 0.02 * y, z, seg(x), 1, seg(z)); break;
    case 'sphere': g = new THREE.SphereGeometry(0.5, round, Math.round(round * 0.66)); g.scale(x, y, z); break;
    case 'cylinder': g = new THREE.CylinderGeometry(0.5, 0.5, 1, round, seg(y)); g.scale(x, y, z); break;
    default: return null;
  }
  return g;
}
