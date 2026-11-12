// Post-processing pipeline. Order: scene render (or low-res pixelated render) -> HDR effects
// (bloom, depth of field, motion blur) -> OutputPass (tone mapping + sRGB) -> display effects in the
// user's stack order. PS1 vertex snapping / affine mapping is applied to materials (ps1Materials).
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { RenderPixelatedPass } from 'three/examples/jsm/postprocessing/RenderPixelatedPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { BokehPass } from 'three/examples/jsm/postprocessing/BokehPass.js';
import { AfterimagePass } from 'three/examples/jsm/postprocessing/AfterimagePass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { SSRPass } from 'three/examples/jsm/postprocessing/SSRPass.js';
import { SSAARenderPass } from 'three/examples/jsm/postprocessing/SSAARenderPass.js';

export type AntiAlias = 'msaa' | 'fxaa' | 'smaa' | 'ssaa' | 'none';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader.js';
import type { Pass } from 'three/examples/jsm/postprocessing/Pass.js';
import { AtmospherePass, type SunInfo } from './atmosphere';
import type { PostFxEffect } from '@shared/src/runtime/scene';
import { fxValue, parseFxCode } from '@shared/src/fxCode';

const HDR = new Set(['bloom', 'dof', 'motionblur', 'glare', 'volumetric']);

/** Light streaks from pixels brighter than the threshold (linear HDR, before tone mapping). */
function glarePass(p: Record<string, any>) {
  const pass = new ShaderPass(shader({ uIntensity: Number(p.intensity ?? 1), uThreshold: Number(p.threshold ?? 1), uLength: Number(p.length ?? 90), uStar: p.shape === 'star' ? 1 : 0, uTint: new THREE.Color(String(p.tint ?? '#ffffff')) }, `
    vec4 base = texture2D(tDiffuse, vUv);
    vec3 acc = vec3(0.0);
    for (int i = 1; i <= 24; i++) {
      float t = float(i) / 24.0; float w = (1.0 - t) * (1.0 - t);
      vec2 h = vec2(t * uLength / uRes.x, 0.0);
      acc += (max(texture2D(tDiffuse, vUv + h).rgb - uThreshold, 0.0) + max(texture2D(tDiffuse, vUv - h).rgb - uThreshold, 0.0)) * w;
      if (uStar > 0.5) {
        vec2 v = vec2(0.0, t * uLength / uRes.y);
        vec2 d = vec2(t * uLength * 0.7 / uRes.x, t * uLength * 0.7 / uRes.y);
        acc += (max(texture2D(tDiffuse, vUv + v).rgb - uThreshold, 0.0) + max(texture2D(tDiffuse, vUv - v).rgb - uThreshold, 0.0)) * w * 0.8;
        acc += (max(texture2D(tDiffuse, vUv + d).rgb - uThreshold, 0.0) + max(texture2D(tDiffuse, vUv - d).rgb - uThreshold, 0.0)) * w * 0.35;
      }
    }
    gl_FragColor = vec4(base.rgb + acc * uIntensity * 0.06 * uTint, base.a);`));
  return pass;
}
const SCENE_LEVEL = new Set(['fog', 'celshade', 'pixelate', 'ps1']);

