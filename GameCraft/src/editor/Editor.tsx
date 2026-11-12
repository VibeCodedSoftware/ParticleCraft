// Editor shell: menu bar, resizable/hideable docks, play controls, shortcuts.
import { DEFAULT_VR, VR_PROFILES } from '@shared/src/vr';
import { DEFAULT_ACTIONS, VR_ACTIONS } from '@shared/src/runtime/input';
import { GRAPHICS_PRESETS, QUALITY, SHADOW_FILTERS, presetPatch, renderPatch, type GraphicsPreset } from '../engine/quality';
import React, { useEffect, useRef, useState } from 'react';
import { deepClone } from '@shared/src/schema';
import { emptyScene, DEFAULT_CAMERA, makeInstance } from '@shared/src/runtime/scene';
import { store, useStore } from '../project/store';
import { api } from '../project/api';
import { Viewport } from './Viewport';
import { Outliner } from './Outliner';
import { Inspector } from './Inspector';
import { EffectsPanel } from './EffectsPanel';
import { LogicPanel } from './LogicPanel';
import { AssetBrowser } from './AssetBrowser';
import { AnimationPanel } from './AnimationPanel';
import { ParticleEditor } from './ParticleEditor';
import { ConsolePanel, DebugPanel } from './ConsolePanel';
import { Tutorial } from './Tutorial';
import { ADD_MENU, addObject, curScene, deleteSelection, duplicateSelection, groupSelection, makePrefab } from './actions';
import { RoomsDialog } from './RoomsDialog';
import { ImportSceneDialog } from './ImportScene';
import { editorRefs, joinOnline, pause, play, restart, step, stop } from './session';
import { Icon } from '@shared/ui/icons';
import { HardwarePending } from '@shared/ui/HardwarePending';
import { OPEN_MULTIPLAYER, OnlineDialog } from './OnlineDialog';
import { setNetConfig } from '@shared/ui/net';
import { BLOOD_DEFAULTS, BULLET_DEFAULTS, type BloodSettings, type BulletMarkSettings } from '@shared/src/runtime/marks';
import { ExportDialog } from './ExportDialog';
import { ModelPanelHost } from './ModelPanel';
import { Modal, Num, Row, Section, Slider, Check, Color } from './ui';
import { DEFAULT_RENDER } from '../engine/culling';

// "Layout" folds the dock to its tab row so the scene gets the room (it replaced the top workspace tabs, which only
// switched these same tabs).
const BOTTOM_TABS = ['Layout', 'Event sheet', 'Assets', 'Animation', 'Particles', 'Console', 'Debug'];
const TAB_ROW = 34;

function loadSizes() { try { return { left: 240, right: 330, bottom: 260, ...JSON.parse(localStorage.getItem('gc.sizes') ?? '{}') }; } catch { return { left: 240, right: 330, bottom: 260 }; } }

