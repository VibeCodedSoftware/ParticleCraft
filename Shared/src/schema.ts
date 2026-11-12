// Canonical intermediate representation (IR) for visual logic, shared by GameCraft and LogicCraft.
// The same tree is rendered as a Construct-style event sheet and as Scratch-style stacked blocks,
// so both views always edit one representation. See Shared/visual-logic-schema/README.md.
import type { SoundLibrary } from './sounds';

export const LOGIC_FORMAT = 'craft.logic';
export const LOGIC_SCHEMA_VERSION = 1;
export const PACKAGE_FORMAT = 'craft.logic.package';

export type AppId = 'gamecraft' | 'logiccraft' | 'worldcraft';
export type VarType = 'number' | 'string' | 'boolean' | 'array' | 'dict' | 'vector' | 'object';
export type ParamValue = string | number | boolean;

export interface VariableDef {
  name: string;
  type: VarType;
  value: any;
  /** Construct-style "static" local: keeps its value between ticks. */
  isStatic?: boolean;
  /** Global constants cannot be changed by actions. */
  isConstant?: boolean;
  comment?: string;
}

/** One condition or action placed in an event. `block` is the stable block ID. */
export interface BlockInstance {
  id: string;
  block: string;
  /** Object type the block operates on (Construct "object"), e.g. "Player". Empty for System blocks. */
  target?: string;
  /** Parameters. Expression parameters are stored as source strings (e.g. "Player.X + 10"). */
  params: Record<string, ParamValue>;
  /** Inverted condition (Construct's "Invert" / the red X). */
  invert?: boolean;
  disabled?: boolean;
  comment?: string;
}

export interface EventBlock {
  kind: 'event';
  id: string;
  conditions: BlockInstance[];
  actions: BlockInstance[];
  children: EventNode[];
  /** "Else" event: runs only when the previous sibling event did not run. */
  isElse?: boolean;
  /** OR block: any condition true passes instead of all. */
  isOr?: boolean;
  disabled?: boolean;
  /**
   * Loose blocks lying on the block canvas (Scratch-style): shown without a header and never run or exported,
   * until a trigger ("when …", every tick, forever) is put on top.
   */
  loose?: boolean;
  locals?: VariableDef[];
  breakpoint?: boolean;
}

export interface GroupNode {
  kind: 'group';
  id: string;
  name: string;
  description?: string;
  active: boolean;
  children: EventNode[];
  collapsed?: boolean;
}

export interface CommentNode {
  kind: 'comment';
  id: string;
  text: string;
  color?: string;
}

export type EventNode = EventBlock | GroupNode | CommentNode;

export interface FunctionDef {
  name: string;
  params: { name: string; type: VarType }[];
  description?: string;
}

export interface EventSheet {
  id: string;
  name: string;
  events: EventNode[];
  /** Block-editor canvas positions for top-level stacks. Purely visual; never affects execution. */
  layout?: Record<string, { x: number; y: number }>;
  /** Node-graph positions (keys: "ev:<eventId>", block IDs, "var:<name>", comment IDs). Purely visual. */
  nodeLayout?: Record<string, { x: number; y: number }>;
  /** Other sheets whose events run as part of this one (Construct "Include event sheet"), e.g. extension libraries. */
  includes?: string[];
}

/** A preset the user saved: its events (blocks for `target`, which applying can switch to another object type). */
export interface CustomPreset {
  id: string; name: string; category: string; description: string;
  /** The object type its blocks were written for. */
  target: string;
  events: EventNode[];
  /** Behaviors (with their settings) the target had when it was saved. */
  behaviors?: { type: string; props: Record<string, any> }[];
}

/** How an input action responds (Input editor › Tuning). */
/** One local player's input: which device they play with and their own profile (none = the project's actions). */
export interface PlayerInput {
  /** all = every device (pad 1 for gamepad bindings); keyboard = keyboard and mouse only; gamepadN = that pad only. */
  device: 'all' | 'keyboard' | 'gamepad1' | 'gamepad2' | 'gamepad3' | 'gamepad4';
  profile?: string;
}

