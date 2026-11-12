// Player Lock-On / Dash Attack: targeting rules, the dash through a real scene, attacks, events, saves, the pack.
import { describe, expect, it } from 'vitest';
import { block, doc, event } from './helpers';
import { Runtime } from '../src/runtime/runtime';
import { ACTIONS } from '../src/runtime/blockImpl';
import { emptyScene, makeInstance } from '../src/runtime/scene';
import { behaviorDefaults } from '../src/runtime/behaviors';
import { lockCandidates, lockOf, setLock, startDash } from '../src/runtime/lockon';
import { PACK_BY_ID, installPack, packDefaults } from '../src/packs';
import { BLOCK_DEFS } from '../src/blocks/definitions';

const memory = () => { const m = new Map<string, string>(); return { get: (k: string) => m.get(k) ?? null, set: (k: string, v: string) => void m.set(k, v), m }; };

const bh = (type: string, props: any = {}) => ({ type, props: { ...behaviorDefaults(type), ...props } });
const body = (s = 0.6, h = 1.8) => ({ shape: 'box' as const, size: [s, h, s] as [number, number, number], offset: [0, h / 2, 0] as [number, number, number] });

function setup(extra: any[] = [], events: any[] = [], globals: any[] = []) {
  const scene = emptyScene('Arena', '3d');
  scene.instances = [
    makeInstance(1, 'Floor', 'box', { y: -0.5, sx: 60, sz: 60, behaviors: [bh('solid')] }),
    makeInstance(2, 'Player', 'box', { x: 0, ry: 0, collider: body(), behaviors: [bh('eightdir', { maxSpeed: 5 })] }), // faces +X
    makeInstance(3, 'Enemy', 'box', { x: 8, collider: body(), tags: ['red'], behaviors: [bh('health', { maxHp: 100, hp: 100 })] }),
    makeInstance(4, 'Enemy', 'box', { x: 5, z: 1, collider: body(), tags: ['blue'], behaviors: [bh('health', { maxHp: 40, hp: 40 })] }),
    makeInstance(5, 'Enemy', 'box', { x: -6, collider: body(), behaviors: [bh('health', { maxHp: 100, hp: 100 })] }), // behind the player
    ...extra,
  ];
  const rt = new Runtime(scene, doc(events, globals), { app: 'gamecraft' });
  rt.tick();
  const p = rt.world.byUid.get(2)!, e8 = rt.world.byUid.get(3)!, e5 = rt.world.byUid.get(4)!, back = rt.world.byUid.get(5)!;
  return { rt, p, e8, e5, back, run: (s: number) => { for (let k = 0; k < s * 60; k++) rt.tick(); } };
}
const wall = (x: number) => makeInstance(9, 'Wall', 'box', { x, y: 2, sx: 0.4, sy: 4, sz: 20, behaviors: [bh('solid')] });
const act = (id: string, params: any, target = 'Player') => block(id, params, target);
const onStart = (...a: any[]) => event([block('system.on_start_of_layout')], a);

