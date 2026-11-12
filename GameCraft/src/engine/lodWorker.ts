// Builds simplified LOD copies of a mesh off the main thread (simplifying a big mesh takes ~1 s).
// Multi-material meshes are simplified one material group at a time and keep their groups: a mesh with a material
// array and no groups draws nothing, which made multi-material models vanish at a distance.
import * as THREE from 'three';
import { SimplifyModifier } from 'three/examples/jsm/modifiers/SimplifyModifier.js';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

type Attr = { array: Float32Array; itemSize: number };
export interface LodGroup { start: number; count: number; materialIndex: number }
export interface LodRequest { id: number; attrs: Record<string, Attr>; index?: Uint32Array; groups?: LodGroup[]; keep: number[] }
export interface LodLevel { attrs: Record<string, Attr>; index?: Uint32Array; groups?: LodGroup[] }
export interface LodReply { id: number; levels: (LodLevel | null)[] }

const mod = new SimplifyModifier();

/** One group's triangles as their own (non-indexed) geometry. */
function slice(g: THREE.BufferGeometry, gr: LodGroup): THREE.BufferGeometry {
  const out = new THREE.BufferGeometry();
  const idx = g.index;
  for (const [name, a] of Object.entries(g.attributes) as [string, THREE.BufferAttribute][]) {
    const n = a.itemSize, arr = new Float32Array(gr.count * n);
    for (let k = 0; k < gr.count; k++) {
      const v = idx ? idx.getX(gr.start + k) : gr.start + k;
      for (let c = 0; c < n; c++) arr[k * n + c] = (a.array as ArrayLike<number>)[v * n + c];
    }
    out.setAttribute(name, new THREE.BufferAttribute(arr, n));
  }
  return out;
}

/** Simplify to `keep` of the mesh's distinct vertices. Throws when nothing sensible is left (caller keeps the original). */
function simplify(g: THREE.BufferGeometry, keep: number): THREE.BufferGeometry {
  // The modifier merges shared vertices before removing any, so the count to remove must come from the merged mesh:
  // counting the raw (per-triangle) vertices removed everything and produced empty LOD meshes.
  const merged = mergeVertices(g, 1e-4);
  const verts = merged.attributes.position.count;
  const s = mod.modify(merged, Math.floor(verts * (1 - keep)));
  if (!s.index) s.setIndex(Array.from({ length: s.attributes.position.count }, (_, i) => i));
  const before = (merged.index ? merged.index.count : verts) / 3;
  if (s.index!.count < 12 || s.index!.count / 3 < before * keep * 0.3) throw new Error('over-simplified');
  return s;
}

export function level(g: THREE.BufferGeometry, groups: LodGroup[] | undefined, keep: number, names: string[]): LodLevel | null {
  try {
    if (!groups || groups.length < 2) {
      const s = simplify(g, keep);
      const attrs: Record<string, Attr> = {};
      for (const name of names) { const a = s.attributes[name] as THREE.BufferAttribute | undefined; if (a) attrs[name] = { array: new Float32Array(a.array), itemSize: a.itemSize }; }
      return { attrs, index: new Uint32Array(s.index!.array) };
    }
    // Per group, then merged back with one group per material.
    const parts = groups.map((gr) => { const sub = slice(g, gr); let s: THREE.BufferGeometry; try { s = simplify(sub, keep); } catch { s = sub; s.setIndex(Array.from({ length: sub.attributes.position.count }, (_, i) => i)); } return { s, gr }; });
    const verts = parts.reduce((n, p) => n + p.s.attributes.position.count, 0);
    const tris = parts.reduce((n, p) => n + p.s.index!.count, 0);
    const attrs: Record<string, Attr> = {};
    for (const name of names) { const sz = (g.attributes[name] as THREE.BufferAttribute).itemSize; attrs[name] = { array: new Float32Array(verts * sz), itemSize: sz }; }
    const index = new Uint32Array(tris);
    const outGroups: LodGroup[] = [];
    let vo = 0, io = 0;
    for (const { s, gr } of parts) {
      for (const name of names) {
        const a = s.attributes[name] as THREE.BufferAttribute | undefined;
        if (a) attrs[name].array.set(a.array as Float32Array, vo * attrs[name].itemSize); // missing attributes stay zero
      }
      const si = s.index!;
      for (let k = 0; k < si.count; k++) index[io + k] = si.getX(k) + vo;
      outGroups.push({ start: io, count: si.count, materialIndex: gr.materialIndex });
      vo += s.attributes.position.count; io += si.count;
    }
    return { attrs, index, groups: outGroups };
  } catch { return null; }
}

if (typeof self !== 'undefined') self.onmessage = (ev: MessageEvent<LodRequest>) => {
  const { id, attrs, index, groups, keep } = ev.data;
  const g = new THREE.BufferGeometry();
  for (const [name, a] of Object.entries(attrs)) g.setAttribute(name, new THREE.BufferAttribute(a.array, a.itemSize));
  if (index) g.setIndex(new THREE.BufferAttribute(index, 1));
  const names = Object.keys(attrs);
  const levels = keep.map((k) => level(g, groups, k, names));
  const transfer: Transferable[] = [];
  for (const l of levels) if (l) { for (const a of Object.values(l.attrs)) transfer.push(a.array.buffer); if (l.index) transfer.push(l.index.buffer); }
  (self as any).postMessage({ id, levels } satisfies LodReply, transfer);
};
