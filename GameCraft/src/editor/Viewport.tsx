// 3D/2D viewport with Blender-style navigation and modal transforms (G/R/S + X/Y/Z + typed values),
// a transform gizmo, selection, asset drag & drop and the play overlay.
import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { SceneView } from '../engine/sceneView';
import { Hud } from '../engine/hud';
import { store, useStore } from '../project/store';
import { editPathInDoc, findPathInDoc, pathDraw } from '@shared/src/blocks/pathParam';

// A Follow path brick's Draw button: the next clicks in the viewport go to that brick's route.
pathDraw.host = {
  draw(id, index, target) {
    const st = store.get(), p = st.project; if (!p) return;
    const of = p.scenes.find((s) => s.id === st.sceneId)?.instances.find((x) => x.type === target || x.name === target);
    store.set({ pathBrick: { id, index }, pathEdit: of?.uid ?? -1 });
  },
  active: () => store.get().pathBrick,
  stop: () => store.set({ pathEdit: null, pathBrick: null }),
  subscribe: (fn) => store.subscribe(fn),
};
import { assetUrl } from '../project/api';
import { editorRefs, play, stop } from './session';
import { ADD_MENU, addModel, addObject, curScene, deleteSelection, duplicateSelection, groupSelection, parentToBone, placePrefab, setParent, updateSelected } from './actions';
import { hasModelPanel, openModelPanel } from './ModelPanel';
import { boneSockets } from './parenting';
import { BoneViewPanel } from './BoneViewPanel';
import { HudEditDialog, ObjectMenus, hasObjectMenu, openObjectMenu } from './ObjectMenus';
import type { BonePick } from '../engine/boneOverlay';
import type { InstanceData } from '@shared/src/runtime/scene';
import { syncTextPositionBlocks } from '@shared/src/logicEdits';
import { cellAt, cellAtLocal } from '@shared/src/tilemap';
import { applyTileTool, tileTools } from '@shared/ui/tilemapTools';
import { Icon } from '@shared/ui/icons';
import { COLLISION_KINDS, collisionKind, type CollisionKind } from '@shared/src/collisionView';
import { ObjectContextMenu } from './ObjectContextMenu';

type Modal = { mode: 'G' | 'R' | 'S'; axis: 'x' | 'y' | 'z' | null; typed: string; mx: number; my: number; cx: number; cy: number; start: Map<number, InstanceData>; hit0: THREE.Vector3 | null; label: string };

