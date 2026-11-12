// Dialogue editor › Look: how the dialogue box appears in the game. A preset (dark, light, parchment, speech bubble,
// pixel, comic, glass), then anything changed: position, font, colours, your own box picture (stretched, or a
// nine-slice frame that keeps its corners), speaker portraits in a circle / rounded / square frame or your own frame
// picture. The preview is drawn by the same code as the game.
import React, { useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { DialogueStyle, LogicDocument } from '../src/schema';
import { DIALOGUE_ANIMS, DIALOGUE_FONTS, DIALOGUE_IDLES, DIALOGUE_PRESETS, FONT_ACCEPT, TEXT_IDLES, TEXT_INS, pictureRef, resolveDialogueLook } from '../src/dialogueStyle';
import { buildDialogueBox } from './gameOverlay';
import { edit } from './logicOps';
import { PICTURE_ACCEPT } from './PicturePanel';

export interface DialogueStyleProps {
  doc: LogicDocument;
  onChange: (doc: LogicDocument, label: string) => void;
  importFile?: (f: File) => Promise<string>;
  resolve?: (ref: string) => string | null;
  onClose: () => void;
}

const cleanName = (s: string) => s.replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9_ -]+/g, '').trim().replace(/\s+/g, '_') || 'Picture';

export function DialogueStylePanel({ doc, onChange, importFile, resolve, onClose }: DialogueStyleProps) {
  const st: DialogueStyle = doc.dialogueStyle ?? { preset: 'dark' };
  const pics = doc.pictures ?? [];
  const set = (patch: Partial<DialogueStyle>, label = 'Dialogue look') => onChange(edit(doc, (d) => { d.dialogueStyle = { ...(d.dialogueStyle ?? { preset: 'dark' }), ...patch }; }), label);
  const speakers = useMemo(() => [...new Set((doc.dialogues ?? []).flatMap((d) => d.nodes.map((n) => n.speaker.trim()).filter(Boolean)))].filter((s) => !/^(narrator|story)$/i.test(s)), [doc.dialogues]);
  // Import a picture into Pictures and use it for a field.
  const importInto = async (f: File | undefined, use: (name: string) => Partial<DialogueStyle>) => {
    if (!f || !importFile) return;
    const ref = await importFile(f);
    let name = cleanName(f.name), k = 2; const base = name;
    while (pics.some((p) => p.name.toLowerCase() === name.toLowerCase())) name = `${base}_${k++}`;
    onChange(edit(doc, (d) => { (d.pictures ??= []).push({ name, ref }); d.dialogueStyle = { ...(d.dialogueStyle ?? { preset: 'dark' }), ...use(name) }; }), 'Import picture');
  };
  const picSelect = (value: string | undefined, onPick: (v: string | undefined) => void, use: (name: string) => Partial<DialogueStyle>) => (
    <span style={{ display: 'flex', gap: 4 }}>
      <select className="lx-input" value={value ?? ''} onChange={(e) => onPick(e.target.value || undefined)}>
        <option value="">None</option>{pics.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}
      </select>
      {importFile && <label className="lx-btn" title="Import a picture">Import…<input type="file" accept={PICTURE_ACCEPT} hidden onChange={(e) => { void importInto(e.target.files?.[0], use); e.target.value = ''; }} /></label>}
    </span>
  );
  const color = (label: string, v: string | undefined, k: keyof DialogueStyle) => (
    <label className="ds-row"><span>{label}</span>
      <input type="color" value={/^#[0-9a-f]{6}$/i.test(v ?? '') ? v : '#888888'} onChange={(e) => set({ [k]: e.target.value } as any, 'Dialogue colours')} />
      {v && <button className="lx-btn" title="Back to the preset's" onClick={() => set({ [k]: undefined } as any)}>↺</button>}
    </label>
  );
  // Live preview with the game's own drawing: over heads, a bubble over the stand-in speaker and the choices over the
  // stand-in player, as in the game.
  const box = useRef<HTMLDivElement>(null), choicesEl = useRef<HTMLDivElement>(null), stage = useRef<HTMLDivElement>(null);
  const [replay, setReplay] = React.useState(0);
  const L = resolveDialogueLook(st), head = L.placement === 'head';
  const fonts = doc.fonts ?? [];
  useEffect(() => {
    if (!box.current) return;
    const sp = speakers[0] ?? 'Guard';
    box.current.replaceChildren();
    const h = buildDialogueBox(box.current, st, { speaker: sp, text: 'Halt! Nobody enters the [yellow]castle[/] without a pass.', choices: [{ index: 1, text: 'Show the pass' }, { index: 2, text: 'Walk away' }] },
      (name) => { const r = pictureRef(pics, name); return r && resolve ? resolve(r) : null; }, { choose: () => undefined, next: () => undefined },
      { head, choicesInto: head ? choicesEl.current : null, fontUrl: (name) => { const r = pictureRef(fonts, name); return r && resolve ? resolve(r) : null; } });
    if (head && stage.current) { const w = stage.current.clientWidth, hh = stage.current.clientHeight; box.current.style.left = `${w * 0.68}px`; box.current.style.top = `${hh * 0.52}px`; }
    return () => h.stop();
  }, [JSON.stringify(st), replay, head, speakers.join('|'), pics.length, fonts.length]);
  const importFont = async (f: File | undefined) => {
    if (!f || !importFile) return;
    if (!/\.(ttf|otf|woff2?)$/i.test(f.name)) { window.alert(`${f.name} isn't a font file (use .ttf, .otf, .woff or .woff2).`); return; }
    const ref = await importFile(f);
    let name = cleanName(f.name), k = 2; const base = name;
    while (fonts.some((p) => p.name.toLowerCase() === name.toLowerCase())) name = `${base}_${k++}`;
    onChange(edit(doc, (d) => { (d.fonts ??= []).push({ name, ref }); d.dialogueStyle = { ...(d.dialogueStyle ?? { preset: 'dark' }), font: 'font:' + name }; }), 'Import font');
  };
  const num = (label: string, v: number, k: keyof DialogueStyle, min: number, max: number, step: number, tip?: string) => (
    <label className="ds-row" title={tip}><span>{label}</span>
      <input type="range" min={min} max={max} step={step} value={v} onChange={(e) => set({ [k]: Number(e.target.value) } as any, 'Dialogue ' + label.toLowerCase())} style={{ flex: 1 }} />
      <span style={{ width: 38, textAlign: 'right' }}>{v}</span>
    </label>
  );
  return createPortal(
    <div className="lx-modal-back" onMouseDown={onClose}>
      <div className="lx-modal wide" style={{ width: 'min(980px,96vw)' }} onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') onClose(); }}>
        <div className="lx-modal-head"><b>Dialogue look</b><span className="lx-doc" style={{ margin: 0 }}>How conversations appear in the game.</span><button className="lx-btn" style={{ marginLeft: 'auto' }} onClick={onClose}>Done</button></div>
        <div style={{ display: 'grid', gridTemplateColumns: '330px 1fr', gap: 14 }}>
          <div className="ds-form" style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: '68vh', overflowY: 'auto' }}>
            <div className="lx-doc" style={{ margin: 0 }}>Preset</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {(Object.keys(DIALOGUE_PRESETS) as DialogueStyle['preset'][]).map((k) => {
                const L = DIALOGUE_PRESETS[k].look;
                return <button key={k} className={'lx-btn' + (st.preset === k ? ' primary' : '')} onClick={() => set({ preset: k, background: undefined, border: undefined, textColor: undefined, speakerColor: undefined, font: undefined, placement: undefined, reveal: undefined, typeSpeed: undefined, animIn: undefined, animTime: undefined, idle: undefined, idleAmount: undefined, textIn: undefined, textIdle: undefined, textAmount: undefined, choiceMode: undefined }, 'Dialogue preset')}
                  style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ width: 14, height: 14, borderRadius: 3, background: L.background, border: L.border }} />{DIALOGUE_PRESETS[k].label}</button>;
              })}
            </div>
            <label className="ds-row" title="On the screen, or in a bubble over the speaker's head (the object named as the speaker; the player for Player / You, in third person)"><span>Where</span><select className="lx-input" value={st.placement ?? ''} onChange={(e) => set({ placement: (e.target.value || undefined) as any })}><option value="">Preset's ({L.placement === 'head' ? 'over heads' : 'on the screen'})</option><option value="screen">Box on the screen</option><option value="head">Bubbles over heads</option></select></label>
            {!head && <label className="ds-row"><span>Position</span><select className="lx-input" value={st.position ?? 'bottom'} onChange={(e) => set({ position: e.target.value as any })}><option value="bottom">Bottom</option><option value="middle">Middle</option><option value="top">Top</option></select></label>}
            <label className="ds-row"><span>Font</span><select className="lx-input" value={st.font ?? ''} onChange={(e) => set({ font: (e.target.value || undefined) as any })}><option value="">Preset's</option>{Object.entries(DIALOGUE_FONTS).map(([k, f]) => <option key={k} value={k}>{f.label}</option>)}{fonts.map((f) => <option key={f.name} value={'font:' + f.name}>{f.name} (imported)</option>)}</select>
              {importFile && <label className="lx-btn" title="Import your own font (.ttf, .otf, .woff, .woff2): it's stored with the game">Import font…<input type="file" accept={FONT_ACCEPT} hidden onChange={(e) => { void importFont(e.target.files?.[0]); e.target.value = ''; }} /></label>}</label>
            <div className="lx-doc" style={{ margin: '6px 0 0' }}>Text and motion</div>
            <label className="ds-row"><span>Text appears</span><select className="lx-input" value={st.reveal ?? ''} onChange={(e) => set({ reveal: (e.target.value || undefined) as any })}><option value="">Preset's ({L.reveal === 'typewriter' ? 'letter by letter' : 'all at once'})</option><option value="instant">All at once</option><option value="typewriter">Letter by letter</option></select></label>
            {L.reveal === 'typewriter' && num('Letters a second', L.typeSpeed, 'typeSpeed', 5, 120, 1, 'A click or Space shows the rest of the line at once.')}
            <label className="ds-row" title="How each letter comes in. Jumble: letters arrive tipped and the wrong size, then settle. Scramble: the newest letter flickers through random letters first."><span>Letters come in</span><select className="lx-input" value={st.textIn ?? ''} onChange={(e) => set({ textIn: (e.target.value || undefined) as any })}><option value="">Preset's ({TEXT_INS[L.textIn]})</option>{Object.entries(TEXT_INS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
            <label className="ds-row" title="How the letters move once shown"><span>Letters move</span><select className="lx-input" value={st.textIdle ?? ''} onChange={(e) => set({ textIdle: (e.target.value || undefined) as any })}><option value="">Preset's ({TEXT_IDLES[L.textIdle]})</option>{Object.entries(TEXT_IDLES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
            {(L.textIn !== 'none' || L.textIdle !== 'none') && num('Letter effect', L.textAmount, 'textAmount', 0, 1, 0.05, 'How strong the letter animation is.')}
            <span className="lx-doc" style={{ margin: 0 }}>Colour words in a line with [pink]word[/] (red, orange, yellow, green, teal, blue, purple, white, grey) or [#ff88aa]word[/].</span>
            <label className="ds-row" title="A list of every response, or one response at a time with ◀ ▶ arrows (Left / Right or A / D change it; Enter, Space or a click take it)"><span>Responses</span><select className="lx-input" value={st.choiceMode ?? ''} onChange={(e) => set({ choiceMode: (e.target.value || undefined) as any })}><option value="">Preset's ({L.choiceMode === 'arrows' ? 'one at a time, ◀ ▶' : 'a list'})</option><option value="list">A list</option><option value="arrows">One at a time with ◀ ▶</option></select></label>
            <label className="ds-row"><span>Comes in</span><select className="lx-input" value={st.animIn ?? ''} onChange={(e) => set({ animIn: (e.target.value || undefined) as any })}><option value="">Preset's ({DIALOGUE_ANIMS[L.animIn]})</option>{Object.entries(DIALOGUE_ANIMS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
            {L.animIn !== 'none' && num('Time (s)', L.animTime, 'animTime', 0.05, 1.5, 0.05)}
            <label className="ds-row"><span>While open</span><select className="lx-input" value={st.idle ?? ''} onChange={(e) => set({ idle: (e.target.value || undefined) as any })}><option value="">Preset's ({DIALOGUE_IDLES[L.idle]})</option>{Object.entries(DIALOGUE_IDLES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
            {L.idle !== 'none' && num('How much', L.idleAmount, 'idleAmount', 0, 1, 0.05)}
            {num('Line noise', L.boil, 'boil', 0, 1, 0.05, "The box's edges redrawn a little differently several times a second, like hand-drawn lines. 0: off.")}
            {L.boil > 0 && num('Noise a second', L.boilRate, 'boilRate', 1, 24, 1, 'How many times a second the lines are redrawn (hand-drawn animation often uses 8 or 12).')}
            <button className="lx-btn" onClick={() => setReplay((n) => n + 1)}>Replay in the preview</button>
            {color('Background', st.background, 'background')}
            {color('Text', st.textColor, 'textColor')}
            {color('Speaker name', st.speakerColor, 'speakerColor')}
            <div className="lx-doc" style={{ margin: '6px 0 0' }}>Your own box picture</div>
            <label className="ds-row"><span>Picture</span>{picSelect(st.boxPicture, (v) => set({ boxPicture: v }), (n) => ({ boxPicture: n }))}</label>
            {st.boxPicture && <>
              <label className="ds-row"><span>Fit</span><select className="lx-input" value={st.boxFit ?? 'stretch'} onChange={(e) => set({ boxFit: e.target.value as any })}><option value="stretch">Stretch to the box</option><option value="nine-slice">Nine-slice (keep the corners)</option></select></label>
              {st.boxFit === 'nine-slice' && <label className="ds-row" title="How many pixels of the picture's edges are the frame (corners kept as they are, edges stretched)"><span>Edge (px)</span><input className="lx-input" type="number" min={1} value={st.slice ?? 24} onChange={(e) => set({ slice: Math.max(1, Number(e.target.value)) }, 'Dialogue edge')} /></label>}
            </>}
            <div className="lx-doc" style={{ margin: '6px 0 0' }}>Speaker portraits</div>
            <label className="ds-row"><span>Frame</span><select className="lx-input" value={st.portraitShape ?? 'circle'} onChange={(e) => set({ portraitShape: e.target.value as any })}><option value="circle">Circle</option><option value="rounded">Rounded square</option><option value="square">Square</option><option value="none">No portraits</option></select></label>
            {(st.portraitShape ?? 'circle') !== 'none' && <>
              <label className="ds-row"><span>Frame picture</span>{picSelect(st.portraitFrame, (v) => set({ portraitFrame: v }), (n) => ({ portraitFrame: n }))}</label>
              <label className="ds-row"><span>Side</span><select className="lx-input" value={st.portraitSide ?? 'left'} onChange={(e) => set({ portraitSide: e.target.value as any })}><option value="left">Left</option><option value="right">Right</option></select></label>
              {speakers.map((sp) => <label key={sp} className="ds-row"><span>{sp}</span>{picSelect(st.portraits?.[sp], (v) => set({ portraits: { ...(st.portraits ?? {}), [sp]: v ?? '' } }, 'Portrait'), (n) => ({ portraits: { ...(st.portraits ?? {}), [sp]: n } }))}</label>)}
              {!speakers.length && <span className="lx-doc">Write lines with speaker names to give them portraits.</span>}
            </>}
          </div>
          <div ref={stage} style={{ position: 'relative', minHeight: 340, borderRadius: 8, overflow: 'hidden', background: 'linear-gradient(160deg,#5a7fa8,#2b3d55 60%,#1b2433)' }}>
            {head && <>
              {/* Stand-ins: the speaker (right) and the player (left), so bubbles show over their heads. */}
              <div style={{ position: 'absolute', left: 'calc(68% - 16px)', top: '54%', width: 32, height: 70, borderRadius: '16px 16px 6px 6px', background: '#22252c' }} />
              <div style={{ position: 'absolute', left: 'calc(30% - 16px)', top: '58%', width: 32, height: 62, borderRadius: '16px 16px 6px 6px', background: '#3a3f4b' }} />
              <div ref={choicesEl} style={{ position: 'absolute', left: '30%', top: '58%', transform: 'translate(-50%,calc(-100% - 12px))', textAlign: 'center' }} />
            </>}
            <div ref={box} />
          </div>
        </div>
      </div>
    </div>, document.body);
}
