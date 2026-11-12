// Input state fed by the host application (DOM events, gamepad polling) or by tests.
// Each kind of input has three distinct states, cleared per fixed tick so "just pressed" fires once:
//   held (down) · just pressed (up → down this tick) · just released (down → up this tick).
export function normalizeKey(key: string): string {
  if (key === ' ' || key === 'Spacebar') return 'Space';
  if (key.length === 1) return key.toUpperCase();
  if (key === 'Esc') return 'Escape';
  return key;
}

/**
 * The key name for a keyboard event, from the physical key where it matters: with Shift held, "1" types "!" and
 * "a" types "A" - using the typed character would miss presses (Shift+1) and leave keys stuck when Shift changes
 * between press and release. Letters, digits, numpad digits and Space come from `code`; everything else from `key`.
 */
export function keyFromEvent(e: { key: string; code?: string }): string {
  const c = e.code ?? '';
  if (/^Key[A-Z]$/.test(c)) return c.slice(3);
  if (/^Digit[0-9]$/.test(c)) return c.slice(5);
  if (/^Numpad[0-9]$/.test(c)) return c.slice(6);
  if (c === 'Space') return 'Space';
  if (c === 'ShiftLeft' || c === 'ShiftRight') return 'Shift';
  if (c === 'ControlLeft' || c === 'ControlRight') return 'Control';
  if (c === 'AltLeft' || c === 'AltRight') return 'Alt';
  return normalizeKey(e.key);
}

export const KEY_CHOICES = [
  'Any', 'Space', 'Enter', 'Escape', 'Shift', 'Control', 'Alt', 'Tab', 'Backspace',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split(''), ...'0123456789'.split(''),
];

/** Standard gamepad layout (W3C "standard" mapping) button names, by index. */
export const PAD_BUTTONS = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'Back', 'Start', 'LeftStick', 'RightStick', 'Up', 'Down', 'Left', 'Right', 'Home'];
export const AXES = ['Horizontal', 'Vertical', 'LeftX', 'LeftY', 'RightX', 'RightY', 'Triggers'];

/** Default input actions (editable per project): action name → bindings ("Space", "mouse:left", "pad:A"). */
export const DEFAULT_ACTIONS: Record<string, string[]> = {
  Jump: ['Space', 'pad:A'], Fire: ['mouse:left', 'pad:RT'], Interact: ['E', 'pad:X'], Sprint: ['Shift', 'pad:LeftStick'],
  Left: ['ArrowLeft', 'A', 'pad:Left'], Right: ['ArrowRight', 'D', 'pad:Right'], Up: ['ArrowUp', 'W', 'pad:Up'], Down: ['ArrowDown', 'S', 'pad:Down'],
  Pause: ['Escape', 'pad:Start'], Reload: ['R', 'pad:Y'],
};

/** The kind of device the player used last (for button prompts and automatic touch controls). */
export type InputDevice = 'keyboard' | 'mouse' | 'gamepad' | 'touch' | 'vr';

/** Which kind of device a binding belongs to. */
export function deviceOf(b: string): InputDevice {
  if (/^(pad\d?|axis\d?):/.test(b)) return 'gamepad';
  if (/^(touch|touchstick|swipe|gesture|touchobj):/.test(b) || b === 'tap') return 'touch';
  if (/^xr(stick)?:/.test(b)) return 'vr';
  if (b.startsWith('mouse:')) return 'mouse';
  return 'keyboard';
}

