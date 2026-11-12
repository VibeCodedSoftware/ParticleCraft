// The shared event-sheet interpreter. It implements Construct 2 semantics:
//  - events run top to bottom every tick; sub-events run after their parent's actions
//  - object conditions *pick* instances (the selected object list, "SOL"); actions apply to picked instances
//  - triggers (On key pressed, On collision...) run out of band when they happen
//  - Else, OR blocks, inverted conditions, looping conditions, Wait, functions and custom events
// Tick order (documented in Shared/documentation/compatibility.md):
//  start triggers -> behaviors -> body contacts -> tweens/clips -> particles -> collisions -> queued triggers
//  -> input triggers -> On fixed physics update -> event sheet -> waits -> flush destroyed
import type { ActionTuning, AppId, BlockInstance, EventBlock, EventNode, LogicDocument, PlayerInput, VariableDef } from '../schema';
import { deepClone, walkEvents } from '../schema';
import { BLOCK_DEFS } from '../blocks/definitions';
import { evalExpr, ExprError, parseExpr, toNum, toStr, truthy, type ExprContext } from '../expr';
import { DEFAULT_CAMERA, type SceneData, type InstanceData } from './scene';
import { raycast } from './physics';
import { World, type RInstance } from './world';
import { SAVE_PREFIX, applySave, parseSave, snapshotGame } from './saveGame';
import { cutterUids, updateBooleanCollision } from './boolean';
import { DEFAULT_ACTIONS, InputState, buttonPrompt, padStyle, playerDeviceBindings, tuneValue } from './input';
import { clockSeed, Rng } from './rng';
import { BEHAVIORS, stepBodyContacts, type BehaviorHost } from './behaviors';

const KINEMATIC = new Set(['sine', 'rotate']);
import type { ShatterEvent } from './breakable';
import { mic, tickDevices, webcam } from './devices';
import { Emitter, PARTICLE_PRESETS, linkEmitters } from './particles';
import { ACTIONS, CONDITIONS, LOOPS, addDecal, damage, spawnLayers } from './blockImpl';
import { stepLockOn } from './lockon';

/** Movement a lock-on dash takes over while it lasts. */
const DASH_REPLACES = new Set(['platform', 'eightdir', 'car', 'pathfinding', 'pathfollow']);
import { isNight } from './sky';
import { waterAt, waterVolumes } from './water';
import { chooseDialogue, continueDialogue, keptGlobals, startDialogue, transitionLook, type DialogueState, type SceneCarry, type TransitionStyle } from './story';
import { pictureRef } from '../dialogueStyle';

export interface RuntimeHost {
  log?(level: 'info' | 'warn' | 'error', message: string, ref?: { eventId?: string; blockId?: string }): void;
  playSound?(name: string, volume: number, opts: { loop?: boolean; music?: boolean; position?: [number, number, number] }): void;
  stopSound?(what: string): void;
  setVolume?(v: number): void;
  setAudioEffect?(effect: string): void;
  storage?: { get(key: string): string | null; set(key: string, value: string): void };
  /** null = restart the current scene. */
  requestScene?(name: string | null): void;
  onBreakpoint?(eventId: string): void;
  /** Show the multiplayer menu (Create / Join) - GameCraft. */
  openMultiplayer?(): void;
  /** "Quit game": close the game (player app) or stop play (editor). False = not possible here (a web page). */
  quit?(): boolean;
  /** Options menus: the player's volume for one sound category (music, sfx, ui, ambience), 0..1. */
  setBusVolume?(category: string, v: number): void;
  /** Options menus: graphics quality preset (low, medium, high, ultra) - GameCraft. */
  setQuality?(preset: string): void;
  /** Options menus: full screen on / off. */
  setFullscreen?(on: boolean): void;
}

export interface RuntimeOptions {
  app: AppId; host?: RuntimeHost; firstRun?: boolean; maxOpsPerTick?: number; quality?: number;
  /** Scenes the host can load; "Load scene" with any other name reports an error and stays put. */
  sceneNames?: string[];
  /** Variables, data and fade brought over from the previous scene (from Runtime.carry). */
  carry?: SceneCarry;
}

export class RuntimeLimitError extends Error {}
export class BlockError extends Error {
  constructor(message: string, public eventId?: string, public blockId?: string) { super(message); }
}

export interface Ctx {
  sol: Map<string, RInstance[]>;
  self?: RInstance;
  scopes: Record<string, any>[];
  loops: { name?: string; index: number; item?: any; stop: boolean }[];
  fn?: { name: string; params: any[]; ret: any };
  triggerData?: any;
  event?: EventBlock;
  pickAdd?: Map<string, Set<RInstance>>;
}

/** A video condition's "video" parameter: empty or "any" matches every video. */
function videoMatches(c: BlockInstance, name: string) {
  const want = String(c.params.video ?? '').trim().toLowerCase();
  return !want || want === 'any' || want === name.toLowerCase();
}

export interface VideoPlayback {
  /** Video name (VideoDef.name) and the file to play. */
  name: string; ref: string;
  loop: boolean; fullscreen: boolean; volume: number;
  /** Window when not fullscreen: centre x/y and width in % of the game view. */
  x: number; y: number; w: number;
  fit: 'contain' | 'cover' | 'stretch';
  skipKey: string; lockControls: boolean;
  paused: boolean;
  /** Seconds played. The host writes time/duration/ended when it plays the file (hostDriven); headless runs advance it. */
  time: number; duration: number; ended: boolean; hostDriven: boolean;
  /** Bumped on every Play so hosts restart the element even for the same file. */
  serial: number;
  /** "On video time" conditions already fired this playthrough. */
  fired: Set<string>;
}

export interface UiState {
  message: { text: string; until: number } | null;
  screen: { kind: 'victory' | 'defeat'; title: string; message: string } | null;
  hiddenTags: Set<string>;
  /** Set full screen asked for full screen (toggle flips it). */
  fullscreen?: boolean;
  /** Mouse cursor requested by logic: shown, hidden over the game, or locked (hidden and held in the center). */
  cursor?: 'visible' | 'hidden' | 'locked';
  /** Set by the host each frame: whether the mouse is currently captured. */
  cursorLocked?: boolean;
  /** "Ask and wait": the open question; the host shows a text box and sets `answer` on Enter. */
  ask?: { question: string; answer?: string } | null;
  /** The playing cutscene video, if any (hosts show it and report its time; see stepVideo). */
  video?: VideoPlayback | null;
  /** HTML code-block panels by name (host sanitizes and shows them) and their CSS. */
  panels?: Record<string, { html: string; visible: boolean }>;
  panelCss?: Record<string, string>;
  /**
   * Screen transition: 'out' covers the screen (then the scene changes, or with screenOnly it stays covered: 'hold'),
   * 'in' uncovers it. Hosts draw transitionAlpha() in its style and colour.
   */
  transition?: { phase: 'out' | 'in' | 'hold'; start: number; duration: number; color: string; style?: TransitionStyle; target?: string | null; screenOnly?: boolean;
    /** Stored picture references (Pictures panel): the shape / fade map, and the cover. */
    shape?: string | null; cover?: string | null } | null;
  /** The active camera is inside a water volume (hosts tint the view and muffle sound). */
  underwater?: boolean;
}

const MAX_TRIGGER_DEPTH = 40;

export class Runtime implements BehaviorHost {
  world: World;
  input = new InputState();
  rng: Rng;
  /** The seed the random numbers started from (expression `randomseed`). */
  seedValue = 1;
  reseed(seed: number) { this.seedValue = (seed >>> 0) || 1; this.rng.seed(this.seedValue); }
  time = 0;
  wallTime = 0;
  tickCount = 0;
  dt = 1 / 60;
  dtScaled = 1 / 60;
  timeScale = 1;
  gravity: number;
  cameraForward: [number, number] = [0, -1];
  globals: Record<string, any> = {};
  globalDefs = new Map<string, VariableDef>();
  emitters = new Map<string, Emitter>();
  ui: UiState = { message: null, screen: null, hiddenTags: new Set() };
  /** Every dialogue line shown and choice made (text games show it as a scrolling story). */
  storyLog: { kind: 'line' | 'choice'; speaker: string; text: string }[] = [];
  camera = { shakeIntensity: 0, shakeUntil: 0, offset: [0, 0, 0] as [number, number, number], zoom: 1 };
  postfxVersion = 0;
  gameOver = false;
  errors: { message: string; eventId?: string; blockId?: string; time: number }[] = [];
  /** Event IDs that ran during the last tick (execution trace for the debugger). */
  trace = new Set<string>();
  traceEnabled = false;
  breakpointsEnabled = true;
  pausedAtBreakpoint: string | null = null;
  halted = false;
  restartRequested: string | null | undefined = undefined;
  /** What the next scene receives (set by changeScene; hosts pass it as RuntimeOptions.carry). */
  carry: SceneCarry | undefined;
  previousScene = '';
  sceneData: any = '';
  /** The open conversation line, if any (hosts show it; see story.ts). */
  dialogue: DialogueState | null = null;
  /**
   * Set by the host's dialogue box, offered each key pressed while a line is open: true when the box used it (showing
   * the rest of a line still being typed out, or changing / taking the response picked with ◀ ▶).
   */
  dialogueHold?: (key: string) => boolean;
  /** Set by the host while the player picks a response with ◀ ▶ (Left / Right): movement is held still. */
  dialogueFreeze = false;
  log: { level: string; message: string; time: number }[] = [];
  sheetEvents: EventNode[] = [];
  private triggerIndex = new Map<string, Set<string>>();
  private collisionPairs: { a: string; b: string; trigger: boolean }[] = [];
  private overlaps = new Set<string>();
  /** Paused event continuations: resume at a time ("Wait") or when `until` becomes true ("Wait until", "Ask"). */
  private waits: { at: number; until?: () => boolean; run: () => void }[] = [];
  private pending: { blockId: string; picks: Record<string, any[]>; data?: any }[] = [];
  private inEvents = false;
  private triggerDepth = 0;
  private ops = 0;
  private maxOps: number;
  private started = false;
  private staticLocals = new Map<string, any>();
  onceState = new Map<string, { last: number }>();
  everyState = new Map<string, number>();
  tweens: { inst: RInstance; prop: string; from: number; to: number; dur: number; t: number; ease: string }[] = [];
  clips = new Map<number, { name: string; t: number; loop: boolean; base: Record<string, number> }>();
  checkpoints = new Map<number, [number, number, number]>();
  startPositions = new Map<number, [number, number, number]>();
  storageFallback = new Map<string, string>();
  fxCounter = 0;
  quality: number;
  private accumulator = 0;
  /** Time spent since the renderer last read it (ms): behaviors and collisions, and event sheets. */
  perf = { movement: 0, events: 0 };

  constructor(public scene: SceneData, public doc: LogicDocument, public opts: RuntimeOptions) {
    this.world = new World(deepClone(scene));
    // Fixed seed (default): the same random results every play. "Random each play": a new seed from the clock.
    this.seedValue = scene.settings.seedMode === 'random' ? clockSeed() : (scene.settings.seed ?? 1);
    this.rng = new Rng(this.seedValue);
    this.gravity = scene.settings.gravity ?? -20;
    this.dt = scene.settings.fixedTimestep || 1 / 60;
    this.maxOps = opts.maxOpsPerTick ?? 2_000_000;
    this.quality = opts.quality ?? 1;
    for (const g of doc.globals) { this.globals[g.name] = deepClone(g.value); this.globalDefs.set(g.name, g); }
    const carry = opts.carry;
    if (carry) {
      Object.assign(this.globals, deepClone(carry.globals));
      this.sceneData = carry.data ?? '';
      this.previousScene = carry.from;
      if (carry.transition && carry.transition.kind !== 'none') this.ui.transition = { phase: 'in', start: 0, duration: carry.transition.duration, ...transitionLook(carry.transition.kind, carry.transition.color), shape: carry.transition.shape, cover: carry.transition.cover };
    }
    this.loadLogic(doc);
    for (const inst of this.world.instances) {
      this.initInstance(inst);
      this.startPositions.set(inst.uid, [inst.x, inst.y, inst.z]);
    }
    // Boolean cutters only shape other meshes: hidden and pass-through while playing; the cut walls' collision is
    // rebuilt around box-shaped holes.
    const cutters = cutterUids(this.world.instances);
    for (const uid of cutters) { const c = this.world.byUid.get(uid); if (c) { c.visible = false; c.collider = { ...c.collider, shape: 'none' }; } }
    for (const inst of this.world.instances) if (inst.boolean?.ops.length) updateBooleanCollision(this.world, inst);
    // Load game from another scene: the save is applied now that this scene is set up.
    if (carry?.load) { applySave(this, carry.load); this.queueTrigger('game.on_game_loaded', {}, { slot: '' }); }
    this.world.onCreated = (inst) => { this.initInstance(inst); this.queueTrigger('object.on_created', { [inst.type]: [inst] }); };
    this.world.onDestroyed = (inst) => {
      // A Breakable that is destroyed (by a block, a kill zone...) shatters instead of vanishing.
      const bk = this.world.behavior(inst, 'breakable');
      if (bk && bk.props.enabled !== false && bk.props.shatterOnDestroy !== false && !inst.state.breakable?.broken) this.breakObject(inst, null, false);
      this.queueTrigger('object.on_destroyed', { [inst.type]: [inst] });
      for (const [k, e] of this.emitters) if (e.attachedUid === inst.uid) { e.emitting = false; e.autoRemove = true; e.attachedUid = undefined; void k; }
    };
  }

