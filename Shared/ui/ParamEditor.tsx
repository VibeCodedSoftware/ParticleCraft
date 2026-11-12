// Parameter editing and the Construct-style "Add condition / action" wizard, shared by both apps.
import React, { useMemo, useState } from 'react';
import { CATEGORY_ICON, Glyph } from './icons';
import { BLOCK_LIST, CATEGORIES, POSTFX_PRESET_IDS, BUILTIN_SOUNDS, EFFECT_TYPE_IDS, blockSentence, defaultParams, type BlockDef, type ParamDef } from '../src/blocks/definitions';
import { COMPARISONS, tryParse, BUILTIN_FUNCTIONS } from '../src/expr';
import { KEY_CHOICES } from '../src/runtime/input';
import { BEHAVIORS } from '../src/runtime/behaviors';
import { splitArgs } from '../src/runtime/blockImpl';
import { PARTICLE_PRESETS } from '../src/runtime/particles';
import type { AppId, BlockInstance, LogicDocument, ParamValue, VariableDef } from '../src/schema';
import { LANGUAGES, LANGUAGE_IDS, validateCode, type CodeLanguage } from '../src/languages';
import { newPathId, pathDraw, readPaths, writePaths } from '../src/blocks/pathParam';
import { CodeBlockDialog } from './CodeEditor';

export interface TypeSummary { name: string; kind: string; vars: VariableDef[]; behaviors: string[]; color?: string }
export interface EditorEnv {
  app: AppId;
  types: TypeSummary[];
  variables: VariableDef[];
  functions: string[];
  particlePresets?: string[];
  sounds?: string[];
  /** Conversation names (Dialogue blocks) and scene names (Load scene), when the host knows them. */
  dialogues?: string[];
  scenes?: string[];
  /** Video names from the Videos panel (cutscene blocks). */
  videos?: string[];
  /** Picture names from the Pictures panel (transition shapes and covers, dialogue looks). */
  pictures?: string[];
  /** A modal dialog is editing a copy of the block (the scene can't be clicked from here). */
  inDialog?: boolean;
}

/** A path parameter: each route with its Draw button, and room for more. */
function PathParam({ value, onChange, target, env }: { value: ParamValue; onChange: (v: ParamValue) => void; target?: string; env: EditorEnv }) {
  const host = pathDraw.host;
  const [, redraw] = useState(0);
  React.useEffect(() => host?.subscribe(() => redraw((n) => n + 1)), [host]);
  const v = readPaths(value);
  const routes = v.paths.length ? v.paths : [[]];
  const active = host?.active();
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  if (!host) return <span className="lx-pathnote">Open this in GameCraft to draw paths</span>;
  if (env.inDialog) return <span className="lx-pathnote">{v.paths.filter((r) => r.length).length} drawn. Add the brick, then press Draw path on it.</span>;
  const save = (paths: typeof v.paths, id = v.id || newPathId()) => { onChange(writePaths({ id, paths })); return id; };
  return (
    <span className="lx-paths" onPointerDown={stop} onMouseDown={stop} onClick={stop}>
      {routes.map((r, k) => {
        const on = !!v.id && active?.id === v.id && active.index === k;
        return (
          <span key={k} className="lx-path">
            <button className={'lx-pathbtn' + (on ? ' on' : '')} title={on ? 'Finish drawing (Enter)' : 'Click in the scene to add points to this path'} onClick={() => {
              if (on) { host.stop(); return; }
              const id = v.id || save(v.paths.length ? v.paths : [[]]);
              host.draw(id, k, target);
            }}>{on ? 'Finish' : r.length ? `Path ${k + 1}: ${r.length} pts, edit` : routes.length > 1 ? `Draw path ${k + 1}` : 'Draw path'}</button>
            {(r.length > 0 || routes.length > 1) && <button className="lx-pathx" title="Remove this path" onClick={() => { if (on) host.stop(); save(routes.filter((_, n) => n !== k)); }}>×</button>}
          </span>
        );
      })}
      <button className="lx-pathadd" title="Another route: Follow path chooses between them" onClick={() => { const n = routes.length; const id = save([...routes, []]); host.draw(id, n, target); }}>+ path</button>
    </span>
  );
}

