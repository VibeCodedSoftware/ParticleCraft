// One logic editor, many coding styles. The host app renders <LogicView> with the user's style and
// <CodingStylePicker> in its toolbar; every style edits the same LogicDocument through onChange.
import React, { useEffect, useRef, useState } from 'react';
import { Glyph, STYLE_ICON } from './icons';
import type { SceneData } from '../src/runtime/scene';
import { BlockCanvas, type CanvasProps } from './BlockCanvas';
import { EventSheetView } from './EventSheetView';
import { NodeGraphView } from './NodeGraphView';
import { LogicBricksView } from './LogicBricksView';
import { CodeView } from './CodeView';
import { CODING_STYLES, defaultCodingStyle, loadCodingStyle, saveCodingStyle, styleCompatibility, type CodingStyleId } from '../src/codingStyles';
import type { AppId } from '../src/schema';
import { DEFAULT_ACTIONS } from '../src/runtime/input';
import { InputMappingEditor } from './InputMappingEditor';

/** The user's coding style for an app (remembered between sessions). */
export function useCodingStyle(app: AppId): [CodingStyleId, (s: CodingStyleId) => void] {
  const [s, setS] = useState<CodingStyleId>(() => loadCodingStyle(app));
  useEffect(() => saveCodingStyle(app, s), [app, s]);
  return [s, setS];
}

export type LogicViewProps = CanvasProps & { codingStyle: CodingStyleId; scene?: SceneData | null };

export function LogicView(props: LogicViewProps) {
  const { codingStyle, scene, ...rest } = props;
  switch (codingStyle) {
    case 'scratch': return <BlockCanvas {...rest} variant="scratch" />;
    case 'pro': return <BlockCanvas {...rest} variant="pro" />;
    case 'nodes': return <NodeGraphView {...rest} />;
    case 'bricks': return <LogicBricksView {...rest} />;
    case 'code': return <CodeView {...rest} scene={scene} />;
    case 'sheet': return <EventSheetView {...rest} />;
  }
}

/**
 * Live "this event ran" highlight while the game plays. It toggles the `ran` class directly on elements tagged
 * `data-ev-id`, a few times a second and only where it changed. Re-rendering the whole editor for this (as
 * before) took ~100 ms per update on big sheets and starved the game loop.
 */
export function TraceHighlighter({ getTrace, children }: { getTrace: () => Set<string> | null; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let last = '';
    const tick = () => {
      const root = ref.current; if (!root) return;
      const t = getTrace();
      const key = t ? [...t].sort().join(',') : '';
      if (key === last) return;
      last = key;
      root.querySelectorAll<HTMLElement>('[data-ev-id]').forEach((el) => {
        const on = !!t?.has(el.dataset.evId!);
        if (el.classList.contains('ran') !== on) el.classList.toggle('ran', on);
      });
    };
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [getTrace]);
  return <div ref={ref} className="lx-trace-root">{children}</div>;
}

/** Toolbar button + editor for named input actions (one action = keys, mouse and gamepad buttons). */
export function InputActionsButton({ doc, onChange }: { doc: CanvasProps['doc']; onChange: CanvasProps['onChange'] }) {
  const [open, setOpen] = useState(false);
  const value = { actions: doc.inputActions ?? DEFAULT_ACTIONS, contexts: doc.inputContexts, touch: doc.touchControls, tuning: doc.inputTuning, profiles: doc.inputProfiles, profileTuning: doc.inputProfileTuning, players: doc.inputPlayers };
  return (
    <>
      <button className="csp-btn" title="Input: actions for every device (keyboard, mouse, gamepads, touch), contexts, on-screen touch controls and a live test" onClick={() => setOpen(true)}>Input</button>
      {open && (
        <div className="lx-modal-back" onMouseDown={() => setOpen(false)}>
          <div className="lx-modal im-modal" onMouseDown={(e) => e.stopPropagation()}>
            <div className="lx-modal-head"><b>Input mapping</b></div>
            <InputMappingEditor value={value} onChange={(v, label) => onChange({ ...doc, inputActions: v.actions, inputContexts: v.contexts, touchControls: v.touch, inputTuning: v.tuning, inputProfiles: v.profiles, inputProfileTuning: v.profileTuning, inputPlayers: v.players }, label)} />
            <div className="lx-modal-foot"><button className="lx-btn primary" onClick={() => setOpen(false)}>Done</button></div>
          </div>
        </div>
      )}
    </>
  );
}

/** Toolbar control: current style, with a menu describing each style and how this sheet looks in it. */
export function CodingStylePicker({ value, onChange, app, doc, sheetId }: { value: CodingStyleId; onChange: (s: CodingStyleId) => void; app: CanvasProps['app']; doc: CanvasProps['doc']; sheetId?: string }) {
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<{ left: number; top?: number; bottom?: number; maxHeight: number }>({ left: 0, maxHeight: 400 });
  const ref = useRef<HTMLDivElement>(null);
  /** Open below the button, or above it when the panel sits low on screen (GameCraft's bottom panel); always fits and scrolls. */
  const toggle = () => {
    if (!open && ref.current) {
      const r = ref.current.getBoundingClientRect();
      const below = window.innerHeight - r.bottom - 12, above = r.top - 12;
      const left = Math.max(8, Math.min(r.left, window.innerWidth - 410));
      setPlace(below >= 320 || below >= above ? { left, top: r.bottom + 4, maxHeight: below } : { left, bottom: window.innerHeight - r.top + 4, maxHeight: above });
    }
    setOpen(!open);
  };
  useEffect(() => {
    if (!open) return;
    const out = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('pointerdown', out, true); window.addEventListener('keydown', esc);
    return () => { window.removeEventListener('pointerdown', out, true); window.removeEventListener('keydown', esc); };
  }, [open]);
  const cur = CODING_STYLES.find((s) => s.id === value)!;
  const def = defaultCodingStyle(app);
  return (
    <div className="csp" ref={ref}>
      <button className="csp-btn" onClick={toggle} title="Coding style: how your logic is shown and edited. Switching never changes the program.">
        <span className="csp-ic"><Glyph e={cur.icon} i={STYLE_ICON[cur.id] ?? 'blocks'} /></span>{cur.short}<span className="csp-caret">▾</span>
      </button>
      {open && (
        <div className="csp-menu" style={{ left: place.left, top: place.top, bottom: place.bottom, maxHeight: Math.max(160, place.maxHeight) }} onWheel={(e) => e.stopPropagation()}>
          <div className="csp-head">Coding style <span>Same program in every style</span></div>
          {CODING_STYLES.map((s) => {
            const notes = s.id === value ? [] : styleCompatibility(doc, sheetId, s.id);
            return (
              <button key={s.id} className={'csp-item' + (s.id === value ? ' on' : '')} onClick={() => { onChange(s.id); setOpen(false); }}>
                <span className="csp-ic big"><Glyph e={s.icon} i={STYLE_ICON[s.id] ?? 'blocks'} size={20} /></span>
                <span className="csp-txt">
                  <b>{s.name}{s.id === def ? <em> default</em> : null}</b>
                  <span>{s.description}</span>
                  {notes.map((n, i) => <span key={i} className="csp-note">ⓘ {n}</span>)}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
