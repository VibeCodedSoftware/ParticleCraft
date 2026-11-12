// Draws Rope / zipline behaviors: a tube along the rope's curve, in world space. One small mesh per rope, its vertices
// rewritten in place while it sways.
import * as THREE from 'three';

const SIDES = 6;
export interface RopeLook { pts: [number, number, number][]; version: number | string; thickness: number; color: string; texture: string; repeat: number; /** No lights to answer to (2D without 2D lighting): its plain colours. */ unlit?: boolean }
interface Item { mesh: THREE.Mesh; version: number | string; look: string; mat: THREE.MeshStandardMaterial | THREE.MeshBasicMaterial }

function tubeInto(geo: THREE.BufferGeometry, pts: [number, number, number][], radius: number, repeat: number) {
  const n = pts.length, vcount = n * (SIDES + 1);
  let pos = geo.getAttribute('position') as THREE.BufferAttribute | undefined;
  if (!pos || pos.count !== vcount) {
    pos = new THREE.BufferAttribute(new Float32Array(vcount * 3), 3); pos.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', pos);
    const nrm = new THREE.BufferAttribute(new Float32Array(vcount * 3), 3); nrm.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('normal', nrm);
    geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(vcount * 2), 2));
    const idx: number[] = [];
    for (let i = 0; i < n - 1; i++) for (let s = 0; s < SIDES; s++) {
      const a = i * (SIDES + 1) + s, b = a + SIDES + 1;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
    geo.setIndex(idx);
  }
  const nrm = geo.getAttribute('normal') as THREE.BufferAttribute, uv = geo.getAttribute('uv') as THREE.BufferAttribute;
  const t = new THREE.Vector3(), u = new THREE.Vector3(), w = new THREE.Vector3(), d = new THREE.Vector3();
  const prevU = new THREE.Vector3(1, 0, 0);
  let run = 0;
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    t.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    if (t.lengthSq() < 1e-12) t.set(0, 1, 0); t.normalize();
    // Carry the ring's frame along the rope, so it never twists.
    u.copy(prevU).addScaledVector(t, -prevU.dot(t));
    if (u.lengthSq() < 1e-6) { u.set(0, 0, 1).addScaledVector(t, -t.z); }
    u.normalize(); prevU.copy(u); w.crossVectors(t, u);
    if (i > 0) run += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2]);
    for (let s = 0; s <= SIDES; s++) {
      const ang = (s / SIDES) * Math.PI * 2, k = i * (SIDES + 1) + s;
      d.copy(u).multiplyScalar(Math.cos(ang)).addScaledVector(w, Math.sin(ang));
      pos.setXYZ(k, pts[i][0] + d.x * radius, pts[i][1] + d.y * radius, pts[i][2] + d.z * radius);
      nrm.setXYZ(k, d.x, d.y, d.z);
      uv.setXY(k, s / SIDES, run * repeat);
    }
  }
  pos.needsUpdate = true; nrm.needsUpdate = true; uv.needsUpdate = true;
  geo.computeBoundingSphere();
}

export class RopeViews {
  private items = new Map<number, Item>();
  textureOf: ((id: string) => THREE.Texture | null) | null = null;
  constructor(private parent: THREE.Object3D) {}
  /** Draw these ropes; any other is removed. */
  sync(ropes: Map<number, RopeLook>) {
    for (const [uid, it] of this.items) if (!ropes.has(uid)) { it.mesh.removeFromParent(); it.mesh.geometry.dispose(); it.mat.dispose(); this.items.delete(uid); }
    for (const [uid, r] of ropes) {
      let it = this.items.get(uid);
      if (!it) {
        const mat = new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0 });
        const mesh = new THREE.Mesh(new THREE.BufferGeometry(), mat);
        mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = true; mesh.userData.editorOnly = false;
        this.parent.add(mesh);
        it = { mesh, mat, version: -1, look: '' };
        this.items.set(uid, it);
      }
      const look = `${r.color}|${r.texture}|${!!r.unlit}`;
      if (look !== it.look) {
        it.look = look;
        if (!!r.unlit !== (it.mat as THREE.MeshBasicMaterial).isMeshBasicMaterial) { it.mat.dispose(); it.mat = r.unlit ? new THREE.MeshBasicMaterial() : new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0 }); it.mesh.material = it.mat; }
        it.mat.color.set(r.color || '#8a6a45');
        const t = r.texture ? this.textureOf?.(r.texture) ?? null : null;
        if (t) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; }
        it.mat.map = t; it.mat.needsUpdate = true;
      }
      const v = `${r.version}|${r.thickness}|${r.repeat}`;
      if (v !== it.version && r.pts.length > 1) { it.version = v; tubeInto(it.mesh.geometry, r.pts, Math.max(0.002, r.thickness / 2), r.repeat); }
    }
  }
  clear() { this.sync(new Map()); }
}
