// Tilemap editing state shared by the panel (tile palette, tools, layers) and the app's scene view (which turns
// mouse presses into cells and calls `toolDown/Move/Up`). Painting happens directly in the scene.
import { autotile, brushCells, copyRect, fill, paint, pasteStamp, rectCells, syncTilemapCollider, terrainPaintTile, usedBounds, type TilemapData } from '../src/tilemap';
import type { InstanceData } from '../src/runtime/scene';

export type TileTool = 'brush' | 'erase' | 'fill' | 'rect' | 'select' | 'pick';
export interface TileToolState {
  /** Painting in the scene is on (the panel's "Paint" toggle). */
  active: boolean;
  tool: TileTool; tile: number; size: number; layer: number;
  /** Auto-tiling with this terrain (index into map.terrains), or -1. */
  terrain: number;
  showCollision: boolean;
  stamp: { w: number; h: number; tiles: (number | -1)[] } | null;
  /** While dragging a rectangle / selection: its corners (cells). */
  drag: { c0: number; r0: number; c1: number; r1: number } | null;
  hover: [number, number] | null;
}

let state: TileToolState = { active: false, tool: 'brush', tile: 0, size: 1, layer: 0, terrain: -1, showCollision: true, stamp: null, drag: null, hover: null };
const subs = new Set<() => void>();
export const tileTools = {
  get: () => state,
  set(p: Partial<TileToolState>) { state = { ...state, ...p }; subs.forEach((f) => f()); },
  subscribe(f: () => void) { subs.add(f); return () => { subs.delete(f); }; },
};

/** Cells the tool would touch now (under the mouse, or the rectangle being dragged) and the outline colour. */
export function previewCells(): { cells: [number, number][]; color: string } | null {
  const s = state;
  if (s.drag) return { cells: rectCells(s.drag.c0, s.drag.r0, s.drag.c1, s.drag.r1).slice(0, 2500), color: s.tool === 'select' ? '#4aa3ff' : '#ffd200' };
  if (!s.active || !s.hover) return null;
  const [c, r] = s.hover;
  if (s.tool === 'brush' && s.stamp) return { cells: rectCells(c, r, c + s.stamp.w - 1, r + s.stamp.h - 1), color: '#ffd200' };
  if (s.tool === 'brush' || s.tool === 'erase') return { cells: brushCells(c, r, s.size), color: s.tool === 'erase' ? '#ff5050' : '#ffd200' };
  return { cells: [[c, r]], color: '#ffd200' };
}

/** Edit `inst` (already a draft the host will commit) for a press / drag / release at cell (c, r). Returns true if it changed. */
export function applyTileTool(inst: InstanceData, phase: 'down' | 'move' | 'up', c: number, r: number): boolean {
  const map = inst.tilemap as TilemapData | undefined; if (!map) return false;
  const s = state, layer = map.layers[Math.min(s.layer, map.layers.length - 1)];
  if (!layer) return false;
  const terrain = s.terrain >= 0 ? map.terrains?.[s.terrain] : undefined;
  const tileFor = () => (terrain ? terrainPaintTile(terrain, s.tile) : s.tile);
  let changed: [number, number][] = [];
  switch (s.tool) {
    case 'brush': case 'erase':
      if (phase === 'up') return false;
      if (s.tool === 'brush' && s.stamp && !terrain) { pasteStamp(layer, s.stamp, c, r); changed = [[c, r]]; break; }
      changed = paint(layer, brushCells(c, r, s.size), s.tool === 'erase' ? -1 : tileFor());
      break;
    case 'fill': {
      if (phase !== 'down') return false;
      const b = usedBounds(map);
      changed = fill(layer, c, r, tileFor(), b ? { c0: b.c0 - 1, r0: b.r0 - 1, c1: b.c1 + 1, r1: b.r1 + 1 } : { c0: c - 20, r0: r - 20, c1: c + 20, r1: r + 20 });
      break;
    }
    case 'rect': case 'select':
      if (phase === 'down') { tileTools.set({ drag: { c0: c, r0: r, c1: c, r1: r } }); return false; }
      if (phase === 'move') { if (s.drag) tileTools.set({ drag: { ...s.drag, c1: c, r1: r } }); return false; }
      if (!s.drag) return false;
      if (s.tool === 'select') { tileTools.set({ stamp: copyRect(layer, s.drag.c0, s.drag.r0, s.drag.c1, s.drag.r1), drag: null, tool: 'brush' }); return false; }
      changed = paint(layer, rectCells(s.drag.c0, s.drag.r0, s.drag.c1, s.drag.r1), tileFor());
      tileTools.set({ drag: null });
      break;
    case 'pick': {
      if (phase !== 'down') return false;
      const t = layer.cells[`${c},${r}`];
      if (t != null) tileTools.set({ tile: t, tool: 'brush', stamp: null });
      return false;
    }
  }
  if (!changed.length) return false;
  if (terrain) autotile(layer, terrain, changed);
  syncTilemapCollider(inst);
  return true;
}
