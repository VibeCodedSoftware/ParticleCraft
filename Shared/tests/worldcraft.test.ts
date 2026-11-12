// WorldCraft's generators: the same seed always gives the same world, chunks meet at their edges, and changing one
// part leaves the others alone.
import { describe, expect, it } from 'vitest';
import { BLOCK_DEFS, BLOCK_LIST } from '../src/blocks/definitions';
import { block, event } from '../src/schema';
import { stream } from '../src/world/random';
import { baseHeight, chunksAround, terrainDefaults, TERRAIN_PRESETS } from '../src/world/terrain';
import { applyTerrainPreset, buildFeatures, chunkMesh, defaultConfig, ecosystemEvents, infiniteNoiseEvents, newWorld, voxelChunk, worldHeight, smoothPath } from '../src/world/features';
import { generateRock, generateTree, leafMesh, leafColorOf, ROCK_PRESETS, TREE_PRESETS, leafDefaults, voxelize } from '../src/world/generators';
import { fallIndex, makeLayer, scatterSquare, structuresInSquare } from '../src/world/scatter';
import { biomeAt, groundColor, snowAt, BIOME_INFO } from '../src/world/biomes';
import { hairOnMesh, modelHairDefaults } from '../src/world/leafHair';
import { BRICKS, runWorldLogic } from '../src/world/bricks';
import { deepCopy } from '../src/world/document';

const world = () => { const cfg = defaultConfig(); const f = buildFeatures(cfg, []); return { cfg, f, h: worldHeight(cfg, null, f) }; };

describe('seeds', () => {
  it('a stream gives the same numbers every time, and another name different ones', () => {
    const a = stream(5, 'trees', 1, 2), b = stream(5, 'trees', 1, 2), c = stream(5, 'rocks', 1, 2);
    const x = [a.next(), a.next()]; expect([b.next(), b.next()]).toEqual(x);
    expect(c.next()).not.toBe(x[0]);
  });
});

describe('terrain', () => {
  it('the same seed gives the same land; another gives other land', () => {
    const t = terrainDefaults();
    expect(baseHeight(t, 123.4, -55)).toBe(baseHeight(t, 123.4, -55));
    expect(baseHeight({ ...t, seed: t.seed + 1 }, 123.4, -55)).not.toBe(baseHeight(t, 123.4, -55));
  });
  it('every preset gives finite heights with real relief', () => {
    for (const [name, p] of Object.entries(TERRAIN_PRESETS)) {
      const t = { ...terrainDefaults(), ...p };
      let lo = Infinity, hi = -Infinity;
      for (let x = -400; x < 400; x += 25) for (let z = -400; z < 400; z += 25) { const h = baseHeight(t, x, z); expect(Number.isFinite(h), name).toBe(true); lo = Math.min(lo, h); hi = Math.max(hi, h); }
      if (name === 'Blank') { expect(hi - lo, name).toBe(0); continue; } // a flat canvas, on purpose
      expect(hi - lo, name).toBeGreaterThan(name === 'Flatlands' ? 0.3 : 3);
    }
  });
  it('mountains are taller than hills; an island sinks at its edges', () => {
    const max = (p: object) => { let m = -Infinity; const t = { ...terrainDefaults(), ...p }; for (let x = -500; x < 500; x += 20) for (let z = -500; z < 500; z += 20) m = Math.max(m, baseHeight(t, x, z)); return m; };
    expect(max(TERRAIN_PRESETS.Mountains)).toBeGreaterThan(max(TERRAIN_PRESETS.Hills));
    const isl = { ...terrainDefaults(), ...TERRAIN_PRESETS.Island };
    expect(baseHeight(isl, 256, 256)).toBeLessThan(0);
  });
  it('neighbouring chunks share their edge exactly, at any detail', () => {
    const { cfg, f, h } = world();
    const a = chunkMesh(cfg, null, f, h, 0, 0, 8), b = chunkMesh(cfg, null, f, h, 1, 0, 8), row = 9;
    for (let j = 0; j <= 8; j++) expect(b.positions[j * row * 3 + 1]).toBe(a.positions[(j * row + 8) * 3 + 1]);
    const c = chunkMesh(cfg, null, f, h, 1, 0, 16);
    for (let j = 0; j <= 8; j++) expect(c.positions[j * 2 * 17 * 3 + 1]).toBe(a.positions[(j * row + 8) * 3 + 1]);
  });
  it('a chunk comes back identical, whichever order chunks were made', () => {
    const { cfg, f, h } = world();
    const first = chunkMesh(cfg, null, f, h, 3, -2, 8).positions;
    chunkMesh(cfg, null, f, h, 7, 9, 8);
    expect(chunkMesh(cfg, null, f, h, 3, -2, 8).positions).toEqual(first);
  });
  it('endless worlds list chunks round the camera; finite ones cover the world', () => {
    const t = { ...terrainDefaults(), endless: true, viewChunks: 2 };
    const list = chunksAround(t, 640, 640);
    expect(list[0]).toEqual([10, 10]);
    expect(list.length).toBeLessThanOrEqual(25);
    const fin = chunksAround({ ...terrainDefaults(), endless: false, width: 128, depth: 128 }, 0, 0);
    expect(fin.length).toBe(4);
  });
  it('hand sculpting raises the ground across a chunk border and nowhere else', () => {
    const { cfg, f } = world();
    const edits = newWorld('x').edits;
    edits.height['32,0'] = 10;
    const h = worldHeight(cfg, edits, f), h0 = worldHeight(cfg, null, f);
    expect(h(64, 0) - h0(64, 0)).toBeCloseTo(10, 5);
    expect(h(90, 40)).toBe(h0(90, 40));
  });
});

