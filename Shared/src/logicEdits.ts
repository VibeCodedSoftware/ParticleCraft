// Edits the editors make to logic on the user's behalf (kept here so both apps behave the same and tests cover them).
import { allBlocks, type LogicDocument } from './schema';

const isNum = (v: unknown) => typeof v === 'number' || (typeof v === 'string' && /^\s*-?\d+(\.\d+)?\s*$/.test(v));

/**
 * After a text object was dragged in the scene: "Set position" blocks that place that text type with plain numbers
 * equal to where it was (old x/y) now use the new position. Blocks with expressions (Player.X + 10) are left alone.
 * With `dryRun` nothing changes; the return value is how many blocks match.
 */
export function syncTextPositionBlocks(doc: LogicDocument, type: string, oldX: number, oldY: number, x: number, y: number, dryRun: boolean): number {
  let n = 0;
  const t = type.toLowerCase();
  for (const b of allBlocks(doc)) {
    if (b.block !== 'object.set_position' || b.target?.toLowerCase() !== t) continue;
    const px = b.params.x, py = b.params.y;
    if (!isNum(px) || !isNum(py)) continue;
    if (Math.abs(Number(px) - oldX) > 0.5 || Math.abs(Number(py) - oldY) > 0.5) continue;
    n++;
    if (!dryRun) { b.params.x = String(x); b.params.y = String(y); }
  }
  return n;
}
