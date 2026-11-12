// Template tutorial: step cards linked to real editor panels (highlighting them).
import React, { useEffect } from 'react';
import { store, useStore } from '../project/store';

const TARGET_TAB: Record<string, Partial<ReturnType<typeof store.get>>> = {
  eventsheet: { bottomTab: 'Event sheet', logicView: 'sheet' }, blocks: { bottomTab: 'Event sheet', logicView: 'blocks' },
  inspector: { rightTab: 'Inspector' }, postfx: { rightTab: 'Effects' }, assets: { bottomTab: 'Assets' }, animation: { bottomTab: 'Animation' },
};

export function Tutorial() {
  const project = useStore((s) => s.project);
  const step = useStore((s) => s.tutorialStep);
  const t = project?.tutorial;
  const cur = t && step != null ? t.steps[step] : null;
  useEffect(() => {
    document.querySelectorAll('.tut-hl').forEach((e) => e.classList.remove('tut-hl'));
    if (!cur?.target) return;
    const patch = TARGET_TAB[cur.target];
    if (patch) store.set(patch as any);
    setTimeout(() => document.querySelector(`[data-tut="${cur.target}"]`)?.classList.add('tut-hl'), 50);
  }, [cur]);
  if (!t || step == null || !cur) return null;
  return (
    <div className="tutorial">
      <div className="tut-head"><b>{t.title}</b><span>Step {step + 1} / {t.steps.length}</span><button className="x" onClick={() => store.set({ tutorialStep: null })}>✕</button></div>
      <h3>{cur.title}</h3>
      <p>{cur.text}</p>
      <div className="btn-row">
        <button className="btn small" disabled={step === 0} onClick={() => store.set({ tutorialStep: step - 1 })}>Back</button>
        {step < t.steps.length - 1 ? <button className="btn small primary" onClick={() => store.set({ tutorialStep: step + 1 })}>Next</button> : <button className="btn small primary" onClick={() => store.set({ tutorialStep: null })}>Finish</button>}
      </div>
    </div>
  );
}
