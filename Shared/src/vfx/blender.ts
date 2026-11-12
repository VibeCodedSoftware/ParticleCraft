// Blender particle systems → ParticleCraft. Two sources give the same settings: a .blend read natively (the apps'
// own .blend reader) and the "Craft Export" Blender add-on (.craftfx.json). Each particle system becomes a
// "Blender Particle Effect" node: a normal, editable system made of ParticleCraft blocks, connected to the object's
// shape node so particles are born on the real emitter geometry. What cannot be reproduced exactly is approximated
// and listed in the node's notes, never dropped silently.
import { newId } from '../schema';
import { finalizeAsset, newAsset, newBlock, newSystem, type BlenderOrigin, type VfxAsset, type VfxGraph, type VfxSystem } from './vfx';
import { newShape, normalizeMesh, type VfxShape } from './shapes';

export interface BlenderParticles {
  name: string;
  type: 'EMITTER' | 'HAIR';
  count: number;
  frameStart: number; frameEnd: number;
  /** Frames. */
  lifetime: number; lifetimeRandom: number;
  emitFrom: 'VERT' | 'FACE' | 'VOLUME';
  normalVelocity: number; randomVelocity: number; tangentVelocity?: number;
  /** Blender's object-aligned velocity (X, Y, Z in Blender's Z-up axes). */
  objectVelocity?: [number, number, number];
  physics: 'NO' | 'NEWTON' | 'KEYED' | 'BOIDS' | 'FLUID';
  /** Scene gravity along Blender Z × the system's gravity weight (m/s², negative falls). */
  gravity: number;
  damping: number; drag: number; brownian: number;
  /** Particle size (Blender "Scale") and its randomness (0..1). */
  size: number; sizeRandom: number;
  angularVelocity?: number;
  renderAs: 'HALO' | 'LINE' | 'PATH' | 'OBJECT' | 'COLLECTION' | 'NONE';
  /** Material base colour of the particles (hex). */
  color: string;
  fps: number;
}

/** What the Craft Export add-on writes (`<name>.craftfx.json`). */
export interface CraftFx {
  format: 'craft.blendfx'; version: number;
  source: string; fps: number;
  objects: { name: string; tris: number[]; color?: string; particleSystems: BlenderParticles[] }[];
}

/** One Blender particle system as a ParticleCraft system on a shape node. */
export function blenderSystem(p: BlenderParticles, shapeId: string, file: string, object: string): VfxSystem {
  const notes: string[] = [];
  const fps = p.fps || 24;
  const span = Math.max(0, p.frameEnd - p.frameStart);
  const life = Math.max(0.05, p.lifetime / fps);
  const burst = span <= 1;
  if (!burst) notes.push(`Emission frames ${p.frameStart}–${p.frameEnd} become a steady rate that loops (${Math.round(p.count / (span / fps))}/s).`);
  if (p.type === 'HAIR') notes.push('Hair systems are strands in Blender; here they emit as particles.');
  if (p.physics === 'KEYED' || p.physics === 'BOIDS' || p.physics === 'FLUID') notes.push(`${p.physics[0] + p.physics.slice(1).toLowerCase()} physics is approximated with Newtonian motion.`);
  if (p.emitFrom === 'VERT') notes.push('"Emit from: Verts" uses the surface (points spread over the faces).');
  if (p.renderAs === 'OBJECT' || p.renderAs === 'COLLECTION') notes.push(`Render as ${p.renderAs.toLowerCase()}: each particle is drawn as a debris quad, not the instanced ${p.renderAs === 'OBJECT' ? 'object' : 'collection'}.`);
  if (p.renderAs === 'PATH') notes.push('Render as path: drawn as streaks.');
  if (p.brownian > 0) notes.push('Brownian motion is approximated with turbulence.');
  const [ox, oy, oz] = p.objectVelocity ?? [0, 0, 0];
  const align = Math.hypot(ox, oy, oz);
  const blocks = {
    spawn: [
      ...(burst ? [newBlock('burst', { count: Math.min(5000, p.count) }), newBlock('duration', { loop: false, duration: 0.05 })] : [newBlock('rate', { rate: Math.round((p.count / (span / fps)) * 10) / 10 })]),
      newBlock('capacity', { max: Math.min(5000, Math.max(50, Math.ceil(burst ? p.count : (p.count / (span / fps)) * life * (1 + p.lifetimeRandom) * 1.1))) }),
    ],
    init: [
      newBlock('lifetime', { min: Math.round(life * (1 - Math.min(1, p.lifetimeRandom)) * 100) / 100, max: Math.round(life * 100) / 100 }),
      newBlock('shapeEmit', { from: p.emitFrom === 'VOLUME' ? 'volume' : 'surface', outward: Math.round(p.normalVelocity * 100) / 100, points: 1024 }),
      // Blender Z-up → Y-up: (x, y, z) → (x, z, -y).
      newBlock('velocity', { direction: align ? [ox / align, oz / align, -oy / align] : [0, 1, 0], speed: Math.round(align * 100) / 100, random: Math.round(p.randomVelocity * 100) / 100, spread: p.randomVelocity > 0 ? 180 : 0 }),
      newBlock('size', { size: Math.max(0.005, Math.round(p.size * 2 * 1000) / 1000), random: Math.round(p.size * 2 * p.sizeRandom * 1000) / 1000 }),
      newBlock('color', { color: p.color || '#ffffff', alpha: 1 }),
      ...(p.angularVelocity ? [newBlock('rotation', { spin: Math.min(1440, Math.abs(p.angularVelocity) * 57.3) })] : []),
    ],
    update: [
      ...(p.physics !== 'NO' && p.gravity ? [newBlock('gravity', { strength: Math.round(p.gravity * 100) / 100 })] : []),
      ...(p.damping || p.drag ? [newBlock('drag', { amount: Math.round((p.damping * fps * 0.5 + p.drag) * 100) / 100 })] : []),
      ...(p.brownian ? [newBlock('turbulence', { strength: Math.round(p.brownian * 2 * 100) / 100, frequency: 1.5 })] : []),
    ],
    output: [
      newBlock('render', { texture: p.renderAs === 'LINE' || p.renderAs === 'PATH' ? 'spark' : p.renderAs === 'OBJECT' || p.renderAs === 'COLLECTION' ? 'debris' : 'circle', blending: p.renderAs === 'HALO' ? 'additive' : 'normal' }),
      ...(p.renderAs === 'LINE' || p.renderAs === 'PATH' ? [newBlock('trail', { length: 0.06 })] : []),
    ],
  };
  const sys = newSystem(`${p.name} (Blender)`, 0, 0, blocks);
  sys.source = shapeId;
  sys.origin = { kind: 'blender', file, object, system: p.name, settings: { ...p }, notes } satisfies BlenderOrigin;
  return sys;
}

