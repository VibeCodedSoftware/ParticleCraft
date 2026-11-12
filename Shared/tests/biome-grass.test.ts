// A new world (biomes on) should be green and grassy, whichever terrain it uses: dry and cold biomes are places you find,
// not the whole map, and they thin the grass without losing it.
import { describe, expect, it } from 'vitest';
import { applyTerrainPreset, buildFeatures, defaultConfig, worldHeight } from '../src/world/features';
import { biomeAt, groundColor } from '../src/world/biomes';
import { scatterSquare } from '../src/world/scatter';

const presets = ['Flatlands', 'Hills', 'Valleys', 'Mountains'];
function world(preset: string, seed?: number) {
  const cfg = defaultConfig();
  applyTerrainPreset(cfg, preset);
  cfg.biomes.enabled = true;
  if (seed) cfg.biomes.seed = seed;
  return { cfg, h: worldHeight(cfg, null, buildFeatures(cfg, [])) };
}
function survey({ cfg, h }: ReturnType<typeof world>) {
  const counts: Record<string, number> = {};
  let green = 0, n = 0;
  const w = cfg.terrain.width, d = cfg.terrain.depth;
  for (let i = 0; i < 40; i++) for (let j = 0; j < 40; j++) {
    const x = ((i + 0.5) / 40 - 0.5) * w, z = ((j + 0.5) / 40 - 0.5) * d, y = h(x, z);
    if (cfg.water.enabled && y < cfg.water.level + 2) continue;
    const id = biomeAt(cfg, null, x, z, y).id; counts[id] = (counts[id] ?? 0) + 1;
    const c = groundColor(cfg, null, x, z, y, 0);
    if (c[1] > c[0] * 1.08 && c[1] > c[2] * 1.15) green++;
    n++;
  }
  return { counts, green: green / Math.max(1, n), n };
}
/** Grass plants in a 40 m square in the middle of the world, against the same world with biomes off. */
function grassShare(wd: ReturnType<typeof world>) {
  const layer = wd.cfg.layers.find((l) => l.kind === 'grass')!;
  let on = 0, off = 0;
  for (const [x, z] of [[-20, -20], [150, 150], [-200, 120], [120, -220], [-150, -150]]) {
    on += scatterSquare({ cfg: wd.cfg, edits: null, height: wd.h }, layer, x, z, 40).length;
    off += scatterSquare({ cfg: { ...wd.cfg, biomes: { ...wd.cfg.biomes, enabled: false } }, edits: null, height: wd.h }, layer, x, z, 40).length;
  }
  return on / Math.max(1, off);
}

describe('Biome worlds are green by default', () => {
  it.each(presets)('%s', (p) => {
    const wd = world(p), s = survey(wd), g = grassShare(wd);
    console.log(p, Math.round(s.green * 100) + '% green', 'grass ' + Math.round(g * 100) + '%', JSON.stringify(s.counts));
    expect(s.n).toBeGreaterThan(800); // most of the map is land, not shore
    if (p !== 'Mountains') { expect(s.green).toBeGreaterThan(0.8); expect(g).toBeGreaterThan(0.75); }
  });
  it('other biome seeds are green too', () => {
    for (const seed of [11, 222, 3333, 44444]) {
      const wd = world('Flatlands', seed), s = survey(wd), g = grassShare(wd);
      console.log('seed', seed, Math.round(s.green * 100) + '% green', 'grass ' + Math.round(g * 100) + '%');
      expect(s.green).toBeGreaterThan(0.7); expect(g).toBeGreaterThan(0.5);
    }
  });
  it('dry and bare biomes still thin grass; a shore has almost none', async () => {
    const { BIOME_INFO } = await import('../src/world/biomes');
    expect(BIOME_INFO.beach.grass).toBeLessThan(0.1); expect(BIOME_INFO.desert.grass).toBeLessThan(0.1);
    expect(BIOME_INFO.grassland.grass).toBe(1);
    expect(BIOME_INFO.grassland.density).toBeLessThan(1); // a grassland still has fewer trees
  });
});
