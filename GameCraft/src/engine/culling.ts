// Play-time render culling on top of three.js' built-in frustum culling:
//   draw distance - objects farther than the limit are not drawn;
//   occlusion     - objects hidden behind solid walls (the collision boxes of Solid objects) are not drawn;
//   LOD           - far static models swap to simplified copies of their geometry (made in idle time).
import * as THREE from 'three';
import type { World } from '@shared/src/runtime/world';
import type { LodReply, LodRequest } from './lodWorker';

export interface RenderSettings {
  /** Meters; 0 = unlimited. */
  drawDistance: number;
  /** three.js view-frustum culling (off = draw everything, even off screen). */
  frustum: boolean;
  occlusion: boolean;
  lod: boolean;
  /** LOD switch distances in metres (simplified / most simplified); 0 = automatic from the size on screen. */
  lodNear: number; lodFar: number;
  /** Seconds a LOD switch cross-fades (the old level dissolves over the new one); 0 = instant. */
  lodBlend?: number;
  /** Visibility debug: bounds coloured by the culling decision and LOD level. */
  debug: boolean;
  /** Visibility debug seen through the game camera, or from above with the game camera's frustum drawn. */
  debugView?: 'game' | 'above';
  /** Render quality preset (shadow filtering / resolution, pixel ratio); see engine/quality.ts. */
  quality?: 'low' | 'medium' | 'high' | 'ultra';
  /** Graphics preset these settings came from; 'custom' once one is changed by hand. Absent: never chosen. */
  preset?: 'low' | 'medium' | 'high' | 'ultra' | 'custom';
  /** Automatic instancing: identical objects share a draw call while playing (absent = on). See batcher.ts. */
  instancing?: boolean;
  /** GPU block compression for pictures while playing (absent = off; lossy). See textureManager.ts. */
  textureCompression?: boolean;
  /** Keep each picture on the graphics card only as large as it is on screen (absent = off). */
  textureStreaming?: boolean;
  /** Streaming's graphics memory budget for textures, in MB (absent or 0 = no limit). */
  textureBudgetMb?: number;
  /** Contact shadows strength, 0 to 1 (absent = off). See atmosphere.ts. */
  contactShadows?: number;
  /** Cascaded sun shadows: how many (2 to 4; absent or 0 = one shadow map). See cascades.ts. */
  cascades?: number;
  /** Cascaded shadows reach this far from the camera, in metres (absent or 0 = 150). */
  cascadeDistance?: number;
  /** Edge smoothing: multisampling (default, kept with post effects too), FXAA (fast, softer), SMAA (sharper), supersampling (best, slowest) or none. */
  antialias?: 'msaa' | 'fxaa' | 'smaa' | 'ssaa' | 'none';
  /** Multisampling samples (clamped to what the graphics card allows). Absent: the display's own 4×. */
  msaaSamples?: number;
  /** Draws at this share of the window's resolution (0.25–2). */
  renderScale?: number;
  /** Drawing stops at this many frames a second (0 = as fast as the display). Game logic keeps its own rate. */
  maxFps?: number;
  /** High-DPI screens at their full sharpness (false: one drawn pixel per screen point). */
  hiDpi?: boolean;
  /** Shadows in this game at all. */
  shadows?: boolean;
  /** Shadow filter; absent: from Quality. */
  shadowFilter?: 'basic' | 'pcf' | 'soft' | 'vsm';
  /** Shadow map size for lights without their own (0 = automatic from Quality). */
  shadowResolution?: number;
  /** How far the sun's shadows reach, for suns without their own area (m; 0 = the built-in default). */
  shadowDistance?: number;
  /** Bilinear (faster) or trilinear (smooth between mipmap levels) texture filtering. */
  textureFilter?: 'bilinear' | 'trilinear';
  /** Larger textures are shrunk to this when loaded (0 = full size). */
  textureMaxSize?: number;
  /** Screen-space ambient occlusion strength (0 = off): soft shadows in creases and where objects meet. */
  ambientOcclusion?: number;
  /** Texture sharpness at grazing angles (anisotropic filtering): low 1×, medium 4×, high 8× (default), max 16×. */
  textureQuality?: 'low' | 'medium' | 'high' | 'max';
}
// Defaults favour correctness: nothing is hidden by a guess (occlusion is opt-in), far models only simplify.
export const DEFAULT_RENDER: RenderSettings = { drawDistance: 0, frustum: true, occlusion: false, lod: true, lodNear: 0, lodFar: 0, lodBlend: 0.3, debug: false, debugView: 'game' };