  /** Hot-reload logic (used by the editors when the event sheet changes while previewing). */
  loadLogic(doc: LogicDocument) {
    this.doc = doc;
    for (const g of doc.globals) {
      this.globalDefs.set(g.name, g);
      if (!(g.name in this.globals)) this.globals[g.name] = deepClone(g.value);
    }
    const sheet = doc.sheets.find((s) => s.id === this.scene.sheetId) ?? doc.sheets[0];
    // Included sheets (recursively, each once) run after the main sheet's events.
    const seen = new Set<string>();
    const collect = (s: typeof sheet | undefined): EventNode[] => {
      if (!s || seen.has(s.id)) return [];
      seen.add(s.id);
      return [...s.events, ...(s.includes ?? []).flatMap((id) => collect(doc.sheets.find((x) => x.id === id)))];
    };
    this.sheetEvents = collect(sheet);
    this.triggerIndex.clear();
    const pairs = new Map<string, { a: string; b: string; trigger: boolean }>();
    const indexNode = (n: EventNode): Set<string> => {
      const s = new Set<string>();
      if (n.kind === 'event' && !n.loose) {
        const first = n.conditions.find((c) => !c.disabled);
        if (first && BLOCK_DEFS[first.block]?.trigger) s.add(first.block);
        for (const c of n.conditions) {
          if ((c.block === 'object.on_collision' || c.block === 'object.on_collision_end' || c.block === 'object.on_trigger_enter') && c.target) {
            const b = String(c.params.other ?? '');
            pairs.set(`${c.target.toLowerCase()}|${b.toLowerCase()}|${c.block === 'object.on_trigger_enter'}`, { a: c.target, b, trigger: c.block === 'object.on_trigger_enter' });
          }
        }
      }
      if (n.kind === 'event' || n.kind === 'group') for (const ch of n.children) for (const t of indexNode(ch)) s.add(t);
      this.triggerIndex.set(n.id, s);
      return s;
    };
    for (const n of this.sheetEvents) indexNode(n);
    this.collisionPairs = [...pairs.values()];
  }

  initInstance(inst: RInstance) {
    for (const b of inst.behaviors) {
      const def = BEHAVIORS[b.type];
      if (!def) continue;
      for (const pd of def.props) if (!(pd.key in b.props)) b.props[pd.key] = pd.default;
      def.init?.(inst, this);
    }
    if (inst.kind === 'emitter' && inst.emitter) {
      const e = this.makeEmitter(`inst:${inst.uid}`, inst.emitter.preset, inst.emitter.params);
      e.attachedUid = inst.uid;
      e.emitting = inst.emitter.playing;
      this.emitters.set(e.id, e);
      // Further layers of a multi-system effect follow the same object; linked so sub-emitters reach each other.
      const layers = [e];
      this.presetLayers(inst.emitter.preset).slice(1).forEach((name, k) => {
        const x = this.makeEmitter(`inst:${inst.uid}#${k + 2}`, name);
        x.attachedUid = inst.uid; x.emitting = inst.emitter!.playing;
        this.emitters.set(x.id, x);
        layers.push(x);
      });
      linkEmitters(layers);
    }
  }

  /**
   * Bindings of a named input action (the project's actions, else the defaults; a key name works as its own action).
   * With a player (1-4): that player's own profile over the project's actions, kept to their device and pointed at
   * their gamepad ("pad:A" → "pad2:A", "axis:LeftX-" → "axis2:LeftX-"), so local players never share controls.
   */
  actionBindings(name: string, player?: number): string[] {
    const prof = player ? this.playerProfile(player) : undefined;
    const map = { ...(this.doc.inputActions ?? DEFAULT_ACTIONS), ...(prof ? this.doc.inputProfiles?.[prof] : undefined) };
    const key = Object.keys(map).find((k) => k.toLowerCase() === name.trim().toLowerCase());
    const forPlayer = (bs: string[]) => player ? playerDeviceBindings(bs, this.playerInput(player).device) : bs;
    if (!key) return forPlayer([name.trim()]);
    // Contexts (Gameplay, Menu…): an action that belongs to contexts works only while one of them is active.
    const ctx = this.doc.inputContexts;
    if (ctx) {
      const of = Object.entries(ctx).filter(([, acts]) => acts.some((a) => a.toLowerCase() === key.toLowerCase())).map(([c]) => c);
      const active = this.activeContexts ?? new Set(Object.keys(ctx));
      if (of.length && !of.some((c) => active.has(c))) return [];
    }
    return forPlayer(map[key]);
  }

  /** A local player's device and profile (Input editor › Players), with the defaults. */
  playerInput(player: number): PlayerInput {
    const p = this.doc.inputPlayers?.[String(player)];
    return p ?? { device: player <= 1 ? 'all' : (`gamepad${Math.min(4, player)}` as PlayerInput['device']) };
  }
  /** Profiles switched while playing, per player ("Change input profile" for one player). */
  private playerProfiles = new Map<number, string>();
  /** The profile a player uses now (switched in play, else their setting), if it exists. */
  playerProfile(player: number): string | undefined {
    const name = this.playerProfiles.get(player) ?? this.playerInput(player).profile;
    const ps = this.doc.inputProfiles ?? {};
    return name ? Object.keys(ps).find((x) => x.toLowerCase() === name.trim().toLowerCase()) : undefined;
  }

  /** Strongest analog value (0..1) of an action's bindings (sticks give partial values, buttons 0 or 1), tuned. */
  actionValue(name: string, player?: number): number { return tuneValue(Math.max(0, ...this.actionBindings(name, player).map((b) => this.input.bindingValue(b))), this.tuning(name, player)); }

  /** The action's tuning (Input editor; a player's profile tuning first), matched without case. */
  tuning(name: string, player?: number) {
    const find = (t: Record<string, ActionTuning> | undefined) => { const k = t && Object.keys(t).find((x) => x.toLowerCase() === name.trim().toLowerCase()); return k ? t![k] : undefined; };
    const prof = player ? this.playerProfile(player) : undefined;
    return (prof ? find(this.doc.inputProfileTuning?.[prof]) : undefined) ?? find(this.doc.inputTuning);
  }

  /** Toggle-mode actions: on / off, flipped by each press (once per tick), per player. */
  private toggles = new Map<string, { on: boolean; tick: number }>();
  /** "Is held" for an action: held bindings, or for a toggle action whether it is switched on. */
  actionHeld(name: string, player?: number): boolean {
    const bs = this.actionBindings(name, player);
    if (this.tuning(name, player)?.mode !== 'toggle') return bs.some((x) => this.input.binding(x, 'held'));
    const key = (player ?? 0) + ':' + name.trim().toLowerCase(), st = this.toggles.get(key) ?? { on: false, tick: -1 };
    if (st.tick !== this.tickCount && bs.some((x) => this.input.binding(x, 'pressed'))) { st.on = !st.on; }
    st.tick = this.tickCount; this.toggles.set(key, st);
    return st.on;
  }
  /** The button to show for an action on the device in use (a local player's own device when given). */
  promptFor(action: string, player?: number): string {
    const bs = this.actionBindings(action, player);
    let device = this.input.device, pad = this.input.lastPad;
    if (player) {
      const d = this.playerInput(player).device;
      if (d === 'keyboard') device = 'keyboard';
      else if (d.startsWith('gamepad')) { device = 'gamepad'; pad = Number(d.slice(7)) - 1; }
    }
    return buttonPrompt(bs, device, padStyle(this.input.padIds[pad]));
  }
  /**
   * Text with {Action} placeholders filled with the buttons of the device in use: "Press {Jump}" reads "Press Space",
   * then "Press A" once a gamepad is used. Only names of input actions are replaced.
   */
  fillPrompts(text: string, player?: number): string {
    return text.replace(/\{([A-Za-z][A-Za-z0-9_ ]*)\}/g, (m, a: string) => (this.hasAction(a) ? this.promptFor(a, player) : m));
  }
  /** Behaviors: a key's bindings plus every action bound to it (an Interact key E also takes pad X). */
  keyBindings(key: string): string[] {
    const k = key.trim(), map = this.doc.inputActions ?? DEFAULT_ACTIONS;
    const acts = Object.keys(map).filter((a) => a.toLowerCase() === k.toLowerCase() || map[a].includes(k));
    return [...new Set([k, ...acts.flatMap((a) => this.actionBindings(a))])];
  }

  /** Behaviors with Controls = player1-4. */
  playerAction(player: number, action: string, pressed: boolean): boolean { return pressed ? this.actionPressed(action, player) : this.actionHeld(action, player); }
  playerMove(player: number): [number, number] { return this.moveVector(player); }
  /** "Began" / "ended" for an action (a player's own bindings when given). */
  actionPressed(name: string, player?: number): boolean { return this.actionBindings(name, player).some((x) => this.input.binding(x, 'pressed')); }
  actionReleased(name: string, player?: number): boolean { const bs = this.actionBindings(name, player); return bs.some((x) => this.input.binding(x, 'released')) && !bs.some((x) => this.input.binding(x, 'held')); }

  /**
   * Movement and look vectors from the actions every device feeds (keys, sticks, touch stick, VR thumbsticks):
   * move = Right − Left, Up − Down (or the Move action's analog axes), length at most 1; look = right stick, touch /
   * mouse drag and the VR right stick.
   */
  moveVector(player?: number): [number, number] {
    // (Picking a response with ◀ ▶: Left / Right change the response, so the player stands still meanwhile.)
    if (this.dialogueFreeze && this.dialogue) return [0, 0];
    if (player) {
      // One local player: their own Left / Right / Up / Down bindings and only their gamepad's left stick.
      const v = (a: string) => this.actionValue(a, player) * (this.tuning(a, player)?.invert ? -1 : 1);
      const dev = this.playerInput(player).device, pad = dev.startsWith('gamepad') ? Number(dev.slice(7)) - 1 : dev === 'all' ? 0 : -1;
      const ax = pad >= 0 && !this.input.disabled.has('gamepad') ? this.input.pads[pad].axes : [0, 0];
      const x = Math.max(-1, Math.min(1, v('Right') - v('Left') + ax[0]));
      const y = Math.max(-1, Math.min(1, v('Up') - v('Down') - ax[1]));
      const l = Math.hypot(x, y);
      return l > 1 ? [x / l, y / l] : [x, y];
    }
    // Keys and buttons through the Left / Right / Up / Down actions (or arrows / WASD without them), plus the analog
    // sticks: the left gamepad stick, the touch stick and the VR left thumbstick.
    const inp = this.input, v = (a: string) => this.actionValue(a) * (this.tuning(a)?.invert ? -1 : 1);
    const keysX = this.hasAction('Right') ? v('Right') - v('Left') : (inp.disabled.has('keyboard') ? 0 : (inp.down.has('ArrowRight') || inp.down.has('D') ? 1 : 0) - (inp.down.has('ArrowLeft') || inp.down.has('A') ? 1 : 0));
    const keysY = this.hasAction('Up') ? v('Up') - v('Down') : (inp.disabled.has('keyboard') ? 0 : (inp.down.has('ArrowUp') || inp.down.has('W') ? 1 : 0) - (inp.down.has('ArrowDown') || inp.down.has('S') ? 1 : 0));
    const touch = inp.disabled.has('touch') ? [0, 0] : inp.touch.stick, vr = inp.xr.active && !inp.disabled.has('vr') ? inp.xr.left.stick : [0, 0];
    const x = Math.max(-1, Math.min(1, keysX + inp.axis('leftx') + touch[0] + vr[0]));
    const y = Math.max(-1, Math.min(1, keysY + inp.axis('lefty') + touch[1] + vr[1]));
    const l = Math.hypot(x, y);
    return l > 1 ? [x / l, y / l] : [x, y];
  }
  lookVector(): [number, number] {
    const t = this.tuning('Look'), s = t?.sensitivity ?? 1, inv = t?.invert ? -1 : 1;
    const x = this.input.axis('rightx') + this.input.mouse.dx * 0.02 + this.input.xr.right.stick[0];
    const y = this.input.axis('righty') - this.input.mouse.dy * 0.02;
    return [x * s, y * s * inv];
  }
  private hasAction(name: string) { return Object.keys(this.doc.inputActions ?? DEFAULT_ACTIONS).some((k) => k.toLowerCase() === name.toLowerCase()); }

