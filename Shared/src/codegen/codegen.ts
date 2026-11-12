// Source-code generation from the shared IR. One compiler walks the event tree and emits through a
// per-language "spec". The generated program is a standalone logic module (variables, events, picking,
// loops, functions) with a tiny object model. It is NOT a full game: physics, rendering, behaviors,
// particles and audio need an engine and are reported as unsupported instead of being faked.
import { parseExpr, type Expr } from '../expr';
import { BLOCK_DEFS } from '../blocks/definitions';
import type { BlockInstance, EventBlock, EventNode, LogicDocument, VarType } from '../schema';
import type { SceneData } from '../runtime/scene';
import { splitArgs } from '../runtime/blockImpl';
import { SPECS } from './specs';

export type Lang = 'javascript' | 'python' | 'lua' | 'csharp' | 'cpp';
export interface CodegenResult { lang: Lang; code: string; unsupported: { blockId?: string; block?: string; reason: string }[]; ok: boolean; fileName: string }

type T = 'num' | 'str' | 'bool' | 'list' | 'dict' | 'any';
interface ECtx { selfVar?: string; selfType?: string; sol: Map<string, string>; locals: Map<string, T>; loopVar?: string; loopNames?: Map<string, string>; inFunction: boolean; inTick: boolean }

interface Spec {
  name: Lang; ext: string; typed: boolean; lists: boolean; dot: string;
  open(head: string): string; close(): string | null; elseIf?: never;
  ifHead(c: string): string; whileHead(c: string): string; forRange(v: string, a: string, b: string): string; forEach(v: string, list: string): string;
  declare(name: string, value: string, t: T): string; assign(lhs: string, v: string): string; stmt(e: string): string;
  comment(s: string): string; brk: string; ret(v: string): string;
  num(n: number): string; str(s: string): string; bool(b: boolean): string;
  not(a: string): string; and(a: string, b: string): string; or(a: string, b: string): string;
  eq(a: string, b: string, t: T): string; ne(a: string, b: string, t: T): string;
  concat(a: string, b: string): string; toStr(a: string, t: T): string; toNum(a: string, t: T): string;
  ternary(c: string, a: string, b: string): string;
  pow(a: string, b: string): string; mod(a: string, b: string): string; div(a: string, b: string): string;
  filter(list: string, v: string, cond: string): string; single(o: string): string; len(list: string): string; first(list: string): string; all(type: string): string;
  objVar(o: string, name: string, t: T): string; objVarSet(o: string, name: string, v: string, t: T): string;
  listPush(l: string, v: string): string; listAt(l: string, i: string): string; listSet(l: string, i: string, v: string): string; listRemoveAt(l: string, i: string): string; listClear(l: string): string; listContains(l: string, v: string): string;
  dictSet(d: string, k: string, v: string): string; dictGet(d: string, k: string): string; dictDelete(d: string, k: string): string;
  global(name: string): string; call(fn: string, args: string[]): string;
  funcOpen(name: string, params: string[], ret: boolean): string;
  program(p: { globals: string[]; functions: string[]; start: string[]; tick: string[]; keyPressed: string[]; keyReleased: string[]; signal: string[]; instances: string[]; seed: number; locals: string[] }): string;
}

const ind = (lines: string[], n = 1, unit = '    ') => lines.map((l) => (l ? unit.repeat(n) + l : l));
const sanitize = (s: string) => s.replace(/[^A-Za-z0-9_]/g, '_').replace(/^(\d)/, '_$1');

// ------------------------------------------------------------------ compiler
class Compiler {
  unsupported: CodegenResult['unsupported'] = [];
  lines: string[] = [];
  depth = 0;
  tmp = 0;
  globals: Map<string, T>;
  typeVars = new Map<string, Map<string, T>>();
  everyTimers: string[] = [];
  constructor(public s: Spec, public doc: LogicDocument, public scene: SceneData | null) {
    this.globals = new Map(doc.globals.map((g) => [g.name, varT(g.type)]));
    if (scene) {
      for (const i of scene.instances) {
        let m = this.typeVars.get(i.type.toLowerCase());
        if (!m) this.typeVars.set(i.type.toLowerCase(), (m = new Map()));
        for (const [k, v] of Object.entries(i.vars)) m.set(k, typeof v === 'number' ? 'num' : typeof v === 'boolean' ? 'bool' : typeof v === 'string' ? 'str' : 'any');
      }
      for (const t of scene.objectTypes) { let m = this.typeVars.get(t.name.toLowerCase()); if (!m) this.typeVars.set(t.name.toLowerCase(), (m = new Map())); for (const v of t.vars) m.set(v.name, varT(v.type)); }
    }
  }
  emit(l: string | null) { if (l !== null) this.lines.push('    '.repeat(this.depth) + l); }
  open(h: string) { this.emit(this.s.open(h)); this.depth++; if (this.s.name === 'python') this.emit('pass'); }
  close() { this.depth--; this.emit(this.s.close()); }
  bad(reason: string, b?: BlockInstance) { this.unsupported.push({ blockId: b?.id, block: b?.block, reason }); this.emit(this.s.comment('UNSUPPORTED: ' + reason)); }

