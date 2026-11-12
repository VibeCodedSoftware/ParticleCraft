// Validation, migration and compatibility reporting for logic documents.
import { BLOCK_DEFS } from './blocks/definitions';
import { tryParse } from './expr';
import { LOGIC_FORMAT, LOGIC_SCHEMA_VERSION, type AppId, type BlockInstance, type EventNode, type LogicDocument } from './schema';
import { BEHAVIORS } from './runtime/behaviors';
import { splitArgs } from './runtime/blockImpl';

export interface Issue { level: 'error' | 'warning' | 'info'; message: string; eventId?: string; blockId?: string }
export interface TypeInfo { name: string; vars: string[]; behaviors: string[] }

const SPECIAL_IDENTS = new Set(['dt', 'time', 'wallclocktime', 'tickcount', 'timescale', 'pi', 'loopindex', 'fps', 'randomseed', 'inputdevice', 'inputdevicetype', 'movex', 'movey', 'lookx', 'looky', 'touchcount', 'touchx', 'touchy', 'pinch', 'panx', 'pany', 'swipespeed']);
const SPECIAL_OBJECTS = new Set(['self', 'mouse', 'camera', 'function']);

export function validateDocument(doc: LogicDocument, opts: { app: AppId; types?: TypeInfo[]; /** Check only this sheet and what it includes: `types` are one scene's objects, and other sheets belong to other scenes. */ sheetId?: string } = { app: 'logiccraft' }): Issue[] {
  const issues: Issue[] = [];
  if (doc?.format !== LOGIC_FORMAT) issues.push({ level: 'error', message: `Not a logic document (format "${doc?.format}")` });
  if (doc.schemaVersion > LOGIC_SCHEMA_VERSION) issues.push({ level: 'warning', message: `Document schema v${doc.schemaVersion} is newer than this app (v${LOGIC_SCHEMA_VERSION}). Unknown data is preserved.` });
  const types = opts.types ? new Map(opts.types.map((t) => [t.name.toLowerCase(), t])) : null;
  const globals = new Set(doc.globals.map((g) => g.name));
  const ids = new Set<string>();
  const functions = new Set<string>();
  for (const s of doc.sheets) walk(s.events, (n) => { if (n.kind === 'event') for (const c of n.conditions) if (c.block === 'function.on_function') functions.add(String(c.params.name).toLowerCase()); });

  const checkNodes = (nodes: EventNode[], scope: Set<string>) => {
    let prevWasEvent = false;
    for (const n of nodes) {
      if (ids.has(n.id)) issues.push({ level: 'error', message: `Duplicate id ${n.id}`, eventId: n.id });
      ids.add(n.id);
      if (n.kind === 'comment') continue;
      if (n.kind === 'group') { prevWasEvent = false; checkNodes(n.children, scope); continue; }
      const local = new Set(scope);
      for (const v of n.locals ?? []) local.add(v.name);
      if (n.isElse && !prevWasEvent) issues.push({ level: 'error', message: 'Else must directly follow another event', eventId: n.id });
      n.conditions.forEach((c, idx) => {
        const def = BLOCK_DEFS[c.block];
        checkBlock(c, n.id, local, 'condition');
        if (def?.trigger && idx > 0) issues.push({ level: 'error', message: `Trigger "${def.name}" must be the first condition`, eventId: n.id, blockId: c.id });
      });
      n.actions.forEach((a) => checkBlock(a, n.id, local, 'action'));
      checkNodes(n.children, local);
      prevWasEvent = true;
    }
  };

  const checkBlock = (b: BlockInstance, eventId: string, scope: Set<string>, slot: 'condition' | 'action') => {
    if (ids.has(b.id)) issues.push({ level: 'error', message: `Duplicate block id ${b.id}`, eventId, blockId: b.id });
    ids.add(b.id);
    const def = BLOCK_DEFS[b.block];
    if (!def) { issues.push({ level: 'warning', message: `Unknown block "${b.block}" (kept, but skipped when running)`, eventId, blockId: b.id }); return; }
    if (def.kind !== slot) issues.push({ level: 'error', message: `"${def.name}" is a${def.kind === 'action' ? 'n action' : ' condition'} but is placed as a${slot === 'action' ? 'n action' : ' condition'}`, eventId, blockId: b.id });
    if (!def.apps.includes(opts.app)) issues.push({ level: 'warning', message: `"${def.name}" is only supported in ${def.apps.join(', ')}`, eventId, blockId: b.id });
    if (def.target === 'object') {
      if (!b.target) issues.push({ level: 'error', message: `"${def.name}" needs an object`, eventId, blockId: b.id });
      else if (types && !types.has(b.target.toLowerCase())) issues.push({ level: 'error', message: `Object "${b.target}" does not exist`, eventId, blockId: b.id });
      else if (types && def.behavior && !types.get(b.target.toLowerCase())!.behaviors.includes(def.behavior)) {
        issues.push({ level: 'warning', message: `${b.target} needs the ${BEHAVIORS[def.behavior]?.name ?? def.behavior} behavior for "${def.name}"`, eventId, blockId: b.id });
      }
    }
    for (const p of def.params) {
      const v = b.params[p.name];
      if (v === undefined) continue;
      if (p.type === 'expr') {
        if (v === '' && p.name !== 'args') { issues.push({ level: 'error', message: `"${p.label}" is empty in "${def.name}"`, eventId, blockId: b.id }); continue; }
        if (v === '') continue;
        // "args" is a comma-separated list of expressions (Call function).
        const parts = p.name === 'args' ? splitArgs(String(v)) : [v];
        const bad = parts.map((x) => tryParse(x as any)).find((r) => !r.ok) as { ok: false; error: string } | undefined;
        if (bad) { issues.push({ level: 'error', message: `${def.name} › ${p.label}: ${bad.error}`, eventId, blockId: b.id }); continue; }
      }
      if (p.type === 'variable' && !scope.has(String(v)) && !globals.has(String(v))) issues.push({ level: 'error', message: `Variable "${v}" is not defined`, eventId, blockId: b.id });
      if (p.type === 'objectType' && types && !types.has(String(v).toLowerCase())) issues.push({ level: 'error', message: `Object "${v}" does not exist`, eventId, blockId: b.id });
      if (p.type === 'function' && b.block === 'function.call' && !functions.has(String(v).toLowerCase())) issues.push({ level: 'warning', message: `No "On function ${v}" event exists`, eventId, blockId: b.id });
    }
  };

  let toCheck = doc.sheets;
  if (opts.sheetId && doc.sheets.some((s) => s.id === opts.sheetId)) {
    const ids = new Set<string>();
    const add = (id: string) => { if (ids.has(id)) return; ids.add(id); doc.sheets.find((s) => s.id === id)?.includes?.forEach(add); };
    add(opts.sheetId);
    toCheck = doc.sheets.filter((s) => ids.has(s.id));
  }
  for (const s of toCheck) checkNodes(s.events, new Set());
  void SPECIAL_IDENTS; void SPECIAL_OBJECTS;
  return issues;
}