/** A code parameter: language chip, first line, and the full editor in a dialog. */
function CodeParam({ value, siblings, onChange, onChangeMany, env }: { value: ParamValue; siblings?: Record<string, ParamValue>; onChange: (v: ParamValue) => void; onChangeMany?: (patch: Record<string, ParamValue>) => void; env: EditorEnv }) {
  const [open, setOpen] = useState(false);
  const lang = (String(siblings?.language ?? 'javascript') as CodeLanguage);
  const l = LANGUAGES[lang] ?? LANGUAGES.javascript;
  const code = String(value ?? '');
  const diags = useMemo(() => validateCode(l.id, code), [l.id, code]);
  const errs = diags.filter((d) => d.level === 'error').length;
  const first = code.split('\n').find((x) => x.trim() && !x.trim().startsWith(l.lineComment ?? '\u0000')) ?? code.split('\n')[0] ?? '';
  const sugg = [...env.variables.map((v) => v.name), ...env.types.map((t) => t.name), ...(l.id === 'javascript' ? ['game.get', 'game.set', 'game.objects', 'game.create', 'game.log', 'game.trigger', 'game.button', 'game.dt', 'game.time', 'self.x', 'self.y', 'self.vars'] : [])];
  return (
    <>
      <button className={'lx-codechip' + (errs ? ' bad' : '')} title={`${l.name}: ${code.split('\n').length} line(s)${errs ? ` · ${errs} error(s)` : ''}. Click to edit.`}
        onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); setOpen(true); }}>
        <span className="ce-lang" style={{ background: l.color }}>{l.short}</span>
        <code>{first.length > 34 ? first.slice(0, 33) + '…' : first || '(empty)'}</code>
        {errs > 0 && <span className="lx-codechip-err">{errs}!</span>}
        <span className="lx-codechip-edit">✎</span>
      </button>
      {open && <CodeBlockDialog language={lang} code={code} suggestions={sugg} onClose={() => setOpen(false)}
        onSave={(nl, src) => { setOpen(false); if (nl !== lang && onChangeMany) onChangeMany({ language: nl, code: src }); else onChange(src); }} />}
    </>
  );
}

const CMP_LABEL: Record<string, string> = { '=': '= Equal to', '<>': '≠ Not equal to', '<': '< Less than', '<=': '≤ Less or equal', '>': '> Greater than', '>=': '≥ Greater or equal' };

