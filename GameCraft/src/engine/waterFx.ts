// Water look (Material › Surface: Water, visual only): waves (the top of a box or cylinder, all round a sphere), foam
// where the water is thin (shores and around things that stick out of it, from a depth pre-pass of the scene without
// the water), cartoon foam patches, clear shallows that darken toward a deep colour, and caustics (an animated light
// pattern projected onto what is under the water by a spotlight just above it). The water's own material is patched,
// so ripples, texture slots and the stylised look keep working.
import * as THREE from 'three';
import { WATER_FX, hasWaterImage } from '@shared/src/runtime/water';
import type { InstanceData } from '@shared/src/runtime/scene';

/** Ripple rings at once per water (oldest replaced first). */
export const MAX_RIPPLES = 24;

export interface WaterUniforms {
  uTime: { value: number };
  /** height (0 = no waves), length, speed, shape (1 top surface, 2 all round). */
  uWave: { value: THREE.Vector4 };
  /** direction (radians), turbulence, seed, layers. */
  uWave2: { value: THREE.Vector4 };
  /** Fine surface detail (0–2) and how realistic (1) or stylised (0) the shading is: sky reflection at grazing angles. */
  uDetail: { value: number }; uReal: { value: number }; uSky: { value: THREE.Color }; uHighlight: { value: number };
  /** The scene without water (colour), for refraction. */
  uScene: { value: THREE.Texture | null }; uHasScene: { value: number };
  /** Rings from objects moving in the water: x, z, start time, height. */
  uRipples: { value: THREE.Vector4[] }; uRippleN: { value: number };
  uFoamColor: { value: THREE.Color }; uFoamWidth: { value: number }; uToon: { value: number };
  uDeep: { value: THREE.Color }; uClarity: { value: number };
  uDepth: { value: THREE.Texture | null }; uHasDepth: { value: number };
  uRes: { value: THREE.Vector2 };
  /** near, far, orthographic (1) */
  uCam: { value: THREE.Vector3 };
  /** Where the sun really is, and its colour, for the glitter on the water; the sky's horizon, for low reflections. */
  uSunDir: { value: THREE.Vector3 }; uSunTint: { value: THREE.Color }; uSkyLow: { value: THREE.Color };
}

/** Tell the water what sky it reflects: its glitter then follows the sun, and sunsets show in it. */
export function setWaterSky(u: WaterUniforms, sun: THREE.Vector3, sunColor: THREE.Color, skyTop: THREE.Color, skyHorizon: THREE.Color) {
  u.uSunDir.value.copy(sun).normalize(); u.uSunTint.value.copy(sunColor); u.uSky.value.copy(skyTop); u.uSkyLow.value.copy(skyHorizon);
}

/**
 * The pass water reads: the scene without the water, colour (for refraction) and depth (for foam and depth colour).
 * Shared, so every app's water sees the same thing. `scale` below 1 makes it cheaper.
 */
export class WaterPass {
  private rt: THREE.WebGLRenderTarget | null = null;
  private depthOnly = new THREE.MeshBasicMaterial({ colorWrite: false });
  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, cam: THREE.Camera, waters: WaterUniforms[], hide: THREE.Object3D[], colour: boolean, scale = 1) {
    const full = renderer.getDrawingBufferSize(new THREE.Vector2());
    const w = Math.max(1, Math.round(full.x * scale)), h = Math.max(1, Math.round(full.y * scale));
    if (!this.rt || this.rt.width !== w || this.rt.height !== h) {
      this.rt?.dispose();
      this.rt = new THREE.WebGLRenderTarget(w, h, { depthTexture: new THREE.DepthTexture(w, h), depthBuffer: true });
    }
    const hidden: THREE.Object3D[] = [];
    for (const o of hide) if (o.visible) { o.visible = false; hidden.push(o); }
    const prevTarget = renderer.getRenderTarget(), bg = scene.background, fog = scene.fog;
    // Depth only: one material for everything. With colour (for refraction) the scene draws as it is.
    if (!colour) { scene.overrideMaterial = this.depthOnly; scene.background = null; scene.fog = null; }
    renderer.setRenderTarget(this.rt);
    renderer.clear();
    renderer.render(scene, cam);
    renderer.setRenderTarget(prevTarget);
    scene.overrideMaterial = null; scene.background = bg; scene.fog = fog;
    for (const o of hidden) o.visible = true;
    const pc = cam as THREE.PerspectiveCamera;
    for (const u of waters) {
      u.uDepth.value = this.rt.depthTexture; u.uHasDepth.value = 1;
      u.uScene.value = this.rt.texture; u.uHasScene.value = colour && needsScene(u) ? 1 : 0;
      u.uRes.value.set(w, h); u.uCam.value.set(pc.near, pc.far, (cam as THREE.OrthographicCamera).isOrthographicCamera ? 1 : 0);
    }
  }
  dispose() { this.rt?.dispose(); this.rt = null; this.depthOnly.dispose(); }
}

