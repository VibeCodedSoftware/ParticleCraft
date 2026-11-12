// SceneView turns SceneData (editor) or live runtime instances (play) into a three.js scene.
// The editor and Play mode use the same object builders, so what you edit is what runs.
import { XrHost } from './xr';
import { BATCHED_LAYER, Batcher, batchAwareSort, type Batchable } from './batcher';
import { Cascades } from './cascades';
import { TextureManager } from './textureManager';
import type { SunInfo } from './atmosphere';
import { QUALITY, SHADOW_FILTERS, setCurrentQuality, shadowDefaults, validMaxFps, validRenderScale, type QualityPreset } from './quality';
import { FrameProfiler } from './profiler';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { boneNames, hipHeight, retargetClip } from './retarget';
import { animateSlots, applyMaterialMaps, type LiveSlot } from './materialMaps';
import { isWaterSurface, WATER_FX } from '@shared/src/runtime/water';
import { patchWaterMaterial, waterGeometry, setWaterUniforms, setWaterSky, needsDepth, needsScene, makeCausticLight, placeCausticLight, causticPose, causticShadowStart, MAX_RIPPLES, WaterPass, type WaterUniforms } from './waterFx';
import { CloudLayer, cloudDefaults } from './cloudLayer';
import { EndlessWorld, softBacks } from './endlessWorld';
import { skyState } from '@shared/src/runtime/sky';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { InstanceData, SceneData, PostFxEffect } from '@shared/src/runtime/scene';
import { displacedGeometry, displacedSize } from './displacement';
import { updateBoolean } from './booleanMesh';
import { BLOOD_IMAGE, bloodSpeckle } from '@shared/src/runtime/marks';
import { bakeSignature, decodeProbes, encodeProbes, fillInvalidProbes, isMoving, planVolume, type GiBake, type GiMode, type GiQuality, type LightingSettings } from '@shared/src/runtime/lighting';
import { ProbeCapture, ProbeVolume, ReflectionProbe, envBlend, giUniforms, makeMirror, patchGi, probeDebugMesh } from './lighting';
import type { Reflector } from 'three/examples/jsm/objects/Reflector.js';
import type { LockOnState } from '@shared/src/runtime/lockon';
import { cellCentre, type GridProps, type GridState } from '@shared/src/runtime/gridTurns';
import { applyBonePose, resetBonePose } from './bonePose';
import { socketFor, socketMatrix, updateSocket, type BoneSocket } from './boneSockets';
import { BoneOverlay, type BonePick } from './boneOverlay';
import type { BoneEdit } from '@shared/src/runtime/scene';
import type { Cut } from '@shared/src/runtime/boolean';
import type { Runtime } from '@shared/src/runtime/runtime';
import { World, type RInstance } from '@shared/src/runtime/world';
import { Culler, type RenderSettings } from './culling';
import { ScreenTextLayer } from './screenText';
import { ObjectFxPass, type FxItem } from './objectFx';
import { DebrisSystem, shatterKey } from './shatter';
import { webcam } from '@shared/src/runtime/devices';
import { ropeCurve } from '@shared/src/runtime/rope';
import { RopeViews, type RopeLook } from './ropeView';
import { activeFx } from '@shared/src/objectFx';
import { drawStyledText } from '@shared/src/runtime/textStyle';
import { SkyRig } from './skyRig';
import { Emitter, PARTICLE_PRESETS } from '@shared/src/runtime/particles';
import { limitTexture, loadModel, loadTexture, setTextureAnisotropy, setTextureLimits } from './assets';
import { makeCamera, makeLight, updateCamera, updateLight } from './blenderStyle';
import { spriteSheet } from './sprites';
import { animFrame, frameCell, pickSpriteAnim } from '@shared/src/runtime/spriteAnim';
import { ParticleView } from './particlesView';
import { PostFx, patchPs1, ps1Uniforms } from './postfx';
import { assetUrl } from '../project/api';
import { buildVoxelGeometry } from './voxelView';
import { TilemapView } from './tilemapView';
import { previewCells, tileTools } from '@shared/ui/tilemapTools';
import { resolveClip, withDerivedClips } from './animClips';
import { ProcAnimator, analyzeRig, applyHoldPose, parseBoneMap, type RigInfo } from './procAnim';
import { collisionColor, collisionKind } from '@shared/src/collisionView';
import { colliderOutline } from './colliderShapes';
import { raycast } from '@shared/src/runtime/physics';
import { partAngle, type PartSwing } from '@shared/src/runtime/vehicle';
import { generateVoxels, type VoxelGrid } from '@shared/src/runtime/voxel';
import type { AssetRef } from '../project/types';

/** Corner index pairs of a box's 12 edges (corners ordered x, then y, then z). */
const BOX_EDGES = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];

interface Entry {
  uid: number;
  obj: THREE.Object3D; // transform node (position/rotation/scale)
  visual: THREE.Object3D; // kind-specific content
  sig: string;
  mixer?: THREE.AnimationMixer;
  clips?: THREE.AnimationClip[];
  action?: THREE.AnimationAction;
  animName?: string;
  camera?: THREE.Camera;
  colliderHelper?: THREE.LineSegments;
  materials: THREE.Material[];
  spriteState?: { sheet: ReturnType<typeof spriteSheet> | null; t: number; frame: number; anim: string; frames: number; img?: boolean };
  tint?: string;
  /** Voxel terrain: editor-preview grid, its settings signature, and the last meshed version. */
  voxelGrid?: VoxelGrid; voxelSig?: string; voxelKey?: string;
  /** Tilemap: its view and the data last applied (redrawn from render(), where the paint overlay is known). */
  tilemap?: TilemapView; tilemapInst?: InstanceData;
  /** Animated texture slots (frames, scroll, spin), advanced every frame. */
  animMaps?: LiveSlot[];
  /** Model parts swung by "Rotate model part": each re-hung on a hinge pivot (object-local). */
  pivots?: Map<string, { pivot: THREE.Group; axis: THREE.Vector3 } | null>;
  /** The loaded model (imported meshes): what Procedural Animation poses. */
  model?: THREE.Object3D;
  /** Bones with objects hung on them (Bone view). */
  sockets?: Map<string, BoneSocket>;
  /** Procedural Animation while playing, and the runtime object it follows. */
  proc?: ProcAnimator; procKey?: string; rinst?: RInstance; procTime?: number;
  /** Its primitive is subdivided for height displacement (see displacedGeometry). */
  displaced?: boolean;
  /** Water look (waves, foam, depth colour, caustics): its shader uniforms, own geometry and caustics light. */
  water?: { u: WaterUniforms; inst: InstanceData; geo?: THREE.BufferGeometry; light?: THREE.SpotLight; nextRipple?: number };
}

/** A soft-edged round splat (white, tinted per mark) for paint decals; made once. */
let blob: THREE.Texture | null = null;
function paintBlob(): THREE.Texture {
  if (blob) return blob;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d')!;
  // A round core with a few lumps, so a trail of marks looks painted rather than stamped.
  g.fillStyle = '#fff';
  for (let k = 0; k < 7; k++) { const a = k * 2.4, r = k ? 9 + (k * 37) % 7 : 22; g.beginPath(); g.arc(32 + Math.cos(a) * (k ? 16 : 0), 32 + Math.sin(a) * (k ? 16 : 0), r, 0, Math.PI * 2); g.fill(); }
  blob = new THREE.CanvasTexture(c); blob.colorSpace = THREE.SRGBColorSpace;
  return blob;
}

const TEXTURE_SLOTS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap', 'alphaMap', 'bumpMap'];

/** Blood patches on the floor: four speckle pictures (white, tinted per mark), made once; a patch's id picks one. */
const bloodTextures: THREE.Texture[] = [];
function bloodTexture(id: number): THREE.Texture {
  const k = id % 4;
  if (bloodTextures[k]) return bloodTextures[k];
  const size = 192, { alpha, shade } = bloodSpeckle(k + 1, size), data = new Uint8Array(size * size * 4);
  for (let n = 0; n < alpha.length; n++) { data[n * 4] = data[n * 4 + 1] = data[n * 4 + 2] = shade[n]; data[n * 4 + 3] = alpha[n]; }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  // Hard pixels at every distance (no mipmaps): blended down, the flecks would wash out to a pale pink haze.
  t.colorSpace = THREE.SRGBColorSpace; t.magFilter = t.minFilter = THREE.NearestFilter; t.generateMipmaps = false; t.needsUpdate = true;
  return (bloodTextures[k] = t);
}

export const PRIM: Record<string, () => THREE.BufferGeometry> = {
  box: () => new THREE.BoxGeometry(1, 1, 1),
  sphere: () => new THREE.SphereGeometry(0.5, 24, 16),
  cylinder: () => new THREE.CylinderGeometry(0.5, 0.5, 1, 24),
  cone: () => new THREE.ConeGeometry(0.5, 1, 24),
  plane: () => new THREE.BoxGeometry(1, 0.02, 1),
  capsule: () => new THREE.CapsuleGeometry(0.3, 0.4, 6, 16),
  torus: () => new THREE.TorusGeometry(0.35, 0.15, 12, 32),
  ramp: () => { const g = new THREE.BufferGeometry(); const v = [-.5, -.5, -.5, .5, -.5, -.5, .5, -.5, .5, -.5, -.5, .5, -.5, .5, -.5, .5, .5, -.5]; const idx = [0, 1, 2, 0, 2, 3, 0, 4, 5, 0, 5, 1, 3, 2, 5, 3, 5, 4, 0, 3, 4, 1, 5, 2]; g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3)); g.setIndex(idx); const flat = g.toNonIndexed(); flat.computeVertexNormals(); return flat; }, // separate corners per face: shared ones smooth the shading across hard edges
};

