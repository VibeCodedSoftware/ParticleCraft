// One logic system behind every coding style: Craft script round trips, code blocks, dialogue and scenes.
import { describe, expect, it } from 'vitest';
import { block, doc, event, num, run, scene, str } from './helpers';
import { carryIds, parseSheet, printSheet } from '../src/craftScript';
import { validateCode } from '../src/languages';
import { generateCode } from '../src/codegen/codegen';
import { Runtime } from '../src/runtime/runtime';
import { checkDialogue } from '../src/runtime/story';
import { guardExample } from '../src/dialogueKit';
import { group, comment, type EventNode } from '../src/schema';
import { styleCompatibility } from '../src/codingStyles';

const strip = (nodes: EventNode[]): any => JSON.parse(JSON.stringify(nodes, (k, v) => (k === 'id' ? undefined : v)));

function sample() {
  const ev = event([block('input.on_key_pressed', { key: 'Space' })], [
    block('object.create', { object: 'Bullet', x: 'Player.X', y: 'Player.Y', z: '0' }),
    block('code.run', { language: 'python', code: 'if score > 3:\n    print("hi")\n', name: 'panel' }),
  ], [event([block('system.compare_variable', { variable: 'score', op: '>', value: '5' }, undefined, { invert: true })], [block('var.add', { variable: 'score', value: '1' }, undefined, { comment: 'count up' })])]);
  const els = event([], [block('system.log', { message: '"else"' })], [], { isElse: true, isOr: true });
  const loose = event([], [block('object.move', { dx: '1', dy: '0', dz: '0' }, 'Player')], [], { loose: true, locals: [{ name: 'k', type: 'number', value: 2, isStatic: true }] });
  return doc([ev, els, group('Enemies', [comment('a note'), loose], { active: false })], [num('score', 1), str('name', 'Ada'), { name: 'items', type: 'array', value: [1, 'two'] }, { name: 'cfg', type: 'dict', value: { a: 1 } }]);
}

describe('Craft script (Code style)', () => {
  it('prints and parses back to the same program', () => {
    const d = sample();
    const text = printSheet(d, d.sheets[0]);
    const back = parseSheet(text);
    expect(back.errors).toEqual([]);
    expect(strip(back.events)).toEqual(strip(d.sheets[0].events));
    expect(back.globals).toEqual(d.globals);
    // The Python code block survives as a heredoc, byte for byte.
    expect(text).toContain('code: <<<');
  });

  it('keeps IDs where the structure still matches, so layouts survive edits', () => {
    const d = sample();
    const back = parseSheet(printSheet(d, d.sheets[0]).replace('"Space"', '"Enter"'));
    carryIds(d.sheets[0].events, back.events);
    expect(back.events[0].id).toBe(d.sheets[0].events[0].id);
    expect((back.events[0] as any).actions[0].id).toBe((d.sheets[0].events[0] as any).actions[0].id);
  });

  it('reports mistakes with line numbers instead of guessing', () => {
    const r = parseSheet('event {\n  do object.move dx: "1"\n  if var.add variable: "x"\n');
    const msgs = r.errors.map((e) => `${e.line}:${e.message}`);
    expect(msgs.some((m) => m.startsWith('2:') && m.includes('@ObjectName'))).toBe(true);
    expect(msgs.some((m) => m.startsWith('3:') && m.includes('use "do"'))).toBe(true);
    expect(msgs.some((m) => m.includes('Missing }'))).toBe(true);
  });

  it('switching styles never changes the document; unsupported shapes are reported, not dropped', () => {
    const d = sample();
    const before = JSON.stringify(d);
    const notes = styleCompatibility(d, undefined, 'bricks');
    expect(notes.some((n) => n.includes('sub-event'))).toBe(true);
    expect(JSON.stringify(d)).toBe(before);
  });
});

