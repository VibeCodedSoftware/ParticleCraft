// VR in GameCraft (WebXR = the browser's OpenXR: Meta Quest browser, SteamVR in Chrome / Edge). The headset's
// tracking space is a rig placed on the object with the VR Player behavior; controllers are read every frame into the
// runtime's input (VR actions). Without a headset, the desktop VR preview simulates one: the play camera is the head
// and the hands float in front of it (mouse look, WASD, ← / →, T to aim a teleport, E to grab).
import * as THREE from 'three';
import type { Runtime } from '@shared/src/runtime/runtime';
import type { RInstance } from '@shared/src/runtime/world';
import { eyeHeight, vrEffective, type VrSettings } from '@shared/src/vr';

type V3 = [number, number, number];
const toV3 = (v: THREE.Vector3): V3 => [v.x, v.y, v.z];

/** Is immersive VR available here (a headset and a WebXR browser)? */
export async function vrSupported(): Promise<boolean> {
  try { return !!(navigator as any).xr && await (navigator as any).xr.isSessionSupported('immersive-vr'); } catch { return false; }
}

export class XrHost {
  /** The headset's tracking space, placed on the VR player each frame; its camera is what three's XR renders from. */
  readonly rig = new THREE.Group();
  readonly camera = new THREE.PerspectiveCamera(70, 1, 0.05, 1000);
  session: any = null;
  private comfort = true;
  private height = 1.7;
  private hapticScale = 1;
  onEnd: (() => void) | null = null;

