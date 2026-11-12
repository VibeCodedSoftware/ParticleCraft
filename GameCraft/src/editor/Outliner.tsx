// Scene hierarchy (Blender "Outliner"): folders, parent/child tree, rename, visibility, drag to re-parent or file
// into folders, search. Folders are editor organisation only (the game never sees them). Animated sprites show as one
// object with an arrow that lists their animations.
import React, { useMemo, useState } from 'react';
import { Icon } from '@shared/ui/icons';
import type { InstanceData, OutlinerFolder } from '@shared/src/runtime/scene';
import { newId } from '@shared/src/schema';
import { store, useStore } from '../project/store';
import { curScene, setParent } from './actions';
import { reparent } from './parenting';
import { ObjectContextMenu } from './ObjectContextMenu';

const ICON: Record<string, string> = { mesh: '△', box: '■', sphere: '●', cylinder: '▮', cone: '▲', plane: '▬', capsule: '⬭', torus: '◎', ramp: '◢', sprite: '▧', text: 'T', camera: '◉', light: '✺', emitter: '✦', empty: '✚' };
const UID = 'x-gc-uid', FOLDER = 'x-gc-folder';

/** Move objects (and their children, which follow their parent) into a folder, or out of folders (undefined). */
function fileInto(uids: number[], folder: string | undefined) {
  store.mutate(folder ? 'Move to folder' : 'Move out of folder', (p) => {
    const s = curScene(p);
    // A filed object becomes a top-level object of its folder, staying where it is.
    if (folder) reparent(s, uids.filter((u) => s.instances.find((i) => i.uid === u)?.parent != null), null);
    for (const i of s.instances) if (uids.includes(i.uid)) i.editor = { ...(i.editor ?? {}), folder };
  });
}

