// Pictures panel: the game UI's own pictures — transition shapes and fade maps, transition covers, dialogue box
// backgrounds and frames, speaker portraits. Import (stored with the project), preview, rename (blocks and the dialogue
// look follow) and remove. Saved in the logic document (doc.pictures) so both apps' blocks list the names.
import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { Glyph } from './icons';
import type { LogicDocument, PictureDef } from '../src/schema';
import { edit, renamePictureRefs } from './logicOps';

export const PICTURE_ACCEPT = '.png,.jpg,.jpeg,.webp,.gif,.svg';
const PIC_RE = /\.(png|jpe?g|webp|gif|svg)$/i;

export interface PicturePanelProps {
  doc: LogicDocument;
  onChange: (doc: LogicDocument, label: string) => void;
  /** Store an imported file with the project and return its reference. */
  importFile: (f: File) => Promise<string>;
  /** Reference -> URL. */
  resolve: (ref: string) => string | null;
}

export function PicturesButton(props: PicturePanelProps) {
  const [open, setOpen] = useState(false);
  const n = props.doc.pictures?.length ?? 0;
  return (
    <>
      <button className="csp-btn" title="Pictures for the game's UI: your own transition shapes and fade maps, transition covers, dialogue boxes and speaker portraits" onClick={() => setOpen(true)}>Pictures{n ? ` (${n})` : ''}</button>
      {open && createPortal(<PicturePanel {...props} onClose={() => setOpen(false)} />, document.body)}
    </>
  );
}

const cleanName = (s: string) => s.replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9_ -]+/g, '').trim().replace(/\s+/g, '_') || 'Picture';

/** Where a picture is used (blocks and the dialogue look), for the panel. */
function usesOf(doc: LogicDocument, name: string): string[] {
  const n = name.toLowerCase(), out: string[] = [];
  const st = doc.dialogueStyle;
  if (st?.boxPicture?.toLowerCase() === n) out.push('dialogue box');
  if (st?.portraitFrame?.toLowerCase() === n) out.push('portrait frame');
  for (const [sp, p] of Object.entries(st?.portraits ?? {})) if (p.toLowerCase() === n) out.push(`portrait of ${sp}`);
  const sheets = JSON.stringify(doc.sheets).toLowerCase();
  if (sheets.includes(`"picture":"${n}"`) || sheets.includes(`"cover":"${n}"`)) out.push('transition blocks');
  return out;
}

export function PicturePanel({ doc, onChange, importFile, resolve, onClose }: PicturePanelProps & { onClose: () => void }) {
  const pics = doc.pictures ?? [];
  const [sel, setSel] = useState(pics[0]?.name ?? '');
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const cur = pics.find((p) => p.name === sel);
  const unique = (base: string) => { let n = base, k = 2; while (pics.some((p) => p.name.toLowerCase() === n.toLowerCase())) n = `${base}_${k++}`; return n; };
  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setErr('');
    const added: PictureDef[] = [];
    for (const f of [...files]) {
      if (!PIC_RE.test(f.name)) { setErr(`${f.name}: not a picture (use PNG, JPG, WebP, GIF or SVG).`); continue; }
      setBusy(`Importing ${f.name}…`);
      try { added.push({ name: unique(cleanName(f.name)), ref: await importFile(f) }); } catch (e: any) { setErr(`${f.name}: ${e?.message ?? e}`); }
    }
    setBusy('');
    if (added.length) { onChange(edit(doc, (d) => { (d.pictures ??= []).push(...added); }), 'Import pictures'); setSel(added[0].name); }
  };
  const rename = (to: string) => {
    const name = cleanName(to);
    if (!cur || !name || name === cur.name || pics.some((p) => p.name.toLowerCase() === name.toLowerCase())) return;
    const from = cur.name;
    onChange(edit(doc, (d) => { const p = d.pictures!.find((x) => x.name === from)!; p.name = name; renamePictureRefs(d, from, name); }), 'Rename picture');
    setSel(name);
  };
  const url = cur ? resolve(cur.ref) : null;
  const uses = cur ? usesOf(doc, cur.name) : [];
  return (
    <div className="lx-modal-back" onMouseDown={onClose}>
      <div className="lx-modal wide vp-panel" onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') onClose(); }}>
        <div className="lx-modal-head"><b>Pictures</b><span className="lx-doc" style={{ margin: 0 }}>Your own transition shapes and fade maps, transition covers, dialogue boxes and speaker portraits.</span><button className="lx-btn" style={{ marginLeft: 'auto' }} onClick={onClose}>Done</button></div>
        <div className="vp-body">
          <div className="vp-list">
            <label className="lx-btn primary vp-import">+ Import picture…<input type="file" accept={PICTURE_ACCEPT} multiple hidden onChange={(e) => { void onFiles(e.target.files); e.target.value = ''; }} /></label>
            {busy && <div className="lx-doc">{busy}</div>}
            {err && <div className="vp-err"><Glyph e="⚠" i="alert-triangle" size={12} /> {err}</div>}
            {pics.map((p) => (
              <button key={p.name} className={'vp-row' + (p.name === sel ? ' on' : '')} onClick={() => setSel(p.name)}>
                <b>{p.name}</b><span>{usesOf(doc, p.name).join(', ') || 'not used yet'}</span>
              </button>
            ))}
            {!pics.length && !busy && <p className="lx-doc">No pictures yet. Import one to use as a transition shape (its opaque part is the hole), a fade map (greyscale: dark parts cover first), a cover, a dialogue box or a portrait.</p>}
          </div>
          <div className="vp-detail">
            {cur ? <>
              <label className="vp-field"><span>Name</span><input className="lx-input" defaultValue={cur.name} key={cur.name} onBlur={(e) => rename(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} /></label>
              <div className="vp-field"><span>Used by</span><span className="lx-doc" style={{ margin: 0 }}>{uses.join(', ') || 'nothing yet'}</span></div>
              {url ? <div style={{ background: 'repeating-conic-gradient(#555 0 25%, #444 0 50%) 50% / 16px 16px', borderRadius: 6, padding: 8, textAlign: 'center' }}><img src={url} alt={cur.name} style={{ maxWidth: '100%', maxHeight: 260, imageRendering: 'auto' }} /></div> : <div className="vp-err">This picture's file cannot be found.</div>}
              <div className="lx-modal-foot" style={{ justifyContent: 'space-between' }}>
                <span className="lx-doc">Transitions: choose "shape" or "map" and this picture in Load scene / Cover screen.</span>
                <button className="lx-btn danger" onClick={() => { if (window.confirm(`Remove "${cur.name}" from Pictures?${uses.length ? ` It is used by: ${uses.join(', ')}.` : ''}`)) { onChange(edit(doc, (d) => { d.pictures = (d.pictures ?? []).filter((p) => p.name !== cur.name); }), 'Remove picture'); setSel(''); } }}>Remove</button>
              </div>
            </> : <p className="lx-doc">Select a picture to preview it.</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
