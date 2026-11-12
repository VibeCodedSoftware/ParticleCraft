// Sprite-sheet slicer: frame size or columns × rows, frame count, validation, named animations picked by clicking
// frames, playback preview, and an optional colour key for sheets without transparency.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '@shared/ui/icons';
import type { SpriteData } from '@shared/src/runtime/scene';
import { animFrame, frameCell } from '@shared/src/runtime/spriteAnim';
import { Modal } from './ui';
import { detectSheet, sheetGrid } from '@shared/src/sheetDetect';

type Anim = { from: number; to: number; fps: number; loop: boolean };
/** Animation names movement behaviors play by themselves (the "role" of an animation is its name). */
const ROLE_NAMES = ['idle', 'walk', 'run', 'jump', 'fall', 'attack', 'hit', 'death', 'swim', 'climb', 'crouch'];

export interface SliceResult { frames: number; rows: number; fps: number; animation: string; animations: Record<string, Anim>; keyedImage?: Blob }

export function SpriteSheetDialog({ url, sprite, onApply, onClose }: { url: string; sprite: SpriteData; onApply: (r: SliceResult) => void; onClose: () => void }) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [err, setErr] = useState('');
  const [mode, setMode] = useState<'grid' | 'size'>('grid');
  const [cols, setCols] = useState(Math.max(1, Math.ceil(sprite.frames / Math.max(1, sprite.rows ?? 1))));
  const [rows, setRows] = useState(Math.max(1, sprite.rows ?? 1));
  const [fw, setFw] = useState(32), [fh, setFh] = useState(32);
  const [count, setCount] = useState(sprite.frames);
  const [fps, setFps] = useState(sprite.fps || 8);
  const [anims, setAnims] = useState<Record<string, Anim>>({ ...(sprite.animations ?? {}) });
  const [cur, setCur] = useState<string>(sprite.animation || Object.keys(sprite.animations ?? {})[0] || '');
  const [pick, setPick] = useState<number | null>(null);
  const [key, setKey] = useState<string | null>(null);
  /** Empty border around the sheet, and the gap between frames (px). */
  const [margin, setMargin] = useState(0), [spacing, setSpacing] = useState(0);
  const canvas = useRef<HTMLCanvasElement>(null);
  const preview = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const i = new Image(); i.crossOrigin = 'anonymous';
    i.onload = () => { setImg(i); if (sprite.frames <= 1) autoDetect(i); else { setFw(Math.round(i.width / Math.max(1, cols))); setFh(Math.round(i.height / Math.max(1, rows))); } };
    i.onerror = () => setErr('This image could not be loaded.');
    i.src = url;
  }, [url]);

  /** Auto-slice: find the frame grid from gutters or the repeat period (the user corrects it below). */
  const [detected, setDetected] = useState('');
  function autoDetect(im: HTMLImageElement | null = img) {
    if (!im) return;
    const c = document.createElement('canvas'); c.width = im.width; c.height = im.height;
    const g = c.getContext('2d')!; g.drawImage(im, 0, 0);
    const r = detectSheet(g.getImageData(0, 0, im.width, im.height).data, im.width, im.height);
    setMode('grid'); setCols(r.cols); setRows(r.rows); setCount(r.frames); setFw(Math.round(r.frameW)); setFh(Math.round(r.frameH));
    setDetected(r.how === 'single' ? 'One picture (no frame grid found).' : `Detected ${r.cols} ×${r.rows}, ${r.frames} frame(s) of ${Math.round(r.frameW)}×${Math.round(r.frameH)} px (${r.how === 'gutters' ? 'from the gaps between frames' : r.how === 'period' ? 'from the repeating pattern' : 'square frames'}). Correct it below if needed.`);
  }

  // Frame size mode derives the grid; grid mode derives the frame size.
  const grid = useMemo(() => {
    if (!img) return { c: cols, r: rows, w: 0, h: 0 };
    return sheetGrid(img.width, img.height, mode, cols, rows, fw, fh, margin, spacing);
  }, [img, mode, cols, rows, fw, fh, margin, spacing]);
  /** Where a frame's cell starts in the picture. */
  const cellX = (col: number) => margin + col * (grid.w + spacing), cellY = (row: number) => margin + row * (grid.h + spacing);
  const total = Math.min(count, grid.c * grid.r);
  const problems = useMemo(() => {
    const p: string[] = [];
    if (!img) return p;
    const usedW = 2 * margin + grid.c * grid.w + (grid.c - 1) * spacing, usedH = 2 * margin + grid.r * grid.h + (grid.r - 1) * spacing;
    if (mode === 'size' && (usedW !== img.width || usedH !== img.height)) p.push(`The image (${img.width}×${img.height}) is not a whole number of ${fw}×${fh} frames with this margin and spacing; the leftover edge is ignored.`);
    if (mode === 'grid' && (!Number.isInteger(grid.w) || !Number.isInteger(grid.h))) p.push(`${img.width}×${img.height} does not divide evenly into ${cols}×${rows}; frames are ${grid.w.toFixed(1)}×${grid.h.toFixed(1)} px and may blur.`);
    if (grid.w < 1 || grid.h < 1) p.push('The margin and spacing leave no room for frames.');
    if (count > grid.c * grid.r) p.push(`Only ${grid.c * grid.r} frames fit in the grid.`);
    for (const [n, a] of Object.entries(anims)) if (a.to >= total || a.from > a.to) p.push(`Animation "${n}" uses frames outside 0–${total - 1}.`);
    return p;
  }, [img, mode, cols, rows, fw, fh, count, anims, total, grid, margin, spacing]);

  // Sheet view with the grid and the frames of the selected animation highlighted.
  useEffect(() => {
    const c = canvas.current; if (!c || !img) return;
    const s = Math.min(1, 520 / img.width, 300 / img.height) * (img.width < 160 ? 3 : 1);
    c.width = img.width * s; c.height = img.height * s;
    const g = c.getContext('2d')!;
    g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, c.width, c.height);
    for (let y = 0; y < c.height; y += 8) for (let x = 0; x < c.width; x += 8) { g.fillStyle = (x + y) % 16 ? '#2a2f38' : '#353b46'; g.fillRect(x, y, 8, 8); }
    g.drawImage(img, 0, 0, c.width, c.height);
    const a = anims[cur];
    for (let f = 0; f < grid.c * grid.r; f++) {
      const col = f % grid.c, row = Math.floor(f / grid.c), x = cellX(col) * s, y = cellY(row) * s;
      const inAnim = a && f >= a.from && f <= a.to;
      g.strokeStyle = f >= total ? 'rgba(255,80,80,.5)' : inAnim ? '#4fd18b' : 'rgba(255,255,255,.35)';
      g.lineWidth = inAnim ? 2 : 1;
      g.strokeRect(x + 0.5, y + 0.5, grid.w * s - 1, grid.h * s - 1);
      g.fillStyle = 'rgba(0,0,0,.55)'; g.fillRect(x + 1, y + 1, 16, 11); g.fillStyle = '#fff'; g.font = '9px monospace'; g.fillText(String(f), x + 3, y + 10);
    }
    (c as any)._s = s;
  }, [img, grid, total, anims, cur, margin, spacing]);

  // Live preview of the selected animation (or every frame).
  useEffect(() => {
    let raf = 0; const t0 = performance.now();
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const c = preview.current; if (!c || !img) return;
      const g = c.getContext('2d')!;
      g.imageSmoothingEnabled = false;
      g.clearRect(0, 0, c.width, c.height);
      const a = anims[cur] ?? { from: 0, to: Math.max(0, total - 1), fps, loop: true };
      const f = animFrame(a, (performance.now() - t0) / 1000);
      const cell = frameCell({ frames: grid.c * grid.r, rows: grid.r }, f);
      const sc = Math.min(c.width / grid.w, c.height / grid.h);
      g.drawImage(img, cellX(cell.col), cellY(cell.row), grid.w, grid.h, (c.width - grid.w * sc) / 2, (c.height - grid.h * sc) / 2, grid.w * sc, grid.h * sc);
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, [img, grid, anims, cur, fps, total, margin, spacing]);

  const clickFrame = (e: React.MouseEvent) => {
    const c = canvas.current!; const r = c.getBoundingClientRect(); const s = (c as any)._s ?? 1;
    const x = (e.clientX - r.left) * (c.width / r.width) / s, y = (e.clientY - r.top) * (c.height / r.height) / s;
    if (key !== null) { // eyedropper: pick the background colour to make transparent
      const t = document.createElement('canvas'); t.width = img!.width; t.height = img!.height; const g = t.getContext('2d')!; g.drawImage(img!, 0, 0);
      const d = g.getImageData(Math.floor(x), Math.floor(y), 1, 1).data; setKey('#' + [d[0], d[1], d[2]].map((v) => v.toString(16).padStart(2, '0')).join('')); return;
    }
    const col = Math.floor((x - margin) / (grid.w + spacing)), row = Math.floor((y - margin) / (grid.h + spacing));
    if (col < 0 || row < 0 || col >= grid.c) return; // on the margin
    const f = row * grid.c + col;
    if (f >= total) return;
    if (!cur) return;
    if (pick === null) { setPick(f); setAnims({ ...anims, [cur]: { ...(anims[cur] ?? { fps, loop: true }), from: f, to: f } }); }
    else { setAnims({ ...anims, [cur]: { ...anims[cur], from: Math.min(pick, f), to: Math.max(pick, f) } }); setPick(null); }
  };
  // A grid sheet usually has one animation per row: name them after the movement roles (idle, walk, run…).
  const rowsAsAnims = () => {
    const next: Record<string, Anim> = {};
    for (let r = 0; r < grid.r; r++) {
      const from = r * grid.c; if (from >= total) break;
      next[ROLE_NAMES[r] ?? `row${r + 1}`] = { from, to: Math.min(total - 1, from + grid.c - 1), fps, loop: !['jump', 'attack', 'hit', 'death'].includes(ROLE_NAMES[r] ?? '') };
    }
    setAnims(next); setCur(Object.keys(next)[0] ?? '');
  };
  const addAnim = () => { const used = new Set(Object.keys(anims)); const n = ['idle', 'walk', 'run', 'jump', 'fall', 'attack'].find((x) => !used.has(x)) ?? 'anim' + (used.size + 1); setAnims({ ...anims, [n]: { from: 0, to: Math.max(0, total - 1), fps, loop: true } }); setCur(n); };

  const apply = async () => {
    let keyedImage: Blob | undefined;
    const keyed = !!key && key.startsWith('#'), packed = margin > 0 || spacing > 0;
    if ((keyed || packed) && img) {
      const t = document.createElement('canvas'); t.width = img.width; t.height = img.height; const g = t.getContext('2d')!; g.drawImage(img, 0, 0);
      if (keyed) {
        const d = g.getImageData(0, 0, t.width, t.height); const kr = parseInt(key!.slice(1, 3), 16), kg = parseInt(key!.slice(3, 5), 16), kb = parseInt(key!.slice(5, 7), 16);
        for (let i = 0; i < d.data.length; i += 4) if (Math.abs(d.data[i] - kr) + Math.abs(d.data[i + 1] - kg) + Math.abs(d.data[i + 2] - kb) < 24) d.data[i + 3] = 0;
        g.putImageData(d, 0, 0);
      }
      // Margin and gaps: the frames are copied side by side into a new sheet, so the game reads a plain grid.
      let out = t;
      if (packed) {
        out = document.createElement('canvas'); out.width = Math.round(grid.c * grid.w); out.height = Math.round(grid.r * grid.h);
        const o = out.getContext('2d')!; o.imageSmoothingEnabled = false;
        for (let row = 0; row < grid.r; row++) for (let col = 0; col < grid.c; col++) o.drawImage(t, cellX(col), cellY(row), grid.w, grid.h, col * grid.w, row * grid.h, grid.w, grid.h);
      }
      keyedImage = await new Promise<Blob>((r) => out.toBlob((b) => r(b!), 'image/png'));
    }
    onApply({ frames: total, rows: grid.r, fps, animation: anims[cur] ? cur : '', animations: anims, keyedImage });
  };

  return (
    <Modal title="Sprite sheet" wide onClose={onClose} footer={<><span className="hint small">{img ? `${img.width}×${img.height} px · ${grid.c}×${grid.r} grid · frame ${Math.round(grid.w)}×${Math.round(grid.h)} px · ${total} frames` : ''}</span><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!img} onClick={apply}>Apply</button></>}>
      {err && <div className="warn">{err}</div>}
      <div className="ss-body">
        <div className="ss-left">
          <canvas ref={canvas} className="ss-sheet" onClick={clickFrame} title={key !== null ? 'Click the background colour' : 'Click a frame, then another, to set the selected animation\'s range'} />
          {problems.map((p, i) => <div key={i} className="warn small"><Icon name="alert-triangle" size={12} /> {p}</div>)}
        </div>
        <div className="ss-right">
          <canvas ref={preview} width={160} height={160} className="ss-preview" />
          <div className="ss-form">
            <div className="seg"><button className={mode === 'grid' ? 'on' : ''} onClick={() => setMode('grid')}>Columns × rows</button><button className={mode === 'size' ? 'on' : ''} onClick={() => setMode('size')}>Frame size</button></div>
            <button className="btn small" onClick={() => autoDetect()} title="Find the frames from the gaps between them (or the repeating pattern)">Auto-detect</button>
            {detected && <div className="hint small">{detected}</div>}
            {mode === 'grid'
              ? <label>Columns × rows<span><input type="number" min={1} value={cols} onChange={(e) => { const v = Math.max(1, +e.target.value); setCols(v); setCount(v * rows); }} /> × <input type="number" min={1} value={rows} onChange={(e) => { const v = Math.max(1, +e.target.value); setRows(v); setCount(cols * v); }} /></span></label>
              : <label>Frame width × height<span><input type="number" min={1} value={fw} onChange={(e) => { setFw(Math.max(1, +e.target.value)); }} /> × <input type="number" min={1} value={fh} onChange={(e) => setFh(Math.max(1, +e.target.value))} /></span></label>}
            <label title="Empty border around the whole sheet, and the gap between frames, in pixels. Apply saves a new, tightly packed sheet; your original file is kept">Margin, spacing<span><input type="number" min={0} value={margin} onChange={(e) => setMargin(Math.max(0, +e.target.value))} /> , <input type="number" min={0} value={spacing} onChange={(e) => setSpacing(Math.max(0, +e.target.value))} /></span></label>
            <label title="Sheets often end with empty cells">Frames used<input type="number" min={1} value={count} onChange={(e) => setCount(Math.max(1, +e.target.value))} /></label>
            <label>Speed (fps)<input type="number" min={1} max={60} value={fps} onChange={(e) => setFps(Math.max(1, +e.target.value))} /></label>
            <label title="For sheets without transparency: click the button, then the background in the sheet">Transparent colour<span>{key && key.startsWith('#') ? <><i className="ss-swatch" style={{ background: key }} />{key}<button className="btn small" onClick={() => setKey(null)}>✕</button></> : <button className={'btn small' + (key === '' ? ' primary' : '')} onClick={() => setKey('')}>{key === '' ? 'Click the sheet…' : 'Pick colour'}</button>}</span></label>
          </div>
          <div className="ss-anims">
            <div className="ss-anims-head">Animations <button className="btn small" onClick={addAnim}>+ Add</button><button className="btn small" title="One animation per row of the sheet, named idle, walk, run, jump…" onClick={rowsAsAnims}>One per row</button></div>
            <datalist id="ss-roles">{ROLE_NAMES.map((r) => <option key={r} value={r} />)}</datalist>
            {Object.entries(anims).map(([n, a]) => (
              <div key={n} className={'ss-anim' + (n === cur ? ' on' : '')} onClick={() => setCur(n)}>
                <input list="ss-roles" title="Name (role): idle, walk, run, jump, fall and attack play by themselves with the movement behaviors" value={n} onChange={(e) => { const v = e.target.value.trim(); if (!v || anims[v]) return; const next: Record<string, Anim> = {}; for (const [k, x] of Object.entries(anims)) next[k === n ? v : k] = x; setAnims(next); setCur(v); }} />
                <span>{a.from}–{a.to}</span>
                <input type="number" title="fps" value={a.fps} onChange={(e) => setAnims({ ...anims, [n]: { ...a, fps: Math.max(1, +e.target.value) } })} />
                <label title="Loop"><input type="checkbox" checked={a.loop} onChange={(e) => setAnims({ ...anims, [n]: { ...a, loop: e.target.checked } })} />loop</label>
                <button className="btn small" onClick={(e) => { e.stopPropagation(); const next = { ...anims }; delete next[n]; setAnims(next); if (cur === n) setCur(''); }}>✕</button>
              </div>
            ))}
            {!Object.keys(anims).length && <div className="hint small">No named animations: the sprite plays all frames. Add idle / walk / jump… then click two frames on the sheet to set a range. Platform and 8-direction movement play idle, walk, jump and fall automatically.</div>}
          </div>
        </div>
      </div>
    </Modal>
  );
}
