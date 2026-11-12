// Follow path bricks (routes drawn on the brick), camera views, and the microphone / webcam bricks.
import { afterEach, describe, expect, it } from 'vitest';
import { block, doc, event, num, scene } from './helpers';
import { Runtime } from '../src/runtime/runtime';
import { behaviorDefaults } from '../src/runtime/behaviors';
import { editPathInDoc, findPathInDoc, readPaths, writePaths } from '../src/blocks/pathParam';
import { BLOCK_DEFS, blockSentence } from '../src/blocks/definitions';
import { mic, stopDevices, webcam } from '../src/runtime/devices';

const bh = (type: string, props: Record<string, any> = {}) => ({ type, props: { ...behaviorDefaults(type), ...props } });
const ticks = (rt: Runtime, n: number) => { for (let i = 0; i < n; i++) rt.tick(); };
const monster = { uid: 1, type: 'Monster', kind: 'box' as const, x: 0, y: 0.5, z: 0, sx: 1, sy: 1, sz: 1, behaviors: [] };
const paths = (...r: [number, number, number][][]) => writePaths({ id: 'path_t', paths: r });
const A: [number, number, number][] = [[3, 0.5, 0]], B: [number, number, number][] = [[0, 0.5, -3]];
const follow = (o: Record<string, any> = {}) => block('path.follow', { paths: paths(A, B), pick: 'first', speed: '10', mode: 'stop', wait: '0', face: true, ...o }, 'Monster');
const onStart = (...acts: any[]) => event([block('system.on_start_of_layout')], acts);

describe('Follow path', () => {
  it('walks a route drawn on the brick, with no behavior on the object, and says when it is done', () => {
    const rt = new Runtime(scene([monster], '3d'), doc([onStart(follow()), event([block('path.on_end', {}, 'Monster')], [block('var.add', { variable: 'n', value: '1' })])], [num('n')], 'xz'), { app: 'gamecraft' });
    ticks(rt, 60);
    const m = rt.world.of('Monster')[0];
    expect(m.x).toBeCloseTo(3, 1);
    expect(rt.globals.n).toBe(1);
  });
  it('random picks between paths, seen by Is on path number; in order takes turns', () => {
    const seen = new Set<number>();
    for (let seed = 1; seed < 40 && seen.size < 2; seed++) {
      const rt = new Runtime(scene([monster], '3d'), doc([onStart(follow({ pick: 'random' }))], [], 'xz'), { app: 'gamecraft' });
      rt.reseed(seed); ticks(rt, 2);
      seen.add(rt.world.of('Monster')[0].state.pathBrick.number);
    }
    expect([...seen].sort()).toEqual([1, 2]);
    const rt = new Runtime(scene([monster], '3d'), doc([event([block('input.on_key_pressed', { key: 'K' })], [follow({ pick: 'in order' })])], [], 'xz'), { app: 'gamecraft' });
    const press = () => { rt.input.keyDown('K'); rt.tick(); rt.input.keyUp('K'); rt.tick(); return rt.world.of('Monster')[0].state.pathBrick.number; };
    expect([press(), press(), press()]).toEqual([1, 2, 1]);
  });
  it('Stop halts it and Is following turns false', () => {
    const rt = new Runtime(scene([monster], '3d'), doc([onStart(follow({ speed: '0.5' })), event([block('input.on_key_pressed', { key: 'K' })], [block('path.stop', {}, 'Monster')]), event([block('path.is_following', {}, 'Monster')], [block('var.set', { variable: 'f', value: '1' })])], [num('f')], 'xz'), { app: 'gamecraft' });
    ticks(rt, 3); expect(rt.globals.f).toBe(1);
    rt.input.keyDown('K'); rt.tick(); rt.input.keyUp('K');
    const x = rt.world.of('Monster')[0].x; ticks(rt, 20);
    expect(rt.world.of('Monster')[0].x).toBe(x);
  });
  it('the brick reads "2 drawn paths", and a path can be found and edited in the document by its id', () => {
    expect(blockSentence(BLOCK_DEFS['path.follow'], { paths: paths(A, B), pick: 'random', speed: '1', mode: 'stop', wait: '0' }, 'Monster')).toContain('2 drawn paths');
    const d = doc([event([], [follow()], [event([], [block('path.follow', { paths: writePaths({ id: 'path_deep', paths: [] }) }, 'Monster')])] as any)], [], 'xz');
    expect(editPathInDoc(d as any, 'path_deep', (v) => { v.paths.push([[1, 2, 3]]); })).toBe(true);
    expect(findPathInDoc(d as any, 'path_deep')!.paths).toEqual([[[1, 2, 3]]]);
    expect(readPaths('nonsense').paths).toEqual([]);
  });
});

