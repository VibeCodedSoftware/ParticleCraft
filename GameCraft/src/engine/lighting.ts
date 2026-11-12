// Indirect light and scene-aware reflections on the GPU.
//  - GI: a grid of light probes. Each probe looks along the six axes and remembers the average light it sees; materials
//    read the probes around each pixel from one 3D texture, on top of the direct lights, so a red wall tints the floor
//    beside it. Baked (stored in the project) or real-time (a few probes refreshed every frame).
//  - Reflection probes: a cube picture of the scene from a point, used by the objects around it instead of the
//    environment image.
//  - Planar mirrors: the scene drawn again from below a flat surface (three's Reflector).
import * as THREE from 'three';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';
import { decodeProbes, probeIndex, type GiBake } from '@shared/src/runtime/lighting';

export const giUniforms = {
  uGiTex: { value: null as THREE.Data3DTexture | null },
  uGiMin: { value: new THREE.Vector3() }, uGiSize: { value: new THREE.Vector3(1, 1, 1) }, uGiDim: { value: new THREE.Vector3(2, 2, 2) },
  /** 0 = off (the shaders skip it), else the strength. */
  uGiStrength: { value: 0 },
  /** 1 = show only the indirect light (Debug view). */
  uGiView: { value: 0 },
};

const GI_FRAG = `
uniform highp sampler3D uGiTex; uniform vec3 uGiMin, uGiSize, uGiDim; uniform float uGiStrength, uGiView; varying vec3 vGiPos;
// The texture holds six copies of the grid side by side, one per direction. The sample stays within its copy.
vec3 giFace(vec3 uvw, float face) {
  vec3 t = clamp(uvw, 0.0, 1.0) * (uGiDim - 1.0) + 0.5;
  return texture(uGiTex, vec3((face * uGiDim.x + t.x) / (6.0 * uGiDim.x), t.y / uGiDim.y, t.z / uGiDim.z)).rgb;
}
vec3 giAt(vec3 p, vec3 n) {
  // A little off the surface, so a floor reads the air above it and not the probes inside it.
  vec3 cell = uGiSize / max(uGiDim - 1.0, vec3(1.0)), uvw = (p + n * min(cell.x, min(cell.y, cell.z)) * 0.5 - uGiMin) / uGiSize, w = n * n;
  return w.x * giFace(uvw, n.x > 0.0 ? 0.0 : 1.0) + w.y * giFace(uvw, n.y > 0.0 ? 2.0 : 3.0) + w.z * giFace(uvw, n.z > 0.0 ? 4.0 : 5.0);
}
`;

/** A material's second reflection probe and how much of it to use (0 = none). */
export const envBlend = (m: THREE.Material): { uEnvB: { value: THREE.Texture | null }; uEnvMix: { value: number } } => (m.userData.envBlend ??= { uEnvB: { value: null }, uEnvMix: { value: 0 } });