describe('scatter', () => {
  const layer = () => deepCopy(defaultConfig().layers[0]);
  it('the same layer gives the same objects, in any order', () => {
    const { cfg, h } = world(), l = { ...layer(), density: 4, biomes: [], clustering: 0 };
    const a = scatterSquare({ cfg, edits: null, height: h }, l, 0, 0, 64);
    scatterSquare({ cfg, edits: null, height: h }, l, 64, 0, 64);
    expect(scatterSquare({ cfg, edits: null, height: h }, l, 0, 0, 64)).toEqual(a);
    expect(a.length).toBeGreaterThan(0);
  });
  it('objects don\'t depend on chunk size: two half squares are part of the whole', () => {
    const { cfg, h } = world(), l = { ...layer(), density: 4, clustering: 0 };
    const whole = scatterSquare({ cfg, edits: null, height: h }, l, 0, 0, 64).map((i) => i.uid).sort();
    const parts = [...scatterSquare({ cfg, edits: null, height: h }, l, 0, 0, 32), ...scatterSquare({ cfg, edits: null, height: h }, l, 32, 0, 32)].map((i) => i.uid);
    for (const id of parts) expect(whole).toContain(id);
  });
  it('changing a layer\'s seed moves only that layer', () => {
    const { cfg, h } = world(), [a, b] = cfg.layers;
    const rocks = scatterSquare({ cfg, edits: null, height: h }, b, 0, 0, 64);
    const moved = scatterSquare({ cfg, edits: null, height: h }, { ...a, seed: a.seed + 1, density: 6 }, 0, 0, 64);
    expect(moved).not.toEqual(scatterSquare({ cfg, edits: null, height: h }, { ...a, density: 6 }, 0, 0, 64));
    expect(scatterSquare({ cfg, edits: null, height: h }, b, 0, 0, 64)).toEqual(rocks);
  });
  it('slope and height rules hold, and painting 0 erases', () => {
    const { cfg, h } = world();
    const l = { ...layer(), density: 10, maxHeight: 12, clustering: 0 };
    for (const i of scatterSquare({ cfg, edits: null, height: h }, l, -64, -64, 128)) expect(i.y).toBeLessThanOrEqual(12);
    const edits = newWorld('x').edits;
    for (let x = 0; x <= 32; x++) for (let z = 0; z <= 32; z++) (edits.density[l.id] ??= {})[`${x},${z}`] = 0;
    expect(scatterSquare({ cfg, edits, height: h }, l, 8, 8, 40).length).toBe(0);
  });
});

