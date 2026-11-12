// Properties panel. Everything on the selected object is editable; edits apply to every selected object.
import { TextureSlots } from './TextureSlots';
import { hasWaterImage, isStylisedWater, isWaterSurface, stylisedWaterSlot, WATER_LOOK, WATER_FX } from '@shared/src/runtime/water';
import { materialSlots, replaceSlotImage } from '@shared/src/materialMaps';
import type { AssetRef } from '../project/types';
import { TextSetterNote } from '@shared/ui/TextSetterNote';
import { NormalMapNote } from '@shared/ui/NormalMapNote';
import { CAMERA_PRESETS, type CameraPresetId } from '@shared/src/cameraPresets';
import { applyCameraView } from '@shared/src/cameraView';
import React, { useRef } from 'react';
import { Icon } from '@shared/ui/icons';
import { BEHAVIORS, behaviorDefaults, type PropDef } from '@shared/src/runtime/behaviors';
import { PARTICLE_PRESETS } from '@shared/src/runtime/particles';
import { soundNames } from '@shared/src/sounds';
import { COLLISION_LAYERS, DEFAULT_CAMERA, DEFAULT_LIGHT, makeInstance, nextUid, type InstanceData } from '@shared/src/runtime/scene';
import type { BooleanOpKind } from '@shared/src/runtime/boolean';
import { generateMeshCollider } from '@shared/src/runtime/meshCollider';
import { SYSTEM_FONTS, TEXT_STYLE_PRESETS, type TextStyle } from '@shared/src/runtime/textStyle';
import { OBJECT_FX, OBJECT_FX_TYPES, fxNum, fxParam, makeObjectFx, type ObjectFx, type ObjectFxType } from '@shared/src/objectFx';
import { BLOCK_DEFS } from '@shared/src/blocks/definitions';
import { walkEvents } from '@shared/src/schema';
import { store, useStore } from '../project/store';
import { api, assetUrl } from '../project/api';
import { HudEditDialog, openObjectMenu } from './ObjectMenus';
import { importAnimation } from './spriteImport';
import { hasModelPanel, openModelPanel } from './ModelPanel';
import { PROCEDURAL_SPRITES } from '../engine/sprites';
import { fovFromFocal } from '../engine/blenderStyle';
import { addBehavior, addTilesetFile, curScene, makePrefab, setParent, updateSelected } from './actions';
import { TilemapPanel } from '@shared/ui/TilemapPanel';
import { syncTilemapCollider } from '@shared/src/tilemap';
import { Check, Color, Num, Row, Section, Select, Slider, Text, Vec3 } from './ui';
import { editorRefs } from './session';
import { procAnimGroup, procChainText } from './procBlocks';
import { CHAIN_ROLES, parseBoneMap, type ChainRole } from '../engine/procAnim';
import * as THREE from 'three';

