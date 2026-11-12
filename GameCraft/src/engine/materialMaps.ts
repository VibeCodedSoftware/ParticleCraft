// Per-property textures on a standard material (see @shared/src/materialMaps.ts): one texture per slot with its own
// tiling / offset / rotation, animation (sheet frames, scroll, spin) and material-wide random tiling.
import * as THREE from 'three';
import { MAP_SLOTS, materialSlots, slotRepeat, slotTransform, type RandomTiling, type TexSlot } from '@shared/src/materialMaps';
import type { InstanceData } from '@shared/src/runtime/scene';
import { isWaterSurface } from '@shared/src/runtime/water';
import { assetUrl } from '../project/api';
import { loadTexture } from './assets';

/** `sheet`: an animated sprite-sheet slot's frame cell (cols, rows, column, row from the bottom), read by the shader. */
export interface LiveSlot { tex: THREE.Texture; slot: TexSlot; repeat: [number, number]; sheet?: { value: THREE.Vector4 } }

const isSheet = (s: TexSlot) => !!s.animated && s.animated.frames > 1 && (s.animated.cols > 1 || s.animated.rows > 1);

/** Put every slot's texture on the material; returns the animated ones (updated each frame by `animateSlots`). */
export function applyMaterialMaps(m: THREE.MeshStandardMaterial, i: InstanceData, projectId: string): LiveSlot[] {
  const slots = materialSlots(i.material);
  const live: LiveSlot[] = [];
  for (const def of MAP_SLOTS) {
    const s = slots[def.slot];
    if (!s?.asset) continue;
    const url = assetUrl(projectId, s.asset);
    if (!url) continue;
    const t = loadTexture(url).clone();
    t.colorSpace = def.srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.center.set(0.5, 0.5);
    const repeat = slotRepeat(s, i.sx, i.sy, i.sz);
    const l: LiveSlot = { tex: t, slot: s, repeat, sheet: isSheet(s) ? { value: new THREE.Vector4(1, 1, 0, 0) } : undefined };
    setTransform(l, 0);
    (m as any)[def.three] = t;
    if (def.slot === 'opacity') m.transparent = true;
    if (def.slot === 'emission' && m.emissive.getHex() === 0) m.emissive.set(0xffffff);
    live.push(l);
  }
  const rt = i.material?.randomTiling;
  const sheets = MAP_SLOTS.map((d) => [d.three, live.find((l) => l.slot === slots[d.slot])?.sheet] as const).filter(([, sh]) => sh) as [string, { value: THREE.Vector4 }][];
  // Water's ripple pattern is randomised too, with or without a texture of its own.
  if (rt && (live.length || isWaterSurface(i))) patchRandomTiling(m, rt.perObject ? { ...rt, seed: rt.seed + ((i.uid * 7919) % 1000) * 0.137 } : rt, sheets);
  else if (sheets.length) patchSheets(m, sheets);
  return live.filter((l) => l.slot.animated && (l.slot.animated.frames > 1 || l.slot.animated.scroll[0] || l.slot.animated.scroll[1] || l.slot.animated.spin));
}

function setTransform(l: LiveSlot, time: number) {
  const { tex: t, slot: s, repeat } = l;
  // A sprite sheet tiled more than once: the texture transform tiles whole tiles and the shader keeps each tile inside
  // the current frame (patchSheets); the plain fold-in would run across neighbouring frames instead.
  const x = slotTransform(l.sheet ? { ...s, animated: { ...s.animated!, frames: 1 } } : s, repeat, time);
  t.repeat.set(x.repeat[0], x.repeat[1]); t.offset.set(x.offset[0], x.offset[1]); t.rotation = x.rotation;
  if (l.sheet) {
    const a = s.animated!, cols = Math.max(1, a.cols), rows = Math.max(1, a.rows), f = slotTransform(s, repeat, time).frame;
    l.sheet.value.set(cols, rows, f % cols, rows - 1 - Math.floor(f / cols));
  }
  t.needsUpdate = t.needsUpdate || time === 0;
}