const GLSL_COMMON = /* glsl */ `
uniform float uTime; uniform vec4 uWave; uniform float uDetail;
uniform vec4 uWave2; // direction (radians), turbulence (0..1), seed, layers (1..3)
uniform vec4 uRipples[${MAX_RIPPLES}]; uniform float uRippleN;
varying vec3 vWaterWorld; varying float vWaterTop; varying vec4 vWaterClip;
float waveH(vec2 p) {
  // Direction turns the whole pattern; the seed shifts each layer's phase; layers 1–3; turbulence adds a choppy
  // fast cross-wave.
  float c = cos(uWave2.x), s = sin(uWave2.x);
  p = vec2(c * p.x + s * p.y, -s * p.x + c * p.y);
  float k = 6.2831853 / max(0.05, uWave.y), t = uTime * uWave.z * 1.6, sd = uWave2.z;
  float l2 = step(1.5, uWave2.w), l3 = step(2.5, uWave2.w);
  float h = 0.5 * sin(dot(p, vec2(0.8, 0.6)) * k + t + sd * 1.7)
    + l2 * 0.3 * sin(dot(p, vec2(-0.45, 0.9)) * k * 1.7 + t * 1.3 + sd * 2.9)
    + l3 * 0.2 * sin(dot(p, vec2(0.95, -0.3)) * k * 0.6 - t * 0.8 + sd * 0.7);
  h += uWave2.y * 0.35 * sin(dot(p, vec2(0.2, -0.98)) * k * 3.1 + t * 2.3 + sd) * sin(dot(p, vec2(0.9, 0.4)) * k * 2.3 - t * 1.7);
  return uWave.x * h / (0.5 + 0.3 * l2 + 0.2 * l3) * 1.0;
}
// Slope of the big waves, plus (shading only) eight finer, faster crossing waves: the crinkled, sparkling surface of
// real water.
vec2 waveGrad(vec2 p) {
  vec2 g = vec2(0.0);
  float t = uTime * uWave.z * 1.6;
  if (uWave.x > 0.0) {
    // The big waves' slope, measured (so direction, layers and turbulence all shade right).
    float e = max(0.02, uWave.y * 0.02);
    g = vec2(waveH(p + vec2(e, 0.0)) - waveH(p - vec2(e, 0.0)), waveH(p + vec2(0.0, e)) - waveH(p - vec2(0.0, e))) / (2.0 * e);
  }
  if (uDetail > 0.0) {
    // Fine ripples far away are smaller than a pixel and only shimmer: they fade with distance, finest first.
    float far = length(cameraPosition.xz - p);
    for (int i = 0; i < 8; i++) {
      float fi = float(i), ang = fi * 2.399 + 0.5;
      vec2 d = vec2(cos(ang), sin(ang));
      float k = 2.2 * pow(1.55, fi), w = sqrt(9.8 * k) * 0.35;
      float keep = 1.0 / (1.0 + pow(far * k * 0.0035, 2.0));
      g += keep * uDetail * 0.16 / (1.0 + fi * 0.3) * cos(dot(p, d) * k - uTime * w * max(0.2, uWave.z) + fi * 1.7) * d;
    }
  }
  return g;
}
// Rings spreading from where objects move in the water: height and slope (x: height, yz: slope).
vec3 rippleHG(vec2 p) {
  vec3 r = vec3(0.0);
  for (int i = 0; i < ${MAX_RIPPLES}; i++) {
    if (float(i) >= uRippleN) break;
    vec4 c = uRipples[i];
    float age = uTime - c.z;
    if (age < 0.0 || age > 3.0 || c.w <= 0.0) continue;
    vec2 d = p - c.xy; float dist = length(d) + 1e-4;
    float x = dist - age * 1.3, w = 0.3 + age * 0.35, k = 7.0;
    float env = exp(-x * x / (w * w)) * exp(-age * 1.0) * c.w / (1.0 + dist * 0.4);
    r.x += env * sin(k * x);
    r.yz += env * (k * cos(k * x) - 2.0 * x / (w * w) * sin(k * x)) * d / dist;
  }
  return r;
}`;

