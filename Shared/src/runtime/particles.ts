// CPU particle simulation shared by both apps. Renderers only read the particle buffers, so particles
// are real emitters driven by logic blocks - not sprites or pre-recorded animations.
//
// ParticleCraft 2.0 adds (all optional, so effects saved before keep playing exactly as they did): more emitter
// shapes and burst cycles, a stack of combinable forces, colliders and kill volumes, curves and gradients over life,
// per-particle random colour/rotation, sub-emitters (birth / death / collision / tick events into other layers),
// flipbook playback with lifetime stretching, holds, section loops and frame blending, and rendering hints
// (renderer type, style, blend mode, glow…) that each renderer reproduces as far as it can.
import { Rng } from './rng';
import { curl3, fbm3 } from './noise';

export type V3 = [number, number, number];

/** A curve over 0..1 (particle life, emitter loop…): sorted [t, value] points. */
export interface Curve { p: [number, number][]; mode?: 'linear' | 'smooth' | 'step' }
/** A colour gradient over 0..1: hex colour and optional alpha per stop. */
export interface GradientStop { t: number; c: string; a?: number }

export type Force =
  | { type: 'attract'; pos: V3; strength: number; radius: number; falloff?: 'none' | 'linear' | 'smooth'; killRadius?: number }
  | { type: 'orbit'; pos: V3; axis: V3; speed: number; pull: number }
  | { type: 'curl'; strength: number; frequency: number; speed?: number }
  | { type: 'noise'; strength: number; frequency: number; speed?: number; octaves?: number }
  | { type: 'wind'; direction: V3; speed: number; coupling: number; gust: number; gustFreq: number }
  | { type: 'airResistance'; amount: number }
  | { type: 'random'; strength: number }
  | { type: 'directional'; direction: V3; strength: number; curve?: Curve }
  | { type: 'follow'; pos: V3; strength: number; maxSpeed: number; arrive?: number; kill?: boolean }
  | { type: 'path'; points: number[]; strength: number; speed: number; radius: number; loop?: boolean }
  | { type: 'speedLimit'; max: number; min?: number };

export type Collider =
  | { type: 'plane'; point: V3; normal: V3; bounce: number; friction: number; kill?: boolean; lifeLoss?: number; stick?: number }
  | { type: 'sphere'; center: V3; radius: number; inside?: boolean; bounce: number; friction: number; kill?: boolean; lifeLoss?: number };

export interface KillVolume { shape: 'box' | 'sphere' | 'below'; center: V3; size: V3; inside: boolean }

/** Spawn particles of another layer (by index) when something happens to this layer's particles. */
export interface SubEmitter { on: 'birth' | 'death' | 'collide' | 'tick'; layer: number; count: number; interval?: number; inherit: number; chance: number }

export interface FlipbookParams {
  cols: number; rows: number; frames: number;
  /** lifetime: the animation is stretched over each particle's life (`cycles` plays). fps: plays at `fps`. */
  mode: 'lifetime' | 'fps'; fps: number; cycles: number;
  loop: 'loop' | 'once' | 'pingpong';
  reverse?: boolean;
  startFrame?: number; randomStart?: boolean;
  /** ± fraction of random playback speed per particle. */
  speedVar?: number;
  /** Seconds before the animation starts (the start frame is held). */
  delay?: number;
  /** Loop only frames [loopStart, loopEnd]: earlier frames play once as an intro; with `outro` the later ones play at the end of life. */
  loopStart?: number; loopEnd?: number; outro?: boolean;
  /** Hold chosen frames longer (extra time in frames). */
  holds?: { frame: number; extra: number }[];
  /** Remaps life (0..1) to animation progress (0..1) in lifetime mode: fast start / slow end, etc. */
  curve?: Curve;
  /** Cross-fade between neighbouring frames. */
  blend?: boolean;
  /** After a 'once' animation ends: keep the last frame, or hide the particle. */
  end?: 'hold' | 'hide';
  /** Grayscale frames packed in R, G and B (3 × frames). */
  channelPacked?: boolean;
  /** Sheet margin and gap between frames, as fractions of the sheet's width / height. */
  margin?: [number, number]; gap?: [number, number];
  /** Custom frame order: playback frame k shows sheet frame order[k] (repeats allowed). */
  order?: number[];
}

export interface MaterialParams {
  /** Normal map (data URL, same layout as the colour texture) for lit particles. */
  normalMap?: string;
  /** Extra emissive texture and its strength. */
  emissionMap?: string; emissionColor?: string; emissionStrength?: number;
  /** Alpha mask texture (red channel), multiplies opacity. */
  alphaMap?: string;
  /** Colour from the texture's brightness through a gradient (fire from grayscale flipbooks). */
  gradientMap?: GradientStop[];
  /** Brighter rim (fake fresnel) on lit/volumetric particles. */
  rim?: number; rimColor?: string;
  /** Dissolve by a noise threshold over life (0 = off), with a glowing edge. */
  dissolve?: number; dissolveEdge?: number; dissolveColor?: string; dissolveCurve?: Curve;
  /** Metallic / roughness for lit particles (specular highlight). */
  metallic?: number; roughness?: number;
  /** Motion-vector texture for flipbook frame blending (RG = UV offset). */
  motionVectors?: string; motionStrength?: number;
  /** Height map: lighting is computed from its slopes when there is no normal map. */
  heightMap?: string;
  /** Base colour tint and opacity (transparency) of the surface. */
  baseColor?: string; opacity?: number;
  /** Refraction: bends what is behind by the surface normal (normal / height map, or a sphere). */
  refraction?: number;
}

export interface EmitterParams {
  rate: number; // particles per second while emitting
  burst: number; // particles emitted once on start
  lifetime: number; lifetimeVar: number;
  speed: number; speedVar: number;
  direction: [number, number, number];
  spread: number; // cone half-angle in degrees (180 = sphere)
  gravity: number; // m/s² along Y (negative falls)
  acceleration: [number, number, number];
  drag: number;
  sizeStart: number; sizeEnd: number; sizeVar: number;
  colorStart: string; colorEnd: string;
  alphaStart: number; alphaEnd: number;
  /** Fraction of the life spent fading in from transparent (0 = born at full start opacity). */
  fadeIn?: number;
  rotation: number; rotationSpeed: number;
  shape: 'point' | 'sphere' | 'box' | 'circle' | 'cone' | 'mesh' | 'ring' | 'hemisphere' | 'line' | 'path';
  shapeSize: [number, number, number];
  /** shape 'mesh': sampled points of a shape node, 6 numbers each (position, then normal or edge direction). */
  meshPoints?: number[];
  /** Per mesh point RGB (0..1), e.g. spawn from an image: particles take the pixel colour. */
  meshColors?: number[];
  /** Starting speed along each point's direction (outward from the surface; along the edge, either way). */
  meshOutward?: number;
  /** Shape points are edge samples (directions are along the edge, so both ways are used). */
  meshEdges?: boolean;
  /** Pull back onto the shape (0 = free): particles crawl over the surface / along the edges. */
  cling?: number;
  maxParticles: number;
  texture: 'circle' | 'square' | 'spark' | 'smoke' | 'star' | 'debris' | 'ring' | 'glow' | 'pixel' | 'flare' | 'drop' | 'leaf';
  /** The effect's own picture as a data URL, drawn instead of the built-in shape. */
  textureImage?: string;
  blending: 'additive' | 'normal';
  space: 'world' | 'local';
  looping: boolean;
  duration: number; // seconds of emission for non-looping emitters
  seed: number;
  collideFloor: boolean; floorY: number; bounce: number;
  /** Smooth noise force (swirl / flicker) and its spatial frequency. */
  turbulence: number; turbulenceFreq: number;
  /** Swirl around the emitter's up axis (tornadoes, portals); pull > 0 draws particles inward. */
  vortex: number; vortexPull: number;
  /** Optional middle color of the color-over-life gradient ('' = start → end). */
  colorMid: string;
  /** Streak length in seconds of motion (drawn by 2D renderers). */
  trail: number;

