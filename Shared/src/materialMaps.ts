// Per-property texture inputs of a material (Base colour, Normal, Roughness, Metallic, Height, AO, Emission, Opacity): each slot
// has its own image, tiling, offset and rotation, an optional seeded random tiling (breaks visible repetition), and
// an optional animation (sprite-sheet / GIF frames, plus procedural scrolling and spinning).

export type MapSlot = 'color' | 'normal' | 'roughness' | 'metalness' | 'height' | 'ao' | 'emission' | 'opacity';
export const MAP_SLOTS: { slot: MapSlot; label: string; three: string; srgb: boolean }[] = [
  { slot: 'color', label: 'Base color', three: 'map', srgb: true },
  { slot: 'normal', label: 'Normal', three: 'normalMap', srgb: false },
  { slot: 'roughness', label: 'Roughness', three: 'roughnessMap', srgb: false },
  { slot: 'metalness', label: 'Metallic', three: 'metalnessMap', srgb: false },
  // Height is drawn as a bump map (the light follows the relief; the shape itself stays flat).
  { slot: 'height', label: 'Height', three: 'bumpMap', srgb: false },
  { slot: 'ao', label: 'Ambient occlusion', three: 'aoMap', srgb: false },
  { slot: 'emission', label: 'Emission', three: 'emissiveMap', srgb: true },
  { slot: 'opacity', label: 'Opacity', three: 'alphaMap', srgb: false },
];

export interface TexSlot {
  /** Texture asset id. */
  asset: string;
  /** Repeats across the surface; 0 = automatic (about one repeat every 2 m of the object's size). */
  tiling: [number, number];
  offset: [number, number];
  /** Degrees. */
  rotation: number;
  /** Animation: `frames` laid out cols × rows played at fps (0 frames = a still image), plus scrolling and spin. */
  animated?: { frames: number; cols: number; rows: number; fps: number; scroll: [number, number]; spin: number };
}

/**
 * Random tiling (material-wide, so colour, normal and roughness stay aligned): every tile cell gets a seeded
 * quarter-turn and shift, so repeats don't line up. amount 0..1 scales the shift.
 */
export interface RandomTiling {
  seed: number; amount: number; /** Each object gets its own arrangement (seed mixed with the object). */ perObject?: boolean;
  /** cells = each tile turned and shifted (sharp, can show seams); blend = seamless: overlapping randomly turned
   *  copies mixed smoothly (hex-tiling), no seams and no visible repeats. */
  mode?: 'cells' | 'blend';
}

export const newSlot = (asset: string): TexSlot => ({ asset, tiling: [0, 0], offset: [0, 0], rotation: 0 });
export const newAnimation = (frames = 0, cols = 1, rows = 1, fps = 12): NonNullable<TexSlot['animated']> => ({ frames, cols, rows, fps, scroll: [0, 0], spin: 0 });

/**
 * A slot's picture changed. UV and scrolling stay; the old picture's frame layout doesn't, or the new one would be cut
 * into frames that aren't there. `sheet`: the new picture's own frames, when it is a sprite sheet or GIF.
 */
export function replaceSlotImage(prev: TexSlot | undefined, asset: string, sheet?: { frames: number; rows: number; fps: number }): TexSlot {
  const out: TexSlot = { ...(prev ?? newSlot(asset)), asset };
  if (sheet) out.animated = { ...newAnimation(sheet.frames, Math.ceil(sheet.frames / Math.max(1, sheet.rows)), sheet.rows, sheet.fps), scroll: prev?.animated?.scroll ?? [0, 0], spin: prev?.animated?.spin ?? 0 };
  else if (prev?.animated) {
    const a = prev.animated;
    if (a.scroll[0] || a.scroll[1] || a.spin) out.animated = { ...a, frames: 0, cols: 1, rows: 1 }; else delete out.animated;
  }
  return out;
}

/** The slots of a material, with the older single `map` (base colour, automatic tiling) folded in. */
export function materialSlots(m: { map?: string; maps?: Partial<Record<MapSlot, TexSlot>> } | undefined): Partial<Record<MapSlot, TexSlot>> {
  const out: Partial<Record<MapSlot, TexSlot>> = { ...(m?.maps ?? {}) };
  if (m?.map && !out.color) out.color = newSlot(m.map);
  return out;
}

