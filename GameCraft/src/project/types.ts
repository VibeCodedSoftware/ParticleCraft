// GameCraft project format (gamecraft.project v1). Scenes and logic use the shared formats.
import type { LogicDocument } from '@shared/src/schema';
import type { InstanceData, PostFxEffect, SceneData } from '@shared/src/runtime/scene';
import type { EmitterParams } from '@shared/src/runtime/particles';

export const PROJECT_FORMAT = 'gamecraft.project';
export const PROJECT_SCHEMA_VERSION = 1;

export interface AssetImportSettings {
  scale: number;
  center: boolean;
  ground: boolean;
  upAxis: 'y' | 'z';
  rotY: number;
  collision: 'box' | 'none';
  materials: 'keep' | 'flat' | 'unlit';
  animations: boolean;
  /** .blend: keep the file's lights inside the model (off for rooms whose lamps the game places itself). */
  lights?: boolean;
  /** Keep the root bone's movement in animation clips. Off by default: game behaviors move the object,
   *  so clips play in place (otherwise a jump clip and the Platform jump would add up). */
  rootMotion?: boolean;
  /** Per-material fixes applied on import (matched by material name). */
  materialOverrides?: MaterialOverride[];
}

export interface MaterialOverride {
  /** Regular expression matched against the material name (e.g. "^Material\\.00[68]$"). */
  match: string;
  /** Replace the mesh's UVs with world-aligned (box-projected) ones: texture tiles per metre. Keeps one texture
   *  density across faces whose UVs were authored at different scales. */
  worldUV?: number;
  /** Multiply the emission strength (makes glowing parts glow more under the Glare effect). */
  emissive?: number;
  opacity?: number;
  color?: string;
  /** Replace the emission colour (e.g. a glow stick that should glow green). */
  emissiveColor?: string;
}

export interface AssetRef {
  id: string; // e.g. "lib:models/LowPolyTruck.obj", "proj:imported/hero/hero.glb", "prim:cube"
  name: string;
  kind: 'model' | 'texture' | 'audio' | 'font' | 'video';
  source: 'starter' | 'library' | 'imported' | 'generated';
  /** Companion files (e.g. .mtl, textures) for OBJ. */
  extra?: string[];
  importSettings?: AssetImportSettings;
  meta?: { vertices?: number; meshes?: number; materials?: string[]; animations?: string[]; size?: [number, number, number]; sourceFile?: string; importedAt?: string; sourceModified?: number; sheet?: { frames: number; rows: number; fps: number; animations?: Record<string, { from: number; to: number; fps: number; loop: boolean }> } };
  tags?: string[];
  /** Folder in Assets › Imported ("Sprites/Hero"); empty = the folder for its kind (Models, Textures…). */
  folder?: string;
}

export interface Prefab { name: string; instance: InstanceData; children: InstanceData[]; created: string }

export interface TutorialStep { title: string; text: string; target?: string }

export interface GameProject {
  format: typeof PROJECT_FORMAT;
  schemaVersion: number;
  id: string;
  name: string;
  template?: string;
  created: string;
  modified: string;
  scenes: SceneData[];
  startSceneId: string;
  logic: LogicDocument;
  assets: AssetRef[];
  prefabs: Prefab[];
  particlePresets: Record<string, EmitterParams>;
  /** Exposed parameters of effects imported from ParticleCraft (layers live in particlePresets as name, name#2…). */
  vfxExposed?: Record<string, { name: string; targets: { layer: number; param: string }[] }[]>;
  postfxPresets: Record<string, PostFxEffect[]>;
  settings: { quality: number; volume: number; showFps: boolean; render?: Partial<import('../engine/culling').RenderSettings>; export?: Partial<ExportSettings>; /** VR (WebXR): enabled, Quest / PC VR profile, play area… */ vr?: import('@shared/src/vr').VrSettings;
    /** Online play: the game's own signaling trackers and STUN / TURN servers (see Shared/ui/net.ts). */ multiplayer?: import('@shared/ui/net').NetConfig };
  tutorial?: { title: string; steps: TutorialStep[] };
  favorites: string[];
  /** Asset folders made by hand (folders that hold assets exist by themselves). */
  assetFolders?: string[];
  recent: string[];
}

/** File › Export game: how the finished game presents itself (File › Export game › settings). */
export interface ExportSettings {
  /** Shown as the window title / app name. Empty = the project name. */
  title: string;
  shortName: string;
  version: string;
  author: string;
  description: string;
  /** Application icon: a square PNG/JPG (project file or texture asset id). Empty = the GameCraft player icon. */
  icon: string;
  /** Loading / splash background and the colour browsers and phones tint around the app. */
  background: string;
  themeColor: string;
  // Windows
  width: number; height: number; fullscreen: boolean; resizable: boolean;
  /** How the window opens. Absent: `fullscreen` decides (projects made before this). */
  windowMode?: 'windowed' | 'maximized' | 'fullscreen' | 'borderless';
  /** Which monitor: 0 = the main one, 1 and up = that monitor in the system's list. A missing one falls back to the main one. */
  monitor?: number;
  /** Keep this shape with black bars ("16:9"). Absent: fill the window. Web and Windows. */
  aspect?: string;
  // Web / Android
  orientation: 'landscape' | 'portrait' | 'any';
  webFullscreen: boolean;
  /** Reverse-domain id for the installable app (Android / web app), e.g. com.mystudio.mygame. */
  appId: string;
  // Android APK (passwords are never saved)
  /** 'web' = installable web app zip; 'debug' / 'release' = a real APK built with the Android SDK; 'bundle' = an
   *  Android App Bundle (.aab) for Google Play, release-signed. */
  androidPackage: 'web' | 'debug' | 'release' | 'bundle';
  /** Oldest Android the app installs on and the one it targets (API levels; 0 = automatic: 24 / the SDK's newest). */
  minSdk?: number; targetSdk?: number;
  /** Extra Android permissions (VIBRATE, CAMERA…; INTERNET is always on). */
  permissions?: string[];
  /** Android splash screen while the game loads: on, background colour, picture (asset id), minimum seconds. */
  splash?: { enabled: boolean; color: string; image: string; seconds: number };
  /** Whole number that must grow with every update you publish. */
  versionCode: number;
  /** Android SDK folder when it is not found automatically. */
  androidSdk: string;
  /** Release signing key (a .keystore / .jks file you keep) and its alias. */
  keystore: string; keyAlias: string;
}
export const DEFAULT_EXPORT: ExportSettings = {
  title: '', shortName: '', version: '1.0.0', author: '', description: '', icon: '', background: '#111111', themeColor: '#111111',
  width: 1280, height: 720, fullscreen: false, resizable: true, orientation: 'landscape', webFullscreen: true, appId: '',
  androidPackage: 'debug', versionCode: 1, androidSdk: '', keystore: '', keyAlias: 'release',
};

export const DEFAULT_IMPORT: AssetImportSettings = { scale: 1, center: true, ground: true, upAxis: 'y', rotY: 0, collision: 'box', materials: 'keep', animations: true };
