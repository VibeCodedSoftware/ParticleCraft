// Import LogicCraft scene: a scene exported from LogicCraft joins a project (this one or another) as a new scene, or becomes
// a new project. Whatever the project already has stays as it is.
import React, { useEffect, useState } from 'react';
import { compatibilityReport } from '@shared/src/validate';
import { dataUrlBytes, isSceneFile, mergeScenePackage, packageAssets, parseScenePackage, type MergeReport, type PackageAsset, type ScenePackage } from '@shared/src/scenePackage';
import { api, type ProjectListItem } from '../project/api';
import { store } from '../project/store';
import type { GameProject } from '../project/types';
import { emptyProject } from '../templates/empty';
import { Modal } from './ui';

/** A picture of an emoji, as LogicCraft draws it on its stage. */
async function emojiPicture(e: string, size = 128): Promise<ArrayBuffer> {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d')!;
  g.font = `${Math.round(size * 0.82)}px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(e, size / 2, size * 0.54);
  const blob = await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Could not draw ' + e))), 'image/png'));
  return blob.arrayBuffer();
}

/** Copy the package's pictures and files into the project's folder; returns each one's id in the project. */
async function writeAssets(projectId: string, pkg: ScenePackage): Promise<{ list: PackageAsset[]; ids: Map<string, string> }> {
  const list = packageAssets(pkg), ids = new Map<string, string>();
  for (const a of list) {
    await api.putFile(projectId, a.rel, a.emoji ? await emojiPicture(a.emoji) : dataUrlBytes(a.dataUrl!));
    ids.set(a.ref, 'proj:' + a.rel);
  }
  return { list, ids };
}

function addAssetRefs(p: GameProject, list: PackageAsset[], ids: Map<string, string>) {
  for (const a of list) {
    const id = ids.get(a.ref)!;
    if (p.assets.some((x) => x.id === id)) continue;
    // Only pictures are textures; videos and sound files are found through their blocks.
    if (/\.(png|jpe?g|gif|webp)$/i.test(a.rel)) p.assets.push({ id, name: a.name, kind: 'texture', source: 'imported' });
  }
}

export function summarize(r: MergeReport): string {
  const notes: string[] = [];
  if (r.renamedScenes.length) notes.push(`renamed ${r.renamedScenes.map(([a, b]) => `"${a}" to "${b}"`).join(', ')}, as the project already had those names`);
  if (r.keptVariables.length) notes.push(`variables the project already has kept their values: ${r.keptVariables.join(', ')}`);
  if (r.keptEffects.length) notes.push(`particle effects the project already has were kept: ${r.keptEffects.join(', ')}`);
  return notes.join('; ');
}

/** The package as a new project of its own. */
async function newProjectFrom(pkg: ScenePackage): Promise<GameProject> {
  const p = emptyProject('2d') as GameProject;
  p.name = pkg.name;
  p.id = (pkg.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'scene') + '-' + Date.now().toString(36);
  p.template = undefined; p.tutorial = undefined;
  p.logic.name = pkg.name;
  const { list, ids } = await writeAssets(p.id, pkg);
  const blank = p.scenes[0], blankSheet = blank.sheetId;
  const r = mergeScenePackage(p, pkg, (ref) => ids.get(ref));
  p.scenes = p.scenes.filter((s) => s !== blank);
  p.logic.sheets = p.logic.sheets.filter((s) => s.id !== blankSheet);
  p.startSceneId = r.sceneIds[0];
  addAssetRefs(p, list, ids);
  await api.save(p);
  return p;
}

/** Into a saved project that isn't open. */
async function addToSaved(id: string, pkg: ScenePackage): Promise<GameProject> {
  const p = await api.load(id);
  const { list, ids } = await writeAssets(p.id, pkg);
  mergeScenePackage(p, pkg, (ref) => ids.get(ref));
  addAssetRefs(p, list, ids);
  await api.save(p);
  return p;
}

export function ImportSceneDialog({ current, onOpen, onClose }: { current?: GameProject; onOpen: (p: GameProject) => void; onClose: () => void }) {
  const [files, setFiles] = useState<{ path: string; modified: number }[] | null>(null);
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [pkg, setPkg] = useState<ScenePackage | null>(null);
  const [target, setTarget] = useState(current ? 'this' : 'new');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api.exchangeList().then((l) => setFiles(l.filter((f) => isSceneFile(f.path)).sort((a, b) => b.modified - a.modified))).catch((e) => { setFiles([]); setMsg('Exchange folder unavailable: ' + e.message); });
    api.list().then(setProjects).catch(() => undefined);
  }, []);
  const read = (text: string) => { try { setPkg(parseScenePackage(text)); setMsg(''); } catch (e: any) { setPkg(null); setMsg(e.message); } };
  const report = pkg && compatibilityReport(pkg.logic, 'gamecraft');
  const go = async () => {
    if (!pkg) return;
    setBusy(true);
    try {
      if (target === 'this' && current) {
        const { list, ids } = await writeAssets(current.id, pkg);
        let r: MergeReport | undefined;
        store.mutate('Import LogicCraft scene', (p) => { r = mergeScenePackage(p, pkg, (ref) => ids.get(ref)); addAssetRefs(p, list, ids); });
        store.set({ sceneId: r!.sceneIds[0], selection: [] });
        store.log('info', `Added ${pkg.scenes.length} scene${pkg.scenes.length === 1 ? '' : 's'} from ${pkg.sourceApp === 'worldcraft' ? 'WorldCraft' : 'LogicCraft'}${summarize(r!) ? ': ' + summarize(r!) : ''}.`);
        onClose();
      } else {
        const p = target === 'new' ? await newProjectFrom(pkg) : await addToSaved(target, pkg);
        onOpen(p);
        if (target !== 'new') store.set({ sceneId: p.scenes[p.scenes.length - pkg.scenes.length].id });
        onClose();
      }
    } catch (e: any) { setMsg('Could not import: ' + e.message); }
    setBusy(false);
  };
  return (
    <Modal title="Import scene" onClose={onClose} footer={pkg ? <button className="btn primary" disabled={busy} onClick={go}>{busy ? 'Importing…' : target === 'new' ? 'Create project' : 'Add scene'}</button> : undefined}>
      <p className="hint">In LogicCraft use File › Export as scene for GameCraft; in WorldCraft, Export › Export to GameCraft. Objects, pictures and logic all come across. What the project already has stays as it is.</p>
      <div className="btn-row"><label className="btn">Open a scene file…<input type="file" accept=".json" hidden onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) read(await f.text()); }} /></label></div>
      <h4>Exported from LogicCraft and WorldCraft</h4>
      <div className="exch-list">{files === null ? <i>Looking…</i> : files.length ? files.map((f) => <button key={f.path} className="exch" onClick={async () => { try { read(await api.exchangeGet(f.path)); } catch (e: any) { setMsg(e.message); } }}>{f.path.replace(/\.scene\.json$/i, '')}<span>{new Date(f.modified).toLocaleString()}</span></button>) : <i>Nothing exported yet.</i>}</div>
      {msg && <div className="warn">{msg}</div>}
      {pkg && report && (
        <div className="exch-report">
          <b>{pkg.name}</b>: {pkg.scenes.length} scene{pkg.scenes.length === 1 ? '' : 's'} ({pkg.scenes.map((s) => s.name).join(', ')}), {report.blockCount} blocks, {report.supported} run in GameCraft.
          {report.unsupported.map((u) => <div key={u.blockId} className="warn">"{u.name}" only runs in {u.apps.join(', ')}: kept, skipped when playing.</div>)}
          {report.unknown.map((u) => <div key={u.blockId} className="warn">Unknown block {u.block}: kept, skipped.</div>)}
          <h4>Put it in</h4>
          <select className="sel" value={target} onChange={(e) => setTarget(e.target.value)}>
            {current && <option value="this">This project ({current.name}), as a new scene</option>}
            <option value="new">A new project</option>
            {projects.filter((p) => p.id !== current?.id).length > 0 && <optgroup label="Another project, as a new scene">{projects.filter((p) => p.id !== current?.id).map((p) => <option key={p.id} value={p.id}>{p.name} ({new Date(p.modified).toLocaleString()})</option>)}</optgroup>}
          </select>
          {current && target !== 'this' && <p className="hint">This closes the project you have open. Save it first if it has changes.</p>}
        </div>
      )}
    </Modal>
  );
}
