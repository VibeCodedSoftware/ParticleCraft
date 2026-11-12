// Text adjustment popup (double-click a text object in the scene / stage): content, font, size, colour, alignment,
// weight, bold / italic / underline / caps, spacing, wrapping, and whether screen text takes the camera's Post-FX.
// Every change is applied live; the host turns each into one undoable edit.
import React from 'react';
import { createPortal } from 'react-dom';
import type { BarStyle, TextData } from '../src/runtime/scene';
import { SYSTEM_FONTS, cssFamily, textStyleCss, type TextStyle } from '../src/runtime/textStyle';

export interface TextEditProps {
  text: TextData;
  /** Imported font files (asset id + name). */
  fonts?: { id: string; name: string }[];
  /** Apply a change. `key` coalesces rapid edits (typing, sliders) into one undo step. */
  onChange: (patch: Partial<TextData>, label: string, key?: string) => void;
  onClose: () => void;
  /** Font URL for the preview of an imported font. */
  fontUrl?: (id: string) => string | null;
  /** Show the "Affected by Post-FX" option (hosts whose screen text can take it). */
  postfxOption?: boolean;
  /** Pictures for backgrounds and bars, how to show one, and how to bring in a new one (hosts that have them). */
  images?: { id: string; name: string }[];
  imageUrl?: (id: string) => string | null;
  onImportImage?: (f: File) => Promise<string>;
  /** This text shows a value (Set bar): offer the bar's look. */
  barEditor?: boolean;
  /** Draw the bar for the preview, as the game will (hosts that draw bars). */
  renderBar?: (b: BarStyle, color: string) => HTMLElement;
}

/** A picture choice with an Import button. */
function PictureField({ value, images, onPick, onImport, empty = 'None' }: { value?: string; images: { id: string; name: string }[]; onPick: (id: string | undefined) => void; onImport?: (f: File) => Promise<string>; empty?: string }) {
  return <span className="te-seg">
    <select className="lx-input" style={{ flex: 1, minWidth: 0 }} value={value ?? ''} onChange={(e) => onPick(e.target.value || undefined)}>
      <option value="">{empty}</option>
      {value && !images.some((i) => i.id === value) && <option value={value}>{value.split('/').pop()}</option>}
      {images.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
    </select>
    {onImport && <label className="lx-btn" title="Bring in your own picture">Import…<input type="file" accept=".png,.jpg,.jpeg,.webp,.gif,.svg" hidden onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onPick(await onImport(f)); }} /></label>}
  </span>;
}

const SHAPES: [string, string, Partial<TextStyle>][] = [
  ['none', 'No background', { bg: undefined, bgImage: undefined, radius: undefined, padding: undefined, border: undefined, borderWidth: undefined }],
  ['square', 'Square', { radius: 0 }], ['rounded', 'Rounded', { radius: 8 }], ['pill', 'Bubble', { radius: 999 }],
];
const shapeOf = (s: TextStyle) => (!s.bg && !s.bgImage ? 'none' : !s.radius ? 'square' : s.radius >= 100 ? 'pill' : 'rounded');

const WEIGHTS: [number, string][] = [[300, 'Light'], [400, 'Regular'], [500, 'Medium'], [600, 'Semibold'], [700, 'Bold'], [900, 'Black']];

