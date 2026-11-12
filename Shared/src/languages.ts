// Languages for custom code blocks: highlighting rules, validation, and an honest statement of what each
// language can actually do in these engines.
//   run: 'sandbox'  JavaScript runs inside the game, in a restricted scope with the `game` API only.
//   run: 'ui'       HTML is shown as an interface panel (sanitized: no scripts, no inline handlers).
//   run: 'style'    CSS styles HTML panels (scoped to the panels).
//   run: false      not executed by the engines; edited, checked and (when `export` is set) included verbatim
//                   when the logic is exported to that language.

export type CodeLanguage = 'javascript' | 'typescript' | 'python' | 'lua' | 'csharp' | 'cpp' | 'java' | 'html' | 'css' | 'json';

export interface Diagnostic { line: number; message: string; level: 'error' | 'warning' }

export interface LanguageDef {
  id: CodeLanguage; name: string; short: string; color: string;
  lineComment?: string; blockComment?: [string, string];
  keywords: string[]; builtins: string[];
  run: 'sandbox' | 'ui' | 'style' | false;
  /** Code export target that embeds this language's blocks. */
  export?: 'javascript' | 'python' | 'lua' | 'csharp' | 'cpp';
  status: string;
  indent: number;
  template: string;
}

const kw = (s: string) => s.split(/\s+/).filter(Boolean);
const C_KW = 'if else for while do switch case default break continue return new delete class struct public private protected static const void true false null this try catch throw';

