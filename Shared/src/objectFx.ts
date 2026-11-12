// Per-object visual effects (Properties › Effects): glow, pixelate, blur, outline and tint applied to ONE object,
// on top of which the camera's global Post-FX still runs unchanged. GameCraft renders each object with effects on
// its own and composites it back (engine/objectFx.ts); LogicCraft draws it through a canvas filter (stage.ts).
export type ObjectFxType = 'glow' | 'pixelate' | 'blur' | 'outline' | 'tint';

export interface ObjectFx { type: ObjectFxType; enabled: boolean; params: Record<string, number | string> }

/** 'toggle' is stored as 0 / 1. when shows the setting only while that toggle is on. */
export interface ObjectFxParam { key: string; label: string; kind: 'number' | 'color' | 'toggle'; when?: string; default: number | string; min?: number; max?: number; step?: number }
export interface ObjectFxDef { type: ObjectFxType; name: string; doc: string; params: ObjectFxParam[] }

export const OBJECT_FX: Record<ObjectFxType, ObjectFxDef> = {
  glow: {
    type: 'glow', name: 'Glow (bloom)', doc: 'A soft light around this object only (selective bloom).',
    params: [
      { key: 'intensity', label: 'Intensity', kind: 'number', default: 1.2, min: 0, max: 5, step: 0.05 },
      { key: 'radius', label: 'Radius (px)', kind: 'number', default: 12, min: 1, max: 48, step: 1 },
      { key: 'color', label: 'Glow colour', kind: 'color', default: '#ffffff' },
    ],
  },
  pixelate: {
    type: 'pixelate', name: 'Pixelate', doc: 'Draws this object in big square pixels.',
    params: [{ key: 'size', label: 'Pixel size (px)', kind: 'number', default: 6, min: 2, max: 32, step: 1 }],
  },
  blur: {
    type: 'blur', name: 'Gaussian blur', doc: 'Blurs this object (ghosts, out-of-focus props, speed).',
    params: [{ key: 'radius', label: 'Radius (px)', kind: 'number', default: 6, min: 1, max: 24, step: 0.5 }],
  },
  outline: {
    type: 'outline', name: 'Outline', doc: 'A line around the object\'s silhouette (selection, interactables). Opacity makes it see-through; Animated noise makes it wobble and flicker (ghostly, magical, electric).',
    params: [
      { key: 'width', label: 'Width (px)', kind: 'number', default: 3, min: 1, max: 12, step: 1 },
      { key: 'color', label: 'Colour', kind: 'color', default: '#ffd200' },
      { key: 'opacity', label: 'Opacity', kind: 'number', default: 1, min: 0, max: 1, step: 0.01 },
      { key: 'noise', label: 'Animated noise', kind: 'toggle', default: 0 },
      { key: 'noiseAmount', label: 'Noise intensity', kind: 'number', default: 0.5, min: 0, max: 1, step: 0.01, when: 'noise' },
      { key: 'noiseSpeed', label: 'Noise speed', kind: 'number', default: 1, min: 0, max: 5, step: 0.05, when: 'noise' },
    ],
  },
  tint: {
    type: 'tint', name: 'Colour tint', doc: 'Shifts the object toward a colour (damage flash, frozen, poisoned).',
    params: [
      { key: 'color', label: 'Colour', kind: 'color', default: '#ff3b3b' },
      { key: 'amount', label: 'Amount', kind: 'number', default: 0.5, min: 0, max: 1, step: 0.01 },
    ],
  },
};
export const OBJECT_FX_TYPES = Object.keys(OBJECT_FX) as ObjectFxType[];

export function makeObjectFx(type: ObjectFxType): ObjectFx {
  return { type, enabled: true, params: Object.fromEntries(OBJECT_FX[type].params.map((p) => [p.key, p.default])) };
}
export function fxParam(fx: ObjectFx, key: string): number | string {
  const def = OBJECT_FX[fx.type]?.params.find((p) => p.key === key);
  return fx.params[key] ?? def?.default ?? 0;
}
export const fxNum = (fx: ObjectFx, key: string) => Number(fxParam(fx, key)) || 0;
/** Enabled effects of an object, in order. */
export const activeFx = (list: ObjectFx[] | undefined) => (list ?? []).filter((f) => f.enabled && OBJECT_FX[f.type]);

/** #rrggbb + alpha → rgba() (other colour strings are returned unchanged). */
function withAlpha(hex: string, a: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${+a.toFixed(3)})`;
}

/** CSS / canvas filter string for 2D renderers (blur, glow as a drop shadow, tint approximations, outline). */
export function canvasFilter(list: ObjectFx[] | undefined, time = 0): string {
  const out: string[] = [];
  for (const f of activeFx(list)) {
    if (f.type === 'blur') out.push(`blur(${fxNum(f, 'radius')}px)`);
    if (f.type === 'glow') { const r = fxNum(f, 'radius'), k = Math.min(3, Math.ceil(fxNum(f, 'intensity'))); for (let n = 0; n < Math.max(1, k); n++) out.push(`drop-shadow(0 0 ${r}px ${fxParam(f, 'color')})`); }
    if (f.type === 'outline') {
      // Noise (off by default) wobbles the width and flickers the line; opacity makes it see-through.
      const amt = fxNum(f, 'noise') ? fxNum(f, 'noiseAmount') : 0, t = time * fxNum(f, 'noiseSpeed');
      const wob = amt ? Math.sin(t * 7.3) * 0.5 + Math.sin(t * 3.1 + 1.7) * 0.5 : 0;
      const w = Math.max(0.5, fxNum(f, 'width') * (1 + wob * amt * 0.9));
      const a = Math.max(0, Math.min(1, Number(fxParam(f, 'opacity')))) * (amt ? 1 - amt * 0.6 * (0.5 + 0.5 * Math.sin(t * 11.7)) : 1);
      const c = withAlpha(String(fxParam(f, 'color')), a);
      out.push(`drop-shadow(${w}px 0 0 ${c})`, `drop-shadow(-${w}px 0 0 ${c})`, `drop-shadow(0 ${w}px 0 ${c})`, `drop-shadow(0 -${w}px 0 ${c})`);
    }
  }
  return out.join(' ') || 'none';
}
