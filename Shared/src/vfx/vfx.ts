// VFX graph (ParticleCraft) and the shared effect asset format.
//
// An effect is a set of SYSTEMS. Like Unity's VFX Graph, each system is a column of four contexts —
// Spawn → Initialize → Update → Output — holding stacked BLOCKS. Exposed PARAMETERS on the blackboard drive block
// properties. Compiling turns every enabled system into one EmitterParams "layer" for the shared CPU particle engine
// (runtime/particles.ts), which GameCraft and LogicCraft both run, so what you preview is what the games play.
import { DEFAULT_EMITTER, type Curve, type EmitterParams, type GradientStop } from '../runtime/particles';
import { newId } from '../schema';
import { sampleShape, type EmitFrom, type VfxShape } from './shapes';
import { LEAF_IMAGES } from '../world/leafImages';
import { realisticPresets } from './presets2';

export const VFX_FORMAT = 'craft.vfx';
/** 2: ParticleCraft 2.0 (texture nodes, timing, comments). Version 1 files load unchanged (every addition is optional). */
export const VFX_SCHEMA = 2;

export type ContextId = 'spawn' | 'init' | 'update' | 'output';
export type PropType = 'number' | 'color' | 'vector' | 'bool' | 'choice' | 'image' | 'curve' | 'gradient' | 'texture' | 'system' | 'colors' | 'points' | 'text';
export interface PropDef { key: string; label: string; type: PropType; default: any; min?: number; max?: number; step?: number; options?: string[]; doc?: string }

export interface VfxBlock { id: string; type: string; enabled: boolean; props: Record<string, any>; /** User note shown on the block. */ comment?: string }
export interface VfxSystem {
  id: string; name: string; enabled: boolean; x: number; y: number; contexts: Record<ContextId, VfxBlock[]>;
  /** Shape node the particles are born on (and cling to). */
  source?: string;
  /** Made from a Blender particle system (a "Blender Particle Effect" node): what it came from. */
  origin?: BlenderOrigin;
  /** Timeline: seconds before this system starts inside the effect, and its own playback speed. */
  timing?: { delay: number; timeScale: number };
  /** Transform inside the parent effect. */
  transform?: { offset: [number, number, number]; rotation: [number, number, number]; scale: number };
  /** Header colour, label and collapsed state in the graph. */
  color?: string; label?: string; collapsed?: boolean;
  /** Came from a saved component (name and version) — kept as a reference so updates are predictable. */
  component?: { name: string; version: number };
  /** Draw order among the effect's systems (higher on top). */
  sortOrder?: number;
}
/** A frame / comment box on the graph canvas. */
export interface VfxComment { id: string; x: number; y: number; w: number; h: number; text: string; color: string; /** Collapsed: only the title shows; the nodes inside are hidden (they still play). */ collapsed?: boolean }
/** Where a Blender Particle Effect node came from, and what could only be approximated. */
export interface BlenderOrigin { kind: 'blender'; file: string; object: string; system: string; settings: Record<string, any>; notes: string[] }
export interface VfxBinding { system: string; block: string; prop: string }
export interface VfxParam { id: string; name: string; type: 'number' | 'color' | 'vector' | 'bool' | 'curve' | 'gradient'; value: any; bindings: VfxBinding[] }
/** A node of the texture graph (texture input, procedural generators, filters, flipbook source…). Evaluated by
 *  ParticleCraft into pictures; `inputs` name the upstream node of each input socket. */
export interface VfxTexNode { id: string; type: string; x: number; y: number; props: Record<string, any>; inputs: Record<string, string | undefined>; name?: string; collapsed?: boolean }
export interface VfxGraph {
  systems: VfxSystem[]; params: VfxParam[]; shapes?: VfxShape[];
  /** Texture / material node graph; system blocks reference a node as `node:<id>`. */
  texNodes?: VfxTexNode[];
  comments?: VfxComment[];
}

/** realtime: plays in the games. baked: a flipbook image sequence. simulation: ParticleCraft-only setup. */
export type VfxKind = 'realtime' | 'baked' | 'simulation';

export interface VfxAsset {
  format: typeof VFX_FORMAT; schemaVersion: number;
  id: string; name: string; kind: VfxKind; category: string; description?: string;
  created: string; modified: string;
  graph?: VfxGraph;
  /** realtime: one layer per system, ready for the particle engine. */
  layers?: { name: string; params: EmitterParams }[];
  exposed?: { name: string; type: VfxParam['type']; value: any; targets: { layer: number; param: string }[] }[];
  /** baked: sprite-sheet flipbook (PNG data URL), frames left→right. */
  flipbook?: { image: string; frames: number; fps: number; loop: boolean; width: number; height: number;
    /** Pixel art (from SpriteCraft): draw with sharp pixels rather than smoothing. */
    pixelArt?: boolean };
  /** simulation: ParticleCraft simulation setup. */
  simulation?: { type: string; params: Record<string, number | string | boolean> };
  /** What a target cannot reproduce. */
  compatibility?: { gamecraft: string[]; logiccraft: string[] };
  /** Shape nodes shown with the effect (Hide original off), for the games to draw. */
  shapes?: Omit<VfxShape, 'mesh'>[];
  /** Came from the Blender add-on: the .glb it wrote alongside, and each object's height (to attach the effect). */
  blender?: { file: string; model?: string; objects: { name: string; height: number; systems: number }[] };
  /** Library pictures the effect uses, carried inside exported effect files (id, name, PNG/JPG data URL, sheet grid). */
  assets?: { id: string; name: string; data: string; w: number; h: number; sheet?: { cols: number; rows: number; frames: number; padding: number; spacing: number; fps?: number } }[];
  /** Made as a variation of another effect. */
  variationOf?: string;
}

// ------------------------------------------------------------------ block catalog
//
// Blocks are the nodes stacked in each system's contexts. `category` groups them in the searchable node library.
// Every block writes real engine fields in `apply`; nothing here is decorative.

export type BlockCategory = 'Emitters' | 'Spawn' | 'Initialization' | 'Forces' | 'Physics' | 'Simulation' | 'Events' | 'Appearance' | 'Curves' | 'Textures' | 'Flipbooks' | 'Materials' | 'Rendering';
export interface ApplyCtx { sys: VfxSystem; warn: (msg: string) => void; tex: (ref: string) => string | undefined }
export interface BlockType { type: string; context: ContextId; category: BlockCategory; name: string; doc: string; props: PropDef[]; apply: (p: EmitterParams, v: Record<string, any>, ctx: ApplyCtx) => void; /** Only one of these per system (the last wins). */ exclusive?: string }
const n = (key: string, label: string, def: number, min?: number, max?: number, step?: number, doc?: string): PropDef => ({ key, label, type: 'number', default: def, min, max, step, doc });
const col = (key: string, label: string, def: string): PropDef => ({ key, label, type: 'color', default: def });
const vec = (key: string, label: string, def: [number, number, number]): PropDef => ({ key, label, type: 'vector', default: def });
const bool = (key: string, label: string, def: boolean): PropDef => ({ key, label, type: 'bool', default: def });
const ch = (key: string, label: string, def: string, options: string[]): PropDef => ({ key, label, type: 'choice', default: def, options });
const crv = (key: string, label: string, p: [number, number][], mode: Curve['mode'] = 'smooth'): PropDef => ({ key, label, type: 'curve', default: { p, mode } });
const grd = (key: string, label: string, stops: GradientStop[]): PropDef => ({ key, label, type: 'gradient', default: stops });
const tex = (key: string, label: string): PropDef => ({ key, label, type: 'texture', default: '' });
const sysRef = (key: string, label: string): PropDef => ({ key, label, type: 'system', default: '' });
const cloneCurve = (c: any): Curve | undefined => (c && Array.isArray(c.p) && c.p.length ? { p: c.p.map((q: number[]) => [Number(q[0]), Number(q[1])] as [number, number]).sort((a: number[], b: number[]) => a[0] - b[0]), mode: c.mode } : undefined);
const cloneGrad = (g: any): GradientStop[] | undefined => (Array.isArray(g) && g.length ? g.map((s: any) => ({ t: Number(s.t), c: String(s.c), a: s.a == null ? 1 : Number(s.a) })).sort((a: GradientStop, b: GradientStop) => a.t - b.t) : undefined);
const V = (v: any, d: [number, number, number] = [0, 0, 0]): [number, number, number] => (Array.isArray(v) ? [Number(v[0]) || 0, Number(v[1]) || 0, Number(v[2]) || 0] : d);
const force = (p: EmitterParams, f: NonNullable<EmitterParams['forces']>[number]) => { (p.forces ??= []).push(f); };
const setShape = (p: EmitterParams, shape: EmitterParams['shape'], size: [number, number, number], shell = false) => { p.shape = shape; p.shapeSize = size; p.emitShell = shell; };

