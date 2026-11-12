// Dialogue, scene changes and custom code blocks: the runtime parts shared by both games.
import type { BlockInstance, DialogueChoice, DialogueDef, DialogueNode } from '../schema';
import { LANGUAGES, validateCode, type CodeLanguage } from '../languages';
import { toStr, truthy } from '../expr';
import type { Ctx, Runtime } from './runtime';
import type { RInstance } from './world';

// ------------------------------------------------------------------ dialogue

export interface DialogueState {
  dialogue: string; nodeId: string;
  speaker: string; text: string;
  /** Visible choices (conditions already checked); `index` is the 1-based number shown to the player. */
  choices: { index: number; id: string; text: string }[];
  /** True when the line has no choices: the player advances with click / Space / Enter. */
  canContinue: boolean;
}

export function findDialogue(rt: Runtime, name: string): DialogueDef | undefined {
  const l = name.trim().toLowerCase();
  return rt.doc.dialogues?.find((d) => d.name.toLowerCase() === l || d.id === name);
}

/** Run "a = b; c += 1" style assignments against the runtime's variables. */
export function runAssignments(rt: Runtime, src: string | undefined, ctx: Ctx) {
  if (!src?.trim()) return;
  for (const part of src.split(/;|\n/)) {
    const m = /^\s*([A-Za-z_]\w*)\s*(\+=|-=|\*=|\/=|=)\s*(.+?)\s*$/.exec(part);
    if (!part.trim()) continue;
    if (!m) { rt.report('error', `Dialogue: cannot read "${part.trim()}" (write: name = value)`); continue; }
    const [, name, op, expr] = m;
    try {
      if (!rt.findVar(name, ctx)) rt.globals[name] = 0; // dialogue flags may be new variables
      const v = rt.evaluate(expr, ctx);
      const cur = rt.evaluate(name, ctx);
      const n = op === '=' ? v : op === '+=' ? (typeof cur === 'string' ? cur + toStr(v) : Number(cur) + Number(v)) : op === '-=' ? Number(cur) - Number(v) : op === '*=' ? Number(cur) * Number(v) : Number(cur) / Number(v);
      rt.setVar(name, n, ctx);
    } catch (e: any) { rt.report('error', `Dialogue: ${e.message}`); }
  }
}

const passes = (rt: Runtime, c: DialogueChoice, ctx: Ctx) => {
  if (!c.condition?.trim()) return true;
  try { return truthy(rt.evaluate(c.condition, ctx)); } catch (e: any) { rt.report('error', `Dialogue choice "${c.text}": ${e.message}`); return false; }
};

/** Interpolate {variable} / {expression} inside dialogue text. */
function fill(rt: Runtime, s: string, ctx: Ctx) {
  return s.replace(/\{([^{}]+)\}/g, (_m, e) => { try { return toStr(rt.evaluate(e, ctx)); } catch { return `{${e}}`; } });
}

export function startDialogue(rt: Runtime, name: string, nodeName?: string) {
  const d = findDialogue(rt, name);
  if (!d) { rt.report('error', `Dialogue "${name}" does not exist`); return; }
  const start = nodeName ? d.nodes.find((n) => n.id === nodeName || n.speaker + ': ' + n.text === nodeName) : d.nodes.find((n) => n.id === d.start) ?? d.nodes[0];
  if (!start) { rt.report('error', `Dialogue "${d.name}" has no lines`); return; }
  rt.fireTrigger('dialogue.on_start', null, (c) => !String(c.params.dialogue ?? '').trim() || String(c.params.dialogue).toLowerCase() === d.name.toLowerCase());
  enterNode(rt, d, start);
}

