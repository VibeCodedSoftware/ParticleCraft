// Multi-jump: each press in the air jumps again, up to the chosen number, and landing gives them back.
import { describe, expect, it } from 'vitest';
import { doc } from './helpers';
import { Runtime } from '../src/runtime/runtime';
import { emptyScene, makeInstance } from '../src/runtime/scene';
import { behaviorDefaults } from '../src/runtime/behaviors';
import { PACK_BY_ID, installPack, packDefaults } from '../src/packs';

const bh = (type: string, props: any = {}) => ({ type, props: { ...behaviorDefaults(type), ...props } });

function setup(mode: '2d' | '3d', pack: string, opts: any = {}, behaviors: any[] = [bh('platform')]) {
  const scene = emptyScene('S', mode);
  scene.instances = [
    makeInstance(1, 'Floor', 'box', { y: -0.5, sx: 100, sz: 100, behaviors: [bh('solid')] }),
    makeInstance(2, 'Player', 'box', { y: 0.5, behaviors }),
  ];
  const d = doc([]), p = PACK_BY_ID[pack];
  installPack(d, undefined, scene, p, { ...packDefaults(p), ...opts }, { app: 'gamecraft', mode });
  const rt = new Runtime(scene, d, { app: 'gamecraft' });
  const pl = rt.world.byUid.get(2)!;
  const run = (n: number) => { for (let k = 0; k < n; k++) rt.tick(); };
  const press = () => { rt.input.keyDown('Space'); rt.tick(); rt.input.keyUp('Space'); rt.tick(); };
  run(30);
  return { rt, pl, run, press };
}

/** Presses Jump quickly from the ground, all in one flight, and counts how many took. */
function countJumps(t: ReturnType<typeof setup>, presses: number) {
  let jumps = 0;
  for (let k = 0; k < presses; k++) {
    const before = t.pl.vy;
    t.press();
    if (t.pl.vy > before + 1) jumps++;
    t.run(4);
  }
  return jumps;
}

describe.each(['2d', '3d'] as const)('multi-jump in %s', (mode) => {
  it.each([[2, 'move.double', {}], [3, 'move.triple', {}], [2, 'move.multijump', { count: 2 }], [4, 'move.multijump', { count: 4 }], [6, 'move.multijump', { count: 6 }], [12, 'move.multijump', { count: 12 }]])('%i jumps with %s', (n, pack, opts) => {
    const t = setup(mode, pack as string, opts);
    expect(t.pl.state.platform.grounded).toBe(true);
    expect(countJumps(t, n + 3)).toBe(n);
    t.run(600);
    expect(t.pl.state.platform.grounded).toBe(true); // lands
    expect(countJumps(t, n + 3)).toBe(n); // and has them all back
  });

  it('count 0 is unlimited', () => {
    const t = setup(mode, 'move.multijump', { count: 0 });
    expect(countJumps(t, 15)).toBe(15);
  });

  it('holding the key jumps only once', () => {
    const t = setup(mode, 'move.multijump', { count: 5 });
    t.rt.input.keyDown('Space');
    t.run(8);
    expect(t.pl.state.platform.jumps).toBe(1);
  });

  it('gets its jumps on a character that had another movement behavior', () => {
    const t = setup(mode, 'move.multijump', { count: 3 }, [bh('eightdir')]);
    expect(t.pl.behaviors.filter((b) => ['eightdir', 'platform'].includes(b.type)).map((b) => b.type)).toEqual(['platform']);
    expect(countJumps(t, 6)).toBe(3);
  });

  it('walking off a ledge spends the ground jump only', () => {
    const t = setup(mode, 'move.multijump', { count: 3 });
    t.rt.world.byUid.get(1)!.y = -50; // the floor drops away
    t.run(3);
    expect(t.pl.state.platform.grounded).toBe(false);
    expect(countJumps(t, 6)).toBe(2);
  });
});