/** Let a material read the probe volume (a uniform switches it on, so turning GI on and off needs no recompile). */
export function patchGi(m: THREE.Material) {
  if ((m as any).__gi || !(m as any).isMeshStandardMaterial) return;
  (m as any).__gi = true;
  const prev = m.onBeforeCompile.bind(m), prevKey = m.customProgramCacheKey();
  m.customProgramCacheKey = () => 'gi|' + prevKey;
  m.onBeforeCompile = (sh, r) => {
    prev(sh, r);
    Object.assign(sh.uniforms, giUniforms);
    // Two reflection probes at once: everything that reads the prefiltered environment reads both, mixed.
    const blend = envBlend(m);
    sh.uniforms.uEnvB = blend.uEnvB; sh.uniforms.uEnvMix = blend.uEnvMix;
    sh.fragmentShader = sh.fragmentShader.replace('#include <envmap_physical_pars_fragment>', THREE.ShaderChunk.envmap_physical_pars_fragment
      .replace('#ifdef USE_ENVMAP', `#ifdef USE_ENVMAP
        uniform sampler2D uEnvB; uniform float uEnvMix;
        vec4 craftEnv(vec3 d, float rough) { vec4 a = textureCubeUV(envMap, d, rough); return uEnvMix > 0.0 ? mix(a, textureCubeUV(uEnvB, d, rough), uEnvMix) : a; }`)
      .replace(/textureCubeUV\( envMap, /g, 'craftEnv( '));
    sh.vertexShader = 'varying vec3 vGiPos;\n' + sh.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>
      #ifdef USE_INSTANCING
      vGiPos = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
      #else
      vGiPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
      #endif`);
    sh.fragmentShader = GI_FRAG + sh.fragmentShader
      .replace('#include <lights_fragment_maps>', `#include <lights_fragment_maps>
        #if defined(RE_IndirectDiffuse)
        if (uGiStrength > 0.0) irradiance += giAt(vGiPos, inverseTransformDirection(normal, viewMatrix)) * PI * uGiStrength;
        #endif`)
      .replace('#include <opaque_fragment>', `if (uGiView > 0.5) outgoingLight = uGiStrength > 0.0 ? giAt(vGiPos, inverseTransformDirection(normal, viewMatrix)) * uGiStrength : vec3(0.0);
        #include <opaque_fragment>`);
  };
  m.needsUpdate = true;
}

const DIRS: { d: [number, number, number]; up: [number, number, number] }[] = [
  { d: [1, 0, 0], up: [0, 1, 0] }, { d: [-1, 0, 0], up: [0, 1, 0] }, { d: [0, 1, 0], up: [0, 0, 1] }, { d: [0, -1, 0], up: [0, 0, 1] }, { d: [0, 0, 1], up: [0, 1, 0] }, { d: [0, 0, -1], up: [0, 1, 0] },
];

/** Looks around from points in the scene and writes what it saw into probe values. */
export class ProbeCapture {
  private res = 8;
  // All six looks in one picture, so the GPU is only waited for once per probe.
  private rt = new THREE.WebGLRenderTarget(this.res * 6, this.res, { type: THREE.HalfFloatType, depthBuffer: true });
  private cam = new THREE.PerspectiveCamera(90, 1, 0.05, 400);
  private buf = new Uint16Array(this.res * 6 * this.res * 4);
  private tmp = new THREE.Vector3();
  constructor(private renderer: THREE.WebGLRenderer, private scene: THREE.Scene) {}
  /** The six averages at a point into `out`, starting at `at` (`hide` is already applied by the caller). */
  capture(pos: THREE.Vector3, out: Float32Array, at: number) {
    const { renderer, scene, cam, rt, buf, res } = this;
    cam.position.copy(pos);
    rt.scissorTest = true;
    DIRS.forEach((f, face) => {
      cam.up.set(f.up[0], f.up[1], f.up[2]);
      cam.lookAt(this.tmp.set(pos.x + f.d[0], pos.y + f.d[1], pos.z + f.d[2]));
      cam.updateMatrixWorld();
      rt.viewport.set(face * res, 0, res, res); rt.scissor.set(face * res, 0, res, res);
      renderer.setRenderTarget(rt);
      renderer.render(scene, cam);
    });
    renderer.readRenderTargetPixels(rt, 0, 0, res * 6, res, buf);
    const row = res * 6, n = res * res;
    for (let face = 0; face < 6; face++) {
      let r = 0, g = 0, b = 0;
      for (let y = 0; y < res; y++) for (let x = 0; x < res; x++) {
        const k = (y * row + face * res + x) * 4;
        r += THREE.DataUtils.fromHalfFloat(buf[k]); g += THREE.DataUtils.fromHalfFloat(buf[k + 1]); b += THREE.DataUtils.fromHalfFloat(buf[k + 2]);
      }
      const o = at + face * 3;
      out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n;
    }
  }
  dispose() { this.rt.dispose(); }
}

/** The volume as a 3D texture: six grids side by side along X. */
export class ProbeVolume {
  tex: THREE.Data3DTexture;
  data: Uint16Array;
  constructor(public min: number[], public size: number[], public dims: [number, number, number]) {
    const [w, h, d] = dims;
    this.data = new Uint16Array(w * 6 * h * d * 4);
    this.tex = new THREE.Data3DTexture(this.data as any, w * 6, h, d);
    this.tex.format = THREE.RGBAFormat; this.tex.type = THREE.HalfFloatType;
    this.tex.minFilter = this.tex.magFilter = THREE.LinearFilter;
    this.tex.wrapS = this.tex.wrapT = this.tex.wrapR = THREE.ClampToEdgeWrapping;
    this.tex.unpackAlignment = 1;
  }
  write(values: Float32Array) {
    const [w, h, d] = this.dims, to = this.data;
    for (let z = 0; z < d; z++) for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const from = probeIndex(this.dims, x, y, z);
      for (let f = 0; f < 6; f++) {
        const o = (f * w + x + y * (w * 6) + z * (w * 6) * h) * 4;
        for (let c = 0; c < 3; c++) to[o + c] = THREE.DataUtils.toHalfFloat(values[from + f * 3 + c]);
        to[o + 3] = 15360; // 1.0
      }
    }
    this.tex.needsUpdate = true;
  }
  use(strength: number) {
    giUniforms.uGiTex.value = this.tex;
    giUniforms.uGiMin.value.set(this.min[0], this.min[1], this.min[2]);
    giUniforms.uGiSize.value.set(this.size[0], this.size[1], this.size[2]);
    giUniforms.uGiDim.value.set(this.dims[0], this.dims[1], this.dims[2]);
    giUniforms.uGiStrength.value = strength;
  }
  dispose() { this.tex.dispose(); }
  static fromBake(b: GiBake): ProbeVolume {
    const v = new ProbeVolume(b.min, b.size, b.dims);
    v.write(decodeProbes(b.data));
    return v;
  }
}

