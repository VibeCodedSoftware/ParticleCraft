// Every simulation runs for a few seconds without blowing up (NaN / runaway values).
import { describe, expect, it } from 'vitest';
import { SIM_TYPES, defaultsOf } from '../src/sim/sims';

const finite = (o: any) => Object.values(o).filter((v) => v instanceof Float32Array).every((a: any) => a.every((x: number) => Number.isFinite(x) && Math.abs(x) < 1e6));

describe('Simulation Mode solvers', () => {
  for (const t of SIM_TYPES) {
    it(`${t.name} stays stable for 3 seconds`, () => {
      const sim: any = t.create(defaultsOf(t));
      for (let i = 0; i < 180; i++) sim.step(1 / 60);
      expect(finite(sim)).toBe(true);
      if (sim.bricks) expect(sim.bricks.every((b: any) => Number.isFinite(b.x) && Number.isFinite(b.y))).toBe(true);
    });
  }

  it('fire produces heat that rises from the source', () => {
    const t = SIM_TYPES.find((s) => s.id === 'fire')!;
    const f: any = t.create(defaultsOf(t));
    for (let i = 0; i < 90; i++) f.step(1 / 60);
    const n = f.n; let top = 0, all = 0;
    for (let j = 1; j <= n; j++) for (let i = 1; i <= n; i++) { const v = f.T[f.IX(i, j)]; all += v; if (j < n * 0.6) top += v; }
    expect(all).toBeGreaterThan(1);
    expect(top).toBeGreaterThan(0.1);
  });

  it('destruction knocks bricks loose', () => {
    const t = SIM_TYPES.find((s) => s.id === 'destruction')!;
    const d: any = t.create(defaultsOf(t));
    for (let i = 0; i < 120; i++) d.step(1 / 60);
    expect(d.bricks.filter((b: any) => b.loose).length).toBeGreaterThan(5);
  });
});