function enterNode(rt: Runtime, d: DialogueDef, n: DialogueNode, depth = 0) {
  const ctx = rt.baseCtx();
  runAssignments(rt, n.set, ctx);
  if (n.sound) rt.opts.host?.playSound?.(n.sound, 80, {});
  if (n.event) fireDialogueEvent(rt, d, n.event);
  // A line that goes to another scene fades out (instead of cutting).
  if (n.scene) { endDialogue(rt, n.ending || 'scene'); rt.changeScene(n.scene, { transition: 'fade', duration: 0.5 }); return; }
  const visible = n.choices.filter((c) => passes(rt, c, ctx));
  const isEnd = n.end || (!n.next && !visible.length && !n.text.trim());
  if (isEnd && !n.text.trim()) { endDialogue(rt, n.ending ?? ''); return; }
  // A line with no text that only jumps ("hub" / router node) continues straight away.
  if (!n.text.trim() && n.next && depth < 50) { const nx = d.nodes.find((x) => x.id === n.next); if (nx) { enterNode(rt, d, nx, depth + 1); return; } }
  // A line with no text but conditional choices is a branch: take the first choice whose condition holds.
  if (!n.text.trim() && visible.length && depth < 50) {
    const c = visible[0]; runAssignments(rt, c.set, ctx);
    const nx = c.to ? d.nodes.find((x) => x.id === c.to) : undefined;
    if (nx) { enterNode(rt, d, nx, depth + 1); return; }
  }
  rt.dialogue = { dialogue: d.name, nodeId: n.id, speaker: fill(rt, n.speaker, ctx), text: fill(rt, n.text, ctx), choices: visible.map((c, i) => ({ index: i + 1, id: c.id, text: fill(rt, c.text, ctx) })), canContinue: !visible.length };
  rt.storyLog.push({ kind: 'line', speaker: rt.dialogue.speaker, text: rt.dialogue.text });
  if (rt.storyLog.length > 300) rt.storyLog.splice(0, rt.storyLog.length - 300);
  rt.fireTrigger('dialogue.on_line', null, (c) => matchesDialogue(c, d) && (!String(c.params.speaker ?? '').trim() || String(c.params.speaker).toLowerCase() === n.speaker.toLowerCase()) && (!String(c.params.line ?? '').trim() || String(c.params.line).trim() === n.id), { line: n.id });
}

const matchesDialogue = (c: BlockInstance, d: DialogueDef) => !String(c.params.dialogue ?? '').trim() || String(c.params.dialogue).toLowerCase() === d.name.toLowerCase();

function fireDialogueEvent(rt: Runtime, d: DialogueDef, name: string) {
  rt.fireTrigger('dialogue.on_event', null, (c) => String(c.params.name).toLowerCase() === name.toLowerCase(), { dialogue: d.name, name });
}

/** Continue a line without choices (click / Space / Enter / the Continue block). */
export function continueDialogue(rt: Runtime) {
  const st = rt.dialogue; if (!st || !st.canContinue) return;
  const d = findDialogue(rt, st.dialogue); const n = d?.nodes.find((x) => x.id === st.nodeId);
  if (!d || !n) { rt.dialogue = null; return; }
  const next = n.next ? d.nodes.find((x) => x.id === n.next) : undefined;
  if (!next || n.end) endDialogue(rt, n.ending ?? '');
  else enterNode(rt, d, next);
}

/** Pick a visible choice by its 1-based number. */
export function chooseDialogue(rt: Runtime, index: number) {
  const st = rt.dialogue; if (!st) return;
  const pick = st.choices.find((c) => c.index === index);
  if (!pick) return;
  const d = findDialogue(rt, st.dialogue); const n = d?.nodes.find((x) => x.id === st.nodeId);
  const ch = n?.choices.find((c) => c.id === pick.id);
  if (!d || !n || !ch) return;
  const ctx = rt.baseCtx();
  rt.storyLog.push({ kind: 'choice', speaker: '', text: pick.text });
  runAssignments(rt, ch.set, ctx);
  rt.fireTrigger('dialogue.on_choice', null, (c) => matchesDialogue(c, d) && (!String(c.params.choice ?? '').trim() || String(c.params.choice).toLowerCase() === ch.text.toLowerCase() || String(c.params.choice) === String(index)));
  if (ch.event) fireDialogueEvent(rt, d, ch.event);
  const to = ch.to ? d.nodes.find((x) => x.id === ch.to) : undefined;
  if (!to) endDialogue(rt, '');
  else enterNode(rt, d, to);
}

export function jumpDialogue(rt: Runtime, nodeRef: string) {
  const st = rt.dialogue; if (!st) return;
  const d = findDialogue(rt, st.dialogue);
  const n = d?.nodes.find((x) => x.id === nodeRef || x.text.slice(0, 40).toLowerCase() === nodeRef.toLowerCase());
  if (!d || !n) { rt.report('error', `Dialogue line "${nodeRef}" not found`); return; }
  enterNode(rt, d, n);
}

