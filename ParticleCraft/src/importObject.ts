// Import 3D objects into the graph. Any model (.blend, .glb/.gltf, .fbx, .obj) becomes an Object node (a shape
// node with the model's triangles) that effects can emit from; a .blend's particle systems, or a .craftfx.json from
// the Craft Export Blender add-on, also become "Blender Particle Effect" nodes connected to their object.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { blendToThree } from '@gamecraft/asset-import/blend/blendToThree';
import { BlendFile } from '@gamecraft/asset-import/blend/blendFile';
import { readBlendParticles } from '@gamecraft/asset-import/blend/blendParticles';
import type { BlenderParticles } from '@shared/src/vfx/blender';
import { parseCraftFx } from '@shared/src/vfx/blender';

export interface ImportedObject { name: string; tris: number[]; color?: string; particleSystems: BlenderParticles[] }

/** World-space triangles of every mesh under `root` (9 numbers each). */
function trianglesOf(root: THREE.Object3D): { tris: number[]; color?: string } {
  root.updateMatrixWorld(true);
  const tris: number[] = []; let color: string | undefined;
  const v = new THREE.Vector3();
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !m.geometry?.attributes.position) return;
    const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry;
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld); tris.push(v.x, v.y, v.z); }
    const mat = (Array.isArray(m.material) ? m.material[0] : m.material) as THREE.MeshStandardMaterial | undefined;
    if (!color && mat?.color) color = '#' + mat.color.getHexString();
  });
  return { tris, color };
}

export async function importObjectFiles(files: File[]): Promise<{ file: string; objects: ImportedObject[]; notes: string[] }> {
  const notes: string[] = [];
  const fx = files.find((f) => /\.craftfx\.json$/i.test(f.name));
  if (fx) {
    const c = parseCraftFx(await fx.text());
    return { file: fx.name, objects: c.objects.map((o) => ({ name: o.name, tris: o.tris, color: o.color, particleSystems: o.particleSystems })), notes };
  }
  const f = files.find((x) => /\.(blend|glb|gltf|fbx|obj)$/i.test(x.name));
  if (!f) throw new Error('choose a .blend, .glb, .gltf, .fbx or .obj file (or a .craftfx.json from the Blender add-on)');
  const ext = f.name.split('.').pop()!.toLowerCase();
  const buf = await f.arrayBuffer();
  if (ext === 'blend') {
    const bf = new BlendFile(buf);
    const res = blendToThree(bf, {});
    const psys = readBlendParticles(bf);
    const objects: ImportedObject[] = [];
    // Objects with particle systems each get their own node; the rest of the file becomes one Object node.
    for (const [name, systems] of psys) {
      const node = res.byName.get(name);
      if (!node) { notes.push(`"${name}" has particle systems but no mesh was found`); continue; }
      const t = trianglesOf(node);
      objects.push({ name, tris: t.tris, color: t.color, particleSystems: systems });
    }
    if (!objects.length) { const t = trianglesOf(res.root); objects.push({ name: f.name.replace(/\.blend$/i, ''), tris: t.tris, color: t.color, particleSystems: [] }); }
    notes.push(...res.warnings.slice(0, 5));
    return { file: f.name, objects, notes };
  }
  let root: THREE.Object3D;
  if (ext === 'glb' || ext === 'gltf') root = (await new GLTFLoader().parseAsync(ext === 'glb' ? buf : new TextDecoder().decode(buf), '')).scene;
  else if (ext === 'fbx') root = new FBXLoader().parse(buf, '');
  else root = new OBJLoader().parse(new TextDecoder().decode(buf));
  if (ext !== 'blend') notes.push('Only .blend files (and the Blender add-on\'s export) carry Blender particle systems; this model becomes an Object node to emit from.');
  const t = trianglesOf(root);
  if (!t.tris.length) throw new Error('no meshes in this file');
  return { file: f.name, objects: [{ name: f.name.replace(/\.[^.]+$/, ''), tris: t.tris, color: t.color, particleSystems: [] }], notes };
}