const common = `uniform sampler2D tDiffuse; uniform vec2 uRes; uniform float uTime; varying vec2 vUv;
float rand(vec2 c){ return fract(sin(dot(c, vec2(12.9898,78.233))) * 43758.5453); }
float luma(vec3 c){ return dot(c, vec3(0.2126,0.7152,0.0722)); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(rand(i), rand(i + vec2(1.0, 0.0)), f.x), mix(rand(i + vec2(0.0, 1.0)), rand(i + vec2(1.0, 1.0)), f.x), f.y); }
// Line noise ("boil"): where lines are found, moved by smooth noise that is drawn afresh \`rate\` times a second, as
// hand-drawn animation redraws its lines each frame. \`amt\` 0-1 (up to about 6 pixels).
vec2 boilUv(vec2 uv, float amt, float rate){ if (amt <= 0.0) return uv; float f = floor(uTime * max(1.0, rate)); vec2 p = uv * uRes / 22.0; return uv + (vec2(vnoise(p + f * 17.13), vnoise(p + 41.7 - f * 9.31)) - 0.5) * amt * 12.0 / uRes; }
float bayer4(vec2 p){ int x = int(mod(p.x,4.0)); int y = int(mod(p.y,4.0)); int i = x + y*4;
  float m[16]; m[0]=0.;m[1]=8.;m[2]=2.;m[3]=10.;m[4]=12.;m[5]=4.;m[6]=14.;m[7]=6.;m[8]=3.;m[9]=11.;m[10]=1.;m[11]=9.;m[12]=15.;m[13]=7.;m[14]=13.;m[15]=5.;
  for (int k=0;k<16;k++) if (k==i) return m[k]/16.0 - 0.5; return 0.0; }
`;
const vs = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`;

function shader(uniforms: Record<string, any>, body: string, head = '') {
  const kind = (v: any) => (typeof v === 'boolean' ? 'bool' : v?.isColor ? 'vec3' : v?.isTexture ? 'sampler2D' : 'float');
  return { uniforms: { tDiffuse: { value: null }, uRes: { value: new THREE.Vector2(1, 1) }, uTime: { value: 0 }, ...Object.fromEntries(Object.entries(uniforms).map(([k, v]) => [k, { value: v }])) }, vertexShader: vs, fragmentShader: common + Object.keys(uniforms).map((k) => `uniform ${kind(uniforms[k])} ${k};`).join('\n') + '\n' + head + '\nvoid main(){' + body + '}' };
}

/** FX Code compile results by effect id: '' = running, else the message (the effect is skipped). Read by the panel. */
export const fxCodeStatus = new Map<string, string>();
const blackTexture = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1); blackTexture.needsUpdate = true;

/**
 * Custom shader (FX Code): the user's settings become uniforms, the body becomes vec3 fx(vec2 uv, vec3 color). The
 * whole fragment shader is test-compiled with the GPU driver first (as three.js will build it for WebGL 2), so a
 * mistake is reported with the user's own line numbers and the effect is skipped instead of drawing black.
 */
function makeCustomPass(e: PostFxEffect, gl: WebGL2RenderingContext | WebGLRenderingContext | null, textureOf: (id: string) => THREE.Texture | null): ShaderPass | null {
  const { uniforms, body, errors } = parseFxCode(String(e.params.code ?? ''));
  if (errors.length) { fxCodeStatus.set(e.id, errors.join('\n')); return null; }
  const values: Record<string, any> = {};
  for (const u of uniforms) {
    const v = fxValue(e.params, u);
    values[u.name] = u.type === 'vec3' ? new THREE.Color(String(v)) : u.type === 'bool' ? !!v : u.type === 'sampler2D' ? (textureOf(String(v)) ?? blackTexture) : Number(v);
  }
  // (Not "sample": a reserved word in GLSL ES 3.00.)
  const head = `vec3 screen(vec2 p) { return texture2D(tDiffuse, p).rgb; }\n#define TIME uTime\n#define SCREEN_SIZE uRes\nvec3 fx(vec2 uv, vec3 color) {\n`;
  const sh = shader(values, `gl_FragColor = vec4(fx(vUv, texture2D(tDiffuse, vUv).rgb), 1.0);`, head + body + '\n}');
  if (gl && 'createShader' in gl) {
    const prefix = '#version 300 es\nprecision highp float;\nprecision highp int;\nprecision highp sampler2D;\n#define varying in\nlayout(location = 0) out highp vec4 pc_fragColor;\n#define gl_FragColor pc_fragColor\n#define texture2D texture\n';
    const src = prefix + sh.fragmentShader;
    const s = gl.createShader(gl.FRAGMENT_SHADER);
    if (s) {
      gl.shaderSource(s, src); gl.compileShader(s);
      const ok = gl.getShaderParameter(s, gl.COMPILE_STATUS), log = gl.getShaderInfoLog(s) ?? '';
      gl.deleteShader(s);
      if (!ok) {
        // Driver lines → the user's lines (the body starts after the generated code).
        const before = src.slice(0, src.indexOf(head) + head.length).split('\n').length - 1;
        const msg = log.replace(/\u0000/g, '').split('\n').filter((l) => l.trim()).map((l) => l.replace(/^ERROR:\s*\d+:(\d+):/, (_, n) => `Line ${Number(n) - before}:`)).join('\n');
        fxCodeStatus.set(e.id, msg || 'The shader did not compile.');
        return null;
      }
    }
  }
  fxCodeStatus.set(e.id, '');
  return new ShaderPass(sh);
}

/** ASCII effect: the characters (darkest first) drawn white on black in one row of square cells, a texture per set. */
const glyphCache = new Map<string, THREE.Texture>();
function glyphAtlas(chars: string): THREE.Texture {
  const set = chars.length ? chars : ' .:-=+*#%@';
  let t = glyphCache.get(set);
  if (t) return t;
  const cell = 32, c = document.createElement('canvas'); c.width = cell * set.length; c.height = cell;
  const g = c.getContext('2d')!;
  g.fillStyle = '#000'; g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = '#fff'; g.font = `bold ${cell * 0.9}px monospace`; g.textAlign = 'center'; g.textBaseline = 'middle';
  [...set].forEach((ch, i) => g.fillText(ch, i * cell + cell / 2, cell / 2 + 1));
  t = new THREE.CanvasTexture(c); t.minFilter = THREE.LinearFilter; t.magFilter = THREE.LinearFilter; t.generateMipmaps = false;
  glyphCache.set(set, t);
  return t;
}