export function ParamInput({ p, value, onChange, env, target, siblings, onChangeMany }: { p: ParamDef; value: ParamValue; onChange: (v: ParamValue) => void; env: EditorEnv; target?: string; /** The block's other parameters (a code field reads its language from here). */ siblings?: Record<string, ParamValue>; /** Change several parameters at once (a code block's language and code). */ onChangeMany?: (patch: Record<string, ParamValue>) => void }) {
  const sel = (opts: string[], labels?: Record<string, string>) => (
    <select className="lx-input" value={String(value)} onChange={(e) => onChange(e.target.value)}>
      {!opts.includes(String(value)) && <option value={String(value)}>{String(value)}</option>}
      {opts.map((o) => <option key={o} value={o}>{labels?.[o] ?? o}</option>)}
    </select>
  );
  switch (p.type) {
    case 'expr': {
      const r = p.name === 'args'
        ? (splitArgs(String(value)).map((x) => tryParse(x)).find((x) => !x.ok) ?? { ok: true as const })
        : tryParse(value as any);
      return (
        <div className="lx-expr">
          <input className={'lx-input mono' + (r.ok ? '' : ' bad')} value={String(value)} spellCheck={false} onChange={(e) => onChange(e.target.value)} list="lx-expr-hints"
            title='Expression: numbers, "text", variables, Object.Property, functions like random(10). Use & to join text.' />
          {!r.ok && <div className="lx-err">{(r as any).error}</div>}
        </div>
      );
    }
    case 'text': case 'function': return <input className="lx-input" value={String(value)} onChange={(e) => onChange(e.target.value)} list={p.type === 'function' ? 'lx-fn-hints' : undefined} />;
    case 'boolean': return <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} />;
    case 'color': return <input type="color" className="lx-color" value={String(value)} onChange={(e) => onChange(e.target.value)} />;
    case 'compare': return sel([...COMPARISONS], CMP_LABEL);
    case 'key': return sel(KEY_CHOICES);
    case 'mouse': return sel(['left', 'middle', 'right']);
    case 'choice': return sel(p.options ?? []);
    case 'objectType': return sel(env.types.map((t) => t.name));
    case 'variable': return sel(env.variables.map((v) => v.name));
    case 'instanceVar': return sel(env.types.find((t) => t.name === target)?.vars.map((v) => v.name) ?? []);
    case 'behavior': return sel(Object.keys(BEHAVIORS), Object.fromEntries(Object.values(BEHAVIORS).map((b) => [b.id, b.name])));
    case 'particlePreset': return sel(env.particlePresets ?? Object.keys(PARTICLE_PRESETS));
    case 'code': return <CodeParam value={value} siblings={siblings} onChange={onChange} onChangeMany={onChangeMany} env={env} />;
    case 'language': return (
      <select className="lx-input" value={String(value)} onChange={(e) => {
        const n = e.target.value as CodeLanguage;
        const code = String(siblings?.code ?? '');
        const cur = LANGUAGES[String(value) as CodeLanguage];
        const blank = !code.trim() || code === cur?.template;
        if (blank && onChangeMany) { onChangeMany({ language: n, code: LANGUAGES[n].template }); return; }
        if (!blank && !window.confirm(`Switch this code block to ${LANGUAGES[n].name}? The existing code is kept and may no longer be valid.`)) return;
        onChange(n);
      }}>
        {LANGUAGE_IDS.map((id) => <option key={id} value={id}>{LANGUAGES[id].name}</option>)}
      </select>
    );
    case 'dialogue': return (
      <>
        <input className="lx-input" value={String(value)} onChange={(e) => onChange(e.target.value)} list="lx-dialogue-hints" />
        <datalist id="lx-dialogue-hints">{(env.dialogues ?? []).map((s) => <option key={s} value={s} />)}</datalist>
      </>
    );
    case 'scene': return (
      <>
        <input className="lx-input" value={String(value)} onChange={(e) => onChange(e.target.value)} list="lx-scene-hints" />
        <datalist id="lx-scene-hints">{(env.scenes ?? []).map((s) => <option key={s} value={s} />)}</datalist>
      </>
    );
    case 'video': return sel(p.default === '' ? ['', ...(env.videos ?? [])] : env.videos ?? [], { '': '(any video)' });
    case 'picture': return sel(['', ...(env.pictures ?? []), ...(value && !(env.pictures ?? []).includes(String(value)) ? [String(value)] : [])], { '': '(none — import in Pictures)' });
    case 'path': return <PathParam value={value} onChange={onChange} target={target} env={env} />;
    case 'postfxPreset': return sel(POSTFX_PRESET_IDS);
    case 'effectType': return sel(EFFECT_TYPE_IDS);
    case 'sound': return (
      <>
        <input className="lx-input" value={String(value)} onChange={(e) => onChange(e.target.value)} list="lx-sound-hints" />
        <datalist id="lx-sound-hints">{(env.sounds ?? BUILTIN_SOUNDS).map((s) => <option key={s} value={s} />)}</datalist>
      </>
    );
  }
  return <input className="lx-input" value={String(value)} onChange={(e) => onChange(e.target.value)} />;
}

