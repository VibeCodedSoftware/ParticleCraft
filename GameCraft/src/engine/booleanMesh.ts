// Boolean meshes (see @shared/src/runtime/boolean.ts): an object's mesh cut by / joined with other objects
// (Difference / Union / Intersect, in order, like Blender's Boolean modifier) and the holes cut while playing,
// computed with three-bvh-csg in the mesh's own space. Recomputed only when something that shapes it changes
// (the cutters' placement, the ops, a new hole), so dragging a cutter in the editor updates the cut live.
import * as THREE from 'three';
import { ADDITION, Brush, Evaluator, INTERSECTION, SUBTRACTION } from 'three-bvh-csg';
import type { InstanceData } from '@shared/src/runtime/scene';
import type { BooleanOpKind, Cut } from '@shared/src/runtime/boolean';

const OPS: Record<BooleanOpKind, number> = { difference: SUBTRACTION, union: ADDITION, intersect: INTERSECTION };
const evaluator = new Evaluator();
evaluator.useGroups = false;
evaluator.attributes = ['position', 'normal', 'uv'];

const CUT_GEO: Record<Cut['shape'], () => THREE.BufferGeometry> = {
  sphere: () => new THREE.SphereGeometry(0.5, 16, 12),
  box: () => new THREE.BoxGeometry(1, 1, 1),
  cylinder: () => new THREE.CylinderGeometry(0.5, 0.5, 1, 20),
};

/** The same three attributes on every brush (CSG needs them to match); missing UVs are zeros. */
function prep(g: THREE.BufferGeometry): THREE.BufferGeometry {
  let out = g.index ? g.toNonIndexed() : g.clone();
  for (const name of Object.keys(out.attributes)) if (!['position', 'normal', 'uv'].includes(name)) out.deleteAttribute(name);
  if (!out.attributes.normal) out.computeVertexNormals();
  if (!out.attributes.uv) out.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(out.attributes.position.count * 2), 2));
  out.clearGroups();
  if (out === g) out = g.clone();
  return out;
}
const brushCache = new WeakMap<THREE.BufferGeometry, THREE.BufferGeometry>();
const prepared = (g: THREE.BufferGeometry) => { let p = brushCache.get(g); if (!p) { p = prep(g); brushCache.set(g, p); } return p; };

function meshesOf(root: THREE.Object3D): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  root.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && !(m as THREE.SkinnedMesh).isSkinnedMesh && !m.userData.lodGhost && !m.userData.editorOnly && m.geometry?.attributes.position) out.push(m); });
  return out;
}

export interface BooleanTarget { obj: THREE.Object3D; visual: THREE.Object3D }

/**
 * Bring an object's meshes up to date with its Boolean ops and holes. `cutterOf(uid)` is the other object's
 * visual. Returns false when nothing applies (the meshes are back to their own shapes).
 */
export function updateBoolean(t: BooleanTarget, inst: InstanceData, cuts: Cut[] | undefined, cutterOf: (uid: number) => THREE.Object3D | undefined): boolean {
  const ops = inst.boolean?.ops ?? [];
  const meshes = meshesOf(t.visual);
  if (!ops.length && !cuts?.length) {
    for (const m of meshes) if (m.userData.boolSrc) { if (m.geometry !== m.userData.boolSrc) m.geometry.dispose(); m.geometry = m.userData.boolSrc; delete m.userData.boolSrc; delete m.userData.boolKey; }
    return false;
  }
  t.obj.updateMatrixWorld(true);
  const cutters = ops.map((o) => ({ o, root: cutterOf(o.with) })).filter((x) => x.root) as { o: { op: BooleanOpKind }; root: THREE.Object3D }[];
  for (const c of cutters) c.root.updateMatrixWorld(true);
  const round = (e: ArrayLike<number>) => Array.from(e, (x) => Math.round(x * 1000)).join(',');
  for (const m of meshes) {
    const src: THREE.BufferGeometry = m.userData.boolSrc ?? m.geometry;
    // Everything that shapes the result, relative to this mesh (moving the whole object together changes nothing).
    const inv = new THREE.Matrix4().copy(m.matrixWorld).invert();
    const rel = cutters.map((c) => meshesOf(c.root).map((cm) => new THREE.Matrix4().multiplyMatrices(inv, cm.matrixWorld)));
    const objToMesh = new THREE.Matrix4().multiplyMatrices(inv, t.obj.matrixWorld);
    const key = JSON.stringify([ops, src.uuid, rel.map((l) => l.map((x) => round(x.elements))), round(objToMesh.elements), cuts?.length ?? 0, cuts?.[cuts.length - 1]?.center]);
    if (m.userData.boolKey === key) continue;
    let result = new Brush(prepared(src));
    result.updateMatrixWorld();
    cutters.forEach((c, k) => {
      meshesOf(c.root).forEach((cm, j) => {
        const b = new Brush(prepared(cm.userData.boolSrc ?? cm.geometry));
        b.matrix.copy(rel[k][j]); b.matrix.decompose(b.position, b.quaternion, b.scale); b.updateMatrixWorld();
        result = evaluator.evaluate(result, b, OPS[c.o.op]);
      });
    });
    for (const cut of cuts ?? []) {
      const b = new Brush(prepared(cutGeo(cut.shape)));
      const local = new THREE.Matrix4().compose(new THREE.Vector3(...cut.center), new THREE.Quaternion(), new THREE.Vector3(...cut.size));
      b.matrix.multiplyMatrices(objToMesh, local); b.matrix.decompose(b.position, b.quaternion, b.scale); b.updateMatrixWorld();
      result = evaluator.evaluate(result, b, SUBTRACTION);
    }
    const g = result.geometry;
    g.computeBoundingBox(); g.computeBoundingSphere();
    if (m.userData.boolSrc && m.geometry !== m.userData.boolSrc) m.geometry.dispose();
    m.userData.boolSrc = src; m.userData.boolKey = key;
    m.geometry = g;
  }
  return true;
}
const cutGeos = new Map<string, THREE.BufferGeometry>();
const cutGeo = (s: Cut['shape']) => { let g = cutGeos.get(s); if (!g) { g = CUT_GEO[s](); cutGeos.set(s, g); } return g; };
