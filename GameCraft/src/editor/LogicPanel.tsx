// Visual scripting: the same logic as an event sheet or as blocks, plus validation, LogicCraft
// import/export and source-code export.
import React, { useMemo, useState } from 'react';
import { Icon } from '@shared/ui/icons';
import { isSceneFile } from '@shared/src/scenePackage';
import { CodingStylePicker, InputActionsButton, LogicView, TraceHighlighter, useCodingStyle } from '@shared/ui/LogicEditor';
import { DialogueEditor } from '@shared/ui/DialogueEditor';
import { PackDropZone, PacksHost } from '@shared/ui/PacksPanel';
import { SoundButton } from '@shared/ui/SoundPanel';
import { VideoButton } from '@shared/ui/VideoPanel';
import { installPack, presetFromGroup, resolvePack } from '@shared/src/packs';
import { validateDocument } from '@shared/src/validate';
import { exportPackage, importPackage } from '@shared/src/interchange';
import { generateCode, type Lang } from '@shared/src/codegen/codegen';
import { PARTICLE_PRESETS } from '@shared/src/runtime/particles';
import { newId } from '@shared/src/schema';
import { makeInstance, nextUid } from '@shared/src/runtime/scene';
import { store, useStore } from '../project/store';
import { api, assetUrl } from '../project/api';
import { addPictureFile, addVideoFile, curScene, typeSummaries } from './actions';
import { PicturesButton } from '@shared/ui/PicturePanel';
import { editorRefs } from './session';
import { Modal } from './ui';

