// Sky and day/night cycle shared by both apps: the time of day (0-24 h) gives the sun direction, light colours
// and how dark it is. GameCraft draws a physical sky dome with a moving sun and stars; LogicCraft tints the
// stage background. The runtime advances the time when the cycle is on.

export interface SkySettings {
  enabled: boolean;
  /** Hours, 0-24 (12 = noon). */
  time: number;
  /** Advance the time while playing. */
  cycle: boolean;
  /** Real seconds for a full 24 h day. */
  dayLength: number;
  /** Sun strength multiplier (1 = normal daylight). */
  sunStrength: number;
  /** Compass direction the sun rises from (degrees). */
  sunAzimuth: number;
  stars: boolean;
  /** Haze 1-10 (Blender "Nishita"-like turbidity). */
  haze: number;
  /** A picture for the sun (asset id; its transparent parts show the sky), and its size across in degrees (default 3). */
  sunTexture?: string; sunSize?: number;
  /** The moon (opposite the sun, at night): a picture (asset id) or the built-in one, its size in degrees (default 3). */
  moon?: boolean; moonTexture?: string; moonSize?: number;
}

export const DEFAULT_SKY: SkySettings = { enabled: false, time: 10, cycle: false, dayLength: 240, sunStrength: 1, sunAzimuth: 120, stars: true, haze: 3 };

/** Clouds in the sky: a marched volume and/or soft fog-particle billboards (engine: cloudLayer.ts). */
export interface CloudSettings {
  /** How much of the sky (0..1). */ coverage: number;
  /** Bottom of the layer, and how deep it is, in metres. */ base: number; thickness: number;
  /** Size of a typical cloud, in metres. */ scale: number;
  /** How solid (0..2). */ density: number;
  /** March steps: more is finer and slower. */ steps: number;
  style: 'volumetric' | 'particles' | 'both';
  /** Fog particles, in thousands. */ puffs: number;
  /** Half the width of the sky filled round the camera, in metres. */ span?: number;
  /** Wind, metres a second. */ windX?: number; windZ?: number;
  /** Shapes: heaped (cumulus), flat sheets (stratus), thin streaks (cirrus), tall towers, or a mix by region. */ kind?: 'mixed' | 'cumulus' | 'stratus' | 'cirrus' | 'towering';
  /** How much clouds differ from place to place: size, height, how full the sky is (0 all alike .. 1). */ variety?: number;
  /** Moves the whole pattern: another sky. */ seed?: number;
}
export const cloudDefaults = (): CloudSettings => ({ coverage: 0.45, base: 220, thickness: 120, scale: 420, density: 1, steps: 28, style: 'both', puffs: 6, span: 1600, windX: 3, windZ: 1 });

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const mix = (a: [number, number, number], b: [number, number, number], t: number): [number, number, number] => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
export const toHex = (c: [number, number, number]) => '#' + c.map((v) => Math.round(clamp01(v) * 255).toString(16).padStart(2, '0')).join('');

export interface SkyState {
  /** Sun height above the horizon in degrees (-90..90) and its compass direction. */
  elevation: number; azimuth: number;
  /** 0 = full day, 1 = full night. */
  night: number;
  /** Sunlight colour and strength factor (0 at night). */
  sunColor: [number, number, number]; sunIntensity: number;
  /** Sky / ambient colour, horizon colour (sunsets) and ambient strength factor. */
  skyColor: [number, number, number]; horizonColor: [number, number, number]; ambient: number;
}

const DAY: [number, number, number] = [0.42, 0.66, 0.96];
const NIGHT: [number, number, number] = [0.02, 0.03, 0.08];
const SUNSET: [number, number, number] = [0.98, 0.52, 0.26];

export function skyState(s: SkySettings): SkyState {
  const t = (((s.time % 24) + 24) % 24);
  // Sun rises at 6:00, peaks at 12:00 (70°), sets at 18:00.
  const elevation = Math.sin(((t - 6) / 12) * Math.PI) * 70;
  const azimuth = s.sunAzimuth + ((t - 6) / 12) * 180;
  const day = clamp01((elevation + 6) / 18); // civil twilight blend
  const low = clamp01(1 - Math.abs(elevation) / 14); // near the horizon: sunset colours
  const sunColor = mix([1, 0.97, 0.9], SUNSET, low);
  const skyColor = mix(NIGHT, DAY, day);
  const horizonColor = mix(skyColor, SUNSET, low * day * 0.9 + low * 0.1);
  return {
    elevation, azimuth, night: 1 - day,
    sunColor, sunIntensity: clamp01(elevation / 10) * s.sunStrength,
    skyColor, horizonColor, ambient: lerp(0.08, 1, day),
  };
}

export const isNight = (s: SkySettings) => skyState(s).elevation < -2;