  // ---------------------------------------------------------------- 2.0 additions (all optional)
  /** Emit only from the shape's surface (sphere / box / circle edge). */
  emitShell?: boolean;
  /** Ring / tube thickness (fraction of the radius) for 'ring'. */
  ringThickness?: number;
  /** 'path' shape: polyline points (x, y, z…), spawn spread evenly along its length. */
  pathPoints?: number[];
  /** Initial velocity points away from the shape centre (explosions from a sphere) with this speed. */
  radialSpeed?: number;
  /** Repeating bursts: count at `time` s, then every `interval` s for `cycles` times (per loop). */
  bursts?: { time: number; count: number; cycles: number; interval: number; chance?: number }[];
  /** Seconds before the layer starts (timeline offset inside the effect). */
  delay?: number;
  /** Local playback speed of this layer. */
  timeScale?: number;
  /** Simulated seconds before the first frame (looping effects start full). */
  prewarm?: number;
  /** Emission rate multiplier over the emitter's duration (0..1 = one loop). */
  rateCurve?: Curve;
  /** Emitter transform inside the effect. */
  offset?: V3; emitterRotation?: V3; emitterScale?: number;
  /** Random start angle range (± degrees) and spin speed range. */
  rotationVar?: number; spinVar?: number; spinDirection?: 'random' | 'cw' | 'ccw';
  /** Align the start angle with the start velocity (sparks, streaks). */
  alignToVelocity?: boolean;
  /** Each particle picks (or blends between) these colours; multiplies colour over life. */
  randomColors?: string[]; randomColorBlend?: boolean;
  /** Over-life curves (t = 0..1 of each particle's life). */
  sizeCurve?: Curve; alphaCurve?: Curve; rotationCurve?: Curve; speedCurve?: Curve; glowCurve?: Curve;
  /** Separate width/height scale over life (stretch squash). */
  stretchCurve?: Curve;
  /** Colour gradient over life (replaces start/middle/end colours when set). */
  gradient?: GradientStop[];
  forces?: Force[];
  colliders?: Collider[];
  killVolumes?: KillVolume[];
  subEmitters?: SubEmitter[];
  flipbook?: FlipbookParams;
  material?: MaterialParams;
  /** Trail renderer: number of history samples and seconds between them. */
  trailPoints?: number; trailInterval?: number;
  // Rendering hints (each renderer reproduces what it can)
  renderer?: 'billboard' | 'stretched' | 'horizontal' | 'vertical' | 'point' | 'mesh' | 'ribbon' | 'trail' | 'volumetric';
  style?: 'smooth' | 'basic' | 'pixel' | 'lowpoly' | 'cartoon' | 'stylized' | 'textured' | 'realistic' | 'volumetric' | 'sprite' | 'image';
  blendMode?: 'additive' | 'alpha' | 'premultiplied' | 'multiply' | 'screen';
  /** Extra halo around each particle (0 = none) and its size multiple. */
  glow?: number; glowSize?: number; glowColor?: string;
  /** Colour intensity multiplier (HDR-ish emission, feeds bloom). */
  emission?: number;
  /** Soft particles: fade near the ground plane / camera over this distance (0 = hard). */
  softness?: number;
  filter?: 'linear' | 'nearest';
  /** Pixel-art resolution of each particle (texels across). */
  pixelSize?: number;
  /** Velocity stretch factor for the stretched renderer. */
  stretch?: number;
  meshShape?: 'cube' | 'tetra' | 'octa' | 'shard' | 'ico' | 'plane';
  /** Ribbon / trail width multiplier and taper. */
  ribbonWidth?: number; ribbonTaper?: boolean;
  /** Screen distortion strength (heat haze, shockwaves). */
  distortion?: number;
  /** Only bend the scene (no colour of its own). */
  distortionOnly?: boolean;
  /** Lighting amount for lit / volumetric particles (0..1) and direction. */
  lit?: number; lightDir?: V3;
  /** Draw order among the effect's layers (higher on top for unsorted modes). */
  sortOrder?: number;
  /** Cut-out alpha threshold (pixel art / cartoon). */
  alphaClip?: number;
  /** Texture UV transform. */
  uv?: { scale: [number, number]; offset: [number, number]; rotation: number; flipX?: boolean; flipY?: boolean; scroll?: [number, number] };
  /** Outline for cartoon style (px) and colour. */
  outline?: number; outlineColor?: string;
}

export const DEFAULT_EMITTER: EmitterParams = {
  rate: 30, burst: 0, lifetime: 1.2, lifetimeVar: 0.3, speed: 3, speedVar: 1, direction: [0, 1, 0], spread: 25,
  gravity: 0, acceleration: [0, 0, 0], drag: 0, sizeStart: 0.25, sizeEnd: 0.05, sizeVar: 0.05,
  colorStart: '#ffd27a', colorEnd: '#ff5a1f', alphaStart: 1, alphaEnd: 0, rotation: 0, rotationSpeed: 0,
  shape: 'point', shapeSize: [0.2, 0.2, 0.2], maxParticles: 500, texture: 'circle', blending: 'additive', space: 'world',
  looping: true, duration: 1, seed: 7, collideFloor: false, floorY: 0, bounce: 0.3,
  turbulence: 0, turbulenceFreq: 1, vortex: 0, vortexPull: 0, colorMid: '', trail: 0,
};

const P = (o: Partial<EmitterParams>): EmitterParams => ({ ...DEFAULT_EMITTER, ...o });
export const PARTICLE_PRESETS: Record<string, { name: string; params: EmitterParams }> = {
  fire: { name: 'Fire', params: P({ rate: 60, lifetime: 0.9, speed: 1.6, spread: 15, gravity: 2, sizeStart: 0.45, sizeEnd: 0.05, colorStart: '#ffcc55', colorEnd: '#ff2200', shape: 'circle', shapeSize: [0.3, 0, 0.3], texture: 'smoke' }) },
  smoke: { name: 'Smoke', params: P({ rate: 18, lifetime: 3, lifetimeVar: 0.8, speed: 0.8, spread: 20, gravity: 0.6, drag: 0.4, sizeStart: 0.4, sizeEnd: 1.6, colorStart: '#7a7a7a', colorEnd: '#3a3a3a', alphaStart: 0.55, blending: 'normal', texture: 'smoke', rotationSpeed: 30 }) },
  sparks: { name: 'Sparks', params: P({ rate: 40, lifetime: 0.6, speed: 6, speedVar: 2, spread: 60, gravity: -12, sizeStart: 0.08, sizeEnd: 0.02, colorStart: '#fff2a8', colorEnd: '#ff7a00', texture: 'spark', collideFloor: true }) },
  dust: { name: 'Dust', params: P({ rate: 12, lifetime: 1.4, speed: 0.6, spread: 80, gravity: 0.2, drag: 1, sizeStart: 0.2, sizeEnd: 0.6, colorStart: '#c9b28a', colorEnd: '#a08a66', alphaStart: 0.5, blending: 'normal', texture: 'smoke' }) },
  rain: { name: 'Rain', params: P({ rate: 400, lifetime: 1.2, speed: 14, speedVar: 2, direction: [0, -1, 0], spread: 3, sizeStart: 0.05, sizeEnd: 0.05, colorStart: '#9ec9ff', colorEnd: '#9ec9ff', alphaStart: 0.7, alphaEnd: 0.6, shape: 'box', shapeSize: [30, 0, 30], maxParticles: 1500, blending: 'normal', texture: 'spark', collideFloor: true, bounce: 0 }) },
  snow: { name: 'Snow', params: P({ rate: 120, lifetime: 6, speed: 1.2, direction: [0, -1, 0], spread: 20, drag: 0.3, sizeStart: 0.12, sizeEnd: 0.12, colorStart: '#ffffff', colorEnd: '#e8f0ff', alphaEnd: 0.8, shape: 'box', shapeSize: [30, 0, 30], maxParticles: 1200, blending: 'normal', rotationSpeed: 40 }) },
  magic: { name: 'Magic sparkle', params: P({ rate: 45, lifetime: 1.1, speed: 1.2, spread: 180, gravity: 0.8, sizeStart: 0.18, sizeEnd: 0, colorStart: '#d9a6ff', colorEnd: '#4fd2ff', shape: 'sphere', shapeSize: [0.5, 0.5, 0.5], texture: 'star', rotationSpeed: 180 }) },
  blood: { name: 'Blood burst', params: P({ rate: 0, burst: 26, looping: false, duration: 0.05, lifetime: 0.85, lifetimeVar: 0.25, speed: 3.6, speedVar: 2, spread: 50, direction: [0, 1, 0], gravity: -13, sizeStart: 0.075, sizeEnd: 0.055, colorStart: '#b01018', colorEnd: '#b01018', alphaStart: 1, alphaEnd: 1, blending: 'normal', texture: 'square', collideFloor: true, bounce: 0 }) },
  explosion: { name: 'Explosion', params: P({ rate: 0, burst: 120, looping: false, duration: 0.1, lifetime: 0.9, speed: 9, speedVar: 4, spread: 180, gravity: -4, drag: 2.5, sizeStart: 0.7, sizeEnd: 0.1, colorStart: '#fff1b0', colorEnd: '#ff3d00', texture: 'smoke' }) },
  coin: { name: 'Coin collection', params: P({ rate: 0, burst: 40, looping: false, duration: 0.05, lifetime: 0.7, speed: 4, spread: 180, gravity: -6, sizeStart: 0.16, sizeEnd: 0, colorStart: '#fff6a0', colorEnd: '#ffb300', texture: 'star', rotationSpeed: 360 }) },
  muzzle: { name: 'Weapon muzzle flash', params: P({ rate: 0, burst: 18, looping: false, duration: 0.02, lifetime: 0.12, lifetimeVar: 0.04, speed: 7, spread: 18, direction: [1, 0, 0], sizeStart: 0.25, sizeEnd: 0.05, colorStart: '#fffbe0', colorEnd: '#ff9a2a', texture: 'spark' }) },
  sword: { name: 'Sword impact', params: P({ rate: 0, burst: 30, looping: false, duration: 0.02, lifetime: 0.35, speed: 6, spread: 70, gravity: -8, sizeStart: 0.12, sizeEnd: 0.02, colorStart: '#e8f6ff', colorEnd: '#5ab4ff', texture: 'spark' }) },
  footsteps: { name: 'Footsteps', params: P({ rate: 0, burst: 8, looping: false, duration: 0.02, lifetime: 0.6, speed: 0.8, spread: 70, gravity: -1, drag: 2, sizeStart: 0.12, sizeEnd: 0.3, colorStart: '#b8a68a', colorEnd: '#8d7b62', alphaStart: 0.6, blending: 'normal', texture: 'smoke' }) },
  dirt: { name: 'Digging dirt', params: P({ rate: 0, burst: 45, looping: false, duration: 0.05, lifetime: 1.0, speed: 4.5, speedVar: 1.5, spread: 35, gravity: -14, sizeStart: 0.16, sizeEnd: 0.1, colorStart: '#7a5230', colorEnd: '#4a321c', blending: 'normal', texture: 'debris', collideFloor: true, bounce: 0.2, rotationSpeed: 200 }) },
  teleport: { name: 'Teleportation', params: P({ rate: 90, lifetime: 0.9, speed: 2.5, direction: [0, 1, 0], spread: 5, sizeStart: 0.14, sizeEnd: 0, colorStart: '#7df9ff', colorEnd: '#5a3bff', shape: 'circle', shapeSize: [0.6, 0, 0.6], texture: 'star', looping: false, duration: 0.8 }) },
  debris: { name: 'Low-poly debris', params: P({ rate: 0, burst: 24, looping: false, duration: 0.05, lifetime: 1.6, speed: 6, speedVar: 2, spread: 60, gravity: -16, sizeStart: 0.25, sizeEnd: 0.2, colorStart: '#d0463b', colorEnd: '#7a1f18', blending: 'normal', texture: 'debris', collideFloor: true, bounce: 0.35, rotationSpeed: 300 }) },
};