const GLSL_FRAG = /* glsl */ `
uniform vec3 uFoamColor; uniform float uFoamWidth; uniform float uToon; uniform vec3 uDeep; uniform float uClarity;
uniform float uReal; uniform vec3 uSky; uniform float uHighlight; uniform sampler2D uScene; uniform float uHasScene;
uniform vec3 uSunDir, uSunTint, uSkyLow;
vec2 wSlope = vec2(0.0);
uniform sampler2D uDepth; uniform float uHasDepth; uniform vec2 uRes; uniform vec3 uCam;
float wHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float wNoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(wHash(i), wHash(i + vec2(1, 0)), f.x), mix(wHash(i + vec2(0, 1)), wHash(i + vec2(1, 1)), f.x), f.y); }
float wFbm(vec2 p) { return 0.55 * wNoise(p) + 0.3 * wNoise(p * 2.1 + 7.3) + 0.15 * wNoise(p * 4.3 - 3.1); }
float wLinZ(float d) { if (uCam.z > 0.5) return uCam.x + d * (uCam.y - uCam.x); float z = d * 2.0 - 1.0; return 2.0 * uCam.x * uCam.y / (uCam.y + uCam.x - z * (uCam.y - uCam.x)); }`;

/** Patch a water material; returns its uniforms (also kept on material.userData.waterU). */
export function patchWaterMaterial(m: THREE.MeshStandardMaterial): WaterUniforms {
  const u: WaterUniforms = {
    uTime: { value: 0 }, uWave: { value: new THREE.Vector4(0, 4, 1, 0) }, uWave2: { value: new THREE.Vector4(0, 0, 0, 3) },
    uFoamColor: { value: new THREE.Color('#ffffff') }, uFoamWidth: { value: 0 }, uToon: { value: 0 },
    uDeep: { value: new THREE.Color(WATER_FX.deepColor) }, uClarity: { value: 0 },
    uDetail: { value: 0 }, uReal: { value: 1 }, uSky: { value: new THREE.Color('#d6e9ff') }, uHighlight: { value: 1 }, uScene: { value: null }, uHasScene: { value: 0 },
    uRipples: { value: Array.from({ length: MAX_RIPPLES }, () => new THREE.Vector4()) }, uRippleN: { value: 0 },
    uDepth: { value: null }, uHasDepth: { value: 0 }, uRes: { value: new THREE.Vector2(1, 1) }, uCam: { value: new THREE.Vector3(0.1, 1000, 0) },
    uSunDir: { value: new THREE.Vector3(0.25, 1, 0.15).normalize() }, uSunTint: { value: new THREE.Color('#ffffff') }, uSkyLow: { value: new THREE.Color('#e4eef8') },
  };
  // Keeps an earlier patch (random tiling of its texture slots) and its program key.
  const prev = m.onBeforeCompile.bind(m), prevKey = m.customProgramCacheKey();
  m.onBeforeCompile = (sh, r) => {
    prev(sh, r);
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + GLSL_COMMON)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec4 wp0 = modelMatrix * vec4(transformed, 1.0);
        vWaterTop = uWave.w < 1.5 && objectNormal.y > 0.5 ? 1.0 : 0.0;
        if (uWave.x > 0.0) {
          vec3 sc = vec3(length(modelMatrix[0].xyz), length(modelMatrix[1].xyz), length(modelMatrix[2].xyz));
          // Top surface: every vertex on top (the sides' top edges too, so no gap opens at the rim), rings included.
          if (uWave.w < 1.5) { if (transformed.y > 0.0) transformed.y += (waveH(wp0.xz) + rippleHG(wp0.xz).x) / max(1e-4, sc.y); }
          else transformed += normalize(objectNormal) * waveH(wp0.xz + wp0.y * 0.7) / max(1e-4, sc.x);
        }
        vWaterWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;`)
      .replace('#include <project_vertex>', '#include <project_vertex>\n vWaterClip = gl_Position;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + GLSL_COMMON + GLSL_FRAG)
      .replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
        // Tilt the surface's own normal (ripple normal map included) by the waves' and rings' slope.
        if (vWaterTop > 0.5 && (uWave.x > 0.0 || uDetail > 0.0 || uRippleN > 0.0)) {
          vec2 g = waveGrad(vWaterWorld.xz) + rippleHG(vWaterWorld.xz).yz;
          wSlope = (viewMatrix * vec4(g.x, 0.0, g.y, 0.0)).xy;
          normal = normalize(normal + (viewMatrix * vec4(-g.x, 0.0, -g.y, 0.0)).xyz * (gl_FrontFacing ? 1.0 : -1.0));
        }`)
      .replace('#include <opaque_fragment>', `
        float wThick = 1e4;
        if (uHasDepth > 0.5) wThick = max(0.0, wLinZ(texture2D(uDepth, vWaterClip.xy / vWaterClip.w * 0.5 + 0.5).x) - wLinZ(gl_FragCoord.z));
        float wA = diffuseColor.a;
        // Realistic: what is under the water seen through it, bent by the waves and tinted by how much water the light
        // crosses; the sky reflected (Fresnel), darker or brighter as the crinkled surface tilts; the sun's glints.
        if (uReal > 0.0) {
          vec3 wV = isOrthographic ? vec3(0.0, 0.0, 1.0) : normalize(vViewPosition);
          float cosT = clamp(abs(dot(normal, wV)), 0.0, 1.0);
          float F = 0.02 + 0.98 * pow(1.0 - cosT, 5.0);
          vec3 lit = (reflectedLight.directDiffuse + reflectedLight.indirectDiffuse) / max(diffuseColor.rgb, vec3(0.05));
          float lum = clamp(dot(lit, vec3(0.3333)), 0.0, 1.5);
          vec3 nW = normalize((vec4(normal, 0.0) * viewMatrix).xyz), iW = normalize((vec4(-wV, 0.0) * viewMatrix).xyz);
          vec3 rW = reflect(iW, nW);
          // The sky it mirrors: pale at the horizon, deeper overhead (a low sun colours the water near the far shore).
          vec3 sky = mix(uSkyLow, uSky * 1.1, smoothstep(0.0, 0.55, rW.y)) * mix(0.55, 1.0, smoothstep(-0.1, 0.1, rW.y)) * max(lum, 0.25);
          // Glints: sharp bright streaks where the wavelets tilt toward the high sky.
          // (Ripples sparkle too, with or without waves: otherwise Highlights seemed to do nothing on calm water.)
          float wGlint = min(1.0, uDetail + uWave.x * 4.0);
          #ifdef USE_NORMALMAP
          wGlint = max(wGlint, 0.7);
          #endif
          // Glitter on the path to the real sun: a tight bright core in a wider sparkle.
          float wS = max(dot(rW, uSunDir), 0.0);
          vec3 glint = uSunTint * (pow(wS, 700.0) * 5.0 + pow(wS, 90.0) * 0.8) * lum * wGlint * uHighlight;
          vec3 sun = reflectedLight.directSpecular * uHighlight; // the lights' own highlights, same slider
          if (uHasScene > 0.5 && gl_FrontFacing) {
            vec2 suv = vWaterClip.xy / vWaterClip.w * 0.5 + 0.5, ruv = suv + wSlope * 0.06;
            if (wLinZ(texture2D(uDepth, ruv).x) < wLinZ(gl_FragCoord.z)) ruv = suv; // that spot is above the water: don't bend it in
            float th = max(0.0, wLinZ(texture2D(uDepth, ruv).x) - wLinZ(gl_FragCoord.z));
            vec3 trans = exp(-th * (1.0 - diffuseColor.rgb) * (0.04 + 0.3 * opacity)); // opacity: how murky per metre
            vec3 body = texture2D(uScene, ruv).rgb * trans + diffuseColor.rgb * lum * 0.35 * (1.0 - trans);
            outgoingLight = mix(body, sky, F) + sun + glint;
            wA = 1.0;
          } else {
            outgoingLight = mix(outgoingLight - reflectedLight.directSpecular + sun, sky + sun, F * 0.85) + glint;
            wA = mix(wA, 1.0, F * 0.7);
          }
        }
        else outgoingLight += reflectedLight.directSpecular * (uHighlight - 1.0); // stylised: the Highlights slider too
        if (uClarity > 0.0 && uHasDepth > 0.5) {
          float dk = smoothstep(0.0, uClarity, wThick);
          outgoingLight = mix(outgoingLight, uDeep + reflectedLight.directSpecular * 0.7, dk * 0.85);
          wA = mix(wA * 0.4, max(wA, 0.92), dk);
        }
        float wFoam = 0.0;
        if (uFoamWidth > 0.0 && uHasDepth > 0.5) {
          float n = wNoise(vWaterWorld.xz * 3.0 + vec2(uTime * 0.35, -uTime * 0.25));
          // Realistic: soft-edged lace, with bands that wash in toward the shore and fade. Stylised: the hard line.
          if (uReal > 0.0) {
            float wEdge = 1.0 - smoothstep(0.0, uFoamWidth, wThick + (n - 0.5) * uFoamWidth * 0.8);
            float wBand = 0.5 + 0.5 * sin(wThick / max(0.02, uFoamWidth) * 5.0 + uTime * 1.1 + n * 4.0);
            float wLace = smoothstep(0.42, 0.72, wFbm(vWaterWorld.xz * 2.2 + vec2(uTime * 0.12, uTime * 0.07)) + wBand * 0.28);
            wFoam = wEdge * wLace * 0.95 + pow(wEdge, 5.0) * 0.5;
            wFoam = clamp(wFoam, 0.0, 1.0);
          } else wFoam = step(wThick + (n - 0.5) * uFoamWidth * 0.8, uFoamWidth);
        }
        if (uToon > 0.0) wFoam = max(wFoam, step(0.8 - uToon * 0.2, wFbm(vWaterWorld.xz * 1.6 + vec2(uTime * 0.08, uTime * 0.05))));
        outgoingLight = mix(outgoingLight, uFoamColor, wFoam);
        diffuseColor.a = max(wA, wFoam);
        #include <opaque_fragment>`);
  };
  m.customProgramCacheKey = () => 'craft-water|' + prevKey;
  m.userData.waterU = u;
  return u;
}

