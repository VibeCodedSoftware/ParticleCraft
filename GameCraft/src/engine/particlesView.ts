// Renders shared-runtime emitters as GPU point sprites. Buffers are refilled from the emitter's
// struct-of-arrays every frame; nothing here simulates particles.
//
// ParticleCraft 2.0 effects: flipbooks (frame per particle, blending, custom order, sheet margins), emission strength,
// pixel-art (sharp) filtering and cut-out alpha, multiply / screen / additive / alpha blending, base colour and opacity,
// texture flips and rotation. Renderer types that need real geometry (meshes, ribbons, trails, stretched or flat
// billboards) are drawn as camera-facing points here — the exporter lists them under GameCraft compatibility.
import * as THREE from 'three';
import { evalCurve, hexToRgb, mixColor, type Emitter, type MaterialParams } from '@shared/src/runtime/particles';

const sprites = new Map<string, THREE.Texture>();
function spriteTex(kind: string, image?: string, nearest = false): THREE.Texture {
  // The effect's own picture, when it has one (it travels with the effect, so exports and ParticleCraft have it too).
  if (image) {
    const key = image + (nearest ? '|n' : '');
    let own = sprites.get(key);
    if (!own) {
      own = new THREE.TextureLoader().load(image); own.colorSpace = THREE.SRGBColorSpace;
      if (nearest) { own.magFilter = THREE.NearestFilter; own.minFilter = THREE.NearestFilter; own.generateMipmaps = false; }
      sprites.set(key, own);
    }
    return own;
  }
  let t = sprites.get(kind);
  if (t) return t;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grd = (stops: [number, string][]) => { const r = g.createRadialGradient(32, 32, 0, 32, 32, 32); stops.forEach(([o, col]) => r.addColorStop(o, col)); return r; };
  if (kind === 'square' || kind === 'debris' || kind === 'pixel') { g.fillStyle = '#fff'; kind === 'debris' ? (g.beginPath(), g.moveTo(10, 8), g.lineTo(56, 18), g.lineTo(44, 56), g.lineTo(6, 44), g.closePath(), g.fill()) : g.fillRect(8, 8, 48, 48); }
  else if (kind === 'spark' || kind === 'flare') { g.fillStyle = grd([[0, 'rgba(255,255,255,1)'], [0.25, 'rgba(255,255,255,.8)'], [1, 'rgba(255,255,255,0)']]); g.fillRect(0, 0, 64, 64); g.fillStyle = '#fff'; g.fillRect(30, 4, 4, 56); g.fillRect(4, 30, 56, 4); }
  else if (kind === 'star') { g.fillStyle = '#fff'; g.beginPath(); for (let i = 0; i < 10; i++) { const r = i % 2 ? 11 : 30, a = (i * Math.PI) / 5 - Math.PI / 2; g.lineTo(32 + Math.cos(a) * r, 32 + Math.sin(a) * r); } g.fill(); }
  else if (kind === 'smoke') { g.fillStyle = grd([[0, 'rgba(255,255,255,.9)'], [0.5, 'rgba(255,255,255,.35)'], [1, 'rgba(255,255,255,0)']]); g.fillRect(0, 0, 64, 64); }
  else if (kind === 'ring') { g.strokeStyle = '#fff'; g.lineWidth = 5; g.beginPath(); g.arc(32, 32, 24, 0, Math.PI * 2); g.stroke(); }
  else if (kind === 'glow') { g.fillStyle = grd([[0, 'rgba(255,255,255,1)'], [0.2, 'rgba(255,255,255,.55)'], [0.5, 'rgba(255,255,255,.15)'], [1, 'rgba(255,255,255,0)']]); g.fillRect(0, 0, 64, 64); }
  else if (kind === 'drop' || kind === 'leaf') { g.fillStyle = '#fff'; g.beginPath(); g.moveTo(32, 5); g.quadraticCurveTo(58, 40, 32, 59); g.quadraticCurveTo(6, 40, 32, 5); g.fill(); }
  else { g.fillStyle = grd([[0, 'rgba(255,255,255,1)'], [0.6, 'rgba(255,255,255,.6)'], [1, 'rgba(255,255,255,0)']]); g.fillRect(0, 0, 64, 64); }
  t = new THREE.CanvasTexture(c);
  if (kind === 'pixel') { t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; }
  sprites.set(kind, t);
  return t;
}

