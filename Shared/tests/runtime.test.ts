import { describe, expect, it } from 'vitest';
import { block, doc, event, num, run, scene, str } from './helpers';
import { parseExpr, evalExpr } from '../src/expr';
import { unimplementedBlocks } from '../src/runtime/blockImpl';
import { BLOCK_LIST } from '../src/blocks/definitions';

const log = (m: string) => block('system.log', { message: JSON.stringify(m) });
const start = () => block('system.on_start_of_layout');

describe('expressions', () => {
  const ctx = { ident: (n: string) => ({ a: 2, s: 'hi' } as any)[n], member: () => 7, rng: () => 0.5 };
  it('arithmetic, precedence, strings, comparisons and ternary', () => {
    expect(evalExpr(parseExpr('1 + 2 * 3 ^ 2'), ctx)).toBe(19);
    expect(evalExpr(parseExpr('"Coins: " & a'), ctx)).toBe('Coins: 2');
    expect(evalExpr(parseExpr('a > 1 and not (a = 3)'), ctx)).toBe(true);
    expect(evalExpr(parseExpr('a = 2 ? "yes" : "no"'), ctx)).toBe('yes');
    expect(evalExpr(parseExpr('max(1, a, 5) + abs(-3)'), ctx)).toBe(8);
    expect(evalExpr(parseExpr('Player.X + 1'), ctx)).toBe(8);
    expect(evalExpr(parseExpr('10 / 0'), ctx)).toBe(0);
  });
  it('reports syntax errors', () => {
    expect(() => parseExpr('1 +')).toThrow();
    expect(() => parseExpr('"open')).toThrow();
  });
});

describe('block library', () => {
  it('every defined block has a runtime implementation', () => {
    expect(unimplementedBlocks()).toEqual([]);
  });
  it('block ids are unique and namespaced', () => {
    const ids = BLOCK_LIST.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9_]+\.[a-z0-9_]+$/);
  });
});