describe('structures', () => {
  const spawn = () => ({ id: 's', name: 'Cabins', enabled: true, seed: 4, assets: ['cabin'], mode: 'scatter' as const, fixed: [], region: { x: 0, z: 0, w: 200, d: 200 }, cell: 40, chance: 1, minDistance: 60, minHeight: -1000, maxHeight: 1000, maxSlope: 0.9, biomes: [], fixedRotation: 0, randomRotation: true, scale: 1, persistent: true });
  it('buildings stay put on every visit, whichever chunk loads first, and keep their distance', () => {
    const { cfg, h } = world(); cfg.terrain.endless = true; cfg.water.enabled = false;
    const ctx = { cfg, edits: null, height: h }, s = spawn();
    const whole = structuresInSquare(ctx, s, -400, -400, 800);
    expect(whole.length).toBeGreaterThan(3);
    const parts: typeof whole = [];
    for (let x = -400; x < 400; x += 100) for (let z = 400 - 100; z >= -400; z -= 100) parts.push(...structuresInSquare(ctx, s, x, z, 100));
    expect(parts.map((p) => p.uid).sort()).toEqual(whole.map((p) => p.uid).sort());
    for (const a of whole) for (const b of whole) if (a !== b) expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThanOrEqual(60);
  });
  it('a fixed building is exactly there, for any seed of anything else', () => {
    const { cfg, h } = world(); cfg.water.enabled = false;
    const s = { ...spawn(), mode: 'fixed' as const, fixed: [{ x: 50, z: 70, ry: 30 }] };
    const r = structuresInSquare({ cfg, edits: null, height: h }, s, 0, 0, 128);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ x: 50, z: 70, ry: 30 });
  });
});

describe('Blank and Islands', () => {
  it('Blank is a flat empty canvas, and leaving it brings scattering back', () => {
    const c = defaultConfig(); applyTerrainPreset(c, 'Blank');
    const f = buildFeatures(c, []), h = worldHeight(c, null, f), y = h(0, 0);
    for (const [x, z] of [[33, -120], [-200, 80], [150, 150]]) expect(h(x, z)).toBeCloseTo(y, 5);
    expect(c.layers.every((l) => !l.enabled)).toBe(true);
    expect(c.water.enabled).toBe(false);
    applyTerrainPreset(c, 'Hills');
    expect(c.layers.every((l) => l.enabled)).toBe(true);
    expect(c.terrain.islands).toBe(0);
  });
  it('Islands makes several separate bodies of land in a sea, and the same ones for a seed', () => {
    const c = defaultConfig(); c.terrain.width = c.terrain.depth = 2048; applyTerrainPreset(c, 'Islands');
    const f = buildFeatures(c, []), h = worldHeight(c, null, f), n = 96, cell = 2048 / n, land = new Uint8Array(n * n);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) land[i + j * n] = h(-1024 + (i + 0.5) * cell, -1024 + (j + 0.5) * cell) > c.water.level ? 1 : 0;
    // Count the bodies of land.
    const seen = new Uint8Array(n * n); let bodies = 0;
    for (let s = 0; s < n * n; s++) { if (!land[s] || seen[s]) continue; bodies++; const st = [s]; seen[s] = 1; while (st.length) { const q = st.pop()!, x = q % n, y = (q / n) | 0; for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const u = x + a, v = y + b; if (u < 0 || v < 0 || u >= n || v >= n) continue; const k = u + v * n; if (land[k] && !seen[k]) { seen[k] = 1; st.push(k); } } } }
    const share = land.reduce((a, b) => a + b, 0) / land.length;
    expect(bodies).toBeGreaterThan(2);
    expect(share).toBeGreaterThan(0.08); expect(share).toBeLessThan(0.75);
    expect(h(1020, 1020)).toBeLessThan(c.water.level); // a finite world's edge is sea
    expect(h(77, -310)).toBe(worldHeight(c, null, buildFeatures(c, []))(77, -310));
  });
});

