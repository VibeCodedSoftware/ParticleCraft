// Shape-aware rigid bodies for the Physics behavior in 3D: orientation, angular velocity, a real centre of mass and
// inertia per collider shape, point contacts with static (Coulomb) and dynamic friction, restitution and damping.
// A cube or an upright cylinder rests on its flat face and only tips when its centre of mass passes the edge of what
// supports it; a sphere has one contact point and rolls; a cone stands on its base but not on its point; a lying
// cylinder rolls. Buoyancy is the existing Water behavior's, applied per sample point so floating things tilt
// (and tilt under a character standing near an edge). Everything is deterministic: fixed substeps and iterations.
import type { AABB, RInstance, World } from './world';
import { waterVolumes } from './water';
import { planetPull } from './planets';
import { cross, dot, eulerFromQuat, hullPoints, mulMat, mulMatT, quatFromEuler, quatIntegrate, quatMatrix, type Quat, type V3 } from './orient';

const SUBSTEPS = 4, ITERATIONS = 8, MARGIN = 0.02, SLOP = 0.004, EDGE = 0.01;

export interface RigidState {
  q: Quat; w: V3;
  /** Euler angles last written to the instance (a change from outside, e.g. Set angle, re-seeds q). */
  e: V3;
  sleepT: number; asleep: boolean;
  /** Contacts last step / the object this body rests on (uid, 0 = none). */
  contacts: number; ground: number;
  wake: boolean;
  /** Pushes from characters (weight, shoves) waiting for this body's next step: applied inside its substeps, like
   *  gravity, so contacts and friction resolve them together (applied straight to the velocity between steps,
   *  they left phantom spin the floor had to cancel every frame, and the body crept and jittered). */
  loads?: { p: V3; J: V3 }[];
  geo?: Geometry; geoKey?: string;
}

interface Geometry {
  kind: 'box' | 'sphere' | 'cylinder' | 'cone' | 'capsule';
  h: V3; off: V3; com: V3; radius: number;
  /** Hull points relative to the centre of mass (body frame). */
  pts: V3[];
  /** Buoyancy sample points relative to the centre of mass, with their share of the volume. */
  samples: V3[];
  invMass: number; invI: V3; volume: number;
}

/** Whether a Physics body uses the rigid-body solver (3D, primitive collider, rotation not locked). */
export function isRigid(w: World, inst: RInstance, props: Record<string, any>): boolean {
  const c = inst.collider;
  return w.plane === 'xz' && !props.lockRotation && !props.immovable && c.shape !== 'none' && !c.boxes?.length && !inst.voxel && inst.parent == null && inst.kind !== 'ramp' && inst.kind !== 'tilemap';
}

export function rigidState(inst: RInstance): RigidState | undefined { return inst.state.rigid; }

