// Import wizard: upload files, preview, detected meshes/materials/animations, scale/axis/collision/
// material/animation settings, then Import. Supports OBJ(+MTL+textures), glTF/GLB, FBX, images, audio,
// fonts, and native .blend files (read directly, no Blender needed; pick objects to import). Reimport refreshes an existing asset in place.
import React, { useEffect, useRef, useState } from 'react';
import { Icon } from '@shared/ui/icons';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { store } from '../project/store';
import { api, assetUrl } from '../project/api';
import { DEFAULT_IMPORT, type AssetImportSettings, type AssetRef } from '../project/types';
import { AUDIO_EXTS, MODEL_EXTS, TEXTURE_EXTS, VIDEO_EXTS, extOf, invalidateModel, loadBlend, loadModel, type LoadedModel } from '../engine/assets';
import { addVideoFile } from './actions';
import { Check, Modal, Num, Row, Select } from './ui';
import { editorRefs } from './session';

interface BlendPick { name: string; top: boolean; hidden: boolean; animations: string[]; vertices: number }
interface Pending {
  asset: AssetRef; files: string[];
  /** .blend: the objects found in the file and the ones picked to become assets (none = the whole file). */
  blend?: { objects: BlendPick[]; picked: string[]; warnings: string[]; version: string };
}

/** Asset id for one object of a .blend ("file.blend#Object"). */
const blendObjectId = (fileId: string, obj: string) => fileId.split('#')[0] + '#' + obj;

