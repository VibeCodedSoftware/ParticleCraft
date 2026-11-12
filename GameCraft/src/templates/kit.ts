// Small builder used by the starter templates. Templates produce ordinary, fully editable projects.
import { block, createLogicDocument, event, group, comment, newId, type BlockInstance, type EventNode, type VariableDef } from '@shared/src/schema';
import { DEFAULT_CAMERA, DEFAULT_LIGHT, emptyScene, makeInstance, type AnimationClip, type InstanceData, type InstanceKind, type SceneData } from '@shared/src/runtime/scene';
import { behaviorDefaults } from '@shared/src/runtime/behaviors';
import { makeEffect, POSTFX_PRESETS } from '@shared/src/postfx';
import { PROJECT_FORMAT, PROJECT_SCHEMA_VERSION, type AssetRef, type GameProject, type TutorialStep } from '../project/types';

export { block as B, event as E, group as G, comment as C };

/** Bounds of the supplied models after import normalization (pivot at bottom centre), in model units. */
export const LIB = {
  coin: { asset: 'lib:models/Coin.obj', size: [0.83, 0.82, 0.18] },
  gun: { asset: 'lib:models/Gun.obj', size: [2.9, 2.14, 0.81] },
  human: { asset: 'lib:models/LowPolyHuman.obj', size: [3.37, 14.8, 15.5] },
  truck: { asset: 'lib:models/LowPolyTruck.obj', size: [2.9, 2.27, 6.87] },
  /** Mail truck with separate parts: Door1 (driver, left) / Door2 (right) at the cab, Door3 / Door4 the rear doors, Seat, Wheel. */
  mailTruck: { asset: 'lib:models/LowPolyMailTruck.fbx', size: [1516, 798, 822] },
  shovel: { asset: 'lib:models/Shovel.obj', size: [0.88, 13.2, 3.25] },
  arch: { asset: 'lib:models/Start_Finish.obj', size: [8.55, 6.79, 0.28] },
  sword: { asset: 'lib:models/Sword.obj', size: [1.9, 9.82, 1.9] },
  /** Rigged arms (right and left: shoulder, upper_arm, forearm, hand, fingers), facing +Z, no clips. */
  arms: { asset: 'lib:models/Low_Poly_Arms.fbx', size: [158.81, 53.75, 21.8] },
  /** A flag on a pole: red cloth, grey pole. */
  flag: { asset: 'lib:models/Flag.fbx', size: [25.36, 907.45, 910.56] },
  /** LowPolyHuman rigged on the CC0 Quaternius Universal Animation Library (scripts/rig-human.ts), 1.83 m tall. */
  humanAnim: { asset: 'lib:library/characters/LowPolyHuman_Animated.glb', size: [0.7, 1.83, 0.45] },
} as const;

/** Behavior animation names -> clips of the animated LowPolyHuman (46 clips: see the asset's Animations list). */
export const HUMAN_ANIMS: Record<string, string> = {
  idle: 'Idle_Loop', walk: 'Walk_Loop', run: 'Sprint_Loop', jump: 'Jump_Loop', fall: 'Jump_Loop', land: 'Jump_Land',
  attack: 'Punch_Jab', sword: 'Sword_Attack', shoot: 'Pistol_Shoot', hit: 'Hit_Chest', death: 'Death01',
  dig: 'Fixing_Kneeling', push: 'Push_Loop', crouch: 'Crouch_Idle_Loop',
  sit: 'Sitting_Idle_Loop', drive: 'Driving_Loop', talk: 'Idle_Talking_Loop', carry: 'Hold_Box_Idle',
};

/** Mesh settings for an animated human: the rig faces +Z, GameCraft characters face +X. */
export const animatedHuman = (tint = false) => ({ asset: LIB.humanAnim.asset, rotY: 90, tint, animMap: { ...HUMAN_ANIMS } });

export const LIBRARY_ASSETS: AssetRef[] = Object.entries(LIB).map(([k, v]) => ({ id: v.asset, name: k, kind: 'model', source: 'library', extra: v.asset.endsWith('.obj') ? [v.asset.replace('.obj', '.mtl')] : undefined }));

const bh = (type: string, props: Record<string, any> = {}) => ({ type, props: { ...behaviorDefaults(type), ...props } });
export { bh };

export class Kit {
  scene: SceneData;
  private uid = 1;
  constructor(name: string, mode: '2d' | '3d') { this.scene = emptyScene(name, mode); }

  add(type: string, kind: InstanceKind, o: Partial<InstanceData> = {}): InstanceData {
    const i = makeInstance(this.uid++, type, kind, o);
    // `o` may itself be a made instance (uid 0); every placed object still gets its own uid.
    i.uid = this.uid - 1;
    this.scene.instances.push(i);
    return i;
  }

  /** Axis-aligned box. `solid` adds the Solid behavior. */
  box(type: string, x: number, y: number, z: number, sx: number, sy: number, sz: number, color: string, solid = true, o: Partial<InstanceData> = {}) {
    return this.add(type, 'box', { x, y, z, sx, sy, sz, color, behaviors: solid ? [bh('solid')] : [], ...o });
  }

