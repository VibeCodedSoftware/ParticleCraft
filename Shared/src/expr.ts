// Safe, Construct 2-style expression language. Never uses eval.
// Examples: `Player.X + 10`, `Self.health - 1`, `random(1, 6)`, `"Coins: " & coins`, `score > 10 ? "win" : "keep going"`.

export type Expr =
  | { t: 'num'; v: number }
  | { t: 'str'; v: string }
  | { t: 'bool'; v: boolean }
  | { t: 'ident'; name: string }
  | { t: 'member'; path: string[] } // Player.X, Player.Platform.Speed, Mouse.X
  | { t: 'call'; name: string; args: Expr[] }
  | { t: 'unary'; op: '-' | 'not'; e: Expr }
  | { t: 'bin'; op: string; a: Expr; b: Expr }
  | { t: 'cond'; c: Expr; a: Expr; b: Expr };

export class ExprError extends Error {
  constructor(message: string, public pos = -1) { super(message); }
}

type Tok = { k: 'num' | 'str' | 'id' | 'op' | 'eof'; v: string; p: number };

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j])) j++;
      if (src[j] === 'e' || src[j] === 'E') { j++; if (src[j] === '-' || src[j] === '+') j++; while (/[0-9]/.test(src[j] ?? '')) j++; }
      out.push({ k: 'num', v: src.slice(i, j), p: i });
      i = j; continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1; let s = '';
      while (j < src.length && src[j] !== c) {
        if (src[j] === '\\' && j + 1 < src.length) { const n = src[j + 1]; s += n === 'n' ? '\n' : n; j += 2; continue; }
        // Construct escapes a quote by doubling it: "say ""hi"""
        s += src[j]; j++;
        if (src[j] === c && src[j + 1] === c) { s += c; j += 2; }
      }
      if (j >= src.length) throw new ExprError('Unterminated string', i);
      out.push({ k: 'str', v: s, p: i });
      i = j + 1; continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < src.length && /[A-Za-z0-9_]/.test(src[j])) j++;
      out.push({ k: 'id', v: src.slice(i, j), p: i });
      i = j; continue;
    }
    const two = src.slice(i, i + 2);
    if (['<=', '>=', '<>', '!=', '==', '&&', '||'].includes(two)) { out.push({ k: 'op', v: two, p: i }); i += 2; continue; }
    if ('+-*/%^()<>=,.&|?:!'.includes(c)) { out.push({ k: 'op', v: c, p: i }); i++; continue; }
    throw new ExprError(`Unexpected character '${c}'`, i);
  }
  out.push({ k: 'eof', v: '', p: src.length });
  return out;
}

const cache = new Map<string, Expr>();