  /** Comfort vignette: a dark ring just in front of the eyes, faded in while moving with the stick. */
  private vignette = new THREE.Mesh(new THREE.RingGeometry(0.11, 0.5, 48), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0, depthTest: false, depthWrite: false }));

  constructor(private renderer: THREE.WebGLRenderer, private scene: THREE.Scene) {
    this.rig.name = 'VR rig'; this.rig.add(this.camera);
    this.vignette.position.z = -0.12; this.vignette.renderOrder = 9999; this.vignette.frustumCulled = false;
  }

  get presenting() { return !!this.session; }

  /** Start immersive VR with the project's settings (resolution scale, foveation, standing / seated). */
  async enter(settings: VrSettings | undefined) {
    const eff = vrEffective(settings);
    const xr = (navigator as any).xr;
    if (!xr) throw new Error('This browser has no WebXR. Use the Meta Quest browser, or Chrome / Edge with SteamVR running.');
    this.comfort = eff.settings.comfortVignette;
    this.height = eff.settings.playerHeight ?? 1.7; this.hapticScale = eff.settings.haptics ?? 1;
    const session = await xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking'] });
    this.renderer.xr.enabled = true;
    this.renderer.xr.setReferenceSpaceType(eff.settings.playArea === 'seated' ? 'local' : 'local-floor');
    this.renderer.xr.setFramebufferScaleFactor(eff.resolutionScale);
    await this.renderer.xr.setSession(session);
    this.renderer.xr.setFoveation(eff.foveation);
    try { await session.updateTargetFrameRate?.(eff.fps); } catch { /* not every headset lets the page choose */ }
    if (!this.rig.parent) this.scene.add(this.rig);
    this.session = session;
    session.addEventListener('end', () => { this.session = null; this.renderer.xr.enabled = false; this.rig.removeFromParent(); this.onEnd?.(); });
  }

  exit() { this.session?.end(); }

  /** Every frame in VR: rig on the player, head direction and both controllers into the input. */
  update(rt: Runtime, seated: boolean) {
    const inp = rt.input;
    inp.xr.active = this.presenting;
    const player = rt.world.instances.find((i) => !i.destroyed && rt.world.hasBehavior(i, 'vrplayer'));
    if (player) this.placeRig(rt, player, seated);
    this.rig.updateMatrixWorld(true);
    const xrCam = this.renderer.xr.getCamera();
    // Comfort vignette follows the head and darkens with stick movement (teleporting needs none).
    if (this.comfort && player) {
      if (this.vignette.parent !== xrCam) xrCam.add(this.vignette);
      const speed = Math.hypot(player.vx, player.vz), max = Number(rt.world.behavior(player, 'vrplayer')?.props.moveSpeed ?? 2.5);
      const m = this.vignette.material as THREE.MeshBasicMaterial;
      m.opacity += (Math.min(0.75, (speed / Math.max(0.1, max)) * 0.75) - m.opacity) * 0.2;
    } else (this.vignette.material as THREE.MeshBasicMaterial).opacity = 0;
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(xrCam.getWorldQuaternion(new THREE.Quaternion()));
    inp.xr.head.yaw = (Math.atan2(-fwd.x, -fwd.z) * 180) / Math.PI;
    inp.xr.head.pitch = (Math.asin(Math.max(-1, Math.min(1, fwd.y))) * 180) / Math.PI;
    inp.xr.head.pos = toV3(xrCam.getWorldPosition(new THREE.Vector3()));
    const frame = this.renderer.xr.getFrame(), ref = this.renderer.xr.getReferenceSpace();
    if (!frame || !ref || !this.session) return;
    const buzz = inp.xr.haptics.splice(0);
    for (const src of this.session.inputSources as Iterable<any>) {
      const hand = src.handedness === 'left' ? 'left' : src.handedness === 'right' ? 'right' : null;
      if (!hand) continue;
      const gp = src.gamepad;
      // Haptics: the strongest request for this hand this frame.
      const want = buzz.filter((x) => x.hand === hand).sort((a, z) => z.strength - a.strength)[0];
      if (want && this.hapticScale > 0) { try { gp?.hapticActuators?.[0]?.pulse?.(Math.min(1, want.strength * this.hapticScale), want.ms); } catch { /* no rumble on this controller */ } }
      let buttons: Record<string, boolean>, stick: [number, number] = [0, 0];
      if (gp && !src.hand) {
        // xr-standard mapping: 0 trigger, 1 squeeze (grip), 3 thumbstick press, 4 A / X, 5 B / Y; axes 2, 3 thumbstick.
        const b = (k: number) => !!gp?.buttons[k]?.pressed;
        buttons = { trigger: b(0), grip: b(1), thumbstick: b(3), [hand === 'right' ? 'a' : 'x']: b(4), [hand === 'right' ? 'b' : 'y']: b(5), menu: b(6) };
        stick = [gp?.axes[2] ?? 0, -(gp?.axes[3] ?? 0)];
      } else {
        // Hand tracking (no controller): pinching thumb and index finger is the trigger and the grip.
        const pinch = this.pinching(frame, ref, src.hand);
        buttons = { trigger: pinch, grip: pinch };
      }
      const pose = frame.getPose(src.targetRaySpace, ref);
      let p: { pos: V3; dir: V3 } | undefined;
      if (pose) {
        const m = new THREE.Matrix4().fromArray(pose.transform.matrix).premultiply(this.rig.matrixWorld);
        const pos = new THREE.Vector3().setFromMatrixPosition(m), dir = new THREE.Vector3(0, 0, -1).transformDirection(m);
        p = { pos: toV3(pos), dir: toV3(dir) };
      }
      inp.setXrHand(hand, buttons, stick, p);
    }
  }

  /** Desktop VR preview: the play camera is the head; hands float in front of it (right hand aims where you look). */
  preview(rt: Runtime, cam: THREE.Camera) {
    const inp = rt.input;
    inp.xr.active = false;
    cam.updateMatrixWorld();
    const pos = cam.getWorldPosition(new THREE.Vector3()), q = cam.getWorldQuaternion(new THREE.Quaternion());
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(q), right = new THREE.Vector3(1, 0, 0).applyQuaternion(q), up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    inp.xr.head.yaw = (Math.atan2(-fwd.x, -fwd.z) * 180) / Math.PI;
    inp.xr.head.pitch = (Math.asin(Math.max(-1, Math.min(1, fwd.y))) * 180) / Math.PI;
    inp.xr.head.pos = toV3(pos);
    const at = (side: number) => toV3(pos.clone().addScaledVector(fwd, 0.45).addScaledVector(right, 0.22 * side).addScaledVector(up, -0.25));
    inp.xr.right.pos = at(1); inp.xr.right.dir = toV3(fwd.clone().addScaledVector(up, 0.35).normalize());
    inp.xr.left.pos = at(-1); inp.xr.left.dir = toV3(fwd);
  }

  /** Hand tracking: thumb tip within 2 cm of the index tip. */
  private pinching(frame: any, ref: any, hand: any): boolean {
    if (!hand || !frame.getJointPose) return false;
    try {
      const a = frame.getJointPose(hand.get('thumb-tip'), ref), b = frame.getJointPose(hand.get('index-finger-tip'), ref);
      if (!a || !b) return false;
      const p = a.transform.position, q = b.transform.position;
      return Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z) < 0.02;
    } catch { return false; }
  }

  private placeRig(rt: Runtime, p: RInstance, seated: boolean) {
    const b = rt.world.aabb(p);
    // Standing: the floor of the tracking space is under the player's feet. Seated: the player's seated eye height is added.
    this.rig.position.set(p.x, b[1] + (seated ? eyeHeight(this.height, true) : 0), p.z);
    // Headings put 0° along +X (world.forward); the headset looks down −Z, so heading a = rotation a − 90°.
    this.rig.rotation.set(0, ((p.ry - 90) * Math.PI) / 180, 0);
  }
}
