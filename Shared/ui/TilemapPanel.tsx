// Tilemap panel (both apps): Paint toggle and tools (brush with sizes, eraser, fill, rectangle, select/stamp, picker),
// the tileset palette, layers (visible, collision, opacity, order), auto-tile terrains, and a collision editor for the
// selected tile (draw its collision rectangles). Painting itself happens in the scene view (see tilemapTools.ts).
import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { InstanceData } from '../src/runtime/scene';
import { MASK_NAMES, autotile, footprintPx, fullPoly, isIso, newRule, parseKey, terrainFromBlock3x3, tilePolys, tilesetGrid, type NeighbourCheck, type TilePoly, type TilemapData } from '../src/tilemap';
import { tileTools, type TileTool } from './tilemapTools';
import { fromTiled, toTiled } from '../src/tiled';
import { DEFAULT_ROOMS, ROLE_LABELS, TILE_ROLES, buildTilemap, classifyTiles, generateRooms, roleGroup, type TileRole } from '../src/rooms';

// Colours by group (floors green, walls red, doors orange, decoration blue, ceilings purple); finer kinds share them.
const GROUP_COLOR: Record<string, string> = { floor: '#3fd17a', wall: '#e5484d', door: '#f5a524', decor: '#4c97ff', ceiling: '#a77bff', none: '#777777' };
const ROLE_COLOR = Object.fromEntries(TILE_ROLES.map((r) => [r, GROUP_COLOR[roleGroup(r)]])) as Record<TileRole, string>;
/** Short marks drawn on tiles in the Tile roles view. */
const ROLE_MARK: Partial<Record<TileRole, string>> = { 'wall-top': 'T', 'wall-bottom': 'B', 'wall-left': 'L', 'wall-right': 'R', 'outer-corner': 'OC', 'inner-corner': 'IC', window: 'Wi', pillar: 'P', 'door-frame': 'DF', entrance: 'En', exit: 'Ex', platform: 'Pl', stairs: 'St', ceiling: 'C', treasure: '$' };

export interface TilemapPanelProps {
  inst: InstanceData;
  tilesetUrl: string | null;
  tilesets: { id: string; name: string }[];
  /** Change the map (one undoable edit; `key` merges repeated edits). The host re-syncs the collider. */
  onChange: (label: string, fn: (map: TilemapData) => void, key?: string) => void;
  onImportTileset?: (f: File) => Promise<string>;
}

const TOOLS: [TileTool, string, string][] = [['brush', 'Brush', 'B'], ['erase', 'Eraser', 'E'], ['fill', 'Fill', 'G'], ['rect', 'Rectangle', 'R'], ['select', 'Select (copy a stamp)', 'S'], ['pick', 'Pick a tile from the map', 'I']];

function useImage(url: string | null) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  useEffect(() => { if (!url) { setImg(null); return; } const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => setImg(i); i.src = url; }, [url]);
  return img;
}

