// A LogicCraft scene joining a GameCraft project: everything comes across, and nothing already there changes.
import { describe, expect, it } from 'vitest';
import { block, doc, event } from './helpers';
import { deepClone } from '../src/schema';
import { emptyScene, makeInstance } from '../src/runtime/scene';
import { Runtime } from '../src/runtime/runtime';
import { dataUrlBytes, isSceneFile, makeScenePackage, mergeScenePackage, packageAssets, parseScenePackage, projectFilesUsed, scenePackageFileName } from '../src/scenePackage';
import { DEFAULT_ACTIONS } from '../src/runtime/input';
import { validateDocument } from '../src/validate';

const PNG = 'data:image/png;base64,iVBORw0KGgo=';

function source() {
  const stage = emptyScene('Stage', '2d');
  stage.instances = [
    makeInstance(1, 'Hero', 'sprite', { sprite: { image: 'img:hero.png', frames: 2, fps: 4, animation: '', costumes: ['img:hero.png', '🙂'] } }),
    makeInstance(2, 'Face', 'sprite', { sprite: { image: '🙂', frames: 1, fps: 1, animation: '' } }),
    makeInstance(3, 'Sign', 'text', { text: { text: 'Hi', size: 20, color: '#fff', anchor: 'tl', align: 'left', hud: true, style: { bgImage: 'img:hero.png' } } as never }),
    makeInstance(4, 'Blob', 'sprite', { sprite: { image: 'proc:slime', frames: 1, fps: 1, animation: '' } }),
  ];
  const logic = doc([event([block('system.on_start_of_layout')], [block('game.load_scene', { scene: '"Level"' }), block('sprite.set_costume', { costume: '"🙂"' }, 'Hero'), block('var.set', { variable: 'score', value: '5' })])], [{ name: 'score', type: 'number', value: 7 } as never, { name: 'lives', type: 'number', value: 3 } as never]);
  stage.sheetId = logic.sheets[0].id;
  const level = emptyScene('Level', '2d'); level.sheetId = logic.sheets[0].id;
  return { name: 'My Game!', logic, stage, scenes: [stage, level], images: { 'hero.png': PNG }, particlePresets: { puff: { rate: 1 } as never, smoke: { rate: 9 } as never } };
}
function project() {
  const s = emptyScene('Stage', '3d');
  s.instances = [makeInstance(1, 'Truck', 'box', {})];
  const logic = doc([event([block('system.on_start_of_layout')], [block('var.set', { variable: 'score', value: '1' })])], [{ name: 'score', type: 'number', value: 100 } as never]);
  s.sheetId = logic.sheets[0].id;
  return { logic, scenes: [s], particlePresets: { smoke: { rate: 1 } as never } };
}
const merge = (t: ReturnType<typeof project>, src = source()) => {
  const pkg = parseScenePackage(JSON.stringify(makeScenePackage(src)));
  return { pkg, r: mergeScenePackage(t, pkg, (ref) => 'proj:new/' + encodeURIComponent(ref)) };
};

describe('the package file', () => {
  it('holds the stage first, then the other scenes once each', () => {
    const p = makeScenePackage(source());
    expect(p.scenes.map((s) => s.name)).toEqual(['Stage', 'Level']);
    expect(p.images['hero.png']).toBe(PNG);
  });
  it('refuses other files, and newer versions', () => {
    expect(() => parseScenePackage('{"format":"craft.logic.package"}')).toThrow(/not a scene/);
    expect(() => parseScenePackage(JSON.stringify({ ...makeScenePackage(source()), schemaVersion: 99 }))).toThrow(/newer/);
  });
  it('has a safe name the other lists can tell apart', () => {
    expect(scenePackageFileName('My Game!')).toBe('My_Game_.scene.json');
    expect(isSceneFile('My_Game_.scene.json')).toBe(true);
    expect(isSceneFile('My.logiccraft.logic.json')).toBe(false);
  });
  it('finds the project files it has to carry', () => {
    const s = source();
    s.stage.instances[0].sprite!.image = 'proj:videos/a b.png'.replace(' ', '_');
    (s.logic as any).videos = [{ name: 'Intro', file: 'proj:videos/intro.mp4' }];
    expect(projectFilesUsed(s).sort()).toEqual(['videos/a_b.png', 'videos/intro.mp4']);
    expect(projectFilesUsed(source())).toEqual([]);
  });
});

describe('what becomes a file', () => {
  it('pictures and each emoji once, in a folder of their own', () => {
    const a = packageAssets(parseScenePackage(makeScenePackage(source())));
    expect(a.map((x) => x.ref).sort()).toEqual(['img:hero.png', '🙂'].sort());
    expect(a.find((x) => x.ref === 'img:hero.png')!.rel).toBe('imported/logiccraft/My_Game_/hero.png');
    expect(a.find((x) => x.emoji)!.rel).toMatch(/emoji_1f642\.png$/);
  });
  it('leaves built-in sprites alone', () => {
    expect(packageAssets(makeScenePackage(source())).some((x) => x.ref.startsWith('proc:'))).toBe(false);
  });
  it('reads the bytes of a picture', () => {
    expect(new Uint8Array(dataUrlBytes('data:image/png;base64,AQID'))).toEqual(new Uint8Array([1, 2, 3]));
  });
});

