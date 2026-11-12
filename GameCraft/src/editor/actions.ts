// Editor commands shared by menus, shortcuts and panels.
import { applyWaterLook, WATER_LOOK } from '@shared/src/runtime/water';
import { deepClone, walkEvents, type BlockInstance } from '@shared/src/schema';
import { BLOCK_DEFS } from '@shared/src/blocks/definitions';
import { DEFAULT_LIGHT, makeInstance, nextUid, type InstanceData, type InstanceKind, type SceneData } from '@shared/src/runtime/scene';
import { BEHAVIORS, behaviorDefaults } from '@shared/src/runtime/behaviors';
import { emptyTilemap } from '@shared/src/tilemap';
import { store } from '../project/store';
import { api } from '../project/api';
import { reparent } from './parenting';
import type { AssetRef, GameProject } from '../project/types';

export function curScene(p: GameProject) { return p.scenes.find((s) => s.id === store.get().sceneId) ?? p.scenes[0]; }

function uniqueName(scene: SceneData, base: string) {
  const names = new Set(scene.instances.map((i) => i.name));
  if (!names.has(base)) return base;
  let n = 2; while (names.has(`${base}.${String(n).padStart(3, '0')}`)) n++;
  return `${base}.${String(n).padStart(3, '0')}`; // Blender-style .001 suffix
}

const waterLook = (): Partial<InstanceData> => ({
  color: WATER_LOOK.color, opacity: WATER_LOOK.opacity,
  material: { roughness: 0.08, metalness: 0.1, emissive: '#000000', emissiveStrength: 0, surface: 'water', ripples: true },
  behaviors: [{ type: 'water', props: behaviorDefaults('water') }],
});

/** A rope's object: the little knob at its top, with nothing to bump into. */
const ropeKnob = (props: Record<string, any>): Partial<InstanceData> => ({
  sx: 0.16, sy: 0.16, sz: 0.16, color: '#6b5236',
  collider: { shape: 'none', size: [1, 1, 1], offset: [0, 0, 0] },
  behaviors: [{ type: 'rope', props: { ...behaviorDefaults('rope'), ...props } }],
});

