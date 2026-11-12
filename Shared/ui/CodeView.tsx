// Code coding style: the program as text.
//  - Craft script: an exact, editable text form of the event sheet. Apply parses it and replaces the sheet, so the
//    change shows up in every other style (IDs are carried over where the structure still matches).
//  - Generated code: what the source exporters produce (read-only), including verbatim code blocks.
import React, { useEffect, useMemo, useState } from 'react';
import type { SceneData } from '../src/runtime/scene';
import { carryIds, parseSheet, printSheet } from '../src/craftScript';
import { generateCode, type Lang } from '../src/codegen/codegen';
import { BLOCK_LIST } from '../src/blocks/definitions';
import * as ops from './logicOps';
import type { CanvasProps } from './BlockCanvas';
import { CodeEditor } from './CodeEditor';

const GEN: { id: Lang; name: string }[] = [
  { id: 'javascript', name: 'JavaScript' }, { id: 'python', name: 'Python' }, { id: 'lua', name: 'Lua' }, { id: 'csharp', name: 'C#' }, { id: 'cpp', name: 'C++' },
];

export function CodeView(props: CanvasProps & { scene?: SceneData | null }) {
  const { doc, onChange } = props;
  const sheet = ops.sheetOf(doc, props.sheetId);
  const printed = useMemo(() => printSheet(doc, sheet), [doc, sheet]);
  const [tab, setTab] = useState<'craft' | Lang>('craft');
  const [draft, setDraft] = useState(printed);
  const [dirty, setDirty] = useState(false);
  const [log, setLog] = useState<string[]>([`Loaded "${sheet.name}" — ${sheet.events.length} top-level item(s).`]);
  useEffect(() => { if (!dirty) setDraft(printed); }, [printed, dirty]);

  const parsed = useMemo(() => parseSheet(draft), [draft]);
  const diags = parsed.errors.map((e) => ({ line: e.line, message: e.message, level: (e.message.includes('it is kept') ? 'warning' : 'error') as 'error' | 'warning' }));
  const errors = diags.filter((d) => d.level === 'error');
  const suggestions = useMemo(() => [...BLOCK_LIST.map((b) => b.id), ...props.types.map((t) => '@' + t.name), ...doc.globals.map((g) => g.name)], [props.types, doc.globals]);

  const apply = () => {
    if (errors.length) { setLog((l) => [...l, `✗ Not applied: ${errors.length} error(s). First: line ${errors[0].line}: ${errors[0].message}`]); return; }
    const next = ops.edit(doc, (d) => {
      const s = ops.sheetOf(d, props.sheetId);
      carryIds(s.events, parsed.events);
      s.events = parsed.events;
      d.globals = parsed.globals.map((g) => ({ ...(doc.globals.find((x) => x.name === g.name) ?? {}), ...g }));
    });
    onChange(next, 'Edit code');
    setDirty(false);
    setLog((l) => [...l, `✓ Applied: ${parsed.events.length} top-level item(s), ${parsed.globals.length} variable(s). All coding styles now show this program.`]);
  };
  const revert = () => { setDraft(printed); setDirty(false); setLog((l) => [...l, 'Reverted to the current logic.']); };

  const gen = useMemo(() => (tab === 'craft' ? null : generateCode(doc, props.scene ?? null, tab)), [tab, doc, props.scene]);

  return (
    <div className="cv-root" onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && tab === 'craft') { e.preventDefault(); e.stopPropagation(); apply(); } }}>
      <div className="cv-tabs">
        <button className={tab === 'craft' ? 'on' : ''} onClick={() => setTab('craft')}>craft-script <span className="cv-tag">editable</span></button>
        {GEN.map((g) => <button key={g.id} className={tab === g.id ? 'on' : ''} onClick={() => setTab(g.id)}>{g.name} <span className="cv-tag ro">generated</span></button>)}
        <span className="grow" />
        {tab === 'craft' && <>
          {dirty && <span className="cv-dirty">● unapplied changes</span>}
          <button className="lx-btn" disabled={!dirty} onClick={revert}>Revert</button>
          <button className="lx-btn primary" disabled={!dirty} onClick={apply} title="Ctrl+S">Apply to logic</button>
        </>}
        {gen && <button className="lx-btn" onClick={() => navigator.clipboard?.writeText(gen.code)}>Copy</button>}
      </div>
      <div className="cv-editor">
        {tab === 'craft'
          ? <CodeEditor value={draft} onChange={(v) => { setDraft(v); setDirty(true); }} language="craft" diagnostics={diags} suggestions={suggestions} minHeight={200} />
          : <CodeEditor value={gen?.code ?? ''} language={tab === 'cpp' ? 'cpp' : tab === 'csharp' ? 'csharp' : tab} readOnly minHeight={200} />}
      </div>
      <div className="cv-term">
        {tab === 'craft' ? (
          <>
            {log.slice(-3).map((l, i) => <div key={i}>{l}</div>)}
            <div className={errors.length ? 'bad' : 'ok'}>{errors.length ? `${errors.length} error(s): line ${errors[0].line}: ${errors[0].message}` : diags.length ? `${diags.length} warning(s)` : 'Syntax OK'} <span className="cv-hint">· keywords: event, when, if, do, not, else, or, group, var, local · values are JSON or `raw` · multi-line text uses &lt;&lt;&lt; … &gt;&gt;&gt;</span></div>
          </>
        ) : gen && (
          <>
            <div className={gen.ok ? 'ok' : 'bad'}>{gen.ok ? `✓ ${gen.fileName}: every block is in the portable subset.` : `${gen.unsupported.length} block(s) need the game engine and are marked UNSUPPORTED in ${gen.fileName}.`}</div>
            {gen.unsupported.slice(0, 3).map((u, i) => <div key={i} className="bad">· {u.reason}</div>)}
          </>
        )}
      </div>
    </div>
  );
}