/** A water mesh's geometry: a box / cylinder with a subdivided top when it has waves (spheres are dense enough). */
export function waterGeometry(kind: string, i: InstanceData): THREE.BufferGeometry | null {
  if (!i.material?.water?.waves) return null;
  const seg = (s: number) => Math.max(4, Math.min(160, Math.round(Math.abs(s) / 0.25)));
  if (kind === 'box' || kind === 'plane') return new THREE.BoxGeometry(1, kind === 'plane' ? 0.02 : 1, 1, seg(i.sx), 1, seg(i.sz));
  if (kind === 'sphere') return new THREE.SphereGeometry(0.5, 64, 40);
  if (kind === 'cylinder') return new THREE.CylinderGeometry(0.5, 0.5, 1, 64, 1, false);
  return null;
}

/** Apply the instance's water options to the uniforms (every frame: they are cheap). */
export function setWaterUniforms(u: WaterUniforms, i: InstanceData, time: number) {
  const w = i.material?.water ?? {};
  u.uTime.value = time;
  u.uWave.value.set(w.waves ? (w.waveHeight ?? WATER_FX.waveHeight) : 0, w.waveLength ?? WATER_FX.waveLength, w.waveSpeed ?? WATER_FX.waveSpeed, i.kind === 'sphere' ? 2 : 1);
  u.uWave2.value.set(((w.waveDirection ?? 0) * Math.PI) / 180, Math.max(0, Math.min(1, w.turbulence ?? 0)), w.waveSeed ?? 0, Math.max(1, Math.min(3, Math.round(w.waveLayers ?? 3))));
  // A picture on the water (Toon or the user's own) is what shows; realistic shading would look through it.
  const stylised = hasWaterImage(i);
  u.uDetail.value = w.waves && !stylised ? Math.max(0, w.detail ?? WATER_FX.detail) : 0;
  u.uReal.value = stylised ? 0 : 1;
  u.uHighlight.value = Math.max(0, w.highlights ?? WATER_FX.highlights);
  u.uFoamWidth.value = w.foam ? Math.max(0.01, w.foamWidth ?? WATER_FX.foamWidth) : 0;
  u.uFoamColor.value.set(w.foamColor ?? WATER_FX.foamColor);
  u.uToon.value = Math.max(0, Math.min(1, w.toonFoam ?? 0));
  u.uDeep.value.set(w.deepColor ?? WATER_FX.deepColor);
  u.uClarity.value = Math.max(0, w.clarity ?? 0);
}