export function LogicPanel() {
  const project = useStore((s) => s.project);
  const [style, setStyle] = useCodingStyle('gamecraft');
  const [dialogue, setDialogue] = useState(false);
  const focus = useStore((s) => s.focusBlockId);
  const playing = useStore((s) => s.play);
  useStore((s) => s.rev);
  const [showIssues, setShowIssues] = useState(false);
  const [code, setCode] = useState<{ lang: Lang } | null>(null);
  const [exch, setExch] = useState(false);
  const scene = project ? curScene(project) : null;
  const types = useMemo(() => (scene ? typeSummaries(scene) : []), [scene]);
  // Only what this scene runs: another scene's sheet uses that scene's objects, which aren't errors here.
  const issues = useMemo(() => (project ? validateDocument(project.logic, { app: 'gamecraft', types: types.map((t) => ({ name: t.name, vars: t.vars.map((v: any) => v.name), behaviors: t.behaviors })), sheetId: scene?.sheetId ?? project.logic.sheets[0]?.id }) : []), [project, types, scene?.sheetId]);
  // Execution trace while playing (green mark on events that ran), applied to the DOM without re-rendering.
  const getTrace = React.useCallback(() => (playing === 'edit' ? null : editorRefs.session?.rt?.trace ?? null), [playing]);
  if (!project || !scene) return null;
  const sheetId = scene.sheetId ?? project.logic.sheets[0]?.id;
  const onChange = (doc: any, label: string) => store.mutate(label, (p) => { p.logic = doc; });
  const errors = issues.filter((i) => i.level === 'error').length;
  const presets = [...Object.keys(PARTICLE_PRESETS), ...Object.keys(project.particlePresets)];

  return (
    <div className="logic-panel">
      <div className="panel-tools">
        <CodingStylePicker value={style} onChange={(s) => { setStyle(s); setDialogue(false); }} app="gamecraft" doc={project.logic} sheetId={sheetId} />
        <InputActionsButton doc={project.logic} onChange={onChange} />
        <SoundButton doc={project.logic} onChange={onChange} resolve={(ref) => assetUrl(project.id, ref)} importFile={async (f) => {
          const rel = `imported/files/${f.name.replace(/[^A-Za-z0-9_.-]/g, '_')}`;
          await api.putFile(project.id, rel, await f.arrayBuffer());
          const id = `proj:${rel}`;
          store.mutate('Import sound', (p) => { if (!p.assets.some((a) => a.id === id)) p.assets.push({ id, name: f.name.replace(/\.[^.]+$/, ''), kind: 'audio', source: 'imported', meta: { sourceFile: f.name, importedAt: new Date().toISOString() } }); });
          return id;
        }} />
        <VideoButton doc={project.logic} onChange={onChange} resolve={(ref) => assetUrl(project.id, ref)} importFile={(f) => addVideoFile(project.id, f)} />
        <PicturesButton doc={project.logic} onChange={onChange} resolve={(ref) => assetUrl(project.id, ref)} importFile={(f) => addPictureFile(project.id, f)} />
        <PacksHost ctx={{ app: 'gamecraft', mode: scene.mode }} types={types.map((t) => t.name)} onInstall={(id, opts) => {
          let report: string[] = [];
          const pack = resolvePack(id, project.logic); if (!pack) return ['⚠ That preset no longer exists.'];
          store.mutate(`Add preset: ${pack.name}`, (p) => { const s = curScene(p); report = installPack(p.logic, s.sheetId ?? p.logic.sheets[0]?.id, s, pack, opts, { app: 'gamecraft', mode: s.mode }); });
          return report;
        }}
          custom={project.logic.customPresets ?? []}
          groups={(project.logic.sheets.find((s) => s.id === sheetId)?.events ?? []).filter((n) => n.kind === 'group').map((n) => ({ id: n.id, name: (n as any).name }))}
          onSaveGroup={(gid, meta) => store.mutate(`Save preset ${meta.name}`, (p) => { presetFromGroup(p.logic, gid, curScene(p), meta); })}
          onDeleteCustom={(cid) => store.mutate('Delete preset', (p) => { p.logic.customPresets = (p.logic.customPresets ?? []).filter((x) => x.id !== cid); })} />
        <button className={'btn small' + (dialogue ? ' primary' : '')} onClick={() => setDialogue(!dialogue)} title="Branching conversations (used by the Dialogue blocks)">Dialogue{project.logic.dialogues?.length ? ` (${project.logic.dialogues.length})` : ''}</button>
        <select className="sel small" value={sheetId} title="Event sheet used by this scene" onChange={(e) => store.mutate('Bind sheet', (p) => { curScene(p).sheetId = e.target.value; })}>
          {project.logic.sheets.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <button className="btn small" onClick={() => store.mutate('New event sheet', (p) => { const id = newId('sheet'); p.logic.sheets.push({ id, name: 'Event sheet ' + (p.logic.sheets.length + 1), events: [], layout: {} }); curScene(p).sheetId = id; })}>+ Sheet</button>
        <button className={'btn small' + (errors ? ' bad' : '')} onClick={() => setShowIssues(!showIssues)}><Icon name={errors ? 'alert-triangle' : 'check'} size={12} /> {errors ? ` error(s)` : 'Valid'}{issues.length - errors ? ` · ${issues.length - errors} warning(s)` : ''}</button>
        <span className="grow" />
        <button className="btn small" onClick={() => setExch(true)} title="Send logic to LogicCraft or import from it">⇄ LogicCraft</button>
        <select className="sel small" value="" onChange={(e) => e.target.value && setCode({ lang: e.target.value as Lang })}>
          <option value="">{'</>'} Export code…</option>
          <option value="javascript">JavaScript</option><option value="python">Python</option><option value="lua">Lua</option><option value="csharp">C#</option><option value="cpp">C++</option>
        </select>
      </div>
      {showIssues && (
        <div className="issues">
          {issues.length === 0 && <div>No problems found.</div>}
          {issues.map((i, n) => <div key={n} className={'issue ' + i.level} onClick={() => store.set({ focusBlockId: i.blockId ?? null })}><Icon name={i.level === 'error' ? 'x-octagon' : 'alert-triangle'} size={12} /> {i.message}</div>)}
        </div>
      )}
      <div className="logic-body">
        {dialogue
          ? <DialogueEditor doc={project.logic} onChange={onChange} importFile={(f) => addPictureFile(project.id, f)} resolve={(ref) => assetUrl(project.id, ref)} />
          : <PackDropZone><TraceHighlighter getTrace={getTrace}><LogicView codingStyle={style} scene={scene} doc={project.logic} sheetId={sheetId} app="gamecraft" types={types} onChange={onChange} issues={issues} particlePresets={presets} focusBlockId={focus}
              defaultObject={types.find((t) => t.name === 'Player')?.name} sceneNames={project.scenes.map((s) => s.name)} /></TraceHighlighter></PackDropZone>}
      </div>
      {code && <CodeDialog lang={code.lang} onClose={() => setCode(null)} />}
      {exch && <ExchangeDialog onClose={() => setExch(false)} />}
    </div>
  );
}

function CodeDialog({ lang, onClose }: { lang: Lang; onClose: () => void }) {
  const p = store.get().project!;
  const r = generateCode(p.logic, curScene(p), lang);
  const download = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([r.code], { type: 'text/plain' })); a.download = r.fileName; a.click(); };
  return (
    <Modal title={`Export ${lang} — ${r.fileName}`} wide onClose={onClose} footer={<><button className="btn" onClick={() => navigator.clipboard?.writeText(r.code)}>Copy</button><button className="btn primary" onClick={download}>Download</button></>}>
      <div className={r.ok ? 'ok-box' : 'warn'}>
        {r.ok ? 'Every block in this sheet is in the portable subset for this language.' : `${r.unsupported.length} block(s) need the game engine and were NOT exported (marked UNSUPPORTED in the code). The generated code is a logic module, not a full game.`}
      </div>
      {!r.ok && <ul className="unsup">{r.unsupported.slice(0, 40).map((u, i) => <li key={i} onClick={() => { store.set({ focusBlockId: u.blockId ?? null }); onClose(); }}>{u.reason}</li>)}</ul>}
      <pre className="code">{r.code}</pre>
    </Modal>
  );
}

