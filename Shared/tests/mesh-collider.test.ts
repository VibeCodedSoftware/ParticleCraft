import { describe, expect, it } from 'vitest';
import { generateMeshCollider } from '../src/runtime/meshCollider';

/** Triangles of an axis-aligned box (12 triangles). */
function boxTris(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, skipTop = false): number[] {
  const v = (x: number, y: number, z: number) => [x ? x1 : x0, y ? y1 : y0, z ? z1 : z0];
  const quad = (a: number[], b: number[], c: number[], d: number[]) => [...a, ...b, ...c, ...a, ...c, ...d];
  return [
    ...quad(v(0, 0, 0), v(1, 0, 0), v(1, 0, 1), v(0, 0, 1)),
    ...(skipTop ? [] : quad(v(0, 1, 0), v(1, 1, 0), v(1, 1, 1), v(0, 1, 1))),
    ...quad(v(0, 0, 0), v(1, 0, 0), v(1, 1, 0), v(0, 1, 0)),
    ...quad(v(0, 0, 1), v(1, 0, 1), v(1, 1, 1), v(0, 1, 1)),
    ...quad(v(0, 0, 0), v(0, 0, 1), v(0, 1, 1), v(0, 1, 0)),
    ...quad(v(1, 0, 0), v(1, 0, 1), v(1, 1, 1), v(1, 1, 0)),
  ];
}

describe('mesh collider generator', () => {
  it('a closed box becomes one solid box (convex)', () => {
    const r = generateMeshCollider(boxTris(-1, 0, -1, 1, 2, 1), { mode: 'convex', resolution: 8 });
    expect(r.triangles).toBe(12);
    expect(r.boxes.length).toBe(1);
    const [cx, cy, cz, sx, sy, sz] = r.boxes[0];
    expect([cx, cy, cz]).toEqual([0, 1, 0]);
    expect([sx, sy, sz]).toEqual([2, 2, 2]);
  });

  it('an open-top room keeps its inside free (concave), but convex fills it', () => {
    const room = boxTris(-4, 0, -4, 4, 3, 4, true);
    const concave = generateMeshCollider(room, { mode: 'mesh', resolution: 16 });
    const inside = (b: number[]) => Math.abs(b[0]) + b[3] / 2 > 0 && Math.abs(b[0]) - b[3] / 2 < 1 && Math.abs(b[2]) - b[5] / 2 < 1 && b[1] + b[4] / 2 > 1.5;
    // No box covers the middle of the room at head height.
    expect(concave.boxes.some((b) => Math.abs(b[0]) <= b[3] / 2 && Math.abs(b[2]) <= b[5] / 2 && Math.abs(b[1] - 1.5) <= b[4] / 2)).toBe(false);
    expect(concave.boxes.length).toBeGreaterThan(1);
    const convex = generateMeshCollider(room, { mode: 'convex', resolution: 16 });
    expect(convex.boxes.some(inside)).toBe(true);
  });

  it('lowers detail to respect maxBoxes and warns', () => {
    const many: number[] = [];
    for (let i = 0; i < 12; i++) many.push(...boxTris(i * 2, 0, 0, i * 2 + 1, (i % 3) + 1, 1));
    const full = generateMeshCollider(many, { mode: 'mesh', resolution: 48, maxBoxes: 999 });
    const r = generateMeshCollider(many, { mode: 'mesh', resolution: 48, maxBoxes: 6 });
    expect(r.resolution).toBeLessThan(48);
    expect(r.boxes.length).toBeLessThanOrEqual(full.boxes.length);
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('empty input warns', () => {
    expect(generateMeshCollider([], { mode: 'convex' }).warnings[0]).toMatch(/no triangles/);
  });
});