export function Editor({ onClose }: { onClose: () => void }) {
  const project = useStore((s) => s.project)!;
  const dirty = useStore((s) => s.dirty);
  const playState = useStore((s) => s.play);
  const panels = useStore((s) => s.panels);
  const bottomTab = useStore((s) => s.bottomTab);
  const rightTab = useStore((s) => s.rightTab);
  const logs = useStore((s) => s.logs);
  const [sizes, setSizes] = useState(loadSizes);
  const [menu, setMenu] = useState<string | null>(null);
  const [online, setOnline] = useState(false);
  /** The dock tab to reopen after folding it (▾ → ▴). */
  const lastTab = useRef('Event sheet');
  const [dialog, setDialog] = useState<null | 'prefs' | 'shortcuts' | 'about' | 'export' | 'rooms' | 'importScene'>(null);
  // The viewport's Shift+A menu opens the procedural rooms dialog too.
  useEffect(() => { const h = () => setDialog('rooms'); window.addEventListener('gc-rooms-dialog', h); return () => window.removeEventListener('gc-rooms-dialog', h); }, []);
  // "Show multiplayer menu" block (the start screen's Multiplayer button).
  useEffect(() => { const h = () => setOnline(true); window.addEventListener(OPEN_MULTIPLAYER, h); return () => window.removeEventListener(OPEN_MULTIPLAYER, h); }, []);
  useEffect(() => { try { localStorage.setItem('gc.sizes', JSON.stringify(sizes)); } catch { /* ignore */ } }, [sizes]);
  const errors = logs.filter((l) => l.level === 'error').length;


  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const inField = (e.target as HTMLElement)?.closest?.('input,textarea,select');
      if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); store.save().catch(() => undefined); return; }
      if (e.key === 'F5') { e.preventDefault(); store.get().play === 'edit' ? play() : stop(); return; }
      if (e.key === 'F6') { e.preventDefault(); pause(); return; }
      if (e.key === 'F7') { e.preventDefault(); step(); return; }
      if (inField || (e.target as HTMLElement)?.closest?.('.es-root,.bc-root')) return;
      if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); store.undo(); }
      if (mod && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) { e.preventDefault(); store.redo(); }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []);

  const drag = (which: 'left' | 'right' | 'bottom') => (e: React.PointerEvent) => {
    e.preventDefault();
    const start = { x: e.clientX, y: e.clientY, s: { ...sizes } };
    const move = (ev: PointerEvent) => setSizes((s: any) => ({ ...s, [which]: Math.max(120, which === 'left' ? start.s.left + ev.clientX - start.x : which === 'right' ? start.s.right - (ev.clientX - start.x) : start.s.bottom - (ev.clientY - start.y)) }));
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };

  const saveAs = async () => {
    const name = window.prompt('Save a copy as', project.name + ' copy');
    if (!name) return;
    const copy = deepClone(project);
    copy.name = name; copy.id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + Date.now().toString(36); copy.created = new Date().toISOString();
    await api.save(copy);
    store.open(copy);
    store.log('info', `Saved a copy as "${name}"`);
  };
  const exportFile = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(project, null, 1)], { type: 'application/json' })); a.download = project.name.replace(/[^A-Za-z0-9_-]+/g, '_') + '.gamecraft.json'; a.click(); };
  const closeProject = () => { if (dirty && !window.confirm('Close without saving? Unsaved changes are kept in the autosave.')) return; stop(); onClose(); store.close(); }; // unmount the editor first so it never renders without a project
  const newScene = (mode: '2d' | '3d') => store.mutate('New scene', (p) => {
    const s = emptyScene('Scene ' + (p.scenes.length + 1), mode);
    s.instances.push(makeInstance(1, 'Camera', 'camera', { name: 'Camera', y: mode === '3d' ? 5 : 0, z: mode === '3d' ? 10 : 20, rx: mode === '3d' ? -25 : 0, camera: { ...DEFAULT_CAMERA, postfx: [], type: mode === '2d' ? 'orthographic' : 'perspective', orthoScale: 20 } }));
    s.sheetId = p.logic.sheets[0]?.id;
    p.scenes.push(s);
    setTimeout(() => store.set({ sceneId: s.id, selection: [] }));
  });

  const menus: Record<string, { label: string; action: () => void; key?: string; disabled?: boolean; sep?: boolean }[]> = {
    File: [
      { label: 'New / Open project…', action: closeProject },
      { label: 'Save', key: 'Ctrl+S', action: () => store.save() },
      { label: 'Save a copy…', action: saveAs },
      { label: 'Import scene…', action: () => setDialog('importScene'), sep: true },
      { label: 'Export game (Windows / Web / Android)…', action: () => setDialog('export'), sep: true },
      { label: 'Export project file (.json)', action: exportFile },
      { label: 'Close project', action: closeProject },
    ],
    Edit: [
      { label: `Undo ${store.undoLabel() ?? ''}`, key: 'Ctrl+Z', action: () => store.undo(), disabled: !store.canUndo() },
      { label: 'Redo', key: 'Ctrl+Shift+Z', action: () => store.redo(), disabled: !store.canRedo() },
      { label: 'Duplicate', key: 'Shift+D', action: duplicateSelection, sep: true },
      { label: 'Delete', key: 'X / Del', action: deleteSelection },
      { label: 'Group', key: 'Ctrl+G', action: groupSelection },
      { label: 'Make prefab', action: makePrefab },
      { label: 'Preferences…', action: () => setDialog('prefs'), sep: true },
    ],
    Add: [
      ...ADD_MENU.flatMap((g) => g.items.map((it, n) => ({ label: `${g.group} › ${it.label}`, action: () => addObject(it.kind, it.type, it.extra), sep: n === 0 }))),
      ...(curScene(project).mode !== '2d' ? [{ label: 'Procedural rooms (3D)…', action: () => setDialog('rooms'), sep: true }] : []),
    ],
    Scene: [
      { label: 'New 3D scene', action: () => newScene('3d') }, { label: 'New 2D scene', action: () => newScene('2d') },
      { label: 'Duplicate scene', action: () => store.mutate('Duplicate scene', (p) => { const c = deepClone(curScene(p)); c.id = 'scene_' + Date.now().toString(36); c.name += ' copy'; p.scenes.push(c); }) },
      { label: 'Set as start scene', action: () => store.mutate('Start scene', (p) => { p.startSceneId = store.get().sceneId; }) },
      { label: 'Delete scene', disabled: project.scenes.length < 2, action: () => { if (window.confirm('Delete this scene?')) { const id = store.get().sceneId; store.mutate('Delete scene', (p) => { p.scenes = p.scenes.filter((s) => s.id !== id); if (p.startSceneId === id) p.startSceneId = p.scenes[0].id; }); store.set({ sceneId: store.get().project!.scenes[0].id }); } } },
    ],
    Window: [
      ...(['hierarchy', 'inspector', 'bottom', 'toolbar'] as const).map((p) => ({ label: `${panels[p] ? '✓' : '  '} ${{ hierarchy: 'Outliner', inspector: 'Properties', bottom: 'Bottom dock', toolbar: 'Toolbar' }[p]}`, action: () => store.set({ panels: { ...panels, [p]: !panels[p] } }) })),
      { label: 'Reset layout', sep: true, action: () => { store.set({ panels: { hierarchy: true, inspector: true, bottom: true, toolbar: true } }); setSizes({ left: 240, right: 330, bottom: 260 }); store.set({ bottomTab: 'Assets', rightTab: 'Inspector' }); } },
    ],
    Help: [
      { label: 'Start template tutorial', action: () => store.set({ tutorialStep: 0 }), disabled: !project.tutorial },
      { label: 'Keyboard shortcuts', action: () => setDialog('shortcuts') },
      { label: 'User guide (docs/USER_GUIDE.md)', action: () => store.log('info', 'Open Application/docs/USER_GUIDE.md and docs/CONSTRUCT2_MAPPING.md for the full guide.') },
      { label: 'About GameCraft', action: () => setDialog('about') },
    ],
  };

  const bottom = panels.bottom;
  const folded = bottomTab === 'Layout';
  if (!folded) lastTab.current = bottomTab;
  return (
    <div className="editor" onClick={() => setMenu(null)}>
      <div className="menubar">
        <img src="/icon.png" className="logo" alt="" /><b className="brand">GameCraft</b>
        {Object.keys(menus).map((m) => (
          <div key={m} className={'menu' + (menu === m ? ' open' : '')} onClick={(e) => { e.stopPropagation(); setMenu(menu === m ? null : m); }} onMouseEnter={() => menu && setMenu(m)}>
            {m}
            {menu === m && (
              <div className="menu-drop" onClick={(e) => e.stopPropagation()}>
                {menus[m].map((it, i) => <React.Fragment key={i}>{it.sep && i > 0 && <hr />}<button disabled={it.disabled} onClick={() => { setMenu(null); it.action(); }}><span>{it.label}</span>{it.key && <kbd>{it.key}</kbd>}</button></React.Fragment>)}
              </div>
            )}
          </div>
        ))}
        <div className="grow" style={{ flex: 1 }} />
        <div className="play-ctl" data-tut="play">
          {playState === 'edit'
            ? <button className="pbtn play" title="Play (F5)" onClick={play}><Icon name="play" size={14} /></button>
            : <><button className="pbtn" title="Pause / resume (F6)" onClick={pause}><Icon name={playState === 'paused' ? 'play' : 'pause'} size={14} /></button>
              <button className="pbtn" title="Step one tick (F7)" onClick={step}><Icon name="skip-forward" size={14} /></button>
              <button className="pbtn" title="Restart" onClick={restart}>⟲</button>
              <button className="pbtn stop" title="Stop (F5 / Esc)" onClick={stop}>■</button></>}
          <button className={'pbtn' + (editorRefs.session?.netHost?.peers.length || editorRefs.session?.netClient ? ' on' : '')} title="Multiplayer: create a game or join a friend's" onClick={() => { setNetConfig(project.settings.multiplayer); setOnline(true); }} style={{ width: 'auto', padding: '0 8px', gap: 4 }}><Icon name="globe" size={14} /> Multiplayer</button>
        </div>
        {online && <OnlineDialog gameId={store.get().project?.id ?? ''} getSession={() => editorRefs.session} startPlay={play} join={joinOnline} onClose={() => setOnline(false)} />}
        <span className="proj-name" title={project.id}>{project.name}{dirty ? ' •' : ''}</span>
        <button className="btn small" onClick={() => store.save()} title="Save (Ctrl+S)">Save</button>
      </div>
      <div className="workarea" style={{ gridTemplateColumns: `${panels.toolbar ? '40px ' : ''}${panels.hierarchy ? `min(${sizes.left}px, 20vw) 4px ` : ''}minmax(0, 1fr)${panels.inspector ? ` 4px min(${sizes.right}px, 28vw)` : ''}`, gridTemplateRows: `minmax(0, 1fr)${bottom ? (folded ? ` 0px ${TAB_ROW}px` : ` 4px min(${sizes.bottom}px, 55vh)`) : ''}` }}>
        {panels.toolbar && (
          <div className="toolbar">
            {([['select', '⬚', 'Select'], ['move', '✥', 'Move (G)'], ['rotate', '⟳', 'Rotate (R)'], ['scale', '⤡', 'Scale (S)']] as const).map(([t, i, l]) => <button key={t} title={l} className={store.get().tool === t ? 'on' : ''} onClick={() => store.set({ tool: t })}>{i}</button>)}
            <hr />
            <button title="Add (Shift+A)" onClick={(e) => { e.stopPropagation(); setMenu('Add'); }}>＋</button>
            <button title="Duplicate (Shift+D)" onClick={duplicateSelection}>⧉</button>
            <button title="Delete (X)" onClick={deleteSelection}><Icon name="trash-2" size={15} /></button>
            <button title="Undo (Ctrl+Z)" onClick={() => store.undo()}>↶</button>
            <button title="Redo (Ctrl+Shift+Z)" onClick={() => store.redo()}>↷</button>
          </div>
        )}
        {panels.hierarchy && <><div className="panel" data-tut="outliner"><div className="panel-title">Outliner</div><Outliner /></div><div className="split v" onPointerDown={drag('left')} /></>}
        <div className="panel center" data-tut="viewport" style={{ position: 'relative' }}>
          {!bottom && <button className="btn small" title="Show the bottom dock again (also Window › Bottom dock)" style={{ position: 'absolute', left: 8, bottom: 8, zIndex: 5 }} onClick={() => store.set({ panels: { ...panels, bottom: true } })}>▴ Dock</button>}
          <Viewport onImportFiles={(f) => { store.set({ bottomTab: 'Assets', panels: { ...store.get().panels, bottom: true } }); setTimeout(() => (window as any).__gcOpenImport?.(f), 50); }} /></div>
        {panels.inspector && <><div className="split v" onPointerDown={drag('right')} />
          <div className="panel" data-tut={rightTab === 'Effects' ? 'postfx' : 'inspector'}>
            <div className="tabs">{['Inspector', 'Effects'].map((t) => <button key={t} className={rightTab === t ? 'on' : ''} onClick={() => store.set({ rightTab: t })}>{t === 'Inspector' ? 'Properties' : 'Post-FX & World'}</button>)}</div>
            <div className="panel-scroll">{rightTab === 'Effects' ? <EffectsPanel /> : <Inspector />}</div>
          </div></>}
        {bottom && <><div className="split h" style={{ gridColumn: '1 / -1', ...(folded ? { pointerEvents: 'none' } : {}) }} onPointerDown={drag('bottom')} />
          <div className="panel bottom" style={{ gridColumn: '1 / -1' }} data-tut={bottomTab === 'Event sheet' ? 'eventsheet' : bottomTab === 'Assets' ? 'assets' : bottomTab === 'Animation' ? 'animation' : undefined}>
            <div className="tabs">
              {BOTTOM_TABS.map((t) => <button key={t} className={bottomTab === t ? 'on' : ''} title={t === 'Layout' ? 'Lay out the scene: the dock folds to these tabs so the viewport gets the room' : undefined} onClick={() => store.set({ bottomTab: t })}>{t}{t === 'Console' && errors ? <span className="badge">{errors}</span> : null}</button>)}
              <span className="grow" />
              {/* Fold to this tab row (any tab or ▴ opens it again); hiding it completely is Window › Bottom dock. */}
              {folded
                ? <button className="x" title="Open the dock" onClick={() => store.set({ bottomTab: lastTab.current })}>▴</button>
                : <button className="x" title="Fold the dock to its tabs" onClick={() => { lastTab.current = bottomTab; store.set({ bottomTab: 'Layout' }); }}>▾</button>}
            </div>
            <div className="bottom-body">
              {bottomTab === 'Event sheet' && <LogicPanel />}
              {bottomTab === 'Assets' && <AssetBrowser />}
              {bottomTab === 'Animation' && <AnimationPanel />}
              {bottomTab === 'Particles' && <ParticleEditor />}
              {bottomTab === 'Console' && <ConsolePanel />}
              {bottomTab === 'Debug' && <DebugPanel />}
            </div>
          </div></>}
      </div>
      <StatusBar />
      <Tutorial />
      {dialog === 'prefs' && <Prefs onClose={() => setDialog(null)} />}
      {dialog === 'importScene' && <ImportSceneDialog current={project} onClose={() => setDialog(null)} onOpen={(p) => { stop(); store.open(p); }} />}
      <ModelPanelHost />
      {dialog === 'export' && <ExportDialog onClose={() => setDialog(null)} />}
      {dialog === 'rooms' && <RoomsDialog onClose={() => setDialog(null)} />}
      {dialog === 'shortcuts' && <Shortcuts onClose={() => setDialog(null)} />}
      {dialog === 'about' && <Modal title="About GameCraft" onClose={() => setDialog(null)}><p><img src="/icon.png" width={64} style={{ float: 'left', marginRight: 12 }} />GameCraft 0.1 — visual game creation with Construct-style event sheets, Scratch-style blocks, Blender-style lights and cameras, and a logic standard shared with LogicCraft.</p><p className="hint">Rendering: three.js · Physics: deterministic AABB (shared runtime) · Pathfinding: grid A*.</p></Modal>}
    </div>
  );
}

