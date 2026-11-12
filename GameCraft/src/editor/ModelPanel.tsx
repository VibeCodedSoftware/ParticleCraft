// Model & animations: opened by double-clicking any 3D object (an imported model, a primitive, a procedural
// character...). Preview the object and its clips, see its rig, and choose which clip plays for each animation role
// (idle, walk, jump, attack, hit, death...). Roles are what behaviors and logic ask for. A role can use
//   · a clip from the model file    -> saved in mesh.animMap   (bone animation)
//   · a keyframe clip of the scene  -> saved in animRoles      (Animation editor clips and presets)
// so objects without bones (a truck, a cube) get roles too.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '@shared/ui/icons';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { AnimationClip, BoneEdit, InstanceData } from '@shared/src/runtime/scene';
import { applyBonePose, bonesByName, hasBonePose, resetBonePose } from '../engine/bonePose';
import { CHAIN_ROLES, analyzeRig, parseBoneMap, type ChainRole, type RigInfo } from '../engine/procAnim';
import { behaviorDefaults } from '@shared/src/runtime/behaviors';
import { sampleTrack } from '@shared/src/runtime/runtime';
import { ANIM_PRESETS } from '@shared/src/animPresets';
import { store } from '../project/store';
import { assetUrl } from '../project/api';
import { loadModel } from '../engine/assets';
import { resolveClip } from '../engine/animClips';
import { curScene } from './actions';
import { editorRefs } from './session';
import { Modal } from './ui';

export const ANIM_ROLES: { id: string; label: string; doc: string }[] = [
  { id: 'idle', label: 'Idle', doc: 'Standing still (and any object nothing is moving)' },
  { id: 'walk', label: 'Walk', doc: 'Moving' },
  { id: 'run', label: 'Run', doc: 'Moving fast (falls back to Walk)' },
  { id: 'jump', label: 'Jump', doc: 'Going up in the air' },
  { id: 'fall', label: 'Fall', doc: 'Coming down' },
  { id: 'attack', label: 'Attack', doc: 'Play with the "Play animation" block' },
  { id: 'hit', label: 'Hit', doc: 'Plays automatically when Health takes damage' },
  { id: 'death', label: 'Death', doc: 'Plays automatically when Health reaches 0 (holds the last frame)' },
  { id: 'crouch', label: 'Crouch', doc: '' },
  { id: 'swim', label: 'Swim', doc: 'In water' },
  { id: 'climb', label: 'Climb', doc: '' },
  { id: 'interact', label: 'Interact', doc: '' },
];

/** Which objects the panel opens for: everything 3D (not 2D sprites, tile maps or HUD text). */
export const hasModelPanel = (i: InstanceData) => i.kind !== 'sprite' && i.kind !== 'tilemap' && !(i.kind === 'text' && i.text?.hud);

/** Ask the editor to open the panel (double-click in the viewport, the Inspector button). */
export const openModelPanel = (uid: number) => window.dispatchEvent(new CustomEvent('gc-model-panel', { detail: uid }));

/** Mounted once by the editor: shows the panel whenever it is asked for. */
export function ModelPanelHost() {
  const [uid, setUid] = useState<number | null>(null);
  useEffect(() => {
    const h = (e: Event) => setUid((e as CustomEvent<number>).detail);
    window.addEventListener('gc-model-panel', h);
    return () => window.removeEventListener('gc-model-panel', h);
  }, []);
  return uid == null ? null : <ModelPanel key={uid} uid={uid} onClose={() => setUid(null)} />;
}

interface Rig { skinned: number; bones: number; humanoid: boolean; mixamo: boolean; triangles: number; meshes: number }

function detectRig(root: THREE.Object3D): Rig {
  let skinned = 0, meshes = 0, triangles = 0;
  const bones: string[] = [];
  root.traverse((o: any) => {
    if (o.isBone) bones.push(o.name.toLowerCase());
    if (o.isMesh && !o.userData.editorOnly) { meshes++; if (o.isSkinnedMesh) skinned++; const g = o.geometry; triangles += (g.index ? g.index.count : g.attributes.position?.count ?? 0) / 3; }
  });
  const has = (re: RegExp) => bones.some((b) => re.test(b));
  return { skinned, bones: bones.length, meshes, triangles: Math.round(triangles), mixamo: has(/mixamorig/), humanoid: has(/hip|pelvis/) && has(/spine/) && has(/head/) && has(/arm|shoulder/) && has(/leg|thigh/) };
}