/** Exposed parameters of imported ParticleCraft effects (effect name -> controls), registered by the hosts. */
export const customVfxExposed = new Map<string, { name: string; targets: { layer: number; param: string }[] }[]>();

// ------------------------------------------------------------------ curves & gradients

/** Value of a curve at t (clamped to its ends). */
export function evalCurve(c: Curve | undefined, t: number, fallback = 1): number {
  const p = c?.p;
  if (!p || !p.length) return fallback;
  if (t <= p[0][0]) return p[0][1];
  const last = p[p.length - 1];
  if (t >= last[0]) return last[1];
  let k = 1;
  while (k < p.length && p[k][0] < t) k++;
  const [t0, v0] = p[k - 1], [t1, v1] = p[k];
  if (c!.mode === 'step') return v0;
  let u = t1 > t0 ? (t - t0) / (t1 - t0) : 0;
  if (c!.mode === 'smooth') u = u * u * (3 - 2 * u);
  return v0 + (v1 - v0) * u;
}

const rgbCache = new Map<string, [number, number, number]>();
export function hexToRgb(hex: string): [number, number, number] {
  const hit = rgbCache.get(hex);
  if (hit) return hit;
  const h = (hex || '#ffffff').replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h.padEnd(6, '0').slice(0, 6), 16) || 0;
  const v: [number, number, number] = [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  if (rgbCache.size > 4096) rgbCache.clear();
  rgbCache.set(hex, v);
  return v;
}
export function mixColor(a: string, b: string, t: number): [number, number, number] {
  const A = hexToRgb(a), B = hexToRgb(b);
  return [A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t];
}
/** Gradient colour and alpha at t. */
export function evalGradient(g: GradientStop[], t: number): [number, number, number, number] {
  if (!g.length) return [1, 1, 1, 1];
  if (t <= g[0].t) { const c = hexToRgb(g[0].c); return [c[0], c[1], c[2], g[0].a ?? 1]; }
  const last = g[g.length - 1];
  if (t >= last.t) { const c = hexToRgb(last.c); return [c[0], c[1], c[2], last.a ?? 1]; }
  let k = 1;
  while (k < g.length && g[k].t < t) k++;
  const a = g[k - 1], b = g[k], u = b.t > a.t ? (t - a.t) / (b.t - a.t) : 0;
  const A = hexToRgb(a.c), B = hexToRgb(b.c);
  return [A[0] + (B[0] - A[0]) * u, A[1] + (B[1] - A[1]) * u, A[2] + (B[2] - A[2]) * u, (a.a ?? 1) + ((b.a ?? 1) - (a.a ?? 1)) * u];
}

// ------------------------------------------------------------------ flipbook timing

/** Frame unit table for holds: start offset of each frame in "frame units" and the total. */
/** Number of frames the playback steps through (custom order, or all frames; ×3 when channel-packed). */
export const playFrames = (fb: FlipbookParams) => (fb.order?.length ? fb.order.length : Math.max(1, Math.round(fb.frames) * (fb.channelPacked ? 3 : 1)));
function frameUnits(fb: FlipbookParams): { starts: Float32Array; total: number } {
  const n = playFrames(fb);
  const starts = new Float32Array(n + 1);
  let s = 0;
  for (let f = 0; f < n; f++) { starts[f] = s; s += 1 + Math.max(0, fb.holds?.find((h) => h.frame === f)?.extra ?? 0); }
  starts[n] = s;
  return { starts, total: s };
}
/** Frame (with fraction for blending) at a position in frame units. */
function unitToFrame(starts: Float32Array, n: number, u: number): number {
  let lo = 0, hi = n - 1;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (starts[m] <= u) lo = m; else hi = m - 1; }
  const len = starts[lo + 1] - starts[lo];
  // The fraction only ramps over the last unit of a held frame, so holds stay crisp.
  const into = u - starts[lo];
  return lo + Math.max(0, Math.min(0.999, into - (len - 1)));
}

/**
 * Flipbook frame of a particle (a float: the integer part is the frame, the fraction blends to the next one), or -1
 * when the particle should be hidden (a finished 'once' animation with end = 'hide').
 * age/life in seconds; r1, r2 are the particle's random numbers (start frame, speed).
 */