/** Which button names a gamepad prints (from its browser id). */
export type PadStyle = 'xbox' | 'playstation' | 'nintendo' | 'generic';
export function padStyle(id: string | undefined): PadStyle {
  const s = (id ?? '').toLowerCase();
  if (/054c|playstation|dualshock|dualsense|sony/.test(s)) return 'playstation';
  if (/057e|nintendo|switch|joy-con|pro controller/.test(s)) return 'nintendo';
  if (/045e|xbox|xinput|microsoft/.test(s)) return 'xbox';
  return 'generic';
}
// Standard-mapping positions → each controller's names (Nintendo swaps the face letters: bottom is B).
const PAD_NAMES: Record<PadStyle, Record<string, string>> = {
  xbox: { A: 'A', B: 'B', X: 'X', Y: 'Y', LB: 'LB', RB: 'RB', LT: 'LT', RT: 'RT', Back: 'View', Start: 'Menu', LeftStick: 'LS', RightStick: 'RS', Home: 'Xbox' },
  playstation: { A: 'Cross', B: 'Circle', X: 'Square', Y: 'Triangle', LB: 'L1', RB: 'R1', LT: 'L2', RT: 'R2', Back: 'Share', Start: 'Options', LeftStick: 'L3', RightStick: 'R3', Home: 'PS' },
  nintendo: { A: 'B', B: 'A', X: 'Y', Y: 'X', LB: 'L', RB: 'R', LT: 'ZL', RT: 'ZR', Back: '−', Start: '+', LeftStick: 'L stick', RightStick: 'R stick', Home: 'Home' },
  generic: { A: 'A', B: 'B', X: 'X', Y: 'Y', LB: 'LB', RB: 'RB', LT: 'LT', RT: 'RT', Back: 'Back', Start: 'Start', LeftStick: 'L stick', RightStick: 'R stick', Home: 'Home' },
};
const KEY_NAMES: Record<string, string> = { ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Control: 'Ctrl', Escape: 'Esc' };

/**
 * The button to show for an action on a device ("Press {Jump}"): the first binding of that kind of device, named the
 * way that device prints it (Space, Left click, Cross on a PlayStation pad, B on a Nintendo pad, the touch button's
 * label). Keyboard bindings stand in when the device has none.
 */
export function buttonPrompt(bindings: string[], device: InputDevice, style: PadStyle = 'xbox'): string {
  const kind = (b: string) => deviceOf(b);
  const want = device === 'mouse' ? ['mouse', 'keyboard'] : device === 'keyboard' ? ['keyboard', 'mouse'] : [device, 'keyboard', 'mouse'];
  const pick = want.map((d) => bindings.find((b) => kind(b) === d)).find(Boolean);
  if (!pick) return bindings[0] ?? '';
  const pad = /^pad\d?:(.+)$/.exec(pick);
  if (pad) { const dir = { Up: 'D-pad ↑', Down: 'D-pad ↓', Left: 'D-pad ←', Right: 'D-pad →' }[pad[1]]; return dir ?? PAD_NAMES[style][pad[1]] ?? pad[1]; }
  const ax = /^axis\d?:([A-Za-z]+)([+-])$/.exec(pick);
  if (ax) return /trigger/i.test(ax[1]) ? (ax[2] === '+' ? PAD_NAMES[style].RT : PAD_NAMES[style].LT) : `${/^right/i.test(ax[1]) ? 'Right' : 'Left'} stick ${/y/i.test(ax[1]) ? (ax[2] === '+' ? '↑' : '↓') : ax[2] === '+' ? '→' : '←'}`;
  if (pick.startsWith('mouse:')) return { left: 'Left click', right: 'Right click', middle: 'Middle click' }[pick.slice(6)] ?? pick;
  if (pick.startsWith('touch:')) return pick.slice(6);
  if (pick.startsWith('swipe:')) return `Swipe ${pick.slice(6)}`;
  if (pick === 'tap') return 'Tap';
  const xr = /^xr:(left|right|any):(.+)$/.exec(pick);
  if (xr) return `${xr[1] === 'any' ? '' : xr[1] === 'left' ? 'Left ' : 'Right '}${xr[2]}`;
  return KEY_NAMES[pick] ?? pick;
}

/**
 * A local player's share of an action's bindings: keyboard players keep keys and mouse; a gamepad player keeps only
 * gamepad bindings, pointed at their pad ("pad:A" → "pad2:A", "axis:LeftX-" → "axis2:LeftX-"); 'all' keeps everything.
 */
export function playerDeviceBindings(bs: string[], device: string): string[] {
  if (device === 'all') return bs;
  if (device === 'keyboard') return bs.filter((b) => { const d = deviceOf(b); return d === 'keyboard' || d === 'mouse'; });
  const n = Number(device.slice(7)) || 1;
  return bs.filter((b) => deviceOf(b) === 'gamepad').map((b) => b.replace(/^pad\d?:/, `pad${n}:`).replace(/^axis\d?:/, `axis${n}:`));
}

