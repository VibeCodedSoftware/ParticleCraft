// Play-in-editor session: runs the shared Runtime on a copy of the scene, feeds it input,
// renders it through the same SceneView, and restores the editor scene on Stop.
import { vrSupported } from './xr';
import { vrEffective } from '@shared/src/vr';
import { createTouchOverlay, type TouchOverlay } from '@shared/ui/touchOverlay';
import { Runtime, customParticlePresets } from '@shared/src/runtime/runtime';
import { deepClone } from '@shared/src/schema';
import type { GameProject } from '../project/types';
import { assetUrl } from '../project/api';
import type { SceneView } from './sceneView';
import { Hud } from './hud';
import { GameOverlay } from '@shared/ui/gameOverlay';
import { customVfxExposed } from '@shared/src/runtime/particles';
import { stopDevices } from '@shared/src/runtime/devices';
import { InputState, keyFromEvent, pollGamepad } from '@shared/src/runtime/input';
import { BEHAVIORS } from '@shared/src/runtime/behaviors';
import { applySnapshot, makeSnapshot, removeOnlinePlayer, spawnOnlinePlayer, type NetSnapshot } from '@shared/src/runtime/netSync';
import { NetClient, NetHost, setNetConfig } from '@shared/ui/net';
import type { SceneCarry } from '@shared/src/runtime/story';
import { audio } from './audio';
import { DEFAULT_RENDER } from './culling';
import { presetPatch, type GraphicsPreset } from './quality';

export interface PlayCallbacks {
  log(level: 'info' | 'warn' | 'error', message: string, ref?: { eventId?: string; blockId?: string }): void;
  onBreakpoint(eventId: string): void;
  onSceneChange(sceneId: string): void;
  /** "Quit game": close the game (player app) / stop play (editor). Return false where that isn't possible. */
  quit?(): boolean;
}

export class PlaySession {
  rt!: Runtime;
  hud: Hud;
  paused = false;
  private underwater = false;
  private audioEffect = 'none';
  private raf = 0;
  private last = 0;
  private sceneId: string;
  private firstRun = true;
  private disposers: (() => void)[] = [];
  /** Dialogue box, HTML panels and scene fades. */
  private gameUi: GameOverlay;
  /** Variables / data handed from the scene being left to the next one. */
  private carry: SceneCarry | undefined;
  traceEnabled = false;

  constructor(private project: GameProject, sceneId: string, private view: SceneView, private overlay: HTMLElement, private cb: PlayCallbacks, opts: { client?: NetClient } = {}) {
    this.sceneId = sceneId;
    setNetConfig(project.settings.multiplayer); // the game's own signaling / relay servers, if any
    if (opts.client) this.joinAs(opts.client);
    this.hud = new Hud(overlay);
    this.gameUi = new GameOverlay(overlay);
    this.gameUi.resolveMedia = (ref) => assetUrl(project.id, ref);
    // Speech bubbles over heads: the object named as the speaker, or the player (the one the camera follows, as
    // "Player", "You" or its own name). Seen in first person, the player's own lines and choices stay on the screen.
    this.gameUi.locate = (speaker) => {
      const rt = this.rt; if (!rt) return null;
      const s = speaker.trim().toLowerCase();
      const cam = rt.activeCamera(), fb = cam ? rt.world.behavior(cam, 'follow') : null;
      const playerName = fb ? String(fb.props.target ?? '') : '';
      if (s === '__player__' || /^(player|you|me)$/.test(s) || (playerName && s === playerName.toLowerCase())) {
        if (!fb || !cam) return null;
        if ((cam.state.follow as { fpOn?: boolean } | undefined)?.fpOn ?? !!fb.props.firstPerson) return null;
        const p = rt.world.findByName(playerName);
        return p ? this.view.headOnScreen(p.uid) : null;
      }
      // By name; else (several of one kind, e.g. "Villager") the one of that type nearest the player.
      let o = rt.world.instances.find((i) => !i.destroyed && i.name.toLowerCase() === s);
      if (!o) {
        const me = playerName ? rt.world.findByName(playerName) : null, all = rt.world.of(speaker.trim()).filter((i) => !i.destroyed);
        if (all.length) o = me ? all.reduce((a, b) => (Math.hypot(b.x - me.x, b.y - me.y, b.z - me.z) < Math.hypot(a.x - me.x, a.y - me.y, a.z - me.z) ? b : a)) : all[0];
      }
      return o ? this.view.headOnScreen(o.uid) : null;
    };
    this.hud.onButton = (name) => this.rt?.input.uiButtons.push(name);
    this.hud.resolve = (id) => assetUrl(project.id, id);
    this.hud.project = (x, y, z) => view.worldToScreen(x, y, z);
    view.fontFamily = (id) => this.hud.fontName(id);
    audio.setVolume(project.settings.volume);
    audio.library = project.logic.sounds ?? null;
    audio.resolveUrl = (name) => (name.startsWith('lib:') || name.startsWith('proj:') ? assetUrl(project.id, name) : null);
    for (const [k, v] of Object.entries(project.particlePresets)) customParticlePresets.set(k, v);
    for (const [k, v] of Object.entries(project.vfxExposed ?? {})) customVfxExposed.set(k, v);
    view.renderSettings = { ...DEFAULT_RENDER, ...project.settings.render };
    view.setQuality(project.settings.render?.quality);
    view.setRenderExtras(project.settings.render);
    this.start();
    this.bindInput();
    if (this.vrOn) this.setupVr();
  }