export function Inspector() {
  const project = useStore((s) => s.project);
  const selection = useStore((s) => s.selection);
  const [textEdit, setTextEdit] = React.useState(false);
  useStore((s) => s.rev);
  if (!project) return null;
  const scene = curScene(project);
  const sel = scene.instances.filter((i) => selection.includes(i.uid));
  const i = sel[sel.length - 1];
  if (!i) return <div className="insp-empty">Select an object in the viewport or Outliner.<br /><br /><b>Shift+A</b> adds objects. Drag models from the Asset browser.</div>;
  const up = (label: string, fn: (x: InstanceData) => void, key?: string) => updateSelected(label, fn, key ? key + ':' + selection.join(',') : undefined);
  const assets = project.assets.filter((a) => a.kind === 'model');
  const textures = project.assets.filter((a) => a.kind === 'texture');
  const fonts = project.assets.filter((a) => a.kind === 'font');

  return (
    <div className="inspector">
      <div className="insp-title">
        <span className="insp-kind">{i.kind}</span>
        <input className="txt" value={i.name} onChange={(e) => up('Rename', (x) => { x.name = e.target.value; }, 'name')} onKeyDown={(e) => e.stopPropagation()} />
        {sel.length > 1 && <span className="insp-multi">+{sel.length - 1} more</span>}
      </div>
      <Section title="Object">
        <Row label="Object type" tip="Logic refers to object types (like Construct). Instances of the same type share events.">
          <Text value={i.type} onChange={(v) => renameType(i.type, v)} />
        </Row>
        <Row label="Visible"><Check value={i.visible} onChange={(v) => up('Visible', (x) => { x.visible = v; })} /></Row>
        <Row label="Takes marks" tip="Bullet holes and blood can land on this object"><Check value={!i.noMarks} onChange={(v) => up('Takes marks', (x) => { if (v) delete x.noMarks; else x.noMarks = true; })} /></Row>
        {(i.kind === 'box' || i.kind === 'plane') && <Row label="Mirror (planar)" tip="Its top reflects the scene exactly, for floors and mirrors lying flat. The scene is drawn again for each one, so use a few"><Check value={!!i.mirror} onChange={(v) => up('Mirror', (x) => { if (v) x.mirror = { strength: 0.6, resolution: 1024 }; else delete x.mirror; })} /></Row>}
        {i.mirror && <>
          <Row label="Mirror strength"><Slider value={i.mirror.strength} min={0} max={1} step={0.05} onChange={(v) => up('Mirror', (x) => { x.mirror = { ...x.mirror!, strength: v }; }, 'mirs')} /></Row>
          <Row label="Mirror resolution" tip="Higher is sharper and slower"><Select value={String(i.mirror.resolution)} options={['256', '512', '1024', '2048']} onChange={(v) => up('Mirror', (x) => { x.mirror = { ...x.mirror!, resolution: Number(v) }; })} /></Row>
        </>}
        {i.reflectionProbe && <>
          <Row label="Probe reach (m)" tip="Objects within this distance reflect this probe's picture. Where two probes of the same resolution overlap, the reflection blends between them"><Num value={i.reflectionProbe.radius} step={0.5} min={0.1} onChange={(v) => up('Reflection probe', (x) => { x.reflectionProbe = { ...x.reflectionProbe!, radius: v }; }, 'rpr')} /></Row>
          <Row label="Probe resolution" tip="Higher is sharper and takes longer to capture"><Select value={String(i.reflectionProbe.resolution)} options={['64', '128', '256', '512']} onChange={(v) => up('Reflection probe', (x) => { x.reflectionProbe = { ...x.reflectionProbe!, resolution: Number(v) }; })} /></Row>
          <Row label="Probe strength"><Slider value={i.reflectionProbe.strength} min={0} max={3} step={0.05} onChange={(v) => up('Reflection probe', (x) => { x.reflectionProbe = { ...x.reflectionProbe!, strength: v }; }, 'rps')} /></Row>
          <Row label="Capture every (s)" tip="While playing. 0 = once. Sooner shows moving things, at a cost"><Num value={i.reflectionProbe.every} step={0.5} min={0} onChange={(v) => up('Reflection probe', (x) => { x.reflectionProbe = { ...x.reflectionProbe!, every: v }; }, 'rpe')} /></Row>
        </>}
        <Row label="Tags" tip="Comma separated. Used by Has tag, Show/Hide menu and weapons."><Text value={i.tags.join(', ')} onChange={(v) => up('Tags', (x) => { x.tags = v.split(',').map((t) => t.trim()).filter(Boolean); }, 'tags')} /></Row>
        {scene.mode === '2d' && <Row label="Layer (Z order)"><Num value={i.layer} step={1} precision={0} onChange={(v) => up('Layer', (x) => { x.layer = v; x.z = v * 0.01 + (x.z % 0.01); }, 'layer')} /></Row>}
      </Section>
      <Section title="Transform">
        {i.parent != null && i.parentBone && <Row label="On bone" tip="Hung on this bone (Bone view): its location and rotation here are offsets from the bone"><span className="dim">{i.parentBone}</span> <button className="tbtn" title="Take it off the bone, keeping where it is" onClick={() => setParent([i.uid], null)}>Detach</button></Row>}
        <Row label="Location"><Vec3 v={[i.x, i.y, i.z]} onChange={([x, y, z]) => up('Move', (o) => { o.x = x; o.y = y; o.z = z; }, 'loc')} /></Row>
        <Row label="Rotation °"><Vec3 v={[i.rx, i.ry, i.rz]} step={1} onChange={([x, y, z]) => up('Rotate', (o) => { o.rx = x; o.ry = y; o.rz = z; }, 'rot')} /></Row>
        <Row label="Scale"><Vec3 v={[i.sx, i.sy, i.sz]} step={0.05} onChange={([x, y, z]) => up('Scale', (o) => { o.sx = x; o.sy = y; o.sz = z; }, 'scale')} /></Row>
        <Row label="Dimensions"><span className="dim">{fmt(i.collider.size[0] * i.sx)} × {fmt(i.collider.size[1] * i.sy)} × {fmt(i.collider.size[2] * i.sz)} m</span></Row>
      </Section>

      {i.kind === 'mesh' && i.mesh && (
        <Section title="Model">
          <Row label="Model"><Select value={i.mesh.asset} options={assets.map((a) => a.id)} labels={Object.fromEntries(assets.map((a) => [a.id, a.name]))} onChange={(v) => up('Change model', (x) => { x.mesh = { ...x.mesh!, asset: v }; })} /></Row>
          <Row label="Model yaw offset" tip="Rotate the model so its front faces the object's forward direction (+X)."><Num value={i.mesh.rotY} step={15} onChange={(v) => up('Model yaw', (x) => { x.mesh = { ...x.mesh!, rotY: v }; }, 'myaw')} /></Row>
          <Row label="Tint with color"><Check value={!!i.mesh.tint} onChange={(v) => up('Tint', (x) => { x.mesh = { ...x.mesh!, tint: v }; })} /></Row>
          {i.mesh.tint && <Row label="Color"><Color value={i.color} onChange={(v) => up('Color', (x) => { x.color = v; }, 'color')} /></Row>}
          <Row label=""><span className="btn-row"><button className="btn small" onClick={() => fitCollider(i.uid)}>Fit collider to model</button>
            <button className="btn small" title="Preview clips, see the rig and assign animation roles (or double-click the model)" onClick={() => openModelPanel(i.uid)}>Model & animations…</button></span></Row>
          {i.mesh.animMap && Object.keys(i.mesh.animMap).length > 0 && <Row label="Roles"><span className="dim">{Object.entries(i.mesh.animMap).map(([k, v]) => `${k} → ${v}`).join(' · ')}</span></Row>}
        </Section>
      )}
      {isWaterSurface(i) && !i.behaviors.some((b) => b.type === 'water') && <Section title="Water"><WaterControls i={i} up={up} textures={textures} /></Section>}
      {i.kind !== 'mesh' && hasModelPanel(i) && i.kind !== 'light' && i.kind !== 'camera' && (
        <Section title="Animation">
          <Row label="" tip="Preview and choose the clips this object plays for idle, walk, jump, hit, death... (or double-click it in the viewport)"><button className="btn small" onClick={() => openModelPanel(i.uid)}>Model & animations…</button></Row>
          {i.animRoles && Object.keys(i.animRoles).length > 0 && <Row label="Roles"><span className="dim">{Object.entries(i.animRoles).map(([k, v]) => `${k} → ${v}`).join(' · ')}</span></Row>}
        </Section>
      )}
      {scene.mode !== '2d' && (PRIM_KINDS.has(i.kind) || i.kind === 'mesh') && (
        <Section title="Boolean">
          <Row label="" tip="Like Blender's Boolean modifier: cut this mesh with another object (Difference: a door or window in a wall), join them (Union) or keep only the overlap (Intersect). Applied in order. Cutters are wireframes while editing and hidden, pass-through objects while playing. Box walls get collision around box-shaped cuts, so a doorway can be walked through">
            <span className="dim">{i.boolean?.ops.length ? `${i.boolean.ops.length} operation${i.boolean.ops.length > 1 ? 's' : ''}` : 'Cut, join or intersect with other objects'}</span>
          </Row>
          {(i.boolean?.ops ?? []).map((op, k) => (
            <Row key={k} label={`#${k + 1}`}>
              <span className="btn-row">
                <select className="sel" value={op.op} onChange={(e) => up('Boolean', (x) => { x.boolean!.ops[k] = { ...x.boolean!.ops[k], op: e.target.value as BooleanOpKind }; })}>
                  <option value="difference">Difference (cut)</option><option value="union">Union (join)</option><option value="intersect">Intersect (overlap)</option>
                </select>
                <select className="sel" value={op.with} onChange={(e) => up('Boolean', (x) => { x.boolean!.ops[k] = { ...x.boolean!.ops[k], with: Number(e.target.value) }; })}>
                  {scene.instances.filter((o) => o.uid !== i.uid && (PRIM_KINDS.has(o.kind) || o.kind === 'mesh')).map((o) => <option key={o.uid} value={o.uid}>{o.name}</option>)}
                </select>
                <button className="btn small" title="Remove" onClick={() => up('Boolean', (x) => { x.boolean!.ops.splice(k, 1); if (!x.boolean!.ops.length) delete x.boolean; })}>✕</button>
              </span>
            </Row>
          ))}
          <Row label="">
            <span className="btn-row">
              <button className="btn small" title="Cut with another object in the scene" disabled={scene.instances.length < 2} onClick={() => {
                const other = scene.instances.find((o) => o.uid !== i.uid && (PRIM_KINDS.has(o.kind) || o.kind === 'mesh') && !i.boolean?.ops.some((x) => x.with === o.uid));
                if (other) up('Add Boolean', (x) => { (x.boolean ??= { ops: [] }).ops.push({ with: other.uid, op: 'difference' }); });
              }}>+ Operation</button>
              <button className="btn small" title="A box cutter at this object (move and size it to make a door or window), cutting it" onClick={() => store.mutate('Add cutter box', (p) => {
                const s = curScene(p), x = s.instances.find((o) => o.uid === i.uid); if (!x) return;
                const uid = nextUid(s);
                s.instances.push(makeInstance(uid, 'Cutter', 'box', { name: `${x.name} cutter`, x: x.x, y: x.y, z: x.z, ry: x.ry, sx: Math.max(0.2, Math.abs(x.sx) * 0.4), sy: Math.max(0.2, Math.abs(x.sy) * 0.7), sz: Math.abs(x.sz) * 1.5 + 0.1, color: '#ff5a5a', collider: { shape: 'box', size: [1, 1, 1], offset: [0, 0, 0] } }));
                (x.boolean ??= { ops: [] }).ops.push({ with: uid, op: 'difference' });
              })}>+ Cutter box</button>
            </span>
          </Row>
          {!!i.boolean?.ops.length && <Row label="Hide cutters in play" tip="Off: the cutters stay visible and solid while playing"><Check value={i.boolean.hideCutters !== false} onChange={(v) => up('Boolean', (x) => { x.boolean!.hideCutters = v; })} /></Row>}
        </Section>
      )}
      {i.kind === 'tilemap' && i.tilemap && project && (
        <Section title="Tilemap">
          <TilemapPanel inst={i} tilesetUrl={i.tilemap.tileset ? assetUrl(project.id, i.tilemap.tileset) : null} tilesets={textures.map((t) => ({ id: t.id, name: t.name }))}
            onChange={(label, fn, key) => store.mutate(label, (p) => { const x = curScene(p).instances.find((o) => o.uid === i.uid); if (x?.tilemap) { fn(x.tilemap); syncTilemapCollider(x); } }, key && key + i.uid)}
            onImportTileset={(f) => addTilesetFile(project.id, f)} />
        </Section>
      )}
      {i.kind === 'sprite' && i.sprite && (
        <Section title="Sprite">
          <Row label="Image"><Select value={i.sprite.image} options={[...PROCEDURAL_SPRITES.map((s) => 'proc:' + s), ...textures.map((t) => t.id)]} labels={Object.fromEntries(textures.map((t) => [t.id, t.name]))} onChange={(v) => up('Sprite image', (x) => { x.sprite = { ...x.sprite!, image: v }; })} /></Row>
          <Row label="" tip="PNG, JPG, GIF or WebP. A sprite sheet is a strip or grid of equal frames.">
            <span className="btn-row">
              <label className="btn small">Import image…<input type="file" accept=".png,.jpg,.jpeg,.webp,.gif" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) importSpriteImage(f); }} /></label>
              <label className="btn small" title="Several GIFs (walk.gif, idle.gif…) or numbered pictures (walk_01.png, walk_02.png…): each becomes a named animation in one sprite sheet">Import animation…<input type="file" multiple accept=".gif,.png,.jpg,.jpeg,.webp" hidden onChange={(e) => { const fs = [...(e.target.files ?? [])]; e.target.value = ''; if (fs.length) importAnimationFiles(fs); }} /></label>
              {!i.sprite.image.startsWith('proc:') && <button className="btn small" title="Or double-click the sprite in the viewport" onClick={() => openObjectMenu(i.uid)}>Edit sprite sheet…</button>}
            </span>
          </Row>
          <Row label="Frames" tip="Frames in the image (1 = a single picture)"><Num value={i.sprite.frames} step={1} min={1} precision={0} onChange={(v) => up('Frames', (x) => { x.sprite = { ...x.sprite!, frames: v }; })} /></Row>
          <Row label="Rows" tip="1 for a strip; more for a grid sheet (read left to right, top to bottom)"><Num value={i.sprite.rows ?? 1} step={1} min={1} precision={0} onChange={(v) => up('Rows', (x) => { x.sprite = { ...x.sprite!, rows: v }; })} /></Row>
          <Row label="Default animation"><Select value={i.sprite.animation} options={['', ...new Set([i.sprite.animation, ...Object.keys(i.sprite.animations ?? {})].filter(Boolean))]} labels={{ '': 'All frames' }} onChange={(v) => up('Animation', (x) => { x.sprite = { ...x.sprite!, animation: v }; })} /></Row>
          {Object.keys(i.sprite.animations ?? {}).length > 0 && <Row label="Animations"><span className="dim">{Object.entries(i.sprite.animations!).map(([n, a]) => `${n} ${a.from}–${a.to}`).join(' · ')}</span></Row>}
          <Row label="FPS"><Num value={i.sprite.fps} step={1} min={1} precision={0} onChange={(v) => up('FPS', (x) => { x.sprite = { ...x.sprite!, fps: v }; })} /></Row>
          <Row label="Normal map" tip="With 2D lighting on (Post-FX & World): a picture with the same frames whose colours are surface directions"><Select value={i.sprite.normalMap ?? ''} options={['', ...textures.map((t) => t.id)]} labels={{ '': 'None (flat)', ...Object.fromEntries(textures.map((t) => [t.id, t.name])) }} onChange={(v) => up('Normal map', (x) => { x.sprite = { ...x.sprite!, normalMap: v || undefined }; })} /></Row>
          {i.sprite.normalMap && <>
            <NormalMapNote url={assetUrl(project.id, i.sprite.normalMap)} format={i.sprite.normalFormat ?? 'opengl'} lightingOn={scene.mode === '2d' ? !!scene.settings.lighting2d?.enabled : !!i.sprite.lit}
              onFormat={(f) => up('Normal format', (x) => { x.sprite = { ...x.sprite!, normalFormat: f }; })}
              onLightingOn={scene.mode === '2d'
                ? () => store.mutate('2D lighting', (p) => { const s = curScene(p); s.settings.lighting2d = { ...(s.settings.lighting2d ?? { ambient: '#3a4466', ambientStrength: 0.35 }), enabled: true }; })
                : () => up('Sprite lit', (x) => { x.sprite = { ...x.sprite!, lit: true }; })} />
            <Row label="Normal format" tip="Which way green points: OpenGL (Blender, Unity, Godot) or DirectX (Unreal, Substance's default). Wrong = lit from below"><Select value={i.sprite.normalFormat ?? 'opengl'} options={['opengl', 'directx']} labels={{ opengl: 'OpenGL (green up)', directx: 'DirectX (green down)' }} onChange={(v) => up('Normal format', (x) => { x.sprite = { ...x.sprite!, normalFormat: v as 'opengl' | 'directx' }; })} /></Row>
            <Row label="Normal strength" tip="How strongly the map bends the light (1 = as painted)"><Slider value={i.sprite.normalStrength ?? 1} min={0} max={3} step={0.05} onChange={(v) => up('Normal strength', (x) => { x.sprite = { ...x.sprite!, normalStrength: v }; }, 'nstr')} /></Row>
            <Row label="Shine" tip="0 = matte, 1 = glossy. Highlights from lights show the normal map even on dark pictures (glass, metal, wet skin)"><Slider value={i.sprite.shine ?? 0} min={0} max={1} step={0.01} onChange={(v) => up('Shine', (x) => { x.sprite = { ...x.sprite!, shine: v }; }, 'shine')} /></Row>
          </>}
          {scene.mode !== '2d' && <>
            <Row label="Lit by lights" tip="On: the scene's lights and shadows shade the picture (and its normal map). Off: the picture's own colours, always fully bright (UI-like, glowing signs)."><Check value={!!i.sprite.lit} onChange={(v) => up('Sprite lit', (x) => { x.sprite = { ...x.sprite!, lit: v }; })} /></Row>
            <Row label="Cast shadows" tip="A shadow in the picture's shape (see-through parts cast none)"><Check value={!!i.sprite.castShadow} onChange={(v) => up('Sprite shadows', (x) => { x.sprite = { ...x.sprite!, castShadow: v }; })} /></Row>
            <Row label="Receive shadows" tip="Shadows from other objects fall on it (best with Lit by lights)"><Check value={!!i.sprite.receiveShadow} onChange={(v) => up('Sprite shadows', (x) => { x.sprite = { ...x.sprite!, receiveShadow: v }; })} /></Row>
          </>}
          <Row label="Flip X"><Check value={!!i.sprite.flipX} onChange={(v) => up('Flip', (x) => { x.sprite = { ...x.sprite!, flipX: v }; })} /></Row>
          <Row label="Pixel-perfect" tip="Nearest-neighbor filtering"><Check value={i.sprite.pixelArt !== false} onChange={(v) => up('Pixel art', (x) => { x.sprite = { ...x.sprite!, pixelArt: v }; })} /></Row>
          <Row label="Face camera" tip="Turns to the active camera (grass cards, trees, signs). Off: keeps its own rotation"><Check value={!!i.sprite.billboard} onChange={(v) => up('Face camera', (x) => { x.sprite = { ...x.sprite!, billboard: v }; })} /></Row>
          {i.sprite.billboard && <Row label="Billboard mode" tip="Vertical: turns round the upright only and stays planted, best for grass. Spherical: tilts up and down with the camera too"><Select value={i.sprite.billboardMode ?? 'spherical'} options={['vertical', 'spherical']} labels={{ vertical: 'Vertical', spherical: 'Spherical' }} onChange={(v) => up('Billboard mode', (x) => { x.sprite = { ...x.sprite!, billboardMode: v as 'vertical' | 'spherical' }; })} /></Row>}
          <Row label="Tint"><Color value={i.color} onChange={(v) => up('Color', (x) => { x.color = v; }, 'color')} /></Row>
        </Section>
      )}
      {i.kind === 'text' && i.text && (
        <Section title="Text">
          <Row label="Text"><Text value={i.text.text} onChange={(v) => up('Text', (x) => { x.text = { ...x.text!, text: v }; }, 'text')} /></Row>
          <TextSetterNote logic={store.get().project?.logic} type={i.type} />
          <Row label="Size"><Num value={i.text.size} step={1} min={4} precision={0} onChange={(v) => up('Text size', (x) => { x.text = { ...x.text!, size: v }; }, 'tsize')} /></Row>
          <Row label="Color"><Color value={i.text.color} onChange={(v) => up('Text color', (x) => { x.text = { ...x.text!, color: v }; }, 'tcol')} /></Row>
          <Row label="Screen anchor"><Select value={i.text.anchor} options={['tl', 'tc', 'tr', 'cl', 'cc', 'cr', 'bl', 'bc', 'br']} labels={{ tl: 'Top left', tc: 'Top center', tr: 'Top right', cl: 'Center left', cc: 'Center', cr: 'Center right', bl: 'Bottom left', bc: 'Bottom center', br: 'Bottom right' }} onChange={(v) => up('Anchor', (x) => { x.text = { ...x.text!, anchor: v as any }; })} /></Row>
          <Row label="Offset X / Y (px)" tip="Use Location X/Y to offset from the anchor"><span className="dim">{i.x}, {i.y}</span></Row>
          <Row label="HUD (screen space)"><Check value={i.text.hud} onChange={(v) => up('HUD', (x) => { x.text = { ...x.text!, hud: v }; })} /></Row>
          <Row label="Button" tip="Clickable; triggers UI › On button clicked with the object name"><Check value={!!i.text.button} onChange={(v) => up('Button', (x) => { x.text = { ...x.text!, button: v }; })} /></Row>
          <Row label="Alignment"><Select value={i.text.align} options={['left', 'center', 'right']} labels={{ left: 'Left', center: 'Center', right: 'Right' }} onChange={(v) => up('Alignment', (x) => { x.text = { ...x.text!, align: v as any }; })} /></Row>
          <Row label="Font" tip="Fonts on every computer, or a .ttf/.otf you imported">
            <Select value={i.text.font ? 'file:' + i.text.font : i.text.style?.fontFamily ? 'sys:' + i.text.style.fontFamily : ''}
              options={['', ...Object.keys(SYSTEM_FONTS).map((f) => 'sys:' + f), ...fonts.map((f) => 'file:' + f.id)]}
              labels={{ '': 'Default', ...Object.fromEntries(Object.keys(SYSTEM_FONTS).map((f) => ['sys:' + f, f])), ...Object.fromEntries(fonts.map((f) => ['file:' + f.id, f.name + ' (imported)'])) }}
              onChange={(v) => up('Font', (x) => { const st = { ...(x.text!.style ?? {}) }; if (v.startsWith('file:')) { st.fontFamily = undefined; x.text = { ...x.text!, font: v.slice(5), style: st }; } else { st.fontFamily = v ? v.slice(4) : undefined; x.text = { ...x.text!, font: undefined, style: st }; } })} />
          </Row>
          <Row label="Weight"><Select value={String(i.text.style?.weight ?? (i.text.style?.bold ? 700 : 400))} options={['300', '400', '500', '600', '700', '900']} labels={{ 300: 'Light', 400: 'Regular', 500: 'Medium', 600: 'Semibold', 700: 'Bold', 900: 'Black' }} onChange={(v) => up('Font weight', (x) => { x.text = { ...x.text!, style: { ...(x.text!.style ?? {}), weight: Number(v), bold: Number(v) >= 600 } }; })} /></Row>
          <Row label="Italic / underline"><span className="pair"><Check value={!!i.text.style?.italic} onChange={(v) => up('Italic', (x) => { x.text = { ...x.text!, style: { ...(x.text!.style ?? {}), italic: v } }; })} /><Check value={!!i.text.style?.underline} onChange={(v) => up('Underline', (x) => { x.text = { ...x.text!, style: { ...(x.text!.style ?? {}), underline: v } }; })} /></span></Row>
          {i.text.hud && <Row label="Affected by Post-FX" tip="Off (default): screen text stays crisp on top of the camera's effects. On: bloom, pixelate, CRT... apply to this text too."><Check value={!!i.text.postfx} onChange={(v) => up('Text Post-FX', (x) => { x.text = { ...x.text!, postfx: v }; })} /></Row>}
          <Row label=""><button className="btn small" title="Or double-click it in the viewport" onClick={() => setTextEdit(true)}>Edit look…</button></Row>
          {textEdit && <HudEditDialog uid={i.uid} onClose={() => setTextEdit(false)} />}
          <Row label="Icon"><Select value={i.text.icon ?? ''} options={['', ...textures.map((t) => t.id)]} labels={{ '': 'None', ...Object.fromEntries(textures.map((t) => [t.id, t.name])) }} onChange={(v) => up('Icon', (x) => { x.text = { ...x.text!, icon: v || undefined }; })} /></Row>
        </Section>
      )}
      {i.kind === 'text' && i.text && <TextStylePanel i={i} up={up} textures={textures} />}
      {i.kind === 'light' && i.light && <LightPanel i={i} up={up} />}
      {i.kind === 'camera' && i.camera && <CameraPanel i={i} up={up} />}
      {i.kind === 'emitter' && i.emitter && (
        <Section title="Particle emitter">
          <Row label="Preset"><Select value={i.emitter.preset} options={[...Object.keys(PARTICLE_PRESETS), ...Object.keys(project.particlePresets)]} labels={Object.fromEntries(Object.entries(PARTICLE_PRESETS).map(([k, v]) => [k, v.name]))} onChange={(v) => up('Preset', (x) => { x.emitter = { ...x.emitter!, preset: v, params: {} }; })} /></Row>
          <Row label="Playing at start"><Check value={i.emitter.playing} onChange={(v) => up('Playing', (x) => { x.emitter = { ...x.emitter!, playing: v }; })} /></Row>
          <Row label=""><button className="btn small" onClick={() => store.set({ bottomTab: 'Particles' })}>Open particle editor…</button></Row>
        </Section>
      )}
      {i.kind === 'voxel' && i.voxel && (
        <Section title="Voxel terrain">
          {(['X', 'Y', 'Z'] as const).map((a, n) => (
            <Row key={a} label={`Blocks ${a}`}><Num value={i.voxel!.size[n]} step={4} min={4} onChange={(v) => up('Terrain size', (x) => { const s = [...x.voxel!.size] as [number, number, number]; s[n] = Math.max(4, Math.min(256, Math.round(v))); x.voxel = { ...x.voxel!, size: s }; })} /></Row>
          ))}
          <Row label="Block size (m)"><Num value={i.voxel.cell} step={0.05} min={0.1} onChange={(v) => up('Block size', (x) => { x.voxel = { ...x.voxel!, cell: Math.max(0.1, v) }; })} /></Row>
          <Row label="Seed"><Num value={i.voxel.seed} step={1} onChange={(v) => up('Seed', (x) => { x.voxel = { ...x.voxel!, seed: Math.round(v) }; })} /></Row>
          <Row label="Ground height (blocks)"><Num value={i.voxel.surface} step={1} min={1} onChange={(v) => up('Ground height', (x) => { x.voxel = { ...x.voxel!, surface: Math.round(v) }; })} /></Row>
          <Row label="Hills (blocks)"><Num value={i.voxel.hills} step={1} min={0} onChange={(v) => up('Hills', (x) => { x.voxel = { ...x.voxel!, hills: Math.max(0, v) }; })} /></Row>
          <Row label="Gold ore"><Slider value={i.voxel.gold} min={0} max={0.2} step={0.005} onChange={(v) => up('Gold ore', (x) => { x.voxel = { ...x.voxel!, gold: v }; }, 'gold')} /></Row>
        </Section>
      )}
      {(PRIM_KINDS.has(i.kind)) && (
        <Section title="Material">
          <Row label="Surface" tip="Water: see-through and glossy with animated ripples, using Base color and Opacity below. The Water behavior makes it swimmable (buoyancy, drag)"><Select value={isWaterSurface(i) ? 'water' : 'standard'} options={['standard', 'water']} labels={{ standard: 'Standard', water: 'Water' }} onChange={(v) => up('Surface', (x) => { x.material = v === 'water' ? { ...mat(x), surface: 'water', roughness: 0.08, metalness: 0.1, ripples: x.material?.ripples ?? true } : { ...mat(x), surface: 'standard' }; if (v === 'water' && x.opacity >= 100) x.opacity = WATER_LOOK.opacity; })} /></Row>
          {isWaterSurface(i) && <p className="hint small">Realistic or toon, waves, foam, ripples and caustics: {i.behaviors.some((b) => b.type === 'water') ? 'in the Water behavior below' : 'in the Water section above'}.</p>}
          {/* Each property's texture input sits right under it (TextureSlots with `only`). */}
          <Row label="Base color"><Color value={i.color} onChange={(v) => up('Color', (x) => { x.color = v; }, 'color')} /></Row>
          <TextureSlots i={i} textures={textures} up={up} only="color" />
          <Row label="Roughness"><Slider value={i.material?.roughness ?? 0.6} min={0} max={1} step={0.01} onChange={(v) => up('Roughness', (x) => { x.material = { ...mat(x), roughness: v }; }, 'rough')} /></Row>
          <TextureSlots i={i} textures={textures} up={up} only="roughness" />
          <Row label="Metallic"><Slider value={i.material?.metalness ?? 0} min={0} max={1} step={0.01} onChange={(v) => up('Metallic', (x) => { x.material = { ...mat(x), metalness: v }; }, 'metal')} /></Row>
          <TextureSlots i={i} textures={textures} up={up} only="metalness" />
          <Row label="Normal strength" tip="How strongly the normal map bends the light (1 = as painted)"><Slider value={i.material?.normalStrength ?? 1} min={0} max={3} step={0.05} onChange={(v) => up('Normal strength', (x) => { x.material = { ...mat(x), normalStrength: v }; }, 'nstr')} /></Row>
          <TextureSlots i={i} textures={textures} up={up} only="normal" />
          <Row label="Height amount" tip="How deep the height (bump) map looks: white high, black low"><Slider value={i.material?.heightAmount ?? 1} min={0} max={5} step={0.05} onChange={(v) => up('Height amount', (x) => { x.material = { ...mat(x), heightAmount: v }; }, 'hamt')} /></Row>
          <TextureSlots i={i} textures={textures} up={up} only="height" />
          {i.material?.maps?.height?.asset && ['box', 'plane', 'sphere', 'cylinder'].includes(i.kind) && <>
            <Row label="Height as" tip="Bump: lighting only, the surface stays flat. Displacement: the surface is subdivided and really moves (white out, black in, mid-grey stays); shadows follow it. Collision keeps the object's shape">
              <select value={i.material?.displace ? 'displace' : 'bump'} onChange={(ev) => up('Height as', (x) => { x.material = { ...mat(x), displace: ev.target.value === 'displace' }; })}>
                <option value="bump">Bump (lighting)</option><option value="displace">Displacement (geometry)</option>
              </select>
            </Row>
            {i.material?.displace && <>
              <Row label="Displacement (m)" tip="How far white moves out and black moves in, in metres (mid-grey stays)"><Slider value={i.material?.displaceAmount ?? 0.1} min={0} max={2} step={0.01} onChange={(v) => up('Displacement', (x) => { x.material = { ...mat(x), displaceAmount: v }; }, 'damt')} /></Row>
              <Row label="Detail" tip="Subdivision: 1 = about 16 points per metre on each side (up to 256 per side). Higher is finer and slower"><Slider value={i.material?.displaceDetail ?? 1} min={0.25} max={4} step={0.25} onChange={(v) => up('Displacement detail', (x) => { x.material = { ...mat(x), displaceDetail: v }; }, 'ddet')} /></Row>
            </>}
          </>}
          <Row label="AO strength" tip="How dark the ambient occlusion map makes creases"><Slider value={i.material?.aoStrength ?? 1} min={0} max={2} step={0.05} onChange={(v) => up('AO strength', (x) => { x.material = { ...mat(x), aoStrength: v }; }, 'aostr')} /></Row>
          <TextureSlots i={i} textures={textures} up={up} only="ao" />
          <Row label="Emission"><Color value={i.material?.emissive ?? '#000000'} onChange={(v) => up('Emission', (x) => { x.material = { ...mat(x), emissive: v }; }, 'emis')} /></Row>
          <Row label="Emission strength"><Num value={i.material?.emissiveStrength ?? 0} step={0.1} min={0} onChange={(v) => up('Emission strength', (x) => { x.material = { ...mat(x), emissiveStrength: v }; }, 'emiss')} /></Row>
          <TextureSlots i={i} textures={textures} up={up} only="emission" />
          <Row label="Opacity"><Slider value={i.opacity} min={0} max={100} step={1} onChange={(v) => up('Opacity', (x) => { x.opacity = v; }, 'op')} /></Row>
          <TextureSlots i={i} textures={textures} up={up} only="opacity" />
          <TextureSlots i={i} textures={textures} up={up} only="random" />
        </Section>
      )}
      {i.kind !== 'light' && i.kind !== 'camera' && i.kind !== 'text' && (
        <CollisionPanel i={i} up={up} />
      )}
      <Section title="Behaviors" right={
        <select className="sel small" value="" onChange={(e) => { if (e.target.value) addBehavior(e.target.value); }}>
          <option value="">+ Add behavior</option>
          {Object.values(BEHAVIORS).filter((b) => !i.behaviors.some((x) => x.type === b.id)).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>}>
        {!i.behaviors.length && <div className="hint">Behaviors add ready-made movement and abilities (Platform, Car, 8 Direction, Physics, Pathfinding, Health…).</div>}
        {i.behaviors.map((b, bi) => {
          const def = BEHAVIORS[b.type];
          return (
            <div key={b.type} className="beh">
              <div className="beh-head" title={def?.doc}><span>{def?.name ?? b.type}</span>
                <button className="x" title="Remove behavior" onClick={() => up('Remove behavior', (x) => { x.behaviors = x.behaviors.filter((y) => y.type !== b.type); })}>✕</button></div>
              {def?.props.filter((p) => p.key !== 'enabled' && !(b.type === 'procanim' && p.key === 'boneMap')).map((p) => (
                <Row key={p.key} label={p.label} tip={p.doc}>
                  <PropInput p={p} value={b.props[p.key] ?? p.default} types={scene.instances.map((x) => x.type)} onChange={(v) => up(`${def.name}: ${p.label}`, (x) => { const bb = x.behaviors.find((y) => y.type === b.type); if (bb) bb.props[p.key] = v; }, 'beh' + bi + p.key)} />
                </Row>
              ))}
              {b.type === 'procanim' && <ProcBoneMapping i={i} props={b.props} up={up} />}
              {b.type === 'water' && <WaterControls i={i} up={up} textures={textures} />}
        {b.type === 'procanim' && <Row label="Logic" tip="Write this controller into the event sheet as editable blocks (leg controller, ground detection, foot placement, body motion, climbing), filled with the settings above"><button className="btn small" onClick={() => {
          const kind = editorRefs.view?.procRig(i.uid, String(b.props.rig ?? 'auto'), String(b.props.boneMap ?? ''))?.kind ?? (b.props.rig && b.props.rig !== 'auto' ? String(b.props.rig) : 'human');
          store.mutate('Show procedural animation as blocks', (p) => {
            const s = curScene(p), sh = p.logic.sheets.find((x) => x.id === (s.sheetId ?? p.logic.sheets[0]?.id)) ?? p.logic.sheets[0];
            if (sh) sh.events.push(procAnimGroup(i.type, kind, b.props));
          });
          store.log('info', `Added "${i.type} procedural animation" to the event sheet: ${procChainText(kind)}.`);
        }}>Show as blocks</button></Row>}
              <Row label="Enabled"><Check value={b.props.enabled !== false} onChange={(v) => up('Enable behavior', (x) => { const bb = x.behaviors.find((y) => y.type === b.type); if (bb) bb.props.enabled = v; })} /></Row>
            </div>
          );
        })}
      </Section>
      {i.kind !== 'light' && i.kind !== 'camera' && !(i.kind === 'text' && i.text?.hud) && <ObjectFxSection i={i} up={up} />}
      {(i.behaviors.some((b) => b.type === 'pathfollow') || !!i.path?.points.length) && <PathSection i={i} up={up} />}
      <Section title="Instance variables">
        {Object.entries(i.vars).map(([k, val]) => (
          <div key={k} className="var-row">
            <span className="var-name">{k}</span>
            {typeof val === 'boolean' ? <Check value={val} onChange={(v) => up('Variable', (x) => { x.vars[k] = v; })} />
              : typeof val === 'number' ? <Num value={val} onChange={(v) => up('Variable', (x) => { x.vars[k] = v; }, 'var' + k)} />
                : <Text value={String(val)} onChange={(v) => up('Variable', (x) => { x.vars[k] = v; }, 'var' + k)} />}
            <button className="x" onClick={() => up('Remove variable', (x) => { delete x.vars[k]; })}>✕</button>
          </div>
        ))}
        <AddVar onAdd={(name, type) => up('Add variable', (x) => { if (!(name in x.vars)) x.vars[name] = type === 'number' ? 0 : type === 'boolean' ? false : ''; })} />
      </Section>
      <Section title="Prefab" defaultOpen={false}>
        <div className="hint">Save this object (with its children, behaviors and variables) as a reusable prefab. It appears under Assets › Prefabs and becomes the spawn template for "Create object".</div>
        <button className="btn" onClick={makePrefab}>Make prefab from "{i.type}"</button>
      </Section>
    </div>
  );
}

