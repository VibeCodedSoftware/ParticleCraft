// Saved games (blocks Save game / Load game, the Pause menu's Save button): the scene, the global variables and every
// game object as it is now (position, rotation, size, speed, variables, behavior settings and the plain part of its
// behavior state such as health), in a named slot of the host's storage (the browser's / the player app's local
// storage). Screen (HUD) texts and buttons are not saved, so a game saved from the pause menu does not load with
// the menu showing. Loading a save of another scene switches to that scene first, then applies it.
import type { InstanceData } from './scene';
import type { RInstance } from './world';

export interface SavedGame {
  format: 'craft.save'; version: 1;
  scene: string;
  /** Wall-clock time of the save (ms since 1970), for "saved 5 minutes ago" texts. */
  savedAt: number;
  /** Game time when saved (seconds). */
  time: number;
  globals: Record<string, any>;
  instances: (InstanceData & { vx: number; vy: number; vz: number; state?: Record<string, any>; animation?: string })[];
  /** Bullet holes, blood and paint on the surfaces, with how old each one is. */
  decals?: (Record<string, any> & { age: number })[];
}

/** Interface the save code needs from the runtime (kept small so this module has no runtime import). */
export interface SaveHost {
  scene: { name: string };
  time: number;
  globals: Record<string, any>;
  globalDefs: Map<string, { isConstant?: boolean }>;
  world: { instances: RInstance[]; restore(remove: RInstance[], saved: InstanceData[]): RInstance[] };
  initInstance(inst: RInstance): void;
  decals?: any[]; decalSeq?: number;
}

export const SAVE_PREFIX = 'craft.game.';

/** Screen texts and buttons stay as they are (menus, HUD): only game objects are saved and loaded. */
const isScreen = (i: InstanceData) => !!(i.kind === 'text' && i.text?.hud);

/** Only plain data (numbers, strings, booleans, arrays and objects of them) survives into a save. */
function plain(v: unknown, depth = 0): unknown {
  if (v == null || typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') return typeof v === 'number' && !Number.isFinite(v) ? 0 : v;
  if (depth > 6) return undefined;
  if (Array.isArray(v)) { const out = v.map((x) => plain(x, depth + 1)); return out.some((x) => x === undefined) ? undefined : out; }
  if (typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype) {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) { const p = plain(x, depth + 1); if (p !== undefined) out[k] = p; }
    return out;
  }
  return undefined; // Sets, Maps, class instances, functions: rebuilt by the behavior
}

const RUNTIME_ONLY = new Set(['iid', 'destroyed', 'state', 'animFinished']);

export function snapshotGame(rt: SaveHost): SavedGame {
  const globals: Record<string, any> = {};
  for (const [k, v] of Object.entries(rt.globals)) if (!rt.globalDefs.get(k)?.isConstant) { const p = plain(v); if (p !== undefined) globals[k] = p; }
  const instances = rt.world.instances.filter((i) => !i.destroyed && !isScreen(i)).map((i) => {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(i)) if (!RUNTIME_ONLY.has(k)) { const p = plain(v); if (p !== undefined) out[k] = p; }
    out.state = plain(i.state) ?? {};
    return out as SavedGame['instances'][number];
  });
  const decals = (rt.decals ?? []).map(({ id: _id, born, ...d }) => ({ ...d, age: rt.time - born }));
  return { format: 'craft.save', version: 1, scene: rt.scene.name, savedAt: Date.now(), time: rt.time, globals, instances, decals };
}

export function parseSave(raw: string | null): SavedGame | null {
  if (!raw) return null;
  try { const s = JSON.parse(raw); return s?.format === 'craft.save' && Array.isArray(s.instances) ? s : null; } catch { return null; }
}

/** Put a save into the running scene: globals, and the game objects replaced by the saved ones. */
export function applySave(rt: SaveHost, s: SavedGame) {
  for (const [k, v] of Object.entries(s.globals)) if (k in rt.globals && !rt.globalDefs.get(k)?.isConstant) rt.globals[k] = v;
  const remove = rt.world.instances.filter((i) => !isScreen(i));
  const saved = s.instances.map(({ state: _s, vx: _x, vy: _y, vz: _z, animation: _a, ...d }) => d as InstanceData);
  const added = rt.world.restore(remove, saved);
  added.forEach((inst, k) => {
    const src = s.instances[k];
    rt.initInstance(inst);
    // Behavior state after init: what the behavior set up, overlaid with what was saved (health, ammo, timers…).
    Object.assign(inst.state, src.state ?? {});
    inst.vx = src.vx ?? 0; inst.vy = src.vy ?? 0; inst.vz = src.vz ?? 0;
    if (src.animation) inst.animation = src.animation;
  });
  // Marks come back at the age they had (fresh ids: the renderer may still hold the marks being replaced).
  if (rt.decals) rt.decals = (s.decals ?? []).map(({ age, ...d }) => ({ ...d, id: (rt.decalSeq = (rt.decalSeq ?? 0) + 1), born: rt.time - age }));
}