  expr(src: any, c: ECtx, b?: BlockInstance): { code: string; t: T } {
    let e: Expr;
    try { e = parseExpr(src); } catch (err: any) { this.bad(`expression "${src}": ${err.message}`, b); return { code: this.s.num(0), t: 'num' }; }
    return this.ex(e, c, b);
  }

  ex(e: Expr, c: ECtx, b?: BlockInstance): { code: string; t: T } {
    const s = this.s;
    switch (e.t) {
      case 'num': return { code: s.num(e.v), t: 'num' };
      case 'str': return { code: s.str(e.v), t: 'str' };
      case 'bool': return { code: s.bool(e.v), t: 'bool' };
      case 'ident': {
        const l = e.name.toLowerCase();
        if (l === 'dt') return { code: c.inTick ? 'dt' : s.num(0), t: 'num' };
        if (l === 'time') return { code: 'W.time', t: 'num' };
        if (l === 'tickcount') return { code: 'W.ticks', t: 'num' };
        if (l === 'pi') return { code: s.num(Math.PI), t: 'num' };
        if (l === 'loopindex') return { code: c.loopVar ?? s.num(0), t: 'num' };
        if (c.locals.has(e.name)) return { code: sanitize(e.name), t: c.locals.get(e.name)! };
        if (this.globals.has(e.name)) return { code: s.global(e.name), t: this.globals.get(e.name)! };
        this.bad(`unknown variable "${e.name}"`, b); return { code: s.num(0), t: 'num' };
      }
      case 'member': {
        const [head, prop] = e.path;
        const hl = head.toLowerCase();
        if (e.path.length !== 2) { this.bad(`behavior/nested expression ${e.path.join('.')} needs an engine`, b); return { code: s.num(0), t: 'num' }; }
        if (hl === 'mouse' || hl === 'camera' || hl === 'function') { this.bad(`${head}.${prop} needs an engine`, b); return { code: s.num(0), t: 'num' }; }
        let obj: string; let type: string;
        if (hl === 'self') { if (!c.selfVar) { this.bad('Self used outside an object block', b); return { code: s.num(0), t: 'num' }; } obj = c.selfVar; type = c.selfType!; }
        else {
          type = head;
          if (prop.toLowerCase() === 'count') return { code: s.len(s.all(head)), t: 'num' };
          obj = c.selfType?.toLowerCase() === hl && c.selfVar ? c.selfVar : s.first(c.sol.get(hl) ?? s.all(head));
        }
        return this.prop(obj, type, prop, b);
      }
      case 'unary': { const a = this.ex(e.e, c, b); return e.op === '-' ? { code: `(-${s.toNum(a.code, a.t)})`, t: 'num' } : { code: s.not(this.bool(a)), t: 'bool' }; }
      case 'cond': { const cc = this.ex(e.c, c, b), a = this.ex(e.a, c, b), bb = this.ex(e.b, c, b); const t = a.t === bb.t ? a.t : 'str'; return { code: s.ternary(this.bool(cc), t === 'str' ? s.toStr(a.code, a.t) : a.code, t === 'str' ? s.toStr(bb.code, bb.t) : bb.code), t }; }
      case 'bin': {
        const a = this.ex(e.a, c, b), bb = this.ex(e.b, c, b);
        switch (e.op) {
          case 'and': return { code: s.and(this.bool(a), this.bool(bb)), t: 'bool' };
          case 'or': return { code: s.or(this.bool(a), this.bool(bb)), t: 'bool' };
          case '&': return { code: s.concat(s.toStr(a.code, a.t), s.toStr(bb.code, bb.t)), t: 'str' };
          case '+': if (a.t === 'str' || bb.t === 'str') return { code: s.concat(s.toStr(a.code, a.t), s.toStr(bb.code, bb.t)), t: 'str' }; return { code: `(${s.toNum(a.code, a.t)} + ${s.toNum(bb.code, bb.t)})`, t: 'num' };
          case '-': case '*': return { code: `(${s.toNum(a.code, a.t)} ${e.op} ${s.toNum(bb.code, bb.t)})`, t: 'num' };
          case '/': return { code: s.div(s.toNum(a.code, a.t), s.toNum(bb.code, bb.t)), t: 'num' };
          case '%': return { code: s.mod(s.toNum(a.code, a.t), s.toNum(bb.code, bb.t)), t: 'num' };
          case '^': return { code: s.pow(s.toNum(a.code, a.t), s.toNum(bb.code, bb.t)), t: 'num' };
          case '=': case '<>': {
            const t: T = a.t === 'num' || bb.t === 'num' ? 'num' : 'str';
            const A = t === 'num' ? s.toNum(a.code, a.t) : s.toStr(a.code, a.t), B = t === 'num' ? s.toNum(bb.code, bb.t) : s.toStr(bb.code, bb.t);
            return { code: e.op === '=' ? s.eq(A, B, t) : s.ne(A, B, t), t: 'bool' };
          }
          default: return { code: `(${s.toNum(a.code, a.t)} ${e.op} ${s.toNum(bb.code, bb.t)})`, t: 'bool' };
        }
      }
      case 'call': {
        const args = e.args.map((a) => this.ex(a, c, b));
        const n = e.name;
        if (n === 'loopindex') {
          if (!e.args.length) return { code: c.loopVar ?? s.num(0), t: 'num' };
          const name = e.args[0].t === 'str' ? (e.args[0] as any).v : null;
          const v = name ? c.loopNames?.get(name) : undefined;
          if (!v) { this.bad(`loopindex("${name}") refers to no enclosing For loop`, b); return { code: s.num(0), t: 'num' }; }
          return { code: v, t: 'num' };
        }
        if (n === 'item') { if (!c.loopVar || !(c as any).itemVar) { this.bad('item() outside "For each item"', b); return { code: s.num(0), t: 'num' }; } return { code: (c as any).itemVar, t: 'any' }; }
        if (n === 'param') { if (!c.inFunction) this.bad('param() outside a function', b); return { code: s.listAt('fargs', s.toNum(args[0]?.code ?? '0', args[0]?.t ?? 'num')), t: 'any' }; }
        if (n === 'call') { const fname = e.args[0]?.t === 'str' ? (e.args[0] as any).v : null; if (!fname) { this.bad('call() needs a literal function name', b); return { code: s.num(0), t: 'num' }; } return { code: s.call('fn_' + sanitize(fname), [this.paramList(args.slice(1))]), t: 'any' }; }
        const numeric = ['abs', 'floor', 'ceil', 'round', 'int', 'float', 'sqrt', 'sin', 'cos', 'tan', 'atan2', 'min', 'max', 'clamp', 'lerp', 'random', 'distance', 'angle'];
        if (numeric.includes(n)) return { code: s.call('rt_' + n, args.map((a) => s.toNum(a.code, a.t))), t: 'num' };
        if (n === 'str') return { code: s.toStr(args[0].code, args[0].t), t: 'str' };
        if (n === 'upper' || n === 'lower') return { code: s.call('rt_' + n, [s.toStr(args[0].code, args[0].t)]), t: 'str' };
        if (n === 'zeropad') return { code: s.call('rt_zeropad', [s.toNum(args[0].code, args[0].t), s.toNum(args[1].code, args[1].t)]), t: 'str' };
        if (n === 'len') return { code: args[0].t === 'list' ? s.len(args[0].code) : s.call('rt_len', [s.toStr(args[0].code, args[0].t)]), t: 'num' };
        if (n === 'choose' && !s.typed) return { code: s.call('rt_choose', args.map((a) => a.code)), t: 'any' };
        if (n === 'choose' && s.typed) { const allNum = args.every((a) => a.t === 'num'); return { code: s.call(allNum ? 'rt_choose' : 'rt_choose_s', args.map((a) => allNum ? a.code : s.toStr(a.code, a.t))), t: allNum ? 'num' : 'str' }; }
        if (n === 'at' && s.lists) return { code: s.listAt(args[0].code, s.toNum(args[1].code, args[1].t)), t: 'any' };
        if (n === 'get' && s.lists) return { code: s.dictGet(args[0].code, s.toStr(args[1].code, args[1].t)), t: 'any' };
        if (n === 'contains' && s.lists) return { code: s.listContains(args[0].code, args[1].code), t: 'bool' };
        this.bad(`function ${n}() is not supported by the ${s.name} exporter`, b);
        return { code: s.num(0), t: 'num' };
      }
    }
  }