const PALETTES: Record<string, string[]> = {
  gameboy: ['#0f380f', '#306230', '#8bac0f', '#9bbc0f'],
  pico8: ['#000000', '#1d2b53', '#7e2553', '#008751', '#ab5236', '#5f574f', '#c2c3c7', '#fff1e8', '#ff004d', '#ffa300', '#ffec27', '#00e436', '#29adff', '#83769c', '#ff77a8', '#ffccaa'],
  nes: ['#000000', '#fcfcfc', '#f8f8f8', '#bcbcbc', '#7c7c7c', '#a4e4fc', '#3cbcfc', '#0078f8', '#0000fc', '#b8b8f8', '#6888fc', '#0058f8', '#d8b8f8', '#9878f8', '#6844fc', '#f8b8f8', '#f878f8', '#d800cc', '#f8a4c0', '#f85898', '#e40058', '#f0d0b0', '#f87858', '#f83800', '#fce0a8', '#fca044', '#e45c10', '#f8d878', '#f8b800', '#ac7c00', '#d8f878', '#b8f818', '#00b800', '#b8f8b8', '#58d854', '#00a800', '#b8f8d8', '#58f898', '#00a844', '#00fcfc', '#00e8d8', '#008888'],
  cga: ['#000000', '#55ffff', '#ff55ff', '#ffffff'],
};