export const VFX_BLOCKS: BlockType[] = [
  // ---------------------------------------------------------------- Spawn
  { type: 'rate', context: 'spawn', category: 'Spawn', name: 'Constant rate', doc: 'Continuous emitter: particles per second while the effect plays.', props: [n('rate', 'Rate (/s)', 30, 0, 2000, 1)], apply: (p, v) => { p.rate = v.rate; } },
  { type: 'burst', context: 'spawn', category: 'Spawn', name: 'Burst', doc: 'Particles spawned at once when the effect starts (and on restart).', props: [n('count', 'Count', 40, 0, 2000, 1)], apply: (p, v) => { p.burst += v.count; } },
  { type: 'burstCycles', context: 'spawn', category: 'Spawn', name: 'Burst emitter (repeating)', doc: 'Bursts at a time, repeated every interval for a number of cycles (inside each loop of the duration).', props: [n('time', 'First at (s)', 0, 0, 30, 0.01), n('count', 'Count', 20, 1, 2000, 1), n('cycles', 'Cycles', 3, 1, 100, 1), n('interval', 'Interval (s)', 0.25, 0.01, 30, 0.01), n('chance', 'Chance', 1, 0, 1, 0.01)], apply: (p, v) => { (p.bursts ??= []).push({ time: v.time, count: Math.round(v.count), cycles: Math.round(v.cycles), interval: v.interval, chance: v.chance }); } },
  { type: 'duration', context: 'spawn', category: 'Spawn', name: 'Duration & loop', doc: 'Loop forever, or emit for a number of seconds.', props: [bool('loop', 'Loop', true), n('duration', 'Duration (s)', 1, 0.01, 30, 0.05)], apply: (p, v) => { p.looping = v.loop; p.duration = v.duration; } },
  { type: 'capacity', context: 'spawn', category: 'Simulation', name: 'Capacity (particle limit)', doc: 'Most particles alive at once (memory budget). Rate × longest lifetime is what a continuous emitter needs.', props: [n('max', 'Max particles', 500, 1, 20000, 1)], apply: (p, v) => { p.maxParticles = Math.round(v.max); } },
  { type: 'rateCurve', context: 'spawn', category: 'Curves', name: 'Emission over time', doc: 'Multiplies the rate across each loop of the duration (0 → 1): ramp up, pulse, die down.', props: [crv('curve', 'Rate ×', [[0, 0], [0.2, 1], [1, 1]])], apply: (p, v) => { p.rateCurve = cloneCurve(v.curve); } },
  { type: 'prewarm', context: 'spawn', category: 'Simulation', name: 'Prewarm (particle cache)', doc: 'Simulate this many seconds before the first frame, so looping effects start already full.', props: [n('seconds', 'Seconds', 2, 0, 30, 0.1)], apply: (p, v) => { p.prewarm = v.seconds; } },

  // ---------------------------------------------------------------- Initialize: emitters (where / which way)
  { type: 'lifetime', context: 'init', category: 'Initialization', name: 'Set lifetime (random)', doc: 'How long each particle lives, between min and max seconds.', props: [n('min', 'Min (s)', 0.8, 0.02, 20, 0.05), n('max', 'Max (s)', 1.4, 0.02, 20, 0.05)], apply: (p, v) => { const a = Math.min(v.min, v.max), b = Math.max(v.min, v.max); p.lifetime = (a + b) / 2; p.lifetimeVar = (b - a) / 2; } },
  { type: 'shapeEmit', context: 'init', category: 'Emitters', name: 'Mesh surface emitter (shape node)', doc: 'Particles are born on the connected shape / object node: its surface, inside it, or along its edges, and leave it outward (or along the edge).', props: [ch('from', 'Emit from', 'surface', ['surface', 'volume', 'edges']), n('outward', 'Outward speed', 0.5, -20, 20, 0.05), n('points', 'Sample points', 512, 32, 4096, 32)], apply: (p, v) => { p.meshOutward = v.outward; p.meshEdges = v.from === 'edges'; } },
  { type: 'shape', context: 'init', category: 'Emitters', name: 'Position (shape)', doc: 'Where particles are born.', props: [ch('shape', 'Shape', 'point', ['point', 'sphere', 'box', 'circle', 'cone']), vec('size', 'Size', [0.3, 0.3, 0.3])], apply: (p, v) => { p.shape = v.shape; p.shapeSize = v.size; } },
  { type: 'pointEmitter', context: 'init', category: 'Emitters', name: 'Point emitter', doc: 'Moves where particles are born (offset from the effect origin). On its own, every particle starts at that one point; with a shape emitter it moves the shape.', props: [vec('at', 'Position', [0, 0, 0])], apply: (p, v) => { const o = V(v.at); p.offset = [(p.offset?.[0] ?? 0) + o[0], (p.offset?.[1] ?? 0) + o[1], (p.offset?.[2] ?? 0) + o[2]]; } },
  { type: 'sphereEmitter', context: 'init', category: 'Emitters', name: 'Sphere emitter', doc: 'Born inside a sphere (or only on its surface), optionally the upper half; "Explode" pushes them out from the centre.', props: [n('radius', 'Radius', 0.5, 0, 50, 0.05), bool('shell', 'Surface only', false), bool('hemi', 'Upper half only', false), n('radial', 'Explode speed', 0, -50, 50, 0.1)], apply: (p, v) => { setShape(p, v.hemi ? 'hemisphere' : 'sphere', [v.radius, v.radius, v.radius], v.shell); p.radialSpeed = v.radial; } },
  { type: 'boxEmitter', context: 'init', category: 'Emitters', name: 'Box emitter', doc: 'Born inside a box (or on its faces).', props: [vec('size', 'Size', [1, 1, 1]), bool('shell', 'Faces only', false)], apply: (p, v) => { setShape(p, 'box', V(v.size, [1, 1, 1]), v.shell); } },
  { type: 'coneEmitter', context: 'init', category: 'Emitters', name: 'Cone emitter', doc: 'Born on a disc and fired out in a cone (fountains, jets, muzzle flashes).', props: [n('radius', 'Base radius', 0.1, 0, 20, 0.01), n('angle', 'Cone angle (°)', 25, 0, 180, 1), vec('direction', 'Direction', [0, 1, 0]), n('speed', 'Speed', 4, 0, 100, 0.1)], apply: (p, v) => { setShape(p, 'cone', [v.radius, 0, v.radius]); p.spread = v.angle; p.direction = V(v.direction, [0, 1, 0]); p.speed = v.speed; } },
  { type: 'circleEmitter', context: 'init', category: 'Emitters', name: 'Circle emitter', doc: 'Born on a flat disc, or on its edge as a ring (shockwaves, portals).', props: [n('radius', 'Radius', 0.5, 0, 50, 0.05), bool('edge', 'Edge only (ring)', false), n('thickness', 'Ring thickness', 0.1, 0, 1, 0.01), n('radial', 'Outward speed', 0, -50, 50, 0.1)], apply: (p, v) => { if (v.edge) { setShape(p, 'ring', [v.radius, 0, v.radius]); p.ringThickness = v.thickness; } else setShape(p, 'circle', [v.radius, 0, v.radius]); p.radialSpeed = v.radial; } },
  { type: 'directionalEmitter', context: 'init', category: 'Emitters', name: 'Directional emitter', doc: 'Fires particles along one direction with a small spread (beams, jets, rain).', props: [vec('direction', 'Direction', [1, 0, 0]), n('speed', 'Speed', 6, 0, 200, 0.1), n('spread', 'Spread (°)', 4, 0, 90, 0.5), n('random', 'Speed random', 0.5, 0, 50, 0.1)], apply: (p, v) => { p.direction = V(v.direction, [1, 0, 0]); p.speed = v.speed; p.spread = v.spread; p.speedVar = v.random; } },
  { type: 'randomEmitter', context: 'init', category: 'Emitters', name: 'Random emitter', doc: 'Born anywhere in a box, heading in any direction (dust, fireflies, ambient motes).', props: [vec('size', 'Area', [4, 2, 4]), n('speed', 'Speed', 0.3, 0, 50, 0.05)], apply: (p, v) => { setShape(p, 'box', V(v.size, [4, 2, 4])); p.spread = 180; p.speed = v.speed; p.speedVar = v.speed * 0.5; } },
  { type: 'continuousEmitter', context: 'spawn', category: 'Emitters', name: 'Continuous emitter', doc: 'A steady looping stream: rate per second, forever (rate + loop in one node).', props: [n('rate', 'Rate (/s)', 40, 0, 5000, 1)], apply: (p, v) => { p.rate = v.rate; p.looping = true; } },
  { type: 'trailEmitter', context: 'init', category: 'Emitters', name: 'Trail emitter', doc: 'Leaves particles behind a moving effect (no starting speed of their own, world space): attach to projectiles or characters.', props: [n('jitter', 'Jitter', 0.03, 0, 5, 0.01)], apply: (p, v) => { setShape(p, 'sphere', [v.jitter, v.jitter, v.jitter]); p.speed = 0; p.speedVar = 0; p.space = 'world'; } },
  { type: 'pathEmitter', context: 'init', category: 'Emitters', name: 'Spawn along path', doc: 'Born evenly along a path (a list of points relative to the effect): lightning, fences of fire, magic lines.', props: [{ key: 'points', label: 'Path points', type: 'points', default: [-1, 0, 0, 0, 0.5, 0, 1, 0, 0] }, vec('jitter', 'Jitter', [0.02, 0, 0.02])], apply: (p, v) => { p.shape = 'path'; p.pathPoints = Array.isArray(v.points) ? v.points.map(Number) : []; p.shapeSize = V(v.jitter); } },
  { type: 'imageEmitter', context: 'init', category: 'Emitters', name: 'Spawn from image / texture', doc: 'Born on the opaque (or bright) pixels of a picture — a logo, a texture, one frame of a sprite sheet — taking each pixel\'s colour. Pick the picture in the inspector; it is sampled into points.', props: [tex('image', 'Picture'), ch('use', 'Use pixels by', 'alpha', ['alpha', 'brightness']), n('threshold', 'Threshold', 0.5, 0, 1, 0.01), n('width', 'Width (m)', 2, 0.05, 100, 0.05), bool('colors', 'Take pixel colours', true), n('cols', 'Sheet columns', 1, 1, 64, 1), n('rows', 'Sheet rows', 1, 1, 64, 1), n('frame', 'Sheet frame', 0, 0, 4095, 1), { key: 'points', label: '', type: 'text', default: null }],
    apply: (p, v, ctx) => {
      const s = v.points as { pts: number[]; cols: number[] } | null;
      if (!s?.pts?.length) { ctx.warn('"Spawn from image" has no picture sampled yet (pick one in the inspector)'); return; }
      p.shape = 'mesh'; p.meshPoints = s.pts; p.meshColors = v.colors ? s.cols : undefined; p.meshOutward = 0; p.meshEdges = false;
    } },
  { type: 'velocity', context: 'init', category: 'Initialization', name: 'Velocity (cone)', doc: 'Starting speed in a cone around a direction.', props: [vec('direction', 'Direction', [0, 1, 0]), n('speed', 'Speed', 3, 0, 60, 0.1), n('random', 'Speed random', 1, 0, 30, 0.1), n('spread', 'Spread (°)', 25, 0, 180, 1)], apply: (p, v) => { p.direction = v.direction; p.speed = v.speed; p.speedVar = v.random; p.spread = v.spread; } },
  { type: 'radialVelocity', context: 'init', category: 'Initialization', name: 'Velocity (radial)', doc: 'Adds speed straight out from the emitter shape\'s centre (explosions, novas). Negative implodes.', props: [n('speed', 'Speed', 5, -100, 100, 0.1)], apply: (p, v) => { p.radialSpeed = v.speed; } },
  { type: 'size', context: 'init', category: 'Initialization', name: 'Set size', doc: 'Starting size (world units) with randomness.', props: [n('size', 'Size', 0.25, 0, 10, 0.01), n('random', 'Random', 0.05, 0, 5, 0.01)], apply: (p, v) => { p.sizeStart = v.size; p.sizeEnd = v.size; p.sizeVar = v.random; } },
  { type: 'randomSize', context: 'init', category: 'Appearance', name: 'Random size', doc: 'Each particle gets a size between min and max.', props: [n('min', 'Min', 0.1, 0, 20, 0.01), n('max', 'Max', 0.4, 0, 20, 0.01)], apply: (p, v) => { const a = Math.min(v.min, v.max), b = Math.max(v.min, v.max); p.sizeStart = (a + b) / 2; p.sizeEnd = p.sizeStart; p.sizeVar = (b - a) / 2; } },
  { type: 'rotation', context: 'init', category: 'Initialization', name: 'Set rotation', doc: 'Starting angle and spin speed (degrees per second).', props: [n('angle', 'Angle (°)', 0, 0, 360, 1), n('spin', 'Spin (°/s)', 0, 0, 1440, 5)], apply: (p, v) => { p.rotation = v.angle; p.rotationSpeed = v.spin; } },
  { type: 'randomRotation', context: 'init', category: 'Appearance', name: 'Random rotation', doc: 'Random start angle (± range) and spin (base ± random, direction), or align the angle with the starting velocity.', props: [n('angle', 'Base angle (°)', 0, -360, 360, 1), n('range', 'Angle ± (°)', 180, 0, 180, 1), n('spin', 'Spin (°/s)', 90, 0, 2000, 5), n('spinRandom', 'Spin ± (°/s)', 60, 0, 2000, 5), ch('dir', 'Spin direction', 'random', ['random', 'cw', 'ccw']), bool('align', 'Align to velocity', false)], apply: (p, v) => { p.rotation = v.angle; p.rotationVar = v.range; p.rotationSpeed = v.spin; p.spinVar = v.spinRandom; p.spinDirection = v.dir; p.alignToVelocity = v.align; } },
  { type: 'color', context: 'init', category: 'Initialization', name: 'Set color', doc: 'Starting color and opacity.', props: [col('color', 'Color', '#ffd27a'), n('alpha', 'Opacity', 1, 0, 1, 0.01)], apply: (p, v) => { p.colorStart = v.color; p.colorEnd = v.color; p.alphaStart = v.alpha; p.alphaEnd = v.alpha; } },
  { type: 'randomColor', context: 'init', category: 'Appearance', name: 'Random color', doc: 'Each particle picks one of these colours (or a blend between the first two). Multiplies colour over life — keep that white for exact colours.', props: [{ key: 'colors', label: 'Colours', type: 'colors', default: ['#ff5a5a', '#ffd25a', '#5affb4', '#5ab4ff'] }, bool('blend', 'Blend first two', false)], apply: (p, v) => { p.randomColors = Array.isArray(v.colors) ? v.colors.map(String) : []; p.randomColorBlend = v.blend; } },
  { type: 'seed', context: 'init', category: 'Initialization', name: 'Random seed', doc: 'Same seed, same randomness.', props: [n('seed', 'Seed', 7, 0, 99999, 1)], apply: (p, v) => { p.seed = Math.round(v.seed); } },

  // ---------------------------------------------------------------- Update: forces
  { type: 'gravity', context: 'update', category: 'Forces', name: 'Gravity', doc: 'Constant pull along Y (negative falls).', props: [n('strength', 'Strength', -9.8, -60, 60, 0.1)], apply: (p, v) => { p.gravity = v.strength; } },
  { type: 'drag', context: 'update', category: 'Forces', name: 'Linear drag', doc: 'Slows particles down over time.', props: [n('amount', 'Drag', 0.5, 0, 10, 0.05)], apply: (p, v) => { p.drag = v.amount; } },
  { type: 'airResistance', context: 'update', category: 'Forces', name: 'Air resistance', doc: 'Quadratic drag: fast particles slow hard, slow ones drift (sparks, debris, droplets).', props: [n('amount', 'Amount', 0.2, 0, 10, 0.01)], apply: (p, v) => { force(p, { type: 'airResistance', amount: v.amount }); } },
  { type: 'force', context: 'update', category: 'Forces', name: 'Constant force (acceleration)', doc: 'Wind or any steady push (an acceleration in m/s²).', props: [vec('force', 'Force', [1, 0, 0])], apply: (p, v) => { p.acceleration = v.force; } },
  { type: 'directionalForce', context: 'update', category: 'Forces', name: 'Directional force (over life)', doc: 'A push along a direction whose strength follows a curve over each particle\'s life (acceleration over lifetime).', props: [vec('direction', 'Direction', [0, 1, 0]), n('strength', 'Strength', 3, -200, 200, 0.1), crv('curve', 'Strength over life', [[0, 1], [1, 1]])], apply: (p, v) => { force(p, { type: 'directional', direction: V(v.direction, [0, 1, 0]), strength: v.strength, curve: cloneCurve(v.curve) }); } },
  { type: 'turbulence', context: 'update', category: 'Forces', name: 'Turbulence (noise)', doc: 'Smooth noise that makes motion swirl and flicker.', props: [n('strength', 'Strength', 2, 0, 50, 0.1), n('frequency', 'Frequency', 1, 0.05, 10, 0.05)], apply: (p, v) => { p.turbulence = v.strength; p.turbulenceFreq = v.frequency; } },
  { type: 'noiseForce', context: 'update', category: 'Forces', name: 'Noise (fractal)', doc: 'Fractal Perlin noise force: rougher, more natural wandering than Turbulence.', props: [n('strength', 'Strength', 3, 0, 100, 0.1), n('frequency', 'Frequency', 0.8, 0.01, 20, 0.05), n('speed', 'Scroll speed', 0.5, 0, 20, 0.05), n('octaves', 'Detail (octaves)', 3, 1, 6, 1)], apply: (p, v) => { force(p, { type: 'noise', strength: v.strength, frequency: v.frequency, speed: v.speed, octaves: Math.round(v.octaves) }); } },
  { type: 'curlNoise', context: 'update', category: 'Forces', name: 'Curl noise', doc: 'Divergence-free swirling flow: smoke curls and wisps that never clump.', props: [n('strength', 'Strength', 3, 0, 100, 0.1), n('frequency', 'Frequency', 0.7, 0.01, 20, 0.05), n('speed', 'Evolve speed', 0.6, 0, 20, 0.05)], apply: (p, v) => { force(p, { type: 'curl', strength: v.strength, frequency: v.frequency, speed: v.speed }); } },
  { type: 'wind', context: 'update', category: 'Forces', name: 'Wind', doc: 'Air moving at a speed: particles are carried towards it (light ones faster), with noisy gusts.', props: [vec('direction', 'Direction', [1, 0, 0]), n('speed', 'Wind speed', 4, 0, 100, 0.1), n('coupling', 'Influence', 1, 0, 20, 0.05), n('gust', 'Gustiness', 0.6, 0, 5, 0.05), n('gustFreq', 'Gust frequency', 0.5, 0.01, 10, 0.05)], apply: (p, v) => { force(p, { type: 'wind', direction: V(v.direction, [1, 0, 0]), speed: v.speed, coupling: v.coupling, gust: v.gust, gustFreq: v.gustFreq }); } },
  { type: 'attract', context: 'update', category: 'Forces', name: 'Attraction', doc: 'Pulls particles towards a point (relative to the effect); can absorb them when they arrive.', props: [vec('pos', 'Point', [0, 1, 0]), n('strength', 'Strength', 10, 0, 500, 0.5), n('radius', 'Radius (0 = all)', 0, 0, 100, 0.1), ch('falloff', 'Falloff', 'none', ['none', 'linear', 'smooth']), n('kill', 'Absorb radius', 0, 0, 10, 0.01)], apply: (p, v) => { force(p, { type: 'attract', pos: V(v.pos), strength: v.strength, radius: v.radius, falloff: v.falloff, killRadius: v.kill }); } },
  { type: 'repel', context: 'update', category: 'Forces', name: 'Repulsion', doc: 'Pushes particles away from a point (relative to the effect).', props: [vec('pos', 'Point', [0, 0, 0]), n('strength', 'Strength', 10, 0, 500, 0.5), n('radius', 'Radius (0 = all)', 2, 0, 100, 0.1), ch('falloff', 'Falloff', 'linear', ['none', 'linear', 'smooth'])], apply: (p, v) => { force(p, { type: 'attract', pos: V(v.pos), strength: -v.strength, radius: v.radius, falloff: v.falloff }); } },
  { type: 'vortex', context: 'update', category: 'Forces', name: 'Vortex', doc: 'Spins particles around the effect\'s up axis (tornadoes, portals); pull draws them inward.', props: [n('strength', 'Swirl', 6, -60, 60, 0.1), n('pull', 'Pull in', 1, -20, 20, 0.1)], apply: (p, v) => { p.vortex = v.strength; p.vortexPull = v.pull; } },
  { type: 'orbit', context: 'update', category: 'Forces', name: 'Orbit', doc: 'Particles circle an axis through a point at a speed (any axis — rings around a planet, spell circles).', props: [vec('pos', 'Centre', [0, 1, 0]), vec('axis', 'Axis', [0, 1, 0]), n('speed', 'Orbit speed', 3, -100, 100, 0.1), n('pull', 'Pull in', 0.5, -50, 50, 0.1)], apply: (p, v) => { force(p, { type: 'orbit', pos: V(v.pos), axis: V(v.axis, [0, 1, 0]), speed: v.speed, pull: v.pull }); } },
  { type: 'randomMovement', context: 'update', category: 'Forces', name: 'Random movement', doc: 'Jittery random walk (fireflies, insects, electricity).', props: [n('strength', 'Strength', 1, 0, 50, 0.05)], apply: (p, v) => { force(p, { type: 'random', strength: v.strength }); } },
  { type: 'followTarget', context: 'update', category: 'Forces', name: 'Follow target', doc: 'Steers particles to a target point (relative to the effect): homing magic, souls being absorbed.', props: [vec('pos', 'Target', [0, 2, 0]), n('strength', 'Steering', 3, 0, 50, 0.1), n('maxSpeed', 'Speed', 4, 0, 100, 0.1), n('arrive', 'Arrive radius', 0.2, 0, 10, 0.01), bool('kill', 'Disappear on arrival', true)], apply: (p, v) => { force(p, { type: 'follow', pos: V(v.pos), strength: v.strength, maxSpeed: v.maxSpeed, arrive: v.arrive, kill: v.kill }); } },
  { type: 'pathFollow', context: 'update', category: 'Forces', name: 'Path following', doc: 'Particles flow along a path (points relative to the effect) and are pulled back onto it.', props: [{ key: 'points', label: 'Path points', type: 'points', default: [0, 0, 0, 1, 1, 0, 0, 2, 1, -1, 3, 0] }, n('speed', 'Speed along', 2, -100, 100, 0.1), n('strength', 'Strength', 2, 0, 50, 0.1), n('radius', 'Tube radius', 0.3, 0, 20, 0.01)], apply: (p, v) => { force(p, { type: 'path', points: Array.isArray(v.points) ? v.points.map(Number) : [], speed: v.speed, strength: v.strength, radius: v.radius }); } },
  { type: 'speedLimit', context: 'update', category: 'Forces', name: 'Speed limit', doc: 'Clamps speed between a minimum and a maximum.', props: [n('max', 'Max speed', 10, 0, 500, 0.1), n('min', 'Min speed', 0, 0, 500, 0.1)], apply: (p, v) => { force(p, { type: 'speedLimit', max: v.max, min: v.min }); } },
  { type: 'velocityOverLife', context: 'update', category: 'Curves', name: 'Velocity over lifetime', doc: 'Scales each particle\'s speed along a curve over its life (burst out then hang, or accelerate).', props: [crv('curve', 'Speed ×', [[0, 1], [0.3, 0.25], [1, 0.1]])], apply: (p, v) => { p.speedCurve = cloneCurve(v.curve); } },
  { type: 'cling', context: 'update', category: 'Forces', name: 'Cling to shape', doc: 'Keeps particles on the connected shape node: fire licking over a sphere, electricity running along a cube\'s edges, liquid flowing over a surface.', props: [n('strength', 'Strength', 0.6, 0, 3, 0.05)], apply: (p, v) => { p.cling = v.strength; } },
  // Physics
  { type: 'collide', context: 'update', category: 'Physics', name: 'Collide with floor', doc: 'Bounce on a horizontal plane.', props: [n('floor', 'Floor Y', 0, -100, 100, 0.1), n('bounce', 'Bounce', 0.3, 0, 1, 0.01)], apply: (p, v) => { p.collideFloor = true; p.floorY = v.floor; p.bounce = v.bounce; } },
  { type: 'groundInteraction', context: 'update', category: 'Physics', name: 'Ground interaction', doc: 'Ground collision with bounce and friction: particles slide, roll to a stop and can stick or die on impact.', props: [n('y', 'Ground Y', 0, -100, 100, 0.05), n('bounce', 'Bounce', 0.35, 0, 1.5, 0.01), n('friction', 'Friction', 0.3, 0, 1, 0.01), n('stick', 'Stick below speed', 0.4, 0, 20, 0.05), bool('kill', 'Die on impact', false), n('lifeLoss', 'Life lost per hit', 0, 0, 1, 0.01)], apply: (p, v) => { (p.colliders ??= []).push({ type: 'plane', point: [0, v.y, 0], normal: [0, 1, 0], bounce: v.bounce, friction: v.friction, stick: v.stick, kill: v.kill, lifeLoss: v.lifeLoss }); } },
  { type: 'collisionPlane', context: 'update', category: 'Physics', name: 'Collision (plane)', doc: 'Any tilted plane (walls, ramps): bounce, friction, die on impact.', props: [vec('point', 'Point', [0, 0, 0]), vec('normal', 'Normal', [0, 1, 0]), n('bounce', 'Bounce', 0.4, 0, 1.5, 0.01), n('friction', 'Friction', 0.1, 0, 1, 0.01), bool('kill', 'Die on impact', false)], apply: (p, v) => { (p.colliders ??= []).push({ type: 'plane', point: V(v.point), normal: V(v.normal, [0, 1, 0]), bounce: v.bounce, friction: v.friction, kill: v.kill }); } },
  { type: 'collisionSphere', context: 'update', category: 'Physics', name: 'Collision (sphere)', doc: 'Particles bounce off a sphere — or are kept inside it.', props: [vec('center', 'Centre', [0, 1, 0]), n('radius', 'Radius', 0.6, 0.01, 100, 0.05), bool('inside', 'Keep inside', false), n('bounce', 'Bounce', 0.4, 0, 1.5, 0.01), n('friction', 'Friction', 0.1, 0, 1, 0.01), bool('kill', 'Die on impact', false)], apply: (p, v) => { (p.colliders ??= []).push({ type: 'sphere', center: V(v.center), radius: v.radius, inside: v.inside, bounce: v.bounce, friction: v.friction, kill: v.kill }); } },
  // Simulation & events
  { type: 'killVolume', context: 'update', category: 'Simulation', name: 'Particle kill (volume)', doc: 'Removes particles inside (or outside) a box or sphere, or below a height.', props: [ch('shape', 'Shape', 'box', ['box', 'sphere', 'below']), vec('center', 'Centre / height', [0, -1, 0]), vec('size', 'Size (sphere: x = radius)', [2, 2, 2]), bool('inside', 'Kill inside (off: outside)', true)], apply: (p, v) => { (p.killVolumes ??= []).push({ shape: v.shape, center: V(v.center), size: V(v.size, [2, 2, 2]), inside: v.inside }); } },
  { type: 'subEmitter', context: 'update', category: 'Events', name: 'Sub-emitter (event)', doc: 'When a particle is born, dies, collides or every interval, spawn particles of another system at its position (fireworks, sparks on impact, smoke puffs on death). The target system usually has no rate of its own.', props: [ch('on', 'On event', 'death', ['birth', 'death', 'collide', 'tick']), sysRef('target', 'Spawn system'), n('count', 'Count', 10, 1, 500, 1), n('chance', 'Chance', 1, 0, 1, 0.01), n('inherit', 'Inherit velocity', 0.2, -2, 2, 0.05), n('interval', 'Tick interval (s)', 0.1, 0.01, 10, 0.01)],
    apply: (p, v, ctx) => { if (!v.target) { ctx.warn('"Sub-emitter" has no target system'); return; } (p.subEmitters ??= []).push({ on: v.on, layer: -1, count: Math.round(v.count), chance: v.chance, inherit: v.inherit, interval: v.interval, ...({ target: v.target } as any) }); } },

  // ---------------------------------------------------------------- Output: appearance
  { type: 'render', context: 'output', category: 'Rendering', name: 'Output particle quad', doc: 'How particles are drawn: a built-in shape or your own picture.', props: [ch('texture', 'Texture', 'circle', ['circle', 'square', 'spark', 'smoke', 'star', 'debris', 'ring', 'glow', 'pixel', 'flare', 'drop', 'leaf']), { key: 'image', label: 'Your own picture', type: 'image', default: '' }, ch('blending', 'Blending', 'additive', ['additive', 'normal']), ch('space', 'Space', 'world', ['world', 'local'])], apply: (p, v) => { p.texture = v.texture; p.textureImage = v.image || undefined; p.blending = v.blending; p.space = v.space; } },
  { type: 'colorOverLife', context: 'output', category: 'Appearance', name: 'Color over life', doc: 'Gradient from birth to death (the middle color is optional).', props: [col('start', 'Start', '#fff1b0'), bool('useMid', 'Use middle', false), col('mid', 'Middle', '#ff9a2a'), col('end', 'End', '#ff3d00')], apply: (p, v) => { p.colorStart = v.start; p.colorEnd = v.end; p.colorMid = v.useMid ? v.mid : ''; } },
  { type: 'gradientOverLife', context: 'output', category: 'Curves', name: 'Color over lifetime (gradient)', doc: 'Any number of colour and opacity stops over the particle\'s life (fire: white → yellow → orange → red → smoke grey).', props: [grd('gradient', 'Gradient', [{ t: 0, c: '#ffffff', a: 1 }, { t: 0.25, c: '#ffd23a', a: 1 }, { t: 0.6, c: '#ff5a1a', a: 0.8 }, { t: 1, c: '#2a2a2a', a: 0 }])], apply: (p, v) => { p.gradient = cloneGrad(v.gradient); } },
  { type: 'alphaOverLife', context: 'output', category: 'Appearance', name: 'Opacity over life', doc: 'Fade in/out. Fade in: the first part of the life (0-1) rises from transparent, so particles never pop in.', props: [n('start', 'Start', 1, 0, 1, 0.01), n('end', 'End', 0, 0, 1, 0.01), n('fadeIn', 'Fade in', 0, 0, 1, 0.01)], apply: (p, v) => { p.alphaStart = v.start; p.alphaEnd = v.end; p.fadeIn = v.fadeIn ?? 0; } },
  { type: 'alphaCurve', context: 'output', category: 'Curves', name: 'Opacity over lifetime (curve)', doc: 'Opacity follows a curve over life (fade in, hold, fade out, flicker).', props: [crv('curve', 'Opacity', [[0, 0], [0.1, 1], [0.7, 0.8], [1, 0]])], apply: (p, v) => { p.alphaCurve = cloneCurve(v.curve); } },
  { type: 'opacity', context: 'output', category: 'Appearance', name: 'Opacity', doc: 'Constant opacity multiplier for the whole system.', props: [n('alpha', 'Opacity', 0.6, 0, 1, 0.01)], apply: (p, v) => { p.alphaStart *= v.alpha; p.alphaEnd *= v.alpha; if (p.alphaCurve) p.alphaCurve = { ...p.alphaCurve, p: p.alphaCurve.p.map(([t, a]) => [t, a * v.alpha] as [number, number]) }; } },
  { type: 'sizeOverLife', context: 'output', category: 'Appearance', name: 'Size over life', doc: 'Size at death, relative to the starting size.', props: [n('end', 'End size ×', 0.2, 0, 20, 0.01)], apply: (p, v) => { p.sizeEnd = p.sizeStart * v.end; } },
  { type: 'sizeCurve', context: 'output', category: 'Curves', name: 'Size over lifetime (curve)', doc: 'Size multiplier along a curve over life (expand, shrink, pop, pulse).', props: [crv('curve', 'Size ×', [[0, 0.3], [0.2, 1], [1, 1.6]])], apply: (p, v) => { p.sizeCurve = cloneCurve(v.curve); } },
  { type: 'stretchCurve', context: 'output', category: 'Curves', name: 'Squash & stretch over lifetime', doc: 'Height ÷ width of each particle over life (cartoon squash and stretch).', props: [crv('curve', 'Height ÷ width', [[0, 1.6], [0.3, 0.8], [1, 1]])], apply: (p, v) => { p.stretchCurve = cloneCurve(v.curve); } },
  { type: 'rotationOverLife', context: 'output', category: 'Curves', name: 'Rotation over lifetime', doc: 'Adds an angle (degrees) that follows a curve over life.', props: [crv('curve', 'Angle (°)', [[0, 0], [1, 180]], 'linear')], apply: (p, v) => { p.rotationCurve = cloneCurve(v.curve); } },
  { type: 'glow', context: 'output', category: 'Appearance', name: 'Glow', doc: 'A soft additive halo around each particle (and its strength over life). Feeds the preview bloom.', props: [n('amount', 'Glow', 0.6, 0, 5, 0.05), n('size', 'Halo size ×', 2.5, 1, 10, 0.1), col('color', 'Glow colour', '#ffffff'), bool('useColor', 'Use glow colour (off: particle colour)', false), crv('curve', 'Glow over life', [[0, 1], [1, 1]])], apply: (p, v) => { p.glow = v.amount; p.glowSize = v.size; p.glowColor = v.useColor ? v.color : undefined; p.glowCurve = cloneCurve(v.curve); } },
  { type: 'emission', context: 'output', category: 'Appearance', name: 'Emission', doc: 'Brightness multiplier above normal colour (hot cores, energy). Over 1 blooms in the preview.', props: [n('intensity', 'Intensity', 2, 0, 20, 0.05)], apply: (p, v) => { p.emission = v.intensity; } },
  { type: 'softParticles', context: 'output', category: 'Rendering', name: 'Soft particles', doc: 'Fades particles where they meet the ground plane and near the camera, hiding hard intersections (smoke, fog).', props: [n('distance', 'Fade distance', 0.4, 0, 10, 0.01)], apply: (p, v) => { p.softness = v.distance; } },
  { type: 'distortion', context: 'output', category: 'Rendering', name: 'Distortion', doc: 'Bends what is behind the particles (heat haze, shockwave rings). Uses the particle texture as the distortion shape.', props: [n('strength', 'Strength', 0.04, -0.5, 0.5, 0.005), bool('hide', 'Distortion only (hide colour)', true)], apply: (p, v) => { p.distortion = v.strength; p.distortionOnly = !!v.hide; } },
  { type: 'trail', context: 'output', category: 'Rendering', name: 'Trail', doc: 'Streaks behind moving particles. Drawn in LogicCraft (2D); GameCraft shows the particles without the streak.', props: [n('length', 'Length (s)', 0.08, 0.005, 1, 0.005)], apply: (p, v) => { p.trail = v.length; } },

  // Rendering: renderer types (one per system)
  { type: 'billboardRenderer', context: 'output', category: 'Rendering', exclusive: 'renderer', name: 'Billboard renderer (camera facing)', doc: 'Flat sprites that always face the camera.', props: [], apply: (p) => { p.renderer = 'billboard'; } },
  { type: 'horizontalRenderer', context: 'output', category: 'Rendering', exclusive: 'renderer', name: 'Horizontal billboard', doc: 'Sprites lying flat on the ground (shockwave rings, decals, ripples, magic circles).', props: [], apply: (p) => { p.renderer = 'horizontal'; } },
  { type: 'verticalRenderer', context: 'output', category: 'Rendering', exclusive: 'renderer', name: 'Vertical billboard', doc: 'Upright sprites that turn around Y only (fire, grass, pillars of light).', props: [], apply: (p) => { p.renderer = 'vertical'; } },
  { type: 'stretchedRenderer', context: 'output', category: 'Rendering', exclusive: 'renderer', name: 'Stretched billboard (velocity)', doc: 'Sprites stretched along their motion (sparks, rain streaks, speed lines).', props: [n('stretch', 'Stretch', 0.08, 0, 2, 0.005)], apply: (p, v) => { p.renderer = 'stretched'; p.stretch = v.stretch; } },
  { type: 'pointRenderer', context: 'output', category: 'Rendering', exclusive: 'renderer', name: 'Point renderer', doc: 'Tiny screen-sized dots (cheap: thousands of stars, dust).', props: [], apply: (p) => { p.renderer = 'point'; } },
  { type: 'meshRenderer', context: 'output', category: 'Rendering', exclusive: 'renderer', name: 'Mesh renderer (low-poly)', doc: 'Real 3D shapes tumbling with their rotation, flat shaded (debris, rocks, gems, confetti).', props: [ch('mesh', 'Mesh', 'shard', ['cube', 'tetra', 'octa', 'shard', 'ico', 'plane'])], apply: (p, v) => { p.renderer = 'mesh'; p.meshShape = v.mesh; } },
  { type: 'ribbonRenderer', context: 'output', category: 'Rendering', exclusive: 'renderer', name: 'Ribbon renderer', doc: 'Connects the particles in the order they were born into one ribbon (sword swipes, beams, magic lines).', props: [n('width', 'Width ×', 1, 0.05, 20, 0.05), bool('taper', 'Taper ends', true)], apply: (p, v) => { p.renderer = 'ribbon'; p.ribbonWidth = v.width; p.ribbonTaper = v.taper; } },
  { type: 'trailRenderer', context: 'output', category: 'Rendering', exclusive: 'renderer', name: 'Trail renderer', doc: 'Each particle drags a smooth tail of its recent positions (comets, fireworks, magic missiles).', props: [n('points', 'Tail points', 12, 2, 64, 1), n('interval', 'Sample every (s)', 0.025, 0.005, 0.5, 0.005), n('width', 'Width ×', 1, 0.05, 20, 0.05), bool('taper', 'Taper', true)], apply: (p, v) => { p.renderer = 'trail'; p.trailPoints = Math.round(v.points); p.trailInterval = v.interval; p.ribbonWidth = v.width; p.ribbonTaper = v.taper; } },
  { type: 'volumetricRenderer', context: 'output', category: 'Rendering', exclusive: 'renderer', name: 'Volumetric-style renderer', doc: 'Soft lit puffs that look like volume: shaded from a light direction with a bright rim (realistic smoke, clouds, dust).', props: [n('lit', 'Lighting', 0.8, 0, 1, 0.01), vec('light', 'Light direction', [0.4, 0.8, 0.3])], apply: (p, v) => { p.renderer = 'volumetric'; p.lit = v.lit; p.lightDir = V(v.light, [0.4, 0.8, 0.3]); } },
  { type: 'spriteRenderer', context: 'output', category: 'Rendering', exclusive: 'renderer', name: 'Sprite renderer', doc: 'Camera-facing sprites drawn crisp with cut-out alpha (pixel art and hand-drawn sprites).', props: [n('clip', 'Alpha cut-out', 0.5, 0, 1, 0.01)], apply: (p, v) => { p.renderer = 'billboard'; p.alphaClip = v.clip; p.style ??= 'sprite'; } },
  { type: 'flipbookRenderer', context: 'output', category: 'Rendering', exclusive: 'renderer', name: 'Flipbook renderer', doc: 'Camera-facing sprites that play the system\'s Flipbook node with frame blending on.', props: [], apply: (p) => { p.renderer = 'billboard'; if (p.flipbook) p.flipbook = { ...p.flipbook, blend: true }; } },
  { type: 'customMaterialRenderer', context: 'output', category: 'Rendering', exclusive: 'renderer', name: 'Custom material renderer', doc: 'Billboards lit and coloured by the system\'s Material node (normal map lighting, emission, dissolve).', props: [n('lit', 'Lighting', 0.6, 0, 1, 0.01)], apply: (p, v) => { p.renderer = 'billboard'; p.lit = v.lit; p.style = 'realistic'; } },
  { type: 'renderStyle', context: 'output', category: 'Rendering', name: 'Render style', doc: 'The look of this system, independent of the others in the effect: pixel-art, cartoon, low-poly, realistic… mix them freely.', props: [ch('style', 'Style', 'smooth', ['smooth', 'basic', 'pixel', 'lowpoly', 'cartoon', 'stylized', 'textured', 'realistic', 'volumetric', 'sprite', 'image']), n('pixels', 'Pixel art resolution', 12, 2, 128, 1), n('outline', 'Cartoon outline (px)', 1.5, 0, 10, 0.1), col('outlineColor', 'Outline colour', '#1a0f0a')], apply: (p, v) => { p.style = v.style; if (v.style === 'pixel') { p.pixelSize = v.pixels; p.filter = 'nearest'; p.alphaClip ??= 0.5; } if (v.style === 'cartoon') { p.outline = v.outline; p.outlineColor = v.outlineColor; p.alphaClip ??= 0.5; } if (v.style === 'lowpoly' && !p.renderer) { p.renderer = 'mesh'; p.meshShape ??= 'shard'; } if (v.style === 'volumetric' && !p.renderer) { p.renderer = 'volumetric'; p.lit ??= 0.8; } if (v.style === 'realistic') { p.softness ??= 0.3; p.lit ??= 0.4; } } },
  { type: 'blendMode', context: 'output', category: 'Rendering', name: 'Blend mode', doc: 'How the system mixes with what is behind: additive (glow, fire), alpha (smoke, debris), premultiplied, multiply (shadows, soot), screen. Additive and alpha systems still sort correctly together.', props: [ch('mode', 'Mode', 'alpha', ['additive', 'alpha', 'premultiplied', 'multiply', 'screen'])], apply: (p, v) => { p.blendMode = v.mode; p.blending = v.mode === 'additive' || v.mode === 'screen' ? 'additive' : 'normal'; } },
  { type: 'textureFilter', context: 'output', category: 'Textures', name: 'Texture filtering', doc: 'Smooth (linear) or sharp pixels (nearest), and a cut-out alpha threshold.', props: [ch('filter', 'Filtering', 'linear', ['linear', 'nearest']), n('clip', 'Alpha cut-out (0 = off)', 0, 0, 1, 0.01)], apply: (p, v) => { p.filter = v.filter; p.alphaClip = v.clip || undefined; } },
  { type: 'sortOrder', context: 'output', category: 'Rendering', name: 'Draw order', doc: 'Which systems draw on top when they are not depth-sorted together (higher on top).', props: [n('order', 'Order', 0, -100, 100, 1)], apply: (p, v) => { p.sortOrder = v.order; } },

  // Textures, flipbooks, materials (pictures come from the texture library or the texture node graph)
  { type: 'texture', context: 'output', category: 'Textures', name: 'Texture', doc: 'The particle picture: an imported image from the texture library, or the output of a texture node. Its own transform: tiling, offset, rotation, flips and scrolling.', props: [tex('texture', 'Texture'), n('tileX', 'Tiling X', 1, 0.05, 32, 0.05), n('tileY', 'Tiling Y', 1, 0.05, 32, 0.05), n('offX', 'Offset X', 0, -4, 4, 0.01), n('offY', 'Offset Y', 0, -4, 4, 0.01), n('rot', 'Rotation (°)', 0, -360, 360, 1), bool('flipX', 'Flip horizontally', false), bool('flipY', 'Flip vertically', false), n('scrollX', 'Scroll X (/s)', 0, -10, 10, 0.01), n('scrollY', 'Scroll Y (/s)', 0, -10, 10, 0.01)],
    apply: (p, v, ctx) => {
      const url = v.texture ? ctx.tex(String(v.texture)) : undefined;
      if (v.texture && !url && !String(v.texture).startsWith('node:')) ctx.warn('"Texture" points at a picture that is missing (re-import it or pick another)');
      if (url) p.textureImage = url;
      const neutral = v.tileX === 1 && v.tileY === 1 && !v.offX && !v.offY && !v.rot && !v.flipX && !v.flipY && !v.scrollX && !v.scrollY;
      p.uv = neutral ? undefined : { scale: [v.tileX, v.tileY], offset: [v.offX, v.offY], rotation: v.rot, flipX: v.flipX, flipY: v.flipY, scroll: [v.scrollX, v.scrollY] };
    } },
  { type: 'flipbook', context: 'output', category: 'Flipbooks', name: 'Flipbook', doc: 'Plays an animated sprite sheet on each particle. Stretch it over the particle\'s lifetime (or play at a frame rate), hold the last frame, hold chosen frames, loop a section with an intro/outro, ping-pong, randomize the start and speed, blend frames, and shape the timing with a curve — no sheet editing needed.',
    props: [tex('texture', 'Sprite sheet'), n('cols', 'Columns', 4, 1, 64, 1), n('rows', 'Rows', 4, 1, 64, 1), n('frames', 'Frame count (0 = all)', 0, 0, 4096, 1),
      ch('mode', 'Timing', 'lifetime', ['lifetime', 'fps']), n('cycles', 'Plays per lifetime', 1, 0.05, 50, 0.05), n('fps', 'Frames per second', 24, 1, 120, 1), n('speedVar', 'Random speed ±', 0, 0, 1, 0.01),
      ch('loop', 'Playback', 'once', ['once', 'loop', 'pingpong']), ch('end', 'When a "once" finishes', 'hold', ['hold', 'hide']), bool('reverse', 'Reverse', false),
      n('start', 'Start frame', 0, 0, 4095, 1), bool('randomStart', 'Random start frame', false), n('delay', 'Start delay (s)', 0, 0, 30, 0.01),
      bool('section', 'Loop a section', false), n('loopStart', 'Section first frame', 4, 0, 4095, 1), n('loopEnd', 'Section last frame', 11, 0, 4095, 1), bool('outro', 'Play the frames after it at the end of life', true),
      { key: 'holds', label: 'Hold frames (frame:extra frames, …)', type: 'text', default: '' },
      { key: 'order', label: 'Frame order (e.g. 0-7, 7, 7, 6-0)', type: 'text', default: '' },
      bool('useCurve', 'Shape progress with a curve', false), crv('curve', 'Progress over life', [[0, 0], [0.3, 0.7], [1, 1]]),
      bool('blend', 'Blend between frames', true), bool('packed', 'Channel-packed (grayscale in R, G, B)', false), n('padding', 'Sheet padding (px)', 0, 0, 512, 1), n('spacing', 'Frame spacing (px)', 0, 0, 512, 1), { key: 'sheetSize', label: '', type: 'text', default: null }],
    apply: (p, v, ctx) => {
      const url = v.texture ? ctx.tex(String(v.texture)) : undefined;
      if (v.texture && !url && !String(v.texture).startsWith('node:')) ctx.warn('"Flipbook" sprite sheet is missing');
      if (url) p.textureImage = url;
      else if (!p.textureImage && !String(v.texture ?? '').startsWith('node:')) ctx.warn('"Flipbook" has no sprite sheet (pick one, or put a Texture before it)');
      const cells = Math.max(1, Math.round(v.cols) * Math.round(v.rows));
      const frames = v.frames > 0 ? Math.min(cells, Math.round(v.frames)) : cells;
      const holds = String(v.holds ?? '').split(/[,;\s]+/).map((s: string) => s.split(':').map(Number)).filter((a: number[]) => a.length === 2 && a.every(Number.isFinite)).map(([frame, extra]: number[]) => ({ frame, extra }));
      p.flipbook = { cols: Math.max(1, Math.round(v.cols)), rows: Math.max(1, Math.round(v.rows)), frames, mode: v.mode, fps: v.fps, cycles: v.cycles, loop: v.loop, end: v.end, reverse: v.reverse,
        startFrame: v.start, randomStart: v.randomStart, speedVar: v.speedVar, delay: v.delay, holds: holds.length ? holds : undefined,
        loopStart: v.section ? v.loopStart : undefined, loopEnd: v.section ? v.loopEnd : undefined, outro: v.outro, curve: v.useCurve ? cloneCurve(v.curve) : undefined, blend: v.blend, channelPacked: v.packed };
      const order = parseFrameOrder(String(v.order ?? ''), frames * (v.packed ? 3 : 1));
      if (order.length) p.flipbook.order = order;
      const sz = v.sheetSize as [number, number] | null;
      if (sz && sz[0] > 0 && sz[1] > 0 && (v.padding > 0 || v.spacing > 0)) { p.flipbook.margin = [v.padding / sz[0], v.padding / sz[1]]; p.flipbook.gap = [v.spacing / sz[0], v.spacing / sz[1]]; }
    } },
  { type: 'material', context: 'output', category: 'Materials', name: 'Material', doc: 'Surface of the particles: normal / height maps for lighting, emission map and colour, alpha mask, gradient map (colour from brightness — for grayscale and channel-packed flipbooks), metallic/roughness highlight, rim (fresnel) light, and dissolve over life with a glowing edge.',
    props: [col('baseColor', 'Base colour', '#ffffff'), n('opacity', 'Opacity (transparency)', 1, 0, 1, 0.01), tex('normal', 'Normal map'), tex('height', 'Height map (makes a normal map)'), tex('emissionMap', 'Emission map'), col('emissionColor', 'Emission colour', '#ffffff'), n('emission', 'Emission strength', 0, 0, 20, 0.05), tex('alphaMap', 'Alpha map'),
      bool('useGradientMap', 'Gradient map (colour from brightness)', false), grd('gradientMap', 'Gradient map', [{ t: 0, c: '#000000', a: 0 }, { t: 0.35, c: '#7a1500', a: 1 }, { t: 0.65, c: '#ff7a10', a: 1 }, { t: 1, c: '#fff6c0', a: 1 }]),
      n('metallic', 'Metallic', 0, 0, 1, 0.01), n('roughness', 'Roughness', 0.6, 0, 1, 0.01), n('rim', 'Rim / fresnel', 0, 0, 3, 0.05), col('rimColor', 'Rim colour', '#ffffff'),
      n('dissolve', 'Dissolve', 0, 0, 1, 0.01), crv('dissolveCurve', 'Dissolve over life', [[0, 0], [0.6, 0], [1, 1]]), n('dissolveEdge', 'Edge width', 0.08, 0, 0.5, 0.005), col('dissolveColor', 'Edge colour', '#ffb040'),
      n('lit', 'Lighting', 0.5, 0, 1, 0.01), n('refraction', 'Refraction', 0, 0, 0.3, 0.005), tex('motion', 'Motion vectors (flipbook)'), n('motionStrength', 'Motion strength', 0.02, 0, 0.2, 0.001)],
    apply: (p, v, ctx) => {
      const T = (r: string) => (r ? ctx.tex(String(r)) : undefined);
      p.material = { normalMap: T(v.normal), heightMap: T(v.height), emissionMap: T(v.emissionMap), emissionColor: v.emissionColor, emissionStrength: v.emission, alphaMap: T(v.alphaMap),
        gradientMap: v.useGradientMap ? cloneGrad(v.gradientMap) : undefined, metallic: v.metallic, roughness: v.roughness, rim: v.rim, rimColor: v.rimColor,
        dissolve: v.dissolve, dissolveCurve: v.dissolve > 0 ? cloneCurve(v.dissolveCurve) : undefined, dissolveEdge: v.dissolveEdge, dissolveColor: v.dissolveColor, motionVectors: T(v.motion), motionStrength: v.motionStrength,
        baseColor: v.baseColor && v.baseColor.toLowerCase() !== '#ffffff' ? v.baseColor : undefined, opacity: v.opacity < 1 ? v.opacity : undefined, refraction: v.refraction > 0 ? v.refraction : undefined };
      if (v.refraction > 0) { p.distortion = v.refraction; p.distortionOnly = false; }
      if (v.lit > 0 && (p.material.normalMap || p.material.heightMap || v.rim > 0 || v.metallic > 0)) p.lit = Math.max(p.lit ?? 0, v.lit);
    } },
];
/** "0-7, 7, 7, 6-0" → [0..7, 7, 7, 6..0]; frames outside 0..count-1 are dropped. */
export function parseFrameOrder(s: string, count: number): number[] {
  const out: number[] = [];
  for (const part of s.split(/[,;\s]+/).filter(Boolean)) {
    const m = part.match(/^(\d+)(?:-(\d+))?$/); if (!m) continue;
    const a = Number(m[1]), b = m[2] != null ? Number(m[2]) : a, st = b >= a ? 1 : -1;
    for (let k = a; st > 0 ? k <= b : k >= b; k += st) { if (k < count) out.push(k); if (out.length > 4096) return out; }
  }
  return out;
}
export const VFX_BLOCK = Object.fromEntries(VFX_BLOCKS.map((b) => [b.type, b])) as Record<string, BlockType>;
export const BLOCK_CATEGORIES: { id: BlockCategory; color: string }[] = [
  { id: 'Emitters', color: '#e07b39' }, { id: 'Spawn', color: '#d9822b' }, { id: 'Initialization', color: '#3d8bd9' }, { id: 'Forces', color: '#8b5cf6' }, { id: 'Physics', color: '#a855f7' },
  { id: 'Simulation', color: '#64748b' }, { id: 'Events', color: '#ef4444' }, { id: 'Appearance', color: '#2fa36b' }, { id: 'Curves', color: '#14b8a6' }, { id: 'Textures', color: '#eab308' },
  { id: 'Flipbooks', color: '#f59e0b' }, { id: 'Materials', color: '#ec4899' }, { id: 'Rendering', color: '#22c55e' },
];
export const CONTEXTS: { id: ContextId; name: string; color: string; doc: string }[] = [
  { id: 'spawn', name: 'Spawn', color: '#d9822b', doc: 'How many particles are born and when.' },
  { id: 'init', name: 'Initialize particle', doc: 'Starting values for each particle.', color: '#3d8bd9' },
  { id: 'update', name: 'Update particle', doc: 'Forces applied every frame.', color: '#8b5cf6' },
  { id: 'output', name: 'Output particle', doc: 'How particles look over their life.', color: '#2fa36b' },
];