describe('targeting', () => {
  it('picks the nearest in range and in the view cone, ignoring the one behind', () => {
    const t = setup([], [onStart(act('lockon.acquire', { targets: 'Enemy', tag: '' }))]);
    t.run(0.05);
    expect(lockOf(t.p).target).toBe(4);
    lockOf(t.p).angle = 360;
    expect(lockCandidates(t.rt, t.p).map((c) => c.uid).sort()).toEqual([3, 4, 5]);
  });

  it('range, tags, priority and line of sight all count', () => {
    const t = setup();
    const st = lockOf(t.p); st.type = 'Enemy'; st.range = 6;
    expect(lockCandidates(t.rt, t.p).map((c) => c.uid)).toEqual([4]);
    st.range = 20; st.tag = 'red';
    expect(lockCandidates(t.rt, t.p).map((c) => c.uid)).toEqual([3]);
    st.tag = '';
    const blocked = setup([wall(3)]);
    const b = lockOf(blocked.p); b.type = 'Enemy';
    expect(lockCandidates(blocked.rt, blocked.p)).toEqual([]);
    b.los = false;
    expect(lockCandidates(blocked.rt, blocked.p).length).toBe(2);
    // Priority: lowest health, then highest.
    const pr = setup([], [event([block('system.on_start_of_layout')], [act('lockon.set_priority', { priority: 'highest health' }), act('lockon.acquire', { targets: 'Enemy', tag: '' })])]);
    pr.run(0.05);
    expect(lockOf(pr.p).target).toBe(3);
  });

  it('fires acquired, changed and lost; a killed target is lost', () => {
    const fired: Record<string, number> = {};
    const count = (id: string) => event([block('lockon.' + id, {}, 'Player')], [block('var.add', { variable: id, value: '1' })]);
    const names = ['on_target_acquired', 'on_target_changed', 'on_target_lost'];
    const t = setup([], names.map(count), names.map((n) => ({ name: n, type: 'number', value: 0 })));
    setLock(t.rt, t.p, t.e8); t.run(0.05);
    setLock(t.rt, t.p, t.e5); t.run(0.05);
    t.e5.state.health.dead = true; t.run(0.05);
    for (const n of names) fired[n] = t.rt.globals[n];
    expect(fired).toEqual({ on_target_acquired: 1, on_target_changed: 1, on_target_lost: 1 });
    expect(lockOf(t.p).target).toBeNull();
  });

  it('switching goes around the candidates and comes back', () => {
    const t = setup([], [event([block('system.compare_values', { a: 'go', op: '=', b: '1' })], [act('lockon.switch', { direction: 'next' }), block('var.set', { variable: 'go', value: '0' })])], [{ name: 'go', type: 'number', value: 0 }]);
    const st = lockOf(t.p); st.type = 'Enemy'; st.angle = 360;
    const seen: (number | null)[] = [];
    for (let k = 0; k < 4; k++) { t.rt.globals.go = 1; t.run(0.05); seen.push(st.target); }
    expect(new Set(seen).size).toBe(3);
    expect(seen[3]).toBe(seen[0]);
  });
});