export function TilemapPanel({ inst, tilesetUrl, tilesets, onChange, onImportTileset }: TilemapPanelProps) {
  const map = inst.tilemap!;
  const s = useSyncExternalStore(tileTools.subscribe, tileTools.get);
  const img = useImage(tilesetUrl);
  const grid = img ? tilesetGrid(map, img.naturalWidth, img.naturalHeight) : null;
  const pal = useRef<HTMLCanvasElement>(null);
  const zoom = img ? Math.max(1, Math.min(4, Math.floor(260 / img.naturalWidth) || 1)) : 1;
  // Tileset modes (like Godot's TileSet editor): Select a tile to paint with / edit its collision, or Paint a
  // collision shape onto many tiles by clicking or dragging over them in the atlas.
  const [mode, setMode] = useState<'select' | 'paint' | 'roles'>('select');
  /** Tile roles mode: the role clicked tiles get (procedural rooms). */
  const [roleBrush, setRoleBrush] = useState<TileRole>('floor');
  const [roleTile, setRoleTile] = useState(-1);
  const [rooms, setRooms] = useState({ ...DEFAULT_ROOMS, decor: 0.15 });
  const [brushPoly, setBrushPoly] = useState<TilePoly | null>(null);
  const painting = useRef(false);
  const fp = footprintPx(map);
  /** A tile's collision polygon point (footprint units) -> pixels in its texture region. */
  const toRegion = (u: number, v: number): [number, number] => isIso(map) ? [(map.tileW - fp.gw) / 2 + u * fp.gw, (map.texOffsetY ?? 0) + v * fp.gh] : [u * map.tileW, v * map.tileH];
  // Draw the palette: the tileset, the selected tile, and every tile's collision polygons.
  useEffect(() => {
    const c = pal.current; if (!c || !img || !grid) return;
    c.width = img.naturalWidth * zoom; c.height = img.naturalHeight * zoom;
    const g = c.getContext('2d')!; g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
    for (let t = 0; t < grid.count; t++) {
      const p = grid.src(t), x = p.x * zoom, y = p.y * zoom, w = map.tileW * zoom, h = map.tileH * zoom;
      const polys = tilePolys(map, t);
      if ((s.showCollision || mode === 'paint') && polys) {
        g.fillStyle = 'rgba(64,170,255,.45)'; g.strokeStyle = 'rgba(64,170,255,.95)';
        for (const poly of polys) { g.beginPath(); poly.forEach(([u, v], k) => { const [rx, ry] = toRegion(u, v); if (k) g.lineTo(x + rx * zoom, y + ry * zoom); else g.moveTo(x + rx * zoom, y + ry * zoom); }); g.closePath(); g.fill(); g.stroke(); }
      }
      if (t === s.tile && mode === 'select') { g.strokeStyle = '#ffd200'; g.lineWidth = 2; g.strokeRect(x + 1, y + 1, w - 2, h - 2); g.lineWidth = 1; }
      // Tile roles: tinted by role with its first letter.
      const role = map.roles?.[t];
      if (mode === 'roles' && role && role !== 'none') {
        g.fillStyle = ROLE_COLOR[role] + '55'; g.fillRect(x, y, w, h);
        g.strokeStyle = ROLE_COLOR[role]; g.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
        g.fillStyle = '#fff'; g.font = `bold ${Math.max(9, Math.min(14, w / 3))}px system-ui`; g.fillText(ROLE_MARK[role] ?? role[0].toUpperCase(), x + 2, y + Math.max(10, Math.min(15, w / 3)));
      }
      if (mode === 'roles' && t === roleTile) { g.strokeStyle = '#ffd200'; g.lineWidth = 2; g.strokeRect(x + 1, y + 1, w - 2, h - 2); g.lineWidth = 1; }
    }
  }, [img, zoom, s.tile, s.showCollision, mode, roleTile, map.tileW, map.tileH, map.spacing, map.margin, map.shape, map.gridW, map.gridH, map.texOffsetY, JSON.stringify(map.shapes), JSON.stringify(map.polys), JSON.stringify(map.roles)]);
  /** Tile roles: give a tile the brush's role (right button: none); the last one clicked shows its own settings. */
  const paintRole = (t: number, clear: boolean) => { if (t >= 0) { setRoleTile(t); onChange('Tile role', (m) => { (m.roles ??= {})[t] = clear ? 'none' : roleBrush; }, 'role'); } };
  const tileInfo = roleTile >= 0 ? map.tileInfo?.[roleTile] ?? {} : null;
  const setInfo = (patch: Record<string, unknown>) => roleTile >= 0 && onChange('Tile settings', (m) => { m.tileInfo = { ...(m.tileInfo ?? {}), [roleTile]: { ...(m.tileInfo?.[roleTile] ?? {}), ...patch } }; });
  /** Guess every tile's role from its picture. */
  const guessRoles = () => {
    if (!img || !grid) return;
    const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
    const g = c.getContext('2d', { willReadFrequently: true })!; g.drawImage(img, 0, 0);
    const roles = classifyTiles(g.getImageData(0, 0, c.width, c.height).data, c.width, map, grid.cols, grid.rows);
    onChange('Guess tile roles', (m) => { m.roles = roles; });
  };
  const generate = () => onChange('Generate rooms', (m) => { buildTilemap(m, generateRooms(rooms), m.roles, rooms.seed, rooms.decor); });
  const roleCount = (r: TileRole) => Object.values(map.roles ?? {}).filter((x) => x === r).length;
  const tileAt = (e: React.MouseEvent) => {
    if (!grid || !img) return -1;
    const r = (e.target as HTMLCanvasElement).getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * img.naturalWidth, py = ((e.clientY - r.top) / r.height) * img.naturalHeight;
    const col = Math.floor((px - (map.margin ?? 0)) / (map.tileW + (map.spacing ?? 0))), row = Math.floor((py - (map.margin ?? 0)) / (map.tileH + (map.spacing ?? 0)));
    return col < 0 || row < 0 || col >= grid.cols || row >= grid.rows ? -1 : row * grid.cols + col;
  };
  /** Paint properties: give a tile the brush's collision (right button: no collision). */
  const paintProp = (t: number, clear: boolean) => {
    if (t < 0) return;
    onChange('Paint tile collision', (m) => { (m.polys ??= {})[t] = clear ? [] : [brushPoly ?? fullPoly(m)]; }, 'paintprop');
  };
  const palDown = (e: React.MouseEvent) => {
    const t = tileAt(e); if (t < 0) return;
    if (mode === 'paint') { e.preventDefault(); painting.current = true; paintProp(t, e.button === 2); return; }
    if (mode === 'roles') { e.preventDefault(); painting.current = true; paintRole(t, e.button === 2); return; }
    tileTools.set({ tile: t, stamp: null, tool: s.tool === 'erase' || s.tool === 'pick' || s.tool === 'select' ? 'brush' : s.tool, active: true });
  };
  const num = (label: string, v: number, on: (n: number) => void, step = 1, min = 0) => <label className="tm-num"><span>{label}</span><input className="lx-input" type="number" step={step} min={min} value={v} onChange={(e) => on(Number(e.target.value))} /></label>;
  const layerCount = map.layers.length;
  return (
    <div className="tm-panel">
      <div className="tm-row">
        <button className={'lx-btn' + (s.active ? ' primary' : '')} onClick={() => tileTools.set({ active: !s.active })} title="Paint tiles directly in the scene">{s.active ? 'Painting…' : 'Paint'}</button>
        <span className="tm-tools">{TOOLS.map(([t, name, k]) => <button key={t} className={'lx-btn' + (s.tool === t ? ' primary' : '')} title={`${name} (${k})`} onClick={() => tileTools.set({ tool: t, active: true, drag: null })}>{name.split(' ')[0]}</button>)}</span>
      </div>
      <div className="tm-row">
        <span className="lx-doc">Brush size</span>{[1, 2, 3, 4, 5].map((n) => <button key={n} className={'lx-btn' + (s.size === n ? ' primary' : '')} onClick={() => tileTools.set({ size: n })}>{n}</button>)}
        <label className="tm-chk"><input type="checkbox" checked={s.showCollision} onChange={(e) => tileTools.set({ showCollision: e.target.checked })} /> show collision</label>
      </div>
      {s.stamp && <div className="tm-row lx-doc">Stamp {s.stamp.w}×{s.stamp.h} ready: the brush paints it. <button className="lx-btn" onClick={() => tileTools.set({ stamp: null })}>Clear stamp</button></div>}

      <div className="tm-h">Tileset</div>
      <div className="tm-row">
        <select className="lx-input" value={map.tileset} onChange={(e) => onChange('Tileset', (m) => { m.tileset = e.target.value; })}>
          {!tilesets.some((t) => t.id === map.tileset) && <option value={map.tileset}>{map.tileset || '(choose an image)'}</option>}
          {tilesets.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        {onImportTileset && <label className="lx-btn">Import…<input type="file" accept=".png,.jpg,.jpeg,.webp,.gif" hidden onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) { const id = await onImportTileset(f); onChange('Tileset', (m) => { m.tileset = id; }); } }} /></label>}
      </div>
      <div className="tm-row tm-nums">
        {num('Tile W', map.tileW, (n) => onChange('Tile size', (m) => { m.tileW = Math.max(1, n); }, 'tw'))}
        {num('Tile H', map.tileH, (n) => onChange('Tile size', (m) => { m.tileH = Math.max(1, n); }, 'th'))}
        {num('Spacing', map.spacing ?? 0, (n) => onChange('Tile spacing', (m) => { m.spacing = n; }, 'tsp'))}
        {num('Margin', map.margin ?? 0, (n) => onChange('Tile margin', (m) => { m.margin = n; }, 'tmg'))}
        {num('Cell (m)', map.cell, (n) => onChange('Cell size', (m) => { m.cell = Math.max(0.05, n); }, 'tcell'), 0.25, 0.05)}
      </div>
      <div className="tm-row">
        {onImportTileset && <label className="lx-btn" title="A Tiled map exported as JSON (.tmj) with its tileset embedded: pick the .tmj and its tileset picture together">Import Tiled map…<input type="file" multiple accept=".tmj,.json,.png,.jpg,.jpeg,.webp,.gif" hidden onChange={async (e) => {
          const files = [...(e.target.files ?? [])]; e.target.value = '';
          try {
            const jf = files.find((f) => /\.(tmj|json)$/i.test(f.name)); if (!jf) throw new Error('choose the .tmj file (and its tileset picture)');
            const r = fromTiled(JSON.parse(await jf.text()));
            const pic = files.find((f) => f.name.toLowerCase() === r.image.toLowerCase()) ?? files.find((f) => /\.(png|jpe?g|webp|gif)$/i.test(f.name));
            if (!pic) throw new Error(`also choose the tileset picture "${r.image}" (select both files together)`);
            const id = await onImportTileset(pic);
            onChange('Import Tiled map', (m) => { for (const k of Object.keys(m)) delete (m as any)[k]; Object.assign(m, r.map, { tileset: id }); });
            if (r.warnings.length) window.alert('Imported, with notes:\n' + r.warnings.join('\n'));
          } catch (err: any) { window.alert('Could not import the Tiled map: ' + (err?.message ?? err)); }
        }} /></label>}
        <button className="lx-btn" disabled={!img} title="Save as a Tiled map (.tmj) next to a copy of the tileset picture" onClick={() => {
          if (!img) return;
          const name = (tilesets.find((t) => t.id === map.tileset)?.name ?? (map.tileset.split(/[\\/:]/).pop() || 'tileset')).replace(/\.[^.]+$/, '') + '.png';
          const json = JSON.stringify(toTiled(map, name, [img.naturalWidth, img.naturalHeight]), null, 1);
          const save = (blob: Blob, file: string) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = file; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); };
          save(new Blob([json], { type: 'application/json' }), (inst.name || 'map').replace(/[^A-Za-z0-9_-]+/g, '_') + '.tmj');
          const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight; c.getContext('2d')!.drawImage(img, 0, 0);
          c.toBlob((b) => b && save(b, name), 'image/png');
        }}>Export to Tiled</button>
      </div>
      <div className="tm-row tm-nums">
        <label className="tm-num"><span>Tile shape</span><select className="lx-input" value={map.shape ?? 'square'} onChange={(e) => onChange('Tile shape', (m) => { m.shape = e.target.value as any; if (m.shape === 'isometric') { m.gridW ??= m.tileW; m.gridH ??= Math.max(1, Math.round(m.tileW / 2)); } })}>
          <option value="square">Square</option><option value="isometric">Isometric</option></select></label>
        {isIso(map) && <label className="tm-num"><span>Layout</span><select className="lx-input" value={map.layout ?? 'diamond'} onChange={(e) => onChange('Tile layout', (m) => { m.layout = e.target.value as any; })}>
          <option value="diamond">Diamond</option><option value="stacked">Stacked</option></select></label>}
        {num('Grid W', fp.gw, (n) => onChange('Tile size', (m) => { m.gridW = Math.max(1, n); }, 'gw'))}
        {num('Grid H', fp.gh, (n) => onChange('Tile size', (m) => { m.gridH = Math.max(1, n); }, 'gh'))}
        {isIso(map) && num('Raise (px)', map.texOffsetY ?? 0, (n) => onChange('Texture offset', (m) => { m.texOffsetY = n; }, 'toy'), 1, -256)}
      </div>
      <div className="lx-doc">Grid W × H is the cell's footprint (Godot's "tile size", e.g. 16×8 for isometric); Tile W × H is the picture of a tile in the image. Raise lifts tall tiles (cubes, walls) so their top face sits on the cell.</div>
      {img && <div className="tm-row">
        <span className="tm-tools">
          <button className={'lx-btn' + (mode === 'select' ? ' primary' : '')} title="Click a tile to paint with it and to edit its collision below" onClick={() => setMode('select')}>Select</button>
          <button className={'lx-btn' + (mode === 'paint' ? ' primary' : '')} title="Paint properties: click or drag over tiles to give them the collision shape below (right-click: none)" onClick={() => setMode('paint')}>Paint properties</button>
          <button className={'lx-btn' + (mode === 'roles' ? ' primary' : '')} title="Tile roles for procedural rooms: which tiles are floors, walls, doors and decoration" onClick={() => setMode('roles')}>Tile roles</button>
        </span>
        {mode === 'paint' && <span className="lx-doc">Physics layer 0: drag over tiles to apply the shape; right-click removes collision.</span>}
      </div>}
      {img && mode === 'roles' && <div className="tm-row">
        <span className="tm-tools">{TILE_ROLES.slice(0, 5).map((r) => <button key={r} className={'lx-btn' + (roleBrush === r ? ' primary' : '')} style={{ borderColor: ROLE_COLOR[r] }} onClick={() => setRoleBrush(r)}>{ROLE_LABELS[r]} {roleCount(r) ? `(${roleCount(r)})` : ''}</button>)}</span>
        <select className="lx-input" title="Finer kinds: the room builder uses them where they fit (a top edge along the top of a room, inner corners, the exit…) and falls back to plain walls / floors / doors" value={TILE_ROLES.indexOf(roleBrush) >= 5 ? roleBrush : ''} onChange={(e) => e.target.value && setRoleBrush(e.target.value as TileRole)}>
          <option value="">More kinds…</option>
          {TILE_ROLES.slice(5).map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}{roleCount(r) ? ` (${roleCount(r)})` : ''}</option>)}
        </select>
        <button className="lx-btn" title="Look at every tile's picture: transparent ones are skipped, see-through ones are decoration, darker or busier ones walls, the rest floors (isometric: flat diamonds are floors, raised blocks walls). Then click tiles to correct it." onClick={guessRoles}>Guess roles</button>
        <span className="lx-doc">Click or drag over tiles to give them the role; right-click: none.</span>
      </div>}
      {img && mode === 'roles' && tileInfo && <div className="tm-row tm-nums">
        <span className="lx-doc">Tile {roleTile}: <b>{ROLE_LABELS[map.roles?.[roleTile] ?? 'none']}</b></span>
        {!isIso(map) && <label className="tm-num" title="Draw this tile turned (one corner piece can serve all four corners)"><span>Rotation</span><select className="lx-input" value={tileInfo.rotation ?? 0} onChange={(e) => setInfo({ rotation: Number(e.target.value) })}><option value={0}>0°</option><option value={90}>90°</option><option value={180}>180°</option><option value={270}>270°</option></select></label>}
        <label className="tm-num" title="Auto: walls are solid, the rest walk-through. Solid / None override it when rooms are built"><span>Collision</span><select className="lx-input" value={tileInfo.collision ?? 'auto'} onChange={(e) => setInfo({ collision: e.target.value })}><option value="auto">Auto (by role)</option><option value="solid">Solid</option><option value="none">Walk-through</option></select></label>
      </div>}
      {img ? <div className="tm-palette"><canvas ref={pal} onMouseDown={palDown} onMouseMove={(e) => { if (painting.current && e.buttons) (mode === 'roles' ? paintRole : paintProp)(tileAt(e), (e.buttons & 2) !== 0); }} onMouseUp={() => { painting.current = false; }} onMouseLeave={() => { painting.current = false; }} onContextMenu={(e) => { if (mode !== 'select') e.preventDefault(); }} style={{ width: img.naturalWidth * zoom }} /></div> : <div className="lx-doc">Choose or import a tileset image (a grid of tiles).</div>}

      <div className="tm-h">Procedural rooms</div>
      <div className="lx-doc">Paints a dungeon (rooms and corridors, or a cave) with the tile roles: floors on a Floor layer, walls on a solid Walls layer, decoration on Decor. The same seed always gives the same rooms; the Generate rooms block does it while playing.</div>
      <div className="tm-row tm-nums">
        {num('Seed', rooms.seed, (n) => setRooms({ ...rooms, seed: Math.round(n) }))}
        <button className="lx-btn" title="A new random seed" onClick={() => setRooms({ ...rooms, seed: 1 + Math.floor(Math.random() * 99999) })}>🎲</button>
        {num('Rooms', rooms.rooms, (n) => setRooms({ ...rooms, rooms: Math.max(1, Math.round(n)) }))}
        {num('Width', rooms.width, (n) => setRooms({ ...rooms, width: Math.max(8, Math.round(n)) }))}
        {num('Height', rooms.height, (n) => setRooms({ ...rooms, height: Math.max(8, Math.round(n)) }))}
        <label className="tm-num"><span>Style</span><select className="lx-input" value={rooms.style} onChange={(e) => setRooms({ ...rooms, style: e.target.value as any })}><option value="rooms">Rooms</option><option value="cave">Cave</option></select></label>
        {num('Decor', rooms.decor, (n) => setRooms({ ...rooms, decor: Math.max(0, Math.min(1, n)) }), 0.05)}
        {num('Treasure', rooms.treasure ?? 0.2, (n) => setRooms({ ...rooms, treasure: Math.max(0, Math.min(1, n)) }), 0.05)}
        {num('Corridor', rooms.corridor, (n) => setRooms({ ...rooms, corridor: Math.max(1, Math.min(3, Math.round(n))) }))}
        {num('Room min', rooms.minRoom, (n) => setRooms({ ...rooms, minRoom: Math.max(2, Math.round(n)) }))}
        {num('Room max', rooms.maxRoom, (n) => setRooms({ ...rooms, maxRoom: Math.max(rooms.minRoom, Math.round(n)) }))}
      </div>
      <div className="lx-doc">Treasure: the chance a room gets a treasure tile (role Treasure, or decoration). Enemies are objects: add them while playing with the Populate rooms block.</div>
      <div className="tm-row">
        <button className="lx-btn primary" disabled={!Object.values(map.roles ?? {}).some((r) => roleGroup(r) === 'floor')} title={roleCount('floor') ? 'Replace the Floor, Walls and Decor layers with new rooms' : 'Give some tiles the floor role first (Tile roles)'} onClick={generate}>Generate rooms</button>
        {!roleCount('floor') && <span className="lx-doc">Set tile roles first (Tile roles › Guess roles).</span>}
      </div>

      <div className="tm-h">Layers</div>
      {map.layers.map((l, k) => (
        <div key={k} className={'tm-layer' + (s.layer === k ? ' on' : '')} onClick={() => tileTools.set({ layer: k })}>
          <input className="tm-name" value={l.name} onChange={(e) => onChange('Rename layer', (m) => { m.layers[k].name = e.target.value; }, 'ln' + k)} onKeyDown={(e) => e.stopPropagation()} />
          <label title="Visible"><input type="checkbox" checked={l.visible} onChange={(e) => onChange('Layer visibility', (m) => { m.layers[k].visible = e.target.checked; })} /> show</label>
          <label title="Characters collide with this layer's tiles"><input type="checkbox" checked={l.collision} onChange={(e) => onChange('Layer collision', (m) => { m.layers[k].collision = e.target.checked; })} /> solid</label>
          <input type="range" min={0.1} max={1} step={0.05} value={l.opacity ?? 1} title="Opacity" onChange={(e) => onChange('Layer opacity', (m) => { m.layers[k].opacity = Number(e.target.value); }, 'lo' + k)} />
          <button className="lx-btn" disabled={k === 0} title="Move down (drawn earlier)" onClick={(e) => { e.stopPropagation(); onChange('Reorder layers', (m) => { [m.layers[k - 1], m.layers[k]] = [m.layers[k], m.layers[k - 1]]; }); }}>↑</button>
          <button className="lx-btn" disabled={layerCount < 2} title="Delete layer" onClick={(e) => { e.stopPropagation(); if (window.confirm(`Delete layer "${l.name}"?`)) { onChange('Delete layer', (m) => { m.layers.splice(k, 1); }); tileTools.set({ layer: 0 }); } }}>✕</button>
        </div>
      ))}
      <button className="lx-btn" onClick={() => onChange('Add layer', (m) => { m.layers.push({ name: `Layer ${m.layers.length + 1}`, visible: true, collision: false, cells: {} }); })}>+ Layer</button>

      <div className="tm-h">Auto-tiling</div>
      <div className="lx-doc">A terrain picks corner, edge, centre and end tiles from the neighbours while you paint.</div>
      <div className="tm-row">
        <select className="lx-input" value={s.terrain} onChange={(e) => tileTools.set({ terrain: Number(e.target.value) })}>
          <option value={-1}>Off (paint single tiles)</option>
          {(map.terrains ?? []).map((t, k) => <option key={k} value={k}>{t.name}</option>)}
        </select>
        <button className="lx-btn" disabled={!grid} title="The selected tile is the TOP-LEFT of a 3x3 block: corners, edges and the centre" onClick={() => {
          const name = window.prompt('Terrain name', `Terrain ${(map.terrains?.length ?? 0) + 1}`); if (!name || !grid) return;
          onChange('New terrain', (m) => { (m.terrains ??= []).push(terrainFromBlock3x3(name, s.tile, grid.cols)); });
          tileTools.set({ terrain: map.terrains?.length ?? 0 });
        }}>New from 3×3 block</button>
        <button className="lx-btn" title="An empty terrain you fill with your own connection rules" onClick={() => {
          const name = window.prompt('Terrain name', `Terrain ${(map.terrains?.length ?? 0) + 1}`); if (!name) return;
          onChange('New terrain', (m) => { (m.terrains ??= []).push({ name, tiles: Array(16).fill(-1), rules: [newRule(s.tile)] }); });
          tileTools.set({ terrain: map.terrains?.length ?? 0 });
        }}>New with rules</button>
      </div>
      {s.terrain >= 0 && map.terrains?.[s.terrain] && grid && (
        <div className="tm-masks">{MASK_NAMES.map((n, mask) => (
          <button key={mask} className="tm-mask" title={`${n}: click to use the selected tile`} onClick={() => onChange('Terrain tile', (m) => { m.terrains![s.terrain].tiles[mask] = s.tile; })}>
            <TileThumb img={img} map={map} tile={map.terrains![s.terrain].tiles[mask]} /><span>{n}</span>
          </button>
        ))}</div>
      )}
      {s.terrain >= 0 && map.terrains?.[s.terrain] && grid && <RuleList img={img} map={map} terrain={s.terrain} tile={s.tile} layer={s.layer} onChange={onChange} />}

      {mode === 'paint'
        ? <><div className="tm-h">Collision shape to paint</div>
          <PolyEditor img={img} map={map} tile={s.tile} polys={brushPoly ? [brushPoly] : null} onChange={(p) => setBrushPoly(p?.[0] ?? null)} /></>
        : <><div className="tm-h">Tile collision (tile {s.tile})</div>
          <PolyEditor img={img} map={map} tile={s.tile} polys={tilePolys(map, s.tile)} onChange={(p) => onChange('Tile collision', (m) => { m.polys ??= {}; if (p) m.polys[s.tile] = p; else delete m.polys[s.tile]; if (m.shapes) delete m.shapes[s.tile]; }, 'tcoll' + s.tile)} /></>}
    </div>
  );
}