  /** VR enabled in Project settings and a VR Player in the game. */
  private get vrOn() { return !!this.project.settings.vr?.enabled; }
  private vrButton: HTMLElement | null = null;
  /** Enter VR (headset) button, or a note on the desktop VR preview controls. */
  private setupVr() {
    const b = document.createElement('button');
    b.className = 'vr-enter';
    Object.assign(b.style, { position: 'absolute', right: '12px', top: '12px', zIndex: '45', padding: '8px 14px', maxWidth: '46%', borderRadius: '8px', border: '0', background: '#3a8fd9', color: '#fff', font: '600 13px system-ui', cursor: 'pointer', pointerEvents: 'auto' } as CSSStyleDeclaration);
    b.textContent = 'Checking for a VR headset…';
    this.overlay.appendChild(b); this.vrButton = b;
    void vrSupported().then((ok) => {
      if (!this.vrButton) return;
      if (!ok) { b.textContent = 'VR preview: mouse look · WASD move · ←/→ turn · hold T to aim a teleport · E grab'; b.style.cursor = 'default'; b.style.background = 'rgba(58,143,217,.75)'; return; }
      b.textContent = 'Enter VR';
      b.onclick = async () => {
        try {
          const eff = vrEffective(this.project.settings.vr);
          this.view.setQuality(eff.quality);
          await this.view.xr.enter(this.project.settings.vr);
          cancelAnimationFrame(this.raf);
          this.view.renderer.setAnimationLoop(() => this.loop());
          this.view.xr.onEnd = () => { this.view.renderer.setAnimationLoop(null); this.view.setQuality(this.project.settings.render?.quality); this.raf = requestAnimationFrame(this.loop); };
        } catch (e: any) { this.cb.log('error', 'Could not start VR: ' + (e?.message ?? e)); }
      };
    });
  }

