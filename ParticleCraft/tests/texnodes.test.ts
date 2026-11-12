// Texture node graph: every node type evaluates, every recipe chain produces a picture, sequences bake sheets.
import { describe, expect, it } from 'vitest';
import { TEX_NODE, TEX_NODE_TYPES, TEX_RECIPES, texNodeDefaults, type Img } from '../src/texNodes';

const run = (type: string, props: Record<string, any> = {}, inputs: Record<string, Img | null> = {}, time = 0) =>
  TEX_NODE[type].eval({ p: { ...texNodeDefaults(type), size: 32, ...props }, input: (k) => inputs[k] ?? null, time, picture: () => null });

describe('texture nodes', () => {
  it('every generator makes a picture and every filter keeps one', () => {
    const src = run('fractal')!;
    for (const t of TEX_NODE_TYPES) {
      if (t.type === 'sequence' || t.type === 'textureInput') continue;
      const ins = Object.fromEntries(t.inputs.map((k) => [k, src]));
      const out = run(t.type, {}, ins);
      expect(out, t.type).toBeTruthy();
      expect(out!.d.length, t.type).toBe(out!.w * out!.h * 4);
      expect([...out!.d].every(Number.isFinite), t.type).toBe(true);
    }
  });
  it('animated generators change over time; voronoi mask is a mask', () => {
    const a = run('turbulence', {}, {}, 0)!, b = run('turbulence', {}, {}, 1)!;
    expect(a.d.some((v, i) => Math.abs(v - b.d[i]) > 0.01)).toBe(true);
    const m = run('voronoiMask', { mode: 'borders' })!;
    const alphas = new Set<number>(); for (let i = 3; i < m.d.length; i += 4) alphas.add(Math.round(m.d[i] * 4));
    expect(alphas.size).toBeGreaterThan(1);
  });
  it('every recipe chain evaluates end to end', () => {
    for (const r of TEX_RECIPES) {
      const outs: (Img | null)[] = [];
      for (const st of r.steps) {
        if (st.type === 'sequence') { outs.push(outs[st.inputs!.in]); continue; } // baked by the graph runtime
        const ins = Object.fromEntries(Object.entries(st.inputs ?? {}).map(([k, j]) => [k, outs[j]]));
        outs.push(run(st.type, st.props, ins));
      }
      const last = outs[outs.length - 1];
      expect(last, r.name).toBeTruthy();
      let opaque = 0; for (let i = 3; i < last!.d.length; i += 4) if (last!.d[i] > 0.05) opaque++;
      expect(opaque, r.name).toBeGreaterThan(0);
    }
  });
});