function makeDisplayPass(e: PostFxEffect): ShaderPass | null {
  const p = e.params as Record<string, any>;
  switch (e.type) {
    case 'palette': {
      const pal = PALETTES[String(p.palette)] ?? [];
      const cols = pal.map((h) => new THREE.Color(h)).slice(0, 48);
      const arr = cols.map((c) => `vec3(${c.r.toFixed(4)},${c.g.toFixed(4)},${c.b.toFixed(4)})`);
      const nearest = pal.length ? `vec3 best = ${arr[0]}; float bd = 9.0; ${arr.map((a) => `{ vec3 q=${a}; float d = distance(c,q); if (d<bd){bd=d;best=q;} }`).join('')} c = best;` : '';
      return new ShaderPass(shader({ levels: Number(p.levels), dither: !!p.dither, ditherStrength: Number(p.ditherStrength ?? 1) },
        `vec3 c = texture2D(tDiffuse, vUv).rgb; float d = dither ? bayer4(gl_FragCoord.xy) * ditherStrength : 0.0;
         c = floor(c * (levels - 1.0) + 0.5 + d) / (levels - 1.0); c = clamp(c, 0.0, 1.0); ${nearest} gl_FragColor = vec4(c, 1.0);`));
    }
    case 'ps1':
      return new ShaderPass(shader({ colorBits: Number(p.colorBits), dither: !!p.dither },
        `vec3 c = texture2D(tDiffuse, vUv).rgb; float lv = pow(2.0, colorBits) - 1.0; float d = dither ? bayer4(gl_FragCoord.xy) : 0.0;
         gl_FragColor = vec4(clamp(floor(c * lv + 0.5 + d) / lv, 0.0, 1.0), 1.0);`));
    case 'crt':
      return new ShaderPass(shader({ curvature: Number(p.curvature), scanlines: Number(p.scanlines), mask: Number(p.mask), vignette: Number(p.vignette) },
        `vec2 uv = vUv * 2.0 - 1.0; uv *= 1.0 + curvature * dot(uv.yx, uv.yx) * 0.5; uv = uv * 0.5 + 0.5;
         if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) { gl_FragColor = vec4(0,0,0,1); return; }
         vec3 c = texture2D(tDiffuse, uv).rgb; float s = 0.5 + 0.5 * sin(uv.y * uRes.y * 3.14159); c *= mix(1.0, s, scanlines);
         float m = mod(gl_FragCoord.x, 3.0); vec3 mk = m < 1.0 ? vec3(1.,.7,.7) : m < 2.0 ? vec3(.7,1.,.7) : vec3(.7,.7,1.); c *= mix(vec3(1.0), mk, mask);
         vec2 v = uv * (1.0 - uv.yx); c *= mix(1.0, pow(v.x * v.y * 15.0, 0.25), vignette); gl_FragColor = vec4(c, 1.0);`));
    case 'vhs':
      return new ShaderPass(shader({ noise: Number(p.noise), chroma: Number(p.chroma), wobble: Number(p.wobble), tracking: Number(p.tracking) },
        `vec2 uv = vUv; uv.x += sin(uv.y * 40.0 + uTime * 3.0) * wobble; float band = step(0.995 - tracking * 0.02, fract(uv.y * 2.0 - uTime * 0.3)); uv.x += band * 0.02 * tracking;
         float r = texture2D(tDiffuse, uv + vec2(chroma, 0.0)).r; float g = texture2D(tDiffuse, uv).g; float b = texture2D(tDiffuse, uv - vec2(chroma, 0.0)).b;
         vec3 c = vec3(r, g, b); c += (rand(uv * uRes + uTime) - 0.5) * noise; c = mix(c, vec3(luma(c)), 0.15); gl_FragColor = vec4(c, 1.0);`));
    case 'grain':
      return new ShaderPass(shader({ amount: Number(p.amount) }, `vec3 c = texture2D(tDiffuse, vUv).rgb; c += (rand(vUv * uRes + fract(uTime) * 100.0) - 0.5) * amount; gl_FragColor = vec4(c, 1.0);`));
    case 'vignette':
      return new ShaderPass(shader({ amount: Number(p.amount), softness: Number(p.softness) }, `vec3 c = texture2D(tDiffuse, vUv).rgb; float d = distance(vUv, vec2(0.5)) * 1.414; c *= 1.0 - amount * smoothstep(1.0 - softness, 1.0 + softness * 0.2, d); gl_FragColor = vec4(c, 1.0);`));
    case 'chromatic':
      return new ShaderPass(shader({ amount: Number(p.amount) }, `vec2 dir = vUv - 0.5; float r = texture2D(tDiffuse, vUv + dir * amount * 4.0).r; float g = texture2D(tDiffuse, vUv).g; float b = texture2D(tDiffuse, vUv - dir * amount * 4.0).b; gl_FragColor = vec4(r, g, b, 1.0);`));
    case 'colorgrade':
      return new ShaderPass(shader({ exposure: Number(p.exposure), contrast: Number(p.contrast), saturation: Number(p.saturation), temperature: Number(p.temperature), tint: Number(p.tint), lift: Number(p.lift), gamma: Number(p.gamma), gain: Number(p.gain) },
        `vec3 c = texture2D(tDiffuse, vUv).rgb * pow(2.0, exposure); c *= vec3(1.0 + temperature * 0.25, 1.0 - tint * 0.15, 1.0 - temperature * 0.25);
         c = (c - 0.5) * contrast + 0.5; c = mix(vec3(luma(c)), c, saturation); c = c * gain + lift * (1.0 - c); c = pow(max(c, 0.0), vec3(1.0 / gamma)); gl_FragColor = vec4(c, 1.0);`));
    case 'outline': {
      const col = new THREE.Color(String(p.color ?? '#000000'));
      return new ShaderPass(shader({ thickness: Number(p.thickness), threshold: Number(p.threshold), lineColor: col, boil: Number(p.boil ?? 0), boilRate: Number(p.boilRate ?? 8) },
        `vec2 t = thickness / uRes; vec2 e0 = boilUv(vUv, boil, boilRate); float tl = luma(texture2D(tDiffuse, e0 + t * vec2(-1, 1)).rgb), tc = luma(texture2D(tDiffuse, e0 + t * vec2(0, 1)).rgb), tr = luma(texture2D(tDiffuse, e0 + t * vec2(1, 1)).rgb);
         float ml = luma(texture2D(tDiffuse, e0 + t * vec2(-1, 0)).rgb), mr = luma(texture2D(tDiffuse, e0 + t * vec2(1, 0)).rgb);
         float bl = luma(texture2D(tDiffuse, e0 + t * vec2(-1, -1)).rgb), bc = luma(texture2D(tDiffuse, e0 + t * vec2(0, -1)).rgb), br = luma(texture2D(tDiffuse, e0 + t * vec2(1, -1)).rgb);
         float gx = -tl - 2.0 * ml - bl + tr + 2.0 * mr + br; float gy = -tl - 2.0 * tc - tr + bl + 2.0 * bc + br; float e = sqrt(gx * gx + gy * gy);
         vec3 c = texture2D(tDiffuse, vUv).rgb; gl_FragColor = vec4(mix(c, lineColor, smoothstep(threshold, threshold * 1.5, e)), 1.0);`));
    }
    case 'posterize':
      return new ShaderPass(shader({ levels: Number(p.levels) }, `vec3 c = texture2D(tDiffuse, vUv).rgb; gl_FragColor = vec4(floor(c * levels) / (levels - 1.0), 1.0);`));
    case 'halftone':
      return new ShaderPass(shader({ dotSize: Number(p.dotSize), mixAmt: Number(p.mix) },
        `vec3 c = texture2D(tDiffuse, vUv).rgb; vec2 px = gl_FragCoord.xy; float a = 0.785; vec2 r = mat2(cos(a), -sin(a), sin(a), cos(a)) * px;
         vec2 cell = mod(r, dotSize) - dotSize * 0.5; float rad = (1.0 - luma(c)) * dotSize * 0.7; float dotv = step(length(cell), rad);
         gl_FragColor = vec4(mix(c, c * (1.0 - dotv * 0.8), mixAmt), 1.0);`));
    case 'distortion':
      return new ShaderPass(shader({ amount: Number(p.amount), frequency: Number(p.frequency), speed: Number(p.speed), underwater: String(p.mode) === 'underwater' },
        `vec2 uv = vUv; if (underwater) { uv.x += sin(uv.y * frequency + uTime * speed) * amount; uv.y += cos(uv.x * frequency * 0.8 + uTime * speed) * amount; }
         else { float h = smoothstep(0.0, 0.7, 1.0 - vUv.y); uv.x += sin(uv.y * frequency * 3.0 + uTime * speed * 4.0) * amount * h; uv.y += sin(uv.x * frequency * 2.0 + uTime * speed * 3.0) * amount * 0.5 * h; }
         gl_FragColor = vec4(texture2D(tDiffuse, uv).rgb, 1.0);`));
    case 'letterbox':
      return new ShaderPass(shader({ amount: Number(p.amount) }, `vec3 c = texture2D(tDiffuse, vUv).rgb; if (vUv.y < amount || vUv.y > 1.0 - amount) c = vec3(0.0); gl_FragColor = vec4(c, 1.0);`));
    case 'noir':
      return new ShaderPass(shader({ amount: Number(p.amount), contrast: Number(p.contrast) }, `vec3 c = texture2D(tDiffuse, vUv).rgb; float l = (luma(c) - 0.5) * contrast + 0.5; gl_FragColor = vec4(mix(c, vec3(clamp(l, 0.0, 1.0)), amount), 1.0);`));
    case 'paper':
      // Drawn on paper: a slightly wobbly, desaturated picture in ink-like edges over a warm paper with grain and fibres.
      return new ShaderPass(shader({ grain: Number(p.grain), ink: Number(p.ink), wobble: Number(p.wobble), desat: Number(p.desaturate), paperColor: new THREE.Color(String(p.paper ?? '#f2e8d5')), inkColor: new THREE.Color(String(p.inkColor ?? '#2b2420')), boil: Number(p.boil ?? 0), boilRate: Number(p.boilRate ?? 8) },
        `vec2 cellp = floor(gl_FragCoord.xy / 3.0);
         vec2 uv = vUv + (vec2(rand(cellp + 0.31), rand(cellp + 7.7)) - 0.5) * wobble;
         vec3 c = texture2D(tDiffuse, uv).rgb; c = mix(c, vec3(luma(c)), desat);
         vec2 t = 1.0 / uRes; vec2 eu = boilUv(uv, boil, boilRate);
         float gx = luma(texture2D(tDiffuse, eu + vec2(t.x, 0.0)).rgb) - luma(texture2D(tDiffuse, eu - vec2(t.x, 0.0)).rgb);
         float gy = luma(texture2D(tDiffuse, eu + vec2(0.0, t.y)).rgb) - luma(texture2D(tDiffuse, eu - vec2(0.0, t.y)).rgb);
         float edge = smoothstep(0.05, 0.25, length(vec2(gx, gy))) * ink;
         float fibre = rand(vec2(floor(gl_FragCoord.y * 0.7), floor(gl_FragCoord.x * 0.04))) * 0.5 + rand(floor(gl_FragCoord.xy * 0.5)) * 0.5;
         vec3 col = c * paperColor * (1.0 - grain * (fibre - 0.5));
         gl_FragColor = vec4(mix(col, inkColor, edge), 1.0);`));
    case 'dither': {
      // Two colours only, ordered patterns at the chosen pixel size (the 1-bit look).
      const pattern = String(p.pattern ?? 'bayer4');
      return new ShaderPass(shader({ px: Math.max(1, Number(p.pixelSize ?? 2)), contrast: Number(p.contrast ?? 1), bright: Number(p.brightness ?? 0), dark: new THREE.Color(String(p.dark ?? '#1b1b2f')), light: new THREE.Color(String(p.light ?? '#e8e4d8')) },
        `vec2 cell = floor(gl_FragCoord.xy / px);
         vec3 c = texture2D(tDiffuse, (cell * px + px * 0.5) * vec2(dFdx(vUv.x), dFdy(vUv.y))).rgb; // real pixels: the same on high-DPI screens
         float l = clamp((luma(c) - 0.5) * contrast + 0.5 + bright, 0.0, 1.0);
         vec2 a = cell;
         float b2a = fract(dot(floor(a * 0.5), vec2(0.5, floor(a * 0.5).y * 0.75)));
         float b2b = fract(dot(floor(a), vec2(0.5, floor(a).y * 0.75)));
         float b2c = fract(dot(floor(a * 0.25), vec2(0.5, floor(a * 0.25).y * 0.75)));
         float b4 = b2a * 0.25 + b2b, b8 = (b2c * 0.25 + b2a) * 0.25 + b2b;
         float thr = ${pattern === 'bayer8' ? 'b8' : pattern === 'noise' ? 'rand(cell)' : pattern === 'lines' ? 'fract(cell.y * 0.5) * 2.0 * 0.5 + 0.25' : 'b4'};
         gl_FragColor = vec4(l > thr ? light : dark, 1.0);`));
    }
    case 'ascii': {
      // The picture as characters: each cell takes the character whose darkness matches it (darkest first in the set).
      const chars = String(p.characters ?? ' .:-=+*#%@');
      const n = Math.max(1, [...(chars || ' .:-=+*#%@')].length);
      return new ShaderPass(shader({ cellSize: Math.max(4, Number(p.cellSize ?? 10)), glyphs: glyphAtlas(chars), count: n, colored: String(p.color ?? 'scene') === 'scene', fg: new THREE.Color(String(p.fg ?? '#7dff9a')), bg: new THREE.Color(String(p.bg ?? '#050805')) },
        `vec2 cell = floor(gl_FragCoord.xy / cellSize);
         vec3 c = texture2D(tDiffuse, (cell * cellSize + cellSize * 0.5) * vec2(dFdx(vUv.x), dFdy(vUv.y))).rgb; // real pixels: the same on high-DPI screens
         float idx = min(floor(clamp(luma(c), 0.0, 0.999) * count), count - 1.0);
         vec2 inCell = fract(gl_FragCoord.xy / cellSize);
         float m = texture2D(glyphs, vec2((idx + inCell.x) / count, inCell.y)).r;
         vec3 ink = colored ? c / max(0.25, luma(c)) * 0.9 : fg;
         gl_FragColor = vec4(mix(bg, ink, m), 1.0);`));
    }
  }
  return null;
}