const PRIM_KINDS = new Set(['box', 'sphere', 'cylinder', 'cone', 'plane', 'capsule', 'torus', 'ramp']);
const fmt = (n: number) => String(Math.round(Math.abs(n) * 100) / 100);
const mat = (x: InstanceData) => x.material ?? { roughness: 0.6, metalness: 0, emissive: '#000000', emissiveStrength: 0 };

/** Upload a picture into the project as a texture; returns its id. */
async function importTexture(f: File): Promise<string | null> {
  const p = store.get().project!;
  const rel = `imported/files/${f.name.replace(/[^A-Za-z0-9_.-]/g, '_')}`;
  try {
    const bmp = await createImageBitmap(f).catch(() => { throw new Error('this file is not a readable image (use PNG, JPG, GIF or WebP)'); });
    bmp.close();
    await api.putFile(p.id, rel, await f.arrayBuffer());
    const id = `proj:${rel}`;
    store.mutate('Import image', (pp) => { if (!pp.assets.some((a) => a.id === id)) pp.assets.push({ id, name: f.name.replace(/\.[^.]+$/, ''), kind: 'texture', source: 'imported', meta: { sourceFile: f.name, importedAt: new Date().toISOString() } }); });
    return id;
  } catch (e: any) { store.log('error', `Image import failed: ${e.message ?? e}`); return null; }
}

