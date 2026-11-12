// Collision View: what each object's collider does, as a colour and a name for the viewport and its legend.
import type { InstanceData } from './runtime/scene';

export type CollisionKind = 'solid' | 'character' | 'physics' | 'trigger' | 'passthrough' | 'other';

export const COLLISION_KINDS: { kind: CollisionKind; label: string; color: number; doc: string }[] = [
  { kind: 'solid', label: 'Solid', color: 0x3fd17a, doc: 'Walls and floors: block movement and physics.' },
  { kind: 'character', label: 'Character', color: 0x4c97ff, doc: 'Moved by a movement behavior (Platform, 8 Direction, Car, Pathfinding…): stopped by solids.' },
  { kind: 'physics', label: 'Physics body', color: 0xf08c2e, doc: 'Falls, rolls and gets pushed (Physics behavior).' },
  { kind: 'trigger', label: 'Trigger', color: 0x2ec4b6, doc: 'Detects overlaps (On collision) but blocks nothing.' },
  { kind: 'passthrough', label: 'Pass-through', color: 0xe0b84a, doc: 'Non-blocking: collision events only, characters walk through.' },
  { kind: 'other', label: 'Collider only', color: 0x9aa0a6, doc: 'Has a collider for events and line of sight, but no Solid behavior: characters walk through.' },
];

const MOVERS = new Set(['platform', 'eightdir', 'car', 'pathfinding', 'vehicle', 'wander', 'vrplayer', 'slime', 'flyer', 'enemy', 'surfacewalker']);

/** What the collider does, or null when the object has none. */
export function collisionKind(i: InstanceData): CollisionKind | null {
  if (!i.collider || i.collider.shape === 'none') return null;
  if (i.collider.isTrigger) return 'trigger';
  if (i.collider.nonBlocking) return 'passthrough';
  const has = (t: string) => i.behaviors.some((b) => b.type === t && b.props.enabled !== false);
  if (has('physics')) return 'physics';
  if (i.behaviors.some((b) => MOVERS.has(b.type))) return 'character';
  if (has('solid')) return 'solid';
  return 'other';
}

export const collisionColor = (k: CollisionKind) => COLLISION_KINDS.find((c) => c.kind === k)!.color;