export function TextEditDialog({ text, fonts = [], onChange, onClose, fontUrl, postfxOption, images = [], onImportImage, barEditor, renderBar }: TextEditProps) {
  const bar = text.barStyle;
  const barHost = React.useRef<HTMLDivElement>(null);
  const barKey = JSON.stringify(bar ?? null) + text.color;
  React.useEffect(() => { if (barEditor && renderBar) barHost.current?.replaceChildren(renderBar(bar ?? { kind: 'bar' }, text.color)); }, [barKey, barEditor]);
  const setBar = (patch: Partial<BarStyle>, label: string, key?: string) => onChange({ barStyle: { kind: 'bar', ...bar, ...patch } }, label, key);
  const s: TextStyle = text.style ?? {};
  const style = (patch: Partial<TextStyle>, label: string, key?: string) => onChange({ style: { ...s, ...patch } }, label, key);
  const fontValue = text.font ? 'file:' + text.font : s.fontFamily ? 'sys:' + s.fontFamily : '';
  const previewFamily = text.font ? `"tedit-${text.font.replace(/[^A-Za-z0-9]/g, '')}", system-ui` : s.fontFamily ? cssFamily(s.fontFamily) : 'system-ui, "Segoe UI", sans-serif';
  const fontFace = text.font && fontUrl?.(text.font) ? `@font-face{font-family:"tedit-${text.font.replace(/[^A-Za-z0-9]/g, '')}";src:url("${fontUrl(text.font)}")}` : '';
  const toggle = (k: 'italic' | 'underline' | 'uppercase', label: string) => <button className={'lx-btn' + (s[k] ? ' primary' : '')} title={label} onClick={() => style({ [k]: !s[k] }, label)}>{label}</button>;
  return createPortal(
    <div className="lx-modal-back" onMouseDown={onClose}>
      <div className="lx-modal te-modal" style={{ maxHeight: '92vh', overflowY: 'auto' }} onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') onClose(); }}>
        <div className="lx-modal-head"><b>{barEditor ? 'Edit bar' : text.button ? 'Edit button' : 'Edit text'}</b><button className="lx-btn" style={{ marginLeft: 'auto' }} onClick={onClose}>Done</button></div>
        <style>{fontFace}</style>
        <div className="te-preview" style={{ textAlign: text.align }}>
          {(!barEditor || bar?.label !== false) && <span style={{ fontFamily: previewFamily, fontSize: Math.min(48, text.size), color: text.color, whiteSpace: 'pre-wrap', ...cssObject(textStyleCss({ ...s, fontFamily: undefined })) }}>{text.text || ' '}</span>}
          {barEditor && renderBar && <div ref={barHost} />}
        </div>
        <textarea className="lx-input te-text" rows={3} autoFocus value={text.text} onChange={(e) => onChange({ text: e.target.value }, 'Text', 'te-text')} />
        <div className="te-grid">
          <label>Font
            <select className="lx-input" value={fontValue} onChange={(e) => {
              const v = e.target.value;
              if (v.startsWith('file:')) onChange({ font: v.slice(5), style: { ...s, fontFamily: undefined } }, 'Font');
              else onChange({ font: undefined, style: { ...s, fontFamily: v ? v.slice(4) : undefined } }, 'Font');
            }}>
              <option value="">Default</option>
              <optgroup label="On every computer">{Object.keys(SYSTEM_FONTS).map((f) => <option key={f} value={'sys:' + f} style={{ fontFamily: SYSTEM_FONTS[f] }}>{f}</option>)}</optgroup>
              {fonts.length > 0 && <optgroup label="Imported fonts">{fonts.map((f) => <option key={f.id} value={'file:' + f.id}>{f.name}</option>)}</optgroup>}
            </select>
          </label>
          <label>Size<input className="lx-input" type="number" min={4} max={400} value={text.size} onChange={(e) => onChange({ size: Math.max(4, Number(e.target.value) || 4) }, 'Text size', 'te-size')} /></label>
          <label>Colour<input className="lx-color" type="color" value={text.color} onChange={(e) => onChange({ color: e.target.value }, 'Text colour', 'te-color')} /></label>
          <label>Weight
            <select className="lx-input" value={s.weight ?? (s.bold ? 700 : 400)} onChange={(e) => style({ weight: Number(e.target.value), bold: Number(e.target.value) >= 600 }, 'Font weight')}>
              {WEIGHTS.map(([w, n]) => <option key={w} value={w}>{n}</option>)}
            </select>
          </label>
          <label>Alignment
            <span className="te-seg">{(['left', 'center', 'right'] as const).map((a) => <button key={a} className={'lx-btn' + (text.align === a ? ' primary' : '')} onClick={() => onChange({ align: a }, 'Alignment')}>{a[0].toUpperCase() + a.slice(1)}</button>)}</span>
          </label>
          <label>Style<span className="te-seg">{toggle('italic', 'Italic')}{toggle('underline', 'Underline')}{toggle('uppercase', 'CAPS')}</span></label>
          <label>Letter spacing<input className="lx-input" type="number" step={0.5} value={s.letterSpacing ?? 0} onChange={(e) => style({ letterSpacing: Number(e.target.value) || undefined }, 'Letter spacing', 'te-ls')} /></label>
          <label>Line height<input className="lx-input" type="number" step={0.1} min={0.6} value={s.lineHeight ?? 1.2} onChange={(e) => style({ lineHeight: Number(e.target.value) || undefined }, 'Line height', 'te-lh')} /></label>
          <label>Wrap width (px)<input className="lx-input" type="number" min={0} step={10} value={s.maxWidth ?? 0} onChange={(e) => style({ maxWidth: Number(e.target.value) || undefined }, 'Wrap width', 'te-mw')} /></label>
          <label>Outline<span className="te-seg"><input className="lx-input" type="number" min={0} style={{ width: 56 }} value={s.outlineWidth ?? 0} onChange={(e) => style({ outlineWidth: Number(e.target.value) || undefined, outline: s.outline ?? '#000000' }, 'Outline', 'te-ow')} /><input className="lx-color" type="color" value={s.outline ?? '#000000'} onChange={(e) => style({ outline: e.target.value }, 'Outline colour', 'te-oc')} /></span></label>
        </div>
        <b style={{ fontSize: 12 }}>Background</b>
        <div className="te-grid">
          <label>Shape
            <select className="lx-input" value={shapeOf(s)} onChange={(e) => {
              const [id, name, patch] = SHAPES.find((x) => x[0] === e.target.value)!;
              style(id === 'none' ? patch : { bg: s.bgImage ? s.bg : s.bg ?? '#000000', bgOpacity: s.bgOpacity ?? 0.6, padding: s.padding ?? 8, ...patch }, 'Background: ' + name);
            }}>{SHAPES.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select>
          </label>
          {shapeOf(s) !== 'none' && <>
            <label>Colour<input className="lx-color" type="color" value={s.bg ?? '#000000'} onChange={(e) => style({ bg: e.target.value }, 'Background colour', 'te-bg')} /></label>
            <label>See-through<input className="lx-input" type="number" min={0} max={100} step={5} value={Math.round((1 - (s.bgOpacity ?? 1)) * 100)} onChange={(e) => style({ bgOpacity: 1 - Math.max(0, Math.min(100, Number(e.target.value) || 0)) / 100 }, 'Background opacity', 'te-bo')} /></label>
            <label>Padding<input className="lx-input" type="number" min={0} value={s.padding ?? 0} onChange={(e) => style({ padding: Number(e.target.value) || 0 }, 'Padding', 'te-pad')} /></label>
            <label>Corner size<input className="lx-input" type="number" min={0} value={s.radius ?? 0} onChange={(e) => style({ radius: Number(e.target.value) || 0 }, 'Corners', 'te-rad')} /></label>
            <label>Border<span className="te-seg"><input className="lx-input" type="number" min={0} style={{ width: 56 }} value={s.borderWidth ?? 0} onChange={(e) => style({ borderWidth: Number(e.target.value) || undefined, border: s.border ?? '#ffffff' }, 'Border', 'te-bw')} /><input className="lx-color" type="color" value={s.border ?? '#ffffff'} onChange={(e) => style({ border: e.target.value }, 'Border colour', 'te-bc')} /></span></label>
          </>}
          <label>Picture<PictureField value={s.bgImage} images={images} onPick={(id) => style({ bgImage: id, padding: s.padding ?? (id ? 8 : undefined) }, 'Background picture')} onImport={onImportImage} /></label>
        </div>
        {barEditor && <>
          <b style={{ fontSize: 12 }}>Bar</b>
          <div className="te-grid">
            <label>Look
              <select className="lx-input" value={bar?.kind ?? 'bar'} onChange={(e) => {
                const kind = e.target.value as BarStyle['kind'];
                // Hearts and pictures read by themselves: no need for the word as well.
                setBar({ kind, width: undefined, height: undefined, label: bar?.label ?? kind === 'bar' }, 'Bar look');
              }}>
                <option value="bar">Regular bar</option><option value="ticks">Tick bar</option><option value="hearts">Hearts</option><option value="image">My own picture</option>
              </select>
            </label>
            {bar?.kind !== 'image' && <label>Filled colour<input className="lx-color" type="color" value={bar?.color ?? text.color} onChange={(e) => setBar({ color: e.target.value }, 'Bar colour', 'te-barc')} /></label>}
            {bar?.kind !== 'image' && <label>Empty colour<input className="lx-color" type="color" value={bar?.bg ?? '#222222'} onChange={(e) => setBar({ bg: e.target.value }, 'Bar empty colour', 'te-barb')} /></label>}
            {(bar?.kind === 'ticks' || bar?.kind === 'hearts') && <label>How many<input className="lx-input" type="number" min={1} max={100} value={bar.count ?? (bar.kind === 'hearts' ? 3 : 10)} onChange={(e) => setBar({ count: Math.max(1, Number(e.target.value) || 1) }, 'Bar count', 'te-barn')} /></label>}
            <label>Width<input className="lx-input" type="number" min={1} value={bar?.width ?? (bar?.kind === 'hearts' ? 26 : bar?.kind === 'ticks' ? 12 : 180)} onChange={(e) => setBar({ width: Math.max(1, Number(e.target.value) || 1) }, 'Bar width', 'te-barw')} /></label>
            <label>Height<input className="lx-input" type="number" min={1} value={bar?.height ?? (bar?.kind === 'hearts' ? 26 : bar?.kind === 'ticks' ? 16 : bar?.kind === 'image' ? 24 : 12)} onChange={(e) => setBar({ height: Math.max(1, Number(e.target.value) || 1) }, 'Bar height', 'te-barh')} /></label>
            {(bar?.kind === 'hearts' || bar?.kind === 'image') && <label>{bar.kind === 'hearts' ? 'Full icon' : 'Filling picture'}<PictureField value={bar.full} images={images} empty={bar.kind === 'hearts' ? 'Heart' : 'Plain colour'} onPick={(id) => setBar({ full: id }, 'Bar picture')} onImport={onImportImage} /></label>}
            {(bar?.kind === 'hearts' || bar?.kind === 'image') && <label>{bar.kind === 'hearts' ? 'Empty icon' : 'Picture behind it'}<PictureField value={bar.empty} images={images} empty={bar.kind === 'hearts' ? 'Heart' : 'None'} onPick={(id) => setBar({ empty: id }, 'Bar empty picture')} onImport={onImportImage} /></label>}
          </div>
          <label className="te-check"><input type="checkbox" checked={bar?.label !== false} onChange={(e) => setBar({ label: e.target.checked }, 'Bar label')} /> Show the text above it</label>
        </>}
        {postfxOption && (
          <label className="te-check"><input type="checkbox" checked={!!text.postfx} onChange={(e) => onChange({ postfx: e.target.checked }, 'Text Post-FX')} />
            Affected by the camera's Post-FX <span className="lx-doc">Off (default): screen text stays crisp on top of every effect.</span></label>
        )}
      </div>
    </div>, document.body,
  );
}

/** "a:b;c:d" -> React style object. */
function cssObject(css: string): React.CSSProperties {
  const o: Record<string, string> = {};
  for (const part of css.split(';')) {
    const i = part.indexOf(':'); if (i < 0) continue;
    const k = part.slice(0, i).trim(); if (!k) continue;
    o[k.startsWith('-') ? k.replace(/^-webkit-/, 'Webkit').replace(/-([a-z])/g, (_m, c) => c.toUpperCase()) : k.replace(/-([a-z])/g, (_m, c) => c.toUpperCase())] = part.slice(i + 1).trim();
  }
  return o as React.CSSProperties;
}
