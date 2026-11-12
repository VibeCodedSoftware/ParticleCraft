# ParticleCraft 2.0 — reference notes and implementation plan

## 1. Reference inspection (2026-11-07)

How each reference was inspected, and what could not be verified.

| Reference | Access | Method |
|---|---|---|
| Video 1 — "Ex-Blizzard Dev Writes A Particle System From Scratch" (Never Engine Studios, 10:16) | Yes | Full English transcript (688 segments) read from YouTube's transcript panel; frames viewed at 7:36, 7:43, 8:22, 8:36 |
| Video 2 — "VFX Texture Creation: The ULTIMATE guide" (Le Lu, 28:46) | Yes | Full transcript (1164 segments) read; frames viewed at 5:45 (online generator), 14:05 (Krita multibrush), 16:50 (G'MIC morphological), 18:32 (Materialize), 22:05 (Pixel Composer nodes) |
| realtimevfx.com — "Increasing flipbook based effects duration" (topic 27592) + "Normalized Age Flipbooks on Multiple Ribbons" (29794) | Yes | All posts read through the forum's JSON API |
| Reference image — flipbook (images.openai.com …UcHGh…) | **No** | Server returned HTTP 500 every time. Not inspected. The realtimevfx thread above was used instead. |
| Reference image — texture-first VFX (images.openai.com …Vutq5…) | Yes | Viewed (1200×675) |

Video audio/visual playback was sampled at the timestamps listed; the rest of each video was followed through its transcript, not watched frame by frame.

### Video 1 observations
- 0:41–1:55 A particle is a position drawn as a camera-facing quad (billboard) built from two triangles. → GPU instanced billboards.
- 2:12–3:58 Structure-of-arrays storage, swap-remove of dead particles. → ParticleCraft's engine already does this (`runtime/particles.ts`); keep it and add new per-particle arrays the same way.
- 4:22–4:40 Size/colour/alpha per particle, stretched billboards make rain. → Stretched (velocity-aligned) renderer.
- 4:47–5:00 Capacity = spawn rate × max lifetime. → Auto capacity suggestion / warning.
- 5:05–5:30 Velocity + generalised "velocity delta" modifiers. → Combinable force blocks.
- 5:34–7:15 Effect → emitters → particles hierarchy; an explosion = fire + debris + smoke emitters; effect transform moves emitters. → Already have systems; add per-system transform/timing.
- 7:17–7:46 **Sequence editor**: one timeline track per emitter with start/length bars, "groups with modifiers that only affect certain layers" over a time range. → New **Timeline** panel: per-system delay/duration bars, scrubbing.
- 8:01–8:13 **Bloom**, and **spawning emitters from particles on tick and on death events**. → Bloom post pass; Sub-emitter (on birth / every N s / on death / on collision) blocks.
- 8:13–8:36 **Scrubbing forward and backward** following particle paths (deterministic). → Timeline scrub that re-simulates deterministically from seed.
- 9:28 Determinism, multithreading/SIMD. → Fixed-seed RNG already; keep sim deterministic for scrubbing.

### Video 2 observations
- 1:00 Texture types: shapes, noise, decals, animated textures, flipbooks. → Procedural shape + noise nodes; flipbook import.
- 2:15–7:56 Don't make every texture yourself; use texture packs and online generators (polar conversion, toon/posterise, tiling, normal map, animated output). → Import-first library; procedural generator nodes with **polar conversion, posterise (toon), tileable, normal-from-height**; bake animated procedural textures to flipbooks.
- 8:44–10:40 Krita brushes: airbrush, smudge for wind/motion, scatter brush. → (External tool; import results.)
- 10:43–11:40 Symmetry tools make hearts/stars in few clicks; 12:33 wrap-around mode for tileable textures. → **Shape node with symmetry/star points**, **Make tileable** node.
- 13:40–14:30 **Multibrush radial symmetry (N-fold)**. → **Radial symmetry / kaleidoscope** texture node.
- 14:52–15:20 **Duplicate layer + Gaussian blur → glow**. → **Glow** texture node (blur+add), Blur node.
- 15:40–17:12 G'MIC deform/"breaking", spiral (continuous droste), **sphere** filter, **morphological (dissolve/erode)** for lava/fire. → **Warp/twirl**, **Spherize**, **Erode/Dilate**, **Dissolve (noise threshold)** nodes.
- 17:30–18:20 Photoshop stroke with gradient; invert + channel-as-selection to isolate parts (decals, blood, bullet holes). → **Luminance to alpha / channel extract**, **Gradient map**, **Levels** nodes.
- 18:21–18:47 **Materialize: height, normal, AO maps from one image**. → **Normal from height** and **Height from luminance** nodes; lit particles use the normal map.
- 18:47–23:10 **Pixel Composer**: node-based sprite generator, colour adjust, shape, blend, particles, dissolve, distort with animated Perlin noise, keyframed parameters, low/high resolution. → ParticleCraft's texture node graph (same idea), animated noise offsets baked into flipbooks, resolution per node, pixel-art output.
- 23:11–24:15 OpenToonz hand-drawn animated effects → import sprite sheets / PNG sequences / GIFs.
- 24:15–25:50 Blender sims baked to sprite sheets are slow → ParticleCraft's own live sim + "Bake to flipbook" export.
- 25:50–26:57 EmberGen real-time volumetric flipbooks → import EmberGen sheets (incl. channel-packed / motion vectors).
- 26:57–28:00 Unreal/Godot noise nodes baked to PNG via render target → "Save to library" from any texture node.

### realtimevfx flipbook thread observations
- Explosions too short at 9×9 @2048. Answers: **extend particle lifetime and blend frames** ("motion blur"), **channel-pack grayscale frames into R/G/B (3× frames)** and colour them with **curves/gradients**, **motion-vector frame blending** with frame skipping, **fill the frame (crop padding)**, R=diffuse G=opacity B=emissive packing.
- Ribbons: drive the whole ribbon's flipbook from the lead particle's normalised age to avoid seams.

### Texture-first reference image
Hybrid scene: textured volumetric smoke, velocity-stretched spark streaks, coloured glowing orbs with bloom, dark smoke trails, glowing expanding ground ring (shockwave) on a grid. → hybrid renderers in one effect, bloom, horizontal ring renderer, trails.

## 2. Existing architecture (inspected)
- `Shared/src/runtime/particles.ts` — CPU SoA emitter shared with GameCraft (three.js points) and LogicCraft (canvas 2D).
- `Shared/src/vfx/vfx.ts` — VFX graph: systems with Spawn/Initialize/Update/Output contexts of stacked blocks (Unity-VFX-Graph style nodes), blackboard parameters wired to block props, shape/object nodes wired to systems, presets, compile to engine layers, asset format `craft.vfx` v1.
- `ParticleCraft/src/VfxEditor.tsx` — pannable node canvas, inspector; `Preview.tsx` canvas-2D preview; `exportFx.ts` PNG/GIF/sheet export; `Simulation.tsx` sim lab.
- Already present (kept, not rebuilt): systems/multi-system effects, rate/burst/duration/capacity, lifetime, point/sphere/box/circle shapes, mesh/shape emission & cling, velocity cone, size/rotation/colour init, gravity/drag/force/turbulence/vortex/floor collision, colour (3-stop)/alpha/size over life, trail, own picture, exposed params, components, presets, PNG/GIF/sheet export, GameCraft/LogicCraft exchange.

## Status (2026-11-09)

All seven phases are implemented and released as public zips (`public\ParticleCraft-2.0.0-phase*-windows-x64.zip`,
final `ParticleCraft-2.0.0-windows-x64.zip`). Verified: shared tests (810), ParticleCraft (11), GameCraft (223),
LogicCraft (25); typechecks of all four apps; in-app checks of each phase (see the session notes).

Not done / limitations:
- GameCraft now draws low-poly mesh particles, glow halos, trails / ribbons (as 1-px lines), horizontal / vertical /
  stretched billboards and volume-lit particles (soft sphere shading; normal / height maps unused); distortion and
  material maps are not drawn. The
  export dialog lists these per layer. LogicCraft tints pictures (8 levels per colour channel).
- The flipbook reference image (images.openai.com …UcHGh…) could not be opened (HTTP 500).
- WebM export records in real time; transparency depends on the player.
- Refraction and height-map lighting were checked by eye (2026-11-09) after fixing both; sprite lighting is now
  camera-relative.

## 3. Plan (phases; a public zip after each)
1. **Engine + nodes**: new emitter shapes (cone, ring, line/path, hemisphere, image/texture spawn), burst cycles, spawn delay, rate-over-time curve; force stack (attract/repel, orbit, curl noise, wind+gusts, random walk, follow target, path follow, directional, air resistance, speed limit); collision planes/sphere with friction & kill; kill volumes; curves & gradients over life (size, opacity, colour, rotation, speed, glow); random colour/size/rotation; sub-emitters on birth/death/collision/tick; prewarm; per-system delay/transform. Searchable categorised block menu.
2. **Textures**: persistent texture library (folders, search, favourites, rename, replace keeps links); import PNG/JPG/WebP/GIF (frames → sheet), sprite sheets with grid detection; Texture nodes on the canvas wired into systems.
3. **Flipbooks**: Flipbook block with lifetime stretch / fps / cycles, hold last frame, hold frames, loop range with intro/outro, ping-pong/reverse, random start/speed, delay, frame blending, motion-vector blending, channel-packed (RGB) sheets, progression curve.
4. **Hybrid rendering**: WebGL2 renderer — billboard, stretched, horizontal, vertical, point, mesh (low-poly), ribbon/trail, volumetric-lit; styles (smooth, pixel, low-poly, cartoon, realistic…); premultiplied blending so additive + alpha particles of different systems sort together; soft particles; glow; distortion; bloom.
5. **Procedural textures & materials**: texture node graph (noise/fbm/perlin/voronoi/cells/gradients/shape/polar/radial symmetry/twirl/spherize/erode/dissolve/blur/glow/levels/gradient map/normal from height/tileable…), material block (base colour, emission, alpha map, normal, fresnel-ish rim, dissolve, distortion).
6. **Composition**: timeline (per-system delay/duration, scrubbing), components with versioned references, effect templates import/export with embedded assets, reusable node groups.
7. **Export & ecosystem**: animated WebP, WebM video, sprite-sheet + JSON for SpriteCraft, GameCraft/LogicCraft renderers learn flipbooks & new blend modes, WorldCraft/LogicCraft triggers & parameters.