describe('event semantics (Construct-style)', () => {
  it('runs events top to bottom with sub-events after actions', () => {
    const d = doc([event([start()], [log('a')], [event([], [log('b')])]), event([start()], [log('c')])]);
    expect(run(d).logs).toEqual(['a', 'b', 'c']);
  });

  it('else runs only when the previous event did not', () => {
    const d = doc([
      event([block('system.every_tick'), block('system.compare_variable', { variable: 'x', op: '>', value: '5' })], [log('big')]),
      event([], [log('small')], [], { isElse: true }),
    ], [num('x', 3)]);
    expect(run(d).logs).toEqual(['small']);
  });

  it('OR blocks pass when any condition passes', () => {
    const d = doc([event([block('system.if', { condition: '1 = 2' }), block('system.if', { condition: '2 = 2' })], [log('or')], [], { isOr: true })]);
    expect(run(d).logs).toEqual(['or']);
  });

  it('inverted conditions', () => {
    const d = doc([event([block('system.if', { condition: '1 = 2' }, undefined, { invert: true })], [log('inv')])]);
    expect(run(d).logs).toEqual(['inv']);
  });

  it('object conditions pick instances and actions apply only to picked ones', () => {
    const s = scene([{ type: 'Enemy', x: 1, vars: { hp: 0 } }, { type: 'Enemy', x: 10, vars: { hp: 0 } }]);
    const d = doc([event([block('object.compare_property', { property: 'X', op: '>', value: '5' }, 'Enemy')], [block('object.set_var', { variable: 'hp', value: '99' }, 'Enemy')])]);
    const { rt } = run(d, s);
    expect(rt.world.of('Enemy').map((e) => e.vars.hp)).toEqual([0, 99]);
  });

  it('Self refers to the instance being processed', () => {
    const s = scene([{ type: 'C', x: 2 }, { type: 'C', x: 5 }]);
    const d = doc([event([start()], [block('object.set_position', { x: 'Self.X * 10', y: '0', z: '0' }, 'C')])]);
    expect(run(d, s).rt.world.of('C').map((c) => c.x)).toEqual([20, 50]);
  });

  it('Repeat, For, While, loopindex and Stop loop', () => {
    const d = doc([
      event([start(), block('system.repeat', { count: '3' })], [log('r" & loopindex & "')]),
      event([start(), block('system.for', { name: 'i', start: '1', end: '3' })], [block('var.add', { variable: 'sum', value: 'loopindex("i")' })]),
      event([start()], [log('sum=" & sum & "')]),
      event([start(), block('system.while', { condition: 'n < 100' })], [block('var.add', { variable: 'n', value: '1' })], [event([block('system.compare_variable', { variable: 'n', op: '>=', value: '4' })], [block('system.stop_loop')])]),
      event([start()], [log('n=" & n & "')]),
    ], [num('sum'), num('n')]);
    // log messages are expressions: build them with concatenation
    d.sheets[0].events[0] = event([start(), block('system.repeat', { count: '3' })], [block('system.log', { message: '"r" & loopindex' })]);
    d.sheets[0].events[2] = event([start()], [block('system.log', { message: '"sum=" & sum' })]);
    d.sheets[0].events[4] = event([start()], [block('system.log', { message: '"n=" & n' })]);
    expect(run(d).logs).toEqual(['r0', 'r1', 'r2', 'sum=6', 'n=4']);
  });

  it('For each picks one instance per iteration', () => {
    const s = scene([{ type: 'E', vars: { i: -1 } }, { type: 'E', vars: { i: -1 } }, { type: 'E', vars: { i: -1 } }]);
    const d = doc([event([start(), block('system.for_each', { object: 'E' })], [block('object.set_var', { variable: 'i', value: 'loopindex' }, 'E')])]);
    expect(run(d, s).rt.world.of('E').map((e) => e.vars.i)).toEqual([0, 1, 2]);
  });

  it('Wait resumes the remaining actions later, keeping picked objects', () => {
    const s = scene([{ type: 'A', vars: { v: 0 } }, { type: 'A', x: 9, vars: { v: 0 } }]);
    const d = doc([event([start(), block('object.compare_property', { property: 'X', op: '>', value: '1' }, 'A')], [block('system.wait', { seconds: '0.5' }), block('object.set_var', { variable: 'v', value: '1' }, 'A')])]);
    const r = run(d, s, 10);
    expect(r.rt.world.of('A').map((a) => a.vars.v)).toEqual([0, 0]);
    for (let i = 0; i < 30; i++) r.rt.tick();
    expect(r.rt.world.of('A').map((a) => a.vars.v)).toEqual([0, 1]);
  });

  it('functions with parameters and return values', () => {
    const d = doc([
      event([block('function.on_function', { name: 'double' })], [block('function.set_return', { value: 'param(0) * 2' })]),
      event([start()], [block('var.set', { variable: 'r', value: 'call("double", 21)' }), block('function.call', { name: 'greet', args: '"Ada"' })]),
      event([block('function.on_function', { name: 'greet' })], [block('system.log', { message: '"hi " & param(0)' })]),
    ], [num('r')]);
    const { rt, logs } = run(d);
    expect(rt.globals.r).toBe(42);
    expect(logs).toEqual(['hi Ada']);
  });

  it('custom events (signals) and variable-changed triggers', () => {
    const d = doc([
      event([start()], [block('system.signal', { name: 'boom' })]),
      event([block('system.on_signal', { name: 'boom' })], [block('var.add', { variable: 'score', value: '5' })]),
      event([block('var.on_changed', { variable: 'score' })], [block('system.log', { message: '"score " & score' })]),
    ], [num('score')]);
    expect(run(d).logs).toEqual(['score 5']);
  });

  it('keyboard triggers fire once per press', () => {
    const d = doc([event([block('input.on_key_pressed', { key: 'Space' })], [block('var.add', { variable: 'jumps', value: '1' })])], [num('jumps')]);
    const { rt } = run(d);
    rt.input.keyDown(' ');
    rt.tick(); rt.tick(); rt.tick();
    expect(rt.globals.jumps).toBe(1);
  });

  it('local variables reset each tick unless static', () => {
    const d = doc([event([block('system.every_tick')], [block('var.add', { variable: 'a', value: '1' }), block('var.add', { variable: 'b', value: '1' }), block('var.set', { variable: 'out', value: 'a & "," & b' })], [], { locals: [{ name: 'a', type: 'number', value: 0 }, { name: 'b', type: 'number', value: 0, isStatic: true }] })], [str('out')]);
    expect(run(d, undefined, 3).rt.globals.out).toBe('1,3');
  });

  it('infinite loops are stopped with a clear error instead of freezing', () => {
    const d = doc([event([start(), block('system.while', { condition: 'true' })], [])]);
    const { rt } = run(d);
    expect(rt.errors.some((e) => /While loop stopped/.test(e.message))).toBe(true);
  });

  it('runtime errors point at the failing block', () => {
    const b = block('var.set', { variable: 'nope', value: '1' });
    const d = doc([event([start()], [b])]);
    const { rt } = run(d);
    expect(rt.errors[0].blockId).toBe(b.id);
  });

  it('unknown blocks are preserved and reported, not executed', () => {
    const d = doc([event([start()], [block('future.teleport_universe', {}), log('"after"')])]);
    d.sheets[0].events[0] = event([start()], [block('future.teleport_universe', {}), block('system.log', { message: '"after"' })]);
    const { rt, logs } = run(d);
    expect(logs).toEqual(['after']);
    expect(rt.errors[0].message).toMatch(/not supported/);
  });
});

