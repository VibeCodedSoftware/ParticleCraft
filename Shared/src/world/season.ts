// Seasonal foliage: only colours change, in the shader. Nothing is replaced, regenerated or written to the original
// files; turning it off shows the assets exactly as they are.
import { hexRgb } from './biomes';
import type { SeasonCfg } from './document';

export type Season = SeasonCfg['season'];
/** Four shades each; plants pick one by their own random number. */
export const SEASON_PALETTES: Record<Season, string[]> = {
  spring: ['#8fd14f', '#a6dc5e', '#79c043', '#c2e36c'],
  summer: ['#3f8a2e', '#2f7a2b', '#4f9a35', '#37702a'],
  autumn: ['#d9772b', '#e0b32f', '#c23f25', '#7a5230'],
  // (Winter leaves: frosted dark evergreen and the dry brown of oak leaves that hang on; snow on top comes from Snow.)
  winter: ['#4d6150', '#6e6150', '#7d8a84', '#3f5443'],
};
/**
 * Grass takes the season as one colour, not a palette: fresh in spring, deep green in summer, golden in autumn, and the
 * dead straw of winter grass (not white: snow covers grass, it doesn't turn it white).
 */
export const GRASS_SEASON: Record<Season, string> = { spring: '#7fae48', summer: '#5e8f38', autumn: '#a3974e', winter: '#9a8f6c' };
export const SEASON_ORDER: Season[] = ['spring', 'summer', 'autumn', 'winter'];

export function seasonPalette(s: Season): [number, number, number][] { return SEASON_PALETTES[s].map(hexRgb); }

/** Seasons blend through time at `speed` (seasons per minute), or by the Amount setting when held. */
export function seasonAt(c: SeasonCfg, minutes: number): { a: Season; b: Season; blend: number } {
  if (c.speed > 0) {
    const t = minutes * c.speed + SEASON_ORDER.indexOf(c.season) + c.blend;
    const i = Math.floor(t);
    return { a: SEASON_ORDER[((i % 4) + 4) % 4], b: SEASON_ORDER[(((i + 1) % 4) + 4) % 4], blend: t - i };
  }
  return { a: c.season, b: c.next, blend: Math.max(0, Math.min(1, c.blend)) };
}
