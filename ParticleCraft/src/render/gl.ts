// ParticleCraft's WebGL2 particle renderer (preview and picture export).
//
// Hybrid rendering: every system keeps its own renderer type, style, blend mode and textures, and all of them are
// drawn into one scene. Camera-facing / horizontal / vertical / stretched / point / volumetric particles of every
// system go through ONE back-to-front sorted pass with premultiplied-alpha blending, so additive glows and alpha-
// blended smoke from different systems interleave correctly (additive = premultiplied colour with zero alpha).
// Meshes (low-poly debris) are depth-tested 3D shapes; ribbons and trails are camera-facing strips; multiply/screen
// systems get their own passes; distortion bends the finished scene; bloom spreads emission over 1.
import { Emitter, evalCurve, hexToRgb, type EmitterParams } from '@shared/src/runtime/particles';
import { builtinTexture, gradientStrip, pictureOf } from './textures';

export interface GLCamera {
  persp: boolean; yaw: number; pitch: number;
  /** Perspective: orbit distance, target and focal length in px. */
  dist: number; target: [number, number, number]; f: number;
  /** Orthographic: px per world unit and the view-space point at the anchor. */
  ppu: number; viewC: [number, number];
  /** Screen point (px, y down) of the view centre. */
  anchor: [number, number];
  width: number; height: number;
}
export interface RenderOpts {
  /** Drawn first (grid, shapes, background colour) so distortion can bend it. */
  background?: HTMLCanvasElement | null;
  /** Clear colour when there is no background (premultiplied; [0,0,0,0] = transparent). */
  clear?: [number, number, number, number];
  bloom?: number;
  /** Ground plane height for soft particles. */
  ground?: number;
  time?: number;
}

const NV = 16; // vec4s per layer
const MAXL = 10; // layers per batch
const SLOTS = 12; // texture units for layer pictures
const RT: Record<string, number> = { billboard: 0, stretched: 1, horizontal: 2, vertical: 3, point: 4, volumetric: 5 };

const QUAD_VS = `#version 300 es
precision highp float;
layout(location=0) in vec2 aCorner;
layout(location=1) in vec3 iPos;
layout(location=2) in vec2 iSize;
layout(location=3) in float iRot;
layout(location=4) in vec4 iColor;
layout(location=5) in vec4 iMisc; // frame, layer, rand, dissolve
layout(location=6) in vec4 iVel;  // velocity, kind (0 particle, 1 glow halo)
uniform mat3 uRot; uniform vec3 uTarget; uniform float uPersp, uDist, uF, uPpu; uniform vec2 uRes, uAnchor, uViewC;
uniform vec4 uL[${MAXL * NV}];
out vec2 vUv; out vec2 vQuad; out vec4 vColor; flat out int vLayer; out float vFrame; out float vRand; out float vDis; out float vKind; out float vWorldY; out float vDepth;
vec3 toView(vec3 p) { return uPersp > 0.5 ? uRot * (p - uTarget) : uRot * p; }
vec4 projectV(vec3 v) {
  if (uPersp > 0.5) {
    float d = uDist + v.z; float dd = max(d, 0.001);
    vec2 s = uAnchor + vec2(v.x, -v.y) * uF / dd;
    float z = clamp((d - 0.05) / 500.0, 0.0, 1.0) * 2.0 - 1.0;
    return vec4((s.x / uRes.x * 2.0 - 1.0) * dd, (1.0 - s.y / uRes.y * 2.0) * dd, z * dd, dd);
  }
  vec2 s = uAnchor + vec2(v.x - uViewC.x, -(v.y - uViewC.y)) * uPpu;
  return vec4(s.x / uRes.x * 2.0 - 1.0, 1.0 - s.y / uRes.y * 2.0, clamp(v.z / 1000.0 + 0.5, 0.0, 1.0) * 2.0 - 1.0, 1.0);
}
void main() {
  int L = int(iMisc.y + 0.5);
  float type = uL[L * ${NV}].x;
  vec2 c = aCorner;
  vQuad = c; vUv = vec2(c.x * 0.5 + 0.5, 0.5 - c.y * 0.5);
  vColor = iColor; vLayer = L; vFrame = iMisc.x; vRand = iMisc.z; vDis = iMisc.w; vKind = iVel.w;
  float cr = cos(iRot), sr = sin(iRot);
  vec2 hs = iSize * 0.5;
  vec3 center = toView(iPos);
  vec3 v; vec3 worldOff = vec3(0.0);
  if (iVel.w > 0.5 || type == 0.0 || type == 5.0) {
    vec2 o = vec2(c.x * cr - c.y * sr, c.x * sr + c.y * cr) * hs;
    v = center + vec3(o, 0.0);
    worldOff = vec3(dot(uRot[0], vec3(o, 0.0)), dot(uRot[1], vec3(o, 0.0)), dot(uRot[2], vec3(o, 0.0)));
  } else if (type == 1.0) {
    vec3 vv = uRot * iVel.xyz; float len = length(vv.xy);
    vec2 dir = len > 1e-4 ? vv.xy / len : vec2(0.0, 1.0); vec2 nrm = vec2(-dir.y, dir.x);
    float along = hs.y + len * uL[L * ${NV} + 2].w;
    vec2 o = dir * c.y * along + nrm * c.x * hs.x;
    v = center + vec3(o, 0.0);
  } else if (type == 2.0) {
    worldOff = vec3((c.x * cr - c.y * sr) * hs.x, 0.0, (c.x * sr + c.y * cr) * hs.y);
    v = toView(iPos + worldOff);
  } else if (type == 3.0) {
    vec3 right = vec3(uRot[0][0], 0.0, uRot[2][0]); right = length(right) > 1e-4 ? normalize(right) : vec3(1.0, 0.0, 0.0);
    worldOff = right * c.x * hs.x + vec3(0.0, c.y * hs.y, 0.0);
    v = toView(iPos + worldOff);
  } else {
    vec4 cc = projectV(center);
    float px = clamp(hs.x * 2.0 * (uPersp > 0.5 ? uF / max(cc.w, 0.001) : uPpu), 1.5, 4.0);
    cc.xy += c * px / uRes * 2.0 * cc.w;
    gl_Position = cc; vWorldY = iPos.y; vDepth = cc.w; return;
  }
  vWorldY = iPos.y + worldOff.y;
  vec4 p = projectV(v);
  vDepth = uPersp > 0.5 ? uDist + v.z : 100.0;
  gl_Position = p;
}`;