export function ExprHints({ env }: { env: EditorEnv }) {
  return (
    <>
      <datalist id="lx-expr-hints">
        {env.variables.map((v) => <option key={'v' + v.name} value={v.name} />)}
        {env.types.flatMap((t) => ['X', 'Y', 'Z', 'Angle', 'Count', ...t.vars.map((v) => v.name)].map((p) => <option key={t.name + p} value={`${t.name}.${p}`} />))}
        {Object.entries(BUILTIN_FUNCTIONS).map(([k, f]) => <option key={'f' + k} value={`${k}(`}>{f.doc}</option>)}
        {['dt', 'time', 'loopindex', 'Mouse.X', 'Mouse.Y', 'Mouse.Z', 'Self.X', 'movex', 'movey', 'lookx', 'looky', 'inputdevice', 'actionvalue("Jump")'].map((s) => <option key={s} value={s} />)}
      </datalist>
      <datalist id="lx-fn-hints">{env.functions.map((f) => <option key={f} value={f} />)}</datalist>
    </>
  );
}

/** Modal to edit an existing block's parameters, target, invert and comment. */
export function BlockDialog({ block, def, env, onSave, onClose }: { block: BlockInstance; def: BlockDef; env: EditorEnv; onSave: (b: BlockInstance) => void; onClose: () => void }) {
  const [b, setB] = useState<BlockInstance>({ ...block, params: { ...defaultParams(def), ...block.params } });
  const cat = CATEGORIES.find((c) => c.id === def.category);
  return (
    <div className="lx-modal-back" onMouseDown={onClose}>
      <div className="lx-modal" onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => { if (e.key === 'Enter' && (e.target as HTMLElement).tagName !== 'TEXTAREA') onSave(b); if (e.key === 'Escape') onClose(); }}>
        <div className="lx-modal-head" style={{ borderColor: cat?.color }}>
          <span className="lx-chip" style={{ background: cat?.color }}>{cat && <Glyph e={cat.icon} i={CATEGORY_ICON[cat.id] ?? 'box'} size={12} />} {cat?.name}</span>
          <b>{def.name}</b>
          {def.c2 && <span className="lx-c2" title="Construct 2 equivalent">C2: {def.c2}</span>}
        </div>
        <p className="lx-doc">{def.doc}</p>
        <ExprHints env={env} />
        <div className="lx-form">
          {def.target === 'object' && (
            <label><span>Object</span>
              <select className="lx-input" value={b.target} onChange={(e) => setB({ ...b, target: e.target.value })}>
                {!env.types.some((t) => t.name === b.target) && <option>{b.target}</option>}
                {env.types.filter((t) => !def.behavior || t.behaviors.includes(def.behavior)).concat(def.behavior ? env.types.filter((t) => !t.behaviors.includes(def.behavior!)) : []).map((t) => (
                  <option key={t.name} value={t.name}>{t.name}{def.behavior && !t.behaviors.includes(def.behavior) ? ` (no ${BEHAVIORS[def.behavior]?.name})` : ''}</option>
                ))}
              </select>
            </label>
          )}
          {def.params.map((p) => (
            <label key={p.name} title={p.doc}><span>{p.label}</span>
              <ParamInput p={p} value={b.params[p.name] ?? p.default} env={{ ...env, inDialog: true }} target={b.target} siblings={b.params} onChange={(v) => setB({ ...b, params: { ...b.params, [p.name]: v } })} onChangeMany={(patch) => setB({ ...b, params: { ...b.params, ...patch } })} />
            </label>
          ))}
          {def.kind === 'condition' && !def.trigger && (
            <label><span>Invert (NOT)</span><input type="checkbox" checked={!!b.invert} onChange={(e) => setB({ ...b, invert: e.target.checked })} /></label>
          )}
          <label><span>Comment</span><input className="lx-input" value={b.comment ?? ''} onChange={(e) => setB({ ...b, comment: e.target.value || undefined })} /></label>
        </div>
        <div className="lx-preview">{blockSentence(def, b.params, b.target)}</div>
        <div className="lx-modal-foot">
          <button className="lx-btn" onClick={onClose}>Cancel</button>
          <button className="lx-btn primary" onClick={() => onSave(b)}>Done</button>
        </div>
      </div>
    </div>
  );
}

