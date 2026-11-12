// On-screen touch controls (phones / tablets), built on the input actions: a virtual joystick (feeds Horizontal /
// Vertical and "touchstick:X+" bindings), buttons (binding "touch:<id>", so a Jump button is just one more binding of
// the Jump action), drag-to-look on the free part of the screen (camera), swipes ("swipe:left"…) and taps ("tap").
// The controller is pure (pixel positions in, InputState out) so hosts only draw the overlay and forward pointers.
import type { InputState } from './runtime/input';

export interface TouchElement {
  id: string;
  kind: 'stick' | 'button';
  /** Centre as a fraction of the screen (0..1, from the top-left). */
  x: number; y: number;
  /** Diameter as a fraction of the screen's shorter side. */
  size: number;
  label?: string;
}
export interface TouchLayout {
  /** auto: shown on touch screens; always: also with a mouse (testing); off. */
  enabled: 'auto' | 'always' | 'off';
  preset: string;
  elements: TouchElement[];
  /** Drag on the free part of the screen turns the camera (adds to the mouse look). */
  look: boolean;
  /** Quick flicks on the free part of the screen are swipes. */
  swipes: boolean;
  opacity: number;
  /** Two-finger pinch zooms the game camera; two-finger drag pans (pan values for blocks: panx / pany). */
  pinchZoom?: boolean;
  /** Pinch zoom speed (1 = follows the fingers). */
  pinchSpeed?: number;
  /** Long press after this many milliseconds (default 500); double tap within this many (default 300). */
  longPressMs?: number; doubleTapMs?: number;
  /** Keep controls clear of notches and rounded corners (the screen's safe area). Default on. */
  safeArea?: boolean;
  /**
   * The controls used while the screen is taller than wide (a phone held upright). Absent or empty = `elements` in
   * both orientations. Positions are fractions of the portrait screen.
   */
  portrait?: TouchElement[];
}

/** The controls for a screen of this shape: the portrait set when held upright (and one exists), else landscape. */
export function elementsFor(layout: TouchLayout, w: number, h: number): TouchElement[] {
  return h > w && layout.portrait?.length ? layout.portrait : layout.elements;
}

/**
 * A starting portrait layout from the landscape one: the controls move into the bottom part of the tall screen
 * (thumb reach), keeping their left / right side and order; sizes stay fractions of the shorter side (the width).
 */
export function portraitFrom(elements: TouchElement[]): TouchElement[] {
  return elements.map((e) => ({ ...e, x: Math.max(0.1, Math.min(0.9, e.x)), y: Math.max(0.6, Math.min(0.94, 0.6 + (e.y - 0.3) * 0.5)), size: Math.min(0.42, e.size * 1.15) }));
}

const stick = (x = 0.16, y = 0.74, size = 0.3): TouchElement => ({ id: 'stick', kind: 'stick', x, y, size });
const btn = (id: string, x: number, y: number, size = 0.16, label = id): TouchElement => ({ id, kind: 'button', x, y, size, label });