/** Tileable ripple normal map for water surfaces (made once; each water body scrolls its own copy). */
let waterNormalImage: HTMLCanvasElement | null = null;
function waterNormals(): THREE.Texture {
  if (!waterNormalImage) {
    const n = 128, c = document.createElement('canvas'); c.width = c.height = n;
    const g = c.getContext('2d')!, img = g.createImageData(n, n);
    const h = (x: number, y: number) => Math.sin((x / n) * Math.PI * 6) * 0.5 + Math.sin(((x + y) / n) * Math.PI * 10) * 0.3 + Math.cos((y / n) * Math.PI * 8 + Math.sin((x / n) * Math.PI * 4)) * 0.4;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const dx = h(x + 1, y) - h(x - 1, y), dy = h(x, y + 1) - h(x, y - 1);
      const k = (y * n + x) * 4;
      img.data[k] = 128 + dx * 60; img.data[k + 1] = 128 + dy * 60; img.data[k + 2] = 255; img.data[k + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    waterNormalImage = c;
  }
  const t = new THREE.CanvasTexture(waterNormalImage);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(4, 4);
  return t;
}

const geoCache = new Map<string, THREE.BufferGeometry>();
const geo = (k: string) => { let g = geoCache.get(k); if (!g) { g = PRIM[k](); geoCache.set(k, g); } return g; };

export type Shading = 'wireframe' | 'solid' | 'rendered';

export class SceneView {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  root = new THREE.Group();
  helpers = new THREE.Group();
  /** Collider outlines / Collision View: also shown while playing and in Camera View (debugging collisions). */
  private colliderGroup = new THREE.Group();
  entries = new Map<number, Entry>();
  editorCam: THREE.PerspectiveCamera;
  editorOrtho: THREE.OrthographicCamera;
  controls: OrbitControls;
  viewCamera: THREE.Camera;
  mode2d = false;
  /** 2D lighting of the current scene (2D scenes with lighting on): sprites are lit and can use normal maps. */
  private lit2d: NonNullable<SceneData['settings']['lighting2d']> | null = null;
  orthoView = false;
  useSceneCamera = false;
  /** Camera View: look through this camera (editor only; null = the scene's active camera). */
  viewCameraUid: number | null = null;
  /** Camera View framing guide: the game window's aspect (0 = off). Wider than the viewport widens the view to match. */
  frameAspect = 0;
  /** Collision View: colliders as filled boxes coloured by what they do, everything else ghosted. */
  collisionView = false;
  /**
   * Game View: a live window (CSS pixels from the canvas' top-left) showing what the game camera sees, lit as in the
   * game, without editor helpers. Null = off.
   */
  gameView: { x: number; y: number; w: number; h: number } | null = null;
  shading: Shading = 'rendered';
  showColliders = false;
  grid: THREE.GridHelper;
  private hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.6);
  private studio = new THREE.Group();
  private selBoxes = new Map<number, THREE.BoxHelper>();
  postfx: PostFx;
  particleViews = new Map<string, ParticleView>();
  previewEmitters = new Map<number, Emitter>();
  projectId = '';
  assets: AssetRef[] = [];
  data: SceneData | null = null;
  width = 1; height = 1;
  clock = new THREE.Clock();
  private wire = new THREE.MeshBasicMaterial({ wireframe: true, color: 0xb9c2cf });
  private toon = new Map<THREE.Material, THREE.Material>();
  onLoadError?: (msg: string) => void;

  constructor(public container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.AgXToneMapping;
    // Counted per frame across all post-processing passes (reset in render()).
    this.renderer.info.autoReset = false;
    container.appendChild(this.renderer.domElement);
    this.editorCam = new THREE.PerspectiveCamera(50, 1, 0.05, 2000);
    this.editorCam.position.set(10, 8, 12);
    this.editorOrtho = new THREE.OrthographicCamera(-10, 10, 10, -10, -1000, 1000);
    this.editorOrtho.position.set(0, 0, 100);
    this.viewCamera = this.editorCam;
    this.controls = new OrbitControls(this.editorCam, this.renderer.domElement);
    // Blender navigation: middle mouse orbits, Shift+middle pans, wheel zooms. Alt+left also orbits (emulate 3-button mouse).
    this.controls.mouseButtons = { LEFT: null as any, MIDDLE: THREE.MOUSE.ROTATE, RIGHT: null as any };
    this.controls.zoomToCursor = true;
    this.controls.enableDamping = false;
    this.grid = new THREE.GridHelper(200, 200, 0x6a6f78, 0x3a3e45);
    (this.grid.material as THREE.Material).transparent = true; (this.grid.material as THREE.Material).opacity = 0.5;
    const axes = new THREE.Group();
    const line = (a: THREE.Vector3, b: THREE.Vector3, c: number) => new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, b]), new THREE.LineBasicMaterial({ color: c }));
    axes.add(line(new THREE.Vector3(-100, 0.001, 0), new THREE.Vector3(100, 0.001, 0), 0xd64545)); // X red, like Blender
    axes.add(line(new THREE.Vector3(0, 0.001, -100), new THREE.Vector3(0, 0.001, 100), 0x6fae3b)); // Z (Blender's Y) green
    this.helpers.add(this.grid, axes);
    const key = new THREE.DirectionalLight(0xffffff, 2.2); key.position.set(4, 10, 6);
    const fill = new THREE.HemisphereLight(0xdfe7ff, 0x40362c, 1.4);
    this.studio.add(key, fill);
    this.scene.add(this.root, this.helpers, this.colliderGroup, this.hemi, this.studio);
    this.postfx = new PostFx({ renderer: this.renderer, scene: this.scene, camera: this.editorCam, width: 1, height: 1 });
    this.postfx.sunInfo = () => this.sunInfo();
    this.postfx.textureOf = (id) => { const url = id ? assetUrl(this.projectId, id) : null; if (!url) return null; const t = loadTexture(url); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t; };
    const ro = new ResizeObserver(() => this.resize());
    ro.observe(container);
    this.resize();
  }

  /** Quality preset (Preferences › Rendering): shadow filtering, shadow map size (read by lights) and pixel ratio. */
  private qualityName: QualityPreset = 'high';
  setQuality(q: QualityPreset | undefined) {
    const name = q ?? 'high';
    if (name === this.qualityName) return;
    this.qualityName = name; setCurrentQuality(name);
    this.applyShadowFilter();
    this.resize();
  }
  /** Shadow on/off and filter: the project's choice, else the Quality preset's. Compiled into the materials. */
  private shadowFilter: RenderSettings['shadowFilter'];
  private applyShadowFilter() {
    const type = this.shadowFilter ? SHADOW_FILTERS[this.shadowFilter].type : QUALITY[this.qualityName].shadowType;
    if (this.renderer.shadowMap.type === type) return;
    this.renderer.shadowMap.type = type;
    this.renderer.shadowMap.needsUpdate = true;
    this.scene.traverse((o) => { const m = (o as THREE.Mesh).material; if (m) for (const x of ([] as THREE.Material[]).concat(m)) x.needsUpdate = true; });
  }

  /** Anti-aliasing, ambient occlusion, shadows, textures, render scale (Project settings › Rendering). Values are checked here. */
  private anisotropy = 8;
  private renderScale = 1;
  private hiDpi = true;
  /** Drawing limit for the game loop (0 = none). */
  maxFps = 0;
  private texKey = '';
  setRenderExtras(rs: Partial<RenderSettings> | undefined) {
    this.postfx.setExtras(rs?.antialias, rs?.ambientOcclusion, rs?.msaaSamples, rs?.contactShadows);
    this.maxFps = validMaxFps(rs?.maxFps);
    const scale = validRenderScale(rs?.renderScale), dpi = rs?.hiDpi !== false;
    if (scale !== this.renderScale || dpi !== this.hiDpi) { this.renderScale = scale; this.hiDpi = dpi; this.resize(); }
    const shadowsOn = rs?.shadows !== false;
    if (this.renderer.shadowMap.enabled !== shadowsOn) {
      this.renderer.shadowMap.enabled = shadowsOn;
      this.scene.traverse((o) => { const m = (o as THREE.Mesh).material; if (m) for (const x of ([] as THREE.Material[]).concat(m)) x.needsUpdate = true; });
    }
    if (rs?.shadowFilter !== this.shadowFilter) { this.shadowFilter = rs?.shadowFilter; this.applyShadowFilter(); }
    shadowDefaults.resolution = Math.max(0, Number(rs?.shadowResolution) || 0);
    shadowDefaults.distance = Math.max(0, Number(rs?.shadowDistance) || 0);
    this.skyRig?.applyShadowDefaults();
    const texKey = `${rs?.textureMaxSize ?? 0}|${rs?.textureFilter ?? 'trilinear'}`;
    if (texKey !== this.texKey) {
      this.texKey = texKey;
      setTextureLimits(Number(rs?.textureMaxSize) || 0, rs?.textureFilter ?? 'trilinear');
      this.patchedKey = ''; // textures inside models go through it too
    }
    const want = Math.min(this.renderer.capabilities.getMaxAnisotropy(), { low: 1, medium: 4, high: 8, max: 16 }[rs?.textureQuality ?? 'high']);
    if (want === this.anisotropy) return;
    this.anisotropy = want; setTextureAnisotropy(want);
    // Textures already on screen (pixel-art ones keep nearest filtering, anisotropy 1).
    this.scene.traverse((o) => {
      for (const m of ([] as THREE.Material[]).concat((o as THREE.Mesh).material ?? [])) for (const v of Object.values(m)) {
        const t = v as THREE.Texture;
        if (t?.isTexture && t.minFilter !== THREE.NearestFilter && t.anisotropy !== want) { t.anisotropy = want; t.needsUpdate = true; }
      }
    });
  }

  resize() {
    const w = Math.max(1, this.container.clientWidth), h = Math.max(1, this.container.clientHeight);
    this.width = w; this.height = h;
    this.renderer.setPixelRatio((this.hiDpi ? Math.min(window.devicePixelRatio, QUALITY[this.qualityName].maxPixelRatio) : 1) * this.renderScale);
    this.renderer.setSize(w, h);
    this.editorCam.aspect = w / h; this.editorCam.updateProjectionMatrix();
    this.updateOrtho();
    this.postfx.setSize(w, h);
  }

  private orthoHalf = 8;
  updateOrtho() {
    const a = this.width / this.height;
    Object.assign(this.editorOrtho, { left: -this.orthoHalf * a, right: this.orthoHalf * a, top: this.orthoHalf, bottom: -this.orthoHalf });
    this.editorOrtho.updateProjectionMatrix();
  }

  set2D(on: boolean) {
    this.mode2d = on;
    this.grid.rotation.x = on ? Math.PI / 2 : 0;
    if (on) {
      this.controls.object = this.editorOrtho;
      this.viewCamera = this.editorOrtho;
      this.editorOrtho.position.set(this.controls.target.x, this.controls.target.y, 100);
      this.controls.mouseButtons = { LEFT: null as any, MIDDLE: THREE.MOUSE.PAN, RIGHT: null as any };
      this.controls.enableRotate = false;
    } else {
      this.controls.object = this.orthoView ? this.editorOrtho : this.editorCam;
      this.viewCamera = this.controls.object as THREE.Camera;
      this.controls.mouseButtons = { LEFT: null as any, MIDDLE: THREE.MOUSE.ROTATE, RIGHT: null as any };
      this.controls.enableRotate = true;
    }
    this.controls.update();
  }

  /** Numpad 5: toggle perspective / orthographic editor view (Blender). */
  toggleOrtho() {
    if (this.mode2d) return;
    this.orthoView = !this.orthoView;
    const from = this.controls.object as THREE.Camera, to = this.orthoView ? this.editorOrtho : this.editorCam;
    to.position.copy(from.position); to.quaternion.copy(from.quaternion);
    if (this.orthoView) { this.orthoHalf = from.position.distanceTo(this.controls.target) * 0.45; this.updateOrtho(); }
    this.controls.object = to; this.viewCamera = to; this.controls.update();
  }

  /** Numpad 1/3/7 (+Ctrl for opposite) like Blender: front, right, top. */
  viewAxis(axis: 'front' | 'back' | 'right' | 'left' | 'top' | 'bottom') {
    const t = this.controls.target, d = (this.controls.object as THREE.Camera).position.distanceTo(t) || 15;
    const dir = { front: [0, 0, 1], back: [0, 0, -1], right: [1, 0, 0], left: [-1, 0, 0], top: [0, 1, 0.0001], bottom: [0, -1, 0.0001] }[axis];
    (this.controls.object as THREE.Camera).position.set(t.x + dir[0] * d, t.y + dir[1] * d, t.z + dir[2] * d);
    this.controls.update();
  }

  frame(uids: number[]) {
    const box = new THREE.Box3();
    for (const u of uids.length ? uids : [...this.entries.keys()]) { const e = this.entries.get(u); if (e) box.expandByObject(e.obj); }
    if (box.isEmpty()) return;
    const c = box.getCenter(new THREE.Vector3()), r = Math.max(1, box.getSize(new THREE.Vector3()).length() / 2);
    const cam = this.controls.object as THREE.Camera;
    const dir = cam.position.clone().sub(this.controls.target).normalize();
    this.controls.target.copy(c);
    if (this.mode2d) { cam.position.set(c.x, c.y, 100); this.orthoHalf = r * 1.2; this.updateOrtho(); }
    else { cam.position.copy(c).addScaledVector(dir, r * 2.4); if (this.orthoView) { this.orthoHalf = r * 1.2; this.updateOrtho(); } }
    this.controls.update();
  }

  // ------------------------------------------------------------ building
  private sigOf(i: InstanceData) {
    const tiling = i.material?.map || i.material?.maps || i.material?.randomTiling ? [Math.round(i.sx), Math.round(i.sy), Math.round(i.sz)].join('x') + JSON.stringify([i.material.maps ?? null, i.material.randomTiling ?? null]) : '';
    const water = isWaterSurface(i);
    const disp = i.material?.displace && i.material.maps?.height?.asset ? `d${i.material.displaceDetail ?? 1}:${[i.sx, i.sy, i.sz].map((s) => Math.round(s * 4)).join('x')}` : '';
    return [disp, i.kind, i.mesh?.asset, i.mesh?.rotY, (i.mesh?.animSources ?? []).join(','), i.mesh?.tint ? i.color : '', i.sprite?.image, i.sprite?.frames, i.sprite?.rows, i.sprite?.billboard, i.sprite?.billboardMode, i.kind === 'sprite' && (this.lit2d || (!this.mode2d && i.sprite?.lit)) ? 'lit:' + (i.sprite?.normalMap ?? '') : '', i.light?.type, i.camera?.type, i.text?.hud, i.material?.map, tiling, water ? `w${i.material?.ripples !== false}${i.material?.water?.waves ? `~${Math.round(i.sx)}x${Math.round(i.sz)}` : ''}${i.material?.water?.caustics ? 'c' : ''}` : ''].join('|');
  }

  private build(i: InstanceData): Entry {
    const obj = new THREE.Group();
    obj.userData.uid = i.uid;
    obj.rotation.order = 'YXZ';
    let visual: THREE.Object3D;
    const e: Entry = { uid: i.uid, obj, visual: obj, sig: this.sigOf(i), materials: [] };
    const stdMat = () => {
      const m = new THREE.MeshStandardMaterial({ color: i.color, roughness: i.material?.roughness ?? 0.6, metalness: i.material?.metalness ?? 0 });
      // Per-property textures (tiling, offset, rotation, random tiling, animation); automatic tiling is about one
      // repeat every 2 m so floors and walls do not stretch.
      e.animMaps = applyMaterialMaps(m, i, this.projectId);
      e.materials.push(m);
      return m;
    };
    if (PRIM[i.kind] && isWaterSurface(i)) {
      // Water surface (Material › Surface: Water): see-through and glossy, with a scrolling ripple normal map; no
      // shadows. Colour and opacity are the object's own (applied with the rest of its look below).
      const mm = i.material;
      const m = new THREE.MeshStandardMaterial({ color: i.color, transparent: true, roughness: mm?.roughness ?? 0.08, metalness: mm?.metalness ?? 0.1, depthWrite: false, side: THREE.DoubleSide });
      // Its texture slots too (Look: Stylised plays an animated water texture on Base color).
      e.animMaps = applyMaterialMaps(m, i, this.projectId);
      // (A Normal texture of its own takes the ripples' place, and moves by its own UV and scroll.)
      if (mm?.ripples !== false && !m.normalMap) { const k = mm?.rippleStrength ?? 0.6; m.normalMap = waterNormals(); m.normalScale.set(k, k); m.userData.waves = mm?.rippleSpeed ?? 1; }
      m.userData.baseOpacity = 1; m.userData.baseTransparent = true;
      e.materials.push(m);
      // Waves, foam, depth colour (waterFx.ts): a patched shader; waves get a finer surface to bend.
      const own = waterGeometry(i.kind, i) ?? undefined;
      e.water = { u: patchWaterMaterial(m), inst: i, geo: own };
      const mesh = new THREE.Mesh(own ?? geo(i.kind), m);
      mesh.renderOrder = 2;
      mesh.userData.water = true;
      if (mm?.water?.caustics) { e.water.light = makeCausticLight(); this.scene.add(e.water.light, e.water.light.target); }
      visual = mesh;
    } else if (PRIM[i.kind]) {
      const dense = displacedGeometry(i);
      const mesh = new THREE.Mesh(dense ?? geo(i.kind), stdMat());
      if (dense) { const [x, y, z] = displacedSize(i); mesh.scale.set(1 / x, 1 / y, 1 / z); e.displaced = true; }
      mesh.castShadow = true; mesh.receiveShadow = true;
      visual = mesh;
    } else if (i.kind === 'mesh') {
      const g = new THREE.Group();
      const ph = new THREE.Mesh(geo('box'), new THREE.MeshBasicMaterial({ color: 0x8a5cf6, wireframe: true }));
      ph.position.y = 0.5; ph.name = 'placeholder';
      g.add(ph);
      visual = g;
      this.loadMeshInto(e, i, g);
    } else if (i.kind === 'sprite') {
      const sheet = i.sprite ? spriteSheet(i.sprite.image) : null;
      // A lit material with 2D lighting, or in 3D when the sprite is set to Lit (with the normal map, same frames as
      // the image); otherwise unlit (the picture's own colours).
      const lit = !!this.lit2d || (!this.mode2d && !!i.sprite?.lit);
      const mat: THREE.MeshBasicMaterial | THREE.MeshStandardMaterial = lit
        ? new THREE.MeshStandardMaterial({ transparent: true, alphaTest: 0.5, side: THREE.DoubleSide, color: 0xffffff, roughness: 1, metalness: 0 })
        : new THREE.MeshBasicMaterial({ transparent: true, alphaTest: 0.5, side: THREE.DoubleSide, color: 0xffffff });
      let frames = i.sprite?.frames ?? 1;
      if (sheet) { mat.map = sheet.texture.clone(); frames = sheet.frames; }
      else if (i.sprite?.image) { const url = assetUrl(this.projectId, i.sprite.image); if (url) mat.map = loadTexture(url, i.sprite.pixelArt !== false).clone(); }
      const nUrl = lit && i.sprite?.normalMap ? assetUrl(this.projectId, i.sprite.normalMap) : null;
      if (nUrl && 'normalMap' in mat) { const n = loadTexture(nUrl, i.sprite!.pixelArt !== false).clone(); n.colorSpace = THREE.NoColorSpace; mat.normalMap = n; }
      for (const t of [mat.map, (mat as THREE.MeshStandardMaterial).normalMap]) if (t) { const c = frameCell({ frames, rows: sheet ? 1 : i.sprite?.rows }, 0); t.repeat.set(1 / c.cols, 1 / c.rows); t.offset.set(0, 1 - 1 / c.rows); t.needsUpdate = true; }
      else mat.color.set(i.color);
      e.materials.push(mat);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
      // Shadows in the picture's shape (its see-through parts cast none): depth materials that cut out by alpha and
      // share the sprite's texture (so they follow its animation frames).
      if (mat.map) {
        m.customDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: mat.map, alphaTest: 0.5, side: THREE.DoubleSide });
        m.customDistanceMaterial = new THREE.MeshDistanceMaterial({ map: mat.map, alphaTest: 0.5, side: THREE.DoubleSide });
      }
      visual = m;
      // 3D sprites marked "billboard" always face the camera (render()).
      if (i.sprite?.billboard) { m.userData.billboard = true; m.userData.billboardVertical = i.sprite.billboardMode === 'vertical'; mat.fog = false; }
      e.spriteState = { sheet, t: 0, frame: 0, anim: '', frames: Math.max(1, frames) };
    } else if (i.kind === 'light') {
      visual = makeLight(i.light!);
      const icon = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffe08a }));
      icon.name = 'editorIcon'; icon.userData.editorOnly = true;
      const dir = new THREE.ArrowHelper(new THREE.Vector3(0, 0, -1), new THREE.Vector3(), 1.2, 0xffe08a, 0.25, 0.12);
      dir.name = 'editorIcon'; dir.userData.editorOnly = true;
      visual.add(icon, dir);
    } else if (i.kind === 'camera') {
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.ConeGeometry(0.45, 0.8, 4, 1, true), new THREE.MeshBasicMaterial({ color: 0x9aa4b2, wireframe: true }));
      body.rotation.x = Math.PI / 2; body.rotation.y = Math.PI / 4; body.position.z = -0.4;
      body.userData.editorOnly = true; body.name = 'editorIcon';
      g.add(body);
      e.camera = makeCamera(i.camera!, this.width / this.height);
      visual = g;
    } else if (i.kind === 'text' && i.text && !i.text.hud) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true }));
      visual = sp;
      this.paintTextSprite(sp, i);
    } else if (i.kind === 'voxel') {
      // Voxel terrain: geometry is (re)built in apply() whenever the grid changes.
      const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
      e.materials.push(mat);
      const m = new THREE.Mesh(new THREE.BufferGeometry(), mat);
      m.castShadow = true; m.receiveShadow = true;
      visual = m;
    } else if (i.kind === 'tilemap') {
      e.tilemap = new TilemapView();
      e.materials.push(e.tilemap.material);
      visual = e.tilemap.group;
    } else if (i.kind === 'emitter') {
      const icon = new THREE.Mesh(new THREE.OctahedronGeometry(0.2), new THREE.MeshBasicMaterial({ color: 0xff7a45, wireframe: true }));
      icon.userData.editorOnly = true; icon.name = 'editorIcon';
      visual = icon;
    } else {
      const g = new THREE.Group();
      if (i.kind === 'empty') { const ax = new THREE.AxesHelper(0.6); ax.userData.editorOnly = true; ax.name = 'editorIcon'; g.add(ax); }
      visual = g;
    }
    visual.userData.uid = i.uid;
    // Things the play-time culler may hide or simplify (not lights, cameras, emitters, terrain).
    visual.userData.cull = !!PRIM[i.kind] || i.kind === 'mesh' || i.kind === 'sprite' || i.kind === 'text';
    obj.add(visual);
    e.visual = visual;
    return e;
  }

  private paintTextSprite(sp: THREE.Sprite, i: InstanceData) {
    // World text: drawn at 64 px per 0.5 m line, sized to the styled box (background, outline, wrapping).
    const st = i.text!.style;
    const measure = document.createElement('canvas').getContext('2d')!;
    const box = drawStyledText(measure, i.text!.text, 0, 0, { size: 64, color: i.text!.color, align: 'center', style: st && { ...st, padding: (st.padding ?? 0) * 3, maxWidth: (st.maxWidth ?? 0) * 3 } });
    const c = document.createElement('canvas'); c.width = Math.min(2048, Math.ceil(box.w + 16)); c.height = Math.min(1024, Math.ceil(box.h + 16));
    const g = c.getContext('2d')!;
    drawStyledText(g, i.text!.text, c.width / 2, c.height / 2, { size: 64, color: i.text!.color, align: 'center', style: st && { ...st, padding: (st.padding ?? 0) * 3, maxWidth: (st.maxWidth ?? 0) * 3, outlineWidth: (st.outlineWidth ?? 0) * 2 } });
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    (sp.material as THREE.SpriteMaterial).map?.dispose();
    (sp.material as THREE.SpriteMaterial).map = t;
    sp.scale.set(c.width / 128, c.height / 128, 1);
    sp.userData.text = i.text!.text + JSON.stringify(st ?? '');
  }

  private async loadMeshInto(e: Entry, i: InstanceData, g: THREE.Group) {
    const id = i.mesh!.asset;
    const url = assetUrl(this.projectId, id);
    if (!url) return;
    const ref = this.assets.find((a) => a.id === id);
    const mtl = ref?.extra?.find((x) => x.toLowerCase().endsWith('.mtl')) ?? (id.toLowerCase().endsWith('.obj') ? id.replace(/\.obj$/i, '.mtl') : undefined);
    try {
      const m = await loadModel(url, ref?.importSettings ?? {}, mtl ? assetUrl(this.projectId, mtl) ?? undefined : undefined);
      if (this.entries.get(i.uid) !== e) return; // rebuilt meanwhile
      g.clear();
      m.scene.rotation.y += ((i.mesh!.rotY ?? 0) * Math.PI) / 180;
      m.scene.traverse((o) => {
        o.userData.uid = i.uid;
        const mm = o as THREE.Mesh;
        if (!mm.isMesh) return;
        // Remember the model's own transparency: the object's Opacity multiplies it, never replaces it (glass
        // with opacity 0.35 made "opaque" but still not writing depth was painted over by whatever was behind).
        const clone = (mt: THREE.Material) => { const c = mt.clone(); c.userData.baseOpacity = mt.opacity; c.userData.baseTransparent = mt.transparent; if (i.mesh!.tint) (c as any).color?.set(i.color); softBacks(c); e.materials.push(c); return c; };
        // A model with Surface: Water (a river's ribbon) is drawn by the water shader, like water on a box.
        if (isWaterSurface(i)) {
          const wm = new THREE.MeshStandardMaterial({ color: i.color, transparent: true, opacity: Math.max(0.05, (i.opacity ?? 60) / 100), roughness: i.material?.roughness ?? 0.08, metalness: i.material?.metalness ?? 0.1, depthWrite: false, side: THREE.DoubleSide });
          e.water = { u: patchWaterMaterial(wm), inst: i };
          mm.material = wm; mm.userData.water = true; e.materials.push(wm);
          return;
        }
        mm.material = Array.isArray(mm.material) ? mm.material.map(clone) : clone(mm.material);
      });
      g.add(m.scene);
      e.model = m.scene; e.proc?.reset(); e.proc = undefined;
      applyHoldPose(m.scene, i.mesh!.holdPose);
      // Imported animations (Mixamo FBX, GLB…) retargeted onto this model's bones.
      const extra: THREE.AnimationClip[] = [];
      const bones = boneNames(m.scene);
      if (bones.length && i.mesh?.animSources?.length) {
        const myHips = hipHeight(m.scene);
        for (const src of i.mesh.animSources) {
          const su = assetUrl(this.projectId, src); if (!su) continue;
          try {
            const a = await loadModel(su, { center: false, ground: false, scale: 1 });
            const theirHips = hipHeight(a.scene);
            for (const c of a.animations) {
              const r = retargetClip(c, bones, myHips > 0 && theirHips > 0 ? myHips / theirHips : 1);
              if (r.report.matched) extra.push(r.clip);
              if (r.report.skipped.length) this.onLoadError?.(`"${c.name}" from ${src.split('/').pop()}: ${r.report.skipped.length} bone(s) have no match on this model (${r.report.skipped.slice(0, 4).join(', ')}${r.report.skipped.length > 4 ? '…' : ''}); the rest plays.`);
            }
          } catch (err: any) { this.onLoadError?.(`Could not read animations from "${src}": ${err?.message ?? err}`); }
        }
        if (this.entries.get(i.uid) !== e) return;
      }
      const all = [...m.animations, ...extra];
      if (all.length) { e.mixer = new THREE.AnimationMixer(m.scene); e.clips = withDerivedClips(all, m.scene); }
      e.pivots = undefined;
      this.applyScenePatches();
    } catch (err: any) {
      const msg = `Could not load model "${id}": ${err?.message ?? err}`;
      const ph = g.getObjectByName('placeholder') as THREE.Mesh | undefined;
      if (ph) (ph.material as THREE.MeshBasicMaterial).color.set(0xe5484d);
      this.onLoadError?.(msg);
    }
  }

  private ensure(i: InstanceData): Entry {
    let e = this.entries.get(i.uid);
    const sig = this.sigOf(i);
    if (e && e.sig !== sig) { this.removeEntry(i.uid); e = undefined; }
    if (!e) { e = this.build(i); this.entries.set(i.uid, e); this.root.add(e.obj); this.builds++; }
    if (e.water) e.water.inst = i;
    return e;
  }

  private removeEntry(uid: number) {
    const e = this.entries.get(uid);
    if (!e) return;
    e.obj.removeFromParent();
    e.colliderHelper?.removeFromParent(); // its outline goes with it
    e.mixer?.stopAllAction();
    e.materials.forEach((m) => m.dispose());
    if (e.displaced) (e.visual as THREE.Mesh).geometry?.dispose();
    if (e.water) { e.water.geo?.dispose(); e.water.light?.removeFromParent(); e.water.light?.target.removeFromParent(); e.water.light?.dispose(); }
    this.entries.delete(uid);
    this.selBoxes.get(uid)?.removeFromParent();
    this.selBoxes.delete(uid);
  }

  /** Apply transform and appearance from instance data (editor) or runtime instance (play). */
  private apply(e: Entry, i: InstanceData & Partial<RInstance>, playing: boolean) {
    e.obj.position.set(i.x, i.y, i.z);
    e.obj.rotation.set((i.rx * Math.PI) / 180, (i.ry * Math.PI) / 180, (i.rz * Math.PI) / 180);
    const flip = i.kind === 'sprite' && i.sprite?.flipX ? -1 : 1;
    e.obj.scale.set(i.sx * flip, i.sy, i.sz);
    e.obj.visible = i.visible && !(i.editor?.hiddenInEditor && !playing) && !(i.kind === 'text' && i.text?.hud);
    e.visual.userData.visRange = i.visRange; e.visual.userData.noCull = i.noCull;
    // Collision View ghosts everything so the colliders show (lights, cameras and text keep their look).
    const ghost = this.collisionView && i.kind !== 'light' && i.kind !== 'camera' && i.kind !== 'text';
    const op = Math.max(0, Math.min(1, i.opacity / 100)) * (ghost ? 0.15 : 1);
    for (const m of e.materials) {
      const mm = m as THREE.MeshStandardMaterial;
      mm.userData.baseDepthWrite ??= mm.depthWrite;
      const dw = ghost ? false : mm.userData.baseDepthWrite;
      if (mm.depthWrite !== dw) mm.depthWrite = dw;
      if (i.kind !== 'mesh' && i.kind !== 'sprite' && i.kind !== 'tilemap' && mm.color) mm.color.set(i.color);
      if (i.kind === 'mesh' && i.mesh?.tint && mm.color && e.tint !== i.color) mm.color.set(i.color);
      const baseOp = mm.userData.baseOpacity ?? 1;
      const transparent = !!mm.userData.baseTransparent || op < 1 || i.kind === 'sprite';
      if (mm.transparent !== transparent) { mm.transparent = transparent; mm.needsUpdate = true; }
      mm.opacity = baseOp * op;
      // The Material panel (base colour, emission, roughness) belongs to primitives. Imported models keep their own
      // materials: applying the default block here turned every model's emission black at play time.
      if (mm.emissive && i.material && i.kind !== 'mesh') {
        mm.emissive.set(i.material.emissive); mm.emissiveIntensity = i.material.emissiveStrength; mm.roughness = i.material.roughness; mm.metalness = i.material.metalness;
        const sm = mm as THREE.MeshStandardMaterial;
        if (sm.normalMap && !isWaterSurface(i)) { const k = i.material.normalStrength ?? 1; sm.normalScale.set(k, k); }
        // Water's ripples: read every frame, as they were only picked up when the water was built (sliders did nothing).
        if (sm.normalMap && e.water) {
          const k = i.material.rippleStrength ?? 0.6; sm.normalScale.set(k, k);
          if (sm.userData.waves !== undefined) { sm.userData.waves = i.material.rippleSpeed ?? 1; const r = i.material.rippleScale ?? 4; sm.normalMap.repeat.set(r, r); }
        }
        sm.bumpScale = i.material.heightAmount ?? 1; sm.aoMapIntensity = i.material.aoStrength ?? 1;
        // Displacement: the Height map also moves the (subdivided) surface; mid-grey stays where it was. The
        // shadow pass copies these from the material, so shadows follow the displaced shape.
        const dm = e.displaced ? sm.bumpMap : null;
        if (sm.displacementMap !== dm) { sm.displacementMap = dm; sm.needsUpdate = true; }
        if (dm) { const a = i.material.displaceAmount ?? 0.1; sm.displacementScale = a; sm.displacementBias = -a / 2; }
      }
    }
    if (i.kind === 'mesh') e.tint = i.color;
    if (i.kind === 'voxel' && i.voxel) {
      // Play: the runtime's live grid (dug/built); editor: a grid generated from the settings.
      const live = (i as RInstance).state?.voxelGrid as VoxelGrid | undefined;
      const grid = live ?? (e.voxelGrid && e.voxelSig === JSON.stringify(i.voxel) ? e.voxelGrid : (e.voxelGrid = generateVoxels(i.voxel, [i.x, i.y, i.z])));
      e.voxelSig = JSON.stringify(i.voxel);
      const key = (live ? 'live' : 'edit') + grid.version + '|' + i.x + ',' + i.y + ',' + i.z;
      if (e.voxelKey !== key) {
        e.voxelKey = key;
        const m = e.visual as THREE.Mesh;
        m.geometry.dispose();
        m.geometry = buildVoxelGeometry(grid, [i.x, i.y, i.z], i.voxel.colors);
      }
      e.obj.rotation.set(0, 0, 0); e.obj.scale.set(1, 1, 1); // the grid ignores rotation/scale (cell size sets it)
    }
    if (e.pivots || (playing && (i as RInstance).state?.parts)) this.swingParts(e, playing ? (i as RInstance).state?.parts : undefined);
    if (e.tilemap) {
      // 2D: the map is the picture plane. 3D: it lies flat on the ground (map up = -Z), just above the surface.
      e.tilemapInst = i; e.obj.scale.set(1, 1, 1);
      if (this.mode2d) e.obj.rotation.set(0, 0, 0);
      else { e.obj.rotation.set(-Math.PI / 2, 0, 0); e.obj.position.y += 0.01; }
    }
    if (i.kind === 'light' && i.light) {
      updateLight(e.visual, i.light);
      // 2D lighting: lights hover over the picture plane so flat sprites catch them (higher for a longer reach).
      if (this.lit2d && i.light.type !== 'sun') e.obj.position.z = i.z + Math.max(0.6, (i.light.cutoff > 0 ? i.light.cutoff : 6) * 0.35);
    }
    if (e.camera && i.camera) {
      updateCamera(e.camera, i.camera, this.width / this.height);
      const [ox, oy, oz] = playing && this.runtime ? this.runtime.camera.offset : [0, 0, 0];
      e.camera.position.set(i.x + ox, i.y + oy, i.z + oz);
      const la = (i as RInstance).state?.lookAt as [number, number, number] | undefined;
      // Following a walker on a planet or wall: the view rolls with its up (Follow sets camUp).
      const cu = (i as RInstance).state?.camUp as number[] | undefined;
      if (cu) e.camera.up.set(cu[0], cu[1], cu[2]); else if (e.camera.up.y !== 1) e.camera.up.set(0, 1, 0);
      if (la) e.camera.lookAt(la[0] + ox, la[1] + oy, la[2] + oz);
      else e.camera.rotation.set((i.rx * Math.PI) / 180, (i.ry * Math.PI) / 180, (i.rz * Math.PI) / 180, 'YXZ');
      e.camera.updateMatrixWorld();
      if (la) { e.obj.quaternion.copy(e.camera.quaternion); }
    }
    if (i.kind === 'text' && i.text && !i.text.hud && e.visual.userData.text !== i.text.text + JSON.stringify(i.text.style ?? '')) this.paintTextSprite(e.visual as THREE.Sprite, i);
    // Parenting
    if (i.parent != null && i.parentBone) this.boneKids.set(i.uid, i); else this.boneKids.delete(i.uid);
    const parent = i.parent != null ? this.socketOf(i.parent, i.parentBone)?.group ?? this.entries.get(i.parent)?.obj : this.root;
    if (parent && e.obj.parent !== parent) parent.add(e.obj);
    // Animation
    // Characters with an animation map stand in their idle clip when nothing else is playing (never a T-pose).
    // Health: models with a "death" / "hit" role play it when the object dies / takes damage (once, then hold).
    const hp = (i as RInstance).state?.health, roles = i.mesh?.animMap;
    const healthAnim = hp?.dead && roles?.death ? 'death' : hp?.hitT > 0 && roles?.hit ? 'hit' : undefined;
    const anim = healthAnim ?? (i as any).animation ?? (i.sprite?.animation || undefined) ?? (i.mesh?.animMap?.idle ? 'idle' : undefined);
    // Keyed by the mapped clip too, so "Set animation role" switches clip while the state stays (walk → carrying walk).
    const animKey = anim && `${anim}|${roles?.[anim] ?? ''}`;
    if (e.mixer && e.clips && animKey !== e.animName) {
      e.animName = animKey;
      const clip = resolveClip(e.clips, anim, i.mesh?.animMap);
      const prev = e.action;
      if (clip) {
        const a = e.mixer.clipAction(clip);
        const loop = !healthAnim && ((i as any).animLoop !== false || anim === 'walk' || anim === 'idle');
        a.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity); a.clampWhenFinished = !loop;
        // Two behavior names can map to one clip (idle and walk → "Walk"): keep that action playing instead of
        // fading it in and out at once, which left it at weight 0 (a frozen model).
        if (a === prev) { if (!loop) a.reset(); a.play(); }
        else { a.reset().fadeIn(0.15).play(); prev?.fadeOut(0.15); }
        e.action = a;
      } else prev?.fadeOut(0.15);
    }
    // "Set animation speed" (per object; 1 = normal).
    if (e.action) { const sp = Number((i as RInstance).state?.animSpeed ?? 1); if (e.action.timeScale !== sp) e.action.timeScale = sp; }
    // Procedural Animation (play only): an animator on the loaded model (or a primitive's mesh, which can still go
    // ragdoll); rebuilt when the rig or bone mapping changes, back to the imported pose when play stops.
    const pb = playing ? (i as RInstance).behaviors?.find((b) => b.type === 'procanim' && b.props.enabled !== false) : undefined;
    const procKey = pb ? `${pb.props.rig}|${pb.props.boneMap ?? ''}` : '';
    if (e.proc && (!pb || e.procKey !== procKey)) { e.proc.reset(); e.proc = undefined; }
    const procRoot = e.model ?? (i.kind !== 'mesh' ? e.visual : undefined);
    if (pb && procRoot && !e.proc) {
      e.obj.updateMatrixWorld(true);
      e.proc = new ProcAnimator(procRoot, pb.props.rig ?? 'auto', parseBoneMap(pb.props.boneMap));
      e.procKey = procKey;
    }
    e.rinst = pb ? (i as RInstance) : undefined;
    if (e.spriteState && i.sprite) {
      this.updateSprite(e, i, anim);
      // 3D: shadows on / off (Sprite › Cast / Receive shadows).
      const sm3 = e.visual as THREE.Mesh;
      sm3.castShadow = !this.mode2d && !!i.sprite.castShadow;
      sm3.receiveShadow = !this.mode2d && !!i.sprite.receiveShadow;
      // 2D lighting: normal strength / convention and shine (glossy highlights show the relief even on dark pictures).
      const sm = e.materials[0] as THREE.MeshStandardMaterial;
      if (sm.isMeshStandardMaterial) {
        const k = i.sprite.normalStrength ?? 1;
        sm.normalScale.set(k, i.sprite.normalFormat === 'directx' ? -k : k);
        sm.roughness = 1 - 0.8 * Math.max(0, Math.min(1, i.sprite.shine ?? 0));
      }
    }
    if (this.showColliders || this.collisionView || i.editor?.showCollider) this.colliderHelper(e, i);
    else if (e.colliderHelper) { e.colliderHelper.removeFromParent(); e.colliderHelper = undefined; }
  }

  /** Turn swung parts to their current angle (editor: back as modelled). */
  private swingParts(e: Entry, parts: Record<string, PartSwing> | undefined) {
    const pv = (e.pivots ??= new Map());
    if (!parts) { for (const p of pv.values()) p?.pivot.quaternion.identity(); return; }
    for (const [name, s] of Object.entries(parts)) {
      if (!pv.has(name)) { const made = this.hingePart(e, name, s.hinge); if (made === undefined) continue; pv.set(name, made); }
      const p = pv.get(name); if (!p) continue;
      p.pivot.quaternion.setFromAxisAngle(p.axis, (partAngle(s, this.runtime?.time ?? 0) * Math.PI) / 180);
    }
  }
  /** Re-hang a named model part on a pivot at the chosen edge of its bounds. undefined = model not loaded yet; null = no such part. */
  private hingePart(e: Entry, name: string, hinge: string): { pivot: THREE.Group; axis: THREE.Vector3 } | null | undefined {
    if (e.visual.getObjectByName('placeholder')) return undefined;
    const node = e.visual.getObjectByName(name);
    if (!node) return null;
    e.obj.updateMatrixWorld(true);
    const inv = e.obj.matrixWorld.clone().invert(), box = new THREE.Box3();
    node.traverse((o) => {
      const m = o as THREE.Mesh; if (!m.isMesh) return;
      if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
      box.union(m.geometry.boundingBox!.clone().applyMatrix4(inv.clone().multiply(m.matrixWorld)));
    });
    if (box.isEmpty()) return null;
    const c = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
    const at = c.clone(); const axis = new THREE.Vector3(0, 1, 0);
    switch (hinge) {
      case 'back edge': at.x = box.min.x; break;
      case 'right edge': at.z = box.max.z; break;
      case 'left edge': at.z = box.min.z; break;
      case 'top edge': case 'bottom edge':
        at.y = hinge === 'top edge' ? box.max.y : box.min.y;
        // Horizontal hinge along the part's long side; positive angles swing it outward (away from the object's centre).
        if (size.x >= size.z) { axis.set(1, 0, 0); if ((c.z >= 0) === (hinge === 'top edge')) axis.negate(); }
        else { axis.set(0, 0, 1); if ((c.x < 0) === (hinge === 'top edge')) axis.negate(); }
        break;
      default: at.x = box.max.x;
    }
    const pivot = new THREE.Group(); pivot.name = 'hinge:' + name; pivot.position.copy(at);
    e.obj.add(pivot); pivot.updateMatrixWorld(true);
    pivot.attach(node);
    return { pivot, axis };
  }

  private updateSprite(e: Entry, i: InstanceData, anim?: string) {
    const st = e.spriteState!;
    const sheet = st.sheet;
    const anims = sheet?.animations ?? i.sprite?.animations ?? {};
    // Procedural sheets fall back to their first animation; imported sheets to the default animation or all frames.
    const { name, anim: a } = sheet && !(anim && anims[anim]) && Object.keys(anims).length
      ? { name: Object.keys(anims)[0], anim: anims[Object.keys(anims)[0]] }
      : pickSpriteAnim({ ...i.sprite!, frames: st.frames }, anim, anims);
    if (st.anim !== name) { st.anim = name; st.t = 0; }
    const map = (e.materials[0] as THREE.MeshBasicMaterial).map;
    if (!map) return;
    const c = frameCell({ frames: st.frames, rows: sheet ? 1 : i.sprite?.rows }, animFrame(a, st.t));
    map.offset.set(c.col / c.cols, 1 - (c.row + 1) / c.rows);
    (e.materials[0] as THREE.MeshStandardMaterial).normalMap?.offset.copy(map.offset);
  }

  /** Wireframe of the boxes the physics really uses (round shapes as their slices, generated model colliders). */
  private colliderHelper(e: Entry, i: InstanceData) {
    if (i.collider.shape === 'none' || i.kind === 'voxel') { e.colliderHelper?.removeFromParent(); e.colliderHelper = undefined; return; }
    const world = this.runtime?.world ?? this.editWorld();
    if (!world) return;
    const inst = world.byUid.get(i.uid);
    if (!inst) return;
    const color = collisionColor(collisionKind(i) ?? 'other');
    const fill = this.collisionView;
    const wp = inst.parent != null ? world.worldPos(inst) : [inst.x, inst.y, inst.z];
    const key = [color, fill, ...wp, inst.rx, inst.ry, inst.rz, inst.sx, inst.sy, inst.sz, inst.kind, JSON.stringify(inst.collider)].map((n) => (typeof n === 'number' ? n.toFixed(3) : String(n))).join('|');
    if (e.colliderHelper?.userData.key === key) return;
    // The collider's own shape (spheres round, ramps sloped, tilted objects rotated), not physics' box slices.
    const shape = colliderOutline(world, inst);
    if (!shape) { e.colliderHelper?.removeFromParent(); e.colliderHelper = undefined; return; }
    const pts = shape.lines, tris = fill ? shape.tris : [];
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    if (!e.colliderHelper) {
      e.colliderHelper = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color }));
      this.colliderGroup.add(e.colliderHelper);
    } else { e.colliderHelper.geometry.dispose(); e.colliderHelper.geometry = g; (e.colliderHelper.material as THREE.LineBasicMaterial).color.setHex(color); }
    for (const c of [...e.colliderHelper.children]) { c.removeFromParent(); (c as THREE.Mesh).geometry.dispose(); ((c as THREE.Mesh).material as THREE.Material).dispose(); }
    if (tris.length) {
      const fg = new THREE.BufferGeometry(); fg.setAttribute('position', new THREE.Float32BufferAttribute(tris, 3));
      const m = new THREE.Mesh(fg, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.32, depthWrite: false, side: THREE.DoubleSide }));
      m.renderOrder = 5;
      e.colliderHelper.add(m);
    }
    e.colliderHelper.userData.key = key;
  }
  private editWorldCache: { data: SceneData; world: World } | null = null;
  /** Collision geometry of the scene being edited (rebuilt when the scene data changes). */
  private editWorld(): World | null {
    if (!this.data) return null;
    if (this.editWorldCache?.data !== this.data) this.editWorldCache = { data: this.data, world: new World(this.data) };
    return this.editWorldCache.world;
  }

  // ------------------------------------------------------------ sync
  runtime: Runtime | null = null;

  /** Editor: reflect SceneData. */
  syncData(scene: SceneData, projectId: string, assets: AssetRef[]) {
    const changedScene = this.data?.id !== scene.id;
    this.lit2d = this.mode2d && scene.settings.lighting2d?.enabled ? scene.settings.lighting2d : null;
    this.data = scene; this.projectId = projectId; this.assets = assets;
    if (changedScene) for (const u of [...this.entries.keys()]) this.removeEntry(u);
    const seen = new Set<number>();
    // Parents first so children can attach.
    const ordered = [...scene.instances].sort((a, b) => (a.parent == null ? 0 : 1) - (b.parent == null ? 0 : 1));
    for (const i of ordered) { seen.add(i.uid); this.ensure(i); }
    for (const i of ordered) this.apply(this.entries.get(i.uid)!, i, false);
    for (const u of [...this.entries.keys()]) if (!seen.has(u)) this.removeEntry(u);
    this.syncEnvironment(scene, this.activeCameraData(scene.instances)?.camera?.postfx);
    this.syncEditorEmitters(scene);
    this.syncEditorRopes(scene);
    this.applyScenePatches();
    if (scene.instances.some((i) => i.reflectionProbe)) { const rev = bakeSignature(scene); if (rev !== this.sceneRev) { this.sceneRev = rev; this.lastSceneChange = performance.now(); } }
  }

  /** Play: reflect live runtime instances. */
  syncRuntime(rt: Runtime) {
    this.runtime = rt;
    const seen = new Set<number>();
    const list = rt.world.instances;
    for (const i of list) { if (i.destroyed) continue; seen.add(i.uid); this.ensure(i); }
    for (const i of list) { const e = this.entries.get(i.uid); if (e && !i.destroyed) this.apply(e, i, true); }
    this.updateWebcam();
    this.syncRuntimeRopes(rt);
    // Pre-fracture one not-yet-prepared Breakable per frame (so the moment it breaks there is no hitch).
    for (const i of list) {
      const b = !i.destroyed && i.behaviors.find((x) => x.type === 'breakable');
      const e = b && this.entries.get(i.uid);
      if (!b || !e) continue;
      const how = { pieces: Math.max(2, Math.min(1000, Math.round(Number(b.props.pieces) || 120))), quality: String(b.props.quality ?? 'high') as 'high' | 'medium' | 'low', inside: String(b.props.inside ?? ''), outsideTexture: String(b.props.outsideTexture ?? ''), insideTexture: String(b.props.insideTexture ?? '') };
      const key = shatterKey(e.sig, how);
      if (this.prepared.has(key)) continue;
      if (this.debris.prepare(e.visual, key, how)) this.prepared.add(key);
      break;
    }
    // Broken Breakables: cut the object's own visual into pieces before it is removed.
    for (const ev of rt.shatters.splice(0)) {
      const e = this.entries.get(ev.uid);
      if (e) { try { this.debris.shatter(e.visual, ev, shatterKey(e.sig, ev), rt.world, this.mode2d); } catch (err: any) { this.onLoadError?.(`Could not shatter object: ${err?.message ?? err}`); } }
    }
    for (const u of [...this.entries.keys()]) if (!seen.has(u)) this.removeEntry(u);
    // Particles from the runtime.
    const live = new Set<string>();
    for (const [id, em] of rt.emitters) {
      live.add(id);
      let pv = this.particleViews.get(id);
      if (!pv || pv.emitter !== em) { pv?.points.removeFromParent(); pv?.dispose(); pv = new ParticleView(em); this.particleViews.set(id, pv); this.scene.add(pv.points); }
    }
    for (const [id, pv] of this.particleViews) if (!live.has(id)) { pv.points.removeFromParent(); pv.dispose(); this.particleViews.delete(id); }
    const cam = rt.activeCamera();
    this.syncEnvironment(rt.scene, cam?.camera?.postfx);
    this.applyScenePatches();
  }

  /** In the editor, emitter objects preview their effect live (toggle per scene via the particle editor). */
  previewParticles = true;
  private syncEditorEmitters(scene: SceneData) {
    const want = new Set<number>();
    if (this.previewParticles) for (const i of scene.instances) if (i.kind === 'emitter' && i.emitter && i.visible) {
      want.add(i.uid);
      let em = this.previewEmitters.get(i.uid);
      const params = { ...(PARTICLE_PRESETS[i.emitter.preset]?.params ?? {}), ...(this.customPresets[i.emitter.preset] ?? {}), ...i.emitter.params };
      const key = JSON.stringify(params);
      if (!em || (em as any).__key !== key) {
        em = new Emitter('preview:' + i.uid, params, i.emitter.preset);
        (em as any).__key = key;
        if (!em.params.looping) (em as any).__restartEvery = Math.max(1, em.params.duration + em.params.lifetime + 0.5);
        this.previewEmitters.set(i.uid, em);
      }
      em.position = [i.x, i.y, i.z];
      em.heading = scene.plane === 'xz' ? i.ry : i.rz;
      em.plane = scene.plane;
    }
    for (const u of [...this.previewEmitters.keys()]) if (!want.has(u)) { this.previewEmitters.delete(u); const pv = this.particleViews.get('preview:' + u); pv?.points.removeFromParent(); pv?.dispose(); this.particleViews.delete('preview:' + u); }
  }
  customPresets: Record<string, any> = {};

  private stepEditorEmitters(dt: number) {
    for (const [uid, em] of this.previewEmitters) {
      em.update(dt);
      const r = (em as any).__restartEvery;
      if (r && em.elapsed > r) em.restart();
      const id = 'preview:' + uid;
      let pv = this.particleViews.get(id);
      if (!pv || pv.emitter !== em) { pv?.points.removeFromParent(); pv = new ParticleView(em); this.particleViews.set(id, pv); this.scene.add(pv.points); }
    }
  }

  /** Play-time culling and LOD (set by the player from the project's render settings; null = off). */
  renderSettings: RenderSettings | null = null;
  culler = new Culler();
  /** HUD text that takes the camera's Post-FX (drawn in the scene); fontFamily maps imported fonts (set by the play session). */
  private screenText?: ScreenTextLayer;
  fontFamily?: (id: string) => string | undefined;

  clearRuntime() {
    this.runtime = null;
    this.culler.reset([]);
    this.debris.clear();
    this.ropeViewsCache?.clear();
    for (const [id, pv] of this.particleViews) if (!id.startsWith('preview:')) { pv.points.removeFromParent(); pv.dispose(); this.particleViews.delete(id); }
    for (const u of [...this.entries.keys()]) this.removeEntry(u);
    this.data = null;
  }

  activeCameraData(list: InstanceData[]) {
    const cams = list.filter((i) => i.kind === 'camera' && !(i as any).destroyed);
    return cams.find((c) => c.camera?.active) ?? cams[0];
  }

  /**
   * Environment image (World › Environment): an HDRI (.hdr) or panorama picture lights reflections and ambient
   * (prefiltered with PMREM), and can also be the background (with blur).
   */
  private envMapKey = '';
  private envMapTex: { pmrem: THREE.Texture; equirect: THREE.Texture } | null = null;
  private syncEnvMap(w: NonNullable<SceneData['settings']['world']>) {
    const id = w.envMap ?? '';
    const url = id ? assetUrl(this.projectId, id) : null;
    if (url !== this.envMapKey) {
      this.envMapKey = url ?? '';
      if (this.envMapTex) { this.envMapTex.pmrem.dispose(); this.envMapTex.equirect.dispose(); this.envMapTex = null; }
      if (url) {
        const done = (t: THREE.Texture) => {
          if (this.envMapKey !== url) { t.dispose(); return; }
          t.mapping = THREE.EquirectangularReflectionMapping;
          const pm = new THREE.PMREMGenerator(this.renderer);
          this.envMapTex = { pmrem: pm.fromEquirectangular(t).texture, equirect: t };
          pm.dispose();
          this.syncEnvMap(w);
        };
        if (/\.hdr$/i.test(id)) new RGBELoader().load(url, done, undefined, (e) => this.onLoadError?.(`Environment image: ${e}`));
        else new THREE.TextureLoader().load(url, (t) => { t.colorSpace = THREE.SRGBColorSpace; done(t); }, undefined, () => this.onLoadError?.(`Environment image "${id}" could not be loaded`));
      }
    }
    const e = this.envMapTex;
    this.scene.environment = e?.pmrem ?? null;
    (this.scene as any).environmentIntensity = w.envStrength ?? 1;
    if (e && w.envBackground && !this.mode2d) { this.scene.background = e.equirect; this.scene.backgroundBlurriness = w.envBlur ?? 0; }
    else this.scene.backgroundBlurriness = 0;
  }

  private envKey = '';
  private syncEnvironment(scene: SceneData, postfx: PostFxEffect[] | undefined) {
    const w = scene.settings.world ?? { color: '#5c6370', strength: 0.6 };
    this.scene.background = new THREE.Color(scene.settings.background);
    this.hemi.color.set(w.color); this.hemi.groundColor.set(new THREE.Color(w.color).multiplyScalar(0.35));
    this.hemi.intensity = w.strength * Math.PI * 0.6;
    if (this.lit2d) {
      // 2D lighting: the ambient light is all there is besides the Light objects, and the backdrop is in the dark too.
      const amb = new THREE.Color(this.lit2d.ambient);
      this.hemi.color.copy(amb); this.hemi.groundColor.copy(amb);
      this.hemi.intensity = this.lit2d.ambientStrength * Math.PI;
      (this.scene.background as THREE.Color).multiply(amb.clone().multiplyScalar(Math.min(1, this.lit2d.ambientStrength * 1.5)));
    }
    // Sky dome and day/night: positioned and lit every frame in render() (it follows the camera).
    this.skySettings = scene.settings.sky?.enabled && !this.mode2d ? scene.settings.sky : null;
    this.ambientBase = w.strength;
    this.emissionScale = scene.settings.emissionScale ?? 1;
    if (this.skySettings) this.scene.background = null;
    this.syncEnvMap(w);
    const vt = w.viewTransform ?? 'agx';
    this.renderer.toneMapping = vt === 'standard' ? THREE.NoToneMapping : vt === 'filmic' ? THREE.ACESFilmicToneMapping : vt === 'neutral' ? THREE.NeutralToneMapping : THREE.AgXToneMapping;
    this.renderer.toneMappingExposure = Math.pow(2, w.exposure ?? 0);
    const rendered = this.shading === 'rendered';
    const li = !this.mode2d ? scene.settings.lighting : undefined;
    this.postfx.setSsr(li?.ssr ?? 0, li?.ssrDistance ?? 30, li?.ssrThickness ?? 0.5);
    this.syncGi(li);
    this.postfx.update(postfx, rendered);
    const fx = this.postfx.sceneEffects;
    const fogFx = fx.fog;
    if (fogFx) this.scene.fog = new THREE.FogExp2(String(fogFx.params.color), Number(fogFx.params.density));
    else if (w.fogEnabled && rendered) this.scene.fog = new THREE.FogExp2(w.fogColor ?? '#9aa4b2', w.fogDensity ?? 0.01);
    else this.scene.fog = null;
    // Camera under water: thick blue-green fog.
    if (this.runtime?.ui.underwater) this.scene.fog = new THREE.FogExp2('#14506e', 0.09);
    const ps1 = fx.ps1;
    ps1Uniforms.uSnap.value = ps1 && ps1.params.vertexSnap ? 1 : 0;
    ps1Uniforms.uAffine.value = ps1 && ps1.params.affine ? 1 : 0;
    const res = Number(ps1?.params.snapResolution ?? 160);
    ps1Uniforms.uSnapRes.value.set(res * (this.width / this.height), res);
    this.celSteps = fx.celshade ? Number(fx.celshade.params.steps ?? 3) : 0;
    this.jitter = Number(ps1?.params.jitter ?? 0);
    this.envKey = String(this.celSteps) + (ps1 ? 'p' : '');
  }
  private celSteps = 0;
  private jitter = 0;
  private patchedKey = '';
  private skySettings: import('@shared/src/runtime/sky').SkySettings | null = null;
  private skyRig: SkyRig | null = null;
  private ambientBase = 0.6;
  private emissionScale = 1;
  private emissionKey = '';
  private frameNo = 0;

  /** Sky dome / sun / stars for the time of day, and fog that takes the horizon colour. */
  private updateSky(cam: THREE.Camera) {
    const s = this.skySettings;
    if (!s || this.shading !== 'rendered' && !this.runtime) {
      if (this.skyRig) { this.skyRig.group.removeFromParent(); }
      return;
    }
    if (!this.skyRig) this.skyRig = new SkyRig();
    if (!this.skyRig.group.parent) this.scene.add(this.skyRig.group);
    // The sky's own sun replaces the scene's sun lights (otherwise night would still be lit by them).
    for (const e of this.entries.values()) if (e.visual.name === 'light') e.visual.traverse((o) => { if ((o as THREE.DirectionalLight).isDirectionalLight) o.visible = false; });
    const st = this.skyRig.update(s, cam, this.hemi, this.ambientBase, (id) => { const url = assetUrl(this.projectId, id); return url ? loadTexture(url) : null; });
    if (this.scene.fog && !this.runtime?.ui.underwater) (this.scene.fog as THREE.FogExp2).color.setRGB(...st.horizonColor);
  }

  /** Scale every emissive material (lights-out events); re-applied as new objects appear. */
  private applyEmission() {
    const key = this.emissionScale + ':' + this.entries.size;
    if (this.emissionScale === 1 && this.emissionKey === '' ) return;
    if (key === this.emissionKey && this.frameNo % 30) return;
    this.emissionKey = this.emissionScale === 1 ? '' : key;
    // Objects tagged "glow" (glow sticks, Smiler faces) keep glowing when the lights go out.
    const keepsGlow = (uid: number | undefined) => uid != null && !!(this.runtime?.world.byUid.get(uid) ?? this.data?.instances.find((x) => x.uid === uid))?.tags?.includes('glow');
    this.root.traverse((o) => {
      const m = o as THREE.Mesh; if (!m.isMesh) return;
      const scale = keepsGlow(o.userData.uid) ? 1 : this.emissionScale;
      for (const mt of Array.isArray(m.material) ? m.material : [m.material]) {
        const sm = mt as THREE.MeshStandardMaterial;
        if (sm.emissiveIntensity === undefined) continue;
        sm.userData.baseEmissive ??= sm.emissiveIntensity;
        sm.emissiveIntensity = sm.userData.baseEmissive * scale;
      }
    });
  }

  /** Materials changes required by scene-level effects (PS1 shader patch, cel shading). */
  /**
   * Load, upload and compile the models of objects that will be spawned later (templates), a few per frame, so
   * creating them mid-game (new rooms, enemies, items) does not stall on parsing, texture upload or shader
   * compilation. Safe to call repeatedly: models and programs are cached.
   */
  async warmUp(assetIds: string[], camera?: THREE.Camera) {
    const ids = [...new Set(assetIds.filter(Boolean))];
    const holder = new THREE.Group();
    holder.position.set(0, -1e5, 0);
    for (const id of ids) {
      const url = assetUrl(this.projectId, id); if (!url) continue;
      const ref = this.assets.find((a) => a.id === id);
      const mtl = ref?.extra?.find((x) => x.toLowerCase().endsWith('.mtl'));
      try {
        const m = await loadModel(url, ref?.importSettings ?? {}, mtl ? assetUrl(this.projectId, mtl) ?? undefined : undefined);
        m.scene.traverse((o) => {
          const mm = o as THREE.Mesh; if (!mm.isMesh) return;
          for (const mt of Array.isArray(mm.material) ? mm.material : [mm.material]) {
            patchPs1(mt);
            for (const k of ['map', 'normalMap', 'emissiveMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'alphaMap']) { const t = (mt as any)[k] as THREE.Texture | null; if (t?.image) this.renderer.initTexture(t); }
          }
        });
        // One model at a time: compile its shaders against the scene's lights, then let it go.
        holder.add(m.scene);
        const r = this.renderer as any;
        this.scene.add(holder);
        try { if (r.compileAsync) await r.compileAsync(holder, camera ?? this.currentCamera(), this.scene); } catch { /* best effort */ }
        holder.removeFromParent(); holder.clear();
      } catch { /* reported when it is actually used */ }
      // Spread the work out so the game keeps running smoothly while it happens.
      await new Promise((r) => setTimeout(r, 30));
    }
  }

  private builds = 0;
  private applyScenePatches() {
    // (Counting builds too: an object rebuilt after an edit has new materials, at the same totals.)
    const key = this.envKey + ':' + this.builds + ':' + this.entries.size + ':' + [...this.entries.values()].reduce((a, e) => a + e.materials.length, 0);
    if (key === this.patchedKey) return;
    this.patchedKey = key;
    const grad = this.celSteps ? (() => { const n = this.celSteps; const d = new Uint8Array(n); for (let k = 0; k < n; k++) d[k] = Math.round((k / (n - 1)) * 255); const t = new THREE.DataTexture(d, n, 1, THREE.RedFormat); t.minFilter = t.magFilter = THREE.NearestFilter; t.needsUpdate = true; return t; })() : null;
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || o.userData.editorOnly) return;
      const swap = (mat: THREE.Material): THREE.Material => {
        const orig = (mat.userData.orig as THREE.Material) ?? mat;
        if (grad && (orig as any).isMeshStandardMaterial) {
          let t = this.toon.get(orig);
          if (!t) { const s = orig as THREE.MeshStandardMaterial; t = new THREE.MeshToonMaterial({ color: s.color, map: s.map, transparent: s.transparent, opacity: s.opacity }); t.userData.orig = orig; this.toon.set(orig, t); }
          (t as THREE.MeshToonMaterial).gradientMap = grad;
          (t as THREE.MeshToonMaterial).color.copy((orig as THREE.MeshStandardMaterial).color);
          patchPs1(t);
          return t;
        }
        patchPs1(orig);
        if (!this.mode2d) patchGi(orig);
        if (this.texKey) for (const k of TEXTURE_SLOTS) { const t = (orig as any)[k] as THREE.Texture | null | undefined; if (t?.isTexture) limitTexture(t); }
        if (orig.userData.ps1Tex !== !!ps1Uniforms.uAffine.value && (orig as any).map) {
          const tex = (orig as any).map as THREE.Texture;
          // Pixel-art textures (Nearest for shrinking too, as loadTexture(url, true) makes them) stay crisp whatever
          // the retro setting: switching them to Linear here blurred small sprites such as those sent from SpriteCraft.
          const near = !!ps1Uniforms.uSnap.value || !!ps1Uniforms.uAffine.value || tex.minFilter === THREE.NearestFilter;
          const want = near ? THREE.NearestFilter : THREE.LinearFilter;
          // Only re-upload when the filter really changes: textures are shared by many materials, and re-uploading
          // big ones for every spawned room caused hitches when new areas loaded.
          if (tex.magFilter !== want) { tex.magFilter = want; tex.needsUpdate = true; }
          orig.userData.ps1Tex = !!ps1Uniforms.uAffine.value;
        }
        return orig;
      };
      m.material = Array.isArray(m.material) ? m.material.map(swap) : swap(m.material);
    });
  }

  // ------------------------------------------------------------ selection & picking
  setSelection(uids: number[]) {
    for (const [u, h] of this.selBoxes) if (!uids.includes(u)) { h.removeFromParent(); this.selBoxes.delete(u); }
    for (const u of uids) {
      const e = this.entries.get(u);
      if (!e) continue;
      let h = this.selBoxes.get(u);
      if (!h) { h = new THREE.BoxHelper(e.obj, u === uids[uids.length - 1] ? 0xffa500 : 0xff6a00); h.userData.editorOnly = true; this.helpers.add(h); this.selBoxes.set(u, h); }
      h.setFromObject(e.obj);
    }
  }

  /** Pieces of shattered Breakables (visual only). */
  private debrisSys?: DebrisSystem;
  private get debris() {
    if (!this.debrisSys) { this.debrisSys = new DebrisSystem(this.scene); this.debrisSys.textureOf = (id) => { const url = id ? assetUrl(this.projectId, id) : null; return url ? loadTexture(url) : null; }; }
    return this.debrisSys;
  }
  private prepared = new Set<string>();

  // ------------------------------------------------------------ per-object effects
  private objectFxPass = new ObjectFxPass(this.scene ?? new THREE.Scene(), () => this.currentCamera());
  private fxLayers = new Map<number, number>();
  /** Objects with enabled effects go on their own render layer (1-31) and are listed for the object-FX pass. */
  private updateObjectFx(on: boolean) {
    if ((this.objectFxPass as any).scene !== this.scene) (this.objectFxPass as any).scene = this.scene;
    this.postfx.objectFx = this.objectFxPass;
    const items: FxItem[] = [];
    const data = this.runtime ? null : new Map((this.data?.instances ?? []).map((i) => [i.uid, i]));
    let next = 1;
    for (const [uid, e] of this.entries) {
      const inst = this.runtime ? this.runtime.world.byUid.get(uid) : data!.get(uid);
      const fx = on ? activeFx(inst?.fx) : [];
      const layer = fx.length ? next : 0;
      if (fx.length) { items.push({ layer, fx }); next = next >= 31 ? 1 : next + 1; }
      if (layer || this.fxLayers.get(uid)) {
        e.visual.traverse((o) => { if (o.layers.mask !== 1 << layer) o.layers.set(layer); });
        if (layer) this.fxLayers.set(uid, layer); else this.fxLayers.delete(uid);
      }
    }
    this.objectFxPass.items = items;
    this.postfx.setObjectFx(items.length > 0);
  }

  private pathOverlay: THREE.Group | null = null;
  /** Editor overlay for an NPC route: a line through the points and a handle on each (first green, `hot` orange). */
  setPathOverlay(points: [number, number, number][] | null, loop: boolean, hot = -1) {
    if (this.pathOverlay) {
      this.pathOverlay.removeFromParent();
      this.pathOverlay.traverse((o) => { const m = o as THREE.Mesh; m.geometry?.dispose(); (m.material as any)?.map?.dispose?.(); (m.material as THREE.Material | undefined)?.dispose?.(); });
      this.pathOverlay = null;
    }
    if (!points?.length) return;
    const g = new THREE.Group(); g.userData.editorOnly = true; g.renderOrder = 998;
    const pts = points.map((p) => new THREE.Vector3(p[0], p[1], p[2]));
    if (loop && pts.length > 2) pts.push(pts[0].clone());
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0x35d0ff, depthTest: false, transparent: true }));
    line.renderOrder = 998; g.add(line);
    // Handles keep the same on-screen size at any zoom (round dots, 12 px).
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(points.flat(), 3));
    const col = new THREE.Color();
    geo.setAttribute('color', new THREE.Float32BufferAttribute(points.flatMap((_, i) => col.set(i === hot ? 0xffa21a : i === 0 ? 0x3fd17a : 0x35d0ff).toArray()), 3));
    const dot = document.createElement('canvas'); dot.width = dot.height = 32;
    const c2 = dot.getContext('2d')!; c2.fillStyle = '#fff'; c2.beginPath(); c2.arc(16, 16, 13, 0, Math.PI * 2); c2.fill(); c2.strokeStyle = '#000'; c2.lineWidth = 3; c2.stroke();
    const handles = new THREE.Points(geo, new THREE.PointsMaterial({ size: 12, sizeAttenuation: false, vertexColors: true, map: new THREE.CanvasTexture(dot), alphaTest: 0.5, depthTest: false, transparent: true }));
    handles.renderOrder = 999; g.add(handles);
    this.helpers.add(g);
    this.pathOverlay = g;
  }

  pick(clientX: number, clientY: number): number | null {
    const r = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.layers.enable(BATCHED_LAYER); // a mesh a batch draws for it is still there to click
    ray.setFromCamera(ndc, this.currentCamera());
    const hits = ray.intersectObjects(this.root.children, true);
    for (const h of hits) {
      let o: THREE.Object3D | null = h.object;
      while (o && o.userData.uid == null) o = o.parent;
      if (!o) continue;
      // The ray also meets hidden things (a level's invisible collider boxes over its tiles): only what is seen counts.
      let seen = true;
      for (let a: THREE.Object3D | null = h.object; a && seen; a = a.parent) seen = a.visible;
      if (seen) return o.userData.uid;
    }
    return null;
  }

  /** World point under the cursor on the ground plane (y = height) in 3D, or z = 0 in 2D. */
  /** Screen position (px from the view's top-left) of a world point, or null when it is behind the camera. */
  /**
   * The point on screen just above an object's top (for speech bubbles over heads): its drawn bounds' top centre, or
   * null when it isn't drawn or is behind the camera.
   */
  private headBox = new THREE.Box3();
  headOnScreen(uid: number): { x: number; y: number } | null {
    const e = this.entries.get(uid); if (!e || !e.obj.visible) return null;
    e.obj.updateMatrixWorld(true);
    // (Only what is drawn: hidden parts, helpers and empty holders would put the head too high.)
    this.headBox.makeEmpty();
    const visit = (o: THREE.Object3D) => {
      if (!o.visible) return;
      const g = (o as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
      if ((o as THREE.Mesh).isMesh && g && !(o as any).isHelper) {
        if (!g.boundingBox) g.computeBoundingBox();
        if (g.boundingBox) this.headBox.union(new THREE.Box3().copy(g.boundingBox).applyMatrix4(o.matrixWorld));
      }
      for (const c of o.children) visit(c);
    };
    visit(e.obj);
    if (this.headBox.isEmpty()) return this.worldToScreen(e.obj.position.x, e.obj.position.y + 1, e.obj.position.z);
    const c = this.headBox.getCenter(new THREE.Vector3());
    const p = this.worldToScreen(c.x, this.headBox.max.y + 0.15, c.z);
    // (Off the screen: none, so the line is shown in a box instead of a bubble pinned to the edge.)
    return p && p.x >= 0 && p.x <= this.width && p.y >= 0 && p.y <= this.height ? p : null;
  }

  worldToScreen(x: number, y: number, z: number): { x: number; y: number } | null {
    const cam = this.currentCamera();
    const v = new THREE.Vector3(x, y, z).project(cam);
    if (v.z > 1 || v.z < -1) return null;
    return { x: ((v.x + 1) / 2) * this.width, y: ((1 - v.y) / 2) * this.height };
  }

  groundPoint(clientX: number, clientY: number, height = 0): THREE.Vector3 | null {
    const r = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    const ray = new THREE.Raycaster(); ray.setFromCamera(ndc, this.currentCamera());
    const plane = this.mode2d ? new THREE.Plane(new THREE.Vector3(0, 0, 1), 0) : new THREE.Plane(new THREE.Vector3(0, 1, 0), -height);
    return ray.ray.intersectPlane(plane, new THREE.Vector3());
  }

  /** VR (WebXR) host, created on first use; while presenting, frames render from its rig camera. */
  private xrHost: XrHost | null = null;
  get xr(): XrHost { return (this.xrHost ??= new XrHost(this.renderer, this.scene)); }

  currentCamera(): THREE.Camera {
    if (this.xrHost?.presenting) return this.xrHost.camera;
    if (this.runtime || this.useSceneCamera) {
      const list = this.runtime ? this.runtime.world.instances : this.data?.instances ?? [];
      const picked = !this.runtime && this.viewCameraUid != null ? (list as InstanceData[]).find((i) => i.uid === this.viewCameraUid && i.kind === 'camera') : undefined;
      const cd = picked ?? this.activeCameraData(list as InstanceData[]);
      const e = cd ? this.entries.get(cd.uid) : undefined;
      if (e?.camera) return e.camera;
    }
    return this.viewCamera;
  }

  /** Redraw changed tilemaps; the selected one, while painting, shows its collision, layer and the cell under the mouse. */
  private updateTilemaps() {
    const tt = tileTools.get();
    const sel = [...this.selBoxes.keys()].pop();
    for (const e of this.entries.values()) {
      const i = e.tilemapInst; if (!e.tilemap || !i?.tilemap) continue;
      const editing = !this.runtime && sel === i.uid;
      const painting = editing && tt.active;
      e.tilemap.update(i, i.tilemap.tileset ? assetUrl(this.projectId, i.tilemap.tileset) : null, { showCollision: editing && tt.showCollision, highlightLayer: painting ? tt.layer : undefined, preview: painting ? previewCells() : null });
    }
  }

  /** Decals (bullet holes, blood, paint) from the runtime, as small pictures lying on the surfaces they hit. Meshes are reused. */
  private decalMeshes = new Map<number, THREE.Mesh>();
  private decalPool: THREE.Mesh[] = [];
  private decalGeo = new THREE.PlaneGeometry(1, 1);
  private updateDecals() {
    const rt = this.runtime, live = new Set<number>();
    for (const d of rt?.decals ?? []) {
      const age = rt!.time - d.born, on = rt!.world.byUid.get(d.uid), life = d.life ?? 30;
      if ((life > 0 && age > life) || !on || on.destroyed) continue;
      live.add(d.id);
      let m = this.decalMeshes.get(d.id);
      if (!m) {
        m = this.decalPool.pop();
        if (!m) {
          m = new THREE.Mesh(this.decalGeo, new THREE.MeshStandardMaterial({ transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, roughness: 0.9, alphaTest: 0.02 }));
          m.renderOrder = 2;
          this.root.add(m);
        }
        const mat = m.material as THREE.MeshStandardMaterial;
        const url = d.image && d.image !== BLOOD_IMAGE ? assetUrl(this.projectId, d.image) : null;
        mat.map = d.image === BLOOD_IMAGE ? bloodTexture(d.id) : url ? loadTexture(url, false) : paintBlob(); // no picture: paint, a soft round splat in the mark's colour
        mat.color.set(d.color ?? '#ffffff');
        m.visible = true;
        m.scale.setScalar(d.size);
        this.decalMeshes.set(d.id, m);
      }
      const [x, y, z] = rt!.world.worldPos(on), n = new THREE.Vector3(...d.normal);
      m.position.set(x + d.offset[0], y + d.offset[1], z + d.offset[2]).addScaledVector(n, 0.004 + (d.id % 50) * 0.00004); // overlapping paint doesn't flicker
      if (this.mode2d) {
        // 2D (seen from the side): the mark faces the camera, a flat smear along a floor or ceiling.
        m.position.set(x + d.offset[0], y + d.offset[1], z + d.offset[2] + 0.02);
        m.rotation.set(0, 0, 0);
        m.scale.set(d.size, d.size * (Math.abs(n.y) > 0.7 ? 0.3 : 1), 1);
      } else { m.lookAt(m.position.clone().add(n)); m.rotateZ(d.id * 2.39996); } // each mark turned differently
      (m.material as THREE.MeshStandardMaterial).opacity = (d.alpha ?? 1) * (life > 0 ? Math.min(1, (life - age) / 2) : 1);
    }
    for (const [id, m] of this.decalMeshes) if (!live.has(id)) { m.visible = false; this.decalPool.push(m); this.decalMeshes.delete(id); }
  }

  /** Grid Board objects: the grid lines (also while editing), and while playing the selected and reachable cells. */
  private gridViews = new Map<number, { lines: THREE.LineSegments; cells: THREE.InstancedMesh; sig: string }>();
  private updateGrids() {
    const list = (this.runtime ? this.runtime.world.instances : this.data?.instances ?? []) as (InstanceData & { state?: any; destroyed?: boolean })[];
    const live = new Set<number>(), m4 = new THREE.Matrix4(), col = new THREE.Color();
    for (const i of list) {
      const bh = !i.destroyed ? i.behaviors.find((b) => b.type === 'gridboard') : undefined;
      if (!bh) continue;
      live.add(i.uid);
      const p = bh.props as unknown as GridProps & Record<string, any>;
      let v = this.gridViews.get(i.uid);
      const sig = JSON.stringify([p.cols, p.rows, p.cellSize, p.orientation, p.rotation, i.x, i.y, i.z]);
      if (!v || v.sig !== sig) {
        if (v) { v.lines.removeFromParent(); v.lines.geometry.dispose(); v.cells.removeFromParent(); v.cells.dispose(); }
        // Grid lines between the cell corners (a cell's corner: its centre less half a cell, both ways).
        const up = p.orientation === 'upright', pts: number[] = [], lift = up ? [0, 0, 0.02] : [0, 0.02, 0];
        const corner = (c: number, r: number) => { const q = cellCentre(i, p, c - 0.5, r - 0.5); return [q[0] + lift[0], q[1] + lift[1], q[2] + lift[2]]; };
        for (let c = 0; c <= p.cols; c++) pts.push(...corner(c, 0), ...corner(c, p.rows));
        for (let r = 0; r <= p.rows; r++) pts.push(...corner(0, r), ...corner(p.cols, r));
        const geo = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
        const lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ transparent: true, opacity: 0.4 }));
        lines.frustumCulled = false; lines.renderOrder = 3;
        const quad = new THREE.PlaneGeometry(1, 1); if (!up) quad.rotateX(-Math.PI / 2);
        const cells = new THREE.InstancedMesh(quad, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.45, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, toneMapped: false }), p.cols * p.rows + 1);
        cells.frustumCulled = false; cells.renderOrder = 3; cells.count = 0;
        this.root.add(lines, cells);
        v = { lines, cells, sig }; this.gridViews.set(i.uid, v);
      }
      v.lines.visible = p.showLines !== false;
      (v.lines.material as THREE.LineBasicMaterial).color.set(String(p.lineColor ?? '#ffffff'));
      const g = i.state?.grid as GridState | undefined;
      let n = 0;
      if (g && this.runtime) {
        const put = (c: number, r: number, color: string, shrink = 0.92) => {
          if (n >= v!.cells.instanceMatrix.count) return;
          const q = cellCentre(i, p, c, r), s = p.cellSize * shrink, a = ((p.rotation || 0) * Math.PI) / 180;
          m4.makeRotationFromEuler(new THREE.Euler(0, p.orientation === 'upright' ? 0 : -a, p.orientation === 'upright' ? a : 0)).scale(new THREE.Vector3(s, s, s));
          m4.setPosition(q[0], q[1] + (p.orientation === 'upright' ? 0 : 0.015), q[2] + (p.orientation === 'upright' ? 0.015 : 0));
          v!.cells.setMatrixAt(n, m4); v!.cells.setColorAt(n, col.set(color)); n++;
        };
        for (const [c, r] of g.reachable) put(c, r, String(p.reachColor ?? '#3fd07a'));
        const sel = g.selected != null ? this.runtime.world.byUid.get(g.selected)?.state.gridPiece : undefined;
        if (sel) put(sel.c, sel.r, String(p.selectColor ?? '#ffc640'));
        if (g.rejected && this.runtime.time - g.rejected.at < 0.35) put(g.rejected.cell[0], g.rejected.cell[1], '#ff3b3b');
      }
      v.cells.count = n;
      v.cells.instanceMatrix.needsUpdate = true;
      if (v.cells.instanceColor) v.cells.instanceColor.needsUpdate = true;
    }
    for (const [uid, v] of this.gridViews) if (!live.has(uid)) { v.lines.removeFromParent(); v.lines.geometry.dispose(); v.cells.removeFromParent(); v.cells.dispose(); this.gridViews.delete(uid); }
  }

  /** Lock-on: the circle on each locked target, from the runtime's state (lockon.ts); it follows the target. */
  private lockMarkers = new Map<number, THREE.Mesh>();
  private updateLockMarkers() {
    const rt = this.runtime, live = new Set<number>();
    for (const i of rt?.world.instances ?? []) {
      const st = i.state.lockon as LockOnState | undefined, t = st?.target != null ? rt!.world.byUid.get(st.target) : undefined;
      if (!st?.marker.on || !t || t.destroyed || i.destroyed) continue;
      live.add(i.uid);
      let m = this.lockMarkers.get(i.uid);
      if (!m) {
        m = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.5, 48), new THREE.MeshBasicMaterial({ transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
        m.renderOrder = 6; m.frustumCulled = false;
        this.scene.add(m); this.lockMarkers.set(i.uid, m);
      }
      const b = rt!.world.aabb(t), wide = Math.max(b[3] - b[0], this.mode2d ? b[4] - b[1] : b[5] - b[2], 0.3), now = rt!.time;
      const pulse = st.marker.anim === 'pulse' ? 1 + Math.sin(now * 6) * 0.08 : 1;
      // Flat around the feet (3D); around the middle, facing the camera (2D).
      if (this.mode2d) { m.position.set((b[0] + b[3]) / 2 + st.marker.offset[0], (b[1] + b[4]) / 2 + st.marker.offset[1], 0.5 + st.marker.offset[2]); m.rotation.set(0, 0, 0); }
      else { m.position.set((b[0] + b[3]) / 2 + st.marker.offset[0], b[1] + st.marker.offset[1], (b[2] + b[5]) / 2 + st.marker.offset[2]); m.rotation.set(-Math.PI / 2, 0, 0); }
      if (st.marker.anim === 'spin') m.rotateZ(now * 3);
      m.scale.setScalar(wide * 2.4 * st.marker.size * pulse);
      (m.material as THREE.MeshBasicMaterial).color.set(st.marker.color);
    }
    for (const [uid, m] of this.lockMarkers) if (!live.has(uid)) { m.removeFromParent(); m.geometry.dispose(); (m.material as THREE.Material).dispose(); this.lockMarkers.delete(uid); }
  }

  /** Procedural Animation: pose each animated model from its object's movement (after any clip has played). */
  private updateProcAnim(dt: number) {
    const rt = this.runtime!, w = rt.world;
    const step = rt.timeScale > 0 ? dt * rt.timeScale : 0;
    for (const e of this.entries.values()) {
      const inst = e.rinst;
      if (!e.proc || !inst || inst.destroyed) continue;
      const b = w.behavior(inst, 'procanim');
      if (!b) continue;
      const st = inst.state.procanim ?? {};
      const blockers = w.blockersFor(inst).filter((s) => s !== inst);
      const look = st.lookAt != null ? w.byUid.get(st.lookAt) : undefined;
      e.obj.updateMatrixWorld(true);
      // Animation speed: the procedural motion's own clock runs faster or slower.
      const k = Math.max(0, Number(b.props.animSpeed ?? 1));
      e.procTime = (e.procTime ?? rt.time) + step * k;
      e.proc.update({
        dt: step * k, time: e.procTime, props: b.props,
        velocity: new THREE.Vector3(inst.vx, inst.vy, inst.vz),
        ragdoll: st.ragdoll ?? null, climb: st.climb ?? null,
        lookAt: look && !look.destroyed ? new THREE.Vector3(...w.worldPos(look)) : null,
        reach: (() => { const r = st.reachAt != null ? w.byUid.get(st.reachAt) : undefined; return r && !r.destroyed ? new THREE.Vector3(...w.worldPos(r)) : null; })(),
        ground: (from, dir, max) => {
          const h = raycast(w, [from.x, from.y, from.z], [dir.x, dir.y, dir.z], max, blockers, inst);
          return h ? { point: new THREE.Vector3(...h.point), normal: new THREE.Vector3(...h.normal) } : null;
        },
      });
    }
  }

  /** The pose each model had last frame (a removed or changed pose puts those bones back at rest once). */
  private lastPose = new Map<number, Record<string, BoneEdit>>();
  /** Models with Bone Edit poses this frame. */
  private posedModels(): [Entry, Record<string, BoneEdit>][] {
    const list = (this.runtime ? this.runtime.world.instances : this.data?.instances ?? []) as InstanceData[];
    const out: [Entry, Record<string, BoneEdit>][] = [];
    for (const i of list) {
      const e = this.entries.get(i.uid), pose = i.mesh?.bonePose;
      if (!e?.model) continue;
      const before = this.lastPose.get(i.uid);
      if (before && before !== pose) resetBonePose(e.model, before); // bones dropped from the edit go back to rest
      if (pose && Object.keys(pose).length) { this.lastPose.set(i.uid, pose); out.push([e, pose]); }
      else this.lastPose.delete(i.uid);
    }
    return out;
  }

  // ------------------------------------------------------------ global illumination and reflections (lighting.ts)
  private giVolume: ProbeVolume | null = null;
  private giBakeShown: GiBake | null = null;
  private giLive: { values: Float32Array; valid: Uint8Array; next: number; capture: ProbeCapture; uploadAt: number; nextAt: number } | null = null;
  private giSettings: LightingSettings | undefined;
  private giDebugMesh: THREE.InstancedMesh | null = null;
  /** Debug: 'indirect' shows only the indirect light; 'probes' draws the probes. */
  giDebug: 'none' | 'indirect' | 'probes' = 'none';
  /** A bake is running (the panel shows its progress). */
  giBaking = false;

  /** Which GI is really on now, for the panel: never says baked when no bake is being shown. */
  giStatus(): { mode: GiMode; probes: number } {
    const dims = this.giVolume?.dims;
    return { mode: giUniforms.uGiStrength.value > 0 ? (this.giLive ? 'realtime' : 'baked') : 'off', probes: dims ? dims[0] * dims[1] * dims[2] : 0 };
  }

  private syncGi(li: LightingSettings | undefined) {
    this.giSettings = li;
    if (this.giBaking) return;
    const mode = li?.gi ?? 'off', strength = li?.giStrength ?? 1;
    if (mode === 'baked' && li?.giBake) {
      if (this.giBakeShown !== li.giBake) { this.stopGiLive(); this.giVolume?.dispose(); this.giVolume = ProbeVolume.fromBake(li.giBake); this.giBakeShown = li.giBake; }
      this.giVolume!.use(strength);
    } else if (mode === 'realtime') {
      if (!this.giLive) this.startGiLive(li?.giQuality ?? 'medium');
      this.giVolume?.use(strength);
    } else {
      this.stopGiLive();
      giUniforms.uGiStrength.value = 0;
    }
    giUniforms.uGiView.value = this.giDebug === 'indirect' ? 1 : 0;
    this.updateGiDebug();
  }
  private stopGiLive() {
    if (!this.giLive) return;
    this.giLive.capture.dispose(); this.giLive = null;
    this.giVolume?.dispose(); this.giVolume = null; this.giBakeShown = null;
  }

  /** The box the probes cover: the scene's static things and a little air above them. */
  private giBounds(): { min: number[]; max: number[] } {
    const box = new THREE.Box3(), part = new THREE.Box3();
    for (const e of this.entries.values()) {
      const name = e.visual.name;
      if (e.camera || name === 'light' || !e.visual.visible) continue;
      part.setFromObject(e.visual);
      if (!part.isEmpty() && part.getSize(new THREE.Vector3()).length() < 1000) box.union(part);
    }
    if (box.isEmpty()) box.set(new THREE.Vector3(-5, 0, -5), new THREE.Vector3(5, 3, 5));
    const skyLimit = Math.min(box.max.y + 2, box.min.y + 30);
    return { min: [box.min.x, box.min.y + 0.05, box.min.z], max: [box.max.x, Math.max(skyLimit, box.min.y + 1), box.max.z] };
  }

  /** The solid objects' boxes: a probe inside one is not used. */
  private giSolidBoxes(list: InstanceData[]) {
    const out: THREE.Box3[] = [];
    for (const i of list) {
      const e = this.entries.get(i.uid);
      if (e && i.behaviors.some((b) => b.type === 'solid')) { const b = new THREE.Box3().setFromObject(e.visual); if (!b.isEmpty()) out.push(b); }
    }
    return out;
  }

  /** Set the scene up to be looked at by probes; returns how to put it back. */
  private giCaptureSetup(staticOnly: boolean, list: InstanceData[]) {
    const hidden: THREE.Object3D[] = [];
    const hide = (o: THREE.Object3D | null | undefined) => { if (o?.visible) { o.visible = false; hidden.push(o); } };
    hide(this.helpers); hide(this.colliderGroup); hide(this.skyRig?.group); hide(this.giDebugMesh);
    for (const m of this.lockMarkers.values()) hide(m);
    for (const pv of this.particleViews.values()) hide(pv.points);
    for (const v of this.gridViews.values()) { hide(v.lines); hide(v.cells); }
    for (const i of list) {
      const e = this.entries.get(i.uid);
      if (e && (i.kind === 'sprite' || i.kind === 'text' || (staticOnly && isMoving(i)))) hide(e.obj);
    }
    const bg = this.scene.background, fog = this.scene.fog, over = this.scene.overrideMaterial, auto = this.renderer.shadowMap.autoUpdate, target = this.renderer.getRenderTarget();
    this.scene.background = new THREE.Color(0); this.scene.fog = null; this.scene.overrideMaterial = null;
    this.renderer.shadowMap.autoUpdate = false;
    return () => {
      hidden.forEach((o) => { o.visible = true; });
      this.scene.background = bg; this.scene.fog = fog; this.scene.overrideMaterial = over;
      this.renderer.shadowMap.autoUpdate = auto;
      this.renderer.setRenderTarget(target);
    };
  }

  /**
   * Bake the probe volume over a number of frames (the editor stays alive). Moving objects are left out. Each bounce
   * looks at the scene lit by the bounce before.
   */
  async bakeGi(sceneData: SceneData, onProgress: (share: number) => void): Promise<GiBake> {
    const li = sceneData.settings.lighting;
    this.giBaking = true;
    this.stopGiLive();
    giUniforms.uGiStrength.value = 0; giUniforms.uGiView.value = 0;
    const capture = new ProbeCapture(this.renderer, this.scene);
    try {
      this.renderer.shadowMap.needsUpdate = true;
      this.render(); // lights and shadows ready
      const { min, max } = this.giBounds();
      const plan = planVolume(min, max, li?.giQuality ?? 'medium');
      const [w, h, d] = plan.dims, count = w * h * d, bounces = Math.max(1, Math.min(3, li?.giBounces ?? 2));
      const values = new Float32Array(count * 18), valid = new Uint8Array(count);
      const solids = this.giSolidBoxes(sceneData.instances);
      const volume = new ProbeVolume(plan.min, plan.size, plan.dims);
      const p = new THREE.Vector3();
      for (let bounce = 0; bounce < bounces; bounce++) {
        let done = 0;
        while (done < count) {
          const restore = this.giCaptureSetup(true, sceneData.instances), until = performance.now() + 14;
          while (done < count && performance.now() < until) {
            const x = done % w, y = Math.floor(done / w) % h, z = Math.floor(done / (w * h));
            p.set(plan.min[0] + (plan.size[0] * x) / (w - 1), plan.min[1] + (plan.size[1] * y) / (h - 1), plan.min[2] + (plan.size[2] * z) / (d - 1));
            const inside = solids.some((b) => b.containsPoint(p));
            valid[done] = inside ? 0 : 1;
            if (!inside) capture.capture(p, values, done * 18);
            done++;
          }
          restore();
          onProgress((bounce + done / count) / bounces);
          await new Promise((r) => setTimeout(r, 0));
        }
        fillInvalidProbes(values, valid, plan.dims);
        volume.write(values);
        volume.use(1); // the next bounce sees this one
      }
      this.giVolume?.dispose();
      this.giVolume = volume; this.giBakeShown = null;
      this.giDebugValues = { values, plan };
      const bake: GiBake = { ...plan, data: encodeProbes(values), sig: bakeSignature(sceneData), bounces, bakedAt: new Date().toISOString() };
      this.giBakeShown = bake;
      volume.use(li?.giStrength ?? 1);
      return bake;
    } finally {
      capture.dispose();
      this.giBaking = false;
    }
  }

  private startGiLive(quality: GiQuality) {
    const { min, max } = this.giBounds();
    const plan = planVolume(min, max, quality, true);
    this.giVolume?.dispose(); this.giBakeShown = null;
    this.giVolume = new ProbeVolume(plan.min, plan.size, plan.dims);
    const n = plan.dims[0] * plan.dims[1] * plan.dims[2];
    this.giLive = { values: new Float32Array(n * 18), valid: new Uint8Array(n).fill(1), next: 0, capture: new ProbeCapture(this.renderer, this.scene), uploadAt: 0, nextAt: 0 };
  }

  /** Real-time GI: a few probes each frame, within a small time budget; the picture updates a few times a second. */
  private stepGiLive(list: InstanceData[]) {
    const live = this.giLive, vol = this.giVolume;
    if (!live || !vol || this.giBaking) return;
    // At most about a tenth of the time goes on probes: on a slow GPU they just refresh less often.
    const start = performance.now();
    if (start < live.nextAt) { vol.use(this.giSettings?.giStrength ?? 1); return; }
    const [w, h, d] = vol.dims, count = w * h * d, p = new THREE.Vector3();
    const restore = this.giCaptureSetup(false, list);
    const k = live.next, x = k % w, y = Math.floor(k / w) % h, z = Math.floor(k / (w * h));
    p.set(vol.min[0] + (vol.size[0] * x) / (w - 1), vol.min[1] + (vol.size[1] * y) / (h - 1), vol.min[2] + (vol.size[2] * z) / (d - 1));
    live.capture.capture(p, live.values, k * 18);
    live.next = (k + 1) % count;
    restore();
    const now = performance.now();
    live.nextAt = now + (now - start) * 9;
    if (now > live.uploadAt) { live.uploadAt = now + 250; vol.write(live.values); this.giDebugValues = { values: live.values, plan: { min: vol.min as any, size: vol.size as any, dims: vol.dims } }; }
    vol.use(this.giSettings?.giStrength ?? 1);
  }

  private giDebugValues: { values: Float32Array; plan: { min: number[]; size: number[]; dims: [number, number, number] } } | null = null;
  private giDebugFor: unknown = null;
  private updateGiDebug() {
    const want = this.giDebug === 'probes' ? (this.giBakeShown ?? this.giDebugValues) : null;
    if (want === this.giDebugFor && (!want || this.giDebugMesh)) return;
    this.giDebugFor = want;
    if (this.giDebugMesh) { this.giDebugMesh.removeFromParent(); this.giDebugMesh.geometry.dispose(); (this.giDebugMesh.material as THREE.Material).dispose(); this.giDebugMesh.dispose(); this.giDebugMesh = null; }
    if (!want) return;
    const bake = (want as GiBake).data ? (want as GiBake) : null;
    const values = bake ? decodeProbes(bake.data) : (want as NonNullable<typeof this.giDebugValues>).values;
    const plan = bake ?? (want as NonNullable<typeof this.giDebugValues>).plan;
    this.giDebugMesh = probeDebugMesh(values, plan.min, plan.size, plan.dims);
    this.helpers.add(this.giDebugMesh);
  }
  setGiDebug(mode: 'none' | 'indirect' | 'probes') { this.giDebug = mode; giUniforms.uGiView.value = mode === 'indirect' ? 1 : 0; this.updateGiDebug(); }

  // ---- reflection probes and mirrors
  private reflectProbes = new Map<number, { probe: ReflectionProbe; res: number; sig: string; at: THREE.Vector3; radius: number; strength: number; next: number; every: number }>();
  private reflectDirtyAt = 0;
  private reflectAssignAt = 0;
  /** Capture every reflection probe again (the panel's button; it also happens a moment after the scene changes). */
  recaptureReflections() { this.reflectDirtyAt = performance.now(); for (const p of this.reflectProbes.values()) p.sig = ''; }
  get reflectionProbeCount() { return this.reflectProbes.size; }

  private updateReflections(list: InstanceData[], now: number) {
    const live = new Set<number>();
    let any = false;
    for (const i of list) {
      const rp = i.reflectionProbe;
      if (!rp || (i as RInstance).destroyed) continue;
      live.add(i.uid); any = true;
      let p = this.reflectProbes.get(i.uid);
      const at = this.entries.get(i.uid)?.obj.getWorldPosition(new THREE.Vector3()) ?? new THREE.Vector3(i.x, i.y, i.z);
      // Editing: captured again when the scene settles after a change.
      let loaded = 0;
      for (const e of this.entries.values()) if (e.model) loaded++;
      const sig = `${loaded}|${this.runtime ? 'play' : `${at.toArray()}|${this.sceneRev}`}`;
      if (!p || p.res !== rp.resolution) { p?.probe.dispose(); p = { probe: new ReflectionProbe(this.renderer, rp.resolution), res: rp.resolution, sig: '', at, radius: rp.radius, strength: rp.strength, next: 0, every: rp.every }; this.reflectProbes.set(i.uid, p); }
      p.at.copy(at); p.radius = rp.radius; p.strength = rp.strength; p.every = rp.every;
      const stale = p.sig !== sig && now - this.lastSceneChange > 400;
      const due = !!this.runtime && p.every > 0 && now >= p.next;
      if (stale || due) { this.captureReflection(p, list); p.sig = sig; p.next = now + p.every * 1000; this.reflectAssignAt = 0; }
    }
    for (const [uid, p] of this.reflectProbes) if (!live.has(uid)) { p.probe.dispose(); this.reflectProbes.delete(uid); this.reflectAssignAt = 0; any = true; }
    if (!any && !this.reflectUsed) return;
    if (now < this.reflectAssignAt) return;
    this.reflectAssignAt = now + 250;
    this.reflectUsed = this.reflectProbes.size > 0;
    // Each object uses the two nearest probes whose reach it is in, blended by how deep inside each it is; outside them
    // all, the environment image.
    const c = new THREE.Vector3();
    const inReach: { res: number; probe: ReflectionProbe; strength: number; weight: number }[] = [];
    for (const e of this.entries.values()) {
      if (!e.materials.length || e.visual.name === 'light') continue;
      e.obj.getWorldPosition(c);
      inReach.length = 0;
      for (const p of this.reflectProbes.values()) { const dist = p.at.distanceTo(c); if (dist <= p.radius && p.probe.texture) inReach.push({ res: p.res, probe: p.probe, strength: p.strength, weight: 1 - dist / p.radius + 1e-3 }); }
      inReach.sort((a, b) => b.weight - a.weight);
      const best = inReach[0] ?? null;
      // (The shader reads both with one set of size constants, so they must be captured at the same resolution.)
      const next = best && inReach[1]?.res === best.res ? inReach[1] : null;
      const mix = next ? next.weight / (best!.weight + next.weight) : 0;
      for (const m of e.materials) {
        const sm = m as THREE.MeshStandardMaterial;
        if (!sm.isMeshStandardMaterial) continue;
        const tex = best?.probe.texture ?? null;
        if (sm.envMap !== tex) { if (!!sm.envMap !== !!tex) sm.needsUpdate = true; sm.envMap = tex; }
        sm.envMapIntensity = best ? best.strength * (1 - mix) + (next?.strength ?? 0) * mix : 1;
        const blend = envBlend(sm);
        blend.uEnvB.value = next?.probe.texture ?? null; blend.uEnvMix.value = mix;
      }
    }
  }
  private reflectUsed = false;
  private captureReflection(p: { probe: ReflectionProbe; at: THREE.Vector3 }, list: InstanceData[]) {
    const background = this.scene.background;
    const restore = this.giCaptureSetup(false, list);
    // The background comes back for this: a reflection shows the sky.
    this.scene.background = background;
    const sky = this.skyRig?.group; if (sky) sky.visible = !!this.skySettings;
    // What the probe sits inside (a mirror ball at the probe) would fill the whole picture.
    const hidden: THREE.Object3D[] = [], box = new THREE.Box3();
    for (const e of this.entries.values()) {
      if (e.obj.visible && e.materials.length && box.setFromObject(e.visual).containsPoint(p.at)) { e.obj.visible = false; hidden.push(e.obj); }
    }
    p.probe.capture(this.scene, p.at);
    hidden.forEach((o) => { o.visible = true; });
    if (sky) sky.visible = false;
    restore();
  }
  /** When the things reflections show last changed, and what they were. */
  private lastSceneChange = 0;
  private sceneRev = '';

  private mirrors = new Map<number, { mirror: Reflector; res: number }>();
  private updateMirrors(list: InstanceData[], lit: boolean) {
    const live = new Set<number>();
    for (const i of list) {
      const e = i.mirror && !(i as RInstance).destroyed ? this.entries.get(i.uid) : undefined;
      if (!e || !i.mirror) continue;
      live.add(i.uid);
      let v = this.mirrors.get(i.uid);
      if (!v || v.res !== i.mirror.resolution) {
        if (v) { v.mirror.removeFromParent(); v.mirror.dispose(); }
        // On the object's top: a box's is half its height up, a plane's is its surface.
        v = { mirror: makeMirror(i.mirror.resolution, i.kind === 'plane' ? 0.0105 : 0.5005), res: i.mirror.resolution };
        e.obj.add(v.mirror); this.mirrors.set(i.uid, v);
      }
      if (v.mirror.parent !== e.obj) e.obj.add(v.mirror);
      v.mirror.visible = lit;
      (v.mirror.material as THREE.ShaderMaterial).uniforms.uStrength.value = i.mirror.strength;
    }
    for (const [uid, v] of this.mirrors) if (!live.has(uid)) { v.mirror.removeFromParent(); v.mirror.dispose(); this.mirrors.delete(uid); }
  }

  /** Objects hung on bones (the model may load after them, and their logic position follows the pose). */
  private boneKids = new Map<number, InstanceData>();
  private socketOf(owner: number, bone: string | undefined): BoneSocket | null {
    const e = bone ? this.entries.get(owner) : undefined;
    return e ? socketFor(e.sockets ??= new Map(), e.obj, e.model, bone!) : null;
  }
  /** After the frame's pose: sockets to their bones, children still waiting for their model onto them. */
  private updateBoneSockets() {
    for (const [uid, i] of this.boneKids) {
      const e = this.entries.get(uid), owner = i.parent != null ? this.entries.get(i.parent) : undefined;
      if (!e) { this.boneKids.delete(uid); continue; }
      const k = owner && this.socketOf(i.parent!, i.parentBone);
      if (!owner || !k) continue;
      if (e.obj.parent !== k.group) k.group.add(e.obj);
      updateSocket(k, owner.obj);
      const st = (i as RInstance).state;
      if (st) { const p = e.obj.getWorldPosition(new THREE.Vector3()); (st.boneWorld ??= [0, 0, 0]).splice(0, 3, p.x, p.y, p.z); }
    }
  }
  /** Where a bone is posed now, in its owner's space (keeping a child in place when it is parented). */
  boneSocketMatrix(owner: number, bone: string): THREE.Matrix4 | null {
    const k = this.socketOf(owner, bone), e = this.entries.get(owner);
    return k && e ? socketMatrix(k, e.obj) : null;
  }

  // ---- Bone view: skeletons over the scene, click a joint to pick its bone.
  private boneOverlay: BoneOverlay | null = null;
  setBoneView(on: boolean) {
    if (on && !this.boneOverlay) { this.boneOverlay = new BoneOverlay(); this.helpers.add(this.boneOverlay.group); }
    if (this.boneOverlay) this.boneOverlay.group.visible = on;
    if (!on && this.boneOverlay) this.boneOverlay.picked = null;
  }
  setPickedBone(p: BonePick | null) { if (this.boneOverlay) this.boneOverlay.picked = p; }
  private updateBoneOverlay() {
    if (!this.boneOverlay?.group.visible || this.runtime) return;
    const models = new Map<number, THREE.Object3D>();
    for (const [uid, e] of this.entries) if (e.model) models.set(uid, e.model);
    this.root.updateMatrixWorld(true);
    this.boneOverlay.update(models);
  }
  /** The bone under a screen point (client px) in Bone view. */
  pickBone(cx: number, cy: number): BonePick | null {
    if (!this.boneOverlay?.group.visible) return null;
    const r = this.renderer.domElement.getBoundingClientRect();
    return this.boneOverlay.pick(cx - r.left, cy - r.top, (x, y, z) => this.worldToScreen(x, y, z));
  }
  boneList(uid: number) { return this.boneOverlay?.list(uid) ?? []; }
  get rigCount() { return this.boneOverlay?.rigCount ?? 0; }

  /** Objects whose meshes are Boolean results, and cutters drawn as wireframes in the editor. */
  private boolUids = new Set<number>();
  private wireCutters = new Set<number>();
  /** Boolean ops and holes cut while playing (booleanMesh.ts); cutters show as wireframes while editing. */
  private updateBooleans(playing: boolean) {
    const list = (this.runtime && playing ? this.runtime.world.instances : this.data?.instances ?? []) as (InstanceData & { state?: any })[];
    const cutters = new Set<number>();
    for (const i of list) {
      const cuts = i.state?.cuts as Cut[] | undefined;
      if (!i.boolean?.ops.length && !cuts?.length && !this.boolUids.has(i.uid)) continue;
      const e = this.entries.get(i.uid);
      if (!e) continue;
      try {
        if (updateBoolean(e, i, cuts, (uid) => this.entries.get(uid)?.visual)) this.boolUids.add(i.uid); else this.boolUids.delete(i.uid);
      } catch (err: any) { this.onLoadError?.(`Boolean on "${i.name}" failed: ${err?.message ?? err}`); this.boolUids.delete(i.uid); }
      if (i.boolean?.hideCutters !== false) for (const op of i.boolean?.ops ?? []) cutters.add(op.with);
    }
    // Editor: a cutter is a wireframe (the cut shows through it); play hides it (the runtime makes it invisible).
    const wire = playing ? new Set<number>() : cutters;
    for (const uid of new Set([...this.wireCutters, ...wire])) {
      const on = wire.has(uid), e = this.entries.get(uid);
      if (e) for (const m of e.materials) if ((m as THREE.MeshStandardMaterial).wireframe !== on) { (m as THREE.MeshStandardMaterial).wireframe = on; }
    }
    this.wireCutters = wire;
  }

  /** The rig Procedural Animation would read from this object's model (Bone mapping in the Inspector). */
  procRig(uid: number, rig: string, boneMap: string): RigInfo | null {
    const e = this.entries.get(uid);
    if (!e?.model) return null;
    if (e.proc) return e.proc.info;
    return analyzeRig(e.model, (rig || 'auto') as any, parseBoneMap(boneMap));
  }

  // ------------------------------------------------------------ render
  /** Frame times and where they go (Debug tab › Performance). */
  profiler: FrameProfiler | null = null;
  render() {
    (this.profiler ??= new FrameProfiler(this.renderer)).beginDraw();
    try { this.renderFrame(); } finally {
      const rt = this.runtime;
      this.profiler.endDraw(rt?.perf.events ?? 0, rt?.perf.movement ?? 0);
      if (rt) rt.perf.events = rt.perf.movement = 0;
    }
  }
  private renderFrame() {
    const dt = Math.min(0.1, this.clock.getDelta());
    const t = this.clock.elapsedTime;
    // Bone Edit: edited bones back to rest before the animation, the edit layered on after it (see bonePose.ts).
    const posed = this.posedModels();
    for (const [e, pose] of posed) resetBonePose(e.model!, pose);
    for (const e of this.entries.values()) {
      e.mixer?.update(dt); if (e.spriteState) e.spriteState.t += dt;
      const wm = e.materials[0] as THREE.MeshStandardMaterial | undefined;
      if (wm?.userData.waves && wm.normalMap) { const sp = Number(wm.userData.waves) || 1; wm.normalMap.offset.set(t * 0.02 * sp, t * 0.013 * sp); }
      if (e.animMaps?.length) animateSlots(e.animMaps, t);
    }
    if (!this.runtime) this.stepEditorEmitters(dt);
    else this.updateProcAnim(dt);
    for (const [e, pose] of posed) applyBonePose(e.model!, pose);
    this.updateBoneSockets();
    this.updateBoneOverlay();
    this.updateDecals();
    this.updateLockMarkers();
    this.updateGrids();
    {
      const litList = (this.runtime ? this.runtime.world.instances : this.data?.instances ?? []) as InstanceData[];
      const lit = this.shading === 'rendered' || !!this.runtime;
      if (!this.mode2d && lit) { this.stepGiLive(litList); this.updateReflections(litList, performance.now()); }
      this.updateMirrors(litList, lit);
    }
    this.updateTilemaps();
    this.debris.update(this.runtime && this.runtime.timeScale > 0 ? dt * this.runtime.timeScale : this.runtime ? 0 : dt, this.runtime?.gravity ?? -20);
    for (const h of this.selBoxes.values()) h.update();
    const playing = !!this.runtime;
    this.helpers.visible = !playing && !this.useSceneCamera;
    this.root.traverse((o) => { if (o.userData.editorOnly) o.visible = !playing && !this.useSceneCamera; });
    const solid = this.shading !== 'rendered' && !playing;
    this.studio.visible = solid;
    this.hemi.visible = !solid;
    for (const e of this.entries.values()) if (e.visual.name === 'light') e.visual.children.forEach((c) => { if ((c as any).isLight) c.visible = !solid; });
    this.scene.overrideMaterial = this.shading === 'wireframe' && !playing ? this.wire : null;
    this.updateBooleans(playing);
    const cam = this.currentCamera();
    // Game camera zoom (Set zoom block, touch pinch zoom): three's own camera zoom works for both projections.
    if (playing && this.runtime && cam !== this.editorCam) {
      const pc = cam as THREE.PerspectiveCamera, z = this.runtime.camera.zoom || 1;
      if (pc.zoom !== undefined && Math.abs(pc.zoom - z) > 1e-4) { pc.zoom = z; pc.updateProjectionMatrix(); }
    } else if (!playing) for (const e of this.entries.values()) {
      const c = e.camera as THREE.PerspectiveCamera | undefined; // back to 1 after play
      if (c && c.zoom !== 1) { c.zoom = 1; c.updateProjectionMatrix(); }
    }
    if (this.jitter && playing) { cam.position.x += (Math.random() - 0.5) * this.jitter * 0.02; cam.position.y += (Math.random() - 0.5) * this.jitter * 0.02; }
    const pixelScale = (cam as THREE.PerspectiveCamera).isPerspectiveCamera ? this.height / (2 * Math.tan(((cam as THREE.PerspectiveCamera).fov * Math.PI) / 360)) : this.height / (((cam as THREE.OrthographicCamera).top - (cam as THREE.OrthographicCamera).bottom) || 1) / 100;
    for (const pv of this.particleViews.values()) pv.update(pixelScale, !(cam as THREE.PerspectiveCamera).isPerspectiveCamera);
    this.postfx.setCamera(cam);
    this.frameNo++;
    if (!this.mode2d) {
      const cq = cam.getWorldQuaternion(new THREE.Quaternion()), pq = new THREE.Quaternion();
      const camP = cam.getWorldPosition(new THREE.Vector3()), objP = new THREE.Vector3(), yq = new THREE.Quaternion(), yAxis = new THREE.Vector3(0, 1, 0);
      for (const e of this.entries.values()) if (e.visual.userData.billboard) {
        e.obj.getWorldQuaternion(pq);
        if (e.visual.userData.billboardVertical) { e.obj.getWorldPosition(objP); yq.setFromAxisAngle(yAxis, Math.atan2(camP.x - objP.x, camP.z - objP.z)); e.visual.quaternion.copy(pq.invert().multiply(yq)); }
        else e.visual.quaternion.copy(pq.invert().multiply(cq));
      }
    }
    this.updateSky(cam);
    this.updateCascades(playing, cam);
    this.postfx.set3dPasses(!this.mode2d);
    this.applyEmission();
    if (playing && this.renderSettings) this.culler.update(this.entries, cam, this.runtime!.world, this.renderSettings, this.renderer);
    this.updateCullDebug(playing && !!this.renderSettings?.debug);
    this.screenText ??= new ScreenTextLayer(this.scene);
    if (playing) this.screenText.update(this.runtime!.world.instances.filter((i) => !i.destroyed), cam, this.width, this.height, this.fontFamily);
    else this.screenText.clear();
    this.updateObjectFx(this.shading === 'rendered' || playing);
    this.updateTextures(playing, cam);
    this.updateBatches(playing);
    this.renderer.info.reset();
    // Camera View with a framing guide wider than the viewport: the game would see further to the sides at the same
    // vertical field of view, so the preview widens to match (the guide then darkens top and bottom).
    const restore = !playing && this.useSceneCamera && cam !== this.viewCamera ? this.widenForGuide(cam) : null;
    this.updateClouds(cam, t, this.shading === 'rendered' || playing);
    this.updateEndless(cam, playing);
    this.prepareWater(cam, t, this.shading === 'rendered' || playing);
    // In a headset three renders both eyes itself (screen-space post effects don't apply to stereo).
    const above = playing && this.renderSettings?.debug && this.renderSettings.debugView === 'above' && !this.xrHost?.presenting ? this.debugAbove(cam) : null;
    if (above) this.renderer.render(this.scene, above);
    else if (this.xrHost?.presenting) this.renderer.render(this.scene, cam);
    else if (this.shading === 'rendered' || playing) { if (!this.postfx.render(t)) this.renderer.render(this.scene, cam); }
    else this.renderer.render(this.scene, cam);
    restore?.();
    this.scene.matrixWorldAutoUpdate = true;
    for (const e of this.entries.values()) if (e.water) { e.water.u.uHasDepth.value = 0; e.water.u.uHasScene.value = 0; } // the passes were for this view only
    if (this.gameView && !playing && !this.useSceneCamera && !this.xrHost?.presenting) this.renderGameView(this.gameView);
  }

  /** Compressed textures and streaming while playing (textureManager.ts). */
  textures!: TextureManager;
  private texTick = 0;
  private texPlaying = false;
  private updateTextures(playing: boolean, cam: THREE.Camera) {
    this.textures ??= new TextureManager(this.renderer);
    const rs = this.renderSettings;
    if (!playing || !rs) { if (this.texPlaying) { this.textures.stop(); this.texPlaying = false; } return; }
    this.texPlaying = true;
    if (this.texTick++ % 15) return; // a few times a second is plenty
    this.textures.setOptions({ compress: !!rs.textureCompression, streaming: !!rs.textureStreaming, budgetMb: Number(rs.textureBudgetMb) || 0 });
    if (!this.textures.active) return;
    const all: THREE.Material[] = [];
    for (const e of this.entries.values()) if (!e.water && !e.animMaps?.length && !e.displaced) all.push(...e.materials);
    this.textures.scan(all);
    if (rs.textureStreaming) {
      // How many pixels each object covers now; the far side of the picture need not be sharper than that.
      const c = cam as THREE.PerspectiveCamera, tanHalf = c.isPerspectiveCamera ? Math.tan((c.fov * Math.PI) / 360) : 0, H = this.height * this.renderer.getPixelRatio();
      const pos = cam.getWorldPosition(new THREE.Vector3()), s = new THREE.Sphere();
      for (const [uid, d] of this.culler.decisions()) {
        const e = this.entries.get(uid); if (!e?.materials.length || d.decision !== 'visible' || d.box.isEmpty() || !e.obj.visible) continue;
        d.box.getBoundingSphere(s);
        const dist = Math.max(0.1, s.center.distanceTo(pos) - s.radius);
        this.textures.request(e.materials, Math.min(4096, (s.radius * 2 * H) / (2 * dist * (tanHalf || 1))));
      }
    }
    this.textures.tick(performance.now());
  }

  /** The sun lighting the scene: the sky's when it has one, else the first sun object that casts shadows, else the first sun. */
  private mainSun(): THREE.DirectionalLight | null {
    if (this.skySettings && this.skyRig?.group.parent) return this.skyRig.sun;
    let first: THREE.DirectionalLight | null = null;
    for (const e of this.entries.values()) {
      if (e.visual.name !== 'light' || !e.obj.visible) continue;
      const l = e.visual.children.find((c) => (c as THREE.DirectionalLight).isDirectionalLight) as THREE.DirectionalLight | undefined;
      const s = l ?? ((e.visual as THREE.DirectionalLight).isDirectionalLight ? (e.visual as THREE.DirectionalLight) : undefined);
      if (!s) continue;
      if (s.castShadow) return s;
      first ??= s;
    }
    return first;
  }

  /** Cascaded sun shadows while playing (cascades.ts). */
  readonly cascades = new Cascades();
  private updateCascades(playing: boolean, cam: THREE.Camera) {
    const rs = this.renderSettings, n = Math.round(Number(rs?.cascades) || 0);
    const sun = playing && !this.mode2d && n >= 2 && rs?.shadows !== false && !this.xrHost?.presenting ? this.mainSun() : null;
    if (!sun) { this.cascades.stop(); return; }
    const size = Math.max(512, Number(rs?.shadowResolution) || 2048);
    this.cascades.update(this.scene, cam, sun, { count: Math.min(4, n), maxFar: Number(rs?.cascadeDistance) > 0 ? Number(rs!.cascadeDistance) : 150, size });
  }

  /** What contact shadows and volumetric fog need to know about the sun. */
  private sunInfo(): SunInfo | null {
    const sun = this.mainSun();
    if (!sun) return null;
    const direction = new THREE.Vector3();
    if (this.cascades.active) {
      const l = this.cascades.lights[this.cascades.lights.length - 1];
      direction.copy(l.position).sub(l.target.position).normalize();
      return { direction, color: l.color, intensity: l.visible ? l.intensity : 0, light: l };
    }
    if (!sun.visible) return null;
    sun.updateWorldMatrix(true, false); sun.target.updateWorldMatrix(true, false);
    direction.setFromMatrixPosition(sun.matrixWorld).sub(new THREE.Vector3().setFromMatrixPosition(sun.target.matrixWorld)).normalize();
    return { direction, color: sun.color, intensity: sun.intensity, light: sun };
  }

  /** Automatic instancing while playing (batcher.ts). Never in the editor, where selection and materials change by hand. */
  readonly batcher = new Batcher();
  private updateBatches(playing: boolean) {
    const rt = this.runtime;
    if (!playing || !rt || this.renderSettings?.instancing === false || this.collisionView || this.xrHost?.presenting) {
      this.batcher.clear();
      this.scene.matrixWorldAutoUpdate = true;
      if (this.batchSorting) { this.renderer.setTransparentSort(null as never); this.batchSorting = false; }
      return;
    }
    if (this.batcher.root.parent !== this.scene) this.scene.add(this.batcher.root);
    // Up to date for the batches; the frame's render passes then need not work it all out again (see renderFrame).
    this.scene.updateMatrixWorld();
    this.scene.matrixWorldAutoUpdate = false;
    this.batcher.update(this.entries.values() as Iterable<Batchable>, {
      mode2d: this.mode2d, frustum: this.renderSettings?.frustum !== false,
      excluded: (uid) => {
        const i = rt.world.byUid.get(uid);
        return !i || !!i.state?.parts || activeFx(i.fx).length > 0 || i.behaviors.some((b) => b.type === 'breakable') || webcam.shownOn.has(uid);
      },
    });
    if (this.batcher.active !== this.batchSorting) { this.renderer.setTransparentSort((this.batcher.active ? batchAwareSort : null) as never); this.batchSorting = this.batcher.active; }
  }
  private batchSorting = false;

  /** Where each object was last frame and when it last made a ring (for wakes). */
  private wakeTrack = new Map<string, { x: number; y: number; z: number; t: number; last: number; wet: boolean }>();
  /** Rings where objects move through a water surface: a trail of them while moving, a bigger one on entering. */
  private waterWakes(we: Entry, box: THREE.Box3, t: number) {
    const u = we.water!.u, surface = box.max.y, ob = new THREE.Box3(), p = new THREE.Vector3();
    const strength = Math.max(0, we.water!.inst.material?.water?.wakeStrength ?? WATER_FX.wakeStrength);
    const add = (x: number, z: number, h: number) => {
      const k = we.water!.nextRipple ?? 0;
      u.uRipples.value[k % MAX_RIPPLES].set(x, z, t, h);
      we.water!.nextRipple = (k + 1) % MAX_RIPPLES;
      u.uRippleN.value = Math.min(MAX_RIPPLES, Math.max(u.uRippleN.value, k + 1));
    };
    for (const e of this.entries.values()) {
      if (e === we || e.water || !e.obj.visible || e.camera || e.visual.name === 'light') continue;
      e.obj.getWorldPosition(p);
      const key = we.uid + ':' + e.uid;
      if (p.x < box.min.x - 2 || p.x > box.max.x + 2 || p.z < box.min.z - 2 || p.z > box.max.z + 2 || p.y < box.min.y - 2 || p.y > surface + 4) { this.wakeTrack.delete(key); continue; }
      ob.setFromObject(e.visual);
      if (ob.isEmpty()) continue;
      const wet = ob.min.y <= surface + 0.02 && ob.max.y >= surface - 0.05 && p.x >= box.min.x && p.x <= box.max.x && p.z >= box.min.z && p.z <= box.max.z;
      const prev = this.wakeTrack.get(key);
      const now = { x: p.x, y: p.y, z: p.z, t, last: prev?.last ?? -1e9, wet };
      this.wakeTrack.set(key, now);
      if (!prev || !wet || t <= prev.t) continue;
      const dt = t - prev.t, speed = Math.hypot(p.x - prev.x, p.z - prev.z) / dt, sink = Math.abs(p.y - prev.y) / dt;
      const size = Math.min(1.5, Math.max(0.3, Math.max(ob.max.x - ob.min.x, ob.max.z - ob.min.z) / 2));
      const scale = (0.6 + 0.4 * size) * strength;
      if (!prev.wet && sink > 1) { add(p.x, p.z, Math.min(0.2, 0.06 + sink * 0.02) * scale); now.last = t; continue; } // splash
      if ((speed > 0.25 || sink > 0.4) && t - prev.last > 0.16) {
        add(p.x, p.z, Math.min(0.12, 0.02 + speed * 0.02 + sink * 0.02) * scale);
        now.last = t;
      }
    }
  }

  private waterPass = new WaterPass();

  /** An endless world (scene.settings.endless): chunks generated round the camera, and solid ground round the player while playing. */
  endless: EndlessWorld | null = null;
  // ---- Rope / zipline: drawn from the behavior, in the editor and while playing.
  private ropeViewsCache: RopeViews | null = null;
  private get ropeViews() {
    if (!this.ropeViewsCache) { this.ropeViewsCache = new RopeViews(this.scene); this.ropeViewsCache.textureOf = (id) => { const url = id ? assetUrl(this.projectId, id) : null; return url ? loadTexture(url) : null; }; }
    return this.ropeViewsCache;
  }
  private ropeLook(props: Record<string, any>, pts: [number, number, number][], version: number | string): RopeLook {
    return { pts, version, thickness: Number(props.thickness) || 0.05, color: String(props.color || '#8a6a45'), texture: String(props.texture || ''), repeat: Number(props.textureRepeat) || 2, unlit: this.mode2d && !this.lit2d };
  }
  /** Editor: the height of whatever is under a point (the rope that reaches the ground lands on what is really there). */
  private groundBelow(x: number, y: number, z: number, self: number): number | null {
    const ray = new THREE.Raycaster(new THREE.Vector3(x, y, z), new THREE.Vector3(0, -1, 0), 0, 2000);
    let top: number | null = null;
    for (const [uid, e] of this.entries) {
      if (uid === self || !e.visual.visible) continue;
      const hit = ray.intersectObject(e.visual, true)[0];
      if (hit && (top == null || hit.point.y > top)) top = hit.point.y;
    }
    return top;
  }
  private syncEditorRopes(scene: SceneData) {
    const out = new Map<number, RopeLook>();
    for (const i of scene.instances) {
      const b = i.behaviors.find((x) => x.type === 'rope'); const e = b && this.entries.get(i.uid);
      if (!b || !e) continue;
      const a = e.obj.getWorldPosition(new THREE.Vector3());
      const pts = ropeCurve([a.x, a.y, a.z], b.props, this.mode2d ? 'xy' : 'xz', (x, y, z) => this.groundBelow(x, y, z, i.uid));
      out.set(i.uid, this.ropeLook(b.props, pts, pts.map((p) => p.join(',')).join(';')));
    }
    this.ropeViews.sync(out);
  }
  private syncRuntimeRopes(rt: Runtime) {
    const out = new Map<number, RopeLook>();
    for (const i of rt.world.instances) {
      if (i.destroyed || !i.state.rope?.pts?.length) continue;
      const b = i.behaviors.find((x) => x.type === 'rope');
      if (b) out.set(i.uid, this.ropeLook(b.props, i.state.rope.pts, i.state.rope.ver));
    }
    this.ropeViews.sync(out);
  }

  // ---- "Show webcam on object": the live picture in place of these objects' own look, until they are switched off.
  private camMaterial: THREE.MeshBasicMaterial | null = null;
  private camShowing = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
  private updateWebcam() {
    const live = webcam.state === 'on' && webcam.video ? webcam.video : null;
    if (live && this.camMaterial?.map?.image !== live) {
      this.camMaterial?.map?.dispose();
      const t = new THREE.VideoTexture(live); t.colorSpace = THREE.SRGBColorSpace;
      this.camMaterial ??= new THREE.MeshBasicMaterial();
      this.camMaterial.map = t; this.camMaterial.needsUpdate = true;
    }
    const want = new Set<THREE.Mesh>();
    if (live) for (const uid of webcam.shownOn) this.entries.get(uid)?.visual.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && !o.userData.editorOnly && o.name !== 'placeholder') want.add(m); });
    for (const [m, own] of this.camShowing) if (!want.has(m)) { m.material = own; this.camShowing.delete(m); }
    for (const m of want) if (!this.camShowing.has(m)) { this.camShowing.set(m, m.material); m.material = this.camMaterial!; }
  }

  private updateEndless(cam: THREE.Camera, playing: boolean) {
    const s = (this.runtime?.world.scene ?? this.data)?.settings.endless;
    if (!s || this.mode2d) { if (this.endless) { this.endless.dispose(); this.endless = null; } return; }
    if (this.endless?.id !== s.id) {
      this.endless?.dispose();
      this.endless = new EndlessWorld(s, (id) => assetUrl(this.projectId, id), (url) => loadTexture(url));
      this.scene.add(this.endless.group);
    }
    const world = playing ? this.runtime!.world : null;
    const at = cam.getWorldPosition(new THREE.Vector3());
    // The player, when there is one: a camera can swing out from them; the ground must be where they are.
    const player = world?.findByName('Player');
    if (player) at.set(player.x, player.y, player.z);
    this.endless.update(at, world);
    // The sea goes with the player.
    if (world && !s.grassOnly) for (const i of world.of('Water')) { const snap = 25; i.x = Math.round(at.x / snap) * snap; i.z = Math.round(at.z / snap) * snap; }
  }

  private clouds: CloudLayer | null = null;
  private cloudLast = 0;
  /** Clouds, when the scene has them: drawn in the rendered view and while playing. */
  private updateClouds(cam: THREE.Camera, t: number, lit: boolean) {
    const s = (this.runtime?.world.scene ?? this.data)?.settings.clouds;
    const on = !!s?.enabled && !this.mode2d && lit;
    if (!on) { if (this.clouds) this.clouds.group.visible = false; this.cloudLast = t; return; }
    this.clouds ??= new CloudLayer(() => { const url = assetUrl(this.projectId, 'lib:library/world/clouds/FogParticle.png'); return url ? loadTexture(url) : null; });
    if (!this.clouds.group.parent) this.scene.add(this.clouds.group);
    const dt = Math.min(0.1, Math.max(0, t - this.cloudLast)); this.cloudLast = t;
    const st = this.skySettings ? skyState(this.skySettings) : null;
    const sun = this.mainSun(), dir = new THREE.Vector3(0.3, 0.8, 0.4);
    if (sun) dir.copy(sun.getWorldPosition(new THREE.Vector3())).sub(sun.target.getWorldPosition(new THREE.Vector3()));
    dir.normalize();
    const pos = cam.getWorldPosition(new THREE.Vector3());
    const fromS = (c: [number, number, number] | undefined, d: string) => (c ? new THREE.Color().setRGB(c[0], c[1], c[2], THREE.SRGBColorSpace) : new THREE.Color(d));
    const top = fromS(st?.skyColor, '#a8bedc'), low = fromS(st?.horizonColor, '#cfd8e2');
    const cfg = { ...cloudDefaults(), ...s };
    this.clouds.update(cfg, { camera: pos, centre: pos, span: cfg.span ?? 1600, dt, windX: cfg.windX ?? 3, windZ: cfg.windZ ?? 1, sun: dir, sunColor: sun ? sun.color : new THREE.Color('#fff4e3'), sunStrength: sun ? Math.min(1.4, sun.intensity / 2.5) : 0.8, skyTop: top.clone().lerp(new THREE.Color('#ffffff'), 0.25), skyLow: low.multiplyScalar(0.5) });
  }
  /** Water look, every frame: shader settings, caustics lights, and — when some water has foam or depth colour — a
   *  depth pass of the scene without water, so the shader knows how much water lies in front of what is behind it. */
  private prepareWater(cam: THREE.Camera, t: number, lit: boolean) {
    const waters: Entry[] = [];
    for (const e of this.entries.values()) if (e.water) waters.push(e);
    if (!waters.length) return;
    let depth = false, colour = false;
    const box = new THREE.Box3();
    // What the water mirrors: the real sun's glitter, and the sky's colours (at sunset too).
    const sun = this.mainSun(), sunDir = new THREE.Vector3(0.25, 1, 0.15);
    if (sun) sunDir.copy(sun.getWorldPosition(new THREE.Vector3())).sub(sun.target.getWorldPosition(new THREE.Vector3()));
    const st = this.skySettings ? skyState(this.skySettings) : null;
    const skyTop = new THREE.Color('#d6e9ff'), skyLow = new THREE.Color('#e4eef8');
    if (st) { skyTop.setRGB(...st.skyColor, THREE.SRGBColorSpace); skyLow.setRGB(...st.horizonColor, THREE.SRGBColorSpace); }
    for (const e of waters) {
      const w = e.water!;
      setWaterUniforms(w.u, w.inst, t);
      setWaterSky(w.u, sunDir, sun ? sun.color : skyTop, skyTop, skyLow);
      depth ||= needsDepth(w.u) && e.obj.visible;
      colour ||= needsScene(w.u) && e.obj.visible && lit;
      box.setFromObject(e.visual);
      if (w.light) {
        w.light.visible = lit && e.obj.visible;
        if (w.light.visible && !(t < w.light.userData.nearAt)) { // about once a second: looks at every object's bounds
          const at = causticPose(box).position, boxes: THREE.Box3[] = [];
          for (const o of this.entries.values()) if (o !== e && !o.water && o.obj.visible) boxes.push(new THREE.Box3().setFromObject(o.obj));
          w.light.userData.near = causticShadowStart(at, boxes);
          w.light.userData.nearAt = t + 1;
        }
        if (w.light.visible) placeCausticLight(w.light, box, w.inst.material?.water?.causticsStrength ?? WATER_FX.causticsStrength, t);
      }
      if (w.inst.kind !== 'sphere' && w.inst.material?.water?.wakes !== false && e.obj.visible) this.waterWakes(e, box, t);
    }
    if (!depth || this.xrHost?.presenting || this.scene.overrideMaterial) return;
    const hide: THREE.Object3D[] = [this.helpers, this.colliderGroup];
    for (const e of waters) hide.push(e.visual);
    if (this.clouds) hide.push(this.clouds.group);
    this.root.traverse((o) => { if (o.userData.editorOnly) hide.push(o); });
    // Depth only: one material for everything (sprites and particles would be drawn as squares). With colour (for
    // refraction) the scene draws as it is.
    if (!colour) { for (const pv of this.particleViews.values()) hide.push(pv.points); this.root.traverse((o) => { if ((o as THREE.Sprite).isSprite) hide.push(o); }); }
    this.waterPass.render(this.renderer, this.scene, cam, waters.map((e) => e.water!.u), hide, colour);
  }

  /** Game View: the active (or picked) camera into a corner of the canvas, as the game would draw it. */
  private renderGameView(r: { x: number; y: number; w: number; h: number }) {
    const list = this.data?.instances ?? [];
    const cd = (this.viewCameraUid != null ? list.find((i) => i.uid === this.viewCameraUid && i.kind === 'camera') : undefined) ?? this.activeCameraData(list);
    const cam = cd ? this.entries.get(cd.uid)?.camera : undefined;
    if (!cam || r.w < 8 || r.h < 8) return;
    // Game look: no helpers, gizmos or colliders; scene lights on, studio light off; no wireframe override; real materials.
    const hidden: THREE.Object3D[] = [];
    const hide = (o: THREE.Object3D) => { if (o.visible) { o.visible = false; hidden.push(o); } };
    hide(this.helpers); hide(this.colliderGroup); if (this.cullDebug) hide(this.cullDebug);
    for (const c of this.scene.children) if (c.userData.editorOnly || (c as any).isTransformControlsRoot) hide(c);
    this.root.traverse((o) => { if (o.userData.editorOnly) hide(o); });
    const shown: THREE.Object3D[] = [];
    const show = (o: THREE.Object3D) => { if (!o.visible) { o.visible = true; shown.push(o); } };
    show(this.hemi); hide(this.studio);
    for (const e of this.entries.values()) if (e.visual.name === 'light') e.visual.children.forEach((c) => { if ((c as any).isLight) show(c); });
    const override = this.scene.overrideMaterial; this.scene.overrideMaterial = null;
    // Collision View ghosts materials; the game view shows them as they are.
    const ghosted: [THREE.Material, number, boolean][] = [];
    if (this.collisionView) for (const e of this.entries.values()) for (const m of e.materials) if (m.depthWrite !== m.userData.baseDepthWrite) { ghosted.push([m, m.opacity, m.depthWrite]); m.opacity = Math.min(1, m.opacity / 0.15); m.depthWrite = m.userData.baseDepthWrite; }
    const pc = cam as THREE.PerspectiveCamera, oc = cam as THREE.OrthographicCamera, aspect = r.w / r.h;
    const saved = pc.isPerspectiveCamera ? [pc.aspect] : [oc.left, oc.right];
    if (pc.isPerspectiveCamera) { pc.aspect = aspect; pc.updateProjectionMatrix(); }
    else if (oc.isOrthographicCamera) { const half = (oc.top - oc.bottom) / 2; oc.left = -half * aspect; oc.right = half * aspect; oc.updateProjectionMatrix(); }
    const bottom = this.height - r.y - r.h;
    this.renderer.setScissorTest(true);
    this.renderer.setScissor(r.x, bottom, r.w, r.h); this.renderer.setViewport(r.x, bottom, r.w, r.h);
    this.renderer.render(this.scene, cam);
    this.renderer.setScissorTest(false); this.renderer.setViewport(0, 0, this.width, this.height);
    if (pc.isPerspectiveCamera) { pc.aspect = saved[0]; pc.updateProjectionMatrix(); }
    else if (oc.isOrthographicCamera) { oc.left = saved[0]; oc.right = saved[1]; oc.updateProjectionMatrix(); }
    for (const [m, o, d] of ghosted) { m.opacity = o; m.depthWrite = d; }
    this.scene.overrideMaterial = override;
    for (const o of hidden) o.visible = true;
    for (const o of shown) o.visible = false;
  }

  private widenForGuide(cam: THREE.Camera): (() => void) | null {
    const view = this.width / Math.max(1, this.height), a = this.frameAspect;
    if (!a || a <= view) return null;
    const k = a / view;
    const pc = cam as THREE.PerspectiveCamera, oc = cam as THREE.OrthographicCamera;
    if (pc.isPerspectiveCamera) {
      const f = pc.fov;
      pc.fov = (2 * Math.atan(Math.tan((f * Math.PI) / 360) * k) * 180) / Math.PI; pc.updateProjectionMatrix();
      return () => { pc.fov = f; pc.updateProjectionMatrix(); };
    }
    if (oc.isOrthographicCamera) {
      const [t, b, l, r] = [oc.top, oc.bottom, oc.left, oc.right];
      oc.top *= k; oc.bottom *= k; oc.left *= k; oc.right *= k; oc.updateProjectionMatrix();
      return () => { oc.top = t; oc.bottom = b; oc.left = l; oc.right = r; oc.updateProjectionMatrix(); };
    }
    return null;
  }

  /**
   * Visibility debug: every cullable object's bounds, drawn through walls and coloured by what culling decided
   * (green drawn, cyan / blue simplified LOD 1 / 2, red hidden behind walls, grey beyond draw distance or its range).
   */
  private cullDebug: THREE.LineSegments | null = null;
  /**
   * Visibility debug › From above: culling still decides with the game camera, the picture is drawn from a camera high
   * above it with the game camera's view frustum (cut at 80 m) drawn in yellow, so what is culled and why can be seen.
   */
  private aboveCam = new THREE.PerspectiveCamera(50, 1, 0.5, 4000);
  private frustumLines: THREE.LineSegments | null = null;
  private debugAbove(cam: THREE.Camera): THREE.Camera {
    const p = cam.getWorldPosition(new THREE.Vector3()), f = cam.getWorldDirection(new THREE.Vector3());
    f.y = 0; if (f.lengthSq() < 1e-6) f.set(0, 0, -1); f.normalize();
    this.aboveCam.aspect = this.width / Math.max(1, this.height); this.aboveCam.updateProjectionMatrix();
    this.aboveCam.position.copy(p).addScaledVector(f, -25).add(new THREE.Vector3(0, 55, 0));
    this.aboveCam.lookAt(p.clone().addScaledVector(f, 25));
    this.aboveCam.updateMatrixWorld();
    // The game camera's frustum: its 8 corners from the inverse projection, far plane cut at 80 m.
    const pc = cam as THREE.PerspectiveCamera, far = Math.min(80, pc.far ?? 80), near = pc.near ?? 0.1;
    const inv = new THREE.Matrix4().multiplyMatrices(cam.matrixWorld, cam.projectionMatrixInverse);
    const ndcZ = (d: number) => new THREE.Vector3(0, 0, -d).applyMatrix4(cam.projectionMatrix).z;
    const zs = [ndcZ(near), ndcZ(far)];
    const c = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z).applyMatrix4(inv);
    const k = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    const nearC = k.map(([x, y]) => c(x, y, zs[0])), farC = k.map(([x, y]) => c(x, y, zs[1]));
    const pts: number[] = [];
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      pts.push(...nearC[i].toArray(), ...nearC[j].toArray(), ...farC[i].toArray(), ...farC[j].toArray(), ...nearC[i].toArray(), ...farC[i].toArray());
    }
    if (!this.frustumLines) {
      this.frustumLines = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xffd23f, depthTest: false }));
      this.frustumLines.renderOrder = 1000; this.frustumLines.frustumCulled = false;
    }
    this.frustumLines.geometry.dispose();
    this.frustumLines.geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    if (!this.frustumLines.parent) this.scene.add(this.frustumLines);
    return this.aboveCam;
  }
  private updateCullDebug(on: boolean) {
    if (!on || this.renderSettings?.debugView !== 'above') this.frustumLines?.removeFromParent();
    if (!on) { if (this.cullDebug) { this.cullDebug.removeFromParent(); this.cullDebug.geometry.dispose(); this.cullDebug = null; } return; }
    if (!this.cullDebug) {
      this.cullDebug = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true, opacity: 0.9 }));
      this.cullDebug.renderOrder = 999; this.cullDebug.frustumCulled = false; this.scene.add(this.cullDebug);
    }
    const COL: Record<string, [number, number, number]> = { visible: [0.2, 0.9, 0.3], lod1: [0.2, 0.8, 0.95], lod2: [0.3, 0.4, 1], occluded: [1, 0.25, 0.2], distance: [0.55, 0.55, 0.55], range: [0.55, 0.55, 0.55] };
    const pos: number[] = [], col: number[] = [];
    const E = [[0, 1], [1, 3], [3, 2], [2, 0], [4, 5], [5, 7], [7, 6], [6, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
    let n = 0;
    for (const [, s] of this.culler.decisions()) {
      if (s.box.isEmpty() || ++n > 2000) continue;
      const c = COL[s.decision === 'visible' ? (s.level ? `lod${s.level}` : 'visible') : s.decision];
      const b = s.box, p = (k: number) => [k & 1 ? b.max.x : b.min.x, k & 2 ? b.max.y : b.min.y, k & 4 ? b.max.z : b.min.z];
      for (const [a, z] of E) { pos.push(...p(a), ...p(z)); col.push(...c, ...c); }
    }
    this.cullDebug.geometry.dispose();
    this.cullDebug.geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)).setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  }

  /** Report finished one-shot glTF animations back to the runtime. */
  pollAnimations(rt: Runtime) {
    for (const e of this.entries.values()) {
      if (!e.action || e.action.loop !== THREE.LoopOnce) continue;
      if (!e.action.isRunning() && e.animName) {
        const i = rt.world.byUid.get(e.uid);
        if (i && i.animation === e.animName) { i.animFinished = true; e.animName = '__done'; }
      }
    }
  }

  snapshot(w = 160, h = 100): string {
    this.render();
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    c.getContext('2d')!.drawImage(this.renderer.domElement, 0, 0, w, h);
    return c.toDataURL('image/jpeg', 0.8);
  }

  dispose() {
    this.controls.dispose();
    this.postfx.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
