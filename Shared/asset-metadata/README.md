# Asset metadata

GameCraft stores asset references in the project (`assets[]`, type `AssetRef` in
`GameCraft/src/project/types.ts`):

```jsonc
{
  "id": "proj:imported/hero/hero.glb",      // or lib:<library>/<path>, prim:<kind>, proc:<sprite>
  "name": "hero",
  "kind": "model",                          // model | texture | audio | font
  "source": "imported",                     // starter | library | imported | generated
  "extra": ["proj:imported/hero/hero.mtl"], // companion files (OBJ materials)
  "importSettings": { "scale": 1, "center": true, "ground": true, "upAxis": "y", "rotY": 0,
                      "collision": "box", "materials": "keep", "animations": true },
  "meta": { "vertices": 1234, "meshes": 2, "materials": ["Skin"], "animations": ["Walk"],
            "size": [0.5, 1.8, 0.4], "sourceFile": "hero.glb", "importedAt": "…", "sourceModified": 0 }
}
```

* **Ids are stable.** Reimporting keeps the id, so every object that uses the asset updates and scene edits
  stay intact. "Replace uses…" retargets references to another asset.
* **Library roots** (read-only, served by the dev server): `lib:models/…` → `GameCraft/Assets` (your supplied
  OBJ models), `lib:library/…` → `GameCraft/asset-library` (Backrooms textures and icons, Dungeon Bound font).
* **Imported files** are copied into `GameCraft/projects/<id>/assets/imported/…`; the source file is not
  modified.
* **Thumbnails** are rendered offscreen and cached in memory and `localStorage` keyed by URL + modification time.
