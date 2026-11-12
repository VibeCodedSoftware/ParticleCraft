// P3 movement: the Platform behavior's optional abilities (jump count, air jumps after walking off a ledge, wall
// sliding and jumping, slow descent, dash, ladders, flying, crouch, jumping off) and platform types (one-way with
// drop-through for one character only, pass-through for characters only, toggle on a timer and by block).
import { describe, expect, it } from 'vitest';
import { block, doc, scene } from './helpers';
import { Runtime } from '../src/runtime/runtime';
import { behaviorDefaults } from '../src/runtime/behaviors';
import { ACTIONS } from '../src/runtime/blockImpl';

const bh = (t: string, p: Record<string, any> = {}) => ({ type: t, props: { ...behaviorDefaults(t), ...p } });
const floor = { uid: 1, type: 'Floor', x: 0, y: -0.5, sx: 60, sy: 1, behaviors: [bh('solid')] };
const hero = (p: Record<string, any> = {}, at: Partial<{ x: number; y: number }> = {}) => ({ uid: 2, type: 'Hero', x: at.x ?? 0, y: at.y ?? 0.5, sx: 0.8, sy: 1, behaviors: [bh('platform', p)] });
const make = (insts: any[]) => new Runtime(scene(insts), doc([]), { app: 'logiccraft' });
const ticks = (rt: Runtime, n: number) => { for (let k = 0; k < n; k++) rt.tick(); };
const press = (rt: Runtime, key: string) => { rt.input.keyDown(key); rt.tick(); rt.input.keyUp(key); };
const H = (rt: Runtime) => rt.world.of('Hero')[0];

describe('platform abilities', () => {
  it('jump count: 3 jumps in a row, a 4th does nothing; landing gives them back', () => {
    const rt = make([floor, hero({ jumpCount: 3 })]); ticks(rt, 10);
    press(rt, 'Space'); ticks(rt, 8); press(rt, 'Space'); ticks(rt, 8); press(rt, 'Space');
    expect(H(rt).state.platform.jumps).toBe(3);
    const vy = H(rt).vy; ticks(rt, 3); press(rt, 'Space');
    expect(H(rt).vy).toBeLessThan(vy); // no 4th jump
    ticks(rt, 200); expect(H(rt).state.platform.grounded).toBe(true); expect(H(rt).state.platform.jumps).toBe(0);
  });
  it('walking off a ledge: no air jump with 1 jump, one with 2 (the ground jump is spent)', () => {
    for (const [count, want] of [[1, false], [2, true]] as const) {
      const rt = make([{ ...floor, sx: 4 }, hero({ jumpCount: count, maxSpeed: 6 }, { x: 1.5 })]); ticks(rt, 5);
      rt.input.keyDown('D'); ticks(rt, 20); rt.input.keyUp('D');
      expect(H(rt).state.platform.grounded).toBe(false);
      press(rt, 'Space');
      expect(H(rt).vy > 0).toBe(want);
    }
  });
  it('jumping off: no jumps at all', () => {
    const rt = make([floor, hero({ jumping: false })]); ticks(rt, 10); press(rt, 'Space'); ticks(rt, 2);
    expect(H(rt).state.platform.grounded).toBe(true);
  });
  it('wall slide and wall jump', () => {
    const wall = { uid: 3, type: 'Wall', x: 2, y: 5, sx: 1, sy: 12, behaviors: [bh('solid')] };
    const rt = make([floor, wall, hero({ wallSlide: true, wallJump: true, wallSlideSpeed: 2 }, { x: 0.8, y: 8 })]);
    rt.input.keyDown('D'); ticks(rt, 40);
    expect(H(rt).state.platform.wallSliding).toBe(true);
    expect(H(rt).vy).toBeGreaterThanOrEqual(-2.01);
    press(rt, 'Space'); rt.input.keyUp('D');
    expect(H(rt).vy).toBeGreaterThan(5); expect(H(rt).vx).toBeLessThan(-3); // up and away
  });
  it('slow descent while holding Jump; dash bursts then cools down', () => {
    const rt = make([floor, hero({ slowDescent: true, glideFallSpeed: 1.5, dash: true, dashSpeed: 15, dashTime: 0.2, dashCooldown: 0.5 }, { y: 20 })]);
    rt.input.keyDown('Space'); ticks(rt, 60);
    expect(H(rt).vy).toBeCloseTo(-1.5, 1); expect(H(rt).state.platform.gliding).toBe(true);
    rt.input.keyUp('Space');
    const x0 = H(rt).x; press(rt, 'Q'); ticks(rt, 5);
    expect(H(rt).x - x0).toBeGreaterThan(1); // dashing right (facing)
    ticks(rt, 10); press(rt, 'Q');
    expect(H(rt).state.platform.dashT).toBe(0); // still cooling down: no second dash
    expect(Math.abs(H(rt).vx)).toBeLessThanOrEqual(6); // and the first one ended at normal speed
  });
  it('ladders: Up climbs with no gravity; flying: Jump up, C down; crouch slows', () => {
    const ladder = { uid: 3, type: 'Ladder', x: 0, y: 3, sx: 1, sy: 6, tags: ['ladder'], behaviors: [] };
    const rt = make([floor, ladder, hero()]); ticks(rt, 5);
    rt.input.keyDown('W'); ticks(rt, 30); rt.input.keyUp('W');
    expect(H(rt).y).toBeGreaterThan(1.5); expect(H(rt).state.platform.climbing).toBe(true);
    const y = H(rt).y; ticks(rt, 30); expect(H(rt).y).toBeCloseTo(y, 2); // holds on
    const f = make([floor, hero({ flying: true }, { y: 3 })]);
    f.input.keyDown('Space'); ticks(f, 30); f.input.keyUp('Space'); expect(H(f).y).toBeGreaterThan(4);
    const c = make([floor, hero({ crouching: true, maxSpeed: 6, crouchSpeed: 0.5 })]); ticks(c, 5);
    c.input.keyDown('C'); c.input.keyDown('D'); ticks(c, 60);
    expect(H(c).vx).toBeCloseTo(3, 0); expect(H(c).animation).toBe('crouch');
  });
  it('blocks: set jumps, switch an ability, dash', () => {
    const rt = make([floor, hero()]); const h = H(rt);
    const run = (id: string, params: Record<string, string> = {}) => ACTIONS[id](rt, block(id, params, 'Hero') as any, {} as any, h as any);
    run('platform.set_jumps', { count: '2' }); run('platform.set_ability', { ability: 'dash', state: 'on' });
    expect(h.behaviors[0].props).toMatchObject({ jumpCount: 2, dash: true });
    ticks(rt, 5); run('platform.dash'); rt.tick(); expect(h.state.platform.dashT).toBeGreaterThan(0);
  });
});

