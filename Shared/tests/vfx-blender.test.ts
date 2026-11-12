// Blender particle systems → Blender Particle Effect nodes (editable systems on the object's shape node).
import { describe, expect, it } from 'vitest';
import { addBlenderObject, blenderSystem, parseCraftFx, resetBlenderSystem, type BlenderParticles } from '../src/vfx/blender';
import { compileGraph, newBlock, type VfxGraph } from '../src/vfx/vfx';

const fire: BlenderParticles = { name: 'Flames', type: 'EMITTER', count: 1000, frameStart: 1, frameEnd: 201, lifetime: 24, lifetimeRandom: 0.5, emitFrom: 'FACE', normalVelocity: 1.5, randomVelocity: 0.3, objectVelocity: [0, 0, 2], physics: 'NEWTON', gravity: -9.81 * 0.2, damping: 0.02, drag: 0, brownian: 0.4, size: 0.05, sizeRandom: 0.2, renderAs: 'HALO', color: '#ff7a1a', fps: 24 };
const cube = [-1, -1, -1, 1, -1, -1, 1, 1, -1, -1, -1, -1, 1, 1, -1, -1, 1, -1, -1, -1, 1, 1, 1, 1, 1, -1, 1];

describe('Blender particle import', () => {
  it('turns Blender settings into blocks (rate, lifetime, emission, velocity, forces, look)', () => {
    const s = blenderSystem(fire, 'shp', 'fire.blend', 'Torch');
    const block = (t: string) => [...s.contexts.spawn, ...s.contexts.init, ...s.contexts.update, ...s.contexts.output].find((b) => b.type === t)?.props;
    expect(block('rate')!.rate).toBeCloseTo(1000 / (200 / 24), 0); // 1000 particles over 200 frames at 24 fps
    expect(block('lifetime')).toEqual({ min: 0.5, max: 1 }); // 24 frames, 50 % random
    expect(block('shapeEmit')!.from).toBe('surface'); expect(block('shapeEmit')!.outward).toBe(1.5);
    expect(block('velocity')!.direction).toEqual([0, 1, -0]); // Blender +Z (up) → +Y
    expect(block('gravity')!.strength).toBeCloseTo(-1.96, 1);
    expect(block('render')!.blending).toBe('additive');
    expect(block('color')!.color).toBe('#ff7a1a');
    expect(s.origin?.kind).toBe('blender');
    expect(s.origin?.notes.some((n) => /steady rate/.test(n))).toBe(true); // approximations are listed
  });
  it('adds an Object node and a connected, compilable system; plain objects become visible Object nodes', () => {
    const g: VfxGraph = { systems: [], params: [] };
    const r = addBlenderObject(g, 'fire.blend', { name: 'Torch', tris: cube, particleSystems: [fire, { ...fire, name: 'Sparks', count: 50, frameStart: 1, frameEnd: 1, renderAs: 'LINE', physics: 'BOIDS', type: 'HAIR' }] });
    expect(r.shape.kind).toBe('mesh'); expect(r.shape.hideOriginal).toBe(true);
    expect(g.systems.map((s) => s.source)).toEqual([r.shape.id, r.shape.id]);
    const c = compileGraph(g);
    expect(c.warnings).toEqual([]);
    expect(c.layers.map((l) => l.params.shape)).toEqual(['mesh', 'mesh']);
    expect(c.layers[1].params.burst).toBe(50); // one-frame emission = a burst
    expect(g.systems[1].origin!.notes.join(' ')).toMatch(/Boids.*Hair|Hair.*Boids/s);
    const plain = addBlenderObject(g, 'rock.fbx', { name: 'Rock', tris: cube, particleSystems: [] });
    expect(plain.shape.hideOriginal).toBe(false);
  });
  it('keeps edits until "Reset to Blender settings"', () => {
    const s = blenderSystem(fire, 'shp', 'fire.blend', 'Torch');
    s.contexts.update.push(newBlock('vortex'));
    s.name = 'My flames';
    const r = resetBlenderSystem(s);
    expect(r.id).toBe(s.id); expect(r.name).toBe('My flames');
    expect(r.contexts.update.some((b) => b.type === 'vortex')).toBe(false);
  });
  it('reads the add-on file and rejects others', () => {
    const fx = parseCraftFx(JSON.stringify({ format: 'craft.blendfx', version: 1, source: 'a.blend', fps: 24, objects: [{ name: 'A', tris: cube, particleSystems: [fire] }] }));
    expect(fx.objects[0].particleSystems[0].name).toBe('Flames');
    expect(() => parseCraftFx('{"format":"x"}')).toThrow(/Craft Export/);
  });
});
