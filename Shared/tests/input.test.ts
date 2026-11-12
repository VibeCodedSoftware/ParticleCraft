// Input conditions: pressed fires once, held stays true, released fires once; mouse, gamepad, actions, axes.
import { describe, expect, it } from 'vitest';
import { block, doc, event, num, scene } from './helpers';
import { Runtime } from '../src/runtime/runtime';
import { keyFromEvent } from '../src/runtime/input';

const counter = (cond: ReturnType<typeof block>, v = 'n') => event([cond], [block('var.add', { variable: v, value: '1' })]);
function make(events: any[]) {
  return new Runtime(scene([]), doc(events, [num('n'), num('m'), num('k')]), { app: 'logiccraft' });
}

describe('key names from keyboard events', () => {
  it('Shift does not change which key it is, so presses and releases always match', () => {
    expect(keyFromEvent({ key: '!', code: 'Digit1' })).toBe('1');
    expect(keyFromEvent({ key: 'A', code: 'KeyA' })).toBe('A');
    expect(keyFromEvent({ key: 'a', code: 'KeyA' })).toBe('A');
    expect(keyFromEvent({ key: ' ', code: 'Space' })).toBe('Space');
    expect(keyFromEvent({ key: 'ArrowLeft', code: 'ArrowLeft' })).toBe('ArrowLeft');
    expect(keyFromEvent({ key: 'Shift', code: 'ShiftRight' })).toBe('Shift');
    const rt = make([counter(block('input.key_pressed', { key: '1' }), 'n'), counter(block('input.key_released', { key: '1' }), 'k')]);
    rt.input.keyDown('Shift');
    rt.input.keyDown(keyFromEvent({ key: '!', code: 'Digit1' })); rt.tick();
    rt.input.keyUp('Shift');
    rt.input.keyUp(keyFromEvent({ key: '1', code: 'Digit1' })); rt.tick();
    expect(rt.globals.n).toBe(1);
    expect(rt.globals.k).toBe(1);
    expect(rt.input.down.has('1')).toBe(false);
  });
});

describe('Input conditions', () => {
  it('key: pressed once, held every tick, released once', () => {
    const rt = make([counter(block('input.key_pressed', { key: 'Space' }), 'n'), counter(block('input.key_is_down', { key: 'Space' }), 'm'), counter(block('input.key_released', { key: 'Space' }), 'k')]);
    rt.input.keyDown(' ');
    for (let i = 0; i < 10; i++) { rt.input.keyDown(' '); rt.tick(); } // key repeat must not re-press
    rt.input.keyUp(' '); rt.tick(); rt.tick();
    expect(rt.globals.n).toBe(1);
    expect(rt.globals.m).toBe(10);
    expect(rt.globals.k).toBe(1);
  });

  it('mouse pressed / released and the On released trigger', () => {
    const rt = make([counter(block('input.mouse_pressed', { button: 'left' }), 'n'), counter(block('input.mouse_released', { button: 'left' }), 'm'), counter(block('input.on_mouse_released', { button: 'left' }), 'k')]);
    rt.input.mouseDown('left'); rt.tick(); rt.tick(); rt.input.mouseUp('left'); rt.tick(); rt.tick();
    expect([rt.globals.n, rt.globals.m, rt.globals.k]).toEqual([1, 1, 1]);
  });

  it('gamepad buttons, actions spanning devices, and axes', () => {
    const rt = make([counter(block('input.gamepad_pressed', { button: 'A' }), 'n'), counter(block('input.action_began', { action: 'Jump' }), 'm'), counter(block('input.axis_compare', { axis: 'Horizontal', op: '>', value: '0.5' }), 'k')]);
    const pad = (a: boolean, x = 0) => rt.input.setGamepad([a], [x, 0, 0, 0]);
    pad(true); rt.tick(); pad(true); rt.tick(); pad(false); rt.tick();
    expect(rt.globals.n).toBe(1);
    expect(rt.globals.m).toBe(1); // Jump = Space or pad A
    rt.input.keyDown(' '); rt.tick(); rt.input.keyUp(' ');
    expect(rt.globals.m).toBe(2);
    pad(false, 0.9); rt.tick(); rt.tick();
    expect(rt.globals.k).toBe(2);
    rt.input.keyDown('D'); pad(false, 0); rt.tick();
    expect(rt.globals.k).toBe(3); // keyboard drives the same axis
    expect(rt.evaluate('Input.Horizontal', rt.baseCtx())).toBe(1);
  });

  it('project-defined actions replace the defaults', () => {
    const d = doc([counter(block('input.action_held', { action: 'Fire' }))], [num('n')]);
    d.inputActions = { Fire: ['F'] };
    const rt = new Runtime(scene([]), d, { app: 'logiccraft' });
    rt.input.mouseDown('left'); rt.tick();
    expect(rt.globals.n).toBe(0);
    rt.input.keyDown('f'); rt.tick();
    expect(rt.globals.n).toBe(1);
  });
});
