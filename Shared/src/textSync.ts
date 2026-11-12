// One source of truth for text objects: the text typed in an object's Properties and the "Update text" blocks that
// set that object to a fixed text are kept equal. Editing either side updates the other (run after every edit), so
// the editor never shows one text while the game shows another. Blocks that compute text ("Score: " & score) are
// left alone; the Properties panel lists them instead (`textSetters`).
import { parseExpr } from './expr';
import type { BlockInstance, EventNode, LogicDocument } from './schema';
import type { InstanceData } from './runtime/scene';

/** The text of an expression that is just one string literal ("Hello"), else null. */
export function stringLiteral(src: unknown): string | null {
  if (typeof src !== 'string') return null;
  try { const e = parseExpr(src) as any; return e?.t === 'str' ? String(e.v) : null; } catch { return null; }
}
/** A string as an expression literal (quotes doubled, line breaks as \n). */
export function toLiteral(s: string): string { return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '""').replace(/\n/g, '\\n') + '"'; }

function* walk(nodes: EventNode[]): Generator<BlockInstance> {
  for (const n of nodes) {
    if (n.kind === 'event') { yield* n.conditions; yield* n.actions; yield* walk(n.children); }
    else if (n.kind === 'group') yield* walk(n.children);
  }
}
function* setTextBlocks(doc: LogicDocument | undefined): Generator<BlockInstance> {
  for (const s of doc?.sheets ?? []) for (const b of walk(s.events)) if (b.block === 'ui.set_text' && b.target) yield b;
}

/** "Update text" blocks aimed at an object type: the fixed text they set (null = computed). */
export function textSetters(doc: LogicDocument | undefined, type: string): { block: BlockInstance; literal: string | null }[] {
  return [...setTextBlocks(doc)].filter((b) => b.target === type && !b.disabled).map((block) => ({ block, literal: stringLiteral(block.params.text) }));
}

/**
 * Reconcile after an edit (`next` is the edited copy and is changed in place):
 *  - an object's text changed in Properties → fixed-text blocks for its type that showed the old text follow;
 *  - a block's fixed text changed (or a new one was added) → objects of that type showing the old text follow.
 */
export function syncTexts(prev: { instances: InstanceData[]; logic?: LogicDocument }, next: { instances: InstanceData[]; logic?: LogicDocument }) {
  const before = new Map(prev.instances.filter((i) => i.text).map((i) => [i.uid, i.text!.text]));
  const oldBlocks = new Map([...setTextBlocks(prev.logic)].map((b) => [b.id, stringLiteral(b.params.text)]));
  const blocks = [...setTextBlocks(next.logic)];
  // Properties → blocks.
  const propEdits = new Map<string, [string, string]>();
  for (const i of next.instances) {
    if (!i.text) continue;
    const old = before.get(i.uid);
    if (old !== undefined && old !== i.text.text) propEdits.set(i.type, [old, i.text.text]);
  }
  for (const b of blocks) {
    const e = propEdits.get(b.target!);
    if (e && stringLiteral(b.params.text) === e[0] && oldBlocks.get(b.id) === e[0]) b.params.text = toLiteral(e[1]);
  }
  // Blocks → Properties.
  for (const b of blocks) {
    if (propEdits.has(b.target!)) continue;
    const now = stringLiteral(b.params.text);
    if (now === null) continue;
    const had = oldBlocks.has(b.id), was = oldBlocks.get(b.id);
    if (had && was === now) continue;
    const insts = next.instances.filter((i) => i.type === b.target && i.text);
    if (had && was !== null) { for (const i of insts) if (i.text!.text === was) i.text!.text = now; }
    // A newly added fixed text (or a computed one made fixed) is what the object will show: if it is the only
    // fixed-text block for that type, the Properties text follows it.
    else if (textSetters(next.logic, b.target!).filter((s) => s.literal !== null).length === 1) for (const i of insts) i.text!.text = now;
  }
}