/**
 * Collision polygon editor (like Godot's): the tile is shown large with its polygon. Drag a corner to move it,
 * double-click to add a corner on the nearest edge, right-click a corner to remove it. Full = the whole footprint
 * (diamond on isometric maps); None = no collision. Snaps to 1/16 of the footprint.
 */
function PolyEditor({ img, map, tile, polys, onChange }: { img: HTMLImageElement | null; map: TilemapData; tile: number; polys: TilePoly[] | null; onChange: (p: TilePoly[] | null) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [drag, setDrag] = useState<{ poly: number; pt: number } | null>(null);
  const shown = polys ?? [fullPoly(map)];
  const S = 160, fp = footprintPx(map), iso = isIso(map);
  // The tile's region scaled into the canvas; the footprint inside it.
  const k = Math.min((S - 16) / map.tileW, (S - 16) / map.tileH), ox = (S - map.tileW * k) / 2, oy = (S - map.tileH * k) / 2;
  const fx0 = iso ? (map.tileW - fp.gw) / 2 : 0, fy0 = iso ? (map.texOffsetY ?? 0) : 0, fw = iso ? fp.gw : map.tileW, fh = iso ? fp.gh : map.tileH;
  const toPx = (u: number, v: number): [number, number] => [ox + (fx0 + u * fw) * k, oy + (fy0 + v * fh) * k];
  const fromPx = (x: number, y: number): [number, number] => { const q = (n: number) => Math.round(n * 16) / 16; return [q(((x - ox) / k - fx0) / fw), q(((y - oy) / k - fy0) / fh)]; };
  useEffect(() => {
    const c = ref.current; if (!c) return; const g = c.getContext('2d')!;
    g.clearRect(0, 0, S, S); g.imageSmoothingEnabled = false;
    for (let y = 0; y < S; y += 10) for (let x = 0; x < S; x += 10) { g.fillStyle = (x + y) % 20 ? '#2a2f38' : '#323843'; g.fillRect(x, y, 10, 10); }
    if (img && tile >= 0) { const p = tilesetGrid(map, img.naturalWidth, img.naturalHeight).src(tile); g.drawImage(img, p.x, p.y, map.tileW, map.tileH, ox, oy, map.tileW * k, map.tileH * k); }
    // Footprint outline.
    g.strokeStyle = 'rgba(255,255,255,.35)'; g.setLineDash([3, 3]); g.beginPath();
    fullPoly(map).forEach(([u, v], n) => { const [x, y] = toPx(u, v); if (n) g.lineTo(x, y); else g.moveTo(x, y); }); g.closePath(); g.stroke(); g.setLineDash([]);
    if (polys && !polys.length) return;
    for (const poly of shown) {
      g.fillStyle = 'rgba(64,170,255,.4)'; g.strokeStyle = '#40aaff'; g.lineWidth = 1.5; g.beginPath();
      poly.forEach(([u, v], n) => { const [x, y] = toPx(u, v); if (n) g.lineTo(x, y); else g.moveTo(x, y); }); g.closePath(); g.fill(); g.stroke();
      for (const [u, v] of poly) { const [x, y] = toPx(u, v); g.fillStyle = '#fff'; g.beginPath(); g.moveTo(x, y - 5); g.lineTo(x + 5, y); g.lineTo(x, y + 5); g.lineTo(x - 5, y); g.closePath(); g.fill(); }
    }
  }, [img, tile, JSON.stringify(polys), map.tileW, map.tileH, map.shape, map.gridW, map.gridH, map.texOffsetY]);
  const at = (e: React.MouseEvent) => { const r = ref.current!.getBoundingClientRect(); return [((e.clientX - r.left) / r.width) * S, ((e.clientY - r.top) / r.height) * S] as const; };
  const hit = (x: number, y: number) => { for (let a = 0; a < shown.length; a++) for (let b = 0; b < shown[a].length; b++) { const [px, py] = toPx(...shown[a][b]); if (Math.hypot(px - x, py - y) < 8) return { poly: a, pt: b }; } return null; };
  const edit = (fn: (ps: TilePoly[]) => void) => { const ps = shown.map((p) => p.map((q) => [...q] as [number, number])); fn(ps); onChange(ps); };
  return (
    <div className="tm-row tm-coll">
      <canvas ref={ref} width={S} height={S} style={{ cursor: drag ? 'grabbing' : 'crosshair' }}
        onMouseDown={(e) => { const [x, y] = at(e); const h = hit(x, y); if (!h) return; if (e.button === 2) { edit((ps) => { if (ps[h.poly].length > 3) ps[h.poly].splice(h.pt, 1); }); return; } setDrag(h); }}
        onMouseMove={(e) => { if (!drag) return; const [x, y] = at(e); const p = fromPx(x, y); edit((ps) => { ps[drag.poly][drag.pt] = p; }); }}
        onMouseUp={() => setDrag(null)} onMouseLeave={() => setDrag(null)}
        onContextMenu={(e) => e.preventDefault()}
        onDoubleClick={(e) => {
          // Add a corner on the nearest edge.
          const [x, y] = at(e), p = fromPx(x, y);
          let best = { poly: 0, after: 0, d: Infinity };
          shown.forEach((poly, a) => poly.forEach((q, b) => { const [ax, ay] = toPx(...q), [bx, by] = toPx(...poly[(b + 1) % poly.length]); const t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2 || 1))); const d = Math.hypot(ax + (bx - ax) * t - x, ay + (by - ay) * t - y); if (d < best.d) best = { poly: a, after: b, d }; }));
          edit((ps) => { ps[best.poly].splice(best.after + 1, 0, p); });
        }} />
      <div className="tm-col">
        <span className="lx-doc">{!polys ? 'Whole tile (default).' : polys.length ? `${polys.length} polygon(s), ${polys.reduce((n, p) => n + p.length, 0)} corners.` : 'No collision.'} Drag corners; double-click adds a corner, right-click removes one.</span>
        <button className="lx-btn" onClick={() => onChange(null)}>Whole tile</button>
        <button className="lx-btn" onClick={() => onChange([])}>No collision</button>
        <button className="lx-btn" onClick={() => onChange([iso ? [[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]] : [[0, 0], [1, 0], [1, 0.5], [0, 0.5]]])}>{iso ? 'Diamond' : 'Top half'}</button>
      </div>
    </div>
  );
}

