// Tiled (https://www.mapeditor.org) maps in JSON (.tmj / .json): import into a tilemap and export one back.
// Supported: orthogonal, isometric and staggered (rows, odd or even) maps; finite and infinite (chunked) tile
// layers; the first tileset with an image (embedded in the map); each tile's collision rectangles, polygons and
// ellipses (as their box); a layer's "collision" bool property. Flipped tiles keep their tile, unflipped.
import { emptyTilemap, fullPoly, isIso, parseKey, tilePolys, usedBounds, type TilePoly, type TilemapData } from './tilemap';

const GID_MASK = 0x1fffffff; // the top three bits are Tiled's flip flags

export interface TiledImport { map: TilemapData; image: string; imageSize: [number, number]; warnings: string[] }

export function fromTiled(json: any): TiledImport {
  const warnings: string[] = [];
  if (!json || json.type !== 'map' && !Array.isArray(json.layers)) throw new Error('this is not a Tiled map (.tmj / JSON export)');
  const ts = (json.tilesets ?? []).find((t: any) => t.image);
  if (!ts) throw new Error((json.tilesets ?? []).some((t: any) => t.source) ? 'the tileset is in a separate file: in Tiled, use Map › Embed Tilesets, then export again' : 'the map has no tileset image');
  if ((json.tilesets ?? []).length > 1) warnings.push('Only the first tileset is used; tiles from the others are left out.');
  const orient = String(json.orientation ?? 'orthogonal');
  if (orient === 'hexagonal' || (orient === 'staggered' && json.staggeraxis === 'x')) throw new Error(`${orient === 'hexagonal' ? 'hexagonal' : 'column-staggered'} maps are not supported (orthogonal, isometric and row-staggered are)`);
  const map = emptyTilemap(String(ts.image).split(/[\\/]/).pop()!);
  map.layers = [];
  map.tileW = Number(ts.tilewidth); map.tileH = Number(ts.tileheight);
  map.spacing = Number(ts.spacing ?? 0); map.margin = Number(ts.margin ?? 0);
  const gw = Number(json.tilewidth), gh = Number(json.tileheight);
  map.cell = 1;
  if (orient === 'isometric' || orient === 'staggered') {
    map.shape = 'isometric'; map.layout = orient === 'staggered' ? 'stacked' : 'diamond';
    map.gridW = gw; map.gridH = gh;
    map.texOffsetY = Math.max(0, map.tileH - gh); // Tiled sits tall tiles on the bottom of the cell
  } else if (gw !== map.tileW || gh !== map.tileH) { map.gridW = gw; map.gridH = gh; }
  // Even-staggered maps shift the other rows: move everything down a row so the odd rows are the shifted ones.
  const rowShift = orient === 'staggered' && json.staggerindex === 'even' ? 1 : 0;
  const first = Number(ts.firstgid ?? 1), count = Number(ts.tilecount ?? Infinity);
  let dropped = 0, firstTileLayer = true;
  const visit = (layers: any[]) => {
    for (const l of layers ?? []) {
      if (l.type === 'group') { visit(l.layers); continue; }
      if (l.type !== 'tilelayer') continue;
      const prop = (l.properties ?? []).find((p: any) => /^(collision|solid|collides)$/i.test(p.name));
      const cells: Record<string, number> = {};
      const put = (data: any, w: number, x0: number, y0: number) => {
        if (typeof data === 'string') throw new Error('compressed layer data: in Tiled, set Map › Map Properties › Tile Layer Format to CSV, then export again');
        (data as number[]).forEach((g, i) => {
          const gid = (g >>> 0) & GID_MASK; if (!gid) return;
          const t = gid - first;
          if (t < 0 || t >= count) { dropped++; return; }
          cells[`${x0 + (i % w)},${y0 + Math.floor(i / w) + rowShift}`] = t;
        });
      };
      if (l.chunks) for (const ch of l.chunks) put(ch.data, ch.width, ch.x, ch.y);
      else put(l.data ?? [], l.width ?? json.width, 0, 0);
      map.layers.push({ name: String(l.name ?? `Layer ${map.layers.length + 1}`), visible: l.visible !== false, collision: prop ? !!prop.value : firstTileLayer, opacity: l.opacity ?? 1, cells });
      firstTileLayer = false;
    }
  };
  visit(json.layers);
  if (!map.layers.length) map.layers.push({ name: 'Ground', visible: true, collision: true, cells: {} });
  if (dropped) warnings.push(`${dropped} cell(s) use tiles from other tilesets and were left out.`);
  // Tile collision: objects in each tile's object group, in pixels of the tile's picture.
  const { gw: fw, gh: fh } = { gw: map.gridW ?? map.tileW, gh: map.gridH ?? map.tileH };
  const iso = isIso(map);
  const toFoot = (x: number, y: number): [number, number] => iso ? [(x - (map.tileW - fw) / 2) / fw, (y - (map.texOffsetY ?? 0)) / fh] : [x / map.tileW, y / map.tileH];
  for (const t of ts.tiles ?? []) {
    const objs = t.objectgroup?.objects; if (!objs?.length) continue;
    const polys: TilePoly[] = [];
    for (const o of objs) {
      const ox = Number(o.x ?? 0), oy = Number(o.y ?? 0);
      if (o.polygon) polys.push(o.polygon.map((p: any) => toFoot(ox + p.x, oy + p.y)));
      else if (o.width && o.height) polys.push([toFoot(ox, oy), toFoot(ox + o.width, oy), toFoot(ox + o.width, oy + o.height), toFoot(ox, oy + o.height)]);
    }
    if (polys.length) (map.polys ??= {})[Number(t.id)] = polys;
  }
  return { map, image: map.tileset, imageSize: [Number(ts.imagewidth ?? 0), Number(ts.imageheight ?? 0)], warnings };
}

