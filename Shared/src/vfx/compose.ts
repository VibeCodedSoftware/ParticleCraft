// Effect composition helpers: copy part of a graph (a node group, a whole effect) into another with fresh ids and every
// internal reference rewired (shape sources, texture-node links, sub-emitter targets, parameter bindings); make
// variations; and find the library pictures an effect uses so files can carry them.
import { newId } from '../schema';
import { CONTEXTS, type VfxGraph, type VfxParam, type VfxSystem } from './vfx';

/** A reusable piece of a graph: systems with the shapes, texture nodes and parameters they use. */
export interface VfxFragment { systems: VfxSystem[]; shapes?: VfxGraph['shapes']; texNodes?: VfxGraph['texNodes']; params?: VfxParam[] }

/** Everything a set of systems needs: their shapes, the texture nodes they (transitively) use, bound parameters. */
export function extractFragment(g: VfxGraph, systemIds: string[], texNodeIds: string[] = [], shapeIds: string[] = []): VfxFragment {
  const sys = g.systems.filter((s) => systemIds.includes(s.id));
  const shapes = new Set(shapeIds);
  for (const s of sys) if (s.source) shapes.add(s.source);
  const tex = new Set<string>();
  const visit = (id: string) => { if (tex.has(id)) return; tex.add(id); const n = g.texNodes?.find((t) => t.id === id); for (const v of Object.values(n?.inputs ?? {})) if (v) visit(v); };
  for (const id of texNodeIds) visit(id);
  for (const s of sys) for (const c of CONTEXTS) for (const b of s.contexts[c.id]) for (const v of Object.values(b.props)) if (typeof v === 'string' && v.startsWith('node:')) visit(v.slice(5));
  const ids = new Set(systemIds);
  const params = g.params.filter((p) => p.bindings.some((b) => ids.has(b.system))).map((p) => ({ ...p, bindings: p.bindings.filter((b) => ids.has(b.system)) }));
  return JSON.parse(JSON.stringify({ systems: sys, shapes: (g.shapes ?? []).filter((s) => shapes.has(s.id)), texNodes: (g.texNodes ?? []).filter((t) => tex.has(t.id)), params }));
}

/** Copies a fragment into a graph with new ids, moved by (dx, dy). Parameters with the same name and type are shared. */
export function insertFragment(g: VfxGraph, f: VfxFragment, dx = 0, dy = 0): { systems: string[] } {
  const frag: VfxFragment = JSON.parse(JSON.stringify(f));
  const map = new Map<string, string>();
  const re = (id: string, prefix: string) => { let n = map.get(id); if (!n) { n = newId(prefix); map.set(id, n); } return n; };
  for (const s of frag.systems) { re(s.id, 'vs'); for (const c of CONTEXTS) for (const b of s.contexts[c.id] ?? []) re(b.id, 'vb'); }
  for (const s of frag.shapes ?? []) re(s.id, 'vsh');
  for (const t of frag.texNodes ?? []) re(t.id, 'vt');
  const out: string[] = [];
  for (const t of frag.texNodes ?? []) {
    t.id = map.get(t.id)!; t.x += dx; t.y += dy;
    for (const k of Object.keys(t.inputs)) { const v = t.inputs[k]; t.inputs[k] = v ? map.get(v) ?? undefined : undefined; }
    (g.texNodes ??= []).push(t);
  }
  for (const s of frag.shapes ?? []) { s.id = map.get(s.id)!; s.x += dx; s.y += dy; (g.shapes ??= []).push(s); }
  for (const s of frag.systems) {
    s.id = map.get(s.id)!; s.x += dx; s.y += dy;
    if (s.source) s.source = map.get(s.source);
    for (const c of CONTEXTS) for (const b of s.contexts[c.id] ?? []) {
      b.id = map.get(b.id)!;
      for (const [k, v] of Object.entries(b.props)) {
        if (typeof v === 'string' && v.startsWith('node:')) b.props[k] = map.has(v.slice(5)) ? 'node:' + map.get(v.slice(5)) : '';
        if (k === 'target' && typeof v === 'string' && v) b.props[k] = map.get(v) ?? '';
      }
    }
    g.systems.push(s); out.push(s.id);
  }
  for (const p of frag.params ?? []) {
    const bindings = p.bindings.filter((b) => map.has(b.system) && map.has(b.block)).map((b) => ({ ...b, system: map.get(b.system)!, block: map.get(b.block)! }));
    const same = g.params.find((x) => x.name === p.name && x.type === p.type);
    if (same) same.bindings.push(...bindings);
    else g.params.push({ ...p, id: newId('vp'), bindings });
  }
  return { systems: out };
}

/** A variation: new random seeds everywhere and a nudge (±amount) on numeric settings of the chosen kinds. */
export function makeVariation(g: VfxGraph, amount = 0.15, seed = Date.now()): VfxGraph {
  const v: VfxGraph = JSON.parse(JSON.stringify(g));
  let s = seed >>> 0 || 1;
  const rnd = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; };
  const nudge = new Set(['rate', 'count', 'speed', 'size', 'min', 'max', 'strength', 'spin', 'radius', 'radial', 'amount', 'intensity']);
  for (const sys of v.systems) {
    for (const c of CONTEXTS) for (const b of sys.contexts[c.id]) {
      if (b.type === 'seed') { b.props.seed = Math.floor(rnd() * 99999); continue; }
      for (const [k, val] of Object.entries(b.props)) if (typeof val === 'number' && nudge.has(k) && val !== 0) b.props[k] = Math.round(val * (1 + (rnd() * 2 - 1) * amount) * 1000) / 1000;
    }
    // Every system gets its own new seed (as a block, so it stays editable).
    if (!sys.contexts.init.some((b) => b.type === 'seed')) sys.contexts.init.push({ id: newId('vb'), type: 'seed', enabled: true, props: { seed: Math.floor(rnd() * 99999) } });
  }
  for (const t of v.texNodes ?? []) if (typeof t.props.seed === 'number' || t.props.seed == null) t.props.seed = Math.floor(rnd() * 9999);
  return v;
}

/** Library picture ids ("asset:<id>") referenced anywhere in a graph. */
export function assetRefs(g: VfxGraph): string[] {
  const out = new Set<string>();
  const scan = (o: any) => { if (typeof o === 'string') { if (o.startsWith('asset:')) out.add(o.slice(6)); } else if (o && typeof o === 'object') for (const v of Object.values(o)) scan(v); };
  scan(g.systems); scan(g.texNodes ?? []);
  return [...out];
}

/** Rewrites "asset:<old>" references (after importing an effect file's pictures under new ids). */
export function remapAssets(g: VfxGraph, map: Map<string, string>) {
  const walk = (o: any) => { if (!o || typeof o !== 'object') return; for (const [k, v] of Object.entries(o)) { if (typeof v === 'string' && v.startsWith('asset:') && map.has(v.slice(6))) o[k] = 'asset:' + map.get(v.slice(6)); else if (v && typeof v === 'object') walk(v); } };
  walk(g.systems); walk(g.texNodes ?? []);
}