/** Ready-made curve shapes for the curve editor. */
export const CURVE_PRESETS: { name: string; curve: Curve }[] = [
  { name: 'Constant', curve: { p: [[0, 1], [1, 1]], mode: 'linear' } },
  { name: 'Fade out', curve: { p: [[0, 1], [1, 0]], mode: 'smooth' } },
  { name: 'Fade in & out', curve: { p: [[0, 0], [0.15, 1], [0.75, 1], [1, 0]], mode: 'smooth' } },
  { name: 'Expand', curve: { p: [[0, 0.2], [1, 1.5]], mode: 'smooth' } },
  { name: 'Pop then shrink', curve: { p: [[0, 0], [0.1, 1.2], [0.25, 1], [1, 0]], mode: 'smooth' } },
  { name: 'Shrink', curve: { p: [[0, 1], [1, 0]], mode: 'linear' } },
  { name: 'Accelerate', curve: { p: [[0, 0], [0.5, 0.15], [1, 1]], mode: 'smooth' } },
  { name: 'Decelerate', curve: { p: [[0, 0], [0.5, 0.85], [1, 1]], mode: 'smooth' } },
  { name: 'Pulse', curve: { p: [[0, 0.4], [0.125, 1], [0.25, 0.4], [0.375, 1], [0.5, 0.4], [0.625, 1], [0.75, 0.4], [0.875, 1], [1, 0.4]], mode: 'smooth' } },
  { name: 'Flicker', curve: { p: [[0, 1], [0.1, 0.4], [0.2, 0.9], [0.3, 0.5], [0.45, 1], [0.6, 0.3], [0.75, 0.8], [0.9, 0.4], [1, 0]], mode: 'linear' } },
  { name: 'Fast start, slow end', curve: { p: [[0, 0], [0.2, 0.7], [1, 1]], mode: 'smooth' } },
  { name: 'Slow start, fast end', curve: { p: [[0, 0], [0.8, 0.3], [1, 1]], mode: 'smooth' } },
];

