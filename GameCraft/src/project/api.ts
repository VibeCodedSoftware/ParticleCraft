// Client for the local project API: Shared/devserver/projectApi.ts in the browser dev server, or the Rust
// port (Shared/craft-backend) served on the private craft:// scheme inside the Windows desktop app.
import type { GameProject } from './types';
import { migrateProject } from './migrate';

/** Desktop app (Tauri/WebView2 maps craft:// to http://craft.localhost); same-origin /api otherwise. */
const BASE = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window ? 'http://craft.localhost' : '';

export interface AndroidStatus { ready: boolean; sdk: string | null; buildTools: string | null; platform: string | null; jdk: string | null; missing: string[]; guide: string[]; outputDir: string; /** bundletool .jar found (App Bundles). */ bundletool?: string | null }
export interface AndroidBuild { ok: boolean; log: string; checks: { check: string; ok: boolean }[]; apk: string | null; file: string | null; sizeMb: number }

async function req(path: string, init?: RequestInit) {
  const r = await fetch(BASE + path, init);
  if (!r.ok) {
    let msg = r.statusText;
    try { msg = (await r.json()).error ?? msg; } catch { /* not json */ }
    throw new Error(msg);
  }
  return r;
}

export interface ProjectListItem { id: string; name: string; template: string | null; modified: number; hasNewerAutosave?: boolean; error?: boolean }

export const api = {
  async list(): Promise<ProjectListItem[]> { return (await req('/api/projects')).json(); },
  async load(id: string, autosave = false): Promise<GameProject> {
    const raw = await (await req(`/api/projects/${encodeURIComponent(id)}${autosave ? '/autosave' : ''}`)).json();
    return migrateProject(raw);
  },
  async save(p: GameProject) {
    await req(`/api/projects/${encodeURIComponent(p.id)}`, { method: 'PUT', body: JSON.stringify(p, null, 1) });
  },
  async autosave(p: GameProject) {
    await req(`/api/projects/${encodeURIComponent(p.id)}/autosave`, { method: 'PUT', body: JSON.stringify(p) });
  },
  async discardAutosave(id: string) { await req(`/api/projects/${encodeURIComponent(id)}/autosave`, { method: 'DELETE' }); },
  async remove(id: string) { await req(`/api/projects/${encodeURIComponent(id)}`, { method: 'DELETE' }); },
  async putFile(id: string, rel: string, data: Blob | ArrayBuffer) {
    await req(`/api/projects/${encodeURIComponent(id)}/files/${rel.split('/').map(encodeURIComponent).join('/')}`, { method: 'PUT', body: data });
  },
  fileUrl(id: string, rel: string) { return `${BASE}/api/projects/${encodeURIComponent(id)}/files/${rel.split('/').map(encodeURIComponent).join('/')}`; },
  async library(): Promise<{ id: string; label: string; files: { path: string; size: number; modified: number }[] }[]> { return (await req('/api/library')).json(); },
  libraryUrl(lib: string, rel: string) { return `${BASE}/api/library/${lib}/${rel.split('/').map(encodeURIComponent).join('/')}`; },
  async exchangeList(): Promise<{ path: string; modified: number }[]> { return (await req('/api/exchange')).json(); },
  async exchangeGet(name: string) { return (await req(`/api/exchange/${encodeURIComponent(name)}`)).text(); },
  /** A binary file from the exchange folder (e.g. the .glb the Blender add-on wrote); null when it is not there. */
  async exchangeBytes(name: string): Promise<ArrayBuffer | null> { try { return await (await req(`/api/exchange/${encodeURIComponent(name)}`)).arrayBuffer(); } catch { return null; } },
  async exchangePut(name: string, body: string) { return (await req(`/api/exchange/${encodeURIComponent(name)}`, { method: 'PUT', body })).json(); },
  async blenderStatus(): Promise<{ available: boolean; path: string | null }> { return (await req('/api/blender/status')).json(); },
  /** Android toolchain found on this computer (desktop app only; the dev server has no APK builder). */
  async androidStatus(sdkPath = ''): Promise<AndroidStatus> { return (await req('/api/android/status', { method: 'POST', body: JSON.stringify({ sdkPath }) })).json(); },
  /** Build a signed, validated APK from a web export zip. Passwords travel only in this request. */
  async androidBuild(opts: Record<string, unknown>, zip: Blob): Promise<AndroidBuild> {
    const head = new TextEncoder().encode(JSON.stringify(opts));
    const len = new Uint8Array(4); new DataView(len.buffer).setUint32(0, head.length, true);
    return (await req('/api/android/build', { method: 'POST', body: new Blob([len, head, zip]) })).json();
  },
  async androidKeystore(opts: { path?: string; alias: string; storePass: string; keyPass?: string; dname: string; sdkPath?: string }): Promise<{ ok: boolean; path: string; alias: string }> { return (await req('/api/android/keystore', { method: 'POST', body: JSON.stringify(opts) })).json(); },
  androidApkUrl(file: string) { return `${BASE}/api/android/apk/${encodeURIComponent(file)}`; },
  async blenderConvert(project: string, file: string): Promise<{ output: string }> { return (await req(`/api/blender/convert?project=${encodeURIComponent(project)}&file=${encodeURIComponent(file)}`, { method: 'POST' })).json(); },
};

/** Exported games load assets from files next to the page (data/lib/…, data/proj/…) instead of the API. */
let exportedBase: string | null = null;
export function useExportedAssets(base: string) { exportedBase = base.endsWith('/') ? base : base + '/'; }
/** Where an asset id is stored inside an exported game. */
export function exportedAssetPath(assetId: string): string | null {
  const id = assetId.split('#')[0];
  if (id.startsWith('lib:')) return 'lib/' + id.slice(4);
  if (id.startsWith('proj:')) return 'proj/' + id.slice(5);
  return null;
}

/** Resolve an asset id to a URL the loaders can fetch. */
export function assetUrl(projectId: string, assetId: string): string | null {
  if (exportedBase) {
    const hash = assetId.indexOf('#');
    const rel = exportedAssetPath(assetId);
    if (!rel) return null;
    const url = exportedBase + rel.split('/').map(encodeURIComponent).join('/');
    return hash >= 0 ? url + '#' + encodeURIComponent(assetId.slice(hash + 1)) : url;
  }
  // "file.blend#Object" names one object inside a .blend; the fragment stays a URL fragment.
  const hash = assetId.indexOf('#');
  if (hash >= 0) { const u = assetUrl(projectId, assetId.slice(0, hash)); return u && u + '#' + encodeURIComponent(assetId.slice(hash + 1)); }
  if (assetId.startsWith('lib:')) { const rest = assetId.slice(4); const i = rest.indexOf('/'); return api.libraryUrl(rest.slice(0, i), rest.slice(i + 1)); }
  if (assetId.startsWith('proj:')) return api.fileUrl(projectId, assetId.slice(5));
  return null;
}