const QUAD_FS = `#version 300 es
precision highp float;
in vec2 vUv; in vec2 vQuad; in vec4 vColor; flat in int vLayer; in float vFrame; in float vRand; in float vDis; in float vKind; in float vWorldY; in float vDepth;
uniform vec4 uL[${MAXL * NV}];
${Array.from({ length: SLOTS }, (_, i) => `uniform sampler2D uT${i};`).join('\n')}
uniform sampler2D uScene;
uniform mat3 uRot; uniform float uTime, uGround; uniform int uPass; uniform vec2 uRes;
out vec4 outColor;
vec4 tex(int s, vec2 uv) {
${Array.from({ length: SLOTS }, (_, i) => `  ${i ? 'else ' : ''}if (s == ${i}) return texture(uT${i}, uv);`).join('\n')}
  return vec4(1.0);
}
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }
float fbm(vec2 p) { return 0.5 * vnoise(p) + 0.25 * vnoise(p * 2.03) + 0.125 * vnoise(p * 4.01) + 0.125 * vnoise(p * 8.07); }
vec4 gMG; // sheet margin.xy, gap.zw (fractions of the sheet)
vec2 cellUv(float k, vec2 uv, float cols, float rows, float frames) {
  float cell = mod(k, frames);
  float cx = mod(cell, cols), cy = floor(cell / cols);
  vec2 n = vec2(cols, rows);
  vec2 fsz = (vec2(1.0) - 2.0 * gMG.xy - (n - 1.0) * gMG.zw) / n;
  return gMG.xy + vec2(cx, cy) * (fsz + gMG.zw) + clamp(uv, 0.001, 0.999) * fsz;
}
vec4 frameSample(int slot, float k, vec2 uv, float cols, float rows, float frames, float packed) {
  if (packed > 0.5) {
    float ch = floor(k / frames); vec4 t = tex(slot, cellUv(k, uv, cols, rows, frames));
    float v = ch < 0.5 ? t.r : ch < 1.5 ? t.g : t.b;
    return vec4(v, v, v, v);
  }
  return tex(slot, cellUv(k, uv, cols, rows, frames));
}
vec3 surfaceNormal(int sNormal, int sHeight, vec2 uv) {
  if (sNormal >= 0) { vec3 n = tex(sNormal, uv).xyz * 2.0 - 1.0; n.z = abs(n.z); return normalize(n); }
  if (sHeight >= 0) {
    float e = 1.0 / 96.0;
    // Height = brightness × opacity, so both grey height maps and white-on-transparent shapes work.
    vec3 L3 = vec3(0.299, 0.587, 0.114);
    vec4 hx1 = tex(sHeight, uv + vec2(e, 0.0)), hx0 = tex(sHeight, uv - vec2(e, 0.0)), hy1 = tex(sHeight, uv + vec2(0.0, e)), hy0 = tex(sHeight, uv - vec2(0.0, e));
    float dx = dot(hx1.rgb, L3) * hx1.a - dot(hx0.rgb, L3) * hx0.a;
    float dy = dot(hy1.rgb, L3) * hy1.a - dot(hy0.rgb, L3) * hy0.a;
    return normalize(vec3(-dx * 4.0, dy * 4.0, 1.0));
  }
  float r2 = dot(vQuad, vQuad); return normalize(vec3(vQuad, sqrt(max(0.0, 1.0 - min(r2, 1.0))) + 0.15));
}
void main() {
  int b = vLayer * ${NV};
  vec4 l0 = uL[b], l1 = uL[b + 1], l2 = uL[b + 2], l3 = uL[b + 3], l4 = uL[b + 4], l5 = uL[b + 5], l6 = uL[b + 6], l7 = uL[b + 7];
  vec4 l8 = uL[b + 8], l9 = uL[b + 9], l10 = uL[b + 10], l11 = uL[b + 11], l12 = uL[b + 12];
  gMG = uL[b + 14];
  if (vKind > 0.5) {
    float r = length(vQuad);
    float g = exp(-r * r * 4.0) * (1.0 - smoothstep(0.7, 1.0, r));
    outColor = vec4(vColor.rgb * g * vColor.a, 0.0);
    if (uPass == 1) outColor = vec4(1.0);
    return;
  }
  // UV transform: flip, rotate, tile, offset, scroll.
  vec2 uv = vUv - 0.5;
  if (l5.y > 0.5) uv.x = -uv.x;
  if (l5.z > 0.5) uv.y = -uv.y;
  float ur = l5.x; uv = vec2(uv.x * cos(ur) - uv.y * sin(ur), uv.x * sin(ur) + uv.y * cos(ur));
  uv = uv * l4.xy + 0.5 + l4.zw + l10.xy * uTime;
  if (l4.x != 1.0 || l4.y != 1.0 || l10.x != 0.0 || l10.y != 0.0 || l4.z != 0.0 || l4.w != 0.0) uv = fract(uv);
  float ps = l1.z;
  if (ps > 0.0) uv = (floor(uv * ps) + 0.5) / ps;
  int sColor = int(l6.x), sNormal = int(l6.y), sAlpha = int(l6.z), sGrad = int(l6.w), sEm = int(l7.w), sMotion = int(l12.w), sHeight = int(l12.x);
  float cols = l0.y, rows = l0.z, frames = l0.w, packed = l1.x;
  vec4 c;
  float total = frames * (packed > 0.5 ? 3.0 : 1.0);
  if (total > 1.0) {
    // A custom frame order sends the next sheet frame as a negative kind.
    float f0 = floor(vFrame), fr = vFrame - f0, f1 = vKind < -0.5 ? -vKind - 1.0 : mod(f0 + 1.0, total);
    if (sMotion >= 0 && fr > 0.0) {
      vec2 m0 = (tex(sMotion, cellUv(f0, uv, cols, rows, frames)).rg * 2.0 - 1.0) * l12.z;
      vec2 m1 = (tex(sMotion, cellUv(f1, uv, cols, rows, frames)).rg * 2.0 - 1.0) * l12.z;
      vec4 a0 = frameSample(sColor, f0, uv - m0 * fr, cols, rows, frames, packed);
      vec4 a1 = frameSample(sColor, f1, uv + m1 * (1.0 - fr), cols, rows, frames, packed);
      c = mix(a0, a1, fr);
    } else {
      c = frameSample(sColor, f0, uv, cols, rows, frames, packed);
      if (l1.y > 0.5 && fr > 0.0) c = mix(c, frameSample(sColor, f1, uv, cols, rows, frames, packed), fr);
    }
  } else c = sColor >= 0 ? tex(sColor, uv) : vec4(1.0);
  // c is premultiplied.
  float a = c.a; vec3 rgb = c.rgb;
  if (sGrad >= 0) {
    float lum = packed > 0.5 ? a : (a > 0.001 ? dot(rgb / a, vec3(0.299, 0.587, 0.114)) : 0.0);
    vec4 gm = tex(sGrad, vec2(clamp(lum, 0.002, 0.998), 0.5));
    float na = (packed > 0.5 ? lum : a) * gm.a;
    rgb = gm.rgb * na; a = na;
  }
  if (sAlpha >= 0) { float m = tex(sAlpha, uv).r; rgb *= m; a *= m; }
  // Cut-out (pixel art, sprites, cartoon).
  float clip = l1.w;
  if (clip > 0.0) {
    if (a < clip) discard;
    float edge = l5.w;
    if (edge > 0.0) {
      float fw = fwidth(a) * edge;
      if (a < clip + max(fw, 0.08)) { outColor = vec4(uL[b + 13].rgb * vColor.a, vColor.a); return; }
    }
    rgb = a > 0.0 ? rgb / a : rgb; a = 1.0;
  }
  // Lighting (volumetric / realistic / material).
  float lit = l2.z;
  if (lit > 0.0) {
    vec3 n = surfaceNormal(sNormal, sHeight, uv);
    // Camera-relative light (x right, y up, z towards the viewer): lit sprites read the same from every angle.
    vec3 l = normalize(l3.xyz + vec3(1e-4));
    float diff = max(dot(n, l), 0.0);
    float rough = clamp(l10.w, 0.04, 1.0), metal = l10.z;
    vec3 hv = normalize(l + vec3(0.0, 0.0, 1.0));
    float spec = pow(max(dot(n, hv), 0.0), 2.0 / (rough * rough) ) * (0.04 + metal) * (1.0 - rough);
    float shade = mix(1.0, 0.32 + 0.95 * diff, lit);
    rgb = rgb * shade + vec3(spec) * a;
    float rim = l3.w;
    if (rim > 0.0) rgb += l9.rgb * pow(1.0 - clamp(n.z, 0.0, 1.0), 3.0) * rim * a;
  }
  // Toon banding for cartoon style.
  if (l5.w > 0.0) { float lum = dot(rgb, vec3(0.333)); float q = floor(lum * 3.0 + 0.5) / 3.0; rgb *= lum > 0.001 ? q / lum : 1.0; }
  rgb *= vColor.rgb;
  if (sEm >= 0) rgb += tex(sEm, uv).rgb * l11.rgb * l7.z;
  else if (l7.z > 0.0) rgb += l11.rgb * l7.z * a * 0.25;
  rgb *= l2.x;
  rgb *= vColor.a; a *= vColor.a;
  // Dissolve with a glowing edge.
  if (vDis > 0.0) {
    float nz = fbm(vUv * 6.0 + vRand * 17.0);
    if (nz < vDis) discard;
    float e = smoothstep(vDis, vDis + l7.y + 1e-4, nz);
    rgb = mix(l8.rgb * a * 2.5, rgb, e);
  }
  // Soft particles: fade into the ground plane and near the camera.
  float soft = l2.y;
  if (soft > 0.0) { float k = clamp((vWorldY - uGround) / soft, 0.0, 1.0) * clamp((vDepth - 0.3) / (soft * 2.0), 0.0, 1.0); rgb *= k; a *= k; }
  if (a < 0.002 && dot(rgb, rgb) < 1e-6) discard;
  float additive = l8.w;
  if (uPass == 1) { // multiply: mix towards the colour by coverage
    vec3 col = a > 0.0 ? rgb / a : vec3(1.0);
    outColor = vec4(mix(vec3(1.0), col, a), 1.0); return;
  }
  if (uPass == 2) { outColor = vec4(rgb, 0.0); return; } // screen
  if (uPass == 3) { // distortion: bend the scene behind
    // Refraction bends by the surface normal; plain distortion pushes outward from the centre.
    vec2 dir = l12.y > 0.5 ? surfaceNormal(sNormal, sHeight, uv).xy : (length(vQuad) > 1e-4 ? normalize(vQuad) : vec2(0.0));
    float strength = l11.w;
    // Refraction follows the lens shape (texture coverage); plain distortion also fades with the particle.
    float fade = l12.y > 0.5 ? 1.0 : vColor.a;
    vec2 suv = gl_FragCoord.xy / uRes + dir * vec2(1.0, -1.0) * c.a * strength * fade;
    vec4 sc = texture(uScene, suv);
    float cov = clamp(c.a * fade * 4.0, 0.0, 1.0);
    outColor = sc * cov; return;
  }
  outColor = vec4(rgb, additive > 0.5 ? 0.0 : a);
}`;