function StatusBar() {
  const sel = useStore((s) => s.selection.length);
  const saved = useStore((s) => s.lastSaved);
  const dirty = useStore((s) => s.dirty);
  const last = useStore((s) => s.logs[s.logs.length - 1]);
  return (
    <div className="statusbar">
      <span>{sel ? `${sel} selected` : 'Nothing selected'}</span>
      <span className="grow">{last && <span className={'st-' + last.level}>{last.message}</span>}</span>
      <span>{dirty ? 'Unsaved changes (autosave every 20 s)' : `Saved ${new Date(saved).toLocaleTimeString()}`}</span>
      <span className="dim">MMB orbit · Shift+MMB pan · Wheel zoom · Alt+LMB orbit · G/R/S · Shift+A add</span>
    </div>
  );
}

function Prefs({ onClose }: { onClose: () => void }) {
  const snap = useStore((s) => s.snap);
  const project = useStore((s) => s.project)!;
  const rs = { ...DEFAULT_RENDER, ...project.settings.render };
  const setRs = (patch: Partial<typeof rs>, key?: string) => store.mutate('Render settings', (p) => { p.settings.render = { ...DEFAULT_RENDER, ...p.settings.render, ...renderPatch(patch) }; }, key);
  return (
    <Modal title="Preferences" onClose={onClose}>
      <Row label="Snap move"><Num value={snap.move} step={0.05} min={0.01} onChange={(v) => store.set({ snap: { ...snap, move: v } })} /></Row>
      <Row label="Snap rotate (°)"><Num value={snap.rotate} step={1} min={1} onChange={(v) => store.set({ snap: { ...snap, rotate: v } })} /></Row>
      <Row label="Snap scale"><Num value={snap.scale} step={0.05} min={0.01} onChange={(v) => store.set({ snap: { ...snap, scale: v } })} /></Row>
      <Row label="Particle quality"><Slider value={project.settings.quality} min={0.1} max={1} step={0.05} onChange={(v) => store.mutate('Quality', (p) => { p.settings.quality = v; }, 'q')} /></Row>
      <Row label="Master volume"><Slider value={project.settings.volume} min={0} max={1} step={0.05} onChange={(v) => store.mutate('Volume', (p) => { p.settings.volume = v; }, 'vol')} /></Row>
      <Row label="Show FPS while playing" tip="Also shows draw calls, triangles and how many objects culling hid"><Check value={project.settings.showFps} onChange={(v) => store.mutate('Show FPS', (p) => { p.settings.showFps = v; })} /></Row>
      <h4>VR</h4>
      {(() => {
        const vr = { ...DEFAULT_VR, ...project.settings.vr };
        const setVr = (patch: Partial<typeof vr>, key?: string) => store.mutate('VR settings', (p) => { p.settings.vr = { ...DEFAULT_VR, ...p.settings.vr, ...patch }; }, key);
        return <>
          <Row label="WebXR Browser Preview" tip="Adds Enter VR while playing when a headset is available (Meta Quest browser; Chrome / Edge with SteamVR). Without one, play shows the desktop VR preview. Give the player the VR Player behavior. This is browser VR: GameCraft has no native Quest, OpenXR or SteamVR export"><Check value={vr.enabled} onChange={(v) => setVr({ enabled: v })} /></Row>
          {vr.enabled && <>
            <HardwarePending device="VR headset" what="VR play (WebXR, in the headset's browser) is tested in the desktop VR preview" />
            <Row label="Performance profile" tip={VR_PROFILES[vr.profile].doc}><select className="sel" value={vr.profile} onChange={(e) => setVr({ profile: e.target.value as any })}>{Object.entries(VR_PROFILES).map(([k, p]) => <option key={k} value={k}>{p.name}</option>)}</select></Row>
            <Row label="Play area"><select className="sel" value={vr.playArea} onChange={(e) => setVr({ playArea: e.target.value as any })}><option value="standing">Standing / room scale</option><option value="seated">Seated</option></select></Row>
            <Row label="Comfort vignette" tip="Darkens the edges of the view while moving with the stick (less motion sickness)"><Check value={vr.comfortVignette} onChange={(v) => setVr({ comfortVignette: v })} /></Row>
            <Row label="Resolution scale" tip="0 = the profile's own"><Num value={vr.resolutionScale} step={0.05} min={0} max={1.5} onChange={(v) => setVr({ resolutionScale: Math.max(0, v) }, 'vrrs')} /></Row>
            <Row label="Foveation" tip="Lower detail at the edges of the lenses (0 = the profile's own, up to 1)"><Num value={vr.foveation} step={0.1} min={0} max={1} onChange={(v) => setVr({ foveation: Math.max(0, Math.min(1, v)) }, 'vrfov')} /></Row>
            <Row label="Refresh rate (Hz)" tip="Frame rate to ask the headset for (Quest 2: 72 / 90 / 120, Quest 3: 72 / 90 / 120). 0 = the profile's own. Higher is smoother but needs a lighter scene"><Num value={vr.refreshRate ?? 0} step={1} min={0} max={144} precision={0} onChange={(v) => setVr({ refreshRate: Math.max(0, Math.round(v)) }, 'vrhz')} /></Row>
            <Row label="Player height (m)" tip="Sets the eye height when seated (standing uses your real height)"><Num value={vr.playerHeight ?? 1.7} step={0.05} min={0.8} max={2.3} onChange={(v) => setVr({ playerHeight: Math.max(0.8, Math.min(2.3, v)) }, 'vrph')} /></Row>
            <Row label="Haptics strength" tip="Controller vibration for grabbing, letting go, teleporting and the Vibrate controller block. 0 = off"><Slider value={vr.haptics ?? 1} min={0} max={1} step={0.05} onChange={(v) => setVr({ haptics: v }, 'vrhap')} /></Row>
            <Row label="VR actions" tip="Add Grab, Release, Teleport, Move, Turn, Interact, Primary, Secondary and Menu (controllers plus keyboard for the preview) to the input actions"><button className="btn small" onClick={() => store.mutate('Add VR actions', (p) => { p.logic.inputActions = { ...(p.logic.inputActions ?? DEFAULT_ACTIONS), ...VR_ACTIONS }; })}>Add VR actions</button></Row>
          </>}
        </>;
      })()}
      <h4>Marks &amp; blood</h4>
      {(() => {
        const m = project.logic.marks ?? {}, bl = { ...BULLET_DEFAULTS, ...m.bullet }, bd = { ...BLOOD_DEFAULTS, ...m.blood };
        const setBl = (patch: Partial<BulletMarkSettings>, key?: string) => store.mutate('Bullet holes', (p) => { p.logic.marks = { ...p.logic.marks, bullet: { ...p.logic.marks?.bullet, ...patch } }; }, key);
        const setBd = (patch: Partial<BloodSettings>, key?: string) => store.mutate('Blood', (p) => { p.logic.marks = { ...p.logic.marks, blood: { ...p.logic.marks?.blood, ...patch } }; }, key);
        return <>
          <div className="hint">What Fire hitscan and Melee leave behind. Blood only runs for blocks with their Blood option on, or the Blood splatter block. To keep marks off one object, untick Takes marks in its properties.</div>
          <Row label="Bullet holes"><Check value={bl.enabled} onChange={(v) => setBl({ enabled: v })} /></Row>
          {bl.enabled && <>
            <Row label="Hole size (m)"><Num value={bl.size} step={0.01} min={0.01} max={2} onChange={(v) => setBl({ size: v }, 'blsz')} /></Row>
            <Row label="Hole lifetime (s)" tip="They fade out at the end. 0 = they stay"><Num value={bl.life} step={1} min={0} max={3600} precision={0} onChange={(v) => setBl({ life: v }, 'bllf')} /></Row>
            <Row label="Most holes at once" tip="The oldest goes when another is made"><Num value={bl.max} step={1} min={1} max={500} precision={0} onChange={(v) => setBl({ max: Math.round(v) }, 'blmx')} /></Row>
          </>}
          <Row label="Blood"><Check value={bd.enabled} onChange={(v) => setBd({ enabled: v })} /></Row>
          {bd.enabled && <>
            <Row label="Intensity" tip="How many chunks fly and how many patches land"><Slider value={bd.intensity} min={0.1} max={3} step={0.1} onChange={(v) => setBd({ intensity: v }, 'bdin')} /></Row>
            <Row label="Patch size (m)"><Num value={bd.size} step={0.1} min={0.1} max={8} onChange={(v) => setBd({ size: v }, 'bdsz')} /></Row>
            <Row label="Colour"><Color value={bd.color} onChange={(v) => setBd({ color: v }, 'bdcl')} /></Row>
            <Row label="Patch lifetime (s)" tip="They fade out at the end. 0 = they stay"><Num value={bd.life} step={1} min={0} max={3600} precision={0} onChange={(v) => setBd({ life: v }, 'bdlf')} /></Row>
            <Row label="Most patches at once" tip="The oldest goes when another is made"><Num value={bd.max} step={1} min={1} max={300} precision={0} onChange={(v) => setBd({ max: Math.round(v) }, 'bdmx')} /></Row>
          </>}
        </>;
      })()}
      <h4>Multiplayer</h4>
      {(() => {
        const mp = project.settings.multiplayer ?? {};
        const setMp = (patch: Partial<typeof mp>, key?: string) => store.mutate('Multiplayer servers', (p) => { p.settings.multiplayer = { ...p.settings.multiplayer, ...patch }; }, key);
        const turn = mp.iceServers?.find((s) => String(s.urls).startsWith('turn')) ?? null;
        const setTurn = (t: { urls: string; username?: string; credential?: string } | null) => setMp({ iceServers: [...(mp.iceServers ?? []).filter((s) => !String(s.urls).startsWith('turn')), ...(t && t.urls ? [t] : [])] }, 'mpturn');
        return <>
          <div className="hint">Friends join with a 6-character code (Start screen › Multiplayer, Pause menu › Invite). By default the games find each other through public WebTorrent trackers and connect directly. Add your own servers here for a game you publish; nothing private is built in.</div>
          <Row label="Own trackers" tip="WebSocket addresses of WebTorrent-compatible trackers you run (e.g. bittorrent-tracker), one per line: wss://tracker.example.com"><textarea className="txt" rows={2} value={(mp.trackers ?? []).join('\n')} placeholder="wss://tracker.example.com" onChange={(e) => setMp({ trackers: e.target.value.split('\n').map((s) => s.trim()).filter(Boolean) }, 'mptr')} onKeyDown={(e) => e.stopPropagation()} /></Row>
          <Row label="TURN relay" tip="For players whose routers block direct connections: turn:host:3478 with its username and password. Players can read these from the game, so use limited or short-lived ones"><input className="txt" value={turn ? String(turn.urls) : ''} placeholder="turn:turn.example.com:3478" onChange={(e) => setTurn({ ...(turn as any), urls: e.target.value.trim() })} onKeyDown={(e) => e.stopPropagation()} /></Row>
          {turn && <>
            <Row label="TURN username"><input className="txt" value={turn.username ?? ''} onChange={(e) => setTurn({ ...(turn as any), username: e.target.value })} onKeyDown={(e) => e.stopPropagation()} /></Row>
            <Row label="TURN password"><input className="txt" type="password" autoComplete="off" value={String(turn.credential ?? '')} onChange={(e) => setTurn({ ...(turn as any), credential: e.target.value })} onKeyDown={(e) => e.stopPropagation()} /></Row>
          </>}
          {!!mp.trackers?.length && <Row label="Also use the public trackers" tip="Off: only your own servers"><Check value={mp.keepPublic !== false} onChange={(v) => setMp({ keepPublic: v })} /></Row>}
        </>;
      })()}
      <h4>Rendering performance</h4>
      <Row label="Graphics preset" tip="Sets quality, render scale, anti-aliasing, shadows and textures together. Changing any of them afterwards makes it Custom. Max FPS and culling are yours and stay as they are"><select className="sel" value={rs.preset ?? 'custom'} onChange={(e) => { const v = e.target.value; setRs(v === 'custom' ? { preset: 'custom' } : presetPatch(v as GraphicsPreset)); }}>{(Object.keys(GRAPHICS_PRESETS) as GraphicsPreset[]).map((k) => <option key={k} value={k}>{GRAPHICS_PRESETS[k].label}</option>)}<option value="custom">Custom</option></select></Row>
      <Row label="Quality" tip="Shadow filtering and resolution, and how sharp the image is on high-DPI screens. Lights can override their own shadow resolution"><select className="sel" value={rs.quality ?? 'high'} onChange={(e) => setRs({ quality: e.target.value as any })}>{(Object.keys(QUALITY) as (keyof typeof QUALITY)[]).map((k) => <option key={k} value={k}>{QUALITY[k].label}</option>)}</select></Row>
      <Row label="Max FPS" tip="Draws at most this many frames a second, which keeps the computer cooler. The game's logic and physics keep their own fixed rate. 0 = as fast as the display"><Num value={rs.maxFps ?? 0} step={5} min={0} onChange={(v) => setRs({ maxFps: Math.max(0, v) }, 'mf')} /></Row>
      <Row label="VSync" tip="Web views always draw in step with the display, so tearing cannot happen and frame rate cannot go above the display's refresh rate. Turning this off would need a native renderer"><span className="hint small">Always on (set by the web view)</span></Row>
      <Row label="Render scale" tip="Draws at this fraction of the window's resolution and stretches the result. Lower is much faster and softer. Above 1 is sharper and slower"><Slider value={rs.renderScale ?? 1} min={0.25} max={2} step={0.05} onChange={(v) => setRs({ renderScale: v }, 'rsc')} /></Row>
      <Row label="High-DPI sharpness" tip="Use the screen's extra pixels on high-DPI displays (up to the Quality setting's limit). Off draws one pixel per window pixel: faster on laptop and phone screens"><Check value={rs.hiDpi !== false} onChange={(v) => setRs({ hiDpi: v })} /></Row>
      <Row label="Renderer" tip="GameCraft has one renderer, three.js forward rendering on WebGL2. Deferred and mobile renderers would need a separate rendering backend, so they are not offered"><span className="hint small">Forward (the only renderer)</span></Row>
      <Section title="Anti-aliasing and shading" defaultOpen={false}>
      <Row label="Anti-aliasing" tip="Smooths jagged edges. Multisample is the default and now also stays on with post effects; FXAA is fastest (slightly softer), SMAA is sharper, Supersampling is the best and slowest. TAA is not available: it needs per-object motion vectors, which this renderer doesn't have"><select className="sel" value={rs.antialias ?? 'msaa'} onChange={(e) => setRs({ antialias: e.target.value as any })}><option value="none">Off</option><option value="msaa">Multisample (default)</option><option value="fxaa">FXAA (fast)</option><option value="smaa">SMAA (sharp)</option><option value="ssaa">Supersampling (best, slowest)</option><option value="taa" disabled>TAA (needs motion vectors, not available)</option></select></Row>
      {(rs.antialias ?? 'msaa') === 'msaa' && <Row label="Samples" tip="More samples are smoother and slower. Limited to what this graphics card allows"><select className="sel" value={rs.msaaSamples ?? 4} onChange={(e) => setRs({ msaaSamples: Number(e.target.value) })}>{[2, 4, 8].map((n) => <option key={n} value={n}>{n}×</option>)}</select></Row>}
      <Row label="Ambient occlusion" tip="Soft shadows in creases, corners and where objects meet the ground (screen-space, Rendered view and play). 0 = off"><Slider value={rs.ambientOcclusion ?? 0} min={0} max={2} step={0.05} onChange={(v) => setRs({ ambientOcclusion: v }, 'ao')} /></Row>
      </Section>
      <Section title="Shadows" defaultOpen={false}>
      <Row label="Shadows" tip="Off: no object casts a shadow, whatever its light says. Much faster"><Check value={rs.shadows !== false} onChange={(v) => setRs({ shadows: v })} /></Row>
      {rs.shadows !== false && <>
        <Row label="Shadow filter" tip="How shadow edges are smoothed. Automatic follows Quality"><select className="sel" value={rs.shadowFilter ?? ''} onChange={(e) => setRs({ shadowFilter: (e.target.value || undefined) as any })}><option value="">Automatic</option>{(Object.keys(SHADOW_FILTERS) as (keyof typeof SHADOW_FILTERS)[]).map((k) => <option key={k} value={k}>{SHADOW_FILTERS[k].label}</option>)}</select></Row>
        <Row label="Shadow resolution" tip="For lights without their own setting. Bigger is sharper and uses more graphics memory"><select className="sel" value={rs.shadowResolution ?? 0} onChange={(e) => setRs({ shadowResolution: Number(e.target.value) })}><option value={0}>Automatic</option>{[512, 1024, 2048, 4096].map((n) => <option key={n} value={n}>{n}</option>)}</select></Row>
        <Row label="Sun shadow distance (m)" tip="How far from the camera the sun's shadows reach, for suns without their own setting. Shorter is sharper. 0 = automatic"><Num value={rs.shadowDistance ?? 0} step={5} min={0} onChange={(v) => setRs({ shadowDistance: Math.max(0, v) }, 'sdd')} /></Row>
      </>}
      {rs.shadows !== false && <>
        <Row label="Cascaded shadows" tip="While playing in 3D: several sun shadow maps, sharp near the camera and wider further out, for big outdoor levels. More cascades look better and cost more. Other suns stop casting shadows while this is on"><select className="sel" value={rs.cascades ?? 0} onChange={(e) => setRs({ cascades: Number(e.target.value) })}><option value={0}>Off (one shadow map)</option>{[2, 3, 4].map((n) => <option key={n} value={n}>{n} cascades</option>)}</select></Row>
        {!!rs.cascades && <Row label="Cascades reach (m)" tip="How far from the camera the cascades go. Shorter is sharper. 0 = 150 m"><Num value={rs.cascadeDistance ?? 0} step={10} min={0} onChange={(v) => setRs({ cascadeDistance: Math.max(0, v) }, 'cd')} /></Row>}
      </>}
      <Row label="Contact shadows" tip="Thin dark lines where objects touch or sit close, which shadow maps are too coarse to show. Needs a sun. 3D only. Not with Supersampling, screen-space reflections or Pixelate. 0 = off"><Slider value={rs.contactShadows ?? 0} min={0} max={1} step={0.05} onChange={(v) => setRs({ contactShadows: v }, 'cs')} /></Row>
      </Section>
      <Section title="Textures" defaultOpen={false}>
      <Row label="Texture quality" tip="How sharp textures stay when seen at an angle (anisotropic filtering)"><select className="sel" value={rs.textureQuality ?? 'high'} onChange={(e) => setRs({ textureQuality: e.target.value as any })}><option value="low">Low (1×)</option><option value="medium">Medium (4×)</option><option value="high">High (8×, default)</option><option value="max">Max (16×)</option></select></Row>
      <Row label="Texture filter" tip="How textures blend between sizes. Pixel-art textures set to crisp keep their own filter"><select className="sel" value={rs.textureFilter ?? 'trilinear'} onChange={(e) => setRs({ textureFilter: e.target.value as any })}><option value="trilinear">Trilinear (smooth)</option><option value="bilinear">Bilinear (faster)</option></select></Row>
      <Row label="Largest texture" tip="Bigger textures are shrunk when they load, which saves graphics memory. Files on disk are not changed"><select className="sel" value={rs.textureMaxSize ?? 0} onChange={(e) => setRs({ textureMaxSize: Number(e.target.value) })}><option value={0}>No limit</option>{[512, 1024, 2048, 4096].map((n) => <option key={n} value={n}>{n}</option>)}</select></Row>
      <Row label="Compressed textures" tip="While playing, pictures are turned into graphics-card blocks (BC on computers, ETC2 on phones) in the background, using 4 to 8 times less graphics memory. Slightly lossy, so look closely at fine detail. Normal maps and pixel art are left alone. If the graphics card reads neither format, nothing changes"><Check value={!!rs.textureCompression} onChange={(v) => setRs({ textureCompression: v })} /></Row>
      <Row label="Texture streaming" tip="While playing, each picture stays on the graphics card only as large as it appears on screen right now, and comes back when you get closer. The pictures stay in main memory: this saves graphics memory, not loading time"><Check value={!!rs.textureStreaming} onChange={(v) => setRs({ textureStreaming: v })} /></Row>
      {!!rs.textureStreaming && <Row label="Texture budget (MB)" tip="Streaming keeps textures under this much graphics memory, shrinking what is least needed. 0 = no limit"><Num value={rs.textureBudgetMb ?? 0} step={32} min={0} onChange={(v) => setRs({ textureBudgetMb: Math.max(0, v) }, 'tb')} /></Row>}
      </Section>
      <Section title="Culling and level of detail">
      <Row label="Automatic instancing" tip="While playing, objects with the same mesh and the same look are drawn together in one draw call, which is much faster for levels built from repeated pieces. Works even when logic moves or hides them: anything that stops matching draws itself again. Animated characters, see-through objects and objects with effects always draw themselves"><Check value={rs.instancing !== false} onChange={(v) => setRs({ instancing: v })} /></Row>
      <Row label="Draw distance (m)" tip="Objects farther than this are not drawn. 0 = unlimited"><Num value={rs.drawDistance} step={10} min={0} onChange={(v) => setRs({ drawDistance: Math.max(0, v) }, 'dd')} /></Row>
      <Row label="Frustum culling" tip="Skip drawing what is outside the camera's view. Animated characters are always drawn (their limbs reach outside their bounds)"><Check value={rs.frustum} onChange={(v) => setRs({ frustum: v })} /></Row>
      <Row label="Occlusion culling" tip="Skip drawing objects hidden behind Solid walls, floors and ceilings. Off by default: turn on for big indoor levels and check with Visibility debug"><Check value={rs.occlusion} onChange={(v) => setRs({ occlusion: v })} /></Row>
      <Row label="Level of detail (LOD)" tip="Far models use simplified copies of their mesh (made automatically in the background)"><Check value={rs.lod} onChange={(v) => setRs({ lod: v })} /></Row>
      {rs.lod && <Row label="LOD distances (m)" tip="Switch to the simplified (50%) and the most simplified (20%) mesh beyond these distances. 0 = automatic from the size on screen. Switching back needs 10% closer, so models never flicker on the boundary"><span className="pair"><Num value={rs.lodNear} step={5} min={0} onChange={(v) => setRs({ lodNear: Math.max(0, v) }, 'ln')} /><Num value={rs.lodFar} step={5} min={0} onChange={(v) => setRs({ lodFar: Math.max(0, v) }, 'lf')} /></span></Row>}
      {rs.lod && <Row label="LOD blend (s)" tip="How long a switch between detail levels cross-fades (the old one dissolves over the new). 0 = instant"><Num value={rs.lodBlend ?? 0.3} step={0.05} min={0} onChange={(v) => setRs({ lodBlend: Math.max(0, Math.min(2, v)) }, 'lb')} /></Row>}
      <Row label="Visibility debug" tip="While playing: every object's bounds, through walls, coloured by what culling decided (green drawn, cyan/blue LOD 1/2, red hidden behind walls, grey too far / outside its visible range), plus the counts"><Check value={rs.debug} onChange={(v) => setRs({ debug: v })} /></Row>
      {rs.debug && <Row label="Debug view" tip="From above: culling still uses the game camera, but you watch from high above with its view frustum drawn in yellow"><select className="sel" value={rs.debugView ?? 'game'} onChange={(e) => setRs({ debugView: e.target.value as 'game' | 'above' })}><option value="game">Through the game camera</option><option value="above">From above (shows the frustum)</option></select></Row>}
      </Section>
    </Modal>
  );
}