export function Viewport({ onImportFiles }: { onImportFiles: (files: File[]) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const overlay = useRef<HTMLDivElement>(null);
  const viewRef = useRef<SceneView | null>(null);
  const tcRef = useRef<TransformControls | null>(null);
  const modalRef = useRef<Modal | null>(null);
  const [modalText, setModalText] = useState('');
  const [addMenu, setAddMenu] = useState<{ x: number; y: number } | null>(null);
  const project = useStore((s) => s.project);
  const sceneId = useStore((s) => s.sceneId);
  const rev = useStore((s) => s.rev);
  const selection = useStore((s) => s.selection);
  const playState = useStore((s) => s.play);
  const shading = useStore((s) => s.shading);
  const tool = useStore((s) => s.tool);
  const space = useStore((s) => s.space);
  const snap = useStore((s) => s.snap);
  const showColliders = useStore((s) => s.showColliders);
  const collisionView = useStore((s) => s.collisionView);
  const [camView, setCamView] = useState(false);
  /** Camera View: which camera (null = the active one) and the framing guide's aspect (0 = off). */
  const [camUid, setCamUid] = useState<number | null>(null);
  const [frameAspect, setFrameAspect] = useState(16 / 9);
  /** Game View: live corner window of what the game camera sees (size = share of the viewport's width; 0 = off). */
  /** Right-click menu (position), and where the right button went down (a drag pans instead). */
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  const rightDown = useRef<[number, number] | null>(null);
  const [gameView, setGameView] = useState<number>(() => { try { return Number(localStorage.getItem('gc.gameView') ?? 0) || 0; } catch { return 0; } });
  useEffect(() => { try { localStorage.setItem('gc.gameView', String(gameView)); } catch { /* private window */ } }, [gameView]);
  const [persp, setPersp] = useState(true);
  const editHud = useRef<Hud | null>(null);
  /** Bone view: skeletons over the scene, and the bone picked in it. */
  const [boneView, setBoneView] = useState(false);
  const [bonePick, setBonePick] = useState<BonePick | null>(null);
  const bonePickRef = useRef(bonePick); bonePickRef.current = bonePick;
  const pickBone = (p: BonePick | null) => { setBonePick(p); viewRef.current?.setPickedBone(p); };
  useEffect(() => { viewRef.current?.setBoneView(boneView); if (!boneView) setBonePick(null); }, [boneView]);

  // ---- mount
  useEffect(() => {
    const v = new SceneView(host.current!);
    viewRef.current = v;
    editorRefs.view = v; editorRefs.overlay = overlay.current;
    boneSockets.at = (owner, bone) => v.boneSocketMatrix(owner, bone);
    v.onLoadError = (m) => store.log('error', m);
    v.renderer.domElement.tabIndex = 0;
    const hud = new Hud(overlay.current!); editHud.current = hud;
    const tc = new TransformControls(v.editorCam, v.renderer.domElement);
    tcRef.current = tc;
    const helper = (tc as any).getHelper ? (tc as any).getHelper() : tc;
    helper.userData.editorOnly = true; // never in the Game View
    v.scene.add(helper);
    tc.addEventListener('dragging-changed', (e: any) => { v.controls.enabled = !e.value; if (!e.value) commitGizmo(); });
    let raf = 0;
    let hudCleared = false;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      // While playing, the play session owns the HUD; remove the editor's static HUD preview.
      if (editorRefs.session) { if (!hudCleared) { hud.clear(); hudCleared = true; } return; }
      hudCleared = false;
      {
        v.render();
        const p = store.get().project;
        if (p) { hud.resolve = (id) => assetUrl(p.id, id); hud.updateStatic(curScene(p).instances, store.get().selection); }
      }
    };
    loop();
    // Alt+left drag orbits (Blender "emulate 3 button mouse"); capture phase runs before OrbitControls.
    const cap = (e: PointerEvent) => { v.controls.mouseButtons.LEFT = (e.altKey && e.button === 0 ? (v.mode2d ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE) : null) as any; };
    host.current!.addEventListener('pointerdown', cap, true);
    return () => { cancelAnimationFrame(raf); tc.dispose(); hud.dispose(); v.dispose(); editorRefs.view = null; };
  }, []);

  // ---- sync editor scene
  useEffect(() => {
    const v = viewRef.current;
    if (!v || !project || playState !== 'edit') return;
    const s = curScene(project);
    const was2d = v.mode2d;
    v.customPresets = project.particlePresets;
    v.setQuality(project.settings.render?.quality);
    v.setRenderExtras(project.settings.render);
    v.syncData(s, project.id, project.assets);
    if (was2d !== (s.mode === '2d') || v.data?.id !== s.id) v.set2D(s.mode === '2d');
    v.setSelection(selection);
  }, [project, rev, sceneId, playState, selection]);

  useEffect(() => { const v = viewRef.current; if (!v) return; v.shading = shading; v.showColliders = showColliders; v.collisionView = collisionView; store.set({ rev: store.get().rev + 1 }); }, [shading, showColliders, collisionView]);
  useEffect(() => { const v = viewRef.current; if (v) { v.useSceneCamera = camView; v.viewCameraUid = camUid; v.frameAspect = camView ? frameAspect : 0; } }, [camView, camUid, frameAspect]);
  useEffect(() => {
    // First scene load: frame everything.
    const v = viewRef.current; if (!v || !project) return;
    setTimeout(() => v.frame([]), 50);
  }, [project?.id, sceneId]);

  // ---- gizmo
  useEffect(() => {
    const v = viewRef.current, tc = tcRef.current;
    if (!v || !tc) return;
    tc.camera = v.controls.object as THREE.Camera;
    const last = selection[selection.length - 1];
    const e = last != null ? v.entries.get(last) : undefined;
    if (playState !== 'edit' || tool === 'select' || !e) { tc.detach(); return; }
    tc.attach(e.obj);
    tc.setMode(tool === 'move' ? 'translate' : tool === 'rotate' ? 'rotate' : 'scale');
    tc.setSpace(space);
    tc.setTranslationSnap(snap.on ? snap.move : null);
    tc.setRotationSnap(snap.on ? THREE.MathUtils.degToRad(snap.rotate) : null);
    tc.setScaleSnap(snap.on ? snap.scale : null);
    if (v.mode2d) { tc.showZ = tool !== 'rotate'; tc.showX = tc.showY = tool !== 'rotate' || true; }
  }, [selection, tool, space, snap, playState, rev]);

  function commitGizmo() {
    const v = viewRef.current, tc = tcRef.current; if (!v || !tc?.object) return;
    const o = tc.object; const uid = o.userData.uid;
    store.mutate('Transform', (p) => {
      const i = curScene(p).instances.find((x) => x.uid === uid); if (!i) return;
      i.x = r4(o.position.x); i.y = r4(o.position.y); i.z = r4(o.position.z);
      i.rx = r4(THREE.MathUtils.radToDeg(o.rotation.x)); i.ry = r4(THREE.MathUtils.radToDeg(o.rotation.y)); i.rz = r4(THREE.MathUtils.radToDeg(o.rotation.z));
      const flip = i.kind === 'sprite' && i.sprite?.flipX ? -1 : 1;
      i.sx = r4(o.scale.x * flip); i.sy = r4(o.scale.y); i.sz = r4(o.scale.z);
    });
  }

  // ---- modal transforms (Blender G / R / S)
  const screenOf = (p: THREE.Vector3) => {
    const v = viewRef.current!; const r = v.renderer.domElement.getBoundingClientRect();
    const q = p.clone().project(v.currentCamera());
    return { x: r.left + ((q.x + 1) / 2) * r.width, y: r.top + ((1 - q.y) / 2) * r.height };
  };
  const startModal = (mode: Modal['mode'], mx: number, my: number) => {
    const v = viewRef.current; const p = store.get().project;
    if (!v || !p || !store.get().selection.length) return;
    tcRef.current?.detach();
    const s = curScene(p);
    const start = new Map<number, InstanceData>();
    const c = new THREE.Vector3();
    for (const i of s.instances) if (store.get().selection.includes(i.uid)) { start.set(i.uid, { ...i }); const e = v.entries.get(i.uid); if (e) c.add(e.obj.getWorldPosition(new THREE.Vector3())); }
    c.divideScalar(Math.max(1, start.size));
    const sc = screenOf(c);
    modalRef.current = { mode, axis: null, typed: '', mx, my, cx: sc.x, cy: sc.y, start, hit0: planeHit(mx, my, c), label: '' };
    (modalRef.current as any).center = c;
    updateModal(mx, my);
  };
  const planeHit = (mx: number, my: number, center: THREE.Vector3) => {
    const v = viewRef.current!; const cam = v.currentCamera();
    const r = v.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((mx - r.left) / r.width) * 2 - 1, -((my - r.top) / r.height) * 2 + 1);
    const ray = new THREE.Raycaster(); ray.setFromCamera(ndc, cam);
    const n = new THREE.Vector3(); cam.getWorldDirection(n);
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(n.negate(), center);
    return ray.ray.intersectPlane(plane, new THREE.Vector3());
  };
  const updateModal = (mx: number, my: number) => {
    const m = modalRef.current, v = viewRef.current; if (!m || !v) return;
    (m as any).last = [mx, my];
    const center = (m as any).center as THREE.Vector3;
    const typed = m.typed !== '' && m.typed !== '-' ? Number(m.typed) : null;
    const snapOn = store.get().snap.on;
    const sn = store.get().snap;
    let label = '';
    for (const [uid, s0] of m.start) {
      const e = v.entries.get(uid); if (!e) continue;
      if (m.mode === 'G') {
        const hit = planeHit(mx, my, center);
        const d = hit && m.hit0 ? hit.clone().sub(m.hit0) : new THREE.Vector3();
        if (m.axis) { const k = m.axis; const val = typed ?? d[k]; d.set(0, 0, 0); d[k] = val; }
        if (snapOn) d.set(Math.round(d.x / sn.move) * sn.move, Math.round(d.y / sn.move) * sn.move, Math.round(d.z / sn.move) * sn.move);
        if (v.mode2d) d.z = 0;
        e.obj.position.set(s0.x + d.x, s0.y + d.y, s0.z + d.z);
        label = `Move${m.axis ? ' ' + m.axis.toUpperCase() : ''}  D: ${d.x.toFixed(3)}  ${d.y.toFixed(3)}  ${d.z.toFixed(3)}`;
      } else if (m.mode === 'R') {
        let ang = THREE.MathUtils.radToDeg(Math.atan2(my - m.cy, mx - m.cx) - Math.atan2(m.my - m.cy, m.mx - m.cx));
        if (typed !== null) ang = typed;
        if (snapOn) ang = Math.round(ang / sn.rotate) * sn.rotate;
        const axis = m.axis ?? (v.mode2d ? 'z' : 'y');
        const rad = THREE.MathUtils.degToRad(-ang);
        e.obj.rotation.set(THREE.MathUtils.degToRad(s0.rx) + (axis === 'x' ? rad : 0), THREE.MathUtils.degToRad(s0.ry) + (axis === 'y' ? rad : 0), THREE.MathUtils.degToRad(s0.rz) + (axis === 'z' ? rad : 0));
        label = `Rotate ${axis.toUpperCase()}  ${(-ang).toFixed(1)}°`;
      } else {
        const d0 = Math.hypot(m.mx - m.cx, m.my - m.cy) || 1;
        let f = Math.hypot(mx - m.cx, my - m.cy) / d0;
        if (typed !== null) f = typed;
        if (snapOn) f = Math.round(f / sn.scale) * sn.scale;
        const flip = s0.kind === 'sprite' && s0.sprite?.flipX ? -1 : 1;
        e.obj.scale.set(s0.sx * flip * (!m.axis || m.axis === 'x' ? f : 1), s0.sy * (!m.axis || m.axis === 'y' ? f : 1), s0.sz * (!m.axis || m.axis === 'z' ? f : 1));
        label = `Scale${m.axis ? ' ' + m.axis.toUpperCase() : ''}  ${f.toFixed(3)}`;
      }
    }
    setModalText(label + (m.typed ? `  [${m.typed}]` : '') + '   ·  X/Y/Z axis · type a value · click/Enter confirm · right-click/Esc cancel');
  };
  const endModal = (confirm: boolean) => {
    const m = modalRef.current, v = viewRef.current; if (!m || !v) return;
    modalRef.current = null; setModalText('');
    if (!confirm) { store.set({ rev: store.get().rev + 1 }); return; }
    const vals = new Map<number, THREE.Object3D>();
    for (const uid of m.start.keys()) { const e = v.entries.get(uid); if (e) vals.set(uid, e.obj); }
    store.mutate({ G: 'Move', R: 'Rotate', S: 'Scale' }[m.mode], (p) => {
      for (const i of curScene(p).instances) {
        const o = vals.get(i.uid); if (!o) continue;
        i.x = r4(o.position.x); i.y = r4(o.position.y); i.z = r4(o.position.z);
        i.rx = r4(THREE.MathUtils.radToDeg(o.rotation.x)); i.ry = r4(THREE.MathUtils.radToDeg(o.rotation.y)); i.rz = r4(THREE.MathUtils.radToDeg(o.rotation.z));
        const flip = i.kind === 'sprite' && i.sprite?.flipX ? -1 : 1;
        i.sx = r4(o.scale.x * flip); i.sy = r4(o.scale.y); i.sz = r4(o.scale.z);
      }
    });
  };

  const mouse = useRef({ x: 0, y: 0 });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.('input,textarea,select,[contenteditable],.es-root,.bc-root')) return;
      if (!host.current?.matches(':hover') && !modalRef.current && document.activeElement !== viewRef.current?.renderer.domElement) return;
      const v = viewRef.current; if (!v) return;
      const st = store.get();
      // Esc while playing: first press releases the mouse (browser), a second press stops the game.
      if (st.play !== 'edit') { if (e.key === 'Escape' && !document.pointerLockElement && !editorRefs.session?.justUnlocked()) stop(); return; }
      const m = modalRef.current;
      const k = e.key.toLowerCase();
      // Drawing an NPC path: Enter/Esc finish, Backspace/Delete removes the last point.
      if (st.pathEdit != null && !m) {
        if (k === 'escape' || k === 'enter') { e.preventDefault(); store.set({ pathEdit: null, pathBrick: null }); return; }
        if (k === 'backspace' || k === 'delete' || k === 'x') { e.preventDefault(); editPath(st.pathEdit, 'Remove path point', (pts) => { pts.points.pop(); pts.waits?.splice(pts.points.length); }); return; }
      }
      if (m) {
        e.preventDefault();
        if (k === 'x' || k === 'y' || k === 'z') { m.axis = m.axis === k ? null : k; }
        else if (/^[0-9.\-]$/.test(e.key)) m.typed += e.key;
        else if (e.key === 'Backspace') m.typed = m.typed.slice(0, -1);
        else if (e.key === 'Enter') { endModal(true); return; }
        else if (e.key === 'Escape') { endModal(false); return; }
        const last = (m as any).last ?? [m.mx, m.my];
        updateModal(last[0], last[1]);
        return;
      }
      const mod = e.ctrlKey || e.metaKey;
      const code = e.code;
      if (code === 'Numpad1' || (code === 'Digit1' && !e.shiftKey && e.altKey)) { v.viewAxis(mod ? 'back' : 'front'); }
      else if (code === 'Numpad3' || (code === 'Digit3' && e.altKey)) v.viewAxis(mod ? 'left' : 'right');
      else if (code === 'Numpad7' || (code === 'Digit7' && e.altKey)) v.viewAxis(mod ? 'bottom' : 'top');
      else if (code === 'Numpad5' || (code === 'Digit5' && e.altKey)) { v.toggleOrtho(); setPersp(!v.orthoView); }
      else if ((code === 'Numpad0' || code === 'Digit0') && e.ctrlKey && e.altKey) cameraToView(); // Blender: Ctrl+Alt+Numpad 0
      else if (code === 'Numpad0' || (code === 'Digit0' && e.altKey)) setCamView((c) => !c);
      else if (code === 'NumpadDecimal' || k === 'f') v.frame(st.selection);
      else if (k === 'home') v.frame([]);
      else if (mod) return;
      else if (k === 'g' || k === 'r' || k === 's') { if (k === 's' && e.shiftKey) return; e.preventDefault(); startModal(k.toUpperCase() as any, mouse.current.x, mouse.current.y); }
      else if (k === 'd' && e.shiftKey) { e.preventDefault(); duplicateSelection(); setTimeout(() => startModal('G', mouse.current.x, mouse.current.y), 30); }
      else if (k === 'a' && e.shiftKey) { e.preventDefault(); setAddMenu({ x: mouse.current.x, y: mouse.current.y }); }
      else if (k === 'a' && e.altKey) { e.preventDefault(); store.set({ selection: [] }); }
      else if (k === 'a') { const p = st.project; if (p) store.set({ selection: curScene(p).instances.map((i) => i.uid) }); }
      else if (k === 'x' || k === 'delete') { if (st.selection.length && (k === 'delete' || window.confirm(`Delete ${st.selection.length} object(s)?`))) deleteSelection(); }
      else if (k === 'h' && e.altKey) { e.preventDefault(); store.mutate('Unhide all', (p) => curScene(p).instances.forEach((i) => { if (i.editor) i.editor.hiddenInEditor = false; })); }
      else if (k === 'h') updateSelected('Hide', (i) => { i.editor = { ...(i.editor ?? {}), hiddenInEditor: true }; });
      else if (k === 'p' && e.altKey) { e.preventDefault(); setParent(st.selection, null); }
      else if (k === 'z' && !e.shiftKey) store.set({ shading: st.shading === 'rendered' ? 'solid' : st.shading === 'solid' ? 'wireframe' : 'rendered' });
      else if (k === 'n') store.set({ panels: { ...st.panels, inspector: !st.panels.inspector } });
      else if (k === 't') store.set({ panels: { ...st.panels, toolbar: !st.panels.toolbar } });
      else if (k === 'escape') store.set({ selection: [] });
    };
    const onKeyMod = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || modalRef.current) return;
      if ((e.target as HTMLElement)?.closest?.('input,textarea,select,.es-root,.bc-root')) return;
      if (!host.current?.matches(':hover')) return;
      const st = store.get();
      if (e.key.toLowerCase() === 'g') { e.preventDefault(); groupSelection(); }
      const bp = bonePickRef.current;
      if (e.key.toLowerCase() === 'p' && bp && st.selection.some((u) => u !== bp.uid)) { e.preventDefault(); parentToBone(st.selection, bp.uid, bp.bone); return; }
      if (e.key.toLowerCase() === 'p' && st.selection.length > 1) { e.preventDefault(); setParent(st.selection.slice(0, -1), st.selection[st.selection.length - 1]); }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keydown', onKeyMod);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('keydown', onKeyMod); };
  }, []);

  // ---- Screen (HUD) text: click to select, drag to position, double-click to edit
  const [textEdit, setTextEdit] = useState<number | null>(null);
  useEffect(() => {
    const el = overlay.current; if (!el) return;
    const down = (e: PointerEvent) => {
      const item = (e.target as HTMLElement).closest?.('[data-uid]') as HTMLElement | null;
      if (!item || e.button !== 0 || store.get().play !== 'edit') return;
      e.stopPropagation(); e.preventDefault();
      const uid = Number(item.dataset.uid);
      const sel = store.get().selection;
      store.set({ selection: e.shiftKey ? (sel.includes(uid) ? sel.filter((u) => u !== uid) : [...sel, uid]) : [uid] });
      if (e.detail >= 2) { setTextEdit(uid); return; }
      const i0 = curScene(store.get().project!).instances.find((x) => x.uid === uid); if (!i0?.text) return;
      const start = { mx: e.clientX, my: e.clientY, x: i0.x, y: i0.y };
      const [va, ha] = [i0.text.anchor[0], i0.text.anchor[1]];
      let moved = false;
      const move = (ev: PointerEvent) => {
        const dx = ev.clientX - start.mx, dy = ev.clientY - start.my;
        if (!moved && Math.hypot(dx, dy) < 3) return;
        moved = true;
        const nx = Math.round(start.x + (ha === 'r' ? -dx : dx)), ny = Math.round(start.y + (va === 'b' ? -dy : dy));
        store.mutate('Move text', (p) => { const i = curScene(p).instances.find((x) => x.uid === uid); if (i) { i.x = nx; i.y = ny; } }, 'movetext' + uid);
      };
      const up = () => {
        window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
        if (!moved) return;
        // Keep the logic in step: "Set position" blocks that place this text with plain numbers follow the drag.
        const p = store.get().project!; const i = curScene(p).instances.find((x) => x.uid === uid); if (!i) return;
        const n = syncTextPositionBlocks(p.logic, i.type, start.x, start.y, i.x, i.y, true);
        if (n) { store.mutate('Update text position blocks', (pp) => { syncTextPositionBlocks(pp.logic, i.type, start.x, start.y, i.x, i.y, false); }, 'movetext' + uid); store.log('info', `Updated ${n} "Set position" block(s) for ${i.type}`); }
      };
      window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
    };
    // (The double-click itself too: a pointer press doesn't always say it is the second click.)
    const dbl = (e: MouseEvent) => {
      const item = (e.target as HTMLElement).closest?.('[data-uid]') as HTMLElement | null;
      if (!item || store.get().play !== 'edit') return;
      e.stopPropagation();
      setTextEdit(Number(item.dataset.uid));
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('dblclick', dbl);
    return () => { el.removeEventListener('pointerdown', down); el.removeEventListener('dblclick', dbl); };
  }, []);

  // ---- NPC paths: overlay for the selected Path follower, click to add points while drawing, drag handles
  const pathEdit = useStore((s) => s.pathEdit);
  const pathBrick = useStore((s) => s.pathBrick);
  const pathDrag = useRef<{ uid: number; index: number } | null>(null);
  /** The object whose route is shown: the one being drawn, else the selected Path follower. */
  const pathOwner = (): InstanceData | null => {
    const st = store.get(); const p = st.project; if (!p || st.play !== 'edit') return null;
    // Drawing from a Follow path brick: its route, at the height of the object the brick moves.
    if (st.pathBrick) {
      const b = st.pathBrick, of = curScene(p).instances.find((x) => x.uid === st.pathEdit) ?? curScene(p).instances.find((x) => !x.camera) ?? curScene(p).instances[0];
      const route = findPathInDoc(p.logic, b.id)?.paths[b.index] ?? [];
      return of ? { ...of, uid: of.uid, path: { points: route }, behaviors: [] } : null;
    }
    const uid = st.pathEdit ?? st.selection[st.selection.length - 1];
    const i = uid == null ? undefined : curScene(p).instances.find((x) => x.uid === uid);
    return i && (i.path?.points.length || i.behaviors.some((b) => b.type === 'pathfollow') || st.pathEdit === i.uid) ? i : null;
  };
  useEffect(() => {
    const v = viewRef.current; if (!v) return;
    const i = pathOwner();
    const mode = i?.behaviors.find((b) => b.type === 'pathfollow')?.props.mode;
    v.setPathOverlay(i?.path?.points ?? null, mode === 'loop', pathDrag.current?.index ?? -1);
  }, [project, rev, sceneId, playState, selection, pathEdit, pathBrick]);
  const editPath = (uid: number, label: string, fn: (path: NonNullable<InstanceData['path']>) => void, key?: string) =>
    store.mutate(label, (p) => {
      const b = store.get().pathBrick;
      if (b) { editPathInDoc(p.logic, b.id, (v) => { while (v.paths.length <= b.index) v.paths.push([]); const r = { points: v.paths[b.index] }; fn(r); v.paths[b.index] = r.points as typeof v.paths[number]; }); return; }
      const i = curScene(p).instances.find((x) => x.uid === uid); if (i) { i.path ??= { points: [] }; fn(i.path); }
    }, key);
  /** Where a click lands for a path point: the ground at the object's height (3D) or the 2D plane. */
  const pathPoint = (i: InstanceData, cx: number, cy: number): [number, number, number] | null => {
    const v = viewRef.current!; const g = v.groundPoint(cx, cy, v.mode2d ? 0 : i.y);
    return g ? (v.mode2d ? [r4(g.x), r4(g.y), i.z] : [r4(g.x), i.y, r4(g.z)]) : null;
  };
  const handleAt = (cx: number, cy: number): number => {
    const v = viewRef.current, i = pathOwner(); if (!v || !i?.path) return -1;
    const r = v.renderer.domElement.getBoundingClientRect();
    let best = -1, bd = 10;
    i.path.points.forEach((pt, k) => { const s = v.worldToScreen(pt[0], pt[1], pt[2]); if (!s) return; const d = Math.hypot(s.x + r.left - cx, s.y + r.top - cy); if (d < bd) { bd = d; best = k; } });
    return best;
  };
  useEffect(() => {
    // Capture phase, so grabbing a handle never starts an orbit or the gizmo.
    const el = host.current; if (!el) return;
    const cap = (e: PointerEvent) => {
      if (e.button !== 0 || e.altKey || modalRef.current) return;
      const i = pathOwner(); const k = handleAt(e.clientX, e.clientY);
      if (!i || k < 0) return;
      e.stopPropagation(); e.preventDefault();
      pathDrag.current = { uid: i.uid, index: k };
      store.set({ rev: store.get().rev + 1 });
      const move = (ev: PointerEvent) => {
        const d = pathDrag.current; const cur = pathOwner(); if (!d || !cur) return;
        const pt = pathPoint(cur, ev.clientX, ev.clientY); if (!pt) return;
        if (!viewRef.current!.mode2d) pt[1] = cur.path!.points[d.index][1];
        editPath(d.uid, 'Move path point', (path) => { path.points[d.index] = pt; }, `pathpt${d.uid}:${d.index}`);
      };
      const up = () => { pathDrag.current = null; window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); store.set({ rev: store.get().rev + 1 }); };
      window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
    };
    el.addEventListener('pointerdown', cap, true);
    return () => el.removeEventListener('pointerdown', cap, true);
  }, []);

  // ---- tilemaps: while the selected tilemap's Paint toggle is on, left presses paint cells (one undo step per stroke)
  const tileStroke = useRef(0);
  const paintTarget = (): InstanceData | null => {
    const st = store.get(); const p = st.project;
    if (!p || st.play !== 'edit' || !tileTools.get().active) return null;
    const uid = st.selection[st.selection.length - 1];
    const i = uid == null ? undefined : curScene(p).instances.find((x) => x.uid === uid);
    return i?.kind === 'tilemap' && i.tilemap ? i : null;
  };
  const tileCell = (i: InstanceData, cx: number, cy: number): [number, number] | null => {
    const v = viewRef.current; if (!v) return null;
    // 3D maps lie on the ground at the object's height (map up = -Z); 2D maps are the picture plane.
    if (!v.mode2d) { const g = v.groundPoint(cx, cy, i.y); return g ? cellAtLocal(i.tilemap!, g.x - i.x, i.z - g.z) : null; }
    const g = v.groundPoint(cx, cy); return g ? cellAt(i, g.x, g.y) : null;
  };
  useEffect(() => {
    const el = host.current; if (!el) return;
    const hover = (e: PointerEvent) => {
      const i = paintTarget(); const c = i && tileCell(i, e.clientX, e.clientY);
      const old = tileTools.get().hover;
      if (!c) { if (old) tileTools.set({ hover: null }); return; }
      if (!old || old[0] !== c[0] || old[1] !== c[1]) tileTools.set({ hover: c });
    };
    const cap = (e: PointerEvent) => {
      if (e.button !== 0 || e.altKey || modalRef.current) return;
      const i = paintTarget(); const c0 = i && tileCell(i, e.clientX, e.clientY);
      if (!i || !c0) return;
      e.stopPropagation(); e.preventDefault();
      const stroke = ++tileStroke.current, uid = i.uid;
      let last = c0;
      const step = (phase: 'down' | 'move' | 'up', c: [number, number]) => {
        const tool = tileTools.get().tool;
        const cur = curScene(store.get().project!).instances.find((x) => x.uid === uid); if (!cur) return;
        const editsMap = ((tool === 'brush' || tool === 'erase') && phase !== 'up') || (tool === 'fill' && phase === 'down') || (tool === 'rect' && phase === 'up');
        if (!editsMap) { applyTileTool(cur, phase, c[0], c[1]); return; }
        // Fast drags skip cells: cover the line from the last cell.
        const cells: [number, number][] = [];
        const n = phase === 'move' ? Math.max(Math.abs(c[0] - last[0]), Math.abs(c[1] - last[1])) : 0;
        for (let k = n ? 1 : 0; k <= n; k++) cells.push(n ? [Math.round(last[0] + ((c[0] - last[0]) * k) / n), Math.round(last[1] + ((c[1] - last[1]) * k) / n)] : c);
        last = c;
        store.mutate('Paint tiles', (p) => { const x = curScene(p).instances.find((o) => o.uid === uid); if (x) for (const [cc, rr] of cells) applyTileTool(x, phase, cc, rr); }, `tiles${uid}:${stroke}`);
      };
      step('down', c0);
      const move = (ev: PointerEvent) => { const c = tileCell(i, ev.clientX, ev.clientY); if (c && (c[0] !== last[0] || c[1] !== last[1] || tileTools.get().drag)) step('move', c); };
      const up = (ev: PointerEvent) => { const c = tileCell(i, ev.clientX, ev.clientY) ?? last; step('up', c); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
      window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
    };
    el.addEventListener('pointerdown', cap, true);
    el.addEventListener('pointermove', hover);
    return () => { el.removeEventListener('pointerdown', cap, true); el.removeEventListener('pointermove', hover); };
  }, []);

  // ---- pointer
  const down = useRef<{ x: number; y: number; b: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    viewRef.current?.renderer.domElement.focus();
    setAddMenu(null);
    if (modalRef.current) { e.preventDefault(); endModal(e.button === 0); return; }
    down.current = { x: e.clientX, y: e.clientY, b: e.button };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    mouse.current = { x: e.clientX, y: e.clientY };
    if (modalRef.current) updateModal(e.clientX, e.clientY);
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const d = down.current; down.current = null;
    if (!d || store.get().play !== 'edit' || e.altKey) return;
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4 || d.b !== 0) return;
    // Drawing a path: a click adds a point instead of selecting.
    const pe = store.get().pathEdit;
    if (pe != null) {
      const i = pathOwner() ?? undefined;
      const pt = i && pathPoint(i, e.clientX, e.clientY);
      if (pt) editPath(pe, 'Add path point', (path) => { path.points.push(pt); });
      return;
    }
    if ((tcRef.current as any)?.dragging || (tcRef.current as any)?.axis) return;
    // Bone view: a click on a joint picks that bone (the selected object stays selected, ready to parent to it).
    if (boneView) { const b = viewRef.current?.pickBone(e.clientX, e.clientY); if (b) { pickBone(b); return; } }
    const uid = viewRef.current?.pick(e.clientX, e.clientY) ?? null;
    const sel = store.get().selection;
    if (uid == null) { if (!e.shiftKey) store.set({ selection: [] }); return; }
    if (e.shiftKey) store.set({ selection: sel.includes(uid) ? sel.filter((u) => u !== uid) : [...sel, uid] });
    else store.set({ selection: [uid] });
  };

  // ---- drag & drop
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const v = viewRef.current; if (!v) return;
    const p = v.groundPoint(e.clientX, e.clientY);
    const at: [number, number, number] | undefined = p ? [r4(p.x), v.mode2d ? r4(p.y) : 0, v.mode2d ? 0 : r4(p.z)] : undefined;
    if (e.dataTransfer.files.length) { onImportFiles([...e.dataTransfer.files]); return; }
    const a = e.dataTransfer.getData('x-gc-asset');
    if (a) {
      const asset = JSON.parse(a);
      if (asset.kind === 'model') addModel(asset, at);
      else if (asset.kind === 'texture') {
        const sel = store.get().selection;
        if (sel.length) updateSelected('Apply texture', (i) => { if (i.kind === 'sprite') i.sprite = { ...(i.sprite ?? { frames: 1, fps: 8, animation: '' }), image: asset.id }; else i.material = { ...(i.material ?? { roughness: 0.6, metalness: 0, emissive: '#000000', emissiveStrength: 0 }), map: asset.id }; });
        else addObject(v.mode2d ? 'sprite' : 'plane', 'Image', v.mode2d ? { sprite: { image: asset.id, frames: 1, fps: 1, animation: '', pixelArt: true } } : { sx: 2, sz: 2, color: '#ffffff', material: { roughness: 0.8, metalness: 0, emissive: '#000000', emissiveStrength: 0, map: asset.id } }, at);
      } else if (asset.kind === 'sprite') addObject('sprite', asset.name, { sprite: { image: asset.id, frames: 1, fps: 8, animation: '', pixelArt: true } }, at ? [at[0], at[1] + (v.mode2d ? 0 : 0.5), at[2]] : undefined);
      store.log('info', `Placed ${asset.name}`);
      return;
    }
    const prim = e.dataTransfer.getData('x-gc-primitive');
    if (prim) { const [kind, type] = prim.split('|'); addObject(kind as any, type, {}, at ? [at[0], v.mode2d ? at[1] : 0.5, at[2]] : undefined); return; }
    const pf = e.dataTransfer.getData('x-gc-prefab');
    if (pf) placePrefab(pf, at);
  };

  /** Move the camera (the one picked in Camera View, else the active one) to the editor's view, then look through it. */
  const cameraToView = () => {
    const v = viewRef.current, p = store.get().project;
    if (!v || !p || store.get().play !== 'edit') return;
    if (v.useSceneCamera) { store.log('info', 'Camera to view: leave Camera View first (Numpad 0), frame the shot, then press it.'); return; }
    const s = curScene(p);
    const cam = (v.viewCameraUid != null ? s.instances.find((i) => i.uid === v.viewCameraUid && i.kind === 'camera') : undefined) ?? v.activeCameraData(s.instances);
    if (!cam) { store.log('info', 'Add a Camera first (Add › Camera).'); return; }
    const vc = v.viewCamera; vc.updateMatrixWorld();
    const pos = vc.getWorldPosition(new THREE.Vector3()), eu = new THREE.Euler().setFromQuaternion(vc.getWorldQuaternion(new THREE.Quaternion()), 'YXZ');
    const deg = (r: number) => Math.round(((r * 180) / Math.PI) * 100) / 100, r3 = (n: number) => Math.round(n * 1000) / 1000;
    store.mutate('Camera to view', (pp) => { const c = curScene(pp).instances.find((i) => i.uid === cam.uid); if (!c) return; c.x = r3(pos.x); c.y = r3(pos.y); c.z = r3(pos.z); c.rx = deg(eu.x); c.ry = deg(eu.y); c.rz = deg(eu.z); });
    setCamView(true);
  };

  const scene = project ? curScene(project) : null;
  const cameras = scene?.instances.filter((i) => i.kind === 'camera') ?? [];
  return (
    <div className="viewport">
      <div className="vp-header">
        <span className="vp-mode">{scene?.mode === '2d' ? '2D' : '3D'} · {scene?.name}</span>
        <div className="seg">
          {(['select', 'move', 'rotate', 'scale'] as const).map((t) => <button key={t} className={tool === t ? 'on' : ''} title={{ select: 'Select (box-free click select)', move: 'Move gizmo (G for modal)', rotate: 'Rotate gizmo (R)', scale: 'Scale gizmo (S)' }[t]} onClick={() => store.set({ tool: t })}>{{ select: '⬚', move: '✥', rotate: '⟳', scale: '⤡' }[t]}</button>)}
        </div>
        <select className="sel small" value={space} onChange={(e) => store.set({ space: e.target.value as any })} title="Transform orientation"><option value="world">Global</option><option value="local">Local</option></select>
        <button className={'tbtn' + (snap.on ? ' on' : '')} title="Snapping (increments in Edit › Preferences)" onClick={() => store.set({ snap: { ...snap, on: !snap.on } })}><Icon name="magnet" size={14} /></button>
        <span className="vp-snapvals">{snap.on && <>{snap.move}m · {snap.rotate}° · {snap.scale}×</>}</span>
        <div className="grow" />
        <select className="sel small" value={collisionView ? 'view' : showColliders ? 'lines' : 'off'} title="Colliders: outlines over the scene, or Collision View (colliders filled and coloured by what they do, everything else ghosted)"
          onChange={(e) => store.set({ showColliders: e.target.value === 'lines', collisionView: e.target.value === 'view' })}>
          <option value="off">▣ Colliders off</option><option value="lines">▣ Collider outlines</option><option value="view">▣ Collision view</option>
        </select>
        <button className="tbtn" title="Toggle perspective / orthographic (Numpad 5)" onClick={() => { viewRef.current?.toggleOrtho(); setPersp(!viewRef.current?.orthoView); }}>{persp ? 'Persp' : 'Ortho'}</button>
        <button className={'tbtn' + (camView ? ' on' : '')} title="Camera View: look through the scene's camera, with the game window's framing (Numpad 0)" onClick={() => setCamView(!camView)}><Icon name="video" size={14} /></button>
        <button className={'tbtn' + (gameView ? ' on' : '')} title="Game View: a live window of what the game camera sees, lit as in the game, while you edit" onClick={() => setGameView(gameView ? 0 : 0.32)}><Icon name="monitor" size={14} /></button>
        {!camView && cameras.length > 0 && <button className="tbtn" title="Camera to view: move the camera to where you are looking now, then look through it (Ctrl+Alt+Numpad 0)" onClick={cameraToView}>⤓</button>}
        <div className="seg">
          {(['wireframe', 'solid', 'rendered'] as const).map((m) => <button key={m} className={shading === m ? 'on' : ''} title={m[0].toUpperCase() + m.slice(1) + ' shading (Z)'} onClick={() => store.set({ shading: m })}>{{ wireframe: '◯', solid: '●', rendered: '◐' }[m]}</button>)}
        </div>
        <button className={'tbtn' + (boneView ? ' on' : '')} title="Bone view: see the skeletons, pick a bone and parent objects to it (a gun on a hand)" onClick={() => setBoneView(!boneView)}>🦴</button>
      </div>
      <div className="vp-canvas" ref={host} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
        onDoubleClick={(e) => {
          // Double-click any 3D object (a model, a cube, a procedural character...): its Model & animations panel.
          if (store.get().play !== 'edit' || (boneView && viewRef.current?.pickBone(e.clientX, e.clientY))) return;
          const uid = viewRef.current?.pick(e.clientX, e.clientY);
          const i = uid == null ? null : curScene(store.get().project!).instances.find((x) => x.uid === uid);
          if (i && hasModelPanel(i)) { store.set({ selection: [i.uid] }); openModelPanel(i.uid); }
          // Double-click a sprite (its sprite sheet editor, or its picture choice) or a tilemap (tiles, tools, layers).
          // While painting tiles a double-click is two brush strokes, not a request for the menu.
          if (i && hasObjectMenu(i) && !tileTools.get().active) openObjectMenu(i.uid);
        }}
        onPointerDownCapture={(e) => { if (e.button === 2) rightDown.current = [e.clientX, e.clientY]; }}
        onContextMenu={(e) => {
          e.preventDefault();
          if (modalRef.current) { endModal(false); return; }
          // A right-click (not a right-drag pan) on an object: its menu (selecting it first unless it is selected).
          const d = rightDown.current; rightDown.current = null;
          if (store.get().play !== 'edit' || (d && Math.hypot(e.clientX - d[0], e.clientY - d[1]) > 5)) return;
          const uid = viewRef.current?.pick(e.clientX, e.clientY);
          if (uid == null) return;
          if (!store.get().selection.includes(uid)) store.set({ selection: [uid] });
          setCtxMenu({ x: e.clientX, y: e.clientY });
        }}
        onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }} onDrop={onDrop}>
        <div className="vp-overlay" ref={overlay} />
        {camView && playState === 'edit' && <>
          {frameAspect > 0 && <CameraFrame aspect={frameAspect} />}
          <div className="vp-camview-bar" style={{ position: 'absolute', left: 8, top: 8, display: 'flex', gap: 6, alignItems: 'center', zIndex: 3, background: 'rgba(20,20,26,.75)', padding: '4px 6px', borderRadius: 6, fontSize: 12 }} onPointerDown={(e) => e.stopPropagation()}>
            <span>Camera view</span>
            {cameras.length > 1 && <select className="sel small" value={camUid ?? ''} title="Which camera to look through (the game starts with the active one)" onChange={(e) => setCamUid(e.target.value ? Number(e.target.value) : null)}>
              <option value="">Active camera</option>{cameras.map((c) => <option key={c.uid} value={c.uid}>{c.name}{c.camera?.active ? ' (active)' : ''}</option>)}</select>}
            <select className="sel small" value={String(frameAspect)} title="Framing guide: what a game window of this shape shows" onChange={(e) => setFrameAspect(Number(e.target.value))}>
              {FRAME_ASPECTS.map(([label, a]) => <option key={label} value={String(a)}>{label}</option>)}
            </select>
          </div>
        </>}
        {boneView && playState === 'edit' && viewRef.current && <BoneViewPanel view={viewRef.current} pick={bonePick} onPick={pickBone} top={camView ? 44 : 8} />}
        {collisionView && <CollisionLegend instances={scene?.instances ?? []} />}
        {gameView > 0 && playState === 'edit' && !camView && <GameViewWindow size={gameView} aspect={frameAspect || 16 / 9} setSize={setGameView}
          cameraName={(camUid != null ? cameras.find((c) => c.uid === camUid) : undefined)?.name ?? (cameras.find((c) => c.camera?.active) ?? cameras[0])?.name ?? null}
          onRect={(r) => { const v = viewRef.current; if (v) v.gameView = r; }} onLookThrough={() => setCamView(true)} />}
        {modalText && <div className="vp-modal">{modalText}</div>}
        {playState === 'edit' && pathEdit != null && <div className="vp-hint">Drawing path: click to add points, drag a point to move it. Backspace removes the last; Enter or Esc finishes.</div>}
        {playState !== 'edit' && <div className="vp-playing"><Icon name={playState === 'paused' ? 'pause' : 'play'} size={12} /> {playState === 'paused' ? 'Paused' : 'Playing'} — Esc to stop</div>}
        {playState === 'edit' && <div className="vp-axes"><b className="ax-x">X</b><b className="ax-y">Y</b><b className="ax-z">Z</b></div>}
        {playState === 'edit' && !project?.scenes.length && <div className="vp-empty">No scene</div>}
        {playState === 'edit' && <button className="vp-play" onClick={play} title="Play (F5)"><Icon name="play" size={18} /></button>}
      </div>
      {/* Outside the canvas area: clicks in these menus must not reach the scene underneath. */}
      {textEdit != null && project && <HudEditDialog uid={textEdit} onClose={() => setTextEdit(null)} />}
      <ObjectMenus />
      {ctxMenu && <>
        <div style={{ position: 'fixed', inset: 0, zIndex: 1099 }} onPointerDown={() => setCtxMenu(null)} onContextMenu={(e) => { e.preventDefault(); setCtxMenu(null); }} />
        <ObjectContextMenu x={ctxMenu.x} y={ctxMenu.y} onClose={() => setCtxMenu(null)} />
      </>}
      {addMenu && (
        <div className="lx-menu" style={{ left: addMenu.x, top: addMenu.y }} onMouseLeave={() => setAddMenu(null)}>
          <div className="menu-title">Add</div>
          {ADD_MENU.map((g) => (
            <React.Fragment key={g.group}><div className="menu-sub">{g.group}</div>
              {g.items.map((it) => {
                const v = viewRef.current;
                const p = v?.groundPoint(addMenu.x, addMenu.y);
                return <button key={it.label} onClick={() => { addObject(it.kind, it.type, it.extra, p ? [r4(p.x), v?.mode2d ? r4(p.y) : (it.extra?.y ?? (it.kind === 'light' || it.kind === 'camera' ? 3 : 0.5)), v?.mode2d ? 0 : r4(p.z)] : undefined); setAddMenu(null); }}>{it.label}</button>;
              })}
            </React.Fragment>
          ))}
          {!viewRef.current?.mode2d && <><div className="menu-sub">Generate</div>
            <button onClick={() => { setAddMenu(null); window.dispatchEvent(new Event('gc-rooms-dialog')); }}>Procedural rooms…</button></>}
        </div>
      )}
    </div>
  );
}