/** Does this water need the depth pre-pass (foam at edges, depth colour)? */
export const needsDepth = (u: WaterUniforms) => u.uFoamWidth.value > 0 || u.uClarity.value > 0 || needsScene(u);
/** Does it see the scene through itself (realistic water with waves or a depth look)? Needs a colour pass too. */
export const needsScene = (u: WaterUniforms) => u.uReal.value > 0 && (u.uWave.value.x > 0 || u.uClarity.value > 0);

// ------------------------------------------------------------------ caustics

/** A seamless animated caustics pattern: bright thin lines where two moving Voronoi cells meet (one tile per frame). */
class CausticFrames {
  readonly frames: HTMLCanvasElement[] = [];
  constructor() {
    const T = 128, N = 4, F = 24;
    const pts = Array.from({ length: N * N }, (_, k) => ({ cx: (k % N) + 0.5, cy: Math.floor(k / N) + 0.5, r: 0.18 + ((k * 37) % 13) / 60, ph: ((k * 71) % 97) / 97 * Math.PI * 2 }));
    for (let f = 0; f < F; f++) {
      const t = (f / F) * Math.PI * 2, img = new ImageData(T, T);
      const P = pts.map((p) => [p.cx + Math.cos(t + p.ph) * p.r, p.cy + Math.sin(t * 1 + p.ph * 1.3) * p.r]);
      for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
        const u = (x / T) * N, v = (y / T) * N;
        let d1 = 9, d2 = 9;
        for (const [px, py] of P) for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
          const d = Math.hypot(u - (px + ox * N), v - (py + oy * N));
          if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
        }
        const e = d2 - d1, b = Math.max(0, 1 - e / 0.16) ** 2.2;
        const k = (y * T + x) * 4, c = Math.round(255 * b);
        img.data[k] = c; img.data[k + 1] = c; img.data[k + 2] = c; img.data[k + 3] = 255;
      }
      const c = document.createElement('canvas'); c.width = c.height = T;
      c.getContext('2d')!.putImageData(img, 0, 0);
      this.frames.push(c);
    }
  }
}
let caustics: CausticFrames | null = null;
const causticFrames = () => (caustics ??= new CausticFrames());

