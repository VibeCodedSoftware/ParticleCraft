// Portable scene description. GameCraft scenes and LogicCraft stages are both SceneData,
// so the shared runtime executes them identically. Units: meters, seconds, degrees. Y is up.
import type { VariableDef } from '../schema';
import { DEFAULT_VOXEL, type VoxelData } from './voxel';
import type { TextStyle } from './textStyle';
import type { CloudSettings, SkySettings } from './sky';
import type { EndlessSettings } from '../world/document';
import type { ObjectFx } from '../objectFx';
import type { TilemapData } from '../tilemap';

export type InstanceKind =
  | 'box' | 'sphere' | 'cylinder' | 'cone' | 'plane' | 'capsule' | 'torus' | 'ramp'
  | 'mesh' | 'sprite' | 'text' | 'camera' | 'light' | 'emitter' | 'empty' | 'voxel' | 'tilemap';

export interface BehaviorData { type: string; props: Record<string, any> }

export type ColliderShape = 'box' | 'sphere' | 'capsule' | 'cylinder' | 'cone' | 'convex' | 'mesh' | 'none';

/** Collision layer names (bit index = layer). */
export const COLLISION_LAYERS = ['Default', 'Player', 'Enemy', 'Projectile', 'Pickup', 'World', 'Trigger', 'Custom'];

export interface ColliderData {
  /** box/sphere/capsule/cylinder/cone use size/offset; convex and mesh use generated `boxes` from the model. */
  shape: ColliderShape;
  /** Size in local units before scale. */
  size: [number, number, number];
  offset: [number, number, number];
  /** Triggers report overlaps but never block movement. */
  isTrigger?: boolean;
  /** Dynamic objects: simulated, but other objects pass through them (overlap events still fire). */
  nonBlocking?: boolean;
  /** Collision layer (0-7, see COLLISION_LAYERS) and the layers it collides with (bit mask; default all). */
  layer?: number;
  mask?: number;
  /** convex / mesh: generated hull points (local, for the preview) and source triangle count. */
  hull?: number[];
  sourceTriangles?: number;
  /** convex / mesh: generation detail (cells along the longest side). */
  detail?: number;
  /** Compound collider: boxes [centerX, centerY, centerZ, sizeX, sizeY, sizeZ] in local units (before scale).
   *  Generated from mesh islands for imported rooms; replaces `size`/`offset` for collision. */
  boxes?: number[][];
}

/** Blender-style light settings (see GameCraft/src/rendering/lights.ts for the conversion to the renderer). */
export interface LightData {
  type: 'point' | 'sun' | 'spot' | 'area';
  color: string;
  /** Watts for point/spot/area, W/m² ("Strength") for sun - same meaning as Blender. */
  power: number;
  /** Soft-shadow radius in meters (Blender "Radius"/"Angle" for sun approximated). */
  radius: number;
  castShadow: boolean;
  spotSize: number; // degrees
  spotBlend: number; // 0..1
  areaShape: 'square' | 'rectangle';
  sizeX: number;
  sizeY: number;
  /** Custom distance (Blender "Custom Distance"), 0 = infinite. */
  cutoff: number;
  /** Shadow map size in px (0 / unset = from the quality preset). */
  shadowResolution?: number;
  /** Shadow acne / peter-panning fixes (unset = sensible defaults per light type). */
  shadowBias?: number; shadowNormalBias?: number;
  /** How light fades with distance: realistic (inverse square), linear, or none. */
  falloff?: 'realistic' | 'linear' | 'none';
  /** Sun: half-size (m) of the area around the scene that gets shadows (bigger = wider, softer detail). */
  shadowArea?: number;
}

/** Blender-style camera settings. */
export interface CameraData {
  /** View preset last applied (isometric 2:1 / true isometric / top-down) and its quarter-turns; see cameraPresets.ts. */
  preset?: { id: 'iso21' | 'iso' | 'topdown'; turn: number };
  type: 'perspective' | 'orthographic';
  focalLength: number; // mm
  sensorWidth: number; // mm, Blender default 36
  orthoScale: number;
  shiftX: number;
  shiftY: number;
  clipStart: number;
  clipEnd: number;
  dofEnabled: boolean;
  focusDistance: number;
  focusObject: string;
  fStop: number;
  /** Ordered post-processing stack, owned by this camera. */
  postfx: PostFxEffect[];
  active: boolean;
  pixelPerfect?: boolean;
}