export function flipbookFrame(fb: FlipbookParams, age: number, life: number, r1: number, r2: number, table?: { starts: Float32Array; total: number }): number {
  const n = playFrames(fb);
  const { starts, total } = table ?? frameUnits(fb);
  const speed = Math.max(0.01, 1 + (r2 * 2 - 1) * (fb.speedVar ?? 0));
  const delay = Math.max(0, fb.delay ?? 0);
  const ta = age - delay;
  const start = fb.randomStart ? r1 * n : Math.max(0, Math.min(n - 1, fb.startFrame ?? 0));
  if (ta < 0) return fb.reverse ? n - 1 - Math.floor(start) : Math.floor(start);
  // Units elapsed and units per second.
  let u: number, ups: number;
  const activeLife = Math.max(0.001, life - delay);
  if (fb.mode === 'fps') { ups = Math.max(0.01, fb.fps) * speed; u = ta * ups; }
  else {
    const cyc = Math.max(0.01, fb.cycles || 1) * speed;
    ups = (total * cyc) / activeLife;
    const prog = fb.curve ? Math.max(0, evalCurve(fb.curve, Math.min(1, ta / activeLife), ta / activeLife)) : ta / activeLife;
    u = prog * total * cyc;
  }
  const hasSection = fb.loopStart != null && fb.loopEnd != null && fb.loopEnd >= fb.loopStart;
  let pos: number;
  if (hasSection) {
    const ls = Math.max(0, Math.min(n - 1, Math.round(fb.loopStart!))), le = Math.max(ls, Math.min(n - 1, Math.round(fb.loopEnd!)));
    const intro = starts[ls], loopLen = Math.max(0.001, starts[le + 1] - starts[ls]), outroLen = total - starts[le + 1];
    const remaining = (life - age) * ups;
    if (fb.outro && outroLen > 0 && remaining <= outroLen) pos = starts[le + 1] + (outroLen - remaining);
    else if (u < intro) pos = u;
    else pos = intro + ((u - intro) % loopLen);
    pos = Math.max(0, Math.min(total - 0.0001, pos));
  } else if (fb.loop === 'once') {
    if (u >= total) { if (fb.end === 'hide') return -1; pos = total - 0.0001; }
    else pos = u;
  } else if (fb.loop === 'pingpong') {
    const m = u % (2 * total);
    pos = m < total ? m : 2 * total - m - 0.0001;
  } else pos = u % total;
  let f = unitToFrame(starts, n, Math.max(0, pos));
  if (start) { const whole = Math.floor(f), frac = f - whole; f = ((whole + Math.floor(start)) % n) + frac; }
  // Reversed: the blend fraction still runs towards the next-higher frame, so n-1-f mixes the right pair.
  if (fb.reverse) f = Math.max(0, n - 1 - f);
  if (!fb.blend) f = Math.floor(f);
  return f;
}

// ------------------------------------------------------------------ emitter

type Mat3 = [number, number, number, number, number, number, number, number, number];
function eulerMat(r: V3 | undefined, s = 1): Mat3 | null {
  if ((!r || (!r[0] && !r[1] && !r[2])) && s === 1) return null;
  const [ax, ay, az] = (r ?? [0, 0, 0]).map((d) => (d * Math.PI) / 180);
  const cx = Math.cos(ax), sx = Math.sin(ax), cy = Math.cos(ay), sy = Math.sin(ay), cz = Math.cos(az), sz = Math.sin(az);
  // R = Rz * Ry * Rx (X applied first)
  return [
    cz * cy * s, (cz * sy * sx - sz * cx) * s, (cz * sy * cx + sz * sx) * s,
    sz * cy * s, (sz * sy * sx + cz * cx) * s, (sz * sy * cx - cz * sx) * s,
    -sy * s, cy * sx * s, cy * cx * s,
  ];
}

export class Emitter {
  params: EmitterParams;
  rng: Rng;
  /** Second random stream for 2.0 features, so effects made before keep their exact randomness. */
  rng2: Rng;
  count = 0;
  // Struct-of-arrays buffers (renderers read these directly).
  px: Float32Array; py: Float32Array; pz: Float32Array;
  vx: Float32Array; vy: Float32Array; vz: Float32Array;
  age: Float32Array; life: Float32Array; size: Float32Array; rot: Float32Array; rotv: Float32Array;
  /** Shape effects: index into meshPoints of the point each particle clings to. */
  anchor: Int32Array;
  /** Per-particle random numbers (flipbook start / speed, dissolve, colour pick). */
  rnd: Float32Array; rnd2: Float32Array;
  /** Per-particle colour multiplier (random colours, image spawn colours). */
  cr: Float32Array; cg: Float32Array; cb: Float32Array;
  /** Spawn order (ribbons connect particles in this order). */
  sid: Int32Array;
  /** Trail history (trailPoints samples per particle) and how many are filled. */
  hist?: Float32Array; histN?: Uint8Array; histHead = 0;
  emitting = true;
  elapsed = 0;
  /** Seconds since start including the layer's delay. */
  clock = 0;
  private carry = 0;
  private nextSid = 0;
  private warmed = false;
  private histClock = 0;
  position: [number, number, number] = [0, 0, 0];
  /** Heading of the attached object in degrees (rotates `direction` for muzzle flashes etc.). */
  heading = 0;
  plane: 'xy' | 'xz' = 'xz';
  attachedUid?: number;
  autoRemove = false;
  qualityScale = 1;
  /** The effect's other layers (by index) for sub-emitters; set by the host (see linkEmitters). */
  links?: Emitter[];
  /** Collision events this frame (for hosts / tests). */
  collisions = 0;
  private fbTable?: { key: string; t: { starts: Float32Array; total: number } };

  constructor(public id: string, params: Partial<EmitterParams>, public presetName = 'custom') {
    this.params = { ...DEFAULT_EMITTER, ...params };
    this.rng = new Rng(this.params.seed);
    this.rng2 = new Rng(this.params.seed * 7919 + 13);
    const n = this.params.maxParticles;
    this.px = new Float32Array(n); this.py = new Float32Array(n); this.pz = new Float32Array(n);
    this.vx = new Float32Array(n); this.vy = new Float32Array(n); this.vz = new Float32Array(n);
    this.age = new Float32Array(n); this.life = new Float32Array(n); this.size = new Float32Array(n);
    this.rot = new Float32Array(n); this.rotv = new Float32Array(n); this.anchor = new Int32Array(n);
    this.rnd = new Float32Array(n); this.rnd2 = new Float32Array(n);
    this.cr = new Float32Array(n).fill(1); this.cg = new Float32Array(n).fill(1); this.cb = new Float32Array(n).fill(1);
    this.sid = new Int32Array(n);
    this.allocHistory();
    if (this.params.burst > 0) this.pendingBurst = this.params.burst;
  }
  pendingBurst = 0;

  private allocHistory() {
    const H = Math.max(0, Math.min(64, Math.round(this.params.trailPoints ?? 0)));
    if (!H) { this.hist = undefined; this.histN = undefined; return; }
    const n = this.params.maxParticles;
    if (this.hist && this.hist.length === n * H * 3) return;
    this.hist = new Float32Array(n * H * 3); this.histN = new Uint8Array(n); this.histHead = 0;
  }

  setParams(p: Partial<EmitterParams>) {
    const needRealloc = p.maxParticles != null && p.maxParticles !== this.params.maxParticles;
    this.params = { ...this.params, ...p };
    if (needRealloc) {
      const old = this;
      const n = this.params.maxParticles;
      const keep = Math.min(old.count, n);
      const copy = (a: Float32Array, fill = 0) => { const b = new Float32Array(n); if (fill) b.fill(fill); b.set(a.subarray(0, keep)); return b; };
      this.px = copy(old.px); this.py = copy(old.py); this.pz = copy(old.pz); this.vx = copy(old.vx); this.vy = copy(old.vy); this.vz = copy(old.vz);
      this.age = copy(old.age); this.life = copy(old.life); this.size = copy(old.size); this.rot = copy(old.rot); this.rotv = copy(old.rotv);
      this.rnd = copy(old.rnd); this.rnd2 = copy(old.rnd2); this.cr = copy(old.cr, 1); this.cg = copy(old.cg, 1); this.cb = copy(old.cb, 1);
      const an = new Int32Array(n); an.set(old.anchor.subarray(0, keep)); this.anchor = an;
      const si = new Int32Array(n); si.set(old.sid.subarray(0, keep)); this.sid = si;
      this.hist = undefined;
      this.count = keep;
    }
    this.allocHistory();
  }

  burst(n: number) { this.pendingBurst += n; }
  restart() {
    this.elapsed = 0; this.clock = 0; this.emitting = true; this.carry = 0; this.warmed = false;
    if (this.params.burst > 0) this.pendingBurst += this.params.burst;
  }

  get done(): boolean {
    if (this.emitting || this.count > 0 || this.pendingBurst > 0) return false;
    // A layer fed by another layer's sub-emitter stays alive while that layer still runs.
    const me = this.links?.indexOf(this) ?? -1;
    if (me >= 0) for (const o of this.links!) if (o !== this && o.params.subEmitters?.some((s) => s.layer === me) && (o.emitting || o.count > 0 || o.pendingBurst > 0)) return false;
    return true;
  }

