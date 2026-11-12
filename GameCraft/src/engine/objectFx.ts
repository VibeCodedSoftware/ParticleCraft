// Per-object effects (glow, pixelate, blur, outline, tint). Objects with effects are put on their own render layer, so
// the normal scene render leaves them out; this pass (right after the scene render, before the global Post-FX) draws
// each one alone - depth-tested against the rest of the scene so walls still hide it - runs its effects on that image
// and composites it back. The global Post-FX stack then runs on top exactly as before.
import * as THREE from 'three';
import { FullScreenQuad, Pass } from 'three/examples/jsm/postprocessing/Pass.js';
import { activeFx, fxNum, fxParam, type ObjectFx } from '@shared/src/objectFx';

export interface FxItem { layer: number; fx: ObjectFx[] }

const VERT = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
const shader = (uniforms: Record<string, THREE.IUniform>, body: string, blending: THREE.Blending = THREE.NoBlending) => new THREE.ShaderMaterial({
  uniforms: { tSrc: { value: null }, uRes: { value: new THREE.Vector2(1, 1) }, ...uniforms }, vertexShader: VERT,
  fragmentShader: `uniform sampler2D tSrc; uniform vec2 uRes; varying vec2 vUv;\n${body}`,
  depthTest: false, depthWrite: false, transparent: blending !== THREE.NoBlending, blending,
});

export class ObjectFxPass extends Pass {
  items: FxItem[] = [];
  private targets: THREE.WebGLRenderTarget[] = [];
  private depthOnly = new THREE.MeshBasicMaterial({ colorWrite: false });
  private quad = new FullScreenQuad();
  private copy = shader({}, 'void main(){ gl_FragColor = texture2D(tSrc, vUv); }');
  private over = shader({}, 'void main(){ vec4 c = texture2D(tSrc, vUv); gl_FragColor = c; }', THREE.NormalBlending);
  private add = shader({ uColor: { value: new THREE.Color() }, uAmount: { value: 1 } }, // Additive blending multiplies by the source alpha, so the (already alpha-weighted) glow is written with alpha 1.
    'uniform vec3 uColor; uniform float uAmount; void main(){ vec4 c = texture2D(tSrc, vUv); gl_FragColor = vec4(mix(c.rgb, uColor, 0.6) * uAmount * c.a, 1.0); }', THREE.AdditiveBlending);
  private pixel = shader({ uSize: { value: 6 } }, 'uniform float uSize; void main(){ vec2 px = uSize / uRes; gl_FragColor = texture2D(tSrc, (floor(vUv / px) + 0.5) * px); }');
  private blur = shader({ uDir: { value: new THREE.Vector2(1, 0) }, uRadius: { value: 4 } }, `uniform vec2 uDir; uniform float uRadius;
    void main(){
      vec4 acc = vec4(0.0); float wsum = 0.0; float sigma = max(0.5, uRadius * 0.5);
      for (int i = -12; i <= 12; i++) { float x = float(i) * uRadius / 12.0; float w = exp(-x * x / (2.0 * sigma * sigma)); vec4 s = texture2D(tSrc, vUv + uDir * x / uRes); acc += vec4(s.rgb * s.a, s.a) * w; wsum += w; }
      acc /= wsum; gl_FragColor = vec4(acc.a > 0.0001 ? acc.rgb / acc.a : vec3(0.0), acc.a);
    }`);
  private tint = shader({ uColor: { value: new THREE.Color() }, uAmount: { value: 0.5 } }, 'uniform vec3 uColor; uniform float uAmount; void main(){ vec4 c = texture2D(tSrc, vUv); float l = dot(c.rgb, vec3(0.299, 0.587, 0.114)); gl_FragColor = vec4(mix(c.rgb, uColor * (0.35 + l * 1.3), uAmount), c.a); }');
  // Outline: opacity, and (optional) animated noise that wobbles the line's width and flickers it along its length.
  private outline = shader({ uColor: { value: new THREE.Color() }, uWidth: { value: 3 }, uOpacity: { value: 1 }, uNoise: { value: 0 }, uTime: { value: 0 } }, `uniform vec3 uColor; uniform float uWidth; uniform float uOpacity; uniform float uNoise; uniform float uTime;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y); }
    void main(){
      vec4 c = texture2D(tSrc, vUv);
      vec2 q = vUv * uRes / 18.0;
      float n = uNoise > 0.0 ? vnoise(q + vec2(uTime * 1.3, -uTime)) * 2.0 - 1.0 : 0.0;
      float w = max(0.5, uWidth * (1.0 + n * uNoise * 0.9));
      float a = 0.0;
      for (int i = 0; i < 16; i++) { float ang = float(i) * 0.3926991; a = max(a, texture2D(tSrc, vUv + vec2(cos(ang), sin(ang)) * w / uRes).a); }
      float flicker = uNoise > 0.0 ? 1.0 - uNoise * 0.6 * vnoise(q * 0.6 - vec2(uTime * 2.1, uTime * 0.7)) : 1.0;
      gl_FragColor = c.a > 0.5 ? c : vec4(uColor, a * uOpacity * flicker);
    }`);

