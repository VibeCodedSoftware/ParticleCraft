// Portrait / landscape touch layouts: an upright phone uses the portrait controls (when the layout has them), a
// sideways one the landscape controls; the controller hits whichever set the screen's shape picks.
import { describe, expect, it } from 'vitest';
import { InputState } from '../src/runtime/input';
import { TOUCH_PRESETS, TouchController, elementsFor, portraitFrom, touchVisible } from '../src/touchControls';

describe('touch layouts by orientation', () => {
  it('picks the portrait set only on a tall screen that has one', () => {
    const l = TOUCH_PRESETS.platformer.layout();
    expect(elementsFor(l, 800, 400)).toBe(l.elements);
    expect(elementsFor(l, 400, 800)).toBe(l.elements); // no portrait set yet
    l.portrait = portraitFrom(l.elements);
    expect(elementsFor(l, 400, 800)).toBe(l.portrait);
    expect(elementsFor(l, 800, 400)).toBe(l.elements);
    // Made from landscape: same controls, moved into the lower part of the screen.
    expect(l.portrait.map((e) => e.id)).toEqual(l.elements.map((e) => e.id));
    expect(l.portrait.every((e) => e.y >= 0.6)).toBe(true);
  });

  it('a button pressed where it sits in each orientation', () => {
    const l = TOUCH_PRESETS.platformer.layout();
    l.portrait = [{ id: 'stick', kind: 'stick', x: 0.25, y: 0.85, size: 0.3 }, { id: 'Jump', kind: 'button', x: 0.8, y: 0.85, size: 0.2, label: 'Jump' }];
    let size = { w: 400, h: 800 };
    const inp = new InputState();
    const ctl = new TouchController(inp, l, () => size);
    ctl.down(1, 0.8 * 400, 0.85 * 800); // portrait Jump
    expect(inp.touch.down.has('Jump')).toBe(true);
    ctl.up(1, 0.8 * 400, 0.85 * 800);
    size = { w: 800, h: 400 };
    const j = l.elements.find((e) => e.id === 'Jump')!;
    ctl.down(2, j.x * 800, j.y * 400); // landscape Jump
    expect(inp.touch.down.has('Jump')).toBe(true);
  });

  it('a layout with only portrait controls still shows', () => {
    const l = { ...TOUCH_PRESETS.swipe.layout(), swipes: false, portrait: [{ id: 'Jump', kind: 'button' as const, x: 0.5, y: 0.9, size: 0.2 }] };
    expect(touchVisible(l, true, 'touch')).toBe(true);
  });
});