export interface FxContext { renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.Camera; width: number; height: number }

export class PostFx {
  composer: EffectComposer | null = null;
  private signature = '';
  private shaderPasses: ShaderPass[] = [];
  private bokeh: BokehPass | null = null;
  active: PostFxEffect[] = [];
  /** Effects handled at scene level (fog, cel shading, PS1 vertex snapping) - read by SceneView. */
  sceneEffects: Record<string, PostFxEffect> = {};

  /** Per-object effects pass (inserted right after the scene render) and whether any object uses it. */
  objectFx: Pass | null = null;
  private objectFxOn = false;
  private last: { stack: PostFxEffect[] | undefined; enabled: boolean } = { stack: undefined, enabled: false };
  setObjectFx(on: boolean) { if (on !== this.objectFxOn) { this.objectFxOn = on; this.signature = ''; this.update(this.last.stack, this.last.enabled); } }

  constructor(private ctx: FxContext) {}
  /** Project textures for FX Code sampler settings (set by the scene view). */
  textureOf: (id: string) => THREE.Texture | null = () => null;

  /** Project quality passes (Preferences › Rendering): anti-aliasing mode and ambient occlusion strength. */
  private extras: { aa: AntiAlias; ao: number; samples: number; contact: number } = { aa: 'msaa', ao: 0, samples: 0, contact: 0 };
  /** Screen-space reflections for this scene (strength 0 = off). */
  private ssr = { strength: 0, distance: 30, thickness: 0.5 };
  private ssrPass: SSRPass | null = null;
  private ssrFrame = 0;
  setSsr(strength: number, distance: number, thickness: number) {
    if (strength === this.ssr.strength && distance === this.ssr.distance && thickness === this.ssr.thickness) return;
    this.ssr = { strength, distance, thickness };
    this.signature = ''; this.update(this.last.stack, this.last.enabled);
  }

