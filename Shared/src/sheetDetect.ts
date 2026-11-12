// Sprite-sheet auto-slicing: find the frame grid of an RGBA image. Frames are separated by empty gutters
// (transparent, or the background colour of the corners); without gutters the grid is the period at which the
// columns / rows repeat. The result is a starting point the user corrects in the slicer.

/**
 * The frame grid of a sheet with an empty margin around it and gaps between frames. By columns × rows the frame size
 * follows; by frame size the number that fit follows (at least one each way).
 */
export function sheetGrid(width: number, height: number, mode: 'grid' | 'size', cols: number, rows: number, frameW: number, frameH: number, margin = 0, spacing = 0): { c: number; r: number; w: number; h: number } {
  const roomW = width - 2 * margin, roomH = height - 2 * margin;
  if (mode === 'size') {
    const w = Math.max(1, frameW), h = Math.max(1, frameH);
    return { c: Math.max(1, Math.floor((roomW + spacing) / (w + spacing))), r: Math.max(1, Math.floor((roomH + spacing) / (h + spacing))), w, h };
  }
  return { c: cols, r: rows, w: (roomW - (cols - 1) * spacing) / cols, h: (roomH - (rows - 1) * spacing) / rows };
}

export interface SheetGuess { cols: number; rows: number; frameW: number; frameH: number; frames: number; how: 'gutters' | 'period' | 'square' | 'single' }

/** Is pixel (x, y) background: transparent, or close to the corner colour of an opaque sheet? */
function backgroundTest(d: Uint8ClampedArray | Uint8Array, w: number, h: number) {
  const at = (x: number, y: number) => (y * w + x) * 4;
  const corners = [at(0, 0), at(w - 1, 0), at(0, h - 1), at(w - 1, h - 1)];
  const transparent = corners.some((o) => d[o + 3] < 16) || (() => { let t = 0; for (let i = 3; i < d.length; i += 4 * 7) if (d[i] < 16) t++; return t > d.length / 4 / 7 / 20; })();
  if (transparent) return (x: number, y: number) => d[at(x, y) + 3] < 16;
  const o = corners[0], br = d[o], bg = d[o + 1], bb = d[o + 2];
  return (x: number, y: number) => { const p = at(x, y); return Math.abs(d[p] - br) + Math.abs(d[p + 1] - bg) + Math.abs(d[p + 2] - bb) < 24; };
}

/** Content runs along one axis: [start, end) spans separated by empty lines. */
function runs(empty: boolean[]): [number, number][] {
  const out: [number, number][] = [];
  let s = -1;
  empty.forEach((e, k) => { if (!e && s < 0) s = k; if (e && s >= 0) { out.push([s, k]); s = -1; } });
  if (s >= 0) out.push([s, empty.length]);
  return out;
}

/** The repeat period of a profile (sum of content per line): the first strong autocorrelation peak that divides n. */
function period(profile: number[], n: number, other: number): number {
  const mean = profile.reduce((a, b) => a + b, 0) / n;
  const v = profile.map((p) => p - mean);
  const energy = v.reduce((a, b) => a + b * b, 0) || 1;
  let best = n, bestScore = 0.5;
  for (let p = Math.max(4, Math.floor(other / 4)); p <= n / 2; p++) {
    if (n % p) continue;
    let s = 0; for (let i = 0; i + p < n; i++) s += v[i] * v[i + p];
    const score = s / energy;
    if (score > bestScore + 0.02) { bestScore = score; best = p; }
  }
  return best;
}

export function detectSheet(d: Uint8ClampedArray | Uint8Array, w: number, h: number): SheetGuess {
  const bg = backgroundTest(d, w, h);
  const colEmpty = Array.from({ length: w }, (_, x) => { for (let y = 0; y < h; y++) if (!bg(x, y)) return false; return true; });
  const rowEmpty = Array.from({ length: h }, (_, y) => { for (let x = 0; x < w; x++) if (!bg(x, y)) return false; return true; });
  const cr = runs(colEmpty), rr = runs(rowEmpty);
  const regular = (r: [number, number][], n: number) => r.length > 1 && (() => {
    const pitch = n / r.length; // frames laid out on an even pitch, content inside each cell
    return r.every(([a, b], k) => a >= Math.floor(k * pitch) - 1 && b <= Math.ceil((k + 1) * pitch) + 1);
  })();
  let cols = 1, rows = 1, how: SheetGuess['how'] = 'single';
  if (regular(cr, w) || regular(rr, h)) {
    cols = regular(cr, w) ? cr.length : 1; rows = regular(rr, h) ? rr.length : 1; how = 'gutters';
  } else {
    // No clean gutters: frames touch. Use the repeat period of the content profile.
    const colProfile = Array.from({ length: w }, (_, x) => { let s = 0; for (let y = 0; y < h; y++) if (!bg(x, y)) s++; return s; });
    const rowProfile = Array.from({ length: h }, (_, y) => { let s = 0; for (let x = 0; x < w; x++) if (!bg(x, y)) s++; return s; });
    const pw = period(colProfile, w, h), ph = period(rowProfile, h, w);
    if (pw < w || ph < h) { cols = Math.round(w / pw); rows = Math.round(h / ph); how = 'period'; }
    else if (w > h && w % h === 0) { cols = w / h; how = 'square'; }
    else if (h > w && h % w === 0) { rows = h / w; how = 'square'; }
  }
  const fw = w / cols, fh = h / rows;
  // Frames = non-empty cells, counted in reading order up to the last one with content (a partly filled last row).
  let frames = 0;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    let filled = false;
    for (let y = Math.floor(r * fh); y < Math.floor((r + 1) * fh) && !filled; y += 2) for (let x = Math.floor(c * fw); x < Math.floor((c + 1) * fw); x += 2) if (!bg(x, y)) { filled = true; break; }
    if (filled) frames = r * cols + c + 1;
  }
  return { cols, rows, frameW: fw, frameH: fh, frames: Math.max(1, frames), how };
}
