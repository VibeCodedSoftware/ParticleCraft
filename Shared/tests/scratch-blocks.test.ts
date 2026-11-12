// Scratch-style blocks: per-second movement, glide, mouse, random position, edge bounce, size, costumes,
// say/think, wait until, repeat until, forever and ask-and-wait.
import { describe, expect, it } from 'vitest';
import { block, doc, event, num, run, scene, str } from './helpers';

const start = () => block('system.on_start_of_layout');
const forever = () => block('system.forever');
const cat = (o: Record<string, any> = {}) => scene([{ type: 'Cat', name: 'Cat', kind: 'sprite', sprite: { image: '🐱', frames: 1, fps: 1, animation: '', costumes: ['🐱', '🐶', '🐸'] }, ...o }]);

describe('Scratch-style blocks', () => {
  it('turn and move per second need no dt', () => {
    const { rt } = run(doc([event([forever()], [block('object.rotate_per_second', { degrees: '90' }, 'Cat'), block('object.move_per_second', { speed: '3' }, 'Cat')])]), cat(), 60);
    const c = rt.world.of('Cat')[0];
    expect(Math.abs(c.rz - 90)).toBeLessThan(2); // one second at 90°/s
    expect(Math.hypot(c.x, c.y)).toBeGreaterThan(1.5); // moved about 3 m along its turning heading
  });

  it('glide reaches the target in the given time', () => {
    const { rt } = run(doc([event([start()], [block('object.glide_to', { x: '4', y: '2', z: '0', seconds: '0.5' }, 'Cat')])]), cat(), 40);
    const c = rt.world.of('Cat')[0];
    expect(c.x).toBeCloseTo(4, 3); expect(c.y).toBeCloseTo(2, 3);
  });

  it('point toward mouse, go to random position, bounce off edge', () => {
    const { rt } = run(doc([]), cat(), 1);
    const c = rt.world.of('Cat')[0];
    rt.input.mouse.x = 0; rt.input.mouse.y = 5;
    rt.loadLogic(doc([event([forever()], [block('object.point_toward_mouse', {}, 'Cat')])])); rt.tick();
    expect(c.rz).toBeCloseTo(90, 3);
    rt.loadLogic(doc([event([start()], [block('object.go_random', {}, 'Cat')])]));
    // Bounce: heading right into the right edge turns around and stays inside.
    c.x = 9.9; c.y = 0; c.rz = 0;
    rt.loadLogic(doc([event([forever()], [block('object.bounce_on_edge', {}, 'Cat')])])); rt.tick();
    expect(Math.abs(c.rz)).toBeCloseTo(180, 3);
    expect(c.x + Math.abs(c.sx) / 2).toBeLessThanOrEqual(10.0001);
  });

  it('change / set size and costumes', () => {
    const { rt } = run(doc([event([start()], [block('object.change_size', { percent: '50' }, 'Cat'), block('sprite.next_costume', {}, 'Cat')])]), cat({ sx: 2, sy: 2 }), 1);
    const c = rt.world.of('Cat')[0];
    expect(c.sx).toBeCloseTo(3); expect(c.sprite!.image).toBe('🐶');
    rt.loadLogic(doc([event([forever()], [block('object.set_size', { percent: '100' }, 'Cat'), block('sprite.set_costume', { costume: '3' }, 'Cat')])])); rt.tick();
    expect(c.sx).toBeCloseTo(2); expect(c.sprite!.image).toBe('🐸');
  });

  it('say / think bubbles appear and expire', () => {
    const { rt } = run(doc([event([start()], [block('looks.say', { text: '"Hi"', seconds: '0.5' }, 'Cat')])]), cat(), 1);
    const c = rt.world.of('Cat')[0];
    expect(c.state.bubble).toMatchObject({ kind: 'say', text: 'Hi' });
    for (let i = 0; i < 40; i++) rt.tick();
    expect(c.state.bubble.until).toBeLessThan(rt.time);
  });

  it('wait until pauses across frames; repeat until loops within one', () => {
    const d = doc([
      event([start()], [block('system.wait_until', { condition: 'n >= 30' }), block('var.set', { variable: 'done', value: '1' })]),
      event([forever()], [block('var.add', { variable: 'n', value: '1' })]),
      event([start(), block('system.repeat_until', { condition: 'k >= 5' })], [block('var.add', { variable: 'k', value: '1' })]),
    ], [num('n'), num('done'), num('k')]);
    const { rt } = run(d, cat(), 10);
    expect(rt.globals.k).toBe(5);
    expect(rt.globals.done).toBe(0);
    for (let i = 0; i < 30; i++) rt.tick();
    expect(rt.globals.done).toBe(1);
  });

  it('loose blocks on the canvas never run until a trigger is attached', () => {
    const looseEv = { ...event([], [block('var.add', { variable: 'n', value: '1' })]), loose: true };
    const looseIf = { ...event([block('system.every_tick')], [block('var.add', { variable: 'm', value: '1' })]), loose: true };
    const d = doc([looseEv, looseIf], [num('n'), num('m')]);
    const { rt } = run(d, cat(), 5);
    expect(rt.globals.n).toBe(0);
    expect(rt.globals.m).toBe(0);
    // Attaching a trigger (loose = false) makes them run.
    looseEv.loose = false; looseEv.conditions.unshift(block('system.forever'));
    rt.loadLogic(d); for (let i = 0; i < 5; i++) rt.tick();
    expect(rt.globals.n).toBe(5);
  });

  it('ask and wait stores the answer, then continues', () => {
    const d = doc([event([start()], [block('ui.ask', { question: '"Name?"', variable: 'answer' }), block('var.set', { variable: 'greeting', value: '"Hi " & answer' })])], [str('greeting')]);
    const { rt } = run(d, cat(), 3);
    expect(rt.ui.ask?.question).toBe('Name?');
    expect(rt.globals.greeting).toBe('');
    rt.ui.ask!.answer = 'Ada';
    rt.tick();
    expect(rt.ui.ask ?? null).toBeNull();
    expect(rt.globals.answer).toBe('Ada');
    expect(rt.globals.greeting).toBe('Hi Ada');
  });
});