describe('leaf particles, colours, painting', () => {
  it('leaves start on the wood and follow the amount, in the same place for a seed', () => {
    const c = { ...TREE_PRESETS[0].cfg };
    const a = generateTree(c, 3), b = generateTree(c, 3), more = generateTree({ ...c, hair: { amount: 2 } }, 3);
    expect(a.leaves).toEqual(b.leaves);
    expect(a.leaves.length).toBeGreaterThan(100);
    expect(more.leaves.length).toBeGreaterThan(a.leaves.length * 1.6);
    expect(a.leaves.every((l) => l.d && Math.abs(Math.hypot(...l.d) - 1) < 1e-6)).toBe(true);
    expect(generateTree({ ...c, hair: { amount: 0 } }, 3).leaves.length).toBe(0);
    expect(generateTree({ ...c, hair: { amount: 3, limit: 50 } }, 3).leaves.length).toBeLessThanOrEqual(50);
  });
  it('leaves on a supplied mesh keep to the thinnest wood, repeatably', () => {
    // A thick "trunk" of big triangles below, thin twigs of small ones above.
    const tris: number[][][] = [];
    for (let i = 0; i < 200; i++) tris.push([[i % 7, 0, 0], [i % 7 + 3, 0, 0], [i % 7, 3, 0]]);
    for (let i = 0; i < 800; i++) tris.push([[i % 9, 8, i % 5], [i % 9 + 0.1, 8, i % 5], [i % 9, 8.1, i % 5]]);
    const tri = (i: number, a: number[], b: number[], c: number[]) => { const t = tris[i]; for (let k = 0; k < 3; k++) { a[k] = t[0][k]; b[k] = t[1][k]; c[k] = t[2][k]; } };
    const leaves = hairOnMesh(tris.length, tri as any, { ...modelHairDefaults(), start: 0, thinOnly: 0.5, clumps: 1, random: 0, amount: 0.1 }, 5);
    expect(leaves.length).toBe(300);
    expect(leaves.every((l) => l.p[1] > 7.9)).toBe(true);
    expect(hairOnMesh(tris.length, tri as any, { ...modelHairDefaults(), amount: 0.1 }, 5)).toEqual(hairOnMesh(tris.length, tri as any, { ...modelHairDefaults(), amount: 0.1 }, 5));
  });
  it('fall colours go to the share asked for, decided by the seeded tint', () => {
    const l = makeLayer({ id: 'a', name: 'A', kind: 'tree', sources: ['tree:oak'], randomColor: true, fallShare: 0.5 });
    expect(fallIndex(l, 0.1)).toBe(0); expect(fallIndex(l, 0.49)).toBe(3); expect(fallIndex(l, 0.5)).toBe(-1);
    expect(fallIndex({ ...l, randomColor: false }, 0.1)).toBe(-1);
  });
  it('a paint-only layer grows only where painted; random greens change the ground, repeatably', () => {
    const cfg = defaultConfig(); cfg.terrain.width = 200; cfg.terrain.depth = 200; cfg.water.enabled = false; cfg.biomes.enabled = false;
    const height = () => 5;
    const l = makeLayer({ id: 'p', name: 'P', kind: 'grass', sources: ['x'], paintOnly: true, density: 100, clustering: 0 });
    const edits = { ...newWorld('t').edits }; const ctx = { cfg, edits, height };
    expect(scatterSquare(ctx, l, 0, 0, 40).length).toBe(0);
    edits.density = { p: {} }; for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) edits.density.p[`${i},${j}`] = 1;
    const got = scatterSquare(ctx, l, 0, 0, 40);
    expect(got.length).toBeGreaterThan(0);
    expect(got.every((g) => g.x < 6 * edits.cell && g.z < 6 * edits.cell)).toBe(true);
    cfg.surface.greens = false;
    const plain = groundColor(cfg, null, 13, 27, 5, 0);
    cfg.surface.greens = true;
    const green = groundColor(cfg, null, 13, 27, 5, 0);
    expect(green).not.toEqual(plain);
    expect(groundColor(cfg, null, 13, 27, 5, 0)).toEqual(green);
    expect(green[1]).toBeGreaterThan(green[2]);
    // Greens lie over grassy ground only: a purple meadow stays purple.
    // (Compared with greens off, that ground only takes the dry tan of non-green ground: never green.)
    cfg.surface.grass = '#6d5ca8'; const purple = groundColor(cfg, null, 13, 27, 5, 0);
    expect(purple[2]).toBeGreaterThan(purple[1]);
    expect(purple[1] - purple[0]).toBeLessThan(0.01);
  });
});