  /** Change an action's bindings while playing (replace with / add / remove one binding). */
  setActionBinding(action: string, binding: string, how: 'replace' | 'add' | 'remove') {
    const map = { ...(this.doc.inputActions ?? DEFAULT_ACTIONS) };
    const key = Object.keys(map).find((k) => k.toLowerCase() === action.trim().toLowerCase()) ?? action.trim();
    const cur = map[key] ?? [];
    map[key] = how === 'replace' ? [binding] : how === 'add' ? [...new Set([...cur, binding])] : cur.filter((b) => b !== binding);
    this.doc.inputActions = map;
  }

  /**
   * Switch to a saved input profile. For everyone: its bindings replace the actions it names. For one player: only
   * that player's actions change (the others keep theirs).
   */
  useInputProfile(name: string, player?: number): boolean {
    const ps = this.doc.inputProfiles ?? {};
    const k = Object.keys(ps).find((x) => x.toLowerCase() === name.trim().toLowerCase());
    if (!k) { this.report('warn', `Change input profile: there is no profile "${name}".`); return false; }
    if (player) { this.playerProfiles.set(player, k); return true; }
    this.doc.inputActions = { ...(this.doc.inputActions ?? DEFAULT_ACTIONS), ...ps[k] };
    return true;
  }

  /** Turn an input context on or off; `only` makes it the single active one. */
  setInputContext(name: string, on: boolean, only = false) {
    const all = Object.keys(this.doc.inputContexts ?? {});
    const cur = this.activeContexts ?? new Set(all);
    const real = all.find((c) => c.toLowerCase() === name.trim().toLowerCase()) ?? name.trim();
    if (only) this.activeContexts = new Set([real]);
    else { if (on) cur.add(real); else cur.delete(real); this.activeContexts = cur; }
  }

  /** An effect's layers: its own preset plus "name#2", "name#3"… registered for multi-system ParticleCraft effects. */
  presetLayers(name: string): string[] {
    const out = [name];
    for (let k = 2; customParticlePresets.has(`${name}#${k}`); k++) out.push(`${name}#${k}`);
    return out;
  }

  makeEmitter(id: string, preset: string, overrides: Record<string, any> = {}): Emitter {
    const base = PRESET_LOOKUP(preset);
    const e = new Emitter(id, { ...base, ...overrides }, preset);
    e.plane = this.world.plane;
    e.qualityScale = this.quality;
    return e;
  }

  // ------------------------------------------------------------ main loop
  /** Advance by real elapsed seconds using fixed steps. Returns number of ticks run. */
  advance(seconds: number): number {
    if (this.halted || this.pausedAtBreakpoint) return 0;
    this.accumulator = Math.min(this.accumulator + seconds, this.dt * 8);
    let n = 0;
    while (this.accumulator >= this.dt && !this.halted && !this.pausedAtBreakpoint) {
      this.accumulator -= this.dt;
      this.tick();
      n++;
    }
    return n;
  }

  tick() {
    this.ops = 0;
    this.trace.clear();
    this.dtScaled = this.dt * this.timeScale;
    this.time += this.dtScaled;
    this.wallTime += this.dt;
    this.tickCount++;
    this.world.tick = this.tickCount;
    tickDevices(this, this.dt);
    const realInput = this.input;
    try {
      // A cutscene can take the controls away from the game while it plays.
      this.stepVideo();
      if (this.ui.video?.lockControls && !this.ui.video.paused) this.input = this.blankInput;
      if (!this.started) {
        this.started = true;
        if (this.opts.firstRun !== false) this.fireTrigger('system.on_game_start', null);
        for (const inst of [...this.world.instances]) this.fireObjectTrigger('object.on_created', inst);
        this.fireTrigger('system.on_start_of_layout', null);
        // On entering this scene (from a named scene, or any): doors back from a house, return from a shop.
        const from = this.previousScene ?? '';
        this.fireTrigger('game.on_scene_enter', null, (c) => { const f = String(c.params.from ?? '').trim().toLowerCase(); return !f || f === from.toLowerCase(); }, { from });
      }
      this.updateCameraForward();
      const moveStart = performance.now();
      if (this.dtScaled > 0) {
        // Transform-only behaviors (Sine, Rotate) run first, so everything that collides this frame sees the
        // final position and rotation of moving platforms, and riders move with them in the same frame.
        for (const inst of this.world.instances) {
          if (inst.destroyed) continue;
          for (const b of inst.behaviors) if (KINEMATIC.has(b.type) && b.props.enabled !== false) BEHAVIORS[b.type]?.tick?.(inst, b.props, this, this.dtScaled);
        }
        for (const inst of this.world.instances) {
          if (inst.destroyed) continue;
          // A ragdoll (Procedural Animation) is limp: no movement or AI drives it, it only falls.
          const limp = !!inst.state.procanim?.ragdoll;
          for (const b of inst.behaviors) {
            if (b.props.enabled === false || KINEMATIC.has(b.type)) continue;
            if (limp && b.type !== 'procanim' && b.type !== 'health') continue;
            if (inst.state.lockon?.dash && DASH_REPLACES.has(b.type)) continue; // a lock-on dash moves it instead
            const def = BEHAVIORS[b.type];
            if (def?.tick) def.tick(inst, b.props, this, this.dtScaled);
            if (inst.destroyed) break;
          }
          if (inst.state.sim) inst.state.sim.clear();
        }
        stepBodyContacts(this);
        stepLockOn(this, this.dtScaled);
        this.stepProjectiles();
        this.stepTweens(this.dtScaled);
      }
      this.stepParticles(this.dtScaled);
      this.stepCamera();
      this.stepEnvironment();
      this.detectCollisions();
      const eventsStart = performance.now();
      this.perf.movement += eventsStart - moveStart;
      this.flushPending();
      this.fireInputTriggers();
      this.fireTrigger('system.on_fixed_update', null);
      this.inEvents = true;
      this.runNodes(this.sheetEvents, this.baseCtx());
      this.inEvents = false;
      this.runWaits();
      this.flushPending();
      this.perf.events += performance.now() - eventsStart;
      const tr = this.ui.transition;
      if (tr && tr.phase !== 'hold' && this.wallTime - tr.start >= tr.duration) {
        if (tr.phase === 'out' && tr.screenOnly) { this.ui.transition = { ...tr, phase: 'hold' }; this.fireTrigger('game.on_screen_covered', null); }
        else if (tr.phase === 'out') this.requestRestart(tr.target ?? null);
        else { this.ui.transition = null; this.fireTrigger('game.on_transition_done', null); }
      }
    } catch (e: any) {
      this.inEvents = false;
      if (e instanceof RuntimeLimitError) {
        this.report('error', e.message);
        this.halted = true;
      } else if (e?.message === '__breakpoint__') {
        // Paused by a breakpoint; resume() continues next tick.
      } else {
        this.report('error', 'Runtime error: ' + (e?.message ?? String(e)));
      }
    }
    this.input = realInput;
    this.world.flushDestroyed();
    this.input.endTick();
    if (this.ui.message && this.wallTime > this.ui.message.until) this.ui.message = null;
  }

  // ------------------------------------------------------------ cutscene video
  private blankInput = new InputState();
  /** Start a video from the document's Videos list (replaces one that is playing). */
  playVideo(name: string, o: Partial<VideoPlayback> = {}) {
    const def = (this.doc.videos ?? []).find((v) => v.name.toLowerCase() === name.trim().toLowerCase());
    if (!def) { this.report('error', `Video "${name}" not found - add it in the Videos panel`); return; }
    if (this.ui.video) this.endVideo('stopped');
    this.ui.video = {
      name: def.name, ref: def.ref, loop: false, fullscreen: true, volume: 1, x: 50, y: 50, w: 60, fit: 'contain', skipKey: 'none', lockControls: true,
      ...o, paused: false, time: 0, duration: def.duration ?? 0, ended: false, hostDriven: false, serial: (this.videoSerial = (this.videoSerial ?? 0) + 1), fired: new Set(),
    };
  }
  private videoSerial?: number;
  /** End the video: "finished" (played to the end), "skipped" (skip key) or "stopped" (Stop video / replaced). */
  endVideo(how: 'finished' | 'skipped' | 'stopped') {
    const v = this.ui.video; if (!v) return;
    this.ui.video = null;
    if (how === 'stopped') return;
    this.fireTrigger('video.on_end', null, (c) => videoMatches(c, v.name) && (how === 'finished' || c.params.skipped !== false), { how });
  }
  /** Skip key, headless clock, "On video time" and "On video finished". Runs before anything reads input. */
  private stepVideo() {
    const v = this.ui.video; if (!v) return;
    if (v.skipKey && v.skipKey !== 'none' && (v.skipKey === 'Any key' ? this.input.pressed.size > 0 : this.input.anyPressed([v.skipKey]))) { this.endVideo('skipped'); return; }
    if (!v.paused && !v.hostDriven) {
      v.time += this.dt;
      if (v.duration > 0 && v.time >= v.duration) { if (v.loop) { v.time -= v.duration; v.fired.clear(); } else { v.time = v.duration; v.ended = true; } }
    }
    if (v.hostDriven && v.time + 0.25 < ((v as any).lastTime ?? 0)) v.fired.clear(); // looped
    (v as any).lastTime = v.time;
    this.fireTrigger('video.on_time', null, (c) => {
      if (!videoMatches(c, v.name) || v.fired.has(c.id) || v.time < toNum(c.params.seconds)) return false;
      v.fired.add(c.id); return true;
    });
    if (this.ui.video === v && v.ended && !v.loop) this.endVideo('finished');
  }

  /** Day/night clock, flickering lights, and objects entering / leaving water. */
  private stepEnvironment() {
    const sky = this.scene.settings.sky;
    if (sky?.enabled && sky.cycle && this.dtScaled > 0) {
      const wasNight = isNight(sky);
      sky.time = (sky.time + (this.dtScaled * 24) / Math.max(1, sky.dayLength)) % 24;
      const night = isNight(sky);
      if (night && !wasNight) this.queueTrigger('sky.on_nightfall', {});
      if (!night && wasNight) this.queueTrigger('sky.on_daybreak', {});
    }
    for (const i of this.world.instances) {
      if (i.destroyed) continue;
      const fl = i.state.flicker as { until: number; base: number } | undefined;
      if (fl && i.light) {
        if (this.time >= fl.until) { i.light.power = fl.base; delete i.state.flicker; }
        else i.light.power = this.rng.next() < 0.45 ? fl.base * (0.1 + this.rng.next() * 0.3) : fl.base;
      }
      // Water: anything that moves (or has physics) knows whether it is in water.
      if (i.kind === 'light' || i.kind === 'camera' || i.kind === 'text' || this.world.hasBehavior(i, 'water')) continue;
      const w = waterAt(this.world, i);
      const was = !!i.state.inWater;
      if (!!w !== was) {
        i.state.inWater = !!w;
        this.queueTrigger(w ? 'water.on_enter' : 'water.on_exit', { [i.type]: [i] });
      }
      if (w || i.state.float || this.world.hasBehavior(i, 'physics')) this.floatState(i, w ?? this.waterUnder(i));
    }
    const cam = this.activeCamera();
    this.ui.underwater = !!(cam && waterAt(this.world, cam, true));
  }