/** Upload a picture into the project, add it as a texture and use it on the selected sprites (wide strips of
 *  square frames are split into frames automatically; grids are sliced with "Slice sprite sheet…"). */
export async function importSpriteImage(f: File) {
  const p = store.get().project!;
  const rel = `imported/files/${f.name.replace(/[^A-Za-z0-9_.-]/g, '_')}`;
  try {
    const bmp = await createImageBitmap(f).catch(() => { throw new Error('this file is not a readable image (use PNG, JPG, GIF or WebP)'); });
    const frames = bmp.width > bmp.height && bmp.width % bmp.height === 0 ? bmp.width / bmp.height : 1;
    bmp.close();
    await api.putFile(p.id, rel, await f.arrayBuffer());
    const id = `proj:${rel}`;
    store.mutate('Import image', (pp) => { if (!pp.assets.some((a) => a.id === id)) pp.assets.push({ id, name: f.name.replace(/\.[^.]+$/, ''), kind: 'texture', source: 'imported', meta: { sourceFile: f.name, importedAt: new Date().toISOString() } }); });
    updateSelected('Sprite image', (x) => { if (x.sprite) x.sprite = { ...x.sprite, image: id, frames, rows: 1, animation: '', animations: undefined }; });
  } catch (e: any) { store.log('error', `Image import failed: ${e.message ?? e}`); }
}

/** GIFs / image sequences -> one sprite sheet with a named animation each, used by the selected sprites. */
async function importAnimationFiles(files: File[]) {
  try {
    const r = await importAnimation(files);
    updateSelected('Import animation', (x) => { if (x.sprite) x.sprite = { ...x.sprite, image: r.image, frames: r.frames, rows: r.rows, fps: r.fps, animation: r.animation, animations: r.animations }; });
    store.log('info', `Imported ${Object.keys(r.animations).length} animation(s): ${Object.entries(r.animations).map(([n, a]) => `${n} (${a.to - a.from + 1} frames)`).join(', ')}`);
  } catch (e: any) { store.log('error', `Animation import failed: ${e.message ?? e}`); }
}

function PropInput({ p, value, onChange, types }: { p: PropDef; value: any; onChange: (v: any) => void; types: string[] }) {
  if (p.type === 'boolean') return <Check value={!!value} onChange={onChange} />;
  if (p.type === 'choice') return <Select value={String(value)} options={p.options ?? []} onChange={onChange} />;
  if (p.type === 'objectType') return <Select value={String(value)} options={[...(p.default === '' ? [''] : []), ...new Set(types)]} labels={{ '': 'None' }} onChange={onChange} />;
  if (p.type === 'color') return <span className="pair"><Color value={String(value) || '#808080'} onChange={onChange} />{value ? <button className="btn small" title="Back to automatic" onClick={() => onChange('')}>Auto</button> : <span className="hint small">Automatic</span>}</span>;
  if (p.type === 'particle') { const proj = store.get().project; return <Select value={String(value)} options={['', ...Object.keys(PARTICLE_PRESETS), ...Object.keys(proj?.particlePresets ?? {}).filter((k) => !k.includes('#'))]} labels={{ '': 'None' }} onChange={onChange} />; }
  if (p.type === 'sound') { const proj = store.get().project; const names = soundNames(proj?.logic.sounds).filter((n) => !n.startsWith('music:')); return <Select value={String(value)} options={['', ...names, ...(value && !names.includes(String(value)) ? [String(value)] : [])]} labels={{ '': 'Silent' }} onChange={onChange} />; }
  if (p.type === 'image') { const pics = (store.get().project?.assets ?? []).filter((a) => a.kind === 'texture'); const v = String(value ?? ''); return <Select value={v} options={['', ...pics.map((a) => a.id), ...(v && !pics.some((a) => a.id === v) ? [v] : [])]} labels={{ '': 'None', ...Object.fromEntries(pics.map((a) => [a.id, a.name])) }} onChange={onChange} />; }
  if (p.type === 'string') return <Text value={String(value)} onChange={onChange} />;
  if (p.min != null && p.max != null) return <Slider value={Number(value)} min={p.min} max={p.max} step={p.step ?? 0.01} onChange={onChange} />;
  return <Num value={Number(value)} step={p.step ?? 0.5} min={p.min} max={p.max} onChange={onChange} />;
}