  /** Where the layer's origin is (attached position + its offset in the effect). */
  private origin(): V3 {
    const o = this.params.offset;
    return o ? [this.position[0] + o[0], this.position[1] + o[1], this.position[2] + o[2]] : [this.position[0], this.position[1], this.position[2]];
  }

  /** Spawn one particle; with `at` it is born there (sub-emitters) instead of on the emitter's shape. */
  private spawnOne(at?: V3, inheritV?: V3): number {
    const p = this.params;
    const max = Math.max(1, Math.floor(p.maxParticles * this.qualityScale));
    if (this.count >= max || this.count >= this.px.length) return -1;
    const i = this.count++;
    const r = this.rng, r2 = this.rng2;
    let ox = 0, oy = 0, oz = 0;
    const [sx, sy, sz] = p.shapeSize;
    const mp = p.shape === 'mesh' ? p.meshPoints : undefined;
    let mk = -1;
    if (mp && mp.length >= 6) { mk = Math.floor(r.next() * (mp.length / 6)) * 6; ox = mp[mk]; oy = mp[mk + 1]; oz = mp[mk + 2]; this.anchor[i] = mk; }
    else if (p.shape === 'box') {
      ox = (r.next() - 0.5) * sx; oy = (r.next() - 0.5) * sy; oz = (r.next() - 0.5) * sz;
      if (p.emitShell) { const ax = Math.floor(r2.next() * 3), sgn = r2.next() < 0.5 ? -0.5 : 0.5; if (ax === 0) ox = sgn * sx; else if (ax === 1) oy = sgn * sy; else oz = sgn * sz; }
    }
    else if (p.shape === 'sphere' || p.shape === 'hemisphere') {
      const u = r.next() * 2 - 1, th = r.next() * Math.PI * 2; let rad = Math.cbrt(r.next());
      if (p.emitShell) rad = 1;
      const s = Math.sqrt(1 - u * u); ox = s * Math.cos(th) * sx * rad; oy = (p.shape === 'hemisphere' ? Math.abs(u) : u) * sy * rad; oz = s * Math.sin(th) * sz * rad;
    }
    else if (p.shape === 'circle' || p.shape === 'cone') { const th = r.next() * Math.PI * 2; let rad = Math.sqrt(r.next()); if (p.emitShell) rad = 1; ox = Math.cos(th) * sx * rad; oz = Math.sin(th) * sz * rad; }
    else if (p.shape === 'ring') { const th = r.next() * Math.PI * 2, tk = p.ringThickness ?? 0.1, rad = 1 - tk * r2.next(); ox = Math.cos(th) * sx * rad; oz = Math.sin(th) * sz * rad; }
    else if (p.shape === 'line') { ox = (r.next() - 0.5) * sx; oy = (r2.next() - 0.5) * sy; oz = (r2.next() - 0.5) * sz; }
    else if (p.shape === 'path' && p.pathPoints && p.pathPoints.length >= 6) {
      const pts = p.pathPoints, segs = pts.length / 3 - 1;
      let total = 0; for (let k = 0; k < segs; k++) total += Math.hypot(pts[k * 3 + 3] - pts[k * 3], pts[k * 3 + 4] - pts[k * 3 + 1], pts[k * 3 + 5] - pts[k * 3 + 2]);
      let d = r.next() * total, k = 0;
      for (; k < segs; k++) { const l = Math.hypot(pts[k * 3 + 3] - pts[k * 3], pts[k * 3 + 4] - pts[k * 3 + 1], pts[k * 3 + 5] - pts[k * 3 + 2]); if (d <= l || k === segs - 1) { const u = l > 0 ? Math.min(1, d / l) : 0; ox = pts[k * 3] + (pts[k * 3 + 3] - pts[k * 3]) * u; oy = pts[k * 3 + 1] + (pts[k * 3 + 4] - pts[k * 3 + 1]) * u; oz = pts[k * 3 + 2] + (pts[k * 3 + 5] - pts[k * 3 + 2]) * u; break; } d -= l; }
      const j = (r2.next() - 0.5); ox += j * sx; oy += j * sy * 0; oz += (r2.next() - 0.5) * sz;
    }
    const sox = ox, soy = oy, soz = oz; // shape-local offset (for radial speed)
    const M = eulerMat(p.emitterRotation, p.emitterScale ?? 1);
    if (M && !at) { const x = ox, y = oy, z = oz; ox = M[0] * x + M[1] * y + M[2] * z; oy = M[3] * x + M[4] * y + M[5] * z; oz = M[6] * x + M[7] * y + M[8] * z; }
    const base = at ?? this.origin();
    this.px[i] = base[0] + ox; this.py[i] = base[1] + oy; this.pz[i] = base[2] + oz;
    // Direction within a cone around `direction`, rotated by the emitter heading in the world plane.
    let [dx, dy, dz] = p.direction;
    if (M) { const R = eulerMat(p.emitterRotation)!; if (R) { const x = dx, y = dy, z = dz; dx = R[0] * x + R[1] * y + R[2] * z; dy = R[3] * x + R[4] * y + R[5] * z; dz = R[6] * x + R[7] * y + R[8] * z; } }
    if (this.heading) {
      const a = (this.heading * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
      if (this.plane === 'xz') { const nx = dx * c + dz * s; const nz = -dx * s + dz * c; dx = nx; dz = nz; }
      else { const nx = dx * c - dy * s; const ny = dx * s + dy * c; dx = nx; dy = ny; }
    }
    const dl = Math.hypot(dx, dy, dz) || 1; dx /= dl; dy /= dl; dz /= dl;
    const spread = (p.spread * Math.PI) / 180;
    const cosT = 1 - r.next() * (1 - Math.cos(spread));
    const sinT = Math.sqrt(Math.max(0, 1 - cosT * cosT));
    const phi = r.next() * Math.PI * 2;
    // Orthonormal basis around d.
    const ax = Math.abs(dx) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    let ux = dy * ax[2] - dz * ax[1], uy = dz * ax[0] - dx * ax[2], uz = dx * ax[1] - dy * ax[0];
    const ul = Math.hypot(ux, uy, uz) || 1; ux /= ul; uy /= ul; uz /= ul;
    const wx = dy * uz - dz * uy, wy = dz * ux - dx * uz, wz = dx * uy - dy * ux;
    const vxn = dx * cosT + (ux * Math.cos(phi) + wx * Math.sin(phi)) * sinT;
    const vyn = dy * cosT + (uy * Math.cos(phi) + wy * Math.sin(phi)) * sinT;
    const vzn = dz * cosT + (uz * Math.cos(phi) + wz * Math.sin(phi)) * sinT;
    const sp = p.speed + (r.next() * 2 - 1) * p.speedVar;
    this.vx[i] = vxn * sp; this.vy[i] = vyn * sp; this.vz[i] = vzn * sp;
    if (mk >= 0 && p.meshOutward) {
      // Off the shape: outward along the normal, or along the edge (either way for edges).
      const o = p.meshOutward * (p.meshEdges && r.next() < 0.5 ? -1 : 1);
      this.vx[i] += mp![mk + 3] * o; this.vy[i] += mp![mk + 4] * o; this.vz[i] += mp![mk + 5] * o;
    }
    if (p.radialSpeed) {
      const l = Math.hypot(sox, soy, soz);
      if (l > 1e-6) { this.vx[i] += (sox / l) * p.radialSpeed; this.vy[i] += (soy / l) * p.radialSpeed; this.vz[i] += (soz / l) * p.radialSpeed; }
    }
    if (inheritV) { this.vx[i] += inheritV[0]; this.vy[i] += inheritV[1]; this.vz[i] += inheritV[2]; }
    this.age[i] = 0;
    this.life[i] = Math.max(0.02, p.lifetime + (r.next() * 2 - 1) * p.lifetimeVar);
    this.size[i] = Math.max(0, 1 + ((r.next() * 2 - 1) * p.sizeVar) / Math.max(0.001, p.sizeStart));
    this.rot[i] = p.rotation + r.next() * 360 * (p.rotationSpeed ? 1 : 0);
    this.rotv[i] = p.rotationSpeed * (r.next() < 0.5 ? -1 : 1);
    // 2.0 additions draw from the second stream.
    this.rnd[i] = r2.next(); this.rnd2[i] = r2.next();
    if (p.rotationVar != null) this.rot[i] = p.rotation + (r2.next() * 2 - 1) * p.rotationVar;
    if (p.alignToVelocity) this.rot[i] = (Math.atan2(this.vy[i], this.vx[i]) * 180) / Math.PI + p.rotation;
    if (p.spinVar || p.spinDirection) {
      const spin = p.rotationSpeed + (r2.next() * 2 - 1) * (p.spinVar ?? 0);
      this.rotv[i] = p.spinDirection === 'cw' ? -Math.abs(spin) : p.spinDirection === 'ccw' ? Math.abs(spin) : spin * (r2.next() < 0.5 ? -1 : 1);
    }
    this.cr[i] = 1; this.cg[i] = 1; this.cb[i] = 1;
    const rc = p.randomColors;
    if (rc && rc.length) {
      const c = rc.length > 1 && p.randomColorBlend ? mixColor(rc[0], rc[1], this.rnd2[i]) : hexToRgb(rc[Math.min(rc.length - 1, Math.floor(r2.next() * rc.length))]);
      this.cr[i] = c[0]; this.cg[i] = c[1]; this.cb[i] = c[2];
    }
    if (mk >= 0 && p.meshColors && p.meshColors.length >= ((mk / 6) + 1) * 3) { const q = (mk / 6) * 3; this.cr[i] *= p.meshColors[q]; this.cg[i] *= p.meshColors[q + 1]; this.cb[i] *= p.meshColors[q + 2]; }
    this.sid[i] = this.nextSid++;
    if (this.histN) this.histN[i] = 0;
    if (p.subEmitters) for (const s of p.subEmitters) if (s.on === 'birth') this.fire(s, i);
    return i;
  }

  /** Spawn `n` particles at a point (sub-emitter events from another layer), adding `inherit` × the velocity. */
  emitAt(pos: V3, vel: V3, n: number, inherit = 0) {
    if (this.clock < (this.params.delay ?? 0)) return;
    const iv: V3 = [vel[0] * inherit, vel[1] * inherit, vel[2] * inherit];
    for (let k = 0; k < n; k++) if (this.spawnOne(pos, iv) < 0) break;
  }

  private fire(s: SubEmitter, i: number) {
    const t = this.links?.[s.layer];
    if (!t || (s.chance < 1 && this.rng2.next() > s.chance)) return;
    t.emitAt([this.px[i], this.py[i], this.pz[i]], [this.vx[i], this.vy[i], this.vz[i]], s.count, s.inherit);
  }

  private removeAt(i: number) {
    const j = --this.count;
    if (i === j) return;
    this.px[i] = this.px[j]; this.py[i] = this.py[j]; this.pz[i] = this.pz[j];
    this.vx[i] = this.vx[j]; this.vy[i] = this.vy[j]; this.vz[i] = this.vz[j];
    this.age[i] = this.age[j]; this.life[i] = this.life[j]; this.size[i] = this.size[j]; this.rot[i] = this.rot[j]; this.rotv[i] = this.rotv[j]; this.anchor[i] = this.anchor[j];
    this.rnd[i] = this.rnd[j]; this.rnd2[i] = this.rnd2[j]; this.cr[i] = this.cr[j]; this.cg[i] = this.cg[j]; this.cb[i] = this.cb[j]; this.sid[i] = this.sid[j];
    if (this.hist && this.histN) { const H = this.hist.length / this.px.length; this.hist.copyWithin(i * H, j * H, j * H + H); this.histN[i] = this.histN[j]; }
  }

  update(dt: number) {
    const p = this.params;
    if (!this.warmed) {
      this.warmed = true;
      const pw = Math.min(30, p.prewarm ?? 0);
      if (pw > 0 && dt > 0) { const step = 1 / 30; for (let t = 0; t < pw; t += step) this.step(step); }
    }
    this.step(dt * (p.timeScale ?? 1));
  }

  private step(dt: number) {
    const p = this.params;
    this.clock += dt;
    const delay = p.delay ?? 0;
    if (this.clock < delay) return;
    if (this.pendingBurst > 0) { const n = this.pendingBurst; this.pendingBurst = 0; for (let k = 0; k < n; k++) this.spawnOne(); }
    if (this.emitting) {
      const prev = this.elapsed;
      this.elapsed += dt;
      const dur = Math.max(0.001, p.duration);
      const rateMul = p.rateCurve ? Math.max(0, evalCurve(p.rateCurve, (this.elapsed % dur) / dur)) : 1;
      this.carry += p.rate * rateMul * dt;
      while (this.carry >= 1) { this.carry -= 1; this.spawnOne(); }
      if (p.bursts) {
        // Each burst fires at time + k·interval inside every loop of the duration.
        const a = p.looping ? prev % dur : prev, b = p.looping ? this.elapsed % dur : this.elapsed, wrapped = p.looping && b < a;
        for (const bu of p.bursts) for (let k = 0; k < Math.max(1, bu.cycles); k++) {
          const t = bu.time + k * Math.max(0.001, bu.interval);
          const hit = wrapped ? t >= a || t < b : (t >= a && t < b) || (prev === 0 && t === 0);
          if (hit && (bu.chance == null || this.rng2.next() <= bu.chance)) for (let q = 0; q < bu.count; q++) this.spawnOne();
        }
      }
      if (!p.looping && this.elapsed >= p.duration) this.emitting = false;
    }
    const damp = Math.max(0, 1 - p.drag * dt);
    const [axx, ayy, azz] = p.acceleration;
    const turb = p.turbulence || 0, tf = p.turbulenceFreq || 1, tt = this.elapsed;
    const vort = p.vortex || 0, pull = p.vortexPull || 0;
    const [cx, cy, cz] = this.origin();
    const mp = p.shape === 'mesh' && p.meshPoints && p.meshPoints.length >= 6 ? p.meshPoints : undefined;
    const npts = mp ? Math.floor(mp.length / 6) : 0, cling = mp ? p.cling ?? 0 : 0;
    const forces = p.forces, cols = p.colliders, kills = p.killVolumes, subs = p.subEmitters;
    const curl: [number, number, number] = [0, 0, 0];
    this.collisions = 0;
    // Trail history sampling.
    let sample = false;
    if (this.hist) { this.histClock += dt; if (this.histClock >= (p.trailInterval ?? 0.03)) { this.histClock = 0; sample = true; this.histHead = (this.histHead + 1) % (this.hist.length / this.px.length / 3); } }
    for (let i = 0; i < this.count; i++) {
      const prevAge = this.age[i];
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) {
        if (subs) for (const s of subs) if (s.on === 'death') this.fire(s, i);
        this.removeAt(i);
        i--; continue;
      }
      const t = this.age[i] / this.life[i];
      let fx = axx, fy = p.gravity + ayy, fz = azz;
      if (cling && mp) {
        // Hop to whichever of a few random shape points is nearer (so particles slide over the shape), then spring
        // towards it and lose the speed that would carry them off it.
        let a = this.anchor[i];
        const qx = this.px[i] - cx, qy = this.py[i] - cy, qz = this.pz[i] - cz;
        let best = (mp[a] - qx) ** 2 + (mp[a + 1] - qy) ** 2 + (mp[a + 2] - qz) ** 2;
        for (let k = 0; k < 3; k++) {
          const b = Math.floor(this.rng.next() * npts) * 6, d = (mp[b] - qx) ** 2 + (mp[b + 1] - qy) ** 2 + (mp[b + 2] - qz) ** 2;
          if (d < best) { best = d; a = b; }
        }
        this.anchor[i] = a;
        const k2 = cling * 30;
        fx += (mp[a] - qx) * k2; fy += (mp[a + 1] - qy) * k2; fz += (mp[a + 2] - qz) * k2;
        const keep = Math.max(0, 1 - Math.min(1, cling) * 6 * dt);
        this.vx[i] *= keep; this.vy[i] *= keep; this.vz[i] *= keep;
      }
      if (turb) {
        // Smooth, divergence-free-looking noise from layered sines of position and time.
        const x = this.px[i] * tf, y = this.py[i] * tf, z = this.pz[i] * tf;
        fx += turb * (Math.sin(y * 1.7 + tt * 1.3 + z * 0.9) + 0.5 * Math.sin(z * 3.1 - tt * 2.1));
        fy += turb * (Math.sin(z * 1.3 + tt * 1.1 + x * 0.7) + 0.5 * Math.sin(x * 2.9 + tt * 1.7));
        fz += turb * (Math.sin(x * 1.5 - tt * 1.2 + y * 0.8) + 0.5 * Math.sin(y * 2.7 - tt * 1.9));
      }
      if (vort || pull) {
        // Swirl around the emitter: about Y in 3D (xz plane), about the view axis in 2D (xy plane).
        // Velocity relaxes toward an orbit at `vortex` m/s; the centripetal term keeps the orbit from flying
        // outward, and `pull` draws particles inward (negative pushes out).
        const a = this.px[i] - cx, b = this.plane === 'xz' ? this.pz[i] - cz : this.py[i] - cy;
        const r = Math.max(0.05, Math.hypot(a, b));
        const ta = -b / r, tb = a / r, ra = a / r, rb = b / r;
        const va = this.vx[i], vb = this.plane === 'xz' ? this.vz[i] : this.vy[i];
        const vt = va * ta + vb * tb;
        const k = Math.min(1, 4 * dt) / Math.max(dt, 1e-6);
        // Rankine profile: speed grows linearly inside a 0.5 m core (no singularity at the axis).
        const target = vort * Math.min(1, r / 0.5);
        const steer = (target - vt) * k, inward = (vt * vt) / r + pull;
        const ga = ta * steer - ra * inward, gb = tb * steer - rb * inward;
        fx += ga;
        if (this.plane === 'xz') fz += gb; else fy += gb;
      }
      let killed = false;
      if (forces) for (const f of forces) {
        switch (f.type) {
          case 'attract': {
            const dx = cx + f.pos[0] - this.px[i], dy = cy + f.pos[1] - this.py[i], dz = cz + f.pos[2] - this.pz[i];
            const d = Math.hypot(dx, dy, dz) || 1e-6;
            if (f.killRadius && d < f.killRadius) { killed = true; break; }
            if (f.radius > 0 && d > f.radius) break;
            const fall = f.falloff === 'linear' && f.radius > 0 ? 1 - d / f.radius : f.falloff === 'smooth' && f.radius > 0 ? (1 - d / f.radius) ** 2 : 1;
            const s = (f.strength * fall) / d;
            fx += dx * s; fy += dy * s; fz += dz * s; break;
          }
          case 'orbit': {
            const al = Math.hypot(f.axis[0], f.axis[1], f.axis[2]) || 1, axx2 = f.axis[0] / al, ayy2 = f.axis[1] / al, azz2 = f.axis[2] / al;
            const qx = this.px[i] - cx - f.pos[0], qy = this.py[i] - cy - f.pos[1], qz = this.pz[i] - cz - f.pos[2];
            const along = qx * axx2 + qy * ayy2 + qz * azz2;
            const rx = qx - axx2 * along, ry = qy - ayy2 * along, rz = qz - azz2 * along, rl = Math.max(0.05, Math.hypot(rx, ry, rz));
            const tx = (ayy2 * rz - azz2 * ry) / rl, ty = (azz2 * rx - axx2 * rz) / rl, tz = (axx2 * ry - ayy2 * rx) / rl;
            const vt = this.vx[i] * tx + this.vy[i] * ty + this.vz[i] * tz;
            const k = Math.min(1, 4 * dt) / Math.max(dt, 1e-6), steer = (f.speed - vt) * k, inward = (vt * vt) / rl + f.pull;
            fx += tx * steer - (rx / rl) * inward; fy += ty * steer - (ry / rl) * inward; fz += tz * steer - (rz / rl) * inward; break;
          }
          case 'curl': {
            const fq = f.frequency || 1;
            curl3(this.px[i] * fq, this.py[i] * fq, this.pz[i] * fq, this.elapsed * (f.speed ?? 1), curl, p.seed);
            fx += curl[0] * f.strength; fy += curl[1] * f.strength; fz += curl[2] * f.strength; break;
          }
          case 'noise': {
            const fq = f.frequency || 1, x = this.px[i] * fq, y = this.py[i] * fq, z = this.pz[i] * fq, tm = this.elapsed * (f.speed ?? 1), o = f.octaves ?? 2;
            fx += fbm3(x + tm, y, z, o, 2, 0.5, p.seed) * f.strength; fy += fbm3(x, y + tm + 19.1, z, o, 2, 0.5, p.seed + 3) * f.strength; fz += fbm3(x, y, z + tm + 47.7, o, 2, 0.5, p.seed + 7) * f.strength; break;
          }
          case 'wind': {
            const dl2 = Math.hypot(f.direction[0], f.direction[1], f.direction[2]) || 1;
            const gust = 1 + f.gust * fbm3(this.elapsed * (f.gustFreq || 0.5), this.px[i] * 0.05, this.pz[i] * 0.05, 2, 2, 0.5, p.seed + 11);
            const w = f.speed * gust;
            const k = f.coupling;
            fx += ((f.direction[0] / dl2) * w - this.vx[i]) * k; fy += ((f.direction[1] / dl2) * w - this.vy[i]) * k; fz += ((f.direction[2] / dl2) * w - this.vz[i]) * k; break;
          }
          case 'airResistance': {
            const sp = Math.hypot(this.vx[i], this.vy[i], this.vz[i]);
            fx -= this.vx[i] * sp * f.amount; fy -= this.vy[i] * sp * f.amount; fz -= this.vz[i] * sp * f.amount; break;
          }
          case 'random': {
            const r = this.rng2;
            fx += (r.next() * 2 - 1) * f.strength * 10; fy += (r.next() * 2 - 1) * f.strength * 10; fz += (r.next() * 2 - 1) * f.strength * 10; break;
          }
          case 'directional': {
            const dl2 = Math.hypot(f.direction[0], f.direction[1], f.direction[2]) || 1, m = (f.strength * evalCurve(f.curve, t, 1)) / dl2;
            fx += f.direction[0] * m; fy += f.direction[1] * m; fz += f.direction[2] * m; break;
          }
          case 'follow': {
            const dx = cx + f.pos[0] - this.px[i], dy = cy + f.pos[1] - this.py[i], dz = cz + f.pos[2] - this.pz[i];
            const d = Math.hypot(dx, dy, dz) || 1e-6;
            if (f.kill && f.arrive && d < f.arrive) { killed = true; break; }
            const want = f.arrive && d < f.arrive ? (f.maxSpeed * d) / f.arrive : f.maxSpeed;
            fx += ((dx / d) * want - this.vx[i]) * f.strength; fy += ((dy / d) * want - this.vy[i]) * f.strength; fz += ((dz / d) * want - this.vz[i]) * f.strength; break;
          }
          case 'path': {
            const pts = f.points, segs = pts.length / 3 - 1;
            if (segs < 1) break;
            const qx = this.px[i] - cx, qy = this.py[i] - cy, qz = this.pz[i] - cz;
            let best = Infinity, bx = 0, by = 0, bz = 0, tx = 0, ty = 0, tz = 0;
            for (let k = 0; k < segs; k++) {
              const ax2 = pts[k * 3], ay2 = pts[k * 3 + 1], az2 = pts[k * 3 + 2], ex = pts[k * 3 + 3] - ax2, ey = pts[k * 3 + 4] - ay2, ez = pts[k * 3 + 5] - az2;
              const l2 = ex * ex + ey * ey + ez * ez || 1e-9, u = Math.max(0, Math.min(1, ((qx - ax2) * ex + (qy - ay2) * ey + (qz - az2) * ez) / l2));
              const nx = ax2 + ex * u, ny = ay2 + ey * u, nz = az2 + ez * u, d = (qx - nx) ** 2 + (qy - ny) ** 2 + (qz - nz) ** 2;
              if (d < best) { best = d; bx = nx; by = ny; bz = nz; const l = Math.sqrt(l2); tx = ex / l; ty = ey / l; tz = ez / l; }
            }
            const d = Math.sqrt(best), pullK = f.radius > 0 ? Math.min(1, d / f.radius) : 1;
            fx += ((tx * f.speed - this.vx[i]) + (bx - qx) * 4 * pullK) * f.strength;
            fy += ((ty * f.speed - this.vy[i]) + (by - qy) * 4 * pullK) * f.strength;
            fz += ((tz * f.speed - this.vz[i]) + (bz - qz) * 4 * pullK) * f.strength; break;
          }
          case 'speedLimit': break;
        }
        if (killed) break;
      }
      if (killed) {
        if (subs) for (const s of subs) if (s.on === 'death') this.fire(s, i);
        this.removeAt(i); i--; continue;
      }
      this.vx[i] = (this.vx[i] + fx * dt) * damp;
      this.vy[i] = (this.vy[i] + fy * dt) * damp;
      this.vz[i] = (this.vz[i] + fz * dt) * damp;
      if (p.speedCurve) {
        // Velocity over life: rescale by the curve's change since last frame.
        const a = evalCurve(p.speedCurve, prevAge / this.life[i], 1), b = evalCurve(p.speedCurve, t, 1);
        if (Math.abs(a) > 1e-4) { const k = b / a; this.vx[i] *= k; this.vy[i] *= k; this.vz[i] *= k; }
      }
      if (forces) for (const f of forces) if (f.type === 'speedLimit') {
        const sp = Math.hypot(this.vx[i], this.vy[i], this.vz[i]);
        const k = sp > f.max ? f.max / sp : f.min && sp < f.min && sp > 1e-6 ? f.min / sp : 1;
        this.vx[i] *= k; this.vy[i] *= k; this.vz[i] *= k;
      }
      this.px[i] += this.vx[i] * dt; this.py[i] += this.vy[i] * dt; this.pz[i] += this.vz[i] * dt;
      let hit = false;
      if (p.collideFloor && this.py[i] < p.floorY) { this.py[i] = p.floorY; this.vy[i] = -this.vy[i] * p.bounce; this.vx[i] *= 0.7; this.vz[i] *= 0.7; hit = true; }
      let die = false;
      if (cols) for (const c of cols) {
        if (c.type === 'plane') {
          const nl = Math.hypot(c.normal[0], c.normal[1], c.normal[2]) || 1, nx = c.normal[0] / nl, ny = c.normal[1] / nl, nz = c.normal[2] / nl;
          const d = (this.px[i] - c.point[0]) * nx + (this.py[i] - c.point[1]) * ny + (this.pz[i] - c.point[2]) * nz;
          if (d >= 0) continue;
          this.px[i] -= nx * d; this.py[i] -= ny * d; this.pz[i] -= nz * d;
          const vn = this.vx[i] * nx + this.vy[i] * ny + this.vz[i] * nz;
          if (vn < 0) {
            const tvx = this.vx[i] - nx * vn, tvy = this.vy[i] - ny * vn, tvz = this.vz[i] - nz * vn, fr = Math.max(0, 1 - c.friction);
            const st = c.stick && Math.abs(vn) < c.stick ? 0 : 1;
            this.vx[i] = (tvx * fr - nx * vn * c.bounce) * st; this.vy[i] = (tvy * fr - ny * vn * c.bounce) * st; this.vz[i] = (tvz * fr - nz * vn * c.bounce) * st;
            hit = true;
          }
          if (c.kill) die = true;
          if (c.lifeLoss) this.age[i] += c.lifeLoss * this.life[i];
        } else {
          const qx = this.px[i] - c.center[0], qy = this.py[i] - c.center[1], qz = this.pz[i] - c.center[2], d = Math.hypot(qx, qy, qz) || 1e-6;
          const pen = c.inside ? d - c.radius : c.radius - d;
          if (pen <= 0) continue;
          const nx = (qx / d) * (c.inside ? -1 : 1), ny = (qy / d) * (c.inside ? -1 : 1), nz = (qz / d) * (c.inside ? -1 : 1);
          this.px[i] += nx * pen; this.py[i] += ny * pen; this.pz[i] += nz * pen;
          const vn = this.vx[i] * nx + this.vy[i] * ny + this.vz[i] * nz;
          if (vn < 0) {
            const fr = Math.max(0, 1 - c.friction);
            this.vx[i] = (this.vx[i] - nx * vn) * fr - nx * vn * c.bounce; this.vy[i] = (this.vy[i] - ny * vn) * fr - ny * vn * c.bounce; this.vz[i] = (this.vz[i] - nz * vn) * fr - nz * vn * c.bounce;
            hit = true;
          }
          if (c.kill) die = true;
          if (c.lifeLoss) this.age[i] += c.lifeLoss * this.life[i];
        }
      }
      if (hit) { this.collisions++; if (subs) for (const s of subs) if (s.on === 'collide') this.fire(s, i); }
      if (kills) for (const k of kills) {
        let inside: boolean;
        if (k.shape === 'below') inside = this.py[i] < k.center[1];
        else if (k.shape === 'sphere') inside = Math.hypot(this.px[i] - k.center[0], this.py[i] - k.center[1], this.pz[i] - k.center[2]) < k.size[0];
        else inside = Math.abs(this.px[i] - k.center[0]) < k.size[0] / 2 && Math.abs(this.py[i] - k.center[1]) < k.size[1] / 2 && Math.abs(this.pz[i] - k.center[2]) < k.size[2] / 2;
        if (k.shape === 'below' ? inside : inside === k.inside) { die = true; break; }
      }
      if (subs) for (const s of subs) if (s.on === 'tick' && s.interval && Math.floor(this.age[i] / s.interval) > Math.floor(prevAge / s.interval)) this.fire(s, i);
      if (die) {
        if (subs) for (const s of subs) if (s.on === 'death') this.fire(s, i);
        this.removeAt(i); i--; continue;
      }
      this.rot[i] += this.rotv[i] * dt;
      if (sample && this.hist && this.histN) {
        const H = this.hist.length / this.px.length / 3, o = (i * H + this.histHead) * 3;
        this.hist[o] = this.px[i]; this.hist[o + 1] = this.py[i]; this.hist[o + 2] = this.pz[i];
        if (this.histN[i] < H) this.histN[i]++;
      }
    }
  }

