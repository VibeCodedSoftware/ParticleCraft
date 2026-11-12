// "Text adventure" project type: the game is a full-screen story (scene.settings.presentation = 'text') told by a
// Dialogue - lines, numbered choices, conditions and variables - with a status line from the "status" variable.
// Both apps create their text-game projects from this starter story.
import { block, event, type DialogueDef, type DialogueNode, type EventNode, type VariableDef } from './schema';

let n = 0;
const node = (id: string, text: string, o: Partial<DialogueNode> = {}): DialogueNode => ({ id, speaker: 'Narrator', text, choices: [], x: 40 + (n % 4) * 260, y: 40 + Math.floor(n++ / 4) * 170, ...o });
const go = (text: string, to: string, extra: { condition?: string; set?: string } = {}) => ({ id: 'c_' + to + '_' + Math.random().toString(36).slice(2, 6), text, to, ...extra });

export function textAdventureStory(): { dialogue: DialogueDef; events: EventNode[]; globals: VariableDef[] } {
  n = 0;
  const nodes: DialogueNode[] = [
    node('shore', 'Cold surf hisses on the shingle. Above you the old lighthouse stands dark for the first time in a hundred years, and a ship\'s bell rings somewhere out in the fog.', {
      choices: [go('Climb the path to the lighthouse', 'door'), go('Search the boathouse', 'boathouse'), go('Shout into the fog', 'shout')],
    }),
    node('shout', 'Your voice is swallowed whole. After a long moment the bell answers - closer now.', { next: 'shore', set: 'fear = fear + 1' }),
    node('boathouse', 'The boathouse smells of tar and rope. Among the nets hangs a brass key on a hook shaped like a gull.', {
      choices: [go('Take the brass key', 'tookKey', { condition: 'not hasKey' }), go('Go back to the shore', 'shore')],
    }),
    node('tookKey', 'The key is heavier than it looks. Engraved on its bow: KEEPER.', { set: 'hasKey = true; status = "Carrying: brass key"', next: 'boathouse' }),
    node('door', 'The lighthouse door is iron, studded with rivets, and locked fast.', {
      choices: [go('Unlock it with the brass key', 'stairs', { condition: 'hasKey' }), go('Knock', 'knock'), go('Head back down to the shore', 'shore')],
    }),
    node('knock', 'The sound rolls up the tower and back down. Nobody comes. Of course nobody comes.', { next: 'door', set: 'fear = fear + 1' }),
    node('stairs', 'The stairs spiral up into darkness. One hundred and twelve steps; you count every one. At the top the great lamp waits, cold, beside a can of oil.', {
      set: 'status = "Carrying: brass key, lantern oil"',
      choices: [go('Fill and light the lamp', 'light'), go('Look out to sea first', 'look')],
    }),
    node('look', 'Through the salt-blurred glass you see it: a ship, drifting toward the rocks, its bell swinging with every wave.', { next: 'stairs' }),
    node('light', 'The wick catches. The lens turns, and a white beam sweeps out across the water. Far below, the ship\'s bell changes its rhythm - it is turning away from the rocks.', { next: 'ending' }),
    // A line with no text is a branch: it takes the first choice whose condition holds.
    node('ending', '', { speaker: '', choices: [go('calm ending', 'calm', { condition: 'fear < 2' }), go('uneasy ending', 'shaken', { condition: 'fear >= 2' })] }),
    node('calm', 'You sit with the lamp until dawn. The keeper\'s key stays in your pocket; somehow it feels like it belongs there now.', { end: true, ending: 'keeper' }),
    node('shaken', 'You keep the lamp burning until dawn, though every creak of the tower makes you flinch. The ship is safe. You will not be coming back.', { end: true, ending: 'safe' }),
  ];
  const dialogue: DialogueDef = { id: 'dlg_story', name: 'Story', start: 'shore', nodes };
  const events: EventNode[] = [
    event([block('system.on_start_of_layout')], [block('dialogue.start', { dialogue: 'Story', wait: false })]),
    event([block('input.on_key_pressed', { key: 'R' }), block('dialogue.is_active', {}, undefined, { invert: true })], [block('game.restart')]),
  ];
  const globals: VariableDef[] = [
    { name: 'status', type: 'string', value: 'Carrying: nothing', comment: 'Shown at the top of the story' },
    { name: 'hasKey', type: 'boolean', value: false },
    { name: 'fear', type: 'number', value: 0, comment: 'Shouting and knocking make the ending more uneasy' },
  ];
  return { dialogue, events, globals };
}