export const ADD_MENU: { group: string; items: { label: string; kind: InstanceKind; type: string; extra?: Partial<InstanceData> }[] }[] = [
  { group: 'Mesh', items: [
    { label: 'Cube', kind: 'box', type: 'Cube' }, { label: 'UV Sphere', kind: 'sphere', type: 'Sphere' }, { label: 'Cylinder', kind: 'cylinder', type: 'Cylinder' },
    { label: 'Cone', kind: 'cone', type: 'Cone' }, { label: 'Plane', kind: 'plane', type: 'Plane', extra: { sx: 4, sz: 4 } }, { label: 'Capsule', kind: 'capsule', type: 'Capsule' },
    { label: 'Torus', kind: 'torus', type: 'Torus' }, { label: 'Ramp', kind: 'ramp', type: 'Ramp' },
    // A small world with its own gravity (Planet behavior); give the player Surface Walker to walk all the way round.
    { label: 'Planet (gravity)', kind: 'sphere', type: 'Planet', extra: { y: 6, sx: 12, sy: 12, sz: 12, color: '#5f9e57', behaviors: [{ type: 'solid', props: { enabled: true } }, { type: 'planet', props: behaviorDefaults('planet') }] } },
    // Diggable block terrain (Dig/Build terrain blocks); Solid so characters walk on it.
    { label: 'Voxel terrain', kind: 'voxel', type: 'Terrain', extra: { y: -6, behaviors: [{ type: 'solid', props: { enabled: true } }] } },
  ] },
  // Ready to use: swims and floats, and looks like water, with all its controls in its Water behavior.
  { group: 'Water', items: [
    { label: 'Pool', kind: 'box', type: 'Water', extra: { y: 0, sx: 12, sy: 2, sz: 12, ...waterLook() } },
    { label: 'Ball of water', kind: 'sphere', type: 'Water', extra: { y: 3, sx: 4, sy: 4, sz: 4, ...waterLook() } },
  ] },
  { group: 'Light', items: [
    { label: 'Point', kind: 'light', type: 'Light', extra: { y: 3, light: { ...DEFAULT_LIGHT, type: 'point' } } },
    { label: 'Sun', kind: 'light', type: 'Sun', extra: { y: 10, rx: -50, light: { ...DEFAULT_LIGHT, type: 'sun', power: 3 } } },
    { label: 'Spot', kind: 'light', type: 'Spot', extra: { y: 4, rx: -60, light: { ...DEFAULT_LIGHT, type: 'spot' } } },
    { label: 'Area', kind: 'light', type: 'Area', extra: { y: 3, rx: -90, light: { ...DEFAULT_LIGHT, type: 'area', power: 200, sizeX: 2, sizeY: 1 } } },
  ] },
  { group: 'Other', items: [
    { label: 'Camera', kind: 'camera', type: 'Camera', extra: { y: 3, z: 8 } },
    { label: 'Empty', kind: 'empty', type: 'Empty' },
    { label: 'Reflection probe', kind: 'empty', type: 'ReflectionProbe', extra: { y: 1.5, reflectionProbe: { radius: 8, resolution: 128, every: 0, strength: 1 } } },
    { label: 'Text (HUD)', kind: 'text', type: 'Text', extra: { x: 16, y: 16 } },
    { label: 'Sprite', kind: 'sprite', type: 'Sprite', extra: { sprite: { image: 'proc:hero', frames: 6, fps: 8, animation: 'idle', pixelArt: true } } },
    { label: 'Particle emitter', kind: 'emitter', type: 'Emitter', extra: { y: 1 } },
    { label: '2D light', kind: 'light', type: 'Light2D', extra: { sx: 0.5, sy: 0.5, sz: 0.5, light: { ...DEFAULT_LIGHT, type: 'point', color: '#ffd9a0', power: 250, cutoff: 6 } } },
    { label: 'Tilemap', kind: 'tilemap', type: 'Level', extra: { layer: -1, collider: { shape: 'none', size: [1, 1, 1], offset: [0, 0, 0] }, tilemap: emptyTilemap() } },
    { label: 'Rope', kind: 'sphere', type: 'Rope', extra: { y: 5, ...ropeKnob({}) } },
    { label: 'Zipline', kind: 'sphere', type: 'Zipline', extra: { y: 5, ...ropeKnob({ style: 'between two points', use: 'zipline', endX: 12, endY: -3, thickness: 0.04, color: '#6b6f76' }) } },
    { label: 'Hanging rope (for a lantern)', kind: 'sphere', type: 'HangingRope', extra: { y: 5, ...ropeKnob({ use: 'decoration', length: 1.5 }) } },
  ] },
];

export function addObject(kind: InstanceKind, type: string, extra: Partial<InstanceData> = {}, at?: [number, number, number]) {
  let uid = 0;
  store.mutate(`Add ${type}`, (p) => {
    const s = curScene(p);
    uid = nextUid(s);
    const pos = at ?? [0, kind === 'light' || kind === 'camera' ? 0 : s.mode === '3d' ? 0.5 : 0, 0];
    const inst = makeInstance(uid, type, kind, { name: uniqueName(s, type), x: pos[0], y: pos[1], z: pos[2], ...deepClone(extra) });
    if (s.mode === '2d' && kind !== 'camera' && kind !== 'text') inst.z = 0;
    s.instances.push(inst);
  });
  store.set({ selection: [uid] });
  return uid;
}

/** Make sure an asset used in the scene is listed in the project (library assets are registered on first use). */
export function registerAsset(asset: AssetRef) {
  const p = store.get().project;
  if (!p || p.assets.some((a) => a.id === asset.id)) return;
  store.mutate(`Use asset ${asset.name}`, (pp) => { pp.assets.push(deepClone(asset)); });
}