describe('Camera views', () => {
  const cam = (uid: number, name: string, active = false) => ({ uid, type: 'Cam', name, kind: 'camera' as const, x: uid, y: 2, z: 0, behaviors: [], camera: { active, focalLength: 35, clipStart: 0.1, clipEnd: 100 } });
  it('next wraps round, a number and a name switch, and the view-changed trigger runs', () => {
    const rt = new Runtime(scene([cam(1, 'Hall', true), cam(2, 'Door'), cam(3, 'Vent')] as any, '3d'), doc([
      event([block('input.on_key_pressed', { key: 'N' })], [block('camera.view_step', { direction: 'next', group: '' })]),
      event([block('input.on_key_pressed', { key: 'P' })], [block('camera.view_step', { direction: 'previous', group: '' })]),
      event([block('input.on_key_pressed', { key: 'T' })], [block('camera.view_number', { number: '3', group: '' })]),
      event([block('input.on_key_pressed', { key: 'H' })], [block('camera.view_named', { name: 'Hall' })]),
      event([block('camera.on_view_changed')], [block('var.add', { variable: 'n', value: '1' })]),
      event([block('camera.view_is', { number: '2', group: '' })], [block('var.set', { variable: 'two', value: '1' })]),
    ], [num('n'), num('two')], 'xz'), { app: 'gamecraft' });
    const showing = () => rt.world.instances.find((i) => i.camera?.active)?.name;
    const press = (k: string) => { rt.input.keyDown(k); rt.tick(); rt.input.keyUp(k); rt.tick(); };
    rt.tick(); expect(showing()).toBe('Hall');
    press('N'); expect(showing()).toBe('Door'); expect(rt.globals.two).toBe(1);
    press('T'); expect(showing()).toBe('Vent');
    press('N'); expect(showing()).toBe('Hall');
    press('P'); expect(showing()).toBe('Vent');
    press('H'); expect(showing()).toBe('Hall');
    expect(rt.globals.n).toBe(5);
  });
});

describe('Microphone and webcam bricks', () => {
  afterEach(() => stopDevices());
  it('without a device, starting says it was refused and the game carries on', async () => {
    const rt = new Runtime(scene([monster], '3d'), doc([onStart(block('mic.start', { threshold: '30' })), event([block('mic.on_denied')], [block('var.set', { variable: 'no', value: '1' })])], [num('no')], 'xz'), { app: 'gamecraft' });
    ticks(rt, 2); await Promise.resolve(); ticks(rt, 3);
    expect(mic.state).toBe('unavailable');
    expect(rt.globals.no).toBe(1);
  });
  it('a noise fires once until it dies down, and Microphone.Level reads the level', () => {
    const rt = new Runtime(scene([monster], '3d'), doc([
      event([block('mic.on_noise')], [block('var.add', { variable: 'n', value: '1' })]),
      event([block('system.every_tick')], [block('var.set', { variable: 'lv', value: 'Microphone.Level' })]),
      event([block('mic.level_is', { op: '>', value: '50' })], [block('var.set', { variable: 'loud', value: '1' })]),
    ], [num('n'), num('lv'), num('loud')], 'xz'), { app: 'gamecraft' });
    mic.state = 'on'; mic.threshold = 30; mic.level = 0; ticks(rt, 3);
    mic.level = 60; ticks(rt, 3);
    expect(rt.globals.n).toBe(1); expect(rt.globals.lv).toBe(60); expect(rt.globals.loud).toBe(1);
    ticks(rt, 30); expect(rt.globals.n).toBe(1); // still loud: not again
    mic.level = 5; ticks(rt, 30); mic.level = 60; ticks(rt, 3);
    expect(rt.globals.n).toBe(2);
  });
  it('webcam movement fires once; Show on object is remembered until the webcam stops', () => {
    const rt = new Runtime(scene([monster], '3d'), doc([
      onStart(block('webcam.show_on', { on: true }, 'Monster')),
      event([block('webcam.on_motion')], [block('var.add', { variable: 'n', value: '1' })]),
    ], [num('n')], 'xz'), { app: 'gamecraft' });
    webcam.state = 'on'; webcam.threshold = 15; webcam.motion = 0; ticks(rt, 3);
    expect(webcam.shownOn.has(1)).toBe(true);
    webcam.motion = 40; ticks(rt, 5);
    expect(rt.globals.n).toBe(1);
    webcam.stop();
    expect(webcam.shownOn.size).toBe(0); expect(webcam.state).toBe('off');
  });
});