  /** Library model with a collider fitted to its (scaled) bounds. */
  model(type: string, m: { asset: string; size: readonly number[] }, scale: number, o: Partial<InstanceData> = {}, collider?: [number, number, number]) {
    const size = (collider ?? [m.size[0], m.size[1], m.size[2]]) as [number, number, number];
    return this.add(type, 'mesh', {
      sx: scale, sy: scale, sz: scale, color: '#ffffff',
      mesh: { asset: m.asset, rotY: 0 },
      collider: { shape: 'box', size, offset: [0, size[1] / 2, 0] },
      ...o,
    });
  }

  camera(o: Partial<InstanceData> = {}, cam: Partial<typeof DEFAULT_CAMERA> = {}, follow?: Record<string, any>) {
    return this.add('Camera', 'camera', { name: 'Camera', camera: { ...DEFAULT_CAMERA, postfx: [], ...cam }, behaviors: follow ? [bh('follow', follow)] : [], ...o });
  }

  sun(power = 3, rx = -55, ry = 35, o: Partial<InstanceData> = {}) {
    return this.add('Sun', 'light', { name: 'Sun', y: 30, rx, ry, light: { ...DEFAULT_LIGHT, type: 'sun', power, radius: 0.05, castShadow: true }, ...o });
  }

  point(type: string, x: number, y: number, z: number, power = 800, color = '#ffd9a0', o: Partial<InstanceData> = {}, shadow = false) {
    return this.add(type, 'light', { x, y, z, light: { ...DEFAULT_LIGHT, type: 'point', power, color, castShadow: shadow, radius: 0.2 }, ...o });
  }

  text(name: string, text: string, anchor: any, x: number, y: number, size = 22, color = '#ffffff', o: Partial<InstanceData> = {}, extra: Record<string, any> = {}) {
    return this.add(name, 'text', { name, x, y, text: { text, size, color, align: 'left', hud: true, anchor, ...extra }, collider: { shape: 'none', size: [1, 1, 1], offset: [0, 0, 0] }, ...o });
  }

  emitter(type: string, preset: string, x: number, y: number, z: number, params: Record<string, any> = {}) {
    return this.add(type, 'emitter', { x, y, z, emitter: { preset, params, playing: true }, collider: { shape: 'none', size: [1, 1, 1], offset: [0, 0, 0] } });
  }

  /** Object type that only exists as a spawn template (Construct "object type with no instances"). */
  template(i: Omit<InstanceData, 'uid'> & { uid?: number }, vars: VariableDef[] = []) {
    const { uid: _u, ...t } = i as any;
    this.scene.objectTypes.push({ name: i.type, kind: i.kind, vars, template: t });
  }

  typeVars(name: string, vars: VariableDef[]) {
    const t = this.scene.objectTypes.find((x) => x.name === name);
    if (t) t.vars = vars; else this.scene.objectTypes.push({ name, kind: this.scene.instances.find((i) => i.type === name)?.kind ?? 'box', vars });
  }
}

export function v(name: string, value: number | string | boolean | any[] | Record<string, any>, comment?: string): VariableDef {
  const type = typeof value === 'number' ? 'number' : typeof value === 'string' ? 'string' : typeof value === 'boolean' ? 'boolean' : Array.isArray(value) ? 'array' : 'dict';
  return { name, type, value, comment } as VariableDef;
}

export function postfx(preset: string) { return POSTFX_PRESETS[preset].stack(); }
export { makeEffect };

export function clip(name: string, duration: number, loop: boolean, tracks: Record<string, [number, number][]>): AnimationClip {
  return { name, duration, loop, tracks: Object.entries(tracks).map(([property, keys]) => ({ property, keys: keys.map(([t, val]) => ({ t, v: val, ease: 'easeInOut' })) })) };
}

export function makeProject(o: { name: string; template: string; scenes: SceneData[]; events: EventNode[]; globals: VariableDef[]; tutorial: TutorialStep[]; plane: 'xy' | 'xz'; extraAssets?: AssetRef[] }): GameProject {
  const logic = createLogicDocument(o.name, 'gamecraft', o.plane);
  logic.sheets[0].name = o.scenes[0].name + ' events';
  logic.sheets[0].events = o.events;
  logic.globals = o.globals;
  o.scenes[0].sheetId = logic.sheets[0].id;
  const now = new Date().toISOString();
  return {
    format: PROJECT_FORMAT, schemaVersion: PROJECT_SCHEMA_VERSION,
    id: (o.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'project') + '-' + Date.now().toString(36),
    name: o.name, template: o.template, created: now, modified: now,
    scenes: o.scenes, startSceneId: o.scenes[0].id, logic,
    assets: [...LIBRARY_ASSETS, ...(o.extraAssets ?? [])], prefabs: [], particlePresets: {}, postfxPresets: {},
    settings: { quality: 1, volume: 0.8, showFps: false },
    tutorial: { title: o.name, steps: o.tutorial }, favorites: [], recent: [],
  };
}

export type { BlockInstance };
export { newId };