  paramList(args: { code: string; t: T }[]) { return this.s.name === 'python' ? `[${args.map((a) => a.code).join(', ')}]` : this.s.name === 'lua' ? `{${args.map((a) => a.code).join(', ')}}` : this.s.name === 'csharp' ? `new List<object>{${args.map((a) => a.code).join(', ')}}` : this.s.name === 'cpp' ? `std::vector<double>{${args.map((a) => this.s.toNum(a.code, a.t)).join(', ')}}` : `[${args.map((a) => a.code).join(', ')}]`; }

  bool(a: { code: string; t: T }) { return a.t === 'bool' ? a.code : this.s.call('rt_truthy', [a.code]); }

  prop(obj: string, type: string, prop: string, b?: BlockInstance): { code: string; t: T } {
    const p = prop.toLowerCase();
    if (['x', 'y', 'z', 'angle', 'uid'].includes(p)) return { code: `${obj}${this.s.dot}${p}`, t: 'num' };
    const vt = this.typeVars.get(type.toLowerCase())?.get(prop) ?? 'any';
    if (!this.typeVars.get(type.toLowerCase())?.has(prop)) this.unsupported.push({ blockId: b?.id, block: b?.block, reason: `"${type}.${prop}" is not a known instance variable or a supported property (x, y, z, angle, uid)` });
    return { code: this.s.objVar(obj, prop, vt), t: vt };
  }