const r4 = (n: number) => Math.round(n * 10000) / 10000;

/** Camera View framing guides: the game window's shape. */
const FRAME_ASPECTS: [string, number][] = [['16:9 (monitor)', 16 / 9], ['16:10', 16 / 10], ['4:3', 4 / 3], ['21:9 (ultrawide)', 21 / 9], ['9:16 (phone, portrait)', 9 / 16], ['19.5:9 (phone, landscape)', 19.5 / 9], ['1:1', 1], ['No guide', 0]];

/**
 * The game window's frame over the camera view: outside it darkened, thirds lines inside. Narrower than the viewport
 * crops the sides; wider is shown by widening the view (SceneView.frameAspect) and darkening top and bottom.
 */
function CameraFrame({ aspect }: { aspect: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current?.parentElement; if (!el) return;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el); setBox({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);
  const view = box.w / Math.max(1, box.h);
  const [fw, fh] = aspect <= view ? [box.h * aspect, box.h] : [box.w, box.w / aspect];
  const third = 'rgba(255,255,255,.18)';
  return <div ref={ref} style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none', zIndex: 2 }}>
    {box.w > 0 && <div style={{
      position: 'absolute', left: (box.w - fw) / 2, top: (box.h - fh) / 2, width: fw, height: fh,
      boxShadow: '0 0 0 9999px rgba(0,0,0,.55)', outline: '1px solid rgba(255,255,255,.6)',
      backgroundImage: `linear-gradient(to right, transparent calc(33.33% - .5px), ${third} 33.33%, transparent calc(33.33% + .5px), transparent calc(66.66% - .5px), ${third} 66.66%, transparent calc(66.66% + .5px)), linear-gradient(to bottom, transparent calc(33.33% - .5px), ${third} 33.33%, transparent calc(33.33% + .5px), transparent calc(66.66% - .5px), ${third} 66.66%, transparent calc(66.66% + .5px))`,
    }} />}
  </div>;
}

/**
 * Game View window: a frame in the viewport's corner that the renderer fills with the game camera's picture (lit as
 * in the game, no editor helpers). Sizes S / M / L, look through the camera, close.
 */
function GameViewWindow({ size, aspect, cameraName, setSize, onRect, onLookThrough }: { size: number; aspect: number; cameraName: string | null; setSize: (s: number) => void; onRect: (r: { x: number; y: number; w: number; h: number } | null) => void; onLookThrough: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current?.parentElement; if (!el) return;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el); setBox({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);
  let w = Math.round(box.w * size), h = Math.round(w / aspect);
  if (h > box.h * 0.6 - 30) { h = Math.round(Math.max(20, box.h * 0.6 - 30)); w = Math.round(h * aspect); }
  // Top-right: clear of the Play button and the legend (its title bar sits above the picture).
  const x = box.w - w - 10, y = 30;
  useEffect(() => { onRect(box.w && cameraName ? { x, y, w, h } : null); }, [x, y, w, h, cameraName]);
  useEffect(() => () => onRect(null), []);
  const btn = { background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', padding: '0 3px', fontSize: 11 } as const;
  return <div ref={ref} style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 3 }}>
    {box.w > 0 && <div style={{ position: 'absolute', left: x, top: y, width: w, height: h, outline: '1px solid rgba(255,255,255,.55)', boxShadow: '0 2px 12px rgba(0,0,0,.5)', pointerEvents: 'auto' }}
      onPointerDown={(e) => e.stopPropagation()} onDoubleClick={onLookThrough} title="Game View: what the game camera sees (double-click to look through it)">
      {!cameraName && <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', background: 'rgba(20,20,26,.85)', fontSize: 11 }}>No camera in this scene</div>}
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: '100%', display: 'flex', alignItems: 'center', gap: 2, fontSize: 11, background: 'rgba(20,20,26,.8)', padding: '1px 4px', borderRadius: '4px 4px 0 0' }}>
        <span style={{ flex: 1, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>Game view{cameraName ? ` · ${cameraName}` : ''}</span>
        {([['S', 0.22], ['M', 0.32], ['L', 0.45]] as const).map(([l, s]) => <button key={l} style={{ ...btn, fontWeight: size === s ? 700 : 400 }} title={`Size ${l}`} onClick={() => setSize(s)}>{l}</button>)}
        <button style={btn} title="Look through this camera (Camera View)" onClick={onLookThrough}>⤢</button>
        <button style={btn} title="Close the Game View" onClick={() => setSize(0)}>✕</button>
      </div>
    </div>}
  </div>;
}

/** Collision View legend: what each colour means, with how many objects of each kind the scene has. */
function CollisionLegend({ instances }: { instances: InstanceData[] }) {
  const [open, setOpen] = useState(true);
  const count = (k: CollisionKind) => instances.filter((i) => collisionKind(i) === k).length;
  const used = COLLISION_KINDS.filter((c) => count(c.kind));
  const swatch = (c: number) => <span style={{ width: 8, height: 8, borderRadius: 2, flex: 'none', background: '#' + c.toString(16).padStart(6, '0') }} />;
  return <div style={{ position: 'absolute', left: 8, bottom: 8, zIndex: 3, background: 'rgba(20,20,26,.75)', padding: '3px 7px', borderRadius: 5, fontSize: 10, lineHeight: 1.5, pointerEvents: 'auto', maxWidth: '45%', cursor: 'default' }}
    onPointerDown={(e) => e.stopPropagation()} onClick={() => setOpen(!open)} title={open ? 'Click to fold' : 'Collision view: click for the colour key'}>
    {open
      ? used.map((c) => <div key={c.kind} title={c.doc} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>{swatch(c.color)}{c.label} <span style={{ opacity: 0.6 }}>{count(c.kind)}</span></div>)
      : <div style={{ display: 'flex', gap: 3, alignItems: 'center' }}>{used.map((c) => <React.Fragment key={c.kind}>{swatch(c.color)}</React.Fragment>)} key</div>}
  </div>;
}