/** A tilemap as a Tiled map (finite, CSV data, the tileset embedded). `imageName` is the tileset file's name. */
export function toTiled(map: TilemapData, imageName: string, imageSize: [number, number]): any {
  const b = usedBounds(map) ?? { c0: 0, r0: 0, c1: 0, r1: 0 };
  const iso = isIso(map), stacked = iso && map.layout === 'stacked';
  // Tiled maps start at (0,0); keep the row parity of stacked maps.
  const c0 = b.c0, r0 = stacked ? b.r0 - (((b.r0 % 2) + 2) % 2) : b.r0;
  const W = b.c1 - c0 + 1, H = b.r1 - r0 + 1;
  const gw = map.gridW ?? map.tileW, gh = map.gridH ?? (iso ? Math.round(map.tileW / 2) : map.tileH);
  const cols = Math.max(1, Math.floor((imageSize[0] - (map.margin ?? 0) * 2 + (map.spacing ?? 0)) / (map.tileW + (map.spacing ?? 0))));
  const rows = Math.max(1, Math.floor((imageSize[1] - (map.margin ?? 0) * 2 + (map.spacing ?? 0)) / (map.tileH + (map.spacing ?? 0))));
  const fromFoot = (u: number, v: number) => iso ? { x: (map.tileW - gw) / 2 + u * gw, y: (map.texOffsetY ?? 0) + v * gh } : { x: u * map.tileW, y: v * map.tileH };
  const tiles: any[] = [];
  for (let t = 0; t < cols * rows; t++) {
    const polys = tilePolys(map, t);
    if (!polys) continue; // whole tile: Tiled has no default collision, so it is written out only when used below
    tiles.push({ id: t, objectgroup: { type: 'objectgroup', draworder: 'index', objects: polys.map((p, k) => ({ id: k + 1, x: 0, y: 0, width: 0, height: 0, rotation: 0, visible: true, name: '', type: '', polygon: p.map(([u, v]) => fromFoot(u, v)) })) } });
  }
  // Tiles used on colliding layers with the default (whole tile) collision get it written out.
  const used = new Set<number>();
  for (const l of map.layers) if (l.collision) for (const k in l.cells) used.add(l.cells[k]);
  for (const t of used) if (!tilePolys(map, t)) tiles.push({ id: t, objectgroup: { type: 'objectgroup', draworder: 'index', objects: [{ id: 1, x: 0, y: 0, width: 0, height: 0, rotation: 0, visible: true, name: '', type: '', polygon: fullPoly(map).map(([u, v]) => fromFoot(u, v)) }] } });
  tiles.sort((a, b2) => a.id - b2.id);
  let id = 1;
  return {
    type: 'map', version: '1.10', tiledversion: '1.10.2', orientation: !iso ? 'orthogonal' : stacked ? 'staggered' : 'isometric',
    ...(stacked ? { staggeraxis: 'y', staggerindex: 'odd' } : {}),
    renderorder: 'right-down', width: W, height: H, tilewidth: gw, tileheight: gh, infinite: false,
    nextlayerid: map.layers.length + 1, nextobjectid: 1,
    layers: map.layers.map((l) => {
      const data = new Array(W * H).fill(0);
      for (const k in l.cells) { const [c, r] = parseKey(k); data[(r - r0) * W + (c - c0)] = l.cells[k] + 1; }
      return { id: id++, name: l.name, type: 'tilelayer', x: 0, y: 0, width: W, height: H, opacity: l.opacity ?? 1, visible: l.visible, data, properties: [{ name: 'collision', type: 'bool', value: l.collision }] };
    }),
    tilesets: [{ firstgid: 1, name: imageName.replace(/\.[^.]+$/, ''), image: imageName, imagewidth: imageSize[0], imageheight: imageSize[1], tilewidth: map.tileW, tileheight: map.tileH, spacing: map.spacing ?? 0, margin: map.margin ?? 0, columns: cols, tilecount: cols * rows, ...(iso ? { tileoffset: { x: 0, y: 0 } } : {}), tiles }],
  };
}
