// ParticleCraft 2.0 engine: emitter shapes, forces, collisions, sub-emitters, curves/gradients, flipbook timing,
// and that the new blocks compile into those engine fields.
import { describe, expect, it } from 'vitest';
import { Emitter, evalCurve, evalGradient, flipbookFrame, linkEmitters, type FlipbookParams } from '../src/runtime/particles';
import { VFX_BLOCKS, compileGraph, newBlock, newSystem, setTextureResolver } from '../src/vfx/vfx';

const run = (e: Emitter, s: number, dt = 1 / 60) => { for (let t = 0; t < s; t += dt) e.update(dt); };

describe('curves and gradients', () => {
  it('interpolates and clamps', () => {
    const c = { p: [[0, 0], [0.5, 1], [1, 0]] as [number, number][], mode: 'linear' as const };
    expect(evalCurve(c, -1)).toBe(0); expect(evalCurve(c, 0.25)).toBeCloseTo(0.5); expect(evalCurve(c, 0.5)).toBe(1); expect(evalCurve(c, 2)).toBe(0);
    expect(evalCurve({ p: [[0, 0], [1, 1]], mode: 'step' }, 0.7)).toBe(0);
    const g = evalGradient([{ t: 0, c: '#000000', a: 0 }, { t: 1, c: '#ffffff', a: 1 }], 0.5);
    expect(g[0]).toBeCloseTo(0.5); expect(g[3]).toBeCloseTo(0.5);
  });
  it('size / alpha curves and the gradient drive the particle', () => {
    const e = new Emitter('a', { rate: 0, burst: 1, lifetime: 1, lifetimeVar: 0, sizeStart: 2, sizeVar: 0, sizeCurve: { p: [[0, 0], [1, 1]], mode: 'linear' }, alphaCurve: { p: [[0, 1], [1, 0]] }, gradient: [{ t: 0, c: '#ff0000' }, { t: 1, c: '#0000ff' }] });
    e.update(0.5);
    expect(e.sizeAt(0)).toBeCloseTo(1, 1);
    expect(e.colorAt(0)[0]).toBeCloseTo(0.5, 1);
    expect(e.alphaAt(0)).toBeGreaterThan(0.3);
  });
});

describe('emitter shapes and bursts', () => {
  it('ring, hemisphere and shell spawn where they should', () => {
    const ring = new Emitter('r', { rate: 0, burst: 200, speed: 0, speedVar: 0, shape: 'ring', shapeSize: [2, 0, 2], ringThickness: 0 });
    ring.update(0.001);
    for (let i = 0; i < ring.count; i++) expect(Math.hypot(ring.px[i], ring.pz[i])).toBeCloseTo(2, 3);
    const hemi = new Emitter('h', { rate: 0, burst: 200, speed: 0, speedVar: 0, shape: 'hemisphere', shapeSize: [1, 1, 1] });
    hemi.update(0.001);
    for (let i = 0; i < hemi.count; i++) expect(hemi.py[i]).toBeGreaterThanOrEqual(0);
    const shell = new Emitter('s', { rate: 0, burst: 100, speed: 0, speedVar: 0, shape: 'sphere', shapeSize: [1, 1, 1], emitShell: true });
    shell.update(0.001);
    for (let i = 0; i < shell.count; i++) expect(Math.hypot(shell.px[i], shell.py[i], shell.pz[i])).toBeCloseTo(1, 3);
  });
  it('repeating bursts fire every interval', () => {
    const e = new Emitter('b', { rate: 0, burst: 0, lifetime: 10, lifetimeVar: 0, looping: false, duration: 2, bursts: [{ time: 0, count: 5, cycles: 3, interval: 0.5 }] });
    run(e, 0.2); expect(e.count).toBe(5);
    run(e, 0.5); expect(e.count).toBe(10);
    run(e, 1); expect(e.count).toBe(15);
  });
  it('a start delay holds the layer back', () => {
    const e = new Emitter('d', { rate: 100, burst: 0, delay: 0.5 });
    run(e, 0.4); expect(e.count).toBe(0);
    run(e, 0.3); expect(e.count).toBeGreaterThan(0);
  });
  it('radial speed pushes away from the centre', () => {
    const e = new Emitter('x', { rate: 0, burst: 50, speed: 0, speedVar: 0, shape: 'sphere', shapeSize: [1, 1, 1], radialSpeed: 5 });
    e.update(0.01);
    for (let i = 0; i < e.count; i++) expect(e.px[i] * e.vx[i] + e.py[i] * e.vy[i] + e.pz[i] * e.vz[i]).toBeGreaterThan(0);
  });
});