/**
 * The terrain's own connection rules: a 3×3 pattern per rule (click a neighbour: any → same terrain → not this
 * terrain → the selected tile → any) and the tiles it places (several = a random one per cell). First match wins.
 */
function RuleList({ img, map, terrain, tile, layer, onChange }: { img: HTMLImageElement | null; map: TilemapData; terrain: number; tile: number; layer: number; onChange: TilemapPanelProps['onChange'] }) {
  const rules = map.terrains![terrain].rules ?? [];
  const edit = (label: string, fn: (rs: NonNullable<TilemapData['terrains']>[number]['rules'] & object) => void) => onChange(label, (m) => { const t = m.terrains![terrain]; t.rules ??= []; fn(t.rules); });
  const next = (v: NeighbourCheck): NeighbourCheck => (v === 'any' ? 'same' : v === 'same' ? 'other' : v === 'other' ? tile : 'any');
  // Grid cells in reading order → index into `around` (centre = -1).
  const CELLS = [7, 0, 1, 6, -1, 2, 5, 4, 3];
  const look = (v: NeighbourCheck) => (v === 'any' ? { t: '·', title: 'Any (or empty)' } : v === 'same' ? { t: '■', title: 'This terrain' } : v === 'other' ? { t: '✕', title: 'Not this terrain (empty or another tile)' } : { t: '', title: `Exactly tile ${v}` });
  return (
    <div className="tm-rules">
      <div className="tm-h">Connection rules</div>
      <div className="lx-doc">Your own rules, checked top to bottom before the table above: when the neighbours match the pattern, the cell becomes the rule's tile (several = random per cell). Click a neighbour to cycle: · any, ■ this terrain, ✕ not this terrain, then the selected tile.</div>
      {rules.map((rule, k) => (
        <div key={k} className="tm-rule" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', padding: '6px 0', borderTop: '1px solid rgba(255,255,255,.12)' }}>
          <div className="tm-rule-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 26px)', gap: 2 }}>
            {CELLS.map((d, n) => d < 0
              ? <div key={n} title="This cell" style={{ width: 26, height: 26, outline: '2px solid #a733f0' }}><TileThumb img={img} map={map} tile={rule.tiles[0] ?? -1} /></div>
              : <button key={n} className="tm-mask" title={look(rule.around[d]).title} style={{ width: 26, height: 26, padding: 0 }} onClick={() => edit('Edit rule', (rs) => { rs[k].around[d] = next(rs[k].around[d]); })}>
                {typeof rule.around[d] === 'number' ? <TileThumb img={img} map={map} tile={rule.around[d] as number} /> : look(rule.around[d]).t}
              </button>)}
          </div>
          <div className="tm-rule-out">
            <span className="dim">Places:</span>
            {rule.tiles.map((t, j) => <button key={j} className="tm-mask" title="Remove this tile" onClick={() => edit('Edit rule', (rs) => { rs[k].tiles.splice(j, 1); })}><TileThumb img={img} map={map} tile={t} /></button>)}
            <button className="lx-btn" title="Add the selected tile (several = random per cell)" onClick={() => edit('Edit rule', (rs) => { if (!rs[k].tiles.includes(tile)) rs[k].tiles.push(tile); })}>+ tile {tile}</button>
          </div>
          <div className="tm-row">
            <button className="lx-btn" disabled={k === 0} title="Check earlier" onClick={() => edit('Move rule', (rs) => { [rs[k - 1], rs[k]] = [rs[k], rs[k - 1]]; })}>↑</button>
            <button className="lx-btn" disabled={k === rules.length - 1} title="Check later" onClick={() => edit('Move rule', (rs) => { [rs[k + 1], rs[k]] = [rs[k], rs[k + 1]]; })}>↓</button>
            <button className="lx-btn" title="Delete rule" onClick={() => edit('Delete rule', (rs) => { rs.splice(k, 1); })}>✕</button>
          </div>
        </div>
      ))}
      <div className="tm-row">
        <button className="lx-btn" onClick={() => edit('Add rule', (rs) => { rs.push(newRule(tile)); })}>+ Rule (places tile {tile})</button>
        <button className="lx-btn" title="Run this terrain's rules over every cell already painted on the current layer" onClick={() => onChange('Apply terrain rules', (m) => { const l = m.layers[Math.min(layer, m.layers.length - 1)]; if (l) autotile(l, m.terrains![terrain], Object.keys(l.cells).map(parseKey)); })}>Re-apply to layer</button>
      </div>
    </div>
  );
}

function TileThumb({ img, map, tile }: { img: HTMLImageElement | null; map: TilemapData; tile: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current; if (!c) return; const g = c.getContext('2d')!; g.clearRect(0, 0, 24, 24);
    if (!img || tile < 0) { g.strokeStyle = '#666'; g.strokeRect(0.5, 0.5, 23, 23); return; }
    const p = tilesetGrid(map, img.naturalWidth, img.naturalHeight).src(tile); g.imageSmoothingEnabled = false; g.drawImage(img, p.x, p.y, map.tileW, map.tileH, 0, 0, 24, 24);
  }, [img, tile, map.tileW, map.tileH]);
  return <canvas ref={ref} width={24} height={24} />;
}
