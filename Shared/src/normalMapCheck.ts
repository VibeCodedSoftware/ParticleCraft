// Is a picture a usable 2D normal map, and which green convention does it use? Tangent-space normal maps are mostly
// lavender-blue (surfaces face the viewer: blue high, red and green around the middle). Blender's Normal render pass
// and object-space bakes are green / yellow / pink instead and light from the wrong sides. The convention shows on the
// silhouette: the top edge of a shape faces up, which is green > 0.5 in OpenGL (+Y) maps and < 0.5 in DirectX (−Y).

export interface NormalMapCheck {
  /** False when the colours can't be a tangent-space map (world / object-space pass, a colour picture...). */
  tangent: boolean;
  format: 'opengl' | 'directx' | 'unknown';
  /** Why it isn't tangent-space (shown to the user). */
  reason?: string;
}

/** Inspect RGBA pixels (row-major, top row first). Transparent pixels (alpha < 128) are the background. */
export function checkNormalMap(data: Uint8ClampedArray | Uint8Array, width: number, height: number): NormalMapCheck {
  const dec = (v: number) => v / 127.5 - 1;
  const opaque = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height && data[(y * width + x) * 4 + 3] >= 128;
  let n = 0, sx = 0, sy = 0, sz = 0, back = 0;
  let top = 0, topN = 0, bottom = 0, bottomN = 0;
  // Large pictures: every k-th pixel is plenty.
  const step = Math.max(1, Math.floor(Math.sqrt((width * height) / 250000)));
  for (let y = 0; y < height; y += step) for (let x = 0; x < width; x += step) {
    if (!opaque(x, y)) continue;
    const k = (y * width + x) * 4;
    const nx = dec(data[k]), ny = dec(data[k + 1]), nz = dec(data[k + 2]);
    n++; sx += nx; sy += ny; sz += nz; if (nz < -0.05) back++;
    if (!opaque(x, y - step)) { top += ny; topN++; }
    if (!opaque(x, y + step)) { bottom += ny; bottomN++; }
  }
  if (!n) return { tangent: false, format: 'unknown', reason: 'The picture is fully transparent.' };
  const mx = sx / n, my = sy / n, mz = sz / n;
  let reason: string | undefined;
  if (mz < 0.35 || back / n > 0.1) reason = 'Too little blue: surfaces should mostly face the viewer (a lavender-blue picture).';
  else if (Math.abs(mx) > 0.3 || Math.abs(my) > 0.3) reason = `Tinted ${Math.abs(mx) > Math.abs(my) ? (mx > 0 ? 'red / pink' : 'cyan') : my > 0 ? 'green' : 'magenta'}: the whole picture leans one way instead of averaging out.`;
  // Silhouette edges: tops face up, bottoms face down. Needs a transparent background and enough edge pixels.
  let format: NormalMapCheck['format'] = 'unknown';
  if (topN >= 8 && bottomN >= 8 && topN + bottomN < n) {
    const score = top / topN - bottom / bottomN;
    if (score > 0.15) format = 'opengl'; else if (score < -0.15) format = 'directx';
  }
  return reason ? { tangent: false, format, reason: reason + ' This looks like a world / object-space normal pass, not a tangent-space normal map.' } : { tangent: true, format };
}