/** Repeats of the caustics tile across a light's cone (a spotlight's map is not repeated by three): one every ~2.5 m. */
export const causticTiles = (coneWidth: number) => Math.max(2, Math.min(16, Math.round(coneWidth / 2.5)));

/** The spotlight that projects caustics onto what is in and under a water object (its map is its own, tiled to fit). */
export function makeCausticLight(): THREE.SpotLight {
  const s = new THREE.SpotLight(0xbfefff, 0, 0, 0.8, 0.3, 0);
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 512;
  const tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace;
  s.map = tex;
  s.castShadow = true; // three projects a spotlight's map through its shadow camera
  s.shadow.mapSize.set(512, 512);
  s.shadow.bias = -0.0005;
  s.name = 'water caustics';
  s.userData.caustic = { canvas, tiles: 0, frame: -1 };
  return s;
}

/**
 * Place a caustics light just under the water's surface (world box), pointing down: everything below the surface
 * inside the water is in its cone, anything above the surface (the dry part of a rock, a boat) is behind it and stays
 * unlit. Sets its strength and plays its pattern. (A floor seen square-on gets the pattern undistorted however wide
 * the cone.)
 */
export function causticPose(box: THREE.Box3) {
  const c = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
  const span = Math.max(size.x, size.z) / 2, depth = Math.max(0.2, size.y);
  const top = box.max.y - Math.min(0.03, size.y * 0.1);
  const angle = Math.min(1.5, Math.atan((span * 1.15) / depth));
  return { position: new THREE.Vector3(c.x, top, c.z), target: new THREE.Vector3(c.x, box.min.y - 1, c.z), angle, distance: depth * 3 + span, floorWidth: 2 * Math.tan(angle) * depth };
}
/**
 * A thing standing in the water with the caustics light inside it (a rock at the pool's centre) would shadow the whole
 * floor. The light's shadows then start past that thing's underside; returns how far down that is.
 */