  setExtras(aa: AntiAlias | undefined, ao: number | undefined, samples?: number, contact?: number) {
    const next = { aa: aa ?? 'msaa', ao: Math.max(0, ao ?? 0), samples: Math.max(0, Number(samples) || 0), contact: Math.max(0, Math.min(1, Number(contact) || 0)) };
    if (next.aa === this.extras.aa && next.ao === this.extras.ao && next.samples === this.extras.samples && next.contact === this.extras.contact) return;
    this.extras = next; this.signature = ''; this.update(this.last.stack, this.last.enabled);
  }
  /** Contact shadows and volumetric fog: where the sun is, the time for the fog's drift, and whether this view is 3D. */
  sunInfo: () => SunInfo | null = () => null;
  timeNow: () => number = () => performance.now() / 1000;
  allow3dPasses = true;
  private atmosphere: AtmospherePass | null = null;
  set3dPasses(on: boolean) { if (on !== this.allow3dPasses) { this.allow3dPasses = on; this.signature = ''; this.update(this.last.stack, this.last.enabled); } }
  /** The contact shadow pass is on and has what it needs (read by the tests in the app). */
  get atmosphereOn() { return !!this.atmosphere; }

  setCamera(c: THREE.Camera) { if (this.ctx.camera !== c) { this.ctx.camera = c; this.signature = ''; } }