export function Outliner() {
  const project = useStore((s) => s.project);
  const selection = useStore((s) => s.selection);
  useStore((s) => s.rev);
  const [q, setQ] = useState('');
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const [rename, setRename] = useState<number | string | null>(null);
  const [dropOn, setDropOn] = useState<number | string | 'root' | null>(null);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  const scene = project ? curScene(project) : null;
  const folders = scene?.folders ?? [];
  const folderIds = new Set(folders.map((f) => f.id));
  const children = useMemo(() => {
    const m = new Map<number | undefined, InstanceData[]>();
    for (const i of scene?.instances ?? []) { const k = i.parent != null && scene!.instances.some((p) => p.uid === i.parent) ? i.parent : undefined; m.set(k, [...(m.get(k) ?? []), i]); }
    return m;
  }, [scene]);
  if (!project || !scene) return null;

  const roots = children.get(undefined) ?? [];
  const inFolder = (fid: string | undefined) => roots.filter((i) => (folderIds.has(i.editor?.folder ?? '') ? i.editor!.folder : undefined) === fid);
  const subFolders = (fid: string | undefined) => folders.filter((f) => (folderIds.has(f.parent ?? '') ? f.parent : undefined) === fid);
  const editFolders = (label: string, fn: (list: OutlinerFolder[], p: ReturnType<typeof curScene>) => void) => store.mutate(label, (p) => { const s = curScene(p); s.folders ??= []; fn(s.folders, s); });
  const isInside = (fid: string, ancestor: string): boolean => { for (let f = folders.find((x) => x.id === fid); f; f = folders.find((x) => x.id === f!.parent)) if (f.id === ancestor) return true; return false; };

  const click = (e: React.MouseEvent, uid: number) => {
    if (e.shiftKey || e.ctrlKey) store.set({ selection: selection.includes(uid) ? selection.filter((u) => u !== uid) : [...selection, uid] });
    else store.set({ selection: [uid] });
  };
  const dragUids = (e: React.DragEvent) => { const u = Number(e.dataTransfer.getData(UID)); return selection.includes(u) ? selection : [u]; };
  const allow = (e: React.DragEvent, key: number | string) => { if (e.dataTransfer.types.includes(UID) || e.dataTransfer.types.includes(FOLDER)) { e.preventDefault(); e.stopPropagation(); setDropOn(key); } };
  const matches = (i: InstanceData): boolean => !q || i.name.toLowerCase().includes(q.toLowerCase()) || i.type.toLowerCase().includes(q.toLowerCase()) || (children.get(i.uid) ?? []).some(matches);

  const row = (i: InstanceData, depth: number): React.ReactNode => {
    const kids = children.get(i.uid) ?? [];
    const anims = i.kind === 'sprite' ? Object.keys(i.sprite?.animations ?? {}) : [];
    const open = !collapsed.has(i.uid);
    if (!matches(i)) return null;
    return (
      <React.Fragment key={i.uid}>
        <div className={'ol-row' + (selection.includes(i.uid) ? ' sel' : '') + (selection[selection.length - 1] === i.uid ? ' active' : '') + (dropOn === i.uid ? ' drop' : '')}
          style={{ paddingLeft: 6 + depth * 14 }} draggable
          onDragStart={(e) => e.dataTransfer.setData(UID, String(i.uid))}
          onDragOver={(e) => { if (e.dataTransfer.types.includes(UID)) allow(e, i.uid); }}
          onDragLeave={() => setDropOn(null)}
          onDrop={(e) => { e.preventDefault(); e.stopPropagation(); setDropOn(null); const u = Number(e.dataTransfer.getData(UID)); if (u && u !== i.uid) setParent(dragUids(e), i.uid); }}
          onClick={(e) => click(e, i.uid)} onDoubleClick={() => setRename(i.uid)}
          onContextMenu={(e) => { e.preventDefault(); if (!store.get().selection.includes(i.uid)) store.set({ selection: [i.uid] }); setCtxMenu({ x: e.clientX, y: e.clientY }); }}>
          <span className="ol-tw" onClick={(e) => { e.stopPropagation(); const c = new Set(collapsed); c.has(i.uid) ? c.delete(i.uid) : c.add(i.uid); setCollapsed(c); }} title={anims.length ? 'Show its animations' : undefined}>{kids.length || anims.length ? (open ? '▾' : '▸') : ''}</span>
          <span className="ol-ic" style={{ color: i.kind === 'light' ? '#ffd27a' : i.kind === 'camera' ? '#9fd3ff' : i.color }}>{ICON[i.kind] ?? '•'}</span>
          {rename === i.uid
            ? <input autoFocus className="ol-rename" defaultValue={i.name} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setRename(null); }}
              onBlur={(e) => { const v = e.target.value.trim(); setRename(null); if (v && v !== i.name) store.mutate('Rename', (p) => { const x = curScene(p).instances.find((o) => o.uid === i.uid); if (x) x.name = v; }); }} />
            : <span className="ol-name">{i.name}</span>}
          {i.name !== i.type && <span className="ol-type">{i.type}</span>}
          {anims.length > 0 && <span className="ol-beh" title="Animations">{anims.length} anim</span>}
          {i.behaviors.length > 0 && <span className="ol-beh" title={i.behaviors.map((b) => b.type).join(', ')}>{i.behaviors.length} beh</span>}
          <span className={'ol-eye' + (i.editor?.hiddenInEditor ? ' off' : '')} title="Hide in viewport (H)" onClick={(e) => { e.stopPropagation(); store.mutate('Toggle visibility', (p) => { const x = curScene(p).instances.find((o) => o.uid === i.uid); if (x) x.editor = { ...(x.editor ?? {}), hiddenInEditor: !x.editor?.hiddenInEditor }; }); }}>{i.editor?.hiddenInEditor ? '○' : '●'}</span>
        </div>
        {open && anims.map((a) => (
          <div key={'a:' + a} className={'ol-row ol-anim' + (i.sprite!.animation === a ? ' active-anim' : '')} style={{ paddingLeft: 6 + (depth + 1) * 14 + 16 }}
            title="Click to preview this animation (it becomes the default)" onClick={(e) => { e.stopPropagation(); store.set({ selection: [i.uid] }); store.mutate('Preview animation', (p) => { const x = curScene(p).instances.find((o) => o.uid === i.uid); if (x?.sprite) x.sprite = { ...x.sprite, animation: a }; }); }}>
            <span className="ol-ic"><Icon name="play" size={11} /></span><span className="ol-name">{a}</span>
            <span className="ol-type">{i.sprite!.animations![a].to - i.sprite!.animations![a].from + 1} frames</span>
          </div>
        ))}
        {open && kids.map((k) => row(k, depth + 1))}
      </React.Fragment>
    );
  };

  const folderRow = (f: OutlinerFolder, depth: number): React.ReactNode => {
    const items = inFolder(f.id), subs = subFolders(f.id);
    const count = items.length;
    if (q && !items.some(matches) && !subs.length) return null;
    return (
      <React.Fragment key={f.id}>
        <div className={'ol-row ol-folder' + (dropOn === f.id ? ' drop' : '')} style={{ paddingLeft: 6 + depth * 14 }} draggable
          onDragStart={(e) => e.dataTransfer.setData(FOLDER, f.id)}
          onDragOver={(e) => allow(e, f.id)} onDragLeave={() => setDropOn(null)}
          onDrop={(e) => {
            e.preventDefault(); e.stopPropagation(); setDropOn(null);
            const fid = e.dataTransfer.getData(FOLDER);
            if (fid) { if (fid !== f.id && !isInside(f.id, fid)) editFolders('Move folder', (list) => { const x = list.find((y) => y.id === fid); if (x) x.parent = f.id; }); return; }
            if (e.dataTransfer.getData(UID)) fileInto(dragUids(e), f.id);
          }}
          onClick={() => store.set({ selection: items.map((i) => i.uid) })} onDoubleClick={() => setRename(f.id)}>
          <span className="ol-tw" onClick={(e) => { e.stopPropagation(); editFolders(f.collapsed ? 'Expand folder' : 'Collapse folder', (list) => { const x = list.find((y) => y.id === f.id); if (x) x.collapsed = !x.collapsed; }); }}>{f.collapsed ? '▸' : '▾'}</span>
          <span className="ol-ic ol-folder-ic" />
          {rename === f.id
            ? <input autoFocus className="ol-rename" defaultValue={f.name} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setRename(null); }}
              onBlur={(e) => { const v = e.target.value.trim(); setRename(null); if (v && v !== f.name) editFolders('Rename folder', (list) => { const x = list.find((y) => y.id === f.id); if (x) x.name = v; }); }} />
            : <span className="ol-name">{f.name}</span>}
          <span className="ol-type">{count}</span>
          <span className="ol-x" title="Remove folder (its objects move up a level)" onClick={(e) => {
            e.stopPropagation();
            editFolders('Remove folder', (list, s) => {
              for (const i of s.instances) if (i.editor?.folder === f.id) i.editor = { ...i.editor, folder: f.parent };
              for (const x of list) if (x.parent === f.id) x.parent = f.parent;
              s.folders = list.filter((x) => x.id !== f.id);
            });
          }}>✕</span>
        </div>
        {!f.collapsed && <>{subs.map((sf) => folderRow(sf, depth + 1))}{items.map((i) => row(i, depth + 1))}</>}
      </React.Fragment>
    );
  };

  const newFolder = () => {
    const id = newId('folder');
    const target = selection.length ? roots.filter((i) => selection.includes(i.uid)).map((i) => i.uid) : [];
    editFolders('New folder', (list, s) => {
      list.push({ id, name: `Folder ${list.length + 1}` });
      for (const i of s.instances) if (target.includes(i.uid)) i.editor = { ...(i.editor ?? {}), folder: id };
    });
    setRename(id);
  };

  return (
    <div className="outliner" onDragOver={(e) => allow(e, 'root')} onDragLeave={() => setDropOn(null)}
      onDrop={(e) => {
        if (dropOn !== 'root') return; e.preventDefault(); setDropOn(null);
        const fid = e.dataTransfer.getData(FOLDER);
        if (fid) { editFolders('Move folder', (list) => { const x = list.find((y) => y.id === fid); if (x) x.parent = undefined; }); return; }
        const u = Number(e.dataTransfer.getData(UID));
        if (u) { const uids = dragUids(e); setParent(uids, null); fileInto(uids, undefined); }
      }}>
      <div className="panel-tools">
        <select className="sel small" value={scene.id} onChange={(e) => store.set({ sceneId: e.target.value, selection: [] })} title="Scene">
          {project.scenes.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <input className="txt small" placeholder="Filter…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
        <button className="btn small" title="New folder (selected objects go into it)" onClick={newFolder}>+ Folder</button>
      </div>
      <div className={'ol-list' + (dropOn === 'root' ? ' drop-root' : '')}>
        {subFolders(undefined).map((f) => folderRow(f, 0))}
        {inFolder(undefined).map((i) => row(i, 0))}
      </div>
      {ctxMenu && <>
        <div style={{ position: 'fixed', inset: 0, zIndex: 1099 }} onPointerDown={() => setCtxMenu(null)} onContextMenu={(e) => { e.preventDefault(); setCtxMenu(null); }} />
        <ObjectContextMenu x={ctxMenu.x} y={ctxMenu.y} onClose={() => setCtxMenu(null)} />
      </>}
      <div className="ol-foot">{scene.instances.length} objects{folders.length ? ` · ${folders.length} folder(s)` : ''} · drag onto an object to parent, onto a folder to file, onto empty space to take out · right-click for more</div>
    </div>
  );
}