/** Advance animated slots to time t (seconds). */
export function animateSlots(list: LiveSlot[] | undefined, t: number) {
  if (!list) return;
  for (const l of list) setTransform(l, t);
}

/**
 * The texture lookups live in three's shader chunks, which are still `#include`s when onBeforeCompile runs: expand the
 * ones that sample a map so a patch can rewrite them.
 */
export function expandMapChunks(src: string): string {
  return src.replace(/#include <(\w+)>/g, (s, name: string) => {
    const c = (THREE.ShaderChunk as Record<string, string>)[name];
    return c && /texture2D\(\s*(map|roughnessMap|metalnessMap|emissiveMap|alphaMap|normalMap|aoMap|bumpMap)\b/.test(c) ? c : s;
  });
}

/** Sprite-sheet slots: each tile reads only the current frame's cell (gradients from the unbroken UV: no seams). */
function patchSheets(m: THREE.MeshStandardMaterial, sheets: [string, { value: THREE.Vector4 }][]) {
  const prev = m.onBeforeCompile.bind(m), prevKey = m.customProgramCacheKey();
  m.onBeforeCompile = (sh, r) => {
    prev(sh, r);
    // Kept half a texel (at the mip level in use) inside the frame, so filtering never reads the next frame.
    let decl = `vec4 craftSheet(sampler2D s, vec2 uv, vec4 c) {
  vec2 g = c.xy, ts = vec2(textureSize(s, 0)), gx = dFdx(uv) / g, gy = dFdy(uv) / g;
  float lod = max(0.0, log2(max(length(gx * ts), length(gy * ts))));
  vec2 e = min(vec2(0.25), 0.5 * exp2(lod) * g / ts);
  vec2 f = clamp(fract(uv), e, 1.0 - e);
  return textureGrad(s, (f + c.zw) / g, gx, gy);
}
`;
    for (const [three, u] of sheets) {
      sh.uniforms['uSheet_' + three] = u;
      decl = `uniform vec4 uSheet_${three};\n` + decl;
      sh.fragmentShader = expandMapChunks(sh.fragmentShader).replace(new RegExp(`texture2D\\(\\s*${three}\\s*,\\s*(v\\w+Uv)\\s*\\)`, 'g'), (_s, uv: string) => `craftSheet(${three}, ${uv}, uSheet_${three})`);
    }
    sh.fragmentShader = sh.fragmentShader.replace('void main() {', decl + 'void main() {');
  };
  m.customProgramCacheKey = () => 'craft-sheet:' + sheets.map(([t]) => t).join(',') + '|' + prevKey;
}

/**
 * Random tiling: in the fragment shader every tile cell (floor of the UV) gets a seeded quarter-turn and shift. Colour,
 * roughness, metallic, emission and opacity turn; the normal map only shifts (turning it would tilt its normals).
 * Gradients come from the unbroken UV so mipmaps don't seam at cell borders. `sheets`: animated sprite-sheet slots keep
 * reading their current frame (`c`: cols, rows, column, row; 1, 1 = a plain picture).
 */
