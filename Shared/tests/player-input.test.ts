// Per-player input profiles (Input editor › Players): each local player has their own device and profile, so
// bindings, tuning and profile switches never leak between players.
import { describe, expect, it } from 'vitest';
import { block, doc, event, num, scene } from './helpers';
import { Runtime } from '../src/runtime/runtime';
import { playerDeviceBindings } from '../src/runtime/input';

const PAD = (pressed: number[] = []) => Array.from({ length: 17 }, (_, k) => pressed.includes(k));

describe('per-player input', () => {
  it('a player keeps only their device, pointed at their gamepad', () => {
    const bs = ['Space', 'mouse:left', 'pad:A', 'axis:LeftX-'];
    expect(playerDeviceBindings(bs, 'keyboard')).toEqual(['Space', 'mouse:left']);
    expect(playerDeviceBindings(bs, 'gamepad2')).toEqual(['pad2:A', 'axis2:LeftX-']);
    expect(playerDeviceBindings(bs, 'all')).toEqual(bs);
  });

  it('action blocks read one player: gamepad 2 jumps player 2 only', () => {
    const d = doc([
      event([block('input.action_began', { action: 'Jump', player: 'player 1' })], [block('var.add', { variable: 'p1', value: '1' })]),
      event([block('input.action_began', { action: 'Jump', player: 'player 2' })], [block('var.add', { variable: 'p2', value: '1' })]),
    ], [num('p1'), num('p2')]);
    d.inputPlayers = { 1: { device: 'keyboard' }, 2: { device: 'gamepad2' } };
    const rt = new Runtime(scene([]), d, { app: 'logiccraft' });
    rt.input.setGamepad(PAD([0]), [], 0, 1); rt.tick();
    expect([rt.globals.p1, rt.globals.p2]).toEqual([0, 1]);
    rt.input.setGamepad(PAD(), [], 0, 1); rt.input.keyDown('Space'); rt.tick();
    expect([rt.globals.p1, rt.globals.p2]).toEqual([1, 1]);
  });

  it('profiles and their tuning belong to one player; switching one player leaves the other', () => {
    const d = doc([
      event([block('system.every_tick')], [block('var.set', { variable: 'g1', value: 'actionvalue("Gas", 1)' }), block('var.set', { variable: 'g2', value: 'actionvalue("Gas", 2)' })]),
      event([block('input.action_began', { action: 'Swap', player: 'player 1' })], [block('input.change_profile', { profile: 'Lefty', player: 'player 1' })]),
    ], [num('g1'), num('g2')]);
    d.inputActions = { Gas: ['axis:RightY+'], Swap: ['Tab'], Jump: ['Space', 'pad:A'] };
    d.inputProfiles = { Lefty: { Gas: ['axis:LeftY+'] } };
    d.inputProfileTuning = { Lefty: { Gas: { sensitivity: 0.5 } } };
    d.inputPlayers = { 1: { device: 'all' }, 2: { device: 'gamepad2' } };
    const rt = new Runtime(scene([]), d, { app: 'logiccraft' });
    // Both pads push the right stick up fully.
    rt.input.setGamepad(PAD(), [0, 0, 0, -1], 0, 0); rt.input.setGamepad(PAD(), [0, 0, 0, -1], 0, 1); rt.tick();
    expect([rt.globals.g1, rt.globals.g2]).toEqual([1, 1]);
    rt.input.keyDown('Tab'); rt.tick(); rt.input.keyUp('Tab'); rt.tick();
    // Player 1 now uses Lefty (left stick, half sensitivity): the right stick no longer counts; player 2 unchanged.
    expect([rt.globals.g1, rt.globals.g2]).toEqual([0, 1]);
    rt.input.setGamepad(PAD(), [0, -1, 0, -1], 0, 0); rt.tick();
    expect(rt.globals.g1).toBeCloseTo(0.5);
    expect(d.inputActions.Gas).toEqual(['axis:RightY+']); // the project's actions were not rewritten
  });

  it('a movement behavior with Controls = player2 moves only with gamepad 2', () => {
    const d = doc([], [], 'xy');
    d.inputPlayers = { 1: { device: 'keyboard' }, 2: { device: 'gamepad2' } };
    const rt = new Runtime(scene([{ uid: 1, type: 'P2', name: 'P2', x: 0, y: 0, behaviors: [{ type: 'eightdir', props: { controls: 'player2' } }] } as any]), d, { app: 'logiccraft' });
    const p = rt.world.byUid.get(1)!;
    rt.input.keyDown('D'); for (let k = 0; k < 10; k++) rt.tick();
    expect(p.x).toBeCloseTo(0);
    rt.input.keyUp('D'); rt.input.setGamepad(PAD(), [1, 0, 0, 0], 0, 1); for (let k = 0; k < 10; k++) rt.tick();
    expect(p.x).toBeGreaterThan(0.5);
  });
});