  solFor(type: string, c: ECtx) { return c.sol.get(type.toLowerCase()) ?? this.s.all(type); }

  // ---- events
  nodes(nodes: EventNode[], c: ECtx, skipTriggers = true) {
    let flag: string | null = null;
    for (const n of nodes) {
      if (n.kind === 'comment') { this.emit(this.s.comment(n.text.split('\n')[0])); continue; }
      if (n.kind === 'group') { if (!n.active) continue; this.emit(this.s.comment(`Group: ${n.name}`)); this.nodes(n.children, c, skipTriggers); flag = null; continue; }
      if (n.disabled || n.loose) continue;
      const first = n.conditions.find((x) => !x.disabled);
      if (skipTriggers && first && BLOCK_DEFS[first.block]?.trigger) continue;
      if (n.isElse) {
        if (!flag) { this.bad('Else without a previous event'); continue; }
        this.open(this.s.ifHead(this.s.not(flag)));
        this.event(n, c, flag);
        this.close();
      } else {
        flag = `ran_${this.tmp++}`;
        this.emit(this.s.declare(flag, this.s.bool(false), 'bool'));
        this.event(n, c, flag);
      }
    }
  }

  event(ev: EventBlock, c: ECtx, flag: string | null, start = 0) {
    const scope: ECtx = { ...c, sol: new Map(c.sol), locals: new Map(c.locals) };
    for (const v of ev.locals ?? []) {
      scope.locals.set(v.name, varT(v.type));
      if (v.isStatic) this.bad(`static local "${v.name}" is exported as a normal local`);
      this.emit(this.s.declare(sanitize(v.name), this.lit(v.value, varT(v.type)), varT(v.type)));
    }
    this.conds(ev, scope, flag, start, 0);
  }

  conds(ev: EventBlock, c: ECtx, flag: string | null, i: number, opened: number) {
    const conds = ev.conditions;
    if (ev.isOr) { this.orConds(ev, c, flag); return; }
    while (i < conds.length && (conds[i].disabled || BLOCK_DEFS[conds[i].block]?.trigger)) i++;
    if (i >= conds.length) {
      if (flag) this.emit(this.s.assign(flag, this.s.bool(true)));
      this.actions(ev.actions, c, ev);
      this.nodes(ev.children, c);
      for (let k = 0; k < opened; k++) this.close();
      return;
    }
    const b = conds[i];
    const def = BLOCK_DEFS[b.block];
    if (!def) { this.bad(`unknown block ${b.block}`, b); this.conds(ev, c, flag, i + 1, opened); return; }
    if (def.looping) { this.loop(b, ev, c, flag, i, opened); return; }
    if (def.target === 'object') {
      const type = b.target!;
      const v = `o${this.depth}_${this.tmp++}`;
      const test = this.objCond(b, { ...c, selfVar: v, selfType: type });
      if (test === null) { this.conds(ev, c, flag, i + 1, opened); return; }
      const solName = `sol_${sanitize(type)}_${this.tmp++}`;
      this.emit(this.s.declare(solName, this.s.filter(this.solFor(type, c), v, b.invert ? this.s.not(test) : test), 'list'));
      c.sol.set(type.toLowerCase(), solName);
      this.open(this.s.ifHead(`${this.s.len(solName)} > 0`));
      this.conds(ev, c, flag, i + 1, opened + 1);
      return;
    }
    const test = this.sysCond(b, c);
    if (test === null) { this.conds(ev, c, flag, i + 1, opened); return; }
    this.open(this.s.ifHead(b.invert ? this.s.not(test) : test));
    this.conds(ev, c, flag, i + 1, opened + 1);
  }

  orConds(ev: EventBlock, c: ECtx, flag: string | null) {
    const parts: string[] = [];
    for (const b of ev.conditions) {
      if (b.disabled || BLOCK_DEFS[b.block]?.trigger) continue;
      if (BLOCK_DEFS[b.block]?.target === 'object') { this.bad('object conditions inside OR blocks are not exported', b); continue; }
      const t = this.sysCond(b, c); if (t) parts.push(b.invert ? this.s.not(t) : t);
    }
    this.open(this.s.ifHead(parts.length ? parts.reduce((a, b2) => this.s.or(a, b2)) : this.s.bool(false)));
    if (flag) this.emit(this.s.assign(flag, this.s.bool(true)));
    this.actions(ev.actions, c, ev);
    this.nodes(ev.children, c);
    this.close();
  }

