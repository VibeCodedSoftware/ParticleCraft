// Bullet holes and blood: where they land, what stops them, limits, lifetimes, settings, saves.
import { describe, expect, it } from 'vitest';
import { Runtime } from '../src/runtime/runtime';
import { ACTIONS } from '../src/runtime/blockImpl';
import { bloodSpeckle, bloodSplatter, BLOOD_IMAGE, bulletMark } from '../src/runtime/marks';
import { emptyScene, makeInstance } from '../src/runtime/scene';
import { snapshotGame, applySave } from '../src/runtime/saveGame';
import { behaviorDefaults } from '../src/runtime/behaviors';
import { doc } from './helpers';

const solid = () => ({ type: 'solid', props: behaviorDefaults('solid') });
function setup(marks?: any, extra: any[] = []) {
  const box = (uid: number, type: string, x: number, y: number, z: number, sx: number, sy: number, sz: number, over: any = {}) => makeInstance(uid, type, 'box', { x, y, z, collider: { shape: 'box', size: [sx, sy, sz], offset: [0, 0, 0] }, behaviors: [solid()], ...over });
  const scene = emptyScene('S', '3d');
  scene.instances = [
    box(1, 'Floor', 0, -0.5, 0, 40, 1, 40),
    makeInstance(2, 'Enemy', 'box', { x: 0, y: 1, z: 0, collider: { shape: 'box', size: [0.6, 2, 0.6], offset: [0, 0, 0] }, behaviors: [{ type: 'health', props: { ...behaviorDefaults('health'), maxHp: 50, hp: 50 } }] }),
    makeInstance(3, 'Player', 'box', { x: 0, y: 1, z: 10, collider: { shape: 'box', size: [0.6, 2, 0.6], offset: [0, 0, 0] } }),
    ...extra.map((f) => f(box)),
  ];
  const rt = new Runtime(scene, { ...doc([]), marks } as any, { app: 'gamecraft' } as any);
  return { rt, enemy: rt.world.byUid.get(2)!, floor: rt.world.byUid.get(1)!, player: rt.world.byUid.get(3)! };
}
const bloods = (rt: Runtime) => rt.decals.filter((d) => d.image === BLOOD_IMAGE);
const worldOf = (rt: Runtime, d: Runtime['decals'][number]) => { const p = rt.world.worldPos(rt.world.byUid.get(d.uid)!); return [p[0] + d.offset[0], p[1] + d.offset[1], p[2] + d.offset[2]]; };

describe('blood', () => {
  it('lands on the floor under the target, facing up, and throws a burst', () => {
    const { rt, enemy, floor } = setup();
    bloodSplatter(rt, enemy, [0, 1.2, 0.3], [0, 0, -1], true);
    const b = bloods(rt);
    expect(b.length).toBeGreaterThan(0);
    for (const d of b) {
      expect(d.uid).toBe(floor.uid);
      expect(d.normal).toEqual([0, 1, 0]);
      expect(worldOf(rt, d)[1]).toBeCloseTo(0);
    }
    const fx = [...rt.emitters.values()].find((e) => e.params.texture === 'square')!;
    expect(fx.position).toEqual([0, 1.2, 0.3]);
    expect(fx.params.floorY).toBeCloseTo(0);
    expect(fx.params.burst).toBeGreaterThan(26); // a kill throws more than the preset's hit
  });

  it('sprays away from the shot, and a wall in the way stops it', () => {
    const open = setup();
    bloodSplatter(open.rt, open.enemy, [0, 1, 0], [0, 0, -1], true);
    expect(Math.min(...bloods(open.rt).map((d) => worldOf(open.rt, d)[2]))).toBeLessThan(-0.5);
    const walled = setup(undefined, [(box: any) => box(9, 'Wall', 0, 2, -0.6, 10, 4, 0.2)]);
    bloodSplatter(walled.rt, walled.enemy, [0, 1, 0], [0, 0, -1], true);
    for (const d of bloods(walled.rt)) expect(worldOf(walled.rt, d)[2]).toBeGreaterThan(-0.6);
  });

  it('no floor in reach, or a floor that takes no marks: no patch', () => {
    const { rt, enemy, floor } = setup();
    floor.noMarks = true;
    bloodSplatter(rt, enemy, [0, 1, 0], [0, 0, -1], true);
    expect(bloods(rt).length).toBe(0);
    const high = setup();
    bloodSplatter(high.rt, high.enemy, [100, 1, 100], [0, 0, -1], true);
    expect(bloods(high.rt).length).toBe(0);
  });

  it('settings: off, and the newest N stay', () => {
    const off = setup({ blood: { enabled: false } });
    bloodSplatter(off.rt, off.enemy, [0, 1, 0], [0, 0, -1], true);
    expect(bloods(off.rt).length).toBe(0);
    expect(off.rt.emitters.size).toBe(0);
    const few = setup({ blood: { max: 5 } });
    for (let k = 0; k < 10; k++) bloodSplatter(few.rt, few.enemy, [0, 1, 0], [0, 0, -1], true);
    expect(bloods(few.rt).length).toBe(5);
    expect(bloods(few.rt)[4].id).toBeGreaterThan(bloods(few.rt)[0].id); // the oldest went
  });

  it('does not use up the bullet holes\' pool', () => {
    const { rt, enemy, floor } = setup({ blood: { max: 3 }, bullet: { max: 3 } });
    for (let k = 0; k < 3; k++) bulletMark(rt, floor, [k, 0, 0], [0, 1, 0], 'hole');
    for (let k = 0; k < 5; k++) bloodSplatter(rt, enemy, [0, 1, 0], [0, 0, -1], true);
    expect(rt.decals.filter((d) => d.image === 'hole').length).toBe(3);
  });

  it('Fire hitscan: Blood option on hit, on kill, none; never at a wall', () => {
    const t = setup();
    const fire = (mode: string, damage = '10') => ACTIONS['combat.hitscan'](t.rt, { id: 'b', type: 'combat.hitscan', params: { victims: 'Enemy', range: '50', damage, spread: '0', impact: '', decal: 'none', blood: mode } } as any, { sol: new Map(), scopes: [], loops: [] } as any, t.player);
    // Stand ten metres back, facing the enemy.
    const f = t.rt.world.forward(t.rt.world.angle(t.player));
    t.player.x = -f[0] * 10; t.player.z = -f[2] * 10;
    fire('none');
    expect(bloods(t.rt).length).toBe(0);
    fire('on kill');
    expect(bloods(t.rt).length).toBe(0); // only hurt
    fire('on hit');
    expect(bloods(t.rt).length).toBeGreaterThan(0);
    const before = bloods(t.rt).length;
    fire('on kill', '999');
    expect(t.enemy.state.health.dead).toBe(true);
    expect(bloods(t.rt).length).toBeGreaterThan(before);
  });
});

