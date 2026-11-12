// Clouds, shared by GameCraft and WorldCraft. Two things that work together:
//  - CloudVolume: a real volume marched through a box in the sky, lit by the sun through itself (a few steps toward the
//    sun at each sample), so tops are bright, bases dark and edges glow. Drawn with the box's faces, so land in front of
//    the box hides it and it covers land behind it, with no depth pass.
//  - CloudPuffs: thousands of soft fog-particle billboards in one draw call, placed where the volume is dense: fine wisps
//    round the edges.
import * as THREE from 'three';
import type { CloudSettings } from '@shared/src/runtime/sky';
export { cloudDefaults, type CloudSettings } from '@shared/src/runtime/sky';

const N = 48;
let noiseData: Uint8Array | null = null;
let noiseTex: THREE.Data3DTexture | null = null;

/** Billowy noise that repeats: inverted cell noise at three sizes (round lumps) with its holes softened. */
function cloudNoise(): Uint8Array {
  if (noiseData) return noiseData;
  const out = new Uint8Array(N * N * N);
  const layer = (cells: number, seed: number) => {
    const pts = new Float32Array(cells * cells * cells * 3);
    let s = seed;
    const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    for (let i = 0; i < pts.length; i++) pts[i] = rnd();
    return (x: number, y: number, z: number) => {
      const fx = x * cells, fy = y * cells, fz = z * cells, ix = Math.floor(fx), iy = Math.floor(fy), iz = Math.floor(fz);
      let best = 9;
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) {
        const cx = ix + a, cy = iy + b, cz = iz + c;
        const k = (((cx % cells) + cells) % cells + (((cy % cells) + cells) % cells) * cells + (((cz % cells) + cells) % cells) * cells * cells) * 3;
        const dx = cx + pts[k] - fx, dy = cy + pts[k + 1] - fy, dz = cz + pts[k + 2] - fz, d = dx * dx + dy * dy + dz * dz;
        if (d < best) best = d;
      }
      return 1 - Math.min(1, Math.sqrt(best));
    };
  };
  const a = layer(4, 11), b = layer(9, 23), c = layer(17, 37);
  for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const u = x / N, v = y / N, w = z / N;
    out[x + y * N + z * N * N] = Math.round(255 * Math.min(1, a(u, v, w) * 0.62 + b(u, v, w) * 0.27 + c(u, v, w) * 0.11));
  }
  return (noiseData = out);
}
function noiseTexture() {
  if (noiseTex) return noiseTex;
  const t = new THREE.Data3DTexture(cloudNoise() as unknown as BufferSource as any, N, N, N);
  t.format = THREE.RedFormat; t.type = THREE.UnsignedByteType; t.minFilter = t.magFilter = THREE.LinearFilter;
  t.wrapS = t.wrapT = t.wrapR = THREE.RepeatWrapping; t.unpackAlignment = 1; t.needsUpdate = true;
  return (noiseTex = t);
}
function sampleNoise(x: number, y: number, z: number) {
  const d = cloudNoise(), f = (v: number) => (((v % 1) + 1) % 1) * N;
  const fx = f(x), fy = f(y), fz = f(z), ix = Math.floor(fx), iy = Math.floor(fy), iz = Math.floor(fz), a = fx - ix, b = fy - iy, c = fz - iz;
  const at = (p: number, q: number, r: number) => d[((ix + p) % N) + ((iy + q) % N) * N + ((iz + r) % N) * N * N] / 255;
  const l = (s: number, e: number, t: number) => s + (e - s) * t;
  return l(l(l(at(0, 0, 0), at(1, 0, 0), a), l(at(0, 1, 0), at(1, 1, 0), a), b), l(l(at(0, 0, 1), at(1, 0, 1), a), l(at(0, 1, 1), at(1, 1, 1), a), b), c);
}
const KINDS = { cumulus: 0, stratus: 1, cirrus: 2, towering: 3, mixed: 4 } as const;
const seedOffset = (seed = 0) => [((seed * 0.6180339) % 1) * 9000, ((seed * 0.4142135) % 1) * 9000] as const;
/** The volume's density at a point (no wind), the same sum as the shader's: used to place puffs. */
function densityAt(s: CloudSettings, x: number, y: number, z: number) {
  const [ox, oz] = seedOffset(s.seed); x += ox; z += oz;
  const v = Math.max(0, Math.min(1, s.variety ?? 0));
  const region = sampleNoise(x / (s.scale * 9), 0.71, z / (s.scale * 9));
  const kind = KINDS[s.kind ?? 'cumulus'] ?? 0, k = kind === 4 ? (region < 0.4 ? 1 : region > 0.62 ? 3 : 0) : kind;
  const topH = (k === 1 ? 0.45 : k === 2 ? 0.25 : 1) * (1 - v * 0.45 * (1 - region));
  let h = (y - s.base) / Math.max(1, s.thickness);
  if (h < 0 || h > topH) return 0;
  h /= topH;
  const sc = s.scale * (1 + (region - 0.5) * v * 1.1) * (k === 1 ? 1.8 : k === 3 ? 0.8 : 1);
  const low = sampleNoise(x / (sc * 3), 0.37, z / (sc * 3));
  const profile = Math.min(1, h / 0.14) * Math.min(1, (1 - h) / (k === 3 ? 0.2 : 0.45));
  const shape = low + (sampleNoise(x / sc, y / sc, z / sc) - 0.5) * (k === 1 ? 0.35 : 0.75);
  const cov = Math.max(0, Math.min(1, s.coverage + (region - 0.5) * v * 0.7));
  return Math.max(0, (shape - (1.04 - cov * 0.72)) * 5) * profile;
}

