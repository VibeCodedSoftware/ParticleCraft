// Videos panel: the cutscene videos a game can play. Import files (stored with the project), preview them,
// rename and remove. Saved in the logic document (doc.videos), so the "Play video" blocks list these names.
import React, { useState } from 'react';
import { Glyph } from './icons';
import { createPortal } from 'react-dom';
import type { LogicDocument, VideoDef } from '../src/schema';

export const VIDEO_ACCEPT = '.mp4,.webm,.ogv,.m4v,.mov';
const VIDEO_RE = /\.(mp4|webm|ogv|m4v|mov)$/i;

export interface VideoPanelProps {
  doc: LogicDocument;
  onChange: (doc: LogicDocument, label: string) => void;
  /** Store an imported file with the project and return its reference ("proj:videos/…"). */
  importFile: (f: File) => Promise<string>;
  /** Reference -> playable URL. */
  resolve: (ref: string) => string | null;
}

export function VideoButton(props: VideoPanelProps) {
  const [open, setOpen] = useState(false);
  const n = props.doc.videos?.length ?? 0;
  return (
    <>
      <button className="csp-btn" title="Cutscene videos: import, preview and name the videos your Play video blocks use" onClick={() => setOpen(true)}>Videos{n ? ` (${n})` : ''}</button>
      {open && createPortal(<VideoPanel {...props} onClose={() => setOpen(false)} />, document.body)}
    </>
  );
}

/** Seconds of a video file (0 when the browser cannot read it). */
function measure(url: string): Promise<number> {
  return new Promise((res) => {
    const v = document.createElement('video');
    v.preload = 'metadata'; v.muted = true;
    const done = (d: number) => { v.removeAttribute('src'); v.load(); res(d); };
    v.onloadedmetadata = () => done(Number.isFinite(v.duration) ? Math.round(v.duration * 100) / 100 : 0);
    v.onerror = () => done(0);
    setTimeout(() => done(0), 8000);
    v.src = url;
  });
}

const cleanName = (s: string) => s.replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9_ -]+/g, '').trim().replace(/\s+/g, '_') || 'Video';

export function VideoPanel({ doc, onChange, importFile, resolve, onClose }: VideoPanelProps & { onClose: () => void }) {
  const videos = doc.videos ?? [];
  const [sel, setSel] = useState(videos[0]?.name ?? '');
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const save = (next: VideoDef[], label: string) => onChange({ ...doc, videos: next }, label);
  const cur = videos.find((v) => v.name === sel);
  const unique = (base: string) => { let n = base, k = 2; while (videos.some((v) => v.name.toLowerCase() === n.toLowerCase())) n = `${base}_${k++}`; return n; };
  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setErr('');
    const added: VideoDef[] = [];
    for (const f of [...files]) {
      if (!VIDEO_RE.test(f.name)) { setErr(`${f.name}: not a video file (use MP4, WebM or OGV).`); continue; }
      setBusy(`Importing ${f.name}…`);
      try {
        const local = URL.createObjectURL(f);
        const duration = await measure(local);
        URL.revokeObjectURL(local);
        const ref = await importFile(f);
        added.push({ name: unique(cleanName(f.name)), ref, duration: duration || undefined });
        if (!duration) setErr(`${f.name}: imported, but this browser could not read its length. MP4 (H.264) or WebM play everywhere.`);
      } catch (e: any) { setErr(`${f.name}: ${e?.message ?? e}`); }
    }
    setBusy('');
    if (added.length) { save([...videos, ...added], 'Import videos'); setSel(added[0].name); }
  };
  const rename = (to: string) => {
    const name = cleanName(to);
    if (!cur || !name || name === cur.name || videos.some((v) => v.name.toLowerCase() === name.toLowerCase())) return;
    save(videos.map((v) => (v === cur ? { ...v, name } : v)), 'Rename video');
    setSel(name);
  };
  const url = cur ? resolve(cur.ref) : null;
  return (
    <div className="lx-modal-back" onMouseDown={onClose}>
      <div className="lx-modal wide vp-panel" onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') onClose(); }}>
        <div className="lx-modal-head"><b>Videos</b><span className="lx-doc" style={{ margin: 0 }}>Names here appear in the Play video, On video time and On video finished blocks.</span><button className="lx-btn" style={{ marginLeft: 'auto' }} onClick={onClose}>Done</button></div>
        <div className="vp-body">
          <div className="vp-list">
            <label className="lx-btn primary vp-import">+ Import video…<input type="file" accept={VIDEO_ACCEPT} multiple hidden onChange={(e) => { void onFiles(e.target.files); e.target.value = ''; }} /></label>
            {busy && <div className="lx-doc">{busy}</div>}
            {err && <div className="vp-err"><Glyph e="⚠" i="alert-triangle" size={12} /> {err}</div>}
            {videos.map((v) => (
              <button key={v.name} className={'vp-row' + (v.name === sel ? ' on' : '')} onClick={() => setSel(v.name)}>
                <b>{v.name}</b><span>{v.duration ? `${v.duration.toFixed(1)} s` : 'length unknown'}</span>
              </button>
            ))}
            {!videos.length && !busy && <p className="lx-doc">No videos yet. Import an MP4 or WebM file to use it as a cutscene.</p>}
          </div>
          <div className="vp-detail">
            {cur ? <>
              <label className="vp-field"><span>Name</span><input className="lx-input" defaultValue={cur.name} key={cur.name} onBlur={(e) => rename(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} /></label>
              <div className="vp-field"><span>File</span><code>{cur.ref.replace(/^proj:/, '')}</code></div>
              {url ? <video className="vp-preview" src={url} controls preload="metadata" /> : <div className="vp-err">This video's file cannot be found.</div>}
              <div className="lx-modal-foot" style={{ justifyContent: 'space-between' }}>
                <span className="lx-doc">Tip: "Play video" + "On video finished" give control back after a cutscene.</span>
                <button className="lx-btn danger" onClick={() => { if (window.confirm(`Remove "${cur.name}" from the Videos list? Blocks that play it will report it missing.`)) { save(videos.filter((v) => v !== cur), 'Remove video'); setSel(''); } }}>Remove</button>
              </div>
            </> : <p className="lx-doc">Select a video to preview it.</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