export interface ActionTuning {
  /** Analog values below this count as 0; the rest is rescaled to 0..1. */
  deadzone?: number;
  /** linear; smooth (gentle start and end); precise (fine control near the centre, value²); aggressive (√value). */
  curve?: 'linear' | 'smooth' | 'precise' | 'aggressive';
  /** Multiplies the value (1 = as is). */
  sensitivity?: number;
  /** Negates the action in the movement / look vectors. */
  invert?: boolean;
  /** hold: on while held; toggle: each press switches it on / off ("Is held" stays true). */
  mode?: 'hold' | 'toggle';
}

export interface LogicDocument {
  format: typeof LOGIC_FORMAT;
  schemaVersion: number;
  id: string;
  name: string;
  meta: { createdBy: AppId; created: string; modified: string; description?: string };
  /** World plane used by movement blocks: 'xy' (2D, Y up) or 'xz' (3D ground plane). */
  plane: 'xy' | 'xz';
  globals: VariableDef[];
  functions: FunctionDef[];
  sheets: EventSheet[];
  /** Named input actions → bindings ("Space", "mouse:left", "pad:A"). Absent = the default set. */
  inputActions?: Record<string, string[]>;
  /** Input contexts (Gameplay, Menu, Vehicle…) → the actions that work only while that context is active. */
  inputContexts?: Record<string, string[]>;
  /** Per-action feel: deadzone (0..0.9), response curve, sensitivity, hold or toggle. */
  inputTuning?: Record<string, ActionTuning>;
  /** The user's own presets (a group of events saved from the sheet, plus its object's behaviors), shown in Presets › My presets. */
  customPresets?: CustomPreset[];
  /** Saved control layouts (name → action bindings), switched with "Change input profile". */
  inputProfiles?: Record<string, Record<string, string[]>>;
  /** A profile's own feel (profile → action → tuning), over the project's tuning while that profile is in use. */
  inputProfileTuning?: Record<string, Record<string, ActionTuning>>;
  /**
   * Local players 1-4 (Input editor › Players): each player's device and own profile, so players never share
   * bindings or tuning. Absent: player 1 uses every device, players 2-4 gamepads 2-4, all on the project's actions.
   */
  inputPlayers?: Record<string, PlayerInput>;
  /** Bullet holes and blood: on or off, sizes, lifetimes, limits (see runtime/marks.ts). */
  marks?: import('./runtime/marks').MarkSettings;
  /** Multiplayer pack: each player who joins gets a copy of this object to control. */
  multiplayer?: { player: string; maxPlayers: number };
  /** On-screen touch controls for phones and tablets (see touchControls.ts). */
  touchControls?: import('./touchControls').TouchLayout;
  /** Branching conversations, started and controlled by the Dialogue blocks. Independent of coding style. */
  dialogues?: DialogueDef[];
  /** Custom synthesized sounds, imported sound files, per-sound settings and category volumes (Sound panel). */
  sounds?: SoundLibrary;
  /** Cutscene videos (Videos panel): a name used by the video blocks and the file it plays. */
  videos?: VideoDef[];
  /** UI pictures (Pictures panel): transition shapes and fade maps, dialogue box backgrounds, speaker portraits. */
  pictures?: PictureDef[];
  /** How the dialogue box looks (Dialogue editor › Look). */
  dialogueStyle?: DialogueStyle;
  /** Fonts imported for the game's text (Dialogue editor › Look › Import font): a name and the stored file (.ttf, .otf, .woff, .woff2). */
  fonts?: PictureDef[];
  /** Application-specific data that the other application must preserve but need not understand. */
  extensions: Record<string, any>;
}

/** A player response. Hidden while `condition` (an expression) is false; `set` runs assignments like "gold = gold - 10". */
export interface DialogueChoice { id: string; text: string; to?: string; condition?: string; set?: string; event?: string }

