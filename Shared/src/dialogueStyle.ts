// Dialogue box looks: presets, and the resolved look of a DialogueStyle (preset + overrides), used by the game
// overlay and the Dialogue editor's preview so both match.
import type { DialogueStyle } from './schema';

export interface DialogueLook {
  background: string; border: string; radius: string; shadow: string; textColor: string; speakerColor: string;
  font: string; size: number; padding: string; choiceBg: string; choiceHover: string; choiceBorder: string;
  /** Backdrop blur (glass). */
  blur: number; uppercase: boolean;
  /** Speech-bubble tail under the box. */
  tail: boolean;
  /** The preset's own defaults for where the line goes and how it moves (a style's own settings win). */
  placement: 'screen' | 'head'; reveal: 'instant' | 'typewriter'; typeSpeed: number;
  animIn: NonNullable<DialogueStyle['animIn']>; animTime: number; idle: NonNullable<DialogueStyle['idle']>; idleAmount: number; boil: number; boilRate: number;
  /** Portrait size (px) and a frame round it drawn as the box's own border. */
  portraitSize: number; portraitBorder: string;
  /** "Next" marker: a blinking arrow in the corner instead of the "Click or press Space" hint. */
  arrow: boolean;
  /** Box width (CSS). */
  width: string;
  /** Letters: how each appears, how they move while shown, and how much (0-1). Responses: a list, or one at a time with arrows. */
  textIn: NonNullable<DialogueStyle['textIn']>; textIdle: NonNullable<DialogueStyle['textIdle']>; textAmount: number; choiceMode: NonNullable<DialogueStyle['choiceMode']>;
}

const MOTION = { placement: 'screen' as const, reveal: 'instant' as const, typeSpeed: 40, animIn: 'fade' as const, animTime: 0.2, idle: 'none' as const, idleAmount: 0.3, boil: 0, boilRate: 8, portraitSize: 72, portraitBorder: '', arrow: false, width: 'min(720px,92%)', textIn: 'none' as const, textIdle: 'none' as const, textAmount: 0.5, choiceMode: 'list' as const };

