// Lightweight code editor: a transparent textarea over a syntax-highlighted copy, with line numbers,
// diagnostics in the gutter, language-aware indentation and Ctrl+Space suggestions.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { LANGUAGES, LANGUAGE_IDS, capabilityLabel, highlight, validateCode, type CodeLanguage, type Diagnostic } from '../src/languages';

export interface CodeEditorProps {
  value: string;
  onChange?: (v: string) => void;
  language: CodeLanguage | 'craft';
  readOnly?: boolean;
  diagnostics?: Diagnostic[];
  suggestions?: string[];
  minHeight?: number;
  autoFocus?: boolean;
}

export function CodeEditor({ value, onChange, language, readOnly, diagnostics = [], suggestions = [], minHeight = 160, autoFocus }: CodeEditorProps) {
  const ta = useRef<HTMLTextAreaElement>(null);
  const pre = useRef<HTMLPreElement>(null);
  const gut = useRef<HTMLDivElement>(null);
  const [ac, setAc] = useState<{ items: string[]; i: number; word: string; x: number; y: number } | null>(null);
  const html = useMemo(() => highlight(language, value) + '\n', [language, value]);
  const lines = value.split('\n').length;
  const byLine = useMemo(() => { const m = new Map<number, Diagnostic>(); for (const d of diagnostics) if (!m.has(d.line) || d.level === 'error') m.set(d.line, d); return m; }, [diagnostics]);
  const unit = language === 'craft' ? 2 : LANGUAGES[language as CodeLanguage]?.indent ?? 2;
  const words = useMemo(() => {
    const l = language === 'craft' ? null : LANGUAGES[language as CodeLanguage];
    return [...new Set([...suggestions, ...(l?.keywords ?? []), ...(l?.builtins ?? [])])];
  }, [language, suggestions]);

  useEffect(() => { if (autoFocus) ta.current?.focus(); }, [autoFocus]);
  const sync = () => { const t = ta.current!; if (pre.current) { pre.current.scrollTop = t.scrollTop; pre.current.scrollLeft = t.scrollLeft; } if (gut.current) gut.current.scrollTop = t.scrollTop; };

  const replace = (start: number, end: number, text: string, caret = start + text.length) => {
    const t = ta.current!;
    const v = value.slice(0, start) + text + value.slice(end);
    onChange?.(v);
    requestAnimationFrame(() => { t.selectionStart = t.selectionEnd = caret; });
  };

  const currentWord = () => {
    const t = ta.current!;
    const before = value.slice(0, t.selectionStart);
    const m = /[A-Za-z_$][\w$.]*$/.exec(before);
    return m ? m[0] : '';
  };
  const openAc = (force: boolean) => {
    const t = ta.current!;
    const w = currentWord();
    if (!force && w.length < 2) { setAc(null); return; }
    const items = words.filter((x) => x.toLowerCase().startsWith(w.toLowerCase()) && x !== w).slice(0, 12);
    if (!items.length) { setAc(null); return; }
    const before = value.slice(0, t.selectionStart).split('\n');
    const row = before.length - 1, col = before[before.length - 1].length;
    setAc({ items, i: 0, word: w, x: 44 + col * 7.2 - t.scrollLeft, y: (row + 1) * 18 + 6 - t.scrollTop });
  };
  const accept = (item: string) => {
    const t = ta.current!;
    const w = ac?.word ?? '';
    replace(t.selectionStart - w.length, t.selectionStart, item);
    setAc(null);
  };

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (readOnly) return;
    const t = e.currentTarget;
    if (ac) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setAc({ ...ac, i: (ac.i + 1) % ac.items.length }); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setAc({ ...ac, i: (ac.i - 1 + ac.items.length) % ac.items.length }); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); accept(ac.items[ac.i]); return; }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setAc(null); return; }
    }
    if (e.key === ' ' && e.ctrlKey) { e.preventDefault(); openAc(true); return; }
    const s = t.selectionStart, en = t.selectionEnd;
    if (e.key === 'Tab') {
      e.preventDefault();
      const lineStart = value.lastIndexOf('\n', s - 1) + 1;
      if (e.shiftKey) { const ind = /^ */.exec(value.slice(lineStart))![0].length; const k = Math.min(unit, ind); if (k) replace(lineStart, lineStart + k, '', Math.max(lineStart, s - k)); }
      else replace(s, en, ' '.repeat(unit));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const lineStart = value.lastIndexOf('\n', s - 1) + 1;
      const line = value.slice(lineStart, s);
      let ind = /^[ \t]*/.exec(line)![0];
      const t2 = line.trimEnd();
      const opens = /[{[(]$/.test(t2) || (language === 'python' && t2.endsWith(':')) || (language === 'lua' && /\b(then|do|function\b.*\))$/.test(t2)) || (language === 'html' && /<([a-z][\w-]*)[^>/]*>$/i.test(t2) && !/<\/\w+>$/.test(t2));
      if (opens) ind += ' '.repeat(unit);
      const closeNext = /^[}\])]/.test(value.slice(en));
      if (closeNext && /[{[(]$/.test(t2)) { const outer = ind.slice(unit); replace(s, en, '\n' + ind + '\n' + outer, s + 1 + ind.length); return; }
      replace(s, en, '\n' + ind);
      return;
    }
    const pairs: Record<string, string> = { '(': ')', '[': ']', '{': '}', '"': '"' };
    if (pairs[e.key] && s === en && language !== 'html') {
      const nxt = value[s] ?? '';
      if (e.key === '"' && nxt === '"') { e.preventDefault(); requestAnimationFrame(() => { t.selectionStart = t.selectionEnd = s + 1; }); return; }
      if (!nxt || /[\s)\]};,]/.test(nxt)) { e.preventDefault(); replace(s, en, e.key + pairs[e.key], s + 1); return; }
    }
    if ((e.key === ')' || e.key === ']' || e.key === '}') && value[s] === e.key && s === en) { e.preventDefault(); requestAnimationFrame(() => { t.selectionStart = t.selectionEnd = s + 1; }); }
  };

  return (
    <div className={'ce' + (readOnly ? ' ro' : '')} style={{ minHeight }}>
      <div className="ce-gutter" ref={gut}>
        {Array.from({ length: lines }, (_, i) => {
          const d = byLine.get(i + 1);
          return <div key={i} className={d ? 'ce-ln ' + d.level : 'ce-ln'} title={d?.message}>{d ? (d.level === 'error' ? '●' : '▲') : ''}{i + 1}</div>;
        })}
      </div>
      <div className="ce-main">
        <pre className="ce-hl" ref={pre} aria-hidden dangerouslySetInnerHTML={{ __html: html }} />
        <textarea ref={ta} className="ce-ta" value={value} readOnly={readOnly} spellCheck={false} autoCapitalize="off" autoComplete="off" wrap="off"
          onChange={(e) => { onChange?.(e.target.value); if (ac) requestAnimationFrame(() => openAc(false)); }}
          onKeyDown={onKey} onKeyUp={(e) => { if (/^[A-Za-z_.]$/.test(e.key) && !e.ctrlKey) openAc(false); }}
          onScroll={sync} onBlur={() => setTimeout(() => setAc(null), 150)} />
        {ac && (
          <div className="ce-ac" style={{ left: ac.x, top: ac.y }}>
            {ac.items.map((it, i) => <div key={it} className={i === ac.i ? 'on' : ''} onMouseDown={(e) => { e.preventDefault(); accept(it); }}>{it}</div>)}
          </div>
        )}
      </div>
    </div>
  );
}

