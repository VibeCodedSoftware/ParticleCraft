// Generates Shared/block-definitions/blocks.json and Shared/documentation/BLOCK_REFERENCE.md from the
// block library, so documentation can never drift from the code. Run: npm run gen:docs (in Shared/).
import fs from 'node:fs';
import path from 'node:path';
import { BLOCK_LIST, CATEGORIES } from '../src/blocks/definitions';
import { BEHAVIORS } from '../src/runtime/behaviors';
import { BUILTIN_FUNCTIONS } from '../src/expr';
import { EFFECTS, POSTFX_PRESETS } from '../src/postfx';
import { PARTICLE_PRESETS } from '../src/runtime/particles';
import { generateCode } from '../src/codegen/codegen';
import { createLogicDocument, block, event } from '../src/schema';

const root = path.resolve(__dirname, '..');
fs.mkdirSync(path.join(root, 'block-definitions'), { recursive: true });
fs.mkdirSync(path.join(root, 'documentation'), { recursive: true });

fs.writeFileSync(path.join(root, 'block-definitions', 'blocks.json'), JSON.stringify({ schemaVersion: 1, categories: CATEGORIES, blocks: BLOCK_LIST }, null, 1));
fs.writeFileSync(path.join(root, 'block-definitions', 'behaviors.json'), JSON.stringify(Object.values(BEHAVIORS).map((b) => ({ id: b.id, name: b.name, doc: b.doc, props: b.props, expressions: Object.keys(b.expressions) })), null, 1));

// Which languages export each block (probe the generator with a one-block program).
const langs = ['javascript', 'python', 'lua', 'csharp', 'cpp'] as const;
function exportable(id: string): string[] {
  const def = BLOCK_LIST.find((b) => b.id === id)!;
  const d = createLogicDocument('probe', 'logiccraft');
  d.globals = [{ name: 'score', type: 'number', value: 0 }, { name: 'isPaused', type: 'boolean', value: false }, { name: 'inventory', type: 'array', value: [] }, { name: 'stats', type: 'dict', value: {} }, { name: 'i', type: 'number', value: 0 }];
  const params = Object.fromEntries(def.params.map((p) => [p.name, p.default]));
  const b = block(id, params, def.target === 'object' ? 'Player' : undefined);
  if (def.kind === 'action') d.sheets[0].events = [event([block('system.on_start_of_layout')], [b])];
  else if (def.trigger) d.sheets[0].events = [event([b], [])];
  else d.sheets[0].events = [event([block('system.on_start_of_layout'), b], [])];
  if (id === 'function.call') d.sheets[0].events.push(event([block('function.on_function', { name: 'myFunction' })], []));
  const scene: any = { plane: 'xy', settings: { seed: 1 }, objectTypes: [], instances: [{ uid: 1, type: 'Player', x: 0, y: 0, z: 0, rz: 0, ry: 0, vars: { health: 1, active: true } }, { uid: 2, type: 'Enemy', x: 0, y: 0, z: 0, rz: 0, ry: 0, vars: {} }] };
  return langs.filter((l) => !generateCode(d, scene, l).unsupported.some((u) => u.blockId === b.id));
}

const lines: string[] = [];
lines.push('# Block compatibility reference', '', '_Generated from `Shared/src/blocks/definitions.ts` by `npm run gen:docs` — do not edit by hand._', '');
lines.push(`${BLOCK_LIST.length} blocks in ${CATEGORIES.length} categories. Every block has exactly one runtime implementation (\`Shared/src/runtime/blockImpl.ts\`) used by both apps.`, '');
lines.push('Legend: **GC** = GameCraft, **LC** = LogicCraft. ⚡ trigger, ↻ looping condition. "C2" is the matching Construct 2 condition/action. "Export" lists source-code exporters that translate the block (others mark it UNSUPPORTED).', '');
for (const c of CATEGORIES) {
  const list = BLOCK_LIST.filter((b) => b.category === c.id);
  if (!list.length) continue;
  lines.push(`## ${c.icon} ${c.name}`, '', c.doc, '', '| ID | Kind | Name | Parameters (default) | Apps | Construct 2 | Export |', '|---|---|---|---|---|---|---|');
  for (const b of list) {
    const kind = b.kind === 'action' ? 'action' : b.trigger ? '⚡ trigger' : b.looping ? '↻ loop' : 'condition';
    const params = [...(b.target === 'object' ? ['**object**'] : []), ...b.params.map((p) => `${p.name}: ${p.type} (\`${String(p.default).replace(/\|/g, '\\|')}\`)`)].join('<br>') || '—';
    const ex = exportable(b.id);
    lines.push(`| \`${b.id}\` | ${kind} | ${b.name} | ${params} | ${b.apps.map((a) => (a === 'gamecraft' ? 'GC' : 'LC')).join(' ')} | ${b.c2 ?? ''} | ${ex.length === 5 ? 'all' : ex.map((l) => ({ javascript: 'JS', python: 'Py', lua: 'Lua', csharp: 'C#', cpp: 'C++' }[l])).join(' ') || '—'} |`);
  }
  lines.push('');
}
lines.push('## Behaviors', '', '| Behavior | Properties | Expressions |', '|---|---|---|');
for (const b of Object.values(BEHAVIORS)) lines.push(`| ${b.icon} **${b.name}** (\`${b.id}\`) — ${b.doc} | ${b.props.map((p) => `${p.label} (${p.default})`).join(', ')} | ${Object.keys(b.expressions).map((e) => `Obj.${b.name.replace(/\s/g, '')}.${e}`).join(', ') || '—'} |`);
lines.push('', '## Expression functions', '', '| Function | Arguments | Description |', '|---|---|---|');
for (const [k, f] of Object.entries(BUILTIN_FUNCTIONS)) lines.push(`| \`${k}\` | ${f.args} | ${f.doc} |`);
lines.push('| `loopindex` | [name] | Current loop iteration (optionally of a named For loop) |', '| `param` | i | Function parameter i |', '| `call` | "name", args… | Call a function and use its return value |', '| `item` | | Current item in "For each item" |');
lines.push('', 'Special names: `dt`, `time`, `tickcount`, `timescale`, `pi`, `Self.<prop>`, `<Object>.<prop>`, `<Object>.Count`, `<Object>.<Behavior>.<expr>`, `Mouse.X/Y/Z`, `Camera.X/Y/Z/Zoom`.', '');
lines.push('## Post-processing effects', '', '| Effect | Fidelity | Notes |', '|---|---|---|');
for (const e of Object.values(EFFECTS)) lines.push(`| ${e.name} (\`${e.type}\`) | ${e.fidelity} | ${e.note} |`);
lines.push('', 'Presets: ' + Object.entries(POSTFX_PRESETS).map(([k, p]) => `${p.name} (\`${k}\`)`).join(', ') + '.', '');
lines.push('## Particle presets', '', Object.entries(PARTICLE_PRESETS).map(([k, p]) => `${p.name} (\`${k}\`)`).join(', ') + '.', '');
fs.writeFileSync(path.join(root, 'documentation', 'BLOCK_REFERENCE.md'), lines.join('\n'));
console.log(`Wrote ${BLOCK_LIST.length} blocks to block-definitions/blocks.json and documentation/BLOCK_REFERENCE.md`);
