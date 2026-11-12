// Under a sprite's Normal map field: says when the picture isn't a tangent-space normal map (Blender's Normal pass,
// object-space bakes) or when its green convention doesn't match the Format setting, and when 2D lighting is off (the
// map then does nothing at all).
import { useEffect, useState } from 'react';
import { checkNormalMap, type NormalMapCheck } from '../src/normalMapCheck';

const cache = new Map<string, Promise<NormalMapCheck | null>>();

function check(url: string): Promise<NormalMapCheck | null> {
  let p = cache.get(url);
  if (!p) {
    p = new Promise((resolve) => {
      const im = new Image();
      im.crossOrigin = 'anonymous';
      im.onload = () => {
        try {
          const c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight;
          const x = c.getContext('2d', { willReadFrequently: true })!; x.drawImage(im, 0, 0);
          resolve(checkNormalMap(x.getImageData(0, 0, c.width, c.height).data, c.width, c.height));
        } catch { resolve(null); }
      };
      im.onerror = () => resolve(null);
      im.src = url;
    });
    cache.set(url, p);
  }
  return p;
}

export function NormalMapNote({ url, format, lightingOn, onFormat, onLightingOn }: {
  url: string | null; format: 'opengl' | 'directx'; lightingOn: boolean;
  onFormat: (f: 'opengl' | 'directx') => void; onLightingOn?: () => void;
}) {
  const [res, setRes] = useState<NormalMapCheck | null>(null);
  useEffect(() => { let live = true; setRes(null); if (url) check(url).then((r) => { if (live) setRes(r); }); return () => { live = false; }; }, [url]);
  if (!url) return null;
  const style = { fontSize: 11, opacity: 0.85, margin: '2px 0 6px', lineHeight: 1.35 } as const;
  return <>
    {!lightingOn && <div className="hint" style={style}>2D lighting is off, so the normal map does nothing yet.{onLightingOn && <> <button className="btn small" onClick={onLightingOn}>Turn on 2D lighting</button></>}</div>}
    {res && !res.tangent && <div className="hint" style={{ ...style, color: '#e5a50a' }}>⚠ {res.reason} Bake or export a tangent-space normal map instead (Blender: Bake › Normal, Space: Tangent).</div>}
    {res?.tangent && res.format !== 'unknown' && res.format !== format && <div className="hint" style={style}>
      This map looks like {res.format === 'directx' ? 'DirectX (green down)' : 'OpenGL (green up)'}: lighting from above would shade it from below. <button className="btn small" onClick={() => onFormat(res.format as 'opengl' | 'directx')}>Use {res.format === 'directx' ? 'DirectX' : 'OpenGL'}</button>
    </div>}
  </>;
}
