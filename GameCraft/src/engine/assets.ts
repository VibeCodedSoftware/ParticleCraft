// Model and texture loading (native .blend, OBJ+MTL, glTF/GLB, FBX) with caching and import-time normalization
// (pivot centering, grounding, scale, axis conversion).
import * as THREE from 'three';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { DEFAULT_IMPORT, type AssetImportSettings, type MaterialOverride } from '../project/types';
import { DEFAULT_LIGHT } from '@shared/src/runtime/scene';
import { blendToThree, extractObject, type BlendResult } from '../asset-import/blend/blendToThree';
import { makeLight } from './blenderStyle';

export interface LoadedModel { scene: THREE.Group; animations: THREE.AnimationClip[]; size: THREE.Vector3; info: { vertices: number; meshes: number; materials: string[]; animations: string[] } }

const cache = new Map<string, Promise<LoadedModel>>();
const texCache = new Map<string, THREE.Texture>();

export function extOf(path: string) { return (path.split('#')[0].split('?')[0].split('.').pop() ?? '').toLowerCase(); }
export const MODEL_EXTS = ['blend', 'obj', 'gltf', 'glb', 'fbx'];
export const TEXTURE_EXTS = ['png', 'jpg', 'jpeg', 'webp'];
export const AUDIO_EXTS = ['wav', 'mp3', 'ogg'];
export const VIDEO_EXTS = ['mp4', 'webm', 'ogv', 'm4v', 'mov'];

/** Convert MTL Phong materials to PBR so lights behave the same as for every other object. */
function toStandard(m: THREE.Material, mode: AssetImportSettings['materials']): THREE.Material {
  const src = m as THREE.MeshPhongMaterial;
  if (mode === 'unlit') return new THREE.MeshBasicMaterial({ color: src.color ?? 0xffffff, map: src.map ?? null, name: m.name });
  if ((m as any).isMeshStandardMaterial) return m;
  const shin = src.shininess ?? 30;
  return new THREE.MeshStandardMaterial({
    name: m.name, color: src.color ?? new THREE.Color(0xcccccc), map: src.map ?? null,
    roughness: shin > 100 ? 0.42 : 0.82, metalness: 0, flatShading: mode === 'flat',
    transparent: src.transparent, opacity: src.opacity, side: THREE.FrontSide,
  });
}

async function loadRaw(url: string, ext: string, mtlUrl?: string, opts: { lights?: boolean } = {}): Promise<{ scene: THREE.Group; animations: THREE.AnimationClip[] }> {
  if (ext === 'obj') {
    const loader = new OBJLoader();
    if (mtlUrl) {
      try {
        const base = mtlUrl.slice(0, mtlUrl.lastIndexOf('/') + 1);
        const mtl = await new MTLLoader().setResourcePath(base).loadAsync(mtlUrl);
        mtl.preload();
        loader.setMaterials(mtl);
      } catch { /* missing MTL: fall back to default material */ }
    }
    return { scene: await loader.loadAsync(url), animations: [] };
  }
  if (ext === 'gltf' || ext === 'glb') {
    const g = await new GLTFLoader().loadAsync(url);
    return { scene: g.scene as unknown as THREE.Group, animations: g.animations };
  }
  if (ext === 'fbx') {
    const g = await new FBXLoader().loadAsync(url);
    return { scene: g, animations: g.animations };
  }
  if (ext === 'blend') {
    // Native .blend: "file.blend#Object" loads one object (with its children and animations), no fragment the whole file.
    const hash = url.indexOf('#');
    const fileUrl = hash >= 0 ? url.slice(0, hash) : url;
    const objName = hash >= 0 ? decodeURIComponent(url.slice(hash + 1)) : '';
    const res = await loadBlend(fileUrl, opts.lights !== false);
    if (!objName) { const g = SkeletonUtils.clone(res.root) as THREE.Group; return { scene: g, animations: res.animations }; }
    const ex = extractObject(res, objName, (o) => SkeletonUtils.clone(o));
    if (!ex) throw new Error(`"${objName}" is not an object in ${fileUrl.split('/').pop()}`);
    return { scene: ex.group, animations: ex.animations };
  }
  throw new Error(`Unsupported model format ".${ext}". Use .blend, .glb/.gltf, .fbx or .obj.`);
}

