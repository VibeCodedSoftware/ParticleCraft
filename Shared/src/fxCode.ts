// FX Code (Post-FX › Custom shader), in the spirit of Godot's shader parameters: the code declares its own settings
//   uniform float uv_scale : hint_range(0.5, 8.0) = 2.0;
//   uniform vec3 glow : source_color = vec3(1.0, 0.8, 0.5);
//   uniform bool flip = false;
//   uniform sampler2D noise_tex;
// and the Post-FX panel shows a slider, colour, checkbox or texture picker for each (values kept per effect). The
// rest is the body of   vec3 fx(vec2 uv, vec3 color)   in GLSL, run on the graphics card only and compiled through
// the renderer's shader pipeline; it cannot reach files, the network or the operating system. Imported code is
// untrusted: anything that would step outside that one function body is refused before compiling, and compile
// errors switch the effect off with the message.

export const FX_CODE_DEFAULT = `// Your settings: each uniform becomes a control in the panel (like Godot's Shader Parameters).
uniform float uv_scale : hint_range(0.5, 8.0, 0.1) = 2.0;
uniform float wobble : hint_range(0.0, 1.0) = 0.3;
uniform vec3 tint : source_color = vec3(1.0, 0.85, 0.6);
uniform float strength : hint_range(0.0, 1.0) = 0.35;

// The effect: color is the picture here, uv its position (0-1); screen(uv) reads the picture anywhere.
float wave = sin(uv.y * 40.0 * uv_scale + TIME * 3.0) * 0.004 * wobble;
vec3 c = screen(uv + vec2(wave, 0.0));
return mix(c, c * tint, strength);`;

export const FX_CODE_HELP = 'Declare settings with uniform lines (float with hint_range(min, max[, step]), vec3 with source_color, bool, sampler2D for a texture), then write the body of vec3 fx(vec2 uv, vec3 color) and return the new colour. Available: screen(uv) (the picture), texture(your_sampler, uv), luma(c), rand(v), TIME, SCREEN_SIZE. GLSL ES: float literals need a dot (1.0); for-loops need fixed counts; while-loops are not allowed.';

export type FxUniformType = 'float' | 'vec3' | 'bool' | 'sampler2D';
export interface FxUniform { name: string; type: FxUniformType; def: number | string | boolean; min?: number; max?: number; step?: number }