const VOLUME_VERT = /* glsl */ `
varying vec3 vWorld;
void main() { vec4 w = modelMatrix * vec4(position, 1.0); vWorld = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const VOLUME_FRAG = /* glsl */ `
precision highp float; precision highp sampler3D;
uniform sampler3D uNoise;
uniform vec3 uMin, uMax, uSun, uSunColor, uSkyTop, uSkyLow, uWind;
uniform float uCoverage, uScale, uDensity, uFar, uBaseY, uThick, uKind, uVariety;
uniform vec2 uOffset;
uniform int uSteps;
varying vec3 vWorld;
float hash(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
float density(vec3 p, bool fine) {
  vec3 q = p - uWind; q.xz += uOffset;
  // Each region of the sky its own: bigger or smaller clouds, higher or lower tops, fuller or emptier; in a mixed sky,
  // its own kind too (flat sheets, heaped clouds, towers).
  float region = texture(uNoise, vec3(q.x / (uScale * 9.0), 0.71, q.z / (uScale * 9.0))).r;
  float k = uKind > 3.5 ? (region < 0.4 ? 1.0 : region > 0.62 ? 3.0 : 0.0) : uKind;
  float topH = (k == 1.0 ? 0.45 : k == 2.0 ? 0.25 : 1.0) * (1.0 - uVariety * 0.45 * (1.0 - region));
  float h = (p.y - uBaseY) / uThick;
  if (h <= 0.0 || h >= topH) return 0.0;
  h /= topH;
  float sc = uScale * (1.0 + (region - 0.5) * uVariety * 1.1) * (k == 1.0 ? 1.8 : k == 3.0 ? 0.8 : 1.0);
  // Cirrus: stretched thin along one way.
  vec3 qs = k == 2.0 ? vec3(q.x * 0.25, q.y, q.z * 1.6) : q;
  float low = texture(uNoise, vec3(qs.x / (sc * 3.0), 0.37, qs.z / (sc * 3.0))).r;
  float profile = min(1.0, h / 0.14) * min(1.0, (1.0 - h) / (k == 3.0 ? 0.2 : 0.45));
  float cov = clamp(uCoverage + (region - 0.5) * uVariety * 0.7, 0.0, 1.0);
  float cut = 1.04 - cov * 0.72;
  if (low + 0.38 < cut) return 0.0; // nothing could reach it: skip the finer reads
  float shape = low + (texture(uNoise, qs / sc).r - 0.5) * (k == 1.0 ? 0.35 : 0.75);
  if (fine) shape -= (1.0 - texture(uNoise, qs / (sc * 0.21) + 0.3).r) * (k == 2.0 ? 0.2 : 0.07);
  return max(0.0, (shape - cut) * 5.0) * profile * (k == 2.0 ? 0.45 : 1.0);
}
void main() {
  vec3 ro = cameraPosition, rd = normalize(vWorld - ro);
  vec3 inv = 1.0 / rd, a = (uMin - ro) * inv, b = (uMax - ro) * inv, lo = min(a, b), hi = max(a, b);
  float t0 = max(max(lo.x, max(lo.y, lo.z)), 0.0), t1 = min(min(hi.x, min(hi.y, hi.z)), uFar);
  if (t1 <= t0) discard;
  float steps = float(uSteps), dt = (t1 - t0) / steps, lightStep = uThick * 0.16;
  float t = t0 + dt * hash(gl_FragCoord.xy);
  vec3 sum = vec3(0.0); float trans = 1.0;
  float mu = dot(rd, uSun);
  // Forward glow round the sun, a little back-scatter: the silver lining.
  float phase = 0.75 * (1.0 - 0.36) / pow(1.36 - 1.2 * mu, 1.5) / 4.0 + 0.32;
  float k = 0.012 * uDensity * (420.0 / uScale + 0.4);
  for (int i = 0; i < uSteps; i++) {
    vec3 p = ro + rd * t;
    float d = density(p, t < uFar * 0.4);
    if (d > 0.005) {
      float od = 0.0;
      for (int j = 0; j < 3; j++) od += density(p + uSun * lightStep * (float(j) + 0.6), false);
      float shadow = exp(-od * lightStep * k * 5.0);
      float powder = 1.0 - exp(-d * 4.0);
      float h = clamp((p.y - uBaseY) / uThick, 0.0, 1.0);
      vec3 col = mix(uSkyLow, uSkyTop, h * h) * 0.55 + uSunColor * shadow * phase * mix(0.55, 1.0, powder) * 1.7;
      float dT = exp(-d * dt * k);
      sum += trans * (1.0 - dT) * col;
      trans *= dT;
      if (trans < 0.02) break;
    }
    t += dt;
  }
  // Far cloud melts into the sky.
  float fade = 1.0 - smoothstep(uFar * 0.6, uFar, t0);
  float alpha = (1.0 - trans) * fade;
  if (alpha < 0.002) discard;
  gl_FragColor = vec4(sum / max(1.0 - trans, 0.001), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  gl_FragColor = vec4(gl_FragColor.rgb * alpha, alpha);
}`;

const PUFF_VERT = /* glsl */ `
attribute vec3 aPos; attribute vec2 aSize; // size, how far up the cloud (0..1)
uniform vec3 uWind, uCentre, uSun; uniform float uWrap;
varying vec2 vUv; varying float vHigh; varying float vSide; varying float vFade;
void main() {
  vec3 p = aPos + uWind;
  p.xz = mod(p.xz - uCentre.xz + uWrap, uWrap * 2.0) - uWrap + uCentre.xz;
  vec2 fromC = (p.xz - uCentre.xz) / uWrap; vFade = 1.0 - smoothstep(0.82, 1.0, max(abs(fromC.x), abs(fromC.y)));
  vec4 mv = viewMatrix * vec4(p, 1.0);
  mv.xy += position.xy * aSize.x;
  vUv = uv; vHigh = aSize.y; vSide = clamp((normalize(mat3(viewMatrix) * uSun).x * position.x + normalize(mat3(viewMatrix) * uSun).y * position.y) + 0.5, 0.0, 1.0);
  gl_Position = projectionMatrix * mv;
}`;
const PUFF_FRAG = /* glsl */ `
uniform sampler2D uMap; uniform vec3 uSunColor, uSkyTop, uSkyLow; uniform float uAlpha;
varying vec2 vUv; varying float vHigh; varying float vSide; varying float vFade;
void main() {
  vec4 t = texture2D(uMap, vUv);
  float a = t.a * dot(t.rgb, vec3(0.333)) * uAlpha * vFade;
  if (a < 0.003) discard;
  vec3 col = mix(uSkyLow, uSkyTop, vHigh * vHigh) * 0.55 + uSunColor * (0.3 + 0.45 * vSide) * (0.25 + 0.75 * vHigh) * 1.1;
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  gl_FragColor = vec4(gl_FragColor.rgb * a, a);
}`;

export class CloudLayer {
  readonly group = new THREE.Group();
  private volume: THREE.Mesh<THREE.BoxGeometry, THREE.ShaderMaterial>;
  private puffs: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial> | null = null;
  private puffSig = '';
  private shared = { uWind: { value: new THREE.Vector3() }, uSun: { value: new THREE.Vector3(0, 1, 0) }, uSunColor: { value: new THREE.Color('#fff4e3') }, uSkyTop: { value: new THREE.Color('#b4c8e4') }, uSkyLow: { value: new THREE.Color('#75808f') } };
  private wind = new THREE.Vector3();

  constructor(private puffTexture: () => THREE.Texture | null = () => null) {
    this.volume = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.ShaderMaterial({
      vertexShader: VOLUME_VERT, fragmentShader: VOLUME_FRAG, transparent: true, depthWrite: false, premultipliedAlpha: true, side: THREE.FrontSide, fog: false,
      uniforms: { ...this.shared, uNoise: { value: noiseTexture() }, uMin: { value: new THREE.Vector3() }, uMax: { value: new THREE.Vector3() }, uCoverage: { value: 0.5 }, uScale: { value: 400 }, uDensity: { value: 1 }, uFar: { value: 4000 }, uBaseY: { value: 0 }, uThick: { value: 100 }, uSteps: { value: 28 }, uKind: { value: 0 }, uVariety: { value: 0 }, uOffset: { value: new THREE.Vector2() } },
    }));
    this.volume.name = 'clouds'; this.volume.frustumCulled = false; this.volume.renderOrder = 5;
    this.group.add(this.volume);
  }

  /**
   * Each frame. `span` is half the width of the sky to fill round `centre`. `sun` is a unit vector; `skyTop`/`skyLow`
   * light the tops and bases from the sky. `windX/Z` move the clouds, in metres per second.
   */
  update(s: CloudSettings, o: { camera: THREE.Vector3; centre: THREE.Vector3; span: number; dt: number; windX: number; windZ: number; sun: THREE.Vector3; sunColor: THREE.Color; sunStrength: number; skyTop: THREE.Color; skyLow: THREE.Color }) {
    const on = s.coverage > 0;
    this.group.visible = on;
    if (!on) return;
    this.wind.x += o.windX * o.dt; this.wind.z += o.windZ * o.dt;
    this.shared.uWind.value.copy(this.wind);
    this.shared.uSun.value.copy(o.sun);
    this.shared.uSunColor.value.copy(o.sunColor).multiplyScalar(o.sunStrength);
    this.shared.uSkyTop.value.copy(o.skyTop); this.shared.uSkyLow.value.copy(o.skyLow);
    const u = this.volume.material.uniforms;
    const vol = s.style !== 'particles';
    this.volume.visible = vol;
    if (vol) {
      const top = s.base + s.thickness;
      this.volume.position.set(o.centre.x, s.base + s.thickness / 2, o.centre.z);
      this.volume.scale.set(o.span * 2, s.thickness, o.span * 2);
      (u.uMin.value as THREE.Vector3).set(o.centre.x - o.span, s.base, o.centre.z - o.span);
      (u.uMax.value as THREE.Vector3).set(o.centre.x + o.span, top, o.centre.z + o.span);
      u.uCoverage.value = s.coverage; u.uScale.value = Math.max(10, s.scale); u.uDensity.value = s.density; u.uBaseY.value = s.base; u.uThick.value = s.thickness;
      u.uFar.value = o.span * 2.2; u.uSteps.value = Math.max(8, Math.min(64, Math.round(s.steps)));
      u.uKind.value = KINDS[s.kind ?? 'cumulus'] ?? 0; u.uVariety.value = Math.max(0, Math.min(1, s.variety ?? 0));
      const [ox, oz] = seedOffset(s.seed); (u.uOffset.value as THREE.Vector2).set(ox, oz);
      // From inside the box its near faces are behind the camera: draw the far ones instead.
      const inside = Math.abs(o.camera.x - o.centre.x) < o.span && Math.abs(o.camera.z - o.centre.z) < o.span && o.camera.y > s.base && o.camera.y < top;
      const side = inside ? THREE.BackSide : THREE.FrontSide;
      if (this.volume.material.side !== side) { this.volume.material.side = side; this.volume.material.needsUpdate = true; }
    }
    this.updatePuffs(s, o.span, o.centre);
  }

  private updatePuffs(s: CloudSettings, span: number, centre: THREE.Vector3) {
    const want = s.style === 'volumetric' ? 0 : Math.round(s.puffs * 1000), map = this.puffTexture();
    const sig = `${want}|${s.coverage}|${s.base}|${s.thickness}|${s.scale}|${Math.round(span)}|${s.style}|${!!map}|${s.kind}|${s.variety}|${s.seed}`;
    if (sig !== this.puffSig) {
      this.puffSig = sig;
      if (this.puffs) { this.group.remove(this.puffs); this.puffs.geometry.dispose(); this.puffs.material.dispose(); this.puffs = null; }
      if (want > 0 && map) this.puffs = this.makePuffs(s, want, span, map);
      if (this.puffs) this.group.add(this.puffs);
    }
    if (this.puffs) {
      const u = this.puffs.material.uniforms;
      (u.uCentre.value as THREE.Vector3).copy(centre); u.uWrap.value = span;
      // Alone they carry the whole cloud; over the volume they only soften it.
      u.uAlpha.value = s.style === 'particles' ? 0.5 : 0.28;
    }
  }

  private makePuffs(s: CloudSettings, want: number, span: number, map: THREE.Texture) {
    const pos = new Float32Array(want * 3), size = new Float32Array(want * 2);
    let seed = 90211, n = 0;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    const base = Math.max(s.thickness * 0.45, s.scale * 0.16);
    // Rejection: tries are bounded, so a nearly clear sky just gets few puffs.
    for (let tries = 0; tries < want * 30 && n < want; tries++) {
      const x = (rnd() * 2 - 1) * span, z = (rnd() * 2 - 1) * span, h = rnd(), y = s.base + h * s.thickness;
      const d = densityAt(s, x, y, z);
      if (d < 0.04 || d > 2.2 && rnd() < 0.7 || rnd() > Math.min(1, d * 2)) continue;
      pos.set([x, y, z], n * 3);
      size.set([base * (0.45 + rnd() * 1.1), h], n * 2);
      n++;
    }
    const g = new THREE.InstancedBufferGeometry();
    const quad = new THREE.PlaneGeometry(1, 1);
    g.index = quad.index; g.setAttribute('position', quad.getAttribute('position')); g.setAttribute('uv', quad.getAttribute('uv'));
    g.setAttribute('aPos', new THREE.InstancedBufferAttribute(pos, 3)); g.setAttribute('aSize', new THREE.InstancedBufferAttribute(size, 2));
    g.instanceCount = n;
    const m = new THREE.Mesh(g, new THREE.ShaderMaterial({
      vertexShader: PUFF_VERT, fragmentShader: PUFF_FRAG, transparent: true, depthWrite: false, premultipliedAlpha: true, fog: false,
      uniforms: { uWind: this.shared.uWind, uSun: this.shared.uSun, uSunColor: this.shared.uSunColor, uSkyTop: this.shared.uSkyTop, uSkyLow: this.shared.uSkyLow, uMap: { value: map }, uCentre: { value: new THREE.Vector3() }, uWrap: { value: span }, uAlpha: { value: 0.3 } },
    }));
    m.frustumCulled = false; m.renderOrder = 6; m.name = 'cloud puffs';
    return m;
  }

  dispose() {
    this.volume.geometry.dispose(); this.volume.material.dispose();
    if (this.puffs) { this.puffs.geometry.dispose(); this.puffs.material.dispose(); }
  }
}
