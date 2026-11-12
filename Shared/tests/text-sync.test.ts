// P0: the text in an object's Properties and fixed-text "Update text" blocks are one source of truth.
import { describe, expect, it } from 'vitest';
import { block, doc, event, scene } from './helpers';
import { stringLiteral, syncTexts, textSetters, toLiteral } from '../src/textSync';
import { deepClone } from '../src/schema';

const textObj = (text: string, uid = 1) => ({ uid, type: 'Label', kind: 'text' as const, text: { text, size: 24, color: '#fff', hud: true } as any });
function project(text: string, blockText: string) {
  const s = scene([textObj(text), textObj(text, 2)]);
  const d = doc([event([block('system.on_start_of_layout')], [block('ui.set_text', { text: blockText }, 'Label')])]);
  return { instances: s.instances, logic: d };
}
const setter = (p: ReturnType<typeof project>) => (p.logic.sheets[0].events[0] as any).actions[0];

describe('text: Properties and blocks stay in sync', () => {
  it('reads and writes string literals (quotes, escapes)', () => {
    expect(stringLiteral('"Hello"')).toBe('Hello');
    expect(stringLiteral('"Coins: " & coins')).toBeNull();
    for (const s of ['plain', 'say "hi"', 'two\nlines', 'back\\slash']) expect(stringLiteral(toLiteral(s))).toBe(s);
  });

  it('editing the text in Properties updates the fixed-text block', () => {
    const a = project('Hello', '"Hello"'), b = deepClone(a);
    b.instances[0].text!.text = 'Welcome';
    syncTexts(a, b);
    expect(stringLiteral(setter(b).params.text)).toBe('Welcome');
  });

  it('editing the block updates every object of that type showing the old text', () => {
    const a = project('Hello', '"Hello"'), b = deepClone(a);
    setter(b).params.text = '"Game over"';
    syncTexts(a, b);
    expect(b.instances.map((i) => i.text!.text)).toEqual(['Game over', 'Game over']);
  });

  it('a newly added fixed-text block becomes the Properties text', () => {
    const a = { instances: scene([textObj('Text')]).instances, logic: doc([]) }, b = deepClone(a);
    b.logic.sheets[0].events.push(event([block('system.on_start_of_layout')], [block('ui.set_text', { text: '"Press Start"' }, 'Label')]) as any);
    syncTexts(a, b);
    expect(b.instances[0].text!.text).toBe('Press Start');
  });

  it('computed texts are left alone and reported', () => {
    const a = project('Coins', '"Coins: " & coins'), b = deepClone(a);
    b.instances[0].text!.text = 'Money';
    syncTexts(a, b);
    expect(setter(b).params.text).toBe('"Coins: " & coins');
    expect(textSetters(b.logic, 'Label')[0].literal).toBeNull();
  });
});
