// Collision View: each object's collider is classified by what it does (the viewport colours and legend).
import { expect, it } from 'vitest';
import { collisionKind, COLLISION_KINDS } from '../src/collisionView';
import { makeInstance } from '../src/runtime/scene';
import { behaviorDefaults } from '../src/runtime/behaviors';

const bh = (type: string, props: Record<string, any> = {}) => ({ type, props: { ...behaviorDefaults(type), ...props } });
const box = (o: any = {}) => makeInstance(1, 'X', 'box', o);

it('classifies colliders by what they do', () => {
  expect(collisionKind(box({ behaviors: [bh('solid')] }))).toBe('solid');
  expect(collisionKind(box({ behaviors: [bh('platform')] }))).toBe('character');
  expect(collisionKind(box({ behaviors: [bh('wander')] }))).toBe('character');
  expect(collisionKind(box({ behaviors: [bh('physics')] }))).toBe('physics');
  expect(collisionKind(box({ behaviors: [bh('physics', { enabled: false }), bh('solid')] }))).toBe('solid');
  expect(collisionKind(box({ behaviors: [bh('solid')], collider: { ...box().collider, isTrigger: true } }))).toBe('trigger');
  expect(collisionKind(box({ collider: { ...box().collider, nonBlocking: true } }))).toBe('passthrough');
  expect(collisionKind(box())).toBe('other');
  expect(collisionKind(box({ collider: { ...box().collider, shape: 'none' } }))).toBeNull();
  expect(new Set(COLLISION_KINDS.map((k) => k.color)).size).toBe(COLLISION_KINDS.length); // every kind its own colour
});
