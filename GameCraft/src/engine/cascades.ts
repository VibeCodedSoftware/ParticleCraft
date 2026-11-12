// Cascaded shadow maps (Project settings › Shadows) while playing: several sun shadow maps, sharp near the camera and
// wider further out, so a big outdoor level has crisp shadows close up and still has shadows in the distance.
// Built on three's CSM. Every lit material must agree (without its shader change each cascade would light the scene once
// over), so materials are set up as they appear, and the single sun is switched off for as long as the cascades run.
import * as THREE from 'three';
import { CSM } from 'three/examples/jsm/csm/CSM.js';
import * as csmShaderFile from 'three/examples/jsm/csm/CSMShader.js';

// three's cascade shader was not updated when point light shadows gained an intensity: every shader failed to compile
// in a scene with a point light that casts shadows. Same call as three's own lights_fragment_begin.
const CSMShader = (csmShaderFile as unknown as { CSMShader: { lights_fragment_begin: string } }).CSMShader;
CSMShader.lights_fragment_begin = CSMShader.lights_fragment_begin.replace('pointLightShadow.shadowMapSize, pointLightShadow.shadowBias', 'pointLightShadow.shadowMapSize, pointLightShadow.shadowIntensity, pointLightShadow.shadowBias');

const isLit = (m: THREE.Material) => (m as THREE.MeshStandardMaterial).isMeshStandardMaterial || (m as THREE.MeshPhongMaterial).isMeshPhongMaterial || (m as THREE.MeshLambertMaterial).isMeshLambertMaterial || (m as THREE.MeshToonMaterial).isMeshToonMaterial;

export interface CascadeSettings { count: number; maxFar: number; size: number }

export class Cascades {
  private csm: CSM | null = null;
  private settings = '';
  private cameraKey = '';
  private prepared = new Map<THREE.Material, { before: THREE.Material['onBeforeCompile']; keyBefore: THREE.Material['customProgramCacheKey'] }>();
  private switchedOff: THREE.Light[] = [];
  private noShadow: THREE.Light[] = [];

  get lights(): THREE.DirectionalLight[] { return this.csm?.lights ?? []; }
  get active() { return !!this.csm; }

  /** Once a frame, before the world matrices are finished. */
  update(scene: THREE.Scene, camera: THREE.Camera, sun: THREE.DirectionalLight, s: CascadeSettings) {
    const key = `${s.count}|${s.maxFar}|${s.size}`;
    if (!this.csm || key !== this.settings || this.csm.camera !== camera) {
      this.stop();
      this.settings = key;
      // The sun's real strength is copied below each frame, so nothing depends on these starting values.
      this.csm = new CSM({ camera, parent: scene, cascades: s.count, maxFar: s.maxFar, mode: 'practical', shadowMapSize: s.size, shadowBias: -0.00004, lightNear: 1, lightFar: 800, lightMargin: 200 });
      this.csm.fade = true;
      for (const l of this.csm.lights) { l.name = 'cascade'; l.shadow.normalBias = 0.02; }
      this.cameraKey = '';
    }
    const csm = this.csm;
    const c = camera as THREE.PerspectiveCamera;
    const camKey = `${c.fov}|${c.aspect}|${c.near}|${c.far}|${c.zoom}|${(c as any).left}|${(c as any).right}`;
    if (camKey !== this.cameraKey) { this.cameraKey = camKey; c.updateProjectionMatrix(); csm.updateFrustums(); }
    // Same light as the sun it stands in for.
    sun.updateWorldMatrix(true, false); sun.target.updateWorldMatrix(true, false);
    const from = sun.getWorldPosition(new THREE.Vector3()), to = sun.target.getWorldPosition(new THREE.Vector3());
    csm.lightDirection.copy(to).sub(from).normalize();
    for (const l of csm.lights) { l.color.copy(sun.color); l.intensity = sun.intensity; l.visible = sun.intensity > 0.001; }
    // Only the cascades may be shadow-casting suns: the shader takes the first lights with shadows to be the cascades.
    scene.traverse((o) => {
      const l = o as THREE.DirectionalLight;
      if (!l.isDirectionalLight || l.name === 'cascade') return;
      if (l === sun) { if (l.visible) { l.visible = false; this.switchedOff.push(l); } }
      else if (l.castShadow) { l.castShadow = false; this.noShadow.push(l); }
    });
    c.updateMatrixWorld();
    csm.update();
    this.prepareMaterials(scene);
  }

  private prepareMaterials(scene: THREE.Scene) {
    const csm = this.csm!;
    scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      for (const m of ([] as THREE.Material[]).concat(mesh.material)) {
        if (!m || !isLit(m) || this.prepared.has(m)) continue;
        // three's setup replaces the material's shader hook: keep what the engine put there (global illumination, PS1 look).
        const before = m.onBeforeCompile, keyBefore = m.customProgramCacheKey;
        csm.setupMaterial(m);
        const mine = m.onBeforeCompile;
        m.onBeforeCompile = (shader, renderer) => { before.call(m, shader, renderer); mine.call(m, shader, renderer); };
        const k = keyBefore.call(m);
        m.customProgramCacheKey = () => 'csm|' + k;
        m.needsUpdate = true;
        this.prepared.set(m, { before, keyBefore });
        m.addEventListener('dispose', () => { this.prepared.delete(m); csm.shaders.delete(m); });
      }
    });
  }

  /** Back to the single sun. */
  stop() {
    if (!this.csm) return;
    for (const [m, was] of this.prepared) {
      m.onBeforeCompile = was.before; m.customProgramCacheKey = was.keyBefore;
      if (m.defines) { delete m.defines.USE_CSM; delete m.defines.CSM_CASCADES; delete m.defines.CSM_FADE; }
      m.needsUpdate = true;
    }
    this.prepared.clear();
    for (const l of this.switchedOff) l.visible = true;
    for (const l of this.noShadow) l.castShadow = true;
    this.switchedOff = []; this.noShadow = [];
    const csm = this.csm;
    csm.remove();
    for (const l of csm.lights) { l.shadow.map?.dispose(); l.dispose(); }
    csm.shaders.clear();
    this.csm = null; this.settings = '';
  }
}