function AddVar({ onAdd }: { onAdd: (name: string, type: string) => void }) {
  const [name, setName] = React.useState('');
  const [type, setType] = React.useState('number');
  return (
    <div className="var-add">
      <input className="txt small" placeholder="new variable" value={name} onChange={(e) => setName(e.target.value.replace(/[^A-Za-z0-9_]/g, ''))} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter' && name) { onAdd(name, type); setName(''); } }} />
      <select className="sel small" value={type} onChange={(e) => setType(e.target.value)}><option>number</option><option>string</option><option>boolean</option></select>
      <button className="btn small" disabled={!name} onClick={() => { onAdd(name, type); setName(''); }}>Add</button>
    </div>
  );
}

/** Blender Light properties: Point / Sun / Spot / Area, Color, Power (W) or Strength, Radius, Spot Size/Blend, Shape/Size. */
/**
 * Everything about how water looks: inside the Water behavior's card, or in a Water section of its own for water without
 * that behavior. Every control always shows (hidden until a box was ticked, they looked removed); moving a slider of a
 * feature that is off turns that feature on.
 */
function WaterControls({ i, up, textures }: { i: InstanceData; up: (l: string, f: (x: InstanceData) => void, k?: string) => void; textures: AssetRef[] }) {
  const w = i.material?.water ?? {};
  const file = useRef<HTMLInputElement>(null);
  const custom = (x: InstanceData) => hasWaterImage(x) && !isStylisedWater(x);
  // A picture shows as painted (no blue tint over it, not faint); taking it off brings the water's own colour back.
  const upImage: typeof up = (l, f, k) => up(l, (x) => {
    const had = hasWaterImage(x);
    f(x);
    if (!had && hasWaterImage(x)) { x.color = '#ffffff'; if (x.opacity < 80) x.opacity = 85; }
    if (had && !hasWaterImage(x)) { x.color = WATER_LOOK.color; x.opacity = WATER_LOOK.opacity; }
  }, k);
  const importImage = async (f: File) => {
    const id = await importTexture(f);
    if (id) upImage('Water image', (x) => { x.material = { ...mat(x), map: undefined, maps: { ...materialSlots(x.material), color: replaceSlotImage(materialSlots(x.material).color, id) } }; });
  };
  const set = (label: string, patch: Partial<NonNullable<NonNullable<InstanceData['material']>['water']>>, key?: string) =>
    up(label, (x) => { x.material = { ...mat(x), water: { ...(x.material?.water ?? {}), ...patch } }; }, key);
  const round = i.kind === 'sphere';
  const head = (t: string) => <h4 style={{ margin: '10px 0 4px' }}>{t}</h4>;
  return <div id="water-section">
    {!PRIM_KINDS.has(i.kind) && <p className="hint small">This object swims and floats like water, but only basic shapes (cube, sphere, plane…) can look like water. Add › Water makes one.</p>}
    {PRIM_KINDS.has(i.kind) && !isWaterSurface(i) && <Row label="Look" tip="This object has the Water behavior but draws as a plain surface"><button className="btn small" onClick={() => up('Surface', (x) => { x.material = { ...mat(x), surface: 'water', roughness: 0.08, metalness: 0.1, ripples: x.material?.ripples ?? true }; if (x.opacity >= 100) x.opacity = WATER_LOOK.opacity; })}>Make it look like water</button></Row>}
    {PRIM_KINDS.has(i.kind) && isWaterSurface(i) && <>
      <Row label="Look" tip="Realistic: clear water with light ripples. Toon: an animated cartoon water texture (seamless, 40 frames). Your image: any picture, with full UV control below"><Select value={isStylisedWater(i) ? 'stylised' : custom(i) ? 'custom' : 'realistic'} options={['realistic', 'stylised', 'custom']} labels={{ realistic: 'Realistic', stylised: 'Toon (animated)', custom: 'Your image' }} onChange={(v) => v === 'custom' ? (!custom(i) && file.current?.click()) : up('Water look', (x) => {
        const maps = { ...(x.material?.maps ?? {}) };
        if (v === 'stylised') { maps.color = stylisedWaterSlot(); x.color = '#ffffff'; if (x.opacity < 80) x.opacity = 85; x.material = { ...mat(x), maps, ripples: false }; }
        else { delete maps.color; x.color = WATER_LOOK.color; x.opacity = WATER_LOOK.opacity; x.material = { ...mat(x), maps, ripples: true }; }
      })} /></Row>
      <Row label="Colour"><Color value={i.color} onChange={(v) => up('Color', (x) => { x.color = v; }, 'color')} /></Row>
      <Row label="Opacity" tip="How see-through it is, or how murky per metre once it has waves or Depth"><Slider value={i.opacity} min={0} max={100} step={1} onChange={(v) => up('Opacity', (x) => { x.opacity = v; }, 'wop')} /></Row>
      <Row label="Highlights" tip="Brightness of the sun's glints and sparkles on the surface (0 = none)"><Slider value={w.highlights ?? WATER_FX.highlights} min={0} max={3} step={0.05} onChange={(v) => set('Water highlights', { highlights: v }, 'whl')} /></Row>

      {head('Texture & UV')}
      <Row label="Image" tip="Use a picture from your computer on the water's surface (PNG, JPG, GIF or WebP). The list below has the project's textures"><button className="btn small" onClick={() => file.current?.click()}>Import image…</button><input ref={file} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void importImage(f); }} /></Row>
      <TextureSlots i={i} textures={textures} up={upImage} only="color" rowLabel="Water texture" />
      <TextureSlots i={i} textures={textures} up={up} only="normal" rowLabel="Normal map" />
      <TextureSlots i={i} textures={textures} up={up} only="random" />

      {head('Ripples')}
      <Row label="Animated surface" tip="Fine rippling pattern moving on the surface"><Check value={i.material?.ripples !== false} onChange={(v) => up('Ripples', (x) => { x.material = { ...mat(x), ripples: v }; })} /></Row>
      <Row label="Ripple strength"><Slider value={i.material?.rippleStrength ?? WATER_LOOK.rippleStrength} min={0} max={2} step={0.05} onChange={(v) => up('Ripple strength', (x) => { x.material = { ...mat(x), rippleStrength: v, ripples: true }; }, 'rips')} /></Row>
      <Row label="Ripple speed"><Slider value={i.material?.rippleSpeed ?? WATER_LOOK.rippleSpeed} min={0} max={4} step={0.05} onChange={(v) => up('Ripple speed', (x) => { x.material = { ...mat(x), rippleSpeed: v, ripples: true }; }, 'ripv')} /></Row>

      <Row label="Ripple scale" tip="How many times the ripple pattern repeats across the surface (higher = smaller ripples)"><Slider value={i.material?.rippleScale ?? WATER_LOOK.rippleScale} min={0.5} max={40} step={0.5} onChange={(v) => up('Ripple scale', (x) => { x.material = { ...mat(x), rippleScale: v, ripples: true }; }, 'ripr')} /></Row>

      {head('Waves')}
      <Row label="Waves" tip={round ? 'Waves all round the sphere (visual only)' : 'Waves on the top surface (visual only: floating and swimming use the flat level)'}><Check value={!!w.waves} onChange={(v) => set('Water waves', { waves: v })} /></Row>
      <Row label="Wave height"><Slider value={w.waveHeight ?? WATER_FX.waveHeight} min={0} max={1.5} step={0.01} onChange={(v) => set('Wave height', { waveHeight: v, waves: true }, 'wvh')} /></Row>
      <Row label="Wave length" tip="Metres from crest to crest"><Slider value={w.waveLength ?? WATER_FX.waveLength} min={0.5} max={20} step={0.1} onChange={(v) => set('Wave length', { waveLength: v, waves: true }, 'wvl')} /></Row>
      <Row label="Wave speed"><Slider value={w.waveSpeed ?? WATER_FX.waveSpeed} min={0} max={4} step={0.05} onChange={(v) => set('Wave speed', { waveSpeed: v, waves: true }, 'wvs')} /></Row>
      <Row label="Wave direction (°)" tip="Which way the waves travel"><Slider value={w.waveDirection ?? 0} min={0} max={360} step={5} onChange={(v) => set('Wave direction', { waveDirection: v, waves: true }, 'wvdir')} /></Row>
      <Row label="Wave layers" tip="Overlapping wave patterns: 1 = one clean swell, 3 = natural mixed sea"><Slider value={w.waveLayers ?? 3} min={1} max={3} step={1} onChange={(v) => set('Wave layers', { waveLayers: v, waves: true }, 'wvlay')} /></Row>
      <Row label="Turbulence" tip="Choppiness: a fast cross-wave on top (0 = smooth swell)"><Slider value={w.turbulence ?? 0} min={0} max={1} step={0.05} onChange={(v) => set('Wave turbulence', { turbulence: v, waves: true }, 'wvturb')} /></Row>
      <Row label="Wave seed" tip="Change for a different arrangement of the same waves (several pools side by side won't match)"><Num value={w.waveSeed ?? 0} step={1} onChange={(v) => set('Wave seed', { waveSeed: Math.round(v), waves: true }, 'wvseed')} /></Row>
      {!hasWaterImage(i) && <Row label="Surface detail" tip="Fine crossing wavelets on the waves that catch the light (0 = smooth)"><Slider value={w.detail ?? WATER_FX.detail} min={0} max={2} step={0.05} onChange={(v) => set('Surface detail', { detail: v, waves: true }, 'wvd')} /></Row>}

      {head('Foam')}
      <Row label="Foam around objects" tip="Foam where the water is shallow: along shores and round things that stick out of it"><Check value={!!w.foam} onChange={(v) => set('Edge foam', { foam: v })} /></Row>
      <Row label="Foam width" tip="How deep the water can be and still foam (metres)"><Slider value={w.foamWidth ?? WATER_FX.foamWidth} min={0.02} max={2} step={0.01} onChange={(v) => set('Foam width', { foamWidth: v, foam: true }, 'fw')} /></Row>
      <Row label="Toon foam" tip="Cartoon foam patches drifting on the surface (0 = none)"><Slider value={w.toonFoam ?? WATER_FX.toonFoam} min={0} max={1} step={0.01} onChange={(v) => set('Cartoon foam', { toonFoam: v }, 'tf')} /></Row>
      <Row label="Foam colour" tip="Both kinds of foam"><Color value={w.foamColor ?? WATER_FX.foamColor} onChange={(v) => set('Foam color', { foamColor: v }, 'fc')} /></Row>

      {!round && head('Wakes')}
      {!round && <Row label="Wakes" tip="Rings spread where objects move through the surface or drop in"><Check value={w.wakes !== false} onChange={(v) => set('Water wakes', { wakes: v })} /></Row>}
      {!round && <Row label="Wake strength"><Slider value={w.wakeStrength ?? WATER_FX.wakeStrength} min={0} max={3} step={0.05} onChange={(v) => set('Wake strength', { wakeStrength: v, wakes: true }, 'wks')} /></Row>}

      {head('Depth')}
      <Row label="Depth" tip="Clear in the shallows, darkening to the deep colour: the depth (metres) where it is fully deep (0 = off)"><Slider value={w.clarity ?? WATER_FX.clarity} min={0} max={20} step={0.1} onChange={(v) => set('Water depth look', { clarity: v }, 'clr')} /></Row>
      <Row label="Deep colour"><Color value={w.deepColor ?? WATER_FX.deepColor} onChange={(v) => set('Deep color', { deepColor: v, clarity: (w.clarity ?? 0) > 0 ? w.clarity : 4 }, 'dc')} /></Row>

      {head('Caustics')}
      <Row label="Caustics" tip="Moving light patterns on what is in and under the water (Rendered view and play)"><Check value={!!w.caustics} onChange={(v) => set('Caustics', { caustics: v })} /></Row>
      <Row label="Caustic brightness" tip="How bright the light patterns under the water are"><Slider value={w.causticsStrength ?? WATER_FX.causticsStrength} min={0} max={4} step={0.05} onChange={(v) => set('Caustic brightness', { causticsStrength: v, caustics: true }, 'cs')} /></Row>
    </>}
  </div>;
}