describe('adding to a project', () => {
  it('nothing the project already had changes', () => {
    const t = project(), before = deepClone({ scene: t.scenes[0], sheet: t.logic.sheets[0], score: t.logic.globals[0], smoke: t.particlePresets.smoke });
    merge(t);
    expect(t.scenes[0]).toEqual(before.scene);
    expect(t.logic.sheets[0]).toEqual(before.sheet);
    expect(t.logic.globals.find((g) => g.name === 'score')).toEqual(before.score);
    expect(t.particlePresets.smoke).toEqual(before.smoke);
  });
  it('the scenes arrive with their objects, 2D in a 3D project, and run their own sheet', () => {
    const t = project();
    const { r } = merge(t);
    expect(t.scenes).toHaveLength(3);
    const added = t.scenes.find((s) => s.id === r.sceneIds[0])!;
    expect(added.mode).toBe('2d');
    expect(added.plane).toBe('xy');
    expect(added.instances.map((i) => i.type)).toEqual(['Hero', 'Face', 'Sign', 'Blob']);
    expect(added.sheetId).toBe(t.logic.sheets[1].id);
    expect(added.sheetId).not.toBe(t.scenes[0].sheetId);
  });
  it('a scene with no sheet set still runs its own, not the first in the project', () => {
    const t = project(), s = source();
    delete s.stage.sheetId;
    const { r } = merge(t, s);
    expect(t.scenes.find((x) => x.id === r.sceneIds[0])!.sheetId).toBe(t.logic.sheets[1].id);
  });
  it('picture references all follow, wherever they are', () => {
    const t = project();
    const { r } = merge(t);
    const [hero, face, sign, blob] = t.scenes.find((s) => s.id === r.sceneIds[0])!.instances;
    const pic = 'proj:new/' + encodeURIComponent('img:hero.png'), smile = 'proj:new/' + encodeURIComponent('🙂');
    expect(hero.sprite!.image).toBe(pic);
    expect(hero.sprite!.costumes).toEqual([pic, smile]);
    expect(face.sprite!.image).toBe(smile);
    expect(sign.text!.style!.bgImage).toBe(pic);
    expect(blob.sprite!.image).toBe('proc:slime');
    expect(JSON.stringify(t.logic.sheets[1])).toContain(`\\"${smile}\\"`);
  });
  it('the same scene name gets a new one, and Load scene follows', () => {
    const t = project();
    const { r } = merge(t);
    expect(r.renamedScenes).toEqual([['Stage', 'Stage 2']]);
    expect(t.scenes.map((s) => s.name)).toEqual(['Stage', 'Stage 2', 'Level']);
    const t2 = project(); t2.scenes[0].name = 'Level';
    merge(t2);
    expect(JSON.stringify(t2.logic.sheets[1])).toContain('\\"Level 2\\"');
  });
  it('added twice: two independent copies with nothing clashing', () => {
    const t = project();
    merge(t); merge(t);
    expect(t.scenes.map((s) => s.name)).toEqual(['Stage', 'Stage 2', 'Level', 'Stage 3', 'Level 2']);
    expect(new Set(t.scenes.map((s) => s.id)).size).toBe(5);
    expect(new Set(t.logic.sheets.map((s) => s.id)).size).toBe(3);
    const ids = JSON.stringify(t.logic.sheets).match(/"id":"[^"]+"/g)!;
    expect(new Set(ids).size).toBe(ids.length);
  });
  it('says what it kept', () => {
    const { r } = merge(project());
    expect(r.keptVariables).toEqual(['score']);
    expect(r.keptEffects).toEqual(['smoke']);
  });
  it('new variables and effects are added', () => {
    const t = project();
    merge(t);
    expect(t.logic.globals.map((g) => g.name)).toEqual(['score', 'lives']);
    expect(Object.keys(t.particlePresets).sort()).toEqual(['puff', 'smoke']);
  });
  it('custom controls are added without taking the defaults from other scenes', () => {
    const t = project(), s = source();
    s.logic.inputActions = { Dance: ['K'] };
    merge(t, s);
    expect(t.logic.inputActions!.Dance).toEqual(['K']);
    for (const k of Object.keys(DEFAULT_ACTIONS)) expect(t.logic.inputActions![k]).toBeTruthy();
  });
  it('checking one scene looks only at its own sheet: another scene\'s objects are not errors', () => {
    const t = project();
    t.logic.sheets[0].events = [event([block('system.on_start_of_layout')], [block('object.set_visible', { visible: 'true' }, 'Truck')])];
    const { r } = merge(t);
    const scene = t.scenes.find((s) => s.id === r.sceneIds[0])!;
    const types = scene.instances.map((i) => ({ name: i.type, vars: [], behaviors: [] }));
    const missing = (o: { app: 'gamecraft'; types: typeof types; sheetId?: string }) => validateDocument(t.logic, o).filter((i) => /Truck/.test(i.message));
    expect(missing({ app: 'gamecraft', types }).length).toBeGreaterThan(0);
    expect(missing({ app: 'gamecraft', types, sheetId: scene.sheetId })).toEqual([]);
  });
  it('the merged project really runs the new scene', () => {
    const t = project();
    const { r } = merge(t);
    const rt = new Runtime(t.scenes.find((s) => s.id === r.sceneIds[0])!, t.logic, { app: 'gamecraft' });
    rt.tick();
    expect(rt.world.plane).toBe('xy');
    expect(rt.world.instances.some((i) => i.type === 'Hero')).toBe(true);
  });
});