/** Drop root-bone translation from a clip so it plays in place (vertical bob of child bones is kept). */
function inPlace(clip: THREE.AnimationClip, root: THREE.Object3D): THREE.AnimationClip {
  const roots = new Set<string>();
  root.traverse((o) => { if ((o as THREE.Bone).isBone && !(o.parent as THREE.Bone | null)?.isBone) roots.add(o.name); });
  const tracks = clip.tracks.filter((t) => !(t.name.endsWith('.position') && roots.has(t.name.slice(0, -'.position'.length))));
  if (tracks.length === clip.tracks.length) return clip;
  const c = new THREE.AnimationClip(clip.name, clip.duration, tracks);
  (c as any).userData = (clip as any).userData;
  return c;
}

const blendCache = new Map<string, Promise<BlendResult>>();

/** Parse a .blend once per URL (big files hold many assets); packed images become textures. */
export function loadBlend(fileUrl: string, lights = true): Promise<BlendResult> {
  const key = fileUrl + (lights ? '' : '|nolights');
  let p = blendCache.get(key);
  if (!p) {
    p = (async () => {
      const r = await fetch(fileUrl);
      if (!r.ok) throw new Error(`HTTP ${r.status} loading ${fileUrl}`);
      const buf = new Uint8Array(await r.arrayBuffer());
      return blendToThree(buf, {
        makeTexture: (bytes, _name, mime) => {
          const blobUrl = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }));
          return new THREE.TextureLoader().load(blobUrl);
        },
        // Unpacked images: look for the file by name next to the .blend.
        resolveImage: (path) => { const base = path.split(/[\\/]/).pop(); return base ? fileUrl.slice(0, fileUrl.lastIndexOf('/') + 1) + encodeURIComponent(base) : null; },
        makeLight: lights ? (l) => makeLight({ ...DEFAULT_LIGHT, ...l, areaShape: l.sizeX === l.sizeY ? 'square' : 'rectangle', castShadow: false, cutoff: 0 }) : undefined,
      });
    })();
    blendCache.set(key, p);
    p.catch(() => blendCache.delete(key));
  }
  return p;
}

export function loadModel(url: string, settings: Partial<AssetImportSettings> = {}, mtlUrl?: string): Promise<LoadedModel> {
  const s = { ...DEFAULT_IMPORT, ...settings };
  const key = url + '|' + JSON.stringify(s) + '|' + (mtlUrl ?? '');
  let p = cache.get(key);
  if (!p) {
    p = (async () => {
      const raw = await loadRaw(url, extOf(url), mtlUrl, { lights: s.lights });
      const root = raw.scene;
      if (!s.rootMotion) raw.animations = raw.animations.map((c) => inPlace(c, root));
      let vertices = 0, meshes = 0; const mats = new Set<string>();
      root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        meshes++;
        vertices += m.geometry.attributes.position?.count ?? 0;
        m.castShadow = true; m.receiveShadow = true;
        const conv = (mm: THREE.Material) => { mats.add(mm.name || 'material'); return toStandard(mm, s.materials); };
        m.material = Array.isArray(m.material) ? m.material.map(conv) : conv(m.material);
        if (!m.geometry.attributes.normal) m.geometry.computeVertexNormals();
      });
      // A model can name texture files that didn't come with it. Three draws those black: use the material's colour.
      if (extOf(url) === 'fbx') setTimeout(() => root.traverse((o) => {
        const m = o as THREE.Mesh; if (!m.isMesh) return;
        for (const mt of (Array.isArray(m.material) ? m.material : [m.material]) as THREE.MeshStandardMaterial[]) if (mt.map && !mt.map.image) { mt.map = null; if (mt.color.getHex() === 0xcccccc) mt.color.set('#6b5238'); mt.needsUpdate = true; }
      }), 4000);
      const holder = new THREE.Group();
      const inner = new THREE.Group();
      inner.add(root);
      if (s.upAxis === 'z') inner.rotation.x = -Math.PI / 2;
      holder.add(inner);
      holder.updateMatrixWorld(true);
      if (s.materialOverrides?.length) applyMaterialOverrides(root, s.materialOverrides, s.scale);
      const box = new THREE.Box3().setFromObject(holder);
      const c = box.getCenter(new THREE.Vector3());
      inner.position.set(s.center ? -c.x : 0, s.ground ? -box.min.y : s.center ? -c.y : 0, s.center ? -c.z : 0);
      holder.scale.setScalar(s.scale);
      holder.rotation.y = (s.rotY * Math.PI) / 180;
      holder.updateMatrixWorld(true);
      const size = new THREE.Box3().setFromObject(holder).getSize(new THREE.Vector3());
      return { scene: holder, animations: raw.animations, size, info: { vertices, meshes, materials: [...mats], animations: raw.animations.map((a) => a.name) } };
    })();
    cache.set(key, p);
    p.catch(() => cache.delete(key));
  }
  return p.then((m) => ({ ...m, scene: SkeletonUtils.clone(m.scene) as THREE.Group }));
}