describe('Language code blocks', () => {
  it('JavaScript runs sandboxed with the game API', () => {
    const code = 'game.set("score", game.get("score") + 41);\nfor (const p of game.objects("Player")) p.x = 7;\ngame.log("ok " + game.get("score"));';
    const { rt, logs } = run(doc([event([block('system.on_start_of_layout')], [block('code.run', { language: 'javascript', code, name: 'p' })])], [num('score', 1)]), scene([{ type: 'Player', kind: 'box' }]), 1);
    expect(rt.globals.score).toBe(42);
    expect(rt.world.of('Player')[0].x).toBe(7);
    expect(logs).toContain('ok 42');
  });

  it('JavaScript cannot reach the page', () => {
    expect(validateCode('javascript', 'window.location = "x"').some((d) => d.level === 'error')).toBe(true);
    expect(validateCode('javascript', '({}).constructor.constructor("return this")()').some((d) => d.level === 'error')).toBe(true);
    const errors: string[] = [];
    const d = doc([event([block('system.on_start_of_layout')], [block('code.run', { language: 'javascript', code: 'fetch("http://x")', name: 'p' })])]);
    const rt = new Runtime(scene([]), d, { app: 'logiccraft', host: { log: (l, m) => { if (l === 'error') errors.push(m); } } });
    rt.tick();
    expect(errors.join()).toMatch(/not available/);
  });

  it('HTML and CSS make a named UI panel; other languages warn instead of pretending to run', () => {
    const warns: string[] = [];
    const d = doc([event([block('system.on_start_of_layout')], [
      block('code.run', { language: 'html', code: '<p>Gold {{gold}}</p>', name: 'shop' }),
      block('code.run', { language: 'css', code: 'p { color: red; }', name: 'shop' }),
      block('code.run', { language: 'python', code: 'print(1)', name: 'p' }),
    ])], [num('gold', 3)]);
    const rt = new Runtime(scene([]), d, { app: 'gamecraft', host: { log: (l, m) => { if (l === 'warn') warns.push(m); } } });
    rt.tick();
    expect(rt.ui.panels?.shop).toEqual({ html: '<p>Gold {{gold}}</p>', visible: true });
    expect(rt.ui.panelCss?.shop).toContain('color: red');
    expect(warns.join()).toMatch(/Python code blocks do not run in the game/);
  });

  it('validators catch language-specific mistakes', () => {
    expect(validateCode('python', 'if x > 1\n    y = 2').some((d) => d.message.includes(':'))).toBe(true);
    expect(validateCode('lua', 'if x then\n  y = 1\n').some((d) => d.message.includes('end'))).toBe(true);
    expect(validateCode('html', '<div><p>hi</div>').some((d) => d.level === 'error')).toBe(true);
    expect(validateCode('cpp', 'int main() { return 0; }')).toEqual([]);
    expect(validateCode('json', '{"a": }').length).toBe(1);
  });

  it('a code block in the export language is included verbatim; others are reported', () => {
    const d = doc([event([block('system.on_start_of_layout')], [block('code.run', { language: 'python', code: 'print("from block")', name: 'p' })])]);
    expect(generateCode(d, null, 'python').code).toContain('print("from block")');
    const js = generateCode(d, null, 'javascript');
    expect(js.code).not.toContain('print("from block")');
    expect(js.unsupported.some((u) => u.reason.includes('python code block'))).toBe(true);
  });
});