const MESH_VS = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPos; layout(location=1) in vec3 aNrm;
layout(location=2) in vec3 iPos; layout(location=3) in float iSize; layout(location=4) in vec4 iRot; layout(location=5) in vec4 iColor;
uniform mat3 uRot; uniform vec3 uTarget; uniform float uPersp, uDist, uF, uPpu; uniform vec2 uRes, uAnchor, uViewC;
out vec3 vN; out vec4 vColor;
vec3 qrot(vec4 q, vec3 v) { return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v); }
void main() {
  vec3 w = iPos + qrot(iRot, aPos * iSize);
  vN = uRot * qrot(iRot, aNrm); vColor = iColor;
  vec3 v = uPersp > 0.5 ? uRot * (w - uTarget) : uRot * w;
  if (uPersp > 0.5) {
    float d = max(uDist + v.z, 0.001); vec2 s = uAnchor + vec2(v.x, -v.y) * uF / d;
    gl_Position = vec4((s.x / uRes.x * 2.0 - 1.0) * d, (1.0 - s.y / uRes.y * 2.0) * d, (clamp((d - 0.05) / 500.0, 0.0, 1.0) * 2.0 - 1.0) * d, d);
  } else {
    vec2 s = uAnchor + vec2(v.x - uViewC.x, -(v.y - uViewC.y)) * uPpu;
    gl_Position = vec4(s.x / uRes.x * 2.0 - 1.0, 1.0 - s.y / uRes.y * 2.0, clamp(v.z / 1000.0 + 0.5, 0.0, 1.0) * 2.0 - 1.0, 1.0);
  }
}`;
const MESH_FS = `#version 300 es
precision highp float;
in vec3 vN; in vec4 vColor; uniform vec3 uLight; out vec4 o;
void main() { vec3 n = normalize(vN); vec3 l = normalize(uLight); float d = max(dot(n, vec3(l.x, l.y, l.z)), 0.0);
  vec3 c = vColor.rgb * (0.35 + 0.75 * d); o = vec4(c * vColor.a, vColor.a); }`;

const STRIP_VS = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPos; layout(location=1) in vec2 aUv; layout(location=2) in vec4 aColor;
uniform mat3 uRot; uniform vec3 uTarget; uniform float uPersp, uDist, uF, uPpu; uniform vec2 uRes, uAnchor, uViewC;
out vec2 vUv; out vec4 vColor;
void main() {
  vUv = aUv; vColor = aColor;
  vec3 v = uPersp > 0.5 ? uRot * (aPos - uTarget) : uRot * aPos;
  if (uPersp > 0.5) {
    float d = max(uDist + v.z, 0.001); vec2 s = uAnchor + vec2(v.x, -v.y) * uF / d;
    gl_Position = vec4((s.x / uRes.x * 2.0 - 1.0) * d, (1.0 - s.y / uRes.y * 2.0) * d, (clamp((d - 0.05) / 500.0, 0.0, 1.0) * 2.0 - 1.0) * d, d);
  } else {
    vec2 s = uAnchor + vec2(v.x - uViewC.x, -(v.y - uViewC.y)) * uPpu;
    gl_Position = vec4(s.x / uRes.x * 2.0 - 1.0, 1.0 - s.y / uRes.y * 2.0, clamp(v.z / 1000.0 + 0.5, 0.0, 1.0) * 2.0 - 1.0, 1.0);
  }
}`;
const STRIP_FS = `#version 300 es
precision highp float;
in vec2 vUv; in vec4 vColor; uniform sampler2D uTex; uniform float uAdd; out vec4 o;
void main() { vec4 t = texture(uTex, vUv); vec3 rgb = t.rgb * vColor.rgb * vColor.a; float a = t.a * vColor.a; o = vec4(rgb, uAdd > 0.5 ? 0.0 : a); }`;

const POST_VS = `#version 300 es
layout(location=0) in vec2 aCorner; out vec2 vUv; void main() { vUv = aCorner * 0.5 + 0.5; gl_Position = vec4(aCorner, 0.0, 1.0); }`;
const COPY_FS = `#version 300 es
precision highp float; in vec2 vUv; uniform sampler2D uTex; uniform sampler2D uBloom; uniform float uBloomK; uniform int uFlipY; out vec4 o;
void main() { vec2 uv = uFlipY == 1 ? vec2(vUv.x, 1.0 - vUv.y) : vUv; vec4 c = texture(uTex, uv); vec3 b = uBloomK > 0.0 ? texture(uBloom, vUv).rgb * uBloomK : vec3(0.0);
  vec3 rgb = c.rgb + b; float a = clamp(max(c.a, max(b.r, max(b.g, b.b))), 0.0, 1.0); o = vec4(min(rgb, vec3(a + 0.0001) * 64.0), a); o.rgb = min(o.rgb, vec3(1.0)); }`;