export function patchRandomTiling(m: THREE.MeshStandardMaterial, rt: RandomTiling, sheets: [string, { value: THREE.Vector4 }][] = []) {
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uCraftSeed = { value: rt.seed };
    shader.uniforms.uCraftAmount = { value: Math.max(0, Math.min(1, rt.amount)) };
    for (const [three, u] of sheets) shader.uniforms['uSheet_' + three] = u;
    const fn = `uniform float uCraftSeed; uniform float uCraftAmount;
${sheets.map(([three]) => `uniform vec4 uSheet_${three};`).join('\n')}
vec4 craftFetch(sampler2D s, vec2 uv, vec2 dx, vec2 dy, vec4 c) {
  if (c.x <= 1.0 && c.y <= 1.0) return textureGrad(s, uv, dx, dy);
  vec2 g = c.xy, ts = vec2(textureSize(s, 0)), gx = dx / g, gy = dy / g;
  float lod = max(0.0, log2(max(length(gx * ts), length(gy * ts))));
  vec2 e = min(vec2(0.25), 0.5 * exp2(lod) * g / ts);
  return textureGrad(s, (clamp(fract(uv), e, 1.0 - e) + c.zw) / g, gx, gy);
}
float craftHash(vec2 c) { return fract(sin(dot(c, vec2(127.1, 311.7)) + uCraftSeed * 74.7) * 43758.5453); }
vec4 craftTex(sampler2D s, vec2 uv, bool turn, vec4 sh) {
  vec2 cell = floor(uv), f = uv - cell; float r = craftHash(cell);
  if (turn) { float q = floor(r * 4.0); f -= 0.5; if (q == 1.0) f = vec2(-f.y, f.x); else if (q == 2.0) f = -f; else if (q == 3.0) f = vec2(f.y, -f.x); f += 0.5; }
  f = fract(f + uCraftAmount * vec2(craftHash(cell + 17.0), craftHash(cell + 31.0)));
  return craftFetch(s, cell + f, dFdx(uv), dFdy(uv), sh);
}
vec4 craftTex(sampler2D s, vec2 uv, bool turn) { return craftTex(s, uv, turn, vec4(1.0, 1.0, 0.0, 0.0)); }
// Seamless mode (hex-tile blending, after Mikkelsen's "Practical Real-Time Hex-Tiling"): a triangle grid over the
// surface; at every point the three nearest grid corners each give a randomly turned and shifted copy of the texture,
// mixed by smooth weights, so repeats vanish without the seams of per-tile turning.
vec2 craftHash2(vec2 p) { return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3))) + uCraftSeed * 74.7) * 43758.5453); }
vec4 craftCopy(sampler2D s, vec2 uv, vec2 dx, vec2 dy, vec2 corner, bool turn, vec4 sh) {
  vec2 h = craftHash2(corner);
  float a = turn ? h.x * 6.2831853 * uCraftAmount : 0.0, c = cos(a), sn = sin(a);
  mat2 r = mat2(c, -sn, sn, c);
  return craftFetch(s, r * uv + h * 7.31 * uCraftAmount, r * dx, r * dy, sh);
}
vec4 craftBlend(sampler2D s, vec2 uv, bool turn, vec4 sh) {
  vec2 dx = dFdx(uv), dy = dFdy(uv);
  vec2 sk = mat2(1.0, 0.0, -0.57735027, 1.15470054) * (uv * 3.4641016);
  vec2 base = floor(sk); vec3 t = vec3(fract(sk), 0.0); t.z = 1.0 - t.x - t.y;
  float sg = step(0.0, -t.z), s2 = 2.0 * sg - 1.0;
  vec3 w = vec3(-t.z * s2, sg - t.y * s2, sg - t.x * s2);
  w = w * w * w; w /= max(1e-5, w.x + w.y + w.z); // sharper blends keep detail crisp
  return craftCopy(s, uv, dx, dy, base + vec2(sg, sg), turn, sh) * w.x + craftCopy(s, uv, dx, dy, base + vec2(sg, 1.0 - sg), turn, sh) * w.y + craftCopy(s, uv, dx, dy, base + vec2(1.0 - sg, sg), turn, sh) * w.z;
}
vec4 craftBlend(sampler2D s, vec2 uv, bool turn) { return craftBlend(s, uv, turn, vec4(1.0, 1.0, 0.0, 0.0)); }
`;
    const sheeted = new Set(sheets.map(([three]) => three));
    const blend = rt.mode === 'blend';
    shader.fragmentShader = expandMapChunks(shader.fragmentShader).replace('void main() {', fn + 'void main() {')
      .replace(/texture2D\(\s*(map|roughnessMap|metalnessMap|emissiveMap|alphaMap|normalMap|aoMap)\s*,\s*(v\w+Uv)\s*\)/g, (_s, map: string, uv: string) => `${blend ? 'craftBlend' : 'craftTex'}(${map}, ${uv}, ${map === 'normalMap' ? 'false' : 'true'}${sheeted.has(map) ? `, uSheet_${map}` : ''})`);
  };
  m.customProgramCacheKey = () => 'craft-random-tiling-' + (rt.mode ?? 'cells') + ':' + sheets.map(([t]) => t).join(',');
  m.needsUpdate = true;
}