/** A shareable input profile file (Input editor › Profiles › Export / Import). */
export interface InputProfileFile { format: 'craft.input-profile'; version: 1; name: string; actions: Record<string, string[]>; tuning?: Record<string, import('../schema').ActionTuning> }
/** Read a profile file; a string is the reason it was refused. */
export function parseInputProfile(text: string): InputProfileFile | string {
  try {
    const j = JSON.parse(text);
    if (j?.format !== 'craft.input-profile') return 'Not an input profile file.';
    if (!j.actions || typeof j.actions !== 'object' || Object.values(j.actions).some((v) => !Array.isArray(v) || (v as unknown[]).some((b) => typeof b !== 'string'))) return 'The profile has no valid actions.';
    return { format: 'craft.input-profile', version: 1, name: String(j.name || 'Imported'), actions: j.actions, tuning: j.tuning && typeof j.tuning === 'object' ? j.tuning : undefined };
  } catch { return 'The file is not valid JSON.'; }
}

/** Apply an action's deadzone, response curve and sensitivity to a raw 0..1 value. */
export function tuneValue(v: number, t: { deadzone?: number; curve?: string; sensitivity?: number } | undefined): number {
  if (!t) return v;
  const dz = Math.max(0, Math.min(0.9, t.deadzone ?? 0));
  let x = v <= dz ? 0 : (v - dz) / (1 - dz);
  if (t.curve === 'smooth') x = x * x * (3 - 2 * x);
  else if (t.curve === 'precise') x = x * x;
  else if (t.curve === 'aggressive') x = Math.sqrt(x);
  return x * (t.sensitivity ?? 1);
}

/**
 * Bindings that more than one action uses within the same context (or with no contexts at all), so pressing them
 * would trigger both: binding → the clashing actions.
 */
export function bindingConflicts(actions: Record<string, string[]>, contexts?: Record<string, string[]>): { binding: string; actions: string[] }[] {
  const ctxOf = (a: string) => Object.entries(contexts ?? {}).filter(([, l]) => l.some((x) => x.toLowerCase() === a.toLowerCase())).map(([c]) => c);
  const share = (a: string, b: string) => { const x = ctxOf(a), y = ctxOf(b); return !x.length || !y.length || x.some((c) => y.includes(c)); };
  // Movement-style pairs are deliberate (VR Grab / Release share the grip).
  const PAIRS = new Set(['grab|release']);
  const by = new Map<string, string[]>();
  for (const [a, bs] of Object.entries(actions)) for (const b of new Set(bs)) by.set(b, [...(by.get(b) ?? []), a]);
  const out: { binding: string; actions: string[] }[] = [];
  for (const [b, as] of by) {
    const clash = as.filter((a) => as.some((o) => o !== a && share(a, o) && !PAIRS.has([a, o].map((s) => s.toLowerCase()).sort().join('|'))));
    if (clash.length > 1) out.push({ binding: b, actions: clash });
  }
  return out;
}

export class InputState {
  /** Device of the most recent input. */
  device: InputDevice = 'keyboard';
  /** On-screen touch controls: held / just pressed / just released virtual buttons, the virtual stick, swipes, taps. */
  touch = {
    down: new Set<string>(), pressed: new Set<string>(), released: new Set<string>(), stick: [0, 0] as [number, number], look: [0, 0] as [number, number], swipes: [] as string[], taps: 0,
    /** Gestures this tick: doubletap, longpress, dragstart, dragend (bindings "gesture:<name>"). */
    gestures: [] as string[],
    /** Two-finger pinch this tick (+ spreading = zoom in, as a fraction) and two-finger pan (pixels). */
    pinch: 0, pan: [0, 0] as [number, number],
    /** Every finger on the screen by its id (screen pixels), for multitouch. */
    points: new Map<number, { x: number; y: number }>(),
    /** Fingers on objects this tick: touched, released, held (long press), doubletapped. */
    objects: [] as { uid: number; state: 'touched' | 'released' | 'held' | 'doubletapped' }[],
    /** Swipe speed of the last swipe (screen heights per second). */
    swipeSpeed: 0,
  };
  /** Axis bindings ("axis:LeftX-") held last tick, for their pressed / released edges. */
  private axisPrev = new Set<string>();
  private axisNow = new Set<string>();
  down = new Set<string>();
  pressed = new Set<string>();
  released = new Set<string>();
  mouse = { x: 0, y: 0, z: 0, screenX: 0, screenY: 0, dx: 0, dy: 0, /** Captured (first person): clicks are at the middle of the view. */ locked: false,
    /** Mouse wheel this tick (pixels; positive: scrolled toward you, zoom out). */ wheel: 0 };
  buttonsDown = new Set<string>();
  clicks: string[] = [];
  mouseReleased: string[] = [];
  /** UIDs of instances under the cursor when clicked (host performs the hit test). */
  clickedUids: number[] = [];
  uiButtons: string[] = [];
  pad = newPad();
  /** Every gamepad (index 0 is `pad`), for local multiplayer "gamepad 1-4" controls. */
  pads: PadState[] = [this.pad, newPad(), newPad(), newPad()];
  /** Each pad's browser id (for its button names in prompts). */
  padIds: string[] = ['', '', '', ''];
  /** The pad used last (its style names gamepad prompts). */
  lastPad = 0;
  /** Players who joined over the network (2-4): their keyboard and gamepad, sent by their game. */
  remotes = new Map<number, InputState>();

