# Shared visual logic schema (`craft.logic` v1)

The single intermediate representation (IR) used by **both** GameCraft and LogicCraft. The event sheet,
the block canvas, the runtime, the interchange packages and the code generators all read and write this
one structure — there is no second representation to keep in sync.

TypeScript source of truth: [`../src/schema.ts`](../src/schema.ts). JSON Schema for validation by other
tools: [`logic.schema.json`](logic.schema.json).

## Document

```jsonc
{
  "format": "craft.logic",
  "schemaVersion": 1,
  "id": "logic_…",
  "name": "My game",
  "meta": { "createdBy": "logiccraft", "created": "ISO date", "modified": "ISO date" },
  "plane": "xy",                 // movement plane: "xy" (2D, Y up) or "xz" (3D ground plane)
  "globals": [ { "name": "score", "type": "number", "value": 0, "isConstant": false } ],
  "functions": [],               // optional signatures; functions are defined by "On function" events
  "sheets": [ {
    "id": "sheet_…", "name": "Event sheet 1",
    "events": [ /* EventNode[] */ ],
    "layout": { "<eventId>": { "x": 20, "y": 40 } },  // block canvas positions, visual only
    "includes": ["ext:craft.examples.math-helpers"]    // included sheets (extensions, libraries)
  } ],
  "extensions": { }              // app-specific data the other app must preserve untouched
}
```

## Event nodes

| kind | fields | meaning |
|---|---|---|
| `event` | `conditions[]`, `actions[]`, `children[]`, `isElse?`, `isOr?`, `disabled?`, `locals?[]`, `breakpoint?` | Construct-style event: conditions (AND, or OR if `isOr`) then actions, then sub-events |
| `group` | `name`, `active`, `children[]` | Named group that can be (de)activated |
| `comment` | `text` | Comment row / sticky note |

## Block instances

```jsonc
{ "id": "b_…", "block": "movement.set_speed", "target": "Player",
  "params": { "speed": "6" }, "invert": false, "disabled": false, "comment": "" }
```

* `block` — stable block ID from the shared block library ([`../block-definitions/blocks.json`](../block-definitions/blocks.json)).
* `target` — object type for object blocks (Construct "object"); absent for System blocks.
* `params` — expression parameters are stored as **source strings** (`"Player.X + 1"`, `"\"Hello\""`).

## Execution semantics (summary)

See [`../documentation/compatibility.md`](../documentation/compatibility.md) for the full contract. In short:
events run top to bottom every fixed tick (60 Hz); object conditions **pick** instances; actions apply to
picked instances; triggers run out of band; sub-events inherit picking; `Else` runs when the previous
sibling did not; looping conditions repeat the rest of their event; `Wait` resumes later with the same
picks.

## Versioning and migration

* `schemaVersion` increases on breaking changes. `migrateDocument()` in [`../src/validate.ts`](../src/validate.ts)
  upgrades older documents (v0 → v1 is implemented and tested) and rewrites renamed block IDs
  (`BLOCK_ID_ALIASES`).
* Documents with a newer schema are refused with a clear message instead of being half-loaded.
* Unknown blocks, unknown fields and `extensions` data are **preserved** on load and save.
