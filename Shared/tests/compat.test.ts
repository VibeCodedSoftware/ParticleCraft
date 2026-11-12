// Cross-application compatibility: LogicCraft <-> GameCraft round trips, migrations, reports,
// and conformance (same program, same results in both app runtimes and in generated code).
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { block, doc, event, num, run, scene, str } from './helpers';
import { canonicalLogic, exportPackage, importPackage } from '../src/interchange';
import { compatibilityReport, migrateDocument, validateDocument } from '../src/validate';
import { generateCode, type Lang } from '../src/codegen/codegen';
import { Runtime } from '../src/runtime/runtime';
import { deepClone } from '../src/schema';

function sample() {
  return doc([
    event([block('system.on_start_of_layout')], [block('var.set', { variable: 'msg', value: '"start"' }), block('system.log', { message: 'msg' })]),
    event([block('system.every_tick'), block('object.compare_property', { property: 'X', op: '<', value: '5' }, 'Player')], [block('object.move', { dx: '1', dy: '0', dz: '0' }, 'Player'), block('var.add', { variable: 'steps', value: '1' })]),
    event([], [block('system.log', { message: '"done at " & steps' })], [], { isElse: true }),
    event([block('input.on_key_pressed', { key: 'Space' })], [block('movement.set_speed', { speed: '9' }, 'Player')]),
  ], [num('steps'), str('msg')]);
}

describe('interchange', () => {
  it('LogicCraft -> GameCraft -> LogicCraft is lossless (block ids, params, connections, variables)', () => {
    const d = sample();
    const s = scene([{ type: 'Player', x: 0, behaviors: [{ type: 'eightdir', props: {} }] }]);
    const toGc = importPackage(JSON.stringify(exportPackage(d, s, 'logiccraft')), 'gamecraft');
    expect(toGc.report.ok).toBe(true);
    const back = importPackage(JSON.stringify(exportPackage(toGc.doc, s, 'gamecraft')), 'logiccraft');
    expect(canonicalLogic(back.doc)).toBe(canonicalLogic(d));
  });

  it('reports GameCraft-only blocks when exporting to LogicCraft, but keeps them', () => {
    const d = doc([event([block('system.on_start_of_layout')], [block('postfx.set_ps1', { state: 'enabled' })])]);
    const r = importPackage(exportPackage(d, null, 'gamecraft'), 'logiccraft');
    expect(r.report.ok).toBe(false);
    expect(r.report.unsupported[0].block).toBe('postfx.set_ps1');
    expect(canonicalLogic(r.doc)).toBe(canonicalLogic(d));
  });

  it('unknown blocks from newer versions survive a round trip', () => {
    const d = doc([event([block('system.on_start_of_layout')], [block('future.thing', { x: 1 })])]);
    const r = importPackage(exportPackage(d, null, 'logiccraft'), 'gamecraft');
    expect(r.report.unknown.length).toBe(1);
    expect(canonicalLogic(r.doc)).toBe(canonicalLogic(d));
  });

  it('migrates v0 documents and renamed block ids', () => {
    const v0 = { name: 'old', events: [{ cond: [{ id: 'c1', block: 'system.on_start', params: {} }], acts: [{ id: 'a1', block: 'move.set_speed', target: 'P', params: { speed: '3' } }], subs: [] }] };
    const { doc: d, applied } = migrateDocument(v0);
    expect(d.schemaVersion).toBe(1);
    expect(applied.some((a) => a.startsWith('v0 → v1'))).toBe(true);
    expect(applied.some((a) => a.includes('renamed 2 legacy'))).toBe(true);
    const ev: any = d.sheets[0].events[0];
    expect(ev.conditions[0].block).toBe('system.on_start_of_layout');
    expect(ev.actions[0].block).toBe('movement.set_speed');
  });

  it('rejects newer packages and garbage with a clear message', () => {
    expect(() => importPackage({ format: 'craft.logic.package', schemaVersion: 99 }, 'gamecraft')).toThrow(/newer/);
    expect(() => importPackage({ hello: 1 }, 'gamecraft')).toThrow(/Unrecognized/);
  });

  it('validation finds misplaced triggers, bad expressions, missing variables and objects', () => {
    const d = doc([
      event([block('system.every_tick'), block('system.on_start_of_layout')], [block('var.set', { variable: 'ghost', value: '1 +' })]),
      event([], [], [], { isElse: true }),
    ]);
    d.sheets[0].events.unshift({ kind: 'comment', id: 'c', text: 'x' });
    const issues = validateDocument(d, { app: 'logiccraft', types: [{ name: 'Player', vars: [], behaviors: [] }] });
    const msgs = issues.map((i) => i.message).join('\n');
    expect(msgs).toMatch(/must be the first condition/);
    expect(msgs).toMatch(/Variable "ghost" is not defined/);
    expect(msgs).toMatch(/Expression ended unexpectedly/);
  });

  it('compatibility report counts supported blocks', () => {
    const r = compatibilityReport(sample(), 'logiccraft');
    expect(r.blockCount).toBe(10);
    expect(r.ok).toBe(true);
  });
});