function geometry(inst: RInstance, props: Record<string, any>): Geometry {
  const c = inst.collider;
  const kind = (['sphere', 'cylinder', 'cone', 'capsule'].includes(c.shape) ? c.shape : 'box') as Geometry['kind'];
  const h: V3 = [Math.abs(c.size[0] * inst.sx) / 2 || 0.01, Math.abs(c.size[1] * inst.sy) / 2 || 0.01, Math.abs(c.size[2] * inst.sz) / 2 || 0.01];
  const off: V3 = [c.offset[0] * inst.sx, c.offset[1] * inst.sy, c.offset[2] * inst.sz];
  const m = Math.max(0.01, Number(props.mass ?? 1));
  const r = (h[0] + h[2]) / 2, H = 2 * h[1];
  // Centre of mass: a cone's is a quarter of the way up from its base; any shape can be shifted (weighted bottom).
  const com: V3 = [0, (kind === 'cone' ? -h[1] / 2 : 0) + Number(props.centerOfMassY ?? 0) * h[1], 0];
  let I: V3, volume: number;
  switch (kind) {
    case 'sphere': { const rs = (h[0] + h[1] + h[2]) / 3; I = [0.4 * m * rs * rs, 0.4 * m * rs * rs, 0.4 * m * rs * rs]; volume = (4 / 3) * Math.PI * h[0] * h[1] * h[2]; break; }
    case 'cylinder': case 'capsule': { const ix = (m * (3 * r * r + H * H)) / 12; I = [ix, 0.5 * m * r * r, ix]; volume = Math.PI * h[0] * h[2] * H; break; }
    case 'cone': { const ix = m * ((3 / 20) * r * r + (3 / 80) * H * H); I = [ix, 0.3 * m * r * r, ix]; volume = (Math.PI * h[0] * h[2] * H) / 3; break; }
    default: I = [(m * (4 * h[1] * h[1] + 4 * h[2] * h[2])) / 12, (m * (4 * h[0] * h[0] + 4 * h[2] * h[2])) / 12, (m * (4 * h[0] * h[0] + 4 * h[1] * h[1])) / 12]; volume = 8 * h[0] * h[1] * h[2];
  }
  // Rims fine enough to roll smoothly (a 12-sided wheel would sit still on gentle slopes).
  const pts = kind === 'sphere' ? [] : hullPoints(kind, h[0], h[1], h[2], kind === 'box' ? 12 : 32).map((p) => [p[0] - com[0], p[1] - com[1], p[2] - com[2]] as V3);
  // Volume samples: a 3 x 5 x 3 lattice kept inside the shape.
  const inside = (x: number, y: number, z: number) => {
    const u = x / h[0], v = y / h[1], t = z / h[2], rr = u * u + t * t;
    if (kind === 'box') return true;
    if (kind === 'sphere') return rr + v * v <= 1.0001;
    if (kind === 'cone') return Math.sqrt(rr) <= (1 - v) / 2 + 1e-4;
    return rr <= 1.0001;
  };
  const samples: V3[] = [];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 5; j++) for (let k = 0; k < 3; k++) {
    const x = ((i + 0.5) / 3 * 2 - 1) * h[0], y = ((j + 0.5) / 5 * 2 - 1) * h[1], z = ((k + 0.5) / 3 * 2 - 1) * h[2];
    if (inside(x, y, z)) samples.push([x - com[0], y - com[1], z - com[2]]);
  }
  if (!samples.length) samples.push([-com[0], -com[1], -com[2]]);
  return { kind, h, off, com, radius: (h[0] + h[1] + h[2]) / 3, pts, samples, invMass: 1 / m, invI: [1 / I[0], 1 / I[1], 1 / I[2]], volume };
}

// ------------------------------------------------------------------ bodies taking part in a step
interface Body {
  inst: RInstance; st?: RigidState; g?: Geometry;
  invMass: number; R: number[]; X: V3; v: V3; w: V3;
}
function invIw(b: Body, v: V3): V3 {
  if (!b.g || !b.st) return [0, 0, 0];
  const l = mulMatT(b.R, v);
  return mulMat(b.R, [l[0] * b.g.invI[0], l[1] * b.g.invI[1], l[2] * b.g.invI[2]]);
}
function applyImpulse(b: Body, r: V3, J: V3) {
  if (!b.invMass) return;
  b.v[0] += J[0] * b.invMass; b.v[1] += J[1] * b.invMass; b.v[2] += J[2] * b.invMass;
  if (b.g) { const dw = invIw(b, cross(r, J)); b.w[0] += dw[0]; b.w[1] += dw[1]; b.w[2] += dw[2]; }
}
const pointVel = (b: Body, r: V3): V3 => { const c = cross(b.w, r); return [b.v[0] + c[0], b.v[1] + c[1], b.v[2] + c[2]]; };

