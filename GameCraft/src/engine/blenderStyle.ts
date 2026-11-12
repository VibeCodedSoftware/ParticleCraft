// Blender-style light and camera conventions mapped onto three.js physically based units.
// Lights: Blender watts -> candela via 683 lm/W / 4π, scaled by 1/1000 as a fixed exposure so that the
// Blender default (1000 W point light ~4 m away) reads the same mid-grey it does in Blender with AgX.
import { currentQuality, shadowDefaults } from './quality';
import * as THREE from 'three';
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js';
import type { CameraData, LightData } from '@shared/src/runtime/scene';

RectAreaLightUniformsLib.init();

const W_TO_CD = 0.683 / (4 * Math.PI); // 683 lm/W over the full sphere, /1000 fixed exposure
export function wattsToCandela(w: number) { return w * W_TO_CD; }
export function sunStrengthToLux(s: number) { return s * Math.PI; }

export function makeLight(d: LightData): THREE.Object3D {
  const holder = new THREE.Group();
  holder.name = 'light';
  updateLight(holder, d);
  return holder;
}

/** Rebuilds the inner three.js light when the type changes, otherwise updates parameters in place. */
/** Shadow map size: the light's own, else its type's default scaled by the quality preset (power of two, 256–8192). */
function shadowSize(d: LightData, base: number): number {
  const want = d.shadowResolution && d.shadowResolution > 0 ? d.shadowResolution : shadowDefaults.resolution > 0 ? shadowDefaults.resolution : base * currentQuality.shadowScale;
  return Math.max(256, Math.min(8192, 2 ** Math.round(Math.log2(want))));
}

export function updateLight(holder: THREE.Object3D, d: LightData) {
  let l = holder.children.find((c) => (c as any).isLight) as THREE.Light | undefined;
  const wantType = { point: 'PointLight', sun: 'DirectionalLight', spot: 'SpotLight', area: 'RectAreaLight' }[d.type];
  if (!l || l.type !== wantType) {
    if (l) { holder.remove(l); (l as any).dispose?.(); }
    if (d.type === 'point') l = new THREE.PointLight();
    else if (d.type === 'sun') { const s = new THREE.DirectionalLight(); s.target.position.set(0, 0, -1); s.add(s.target); l = s; }
    else if (d.type === 'spot') { const s = new THREE.SpotLight(); s.target.position.set(0, 0, -1); s.add(s.target); l = s; }
    else { l = new THREE.RectAreaLight(); }
    holder.add(l);
  }
  l.color.set(d.color);
  if (d.type === 'sun') {
    l.intensity = sunStrengthToLux(d.power);
    const s = l as THREE.DirectionalLight;
    s.castShadow = d.castShadow;
    const sz = shadowSize(d, 2048);
    if (s.shadow.mapSize.x !== sz) { s.shadow.mapSize.set(sz, sz); s.shadow.map?.dispose(); s.shadow.map = null as any; }
    const ext = d.shadowArea && d.shadowArea > 0 ? d.shadowArea : shadowDefaults.distance > 0 ? shadowDefaults.distance : 30;
    Object.assign(s.shadow.camera, { left: -ext, right: ext, top: ext, bottom: -ext, near: 0.5, far: 200 });
    s.shadow.camera.updateProjectionMatrix();
    s.shadow.bias = d.shadowBias ?? -0.0005; s.shadow.normalBias = d.shadowNormalBias ?? 0.02;
    s.shadow.radius = 1 + d.radius * 20;
  } else if (d.type === 'point' || d.type === 'spot') {
    const p = l as THREE.PointLight | THREE.SpotLight;
    p.intensity = wattsToCandela(d.power);
    p.decay = d.falloff === 'linear' ? 1 : d.falloff === 'none' ? 0 : 2;
    p.distance = d.cutoff > 0 ? d.cutoff : 0;
    p.castShadow = d.castShadow;
    const sz = shadowSize(d, 1024);
    if (p.shadow.mapSize.x !== sz) { p.shadow.mapSize.set(sz, sz); p.shadow.map?.dispose(); p.shadow.map = null as any; }
    p.shadow.bias = d.shadowBias ?? -0.001; p.shadow.normalBias = d.shadowNormalBias ?? 0.02;
    p.shadow.radius = 1 + d.radius * 30;
    if (d.type === 'spot') {
      const sp = p as THREE.SpotLight;
      sp.angle = Math.min(Math.PI / 2, ((d.spotSize / 2) * Math.PI) / 180); // Blender Spot Size is the full cone angle
      sp.penumbra = d.spotBlend;
    }
  } else {
    const a = l as THREE.RectAreaLight;
    a.width = d.sizeX; a.height = d.areaShape === 'square' ? d.sizeX : d.sizeY;
    // Radiant exitance spread over the area into a hemisphere -> luminance.
    a.intensity = (d.power * 0.683) / (Math.PI * Math.max(0.01, a.width * a.height));
  }
}

/** Blender lights point down their local -Z axis, exactly like three.js directional/spot targets here. */

export function makeCamera(d: CameraData, aspect: number): THREE.Camera {
  const cam = d.type === 'orthographic' ? new THREE.OrthographicCamera(-1, 1, 1, -1, d.clipStart, d.clipEnd) : new THREE.PerspectiveCamera(50, aspect, d.clipStart, d.clipEnd);
  updateCamera(cam, d, aspect);
  return cam;
}

/** Focal length + sensor width (auto fit, like Blender), shift X/Y, ortho scale, clip start/end. */
export function updateCamera(cam: THREE.Camera, d: CameraData, aspect: number, zoom = 1) {
  if ((cam as THREE.PerspectiveCamera).isPerspectiveCamera) {
    const c = cam as THREE.PerspectiveCamera;
    c.aspect = aspect; c.near = d.clipStart; c.far = d.clipEnd;
    c.filmGauge = d.sensorWidth;
    c.setFocalLength(d.focalLength * zoom);
  } else {
    const c = cam as THREE.OrthographicCamera;
    const half = d.orthoScale / 2 / zoom;
    if (aspect >= 1) { c.left = -half; c.right = half; c.top = half / aspect; c.bottom = -half / aspect; }
    else { c.left = -half * aspect; c.right = half * aspect; c.top = half; c.bottom = -half; }
    c.near = d.clipStart; c.far = d.clipEnd;
    c.updateProjectionMatrix();
  }
  if (d.shiftX || d.shiftY) {
    // Blender shift is a fraction of the larger frame dimension.
    const e = (cam as any).projectionMatrix.elements as number[];
    const isPersp = (cam as THREE.PerspectiveCamera).isPerspectiveCamera;
    const sx = 2 * d.shiftX * (aspect >= 1 ? 1 : 1 / aspect), sy = 2 * d.shiftY * (aspect >= 1 ? aspect : 1);
    if (isPersp) { e[8] += sx; e[9] += sy; } else { e[12] -= sx; e[13] -= sy; }
    (cam as any).projectionMatrixInverse.copy((cam as any).projectionMatrix).invert();
  }
}

/** Horizontal/vertical field of view in degrees, shown in the inspector like Blender's FOV readout. */
export function fovFromFocal(focal: number, sensor: number) { return (2 * Math.atan(sensor / 2 / focal) * 180) / Math.PI; }
export function focalFromFov(fov: number, sensor: number) { return sensor / 2 / Math.tan((fov * Math.PI) / 360); }
