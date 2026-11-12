// Effect composition: node groups / effects copied with rewired references, variations, asset references.
import { describe, expect, it } from 'vitest';
import { VFX_PRESETS, compileGraph, newBlock, newSystem, type VfxGraph } from '../src/vfx/vfx';
import { assetRefs, extractFragment, insertFragment, makeVariation, remapAssets } from '../src/vfx/compose';

describe('effect composition', () => {
  it('a group carries its texture nodes, sub-emitter targets and parameters with new ids', () => {
    const g = VFX_PRESETS.find((p) => p.id === 'r-burning-debris')!.build();
    g.params.push({ id: 'p1', name: 'Count', type: 'number', value: 30, bindings: [{ system: g.systems[0].id, block: g.systems[0].contexts.spawn[0].id, prop: 'count' }] });
    const frag = extractFragment(g, g.systems.map((s) => s.id));
    const target: VfxGraph = { systems: [newSystem('Existing')], params: [] };
    const r = insertFragment(target, frag, 500, 0);
    expect(r.systems).toHaveLength(2);
    const [debris, smoke] = r.systems.map((id) => target.systems.find((s) => s.id === id)!);
    expect(debris.id).not.toBe(g.systems[0].id);
    expect(debris.contexts.update.find((b) => b.type === 'subEmitter')!.props.target).toBe(smoke.id);
    expect(target.params[0].bindings[0]).toMatchObject({ system: debris.id, block: debris.contexts.spawn[0].id });
    expect(compileGraph(target).warnings).toEqual([]);
  });
  it('texture nodes used by a group come along, wired to the copies', () => {
    const g = VFX_PRESETS.find((p) => p.id === 'flipbook-fire')!.build();
    const frag = extractFragment(g, [g.systems[0].id]);
    expect(frag.texNodes!.length).toBe(g.texNodes!.length);
    const t: VfxGraph = { systems: [], params: [] };
    insertFragment(t, frag);
    const fb = t.systems[0].contexts.output.find((b) => b.type === 'flipbook')!;
    const seq = t.texNodes!.find((n) => n.type === 'sequence')!;
    expect(fb.props.texture).toBe('node:' + seq.id);
    expect(Object.values(seq.inputs).every((v) => t.texNodes!.some((n) => n.id === v))).toBe(true);
  });
  it('variations change seeds and nudge settings but stay valid', () => {
    const g = VFX_PRESETS.find((p) => p.id === 'campfire')!.build();
    const v = makeVariation(g, 0.2, 42);
    expect(v.systems[0].contexts.init.some((b) => b.type === 'seed')).toBe(true);
    expect(JSON.stringify(v.systems[0].contexts.spawn)).not.toBe(JSON.stringify(g.systems[0].contexts.spawn));
    expect(compileGraph(v).warnings).toEqual([]);
  });
  it('finds and remaps library pictures', () => {
    const s = newSystem('S', 0, 0, { output: [newBlock('render'), newBlock('texture', { texture: 'asset:abc' })] });
    const g: VfxGraph = { systems: [s], params: [], texNodes: [{ id: 't', type: 'textureInput', x: 0, y: 0, props: { texture: 'asset:def' }, inputs: {} }] };
    expect(assetRefs(g).sort()).toEqual(['abc', 'def']);
    remapAssets(g, new Map([['abc', 'xyz']]));
    expect(s.contexts.output[1].props.texture).toBe('asset:xyz');
  });
});
