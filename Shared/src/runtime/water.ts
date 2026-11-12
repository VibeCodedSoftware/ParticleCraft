// Water volumes: any object with the Water behavior is a body of water (its box is the volume, its top is the
// surface). Characters swim in it, physics bodies float, and the camera underwater muffles sound and tints the view.
import type { RInstance, World } from './world';
import type { InstanceData } from './scene';
import { materialSlots } from '../materialMaps';

/** How a new body of water looks (Material › Surface: Water). */
export const WATER_LOOK = { color: '#2a7fd4', opacity: 60, ripples: true, rippleStrength: 0.6, rippleSpeed: 1, rippleScale: 4 };

/**
 * Stylised (cartoon) water: an animated, seamless 40-frame texture (8 × 5 sheet, "Animated water texture 128px" by
 * YCbCr, CC0, opengameart.org) played on the Base color slot.
 */
export const WATER_STYLISED = 'lib:library/effects/WaterStylised_8x5.png';
export const stylisedWaterSlot = () => ({ asset: WATER_STYLISED, tiling: [0, 0] as [number, number], offset: [0, 0] as [number, number], rotation: 0, animated: { frames: 40, cols: 8, rows: 5, fps: 20, scroll: [0, 0] as [number, number], spin: 0 } });
export const isStylisedWater = (i: InstanceData) => i.material?.maps?.color?.asset === WATER_STYLISED;
/** The water shows a picture (Toon or the user's own) instead of realistically seeing through to what is under it. */
export const hasWaterImage = (i: InstanceData) => !!materialSlots(i.material).color?.asset;

/** Defaults of the water look's options (all off until switched on). */
export const WATER_FX = { waveHeight: 0.15, waveLength: 4, waveSpeed: 1, detail: 1, highlights: 1, wakeStrength: 1, foamWidth: 0.35, foamColor: '#ffffff', toonFoam: 0, deepColor: '#0b3a66', clarity: 0, causticsStrength: 1 };

/** The object is drawn as water: its material says so, or (older objects) it has the Water behavior. */
export function isWaterSurface(i: InstanceData): boolean {
  return i.material?.surface === 'water' || (i.material?.surface === undefined && i.behaviors.some((b) => b.type === 'water'));
}

/** A new body of water also looks like water (Material › Surface), unless its material was already chosen. */
export function applyWaterLook(i: InstanceData) {
  if (i.material?.surface !== undefined) return;
  i.material = { emissive: '#000000', emissiveStrength: 0, ...i.material, surface: 'water', ripples: true, ...glossy(i.material) };
  i.color = WATER_LOOK.color; i.opacity = WATER_LOOK.opacity;
}

/** Every new object starts with the same matte material: left on water, it shows no ripples or glints. A chosen finish stays. */
const glossy = (m: InstanceData['material']) => (!m || (m.roughness === 0.6 && m.metalness === 0) ? { roughness: 0.08, metalness: 0.1 } : { roughness: m.roughness, metalness: m.metalness });

/** Water saved with that matte default (a bug in how the Water behavior set up its look) gets its gloss back. */
export function migrateMatteWater(i: InstanceData): boolean {
  if (i.material?.surface !== 'water' || i.material.roughness !== 0.6 || i.material.metalness !== 0) return false;
  i.material = { ...i.material, roughness: 0.08, metalness: 0.1 };
  return true;
}

/**
 * Older projects kept the water's look on the Water behavior (Color, Opacity, Animated surface). It now lives in the
 * object's Material (Surface: Water) and its own colour / opacity; the behavior only does the physics.
 */
export function migrateWaterLook(i: InstanceData): boolean {
  const w = i.behaviors.find((b) => b.type === 'water');
  if (!w || !('color' in w.props || 'opacity' in w.props || 'waves' in w.props)) return false;
  i.color = String(w.props.color ?? WATER_LOOK.color);
  i.opacity = Math.round(Number(w.props.opacity ?? 0.6) * 100);
  i.material = { roughness: 0.08, metalness: 0.1, emissive: '#000000', emissiveStrength: 0, ...i.material, surface: 'water', ripples: w.props.waves !== false, rippleStrength: i.material?.rippleStrength ?? WATER_LOOK.rippleStrength, rippleSpeed: i.material?.rippleSpeed ?? WATER_LOOK.rippleSpeed };
  delete w.props.color; delete w.props.opacity; delete w.props.waves;
  return true;
}

export interface WaterInfo { volume: RInstance; props: Record<string, any>; surface: number; depth: number }

const cache = new WeakMap<World, { tick: number; list: RInstance[] }>();

/** Water volumes in the world (re-collected once per tick). */
export function waterVolumes(world: World): RInstance[] {
  const c = cache.get(world);
  if (c && c.tick === world.tick) return c.list;
  const list = world.instances.filter((i) => !i.destroyed && world.hasBehavior(i, 'water') && world.behavior(i, 'water')?.props.enabled !== false);
  cache.set(world, { tick: world.tick, list });
  return list;
}

/** The water an object is in (its center, or a point for cameras), with the surface height and depth below it. */
export function waterAt(world: World, inst: RInstance, point = false): WaterInfo | null {
  const list = waterVolumes(world);
  if (!list.length) return null;
  let cx: number, cy: number, cz: number;
  if (point) [cx, cy, cz] = inst.parent != null ? world.worldPos(inst) : [inst.x, inst.y, inst.z];
  else { const b = world.aabb(inst); cx = (b[0] + b[3]) / 2; cy = (b[1] + b[4]) / 2; cz = (b[2] + b[5]) / 2; }
  for (const v of list) {
    if (v === inst) continue;
    const b = world.aabb(v);
    const inside = cx >= b[0] && cx <= b[3] && cy >= b[1] && cy <= b[4] && (world.plane === 'xy' || (cz >= b[2] && cz <= b[5]));
    if (inside) return { volume: v, props: world.behavior(v, 'water')!.props, surface: b[4], depth: b[4] - cy };
  }
  return null;
}