  keyDown(k: string) { const n = normalizeKey(k); if (!this.down.has(n)) this.pressed.add(n); this.down.add(n); this.device = 'keyboard'; }
  keyUp(k: string) { const n = normalizeKey(k); if (this.down.has(n)) this.released.add(n); this.down.delete(n); }
  mouseDown(button: 'left' | 'right' | 'middle', hitUids: number[] = []) { this.device = 'mouse'; this.buttonsDown.add(button); this.clicks.push(button); if (button === 'left') this.clickedUids.push(...hitUids); }
  mouseUp(button: string) { if (this.buttonsDown.has(button)) this.mouseReleased.push(button); this.buttonsDown.delete(button); }
  // ---- VR controllers (WebXR / OpenXR, fed by the host each frame; also by the desktop VR preview)
  /** Per hand: button / axis state and the controller's pose (world space, set by the host). */
  xr = { active: false, left: newXrHand(), right: newXrHand(), head: { pos: [0, 1.6, 0] as [number, number, number], yaw: 0, pitch: 0 }, haptics: [] as { hand: 'left' | 'right'; strength: number; ms: number }[] };
  /** Ask the host to vibrate a controller (strength 0..1, milliseconds); played on the next VR frame. */
  vibrate(hand: 'left' | 'right' | 'both', strength: number, ms: number) {
    for (const h of hand === 'both' ? (['left', 'right'] as const) : [hand]) this.xr.haptics.push({ hand: h, strength: Math.max(0, Math.min(1, strength)), ms: Math.max(1, ms) });
    if (this.xr.haptics.length > 16) this.xr.haptics.splice(0, this.xr.haptics.length - 16);
  }
  /** Host: this frame's controller buttons (pressed flags by name) and thumbstick for one hand. */
  setXrHand(hand: 'left' | 'right', buttons: Record<string, boolean>, stick: [number, number], pose?: { pos: [number, number, number]; dir: [number, number, number] }) {
    const h = this.xr[hand];
    for (const [name, on] of Object.entries(buttons)) {
      if (on && !h.down.has(name)) { h.pressed.add(name); h.down.add(name); this.device = 'vr' as InputDevice; }
      if (!on && h.down.has(name)) { h.released.add(name); h.down.delete(name); }
    }
    h.stick = [Math.abs(stick[0]) < 0.15 ? 0 : stick[0], Math.abs(stick[1]) < 0.15 ? 0 : stick[1]];
    if (h.stick[0] || h.stick[1]) this.device = 'vr' as InputDevice;
    if (pose) { h.pos = pose.pos; h.dir = pose.dir; }
  }

  // ---- on-screen touch controls (fed by the host's touch overlay)
  touchDown(name: string) { if (!this.touch.down.has(name)) this.touch.pressed.add(name); this.touch.down.add(name); this.device = 'touch'; }
  touchUp(name: string) { if (this.touch.down.has(name)) this.touch.released.add(name); this.touch.down.delete(name); }
  /** Virtual joystick: x right, y up, each -1..1. */
  setTouchStick(x: number, y: number) { this.touch.stick = [Math.max(-1, Math.min(1, x)), Math.max(-1, Math.min(1, y))]; if (x || y) this.device = 'touch'; }
  /** Drag-to-look on the free part of the screen (pixels this tick). */
  touchLook(dx: number, dy: number) { this.touch.look[0] += dx; this.touch.look[1] += dy; this.mouse.dx += dx; this.mouse.dy += dy; this.device = 'touch'; } // drives the same camera look as the mouse
  swipe(dir: 'left' | 'right' | 'up' | 'down', speed = 0) { this.touch.swipes.push(dir); this.touch.swipeSpeed = speed; this.device = 'touch'; }
  tap() { this.touch.taps++; this.device = 'touch'; }
  gesture(name: string) { this.touch.gestures.push(name); this.device = 'touch'; }
  touchObject(uid: number, state: 'touched' | 'released' | 'held' | 'doubletapped') { this.touch.objects.push({ uid, state }); }

