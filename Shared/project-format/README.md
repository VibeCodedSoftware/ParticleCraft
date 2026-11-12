# Project and package formats

All formats are versioned JSON. Loading validates `format` and `schemaVersion`, migrates older versions, and
refuses newer ones with a readable message. Unknown fields are kept.

| Format | Used by | Contents | Where |
|---|---|---|---|
| `craft.logic` v1 | both | Visual logic document (see `visual-logic-schema/`) | inside projects and packages |
| `craft.logic.package` v1 | both | `logic` + portable `objectTypes` + `instances` + `assets` + `passthrough` | `Shared/exchange/*.json`, downloads |
| `gamecraft.project` v1 | GameCraft | `scenes[]` (SceneData), `logic`, `assets[]` (AssetRef), `prefabs[]`, `particlePresets`, `postfxPresets`, `settings`, `tutorial`, `favorites`, `recent` | `GameCraft/projects/<id>/project.json` |
| `logiccraft.project` v1 | LogicCraft | `logic`, `stage` (SceneData, 2D), `settings`, `extensions[]`, `example` | `LogicCraft/projects/<id>/project.json` |
| `craft.extension` v1 | LogicCraft (+ GameCraft via packages) | id, name, version, permissions (none allowed), compatibility, `functions[]` (events), `tests[]` | `LogicCraft/extensions/*.json` |

## SceneData (shared by GameCraft scenes and LogicCraft stages)

Defined in `Shared/src/runtime/scene.ts`: `mode` (2d/3d), `plane`, `objectTypes[]` (name, kind, instance
variables, optional spawn `template`), `instances[]` (transform, kind-specific data: mesh, sprite, text,
Blender-style `light`, Blender-style `camera` with its post-processing stack, emitter, material, collider,
behaviors, variables, tags, parent), `settings` (gravity, background, fixed timestep, seed, world/color
management), `animations[]` (keyframe clips) and `sheetId`.

## Saving, autosave and recovery

* Save writes `project.json` atomically (temp file + rename) and keeps `project.backup.json`.
* Autosave writes `autosave.json` every 20 s while there are unsaved changes; the launcher offers recovery
  when the autosave is newer than the last save.
* Deleting a project moves it to `projects/.trash/` (never a hard delete).

## Interchange rules

* Exporting never drops data: unsupported or unknown blocks travel unchanged.
* Importing reports: supported block count, blocks only the other app can run, unknown blocks, migrations
  applied and validation errors — before you confirm.
* Placeholder objects are created for object types the logic needs but the destination lacks.