describe('objects, collisions and behaviors', () => {
  it('create picks the new instance; destroy removes it', () => {
    const s = scene([{ type: 'Coin', x: 0, vars: { value: 1 } }]);
    const d = doc([event([start()], [block('object.create', { object: 'Coin', x: '5', y: '0', z: '0' }), block('object.set_var', { variable: 'value', value: '10' }, 'Coin')])]);
    const { rt } = run(d, s);
    expect(rt.world.of('Coin').map((c) => c.vars.value)).toEqual([1, 10]);
  });

  it('On collision fires once when overlap starts and picks both objects', () => {
    const s = scene([{ type: 'Player', x: -2, behaviors: [{ type: 'eightdir', props: { defaultControls: false } }] }, { type: 'Coin', x: 0 }]);
    const d = doc([event([block('object.on_collision', { other: 'Coin' }, 'Player')], [block('object.destroy', {}, 'Coin'), block('var.add', { variable: 'coins', value: '1' })])], [num('coins')]);
    const { rt } = run(d, s);
    const p = rt.world.of('Player')[0];
    for (let i = 0; i < 40; i++) { p.x += 0.1; rt.tick(); }
    expect(rt.globals.coins).toBe(1);
    expect(rt.world.of('Coin').length).toBe(0);
  });

  it('Platform behavior: gravity, landing on solids and jumping', () => {
    const s = scene([
      { type: 'Player', y: 3, behaviors: [{ type: 'platform', props: {} }] },
      { type: 'Ground', y: -0.5, sx: 20, behaviors: [{ type: 'solid', props: {} }] },
    ]);
    const { rt } = run(doc([]), s, 120);
    const p = rt.world.of('Player')[0];
    expect(p.y).toBeCloseTo(0.5, 2);
    expect(p.state.platform.grounded).toBe(true);
    rt.input.keyDown(' ');
    rt.tick();
    rt.input.keyUp(' ');
    for (let i = 0; i < 10; i++) rt.tick();
    expect(p.y).toBeGreaterThan(1);
  });

  it('Physics bodies fall, bounce and can be grabbed and thrown', () => {
    const s = scene([
      { type: 'Player', x: 0, y: 0.5, behaviors: [] },
      { type: 'Crate', x: 1, y: 4, behaviors: [{ type: 'physics', props: { mass: 2, bounce: 0 } }] },
      { type: 'Ground', y: -0.5, sx: 40, behaviors: [{ type: 'solid', props: {} }] },
    ]);
    const d = doc([
      event([block('input.on_key_pressed', { key: 'E' })], [block('physics.grab_nearest', { object: 'Crate', distance: '3' }, 'Player')]),
      event([block('input.on_key_pressed', { key: 'F' })], [block('physics.throw', { strength: '20', up: '4' }, 'Player')]),
    ]);
    const { rt } = run(d, s, 120);
    const c = rt.world.of('Crate')[0];
    expect(c.y).toBeCloseTo(0.5, 1);
    rt.input.keyDown('E'); rt.tick(); rt.input.keyUp('E');
    expect(c.state.physics.heldBy).toBe(rt.world.of('Player')[0].uid);
    rt.tick();
    rt.input.keyDown('F'); rt.tick(); rt.input.keyUp('F');
    expect(c.state.physics.heldBy).toBe(0);
    expect(c.vx).toBeGreaterThan(5); // 20 / mass 2 = 10 m/s forward
    for (let i = 0; i < 60; i++) rt.tick();
    expect(c.x).toBeGreaterThan(3);
  });

  it('Pathfinding routes around a wall instead of walking into it', () => {
    const s = scene([
      { type: 'Enemy', x: -5, y: 0, behaviors: [{ type: 'pathfinding', props: { maxSpeed: 6 } }] },
      { type: 'Player', x: 5, y: 0 },
      { type: 'Wall', x: 0, y: 0, sy: 8, behaviors: [{ type: 'solid', props: {} }] },
    ]);
    s.settings.bounds = { min: [-10, -10, -1], max: [10, 10, 1] };
    const d = doc([
      event([start()], [block('pathfinding.move_to_object', { other: 'Player' }, 'Enemy')]),
      event([block('pathfinding.on_arrived', {}, 'Enemy')], [block('var.set', { variable: 'arrived', value: '1' })]),
    ], [num('arrived')]);
    const { rt } = run(d, s, 1);
    const e = rt.world.of('Enemy')[0];
    expect(e.state.path.points.length).toBeGreaterThan(1);
    // Every waypoint avoids the wall's footprint.
    for (const [x, y] of e.state.path.points.slice(0, -1)) expect(Math.abs(x) > 0.5 || Math.abs(y) > 4).toBe(true);
    for (let i = 0; i < 600 && !rt.globals.arrived; i++) rt.tick();
    expect(rt.globals.arrived).toBe(1);
    expect(Math.hypot(e.x - 5, e.y)).toBeLessThan(0.3);
  });

  it('Health: damage, On damaged, On died, victory when all enemies are defeated', () => {
    const s = scene([
      { type: 'Player', x: 0, behaviors: [] },
      { type: 'Enemy', x: 1.5, behaviors: [{ type: 'health', props: { maxHp: 50, hp: 50 } }] },
      { type: 'Enemy', x: -1.5, behaviors: [{ type: 'health', props: { maxHp: 50, hp: 50 } }] },
    ]);
    const d = doc([
      event([block('input.on_key_pressed', { key: 'J' })], [block('combat.melee', { victims: 'Enemy', range: '2', arc: '360', damage: '25' }, 'Player')]),
      event([block('health.on_died', {}, 'Enemy')], [block('var.add', { variable: 'kills', value: '1' }), block('object.destroy', {}, 'Enemy')]),
      event([block('system.every_tick'), block('system.compare_count', { object: 'Enemy', op: '=', value: '0' }), block('system.trigger_once')], [block('game.victory', { title: '"Win"', message: '""' })]),
    ], [num('kills')]);
    const { rt } = run(d, s);
    for (let i = 0; i < 2; i++) { rt.input.keyDown('J'); rt.tick(); rt.input.keyUp('J'); rt.tick(); }
    rt.tick();
    expect(rt.globals.kills).toBe(2);
    expect(rt.ui.screen?.kind).toBe('victory');
    expect(rt.timeScale).toBe(0);
  });

  it('Projectiles damage targets and not their owner', () => {
    const s = scene([
      { type: 'Player', x: 0, behaviors: [{ type: 'health', props: {} }] },
      { type: 'Bullet', x: -50, collider: { shape: 'box', size: [0.2, 0.2, 0.2], offset: [0, 0, 0] } },
      { type: 'Enemy', x: 6, behaviors: [{ type: 'health', props: { hp: 100, maxHp: 100 } }] },
    ]);
    const d = doc([event([start()], [block('combat.shoot', { object: 'Bullet', speed: '30', spread: '0', damage: '40' }, 'Player')])]);
    const { rt } = run(d, s, 30);
    expect(rt.world.of('Enemy')[0].state.health.hp).toBe(60);
    expect(rt.world.of('Player')[0].state.health.hp).toBe(100);
  });

  it('Particle blocks drive real emitters', () => {
    const s = scene([{ type: 'Coin', x: 0 }]);
    const d = doc([event([start()], [block('particles.spawn_at', { preset: 'coin' }, 'Coin')])]);
    const { rt } = run(d, s, 2);
    const em = [...rt.emitters.values()][0];
    expect(em.count).toBeGreaterThan(20);
    for (let i = 0; i < 120; i++) rt.tick();
    expect(rt.emitters.size).toBe(0); // one-shot emitter removed after its particles die
  });

  it('Timer behavior and Every X seconds', () => {
    const s = scene([{ type: 'T' }]);
    const d = doc([
      event([start()], [block('timer.start', { tag: 'go', duration: '0.5', mode: 'regular' }, 'T')]),
      event([block('timer.on_timer', { tag: 'go' }, 'T')], [block('var.add', { variable: 'a', value: '1' })]),
      event([block('timer.every_x_seconds', { seconds: '0.25' })], [block('var.add', { variable: 'b', value: '1' })]),
    ], [num('a'), num('b')]);
    // Started on tick 1; regular 0.5 s timer fires at ~0.5 s and ~1.0 s. Every 0.25 s fires 4 times by 65 ticks.
    const { rt } = run(d, s, 65);
    expect(rt.globals.a).toBe(2);
    expect(rt.globals.b).toBe(4);
  });

  it('post-processing blocks change the active camera stack', () => {
    const s = scene([{ type: 'Camera', kind: 'camera' }], '3d');
    const d = doc([event([start()], [block('postfx.apply_preset', { preset: 'ps1' }), block('postfx.set_bloom', { value: '1.5' })])]);
    const { rt } = run(d, s, 1, 'gamecraft');
    const cam = rt.activeCamera()!;
    expect(cam.camera!.postfx.map((e) => e.type)).toEqual(['ps1', 'fog', 'bloom']);
    expect(cam.camera!.postfx[2].params.strength).toBe(1.5);
  });
});