/** A choice in a role menu: a model clip, a keyframe clip of the scene, or a preset (added to the scene on save). */
type Choice = { kind: 'model' | 'clip' | 'preset'; name: string };
const enc = (c: Choice) => `${c.kind}:${c.name}`;
const dec = (s: string): Choice | null => { const k = s.indexOf(':'); return k < 0 ? null : { kind: s.slice(0, k) as Choice['kind'], name: s.slice(k + 1) }; };

/**
 * Bone Edit: pick a bone (the preview marks it) and turn, move or size it; the change sits on top of every
 * animation, in the editor and in the game. Saved with the roles.
 */
function BoneEditor({ bones, bone, setBone, pose, setPose }: { bones: { name: string; depth: number }[]; bone: string; setBone: (b: string) => void; pose: Record<string, BoneEdit>; setPose: (p: Record<string, BoneEdit>) => void }) {
  const e: BoneEdit = pose[bone] ?? {};
  const rot = e.rot ?? [0, 0, 0], pos = e.pos ?? [0, 0, 0];
  const edit = (patch: Partial<BoneEdit>) => setPose({ ...pose, [bone]: { ...e, ...patch } });
  const edited = Object.entries(pose).filter(([, x]) => hasBonePose({ x })).map(([n]) => n);
  const axis = (label: string, v: number, set: (v: number) => void, min: number, max: number, step: number) => (
    <label className="mp-role" style={{ gap: 6 }}><span className="mp-role-name" style={{ width: 58, whiteSpace: 'nowrap' }}>{label}</span>
      <input type="range" min={min} max={max} step={step} value={v} style={{ flex: 1 }} onChange={(ev) => set(Number(ev.target.value))} />
      <input className="sel small" type="number" step={step} value={Number(v.toFixed(3))} style={{ width: 64 }} onChange={(ev) => set(Number(ev.target.value) || 0)} /></label>
  );
  return (
    <div className="mp-bones">
      <div className="mp-head" style={{ marginTop: 12 }}><b>Bones</b><span className="dim">{edited.length ? `${edited.length} edited` : 'turn, move or size any bone'}</span></div>
      <p className="hint">Layered on top of every animation (fix a T-pose arm, a bigger head, a tilted weapon hand). Saved with the roles.</p>
      <select className="sel small" value={bone} onChange={(ev) => setBone(ev.target.value)} style={{ width: '100%' }}>
        <option value="">Choose a bone…</option>
        {bones.map((b) => <option key={b.name} value={b.name}>{'  '.repeat(Math.min(10, b.depth)) + b.name + (edited.includes(b.name) ? '  ★' : '')}</option>)}
      </select>
      {bone && <>
        {(['X', 'Y', 'Z'] as const).map((a, k) => <React.Fragment key={'r' + a}>{axis('Turn ' + a, rot[k], (v) => { const r = [...rot] as [number, number, number]; r[k] = v; edit({ rot: r }); }, -180, 180, 1)}</React.Fragment>)}
        {(['X', 'Y', 'Z'] as const).map((a, k) => <React.Fragment key={'p' + a}>{axis('Move ' + a, pos[k], (v) => { const p = [...pos] as [number, number, number]; p[k] = v; edit({ pos: p }); }, -1, 1, 0.005)}</React.Fragment>)}
        {axis('Size', e.scale ?? 1, (v) => edit({ scale: Math.max(0.01, v) }), 0.1, 3, 0.01)}
        <div className="btn-row"><button className="btn small" onClick={() => { const n = { ...pose }; delete n[bone]; setPose(n); }}>Reset this bone</button>
          {edited.length > 0 && <button className="btn small" onClick={() => setPose({})}>Reset all bones</button>}</div>
      </>}
    </div>
  );
}

const ROLE_LABEL: Record<ChainRole, string> = { leg: 'Leg (steps)', arm: 'Arm (swings)', head: 'Head (looks)', spine: 'Spine / body', tail: 'Tail (sways)', tentacle: 'Tentacle (curls)', ignore: 'Ignore (not moved)' };

