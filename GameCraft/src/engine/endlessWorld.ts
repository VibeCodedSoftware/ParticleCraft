// Endless worlds from WorldCraft, streamed while you play. Every chunk is worked out from the world's seed and settings by
// the same pure functions WorldCraft uses, so it matches WorldCraft and comes back the same when you return: terrain
// with its colours, scattered objects as instances, structures, and solid ground to walk on (an invisible object per
// chunk near the player). Models were baked once at export; only where they stand is worked out here.
import * as THREE from 'three';
import type { World, RInstance } from '@shared/src/runtime/world';
import { makeInstance } from '@shared/src/runtime/scene';
import { behaviorDefaults } from '@shared/src/runtime/behaviors';
import { buildFeatures, smoothPath, terrainChunk, worldHeight } from '@shared/src/world/features';
import { fallIndex, scatterSquare, structuresInSquare } from '@shared/src/world/scatter';
import { groundColor } from '@shared/src/world/biomes';
import { slopeAt, type HeightSampler } from '@shared/src/world/terrain';
import { GRAY_MEAN, streamKey, type EndlessSettings } from '@shared/src/world/document';
import { loadModel } from './assets';

interface Part { geo: THREE.BufferGeometry; mat: THREE.Material }
interface Chunk { key: string; cx: number; cz: number; lod: number; group: THREE.Group; ground: THREE.Mesh; objects: THREE.Group; objectsDone: boolean; collider?: RInstance }

const dummy = new THREE.Object3D(), color = new THREE.Color(), up = new THREE.Vector3(0, 1, 0);

/** How much of a grass patch is drawn at this distance: all of it near, thinning to nothing at `max`. */
export function grassFalloff(d: number, max: number) {
  const near = max * 0.35;
  if (d >= max) return 0;
  if (d <= near) return 1;
  const t = 1 - (d - near) / (max - near);
  return Math.max(0.1, t * t);
}

/** Leaf and grass cards are see-through and two-sided: their backs mustn't go black because the normal flips. */
export function softBacks(m: THREE.Material) {
  if (!(m.side === THREE.DoubleSide && m.alphaTest > 0 && (m as THREE.MeshStandardMaterial).isMeshStandardMaterial)) return m;
  const prev = m.onBeforeCompile.bind(m), key = m.customProgramCacheKey();
  m.onBeforeCompile = (sh, r) => { prev(sh, r); sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\nnormal = normalize(vNormal);'); };
  m.customProgramCacheKey = () => key + '|softBacks';
  return m;
}

/** Solid ground for one chunk: boxes on a grid about 3 m across, trunks and buildings among them. Pure: for tests too. */
export function chunkCollider(height: HeightSampler, x0: number, z0: number, size: number, extra: number[][] = []) {
  const xc = x0 + size / 2, zc = z0 + size / 2, n = Math.min(32, Math.max(8, Math.round(size / 3))), cell = size / n;
  let low = Infinity, peak = -Infinity;
  const tops: [number, number, number][] = [];
  for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) {
    const lx = -size / 2 + (a + 0.5) * cell, lz = -size / 2 + (b + 0.5) * cell, h = height(xc + lx, zc + lz);
    low = Math.min(low, h); peak = Math.max(peak, h); tops.push([lx, h, lz]);
  }
  const base = low - 4;
  const boxes = tops.map(([lx, h, lz]) => [lx, (h - base) / 2, lz, cell, h - base, cell]);
  for (const e of extra) { boxes.push([e[0] - xc, e[1] - base, e[2] - zc, e[3], e[4], e[5]]); peak = Math.max(peak, e[1] + e[4] / 2); }
  const top = peak - base + 1;
  return { x: xc, y: base, z: zc, collider: { shape: 'box' as const, size: [size, top, size] as [number, number, number], offset: [0, top / 2, 0] as [number, number, number], boxes } };
}

export class EndlessWorld {
  readonly group = new THREE.Group();
  readonly id: string;
  private chunks = new Map<string, Chunk>();
  private height: HeightSampler;
  private features;
  private models = new Map<string, Part[] | 'loading' | 'failed'>();
  private groundMat: THREE.MeshStandardMaterial;
  private world: World | null = null;

