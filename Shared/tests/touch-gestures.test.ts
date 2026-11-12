// Touch gestures on the free part of the screen: tap / double tap, long press, drag start / end, two-finger pinch and
// pan (never taps), touched objects (touched / held / released / double-tapped) through a pick function, the blocks
// that react to them, pinch zoom on the camera, and the new layouts.
import { describe, expect, it } from 'vitest';
import { block, doc, event, num, scene } from './helpers';
import { Runtime } from '../src/runtime/runtime';
import { InputState } from '../src/runtime/input';
import { TouchController, TOUCH_PRESETS, type TouchLayout } from '../src/touchControls';
import { makeInstance } from '../src/runtime/scene';

const layout = (patch: Partial<TouchLayout> = {}): TouchLayout => ({ enabled: 'always', preset: '', elements: [], look: false, swipes: true, opacity: 0.5, ...patch });
const screen = () => ({ w: 1000, h: 600 });

describe('touch gestures', () => {
  it('tap, then a second tap close by is a double tap', () => {
    const inp = new InputState(), c = new TouchController(inp, layout(), screen);
    c.down(1, 500, 300, 0); c.up(1, 500, 300, 80);
    expect(inp.touch.taps).toBe(1);
    c.down(2, 505, 302, 200); c.up(2, 505, 302, 260);
    expect(inp.touch.gestures).toEqual(['doubletap']);
  });
  it('a finger held still is a long press (once), and no tap when it lifts', () => {
    const inp = new InputState(), c = new TouchController(inp, layout({ longPressMs: 400 }), screen);
    c.down(1, 300, 300, 0); c.update(200); expect(inp.touch.gestures).toEqual([]);
    c.update(450); c.update(900); expect(inp.touch.gestures).toEqual(['longpress']);
    c.up(1, 300, 300, 1000); expect(inp.touch.taps).toBe(0);
  });
  it('dragging: drag start once it moves, drag end when it lifts; points are tracked by finger', () => {
    const inp = new InputState(), c = new TouchController(inp, layout({ swipes: false }), screen);
    c.down(7, 100, 100, 0); expect(inp.touch.points.get(7)).toEqual({ x: 100, y: 100 });
    c.move(7, 160, 100); expect(inp.touch.gestures).toEqual(['dragstart']);
    c.up(7, 200, 100, 800); expect(inp.touch.gestures).toEqual(['dragstart', 'dragend']); expect(inp.touch.points.size).toBe(0);
  });
  it('two fingers: pinch spreads (+) and pans the midpoint; never taps or looks', () => {
    const inp = new InputState(), c = new TouchController(inp, layout({ look: true }), screen);
    c.down(1, 400, 300, 0); c.down(2, 600, 300, 10);
    c.move(1, 350, 300); c.move(2, 650, 310);
    expect(inp.touch.pinch).toBeGreaterThan(0.2);
    expect(inp.touch.look).toEqual([0, 0]);
    c.up(1, 350, 300, 100); c.up(2, 650, 310, 110);
    expect(inp.touch.taps).toBe(0);
    inp.endTick();
    c.down(1, 300, 300, 1000); c.down(2, 500, 300, 1010); c.move(1, 320, 400); c.move(2, 520, 400);
    expect(inp.touch.pan[1]).toBeGreaterThan(50);
  });
  it('touched objects through pick, and the blocks: On object touched / held, On gesture, pinch zoom', () => {
    const box = makeInstance(5, 'Card', 'box', {});
    const d = doc([
      event([block('touch.on_object', { state: 'touched' }, 'Card')], [block('var.add', { variable: 'touched', value: '1' })]),
      event([block('touch.on_object', { state: 'held' }, 'Card')], [block('var.add', { variable: 'held', value: '1' })]),
      event([block('touch.on_object', { state: 'double-tapped' }, 'Card')], [block('var.add', { variable: 'dbl', value: '1' })]),
      event([block('touch.on_gesture', { gesture: 'double tap' })], [block('var.add', { variable: 'g2', value: '1' })]),
      event([block('touch.on_gesture', { gesture: 'pinch' })], [block('var.set', { variable: 'pin', value: 'pinch' })]),
    ], [num('touched'), num('held'), num('dbl'), num('g2'), num('pin')]);
    d.touchControls = layout({ pinchZoom: true });
    const rt = new Runtime(scene([box]), d, { app: 'logiccraft' });
    const c = new TouchController(rt.input, d.touchControls, screen, (x) => (x < 500 ? 5 : null));
    c.down(1, 100, 100, 0); rt.tick();
    c.update(600); rt.tick();
    c.up(1, 100, 100, 700); rt.tick();
    expect([rt.globals.touched, rt.globals.held]).toEqual([1, 1]);
    c.down(1, 100, 100, 1000); c.up(1, 100, 100, 1050); c.down(1, 100, 100, 1150); c.up(1, 100, 100, 1200); rt.tick();
    expect([rt.globals.dbl, rt.globals.g2]).toEqual([1, 1]);
    c.down(2, 600, 300, 2000); c.down(3, 800, 300, 2010); c.move(2, 500, 300); c.move(3, 900, 300); rt.tick();
    expect(rt.globals.pin).toBeGreaterThan(0.5);
    expect(rt.camera.zoom).toBeGreaterThan(1.5);
  });
  it('layouts: third person (pinch zoom), first-person shooter and driving controls', () => {
    expect(TOUCH_PRESETS.thirdperson.layout().pinchZoom).toBe(true);
    expect(TOUCH_PRESETS.fps.layout().elements.map((e) => e.id)).toEqual(expect.arrayContaining(['Fire', 'Aim', 'Reload', 'Crouch', 'Switch', 'Jump']));
    expect(Object.keys(TOUCH_PRESETS.racing.bindings)).toEqual(expect.arrayContaining(['Handbrake', 'Gear up', 'Gear down']));
    const inp = new InputState(); inp.gesture('longpress');
    expect(inp.binding('gesture:longpress', 'pressed')).toBe(true);
  });
});
