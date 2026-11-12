# Shared — the visual logic standard

A library used by GameCraft and LogicCraft. **It is not an application.**

| Folder | Contents |
|---|---|
| `src/schema.ts` | The logic IR (documents, sheets, events, blocks, variables) |
| `src/expr.ts` | Safe Construct-style expression language (no `eval`) |
| `src/blocks/definitions.ts` | The 200-block library (IDs, params, docs, apps, Construct 2 names) |
| `src/runtime/` | Interpreter, behaviors, AABB physics, A* pathfinding, particles, input, world |
| `src/validate.ts` | Validation, migration, compatibility reports |
| `src/interchange.ts` | LogicCraft ⇄ GameCraft packages |
| `src/codegen/` | JavaScript / Python / Lua / C# / C++ exporters |
| `src/extensions.ts` | Declarative extension manifests (validation, self-tests, install) |
| `src/postfx.ts` | Post-processing effect schema and presets (data) |
| `ui/` | React components shared by both apps: event sheet, block canvas, block picker, audio synth |
| `devserver/projectApi.ts` | Local file API plugin for the Vite dev servers |
| `visual-logic-schema/`, `block-definitions/`, `project-format/`, `asset-metadata/`, `documentation/` | Specifications and generated references |
| `exchange/` | Packages sent between the two apps |

```bash
npm install
npm test           # runtime semantics, compatibility, codegen parity
npm run gen:docs   # regenerate block-definitions/*.json and documentation/BLOCK_REFERENCE.md
```
