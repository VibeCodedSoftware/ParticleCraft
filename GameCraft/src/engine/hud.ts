// HTML overlay for HUD text objects, bars, buttons, messages and victory/defeat screens.
import type { BarStyle, InstanceData } from '@shared/src/runtime/scene';
import type { Runtime } from '@shared/src/runtime/runtime';
import type { CullStats } from './culling';
import { textStyleCss } from '@shared/src/runtime/textStyle';
import { MODEL_EXTS, extOf } from './assets';
import { modelThumb } from './thumbnails';

/** Anchor = vertical (t/c/b) + horizontal (l/c/r). X/Y are pixel offsets inward from that anchor. */
export function anchorCss(anchor: string, x: number, y: number) {
  const vv = anchor[0] ?? 't', h = anchor[1] ?? 'l';
  const parts: string[] = [];
  let tx = '0', ty = '0';
  if (h === 'l') parts.push(`left:${x}px`); else if (h === 'r') parts.push(`right:${x}px`); else { parts.push(`left:calc(50% + ${x}px)`); tx = '-50%'; }
  if (vv === 't') parts.push(`top:${y}px`); else if (vv === 'b') parts.push(`bottom:${y}px`); else { parts.push(`top:calc(50% + ${y}px)`); ty = '-50%'; }
  parts.push(`transform:translate(${tx},${ty})`);
  return parts.join(';');
}

/** A bar's look as elements. `value` is 0..1. */
export function barLook(b: BarStyle, value: number, textColor: string, resolve: (id: string) => string | null): HTMLElement {
  const color = b.color || textColor, bg = b.bg || 'rgba(0,0,0,.5)';
  const box = document.createElement('div');
  const img = (id: string | undefined) => (id ? resolve(id) : null);
  if (b.kind === 'ticks' || b.kind === 'hearts') {
    const count = Math.max(1, Math.round(b.count ?? (b.kind === 'hearts' ? 3 : 10)));
    const w = b.width ?? (b.kind === 'hearts' ? 26 : 12), h = b.height ?? (b.kind === 'hearts' ? 26 : 16);
    box.style.cssText = 'display:flex;gap:3px;margin-top:2px;';
    box.dataset.count = String(count);
    for (let k = 0; k < count; k++) {
      const fill = Math.max(0, Math.min(1, value * count - k)); // how much of this one is full
      const cell = document.createElement('div');
      cell.style.cssText = `position:relative;width:${w}px;height:${h}px;flex:none;`;
      const layer = (full: boolean, clip: number) => {
        const url = img(full ? b.full : b.empty), l = document.createElement('div');
        const base = `position:absolute;inset:0;overflow:hidden;width:${clip * 100}%;`;
        if (url) { l.style.cssText = `${base}background:url("${url}") left center / ${w}px ${h}px no-repeat;`; }
        else if (b.kind === 'hearts') { l.style.cssText = `${base}font-size:${h * 0.95}px;line-height:${h}px;white-space:nowrap;color:${full ? color : bg};`; l.textContent = '♥'; }
        else l.style.cssText = `${base}height:100%;background:${full ? color : bg};border-radius:${b.radius ?? 2}px;`;
        l.dataset.full = full ? '1' : '0';
        return l;
      };
      cell.appendChild(layer(false, 1));
      if (fill > 0) cell.appendChild(layer(true, fill));
      box.appendChild(cell);
    }
    return box;
  }
  if (b.kind === 'image') {
    const w = b.width ?? 180, h = b.height ?? 24, full = img(b.full), empty = img(b.empty);
    box.style.cssText = `position:relative;width:${w}px;height:${h}px;margin-top:2px;${empty ? `background:url("${empty}") center / 100% 100% no-repeat;` : ''}`;
    const f = document.createElement('div');
    f.style.cssText = `position:absolute;left:0;top:0;bottom:0;width:${value * 100}%;overflow:hidden;`;
    const inner = document.createElement('div');
    inner.style.cssText = full ? `width:${w}px;height:${h}px;background:url("${full}") center / 100% 100% no-repeat;` : `width:${w}px;height:${h}px;background:${color};`;
    f.appendChild(inner); box.appendChild(f);
    return box;
  }
  const w = b.width ?? 180, h = b.height ?? 12;
  box.style.cssText = `width:${w}px;height:${h}px;background:${bg};border:1px solid rgba(255,255,255,.35);border-radius:${b.radius ?? 6}px;overflow:hidden;margin-top:2px;`;
  const f = document.createElement('div');
  f.style.cssText = `height:100%;width:${value * 100}%;background:${color};transition:width .15s;`;
  box.appendChild(f);
  return box;
}

