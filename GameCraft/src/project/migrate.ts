// Validate and migrate saved projects. Unknown fields are kept; nothing is silently dropped.
import { migrateDocument } from '@shared/src/validate';
import { migrateMatteWater, migrateWaterLook } from '@shared/src/runtime/water';
import { PROJECT_FORMAT, PROJECT_SCHEMA_VERSION, type GameProject } from './types';

export class ProjectError extends Error {}

export function migrateProject(raw: any): GameProject {
  if (!raw || typeof raw !== 'object') throw new ProjectError('Project file is not valid JSON.');
  if (raw.format !== PROJECT_FORMAT) throw new ProjectError(`Not a GameCraft project (format "${raw.format}").`);
  if (raw.schemaVersion > PROJECT_SCHEMA_VERSION) throw new ProjectError(`This project was saved by a newer GameCraft (schema v${raw.schemaVersion}).`);
  const p = raw as GameProject;
  if (!Array.isArray(p.scenes) || !p.scenes.length) throw new ProjectError('Project has no scenes.');
  p.logic = migrateDocument(p.logic).doc;
  p.assets ??= []; p.prefabs ??= []; p.particlePresets ??= {}; p.postfxPresets ??= {};
  p.favorites ??= []; p.recent ??= [];
  p.settings = Object.assign({ quality: 1, volume: 0.8, showFps: false }, p.settings);
  p.startSceneId ??= p.scenes[0].id;
  for (const s of p.scenes) {
    s.instances ??= []; s.objectTypes ??= []; s.animations ??= [];
    for (const i of s.instances) { i.tags ??= []; i.vars ??= {}; i.behaviors ??= []; migrateWaterLook(i); migrateMatteWater(i); }
    // Older templates could place several objects with the same uid; give each its own (children keep their parent).
    const seen = new Set<number>();
    let next = Math.max(0, ...s.instances.map((i) => i.uid)) + 1;
    for (const i of s.instances) { if (seen.has(i.uid)) i.uid = next++; seen.add(i.uid); }
  }
  // Arms Shooter projects made before blood existed: their enemies bleed too.
  if (p.template === 'fps') bloodOnHitscans(p.logic.sheets);
  p.schemaVersion = PROJECT_SCHEMA_VERSION;
  return p;
}

function bloodOnHitscans(node: unknown) {
  if (Array.isArray(node)) { node.forEach(bloodOnHitscans); return; }
  if (!node || typeof node !== 'object') return;
  const b = node as { block?: string; params?: Record<string, unknown> };
  if (b.block === 'combat.hitscan' && b.params && b.params.blood === undefined) b.params.blood = 'hit and kill';
  Object.values(node).forEach(bloodOnHitscans);
}