/**
 * Import-time material fixes. Geometry and materials are copied first: the parsed file is shared by every
 * asset taken from it, so edits must never leak into other assets.
 */
function applyMaterialOverrides(root: THREE.Object3D, list: MaterialOverride[], scale: number) {
  const rules = list.map((o) => ({ ...o, re: new RegExp(o.match) }));
  root.traverse((obj) => {
    const m = obj as THREE.Mesh;
    if (!m.isMesh) return;
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    const hit = mats.map((mt) => rules.find((r) => r.re.test(mt.name)));
    if (!hit.some(Boolean)) return;
    const next = mats.map((mt, i) => {
      const r = hit[i]; if (!r) return mt;
      const c = mt.clone() as THREE.MeshStandardMaterial;
      if (r.emissive != null) c.emissiveIntensity = (c.emissiveIntensity ?? 1) * r.emissive;
      if (r.opacity != null) { c.opacity = r.opacity; c.transparent = r.opacity < 1; c.depthWrite = r.opacity >= 1; }
      if (r.color) c.color?.set(r.color);
      if (r.emissiveColor) c.emissive?.set(r.emissiveColor);
      if (r.worldUV) for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap'] as const) {
        const t = (c as any)[k] as THREE.Texture | null;
        if (t) { const tt = t.clone(); tt.repeat.set(1, 1); tt.offset.set(0, 0); tt.rotation = 0; tt.wrapS = tt.wrapT = THREE.RepeatWrapping; tt.needsUpdate = true; (c as any)[k] = tt; }
      }
      return c;
    });
    m.material = Array.isArray(m.material) ? next : next[0];
    // World-aligned UVs: project each triangle on its dominant axis, in metres (object world scale included).
    const uvRules = hit.map((r) => r?.worldUV ?? 0);
    if (!uvRules.some((x) => x > 0)) return;
    let g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
    const pos = g.getAttribute('position');
    const uv = (g.getAttribute('uv') as THREE.BufferAttribute | undefined)?.clone() ?? new THREE.BufferAttribute(new Float32Array(pos.count * 2), 2);
    m.updateWorldMatrix(true, false);
    const mw = m.matrixWorld.clone().premultiply(new THREE.Matrix4().makeScale(scale, scale, scale));
    const groups = g.groups.length ? g.groups : [{ start: 0, count: pos.count, materialIndex: 0 }];
    const a = new THREE.Vector3(), b = new THREE.Vector3(), cc = new THREE.Vector3(), n = new THREE.Vector3();
    for (const grp of groups) {
      const tiles = uvRules[grp.materialIndex ?? 0];
      if (!tiles) continue;
      for (let i = grp.start; i + 2 < grp.start + grp.count; i += 3) {
        a.fromBufferAttribute(pos, i).applyMatrix4(mw); b.fromBufferAttribute(pos, i + 1).applyMatrix4(mw); cc.fromBufferAttribute(pos, i + 2).applyMatrix4(mw);
        n.subVectors(b, a).cross(new THREE.Vector3().subVectors(cc, a));
        const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
        for (const [k, p] of [[i, a], [i + 1, b], [i + 2, cc]] as const) {
          const [u, v] = ay >= ax && ay >= az ? [p.x, p.z] : ax >= az ? [p.z, p.y] : [p.x, p.y];
          uv.setXY(k, u * tiles, v * tiles);
        }
      }
    }
    g.setAttribute('uv', uv);
    m.geometry = g;
    g = null as any;
  });
}

