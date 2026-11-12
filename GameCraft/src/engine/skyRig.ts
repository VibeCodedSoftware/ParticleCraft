// Sky dome with a sun (and moonlight) that follow the time of day, plus stars at night.
// Driven by scene.settings.sky (Shared/src/runtime/sky.ts): the dome is a gradient from the horizon colour to the
// zenith colour with a sun disc and glow, drawn in display colours (not tone mapped) so it always looks as chosen.
// The dome travels with the camera.
import * as THREE from 'three';
import { skyState, type SkySettings } from '@shared/src/runtime/sky';
import { shadowDefaults } from './quality';

const skyVertex = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww; // always at the far plane
}`;
const skyFragment = /* glsl */ `
uniform vec3 top; uniform vec3 horizon; uniform vec3 sunDir; uniform vec3 sunColor; uniform float sunUp; uniform float haze; uniform float disc;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  // Atmosphere: the air along a low ray is thicker, so it pales toward the horizon. Haze makes that band taller.
  float air = exp(-max(h, 0.0) * (7.0 - haze * 0.45));
  vec3 pale = mix(horizon, vec3(dot(horizon, vec3(0.33))) * 1.15 + horizon * 0.35, 0.45 + haze * 0.03);
  vec3 col = h >= 0.0 ? mix(top, pale, air) : mix(pale, pale * 0.55, clamp(-h * 3.0, 0.0, 1.0));
  float mu = dot(d, normalize(sunDir)), s = max(mu, 0.0);
  // disc = 0 when the sun is a picture (drawn on its own quad): only the glow around it stays. A tight bright glow and
  // a wide faint one, as dust scatters light forward; stronger low in the sky, where the ray crosses more air.
  col += sunColor * (pow(s, 600.0) * 4.0 * disc + (pow(s, 48.0) * 0.32 + pow(s, 6.0) * 0.16) * (0.4 + haze * 0.1) * (0.6 + air)) * sunUp;
  gl_FragColor = vec4(col, 1.0);
}`;

/** The sky dome alone, for an app with its own sun (WorldCraft). Its uniforms are top, horizon, sunDir, sunColor, sunUp, haze, disc. */
export function makeSkyDome() {
  const m = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), new THREE.ShaderMaterial({
    vertexShader: skyVertex, fragmentShader: skyFragment, side: THREE.BackSide, depthWrite: false, fog: false, toneMapped: false,
    uniforms: { top: { value: new THREE.Color() }, horizon: { value: new THREE.Color() }, sunDir: { value: new THREE.Vector3(0, 1, 0) }, sunColor: { value: new THREE.Color() }, sunUp: { value: 1 }, haze: { value: 3 }, disc: { value: 1 } },
  }));
  m.name = 'sky'; m.renderOrder = -2; m.frustumCulled = false;
  return m;
}

export class SkyRig {
  /** The sky's sun follows the project's shadow defaults (Project settings › Rendering), like other suns. */
  applyShadowDefaults() {
    const size = shadowDefaults.resolution > 0 ? shadowDefaults.resolution : 2048, ext = shadowDefaults.distance > 0 ? shadowDefaults.distance : 40, s = this.sun.shadow;
    if (s.mapSize.x !== size) { s.mapSize.set(size, size); s.map?.dispose(); s.map = null as any; }
    const c = s.camera;
    if (c.right !== ext) { c.left = c.bottom = -ext; c.right = c.top = ext; c.updateProjectionMatrix(); }
  }
  group = new THREE.Group();
  private dome: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  readonly sun = new THREE.DirectionalLight(0xffffff, 1);
  private moon = new THREE.DirectionalLight(0x8aa4ff, 0);
  private stars: THREE.Points;
  private dir = new THREE.Vector3();

  constructor() {
    this.dome = makeSkyDome();
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const c = this.sun.shadow.camera; c.left = c.bottom = -40; c.right = c.top = 40; c.near = 0.5; c.far = 200;
    this.sun.shadow.bias = -0.0004;
    this.applyShadowDefaults();
    // Stars: random directions on the upper sphere, fixed size on screen.
    const n = 1600, pos = new Float32Array(n * 3);
    for (let k = 0; k < n; k++) {
      const z = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, r = Math.sqrt(1 - z * z);
      pos.set([Math.cos(a) * r, Math.abs(z) + 0.02, Math.sin(a) * r], k * 3);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.stars = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false, fog: false, toneMapped: false }));
    this.stars.renderOrder = -1;
    this.stars.frustumCulled = false;
    this.group.add(this.dome, this.stars, this.sun, this.sun.target, this.moon, this.moon.target, this.sunDisc, this.moonDisc);
  }

  /** Sun and moon pictures: quads at the sky's edge facing the camera, in display colours like the dome. */
  private sunDisc = SkyRig.disc();
  private moonDisc = SkyRig.disc();
  private static disc() {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, fog: false, toneMapped: false }));
    m.renderOrder = -1; m.frustumCulled = false; m.visible = false;
    return m;
  }
  private static builtInMoon: THREE.Texture | null = null;
  /** The moon when no picture is chosen: a pale disc with soft grey seas and a few craters. */
  private static moonTexture(): THREE.Texture {
    if (SkyRig.builtInMoon) return SkyRig.builtInMoon;
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d')!;
    const grd = g.createRadialGradient(54, 54, 8, 64, 64, 60); grd.addColorStop(0, '#f4f1e6'); grd.addColorStop(1, '#c9c6bb');
    g.fillStyle = grd; g.beginPath(); g.arc(64, 64, 60, 0, Math.PI * 2); g.fill();
    g.globalAlpha = 0.18; g.fillStyle = '#6d6a62';
    for (const [x, y, r] of [[48, 50, 16], [78, 70, 12], [60, 86, 9], [86, 44, 7], [40, 78, 6]]) { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    return (SkyRig.builtInMoon = t);
  }
  private placeDisc(m: THREE.Mesh, cam: THREE.Vector3, dir: THREE.Vector3, r: number, deg: number, opacity: number, tex: THREE.Texture | null) {
    const mat = m.material as THREE.MeshBasicMaterial;
    m.visible = !!tex && opacity > 0.01;
    if (!m.visible) return;
    if (mat.map !== tex) { mat.map = tex; mat.needsUpdate = true; }
    mat.opacity = opacity;
    const d = r * 0.9;
    m.position.copy(cam).addScaledVector(dir, d);
    m.scale.setScalar(2 * d * Math.tan(THREE.MathUtils.degToRad(Math.max(0.2, deg)) / 2));
    m.lookAt(cam);
  }

  /** Place the dome around the camera and set sun, moon, stars and the ambient light for the time of day. */
  update(s: SkySettings, camera: THREE.Camera, hemi: THREE.HemisphereLight, baseAmbient: number, texture: (id: string) => THREE.Texture | null = () => null) {
    const st = skyState(s);
    const cam = camera.getWorldPosition(new THREE.Vector3());
    const far = (camera as THREE.PerspectiveCamera).far ?? 1000;
    const r = Math.min(800, far * 0.8);
    this.dome.position.copy(cam); this.dome.scale.setScalar(r);
    this.stars.position.copy(cam); this.stars.scale.setScalar(r * 0.95);
    this.dir.setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - st.elevation), THREE.MathUtils.degToRad(st.azimuth));
    const u = this.dome.material.uniforms;
    (u.top.value as THREE.Color).setRGB(...st.skyColor);
    (u.horizon.value as THREE.Color).setRGB(...st.horizonColor);
    (u.sunDir.value as THREE.Vector3).copy(this.dir);
    (u.sunColor.value as THREE.Color).setRGB(...st.sunColor);
    u.sunUp.value = Math.max(0, Math.min(1, (st.elevation + 3) / 6));
    u.haze.value = s.haze;
    // Sun picture (replaces the drawn disc, keeps the glow) and the moon opposite the sun, showing as night falls.
    const sunTex = s.sunTexture ? texture(s.sunTexture) : null;
    u.disc.value = sunTex ? 0 : 1;
    this.placeDisc(this.sunDisc, cam, this.dir, r, s.sunSize ?? 3, u.sunUp.value, sunTex);
    const moonTex = s.moon === false ? null : s.moonTexture ? texture(s.moonTexture) : SkyRig.moonTexture();
    const moonDir = this.dir.clone().negate();
    this.placeDisc(this.moonDisc, cam, moonDir, r, s.moonSize ?? 3, moonDir.y > -0.05 ? Math.min(1, st.night * 1.2) : 0, moonTex);
    // Shadows follow the camera so nearby objects always get sharp ones.
    this.sun.position.copy(cam).addScaledVector(this.dir, 80);
    this.sun.target.position.copy(cam);
    this.sun.color.setRGB(...st.sunColor);
    this.sun.intensity = st.sunIntensity * 3;
    this.sun.visible = st.sunIntensity > 0.001;
    this.moon.position.copy(cam).addScaledVector(this.dir, -80);
    this.moon.target.position.copy(cam);
    this.moon.intensity = st.night * 0.25 * s.sunStrength;
    (this.stars.material as THREE.PointsMaterial).opacity = s.stars ? Math.max(0, st.night - 0.2) * 1.25 : 0;
    this.stars.visible = (this.stars.material as THREE.PointsMaterial).opacity > 0.01;
    hemi.color.setRGB(...st.skyColor);
    hemi.groundColor.setRGB(st.skyColor[0] * 0.35, st.skyColor[1] * 0.3, st.skyColor[2] * 0.3);
    hemi.intensity = baseAmbient * Math.PI * 0.6 * st.ambient;
    return st;
  }

  dispose() {
    this.dome.geometry.dispose(); this.dome.material.dispose();
    this.stars.geometry.dispose(); (this.stars.material as THREE.Material).dispose();
    this.sun.dispose(); this.moon.dispose();
    for (const m of [this.sunDisc, this.moonDisc]) { m.geometry.dispose(); (m.material as THREE.Material).dispose(); }
  }
}
