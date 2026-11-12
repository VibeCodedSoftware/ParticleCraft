// P1: Universal Input — bindings across devices, analog values, device switching, contexts, touch controls.
import { describe, expect, it } from 'vitest';
import { block, doc, event, num, scene } from './helpers';
import { Runtime } from '../src/runtime/runtime';
import { InputState } from '../src/runtime/input';
import { TouchController, TOUCH_PRESETS, touchVisible, withTouchBindings } from '../src/touchControls';

const tick = (inp: InputState) => inp.endTick();

describe('universal input', () => {
  it('one action, many devices: keyboard, gamepads 1-4, stick directions, touch buttons, swipes and taps', () => {
    const inp = new InputState();
    const any = (bs: string[], s: 'held' | 'pressed' | 'released') => bs.some((b) => inp.binding(b, s));
    const jump = ['Space', 'pad:A', 'pad2:A', 'touch:Jump', 'swipe:up', 'tap'];
    inp.setGamepad(PAD(false), [], 0, 1); inp.setGamepad(PAD(true), [], 0, 1); // gamepad 2 presses A
    expect(any(jump, 'pressed')).toBe(true); expect(inp.device).toBe('gamepad'); tick(inp);
    inp.setGamepad(PAD(false), [], 0, 1); tick(inp); // let go of A on gamepad 2
    inp.touchDown('Jump'); expect(any(jump, 'pressed')).toBe(true); expect(inp.device).toBe('touch'); tick(inp);
    expect(any(jump, 'held')).toBe(true); inp.touchUp('Jump'); expect(inp.binding('touch:Jump', 'released')).toBe(true); tick(inp);
    inp.swipe('up'); expect(any(jump, 'pressed')).toBe(true); expect(any(jump, 'held')).toBe(false); tick(inp);
    inp.tap(); expect(inp.binding('tap', 'pressed')).toBe(true); tick(inp); expect(inp.binding('tap', 'pressed')).toBe(false);
    inp.keyDown('Space'); expect(inp.device).toBe('keyboard');
  });

  it('stick directions work as buttons with exact pressed / released edges, and give analog values', () => {
    const inp = new InputState();
    const left = 'axis:LeftX-';
    inp.setGamepad(PAD(false), [-0.3, 0, 0, 0]); inp.track([left]);
    expect(inp.binding(left, 'held')).toBe(false); expect(inp.bindingValue(left)).toBeCloseTo(0.3); tick(inp);
    inp.setGamepad(PAD(false), [-0.9, 0, 0, 0]); inp.track([left]);
    expect(inp.binding(left, 'pressed')).toBe(true); expect(inp.bindingValue(left)).toBeCloseTo(0.9); tick(inp);
    inp.track([left]); expect(inp.binding(left, 'pressed')).toBe(false); expect(inp.binding(left, 'held')).toBe(true); tick(inp);
    inp.setGamepad(PAD(false), [0, 0, 0, 0]); inp.track([left]); expect(inp.binding(left, 'released')).toBe(true);
  });

  it('runtime: action value, device expression, device-changed trigger and contexts', () => {
    const d = doc([
      event([block('input.on_device_changed', { device: 'gamepad' })], [block('var.add', { variable: 'switched', value: '1' })]),
      event([block('input.action_held', { action: 'Jump' })], [block('var.add', { variable: 'jumps', value: '1' })]),
      event([block('system.every_tick')], [block('var.set', { variable: 'gas', value: 'actionvalue("Gas")' })]),
    ], [num('switched'), num('jumps'), num('gas')]);
    d.inputActions = { Jump: ['Space', 'pad:A'], Gas: ['axis:RightY+', 'touch:Gas'] };
    d.inputContexts = { Gameplay: ['Jump'], Menu: [] };
    const rt = new Runtime(scene([]), d, { app: 'gamecraft' });
    rt.input.keyDown('Space'); rt.tick(); expect(rt.globals.jumps).toBe(1);
    rt.input.setGamepad(PAD(false), [0, 0, 0, -0.6]); rt.tick(); expect(rt.globals.switched).toBe(1); expect(rt.globals.gas).toBeCloseTo(0.6);
    rt.setInputContext('Menu', true, true); rt.tick(); expect(rt.globals.jumps).toBe(2); // the tick before took effect first
    rt.tick(); expect(rt.globals.jumps).toBe(2); // Jump belongs to Gameplay, which is off now
    rt.setInputContext('Gameplay', true); rt.tick(); expect(rt.globals.jumps).toBe(3);
  });
});

describe('touch controls', () => {
  const screen = () => ({ w: 1000, h: 500 });
  it('joystick drives Horizontal / Vertical and stick bindings; buttons press their action; release resets', () => {
    const inp = new InputState(), lay = TOUCH_PRESETS.platformer.layout();
    const c = new TouchController(inp, lay, screen);
    const st = lay.elements.find((e) => e.kind === 'stick')!, jb = lay.elements.find((e) => e.id === 'Jump')!;
    c.down(1, st.x * 1000, st.y * 500); c.move(1, st.x * 1000 + 70, st.y * 500);
    expect(inp.axis('Horizontal')).toBeGreaterThan(0.8); expect(inp.bindingValue('touchstick:X+')).toBeGreaterThan(0.8);
    c.down(2, jb.x * 1000, jb.y * 500); expect(inp.binding('touch:Jump', 'pressed')).toBe(true);
    c.up(1, 0, 0); c.up(2, 0, 0); expect(inp.axis('Horizontal')).toBe(0); expect(inp.binding('touch:Jump', 'released')).toBe(true);
  });

  it('free area: drag looks around (like the mouse), quick flicks swipe, quick touches tap', () => {
    const inp = new InputState(), c = new TouchController(inp, { ...TOUCH_PRESETS.fps.layout(), swipes: true }, screen);
    c.down(1, 600, 200, 0); c.move(1, 640, 190); expect(inp.mouse.dx).toBe(40); expect(inp.mouse.dy).toBe(-10); c.up(1, 640, 190, 1000);
    inp.endTick();
    c.down(2, 600, 250, 0); c.up(2, 450, 255, 120); expect(inp.touch.swipes).toEqual(['left']);
    c.down(3, 600, 250, 0); c.up(3, 602, 251, 90); expect(inp.touch.taps).toBe(1);
  });

  it('presets add touch bindings to the actions without losing the others; visibility follows the device', () => {
    const a = withTouchBindings({ Jump: ['Space'], Fire: ['mouse:left'] }, 'platformer');
    expect(a.Jump).toEqual(['Space', 'touch:Jump']); expect(a.Fire).toEqual(['mouse:left']); expect(a.Left).toContain('touchstick:X-');
    const lay = TOUCH_PRESETS.platformer.layout();
    expect(touchVisible(lay, false, 'keyboard')).toBe(false);
    expect(touchVisible(lay, true, 'keyboard')).toBe(true);
    expect(touchVisible({ ...lay, enabled: 'always' }, false, 'keyboard')).toBe(true);
    expect(touchVisible({ ...lay, enabled: 'off' }, true, 'touch')).toBe(false);
  });
});

function PAD(a: boolean) { return [a, ...Array(16).fill(false)]; }