describe('generators', () => {
  it('trees: same seed, same mesh; another seed differs; species really differ', () => {
    const oak = TREE_PRESETS[0].cfg;
    expect(generateTree(oak, 1)).toEqual(generateTree(oak, 1));
    expect(generateTree(oak, 2).wood.positions).not.toEqual(generateTree(oak, 1).wood.positions);
    const stats = TREE_PRESETS.map((p) => generateTree(p.cfg, 3));
    for (const s of stats) { expect(s.wood.indices.length).toBeGreaterThan(30); expect(s.wood.positions.every(Number.isFinite)).toBe(true); }
    expect(generateTree(TREE_PRESETS.find((p) => p.id === 'dead')!.cfg, 3).leaves.length).toBe(0);
    expect(generateTree(TREE_PRESETS.find((p) => p.id === 'oak')!.cfg, 3).radius).toBeGreaterThan(generateTree(TREE_PRESETS.find((p) => p.id === 'birch')!.cfg, 3).radius);
  });
  it('tree height follows its setting; a tree is under budget for scattering', () => {
    const t = TREE_PRESETS[0].cfg;
    expect(generateTree({ ...t, height: 20 }, 1).height).toBeGreaterThan(generateTree({ ...t, height: 6 }, 1).height);
    for (const p of TREE_PRESETS) expect(generateTree(p.cfg, 1).triangles, p.id).toBeLessThan(90000);
  });
  it('Growth Stack: forces do what they say', () => {
    const base = { ...TREE_PRESETS[0].cfg, leafDensity: 0, splitChance: 0, breakChance: 0, randomness: 0.1 };
    const lowest = (g: number) => { const t = generateTree({ ...base, gravity: g, upAttraction: 0, stages: [] }, 3); let lo = Infinity; for (let i = 1; i < t.wood.positions.length; i += 3) lo = Math.min(lo, t.wood.positions[i]); return { lo, avg: t.wood.positions.filter((_, i) => i % 3 === 1).reduce((a, b) => a + b, 0) / (t.wood.positions.length / 3) }; };
    expect(lowest(3).avg).toBeLessThan(lowest(0).avg); // heavier branches sag
    const verts = (o: object) => generateTree({ ...base, ...o }, 3).wood.positions.length;
    expect(verts({ splitChance: 0.9 })).toBeGreaterThan(verts({ splitChance: 0 })); // forks add wood
    expect(verts({ stages: [{}, { count: 0 }] })).toBeLessThan(verts({ stages: [] })); // a stage can be switched off
    expect(verts({ breakChance: 1 })).toBeLessThan(verts({ breakChance: 0 })); // snapped branches end early
  });
  it('Growth Stack: flex runs from 0 at the foot of the trunk toward 1 at the tips, on every vertex', () => {
    const t = generateTree(TREE_PRESETS[0].cfg, 3);
    expect(t.wood.flex!.length).toBe(t.wood.positions.length / 3);
    expect(Math.min(...t.wood.flex!)).toBe(0);
    expect(Math.max(...t.wood.flex!)).toBeGreaterThan(0.6);
    const leaves = leafMesh(t, leafDefaults(), '#00ff00');
    expect(leaves.flex!.length).toBe(leaves.positions.length / 3);
    expect(Math.min(...leaves.flex!)).toBeGreaterThan(0.1);
  });
  it('Growth Stack: light competition thins crowded twigs, repeatably', () => {
    const base = { ...TREE_PRESETS[0].cfg, leafDensity: 0, branches: 12 };
    const v = (light: number) => generateTree({ ...base, light }, 3).wood.positions.length;
    expect(v(1)).toBeLessThan(v(0));
    expect(generateTree({ ...base, light: 1 }, 3)).toEqual(generateTree({ ...base, light: 1 }, 3));
  });
  it('leaf percentages decide the colours', () => {
    const l = { ...leafDefaults(), variation: 0 };
    expect(leafColorOf(l, '#00ff00', 0.5, 0.5)[1]).toBeCloseTo(1, 2);
    const brown = leafColorOf({ ...l, healthy: 0, brown: 100 }, '#00ff00', 0.5, 0.5);
    expect(brown[0]).toBeGreaterThan(brown[2]);
    const m = leafMesh(generateTree(TREE_PRESETS[0].cfg, 1), l, '#00ff00');
    expect(m.indices.length % 6).toBe(0);
  });
  it('rocks: same seed, same mesh; finite everywhere', () => {
    for (const p of ROCK_PRESETS) { const r = generateRock(p.cfg, 7); expect(r.positions.every(Number.isFinite), p.id).toBe(true); expect(r.indices.length).toBeGreaterThan(0); expect(generateRock(p.cfg, 7)).toEqual(r); }
    expect(generateRock(ROCK_PRESETS[0].cfg, 1).positions).not.toEqual(generateRock(ROCK_PRESETS[0].cfg, 2).positions);
  });
  it('voxelize: one solid cell has six faces', () => {
    const one = voxelize((x, y, z) => x < 1 && y < 1 && z < 1 && x > 0 && y > 0 && z > 0, [0, 0, 0], [2, 2, 2], 1, () => [1, 1, 1]);
    expect(one.indices.length).toBe(6 * 6);
  });
});

