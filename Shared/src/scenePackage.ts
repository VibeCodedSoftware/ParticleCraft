// A LogicCraft project as scenes for GameCraft: its stage and other scenes, their logic and everything they use, in one
// file. Adding it to a project keeps what is already there: its scenes, sheets and variables are never changed.
import { deepClone, newId, type EventSheet, type LogicDocument } from './schema';
import { DEFAULT_ACTIONS } from './runtime/input';
import { migrateDocument } from './validate';
import type { SceneData } from './runtime/scene';
import type { EmitterParams } from './runtime/particles';

export const SCENE_PACKAGE_FORMAT = 'craft.scene.package';
export const SCENE_PACKAGE_VERSION = 1;
export const SCENE_FILE_SUFFIX = '.scene.json';
/** Logic packages and other files in the exchange folder are not scenes: each list shows its own kind. */
export const isSceneFile = (name: string) => name.toLowerCase().endsWith(SCENE_FILE_SUFFIX);

export interface ScenePackage {
  format: typeof SCENE_PACKAGE_FORMAT; schemaVersion: number; sourceApp: 'logiccraft' | 'worldcraft'; exported: string;
  name: string;
  /** Stage first: the scene the game starts in when it becomes a new project. */
  scenes: SceneData[];
  logic: LogicDocument;
  /** Imported pictures (name to data URL), used as "img:<name>". */
  images: Record<string, string>;
  /** The project's other files ("proj:<path>", such as videos and sounds; path to data URL). */
  files: Record<string, string>;
  particlePresets?: Record<string, EmitterParams>;
}

export interface ScenePackageSource {
  name: string; logic: LogicDocument; stage: SceneData; scenes?: SceneData[]; images?: Record<string, string>; particlePresets?: Record<string, EmitterParams>;
}

export function makeScenePackage(p: ScenePackageSource, files: Record<string, string> = {}): ScenePackage {
  const others = (p.scenes ?? []).filter((s) => s.id !== p.stage.id);
  return deepClone({
    format: SCENE_PACKAGE_FORMAT, schemaVersion: SCENE_PACKAGE_VERSION, sourceApp: 'logiccraft', exported: new Date().toISOString(),
    name: p.name, scenes: [p.stage, ...others], logic: p.logic, images: p.images ?? {}, files, particlePresets: p.particlePresets,
  }) as ScenePackage;
}

export const scenePackageFileName = (name: string) => (name.replace(/[^A-Za-z0-9_-]+/g, '_') || 'scene') + SCENE_FILE_SUFFIX;

export function parseScenePackage(raw: unknown): ScenePackage {
  const pkg = (typeof raw === 'string' ? JSON.parse(raw) : raw) as ScenePackage;
  if (!pkg || pkg.format !== SCENE_PACKAGE_FORMAT) throw new Error('This file is not a scene from LogicCraft or WorldCraft.');
  if (pkg.schemaVersion > SCENE_PACKAGE_VERSION) throw new Error('This scene was exported by a newer version. Update GameCraft.');
  if (!pkg.scenes?.length || !pkg.logic) throw new Error('This scene file is incomplete.');
  return { ...pkg, images: pkg.images ?? {}, files: pkg.files ?? {}, logic: migrateDocument(pkg.logic).doc };
}