describe('platform types', () => {
  const one = (kind: string, extra: Record<string, any> = {}) => ({ uid: 5, type: 'Ledge', x: 0, y: 3, sx: 4, sy: 0.3, behaviors: [bh('solid'), bh('platformtype', { kind, ...extra })] });
  it('one-way: jump up through it from below, land on top, Down + Jump drops through — only that character', () => {
    const crate = { uid: 6, type: 'Crate', x: 1.4, y: 3.8, sx: 0.6, sy: 0.6, behaviors: [bh('physics')] };
    const rt = make([floor, one('one-way'), crate, hero({ jumpStrength: 16 })]); ticks(rt, 5);
    press(rt, 'Space'); ticks(rt, 120);
    expect(H(rt).y).toBeGreaterThan(3); expect(H(rt).state.platform.standingOn).toBe(5); // on top
    rt.input.keyDown('S'); press(rt, 'Space'); rt.input.keyUp('S'); ticks(rt, 60);
    expect(H(rt).y).toBeLessThan(1.5); // dropped through
    expect(rt.world.of('Crate')[0].y).toBeGreaterThan(3); // the crate still stands on it
  });
  it('pass-through: characters walk through it, physics bodies still land on it', () => {
    const crate = { uid: 6, type: 'Crate', x: 0, y: 5, sx: 0.6, sy: 0.6, behaviors: [bh('physics')] };
    const rt = make([floor, one('pass-through', { fade: true, fadeTime: 0 }), crate, hero({}, { y: 3 })]); rt.tick();
    expect(rt.world.of('Ledge')[0].opacity).toBeLessThan(100); // faded while the hero is inside
    ticks(rt, 120);
    expect(H(rt).y).toBeLessThan(1); expect(rt.world.of('Crate')[0].y).toBeGreaterThan(3);
  });
  it('toggle: off on a timer lets things fall through; the block switches it back on', () => {
    const rt = make([floor, one('toggle', { onTime: 0.5, offTime: 5 }), hero({}, { y: 3.8 })]); ticks(rt, 20);
    expect(H(rt).y).toBeGreaterThan(3);
    ticks(rt, 80); expect(H(rt).y).toBeLessThan(1);
    const ledge = rt.world.of('Ledge')[0];
    ACTIONS['platformtype.switch'](rt, block('platformtype.switch', { state: 'on' }, 'Ledge') as any, {} as any, ledge as any);
    expect(ledge.state.platformType.on).toBe(true);
  });
});