/** Texture references in blocks: 'asset:<id>' (texture library), 'node:<id>' (texture node graph) or a data URL.
 *  ParticleCraft installs a resolver that turns them into pictures; elsewhere only data URLs resolve. */
let textureResolver: ((ref: string) => string | undefined) | null = null;
export function setTextureResolver(fn: ((ref: string) => string | undefined) | null) { textureResolver = fn; }
export function resolveTexture(ref: string): string | undefined {
  if (!ref) return undefined;
  if (ref.startsWith('data:') || ref.startsWith('http') || ref.startsWith('/') || ref.startsWith('blob:')) return ref;
  return textureResolver?.(ref);
}

export function newBlock(type: string, props: Record<string, any> = {}): VfxBlock {
  const t = VFX_BLOCK[type];
  return { id: newId('vb'), type, enabled: true, props: { ...Object.fromEntries((t?.props ?? []).map((p) => [p.key, Array.isArray(p.default) ? [...p.default] : p.default])), ...props } };
}

export function newSystem(name: string, x = 0, y = 0, blocks: Partial<Record<ContextId, VfxBlock[]>> = {}): VfxSystem {
  return { id: newId('vs'), name, enabled: true, x, y, contexts: { spawn: blocks.spawn ?? [newBlock('rate')], init: blocks.init ?? [newBlock('lifetime'), newBlock('velocity'), newBlock('size'), newBlock('color')], update: blocks.update ?? [], output: blocks.output ?? [newBlock('render'), newBlock('alphaOverLife')] } };
}