describe('Dialogue', () => {
  const setup = () => {
    const g = guardExample();
    const d = doc([
      event([block('system.on_start_of_layout')], [block('dialogue.start', { dialogue: 'Guard', wait: true }), block('var.set', { variable: 'after', value: '1' })]),
      event([block('dialogue.on_event', { name: 'open_gate' })], [block('var.add', { variable: 'gates', value: '1' })]),
      event([block('dialogue.on_end', { dialogue: '', ending: 'entered' })], [block('var.set', { variable: 'ending', value: '"in"' })]),
    ], [num('gold', 25), num('reputation', 0), num('gates'), num('after'), str('ending')]);
    d.dialogues = [g];
    return { rt: run(d, scene([]), 1).rt, g };
  };

  it('branches on choices, applies effects, fires events and endings, then resumes the waiting event', () => {
    const { rt } = setup();
    expect(rt.dialogue?.speaker).toBe('Guard');
    expect(rt.dialogue?.choices.map((c) => c.index)).toEqual([1, 2, 3]);
    rt.dialogueChoose(2); // bribe
    expect(rt.globals.gold).toBe(15);
    expect(rt.globals.reputation).toBe(-1);
    expect(rt.globals.gates).toBe(1);
    expect(rt.dialogue?.canContinue).toBe(true);
    rt.dialogueContinue(); // â†’ "The gate creaks open." (end line)
    rt.dialogueContinue();
    expect(rt.dialogue).toBeNull();
    expect(rt.globals.ending).toBe('in');
    rt.tick();
    expect(rt.globals.after).toBe(1);
  });

  it('hides choices whose condition is false', () => {
    const { rt } = setup();
    rt.dialogue = null as typeof rt.dialogue; rt.globals.gold = 0;
    rt.dialogueStart('Guard');
    expect(rt.dialogue?.choices.map((c) => c.text)).toEqual(['Ask for permission to enter', 'Refuse to cooperate']);
  });

  it('the editor check finds broken links and unreachable lines', () => {
    const g = guardExample();
    g.nodes[0].choices[0].to = 'missing';
    expect(checkDialogue(g).join()).toMatch(/deleted line/);
    expect(checkDialogue(g).join()).toMatch(/never be reached/);
  });
});

describe('Scenes', () => {
  it('Load scene keeps chosen variables, passes data and fades; unknown scenes stay put', () => {
    const errs: string[] = [];
    const d = doc([
      event([block('system.on_start_of_layout'), block('game.scene_is', { scene: 'One' })], [block('game.load_scene', { scene: 'two', transition: 'fade', duration: '0.2', keep: 'coins', data: '"from one"' })]),
      event([block('game.on_scene_end')], [block('var.set', { variable: 'left', value: '1' })]),
    ], [num('coins', 0), num('lives', 3), num('left')]);
    const s1 = scene([]); s1.name = 'One';
    const rt = new Runtime(s1, d, { app: 'logiccraft', sceneNames: ['One', 'Two'], host: { log: (l, m) => { if (l === 'error') errs.push(m); } } });
    rt.globals.coins = 9; rt.globals.lives = 1;
    rt.tick();
    expect(rt.globals.left).toBe(1);
    expect(rt.ui.transition?.phase).toBe('out');
    for (let i = 0; i < 15 && rt.restartRequested === undefined; i++) rt.tick();
    expect(rt.restartRequested).toBe('Two');
    const s2 = scene([]); s2.name = 'Two';
    const next = new Runtime(s2, d, { app: 'logiccraft', sceneNames: ['One', 'Two'], carry: rt.carry });
    expect(next.globals.coins).toBe(9);
    expect(next.globals.lives).toBe(3); // not kept: back to its starting value
    expect(next.sceneData).toBe('from one');
    expect(next.previousScene).toBe('One');
    expect(next.transitionAlpha()).toBeCloseTo(1);

    const stay = new Runtime(s1, doc([event([block('system.on_start_of_layout')], [block('game.load_scene', { scene: 'Nowhere', transition: 'none' })])]), { app: 'logiccraft', sceneNames: ['One'], host: { log: (l, m) => { if (l === 'error') errs.push(m); } } });
    stay.tick();
    expect(stay.restartRequested).toBeUndefined();
    expect(errs.join()).toMatch(/Nowhere" does not exist/);
  });

  it('old Load scene blocks (scene name only) keep their old behavior', () => {
    const d = doc([event([block('system.on_start_of_layout')], [block('game.load_scene', { scene: 'B' })])], [num('x', 0)]);
    const { rt } = run(d, scene([]), 1);
    expect(rt.restartRequested).toBe('B');
    expect(rt.carry?.globals).toEqual({});
  });
});