  isDown(k: string) { return this.down.has(k); }
  anyDown(keys: string[]) { return keys.some((k) => this.down.has(k)); }
  anyPressed(keys: string[]) { return keys.some((k) => this.pressed.has(k)); }

  /** Hosts call this every frame with the first connected gamepad (or null). Transitions accumulate until endTick. */
  setGamepad(buttons: boolean[] | null, axes: number[] = [], triggers = 0, index = 0) {
    const pad = this.pads[index] ?? this.pad;
    if (!buttons) { pad.connected = false; for (const b of pad.down) pad.released.add(b); pad.down.clear(); pad.axes = [0, 0, 0, 0]; return; }
    pad.connected = true;
    buttons.forEach((on, i) => {
      const name = PAD_BUTTONS[i]; if (!name) return;
      if (on && !pad.down.has(name)) { pad.pressed.add(name); pad.down.add(name); this.device = 'gamepad'; this.lastPad = index; }
      if (!on && pad.down.has(name)) { pad.released.add(name); pad.down.delete(name); }
    });
    const dz = (v: number) => (Math.abs(v) < 0.15 ? 0 : v);
    pad.axes = [0, 1, 2, 3].map((i) => dz(axes[i] ?? 0));
    if (pad.axes.some((a) => Math.abs(a) > 0.5)) { this.device = 'gamepad'; this.lastPad = index; }
    pad.triggers = triggers;
  }

  /** Devices the game turned off ("Enable / disable input device"): their bindings read as not pressed. */
  disabled = new Set<InputDevice>();

  /** One binding ("Space", "mouse:left", "pad:A") in a state. */
  binding(b: string, state: 'held' | 'pressed' | 'released'): boolean {
    if (this.disabled.size && this.disabled.has(deviceOf(b))) return false;
    // Gamepad 2-4 ("pad2:A"), stick / trigger directions as buttons ("axis:LeftX-"), touch controls, swipes, taps.
    const pn = /^pad([1-4]):(.+)$/.exec(b);
    if (pn) { const p = this.pads[Number(pn[1]) - 1]; return (state === 'held' ? p.down : state === 'pressed' ? p.pressed : p.released).has(pn[2]); }
    if (/^axis\d?:/.test(b) || b.startsWith('touchstick:')) {
      const held = this.bindingValue(b) >= 0.5;
      if (held) this.axisNow.add(b);
      return state === 'held' ? held : state === 'pressed' ? held && !this.axisPrev.has(b) : !held && this.axisPrev.has(b);
    }
    const xr = /^xr:(left|right|any):([A-Za-z]+)$/.exec(b);
    if (xr) { const hands = xr[1] === 'any' ? [this.xr.left, this.xr.right] : [this.xr[xr[1] as 'left']]; return hands.some((h) => (state === 'held' ? h.down : state === 'pressed' ? h.pressed : h.released).has(xr[2])); }
    if (b.startsWith('xrstick:')) {
      const held = this.bindingValue(b) >= 0.5;
      if (held) this.axisNow.add(b);
      return state === 'held' ? held : state === 'pressed' ? held && !this.axisPrev.has(b) : !held && this.axisPrev.has(b);
    }
    if (b.startsWith('touch:')) { const n = b.slice(6); return (state === 'held' ? this.touch.down : state === 'pressed' ? this.touch.pressed : this.touch.released).has(n); }
    if (b.startsWith('swipe:')) return state === 'pressed' && this.touch.swipes.includes(b.slice(6));
    if (b === 'tap') return state === 'pressed' && this.touch.taps > 0;
    if (b.startsWith('gesture:')) return state === 'pressed' && this.touch.gestures.includes(b.slice(8));
    if (b.startsWith('mouse:')) { const m = b.slice(6); return state === 'held' ? this.buttonsDown.has(m) : state === 'pressed' ? this.clicks.includes(m) : this.mouseReleased.includes(m); }
    if (b.startsWith('pad:')) { const p = b.slice(4); return (state === 'held' ? this.pad.down : state === 'pressed' ? this.pad.pressed : this.pad.released).has(p); }
    const k = normalizeKey(b);
    const set = state === 'held' ? this.down : state === 'pressed' ? this.pressed : this.released;
    return k === 'Any' ? set.size > 0 : set.has(k);
  }

