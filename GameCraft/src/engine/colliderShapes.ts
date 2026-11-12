// Collider outlines for the viewport (collider outlines, Collision View): the shape the collider stands for, not the
// boxes physics slices it into. Spheres, capsules, cylinders and cones as themselves, ramps as wedges, tilted objects
// rotated; compound colliders (imported rooms, tilemaps) as their boxes. World-space positions for line segments
// (pairs of points) and triangles.
import * as THREE from 'three';
import type { InstanceData } from '@shared/src/runtime/scene';
import type { World } from '@shared/src/runtime/world';

export interface ColliderOutline { lines: number[]; tris: number[] }

const BOX_EDGES = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
const BOX_FACES = [[0, 1, 2, 3], [5, 4, 7, 6], [4, 0, 3, 7], [1, 5, 6, 2], [3, 2, 6, 7], [4, 5, 1, 0]];

function pushBox(out: ColliderOutline, [x0, y0, z0, x1, y1, z1]: number[]) {
  const v = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
  for (const [a, b] of BOX_EDGES) out.lines.push(...v[a], ...v[b]);
  for (const f of BOX_FACES) out.tris.push(...v[f[0]], ...v[f[1]], ...v[f[2]], ...v[f[0]], ...v[f[2]], ...v[f[3]]);
}

/** A unit-ish local shape (centred, sized hx × hy × hz half-extents) as triangles and outline lines. */
function localShape(shape: string, hx: number, hy: number, hz: number): { geo: THREE.BufferGeometry; rings: THREE.Vector3[][] } {
  const rings: THREE.Vector3[][] = [];
  const ring = (rx: number, rz: number, y: number, axis: 'y' | 'x' | 'z' = 'y', n = 32) => {
    const pts: THREE.Vector3[] = [];
    for (let k = 0; k <= n; k++) {
      const a = (k / n) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
      pts.push(axis === 'y' ? new THREE.Vector3(c * rx, y, s * rz) : axis === 'x' ? new THREE.Vector3(y, c * rx, s * rz) : new THREE.Vector3(c * rx, s * rz, y));
    }
    rings.push(pts);
  };
  let geo: THREE.BufferGeometry;
  if (shape === 'sphere') {
    geo = new THREE.SphereGeometry(1, 20, 12); geo.scale(hx, hy, hz);
    ring(hx, hz, 0); ring(hy, hz, 0, 'x'); ring(hx, hy, 0, 'z');
  } else if (shape === 'capsule') {
    const r = Math.min(hx, hz), len = Math.max(0, hy * 2 - r * 2);
    geo = new THREE.CapsuleGeometry(r, len, 6, 20); geo.scale(hx / r, 1, hz / r);
    ring(hx, hz, len / 2); ring(hx, hz, -len / 2);
    // Side profile: two lines down the sides plus the rounded ends.
    const prof = (axis: 'x' | 'z') => { const pts: THREE.Vector3[] = []; const R = axis === 'x' ? hx : hz; for (let k = 0; k <= 40; k++) { const a = (k / 40) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a); const y = s * r + (s >= 0 ? len / 2 : -len / 2); pts.push(axis === 'x' ? new THREE.Vector3(c * R, y, 0) : new THREE.Vector3(0, y, c * R)); } rings.push(pts); };
    prof('x'); prof('z');
  } else if (shape === 'cylinder' || shape === 'cone') {
    geo = shape === 'cone' ? new THREE.ConeGeometry(1, 2, 24) : new THREE.CylinderGeometry(1, 1, 2, 24); geo.scale(hx, hy, hz);
    ring(hx, hz, -hy); if (shape === 'cylinder') ring(hx, hz, hy);
    for (const [x, z] of [[hx, 0], [-hx, 0], [0, hz], [0, -hz]]) rings.push([new THREE.Vector3(x, -hy, z), shape === 'cone' ? new THREE.Vector3(0, hy, 0) : new THREE.Vector3(x, hy, z)]);
  } else {
    geo = new THREE.BoxGeometry(hx * 2, hy * 2, hz * 2);
    const c = [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]].map(([a, b, d]) => new THREE.Vector3(a * hx, b * hy, d * hz));
    for (const [a, b] of BOX_EDGES) rings.push([c[a], c[b]]);
  }
  return { geo, rings };
}

function pushShape(out: ColliderOutline, s: { geo: THREE.BufferGeometry; rings: THREE.Vector3[][] }, m: THREE.Matrix4) {
  const g = (s.geo.index ? s.geo.toNonIndexed() : s.geo).applyMatrix4(m);
  out.tris.push(...(g.attributes.position.array as Float32Array));
  for (const r of s.rings) for (let k = 1; k < r.length; k++) { const a = r[k - 1].clone().applyMatrix4(m), b = r[k].clone().applyMatrix4(m); out.lines.push(a.x, a.y, a.z, b.x, b.y, b.z); }
  s.geo.dispose(); if (g !== s.geo) g.dispose();
}

/** The collider of `i` (as the world `w` sees it) as outline and faces, or null when it has none. */
export function colliderOutline(w: World, i: InstanceData): ColliderOutline | null {
  const c = i.collider;
  if (!c || c.shape === 'none' || i.voxel) return null;
  const out: ColliderOutline = { lines: [], tris: [] };
  // Compound colliders (imported rooms, generated model colliders, tilemaps): the boxes themselves.
  if (c.boxes?.length || i.kind === 'tilemap') { for (const b of w.aabbs(i).slice(0, 400)) pushBox(out, b); return out; }
  const [x, y, z] = i.parent != null ? w.worldPos(i) : [i.x, i.y, i.z];
  const hx = Math.abs(c.size[0] * i.sx) / 2, hy = Math.abs(c.size[1] * i.sy) / 2, hz = Math.abs(c.size[2] * i.sz) / 2;
  const off = new THREE.Vector3(c.offset[0] * i.sx, c.offset[1] * i.sy, c.offset[2] * i.sz);
  const xz = w.plane === 'xz';
  if (i.kind === 'ramp' && xz) {
    // The slope: full height at the front (local −Z), down to nothing at the back, turned by its heading.
    const v = [[-hx, -hy, -hz], [hx, -hy, -hz], [hx, -hy, hz], [-hx, -hy, hz], [-hx, hy, -hz], [hx, hy, -hz]].map(([a, b, d]) => new THREE.Vector3(a, b, d).add(off).applyAxisAngle(new THREE.Vector3(0, 1, 0), (i.ry * Math.PI) / 180).add(new THREE.Vector3(x, y, z)).toArray());
    for (const [a, b] of [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [0, 4], [1, 5], [4, 3], [5, 2]]) out.lines.push(...v[a], ...v[b]);
    for (const t of [[0, 1, 2], [0, 2, 3], [0, 4, 5], [0, 5, 1], [4, 3, 2], [4, 2, 5], [0, 3, 4], [1, 5, 2]]) for (const k of t) out.tris.push(...v[k]);
    return out;
  }
  const shape = c.shape === 'convex' || c.shape === 'mesh' ? 'box' : c.shape;
  // Tilted (non-moving) objects collide with their rotated shape; everything else stays upright.
  const q = w.oriented(i)
    ? new THREE.Quaternion().setFromEuler(new THREE.Euler((i.rx * Math.PI) / 180, (i.ry * Math.PI) / 180, (i.rz * Math.PI) / 180, 'YXZ'))
    : new THREE.Quaternion();
  const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z).add(off.clone().applyQuaternion(q)), q, new THREE.Vector3(1, 1, 1));
  pushShape(out, localShape(shape, hx, hy, hz), m);
  return out;
}