/** Probes drawn as balls in their captured light (GI debug view): one colour per probe, the average of its six looks. */
export function probeDebugMesh(values: Float32Array, min: number[], size: number[], dims: [number, number, number]): THREE.InstancedMesh {
  const [w, h, d] = dims, n = w * h * d;
  const mesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.09, 8, 6), new THREE.MeshBasicMaterial({ toneMapped: false }), n);
  const m = new THREE.Matrix4(), c = new THREE.Color();
  let k = 0;
  for (let z = 0; z < d; z++) for (let y = 0; y < h; y++) for (let x = 0; x < w; x++, k++) {
    m.setPosition(min[0] + (size[0] * x) / (w - 1), min[1] + (size[1] * y) / (h - 1), min[2] + (size[2] * z) / (d - 1));
    mesh.setMatrixAt(k, m);
    const o = probeIndex(dims, x, y, z);
    let r = 0, g = 0, b = 0;
    for (let f = 0; f < 6; f++) { r += values[o + f * 3]; g += values[o + f * 3 + 1]; b += values[o + f * 3 + 2]; }
    mesh.setColorAt(k, c.setRGB(Math.min(1, r / 6), Math.min(1, g / 6), Math.min(1, b / 6)));
  }
  mesh.frustumCulled = false;
  return mesh;
}

/** A cube picture of the scene from a point, prefiltered for every roughness. */
export class ReflectionProbe {
  private cube: THREE.WebGLCubeRenderTarget;
  private cam: THREE.CubeCamera;
  private pm: THREE.WebGLRenderTarget | null = null;
  constructor(private renderer: THREE.WebGLRenderer, res: number) {
    this.cube = new THREE.WebGLCubeRenderTarget(res, { type: THREE.HalfFloatType });
    this.cam = new THREE.CubeCamera(0.05, 500, this.cube);
  }
  get texture() { return this.pm?.texture ?? null; }
  capture(scene: THREE.Scene, at: THREE.Vector3) {
    this.cam.position.copy(at);
    this.cam.update(this.renderer, scene);
    const gen = new THREE.PMREMGenerator(this.renderer);
    const next = gen.fromCubemap(this.cube.texture);
    gen.dispose();
    this.pm?.dispose();
    this.pm = next;
  }
  dispose() { this.cube.dispose(); this.pm?.dispose(); }
}

/** A flat mirror over a surface: the sharper the angle the stronger, like real polish. */
const MIRROR_SHADER = {
  name: 'CraftMirror',
  uniforms: { color: { value: null }, tDiffuse: { value: null }, textureMatrix: { value: null }, uStrength: { value: 0.6 } },
  vertexShader: `uniform mat4 textureMatrix; varying vec4 vUv; varying vec3 vView; varying vec3 vN;
    void main() { vUv = textureMatrix * vec4(position, 1.0); vec4 mv = modelViewMatrix * vec4(position, 1.0); vView = -mv.xyz; vN = normalMatrix * normal; gl_Position = projectionMatrix * mv; }`,
  fragmentShader: `uniform vec3 color; uniform sampler2D tDiffuse; uniform float uStrength; varying vec4 vUv; varying vec3 vView; varying vec3 vN;
    void main() {
      float f = pow(1.0 - clamp(dot(normalize(vView), normalize(vN)), 0.0, 1.0), 3.0);
      gl_FragColor = vec4(texture2DProj(tDiffuse, vUv).rgb * color, clamp(uStrength * (0.55 + 0.45 * f), 0.0, 1.0));
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
};

export function makeMirror(resolution: number, y: number): Reflector {
  const r = new Reflector(new THREE.PlaneGeometry(1, 1), { textureWidth: resolution, textureHeight: resolution, clipBias: 0.002, multisample: 2, shader: MIRROR_SHADER as any });
  const mat = r.material as THREE.ShaderMaterial;
  mat.transparent = true; mat.depthWrite = false;
  mat.polygonOffset = true; mat.polygonOffsetFactor = -2;
  r.rotation.x = -Math.PI / 2; r.position.y = y;
  r.renderOrder = 1;
  r.userData.mirror = true;
  return r;
}