export class Hud {
  el: HTMLDivElement;
  private items = new Map<number, HTMLDivElement>();
  private msg: HTMLDivElement;
  private screen: HTMLDivElement;
  private fps: HTMLDivElement;
  private frames = 0; private last = performance.now();
  onButton?: (name: string) => void;
  resolve: (assetId: string) => string | null = () => null;
  private fonts = new Map<string, string>();
  private modelIcons = new Map<string, string>();

  /** Load a project/library font once and return its CSS family name. */
  private font(id: string): string {
    let fam = this.fonts.get(id);
    if (fam) return fam;
    fam = 'gcfont_' + this.fonts.size;
    this.fonts.set(id, fam);
    const url = this.resolve(id);
    if (url) new FontFace(fam, `url(${url})`).load().then((f) => { (document.fonts as any).add(f); for (const d of this.items.values()) d.dataset.k = ''; }).catch(() => { /* fall back to system font */ });
    return fam;
  }

  /** CSS family of an imported font (loaded on first use). */
  fontName(id: string) { return this.font(id); }

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'gc-hud';
    this.msg = document.createElement('div'); this.msg.className = 'gc-hud-msg';
    this.screen = document.createElement('div'); this.screen.className = 'gc-hud-screen';
    this.fps = document.createElement('div'); this.fps.className = 'gc-hud-fps';
    this.el.append(this.msg, this.screen, this.fps);
    parent.appendChild(this.el);
  }

  /** Editor preview of HUD layout (no runtime). */
  updateStatic(list: InstanceData[], selected: number[] = []) { this.selected = selected; this.sync(list, null); this.msg.style.display = 'none'; this.screen.style.display = 'none'; }
  /** Editor: HUD texts are selectable / draggable (data-uid) and the selected ones are outlined. */
  private selected: number[] = [];

  /** Set by the play session: world point -> screen position over the game view (for speech bubbles). */
  project: (x: number, y: number, z: number) => { x: number; y: number } | null = () => null;
  private bubbles = new Map<number, HTMLDivElement>();
  private askBox: HTMLFormElement | null = null;
  private askFor: object | null = null;

  /** "Say" / "Think" bubbles above objects. */
  private syncBubbles(rt: Runtime) {
    const seen = new Set<number>();
    for (const i of rt.world.instances) {
      const b = i.state.bubble as { kind: 'say' | 'think'; text: string; until: number } | undefined;
      if (i.destroyed || !i.visible || !b || b.until < rt.time) continue;
      const [x, , z] = rt.world.worldPos(i);
      const top = rt.world.aabb(i)[4];
      const p = this.project(x, rt.world.plane === 'xz' ? top + 0.15 : i.y + Math.abs(i.sy) / 2, rt.world.plane === 'xz' ? z : i.z);
      if (!p) continue;
      seen.add(i.uid);
      let d = this.bubbles.get(i.uid);
      if (!d) { d = document.createElement('div'); this.el.appendChild(d); this.bubbles.set(i.uid, d); }
      d.className = 'gc-bubble ' + b.kind;
      if (d.textContent !== b.text) d.textContent = b.text;
      d.style.left = `${p.x}px`; d.style.top = `${p.y}px`;
    }
    for (const [u, d] of this.bubbles) if (!seen.has(u)) { d.remove(); this.bubbles.delete(u); }
  }

  /** "Ask and wait": a text box at the bottom; Enter answers. */
  private syncAsk(rt: Runtime) {
    const ask = rt.ui.ask ?? null;
    if (ask === this.askFor) return;
    this.askFor = ask;
    this.askBox?.remove(); this.askBox = null;
    if (!ask) return;
    const f = document.createElement('form');
    f.className = 'gc-ask';
    const q = document.createElement('div'); q.className = 'gc-ask-q'; q.textContent = ask.question;
    const input = document.createElement('input'); input.placeholder = 'Type your answer and press Enter';
    // Typing must not drive the game.
    input.addEventListener('keydown', (e) => e.stopPropagation()); input.addEventListener('keyup', (e) => e.stopPropagation());
    const ok = document.createElement('button'); ok.type = 'submit'; ok.textContent = '✓';
    f.append(...(ask.question ? [q] : []), input, ok);
    f.onsubmit = (e) => { e.preventDefault(); ask.answer = input.value; f.remove(); this.askBox = null; };
    this.el.appendChild(f); this.askBox = f;
    document.exitPointerLock?.();
    setTimeout(() => input.focus(), 0);
  }

  update(rt: Runtime, showFps: boolean, stats?: CullStats) {
    this.sync(rt.world.instances.filter((i) => !i.destroyed), rt);
    this.syncBubbles(rt);
    this.syncAsk(rt);
    const m = rt.ui.message;
    this.msg.style.display = m ? 'block' : 'none';
    if (m) this.msg.textContent = m.text;
    const s = rt.ui.screen;
    if (s) {
      if (this.screen.dataset.k !== s.kind + s.title + s.message) {
        this.screen.dataset.k = s.kind + s.title + s.message;
        this.screen.className = 'gc-hud-screen ' + s.kind;
        this.screen.innerHTML = '';
        const box = document.createElement('div'); box.className = 'gc-hud-card';
        const h = document.createElement('h1'); h.textContent = s.title;
        const p = document.createElement('p'); p.textContent = s.message;
        const b = document.createElement('button'); b.textContent = 'Restart'; b.onclick = () => this.onButton?.('__restart__');
        box.append(h, p, b); this.screen.append(box);
      }
      this.screen.style.display = 'flex';
    } else { this.screen.style.display = 'none'; this.screen.dataset.k = ''; }
    this.frames++;
    const now = performance.now();
    if (now - this.last > 500) {
      const fps = Math.round((this.frames * 1000) / (now - this.last)) + ' fps';
      this.fps.textContent = stats ? `${fps} · ${stats.calls} draws · ${(stats.triangles / 1000).toFixed(0)}k tris · ${stats.objects} objs (${stats.occluded} occluded, ${stats.distance} far, ${stats.range} out of range, ${stats.lod} LOD)` : fps;
      this.frames = 0; this.last = now;
    }
    this.fps.style.display = showFps ? 'block' : 'none';
  }

  private sync(list: InstanceData[], rt: Runtime | null) {
    const seen = new Set<number>();
    const selTags = new Set(rt ? [] : list.filter((x) => this.selected.includes(x.uid)).flatMap((x) => x.tags));
    for (const i of list) {
      if (i.kind !== 'text' || !i.text?.hud) continue;
      seen.add(i.uid);
      let d = this.items.get(i.uid);
      if (!d) {
        d = document.createElement('div');
        d.className = 'gc-hud-item';
        if (i.text.button) { d.classList.add('btn'); d.onclick = () => this.onButton?.(i.name); }
        this.el.appendChild(d); this.items.set(i.uid, d);
      }
      const t = i.text;
      const bar = (i as any).bar as { value: number; max: number } | undefined;
      const editing = !rt, sel = editing && this.selected.includes(i.uid);
      // Text that takes the camera's Post-FX is drawn inside the 3D view while playing (see screenText.ts).
      const inScene = !!rt && !!t.postfx;
      // Editing: a hidden menu shows while one of its pieces is selected, so it can be seen and changed.
      const shown = i.visible || (editing && (sel || i.tags.some((tag) => selTags.has(tag))));
      const key = [t.text, t.size, t.color, t.anchor, t.align, i.x, i.y, shown, i.opacity, bar?.value, bar?.max, t.style ? JSON.stringify(t.style) : '', t.barStyle ? JSON.stringify(t.barStyle) : '', t.font, editing, sel, inScene].join('|');
      if (d.dataset.k === key) continue;
      d.dataset.k = key;
      const fontFamily = t.font ? this.font(t.font) : '';
      const panel = t.panel ? 'background:rgba(12,11,8,0.8);border:1px solid rgba(255,255,255,0.1);border-radius:6px;padding:6px 14px;min-width:240px;box-sizing:border-box;white-space:nowrap;' : '';
      d.style.cssText = `position:absolute;${anchorCss(t.anchor, i.x, i.y)};color:${t.color};font-size:${t.size}px;text-align:${t.align};opacity:${i.opacity / 100};display:${shown && !inScene ? 'flex' : 'none'};align-items:center;gap:6px;${panel}${fontFamily ? `font-family:'${fontFamily}',system-ui;` : ''}${textStyleCss(t.style, this.resolve)}`;
      if (editing) { d.dataset.uid = String(i.uid); d.style.pointerEvents = 'auto'; d.style.cursor = 'move'; d.style.userSelect = 'none'; if (sel) d.style.outline = '1px dashed #ffa500'; d.style.outlineOffset = '3px'; d.title = 'Drag to move · double-click to edit'; }
      d.innerHTML = '';
      const iconUrl = t.icon ? this.resolve(t.icon) : null;
      if (iconUrl) {
        const img = document.createElement('img'); img.style.cssText = `height:${t.size * 1.4}px;image-rendering:auto`;
      if (editing) { d.dataset.uid = String(i.uid); d.style.pointerEvents = 'auto'; d.style.cursor = 'move'; d.style.userSelect = 'none'; if (sel) d.style.outline = '1px dashed #ffa500'; d.style.outlineOffset = '3px'; d.title = 'Drag to move · double-click to edit'; }
        // A 3D model as an icon (e.g. a heart mesh from a .blend) is rendered once to an image.
        if (MODEL_EXTS.includes(extOf(iconUrl))) { const cached = this.modelIcons.get(iconUrl); if (cached) img.src = cached; else modelThumb(iconUrl, { center: true, ground: false }, undefined, 0, 'flat', 128).then((src) => { this.modelIcons.set(iconUrl, src); img.src = src; }).catch(() => { /* leave blank */ }); }
        else img.src = iconUrl;
        d.appendChild(img);
      }
      // A chosen look (while editing, shown at a sample value); otherwise the plain bar as before.
      const looks = t.barStyle && (bar || editing);
      if (looks) {
        const v = bar ? Math.max(0, Math.min(1, bar.value / (bar.max || 1))) : 0.7;
        const wrap = document.createElement('div');
        if (t.barStyle!.label !== false && t.text) { const l = document.createElement('div'); l.className = 'gc-bar-label'; l.textContent = t.text; wrap.appendChild(l); }
        wrap.appendChild(barLook(t.barStyle!, v, t.color, this.resolve));
        d.appendChild(wrap);
      } else if (bar) {
        const pct = Math.max(0, Math.min(1, bar.value / bar.max)) * 100;
        const wrap = document.createElement('div');
        wrap.innerHTML = `<div class="gc-bar-label"></div><div class="gc-bar"><div style="width:${pct}%;background:${t.color}"></div></div>`;
      if (editing) { d.dataset.uid = String(i.uid); d.style.pointerEvents = 'auto'; d.style.cursor = 'move'; d.style.userSelect = 'none'; if (sel) d.style.outline = '1px dashed #ffa500'; d.style.outlineOffset = '3px'; d.title = 'Drag to move · double-click to edit'; }
        (wrap.firstChild as HTMLElement).textContent = t.text;
        d.appendChild(wrap);
      } else { const s = document.createElement('span'); s.textContent = t.text; d.appendChild(s); }
    }
    for (const [u, d] of this.items) if (!seen.has(u)) { d.remove(); this.items.delete(u); }
    void rt;
  }

  clear() {
    for (const d of this.items.values()) d.remove(); this.items.clear(); this.msg.style.display = 'none'; this.screen.style.display = 'none';
    for (const d of this.bubbles.values()) d.remove(); this.bubbles.clear();
    this.askBox?.remove(); this.askBox = null; this.askFor = null;
  }
  dispose() { this.el.remove(); }
}