describe('forces and collisions', () => {
  const base = { rate: 0, burst: 30, lifetime: 10, lifetimeVar: 0, speed: 0, speedVar: 0, shape: 'sphere' as const, shapeSize: [2, 2, 2] as [number, number, number], seed: 5 };
  it('attraction pulls inward, repulsion pushes out, absorb removes', () => {
    const at = new Emitter('a', { ...base, forces: [{ type: 'attract', pos: [0, 0, 0], strength: 20, radius: 0 }] });
    const re = new Emitter('b', { ...base, forces: [{ type: 'attract', pos: [0, 0, 0], strength: -20, radius: 0 }] });
    const d0 = (e: Emitter) => { let s = 0; for (let i = 0; i < e.count; i++) s += Math.hypot(e.px[i], e.py[i], e.pz[i]); return s / e.count; };
    at.update(0.001); re.update(0.001);
    const a0 = d0(at), r0 = d0(re);
    run(at, 0.2); run(re, 0.2);
    expect(d0(at)).toBeLessThan(a0); expect(d0(re)).toBeGreaterThan(r0);
    const ab = new Emitter('c', { ...base, forces: [{ type: 'attract', pos: [0, 0, 0], strength: 50, radius: 0, killRadius: 0.5 }] });
    run(ab, 3); expect(ab.count).toBeLessThan(30);
  });
  it('curl noise, wind, noise and random movement all move particles', () => {
    for (const f of [{ type: 'curl', strength: 5, frequency: 1 }, { type: 'wind', direction: [1, 0, 0], speed: 5, coupling: 2, gust: 0.5, gustFreq: 1 }, { type: 'noise', strength: 5, frequency: 1 }, { type: 'random', strength: 2 }] as any[]) {
      const e = new Emitter('f', { ...base, forces: [f] });
      e.update(0.001); const x = e.px[0], y = e.py[0];
      run(e, 0.3);
      expect(Math.hypot(e.px[0] - x, e.py[0] - y), f.type).toBeGreaterThan(0.01);
    }
  });
  it('wind carries particles downwind', () => {
    const e = new Emitter('w', { ...base, forces: [{ type: 'wind', direction: [1, 0, 0], speed: 6, coupling: 3, gust: 0, gustFreq: 1 }] });
    e.update(0.001); run(e, 1);
    let vx = 0; for (let i = 0; i < e.count; i++) vx += e.vx[i];
    expect(vx / e.count).toBeGreaterThan(4);
  });
  it('orbit keeps the radius, speed limit clamps', () => {
    const e = new Emitter('o', { rate: 0, burst: 1, lifetime: 10, lifetimeVar: 0, speed: 0, speedVar: 0, shape: 'point', offset: [0, 0, 0], forces: [{ type: 'orbit', pos: [-1, 0, 0], axis: [0, 1, 0], speed: 2, pull: 0 }, { type: 'speedLimit', max: 1.5 }] });
    run(e, 2);
    expect(Math.hypot(e.vx[0], e.vy[0], e.vz[0])).toBeLessThanOrEqual(1.5001);
  });
  it('ground interaction bounces with friction and planes can kill', () => {
    const e = new Emitter('g', { rate: 0, burst: 10, lifetime: 5, lifetimeVar: 0, speed: 2, speedVar: 0, direction: [1, -1, 0], spread: 0, gravity: -9.8, colliders: [{ type: 'plane', point: [0, -0.5, 0], normal: [0, 1, 0], bounce: 0.5, friction: 0.2 }] });
    run(e, 2);
    for (let i = 0; i < e.count; i++) expect(e.py[i]).toBeGreaterThanOrEqual(-0.5001);
    const k = new Emitter('k', { rate: 0, burst: 10, lifetime: 5, lifetimeVar: 0, speed: 0, speedVar: 0, gravity: -9.8, colliders: [{ type: 'plane', point: [0, -0.5, 0], normal: [0, 1, 0], bounce: 0, friction: 0, kill: true }] });
    run(k, 2); expect(k.count).toBe(0);
  });
  it('kill volumes remove particles', () => {
    const e = new Emitter('kv', { ...base, killVolumes: [{ shape: 'sphere', center: [0, 0, 0], size: [10, 0, 0], inside: true }] });
    run(e, 0.1); expect(e.count).toBe(0);
  });
});

