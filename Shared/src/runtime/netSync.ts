// Online play, host-authoritative: the host runs the game and sends compact world snapshots ~20 times a second;
// joined players apply them (creating / removing objects to match) and send back their keyboard and gamepad.
// Transport-independent (see Shared/ui/net.ts for the peer-to-peer connection).
import type { Runtime } from './runtime';
import type { RInstance } from './world';

/** One object: uid, type, transform, visibility, opacity, animation, text, HUD bar, light power, sprite flip. */
export interface NetInst { u: number; t: string; p: number[]; v: 0 | 1; o: number; a?: string; tx?: string; bar?: [number, number]; lp?: number; fx?: 1; /** Which online player drives it. */ c?: string }
export interface NetSnapshot {
  tick: number;
  insts: NetInst[];
  msg?: string | null;
  screen?: { kind: 'victory' | 'defeat'; title: string; message: string } | null;
  /** Plain global variables (numbers, strings, booleans) for HUD text and the text-game status line. */
  globals: Record<string, number | string | boolean>;
  /** Sky time, scene glow and ambient (lights-out events), dialogue line and story log length. */
  env: { sky?: number; glow?: number; amb?: number };
  dialogue?: Runtime['dialogue'];
  story?: Runtime['storyLog'];
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;

const MOVERS = new Set(['platform', 'eightdir', 'car', 'surfacewalker']);
const drivenBy = (i: RInstance, scheme: string) => i.behaviors.some((b) => b.props.controls === scheme);

/** Multiplayer pack: someone joined, so they get their own copy of the player object, beside the first player. */
export function spawnOnlinePlayer(rt: Runtime, slot: number): RInstance | null {
  const mp = rt.doc.multiplayer, scheme = 'online' + slot;
  if (!mp || slot > mp.maxPlayers || rt.world.instances.some((i) => !i.destroyed && drivenBy(i, scheme))) return null;
  const first = rt.world.of(mp.player)[0];
  if (!first) return null;
  const copy = rt.world.spawn(first.type, first.x + (rt.world.plane === 'xz' ? 1.5 * (slot - 1) : 1 * (slot - 1)), first.y + 0.1, first.z);
  if (!copy) return null;
  copy.name = `${first.type} ${slot}`;
  for (const b of copy.behaviors) if (MOVERS.has(b.type)) b.props.controls = scheme;
  return copy;
}

/** They left: their character goes with them (one placed in the scene by hand stays). */
export function removeOnlinePlayer(rt: Runtime, slot: number) {
  const mp = rt.doc.multiplayer; if (!mp) return;
  for (const i of rt.world.instances) if (!i.destroyed && i.type.toLowerCase() === mp.player.toLowerCase() && i.name === `${i.type} ${slot}` && drivenBy(i, 'online' + slot)) rt.world.destroy(i);
}

export function makeSnapshot(rt: Runtime): NetSnapshot {
  const insts: NetInst[] = [];
  for (const i of rt.world.instances) {
    if (i.destroyed) continue;
    const s: NetInst = { u: i.uid, t: i.type, p: [i.x, i.y, i.z, i.rx, i.ry, i.rz, i.sx, i.sy, i.sz].map(r3), v: i.visible ? 1 : 0, o: i.opacity };
    if (i.animation) s.a = i.animation;
    if (i.text) s.tx = i.text.text;
    const bar = (i as any).bar as { value: number; max: number } | undefined;
    if (bar) s.bar = [r3(bar.value), r3(bar.max)];
    if (i.light) s.lp = r3(i.light.power);
    if (i.sprite?.flipX) s.fx = 1;
    const ctl = i.behaviors.find((b) => String(b.props.controls ?? '').startsWith('online'))?.props.controls;
    if (ctl) s.c = String(ctl);
    insts.push(s);
  }
  const globals: NetSnapshot['globals'] = {};
  for (const [k, v] of Object.entries(rt.globals)) if (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') globals[k] = v;
  const st = rt.scene.settings;
  return {
    tick: rt.tickCount, insts, msg: rt.ui.message?.text ?? null, screen: rt.ui.screen, globals,
    env: { sky: st.sky?.enabled ? r3(st.sky.time) : undefined, glow: st.emissionScale, amb: st.world?.strength },
    dialogue: rt.dialogue, story: rt.storyLog.length ? rt.storyLog : undefined,
  };
}

/** Make a joined player's world match the host's snapshot. Objects are created from their type's template. */
export function applySnapshot(rt: Runtime, snap: NetSnapshot) {
  const w = rt.world;
  const seen = new Set<number>();
  for (const s of snap.insts) {
    seen.add(s.u);
    let i: RInstance | undefined | null = w.byUid.get(s.u);
    if (!i || i.destroyed) i = w.spawn(s.t, s.p[0], s.p[1], s.p[2], { uid: s.u } as any);
    if (!i) continue;
    [i.x, i.y, i.z, i.rx, i.ry, i.rz, i.sx, i.sy, i.sz] = s.p;
    i.visible = !!s.v; i.opacity = s.o;
    i.animation = s.a;
    if (s.tx !== undefined && i.text) i.text = { ...i.text, text: s.tx };
    if (s.bar) (i as any).bar = { value: s.bar[0], max: s.bar[1] };
    if (s.lp !== undefined && i.light) i.light = { ...i.light, power: s.lp };
    if (i.sprite) i.sprite = { ...i.sprite, flipX: !!s.fx };
    // So a joined player's camera can find their own character.
    if (s.c) for (const b of i.behaviors) if (MOVERS.has(b.type)) b.props.controls = s.c;
  }
  for (const i of [...w.instances]) if (!seen.has(i.uid)) w.destroy(i);
  w.flushDestroyed();
  Object.assign(rt.globals, snap.globals);
  rt.ui.message = snap.msg ? { text: snap.msg, until: Infinity } : null;
  rt.ui.screen = snap.screen ?? null;
  const st = rt.scene.settings;
  if (snap.env.sky !== undefined && st.sky) st.sky = { ...st.sky, enabled: true, time: snap.env.sky };
  st.emissionScale = snap.env.glow;
  if (snap.env.amb !== undefined && st.world) st.world = { ...st.world, strength: snap.env.amb };
  rt.dialogue = snap.dialogue ?? null;
  if (snap.story) rt.storyLog = snap.story;
}