  private start() {
    const scene = this.project.scenes.find((s) => s.id === this.sceneId) ?? this.project.scenes[0];
    const host = {
      log: (l: any, m: string, ref?: any) => this.cb.log(l, m, ref),
      playSound: (n: string, v: number, o: any) => { audio.play(n, v, o); this.netHost?.broadcast({ t: 'snd', n, v, o }); },
      stopSound: (w: string) => audio.stop(w),
      setVolume: (v: number) => audio.setVolume(v),
      setAudioEffect: (e: string) => { this.audioEffect = e; if (!this.underwater) audio.setEffect(e); },
      storage: { get: (k: string) => { try { return localStorage.getItem(`gc.${this.project.id}.${k}`); } catch { return null; } }, set: (k: string, v: string) => { try { localStorage.setItem(`gc.${this.project.id}.${k}`, v); } catch { /* storage blocked */ } } },
      requestScene: () => { /* handled in loop via restartRequested */ },
      onBreakpoint: (id: string) => this.cb.onBreakpoint(id),
      openMultiplayer: () => { document.exitPointerLock?.(); window.dispatchEvent(new CustomEvent('gc-open-multiplayer')); },
      quit: () => this.cb.quit?.() ?? false,
      setBusVolume: (cat: string, v: number) => audio.setBus(cat, v),
      // An options menu's quality button: a project that uses a Graphics preset changes the whole preset, not only shadows.
      setQuality: (q: string) => {
        if (!['low', 'medium', 'high', 'ultra'].includes(q)) return;
        const rs = this.project.settings.render;
        this.view.setQuality(q as any);
        if (rs?.preset) this.view.setRenderExtras({ ...rs, ...presetPatch(q as GraphicsPreset) });
      },
      setFullscreen: (on: boolean) => {
        try { if (on && !document.fullscreenElement) void document.documentElement.requestFullscreen?.(); else if (!on && document.fullscreenElement) void document.exitFullscreen?.(); } catch { /* not allowed without a click */ }
      },
    };
    this.rt = new Runtime(deepClone(scene), this.project.logic, { app: 'gamecraft', host, firstRun: this.firstRun, quality: this.project.settings.quality, sceneNames: this.project.scenes.map((s) => s.name), carry: this.carry });
    this.carry = undefined;
    this.rt.traceEnabled = this.traceEnabled;
    // Objects created later (rooms, enemies, pickups) are loaded and their shaders compiled up front.
    if (this.firstRun) this.view.warmUp(scene.objectTypes.map((t) => t.template?.mesh?.asset ?? '').filter(Boolean)).catch(() => undefined);
    this.firstRun = false;
    this.view.clearRuntime();
    this.view.set2D(scene.mode === '2d');
    this.hud.clear();
    this.last = performance.now();
    cancelAnimationFrame(this.raf);
    this.loop();
  }

  // ---- online play (host-authoritative; see Shared/src/runtime/netSync.ts)
  private lastDrawn = 0;
  netHost: NetHost | null = null;
  netClient: NetClient | null = null;
  private netSnap: NetSnapshot | null = null;
  private netSent = 0;
  /** A joined player's camera is following their own character (from then on it ignores the host's camera). */
  private netClientCamera = false;

  /** Start hosting: friends who join drive the characters whose Controls are online2-4. */
  host(): NetHost {
    if (this.netHost) return this.netHost;
    const h = new NetHost();
    h.onJoin = (slot) => { this.rt.input.remotes.set(slot, new InputState()); spawnOnlinePlayer(this.rt, slot); this.rt.queueTrigger('net.on_player_joined', {}, { player: slot }); this.cb.log('info', `Online: player ${slot} joined`); };
    h.onLeave = (slot) => { this.rt.input.remotes.delete(slot); removeOnlinePlayer(this.rt, slot); this.rt.queueTrigger('net.on_player_left', {}, { player: slot }); this.cb.log('warn', `Online: player ${slot} left`); };
    h.onMessage = (slot, m) => { if (m.t === 'in') this.rt.input.remotes.get(slot)?.applySnapshot(m.s); };
    this.netHost = h;
    return h;
  }

  /** The host clicked Continue after Create: "On started hosting" (the menu pack starts the game). */
  startedHosting() { if (this.netHost) this.rt.queueTrigger('net.on_hosting', {}, {}); }

  /** Play as a joined player: the host's world is shown, this player's controls are sent to it. */
  joinAs(client: NetClient) {
    this.netClient = client;
    client.onMessage = (m) => {
      if (m.t === 'snap') this.netSnap = m.s;
      else if (m.t === 'snd') audio.play(m.n, m.v, m.o);
    };
    client.onClose = () => this.cb.log('warn', 'Online: disconnected from the host');
    // Closing the game says goodbye at once; otherwise the host only notices when the connection times out (about 20 s).
    window.addEventListener('pagehide', () => client.close(), { once: true });
  }