  /** Rebuild the composer if the stack structure changed; otherwise just update uniforms. */
  update(stack: PostFxEffect[] | undefined, enabled: boolean) {
    this.last = { stack, enabled };
    const effects = enabled ? (stack ?? []).filter((e) => e.enabled) : [];
    this.active = effects;
    this.sceneEffects = Object.fromEntries(effects.filter((e) => SCENE_LEVEL.has(e.type)).map((e) => [e.type, e]));
    const sig = effects.map((e) => e.type + ':' + JSON.stringify(e.params)).join('|') + `|${this.ctx.width}x${this.ctx.height}|ofx${this.objectFxOn}|${this.extras.aa}|${this.extras.ao}|${this.extras.samples}|${this.ssr.strength},${this.ssr.distance},${this.ssr.thickness}|${this.extras.contact}|${this.allow3dPasses}`;
    if (sig === this.signature) return;
    this.signature = sig;
    this.composer?.dispose();
    this.composer = null;
    this.atmosphere?.dispose(); this.atmosphere = null;
    this.shaderPasses = []; this.bokeh = null; this.ssrPass = null;
    const { aa, ao, samples } = this.extras;
    const ssr = enabled ? this.ssr.strength : 0;
    // Contact shadows and volumetric fog read the main picture's depth, which only the plain scene pass leaves behind.
    const volFx = effects.find((e) => e.type === 'volumetric');
    const plainPass = !effects.some((e) => e.type === 'pixelate' || e.type === 'ps1') && ssr <= 0 && aa !== 'ssaa';
    const useAtmos = enabled && this.allow3dPasses && plainPass && (this.extras.contact > 0 || !!volFx);
    // (Sample counts other than the display's own 4× only exist on the composer's target, as does turning edge smoothing off.)
    const needsComposer = effects.some((e) => !['fog', 'celshade', 'volumetric'].includes(e.type)) || (this.objectFxOn && !!this.objectFx) || aa !== 'msaa' || ao > 0 || ssr > 0 || (samples > 0 && samples !== 4) || useAtmos;
    if (!needsComposer) return;
    const { renderer, scene, camera, width, height } = this.ctx;
    // Multisampled targets keep the canvas's edge smoothing when post effects are on (they used to lose it).
    const pr = renderer.getPixelRatio();
    const tw = Math.max(1, width * pr), th = Math.max(1, height * pr);
    const target = new THREE.WebGLRenderTarget(tw, th, { type: THREE.HalfFloatType, samples: aa === 'msaa' ? Math.min(samples || 4, renderer.capabilities.maxSamples) : 0, depthTexture: useAtmos ? new THREE.DepthTexture(tw, th, THREE.UnsignedIntType) : null });
    const c = new EffectComposer(renderer, target);
    c.setPixelRatio(renderer.getPixelRatio());
    c.setSize(width, height);
    const pix = effects.find((e) => e.type === 'pixelate');
    const ps1 = effects.find((e) => e.type === 'ps1');
    if (pix || ps1) {
      // True low-resolution render target with nearest upscaling.
      const size = ps1 ? Math.max(1, height / Number(ps1.params.resolution ?? 240)) : Number(pix!.params.pixelSize ?? 4);
      const rp = new RenderPixelatedPass(Math.max(1, pix?.params.integerScale !== false ? Math.round(size) : size), scene, camera, { normalEdgeStrength: 0, depthEdgeStrength: 0 });
      c.addPass(rp);
    } else if (ssr > 0) {
      // SSRPass draws the scene itself, then what the screen shows along each reflected ray on metallic surfaces.
      const s = new SSRPass({ renderer, scene, camera, width, height, selects: null, groundReflector: null });
      s.opacity = Math.min(1, ssr); s.maxDistance = this.ssr.distance; s.thickness = this.ssr.thickness; s.blur = true; s.distanceAttenuation = true; s.fresnel = true;
      this.ssrPass = s; this.ssrFrame = 0;
      c.addPass(s);
    } else if (aa === 'ssaa') {
      // The scene drawn four times, a fraction of a pixel apart, and averaged.
      const a = new SSAARenderPass(scene, camera);
      a.sampleLevel = 2;
      c.addPass(a);
    } else c.addPass(new RenderPass(scene, camera));
    if (useAtmos) {
      const a = new AtmospherePass(camera, this.timeNow);
      a.contact = this.extras.contact;
      if (volFx) a.volume = { density: Number(volFx.params.density ?? 0.06), height: Number(volFx.params.height ?? 2), falloff: Number(volFx.params.falloff ?? 0.2), color: String(volFx.params.color ?? '#39424f'), sun: Number(volFx.params.sun ?? 0.6), wisps: Number(volFx.params.wisps ?? 0.5), distance: Number(volFx.params.distance ?? 120) };
      a.sun = () => this.sunInfo();
      this.atmosphere = a;
      c.addPass(a);
    }
    if (ao > 0 && !pix && !ps1) {
      const g = new GTAOPass(scene, camera, width, height);
      g.blendIntensity = Math.min(2, ao);
      g.updateGtaoMaterial({ radius: 0.5, distanceExponent: 1, thickness: 1, scale: 1 });
      c.addPass(g);
    }
    if (this.objectFxOn && this.objectFx) c.addPass(this.objectFx);
    for (const e of effects.filter((x) => HDR.has(x.type))) {
      if (e.type === 'bloom') c.addPass(new UnrealBloomPass(new THREE.Vector2(width, height), Number(e.params.strength), Number(e.params.radius), Number(e.params.threshold)));
      if (e.type === 'motionblur') c.addPass(new AfterimagePass(Number(e.params.amount)));
      if (e.type === 'glare') {
        // Threshold is in linear HDR units; the bloom pass works on 0..1, so it gets a matching soft knee.
        if (Number(e.params.glow) > 0) c.addPass(new UnrealBloomPass(new THREE.Vector2(width, height), Number(e.params.glow), 0.5, Math.min(1, Number(e.params.threshold) * 0.8)));
        if (e.params.shape !== 'none' && Number(e.params.intensity) > 0) { const g = glarePass(e.params); (g.uniforms as any).uRes.value.set(width, height); c.addPass(g); }
      }
      if (e.type === 'dof') {
        const fstop = Math.max(0.5, Number(e.params.fstop));
        this.bokeh = new BokehPass(scene, camera, { focus: Number(e.params.focus), aperture: 0.0025 / fstop, maxblur: Number(e.params.maxblur) });
        c.addPass(this.bokeh);
      }
    }
    c.addPass(new OutputPass());
    for (const e of effects) {
      if (HDR.has(e.type) || e.type === 'fog' || e.type === 'celshade' || e.type === 'pixelate') continue;
      const pass = e.type === 'customfx' ? makeCustomPass(e, renderer.getContext(), this.textureOf) : makeDisplayPass(e);
      if (pass) { (pass.uniforms as any).uRes.value.set(width, height); c.addPass(pass); this.shaderPasses.push(pass); }
    }
    // Edge smoothing last, on the final picture.
    if (aa === 'smaa') c.addPass(new SMAAPass(width * pr, height * pr));
    if (aa === 'fxaa') {
      const f = new ShaderPass(FXAAShader);
      (f.uniforms as any).resolution.value.set(1 / (width * pr), 1 / (height * pr));
      c.addPass(f);
    }
    this.composer = c;
  }