/** Mobile presets: a layout plus the bindings it adds to the game's input actions. */
export const TOUCH_PRESETS: Record<string, { name: string; doc: string; layout: () => TouchLayout; bindings: Record<string, string[]> }> = {
  platformer: {
    name: 'Platformer', doc: 'Joystick to run, a big Jump button.',
    layout: () => ({ enabled: 'auto', preset: 'platformer', elements: [stick(), btn('Jump', 0.86, 0.74, 0.2)], look: false, swipes: false, opacity: 0.55 }),
    bindings: { Jump: ['touch:Jump'], Left: ['touchstick:X-'], Right: ['touchstick:X+'], Up: ['touchstick:Y+'], Down: ['touchstick:Y-'] },
  },
  topdown: {
    name: 'Top-down', doc: 'Joystick to move, Fire and Interact.',
    layout: () => ({ enabled: 'auto', preset: 'topdown', elements: [stick(), btn('Fire', 0.86, 0.74, 0.18), btn('Interact', 0.74, 0.86, 0.13, 'Use')], look: false, swipes: false, opacity: 0.55 }),
    bindings: { Fire: ['touch:Fire'], Interact: ['touch:Interact'], Left: ['touchstick:X-'], Right: ['touchstick:X+'], Up: ['touchstick:Y+'], Down: ['touchstick:Y-'] },
  },
  fps: {
    name: 'First-person shooter', doc: 'Joystick to walk, drag the right side to aim, Fire, Aim, Reload, Jump, Crouch, Switch weapon.',
    layout: () => ({ enabled: 'auto', preset: 'fps', elements: [stick(), btn('Fire', 0.88, 0.56, 0.17), btn('Aim', 0.74, 0.5, 0.12), btn('Jump', 0.8, 0.8, 0.14), btn('Crouch', 0.92, 0.84, 0.11), btn('Reload', 0.66, 0.84, 0.1), btn('Switch', 0.92, 0.3, 0.1, '⇄')], look: true, swipes: false, opacity: 0.5 }),
    bindings: { Fire: ['touch:Fire'], Aim: ['touch:Aim'], Jump: ['touch:Jump'], Crouch: ['touch:Crouch'], Reload: ['touch:Reload'], 'Switch weapon': ['touch:Switch'], Left: ['touchstick:X-'], Right: ['touchstick:X+'], Up: ['touchstick:Y+'], Down: ['touchstick:Y-'] },
  },
  thirdperson: {
    name: 'Third person', doc: 'Joystick to move, swipe / drag the right side to turn the camera, pinch to zoom, Jump, Attack, Interact.',
    layout: () => ({ enabled: 'auto', preset: 'thirdperson', elements: [stick(), btn('Jump', 0.86, 0.76, 0.17), btn('Attack', 0.72, 0.84, 0.14), btn('Interact', 0.9, 0.55, 0.12, 'Use')], look: true, swipes: false, opacity: 0.5, pinchZoom: true }),
    bindings: { Jump: ['touch:Jump'], Attack: ['touch:Attack'], Interact: ['touch:Interact'], Left: ['touchstick:X-'], Right: ['touchstick:X+'], Up: ['touchstick:Y+'], Down: ['touchstick:Y-'] },
  },
  racing: {
    name: 'Driving', doc: 'Steer left / right on the left; gas, brake, handbrake and gear up / down on the right.',
    layout: () => ({ enabled: 'auto', preset: 'racing', elements: [btn('Left', 0.1, 0.78, 0.18, '◀'), btn('Right', 0.27, 0.78, 0.18, '▶'), btn('Up', 0.88, 0.7, 0.18, 'Gas'), btn('Down', 0.72, 0.82, 0.15, 'Brake'), btn('Handbrake', 0.9, 0.45, 0.11, 'Hand'), btn('GearUp', 0.62, 0.62, 0.09, 'G+'), btn('GearDown', 0.62, 0.78, 0.09, 'G−')], look: false, swipes: false, opacity: 0.55 }),
    bindings: { Left: ['touch:Left'], Right: ['touch:Right'], Up: ['touch:Up'], Down: ['touch:Down'], Handbrake: ['touch:Handbrake'], 'Gear up': ['touch:GearUp'], 'Gear down': ['touch:GearDown'] },
  },
  swipe: {
    name: 'Swipe & tap', doc: 'No buttons: swipe to move (runner, puzzle), tap to act.',
    layout: () => ({ enabled: 'auto', preset: 'swipe', elements: [], look: false, swipes: true, opacity: 0.5 }),
    bindings: { Left: ['swipe:left'], Right: ['swipe:right'], Jump: ['swipe:up', 'tap'], Down: ['swipe:down'] },
  },
};

/** Add a preset's touch bindings to the game's actions (keeping every existing binding). */
export function withTouchBindings(actions: Record<string, string[]>, preset: string): Record<string, string[]> {
  const out: Record<string, string[]> = Object.fromEntries(Object.entries(actions).map(([k, v]) => [k, [...v]]));
  for (const [a, bs] of Object.entries(TOUCH_PRESETS[preset]?.bindings ?? {})) {
    const key = Object.keys(out).find((k) => k.toLowerCase() === a.toLowerCase()) ?? a;
    out[key] = [...new Set([...(out[key] ?? []), ...bs])];
  }
  return out;
}

type Grab = { kind: 'stick' | 'button' | 'free'; id: string; sx: number; sy: number; lx: number; ly: number; t: number; uid?: number | null; dragging?: boolean; long?: boolean; paired?: boolean };

/**
 * Turns pointers on the screen into InputState touch input, for a layout and a screen size in pixels. Fingers on the
 * free part of the screen also make gestures: tap, double tap, long press, drag start / end, two-finger pinch and pan;
 * with `pick` (screen point → object uid) the touched object gets touched / held / released / double-tapped.
 */
export class TouchController {
  private grabs = new Map<number, Grab>();
  private lastTap: { t: number; x: number; y: number } | null = null;
  private pair: { d: number; mx: number; my: number } | null = null;
  constructor(private input: InputState, public layout: TouchLayout, public size: () => { w: number; h: number }, public pick?: (x: number, y: number) => number | null) {}

  private frees() { return [...this.grabs.values()].filter((g) => g.kind === 'free'); }
  private pairState() {
    const f = this.frees(); if (f.length < 2) return null;
    return { d: Math.hypot(f[0].lx - f[1].lx, f[0].ly - f[1].ly), mx: (f[0].lx + f[1].lx) / 2, my: (f[0].ly + f[1].ly) / 2 };
  }

  /** Every frame: long presses (a finger held still). */
  update(t = performance.now()) {
    const ms = this.layout.longPressMs ?? 500;
    for (const g of this.grabs.values()) {
      if (g.kind !== 'free' || g.dragging || g.long || this.frees().length > 1 || t - g.t < ms) continue;
      g.long = true; this.input.gesture('longpress');
      if (g.uid != null) this.input.touchObject(g.uid, 'held');
    }
  }

  /** The controls for the screen's current shape (portrait set when held upright). */
  elements(): TouchElement[] { const { w, h } = this.size(); return elementsFor(this.layout, w, h); }