describe('dash and attack', () => {
  const events = (names: string[]) => names.map((id) => event([block('lockon.' + id, {}, 'Player')], [block('var.add', { variable: id, value: '1' })]));
  const defs = (names: string[]) => names.map((n) => ({ name: n, type: 'number', value: 0 }));
  const all = ['on_dash_started', 'on_dash_completed', 'on_dash_cancelled', 'on_attack_started', 'on_attack_completed', 'on_attack_hit', 'on_attack_missed'];

  it('stops at attack distance and attacks exactly once', () => {
    const t = setup([], events(all), defs(all));
    setLock(t.rt, t.p, t.e8);
    expect(startDash(t.rt, t.p)).toBe(true);
    t.run(0.05);
    expect(lockOf(t.p).dash).toBeTruthy();
    t.run(1);
    expect(t.rt.world.planarDistance(t.p, t.e8)).toBeCloseTo(1.6, 1);
    expect(t.e8.state.health.hp).toBe(75);
    t.run(2);
    expect(t.e8.state.health.hp).toBe(75); // one attack unless repeat is on
    expect(t.rt.globals.on_dash_started).toBe(1);
    expect(t.rt.globals.on_dash_completed).toBe(1);
    expect(t.rt.globals.on_attack_hit).toBe(1);
    expect(t.rt.globals.on_attack_started).toBe(1);
    expect(t.rt.globals.on_attack_completed).toBe(1);
    expect(t.rt.globals.on_dash_cancelled).toBe(0);
  });

  it('repeat attacks while in reach, when turned on', () => {
    const t = setup();
    const st = lockOf(t.p); st.repeat = true; st.repeatEvery = 0.5;
    setLock(t.rt, t.p, t.e8); startDash(t.rt, t.p);
    t.run(2);
    expect(t.e8.state.health.hp).toBeLessThan(50);
  });

  it('never goes through a wall: the dash stops and is cancelled', () => {
    const t = setup([wall(4)], events(all), defs(all));
    const st = lockOf(t.p); st.los = false; // locked through the wall on purpose
    setLock(t.rt, t.p, t.e8); startDash(t.rt, t.p);
    t.run(1.5);
    expect(t.p.x).toBeLessThan(3.8);
    expect(st.dash).toBeNull();
    expect(t.rt.globals.on_dash_cancelled).toBe(1);
    expect(t.rt.globals.on_attack_started).toBe(0);
    expect(t.e8.state.health.hp).toBe(100);
  });

  it('a target removed in mid dash cancels safely', () => {
    const t = setup([], events([...all, 'on_target_lost']), defs([...all, 'on_target_lost']));
    setLock(t.rt, t.p, t.e8); startDash(t.rt, t.p);
    t.run(0.1);
    const x = t.p.x;
    t.rt.world.destroy(t.e8);
    t.run(0.5);
    expect(lockOf(t.p).dash).toBeNull();
    expect(lockOf(t.p).target).toBeNull();
    expect(t.rt.globals.on_dash_cancelled).toBe(1);
    expect(t.rt.globals.on_target_lost).toBe(1);
    expect(t.rt.globals.on_attack_started).toBe(0);
    expect(t.p.x).toBeLessThan(x + 1); // it stops there
  });

  it('cooldown, cancel, and limits', () => {
    const t = setup();
    const st = lockOf(t.p); st.cooldown = 1;
    expect(startDash(t.rt, t.p)).toBe(false); // no target
    setLock(t.rt, t.p, t.e8);
    expect(startDash(t.rt, t.p)).toBe(true);
    expect(startDash(t.rt, t.p)).toBe(false); // under way
    t.run(0.1);
    // The Cancel dash block stops it where it is, and the cooldown keeps running.
    ACTIONS['lockon.cancel_dash'](t.rt, block('lockon.cancel_dash'), {} as any, t.p);
    expect(st.dash).toBeNull();
    const x = t.p.x;
    t.run(0.1);
    expect(t.p.x).toBeCloseTo(x);
    expect(startDash(t.rt, t.p)).toBe(false); // cooling down
    t.run(1);
    expect(startDash(t.rt, t.p)).toBe(true);
    // Out of road: a short dash distance ends the dash early, with no attack.
    const short = setup();
    const sst = lockOf(short.p); sst.distance = 2;
    setLock(short.rt, short.p, short.e8); startDash(short.rt, short.p);
    short.run(1);
    expect(sst.dash).toBeNull();
    expect(short.p.x).toBeLessThan(2.6);
    expect(short.e8.state.health.hp).toBe(100);
  });

  it('the movement behaviour does not fight the dash', () => {
    const t = setup();
    t.rt.input.keyDown?.('ArrowLeft');
    setLock(t.rt, t.p, t.e8); startDash(t.rt, t.p);
    t.run(0.3);
    expect(t.p.x).toBeGreaterThan(3);
  });
});

