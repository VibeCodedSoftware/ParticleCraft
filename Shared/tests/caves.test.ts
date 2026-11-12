// Caves are underground everywhere, follow the land, are plentiful, and open at the surface only at their entrances.
import { describe, expect, it } from 'vitest';
import { applyTerrainPreset, buildFeatures, chunkMesh, defaultConfig, terrainChunk, worldHeight } from '../src/world/features';
import { caveChunk } from '../src/world/caves';

function world(preset = 'Mountains', o: Record<string, any> = {}) {
  const cfg = defaultConfig();
  applyTerrainPreset(cfg, preset);
  Object.assign(cfg.cave, { enabled: true }, o);
  const f = buildFeatures(cfg, []);
  return { cfg, f, h: worldHeight(cfg, null, f) };
}

describe('Caves', () => {
  it('are plentiful: tunnels through most of the map, not one network in one place', () => {
    const { cfg, f, h } = world();
    let withCaves = 0, n = 0;
    for (let x = -300; x < 300; x += 100) for (let z = -300; z < 300; z += 100) { n++; if (f.caves!.near(h, x, z, x + 100, z + 100).length) withCaves++; }
    expect(withCaves / n).toBeGreaterThan(0.85);
    void cfg;
  });
  it.each(['Mountains', 'Hills', 'Cliffs', 'Flatlands'])('%s: every tunnel stays under the ground above it (except where it opens)', (preset) => {
    const { f, h } = world(preset);
    let below = 0, above = 0;
    for (const w of f.caves!.near(h, -250, -250, 250, 250)) w.pts.forEach((p, s) => {
      if (w.entrance && s < 8) return; // (an entrance climbs out on purpose)
      const roof = p[1] + w.rad[s];
      if (roof < h(p[0], p[2]) - 0.5) below++; else above++;
    });
    expect(below).toBeGreaterThan(100);
    expect(above).toBe(0);
  });
  it('cave walls are never drawn above the ground', () => {
    const { cfg, f, h } = world();
    let verts = 0, bad = 0;
    for (const [cx, cz] of [[0, 0], [1, 0], [-1, 1], [2, -2], [0, 3]]) {
      const m = caveChunk(cfg, f.caves!, h, cx, cz); if (!m) continue;
      for (let i = 0; i < m.positions.length; i += 3) {
        const x = m.positions[i], z = m.positions[i + 2];
        if (m.positions[i + 1] <= h(x, z) + 0.8) { verts++; continue; }
        verts++;
        // Above ground is allowed only on the rim of an opening.
        let rim = false;
        for (let dx = -3; dx <= 3 && !rim; dx += 1.5) for (let dz = -3; dz <= 3 && !rim; dz += 1.5) if (f.caves!.opening(h, x + dx, z + dz)) rim = true;
        if (!rim) bad++;
      }
    }
    expect(verts).toBeGreaterThan(1000);
    expect(bad).toBe(0);
  });
  it('entrances cut holes in the terrain; with no entrances there are none', () => {
    const open = world('Hills', { entrances: 1 }), shut = world('Hills', { entrances: 0 });
    let holes = 0;
    for (let x = -200; x < 200; x += 1) for (let z = -200; z < 200; z += 8) if (open.f.caves!.opening(open.h, x, z)) holes++;
    expect(holes).toBeGreaterThan(5);
    for (let x = -200; x < 200; x += 2) for (let z = -200; z < 200; z += 8) expect(shut.f.caves!.opening(shut.h, x, z)).toBe(false);
    // The terrain chunk really loses those triangles.
    const off = { ...open.cfg, cave: { ...open.cfg.cave, enabled: false } }, fOff = buildFeatures(off, []);
    let fewer = false;
    for (let cx = -3; cx < 3 && !fewer; cx++) for (let cz = -3; cz < 3 && !fewer; cz++)
      if (chunkMesh(open.cfg, null, open.f, open.h, cx, cz, 64).indices.length < chunkMesh(off, null, fOff, worldHeight(off, null, fOff), cx, cz, 64).indices.length) fewer = true;
    expect(fewer).toBe(true);
  });
  it('openings are only on gentle ground (on a steep side you saw straight through)', () => {
    const { f, h } = world('Mountains', { entrances: 1 });
    const ops = f.caves!.openingsIn(h, -250, -250, 250, 250);
    expect(ops.length).toBeGreaterThan(3);
    for (const o of ops) expect(Math.hypot(h(o.x + 2, o.z) - h(o.x - 2, o.z), h(o.x, o.z + 2) - h(o.x, o.z - 2)) / 4).toBeLessThan(0.75);
  });
  it('the same seed gives the same caves in every chunk; a chunk built twice is identical', () => {
    const a = world(), b = world();
    expect(caveChunk(a.cfg, a.f.caves!, a.h, 1, 0)?.positions).toEqual(caveChunk(b.cfg, b.f.caves!, b.h, 1, 0)?.positions);
    const other = world('Mountains', { seed: 99 });
    expect(JSON.stringify(other.f.caves!.near(other.h, 0, 0, 64, 64).map((w) => w.pts[0]))).not.toBe(JSON.stringify(a.f.caves!.near(a.h, 0, 0, 64, 64).map((w) => w.pts[0])));
  });
  it('terrain chunks carry their caves near the camera, not far away; off means none', () => {
    const { cfg, f, h } = world();
    const found = [[0, 0], [1, 1], [-1, 0], [2, 1]].some(([cx, cz]) => !!terrainChunk(cfg, null, f, h, cx, cz, 32, 0).cave);
    expect(found).toBe(true);
    expect(terrainChunk(cfg, null, f, h, 0, 0, 32, 2).cave).toBeUndefined();
    // Far away the ground stays closed: no opening without the cave behind it (it showed the backdrop through).
    const open = world('Hills', { entrances: 1 });
    let near = 0, far = 0;
    for (let cx = -3; cx < 3; cx++) for (let cz = -3; cz < 3; cz++) { near += terrainChunk(open.cfg, null, open.f, open.h, cx, cz, 32, 1).indices.length; far += terrainChunk(open.cfg, null, open.f, open.h, cx, cz, 32, 2).indices.length; }
    expect(near).toBeLessThan(far);
    const off = defaultConfig(); const fo = buildFeatures(off, []);
    expect(terrainChunk(off, null, fo, worldHeight(off, null, fo), 0, 0, 32, 0).cave).toBeUndefined();
  });
});