/** Bones page, left: the skeleton as a tree (click to pick; ★ edited; its procedural role when that is on). */
function BoneTree({ bones, bone, setBone, pose, rigInfo }: { bones: { name: string; depth: number }[]; bone: string; setBone: (b: string) => void; pose: Record<string, BoneEdit>; rigInfo: RigInfo | null }) {
  const roleOf = (n: string) => rigInfo?.chains.find((c) => c.bones.some((b) => b.name === n))?.role;
  return (
    <div className="mp-clips" style={{ maxHeight: 260 }}>
      <div className="mp-sec">Skeleton — click a bone here or a dot in the view</div>
      {bones.map((b) => {
        const role = roleOf(b.name);
        return <button key={b.name} className={'mp-clip' + (b.name === bone ? ' on' : '')} style={{ paddingLeft: 8 + Math.min(12, b.depth) * 12, justifyContent: 'flex-start' }} onClick={() => setBone(b.name)}>
          {b.name}{hasBonePose({ x: pose[b.name] ?? {} }) ? ' ★' : ''}<span style={{ marginLeft: 'auto', paddingLeft: 10 }}>{role && role !== 'ignore' ? role : ''}</span>
        </button>;
      })}
    </div>
  );
}

/**
 * Bones page, right: Procedural Animation for this character. The skeleton is read as chains (runs of bones from a
 * branch to a tip); the picked bone's chain can be given a role, which the behavior then animates (a leg steps, an
 * arm swings, a tail sways…). Turning it on adds the Procedural Animation behavior when you save.
 */