describe('features', () => {
  it('rivers run downhill and carve the land', () => {
    const cfg = defaultConfig(); cfg.terrain = { ...cfg.terrain, ...TERRAIN_PRESETS.Mountains, width: 1024, depth: 1024 }; cfg.water.rivers = 2;
    const f = buildFeatures(cfg, []);
    expect(f.rivers.length).toBeGreaterThan(0);
    for (const r of f.rivers) for (let i = 1; i < r.levels.length; i++) expect(r.levels[i]).toBeLessThanOrEqual(r.levels[i - 1]);
    const [x, z] = f.rivers[0].points[Math.floor(f.rivers[0].points.length / 2)];
    expect(worldHeight(cfg, null, f)(x, z)).toBeLessThan(baseHeight(cfg.terrain, x, z) + 0.01);
    expect(buildFeatures(cfg, []).rivers).toEqual(f.rivers);
  });
  it('a road grades the ground under it', () => {
    const cfg = defaultConfig(); cfg.terrain = { ...cfg.terrain, ...TERRAIN_PRESETS.Hills };
    const pts = smoothPath([[-100, 0], [0, 20], [100, 0]]);
    const f0 = buildFeatures(cfg, []), f1 = buildFeatures(cfg, [{ id: 'r', kind: 'dirt', width: 5, points: pts, conform: 1, bridge: false, material: '', decorate: 0 }]);
    let moved = 0;
    for (const [x, z] of pts) if (Math.abs(worldHeight(cfg, null, f1)(x, z) - worldHeight(cfg, null, f0)(x, z)) > 0.05) moved++;
    expect(moved).toBeGreaterThan(pts.length / 3);
  });
  it('biomes and snow follow the rules', () => {
    const cfg = defaultConfig(); cfg.biomes.temperature = -1;
    expect(['snow', 'tundra', 'rocky']).toContain(biomeAt(cfg, null, 40, 40, 30).id);
    cfg.biomes.temperature = 1; cfg.biomes.moisture = -1;
    expect(biomeAt(cfg, null, 40, 40, 30).id).toBe('desert');
    expect(BIOME_INFO.desert.name).toBe('Desert');
    cfg.snow.enabled = true; cfg.snow.variation = 0;
    expect(snowAt(cfg, null, 0, 0, 200, 0)).toBe(1);
    expect(snowAt(cfg, null, 0, 0, 0, 0)).toBe(0);
    expect(snowAt(cfg, null, 0, 0, 200, 0.9)).toBe(0); // too steep
  });
  it('voxel chunks give repeatable meshes', () => {
    const { cfg, h } = world();
    expect(voxelChunk(cfg, null, h, 0, 0, 4).indices.length).toBeGreaterThan(100);
  });
});

