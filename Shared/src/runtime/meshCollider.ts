// Collision boxes from a model's triangles. The physics solver works with boxes, so a model's shape becomes a
// compound of boxes: the triangles are voxelized, the inside is filled, and the solid cells are merged greedily
// into as few boxes as possible.
//   convex  - the filled volume between the surfaces along every axis (closed, no holes; good for rocks, crates,
//             props and anything that moves).
//   mesh    - the real (concave) shape: surface cells plus whatever is enclosed, so rooms, arches and stairs keep
//             their openings (best for static level geometry).

export type MeshColliderMode = 'convex' | 'mesh';

export interface MeshColliderOptions {
  mode: MeshColliderMode;
  /** Cells along the longest side (detail). Default 16 for convex, 24 for mesh. */
  resolution?: number;
  /** Above this many boxes the detail is reduced automatically. Default 64. */
  maxBoxes?: number;
}

export interface MeshColliderResult {
  /** [cx, cy, cz, sx, sy, sz] in the same local units as the input positions. */
  boxes: number[][];
  triangles: number;
  resolution: number;
  warnings: string[];
}

/**
 * positions: flat xyz triangle soup (every 9 numbers = one triangle), in the object's local space before scale.
 */
export function generateMeshCollider(positions: ArrayLike<number>, opts: MeshColliderOptions): MeshColliderResult {
  const warnings: string[] = [];
  const triangles = Math.floor(positions.length / 9);
  if (!triangles) return { boxes: [], triangles: 0, resolution: 0, warnings: ['The model has no triangles; nothing to collide with.'] };
  if (triangles > 200_000) warnings.push(`Large model (${triangles.toLocaleString()} triangles): generation may take a few seconds.`);
  const maxBoxes = opts.maxBoxes ?? 64;
  let res = Math.max(2, Math.min(96, Math.round(opts.resolution ?? (opts.mode === 'convex' ? 16 : 24))));
  for (let attempt = 0; ; attempt++) {
    const boxes = build(positions, triangles, opts.mode, res);
    if (boxes.length <= maxBoxes || res <= 4 || attempt > 6) {
      if (boxes.length > maxBoxes) warnings.push(`${boxes.length} boxes even at low detail - collisions with this model cost more. Consider a simpler shape.`);
      else if (attempt > 0) warnings.push(`Detail lowered to ${res} so the collider fits in ${maxBoxes} boxes.`);
      return { boxes, triangles, resolution: res, warnings };
    }
    res = Math.max(4, Math.floor(res * 0.75));
  }
}