  /**
   * Analog strength 0..1 of one binding: sticks / triggers ("axis:LeftX-" is the stick pushed left) and the touch
   * stick give their amount; buttons and keys give 0 or 1.
   */
  bindingValue(b: string): number {
    if (this.disabled.size && this.disabled.has(deviceOf(b))) return 0;
    const xs = /^xrstick:(left|right):([XY])([+-])$/.exec(b);
    if (xs) { const v = this.xr[xs[1] as 'left'].stick[xs[2] === 'X' ? 0 : 1]; return Math.max(0, xs[3] === '+' ? v : -v); }
    const ax = /^(axis|touchstick)([1-4])?:([A-Za-z]+)([+-])$/.exec(b);
    if (ax) {
      const v = ax[1] === 'touchstick' ? (ax[3].toLowerCase() === 'x' ? this.touch.stick[0] : this.touch.stick[1]) : ax[2] ? this.padAxis(Number(ax[2]) - 1, ax[3]) : this.axis(ax[3]);
      return Math.max(0, ax[4] === '+' ? v : -v);
    }
    return this.binding(b, 'held') ? 1 : 0;
  }

  /** -1..1 value of a named axis: keyboard arrows/WASD combine with the left stick and the touch stick. */
  axis(name: string): number {
    const n = name.toLowerCase();
    const off = (d: InputDevice) => this.disabled.has(d);
    const key = (neg: string[], pos: string[]) => off('keyboard') ? 0 : (pos.some((k) => this.down.has(k)) ? 1 : 0) - (neg.some((k) => this.down.has(k)) ? 1 : 0);
    const clamp = (v: number) => Math.max(-1, Math.min(1, v));
    const pad = (k: number) => (off('gamepad') ? 0 : this.pad.axes[k]), stick = (k: number) => (off('touch') ? 0 : this.touch.stick[k]);
    if (n === 'horizontal') return clamp(key(['ArrowLeft', 'A'], ['ArrowRight', 'D']) + pad(0) + stick(0));
    if (n === 'vertical') return clamp(key(['ArrowDown', 'S'], ['ArrowUp', 'W']) - pad(1) + stick(1));
    if (off('gamepad')) return 0;
    if (n === 'leftx') return this.pad.axes[0]; if (n === 'lefty') return -this.pad.axes[1];
    if (n === 'rightx') return this.pad.axes[2]; if (n === 'righty') return -this.pad.axes[3];
    if (n === 'triggers') return this.pad.triggers;
    return 0;
  }

  /** -1..1 of one gamepad's stick or triggers (local multiplayer: "axis2:LeftX-" is gamepad 2). */
  padAxis(index: number, name: string): number {
    const p = this.pads[index];
    if (!p?.connected || this.disabled.has('gamepad')) return 0;
    const n = name.toLowerCase();
    if (n === 'leftx' || n === 'horizontal') return p.axes[0]; if (n === 'lefty' || n === 'vertical') return -p.axes[1];
    if (n === 'rightx') return p.axes[2]; if (n === 'righty') return -p.axes[3];
    if (n === 'triggers') return p.triggers;
    return 0;
  }

  /** Record this tick's state of every analog binding the game uses, so their pressed / released edges are exact. */
  track(bindings: Iterable<string>) { for (const b of bindings) if ((/^axis\d?:/.test(b) || b.startsWith('touchstick:') || b.startsWith('xrstick:')) && this.bindingValue(b) >= 0.5) this.axisNow.add(b); }

