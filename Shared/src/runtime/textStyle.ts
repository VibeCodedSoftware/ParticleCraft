// Text appearance shared by GameCraft (HUD as HTML, world text as a canvas texture) and LogicCraft (canvas stage).

export interface TextStyle {
  /** Background box: color, opacity 0-1, optional image asset id (stretched to the box). */
  bg?: string; bgOpacity?: number; bgImage?: string;
  padding?: number; radius?: number;
  border?: string; borderWidth?: number;
  /** Outline around the letters. */
  outline?: string; outlineWidth?: number;
  /** Drop shadow. */
  shadow?: string; shadowBlur?: number; shadowX?: number; shadowY?: number;
  bold?: boolean; italic?: boolean; uppercase?: boolean; underline?: boolean;
  /** Font weight 100-900 (overrides bold). */
  weight?: number;
  /** A font installed on every computer ("Georgia", "Courier New"...); an imported font file (TextData.font) wins. */
  fontFamily?: string;
  letterSpacing?: number; lineHeight?: number;
  /** Wrap width in pixels (0 = one line). */
  maxWidth?: number;
}

export const TEXT_STYLE_PRESETS: Record<string, { name: string; style: TextStyle }> = {
  plain: { name: 'Plain', style: {} },
  outlined: { name: 'Outlined (game title)', style: { bold: true, outline: '#000000', outlineWidth: 4 } },
  shadow: { name: 'Soft shadow', style: { shadow: '#000000', shadowBlur: 6, shadowX: 2, shadowY: 2 } },
  panel: { name: 'Dark panel', style: { bg: '#0c0b08', bgOpacity: 0.8, padding: 10, radius: 6, border: '#ffffff', borderWidth: 1 } },
  pill: { name: 'Pill button', style: { bg: '#a733f0', bgOpacity: 1, padding: 10, radius: 999, bold: true } },
  subtitle: { name: 'Subtitle', style: { bg: '#000000', bgOpacity: 0.55, padding: 8, radius: 4, maxWidth: 600, lineHeight: 1.3 } },
  retro: { name: 'Retro pixel', style: { bold: true, uppercase: true, letterSpacing: 2, outline: '#1a1a2e', outlineWidth: 3, shadow: '#000000', shadowX: 3, shadowY: 3 } },
};

/** Fonts present on Windows, macOS and most Linux desktops (with a generic fallback each). */
export const SYSTEM_FONTS: Record<string, string> = {
  'System UI': 'system-ui, "Segoe UI", sans-serif',
  Arial: 'Arial, Helvetica, sans-serif',
  Verdana: 'Verdana, Geneva, sans-serif',
  Tahoma: 'Tahoma, Verdana, sans-serif',
  'Trebuchet MS': '"Trebuchet MS", sans-serif',
  Impact: 'Impact, "Arial Black", sans-serif',
  Georgia: 'Georgia, serif',
  'Times New Roman': '"Times New Roman", Times, serif',
  Garamond: 'Garamond, Georgia, serif',
  'Courier New': '"Courier New", Courier, monospace',
  Consolas: 'Consolas, "Courier New", monospace',
  'Comic Sans MS': '"Comic Sans MS", "Comic Sans", cursive',
};
export function cssFamily(name: string): string { return SYSTEM_FONTS[name] ?? `"${name.replace(/"/g, '')}", system-ui, sans-serif`; }
/** Canvas font string for a text object (2D stages and screen-space text planes). */
export function canvasFont(size: number, s: TextStyle | undefined, family?: string): string {
  const w = s?.weight ?? (s?.bold ? 700 : 400);
  return `${s?.italic ? 'italic ' : ''}${w} ${size}px ${family ?? (s?.fontFamily ? cssFamily(s.fontFamily) : 'system-ui, "Segoe UI", sans-serif')}`;
}

