# Compatibility contract

GameCraft and LogicCraft execute logic with **the same code**: `Shared/src/runtime` (interpreter,
behaviors, physics, pathfinding, particles) and one implementation per block in
`Shared/src/runtime/blockImpl.ts`. Compatibility is therefore a property of the code, and it is enforced by
tests rather than by convention.

## What is guaranteed (portable logic)

For every block whose `apps` list contains both apps (see [BLOCK_REFERENCE.md](BLOCK_REFERENCE.md)):

| Guarantee | How it is enforced |
|---|---|
| Same block IDs, parameter names, types, defaults and units | One definition list (`blocks/definitions.ts`), exported to `block-definitions/blocks.json` |
| Same meaning at runtime | One implementation per block; `unimplementedBlocks()` must be empty (test) |
| Same results for the same inputs | Fixed 60 Hz timestep, seeded mulberry32 RNG, deterministic AABB physics. Conformance tests run the same program in both app modes and compare positions/variables exactly |
| Lossless round trip | `exportPackage` → `importPackage` in both directions; canonical JSON compared (tests run every LogicCraft example through GameCraft and back) |
| Unknown / newer blocks are never lost | Preserved in the document, reported by `compatibilityReport`, skipped (with a console message) at runtime |

## Units and conventions

* Distances in meters (1 unit), time in seconds, angles in degrees, Y up.
* `plane: "xy"` (2D): heading 0° = +X, counter-clockwise. `plane: "xz"` (3D): heading 0° = +X, counter-clockwise seen from above; forward = (cos a, 0, −sin a).
* Opacity 0–100 (Construct convention). Volume in percent.
* `dt` = fixed tick (1/60 s) × time scale.

## Tick order

1. Start triggers on the first tick (`On game start`, `On created` for placed objects, `On start of scene`)
2. Behaviors (movement, physics, pathfinding, timers…) in instance order
3. Physics body contacts, projectile hits
4. Tweens and keyframe clips; particles
5. Collision triggers (`On collision with`, `…exited`, `On trigger entered`)
6. Triggers queued by behaviors (On jump, On arrived, On died…)
7. Input triggers (key pressed/released, clicks, object clicked, UI buttons)
8. `On fixed physics update`
9. The event sheet, top to bottom (triggers raised by actions run immediately, like Construct)
10. Due `Wait` continuations
11. Destroyed objects are removed; per-tick input is cleared

## Where results may legitimately differ

| Area | Note |
|---|---|
| Rendering | GameCraft renders 3D with three.js; LogicCraft draws a 2D canvas. Logic state is identical; pixels are not. |
| App-specific blocks | Post-processing and camera lens blocks are GameCraft-only. In LogicCraft they are kept, shown greyed, and skipped with a message. |
| Plane | A LogicCraft (`xy`) program imported into a GameCraft **3D** scene moves objects on X/Y, not the ground plane. Import into a 2D scene for identical behaviour; the exchange dialog says so. |
| Real-time input | Frame timing of key presses depends on the user; conformance tests use scripted input instead. |
| Audio | Same synthesized sounds in both apps; actual playback timing depends on the browser. |

## Source export guarantees

Generated code (JavaScript, Python, Lua, C#, C++) covers a documented portable subset (see the Export column
in the block reference). Anything outside the subset is reported and commented `UNSUPPORTED` — it is
never silently translated into different behaviour. Tests run the generated JavaScript with Node and compare
its output line-for-line with the shared runtime; Python and Lua are compared the same way when an
interpreter is installed. C# and C++ are generated with typed helpers but were not compiled in the build
environment (no SDK/compiler installed) — see BUILD_STATUS.md.