type BaseLook = Omit<DialogueLook, keyof typeof MOTION> & Partial<Pick<DialogueLook, keyof typeof MOTION>>;
const PRESETS0: Record<DialogueStyle['preset'], { label: string; look: BaseLook }> = {
  // Retro box: a black box in a thick white frame, a big square portrait, pixel lettering typed out one letter at a time.
  retro: { label: 'Retro box', look: { background: '#000000', border: '5px solid #ffffff', radius: '0', shadow: '0 0 0 3px #000000', textColor: '#ffffff', speakerColor: '#ffffff', font: 'retro', size: 20, padding: '20px 26px', choiceBg: 'transparent', choiceHover: 'rgba(255,255,255,.12)', choiceBorder: '0', blur: 0, uppercase: true, tail: false,
    reveal: 'typewriter', typeSpeed: 30, animIn: 'none', portraitSize: 96, portraitBorder: '', arrow: true, width: 'min(760px,92%)' } },
  // Ink bubble: a near-black rounded bubble with a tail, over the speaker's head, bold rounded capitals.
  ink: { label: 'Ink bubble', look: { background: '#141518', border: '2px solid #141518', radius: '34px', shadow: '0 6px 18px rgba(0,0,0,.35)', textColor: '#f4efe2', speakerColor: '#f2c35b', font: 'rounded', size: 17, padding: '14px 24px', choiceBg: '#141518', choiceHover: '#2c2e35', choiceBorder: '2px solid #f4efe2', blur: 0, uppercase: true, tail: true,
    placement: 'head', reveal: 'typewriter', typeSpeed: 30, animIn: 'pop', animTime: 0.22, idle: 'float', idleAmount: 0.25, width: 'min(360px,80%)', textIn: 'jumble', textAmount: 0.5, choiceMode: 'arrows' } },
  dark: { label: 'Dark', look: { background: 'rgba(14,16,24,.92)', border: '1px solid rgba(255,255,255,.18)', radius: '12px', shadow: '0 12px 40px rgba(0,0,0,.5)', textColor: '#ffffff', speakerColor: '#ffd27a', font: 'sans', size: 16, padding: '14px 18px 12px', choiceBg: 'rgba(255,255,255,.08)', choiceHover: 'rgba(255,210,122,.25)', choiceBorder: '1px solid rgba(255,255,255,.2)', blur: 0, uppercase: true, tail: false } },
  light: { label: 'Light', look: { background: 'rgba(250,250,252,.96)', border: '1px solid rgba(0,0,0,.12)', radius: '12px', shadow: '0 10px 30px rgba(0,0,0,.25)', textColor: '#1d1f27', speakerColor: '#3b5bdb', font: 'sans', size: 16, padding: '14px 18px 12px', choiceBg: 'rgba(0,0,0,.05)', choiceHover: 'rgba(59,91,219,.15)', choiceBorder: '1px solid rgba(0,0,0,.12)', blur: 0, uppercase: true, tail: false } },
  parchment: { label: 'Parchment', look: { background: 'linear-gradient(#f3e6c4,#e6d3a3)', border: '2px solid #8a6a3a', radius: '6px', shadow: '0 10px 30px rgba(40,25,5,.45)', textColor: '#3b2a12', speakerColor: '#7a3e12', font: 'serif', size: 17, padding: '16px 22px 14px', choiceBg: 'rgba(122,62,18,.08)', choiceHover: 'rgba(122,62,18,.2)', choiceBorder: '1px solid rgba(122,62,18,.35)', blur: 0, uppercase: false, tail: false } },
  bubble: { label: 'Speech bubble', look: { background: '#ffffff', border: '3px solid #1d1f27', radius: '26px', shadow: '0 8px 22px rgba(0,0,0,.3)', textColor: '#1d1f27', speakerColor: '#d6336c', font: 'sans', size: 16, padding: '14px 22px 14px', choiceBg: '#f1f3f5', choiceHover: '#ffe3ec', choiceBorder: '2px solid #1d1f27', blur: 0, uppercase: false, tail: true } },
  pixel: { label: 'Pixel', look: { background: '#1b1b3a', border: '4px solid #e8e8f0', radius: '0', shadow: '0 0 0 4px #1b1b3a', textColor: '#e8e8f0', speakerColor: '#7ee081', font: 'pixel', size: 15, padding: '14px 18px', choiceBg: '#2a2a55', choiceHover: '#3d3d7a', choiceBorder: '2px solid #e8e8f0', blur: 0, uppercase: true, tail: false } },
  comic: { label: 'Comic', look: { background: '#fff7b0', border: '3px solid #111', radius: '4px', shadow: '6px 6px 0 #111', textColor: '#111', speakerColor: '#c92a2a', font: 'comic', size: 17, padding: '12px 18px', choiceBg: '#ffffff', choiceHover: '#ffd43b', choiceBorder: '2px solid #111', blur: 0, uppercase: true, tail: false } },
  glass: { label: 'Glass', look: { background: 'rgba(255,255,255,.14)', border: '1px solid rgba(255,255,255,.35)', radius: '16px', shadow: '0 12px 40px rgba(0,0,0,.35)', textColor: '#ffffff', speakerColor: '#a5d8ff', font: 'sans', size: 16, padding: '14px 18px 12px', choiceBg: 'rgba(255,255,255,.12)', choiceHover: 'rgba(165,216,255,.3)', choiceBorder: '1px solid rgba(255,255,255,.3)', blur: 10, uppercase: false, tail: false } },
};
export const DIALOGUE_PRESETS = Object.fromEntries(Object.entries(PRESETS0).map(([k, v]) => [k, { label: v.label, look: { ...MOTION, ...v.look } as DialogueLook }])) as Record<DialogueStyle['preset'], { label: string; look: DialogueLook }>;

export const DIALOGUE_ANIMS: Record<NonNullable<DialogueStyle['animIn']>, string> = { none: 'None', fade: 'Fade in', pop: 'Pop', slide: 'Slide up', drop: 'Drop down', bounce: 'Bounce', unfold: 'Unfold' };
export const DIALOGUE_IDLES: Record<NonNullable<DialogueStyle['idle']>, string> = { none: 'Still', float: 'Float', wobble: 'Wobble', shake: 'Shake' };
export const TEXT_INS: Record<NonNullable<DialogueStyle['textIn']>, string> = { none: 'Plain', pop: 'Pop', fade: 'Fade', slide: 'Slide up', bounce: 'Bounce', scramble: 'Scramble', jumble: 'Jumble (tilt and settle)' };
export const TEXT_IDLES: Record<NonNullable<DialogueStyle['textIdle']>, string> = { none: 'Still', wave: 'Wave', shake: 'Shake', jitter: 'Jitter' };