/** Construct-style wizard: pick an object (or System), then a condition/action, then parameters. */
export function BlockPicker({ kind, env, onPick, onClose, initialObject }: { kind: 'condition' | 'action'; env: EditorEnv; onPick: (b: BlockInstance) => void; onClose: () => void; initialObject?: string }) {
  const [obj, setObj] = useState<string | null>(initialObject ?? null);
  const [q, setQ] = useState('');
  const [chosen, setChosen] = useState<BlockDef | null>(null);
  const objType = env.types.find((t) => t.name === obj);
  const list = useMemo(() => {
    const ql = q.toLowerCase();
    return BLOCK_LIST.filter((d) => d.kind === kind && d.apps.includes(env.app) && (q ? (d.name + ' ' + d.doc + ' ' + d.id + ' ' + (d.c2 ?? '')).toLowerCase().includes(ql) : obj === null ? true : obj === 'System' ? d.target === 'none' : d.target === 'object' && (!d.behavior || objType?.behaviors.includes(d.behavior))));
  }, [q, obj, kind, objType, env.app]);
  if (chosen) {
    const b: BlockInstance = { id: 'b_new', block: chosen.id, params: defaultParams(chosen), target: chosen.target === 'object' ? (obj && obj !== 'System' ? obj : env.types[0]?.name ?? 'Player') : undefined };
    return <BlockDialog block={b} def={chosen} env={env} onClose={() => setChosen(null)} onSave={(nb) => onPick({ ...nb, id: 'b_' + Math.random().toString(36).slice(2, 11) })} />;
  }
  const byCat = CATEGORIES.map((c) => ({ c, items: list.filter((d) => d.category === c.id) })).filter((g) => g.items.length);
  return (
    <div className="lx-modal-back" onMouseDown={onClose}>
      <div className="lx-modal wide" onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <div className="lx-modal-head"><b>{kind === 'condition' ? 'Add condition' : 'Add action'}</b>
          <input autoFocus className="lx-input search" placeholder="Search all blocks…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="lx-picker">
          <div className="lx-picker-objects">
            <div className="lx-sub">1. Object</div>
            <button className={'lx-obj' + (obj === null ? ' on' : '')} onClick={() => setObj(null)}>★ All</button>
            <button className={'lx-obj' + (obj === 'System' ? ' on' : '')} onClick={() => setObj('System')}><Glyph e="⚙" i="settings" size={12} /> System</button>
            {env.types.map((t) => (
              <button key={t.name} className={'lx-obj' + (obj === t.name ? ' on' : '')} onClick={() => setObj(t.name)}>
                <i style={{ background: t.color ?? '#888' }} />{t.name}
              </button>
            ))}
          </div>
          <div className="lx-picker-blocks">
            <div className="lx-sub">2. {kind === 'condition' ? 'Condition' : 'Action'}</div>
            {byCat.map(({ c, items }) => (
              <div key={c.id} className="lx-cat">
                <div className="lx-cat-name" style={{ color: c.color }}><Glyph e={c.icon} i={CATEGORY_ICON[c.id] ?? 'box'} size={13} /> {c.name}</div>
                <div className="lx-cat-items">
                  {items.map((d) => (
                    <button key={d.id} className="lx-block-btn" style={{ borderLeftColor: c.color }} title={d.doc} onClick={() => setChosen(d)}>
                      {d.trigger && <span className="lx-trig"><Glyph e="⚡" i="zap" size={11} /></span>}{d.looping && <span className="lx-trig">↻</span>}{d.name}
                    </button>
                  ))}
                </div>
              </div>
            ))}
            {!byCat.length && <div className="lx-empty">No blocks match.</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

export function docFunctions(doc: LogicDocument): string[] {
  const out = new Set<string>();
  const walk = (ns: any[]) => ns.forEach((n) => { if (n.kind === 'event') n.conditions.forEach((c: any) => c.block === 'function.on_function' && out.add(String(c.params.name))); if (n.children) walk(n.children); });
  doc.sheets.forEach((s) => walk(s.events));
  return [...out];
}
