// Flipbook timing panel (Flipbook node inspector): which frame each particle shows across its life, for the shortest,
// average and longest lifetimes, an animated preview of one particle, and what that means for lifetime sync.
import React, { useEffect, useRef, useState } from 'react';
import { flipbookFrame, playFrames, type EmitterParams } from '@shared/src/runtime/particles';
import { pictureOf } from './render/textures';

const W = 236, H = 96, P = 6;

export function FlipbookTiming({ params }: { params: EmitterParams }) {
  const fb = params.flipbook!;
  const n = playFrames(fb);
  const lives = [Math.max(0.02, params.lifetime - params.lifetimeVar), params.lifetime, params.lifetime + params.lifetimeVar];
  const X = (t: number) => P + t * (W - P * 2), Y = (f: number) => H - P - (Math.max(0, f) / Math.max(1, n - 1)) * (H - P * 2);
  const path = (life: number) => {
    let d = '';
    for (let i = 0; i <= 120; i++) { const t = i / 120, f = flipbookFrame(fb, t * life * 0.9999, life, 0, 0.5); d += `${i ? 'L' : 'M'}${X(t).toFixed(1)},${(f < 0 ? H - P : Y(f)).toFixed(1)}`; }
    return d;
  };
  // When does the average particle first show the last frame?
  const life = lives[1];
  let lastAt = -1, maxSeen = 0;
  for (let i = 0; i <= 400; i++) { const t = i / 400, f = Math.floor(flipbookFrame(fb, t * life * 0.9999, life, 0, 0.5)); if (f > maxSeen) maxSeen = f; if (f >= n - 1 && lastAt < 0) lastAt = t; }
  const advice = fb.loop !== 'once' || fb.loopStart != null
    ? `Loops over the whole life${fb.loopStart != null ? ` (section ${fb.loopStart}–${fb.loopEnd}${fb.outro ? ', outro at the end' : ''})` : ''}.`
    : lastAt < 0 ? `Particles die on frame ${maxSeen} of ${n - 1}: the end of the animation is never seen. Use "Timing: lifetime", more plays, or a longer lifetime.`
    : lastAt < 0.85 ? `The animation ends at ${Math.round(lastAt * 100)}% of the life, then ${fb.end === 'hide' ? 'the particle disappears' : `holds the last frame for the remaining ${Math.round((1 - lastAt) * 100)}%`}.`
    : 'The animation spans the whole life.';
  return (
    <div className="fbt">
      <svg viewBox={`0 0 ${W} ${H}`} className="ce-svg" style={{ height: H }}>
        <rect x={P} y={P} width={W - P * 2} height={H - P * 2} className="ce-bg" />
        {[0.25, 0.5, 0.75].map((t) => <line key={t} x1={X(t)} x2={X(t)} y1={P} y2={H - P} className="ce-grid" />)}
        <path d={path(lives[0])} className="fbt-line short" />
        <path d={path(lives[2])} className="fbt-line long" />
        <path d={path(lives[1])} className="ce-line" />
        <text x={P + 2} y={P + 9} className="ce-lbl">frame {n - 1}</text><text x={W - P - 36} y={H - P - 2} className="ce-lbl">life →</text>
      </svg>
      <span className="vx-doc">Frame over each particle's life: <b style={{ color: '#5eead4' }}>average</b> {life.toFixed(2)} s, <span style={{ color: '#f59e0b' }}>shortest</span> {lives[0].toFixed(2)} s, <span style={{ color: '#a78bfa' }}>longest</span> {lives[2].toFixed(2)} s. {advice}</span>
      {params.textureImage && <FlipbookPlayer params={params} />}
    </div>
  );
}

/** One particle's flipbook, played over its average life (with frame blending if on). */
function FlipbookPlayer({ params }: { params: EmitterParams }) {
  const fb = params.flipbook!;
  const c = useRef<HTMLCanvasElement>(null);
  const [, force] = useState(0);
  useEffect(() => {
    let raf = 0; const t0 = performance.now();
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const img = pictureOf(params.textureImage!, () => force((x) => x + 1));
      const cv = c.current; if (!cv || !img) return;
      const g = cv.getContext('2d')!; g.clearRect(0, 0, cv.width, cv.height);
      const life = params.lifetime, age = ((performance.now() - t0) / 1000) % life;
      const f = flipbookFrame(fb, age, life, 0, 0.5);
      const n = Math.max(1, fb.frames), cw = img.naturalWidth * (1 - 2 * (fb.margin?.[0] ?? 0) - (fb.cols - 1) * (fb.gap?.[0] ?? 0)) / fb.cols, ch = img.naturalHeight * (1 - 2 * (fb.margin?.[1] ?? 0) - (fb.rows - 1) * (fb.gap?.[1] ?? 0)) / fb.rows;
      const draw = (k: number, a: number) => {
        let cell = fb.order?.length ? fb.order[Math.floor(k) % fb.order.length] : Math.floor(k);
        cell = cell % (n * (fb.channelPacked ? 3 : 1));
        const cc = cell % n, sx = img.naturalWidth * (fb.margin?.[0] ?? 0) + (cc % fb.cols) * (cw + img.naturalWidth * (fb.gap?.[0] ?? 0)), sy = img.naturalHeight * (fb.margin?.[1] ?? 0) + Math.floor(cc / fb.cols) * (ch + img.naturalHeight * (fb.gap?.[1] ?? 0));
        g.globalAlpha = a; g.imageSmoothingEnabled = params.filter !== 'nearest' && params.style !== 'pixel';
        g.drawImage(img, sx, sy, cw, ch, 0, 0, cv.width, cv.height);
      };
      if (f >= 0) { draw(f, 1); const fr = f - Math.floor(f); if (fb.blend && fr > 0) draw(Math.floor(f) + 1, fr); }
      g.globalAlpha = 1; g.fillStyle = '#5eead4'; g.fillRect(0, cv.height - 3, (age / life) * cv.width, 3);
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, [params]);
  return <canvas ref={c} width={120} height={120} className="fbt-player checker" title="One particle's flipbook over its average life" />;
}