/** A neutral starting point: nothing happens unless a block says so. */
const BASE: EmitterParams = { ...DEFAULT_EMITTER, rate: 0, burst: 0, gravity: 0, drag: 0, acceleration: [0, 0, 0], spread: 0, speed: 0, speedVar: 0, sizeVar: 0, rotation: 0, rotationSpeed: 0, collideFloor: false, turbulence: 0, turbulenceFreq: 1, vortex: 0, vortexPull: 0, colorMid: '', trail: 0 };

/** Block property values with exposed parameters applied. */
function propsWithParams(g: VfxGraph, sys: VfxSystem, b: VfxBlock): Record<string, any> {
  const v = { ...b.props };
  for (const prm of g.params) for (const bind of prm.bindings) if (bind.system === sys.id && bind.block === b.id) v[bind.prop] = prm.value;
  return v;
}

/** Sampled shape points, cached (compiling runs on every edit). Rounded to keep saved effects small. */
const pointCache = new Map<string, number[]>();
function shapePoints(s: VfxShape, from: EmitFrom, n: number, seed: number): number[] {
  const { x: _x, y: _y, name: _n, hideOriginal: _h, color: _c, ...geo } = s;
  const key = JSON.stringify([geo, from, n, seed]);
  let pts = pointCache.get(key);
  if (!pts) {
    pts = sampleShape(s, from, n, seed).map((v) => Math.round(v * 1e4) / 1e4);
    if (pointCache.size > 64) pointCache.delete(pointCache.keys().next().value!);
    pointCache.set(key, pts);
  }
  return pts;
}

export interface CompileResult { layers: { name: string; params: EmitterParams }[]; exposed: NonNullable<VfxAsset['exposed']>; warnings: string[] }

