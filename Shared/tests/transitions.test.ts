// Scene transitions and events: Cover / Uncover screen without changing scene (On screen covered, On transition
// finished), transition styles and colours carried into the next scene, On entering scene (from a named scene),
// loading a scene while the screen is covered, and On dialogue line for one line id.
import { describe, expect, it } from 'vitest';
import { block, doc, event, num, scene } from './helpers';
import { Runtime } from '../src/runtime/runtime';
import { transitionLook } from '../src/runtime/story';
import { resolveDialogueLook } from '../src/dialogueStyle';
import { renamePictureRefs } from '../ui/logicOps';

const ticks = (rt: Runtime, n: number) => { for (let i = 0; i < n; i++) rt.tick(); };

describe('screen transitions', () => {
  it('Cover screen: covered → teleport → Uncover screen → finished', () => {
    const d = doc([
      event([block('system.on_start_of_layout')], [block('game.cover_screen', { transition: 'iris', duration: '0.2', color: '#102030' })]),
      event([block('game.on_screen_covered')], [block('var.add', { variable: 'covered', value: '1' }), block('game.uncover_screen', { duration: '0.2' })]),
      event([block('game.on_transition_done')], [block('var.add', { variable: 'done', value: '1' })]),
    ], [num('covered'), num('done')]);
    const rt = new Runtime(scene([]), d, { app: 'logiccraft' });
    rt.tick();
    expect(rt.ui.transition).toMatchObject({ phase: 'out', style: 'iris', color: '#102030', screenOnly: true });
    ticks(rt, 14);
    expect(rt.globals.covered).toBe(1);
    expect(rt.restartRequested).toBeUndefined(); // no scene change
    ticks(rt, 16);
    expect(rt.globals.done).toBe(1);
    expect(rt.transitionAlpha()).toBe(0);
    expect(rt.ui.transition).toBeNull();
  });
  it('Screen is covered holds until uncovered', () => {
    const rt = new Runtime(scene([]), doc([]), { app: 'logiccraft' });
    rt.coverScreen('fade', 0.1);
    ticks(rt, 10);
    expect(rt.ui.transition?.phase).toBe('hold');
    expect(rt.transitionAlpha()).toBe(1);
    ticks(rt, 60);
    expect(rt.transitionAlpha()).toBe(1); // still covered
  });
  it('a scene change carries its style and colour; On entering scene from a named scene', () => {
    const d = doc([
      event([block('system.on_start_of_layout'), block('game.scene_is', { scene: 'Town' })], [block('game.load_scene', { scene: 'House', transition: 'wipe', duration: '0.2', color: '#ffcc00' })]),
      event([block('game.on_scene_enter', { from: 'Town' })], [block('var.set', { variable: 'door', value: '1' })]),
      event([block('game.on_scene_enter', { from: 'Shop' })], [block('var.set', { variable: 'door', value: '2' })]),
      event([block('game.on_scene_enter')], [block('var.add', { variable: 'entered', value: '1' })]),
    ], [num('door'), num('entered')]);
    const town = scene([]); town.name = 'Town';
    const rt = new Runtime(town, d, { app: 'logiccraft', sceneNames: ['Town', 'House'] });
    rt.tick();
    expect(rt.ui.transition).toMatchObject({ phase: 'out', style: 'wipe', color: '#ffcc00' });
    expect(rt.globals.entered).toBe(1); // the first scene is entered too (from nowhere)
    expect(rt.globals.door).toBe(0);
    for (let i = 0; i < 20 && rt.restartRequested === undefined; i++) rt.tick();
    const house = scene([]); house.name = 'House';
    const next = new Runtime(house, d, { app: 'logiccraft', sceneNames: ['Town', 'House'], carry: rt.carry });
    expect(next.ui.transition).toMatchObject({ phase: 'in', style: 'wipe', color: '#ffcc00' });
    next.tick();
    expect(next.globals.door).toBe(1);
  });
  it('loading a scene while the screen is covered switches at once', () => {
    const one = scene([]); one.name = 'One';
    const rt = new Runtime(one, doc([]), { app: 'logiccraft', sceneNames: ['One', 'Two'] });
    rt.coverScreen('curtain', 0.1); ticks(rt, 10);
    rt.changeScene('Two', { transition: 'fade' });
    expect(rt.restartRequested).toBe('Two');
  });
  it('older blocks still work: fade-white is a white fade', () => {
    expect(transitionLook('fade-white')).toEqual({ style: 'fade', color: '#ffffff' });
    expect(transitionLook('fade')).toEqual({ style: 'fade', color: '#000000' });
    expect(transitionLook('iris', 'red')).toEqual({ style: 'iris', color: '#000000' }); // only #hex colours
  });
});