function LightPanel({ i, up }: { i: InstanceData; up: (l: string, f: (x: InstanceData) => void, k?: string) => void }) {
  const l = i.light ?? DEFAULT_LIGHT;
  const set = (patch: Partial<typeof l>, key?: string) => up('Light', (x) => { x.light = { ...(x.light ?? DEFAULT_LIGHT), ...patch }; }, key);
  return (
    <Section title="Light">
      <div className="seg wide">{(['point', 'sun', 'spot', 'area'] as const).map((t) => <button key={t} className={l.type === t ? 'on' : ''} onClick={() => set({ type: t, power: t === 'sun' ? 3 : t === 'area' ? 200 : 1000 })}>{t[0].toUpperCase() + t.slice(1)}</button>)}</div>
      <Row label="Color"><Color value={l.color} onChange={(v) => set({ color: v }, 'lcol')} /></Row>
      {l.type === 'sun'
        ? <Row label="Strength" tip="Irradiance in W/m², like Blender's sun Strength"><Num value={l.power} step={0.1} min={0} onChange={(v) => set({ power: v }, 'lpow')} /></Row>
        : <Row label="Power" tip="Watts, like Blender"><Num value={l.power} step={10} min={0} suffix=" W" onChange={(v) => set({ power: v }, 'lpow')} /></Row>}
      {l.type !== 'area' && <Row label={l.type === 'sun' ? 'Angle (softness)' : 'Radius'} tip="Shadow softness"><Num value={l.radius} step={0.01} min={0} suffix=" m" onChange={(v) => set({ radius: v }, 'lrad')} /></Row>}
      {l.type === 'spot' && <>
        <Row label="Spot size"><Num value={l.spotSize} step={1} min={1} max={180} suffix="°" onChange={(v) => set({ spotSize: v }, 'lss')} /></Row>
        <Row label="Blend"><Slider value={l.spotBlend} min={0} max={1} step={0.01} onChange={(v) => set({ spotBlend: v }, 'lsb')} /></Row>
      </>}
      {l.type === 'area' && <>
        <Row label="Shape"><Select value={l.areaShape} options={['square', 'rectangle']} onChange={(v) => set({ areaShape: v as any })} /></Row>
        <Row label={l.areaShape === 'square' ? 'Size' : 'Size X'}><Num value={l.sizeX} step={0.1} min={0.01} suffix=" m" onChange={(v) => set({ sizeX: v }, 'lsx')} /></Row>
        {l.areaShape === 'rectangle' && <Row label="Size Y"><Num value={l.sizeY} step={0.1} min={0.01} suffix=" m" onChange={(v) => set({ sizeY: v }, 'lsy')} /></Row>}
      </>}
      {l.type !== 'area' && <Row label="Cast shadow"><Check value={l.castShadow} onChange={(v) => set({ castShadow: v })} /></Row>}
      {(l.type === 'point' || l.type === 'spot') && <Row label="Custom distance" tip="0 = unlimited (Blender Custom Distance)"><Num value={l.cutoff} step={1} min={0} suffix=" m" onChange={(v) => set({ cutoff: v }, 'lcut')} /></Row>}
      {(l.type === 'point' || l.type === 'spot') && <Row label="Falloff" tip="How the light fades with distance"><Select value={l.falloff ?? 'realistic'} options={['realistic', 'linear', 'none']} labels={{ realistic: 'Realistic (inverse square)', linear: 'Linear (gentler)', none: 'None (constant)' }} onChange={(v) => set({ falloff: v as any })} /></Row>}
      {(l.type === 'sun' || l.type === 'spot') && <>
        {/* Aim: the light shines along local −Z with rotation order YXZ, so elevation = −Rotation X and direction = −Rotation Y. */}
        <Row label="Elevation" tip="Height of the light above the horizon (90° = straight down)"><Slider value={Math.max(-90, Math.min(90, -i.rx))} min={-90} max={90} step={1} onChange={(v) => up('Light elevation', (x) => { x.rx = -v; }, 'lel')} /></Row>
        <Row label="Direction" tip="Compass direction the light shines toward (0° = −Z / forward)"><Slider value={((-i.ry % 360) + 360) % 360} min={0} max={359} step={1} onChange={(v) => up('Light direction', (x) => { x.ry = -v; }, 'ldir')} /></Row>
      </>}
      {l.type !== 'area' && l.castShadow && <>
        <Row label="Shadow resolution" tip="Auto follows the quality preset (Preferences › Rendering)"><Select value={String(l.shadowResolution ?? 0)} options={['0', '512', '1024', '2048', '4096']} labels={{ '0': 'Auto' }} onChange={(v) => set({ shadowResolution: Number(v) || undefined })} /></Row>
        <Row label="Shadow bias · normal" tip="Raise a little if shadows have stripes (acne); lower if objects look like they float"><span className="pair"><Num value={l.shadowBias ?? (l.type === 'sun' ? -0.0005 : -0.001)} step={0.0001} precision={4} onChange={(v) => set({ shadowBias: v }, 'lsb2')} /><Num value={l.shadowNormalBias ?? 0.02} step={0.005} precision={3} min={0} onChange={(v) => set({ shadowNormalBias: v }, 'lsnb')} /></span></Row>
        {l.type === 'sun' && <Row label="Shadow area" tip="Half-size of the shadowed area around the scene (m). Smaller = sharper shadows"><Num value={l.shadowArea ?? 30} step={5} min={2} suffix=" m" onChange={(v) => set({ shadowArea: v }, 'lsa')} /></Row>}
      </>}
      <div className="hint">Lights shine along their local −Z axis (rotate with R). Units follow Blender: 1000 W point light ≈ Blender's default.</div>
    </Section>
  );
}

/** Blender Camera properties: Lens type, Focal length / FOV, Shift, Clip start/end, Sensor, Depth of field. */
function CameraPanel({ i, up }: { i: InstanceData; up: (l: string, f: (x: InstanceData) => void, k?: string) => void }) {
  const c = i.camera ?? DEFAULT_CAMERA;
  const set = (patch: Partial<typeof c>, key?: string) => up('Camera', (x) => { x.camera = { ...(x.camera ?? DEFAULT_CAMERA), ...patch }; }, key);
  return (
    <Section title="Camera">
      <Row label="View preset" tip="Isometric 2:1 (pixel-art tiles), true isometric or top-down: orthographic, angled from a corner. With Follow, it becomes the follow offset; otherwise it keeps looking at the same spot on the ground. ⟲ ⟳ turn it 90°.">
        <span className="pair">
          <Select value={c.preset?.id ?? ''} options={['', ...CAMERA_PRESETS.map((p) => p.id)]} labels={{ '': 'Custom', ...Object.fromEntries(CAMERA_PRESETS.map((p) => [p.id, p.label])) }} onChange={(v) => { if (v) up('Camera view: ' + v, (x) => { applyCameraView(x, v as CameraPresetId, x.camera?.preset?.turn ?? 0); }); else set({ preset: undefined }); }} />
          {c.preset && <><button className="btn small" title="Turn the view 90° left" onClick={() => up('Turn camera view', (x) => { applyCameraView(x, c.preset!.id, c.preset!.turn + 1); })}>⟲</button>
            <button className="btn small" title="Turn the view 90° right" onClick={() => up('Turn camera view', (x) => { applyCameraView(x, c.preset!.id, c.preset!.turn + 3); })}>⟳</button></>}
        </span>
      </Row>
      <Row label="Type"><Select value={c.type} options={['perspective', 'orthographic']} labels={{ perspective: 'Perspective', orthographic: 'Orthographic' }} onChange={(v) => set({ type: v as any })} /></Row>
      {c.type === 'perspective'
        ? <><Row label="Focal length"><Num value={c.focalLength} step={1} min={1} suffix=" mm" onChange={(v) => set({ focalLength: v }, 'cfl')} /></Row>
          <Row label="Field of view"><span className="dim">{fovFromFocal(c.focalLength, c.sensorWidth).toFixed(1)}° (horizontal)</span></Row></>
        : <Row label="Orthographic scale"><Num value={c.orthoScale} step={0.5} min={0.1} onChange={(v) => set({ orthoScale: v }, 'cos')} /></Row>}
      <Row label="Shift X / Y"><span className="pair"><Num value={c.shiftX} step={0.01} onChange={(v) => set({ shiftX: v }, 'csx')} /><Num value={c.shiftY} step={0.01} onChange={(v) => set({ shiftY: v }, 'csy')} /></span></Row>
      <Row label="Clip start / end"><span className="pair"><Num value={c.clipStart} step={0.01} min={0.001} onChange={(v) => set({ clipStart: v }, 'ccs')} /><Num value={c.clipEnd} step={10} min={0.1} onChange={(v) => set({ clipEnd: v }, 'cce')} /></span></Row>
      <Row label="Sensor width"><Num value={c.sensorWidth} step={1} min={1} suffix=" mm" onChange={(v) => set({ sensorWidth: v }, 'csw')} /></Row>
      <Row label="Depth of field"><Check value={c.dofEnabled} onChange={(v) => {
        set({ dofEnabled: v });
        up('Depth of field', (x) => { const cam = x.camera!; const e = cam.postfx.find((f) => f.type === 'dof'); if (v && !e) cam.postfx.push({ id: 'fx_dof_' + Date.now(), type: 'dof', enabled: true, params: { focus: cam.focusDistance, fstop: cam.fStop, maxblur: 0.01 } }); if (e) e.enabled = v; });
      }} /></Row>
      {c.dofEnabled && <>
        <Row label="Focus distance"><Num value={c.focusDistance} step={0.1} min={0.01} suffix=" m" onChange={(v) => up('Focus', (x) => { x.camera!.focusDistance = v; const e = x.camera!.postfx.find((f) => f.type === 'dof'); if (e) e.params.focus = v; }, 'cfd')} /></Row>
        <Row label="F-stop"><Num value={c.fStop} step={0.1} min={0.5} onChange={(v) => up('F-stop', (x) => { x.camera!.fStop = v; const e = x.camera!.postfx.find((f) => f.type === 'dof'); if (e) e.params.fstop = v; }, 'cfs')} /></Row>
      </>}
      <Row label="Active camera"><Check value={c.active} onChange={(v) => store.mutate('Set active camera', (p) => { for (const x of curScene(p).instances) if (x.camera) x.camera.active = x.uid === i.uid ? v : v ? false : x.camera.active; })} /></Row>
      <Row label="Post-processing"><button className="btn small" onClick={() => store.set({ rightTab: 'Effects' })}>{c.postfx.filter((e) => e.enabled).length} effects — edit…</button></Row>
    </Section>
  );
}

function renameType(from: string, to: string) {
  const name = to.replace(/[^A-Za-z0-9_]/g, '');
  if (!name || name === from) return;
  store.mutate(`Rename type ${from} → ${name}`, (p) => {
    for (const s of p.scenes) {
      for (const i of s.instances) if (i.type === from && store.get().selection.includes(i.uid)) i.type = name;
      // If no instance of the old type remains, rename references in logic too.
      if (!s.instances.some((i) => i.type === from)) {
        for (const t of s.objectTypes) if (t.name === from) t.name = name;
        for (const sh of p.logic.sheets) walkEvents(sh.events, (n) => {
          if (n.kind !== 'event') return;
          for (const b of [...n.conditions, ...n.actions]) {
            if (b.target === from) b.target = name;
            for (const pd of BLOCK_DEFS[b.block]?.params ?? []) {
              if (pd.type === 'objectType' && b.params[pd.name] === from) b.params[pd.name] = name;
              if (pd.type === 'expr' && typeof b.params[pd.name] === 'string') b.params[pd.name] = (b.params[pd.name] as string).replace(new RegExp(`\\b${from}\\.`, 'g'), name + '.');
            }
          }
        });
      }
    }
  });
}