  /** 0..1 normalized age of particle i. */
  t(i: number) { return this.age[i] / this.life[i]; }
  sizeAt(i: number) {
    const t = this.t(i), p = this.params;
    if (p.sizeCurve) return p.sizeStart * Math.max(0, evalCurve(p.sizeCurve, t, 1)) * this.size[i];
    return (p.sizeStart + (p.sizeEnd - p.sizeStart) * t) * this.size[i];
  }
  alphaAt(i: number) {
    const t = this.t(i), p = this.params, f = p.fadeIn ?? 0;
    let a: number;
    if (p.alphaCurve) a = evalCurve(p.alphaCurve, t, 1);
    else a = (p.alphaStart + (p.alphaEnd - p.alphaStart) * t) * (f > 0 ? Math.min(1, t / f) : 1);
    if (p.gradient && p.gradient.length) a *= evalGradient(p.gradient, Math.min(1, t))[3];
    if (p.flipbook?.end === 'hide' && this.frameAt(i) < 0) return 0;
    return a;
  }
  /** Color over life (0..1 RGB), through the optional middle color or the gradient, times the particle's own colour. */
  colorAt(i: number): [number, number, number] {
    const t = Math.min(1, this.t(i)), p = this.params;
    let c: [number, number, number];
    if (p.gradient && p.gradient.length) { const g = evalGradient(p.gradient, t); c = [g[0], g[1], g[2]]; }
    else if (!p.colorMid) c = mixColor(p.colorStart, p.colorEnd, t);
    else c = t < 0.5 ? mixColor(p.colorStart, p.colorMid, t * 2) : mixColor(p.colorMid, p.colorEnd, (t - 0.5) * 2);
    if (this.cr[i] !== 1 || this.cg[i] !== 1 || this.cb[i] !== 1) { c[0] *= this.cr[i]; c[1] *= this.cg[i]; c[2] *= this.cb[i]; }
    return c;
  }
  /** Rotation in degrees including the rotation-over-life curve. */
  rotAt(i: number) { const c = this.params.rotationCurve; return this.rot[i] + (c ? evalCurve(c, this.t(i), 0) : 0); }
  /** Glow multiplier over life. */
  glowAt(i: number) { const p = this.params; return (p.glow ?? 0) * (p.glowCurve ? Math.max(0, evalCurve(p.glowCurve, this.t(i), 1)) : 1); }
  /** Flipbook frame (float; fraction = blend to next), or -1 when hidden. 0 without a flipbook. */
  frameAt(i: number): number {
    const fb = this.params.flipbook;
    if (!fb) return 0;
    const key = `${fb.frames}|${fb.channelPacked ? 1 : 0}|${fb.order?.length ?? 0}|${JSON.stringify(fb.holds ?? [])}`;
    if (!this.fbTable || this.fbTable.key !== key) this.fbTable = { key, t: frameUnits(fb) };
    return flipbookFrame(fb, this.age[i], this.life[i], this.rnd[i], this.rnd2[i], this.fbTable.t);
  }
}

/** Connects an effect's layers so sub-emitters can spawn into each other (index = layer number). */
export function linkEmitters(es: Emitter[]) { for (const e of es) e.links = es; }