  /** Joined player: show the latest snapshot and point this player's camera at their own character. */
  private clientFrame(dt: number) {
    const rt = this.rt;
    // This player's camera follows this player: the host's camera, in the snapshot, must not pull it back every update.
    const before = rt.activeCamera();
    const held = before && this.netClientCamera && rt.world.behavior(before, 'follow') ? [before.x, before.y, before.z, before.rx, before.ry, before.rz] : null;
    if (this.netSnap) {
      applySnapshot(rt, this.netSnap); this.netSnap = null;
      if (held && before && !before.destroyed) [before.x, before.y, before.z, before.rx, before.ry, before.rz] = held;
    }
    const scheme = 'online' + this.netClient!.slot;
    const me = rt.world.instances.find((i) => i.behaviors.some((b) => b.props.controls === scheme));
    const cam = rt.activeCamera();
    const follow = cam && rt.world.behavior(cam, 'follow');
    this.netClientCamera = !!(me && follow);
    if (me && cam && follow) { me.name = '__me'; BEHAVIORS.follow.tick!(cam, { ...follow.props, target: '__me', frameAll: false }, rt, dt); }
    if (performance.now() - this.netSent > 50) { this.netSent = performance.now(); this.netClient!.send({ t: 'in', s: rt.input.snapshot() }); }
    rt.input.endTick();
  }

  private loop = () => {
    // In a headset WebXR drives the frames (renderer.setAnimationLoop); the window's frames stop.
    if (!this.view.xr.presenting) this.raf = requestAnimationFrame(this.loop);
    const now = performance.now();
    // Max FPS: this display frame is skipped. A small allowance, so a limit equal to the display rate never skips by rounding.
    const limit = this.view.maxFps;
    if (limit > 0 && !this.view.xr.presenting && now - this.lastDrawn < 1000 / limit - 1.5) return;
    this.lastDrawn = now;
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    pollGamepad(this.rt.input);
    // The game window's shape, for "is it on screen" checks (Moves when unseen).
    this.rt.viewAspect = this.view.width / Math.max(1, this.view.height);
    // VR: headset controllers and head into the input, or the desktop VR preview (camera = head).
    if (this.vrOn) { if (this.view.xr.presenting) this.view.xr.update(this.rt, this.project.settings.vr?.playArea === 'seated'); else this.view.xr.preview(this.rt, this.view.currentCamera()); }
    if (this.netClient) this.clientFrame(dt);
    else if (!this.paused) this.rt.advance(dt);
    if (this.netHost && now - this.netSent > 50) { this.netSent = now; this.netHost.broadcast({ t: 'snap', s: makeSnapshot(this.rt) }); }
    if (this.rt.restartRequested !== undefined) {
      const target = this.rt.restartRequested;
      if (target) {
        // The runtime only asks for scenes that exist (it reports unknown names and stays put).
        const s = this.project.scenes.find((x) => x.name.toLowerCase() === target.toLowerCase());
        if (s) { this.sceneId = s.id; this.cb.onSceneChange(s.id); }
      }
      this.carry = this.rt.carry;
      audio.stop('all');
      this.start();
      return;
    }
    const cam = this.rt.activeCamera();
    if (cam) audio.listener = [cam.x, cam.y, cam.z];
    this.view.syncRuntime(this.rt);
    this.applyCursor();
    this.view.pollAnimations(this.rt);
    // Under water: muffled sound and a blue-green tint (back to the game's own audio effect on surfacing).
    const under = !!this.rt.ui.underwater;
    if (under !== this.underwater) {
      this.underwater = under;
      audio.setEffect(under ? 'underwater' : this.audioEffect);
      this.overlay.style.boxShadow = under ? 'inset 0 0 0 100vmax rgba(20, 90, 130, 0.28)' : '';
    }
    this.view.render();
    // On-screen touch controls (Input actions › Touch controls), rebuilt when the scene's runtime changes.
    if (this.touchInput !== this.rt.input) { this.touch?.destroy(); this.touch = createTouchOverlay(this.overlay, this.rt.input, (x, y) => this.view.pick(x, y) ?? null); this.touchInput = this.rt.input; }
    this.touch?.update(this.project.logic.touchControls);
    this.hud.update(this.rt, this.project.settings.showFps || !!this.view.renderSettings?.debug, this.view.renderSettings ? this.view.culler.stats : undefined);
    this.gameUi.update(this.rt, this.paused);
  };