  /**
   * Floating state of things in water (existing buoyancy, no separate Float system): how much of it is under the
   * surface, the water's depth there, floating / sinking and tipped over, with their events.
   */
  /** A water the object overlaps even with its centre above the surface (a bobbing crate), as waterAt reports it. */
  private waterUnder(i: RInstance): ReturnType<typeof waterAt> {
    const b = this.world.aabb(i), cx = (b[0] + b[3]) / 2, cz = (b[2] + b[5]) / 2;
    for (const v of waterVolumes(this.world)) {
      if (v === i) continue;
      const vb = this.world.aabb(v);
      if (cx < vb[0] || cx > vb[3] || cz < vb[2] || cz > vb[5] || b[1] >= vb[4] || b[4] <= vb[1]) continue;
      return { volume: v, props: this.world.behavior(v, 'water')!.props, surface: vb[4], depth: vb[4] - b[1] } as NonNullable<ReturnType<typeof waterAt>>;
    }
    return null;
  }

  private floatState(i: RInstance, w: ReturnType<typeof waterAt>) {
    const prev = (i.state.float ?? { floating: false, sinking: false, tipped: false, under: 0, out: 0 }) as { floating: boolean; sinking: boolean; tipped: boolean; under: number; out: number };
    if (!w) {
      // Bobbing clear of the surface for a moment is still floating (no second "start floating" when it drops back).
      const out = (prev.out ?? 0) + this.dtScaled, still = prev.floating && out < 1;
      if (i.state.float) { i.state.submerged = 0; i.state.waterDepth = 0; i.state.float = { floating: still, sinking: false, tipped: prev.tipped, under: 0, out }; }
      return;
    }
    const b = this.world.aabb(i), h = Math.max(1e-6, b[4] - b[1]);
    const sub = Math.max(0, Math.min(1, (w.surface - b[1]) / h));
    const vb = this.world.aabb(w.volume);
    i.state.submerged = sub;
    i.state.waterDepth = Math.max(0, w.surface - vb[1]);
    // Sinking: (nearly) all under and going down, or lying on the bottom, for 0.4 s (a splash that plunges under and
    // bobs back up is not sinking). Floating: partly under, or plunged but not (yet) sinking.
    const down = sub >= 0.98 && (i.vy < -0.05 || b[1] <= vb[1] + 0.05);
    const under = down ? prev.under + this.dtScaled : 0;
    const sinking = under > 0.4;
    const floating = !sinking && ((sub > 0.02 && sub < 0.98) || (prev.floating && sub > 0));
    // Tipped over: its up points more than 60° away from straight up (Euler YXZ: up.y = cos(rx)·cos(rz)).
    const upY = Math.cos((i.rx * Math.PI) / 180) * Math.cos((i.rz * Math.PI) / 180);
    const tipped = this.world.hasBehavior(i, 'physics') && upY < 0.5;
    if (floating && !prev.floating) this.queueTrigger('water.on_start_floating', { [i.type]: [i] });
    if (sinking && !prev.sinking) this.queueTrigger('water.on_start_sinking', { [i.type]: [i] });
    if (tipped && !prev.tipped) this.queueTrigger('water.on_tipped_over', { [i.type]: [i] });
    i.state.float = { floating, sinking, tipped, under, out: 0 };
  }

  private updateCameraForward() {
    const cam = this.activeCamera();
    if (!cam) return;
    const la = cam.state.lookAt as [number, number, number] | undefined;
    let fx: number, fz: number;
    if (la) { fx = la[0] - cam.x; fz = la[2] - cam.z; }
    else { const r = (cam.ry * Math.PI) / 180; fx = -Math.sin(r); fz = -Math.cos(r); }
    const l = Math.hypot(fx, fz);
    if (l > 1e-4) this.cameraForward = [fx / l, fz / l];
  }

  // ------------------------------------------------------------ breakables
  /** Objects that just broke; the renderer takes them (and cuts the object's mesh / sprite into pieces). */
  shatters: ShatterEvent[] = [];
  /** Shatter a Breakable object: record the event, fire On broken, spawn debris / particles / sound, remove it. */
  breakObject(inst: RInstance, hit: { dir: [number, number, number]; speed: number; by?: RInstance } | null, destroy = true) {
    const b = this.world.behavior(inst, 'breakable');
    const st = (inst.state.breakable ??= { hp: 0, broken: false, lastSpeed: 0 });
    if (!b || st.broken) return;
    st.broken = true;
    const p = b.props;
    const pos = this.world.worldPos(inst);
    this.shatters.push({
      uid: inst.uid, pos, dir: hit?.dir ?? [0, 0, 0], speed: hit?.speed ?? 0,
      pieces: Math.max(2, Math.min(1000, Math.round(Number(p.pieces) || 120))), force: Number(p.force ?? 4), lifetime: Number(p.lifetime ?? 5),
      seed: (inst.uid * 9973 + this.tickCount) >>> 0, inside: String(p.inside || ''),
      quality: p.quality === 'low' || p.quality === 'medium' ? p.quality : 'high', outsideTexture: String(p.outsideTexture || ''), insideTexture: String(p.insideTexture || ''),
    });
    if (this.shatters.length > 64) this.shatters.splice(0, this.shatters.length - 64); // nobody is drawing them (headless)
    this.queueTrigger('breakable.on_broken', { [inst.type]: [inst] });
    const debris = String(p.debris ?? '').trim();
    if (debris) this.world.spawn(debris, pos[0], pos[1], pos[2]);
    const fx = String(p.particles ?? '').trim();
    if (fx) {
      linkEmitters(this.presetLayers(fx).map((name, k) => {
        const e = this.makeEmitter(`fx:${this.fxCounter++}${k ? '#' + (k + 1) : ''}`, name);
        e.position = pos; e.autoRemove = true; if (e.params.looping) e.params = { ...e.params, looping: false, duration: Math.max(0.5, e.params.duration) };
        this.emitters.set(e.id, e);
        return e;
      }));
    }
    const snd = String(p.sound ?? '').trim();
    if (snd) this.opts.host?.playSound?.(snd, 0.8, { position: pos });
    if (destroy) this.world.destroy(inst);
  }
  /** Damage to a Breakable without Health wears its durability down. Returns true when the hit counted. */
  breakableDamage(inst: RInstance, amount: number): boolean {
    const st = inst.state.breakable;
    if (!st || st.broken || amount <= 0) return false;
    st.hp -= amount;
    this.queueTrigger('breakable.on_damaged', { [inst.type]: [inst] });
    if (st.hp <= 0) this.breakObject(inst, null);
    return true;
  }

  // BehaviorHost services used by the AI presets.
  damage(inst: RInstance, amount: number) { return damage(this, inst, amount); }
  spawnParticles(preset: string, pos: [number, number, number], heading = 0, color?: string) { spawnLayers(this, preset, pos, heading, color); }
  addMark(on: RInstance, point: [number, number, number], normal: [number, number, number], size: number, o: { color?: string; alpha?: number; life?: number; pool?: string; max?: number }) { addDecal(this, on, point, normal, '', size, o); }
  openDialogue(name: string) { startDialogue(this, name); }
  dialogueOpen() { return !!this.dialogue; }

  /**
   * Is `inst` on screen for the game camera (3D): its centre or a corner inside the active camera's view (field of
   * view from the focal length, or the orthographic box, fitted to the window like the renderer) and — with `walls` — not
   * hidden behind a Solid. False when there is no camera.
   */
  /** Width ÷ height of the game window (set by the host each frame; 0 = assume 16:9). */
  viewAspect = 0;
  cameraSees(inst: RInstance, walls = true): boolean {
    const cam = this.activeCamera(), w = this.world;
    if (!cam || w.plane !== 'xz') return false;
    const pos = w.worldPos(cam), D = Math.PI / 180;
    const la = cam.state.lookAt as [number, number, number] | undefined;
    let f: [number, number, number] = la ? [la[0] - pos[0], la[1] - pos[1], la[2] - pos[2]]
      : [-Math.sin(cam.ry * D) * Math.cos(cam.rx * D), Math.sin(cam.rx * D), -Math.cos(cam.ry * D) * Math.cos(cam.rx * D)];
    const fl = Math.hypot(...f) || 1; f = [f[0] / fl, f[1] / fl, f[2] / fl];
    // Right = f × up, up = right × f (a camera looking straight down still gets a sensible right).
    let r: [number, number, number] = [-f[2], 0, f[0]]; const rl = Math.hypot(...r);
    r = rl > 1e-4 ? [r[0] / rl, 0, r[2] / rl] : [1, 0, 0];
    const u: [number, number, number] = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
    // The renderer's own fit (Blender "auto"): the sensor spans the window's longer side; zoom narrows the view.
    const c = cam.camera ?? DEFAULT_CAMERA, aspect = this.viewAspect > 0 ? this.viewAspect : 16 / 9, zoom = this.camera.zoom || 1;
    const ortho = c.type === 'orthographic';
    const slope = Math.max(0.02, (c.sensorWidth || 36) / (2 * Math.max(1, c.focalLength || 50) * zoom));
    const tanH = aspect >= 1 ? slope : slope * aspect, tanV = aspect >= 1 ? slope / aspect : slope;
    const half = (c.orthoScale || 12) / 2 / zoom, halfW = aspect >= 1 ? half : half * aspect, halfH = aspect >= 1 ? half / aspect : half;
    // Seen when any part shows: the centre or any corner of its box.
    const b = w.aabb(inst), cx = (b[0] + b[3]) / 2, cy = (b[1] + b[4]) / 2, cz = (b[2] + b[5]) / 2;
    const pts: [number, number, number][] = [[cx, cy, cz]];
    for (const X of [b[0], b[3]]) for (const Y of [b[1] + 0.02, b[4] - 0.02]) for (const Z of [b[2], b[5]]) pts.push([X + (cx - X) * 0.05, Y, Z + (cz - Z) * 0.05]);
    for (const p of pts) {
      const d = [p[0] - pos[0], p[1] - pos[1], p[2] - pos[2]];
      const z = d[0] * f[0] + d[1] * f[1] + d[2] * f[2], x = d[0] * r[0] + d[2] * r[2], y = d[0] * u[0] + d[1] * u[1] + d[2] * u[2];
      if (z <= (c.clipStart ?? 0.1)) continue;
      const inView = ortho ? Math.abs(x) <= halfW && Math.abs(y) <= halfH : Math.abs(x) <= z * tanH * 1.05 && Math.abs(y) <= z * tanV * 1.05;
      if (!inView) continue;
      if (!walls) return true;
      const len = Math.hypot(d[0], d[1], d[2]);
      const hit = raycast(w, pos, [d[0] / len, d[1] / len, d[2] / len], len, w.solids().filter((s) => s !== inst), cam);
      if (!hit || hit.inst === inst || Math.hypot(hit.point[0] - pos[0], hit.point[1] - pos[1], hit.point[2] - pos[2]) >= len - 0.15) return true;
    }
    return false;
  }

  activeCamera(): RInstance | undefined {
    const cams = this.world.instances.filter((i) => i.kind === 'camera' && !i.destroyed);
    return cams.find((c) => c.camera?.active) ?? cams[0];
  }

  /** Projectiles from "Shoot projectile" damage the first object with Health they touch (never their owner). */
  projectiles = new Set<number>();
  /**
   * Decals stuck on surfaces (bullet holes): the picture, the object it sits on (moving with it), where on it
   * relative to its position, the surface normal, size (m) and when it was made. The oldest go first (max 64).
   */
  /** Marks stuck on surfaces: bullet holes (picture) and paint (colour); `life` 0 = stays. See addDecal. */
  decals: { id: number; uid: number; offset: [number, number, number]; normal: [number, number, number]; image: string; size: number; born: number; color?: string; alpha?: number; life?: number; pool?: string }[] = [];
  decalSeq = 0;
  private stepProjectiles() {
    if (!this.projectiles.size) return;
    const targets = this.world.instances.filter((i) => !i.destroyed && ((i.state.health && !i.state.health.dead) || (i.state.breakable && !i.state.breakable.broken)));
    for (const uid of [...this.projectiles]) {
      const p = this.world.byUid.get(uid);
      if (!p || p.destroyed) { this.projectiles.delete(uid); continue; }
      const pr = p.state.projectile;
      for (const t of targets) {
        if (t.uid === pr.owner || t.type === p.type) continue;
        const owner = this.world.byUid.get(pr.owner);
        if (owner && owner.type === t.type) continue; // no friendly fire between same-type shooters
        if (!this.world.overlapping(p, t)) continue;
        const st = t.state.health;
        if (!st) this.breakableDamage(t, pr.damage);
        else if (st.invuln <= 0) {
          st.hp = Math.max(0, st.hp - pr.damage);
          st.invuln = Number(this.world.behavior(t, 'health')?.props.invulnerableTime ?? 0);
          st.hitT = 0.4;
          this.queueTrigger('health.on_damaged', { [t.type]: [t] });
          this.queueTrigger('health.on_healed', { [t.type]: [t] });
          if (st.hp <= 0) { st.dead = true; this.queueTrigger('health.on_died', { [t.type]: [t] }); }
        }
        this.queueTrigger('combat.on_hit', { [t.type]: [t] });
        this.world.destroy(p);
        this.projectiles.delete(uid);
        break;
      }
    }
  }

