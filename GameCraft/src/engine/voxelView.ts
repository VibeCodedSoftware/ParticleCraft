// Meshes a voxel terrain grid (Shared/src/runtime/voxel.ts) into one BufferGeometry: only faces between a
// solid cell and air are emitted, colored by material with a little per-cell variation and per-face shading so
// the blocks read like dirt, stone and grass. Rebuilt whenever the grid's version changes (digging/building).
import * as THREE from 'three';
import { VOXEL_COLORS, vidx, type VoxelData, type VoxelGrid } from '@shared/src/runtime/voxel';

// Face directions with their 4 corner offsets (counter-clockwise seen from outside) and light factor.
const FACES: { n: [number, number, number]; c: [number, number, number][]; shade: number }[] = [
  { n: [1, 0, 0], c: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]], shade: 0.82 },
  { n: [-1, 0, 0], c: [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0]], shade: 0.78 },
  { n: [0, 1, 0], c: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], shade: 1 },
  { n: [0, -1, 0], c: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], shade: 0.55 },
  { n: [0, 0, 1], c: [[1, 0, 1], [1, 1, 1], [0, 1, 1], [0, 0, 1]], shade: 0.88 },
  { n: [0, 0, -1], c: [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]], shade: 0.74 },
];

const MAT_NAMES: Record<number, keyof NonNullable<VoxelData['colors']>> = { 1: 'grass', 2: 'dirt', 3: 'stone', 4: 'gold', 5: 'bedrock', 6: 'sand' };

/** Geometry in the grid's local space relative to `pos` (the instance position). */
export function buildVoxelGeometry(g: VoxelGrid, pos: [number, number, number], colors: VoxelData['colors'] = {}): THREE.BufferGeometry {
  const palette = new Map<number, THREE.Color>();
  for (const k of Object.keys(VOXEL_COLORS)) {
    const m = Number(k);
    palette.set(m, new THREE.Color(colors?.[MAT_NAMES[m]] ?? VOXEL_COLORS[m]));
  }
  const P: number[] = [], N: number[] = [], C: number[] = [], I: number[] = [];
  const ox = g.origin[0] - pos[0], oy = g.origin[1] - pos[1], oz = g.origin[2] - pos[2];
  const solid = (x: number, y: number, z: number) => x >= 0 && y >= 0 && z >= 0 && x < g.nx && y < g.ny && z < g.nz && g.data[vidx(g, x, y, z)] !== 0;
  const col = new THREE.Color();
  for (let y = 0; y < g.ny; y++) for (let z = 0; z < g.nz; z++) for (let x = 0; x < g.nx; x++) {
    const m = g.data[vidx(g, x, y, z)];
    if (!m) continue;
    // Stable per-cell brightness jitter (texture-like variation without textures).
    const j = 0.9 + (((x * 73856093) ^ (y * 19349663) ^ (z * 83492791)) >>> 0) % 1000 / 5000;
    for (const f of FACES) {
      if (solid(x + f.n[0], y + f.n[1], z + f.n[2])) continue;
      // Grass only on top; its sides look like dirt with a green rim, like most voxel games.
      const base = m === 1 && f.n[1] !== 1 ? palette.get(2)! : palette.get(m) ?? palette.get(2)!;
      col.copy(base).multiplyScalar(f.shade * j);
      const start = P.length / 3;
      for (const c of f.c) {
        P.push(ox + (x + c[0]) * g.cell, oy + (y + c[1]) * g.cell, oz + (z + c[2]) * g.cell);
        N.push(f.n[0], f.n[1], f.n[2]);
        const rim = m === 1 && f.n[1] === 0 && c[1] === 1;
        C.push(rim ? palette.get(1)!.r * f.shade : col.r, rim ? palette.get(1)!.g * f.shade : col.g, rim ? palette.get(1)!.b * f.shade : col.b);
      }
      I.push(start, start + 1, start + 2, start, start + 2, start + 3);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
  geo.setIndex(P.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(I, 1) : new THREE.Uint16BufferAttribute(I, 1));
  geo.computeBoundingBox(); geo.computeBoundingSphere();
  return geo;
}