export const LANGUAGES: Record<CodeLanguage, LanguageDef> = {
  javascript: {
    id: 'javascript', name: 'JavaScript', short: 'JS', color: '#e8c33a', lineComment: '//', blockComment: ['/*', '*/'],
    keywords: kw('const let var function return if else for while do switch case default break continue new typeof instanceof of in true false null undefined try catch finally throw class'),
    builtins: kw('game self Math JSON String Number Boolean Array Object parseInt parseFloat isNaN'),
    run: 'sandbox', export: 'javascript', indent: 2,
    status: 'Runs in the game (sandboxed: only the game API, no network, files or page access). Also included in JavaScript exports.',
    template: '// game.get(name) / game.set(name, value) read and change global variables.\n// game.objects("Player") lists objects; each has x, y, z, angle, vars, destroy().\nconst score = game.get("score");\ngame.set("score", score + 1);\n',
  },
  typescript: {
    id: 'typescript', name: 'TypeScript', short: 'TS', color: '#3b82d6', lineComment: '//', blockComment: ['/*', '*/'],
    keywords: kw('const let var function return if else for while do switch case default break continue new typeof instanceof of in true false null undefined try catch finally throw class interface type enum implements extends as readonly'),
    builtins: kw('number string boolean any unknown void never Math JSON Array Object Promise'),
    run: false, indent: 2,
    status: 'Edited and checked only. TypeScript needs a compiler, which the engines do not include, so it does not run in the game.',
    template: 'interface Stats { hp: number; speed: number }\nconst stats: Stats = { hp: 3, speed: 5 };\n',
  },
  python: {
    id: 'python', name: 'Python', short: 'PY', color: '#3776ab', lineComment: '#',
    keywords: kw('def return if elif else for while in not and or is None True False class import from as pass break continue try except finally raise with lambda global nonlocal yield'),
    builtins: kw('print len range int float str list dict set abs min max round sum enumerate zip'),
    run: false, export: 'python', indent: 4,
    status: 'Not run inside the game (no Python interpreter is embedded). Checked here and included verbatim when you export the logic to Python.',
    template: '# Included as-is in the Python export.\nscore = score + 1\nif score > 10:\n    print("You win!")\n',
  },
  lua: {
    id: 'lua', name: 'Lua', short: 'LUA', color: '#2c2d72', lineComment: '--',
    keywords: kw('and break do else elseif end false for function goto if in local nil not or repeat return then true until while'),
    builtins: kw('print pairs ipairs tostring tonumber math string table type'),
    run: false, export: 'lua', indent: 2,
    status: 'Not run inside the game. Checked here and included verbatim in Lua exports.',
    template: '-- Included as-is in the Lua export.\nscore = score + 1\nif score > 10 then\n  print("You win!")\nend\n',
  },
  csharp: {
    id: 'csharp', name: 'C#', short: 'C#', color: '#68217a', lineComment: '//', blockComment: ['/*', '*/'],
    keywords: kw(C_KW + ' using namespace var foreach in out ref readonly override virtual abstract interface bool int float double string'),
    builtins: kw('Console Math List Dictionary String'),
    run: false, export: 'csharp', indent: 4,
    status: 'Not run inside the game (needs the .NET compiler). Checked here and included verbatim in C# exports.',
    template: '// Included as-is in the C# export.\nscore = score + 1;\nif (score > 10) Console.WriteLine("You win!");\n',
  },
  cpp: {
    id: 'cpp', name: 'C++', short: 'C++', color: '#00599c', lineComment: '//', blockComment: ['/*', '*/'],
    keywords: kw(C_KW + ' auto namespace using template typename include define int float double bool char std unsigned long'),
    builtins: kw('std cout endl vector string printf'),
    run: false, export: 'cpp', indent: 4,
    status: 'Not run inside the game (needs a C++ compiler). Checked here and included verbatim in C++ exports.',
    template: '// Included as-is in the C++ export.\nscore = score + 1;\nif (score > 10) std::printf("You win!\\n");\n',
  },
  java: {
    id: 'java', name: 'Java', short: 'JAVA', color: '#e76f00', lineComment: '//', blockComment: ['/*', '*/'],
    keywords: kw(C_KW + ' package import extends implements interface final abstract synchronized boolean int float double char String'),
    builtins: kw('System Math String List ArrayList HashMap'),
    run: false, indent: 4,
    status: 'Edited and checked only. Java needs a JVM, which the engines do not include, and there is no Java export.',
    template: 'int score = 0;\nscore += 1;\nSystem.out.println("Score: " + score);\n',
  },
  html: {
    id: 'html', name: 'HTML', short: 'HTML', color: '#e34c26', blockComment: ['<!--', '-->'],
    keywords: [], builtins: [],
    run: 'ui', indent: 2,
    status: 'Shown as an interface panel over the game. {{variable}} shows a global variable; <button data-button="name"> fires "On UI button clicked". Scripts and inline event handlers are removed.',
    template: '<div class="card">\n  <h2>Shop</h2>\n  <p>Gold: {{gold}}</p>\n  <button data-button="buy">Buy sword</button>\n</div>\n',
  },
  css: {
    id: 'css', name: 'CSS', short: 'CSS', color: '#264de4', blockComment: ['/*', '*/'],
    keywords: [], builtins: [],
    run: 'style', indent: 2,
    status: 'Styles the HTML panel with the same name (scoped: it cannot affect the editor or other panels).',
    template: '.card {\n  background: rgba(20, 24, 32, 0.9);\n  color: #fff;\n  padding: 16px;\n  border-radius: 10px;\n}\nbutton { padding: 6px 14px; }\n',
  },
  json: {
    id: 'json', name: 'JSON', short: 'JSON', color: '#8a8a8a', keywords: kw('true false null'), builtins: [],
    run: false, indent: 2,
    status: 'Data only. Validated; use it to keep structured data next to your logic.',
    template: '{\n  "levels": [1, 2, 3]\n}\n',
  },
};

export const LANGUAGE_IDS = Object.keys(LANGUAGES) as CodeLanguage[];

export function capabilityLabel(l: LanguageDef): string {
  if (l.run === 'sandbox') return 'Runs in game';
  if (l.run === 'ui') return 'Shows UI';
  if (l.run === 'style') return 'Styles UI';
  if (l.export) return 'Exported';
  return 'Edit + check';
}

// ------------------------------------------------------------------ validation