  constructor(private scene: THREE.Scene, private camera: () => THREE.Camera) { super(); this.needsSwap = false; }

  private target(i: number, w: number, h: number) {
    let t = this.targets[i];
    if (!t) { t = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, depthBuffer: i === 0 }); this.targets[i] = t; }
    if (t.width !== w || t.height !== h) t.setSize(w, h);
    return t;
  }
  private run(r: THREE.WebGLRenderer, mat: THREE.ShaderMaterial, src: THREE.Texture, into: THREE.WebGLRenderTarget | null, w: number, h: number) {
    mat.uniforms.tSrc.value = src; (mat.uniforms.uRes.value as THREE.Vector2).set(w, h);
    this.quad.material = mat; r.setRenderTarget(into); this.quad.render(r);
  }

  render(r: THREE.WebGLRenderer, _write: THREE.WebGLRenderTarget, read: THREE.WebGLRenderTarget) {
    if (!this.items.length) return;
    const cam = this.camera(), w = read.width, h = read.height;
    const obj = this.target(0, w, h);
    const prev = { autoClear: r.autoClear, alpha: r.getClearAlpha(), color: r.getClearColor(new THREE.Color()), mask: cam.layers.mask, bg: this.scene.background, over: this.scene.overrideMaterial };
    r.autoClear = false;
    // Lights shine on every layer.
    this.scene.traverse((o) => { if ((o as THREE.Light).isLight) o.layers.enableAll(); });
    // Depth of everything else, so objects in front still hide the effect objects.
    r.setRenderTarget(obj); r.setClearColor(0x000000, 0); r.clear(true, true, true);
    this.scene.background = null; this.scene.overrideMaterial = this.depthOnly; cam.layers.set(0);
    r.render(this.scene, cam);
    this.scene.overrideMaterial = null;
    for (const it of this.items) {
      r.setRenderTarget(obj); r.clear(true, false, false);
      cam.layers.set(it.layer);
      r.render(this.scene, cam);
      // Effects, ping-ponging between two work targets.
      let src: THREE.Texture = obj.texture, slot = 1;
      const step = (mat: THREE.ShaderMaterial) => { const t = this.target(slot, w, h); this.run(r, mat, src, t, w, h); src = t.texture; slot = slot === 1 ? 2 : 1; };
      let glow: ObjectFx | null = null;
      for (const f of activeFx(it.fx)) {
        if (f.type === 'pixelate') { this.pixel.uniforms.uSize.value = fxNum(f, 'size') * r.getPixelRatio(); step(this.pixel); }
        if (f.type === 'blur') { const rad = fxNum(f, 'radius') * r.getPixelRatio(); this.blur.uniforms.uRadius.value = rad; this.blur.uniforms.uDir.value.set(1, 0); step(this.blur); this.blur.uniforms.uDir.value.set(0, 1); step(this.blur); }
        if (f.type === 'tint') { (this.tint.uniforms.uColor.value as THREE.Color).set(String(fxParam(f, 'color'))); this.tint.uniforms.uAmount.value = fxNum(f, 'amount'); step(this.tint); }
        if (f.type === 'outline') {
          const u = this.outline.uniforms;
          (u.uColor.value as THREE.Color).set(String(fxParam(f, 'color'))); u.uWidth.value = fxNum(f, 'width') * r.getPixelRatio();
          u.uOpacity.value = Math.max(0, Math.min(1, Number(fxParam(f, 'opacity'))));
          u.uNoise.value = fxNum(f, 'noise') ? fxNum(f, 'noiseAmount') : 0; // off by default
          u.uTime.value = (performance.now() / 1000) * fxNum(f, 'noiseSpeed');
          step(this.outline);
        }
        if (f.type === 'glow') glow = f;
      }
      // Glow: a blurred copy added around (and over) the object.
      let glowTex: THREE.Texture | null = null;
      if (glow) {
        const keep = src;
        const rad = fxNum(glow, 'radius') * r.getPixelRatio();
        this.blur.uniforms.uRadius.value = rad; this.blur.uniforms.uDir.value.set(1, 0);
        const g1 = this.target(3, w, h), g2 = this.target(4, w, h);
        this.run(r, this.blur, keep, g1, w, h); this.blur.uniforms.uDir.value.set(0, 1); this.run(r, this.blur, g1.texture, g2, w, h);
        glowTex = g2.texture; src = keep;
      }
      this.run(r, this.over, src, read, w, h);
      if (glow && glowTex) { (this.add.uniforms.uColor.value as THREE.Color).set(String(fxParam(glow, 'color'))); this.add.uniforms.uAmount.value = fxNum(glow, 'intensity') * 0.6; this.run(r, this.add, glowTex, read, w, h); }
    }
    cam.layers.mask = prev.mask; this.scene.background = prev.bg; this.scene.overrideMaterial = prev.over;
    r.setClearColor(prev.color, prev.alpha); r.autoClear = prev.autoClear;
  }

  dispose() { for (const t of this.targets) t?.dispose(); this.quad.dispose(); }
}
