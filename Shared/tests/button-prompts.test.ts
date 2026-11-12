// Device-adaptive button prompts: prompt("Jump"), {Action} placeholders in texts and the Interaction point's
// "Press E" follow the device in use, with each gamepad family's own button names.
import { describe, expect, it } from 'vitest';
import { block, doc, event, scene } from './helpers';
import { Runtime } from '../src/runtime/runtime';
import { buttonPrompt, padStyle } from '../src/runtime/input';

const PAD = (pressed: number[] = []) => Array.from({ length: 17 }, (_, k) => pressed.includes(k));
const str = (name: string) => ({ name, type: 'string' as const, value: '' });

describe('button prompts', () => {
  it('names buttons the way each device prints them', () => {
    const jump = ['Space', 'pad:A'];
    expect(buttonPrompt(jump, 'keyboard')).toBe('Space');
    expect(buttonPrompt(jump, 'gamepad', 'xbox')).toBe('A');
    expect(buttonPrompt(jump, 'gamepad', 'playstation')).toBe('Cross');
    expect(buttonPrompt(jump, 'gamepad', 'nintendo')).toBe('B');
    expect(buttonPrompt(['mouse:left', 'pad:RT'], 'mouse')).toBe('Left click');
    expect(buttonPrompt(['E', 'touch:Use'], 'touch')).toBe('Use');
    // No binding for the device: the keyboard one stands in.
    expect(buttonPrompt(['E'], 'gamepad')).toBe('E');
    expect(padStyle('Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 09cc)')).toBe('playstation');
    expect(padStyle('Xbox 360 Controller (XInput STANDARD GAMEPAD)')).toBe('xbox');
    expect(padStyle('Pro Controller (STANDARD GAMEPAD Vendor: 057e Product: 2009)')).toBe('nintendo');
  });

  it('prompt() and text placeholders switch when the player picks up a gamepad', () => {
    const d = doc([event([block('system.every_tick')], [block('var.set', { variable: 'p', value: 'prompt("Jump")' })])], [str('p')]);
    const rt = new Runtime(scene([{ uid: 1, type: 'Hint', name: 'Hint', kind: 'text', text: { text: 'Press {Jump} to start', hud: true } } as any]), d, { app: 'logiccraft' });
    const hint = rt.world.byUid.get(1)!;
    rt.input.keyDown('Space'); rt.tick(); rt.input.keyUp('Space'); rt.tick();
    expect(rt.globals.p).toBe('Space');
    expect(hint.text!.text).toBe('Press Space to start');
    rt.input.padIds[0] = 'DualSense Wireless Controller (Vendor: 054c)';
    rt.input.setGamepad(PAD([0]), [], 0, 0); rt.tick();
    expect(rt.globals.p).toBe('Cross');
    expect(hint.text!.text).toBe('Press Cross to start');
  });

  it('the Interaction point says the gamepad button and takes it', () => {
    const d = doc([event([block('interact.on_interact', {}, 'Door')], [block('var.add', { variable: 'n', value: '1' })])], [{ name: 'n', type: 'number', value: 0 }]);
    const rt = new Runtime(scene([
      { uid: 1, type: 'Player', name: 'Player', x: 0, y: 0 },
      { uid: 2, type: 'Door', name: 'Door', x: 1, y: 0, behaviors: [{ type: 'interactable', props: { who: 'Player', key: 'E', prompt: 'Press E to knock' } }] },
    ] as any), d, { app: 'logiccraft' });
    const door = rt.world.byUid.get(2)!;
    rt.tick();
    expect(door.state.bubble?.text).toBe('Press E to knock');
    rt.input.setGamepad(PAD([2]), [], 0, 0); rt.tick(); // pad X = Interact
    expect(rt.globals.n).toBe(1);
    rt.input.setGamepad(PAD(), [], 0, 0); for (let k = 0; k < 40; k++) rt.tick();
    expect(door.state.bubble?.text).toBe('Press X to knock');
  });
});