export interface PostFxEffect { id: string; type: string; enabled: boolean; params: Record<string, number | boolean | string> }

export interface TextData { text: string; size: number; color: string; align: 'left' | 'center' | 'right'; hud: boolean; anchor: 'tl' | 'tc' | 'tr' | 'cl' | 'cc' | 'cr' | 'bl' | 'bc' | 'br'; button?: boolean; /** Draw on a dark rounded panel (menus, inventories). */ panel?: boolean; /** Asset id of a .ttf/.otf font. */ font?: string; /** Asset id of an icon image shown before the text. */ icon?: string; /** Background, outline, shadow, wrapping (see textStyle.ts). */ style?: TextStyle; /** Screen (HUD) text is drawn on top of the camera's Post-FX unless this is on. */ postfx?: boolean; /** How a value set by "Set bar" looks. */ barStyle?: BarStyle }

/** A HUD bar's look: a plain bar, separate ticks, hearts (or your own icons), or your own picture filling up. */
export interface BarStyle {
  kind: 'bar' | 'ticks' | 'hearts' | 'image';
  /** Filled and empty colours (default: the text colour, and dark). */
  color?: string; bg?: string;
  /** Ticks or hearts in all. */
  count?: number;
  /** Size in px: the whole bar or picture; for hearts and ticks, one of them. */
  width?: number; height?: number;
  radius?: number;
  /** Pictures (asset ids): a full and an empty icon for hearts; the filling picture and what is behind it for image. */
  full?: string; empty?: string;
  /** Show the text with it. */
  label?: boolean;
}

export interface SpriteData {
  image: string; frames: number; fps: number; animation: string; animations?: Record<string, { from: number; to: number; fps: number; loop: boolean }>; flipX?: boolean; pixelArt?: boolean;
  /** Costumes (emoji or image ids) for "Next costume" / "Switch costume". */
  costumes?: string[];
  /** Sprite-sheet rows. The image is a grid of `frames` cells read left to right, top to bottom (1 = a strip). */
  rows?: number;
  /** 3D: always turn to face the camera. */
  billboard?: boolean;
  /** Vertical: turns round the upright only, staying planted (grass, trees). Spherical (the default): tilts too. */
  billboardMode?: 'vertical' | 'spherical';
  /** 3D: lit by the scene's lights (off = the picture's own colours, unlit). */
  lit?: boolean;
  /** 3D: casts a shadow in the picture's shape / shows shadows falling on it. */
  castShadow?: boolean; receiveShadow?: boolean;
  /** Normal map (same layout as the image: same frames) for 2D lighting. */
  normalMap?: string;
  /** How strongly the normal map bends the light (1 = as painted, up to 3). */
  normalStrength?: number;
  /** Green channel convention: OpenGL (+Y up, Blender / Unity) or DirectX (−Y, Unreal / Substance default). */
  normalFormat?: 'opengl' | 'directx';
  /** 0 = matte, 1 = glossy: highlights from lights that show the normal map even on dark pictures. */
  shine?: number;
}

export interface MeshData {
  asset: string; rotY: number; tint?: boolean;
  /** A held pose for a rig with no clip for it (arms holding a gun): each chain of bones reaches its target, the middle bent toward the pole. In the model's own units. */
  holdPose?: HoldPose[];
  /** Behavior animation name -> model clip name, e.g. { fall: 'Jump', idle: 'Walk.002' }. */
  animMap?: Record<string, string>;
  /** Animation files (Mixamo FBX, GLB…) whose clips are retargeted onto this model's bones (Import animation). */
  animSources?: string[];
  /**
   * Bone Edit (Model & animations › Bones): per bone name, a turn (degrees, X Y Z), a move (model units) and a size,
   * layered on top of whatever animation plays (fix a T-pose arm, a bigger head, a tilted weapon hand).
   */
  bonePose?: Record<string, BoneEdit>;
}
export interface BoneEdit { rot?: [number, number, number]; pos?: [number, number, number]; scale?: number }

