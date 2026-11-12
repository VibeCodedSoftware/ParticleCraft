// Under a text object's Text field: which "Update text" blocks also set it. Fixed texts follow this field
// automatically (see textSync.ts); computed ones ("Score: " & score) replace it while the game runs, so they are
// listed here instead of silently winning.
import type { LogicDocument } from '../src/schema';
import { textSetters } from '../src/textSync';

export function TextSetterNote({ logic, type }: { logic: LogicDocument | undefined; type: string }) {
  const s = textSetters(logic, type);
  if (!s.length) return null;
  const computed = s.filter((x) => x.literal === null);
  return (
    <div className="hint" style={{ fontSize: 11, opacity: 0.8, margin: '2px 0 6px' }}>
      {computed.length
        ? <>While playing, {computed.length === 1 ? 'a block sets' : `${computed.length} blocks set`} this text to <code>{String(computed[0].block.params.text)}</code>{computed.length > 1 ? ' …' : ''}.</>
        : <>Linked to {s.length === 1 ? 'an "Update text" block' : `${s.length} "Update text" blocks`}: editing either one changes both.</>}
    </div>
  );
}