  loop(b: BlockInstance, ev: EventBlock, c: ECtx, flag: string | null, i: number, opened: number) {
    const s = this.s;
    const idx = `i${this.tmp++}`;
    const inner: ECtx = { ...c, sol: new Map(c.sol), loopVar: idx };
    switch (b.block) {
      case 'system.repeat': this.open(s.forRange(idx, s.num(0), `(${s.toNum(this.expr(b.params.count, c, b).code, 'num')}) - 1`)); break;
      case 'system.for': {
        this.open(s.forRange(idx, s.toNum(this.expr(b.params.start, c, b).code, 'num'), s.toNum(this.expr(b.params.end, c, b).code, 'num')));
        inner.loopNames = new Map(c.loopNames ?? []);
        inner.loopNames.set(String(b.params.name), idx);
        break;
      }
      case 'system.while': { this.emit(s.declare(idx, s.num(-1), 'num')); const cond = this.expr(b.params.condition, inner, b); this.open(s.whileHead(this.bool(cond))); this.emit(s.assign(idx, `${idx} + 1`)); break; }
      case 'system.for_each': {
        const type = String(b.params.object);
        const ov = `each_${this.tmp++}`;
        this.emit(s.declare(idx, s.num(-1), 'num'));
        this.open(s.forEach(ov, this.solFor(type, c)));
        this.emit(s.assign(idx, `${idx} + 1`));
        const one = `sol_${sanitize(type)}_${this.tmp++}`;
        this.emit(s.declare(one, s.filter(this.solFor(type, c), 'q', s.eq(`q${s.dot}uid`, `${ov}${s.dot}uid`, 'num')), 'list'));
        inner.sol.set(type.toLowerCase(), one);
        break;
      }
      case 'list.for_each_item': {
        if (!s.lists) { this.bad('lists are not supported by the ' + s.name + ' exporter', b); return; }
        const iv = `item_${this.tmp++}`;
        this.emit(s.declare(idx, s.num(-1), 'num'));
        this.open(s.forEach(iv, s.global(String(b.params.variable))));
        this.emit(s.assign(idx, `${idx} + 1`));
        (inner as any).itemVar = iv;
        break;
      }
      default: this.bad(`loop "${b.block}" is not exported`, b); this.conds(ev, c, flag, i + 1, opened); return;
    }
    this.conds(ev, inner, flag, i + 1, 0);
    this.close();
    for (let k = 0; k < opened; k++) this.close();
  }

  objCond(b: BlockInstance, c: ECtx): string | null {
    const s = this.s; const o = c.selfVar!;
    switch (b.block) {
      case 'object.compare_property': { const p = this.prop(o, c.selfType!, String(b.params.property), b); return this.compare(p, String(b.params.op), this.expr(b.params.value, c, b)); }
      case 'object.compare_var': { const p = this.prop(o, c.selfType!, String(b.params.variable), b); return this.compare(p, String(b.params.op), this.expr(b.params.value, c, b)); }
      case 'object.is_var_true': return this.bool(this.prop(o, c.selfType!, String(b.params.variable), b));
    }
    this.bad(`"${BLOCK_DEFS[b.block]?.name ?? b.block}" needs the game runtime`, b);
    return null;
  }

  compare(a: { code: string; t: T }, op: string, bb: { code: string; t: T }) {
    const s = this.s;
    if (op === '=' || op === '<>') { const t: T = a.t === 'num' || bb.t === 'num' ? 'num' : 'str'; const A = t === 'num' ? s.toNum(a.code, a.t) : s.toStr(a.code, a.t), B = t === 'num' ? s.toNum(bb.code, bb.t) : s.toStr(bb.code, bb.t); return op === '=' ? s.eq(A, B, t) : s.ne(A, B, t); }
    return `(${s.toNum(a.code, a.t)} ${op} ${s.toNum(bb.code, bb.t)})`;
  }

  sysCond(b: BlockInstance, c: ECtx): string | null {
    const s = this.s;
    switch (b.block) {
      case 'system.every_tick': return s.bool(true);
      case 'system.if': return this.bool(this.expr(b.params.condition, c, b));
      case 'system.compare_values': return this.compare(this.expr(b.params.a, c, b), String(b.params.op), this.expr(b.params.b, c, b));
      case 'system.compare_variable': return this.compare(this.ex({ t: 'ident', name: String(b.params.variable) }, c, b), String(b.params.op), this.expr(b.params.value, c, b));
      case 'system.is_boolean_set': return this.bool(this.ex({ t: 'ident', name: String(b.params.variable) }, c, b));
      case 'system.random_chance': return `(${s.call('rt_rand01', [])} * 100 < ${s.toNum(this.expr(b.params.percent, c, b).code, 'num')})`;
      case 'system.object_exists': return `${s.len(s.all(String(b.params.object)))} > 0`;
      case 'system.compare_count': return this.compare({ code: s.len(s.all(String(b.params.object))), t: 'num' }, String(b.params.op), this.expr(b.params.value, c, b));
      case 'input.key_is_down': return s.call('rt_key_down', [s.str(String(b.params.key))]);
      case 'list.contains': if (!s.lists) break; return s.listContains(s.global(String(b.params.variable)), this.expr(b.params.value, c, b).code);
      case 'timer.every_x_seconds': {
        const st = `every_${this.everyTimers.length}`;
        this.everyTimers.push(st);
        return s.call('rt_every', [s.str(st), s.toNum(this.expr(b.params.seconds, c, b).code, 'num')]);
      }
    }
    this.bad(`"${BLOCK_DEFS[b.block]?.name ?? b.block}" needs the game runtime`, b);
    return null;
  }