export function addModel(asset: AssetRef, at?: [number, number, number]) {
  registerAsset(asset);
  const size = asset.meta?.size ?? [1, 1, 1];
  const base = asset.name.replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9_]/g, '') || 'Model';
  return addObject('mesh', base, {
    color: '#ffffff', mesh: { asset: asset.id, rotY: 0 },
    collider: { shape: asset.importSettings?.collision === 'none' ? 'none' : 'box', size: [size[0], size[1], size[2]], offset: [0, size[1] / 2, 0] },
  }, at ?? [0, 0, 0]);
}

export function duplicateSelection() {
  const sel = store.get().selection;
  if (!sel.length) return;
  const newIds: number[] = [];
  store.mutate('Duplicate', (p) => {
    const s = curScene(p);
    let uid = nextUid(s);
    const map = new Map<number, number>();
    // Duplicate selected objects and their children.
    const all = s.instances.filter((i) => sel.includes(i.uid) || isDescendantOf(s, i, sel));
    for (const i of all) map.set(i.uid, uid++);
    for (const i of all) {
      const c = deepClone(i);
      c.uid = map.get(i.uid)!;
      c.name = uniqueName(s, i.name.replace(/\.\d{3}$/, ''));
      if (c.parent != null && map.has(c.parent)) c.parent = map.get(c.parent);
      s.instances.push(c);
      if (sel.includes(i.uid)) newIds.push(c.uid);
    }
  });
  store.set({ selection: newIds });
}

function isDescendantOf(s: SceneData, i: InstanceData, roots: number[]): boolean {
  let p = i.parent;
  while (p != null) { if (roots.includes(p)) return true; p = s.instances.find((x) => x.uid === p)?.parent; }
  return false;
}

export function deleteSelection() {
  const sel = store.get().selection;
  if (!sel.length) return;
  store.mutate(`Delete ${sel.length} object(s)`, (p) => {
    const s = curScene(p);
    s.instances = s.instances.filter((i) => !sel.includes(i.uid) && !isDescendantOf(s, i, sel));
  });
  store.set({ selection: [] });
}

export function groupSelection() {
  const sel = store.get().selection;
  if (!sel.length) return;
  let gid = 0;
  store.mutate('Group', (p) => {
    const s = curScene(p);
    gid = nextUid(s);
    const items = s.instances.filter((i) => sel.includes(i.uid));
    const c = items.reduce((a, i) => [a[0] + i.x / items.length, a[1] + i.y / items.length, a[2] + i.z / items.length], [0, 0, 0]);
    s.instances.push(makeInstance(gid, 'Group', 'empty', { name: uniqueName(s, 'Group'), x: c[0], y: c[1], z: c[2] }));
    for (const i of items) if (i.parent == null) { i.x -= c[0]; i.y -= c[1]; i.z -= c[2]; i.parent = gid; }
  });
  store.set({ selection: [gid] });
}

/** Parent (or, with null, unparent) keeping each object exactly where it is: world position, rotation and size. */
export function setParent(childUids: number[], parentUid: number | null) {
  const s0 = store.get().project ? curScene(store.get().project!) : null;
  if (!s0) return;
  const par = parentUid == null ? null : s0.instances.find((i) => i.uid === parentUid);
  const n = childUids.filter((u) => u !== parentUid).length;
  const approx = { count: 0 };
  store.mutate(parentUid == null ? `Clear parent (${n})` : `Parent ${n} to ${par?.name ?? 'object'}`, (p) => { reparent(curScene(p), childUids, parentUid, approx); });
  if (approx.count) store.log('info', `${approx.count} object(s) kept their position, but their rotation and size are the closest fit: ${par?.name ?? 'the parent'} is scaled unevenly, which slants rotated children. Scale it evenly (or apply its scale) for an exact fit.`);
}

/** Bone view: hang objects on a bone, keeping where they are, or (snap) moved right onto the bone. */
export function parentToBone(childUids: number[], ownerUid: number, bone: string, snap = false) {
  const n = childUids.filter((u) => u !== ownerUid).length;
  store.mutate(`Parent ${n} to bone ${bone}`, (p) => {
    const s = curScene(p);
    reparent(s, childUids, ownerUid, undefined, bone);
    if (snap) for (const i of s.instances) if (childUids.includes(i.uid) && i.parent === ownerUid && i.parentBone === bone) { i.x = i.y = i.z = 0; i.rx = i.ry = i.rz = 0; }
  });
}