  constructor(private s: EndlessSettings, private urlOf: (id: string) => string | null, loadTex: (url: string) => THREE.Texture | null) {
    this.id = s.id;
    this.group.name = 'endless world';
    this.features = buildFeatures(s.config, s.roads.map((r) => ({ ...r, points: smoothPath(r.points) })), s.edits);
    this.height = worldHeight(s.config, s.edits, this.features);
    const url = s.ground ? urlOf(s.ground) : null, t = url ? loadTex(url) : null;
    let map: THREE.Texture | null = null;
    if (t) { map = t.clone(); map.wrapS = map.wrapT = THREE.RepeatWrapping; map.repeat.set(8 * 0.29, 8 * 0.29); map.colorSpace = THREE.SRGBColorSpace; map.needsUpdate = true; }
    this.groundMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0, map, color: map ? new THREE.Color(1 / GRAY_MEAN, 1 / GRAY_MEAN, 1 / GRAY_MEAN) : '#ffffff' });
  }

  /** How high the ground is here: for tests and for placing things. */
  heightAt(x: number, z: number) { return this.height(x, z); }
  get loaded() { return this.chunks.size; }
  get colliders() { let n = 0; for (const c of this.chunks.values()) if (c.collider) n++; return n; }

  /** Each frame: `at` is where the player or camera is, `world` the running game (null in the editor). */
  update(at: THREE.Vector3, world: World | null) {
    if (world !== this.world) { for (const c of this.chunks.values()) c.collider = undefined; this.world = world; }
    const size = this.s.config.terrain.chunkSize, cx = Math.floor(at.x / size), cz = Math.floor(at.z / size);
    // (Only grass: chunks as far as the grass reaches.)
    const view = this.s.grassOnly ? Math.max(1, Math.ceil(this.s.config.optimize.grassDistance / size)) : Math.max(1, Math.round(this.s.viewChunks));
    this.thinGrass(at);
    // Solid ground first and at once, wherever the player can reach before the next frame.
    if (world && !this.s.grassOnly) for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) this.ensureCollider(this.chunkAt(cx + a, cz + b), world);
    // What's in view, nearest first: one chunk of terrain a frame so the game doesn't hitch.
    let best: [number, number] | null = null, bestD = Infinity;
    for (let a = -view; a <= view; a++) for (let b = -view; b <= view; b++) {
      const d = Math.hypot(a, b); if (d > view + 0.5) continue;
      const lod = this.lodFor(d), have = this.chunks.get(`${cx + a},${cz + b}`);
      if ((!have || have.lod !== lod) && d < bestD) { bestD = d; best = [cx + a, cz + b]; }
    }
    if (best) { const c = this.chunkAt(best[0], best[1]); const lod = this.lodFor(bestD); if (c.lod !== lod) this.rebuild(c, lod); }
    let done = 0;
    for (const c of this.chunks.values()) if (!c.objectsDone && done < 1) { this.buildObjects(c); done++; }
    // Far behind: gone. They come back the same.
    for (const c of [...this.chunks.values()]) {
      const d = Math.max(Math.abs(c.cx - cx), Math.abs(c.cz - cz));
      if (d > view + 1) this.drop(c);
      else if (c.collider && d > 2) { world?.destroy(c.collider); c.collider = undefined; }
    }
  }

  private lodFor(d: number) { return d <= 1.5 ? 0 : d <= 3 ? 1 : 2; }

  /** Full density near the player, thinning with distance; each patch is culled by itself when it's out of view. */
  private thinGrass(at: THREE.Vector3) {
    const max = this.s.config.optimize.grassDistance;
    for (const c of this.chunks.values()) for (const m of c.objects.children as THREE.InstancedMesh[]) {
      const g = m.userData.grass as { x: number; z: number; full: number; fine: boolean } | undefined;
      if (!g) continue;
      m.count = Math.round(g.full * grassFalloff(Math.hypot(g.x - at.x, g.z - at.z), g.fine ? max * 0.35 : max));
      m.visible = m.count > 0;
    }
  }

  private chunkAt(cx: number, cz: number): Chunk {
    const key = `${cx},${cz}`;
    let c = this.chunks.get(key);
    if (c) return c;
    const group = new THREE.Group(), objects = new THREE.Group();
    c = { key, cx, cz, lod: -1, group, ground: new THREE.Mesh(new THREE.BufferGeometry(), this.groundMat), objects, objectsDone: true };
    c.ground.receiveShadow = true;
    group.add(c.ground, objects);
    this.chunks.set(key, c); this.group.add(group);
    this.rebuild(c, 1);
    return c;
  }

  private rebuild(c: Chunk, lod: number) {
    c.lod = lod; c.objectsDone = false;
    if (this.s.grassOnly) return; // (the land is already in the scene)
    const t = this.s.config.terrain, res = Math.max(4, Math.round(Math.min(64, t.resolution) / 2 ** lod));
    const m = terrainChunk(this.s.config, this.s.edits, this.features, this.height, c.cx, c.cz, res, lod);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(m.positions, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(m.normals, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(m.colors, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(m.uvs, 2)); g.setIndex(m.indices);
    c.ground.geometry.dispose(); c.ground.geometry = g; c.ground.castShadow = lod === 0;
  }

  private grassCache = new Map<string, ReturnType<typeof scatterSquare>>();

  /** Same order as the view and the same seeds, so a tree is where WorldCraft shows it. `solidOnly`: what the ground collision needs. */
  private scatter(c: Chunk, solidOnly = false) {
    const cfg = this.s.config, size = cfg.terrain.chunkSize, x0 = c.cx * size, z0 = c.cz * size;
    const ctx = { cfg, edits: this.s.edits, height: this.height, obstacles: [] as { x: number; z: number; r: number }[], water: this.features?.water, onRoad: this.features?.onRoad };
    const out: { layer: typeof cfg.layers[number]; items: ReturnType<typeof scatterSquare> }[] = [];
    for (const layer of cfg.layers) {
      if (!layer.enabled || (this.s.grassOnly && layer.kind !== 'grass') || (solidOnly && layer.kind === 'grass')) continue;
      // Grass is worked out once a chunk, in a random order so showing only the first part of a patch thins it evenly.
      const ck = layer.kind === 'grass' ? `${c.key}|${layer.id}` : '';
      let items = ck ? this.grassCache.get(ck) : undefined;
      if (!items) {
        items = scatterSquare(ctx, layer, x0, z0, size).filter((i) => !this.s.edits.removed.includes(i.uid));
        if (ck) { items.sort((a, b) => a.tint - b.tint); if (this.grassCache.size > 90) this.grassCache.delete(this.grassCache.keys().next().value!); this.grassCache.set(ck, items); }
      }
      if (layer.avoid) for (const i of items) ctx.obstacles.push({ x: i.x, z: i.z, r: 2 * i.scale });
      out.push({ layer, items });
    }
    return { out, structures: this.s.grassOnly ? [] : cfg.spawns.flatMap((sp) => structuresInSquare(ctx, sp, x0, z0, size)) };
  }

  private ensureCollider(c: Chunk, world: World) {
    if (c.collider) return;
    const cfg = this.s.config, size = cfg.terrain.chunkSize, extra: number[][] = [];
    const { out, structures } = this.scatter(c, true);
    for (const { layer, items } of out) if (layer.kind === 'tree') for (const it of items) extra.push([it.x, it.y + 4 * it.scale, it.z, 0.8 * it.scale, 8 * it.scale, 0.8 * it.scale]);
    for (const st of structures) { const def = this.s.structures[st.asset]; if (def) { const q = def.scale * st.scale; extra.push([st.x, st.y + (def.size[1] * q) / 2, st.z, def.size[0] * q, def.size[1] * q, def.size[2] * q]); } }
    const col = chunkCollider(this.height, c.cx * size, c.cz * size, size, extra);
    c.collider = world.addRuntime(makeInstance(0, 'EndlessGround', 'empty', { name: `Ground ${c.key}`, x: col.x, y: col.y, z: col.z, collider: col.collider as any, behaviors: [{ type: 'solid', props: behaviorDefaults('solid') } as any] }));
  }

  private model(asset: string): Part[] | null {
    const have = this.models.get(asset);
    if (have === 'loading' || have === 'failed') return null;
    if (have) return have;
    const url = this.urlOf(asset);
    if (!url) { this.models.set(asset, 'failed'); return null; }
    this.models.set(asset, 'loading');
    loadModel(url).then((lm) => {
      lm.scene.updateMatrixWorld(true);
      const parts: Part[] = [];
      lm.scene.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) parts.push({ geo: m.geometry.clone().applyMatrix4(m.matrixWorld), mat: softBacks(Array.isArray(m.material) ? m.material[0] : m.material) }); });
      this.models.set(asset, parts);
      // Chunks that were waiting for it.
      for (const c of this.chunks.values()) c.objectsDone = false;
    }).catch(() => { this.models.set(asset, 'failed'); });
    return null;
  }

  private buildObjects(c: Chunk) {
    c.objectsDone = true;
    for (const o of [...c.objects.children]) { (o as THREE.InstancedMesh).dispose?.(); c.objects.remove(o); }
    const { out, structures } = this.scatter(c);
    const q = new THREE.Quaternion(), qy = new THREE.Quaternion(), nor = new THREE.Vector3();
    for (const { layer, items } of out) {
      if (layer.kind === 'grass' && c.lod > 1) continue;
      if ((layer.kind === 'flower' || layer.kind === 'debris') && c.lod > 1) continue;
      const by = new Map<string, typeof items>();
      const gray = !!layer.copyGround && layer.kind !== 'tree';
      for (const it of items) { const k = streamKey(it.source, fallIndex(layer, it.tint), gray); let a = by.get(k); if (!a) { a = []; by.set(k, a); } a.push(it); }
      for (const [k, list] of by) {
        const def = this.s.sources[k]; if (!def) continue;
        const parts = this.model(c.lod >= 2 && def.far ? def.far : def.asset);
        if (!parts) { if (this.models.get(def.asset) === 'loading' || (def.far && this.models.get(def.far) === 'loading')) c.objectsDone = false; continue; }
        // Grass in patches, each culled and thinned by itself; everything else as one group for the chunk.
        const size = this.s.config.terrain.chunkSize, x0 = c.cx * size, z0 = c.cz * size;
        const groups = new Map<number, typeof list>();
        if (layer.kind === 'grass') for (const it of list) { const gk = Math.floor((it.x - x0) / 24) * 1000 + Math.floor((it.z - z0) / 24); let a = groups.get(gk); if (!a) { a = []; groups.set(gk, a); } a.push(it); }
        else groups.set(0, list);
        const colours = new Map<number, [number, number, number]>();
        const below = (x: number, z: number, y: number) => { const k = (Math.floor(x / 2.5) + 1048576) * 2097152 + (Math.floor(z / 2.5) + 1048576); let g = colours.get(k); if (!g) { g = groundColor(this.s.config, this.s.edits, x, z, y, 0, { plants: true }); colours.set(k, g); } return g; };
        for (const patch of groups.values()) for (const part of parts) {
          const mesh = new THREE.InstancedMesh(part.geo, part.mat, patch.length);
          patch.forEach((it, n) => {
            nor.set(it.nx, it.ny, it.nz); q.setFromUnitVectors(up, nor); qy.setFromAxisAngle(up, (it.ry * Math.PI) / 180); q.multiply(qy);
            dummy.position.set(it.x, it.y, it.z); dummy.quaternion.copy(q); dummy.scale.setScalar(it.scale * def.scale); dummy.updateMatrix();
            mesh.setMatrixAt(n, dummy.matrix);
            if (gray) { const g = below(it.x, it.z, it.y); mesh.setColorAt(n, color.setRGB(g[0] / GRAY_MEAN, g[1] / GRAY_MEAN, g[2] / GRAY_MEAN)); }
          });
          mesh.computeBoundingSphere(); // (for three's view culling; made now, while it holds every instance)
          mesh.castShadow = layer.kind !== 'grass' && c.lod === 0; mesh.receiveShadow = true; // (grass in shade must not glow)
          if (layer.kind === 'grass') {
            const tris = (part.geo.index ? part.geo.index.count : part.geo.attributes.position.count) / 3;
            mesh.userData.grass = { x: Math.floor((patch[0].x - x0) / 24) * 24 + x0 + 12, z: Math.floor((patch[0].z - z0) / 24) * 24 + z0 + 12, full: patch.length, fine: tris > 60 };
          }
          c.objects.add(mesh);
        }
      }
    }
    for (const st of structures) {
      const def = this.s.structures[st.asset]; if (!def) continue;
      const parts = this.model(def.asset);
      if (!parts) { if (this.models.get(def.asset) === 'loading') c.objectsDone = false; continue; }
      const holder = new THREE.Group(); holder.position.set(st.x, st.y, st.z); holder.rotation.y = (st.ry * Math.PI) / 180; holder.scale.setScalar(st.scale * def.scale);
      for (const part of parts) { const m = new THREE.Mesh(part.geo, part.mat); m.castShadow = c.lod === 0; m.receiveShadow = true; holder.add(m); }
      c.objects.add(holder);
    }
  }

  private drop(c: Chunk) {
    if (c.collider && this.world) this.world.destroy(c.collider);
    c.ground.geometry.dispose();
    for (const o of c.objects.children) (o as THREE.InstancedMesh).dispose?.();
    this.group.remove(c.group);
    this.chunks.delete(c.key);
  }

  dispose() {
    for (const c of [...this.chunks.values()]) this.drop(c);
    this.groundMat.map?.dispose(); this.groundMat.dispose();
    this.group.removeFromParent();
  }
}
