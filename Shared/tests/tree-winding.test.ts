// Tree wood faces outward: with its triangles wound the wrong way the outside is culled and you see into the tree.
import { describe, expect, it } from 'vitest';
import { generateRock, generateTree, ROCK_PRESETS, TREE_PRESETS, type MeshData } from '../src/world/generators';

/** Share of triangles whose winding disagrees with their vertex normals. */
function backward(m: MeshData) {
  let bad = 0; const tris = m.indices.length / 3;
  for (let t = 0; t < tris; t++) {
    const [a, b, c] = [m.indices[t * 3], m.indices[t * 3 + 1], m.indices[t * 3 + 2]];
    const P = (i: number) => [m.positions[i * 3], m.positions[i * 3 + 1], m.positions[i * 3 + 2]];
    const [pa, pb, pc] = [P(a), P(b), P(c)];
    const u = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]], w = [pc[0] - pa[0], pc[1] - pa[1], pc[2] - pa[2]];
    const f = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    const n = [0, 1, 2].map((k) => m.normals[a * 3 + k] + m.normals[b * 3 + k] + m.normals[c * 3 + k]);
    if (f[0] * n[0] + f[1] * n[1] + f[2] * n[2] < 0) bad++;
  }
  return bad / Math.max(1, tris);
}

describe('Tree wood faces outward', () => {
  for (const preset of TREE_PRESETS) it(preset.name, () => {
    const t = generateTree(preset.cfg, 7);
    expect(t.wood.indices.length).toBeGreaterThan(0);
    expect(backward(t.wood)).toBeLessThan(0.01);
  });
  it('rocks still do too', () => {
    expect(backward(generateRock(ROCK_PRESETS[1].cfg, 7))).toBeLessThan(0.02);
  });
});