/** Add an imported object (and its Blender particle systems) to a graph: an Object node + one system each. */
export function addBlenderObject(g: VfxGraph, file: string, obj: { name: string; tris: ArrayLike<number>; color?: string; particleSystems: BlenderParticles[] }, fit = 3): { shape: VfxShape; systems: VfxSystem[] } {
  const shapes = (g.shapes ??= []);
  const shape = newShape('mesh', newId('vsh'), -300, shapes.length * 100);
  shape.name = obj.name; shape.position = [0, 0, 0]; shape.color = obj.color ?? '#9aa7b8';
  shape.mesh = { tris: normalizeMesh(obj.tris, fit), source: file };
  // An object with particles is hidden by default (the effect is the point); a plain object is shown so you can see what you emit from.
  shape.hideOriginal = obj.particleSystems.length > 0;
  shapes.push(shape);
  const maxX = Math.max(-270, ...g.systems.map((s) => s.x));
  const systems = obj.particleSystems.map((p, k) => { const s = blenderSystem(p, shape.id, file, obj.name); s.x = maxX + 330 * (k + 1); s.y = 0; return s; });
  g.systems.push(...systems);
  return { shape, systems };
}

/**
 * A Blender add-on export as a ready-to-play effect for the games (GameCraft / LogicCraft import): one layer per
 * particle system, born on the object's real geometry (at its real size, centred on the object's middle).
 * `model` names the .glb the add-on wrote next to it, so GameCraft can bring the object in and attach the effect.
 */
export function craftFxToAsset(fx: CraftFx, fileName: string): VfxAsset {
  const g: VfxGraph = { systems: [], params: [] };
  const objects: NonNullable<VfxAsset['blender']>['objects'] = [];
  for (const o of fx.objects) {
    if (!o.particleSystems.length) continue;
    const r = addBlenderObject(g, fx.source, o, 1e9);
    let y0 = Infinity, y1 = -Infinity; for (let i = 1; i < o.tris.length; i += 3) { y0 = Math.min(y0, o.tris[i]); y1 = Math.max(y1, o.tris[i]); }
    objects.push({ name: o.name, height: y1 > y0 ? y1 - y0 : 0, systems: r.systems.length });
  }
  const base = fileName.replace(/\.craftfx\.json$/i, '');
  const a = newAsset(base, g, 'Blender');
  a.description = `From Blender: ${fx.source} (${objects.map((o) => o.name).join(', ') || 'no particle systems'}).`;
  a.blender = { file: fx.source, model: base + '.glb', objects };
  return finalizeAsset(a);
}

export function parseCraftFx(text: string): CraftFx {
  const j = JSON.parse(text);
  if (j?.format !== 'craft.blendfx') throw new Error('Not a Craft Export file from the Blender add-on (.craftfx.json)');
  if (!Array.isArray(j.objects)) throw new Error('The file has no objects');
  return j as CraftFx;
}

/** Blender settings of a node, back to a fresh system (Reset to Blender settings). */
export function resetBlenderSystem(s: VfxSystem): VfxSystem {
  if (!s.origin) return s;
  const fresh = blenderSystem(s.origin.settings as BlenderParticles, s.source ?? '', s.origin.file, s.origin.object);
  return { ...fresh, id: s.id, x: s.x, y: s.y, name: s.name };
}