export function rgba(hex: string | undefined, a = 1): string {
  const h = (hex ?? '#000000').replace('#', '');
  const f = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.padEnd(6, '0');
  const n = parseInt(f.slice(0, 6), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${Math.max(0, Math.min(1, a))})`;
}

/** CSS declarations for an HTML text element. `image` resolves a bgImage asset id to a URL. */
export function textStyleCss(s: TextStyle | undefined, image?: (id: string) => string | null): string {
  if (!s) return '';
  const out: string[] = [];
  if (s.bg) out.push(`background-color:${rgba(s.bg, s.bgOpacity ?? 1)}`);
  if (s.bgImage) { const u = image?.(s.bgImage); if (u) out.push(`background-image:url("${u}")`, 'background-size:100% 100%'); }
  if (s.padding) out.push(`padding:${s.padding}px ${Math.round(s.padding * 1.4)}px`);
  if (s.radius) out.push(`border-radius:${s.radius}px`);
  if (s.borderWidth) out.push(`border:${s.borderWidth}px solid ${s.border ?? '#ffffff'}`);
  if (s.outlineWidth) out.push(`-webkit-text-stroke:${s.outlineWidth}px ${s.outline ?? '#000'}`, 'paint-order:stroke fill');
  if (s.shadow) out.push(`text-shadow:${s.shadowX ?? 0}px ${s.shadowY ?? 0}px ${s.shadowBlur ?? 0}px ${s.shadow}`);
  if (s.weight) out.push(`font-weight:${s.weight}`); else if (s.bold) out.push('font-weight:700');
  if (s.italic) out.push('font-style:italic');
  if (s.underline) out.push('text-decoration:underline');
  if (s.fontFamily) out.push(`font-family:${cssFamily(s.fontFamily)}`);
  if (s.uppercase) out.push('text-transform:uppercase');
  if (s.letterSpacing) out.push(`letter-spacing:${s.letterSpacing}px`);
  if (s.lineHeight) out.push(`line-height:${s.lineHeight}`);
  if (s.maxWidth) out.push(`max-width:${s.maxWidth}px`, 'white-space:normal');
  return out.join(';') + ';';
}

/** Split text into lines that fit `maxWidth` (and at explicit newlines). */
export function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    if (!maxWidth) { out.push(para); continue; }
    let line = '';
    for (const w of para.split(' ')) {
      const t = line ? line + ' ' + w : w;
      if (line && ctx.measureText(t).width > maxWidth) { out.push(line); line = w; } else line = t;
    }
    out.push(line);
  }
  return out;
}

/**
 * Draw styled text on a canvas. (x, y) is the anchor point; `align` left/center/right is horizontal alignment
 * around it, and text is vertically centered on y. Returns the box drawn (for hit testing buttons).
 */
export function drawStyledText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number,
  o: { size: number; color: string; align: 'left' | 'center' | 'right'; family?: string; style?: TextStyle; bgImage?: CanvasImageSource | null }): { x: number; y: number; w: number; h: number } {
  const s = o.style ?? {};
  ctx.save();
  // Canvas text is bold unless turned off (as before); a weight or font family from the style wins.
  ctx.font = canvasFont(o.size, { ...s, bold: s.bold !== false }, o.family ? `"${o.family}", system-ui` : undefined);
  if (s.letterSpacing && 'letterSpacing' in ctx) (ctx as any).letterSpacing = `${s.letterSpacing}px`;
  const str = s.uppercase ? text.toUpperCase() : text;
  const lines = wrapLines(ctx, str, s.maxWidth ?? 0);
  const lh = o.size * (s.lineHeight ?? 1.2);
  const tw = Math.max(1, ...lines.map((l) => ctx.measureText(l).width));
  const pad = s.padding ?? 0, padX = Math.round(pad * 1.4);
  const bw = tw + padX * 2, bh = lines.length * lh + pad * 2;
  const bx = o.align === 'left' ? x : o.align === 'right' ? x - bw : x - bw / 2;
  const by = y - bh / 2;
  if (s.bg || o.bgImage || s.borderWidth) {
    ctx.beginPath();
    const r = Math.min(s.radius ?? 0, bh / 2, bw / 2);
    if ((ctx as any).roundRect) (ctx as any).roundRect(bx, by, bw, bh, r); else ctx.rect(bx, by, bw, bh);
    if (s.bg) { ctx.fillStyle = rgba(s.bg, s.bgOpacity ?? 1); ctx.fill(); }
    if (o.bgImage) { ctx.save(); ctx.clip(); ctx.drawImage(o.bgImage, bx, by, bw, bh); ctx.restore(); }
    if (s.borderWidth) { ctx.lineWidth = s.borderWidth; ctx.strokeStyle = s.border ?? '#ffffff'; ctx.stroke(); }
  }
  ctx.textBaseline = 'middle';
  ctx.textAlign = o.align;
  const tx = o.align === 'left' ? bx + padX : o.align === 'right' ? bx + bw - padX : bx + bw / 2;
  lines.forEach((l, n) => {
    const ly = by + pad + lh * (n + 0.5);
    if (s.shadow) { ctx.shadowColor = s.shadow; ctx.shadowBlur = s.shadowBlur ?? 0; ctx.shadowOffsetX = s.shadowX ?? 0; ctx.shadowOffsetY = s.shadowY ?? 0; }
    if (s.outlineWidth) { ctx.lineJoin = 'round'; ctx.lineWidth = s.outlineWidth * 2; ctx.strokeStyle = s.outline ?? '#000'; ctx.strokeText(l, tx, ly); ctx.shadowColor = 'transparent'; }
    ctx.fillStyle = o.color; ctx.fillText(l, tx, ly);
    ctx.shadowColor = 'transparent';
    if (s.underline) { const lw = ctx.measureText(l).width; const ux = o.align === 'left' ? tx : o.align === 'right' ? tx - lw : tx - lw / 2; ctx.fillRect(ux, ly + o.size * 0.45, lw, Math.max(1, o.size / 14)); }
  });
  ctx.restore();
  return { x: bx, y: by, w: bw, h: bh };
}