/** Unbalanced brackets and unterminated strings, skipping comments and strings. */
function bracketCheck(code: string, l: LanguageDef, out: Diagnostic[]) {
  const stack: { c: string; line: number }[] = [];
  const pairs: Record<string, string> = { ')': '(', ']': '[', '}': '{' };
  let line = 1;
  for (let i = 0; i < code.length; i++) {
    const c = code[i];
    if (c === '\n') { line++; continue; }
    if (l.lineComment && code.startsWith(l.lineComment, i)) { while (i < code.length && code[i] !== '\n') i++; i--; continue; }
    if (l.blockComment && code.startsWith(l.blockComment[0], i)) {
      const end = code.indexOf(l.blockComment[1], i + l.blockComment[0].length);
      const stop = end < 0 ? code.length : end + l.blockComment[1].length;
      for (let k = i; k < stop; k++) if (code[k] === '\n') line++;
      if (end < 0) out.push({ line, message: 'Unclosed comment', level: 'error' });
      i = stop - 1; continue;
    }
    if (c === '"' || c === "'" || (c === '`' && l.id !== 'python')) {
      const start = line;
      let j = i + 1;
      while (j < code.length && code[j] !== c) { if (code[j] === '\\') j++; else if (code[j] === '\n') { if (c !== '`') break; line++; } j++; }
      if (j >= code.length || code[j] !== c) { out.push({ line: start, message: 'Unterminated string', level: 'error' }); }
      i = j; continue;
    }
    if ('([{'.includes(c)) stack.push({ c, line });
    else if (')]}'.includes(c)) {
      const top = stack.pop();
      if (!top) out.push({ line, message: `Unexpected "${c}"`, level: 'error' });
      else if (top.c !== pairs[c]) out.push({ line, message: `"${c}" closes "${top.c}" opened on line ${top.line}`, level: 'error' });
    }
  }
  for (const s of stack) out.push({ line: s.line, message: `"${s.c}" is never closed`, level: 'error' });
}

/** Words the JavaScript sandbox refuses: they could reach outside the game. */
export const JS_FORBIDDEN = ['window', 'document', 'globalThis', 'self.constructor', 'constructor', '__proto__', 'prototype', 'Function', 'eval', 'import', 'require', 'fetch', 'XMLHttpRequest', 'WebSocket', 'localStorage', 'sessionStorage', 'indexedDB', 'navigator', 'postMessage', 'Worker', 'setTimeout', 'setInterval', 'Reflect', 'Proxy'];

