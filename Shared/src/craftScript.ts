// Craft script: a plain-text form of one event sheet that converts both ways WITHOUT loss.
//
//   var score number = 0
//   event {
//     when input.on_key_pressed key: "Space"
//     if not object.compare_x @Player cmp: "<" value: "5"
//     do object.spawn @Player type: "Bullet" layer: "0"   // a block comment
//     event { … }                                         // sub-event
//   }
//   else event { … }        modifiers before "event": else or off loose break
//   group "Enemies" { … }   (add "inactive" after the name)
//   comment "free text"
//
// Values are JSON literals or `raw text` in backticks; multi-line text (code blocks) uses <<< … >>> heredocs. Parsing a printed sheet gives
// back the same tree, and IDs are carried over from the previous tree wherever the structure still matches.
import { BLOCK_DEFS } from './blocks/definitions';
import { newId, type BlockInstance, type EventBlock, type EventNode, type EventSheet, type LogicDocument, type ParamValue, type VarType, type VariableDef } from './schema';

const VAR_TYPES: VarType[] = ['number', 'string', 'boolean', 'array', 'dict', 'vector', 'object'];

function lit(v: ParamValue | unknown, ind: string): string {
  if (typeof v === 'string' && v.includes('\n')) return '<<<\n' + v.split('\n').map((l) => ind + '  ' + l).join('\n') + '\n' + ind + '>>>';
  return JSON.stringify(v);
}

function printBlock(b: BlockInstance, kw: string, ind: string): string {
  let s = `${ind}${kw} ${b.invert ? 'not ' : ''}${b.disabled ? 'off ' : ''}${b.block}`;
  if (b.target) s += ` @${b.target}`;
  // One multi-line value per block is written as a heredoc, last on the line (it runs to ">>>").
  const entries = Object.entries(b.params);
  const multi = entries.find(([, v]) => typeof v === 'string' && v.includes('\n'));
  // Text with quotes (expressions like "Hello" & name) reads better raw between backticks.
  const val = (v: ParamValue) => (typeof v === 'string' && v.includes('"') && !v.includes('`') ? '`' + v + '`' : JSON.stringify(v));
  for (const [k, v] of entries) if (!multi || k !== multi[0]) s += ` ${k}: ${val(v)}`;
  if (multi) s += ` ${multi[0]}: ${lit(multi[1], ind)}`; // the comment then goes after the closing >>>
  if (b.comment) s += ` // ${b.comment.replace(/\n/g, ' ')}`;
  return s;
}

export function printSheet(doc: LogicDocument, sheet: EventSheet): string {
  const out: string[] = [`// Craft script for "${sheet.name}". Edit, then Apply: the logic updates in every coding style.`];
  for (const g of doc.globals) out.push(`var ${g.isConstant ? 'const ' : ''}${g.name} ${g.type} = ${JSON.stringify(g.value)}`);
  if (doc.globals.length) out.push('');
  const node = (n: EventNode, ind: string) => {
    if (n.kind === 'comment') { out.push(`${ind}comment ${JSON.stringify(n.text)}`); return; }
    if (n.kind === 'group') {
      out.push(`${ind}group ${JSON.stringify(n.name)}${n.active ? '' : ' inactive'} {`);
      n.children.forEach((c) => node(c, ind + '  '));
      out.push(`${ind}}`); return;
    }
    const mods = [n.isElse && 'else', n.isOr && 'or', n.disabled && 'off', n.loose && 'loose', n.breakpoint && 'break'].filter(Boolean).join(' ');
    out.push(`${ind}${mods ? mods + ' ' : ''}event {`);
    for (const l of n.locals ?? []) out.push(`${ind}  local ${l.isStatic ? 'static ' : ''}${l.name} ${l.type} = ${JSON.stringify(l.value)}`);
    n.conditions.forEach((b, i) => out.push(printBlock(b, i === 0 && BLOCK_DEFS[b.block]?.trigger ? 'when' : 'if', ind + '  ')));
    n.actions.forEach((b) => out.push(printBlock(b, 'do', ind + '  ')));
    n.children.forEach((c) => node(c, ind + '  '));
    out.push(`${ind}}`);
  };
  sheet.events.forEach((n) => { node(n, ''); });
  return out.join('\n') + '\n';
}

