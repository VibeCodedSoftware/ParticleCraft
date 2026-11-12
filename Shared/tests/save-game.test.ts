// Saved games: Save game keeps the scene, globals and every game object (moved, destroyed, spawned, behavior state);
// Load game puts them back (in this scene, or after switching to the saved one); screen menus are left alone; the
// Pause menu pack's Save / Load / Quit buttons.
import { describe, expect, it } from 'vitest';
import { block, doc, event, num } from './helpers';
import { Runtime } from '../src/runtime/runtime';
import { emptyScene, makeInstance } from '../src/runtime/scene';
import { PACK_BY_ID, installPack } from '../src/packs';

const memory = () => { const m = new Map<string, string>(); return { get: (k: string) => m.get(k) ?? null, set: (k: string, v: string) => void m.set(k, v), m }; };

function level(name = 'Level 1') {
  const s = emptyScene(name, '2d');
  s.instances = [
    makeInstance(1, 'Player', 'box', { x: 0, y: 0, behaviors: [{ type: 'health', props: { maxHp: 100, hp: 100 } }] }),
    makeInstance(2, 'Coin', 'box', { x: 5, y: 0 }),
    makeInstance(3, 'Score', 'text', { text: { text: 'Paused', hud: true } as any, visible: false }),
  ];
  return s;
}

describe('save game', () => {
  it('saves and loads objects, variables and behavior state in the same scene', () => {
    const storage = memory();
    const d = doc([], [num('score')]);
    const rt = new Runtime(level(), d, { app: 'logiccraft', host: { storage } });
    const player = rt.world.byUid.get(1)!;
    player.x = 12; player.vars.keys = 3; rt.globals.score = 40;
    rt.damage(player, 30);
    rt.world.destroy(rt.world.byUid.get(2)!); rt.world.flushDestroyed();
    expect(rt.saveGame('slot A')).toBe(true);
    // Play on: move, score, the coin respawns somewhere, the menu text shows.
    player.x = -50; rt.globals.score = 0; rt.damage(player, 50);
    rt.world.spawn('Coin', 9, 9, 0);
    rt.world.byUid.get(3)!.visible = true;
    expect(rt.loadGame('slot A')).toBe(true);
    const p = rt.world.byUid.get(1)!;
    expect(p.x).toBe(12); expect(p.vars.keys).toBe(3); expect(rt.globals.score).toBe(40);
    expect(p.state.health.hp).toBe(70);
    expect(rt.world.of('Coin')).toHaveLength(0); // destroyed before saving, the later one is gone too
    expect(rt.world.byUid.get(3)!.visible).toBe(true); // menus are not part of a save
    expect(rt.hasSave('slot A')).toBe(true);
    rt.deleteSave('slot A');
    expect(rt.hasSave('slot A')).toBe(false);
    expect(rt.loadGame('slot A')).toBe(false);
  });

  it('a save of another scene switches scene and is applied there', () => {
    const storage = memory();
    const d = doc([event([block('game.on_game_loaded')], [block('var.set', { variable: 'loaded', value: '1' })])], [num('loaded')]);
    const opts = { app: 'logiccraft' as const, host: { storage }, sceneNames: ['Level 1', 'Level 2'] };
    const a = new Runtime(level('Level 2'), d, opts);
    a.world.byUid.get(1)!.x = 33;
    a.saveGame('save1');
    const b = new Runtime(level('Level 1'), d, opts);
    b.loadGame('save1');
    expect(b.restartRequested).toBe('Level 2');
    const c = new Runtime(level('Level 2'), d, { ...opts, carry: b.carry });
    c.tick();
    expect(c.world.byUid.get(1)!.x).toBe(33);
    expect(c.globals.loaded).toBe(1);
  });

  it('the Pause menu pack has working Save, Load and Quit buttons', () => {
    const storage = memory();
    const s = level();
    const d = doc([], []);
    installPack(d, undefined, s, PACK_BY_ID['menu.pause'], {}, { app: 'logiccraft', mode: '2d' });
    const names = s.instances.map((i) => i.type);
    for (const n of ['SaveButton', 'LoadButton', 'QuitButton']) expect(names).toContain(n);
    let quit = 0;
    const rt = new Runtime(s, d, { app: 'logiccraft', host: { storage, quit: () => { quit++; return true; } } });
    rt.tick();
    rt.world.byUid.get(1)!.x = 7;
    const click = (name: string) => { rt.input.uiButtons.push(name); rt.tick(); };
    click('SaveButton');
    expect(rt.hasSave('save1')).toBe(true);
    rt.world.byUid.get(1)!.x = 99;
    click('LoadButton');
    expect(rt.world.byUid.get(1)!.x).toBe(7);
    expect(rt.globals.paused).toBe(false);
    click('QuitButton');
    expect(quit).toBe(1);
  });
});
