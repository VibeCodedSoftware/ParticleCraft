// A tilemap in the 3D view: the painted cells are drawn (with the shared 2D drawer) into a canvas texture on one
// plane covering them, redrawn only when the map, the tileset or the editor overlay changes. While painting, the
// cells under the brush (squares or isometric diamonds) are outlined.
import * as THREE from 'three';
import { cellBox, cellPolygon, cellSize, drawTilemap, footprintPx, isIso, parseKey, drawTileCollision } from '@shared/src/tilemap';
import type { InstanceData } from '@shared/src/runtime/scene';

/** Largest texture side; big maps get fewer pixels per cell. */
const MAX_SIDE = 4096;

export interface TilemapOverlay {
  showCollision: boolean;
  highlightLayer?: number;
  /** Cells to outline (brush / rectangle preview) and their colour, or null. */
  preview: { cells: [number, number][]; color: string } | null;
}

export class TilemapView {
  readonly group = new THREE.Group();
  private canvas = document.createElement('canvas');
  private tex = new THREE.CanvasTexture(this.canvas);
  private mesh: THREE.Mesh;
  private outline: THREE.LineSegments;
  private img: HTMLImageElement | null = null;
  private imgUrl: string | null = null;
  private drawn: { map: unknown; url: string | null; loaded: boolean; overlay: string } | null = null;
  private outlineKey = '';

  constructor() {
    const mat = new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, alphaTest: 0.01, side: THREE.DoubleSide });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
    this.mesh.visible = false;
    this.outline = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xffd200, depthTest: false }));
    this.outline.userData.editorOnly = true; this.outline.renderOrder = 10; this.outline.visible = false;
    this.group.add(this.mesh, this.outline);
  }

  get material() { return this.mesh.material as THREE.MeshBasicMaterial; }

  update(i: InstanceData, url: string | null, overlay: TilemapOverlay) {
    const map = i.tilemap; if (!map) return;
    if (url !== this.imgUrl) {
      this.imgUrl = url; this.img = null;
      // CORS mode: in the desktop app files come from the craft:// server (another origin), and a canvas holding a
      // non-CORS image cannot be uploaded as a WebGL texture, so the whole map would vanish.
      if (url) { const im = new Image(); im.crossOrigin = 'anonymous'; im.onload = () => { if (this.imgUrl === url) { this.img = im; this.drawn = null; } }; im.src = url; }
    }
    this.updateOutline(i, overlay.preview);
    const ov = `${overlay.showCollision}|${overlay.highlightLayer}`;
    const d = this.drawn;
    if (d && d.map === map && d.url === url && d.loaded === !!this.img && d.overlay === ov) return;
    this.drawn = { map, url, loaded: !!this.img, overlay: ov };
    this.redraw(i, overlay);
  }

  private updateOutline(i: InstanceData, pv: TilemapOverlay['preview']) {
    const map = i.tilemap!;
    const key = pv ? pv.color + pv.cells.length + ':' + pv.cells.slice(0, 4).join(';') + JSON.stringify([map.shape, map.layout, map.cell, map.gridW, map.gridH]) : '';
    if (key === this.outlineKey) return;
    this.outlineKey = key;
    if (!pv) { this.outline.visible = false; return; }
    const pts: number[] = [];
    for (const [c, r] of pv.cells.slice(0, 2500)) {
      const poly = cellPolygon(map, c, r);
      poly.forEach(([x, y], k) => { const [nx, ny] = poly[(k + 1) % poly.length]; pts.push(x, y, 0.01, nx, ny, 0.01); });
    }
    this.outline.geometry.dispose();
    this.outline.geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    (this.outline.material as THREE.LineBasicMaterial).color.set(pv.color);
    this.outline.visible = true;
  }

  private redraw(i: InstanceData, overlay: TilemapOverlay) {
    const map = i.tilemap!;
    const { w: cw } = cellSize(map), iso = isIso(map), { gw } = footprintPx(map);
    const k = iso ? cw / gw : 0;
    // Local bounds of every painted cell, with the part of tall isometric tiles that rises above the footprint.
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const l of map.layers) for (const key in l.cells) {
      const [c, r] = parseKey(key), b = cellBox(map, c, r);
      const iw = iso ? map.tileW * k : b.w, ih = iso ? map.tileH * k : b.h, top = b.top + (iso ? (map.texOffsetY ?? 0) * k : 0), left = b.x + (b.w - iw) / 2;
      x0 = Math.min(x0, left, b.x); x1 = Math.max(x1, left + iw, b.x + b.w);
      y1 = Math.max(y1, top, b.top); y0 = Math.min(y0, top - ih, b.top - b.h);
    }
    if (x0 === Infinity) { this.mesh.visible = false; return; }
    const W = x1 - x0, H = y1 - y0;
    const want = iso ? gw / cw : map.tileW / map.cell; // texture pixels per world unit
    const ppu = Math.max(1, Math.min(want, MAX_SIDE / Math.max(W, H)));
    this.canvas = document.createElement('canvas');
    this.canvas.width = Math.max(1, Math.ceil(W * ppu)); this.canvas.height = Math.max(1, Math.ceil(H * ppu));
    const ctx = this.canvas.getContext('2d')!;
    const local = { ...i, x: 0, y: 0 };
    const toCanvas = (x: number, y: number) => ({ x: (x - x0) * ppu, y: (y1 - y) * ppu });
    if (this.img) drawTilemap(ctx, local, this.img, toCanvas, ppu, { w: this.canvas.width, h: this.canvas.height }, { showCollision: overlay.showCollision, highlightLayer: overlay.highlightLayer });
    else {
      // No tileset yet: painted cells as plain squares / diamonds.
      ctx.fillStyle = 'rgba(120,130,150,.85)';
      for (const l of map.layers) if (l.visible) for (const key in l.cells) {
        const [c, r] = parseKey(key); ctx.beginPath();
        cellPolygon(map, c, r).forEach(([x, y], n) => { const p = toCanvas(x, y); if (n) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y); });
        ctx.closePath(); ctx.fill();
      }
      if (overlay.showCollision) drawTileCollision(ctx, local, toCanvas);
    }
    this.tex.dispose(); // canvas size may have changed
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.magFilter = THREE.NearestFilter; this.tex.minFilter = THREE.NearestFilter;
    this.tex.colorSpace = THREE.SRGBColorSpace; this.tex.generateMipmaps = false;
    this.material.map = this.tex; this.material.needsUpdate = true;
    this.mesh.scale.set(W, H, 1);
    this.mesh.position.set(x0 + W / 2, y0 + H / 2, 0);
    this.mesh.visible = true;
  }

  dispose() { this.tex.dispose(); this.material.dispose(); this.mesh.geometry.dispose(); this.outline.geometry.dispose(); }
}