export function ImportWizard({ files, reimport, onClose }: { files: File[]; reimport?: AssetRef; onClose: () => void }) {
  const project = store.get().project!;
  const [status, setStatus] = useState('Preparing…');
  const [pending, setPending] = useState<Pending[]>([]);
  const [idx, setIdx] = useState(0);
  const [settings, setSettings] = useState<AssetImportSettings>(reimport?.importSettings ?? DEFAULT_IMPORT);
  const [model, setModel] = useState<LoadedModel | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [reFiles, setReFiles] = useState<File[]>([]);
  const preview = useRef<HTMLDivElement>(null);

  // Upload into the project and group companions (MTL, textures) with their model.
  const upload = async (list: File[]) => {
    setBusy(true); setError('');
    try {
      const out: Pending[] = [];
      const models = list.filter((f) => MODEL_EXTS.includes(extOf(f.name)) || extOf(f.name) === 'blend');
      const groupName = (f: File) => f.name.replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9_-]/g, '_');
      for (const m of models) {
        const base = reimport ? reimport.id.slice(5).split('/').slice(0, 2).join('/') : `imported/${groupName(m)}`;
        const companions = list.filter((f) => f !== m && !MODEL_EXTS.includes(extOf(f.name)) && extOf(f.name) !== 'blend' && (TEXTURE_EXTS.includes(extOf(f.name)) || ['mtl', 'bin'].includes(extOf(f.name))));
        setStatus(`Uploading ${m.name}…`);
        for (const f of [m, ...companions]) await api.putFile(project.id, `${base}/${f.name}`, await f.arrayBuffer());
        const modelFile = `${base}/${m.name}`;
        let blend: Pending['blend'];
        if (extOf(m.name) === 'blend') {
          // Native reader: no Blender needed. List the file's objects so the user can pick which become assets.
          setStatus(`Reading ${m.name}…`);
          const res = await loadBlend(api.fileUrl(project.id, modelFile));
          const objects = res.objects.filter((o) => (o.type === 'mesh' || o.type === 'armature') && (o.vertices > 0 || o.type === 'armature') && !(o.skinned && o.parent));
          const top = objects.filter((o) => !o.parent || !objects.some((p) => p.name === o.parent));
          const picked = reimport?.id.includes('#') ? [reimport.id.split('#')[1]] : [];
          blend = { objects: objects.map((o) => ({ name: o.name, top: top.includes(o), hidden: o.hidden, animations: o.animations, vertices: o.vertices })), picked, warnings: [...new Set(res.warnings)], version: String(res.version) };
        }
        const mtl = companions.find((f) => extOf(f.name) === 'mtl');
        out.push({ asset: { id: reimport?.id ?? `proj:${modelFile}`, name: reimport?.name ?? groupName(m), kind: 'model', source: 'imported', extra: mtl ? [`proj:${base}/${mtl.name}`] : undefined, meta: { sourceFile: m.name, sourceModified: m.lastModified } }, files: [modelFile], blend });
      }
      for (const f of list.filter((x) => !models.includes(x) && (TEXTURE_EXTS.includes(extOf(x.name)) || AUDIO_EXTS.includes(extOf(x.name)) || ['ttf', 'otf'].includes(extOf(x.name))))) {
        if (models.length) continue; // textures that came with a model are companions
        const rel = `imported/files/${f.name}`;
        await api.putFile(project.id, rel, await f.arrayBuffer());
        const kind = TEXTURE_EXTS.includes(extOf(f.name)) ? 'texture' : AUDIO_EXTS.includes(extOf(f.name)) ? 'audio' : 'font';
        out.push({ asset: { id: `proj:${rel}`, name: f.name.replace(/\.[^.]+$/, ''), kind, source: 'imported', meta: { sourceFile: f.name, importedAt: new Date().toISOString() } }, files: [rel] });
      }
      // Videos need no preview step: they are stored and added to the Videos list (cutscene blocks) right away.
      const vids = list.filter((f) => VIDEO_EXTS.includes(extOf(f.name)));
      for (const f of vids) {
        setStatus(`Uploading ${f.name}…`);
        await addVideoFile(project.id, f);
      }
      const skipped = list.filter((f) => ![...MODEL_EXTS, 'blend', 'mtl', 'bin', 'ttf', 'otf', ...TEXTURE_EXTS, ...AUDIO_EXTS, ...VIDEO_EXTS].includes(extOf(f.name)));
      if (skipped.length) setError(`Skipped unsupported files: ${skipped.map((f) => f.name).join(', ')}. Supported: .blend .glb .gltf .fbx .obj(+.mtl), .png .jpg .webp, .wav .mp3 .ogg, .ttf .otf, .mp4 .webm .ogv.`);
      if (!out.length && !skipped.length && !vids.length) setError('No files to import.');
      setPending(out); setIdx(0);
      setStatus(out.length ? '' : vids.length ? `Imported ${vids.length} video(s). They are in the Assets panel and in Logic › Videos for the Play video block.` : 'Nothing to import');
    } catch (e: any) { setError(e.message ?? String(e)); setStatus(''); }
    setBusy(false);
  };
  useEffect(() => { if (files.length) upload(files); else setStatus(reimport ? 'Choose the updated source file(s) for ' + reimport.name : ''); }, []);

  const cur = pending[idx];
  const [showAll, setShowAll] = useState(false);
  const [focus, setFocus] = useState('');
  // The .blend object shown in the preview: the one last clicked, else the first picked, else the whole file.
  const previewId = cur?.blend ? (focus || cur.blend.picked[0] ? blendObjectId(cur.asset.id, focus || cur.blend.picked[0]) : cur.asset.id.split('#')[0]) : cur?.asset.id;
  // Load the preview with the current settings.
  useEffect(() => {
    if (!cur || cur.asset.kind !== 'model' || !previewId) { setModel(null); return; }
    const url = assetUrl(project.id, previewId)!;
    invalidateModel(url);
    const mtl = cur.asset.extra?.[0];
    setModel(null);
    loadModel(url, settings, mtl ? assetUrl(project.id, mtl) ?? undefined : undefined).then(setModel).catch((e) => setError('Could not read the model: ' + e.message));
  }, [previewId, JSON.stringify(settings)]);

  const togglePick = (name: string, on: boolean) => {
    setPending((ps) => ps.map((p, n) => n !== idx || !p.blend ? p : { ...p, blend: { ...p.blend, picked: on ? [...p.blend.picked, name] : p.blend.picked.filter((x) => x !== name) } }));
    if (on) setFocus(name);
  };

  useEffect(() => {
    const el = preview.current; if (!el || !model) return;
    const r = new THREE.WebGLRenderer({ antialias: true }); r.setSize(el.clientWidth, el.clientHeight); r.outputColorSpace = THREE.SRGBColorSpace; r.toneMapping = THREE.AgXToneMapping;
    el.innerHTML = ''; el.appendChild(r.domElement);
    const scene = new THREE.Scene(); scene.background = new THREE.Color('#2b2e35');
    scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 2)); const d = new THREE.DirectionalLight(0xffffff, 2.5); d.position.set(3, 6, 4); scene.add(d);
    scene.add(new THREE.GridHelper(10, 10, 0x666666, 0x444444));
    scene.add(model.scene);
    const human = new THREE.Mesh(new THREE.BoxGeometry(0.4, 1.8, 0.25), new THREE.MeshBasicMaterial({ color: 0x8a5cf6, wireframe: true })); human.position.set(-1.2, 0.9, 0); scene.add(human);
    const size = model.size.length() || 2;
    const cam = new THREE.PerspectiveCamera(40, el.clientWidth / el.clientHeight, 0.01, 1000); cam.position.set(size * 1.2, size * 0.8, size * 1.4);
    const oc = new OrbitControls(cam, r.domElement); oc.target.set(0, model.size.y / 2, 0); oc.update();
    let raf = 0; const loop = () => { raf = requestAnimationFrame(loop); r.render(scene, cam); }; loop();
    return () => { cancelAnimationFrame(raf); oc.dispose(); r.dispose(); };
  }, [model]);

  const finish = () => {
    store.mutate(reimport ? `Reimport ${reimport.name}` : `Import ${pending.length} asset(s)`, (p) => {
      for (const pd of pending) {
        const meta = pd.asset.kind === 'model' && model && pd === cur && !pd.blend ? { ...pd.asset.meta, ...model.info, size: [model.size.x, model.size.y, model.size.z] as [number, number, number], importedAt: new Date().toISOString() } : { ...pd.asset.meta, importedAt: new Date().toISOString() };
        const base: AssetRef = { ...pd.asset, importSettings: pd.asset.kind === 'model' ? settings : undefined, meta };
        // A .blend becomes one asset per picked object (or one for the whole file).
        const list: AssetRef[] = pd.blend?.picked.length && !reimport
          ? pd.blend.picked.map((o) => { const info = pd.blend!.objects.find((x) => x.name === o); return { ...base, id: blendObjectId(pd.asset.id, o), name: o, meta: { ...meta, animations: info?.animations, vertices: info?.vertices } }; })
          : [base];
        for (const asset of list) {
          const i = p.assets.findIndex((a) => a.id === asset.id);
          if (i >= 0) p.assets[i] = { ...p.assets[i], ...asset }; else p.assets.push(asset);
        }
      }
    });
    if (reimport) { invalidateModel(assetUrl(project.id, reimport.id)!); editorRefs.view?.clearRuntime(); store.set({ rev: store.get().rev + 1 }); }
    store.log('info', `Imported ${pending.map((x) => x.asset.name).join(', ')}. Find them under Assets › Imported.`);
    onClose();
  };

  return (
    <Modal title={reimport ? `Reimport "${reimport.name}"` : 'Import assets'} wide onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!pending.length || busy} onClick={finish}>Import{pending.length > 1 ? ` ${pending.length} assets` : ''}</button></>}>
      {status && <div className="hint">{busy && <Icon name="hourglass" size={12} />} {status}</div>}
      {error && <div className="warn">{error}</div>}
      {reimport && !files.length && !pending.length && (
        <div><p className="hint">Pick the updated file(s). The asset keeps its id, so every object using it updates while your scene edits stay intact.</p>
          <input type="file" multiple onChange={(e) => e.target.files && setReFiles([...e.target.files])} />
          <button className="btn" disabled={!reFiles.length} onClick={() => upload(reFiles)}>Upload</button></div>
      )}
      {pending.length > 1 && <div className="seg">{pending.map((p, n) => <button key={n} className={n === idx ? 'on' : ''} onClick={() => setIdx(n)}>{p.asset.name}</button>)}</div>}
      {cur?.asset.kind === 'model' && (
        <div className="imp-grid">
          <div className="imp-preview" ref={preview}>{!model && <span>Loading preview…</span>}</div>
          <div className="imp-settings">
            {cur.blend && <>
              <h4>Objects in this .blend <span className="hint">(Blender {cur.blend.version}, read natively)</span></h4>
              <div className="hint">Tick the objects to import as separate assets. None ticked imports the whole scene.</div>
              <label className="hint"><input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> Show child and hidden objects</label>
              <div className="imp-objects" style={{ maxHeight: 180, overflow: 'auto' }}>
                {cur.blend.objects.filter((o) => showAll || (o.top && !o.hidden)).map((o) => (
                  <div key={o.name} className={'imp-obj' + (focus === o.name ? ' on' : '')}>
                    <input type="checkbox" checked={cur.blend!.picked.includes(o.name)} onChange={(e) => togglePick(o.name, e.target.checked)} />
                    <span style={{ cursor: 'pointer' }} onClick={() => setFocus(o.name)}>{o.name}</span>
                    <span className="hint"> {o.vertices ? o.vertices.toLocaleString() + ' v' : 'rig'}{o.animations.length ? ' · ' + o.animations.join(', ') : ''}{o.hidden ? ' · hidden' : ''}</span>
                  </div>
                ))}
              </div>
              <Row label="Keep lights"><Check value={settings.lights !== false} onChange={(v) => setSettings({ ...settings, lights: v })} /></Row>
              {cur.blend.warnings.length > 0 && <details className="hint"><summary>{cur.blend.warnings.length} note(s) from the converter</summary><ul>{cur.blend.warnings.slice(0, 40).map((w) => <li key={w}>{w}</li>)}</ul></details>}
            </>}
            <h4>Detected</h4>
            {model ? <ul className="imp-detected">
              <li>{model.info.meshes} mesh(es), {model.info.vertices.toLocaleString()} vertices</li>
              <li>Materials: {model.info.materials.join(', ') || 'default'}</li>
              <li>Animations: {model.info.animations.length ? model.info.animations.join(', ') : 'none'}</li>
              <li>Size after import: {model.size.x.toFixed(2)} × {model.size.y.toFixed(2)} × {model.size.z.toFixed(2)} m <i>(purple box = 1.8 m person)</i></li>
            </ul> : <div className="hint">…</div>}
            <h4>Settings</h4>
            <Row label="Scale"><Num value={settings.scale} step={0.01} min={0.0001} onChange={(v) => setSettings({ ...settings, scale: v })} /></Row>
            <Row label=""><span className="btn-row">{[0.01, 0.1, 1, 100].map((s) => <button key={s} className="btn small" onClick={() => setSettings({ ...settings, scale: s })}>{s}×</button>)}
              <button className="btn small" title="Scale so the model is 1.8 m tall" onClick={() => model && setSettings({ ...settings, scale: settings.scale * (1.8 / Math.max(0.001, model.size.y)) })}>Human height</button></span></Row>
            <Row label="Up axis" tip="Blender glTF/OBJ exports are usually Y-up; raw Z-up data needs Z"><Select value={settings.upAxis} options={['y', 'z']} labels={{ y: 'Y up (default)', z: 'Z up' }} onChange={(v) => setSettings({ ...settings, upAxis: v as any })} /></Row>
            <Row label="Yaw (°)"><Num value={settings.rotY} step={90} onChange={(v) => setSettings({ ...settings, rotY: v })} /></Row>
            <Row label="Center pivot"><Check value={settings.center} onChange={(v) => setSettings({ ...settings, center: v })} /></Row>
            <Row label="Place on ground"><Check value={settings.ground} onChange={(v) => setSettings({ ...settings, ground: v })} /></Row>
            <Row label="Collision"><Select value={settings.collision} options={['box', 'none']} labels={{ box: 'Box (fitted to bounds)', none: 'None' }} onChange={(v) => setSettings({ ...settings, collision: v as any })} /></Row>
            <Row label="Materials"><Select value={settings.materials} options={['keep', 'flat', 'unlit']} labels={{ keep: 'Keep (PBR)', flat: 'Flat shaded', unlit: 'Unlit' }} onChange={(v) => setSettings({ ...settings, materials: v as any })} /></Row>
            <Row label="Import animations"><Check value={settings.animations} onChange={(v) => setSettings({ ...settings, animations: v })} /></Row>
          </div>
        </div>
      )}
      {cur && cur.asset.kind !== 'model' && <div className="hint">{cur.asset.kind} "{cur.asset.name}" is ready to import.</div>}
    </Modal>
  );
}
