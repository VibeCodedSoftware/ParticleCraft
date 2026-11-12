// Runtime implementation of every shared block. One implementation serves both apps, which is what
// makes GameCraft and LogicCraft agree on block meaning. tests/blocks.test.ts checks full coverage.
import { clockSeed } from './rng';
import type { BlockInstance } from '../schema';
import { compareValues, toNum, toStr, truthy } from '../expr';
import type { Ctx, Runtime } from './runtime';
import type { RInstance } from './world';
import { BEHAVIORS, behaviorDefaults, requestPath, lineOfSight } from './behaviors';
import { raycast } from './physics';
import { cutHole, type CutShape } from './boolean';
import { procState, startRagdoll } from './procAnim';
import { generate3D, generateIntoTilemap, populateRooms, roomCellWorld, roomSpot, type RoomsState } from './roomsRuntime';
import type { RoomsOptions } from '../rooms';
import { applyCameraView } from '../cameraView';
import type { CameraPresetId } from '../cameraPresets';
import { readPaths } from '../blocks/pathParam';
import { mic, webcam } from './devices';
import { releaseRope } from './rope';

/** A picture parameter (a Pictures panel name), or undefined when empty. */
const pic = (b: BlockInstance, k: string) => String(b.params[k] ?? '').trim() || undefined;

/** Generate rooms / Build 3D rooms options from a block's parameters. */
function roomOpts(rt: Runtime, b: BlockInstance, ctx: Ctx): Partial<RoomsOptions> {
  return { seed: Math.round(N(rt, b, ctx, 'seed')) || 1, rooms: Math.max(1, Math.round(N(rt, b, ctx, 'rooms'))), width: Math.round(N(rt, b, ctx, 'width')), height: Math.round(N(rt, b, ctx, 'height')), style: b.params.style === 'cave' ? 'cave' : 'rooms' };
}