  /** Called by the runtime after each fixed tick so one press triggers exactly once. */
  endTick() {
    this.pressed.clear(); this.released.clear(); this.clicks = []; this.mouseReleased = []; this.clickedUids = []; this.uiButtons = []; this.mouse.dx = 0; this.mouse.dy = 0; this.mouse.wheel = 0;
    for (const p of this.pads) { p.pressed.clear(); p.released.clear(); }
    for (const h of [this.xr.left, this.xr.right]) { h.pressed.clear(); h.released.clear(); }
    this.touch.pressed.clear(); this.touch.released.clear(); this.touch.swipes = []; this.touch.taps = 0; this.touch.look = [0, 0];
    this.touch.gestures = []; this.touch.pinch = 0; this.touch.pan = [0, 0]; this.touch.objects = [];
    this.axisPrev = this.axisNow; this.axisNow = new Set();
    for (const r of this.remotes.values()) r.endTick();
  }
  clear() { this.down.clear(); this.buttonsDown.clear(); for (const p of this.pads) p.down.clear(); this.touch.down.clear(); this.touch.stick = [0, 0]; this.endTick(); }

  /** Network snapshot of the held keys and first gamepad (what an online player sends to the host). */
  snapshot(): RemoteInput { return { keys: [...this.down], pad: this.pad.connected ? [...this.pad.down] : null, axes: this.pad.axes.slice(0, 4) }; }
  /** Apply a remote player's snapshot (presses/releases are derived from the change). */
  applySnapshot(s: RemoteInput) {
    const keys = new Set(s.keys);
    for (const k of keys) if (!this.down.has(k)) { this.pressed.add(k); this.down.add(k); }
    for (const k of [...this.down]) if (!keys.has(k)) { this.released.add(k); this.down.delete(k); }
    if (!s.pad) { if (this.pad.connected) this.setGamepad(null); return; }
    this.pad.connected = true;
    const pb = new Set(s.pad);
    for (const b of pb) if (!this.pad.down.has(b)) { this.pad.pressed.add(b); this.pad.down.add(b); }
    for (const b of [...this.pad.down]) if (!pb.has(b)) { this.pad.released.add(b); this.pad.down.delete(b); }
    this.pad.axes = s.axes ?? [0, 0, 0, 0];
  }
}

export interface PadState { connected: boolean; down: Set<string>; pressed: Set<string>; released: Set<string>; axes: number[]; triggers: number }
export interface RemoteInput { keys: string[]; pad: string[] | null; axes: number[] }
export interface XrHand { down: Set<string>; pressed: Set<string>; released: Set<string>; stick: [number, number]; pos: [number, number, number]; dir: [number, number, number] }
function newXrHand(): XrHand { return { down: new Set(), pressed: new Set(), released: new Set(), stick: [0, 0], pos: [0, 1, 0], dir: [0, 0, -1] }; }

/**
 * VR actions (the same action system as every other device): controller buttons are "xr:left|right|any:<button>"
 * (trigger, grip, a, b, x, y, thumbstick, menu) and thumbsticks "xrstick:left|right:X+|X-|Y+|Y-".
 */
export const VR_ACTIONS: Record<string, string[]> = {
  Grab: ['xr:any:grip', 'E'], Release: ['xr:any:grip', 'E'], Teleport: ['xrstick:right:Y+', 'T'], Move: ['xrstick:left:Y+', 'xrstick:left:Y-', 'xrstick:left:X+', 'xrstick:left:X-', 'W', 'A', 'S', 'D'],
  Turn: ['xrstick:right:X+', 'xrstick:right:X-', 'ArrowLeft', 'ArrowRight'], Interact: ['xr:any:trigger', 'mouse:left'], Primary: ['xr:right:a', 'xr:left:x', 'Space'], Secondary: ['xr:right:b', 'xr:left:y', 'Shift'],
  Menu: ['xr:left:menu', 'Escape'],
};

function newPad(): PadState { return { connected: false, down: new Set(), pressed: new Set(), released: new Set(), axes: [0, 0, 0, 0], triggers: 0 }; }

/** Read connected gamepads into an InputState (browser hosts call this each frame): pad 1 also drives "default" controls. */
export function pollGamepad(input: InputState) {
  const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? [...(navigator.getGamepads() ?? [])] : [];
  const live = pads.filter((p): p is Gamepad => !!p && p.connected);
  for (let i = 0; i < 4; i++) {
    const gp = live[i];
    if (!gp) { if (input.pads[i].connected) input.setGamepad(null, [], 0, i); continue; }
    input.padIds[i] = gp.id;
    input.setGamepad(gp.buttons.map((b) => b.pressed || b.value > 0.5), [...gp.axes], (gp.buttons[7]?.value ?? 0) - (gp.buttons[6]?.value ?? 0), i);
  }
}