const vert = `
attribute float aSize; attribute vec4 aColor; attribute float aRot; attribute vec2 aFrame;
varying vec4 vColor; varying float vRot; varying vec2 vFrame;
uniform float uScale;
void main() {
  vColor = aColor; vRot = aRot; vFrame = aFrame;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * uScale / max(0.001, -mv.z);
  gl_Position = projectionMatrix * mv;
}`;
const frag = `
uniform sampler2D uMap; varying vec4 vColor; varying float vRot; varying vec2 vFrame;
uniform vec4 uGrid;   // cols, rows, frames (×3 when channel-packed), blend
uniform vec4 uSheet;  // margin x, margin y, gap x, gap y (fractions of the sheet)
uniform vec4 uLook;   // emission, alpha clip, pixel size, channel-packed
uniform vec3 uFlip;   // flip x, flip y, uv rotation (radians)
vec2 cell(float k, vec2 uv) {
  float n = max(1.0, uGrid.z / (uLook.w > 0.5 ? 3.0 : 1.0));
  float c = mod(k, n); vec2 g = uGrid.xy;
  vec2 fsz = (vec2(1.0) - 2.0 * uSheet.xy - (g - 1.0) * uSheet.zw) / g;
  return uSheet.xy + vec2(mod(c, g.x), floor(c / g.x)) * (fsz + uSheet.zw) + clamp(uv, 0.001, 0.999) * fsz;
}
vec4 sampleFrame(float k, vec2 uv) {
  vec4 t = texture2D(uMap, cell(k, uv));
  if (uLook.w > 0.5) { float n = uGrid.z / 3.0; float ch = floor(k / n); float v = ch < 0.5 ? t.r : ch < 1.5 ? t.g : t.b; return vec4(1.0, 1.0, 1.0, v); }
  return t;
}
void main() {
  vec2 p = gl_PointCoord - 0.5;
  if (uFlip.x > 0.5) p.x = -p.x;
  if (uFlip.y > 0.5) p.y = -p.y;
  float r = vRot + uFlip.z, c = cos(r), s = sin(r);
  vec2 uv = vec2(c * p.x - s * p.y, s * p.x + c * p.y) + 0.5;
  if (uLook.z > 0.0) uv = (floor(uv * uLook.z) + 0.5) / uLook.z;
  vec4 t;
  if (uGrid.z > 1.0) {
    t = sampleFrame(vFrame.x, uv);
    float f = vFrame.x - floor(vFrame.x);
    if (uGrid.w > 0.5 && f > 0.0) t = mix(t, sampleFrame(vFrame.y, uv), f);
  } else t = texture2D(uMap, uv);
  if (uLook.y > 0.0 && t.a < uLook.y) discard;
  if (uLook.y > 0.0) t.a = 1.0;
  gl_FragColor = vec4(vColor.rgb * t.rgb * uLook.x, vColor.a * t.a);
  if (gl_FragColor.a < 0.01) discard;
}`;