describe('your own transitions and dialogue looks', () => {
  it('shape / map transitions use pictures by name, carried into the next scene with the cover', () => {
    const d = doc([event([block('system.on_start_of_layout')], [block('game.load_scene', { scene: 'Two', transition: 'shape', duration: '0.2', picture: 'Star Logo', cover: 'Stripes' })])]);
    d.pictures = [{ name: 'Star_Logo', ref: 'proj:pictures/star.png' }, { name: 'Stripes', ref: 'proj:pictures/stripes.png' }];
    d.pictures[0].name = 'Star Logo';
    const one = scene([]); one.name = 'One';
    const rt = new Runtime(one, d, { app: 'logiccraft', sceneNames: ['One', 'Two'] });
    rt.tick();
    expect(rt.ui.transition).toMatchObject({ style: 'shape', shape: 'proj:pictures/star.png', cover: 'proj:pictures/stripes.png' });
    for (let i = 0; i < 20 && rt.restartRequested === undefined; i++) rt.tick();
    const two = scene([]); two.name = 'Two';
    const next = new Runtime(two, d, { app: 'logiccraft', sceneNames: ['One', 'Two'], carry: rt.carry });
    expect(next.ui.transition).toMatchObject({ phase: 'in', style: 'shape', shape: 'proj:pictures/star.png', cover: 'proj:pictures/stripes.png' });
  });
  it('every preset resolves; a missing picture is reported', () => {
    for (const k of ['wipe', 'curtain', 'blinds', 'iris', 'diamond', 'star', 'heart', 'dissolve', 'shape', 'map']) expect(transitionLook(k).style).toBe(k);
    const warns: string[] = [];
    const rt = new Runtime(scene([]), doc([]), { app: 'logiccraft', sceneNames: ['A'], host: { log: (l, m) => { if (l === 'warn') warns.push(m); } } });
    rt.changeScene('A', { transition: 'map', picture: 'Nope' });
    expect(warns.join()).toMatch(/"Nope" is not in the Pictures list/);
  });
  it('dialogue look: a preset with overrides; renaming a picture updates blocks and the look', () => {
    expect(resolveDialogueLook({ preset: 'parchment' }).textColor).toBe('#3b2a12');
    const L = resolveDialogueLook({ preset: 'pixel', textColor: '#ff0000', font: 'serif' });
    expect(L.textColor).toBe('#ff0000'); expect(L.font).toMatch(/Georgia/); expect(L.radius).toBe('0');
    const d = doc([event([block('system.on_start_of_layout')], [block('game.cover_screen', { transition: 'shape', picture: 'Logo', cover: 'logo' })])]);
    d.dialogueStyle = { preset: 'dark', boxPicture: 'Logo', portraitFrame: 'Ring', portraits: { Guard: 'logo' } };
    renamePictureRefs(d, 'logo', 'Badge');
    const b = (d.sheets[0].events[0] as any).actions[0];
    expect([b.params.picture, b.params.cover]).toEqual(['Badge', 'Badge']);
    expect(d.dialogueStyle).toMatchObject({ boxPicture: 'Badge', portraitFrame: 'Ring', portraits: { Guard: 'Badge' } });
  });
});

describe('dialogue line events', () => {
  it('On dialogue line with a line id runs on that line only', () => {
    const d = doc([
      event([block('dialogue.on_line', { line: 'b' })], [block('var.add', { variable: 'hits', value: '1' })]),
      event([block('dialogue.on_line')], [block('var.add', { variable: 'lines', value: '1' })]),
    ], [num('hits'), num('lines')]);
    d.dialogues = [{ id: 'd1', name: 'Talk', start: 'a', nodes: [
      { id: 'a', speaker: 'Ann', text: 'Hi', choices: [], next: 'b' },
      { id: 'b', speaker: 'Ann', text: 'Bye', choices: [], end: true },
    ] } as any];
    const rt = new Runtime(scene([]), d, { app: 'logiccraft' });
    rt.tick();
    rt.dialogueStart('Talk'); rt.tick();
    expect([rt.globals.lines, rt.globals.hits]).toEqual([1, 0]);
    rt.dialogueContinue(); rt.tick();
    expect([rt.globals.lines, rt.globals.hits]).toEqual([2, 1]);
  });
});