export interface CullStats { objects: number; distance: number; occluded: number; lod: number; triangles: number; calls: number; range: number }
export type CullDecision = 'visible' | 'distance' | 'range' | 'occluded';

interface Cullable { uid: number; obj: THREE.Object3D; visual: THREE.Object3D }
interface State { occluded: boolean; /** consecutive "hidden" results */ hits: number; box: THREE.Box3; boxAt: number; at: THREE.Vector3; level: number; decision: CullDecision }

const LOD_STEPS = [0.5, 0.2];
/** Simplified geometries per source geometry: [50%, 20%] (null while not made yet / not worth it). */
const lodCache = new WeakMap<THREE.BufferGeometry, (THREE.BufferGeometry | null)[] | 'pending' | 'skip'>();
const lodQueue: THREE.BufferGeometry[] = [];
let lodBusy = false;

function requestLods(g: THREE.BufferGeometry) {
  if (lodCache.has(g)) return;
  const verts = g.attributes.position?.count ?? 0;
  const tris = (g.index ? g.index.count : verts) / 3;
  // Small meshes gain nothing; very large ones take too long to simplify (counted in triangles: many imported
  // models store every triangle's corners separately, 3 vertices each, which the simplifier merges first).
  if (tris < 600 || tris > 150000) { lodCache.set(g, 'skip'); return; }
  lodCache.set(g, 'pending');
  lodQueue.push(g);
  pumpLods();
}

// Simplification runs in a worker, one mesh at a time, so play never stalls on it.
let worker: Worker | null = null;
let nextJob = 1;
const jobs = new Map<number, THREE.BufferGeometry>();
function pumpLods() {
  if (lodBusy || !lodQueue.length) return;
  try { worker ??= new Worker(new URL('./lodWorker.ts', import.meta.url), { type: 'module' }); } catch { for (const g of lodQueue.splice(0)) lodCache.set(g, 'skip'); return; }
  worker.onmessage = (ev: MessageEvent<LodReply>) => {
    const src = jobs.get(ev.data.id);
    jobs.delete(ev.data.id);
    if (src) lodCache.set(src, ev.data.levels.map((l) => {
      if (!l) return null;
      const g = new THREE.BufferGeometry();
      for (const [name, a] of Object.entries(l.attrs)) g.setAttribute(name, new THREE.BufferAttribute(a.array, a.itemSize));
      if (l.index) g.setIndex(new THREE.BufferAttribute(l.index, 1));
      for (const gr of l.groups ?? []) g.addGroup(gr.start, gr.count, gr.materialIndex);
      g.computeBoundingSphere();
      return g;
    }));
    lodBusy = false;
    pumpLods();
  };
  const g = lodQueue.shift()!;
  const id = nextJob++;
  const attrs: LodRequest['attrs'] = {};
  for (const name of ['position', 'normal', 'uv']) {
    const a = g.attributes[name] as THREE.BufferAttribute | undefined;
    if (a && !(a as any).isInterleavedBufferAttribute) attrs[name] = { array: Float32Array.from(a.array as ArrayLike<number>), itemSize: a.itemSize };
  }
  if (!attrs.position) { lodCache.set(g, 'skip'); pumpLods(); return; }
  jobs.set(id, g);
  lodBusy = true;
  const groups = g.groups.length > 1 ? g.groups.map((gr) => ({ start: gr.start, count: gr.count, materialIndex: gr.materialIndex ?? 0 })) : undefined;
  worker.postMessage({ id, attrs, index: g.index ? Uint32Array.from(g.index.array as ArrayLike<number>) : undefined, groups, keep: LOD_STEPS } satisfies LodRequest);
}

const ray = new THREE.Ray(), tmp = new THREE.Vector3(), corner = new THREE.Vector3(), sphere = new THREE.Sphere();
const frustum = new THREE.Frustum(), viewProj = new THREE.Matrix4();
/** Metres: objects this close are never occlusion-culled. */
const NEAR_KEEP = 4;
/** Occluded objects inside the view are re-tested every frame (up to this many), so turning never reveals a gap. */
const MAX_RECHECKS = 120;