/** Named colours for coloured words in a line ([pink]word[/]). */
const NAMED: Record<string, string> = { pink: '#ff8fb1', red: '#ff5d5d', orange: '#ffa94d', yellow: '#ffd43b', green: '#69db7c', teal: '#38d9a9', blue: '#74c0fc', purple: '#b197fc', white: '#ffffff', grey: '#adb5bd', gray: '#adb5bd' };
/** A line split into runs of plain and coloured text: [pink]Memu[/] or [#ff88aa]Memu[/]. Unknown tags stay as written. */
export function colourRuns(text: string): { text: string; color?: string }[] {
  const out: { text: string; color?: string }[] = [];
  const re = /\[(#[0-9a-fA-F]{3,8}|[a-zA-Z]+)\]([\s\S]*?)\[\/\]/g;
  let last = 0, m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const col = m[1].startsWith('#') ? m[1] : NAMED[m[1].toLowerCase()];
    if (!col) continue;
    if (m.index > last) out.push({ text: text.slice(last, m.index) });
    out.push({ text: m[2], color: col });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}
/** A line's words without colour tags (for the story log, lengths and tests). */
export const plainText = (text: string) => colourRuns(text).map((r) => r.text).join('');

export const DIALOGUE_FONTS: Record<string, { label: string; css: string }> = {
  sans: { label: 'Clean', css: '"Segoe UI",system-ui,sans-serif' },
  serif: { label: 'Storybook', css: 'Georgia,"Times New Roman",serif' },
  mono: { label: 'Typewriter', css: '"Courier New",Consolas,monospace' },
  pixel: { label: 'Pixel', css: '"Press Start 2P","Lucida Console","Courier New",monospace' },
  comic: { label: 'Comic', css: '"Comic Sans MS","Comic Neue","Chalkboard SE",cursive' },
  rounded: { label: 'Rounded bold', css: '"Arial Rounded MT Bold","Trebuchet MS","Segoe UI",sans-serif' },
  retro: { label: 'Retro', css: '"Lucida Console","Consolas","Courier New",monospace' },
};

/** CSS family name an imported font is loaded under ("font:<name>" in a style). */
export const customFontFamily = (name: string) => 'gcdlg_' + name.replace(/[^A-Za-z0-9_]/g, '_');
export const FONT_ACCEPT = '.ttf,.otf,.woff,.woff2';

/** The look of a style: the preset with the style's overrides on top. */
export function resolveDialogueLook(s: DialogueStyle | undefined): DialogueLook {
  const base = DIALOGUE_PRESETS[s?.preset ?? 'dark']?.look ?? DIALOGUE_PRESETS.dark.look;
  const font = s?.font ?? base.font;
  const fontCss = font.startsWith('font:') ? `"${customFontFamily(font.slice(5))}",${DIALOGUE_FONTS[base.font]?.css ?? 'sans-serif'}` : DIALOGUE_FONTS[font]?.css ?? font;
  return {
    ...base,
    background: s?.background || base.background,
    border: s?.border || base.border,
    textColor: s?.textColor || base.textColor,
    speakerColor: s?.speakerColor || base.speakerColor,
    font: fontCss,
    placement: s?.placement ?? base.placement,
    reveal: s?.reveal ?? base.reveal, typeSpeed: Math.max(2, s?.typeSpeed ?? base.typeSpeed),
    animIn: s?.animIn ?? base.animIn, animTime: Math.max(0, s?.animTime ?? base.animTime),
    idle: s?.idle ?? base.idle, idleAmount: Math.max(0, Math.min(1, s?.idleAmount ?? base.idleAmount)),
    boil: Math.max(0, Math.min(1, s?.boil ?? base.boil)), boilRate: Math.max(1, Math.min(30, s?.boilRate ?? base.boilRate)),
    textIn: s?.textIn ?? base.textIn, textIdle: s?.textIdle ?? base.textIdle, textAmount: Math.max(0, Math.min(1, s?.textAmount ?? base.textAmount)), choiceMode: s?.choiceMode ?? base.choiceMode,
  };
}

/** Picture name -> stored reference (Pictures panel), or null. */
export function pictureRef(pictures: { name: string; ref: string }[] | undefined, name: string | undefined): string | null {
  const n = String(name ?? '').trim().toLowerCase();
  if (!n) return null;
  return pictures?.find((p) => p.name.toLowerCase() === n)?.ref ?? null;
}
