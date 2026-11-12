// Pure editing operations on the logic IR. Both the event sheet and the block canvas call these,
// so every edit made in one view is, by construction, the same edit in the other.
import { BLOCK_DEFS, defaultParams } from '../src/blocks/definitions';
import { deepClone, newId, reassignIds, type BlockInstance, type EventBlock, type EventNode, type EventSheet, type LogicDocument, type VariableDef } from '../src/schema';

export type Slot = 'conditions' | 'actions';
export interface Loc { list: EventNode[]; index: number; parent: EventNode | null }

export function sheetOf(doc: LogicDocument, sheetId?: string): EventSheet {
  return doc.sheets.find((s) => s.id === sheetId) ?? doc.sheets[0];
}

export function findNode(nodes: EventNode[], id: string, parent: EventNode | null = null): Loc | null {
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (n.id === id) return { list: nodes, index: i, parent };
    if (n.kind !== 'comment') { const r = findNode(n.children, id, n); if (r) return r; }
  }
  return null;
}

export function findBlock(nodes: EventNode[], blockId: string): { ev: EventBlock; slot: Slot; index: number } | null {
  for (const n of nodes) {
    if (n.kind === 'event') {
      let i = n.conditions.findIndex((b) => b.id === blockId); if (i >= 0) return { ev: n, slot: 'conditions', index: i };
      i = n.actions.findIndex((b) => b.id === blockId); if (i >= 0) return { ev: n, slot: 'actions', index: i };
    }
    if (n.kind !== 'comment') { const r = findBlock(n.children, blockId); if (r) return r; }
  }
  return null;
}

export function isDescendant(nodes: EventNode[], ancestorId: string, id: string): boolean {
  const a = findNode(nodes, ancestorId);
  if (!a) return false;
  const n = a.list[a.index];
  return n.kind !== 'comment' && !!findNode(n.children, id);
}

/** Returns a new document with `fn` applied to a deep copy (simple immutable update). */
export function edit(doc: LogicDocument, fn: (d: LogicDocument) => void): LogicDocument {
  const d = deepClone(doc);
  fn(d);
  d.meta.modified = new Date().toISOString();
  return d;
}

/** A picture (Pictures panel) was renamed: blocks' picture parameters and the dialogue look follow. */
/** Renaming an animation clip: Play animation / On animation finished / Is animation playing that named it follow. */
export function renameAnimationRefs(d: LogicDocument, from: string, to: string): number {
  let n = 0;
  const visit = (nodes: EventNode[]) => {
    for (const x of nodes) {
      if (x.kind === 'event') for (const b of [...x.conditions, ...x.actions]) if (b.block.startsWith('anim.') && b.params.name === from) { b.params.name = to; n++; }
      if (x.kind !== 'comment') visit(x.children);
    }
  };
  for (const s of d.sheets) visit(s.events);
  return n;
}

export function renamePictureRefs(d: LogicDocument, from: string, to: string) {
  const same = (v: unknown) => typeof v === 'string' && v.toLowerCase() === from.toLowerCase();
  const visit = (nodes: EventNode[]) => {
    for (const n of nodes) {
      if (n.kind === 'event') for (const b of [...n.conditions, ...n.actions]) for (const p of BLOCK_DEFS[b.block]?.params ?? []) if (p.type === 'picture' && same(b.params[p.name])) b.params[p.name] = to;
      if (n.kind !== 'comment') visit(n.children);
    }
  };
  for (const s of d.sheets) visit(s.events);
  const st = d.dialogueStyle;
  if (st) {
    if (same(st.boxPicture)) st.boxPicture = to;
    if (same(st.portraitFrame)) st.portraitFrame = to;
    for (const k of Object.keys(st.portraits ?? {})) if (same(st.portraits![k])) st.portraits![k] = to;
  }
}

export function newBlock(blockId: string, target?: string, params?: Record<string, any>): BlockInstance {
  const def = BLOCK_DEFS[blockId];
  const b: BlockInstance = { id: newId('b'), block: blockId, params: { ...(def ? defaultParams(def) : {}), ...(params ?? {}) } };
  if (def?.target === 'object') b.target = target ?? 'Player';
  return b;
}

export function newEvent(conditions: BlockInstance[] = [], actions: BlockInstance[] = []): EventBlock {
  return { kind: 'event', id: newId('ev'), conditions, actions, children: [] };
}

/** Insert a node at the top level (parentId null) or as a child of an event/group. */
export function insertNode(sheet: EventSheet, node: EventNode, parentId: string | null, index = -1) {
  let list = sheet.events;
  if (parentId) {
    const p = findNode(sheet.events, parentId);
    const pn = p?.list[p.index];
    if (!pn || pn.kind === 'comment') throw new Error('Cannot add a sub-event here');
    list = pn.children;
  }
  if (index < 0 || index > list.length) list.push(node); else list.splice(index, 0, node);
}