/** The expanded editor for a code block: language picker, capability, live validation. */
export function CodeBlockDialog({ language, code, suggestions, onSave, onClose }: {
  language: CodeLanguage; code: string; suggestions?: string[];
  onSave: (language: CodeLanguage, code: string) => void; onClose: () => void;
}) {
  const [lang, setLang] = useState<CodeLanguage>(LANGUAGES[language] ? language : 'javascript');
  const [src, setSrc] = useState(code);
  const diags = useMemo(() => validateCode(lang, src), [lang, src]);
  const l = LANGUAGES[lang];
  const errors = diags.filter((d) => d.level === 'error').length;
  const changeLang = (n: CodeLanguage) => {
    if (n === lang) return;
    const blank = !src.trim() || src === LANGUAGES[lang].template;
    if (!blank && !window.confirm(`Switch this block from ${l.name} to ${LANGUAGES[n].name}?\nThe code is kept as it is and will probably not be valid ${LANGUAGES[n].name}.`)) return;
    setLang(n);
    if (blank) setSrc(LANGUAGES[n].template);
  };
  return (
    <div className="lx-modal-back" onMouseDown={onClose}>
      <div className="lx-modal ce-dialog" onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => { if (e.key === 'Escape') onClose(); if (e.key === 'Enter' && e.ctrlKey) onSave(lang, src); }}>
        <div className="lx-modal-head" style={{ borderColor: l.color }}>
          <span className="ce-lang" style={{ background: l.color }}>{l.short}</span>
          <b>{l.name} code block</b>
          <select className="lx-input" value={lang} onChange={(e) => changeLang(e.target.value as CodeLanguage)}>{LANGUAGE_IDS.map((id) => <option key={id} value={id}>{LANGUAGES[id].name}</option>)}</select>
          <span className={'ce-cap ' + (l.run ? 'live' : l.export ? 'exp' : 'edit')}>{capabilityLabel(l)}</span>
        </div>
        <p className="lx-doc">{l.status}</p>
        <CodeEditor value={src} onChange={setSrc} language={lang} diagnostics={diags} suggestions={suggestions} minHeight={300} autoFocus />
        <div className="ce-diags">
          {diags.length === 0 ? <span className="ok">✓ No problems found</span> : diags.slice(0, 8).map((d, i) => <div key={i} className={d.level}>Line {d.line}: {d.message}</div>)}
        </div>
        <div className="lx-modal-foot">
          <span className="lx-doc">Ctrl+Space suggestions · Tab indents · Ctrl+Enter saves</span>
          <button className="lx-btn" onClick={onClose}>Cancel</button>
          <button className="lx-btn primary" onClick={() => onSave(lang, src)} title={errors ? 'Saving keeps the code; fix errors before it can run' : ''}>{errors ? `Save (${errors} error${errors > 1 ? 's' : ''})` : 'Save'}</button>
        </div>
      </div>
    </div>
  );
}