type Up = (l: string, f: (x: InstanceData) => void, k?: string) => void;

/** Background, outline, shadow and lettering for text objects (HUD and world text alike). */
function TextStylePanel({ i, up, textures }: { i: InstanceData; up: Up; textures: { id: string; name: string }[] }) {
  const s: TextStyle = i.text!.style ?? {};
  const set = (patch: Partial<TextStyle>, key?: string) => up('Text style', (x) => { x.text = { ...x.text!, style: { ...(x.text!.style ?? {}), ...patch } }; }, key);
  return (
    <Section title="Text style" defaultOpen={!!i.text!.style}>
      <Row label="Preset"><Select value="" options={['', ...Object.keys(TEXT_STYLE_PRESETS)]} labels={{ '': 'Apply a preset…', ...Object.fromEntries(Object.entries(TEXT_STYLE_PRESETS).map(([k, v]) => [k, v.name])) }} onChange={(v) => v && up('Text style preset', (x) => { x.text = { ...x.text!, style: { ...TEXT_STYLE_PRESETS[v].style } }; })} /></Row>
      <Row label="Background"><span className="pair"><Check value={!!s.bg} onChange={(v) => set({ bg: v ? '#000000' : undefined, bgOpacity: s.bgOpacity ?? 0.6 })} />{s.bg && <Color value={s.bg} onChange={(v) => set({ bg: v }, 'tbg')} />}</span></Row>
      {s.bg && <Row label="Background opacity"><Slider value={s.bgOpacity ?? 1} min={0} max={1} step={0.01} onChange={(v) => set({ bgOpacity: v }, 'tbgo')} /></Row>}
      <Row label="Background image"><Select value={s.bgImage ?? ''} options={['', ...textures.map((t) => t.id)]} labels={{ '': 'None', ...Object.fromEntries(textures.map((t) => [t.id, t.name])) }} onChange={(v) => set({ bgImage: v || undefined })} /></Row>
      {(s.bg || s.bgImage) && <>
        <Row label="Padding (px)"><Num value={s.padding ?? 0} step={1} min={0} precision={0} onChange={(v) => set({ padding: v }, 'tpad')} /></Row>
        <Row label="Corner radius"><Num value={s.radius ?? 0} step={1} min={0} precision={0} onChange={(v) => set({ radius: v }, 'trad')} /></Row>
        <Row label="Border"><span className="pair"><Num value={s.borderWidth ?? 0} step={1} min={0} precision={0} onChange={(v) => set({ borderWidth: v }, 'tbw')} /><Color value={s.border ?? '#ffffff'} onChange={(v) => set({ border: v }, 'tbc')} /></span></Row>
      </>}
      <Row label="Outline"><span className="pair"><Num value={s.outlineWidth ?? 0} step={1} min={0} precision={0} onChange={(v) => set({ outlineWidth: v }, 'tow')} /><Color value={s.outline ?? '#000000'} onChange={(v) => set({ outline: v }, 'toc')} /></span></Row>
      <Row label="Shadow"><span className="pair"><Check value={!!s.shadow} onChange={(v) => set({ shadow: v ? '#000000' : undefined, shadowBlur: s.shadowBlur ?? 4, shadowX: s.shadowX ?? 2, shadowY: s.shadowY ?? 2 })} />{s.shadow && <Color value={s.shadow} onChange={(v) => set({ shadow: v }, 'tsc')} />}</span></Row>
      {s.shadow && <Row label="Shadow blur / X / Y"><span className="pair"><Num value={s.shadowBlur ?? 0} step={1} min={0} precision={0} onChange={(v) => set({ shadowBlur: v }, 'tsb')} /><Num value={s.shadowX ?? 0} step={1} precision={0} onChange={(v) => set({ shadowX: v }, 'tsx')} /><Num value={s.shadowY ?? 0} step={1} precision={0} onChange={(v) => set({ shadowY: v }, 'tsy')} /></span></Row>}
      <Row label="Bold / italic / CAPS"><span className="pair"><Check value={s.bold !== false} onChange={(v) => set({ bold: v })} /><Check value={!!s.italic} onChange={(v) => set({ italic: v })} /><Check value={!!s.uppercase} onChange={(v) => set({ uppercase: v })} /></span></Row>
      <Row label="Letter spacing"><Num value={s.letterSpacing ?? 0} step={0.5} onChange={(v) => set({ letterSpacing: v }, 'tls')} /></Row>
      <Row label="Wrap width (px)" tip="0 = one line. Longer text wraps onto new lines"><Num value={s.maxWidth ?? 0} step={10} min={0} precision={0} onChange={(v) => set({ maxWidth: v }, 'tmw')} /></Row>
      {i.text!.style && <Row label=""><button className="btn small" onClick={() => up('Clear text style', (x) => { x.text = { ...x.text!, style: undefined }; })}>Reset style</button></Row>}
    </Section>
  );
}
const COLLIDER_TYPES = { solid: 'Solid — static, blocks movement', physics: 'Physics — falls, bounces, can be pushed', dynamic: 'Dynamic — moves, others pass through', trigger: 'Trigger — overlap events only', default: 'Default — behaviors decide' };
const colliderType = (x: InstanceData): keyof typeof COLLIDER_TYPES =>
  x.collider.isTrigger ? 'trigger' : x.collider.nonBlocking ? 'dynamic' : x.behaviors.some((b) => b.type === 'physics') ? 'physics' : x.behaviors.some((b) => b.type === 'solid') ? 'solid' : 'default';

function setColliderType(x: InstanceData, t: keyof typeof COLLIDER_TYPES) {
  const want = (type: string, on: boolean) => {
    const has = x.behaviors.some((b) => b.type === type);
    if (on && !has) x.behaviors.push({ type, props: behaviorDefaults(type) });
    if (!on && has) x.behaviors = x.behaviors.filter((b) => b.type !== type);
  };
  x.collider = { ...x.collider, isTrigger: t === 'trigger', nonBlocking: t === 'dynamic' };
  if (t === 'solid') { want('solid', true); want('physics', false); }
  if (t === 'physics') { want('physics', true); want('solid', false); }
  if (t === 'trigger' || t === 'dynamic') want('solid', false);
}