/** A drawn NPC route: points in world space and an optional pause (seconds) at each one. */
export interface NpcPath { points: [number, number, number][]; waits?: number[] }

export interface InstanceData {
  uid: number;
  type: string;
  name: string;
  kind: InstanceKind;
  x: number; y: number; z: number;
  rx: number; ry: number; rz: number;
  sx: number; sy: number; sz: number;
  visible: boolean;
  /** Drawn only between these camera distances (m; 0 = no limit). */
  visRange?: [number, number];
  /** Never hidden or simplified by culling / LOD (always drawn). */
  noCull?: boolean;
  color: string;
  opacity: number; // 0..100 like Construct
  layer: number; // 2D draw order (higher draws on top)
  parent?: number;
  /** Hang on this bone of the parent's model instead of the parent itself (Bone view); it moves with the animation. */
  parentBone?: string;
  /** Takes no bullet holes or blood (glass, water, a clean showroom floor). */
  noMarks?: boolean;
  /** Reflection probe: objects within `radius` reflect a picture of the scene from here. */
  reflectionProbe?: { radius: number; resolution: number; /** Seconds between captures while playing; 0 = once. */ every: number; strength: number };
  /** A flat mirror on top of this object (0–1 strength; the scene is drawn again for it). */
  mirror?: { strength: number; resolution: number };
  collider: ColliderData;
  vars: Record<string, any>;
  behaviors: BehaviorData[];
  tags: string[];
  mesh?: MeshData;
  sprite?: SpriteData;
  text?: TextData;
  light?: LightData;
  camera?: CameraData;
  emitter?: { preset: string; params: Record<string, any>; playing: boolean };
  /** Diggable voxel terrain (kind 'voxel'), see runtime/voxel.ts. */
  voxel?: VoxelData;
  /**
   * Boolean (Blender's Boolean modifier): this mesh cut by / joined with / overlapped with other objects, in order.
   * Cutters are hidden and pass-through while playing unless hideCutters is false. See runtime/boolean.ts.
   */
  boolean?: { ops: import('./boolean').BooleanOp[]; hideCutters?: boolean };
  material?: {
    roughness: number; metalness: number; emissive: string; emissiveStrength: number; flatShading?: boolean; map?: string;
    /** Strengths of the Normal, Height (bump) and Ambient occlusion maps (default 1). */
    normalStrength?: number; heightAmount?: number; aoStrength?: number;
    /**
     * Height map as real displacement: the surface is subdivided and its points move along their normals (white out,
     * black in, mid-grey stays) by up to `displaceAmount` metres; `displaceDetail` scales the subdivision (1 = about
     * 16 points per metre). Visual only: collision keeps the object's shape. Off = bump (lighting only).
     */
    displace?: boolean; displaceAmount?: number; displaceDetail?: number;
    /** 'water': see-through, glossy and (with ripples) animated; uses the object's colour and opacity. */
    surface?: 'standard' | 'water';
    ripples?: boolean; rippleStrength?: number; rippleSpeed?: number; /** Repeats of the ripple pattern across the surface. */ rippleScale?: number;
    /** Water look (surface: water; visual only, collision is unchanged). See WATER_FX in water.ts. */
    water?: {
      /** Moving surface: the top of a box, all round a sphere. */
      waves?: boolean; waveHeight?: number; waveLength?: number; waveSpeed?: number;
      /** Which way the waves travel (degrees), how many overlapping wave layers (1–3), choppiness (0–1), variation seed. */
      waveDirection?: number; waveLayers?: number; turbulence?: number; waveSeed?: number;
      /** Fine crinkled detail on top of the waves (0–2, default 1). */
      detail?: number;
      /** Brightness of the glints and sky reflection on the surface (0–3, default 1). */
      highlights?: number;
      /** Rings and wakes where objects move through the surface (on unless false), and how strong (0–3, default 1). */
      wakes?: boolean; wakeStrength?: number;
      /** Foam where the water is thin: shores and around things that stick out of it. */
      foam?: boolean; foamWidth?: number; foamColor?: string;
      /** Cartoon foam patches drifting on the surface (0 = none, 1 = lots). */
      toonFoam?: number;
      /** Clear in the shallows, this colour where it is deeper than `clarity` metres (0 = off). */
      deepColor?: string; clarity?: number;
      /** Rippling light on whatever is under the water. */
      caustics?: boolean; causticsStrength?: number;
    };
    /** Per-property textures with tiling / offset / rotation / random tiling / animation (see materialMaps.ts). */
    maps?: Partial<Record<import('../materialMaps').MapSlot, import('../materialMaps').TexSlot>>;
    randomTiling?: import('../materialMaps').RandomTiling;
  };
  /** Route for the Path follower behavior (world points), drawn and edited in the scene. */
  path?: NpcPath;
  /** Visual effects on this object only (glow, pixelate, blur, outline, tint); see objectFx.ts. */
  fx?: ObjectFx[];
  /** 2D tile layers painted from a tileset (kind 'tilemap'); see tilemap.ts. */
  tilemap?: TilemapData;
  /** Keyframe clips (scene.animations) played automatically for movement states: { walk: 'Walk waddle', idle: ... }. */
  animRoles?: Record<string, string>;
  /** Editor-only flags (locked, hidden in editor). Ignored by the runtime. */
  editor?: { locked?: boolean; hiddenInEditor?: boolean; showCollider?: boolean; /** Outliner folder id. */ folder?: string };
}

