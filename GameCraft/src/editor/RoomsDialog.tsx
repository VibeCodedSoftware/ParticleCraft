// Procedural rooms in 3D (Add › Procedural rooms…): a seeded dungeon built into the scene as a "Rooms" group of
// floors, walls (facing into the rooms), door frames and decoration. Each piece is a plain box or a model from the
// project or the library; models are suggested by role (a kit's "Floor_*", "Wall_*", "Door_*" models, or by shape).
import React, { useState } from 'react';
import { DEFAULT_LIGHT, makeInstance, nextUid, type InstanceData } from '@shared/src/runtime/scene';
import { behaviorDefaults } from '@shared/src/runtime/behaviors';
import { DEFAULT_ROOMS, classifyModel, generateRooms, pieces3D, roleGroup, type Piece3D, type RoomsOptions } from '@shared/src/rooms';
import { store } from '../project/store';
import type { AssetRef } from '../project/types';
import { curScene, registerAsset } from './actions';
import { useAssets } from './ObjectContextMenu';

type Role = Piece3D['role'];
/** 'box' = a plain box, '' = none, else a model asset id. */
type Choice = string;

interface Settings extends RoomsOptions { cell: number; wallHeight: number; decor: number; ceiling: boolean; pieces: Record<Role, Choice> }
const DEFAULTS: Settings = {
  ...DEFAULT_ROOMS, width: 24, height: 18, rooms: 6, cell: 2, wallHeight: 3, decor: 0.15, ceiling: false, treasure: 0.25, enemies: 0, difficulty: 3,
  pieces: { floor: 'box', wall: 'box', door: '', decor: '', ceiling: 'box', stairs: 'box', entrance: '', treasure: 'box', enemy: '' },
};
const load = (): Settings => { try { const j = JSON.parse(localStorage.getItem('gc.rooms3d') ?? '{}'); return { ...DEFAULTS, ...j, pieces: { ...DEFAULTS.pieces, ...(j.pieces ?? {}) } }; } catch { return DEFAULTS; } };
/** Models that suit a role: a kit's name for it (Stairs_*, Chest_*…), or its group's (a wall corner suits walls). */
const suits = (m: AssetRef, role: Role) => { const r = classifyModel(m.name, m.meta?.size); return r === role || (role !== 'treasure' && role !== 'enemy' && roleGroup(r) === role); };