  setSize(w: number, h: number) {
    this.ctx.width = w; this.ctx.height = h;
    this.signature = '';
  }

  render(time: number): boolean {
    if (!this.composer) return false;
    for (const p of this.shaderPasses) (p.uniforms as any).uTime.value = time;
    // Only shiny metal reflects the screen (with no list the pass would make every surface a mirror). Refreshed now and
    // then: objects come and go, and this walks the whole scene.
    if (this.ssrPass && this.ssrFrame-- <= 0) {
      this.ssrFrame = 20;
      const shiny: THREE.Mesh[] = [];
      this.ctx.scene.traverseVisible((o) => {
        const m = o as THREE.Mesh, mt = m.material as THREE.MeshStandardMaterial | undefined;
        if (m.isMesh && mt?.isMeshStandardMaterial && mt.metalness > 0.5 && mt.roughness < 0.6) shiny.push(m);
      });
      this.ssrPass.selects = shiny;
    }
    this.composer.render();
    return true;
  }

  dispose() { this.composer?.dispose(); this.composer = null; }
}

/** Patch a material for PS1 vertex snapping and affine texture mapping (toggled by uniforms). */
export const ps1Uniforms = { uSnap: { value: 0 }, uSnapRes: { value: new THREE.Vector2(320, 240) }, uAffine: { value: 0 } };
export function patchPs1(m: THREE.Material) {
  if ((m as any).__ps1) return;
  (m as any).__ps1 = true;
  // Keeps any earlier patch (water, random tiling) and its program key.
  const prev = m.onBeforeCompile.bind(m), prevKey = m.customProgramCacheKey();
  m.customProgramCacheKey = () => 'ps1|' + prevKey;
  m.onBeforeCompile = (sh, r) => {
    prev(sh, r);
    sh.uniforms.uSnap = ps1Uniforms.uSnap; sh.uniforms.uSnapRes = ps1Uniforms.uSnapRes; sh.uniforms.uAffine = ps1Uniforms.uAffine;
    sh.vertexShader = 'uniform float uSnap; uniform vec2 uSnapRes; uniform float uAffine; varying float vAffW;\n' + sh.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>
      if (uSnap > 0.5) { vec4 p = gl_Position; p.xyz /= p.w; p.xy = floor(p.xy * uSnapRes * 0.5 + 0.5) / (uSnapRes * 0.5); p.xyz *= p.w; gl_Position = p; }
      vAffW = gl_Position.w;
      #ifdef USE_MAP
      if (uAffine > 0.5) vMapUv *= gl_Position.w;
      #endif`);
    sh.fragmentShader = 'uniform float uAffine; varying float vAffW;\n' + sh.fragmentShader.replace('#include <map_fragment>', `
      #ifdef USE_MAP
      vec2 affUv = uAffine > 0.5 ? vMapUv / vAffW : vMapUv;
      vec4 sampledDiffuseColor = texture2D(map, affUv);
      diffuseColor *= sampledDiffuseColor;
      #endif`);
  };
  m.needsUpdate = true;
}
