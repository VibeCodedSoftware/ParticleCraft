// A world's water as GameCraft's water options (Material > Surface: Water): WorldCraft's view and its export use the same
// values, drawn by the same shader, so the two look alike.
import type { WaterCfg } from './document';

/** `size` is how wide the surface is: its mesh has 160 cells a side, and waves shorter than a few cells would only alias. */
export function waterOptions(w: WaterCfg, size: number) {
  const cell = size / 160;
  return {
    waves: w.waves > 0, waveHeight: w.waves * 0.6, waveLength: Math.max(8 + w.waves * 10, cell * 3.5), waveSpeed: w.waveSpeed, waveDirection: w.waveDirection,
    waveLayers: 3, waveSeed: w.waveSeed ?? 0, turbulence: w.turbulence ?? 0.15, detail: w.detail ?? 1, highlights: w.highlights ?? 1.2,
    foam: w.foam, foamWidth: w.foamWidth ?? 0.9, foamColor: '#ffffff', deepColor: w.deepColor ?? '#0b3a66', clarity: w.clarity ?? 7, toonFoam: 0,
  };
}

/**
 * Rivers and lakes: exactly the sea's water (colour, depth colour, ripples, foam, highlights), so all of it is one water.
 * Only how far waves lift the surface is kept small, as a river's strip has few vertices to bend. And as rivers and
 * lakes are only a few metres deep: the deep colour is reached within their depth (else a shallow river reads pale
 * and a deeper lake dark, two different waters), and the shore foam is a narrow line at the very edge (else the foam
 * meant for the shallows lies in lacy white blotches all over them).
 */
export function riverOptions(w: WaterCfg) {
  const o = waterOptions(w, 400);
  return { ...o, waves: true, waveHeight: Math.min(o.waveHeight, 0.06), wakes: false, clarity: Math.min(o.clarity, 2.5), foamWidth: Math.min(o.foamWidth, 0.3) };
}

/** GameCraft's default water ripples (Material › Ripples): strength, speed and metres per repeat of the ripple picture. */
export const WATER_RIPPLES = { strength: 0.6, speed: 1, metres: 5 };