export function parseExpr(src: string | number | boolean): Expr {
  if (typeof src === 'number') return { t: 'num', v: src };
  if (typeof src === 'boolean') return { t: 'bool', v: src };
  const key = src;
  const hit = cache.get(key);
  if (hit) return hit;
  const toks = tokenize(src);
  let pos = 0;
  const peek = () => toks[pos];
  const next = () => toks[pos++];
  const isOp = (v: string) => peek().k === 'op' && peek().v === v;
  const isKw = (v: string) => peek().k === 'id' && peek().v.toLowerCase() === v;
  const expect = (v: string) => { if (!isOp(v)) throw new ExprError(`Expected '${v}'`, peek().p); next(); };

  const parseTernary = (): Expr => {
    const c = parseOr();
    if (isOp('?')) { next(); const a = parseTernary(); expect(':'); const b = parseTernary(); return { t: 'cond', c, a, b }; }
    return c;
  };
  const parseOr = (): Expr => {
    let a = parseAnd();
    while (isOp('|') || isOp('||') || isKw('or')) { next(); a = { t: 'bin', op: 'or', a, b: parseAnd() }; }
    return a;
  };
  const parseAnd = (): Expr => {
    let a = parseCmp();
    while (isOp('&&') || isKw('and')) { next(); a = { t: 'bin', op: 'and', a, b: parseCmp() }; }
    return a;
  };
  const parseCmp = (): Expr => {
    let a = parseConcat();
    for (;;) {
      const t = peek();
      if (t.k === 'op' && ['=', '==', '<>', '!=', '<', '<=', '>', '>='].includes(t.v)) {
        next();
        const op = t.v === '==' ? '=' : t.v === '!=' ? '<>' : t.v;
        a = { t: 'bin', op, a, b: parseConcat() };
      } else return a;
    }
  };
  // Construct uses & for string concatenation.
  const parseConcat = (): Expr => {
    let a = parseAdd();
    while (isOp('&')) { next(); a = { t: 'bin', op: '&', a, b: parseAdd() }; }
    return a;
  };
  const parseAdd = (): Expr => {
    let a = parseMul();
    while (isOp('+') || isOp('-')) { const op = next().v; a = { t: 'bin', op, a, b: parseMul() }; }
    return a;
  };
  const parseMul = (): Expr => {
    let a = parseUnary();
    while (isOp('*') || isOp('/') || isOp('%')) { const op = next().v; a = { t: 'bin', op, a, b: parseUnary() }; }
    return a;
  };
  const parseUnary = (): Expr => {
    if (isOp('-')) { next(); return { t: 'unary', op: '-', e: parseUnary() }; }
    if (isOp('+')) { next(); return parseUnary(); }
    if (isOp('!') || isKw('not')) { next(); return { t: 'unary', op: 'not', e: parseUnary() }; }
    return parsePow();
  };
  const parsePow = (): Expr => {
    const a = parsePrimary();
    if (isOp('^')) { next(); return { t: 'bin', op: '^', a, b: parseUnary() }; }
    return a;
  };
  const parsePrimary = (): Expr => {
    const t = next();
    if (t.k === 'num') { const v = Number(t.v); if (Number.isNaN(v)) throw new ExprError(`Bad number '${t.v}'`, t.p); return { t: 'num', v }; }
    if (t.k === 'str') return { t: 'str', v: t.v };
    if (t.k === 'op' && t.v === '(') { const e = parseTernary(); expect(')'); return e; }
    if (t.k === 'id') {
      const lower = t.v.toLowerCase();
      if (lower === 'true') return { t: 'bool', v: true };
      if (lower === 'false') return { t: 'bool', v: false };
      if (isOp('(')) {
        next();
        const args: Expr[] = [];
        if (!isOp(')')) { args.push(parseTernary()); while (isOp(',')) { next(); args.push(parseTernary()); } }
        expect(')');
        return { t: 'call', name: lower, args };
      }
      if (isOp('.')) {
        const path = [t.v];
        while (isOp('.')) {
          next();
          const p = next();
          if (p.k !== 'id') throw new ExprError('Expected a name after "."', p.p);
          path.push(p.v);
        }
        // Behaviour or object expressions with arguments, e.g. Player.Health.Percent() are written without args here.
        if (isOp('(')) {
          next();
          const args: Expr[] = [];
          if (!isOp(')')) { args.push(parseTernary()); while (isOp(',')) { next(); args.push(parseTernary()); } }
          expect(')');
          return { t: 'call', name: path.join('.').toLowerCase(), args: [{ t: 'member', path }, ...args] };
        }
        return { t: 'member', path };
      }
      return { t: 'ident', name: t.v };
    }
    throw new ExprError(t.k === 'eof' ? 'Expression ended unexpectedly' : `Unexpected '${t.v}'`, t.p);
  };

  if (typeof src === 'string' && src.trim() === '') throw new ExprError('Empty expression', 0);
  const e = parseTernary();
  if (peek().k !== 'eof') throw new ExprError(`Unexpected '${peek().v}'`, peek().p);
  if (cache.size > 5000) cache.clear();
  cache.set(key, e);
  return e;
}

export function tryParse(src: string | number | boolean): { ok: true; expr: Expr } | { ok: false; error: string } {
  try { return { ok: true, expr: parseExpr(src) }; } catch (e: any) { return { ok: false, error: e.message }; }
}

/** What the evaluator needs from the runtime. */
export interface ExprContext {
  ident(name: string): any;
  member(path: string[]): any;
  rng(): number;
  call?(name: string, args: any[]): any; // host/runtime functions (param, loopindex...)
}

const DEG = Math.PI / 180;
export function toNum(v: any): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'string') { const n = parseFloat(v); return Number.isNaN(n) ? 0 : n; }
  return 0;
}
export function toStr(v: any): string {
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(Math.round(v * 1e6) / 1e6);
  if (typeof v === 'string') return v;
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (v == null) return '';
  return JSON.stringify(v);
}
export function truthy(v: any): boolean {
  if (typeof v === 'string') return v !== '' && v !== '0' && v.toLowerCase() !== 'false';
  return !!v && v !== 0;
}

