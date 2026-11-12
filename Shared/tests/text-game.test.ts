import { describe, expect, it } from 'vitest';
import { doc, scene } from './helpers';
import { Runtime } from '../src/runtime/runtime';
import { textAdventureStory } from '../src/textGame';

function play() {
  const { dialogue, events, globals } = textAdventureStory();
  const d = doc(events, globals);
  d.dialogues = [dialogue];
  const s = scene([]);
  s.settings.presentation = 'text';
  const rt = new Runtime(s, d, { app: 'logiccraft' });
  rt.tick();
  return rt;
}

describe('text adventure', () => {
  it('the door only opens with the key; the story reaches the calm ending and logs every line and choice', () => {
    const rt = play();
    expect(rt.dialogue?.nodeId).toBe('shore');
    rt.dialogueChoose(1); // climb to the door
    expect(rt.dialogue!.choices.map((c) => c.text)).not.toContain('Unlock it with the brass key');
    rt.dialogueChoose(1); // knock (the hidden key choice shifts the numbers) -> fear 1
    expect(rt.globals.fear).toBe(1);
    rt.dialogueContinue();
    rt.dialogueChoose(2); // back to the shore
    rt.dialogueChoose(2); // boathouse
    rt.dialogueChoose(1); // take the key
    expect(rt.globals.hasKey).toBe(true);
    expect(rt.globals.status).toContain('brass key');
    rt.dialogueContinue(); // back in the boathouse: the key is gone from the choices
    expect(rt.dialogue!.choices.map((c) => c.text)).toEqual(['Go back to the shore']);
    rt.dialogueChoose(1);
    rt.dialogueChoose(1); // the door
    rt.dialogueChoose(1); // unlock
    expect(rt.dialogue?.nodeId).toBe('stairs');
    rt.dialogueChoose(1); // light the lamp
    rt.dialogueContinue(); // hidden branch: fear 1 < 2 -> calm
    expect(rt.dialogue?.nodeId).toBe('calm');
    rt.dialogueContinue();
    expect(rt.dialogue).toBeNull();
    expect(rt.storyLog.filter((e) => e.kind === 'choice').length).toBe(9);
    expect(rt.storyLog.some((e) => e.text.startsWith('You sit with the lamp'))).toBe(true);
  });
});
