// Editor state store with undo/redo snapshots and autosave. React subscribes via useStore().
import { useSyncExternalStore } from 'react';
import { deepClone } from '@shared/src/schema';
import { syncTexts } from '@shared/src/textSync';
import type { InstanceData, SceneData } from '@shared/src/runtime/scene';
import type { GameProject } from './types';
import { api } from './api';

export type Workspace = 'Layout' | 'Scripting' | 'Effects' | 'Animation';
export interface LogEntry { level: 'info' | 'warn' | 'error'; message: string; time: number; blockId?: string; eventId?: string }

export interface EditorState {
  project: GameProject | null;
  sceneId: string;
  selection: number[];
  play: 'edit' | 'play' | 'paused';
  dirty: boolean;
  lastSaved: number;
  logs: LogEntry[];
  workspace: Workspace;
  panels: Record<string, boolean>;
  logicView: 'sheet' | 'blocks';
  focusBlockId: string | null;
  shading: 'wireframe' | 'solid' | 'rendered';
  tool: 'select' | 'move' | 'rotate' | 'scale';
  space: 'world' | 'local';
  snap: { on: boolean; move: number; rotate: number; scale: number };
  tutorialStep: number | null;
  rev: number;
  bottomTab: string;
  rightTab: string;
  showColliders: boolean;
  /** Viewport Collision View: colliders filled and coloured by what they do, the rest ghosted. */
  collisionView: boolean;
  /** Object whose NPC path is being drawn (clicks in the viewport add points), or null. */
  pathEdit: number | null;
  /** The route of a Follow path brick being drawn (its path id and number). */
  pathBrick: { id: string; index: number } | null;
}

const DEFAULT_PANELS = { hierarchy: true, inspector: true, bottom: true, toolbar: true };

function loadLayout() {
  try { return JSON.parse(localStorage.getItem('gc.layout') ?? '{}'); } catch { return {}; }
}

let state: EditorState = {
  project: null, sceneId: '', selection: [], play: 'edit', dirty: false, lastSaved: 0, logs: [],
  workspace: 'Layout', panels: { ...DEFAULT_PANELS, ...(loadLayout().panels ?? {}) }, logicView: 'sheet', focusBlockId: null,
  shading: 'rendered', tool: 'move', space: 'world', snap: { on: false, move: 0.5, rotate: 15, scale: 0.1 },
  tutorialStep: null, rev: 0, bottomTab: 'Event sheet', rightTab: 'Inspector', showColliders: false, collisionView: false, pathEdit: null, pathBrick: null,
};
const listeners = new Set<() => void>();
const undoStack: { label: string; snap: string; key?: string; t: number }[] = [];
const redoStack: { label: string; snap: string }[] = [];

export const store = {
  get: () => state,
  subscribe(l: () => void) { listeners.add(l); return () => listeners.delete(l); },
  set(patch: Partial<EditorState>) {
    state = { ...state, ...patch };
    if (patch.panels) try { localStorage.setItem('gc.layout', JSON.stringify({ panels: state.panels })); } catch { /* storage blocked */ }
    listeners.forEach((l) => l());
  },
  open(p: GameProject) {
    undoStack.length = 0; redoStack.length = 0;
    store.set({ project: p, sceneId: p.startSceneId, selection: [], dirty: false, play: 'edit', rev: state.rev + 1, logs: [], lastSaved: Date.now() });
    try { const r = JSON.parse(localStorage.getItem('gc.recent') ?? '[]').filter((x: string) => x !== p.id); localStorage.setItem('gc.recent', JSON.stringify([p.id, ...r].slice(0, 10))); } catch { /* ignore */ }
  },
  close() { store.set({ project: null, selection: [], play: 'edit' }); },
  /** Apply an undoable change. `key` coalesces rapid edits of the same field (slider drags). */
  mutate(label: string, fn: (p: GameProject) => void, key?: string) {
    if (!state.project) return;
    const now = Date.now();
    const top = undoStack[undoStack.length - 1];
    if (!(key && top && top.key === key && now - top.t < 800)) {
      undoStack.push({ label, snap: JSON.stringify(state.project), key, t: now });
      if (undoStack.length > 150) undoStack.shift();
    } else top.t = now;
    redoStack.length = 0;
    const p = deepClone(state.project);
    fn(p);
    p.modified = new Date().toISOString();
    // Text typed in Properties and fixed-text "Update text" blocks stay one and the same.
    syncTexts({ instances: state.project.scenes.flatMap((s) => s.instances), logic: state.project.logic }, { instances: p.scenes.flatMap((s) => s.instances), logic: p.logic });
    store.set({ project: p, dirty: true, rev: state.rev + 1 });
  },
  undo() {
    const u = undoStack.pop();
    if (!u || !state.project) return;
    redoStack.push({ label: u.label, snap: JSON.stringify(state.project) });
    store.set({ project: JSON.parse(u.snap), dirty: true, rev: state.rev + 1 });
    store.log('info', `Undo: ${u.label}`);
  },
  redo() {
    const r = redoStack.pop();
    if (!r || !state.project) return;
    undoStack.push({ label: r.label, snap: JSON.stringify(state.project), t: 0 });
    store.set({ project: JSON.parse(r.snap), dirty: true, rev: state.rev + 1 });
    store.log('info', `Redo: ${r.label}`);
  },
  canUndo: () => undoStack.length > 0,
  canRedo: () => redoStack.length > 0,
  undoLabel: () => undoStack[undoStack.length - 1]?.label,
  async save() {
    if (!state.project) return;
    try {
      await api.save(state.project);
      store.set({ dirty: false, lastSaved: Date.now() });
      store.log('info', `Saved "${state.project.name}"`);
    } catch (e: any) { store.log('error', 'Save failed: ' + e.message); throw e; }
  },
  log(level: LogEntry['level'], message: string, ref?: { blockId?: string; eventId?: string }) {
    const logs = [...state.logs, { level, message, time: Date.now(), ...ref }];
    store.set({ logs: logs.slice(-400) });
  },
  scene(): SceneData | null {
    const p = state.project;
    return p?.scenes.find((s) => s.id === state.sceneId) ?? p?.scenes[0] ?? null;
  },
  selected(): InstanceData[] {
    const s = store.scene();
    return s ? s.instances.filter((i) => state.selection.includes(i.uid)) : [];
  },
};

// Autosave every 20 s when there are unsaved changes (recoverable from the launcher).
if (typeof window !== 'undefined') {
  setInterval(() => {
    if (state.project && state.dirty) api.autosave(state.project).catch(() => store.log('warn', 'Autosave failed (is the dev server running?)'));
  }, 20000);
  window.addEventListener('beforeunload', (e) => { if (state.dirty) { e.preventDefault(); e.returnValue = ''; } });
}

export function useStore<T>(sel: (s: EditorState) => T): T {
  return useSyncExternalStore(store.subscribe, () => sel(state));
}

export function sceneOf(p: GameProject, id: string) { return p.scenes.find((s) => s.id === id) ?? p.scenes[0]; }
