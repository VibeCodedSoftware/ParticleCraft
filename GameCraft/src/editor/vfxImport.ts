// Bring a ParticleCraft effect into the GameCraft project: real-time effects become particle presets (one per
// layer) that the Particles blocks spawn; baked flipbooks become a texture and an animated sprite.
import type { VfxAsset } from '@shared/src/vfx/vfx';
import { dataUrlBytes } from '@shared/ui/VfxImport';
import { store } from '../project/store';
import { api } from '../project/api';
import { addModel, addObject } from './actions';
import type { AssetRef } from '../project/types';
import type { InstanceKind } from '@shared/src/runtime/scene';

/** Shape nodes → GameCraft primitives (unit size: box 1 m, sphere / cylinder / cone / capsule 1 m across). */
const SHAPE_TO_PRIM: Record<string, InstanceKind | undefined> = { cube: 'box', sphere: 'sphere', cylinder: 'cylinder', cone: 'cone', capsule: 'capsule', plane: 'plane' };

const safe =(n: string) => n.replace(/[^A-Za-z0-9_ -]/g, '').trim() || 'Effect';

export async function importVfx(a: VfxAsset, addToScene: boolean) {
  const p = store.get().project!;
  const name = safe(a.name);
  if (a.kind === 'realtime' && a.layers?.length) {
    store.mutate(`Import effect ${name}`, (pp) => {
      for (const k of Object.keys(pp.particlePresets)) if (k === name || k.startsWith(name + '#')) delete pp.particlePresets[k];
      a.layers!.forEach((l, i) => { pp.particlePresets[i ? `${name}#${i + 1}` : name] = l.params; });
      pp.vfxExposed = { ...(pp.vfxExposed ?? {}), [name]: (a.exposed ?? []).map((e) => ({ name: e.name, targets: e.targets })) };
    });
    if (!addToScene) { store.log('info', `Imported "${name}" (${a.layers.length} layer${a.layers.length > 1 ? 's' : ''}). Spawn it with the Particles blocks or an emitter.`); return; }
    // From the Blender add-on with its model alongside: bring the model in and put the effect on it.
    const glb = a.blender?.model ? await api.exchangeBytes(a.blender.model) : null;
    let parent: number | undefined, y = 1;
    if (glb && glb.byteLength > 12 && new TextDecoder().decode(new Uint8Array(glb, 0, 4)) === 'glTF') {
      const rel = `imported/models/${a.blender!.model!.replace(/[^A-Za-z0-9_.-]+/g, '_')}`;
      await api.putFile(p.id, rel, glb);
      const asset: AssetRef = { id: `proj:${rel}`, name: name, kind: 'model', source: 'imported', folder: 'Models/Blender', meta: { sourceFile: a.blender!.model, importedAt: new Date().toISOString() } };
      parent = addModel(asset);
      y = (a.blender!.objects[0]?.height ?? 2) / 2; // the effect's points are centred on the object's middle
    }
    const emitter = addObject('emitter', name.replace(/[^A-Za-z0-9_]/g, '') || 'Effect', { y, emitter: { preset: name, params: {}, playing: true }, ...(parent ? { parent } : {}) }, parent ? [0, y, 0] : undefined);
    // Shape nodes shown with the effect (Hide original off) come along as basic shapes.
    for (const s of a.shapes ?? []) {
      const kind = SHAPE_TO_PRIM[s.kind]; if (!kind) continue;
      const round = s.kind !== 'cube' && s.kind !== 'plane';
      addObject(kind, s.name.replace(/[^A-Za-z0-9_]/g, '') || 'Shape', {
        parent: emitter, color: s.color ?? '#8fa3bf', rx: s.rotation[0], ry: s.rotation[1], rz: s.rotation[2],
        sx: (round ? s.radius * 2 : s.width) * s.scale, sy: (s.kind === 'sphere' ? s.radius * 2 : s.kind === 'plane' ? 1 : s.height) * s.scale, sz: (round ? s.radius * 2 : s.depth) * s.scale,
        collider: { shape: 'none', size: [1, 1, 1], offset: [0, 0, 0] },
      }, [s.position[0], s.position[1], s.position[2]]);
    }
    store.log('info', `Imported "${name}" (${a.layers.length} layer${a.layers.length > 1 ? 's' : ''})${parent ? ' on its Blender model' : ''}. Spawn it with the Particles blocks or the emitter object.`);
    return;
  }
  if (a.kind === 'baked' && a.flipbook) {
    const rel = `imported/vfx/${name.replace(/\s+/g, '_')}.png`;
    await api.putFile(p.id, rel, dataUrlBytes(a.flipbook.image).buffer as ArrayBuffer);
    const id = `proj:${rel}`;
    store.mutate(`Import flipbook ${name}`, (pp) => { if (!pp.assets.some((x) => x.id === id)) pp.assets.push({ id, name, kind: 'texture', source: 'imported', meta: { sourceFile: 'ParticleCraft', frames: a.flipbook!.frames, fps: a.flipbook!.fps } as any }); });
    if (addToScene) addObject('sprite', name.replace(/[^A-Za-z0-9_]/g, '') || 'Effect', { y: 1.5, sx: 2, sy: 2, sprite: { image: id, frames: a.flipbook.frames, fps: a.flipbook.fps, animation: '', pixelArt: !!a.flipbook.pixelArt } });
    store.log('info', `Imported flipbook "${name}" (${a.flipbook.frames} frames) as a texture${addToScene ? ' and an animated sprite' : ''}.`);
    return;
  }
  throw new Error('Simulation setups only run in ParticleCraft');
}
