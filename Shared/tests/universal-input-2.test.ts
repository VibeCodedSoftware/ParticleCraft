// Universal Input, round 2: per-action tuning (deadzone, curves, sensitivity, toggle), the device-free movement /
// look vectors, rebinding and profiles while playing, turning a device off, connect / disconnect events, binding
// conflicts, profile files, and VR haptics requests.
import { describe, expect, it } from 'vitest';
import { block, doc, event, num, scene } from './helpers';
import { Runtime } from '../src/runtime/runtime';
import { InputState, bindingConflicts, deviceOf, parseInputProfile, tuneValue } from '../src/runtime/input';
import { ACTIONS } from '../src/runtime/blockImpl';

const PAD = (a: boolean) => Array.from({ length: 17 }, (_, k) => k === 0 && a);

describe('universal input, round 2', () => {
  it('tuning: deadzone rescales, curves shape, sensitivity scales', () => {
    expect(tuneValue(0.1, { deadzone: 0.2 })).toBe(0);
    expect(tuneValue(0.6, { deadzone: 0.2 })).toBeCloseTo(0.5);
    expect(tuneValue(0.5, { curve: 'precise' })).toBeCloseTo(0.25);
    expect(tuneValue(0.25, { curve: 'aggressive' })).toBeCloseTo(0.5);
    expect(tuneValue(0.5, { curve: 'smooth' })).toBeCloseTo(0.5);
    expect(tuneValue(0.5, { sensitivity: 2 })).toBeCloseTo(1);
  });
  it('a toggle action switches on and off with each press; actionvalue uses the tuning', () => {
    const d = doc([
      event([block('input.action_held', { action: 'Crouch' })], [block('var.add', { variable: 'crouched', value: '1' })]),
      event([block('system.every_tick')], [block('var.set', { variable: 'gas', value: 'actionvalue("Gas")' })]),
    ], [num('crouched'), num('gas')]);
    d.inputActions = { Crouch: ['C'], Gas: ['axis:RightY+'] };
    d.inputTuning = { Crouch: { mode: 'toggle' }, Gas: { deadzone: 0.2 } };
    const rt = new Runtime(scene([]), d, { app: 'logiccraft' });
    rt.input.keyDown('C'); rt.tick(); rt.input.keyUp('C'); rt.tick(); rt.tick();
    expect(rt.globals.crouched).toBe(3); // still on after letting go
    rt.input.keyDown('C'); rt.tick(); rt.input.keyUp('C'); rt.tick();
    expect(rt.globals.crouched).toBe(3); // pressed again: off
    rt.input.setGamepad(PAD(false), [0, 0, 0, -0.6]); rt.tick();
    expect(rt.globals.gas).toBeCloseTo(0.5);
  });
  it('movement and look vectors: the same numbers from keys, gamepad and touch; length at most 1', () => {
    const d = doc([event([block('system.every_tick')], [block('var.set', { variable: 'mx', value: 'movex' }), block('var.set', { variable: 'my', value: 'movey' }), block('var.set', { variable: 'lx', value: 'lookx' })])], [num('mx'), num('my'), num('lx')]);
    const rt = new Runtime(scene([]), d, { app: 'logiccraft' });
    rt.input.keyDown('D'); rt.input.keyDown('W'); rt.tick();
    expect(Math.hypot(rt.globals.mx as number, rt.globals.my as number)).toBeCloseTo(1);
    expect(rt.globals.mx).toBeCloseTo(Math.SQRT1_2);
    rt.input.keyUp('D'); rt.input.keyUp('W');
    rt.input.setGamepad(PAD(false), [-0.5, 0, 0.8, 0]); rt.tick();
    expect(rt.globals.mx).toBeCloseTo(-0.5); expect(rt.globals.lx).toBeCloseTo(0.8);
    rt.input.setGamepad(PAD(false), [0, 0, 0, 0]); rt.input.setTouchStick(0, 1); rt.tick();
    expect(rt.globals.my).toBeCloseTo(1);
  });
  it('blocks: rebind while playing, change profile, turn a device off', () => {
    const d = doc([
      event([block('input.action_began', { action: 'Jump' })], [block('var.add', { variable: 'jumps', value: '1' })]),
    ], [num('jumps')]);
    d.inputActions = { Jump: ['Space'] };
    d.inputProfiles = { Lefty: { Jump: ['J'] } };
    const rt = new Runtime(scene([]), d, { app: 'logiccraft' });
    const act = (name: string, params: Record<string, string>) => ACTIONS[name](rt, block(name, params) as any, {} as any, undefined as any);
    act('input.set_binding', { how: 'replace', action: 'Jump', binding: 'K' });
    rt.input.keyDown('Space'); rt.tick(); rt.input.keyUp('Space');
    rt.input.keyDown('K'); rt.tick(); rt.input.keyUp('K');
    expect(rt.globals.jumps).toBe(1);
    act('input.change_profile', { profile: 'lefty' });
    rt.input.keyDown('J'); rt.tick(); rt.input.keyUp('J');
    expect(rt.globals.jumps).toBe(2);
    act('input.enable_device', { device: 'keyboard', state: 'off' });
    rt.input.keyDown('J'); rt.tick(); rt.input.keyUp('J');
    expect(rt.globals.jumps).toBe(2);
    act('input.enable_device', { device: 'keyboard', state: 'on' });
    rt.tick(); rt.input.keyDown('J'); rt.tick();
    expect(rt.globals.jumps).toBe(3);
  });
  it('connect / disconnect events for gamepads', () => {
    const d = doc([
      event([block('input.on_device_connected', { device: 'gamepad' })], [block('var.add', { variable: 'on', value: '1' })]),
      event([block('input.on_device_disconnected', { device: 'gamepad 1' })], [block('var.add', { variable: 'off', value: '1' })]),
    ], [num('on'), num('off')]);
    const rt = new Runtime(scene([]), d, { app: 'logiccraft' });
    rt.tick();
    rt.input.setGamepad(PAD(false)); rt.tick();
    expect(rt.globals.on).toBe(1);
    rt.input.setGamepad(null); rt.tick();
    expect(rt.globals.off).toBe(1);
  });
  it('conflicts: one binding in two actions is reported unless they are in different contexts', () => {
    const acts = { Jump: ['Space', 'pad:A'], Confirm: ['Space'], Fire: ['mouse:left'] };
    expect(bindingConflicts(acts)).toEqual([{ binding: 'Space', actions: ['Jump', 'Confirm'] }]);
    expect(bindingConflicts(acts, { Gameplay: ['Jump'], Menu: ['Confirm'] })).toEqual([]);
    expect(bindingConflicts({ Grab: ['xr:any:grip'], Release: ['xr:any:grip'] })).toEqual([]); // deliberate pair
    expect(['pad2:A', 'axis:LeftX-', 'touch:Jump', 'swipe:up', 'xr:left:grip', 'mouse:left', 'Space'].map(deviceOf)).toEqual(['gamepad', 'gamepad', 'touch', 'touch', 'vr', 'mouse', 'keyboard']);
  });
  it('profile files: valid ones parse, others explain why', () => {
    const ok = parseInputProfile(JSON.stringify({ format: 'craft.input-profile', version: 1, name: 'Arcade', actions: { Jump: ['pad:B'] } }));
    expect(typeof ok === 'object' && ok.name).toBe('Arcade');
    expect(parseInputProfile('{')).toMatch(/JSON/);
    expect(parseInputProfile(JSON.stringify({ format: 'x' }))).toMatch(/Not an input profile/);
    expect(parseInputProfile(JSON.stringify({ format: 'craft.input-profile', actions: { Jump: [1] } }))).toMatch(/no valid actions/);
  });
  it('VR haptics: requests queue per hand (both = two), capped', () => {
    const inp = new InputState();
    inp.vibrate('both', 2, 50);
    expect(inp.xr.haptics).toEqual([{ hand: 'left', strength: 1, ms: 50 }, { hand: 'right', strength: 1, ms: 50 }]);
    for (let k = 0; k < 30; k++) inp.vibrate('left', 0.1, 10);
    expect(inp.xr.haptics.length).toBe(16);
  });
});
