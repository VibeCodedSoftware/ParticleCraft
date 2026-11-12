// In-game overlay drawn by both hosts over their game view: the dialogue box, HTML code-block panels
// (sanitized, each in its own shadow root so its CSS is scoped) and scene-transition fades.
import type { Runtime } from '../src/runtime/runtime';
import { HTML_BLOCKED } from '../src/languages';
import type { DialogueStyle } from '../src/schema';
import { colourRuns, customFontFamily, pictureRef, resolveDialogueLook } from '../src/dialogueStyle';
import { drawTransition } from './transitionFx';

/** Remove scripts, embeds, inline handlers and script URLs; keep ordinary markup. */
export function sanitizeHtml(html: string): string {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  for (const tag of HTML_BLOCKED) doc.querySelectorAll(tag).forEach((el) => el.remove());
  doc.body.querySelectorAll('*').forEach((el) => {
    for (const a of [...el.attributes]) {
      const n = a.name.toLowerCase(), v = a.value.trim().toLowerCase();
      if (n.startsWith('on') || ((n === 'href' || n === 'src' || n === 'xlink:href' || n === 'action' || n === 'formaction') && (v.startsWith('javascript:') || v.startsWith('data:text/html'))) || n === 'srcdoc') el.removeAttribute(a.name);
    }
  });
  return doc.body.innerHTML;
}

/** Remove @import and url(...) loads from panel CSS: panels never fetch from the network. */
export function sanitizeCss(css: string): string {
  return css.replace(/@import[^;]*;?/gi, '').replace(/url\s*\([^)]*\)/gi, 'none');
}

const fill = (rt: Runtime, s: string) => s.replace(/\{\{\s*([A-Za-z_][\w.]*)\s*\}\}/g, (_m, name) => {
  try { const v = rt.evaluate(name, rt.baseCtx()); return String(typeof v === 'number' ? Math.round(v * 1000) / 1000 : v).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]!)); } catch { return ''; }
});

/** Imported fonts: loaded once each under their own family name. */
const loadedFonts = new Map<string, Promise<void>>();
export function ensureFont(name: string, url: string | null, onLoad?: () => void) {
  const fam = customFontFamily(name), key = fam + '|' + url;
  if (!url) return;
  let p = loadedFonts.get(key);
  if (!p) { p = new FontFace(fam, `url("${url}")`).load().then((f) => { (document.fonts as any).add(f); }).catch(() => { /* falls back to the preset's font */ }); loadedFonts.set(key, p); }
  if (onLoad) void p.then(onLoad);
}

/** What a built box can be asked while it's open. */
export interface DialogueBoxHandle {
  /** Letters still appearing? */ typing(): boolean;
  /** Show the whole line now (a click while it types). */ finish(): void;
  /** Stop its timers (it is being replaced). */ stop(): void;
  /** A key pressed while it's open (runtime key names: "Space", "ArrowLeft", "A", "1"…): true when the box used it. */ key(k: string): boolean;
  /** Responses picked one at a time with ◀ ▶ (so Left / Right are the box's while it's open)? */ picking(): boolean;
}

let boilSerial = 0;
const ANIM_IN: Record<string, (head: boolean) => Keyframe[]> = {
  fade: () => [{ opacity: 0 }, { opacity: 1 }],
  pop: () => [{ opacity: 0, transform: 'scale(.6)' }, { opacity: 1, transform: 'scale(1.06)', offset: 0.7 }, { opacity: 1, transform: 'scale(1)' }],
  slide: () => [{ opacity: 0, transform: 'translateY(30px)' }, { opacity: 1, transform: 'translateY(0)' }],
  drop: () => [{ opacity: 0, transform: 'translateY(-40px)' }, { opacity: 1, transform: 'translateY(0)' }],
  bounce: () => [{ opacity: 0, transform: 'scale(.3)' }, { opacity: 1, transform: 'scale(1.15)', offset: 0.5 }, { transform: 'scale(.94)', offset: 0.75 }, { transform: 'scale(1)' }],
  unfold: () => [{ opacity: 0.2, transform: 'scaleY(0)' }, { opacity: 1, transform: 'scaleY(1)' }],
};

/**
 * Fill `box` with a dialogue line in a style (also the Dialogue editor's preview): the preset and its overrides, your
 * own box picture (stretched or nine-slice), the speaker's portrait in its frame, the line (all at once or typed out),
 * and its choices; coming in with its animation, moving while open, its edges "boiling" with line noise. `o.head`: a
 * bubble over a head (the overlay places it), tail pointing down at the speaker. `o.choicesInto`: the choices go in
 * there instead (over the player's head). `o.fontUrl`: an imported font's file.
 */