function build(p: ArrayLike<number>, tris: number, mode: MeshColliderMode, res: number): number[][] {
  let mnx = Infinity, mny = Infinity, mnz = Infinity, mxx = -Infinity, mxy = -Infinity, mxz = -Infinity;
  for (let i = 0; i < tris * 9; i += 3) {
    const x = p[i], y = p[i + 1], z = p[i + 2];
    if (x < mnx) mnx = x; if (x > mxx) mxx = x; if (y < mny) mny = y; if (y > mxy) mxy = y; if (z < mnz) mnz = z; if (z > mxz) mxz = z;
  }
  const longest = Math.max(mxx - mnx, mxy - mny, mxz - mnz) || 1;
  const cell = longest / res;
  // Flat parts (a floor plane) still get one cell of thickness.
  const nx = Math.max(1, Math.ceil((mxx - mnx) / cell - 1e-6)), ny = Math.max(1, Math.ceil((mxy - mny) / cell - 1e-6)), nz = Math.max(1, Math.ceil((mxz - mnz) / cell - 1e-6));
  const ox = (mnx + mxx) / 2 - (nx * cell) / 2, oy = (mny + mxy) / 2 - (ny * cell) / 2, oz = (mnz + mxz) / 2 - (nz * cell) / 2;
  const idx = (x: number, y: number, z: number) => x + nx * (y + ny * z);
  const surf = new Uint8Array(nx * ny * nz);
  const mark = (x: number, y: number, z: number) => {
    const cx = Math.min(nx - 1, Math.max(0, Math.floor((x - ox) / cell)));
    const cy = Math.min(ny - 1, Math.max(0, Math.floor((y - oy) / cell)));
    const cz = Math.min(nz - 1, Math.max(0, Math.floor((z - oz) / cell)));
    surf[idx(cx, cy, cz)] = 1;
  };
  // Surface: sample each triangle densely enough that no cell it crosses is skipped.
  for (let t = 0; t < tris; t++) {
    const i = t * 9;
    const ax = p[i], ay = p[i + 1], az = p[i + 2], bx = p[i + 3], by = p[i + 4], bz = p[i + 5], cx = p[i + 6], cy = p[i + 7], cz = p[i + 8];
    const e = Math.max(Math.hypot(bx - ax, by - ay, bz - az), Math.hypot(cx - ax, cy - ay, cz - az), Math.hypot(cx - bx, cy - by, cz - bz));
    const n = Math.min(256, Math.max(1, Math.ceil((e / cell) * 2)));
    for (let u = 0; u <= n; u++) for (let v = 0; v <= n - u; v++) {
      const a = u / n, b = v / n, c = 1 - a - b;
      mark(ax * c + bx * a + cx * b, ay * c + by * a + cy * b, az * c + bz * a + cz * b);
    }
  }
  const solid = new Uint8Array(surf.length);
  if (mode === 'convex') {
    // Inside = within the vertices' extent along 13 directions (axes, face and corner diagonals): a 26-sided hull.
    const lo = DIRS.map(() => Infinity), hi = DIRS.map(() => -Infinity);
    for (let i = 0; i < tris * 9; i += 3) DIRS.forEach(([dx, dy, dz], d) => { const s = p[i] * dx + p[i + 1] * dy + p[i + 2] * dz; if (s < lo[d]) lo[d] = s; if (s > hi[d]) hi[d] = s; });
    const eps = cell * 0.25;
    for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
      const k = idx(x, y, z);
      if (surf[k]) { solid[k] = 1; continue; }
      const px = ox + (x + 0.5) * cell, py = oy + (y + 0.5) * cell, pz = oz + (z + 0.5) * cell;
      solid[k] = DIRS.every(([dx, dy, dz], d) => { const s = px * dx + py * dy + pz * dz; return s >= lo[d] - eps && s <= hi[d] + eps; }) ? 1 : 0;
    }
  } else {
    // Concave: flood the outside from the border; every cell the flood cannot reach is wall or enclosed.
    const out = new Uint8Array(surf.length);
    const stack: number[] = [];
    const push = (x: number, y: number, z: number) => { const k = idx(x, y, z); if (!surf[k] && !out[k]) { out[k] = 1; stack.push(k); } };
    for (let x = 0; x < nx; x++) for (let y = 0; y < ny; y++) { push(x, y, 0); push(x, y, nz - 1); }
    for (let x = 0; x < nx; x++) for (let z = 0; z < nz; z++) { push(x, 0, z); push(x, ny - 1, z); }
    for (let y = 0; y < ny; y++) for (let z = 0; z < nz; z++) { push(0, y, z); push(nx - 1, y, z); }
    while (stack.length) {
      const k = stack.pop()!;
      const x = k % nx, y = Math.floor(k / nx) % ny, z = Math.floor(k / (nx * ny));
      if (x > 0) push(x - 1, y, z); if (x < nx - 1) push(x + 1, y, z);
      if (y > 0) push(x, y - 1, z); if (y < ny - 1) push(x, y + 1, z);
      if (z > 0) push(x, y, z - 1); if (z < nz - 1) push(x, y, z + 1);
    }
    for (let k = 0; k < solid.length; k++) solid[k] = out[k] ? 0 : 1;
  }
  return greedyBoxes(solid, nx, ny, nz).map(([x0, y0, z0, x1, y1, z1]) => [
    r(ox + ((x0 + x1) / 2) * cell), r(oy + ((y0 + y1) / 2) * cell), r(oz + ((z0 + z1) / 2) * cell),
    r((x1 - x0) * cell), r((y1 - y0) * cell), r((z1 - z0) * cell),
  ]);
}

/** Merge solid cells into boxes [x0,y0,z0,x1,y1,z1] (cell units, exclusive end): grow along x, then y, then z. */
export function greedyBoxes(solid: Uint8Array, nx: number, ny: number, nz: number): number[][] {
  const used = new Uint8Array(solid.length);
  const idx = (x: number, y: number, z: number) => x + nx * (y + ny * z);
  const free = (x: number, y: number, z: number) => solid[idx(x, y, z)] && !used[idx(x, y, z)];
  const out: number[][] = [];
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    if (!free(x, y, z)) continue;
    let x1 = x + 1; while (x1 < nx && free(x1, y, z)) x1++;
    let y1 = y + 1;
    grow: while (y1 < ny) { for (let a = x; a < x1; a++) if (!free(a, y1, z)) break grow; y1++; }
    let z1 = z + 1;
    growz: while (z1 < nz) { for (let b = y; b < y1; b++) for (let a = x; a < x1; a++) if (!free(a, b, z1)) break growz; z1++; }
    for (let c = z; c < z1; c++) for (let b = y; b < y1; b++) for (let a = x; a < x1; a++) used[idx(a, b, c)] = 1;
    out.push([x, y, z, x1, y1, z1]);
  }
  return out;
}

const r = (n: number) => Math.round(n * 1000) / 1000;
const DIRS: [number, number, number][] = [[1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 1, 0], [1, -1, 0], [1, 0, 1], [1, 0, -1], [0, 1, 1], [0, 1, -1], [1, 1, 1], [1, 1, -1], [1, -1, 1], [1, -1, -1]]
  .map(([x, y, z]) => { const l = Math.hypot(x, y, z); return [x / l, y / l, z / l]; });
