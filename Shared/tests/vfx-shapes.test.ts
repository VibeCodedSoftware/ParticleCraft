// Shape nodes: primitive geometry, sampling (surface / volume / edges), and effects that emit from and cling to them.
import { describe, expect, it } from 'vitest';
import { newShape, normalizeMesh, sampleShape, shapeTriangles, SHAPE_KINDS } from '../src/vfx/shapes';
import { compileGraph, finalizeAsset, newAsset, newBlock, newSystem } from '../src/vfx/vfx';
import { Emitter } from '../src/runtime/particles';

const pts = (a: number[]) => { const out: number[][] = []; for (let i = 0; i < a.length; i += 6) out.push(a.slice(i, i + 6)); return out; };

describe('shape nodes', () => {
  it('every primitive has outward-facing triangles', () => {
    for (const { kind } of SHAPE_KINDS) {
      if (kind === 'plane') continue;
      const s = { ...newShape(kind, 's'), position: [0, 0, 0] as [number, number, number] };
      const t = shapeTriangles(s);
      expect(t.length).toBeGreaterThan(9);
      let out = 0, n = 0;
      for (const [x, y, z, nx, ny, nz] of pts(sampleShape(s, 'surface', 300, 3))) {
        // Away from the centre (torus: from the ring's middle circle).
        let cx = 0, cz = 0;
        if (kind === 'torus') { const a = Math.atan2(z, x); cx = Math.cos(a) * s.radius; cz = Math.sin(a) * s.radius; }
        if ((x - cx) * nx + y * ny + (z - cz) * nz > 0) out++;
        n++;
      }
      expect(out / n, kind).toBeGreaterThan(0.97);
    }
  });
  it('surface points lie on the shape, volume points inside it, edge points on the edges', () => {
    const sph = { ...newShape('sphere', 's'), position: [0, 0, 0] as [number, number, number], radius: 1 };
    for (const [x, y, z] of pts(sampleShape(sph, 'surface', 200, 1))) expect(Math.hypot(x, y, z)).toBeGreaterThan(0.95);
    for (const [x, y, z] of pts(sampleShape(sph, 'volume', 200, 1))) expect(Math.hypot(x, y, z)).toBeLessThan(1.001);
    const cube = { ...newShape('cube', 'c'), position: [0, 0, 0] as [number, number, number] };
    const edges = pts(sampleShape(cube, 'edges', 300, 2));
    for (const [x, y, z] of edges) expect([x, y, z].filter((v) => Math.abs(Math.abs(v) - 0.5) < 1e-3).length).toBeGreaterThanOrEqual(2); // on 2 faces = an edge
  });
  it('size, scale, rotation and position move the samples', () => {
    const s = { ...newShape('cube', 'c'), width: 2, scale: 2, position: [5, 1, 0] as [number, number, number], rotation: [0, 90, 0] as [number, number, number] };
    const p = pts(sampleShape(s, 'surface', 400, 4));
    const xs = p.map((q) => q[0]), zs = p.map((q) => q[2]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(2, 1); // depth 1 × scale 2, turned onto X
    expect(Math.max(...zs) - Math.min(...zs)).toBeCloseTo(4, 1); // width 2 × scale 2, turned onto Z
    expect((Math.max(...xs) + Math.min(...xs)) / 2).toBeCloseTo(5, 1);
  });
  it('an imported object is centred and scaled to fit', () => {
    const m = normalizeMesh([10, 0, 0, 20, 0, 0, 10, 10, 0], 2);
    expect(Math.max(...m.filter((_, i) => i % 3 === 0))).toBeCloseTo(1); expect(Math.min(...m.filter((_, i) => i % 3 === 1))).toBeCloseTo(-1);
  });
  it('a system connected to a shape emits on it and clings to it; hidden shapes stay out of the export', () => {
    const shape = { ...newShape('sphere', 'shp'), position: [0, 0, 0] as [number, number, number], radius: 1 };
    const sys = newSystem('Fire', 0, 0, { spawn: [newBlock('rate', { rate: 300 })], init: [newBlock('lifetime', { min: 2, max: 2 }), newBlock('shapeEmit', { from: 'surface', outward: 0.5, points: 256 })], update: [newBlock('cling', { strength: 1 })] });
    sys.source = shape.id;
    const g = { systems: [sys], params: [], shapes: [shape] };
    const c = compileGraph(g);
    expect(c.warnings).toEqual([]);
    expect(c.layers[0].params.shape).toBe('mesh');
    expect(c.layers[0].params.meshPoints!.length).toBe(256 * 6);
    const e = new Emitter('t', c.layers[0].params);
    for (let k = 0; k < 120; k++) e.update(1 / 60);
    let near = 0;
    for (let i = 0; i < e.count; i++) if (Math.abs(Math.hypot(e.px[i], e.py[i], e.pz[i]) - 1) < 0.25) near++;
    expect(e.count).toBeGreaterThan(200);
    expect(near / e.count).toBeGreaterThan(0.85); // still hugging the sphere after 2 s
    const a = finalizeAsset(newAsset('Fire ball', g));
    expect(a.shapes).toBeUndefined(); // hidden by default
    shape.hideOriginal = false;
    expect(finalizeAsset(newAsset('Fire ball', g)).shapes?.[0].kind).toBe('sphere');
  });
});