export function endDialogue(rt: Runtime, ending: string) {
  const st = rt.dialogue;
  rt.dialogue = null;
  const name = st?.dialogue ?? '';
  rt.fireTrigger('dialogue.on_end', null, (c) => (!String(c.params.dialogue ?? '').trim() || String(c.params.dialogue).toLowerCase() === name.toLowerCase()) && (!String(c.params.ending ?? '').trim() || String(c.params.ending).toLowerCase() === ending.toLowerCase()), { ending });
}

/** Walk a conversation for problems: missing targets, unreachable lines, dead ends. */
export function checkDialogue(d: DialogueDef): string[] {
  const out: string[] = [];
  const ids = new Set(d.nodes.map((n) => n.id));
  if (!ids.has(d.start)) out.push('The start line is missing');
  for (const n of d.nodes) {
    if (n.next && !ids.has(n.next)) out.push(`"${n.text.slice(0, 30)}" continues to a deleted line`);
    for (const c of n.choices) if (c.to && !ids.has(c.to)) out.push(`Choice "${c.text}" leads to a deleted line`);
  }
  const seen = new Set<string>(); const stack = [d.start];
  while (stack.length) { const id = stack.pop()!; if (seen.has(id)) continue; seen.add(id); const n = d.nodes.find((x) => x.id === id); if (!n) continue; if (n.next) stack.push(n.next); for (const c of n.choices) if (c.to) stack.push(c.to); }
  for (const n of d.nodes) if (!seen.has(n.id)) out.push(`"${n.text.slice(0, 30) || '(empty line)'}" can never be reached`);
  return out;
}

// ------------------------------------------------------------------ scenes

export interface SceneCarry {
  /** Global variables brought into the next scene. */
  globals: Record<string, any>;
  data: any;
  from: string;
  transition?: { kind: string; duration: number; color?: string; shape?: string | null; cover?: string | null };
  /** Load game of a save made in this (next) scene: applied once the scene has started (see saveGame.ts). */
  load?: import('./saveGame').SavedGame;
}

/**
 * Screen transitions (scene changes and Cover / Uncover screen). "fade-white" is the older white fade; "shape" closes
 * on your own picture's shape, "map" covers in the order of your own greyscale picture (dark first).
 */