/**
 * One line of a conversation. With choices the player picks one; otherwise the line continues to `next`
 * (or ends the conversation when there is none / `end` is set). On arrival it runs `set`, fires the custom
 * dialogue event `event`, plays `sound` and can switch to `scene`.
 */
export interface DialogueNode {
  id: string; speaker: string; text: string;
  next?: string; choices: DialogueChoice[];
  set?: string; event?: string; sound?: string; scene?: string;
  end?: boolean; ending?: string;
  x: number; y: number;
}

export interface DialogueDef { id: string; name: string; start: string; nodes: DialogueNode[] }

/** A picture the game's UI uses, by name (the file is stored with the project). */
export interface PictureDef { name: string; ref: string }

/** The dialogue box's look: a preset, with any part replaced (colours, font, your own box picture, portraits). */
export interface DialogueStyle {
  preset: 'dark' | 'light' | 'parchment' | 'bubble' | 'pixel' | 'comic' | 'glass' | 'retro' | 'ink';
  position?: 'bottom' | 'top' | 'middle';
  /**
   * Where the line appears: in a box on the screen, or in a bubble over the speaker's head (the object whose name is
   * the speaker, or the player for "Player" / "You"; in first person the player's own lines stay on the screen).
   * Unset: the preset's own (Ink bubble: over heads).
   */
  placement?: 'screen' | 'head';
  /** Overrides of the preset (empty = the preset's own). */
  background?: string; border?: string; textColor?: string; speakerColor?: string;
  /** A built-in font (sans, serif, mono, pixel, comic, rounded, retro), or one you imported: "font:<name>". */
  font?: string;
  /** Text appears all at once, or letter by letter at `typeSpeed` letters a second (a click shows the rest). Unset: the preset's own. */
  reveal?: 'instant' | 'typewriter'; typeSpeed?: number;
  /** How the box comes in, over `animTime` seconds; and how it moves while open, by `idleAmount` (0-1). */
  animIn?: 'none' | 'fade' | 'pop' | 'slide' | 'drop' | 'bounce' | 'unfold'; animTime?: number;
  idle?: 'none' | 'float' | 'wobble' | 'shake'; idleAmount?: number;
  /** Line noise: the box's edges redrawn a little differently several times a second, as hand-drawn lines "boil" (0-1, and times a second). */
  boil?: number; boilRate?: number;
  /**
   * How each letter appears (pop, fade, slide up, bounce, scramble through random letters, jumble: tilted and sized
   * every which way, then settling) and how letters move while shown (wave, shake, jitter), by `textAmount` (0-1).
   * Words can be coloured in the line itself: [pink]Memu[/] or [#ff88aa]Memu[/].
   */
  textIn?: 'none' | 'pop' | 'fade' | 'slide' | 'bounce' | 'scramble' | 'jumble'; textIdle?: 'none' | 'wave' | 'shake' | 'jitter'; textAmount?: number;
  /** The player's responses: a list to click, or one at a time with ◀ ▶ arrows (Left / Right or A / D to change, Enter / Space or a click to answer). */
  choiceMode?: 'list' | 'arrows';
  /** Your own box: a picture (by name) stretched over the box, or as a nine-slice frame keeping its corners. */
  boxPicture?: string; boxFit?: 'stretch' | 'nine-slice'; slice?: number;
  /** Speaker pictures (speaker name → picture name), shown beside the text. */
  portraits?: Record<string, string>;
  portraitShape?: 'circle' | 'rounded' | 'square' | 'none';
  /** A picture drawn over the portrait (a ring or frame), by name. */
  portraitFrame?: string;
  portraitSide?: 'left' | 'right';
}

/** A video file the game can play as a cutscene. `ref` is a project file ("proj:videos/intro.mp4"). */
export interface VideoDef { name: string; ref: string; /** Seconds, measured on import (lets headless runs end the video). */ duration?: number }

/** Portable description of an object type referenced by logic (used in interchange packages). */
export interface PortableObjectType {
  name: string;
  kind: string;
  color?: string;
  size?: [number, number, number];
  vars: VariableDef[];
  behaviors: { type: string; props: Record<string, any> }[];
}

