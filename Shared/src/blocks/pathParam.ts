// A "path" parameter: one or more routes drawn in the scene from a button on the brick. Saved in the block's parameter
// as JSON with its own id, so the viewport can find it wherever the brick is while the player draws.
export type PathPoint = [number, number, number];
export interface PathsValue { id: string; paths: PathPoint[][] }

export function readPaths(v: unknown): PathsValue {
  if (typeof v === 'string' && v.trim().startsWith('{')) {
    try {
      const o = JSON.parse(v);
      if (o && Array.isArray(o.paths)) return { id: String(o.id ?? ''), paths: o.paths.filter(Array.isArray).map((r: any[]) => r.filter((p) => Array.isArray(p) && p.length === 3).map((p) => [Number(p[0]), Number(p[1]), Number(p[2])] as PathPoint)) };
    } catch { /* not a saved path: treat as empty */ }
  }
  return { id: '', paths: [] };
}
export const writePaths = (v: PathsValue) => JSON.stringify(v);
export const newPathId = () => 'path_' + Math.random().toString(36).slice(2, 10);

/** What the editing host does when a brick's Draw button is pressed (GameCraft sets it; other apps offer no button). */
export interface PathDrawHost {
  draw(id: string, index: number, target: string | undefined): void;
  /** The route being drawn now: `id` and path number, for the brick to light its button. */
  active(): { id: string; index: number } | null;
  stop(): void;
  subscribe(fn: () => void): () => void;
}
export const pathDraw: { host: PathDrawHost | null } = { host: null };

/** Change the one param holding this path id, anywhere in a logic document. Returns true when found. */
export function editPathInDoc(doc: { sheets: { events: any[] }[] }, id: string, fn: (v: PathsValue) => void): boolean {
  let found = false;
  const block = (b: any) => {
    for (const k of Object.keys(b.params ?? {})) {
      const val = b.params[k];
      if (typeof val !== 'string' || !val.includes(id)) continue;
      const pv = readPaths(val);
      if (pv.id !== id) continue;
      fn(pv); b.params[k] = writePaths(pv); found = true;
    }
  };
  const walk = (ns: any[]) => { for (const n of ns ?? []) { (n.conditions ?? []).forEach(block); (n.actions ?? []).forEach(block); walk(n.children ?? []); walk(n.elseChildren ?? []); } };
  for (const s of doc.sheets) walk(s.events);
  return found;
}
export function findPathInDoc(doc: { sheets: { events: any[] }[] }, id: string): PathsValue | null {
  let out: PathsValue | null = null;
  editPathInDoc(doc, id, (v) => { out = v; });
  return out;
}