// ---------------------------------------------------------------- multi-object edits (right-click menu)

/** Rename the selection: one name for all, or numbered in selection order ("Crate 1", "Crate 2"…). */
export function renameSelection(name: string, numbered: boolean) {
  const sel = store.get().selection, base = name.trim();
  if (!sel.length || !base) return;
  store.mutate(`Rename ${sel.length}`, (p) => {
    const s = curScene(p);
    sel.forEach((u, k) => { const i = s.instances.find((x) => x.uid === u); if (i) i.name = numbered && sel.length > 1 ? `${base} ${k + 1}` : base; });
  });
}

/** Object type (what event blocks refer to): the selection joins `type`, keeping its own behaviors and variables. */
/** What changing these objects' type would break (nothing is removed: they keep their behaviors and variables). */
export function changeTypeReport(p: GameProject, uids: number[], to: string): string[] {
  const s = curScene(p), objs = s.instances.filter((i) => uids.includes(i.uid));
  const out: string[] = [];
  const blocks: BlockInstance[] = [];
  for (const sh of p.logic.sheets) walkEvents(sh.events, (n) => { if (n.kind === 'event') blocks.push(...n.conditions, ...n.actions); });
  for (const from of new Set(objs.map((i) => i.type))) {
    if (from === to) continue;
    const n = blocks.filter((b) => b.target === from).length;
    // Other objects of the old type keep those blocks; only when every one changes do they stop doing anything.
    const left = s.instances.filter((i) => i.type === from && !uids.includes(i.uid)).length;
    if (n) out.push(`${n} block${n === 1 ? '' : 's'} for "${from}" will no longer apply to ${left ? 'these objects' : 'anything (no "' + from + '" left)'}; "${to}" blocks apply instead.`);
  }
  // Blocks of the new type that need a behavior these objects don't have.
  const need = new Set(blocks.filter((b) => b.target === to).map((b) => BLOCK_DEFS[b.block]?.behavior).filter(Boolean) as string[]);
  for (const beh of need) {
    const missing = objs.filter((i) => !i.behaviors.some((b) => b.type === beh)).length;
    if (missing) out.push(`"${to}" blocks use the ${BEHAVIORS[beh]?.name ?? beh} behavior, which ${missing === objs.length ? 'these objects don\'t' : `${missing} of them don't`} have (those blocks will do nothing for them).`);
  }
  return out;
}

export function setTypeOfSelection(type: string) {
  const sel = store.get().selection, t = type.trim().replace(/[^A-Za-z0-9_ ]/g, '');
  if (!sel.length || !t) return;
  const report = changeTypeReport(store.get().project!, sel, t);
  if (report.length && typeof window !== 'undefined' && !window.confirm(`Change type to "${t}"?\n\n• ${report.join('\n• ')}\n\nNothing is deleted: behaviors, variables and settings stay.`)) return;
  updateSelected(`Change type to ${t}`, (i) => { i.type = t; });
}

export type CollisionMode = 'solid' | 'trigger' | 'passthrough' | 'physics' | 'none';
export const COLLISION_MODES: [CollisionMode, string][] = [['solid', 'Solid (walls, floors)'], ['physics', 'Physics body (falls, gets pushed)'], ['trigger', 'Trigger (detects, blocks nothing)'], ['passthrough', 'Pass-through (events only)'], ['none', 'No collision']];

/** One collision setup for the whole selection (movement behaviors are kept; Solid / Physics added or removed). */
export function setCollisionOfSelection(mode: CollisionMode) {
  updateSelected('Collision: ' + mode, (i) => {
    const drop = (t: string) => { i.behaviors = i.behaviors.filter((b) => b.type !== t); };
    const add = (t: string) => { if (!i.behaviors.some((b) => b.type === t)) i.behaviors.push({ type: t, props: behaviorDefaults(t) }); };
    const shape = i.collider.shape === 'none' ? (i.kind === 'sphere' ? 'sphere' : 'box') : i.collider.shape;
    i.collider = { ...i.collider, shape: mode === 'none' ? 'none' : shape, isTrigger: mode === 'trigger' || undefined, nonBlocking: mode === 'passthrough' || undefined };
    if (mode === 'solid') { add('solid'); drop('physics'); }
    else if (mode === 'physics') { add('physics'); drop('solid'); }
    else { drop('solid'); drop('physics'); }
  });
}

/** Put a picture on every selected object: sprites show it, everything else gets it as its Base color texture. */
export function applyTextureToSelection(asset: AssetRef) {
  registerAsset(asset);
  updateSelected('Apply texture', (i) => {
    if (i.kind === 'sprite') i.sprite = { ...(i.sprite ?? { frames: 1, fps: 8, animation: '' }), image: asset.id };
    else if (i.kind !== 'mesh' && i.kind !== 'light' && i.kind !== 'camera' && i.kind !== 'text') {
      const m = i.material ?? { roughness: 0.6, metalness: 0, emissive: '#000000', emissiveStrength: 0 };
      const maps = { ...(m.maps ?? {}) }; delete maps.color;
      i.material = { ...m, map: asset.id, maps };
    }
  });
}

/**
 * Swap the model of every selected object, keeping everything else: name, object type (so its events still apply),
 * behaviors, variables, transform and parent. The collider is refitted to the new model when it was a plain box.
 */
/** What replacing these objects' model would not carry over (their logic, behaviors and transform always stay). */
export function replaceModelReport(p: GameProject, uids: number[], asset: AssetRef): string[] {
  const s = curScene(p), objs = s.instances.filter((i) => uids.includes(i.uid)), out: string[] = [];
  const types = new Set(objs.map((i) => i.type));
  const blocks: BlockInstance[] = [];
  for (const sh of p.logic.sheets) walkEvents(sh.events, (n) => { if (n.kind === 'event') blocks.push(...n.conditions, ...n.actions); });
  const clipBlocks = blocks.filter((b) => b.target && types.has(b.target) && (b.block === 'anim.play' || b.block === 'anim.set_role' || b.block === 'anim.on_finished' || b.block === 'anim.is_playing')).length;
  const roles = objs.filter((i) => i.animRoles && Object.keys(i.animRoles).length).length;
  if (clipBlocks || roles) out.push(`Animation clip names belong to the old model: ${[clipBlocks && `${clipBlocks} animation block${clipBlocks === 1 ? '' : 's'}`, roles && `${roles} object${roles === 1 ? '' : 's'}' movement clips`].filter(Boolean).join(' and ')} may need the new model's clip names.`);
  const parts = blocks.filter((b) => b.target && types.has(b.target) && b.block === 'model.rotate_part').length;
  if (parts) out.push(`${parts} "Rotate model part" block${parts === 1 ? '' : 's'} name parts of the old model.`);
  const proc = objs.filter((i) => i.behaviors.some((b) => b.type === 'procanim' && b.props.boneMap)).length;
  if (proc) out.push(`Procedural Animation bone mapping (${proc} object${proc === 1 ? '' : 's'}) was made for the old skeleton: check it after replacing.`);
  const sprites = objs.filter((i) => i.kind === 'sprite').length;
  if (sprites) out.push(`${sprites} sprite${sprites === 1 ? '' : 's'} become 3D models: their picture and frames are no longer used.`);
  const compound = objs.filter((i) => i.collider.boxes?.length || (i.collider.shape !== 'box' && i.collider.shape !== 'none')).length;
  if (compound) out.push(`${compound} object${compound === 1 ? ' has' : 's have'} a custom collider shape, kept as it is (it may not fit the new model: regenerate it in Collision if needed).`);
  return out;
}

export function replaceModelOfSelection(asset: AssetRef) {
  const report = replaceModelReport(store.get().project!, store.get().selection, asset);
  if (report.length && typeof window !== 'undefined' && !window.confirm(`Replace the model with "${asset.name}"?\n\n• ${report.join('\n• ')}\n\nLogic, behaviors, variables, collision settings and the transform are kept.`)) return;
  registerAsset(asset);
  const size = asset.meta?.size;
  updateSelected(`Replace model with ${asset.name}`, (i) => {
    i.kind = 'mesh';
    i.mesh = { asset: asset.id, rotY: i.mesh?.rotY ?? 0, tint: i.mesh?.tint }; // clip names belong to the old model
    if (size && i.collider.shape === 'box' && !i.collider.boxes?.length) i.collider = { ...i.collider, size: [size[0], size[1], size[2]], offset: [0, size[1] / 2, 0] };
  });
}

export function worldOf(s: SceneData, i: InstanceData): [number, number, number] {
  if (i.parent == null) return [i.x, i.y, i.z];
  const p = s.instances.find((x) => x.uid === i.parent);
  if (!p) return [i.x, i.y, i.z];
  const w = worldOf(s, p);
  return [w[0] + i.x * p.sx, w[1] + i.y * p.sy, w[2] + i.z * p.sz];
}

export function updateSelected(label: string, fn: (i: InstanceData) => void, key?: string) {
  const sel = store.get().selection;
  store.mutate(label, (p) => { for (const i of curScene(p).instances) if (sel.includes(i.uid)) fn(i); }, key);
}

/** Store a tileset picture in the project (Assets › Tilesets). Returns its asset id. */
export async function addTilesetFile(projectId: string, f: File): Promise<string> {
  const rel = `imported/tilesets/${f.name.replace(/[^A-Za-z0-9_.-]/g, '_')}`;
  await api.putFile(projectId, rel, await f.arrayBuffer());
  const id = `proj:${rel}`;
  store.mutate('Import tileset', (p) => {
    if (!p.assets.some((a) => a.id === id)) p.assets.push({ id, name: f.name.replace(/\.[^.]+$/, ''), kind: 'texture', source: 'imported', folder: 'Tilesets', meta: { sourceFile: f.name, importedAt: new Date().toISOString() } } as AssetRef);
  });
  return id;
}

/** Store a video in the project, list it in the Assets panel and in the Videos list (Play video blocks). Returns its reference. */
/** Store a UI picture in the project (Pictures panel: transitions, dialogue look); also listed as a texture. */
export async function addPictureFile(projectId: string, f: File): Promise<string> {
  const rel = `imported/pictures/${f.name.replace(/[^A-Za-z0-9_.-]/g, '_')}`;
  await api.putFile(projectId, rel, await f.arrayBuffer());
  const id = `proj:${rel}`;
  store.mutate('Import picture', (p) => {
    if (!p.assets.some((a) => a.id === id)) p.assets.push({ id, name: f.name.replace(/\.[^.]+$/, ''), kind: 'texture', source: 'imported', folder: 'Pictures', meta: { sourceFile: f.name, importedAt: new Date().toISOString() } } as AssetRef);
  });
  return id;
}

export async function addVideoFile(projectId: string, f: File): Promise<string> {
  const rel = `imported/videos/${f.name.replace(/[^A-Za-z0-9_.-]/g, '_')}`;
  const local = URL.createObjectURL(f);
  const duration = await new Promise<number>((res) => {
    const v = document.createElement('video'); v.preload = 'metadata'; v.muted = true;
    v.onloadedmetadata = () => res(Number.isFinite(v.duration) ? Math.round(v.duration * 100) / 100 : 0);
    v.onerror = () => res(0); setTimeout(() => res(0), 8000); v.src = local;
  });
  URL.revokeObjectURL(local);
  await api.putFile(projectId, rel, await f.arrayBuffer());
  const id = `proj:${rel}`;
  const base = f.name.replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9_ -]+/g, '').trim().replace(/\s+/g, '_') || 'Video';
  store.mutate('Import video', (p) => {
    if (!p.assets.some((a) => a.id === id)) p.assets.push({ id, name: base, kind: 'video', source: 'imported', meta: { sourceFile: f.name, importedAt: new Date().toISOString() } });
    const vids = (p.logic.videos ??= []);
    if (!vids.some((v) => v.ref === id)) { let n = base, k = 2; while (vids.some((v) => v.name.toLowerCase() === n.toLowerCase())) n = `${base}_${k++}`; vids.push({ name: n, ref: id, duration: duration || undefined }); }
  });
  return id;
}

export function makePrefab() {
  const [first] = store.selected();
  if (!first) return;
  store.mutate('Create prefab', (p) => {
    const s = curScene(p);
    const children = s.instances.filter((i) => isDescendantOf(s, i, [first.uid]));
    p.prefabs = p.prefabs.filter((x) => x.name !== first.type);
    p.prefabs.push({ name: first.type, instance: deepClone(first), children: deepClone(children), created: new Date().toISOString() });
    const t = s.objectTypes.find((x) => x.name === first.type);
    const { uid: _u, ...tpl } = deepClone(first) as any;
    if (t) t.template = tpl; else s.objectTypes.push({ name: first.type, kind: first.kind, vars: Object.entries(first.vars).map(([name, value]) => ({ name, type: typeof value === 'number' ? 'number' : typeof value === 'boolean' ? 'boolean' : 'string', value } as any)), template: tpl });
  });
  store.log('info', `Prefab "${first.type}" saved. Drag it from Assets › Prefabs, or spawn it with "Create object".`);
}

export function placePrefab(name: string, at?: [number, number, number]) {
  const p = store.get().project; if (!p) return;
  const pf = p.prefabs.find((x) => x.name === name); if (!pf) return;
  let root = 0;
  store.mutate(`Place ${name}`, (pp) => {
    const s = curScene(pp);
    let uid = nextUid(s);
    const map = new Map<number, number>([[pf.instance.uid, uid++]]);
    for (const c of pf.children) map.set(c.uid, uid++);
    const r = deepClone(pf.instance); r.uid = map.get(pf.instance.uid)!; r.parent = undefined; r.name = uniqueName(s, pf.instance.name);
    if (at) { r.x = at[0]; r.y = at[1]; r.z = at[2]; }
    s.instances.push(r); root = r.uid;
    for (const c of pf.children) { const cc = deepClone(c); cc.uid = map.get(c.uid)!; cc.parent = c.parent != null ? map.get(c.parent) : r.uid; s.instances.push(cc); }
  });
  store.set({ selection: [root] });
}

export function addBehavior(type: string) {
  updateSelected(`Add ${type} behavior`, (i) => {
    if (i.behaviors.some((b) => b.type === type)) return;
    i.behaviors.push({ type, props: behaviorDefaults(type) });
    if (type === 'water') applyWaterLook(i);
  });
}

/** Object types in the current scene, summarized for the logic editors. */
export function typeSummaries(s: SceneData) {
  const map = new Map<string, { name: string; kind: string; vars: any[]; behaviors: Set<string>; color?: string }>();
  for (const t of s.objectTypes) map.set(t.name.toLowerCase(), { name: t.name, kind: t.kind, vars: [...t.vars], behaviors: new Set(t.template?.behaviors.map((b) => b.type) ?? []), color: t.template?.color });
  for (const i of s.instances) {
    let e = map.get(i.type.toLowerCase());
    if (!e) { e = { name: i.type, kind: i.kind, vars: [], behaviors: new Set(), color: i.color }; map.set(i.type.toLowerCase(), e); }
    e.color ??= i.color;
    for (const b of i.behaviors) e.behaviors.add(b.type);
    for (const [k, v] of Object.entries(i.vars)) if (!e.vars.some((x) => x.name === k)) e.vars.push({ name: k, type: typeof v === 'number' ? 'number' : typeof v === 'boolean' ? 'boolean' : 'string', value: v });
  }
  return [...map.values()].map((e) => ({ ...e, behaviors: [...e.behaviors] })).sort((a, b) => a.name.localeCompare(b.name));
}
