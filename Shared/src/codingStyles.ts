// Coding styles: different editors over the ONE shared logic document (schema.ts). Switching style never
// converts or copies logic - every view reads the same event tree and edits it through logicOps, so the program
// (events, order, conditions, actions, variables, code blocks, dialogue) is identical in every style.
import { walkEvents, type AppId, type LogicDocument } from './schema';

export type CodingStyleId = 'scratch' | 'pro' | 'nodes' | 'bricks' | 'code' | 'sheet';

export interface CodingStyleDef { id: CodingStyleId; name: string; icon: string; short: string; description: string }

export const CODING_STYLES: CodingStyleDef[] = [
  { id: 'scratch', name: 'Scratch blocks', icon: '🧩', short: 'Scratch', description: 'Colorful snap-together blocks. Drag from the palette, snap into stacks. LogicCraft default.' },
  { id: 'pro', name: 'Professional blocks', icon: '🧱', short: 'Pro blocks', description: 'Compact, high-contrast blocks with typed fields and an outline for large projects. GameCraft default.' },
  { id: 'nodes', name: 'Node graph', icon: '🕸️', short: 'Nodes', description: 'Free-floating nodes joined by execution wires: trigger → conditions → actions → sub-events.' },
  { id: 'bricks', name: 'Logic bricks', icon: '🔌', short: 'Bricks', description: 'UPBGE-style Sensors → Controllers → Actuators, grouped by object, wired left to right.' },
  { id: 'code', name: 'Code', icon: '💻', short: 'Code', description: 'The actual program as editable Craft script (synced back to the logic) and generated JavaScript.' },
  { id: 'sheet', name: 'Event sheet', icon: '📋', short: 'Sheet', description: 'Construct-style rows of conditions and actions.' },
];

export const defaultCodingStyle = (app: AppId): CodingStyleId => (app === 'logiccraft' ? 'scratch' : 'pro');

const KEY = (app: AppId) => `craft.codingStyle.${app}`;

export function loadCodingStyle(app: AppId): CodingStyleId {
  try {
    const v = localStorage.getItem(KEY(app)) as CodingStyleId | null;
    if (v && CODING_STYLES.some((s) => s.id === v)) return v;
  } catch { /* storage blocked */ }
  return defaultCodingStyle(app);
}

export function saveCodingStyle(app: AppId, s: CodingStyleId) {
  try { localStorage.setItem(KEY(app), s); } catch { /* storage blocked */ }
}

/**
 * How a style shows constructs it has no native shape for. Nothing is ever dropped: every view keeps
 * unsupported items in the document and shows them in the stated fallback form.
 */
export function styleCompatibility(doc: LogicDocument, sheetId: string | undefined, style: CodingStyleId): string[] {
  const sheet = doc.sheets.find((s) => s.id === sheetId) ?? doc.sheets[0];
  if (!sheet) return [];
  let groups = 0, comments = 0, elses = 0, ors = 0, locals = 0, subs = 0, loose = 0;
  walkEvents(sheet.events, (n, parent) => {
    if (n.kind === 'group') groups++;
    if (n.kind === 'comment') comments++;
    if (n.kind === 'event') {
      if (n.isElse) elses++; if (n.isOr) ors++; if (n.locals?.length) locals++; if (n.loose) loose++;
      if (parent?.kind === 'event') subs++;
    }
  });
  const out: string[] = [];
  if (style === 'nodes') {
    if (groups) out.push(`${groups} group(s) shown as frames around their nodes`);
    if (elses) out.push(`${elses} Else event(s) shown as an "else" branch wire`);
    if (locals) out.push(`${locals} event(s) with local variables: edit them in Event sheet view`);
  }
  if (style === 'bricks') {
    if (subs) out.push(`${subs} sub-event(s) shown as chained controllers (→ indented)`);
    if (groups) out.push(`${groups} group(s) shown as section headers`);
    if (elses) out.push(`${elses} Else event(s) shown as ELSE controllers`);
    if (locals) out.push(`${locals} event(s) with local variables: edit them in Event sheet view`);
  }
  if (style === 'code' && loose) out.push(`${loose} loose (not running) stack(s) kept as "loose event" blocks`);
  if (style !== 'scratch' && style !== 'pro' && comments && style !== 'code') out.push(`${comments} comment(s) shown as notes`);
  return out;
}
