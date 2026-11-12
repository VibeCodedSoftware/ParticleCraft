// Offscreen thumbnail renderer for models (cached in memory and localStorage).
import * as THREE from 'three';
import { loadModel } from './assets';
import type { AssetImportSettings } from '../project/types';

let renderer: THREE.WebGLRenderer | null = null;
const mem = new Map<string, Promise<string>>();
let queue: Promise<unknown> = Promise.resolve();

/** Shaded preview of a starter primitive (box, sphere, ramp…) for the Asset browser. */
export function primitiveThumb(kind: string, color = '#8fa3bf', px = 96): Promise<string> {
  const key = `gc.thumb.prim.${kind}.${color}.${px}`;
  const hit = mem.get(key);
  if (hit) return hit;
  const p: Promise<string> = queue.then(async () => {
    const { PRIM } = await import('./sceneView');
    renderer ??= new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setSize(px, px);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.AgXToneMapping;
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xffffff, 0x334155, 2));
    const d = new THREE.DirectionalLight(0xffffff, 2.6); d.position.set(3, 5, 4); scene.add(d);
    const make = PRIM[kind] ?? PRIM.box;
    const mesh = new THREE.Mesh(make(), new THREE.MeshStandardMaterial({ color, roughness: 0.55 }));
    if (kind === 'ramp') mesh.rotation.y = Math.PI * 0.75;
    scene.add(mesh);
    const cam = new THREE.PerspectiveCamera(32, 1, 0.1, 50);
    cam.position.set(1.6, 1.25, 1.9); cam.lookAt(0, kind === 'plane' ? 0 : 0.02, 0);
    renderer.render(scene, cam);
    mesh.geometry.dispose(); (mesh.material as THREE.Material).dispose();
    return renderer.domElement.toDataURL('image/png');
  });
  queue = p.catch(() => undefined);
  mem.set(key, p);
  p.catch(() => mem.delete(key));
  return p;
}

/**
 * A PBR material set on a lit sphere (Asset browser › Materials). `maps` are URLs per slot: base colour, normal,
 * roughness, metallic, ambient occlusion, emission, opacity.
 */
export function materialSphereThumb(maps: Partial<Record<string, string>>, px = 96): Promise<string> {
  const key = `gc.thumb.mat.${JSON.stringify(maps)}.${px}`;
  const hit = mem.get(key);
  if (hit) return hit;
  const load = (u?: string, srgb = false) => u ? new Promise<THREE.Texture | null>((res) => new THREE.TextureLoader().load(u, (t) => { t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(2, 1); res(t); }, undefined, () => res(null))) : Promise.resolve(null);
  const p: Promise<string> = queue.then(async () => {
    renderer ??= new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setSize(px, px);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.AgXToneMapping;
    const [map, normalMap, roughnessMap, metalnessMap, aoMap, emissiveMap, alphaMap] = await Promise.all([load(maps.color, true), load(maps.normal), load(maps.roughness), load(maps.metalness), load(maps.ao), load(maps.emission, true), load(maps.opacity)]);
    const m = new THREE.MeshStandardMaterial({ map, normalMap, roughnessMap, metalnessMap, aoMap, emissiveMap, alphaMap, roughness: roughnessMap ? 1 : 0.6, metalness: metalnessMap ? 1 : 0, transparent: !!alphaMap });
    if (emissiveMap) m.emissive.set(0xffffff);
    const g = new THREE.SphereGeometry(0.62, 48, 32); g.setAttribute('uv1', g.attributes.uv);
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xffffff, 0x334155, 1.6));
    const d = new THREE.DirectionalLight(0xffffff, 3); d.position.set(3, 4, 4); scene.add(d);
    const mesh = new THREE.Mesh(g, m); scene.add(mesh);
    const cam = new THREE.PerspectiveCamera(32, 1, 0.1, 50); cam.position.set(0, 0.35, 2.4); cam.lookAt(0, 0, 0);
    renderer.render(scene, cam);
    g.dispose(); m.dispose(); for (const t of [map, normalMap, roughnessMap, metalnessMap, aoMap, emissiveMap, alphaMap]) t?.dispose();
    return renderer.domElement.toDataURL('image/png');
  });
  queue = p.catch(() => undefined);
  mem.set(key, p);
  p.catch(() => mem.delete(key));
  return p;
}

/** view 'iso' = three-quarter view (asset browser); 'flat' = straight at the model's broad side (HUD icons from 3D models). */
export function modelThumb(url: string, settings: Partial<AssetImportSettings> = {}, mtl?: string, version = 0, view: 'iso' | 'flat' = 'iso', px = 96): Promise<string> {
  const key = `gc.thumb.${url}|${version}${view === 'iso' && px === 96 ? '' : `|${view}${px}`}`;
  const hit = mem.get(key);
  if (hit) return hit;
  try { const s = localStorage.getItem(key); if (s) { const p = Promise.resolve(s); mem.set(key, p); return p; } } catch { /* storage blocked */ }
  // Render one at a time on a single shared context.
  const p: Promise<string> = queue.then(async () => {
    renderer ??= new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setSize(px, px);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.AgXToneMapping;
    const m = await loadModel(url, { ...settings, scale: 1 }, mtl);
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 2.2));
    const d = new THREE.DirectionalLight(0xffffff, 2.5); d.position.set(3, 5, 4); scene.add(d);
    scene.add(m.scene);
    const box = new THREE.Box3().setFromObject(m.scene);
    const c = box.getCenter(new THREE.Vector3()), r = box.getSize(new THREE.Vector3()).length() / 2 || 1;
    const cam = new THREE.PerspectiveCamera(35, 1, r / 100, r * 100);
    if (view === 'flat') {
      // Look along the thinnest axis so a flat icon (a heart, a coin) fills the frame.
      const s = box.getSize(new THREE.Vector3());
      const axis = s.x <= s.y && s.x <= s.z ? new THREE.Vector3(1, 0, 0) : s.z <= s.y ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
      const half = Math.max(s.x * (1 - axis.x), s.y * (1 - axis.y), s.z * (1 - axis.z)) / 2 || 1;
      cam.position.copy(c).add(axis.multiplyScalar((half / Math.tan((17.5 * Math.PI) / 180)) * 1.08 + r));
      if (axis.y) cam.up.set(0, 0, -1);
      d.position.copy(cam.position).add(new THREE.Vector3(0, r, 0));
    } else cam.position.copy(c).add(new THREE.Vector3(1, 0.7, 1.2).normalize().multiplyScalar(r * 3));
    cam.lookAt(c);
    renderer.render(scene, cam);
    const url2 = renderer.domElement.toDataURL('image/png');
    try { localStorage.setItem(key, url2); } catch { /* quota */ }
    return url2;
  });
  queue = p.catch(() => undefined);
  mem.set(key, p);
  p.catch(() => mem.delete(key));
  return p;
}
