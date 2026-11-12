// The terrain node graph: every node works, links carry the right outputs, loops are refused, results are cached.
import { describe, expect, it } from 'vitest';
import { block, event } from '../src/schema';
import { runWorldLogic } from '../src/world/bricks';
import { buildFeatures, newWorld, worldHeight } from '../src/world/features';
import { baseHeight, packGrid } from '../src/world/terrain';
import { defaultGraph, GraphEvaluator, graphOutputInfo, makesLoop, NODE_DEFS, newNode, type NodeType, type TerrainGraph } from '../src/world/terrainGraph';

const range = (a: Float32Array) => { let lo = Infinity, hi = -Infinity; for (const v of a) { lo = Math.min(lo, v); hi = Math.max(hi, v); } return [lo, hi]; };

describe('Terrain node graph', () => {
  it('the starter graph makes eroded, coloured land with flow, wear and sediment', async () => {
    const r = (await new GraphEvaluator(48).run(defaultGraph()))!;
    expect(r.node.type).toBe('output');
    const [lo, hi] = range(r.out.height); expect(hi - lo).toBeGreaterThan(0.2);
    expect(r.out.color.length).toBe(48 * 48 * 3);
    for (const k of ['flow', 'wear', 'deposit']) expect(range(r.out[k])[1]).toBeGreaterThan(0.3);
    expect(graphOutputInfo(defaultGraph()).palette).toBe('temperate');
  });
  it.each(Object.keys(NODE_DEFS) as NodeType[])('%s works with its defaults and gives finite values', async (type) => {
    const src = { ...newNode('mountain', 0, 0), id: 'src' }, n = { ...newNode(type, 0, 0), id: 'x' };
    const g: TerrainGraph = { nodes: [src, n], links: NODE_DEFS[type].inputs.filter((p) => p.kind !== 'color').map((p) => ({ from: 'src', fromPort: 'height', to: 'x', toPort: p.port })) };
    const r = (await new GraphEvaluator(32).run(g, 'x'))!;
    for (const o of NODE_DEFS[type].outputs) { expect(r.out[o.port]).toBeDefined(); for (const v of r.out[o.port]) expect(Number.isFinite(v)).toBe(true); }
  });
  it('every Mountain kind gives a different land', async () => {
    const seen = new Set<string>();
    for (const [kind] of NODE_DEFS.mountain.params[0].options!) {
      const m = { ...newNode('mountain', 0, 0), id: 'm' }; m.params.kind = kind;
      const r = (await new GraphEvaluator(24).run({ nodes: [m], links: [] }, 'm'))!;
      seen.add(Array.from(r.out.height.slice(0, 40), (v) => v.toFixed(3)).join());
    }
    expect(seen.size).toBe(NODE_DEFS.mountain.params[0].options!.length);
  });
  it('refuses loops, and changing one node redoes only it and what follows', async () => {
    const g = defaultGraph();
    // (Linking a later node's output back into an earlier node is a loop; another forward link is not.)
    expect(makesLoop(g, 'mtn', 'out')).toBe(false);
    expect(makesLoop(g, 'ero', 'mtn')).toBe(true);
    const ev = new GraphEvaluator(32);
    await ev.run(g);
    let computed = 0; const orig = (ev as any).compute.bind(ev); (ev as any).compute = (...a: any[]) => { computed++; return orig(...a); };
    await ev.run(g); expect(computed).toBe(0);
    g.nodes.find((n) => n.id === 'col')!.params.palette = 'canyon';
    await ev.run(g); expect(computed).toBe(2); // Colorize and Output only, not the erosion before them.
  });
  it('with the logic bricks: an applied graph is not bent by terrain bricks; "Node graph land" fades it; World terrain reads what the bricks make', async () => {
    const doc = newWorld('t'); doc.config.terrain.endless = false; doc.config.water.enabled = false; doc.config.cave.enabled = false;
    // A graph applied as the land: 40 m everywhere.
    const n = 9, a = new Int16Array(n * n).fill(40 * 20);
    doc.edits.grids = [{ id: 'g', label: 'Node graph', x0: -64, z0: -64, nx: n, nz: n, cell: 16, height: packGrid(a), absolute: true }];
    const heightWith = (events: ReturnType<typeof event>[]) => { doc.logic.sheets[0].events = events; const r = runWorldLogic(doc.logic, doc.config); return { r, h: worldHeight(r.config, doc.edits, buildFeatures(r.config, []))(10, 10) }; };
    const plain = heightWith([]).h;
    expect(plain).toBeCloseTo(40, 1);
    // A brick that changes the terrain's noise and height: the graph's land stays as applied.
    expect(heightWith([event([block('world.on_generate')], [block('terrain.height', { height: '300', base: '50' })])]).h).toBeCloseTo(40, 1);
    // "Node graph land 0": the land the terrain settings make; 0.5: halfway.
    const off = heightWith([event([block('world.on_generate')], [block('terrain.graph_land', { amount: '0' })])]);
    expect(off.h).toBeCloseTo(baseHeight(off.r.config.terrain, 10, 10), 3);
    const half = heightWith([event([block('world.on_generate')], [block('terrain.graph_land', { amount: '0.5' })])]).h;
    expect(half).toBeCloseTo((40 + off.h) / 2, 2);
    // Ground Look brick sets the palette.
    expect(heightWith([event([block('world.on_generate')], [block('terrain.look', { palette: 'canyon', strength: '0.6' })])]).r.config.surface.look).toEqual({ palette: 'canyon', strength: 0.6 });
    // World terrain node: the land the bricks make (taller with the Height brick), not the applied graph.
    const tall = heightWith([event([block('world.on_generate')], [block('terrain.height', { height: '300', base: '50' })])]).r.config.terrain;
    const w = { ...newNode('world', 0, 0), id: 'w' };
    const out = (await new GraphEvaluator(16, { terrain: tall, side: 256 }).run({ nodes: [w], links: [] }, 'w'))!.out.height;
    expect(out[8 * 16 + 8]).toBeCloseTo((baseHeight(tall, 0 + (8 / 15 - 0.5) * 256, (8 / 15 - 0.5) * 256) - 50) / 300, 3);
  });
  it('rivers run in the land an applied graph (or sculpting) makes: their water is never above the ground beside them nor far over their bed', () => {
    const doc = newWorld('t'); Object.assign(doc.config.terrain, { endless: false, width: 512, depth: 512 }); Object.assign(doc.config.water, { enabled: true, level: -30, rivers: 4 });
    // The graph's land: a slope from 120 m down to 0 m, nothing like the generated noise.
    const n = 65, a = new Int16Array(n * n); for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) a[j * n + i] = Math.round((120 - (i / (n - 1)) * 120 + Math.sin(j * 0.4) * 6) * 20);
    doc.edits.grids = [{ id: 'g', label: 'Node graph', x0: -256, z0: -256, nx: n, nz: n, cell: 8, height: packGrid(a), absolute: true }];
    // And a hand-sculpted mound across the land.
    for (let i = -40; i < 40; i++) for (let j = -40; j < 40; j++) doc.edits.height[`${i},${j}`] = 8;
    const f = buildFeatures(doc.config, [], doc.edits), h = worldHeight(doc.config, doc.edits, f);
    expect(f.rivers.length).toBeGreaterThan(0);
    let checked = 0;
    for (const r of f.rivers) r.points.forEach(([x, z], i) => {
      if (Math.abs(x) > 240 || Math.abs(z) > 240) return;
      const lv = r.levels[i]; checked++;
      expect(h(x, z)).toBeLessThan(lv + 0.01);            // the bed is under the water
      expect(lv - h(x, z)).toBeLessThan(6);                // not water hanging far above its bed
    });
    expect(checked).toBeGreaterThan(10);
  });
  it('Terrace makes flat steps; Mask by height selects the high ground', async () => {
    const s = { ...newNode('pattern', 0, 0), id: 'p' }; s.params.kind = 'gradient'; s.params.wobble = 0;
    const t = { ...newNode('terrace', 0, 0), id: 't' }; t.params.strength = 1; t.params.wobble = 0; t.params.steps = 4; t.params.mode = 'sharp';
    const m = { ...newNode('mask', 0, 0), id: 'k' }; m.params.low = 0.5; m.params.high = 1; m.params.softness = 0.01;
    const g: TerrainGraph = { nodes: [s, t, m], links: [{ from: 'p', fromPort: 'height', to: 't', toPort: 'height' }, { from: 'p', fromPort: 'height', to: 'k', toPort: 'height' }] };
    const ev = new GraphEvaluator(64);
    const tr = (await ev.run(g, 't'))!.out.height, distinct = new Set(Array.from(tr, (v) => v.toFixed(2)));
    expect(distinct.size).toBeLessThan(25);
    const mk = (await ev.run(g, 'k'))!.out.mask;
    expect(mk[32 * 64 + 2]).toBeLessThan(0.1); expect(mk[32 * 64 + 61]).toBeGreaterThan(0.9);
  });
});