/** Effects on this object only (the camera's Post-FX & World settings are untouched and still apply on top). */
function ObjectFxSection({ i, up }: { i: InstanceData; up: Up }) {
  const list = i.fx ?? [];
  const edit = (label: string, fn: (fx: ObjectFx[]) => void, key?: string) => up(label, (x) => { x.fx = (x.fx ?? []).map((f) => ({ ...f, params: { ...f.params } })); fn(x.fx); if (!x.fx.length) x.fx = undefined; }, key);
  return (
    <Section title={`Effects (this object)${list.length ? ` · ${list.filter((f) => f.enabled).length}` : ''}`} defaultOpen={list.length > 0} right={
      <select className="sel small" value="" onChange={(e) => { const t = e.target.value as ObjectFxType; if (t) edit('Add effect', (fx) => { fx.push(makeObjectFx(t)); }); }}>
        <option value="">+ Add effect</option>
        {OBJECT_FX_TYPES.filter((t) => !list.some((f) => f.type === t)).map((t) => <option key={t} value={t}>{OBJECT_FX[t].name}</option>)}
      </select>}>
      {!list.length && <div className="hint">Glow, pixelate, blur, outline or tint just this object. Shows in Rendered shading and in play; the camera's Post-FX still runs on top.</div>}
      {list.map((f, k) => {
        const def = OBJECT_FX[f.type];
        return (
          <div key={f.type} className="beh">
            <div className="beh-head" title={def.doc}><span><Check value={f.enabled} onChange={(v) => edit('Toggle effect', (fx) => { fx[k].enabled = v; })} /> {def.name}</span>
              <span className="pair">
                <button className="x" title="Reset to defaults" onClick={() => edit('Reset effect', (fx) => { fx[k] = { ...makeObjectFx(f.type), enabled: f.enabled }; })}>↺</button>
                <button className="x" title="Remove effect" onClick={() => edit('Remove effect', (fx) => { fx.splice(k, 1); })}>✕</button>
              </span>
            </div>
            {def.params.filter((p) => !p.when || fxNum(f, p.when)).map((p) => (
              <Row key={p.key} label={p.label}>
                {p.kind === 'toggle'
                  ? <Check value={!!fxNum(f, p.key)} onChange={(v) => edit(`${def.name}: ${p.label}`, (fx) => { fx[k].params[p.key] = v ? 1 : 0; })} />
                  : p.kind === 'color'
                  ? <Color value={String(fxParam(f, p.key))} onChange={(v) => edit(`${def.name}: ${p.label}`, (fx) => { fx[k].params[p.key] = v; }, `ofx${f.type}${p.key}`)} />
                  : <Slider value={fxNum(f, p.key)} min={p.min ?? 0} max={p.max ?? 10} step={p.step ?? 0.1} onChange={(v) => edit(`${def.name}: ${p.label}`, (fx) => { fx[k].params[p.key] = v; }, `ofx${f.type}${p.key}`)} />}
              </Row>
            ))}
          </div>
        );
      })}
    </Section>
  );
}

/** NPC route for the Path follower behavior: draw in the viewport, edit points and their wait times here. */
function PathSection({ i, up }: { i: InstanceData; up: Up }) {
  const drawing = useStore((s) => s.pathEdit) === i.uid;
  const pts = i.path?.points ?? [];
  const is2d = curScene(store.get().project!).mode === '2d';
  const edit = (label: string, fn: (p: NonNullable<InstanceData['path']>) => void, key?: string) => up(label, (x) => { x.path ??= { points: [] }; fn(x.path); }, key);
  return (
    <Section title={`Path (${pts.length} point${pts.length === 1 ? '' : 's'})`}>
      <div className="hint">{drawing ? 'Click in the viewport to add points. Drag a point to move it. Enter or Esc to finish.' : 'The route the Path follower walks. Draw it in the viewport; the first point is green.'}</div>
      <div className="btn-row">
        <button className={'btn small' + (drawing ? ' primary' : '')} onClick={() => store.set({ pathEdit: drawing ? null : i.uid })}>{drawing ? 'Finish drawing' : pts.length ? 'Add points' : 'Draw path'}</button>
        <button className="btn small" title="Add a point where the object stands" onClick={() => edit('Add path point', (p) => { p.points.push([i.x, i.y, i.z]); })}>Point at object</button>
        <button className="btn small" disabled={!pts.length} onClick={() => { if (window.confirm('Remove every point of this path?')) edit('Clear path', (p) => { p.points = []; p.waits = []; }); }}>Clear</button>
        <button className="btn small" disabled={pts.length < 2} title="Walk the route the other way round" onClick={() => edit('Reverse path', (p) => { p.points.reverse(); p.waits = p.waits ? [...p.waits, ...Array(Math.max(0, p.points.length - p.waits.length)).fill(0)].slice(0, p.points.length).reverse() : undefined; })}>Reverse</button>
      </div>
      {pts.map((pt, k) => (
        <div key={k} className="path-pt">
          <span className="path-n" style={{ color: k === 0 ? '#3fd17a' : undefined }}>{k + 1}</span>
          <Num value={pt[0]} width={52} onChange={(v) => edit('Move path point', (p) => { p.points[k] = [v, p.points[k][1], p.points[k][2]]; }, `pp${k}x`)} />
          <Num value={is2d ? pt[1] : pt[2]} width={52} onChange={(v) => edit('Move path point', (p) => { const q = [...p.points[k]] as [number, number, number]; q[is2d ? 1 : 2] = v; p.points[k] = q; }, `pp${k}y`)} />
          {!is2d && <Num value={pt[1]} width={44} onChange={(v) => edit('Point height', (p) => { p.points[k] = [p.points[k][0], v, p.points[k][2]]; }, `pp${k}h`)} />}
          <span className="path-wait" title="Pause at this point (seconds)">wait</span>
          <Num value={i.path?.waits?.[k] ?? 0} min={0} step={0.25} width={40} onChange={(v) => edit('Point wait', (p) => { p.waits ??= []; while (p.waits.length < p.points.length) p.waits.push(0); p.waits[k] = v; }, `pp${k}w`)} />
          <button className="x" title="Remove point" onClick={() => edit('Remove path point', (p) => { p.points.splice(k, 1); p.waits?.splice(k, 1); })}>✕</button>
        </div>
      ))}
      {!i.behaviors.some((b) => b.type === 'pathfollow') && <button className="btn small" onClick={() => addBehavior('pathfollow')}>Add the Path follower behavior</button>}
    </Section>
  );
}

function CollisionPanel({ i, up }: { i: InstanceData; up: Up }) {
  const c = i.collider;
  const [busy, setBusy] = React.useState(false);
  const [notes, setNotes] = React.useState<string[]>([]);
  const generated = c.shape === 'convex' || c.shape === 'mesh';
  const mask = c.mask ?? 0xff;
  const generate = (shape: 'convex' | 'mesh', detail?: number) => {
    setBusy(true);
    // Let the button repaint before the (synchronous) voxelization.
    setTimeout(() => {
      try {
        const r = generateFromModel(i.uid, shape, detail ?? c.detail);
        setNotes(r.warnings);
        up(`Generate ${shape} collider`, (x) => { x.collider = { ...x.collider, shape, boxes: r.boxes, sourceTriangles: r.triangles, detail: r.resolution, size: r.size, offset: r.offset }; });
      } catch (e: any) { setNotes([String(e.message ?? e)]); }
      setBusy(false);
    }, 20);
  };
  return (
    <Section title="Collision" defaultOpen={false}>
      <Row label="Type" tip="How this object takes part in collisions"><Select value={colliderType(i)} options={Object.keys(COLLIDER_TYPES)} labels={COLLIDER_TYPES} onChange={(v) => up('Collision type', (x) => setColliderType(x, v as any))} /></Row>
      <Row label="Shape" tip="Convex and Mesh are generated from the model's triangles">
        <Select value={c.shape} options={['box', 'sphere', 'capsule', 'cylinder', 'cone', ...(i.kind === 'mesh' ? ['convex', 'mesh'] : []), 'none']}
          labels={{ box: 'Box', sphere: 'Sphere', capsule: 'Capsule', cylinder: 'Cylinder', cone: 'Cone', convex: 'Convex (from model)', mesh: 'Mesh — concave (from model)', none: 'None' }}
          onChange={(v) => {
            if (v === 'convex' || v === 'mesh') return generate(v);
            up('Collider shape', (x) => { const wasGen = x.collider.shape === 'convex' || x.collider.shape === 'mesh'; x.collider = { ...x.collider, shape: v as any, ...(wasGen ? { boxes: undefined, sourceTriangles: undefined } : {}) }; });
          }} />
      </Row>
      {generated ? <>
        <Row label="Generated"><span className="dim">{busy ? 'Generating…' : c.boxes?.length ? `${c.boxes.length} boxes from ${c.sourceTriangles?.toLocaleString() ?? '?'} triangles` : 'Not generated yet'}</span></Row>
        <Row label="Detail" tip="Cells along the longest side. Higher follows the model closer but costs more"><Slider value={c.detail ?? 16} min={4} max={64} step={1} onChange={(v) => up('Collider detail', (x) => { x.collider = { ...x.collider, detail: v }; }, 'cdet')} /></Row>
        <Row label=""><button className="btn small" disabled={busy} onClick={() => generate(c.shape as 'convex' | 'mesh')}>Regenerate from model</button></Row>
      </> : <>
        <Row label="Size"><Vec3 v={c.size} onChange={(v) => up('Collider size', (x) => { x.collider = { ...x.collider, size: v }; }, 'csize')} /></Row>
        <Row label="Offset"><Vec3 v={c.offset} onChange={(v) => up('Collider offset', (x) => { x.collider = { ...x.collider, offset: v }; }, 'coff')} /></Row>
        {!!c.boxes?.length && <Row label="Compound"><span className="dim">{c.boxes.length} boxes (used instead of the size)</span></Row>}
      </>}
      {notes.map((n, k) => <div key={k} className="hint warn"><Icon name="alert-triangle" size={12} /> {n}</div>)}
      <Row label="Layer" tip="What this object is, for the collision mask"><Select value={String(c.layer ?? 0)} options={COLLISION_LAYERS.map((_, n) => String(n))} labels={Object.fromEntries(COLLISION_LAYERS.map((l, n) => [String(n), l]))} onChange={(v) => up('Collision layer', (x) => { x.collider = { ...x.collider, layer: Number(v) }; })} /></Row>
      <Row label="Collides with" tip="Layers this object collides with (both objects must allow it)">
        <span className="mask-row">{COLLISION_LAYERS.map((l, n) => (
          <button key={l} className={'chip' + (mask & (1 << n) ? ' on' : '')} title={l} onClick={() => up('Collision mask', (x) => { x.collider = { ...x.collider, mask: (x.collider.mask ?? 0xff) ^ (1 << n) }; })}>{l}</button>
        ))}</span>
      </Row>
      <Row label="Show in viewport"><Check value={!!i.editor?.showCollider} onChange={(v) => up('Show collider', (x) => { x.editor = { ...(x.editor ?? {}), showCollider: v }; })} /></Row>
    </Section>
  );
}

const ROLE_LABELS: Record<ChainRole, string> = { leg: 'Leg (steps, IK)', arm: 'Arm (swings)', head: 'Head (looks)', spine: 'Spine / body (slithers on snakes)', tail: 'Tail (sways)', tentacle: 'Tentacle (curls, trails)', ignore: 'Not animated' };

/**
 * Procedural Animation's bone mapping: the bone chains read from the model's skeleton and what each one does. Each
 * row starts at the role guessed from the skeleton's shape; changing it stores an override in the behavior.
 */
function ProcBoneMapping({ i, props, up }: { i: InstanceData; props: Record<string, any>; up: (label: string, fn: (x: InstanceData) => void, key?: string) => void }) {
  const [, force] = React.useState(0);
  const rig = editorRefs.view?.procRig(i.uid, String(props.rig ?? 'auto'), String(props.boneMap ?? ''));
  // The model loads after the panel opens: look again shortly.
  React.useEffect(() => { if (rig) return; const t = setTimeout(() => force((n) => n + 1), 700); return () => clearTimeout(t); });
  if (!rig) return <Row label="Bone mapping"><span className="dim">{i.kind === 'mesh' ? 'Reading the model…' : 'No skeleton: only Ragdoll (falling over) works here.'}</span></Row>;
  if (!rig.chains.length) return <Row label="Bone mapping"><span className="dim">This model has no bones: only Ragdoll (falling over) works.</span></Row>;
  const map = parseBoneMap(props.boneMap);
  const edit = (fn: (m: Record<string, ChainRole>) => void) => up('Bone mapping', (x) => {
    const bb = x.behaviors.find((y) => y.type === 'procanim'); if (!bb) return;
    const m = parseBoneMap(bb.props.boneMap); fn(m);
    bb.props.boneMap = Object.keys(m).length ? JSON.stringify(m) : '';
  });
  const count = (r: ChainRole) => rig.chains.filter((c) => (map[c.name] ?? c.auto) === r).length;
  const summary = [`${rig.kind}${props.rig === 'auto' || !props.rig ? ' (read from the skeleton)' : ''}`, count('leg') && `${count('leg')} legs`, count('arm') && `${count('arm')} arms`, count('tentacle') && `${count('tentacle')} tentacles`, count('head') && 'head', count('tail') && 'tail'].filter(Boolean).join(' · ');
  return <>
    <Row label="Bone mapping" tip="Each chain of bones (from a branch of the skeleton to a tip) and what it does. Rows start at the guess from the skeleton's shape; pick another role when the guess is wrong."><span className="dim">{summary}</span></Row>
    {rig.chains.map((c) => (
      <Row key={c.name} label={`  ${c.name}${c.bones.length > 1 ? ` (+${c.bones.length - 1})` : ''}`} tip={c.bones.map((b) => b.name).join(' → ')}>
        <Select value={map[c.name] ?? c.auto} options={CHAIN_ROLES} labels={Object.fromEntries(CHAIN_ROLES.map((r) => [r, ROLE_LABELS[r] + (r === c.auto ? ' ✓ auto' : '')]))}
          onChange={(v) => edit((m) => { if (v === c.auto) delete m[c.name]; else m[c.name] = v as ChainRole; })} />
      </Row>
    ))}
    {Object.keys(map).length > 0 && <Row label=""><button className="btn small" onClick={() => edit((m) => { for (const k of Object.keys(m)) delete m[k]; })}>Use the skeleton's guess for every chain</button></Row>}
  </>;
}

/** Model triangles in the object's own space (before scale), turned into collision boxes. */
function generateFromModel(uid: number, mode: 'convex' | 'mesh', detail?: number) {
  const e = editorRefs.view?.entries.get(uid);
  if (!e) throw new Error('The model is not loaded in the viewport yet.');
  e.obj.updateWorldMatrix(true, true);
  const toLocal = e.obj.matrixWorld.clone().invert();
  const pos: number[] = [];
  const v = new THREE.Vector3(), m = new THREE.Matrix4();
  e.visual.traverse((o: any) => {
    if (!o.isMesh || !o.geometry?.attributes?.position) return;
    m.multiplyMatrices(toLocal, o.matrixWorld);
    const p = o.geometry.attributes.position, ix = o.geometry.index;
    const n = ix ? ix.count : p.count;
    for (let k = 0; k < n; k++) { v.fromBufferAttribute(p, ix ? ix.getX(k) : k).applyMatrix4(m); pos.push(v.x, v.y, v.z); }
  });
  const r = generateMeshCollider(pos, { mode, resolution: detail });
  if (!r.boxes.length) throw new Error(r.warnings[0] ?? 'No collision boxes could be made from this model.');
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const b of r.boxes) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], b[k] - b[k + 3] / 2); hi[k] = Math.max(hi[k], b[k] + b[k + 3] / 2); }
  const size = [0, 1, 2].map((k) => Math.round((hi[k] - lo[k]) * 1000) / 1000) as [number, number, number];
  const offset = [0, 1, 2].map((k) => Math.round(((hi[k] + lo[k]) / 2) * 1000) / 1000) as [number, number, number];
  return { ...r, size, offset };
}

function fitCollider(uid: number) {
  const e = editorRefs.view?.entries.get(uid);
  if (!e) return;
  const inv = e.obj.scale.clone();
  const box = new THREE.Box3().setFromObject(e.visual);
  const size = box.getSize(new THREE.Vector3()).divide(new THREE.Vector3(Math.abs(inv.x) || 1, Math.abs(inv.y) || 1, Math.abs(inv.z) || 1));
  const wp = e.obj.getWorldPosition(new THREE.Vector3());
  const c = box.getCenter(new THREE.Vector3()).sub(wp).divide(new THREE.Vector3(inv.x || 1, inv.y || 1, inv.z || 1));
  store.mutate('Fit collider', (p) => { const i = curScene(p).instances.find((x) => x.uid === uid); if (i) i.collider = { ...i.collider, shape: 'box', size: [r(size.x), r(size.y), r(size.z)], offset: [r(c.x), r(c.y), r(c.z)] }; });
}
const r = (n: number) => Math.round(n * 1000) / 1000;