describe('sub-emitters', () => {
  it('death and collision events spawn particles in the target layer', () => {
    const parent = new Emitter('p', { rate: 0, burst: 4, lifetime: 0.3, lifetimeVar: 0, speed: 1, gravity: -20, collideFloor: true, floorY: -0.1, bounce: 0.2, subEmitters: [{ on: 'death', layer: 1, count: 5, inherit: 0, chance: 1 }, { on: 'collide', layer: 2, count: 1, inherit: 0, chance: 1 }] });
    const deathKids = new Emitter('c', { rate: 0, burst: 0, lifetime: 5, lifetimeVar: 0, maxParticles: 100 });
    const hitKids = new Emitter('h', { rate: 0, burst: 0, lifetime: 5, lifetimeVar: 0, maxParticles: 100 });
    linkEmitters([parent, deathKids, hitKids]);
    for (let t = 0; t < 1; t += 1 / 60) for (const e of [parent, deathKids, hitKids]) e.update(1 / 60);
    expect(deathKids.count).toBe(20);
    expect(hitKids.count).toBeGreaterThan(0);
  });
});

describe('flipbook timing', () => {
  const fb = (o: Partial<FlipbookParams>): FlipbookParams => ({ cols: 4, rows: 4, frames: 16, mode: 'lifetime', fps: 24, cycles: 1, loop: 'once', ...o });
  it('stretches the animation over the whole life', () => {
    expect(flipbookFrame(fb({}), 0, 4, 0, 0.5)).toBe(0);
    expect(flipbookFrame(fb({}), 2, 4, 0, 0.5)).toBe(8);
    expect(flipbookFrame(fb({}), 3.99, 4, 0, 0.5)).toBe(15);
    expect(flipbookFrame(fb({ cycles: 2, loop: 'loop' }), 2, 4, 0, 0.5)).toBe(0);
  });
  it('fps mode holds the last frame or hides', () => {
    expect(flipbookFrame(fb({ mode: 'fps', fps: 16 }), 3, 10, 0, 0.5)).toBe(15);
    expect(flipbookFrame(fb({ mode: 'fps', fps: 16, end: 'hide' }), 3, 10, 0, 0.5)).toBe(-1);
    expect(flipbookFrame(fb({ mode: 'fps', fps: 16, loop: 'loop' }), 1.25, 10, 0, 0.5)).toBe(4);
    expect(flipbookFrame(fb({ mode: 'fps', fps: 16, loop: 'pingpong' }), 1.5, 10, 0, 0.5)).toBe(7);
  });
  it('loops a section with an intro and an outro at the end of life', () => {
    const f = fb({ mode: 'fps', fps: 10, loopStart: 4, loopEnd: 7, outro: true });
    expect(flipbookFrame(f, 0.2, 10, 0, 0.5)).toBe(2); // intro
    const mid = flipbookFrame(f, 3, 10, 0, 0.5); expect(mid).toBeGreaterThanOrEqual(4); expect(mid).toBeLessThanOrEqual(7);
    expect(flipbookFrame(f, 9.95, 10, 0, 0.5)).toBe(15); // outro ends on the last frame
  });
  it('holds, delay, reverse, curve and blending', () => {
    const held = fb({ mode: 'fps', fps: 1, holds: [{ frame: 0, extra: 4 }] });
    expect(flipbookFrame(held, 3, 100, 0, 0.5)).toBe(0); expect(flipbookFrame(held, 5.5, 100, 0, 0.5)).toBe(1);
    expect(flipbookFrame(fb({ mode: 'fps', fps: 16, delay: 1 }), 0.5, 10, 0, 0.5)).toBe(0);
    expect(flipbookFrame(fb({ reverse: true }), 0, 4, 0, 0.5)).toBe(15);
    const fast = fb({ curve: { p: [[0, 0], [0.2, 0.9], [1, 1]], mode: 'linear' } });
    expect(flipbookFrame(fast, 0.8, 4, 0, 0.5)).toBe(14);
    const b = flipbookFrame(fb({ blend: true }), 1.1, 4, 0, 0.5); expect(b % 1).toBeGreaterThan(0);
    expect(flipbookFrame(fb({ channelPacked: true }), 3.99, 4, 0, 0.5)).toBe(47);
  });
});