function Shortcuts({ onClose }: { onClose: () => void }) {
  const rows = [
    ['Viewport', ''], ['Orbit / pan / zoom', 'MMB / Shift+MMB / Wheel (or Alt+LMB)'], ['Front / right / top view', 'Numpad 1 / 3 / 7 (Ctrl = opposite), or Alt+1/3/7'], ['Persp / ortho', 'Numpad 5'], ['Camera view', 'Numpad 0'],
    ['Frame selected / all', 'Numpad . or F / Home'], ['Move / rotate / scale', 'G / R / S, then X Y Z to lock, type a number, Enter/click'], ['Cancel transform', 'Esc or right-click'],
    ['Add object', 'Shift+A'], ['Duplicate', 'Shift+D'], ['Delete', 'X (confirm) / Delete'], ['Select all / none', 'A / Alt+A'], ['Hide / unhide', 'H / Alt+H'], ['Group', 'Ctrl+G'], ['Parent to active / clear', 'Ctrl+P / Alt+P'],
    ['Shading', 'Z cycles rendered → solid → wireframe'], ['Toggle properties / toolbar', 'N / T'],
    ['Game', ''], ['Play / stop', 'F5'], ['Pause / step', 'F6 / F7'], ['Save / undo / redo', 'Ctrl+S / Ctrl+Z / Ctrl+Shift+Z'],
    ['Event sheet', ''], ['Edit block', 'Double-click or Enter'], ['Invert condition', 'I'], ['Copy / paste / duplicate / delete', 'Ctrl+C / Ctrl+V / Ctrl+D / Del'],
  ];
  return <Modal title="Keyboard shortcuts" onClose={onClose}><table className="keys"><tbody>{rows.map(([a, b]) => b ? <tr key={a}><td>{a}</td><td><kbd>{b}</kbd></td></tr> : <tr key={a}><th colSpan={2}>{a}</th></tr>)}</tbody></table></Modal>;
}