export function compileGraph(g: VfxGraph): CompileResult {
  const layers: CompileResult['layers'] = [];
  const warnings: string[] = [];
  const blockLayer = new Map<string, { layer: number; type: string }>();
  const layerOf = new Map<string, number>();
  g.systems.filter((s) => s.enabled).forEach((s, i) => layerOf.set(s.id, i));
  // Systems spawned by another system's sub-emitter need no spawn block of their own.
  const subTargets = new Set<string>();
  for (const s of g.systems) if (s.enabled) for (const b of s.contexts.update) if (b.enabled && b.type === 'subEmitter' && b.props.target) subTargets.add(String(b.props.target));
  for (const sys of g.systems) {
    if (!sys.enabled) continue;
    const p: EmitterParams = { ...BASE, direction: [...BASE.direction] as any, shapeSize: [...BASE.shapeSize] as any };
    const actx: ApplyCtx = { sys, warn: (m) => warnings.push(`${sys.name}: ${m}`), tex: resolveTexture };
    const exclusive = new Map<string, string>();
    for (const ctx of ['spawn', 'init', 'update', 'output'] as ContextId[]) {
      // The quad output goes first so later Texture / Flipbook nodes can replace its picture.
      const list = ctx === 'output' ? [...sys.contexts[ctx]].sort((a, b) => (a.type === 'render' ? 0 : 1) - (b.type === 'render' ? 0 : 1)) : sys.contexts[ctx];
      for (const b of list) {
        const t = VFX_BLOCK[b.type];
        if (!t) { warnings.push(`${sys.name}: unknown block "${b.type}" kept but ignored`); continue; }
        if (t.context !== ctx) { warnings.push(`${sys.name}: "${t.name}" belongs in ${t.context}, ignored in ${ctx}`); continue; }
        if (!b.enabled) continue;
        if (t.exclusive) { const prev = exclusive.get(t.exclusive); if (prev) warnings.push(`${sys.name}: "${t.name}" replaces "${prev}" (one renderer per system)`); exclusive.set(t.exclusive, t.name); }
        t.apply(p, propsWithParams(g, sys, b), actx);
        blockLayer.set(b.id, { layer: layers.length, type: b.type });
      }
    }
    // Timeline and transform of the system inside the effect.
    if (sys.timing) { if (sys.timing.delay > 0) p.delay = sys.timing.delay; if (sys.timing.timeScale > 0 && sys.timing.timeScale !== 1) p.timeScale = sys.timing.timeScale; }
    if (sys.transform) {
      const o = sys.transform.offset, r = sys.transform.rotation;
      if (o.some((x) => x)) p.offset = [(p.offset?.[0] ?? 0) + o[0], (p.offset?.[1] ?? 0) + o[1], (p.offset?.[2] ?? 0) + o[2]];
      if (r.some((x) => x)) p.emitterRotation = [...r] as [number, number, number];
      if (sys.transform.scale !== 1 && sys.transform.scale > 0) p.emitterScale = sys.transform.scale;
    }
    if (sys.sortOrder) p.sortOrder = sys.sortOrder;
    // Sub-emitters: system ids → layer numbers.
    if (p.subEmitters) {
      p.subEmitters = p.subEmitters.flatMap((s: any) => {
        const target = s.target; delete s.target;
        const layer = layerOf.get(target);
        if (layer == null) { warnings.push(`${sys.name}: sub-emitter target system is missing or disabled`); return []; }
        return [{ ...s, layer }];
      });
    }
    if (p.flipbook && !p.textureImage) p.flipbook = undefined;
    // Shape node: particles are born on its sampled points.
    const emit = sys.contexts.init.find((b) => b.type === 'shapeEmit' && b.enabled);
    const shape = sys.source ? g.shapes?.find((s) => s.id === sys.source) : undefined;
    if (sys.source && !shape) warnings.push(`${sys.name}: its shape node is missing`);
    if (shape) {
      const v = emit ? propsWithParams(g, sys, emit) : { from: 'surface', points: 512 };
      p.shape = 'mesh';
      p.meshPoints = shapePoints(shape, v.from as EmitFrom, Math.max(32, Math.min(4096, Math.round(Number(v.points) || 512))), p.seed);
      p.meshEdges = v.from === 'edges';
      if (!p.meshPoints.length) warnings.push(`${sys.name}: the shape "${shape.name}" has no surface`);
    } else if (emit || (p.cling ?? 0) > 0) warnings.push(`${sys.name}: "Emit from shape node" / "Cling to shape" need a shape node (System › Source shape)`);
    if (p.rate <= 0 && p.burst <= 0 && !p.bursts?.length && !subTargets.has(sys.id)) warnings.push(`${sys.name}: no Constant rate or Burst, so it spawns nothing`);
    if (!sys.contexts.output.some((b) => b.enabled && (b.type === 'render' || b.type === 'texture' || b.type === 'flipbook' || VFX_BLOCK[b.type]?.exclusive === 'renderer'))) warnings.push(`${sys.name}: no "Output particle quad" (uses circles)`);
    layers.push({ name: sys.name, params: p });
  }
  // Exposed parameters map to the engine fields their blocks write, so games can change them at runtime.
  const FIELD: Record<string, Record<string, string>> = {
    rate: { rate: 'rate' }, burst: { count: 'burst' }, velocity: { speed: 'speed', spread: 'spread', random: 'speedVar' }, size: { size: 'sizeStart' },
    gravity: { strength: 'gravity' }, drag: { amount: 'drag' }, turbulence: { strength: 'turbulence', frequency: 'turbulenceFreq' }, vortex: { strength: 'vortex', pull: 'vortexPull' },
    color: { color: 'colorStart' }, colorOverLife: { start: 'colorStart', end: 'colorEnd', mid: 'colorMid' }, alphaOverLife: { start: 'alphaStart', end: 'alphaEnd' }, trail: { length: 'trail' }, capacity: { max: 'maxParticles' },
    continuousEmitter: { rate: 'rate' }, radialVelocity: { speed: 'radialSpeed' }, glow: { amount: 'glow' }, emission: { intensity: 'emission' }, softParticles: { distance: 'softness' },
    distortion: { strength: 'distortion' }, stretchedRenderer: { stretch: 'stretch' }, prewarm: { seconds: 'prewarm' }, sphereEmitter: { radial: 'radialSpeed' }, coneEmitter: { angle: 'spread', speed: 'speed' },
    directionalEmitter: { speed: 'speed', spread: 'spread' }, rotation: { spin: 'rotationSpeed' }, gradientOverLife: { gradient: 'gradient' }, sizeCurve: { curve: 'sizeCurve' }, alphaCurve: { curve: 'alphaCurve' },
  };
  const exposed = g.params.map((prm) => ({ name: prm.name, type: prm.type, value: prm.value, targets: prm.bindings.flatMap((b) => { const bl = blockLayer.get(b.block); const f = bl && FIELD[bl.type]?.[b.prop]; return bl && f ? [{ layer: bl.layer, param: f }] : []; }) }));
  if (!layers.length) warnings.push('The effect has no enabled systems');
  return { layers, exposed, warnings };
}

/** What each game cannot reproduce from these layers (shown before export, never silently dropped). */
export function compatibilityOf(layers: { name: string; params: EmitterParams }[]): { gamecraft: string[]; logiccraft: string[] } {
  const gc: string[] = [], lc: string[] = [];
  for (const l of layers) {
    const p = l.params, m = p.material;
    // GameCraft draws camera-facing point sprites (flipbooks, emission, pixel art, blend modes and sub-emitters work).
    if (p.renderer === 'ribbon' || p.renderer === 'trail') gc.push(`${l.name}: ${p.renderer}s are drawn as thin lines`);
    if ((p.lit ?? 0) > 0 && (m?.normalMap || m?.heightMap)) gc.push(`${l.name}: lit with a soft volume shape; normal / height maps are not used`);
    if (p.distortion) gc.push(`${l.name}: distortion / refraction is not drawn`);
    if (p.softness) gc.push(`${l.name}: soft particles fade is not applied`);
    if (m?.dissolve || m?.gradientMap || m?.emissionMap || m?.alphaMap || m?.motionVectors) gc.push(`${l.name}: material maps (dissolve, gradient/emission/alpha maps, motion vectors) are not applied`);
    if (p.style === 'cartoon') gc.push(`${l.name}: cartoon outlines are not drawn (cut-out edges are)`);
    // LogicCraft draws 2D on a canvas.
    if (p.renderer && ['mesh', 'ribbon', 'trail', 'volumetric'].includes(p.renderer)) lc.push(`${l.name}: the ${p.renderer} renderer is drawn as flat sprites`);
    if (p.distortion || m || p.softness) lc.push(`${l.name}: materials, distortion and soft particles are not drawn in 2D`);
    if (l.params.trail > 0) gc.push(`${l.name}: trails are drawn as thin lines in 3D`);
    if (l.params.shape === 'sphere' || l.params.shape === 'box' || l.params.shape === 'mesh' || l.params.direction[2] !== 0) lc.push(`${l.name}: depth (Z) is flattened onto the 2D stage`);
    if (l.params.collideFloor) lc.push(`${l.name}: floor collision uses the stage's Y = ${l.params.floorY}`);
  }
  return { gamecraft: gc, logiccraft: lc };
}

export function newAsset(name: string, graph: VfxGraph, category = 'Custom'): VfxAsset {
  const t = new Date().toISOString();
  return { format: VFX_FORMAT, schemaVersion: VFX_SCHEMA, id: newId('vfx'), name, kind: 'realtime', category, created: t, modified: t, graph };
}

/** Fill in layers, exposed parameters and compatibility notes before saving or exporting. */
export function finalizeAsset(a: VfxAsset): VfxAsset {
  if (a.kind !== 'realtime' || !a.graph) return a;
  const r = compileGraph(a.graph);
  const compat = compatibilityOf(r.layers);
  // Shape nodes shown with the effect (Hide original off) travel with it; the games draw the basic shapes.
  const shown = (a.graph.shapes ?? []).filter((s) => !s.hideOriginal && a.graph!.systems.some((sy) => sy.enabled && sy.source === s.id));
  for (const s of shown) if (s.kind === 'mesh') compat.gamecraft.push(`Shape "${s.name}": an imported object is not drawn in the game (import the model itself into GameCraft)`);
  if (shown.length) compat.logiccraft.push('Shown shapes are not drawn in 2D (only the particles)');
  return { ...a, layers: r.layers, exposed: r.exposed, compatibility: compat, shapes: shown.length ? shown.map(({ mesh: _m, ...s }) => s) : undefined, modified: new Date().toISOString() };
}

export function parseVfxAsset(text: string): VfxAsset {
  const a = JSON.parse(text);
  if (a?.format !== VFX_FORMAT) throw new Error('Not a ParticleCraft effect (craft.vfx)');
  if (a.schemaVersion > VFX_SCHEMA) throw new Error('This effect was made by a newer ParticleCraft');
  return a as VfxAsset;
}

// ------------------------------------------------------------------ presets (all editable graphs)

type Sys = Parameters<typeof newSystem>[3];
const B = newBlock;
/** Systems sit side by side: `col` is the column index. */
const sys = (name: string, col: number, blocks: Sys) => newSystem(name, col * 330, 0, blocks);
const out = (texture: string, blending: 'additive' | 'normal', start: string, end: string, a0 = 1, a1 = 0, sizeEnd = 0.2, mid?: string, fadeIn = 0) => [
  B('render', { texture, blending }), B('colorOverLife', { start, end, useMid: !!mid, mid: mid ?? '#ffffff' }), B('alphaOverLife', { start: a0, end: a1, fadeIn }), B('sizeOverLife', { end: sizeEnd }),
];

export interface VfxPreset { id: string; name: string; category: string; description: string; build: () => VfxGraph; /** stylized (default), realistic or hybrid (mixes styles). */ look?: 'stylized' | 'realistic' | 'hybrid' }

