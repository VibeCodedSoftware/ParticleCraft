// Procedural Animation as visible logic: "Show as blocks" writes the character's controller as a group of editable
// blocks — movement → leg controller → ground detection → foot placement (→ wall climbing / reaching) — filled with
// its current settings, so the setup can be read, changed and reused in the event sheet instead of hiding in the
// behavior.
import type { EventNode, GroupNode } from '@shared/src/schema';
import { newBlock, newEvent } from '@shared/ui/logicOps';

const r = (n: unknown, d: number) => String(Math.round(Number(n ?? d) * 100) / 100);

/** The chain each kind of character reads as (shown at the top of the group). */
export function procChainText(kind: string): string {
  if (kind === 'spider') return 'Spider movement → Surface detection → Wall orientation → Eight-leg coordination';
  if (kind === 'snake') return 'Snake movement → Body wave → Surface following';
  if (kind === 'octopus') return 'Octopus movement → Tentacle motion → Reaching / grabbing';
  if (kind === 'quadruped') return 'Four-legged movement → Coordinated stepping → Ground detection → Body stabilisation';
  if (kind === 'robot') return 'Robot movement → Mechanical leg controller → Ground detection → Foot placement';
  return 'Character movement → Procedural leg controller → Ground detection → Foot placement';
}

/** A group of blocks that sets up `type`'s Procedural Animation the way `props` has it now. */
export function procAnimGroup(type: string, kind: string, props: Record<string, any>): GroupNode {
  const id = () => 'g_' + Math.random().toString(36).slice(2, 10);
  const legs = kind !== 'snake' && kind !== 'octopus';
  const actions = [
    ...(legs ? [newBlock('proc.legs', type, { stride: r(props.stepLength, 0.8), height: r(props.stepHeight, 0.3), speed: r(props.stepSpeed, 5) })] : []),
    newBlock('proc.ground', type, { state: props.groundDetect === false ? 'off' : 'on', adapt: r(props.surfaceAdapt, 1) }),
    ...(legs ? [newBlock('proc.feet', type, { resp: r(props.responsiveness, 1), bob: r(props.bob, 1) })] : []),
    newBlock('proc.body', type, { arms: r(props.armSwing, 1), wave: r(props.wave, 1), idle: r(props.idle, 1), speed: r(props.animSpeed, 1) }),
    ...(kind === 'spider' || props.climbWalls ? [newBlock('proc.climb', type, { state: props.climbWalls ? 'on' : 'off', speed: r(props.climbSpeed, 2.5) })] : []),
  ];
  const children: EventNode[] = [
    { kind: 'comment', id: id(), text: `${procChainText(kind)}. These blocks set ${type}'s Procedural Animation when the scene starts: change the numbers here, or run them from other events (e.g. a longer stride while running).` },
    newEvent([newBlock('system.on_start_of_layout')], actions),
  ];
  if (props.ragdollOnDeath !== false) children.push({ kind: 'comment', id: id(), text: 'Ragdoll death: with Health, reaching 0 makes the body go limp (behavior setting Ragdoll on death). Use the Ragdoll / Get up blocks for knockouts.' });
  if (kind === 'octopus') children.push(newEvent([newBlock('object.is_within_distance', type, { other: 'Player', distance: '4' })], [newBlock('proc.reach', type, { target: 'Player' })]));
  return { kind: 'group', id: id(), name: `${type} procedural animation`, active: true, children };
}
