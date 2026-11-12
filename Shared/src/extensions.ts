// Extension manifests (craft.extension v1). Extensions are DECLARATIVE: they contribute functions made
// of shared blocks, never JavaScript. They run under the normal runtime limits, so a third-party
// extension cannot freeze the app, touch the file system or the network.
import { createLogicDocument, deepClone, type EventNode, type LogicDocument } from './schema';
import { validateDocument, type Issue } from './validate';
import { BLOCK_DEFS } from './blocks/definitions';
import { emptyScene } from './runtime/scene';
import { Runtime } from './runtime/runtime';

export interface ExtensionManifest {
  format: 'craft.extension';
  schemaVersion: number;
  id: string; name: string; version: string; description?: string; author?: string;
  permissions: string[];
  compatibility: { apps: string[]; logicSchema: number };
  functions: { name: string; doc?: string; params?: string[]; events: EventNode[] }[];
  tests?: { call: string; args: any[]; expect: any }[];
}

const ALLOWED_PERMISSIONS = new Set<string>([]);

export function validateExtension(m: any): { ok: boolean; problems: string[]; issues: Issue[] } {
  const problems: string[] = [];
  if (m?.format !== 'craft.extension') problems.push('Not an extension manifest (format must be "craft.extension").');
  if (m?.schemaVersion !== 1) problems.push(`Unsupported extension schema v${m?.schemaVersion}.`);
  if (!/^[a-z0-9_.-]+$/i.test(m?.id ?? '')) problems.push('Missing or invalid id.');
  if (!m?.name || !m?.version) problems.push('Missing name or version.');
  for (const p of m?.permissions ?? []) if (!ALLOWED_PERMISSIONS.has(p)) problems.push(`Permission "${p}" is not available to extensions.`);
  if (!Array.isArray(m?.functions) || !m.functions.length) problems.push('No functions defined.');
  const doc = extensionDocument(m);
  const issues = problems.length ? [] : validateDocument(doc, { app: 'logiccraft' }).filter((i) => i.level === 'error');
  // Every block must be a known shared block (no app-specific or unknown blocks).
  for (const f of m?.functions ?? []) {
    const walk = (ns: any[]) => ns.forEach((n) => { if (n.kind === 'event') for (const b of [...n.conditions, ...n.actions]) if (!BLOCK_DEFS[b.block]) problems.push(`Function ${f.name}: unknown block ${b.block}`); if (n.children) walk(n.children); });
    walk(f.events ?? []);
  }
  return { ok: !problems.length && !issues.length, problems, issues };
}

function extensionDocument(m: ExtensionManifest): LogicDocument {
  const d = createLogicDocument(m?.name ?? 'extension', 'logiccraft');
  d.sheets[0].events = (m?.functions ?? []).flatMap((f) => deepClone(f.events ?? []));
  return d;
}

/** Run the manifest's self-tests in an isolated runtime. */
export function testExtension(m: ExtensionManifest): { name: string; pass: boolean; got: any; expect: any }[] {
  const doc = extensionDocument(m);
  const rt = new Runtime(emptyScene('test', '2d'), doc, { app: 'logiccraft', maxOpsPerTick: 200000 });
  rt.tick();
  return (m.tests ?? []).map((t) => {
    let got: any;
    try { got = rt.callFunction(t.call, t.args); } catch (e: any) { got = 'error: ' + e.message; }
    const pass = typeof t.expect === 'number' ? Math.abs(Number(got) - t.expect) < 1e-9 : got === t.expect;
    return { name: `${t.call}(${t.args.join(', ')})`, pass, got, expect: t.expect };
  });
}

/** Install: adds a sheet "ext:<id>" with the extension functions and includes it in the main sheet. */
export function installExtension(doc: LogicDocument, m: ExtensionManifest, mainSheetId: string) {
  const id = 'ext:' + m.id;
  doc.sheets = doc.sheets.filter((s) => s.id !== id);
  doc.sheets.push({ id, name: `${m.name} ${m.version} (extension)`, events: deepClone(m.functions.flatMap((f) => f.events)) });
  const main = doc.sheets.find((s) => s.id === mainSheetId) ?? doc.sheets[0];
  main.includes = [...new Set([...(main.includes ?? []), id])];
  doc.extensions.installed = { ...(doc.extensions.installed ?? {}), [m.id]: { version: m.version, functions: m.functions.map((f) => ({ name: f.name, doc: f.doc, params: f.params })) } };
}

export function uninstallExtension(doc: LogicDocument, extId: string) {
  const id = 'ext:' + extId;
  doc.sheets = doc.sheets.filter((s) => s.id !== id);
  for (const s of doc.sheets) if (s.includes) s.includes = s.includes.filter((x) => x !== id);
  if (doc.extensions.installed) delete doc.extensions.installed[extId];
}