  /**
   * Games that look with the mouse (first person / orbit cameras) capture it: hidden and held in the center of the
   * game view. Called from the Play click itself (browsers only allow pointer lock inside a user gesture).
   */
  captureMouse() {
    const el = this.view.renderer.domElement;
    if (this.paused || this.rt.ui.ask || this.cursorMode() !== 'locked' || document.pointerLockElement === el) return;
    // Plain request, synchronously inside the click/key gesture (an options object or a retry after a rejected
    // promise would run outside the gesture and be refused). The returned promise may reject: ignore it.
    try { const r: any = el.requestPointerLock(); r?.catch?.(() => undefined); } catch { /* not allowed right now */ }
  }

  /** Cursor mode: set by the "Set mouse cursor" block, else locked for mouse-look cameras, else visible. */
  cursorMode(): 'visible' | 'hidden' | 'locked' {
    // Conversations and HTML panels need a free mouse to click their buttons.
    if (this.rt.dialogue || Object.values(this.rt.ui.panels ?? {}).some((p) => p.visible)) return 'visible';
    if (this.rt.ui.cursor) return this.rt.ui.cursor;
    const cam = this.rt.activeCamera();
    const fp = cam && this.rt.world.behavior(cam, 'follow')?.props;
    return fp && (fp.orbitWithMouse || fp.firstPerson) ? 'locked' : 'visible';
  }

  /** Apply the cursor mode to the game view (called every frame). */
  private applyCursor() {
    const el = this.view.renderer.domElement;
    const mode = this.cursorMode();
    const locked = document.pointerLockElement === el;
    if (mode !== 'locked' && locked) document.exitPointerLock?.();
    el.style.cursor = mode === 'visible' ? '' : 'none';
    this.rt.ui.cursorLocked = locked;
    // When the game wants the mouse but does not have it (first frame, after Esc), say how to get it back.
    const want = mode === 'locked' && !locked && !this.paused && !this.rt.ui.screen && !this.rt.ui.ask;
    if (want && !this.lockHint) {
      this.lockHint = document.createElement('div');
      this.lockHint.className = 'gc-lock-hint';
      this.lockHint.textContent = 'Click to play — the mouse locks to the game (Esc releases it)';
      this.overlay.appendChild(this.lockHint);
    }
    if (this.lockHint) this.lockHint.style.display = want ? 'block' : 'none';
  }
  private lockHint: HTMLDivElement | null = null;
  private unlockedAt = 0;
  /** True right after the mouse lock was released (the same Esc press must not stop the game). */
  justUnlocked() { return performance.now() - this.unlockedAt < 400; }

  step() { this.paused = true; this.rt.tick(); }
  restart() { audio.stop('all'); this.firstRun = true; this.start(); }
  /** Hot reload: logic edits apply to the running game immediately. */
  reloadLogic(doc: GameProject['logic']) { this.rt.loadLogic(doc); }