function ProcBones({ bone, setBone, proc, setProc, rigInfo, boneMap, setBoneMap }: { bone: string; setBone: (b: string) => void; proc: boolean; setProc: (v: boolean) => void; rigInfo: RigInfo | null; boneMap: Record<string, ChainRole>; setBoneMap: (m: Record<string, ChainRole>) => void }) {
  const chain = rigInfo?.chains.find((c) => c.bones.some((b) => b.name === bone));
  return (
    <div className="mp-bones">
      <div className="mp-head" style={{ marginTop: 14 }}><b>Procedural animation</b>
        <label className="chk"><input type="checkbox" checked={proc} onChange={(e) => setProc(e.target.checked)} /> On</label></div>
      {!proc ? <p className="hint">Turn it on to animate this character from its movement with no clips: legs step with planted feet, arms swing, the head looks, tails sway (the Procedural Animation behavior is added when you save).</p> : <>
        <p className="hint">{rigInfo ? `Read as a ${rigInfo.kind} (${rigInfo.chains.filter((c) => c.role !== 'ignore').length} moving chains). ` : ''}Pick a bone to choose what its chain does.</p>
        {!bone ? <div className="hint">No bone picked.</div> : !chain ? <div className="hint">This bone is not part of a chain.</div> : <>
          <div className="mp-role"><span className="mp-role-name">Chain</span><span className="dim">{chain.bones.map((b) => b.name).join(' › ')}</span></div>
          <div className="mp-role"><span className="mp-role-name">Role</span>
            <select className="sel small" value={boneMap[chain.name] ?? ''} onChange={(e) => { const m = { ...boneMap }; if (e.target.value) m[chain.name] = e.target.value as ChainRole; else delete m[chain.name]; setBoneMap(m); }}>
              <option value="">Automatic: {ROLE_LABEL[chain.auto]}</option>
              {CHAIN_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
            </select></div>
        </>}
        {rigInfo && <div className="mp-clips" style={{ maxHeight: 150, marginTop: 6 }}>
          <div className="mp-sec">All chains</div>
          {rigInfo.chains.map((c) => <button key={c.name} className={'mp-clip' + (c.bones.some((b) => b.name === bone) ? ' on' : '')} style={{ justifyContent: 'flex-start' }} onClick={() => setBone(c.bones[0].name)}>
            {c.name} <span className="dim">({c.bones.length})</span><span>{c.role}{boneMap[c.name] ? ' (set)' : ''}</span>
          </button>)}
        </div>}
        {Object.keys(boneMap).length > 0 && <button className="btn small" onClick={() => setBoneMap({})}>Use the automatic roles</button>}
      </>}
    </div>
  );
}

export function ModelPanel({ uid, onClose }: { uid: number; onClose: () => void }) {
  const p = store.get().project!;
  const scene = curScene(p);
  const inst = scene.instances.find((i) => i.uid === uid) as InstanceData | undefined;
  const keyClips: AnimationClip[] = scene.animations ?? [];
  const host = useRef<HTMLDivElement>(null);
  const [clips, setClips] = useState<THREE.AnimationClip[]>([]);
  const [rig, setRig] = useState<Rig | null>(null);
  const [error, setError] = useState('');
  const [playing, setPlaying] = useState<Choice | null>(null);
  const [speed, setSpeed] = useState(1);
  // Role -> choice. Model-clip roles come from mesh.animMap, keyframe roles from animRoles (which wins at runtime).
  const [map, setMap] = useState<Record<string, string>>(() => {
    const m: Record<string, string> = {};
    for (const [r, n] of Object.entries(inst?.mesh?.animMap ?? {})) m[r] = enc({ kind: 'model', name: n });
    for (const [r, n] of Object.entries(inst?.animRoles ?? {})) m[r] = enc({ kind: 'clip', name: n });
    return m;
  });
  const [allOfType, setAllOfType] = useState(true);
  // Bone Edit: the model's bones (name and depth, in hierarchy order), the one being edited, and the edits.
  const [bones, setBones] = useState<{ name: string; depth: number }[]>([]);
  const [bone, setBone] = useState('');
  const [pose, setPose] = useState<Record<string, BoneEdit>>(() => JSON.parse(JSON.stringify(inst?.mesh?.bonePose ?? {})));
  const poseRef = useRef(pose); poseRef.current = pose;
  const boneRef = useRef(bone); boneRef.current = bone;
  const modelRoot = useRef<THREE.Object3D | null>(null);
  // Pages: Animations (clips and roles) or Bones (the skeleton: pick bones, edit them, procedural animation roles).
  const [page, setPage] = useState<'anims' | 'bones'>('anims');
  const pageRef = useRef(page); pageRef.current = page;
  // Procedural Animation on this character: on / off (added on save) and the bone mapping (first bone of a chain → role).
  const procBh = inst?.behaviors.find((b) => b.type === 'procanim');
  const [proc, setProc] = useState(!!procBh);
  const [boneMap, setBoneMap] = useState<Record<string, ChainRole>>(() => parseBoneMap(procBh?.props.boneMap));
  const [rigInfo, setRigInfo] = useState<RigInfo | null>(null);
  const mixer = useRef<THREE.AnimationMixer | null>(null);
  const action = useRef<THREE.AnimationAction | null>(null);
  const pivot = useRef<THREE.Group | null>(null);
  const keyPlay = useRef<{ clip: Omit<AnimationClip, 'name'>; t: number } | null>(null);
  const isModel = inst?.kind === 'mesh' && !!inst.mesh?.asset;

  useEffect(() => {
    if (!inst || !host.current) return;
    const el = host.current;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    renderer.setSize(el.clientWidth, el.clientHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    el.appendChild(renderer.domElement);
    const scn = new THREE.Scene();
    scn.background = new THREE.Color(0x2a2c31);
    scn.add(new THREE.HemisphereLight(0xffffff, 0x404040, 2.2));
    const sun = new THREE.DirectionalLight(0xffffff, 2); sun.position.set(3, 6, 4); scn.add(sun);
    scn.add(new THREE.GridHelper(10, 20, 0x555555, 0x3a3a3a));
    const cam = new THREE.PerspectiveCamera(40, el.clientWidth / el.clientHeight, 0.01, 500);
    const controls = new OrbitControls(cam, renderer.domElement);
    const clock = new THREE.Clock();
    let raf = 0, alive = true;
    // The pivot carries the object's scale; keyframe clips add their offsets to it, like at runtime.
    const pv = new THREE.Group(); pv.scale.set(Math.abs(inst.sx) || 1, Math.abs(inst.sy) || 1, Math.abs(inst.sz) || 1); scn.add(pv); pivot.current = pv;
    const base = { sx: pv.scale.x, sy: pv.scale.y, sz: pv.scale.z };
    // The selected bone's marker (always on top).
    const marker = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffb020, depthTest: false }));
    marker.renderOrder = 10; marker.visible = false; scn.add(marker);
    let lastPose: Record<string, BoneEdit> = {};
    // Bones page: the skeleton drawn over the model (lines between bones, a dot per joint, always on top); click a
    // dot to pick that bone.
    let skel: THREE.SkeletonHelper | null = null;
    const joints = new THREE.Group(); joints.visible = false; scn.add(joints);
    const jointGeo = new THREE.SphereGeometry(1, 10, 8);
    const jointMat = new THREE.MeshBasicMaterial({ color: 0x5ab0ff, depthTest: false, transparent: true, opacity: 0.85 });
    const pickMat = new THREE.MeshBasicMaterial({ color: 0xffb020, depthTest: false });
    let jointBones: THREE.Bone[] = [];
    const buildSkeleton = (root: THREE.Object3D) => {
      skel = new THREE.SkeletonHelper(root);
      (skel.material as THREE.LineBasicMaterial).depthTest = false; (skel.material as THREE.LineBasicMaterial).transparent = true;
      skel.renderOrder = 9; skel.visible = false; scn.add(skel);
      jointBones = [...bonesByName(root).values()];
      for (const b of jointBones) { const s = new THREE.Mesh(jointGeo, jointMat); s.renderOrder = 10; s.userData.bone = b.name; joints.add(s); }
    };
    let down: [number, number] | null = null;
    const onDown = (ev: PointerEvent) => { down = [ev.clientX, ev.clientY]; };
    const onUp = (ev: PointerEvent) => {
      if (!down || pageRef.current !== 'bones' || Math.hypot(ev.clientX - down[0], ev.clientY - down[1]) > 4) { down = null; return; } // a drag orbits
      down = null;
      const r = renderer.domElement.getBoundingClientRect();
      const ray = new THREE.Raycaster(); ray.setFromCamera(new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1), cam);
      const hit = ray.intersectObjects(joints.children, false)[0];
      if (hit) setBone(String(hit.object.userData.bone));
    };
    renderer.domElement.addEventListener('pointerdown', onDown);
    renderer.domElement.addEventListener('pointerup', onUp);
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const dt = clock.getDelta();
      const mr = modelRoot.current;
      // Bone Edit preview, the same order as in the game: rest → animation → edits.
      if (mr) { resetBonePose(mr, { ...lastPose, ...poseRef.current }); lastPose = poseRef.current; }
      mixer.current?.update(dt);
      if (mr) {
        applyBonePose(mr, poseRef.current);
        const b = boneRef.current ? bonesByName(mr).get(boneRef.current) : undefined;
        marker.visible = !!b;
        if (b) { b.getWorldPosition(marker.position); marker.scale.setScalar(Math.max(0.01, cam.position.distanceTo(marker.position) * 0.016)); }
        const show = pageRef.current === 'bones';
        if (skel) skel.visible = show;
        joints.visible = show;
        if (show) joints.children.forEach((s, k) => {
          jointBones[k].getWorldPosition(s.position);
          s.scale.setScalar(Math.max(0.005, cam.position.distanceTo(s.position) * 0.009));
          (s as THREE.Mesh).material = jointBones[k].name === boneRef.current ? pickMat : jointMat;
        });
      }
      const kp = keyPlay.current;
      if (kp) {
        kp.t += dt * speedRef.current;
        if (kp.t > kp.clip.duration) kp.t = kp.clip.loop ? kp.t % kp.clip.duration : kp.clip.duration;
        pv.position.set(0, 0, 0); pv.rotation.set(0, 0, 0); pv.scale.set(base.sx, base.sy, base.sz);
        for (const tr of kp.clip.tracks) {
          const v = sampleTrack(tr.keys, kp.t), r = (v * Math.PI) / 180;
          switch (tr.property) {
            case 'X': pv.position.x = v; break; case 'Y': pv.position.y = v; break; case 'Z': pv.position.z = v; break;
            case 'RotX': pv.rotation.x = r; break; case 'RotY': case 'Angle': pv.rotation.y = r; break; case 'RotZ': pv.rotation.z = r; break;
            case 'ScaleX': pv.scale.x = base.sx + v; break; case 'ScaleY': pv.scale.y = base.sy + v; break; case 'ScaleZ': pv.scale.z = base.sz + v; break;
            case 'Opacity': pv.traverse((o: any) => { if (o.material) for (const m of [].concat(o.material)) { (m as THREE.Material).transparent = true; (m as THREE.Material).opacity = Math.max(0, Math.min(1, (inst.opacity + v) / 100)); } }); break;
          }
        }
      }
      controls.update(); renderer.render(scn, cam);
    };
    const frame = (obj: THREE.Object3D) => {
      pv.add(obj);
      const box = new THREE.Box3().setFromObject(pv);
      if (box.isEmpty()) return;
      const size = box.getSize(new THREE.Vector3()).length() || 1, c = box.getCenter(new THREE.Vector3());
      obj.position.sub(new THREE.Vector3(c.x, box.min.y, c.z).divide(pv.scale));
      controls.target.set(0, (box.max.y - box.min.y) / 2, 0);
      cam.position.set(size * 0.9, size * 0.6, size * 1.1);
      setRig(detectRig(obj));
    };
    if (isModel) {
      const ref = p.assets.find((a) => a.id === inst.mesh!.asset);
      const url = assetUrl(p.id, inst.mesh!.asset);
      if (!url) setError('This model has no file.');
      else loadModel(url, ref?.importSettings ?? {}).then((m) => {
        if (!alive) return;
        frame(m.scene);
        modelRoot.current = m.scene;
        buildSkeleton(m.scene);
        const list: { name: string; depth: number }[] = [];
        const walk = (o: THREE.Object3D, d: number) => { for (const c of o.children) { if ((c as THREE.Bone).isBone && c.name && !list.some((x) => x.name === c.name)) { list.push({ name: c.name, depth: d }); walk(c, d + 1); } else walk(c, d); } };
        walk(m.scene, 0);
        setBones(list);
        setClips(m.animations);
        if (m.animations.length) mixer.current = new THREE.AnimationMixer(m.scene);
      }).catch((e) => setError(String(e?.message ?? e)));
    } else {
      // Any other 3D object: a copy of what the viewport shows (primitives, procedural characters, voxels...).
      const e = editorRefs.view?.entries.get(uid);
      if (!e) setError('This object is not shown in the viewport yet.');
      else {
        const copy = cloneSkinned(e.visual);
        copy.traverse((o: any) => {
          if (o.userData?.editorOnly) o.visible = false;
          if (o.material) o.material = Array.isArray(o.material) ? o.material.map((m: THREE.Material) => m.clone()) : o.material.clone();
        });
        copy.position.set(0, 0, 0); copy.rotation.set(0, 0, 0); copy.scale.set(1, 1, 1);
        frame(copy);
      }
    }
    loop();
    return () => {
      alive = false; cancelAnimationFrame(raf);
      renderer.domElement.removeEventListener('pointerdown', onDown); renderer.domElement.removeEventListener('pointerup', onUp);
      if (modelRoot.current) resetBonePose(modelRoot.current, { ...lastPose, ...poseRef.current }); // the loaded model is shared: leave it at rest
      skel?.dispose(); jointGeo.dispose(); jointMat.dispose(); pickMat.dispose();
      controls.dispose(); renderer.dispose(); renderer.domElement.remove(); mixer.current = null; action.current = null; modelRoot.current = null;
    };
  }, [uid]);

  // The rig as Procedural Animation reads it (chains and roles), refreshed when the mapping changes.
  useEffect(() => {
    const mr = modelRoot.current;
    if (!mr || !bones.length) { setRigInfo(null); return; }
    try { setRigInfo(analyzeRig(mr, (procBh?.props.rig ?? 'auto') as any, boneMap)); } catch { setRigInfo(null); }
  }, [bones, boneMap]);

  const speedRef = useRef(speed);
  useEffect(() => { speedRef.current = speed; if (action.current) action.current.timeScale = speed; }, [speed]);

  const play = (c: Choice) => {
    action.current?.fadeOut(0.15); action.current = null; keyPlay.current = null;
    if (c.kind === 'model') {
      const clip = clips.find((x) => x.name === c.name);
      if (!mixer.current || !clip) return;
      const a = mixer.current.clipAction(clip);
      a.reset().setLoop(THREE.LoopRepeat, Infinity).fadeIn(0.15).play();
      a.timeScale = speed;
      action.current = a;
    } else {
      const k = c.kind === 'clip' ? keyClips.find((x) => x.name === c.name) : ANIM_PRESETS.find((x) => x.name === c.name)?.clip;
      if (!k) return;
      keyPlay.current = { clip: { ...k, loop: true }, t: 0 };
    }
    setPlaying(c);
  };

  // What each role plays now: an explicit choice, or the model clip matched automatically by name.
  const resolved = useMemo(() => Object.fromEntries(ANIM_ROLES.map((r) => {
    const own = map[r.id] && dec(map[r.id]);
    if (own) return [r.id, own];
    const auto = isModel ? resolveClip(clips, r.id)?.name : undefined;
    return [r.id, auto ? { kind: 'model', name: auto } as Choice : null];
  })), [clips, map]);
  const presetsFor = (role: string) => ANIM_PRESETS.filter((x) => x.role === role && !keyClips.some((c) => c.name === x.name));
  // The movement states this object's behaviors can put it in: presets are only offered for those (a truck with Car
  // gets no walk bob or jump squash; a static prop only idles).
  const reachable = useMemo(() => {
    const types = new Set((inst?.behaviors ?? []).map((b) => b.type));
    const s = new Set<string>(['idle']);
    const walker = ['platform', 'eightdir', 'wander', 'pathfinding', 'topdown', 'tank', 'patrol', 'follow', 'chase', 'flee'].some((t) => types.has(t));
    if (types.has('car') || types.has('vehicle')) s.delete('idle');
    if (walker) ['walk', 'run'].forEach((x) => s.add(x));
    if (types.has('platform')) ['jump', 'fall', 'swim'].forEach((x) => s.add(x));
    if (types.has('health')) ['hit', 'death'].forEach((x) => s.add(x));
    if ([...types].some((t) => /attack|melee|shoot|weapon/i.test(t))) s.add('attack');
    return s;
  }, [inst]);
  const autoMatch = () => {
    const next: Record<string, string> = {};
    for (const r of ANIM_ROLES) {
      const c = isModel ? resolveClip(clips, r.id) : undefined;
      if (c && (c.name.toLowerCase().includes(r.id) || ['idle', 'walk', 'run'].includes(r.id))) { next[r.id] = enc({ kind: 'model', name: c.name }); continue; }
      // No bones: a keyframe clip made for that role, else the matching preset (states the object can reach only).
      const pre = ANIM_PRESETS.find((x) => x.role === r.id);
      if (!clips.length && pre && reachable.has(r.id)) next[r.id] = enc({ kind: keyClips.some((k) => k.name === pre.name) ? 'clip' : 'preset', name: pre.name });
    }
    setMap(next);
  };
  const save = () => {
    const animMap: Record<string, string> = {}, roles: Record<string, string> = {}, add: string[] = [];
    for (const [r, s] of Object.entries(map)) {
      const c = s && dec(s); if (!c) continue;
      if (c.kind === 'model') animMap[r] = c.name;
      else { roles[r] = c.name; if (c.kind === 'preset') add.push(c.name); }
    }
    const same = (i: InstanceData) => i.uid === uid || (allOfType && i.type === inst!.type && (inst!.kind !== 'mesh' || i.mesh?.asset === inst!.mesh?.asset));
    store.mutate('Animation roles', (pp) => {
      const s = curScene(pp);
      for (const name of add) {
        const pre = ANIM_PRESETS.find((x) => x.name === name);
        if (pre && !(s.animations ?? []).some((c) => c.name === name)) s.animations = [...(s.animations ?? []), { name, ...JSON.parse(JSON.stringify(pre.clip)) }];
      }
      // Bone Edit: only bones that really change something are kept.
      const kept = Object.fromEntries(Object.entries(pose).filter(([, e]) => hasBonePose({ x: e })));
      const apply = (i: InstanceData | Omit<InstanceData, 'uid'>) => {
        if (i.mesh) { i.mesh = { ...i.mesh, animMap }; if (Object.keys(kept).length) i.mesh.bonePose = kept; else delete i.mesh.bonePose; }
        if (Object.keys(roles).length) i.animRoles = roles; else delete i.animRoles;
        // Procedural Animation (Bones page): on / off and which chains do what.
        const pb = i.behaviors.find((b) => b.type === 'procanim'), bm = Object.keys(boneMap).length ? JSON.stringify(boneMap) : '';
        if (proc) { if (pb) pb.props = { ...pb.props, boneMap: bm }; else i.behaviors = [...i.behaviors, { type: 'procanim', props: { ...behaviorDefaults('procanim'), boneMap: bm } }]; }
        else if (pb) i.behaviors = i.behaviors.filter((b) => b !== pb);
      };
      for (const i of s.instances) if (same(i)) apply(i);
      for (const t of s.objectTypes) if (allOfType && t.name === inst!.type && t.template) apply(t.template);
    });
    onClose();
  };

  if (!inst) return null;
  const fmt = (n: number) => n.toLocaleString();
  const label = (c: Choice | null) => !c ? '' : c.kind === 'model' ? c.name : c.kind === 'clip' ? `${c.name} (keyframes)` : `${c.name} (preset)`;
  const isPlaying = (c: Choice) => playing?.kind === c.kind && playing.name === c.name;
  return (
    <Modal title={`Model & animations — ${inst.name}`} wide onClose={onClose}
      tabs={(['anims', 'bones'] as const).map((t) => <button key={t} className={page === t ? 'on' : ''} disabled={t === 'bones' && !bones.length} title={t === 'bones' && !bones.length ? 'This object has no bones' : undefined} onClick={() => setPage(t)}>{t === 'anims' ? 'Animations' : `Bones${bones.length ? ` (${bones.length})` : ''}`}</button>)}
      footer={<><label className="chk"><input type="checkbox" checked={allOfType} onChange={(e) => setAllOfType(e.target.checked)} /> Apply to every "{inst.type}"{isModel ? ' with this model' : ''}</label><span className="grow" /><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={save}>Save</button></>}>
      <div className="mp">
        <div className="mp-left">
          <div className="mp-view" ref={host} />
          {error && <div className="hint warn"><Icon name="alert-triangle" size={12} /> {error}</div>}
          {page === 'bones' && <BoneTree bones={bones} bone={bone} setBone={setBone} pose={pose} rigInfo={proc ? rigInfo : null} />}
          {page === 'anims' && <>
          {rig && (
            <div className="mp-rig">
              <b>{rig.bones ? (rig.humanoid ? 'Humanoid rig' : 'Custom rig') : isModel ? 'Static model (no rig)' : 'Object (no rig)'}</b>
              {rig.mixamo && <span className="tag">Mixamo</span>}
              <span className="dim">{fmt(rig.bones)} bones · {fmt(rig.meshes)} meshes · {fmt(rig.triangles)} triangles · {clips.length} model clips · {keyClips.length} keyframe clips</span>
            </div>
          )}
          <div className="mp-speed"><span>Preview speed</span><input type="range" min={0.1} max={2} step={0.05} value={speed} onChange={(e) => setSpeed(Number(e.target.value))} /><span>{speed.toFixed(2)}×</span></div>
          <div className="mp-clips">
            {clips.length > 0 && <div className="mp-sec">Clips in the model file</div>}
            {clips.map((c) => (
              <button key={'m' + c.name} className={'mp-clip' + (isPlaying({ kind: 'model', name: c.name }) ? ' on' : '')} onClick={() => play({ kind: 'model', name: c.name })}>
                <Icon name="play" size={11} /> {c.name}<span>{c.duration.toFixed(2)} s</span>
              </button>
            ))}
            {keyClips.length > 0 && <div className="mp-sec">Keyframe clips (Animation editor)</div>}
            {keyClips.map((c) => (
              <button key={'k' + c.name} className={'mp-clip' + (isPlaying({ kind: 'clip', name: c.name }) ? ' on' : '')} onClick={() => play({ kind: 'clip', name: c.name })}>
                <Icon name="play" size={11} /> {c.name}<span>{c.duration.toFixed(2)} s{c.loop ? ' · loop' : ''}</span>
              </button>
            ))}
            {!clips.length && !keyClips.length && !error && <div className="hint">{rig ? (isModel ? 'This model has no animations of its own. Pick presets below for its roles, make keyframe clips in the Animation tab, or import a file with animations.' : 'Pick presets for its roles below, or make keyframe clips in the Animation tab.') : 'Loading…'}</div>}
          </div>
          </>}
        </div>
        {page === 'bones' && <div className="mp-right">
          <BoneEditor bones={bones} bone={bone} setBone={setBone} pose={pose} setPose={setPose} />
          <ProcBones bone={bone} setBone={setBone} proc={proc} setProc={setProc} rigInfo={rigInfo} boneMap={boneMap} setBoneMap={setBoneMap} />
        </div>}
        {page === 'anims' && <div className="mp-right">
          <div className="mp-head"><b>Animation roles</b><button className="btn small" onClick={autoMatch} title="Fill the roles: model clips by name, otherwise the matching preset">Auto-match</button></div>
          <p className="hint">Behaviors and logic ask for a role ("walk", "jump"); pick what plays for each. Model clips animate bones; keyframe clips and presets move, turn and squash the whole object, so they work on anything.</p>
          {ANIM_ROLES.map((r) => {
            const cur = resolved[r.id] as Choice | null;
            return (
              <div key={r.id} className="mp-role" title={r.doc}>
                <span className="mp-role-name">{r.label}</span>
                <select className="sel small" value={map[r.id] ?? ''} onChange={(e) => setMap({ ...map, [r.id]: e.target.value })}>
                  <option value="">{cur && !map[r.id] ? `auto: ${cur.name}` : '— none —'}</option>
                  {clips.length > 0 && <optgroup label="Model clips">{clips.map((c) => <option key={c.name} value={enc({ kind: 'model', name: c.name })}>{c.name}</option>)}</optgroup>}
                  {keyClips.length > 0 && <optgroup label="Keyframe clips">{keyClips.map((c) => <option key={c.name} value={enc({ kind: 'clip', name: c.name })}>{c.name}</option>)}</optgroup>}
                  {presetsFor(r.id).length > 0 && <optgroup label="Presets (added when you save)">{presetsFor(r.id).map((x) => <option key={x.name} value={enc({ kind: 'preset', name: x.name })}>{x.name}</option>)}</optgroup>}
                </select>
                <button className="btn small" disabled={!cur} title={cur ? 'Preview ' + label(cur) : 'Nothing to preview'} onClick={() => cur && play(cur)}><Icon name="play" size={12} /></button>
              </div>
            );
          })}
        </div>}
      </div>
    </Modal>
  );
}