/** Built-in expression functions. `codegen` targets map these names; keep the list in sync with codegen/common.ts. */
export const BUILTIN_FUNCTIONS: Record<string, { args: string; doc: string; fn: (a: any[], ctx: ExprContext) => any }> = {
  abs: { args: 'x', doc: 'Absolute value', fn: ([x]) => Math.abs(toNum(x)) },
  floor: { args: 'x', doc: 'Round down', fn: ([x]) => Math.floor(toNum(x)) },
  ceil: { args: 'x', doc: 'Round up', fn: ([x]) => Math.ceil(toNum(x)) },
  round: { args: 'x', doc: 'Round to nearest', fn: ([x]) => Math.round(toNum(x)) },
  int: { args: 'x', doc: 'Convert to integer (truncates)', fn: ([x]) => Math.trunc(toNum(x)) },
  float: { args: 'x', doc: 'Convert to number', fn: ([x]) => toNum(x) },
  str: { args: 'x', doc: 'Convert to text', fn: ([x]) => toStr(x) },
  sqrt: { args: 'x', doc: 'Square root', fn: ([x]) => Math.sqrt(toNum(x)) },
  sin: { args: 'deg', doc: 'Sine of an angle in degrees', fn: ([x]) => Math.sin(toNum(x) * DEG) },
  cos: { args: 'deg', doc: 'Cosine of an angle in degrees', fn: ([x]) => Math.cos(toNum(x) * DEG) },
  tan: { args: 'deg', doc: 'Tangent of an angle in degrees', fn: ([x]) => Math.tan(toNum(x) * DEG) },
  atan2: { args: 'y, x', doc: 'Angle in degrees', fn: ([y, x]) => Math.atan2(toNum(y), toNum(x)) / DEG },
  min: { args: 'a, b, ...', doc: 'Smallest value', fn: (a) => Math.min(...a.map(toNum)) },
  max: { args: 'a, b, ...', doc: 'Largest value', fn: (a) => Math.max(...a.map(toNum)) },
  clamp: { args: 'x, lo, hi', doc: 'Limit x between lo and hi', fn: ([x, lo, hi]) => Math.min(toNum(hi), Math.max(toNum(lo), toNum(x))) },
  lerp: { args: 'a, b, t', doc: 'Linear interpolation', fn: ([a, b, t]) => toNum(a) + (toNum(b) - toNum(a)) * toNum(t) },
  random: {
    args: 'a [, b]', doc: 'random(a): 0..a, random(a, b): a..b (not inclusive)',
    fn: (a, ctx) => a.length >= 2 ? toNum(a[0]) + ctx.rng() * (toNum(a[1]) - toNum(a[0])) : ctx.rng() * toNum(a[0] ?? 1),
  },
  choose: { args: 'a, b, ...', doc: 'Pick one argument at random', fn: (a, ctx) => a[Math.floor(ctx.rng() * a.length)] },
  distance: { args: 'x1, y1, x2, y2', doc: '2D distance', fn: ([a, b, c, d]) => Math.hypot(toNum(c) - toNum(a), toNum(d) - toNum(b)) },
  distance3: { args: 'x1, y1, z1, x2, y2, z2', doc: '3D distance', fn: ([a, b, c, d, e, f]) => Math.hypot(toNum(d) - toNum(a), toNum(e) - toNum(b), toNum(f) - toNum(c)) },
  angle: { args: 'x1, y1, x2, y2', doc: 'Angle in degrees from point 1 to point 2', fn: ([a, b, c, d]) => Math.atan2(toNum(d) - toNum(b), toNum(c) - toNum(a)) / DEG },
  len: { args: 'text or list', doc: 'Length of text or list', fn: ([x]) => Array.isArray(x) ? x.length : toStr(x).length },
  upper: { args: 'text', doc: 'Uppercase', fn: ([x]) => toStr(x).toUpperCase() },
  lower: { args: 'text', doc: 'Lowercase', fn: ([x]) => toStr(x).toLowerCase() },
  left: { args: 'text, n', doc: 'First n characters', fn: ([x, n]) => toStr(x).slice(0, toNum(n)) },
  right: { args: 'text, n', doc: 'Last n characters', fn: ([x, n]) => { const s = toStr(x); return s.slice(Math.max(0, s.length - toNum(n))); } },
  mid: { args: 'text, start, count', doc: 'Substring', fn: ([x, i, n]) => toStr(x).substr(toNum(i), toNum(n)) },
  find: { args: 'text, search', doc: 'Index of search in text, -1 if missing', fn: ([x, s]) => toStr(x).indexOf(toStr(s)) },
  zeropad: { args: 'n, digits', doc: 'Pad a number with zeros', fn: ([n, d]) => String(Math.trunc(toNum(n))).padStart(toNum(d), '0') },
  at: { args: 'list, index', doc: 'Item of a list (0-based)', fn: ([l, i]) => Array.isArray(l) ? l[toNum(i)] ?? 0 : 0 },
  get: { args: 'dict, key', doc: 'Value of a dictionary key', fn: ([d, k]) => (d && typeof d === 'object' && !Array.isArray(d)) ? d[toStr(k)] ?? 0 : 0 },
  haskey: { args: 'dict, key', doc: 'True if key exists', fn: ([d, k]) => !!(d && typeof d === 'object' && toStr(k) in d) },
  contains: { args: 'list, value', doc: 'True if the list contains value', fn: ([l, v]) => Array.isArray(l) && l.some((x) => x === v || toStr(x) === toStr(v)) },
  vec: { args: 'x, y, z', doc: 'Make a vector', fn: ([x, y, z]) => [toNum(x), toNum(y), toNum(z ?? 0)] },
  vx: { args: 'v', doc: 'X of a vector', fn: ([v]) => Array.isArray(v) ? toNum(v[0]) : 0 },
  vy: { args: 'v', doc: 'Y of a vector', fn: ([v]) => Array.isArray(v) ? toNum(v[1]) : 0 },
  vz: { args: 'v', doc: 'Z of a vector', fn: ([v]) => Array.isArray(v) ? toNum(v[2]) : 0 },
};