export function RoomsDialog({ onClose }: { onClose: () => void }) {
  const [st, setSt] = useState<Settings>(load);
  const models = useAssets('model');
  const set = (patch: Partial<Settings>) => setSt((s) => ({ ...s, ...patch }));
  const piece = (role: Role, label: string, canBeNone: boolean) => {
    // Models whose name or shape suggests this role first.
    const fits = models.filter((m) => suits(m, role)), rest = models.filter((m) => !fits.includes(m));
    return <label className="tm-num" style={{ display: 'flex', gap: 6, alignItems: 'center' }}><span style={{ width: 70 }}>{label}</span>
      <select className="lx-input" style={{ flex: 1 }} value={st.pieces[role]} onChange={(e) => set({ pieces: { ...st.pieces, [role]: e.target.value } })}>
        {canBeNone && <option value="">None</option>}
        <option value="box">Plain box</option>
        {fits.length > 0 && <optgroup label={`Looks like a ${role}`}>{fits.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</optgroup>}
        {rest.length > 0 && <optgroup label="Other models">{rest.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</optgroup>}
      </select></label>;
  };
  const num = (label: string, k: keyof Settings, step = 1, min = 0) => <label className="tm-num"><span>{label}</span><input className="lx-input" type="number" step={step} min={min} value={st[k] as number} onChange={(e) => set({ [k]: Number(e.target.value) } as any)} /></label>;
  const build = () => {
    try { localStorage.setItem('gc.rooms3d', JSON.stringify(st)); } catch { /* private window */ }
    const gid = buildRooms3D(st, models);
    store.set({ selection: [gid] });
    onClose();
  };
  return <div className="lx-modal-back" onMouseDown={onClose}>
    <div className="lx-modal" style={{ width: 460 }} onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      <div className="lx-modal-head"><b>Procedural rooms (3D)</b></div>
      <p className="lx-doc">Builds a dungeon into the scene as one "Rooms" group: rooms joined by corridors (or a cave), floors, walls facing into the rooms, door frames and decoration. The same seed always gives the same rooms. To make new rooms while playing, use the Build 3D rooms block.</p>
      <div className="tm-row tm-nums">
        {num('Seed', 'seed')}<button className="lx-btn" title="A new random seed" onClick={() => set({ seed: 1 + Math.floor(Math.random() * 99999) })}>🎲</button>
        {num('Rooms', 'rooms', 1, 1)}{num('Width', 'width', 1, 8)}{num('Height', 'height', 1, 8)}
        <label className="tm-num"><span>Style</span><select className="lx-input" value={st.style} onChange={(e) => set({ style: e.target.value as any })}><option value="rooms">Rooms</option><option value="cave">Cave</option></select></label>
      </div>
      <div className="tm-row tm-nums">{num('Cell (m)', 'cell', 0.25, 0.5)}{num('Wall height', 'wallHeight', 0.25, 0.5)}{num('Corridor', 'corridor', 1, 1)}{num('Decor', 'decor', 0.05)}{num('Room min', 'minRoom', 1, 2)}{num('Room max', 'maxRoom', 1, 2)}</div>
      <div className="tm-row tm-nums">{num('Treasure', 'treasure', 0.05)}{num('Enemies', 'enemies', 0.05)}{num('Difficulty', 'difficulty', 1, 1)}
        <label className="tm-num" title="A ceiling over every walkable cell, at the wall height. Each room then gets a lamp (the roof keeps the sun out)"><span>Ceiling</span><input type="checkbox" checked={st.ceiling} onChange={(e) => set({ ceiling: e.target.checked })} /></label></div>
      <div style={{ display: 'grid', gap: 4, margin: '6px 0' }}>
        {piece('floor', 'Floor', false)}{piece('wall', 'Wall', false)}{piece('door', 'Door frame', true)}{piece('decor', 'Decoration', true)}
        {st.ceiling && piece('ceiling', 'Ceiling', false)}{piece('stairs', 'Exit stairs', true)}{piece('entrance', 'Entrance', true)}
        {piece('treasure', 'Treasure', true)}{piece('enemy', 'Enemy spot', true)}
      </div>
      <p className="lx-doc">Models are scaled to the cell size. Import a kit (floor, wall, door, prop models) in the Assets panel: names like Floor_*, Wall_*, Door_* are recognised, otherwise flat models count as floors and thin tall ones as walls.</p>
      <div className="lx-modal-foot"><button className="lx-btn" onClick={onClose}>Cancel</button><button className="lx-btn primary" onClick={build}>Build rooms</button></div>
    </div>
  </div>;
}

/** Build the rooms into the current scene (one undo step). Returns the group's uid. */
export function buildRooms3D(st: Settings, models: AssetRef[]): number {
  const layout = generateRooms(st);
  const pieces = pieces3D(layout, st.seed, st.decor, { ceiling: st.ceiling });
  const cell = Math.max(0.25, st.cell);
  for (const id of Object.values(st.pieces)) { const a = models.find((m) => m.id === id); if (a) registerAsset(a); }
  let gid = 0;
  store.mutate(`Procedural rooms (seed ${st.seed})`, (p) => {
    const s = curScene(p);
    gid = nextUid(s);
    // Centred on the origin.
    const ox = (-layout.w * cell) / 2, oz = (-layout.h * cell) / 2;
    s.instances.push(makeInstance(gid, 'Rooms', 'empty', { name: 'Rooms', x: 0, y: 0, z: 0, vars: { seed: st.seed } }));
    let uid = gid + 1;
    const solid = () => [{ type: 'solid', props: behaviorDefaults('solid') }];
    for (const pc of pieces) {
      const choice = st.pieces[pc.role];
      if (!choice) continue;
      const x = ox + pc.c * cell, z = oz + pc.r * cell;
      const type = 'Room' + pc.role[0].toUpperCase() + pc.role.slice(1);
      let inst: InstanceData;
      // Doors, entrances and enemy spots don't block; treasure is a small solid chest; the rest are solid.
      const blocks = pc.role !== 'door' && pc.role !== 'entrance' && pc.role !== 'enemy';
      if (choice === 'box') {
        const box = pc.role === 'floor' ? { y: -0.1, sx: cell, sy: 0.2, sz: cell, color: '#8a8478' }
          : pc.role === 'wall' ? { y: st.wallHeight / 2, sx: cell, sy: st.wallHeight, sz: cell, color: '#5d6170' }
          : pc.role === 'door' ? { y: st.wallHeight - 0.25, sx: 0.3, sy: 0.5, sz: cell, color: '#6b4f33' } // a lintel across the passage
          : pc.role === 'ceiling' ? { y: st.wallHeight + 0.1, sx: cell, sy: 0.2, sz: cell, color: '#6e6a63' }
          : pc.role === 'stairs' ? { y: 0.15, sx: cell * 0.8, sy: 0.3, sz: cell * 0.8, color: '#3d3a36' } // a hatch going down: the exit
          : pc.role === 'entrance' ? { y: 0.02, sx: cell * 0.8, sy: 0.04, sz: cell * 0.8, color: '#3fd17a' }
          : pc.role === 'treasure' ? { y: cell * 0.15, sx: cell * 0.35, sy: cell * 0.3, sz: cell * 0.25, color: '#d4a017' }
          : pc.role === 'enemy' ? { y: 0.6, sx: 0.6, sy: 1.2, sz: 0.6, color: '#c0392b' }
          : { y: cell * 0.2, sx: cell * 0.4, sy: cell * 0.4, sz: cell * 0.4, color: '#a0703a' };
        inst = makeInstance(uid, type, 'box', { name: type, x, z, ry: pc.ry, ...box, behaviors: blocks ? solid() : [] });
      } else {
        const a = p.assets.find((m) => m.id === choice);
        const size = a?.meta?.size ?? [1, 1, 1];
        const k = (pc.role === 'treasure' || pc.role === 'enemy' ? cell * 0.5 : cell) / Math.max(0.01, Math.max(Math.abs(size[0]), Math.abs(size[2])));
        inst = makeInstance(uid, type, 'mesh', {
          name: type, x, y: pc.role === 'ceiling' ? st.wallHeight : 0, z, ry: pc.ry, sx: k, sy: k, sz: k, color: '#ffffff', mesh: { asset: choice, rotY: 0 },
          collider: { shape: 'box', size: [size[0], size[1], size[2]], offset: [0, size[1] / 2, 0] }, behaviors: blocks ? solid() : [],
        });
      }
      inst.parent = gid;
      s.instances.push(inst);
      uid++;
    }
    // A roof keeps the sun out: each room gets a lamp under its ceiling (brighter in bigger rooms), else they are black.
    if (st.ceiling) for (const rm of layout.rooms) {
      const size = Math.max(rm.w, rm.h) * cell;
      s.instances.push(makeInstance(uid++, 'RoomLamp', 'light', {
        name: 'RoomLamp', parent: gid, x: ox + rm.cx * cell, y: Math.max(1.5, st.wallHeight - 0.4), z: oz + rm.cy * cell,
        light: { ...DEFAULT_LIGHT, type: 'point', power: Math.round(120 * size), color: '#ffe2b8', castShadow: false, radius: 0.2 },
      }));
    }
  });
  return gid;
}