  lit(v: any, t: T): string {
    const s = this.s;
    if (t === 'num') return s.num(Number(v) || 0);
    if (t === 'bool') return s.bool(!!v);
    if (t === 'str') return s.str(String(v ?? ''));
    if (t === 'list') return s.name === 'python' ? JSON.stringify(v ?? []) : s.name === 'lua' ? `{${(v ?? []).map((x: any) => JSON.stringify(x)).join(', ')}}` : s.name === 'javascript' ? JSON.stringify(v ?? []) : 'null';
    if (t === 'dict') return s.name === 'python' ? JSON.stringify(v ?? {}) : s.name === 'lua' ? '{}' : s.name === 'javascript' ? JSON.stringify(v ?? {}) : 'null';
    return s.num(0);
  }

  setVar(name: string, value: { code: string; t: T }, c: ECtx, b: BlockInstance) {
    const s = this.s;
    const t = c.locals.get(name) ?? this.globals.get(name);
    if (!t) { this.bad(`unknown variable "${name}"`, b); return; }
    const lhs = c.locals.has(name) ? sanitize(name) : s.global(name);
    const v = t === 'num' ? s.toNum(value.code, value.t) : t === 'str' ? s.toStr(value.code, value.t) : t === 'bool' ? this.bool(value) : value.code;
    this.emit(s.assign(lhs, v));
  }

  actions(list: BlockInstance[], c: ECtx, ev: EventBlock) {
    for (const a of list) {
      if (a.disabled) continue;
      const def = BLOCK_DEFS[a.block];
      if (!def) { this.bad(`unknown block ${a.block}`, a); continue; }
      if (def.target === 'object') {
        const type = a.target!;
        const v = `o_${this.tmp++}`;
        this.open(this.s.forEach(v, this.s.call('rt_alive', [this.solFor(type, c)])));
        this.objAction(a, { ...c, selfVar: v, selfType: type });
        this.close();
      } else this.sysAction(a, c);
    }
    void ev;
  }

  objAction(a: BlockInstance, c: ECtx) {
    const s = this.s; const o = c.selfVar!; const d = s.dot;
    const E = (n: string) => this.expr(a.params[n], c, a);
    const NUM = (n: string) => { const e = E(n); return s.toNum(e.code, e.t); };
    switch (a.block) {
      case 'object.set_var': { const t = this.typeVars.get(c.selfType!.toLowerCase())?.get(String(a.params.variable)) ?? 'any'; const v = E('value'); this.emit(s.objVarSet(o, String(a.params.variable), t === 'num' ? s.toNum(v.code, v.t) : t === 'str' ? s.toStr(v.code, v.t) : t === 'bool' ? this.bool(v) : v.code, t)); return; }
      case 'object.add_var': { const cur = this.prop(o, c.selfType!, String(a.params.variable), a); this.emit(s.objVarSet(o, String(a.params.variable), `${s.toNum(cur.code, cur.t)} + ${NUM('value')}`, 'num')); return; }
      case 'object.toggle_var': { const cur = this.prop(o, c.selfType!, String(a.params.variable), a); this.emit(s.objVarSet(o, String(a.params.variable), s.not(this.bool(cur)), 'bool')); return; }
      case 'object.set_position': this.emit(s.assign(`${o}${d}x`, NUM('x'))); this.emit(s.assign(`${o}${d}y`, NUM('y'))); this.emit(s.assign(`${o}${d}z`, NUM('z'))); return;
      case 'object.move': this.emit(s.assign(`${o}${d}x`, `${o}${d}x + ${NUM('dx')}`)); this.emit(s.assign(`${o}${d}y`, `${o}${d}y + ${NUM('dy')}`)); this.emit(s.assign(`${o}${d}z`, `${o}${d}z + ${NUM('dz')}`)); return;
      case 'object.move_forward': this.emit(s.stmt(s.call('rt_move_forward', [o, NUM('distance')]))); return;
      case 'object.set_angle': this.emit(s.assign(`${o}${d}angle`, s.call('rt_wrap', [NUM('angle')]))); return;
      case 'object.rotate': this.emit(s.assign(`${o}${d}angle`, s.call('rt_wrap', [`${o}${d}angle + ${NUM('degrees')}`]))); return;
      case 'object.destroy': this.emit(s.stmt(s.call('rt_destroy', [o]))); return;
    }
    this.bad(`"${BLOCK_DEFS[a.block]?.name ?? a.block}" needs the game runtime`, a);
  }