describe('conformance: same program, both apps', () => {
  it('produces identical state in GameCraft and LogicCraft runtimes (deterministic RNG)', () => {
    const d = doc([
      event([block('system.every_tick')], [block('var.add', { variable: 'r', value: 'random(10)' }), block('object.move_forward', { distance: '0.1' }, 'P'), block('object.rotate', { degrees: '3' }, 'P')]),
    ], [num('r')]);
    const s = scene([{ type: 'P' }]);
    const a = new Runtime(s, deepClone(d), { app: 'logiccraft' });
    const b = new Runtime(s, deepClone(d), { app: 'gamecraft' });
    for (let i = 0; i < 200; i++) { a.tick(); b.tick(); }
    expect(a.globals.r).toBe(b.globals.r);
    expect(a.world.of('P')[0].x).toBe(b.world.of('P')[0].x);
    expect(a.world.of('P')[0].y).toBe(b.world.of('P')[0].y);
  });
});

// ---------------------------------------------------------------- codegen
function program() {
  const d = doc([
    event([block('system.on_start_of_layout')], [block('system.log', { message: '"start " & name' }), block('function.call', { name: 'report', args: '3, "x"' })]),
    event([block('system.on_start_of_layout'), block('system.repeat', { count: '3' })], [block('var.add', { variable: 'total', value: 'loopindex * 2' })]),
    event([block('system.on_start_of_layout'), block('system.for_each', { object: 'Enemy' })], [block('object.add_var', { variable: 'hp', value: '-10' }, 'Enemy')]),
    event([block('system.on_start_of_layout'), block('object.compare_var', { variable: 'hp', op: '<', value: '50' }, 'Enemy')], [block('system.log', { message: '"weak " & Enemy.hp' })]),
    event([block('system.on_start_of_layout')], [block('system.log', { message: '"total " & total & " r " & round(random(100))' })]),
    event([block('function.on_function', { name: 'report' })], [block('system.log', { message: '"report " & (param(0) + 1) & param(1)' })]),
    event([block('system.every_tick'), block('system.compare_variable', { variable: 'ticks', op: '<', value: '3' })], [block('var.add', { variable: 'ticks', value: '1' }), block('object.move_forward', { distance: '2' }, 'Enemy')]),
    event([], [block('system.log', { message: '"else " & ticks' })], [event([block('system.compare_variable', { variable: 'ticks', op: '=', value: '3' })], [block('var.add', { variable: 'ticks', value: '1' }), block('system.log', { message: '"x " & round(Enemy.X)' })])], { isElse: true }),
    event([block('timer.every_x_seconds', { seconds: '1' })], [block('system.log', { message: '"second " & floor(time)' })]),
  ], [num('total'), num('ticks'), str('name', 'demo')]);
  const s = scene([{ type: 'Enemy', x: 0, vars: { hp: 55 } }, { type: 'Enemy', x: 0, vars: { hp: 100 } }]);
  return { d, s };
}

function referenceLogs(ticks = 120) {
  const { d, s } = program();
  return run(d, s, ticks).logs;
}

function have(cmd: string, args: string[]) { try { return spawnSync(cmd, args, { encoding: 'utf8' }).status === 0; } catch { return false; } }

describe('source code generation', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'craft-codegen-'));
  const write = (lang: Lang) => {
    const { d, s } = program();
    const r = generateCode(d, s, lang);
    const f = path.join(tmp, r.fileName);
    fs.writeFileSync(f, r.code);
    return { r, f };
  };

  it('every language reports no unsupported blocks for the portable subset', () => {
    for (const lang of ['javascript', 'python', 'lua', 'csharp', 'cpp'] as Lang[]) {
      const { r } = write(lang);
      expect(r.unsupported, lang).toEqual([]);
    }
  });

  it('generated JavaScript produces exactly the same output as the reference runtime', () => {
    const { f } = write('javascript');
    const out = execFileSync(process.execPath, [f], { encoding: 'utf8' }).trim().split(/\r?\n/);
    expect(out).toEqual(referenceLogs());
  });

  it.runIf(have('python', ['--version']) || have('python3', ['--version']))('generated Python matches the reference runtime', () => {
    const { f } = write('python');
    const py = have('python', ['--version']) ? 'python' : 'python3';
    const out = execFileSync(py, [f], { encoding: 'utf8' }).trim().split(/\r?\n/);
    expect(out).toEqual(referenceLogs());
  });

  it.runIf(have('lua', ['-v']))('generated Lua matches the reference runtime', () => {
    const { f } = write('lua');
    const out = execFileSync('lua', [f], { encoding: 'utf8' }).trim().split(/\r?\n/);
    expect(out).toEqual(referenceLogs());
  });

  it('reports engine-only blocks instead of silently changing behavior', () => {
    const d = doc([event([block('system.on_start_of_layout')], [block('particles.spawn', { preset: 'fire', x: '0', y: '0', z: '0' }), block('system.wait', { seconds: '1' })])]);
    const r = generateCode(d, null, 'python');
    expect(r.ok).toBe(false);
    expect(r.unsupported.map((u) => u.block)).toEqual(expect.arrayContaining(['particles.spawn', 'system.wait']));
    expect(r.code).toMatch(/UNSUPPORTED/);
  });
});