export function validateCode(language: CodeLanguage, code: string): Diagnostic[] {
  const l = LANGUAGES[language];
  const out: Diagnostic[] = [];
  if (!l) return [{ line: 1, message: `Unknown language "${language}"`, level: 'error' }];
  if (language === 'json') {
    try { JSON.parse(code || 'null'); } catch (e: any) { const m = /position (\d+)/.exec(e.message); out.push({ line: m ? code.slice(0, Number(m[1])).split('\n').length : 1, message: e.message, level: 'error' }); }
    return out;
  }
  if (language === 'html') return validateHtml(code);
  if (language !== 'python') bracketCheck(code, l, out);
  const lines = code.split('\n');
  if (language === 'javascript') {
    lines.forEach((ln, i) => {
      const bare = ln.replace(/(["'`])(?:\\.|(?!\1).)*\1/g, '""').replace(/\/\/.*$/, '');
      // Property escapes (x.constructor, x.__proto__) are refused after a dot too.
      const PROPS = ['constructor', '__proto__', 'prototype'];
      for (const w of JS_FORBIDDEN) if (new RegExp(`(^|[^\\w$${PROPS.includes(w) ? '' : '.'}])${w.replace('.', '\\.')}([^\\w$]|$)`).test(bare)) out.push({ line: i + 1, message: `"${w}" is not available in game scripts (sandbox)`, level: 'error' });
    });
    if (!out.some((d) => d.level === 'error')) {
      try { new Function('game', 'self', code); } catch (e: any) { out.push({ line: 1, message: 'Syntax error: ' + e.message, level: 'error' }); }
    }
  }
  if (language === 'python') {
    bracketCheck(code, { ...l, blockComment: undefined }, out);
    let usesTabs = false, usesSpaces = false;
    lines.forEach((ln, i) => {
      const ind = /^[ \t]*/.exec(ln)![0];
      if (ind.includes('\t')) usesTabs = true; if (ind.includes(' ')) usesSpaces = true;
      const t = ln.replace(/#.*$/, '').trim();
      if (/^(if|elif|else|for|while|def|class|try|except|finally|with)\b/.test(t) && !t.endsWith(':')) out.push({ line: i + 1, message: `"${t.split(/[\s(:]/)[0]}" line must end with ":"`, level: 'error' });
      const prev = lines.slice(0, i).reverse().find((x) => x.trim() && !x.trim().startsWith('#'));
      if (prev && prev.replace(/#.*$/, '').trim().endsWith(':') && t && ind.length <= /^[ \t]*/.exec(prev)![0].length) out.push({ line: i + 1, message: 'Expected an indented block', level: 'error' });
    });
    if (usesTabs && usesSpaces) out.push({ line: 1, message: 'Mixes tabs and spaces for indentation', level: 'warning' });
  }
  if (language === 'lua') {
    let depth = 0;
    lines.forEach((ln) => {
      const t = ln.replace(/--.*$/, '').replace(/(["'])(?:\\.|(?!\1).)*\1/g, '""');
      depth += (t.match(/\b(function|then|do)\b/g) ?? []).length;
      depth += (t.match(/\brepeat\b/g) ?? []).length;
      depth -= (t.match(/\b(end|until)\b/g) ?? []).length;
      depth -= (t.match(/\belseif\b/g) ?? []).length;
    });
    if (depth > 0) out.push({ line: lines.length, message: `${depth} block(s) missing "end"`, level: 'error' });
    if (depth < 0) out.push({ line: lines.length, message: 'Too many "end"s', level: 'error' });
  }
  if (language === 'css') {
    lines.forEach((ln, i) => {
      const t = ln.replace(/\/\*.*?\*\//g, '').trim();
      if (t && !t.endsWith('{') && !t.endsWith('}') && !t.endsWith(';') && !t.endsWith(',') && /:/.test(t) && !/\{/.test(t)) out.push({ line: i + 1, message: 'Declaration should end with ";"', level: 'warning' });
    });
  }
  if (['csharp', 'cpp', 'java'].includes(language)) {
    lines.forEach((ln, i) => {
      const t = ln.replace(/\/\/.*$/, '').trim();
      if (/^(return|break|continue)\b/.test(t) && !t.endsWith(';')) out.push({ line: i + 1, message: 'Statement should end with ";"', level: 'warning' });
    });
  }
  return out;
}

const VOID = new Set(['br', 'hr', 'img', 'input', 'meta', 'link', 'area', 'base', 'col', 'embed', 'source', 'track', 'wbr']);
export const HTML_BLOCKED = ['script', 'iframe', 'object', 'embed', 'link', 'meta', 'base', 'form', 'frame', 'frameset'];

function validateHtml(code: string): Diagnostic[] {
  const out: Diagnostic[] = [];
  const stack: { tag: string; line: number }[] = [];
  const re = /<!--[^]*?-->|<\/?([A-Za-z][\w-]*)([^>]*?)(\/?)>/g;
  let m: RegExpExecArray | null;
  const lineAt = (i: number) => code.slice(0, i).split('\n').length;
  while ((m = re.exec(code))) {
    if (m[0].startsWith('<!--')) continue;
    const tag = m[1].toLowerCase(), line = lineAt(m.index);
    if (HTML_BLOCKED.includes(tag)) out.push({ line, message: `<${tag}> is removed when the panel is shown`, level: 'warning' });
    if (/\son\w+\s*=/.test(m[2])) out.push({ line, message: 'Inline event handlers (onclick=…) are removed; use data-button="name"', level: 'warning' });
    if (m[0].startsWith('</')) {
      const top = stack.pop();
      if (!top) out.push({ line, message: `</${tag}> has no opening tag`, level: 'error' });
      else if (top.tag !== tag) { out.push({ line, message: `</${tag}> closes <${top.tag}> from line ${top.line}`, level: 'error' }); }
    } else if (!VOID.has(tag) && !m[3]) stack.push({ tag, line });
  }
  for (const s of stack) out.push({ line: s.line, message: `<${s.tag}> is never closed`, level: 'error' });
  return out;
}

// ------------------------------------------------------------------ highlighting

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** HTML with <span class="tk-…"> tokens for one source string. */
export function highlight(language: CodeLanguage | 'craft', code: string): string {
  if (language === 'html') {
    return esc(code)
      .replace(/(&lt;!--[^]*?--&gt;)/g, '<span class="tk-c">$1</span>')
      .replace(/(&lt;\/?)([\w-]+)([^]*?)(\/?&gt;)/g, (_m, a, t, attrs, b) => `${a}<span class="tk-k">${t}</span>${attrs.replace(/([\w-:]+)(=)(&quot;|")?("[^"]*")/g, '<span class="tk-a">$1</span>$2<span class="tk-s">$4</span>')}${b}`)
      .replace(/(\{\{[^}]*\}\})/g, '<span class="tk-n">$1</span>');
  }
  if (language === 'css') {
    return esc(code)
      .replace(/(\/\*[^]*?\*\/)/g, '<span class="tk-c">$1</span>')
      .replace(/^([^{}\n]+)(\{)/gm, '<span class="tk-k">$1</span>$2')
      .replace(/([\w-]+)(\s*:)(?![^{]*\{)/g, '<span class="tk-a">$1</span>$2')
      .replace(/(#[0-9a-fA-F]{3,8}\b|\b\d+(\.\d+)?(px|em|rem|%|s|ms|vh|vw)?\b)/g, '<span class="tk-n">$1</span>');
  }
  const l = language === 'craft' ? CRAFT : LANGUAGES[language];
  const kws = new Set(l.keywords), bis = new Set(l.builtins);
  let out = '', i = 0;
  const lc = l.lineComment, bc = l.blockComment;
  while (i < code.length) {
    const rest = code.slice(i);
    if (lc && rest.startsWith(lc)) { const e = code.indexOf('\n', i); const s = e < 0 ? code.slice(i) : code.slice(i, e); out += `<span class="tk-c">${esc(s)}</span>`; i += s.length; continue; }
    if (bc && rest.startsWith(bc[0])) { const e = code.indexOf(bc[1], i + bc[0].length); const s = e < 0 ? code.slice(i) : code.slice(i, e + bc[1].length); out += `<span class="tk-c">${esc(s)}</span>`; i += s.length; continue; }
    const q = code[i];
    if (q === '"' || q === '`' || (q === "'" && language !== 'craft')) {
      let j = i + 1;
      while (j < code.length && code[j] !== q && !(code[j] === '\n' && q !== '`')) j += code[j] === '\\' ? 2 : 1;
      const s = code.slice(i, j + 1); out += `<span class="tk-s">${esc(s)}</span>`; i += s.length; continue;
    }
    const num = /^\d+(\.\d+)?/.exec(rest);
    if (num && !/[\w$]/.test(code[i - 1] ?? '')) { out += `<span class="tk-n">${num[0]}</span>`; i += num[0].length; continue; }
    const w = /^[A-Za-z_$][\w$]*/.exec(rest);
    if (w) {
      const word = w[0];
      const cls = kws.has(word) ? 'tk-k' : bis.has(word) ? 'tk-b' : code[i + word.length] === '(' ? 'tk-f' : '';
      out += cls ? `<span class="${cls}">${word}</span>` : word;
      i += word.length; continue;
    }
    out += esc(q); i++;
  }
  return out;
}

const CRAFT = { lineComment: '//', blockComment: undefined as [string, string] | undefined, keywords: kw('event group comment when if do not off else or loose break var local const static inactive'), builtins: kw('number string boolean array dict vector object true false') };
