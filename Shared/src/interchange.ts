// LogicCraft <-> GameCraft interchange. Packages carry the logic document untouched (including
// blocks the target does not support) so round trips are lossless; the target reports incompatibilities.
import { LOGIC_SCHEMA_VERSION, PACKAGE_FORMAT, deepClone, type AppId, type LogicDocument, type LogicPackage, type PortableObjectType } from './schema';
import { compatibilityReport, migrateDocument, validateDocument, type CompatReport, type Issue } from './validate';
import type { ObjectTypeDef, SceneData } from './runtime/scene';

export const SHARED_VERSION = '0.1.0';

export function objectTypesFromScene(scene: SceneData): PortableObjectType[] {
  const out: PortableObjectType[] = [];
  const seen = new Set<string>();
  for (const i of scene.instances) {
    if (seen.has(i.type.toLowerCase())) continue;
    seen.add(i.type.toLowerCase());
    const t = scene.objectTypes.find((x) => x.name.toLowerCase() === i.type.toLowerCase());
    out.push({
      name: i.type, kind: i.kind, color: i.color,
      size: [i.collider.size[0] * i.sx, i.collider.size[1] * i.sy, i.collider.size[2] * i.sz],
      vars: t?.vars ?? Object.entries(i.vars).map(([name, value]) => ({ name, type: typeof value === 'number' ? 'number' : typeof value === 'boolean' ? 'boolean' : 'string', value } as any)),
      behaviors: i.behaviors.map((b) => ({ type: b.type, props: { ...b.props } })),
    });
  }
  return out;
}

export function exportPackage(doc: LogicDocument, scene: SceneData | null, sourceApp: AppId, passthrough?: Record<string, any>): LogicPackage {
  return {
    format: PACKAGE_FORMAT,
    schemaVersion: LOGIC_SCHEMA_VERSION,
    sourceApp,
    sourceAppVersion: SHARED_VERSION,
    exported: new Date().toISOString(),
    logic: deepClone(doc),
    objectTypes: scene ? objectTypesFromScene(scene) : [],
    instances: scene ? deepClone(scene.instances) : [],
    assets: [],
    passthrough: passthrough ? deepClone(passthrough) : undefined,
  };
}

export interface ImportResult { doc: LogicDocument; pkg: LogicPackage; report: CompatReport; issues: Issue[]; migrations: string[] }

export function importPackage(raw: unknown, target: AppId): ImportResult {
  const pkg = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!pkg || typeof pkg !== 'object') throw new Error('The file is not a logic package');
  let logicRaw: any;
  if ((pkg as any).format === PACKAGE_FORMAT) logicRaw = (pkg as any).logic;
  else if ((pkg as any).format === 'craft.logic') logicRaw = pkg; // bare document
  else throw new Error(`Unrecognized format "${(pkg as any).format}". Expected ${PACKAGE_FORMAT}.`);
  if ((pkg as any).schemaVersion > LOGIC_SCHEMA_VERSION) throw new Error(`Package schema v${(pkg as any).schemaVersion} is newer than supported v${LOGIC_SCHEMA_VERSION}. Update the app.`);
  const { doc, applied } = migrateDocument(logicRaw);
  const full: LogicPackage = (pkg as any).format === PACKAGE_FORMAT ? { ...(pkg as LogicPackage), logic: doc } : exportPackage(doc, null, doc.meta?.createdBy ?? 'logiccraft');
  const types = (full.objectTypes ?? []).map((t) => ({ name: t.name, vars: t.vars.map((v) => v.name), behaviors: t.behaviors.map((b) => b.type) }));
  return {
    doc, pkg: full,
    report: compatibilityReport(doc, target),
    issues: validateDocument(doc, { app: target, types: types.length ? types : undefined }),
    migrations: applied,
  };
}

/** Turn package object types into ObjectTypeDefs (vars only; visuals are rebuilt by each app). */
export function typeDefsFromPackage(pkg: LogicPackage): ObjectTypeDef[] {
  return pkg.objectTypes.map((t) => ({ name: t.name, kind: t.kind as any, vars: deepClone(t.vars) }));
}

/** Stable JSON used to prove lossless round trips (ignores timestamps). */
export function canonicalLogic(doc: LogicDocument): string {
  const c: any = deepClone(doc);
  delete c.meta?.modified;
  return stableStringify(c);
}

export function stableStringify(v: any): string {
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => JSON.stringify(k) + ':' + stableStringify(v[k])).join(',') + '}';
  return JSON.stringify(v);
}