describe('saved games and the pack', () => {
  it('the lock and its settings come back from a save', () => {
    const storage = memory();
    const scene = emptyScene('Arena', '3d');
    scene.instances = [
      makeInstance(2, 'Player', 'box', { collider: body() }),
      makeInstance(3, 'Enemy', 'box', { x: 5, collider: body(), behaviors: [bh('health')] }),
    ];
    const rt = new Runtime(scene, doc([]), { app: 'gamecraft', host: { storage } });
    rt.tick();
    const p = rt.world.byUid.get(2)!;
    setLock(rt, p, rt.world.byUid.get(3)!);
    lockOf(p).marker.color = '#00ff00';
    rt.saveGame('s');
    setLock(rt, p, undefined);
    rt.loadGame('s'); rt.tick();
    const st = lockOf(rt.world.byUid.get(2)!);
    expect(st.target).toBe(3);
    expect(st.marker.color).toBe('#00ff00');
  });

  it('clicking an enemy locks on and dashes to it and attacks; a click on nothing does nothing', () => {
    const scene = emptyScene('Arena', '3d');
    scene.instances = [
      makeInstance(2, 'Player', 'box', { collider: body(), behaviors: [bh('eightdir')] }),
      makeInstance(3, 'Enemy', 'box', { x: 6, collider: body(), behaviors: [bh('health', { maxHp: 100, hp: 100 })] }),
    ];
    const d = doc([]), pack = PACK_BY_ID['combat.lockon'];
    installPack(d, undefined, scene, pack, packDefaults(pack), { app: 'gamecraft', mode: '3d' });
    const rt = new Runtime(scene, d, { app: 'gamecraft' });
    const p = rt.world.byUid.get(2)!, en = rt.world.byUid.get(3)!;
    rt.tick();
    const click = (uids: number[], x: number, z: number) => { rt.input.mouse.x = x; rt.input.mouse.z = z; rt.input.mouseDown('left', uids); rt.tick(); rt.input.mouseUp('left'); rt.tick(); };
    click([], 20, 20);
    expect(lockOf(p).target).toBeNull();
    click([3], 6, 0);
    expect(lockOf(p).target).toBe(3);
    expect(lockOf(p).dash).toBeTruthy();
    for (let k = 0; k < 60; k++) rt.tick();
    expect(rt.world.planarDistance(p, en)).toBeLessThan(1.7);
    expect(en.state.health.hp).toBe(70);
    // Near it on the ground counts too: from far above a figure is small to click on.
    const q = lockOf(p); q.target = null; q.cooldownLeft = 0; q.engaged = false;
    click([], en.x + 1, en.z);
    expect(q.target).toBe(3);
    // Far beyond the range and the dash's usual limits: a click is a clear choice, so it goes all the way.
    q.target = null; q.engaged = false; q.cooldownLeft = 0; p.x = -30;
    const hp = en.state.health.hp;
    click([3], en.x, en.z);
    expect(q.target).toBe(3);
    for (let k = 0; k < 180; k++) rt.tick();
    expect(rt.world.planarDistance(p, en)).toBeLessThan(1.7);
    expect(q.target).toBe(3);
    expect(en.state.health.hp).toBe(hp - 30);
    // The lock-on key still keeps to the range.
    setLock(rt, p, undefined); p.x = -30; q.range = 5;
    expect(lockCandidates(rt, p, q)).toEqual([]);
  });

  it('the pack installs working input actions and events: press, lock, dash, hit', () => {
    const scene = emptyScene('Arena', '3d');
    scene.instances = [
      makeInstance(2, 'Player', 'box', { collider: body(), behaviors: [bh('eightdir')] }),
      makeInstance(3, 'Enemy', 'box', { x: 6, collider: body(), behaviors: [bh('health', { maxHp: 100, hp: 100 })] }),
    ];
    const d = doc([]);
    const pack = PACK_BY_ID['combat.lockon'];
    installPack(d, undefined, scene, pack, packDefaults(pack), { app: 'gamecraft', mode: '3d' });
    expect(d.inputActions?.LockOn).toContain('F');
    expect(d.inputActions?.DashAttack).toContain('pad:RB');
    for (const id of JSON.stringify(d.sheets).match(/lockon\.[a-z_]+/g) ?? []) expect(BLOCK_DEFS[id], id).toBeTruthy();
    const rt = new Runtime(scene, d, { app: 'gamecraft' });
    const press = (k: string) => { rt.input.keyDown(k); rt.tick(); rt.input.keyUp(k); rt.tick(); };
    rt.tick();
    press('F');
    const p = rt.world.byUid.get(2)!, en = rt.world.byUid.get(3)!;
    expect(lockOf(p).target).toBe(3);
    press('E');
    for (let k = 0; k < 60; k++) rt.tick();
    expect(rt.world.planarDistance(p, en)).toBeLessThan(1.7);
    expect(en.state.health.hp).toBe(70);
    press('F');
    expect(lockOf(p).target).toBeNull();
  });
});