function ExchangeDialog({ onClose }: { onClose: () => void }) {
  const [files, setFiles] = useState<{ path: string; modified: number }[] | null>(null);
  const [report, setReport] = useState<string>('');
  const [pending, setPending] = useState<ReturnType<typeof importPackage> | null>(null);
  React.useEffect(() => { api.exchangeList().then(setFiles).catch((e) => setReport('Exchange folder unavailable: ' + e.message)); }, []);
  const p = store.get().project!;
  const send = async () => {
    const pkg = exportPackage(p.logic, curScene(p), 'gamecraft');
    const name = `${p.name.replace(/[^A-Za-z0-9_-]+/g, '_')}.gamecraft.logic.json`;
    await api.exchangePut(name, JSON.stringify(pkg, null, 1));
    setReport(`Sent to Shared/exchange/${name}. In LogicCraft use Import › From GameCraft.`);
    api.exchangeList().then(setFiles);
  };
  const load = async (name: string) => {
    try { setPending(importPackage(await api.exchangeGet(name), 'gamecraft')); } catch (e: any) { setReport('Import failed: ' + e.message); }
  };
  const loadFile = async (f: File) => { try { setPending(importPackage(await f.text(), 'gamecraft')); } catch (e: any) { setReport('Import failed: ' + e.message); } };
  const apply = (mode: 'replace' | 'append') => {
    if (!pending) return;
    store.mutate('Import logic', (pp) => {
      const s = curScene(pp);
      if (mode === 'replace') { pp.logic = pending.doc; s.sheetId = pending.doc.sheets[0]?.id; }
      else {
        for (const sh of pending.doc.sheets) pp.logic.sheets.push({ ...sh, name: sh.name + ' (imported)' });
        for (const g of pending.doc.globals) if (!pp.logic.globals.some((x) => x.name === g.name)) pp.logic.globals.push(g);
        s.sheetId = pending.doc.sheets[0]?.id;
      }
      // Create placeholder objects for types the logic needs but the scene lacks.
      let uid = nextUid(s);
      for (const t of pending.pkg.objectTypes) {
        if (s.instances.some((i) => i.type.toLowerCase() === t.name.toLowerCase())) continue;
        const src = pending.pkg.instances?.find((i: any) => i.type === t.name);
        const i = makeInstance(uid++, t.name, (['box', 'sphere', 'cylinder', 'sprite', 'text', 'camera', 'emitter'].includes(t.kind) ? t.kind : 'box') as any, { color: t.color ?? '#9aa4b2', behaviors: t.behaviors.map((b) => ({ type: b.type, props: { ...b.props } })), vars: Object.fromEntries(t.vars.map((v) => [v.name, v.value])) });
        if (src) { i.x = src.x; i.y = src.y; i.z = src.z; if (src.text) i.text = src.text; }
        s.instances.push(i);
      }
    });
    store.log(pending.report.ok ? 'info' : 'warn', `Imported logic: ${pending.report.supported}/${pending.report.blockCount} blocks supported${pending.report.unsupported.length ? `, ${pending.report.unsupported.length} LogicCraft-only kept but inactive` : ''}.`);
    onClose();
  };
  return (
    <Modal title="Exchange logic with LogicCraft" onClose={onClose}>
      <p className="hint">Packages use the shared logic schema (craft.logic.package v1). Block IDs, parameters, connections and variables are preserved exactly; blocks the target app cannot run are reported and kept.</p>
      <div className="btn-row"><button className="btn primary" onClick={send}>Send this project's logic to LogicCraft</button>
        <label className="btn">Import file…<input type="file" accept=".json" hidden onChange={(e) => e.target.files?.[0] && loadFile(e.target.files[0])} /></label></div>
      {report && <div className="hint">{report}</div>}
      <h4>Shared/exchange</h4>
      <div className="exch-list">{files?.some((f) => !isSceneFile(f.path)) ? files.filter((f) => !isSceneFile(f.path)).map((f) => <button key={f.path} className="exch" onClick={() => load(f.path)}>{f.path}<span>{new Date(f.modified).toLocaleString()}</span></button>) : <i>No packages yet.</i>}</div>
      {pending && (
        <div className="exch-report">
          <b>{pending.doc.name}</b> — {pending.report.blockCount} blocks, {pending.report.supported} supported in GameCraft.
          {pending.migrations.length > 0 && <div>Migrated: {pending.migrations.join('; ')}</div>}
          {pending.report.unsupported.map((u) => <div key={u.blockId} className="warn">"{u.name}" only runs in {u.apps.join(', ')} — kept, skipped at runtime.</div>)}
          {pending.report.unknown.map((u) => <div key={u.blockId} className="warn">Unknown block {u.block} — kept, skipped.</div>)}
          {pending.issues.filter((i) => i.level === 'error').slice(0, 8).map((i, n) => <div key={n} className="warn">{i.message}</div>)}
          <div className="btn-row"><button className="btn primary" onClick={() => apply('replace')}>Replace logic</button><button className="btn" onClick={() => apply('append')}>Add as new sheet</button></div>
        </div>
      )}
    </Modal>
  );
}