export const TRANSITION_KINDS = ['none', 'fade', 'fade-white', 'wipe', 'curtain', 'blinds', 'iris', 'diamond', 'star', 'heart', 'dissolve', 'shape', 'map'] as const;
export type TransitionStyle = 'fade' | 'wipe' | 'curtain' | 'blinds' | 'iris' | 'diamond' | 'star' | 'heart' | 'dissolve' | 'shape' | 'map';
/** How a transition kind is drawn, and in which colour (an explicit colour wins; fade-white is white). */
export function transitionLook(kind: string, color?: string): { style: TransitionStyle; color: string } {
  const style: TransitionStyle = (TRANSITION_KINDS as readonly string[]).includes(kind) && kind !== 'none' && kind !== 'fade-white' ? kind as TransitionStyle : 'fade';
  const c = String(color ?? '').trim();
  return { style, color: /^#[0-9a-f]{3,8}$/i.test(c) ? c : kind === 'fade-white' ? '#ffffff' : '#000000' };
}

/** Which globals survive: "all", "none" or a comma-separated list of names. */
export function keptGlobals(rt: Runtime, keep: string): Record<string, any> {
  const k = keep.trim().toLowerCase();
  if (!k || k === 'none') return {};
  if (k === 'all') return JSON.parse(JSON.stringify(rt.globals));
  const names = k.split(',').map((s) => s.trim()).filter(Boolean);
  const out: Record<string, any> = {};
  for (const [n, v] of Object.entries(rt.globals)) if (names.includes(n.toLowerCase())) out[n] = JSON.parse(JSON.stringify(v));
  return out;
}

// ------------------------------------------------------------------ code blocks

/** Names hidden from game scripts (they would reach the editor page). */
const SHADOWED = ['window', 'document', 'globalThis', 'top', 'parent', 'opener', 'location', 'frames', 'fetch', 'XMLHttpRequest', 'WebSocket', 'localStorage', 'sessionStorage', 'indexedDB', 'navigator', 'Function', 'setTimeout', 'setInterval', 'Worker', 'postMessage', 'Reflect', 'Proxy', 'importScripts'];
const compiled = new Map<string, Function | string>();

function compileJs(code: string): Function | string {
  let f = compiled.get(code);
  if (f) return f;
  const bad = validateCode('javascript', code).filter((d) => d.level === 'error');
  if (bad.length) f = `line ${bad[0].line}: ${bad[0].message}`;
  else {
    try { f = new Function('game', 'self', ...SHADOWED, '"use strict";\n' + code); } catch (e: any) { f = e.message; }
  }
  if (compiled.size > 500) compiled.clear();
  compiled.set(code, f!);
  return f!;
}

function wrapInst(rt: Runtime, i: RInstance) {
  return Object.freeze({
    get x() { return i.x; }, set x(v: number) { i.x = Number(v); },
    get y() { return i.y; }, set y(v: number) { i.y = Number(v); },
    get z() { return i.z; }, set z(v: number) { i.z = Number(v); },
    get angle() { return rt.world.angle(i); }, set angle(v: number) { rt.world.setAngle(i, Number(v)); },
    get visible() { return i.visible; }, set visible(v: boolean) { i.visible = !!v; },
    get vars() { return i.vars; },
    get type() { return i.type; }, get uid() { return i.uid; }, get name() { return i.name; },
    destroy() { rt.world.destroy(i); },
  });
}

const warned = new Set<string>();

export function runCodeBlock(rt: Runtime, b: BlockInstance, ctx: Ctx) {
  const lang = String(b.params.language ?? 'javascript') as CodeLanguage;
  const l = LANGUAGES[lang];
  const code = String(b.params.code ?? '');
  const panel = String(b.params.name || 'panel');
  if (!l) { rt.report('error', `Unknown code language "${lang}"`); return; }
  if (l.run === 'ui') { rt.ui.panels = { ...(rt.ui.panels ?? {}), [panel]: { html: code, visible: true } }; return; }
  if (l.run === 'style') { rt.ui.panelCss = { ...(rt.ui.panelCss ?? {}), [panel]: code }; return; }
  if (l.run !== 'sandbox') {
    const key = b.id;
    if (!warned.has(key)) { warned.add(key); rt.report('warn', `${l.name} code blocks do not run in the game: ${l.status}`); }
    return;
  }
  const f = compileJs(code);
  if (typeof f === 'string') { rt.report('error', `JavaScript block: ${f}`); return; }
  const game = Object.freeze({
    get: (n: string) => { const r = rt.findVar(String(n), ctx); if (!r) throw new Error(`Unknown variable "${n}"`); return r.scope[r.key]; },
    set: (n: string, v: any) => rt.setVar(String(n), v, ctx),
    has: (n: string) => !!rt.findVar(String(n), ctx),
    objects: (type: string) => rt.world.of(String(type)).filter((i) => !i.destroyed).map((i) => wrapInst(rt, i)),
    picked: (type: string) => rt.picked(ctx, String(type)).map((i) => wrapInst(rt, i)),
    create: (type: string, x = 0, y = 0, z = 0) => {
      if (!rt.world.typeExists(String(type))) throw new Error(`Object type "${type}" does not exist`);
      const i = rt.world.spawn(String(type), Number(x), Number(y), Number(z));
      if (i) rt.startPositions.set(i.uid, [i.x, i.y, i.z]);
      return i ? wrapInst(rt, i) : null;
    },
    log: (...m: any[]) => rt.report('info', m.map((x) => (typeof x === 'object' ? JSON.stringify(x) : String(x))).join(' ')),
    trigger: (name: string) => { rt.fireTrigger('system.on_signal', null, (c) => String(c.params.name).toLowerCase() === String(name).toLowerCase()); },
    eval: (expr: string) => rt.evaluate(String(expr), ctx),
    random: () => rt.rng.next(),
    get dt() { return rt.dtScaled; }, get time() { return rt.time; },
  });
  try { (f as Function)(game, ctx.self ? wrapInst(rt, ctx.self) : null); }
  catch (e: any) { rt.report('error', `JavaScript block: ${e?.message ?? e}`); }
}