  /** Element under a point, by its circle. */
  hit(x: number, y: number): TouchElement | null {
    const { w, h } = this.size(), m = Math.min(w, h);
    let best: TouchElement | null = null, bd = Infinity;
    for (const e of this.elements()) {
      const d = Math.hypot(x - e.x * w, y - e.y * h), r = (e.size * m) / 2 * (e.kind === 'stick' ? 1.25 : 1.1);
      if (d <= r && d < bd) { bd = d; best = e; }
    }
    return best;
  }

  down(pointer: number, x: number, y: number, t = performance.now()) {
    const e = this.hit(x, y);
    const g: Grab = { kind: e ? e.kind : 'free', id: e?.id ?? '', sx: e?.kind === 'stick' ? e.x * this.size().w : x, sy: e?.kind === 'stick' ? e.y * this.size().h : y, lx: x, ly: y, t };
    this.grabs.set(pointer, g);
    this.input.touch.points.set(pointer, { x, y });
    if (g.kind === 'button') this.input.touchDown(g.id);
    if (g.kind === 'stick') this.move(pointer, x, y);
    if (g.kind === 'free') {
      g.uid = this.pick?.(x, y) ?? null;
      if (g.uid != null) this.input.touchObject(g.uid, 'touched');
      this.pair = this.pairState();
      if (this.pair) for (const f of this.frees()) f.paired = true; // a second finger: pinch / pan, not taps
    }
  }

  move(pointer: number, x: number, y: number) {
    const g = this.grabs.get(pointer); if (!g) return;
    this.input.touch.points.set(pointer, { x, y });
    if (g.kind === 'stick') {
      const e = this.elements().find((k) => k.id === g.id) ?? this.layout.elements.find((k) => k.id === g.id)!, r = (e.size * Math.min(this.size().w, this.size().h)) / 2;
      let dx = (x - g.sx) / r, dy = -(y - g.sy) / r; const l = Math.hypot(dx, dy); if (l > 1) { dx /= l; dy /= l; }
      this.input.setTouchStick(Math.abs(dx) < 0.12 ? 0 : dx, Math.abs(dy) < 0.12 ? 0 : dy);
      g.lx = x; g.ly = y;
      return;
    }
    if (g.kind !== 'free') { g.lx = x; g.ly = y; return; }
    const px = g.lx, py = g.ly;
    g.lx = x; g.ly = y;
    if (this.frees().length >= 2) {
      // Two fingers: pinch (distance) and pan (midpoint); no look while pinching.
      const now = this.pairState();
      if (now && this.pair && this.pair.d > 1) {
        this.input.touch.pinch += (now.d / this.pair.d - 1) * (this.layout.pinchSpeed ?? 1);
        this.input.touch.pan[0] += now.mx - this.pair.mx; this.input.touch.pan[1] += now.my - this.pair.my;
        this.input.device = 'touch';
      }
      this.pair = now;
      return;
    }
    if (!g.dragging && Math.hypot(x - g.sx, y - g.sy) > Math.min(this.size().w, this.size().h) * 0.03) { g.dragging = true; this.input.gesture('dragstart'); }
    if (this.layout.look) this.input.touchLook(x - px, y - py);
  }

  up(pointer: number, x: number, y: number, t = performance.now()) {
    const g = this.grabs.get(pointer); if (!g) return;
    this.grabs.delete(pointer);
    this.input.touch.points.delete(pointer);
    if (g.kind === 'button') this.input.touchUp(g.id);
    if (g.kind === 'stick') this.input.setTouchStick(0, 0);
    if (g.kind === 'free') {
      this.pair = this.pairState();
      if (g.uid != null) this.input.touchObject(g.uid, 'released');
      if (g.dragging) this.input.gesture('dragend');
      if (g.paired || g.long) return;
      const dx = x - g.sx, dy = y - g.sy, d = Math.hypot(dx, dy), dt = t - g.t, quick = dt < 350, m = Math.min(this.size().w, this.size().h);
      if (this.layout.swipes && quick && d > m * 0.08) this.input.swipe(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'), d / this.size().h / Math.max(0.016, dt / 1000));
      else if (quick && d < m * 0.03) {
        const prev = this.lastTap;
        if (prev && t - prev.t < (this.layout.doubleTapMs ?? 300) && Math.hypot(x - prev.x, y - prev.y) < m * 0.06) {
          this.input.gesture('doubletap'); if (g.uid != null) this.input.touchObject(g.uid, 'doubletapped');
          this.lastTap = null;
        } else { this.input.tap(); this.lastTap = { t, x, y }; }
      }
    }
  }

  /** Release everything (the overlay was hidden or the page lost focus). */
  reset() { for (const [p, g] of this.grabs) this.up(p, g.lx, g.ly, Infinity); }
}

/** Should the overlay show? auto = touch screens only (or once the player has used touch). */
export function touchVisible(layout: TouchLayout | undefined, touchScreen: boolean, lastDevice: string): boolean {
  if (!layout || layout.enabled === 'off' || !layout.elements.length && !layout.portrait?.length && !layout.swipes && !layout.look) return false;
  return layout.enabled === 'always' || touchScreen || lastDevice === 'touch';
}