/** Repeats for a slot on an object of scale (sx, sy, sz): its own tiling, or about one repeat every 2 m. */
export function slotRepeat(s: TexSlot, sx: number, sy: number, sz: number): [number, number] {
  const auto: [number, number] = [Math.max(1, Math.abs(sx) / 2), Math.max(1, Math.max(Math.abs(sy), Math.abs(sz)) / 2)];
  return [s.tiling[0] > 0 ? s.tiling[0] : auto[0], s.tiling[1] > 0 ? s.tiling[1] : auto[1]];
}

/**
 * UV transform of a slot at time t (seconds): repeat, offset, rotation (radians) and, when animated, the frame
 * window inside the sheet. The frame window is folded into repeat/offset: one frame covers the whole tile.
 */
export function slotTransform(s: TexSlot, repeat: [number, number], t: number): { repeat: [number, number]; offset: [number, number]; rotation: number; frame: number } {
  const a = s.animated;
  const frames = a && a.frames > 1 ? a.frames : 1;
  const frame = frames > 1 ? Math.floor(t * Math.max(0, a!.fps)) % frames : 0;
  const cols = a && frames > 1 ? Math.max(1, a.cols) : 1, rows = a && frames > 1 ? Math.max(1, a.rows) : 1;
  const fc = frame % cols, fr = Math.floor(frame / cols);
  const scroll = a ? [a.scroll[0] * t, a.scroll[1] * t] : [0, 0];
  return {
    repeat: [repeat[0] / cols, repeat[1] / rows],
    // Sheets read top-down: row 0 is the top row of the image (v = 1 - 1/rows).
    offset: [(s.offset[0] + scroll[0]) / cols + fc / cols, (s.offset[1] + scroll[1]) / rows + (rows - 1 - fr) / rows],
    rotation: ((s.rotation + (a ? a.spin * t : 0)) * Math.PI) / 180,
    frame,
  };
}

// ---- PBR material sets: texture files that belong together (carpet_basecolor.png, carpet_normal.png, …)
const SUFFIX: [RegExp, MapSlot | 'ao'][] = [
  [/(base[_ -]?colou?r|albedo|diffuse|diff|colou?r|col|basecol)$/i, 'color'],
  [/(normal[_ -]?(gl|dx)?|nrm|nor|norm)$/i, 'normal'],
  [/(roughness|rough|rgh)$/i, 'roughness'],
  [/(metallic|metalness|metal|met)$/i, 'metalness'],
  [/(ambient[_ -]?occlusion|occlusion|ao)$/i, 'ao'],
  [/(height|displacement|disp|bump)$/i, 'height'],
  [/(emission|emissive|emit|glow)$/i, 'emission'],
  [/(opacity|alpha|mask)$/i, 'opacity'],
];
export interface PbrSet { name: string; folder: string; maps: Partial<Record<MapSlot | 'ao', string>> }

/**
 * Group texture files into PBR material sets by folder + base name + map suffix. A set needs a base colour map and
 * at least one other map; lone pictures stay plain textures.
 */
export function groupPbrSets(files: { id: string; path: string }[]): PbrSet[] {
  const sets = new Map<string, PbrSet>();
  for (const f of files) {
    const slash = f.path.lastIndexOf('/');
    const folder = slash >= 0 ? f.path.slice(0, slash) : '';
    const stem = f.path.slice(slash + 1).replace(/\.[^.]+$/, '');
    for (const [re, slot] of SUFFIX) {
      const m = re.exec(stem);
      if (!m) continue;
      const base = stem.slice(0, m.index).replace(/[_ .-]+$/, '');
      if (!base) break;
      const key = folder + '/' + base.toLowerCase();
      const set = sets.get(key) ?? { name: base, folder, maps: {} };
      if (!set.maps[slot]) set.maps[slot] = f.id;
      sets.set(key, set);
      break;
    }
  }
  return [...sets.values()].filter((s) => s.maps.color && Object.keys(s.maps).length >= 2).sort((a, b) => a.name.localeCompare(b.name));
}

/** Deterministic per-cell random (0..1) for random tiling; mirrors the shader's hash. */
export function cellRandom(cx: number, cy: number, seed: number): number {
  const x = Math.sin(cx * 127.1 + cy * 311.7 + seed * 74.7) * 43758.5453;
  return x - Math.floor(x);
}
