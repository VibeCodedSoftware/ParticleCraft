// Dialogue helpers shared by the editor, templates and tests.
import { newId, type DialogueChoice, type DialogueDef, type DialogueNode } from './schema';

export function newDialogueNode(x: number, y: number, o: Partial<DialogueNode> = {}): DialogueNode {
  return { id: newId('dl'), speaker: 'Narrator', text: '', choices: [], x, y, ...o };
}

/** The guard example: three choices with different outcomes, a condition, variables, events and rejoining paths. */
export function guardExample(): DialogueDef {
  const n = (o: Partial<DialogueNode>, x: number, y: number) => newDialogueNode(x, y, o);
  const greet = n({ speaker: 'Guard', text: 'Halt! Nobody enters the castle without the captain\'s word.' }, 40, 140);
  const ask = n({ speaker: 'Guard', text: 'Permission, eh? Answer me this: who rules these lands?' }, 380, 20);
  const right = n({ speaker: 'Guard', text: 'Correct. Go on through, and mind the dogs.', set: 'reputation = reputation + 1', event: 'open_gate' }, 720, 0);
  const wrong = n({ speaker: 'Guard', text: 'Wrong. Off with you.' }, 720, 150);
  const bribe = n({ speaker: 'Guard', text: '(The guard pockets the coins.) I saw nothing. In you go.', set: 'gold = gold - 10; reputation = reputation - 1', event: 'open_gate' }, 380, 230);
  const refuse = n({ speaker: 'Guard', text: 'Suit yourself. The dungeon is that way.', event: 'arrest' }, 380, 400);
  const enter = n({ speaker: 'Narrator', text: 'The gate creaks open.', end: true, ending: 'entered' }, 1060, 60);
  const away = n({ speaker: 'Narrator', text: 'You walk away from the gate.', end: true, ending: 'turned_away' }, 1060, 250);
  const c = (text: string, to: DialogueNode, o: Partial<DialogueChoice> = {}): DialogueChoice => ({ id: newId('ch'), text, to: to.id, ...o });
  greet.choices = [c('Ask for permission to enter', ask), c('Offer a bribe (10 gold)', bribe, { condition: 'gold >= 10' }), c('Refuse to cooperate', refuse)];
  ask.choices = [c('The King', right), c('The Captain', wrong)];
  right.next = enter.id; bribe.next = enter.id; wrong.next = away.id; refuse.next = away.id;
  return { id: newId('dlg'), name: 'Guard', start: greet.id, nodes: [greet, ask, right, wrong, bribe, refuse, enter, away] };
}