  private stepCamera() {
    if (this.wallTime < this.camera.shakeUntil) {
      const k = this.camera.shakeIntensity;
      this.camera.offset = [(this.rng.next() * 2 - 1) * k, (this.rng.next() * 2 - 1) * k, (this.rng.next() * 2 - 1) * k * 0.5];
    } else this.camera.offset = [0, 0, 0];
  }

  private stepParticles(dt: number) {
    for (const [id, e] of this.emitters) {
      if (e.attachedUid != null) {
        const inst = this.world.byUid.get(e.attachedUid);
        if (inst && !inst.destroyed) {
          const [x, y, z] = this.world.worldPos(inst);
          e.position = [x, y, z];
          e.heading = this.world.angle(inst);
        }
      }
      e.update(dt);
      if (e.autoRemove && e.done) this.emitters.delete(id);
    }
  }

  /** Characters with animation roles: start the keyframe clip for their current state (idle, walk, jump...). */
  private stepAnimRoles() {
    for (const inst of this.world.instances) {
      const roles = inst.animRoles;
      if (!roles || inst.destroyed) continue;
      // An object no behavior animates (a prop, a vehicle) is idle, so its Idle role plays.
      const state = inst.animation ?? 'idle';
      const want = roles[state] ?? (state === 'run' ? roles.walk : state === 'fall' ? roles.jump : undefined);
      const cur = this.clips.get(inst.uid);
      const fromRole = cur && Object.values(roles).includes(cur.name) && inst.state.roleClip === cur.name;
      if (cur && !fromRole) continue; // a clip started by "Play animation" wins
      if (cur?.name === want) continue;
      if (cur) { for (const [k, v] of Object.entries(cur.base)) this.setProp(inst, k, v); this.clips.delete(inst.uid); inst.state.roleClip = undefined; }
      const clip = want ? this.scene.animations?.find((c) => c.name === want) : undefined;
      if (!clip) continue;
      const base: Record<string, number> = {};
      for (const tr of clip.tracks) base[tr.property] = this.settable(inst, tr.property);
      this.clips.set(inst.uid, { name: clip.name, t: 0, loop: clip.loop, base });
      inst.state.roleClip = clip.name;
    }
  }

  private stepTweens(dt: number) {
    this.stepAnimRoles();
    for (const tw of this.tweens) {
      tw.t = Math.min(tw.dur, tw.t + dt);
      const k = ease(tw.ease, tw.dur <= 0 ? 1 : tw.t / tw.dur);
      this.setProp(tw.inst, tw.prop, tw.from + (tw.to - tw.from) * k);
    }
    this.tweens = this.tweens.filter((t) => t.t < t.dur && !t.inst.destroyed);
    for (const [uid, pl] of this.clips) {
      const inst = this.world.byUid.get(uid);
      const clip = this.scene.animations?.find((c) => c.name === pl.name);
      if (!inst || inst.destroyed || !clip) { this.clips.delete(uid); continue; }
      pl.t += dt;
      let finished = false;
      if (pl.t >= clip.duration) { if (pl.loop) pl.t %= Math.max(1e-6, clip.duration); else { pl.t = clip.duration; finished = true; } }
      for (const tr of clip.tracks) this.setProp(inst, tr.property, (pl.base[tr.property] ?? 0) + sampleTrack(tr.keys, pl.t));
      if (finished) {
        this.clips.delete(uid);
        inst.animation = undefined;
        this.queueTrigger('anim.on_finished', { [inst.type]: [inst] }, { name: pl.name });
      }
    }
    // Renderer-driven (glTF / sprite) animations report completion through animFinished.
    for (const inst of this.world.instances) {
      if (inst.animFinished) { inst.animFinished = false; this.queueTrigger('anim.on_finished', { [inst.type]: [inst] }, { name: inst.animation }); }
      const at = inst.state.animTimer;
      if (at && !this.clips.has(inst.uid)) { at.left -= dt; if (at.left <= 0) { delete inst.state.animTimer; this.queueTrigger('anim.on_finished', { [inst.type]: [inst] }, { name: at.name }); } }
    }
  }

  private detectCollisions() {
    if (!this.collisionPairs.length) return;
    const now = new Set<string>();
    const pairs = this.collisionPairs;
    for (let pi = 0; pi < pairs.length; pi++) {
      const pr = pairs[pi];
      const as = this.world.of(pr.a), bs = this.world.of(pr.b);
      for (const a of as) for (const b of bs) {
        if (a === b) continue;
        if (pr.trigger && !b.collider.isTrigger) continue;
        if (!this.world.layersCollide(a, b)) continue; // layer masks filter events too
        if (!this.world.overlapping(a, b)) continue;
        const key = `${pi}:${a.uid}:${b.uid}`;
        now.add(key);
        if (!this.overlaps.has(key)) this.firePairTrigger(pr.trigger ? 'object.on_trigger_enter' : 'object.on_collision', a, b);
      }
    }
    for (const k of this.overlaps) {
      if (now.has(k)) continue;
      const [pi, au, bu] = k.split(':').map(Number);
      const pr = pairs[pi];
      const a = this.world.byUid.get(au), b = this.world.byUid.get(bu);
      if (pr && !pr.trigger && a && b) this.firePairTrigger('object.on_collision_end', a, b);
    }
    this.overlaps = now;
  }

  private firePairTrigger(blockId: string, a: RInstance, b: RInstance) {
    this.fireTrigger(blockId, null, (cond, ctx) => {
      if (!cond.target || cond.target.toLowerCase() !== a.type.toLowerCase()) return false;
      if (String(cond.params.other).toLowerCase() !== b.type.toLowerCase()) return false;
      if (a.destroyed || b.destroyed) return false;
      ctx.sol.set(a.type.toLowerCase(), [a]);
      if (a.type.toLowerCase() !== b.type.toLowerCase()) ctx.sol.set(b.type.toLowerCase(), [b]);
      return true;
    });
  }

  /** Device of the last input, as of the previous tick (for "On input device changed"). */
  private lastDevice = '';
  private lastConnected: boolean[] | null = null;
  /** Active input contexts (doc.inputContexts); all of them at the start. */
  activeContexts: Set<string> | null = null;

