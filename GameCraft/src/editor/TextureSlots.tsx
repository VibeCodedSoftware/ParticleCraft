// Material › Textures: one texture per property (Base color, Roughness, Metallic, Normal, Height, AO, Emission, Opacity), each
// with its own tiling, offset, rotation and animation; plus material-wide random tiling.
import React, { useState } from 'react';
import type { InstanceData } from '@shared/src/runtime/scene';
import { MAP_SLOTS, materialSlots, newAnimation, replaceSlotImage, type MapSlot, type TexSlot } from '@shared/src/materialMaps';
import { isWaterSurface } from '@shared/src/runtime/water';
import type { AssetRef } from '../project/types';
import { Check, Num, Row, Select } from './ui';

type Up = (label: string, fn: (x: InstanceData) => void, key?: string) => void;
const mat = (x: InstanceData) => x.material ?? { roughness: 0.6, metalness: 0, emissive: '#000000', emissiveStrength: 0 };

/** Write one slot (moving the old single `map` into slots on first edit). */
function setSlot(x: InstanceData, slot: MapSlot, s: TexSlot | null) {
  const m = mat(x), slots = materialSlots(m);
  if (s) slots[slot] = s; else delete slots[slot];
  x.material = { ...m, map: undefined, maps: slots };
}

/** `only`: one property's texture input (placed under that property), or the material-wide Random tiling rows. */
export function TextureSlots({ i, textures, up, only, rowLabel }: { i: InstanceData; textures: AssetRef[]; up: Up; only?: MapSlot | 'random'; rowLabel?: string }) {
  const slots = materialSlots(i.material);
  const [open, setOpen] = useState<MapSlot | null>(null);
  const opts = ['', ...textures.map((t) => t.id)];
  const labels: Record<string, string> = { '': 'None', ...Object.fromEntries(textures.map((t) => [t.id, t.name])) };
  const rt = i.material?.randomTiling;
  return (
    <>
      {MAP_SLOTS.filter((d) => !only || d.slot === only).map(({ slot, label }) => {
        const s = slots[slot];
        const edit = (name: string, fn: (s: TexSlot) => void, key?: string) => up(`${label} texture: ${name}`, (x) => { const cur = { ...materialSlots(x.material)[slot]! }; fn(cur); setSlot(x, slot, cur); }, key && `tex${slot}${key}`);
        return (
          <React.Fragment key={slot}>
            <Row label={rowLabel ?? (only ? '↳ texture' : label + ' map')} tip={only ? `${label} texture` : undefined}>
              <span className="pair">
                <Select value={s?.asset ?? ''} options={s?.asset && !opts.includes(s.asset) ? [...opts, s.asset] : opts} labels={s?.asset && !labels[s.asset] ? { ...labels, [s.asset]: s.asset.split('/').pop()!.replace(/\.[^.]+$/, '') } : labels} onChange={(v) => up(`${label} texture`, (x) => {
                  // A sprite sheet / GIF import plays its frames by default.
                  const sheet = textures.find((t) => t.id === v)?.meta?.sheet;
                  setSlot(x, slot, v ? replaceSlotImage(materialSlots(x.material)[slot], v, sheet) : null);
                })} />
                {s && <button className={'x' + (open === slot ? ' on' : '')} title="Animation (sprite-sheet / GIF frames, scrolling, spin)" onClick={() => setOpen(open === slot ? null : slot)}>⚙</button>}
              </span>
            </Row>
            {/* UV of every texture, right under it as soon as one is chosen (like Godot's uv_scale / offset). */}
            {s && <div className="tex-slot">
              <Row label="UV scale X / Y" tip="How many times the texture repeats across the surface. 0 = automatic (about every 2 m)"><span className="pair"><Num value={s.tiling[0]} step={0.25} min={0} onChange={(v) => edit('Tiling', (c) => { c.tiling = [Math.max(0, v), c.tiling[1]]; }, 'tx')} /><Num value={s.tiling[1]} step={0.25} min={0} onChange={(v) => edit('Tiling', (c) => { c.tiling = [c.tiling[0], Math.max(0, v)]; }, 'ty')} /></span></Row>
              <Row label="UV offset X / Y" tip="Slides the texture across the surface"><span className="pair"><Num value={s.offset[0]} step={0.05} onChange={(v) => edit('Offset', (c) => { c.offset = [v, c.offset[1]]; }, 'ox')} /><Num value={s.offset[1]} step={0.05} onChange={(v) => edit('Offset', (c) => { c.offset = [c.offset[0], v]; }, 'oy')} /></span></Row>
              <Row label="UV rotation °"><Num value={s.rotation} step={5} onChange={(v) => edit('Rotation', (c) => { c.rotation = v; }, 'rot')} /></Row>
            </div>}
            {s && open === slot && (
              <div className="tex-slot">
                <Row label="Animated" tip="Play sprite-sheet / GIF frames and/or move the texture"><Check value={!!s.animated} onChange={(v) => edit('Animated', (c) => { c.animated = v ? newAnimation() : undefined; })} /></Row>
                {s.animated && <>
                  <Row label="Frames · cols · rows" tip="Frames in the image, laid out in columns × rows (0 or 1 frame = a still image)"><span className="pair"><Num value={s.animated.frames} step={1} min={0} precision={0} onChange={(v) => edit('Frames', (c) => { c.animated = { ...c.animated!, frames: Math.max(0, Math.round(v)) }; }, 'af')} /><Num value={s.animated.cols} step={1} min={1} precision={0} onChange={(v) => edit('Columns', (c) => { c.animated = { ...c.animated!, cols: Math.max(1, Math.round(v)) }; }, 'ac')} /><Num value={s.animated.rows} step={1} min={1} precision={0} onChange={(v) => edit('Rows', (c) => { c.animated = { ...c.animated!, rows: Math.max(1, Math.round(v)) }; }, 'ar')} /></span></Row>
                  <Row label="Frames per second"><Num value={s.animated.fps} step={1} min={0} onChange={(v) => edit('FPS', (c) => { c.animated = { ...c.animated!, fps: Math.max(0, v) }; }, 'afps')} /></Row>
                  <Row label="Scroll X / Y (per s)" tip="Procedural movement: flowing water, lava, conveyor belts"><span className="pair"><Num value={s.animated.scroll[0]} step={0.05} onChange={(v) => edit('Scroll', (c) => { c.animated = { ...c.animated!, scroll: [v, c.animated!.scroll[1]] }; }, 'asx')} /><Num value={s.animated.scroll[1]} step={0.05} onChange={(v) => edit('Scroll', (c) => { c.animated = { ...c.animated!, scroll: [c.animated!.scroll[0], v] }; }, 'asy')} /></span></Row>
                  <Row label="Spin (°/s)"><Num value={s.animated.spin} step={5} onChange={(v) => edit('Spin', (c) => { c.animated = { ...c.animated!, spin: v }; }, 'aspin')} /></Row>
                </>}
              </div>
            )}
          </React.Fragment>
        );
      })}
      {(!only || only === 'random') && (Object.keys(slots).length > 0 || isWaterSurface(i)) && <>
        <Row label="Randomness" tip="Breaks up visible repeats (the same for all this material's textures). Change the seed for a different arrangement"><Check value={!!rt} onChange={(v) => up('Random tiling', (x) => { x.material = { ...mat(x), randomTiling: v ? { seed: 1, amount: 1, mode: 'blend' } : undefined }; })} /></Row>
        {rt && <Row label="Style" tip="Seamless: overlapping randomly turned copies blended smoothly (no seams, no repeats; best for ground, rock, grass, bark). Tiles: each tile turned and shifted (sharp, but tiles may show seams; good for symmetrical patterns)"><Select value={rt.mode ?? 'cells'} options={['blend', 'cells']} labels={{ blend: 'Seamless (blended)', cells: 'Tiles (turned)' }} onChange={(v) => up('Random tiling style', (x) => { x.material = { ...mat(x), randomTiling: { ...rt, mode: v as 'blend' | 'cells' } }; })} /></Row>}
        {rt && <Row label="Seed · amount"><span className="pair"><Num value={rt.seed} step={1} precision={0} onChange={(v) => up('Random tiling seed', (x) => { x.material = { ...mat(x), randomTiling: { ...rt, seed: Math.round(v) } }; }, 'rtseed')} /><Num value={rt.amount} step={0.05} min={0} max={1} onChange={(v) => up('Random tiling shift', (x) => { x.material = { ...mat(x), randomTiling: { ...rt, amount: Math.max(0, Math.min(1, v)) } }; }, 'rtamt')} /></span></Row>}
        {rt && <Row label="Different per object" tip="Every object with this material gets its own arrangement (walls and floors made of many pieces don't repeat each other)"><Check value={!!rt.perObject} onChange={(v) => up('Random tiling per object', (x) => { x.material = { ...mat(x), randomTiling: { ...rt, perObject: v } }; })} /></Row>}
      </>}
    </>
  );
}