export const VFX_PRESETS: VfxPreset[] = [
  { id: 'campfire', name: 'Campfire', category: 'Fire & smoke', description: 'Flames with rising embers and a little smoke.', build: () => ({ params: [], systems: [
    sys('Flames', 0, { spawn: [B('rate', { rate: 70 })], init: [B('lifetime', { min: 0.5, max: 0.9 }), B('shape', { shape: 'circle', size: [0.35, 0, 0.35] }), B('velocity', { direction: [0, 1, 0], speed: 1.8, random: 0.5, spread: 12 }), B('size', { size: 0.5, random: 0.1 })], update: [B('gravity', { strength: 1.5 }), B('turbulence', { strength: 1.2, frequency: 1.5 })], output: out('smoke', 'additive', '#fff1b0', '#ff2200', 0.9, 0, 0.1, '#ff9a2a') }),
    sys('Embers', 1, { spawn: [B('rate', { rate: 12 })], init: [B('lifetime', { min: 1.2, max: 2.2 }), B('shape', { shape: 'circle', size: [0.3, 0, 0.3] }), B('velocity', { direction: [0, 1, 0], speed: 2.5, random: 1, spread: 25 }), B('size', { size: 0.06, random: 0.02 })], update: [B('turbulence', { strength: 3, frequency: 2 }), B('drag', { amount: 0.4 })], output: [...out('spark', 'additive', '#ffd27a', '#ff4400', 1, 0, 0.5), B('trail', { length: 0.05 })] }),
    sys('Smoke', 2, { spawn: [B('rate', { rate: 8 })], init: [B('lifetime', { min: 2, max: 3.5 }), B('shape', { shape: 'circle', size: [0.2, 0, 0.2] }), B('velocity', { direction: [0, 1, 0], speed: 1, random: 0.3, spread: 15 }), B('size', { size: 0.4, random: 0.1 }), B('rotation', { spin: 30 })], update: [B('gravity', { strength: 0.4 }), B('turbulence', { strength: 0.6, frequency: 0.6 })], output: out('smoke', 'normal', '#6a6a6a', '#2a2a2a', 0.35, 0, 4) }),
  ] }) },
  { id: 'smoke-plume', name: 'Smoke plume', category: 'Fire & smoke', description: 'Thick drifting smoke.', build: () => ({ params: [], systems: [sys('Smoke', 0, { spawn: [B('rate', { rate: 20 })], init: [B('lifetime', { min: 2.5, max: 4 }), B('shape', { shape: 'circle', size: [0.4, 0, 0.4] }), B('velocity', { speed: 1.2, random: 0.4, spread: 20 }), B('size', { size: 0.5, random: 0.15 }), B('rotation', { spin: 25 })], update: [B('gravity', { strength: 0.5 }), B('force', { force: [0.6, 0, 0] }), B('turbulence', { strength: 0.8, frequency: 0.5 }), B('drag', { amount: 0.3 })], output: out('smoke', 'normal', '#8a8a8a', '#3a3a3a', 0.5, 0, 3.5) })] }) },
  { id: 'steam', name: 'Steam', category: 'Fire & smoke', description: 'Fast white vapor that fades quickly.', build: () => ({ params: [], systems: [sys('Steam', 0, { spawn: [B('rate', { rate: 35 })], init: [B('lifetime', { min: 0.8, max: 1.4 }), B('velocity', { speed: 2.5, random: 0.6, spread: 10 }), B('size', { size: 0.2, random: 0.05 })], update: [B('turbulence', { strength: 1, frequency: 1.2 }), B('drag', { amount: 0.8 })], output: out('smoke', 'normal', '#ffffff', '#dfe8ef', 0.45, 0, 4) })] }) },
  { id: 'splash', name: 'Water splash', category: 'Water', description: 'A burst of droplets that falls and bounces.', build: () => ({ params: [], systems: [
    sys('Droplets', 0, { spawn: [B('burst', { count: 80 }), B('duration', { loop: false, duration: 0.05 })], init: [B('lifetime', { min: 0.8, max: 1.4 }), B('velocity', { speed: 5, random: 2, spread: 35 }), B('size', { size: 0.09, random: 0.03 })], update: [B('gravity', { strength: -14 }), B('collide', { floor: 0, bounce: 0.25 })], output: [...out('circle', 'normal', '#cfefff', '#5aa9e6', 0.9, 0.2, 0.6), B('trail', { length: 0.03 })] }),
    sys('Mist', 1, { spawn: [B('burst', { count: 20 }), B('duration', { loop: false, duration: 0.05 })], init: [B('lifetime', { min: 0.6, max: 1 }), B('velocity', { speed: 1.5, random: 0.5, spread: 70 }), B('size', { size: 0.3 })], update: [B('drag', { amount: 1.5 })], output: out('smoke', 'normal', '#e8f6ff', '#bfe2ff', 0.4, 0, 2.5) }),
  ] }) },
  // Waterfall: a curtain of water pouring over a lip (a line 1 m wide along X, falling toward +Z and down: scale the
  // emitter to the river's width and turn it to face downstream), and its mist and spray at the foot.
  { id: 'waterfall', name: 'Waterfall', category: 'Water', description: 'A curtain of water pouring over a lip, with loose droplets. Stretch the emitter to the width of the fall.', build: () => ({ params: [], systems: [
    sys('Sheet', 0, { spawn: [B('rate', { rate: 260 }), B('capacity', { max: 2400 })], init: [B('lifetime', { min: 1.5, max: 1.9 }), B('shape', { shape: 'box', size: [1, 0, 0.15] }), B('velocity', { direction: [0, -0.3, 1], speed: 1.6, random: 0.3, spread: 5 }), B('size', { size: 0.22, random: 0.06 })], update: [B('gravity', { strength: -9.8 }), B('turbulence', { strength: 0.3, frequency: 1.5 })], output: out('smoke', 'normal', '#ffffff', '#cfe6f5', 0.8, 0.15, 2.2) }),
    sys('Droplets', 1, { spawn: [B('rate', { rate: 60 })], init: [B('lifetime', { min: 1.2, max: 1.6 }), B('shape', { shape: 'box', size: [1, 0, 0.15] }), B('velocity', { direction: [0, -0.2, 1], speed: 2, random: 0.6, spread: 18 }), B('size', { size: 0.05, random: 0.02 })], update: [B('gravity', { strength: -9.8 })], output: [...out('circle', 'normal', '#ffffff', '#bfe0f5', 0.9, 0.3, 0.8), B('trail', { length: 0.03 })] }),
  ] }) },
  { id: 'waterfall-mist', name: 'Waterfall mist', category: 'Water', description: 'Spray and drifting mist where falling water lands.', build: () => ({ params: [], systems: [
    sys('Mist', 0, { spawn: [B('rate', { rate: 30 }), B('capacity', { max: 500 })], init: [B('lifetime', { min: 2.5, max: 4 }), B('shape', { shape: 'circle', size: [1.2, 0, 1.2] }), B('velocity', { direction: [0, 1, 0], speed: 0.8, random: 0.4, spread: 60 }), B('size', { size: 1.2, random: 0.4 }), B('rotation', { spin: 20 })], update: [B('gravity', { strength: 0.3 }), B('turbulence', { strength: 0.6, frequency: 0.5 }), B('drag', { amount: 0.6 })], output: out('smoke', 'normal', '#ffffff', '#e6f2fa', 0.35, 0, 2.5) }),
    sys('Spray', 1, { spawn: [B('rate', { rate: 45 })], init: [B('lifetime', { min: 0.5, max: 0.9 }), B('shape', { shape: 'circle', size: [1, 0, 1] }), B('velocity', { direction: [0, 1, 0], speed: 3, random: 1, spread: 35 }), B('size', { size: 0.06, random: 0.02 })], update: [B('gravity', { strength: -9.8 })], output: out('circle', 'normal', '#ffffff', '#cfe6f5', 0.9, 0.2, 0.6) }),
  ] }) },
  { id: 'fountain', name: 'Flowing water', category: 'Water', description: 'A continuous fountain arc.', build: () => ({ params: [{ id: newId('vp'), name: 'Pressure', type: 'number', value: 7, bindings: [] }], systems: [sys('Stream', 0, { spawn: [B('rate', { rate: 180 }), B('capacity', { max: 1200 })], init: [B('lifetime', { min: 1.2, max: 1.6 }), B('velocity', { direction: [0.25, 1, 0], speed: 7, random: 0.4, spread: 4 }), B('size', { size: 0.08, random: 0.02 })], update: [B('gravity', { strength: -9.8 }), B('collide', { floor: 0, bounce: 0.1 })], output: out('circle', 'normal', '#bfe7ff', '#3f8fd9', 0.85, 0.3, 1.2) })] }) },
  { id: 'rain', name: 'Rain', category: 'Weather', description: 'Streaking rain over a wide area.', build: () => ({ params: [], systems: [sys('Rain', 0, { spawn: [B('rate', { rate: 400 }), B('capacity', { max: 1500 })], init: [B('lifetime', { min: 1, max: 1.3 }), B('shape', { shape: 'box', size: [30, 0, 30] }), B('velocity', { direction: [0, -1, 0], speed: 14, random: 2, spread: 3 }), B('size', { size: 0.05 })], update: [B('collide', { floor: 0, bounce: 0 })], output: [...out('spark', 'normal', '#9ec9ff', '#9ec9ff', 0.7, 0.6, 1), B('trail', { length: 0.04 })] })] }) },
  { id: 'snow', name: 'Snow', category: 'Weather', description: 'Slow tumbling flakes.', build: () => ({ params: [], systems: [sys('Snow', 0, { spawn: [B('rate', { rate: 120 }), B('capacity', { max: 1200 })], init: [B('lifetime', { min: 5, max: 7 }), B('shape', { shape: 'box', size: [30, 0, 30] }), B('velocity', { direction: [0, -1, 0], speed: 1.2, random: 0.3, spread: 20 }), B('size', { size: 0.12, random: 0.04 }), B('rotation', { spin: 40 })], update: [B('turbulence', { strength: 0.6, frequency: 0.4 })], output: out('circle', 'normal', '#ffffff', '#e8f0ff', 1, 0.8, 1) })] }) },
  { id: 'tornado', name: 'Tornado', category: 'Wind', description: 'A swirling funnel with debris.', build: () => ({ params: [{ id: newId('vp'), name: 'Spin', type: 'number', value: 9, bindings: [] }], systems: [
    sys('Funnel', 0, { spawn: [B('rate', { rate: 160 }), B('capacity', { max: 1400 })], init: [B('lifetime', { min: 2.5, max: 3.5 }), B('shape', { shape: 'circle', size: [0.6, 0, 0.6] }), B('velocity', { direction: [0, 1, 0], speed: 2.5, random: 0.5, spread: 8 }), B('size', { size: 0.35, random: 0.1 })], update: [B('vortex', { strength: 9, pull: -0.6 }), B('turbulence', { strength: 0.6, frequency: 0.8 })], output: out('smoke', 'normal', '#9a9488', '#5c574d', 0.45, 0, 2.5) }),
    sys('Debris', 1, { spawn: [B('rate', { rate: 25 })], init: [B('lifetime', { min: 2, max: 3 }), B('shape', { shape: 'circle', size: [1.2, 0, 1.2] }), B('velocity', { speed: 3, random: 1, spread: 30 }), B('size', { size: 0.12, random: 0.05 }), B('rotation', { spin: 300 })], update: [B('vortex', { strength: 7, pull: 0.8 }), B('gravity', { strength: -1 })], output: out('debris', 'normal', '#6b4a2a', '#3a2a1a', 1, 0.8, 1) }),
  ] }) },
  { id: 'wind', name: 'Swirling wind', category: 'Wind', description: 'Gusty streaks drifting sideways.', build: () => ({ params: [], systems: [sys('Gusts', 0, { spawn: [B('rate', { rate: 40 })], init: [B('lifetime', { min: 1.5, max: 2.5 }), B('shape', { shape: 'box', size: [2, 4, 2] }), B('velocity', { direction: [1, 0, 0], speed: 5, random: 1, spread: 10 }), B('size', { size: 0.05 })], update: [B('turbulence', { strength: 4, frequency: 0.7 })], output: [...out('spark', 'additive', '#dfefff', '#a9c8e8', 0.6, 0, 1), B('trail', { length: 0.15 })] })] }) },
  { id: 'explosion', name: 'Explosion', category: 'Impacts', description: 'Fireball, sparks and a smoke ring.', build: () => ({ params: [], systems: [
    sys('Fireball', 0, { spawn: [B('burst', { count: 120 }), B('duration', { loop: false, duration: 0.1 })], init: [B('lifetime', { min: 0.5, max: 1.1 }), B('shape', { shape: 'sphere', size: [0.3, 0.3, 0.3] }), B('velocity', { speed: 8, random: 4, spread: 180 }), B('size', { size: 0.7, random: 0.2 })], update: [B('drag', { amount: 2.5 }), B('gravity', { strength: -2 })], output: out('smoke', 'additive', '#fff1b0', '#ff3d00', 1, 0, 0.15, '#ff9a2a') }),
    sys('Sparks', 1, { spawn: [B('burst', { count: 60 }), B('duration', { loop: false, duration: 0.05 })], init: [B('lifetime', { min: 0.4, max: 0.9 }), B('velocity', { speed: 14, random: 5, spread: 180 }), B('size', { size: 0.07 })], update: [B('gravity', { strength: -14 }), B('drag', { amount: 0.6 })], output: [...out('spark', 'additive', '#fff6c0', '#ff7a00', 1, 0, 0.5), B('trail', { length: 0.05 })] }),
    sys('Smoke ring', 2, { spawn: [B('burst', { count: 40 }), B('duration', { loop: false, duration: 0.1 })], init: [B('lifetime', { min: 1.5, max: 2.5 }), B('velocity', { speed: 3, random: 1, spread: 180 }), B('size', { size: 0.6 })], update: [B('drag', { amount: 1.5 }), B('gravity', { strength: 0.8 })], output: out('smoke', 'normal', '#5a5a5a', '#2a2a2a', 0.5, 0, 3) }),
  ] }) },
  { id: 'impact', name: 'Impact sparks', category: 'Impacts', description: 'Short spray of sparks and dust for hits.', build: () => ({ params: [], systems: [sys('Sparks', 0, { spawn: [B('burst', { count: 35 }), B('duration', { loop: false, duration: 0.02 })], init: [B('lifetime', { min: 0.2, max: 0.45 }), B('velocity', { direction: [0, 1, 0], speed: 7, random: 2, spread: 60 }), B('size', { size: 0.08 })], update: [B('gravity', { strength: -12 })], output: [...out('spark', 'additive', '#ffffff', '#ffb347', 1, 0, 0.3), B('trail', { length: 0.03 })] })] }) },
  { id: 'electric', name: 'Electric arc', category: 'Electric', description: 'Jittery blue-white sparks.', build: () => ({ params: [], systems: [sys('Arc', 0, { spawn: [B('rate', { rate: 90 })], init: [B('lifetime', { min: 0.08, max: 0.2 }), B('shape', { shape: 'sphere', size: [0.4, 0.4, 0.4] }), B('velocity', { speed: 6, random: 4, spread: 180 }), B('size', { size: 0.06 })], update: [B('turbulence', { strength: 30, frequency: 6 })], output: [...out('spark', 'additive', '#ffffff', '#4fb4ff', 1, 0, 0.5), B('trail', { length: 0.04 })] })] }) },
  { id: 'magic', name: 'Magic spell', category: 'Magic', description: 'Orbiting stars with a soft glow.', build: () => ({ params: [{ id: newId('vp'), name: 'Glow color', type: 'color', value: '#d9a6ff', bindings: [] }], systems: [
    sys('Stars', 0, { spawn: [B('rate', { rate: 50 })], init: [B('lifetime', { min: 0.9, max: 1.4 }), B('shape', { shape: 'sphere', size: [0.6, 0.6, 0.6] }), B('velocity', { speed: 0.8, random: 0.3, spread: 180 }), B('size', { size: 0.16 }), B('rotation', { spin: 180 })], update: [B('vortex', { strength: 4, pull: 0.5 }), B('gravity', { strength: 0.6 })], output: out('star', 'additive', '#d9a6ff', '#4fd2ff', 1, 0, 0) }),
    sys('Glow', 1, { spawn: [B('rate', { rate: 10 })], init: [B('lifetime', { min: 0.6, max: 0.9 }), B('size', { size: 1.2 })], output: out('circle', 'additive', '#b07cff', '#4fd2ff', 0.25, 0, 1.4) }),
  ] }) },
  { id: 'energy', name: 'Energy burst', category: 'Magic', description: 'A ring of energy that bursts outward.', build: () => ({ params: [], systems: [sys('Ring', 0, { spawn: [B('burst', { count: 90 }), B('duration', { loop: false, duration: 0.02 })], init: [B('lifetime', { min: 0.5, max: 0.7 }), B('shape', { shape: 'circle', size: [0.2, 0, 0.2] }), B('velocity', { direction: [0, 0.05, 0], speed: 6, random: 0.3, spread: 90 }), B('size', { size: 0.15 })], update: [B('drag', { amount: 2 })], output: [...out('star', 'additive', '#9ff8ff', '#2a6bff', 1, 0, 0.3), B('trail', { length: 0.06 })] })] }) },
  { id: 'dust', name: 'Dust motes', category: 'Environment', description: 'Floating dust in the air.', build: () => ({ params: [], systems: [sys('Dust', 0, { spawn: [B('rate', { rate: 15 })], init: [B('lifetime', { min: 4, max: 7 }), B('shape', { shape: 'box', size: [6, 3, 6] }), B('velocity', { speed: 0.1, random: 0.05, spread: 180 }), B('size', { size: 0.04, random: 0.02 })], update: [B('turbulence', { strength: 0.3, frequency: 0.3 })], output: out('circle', 'additive', '#fff4d6', '#ffe2a8', 0.85, 0, 1, undefined, 0.3) })] }) },
  { id: 'fog', name: 'Ground fog', category: 'Environment', description: 'Low rolling fog.', build: () => ({ params: [], systems: [sys('Fog', 0, { spawn: [B('rate', { rate: 10 })], init: [B('lifetime', { min: 6, max: 9 }), B('shape', { shape: 'box', size: [12, 0.2, 12] }), B('velocity', { direction: [1, 0, 0], speed: 0.3, random: 0.1, spread: 30 }), B('size', { size: 2.5, random: 0.6 }), B('rotation', { spin: 8 })], update: [B('turbulence', { strength: 0.15, frequency: 0.2 })], output: out('smoke', 'normal', '#d8dde3', '#c9cfd6', 0.4, 0, 1.5, undefined, 0.35) })] }) },
  { id: 'trail', name: 'Movement trail', category: 'Trails', description: 'A glowing trail for moving objects (attach it to a character or projectile).', build: () => ({ params: [], systems: [sys('Trail', 0, { spawn: [B('rate', { rate: 90 }), B('capacity', { max: 800 })], init: [B('lifetime', { min: 0.6, max: 0.9 }), B('shape', { shape: 'sphere', size: [0.08, 0.08, 0.08] }), B('velocity', { speed: 0.15, random: 0.1, spread: 180 }), B('size', { size: 0.22, random: 0.04 })], output: out('circle', 'additive', '#7df9ff', '#5a3bff', 0.9, 0, 0.1), update: [B('drag', { amount: 1.5 })] })] }) },
];