export function buildDialogueBox(box: HTMLElement, style: DialogueStyle | undefined, line: { speaker: string; text: string; choices: { index: number; text: string }[] }, picture: (name: string | undefined) => string | null, on: { choose: (i: number) => void; next: () => void },
  o: { head?: boolean; choicesInto?: HTMLElement | null; fontUrl?: (name: string) => string | null } = {}): DialogueBoxHandle {
  const L = resolveDialogueLook(style);
  const pos = style?.position ?? 'bottom', head = !!o.head;
  const boxUrl = picture(style?.boxPicture);
  const slice = Math.max(1, Math.round(style?.slice ?? 24));
  const timers: number[] = [];
  if (style?.font?.startsWith('font:')) ensureFont(style.font.slice(5), o.fontUrl?.(style.font.slice(5)) ?? null);
  // The box: placed (bottom / middle / top of the screen, or over a head), carrying the text's look. Its background and
  // border are a separate layer underneath (the skin), so line noise wobbles the edges but never the letters.
  box.style.cssText = (head ? 'position:absolute;transform:translate(-50%,calc(-100% - 16px));'
    : `position:absolute;left:50%;${pos === 'top' ? 'top:4%;transform:translateX(-50%)' : pos === 'middle' ? 'top:50%;transform:translate(-50%,-50%)' : 'bottom:4%;transform:translateX(-50%)'};`)
    + `${head ? `width:max-content;max-width:${L.width};` : `width:${L.width};`}display:block;pointer-events:auto;color:${L.textColor};font-family:${L.font};font-size:${L.size}px;line-height:1.45;box-sizing:border-box;`;
  const anim = document.createElement('div'); anim.style.cssText = `position:relative;transform-origin:${head ? '50% 100%' : '50% 50%'};`;
  const idleEl = document.createElement('div'); idleEl.style.cssText = 'position:relative;';
  const skin = document.createElement('div');
  skin.style.cssText = 'position:absolute;inset:0;pointer-events:none;' + (boxUrl && style?.boxFit === 'nine-slice'
    ? `border-style:solid;border-width:${slice}px;border-image:url("${boxUrl}") ${slice} fill / ${slice}px stretch;background:none;`
    : boxUrl ? `background:url("${boxUrl}") center / 100% 100% no-repeat;border:none;`
      : `background:${L.background};border:${L.border};border-radius:${L.radius};box-shadow:${L.shadow};${L.blur ? `backdrop-filter:blur(${L.blur}px);` : ''}`);
  // Speech bubble tail: under a bubble over a head, pointing down at the speaker (centred); else near the left.
  if (L.tail && !boxUrl) {
    const t = document.createElement('div');
    const edge = L.border.split(' ').pop();
    t.style.cssText = `position:absolute;${!head && pos === 'top' ? 'top:-14px;transform:rotate(180deg);' : 'bottom:-14px;'}${head ? 'left:calc(50% - 12px);' : 'left:56px;'}width:0;height:0;border-left:12px solid transparent;border-right:12px solid transparent;border-top:15px solid ${L.background};filter:drop-shadow(0 2px 0 ${edge});`;
    skin.append(t);
  }
  const content = document.createElement('div'); content.style.cssText = `position:relative;padding:${L.padding};${boxUrl && style?.boxFit === 'nine-slice' ? `margin:${slice * 0.5}px;` : ''}`;
  // Line noise ("boil"): the skin seen through a displacement of fresh noise several times a second.
  if (L.boil > 0) {
    const id = 'gcboil' + ++boilSerial, ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg'); svg.setAttribute('width', '0'); svg.setAttribute('height', '0'); svg.style.position = 'absolute';
    svg.innerHTML = `<filter id="${id}" x="-10%" y="-10%" width="120%" height="120%"><feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="2" seed="1"/><feDisplacementMap in="SourceGraphic" scale="${(L.boil * 9).toFixed(2)}" xChannelSelector="R" yChannelSelector="G"/></filter>`;
    box.append(svg);
    skin.style.filter = `url(#${id})`;
    const turb = svg.querySelector('feTurbulence')!;
    let seed = 1;
    timers.push(window.setInterval(() => { seed = (seed % 97) + 1; turb.setAttribute('seed', String(seed)); }, 1000 / L.boilRate));
  }
  idleEl.append(skin, content); anim.append(idleEl); box.append(anim);

  const row = document.createElement('div'); row.style.cssText = 'display:flex;gap:14px;align-items:flex-start;';
  const shape = style?.portraitShape ?? (style?.preset === 'retro' ? 'square' : 'circle');
  const portraitUrl = shape === 'none' ? null : picture(style?.portraits?.[line.speaker] ?? Object.entries(style?.portraits ?? {}).find(([k]) => k.toLowerCase() === line.speaker.toLowerCase())?.[1]);
  if (portraitUrl) {
    const pw = document.createElement('div'), ps = L.portraitSize;
    pw.style.cssText = `position:relative;flex:none;width:${ps}px;height:${ps}px;`;
    const img = document.createElement('div');
    img.style.cssText = `position:absolute;inset:0;background:url("${portraitUrl}") center / contain no-repeat;${style?.preset === 'retro' ? 'image-rendering:pixelated;' : ''}border-radius:${shape === 'circle' ? '50%' : shape === 'rounded' ? '14px' : '0'};${style?.portraitFrame || style?.preset === 'retro' ? '' : `box-shadow:0 0 0 3px ${L.speakerColor};`}`;
    pw.append(img);
    const frame = picture(style?.portraitFrame);
    if (frame) { const f = document.createElement('div'); f.style.cssText = `position:absolute;inset:-8px;background:url("${frame}") center / 100% 100% no-repeat;pointer-events:none;`; pw.append(f); }
    if (style?.portraitSide === 'right') row.style.flexDirection = 'row-reverse';
    row.append(pw);
  }
  const col = document.createElement('div'); col.style.cssText = 'flex:1;min-width:0;';
  // (The retro box names nobody: its portrait says who speaks. A bubble over a head needs no name either.)
  if (line.speaker && !head && style?.preset !== 'retro') {
    const sp = document.createElement('div');
    sp.textContent = line.speaker;
    sp.style.cssText = `font-weight:700;font-size:${Math.round(L.size * 0.8)}px;letter-spacing:.04em;${L.uppercase ? 'text-transform:uppercase;' : ''}color:${L.speakerColor};margin-bottom:4px;`;
    col.append(sp);
  }
  const tx = document.createElement('div');
  tx.style.cssText = `white-space:pre-wrap;${L.uppercase && (style?.preset === 'ink' || style?.preset === 'retro') ? 'text-transform:uppercase;' : ''}${style?.preset === 'ink' ? 'font-weight:700;letter-spacing:.02em;' : ''}`;
  col.append(tx);
  // The line's letters, each its own element (so each can come in and move on its own), in words that never break,
  // coloured where the text says so ("[pink]Memu[/]"). A letter not yet typed isn't laid out at all, so a bubble that
  // fits its text grows as the line is typed.
  const glyphs: { outer: HTMLSpanElement; inner: HTMLSpanElement; ch: string; space: boolean }[] = [];
  for (const run of colourRuns(line.text)) {
    for (const part of run.text.split(/(\s+)/)) {
      if (!part) continue;
      if (/^\s+$/.test(part)) {
        for (const ch of part) { const s = document.createElement('span'); s.textContent = ch; glyphs.push({ outer: s, inner: s, ch, space: true }); tx.append(s); }
        continue;
      }
      const word = document.createElement('span');
      word.style.cssText = `display:inline-block;white-space:nowrap;${run.color ? `color:${run.color};` : ''}`;
      for (const ch of part) {
        const outer = document.createElement('span'), inner = document.createElement('span');
        outer.style.cssText = 'display:inline-block;'; inner.style.cssText = 'display:inline-block;';
        inner.textContent = ch; outer.append(inner); word.append(outer);
        glyphs.push({ outer, inner, ch, space: false });
      }
      tx.append(word);
    }
  }
  const amtT = L.textAmount, scrambles = new Set<{ end: () => void }>();
  const SCRAMBLE = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789#%&*?!@$';
  const rnd = () => Math.random() * 2 - 1;
  /** A letter coming in (`delay` ms after now; `quick`: the rest of a line shown at once, so no scrambling). */
  const enter = (g: typeof glyphs[number], i: number, delay: number, quick: boolean) => {
    g.outer.style.display = g.space ? '' : 'inline-block';
    if (g.space) return;
    const opt: KeyframeAnimationOptions = { duration: 260, delay, easing: 'cubic-bezier(.2,.8,.3,1)', fill: 'backwards' };
    switch (L.textIn) {
      case 'pop': g.inner.animate([{ transform: 'scale(0)', opacity: 0 }, { transform: `scale(${1 + 0.5 * amtT})`, opacity: 1, offset: 0.6 }, { transform: 'scale(1)' }], opt); break;
      case 'fade': g.inner.animate([{ opacity: 0 }, { opacity: 1 }], { ...opt, duration: 320, easing: 'ease-out' }); break;
      case 'slide': g.inner.animate([{ transform: `translateY(${4 + 14 * amtT}px)`, opacity: 0 }, { transform: 'translateY(0)', opacity: 1 }], opt); break;
      case 'bounce': g.inner.animate([{ transform: 'translateY(0)', opacity: 0 }, { transform: `translateY(${-(4 + 14 * amtT)}px)`, opacity: 1, offset: 0.45 }, { transform: `translateY(${2 * amtT}px)`, offset: 0.75 }, { transform: 'translateY(0)' }], { ...opt, duration: 380, easing: 'ease-out' }); break;
      case 'jumble': {
        // Each letter arrives tipped and the wrong size, and settles.
        const r = rnd() * (8 + 30 * amtT), s = 1 + rnd() * (0.15 + 0.5 * amtT), y = rnd() * 6 * amtT;
        g.inner.animate([{ transform: `translateY(${y}px) rotate(${r}deg) scale(${s})`, opacity: 0.2 }, { transform: `translateY(${-y * 0.4}px) rotate(${-r * 0.35}deg) scale(${1 + (s - 1) * -0.3})`, opacity: 1, offset: 0.55 }, { transform: 'none' }], { ...opt, duration: 300 + 300 * amtT });
        break;
      }
      case 'scramble': {
        if (quick) break;
        // The newest letter flickers through random letters before it lands on its own.
        let n = Math.round(2 + 6 * amtT), id = 0;
        const it = { end: () => { clearTimeout(id); g.inner.textContent = g.ch; scrambles.delete(it); } };
        scrambles.add(it);
        const flick = () => { if (n-- <= 0) { it.end(); return; } g.inner.textContent = SCRAMBLE[Math.floor(Math.random() * SCRAMBLE.length)]; id = window.setTimeout(flick, 35); };
        id = window.setTimeout(flick, delay);
        break;
      }
    }
    // Moving while shown: a wave along the line, a shake or a jitter.
    const a = 0.3 + amtT;
    if (L.textIdle === 'wave') g.outer.animate([{ transform: 'translateY(0)' }, { transform: `translateY(${-3.5 * a}px)` }], { duration: 650, delay: -((i * 70) % 1300), iterations: Infinity, direction: 'alternate', easing: 'ease-in-out' });
    else if (L.textIdle === 'shake') g.outer.animate([0, 1, 2, 3, 4].map((k) => ({ transform: `translate(${(((k * 37 + i * 11) % 7) - 3) * 0.45 * a}px,${(((k * 53 + i * 5) % 5) - 2) * 0.55 * a}px)` })), { duration: 220, iterations: Infinity, easing: 'steps(1)' });
    else if (L.textIdle === 'jitter') g.outer.animate([0, 1, 2, 3].map((k) => ({ transform: `rotate(${((((k + i) * 29) % 7) - 3) * 2 * a}deg) scale(${1 + ((((k + i) * 13) % 5) - 2) * 0.03 * a})` })), { duration: 480, iterations: Infinity, easing: 'steps(1)' });
  };
  // Below the text: the choices, or the "next" marker, shown once the line has been typed out.
  const after = document.createElement('div');
  const chooseInto = line.choices.length && o.choicesInto ? o.choicesInto : col;
  if (o.choicesInto) o.choicesInto.replaceChildren();
  // ◀ ▶: one response shown at a time, changed with the arrows (or Left / Right, A / D) and taken with a click,
  // Enter or Space.
  const arrows = L.choiceMode === 'arrows' && line.choices.length > 0;
  let pick = 0, setPick = (_n: number) => { /* set below */ };
  if (arrows) {
    const inBubble = chooseInto !== col;
    const wrap = document.createElement('div');
    wrap.style.cssText = `display:flex;align-items:center;justify-content:center;gap:10px;${inBubble ? '' : 'margin-top:10px;'}`;
    const label = document.createElement('div');
    label.style.cssText = `position:relative;min-width:60px;max-width:${inBubble ? 'min(300px,60vw)' : '100%'};text-align:center;cursor:pointer;pointer-events:auto;color:${L.textColor};font-family:${L.font};font-size:${L.size}px;line-height:1.35;padding:${inBubble ? '9px 18px' : '7px 14px'};${L.uppercase && style?.preset === 'ink' ? 'text-transform:uppercase;font-weight:700;' : ''}`
      + (inBubble ? `background:${L.background};border:${L.border};border-radius:${L.radius === '0' ? '0' : '18px'};box-shadow:${L.shadow};` : `background:${L.choiceBg};border:${L.choiceBorder};border-radius:${L.radius === '0' ? '0' : '10px'};`);
    const labelText = document.createElement('span');
    label.append(labelText);
    if (inBubble && L.tail) {
      const t = document.createElement('div');
      t.style.cssText = `position:absolute;bottom:-12px;left:calc(50% - 10px);width:0;height:0;border-left:10px solid transparent;border-right:10px solid transparent;border-top:13px solid ${L.background};`;
      label.append(t);
    }
    const dots = document.createElement('div');
    dots.style.cssText = `display:flex;gap:5px;justify-content:center;margin-top:${inBubble ? 18 : 6}px;`;
    const arrow = (dir: -1 | 1) => {
      const b = document.createElement('button');
      b.textContent = dir < 0 ? '◀' : '▶';
      b.title = dir < 0 ? 'Previous response (← / A)' : 'Next response (→ / D)';
      b.style.cssText = `flex:none;background:none;border:none;padding:2px 4px;cursor:pointer;pointer-events:auto;color:${inBubble ? '#fff' : L.textColor};font-size:${Math.round(L.size * 1.5)}px;line-height:1;text-shadow:0 2px 0 rgba(0,0,0,.55),0 0 6px rgba(0,0,0,.4);`;
      b.onpointerdown = (e) => { e.stopPropagation(); e.preventDefault(); if (typing) { finish(); return; } setPick(pick + dir); b.animate([{ transform: `translateX(${dir * 5}px) scale(1.2)` }, { transform: 'none' }], { duration: 180 }); };
      return b;
    };
    if (line.choices.length > 1) wrap.append(arrow(-1), label, arrow(1)); else wrap.append(label);
    label.onpointerdown = (e) => { e.stopPropagation(); e.preventDefault(); if (typing) { finish(); return; } on.choose(line.choices[pick].index); };
    setPick = (n: number) => {
      const len = line.choices.length;
      pick = ((n % len) + len) % len;
      labelText.textContent = line.choices[pick].text;
      dots.replaceChildren(...line.choices.map((_c, i) => { const d = document.createElement('span'); d.style.cssText = `width:6px;height:6px;border-radius:50%;background:${inBubble ? '#fff' : L.textColor};opacity:${i === pick ? 1 : 0.35};`; return d; }));
      labelText.animate([{ opacity: 0.2, transform: 'translateY(3px)' }, { opacity: 1, transform: 'none' }], { duration: 160 });
    };
    setPick(0);
    after.append(wrap);
    if (line.choices.length > 1) after.append(dots);
  } else if (line.choices.length) {
    for (const c of line.choices) {
      const b = document.createElement('button');
      b.textContent = style?.preset === 'retro' ? `▸ ${c.text}` : `${c.index}. ${c.text}`;
      const inBubble = chooseInto !== col;
      b.style.cssText = `display:block;${inBubble ? 'margin:6px auto 0;' : 'width:100%;margin-top:6px;'}text-align:left;background:${L.choiceBg};color:${inBubble ? L.textColor : 'inherit'};border:${L.choiceBorder};border-radius:${L.radius === '0' ? '0' : inBubble ? '999px' : '8px'};padding:${inBubble ? '7px 16px' : '7px 10px'};font-family:${L.font};font-size:${L.size - 1}px;cursor:pointer;pointer-events:auto;${L.uppercase && style?.preset === 'ink' ? 'text-transform:uppercase;font-weight:700;' : ''}`;
      b.onmouseenter = () => { b.style.background = L.choiceHover; };
      b.onmouseleave = () => { b.style.background = L.choiceBg; };
      b.onpointerdown = (e) => { e.stopPropagation(); e.preventDefault(); if (typing) { finish(); return; } on.choose(c.index); };
      after.append(b);
    }
  } else if (L.arrow) {
    const a = document.createElement('div'); a.textContent = '▼';
    a.style.cssText = 'position:absolute;right:14px;bottom:8px;font-size:12px;';
    a.animate([{ opacity: 1 }, { opacity: 0.15 }], { duration: 520, iterations: Infinity, direction: 'alternate' });
    after.append(a);
  } else if (!head) {
    const hint = document.createElement('div');
    hint.textContent = 'Click or press Space ▸';
    hint.style.cssText = 'text-align:right;font-size:12px;opacity:.6;margin-top:6px;';
    after.append(hint);
  }
  chooseInto.append(after);
  // The line: at once, or typed out a letter at a time.
  let typing = false, shown = 0;
  const finish = () => {
    if (!typing) return;
    typing = false;
    for (; shown < glyphs.length; shown++) enter(glyphs[shown], shown, 0, true);
    for (const s of [...scrambles]) s.end();
    after.style.display = '';
  };
  if (L.reveal === 'typewriter' && glyphs.length > 1) {
    // (The responses aren't laid out until the line is typed, so a bubble starts small and grows.)
    typing = true; after.style.display = 'none';
    for (const g of glyphs) g.outer.style.display = 'none';
    const step = Math.max(10, 1000 / L.typeSpeed);
    timers.push(window.setInterval(() => {
      if (!typing) return;
      enter(glyphs[shown], shown, 0, false); shown++;
      // (Spaces cost no time.)
      while (shown < glyphs.length && glyphs[shown].space) { enter(glyphs[shown], shown, 0, false); shown++; }
      if (shown >= glyphs.length) { typing = false; after.style.display = ''; }
    }, step));
  } else {
    // All at once: the letters still come in, one after another in quick succession.
    glyphs.forEach((g, i) => enter(g, i, L.textIn === 'none' ? 0 : i * 18, false));
    shown = glyphs.length;
  }
  row.append(col);
  content.append(row);
  const click = (e: PointerEvent) => { e.stopPropagation(); e.preventDefault(); if (typing) { finish(); return; } if (!line.choices.length) on.next(); };
  box.onpointerdown = click;
  // Coming in, then moving while open.
  const make = ANIM_IN[L.animIn];
  if (make && L.animTime > 0) anim.animate(make(head), { duration: L.animTime * 1000, easing: L.animIn === 'bounce' ? 'ease-out' : 'cubic-bezier(.2,.8,.3,1)', fill: 'both' });
  const amt = L.idleAmount;
  if (L.idle === 'float') idleEl.animate([{ transform: 'translateY(0)' }, { transform: `translateY(${-8 * amt}px)` }], { duration: 1800, iterations: Infinity, direction: 'alternate', easing: 'ease-in-out' });
  else if (L.idle === 'wobble') idleEl.animate([{ transform: `rotate(${-2.5 * amt}deg)` }, { transform: `rotate(${2.5 * amt}deg)` }], { duration: 1500, iterations: Infinity, direction: 'alternate', easing: 'ease-in-out' });
  else if (L.idle === 'shake') idleEl.animate([0, 1, 2, 3, 4, 5].map((k) => ({ transform: `translate(${(((k * 37) % 7) - 3) * amt}px,${(((k * 53) % 5) - 2) * amt}px)` })), { duration: 300, iterations: Infinity });
  const key = (k: string) => {
    const K = k.toLowerCase(), go = K === 'space' || K === 'enter', side = K === 'arrowleft' || K === 'a' ? -1 : K === 'arrowright' || K === 'd' ? 1 : 0;
    if (typing) { if (go || /^[1-9]$/.test(K) || (arrows && side)) { finish(); return true; } return false; }
    if (arrows) {
      if (side) { setPick(pick + side); return true; }
      if (go) { on.choose(line.choices[pick].index); return true; }
    }
    return false;
  };
  return { typing: () => typing, finish, key, picking: () => arrows, stop: () => { for (const t of timers) clearInterval(t); for (const s of [...scrambles]) s.end(); } };
}