export interface LogicPackage {
  format: typeof PACKAGE_FORMAT;
  schemaVersion: number;
  sourceApp: AppId;
  sourceAppVersion: string;
  exported: string;
  logic: LogicDocument;
  objectTypes: PortableObjectType[];
  /** Instances so a LogicCraft stage or GameCraft scene can be rebuilt on the other side. */
  instances?: any[];
  /** Asset references packaged with the logic (paths relative to the package). */
  assets: { id: string; path: string; kind: string }[];
  /** Untouched data from the source app, preserved for lossless round trips. */
  passthrough?: Record<string, any>;
}

let idCounter = 0;
export function newId(prefix = 'n'): string {
  idCounter = (idCounter + 1) % 1e6;
  const rand = Math.floor(Math.random() * 0xffffff).toString(36);
  return `${prefix}_${Date.now().toString(36)}${rand}${idCounter.toString(36)}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function createLogicDocument(name: string, createdBy: AppId, plane: 'xy' | 'xz' = 'xy'): LogicDocument {
  const t = nowIso();
  return {
    format: LOGIC_FORMAT,
    schemaVersion: LOGIC_SCHEMA_VERSION,
    id: newId('logic'),
    name,
    meta: { createdBy, created: t, modified: t },
    plane,
    globals: [],
    functions: [],
    sheets: [{ id: newId('sheet'), name: 'Event sheet 1', events: [], layout: {} }],
    extensions: {},
  };
}

export function block(blockId: string, params: Record<string, ParamValue> = {}, target?: string, extra: Partial<BlockInstance> = {}): BlockInstance {
  const b: BlockInstance = { id: newId('b'), block: blockId, params, ...extra };
  if (target) b.target = target;
  return b;
}

export function event(conditions: BlockInstance[], actions: BlockInstance[], children: EventNode[] = [], extra: Partial<EventBlock> = {}): EventBlock {
  return { kind: 'event', id: newId('ev'), conditions, actions, children, ...extra };
}

export function group(name: string, children: EventNode[], extra: Partial<GroupNode> = {}): GroupNode {
  return { kind: 'group', id: newId('grp'), name, active: true, children, ...extra };
}

export function comment(text: string): CommentNode {
  return { kind: 'comment', id: newId('cm'), text };
}

export function defaultValueFor(type: VarType): any {
  switch (type) {
    case 'number': return 0;
    case 'string': return '';
    case 'boolean': return false;
    case 'array': return [];
    case 'dict': return {};
    case 'vector': return [0, 0, 0];
    case 'object': return -1;
  }
}

/** Depth-first walk over every event node. */
export function walkEvents(nodes: EventNode[], fn: (n: EventNode, parent: EventNode | null, depth: number) => void, parent: EventNode | null = null, depth = 0) {
  for (const n of nodes) {
    fn(n, parent, depth);
    if (n.kind === 'event' || n.kind === 'group') walkEvents(n.children, fn, n, depth + 1);
  }
}

export function allBlocks(doc: LogicDocument): BlockInstance[] {
  const out: BlockInstance[] = [];
  for (const s of doc.sheets) walkEvents(s.events, (n) => { if (n.kind === 'event') out.push(...n.conditions, ...n.actions); });
  return out;
}

export function deepClone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v));
}

/** Give every node and block in a subtree a fresh ID (used by duplicate / paste). */
export function reassignIds<T extends EventNode | BlockInstance>(node: T): T {
  const c: any = deepClone(node);
  const fix = (n: any) => {
    if (n.block) { n.id = newId('b'); return; }
    n.id = newId(n.kind === 'group' ? 'grp' : n.kind === 'comment' ? 'cm' : 'ev');
    if (n.kind === 'event') { n.conditions.forEach(fix); n.actions.forEach(fix); }
    if (n.children) n.children.forEach(fix);
  };
  fix(c);
  return c;
}
