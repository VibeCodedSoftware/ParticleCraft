// "Text adventure" project type: a full-screen story told by the Dialogue editor (lines, numbered choices,
// conditions, variables) with a status line. Edit the story with Logic › 💬 Dialogue.
import type { GameProject } from '../project/types';
import { textAdventureStory } from '@shared/src/textGame';
import { Kit, makeProject } from './kit';

export function textAdventureTemplate(): GameProject {
  const k = new Kit('Story', '2d');
  k.scene.settings.presentation = 'text';
  k.scene.settings.background = '#0f0d0a';
  k.camera({ z: 20 }, { type: 'orthographic', orthoScale: 20, active: true });
  const { dialogue, events, globals } = textAdventureStory();
  const p = makeProject({
    name: 'Text Adventure', template: 'textadventure', scenes: [k.scene], events, globals, plane: 'xy',
    tutorial: [
      { title: 'A story game', text: 'This project shows its scene as a full-screen story: lines, numbered choices (click or press 1-9), and a status line from the "status" variable. Press Play to read it.', target: 'play' },
      { title: 'Write the story', text: 'Open Logic › 💬 Dialogue to edit "Story": each line can set variables (hasKey = true), and choices can have conditions (hasKey) so they only appear when they make sense. A line with no text is a hidden branch.', target: 'eventsheet' },
      { title: 'Mix in logic', text: 'Every block still works: "When dialogue event…" can play sounds or change variables, and Scene › Presentation switches any scene between story and normal view.', target: 'eventsheet' },
    ],
  });
  p.logic.dialogues = [dialogue];
  return p;
}