  /**
   * Text objects with {Action} placeholders ("Press {Jump} to start") show the buttons of the device in use. The text
   * as written is kept in state (a block that changes the text gives a new one).
   */
  private updatePromptTexts() {
    for (const i of this.world.instances) {
      if (i.kind !== 'text' || !i.text || i.destroyed) continue;
      const st = i.state as { promptTpl?: string; promptOut?: string };
      if (i.text.text !== st.promptOut) { st.promptTpl = /\{[A-Za-z]/.test(i.text.text) ? i.text.text : undefined; st.promptOut = undefined; }
      if (!st.promptTpl) continue;
      const out = this.fillPrompts(st.promptTpl);
      if (out !== i.text.text) i.text = { ...i.text, text: out };
      st.promptOut = out;
    }
  }

  private fireInputTriggers() {
    const inp = this.input;
    inp.track(Object.values(this.doc.inputActions ?? DEFAULT_ACTIONS).flat());
    // Each local player's own stick bindings (their pad: "axis2:LeftX-", their profile's sticks).
    if (this.doc.inputPlayers) for (const p of [1, 2, 3, 4]) {
      const prof = this.playerProfile(p);
      inp.track(playerDeviceBindings(Object.values({ ...(this.doc.inputActions ?? DEFAULT_ACTIONS), ...(prof ? this.doc.inputProfiles?.[prof] : undefined) }).flat(), this.playerInput(p).device));
    }
    if (this.lastDevice && inp.device !== this.lastDevice) this.fireTrigger('input.on_device_changed', null, (c) => !c.params.device || c.params.device === 'any' || c.params.device === inp.device);
    this.lastDevice = inp.device;
    this.updatePromptTexts();
    // Devices plugged in / out: gamepads 1–4 and the VR headset.
    const now = [...inp.pads.map((p) => p.connected), inp.xr.active];
    if (this.lastConnected) now.forEach((on, k) => {
      if (on === this.lastConnected![k]) return;
      const dev = k < 4 ? 'gamepad' : 'vr', which = k < 4 ? k + 1 : 0;
      this.fireTrigger(on ? 'input.on_device_connected' : 'input.on_device_disconnected', null, (c) => {
        const want = String(c.params.device ?? 'any');
        return want === 'any' || want === dev || want === `gamepad ${which}`;
      });
    });
    this.lastConnected = now;
    // Touch gestures and touched objects (TouchController), and pinch zoom on the camera when the layout asks for it.
    const gestures = [...inp.touch.gestures, ...(inp.touch.taps ? ['tap'] : []), ...(inp.touch.pinch ? ['pinch'] : []), ...(inp.touch.pan[0] || inp.touch.pan[1] ? ['twofingerpan'] : [])];
    for (const g of gestures) this.fireTrigger('touch.on_gesture', null, (c) => String(c.params.gesture ?? 'double tap').replace(/[\s-]/g, '') === g);
    for (const o of inp.touch.objects) { const inst = this.world.byUid.get(o.uid); if (inst) this.fireObjectTrigger('touch.on_object', inst, { touchState: o.state }); }
    if (inp.touch.pinch && this.doc.touchControls?.pinchZoom) this.camera.zoom = Math.max(0.25, Math.min(4, this.camera.zoom * (1 + inp.touch.pinch)));
    // An open conversation takes Space / Enter (continue) and 1-9 (choices) before key triggers see them.
    const used = new Set<string>();
    if (this.dialogue) {
      for (const k of inp.pressed) {
        // (A line still being typed out: the key shows the rest of it first.)
        const typed = this.dialogueHold?.(k) ?? false;
        if (typed) { used.add(k); continue; }
        if (this.dialogue?.canContinue && (keyMatch('Space', k) || keyMatch('Enter', k))) { this.dialogueContinue(); used.add(k); continue; }
        for (let n = 1; n <= 9; n++) if (this.dialogue && keyMatch(String(n), k)) { this.dialogueChoose(n); used.add(k); }
      }
    }
    for (const k of inp.pressed) if (!used.has(k)) this.fireTrigger('input.on_key_pressed', null, (c) => keyMatch(c.params.key, k));
    for (const k of inp.released) this.fireTrigger('input.on_key_released', null, (c) => keyMatch(c.params.key, k));
    for (const btn of inp.clicks) this.fireTrigger('input.on_mouse_click', null, (c) => String(c.params.button ?? 'left') === btn);
    for (const btn of inp.mouseReleased) this.fireTrigger('input.on_mouse_released', null, (c) => String(c.params.button ?? 'left') === btn);
    for (const uid of inp.clickedUids) { const inst = this.world.byUid.get(uid); if (inst) this.fireObjectTrigger('object.on_clicked', inst); }
    for (const name of inp.uiButtons) {
      if (name === '__restart__') { this.requestRestart(); continue; }
      this.fireTrigger('ui.on_button_clicked', null, (c) => String(c.params.button).toLowerCase() === name.toLowerCase());
    }
  }

  // ------------------------------------------------------------ triggers
  queueTrigger(blockId: string, picks: Record<string, any[]>, data?: any) {
    if (!this.hasTriggerListeners(blockId)) return;
    if (this.inEvents) this.dispatchPicked(blockId, picks, data);
    else this.pending.push({ blockId, picks, data });
  }

  private flushPending() {
    let guard = 0;
    while (this.pending.length && guard++ < 1000) {
      const p = this.pending.shift()!;
      this.dispatchPicked(p.blockId, p.picks, p.data);
    }
  }

  private dispatchPicked(blockId: string, picks: Record<string, any[]>, data?: any) {
    const entries = Object.entries(picks);
    this.fireTrigger(blockId, null, (cond, ctx) => {
      if (cond.target) {
        const e = entries.find(([t]) => t.toLowerCase() === cond.target!.toLowerCase());
        if (!e) return false;
        const alive = e[1].filter((i: RInstance) => !i.destroyed || blockId === 'object.on_destroyed');
        if (!alive.length) return false;
        ctx.sol.set(e[0].toLowerCase(), alive);
      }
      if (data?.tag != null && cond.params.tag != null && String(cond.params.tag) !== String(data.tag)) return false;
      if (data?.name != null && cond.params.name != null && String(cond.params.name) !== String(data.name)) return false;
      if (data?.touchState != null && String(cond.params.state ?? 'touched').replace(/[\s-]/g, '') !== data.touchState) return false;
      return true;
    }, data);
  }

  fireObjectTrigger(blockId: string, inst: RInstance, data?: any) {
    this.dispatchPicked(blockId, { [inst.type]: [inst] }, data);
  }

  hasTriggerListeners(blockId: string): boolean {
    for (const n of this.sheetEvents) if (this.triggerIndex.get(n.id)?.has(blockId)) return true;
    return false;
  }

  /** Run every event whose first condition is the trigger `blockId` and whose matcher accepts it. */
  fireTrigger(blockId: string, base: Ctx | null, match?: (cond: BlockInstance, ctx: Ctx) => boolean, data?: any): boolean {
    if (!this.hasTriggerListeners(blockId)) return false;
    if (this.triggerDepth > MAX_TRIGGER_DEPTH) { this.report('error', `Trigger "${blockId}" nested too deeply (possible infinite recursion).`); return false; }
    this.triggerDepth++;
    const wasIn = this.inEvents;
    this.inEvents = true;
    let any = false;
    try { any = this.dispatch(this.sheetEvents, base ?? this.baseCtx(), blockId, match, data); }
    finally { this.triggerDepth--; this.inEvents = wasIn; }
    return any;
  }

  private dispatch(nodes: EventNode[], ctx: Ctx, blockId: string, match?: (c: BlockInstance, ctx: Ctx) => boolean, data?: any): boolean {
    let any = false;
    for (const n of nodes) {
      if (!this.triggerIndex.get(n.id)?.has(blockId)) continue;
      if (n.kind === 'group') { if (n.active) any = this.dispatch(n.children, ctx, blockId, match, data) || any; continue; }
      if (n.kind !== 'event' || n.disabled || n.loose) continue;
      const firstIdx = n.conditions.findIndex((c) => !c.disabled);
      const first = n.conditions[firstIdx];
      if (first && BLOCK_DEFS[first.block]?.trigger) {
        if (first.block !== blockId) continue;
        const c = this.childCtx(ctx, n);
        c.triggerData = data;
        if (match && !this.safe(() => match(first, c), n, first)) continue;
        this.mark(n);
        if (this.runFrom(n, c, firstIdx + 1)) any = true;
      } else {
        // A trigger nested in sub-events: parent conditions must pass first (no actions are run).
        const c = this.childCtx(ctx, n);
        let ok = true;
        for (const cond of n.conditions) {
          if (cond.disabled || BLOCK_DEFS[cond.block]?.looping) continue;
          if (!this.evalCondition(cond, c, n)) { ok = false; break; }
        }
        if (ok) any = this.dispatch(n.children, c, blockId, match, data) || any;
      }
    }
    return any;
  }

  // ------------------------------------------------------------ events
  baseCtx(): Ctx { return { sol: new Map(), scopes: [], loops: [] }; }

  childCtx(parent: Ctx, ev?: EventBlock): Ctx {
    const c: Ctx = { sol: new Map(parent.sol), scopes: [...parent.scopes], loops: parent.loops, fn: parent.fn, triggerData: parent.triggerData, event: ev };
    if (ev?.locals?.length) {
      const scope: Record<string, any> = {};
      for (const v of ev.locals) {
        const key = `${ev.id}:${v.name}`;
        if (v.isStatic) { if (!this.staticLocals.has(key)) this.staticLocals.set(key, deepClone(v.value)); scope[v.name] = this.staticLocals.get(key); Object.defineProperty(scope, '__static_' + v.name, { value: key, enumerable: false }); }
        else scope[v.name] = deepClone(v.value);
      }
      c.scopes.push(scope);
    }
    return c;
  }

  runNodes(nodes: EventNode[], ctx: Ctx) {
    let lastRan = true;
    let lastWasEvent = false;
    for (const n of nodes) {
      if (n.kind === 'comment') continue;
      if (n.kind === 'group') { if (n.active) this.runNodes(n.children, ctx); lastWasEvent = false; continue; }
      if (n.loose) continue; // loose canvas blocks never run and do not break else-chains
      if (n.disabled) { lastWasEvent = true; lastRan = false; continue; }
      const first = n.conditions.find((c) => !c.disabled);
      if (first && BLOCK_DEFS[first.block]?.trigger) { lastWasEvent = true; lastRan = false; continue; }
      if (n.isElse) {
        if (lastWasEvent && lastRan) { lastWasEvent = true; continue; } // chain already ran
        const ran = this.runEvent(n, ctx);
        lastRan = ran;
      } else {
        lastRan = this.runEvent(n, ctx);
      }
      lastWasEvent = true;
    }
  }

  runEvent(ev: EventBlock, parent: Ctx): boolean {
    if (ev.breakpoint && this.breakpointsEnabled) {
      if (this.skipBreakpointOnce === ev.id) this.skipBreakpointOnce = null;
      else {
        // Pauses before the event runs; the rest of this tick is skipped and resuming starts a new tick.
        this.pausedAtBreakpoint = ev.id;
        this.opts.host?.onBreakpoint?.(ev.id);
        throw new Error('__breakpoint__');
      }
    }
    const ctx = this.childCtx(parent, ev);
    return this.runFrom(ev, ctx, 0);
  }

  /** Continue after a breakpoint pause (the breakpoint is skipped once). */
  resumeFromBreakpoint() {
    if (!this.pausedAtBreakpoint) return;
    this.skipBreakpointOnce = this.pausedAtBreakpoint;
    this.pausedAtBreakpoint = null;
  }
  skipBreakpointOnce: string | null = null;

  private mark(ev: EventBlock) { if (this.traceEnabled) this.trace.add(ev.id); }

  runFrom(ev: EventBlock, ctx: Ctx, ci: number): boolean {
    this.budget();
    if (ev.isOr && ci === 0) return this.runOr(ev, ctx);
    for (let i = ci; i < ev.conditions.length; i++) {
      const cond = ev.conditions[i];
      if (cond.disabled) continue;
      const def = BLOCK_DEFS[cond.block];
      if (!def) { this.unsupported(cond, ev); return false; }
      if (def.trigger) continue; // already matched by dispatch
      if (def.looping) {
        const loop = LOOPS[cond.block];
        if (!loop) { this.unsupported(cond, ev); return false; }
        let ran = false;
        this.safe(() => loop(this, cond, ctx, (iter) => { if (this.runFrom(ev, iter, i + 1)) ran = true; }), ev, cond);
        return ran;
      }
      if (!this.evalCondition(cond, ctx, ev)) return false;
    }
    this.mark(ev);
    this.runActions(ev, ctx, 0);
    return true;
  }

  private runOr(ev: EventBlock, ctx: Ctx): boolean {
    // OR block: passes if any condition passes; picks the union of instances picked by passing conditions.
    let any = false;
    const union = new Map<string, Set<RInstance>>();
    for (const cond of ev.conditions) {
      if (cond.disabled || BLOCK_DEFS[cond.block]?.trigger) continue;
      const c: Ctx = { ...ctx, sol: new Map(ctx.sol) };
      if (this.evalCondition(cond, c, ev)) {
        any = true;
        for (const [k, v] of c.sol) { if (ctx.sol.get(k) === v) continue; let s = union.get(k); if (!s) union.set(k, (s = new Set())); v.forEach((i) => s!.add(i)); }
      }
    }
    if (!any) return false;
    for (const [k, s] of union) ctx.sol.set(k, [...s]);
    this.mark(ev);
    this.runActions(ev, ctx, 0);
    return true;
  }

  runActions(ev: EventBlock, ctx: Ctx, from: number) {
    for (let i = from; i < ev.actions.length; i++) {
      const act = ev.actions[i];
      if (act.disabled) continue;
      if (act.block === 'system.wait') {
        const secs = toNum(this.safe(() => this.param(act, 'seconds', ctx), ev, act) ?? 0);
        const saved: Ctx = { ...ctx, sol: new Map(ctx.sol), loops: ctx.loops.map((l) => ({ ...l })) };
        this.waits.push({ at: this.time + Math.max(0, secs), run: () => this.runActions(ev, saved, i + 1) });
        return;
      }
      if (act.block === 'system.wait_until') {
        // Continue now if already true, otherwise every frame until the expression becomes true.
        const saved: Ctx = { ...ctx, sol: new Map(ctx.sol), loops: ctx.loops.map((l) => ({ ...l })) };
        const test = () => truthy(this.safe(() => this.evaluate(String(act.params.condition ?? 'true'), saved), ev, act));
        if (test()) continue;
        this.waits.push({ at: this.time, until: test, run: () => this.runActions(ev, saved, i + 1) });
        return;
      }
      if (act.block === 'dialogue.start' && act.params.wait) {
        // "and wait": the remaining actions run once the conversation ends.
        const saved: Ctx = { ...ctx, sol: new Map(ctx.sol), loops: ctx.loops.map((l) => ({ ...l })) };
        this.execAction(act, ctx, ev);
        if (!this.dialogue) continue;
        const st = this.dialogue;
        this.waits.push({ at: this.time, until: () => !this.dialogue || this.dialogue.dialogue !== st.dialogue, run: () => this.runActions(ev, saved, i + 1) });
        return;
      }
      if (act.block === 'video.play' && act.params.wait) {
        // "and wait": the remaining actions run when this video ends (finished, skipped or stopped).
        const saved: Ctx = { ...ctx, sol: new Map(ctx.sol), loops: ctx.loops.map((l) => ({ ...l })) };
        this.execAction(act, ctx, ev);
        const v = this.ui.video;
        if (!v) continue;
        this.waits.push({ at: this.time, until: () => this.ui.video !== v, run: () => this.runActions(ev, saved, i + 1) });
        return;
      }
      if (act.block === 'ui.ask') {
        // Show the question; the host fills ui.ask.answer when the player presses Enter.
        const saved: Ctx = { ...ctx, sol: new Map(ctx.sol), loops: ctx.loops.map((l) => ({ ...l })) };
        const ask = { question: toStr(this.safe(() => this.param(act, 'question', ctx), ev, act) ?? ''), answer: undefined as string | undefined };
        this.ui.ask = ask;
        this.waits.push({ at: this.time, until: () => ask.answer !== undefined, run: () => {
          if (this.ui.ask === ask) this.ui.ask = null;
          const name = String(act.params.variable || 'answer');
          if (!this.findVar(name, saved)) this.globals[name] = ''; // like Scratch's built-in "answer"
          this.safe(() => this.setVar(name, ask.answer, saved), ev, act);
          this.runActions(ev, saved, i + 1);
        } });
        return;
      }
      this.execAction(act, ctx, ev);
      if (this.halted) return;
    }
    if (ev.children.length) this.runNodes(ev.children, ctx);
  }

  private runWaits() {
    if (!this.waits.length) return;
    const isDue = (w: (typeof this.waits)[number]) => (w.until ? w.until() : w.at <= this.time + 1e-9);
    const due = this.waits.filter(isDue);
    if (!due.length) return;
    this.waits = this.waits.filter((w) => !due.includes(w));
    this.inEvents = true;
    for (const w of due) w.run();
    this.inEvents = false;
  }

  get pendingWaits() { return this.waits.length; }

  evalCondition(cond: BlockInstance, ctx: Ctx, ev?: EventBlock): boolean {
    this.budget();
    const def = BLOCK_DEFS[cond.block];
    const impl = CONDITIONS[cond.block];
    if (!def || !impl) { this.unsupported(cond, ev); return false; }
    return !!this.safe(() => {
      if (def.target === 'object') {
        const type = cond.target ?? '';
        if (!this.world.typeExists(type)) throw new BlockError(`Object type "${type}" does not exist`);
        const candidates = this.picked(ctx, type);
        if (impl.pick) {
          const out = impl.pick(this, cond, ctx, candidates);
          const res = cond.invert ? candidates.filter((c) => !out.includes(c)) : out;
          ctx.sol.set(type.toLowerCase(), res);
          return res.length > 0;
        }
        ctx.pickAdd = undefined;
        const add = new Map<string, Set<RInstance>>();
        const out: RInstance[] = [];
        for (const inst of candidates) {
          ctx.self = inst;
          ctx.pickAdd = cond.invert ? undefined : add;
          const r = !!impl.test!(this, cond, ctx, inst);
          if (r !== !!cond.invert) out.push(inst);
        }
        ctx.self = undefined;
        ctx.pickAdd = undefined;
        ctx.sol.set(type.toLowerCase(), out);
        if (out.length) for (const [k, s] of add) if (k !== type.toLowerCase()) ctx.sol.set(k, [...s]);
        return out.length > 0;
      }
      const r = !!impl.test!(this, cond, ctx, undefined);
      return cond.invert ? !r : r;
    }, ev, cond);
  }

  execAction(act: BlockInstance, ctx: Ctx, ev?: EventBlock) {
    this.budget();
    const def = BLOCK_DEFS[act.block];
    const impl = ACTIONS[act.block];
    if (!def || !impl) { this.unsupported(act, ev); return; }
    if (!def.apps.includes(this.opts.app) && !APP_TOLERANT.has(act.block)) {
      // App-specific block: state is still updated where possible but report once.
      this.reportOnce(`"${def.name}" is a ${def.apps.join('/')} block; it has no visible effect in ${this.opts.app}.`, ev, act);
    }
    this.safe(() => {
      if (def.target === 'object') {
        const type = act.target ?? '';
        if (!this.world.typeExists(type)) throw new BlockError(`Object type "${type}" does not exist`);
        const list = this.picked(ctx, type);
        for (const inst of list) {
          if (inst.destroyed && act.block !== 'object.destroy') continue;
          ctx.self = inst;
          impl(this, act, ctx, inst);
          this.budget();
        }
        ctx.self = undefined;
      } else impl(this, act, ctx, undefined);
    }, ev, act);
  }

  picked(ctx: Ctx, type: string): RInstance[] {
    const l = ctx.sol.get(type.toLowerCase());
    return (l ?? this.world.of(type)).filter((i) => !i.destroyed);
  }

  private budget() {
    if (++this.ops > this.maxOps) throw new RuntimeLimitError(`Stopped: more than ${this.maxOps.toLocaleString()} operations in one tick. Check Repeat/While loops for infinite loops.`);
  }

  private safe<T>(fn: () => T, ev?: EventBlock, b?: BlockInstance): T | undefined {
    try { return fn(); }
    catch (e: any) {
      if (e instanceof RuntimeLimitError || e?.message === '__breakpoint__') throw e;
      this.reportOnce(e?.message ?? String(e), ev, b);
      return undefined;
    }
  }

  private reported = new Map<string, number>();
  reportOnce(message: string, ev?: EventBlock, b?: BlockInstance) {
    const key = `${b?.id}|${message}`;
    const last = this.reported.get(key);
    if (last != null && this.wallTime - last < 2) return;
    this.reported.set(key, this.wallTime);
    this.report('error', message, ev?.id, b?.id);
  }

  report(level: 'info' | 'warn' | 'error', message: string, eventId?: string, blockId?: string) {
    if (level === 'error') this.errors.push({ message, eventId, blockId, time: this.time });
    if (this.errors.length > 200) this.errors.shift();
    this.log.push({ level, message, time: this.time });
    if (this.log.length > 500) this.log.shift();
    this.opts.host?.log?.(level, message, { eventId, blockId });
  }

  private unsupported(b: BlockInstance, ev?: EventBlock) {
    this.reportOnce(`Block "${b.block}" is not supported by ${this.opts.app}; it was kept but skipped.`, ev, b);
  }

  // ------------------------------------------------------------ expressions
  param(b: BlockInstance, name: string, ctx: Ctx): any {
    const def = BLOCK_DEFS[b.block];
    const pd = def?.params.find((p) => p.name === name);
    const raw = b.params[name] ?? pd?.default ?? '';
    if (!pd || pd.type !== 'expr') return raw;
    if (raw === '' || raw == null) return name === 'args' ? '' : 0;
    return this.evaluate(raw, ctx);
  }

  evaluate(src: string | number | boolean, ctx: Ctx): any {
    let e;
    try { e = parseExpr(src); } catch (err: any) { throw new BlockError(`Expression error in "${src}": ${err.message}`); }
    return evalExpr(e, this.exprCtx(ctx));
  }

  exprCtx(ctx: Ctx): ExprContext {
    return {
      rng: () => this.rng.next(),
      ident: (name) => this.ident(name, ctx),
      member: (path) => this.member(path, ctx),
      call: (name, args) => this.call(name, args, ctx),
    };
  }

  private ident(name: string, ctx: Ctx): any {
    const l = name.toLowerCase();
    switch (l) {
      case 'dt': return this.dtScaled;
      case 'time': return this.time;
      case 'wallclocktime': return this.wallTime;
      case 'tickcount': return this.tickCount;
      case 'randomseed': return this.seedValue;
      case 'inputdevice': return this.input.device;
      // Get movement / look vector: the same numbers from keys, sticks, touch and VR.
      // Touch: fingers on the screen, the first finger's position (screen pixels), pinch / pan this tick, last swipe speed.
      case 'touchcount': return this.input.touch.points.size;
      case 'touchx': return [...this.input.touch.points.values()][0]?.x ?? 0;
      case 'touchy': return [...this.input.touch.points.values()][0]?.y ?? 0;
      case 'pinch': return this.input.touch.pinch;
      case 'panx': return this.input.touch.pan[0];
      case 'pany': return this.input.touch.pan[1];
      case 'swipespeed': return this.input.touch.swipeSpeed;
      case 'movex': return this.moveVector()[0];
      case 'movey': return this.moveVector()[1];
      case 'lookx': return this.lookVector()[0];
      case 'looky': return this.lookVector()[1];
      case 'inputdevicetype': return this.input.device === 'mouse' ? 'keyboard' : this.input.device;
      case 'timescale': return this.timeScale;
      case 'pi': return Math.PI;
      case 'loopindex': return ctx.loops.length ? ctx.loops[ctx.loops.length - 1].index : 0;
      case 'fps': return Math.round(1 / this.dt);
      case 'scenename': return this.scene.name;
      case 'previousscene': return this.previousScene;
      case 'scenedata': return this.sceneData;
      case 'dialogueactive': return this.dialogue ? 1 : 0;
      case 'dialoguespeaker': return this.dialogue?.speaker ?? '';
    }
    const ref = this.findVar(name, ctx);
    if (ref) return ref.scope[ref.key];
    throw new ExprError(`Unknown variable "${name}"`);
  }

  findVar(name: string, ctx: Ctx): { scope: Record<string, any>; key: string; isGlobal: boolean } | null {
    for (let i = ctx.scopes.length - 1; i >= 0; i--) {
      const s = ctx.scopes[i];
      if (name in s) return { scope: s, key: name, isGlobal: false };
    }
    if (name in this.globals) return { scope: this.globals, key: name, isGlobal: true };
    const l = name.toLowerCase();
    for (let i = ctx.scopes.length - 1; i >= 0; i--) { const k = Object.keys(ctx.scopes[i]).find((k) => k.toLowerCase() === l); if (k) return { scope: ctx.scopes[i], key: k, isGlobal: false }; }
    const gk = Object.keys(this.globals).find((k) => k.toLowerCase() === l);
    if (gk) return { scope: this.globals, key: gk, isGlobal: true };
    return null;
  }

  setVar(name: string, value: any, ctx: Ctx) {
    const ref = this.findVar(name, ctx);
    if (!ref) throw new BlockError(`Unknown variable "${name}". Add it as a global or local variable first.`);
    if (ref.isGlobal && this.globalDefs.get(ref.key)?.isConstant) throw new BlockError(`"${ref.key}" is a constant`);
    const old = ref.scope[ref.key];
    const def = ref.isGlobal ? this.globalDefs.get(ref.key) : undefined;
    let v = value;
    const type = def?.type ?? (typeof old === 'number' ? 'number' : typeof old === 'string' ? 'string' : typeof old === 'boolean' ? 'boolean' : undefined);
    if (type === 'number') v = toNum(value); else if (type === 'string') v = toStr(value); else if (type === 'boolean') v = !!value && value !== 0 && value !== 'false';
    ref.scope[ref.key] = v;
    const staticKey = (ref.scope as any)['__static_' + ref.key];
    if (staticKey) this.staticLocals.set(staticKey, v);
    if (ref.isGlobal && old !== v && (typeof v !== 'object')) {
      this.fireTrigger('var.on_changed', null, (c) => String(c.params.variable) === ref.key);
    }
  }

  private member(path: string[], ctx: Ctx): any {
    const head = path[0];
    const hl = head.toLowerCase();
    if (hl === 'mouse') {
      const m = this.input.mouse; const k = (path[1] ?? '').toLowerCase();
      return k === 'x' ? m.x : k === 'y' ? m.y : k === 'z' ? m.z : k === 'screenx' ? m.screenX : k === 'screeny' ? m.screenY : 0;
    }
    if (hl === 'microphone' && !this.world.typeExists(head)) { const k = (path[1] ?? '').toLowerCase(); return k === 'level' ? mic.level : k === 'ison' ? (mic.state === 'on' ? 1 : 0) : 0; }
    if (hl === 'webcam' && !this.world.typeExists(head)) { const k = (path[1] ?? '').toLowerCase(); return k === 'motion' ? webcam.motion : k === 'brightness' ? webcam.brightness : k === 'ison' ? (webcam.state === 'on' ? 1 : 0) : 0; }
    if (hl === 'camera') {
      const c = this.activeCamera(); const k = (path[1] ?? '').toLowerCase();
      if (k === 'zoom') return this.camera.zoom;
      if (k === 'viewnumber') return this.world.instances.filter((x) => !x.destroyed && x.camera).sort((a, b) => a.uid - b.uid).findIndex((x) => x.camera?.active) + 1;
      return c ? this.prop(c, path[1], path[2]) : 0;
    }
    if (hl === 'function' && (path[1] ?? '').toLowerCase() === 'returnvalue') return ctx.fn?.ret ?? 0;
    // Input.Horizontal, Input.Vertical, Input.LeftX … (-1..1), Input.GamepadConnected.
    if (hl === 'input' && !this.world.typeExists('Input')) { const k = (path[1] ?? '').toLowerCase(); return k === 'gamepadconnected' ? (this.input.pad.connected ? 1 : 0) : this.input.axis(k); }
    let inst: RInstance | undefined;
    if (hl === 'self') {
      inst = ctx.self;
      if (!inst) throw new ExprError('"Self" can only be used in a condition or action that has an object');
    } else {
      if (!this.world.typeExists(head)) throw new ExprError(`Unknown object "${head}"`);
      const pl = (path[1] ?? '').toLowerCase();
      if (pl === 'count') return this.world.of(head).length;
      if (pl === 'pickedcount') return this.picked(ctx, head).length;
      if (ctx.self && ctx.self.type.toLowerCase() === hl) inst = ctx.self;
      else inst = this.picked(ctx, head)[0];
      if (!inst) return 0;
    }
    if (path.length < 2) return inst.uid;
    return this.prop(inst, path[1], path[2]);
  }

  prop(inst: RInstance, name: string, sub?: string): any {
    const n = name.toLowerCase();
    switch (n) {
      case 'x': return this.world.worldPos(inst)[0];
      case 'y': return this.world.worldPos(inst)[1];
      case 'z': return this.world.worldPos(inst)[2];
      case 'angle': return this.world.angle(inst);
      case 'rotx': return inst.rx; case 'roty': return inst.ry; case 'rotz': return inst.rz;
      case 'scalex': return inst.sx; case 'scaley': return inst.sy; case 'scalez': return inst.sz;
      case 'width': return Math.abs(inst.collider.size[0] * inst.sx);
      case 'height': return Math.abs(inst.collider.size[1] * inst.sy);
      case 'depth': return Math.abs(inst.collider.size[2] * inst.sz);
      case 'opacity': return inst.opacity;
      case 'isvisible': return inst.visible ? 1 : 0;
      case 'uid': return inst.uid;
      case 'iid': return inst.iid;
      case 'vx': return inst.vx; case 'vy': return inst.vy; case 'vz': return inst.vz;
      case 'speed': return Math.hypot(inst.vx, inst.vy, inst.vz);
      case 'submerged': return Number(inst.state.submerged ?? 0);
      case 'waterdepth': return Number(inst.state.waterDepth ?? 0);
      case 'text': return inst.text?.text ?? '';
      case 'animationname': case 'animation': return inst.animation ?? '';
      case 'name': return inst.name;
      case 'objecttypename': case 'type': return inst.type;
      case 'count': return this.world.of(inst.type).length;
    }
    if (name in inst.vars) return inst.vars[name];
    const vk = Object.keys(inst.vars).find((k) => k.toLowerCase() === n);
    if (vk) return inst.vars[vk];
    const b = inst.behaviors.find((bb) => bb.type.toLowerCase() === n || BEHAVIORS[bb.type]?.name.replace(/\s/g, '').toLowerCase() === n);
    if (b) {
      if (!sub) return 1;
      const def = BEHAVIORS[b.type];
      const ek = Object.keys(def?.expressions ?? {}).find((k) => k.toLowerCase() === sub.toLowerCase());
      if (ek) return def!.expressions[ek](inst, this);
      const pk = Object.keys(b.props).find((k) => k.toLowerCase() === sub.toLowerCase());
      if (pk) return b.props[pk];
      throw new ExprError(`${def?.name ?? b.type} has no expression "${sub}"`);
    }
    throw new ExprError(`${inst.type} has no property or instance variable "${name}"`);
  }

  /** The current value in the terms setProp writes: prop() reads a child's position in the world, setProp sets it relative to its parent. */
  settable(inst: RInstance, name: string): number {
    const n = name.toLowerCase();
    return inst.parent != null && (n === 'x' || n === 'y' || n === 'z') ? inst[n] : Number(this.prop(inst, name));
  }

  setProp(inst: RInstance, name: string, v: number) {
    switch (name.toLowerCase()) {
      case 'x': inst.x = v; break; case 'y': inst.y = v; break; case 'z': inst.z = v; break;
      case 'angle': this.world.setAngle(inst, v); break;
      case 'rotx': inst.rx = v; break; case 'roty': inst.ry = v; break; case 'rotz': inst.rz = v; break;
      case 'scalex': inst.sx = v; break; case 'scaley': inst.sy = v; break; case 'scalez': inst.sz = v; break;
      case 'opacity': inst.opacity = Math.max(0, Math.min(100, v)); break;
      case 'vx': inst.vx = v; break; case 'vy': inst.vy = v; break; case 'vz': inst.vz = v; break;
      default: if (name in inst.vars) inst.vars[name] = v;
    }
  }

  private call(name: string, args: any[], ctx: Ctx): any {
    switch (name) {
      case 'loopindex': {
        if (!args.length) return ctx.loops.length ? ctx.loops[ctx.loops.length - 1].index : 0;
        const l = [...ctx.loops].reverse().find((x) => x.name === toStr(args[0]));
        return l ? l.index : 0;
      }
      case 'item': return ctx.loops.length ? ctx.loops[ctx.loops.length - 1].item ?? 0 : 0;
      // prompt("Jump"): the button to show for the device in use ("Space", "A", "Cross", "Jump" on touch);
      // prompt("Jump", 2) for local player 2's device.
      case 'prompt': return this.promptFor(toStr(args[0]), args.length > 1 ? Math.max(1, Math.min(4, Math.round(toNum(args[1])))) : undefined);
      // actionvalue("Gas") for anyone, actionvalue("Gas", 2) for local player 2's own bindings.
      case 'actionvalue': return this.actionValue(toStr(args[0]), args.length > 1 ? Math.max(1, Math.min(4, Math.round(toNum(args[1])))) : undefined);
      case 'param': return ctx.fn?.params[toNum(args[0])] ?? 0;
      case 'call': return this.callFunction(toStr(args[0]), args.slice(1));
      case 'count': return this.world.of(toStr(args[0])).length;
      case 'triggerdata': return ctx.triggerData?.[toStr(args[0])] ?? 0;
    }
    throw new ExprError(`Unknown function "${name}"`);
  }

  callFunction(name: string, params: any[]): any {
    const ctx: Ctx = { ...this.baseCtx(), fn: { name, params, ret: 0 } };
    const found = this.fireTrigger('function.on_function', ctx, (c) => String(c.params.name).toLowerCase() === name.toLowerCase());
    if (!found && !this.hasTriggerListeners('function.on_function')) this.report('warn', `Function "${name}" is not defined`);
    return ctx.fn!.ret;
  }

  // ------------------------------------------------------------ saved games (saveGame.ts)
  /** Save the whole game (scene, globals, game objects) in a slot. */
  saveGame(slot: string): boolean {
    const name = slot.trim() || 'save1';
    try { this.storageSet(SAVE_PREFIX + name, JSON.stringify(snapshotGame(this))); }
    catch (e: any) { this.report('error', `Save game "${name}" failed: ${e?.message ?? e}`); return false; }
    this.queueTrigger('game.on_game_saved', {}, { slot: name });
    return true;
  }
  /** Load a slot: in this scene at once, or switching to the scene it was saved in. */
  loadGame(slot: string): boolean {
    const name = slot.trim() || 'save1', s = parseSave(this.storageGet(SAVE_PREFIX + name));
    if (!s) { this.report('warn', `No saved game in slot "${name}"`); return false; }
    if (s.scene !== this.scene.name && this.opts.sceneNames?.some((n) => n === s.scene)) {
      this.carry = { globals: {}, data: '', from: this.scene.name, load: s };
      this.dialogue = null;
      this.requestRestart(s.scene);
      return true;
    }
    applySave(this, s);
    this.queueTrigger('game.on_game_loaded', {}, { slot: name });
    return true;
  }
  /** Quit game: the host closes the game or stops play; where it can't (a web page), back to the title (restart). */
  quitGame() {
    this.fireTrigger('game.on_scene_end', null, undefined, { name: this.scene.name });
    if (!this.opts.host?.quit?.()) this.requestRestart(null);
  }
  hasSave(slot: string): boolean { return !!parseSave(this.storageGet(SAVE_PREFIX + (slot.trim() || 'save1'))); }
  deleteSave(slot: string) { this.storageSet(SAVE_PREFIX + (slot.trim() || 'save1'), ''); }
  /** When a slot was saved (ms since 1970), 0 if empty. */
  saveTime(slot: string): number { return parseSave(this.storageGet(SAVE_PREFIX + (slot.trim() || 'save1')))?.savedAt ?? 0; }

  // ------------------------------------------------------------ helpers used by blocks
  requestRestart(scene: string | null = null) {
    this.restartRequested = scene;
    this.opts.host?.requestScene?.(scene);
  }

  /**
   * Leave this scene for another (null = restart this one). Fires "On scene end", keeps the chosen global
   * variables, hands `data` to the next scene and fades out first when asked. Unknown scenes are reported and the
   * game stays where it is.
   */
  changeScene(name: string | null, o: { transition?: string; color?: string; picture?: string; cover?: string; duration?: number; keep?: string; data?: any } = {}) {
    if (this.ui.transition?.phase === 'out' && !this.ui.transition.screenOnly) return; // already leaving
    if (name != null && this.opts.sceneNames && !this.opts.sceneNames.some((s) => s.toLowerCase() === name.trim().toLowerCase())) {
      this.report('error', `Scene "${name}" does not exist. Scenes: ${this.opts.sceneNames.join(', ') || 'none'}`);
      this.fireTrigger('game.on_scene_error', null, undefined, { name });
      return;
    }
    const target = name == null ? null : this.opts.sceneNames?.find((s) => s.toLowerCase() === name.trim().toLowerCase()) ?? name;
    this.fireTrigger('game.on_scene_end', null, undefined, { name: target ?? this.scene.name });
    const kind = o.transition ?? 'none';
    const duration = Math.max(0.05, o.duration ?? 0.5);
    const shape = pictureRef(this.doc.pictures, o.picture), cover = pictureRef(this.doc.pictures, o.cover);
    if ((kind === 'shape' || kind === 'map') && o.picture && !shape) this.report('warn', `Transition picture "${o.picture}" is not in the Pictures list`);
    this.carry = { globals: keptGlobals(this, o.keep ?? 'none'), data: o.data ?? '', from: this.scene.name, transition: kind === 'none' ? undefined : { kind, duration, color: o.color, shape, cover } };
    this.dialogue = null;
    // Already covered (Cover screen): switch now; the next scene uncovers.
    if (kind === 'none' || this.ui.transition?.phase === 'hold') { this.requestRestart(target); return; }
    this.ui.transition = { phase: 'out', start: this.wallTime, duration, ...transitionLook(kind, o.color), target, shape, cover };
  }

  /** Cover the screen without changing scene (Cover screen); it stays covered until uncoverScreen. */
  coverScreen(kind: string, duration: number, color?: string, picture?: string, coverPicture?: string) {
    const t = this.ui.transition;
    if (t && (t.phase === 'hold' || (t.phase === 'out' && !t.screenOnly))) return; // already covered / leaving
    this.ui.transition = { phase: 'out', start: this.wallTime - (t?.phase === 'in' ? this.transitionAlpha() * Math.max(0.05, duration) : 0), duration: Math.max(0.05, duration), ...transitionLook(kind, color), screenOnly: true,
      shape: pictureRef(this.doc.pictures, picture), cover: pictureRef(this.doc.pictures, coverPicture) };
  }

  /** Uncover a covered screen (Uncover screen); On transition finished runs when it is clear. */
  uncoverScreen(duration: number) {
    const t = this.ui.transition;
    if (!t || !t.screenOnly || t.phase === 'in') return;
    const d = Math.max(0.05, duration), a = this.transitionAlpha();
    this.ui.transition = { ...t, phase: 'in', duration: d, start: this.wallTime - (1 - a) * d };
  }

  /** 0 = clear, 1 = fully covered by the transition color. */
  transitionAlpha(): number {
    const t = this.ui.transition;
    if (!t) return 0;
    if (t.phase === 'hold') return 1;
    const k = Math.min(1, Math.max(0, (this.wallTime - t.start) / t.duration));
    return t.phase === 'out' ? k : 1 - k;
  }

  dialogueContinue() { continueDialogue(this); }
  dialogueChoose(index: number) { chooseDialogue(this, index); }
  dialogueStart(name: string) { startDialogue(this, name); }

  storageGet(k: string) { return this.opts.host?.storage ? this.opts.host.storage.get(k) : this.storageFallback.get(k) ?? null; }
  storageSet(k: string, v: string) { if (this.opts.host?.storage) this.opts.host.storage.set(k, v); else this.storageFallback.set(k, v); }

  /** Snapshot for the debugger / variable inspector. */
  inspect() {
    return {
      time: this.time, tick: this.tickCount, globals: { ...this.globals },
      instances: this.world.instances.length, emitters: this.emitters.size,
      particles: [...this.emitters.values()].reduce((a, e) => a + e.count, 0),
      waits: this.waits.length, errors: this.errors.length,
    };
  }
}

const APP_TOLERANT = new Set<string>();

function keyMatch(param: any, key: string) {
  const p = String(param ?? '');
  return p === 'Any' || p.toLowerCase() === key.toLowerCase();
}

export function ease(kind: string, t: number): number {
  switch (kind) {
    case 'linear': return t;
    case 'easeIn': return t * t;
    case 'easeOut': return 1 - (1 - t) * (1 - t);
    case 'easeInOut': return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    case 'bounce': {
      const n = 7.5625, d = 2.75;
      if (t < 1 / d) return n * t * t;
      if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75;
      if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375;
      return n * (t -= 2.625 / d) * t + 0.984375;
    }
  }
  return t;
}

export function sampleTrack(keys: { t: number; v: number; ease?: string }[], t: number): number {
  if (!keys.length) return 0;
  if (t <= keys[0].t) return keys[0].v;
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i], b = keys[i + 1];
    if (t <= b.t) { const k = (t - a.t) / Math.max(1e-6, b.t - a.t); return a.v + (b.v - a.v) * ease(b.ease ?? 'linear', k); }
  }
  return keys[keys.length - 1].v;
}

/** Project-defined particle presets (saved from the particle editor) extend the built-in ones. */
export const customParticlePresets = new Map<string, Record<string, any>>();
function PRESET_LOOKUP(name: string): Record<string, any> {
  return customParticlePresets.get(name) ?? PARTICLE_PRESETS[name]?.params ?? PARTICLE_PRESETS.sparks.params;
}

export type { InstanceData };
