// Compresses one picture at a time, away from the game's own thread (see textureManager.ts).
import { encodeChain } from './textureCodec';

self.onmessage = (ev: MessageEvent<{ id: number; data: Uint8ClampedArray; width: number; height: number; family: 'bc' | 'etc' }>) => {
  const { id, data, width, height, family } = ev.data;
  try {
    const { format, levels } = encodeChain(data, width, height, family);
    (self as unknown as Worker).postMessage({ id, format, levels }, levels.map((l) => l.data.buffer));
  } catch (e) {
    (self as unknown as Worker).postMessage({ id, error: String(e) });
  }
};
