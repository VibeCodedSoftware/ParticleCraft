// ParticleCraft documents (effects, simulation setups, saved components) and the shared exchange folder.
// Uses the same local file API as GameCraft and LogicCraft (dev server in the browser, craft:// in the desktop app).
import { useSyncExternalStore } from 'react';
import { VFX_FORMAT, finalizeAsset, type VfxAsset, type VfxSystem } from '@shared/src/vfx/vfx';

const BASE = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window ? 'http://craft.localhost' : '';
export const BASE_URL = BASE;

async function req(path: string, init?: RequestInit) {
  const r = await fetch(BASE + path, init);
  if (!r.ok) { let m = r.statusText; try { m = (await r.json()).error ?? m; } catch { /* not json */ } throw new Error(m); }
  return r;
}

export const COMPONENTS_ID = '_components';

export const api = {
  /** Effects only: ids starting with "_" are ParticleCraft's own library documents (components, textures, curves…). */
  list: async (): Promise<{ id: string; name: string; modified: number }[]> => (await (await req('/api/projects')).json()).filter((p: any) => !String(p.id).startsWith('_')),
  /** Library documents (JSON) stored beside the effects. */
  getDoc: async <T,>(id: string, fallback: T): Promise<T> => {
    try { const r = await fetch(BASE + `/api/projects/${encodeURIComponent(id)}`); if (!r.ok) return fallback; return (await r.json()) as T; } catch { return fallback; }
  },
  putDoc: async (id: string, data: unknown) => { await req(`/api/projects/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(data) }); },
  delDoc: async (id: string) => { await req(`/api/projects/${encodeURIComponent(id)}`, { method: 'DELETE' }); },
  load: async (id: string): Promise<VfxAsset> => { const a = await (await req(`/api/projects/${encodeURIComponent(id)}`)).json(); if (a?.format !== VFX_FORMAT) throw new Error('Not a ParticleCraft document'); return a; },
  save: async (a: VfxAsset) => { await req(`/api/projects/${encodeURIComponent(a.id)}`, { method: 'PUT', body: JSON.stringify(a.kind === 'realtime' ? finalizeAsset(a) : a, null, 1) }); },
  remove: async (id: string) => { await req(`/api/projects/${encodeURIComponent(id)}`, { method: 'DELETE' }); },
  components: async (): Promise<{ name: string; system: VfxSystem }[]> => {
    try {
      const all: { id: string }[] = await (await req('/api/projects')).json();
      if (!all.some((p) => p.id === COMPONENTS_ID)) return [];
      return (await (await req(`/api/projects/${COMPONENTS_ID}`)).json()).items ?? [];
    } catch { return []; }
  },
  saveComponents: async (items: { name: string; system: VfxSystem }[]) => { await req(`/api/projects/${COMPONENTS_ID}`, { method: 'PUT', body: JSON.stringify({ id: COMPONENTS_ID, name: 'Components', items }) }); },
  exchangeList: async (): Promise<{ path: string; size: number; modified: number }[]> => (await req('/api/exchange')).json(),
  exchangeGet: async (name: string): Promise<any> => (await req(`/api/exchange/${encodeURIComponent(name)}`)).json(),
  exchangePut: async (name: string, body: string) => (await req(`/api/exchange/${encodeURIComponent(name)}`, { method: 'PUT', body })).json(),
};

/** File name used in the shared exchange folder for an exported effect. */
export const exchangeName = (a: VfxAsset) => `${a.name.replace(/[^A-Za-z0-9_-]+/g, '_') || 'effect'}.vfx.json`;

// ------------------------------------------------------------------ tiny store
export interface PCState { doc: VfxAsset | null; dirty: boolean; mode: 'vfx' | 'sim'; rev: number; status: string; /** Selected system in the graph (texture library "Use" targets it). */ selSys?: string }
let state: PCState = { doc: null, dirty: false, mode: 'vfx', rev: 0, status: '' };
const subs = new Set<() => void>();
const undo: string[] = []; const redo: string[] = [];

export const pc = {
  get: () => state,
  subscribe: (f: () => void) => { subs.add(f); return () => subs.delete(f); },
  set(p: Partial<PCState>) { state = { ...state, ...p }; subs.forEach((f) => f()); },
  open(doc: VfxAsset) { undo.length = 0; redo.length = 0; pc.set({ doc, dirty: false, rev: state.rev + 1, mode: doc.kind === 'simulation' ? 'sim' : 'vfx' }); },
  mutate(fn: (d: VfxAsset) => void) {
    if (!state.doc) return;
    undo.push(JSON.stringify(state.doc)); if (undo.length > 120) undo.shift(); redo.length = 0;
    const d: VfxAsset = JSON.parse(JSON.stringify(state.doc)); fn(d); d.modified = new Date().toISOString();
    pc.set({ doc: d, dirty: true, rev: state.rev + 1 });
  },
  undo() { const u = undo.pop(); if (!u || !state.doc) return; redo.push(JSON.stringify(state.doc)); pc.set({ doc: JSON.parse(u), dirty: true, rev: state.rev + 1 }); },
  redo() { const r = redo.pop(); if (!r || !state.doc) return; undo.push(JSON.stringify(state.doc)); pc.set({ doc: JSON.parse(r), dirty: true, rev: state.rev + 1 }); },
  async save() { if (!state.doc) return; await api.save(state.doc); pc.set({ dirty: false, status: `Saved "${state.doc.name}"` }); },
};

export function usePC<T>(sel: (s: PCState) => T): T { return useSyncExternalStore(pc.subscribe, () => sel(state)); }