export interface ScriptError { line: number; message: string }

type Tok = { t: 'word' | 'str' | 'num' | 'lbrace' | 'rbrace' | 'colon' | 'at' | 'heredoc' | 'comment' | 'eq'; v: string };

function tokenize(line: string, ln: number, errors: ScriptError[]): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  while (i < line.length) {
    const c = line[i];
    if (c === ' ' || c === '\t') { i++; continue; }
    if (c === '/' && line[i + 1] === '/') { toks.push({ t: 'comment', v: line.slice(i + 2).trim() }); break; }
    if (c === '{') { toks.push({ t: 'lbrace', v: c }); i++; continue; }
    if (c === '}') { toks.push({ t: 'rbrace', v: c }); i++; continue; }
    if (c === '=') { toks.push({ t: 'eq', v: c }); i++; continue; }
    if (c === '@') { const m = /^@([A-Za-z_][\w]*)/.exec(line.slice(i)); if (!m) { errors.push({ line: ln, message: 'Expected an object name after @' }); return toks; } toks.push({ t: 'at', v: m[1] }); i += m[0].length; continue; }
    if (line.startsWith('<<<', i)) { toks.push({ t: 'heredoc', v: '' }); i += 3; continue; }
    if (c === '`') {
      const j = line.indexOf('`', i + 1);
      if (j < 0) { errors.push({ line: ln, message: 'Unterminated `raw text`' }); return toks; }
      toks.push({ t: 'str', v: line.slice(i + 1, j) }); i = j + 1; continue;
    }
    if (c === '"') {
      let j = i + 1;
      while (j < line.length && line[j] !== '"') j += line[j] === '\\' ? 2 : 1;
      if (j >= line.length) { errors.push({ line: ln, message: 'Unterminated string' }); return toks; }
      try { toks.push({ t: 'str', v: JSON.parse(line.slice(i, j + 1)) }); } catch { errors.push({ line: ln, message: 'Bad string escape' }); }
      i = j + 1; continue;
    }
    if (c === '[') {
      // JSON array literal: take everything up to the balanced close.
      let depth = 0, j = i;
      for (; j < line.length; j++) { if (line[j] === '[' || line[j] === '{') depth++; if (line[j] === ']' || line[j] === '}') { depth--; if (!depth) break; } }
      toks.push({ t: 'num', v: line.slice(i, j + 1) }); i = j + 1; continue;
    }
    const m = /^(-?\d+(\.\d+)?([eE][-+]?\d+)?)/.exec(line.slice(i));
    if (m) { toks.push({ t: 'num', v: m[1] }); i += m[1].length; continue; }
    const w = /^([A-Za-z_][\w.]*)(:)?/.exec(line.slice(i));
    if (w) { toks.push({ t: 'word', v: w[1] }); if (w[2]) toks.push({ t: 'colon', v: ':' }); i += w[0].length; continue; }
    errors.push({ line: ln, message: `Unexpected "${c}"` });
    return toks;
  }
  return toks;
}

const litValue = (t: Tok): ParamValue => (t.t === 'str' ? t.v : t.t === 'num' ? Number(t.v) : t.v === 'true' ? true : t.v === 'false' ? false : t.v);

export interface ParsedSheet { events: EventNode[]; globals: VariableDef[]; errors: ScriptError[] }

