import { describe, expect, it } from 'vitest';
import { block, doc, event, num, scene } from './helpers';
import { Runtime } from '../src/runtime/runtime';
import { InputState } from '../src/runtime/input';
import { behaviorDefaults } from '../src/runtime/behaviors';
import { applySnapshot, makeSnapshot } from '../src/runtime/netSync';
import { makeInstance } from '../src/runtime/scene';

describe('online sync', () => {
  it('a joined player sees the host world: remote controls move their character, spawns and removals follow', () => {
    const mk = () => {
      const s = scene([
        { uid: 1, type: 'Player', x: 0, behaviors: [{ type: 'eightdir', props: { ...behaviorDefaults('eightdir'), controls: 'default' } }] },
        { uid: 2, type: 'Buddy', x: 5, behaviors: [{ type: 'eightdir', props: { ...behaviorDefaults('eightdir'), controls: 'online2' } }] },
        { uid: 3, type: 'Score', kind: 'text', text: { text: 'Score', size: 20, color: '#fff', align: 'left', hud: true, anchor: 'tl' } },
      ]);
      const { uid: _u, ...tpl } = makeInstance(0, 'Coin', 'sphere', { color: '#ffd23f' });
      s.objectTypes.push({ name: 'Coin', kind: 'sphere', vars: [], template: tpl });
      return s;
    };
    const logic = doc([
      event([block('input.on_key_pressed', { key: 'C' })], [block('object.create', { object: 'Coin', x: '1', y: '2', z: '0' }), block('var.add', { variable: 'n', value: '1' })]),
      event([block('input.on_key_pressed', { key: 'X' })], [block('object.destroy', {}, 'Coin')]),
      event([block('system.every_tick')], [block('ui.set_text', { text: '"Coins made: " & n' }, 'Score')]),
    ], [num('n')]);
    const host = new Runtime(mk(), logic, { app: 'logiccraft' });
    const client = new Runtime(mk(), logic, { app: 'logiccraft' });
    const remote = new InputState();
    host.input.remotes.set(2, remote);
    remote.applySnapshot({ keys: ['ArrowRight'], pad: null, axes: [0, 0, 0, 0] });
    host.input.keyDown('C');
    for (let i = 0; i < 30; i++) host.tick();
    // The wire format is JSON.
    applySnapshot(client, JSON.parse(JSON.stringify(makeSnapshot(host))));
    const buddy = client.world.of('Buddy')[0];
    expect(buddy.x).toBeGreaterThan(5.5);
    expect(buddy.x).toBeCloseTo(host.world.of('Buddy')[0].x, 3);
    expect(host.world.of('Player')[0].x).toBe(0); // the remote player's keys never reach player 1
    expect(client.world.of('Coin').length).toBe(1);
    expect(client.world.of('Coin')[0].uid).toBe(host.world.of('Coin')[0].uid);
    expect(client.world.of('Score')[0].text!.text).toBe('Coins made: 1');
    expect(client.globals.n).toBe(1);
    host.input.keyDown('X'); host.tick();
    applySnapshot(client, makeSnapshot(host));
    expect(client.world.of('Coin').length).toBe(0);
  });
});