export interface ObjectTypeDef {
  name: string;
  kind: InstanceKind;
  description?: string;
  vars: VariableDef[];
  /** Used by Create/Spawn when no placed instance of the type exists. */
  template?: Omit<InstanceData, 'uid'>;
  /** Prefab source, if the type came from the asset library. */
  prefab?: string;
}

export interface SceneSettings {
  gravity: number; // m/s², negative = down
  background: string;
  bounds?: { min: [number, number, number]; max: [number, number, number] };
  fixedTimestep: number;
  seed: number;
  /** 'fixed' (default): the same random results every play; 'random': a new seed every play. */
  seedMode?: 'fixed' | 'random';
  world?: {
    color: string; strength: number; skyEnabled?: boolean;
    /** Environment image (HDRI or panorama) lighting reflections and ambient; optionally the background. */
    envMap?: string; envStrength?: number; envBackground?: boolean; envBlur?: number; fogEnabled?: boolean; fogColor?: string; fogDensity?: number; viewTransform?: 'standard' | 'filmic' | 'agx' | 'neutral'; exposure?: number; look?: string };
  inputMap?: Record<string, string[]>;
  /** Sky dome and day/night cycle (see sky.ts). */
  sky?: SkySettings;
  /** Clouds: off unless enabled. */
  clouds?: Partial<CloudSettings> & { enabled: boolean };
  /** An endless world, streamed round the player from its seed and settings (from WorldCraft). */
  endless?: EndlessSettings;
  /** Multiplier on every material's emission (lights-out events); 1 = as authored. */
  emissionScale?: number;
  /** 'text': the game is shown as a full-screen story (text adventure) instead of the scene view. */
  presentation?: 'scene' | 'text';
  /** 2D lighting: the world is dark but for the ambient light and Light objects; sprites can have normal maps. */
  lighting2d?: { enabled: boolean; ambient: string; ambientStrength: number };
  /** Global illumination and reflections, per scene (see lighting.ts). */
  lighting?: import('./lighting').LightingSettings;
}

export interface SceneData {
  id: string;
  name: string;
  mode: '2d' | '3d';
  plane: 'xy' | 'xz';
  objectTypes: ObjectTypeDef[];
  instances: InstanceData[];
  settings: SceneSettings;
  /** Which logic sheet runs for this scene (Construct: event sheet bound to a layout). */
  sheetId?: string;
  /** Keyframe clips made in the Animation editor. Played with "Play animation". */
  animations?: AnimationClip[];
  /** Outliner folders (editor organisation only; objects point to theirs with editor.folder). */
  folders?: OutlinerFolder[];
}

