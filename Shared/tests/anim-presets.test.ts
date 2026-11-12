// Animation presets with movement roles: the clip plays while the character is in that state and stops cleanly.
import { expect, it } from 'vitest';
import { doc, scene } from './helpers';
import { Runtime } from '../src/runtime/runtime';
import { behaviorDefaults } from '../src/runtime/behaviors';
import { ANIM_PRESETS } from '../src/animPresets';

it('a walk preset plays while walking and the character returns to its own values after', () => {
  const walk = ANIM_PRESETS.find((p) => p.name === 'Walk waddle')!;
  const s = scene([
    { uid: 1, type: 'Floor', kind: 'box', x: 0, y: -1, sx: 40, sy: 1, behaviors: [{ type: 'solid', props: behaviorDefaults('solid') }] },
    { uid: 2, type: 'Hero', kind: 'box', x: 0, y: 0, rz: 0, animRoles: { walk: walk.name }, behaviors: [{ type: 'platform', props: behaviorDefaults('platform') }] },
  ]);
  s.animations = [{ name: walk.name, ...walk.clip }];
  const rt = new Runtime(s, doc([]), { app: 'logiccraft' });
  for (let i = 0; i < 30; i++) rt.tick();
  const h = rt.world.of('Hero')[0];
  expect(rt.clips.has(h.uid)).toBe(false); // standing: no walk clip
  rt.input.keyDown('D');
  let tilted = false;
  for (let i = 0; i < 40; i++) { rt.tick(); if (Math.abs(h.rz) > 2) tilted = true; }
  expect(rt.clips.get(h.uid)?.name).toBe('Walk waddle');
  expect(tilted).toBe(true);
  expect(h.x).toBeGreaterThan(1); // the clip does not pin it in place
  rt.input.keyUp('D');
  for (let i = 0; i < 60; i++) rt.tick();
  expect(rt.clips.has(h.uid)).toBe(false);
  expect(h.rz).toBe(0);
  expect(h.sy).toBe(1);
});

it('every preset has keys inside its duration and only character-safe tracks for roles', () => {
  for (const p of ANIM_PRESETS) {
    for (const t of p.clip.tracks) for (const k of t.keys) { expect(k.t).toBeGreaterThanOrEqual(0); expect(k.t).toBeLessThanOrEqual(p.clip.duration + 1e-9); }
    if (p.role) for (const t of p.clip.tracks) expect(['X', 'Y', 'Z']).not.toContain(t.property);
  }
});