export function causticShadowStart(light: THREE.Vector3, boxes: Iterable<THREE.Box3>) {
  let near = 0;
  for (const b of boxes) if (b.containsPoint(light)) near = Math.max(near, light.y - b.min.y + 0.01);
  return near;
}
export function placeCausticLight(s: THREE.SpotLight, box: THREE.Box3, strength: number, time: number) {
  const p = causticPose(box);
  s.position.copy(p.position);
  s.target.position.copy(p.target);
  s.target.updateMatrixWorld();
  s.angle = p.angle;
  s.distance = p.distance;
  s.intensity = 40 * Math.max(0, strength);
  const near = Math.max(0.02, Number(s.userData.near) || 0);
  if (s.shadow.camera.near !== near) { s.shadow.camera.near = near; s.shadow.camera.updateProjectionMatrix(); } // (three only refreshes it for the far plane)
  s.shadow.camera.far = s.distance;
  // The pattern: whole tiles across the cone at the water's floor, 12 frames a second.
  const cd = s.userData.caustic as { canvas: HTMLCanvasElement; tiles: number; frame: number };
  const frames = causticFrames().frames;
  const tiles = causticTiles(p.floorWidth), f = Math.floor(time * 12) % frames.length;
  if (tiles === cd.tiles && f === cd.frame) return;
  cd.tiles = tiles; cd.frame = f;
  const g = cd.canvas.getContext('2d')!, px = cd.canvas.width / tiles;
  g.imageSmoothingEnabled = true;
  for (let y = 0; y < tiles; y++) for (let x = 0; x < tiles; x++) g.drawImage(frames[f], x * px, y * px, px + 0.5, px + 0.5);
  s.map!.needsUpdate = true;
}