const MAX_LENGTH = 8000;
/** Names the code cannot redeclare (the function's own inputs and the helpers). */
const RESERVED = new Set(['uv', 'color', 'TIME', 'SCREEN_SIZE', 'screen', 'sample', 'luma', 'rand', 'fx', 'main', 'tDiffuse', 'uRes', 'uTime', 'vUv', 'bayer4']);
const FORBIDDEN: [RegExp, string][] = [
  [/#\s*(extension|include|version|define|undef|pragma|line)\b/, 'Preprocessor lines (#extension, #define, #include…) are not allowed.'],
  [/\b(uniform|attribute|varying|precision|layout|samplerCube|sampler3D)\b/, 'uniform lines go at the top, one per line (uniform float name = 1.0;); other declarations are not allowed.'],
  [/\bwhile\b|\bdo\s*\{/, 'while / do loops are not allowed (they can freeze the graphics driver): use a for-loop with a fixed count.'],
  [/\bgl_(FragColor|FragData|FragDepth|FragCoord|Position)\b/, 'Return the colour instead of writing gl_FragColor (gl_FragCoord: use uv * SCREEN_SIZE).'],
  [/\b(texture2D|textureLod|texelFetch|textureGrad)\s*\(/, 'Read the picture with screen(uv), your textures with texture(name, uv).'],
];

const num = (s: string) => { const v = Number(s.trim()); return Number.isFinite(v) ? v : NaN; };
/** "vec3(1.0, 0.5, 0.2)", "vec4(…)" or "#ffaa33" → "#rrggbb". */
function colorOf(s: string): string | null {
  const t = s.trim();
  if (/^#[0-9a-f]{6}$/i.test(t)) return t.toLowerCase();
  const m = /^vec[34]\s*\(([^)]*)\)$/.exec(t);
  if (!m) return null;
  const parts = m[1].split(',').map(num);
  const [r, g, b] = parts.length === 1 ? [parts[0], parts[0], parts[0]] : parts;
  if ([r, g, b].some((x) => !Number.isFinite(x))) return null;
  return '#' + [r, g, b].map((x) => Math.round(Math.max(0, Math.min(1, x)) * 255).toString(16).padStart(2, '0')).join('');
}

/** Split the code into its settings (uniform lines) and the function body; problems that stop it compiling. */
export function parseFxCode(code: string): { uniforms: FxUniform[]; body: string; errors: string[] } {
  const errors: string[] = [], uniforms: FxUniform[] = [];
  if (code.length > MAX_LENGTH) errors.push(`The code is too long (${code.length} characters; at most ${MAX_LENGTH}).`);
  const noComments = code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  const body = noComments.replace(/^[ \t]*uniform\b[^\n]*$/gm, (line) => {
    const m = /^\s*uniform\s+(float|int|vec3|vec4|bool|sampler2D)\s+([A-Za-z_]\w*)\s*(?::\s*([^=;]+?))?\s*(?:=\s*([^;]+?))?\s*;\s*$/.exec(line);
    if (!m) { errors.push(`Not understood: "${line.trim()}" (e.g. uniform float speed : hint_range(0.0, 5.0) = 1.0;)`); return ''; }
    const [, t, name, hint = '', value] = m;
    if (RESERVED.has(name) || name.startsWith('gl_') || uniforms.some((u) => u.name === name)) { errors.push(`The name "${name}" is taken: choose another.`); return ''; }
    if (t === 'sampler2D') { uniforms.push({ name, type: 'sampler2D', def: '' }); return ''; }
    if (t === 'bool') { uniforms.push({ name, type: 'bool', def: (value ?? 'false').trim() === 'true' }); return ''; }
    if (t === 'vec3' || t === 'vec4') {
      const c = colorOf(value ?? 'vec3(1.0)');
      if (!c) { errors.push(`${name}: give the colour as vec3(r, g, b) with values 0-1.`); return ''; }
      uniforms.push({ name, type: 'vec3', def: c }); return '';
    }
    const r = /hint_range\s*\(([^)]*)\)/.exec(hint);
    const [min, max, step] = r ? r[1].split(',').map(num) : [NaN, NaN, NaN];
    const def = num(value ?? (Number.isFinite(min) ? String(min) : '0'));
    if (!Number.isFinite(def)) { errors.push(`${name}: its default must be a number.`); return ''; }
    uniforms.push({ name, type: 'float', def, min: Number.isFinite(min) ? min : Math.min(0, def), max: Number.isFinite(max) ? max : Math.max(1, def * 2), step: Number.isFinite(step) ? step : t === 'int' ? 1 : undefined });
    return '';
  });
  if (!/\breturn\b/.test(body)) errors.push('The code must return a colour (return vec3(…);).');
  for (const [re, msg] of FORBIDDEN) if (re.test(body)) errors.push(msg);
  // texture() only on the code's own textures (never the screen buffer by another name).
  const samplers = new Set(uniforms.filter((u) => u.type === 'sampler2D').map((u) => u.name));
  for (const m of body.matchAll(/\btexture\s*\(\s*([A-Za-z_]\w*)/g)) if (!samplers.has(m[1])) errors.push(`texture(${m[1]}, …): declare it first (uniform sampler2D ${m[1]};).`);
  // Braces must balance, so the code cannot close the function early and add its own top-level code.
  let depth = 0;
  for (const ch of body) { if (ch === '{') depth++; else if (ch === '}' && --depth < 0) break; }
  if (depth !== 0) errors.push('Unbalanced { } braces.');
  return { uniforms, body, errors };
}

/** The stored value of a setting (effect params keep them as "u:name"), else its default. */
export const fxValue = (params: Record<string, any>, u: FxUniform) => params['u:' + u.name] ?? u.def;