export class Culler {
  stats: CullStats = { objects: 0, distance: 0, occluded: 0, lod: 0, triangles: 0, calls: 0, range: 0 };
  /** Per-object decision of the last frame (read by the visibility debug view). */
  decisions(): Iterable<[number, { box: THREE.Box3; decision: CullDecision; level: number }]> { return this.states.entries(); }
  private states = new Map<number, State>();
  private occluders: { uid: number; box: THREE.Box3 }[] = [];
  private occluderVersion = -1;
  private cursor = 0;
  private frameNo = 0;

  /** Restore everything (leaving play or turning features off). */
  reset(entries: Iterable<Cullable>) {
    this.fadeGhosts(0);
    for (const e of entries) {
      e.visual.visible = true;
      e.visual.traverse((o: any) => {
        if (o.userData.lod0) { o.geometry = o.userData.lod0; delete o.userData.lod0; delete o.userData.lodLevel; }
        if (o.userData.frustumWas !== undefined) { o.frustumCulled = o.userData.frustumWas; delete o.userData.frustumWas; }
      });
    }
    this.states.clear(); this.occluders = []; this.occluderVersion = -1;
  }

  update(entries: Map<number, Cullable>, cam: THREE.Camera, world: World | null, s: RenderSettings, renderer: THREE.WebGLRenderer) {
    this.frameNo++;
    const st = this.stats;
    st.objects = 0; st.distance = 0; st.occluded = 0; st.lod = 0; st.range = 0;
    st.triangles = renderer.info.render.triangles; st.calls = renderer.info.render.calls;
    const camPos = cam.getWorldPosition(tmp.clone());
    if (s.occlusion && world && world.plane === 'xz') this.refreshOccluders(world);
    // Frustum culling uses each mesh's rest-pose bounds: animated (skinned) meshes reach outside them, so they are
    // never frustum-culled (arms and legs used to vanish at the screen edge). The toggle turns it off for all.
    for (const e of entries.values()) e.visual.traverse((o: any) => {
      if (!o.isMesh && !o.isPoints && !o.isLine && !o.isSprite) return;
      const want = s.frustum !== false && !o.isSkinnedMesh && !e.visual.userData.noCull;
      if (o.userData.frustumWas === undefined) o.userData.frustumWas = o.frustumCulled;
      const v = want && o.userData.frustumWas;
      if (o.frustumCulled !== v) o.frustumCulled = v;
    });
    const list = [...entries.values()].filter((e) => e.visual.userData.cull && !e.visual.userData.noCull);
    // Occlusion is re-tested for a slice of the objects each frame (every object about 4x a second at 60 fps).
    const slice = Math.max(8, Math.ceil(list.length / 15));
    const from = this.cursor % Math.max(1, list.length);
    this.cursor = from + slice;
    const persp = (cam as THREE.PerspectiveCamera).isPerspectiveCamera ? (cam as THREE.PerspectiveCamera) : null;
    cam.updateMatrixWorld();
    frustum.setFromProjectionMatrix(viewProj.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
    let rechecks = 0;
    for (let n = 0; n < list.length; n++) {
      const e = list[n];
      if (!e.obj.visible) continue;
      st.objects++;
      let state = this.states.get(e.uid);
      if (!state) { state = { occluded: false, hits: 0, box: new THREE.Box3(), boxAt: -1, at: new THREE.Vector3(NaN, 0, 0), level: 0, decision: 'visible' }; this.states.set(e.uid, state); }
      // World bounds: re-measured whenever the object moved (a running enemy must never be judged by where it
      // was half a second ago), otherwise every ~30 frames (animation).
      const moved = !state.at.equals(e.obj.position);
      if (moved || state.boxAt < 0 || this.frameNo - state.boxAt > 30) { state.box.setFromObject(e.visual); state.boxAt = this.frameNo; state.at.copy(e.obj.position); }
      if (state.box.isEmpty()) continue;
      state.box.getBoundingSphere(sphere);
      const dist = Math.max(0, sphere.center.distanceTo(camPos) - sphere.radius);
      let show = !(s.drawDistance > 0 && dist > s.drawDistance);
      state.decision = show ? 'visible' : 'distance';
      if (!show) st.distance++;
      // Per-object visibility range (Object › Visible from / to): e.g. small props only near, skyline only far.
      const range = e.visual.userData.visRange as [number, number] | undefined;
      if (show && range && ((range[0] > 0 && dist < range[0]) || (range[1] > 0 && dist > range[1]))) { show = false; state.decision = 'range'; st.range++; }
      if (show && s.occlusion && this.occluders.length) {
        const due = (n - from + list.length) % list.length < slice;
        // Show fast, hide slow: hidden objects in view are re-tested now; hiding needs two hidden results in a row.
        const recheck = !due && state.occluded && rechecks < MAX_RECHECKS && frustum.intersectsBox(state.box);
        if (recheck) rechecks++;
        if (due || recheck) {
          state.box.setFromObject(e.visual); state.boxAt = this.frameNo;
          const h = this.hidden(e.uid, state.box, camPos);
          state.hits = h ? state.hits + 1 : 0;
          state.occluded = h && (state.occluded || state.hits >= 2);
        }
        if (state.occluded) { show = false; st.occluded++; state.decision = 'occluded'; }
      }
      if (e.visual.visible !== show) e.visual.visible = show;
      if (show && s.lod && persp) {
        // Distances set in the settings, else screen size (fraction of the view height the object covers).
        // Hysteresis: moving back up a level needs 10% more, so a model on the boundary does not flicker.
        const d = Math.max(0.01, sphere.center.distanceTo(camPos)), prev = state.level;
        let level: number;
        if (s.lodNear > 0) {
          const n1 = prev >= 1 ? s.lodNear * 0.9 : s.lodNear, f2 = s.lodFar > 0 ? (prev >= 2 ? s.lodFar * 0.9 : s.lodFar) : Infinity;
          level = d > f2 ? 2 : d > n1 ? 1 : 0;
        } else {
          const cover = sphere.radius / (d * Math.tan((persp.fov * Math.PI) / 360));
          const t1 = prev >= 1 ? 0.132 : 0.12, t2 = prev >= 2 ? 0.044 : 0.04;
          level = cover >= t1 ? 0 : cover < t2 ? 2 : 1;
        }
        state.level = level;
        if (level) st.lod++;
        this.applyLod(e.visual, level, s.lodBlend ?? 0.3);
      }
    }
    this.fadeGhosts(s.lodBlend ?? 0.3);
  }

  /** Cross-fading LOD switches: a copy of the mesh with the old geometry, dissolving (hashed alpha) over the new one. */
  private ghosts: { mesh: THREE.Mesh; t0: number }[] = [];
  private fadeGhosts(blend: number) {
    const now = performance.now() / 1000;
    this.ghosts = this.ghosts.filter((g) => {
      const k = blend > 0 ? (now - g.t0) / blend : 1;
      if (k >= 1 || !g.mesh.parent) {
        g.mesh.removeFromParent();
        for (const m of [g.mesh.material].flat()) m.dispose();
        return false;
      }
      for (const m of [g.mesh.material].flat()) m.opacity = (m.userData.fullOpacity ?? 1) * (1 - k);
      return true;
    });
  }
  private ghost(o: THREE.Mesh, oldGeo: THREE.BufferGeometry, blend: number) {
    if (blend <= 0 || !o.parent || this.ghosts.length > 200) return;
    const mats = [o.material].flat().map((m) => { const c = m.clone(); c.userData.fullOpacity = m.opacity; c.alphaHash = !m.transparent; return c; });
    const g = new THREE.Mesh(oldGeo, Array.isArray(o.material) ? mats : mats[0]);
    g.position.copy(o.position); g.quaternion.copy(o.quaternion); g.scale.copy(o.scale);
    g.castShadow = false; g.userData.lodGhost = true;
    o.parent.add(g);
    this.ghosts.push({ mesh: g, t0: performance.now() / 1000 });
  }

  private applyLod(root: THREE.Object3D, level: number, blend = 0) {
    root.traverse((o: any) => {
      // Boolean results are rebuilt from their own source: no LOD copies of them.
      if (!o.isMesh || o.isSkinnedMesh || o.morphTargetInfluences || o.userData.lodGhost || o.userData.boolSrc) return;
      const base: THREE.BufferGeometry = o.userData.lod0 ?? o.geometry;
      if ((o.userData.lodLevel ?? 0) === level) return;
      if (level === 0) { this.ghost(o, o.geometry, blend); o.geometry = base; o.userData.lodLevel = 0; return; }
      const c = lodCache.get(base);
      if (!c) { requestLods(base); return; }
      if (c === 'pending' || c === 'skip') return;
      const g = c[level - 1] ?? c[0];
      if (!g) return;
      // Never swap a multi-material mesh to a copy without material groups (it would draw nothing).
      if (Array.isArray(o.material) && o.material.length > 1 && g.groups.length < 2) return;
      this.ghost(o, o.geometry, blend);
      o.userData.lod0 = base; o.geometry = g; o.userData.lodLevel = level;
    });
  }

  /** Solid collision boxes big enough to hide things (walls, floors, pillars). */
  private refreshOccluders(world: World) {
    if (world.solidsVersion === this.occluderVersion && this.occluders.length) return;
    this.occluderVersion = world.solidsVersion;
    this.occluders = [];
    for (const i of world.instances) {
      if (i.destroyed || !i.visible || i.collider.shape === 'none' || i.collider.isTrigger || i.voxel) continue;
      if (!i.behaviors.some((b) => b.type === 'solid')) continue;
      for (const b of world.aabbs(i)) {
        const dx = b[3] - b[0], dy = b[4] - b[1], dz = b[5] - b[2];
        // At least 1.5 m across in two directions: a wall, floor or ceiling slab.
        if ([dx, dy, dz].filter((d) => d >= 1.5).length < 2) continue;
        this.occluders.push({ uid: i.uid, box: new THREE.Box3(new THREE.Vector3(b[0], b[1], b[2]), new THREE.Vector3(b[3], b[4], b[5])) });
      }
      if (this.occluders.length > 3000) break;
    }
  }

  /** True when every sample point of the (slightly grown) bounds is behind some occluder. */
  private hidden(uid: number, box: THREE.Box3, cam: THREE.Vector3): boolean {
    const b = box.clone().expandByScalar(0.03);
    if (b.containsPoint(cam)) return false;
    // Anything close to the camera is always drawn (no risk of a missing ceiling or wall right next to you).
    if (b.distanceToPoint(cam) < NEAR_KEEP) return false;
    const pts: THREE.Vector3[] = [b.getCenter(new THREE.Vector3()), b.clampPoint(cam, new THREE.Vector3())];
    for (let k = 0; k < 8; k++) pts.push(new THREE.Vector3(k & 1 ? b.max.x : b.min.x, k & 2 ? b.max.y : b.min.y, k & 4 ? b.max.z : b.min.z));
    // Large objects (ceilings, floors, rooms): a 5x5 grid over the face nearest the camera, along the thinnest axis.
    // Corners alone said "hidden" for a ceiling whose middle was in plain view.
    const size = b.getSize(new THREE.Vector3());
    if (Math.max(size.x, size.y, size.z) > 3) {
      const thin = size.x <= size.y && size.x <= size.z ? 'x' : size.y <= size.z ? 'y' : 'z';
      const [u, v] = thin === 'x' ? ['y', 'z'] as const : thin === 'y' ? ['x', 'z'] as const : ['x', 'y'] as const;
      const side = cam[thin] < (b.min[thin] + b.max[thin]) / 2 ? b.min[thin] : b.max[thin];
      for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) {
        const p = new THREE.Vector3();
        p[thin] = side; p[u] = b.min[u] + ((i + 0.5) / 5) * size[u]; p[v] = b.min[v] + ((j + 0.5) / 5) * size[v];
        pts.push(p);
      }
    }
    // Only walls between the camera and the object can hide it.
    const between = b.clone().expandByPoint(cam);
    const near = this.occluders.filter((o) => o.uid !== uid && o.box.intersectsBox(between) && !o.box.containsPoint(cam));
    if (!near.length) return false;
    for (const p of pts) {
      const len = p.distanceTo(cam);
      ray.origin.copy(cam); ray.direction.copy(p).sub(cam).normalize();
      let blocked = false;
      for (const o of near) {
        if (o.box.containsPoint(p)) continue;
        const hit = ray.intersectBox(o.box, corner);
        if (hit && hit.distanceTo(cam) < len - 0.05) { blocked = true; break; }
      }
      if (!blocked) return false;
    }
    return true;
  }
}
