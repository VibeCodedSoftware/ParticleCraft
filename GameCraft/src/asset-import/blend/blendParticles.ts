// Particle systems of a .blend, read natively (ParticleSettings of each object's particle systems), in the shared
// Blender particle format (Shared/src/vfx/blender.ts).
import { BlendFile, type SView } from './blendFile';
import type { BlenderParticles } from '@shared/src/vfx/blender';

const EMIT_FROM = ['VERT', 'FACE', 'VOLUME'] as const;
const PHYS = ['NO', 'NEWTON', 'KEYED', 'BOIDS', 'FLUID'] as const;
/** DNA ren_as values (PART_DRAW_*). */
const RENDER: Record<number, BlenderParticles['renderAs']> = { 0: 'NONE', 1: 'HALO', 2: 'LINE', 3: 'PATH', 7: 'OBJECT', 8: 'COLLECTION' };
/** Linear colour → sRGB hex (same curve as the add-on). */
const hex = (r: number, g: number, b: number) => '#' + [r, g, b].map((v) => { v = Math.max(0, Math.min(1, v)); const s = v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055; return Math.round(s * 255).toString(16).padStart(2, '0'); }).join('');

/** Object name → its particle systems. */
export function readBlendParticles(input: ArrayBuffer | Uint8Array | BlendFile): Map<string, BlenderParticles[]> {
  const bf = input instanceof BlendFile ? input : new BlendFile(input);
  const sc = bf.idBlocks('SC')[0];
  const rd = sc?.sub('r');
  const fps = rd ? (rd.num('frs_sec') || 24) / (rd.num('frs_sec_base') || 1) : 24;
  const ps = sc?.sub('physics_settings');
  const sceneGravity = ps ? ps.num('gravity', 2) || -9.81 : -9.81;
  const out = new Map<string, BlenderParticles[]>();
  for (const ob of bf.idBlocks('OB')) {
    const list = bf.list(ob.sub('particlesystem'));
    if (!list.length) continue;
    // The object's first material colour (the particles' material slot when it has one).
    const me = ob.get('data');
    const matColor = (slot: number) => {
      const n = me?.num('totcol') ?? 0;
      const mats = me ? bf.ptrArray(me.ptr('mat'), n, me.owner) : [];
      const m = mats[Math.max(0, Math.min(mats.length - 1, slot - 1))];
      const v: SView | null = m ? bf.deref(m) : null;
      return v ? hex(v.num('r'), v.num('g'), v.num('b')) : '#ffffff';
    };
    const systems: BlenderParticles[] = [];
    for (const psys of list) {
      const p = psys.get('part');
      if (!p) continue;
      const ew = p.get('effector_weights');
      const gw = ew ? ew.num('global_gravity') : 1;
      const ob3 = p.has('ob_vel') ? p.nums('ob_vel') : [0, 0, 0];
      systems.push({
        name: psys.str('name') || p.idName() || 'ParticleSystem',
        type: p.num('type') === 2 ? 'HAIR' : 'EMITTER',
        count: Math.max(0, p.num('totpart')),
        frameStart: p.num('sta'), frameEnd: p.num('end'),
        lifetime: p.num('lifetime') || 50, lifetimeRandom: p.num('randlife'),
        emitFrom: EMIT_FROM[p.num('from')] ?? 'FACE',
        normalVelocity: p.num('normfac'), randomVelocity: p.num('randfac'), tangentVelocity: p.num('tanfac'),
        objectVelocity: [ob3[0] ?? 0, ob3[1] ?? 0, ob3[2] ?? 0],
        physics: PHYS[p.num('phystype')] ?? 'NEWTON',
        gravity: sceneGravity * gw,
        damping: p.num('dampfac'), drag: p.num('dragfac'), brownian: p.num('brownfac'),
        size: p.num('size') || 0.05, sizeRandom: p.num('randsize'),
        angularVelocity: p.num('avefac'),
        renderAs: RENDER[p.num('ren_as')] ?? 'HALO',
        color: matColor(p.num('omat') || 1),
        fps,
      });
    }
    if (systems.length) out.set(ob.idName(), systems);
  }
  return out;
}