export function invalidateModel(url: string) {
  for (const k of [...cache.keys()]) if (k.startsWith(url + '|')) cache.delete(k);
}

/** Anisotropic filtering for new textures (Preferences › Rendering › Texture quality). */
let anisotropy = 8;
export function setTextureAnisotropy(n: number) {
  anisotropy = n;
  for (const t of texCache.values()) if (t.minFilter !== THREE.NearestFilter && t.anisotropy !== n) { t.anisotropy = n; t.needsUpdate = true; }
}

/** Project settings: largest texture side (0 = full size), and bilinear or trilinear filtering. */
const textureLimits = { maxSize: 0, filter: 'trilinear' as 'bilinear' | 'trilinear' };
/** Apply them to one texture. Nearest (pixel art) and render targets stay as they are; the full picture is kept, so the limit can change back. */
export function limitTexture(t: THREE.Texture) {
  if (t.magFilter === THREE.NearestFilter || t.minFilter === THREE.NearestFilter) return;
  if ((t as THREE.CompressedTexture).isCompressedTexture) return; // already in blocks: nothing to shrink
  const mip = textureLimits.filter === 'bilinear' ? THREE.LinearMipmapNearestFilter : THREE.LinearMipmapLinearFilter;
  if (t.minFilter !== mip && t.generateMipmaps) { t.minFilter = mip; t.needsUpdate = true; }
  const full = (t.userData.fullImage ?? t.image) as (HTMLImageElement & { videoWidth?: number }) | undefined;
  if (!full?.width || !full.height || (full as any).data || full.videoWidth) return;
  const max = textureLimits.maxSize, want = max > 0 ? Math.min(1, max / Math.max(full.width, full.height)) : 1;
  const w = Math.max(1, Math.round(full.width * want)), h = Math.max(1, Math.round(full.height * want));
  if (t.image?.width === w && t.image?.height === h) return;
  if (want === 1) { t.image = full; delete t.userData.fullImage; t.needsUpdate = true; return; }
  try {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    c.getContext('2d')!.drawImage(full as CanvasImageSource, 0, 0, w, h);
    t.userData.fullImage = full; t.image = c; t.needsUpdate = true;
  } catch { /* a picture the canvas can't read stays full size */ }
}
export function setTextureLimits(maxSize: number, filter: 'bilinear' | 'trilinear') {
  textureLimits.maxSize = Math.max(0, maxSize || 0); textureLimits.filter = filter;
  for (const t of texCache.values()) limitTexture(t);
}

export function loadTexture(url: string, pixel = false): THREE.Texture {
  const key = url + (pixel ? '#px' : '');
  let t = texCache.get(key);
  if (!t) {
    t = new THREE.TextureLoader().load(url, (loaded) => { if (textureLimits.maxSize > 0) limitTexture(loaded); });
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    if (pixel) { t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; }
    else { t.anisotropy = anisotropy; if (textureLimits.filter === 'bilinear') t.minFilter = THREE.LinearMipmapNearestFilter; }
    texCache.set(key, t);
  }
  return t;
}
