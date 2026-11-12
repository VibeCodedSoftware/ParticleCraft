// What double-clicking an object opens, always available whatever the panels are doing: a sprite's Sprite sheet editor
// (or its picture choice, for a built-in sprite), a tilemap's tiles and painting tools, and the editor for screen text,
// buttons and bars (the HUD and menus that presets add).
import React, { useEffect, useState } from 'react';
import { store, useStore } from '../project/store';
import { api, assetUrl } from '../project/api';
import { addTilesetFile, curScene, updateSelected } from './actions';
import { PROCEDURAL_SPRITES } from '../engine/sprites';
import { barLook } from '../engine/hud';
import { SpriteSheetDialog } from './SpriteSheetDialog';
import { importSpriteImage } from './Inspector';
import { Modal, Row, Select } from './ui';
import { TilemapPanel } from '@shared/ui/TilemapPanel';
import { TextEditDialog } from '@shared/ui/TextEditDialog';
import { syncTilemapCollider } from '@shared/src/tilemap';
import type { InstanceData } from '@shared/src/runtime/scene';

/** Open the menu for an object (double-click in the viewport, or a panel's button). */
export const OPEN_OBJECT_MENU = 'gc-object-menu';
export const openObjectMenu = (uid: number) => window.dispatchEvent(new CustomEvent(OPEN_OBJECT_MENU, { detail: uid }));
export const hasObjectMenu = (i: InstanceData) => (i.kind === 'sprite' && !!i.sprite) || (i.kind === 'tilemap' && !!i.tilemap);

export function ObjectMenus() {
  const project = useStore((s) => s.project);
  useStore((s) => s.rev);
  const [uid, setUid] = useState<number | null>(null);
  useEffect(() => {
    const open = (e: Event) => { const u = (e as CustomEvent<number>).detail; store.set({ selection: [u] }); setUid(u); };
    window.addEventListener(OPEN_OBJECT_MENU, open);
    return () => window.removeEventListener(OPEN_OBJECT_MENU, open);
  }, []);
  if (!project || uid == null) return null;
  const i = curScene(project).instances.find((x) => x.uid === uid);
  const close = () => setUid(null);
  if (!i) return null;
  const textures = project.assets.filter((a) => a.kind === 'texture');

  if (i.kind === 'tilemap' && i.tilemap) {
    return <Modal title={`Tilemap: ${i.name}`} wide onClose={close}>
      <TilemapPanel inst={i} tilesetUrl={i.tilemap.tileset ? assetUrl(project.id, i.tilemap.tileset) : null} tilesets={textures.map((t) => ({ id: t.id, name: t.name }))}
        onChange={(label, fn, key) => store.mutate(label, (p) => { const x = curScene(p).instances.find((o) => o.uid === i.uid); if (x?.tilemap) { fn(x.tilemap); syncTilemapCollider(x); } }, key && key + i.uid)}
        onImportTileset={(f) => addTilesetFile(project.id, f)} />
    </Modal>;
  }
  if (i.kind === 'sprite' && i.sprite) {
    // A built-in sprite has no sheet to slice: choose or bring in a picture, and the sheet editor follows.
    if (i.sprite.image.startsWith('proc:') || !i.sprite.image) {
      return <Modal title={`Sprite: ${i.name}`} onClose={close}>
        <Row label="Picture"><Select value={i.sprite.image} options={[...PROCEDURAL_SPRITES.map((s) => 'proc:' + s), ...textures.map((t) => t.id)]} labels={Object.fromEntries(textures.map((t) => [t.id, t.name]))} onChange={(v) => updateSelected('Sprite image', (x) => { x.sprite = { ...x.sprite!, image: v }; })} /></Row>
        <Row label="" tip="PNG, JPG, GIF or WebP. A sprite sheet is a strip or grid of equal frames.">
          <label className="btn small">Import image…<input type="file" accept=".png,.jpg,.jpeg,.webp,.gif" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) importSpriteImage(f); }} /></label>
        </Row>
        <p className="hint small">This sprite uses a built-in picture. Choose or import your own to slice it into frames and animations.</p>
      </Modal>;
    }
    return <SpriteSheetDialog url={assetUrl(project.id, i.sprite.image) ?? ''} sprite={i.sprite} onClose={close} onApply={async (r) => {
      close();
      let image = i.sprite!.image;
      if (r.keyedImage) {
        const rel = `imported/files/${(textures.find((t) => t.id === image)?.name ?? 'sprite').replace(/[^A-Za-z0-9_-]/g, '_')}_keyed.png`;
        await api.putFile(project.id, rel, await r.keyedImage.arrayBuffer());
        image = `proj:${rel}`;
        store.mutate('Transparent sprite sheet', (pp) => { if (!pp.assets.some((a) => a.id === image)) pp.assets.push({ id: image, name: rel.split('/').pop()!.replace(/\.png$/, ''), kind: 'texture', source: 'imported' }); });
      }
      updateSelected('Slice sprite sheet', (x) => { x.sprite = { ...x.sprite!, image, frames: r.frames, rows: r.rows, fps: r.fps, animation: r.animation, animations: r.animations }; });
      // Remember the slicing on the image so the next sprite made from it starts sliced.
      store.mutate('Remember slicing', (pp) => { const a = pp.assets.find((x) => x.id === image); if (a) a.meta = { ...(a.meta ?? {}), sheet: { frames: r.frames, rows: r.rows, fps: r.fps, animations: r.animations } } as any; });
    }} />;
  }
  return null;
}

/** Does the logic feed this object a value ("Set bar")? Then it is a bar, whatever it looks like. */
function feedsBar(logic: unknown, type: string): boolean {
  const t = type.toLowerCase();
  const walk = (n: unknown): boolean => {
    if (Array.isArray(n)) return n.some(walk);
    if (!n || typeof n !== 'object') return false;
    const b = n as { block?: string; target?: string };
    if (b.block === 'ui.set_bar' && String(b.target ?? '').toLowerCase() === t) return true;
    return Object.values(n).some(walk);
  };
  return walk(logic);
}

/** The editor for screen text, buttons and bars: what a preset's HUD and menus are made of. */
export function HudEditDialog({ uid, onClose }: { uid: number; onClose: () => void }) {
  const project = useStore((s) => s.project)!;
  useStore((s) => s.rev);
  const i = curScene(project).instances.find((x) => x.uid === uid);
  if (!i?.text) return null;
  return <TextEditDialog text={i.text} postfxOption={i.text.hud}
    fonts={project.assets.filter((a) => a.kind === 'font').map((a) => ({ id: a.id, name: a.name }))} fontUrl={(id) => assetUrl(project.id, id)}
    images={project.assets.filter((a) => a.kind === 'texture').map((a) => ({ id: a.id, name: a.name }))} imageUrl={(id) => assetUrl(project.id, id)}
    onImportImage={(f) => addTilesetFile(project.id, f)}
    barEditor={!!i.text.barStyle || feedsBar(project.logic.sheets, i.type)}
    renderBar={(b, color) => barLook(b, 0.7, color, (id) => assetUrl(project.id, id))}
    onChange={(patch, label, key) => store.mutate(label, (p) => { const x = curScene(p).instances.find((o) => o.uid === uid); if (x?.text) x.text = { ...x.text, ...patch }; }, key && key + uid)}
    onClose={onClose} />;
}