/** The built-in bullet hole picture (GameCraft asset library). */
/** Save / Load variables › Only these: lower-case names, or null for all. */
function onlyList(b: { params: Record<string, any> }): Set<string> | null {
  const names = String(b.params.only ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  return names.length ? new Set(names) : null;
}
const safeJson = (raw: string | null): Record<string, any> => { try { const j = JSON.parse(raw ?? '{}'); return j && typeof j === 'object' ? j : {}; } catch { return {}; } };

/** An action block's Player choice ("player 2" → 2; "any player" / "every player" / missing → undefined). */
function playerParam(b: { params: Record<string, any> }): number | undefined {
  const m = /([1-4])/.exec(String(b.params.player ?? ''));
  return m ? Number(m[1]) : undefined;
}

export const BULLET_HOLE ='lib:library/effects/BulletHole.png';

/**
 * Stick a picture (bullet hole) or a paint mark (no picture: a soft round blob in `color`) on an object's surface at a
 * world point; it moves with the object. `life` seconds (0 = stays), `pool` keeps its own newest `max` marks (bullet
 * holes 64; paint trails and paint guns their own), so one kind never pushes out the other.
 */
export function addDecal(rt: Runtime, on: RInstance, point: [number, number, number], normal: [number, number, number], image: string, size: number,
  o: { color?: string; alpha?: number; life?: number; pool?: string; max?: number } = {}) {
  const [x, y, z] = rt.world.worldPos(on);
  const pool = o.pool ?? 'holes', max = Math.max(1, o.max ?? 64);
  rt.decals.push({ id: ++rt.decalSeq, uid: on.uid, offset: [point[0] - x, point[1] - y, point[2] - z], normal, image, size, born: rt.time, color: o.color, alpha: o.alpha ?? 1, life: o.life ?? 30, pool });
  const mine = rt.decals.filter((d) => (d.pool ?? 'holes') === pool);
  if (mine.length > max) { const drop = new Set(mine.slice(0, mine.length - max)); rt.decals = rt.decals.filter((d) => !drop.has(d)); }
}
import { VOXEL, cellCenter, editSphere, voxelRaycast } from './voxel';
import { POSTFX_PRESETS, makeEffect } from '../postfx';
import { planeAB } from './pathfinding';
import { BLOCK_DEFS } from '../blocks/definitions';
import { chooseDialogue, continueDialogue, endDialogue, jumpDialogue, runCodeBlock, startDialogue } from './story';
import { customVfxExposed, linkEmitters } from './particles';
import { DEFAULT_SKY, isNight } from './sky';
import { OBJECT_FX, makeObjectFx, type ObjectFxType } from '../objectFx';
import { enterVehicle, exitVehicle, partAngle, type PartSwing } from './vehicle';
import { bleeds, bloodSplatter, bulletMark } from './marks';
import { LOCKON_ACTIONS, LOCKON_CONDITIONS } from './lockon';
import { GRID_ACTIONS, GRID_CONDITIONS } from './gridTurns';

type CondImpl = {
  test?: (rt: Runtime, b: BlockInstance, ctx: Ctx, inst?: RInstance) => any;
  pick?: (rt: Runtime, b: BlockInstance, ctx: Ctx, candidates: RInstance[]) => RInstance[];
};
type ActImpl = (rt: Runtime, b: BlockInstance, ctx: Ctx, inst?: RInstance) => void;
type LoopImpl = (rt: Runtime, b: BlockInstance, ctx: Ctx, body: (c: Ctx) => void) => void;

const P = (rt: Runtime, b: BlockInstance, ctx: Ctx, n: string) => rt.param(b, n, ctx);
const N = (rt: Runtime, b: BlockInstance, ctx: Ctx, n: string) => toNum(rt.param(b, n, ctx));
const S = (rt: Runtime, b: BlockInstance, ctx: Ctx, n: string) => toStr(rt.param(b, n, ctx));
const always = { test: () => true };
/** The cameras a view brick switches between, in the order they were added. */
export function camerasOf(rt: Runtime, group: string): RInstance[] {
  const g = group.trim().toLowerCase();
  return rt.world.instances.filter((c) => !c.destroyed && c.camera && (!g || c.type.toLowerCase() === g)).sort((a, b) => a.uid - b.uid);
}
function showCamera(rt: Runtime, cam: RInstance) {
  if (cam.camera?.active) return;
  for (const c of rt.world.instances) if (c.camera) c.camera.active = c === cam;
  rt.postfxVersion++;
  rt.queueTrigger('camera.on_view_changed', {});
}

function addPick(ctx: Ctx, inst: RInstance) {
  if (!ctx.pickAdd) return;
  const k = inst.type.toLowerCase();
  let s = ctx.pickAdd.get(k);
  if (!s) ctx.pickAdd.set(k, (s = new Set()));
  s.add(inst);
}

function movementBehavior(rt: Runtime, inst: RInstance) {
  return inst.behaviors.find((b) => ['platform', 'eightdir', 'car', 'pathfinding', 'bullet'].includes(b.type));
}

function emittersOf(rt: Runtime, inst: RInstance) {
  return [...rt.emitters.values()].filter((e) => e.id === `inst:${inst.uid}` || e.id.startsWith(`inst:${inst.uid}#`) || e.id.startsWith(`att:${inst.uid}:`));
}

/** One-shot copy of every layer of an effect (ParticleCraft effects can have several systems). */
/** A one-shot burst of a particle preset (all its layers) at a point; color recolours it (start → a darker end). */
export function spawnLayers(rt: Runtime, preset: string, pos: [number, number, number], heading = 0, color?: string) {
  const id = `fx:${rt.fxCounter++}`;
  linkEmitters(rt.presetLayers(preset).map((name, k) => {
    const e = rt.makeEmitter(k ? `${id}#${k + 1}` : id, name);
    e.position = pos; e.heading = heading;
    if (color) e.params = { ...e.params, colorStart: color, colorEnd: color };
    e.autoRemove = true; if (e.params.looping) { e.params = { ...e.params, looping: false, duration: Math.max(0.5, e.params.duration) }; }
    rt.emitters.set(e.id, e);
    return e;
  }));
}

function ensureBehavior(rt: Runtime, inst: RInstance, type: string, props: Record<string, any> = {}) {
  let b = rt.world.behavior(inst, type);
  if (!b) {
    b = { type, props: { ...behaviorDefaults(type), ...props } };
    inst.behaviors.push(b);
    BEHAVIORS[type]?.init?.(inst, rt);
  }
  return b;
}

export function damage(rt: Runtime, inst: RInstance, amount: number) {
  // A follower can be set not to take damage.
  if (rt.world.behavior(inst, 'follower')?.props.takesDamage === false) return false;
  // Breakables without Health wear down their durability instead.
  if (!inst.state.health && inst.state.breakable) return rt.breakableDamage(inst, amount);
  const st = inst.state.health;
  if (!st || st.dead || amount <= 0) return false;
  if (st.invuln > 0) return false;
  st.hp = Math.max(0, st.hp - amount);
  st.invuln = Number(rt.world.behavior(inst, 'health')?.props.invulnerableTime ?? 0);
  st.hitT = 0.4; // renderer plays the model's "hit" animation role meanwhile
  rt.queueTrigger('health.on_damaged', { [inst.type]: [inst] });
  rt.queueTrigger('health.on_healed', { [inst.type]: [inst] });
  if (st.hp <= 0) { st.dead = true; rt.queueTrigger('health.on_died', { [inst.type]: [inst] }); }
  return true;
}

/**
 * Stage edges for go-to-random / bounce: the scene bounds when set, else the area the active 2D camera shows
 * (LogicCraft's 4:3 stage), else ±10 m around the origin.
 */
function stageBounds(rt: Runtime): { minX: number; maxX: number; minY: number; maxY: number } {
  const b = rt.scene.settings.bounds, xz = rt.world.plane === 'xz';
  if (b) return { minX: b.min[0], maxX: b.max[0], minY: xz ? b.min[2] : b.min[1], maxY: xz ? b.max[2] : b.max[1] };
  const cam = rt.activeCamera();
  if (!xz && cam?.camera) { const w = cam.camera.orthoScale, h = w * 0.75; return { minX: cam.x - w / 2, maxX: cam.x + w / 2, minY: cam.y - h / 2, maxY: cam.y + h / 2 }; }
  return { minX: -10, maxX: 10, minY: -10, maxY: 10 };
}

/** Size in percent of the object's starting scale (Scratch "size"). */
function baseScale(i: RInstance): [number, number, number] { return (i.state.baseScale ??= [i.sx, i.sy, i.sz]); }
function sizePercent(i: RInstance) { const b = baseScale(i); return b[0] ? (i.sx / b[0]) * 100 : 100; }
function setSizePercent(i: RInstance, b: [number, number, number], pct: number) { const k = Math.max(0, pct) / 100; i.sx = b[0] * k; i.sy = b[1] * k; i.sz = b[2] * k; }

/** Speech / thought bubble shown by the renderers above the object; seconds 0 keeps it until replaced. */
function bubble(rt: Runtime, i: RInstance, kind: 'say' | 'think', text: string, seconds: number) {
  i.state.bubble = text ? { kind, text, until: seconds > 0 ? rt.time + seconds : Infinity } : undefined;
}

/** Aim ray: the active camera's view (first person, pitch included) or, without one, the object's facing. */
/** Paint lands: a coloured mark on what was hit (kept with the paint-gun marks), a splash, and On painted. */
function paintHit(rt: Runtime, on: RInstance, point: [number, number, number], normal: [number, number, number], color: string, size: number, impact: string) {
  addDecal(rt, on, point, normal, '', Math.max(0.05, size) * (0.85 + rt.rng.next() * 0.3), { color: color || '#ff3b8d', alpha: 0.95, life: 0, pool: 'paintgun', max: 500 });
  if (impact && impact !== 'none') spawnLayers(rt, impact, [point[0] + normal[0] * 0.05, point[1] + normal[1] * 0.05, point[2] + normal[2] * 0.05], 0, color);
  rt.queueTrigger('paint.on_painted', { [on.type]: [on] });
}
function viewRay(rt: Runtime, i: RInstance): [[number, number, number], [number, number, number]] {
  const cam = rt.activeCamera();
  const la = cam?.state.lookAt as [number, number, number] | undefined;
  if (cam && la) return [[cam.x, cam.y, cam.z], [la[0] - cam.x, la[1] - cam.y, la[2] - cam.z]];
  const [sx, , sz] = rt.world.worldPos(i);
  const bb = rt.world.aabb(i);
  const f = rt.world.forward(rt.world.angle(i));
  return [[sx, (bb[1] + bb[4]) / 2, sz], [f[0], f[1], f[2]]];
}

/** Dig (material 0) or build at the terrain cell the view points at; records the result in the terrain's variables. */
function voxelEditView(rt: Runtime, terrain: RInstance, b: BlockInstance, ctx: Ctx, build: boolean) {
  const g = rt.world.voxelGrid(terrain);
  if (!g) throw new Error(`${terrain.name} is not voxel terrain`);
  const shooter = rt.picked(ctx, String(b.params.from ?? 'Player'))[0] ?? terrain;
  const [o, d] = viewRay(rt, shooter);
  const hit = voxelRaycast(g, o, d, N(rt, b, ctx, 'reach'));
  terrain.vars.lastDug = 0; terrain.vars.lastGold = 0;
  if (!hit) return;
  const r = N(rt, b, ctx, 'radius');
  const c = cellCenter(g, hit.cell);
  // Building fills the air next to the face that was hit, and never inside the player or other solids.
  const center: [number, number, number] = build ? [c[0] + hit.normal[0] * g.cell, c[1] + hit.normal[1] * g.cell, c[2] + hit.normal[2] * g.cell] : hit.point;
  const keep = build ? rt.world.instances.filter((x) => !x.destroyed && x !== terrain && x.collider.shape !== 'none' && !x.collider.isTrigger && (x === shooter || rt.world.hasBehavior(x, 'solid') || rt.world.hasBehavior(x, 'physics'))).map((x) => rt.world.aabb(x)) : [];
  const changed = editSphere(g, center, r, build ? Number(b.params.material ?? VOXEL.dirt) || VOXEL.dirt : VOXEL.air, keep);
  const total = Object.values(changed).reduce((a, n) => a + n, 0);
  terrain.vars.lastDug = total;
  terrain.vars.lastGold = build ? 0 : changed[VOXEL.gold] ?? 0;
  terrain.vars.hitX = center[0]; terrain.vars.hitY = center[1]; terrain.vars.hitZ = center[2];
  if (total) { rt.world.solidsVersion++; rt.queueTrigger(build ? 'voxel.on_built' : 'voxel.on_dug', { [terrain.type]: [terrain] }); }
}

function activeCameraPostfx(rt: Runtime) {
  const cam = rt.activeCamera();
  if (!cam?.camera) return null;
  return cam.camera;
}

function effectOn(rt: Runtime, type: string) {
  const cam = activeCameraPostfx(rt);
  if (!cam) return null;
  let e = cam.postfx.find((x) => x.type === type);
  if (!e) { e = makeEffect(type); cam.postfx.push(e); }
  rt.postfxVersion++;
  return e;
}

function grabbed(rt: Runtime, holder: RInstance): RInstance | undefined {
  const uid = holder.state.holding;
  return uid ? rt.world.byUid.get(uid) : undefined;
}

function release(rt: Runtime, holder: RInstance) {
  const o = grabbed(rt, holder);
  holder.state.holding = 0;
  if (o?.state.physics) o.state.physics.heldBy = 0;
  return o;
}

// ------------------------------------------------------------------ conditions
export const CONDITIONS: Record<string, CondImpl> = {
  ...LOCKON_CONDITIONS,
  ...GRID_CONDITIONS,
  'spawner.on_spawned': always,
  'follower.on_teleported': always, 'follower.on_attack': always, 'follower.on_returned': always,
  'follower.is_following': { test: (_rt, _b, _c, i) => !i!.state.follower?.stay },
  'system.on_start_of_layout': always, 'system.on_game_start': always, 'system.on_fixed_update': always,
  'system.on_signal': always, 'object.on_collision': always, 'object.on_collision_end': always, 'object.on_trigger_enter': always,
  'object.on_created': always, 'object.on_destroyed': always, 'object.on_clicked': always, 'var.on_changed': always,
  'health.on_damaged': always, 'health.on_healed': always, 'health.on_died': always, 'combat.on_hit': always, 'voxel.on_dug': always, 'voxel.on_built': always,
  'touch.on_gesture': always, 'touch.on_object': always, 'paint.on_painted': always, 'enemy.on_seen': always,
  'input.on_device_changed': always, 'input.on_device_connected': always, 'input.on_device_disconnected': always, 'vr.on_teleported': always, 'vr.on_grabbed': always, 'vr.on_released': always,
  'platform.on_jump': always, 'platform.on_landed': always, 'platform.on_dash': always, 'platform.on_wall_jump': always, 'platformtype.on_switched': always, 'car.on_hit': always, 'bullet.on_hit_solid': always,
  'physics.on_impact': always, 'pathfinding.on_arrived': always, 'pathfinding.on_path_found': always, 'pathfinding.on_failed': always,
  'timer.on_timer': always, 'anim.on_finished': always, 'ui.on_button_clicked': always, 'function.on_function': always,
  'input.on_key_pressed': always, 'input.on_key_released': always, 'input.on_mouse_click': always,

  'dialogue.on_start': always, 'dialogue.on_line': always, 'dialogue.on_choice': always, 'dialogue.on_event': always, 'dialogue.on_end': always,
  'world.on_rooms_generated': always,
  'game.on_game_saved': always, 'game.on_game_loaded': always,
  'game.on_scene_end': always,'game.on_scene_error': always, 'game.on_scene_enter': always, 'game.on_screen_covered': always, 'game.on_transition_done': always,
  'game.screen_covered': { test: (rt) => rt.ui.transition?.phase === 'hold' || (rt.ui.transition?.phase === 'out' && rt.transitionAlpha() >= 1) },
  'sky.on_nightfall': always, 'sky.on_daybreak': always, 'water.on_enter': always, 'water.on_exit': always, 'water.on_start_floating': always, 'water.on_start_sinking': always, 'water.on_tipped_over': always,
  'net.on_player_joined': always, 'net.on_player_left': always, 'net.on_hosting': always,
  'npc.on_point': always, 'npc.on_path_end': always, 'npc.on_approach': always, 'npc.on_interact': always, 'npc.on_interact_end': always,
  'enemy.on_spotted': always, 'enemy.on_attack': always,
  'video.on_end': always, 'video.on_time': always,
  'rope.on_grab': always, 'rope.on_release': always, 'rope.on_end': always,
  'rope.is_held': { test: (_rt, _b, _c, i) => !!i?.state.rope?.holder },
  'path.on_point': always, 'path.on_end': always,
  'path.is_following': { test: (_rt, _b, _c, i) => !!i?.state.pathBrick && !i.state.pathBrick.stopped && !i.state.pathf?.done },
  'path.is_on_number': { test: (rt, b, ctx, i) => !!i?.state.pathBrick && i.state.pathBrick.number === Math.round(N(rt, b, ctx, 'number')) },
  'camera.on_view_changed': always,
  'camera.view_is': { test: (rt, b, ctx) => { const cams = camerasOf(rt, String(b.params.group ?? '')); const c = cams[Math.round(N(rt, b, ctx, 'number')) - 1]; return !!c && !!c.camera?.active; } },
  'mic.on_noise': always, 'mic.on_ready': always, 'mic.on_denied': always,
  'mic.level_is': { test: (rt, b, ctx) => compareValues(mic.level, String(b.params.op), N(rt, b, ctx, 'value')) },
  'mic.is_on': { test: () => mic.state === 'on' },
  'webcam.on_motion': always, 'webcam.on_ready': always, 'webcam.on_denied': always,
  'webcam.is_on': { test: () => webcam.state === 'on' },
  'breakable.on_broken': always, 'breakable.on_damaged': always,
  'vehicle.on_enter': always, 'vehicle.on_exit': always, 'interact.on_interact': always,
  'vehicle.is_occupied': { test: (_rt, _b, _c, i) => !!i!.state.vehicle?.driver },
  'vehicle.is_driving': { test: (_rt, _b, _c, i) => !!i!.state.inVehicle },
  'interact.is_near': { test: (_rt, _b, _c, i) => !!i!.state.interact?.near },
  'breakable.is_broken': { test: (_rt, _b, _c, i) => !!i!.state.breakable?.broken },
  'video.is_playing': { test: (rt, b) => { const v = rt.ui.video; const want = String(b.params.video ?? '').trim().toLowerCase(); return !!v && (!want || want === 'any' || want === v.name.toLowerCase()); } },
  'npc.is_interacting': { test: (_rt, _b, _c, i) => i!.state.npc?.mode === 'approach' || i!.state.npc?.mode === 'talk' },
  'enemy.state_is': { test: (_rt, b, _c, i) => String(i!.state.enemy?.state ?? (i!.state.npc ? 'idle' : '')) === String(b.params.state) },
  'sky.is_night': { test: (rt) => !!rt.scene.settings.sky?.enabled && isNight(rt.scene.settings.sky) },
  'water.is_in_water': { test: (_rt, _b, _c, i) => !!i!.state.inWater },
  'water.is_floating': { test: (_rt, _b, _c, i) => !!i!.state.float?.floating },
  'water.is_sinking': { test: (_rt, _b, _c, i) => !!i!.state.float?.sinking },
  'water.compare_submerged': { test: (rt, b, ctx, i) => compareValues(Number(i!.state.submerged ?? 0) * 100, String(b.params.op ?? '>'), N(rt, b, ctx, 'percent')) },
  'net.player_connected': { test: (rt, b, ctx) => rt.input.remotes.has(Math.round(N(rt, b, ctx, 'player'))) },
  'dialogue.is_active': { test: (rt) => !!rt.dialogue },
  'game.scene_is': { test: (rt, b) => rt.scene.name.toLowerCase() === String(b.params.scene).trim().toLowerCase() },
  'system.every_tick': always,
  'system.forever': always,
  'input.key_is_down': { test: (rt, b) => { const k = String(b.params.key); return k === 'Any' ? rt.input.down.size > 0 : rt.input.isDown(k); } },
  'input.mouse_is_down': { test: (rt, b) => rt.input.buttonsDown.has(String(b.params.button ?? 'left')) },
  'input.key_pressed': { test: (rt, b) => rt.input.binding(String(b.params.key), 'pressed') },
  'input.key_released': { test: (rt, b) => rt.input.binding(String(b.params.key), 'released') },
  'input.mouse_pressed': { test: (rt, b) => rt.input.binding('mouse:' + String(b.params.button ?? 'left'), 'pressed') },
  'input.mouse_released': { test: (rt, b) => rt.input.binding('mouse:' + String(b.params.button ?? 'left'), 'released') },
  'input.on_mouse_released': always,
  'input.gamepad_pressed': { test: (rt, b) => rt.input.binding('pad:' + String(b.params.button), 'pressed') },
  'input.gamepad_down': { test: (rt, b) => rt.input.binding('pad:' + String(b.params.button), 'held') },
  'input.gamepad_released': { test: (rt, b) => rt.input.binding('pad:' + String(b.params.button), 'released') },
  'input.gamepad_connected': { test: (rt) => rt.input.pad.connected },
  'input.action_began': { test: (rt, b) => rt.actionPressed(String(b.params.action), playerParam(b)) },
  'game.has_save': { test: (rt, b, ctx) => rt.hasSave(S(rt, b, ctx, 'slot')) },
  'input.action_held': { test: (rt, b) => rt.actionHeld(String(b.params.action), playerParam(b)) },
  'enemy.is_seen': { test: (_rt, _b, _c, i) => !!i!.state.enemy?.seen },
  'enemy.is_moving': { test: (_rt, _b, _c, i) => !!i!.state.enemy?.moving },
  'touch.is_touching': { test: (rt, b, ctx) => rt.input.touch.points.size >= Math.max(1, N(rt, b, ctx, 'count')) },
  'input.action_ended': { test: (rt, b) => rt.actionReleased(String(b.params.action), playerParam(b)) },
  'vr.is_active': { test: (rt) => rt.input.xr.active },
  'input.device_is': { test: (rt, b) => rt.input.device === String(b.params.device) },
  'input.axis_compare': { test: (rt, b, ctx) => compareValues(rt.input.axis(String(b.params.axis)), String(b.params.op), P(rt, b, ctx, 'value')) },
  'input.cursor_is_locked': { test: (rt) => !!rt.ui.cursorLocked },
  'system.if': { test: (rt, b, ctx) => truthy(P(rt, b, ctx, 'condition')) },
  'system.compare_values': { test: (rt, b, ctx) => compareValues(P(rt, b, ctx, 'a'), String(b.params.op), P(rt, b, ctx, 'b')) },
  'system.compare_variable': {
    test: (rt, b, ctx) => {
      const ref = rt.findVar(String(b.params.variable), ctx);
      if (!ref) throw new Error(`Unknown variable "${b.params.variable}"`);
      return compareValues(ref.scope[ref.key], String(b.params.op), P(rt, b, ctx, 'value'));
    },
  },
  'system.is_boolean_set': { test: (rt, b, ctx) => { const ref = rt.findVar(String(b.params.variable), ctx); if (!ref) throw new Error(`Unknown variable "${b.params.variable}"`); return truthy(ref.scope[ref.key]); } },
  'system.trigger_once': {
    test: (rt, b) => {
      const st = rt.onceState.get(b.id);
      const prevTick = st?.last ?? -10;
      rt.onceState.set(b.id, { last: rt.tickCount });
      return prevTick !== rt.tickCount - 1;
    },
  },
  'system.random_chance': { test: (rt, b, ctx) => rt.rng.next() * 100 < N(rt, b, ctx, 'percent') },
  'system.object_exists': { test: (rt, b) => rt.world.of(String(b.params.object)).length > 0 },
  'system.compare_count': { test: (rt, b, ctx) => compareValues(rt.world.of(String(b.params.object)).length, String(b.params.op), P(rt, b, ctx, 'value')) },
  'object.compare_property': { test: (rt, b, ctx, i) => compareValues(rt.prop(i!, String(b.params.property)), String(b.params.op), P(rt, b, ctx, 'value')) },
  'object.compare_var': { test: (rt, b, ctx, i) => compareValues(rt.prop(i!, String(b.params.variable)), String(b.params.op), P(rt, b, ctx, 'value')) },
  'object.is_var_true': { test: (rt, b, _c, i) => truthy(rt.prop(i!, String(b.params.variable))) },
  'object.is_visible': { test: (_rt, _b, _c, i) => i!.visible },
  'object.is_overlapping': {
    test: (rt, b, ctx, i) => {
      let any = false;
      for (const o of rt.world.of(String(b.params.other))) if (rt.world.overlapping(i!, o)) { any = true; addPick(ctx, o); }
      return any;
    },
  },
  'object.is_within_distance': {
    test: (rt, b, ctx, i) => {
      const d = N(rt, b, ctx, 'distance');
      let any = false;
      for (const o of rt.world.of(String(b.params.other))) if (o !== i && rt.world.planarDistance(i!, o) <= d) { any = true; addPick(ctx, o); }
      return any;
    },
  },
  'object.is_moving': { test: (_rt, _b, _c, i) => Math.hypot(i!.vx, i!.vy, i!.vz) > 0.05 || !!(i!.state.car && Math.abs(i!.state.car.speed) > 0.05) },
  'object.has_tag': { test: (_rt, b, _c, i) => i!.tags.includes(String(b.params.tag)) },
  'object.pick_nearest': {
    pick: (rt, b, ctx, cands) => {
      const x = N(rt, b, ctx, 'x'), y = N(rt, b, ctx, 'y'), z = N(rt, b, ctx, 'z');
      let best: RInstance | null = null, bd = Infinity;
      for (const c of cands) { const d = Math.hypot(c.x - x, c.y - y, c.z - z); if (d < bd) { bd = d; best = c; } }
      return best ? [best] : [];
    },
  },
  'object.pick_by_uid': { pick: (rt, b, ctx, cands) => { const u = N(rt, b, ctx, 'uid'); return cands.filter((c) => c.uid === u); } },
  'object.pick_random': { pick: (rt, _b, _c, cands) => (cands.length ? [cands[Math.floor(rt.rng.next() * cands.length)]] : []) },
  'object.pick_all': { pick: (rt, b) => rt.world.of(String(b.target)) },
  'object.pick_by_expression': { test: (rt, b, ctx) => truthy(P(rt, b, ctx, 'expression')) },
  'platform.is_on_floor': { test: (_rt, _b, _c, i) => !!i!.state.platform?.grounded },
  'platform.is_jumping': { test: (_rt, _b, _c, i) => !i!.state.platform?.grounded && i!.vy > 0 },
  'platform.is_falling': { test: (_rt, _b, _c, i) => !i!.state.platform?.grounded && i!.vy < 0 },
  'platform.is_state': { test: (rt, b, _c, i) => { const s = i!.state.platform ?? {}; const k = String(b.params.state); return k === 'wall sliding' ? !!s.wallSliding : k === 'dashing' ? s.dashT > 0 : k === 'crouching' ? !!s.crouched : k === 'climbing' ? !!s.climbing : k === 'gliding' ? !!s.gliding : k === 'flying' ? !!rt.world.behavior(i!, 'platform')?.props.flying && !s.grounded : false; } },
  'platformtype.is_on': { test: (_rt, _b, _c, i) => i!.state.platformType?.on !== false },
  'physics.is_holding': { test: (rt, _b, _c, i) => !!grabbed(rt, i!) },
  'physics.detect_ground': {
    test: (rt, b, ctx, i) => {
      const bb = rt.world.aabb(i!);
      const o: [number, number, number] = rt.world.plane === 'xz' ? [(bb[0] + bb[3]) / 2, bb[1] + 0.01, (bb[2] + bb[5]) / 2] : [(bb[0] + bb[3]) / 2, bb[1] + 0.01, i!.z];
      return !!raycast(rt.world, o, [0, -1, 0], N(rt, b, ctx, 'distance') + 0.02, rt.world.solids(), i);
    },
  },
  'physics.detect_wall': {
    test: (rt, b, ctx, i) => {
      const f = rt.world.forward(rt.world.angle(i!));
      const [x, y, z] = rt.world.worldPos(i!);
      const half = Math.max(i!.collider.size[0] * i!.sx, i!.collider.size[2] * i!.sz) / 2;
      return !!raycast(rt.world, [x, y, z], f, N(rt, b, ctx, 'distance') + half, rt.world.solids(), i);
    },
  },
  'physics.raycast': {
    test: (rt, b, ctx, i) => {
      const f = rt.world.forward(rt.world.angle(i!));
      const others = rt.world.of(String(b.params.other));
      const hit = raycast(rt.world, rt.world.worldPos(i!), f, N(rt, b, ctx, 'distance'), [...rt.world.solids(), ...others], i);
      if (hit && others.includes(hit.inst)) { addPick(ctx, hit.inst); return true; }
      return false;
    },
  },
  'pathfinding.has_line_of_sight': {
    test: (rt, b, ctx, i) => {
      let any = false;
      for (const o of rt.world.of(String(b.params.other))) if (lineOfSight(rt.world, i!, o)) { any = true; addPick(ctx, o); }
      return any;
    },
  },
  'health.compare_hp': { test: (rt, b, ctx, i) => compareValues(i!.state.health?.hp ?? 0, String(b.params.op), P(rt, b, ctx, 'value')) },
  'health.is_dead': { test: (_rt, _b, _c, i) => !!i!.state.health?.dead },
  'timer.is_running': { test: (_rt, b, _c, i) => !!i!.state.timers?.[String(b.params.tag)] },
  'timer.every_x_seconds': {
    test: (rt, b, ctx) => {
      const iv = Math.max(rt.dt, N(rt, b, ctx, 'seconds'));
      const last = rt.everyState.get(b.id);
      if (last == null) { rt.everyState.set(b.id, rt.time); return false; }
      if (rt.time - last >= iv - 1e-9) { rt.everyState.set(b.id, last + iv * Math.floor((rt.time - last + 1e-9) / iv)); return true; }
      return false;
    },
  },
  'anim.is_playing': { test: (_rt, b, _c, i) => (i!.animation ?? '') === String(b.params.name) },
  'proc.is_ragdoll': { test: (_rt, _b, _c, i) => !!i!.state.procanim?.ragdoll },
  'proc.is_climbing': { test: (_rt, _b, _c, i) => !!i!.state.procanim?.climb },
  'list.contains': {
    test: (rt, b, ctx) => {
      const ref = rt.findVar(String(b.params.variable), ctx);
      const l = ref?.scope[ref.key];
      const v = P(rt, b, ctx, 'value');
      return Array.isArray(l) && l.some((x) => x === v || toStr(x) === toStr(v));
    },
  },
};

// ------------------------------------------------------------------ loops
const MAX_LOOP = 100_000;
const MAX_WHILE = 10_000;
function iterate(ctx: Ctx, name: string | undefined, n: number, each: (c: Ctx, i: number) => void) {
  const frame = { name, index: 0, stop: false, item: undefined as any };
  const loops = [...ctx.loops, frame];
  for (let i = 0; i < n && !frame.stop; i++) {
    frame.index = i;
    each({ ...ctx, sol: new Map(ctx.sol), loops }, i);
  }
}
export const LOOPS: Record<string, LoopImpl> = {
  'system.repeat': (rt, b, ctx, body) => {
    const n = Math.floor(N(rt, b, ctx, 'count'));
    if (n > MAX_LOOP) throw new Error(`Repeat ${n} is above the limit of ${MAX_LOOP}`);
    iterate(ctx, undefined, n, (c) => body(c));
  },
  'system.repeat_until': (rt, b, ctx, body) => {
    const frame = { name: undefined, index: 0, stop: false, item: undefined };
    const loops = [...ctx.loops, frame];
    let i = 0;
    while (!frame.stop) {
      const c = { ...ctx, sol: new Map(ctx.sol), loops };
      if (truthy(rt.evaluate(b.params.condition as string, c))) break;
      if (++i > MAX_WHILE) throw new Error(`Repeat until stopped after ${MAX_WHILE} iterations (is the condition ever true?)`);
      frame.index = i - 1;
      body(c);
    }
  },
  'system.while': (rt, b, ctx, body) => {
    const frame = { name: undefined, index: 0, stop: false, item: undefined };
    const loops = [...ctx.loops, frame];
    let i = 0;
    while (!frame.stop) {
      const c = { ...ctx, sol: new Map(ctx.sol), loops };
      if (!truthy(rt.evaluate(b.params.condition as string, c))) break;
      if (++i > MAX_WHILE) throw new Error(`While loop stopped after ${MAX_WHILE} iterations (infinite loop?)`);
      frame.index = i - 1;
      body(c);
    }
  },
  'system.for': (rt, b, ctx, body) => {
    const s = Math.floor(N(rt, b, ctx, 'start')), e = Math.floor(N(rt, b, ctx, 'end'));
    const frame = { name: String(b.params.name), index: s, stop: false, item: undefined };
    const loops = [...ctx.loops, frame];
    const step = e >= s ? 1 : -1;
    let count = 0;
    for (let i = s; step > 0 ? i <= e : i >= e; i += step) {
      if (++count > MAX_LOOP) throw new Error('For loop above iteration limit');
      frame.index = i;
      body({ ...ctx, sol: new Map(ctx.sol), loops });
      if (frame.stop) break;
    }
  },
  'system.for_each': (rt, b, ctx, body) => {
    const type = String(b.params.object);
    const list = rt.picked(ctx, type);
    iterate(ctx, undefined, list.length, (c, i) => { if (list[i].destroyed) return; c.sol.set(type.toLowerCase(), [list[i]]); body(c); });
  },
  'system.for_each_ordered': (rt, b, ctx, body) => {
    const type = String(b.params.object);
    const list = rt.picked(ctx, type).map((inst) => ({ inst, v: toNum(rt.evaluate(b.params.value as string, { ...ctx, self: inst, sol: new Map([...ctx.sol, [type.toLowerCase(), [inst]]]) })) }));
    list.sort((a, c) => (b.params.order === 'descending' ? c.v - a.v : a.v - c.v));
    iterate(ctx, undefined, list.length, (c, i) => { if (list[i].inst.destroyed) return; c.sol.set(type.toLowerCase(), [list[i].inst]); body(c); });
  },
  'list.for_each_item': (rt, b, ctx, body) => {
    const ref = rt.findVar(String(b.params.variable), ctx);
    const l = ref ? ref.scope[ref.key] : null;
    if (!Array.isArray(l)) throw new Error(`"${b.params.variable}" is not a list`);
    const items = [...l];
    const frame = { name: undefined, index: 0, stop: false, item: undefined as any };
    const loops = [...ctx.loops, frame];
    for (let i = 0; i < items.length && !frame.stop; i++) { frame.index = i; frame.item = items[i]; body({ ...ctx, sol: new Map(ctx.sol), loops }); }
  },
};

// ------------------------------------------------------------------ actions
function listVar(rt: Runtime, b: BlockInstance, ctx: Ctx): any {
  const ref = rt.findVar(String(b.params.variable), ctx);
  if (!ref) throw new Error(`Unknown variable "${b.params.variable}"`);
  return ref.scope[ref.key];
}

function moveInst(rt: Runtime, inst: RInstance, dx: number, dy: number, dz: number) {
  inst.x += dx; inst.y += dy; inst.z += dz;
}

function spawnInto(rt: Runtime, ctx: Ctx, type: string, x: number, y: number, z: number, from?: any) {
  if (!rt.world.typeExists(type)) throw new Error(`Object type "${type}" does not exist`);
  const n = rt.world.spawn(type, x, y, z, from);
  if (!n) throw new Error(`Cannot create "${type}": place one in the scene first or give the type a template`);
  ctx.sol.set(type.toLowerCase(), [n]);
  rt.startPositions.set(n.uid, [x, y, z]);
  return n;
}

/** Procedural Animation stage blocks write the object's own behavior settings (the renderer reads them every frame). */
function procSet(rt: Runtime, i: RInstance, patch: Record<string, number | boolean>) {
  const b = rt.world.behavior(i, 'procanim');
  if (!b) return;
  for (const [k, v] of Object.entries(patch)) if (typeof v === 'boolean' || Number.isFinite(v)) b.props[k] = v;
}

export const ACTIONS: Record<string, ActImpl> = {
  ...LOCKON_ACTIONS,
  ...GRID_ACTIONS,
  'spawner.start': (_rt, _b, _c, i) => { if (i!.state.spawner) i!.state.spawner.on = true; else i!.state.spawner = { t: 0, made: 0, mine: [], on: true }; },
  'spawner.stop': (_rt, _b, _c, i) => { if (i!.state.spawner) i!.state.spawner.on = false; else i!.state.spawner = { t: 0, made: 0, mine: [], on: false }; },
  'spawner.spawn_now': (_rt, _b, _c, i) => { if (i!.state.spawner) { i!.state.spawner.on = true; i!.state.spawner.t = 0; } },
  'follower.stay': (_rt, _b, _c, i) => { (i!.state.follower ??= { stay: false, moving: false, dist: 0, vy: 0, path: null, pathAt: 0 }).stay = true; },
  'follower.follow': (_rt, _b, _c, i) => { if (i!.state.follower) i!.state.follower.stay = false; },
  // ---- flow
  'system.wait': () => { /* handled by Runtime.runActions */ },
  'system.stop_loop': (_rt, _b, ctx) => { const l = ctx.loops[ctx.loops.length - 1]; if (l) l.stop = true; },
  // ---- variables
  'var.set': (rt, b, ctx) => rt.setVar(String(b.params.variable), P(rt, b, ctx, 'value'), ctx),
  'var.add': (rt, b, ctx) => { const ref = rt.findVar(String(b.params.variable), ctx); if (!ref) throw new Error(`Unknown variable "${b.params.variable}"`); rt.setVar(ref.key, toNum(ref.scope[ref.key]) + N(rt, b, ctx, 'value'), ctx); },
  'var.subtract': (rt, b, ctx) => { const ref = rt.findVar(String(b.params.variable), ctx); if (!ref) throw new Error(`Unknown variable "${b.params.variable}"`); rt.setVar(ref.key, toNum(ref.scope[ref.key]) - N(rt, b, ctx, 'value'), ctx); },
  'var.toggle': (rt, b, ctx) => { const ref = rt.findVar(String(b.params.variable), ctx); if (!ref) throw new Error(`Unknown variable "${b.params.variable}"`); rt.setVar(ref.key, !truthy(ref.scope[ref.key]), ctx); },
  'object.set_var': (rt, b, ctx, i) => { i!.vars[String(b.params.variable)] = coerceLike(i!.vars[String(b.params.variable)], P(rt, b, ctx, 'value')); },
  'object.add_var': (rt, b, ctx, i) => { const k = String(b.params.variable); i!.vars[k] = toNum(i!.vars[k]) + N(rt, b, ctx, 'value'); },
  'object.toggle_var': (_rt, b, _c, i) => { const k = String(b.params.variable); i!.vars[k] = !truthy(i!.vars[k]); },
  'game.save': (rt, b) => {
    const only = onlyList(b), data: Record<string, any> = {};
    // Listed variables: merged into what the slot holds (several menus can share one slot).
    if (only) Object.assign(data, safeJson(rt.storageGet('craft.save.' + String(b.params.slot))));
    for (const [k, v] of Object.entries(rt.globals)) if (!rt.globalDefs.get(k)?.isConstant && (!only || only.has(k.toLowerCase()))) data[k] = v;
    rt.storageSet('craft.save.' + String(b.params.slot), JSON.stringify(data));
  },
  'game.save_game': (rt, b, ctx) => { rt.saveGame(S(rt, b, ctx, 'slot')); },
  'game.load_game': (rt, b, ctx) => { rt.loadGame(S(rt, b, ctx, 'slot')); },
  'game.delete_save': (rt, b, ctx) => { rt.deleteSave(S(rt, b, ctx, 'slot')); },
  'game.quit': (rt) => rt.quitGame(),
  'audio.set_category_volume': (rt, b, ctx) => rt.opts.host?.setBusVolume?.(String(b.params.category ?? 'music'), Math.max(0, Math.min(100, N(rt, b, ctx, 'volume'))) / 100),
  'game.set_quality': (rt, b) => rt.opts.host?.setQuality?.(String(b.params.quality ?? 'high')),
  'game.set_fullscreen': (rt, b) => {
    const s = String(b.params.state ?? 'toggle');
    const on = s === 'toggle' ? !rt.ui.fullscreen : s === 'on';
    rt.ui.fullscreen = on;
    rt.opts.host?.setFullscreen?.(on);
  },
  'object.cut_hole': (rt, b, ctx, i) => {
    const size = Math.max(0.01, N(rt, b, ctx, 'size')), shape = String(b.params.shape ?? 'sphere') as CutShape;
    cutHole(rt.world, i!, shape, [N(rt, b, ctx, 'x'), N(rt, b, ctx, 'y'), N(rt, b, ctx, 'z')], [size, size, size]);
  },
  'game.load': (rt, b, ctx) => {
    const raw = rt.storageGet('craft.save.' + String(b.params.slot)), only = onlyList(b);
    if (!raw) { if (!only) rt.report('warn', `No save in slot "${b.params.slot}"`); return; } // options: none on the first run
    for (const [k, v] of Object.entries(safeJson(raw))) if (k in rt.globals && (!only || only.has(k.toLowerCase()))) rt.setVar(k, v, ctx);
  },
  'system.log': (rt, b, ctx) => rt.report('info', toStr(P(rt, b, ctx, 'message'))),
  // ---- lists
  'input.set_binding': (rt, b, ctx) => rt.setActionBinding(S(rt, b, ctx, 'action'), S(rt, b, ctx, 'binding'), (String(b.params.how ?? 'replace') as 'replace' | 'add' | 'remove')),
  'input.enable_device': (rt, b) => { const d = String(b.params.device) as any; if (b.params.state === 'on') rt.input.disabled.delete(d); else rt.input.disabled.add(d); },
  'input.change_profile': (rt, b, ctx) => { rt.useInputProfile(S(rt, b, ctx, 'profile'), playerParam(b)); },
  'input.set_context': (rt, b) => { const s = String(b.params.state); rt.setInputContext(String(b.params.context), s !== 'off', s === 'only'); },
  'random.set_seed': (rt, b, ctx) => rt.reseed(Math.floor(N(rt, b, ctx, 'seed'))),
  'random.randomize_seed': (rt) => rt.reseed(clockSeed()),
  'random.number': (rt, b, ctx) => {
    let lo = N(rt, b, ctx, 'min'), hi = N(rt, b, ctx, 'max');
    if (hi < lo) [lo, hi] = [hi, lo];
    const r = rt.rng.next();
    rt.setVar(String(b.params.variable), b.params.kind === 'decimal' ? lo + r * (hi - lo) : Math.ceil(lo) + Math.floor(r * (Math.floor(hi) - Math.ceil(lo) + 1)), ctx);
  },
  'random.choose': (rt, b, ctx) => {
    const ref = rt.findVar(String(b.params.list), ctx), l = ref?.scope[ref.key];
    if (!Array.isArray(l)) throw new Error(`${b.params.list} is not a list`);
    rt.setVar(String(b.params.variable), l.length ? l[Math.floor(rt.rng.next() * l.length)] : '', ctx);
  },
  'random.choose_values': (rt, b, ctx) => {
    const v = rt.evaluate(`choose(${String(b.params.values)})`, ctx);
    rt.setVar(String(b.params.variable), v, ctx);
  },
  'random.position': (rt, b, ctx, i) => {
    const r = (a: string, z: string) => { const lo = N(rt, b, ctx, a), hi = N(rt, b, ctx, z); return lo + rt.rng.next() * (hi - lo); };
    i!.x = r('x1', 'x2'); i!.y = r('y1', 'y2');
    if (rt.world.plane === 'xz') i!.z = r('z1', 'z2');
    i!.vx = i!.vy = i!.vz = 0;
  },
  'random.rotation': (rt, b, ctx, i) => {
    const lo = N(rt, b, ctx, 'min'), hi = N(rt, b, ctx, 'max'), a = () => lo + rt.rng.next() * (hi - lo);
    const ax = String(b.params.axis);
    if (ax === 'heading' || rt.world.plane === 'xy') rt.world.setAngle(i!, a());
    else if (ax === 'all axes') { i!.rx = a(); i!.ry = a(); i!.rz = a(); }
    else (i as any)['r' + ax] = a();
  },
  'list.push':(rt, b, ctx) => { const l = listVar(rt, b, ctx); if (!Array.isArray(l)) throw new Error('Not a list'); l.push(P(rt, b, ctx, 'value')); },
  'list.set_at': (rt, b, ctx) => { const l = listVar(rt, b, ctx); if (!Array.isArray(l)) throw new Error('Not a list'); l[Math.floor(N(rt, b, ctx, 'index'))] = P(rt, b, ctx, 'value'); },
  'list.remove_at': (rt, b, ctx) => { const l = listVar(rt, b, ctx); if (!Array.isArray(l)) throw new Error('Not a list'); l.splice(Math.floor(N(rt, b, ctx, 'index')), 1); },
  'list.remove_value': (rt, b, ctx) => { const l = listVar(rt, b, ctx); if (!Array.isArray(l)) throw new Error('Not a list'); const v = P(rt, b, ctx, 'value'); const i = l.findIndex((x) => toStr(x) === toStr(v)); if (i >= 0) l.splice(i, 1); },
  'list.clear': (rt, b, ctx) => { const l = listVar(rt, b, ctx); if (Array.isArray(l)) l.length = 0; else if (l && typeof l === 'object') for (const k of Object.keys(l)) delete l[k]; },
  'dict.set': (rt, b, ctx) => { const d = listVar(rt, b, ctx); if (!d || typeof d !== 'object' || Array.isArray(d)) throw new Error('Not a dictionary'); d[S(rt, b, ctx, 'key')] = P(rt, b, ctx, 'value'); },
  'dict.delete': (rt, b, ctx) => { const d = listVar(rt, b, ctx); if (d && typeof d === 'object') delete d[S(rt, b, ctx, 'key')]; },
  // ---- functions
  'function.call': (rt, b, ctx) => {
    const raw = String(b.params.args ?? '').trim();
    const args = raw ? splitArgs(raw).map((a) => rt.evaluate(a, ctx)) : [];
    rt.callFunction(String(b.params.name), args);
  },
  'function.set_return': (rt, b, ctx) => { if (ctx.fn) ctx.fn.ret = P(rt, b, ctx, 'value'); },
  'system.signal': (rt, b) => { rt.fireTrigger('system.on_signal', null, (c) => String(c.params.name).toLowerCase() === String(b.params.name).toLowerCase()); },
  // ---- objects
  'object.create': (rt, b, ctx) => { spawnInto(rt, ctx, String(b.params.object), N(rt, b, ctx, 'x'), N(rt, b, ctx, 'y'), N(rt, b, ctx, 'z')); },
  'object.create_by_name': (rt, b, ctx) => {
    const n = spawnInto(rt, ctx, rt.world.typeName(S(rt, b, ctx, 'name').trim()), N(rt, b, ctx, 'x'), N(rt, b, ctx, 'y'), N(rt, b, ctx, 'z'));
    // Optional: attach to the picked instance of another type (like "Attach to"), so later actions can address
    // the parent's static type - e.g. destroying a chunk destroys whichever random room it holds.
    const parentType = String(b.params.attach ?? '').trim();
    const p = parentType ? rt.picked(ctx, parentType)[0] : undefined;
    if (p && p !== n) { const [px, py, pz] = rt.world.worldPos(p); n.x -= px; n.y -= py; n.z -= pz; n.parent = p.uid; }
  },
  'object.spawn': (rt, b, ctx, i) => {
    const f = rt.world.forward(rt.world.angle(i!));
    const off = N(rt, b, ctx, 'offset');
    const [x, y, z] = rt.world.worldPos(i!);
    const n = spawnInto(rt, ctx, String(b.params.object), x + f[0] * off, y + f[1] * off, z + f[2] * off);
    rt.world.setAngle(n, rt.world.angle(i!));
  },
  'object.destroy': (rt, _b, _c, i) => rt.world.destroy(i!),
  'object.set_visible': (_rt, b, _c, i) => { i!.visible = b.params.visible === 'toggle' ? !i!.visible : b.params.visible !== 'invisible'; },
  'object.set_opacity': (rt, b, ctx, i) => { i!.opacity = Math.max(0, Math.min(100, N(rt, b, ctx, 'value'))); },
  'object.set_color': (_rt, b, _c, i) => { i!.color = String(b.params.color); },
  'object.set_scale': (rt, b, ctx, i) => { i!.sx = N(rt, b, ctx, 'sx'); i!.sy = N(rt, b, ctx, 'sy'); i!.sz = N(rt, b, ctx, 'sz'); },
  'object.attach_to': (rt, b, ctx, i) => {
    const p = rt.picked(ctx, String(b.params.other))[0];
    if (!p || p === i) return;
    const [px, py, pz] = rt.world.worldPos(p);
    i!.x -= px; i!.y -= py; i!.z -= pz; i!.parent = p.uid;
  },
  'object.add_tag': (_rt, b, _c, i) => { const t = String(b.params.tag); if (!i!.tags.includes(t)) i!.tags.push(t); },
  'object.remove_tag': (_rt, b, _c, i) => { i!.tags = i!.tags.filter((t) => t !== String(b.params.tag)); },
  'behavior.set_enabled': (rt, b, _c, i) => {
    const bh = rt.world.behavior(i!, String(b.params.behavior));
    if (!bh) throw new Error(`${i!.type} has no ${b.params.behavior} behavior`);
    bh.props.enabled = b.params.state !== 'disabled';
    if (bh.type === 'solid') rt.world.solidsVersion++;
    if (!bh.props.enabled) { i!.vx = 0; i!.vz = 0; if (bh.type !== 'platform') i!.vy = 0; }
  },
  // ---- movement
  'object.set_position': (rt, b, ctx, i) => { i!.x = N(rt, b, ctx, 'x'); i!.y = N(rt, b, ctx, 'y'); i!.z = N(rt, b, ctx, 'z'); if (rt.world.hasBehavior(i!, 'solid')) rt.world.solidsVersion++; },
  'object.teleport_to': (rt, b, ctx, i) => { const o = rt.picked(ctx, String(b.params.other))[0]; if (o) { const [x, y, z] = rt.world.worldPos(o); i!.x = x; i!.y = y; i!.z = z; i!.vx = i!.vy = i!.vz = 0; } },
  'object.move': (rt, b, ctx, i) => moveInst(rt, i!, N(rt, b, ctx, 'dx'), N(rt, b, ctx, 'dy'), N(rt, b, ctx, 'dz')),
  'object.move_forward': (rt, b, ctx, i) => { const f = rt.world.forward(rt.world.angle(i!)); const d = N(rt, b, ctx, 'distance'); moveInst(rt, i!, f[0] * d, f[1] * d, f[2] * d); },
  'object.move_toward': (rt, b, ctx, i) => {
    const tx = N(rt, b, ctx, 'x'), ty = N(rt, b, ctx, 'y'), tz = N(rt, b, ctx, 'z'), d = N(rt, b, ctx, 'distance');
    const dx = tx - i!.x, dy = ty - i!.y, dz = tz - i!.z; const l = Math.hypot(dx, dy, dz);
    if (l <= d || l < 1e-9) { i!.x = tx; i!.y = ty; i!.z = tz; } else moveInst(rt, i!, (dx / l) * d, (dy / l) * d, (dz / l) * d);
  },
  'object.move_toward_object': (rt, b, ctx, i) => {
    const o = rt.picked(ctx, String(b.params.other))[0]; if (!o) return;
    const d = N(rt, b, ctx, 'speed') * rt.dtScaled;
    const [a1, b1] = planeAB(rt.world, i!), [a2, b2] = planeAB(rt.world, o);
    const da = a2 - a1, db = b2 - b1, l = Math.hypot(da, db); if (l < 1e-6) return;
    const k = Math.min(d, l) / l;
    if (rt.world.plane === 'xz') moveInst(rt, i!, da * k, 0, db * k); else moveInst(rt, i!, da * k, db * k, 0);
    rt.world.setAngle(i!, rt.world.headingTo(i!.x, i!.y, i!.z, o.x, o.y, o.z));
  },
  'object.set_velocity': (rt, b, ctx, i) => { i!.vx = N(rt, b, ctx, 'vx'); i!.vy = N(rt, b, ctx, 'vy'); i!.vz = N(rt, b, ctx, 'vz'); },
  'object.set_angle': (rt, b, ctx, i) => rt.world.setAngle(i!, N(rt, b, ctx, 'angle')),
  'object.rotate': (rt, b, ctx, i) => rt.world.setAngle(i!, rt.world.angle(i!) + N(rt, b, ctx, 'degrees')),
  // ---- Scratch-style movement (per second, glide, mouse, random spot, edge bounce)
  'object.rotate_per_second': (rt, b, ctx, i) => rt.world.setAngle(i!, rt.world.angle(i!) + N(rt, b, ctx, 'degrees') * rt.dtScaled),
  'object.move_per_second': (rt, b, ctx, i) => { const f = rt.world.forward(rt.world.angle(i!)); const d = N(rt, b, ctx, 'speed') * rt.dtScaled; moveInst(rt, i!, f[0] * d, f[1] * d, f[2] * d); },
  'object.glide_to': (rt, b, ctx, i) => {
    const dur = Math.max(0, N(rt, b, ctx, 'seconds'));
    const to: Record<string, number> = { X: N(rt, b, ctx, 'x'), Y: N(rt, b, ctx, 'y'), Z: N(rt, b, ctx, 'z') };
    rt.tweens = rt.tweens.filter((t) => !(t.inst === i && (t.prop === 'X' || t.prop === 'Y' || t.prop === 'Z')));
    for (const prop of ['X', 'Y', 'Z']) rt.tweens.push({ inst: i!, prop, from: rt.settable(i!, prop), to: to[prop], dur, t: 0, ease: 'linear' });
  },
  'object.point_toward_mouse': (rt, _b, _c, i) => { const m = rt.input.mouse; rt.world.setAngle(i!, rt.world.headingTo(i!.x, i!.y, i!.z, m.x, m.y, m.z)); },
  'object.go_random': (rt, _b, _c, i) => {
    const s = stageBounds(rt), hw = (i!.sx || 1) / 2, hh = (i!.sy || 1) / 2;
    i!.x = s.minX + hw + rt.rng.next() * Math.max(0, s.maxX - s.minX - 2 * hw);
    if (rt.world.plane === 'xz') i!.z = s.minY + hh + rt.rng.next() * Math.max(0, s.maxY - s.minY - 2 * hh);
    else i!.y = s.minY + hh + rt.rng.next() * Math.max(0, s.maxY - s.minY - 2 * hh);
  },
  'object.bounce_on_edge': (rt, _b, _c, i) => {
    // Scratch "if on edge, bounce": reflect the heading (and velocity) off whichever edge was crossed.
    const s = stageBounds(rt), bb = rt.world.aabb(i!), xz = rt.world.plane === 'xz';
    const lo = xz ? bb[2] : bb[1], hi = xz ? bb[5] : bb[4];
    let a = rt.world.angle(i!), hit = false;
    if (bb[0] < s.minX) { i!.x += s.minX - bb[0]; a = 180 - a; i!.vx = Math.abs(i!.vx); hit = true; }
    else if (bb[3] > s.maxX) { i!.x -= bb[3] - s.maxX; a = 180 - a; i!.vx = -Math.abs(i!.vx); hit = true; }
    if (lo < s.minY) { if (xz) i!.z += s.minY - lo; else i!.y += s.minY - lo; a = -a; if (xz) i!.vz = Math.abs(i!.vz); else i!.vy = Math.abs(i!.vy); hit = true; }
    else if (hi > s.maxY) { if (xz) i!.z -= hi - s.maxY; else i!.y -= hi - s.maxY; a = -a; if (xz) i!.vz = -Math.abs(i!.vz); else i!.vy = -Math.abs(i!.vy); hit = true; }
    if (hit) rt.world.setAngle(i!, a);
  },
  // ---- size and costumes
  'object.change_size': (rt, b, ctx, i) => { const base = baseScale(i!); const pct = sizePercent(i!) + N(rt, b, ctx, 'percent'); setSizePercent(i!, base, pct); },
  'object.set_size': (rt, b, ctx, i) => setSizePercent(i!, baseScale(i!), N(rt, b, ctx, 'percent')),
  'sprite.next_costume': (_rt, _b, _c, i) => {
    const list = i!.sprite?.costumes ?? [];
    if (!i!.sprite || !list.length) return;
    i!.sprite.image = list[(list.indexOf(i!.sprite.image) + 1) % list.length];
  },
  'sprite.set_costume': (rt, b, ctx, i) => {
    if (!i!.sprite) return;
    const v = P(rt, b, ctx, 'costume');
    const list = i!.sprite.costumes ?? [];
    if (typeof v === 'number' || /^\d+$/.test(String(v).trim())) { const n = Math.floor(toNum(v)); if (list.length) i!.sprite.image = list[((n - 1) % list.length + list.length) % list.length]; }
    else if (String(v)) i!.sprite.image = String(v);
  },
  // ---- speech bubbles
  'looks.say': (rt, b, ctx, i) => bubble(rt, i!, 'say', S(rt, b, ctx, 'text'), N(rt, b, ctx, 'seconds')),
  'looks.think': (rt, b, ctx, i) => bubble(rt, i!, 'think', S(rt, b, ctx, 'text'), N(rt, b, ctx, 'seconds')),
  'system.wait_until': () => { /* handled by Runtime.runActions */ },
  'ui.ask': () => { /* handled by Runtime.runActions */ },
  'code.run': (rt, b, ctx) => runCodeBlock(rt, b, ctx),
  'ui.hide_html': (rt, b) => { const n = String(b.params.name || 'panel'); const p = rt.ui.panels?.[n]; if (p) rt.ui.panels = { ...rt.ui.panels, [n]: { ...p, visible: false } }; },
  'dialogue.start': (rt, b) => startDialogue(rt, String(b.params.dialogue)),
  'video.play': (rt, b, ctx) => rt.playVideo(String(b.params.video), {
    fullscreen: b.params.fullscreen !== false, loop: !!b.params.loop, volume: Math.max(0, Math.min(1, N(rt, b, ctx, 'volume') / 100)),
    fit: (['contain', 'cover', 'stretch'].includes(String(b.params.fit)) ? b.params.fit : 'contain') as any,
    x: N(rt, b, ctx, 'x'), y: N(rt, b, ctx, 'y'), w: Math.max(5, N(rt, b, ctx, 'w')),
    skipKey: String(b.params.skip ?? 'none'), lockControls: b.params.lock !== false,
  }),
  'vehicle.enter': (rt, b, _c, i) => {
    if (i!.state.inVehicle) return;
    let best: RInstance | null = null, bd = Infinity;
    for (const v of rt.world.of(String(b.params.vehicle))) { if (!rt.world.behavior(v, 'vehicle') || v.state.vehicle?.driver) continue; const d = rt.world.planarDistance(i!, v); if (d < bd) { bd = d; best = v; } }
    if (best) enterVehicle(rt, best, i!, rt.world.behavior(best, 'vehicle')!.props);
  },
  'vehicle.exit': (rt, _b, _c, i) => { if (i!.state.vehicle?.driver) exitVehicle(rt, i!, rt.world.behavior(i!, 'vehicle')!.props); },
  'interact.set_prompt': (rt, b, ctx, i) => { const bh = rt.world.behavior(i!, 'interactable'); if (bh) bh.props.prompt = S(rt, b, ctx, 'text'); },
  'fx.set_object_effect': (_rt, b, _c, i) => {
    const t = String(b.params.effect) as ObjectFxType; if (!OBJECT_FX[t]) return;
    const list = (i!.fx ??= []); let f = list.find((x) => x.type === t);
    if (!f) { f = makeObjectFx(t); list.push(f); }
    f.enabled = b.params.on !== false;
  },
  'fx.set_object_effect_param': (rt, b, ctx, i) => {
    const t = String(b.params.effect) as ObjectFxType; if (!OBJECT_FX[t]) return;
    const list = (i!.fx ??= []); let f = list.find((x) => x.type === t);
    if (!f) { f = makeObjectFx(t); list.push(f); }
    const v = P(rt, b, ctx, 'value');
    f.params = { ...f.params, [String(b.params.param)]: typeof v === 'number' ? v : String(v) };
  },
  'breakable.break': (rt, _b, _c, i) => { if (!rt.world.behavior(i!, 'breakable')) throw new Error(`${i!.type} has no Breakable behavior`); rt.breakObject(i!, null); },
  'breakable.damage': (rt, b, ctx, i) => { if (!i!.state.breakable) throw new Error(`${i!.type} has no Breakable behavior`); rt.breakableDamage(i!, N(rt, b, ctx, 'amount')); },
  'breakable.set_durability': (rt, b, ctx, i) => { const st = i!.state.breakable; if (st && !st.broken) st.hp = N(rt, b, ctx, 'value'); },
  'video.pause': (rt) => { if (rt.ui.video) rt.ui.video.paused = true; },
  'video.resume': (rt) => { if (rt.ui.video) rt.ui.video.paused = false; },
  'video.stop': (rt) => rt.endVideo('stopped'),
  'video.skip': (rt) => rt.endVideo('skipped'),
  'dialogue.continue': (rt) => continueDialogue(rt),
  'dialogue.choose': (rt, b, ctx) => chooseDialogue(rt, Math.round(N(rt, b, ctx, 'index'))),
  'dialogue.jump': (rt, b) => jumpDialogue(rt, String(b.params.line)),
  'dialogue.end': (rt) => endDialogue(rt, ''),
  'game.previous_scene': (rt, b) => { if (!rt.previousScene) { rt.report('warn', 'There is no previous scene yet'); return; } rt.changeScene(rt.previousScene, { transition: String(b.params.transition ?? 'none'), color: b.params.color != null ? String(b.params.color) : undefined, picture: pic(b, 'picture'), cover: pic(b, 'cover'), duration: 0.5, keep: String(b.params.keep ?? 'all') }); },
  'object.set_rotation': (rt, b, ctx, i) => { i!.rx = N(rt, b, ctx, 'rx'); i!.ry = N(rt, b, ctx, 'ry'); i!.rz = N(rt, b, ctx, 'rz'); },
  'object.look_at': (rt, b, ctx, i) => { const o = rt.picked(ctx, String(b.params.other))[0]; if (o) rt.world.setAngle(i!, rt.world.headingTo(i!.x, i!.y, i!.z, o.x, o.y, o.z)); },
  'object.look_at_position': (rt, b, ctx, i) => rt.world.setAngle(i!, rt.world.headingTo(i!.x, i!.y, i!.z, N(rt, b, ctx, 'x'), N(rt, b, ctx, 'y'), N(rt, b, ctx, 'z'))),
  'movement.set_speed': (rt, b, ctx, i) => {
    const mb = movementBehavior(rt, i!);
    if (!mb) throw new Error(`${i!.type} has no movement behavior (Platform, 8 Direction, Car, Pathfinding or Bullet)`);
    mb.props[mb.type === 'bullet' ? 'speed' : 'maxSpeed'] = N(rt, b, ctx, 'speed');
  },
  'platform.simulate_control': (_rt, b, _c, i) => { (i!.state.sim ??= new Set<string>()).add(String(b.params.control)); },
  'platform.jump': (_rt, _b, _c, i) => { (i!.state.sim ??= new Set<string>()).add('jump'); },
  'platform.set_jump_strength': (rt, b, ctx, i) => { const p = rt.world.behavior(i!, 'platform'); if (p) p.props.jumpStrength = N(rt, b, ctx, 'value'); },
  'platform.set_gravity': (rt, b, ctx, i) => { const p = rt.world.behavior(i!, 'platform'); if (p) p.props.gravity = N(rt, b, ctx, 'value'); },
  'platform.set_jumps': (rt, b, ctx, i) => { const p = rt.world.behavior(i!, 'platform') ?? rt.world.behavior(i!, 'surfacewalker'); if (!p) return; const n = Math.round(N(rt, b, ctx, 'count')); p.props.unlimitedJumps = n <= 0; p.props.jumpCount = Math.max(1, n); p.props.doubleJump = false; },
  'platform.set_ability': (rt, b, _c, i) => {
    const p = rt.world.behavior(i!, 'platform'); if (!p) return;
    const key = ({ jumping: 'jumping', sprinting: 'sprinting', swimming: 'swimming', crouching: 'crouching', dash: 'dash', 'wall sliding': 'wallSlide', 'wall jumping': 'wallJump', 'slow descent': 'slowDescent', climbing: 'climbing', flying: 'flying', 'drop through': 'dropThrough' } as Record<string, string>)[String(b.params.ability)];
    if (key) p.props[key] = b.params.state !== 'off';
  },
  'platform.dash': (_rt, _b, _c, i) => { (i!.state.sim ??= new Set<string>()).add('dash'); },
  'platformtype.switch': (rt, b, _c, i) => {
    const st = (i!.state.platformType ??= { on: true, t: 0, base: i!.opacity, shown: 1 });
    const s = String(b.params.state ?? 'toggle');
    st.on = s === 'toggle' ? st.on === false : s === 'on'; st.t = 0; rt.world.solidsVersion++;
  },
  'platformtype.set_kind': (rt, b, _c, i) => { const p = rt.world.behavior(i!, 'platformtype'); if (p) { p.props.kind = String(b.params.kind); rt.world.solidsVersion++; } },
  'movement.fly': (rt, b, ctx, i) => { i!.vy = N(rt, b, ctx, 'speed'); },
  'follow.set_target': (rt, b, _c, i) => { const f = rt.world.behavior(i!, 'follow'); if (f) f.props.target = String(b.params.other); },
  // ---- physics
  'physics.apply_force': (rt, b, ctx, i) => { const m = Math.max(0.01, Number(rt.world.behavior(i!, 'physics')?.props.mass ?? 1)); const dt = rt.dtScaled; i!.vx += (N(rt, b, ctx, 'fx') / m) * dt; i!.vy += (N(rt, b, ctx, 'fy') / m) * dt; i!.vz += (N(rt, b, ctx, 'fz') / m) * dt; },
  'physics.apply_impulse': (rt, b, ctx, i) => { const m = Math.max(0.01, Number(rt.world.behavior(i!, 'physics')?.props.mass ?? 1)); i!.vx += N(rt, b, ctx, 'ix') / m; i!.vy += N(rt, b, ctx, 'iy') / m; i!.vz += N(rt, b, ctx, 'iz') / m; },
  'physics.set_world_gravity': (rt, b, ctx) => { rt.gravity = N(rt, b, ctx, 'value'); },
  'physics.set_mass': (rt, b, ctx, i) => { const p = rt.world.behavior(i!, 'physics'); if (p) p.props.mass = Math.max(0.01, N(rt, b, ctx, 'value')); },
  'physics.set_friction': (rt, b, ctx, i) => { const p = rt.world.behavior(i!, 'physics'); if (p) p.props.friction = N(rt, b, ctx, 'value'); },
  'physics.set_bounce': (rt, b, ctx, i) => { const p = rt.world.behavior(i!, 'physics'); if (p) p.props.bounce = N(rt, b, ctx, 'value'); },
  'physics.add_body': (rt, b, ctx, i) => { ensureBehavior(rt, i!, 'physics', { mass: N(rt, b, ctx, 'mass') }); },
  'physics.set_collider': (rt, b, ctx, i) => { i!.collider = { ...i!.collider, shape: String(b.params.shape) as any, size: [N(rt, b, ctx, 'w'), N(rt, b, ctx, 'h'), N(rt, b, ctx, 'd')] }; rt.world.solidsVersion++; },
  'physics.grab_nearest': (rt, b, ctx, i) => {
    if (grabbed(rt, i!)) return;
    const max = N(rt, b, ctx, 'distance');
    let best: RInstance | null = null, bd = Infinity;
    for (const o of rt.world.of(String(b.params.object))) {
      if (o === i || !rt.world.hasBehavior(o, 'physics') || o.state.physics?.heldBy) continue;
      const d = Math.hypot(o.x - i!.x, o.y - i!.y, o.z - i!.z);
      if (d <= max && d < bd) { bd = d; best = o; }
    }
    if (!best) return;
    (best.state.physics ??= { heldBy: 0, grounded: false }).heldBy = i!.uid;
    i!.state.holding = best.uid;
    ctx.sol.set(best.type.toLowerCase(), [best]);
  },
  'physics.drop': (rt, _b, _c, i) => { const o = release(rt, i!); if (o) { o.vx *= 0.2; o.vz *= 0.2; o.vy = 0; } },
  'physics.throw': (rt, b, ctx, i) => {
    const o = release(rt, i!); if (!o) return;
    const m = Math.max(0.01, Number(rt.world.behavior(o, 'physics')?.props.mass ?? 1));
    const f = rt.world.forward(rt.world.angle(i!));
    const s = N(rt, b, ctx, 'strength') / m, up = N(rt, b, ctx, 'up') / m;
    o.vx = f[0] * s; o.vy = (rt.world.plane === 'xz' ? 0 : f[1] * s) + up; o.vz = f[2] * s;
    ctx.sol.set(o.type.toLowerCase(), [o]);
  },
  'physics.explode': (rt, b, ctx) => {
    const x = N(rt, b, ctx, 'x'), y = N(rt, b, ctx, 'y'), z = N(rt, b, ctx, 'z'), r = N(rt, b, ctx, 'radius'), F = N(rt, b, ctx, 'force');
    for (const o of rt.world.instances) {
      if (o.destroyed || !rt.world.hasBehavior(o, 'physics')) continue;
      const dx = o.x - x, dy = o.y - y, dz = o.z - z, d = Math.hypot(dx, dy, dz);
      if (d > r || d < 1e-6) continue;
      const m = Math.max(0.01, Number(rt.world.behavior(o, 'physics')?.props.mass ?? 1));
      const k = (F * (1 - d / r)) / m / d;
      o.vx += dx * k; o.vy += dy * k + (F * (1 - d / r)) / m * 0.3; o.vz += dz * k;
    }
  },
  // ---- combat
  'health.damage': (rt, b, ctx, i) => { if (!i!.state.health && !i!.state.breakable) throw new Error(`${i!.type} has no Health behavior`); damage(rt, i!, N(rt, b, ctx, 'amount')); },
  'health.heal': (rt, b, ctx, i) => { const st = i!.state.health; if (!st || st.dead) return; st.hp = Math.min(st.max, st.hp + N(rt, b, ctx, 'amount')); rt.queueTrigger('health.on_healed', { [i!.type]: [i!] }); },
  'health.set_hp': (rt, b, ctx, i) => { const st = i!.state.health; if (!st) return; st.hp = Math.max(0, Math.min(st.max, N(rt, b, ctx, 'value'))); st.dead = st.hp <= 0; rt.queueTrigger('health.on_healed', { [i!.type]: [i!] }); },
  'combat.shoot': (rt, b, ctx, i) => {
    const type = String(b.params.object);
    const f = rt.world.forward(rt.world.angle(i!));
    const bb = rt.world.aabb(i!);
    const [x, y, z] = rt.world.worldPos(i!);
    const reach = Math.max(bb[3] - bb[0], bb[5] - bb[2]) / 2 + 0.3;
    const n = spawnInto(rt, ctx, type, x + f[0] * reach, rt.world.plane === 'xz' ? (bb[1] + bb[4]) / 2 : y + f[1] * reach, z + f[2] * reach);
    const spread = N(rt, b, ctx, 'spread');
    rt.world.setAngle(n, rt.world.angle(i!) + (rt.rng.next() * 2 - 1) * spread);
    ensureBehavior(rt, n, 'bullet').props.speed = N(rt, b, ctx, 'speed');
    n.vars.owner = i!.uid; n.vars.damage = N(rt, b, ctx, 'damage');
    n.state.projectile = { owner: i!.uid, damage: N(rt, b, ctx, 'damage') };
    rt.projectiles.add(n.uid);
  },
  'combat.melee': (rt, b, ctx, i) => {
    const range = N(rt, b, ctx, 'range'), arc = N(rt, b, ctx, 'arc'), dmg = N(rt, b, ctx, 'damage');
    const facing = rt.world.angle(i!);
    for (const v of rt.world.of(String(b.params.victims))) {
      if (v === i) continue;
      if (rt.world.planarDistance(i!, v) > range) continue;
      const h = rt.world.headingTo(i!.x, i!.y, i!.z, v.x, v.y, v.z);
      const diff = Math.abs(((h - facing + 540) % 360) - 180);
      if (diff > arc / 2) continue;
      const wasDead = !!v.state.health?.dead;
      damage(rt, v, dmg);
      if (bleeds(b.params.blood, !wasDead && !!v.state.health?.dead)) { const a = rt.world.worldPos(i!), t = rt.world.worldPos(v); bloodSplatter(rt, v, undefined, [t[0] - a[0], t[1] - a[1], t[2] - a[2]], !wasDead && !!v.state.health?.dead); }
      rt.queueTrigger('combat.on_hit', { [v.type]: [v] });
    }
  },
  'combat.hitscan': (rt, b, ctx, i) => {
    let [origin, dir] = viewRay(rt, i!);
    const spread = (N(rt, b, ctx, 'spread') * Math.PI) / 180;
    if (spread > 0) { const l = Math.hypot(...dir); dir = dir.map((d) => d / l + (rt.rng.next() * 2 - 1) * spread) as [number, number, number]; }
    const victims = rt.world.of(String(b.params.victims));
    const blockers = rt.world.solids();
    const hit = raycast(rt.world, origin, dir, N(rt, b, ctx, 'range'), [...blockers, ...victims].filter((c) => c !== i), i!);
    if (!hit) return;
    const impact = String(b.params.impact ?? '').trim();
    if (impact && rt.world.typeExists(impact)) spawnInto(rt, ctx, impact, hit.point[0] + hit.normal[0] * 0.05, hit.point[1] + hit.normal[1] * 0.05, hit.point[2] + hit.normal[2] * 0.05);
    // Bullet hole on what was hit (walls and props, not the targets themselves).
    const d = String(b.params.decal ?? 'bullet hole').trim();
    // "cut hole": a real hole through the mesh (Boolean), a little into the surface so thin walls open up.
    if (d === 'cut hole' && !victims.includes(hit.inst) && !hit.inst.noMarks) {
      const r = 0.12 * (0.85 + rt.rng.next() * 0.3);
      cutHole(rt.world, hit.inst, 'sphere', [hit.point[0] - hit.normal[0] * r * 0.3, hit.point[1] - hit.normal[1] * r * 0.3, hit.point[2] - hit.normal[2] * r * 0.3], [r, r, r]);
    }
    const decal = d === 'bullet hole' ? BULLET_HOLE : d === 'none' || d === 'cut hole' ? '' : d; // or a picture's asset id
    if (decal && !victims.includes(hit.inst)) bulletMark(rt, hit.inst, hit.point, hit.normal, decal);
    if (victims.includes(hit.inst)) {
      const wasDead = !!hit.inst.state.health?.dead;
      damage(rt, hit.inst, N(rt, b, ctx, 'damage'));
      const killed = !wasDead && !!hit.inst.state.health?.dead;
      if (bleeds(b.params.blood, killed)) bloodSplatter(rt, hit.inst, hit.point, dir, killed);
      rt.queueTrigger('combat.on_hit', { [hit.inst.type]: [hit.inst] });
    }
  },
  'combat.blood': (rt, b, _ctx, i) => { bloodSplatter(rt, i!, undefined, undefined, b.params.big === true || b.params.big === 'true'); },
  'paint.shoot': (rt, b, ctx, i) => {
    const [origin, d0] = viewRay(rt, i!);
    // A spray scatters a little (about 2°), so held fire paints a patch instead of one spot.
    const l0 = Math.hypot(...d0) || 1, k = 0.035;
    const dir = d0.map((d) => d / l0 + (rt.rng.next() * 2 - 1) * k) as [number, number, number];
    const hit = raycast(rt.world, origin, dir, N(rt, b, ctx, 'range'), rt.world.instances.filter((o) => o !== i && !o.destroyed && o.collider.shape !== 'none' && !o.collider.isTrigger && o.kind !== 'text'), i!);
    if (hit) paintHit(rt, hit.inst, hit.point, hit.normal, S(rt, b, ctx, 'color'), N(rt, b, ctx, 'size'), String(b.params.impact ?? 'sparks'));
  },
  'paint.splat': (rt, b, ctx, i) => {
    // The surface it is heading into (its velocity), else below it.
    const w = rt.world, v: [number, number, number] = [i!.vx, i!.vy, i!.vz], l = Math.hypot(...v);
    const pos = w.worldPos(i!), blockers = w.instances.filter((o) => o !== i && !o.destroyed && o.collider.shape !== 'none' && !o.collider.isTrigger && o.kind !== 'text');
    const dirs: [number, number, number][] = [...(l > 0.01 ? [[v[0] / l, v[1] / l, v[2] / l] as [number, number, number]] : []), [0, -1, 0], [1, 0, 0], [-1, 0, 0], ...(w.plane === 'xz' ? [[0, 0, 1], [0, 0, -1]] as [number, number, number][] : [])];
    for (const d of dirs) {
      const hit = raycast(w, pos, d, 1.5, blockers, i!);
      if (hit) { paintHit(rt, hit.inst, hit.point, hit.normal, S(rt, b, ctx, 'color'), N(rt, b, ctx, 'size'), 'none'); return; }
    }
  },
  'paint.clear': (rt, b) => {
    const what = String(b.params.what ?? 'all');
    rt.decals = rt.decals.filter((d) => { const pool = d.pool ?? 'holes'; return what === 'all' ? !pool.startsWith('paint') : what === 'trails' ? !pool.startsWith('paint:') : pool !== 'paintgun'; });
  },  'voxel.dig_view': (rt, b, ctx, i) => voxelEditView(rt, i!, b, ctx, false),
  'voxel.build_view': (rt, b, ctx, i) => voxelEditView(rt, i!, b, ctx, true),
  'voxel.dig_at': (rt, b, ctx, i) => {
    const g = rt.world.voxelGrid(i!); if (!g) throw new Error(`${i!.name} is not voxel terrain`);
    const changed = editSphere(g, [N(rt, b, ctx, 'x'), N(rt, b, ctx, 'y'), N(rt, b, ctx, 'z')], N(rt, b, ctx, 'radius'), VOXEL.air);
    i!.vars.lastDug = Object.values(changed).reduce((a, n) => a + n, 0); i!.vars.lastGold = changed[VOXEL.gold] ?? 0;
    if (i!.vars.lastDug) rt.world.solidsVersion++;
  },
  'combat.knockback': (rt, b, ctx, i) => {
    const o = rt.picked(ctx, String(b.params.other))[0]; if (!o) return;
    const s = N(rt, b, ctx, 'strength');
    const [a1, b1] = planeAB(rt.world, o), [a2, b2] = planeAB(rt.world, i!);
    const da = a2 - a1, db = b2 - b1, l = Math.hypot(da, db) || 1;
    if (rt.world.plane === 'xz') { i!.vx += (da / l) * s; i!.vz += (db / l) * s; i!.vy += s * 0.3; moveInst(rt, i!, (da / l) * 0.3, 0, (db / l) * 0.3); }
    else { i!.vx += (da / l) * s; i!.vy += Math.abs(db / l) * s * 0.5 + s * 0.3; }
  },
  'combat.equip': (rt, b, _c, i) => {
    const w = String(b.params.weapon);
    i!.vars.weapon = w;
    for (const c of rt.world.instances) {
      if (c.parent !== i!.uid || !c.tags.includes('weapon')) continue;
      c.visible = w.toLowerCase() !== 'none' && (c.name.toLowerCase() === w.toLowerCase() || c.type.toLowerCase() === w.toLowerCase());
    }
  },
  'combat.switch_weapon': (rt, b, ctx, i) => {
    const list = String(b.params.weapons).split(',').map((s) => s.trim()).filter(Boolean);
    if (!list.length) return;
    const cur = list.findIndex((w) => w.toLowerCase() === String(i!.vars.weapon ?? '').toLowerCase());
    const next = list[(cur + 1) % list.length];
    ACTIONS['combat.equip'](rt, { ...b, params: { weapon: next } }, ctx, i);
  },
  'object.respawn': (rt, b, ctx, i) => {
    i!.x = N(rt, b, ctx, 'x'); i!.y = N(rt, b, ctx, 'y'); i!.z = N(rt, b, ctx, 'z'); i!.vx = i!.vy = i!.vz = 0;
    const st = i!.state.health; if (st) { st.hp = st.max; st.dead = false; }
    if (i!.state.car) i!.state.car.speed = 0;
  },
  // ---- AI
  'pathfinding.find_path': (rt, b, ctx, i) => { const x = N(rt, b, ctx, 'x'), y = N(rt, b, ctx, 'y'), z = N(rt, b, ctx, 'z'); requestPath(rt, i!, x, rt.world.plane === 'xz' ? z : y); },
  'pathfinding.move_to_object': (rt, b, _c, i) => {
    let best: RInstance | null = null, bd = Infinity;
    for (const o of rt.world.of(String(b.params.other))) { const d = rt.world.planarDistance(i!, o); if (d < bd) { bd = d; best = o; } }
    if (!best) return;
    const [ta, tb] = planeAB(rt.world, best);
    // Re-plan only when the target moved noticeably (keeps chase cheap every tick).
    const prev = i!.state.path?.target;
    if (prev && i!.state.path.points.length && Math.hypot(prev[0] - ta, prev[1] - tb) < 0.75) return;
    requestPath(rt, i!, ta, tb);
  },
  'pathfinding.stop': (_rt, _b, _c, i) => { if (i!.state.path) i!.state.path.points = []; i!.vx = i!.vz = 0; },
  'ai.patrol': (rt, b, ctx, i) => {
    const home = rt.startPositions.get(i!.uid) ?? [i!.x, i!.y, i!.z];
    const r = N(rt, b, ctx, 'radius');
    for (let tries = 0; tries < 6; tries++) {
      const a = rt.rng.next() * Math.PI * 2, d = r * (0.4 + 0.6 * rt.rng.next());
      const ta = home[0] + Math.cos(a) * d, tb = (rt.world.plane === 'xz' ? home[2] : home[1]) + Math.sin(a) * d;
      if (requestPath(rt, i!, ta, tb)) return;
    }
  },
  'ai.flee': (rt, b, ctx, i) => {
    const o = rt.picked(ctx, String(b.params.other))[0]; if (!o) return;
    const [a1, b1] = planeAB(rt.world, o), [a2, b2] = planeAB(rt.world, i!);
    const da = a2 - a1, db = b2 - b1, l = Math.hypot(da, db) || 1, d = N(rt, b, ctx, 'distance');
    requestPath(rt, i!, a2 + (da / l) * d, b2 + (db / l) * d);
  },
  'ai.set_state': (_rt, b, _c, i) => { i!.vars.state = String(b.params.state); },
  'npc.set_path_paused': (rt, b, ctx, i) => { const st = (i!.state.pathf ??= { index: 0, dir: 1, wait: 0, done: false }); st.paused = truthy(P(rt, b, ctx, 'paused')); },
  'npc.restart_path': (rt, b, ctx, i) => {
    const n = i!.path?.points.length ?? 0;
    i!.state.pathf = { index: Math.max(0, Math.min(n - 1, Math.round(N(rt, b, ctx, 'index')))), dir: 1, wait: 0, done: false, paused: false };
  },
  'npc.interact_now': (rt, _b, _c, i) => {
    const st = (i!.state.npc ??= { mode: 'idle', t: 0, check: 0, cooldown: 0 });
    if (st.mode === 'talk') return;
    st.mode = 'talk'; st.t = 0; i!.state.npcBusy = true;
    rt.queueTrigger('npc.on_interact', { [i!.type]: [i!] });
    const name = String(rt.world.behavior(i!, 'npctalk')?.props.dialogue ?? '').trim();
    st.ownDialogue = !!name && !rt.dialogue;
    if (st.ownDialogue) startDialogue(rt, name);
  },
  'npc.end_interaction': (rt, _b, _c, i) => {
    const st = i!.state.npc; if (!st || st.mode === 'idle') return;
    if (st.ownDialogue && rt.dialogue) endDialogue(rt, '');
    st.mode = 'idle'; st.cooldown = Number(rt.world.behavior(i!, 'npctalk')?.props.cooldown ?? 0); i!.state.npcBusy = false;
    rt.queueTrigger('npc.on_interact_end', { [i!.type]: [i!] });
  },
  'enemy.set_target': (_rt, b, _c, i) => {
    for (const bh of i!.behaviors) if (['slime', 'flyer', 'npctalk', 'enemy'].includes(bh.type)) bh.props.target = String(b.params.other);
  },
  // ---- timers
  'timer.start': (rt, b, ctx, i) => {
    ensureBehavior(rt, i!, 'timer');
    const d = Math.max(0.0001, N(rt, b, ctx, 'duration'));
    (i!.state.timers ??= {})[String(b.params.tag)] = { left: d, dur: d, repeat: b.params.mode === 'regular' };
  },
  'timer.stop': (_rt, b, _c, i) => { if (i!.state.timers) delete i!.state.timers[String(b.params.tag)]; },
  // ---- audio
  'audio.play': (rt, b, ctx) => rt.opts.host?.playSound?.(String(b.params.sound), N(rt, b, ctx, 'volume') / 100, {}),
  'audio.play_at': (rt, b, ctx, i) => rt.opts.host?.playSound?.(String(b.params.sound), N(rt, b, ctx, 'volume') / 100, { position: rt.world.worldPos(i!) }),
  'audio.play_music': (rt, b, ctx) => rt.opts.host?.playSound?.(String(b.params.sound), N(rt, b, ctx, 'volume') / 100, { loop: true, music: true }),
  'audio.stop': (rt, b) => rt.opts.host?.stopSound?.(String(b.params.what)),
  'audio.set_volume': (rt, b, ctx) => rt.opts.host?.setVolume?.(N(rt, b, ctx, 'volume') / 100),
  'audio.set_effect': (rt, b) => rt.opts.host?.setAudioEffect?.(String(b.params.effect)),
  // ---- particles
  'particles.spawn': (rt, b, ctx) => spawnLayers(rt, String(b.params.preset), [N(rt, b, ctx, 'x'), N(rt, b, ctx, 'y'), N(rt, b, ctx, 'z')]),
  'particles.spawn_at': (rt, b, _c, i) => spawnLayers(rt, String(b.params.preset), rt.world.worldPos(i!), rt.world.angle(i!)),
  'particles.attach': (rt, b, _c, i) => {
    const id = `att:${i!.uid}:${b.params.preset}`;
    if (rt.emitters.has(id)) { for (const e of emittersOf(rt, i!)) if (e.id === id || e.id.startsWith(id + '#')) e.restart(); return; }
    linkEmitters(rt.presetLayers(String(b.params.preset)).map((name, k) => {
      const e = rt.makeEmitter(k ? `${id}#${k + 1}` : id, name);
      e.attachedUid = i!.uid; e.position = rt.world.worldPos(i!);
      rt.emitters.set(e.id, e);
      return e;
    }));
  },
  'particles.set_exposed': (rt, b, ctx, i) => {
    // ParticleCraft exposed parameter: a named control that drives the effect's layers at runtime.
    const name = String(b.params.name).toLowerCase();
    const v = P(rt, b, ctx, 'value');
    for (const e of emittersOf(rt, i!)) {
      const ex = customVfxExposed.get(e.presetName.split('#')[0])?.find((x) => x.name.toLowerCase() === name);
      if (!ex) continue;
      const layer = e.presetName.includes('#') ? Number(e.presetName.split('#')[1]) - 1 : 0;
      for (const t of ex.targets) if (t.layer === layer) e.setParams({ [t.param]: typeof v === 'string' && !/^-?\d/.test(v) ? v : Number(v) } as any);
    }
  },
  'particles.burst': (rt, b, ctx, i) => { const es = emittersOf(rt, i!); if (!es.length) throw new Error(`${i!.type} has no particle emitter (use an Emitter object or "Attach effect")`); for (const e of es) e.burst(Math.floor(N(rt, b, ctx, 'count'))); },
  'particles.start': (rt, _b, _c, i) => { for (const e of emittersOf(rt, i!)) e.restart(); },
  'particles.stop': (rt, _b, _c, i) => { for (const e of emittersOf(rt, i!)) e.emitting = false; },
  'particles.set_param': (rt, b, ctx, i) => { for (const e of emittersOf(rt, i!)) e.setParams({ [String(b.params.param)]: N(rt, b, ctx, 'value') }); },
  'particles.set_color': (rt, b, _c, i) => { for (const e of emittersOf(rt, i!)) e.setParams({ colorStart: String(b.params.start), colorEnd: String(b.params.end) }); },
  // ---- camera & effects
  'camera.shake': (rt, b, ctx) => { rt.camera.shakeIntensity = N(rt, b, ctx, 'intensity'); rt.camera.shakeUntil = rt.wallTime + N(rt, b, ctx, 'duration'); },
  'camera.set_active': (rt, _b, _c, i) => { for (const c of rt.world.instances) if (c.camera) c.camera.active = c === i; rt.postfxVersion++; },
  'camera.view_step': (rt, b) => {
    const cams = camerasOf(rt, String(b.params.group ?? '')); if (!cams.length) return;
    const at = cams.findIndex((c) => c.camera?.active);
    showCamera(rt, cams[(at + (b.params.direction === 'previous' ? -1 : 1) + cams.length) % cams.length]);
  },
  'camera.view_number': (rt, b, ctx) => { const c = camerasOf(rt, String(b.params.group ?? ''))[Math.round(N(rt, b, ctx, 'number')) - 1]; if (c) showCamera(rt, c); },
  'camera.view_named': (rt, b) => { const n = String(b.params.name ?? '').toLowerCase(); const c = rt.world.instances.find((x) => !x.destroyed && x.camera && (x.name ?? x.type).toLowerCase() === n); if (c) showCamera(rt, c); },
  'rope.release': (rt, _b, _c, i) => releaseRope(rt as any, i!),
  'rope.set_length': (rt, b, ctx, i) => { const r = rt.world.behavior(i!, 'rope'); if (r) r.props.length = Math.max(0.05, N(rt, b, ctx, 'length')); },
  'path.follow': (rt, b, ctx, i) => {
    const routes = readPaths(b.params.paths).paths.map((r, k) => ({ r, k })).filter((x) => x.r.length);
    if (!routes.length) { rt.opts.host?.log?.('warn', `Follow path on ${i!.type}: no path drawn yet (press Draw path on the brick)`); return; }
    const st = i!.state.pathBrick;
    const pick = b.params.pick;
    const turn = (st?.turn ?? -1) + 1;
    const chosen = pick === 'first' ? routes[0] : pick === 'in order' ? routes[turn % routes.length] : routes[Math.min(routes.length - 1, Math.floor(rt.rng.next() * routes.length))];
    let beh = rt.world.behavior(i!, 'pathfollow');
    if (!beh) { beh = { type: 'pathfollow', props: behaviorDefaults('pathfollow') }; i!.behaviors.push(beh); }
    Object.assign(beh.props, { enabled: true, speed: N(rt, b, ctx, 'speed'), mode: b.params.mode, wait: Math.max(0, N(rt, b, ctx, 'wait')), faceDirection: b.params.face !== false, startDelay: 0 });
    i!.path = { points: chosen.r.map((pt) => [pt[0], pt[1], pt[2]] as [number, number, number]) };
    i!.state.pathf = { index: 0, dir: 1, wait: 0, done: false, paused: false };
    i!.state.pathBrick = { number: chosen.k + 1, turn, stopped: false };
  },
  'path.stop': (_rt, _b, _c, i) => { if (i!.state.pathf) i!.state.pathf.done = true; if (i!.state.pathBrick) i!.state.pathBrick.stopped = true; },
  'path.set_paused': (rt, b, ctx, i) => { if (i!.state.pathf) i!.state.pathf.paused = truthy(P(rt, b, ctx, 'paused')); },
  'path.set_speed': (rt, b, ctx, i) => { const beh = rt.world.behavior(i!, 'pathfollow'); if (beh) beh.props.speed = Math.max(0, N(rt, b, ctx, 'speed')); },
  'mic.start': (rt, b, ctx) => { void mic.start(N(rt, b, ctx, 'threshold')); },
  'mic.stop': () => mic.stop(),
  'mic.monitor': (rt, b, ctx) => mic.monitor(b.params.on !== false, N(rt, b, ctx, 'volume')),
  'webcam.start': (rt, b, ctx) => { void webcam.start(N(rt, b, ctx, 'threshold')); },
  'webcam.stop': () => webcam.stop(),
  'webcam.show_on': (_rt, b, _c, i) => { if (b.params.on !== false) webcam.shownOn.add(i!.uid); else webcam.shownOn.delete(i!.uid); },
  'camera.set_focal_length': (rt, b, ctx, i) => { if (i!.camera) i!.camera.focalLength = Math.max(1, N(rt, b, ctx, 'mm')); },
  'camera.set_clipping': (rt, b, ctx, i) => { if (i!.camera) { i!.camera.clipStart = Math.max(0.001, N(rt, b, ctx, 'near')); i!.camera.clipEnd = N(rt, b, ctx, 'far'); } },
  'camera.set_zoom': (rt, b, ctx) => { rt.camera.zoom = Math.max(0.05, N(rt, b, ctx, 'zoom')); },
  'postfx.apply_preset': (rt, b) => { const cam = activeCameraPostfx(rt); const pr = POSTFX_PRESETS[String(b.params.preset)]; if (cam && pr) { cam.postfx = pr.stack(); rt.postfxVersion++; } },
  'postfx.set_enabled': (rt, b) => { const e = effectOn(rt, String(b.params.effect)); if (e) e.enabled = b.params.state !== 'disabled'; },
  'postfx.set_param': (rt, b, ctx) => { const e = effectOn(rt, String(b.params.effect)); if (e) { e.params[String(b.params.param)] = P(rt, b, ctx, 'value'); e.enabled = true; } },
  'postfx.set_bloom': (rt, b, ctx) => { const e = effectOn(rt, 'bloom'); if (e) { e.params.strength = N(rt, b, ctx, 'value'); e.enabled = true; } },
  'postfx.set_pixelation': (rt, b, ctx) => { const e = effectOn(rt, 'pixelate'); if (e) { const v = N(rt, b, ctx, 'value'); e.params.pixelSize = Math.max(1, v); e.enabled = v > 0; } },
  'postfx.set_ps1': (rt, b) => { const e = effectOn(rt, 'ps1'); if (e) e.enabled = b.params.state !== 'disabled'; },
  'postfx.set_vignette': (rt, b, ctx) => { const e = effectOn(rt, 'vignette'); if (e) { e.params.amount = N(rt, b, ctx, 'value'); e.enabled = true; } },
  'postfx.set_dof': (rt, b, ctx) => { const e = effectOn(rt, 'dof'); if (e) { e.params.focus = N(rt, b, ctx, 'focus'); e.params.fstop = N(rt, b, ctx, 'fstop'); e.enabled = true; } },
  'postfx.color_grade': (rt, b, ctx) => { const e = effectOn(rt, 'colorgrade'); if (e) { e.params.saturation = N(rt, b, ctx, 'saturation'); e.params.contrast = N(rt, b, ctx, 'contrast'); e.params.temperature = N(rt, b, ctx, 'temperature'); e.enabled = true; } },
  // ---- UI
  'input.set_cursor': (rt, b) => { const m = String(b.params.mode ?? 'locked'); rt.ui.cursor = m === 'visible' || m === 'hidden' ? m : 'locked'; },
  'ui.show_message': (rt, b, ctx) => { rt.ui.message = { text: S(rt, b, ctx, 'text'), until: rt.wallTime + N(rt, b, ctx, 'seconds') }; },
  'ui.set_text': (rt, b, ctx, i) => { if (!i!.text) throw new Error(`${i!.type} is not a text object`); i!.text.text = S(rt, b, ctx, 'text'); },
  'ui.set_bar': (rt, b, ctx, i) => { (i as any).bar = { value: N(rt, b, ctx, 'value'), max: Math.max(1e-6, N(rt, b, ctx, 'max')) }; },
  'ui.show_menu': (rt, b) => { const t = String(b.params.tag); rt.ui.hiddenTags.delete(t); for (const i of rt.world.instances) if (i.tags.includes(t)) i.visible = true; },
  'ui.hide_menu': (rt, b) => { const t = String(b.params.tag); rt.ui.hiddenTags.add(t); for (const i of rt.world.instances) if (i.tags.includes(t)) i.visible = false; },
  // ---- game flow
  'game.pause': (rt) => { rt.timeScale = 0; },
  'net.show_menu': (rt) => rt.opts.host?.openMultiplayer?.(),
  'game.resume': (rt) => { if (!rt.gameOver) rt.timeScale = 1; },
  'system.set_timescale': (rt, b, ctx) => { rt.timeScale = Math.max(0, N(rt, b, ctx, 'scale')); },
  'game.restart': (rt) => rt.requestRestart(null),
  // Older saves have only "scene": they keep the old behavior (instant, variables reset).
  'camera.set_view': (_rt, b, _c, i) => {
    if (i!.kind !== 'camera') throw new Error(`${i!.name} is not a camera`);
    const cur = i!.camera?.preset?.turn ?? 0, t = String(b.params.turn ?? 'keep');
    const turn = t === 'left' ? cur + 1 : t === 'right' ? cur + 3 : t === 'keep' ? cur : Number(t) || 0;
    applyCameraView(i!, (String(b.params.preset ?? 'iso21') as CameraPresetId), turn);
  },
  'world.generate_rooms': (rt, b, ctx, i) => {
    generateIntoTilemap(rt.world, i!, roomOpts(rt, b, ctx), N(rt, b, ctx, 'decor'));
    rt.fireObjectTrigger('world.on_rooms_generated', i!);
  },
  'world.generate_rooms_3d': (rt, b, ctx, i) => {
    const opt = (k: string) => String(b.params[k] ?? '').trim() || undefined;
    generate3D(rt.world, i!, roomOpts(rt, b, ctx), { floor: String(b.params.floor), wall: String(b.params.wall), door: opt('door'), decor: opt('decorType') }, Math.max(0.1, N(rt, b, ctx, 'cell')), N(rt, b, ctx, 'decor'));
    rt.fireObjectTrigger('world.on_rooms_generated', i!);
  },
  'world.populate_rooms': (rt, b, ctx, i) => {
    populateRooms(rt.world, i!, { seed: N(rt, b, ctx, 'seed'), treasure: N(rt, b, ctx, 'chance'), enemies: N(rt, b, ctx, 'enemies'), difficulty: N(rt, b, ctx, 'difficulty') }, { enemy: String(b.params.enemy ?? '').trim() || undefined, treasure: String(b.params.treasure ?? '').trim() || undefined });
  },
  'world.move_to_room': (rt, b, ctx, i) => {
    const st = i!.state.rooms as RoomsState | undefined;
    if (!st) throw new Error(`${i!.name} has no rooms yet: use Generate rooms (or Build 3D rooms) first`);
    for (const o of rt.picked(ctx, String(b.params.object))) {
      const [c, r] = roomSpot(st, String(b.params.which ?? 'start'), () => rt.rng.next());
      const [x, y, z] = roomCellWorld(rt.world, i!, st, c, r);
      // Stand on the floor: keep the object's own height above it (its pivot may be at its middle).
      const bb = rt.world.aabb(o), lift = o.y - bb[1];
      o.x = x; o.vx = 0; o.vy = 0; o.vz = 0;
      if (rt.world.plane === 'xz') { o.z = z; o.y = y + lift + 0.01; } else o.y = y;
    }
  },
  'game.cover_screen': (rt, b, ctx) => rt.coverScreen(String(b.params.transition ?? 'fade'), b.params.duration != null ? N(rt, b, ctx, 'duration') : 0.5, b.params.color != null ? String(b.params.color) : undefined, pic(b, 'picture'), pic(b, 'cover')),
  'game.uncover_screen': (rt, b, ctx) => rt.uncoverScreen(b.params.duration != null ? N(rt, b, ctx, 'duration') : 0.5),
  'game.load_scene': (rt, b, ctx) => rt.changeScene(String(b.params.scene), {
    transition: String(b.params.transition ?? 'none'), color: b.params.color != null ? String(b.params.color) : undefined, picture: pic(b, 'picture'), cover: pic(b, 'cover'), duration: b.params.duration != null ? N(rt, b, ctx, 'duration') : 0.5,
    keep: b.params.keep == null ? 'none' : String(b.params.keep), data: b.params.data != null ? P(rt, b, ctx, 'data') : '',
  }),
  'game.set_checkpoint': (rt, _b, _c, i) => { rt.checkpoints.set(i!.uid, [i!.x, i!.y, i!.z]); },
  'game.respawn_checkpoint': (rt, _b, _c, i) => {
    const p = rt.checkpoints.get(i!.uid) ?? rt.startPositions.get(i!.uid) ?? [i!.x, i!.y, i!.z];
    i!.x = p[0]; i!.y = p[1]; i!.z = p[2]; i!.vx = i!.vy = i!.vz = 0;
    if (i!.state.car) i!.state.car.speed = 0;
  },
  'game.victory': (rt, b, ctx) => { rt.ui.screen = { kind: 'victory', title: S(rt, b, ctx, 'title'), message: S(rt, b, ctx, 'message') }; rt.gameOver = true; rt.timeScale = 0; },
  'game.defeat': (rt, b, ctx) => { rt.ui.screen = { kind: 'defeat', title: S(rt, b, ctx, 'title'), message: S(rt, b, ctx, 'message') }; rt.gameOver = true; rt.timeScale = 0; },
  // ---- animation
  'anim.play': (rt, b, _c, i) => {
    const name = String(b.params.name);
    const loop = b.params.loop === 'loop';
    i!.animation = name;
    (i as any).animLoop = loop;
    const clip = rt.scene.animations?.find((c) => c.name === name);
    if (clip) {
      const prev = rt.clips.get(i!.uid);
      const base: Record<string, number> = {};
      for (const tr of clip.tracks) base[tr.property] = prev?.base[tr.property] ?? rt.settable(i!, tr.property);
      rt.clips.set(i!.uid, { name, t: 0, loop, base });
    } else if (i!.sprite?.animations?.[name] && !loop) {
      const a = i!.sprite.animations[name];
      i!.state.animTimer = { name, left: (a.to - a.from + 1) / Math.max(1, a.fps) };
    }
  },
  'anim.set_role': (_rt, b, _c, i) => {
    const role = String(b.params.role ?? 'idle'), clip = String(b.params.clip ?? '').trim();
    const orig = ((i!.state.origRoles ??= { ...(i!.mesh?.animMap ?? {}) }) as Record<string, string>)[role];
    const val = clip || orig;
    if (i!.mesh) { const m = { ...(i!.mesh.animMap ?? {}) }; if (val) m[role] = val; else delete m[role]; i!.mesh = { ...i!.mesh, animMap: m }; }
    if (i!.animRoles) { i!.animRoles = { ...i!.animRoles }; if (val) i!.animRoles[role] = val; else delete i!.animRoles[role]; }
  },
  'model.rotate_part': (rt, b, ctx, i) => {
    const part = String(b.params.part ?? '').trim(); if (!part) return;
    const parts = (i!.state.parts ??= {}) as Record<string, PartSwing>;
    const prev = parts[part];
    parts[part] = { hinge: String(b.params.hinge ?? 'front edge'), from: prev ? partAngle(prev, rt.time) : 0, to: N(rt, b, ctx, 'angle'), t0: rt.time, dur: Math.max(0, N(rt, b, ctx, 'seconds')) };
  },
  'anim.set_speed': (rt, b, ctx, i) => { i!.state.animSpeed = Math.max(0, N(rt, b, ctx, 'speed')); },
  'vr.vibrate': (rt, b, ctx) => rt.input.vibrate(String(b.params.hand ?? 'right') as 'left' | 'right' | 'both', N(rt, b, ctx, 'strength'), N(rt, b, ctx, 'seconds') * 1000),
  'proc.legs': (rt, b, ctx, i) => procSet(rt, i!, { stepLength: N(rt, b, ctx, 'stride'), stepHeight: N(rt, b, ctx, 'height'), stepSpeed: N(rt, b, ctx, 'speed') }),
  'proc.ground': (rt, b, ctx, i) => procSet(rt, i!, { groundDetect: b.params.state !== 'off', surfaceAdapt: Math.max(0, Math.min(1, N(rt, b, ctx, 'adapt'))) }),
  'proc.feet': (rt, b, ctx, i) => procSet(rt, i!, { responsiveness: Math.max(0.2, N(rt, b, ctx, 'resp')), bob: N(rt, b, ctx, 'bob') }),
  'proc.body': (rt, b, ctx, i) => procSet(rt, i!, { armSwing: N(rt, b, ctx, 'arms'), wave: N(rt, b, ctx, 'wave'), idle: N(rt, b, ctx, 'idle'), animSpeed: Math.max(0, N(rt, b, ctx, 'speed')) }),
  'proc.climb': (rt, b, ctx, i) => procSet(rt, i!, { climbWalls: b.params.state !== 'off', climbSpeed: Math.max(0.1, N(rt, b, ctx, 'speed')) }),
  'proc.reach': (rt, b, ctx, i) => {
    const st = (i!.state.procanim ??= {});
    const t = String(b.params.target ?? '').trim();
    const o = t ? rt.world.instances.filter((x) => !x.destroyed && x.type.toLowerCase() === t.toLowerCase() && x !== i).sort((a, z) => Math.hypot(a.x - i!.x, a.z - i!.z) - Math.hypot(z.x - i!.x, z.z - i!.z))[0] : undefined;
    st.reachAt = o ? o.uid : null;
  },
  'proc.ragdoll': (rt, b, ctx, i) => {
    const f = N(rt, b, ctx, 'force'), a = (rt.world.angle(i!) * Math.PI) / 180;
    startRagdoll(rt, i!, rt.world.plane === 'xz' ? [Math.cos(a) * f, 0, -Math.sin(a) * f] : [Math.cos(a) * f, 0, 0]);
  },
  'proc.get_up': (_rt, _b, _c, i) => { const st = procState(i!); st.ragdoll = null; },
  'proc.look_at': (rt, b, _c, i) => {
    const me = i!, others = rt.world.instances.filter((o) => !o.destroyed && o !== me && o.type === String(b.params.target));
    let best: RInstance | null = null, bd = Infinity;
    for (const o of others) { const d = Math.hypot(o.x - me.x, o.y - me.y, o.z - me.z); if (d < bd) { bd = d; best = o; } }
    procState(me).lookAt = best?.uid ?? null;
  },
  // ---- world: sky, lights, glow
  'sky.set_time': (rt, b, ctx) => { const s = (rt.scene.settings.sky ??= { ...DEFAULT_SKY }); s.enabled = true; s.time = ((N(rt, b, ctx, 'hours') % 24) + 24) % 24; },
  'sky.set_cycle': (rt, b, ctx) => { const s = (rt.scene.settings.sky ??= { ...DEFAULT_SKY }); s.enabled = true; s.cycle = b.params.state !== 'off'; s.dayLength = Math.max(1, N(rt, b, ctx, 'seconds')); },
  'light.set_power': (rt, b, ctx, i) => { if (!i!.light) return; i!.light = { ...i!.light, power: Math.max(0, N(rt, b, ctx, 'value')) }; delete i!.state.flicker; },
  'light.set_color': (_rt, b, _c, i) => { if (i!.light) i!.light = { ...i!.light, color: String(b.params.color) }; },
  'light.flicker': (rt, b, ctx, i) => { if (!i!.light) return; const base = (i!.state.flicker?.base ?? i!.light.power); i!.light = { ...i!.light }; i!.state.flicker = { base, until: rt.time + N(rt, b, ctx, 'seconds') }; },
  'light.set_emission': (rt, b, ctx) => { rt.scene.settings.emissionScale = Math.max(0, N(rt, b, ctx, 'percent')) / 100; },
  'light.set_ambient': (rt, b, ctx) => { const w = (rt.scene.settings.world ??= { color: '#5c6370', strength: 0.6 }); w.strength = Math.max(0, N(rt, b, ctx, 'value')); },
  'anim.stop': (rt, _b, _c, i) => {
    const pl = rt.clips.get(i!.uid);
    if (pl) for (const [k, v] of Object.entries(pl.base)) rt.setProp(i!, k, v);
    rt.clips.delete(i!.uid); i!.animation = undefined; delete i!.state.animTimer;
  },
  'anim.tween': (rt, b, ctx, i) => {
    const prop = String(b.params.property);
    rt.tweens = rt.tweens.filter((t) => !(t.inst === i && t.prop === prop));
    rt.tweens.push({ inst: i!, prop, from: rt.settable(i!, prop), to: N(rt, b, ctx, 'value'), dur: Math.max(0, N(rt, b, ctx, 'duration')), t: 0, ease: String(b.params.ease) });
  },
};

function coerceLike(old: any, v: any) {
  if (typeof old === 'number') return toNum(v);
  if (typeof old === 'boolean') return truthy(v);
  if (typeof old === 'string') return toStr(v);
  return v;
}

/** Split "a, f(b, c), "x,y"" at top-level commas. */
export function splitArgs(s: string): string[] {
  const out: string[] = []; let depth = 0, cur = '', q: string | null = null;
  for (const ch of s) {
    if (q) { cur += ch; if (ch === q) q = null; continue; }
    if (ch === '"' || ch === "'") { q = ch; cur += ch; continue; }
    if (ch === '(') depth++; if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

export function unimplementedBlocks(): string[] {
  // (WorldCraft's bricks act on a world's settings, in world/bricks.ts: they never run in a game.)
  return Object.values(BLOCK_DEFS).filter((d) => d.apps.some((a) => a !== 'worldcraft')).filter((d) => d.kind === 'condition' ? !(d.looping ? LOOPS[d.id] : CONDITIONS[d.id]) : !ACTIONS[d.id]).map((d) => d.id);
}