export function evalExpr(e: Expr, ctx: ExprContext): any {
  switch (e.t) {
    case 'num': case 'str': case 'bool': return e.v;
    case 'ident': return ctx.ident(e.name);
    case 'member': return ctx.member(e.path);
    case 'cond': return truthy(evalExpr(e.c, ctx)) ? evalExpr(e.a, ctx) : evalExpr(e.b, ctx);
    case 'unary': {
      const v = evalExpr(e.e, ctx);
      return e.op === '-' ? -toNum(v) : !truthy(v);
    }
    case 'call': {
      const args = e.args.map((a) => evalExpr(a, ctx));
      const b = BUILTIN_FUNCTIONS[e.name];
      if (b) return b.fn(args, ctx);
      if (ctx.call) return ctx.call(e.name, args);
      throw new ExprError(`Unknown function '${e.name}'`);
    }
    case 'bin': {
      if (e.op === 'and') return truthy(evalExpr(e.a, ctx)) && truthy(evalExpr(e.b, ctx));
      if (e.op === 'or') return truthy(evalExpr(e.a, ctx)) || truthy(evalExpr(e.b, ctx));
      const a = evalExpr(e.a, ctx);
      const b = evalExpr(e.b, ctx);
      switch (e.op) {
        case '+': return (typeof a === 'string' || typeof b === 'string') ? toStr(a) + toStr(b) : toNum(a) + toNum(b);
        case '-': return toNum(a) - toNum(b);
        case '*': return toNum(a) * toNum(b);
        case '/': return toNum(b) === 0 ? 0 : toNum(a) / toNum(b);
        case '%': { const d = toNum(b); return d === 0 ? 0 : toNum(a) % d; }
        case '^': return Math.pow(toNum(a), toNum(b));
        case '&': return toStr(a) + toStr(b);
        case '=': return compareEq(a, b);
        case '<>': return !compareEq(a, b);
        case '<': return toNum(a) < toNum(b);
        case '<=': return toNum(a) <= toNum(b);
        case '>': return toNum(a) > toNum(b);
        case '>=': return toNum(a) >= toNum(b);
      }
    }
  }
  throw new ExprError('Invalid expression');
}

function compareEq(a: any, b: any): boolean {
  if (typeof a === 'number' || typeof b === 'number') return toNum(a) === toNum(b);
  return toStr(a) === toStr(b);
}

/** Compare helper used by "Compare" conditions; op codes match Construct's comparison dropdown. */
export const COMPARISONS = ['=', '<>', '<', '<=', '>', '>='] as const;
export function compareValues(a: any, op: string, b: any): boolean {
  switch (op) {
    case '=': return compareEq(a, b);
    case '<>': case '≠': return !compareEq(a, b);
    case '<': return toNum(a) < toNum(b);
    case '<=': case '≤': return toNum(a) <= toNum(b);
    case '>': return toNum(a) > toNum(b);
    case '>=': case '≥': return toNum(a) >= toNum(b);
  }
  return false;
}

/** Collect identifiers and member paths referenced by an expression (for validation and dependency reporting). */
export function exprRefs(e: Expr, out: { idents: Set<string>; members: string[][]; calls: Set<string> } = { idents: new Set(), members: [], calls: new Set() }) {
  switch (e.t) {
    case 'ident': out.idents.add(e.name); break;
    case 'member': out.members.push(e.path); break;
    case 'call': out.calls.add(e.name); e.args.forEach((a) => exprRefs(a, out)); break;
    case 'unary': exprRefs(e.e, out); break;
    case 'bin': exprRefs(e.a, out); exprRefs(e.b, out); break;
    case 'cond': exprRefs(e.c, out); exprRefs(e.a, out); exprRefs(e.b, out); break;
  }
  return out;
}