export function parseSheet(src: string): ParsedSheet {
  const lines = src.split(/\r?\n/);
  const errors: ScriptError[] = [];
  const globals: VariableDef[] = [];
  const root: EventNode[] = [];
  const stack: { list: EventNode[]; ev?: EventBlock; line: number }[] = [{ list: root, line: 0 }];
  for (let li = 0; li < lines.length; li++) {
    const ln = li + 1;
    const raw = lines[li];
    if (!raw.trim() || raw.trim().startsWith('//')) continue;
    const top = stack[stack.length - 1];
    const first = raw.trim().split(/\s+/)[0];
    // Variable lines carry raw JSON values, so they are read before tokenizing.
    if (first === 'var' || first === 'local') {
      const kw = first;
      const m = /^\s*(?:var|local)\s+(?:(const|static)\s+)?([A-Za-z_]\w*)\s+(\w+)\s*=\s*(.+?)\s*$/.exec(raw);
      const flag = m?.[1] ?? '', name = m?.[2], type = m?.[3] as VarType;
      if (!m || !name || !VAR_TYPES.includes(type)) { errors.push({ line: ln, message: `Write: ${kw} name type = value (types: ${VAR_TYPES.join(', ')})` }); continue; }
      let value: any;
      try { value = JSON.parse(m[4]); } catch { errors.push({ line: ln, message: 'The value must be JSON: 0, "text", true, [1,2], {"a":1}' }); continue; }
      const def: VariableDef = { name, type, value };
      if (flag === 'const') def.isConstant = true;
      if (flag === 'static') def.isStatic = true;
      if (kw === 'var') { if (stack.length > 1) errors.push({ line: ln, message: 'var belongs at the top level; use local inside an event' }); globals.push(def); }
      else { if (!top.ev) errors.push({ line: ln, message: 'local must be inside an event' }); else (top.ev.locals ??= []).push(def); }
      continue;
    }
    const toks = tokenize(raw, ln, errors);
    if (!toks.length) continue;
    const head = toks[0];
    if (head.t === 'rbrace') { if (stack.length === 1) errors.push({ line: ln, message: 'Unmatched }' }); else stack.pop(); continue; }
    if (head.t !== 'word') { errors.push({ line: ln, message: 'Expected a keyword (event, group, when, if, do, var, local, comment)' }); continue; }
    const kw = head.v;
    if (kw === 'comment') {
      if (toks[1]?.t !== 'str') { errors.push({ line: ln, message: 'comment needs "text"' }); continue; }
      if (top.ev) { errors.push({ line: ln, message: 'Comments go between events, not inside one (use // after a block)' }); continue; }
      top.list.push({ kind: 'comment', id: newId('cm'), text: toks[1].v }); continue;
    }
    if (kw === 'group') {
      if (toks[1]?.t !== 'str' || toks[toks.length - 1].t !== 'lbrace') { errors.push({ line: ln, message: 'Write: group "Name" {' }); continue; }
      const g: EventNode = { kind: 'group', id: newId('grp'), name: toks[1].v, active: !toks.some((t) => t.t === 'word' && t.v === 'inactive'), children: [] };
      if (top.ev) top.ev.children.push(g); else top.list.push(g);
      stack.push({ list: g.children, line: ln }); continue;
    }
    const MODS = ['else', 'or', 'off', 'loose', 'break'];
    if (kw === 'event' || MODS.includes(kw)) {
      const words = toks.filter((t) => t.t === 'word').map((t) => t.v);
      if (!words.includes('event') || toks[toks.length - 1].t !== 'lbrace') { errors.push({ line: ln, message: 'Write: [else] [or] [off] [loose] event {' }); continue; }
      const ev: EventBlock = { kind: 'event', id: newId('ev'), conditions: [], actions: [], children: [] };
      if (words.includes('else')) ev.isElse = true;
      if (words.includes('or')) ev.isOr = true;
      if (words.includes('off')) ev.disabled = true;
      if (words.includes('loose')) ev.loose = true;
      if (words.includes('break')) ev.breakpoint = true;
      if (top.ev) top.ev.children.push(ev); else top.list.push(ev);
      stack.push({ list: ev.children, ev, line: ln }); continue;
    }
    if (kw === 'when' || kw === 'if' || kw === 'do') {
      if (!top.ev) { errors.push({ line: ln, message: `"${kw}" must be inside an event { }` }); continue; }
      let k = 1;
      const b: BlockInstance = { id: newId('b'), block: '', params: {} };
      while (toks[k]?.t === 'word' && (toks[k].v === 'not' || toks[k].v === 'off')) { if (toks[k].v === 'not') b.invert = true; else b.disabled = true; k++; }
      if (toks[k]?.t !== 'word') { errors.push({ line: ln, message: 'Expected a block id, e.g. object.set_x' }); continue; }
      b.block = toks[k++].v;
      const def = BLOCK_DEFS[b.block];
      if (!def) errors.push({ line: ln, message: `Unknown block "${b.block}" (it is kept, but check the spelling)` });
      if (toks[k]?.t === 'at') b.target = toks[k++].v;
      let heredocKey: string | null = null;
      while (k < toks.length) {
        const t = toks[k];
        if (t.t === 'comment') { if (t.v) b.comment = t.v; k++; continue; }
        if (t.t !== 'word' || toks[k + 1]?.t !== 'colon') { errors.push({ line: ln, message: 'Expected name: value' }); break; }
        const v = toks[k + 2];
        if (!v) { errors.push({ line: ln, message: `Missing value for ${t.v}` }); break; }
        if (v.t === 'heredoc') { heredocKey = t.v; k += 3; continue; }
        b.params[t.v] = litValue(v); k += 3;
      }
      if (heredocKey) {
        // Lines up to ">>>" (their common indentation removed).
        const body: string[] = [];
        let j = li + 1;
        for (; j < lines.length && !lines[j].trim().startsWith('>>>'); j++) body.push(lines[j]);
        if (j >= lines.length) errors.push({ line: ln, message: 'Missing >>> to close the text block' });
        else { const after = lines[j].trim().slice(3).trim(); if (after.startsWith('//') && after.slice(2).trim()) b.comment = after.slice(2).trim(); }
        const pad = Math.min(...body.filter((l) => l.trim()).map((l) => /^\s*/.exec(l)![0].length), 99);
        b.params[heredocKey] = body.map((l) => l.slice(Math.min(pad, l.length))).join('\n');
        li = j;
      }
      if (def) {
        if ((kw === 'do') !== (def.kind === 'action')) errors.push({ line: ln, message: `${b.block} is a${def.kind === 'action' ? 'n action: use "do"' : ' condition: use "if" (or "when" for triggers)'}` });
        if (def.target === 'object' && !b.target) errors.push({ line: ln, message: `${b.block} needs an object: add @ObjectName` });
        for (const p of Object.keys(b.params)) if (!def.params.some((x) => x.name === p)) errors.push({ line: ln, message: `${b.block} has no parameter "${p}" (it has: ${def.params.map((x) => x.name).join(', ') || 'none'})` });
      }
      if (kw === 'do') top.ev.actions.push(b);
      else { if (kw === 'when' && top.ev.conditions.length) errors.push({ line: ln, message: 'A "when" trigger must be the first condition' }); top.ev.conditions.push(b); }
      continue;
    }
    errors.push({ line: ln, message: `Unknown keyword "${kw}"` });
  }
  if (stack.length > 1) errors.push({ line: stack[stack.length - 1].line, message: 'Missing } for this block' });
  return { events: root, globals, errors };
}

/** Keep IDs (and so layouts, breakpoints, focus links) of nodes and blocks whose position and type still match. */
export function carryIds(oldList: EventNode[], newList: EventNode[]) {
  newList.forEach((n, i) => {
    const o = oldList[i];
    if (!o || o.kind !== n.kind) return;
    n.id = o.id;
    if (n.kind === 'event' && o.kind === 'event') {
      const same = (a: BlockInstance[], b: BlockInstance[]) => a.forEach((x, j) => { if (b[j]?.block === x.block) x.id = b[j].id; });
      same(n.conditions, o.conditions); same(n.actions, o.actions);
    }
    if (n.kind !== 'comment' && o.kind !== 'comment') carryIds(o.children, n.children);
  });
}