export class GameOverlay {
  private root: HTMLDivElement;
  private dlg: HTMLDivElement;
  private fade: HTMLDivElement;
  private panels = new Map<string, { host: HTMLDivElement; shadow: ShadowRoot; html: string; css: string }>();
  private dlgKey = '';
  private dlgHandle: DialogueBoxHandle | null = null;
  /** The player's choices, over the player's head when lines are spoken in bubbles. */
  private choiceEl: HTMLDivElement | null = null;
  /**
   * Set by the host: where on the game view (px) the top of a speaker's head is ("__player__": the player's), or null
   * when that speaker isn't in view or the player is seen in first person: then the line is shown in a box.
   */
  locate: ((speaker: string) => { x: number; y: number } | null) | null = null;
  /** Transition drawing (every style but fade), created on first use. */
  private fxCanvas: HTMLCanvasElement | null = null;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'go-root';
    this.root.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:30;overflow:hidden;font-family:"Segoe UI",system-ui,sans-serif;';
    this.dlg = document.createElement('div');
    this.dlg.style.cssText = 'position:absolute;left:50%;bottom:4%;transform:translateX(-50%);width:min(720px,92%);display:none;pointer-events:auto;background:rgba(14,16,24,.92);color:#fff;border:1px solid rgba(255,255,255,.18);border-radius:12px;padding:14px 18px 12px;box-shadow:0 12px 40px rgba(0,0,0,.5);font-size:16px;line-height:1.45;';
    this.fade = document.createElement('div');
    this.fade.style.cssText = 'position:absolute;inset:0;opacity:0;pointer-events:none;';
    this.root.append(this.dlg, this.fade);
    if (getComputedStyle(parent).position === 'static') parent.style.position = 'relative';
    parent.appendChild(this.root);
  }

  dispose() { this.root.remove(); }

  /** Text-game view: the whole story so far, the current choices, and a status line. */
  private story: HTMLDivElement | null = null;
  private storyLog: HTMLDivElement | null = null;
  private storyBar: HTMLDivElement | null = null;
  private storyChoices: HTMLDivElement | null = null;
  private storyCount = 0;
  private storyRt: Runtime | null = null;
  private storyKey = '';

  private updateStory(rt: Runtime | null) {
    const on = rt?.scene.settings.presentation === 'text';
    if (!on || !rt) { this.story?.remove(); this.story = null; return; }
    if (!this.story) {
      const s = document.createElement('div');
      s.style.cssText = 'position:absolute;inset:0;pointer-events:auto;background:radial-gradient(ellipse at top,#231d15,#0f0d0a 70%);color:#eae3d2;display:flex;flex-direction:column;font-family:Georgia,"Times New Roman",serif;';
      const bar = document.createElement('div');
      bar.style.cssText = 'padding:10px 24px;border-bottom:1px solid rgba(234,227,210,.15);font-family:"Segoe UI",system-ui,sans-serif;font-size:13px;color:#cdbf9e;min-height:18px;';
      const log = document.createElement('div');
      log.style.cssText = 'flex:1;overflow-y:auto;padding:24px max(24px,calc(50% - 360px)) 8px;font-size:19px;line-height:1.6;';
      const ch = document.createElement('div');
      ch.style.cssText = 'padding:8px max(24px,calc(50% - 360px)) 22px;display:flex;flex-direction:column;gap:6px;';
      s.append(bar, log, ch);
      this.root.insertBefore(s, this.fade);
      this.story = s; this.storyLog = log; this.storyBar = bar; this.storyChoices = ch; this.storyCount = 0;
    }
    if (this.storyRt !== rt || rt.storyLog.length < this.storyCount) { this.storyLog!.replaceChildren(); this.storyCount = 0; this.storyRt = rt; this.storyKey = ''; }
    // New story entries.
    for (; this.storyCount < rt.storyLog.length; this.storyCount++) {
      const e = rt.storyLog[this.storyCount];
      const p = document.createElement('p');
      p.style.cssText = e.kind === 'choice' ? 'margin:6px 0 14px;color:#e2b863;font-style:italic;' : 'margin:0 0 12px;';
      if (e.kind === 'choice') p.textContent = '› ' + e.text;
      else {
        if (e.speaker && !/^(narrator|story)$/i.test(e.speaker)) { const b = document.createElement('b'); b.textContent = e.speaker + ': '; b.style.color = '#f3d9a4'; p.append(b); }
        for (const r of colourRuns(e.text)) { if (r.color) { const c = document.createElement('span'); c.style.color = r.color; c.textContent = r.text; p.append(c); } else p.append(document.createTextNode(r.text)); }
      }
      this.storyLog!.append(p);
      p.scrollIntoView({ block: 'end' });
    }
    // Status line: the "status" global variable, if the game has one.
    const status = rt.globals.status;
    const statusText = status === undefined ? '' : String(status);
    if (this.storyBar!.textContent !== statusText) this.storyBar!.textContent = statusText;
    // Choices / continue / the end.
    const st = rt.dialogue;
    const key = st ? st.nodeId + '|' + st.choices.map((c) => c.text).join('|') : 'end' + rt.storyLog.length;
    if (key === this.storyKey) return;
    this.storyKey = key;
    this.storyChoices!.replaceChildren();
    const btn = (label: string, on: () => void) => {
      const b = document.createElement('button');
      b.textContent = label;
      b.style.cssText = 'text-align:left;background:rgba(234,227,210,.06);color:#eae3d2;border:1px solid rgba(234,227,210,.22);border-radius:8px;padding:9px 14px;font:inherit;font-size:17px;cursor:pointer;';
      b.onmouseenter = () => { b.style.background = 'rgba(226,184,99,.18)'; };
      b.onmouseleave = () => { b.style.background = 'rgba(234,227,210,.06)'; };
      b.onpointerdown = (ev) => { ev.stopPropagation(); ev.preventDefault(); on(); };
      this.storyChoices!.append(b);
    };
    if (st?.choices.length) for (const c of st.choices) btn(`${c.index}. ${c.text}`, () => rt.dialogueChoose(c.index));
    else if (st) btn('Continue ▸  (Space)', () => rt.dialogueContinue());
    else if (rt.storyLog.length) { const e = document.createElement('div'); e.textContent = '— The End —   (press R to play again)'; e.style.cssText = 'text-align:center;color:#cdbf9e;font-style:italic;padding:8px;'; this.storyChoices!.append(e); }
  }

  /** Video file reference -> URL (set by the host; cutscenes). */
  resolveMedia: (ref: string) => string | null = () => null;
  private video: HTMLVideoElement | null = null;
  private videoSerial = -1;

  /** Cutscene video: one element per Play, sized fullscreen or windowed, reporting its time back to the runtime. */
  private updateVideo(rt: Runtime | null, gamePaused: boolean) {
    const v = rt?.ui.video ?? null;
    if (!v || !rt) {
      if (this.video) { this.video.pause(); this.video.removeAttribute('src'); this.video.load(); this.video.remove(); this.video = null; this.videoSerial = -1; }
      return;
    }
    if (!this.video || this.videoSerial !== v.serial) {
      this.video?.remove();
      const el = document.createElement('video');
      el.playsInline = true; el.preload = 'auto';
      v.hostDriven = true;
      const url = this.resolveMedia(v.ref);
      if (!url) { rt.report('warn', `Video "${v.name}": its file could not be found`); v.ended = true; }
      else {
        el.src = url; el.loop = v.loop; el.volume = v.volume;
        el.onended = () => { if (rt.ui.video === v) v.ended = true; };
        el.onerror = () => { if (rt.ui.video === v) { rt.report('warn', `Video "${v.name}" could not be played (use MP4 H.264 or WebM)`); v.ended = true; } };
        el.onloadedmetadata = () => { if (Number.isFinite(el.duration)) v.duration = el.duration; };
        // Browsers may refuse sound before the player has interacted; play muted rather than not at all.
        el.play().catch(() => { el.muted = true; el.play().catch(() => { /* reported by onerror */ }); });
      }
      this.root.insertBefore(el, this.dlg); // dialogue boxes stay readable over a cutscene
      this.video = el; this.videoSerial = v.serial;
    }
    const el = this.video;
    const fit = v.fit === 'stretch' ? 'fill' : v.fit;
    el.style.cssText = v.fullscreen
      ? `position:absolute;inset:0;width:100%;height:100%;background:#000;object-fit:${fit};pointer-events:none;`
      : `position:absolute;left:${v.x}%;top:${v.y}%;width:${v.w}%;transform:translate(-50%,-50%);object-fit:${fit};border-radius:8px;box-shadow:0 10px 40px rgba(0,0,0,.55);background:#000;pointer-events:none;`;
    el.loop = v.loop;
    if (Math.abs(el.volume - v.volume) > 0.01) el.volume = v.volume;
    const shouldPlay = !v.paused && !gamePaused && !v.ended;
    if (!shouldPlay && !el.paused) el.pause();
    if (shouldPlay && el.paused && el.src && el.readyState > 0) el.play().catch(() => { /* retried next frame */ });
    if (el.src) v.time = el.currentTime;
  }

  update(rt: Runtime | null, gamePaused = false) {
    this.updateVideo(rt, gamePaused);
    this.updateStory(rt);
    const textMode = rt?.scene.settings.presentation === 'text';
    const st = textMode ? null : rt?.dialogue ?? null;
    // Dialogue box: rebuilt only when the line or the look changes (or a bubble's speaker comes into or leaves view).
    const look = rt?.doc.dialogueStyle;
    const L = resolveDialogueLook(look);
    const at = st && L.placement === 'head' && this.locate ? this.locate(st.speaker) : null;
    const playerAt = st?.choices.length && at && this.locate ? this.locate('__player__') : null;
    const key = st ? `${st.dialogue}|${st.nodeId}|${st.text}|${st.choices.map((c) => c.text).join('|')}|${JSON.stringify(look ?? '')}|${!!at}|${!!playerAt}` : '';
    if (key !== this.dlgKey) {
      this.dlgKey = key;
      this.dlgHandle?.stop(); this.dlgHandle = null;
      this.dlg.replaceChildren(); this.choiceEl?.replaceChildren();
      this.dlg.style.display = st ? 'block' : 'none';
      if (st && playerAt && !this.choiceEl) { this.choiceEl = document.createElement('div'); this.root.insertBefore(this.choiceEl, this.fade); }
      if (st && rt) {
        this.dlgHandle = buildDialogueBox(this.dlg, look, st, (name) => { const ref = pictureRef(rt.doc.pictures, name); return ref ? this.resolveMedia(ref) : null; }, {
          choose: (i) => rt.dialogueChoose(i), next: () => rt.dialogueContinue(),
        }, { head: !!at, choicesInto: playerAt ? this.choiceEl : null, fontUrl: (name) => { const ref = pictureRef(rt.doc.fonts, name); return ref ? this.resolveMedia(ref) : null; } });
        const h = this.dlgHandle;
        rt.dialogueHold = (k) => h.key(k);
        rt.dialogueFreeze = h.picking();
      } else if (rt) rt.dialogueFreeze = false;
    }
    // Bubbles follow their speaker (and the choices the player) every frame, always wholly on the screen.
    const fit = (el: HTMLElement, p: { x: number; y: number }, gap: number) => {
      const W = this.root.clientWidth, H = this.root.clientHeight, w = el.offsetWidth, h = el.offsetHeight, m = 8;
      el.style.left = `${Math.max(w / 2 + m, Math.min(W - w / 2 - m, p.x))}px`;
      el.style.top = `${Math.max(h + gap + m, Math.min(H - m, p.y))}px`;
    };
    if (at) fit(this.dlg, at, 16);
    if (this.choiceEl) {
      this.choiceEl.style.display = playerAt ? 'block' : 'none';
      if (playerAt) {
        this.choiceEl.style.cssText = 'position:absolute;transform:translate(-50%,calc(-100% - 12px));pointer-events:auto;display:block;text-align:center;width:max-content;max-width:min(460px,92%);';
        fit(this.choiceEl, playerAt, 12);
        // (Each bubble stays over its own speaker's head; the player's response is drawn in front if they meet.)
      }
    }
    // HTML panels.
    const want = rt?.ui.panels ?? {};
    for (const [name, p] of this.panels) if (!want[name]?.visible) { p.host.remove(); this.panels.delete(name); }
    if (rt) {
      for (const [name, p] of Object.entries(want)) {
        if (!p.visible) continue;
        let el = this.panels.get(name);
        if (!el) {
          const host = document.createElement('div');
          host.style.cssText = 'position:absolute;inset:0;pointer-events:none;';
          const shadow = host.attachShadow({ mode: 'open' });
          shadow.addEventListener('click', (e) => {
            const t = (e.target as HTMLElement).closest?.('[data-button]') as HTMLElement | null;
            if (t) { e.stopPropagation(); rt.input.uiButtons.push(t.dataset.button!); }
          });
          this.root.insertBefore(host, this.dlg);
          el = { host, shadow, html: '', css: '' };
          this.panels.set(name, el);
        }
        const html = fill(rt, p.html);
        const css = rt.ui.panelCss?.[name] ?? '';
        if (html !== el.html || css !== el.css) {
          el.html = html; el.css = css;
          el.shadow.innerHTML = `<style>:host{all:initial}.wrap{position:absolute;top:16px;left:16px;pointer-events:auto;font-family:"Segoe UI",system-ui,sans-serif;color:#fff}button{cursor:pointer}${sanitizeCss(css)}</style><div class="wrap">${sanitizeHtml(html)}</div>`;
        }
      }
    }
    // Screen transition (scene changes, Cover / Uncover screen): fade is a see-through layer (with the cover picture
    // when there is one); every other style is drawn into the transition canvas (transitionFx.ts).
    const a = rt ? rt.transitionAlpha() : 0;
    const tr = rt?.ui.transition, color = tr?.color ?? '#000', style = tr?.style ?? 'fade';
    const cover = tr?.cover ? this.resolveMedia(tr.cover) : null;
    const f = this.fade.style;
    if (style === 'fade' || !a) {
      f.opacity = String(a); f.background = cover ? `${color} url("${cover}") center / cover no-repeat` : color;
      if (this.fxCanvas) this.fxCanvas.style.display = 'none';
    } else {
      f.opacity = '0';
      if (!this.fxCanvas) { this.fxCanvas = document.createElement('canvas'); this.fxCanvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;'; this.root.append(this.fxCanvas); }
      this.fxCanvas.style.display = 'block';
      drawTransition(this.fxCanvas, a, { style, color, cover, shape: tr?.shape ? this.resolveMedia(tr.shape) : null });
    }
  }
}