export class ParticleView {
  points: THREE.Points;
  private geo = new THREE.BufferGeometry();
  private cap = 0;
  constructor(public emitter: Emitter, orthographicScale = 0) {
    const mat = new THREE.ShaderMaterial({
      vertexShader: vert, fragmentShader: frag, transparent: true, depthWrite: false,
      blending: emitter.params.blending === 'additive' ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: { uMap: { value: spriteTex(emitter.params.texture, emitter.params.textureImage) }, uScale: { value: 600 }, uGrid: { value: new THREE.Vector4(1, 1, 1, 0) }, uSheet: { value: new THREE.Vector4() }, uLook: { value: new THREE.Vector4(1, 0, 0, 0) }, uFlip: { value: new THREE.Vector3() } },
    });
    this.points = new THREE.Points(this.geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 10 + (emitter.params.sortOrder ?? 0);
    void orthographicScale;
    this.alloc(emitter.params.maxParticles);
  }
  private alloc(n: number) {
    this.cap = n;
    this.geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aColor', new THREE.BufferAttribute(new Float32Array(n * 4), 4).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(n), 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aRot', new THREE.BufferAttribute(new Float32Array(n), 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aFrame', new THREE.BufferAttribute(new Float32Array(n * 2), 2).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aVel', new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aDis', new THREE.BufferAttribute(new Float32Array(n * 2), 2).setUsage(THREE.DynamicDrawUsage));
    this.quads?.dispose(); this.quads = undefined;
  }
  private quads?: QuadLayer;
  /** `pixelScale`: viewport height in px / (2 * tan(fov/2)) for perspective, or px per world unit for ortho. */
  update(pixelScale: number, ortho: boolean) {
    const e = this.emitter, p = e.params;
    if (e.params.maxParticles > this.cap) this.alloc(e.params.maxParticles);
    const mat = this.points.material as THREE.ShaderMaterial;
    const pixel = p.style === 'pixel' || p.filter === 'nearest';
    mat.uniforms.uMap.value = spriteTex(p.texture, p.textureImage, pixel);
    const mode = p.blendMode ?? (p.blending === 'additive' ? 'additive' : 'alpha');
    mat.blending = mode === 'additive' || mode === 'screen' ? THREE.AdditiveBlending : mode === 'multiply' ? THREE.MultiplyBlending : THREE.NormalBlending;
    mat.premultipliedAlpha = mode === 'multiply';
    // For ortho cameras the size must not shrink with depth; scale by a big constant depth.
    mat.uniforms.uScale.value = ortho ? pixelScale * 100 : pixelScale;
    const fb = p.flipbook;
    const frames = fb ? (fb.order?.length ? Math.max(1, fb.frames) * (fb.channelPacked ? 3 : 1) : Math.max(1, fb.frames) * (fb.channelPacked ? 3 : 1)) : 1;
    (mat.uniforms.uGrid.value as THREE.Vector4).set(fb?.cols ?? 1, fb?.rows ?? 1, frames, fb?.blend ? 1 : 0);
    (mat.uniforms.uSheet.value as THREE.Vector4).set(fb?.margin?.[0] ?? 0, fb?.margin?.[1] ?? 0, fb?.gap?.[0] ?? 0, fb?.gap?.[1] ?? 0);
    const clip = p.alphaClip ?? (p.style === 'pixel' || p.style === 'cartoon' || p.style === 'sprite' ? 0.5 : 0);
    (mat.uniforms.uLook.value as THREE.Vector4).set(p.emission ?? 1, clip, p.style === 'pixel' ? p.pixelSize ?? 12 : 0, fb?.channelPacked ? 1 : 0);
    (mat.uniforms.uFlip.value as THREE.Vector3).set(p.uv?.flipX ? 1 : 0, p.uv?.flipY ? 1 : 0, ((p.uv?.rotation ?? 0) * Math.PI) / 180);
    const base = p.material?.baseColor ? hexToRgb(p.material.baseColor) : null, opa = p.material?.opacity ?? 1;
    const pos = this.geo.attributes.position.array as Float32Array;
    const col = this.geo.attributes.aColor.array as Float32Array;
    const size = this.geo.attributes.aSize.array as Float32Array;
    const rot = this.geo.attributes.aRot.array as Float32Array;
    const frm = this.geo.attributes.aFrame.array as Float32Array;
    const vel = this.geo.attributes.aVel.array as Float32Array;
    const dis = this.geo.attributes.aDis.array as Float32Array;
    const dAmt = p.material?.dissolve ?? 0, dCurve = p.material?.dissolveCurve;
    const rich = !!(p.colorMid || p.gradient || p.randomColors || p.meshColors);
    for (let i = 0; i < e.count; i++) {
      const t = e.t(i);
      pos[i * 3] = e.px[i]; pos[i * 3 + 1] = e.py[i]; pos[i * 3 + 2] = e.pz[i];
      vel[i * 3] = e.vx[i]; vel[i * 3 + 1] = e.vy[i]; vel[i * 3 + 2] = e.vz[i];
      dis[i * 2] = dAmt > 0 ? dAmt * (dCurve ? Math.max(0, evalCurve(dCurve, t, 1)) : 1) : 0; dis[i * 2 + 1] = e.rnd[i];
      // colorAt covers the 2.0 gradient, random colours and image-spawn colours too.
      const [r, g, b] = rich ? e.colorAt(i) : mixColor(p.colorStart, p.colorEnd, t);
      col[i * 4] = base ? r * base[0] : r; col[i * 4 + 1] = base ? g * base[1] : g; col[i * 4 + 2] = base ? b * base[2] : b; col[i * 4 + 3] = Math.max(0, e.alphaAt(i)) * opa;
      size[i] = Math.max(0, e.sizeAt(i));
      rot[i] = (e.rotAt(i) * Math.PI) / 180;
      if (fb) {
        const f = e.frameAt(i);
        if (f < 0) { col[i * 4 + 3] = 0; continue; }
        const w = Math.floor(f), fr = f - w;
        if (fb.order?.length) { const n = fb.order.length; frm[i * 2] = fb.order[w % n] + fr; frm[i * 2 + 1] = fb.order[(w + 1) % n]; }
        else { frm[i * 2] = f; frm[i * 2 + 1] = (w + 1) % frames; }
      }
    }
    this.geo.setDrawRange(0, e.count);
    for (const k of ['position', 'aColor', 'aSize', 'aRot', 'aFrame', 'aVel', 'aDis']) (this.geo.attributes[k] as THREE.BufferAttribute).needsUpdate = true;
    // Flat, upright, stretched, lit and material particles are real quads (same buffers), drawn instead of the sprites.
    const lit = p.renderer === 'volumetric' ? p.lit ?? 0.8 : p.lit ?? 0;
    const mt = p.material, hasMat = !!(mt && (mt.normalMap || mt.heightMap || mt.alphaMap || mt.emissionMap || mt.gradientMap?.length || mt.dissolve || mt.emissionStrength));
    const quadMode = p.renderer === 'stretched' ? 1 : p.renderer === 'horizontal' ? 2 : p.renderer === 'vertical' ? 3 : lit > 0 || hasMat ? 0 : -1;
    if (quadMode >= 0) {
      this.quads ??= new QuadLayer(this.geo, mat, this.points);
      this.quads.update(e.count, quadMode, p.stretch ?? 0.08, lit, p.lightDir ?? [0.4, 0.8, 0.3], p.material?.rim ?? (p.renderer === 'volumetric' ? 0.35 : 0), mt);
      this.geo.setDrawRange(0, 0);
    } else if (this.quads) { this.quads.dispose(); this.quads = undefined; }
    this.updateExtras(pixelScale, ortho);
  }
  dispose() {
    this.geo.dispose(); (this.points.material as THREE.Material).dispose();
    this.extras?.dispose(); this.quads?.dispose();
  }
  private extras?: Extras;
  /** Meshes, glow halos and trails, drawn as children of the points (so hiding / removing the points covers them). */
  updateExtras(pixelScale: number, ortho: boolean) {
    const p = this.emitter.params;
    const want = p.renderer === 'mesh' || (p.glow ?? 0) > 0 || p.renderer === 'trail' || p.renderer === 'ribbon' || p.trail > 0;
    if (!want) { if (this.extras) { this.extras.dispose(); this.extras = undefined; } return; }
    this.extras ??= new Extras(this.points);
    this.extras.update(this.emitter, pixelScale, ortho);
    // Mesh particles replace the sprites.
    if (p.renderer === 'mesh') this.geo.setDrawRange(0, 0);
  }
}

// ------------------------------------------------------------------ quads (flat, upright, stretched, lit)
const quadVert = `
attribute vec3 iPos; attribute vec4 iColor; attribute float iSize; attribute float iRot; attribute vec2 iFrame; attribute vec3 iVel; attribute vec2 iDis;
uniform float uMode, uStretch;
varying vec4 vColor; varying vec2 vFrame; varying vec2 vUv; varying vec2 vQuad; varying vec2 vDis;
void main() {
  vColor = iColor; vFrame = iFrame; vDis = iDis;
  vec2 c = position.xy;               // -0.5 .. 0.5
  vQuad = c * 2.0; vUv = vec2(c.x + 0.5, 0.5 - c.y);
  float cr = cos(iRot), sr = sin(iRot);
  vec2 rc = vec2(c.x * cr - c.y * sr, c.x * sr + c.y * cr);
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  if (uMode > 1.5 && uMode < 2.5) {        // horizontal: lies on the ground
    gl_Position = projectionMatrix * viewMatrix * vec4(iPos + vec3(rc.x, 0.0, rc.y) * iSize, 1.0); return;
  }
  if (uMode > 2.5) {                         // vertical: upright, turns round Y only
    vec3 r = vec3(right.x, 0.0, right.z); r = length(r) > 1e-4 ? normalize(r) : vec3(1.0, 0.0, 0.0);
    gl_Position = projectionMatrix * viewMatrix * vec4(iPos + r * c.x * iSize + vec3(0.0, c.y * iSize, 0.0), 1.0); return;
  }
  vec4 mv = viewMatrix * vec4(iPos, 1.0);
  if (uMode > 0.5) {                         // stretched along the motion on screen
    vec2 d = (viewMatrix * vec4(iVel, 0.0)).xy; float len = length(d);
    d = len > 1e-4 ? d / len : vec2(0.0, 1.0);
    mv.xy += d * c.y * (iSize + 2.0 * len * uStretch) + vec2(-d.y, d.x) * c.x * iSize;
  } else mv.xy += rc * iSize;                // camera-facing (lit)
  gl_Position = projectionMatrix * mv;
}`;
const quadFrag = frag
  .replace('varying vec4 vColor; varying float vRot; varying vec2 vFrame;', `varying vec4 vColor; varying vec2 vFrame; varying vec2 vUv; varying vec2 vQuad; varying vec2 vDis;
uniform float uLit, uRim; uniform vec3 uLight;
uniform sampler2D uNormalMap, uHeightMap, uAlphaMap, uGradMap, uEmisMap;
uniform vec4 uMat1;  // has normal, has height, has alpha map, has gradient map
uniform vec4 uMat2;  // has emission map, emission strength, dissolve edge, -
uniform vec3 uEmisColor, uDisColor;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }
float fbm(vec2 p) { return 0.5 * vnoise(p) + 0.25 * vnoise(p * 2.03) + 0.125 * vnoise(p * 4.01) + 0.125 * vnoise(p * 8.07); }`)
  .replace(/vec2 p = gl_PointCoord - 0\.5;[\s\S]*?vec2 uv = vec2\(c \* p\.x - s \* p\.y, s \* p\.x \+ c \* p\.y\) \+ 0\.5;/, 'vec2 uv = vUv;\n  if (uFlip.x > 0.5) uv.x = 1.0 - uv.x;\n  if (uFlip.y > 0.5) uv.y = 1.0 - uv.y;')
  // Gradient map (colour from brightness, or from the packed channel) and alpha mask, before the cut-out.
  .replace('if (uLook.y > 0.0 && t.a < uLook.y) discard;', `if (uMat1.w > 0.5) {
    float lum = uLook.w > 0.5 ? t.a : dot(t.rgb, vec3(0.299, 0.587, 0.114));
    vec4 gm = texture2D(uGradMap, vec2(clamp(lum, 0.002, 0.998), 0.5));
    t = vec4(gm.rgb, (uLook.w > 0.5 ? lum : t.a) * gm.a);
  }
  if (uMat1.z > 0.5) t.a *= texture2D(uAlphaMap, uv).r;
  if (uLook.y > 0.0 && t.a < uLook.y) discard;`)
  .replace('gl_FragColor = vec4(vColor.rgb * t.rgb * uLook.x, vColor.a * t.a);', `vec3 rgb = vColor.rgb * t.rgb * uLook.x;
  if (uLit > 0.0) {
    // Normal map, height-map slopes, or a soft sphere; camera-relative light, plus a bright rim.
    vec3 n;
    if (uMat1.x > 0.5) { n = texture2D(uNormalMap, uv).xyz * 2.0 - 1.0; n.z = abs(n.z); n = normalize(n); }
    else if (uMat1.y > 0.5) {
      float e = 1.0 / 96.0; vec3 L3 = vec3(0.299, 0.587, 0.114);
      vec4 a1 = texture2D(uHeightMap, uv + vec2(e, 0.0)), a0 = texture2D(uHeightMap, uv - vec2(e, 0.0)), b1 = texture2D(uHeightMap, uv + vec2(0.0, e)), b0 = texture2D(uHeightMap, uv - vec2(0.0, e));
      n = normalize(vec3(-(dot(a1.rgb, L3) * a1.a - dot(a0.rgb, L3) * a0.a) * 4.0, (dot(b1.rgb, L3) * b1.a - dot(b0.rgb, L3) * b0.a) * 4.0, 1.0));
    } else { float r2 = dot(vQuad, vQuad); n = normalize(vec3(vQuad.x, vQuad.y, sqrt(max(0.0, 1.0 - min(r2, 1.0))) + 0.15)); }
    float diff = max(dot(n, normalize(uLight)), 0.0);
    rgb *= mix(1.0, 0.32 + 0.95 * diff, uLit);
    rgb += vColor.rgb * pow(1.0 - clamp(n.z, 0.0, 1.0), 3.0) * uRim;
  }
  if (uMat2.x > 0.5) rgb += texture2D(uEmisMap, uv).rgb * uEmisColor * uMat2.y;
  else if (uMat2.y > 0.0) rgb += uEmisColor * uMat2.y * 0.25;
  float alpha = vColor.a * t.a;
  // Dissolve over life with a glowing edge.
  if (vDis.x > 0.0) {
    float nz = fbm(vUv * 6.0 + vDis.y * 17.0);
    if (nz < vDis.x) discard;
    rgb = mix(uDisColor * 2.5, rgb, smoothstep(vDis.x, vDis.x + uMat2.z + 1e-4, nz));
  }
  gl_FragColor = vec4(rgb, alpha);`);

const WHITE = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1); WHITE.needsUpdate = true;
const rawMaps = new Map<string, THREE.Texture>();
/** Material maps: loaded as they are (no colour conversion, so normal / height values stay exact). */
function mapTex(url?: string): THREE.Texture { if (!url) return WHITE; let t = rawMaps.get(url); if (!t) { t = new THREE.TextureLoader().load(url); rawMaps.set(url, t); } return t; }
const gradTex = new Map<string, THREE.Texture>();
function gradientTex(stops: { t: number; c: string; a?: number }[]): THREE.Texture {
  const key = JSON.stringify(stops); let t = gradTex.get(key);
  if (!t) {
    const c = document.createElement('canvas'); c.width = 256; c.height = 1; const g = c.getContext('2d')!; const lg = g.createLinearGradient(0, 0, 256, 0);
    for (const s of stops) { const [r, gg, b] = hexToRgb(s.c); lg.addColorStop(Math.max(0, Math.min(1, s.t)), `rgba(${(r * 255) | 0},${(gg * 255) | 0},${(b * 255) | 0},${s.a ?? 1})`); }
    g.fillStyle = lg; g.fillRect(0, 0, 256, 1);
    t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; gradTex.set(key, t);
  }
  return t;
}

/** Instanced quads reading the point sprites' buffers. */
class QuadLayer {
  mesh: THREE.Mesh;
  private geo = new THREE.InstancedBufferGeometry();
  private mat: THREE.ShaderMaterial;
  private src: THREE.BufferGeometry;
  constructor(src: THREE.BufferGeometry, pointsMat: THREE.ShaderMaterial, parent: THREE.Object3D) {
    this.src = src;
    const plane = new THREE.PlaneGeometry(1, 1);
    this.geo.index = plane.index; this.geo.setAttribute('position', plane.attributes.position);
    const inst = (name: string, from: string, size: number) => this.geo.setAttribute(name, new THREE.InstancedBufferAttribute((src.attributes[from] as THREE.BufferAttribute).array as Float32Array, size).setUsage(THREE.DynamicDrawUsage));
    inst('iPos', 'position', 3); inst('iColor', 'aColor', 4); inst('iSize', 'aSize', 1); inst('iRot', 'aRot', 1); inst('iFrame', 'aFrame', 2); inst('iVel', 'aVel', 3); inst('iDis', 'aDis', 2);
    // The sprite material's uniforms (texture, flipbook, look) are shared, so both stay in step.
    this.mat = new THREE.ShaderMaterial({ vertexShader: quadVert, fragmentShader: quadFrag, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      uniforms: { ...pointsMat.uniforms, uMode: { value: 0 }, uStretch: { value: 0.08 }, uLit: { value: 0 }, uRim: { value: 0 }, uLight: { value: new THREE.Vector3(0.4, 0.8, 0.3) },
        uNormalMap: { value: WHITE }, uHeightMap: { value: WHITE }, uAlphaMap: { value: WHITE }, uGradMap: { value: WHITE }, uEmisMap: { value: WHITE },
        uMat1: { value: new THREE.Vector4() }, uMat2: { value: new THREE.Vector4() }, uEmisColor: { value: new THREE.Color(1, 1, 1) }, uDisColor: { value: new THREE.Color(1, 0.7, 0.25) } } });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    parent.add(this.mesh);
    this.pointsMat = pointsMat;
  }
  private pointsMat: THREE.ShaderMaterial;
  update(count: number, mode: number, stretch: number, lit: number, light: [number, number, number], rim: number, m?: MaterialParams) {
    this.geo.instanceCount = count;
    for (const k of ['iPos', 'iColor', 'iSize', 'iRot', 'iFrame', 'iVel', 'iDis']) (this.geo.attributes[k] as THREE.InstancedBufferAttribute).needsUpdate = true;
    const u = this.mat.uniforms;
    u.uMode.value = mode; u.uStretch.value = stretch; u.uLit.value = lit; u.uRim.value = rim; (u.uLight.value as THREE.Vector3).set(light[0], light[1], light[2]);
    // Material maps.
    u.uNormalMap.value = mapTex(m?.normalMap); u.uHeightMap.value = mapTex(m?.heightMap); u.uAlphaMap.value = mapTex(m?.alphaMap); u.uEmisMap.value = mapTex(m?.emissionMap);
    u.uGradMap.value = m?.gradientMap?.length ? gradientTex(m.gradientMap) : WHITE;
    (u.uMat1.value as THREE.Vector4).set(m?.normalMap ? 1 : 0, m?.heightMap && !m.normalMap ? 1 : 0, m?.alphaMap ? 1 : 0, m?.gradientMap?.length ? 1 : 0);
    (u.uMat2.value as THREE.Vector4).set(m?.emissionMap ? 1 : 0, m?.emissionStrength ?? 0, m?.dissolveEdge ?? 0.08, 0);
    const ec = hexToRgb(m?.emissionColor ?? '#ffffff'), dc = hexToRgb(m?.dissolveColor ?? '#ffb040');
    (u.uEmisColor.value as THREE.Color).setRGB(ec[0], ec[1], ec[2]); (u.uDisColor.value as THREE.Color).setRGB(dc[0], dc[1], dc[2]);
    this.mat.blending = this.pointsMat.blending; this.mat.premultipliedAlpha = this.pointsMat.premultipliedAlpha;
    this.mesh.renderOrder = (this.mesh.parent?.renderOrder ?? 10);
    void this.src;
  }
  dispose() { this.mesh.removeFromParent(); this.geo.dispose(); this.mat.dispose(); }
}

const MESHES: Record<string, () => THREE.BufferGeometry> = {
  cube: () => new THREE.BoxGeometry(0.8, 0.8, 0.8), tetra: () => new THREE.TetrahedronGeometry(0.6), octa: () => new THREE.OctahedronGeometry(0.55),
  shard: () => new THREE.OctahedronGeometry(0.5).scale(0.7, 1.2, 0.35), ico: () => new THREE.IcosahedronGeometry(0.5, 0), plane: () => new THREE.PlaneGeometry(1, 1),
};

/** Low-poly mesh particles, glow halos and trail / ribbon lines of one emitter. */
class Extras {
  private mesh?: THREE.InstancedMesh; private meshKind = '';
  private glow?: ParticleView;
  private lines?: THREE.LineSegments;
  private m4 = new THREE.Matrix4(); private q = new THREE.Quaternion(); private v = new THREE.Vector3(); private s = new THREE.Vector3(); private ax = new THREE.Vector3(); private c = new THREE.Color();
  constructor(private parent: THREE.Object3D) {}
  update(e: Emitter, pixelScale: number, ortho: boolean) {
    const p = e.params;
    // ---- meshes
    if (p.renderer === 'mesh') {
      const kind = p.meshShape ?? 'shard';
      if (!this.mesh || this.meshKind !== kind || this.mesh.instanceMatrix.count < p.maxParticles) {
        this.disposeMesh();
        const mat = new THREE.MeshStandardMaterial({ flatShading: true, roughness: 0.85, metalness: 0.05, transparent: true, side: THREE.DoubleSide });
        this.mesh = new THREE.InstancedMesh(MESHES[kind]?.() ?? MESHES.shard(), mat, Math.max(1, p.maxParticles));
        this.mesh.frustumCulled = false; this.meshKind = kind; this.parent.add(this.mesh);
      }
      const base = p.material?.baseColor ? hexToRgb(p.material.baseColor) : [1, 1, 1], em = p.emission ?? 1;
      let k = 0;
      for (let i = 0; i < e.count && k < this.mesh.instanceMatrix.count; i++) {
        const a = e.alphaAt(i); if (a <= 0.01) continue;
        const ang = (e.rotAt(i) * Math.PI) / 180, r1 = e.rnd[i] * Math.PI * 2, r2 = Math.acos(e.rnd2[i] * 2 - 1);
        this.ax.set(Math.sin(r2) * Math.cos(r1), Math.cos(r2), Math.sin(r2) * Math.sin(r1));
        this.q.setFromAxisAngle(this.ax, ang);
        // Fading particles shrink away (instances have no opacity of their own).
        const sz = Math.max(0.0001, e.sizeAt(i) * Math.min(1, a * 1.5));
        this.m4.compose(this.v.set(e.px[i], e.py[i], e.pz[i]), this.q, this.s.set(sz, sz, sz));
        this.mesh.setMatrixAt(k, this.m4);
        const [r, g, b] = e.colorAt(i);
        this.mesh.setColorAt(k, this.c.setRGB(r * base[0] * em, g * base[1] * em, b * base[2] * em));
        k++;
      }
      this.mesh.count = k;
      this.mesh.instanceMatrix.needsUpdate = true;
      if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
      (this.mesh.material as THREE.MeshStandardMaterial).opacity = p.material?.opacity ?? 1;
    } else this.disposeMesh();
    // ---- glow halos: the same particles again, bigger, additive, with a soft glow picture
    if ((p.glow ?? 0) > 0) {
      if (!this.glow) {
        const shadow = { ...e, params: { ...p } } as unknown as Emitter;
        this.glow = new ParticleView(shadow);
        this.parent.add(this.glow.points);
      }
      const ge = this.glow.emitter as any;
      Object.assign(ge, { count: e.count, px: e.px, py: e.py, pz: e.pz, rot: e.rot, rotv: e.rotv, age: e.age, life: e.life, size: e.size, rnd: e.rnd, rnd2: e.rnd2, cr: e.cr, cg: e.cg, cb: e.cb, links: undefined });
      const gs = p.glowSize ?? 2.5;
      ge.params = { ...p, glow: 0, trail: 0, flipbook: undefined, textureImage: undefined, texture: 'glow', blendMode: 'additive', blending: 'additive', renderer: 'billboard', style: 'smooth', alphaClip: 0, sizeStart: p.sizeStart * gs, sizeEnd: p.sizeEnd * gs, sizeCurve: p.sizeCurve, alphaCurve: undefined, alphaStart: 1, alphaEnd: 1, fadeIn: 0, gradient: p.glowColor ? undefined : p.gradient, colorStart: p.glowColor ?? p.colorStart, colorEnd: p.glowColor ?? p.colorEnd, colorMid: p.glowColor ? '' : p.colorMid, material: undefined, emission: 1 };
      // Halo strength: the particle's opacity × glow over life.
      ge.alphaAt = (i: number) => Math.min(1, e.alphaAt(i) * e.glowAt(i));
      ge.t = (i: number) => e.t(i); ge.sizeAt = (i: number) => e.sizeAt(i) * gs; ge.colorAt = (i: number) => (p.glowColor ? hexToRgb(p.glowColor) : e.colorAt(i)); ge.rotAt = (i: number) => e.rotAt(i); ge.frameAt = () => 0;
      this.glow.update(pixelScale, ortho);
      this.glow.points.renderOrder = this.parent.renderOrder - 1;
    } else if (this.glow) { this.glow.points.removeFromParent(); this.glow.dispose(); this.glow = undefined; }
    // ---- trails (history), ribbons (birth order) and streaks, as coloured lines
    const segs: number[] = [], cols: number[] = [];
    const push = (ax: number, ay: number, az: number, bx: number, by: number, bz: number, c: [number, number, number], a0: number, a1: number) => { segs.push(ax, ay, az, bx, by, bz); cols.push(c[0] * a0, c[1] * a0, c[2] * a0, c[0] * a1, c[1] * a1, c[2] * a1); };
    if (p.renderer === 'trail' && e.hist && e.histN) {
      const H = e.hist.length / e.px.length / 3;
      for (let i = 0; i < e.count; i++) {
        const n = e.histN[i]; if (!n) continue;
        const c = e.colorAt(i), a = Math.max(0, e.alphaAt(i));
        let px = e.px[i], py = e.py[i], pz = e.pz[i];
        for (let j = 0; j < n; j++) {
          const o = (i * H + (((e.histHead - j) % H) + H) % H) * 3;
          push(px, py, pz, e.hist[o], e.hist[o + 1], e.hist[o + 2], c, a * (1 - j / (n + 1)), a * (1 - (j + 1) / (n + 1)));
          px = e.hist[o]; py = e.hist[o + 1]; pz = e.hist[o + 2];
        }
      }
    } else if (p.renderer === 'ribbon') {
      const order = Array.from({ length: e.count }, (_, i) => i).sort((x, y) => e.sid[x] - e.sid[y]);
      for (let k = 1; k < order.length; k++) { const i = order[k - 1], j = order[k]; push(e.px[i], e.py[i], e.pz[i], e.px[j], e.py[j], e.pz[j], e.colorAt(j), Math.max(0, e.alphaAt(i)), Math.max(0, e.alphaAt(j))); }
    } else if (p.trail > 0) {
      for (let i = 0; i < e.count; i++) { const a = Math.max(0, e.alphaAt(i)); push(e.px[i], e.py[i], e.pz[i], e.px[i] - e.vx[i] * p.trail, e.py[i] - e.vy[i] * p.trail, e.pz[i] - e.vz[i] * p.trail, e.colorAt(i), a, 0); }
    }
    if (segs.length) {
      if (!this.lines) {
        this.lines = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
        this.lines.frustumCulled = false; this.parent.add(this.lines);
      }
      const g = this.lines.geometry;
      g.setAttribute('position', new THREE.Float32BufferAttribute(segs, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
      (this.lines.material as THREE.LineBasicMaterial).blending = (p.blendMode ?? (p.blending === 'additive' ? 'additive' : 'alpha')) === 'alpha' ? THREE.NormalBlending : THREE.AdditiveBlending;
    } else if (this.lines) { this.lines.removeFromParent(); this.lines.geometry.dispose(); (this.lines.material as THREE.Material).dispose(); this.lines = undefined; }
  }
  private disposeMesh() { if (this.mesh) { this.mesh.removeFromParent(); this.mesh.geometry.dispose(); (this.mesh.material as THREE.Material).dispose(); this.mesh = undefined; } }
  dispose() {
    this.disposeMesh();
    if (this.glow) { this.glow.points.removeFromParent(); this.glow.dispose(); this.glow = undefined; }
    if (this.lines) { this.lines.removeFromParent(); this.lines.geometry.dispose(); (this.lines.material as THREE.Material).dispose(); this.lines = undefined; }
  }
}
