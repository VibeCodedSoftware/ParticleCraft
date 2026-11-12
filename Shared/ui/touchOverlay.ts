// The on-screen touch controls drawn over a game (GameCraft player / play mode, LogicCraft stage): plain DOM so both
// apps can use it. Pointers on a control go to the TouchController; touches on the free part of the screen give
// look / swipe / tap. Shown according to the layout's "enabled" setting (auto = on touch screens).
import type { InputState } from '../src/runtime/input';
import { TouchController, elementsFor, touchVisible, type TouchLayout } from '../src/touchControls';

export interface TouchOverlay { update(layout: TouchLayout | undefined): void; destroy(): void }

/** `pick`: the game object under a screen point (client pixels), for "On object touched / held / released". */
export function createTouchOverlay(host: HTMLElement, input: InputState, pick?: (clientX: number, clientY: number) => number | null): TouchOverlay {
  const root = document.createElement('div');
  root.className = 'touch-overlay';
  Object.assign(root.style, { position: 'absolute', inset: '0', pointerEvents: 'none', zIndex: '40', touchAction: 'none', userSelect: 'none' } as CSSStyleDeclaration);
  if (getComputedStyle(host).position === 'static') host.style.position = 'relative'; // the overlay covers the host
  host.appendChild(root);
  const size = () => ({ w: root.clientWidth || host.clientWidth, h: root.clientHeight || host.clientHeight });
  let layout: TouchLayout | undefined;
  const ctl = new TouchController(input, { enabled: 'off', preset: '', elements: [], look: false, swipes: false, opacity: 0.5 }, size,
    pick && ((x, y) => { const b = root.getBoundingClientRect(); return pick(x + b.left, y + b.top); }));
  // Long presses need time to pass with no events: a frame loop runs while a finger is down.
  let raf = 0;
  const tickLoop = () => { ctl.update(); raf = input.touch.points.size ? requestAnimationFrame(tickLoop) : 0; };
  const touchScreen = typeof navigator !== 'undefined' && (navigator.maxTouchPoints ?? 0) > 0;
  let knob: HTMLElement | null = null;

  const render = () => {
    root.innerHTML = '';
    knob = null;
    if (!layout) return;
    const { w, h } = size(), m = Math.min(w, h);
    // Portrait or landscape controls for the screen's shape (re-drawn when the phone turns: ResizeObserver).
    for (const e of elementsFor(layout, w, h)) {
      const d = document.createElement('div');
      const px = e.size * m;
      Object.assign(d.style, {
        position: 'absolute', left: `${e.x * w - px / 2}px`, top: `${e.y * h - px / 2}px`, width: `${px}px`, height: `${px}px`, borderRadius: '50%',
        border: '2px solid rgba(255,255,255,.85)', background: e.kind === 'stick' ? 'rgba(255,255,255,.12)' : 'rgba(255,255,255,.22)',
        opacity: String(layout.opacity), display: 'grid', placeItems: 'center', color: '#fff', font: `600 ${Math.max(11, px * 0.22)}px system-ui, sans-serif`,
        textShadow: '0 1px 2px rgba(0,0,0,.6)', pointerEvents: 'auto', touchAction: 'none',
      } as CSSStyleDeclaration);
      d.dataset.touchId = e.id;
      if (e.kind === 'stick') {
        knob = document.createElement('div');
        Object.assign(knob.style, { width: `${px * 0.42}px`, height: `${px * 0.42}px`, borderRadius: '50%', background: 'rgba(255,255,255,.65)', transform: 'translate(0,0)' } as CSSStyleDeclaration);
        d.appendChild(knob);
      } else d.textContent = e.label ?? e.id;
      root.appendChild(d);
    }
  };
  const moveKnob = () => { if (!knob || !layout) return; const e = elementsFor(layout, size().w, size().h).find((k) => k.kind === 'stick'); if (!e) return; const r = (e.size * Math.min(size().w, size().h)) / 2 * 0.6; knob.style.transform = `translate(${input.touch.stick[0] * r}px, ${-input.touch.stick[1] * r}px)`; };

  const local = (ev: PointerEvent) => { const b = root.getBoundingClientRect(); return [ev.clientX - b.left, ev.clientY - b.top] as const; };
  const onDown = (ev: PointerEvent) => {
    const onControl = !!(ev.target as HTMLElement)?.dataset?.touchId;
    // Fingers on the free part of the screen give gestures (tap, double tap, long press, drag, pinch) and touched
    // objects, even with no on-screen controls; they are not taken from the game (its own clicks still happen).
    if (!onControl && ev.pointerType !== 'touch') return;
    if (onControl && (!layout || !shown)) return;
    if (!layout) ctl.layout = { enabled: 'off', preset: '', elements: [], look: false, swipes: false, opacity: 0.5 };
    const [x, y] = local(ev);
    ctl.down(ev.pointerId, x, y, ev.timeStamp);
    if (onControl) { try { (ev.target as Element).setPointerCapture?.(ev.pointerId); } catch { /* not capturable */ } ev.preventDefault(); ev.stopPropagation(); }
    if (!raf) raf = requestAnimationFrame(tickLoop);
    moveKnob();
  };
  const onMove = (ev: PointerEvent) => { const [x, y] = local(ev); ctl.move(ev.pointerId, x, y); moveKnob(); };
  const onUp = (ev: PointerEvent) => { const [x, y] = local(ev); ctl.up(ev.pointerId, x, y, ev.timeStamp); moveKnob(); };
  root.addEventListener('pointerdown', onDown);
  host.addEventListener('pointerdown', onDown);
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
  const blur = () => { ctl.reset(); moveKnob(); };
  window.addEventListener('blur', blur);
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => render()) : null;
  ro?.observe(host);

  let shown = false, key = '';
  return {
    update(l) {
      const vis = touchVisible(l, touchScreen, input.device);
      const k = JSON.stringify(l ?? null) + vis;
      if (k === key) return;
      key = k; layout = l; shown = vis;
      if (l) ctl.layout = l;
      if (!vis) { ctl.reset(); layout = undefined; if (l) ctl.layout = { ...l, elements: [], look: false, swipes: false }; } // gestures still work
      // Safe area: controls stay clear of notches and rounded corners (needs viewport-fit=cover on phones).
      const safe = l?.safeArea !== false;
      for (const side of ['top', 'right', 'bottom', 'left'] as const) root.style[side] = safe ? `env(safe-area-inset-${side}, 0px)` : '0';
      render();
    },
    destroy() {
      ctl.reset(); ro?.disconnect(); cancelAnimationFrame(raf);
      root.removeEventListener('pointerdown', onDown); host.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); window.removeEventListener('pointercancel', onUp); window.removeEventListener('blur', blur);
      root.remove();
    },
  };
}