describe('bullet holes', () => {
  it('honour the settings and the surface', () => {
    const { rt, floor } = setup({ bullet: { size: 0.5, life: 7, max: 2 } });
    for (let k = 0; k < 4; k++) bulletMark(rt, floor, [k, 0, 0], [0, 1, 0], 'hole');
    expect(rt.decals.length).toBe(2);
    expect(rt.decals[1].life).toBe(7);
    expect(rt.decals[1].size).toBeGreaterThan(0.4);
    expect(rt.decals[1].size).not.toBe(rt.decals[0].size); // varied
    floor.noMarks = true;
    bulletMark(rt, floor, [9, 0, 0], [0, 1, 0], 'hole');
    expect(rt.decals.every((d) => d.offset[0] !== 9)).toBe(true);
    const off = setup({ bullet: { enabled: false } });
    bulletMark(off.rt, off.floor, [0, 0, 0], [0, 1, 0], 'hole');
    expect(off.rt.decals.length).toBe(0);
  });
});

describe('saved games keep the marks', () => {
  it('at the age they had', () => {
    const { rt, enemy } = setup();
    bloodSplatter(rt, enemy, [0, 1, 0], [0, 0, -1], false);
    const n = rt.decals.length, life = rt.decals[0].life!;
    rt.time += 10;
    const save = JSON.parse(JSON.stringify(snapshotGame(rt as any)));
    rt.decals = []; rt.time += 100;
    applySave(rt as any, save);
    expect(rt.decals.length).toBe(n);
    expect(rt.time - rt.decals[0].born).toBeCloseTo(10);
    expect(rt.decals[0].life).toBe(life);
    expect(rt.world.byUid.get(rt.decals[0].uid)?.type).toBe('Floor');
  });
});

describe('the speckle picture', () => {
  it('is the same for a seed, differs between seeds, is thick inside and clear at the edge', () => {
    const a = bloodSpeckle(1), b = bloodSpeckle(1), c = bloodSpeckle(2), size = 192;
    expect(a.alpha).toEqual(b.alpha);
    expect(a.alpha).not.toEqual(c.alpha);
    let inner = 0, outer = 0, edge = 0;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      if (!a.alpha[y * size + x]) continue;
      const r = Math.hypot(x - 96, y - 96);
      if (r < 48) inner++; else if (r < 90) outer++; else edge++;
      expect(a.shade[y * size + x]).toBeGreaterThan(0);
    }
    expect(inner / (Math.PI * 48 * 48)).toBeGreaterThan(outer / (Math.PI * (90 * 90 - 48 * 48)));
    expect(inner + outer).toBeGreaterThan(500);
    // Flecks with gaps between them, not a solid disc.
    expect(inner / (Math.PI * 48 * 48)).toBeLessThan(0.6);
    expect(edge).toBeLessThan(inner / 10);
  });
});
