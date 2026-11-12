// Bone view (viewport header): the skeletons of the scene's rigged models are drawn over it. Click a joint to pick that
// bone, then hang any object on it (a gun on a hand): it follows the bone through animation and procedural animation,
// like parenting to a bone in Blender.
import React, { useEffect, useState } from 'react';
import { store, useStore } from '../project/store';
import { curScene, parentToBone, setParent } from './actions';
import { isWithin } from './parenting';
import type { SceneView } from '../engine/sceneView';
import type { BonePick } from '../engine/boneOverlay';

export function BoneViewPanel({ view, pick, onPick, top }: { view: SceneView; pick: BonePick | null; onPick: (p: BonePick | null) => void; top: number }) {
  const project = useStore((s) => s.project);
  useStore((s) => s.rev);
  const selection = useStore((s) => s.selection);
  const [snap, setSnap] = useState(false);
  const [choice, setChoice] = useState<number | null>(null);
  // Models load after the view opens: the rig count and bone list come from the overlay.
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 500); return () => clearInterval(t); }, []);
  if (!project) return null;
  const scene = curScene(project);
  const owner = pick ? scene.instances.find((i) => i.uid === pick.uid) : undefined;
  const bones = owner ? view.boneList(owner.uid) : [];
  const attached = owner ? scene.instances.filter((i) => i.parent === owner.uid && i.parentBone === pick!.bone) : [];
  const candidates = owner ? scene.instances.filter((i) => !isWithin(scene, owner, i.uid) && !attached.includes(i)) : [];
  // The object to attach: chosen here, else the one selected in the scene.
  const last = selection[selection.length - 1];
  const target = candidates.find((i) => i.uid === choice) ?? candidates.find((i) => i.uid === last);
  const btn = { padding: '1px 7px' } as const;
  return <div className="vp-boneview" style={{ position: 'absolute', left: 8, top, zIndex: 3, background: 'rgba(20,20,26,.85)', padding: '6px 8px', borderRadius: 6, fontSize: 12, display: 'flex', flexDirection: 'column', gap: 5, width: 250 }}
    onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
    <b>Bone view</b>
    {!view.rigCount && <span style={{ opacity: 0.75 }}>No rigged models in this scene.</span>}
    {!!view.rigCount && !owner && <span style={{ opacity: 0.75 }}>Click a joint on a skeleton to pick its bone.</span>}
    {owner && pick && <>
      <label style={{ display: 'flex', gap: 5, alignItems: 'center' }}><span style={{ opacity: 0.7 }}>{owner.name}</span>
        <select className="sel small" style={{ flex: 1, minWidth: 0 }} value={pick.bone} title="The picked bone" onChange={(e) => onPick({ uid: pick.uid, bone: e.target.value })}>
          {bones.map((b) => <option key={b.name} value={b.name}>{' '.repeat(b.depth)}{b.name}</option>)}
        </select>
      </label>
      {attached.map((i) => <div key={i.uid} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'pointer' }} title="Select it" onClick={() => store.set({ selection: [i.uid] })}>↳ {i.name}</span>
        <button className="tbtn" style={btn} title="Take it off the bone, keeping where it is" onClick={() => setParent([i.uid], null)}>Detach</button>
      </div>)}
      <select className="sel small" value={target?.uid ?? ''} title="The object to hang on this bone (the object selected in the scene, unless you choose another)" onChange={(e) => setChoice(e.target.value ? Number(e.target.value) : null)}>
        <option value="">Choose an object…</option>
        {candidates.map((i) => <option key={i.uid} value={i.uid}>{i.name}</option>)}
      </select>
      <label className="chk" title="Move it right onto the bone (position and rotation 0 on the bone). Off: it stays exactly where it is and keeps that offset."><input type="checkbox" checked={snap} onChange={(e) => setSnap(e.target.checked)} />Snap to the bone</label>
      <button className="tbtn" style={btn} disabled={!target} title="Hang the object on this bone (Ctrl+P)" onClick={() => { if (target) { parentToBone([target.uid], owner.uid, pick.bone, snap); setChoice(null); } }}>
        {target ? `Parent ${target.name} to ${pick.bone}` : 'Parent to this bone'}
      </button>
    </>}
  </div>;
}