  private bindInput() {
    const el = this.view.renderer.domElement;
    const kd = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.('input,textarea,select,[contenteditable]')) return;
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' ', 'Tab'].includes(e.key)) e.preventDefault();
      if (e.key === 'Escape') document.exitPointerLock?.();
      this.rt.input.keyDown(keyFromEvent(e));
    };
    const ku = (e: KeyboardEvent) => this.rt.input.keyUp(keyFromEvent(e));
    const btn = (b: number) => (b === 2 ? 'right' : b === 1 ? 'middle' : 'left') as 'left' | 'right' | 'middle';
    /** Where the pointer is on screen and in the world (a tap on a touch screen has no move before it). */
    const track = (e: PointerEvent) => {
      const m = this.rt.input.mouse, r = el.getBoundingClientRect();
      m.screenX = e.clientX - r.left; m.screenY = e.clientY - r.top;
      const player = this.rt.world.findByName('Player');
      const p = this.view.groundPoint(e.clientX, e.clientY, player && this.rt.world.plane === 'xz' ? player.y + 0.9 : 0);
      if (p) { m.x = p.x; m.y = p.y; m.z = p.z; }
    };
    const md = (e: PointerEvent) => {
      track(e);
      // With the mouse captured (first person) the cursor is the middle of the view.
      const locked = document.pointerLockElement === el, r = el.getBoundingClientRect();
      this.rt.input.mouse.locked = locked;
      const uid = locked ? this.view.pick(r.left + r.width / 2, r.top + r.height / 2) : this.view.pick(e.clientX, e.clientY);
      this.rt.input.mouseDown(btn(e.button), uid != null ? [uid] : []);
      // Mouse-look games (or "Set mouse cursor: locked") capture the mouse again on click after Esc.
      this.captureMouse();
    };
    const mu = (e: PointerEvent) => this.rt.input.mouseUp(btn(e.button));
    const mm = (e: PointerEvent) => {
      const m = this.rt.input.mouse;
      m.dx += e.movementX; m.dy += e.movementY;
      track(e);
    };
    const blur = () => this.rt.input.clear();
    // The wheel over the game: camera zoom (follow cameras), not page scroll.
    const wh = (e: WheelEvent) => { e.preventDefault(); this.rt.input.mouse.wheel += e.deltaY * (e.deltaMode === 1 ? 33 : 1); };
    (el.parentElement ?? el).addEventListener('wheel', wh, { passive: false });
    this.disposers.push(() => (el.parentElement ?? el).removeEventListener('wheel', wh));
    window.addEventListener('keydown', kd); window.addEventListener('keyup', ku);
    el.addEventListener('pointerdown', md); window.addEventListener('pointerup', mu); window.addEventListener('pointermove', mm);
    // Remember when the lock was released, so the Esc that released it does not also stop the game.
    const lockChange = () => { if (document.pointerLockElement !== el) this.unlockedAt = performance.now(); };
    document.addEventListener('pointerlockchange', lockChange);
    this.disposers.push(() => document.removeEventListener('pointerlockchange', lockChange));
    // A click anywhere over the game view (the HUD layer can sit above the canvas) captures the mouse.
    const capture = () => this.captureMouse();
    const area = el.parentElement ?? el;
    area.addEventListener('pointerdown', capture, true);
    this.overlay.addEventListener('pointerdown', capture, true);
    this.disposers.push(() => { area.removeEventListener('pointerdown', capture, true); this.overlay.removeEventListener('pointerdown', capture, true); });
    window.addEventListener('blur', blur);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    this.disposers.push(() => {
      window.removeEventListener('keydown', kd); window.removeEventListener('keyup', ku);
      el.removeEventListener('pointerdown', md); window.removeEventListener('pointerup', mu); window.removeEventListener('pointermove', mm);
      window.removeEventListener('blur', blur);
    });
  }

  private touch: TouchOverlay | null = null;
  private touchInput: unknown = null;

  stop() {
    cancelAnimationFrame(this.raf);
    stopDevices(); // the player's microphone and webcam are never left on
    this.touch?.destroy(); this.touch = null; this.touchInput = null;
    this.vrButton?.remove(); this.vrButton = null; if (this.view.xr.presenting) { this.view.xr.onEnd = null; this.view.xr.exit(); this.view.renderer.setAnimationLoop(null); }
    this.view.renderSettings = null;
    this.overlay.style.boxShadow = '';
    this.netHost?.close(); this.netClient?.close();
    this.disposers.forEach((d) => d());
    document.exitPointerLock?.();
    this.view.renderer.domElement.style.cursor = '';
    this.lockHint?.remove(); this.lockHint = null;
    audio.stop('all');
    this.hud.dispose();
    this.gameUi.dispose();
    this.view.clearRuntime();
  }
}