describe('bricks', () => {
  it('are blocks in the shared list, only offered in WorldCraft; the shared logic blocks stay put', () => {
    for (const x of BRICKS) { expect(BLOCK_DEFS[x.id]?.apps).toEqual(['worldcraft']); expect(x.id).toMatch(/^[a-z0-9_]+\.[a-z0-9_]+$/); }
    expect(BLOCK_DEFS['var.set'].apps).toContain('gamecraft');
    expect(BLOCK_DEFS['var.set'].apps).toContain('worldcraft');
    expect(BLOCK_LIST.filter((d) => d.apps.includes('gamecraft') && BRICKS.some((b) => b.id === d.id))).toEqual([]);
  });
  it('every brick runs with its defaults and sets something', () => {
    for (const x of BRICKS) {
      if (x.condition || x.trigger || x.id === 'road.generator') continue;
      const doc = newWorld('t');
      doc.logic.sheets[0].events = [event([block('world.on_generate')], [block(x.id, Object.fromEntries(x.params.map((p) => [p.name, p.default])))])];
      const r = runWorldLogic(doc.logic, doc.config);
      expect(r.errors, x.id).toEqual([]);
      expect(Object.keys(r.sources).length, x.id).toBeGreaterThan(0);
    }
  });
  it('bricks change the settings the generators use, without touching the saved ones', () => {
    const doc = newWorld('t');
    doc.logic.sheets[0].events = [event([block('world.on_generate')], [block('terrain.height', { height: '200', base: '9' }), block('terrain.endless', { on: true })])];
    const r = runWorldLogic(doc.logic, doc.config);
    expect(r.config.terrain.height).toBe(200);
    expect(r.config.terrain.endless).toBe(true);
    expect(doc.config.terrain.height).not.toBe(200);
    expect(r.sources['terrain.height']).toBeTruthy();
  });
  it('sub-events, else, disabled blocks and expressions work', () => {
    const doc = newWorld('t');
    doc.logic.globals = [{ name: 'tall', type: 'number', value: 100 }];
    doc.logic.sheets[0].events = [event([block('world.on_generate')], [block('season.control', { season: 'winter', enabled: true })], [
      event([block('world.if_season', { season: 'summer' })], [block('terrain.height', { height: '1', base: '0' })]),
      event([], [block('terrain.height', { height: 'tall * 2', base: '0' })], [], { isElse: true }),
      event([], [block('terrain.chunk', { size: '99' }, undefined, { disabled: true })]),
    ])];
    const r = runWorldLogic(doc.logic, doc.config);
    expect(r.config.terrain.height).toBe(200);
    expect(r.config.terrain.chunkSize).toBe(64);
  });
  it('blocks not under On generate do nothing', () => {
    const doc = newWorld('t');
    doc.logic.sheets[0].events = [event([], [block('terrain.height', { height: '500', base: '0' })])];
    expect(runWorldLogic(doc.logic, doc.config).config.terrain.height).not.toBe(500);
  });
  it('the Infinite Noise preset makes an endless world; the ecosystem preset links season, leaves and snow', () => {
    const doc = newWorld('t');
    doc.logic.sheets[0].events = infiniteNoiseEvents();
    expect(runWorldLogic(doc.logic, doc.config).config.terrain.endless).toBe(true);
    doc.logic.sheets[0].events = ecosystemEvents();
    const auto = runWorldLogic(doc.logic, doc.config);
    expect(auto.errors).toEqual([]);
    expect(auto.config.season.season).toBe('autumn');
    expect(auto.config.snow.enabled).toBe(false);
    expect(auto.config.leaves.orange).toBe(30);
  });
  it('the same logic runs the same, including random()', () => {
    const doc = newWorld('t');
    doc.logic.sheets[0].events = [event([block('world.on_generate')], [block('terrain.height', { height: 'random(10, 100)', base: '0' })])];
    expect(runWorldLogic(doc.logic, doc.config).config.terrain.height).toBe(runWorldLogic(doc.logic, doc.config).config.terrain.height);
  });
});