/** Which block property each preset's exposed parameter drives (system index, block type, property). */
const PRESET_LINKS: Record<string, { param: string; system: number; block: string; prop: string }[]> = {
  tornado: [{ param: 'Spin', system: 0, block: 'vortex', prop: 'strength' }],
  fountain: [{ param: 'Pressure', system: 0, block: 'velocity', prop: 'speed' }],
  magic: [{ param: 'Glow color', system: 1, block: 'colorOverLife', prop: 'start' }, { param: 'Glow color', system: 0, block: 'colorOverLife', prop: 'start' }],
};
for (const p of VFX_PRESETS) {
  const links = PRESET_LINKS[p.id];
  if (!links) continue;
  const build = p.build;
  p.build = () => {
    const g = build();
    for (const l of links) {
      const prm = g.params.find((x) => x.name === l.param), s = g.systems[l.system];
      const b = s && (['spawn', 'init', 'update', 'output'] as ContextId[]).flatMap((c) => s.contexts[c]).find((x) => x.type === l.block);
      if (prm && s && b) prm.bindings.push({ system: s.id, block: b.id, prop: l.prop });
    }
    return g;
  };
}

// Leaves: the supplied leaf pictures. One system per picture, so an effect mixes variations. Falling drifts down and spins;
// in the wind they travel sideways and tumble. Every setting is an ordinary block in the graph.
const leafSystems = (pics: string[], wind: boolean, size: number) => pics.map((image, k) => sys(`Leaves ${k + 1}`, k, {
  spawn: [B('rate', { rate: wind ? 14 / pics.length : 9 / pics.length }), B('capacity', { max: 400 })],
  init: [B('lifetime', { min: wind ? 4 : 5, max: wind ? 7 : 9 }), B('shape', { shape: 'box', size: wind ? [1, 3, 8] : [6, 0.5, 6] }), B('velocity', { direction: wind ? [1, 0.15, 0.1] : [0, -1, 0], speed: wind ? 3.5 : 0.4, random: wind ? 1.5 : 0.2, spread: wind ? 25 : 40 }), B('size', { size, random: size * 0.3 }), B('rotation', { angle: 180, spin: wind ? 320 : 110 }), B('seed', { seed: 11 + k * 7 })],
  update: [B('gravity', { strength: wind ? -0.35 : -0.9 }), B('drag', { amount: wind ? 0.25 : 0.8 }), B('turbulence', { strength: wind ? 2.6 : 1.3, frequency: wind ? 0.5 : 0.7 }), ...(wind ? [B('force', { force: [1.6, 0.25, 0.4] })] : [B('collide', { floor: 0, bounce: 0.05 })])],
  output: [B('render', { texture: 'square', image, blending: 'normal' }), B('colorOverLife', { start: '#ffffff', end: '#ffffff' }), B('alphaOverLife', { start: 1, end: 0.6, fadeIn: 0.08 }), B('sizeOverLife', { end: 1 })],
}));
const LEAF_PICS = { realistic: [LEAF_IMAGES.golden, LEAF_IMAGES.red, LEAF_IMAGES.maple, LEAF_IMAGES.dryOak], stylized: [LEAF_IMAGES.stylizedA, LEAF_IMAGES.stylizedB], pixel: [LEAF_IMAGES.pixel] };
for (const [id, name, pics, size] of [['realistic', 'Realistic', LEAF_PICS.realistic, 0.22], ['stylized', 'Stylized', LEAF_PICS.stylized, 0.24], ['pixel', 'Pixel art', LEAF_PICS.pixel, 0.2]] as const) {
  VFX_PRESETS.push({ id: `falling-leaves-${id}`, name: `Falling leaves (${name})`, category: 'Leaves', description: 'Leaves drift down from above, spinning, and settle on the floor.', build: () => ({ params: [], systems: leafSystems([...pics], false, size) }) });
  VFX_PRESETS.push({ id: `wind-leaves-${id}`, name: `Leaves in the wind (${name})`, category: 'Leaves', description: 'Leaves carried sideways by the wind, tumbling in gusts.', build: () => ({ params: [], systems: leafSystems([...pics], true, size) }) });
}

// Flipbook presets: each bakes its own animated sprite sheet in the texture graph (noise → mask → colour → Texture
// sequence) and plays it with a Flipbook node, so they need no outside pictures and every step can be edited.
type TN = VfxTexNode;
const tn = (type: string, x: number, y: number, props: Record<string, any>, inputs: Record<string, string> = {}, name?: string): TN => ({ id: newId('vt'), type, x, y, props, inputs, name });
/** noise → (× radial mask) → [extra steps] → gradient map → sequence. Returns the nodes and the sequence node's id. */
export function bakedSheet(noise: { type: string; props: Record<string, any> }, gradient: GradientStop[], seq: Record<string, any>, extra?: (src: TN) => TN[]): { nodes: TN[]; out: string } {
  const nz = tn(noise.type, -900, 0, { size: 96, ...noise.props }, {}, 'Noise');
  const mask = tn('radialGradient', -900, 170, { size: 96, radius: 0.5, falloff: 1.6 }, {}, 'Soft mask');
  const mul = tn('blend', -700, 60, { mode: 'multiply' }, { a: nz.id, b: mask.id }, 'Masked noise');
  const more = extra ? extra(mul) : [];
  const last = more.length ? more[more.length - 1] : mul;
  const col = tn('gradientMap', -500, 60, { gradient }, { in: last.id }, 'Colour');
  const sq = tn('sequence', -300, 60, { cols: 4, rows: 4, frameSize: 96, duration: 2, loop: true, ...seq }, { in: col.id }, 'Flipbook sheet');
  return { nodes: [nz, mask, mul, ...more, col, sq], out: sq.id };
}
export const FIRE_GRAD: GradientStop[] = [{ t: 0, c: '#000000', a: 0 }, { t: 0.25, c: '#7a1200', a: 0.8 }, { t: 0.55, c: '#ff6a10', a: 1 }, { t: 0.8, c: '#ffd060', a: 1 }, { t: 1, c: '#fffbe8', a: 1 }];
export const SMOKE_GRAD: GradientStop[] = [{ t: 0, c: '#9a9a9a', a: 0 }, { t: 0.18, c: '#9a9a9a', a: 0 }, { t: 0.45, c: '#c8c8c8', a: 0.65 }, { t: 1, c: '#ffffff', a: 1 }];
export const MAGIC_GRAD: GradientStop[] = [{ t: 0, c: '#000000', a: 0 }, { t: 0.4, c: '#5a1aff', a: 0.9 }, { t: 0.75, c: '#d07aff', a: 1 }, { t: 1, c: '#ffffff', a: 1 }];
const fbBlock = (out: string, o: Record<string, any>) => B('flipbook', { texture: 'node:' + out, cols: 4, rows: 4, frames: 16, ...o });

VFX_PRESETS.push(
  { id: 'flipbook-fire', name: 'Flipbook fire (baked)', category: 'Flipbooks', description: 'Animated fire sheet baked from turbulence in the texture graph, stretched over each flame\'s lifetime with frame blending, plus embers.', build: () => {
    const s = bakedSheet({ type: 'turbulence', props: { scale: 3, octaves: 4, evolve: 1.4 } }, FIRE_GRAD, {});
    return { params: [], texNodes: s.nodes, systems: [
      sys('Flames', 0, { spawn: [B('rate', { rate: 22 })], init: [B('lifetime', { min: 0.9, max: 1.3 }), B('circleEmitter', { radius: 0.25 }), B('velocity', { speed: 1.3, random: 0.3, spread: 10 }), B('size', { size: 0.9, random: 0.2 }), B('randomRotation', { range: 25, spin: 0, spinRandom: 20 })], update: [B('curlNoise', { strength: 0.6, frequency: 1 })],
        output: [B('render', { texture: 'smoke', blending: 'additive' }), fbBlock(s.out, { mode: 'lifetime', cycles: 1, loop: 'once', blend: true }), B('sizeCurve', { curve: { p: [[0, 0.5], [0.3, 1], [1, 0.6]], mode: 'smooth' } }), B('alphaCurve', { curve: { p: [[0, 0], [0.15, 1], [0.7, 0.8], [1, 0]], mode: 'smooth' } }), B('glow', { amount: 0.25, size: 2 }), B('emission', { intensity: 1.3 })] }),
      sys('Embers', 1, { spawn: [B('rate', { rate: 14 })], init: [B('lifetime', { min: 1, max: 2 }), B('circleEmitter', { radius: 0.3 }), B('velocity', { speed: 2.4, random: 1, spread: 25 }), B('size', { size: 0.05, random: 0.02 })], update: [B('curlNoise', { strength: 2.5, frequency: 1.5 }), B('drag', { amount: 0.4 })],
        output: [B('render', { texture: 'spark', blending: 'additive' }), B('colorOverLife', { start: '#ffe08a', end: '#ff3d00' }), B('alphaOverLife', { start: 1, end: 0 }), B('stretchedRenderer', { stretch: 0.05 }), B('glow', { amount: 0.5, size: 3 })] }),
    ] };
  } },
  { id: 'flipbook-smoke-hold', name: 'Smoke puffs (flipbook, hold last frame)', category: 'Flipbooks', description: 'A short smoke animation played at 10 fps that holds its last frame for the rest of a long life — the classic fix for flipbooks that end too early. Lit like a volume.', build: () => {
    const s = bakedSheet({ type: 'turbulence', props: { scale: 3, octaves: 5, evolve: 0.8 } }, SMOKE_GRAD, { duration: 1.5, loop: false });
    return { params: [], texNodes: s.nodes, systems: [
      sys('Smoke', 0, { spawn: [B('rate', { rate: 6 })], init: [B('lifetime', { min: 4, max: 5 }), B('circleEmitter', { radius: 0.3 }), B('velocity', { speed: 0.6, random: 0.2, spread: 15 }), B('size', { size: 1, random: 0.2 }), B('randomRotation', { range: 180, spin: 10, spinRandom: 8 })], update: [B('curlNoise', { strength: 0.3, frequency: 0.5 }), B('wind', { direction: [1, 0, 0], speed: 0.5, coupling: 0.3, gust: 0.5, gustFreq: 0.4 })],
        output: [B('render', { texture: 'smoke', blending: 'normal' }), fbBlock(s.out, { mode: 'fps', fps: 10, loop: 'once', end: 'hold', blend: true }), B('volumetricRenderer', { lit: 0.8, light: [0.5, 0.9, 0.3] }), B('colorOverLife', { start: '#9a9a9a', end: '#5a5a5a' }), B('sizeCurve', { curve: { p: [[0, 0.4], [1, 2.2]], mode: 'smooth' } }), B('alphaCurve', { curve: { p: [[0, 0], [0.1, 0.7], [0.6, 0.5], [1, 0]], mode: 'smooth' } }), B('softParticles', { distance: 0.4 })] }),
    ] };
  } },
  { id: 'flipbook-magic-loop', name: 'Magic orbs (flipbook section loop)', category: 'Flipbooks', description: 'A kaleidoscope energy sheet: frames 0–3 play once as an intro, 4–11 loop for as long as the orb lives, and 12–15 play as it dies.', build: () => {
    const s = bakedSheet({ type: 'perlin', props: { scale: 4, evolve: 1.5 } }, MAGIC_GRAD, { duration: 2.5 }, (src) => {
      const sym = tn('symmetry', -700, 230, { count: 6, mirror: true }, { in: src.id }, 'Kaleidoscope');
      const tw = tn('twirl', -700, 400, { angle: 220, radius: 0.5 }, { in: sym.id }, 'Twirl');
      return [sym, tw];
    });
    return { params: [], texNodes: s.nodes, systems: [
      sys('Orbs', 0, { spawn: [B('rate', { rate: 4 })], init: [B('lifetime', { min: 3, max: 4 }), B('sphereEmitter', { radius: 0.8 }), B('size', { size: 0.6, random: 0.1 })], update: [B('orbit', { pos: [0, 0.6, 0], axis: [0, 1, 0], speed: 1.2, pull: 0.3 })],
        output: [B('render', { texture: 'glow', blending: 'additive' }), fbBlock(s.out, { mode: 'fps', fps: 12, loop: 'loop', section: true, loopStart: 4, loopEnd: 11, outro: true, blend: true }), B('alphaCurve', { curve: { p: [[0, 0], [0.05, 1], [0.9, 1], [1, 0]], mode: 'linear' } }), B('glow', { amount: 0.6, size: 2.5 })] }),
    ] };
  } },
);

VFX_PRESETS.push(...realisticPresets());

export const VFX_CATEGORIES = [...new Set(VFX_PRESETS.map((p) => p.category))];