/** Every "proj:<path>" the project mentions: these files have to travel with it. */
export function projectFilesUsed(p: ScenePackageSource): string[] {
  const found = new Set<string>();
  const re = /proj:([^"'\s\\]+)/g;
  const text = JSON.stringify([p.stage, p.scenes ?? [], p.logic, p.particlePresets ?? {}]);
  for (let m = re.exec(text); m; m = re.exec(text)) found.add(m[1]);
  return [...found];
}

const NOT_EMOJI = /^(img:|proc:|lib:|proj:|data:)/;
/** A sprite drawn with an emoji: LogicCraft paints the character, GameCraft needs a picture of it. */
export const isEmojiImage = (s: unknown): s is string => typeof s === 'string' && s.length > 0 && !NOT_EMOJI.test(s);

const costumeLiteral = /^"(.+)"$/;
function eachSetCostume(sheets: EventSheet[], fn: (b: { params: Record<string, unknown> }) => void) {
  const walk = (n: unknown): void => {
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (!n || typeof n !== 'object') return;
    const o = n as { block?: string; params?: Record<string, unknown> };
    if (o.block === 'sprite.set_costume' && o.params) fn(o as { params: Record<string, unknown> });
    Object.values(n).forEach(walk);
  };
  walk(sheets);
}

/** What has to become a file in the GameCraft project. */
export interface PackageAsset { ref: string; name: string; rel: string; dataUrl?: string; emoji?: string }
export function packageAssets(pkg: ScenePackage): PackageAsset[] {
  const folder = 'imported/logiccraft/' + (pkg.name.replace(/[^A-Za-z0-9_-]+/g, '_') || 'scene');
  const safe = (s: string) => s.replace(/[^A-Za-z0-9_.-]+/g, '_') || 'file';
  const ext = (url: string) => /^data:image\/(png|jpeg|jpg|gif|webp)/i.exec(url)?.[1]?.toLowerCase().replace('jpeg', 'jpg') ?? 'png';
  const out: PackageAsset[] = [];
  for (const [name, dataUrl] of Object.entries(pkg.images)) out.push({ ref: 'img:' + name, name, dataUrl, rel: `${folder}/${safe(name).replace(/\.[a-z0-9]+$/i, '')}.${ext(dataUrl)}` });
  for (const [rel, dataUrl] of Object.entries(pkg.files)) out.push({ ref: 'proj:' + rel, name: rel.split('/').pop()!.replace(/\.[^.]+$/, ''), dataUrl, rel: `${folder}/${rel}` });
  const emoji = new Set<string>();
  for (const s of pkg.scenes) for (const i of s.instances) {
    if (i.kind !== 'sprite' || !i.sprite) continue;
    if (isEmojiImage(i.sprite.image)) emoji.add(i.sprite.image);
    for (const c of i.sprite.costumes ?? []) if (isEmojiImage(c)) emoji.add(c);
  }
  eachSetCostume(pkg.logic.sheets, (b) => { const m = costumeLiteral.exec(String(b.params.costume ?? '')); if (m && isEmojiImage(m[1])) emoji.add(m[1]); });
  for (const e of emoji) out.push({ ref: e, name: 'emoji ' + e, emoji: e, rel: `${folder}/emoji_${[...e].map((c) => c.codePointAt(0)!.toString(16)).join('_')}.png` });
  return out;
}

export interface ProjectLike { logic: LogicDocument; scenes: SceneData[]; particlePresets: Record<string, EmitterParams> }
export interface MergeReport { sceneIds: string[]; renamedScenes: [string, string][]; keptVariables: string[]; keptEffects: string[] }

const uniqueName = (name: string, taken: Set<string>) => {
  if (!taken.has(name.toLowerCase())) return name;
  for (let n = 2; ; n++) { const c = `${name} ${n}`; if (!taken.has(c.toLowerCase())) return c; }
};

/**
 * Add the package's scenes to a project. `assetId` gives the project's id for each PackageAsset.ref.
 * Names the project already uses keep the project's meaning (its variables, effects and functions are not overwritten).
 */
export function mergeScenePackage(target: ProjectLike, pkg: ScenePackage, assetId: (ref: string) => string | undefined): MergeReport {
  const report: MergeReport = { sceneIds: [], renamedScenes: [], keptVariables: [], keptEffects: [] };
  // Pictures and files: from LogicCraft's names to this project's.
  const refs = packageAssets(pkg).map((a) => ({ ref: a.ref, id: assetId(a.ref), emoji: !!a.emoji })).filter((r): r is { ref: string; id: string; emoji: boolean } => !!r.id);
  const named = refs.filter((r) => !r.emoji).sort((a, b) => b.ref.length - a.ref.length), emoji = new Map(refs.filter((r) => r.emoji).map((r) => [r.ref, r.id]));
  const inText = (s: string) => { let out = s; if (out.includes('img:') || out.includes('proj:')) for (const r of named) out = out.split(r.ref).join(r.id); return out; };
  const walk = <T>(v: T): T => {
    if (typeof v === 'string') return inText(v) as T;
    if (Array.isArray(v)) return v.map(walk) as T;
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)])) as T;
    return v;
  };
  const scenes = walk(deepClone(pkg.scenes));
  const logic = walk(deepClone(pkg.logic));
  for (const s of scenes) for (const i of s.instances) {
    const sp = i.sprite;
    if (sp) {
      if (emoji.has(sp.image)) sp.image = emoji.get(sp.image)!;
      if (sp.costumes) sp.costumes = sp.costumes.map((c) => emoji.get(c) ?? c);
    }
    if (i.tilemap?.tileset) { const id = assetId('img:' + i.tilemap.tileset); if (id) i.tilemap.tileset = id; }
  }
  eachSetCostume(logic.sheets, (b) => { const m = costumeLiteral.exec(String(b.params.costume ?? '')); if (m && emoji.has(m[1])) b.params.costume = `"${emoji.get(m[1])}"`; });

  // Scene names must be unique, as Load scene finds them by name: its blocks follow any rename.
  const taken = new Set(target.scenes.map((s) => s.name.toLowerCase()));
  const renames = new Map<string, string>();
  for (const s of scenes) {
    const name = uniqueName(s.name, taken);
    taken.add(name.toLowerCase());
    if (name !== s.name) { renames.set(s.name, name); report.renamedScenes.push([s.name, name]); s.name = name; }
  }
  const followRenames = (n: unknown): void => {
    if (Array.isArray(n)) { n.forEach(followRenames); return; }
    if (!n || typeof n !== 'object') return;
    const o = n as { block?: string; params?: Record<string, unknown>; scene?: unknown };
    if (o.block === 'game.load_scene' && o.params) {
      const p = String(o.params.scene ?? ''), m = costumeLiteral.exec(p);
      const was = m ? m[1] : p;
      if (renames.has(was)) o.params.scene = m ? `"${renames.get(was)}"` : renames.get(was);
    }
    if (typeof o.scene === 'string' && renames.has(o.scene)) o.scene = renames.get(o.scene);
    Object.values(n).forEach(followRenames);
  };
  followRenames(logic.sheets); followRenames(logic.dialogues ?? []);

  // Sheets: ids must not clash with what the project has (the same scene can be added twice).
  const used = new Set<string>();
  const note = (n: unknown): void => {
    if (Array.isArray(n)) { n.forEach(note); return; }
    if (!n || typeof n !== 'object') return;
    const o = n as { id?: unknown };
    if (typeof o.id === 'string') used.add(o.id);
    Object.values(n).forEach(note);
  };
  note(target.logic.sheets);
  const sheetIds = new Map<string, string>();
  for (const sh of logic.sheets) {
    const nodeIds = new Map<string, string>();
    const fresh = (n: unknown): void => {
      if (Array.isArray(n)) { n.forEach(fresh); return; }
      if (!n || typeof n !== 'object') return;
      const o = n as { id?: string; block?: unknown; kind?: unknown };
      if (typeof o.id === 'string' && (o.block !== undefined || o.kind !== undefined) && used.has(o.id)) { const id = newId('n'); nodeIds.set(o.id, id); o.id = id; }
      Object.values(n).forEach(fresh);
    };
    fresh(sh.events);
    if (sh.layout) sh.layout = Object.fromEntries(Object.entries(sh.layout).map(([k, v]) => [nodeIds.get(k) ?? k, v]));
    const was = sh.id;
    sh.id = used.has(was) ? newId('sheet') : was;
    used.add(sh.id);
    sheetIds.set(was, sh.id);
    const names = new Set(target.logic.sheets.map((x) => x.name.toLowerCase()));
    sh.name = uniqueName(sh.name, names);
    target.logic.sheets.push(sh);
  }
  for (const sh of logic.sheets) if (sh.includes) sh.includes = sh.includes.map((id) => sheetIds.get(id) ?? id);

  for (const s of scenes) {
    if (target.scenes.some((x) => x.id === s.id)) s.id = 'scene_' + Math.random().toString(36).slice(2, 9);
    // A scene with no sheet would run the project's first one: it must run its own.
    s.sheetId = sheetIds.get(s.sheetId ?? logic.sheets[0]?.id ?? '') ?? sheetIds.values().next().value;
    target.scenes.push(s);
    report.sceneIds.push(s.id);
  }

  const t = target.logic;
  for (const g of logic.globals) {
    const had = t.globals.find((x) => x.name === g.name);
    if (!had) t.globals.push(g);
    else if (JSON.stringify(had.value) !== JSON.stringify(g.value)) report.keptVariables.push(g.name);
  }
  const addNew = <X extends { name: string }>(have: X[] | undefined, more: X[] | undefined): X[] | undefined => {
    if (!more?.length) return have;
    const list = have ?? [];
    for (const x of more) if (!list.some((y) => y.name === x.name)) list.push(x);
    return list;
  };
  t.functions = addNew(t.functions, logic.functions) ?? [];
  t.dialogues = addNew(t.dialogues, logic.dialogues);
  t.videos = addNew(t.videos, logic.videos);
  t.pictures = addNew(t.pictures, logic.pictures);
  if (logic.inputActions) {
    // Absent means the default set: writing only the new ones would take those away from the project's other scenes.
    const actions: Record<string, string[]> = { ...(t.inputActions ?? DEFAULT_ACTIONS) };
    for (const [k, v] of Object.entries(logic.inputActions)) if (!actions[k]) actions[k] = v;
    t.inputActions = actions;
  }
  if (logic.sounds) {
    const s = (t.sounds ??= { custom: {}, files: {}, settings: {} } as NonNullable<LogicDocument['sounds']>) as unknown as Record<string, Record<string, unknown> | undefined>;
    for (const [part, vals] of Object.entries(logic.sounds as unknown as Record<string, unknown>)) {
      if (!vals || typeof vals !== 'object' || Array.isArray(vals)) continue;
      const into = (s[part] ??= {});
      for (const [k, v] of Object.entries(vals)) if (!(k in into)) into[k] = v;
    }
  }
  for (const [k, v] of Object.entries(walk(deepClone(pkg.particlePresets ?? {})))) {
    if (!target.particlePresets[k]) target.particlePresets[k] = v;
    else if (JSON.stringify(target.particlePresets[k]) !== JSON.stringify(v)) report.keptEffects.push(k);
  }
  return report;
}

/** A data URL's bytes. */
export function dataUrlBytes(url: string): ArrayBuffer {
  const at = url.indexOf(',');
  const body = url.slice(at + 1);
  if (!/;base64$/i.test(url.slice(0, at))) return new TextEncoder().encode(decodeURIComponent(body)).buffer as ArrayBuffer;
  const bin = atob(body), out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}