describe('flipbook frame order and presets', () => {
  it('parses frame order ranges and plays through them', async () => {
    const { parseFrameOrder } = await import('../src/vfx/vfx');
    expect(parseFrameOrder('0-3, 3, 3, 2-0', 16)).toEqual([0, 1, 2, 3, 3, 3, 2, 1, 0]);
    expect(parseFrameOrder('14-17', 16)).toEqual([14, 15]);
    const f: FlipbookParams = { cols: 4, rows: 4, frames: 16, mode: 'lifetime', fps: 24, cycles: 1, loop: 'once', order: [0, 1, 2, 3, 3, 3, 2, 1, 0] };
    expect(flipbookFrame(f, 0.99, 1, 0, 0.5)).toBe(8); // the 9th playback frame (sheet frame 0)
    const s = newSystem('F', 0, 0, { output: [newBlock('render', { image: 'data:image/png;base64,AA' }), newBlock('flipbook', { cols: 4, rows: 4, order: '0-3, 3, 3' })] });
    expect(compileGraph({ systems: [s], params: [] }).layers[0].params.flipbook!.order).toEqual([0, 1, 2, 3, 3, 3]);
  });
  it('flipbook presets bake their sheet in the texture graph and point at it', async () => {
    const { VFX_PRESETS } = await import('../src/vfx/vfx');
    for (const id of ['flipbook-fire', 'flipbook-smoke-hold', 'flipbook-magic-loop']) {
      const g = VFX_PRESETS.find((p) => p.id === id)!.build();
      const seq = g.texNodes!.find((t) => t.type === 'sequence')!;
      const fb = g.systems.flatMap((s) => s.contexts.output).find((b) => b.type === 'flipbook')!;
      expect(fb.props.texture, id).toBe('node:' + seq.id);
      expect(compileGraph(g).warnings, id).toEqual([]);
    }
  });
});

describe('new blocks compile', () => {
  it('every block applies without throwing, in its context', () => {
    setTextureResolver((r) => (r === 'asset:x' ? 'data:image/png;base64,AA' : undefined));
    for (const t of VFX_BLOCKS) {
      const s = newSystem('S', 0, 0, { spawn: [newBlock('rate')], init: [newBlock('lifetime')], update: [], output: [newBlock('render')] });
      const b = newBlock(t.type, t.props.some((p) => p.type === 'texture') ? Object.fromEntries(t.props.filter((p) => p.type === 'texture').map((p) => [p.key, 'asset:x'])) : {});
      s.contexts[t.context].push(b);
      expect(() => compileGraph({ systems: [s], params: [] }), t.type).not.toThrow();
    }
    setTextureResolver(null);
  });
  it('sub-emitter targets resolve to layer numbers; targets need no spawn block', () => {
    const child = newSystem('Sparks', 0, 0, { spawn: [], init: [newBlock('lifetime')], output: [newBlock('render')] });
    const parent = newSystem('Shell', 0, 0, { update: [newBlock('subEmitter', { on: 'death', target: child.id, count: 30 })] });
    const r = compileGraph({ systems: [parent, child], params: [] });
    expect(r.warnings).toEqual([]);
    expect(r.layers[0].params.subEmitters).toEqual([expect.objectContaining({ on: 'death', layer: 1, count: 30 })]);
  });
  it('flipbook + texture from the library; timing and transform of a system', () => {
    setTextureResolver((r) => (r === 'asset:sheet' ? 'data:image/png;base64,SHEET' : undefined));
    const s = newSystem('Fire', 0, 0, { output: [newBlock('render'), newBlock('flipbook', { texture: 'asset:sheet', cols: 8, rows: 8, holds: '3:5, 9:2', section: true, loopStart: 10, loopEnd: 40 })] });
    s.timing = { delay: 0.4, timeScale: 2 }; s.transform = { offset: [1, 0, 0], rotation: [0, 90, 0], scale: 2 };
    const p = compileGraph({ systems: [s], params: [] }).layers[0].params;
    expect(p.textureImage).toBe('data:image/png;base64,SHEET');
    expect(p.flipbook).toMatchObject({ cols: 8, rows: 8, frames: 64, holds: [{ frame: 3, extra: 5 }, { frame: 9, extra: 2 }], loopStart: 10, loopEnd: 40 });
    expect([p.delay, p.timeScale, p.offset, p.emitterRotation, p.emitterScale]).toEqual([0.4, 2, [1, 0, 0], [0, 90, 0], 2]);
    const missing = compileGraph({ systems: [newSystem('X', 0, 0, { output: [newBlock('render'), newBlock('flipbook', { texture: 'asset:gone' })] })], params: [] });
    expect(missing.warnings.join()).toMatch(/missing/);
    setTextureResolver(null);
  });
  it('a second renderer is reported', () => {
    const s = newSystem('R', 0, 0, { output: [newBlock('render'), newBlock('meshRenderer'), newBlock('ribbonRenderer')] });
    const r = compileGraph({ systems: [s], params: [] });
    expect(r.layers[0].params.renderer).toBe('ribbon');
    expect(r.warnings.join()).toMatch(/one renderer/);
  });
});