function walk(nodes: EventNode[], fn: (n: EventNode) => void) {
  for (const n of nodes) { fn(n); if (n.kind !== 'comment') walk(n.children, fn); }
}

// ------------------------------------------------------------------ migration
/** Old block IDs that were renamed. Imported documents are rewritten to the current IDs. */
export const BLOCK_ID_ALIASES: Record<string, string> = {
  'move.set_speed': 'movement.set_speed',
  'system.compare': 'system.compare_values',
  'system.on_start': 'system.on_start_of_layout',
  'keyboard.on_pressed': 'input.on_key_pressed',
};

export interface MigrationResult { doc: LogicDocument; applied: string[] }

export function migrateDocument(raw: any): MigrationResult {
  const applied: string[] = [];
  if (!raw || typeof raw !== 'object') throw new Error('Invalid logic document');
  const doc = JSON.parse(JSON.stringify(raw));
  if (!doc.format) { doc.format = LOGIC_FORMAT; applied.push('added format'); }
  if (!doc.schemaVersion || doc.schemaVersion < 1) {
    // v0 (prototype) used cond/acts/subs keys and had no plane or extensions.
    const fix = (n: any) => {
      if (n.cond) { n.conditions = n.cond; delete n.cond; }
      if (n.acts) { n.actions = n.acts; delete n.acts; }
      if (n.subs) { n.children = n.subs; delete n.subs; }
      if (!n.kind) n.kind = n.name !== undefined && !n.conditions ? 'group' : 'event';
      if (n.kind === 'event') { n.conditions ??= []; n.actions ??= []; }
      n.children ??= [];
      n.children.forEach(fix);
    };
    if (Array.isArray(doc.events) && !doc.sheets) { doc.sheets = [{ id: 'sheet_main', name: 'Event sheet 1', events: doc.events }]; delete doc.events; }
    for (const s of doc.sheets ?? []) s.events.forEach(fix);
    doc.plane ??= 'xy';
    doc.extensions ??= {};
    doc.functions ??= [];
    doc.globals ??= [];
    doc.meta ??= { createdBy: 'logiccraft', created: new Date().toISOString(), modified: new Date().toISOString() };
    doc.schemaVersion = 1;
    applied.push('v0 → v1: renamed cond/acts/subs, added plane and extensions');
  }
  let renamed = 0;
  for (const s of doc.sheets ?? []) walk(s.events, (n: any) => {
    if (n.kind !== 'event') return;
    for (const b of [...n.conditions, ...n.actions]) if (BLOCK_ID_ALIASES[b.block]) { b.block = BLOCK_ID_ALIASES[b.block]; renamed++; }
  });
  if (renamed) applied.push(`renamed ${renamed} legacy block id(s)`);
  return { doc, applied };
}

// ------------------------------------------------------------------ compatibility
export interface CompatReport {
  target: AppId;
  blockCount: number;
  supported: number;
  unsupported: { blockId: string; block: string; name: string; apps: AppId[]; eventId: string }[];
  unknown: { blockId: string; block: string; eventId: string }[];
  ok: boolean;
}

export function compatibilityReport(doc: LogicDocument, target: AppId): CompatReport {
  const r: CompatReport = { target, blockCount: 0, supported: 0, unsupported: [], unknown: [], ok: true };
  for (const s of doc.sheets) walk(s.events, (n) => {
    if (n.kind !== 'event') return;
    for (const b of [...n.conditions, ...n.actions]) {
      r.blockCount++;
      const def = BLOCK_DEFS[b.block];
      if (!def) r.unknown.push({ blockId: b.id, block: b.block, eventId: n.id });
      else if (!def.apps.includes(target)) r.unsupported.push({ blockId: b.id, block: b.block, name: def.name, apps: def.apps, eventId: n.id });
      else r.supported++;
    }
  });
  r.ok = !r.unsupported.length && !r.unknown.length;
  return r;
}
