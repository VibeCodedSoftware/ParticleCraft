// The Multiplayer pack: a menu button in the game, and a character of their own for each player who joins.
import { describe, expect, it } from 'vitest';
import { doc } from './helpers';
import { Runtime } from '../src/runtime/runtime';
import { InputState } from '../src/runtime/input';
import { emptyScene, makeInstance } from '../src/runtime/scene';
import { behaviorDefaults } from '../src/runtime/behaviors';
import { applySnapshot, makeSnapshot, removeOnlinePlayer, spawnOnlinePlayer } from '../src/runtime/netSync';
import { PACK_BY_ID, installPack, packDefaults } from '../src/packs';

const bh = (type: string, props: any = {}) => ({ type, props: { ...behaviorDefaults(type), ...props } });
function game(opts: any = {}) {
  const scene = emptyScene('S', '3d');
  scene.instances = [
    makeInstance(1, 'Floor', 'box', { y: -0.5, sx: 100, sz: 100, behaviors: [bh('solid')] }),
    makeInstance(2, 'Player', 'box', { y: 0.5, color: '#3366ff', behaviors: [bh('platform')] }),
  ];
  const d = doc([]), pack = PACK_BY_ID['menu.multiplayer'], opened = { n: 0 };
  installPack(d, undefined, scene, pack, { ...packDefaults(pack), ...opts }, { app: 'gamecraft', mode: '3d' });
  const rt = new Runtime(scene, d, { app: 'gamecraft', host: { openMultiplayer: () => { opened.n++; } } });
  rt.tick();
  return { rt, d, scene, opened };
}

describe('multiplayer pack', () => {
  it('opens the menu from the button and the key', () => {
    const { rt, opened } = game();
    rt.input.uiButtons.push('MultiplayerButton'); rt.tick();
    expect(opened.n).toBe(1);
    rt.input.keyDown('M'); rt.tick(); rt.input.keyUp('M'); rt.tick();
    expect(opened.n).toBe(2);
    expect(rt.world.findByName('MultiplayerButton')?.text?.button).toBe(true);
  });

  it('no button when turned off; the key still works', () => {
    const { rt, opened } = game({ button: false });
    expect(rt.world.findByName('MultiplayerButton')).toBeFalsy();
    rt.input.keyDown('M'); rt.tick();
    expect(opened.n).toBe(1);
  });

  it('whoever joins gets their own character, moved by their own controls, and it goes when they leave', () => {
    const { rt } = game();
    rt.input.remotes.set(2, new InputState());
    const copy = spawnOnlinePlayer(rt, 2)!;
    expect(copy.type).toBe('Player');
    expect(copy.uid).not.toBe(2);
    expect(copy.color).toBe('#3366ff');
    expect(rt.world.behavior(copy, 'platform')!.props.controls).toBe('online2');
    expect(rt.world.of('Player').length).toBe(2);
    // Their keys move their character and not the host's.
    const host = rt.world.byUid.get(2)!, x0 = host.x, c0 = copy.x;
    for (let k = 0; k < 20; k++) rt.tick();
    rt.input.remotes.get(2)!.keyDown('D');
    for (let k = 0; k < 30; k++) rt.tick();
    expect(copy.x).toBeGreaterThan(c0 + 0.5);
    expect(host.x).toBeCloseTo(x0);
    removeOnlinePlayer(rt, 2); rt.tick();
    expect(rt.world.of('Player').length).toBe(1);
  });

  it('no second copy for the same player, none past the limit, none without the pack', () => {
    const { rt } = game({ players: '2' });
    expect(spawnOnlinePlayer(rt, 2)).toBeTruthy();
    expect(spawnOnlinePlayer(rt, 2)).toBeNull();
    expect(spawnOnlinePlayer(rt, 3)).toBeNull();
    const s = emptyScene('S', '3d');
    s.instances = [makeInstance(2, 'Player', 'box')];
    expect(spawnOnlinePlayer(new Runtime(s, doc([]), { app: 'gamecraft' }), 2)).toBeNull();
  });

  it('a joined player\'s copy of the game gets the character and knows it is theirs', () => {
    const host = game(), guest = game();
    spawnOnlinePlayer(host.rt, 2);
    const snap = JSON.parse(JSON.stringify(makeSnapshot(host.rt)));
    applySnapshot(guest.rt, snap);
    const mine = guest.rt.world.instances.find((i) => i.behaviors.some((b) => b.props.controls === 'online2'));
    expect(mine?.type).toBe('Player');
    expect(guest.rt.world.of('Player').length).toBe(2);
  });
});