export interface OutlinerFolder { id: string; name: string; /** Containing folder (nested folders). */ parent?: string; collapsed?: boolean }

export interface AnimationTrack { property: string; keys: { t: number; v: number; ease?: string }[] }
export interface AnimationClip { name: string; duration: number; loop: boolean; tracks: AnimationTrack[]; /** Default object type, informational only. */ objectType?: string }

export const DEFAULT_LIGHT: LightData = {
  type: 'point', color: '#ffffff', power: 1000, radius: 0.1, castShadow: true,
  spotSize: 45, spotBlend: 0.15, areaShape: 'square', sizeX: 1, sizeY: 1, cutoff: 0,
};

export const DEFAULT_CAMERA: CameraData = {
  type: 'perspective', focalLength: 50, sensorWidth: 36, orthoScale: 12, shiftX: 0, shiftY: 0,
  clipStart: 0.1, clipEnd: 1000, dofEnabled: false, focusDistance: 10, focusObject: '', fStop: 2.8,
  postfx: [], active: true,
};

/** One limb of a held pose. `grip`, on a hand: its palm turns to face a direction and its fingers curl round what it holds. */
export interface HoldPose {
  bones: string[]; target: [number, number, number]; pole: [number, number, number];
  grip?: {
    /** Two bones across the knuckles, one at the middle knuckle, one at the thumb's root: how the hand lies is read from these. */
    across: [string, string]; middle: string; thumb: string;
    /** Which way the palm faces, in the model's axes. */ palmTo: [number, number, number];
    /** Each finger's bones from the knuckle out, and its bend at each joint (degrees). */ fingers: { bones: string[]; curl: number[] }[];
  };
}

export function makeInstance(uid: number, type: string, kind: InstanceKind, over: Partial<InstanceData> = {}): InstanceData {
  const size: [number, number, number] = kind === 'plane' ? [1, 0.02, 1] : [1, 1, 1];
  const base: InstanceData = {
    uid, type, name: over.name ?? type, kind,
    x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, sx: 1, sy: 1, sz: 1,
    visible: true, color: '#9aa4b2', opacity: 100, layer: 0,
    collider: { shape: kind === 'sphere' ? 'sphere' : (kind === 'camera' || kind === 'light' || kind === 'empty' || kind === 'emitter' || kind === 'text') ? 'none' : 'box', size, offset: [0, 0, 0] },
    vars: {}, behaviors: [], tags: [],
  };
  if (kind === 'light') base.light = { ...DEFAULT_LIGHT };
  if (kind === 'camera') base.camera = { ...DEFAULT_CAMERA, postfx: [] };
  if (kind === 'text') base.text = { text: 'Text', size: 24, color: '#ffffff', align: 'left', hud: true, anchor: 'tl' };
  if (kind === 'emitter') base.emitter = { preset: 'sparks', params: {}, playing: true };
  if (kind === 'voxel') base.voxel = { ...DEFAULT_VOXEL, size: [...DEFAULT_VOXEL.size] as [number, number, number] };
  if (kind !== 'camera' && kind !== 'light' && kind !== 'text') base.material = { roughness: 0.6, metalness: 0, emissive: '#000000', emissiveStrength: 0 };
  return { ...base, ...over, collider: { ...base.collider, ...(over.collider ?? {}) } } as InstanceData;
}

export function emptyScene(name: string, mode: '2d' | '3d'): SceneData {
  return {
    id: 'scene_' + Math.random().toString(36).slice(2, 9),
    name, mode, plane: mode === '2d' ? 'xy' : 'xz',
    objectTypes: [], instances: [],
    settings: { gravity: -20, background: mode === '2d' ? '#6fb7e8' : '#3a3f47', fixedTimestep: 1 / 60, seed: 1234,
      world: { color: '#5c6370', strength: 0.6, viewTransform: 'agx', exposure: 0, fogEnabled: false, fogColor: '#9aa4b2', fogDensity: 0.01 } },
  };
}

export function nextUid(scene: SceneData): number {
  return scene.instances.reduce((m, i) => Math.max(m, i.uid), 0) + 1;
}