const BRIGHT_FS = `#version 300 es
precision highp float; in vec2 vUv; uniform sampler2D uTex; uniform float uThr; out vec4 o;
void main() { vec3 c = texture(uTex, vUv).rgb; float l = max(c.r, max(c.g, c.b)); o = vec4(c * smoothstep(uThr, uThr + 0.4, l), 1.0); }`;
const BLUR_FS = `#version 300 es
precision highp float; in vec2 vUv; uniform sampler2D uTex; uniform vec2 uDir; out vec4 o;
void main() { vec3 s = texture(uTex, vUv).rgb * 0.227;
  s += (texture(uTex, vUv + uDir * 1.385).rgb + texture(uTex, vUv - uDir * 1.385).rgb) * 0.316;
  s += (texture(uTex, vUv + uDir * 3.231).rgb + texture(uTex, vUv - uDir * 3.231).rgb) * 0.070; o = vec4(s, 1.0); }`;

function compile(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const mk = (type: number, src: string) => { const s = gl.createShader(type)!; gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('Shader: ' + gl.getShaderInfoLog(s)); return s; };
  const p = gl.createProgram()!;
  gl.attachShader(p, mk(gl.VERTEX_SHADER, vs)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('Program: ' + gl.getProgramInfoLog(p));
  return p;
}

// ------------------------------------------------------------------ low-poly meshes (flat-shaded triangles with face normals)
function meshTris(kind: string): Float32Array {
  const P: number[][] = []; const F: number[][] = [];
  const add = (pts: number[][], faces: number[][]) => { P.push(...pts); F.push(...faces); };
  if (kind === 'cube') add([[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]].map((p) => p.map((x) => x * 0.5)), [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [2, 3, 7], [2, 7, 6], [1, 2, 6], [1, 6, 5], [0, 4, 7], [0, 7, 3]]);
  else if (kind === 'tetra') add([[1, 1, 1], [-1, -1, 1], [-1, 1, -1], [1, -1, -1]].map((p) => p.map((x) => x * 0.4)), [[0, 1, 2], [0, 3, 1], [0, 2, 3], [1, 3, 2]]);
  else if (kind === 'octa' || kind === 'shard') {
    const s = kind === 'shard' ? [0.35, 0.6, 0.18] : [0.5, 0.5, 0.5];
    add([[s[0], 0, 0], [-s[0] * 0.7, 0, 0], [0, s[1], 0], [0, -s[1] * 0.6, 0], [0, 0, s[2]], [0, 0, -s[2]]], [[0, 2, 4], [2, 1, 4], [1, 3, 4], [3, 0, 4], [2, 0, 5], [1, 2, 5], [3, 1, 5], [0, 3, 5]]);
  } else if (kind === 'plane') add([[-0.5, 0, -0.5], [0.5, 0, -0.5], [0.5, 0, 0.5], [-0.5, 0, 0.5]], [[0, 2, 1], [0, 3, 2], [0, 1, 2], [0, 2, 3]]);
  else { // ico
    const t = (1 + Math.sqrt(5)) / 2, k = 0.5 / Math.hypot(1, t);
    add([[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]].map((p) => p.map((x) => x * k)),
      [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]]);
  }
  const out: number[] = [];
  for (const [a, b, c] of F) {
    const A = P[a], B = P[b], C = P[c];
    const ux = B[0] - A[0], uy = B[1] - A[1], uz = B[2] - A[2], vx = C[0] - A[0], vy = C[1] - A[1], vz = C[2] - A[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    // Make normals point away from the centre.
    const cx = (A[0] + B[0] + C[0]) / 3, cy = (A[1] + B[1] + C[1]) / 3, cz = (A[2] + B[2] + C[2]) / 3;
    const flip = nx * cx + ny * cy + nz * cz < 0 ? -1 : 1;
    for (const p of [A, B, C]) out.push(p[0], p[1], p[2], nx * flip, ny * flip, nz * flip);
  }
  return new Float32Array(out);
}

/** View rotation (row-major), the same maths as the 2D preview's projector. */
export function viewRotation(yaw: number, pitch: number): number[] {
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  return [cy, 0, -sy, -sp * sy, cp, -sp * cy, cp * sy, sp, cp * cy];
}

interface TexEntry { tex: WebGLTexture; w: number; h: number; ready: boolean }

export class ParticleRenderer {
  gl: WebGL2RenderingContext;
  private quadProg: WebGLProgram; private meshProg: WebGLProgram; private stripProg: WebGLProgram;
  private copyProg: WebGLProgram; private brightProg: WebGLProgram; private blurProg: WebGLProgram;
  private quadVao: WebGLVertexArrayObject; private instBuf: WebGLBuffer; private cornerBuf: WebGLBuffer;
  private postVao: WebGLVertexArrayObject;
  private meshVaos = new Map<string, { vao: WebGLVertexArrayObject; inst: WebGLBuffer; n: number }>();
  private stripVao: WebGLVertexArrayObject; private stripBuf: WebGLBuffer;
  private textures = new Map<string, TexEntry>();
  private white: WebGLTexture;
  private fbo?: { w: number; h: number; scene: WebGLFramebuffer; color: WebGLTexture; depth: WebGLRenderbuffer; copyFb: WebGLFramebuffer; copy: WebGLTexture; half: [WebGLFramebuffer, WebGLTexture][] };
  private hdr: boolean;
  private inst = new Float32Array(18 * 1024);
  private u: Record<string, Record<string, WebGLUniformLocation | null>> = {};
  /** Set when a picture finished loading (the preview redraws). */
  onTextureLoad?: () => void;
  stats = { drawCalls: 0, particles: 0 };

  static create(canvas: HTMLCanvasElement | OffscreenCanvas): ParticleRenderer | null {
    try { const gl = canvas.getContext('webgl2', { premultipliedAlpha: true, alpha: true, antialias: true, preserveDrawingBuffer: true }) as WebGL2RenderingContext | null; return gl ? new ParticleRenderer(gl) : null; }
    catch (e) { console.warn('WebGL2 renderer unavailable', e); return null; }
  }

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.hdr = !!gl.getExtension('EXT_color_buffer_float');
    this.quadProg = compile(gl, QUAD_VS, QUAD_FS);
    this.meshProg = compile(gl, MESH_VS, MESH_FS);
    this.stripProg = compile(gl, STRIP_VS, STRIP_FS);
    this.copyProg = compile(gl, POST_VS, COPY_FS);
    this.brightProg = compile(gl, POST_VS, BRIGHT_FS);
    this.blurProg = compile(gl, POST_VS, BLUR_FS);
    // Quad: 4 corners as a triangle strip + instance attributes.
    this.quadVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.quadVao);
    this.cornerBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.cornerBuf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.instBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instBuf);
    const S = 18 * 4;
    const attr = (loc: number, size: number, off: number) => { gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, size, gl.FLOAT, false, S, off * 4); gl.vertexAttribDivisor(loc, 1); };
    attr(1, 3, 0); attr(2, 2, 3); attr(3, 1, 5); attr(4, 4, 6); attr(5, 4, 10); attr(6, 4, 14);
    gl.bindVertexArray(null);
    this.postVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.postVao);
    const pb = gl.createBuffer()!; gl.bindBuffer(gl.ARRAY_BUFFER, pb); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    this.stripVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.stripVao);
    this.stripBuf = gl.createBuffer()!; gl.bindBuffer(gl.ARRAY_BUFFER, this.stripBuf);
    const SS = 9 * 4;
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, SS, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, SS, 12);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.FLOAT, false, SS, 20);
    gl.bindVertexArray(null);
    this.white = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.white); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));
  }

  private loc(p: WebGLProgram, key: string, name: string) {
    const m = (this.u[key] ??= {});
    if (!(name in m)) m[name] = this.gl.getUniformLocation(p, name);
    return m[name];
  }

  /** A GL texture for a picture URL or built-in kind (premultiplied; nearest or linear filtering). */
  private texture(src: string, nearest: boolean, premult = true): TexEntry {
    const key = src + (nearest ? '|n' : '|l') + (premult ? '' : '|raw');
    let e = this.textures.get(key);
    if (e?.ready) return e;
    const gl = this.gl;
    let el: HTMLCanvasElement | HTMLImageElement | null;
    if (src.startsWith('builtin:')) el = builtinTexture(src.slice(8));
    else if (src.startsWith('canvas:')) el = null;
    else el = pictureOf(src, () => this.onTextureLoad?.());
    if (!e) { e = { tex: gl.createTexture()!, w: 1, h: 1, ready: false }; this.textures.set(key, e); }
    if (el) {
      gl.bindTexture(gl.TEXTURE_2D, e.tex);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, premult);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, el);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      const f = nearest ? gl.NEAREST : gl.LINEAR;
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      e.w = (el as any).naturalWidth || el.width; e.h = (el as any).naturalHeight || el.height; e.ready = true;
      if (this.textures.size > 160) { const [k, old] = this.textures.entries().next().value!; gl.deleteTexture(old.tex); this.textures.delete(k); }
    }
    return e;
  }
  /** Upload a canvas every call (background layer, gradient strips). */
  private canvasTex(key: string, c: HTMLCanvasElement, nearest = false): WebGLTexture {
    const gl = this.gl;
    let e = this.textures.get(key);
    if (!e) { e = { tex: gl.createTexture()!, w: c.width, h: c.height, ready: true }; this.textures.set(key, e); }
    gl.bindTexture(gl.TEXTURE_2D, e.tex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    const f = nearest ? gl.NEAREST : gl.LINEAR;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return e.tex;
  }

  private ensureTargets(w: number, h: number) {
    const gl = this.gl;
    if (this.fbo && this.fbo.w === w && this.fbo.h === h) return;
    if (this.fbo) { gl.deleteFramebuffer(this.fbo.scene); gl.deleteTexture(this.fbo.color); gl.deleteRenderbuffer(this.fbo.depth); gl.deleteFramebuffer(this.fbo.copyFb); gl.deleteTexture(this.fbo.copy); for (const [f, t] of this.fbo.half) { gl.deleteFramebuffer(f); gl.deleteTexture(t); } }
    const mkTex = (tw: number, th: number) => {
      const t = gl.createTexture()!; gl.bindTexture(gl.TEXTURE_2D, t);
      if (this.hdr) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, tw, th, 0, gl.RGBA, gl.HALF_FLOAT, null);
      else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, tw, th, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return t;
    };
    const mkFb = (t: WebGLTexture) => { const f = gl.createFramebuffer()!; gl.bindFramebuffer(gl.FRAMEBUFFER, f); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0); return f; };
    const color = mkTex(w, h), scene = mkFb(color);
    const depth = gl.createRenderbuffer()!; gl.bindRenderbuffer(gl.RENDERBUFFER, depth); gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
    const copy = mkTex(w, h), copyFb = mkFb(copy);
    const half: [WebGLFramebuffer, WebGLTexture][] = [];
    for (let k = 0; k < 2; k++) { const t = mkTex(Math.max(1, w >> 2), Math.max(1, h >> 2)); half.push([mkFb(t), t]); }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.fbo = { w, h, scene, color, depth, copyFb, copy, half };
  }

  private setCamera(p: WebGLProgram, key: string, cam: GLCamera) {
    const gl = this.gl;
    gl.uniformMatrix3fv(this.loc(p, key, 'uRot'), true, viewRotation(cam.yaw, cam.pitch));
    gl.uniform3fv(this.loc(p, key, 'uTarget'), cam.target);
    gl.uniform1f(this.loc(p, key, 'uPersp'), cam.persp ? 1 : 0);
    gl.uniform1f(this.loc(p, key, 'uDist'), cam.dist);
    gl.uniform1f(this.loc(p, key, 'uF'), cam.f);
    gl.uniform1f(this.loc(p, key, 'uPpu'), cam.ppu);
    gl.uniform2f(this.loc(p, key, 'uRes'), cam.width, cam.height);
    gl.uniform2fv(this.loc(p, key, 'uAnchor'), cam.anchor);
    gl.uniform2fv(this.loc(p, key, 'uViewC'), cam.viewC);
  }

  /** Draws the emitters (one per layer of the effect) into the canvas. */
  render(emitters: Emitter[], cam: GLCamera, o: RenderOpts = {}) {
    const gl = this.gl;
    const W = Math.max(1, Math.round(cam.width)), H = Math.max(1, Math.round(cam.height));
    this.ensureTargets(W, H);
    const F = this.fbo!;
    this.stats.drawCalls = 0; this.stats.particles = 0;
    const R = viewRotation(cam.yaw, cam.pitch);
    const time = o.time ?? 0;
    gl.bindFramebuffer(gl.FRAMEBUFFER, F.scene);
    gl.viewport(0, 0, W, H);
    const cl = o.clear ?? [0, 0, 0, 0];
    gl.clearColor(cl[0], cl[1], cl[2], cl[3]); gl.clearDepth(1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    // Background layer (grid, shapes): drawn flipped, since canvases are uploaded top row first.
    if (o.background) {
      gl.disable(gl.DEPTH_TEST); gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.useProgram(this.copyProg); gl.bindVertexArray(this.postVao);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.canvasTex('__bg', o.background));
      gl.uniform1i(this.loc(this.copyProg, 'copy', 'uTex'), 0); gl.uniform1f(this.loc(this.copyProg, 'copy', 'uBloomK'), 0); gl.uniform1i(this.loc(this.copyProg, 'copy', 'uFlipY'), 1);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.white); gl.uniform1i(this.loc(this.copyProg, 'copy', 'uBloom'), 1);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); this.stats.drawCalls++;
    }
    const live = emitters.filter((e) => e.count > 0);
    for (const e of live) this.stats.particles += e.count;
    // 1. Meshes (depth tested and written).
    this.drawMeshes(live.filter((e) => e.params.renderer === 'mesh'), cam);
    // 2. Ribbons and trails.
    this.drawStrips(live.filter((e) => e.params.renderer === 'ribbon' || e.params.renderer === 'trail'), cam, R);
    // 3. Sorted quads (all normal / additive / premultiplied systems together), then multiply, screen and distortion passes.
    const quadLayers = live.filter((e) => e.params.renderer !== 'mesh' && e.params.renderer !== 'ribbon' && e.params.renderer !== 'trail');
    const mode = (e: Emitter) => (e.params.distortion ? 'distort' : e.params.blendMode === 'multiply' ? 'multiply' : e.params.blendMode === 'screen' ? 'screen' : 'main');
    const groups: Record<string, Emitter[]> = { main: [], multiply: [], screen: [], distort: [] };
    for (const e of quadLayers) { groups[mode(e)].push(e); if (e.params.distortion && !e.params.distortionOnly) groups[e.params.blendMode === 'multiply' ? 'multiply' : e.params.blendMode === 'screen' ? 'screen' : 'main'].push(e); }
    // Unsorted modes respect the draw order.
    const byOrder = (a: Emitter, b: Emitter) => (a.params.sortOrder ?? 0) - (b.params.sortOrder ?? 0);
    this.drawQuads(groups.main, cam, R, 0, o, time, true);
    if (groups.multiply.length) this.drawQuads(groups.multiply.sort(byOrder), cam, R, 1, o, time, false);
    if (groups.screen.length) this.drawQuads(groups.screen.sort(byOrder), cam, R, 2, o, time, false);
    if (groups.distort.length) {
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, F.scene); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, F.copyFb);
      gl.blitFramebuffer(0, 0, W, H, 0, 0, W, H, gl.COLOR_BUFFER_BIT, gl.NEAREST);
      gl.bindFramebuffer(gl.FRAMEBUFFER, F.scene);
      this.drawQuads(groups.distort, cam, R, 3, o, time, false);
    }
    // 4. Bloom and output.
    const bloom = o.bloom ?? 0;
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
    gl.bindVertexArray(this.postVao);
    if (bloom > 0) {
      const hw = Math.max(1, W >> 2), hh = Math.max(1, H >> 2);
      gl.viewport(0, 0, hw, hh);
      gl.bindFramebuffer(gl.FRAMEBUFFER, F.half[0][0]);
      gl.useProgram(this.brightProg); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, F.color);
      gl.uniform1i(this.loc(this.brightProg, 'bright', 'uTex'), 0); gl.uniform1f(this.loc(this.brightProg, 'bright', 'uThr'), this.hdr ? 0.85 : 0.7);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.useProgram(this.blurProg); gl.uniform1i(this.loc(this.blurProg, 'blur', 'uTex'), 0);
      for (let k = 0; k < 3; k++) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, F.half[1][0]); gl.bindTexture(gl.TEXTURE_2D, F.half[0][1]); gl.uniform2f(this.loc(this.blurProg, 'blur', 'uDir'), (1 + k) / hw, 0); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        gl.bindFramebuffer(gl.FRAMEBUFFER, F.half[0][0]); gl.bindTexture(gl.TEXTURE_2D, F.half[1][1]); gl.uniform2f(this.loc(this.blurProg, 'blur', 'uDir'), 0, (1 + k) / hh); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      }
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.copyProg);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, F.color); gl.uniform1i(this.loc(this.copyProg, 'copy', 'uTex'), 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, bloom > 0 ? F.half[0][1] : this.white); gl.uniform1i(this.loc(this.copyProg, 'copy', 'uBloom'), 1);
    gl.uniform1f(this.loc(this.copyProg, 'copy', 'uBloomK'), bloom); gl.uniform1i(this.loc(this.copyProg, 'copy', 'uFlipY'), 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
  }

  /** Picture source of a layer: its own image, or a built-in kind. */
  private colorSrc(p: EmitterParams) { return p.textureImage ? p.textureImage : 'builtin:' + (p.texture || 'circle'); }

  private drawQuads(layers: Emitter[], cam: GLCamera, R: number[], pass: number, o: RenderOpts, time: number, sorted: boolean) {
    if (!layers.length) return;
    const gl = this.gl;
    const prog = this.quadProg;
    gl.useProgram(prog);
    this.setCamera(prog, 'quad', cam);
    gl.uniform1f(this.loc(prog, 'quad', 'uTime'), time);
    gl.uniform1f(this.loc(prog, 'quad', 'uGround'), o.ground ?? 0);
    gl.uniform1i(this.loc(prog, 'quad', 'uPass'), pass);
    gl.enable(gl.DEPTH_TEST); gl.depthMask(false); gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.BLEND);
    if (pass === 1) gl.blendFunc(gl.DST_COLOR, gl.ZERO);
    else if (pass === 2) gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_COLOR);
    else gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    if (pass === 3) { gl.activeTexture(gl.TEXTURE0 + SLOTS); gl.bindTexture(gl.TEXTURE_2D, this.fbo!.copy); gl.uniform1i(this.loc(prog, 'quad', 'uScene'), SLOTS); }
    // Batches of layers whose textures fit in the units.
    let i = 0;
    while (i < layers.length) {
      const batch: Emitter[] = [];
      const slots: WebGLTexture[] = [];
      const ldata = new Float32Array(MAXL * NV * 4);
      while (i < layers.length && batch.length < MAXL) {
        const e = layers[i], p = e.params, m = p.material;
        const need = 1 + (m?.normalMap ? 1 : 0) + (m?.alphaMap ? 1 : 0) + (m?.gradientMap ? 1 : 0) + (m?.emissionMap ? 1 : 0) + (m?.motionVectors ? 1 : 0) + (m?.heightMap && !m.normalMap ? 1 : 0);
        if (slots.length + need > SLOTS && batch.length) break;
        const nearest = p.filter === 'nearest' || p.style === 'pixel';
        const slot = (t: WebGLTexture) => { slots.push(t); return slots.length - 1; };
        const sColor = slot(this.texture(this.colorSrc(p), nearest).tex);
        const sNormal = m?.normalMap ? slot(this.texture(m.normalMap, false, false).tex) : -1;
        const sAlpha = m?.alphaMap ? slot(this.texture(m.alphaMap, nearest, false).tex) : -1;
        const sGrad = m?.gradientMap ? slot(this.canvasTex('grad:' + JSON.stringify(m.gradientMap), gradientStrip(m.gradientMap))) : -1;
        const sEm = m?.emissionMap ? slot(this.texture(m.emissionMap, nearest).tex) : -1;
        const sMot = m?.motionVectors ? slot(this.texture(m.motionVectors, false, false).tex) : -1;
        const sHei = m?.heightMap && !m.normalMap ? slot(this.texture(m.heightMap, false, false).tex) : -1;
        const L = batch.length * NV * 4, d = ldata;
        const fb = p.flipbook;
        d.set([RT[p.renderer ?? 'billboard'] ?? 0, fb?.cols ?? 1, fb?.rows ?? 1, fb ? Math.max(1, fb.frames) : 1], L);
        const pix = p.style === 'pixel' ? p.pixelSize ?? 12 : 0;
        const clip = p.alphaClip ?? (p.style === 'pixel' || p.style === 'cartoon' || p.style === 'sprite' ? 0.5 : 0);
        d.set([fb?.channelPacked ? 1 : 0, fb?.blend ? 1 : 0, pix, clip], L + 4);
        const lit = p.renderer === 'volumetric' ? p.lit ?? 0.8 : p.lit ?? 0;
        d.set([p.emission ?? 1, p.softness ?? 0, lit, p.stretch ?? 0.08], L + 8);
        const ld = p.lightDir ?? [0.4, 0.8, 0.3];
        d.set([ld[0], ld[1], ld[2], m?.rim ?? (p.renderer === 'volumetric' ? 0.35 : 0)], L + 12);
        const uv = p.uv;
        d.set([uv?.scale[0] ?? 1, uv?.scale[1] ?? 1, uv?.offset[0] ?? 0, uv?.offset[1] ?? 0], L + 16);
        d.set([((uv?.rotation ?? 0) * Math.PI) / 180, uv?.flipX ? 1 : 0, uv?.flipY ? 1 : 0, p.style === 'cartoon' ? p.outline ?? 1.5 : 0], L + 20);
        d.set([sColor, sNormal, sAlpha, sGrad], L + 24);
        d.set([m?.dissolve ?? 0, m?.dissolveEdge ?? 0.08, m?.emissionStrength ?? 0, sEm], L + 28);
        const dc = hexToRgb(m?.dissolveColor ?? '#ffb040');
        const additive = p.blendMode ? p.blendMode === 'additive' || p.blendMode === 'screen' : p.blending === 'additive';
        d.set([dc[0], dc[1], dc[2], additive ? 1 : 0], L + 32);
        const rc = hexToRgb(m?.rimColor ?? '#ffffff');
        d.set([rc[0], rc[1], rc[2], 0], L + 36);
        d.set([uv?.scroll?.[0] ?? 0, uv?.scroll?.[1] ?? 0, m?.metallic ?? 0, m?.roughness ?? 0.6], L + 40);
        const ec = hexToRgb(m?.emissionColor ?? '#ffffff');
        d.set([ec[0], ec[1], ec[2], p.distortion ?? 0], L + 44);
        d.set([sHei, m?.refraction ? 1 : 0, m?.motionStrength ?? 0.02, sMot], L + 48);
        const oc = hexToRgb(p.outlineColor ?? '#1a0f0a');
        d.set([oc[0], oc[1], oc[2], 0], L + 52);
        d.set([fb?.margin?.[0] ?? 0, fb?.margin?.[1] ?? 0, fb?.gap?.[0] ?? 0, fb?.gap?.[1] ?? 0], L + 56);
        batch.push(e); i++;
      }
      gl.uniform4fv(this.loc(prog, 'quad', 'uL'), ldata);
      for (let s = 0; s < SLOTS; s++) {
        gl.activeTexture(gl.TEXTURE0 + s); gl.bindTexture(gl.TEXTURE_2D, slots[s] ?? this.white);
        gl.uniform1i(this.loc(prog, 'quad', 'uT' + s), s);
      }
      gl.uniformMatrix3fv(this.loc(prog, 'quad', 'uRot'), true, R);
      this.fillInstances(batch, R, cam, sorted);
    }
    gl.depthMask(true);
  }

  /** Builds instance data for a batch (sorted back to front across all its layers) and draws it.
   *  Layout (18 floats): pos 3, size 2, rot 1, colour 4, frame, layer, rand, dissolve, velocity 3, kind (1 = glow halo). */
  private fillInstances(batch: Emitter[], R: number[], cam: GLCamera, sorted: boolean) {
    const gl = this.gl;
    const ST = 18;
    let n = 0;
    for (const e of batch) n += e.count * (e.params.glow ? 2 : 1);
    if (!n) return;
    const tmp = new Float32Array(n * ST);
    const keys = new Float64Array(n);
    let k = 0;
    const tx = cam.target[0], ty = cam.target[1], tz = cam.target[2];
    batch.forEach((e, li) => {
      const p = e.params;
      const dis = p.material?.dissolve ?? 0, dc = p.material?.dissolveCurve;
      const glowC = p.glowColor ? hexToRgb(p.glowColor) : null;
      const order = (p.sortOrder ?? 0) * 1e-3;
      const base = p.material?.baseColor ? hexToRgb(p.material.baseColor) : null, opa = p.material?.opacity ?? 1;
      for (let i = 0; i < e.count; i++) {
        const fr = p.flipbook ? e.frameAt(i) : 0;
        const a = Math.max(0, Math.min(1, e.alphaAt(i)));
        if (a <= 0.002 || fr < 0) continue;
        const c = e.colorAt(i), s = e.sizeAt(i);
        const t = e.t(i);
        const st = p.stretchCurve ? Math.max(0.01, evalCurve(p.stretchCurve, t, 1)) : 1;
        const w = s / Math.sqrt(st), h = s * Math.sqrt(st);
        const x = e.px[i], y = e.py[i], z = e.pz[i];
        const depth = cam.persp ? R[6] * (x - tx) + R[7] * (y - ty) + R[8] * (z - tz) : R[6] * x + R[7] * y + R[8] * z;
        const o = k * ST;
        tmp[o] = x; tmp[o + 1] = y; tmp[o + 2] = z; tmp[o + 3] = w; tmp[o + 4] = h; tmp[o + 5] = (e.rotAt(i) * Math.PI) / 180;
        tmp[o + 6] = c[0] * (base ? base[0] : 1); tmp[o + 7] = c[1] * (base ? base[1] : 1); tmp[o + 8] = c[2] * (base ? base[2] : 1); tmp[o + 9] = a * opa;
        tmp[o + 10] = fr; tmp[o + 11] = li; tmp[o + 12] = e.rnd[i]; tmp[o + 13] = dis > 0 ? dis * (dc ? Math.max(0, evalCurve(dc, t, 1)) : 1) : 0;
        tmp[o + 14] = e.vx[i]; tmp[o + 15] = e.vy[i]; tmp[o + 16] = e.vz[i]; tmp[o + 17] = 0;
        const ord = p.flipbook?.order;
        if (ord?.length) { const f0 = Math.floor(fr) % ord.length; tmp[o + 10] = ord[f0] + (fr - Math.floor(fr)); tmp[o + 17] = -(ord[(f0 + 1) % ord.length] + 1); }
        keys[k] = sorted ? -depth - order : li * 1e7 + k;
        k++;
        const g = p.glow ? e.glowAt(i) : 0;
        if (g > 0) {
          const q = k * ST;
          tmp.copyWithin(q, o, o + ST);
          const gs = p.glowSize ?? 2.5;
          tmp[q + 3] = w * gs; tmp[q + 4] = h * gs; tmp[q + 9] = Math.min(1, a * g);
          if (glowC) { tmp[q + 6] = glowC[0]; tmp[q + 7] = glowC[1]; tmp[q + 8] = glowC[2]; }
          tmp[q + 17] = 1; // glow halo
          // The halo sits just behind its particle.
          keys[k] = sorted ? keys[k - 1] - 1e-5 : li * 1e7 + k;
          k++;
        }
      }
    });
    if (!k) return;
    const idx = new Uint32Array(k); for (let q = 0; q < k; q++) idx[q] = q;
    const kk = keys;
    idx.sort((a, b) => kk[a] - kk[b]);
    if (this.inst.length < k * ST) this.inst = new Float32Array(Math.ceil(k * 1.5) * ST);
    const out = this.inst;
    for (let q = 0; q < k; q++) out.set(tmp.subarray(idx[q] * ST, idx[q] * ST + ST), q * ST);
    gl.bindVertexArray(this.quadVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instBuf);
    gl.bufferData(gl.ARRAY_BUFFER, out.subarray(0, k * ST), gl.STREAM_DRAW);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, k);
    this.stats.drawCalls++;
    gl.bindVertexArray(null);
  }

  private drawMeshes(layers: Emitter[], cam: GLCamera) {
    if (!layers.length) return;
    const gl = this.gl, prog = this.meshProg;
    gl.useProgram(prog); this.setCamera(prog, 'mesh', cam);
    gl.enable(gl.DEPTH_TEST); gl.depthMask(true); gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    for (const e of layers) {
      const p = e.params, kind = p.meshShape ?? 'shard';
      let m = this.meshVaos.get(kind);
      if (!m) {
        const vao = gl.createVertexArray()!; gl.bindVertexArray(vao);
        const tris = meshTris(kind);
        const vb = gl.createBuffer()!; gl.bindBuffer(gl.ARRAY_BUFFER, vb); gl.bufferData(gl.ARRAY_BUFFER, tris, gl.STATIC_DRAW);
        gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
        gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);
        const inst = gl.createBuffer()!; gl.bindBuffer(gl.ARRAY_BUFFER, inst);
        const S = 12 * 4;
        const at = (l: number, s: number, off: number) => { gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, s, gl.FLOAT, false, S, off * 4); gl.vertexAttribDivisor(l, 1); };
        at(2, 3, 0); at(3, 1, 3); at(4, 4, 4); at(5, 4, 8);
        gl.bindVertexArray(null);
        m = { vao, inst, n: tris.length / 6 };
        this.meshVaos.set(kind, m);
      }
      const data = new Float32Array(e.count * 12);
      let k = 0;
      for (let i = 0; i < e.count; i++) {
        const a = Math.max(0, Math.min(1, e.alphaAt(i)));
        if (a <= 0.002) continue;
        const c = e.colorAt(i), s = e.sizeAt(i), bc = p.material?.baseColor ? hexToRgb(p.material.baseColor) : [1, 1, 1], em = p.emission ?? 1;
        // Tumble around a per-particle random axis by the particle's rotation.
        const ang = (e.rotAt(i) * Math.PI) / 180, r1 = e.rnd[i] * Math.PI * 2, r2 = Math.acos(e.rnd2[i] * 2 - 1);
        const ax = Math.sin(r2) * Math.cos(r1), ay = Math.cos(r2), az = Math.sin(r2) * Math.sin(r1), sh = Math.sin(ang / 2);
        const o = k * 12;
        data[o] = e.px[i]; data[o + 1] = e.py[i]; data[o + 2] = e.pz[i]; data[o + 3] = s;
        data[o + 4] = ax * sh; data[o + 5] = ay * sh; data[o + 6] = az * sh; data[o + 7] = Math.cos(ang / 2);
        data[o + 8] = c[0] * bc[0] * em; data[o + 9] = c[1] * bc[1] * em; data[o + 10] = c[2] * bc[2] * em; data[o + 11] = a * (p.material?.opacity ?? 1);
        k++;
      }
      if (!k) continue;
      const ld = p.lightDir ?? [0.4, 0.8, 0.3];
      const R = viewRotation(cam.yaw, cam.pitch);
      gl.uniform3f(this.loc(prog, 'mesh', 'uLight'), R[0] * ld[0] + R[1] * ld[1] + R[2] * ld[2], R[3] * ld[0] + R[4] * ld[1] + R[5] * ld[2], -(R[6] * ld[0] + R[7] * ld[1] + R[8] * ld[2]));
      gl.bindVertexArray(m.vao); gl.bindBuffer(gl.ARRAY_BUFFER, m.inst); gl.bufferData(gl.ARRAY_BUFFER, data.subarray(0, k * 12), gl.STREAM_DRAW);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, m.n, k);
      this.stats.drawCalls++;
    }
    gl.bindVertexArray(null);
  }

  /** Ribbons (particles joined in birth order) and trails (each particle's history), as camera-facing strips. */
  private drawStrips(layers: Emitter[], cam: GLCamera, R: number[]) {
    if (!layers.length) return;
    const gl = this.gl, prog = this.stripProg;
    gl.useProgram(prog); this.setCamera(prog, 'strip', cam);
    gl.enable(gl.DEPTH_TEST); gl.depthMask(false); gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    // Direction towards the camera in world space.
    const camPos = cam.persp ? [cam.target[0] - R[6] * cam.dist, cam.target[1] - R[7] * cam.dist, cam.target[2] - R[8] * cam.dist] : null;
    const viewDir = [-R[6], -R[7], -R[8]];
    for (const e of layers) {
      const p = e.params;
      const verts: number[] = [];
      const pushStrip = (pts: { x: number; y: number; z: number; w: number; c: [number, number, number]; a: number }[]) => {
        if (pts.length < 2) return;
        const first = verts.length;
        for (let k = 0; k < pts.length; k++) {
          const a = pts[Math.max(0, k - 1)], b = pts[Math.min(pts.length - 1, k + 1)], q = pts[k];
          const tx = b.x - a.x, ty = b.y - a.y, tz = b.z - a.z;
          const vx = camPos ? camPos[0] - q.x : viewDir[0], vy = camPos ? camPos[1] - q.y : viewDir[1], vz = camPos ? camPos[2] - q.z : viewDir[2];
          let nx = ty * vz - tz * vy, ny = tz * vx - tx * vz, nz = tx * vy - ty * vx; const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
          const u = k / (pts.length - 1), hw = q.w * 0.5;
          if (k === 0 && first) { /* degenerate join with previous strip */ verts.push(...verts.slice(verts.length - 9)); verts.push(q.x + nx * hw, q.y + ny * hw, q.z + nz * hw, u, 0, q.c[0], q.c[1], q.c[2], q.a); }
          verts.push(q.x + nx * hw, q.y + ny * hw, q.z + nz * hw, u, 0, q.c[0], q.c[1], q.c[2], q.a);
          verts.push(q.x - nx * hw, q.y - ny * hw, q.z - nz * hw, u, 1, q.c[0], q.c[1], q.c[2], q.a);
        }
      };
      const width = p.ribbonWidth ?? 1;
      if (p.renderer === 'ribbon') {
        const order = Array.from({ length: e.count }, (_, i) => i).sort((a, b) => e.sid[a] - e.sid[b]);
        const pts = order.map((i, k) => ({ x: e.px[i], y: e.py[i], z: e.pz[i], w: e.sizeAt(i) * width * (p.ribbonTaper ? Math.sin(Math.PI * (k + 0.5) / order.length) : 1), c: e.colorAt(i), a: Math.max(0, Math.min(1, e.alphaAt(i))) }));
        pushStrip(pts);
      } else if (e.hist && e.histN) {
        const H = e.hist.length / e.px.length / 3;
        for (let i = 0; i < e.count; i++) {
          const nh = e.histN[i]; if (nh < 1) continue;
          const c = e.colorAt(i), a = Math.max(0, Math.min(1, e.alphaAt(i))), s = e.sizeAt(i) * width;
          const pts = [{ x: e.px[i], y: e.py[i], z: e.pz[i], w: s, c, a }];
          for (let j = 0; j < nh; j++) {
            const slot = ((e.histHead - j) % H + H) % H, o = (i * H + slot) * 3;
            const f = 1 - (j + 1) / (nh + 1);
            pts.push({ x: e.hist[o], y: e.hist[o + 1], z: e.hist[o + 2], w: s * (p.ribbonTaper ? f : 1), c, a: a * f });
          }
          pushStrip(pts);
        }
      }
      if (verts.length < 18) continue;
      const nearest = p.filter === 'nearest' || p.style === 'pixel';
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, p.textureImage ? this.texture(p.textureImage, nearest).tex : this.texture('builtin:glow', false).tex);
      gl.uniform1i(this.loc(prog, 'strip', 'uTex'), 0);
      const additive = p.blendMode ? p.blendMode === 'additive' || p.blendMode === 'screen' : p.blending === 'additive';
      gl.uniform1f(this.loc(prog, 'strip', 'uAdd'), additive ? 1 : 0);
      gl.bindVertexArray(this.stripVao); gl.bindBuffer(gl.ARRAY_BUFFER, this.stripBuf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.STREAM_DRAW);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, verts.length / 9);
      this.stats.drawCalls++;
    }
    gl.bindVertexArray(null); gl.depthMask(true);
  }

  dispose() {
    const gl = this.gl;
    for (const t of this.textures.values()) gl.deleteTexture(t.tex);
    this.textures.clear();
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}
