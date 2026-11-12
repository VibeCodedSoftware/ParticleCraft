// Animated pictures → one sprite sheet (both apps). Each GIF, or each group of numbered pictures (walk_01.png,
// walk_02.png…), becomes one named animation; they are packed one row each. GameCraft stores the sheet as a project
// file, LogicCraft as an image in the project.

type Anim = { from: number; to: number; fps: number; loop: boolean };
export interface PackedAnimation { sheet: HTMLCanvasElement; frames: number; cols: number; rows: number; fps: number; animation: string; animations: Record<string, Anim>; frameW: number; frameH: number }

/** Animation names behaviors play by themselves; file names containing one get that name. */
const ROLES = ['idle', 'walk', 'run', 'jump', 'fall', 'attack', 'hit', 'hurt', 'death', 'die', 'swim', 'climb', 'crouch'];
const ROLE_ALIAS: Record<string, string> = { hurt: 'hit', die: 'death' };

/** "Hero_Walk_03.png" -> group "Hero_Walk", order 3. Pictures without a number are their own group. */
export function sequenceKey(fileName: string): { group: string; order: number } {
  const base = fileName.replace(/\.[^.]+$/, '');
  const m = base.match(/^(.*?)[\s_\-.]*(\d+)$/);
  return m && m[1] ? { group: m[1], order: Number(m[2]) } : { group: base, order: 0 };
}

/** Animation name for a group / GIF: a known role when the name contains one, else the cleaned name. */
export function animName(group: string, taken: Set<string>): string {
  const l = group.toLowerCase();
  const role = ROLES.find((r) => new RegExp(`(^|[^a-z])${r}([^a-z]|$)`).test(l));
  let n = role ? ROLE_ALIAS[role] ?? role : l.replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'anim';
  for (let k = 2; taken.has(n); k++) n = `${n.replace(/\d+$/, '')}${k}`;
  taken.add(n);
  return n;
}

/** Sheet layout: one row per animation, as wide as the longest; the animation ranges in reading order. */
export function sheetLayout(counts: number[]): { cols: number; rows: number; ranges: [number, number][] } {
  const cols = Math.max(1, ...counts), rows = Math.max(1, counts.length);
  return { cols, rows, ranges: counts.map((n, r) => [r * cols, r * cols + Math.max(1, n) - 1]) };
}

/** Are these files an animation (any GIF, or several numbered pictures) rather than separate pictures? */
export function looksAnimated(files: File[]): boolean {
  if (files.some((f) => /\.gif$/i.test(f.name))) return true;
  const stills = files.filter((f) => /\.(png|jpe?g|webp)$/i.test(f.name));
  return stills.length >= 2 && stills.filter((f) => /\d+\.[^.]+$/.test(f.name)).length >= 2;
}

/** Every frame of a GIF (or animated WebP) and its average speed, with the browser's own decoder. */
async function decodeAnimated(f: File): Promise<{ frames: CanvasImageSource[]; w: number; h: number; fps: number }> {
  const Dec = (globalThis as any).ImageDecoder;
  if (!Dec) { const b = await createImageBitmap(f); return { frames: [b], w: b.width, h: b.height, fps: 8 }; }
  const dec = new Dec({ data: await f.arrayBuffer(), type: f.type || 'image/gif' });
  await dec.tracks.ready;
  const n: number = dec.tracks.selectedTrack?.frameCount ?? 1;
  const frames: CanvasImageSource[] = []; let ms = 0, w = 0, h = 0;
  for (let k = 0; k < Math.min(n, 256); k++) {
    const { image } = await dec.decode({ frameIndex: k });
    w = image.displayWidth; h = image.displayHeight;
    ms += (image.duration ?? 100000) / 1000; // microseconds
    // Copy out of the VideoFrame (it has to be closed).
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    c.getContext('2d')!.drawImage(image, 0, 0); image.close();
    frames.push(c);
  }
  dec.close?.();
  const avg = ms / Math.max(1, frames.length);
  return { frames, w, h, fps: Math.max(1, Math.min(60, Math.round(1000 / Math.max(16, avg || 100)))) };
}

/** GIFs and/or numbered pictures → one packed sheet with a named animation per GIF / group. */
export async function packAnimation(files: File[]): Promise<PackedAnimation> {
  const clips: { name: string; frames: CanvasImageSource[]; w: number; h: number; fps: number }[] = [];
  const taken = new Set<string>();
  const stills = files.filter((f) => !/\.gif$/i.test(f.name)).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  for (const f of files.filter((x) => /\.gif$/i.test(x.name))) clips.push({ name: animName(f.name.replace(/\.[^.]+$/, ''), taken), ...(await decodeAnimated(f)) });
  const groups = new Map<string, { f: File; order: number }[]>();
  for (const f of stills) { const k = sequenceKey(f.name); (groups.get(k.group) ?? groups.set(k.group, []).get(k.group)!).push({ f, order: k.order }); }
  for (const [g, list] of groups) {
    list.sort((a, b) => a.order - b.order);
    const frames = await Promise.all(list.map((x) => createImageBitmap(x.f)));
    clips.push({ name: animName(g, taken), frames, w: Math.max(...frames.map((b) => b.width)), h: Math.max(...frames.map((b) => b.height)), fps: 10 });
  }
  if (!clips.length) throw new Error('no pictures to import');
  // Frames centred and bottom-aligned in cells as big as the largest frame.
  const w = Math.max(...clips.map((c) => c.w)), h = Math.max(...clips.map((c) => c.h));
  const lay = sheetLayout(clips.map((c) => c.frames.length));
  if (lay.cols * w > 8192 || lay.rows * h > 8192) throw new Error(`the sheet would be ${lay.cols * w}×${lay.rows * h} px (max 8192); use fewer or smaller frames`);
  const sheet = document.createElement('canvas'); sheet.width = lay.cols * w; sheet.height = lay.rows * h;
  const g = sheet.getContext('2d')!;
  clips.forEach((c, r) => c.frames.forEach((fr, k) => {
    const fw = (fr as any).width as number, fh = (fr as any).height as number;
    g.drawImage(fr, k * w + Math.floor((w - fw) / 2), r * h + (h - fh), fw, fh);
  }));
  const animations: Record<string, Anim> = {};
  clips.forEach((c, r) => { animations[c.name] = { from: lay.ranges[r][0], to: lay.ranges[r][1], fps: c.fps, loop: !/death|attack|hit|jump/.test(c.name) }; });
  return { sheet, frames: lay.cols * lay.rows, cols: lay.cols, rows: lay.rows, fps: clips[0].fps, animation: clips.find((c) => c.name === 'idle')?.name ?? clips[0].name, animations, frameW: w, frameH: h };
}
