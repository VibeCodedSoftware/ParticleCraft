// Screen-space lighting passes that read the scene's depth: contact shadows (small dark lines where objects touch, which
// shadow maps are too coarse to show) and volumetric fog (a real volume marched from the camera, thicker near the ground,
// lit by the sun and cut by its shadow map, so light shafts appear). They run in HDR, before tone mapping.
import * as THREE from 'three';
import { FullScreenQuad, Pass } from 'three/examples/jsm/postprocessing/Pass.js';

export interface SunInfo { direction: THREE.Vector3; color: THREE.Color; intensity: number; light: THREE.DirectionalLight | null }
export interface VolumetricParams { density: number; height: number; falloff: number; color: string; sun: number; wisps: number; distance: number }

const VERT = `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const CONTACT_FRAG = `
  varying vec2 vUv;
  uniform sampler2D tDiffuse, tDepth;
  uniform mat4 uProj, uInvProj;
  uniform vec3 uSun;
  uniform float uStrength, uReach;
  const int STEPS = 14;
  vec3 viewAt(vec2 uv, float d) { vec4 p = uInvProj * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0); return p.xyz / p.w; }
  float hash(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
  void main() {
    vec4 color = texture2D(tDiffuse, vUv);
    float d = texture2D(tDepth, vUv).r;
    gl_FragColor = color;
    if (d >= 1.0 || uStrength <= 0.0) return;
    vec3 p = viewAt(vUv, d);
    float dist = -p.z;
    float fade = 1.0 - smoothstep(25.0, 45.0, dist); // only worth it close up, where the shadow map is too coarse
    if (fade <= 0.0) return;
    // On an object's outline the neighbouring pixel belongs to something else, and this pixel's surface can't be known.
    vec3 px = dFdx(p), py = dFdy(p);
    if (abs(px.z) + abs(py.z) > 0.04 * dist + 0.05) return;
    vec3 n = normalize(cross(px, py));
    if (dot(n, p) > 0.0) n = -n;
    if (dot(n, uSun) <= 0.02) return; // already facing away from the sun
    float reach = uReach * (1.0 + dist * 0.03);
    float jitter = 0.3 + 0.4 * hash(gl_FragCoord.xy);
    vec3 from = p + n * (0.012 + dist * 0.0015);
    float hit = 0.0;
    for (int i = 0; i < STEPS; i++) {
      float k = (float(i) + jitter) / float(STEPS);
      vec3 q = from + uSun * reach * k * k;
      vec4 c = uProj * vec4(q, 1.0);
      vec2 uv = c.xy / c.w * 0.5 + 0.5;
      if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) break;
      float sd = texture2D(tDepth, uv).r;
      if (sd >= 1.0) continue;
      float gap = viewAt(uv, sd).z - q.z; // > 0: something lies in front of the ray
      if (gap > 0.005 && gap < 0.25 + reach * 0.5) { hit = 1.0 - k * k; break; }
    }
    gl_FragColor.rgb *= 1.0 - uStrength * hit * fade;
  }`;

const VOLUME_FRAG = `
  #include <packing>
  varying vec2 vUv;
  uniform sampler2D tDepth, uShadow;
  uniform mat4 uInvViewProj, uShadowMatrix;
  uniform vec3 uCam, uSunDir, uSunColor, uColor;
  uniform float uDensity, uHeight, uFalloff, uSunAmount, uWisps, uMax, uTime, uHasShadow;
  const int STEPS = 28;
  float hash(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
  float h3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float noise(vec3 x) {
    vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(h3(i), h3(i + vec3(1,0,0)), f.x), mix(h3(i + vec3(0,1,0)), h3(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(h3(i + vec3(0,0,1)), h3(i + vec3(1,0,1)), f.x), mix(h3(i + vec3(0,1,1)), h3(i + vec3(1,1,1)), f.x), f.y), f.z);
  }
  float lit(vec3 p) {
    if (uHasShadow < 0.5) return 1.0;
    vec4 s = uShadowMatrix * vec4(p, 1.0);
    vec3 c = s.xyz / s.w;
    if (c.x < 0.0 || c.x > 1.0 || c.y < 0.0 || c.y > 1.0 || c.z > 1.0) return 1.0;
    return c.z - 0.002 <= unpackRGBAToDepth(texture2D(uShadow, c.xy)) ? 1.0 : 0.0;
  }
  void main() {
    float d = texture2D(tDepth, vUv).r;
    vec4 w = uInvViewProj * vec4(vUv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
    vec3 end = w.xyz / w.w, ray = end - uCam;
    float len = length(ray);
    vec3 dir = ray / max(len, 1e-4);
    len = min(len, uMax);
    float stepLen = len / float(STEPS);
    float t = stepLen * hash(gl_FragCoord.xy);
    float g = 0.45, cosA = dot(dir, uSunDir);
    float phase = (1.0 - g * g) / (12.566 * pow(max(1.0 + g * g - 2.0 * g * cosA, 1e-3), 1.5)) * 12.566 * 0.5;
    vec3 scatter = vec3(0.0);
    float trans = 1.0;
    for (int i = 0; i < STEPS; i++) {
      vec3 p = uCam + dir * t;
      float dens = uDensity * exp(-max(p.y - uHeight, 0.0) * uFalloff);
      if (uWisps > 0.0) dens *= mix(1.0, 0.25 + 1.5 * noise(p * 0.18 + vec3(uTime * 0.05, 0.0, uTime * 0.03)), uWisps);
      float s = exp(-dens * stepLen);
      vec3 light = uColor + uSunColor * uSunAmount * phase * lit(p);
      scatter += trans * (1.0 - s) * light;
      trans *= s;
      t += stepLen;
    }
    gl_FragColor = vec4(scatter, trans);
  }`;

const COMPOSITE_FRAG = `
  varying vec2 vUv;
  uniform sampler2D tDiffuse, tVolume;
  void main() {
    vec4 c = texture2D(tDiffuse, vUv), v = texture2D(tVolume, vUv);
    gl_FragColor = vec4(c.rgb * v.a + v.rgb, c.a);
  }`;

export class AtmospherePass extends Pass {
  contact = 0;
  volume: VolumetricParams | null = null;
  /** Where the sun is now (none: only the fog's own colour lights it). Set by the scene view. */
  sun: () => SunInfo | null = () => null;
  private contactMat = new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: CONTACT_FRAG, depthTest: false, depthWrite: false,
    uniforms: { tDiffuse: { value: null }, tDepth: { value: null }, uProj: { value: new THREE.Matrix4() }, uInvProj: { value: new THREE.Matrix4() }, uSun: { value: new THREE.Vector3() }, uStrength: { value: 0 }, uReach: { value: 0.6 } },
  });
  private volumeMat = new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: VOLUME_FRAG, depthTest: false, depthWrite: false,
    uniforms: {
      tDepth: { value: null }, uShadow: { value: null }, uInvViewProj: { value: new THREE.Matrix4() }, uShadowMatrix: { value: new THREE.Matrix4() }, uCam: { value: new THREE.Vector3() }, uSunDir: { value: new THREE.Vector3() }, uSunColor: { value: new THREE.Color() }, uColor: { value: new THREE.Color() },
      uDensity: { value: 0 }, uHeight: { value: 0 }, uFalloff: { value: 0.2 }, uSunAmount: { value: 1 }, uWisps: { value: 0 }, uMax: { value: 120 }, uTime: { value: 0 }, uHasShadow: { value: 0 },
    },
  });
  private compositeMat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: COMPOSITE_FRAG, depthTest: false, depthWrite: false, uniforms: { tDiffuse: { value: null }, tVolume: { value: null } } });
  private quad = new FullScreenQuad();
  private volumeTarget = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, depthBuffer: false });
  private temp: THREE.WebGLRenderTarget | null = null;

  constructor(private camera: THREE.Camera, private time: () => number) { super(); this.needsSwap = true; }

  setSize(width: number, height: number) { this.volumeTarget.setSize(Math.max(1, width >> 1), Math.max(1, height >> 1)); this.temp?.setSize(width, height); }

  render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget) {
    const cam = this.camera as THREE.PerspectiveCamera;
    const depth = readBuffer.depthTexture;
    const sun = this.sun();
    cam.updateMatrixWorld();
    const useContact = this.contact > 0 && !!sun && sun.intensity > 0.01 && !!depth;
    let source = readBuffer.texture;
    if (useContact) {
      const u = this.contactMat.uniforms;
      u.tDiffuse.value = source; u.tDepth.value = depth; u.uProj.value.copy(cam.projectionMatrix); u.uInvProj.value.copy(cam.projectionMatrixInverse);
      (u.uSun.value as THREE.Vector3).copy(sun!.direction).transformDirection(cam.matrixWorldInverse);
      u.uStrength.value = this.contact * Math.min(1, sun!.intensity);
      this.quad.material = this.contactMat;
      // (No depth of its own: a clone of the composer's target would share the depth this pass still has to read.)
      const out = this.volume ? (this.temp ??= new THREE.WebGLRenderTarget(writeBuffer.width, writeBuffer.height, { type: THREE.HalfFloatType, depthBuffer: false })) : writeBuffer;
      if (out === this.temp && (out.width !== writeBuffer.width || out.height !== writeBuffer.height)) out.setSize(writeBuffer.width, writeBuffer.height);
      renderer.setRenderTarget(out); this.quad.render(renderer);
      source = out.texture;
    }
    if (this.volume && depth) {
      const v = this.volume, u = this.volumeMat.uniforms;
      if (this.volumeTarget.width !== Math.max(1, writeBuffer.width >> 1)) this.volumeTarget.setSize(Math.max(1, writeBuffer.width >> 1), Math.max(1, writeBuffer.height >> 1));
      u.tDepth.value = depth;
      (u.uInvViewProj.value as THREE.Matrix4).copy(cam.matrixWorld).multiply(cam.projectionMatrixInverse);
      cam.getWorldPosition(u.uCam.value);
      u.uDensity.value = v.density; u.uHeight.value = v.height; u.uFalloff.value = v.falloff; u.uWisps.value = v.wisps; u.uMax.value = v.distance; u.uSunAmount.value = v.sun; u.uTime.value = this.time();
      (u.uColor.value as THREE.Color).set(v.color);
      const map = sun?.light?.shadow.map?.texture;
      const usable = !!map && !!sun?.light?.castShadow && renderer.shadowMap.enabled && renderer.shadowMap.type !== THREE.VSMShadowMap;
      // The sun's strength is on the scale of surface lighting; a volume needs only a share of it to read as lit air.
      if (sun) { (u.uSunDir.value as THREE.Vector3).copy(sun.direction); (u.uSunColor.value as THREE.Color).copy(sun.color).multiplyScalar(Math.min(1, sun.intensity) * 0.35); } else (u.uSunColor.value as THREE.Color).setRGB(0, 0, 0);
      u.uHasShadow.value = usable ? 1 : 0;
      u.uShadow.value = usable ? map : null;
      if (usable) (u.uShadowMatrix.value as THREE.Matrix4).copy(sun!.light!.shadow.matrix);
      this.quad.material = this.volumeMat;
      renderer.setRenderTarget(this.volumeTarget); this.quad.render(renderer);
      const c = this.compositeMat.uniforms;
      c.tDiffuse.value = source; c.tVolume.value = this.volumeTarget.texture;
      this.quad.material = this.compositeMat;
      renderer.setRenderTarget(writeBuffer); this.quad.render(renderer);
      return;
    }
    if (!useContact) {
      // Nothing to add this frame (no sun): pass the picture along.
      const c = this.compositeMat.uniforms;
      c.tDiffuse.value = source; c.tVolume.value = blankVolume();
      this.quad.material = this.compositeMat;
      renderer.setRenderTarget(writeBuffer); this.quad.render(renderer);
    }
  }

  dispose() { this.contactMat.dispose(); this.volumeMat.dispose(); this.compositeMat.dispose(); this.quad.dispose(); this.volumeTarget.dispose(); this.temp?.dispose(); }
}

let blank: THREE.DataTexture | null = null;
/** A volume with nothing in it: no light added, everything shows through. */
function blankVolume() {
  if (!blank) { blank = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1); blank.needsUpdate = true; }
  return blank;
}