  sysAction(a: BlockInstance, c: ECtx) {
    const s = this.s;
    const E = (n: string) => this.expr(a.params[n], c, a);
    const name = String(a.params.variable ?? '');
    const varRef = () => (c.locals.has(name) ? sanitize(name) : s.global(name));
    switch (a.block) {
      case 'var.set': this.setVar(name, E('value'), c, a); return;
      case 'var.add': case 'var.subtract': { const cur = this.ex({ t: 'ident', name }, c, a); const v = E('value'); this.setVar(name, { code: `${s.toNum(cur.code, cur.t)} ${a.block === 'var.add' ? '+' : '-'} ${s.toNum(v.code, v.t)}`, t: 'num' }, c, a); return; }
      case 'var.toggle': { const cur = this.ex({ t: 'ident', name }, c, a); this.setVar(name, { code: s.not(this.bool(cur)), t: 'bool' }, c, a); return; }
      case 'system.log': { const v = E('message'); this.emit(s.stmt(s.call('rt_log', [s.toStr(v.code, v.t)]))); return; }
      case 'system.stop_loop': if (c.loopVar) this.emit(s.brk); else this.bad('Stop loop outside a loop', a); return;
      case 'object.create': {
        // Like the runtime, the created object becomes the picked instance for the following actions.
        const type = String(a.params.object);
        const solName = `sol_${sanitize(type)}_${this.tmp++}`;
        this.emit(s.declare(solName, s.single(s.call('rt_create', [s.str(type), s.toNum(E('x').code, E('x').t), s.toNum(E('y').code, E('y').t), s.toNum(E('z').code, E('z').t)])), 'list'));
        c.sol.set(type.toLowerCase(), solName);
        return;
      }
      case 'function.call': {
        const raw = String(a.params.args ?? '').trim();
        const args = raw ? splitArgs(raw).map((x) => this.expr(x, c, a)) : [];
        this.emit(s.stmt(s.call('fn_' + sanitize(String(a.params.name)), [this.paramList(args)]))); return;
      }
      case 'function.set_return': if (!c.inFunction) { this.bad('Return outside a function', a); return; } { const v = E('value'); this.emit(s.assign('ret', s.typed ? s.toNum(v.code, v.t) : v.code)); } return;
      case 'system.signal': this.emit(s.stmt(s.call('on_signal', [s.str(String(a.params.name))]))); return;
      case 'code.run': {
        // A code block written in the export language is pasted in as-is; other languages stay out (reported).
        const lang = String(a.params.language ?? 'javascript');
        if (lang === s.name) { this.emit(s.comment(`${lang} code block`)); for (const l of String(a.params.code ?? '').split('\n')) this.emit(l); }
        else this.bad(`${lang} code block is only included when exporting to ${lang}`, a);
        return;
      }
    }
    if (!s.lists && a.block.startsWith('list.') || !s.lists && a.block.startsWith('dict.')) { this.bad(`lists/dictionaries are not supported by the ${s.name} exporter`, a); return; }
    switch (a.block) {
      case 'list.push': this.emit(s.stmt(s.listPush(varRef(), E('value').code))); return;
      case 'list.set_at': this.emit(s.listSet(varRef(), s.toNum(E('index').code, E('index').t), E('value').code)); return;
      case 'list.remove_at': this.emit(s.stmt(s.listRemoveAt(varRef(), s.toNum(E('index').code, E('index').t)))); return;
      case 'list.clear': this.emit(s.stmt(s.listClear(varRef()))); return;
      case 'dict.set': this.emit(s.dictSet(varRef(), s.toStr(E('key').code, E('key').t), E('value').code)); return;
      case 'dict.delete': this.emit(s.stmt(s.dictDelete(varRef(), s.toStr(E('key').code, E('key').t)))); return;
    }
    this.bad(`"${BLOCK_DEFS[a.block]?.name ?? a.block}" needs the game runtime (no ${s.name} equivalent without an engine adapter)`, a);
  }

  /** Compile all events with a given trigger into a body. */
  triggerBody(blockId: string, c: ECtx, filter?: (b: BlockInstance) => string | null): string[] {
    const saved = this.lines; const savedDepth = this.depth;
    this.lines = []; this.depth = 0;
    const visit = (nodes: EventNode[]) => {
      for (const n of nodes) {
        if (n.kind === 'group') { if (n.active) visit(n.children); continue; }
        if (n.kind !== 'event' || n.disabled || n.loose) continue;
        const first = n.conditions.find((x) => !x.disabled);
        if (first?.block === blockId) {
          const guard = filter?.(first);
          if (guard) this.open(this.s.ifHead(guard));
          this.event(n, c, null, n.conditions.indexOf(first) + 1);
          if (guard) this.close();
        } else if (n.children.length && containsTrigger(n.children, blockId)) {
          this.bad(`trigger "${blockId}" nested in a sub-event is not exported`);
        }
      }
    };
    for (const sh of this.doc.sheets.slice(0, 1)) visit(sh.events);
    const out = this.lines; this.lines = saved; this.depth = savedDepth;
    return out;
  }

