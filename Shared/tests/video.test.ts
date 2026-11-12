// Cutscene video blocks: Play video, On video time, On video finished, wait, skip, pause, locked controls.
import { describe, expect, it } from 'vitest';
import { block, doc, event, num, scene } from './helpers';
import { Runtime } from '../src/runtime/runtime';
import { behaviorDefaults } from '../src/runtime/behaviors';

const ticks = (rt: Runtime, n: number) => { for (let i = 0; i < n; i++) rt.tick(); };
const add = (name: string) => [block('var.add', { variable: name, value: '1' })];
function game(events: ReturnType<typeof event>[], insts: any[] = []) {
  const d = doc(events, [num('t5'), num('end'), num('after'), num('n')]);
  d.videos = [{ name: 'Intro', ref: 'proj:videos/intro.mp4', duration: 3 }, { name: 'Outro', ref: 'proj:videos/outro.mp4', duration: 1 }];
  return new Runtime(scene(insts), d, { app: 'logiccraft' });
}

describe('cutscene video', () => {
  it('plays, fires timed events once, then "On video finished"', () => {
    const rt = game([
      event([block('system.on_start_of_layout')], [block('video.play', { video: 'Intro' })]),
      event([block('video.on_time', { video: 'Intro', seconds: '1.5' })], add('t5')),
      event([block('video.on_end', { video: '' })], add('end')),
    ]);
    ticks(rt, 30);
    expect(rt.ui.video?.name).toBe('Intro');
    expect(rt.globals.t5).toBe(0);
    ticks(rt, 62); // the video starts during the first tick
    expect(rt.globals.t5).toBe(1);
    ticks(rt, 120);
    expect(rt.globals.t5).toBe(1);
    expect(rt.globals.end).toBe(1);
    expect(rt.ui.video).toBeNull();
  });

  it('"Wait until it ends" runs the following actions after the video', () => {
    const rt = game([event([block('system.on_start_of_layout')], [block('video.play', { video: 'Outro', wait: true }), ...add('after')])]);
    ticks(rt, 30);
    expect(rt.globals.after).toBe(0);
    ticks(rt, 40);
    expect(rt.globals.after).toBe(1);
  });

  it('locks player controls while playing and the skip key ends it', () => {
    const rt = game([
      event([block('system.on_start_of_layout')], [block('video.play', { video: 'Intro', skip: 'Escape' })]),
      event([block('input.key_is_down', { key: 'D' })], add('n')),
      event([block('video.on_end', { video: 'Intro', skipped: true })], add('end')),
    ], [{ uid: 1, type: 'Player', behaviors: [{ type: 'eightdir', props: behaviorDefaults('eightdir') }] }]);
    ticks(rt, 2);
    rt.input.keyDown('D'); ticks(rt, 20);
    const p = rt.world.of('Player')[0];
    expect(p.x).toBe(0); // the cutscene has the controls
    expect(rt.globals.n).toBe(0);
    rt.input.keyDown('Escape'); rt.tick(); rt.input.keyUp('Escape');
    expect(rt.ui.video).toBeNull();
    expect(rt.globals.end).toBe(1);
    ticks(rt, 20);
    expect(p.x).toBeGreaterThan(0); // controls are back
  });

  it('pause stops the clock, stop removes it without "finished", loop repeats timed events', () => {
    const rt = game([
      event([block('system.on_start_of_layout')], [block('video.play', { video: 'Outro', loop: true })]),
      event([block('video.on_time', { video: 'Outro', seconds: '0.5' })], add('t5')),
      event([block('video.on_end')], add('end')),
    ]);
    ticks(rt, 60 * 3.2);
    expect(rt.globals.t5).toBe(3); // every loop
    rt.ui.video!.paused = true;
    const t = rt.ui.video!.time;
    ticks(rt, 30);
    expect(rt.ui.video!.time).toBe(t);
    rt.endVideo('stopped');
    ticks(rt, 2);
    expect(rt.globals.end).toBe(0);
    expect(rt.ui.video).toBeNull();
  });

  it('reports a video that is not in the Videos list', () => {
    const rt = game([event([block('system.on_start_of_layout')], [block('video.play', { video: 'Missing' })])]);
    ticks(rt, 2);
    expect(rt.errors.some((e) => e.message.includes('Missing'))).toBe(true);
  });
});