/** Body view of any physics instance (rigid or not) for reaction impulses; null for static scenery. */
function bodyOf(w: World, inst: RInstance): Body | null {
  const p = w.behavior(inst, 'physics')?.props;
  if (!p || p.enabled === false || inst.state.physics?.heldBy) return null;
  const m = p.immovable ? 0 : 1 / Math.max(0.01, Number(p.mass ?? 1));
  const st = inst.state.rigid as RigidState | undefined;
  if (st?.geo && isRigid(w, inst, p)) {
    const R = quatMatrix(st.q), g = st.geo;
    const c = mulMat(R, [g.off[0] + g.com[0], g.off[1] + g.com[1], g.off[2] + g.com[2]]);
    return { inst, st, g, invMass: m, R, X: [inst.x + c[0], inst.y + c[1], inst.z + c[2]], v: [inst.vx, inst.vy, inst.vz], w: st.w };
  }
  const b = w.aabb(inst);
  return { inst, invMass: m, R: [1, 0, 0, 0, 1, 0, 0, 0, 1], X: [(b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2], v: [inst.vx, inst.vy, inst.vz], w: [0, 0, 0] };
}
function writeBack(b: Body) { b.inst.vx = b.v[0]; b.inst.vy = b.v[1]; b.inst.vz = b.v[2]; if (b.st) { b.st.w = b.w; b.st.wake = true; } }

// ------------------------------------------------------------------ contacts
interface Contact { p: V3; n: V3; pen: number; other: RInstance | null; ob: Body | null; jn: number; jt: V3; vn0: number }
interface Target { inst: RInstance; boxes: AABB[]; ramp: { x: number; z: number; c: number; s: number; hx: number; hz: number; bottom: number; sy: number; sz: number; n: V3; cos: number } | null; body: Body | null }

function pointBox(p: V3, b: AABB, com: V3): { n: V3; pen: number } | null {
  if (p[0] < b[0] - MARGIN || p[0] > b[3] + MARGIN || p[1] < b[1] - MARGIN || p[1] > b[4] + MARGIN || p[2] < b[2] - MARGIN || p[2] > b[5] + MARGIN) return null;
  const d = [p[0] - b[0], b[3] - p[0], p[1] - b[1], b[4] - p[1], p[2] - b[2], b[5] - p[2]];
  const N: V3[] = [[-1, 0, 0], [1, 0, 0], [0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1]];
  // Beside a box (in x or z) a point never touches it, except within a hair of the edge: there it still rests on the
  // top / bottom face, so the corners of identical stacked boxes all count and none flickers (or acts as a wall).
  const side = Math.max(-d[0], -d[1], -d[4], -d[5], 0);
  if (side > EDGE) return null;
  if (side > 0) {
    if (d[2] < 0 || d[3] < 0) return d[3] < d[2] ? { n: N[3], pen: d[3] } : { n: N[2], pen: d[2] };
    return com[1] > (b[1] + b[4]) / 2 ? { n: N[3], pen: d[3] } : { n: N[2], pen: d[2] };
  }
  let best = -1;
  for (let k = 2; k < 4; k++) if (d[k] < 0 && (best < 0 || d[k] < d[best])) best = k; // just above / below, within the margin
  if (best < 0) {
    // Inside: leave through the face the centre of mass is beyond (a body sinking into a floor goes up, not sideways).
    const beyond = [com[0] < b[0], com[0] > b[3], com[1] < b[1], com[1] > b[4], com[2] < b[2], com[2] > b[5]];
    for (let k = 0; k < 6; k++) if (beyond[k] && (best < 0 || d[k] < d[best])) best = k;
    if (best < 0) for (let k = 0; k < 6; k++) if (best < 0 || d[k] < d[best]) best = k;
  }
  return { n: N[best], pen: d[best] };
}

function pointRamp(p: V3, r: NonNullable<Target['ramp']>): { n: V3; pen: number } | null {
  const dx = p[0] - r.x, dz = p[2] - r.z;
  const lx = dx * r.c - dz * r.s, lz = dx * r.s + dz * r.c;
  if (Math.abs(lx) > r.hx + MARGIN || Math.abs(lz) > r.sz / 2 + MARGIN || p[1] < r.bottom - MARGIN) return null;
  const surf = r.bottom + (0.5 - Math.max(-0.5, Math.min(0.5, lz / r.sz))) * r.sy;
  const pen = (surf - p[1]) * r.cos;
  return pen > -MARGIN ? { n: r.n, pen } : null;
}

function targets(w: World, inst: RInstance, region: AABB): Target[] {
  const out: Target[] = [];
  const cands = new Set<RInstance>(w.blockersFor(inst));
  for (const o of w.instances) if (o !== inst && !o.destroyed && w.hasBehavior(o, 'physics') && !o.collider.nonBlocking && !o.collider.isTrigger && o.collider.shape !== 'none' && w.layersCollide(inst, o)) cands.add(o);
  for (const o of cands) {
    if (o === inst || o.destroyed || o.state.physics?.heldBy) continue;
    const ob = w.aabb(o);
    if (ob[0] > region[3] || ob[3] < region[0] || ob[1] > region[4] || ob[4] < region[1] || ob[2] > region[5] || ob[5] < region[2]) continue;
    const body = w.hasBehavior(o, 'physics') ? bodyOf(w, o) : null;
    if (o.kind === 'ramp' && w.slope(o)) {
      const sl = w.slope(o)!, a = (o.ry * Math.PI) / 180;
      const sy = Math.abs(o.sy), sz = Math.abs(o.sz) || 1e-6, grad = sl.grad, len = Math.hypot(grad * sl.downhill[0], 1, grad * sl.downhill[1]);
      out.push({ inst: o, boxes: [], body, ramp: { x: o.x, z: o.z, c: Math.cos(a), s: Math.sin(a), hx: Math.abs(o.sx) / 2, bottom: o.y - sy / 2, sy, sz, hz: sz / 2, n: [grad * sl.downhill[0] / len, 1 / len, grad * sl.downhill[1] / len], cos: 1 / len } });
      continue;
    }
    const boxes = w.aabbs(o, region).filter((b) => !(b[0] > region[3] || b[3] < region[0] || b[1] > region[4] || b[4] < region[1] || b[2] > region[5] || b[5] < region[2]));
    if (boxes.length) out.push({ inst: o, boxes, ramp: null, body });
  }
  return out;
}

function collect(b: Body, g: Geometry, tg: Target[]): Contact[] {
  const out: Contact[] = [];
  // A body resting on this one owns that contact (it hands its weight down); fighting it from below would push
  // this body into whatever holds it up.
  const add = (p: V3, n: V3, pen: number, t: Target) => (t.body && n[1] < -0.5) || out.push({ p, n, pen, other: t.inst, ob: t.body, jn: 0, jt: [0, 0, 0], vn0: 0 });
  if (g.kind === 'sphere') {
    const C = b.X, r = g.radius;
    for (const t of tg) {
      if (t.ramp) { const n = t.ramp.n, p: V3 = [C[0] - n[0] * r, C[1] - n[1] * r, C[2] - n[2] * r]; const h = pointRamp(p, t.ramp); if (h) add(p, h.n, h.pen, t); continue; }
      let best: { n: V3; pen: number; p: V3 } | null = null;
      for (const bx of t.boxes) {
        const q: V3 = [Math.max(bx[0], Math.min(bx[3], C[0])), Math.max(bx[1], Math.min(bx[4], C[1])), Math.max(bx[2], Math.min(bx[5], C[2]))];
        const d: V3 = [C[0] - q[0], C[1] - q[1], C[2] - q[2]], dl = Math.hypot(d[0], d[1], d[2]);
        let n: V3, pen: number;
        if (dl > 1e-9) { if (dl > r + MARGIN) continue; n = [d[0] / dl, d[1] / dl, d[2] / dl]; pen = r - dl; }
        else { const h = pointBox(C, bx, C)!; n = h.n; pen = h.pen + r; }
        if (!best || pen > best.pen) best = { n, pen, p: [C[0] - n[0] * r, C[1] - n[1] * r, C[2] - n[2] * r] };
      }
      if (best) add(best.p, best.n, best.pen, t);
    }
    return out;
  }
  for (const lp of g.pts) {
    const r = mulMat(b.R, lp), p: V3 = [b.X[0] + r[0], b.X[1] + r[1], b.X[2] + r[2]];
    for (const t of tg) {
      if (t.ramp) { const h = pointRamp(p, t.ramp); if (h) add(p, h.n, h.pen, t); continue; }
      let best: { n: V3; pen: number } | null = null;
      for (const bx of t.boxes) { const h = pointBox(p, bx, b.X); if (h && (!best || h.pen > best.pen)) best = h; }
      if (best) add(p, best.n, best.pen, t);
    }
  }
  return out;
}

function solve(b: Body, cs: Contact[], mu: number, muS: number, e: number) {
  for (const c of cs) {
    const ra: V3 = [c.p[0] - b.X[0], c.p[1] - b.X[1], c.p[2] - b.X[2]];
    const va = pointVel(b, ra), vb = c.ob ? pointVel(c.ob, [c.p[0] - c.ob.X[0], c.p[1] - c.ob.X[1], c.p[2] - c.ob.X[2]]) : [0, 0, 0];
    c.vn0 = dot([va[0] - vb[0], va[1] - vb[1], va[2] - vb[2]], c.n);
  }
  for (let it = 0; it < ITERATIONS; it++) {
    for (const c of cs) {
      const ra: V3 = [c.p[0] - b.X[0], c.p[1] - b.X[1], c.p[2] - b.X[2]];
      const rb: V3 = c.ob ? [c.p[0] - c.ob.X[0], c.p[1] - c.ob.X[1], c.p[2] - c.ob.X[2]] : [0, 0, 0];
      const k = (n: V3) => {
        let s = b.invMass + dot(cross(invIw(b, cross(ra, n)), ra), n);
        if (c.ob?.invMass) s += c.ob.invMass + dot(cross(invIw(c.ob, cross(rb, n)), rb), n);
        return s;
      };
      const rel = (): V3 => { const va = pointVel(b, ra), vb = c.ob ? pointVel(c.ob, rb) : [0, 0, 0]; return [va[0] - vb[0], va[1] - vb[1], va[2] - vb[2]]; };
      // Normal: never approach; a gap may close at most to touching this substep; fast impacts bounce.
      let vr = rel();
      const vn = dot(vr, c.n);
      const target = c.pen < 0 ? c.pen / h_ : c.vn0 < -1 ? -e * c.vn0 : 0;
      let dj = (target - vn) / k(c.n);
      const nj = Math.max(0, c.jn + dj); dj = nj - c.jn; c.jn = nj;
      if (dj) { const J: V3 = [c.n[0] * dj, c.n[1] * dj, c.n[2] * dj]; applyImpulse(b, ra, J); if (c.ob) applyImpulse(c.ob, rb, [-J[0], -J[1], -J[2]]); }
      // Friction: static while the contact barely slides, dynamic once it does.
      vr = rel();
      const vnn = dot(vr, c.n), vt: V3 = [vr[0] - c.n[0] * vnn, vr[1] - c.n[1] * vnn, vr[2] - c.n[2] * vnn];
      const sp = Math.hypot(vt[0], vt[1], vt[2]);
      if (sp < 1e-7 || c.jn <= 0) continue;
      const t: V3 = [vt[0] / sp, vt[1] / sp, vt[2] / sp];
      const jt = -sp / k(t);
      const max = (sp < 0.08 ? muS : mu) * c.jn;
      const acc: V3 = [c.jt[0] + t[0] * jt, c.jt[1] + t[1] * jt, c.jt[2] + t[2] * jt];
      const al = Math.hypot(acc[0], acc[1], acc[2]);
      if (al > max) { acc[0] *= max / al; acc[1] *= max / al; acc[2] *= max / al; }
      const d: V3 = [acc[0] - c.jt[0], acc[1] - c.jt[1], acc[2] - c.jt[2]];
      c.jt = acc;
      applyImpulse(b, ra, d); if (c.ob) applyImpulse(c.ob, rb, [-d[0], -d[1], -d[2]]);
    }
  }
}
let h_ = 1 / 240;

// ------------------------------------------------------------------ the step
export interface RigidHost { gravity: number; queueTrigger(blockId: string, picks: Record<string, any[]>, data?: any): void }

export function stepRigid(w: World, inst: RInstance, p: Record<string, any>, host: RigidHost, dt: number, st: { grounded: boolean }) {
  const rs = (inst.state.rigid ??= { q: quatFromEuler(inst.rx, inst.ry, inst.rz), w: [0, 0, 0], e: [inst.rx, inst.ry, inst.rz], sleepT: 0, asleep: false, contacts: 0, ground: 0, wake: false }) as RigidState;
  // Rotation set from outside (an event, the editor, a tween): start from it.
  if (Math.abs(rs.e[0] - inst.rx) + Math.abs(rs.e[1] - inst.ry) + Math.abs(rs.e[2] - inst.rz) > 1e-6) { rs.q = quatFromEuler(inst.rx, inst.ry, inst.rz); rs.asleep = false; }
  const key = [inst.collider.shape, ...inst.collider.size, ...inst.collider.offset, inst.sx, inst.sy, inst.sz, p.mass, p.centerOfMassY ?? 0].join(',');
  if (rs.geoKey !== key) { rs.geo = geometry(inst, p); rs.geoKey = key; }
  const g = rs.geo!;
  if (rs.wake || rs.loads?.length || Math.hypot(inst.vx, inst.vy, inst.vz) > 0.05) { rs.asleep = false; rs.wake = false; }

  const R0 = quatMatrix(rs.q);
  const offCom: V3 = [g.off[0] + g.com[0], g.off[1] + g.com[1], g.off[2] + g.com[2]];
  const c0 = mulMat(R0, offCom);
  const b: Body = { inst, st: rs, g, invMass: g.invMass, R: R0, X: [inst.x + c0[0], inst.y + c0[1], inst.z + c0[2]], v: [inst.vx, inst.vy, inst.vz], w: [...rs.w] as V3 };
  const ext = Math.max(g.h[0], g.h[1], g.h[2]) * 1.8 + Math.hypot(...b.v) * dt + 0.1;
  const region: AABB = [b.X[0] - ext, b.X[1] - ext, b.X[2] - ext, b.X[0] + ext, b.X[1] + ext, b.X[2] + ext];
  const tg = targets(w, inst, region);

  if (rs.asleep) {
    // Asleep: stay put while something still holds it up.
    const cs = collect(b, g, tg);
    if (cs.some((c) => c.n[1] > 0.3)) { inst.vx = inst.vy = inst.vz = 0; st.grounded = true; return; }
    rs.asleep = false;
  }

  const mu = Number(p.friction ?? 0.5), muS = Number(p.staticFriction ?? 0) > 0 ? Number(p.staticFriction) : mu * 1.2;
  const e = Number(p.bounce ?? 0.3), gy = host.gravity * Number(p.gravityScale ?? 1);
  const lin = Number(p.linearDamping ?? 0.05), ang = Number(p.angularDamping ?? 0.1), roll = Number(p.rollingResistance ?? 0.8);
  const water = waterVolumes(w).filter((v) => v !== inst);
  const h = dt / SUBSTEPS; h_ = h;
  const loads = rs.loads ?? []; rs.loads = [];
  let contacts: Contact[] = [], impact = 0;
  // A planet in range pulls toward its centre instead (Planet behavior).
  const pull = planetPull(w, inst), gs = Number(p.gravityScale ?? 1);
  for (let s = 0; s < SUBSTEPS; s++) {
    if (pull) { b.v[0] += pull.g[0] * gs * h; b.v[1] += pull.g[1] * gs * h; b.v[2] += pull.g[2] * gs * h; }
    else b.v[1] += gy * h;
    for (const l of loads) applyImpulse(b, [l.p[0] - b.X[0], l.p[1] - b.X[1], l.p[2] - b.X[2]], [l.J[0] / SUBSTEPS, l.J[1] / SUBSTEPS, l.J[2] / SUBSTEPS]);
    if (water.length) buoyancy(w, b, g, water, p, gy, h);
    const ld = Math.max(0, 1 - lin * h), ad = Math.max(0, 1 - ang * h);
    b.v = [b.v[0] * ld, b.v[1] * ld, b.v[2] * ld]; b.w = [b.w[0] * ad, b.w[1] * ad, b.w[2] * ad];
    contacts = collect(b, g, tg);
    if (contacts.length) {
      // Stacks: a body resting on another treats it as solid ground while solving, then hands it its weight, so
      // a tower of crates stands instead of jittering apart (bodies tick one after another).
      const carried: [Contact, Body][] = [];
      for (const c of contacts) if (c.ob && c.n[1] > 0.5) { carried.push([c, c.ob]); c.ob = null; }
      solve(b, contacts, mu, muS, e);
      // Hand the weight down as one impulse at the middle of the touching area: per-corner shares from the
      // solver are uneven and would twist the body underneath.
      const byBody = new Map<Body, { J: V3; P: V3; n: number }>();
      for (const [c, ob] of carried) {
        c.ob = ob;
        const s = byBody.get(ob) ?? byBody.set(ob, { J: [0, 0, 0], P: [0, 0, 0], n: 0 }).get(ob)!;
        for (let k = 0; k < 3; k++) { s.J[k] -= c.n[k] * c.jn + c.jt[k]; s.P[k] += c.p[k]; }
        s.n++;
      }
      // (Straight down through its centre: stacked loads do not twist what carries them, which keeps towers stable.)
      for (const [ob, s] of byBody) applyImpulse(ob, [0, 0, 0], s.J);
      for (const c of contacts) impact = Math.max(impact, -c.vn0);
      // Rolling resistance: round things slow down on the ground instead of rolling forever.
      if (g.kind !== 'box') { const rd = Math.max(0, 1 - roll * h); b.w = [b.w[0] * rd, b.w[1] * rd, b.w[2] * rd]; }
    }
    b.X = [b.X[0] + b.v[0] * h, b.X[1] + b.v[1] * h, b.X[2] + b.v[2] * h];
    rs.q = quatIntegrate(rs.q, b.w, h); b.R = quatMatrix(rs.q);
    // Push out of anything it still overlaps (deepest first), without adding speed.
    for (let k = 0; k < 3; k++) {
      let deep: Contact | null = null;
      for (const c of collect(b, g, tg)) if (c.pen > SLOP && (!deep || c.pen > deep.pen)) deep = c;
      if (!deep) break;
      const share = deep.ob?.invMass ? b.invMass / (b.invMass + deep.ob.invMass) : 1;
      const m = (deep.pen - SLOP * 0.5) * share;
      b.X = [b.X[0] + deep.n[0] * m, b.X[1] + deep.n[1] * m, b.X[2] + deep.n[2] * m];
    }
  }
  for (const t of tg) if (t.body && t.body.inst !== inst) { const touched = contacts.some((c) => c.ob === t.body); if (touched) writeBack(t.body); }

  // Write back: position of the object's origin from the centre of mass, Euler angles for the renderer.
  const c1 = mulMat(b.R, offCom);
  inst.x = b.X[0] - c1[0]; inst.y = b.X[1] - c1[1]; inst.z = b.X[2] - c1[2];
  inst.vx = b.v[0]; inst.vy = b.v[1]; inst.vz = b.v[2];
  rs.w = b.w;
  const eul = eulerFromQuat(rs.q);
  inst.rx = eul[0]; inst.ry = eul[1]; inst.rz = eul[2]; rs.e = eul;
  const support = contacts.filter((c) => c.n[1] > 0.5);
  rs.contacts = contacts.length; rs.ground = support[0]?.other?.uid ?? 0;
  st.grounded = support.length > 0;
  if (impact > 2) host.queueTrigger('physics.on_impact', { [inst.type]: [inst] });
  // Sleep once settled, so resting stacks cost nothing and never creep.
  if (st.grounded && Math.hypot(...b.v) < 0.06 && Math.hypot(...b.w) < 0.08) { rs.sleepT += dt; if (rs.sleepT > 0.5) { rs.asleep = true; inst.vx = inst.vy = inst.vz = 0; rs.w = [0, 0, 0]; } }
  else rs.sleepT = 0;
}

/** Existing Water behavior buoyancy, per sample point: the submerged side pushes harder, so bodies right themselves. */
function buoyancy(w: World, b: Body, g: Geometry, vols: RInstance[], p: Record<string, any>, gy: number, h: number) {
  const n = g.samples.length;
  const cell = (2 * g.h[1]) / 5;
  let sub = 0, drag = 0, stab = 0;
  for (const sp of g.samples) {
    const r = mulMat(b.R, sp), q: V3 = [b.X[0] + r[0], b.X[1] + r[1], b.X[2] + r[2]];
    for (const v of vols) {
      const bb = w.aabb(v);
      if (q[0] < bb[0] || q[0] > bb[3] || q[2] < bb[2] || q[2] > bb[5] || q[1] - cell / 2 > bb[4] || q[1] + cell / 2 < bb[1]) continue;
      const f = Math.max(0, Math.min(1, (bb[4] - (q[1] - cell / 2)) / cell));
      if (f <= 0) continue;
      const wp = w.behavior(v, 'water')!.props;
      const ratio = Math.min(4, (Number(wp.density ?? 1) * 1000 * g.volume * 0.002) / Math.max(0.01, Number(p.mass ?? 1)));
      const J = (-gy * ratio * f * h) / n / g.invMass;
      applyImpulse(b, r, [0, J, 0]);
      sub += f / n; drag = Math.max(drag, Number(wp.drag ?? 2)); stab = Math.max(stab, Number(wp.stability ?? 0));
      break;
    }
  }
  if (sub > 0) {
    // Water resists motion, most of all bobbing up and down and rocking (so floating things settle in a couple of
    // seconds instead of rocking on and on).
    const d = Math.max(0, 1 - drag * sub * h), dh = Math.max(0, 1 - drag * 2.5 * sub * h);
    b.v = [b.v[0] * d, b.v[1] * dh, b.v[2] * d];
    const da = Math.max(0, 1 - drag * 3 * sub * h);
    b.w = [b.w[0] * da, b.w[1] * da, b.w[2] * da];
    if (stab > 0) {
      // Tipping resistance: a turn toward upright, about the axis between the body's up and straight up.
      const up: V3 = [b.R[1], b.R[4], b.R[7]];
      const axis: V3 = [-up[2], 0, up[0]]; // up × (0, 1, 0): turning about it brings up toward straight up
      const k = stab * 6 * sub * h;
      b.w = [b.w[0] + axis[0] * k, b.w[1], b.w[2] + axis[2] * k];
    }
  }
}

/**
 * How much more a floating body could carry before it sinks (kg, the game's mass scale), or 0 when it is not in
 * water: what Water buoyancy can lift when fully under, less the body's own mass.
 */
export function floatSpare(w: World, inst: RInstance): number {
  const p = w.behavior(inst, 'physics')?.props;
  if (!p) return 0;
  const bb = w.aabb(inst), cx = (bb[0] + bb[3]) / 2, cz = (bb[2] + bb[5]) / 2;
  for (const v of waterVolumes(w)) {
    if (v === inst) continue;
    const vb = w.aabb(v);
    if (cx < vb[0] || cx > vb[3] || cz < vb[2] || cz > vb[5] || bb[1] > vb[4] || bb[4] < vb[1]) continue;
    const volume = Math.max(1e-6, (bb[3] - bb[0]) * (bb[4] - bb[1]) * (bb[5] - bb[2]));
    const mass = Math.max(0.01, Number(p.mass ?? 1));
    const ratio = Math.min(4, (Number(w.behavior(v, 'water')!.props.density ?? 1) * 1000 * volume * 0.002) / mass);
    return Math.max(0, (ratio - 1) * mass);
  }
  return 0;
}

// ------------------------------------------------------------------ used by characters
/** Push / weigh on a body at a world point (impulse in N·s). Works for rigid and plain physics bodies. */
export function impulseAt(w: World, inst: RInstance, point: V3, J: V3) {
  const rs = inst.state.rigid as RigidState | undefined, p = w.behavior(inst, 'physics')?.props;
  if (rs && p && isRigid(w, inst, p) && !p.immovable) { (rs.loads ??= []).push({ p: point, J }); return; }
  const b = bodyOf(w, inst); if (!b || !b.invMass) return;
  applyImpulse(b, [point[0] - b.X[0], point[1] - b.X[1], point[2] - b.X[2]], J);
  writeBack(b);
}

/** Velocity of a body's surface at a world point (riders move with it). */
export function surfaceVelocity(w: World, inst: RInstance, point: V3): V3 {
  const b = bodyOf(w, inst); if (!b) return [inst.vx, inst.vy, inst.vz];
  return pointVel(b, [point[0] - b.X[0], point[1] - b.X[1], point[2] - b.X[2]]);
}

/**
 * Outward surface normal of a body under a point on top of it: flat faces of boxes and upright cylinders give their
 * face normal; spheres, the curved side of lying cylinders and capsules, and cone sides give a sloped normal.
 */
export function surfaceNormal(w: World, inst: RInstance, point: V3): V3 { return surfaceAt(w, inst, point).n; }

/** Surface normal under a point, and whether that surface is curved (a ball, a capsule, a lying cylinder's side). */
export function surfaceAt(w: World, inst: RInstance, point: V3): { n: V3; curved: boolean } {
  const rs = inst.state.rigid as RigidState | undefined;
  const g = rs?.geo;
  if (!rs || !g) return { n: [0, 1, 0], curved: false };
  const R = quatMatrix(rs.q);
  let curved = g.kind === 'sphere' || g.kind === 'capsule';
  const c = mulMat(R, g.off), C: V3 = [inst.x + c[0], inst.y + c[1], inst.z + c[2]];
  const local = mulMatT(R, [point[0] - C[0], point[1] - C[1], point[2] - C[2]]);
  const norm = (v: V3): V3 => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
  let n: V3;
  switch (g.kind) {
    case 'sphere': n = norm(local); break;
    case 'box': {
      // The face whose normal points most upward.
      let best: V3 = [0, 1, 0], bd = -Infinity;
      for (const f of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] as V3[]) { const d = mulMat(R, f)[1]; if (d > bd) { bd = d; best = f; } }
      n = best; break;
    }
    case 'cone': {
      const up = mulMat(R, [0, 1, 0])[1];
      if (up < -0.5) { n = [0, -1, 0]; break; } // standing on its upturned base
      const rr = Math.hypot(local[0], local[2]) || 1e-6, rad = (g.h[0] + g.h[2]) / 2;
      n = norm([(local[0] / rr) * 2 * g.h[1], rad, (local[2] / rr) * 2 * g.h[1]]); break;
    }
    default: {
      const up = mulMat(R, [0, 1, 0])[1];
      if (Math.abs(up) > 0.7 && g.kind === 'cylinder') { n = [0, Math.sign(up), 0]; break; }
      curved = true;
      n = norm([local[0], g.kind === 'capsule' && Math.abs(local[1]) > g.h[1] - (g.h[0] + g.h[2]) / 2 ? local[1] - Math.sign(local[1]) * (g.h[1] - (g.h[0] + g.h[2]) / 2) : 0, local[2]]);
    }
  }
  return { n: mulMat(R, n), curved };
}
