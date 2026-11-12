// Screen (HUD) text that opted into the camera's Post-FX ("Affected by Post-FX"): drawn to a canvas and shown on a
// plane just in front of the camera, so it is part of the rendered image and every effect (bloom, pixelate, CRT...)
// reaches it. Other HUD text stays in the DOM overlay, crisp on top of the effects.
import * as THREE from 'three';
import type { InstanceData } from '@shared/src/runtime/scene';
import { canvasFont, rgba, wrapLines } from '@shared/src/runtime/textStyle';

interface Item { mesh: THREE.Mesh; tex: THREE.CanvasTexture; canvas: HTMLCanvasElement; key: string; w: number; h: number }

export class ScreenTextLayer {
  private items = new Map<number, Item>();
  constructor(private scene: THREE.Scene) {}

  /** Draw one text the way the HUD does (font, colour, outline, shadow, background, padding, radius, wrap). */
  private paint(it: Item, i: InstanceData, family?: string) {
    const t = i.text!, s = t.style ?? {};
    const dpr = 2, size = t.size;
    const c = it.canvas, ctx = c.getContext('2d')!;
    ctx.font = canvasFont(size, s, family);
    const raw = s.uppercase ? t.text.toUpperCase() : t.text;
    const lines = wrapLines(ctx, raw, s.maxWidth ?? 0);
    const lh = size * (s.lineHeight ?? 1.2);
    const pad = s.bg || s.bgImage ? s.padding ?? 0 : 0;
    const textW = Math.max(1, ...lines.map((l) => ctx.measureText(l).width + (s.letterSpacing ?? 0) * l.length));
    const ow = s.outlineWidth ?? 0, sh = s.shadow ? Math.abs(s.shadowX ?? 0) + (s.shadowBlur ?? 0) : 0;
    const w = Math.ceil(textW + pad * 2.8 + ow * 2 + sh * 2 + 4), h = Math.ceil(lines.length * lh + pad * 2 + ow * 2 + sh * 2 + 4);
    c.width = w * dpr; c.height = h * dpr;
    ctx.scale(dpr, dpr);
    ctx.font = canvasFont(size, s, family);
    if (s.bg) {
      ctx.fillStyle = rgba(s.bg, s.bgOpacity ?? 1);
      const r = Math.min(s.radius ?? 0, h / 2);
      ctx.beginPath(); (ctx as any).roundRect ? (ctx as any).roundRect(1, 1, w - 2, h - 2, r) : ctx.rect(1, 1, w - 2, h - 2); ctx.fill();
      if (s.borderWidth) { ctx.lineWidth = s.borderWidth; ctx.strokeStyle = s.border ?? '#ffffff'; ctx.stroke(); }
    }
    ctx.textBaseline = 'middle';
    ctx.textAlign = t.align === 'center' ? 'center' : t.align === 'right' ? 'right' : 'left';
    const x0 = t.align === 'center' ? w / 2 : t.align === 'right' ? w - pad * 1.4 - ow - 2 : pad * 1.4 + ow + 2;
    if ('letterSpacing' in ctx && s.letterSpacing) (ctx as any).letterSpacing = `${s.letterSpacing}px`;
    lines.forEach((line, k) => {
      const y = pad + ow + 2 + lh * (k + 0.5);
      if (s.shadow) { ctx.shadowColor = s.shadow; ctx.shadowBlur = s.shadowBlur ?? 0; ctx.shadowOffsetX = s.shadowX ?? 0; ctx.shadowOffsetY = s.shadowY ?? 0; }
      if (ow) { ctx.lineJoin = 'round'; ctx.lineWidth = ow * 2; ctx.strokeStyle = s.outline ?? '#000'; ctx.strokeText(line, x0, y); }
      ctx.fillStyle = t.color; ctx.fillText(line, x0, y);
      ctx.shadowColor = 'transparent';
      if (s.underline) { const lw = ctx.measureText(line).width; const ux = ctx.textAlign === 'center' ? x0 - lw / 2 : ctx.textAlign === 'right' ? x0 - lw : x0; ctx.fillRect(ux, y + size * 0.45, lw, Math.max(1, size / 14)); }
    });
    it.w = w; it.h = h;
    it.tex.needsUpdate = true;
  }

  /** Called every frame while playing. `fontFamily(id)` maps an imported font to its loaded CSS family. */
  update(list: InstanceData[], cam: THREE.Camera, viewW: number, viewH: number, fontFamily?: (id: string) => string | undefined) {
    const seen = new Set<number>();
    const persp = (cam as THREE.PerspectiveCamera).isPerspectiveCamera ? cam as THREE.PerspectiveCamera : null;
    const near = persp ? Math.max(persp.near * 1.5, 0.05) : 1;
    // World units per screen pixel on the plane `near` in front of the camera.
    const perPx = persp ? (2 * near * Math.tan((persp.fov * Math.PI) / 360)) / viewH
      : ((cam as THREE.OrthographicCamera).top - (cam as THREE.OrthographicCamera).bottom) / ((cam as THREE.OrthographicCamera).zoom || 1) / viewH;
    cam.updateMatrixWorld();
    for (const i of list) {
      const t = i.text;
      if (i.kind !== 'text' || !t?.hud || !t.postfx || !i.visible) continue;
      seen.add(i.uid);
      let it = this.items.get(i.uid);
      if (!it) {
        const canvas = document.createElement('canvas');
        const tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace; tex.minFilter = THREE.LinearFilter;
        const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, toneMapped: false }));
        mesh.renderOrder = 1000; mesh.frustumCulled = false;
        this.scene.add(mesh);
        it = { mesh, tex, canvas, key: '', w: 1, h: 1 };
        this.items.set(i.uid, it);
      }
      const fam = t.font ? fontFamily?.(t.font) : undefined;
      const key = JSON.stringify([t.text, t.size, t.color, t.align, t.style, fam]);
      if (key !== it.key) { it.key = key; this.paint(it, i, fam ? `'${fam}', system-ui` : undefined); }
      (it.mesh.material as THREE.MeshBasicMaterial).opacity = i.opacity / 100;
      // Pixel centre of the text box from its anchor and offsets (as the DOM HUD lays it out).
      const va = t.anchor[0], ha = t.anchor[1];
      const cx = ha === 'l' ? i.x + it.w / 2 : ha === 'r' ? viewW - i.x - it.w / 2 : viewW / 2 + i.x;
      const cy = va === 't' ? i.y + it.h / 2 : va === 'b' ? viewH - i.y - it.h / 2 : viewH / 2 + i.y;
      const local = new THREE.Vector3((cx - viewW / 2) * perPx, -(cy - viewH / 2) * perPx, -near);
      it.mesh.position.copy(local.applyMatrix4(cam.matrixWorld));
      it.mesh.quaternion.copy(cam.getWorldQuaternion(new THREE.Quaternion()));
      it.mesh.scale.set(it.w * perPx, it.h * perPx, 1);
    }
    for (const [u, it] of this.items) if (!seen.has(u)) this.remove(u, it);
  }

  private remove(u: number, it: Item) { it.mesh.removeFromParent(); it.mesh.geometry.dispose(); (it.mesh.material as THREE.Material).dispose(); it.tex.dispose(); this.items.delete(u); }
  clear() { for (const [u, it] of [...this.items]) this.remove(u, it); }
}