/** Insert right after an existing node (same parent). */
export function insertAfter(sheet: EventSheet, afterId: string, node: EventNode) {
  const l = findNode(sheet.events, afterId);
  if (!l) sheet.events.push(node); else l.list.splice(l.index + 1, 0, node);
}

export function removeNode(sheet: EventSheet, id: string): EventNode | null {
  const l = findNode(sheet.events, id);
  if (!l) return null;
  const [n] = l.list.splice(l.index, 1);
  if (sheet.layout) delete sheet.layout[id];
  return n;
}

export function moveNode(sheet: EventSheet, id: string, parentId: string | null, index: number) {
  if (parentId === id || (parentId && isDescendant(sheet.events, id, parentId))) return;
  const l = findNode(sheet.events, id);
  if (!l) return;
  let target: EventNode[] = sheet.events;
  if (parentId) {
    const p = findNode(sheet.events, parentId);
    const pn = p?.list[p.index];
    if (!pn || pn.kind === 'comment') return;
    target = pn.children;
  }
  const sameList = target === l.list;
  const n = removeNode(sheet, id)!;
  insertNode(sheet, n, parentId, sameList && index > l.index ? index - 1 : index);
}

export function addBlockTo(sheet: EventSheet, eventId: string, slot: Slot, b: BlockInstance, index = -1) {
  const l = findNode(sheet.events, eventId);
  const ev = l?.list[l.index];
  if (!ev || ev.kind !== 'event') throw new Error('Not an event');
  const def = BLOCK_DEFS[b.block];
  // Triggers always go first, like Construct.
  if (slot === 'conditions' && def?.trigger) { ev.conditions.unshift(b); return; }
  const list = ev[slot];
  if (index < 0 || index > list.length) list.push(b); else list.splice(index, 0, b);
}

export function removeBlock(sheet: EventSheet, blockId: string): BlockInstance | null {
  const f = findBlock(sheet.events, blockId);
  if (!f) return null;
  return f.ev[f.slot].splice(f.index, 1)[0];
}

export function moveBlock(sheet: EventSheet, blockId: string, toEventId: string, slot: Slot, index: number) {
  const f = findBlock(sheet.events, blockId);
  if (!f) return;
  const def = BLOCK_DEFS[f.ev[f.slot][f.index].block];
  if (def && (def.kind === 'condition') !== (slot === 'conditions')) return; // conditions stay conditions
  const sameList = f.ev.id === toEventId && f.slot === slot;
  const b = removeBlock(sheet, blockId)!;
  addBlockTo(sheet, toEventId, slot, b, sameList && index > f.index ? index - 1 : index);
}

export function updateBlock(sheet: EventSheet, blockId: string, patch: Partial<BlockInstance>) {
  const f = findBlock(sheet.events, blockId);
  if (!f) return;
  Object.assign(f.ev[f.slot][f.index], patch);
}

export function duplicateNode(sheet: EventSheet, id: string): EventNode | null {
  const l = findNode(sheet.events, id);
  if (!l) return null;
  const copy = reassignIds(l.list[l.index]);
  l.list.splice(l.index + 1, 0, copy);
  return copy;
}

/** Variables visible from an event: its locals and its ancestors' locals, plus globals. */
export function variablesInScope(doc: LogicDocument, sheet: EventSheet, eventId?: string): VariableDef[] {
  const out: VariableDef[] = [...doc.globals];
  if (!eventId) return out;
  const chain: EventNode[] = [];
  const walk = (nodes: EventNode[], stack: EventNode[]): boolean => {
    for (const n of nodes) {
      if (n.id === eventId) { chain.push(...stack, n); return true; }
      if (n.kind !== 'comment' && walk(n.children, [...stack, n])) return true;
    }
    return false;
  };
  walk(sheet.events, []);
  for (const n of chain) if (n.kind === 'event') out.push(...(n.locals ?? []));
  return out;
}

export function uniqueName(base: string, taken: string[]) {
  if (!taken.includes(base)) return base;
  let i = 2; while (taken.includes(base + i)) i++;
  return base + i;
}

/** Clipboard payload shared by both views (also written to the OS clipboard as JSON). */
export interface LogicClipboard { kind: 'craft.logic.clip'; nodes?: EventNode[]; blocks?: BlockInstance[] }
export function clipboardOf(nodes: EventNode[] = [], blocks: BlockInstance[] = []): LogicClipboard {
  return { kind: 'craft.logic.clip', nodes: deepClone(nodes), blocks: deepClone(blocks) };
}