  run(): CodegenResult {
    const s = this.s;
    const base: ECtx = { sol: new Map(), locals: new Map(), inFunction: false, inTick: false };
    // Functions
    const functions: string[] = [];
    const fnNames = new Set<string>();
    for (const sh of this.doc.sheets) walkAll(sh.events, (n) => { if (n.kind === 'event') { const f = n.conditions.find((x) => !x.disabled); if (f?.block === 'function.on_function') fnNames.add(String(f.params.name)); } });
    for (const name of fnNames) {
      const own = this.triggerBodyFor(name, { ...base, inFunction: true });
      functions.push(s.funcOpen('fn_' + sanitize(name), ['fargs'], true), ...ind([s.declare('ret', s.typed ? s.num(0) : s.num(0), s.typed ? 'num' : 'any'), ...own, s.ret('ret')]), ...(s.close() !== null ? [s.close()!] : []), '');
    }
    const start = [
      ...this.triggerBody('system.on_game_start', base),
      ...this.triggerBody('system.on_start_of_layout', base),
    ];
    const saved = this.lines; this.lines = []; this.depth = 0;
    this.nodes(this.doc.sheets[0]?.events ?? [], { ...base, inTick: true });
    const tick = this.lines; this.lines = saved;
    const keyPressed = this.triggerBody('input.on_key_pressed', base, (b) => (String(b.params.key) === 'Any' ? null : s.eq('key', s.str(String(b.params.key)), 'str')));
    const keyReleased = this.triggerBody('input.on_key_released', base, (b) => (String(b.params.key) === 'Any' ? null : s.eq('key', s.str(String(b.params.key)), 'str')));
    const signal = this.triggerBody('system.on_signal', base, (b) => s.eq('name', s.str(String(b.params.name)), 'str'));
    // Report triggers that cannot be exported.
    for (const sh of this.doc.sheets) walkAll(sh.events, (n) => {
      if (n.kind !== 'event' || n.loose) return;
      const f = n.conditions.find((x) => !x.disabled);
      if (f && BLOCK_DEFS[f.block]?.trigger && !['system.on_game_start', 'system.on_start_of_layout', 'input.on_key_pressed', 'input.on_key_released', 'system.on_signal', 'function.on_function'].includes(f.block)) {
        this.unsupported.push({ blockId: f.id, block: f.block, reason: `trigger "${BLOCK_DEFS[f.block].name}" needs the game runtime; its event is not exported` });
      }
      for (const b of [...n.conditions, ...n.actions]) if (b.block === 'system.wait') this.unsupported.push({ blockId: b.id, block: b.block, reason: 'Wait needs an asynchronous scheduler; not exported' });
    });
    const globals = this.doc.globals.map((g) => `${g.name}|${this.lit(g.value, varT(g.type))}|${varT(g.type)}`);
    const instances = (this.scene?.instances ?? []).map((i) => JSON.stringify({ uid: i.uid, type: i.type, x: i.x, y: i.y, z: i.z, angle: this.scene!.plane === 'xz' ? i.ry : i.rz, vars: i.vars }));
    const code = s.program({ globals, functions, start, tick, keyPressed, keyReleased, signal, instances, seed: this.scene?.settings.seed ?? 1234, locals: [] }).replace('__PLANE__', this.scene?.plane ?? this.doc.plane);
    const uniq = new Map<string, CodegenResult['unsupported'][number]>();
    for (const u of this.unsupported) uniq.set(`${u.blockId}|${u.reason}`, u);
    const unsupported = [...uniq.values()];
    return { lang: s.name, code, unsupported, ok: unsupported.length === 0, fileName: `${sanitize(this.doc.name || 'logic')}.${s.ext}` };
  }

  triggerBodyFor(fnName: string, c: ECtx): string[] {
    const saved = this.lines; const savedDepth = this.depth;
    this.lines = []; this.depth = 0;
    const visit = (nodes: EventNode[]) => {
      for (const n of nodes) {
        if (n.kind === 'group') { if (n.active) visit(n.children); continue; }
        if (n.kind !== 'event' || n.disabled || n.loose) continue;
        const first = n.conditions.find((x) => !x.disabled);
        if (first?.block === 'function.on_function' && String(first.params.name) === fnName) this.event(n, c, null, n.conditions.indexOf(first) + 1);
      }
    };
    for (const sh of this.doc.sheets) visit(sh.events);
    const out = this.lines; this.lines = saved; this.depth = savedDepth;
    return out;
  }
}

function containsTrigger(nodes: EventNode[], id: string): boolean {
  let f = false; walkAll(nodes, (n) => { if (n.kind === 'event' && n.conditions.some((c) => c.block === id)) f = true; }); return f;
}
function walkAll(nodes: EventNode[], fn: (n: EventNode) => void) { for (const n of nodes) { fn(n); if (n.kind !== 'comment') walkAll(n.children, fn); } }
function varT(t: VarType): T { return t === 'number' ? 'num' : t === 'string' ? 'str' : t === 'boolean' ? 'bool' : t === 'array' ? 'list' : t === 'dict' ? 'dict' : t === 'object' ? 'num' : 'any'; }

export function generateCode(doc: LogicDocument, scene: SceneData | null, lang: Lang): CodegenResult {
  return new Compiler(SPECS[lang], doc, scene).run();
}

export type { Spec, T };
