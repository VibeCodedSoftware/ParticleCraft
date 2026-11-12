// Erosion as a simulation, for finite worlds: rain falls as droplets that run downhill, picking up soil where they speed
// up and dropping it where they slow (hydraulic erosion: gullies, sharp ridges, fans of sediment at the foot of
// slopes), then loose material slides down whatever is steeper than it can rest at (thermal erosion: scree slopes,
// softened crests). The land is read on a grid and the result is the change at each grid point, written into the
// world's hand edits, so it is saved, undoable and adjustable with the sculpt brushes like any other edit.
// (Endless worlds use the per-point erosion in the terrain itself: a simulation needs the whole land at once.)

export interface ErosionOpts {
  /** Droplets per grid point (0..1 → up to 2 each). */ rain: number;
  /** How much soil one droplet can carry and wear away (0..1). */ strength: number;
  /** Passes of loose material sliding (0..1 → up to 60). */ thermal: number;
  /** Steepest slope loose material rests at (0..1, as rise over run). */ talus: number;
  seed: number;
  /** How strongly flow, sediment and scree colour the ground (0..1). */ materials: number;
  /** Stones where scree and sediment collect (0..1). */ debris: number;
}
export const erosionDefaults = (): ErosionOpts => ({ rain: 0.5, strength: 0.5, thermal: 0.4, talus: 0.6, seed: 1, materials: 0.7, debris: 0.5 });

/**
 * Erodes a `nx` × `nz` grid of heights `cell` metres apart (in place) and returns the change at each point. Calls
 * `progress` (0..1) now and then and yields so the app keeps drawing; returns null if `progress` says stop.
 */
export interface ErosionResult {
  /** Change in height at each point (m). */ delta: Float32Array;
  /** How much water ran over each point (0..1, for wet dark channels). */ flow: Float32Array;
  /** Sediment dropped at each point (0..1: fans and valley floors). */ deposit: Float32Array;
  /** Loose material that slid in (0..1: scree at the foot of steep slopes). */ scree: Float32Array;
  /** Where the land was worn down (0..1: bare, weathered rock in gullies and on faces). */ wear: Float32Array;
}
export async function erodeGrid(h: Float32Array, nx: number, nz: number, cell: number, o: ErosionOpts, progress: (f: number) => boolean | void): Promise<ErosionResult | null> {
  const start = Float32Array.from(h);
  const flow = new Float32Array(h.length), dep = new Float32Array(h.length), scree = new Float32Array(h.length);
  let s = (o.seed * 2654435761) >>> 0 || 1; const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const at = (x: number, z: number) => { const i = Math.floor(x), j = Math.floor(z), u = x - i, v = z - j, k = j * nx + i; return h[k] * (1 - u) * (1 - v) + h[k + 1] * u * (1 - v) + h[k + nx] * (1 - u) * v + h[k + nx + 1] * u * v; };
  // Droplets: position, direction, speed, water, sediment.
  const drops = Math.round(nx * nz * 2 * Math.max(0, Math.min(1, o.rain)));
  const inertia = 0.05, capacityK = 4 * (0.3 + o.strength), deposit = 0.3, erode = 0.3 * (0.3 + o.strength), evaporate = 0.015, gravity = 4, maxSteps = 64, radius = 2;
  for (let d = 0; d < drops; d++) {
    let x = 1 + rnd() * (nx - 3), z = 1 + rnd() * (nz - 3), dx = 0, dz = 0, speed = 1, water = 1, sed = 0;
    for (let step = 0; step < maxSteps; step++) {
      const i = Math.floor(x), j = Math.floor(z), u = x - i, v = z - j, k = j * nx + i;
      flow[k] += water;
      // Slope here (bilinear gradient).
      const gx = (h[k + 1] - h[k]) * (1 - v) + (h[k + nx + 1] - h[k + nx]) * v, gz = (h[k + nx] - h[k]) * (1 - u) + (h[k + nx + 1] - h[k + 1]) * u;
      dx = dx * inertia - gx * (1 - inertia); dz = dz * inertia - gz * (1 - inertia);
      const len = Math.hypot(dx, dz); if (len < 1e-6) break;
      dx /= len; dz /= len;
      const hOld = at(x, z);
      x += dx; z += dz;
      if (x < 1 || z < 1 || x >= nx - 2 || z >= nz - 2) break;
      const dh = at(x, z) - hOld;
      const cap = Math.max(-dh * speed * water * capacityK, 0.01);
      if (sed > cap || dh > 0) {
        // Uphill or overloaded: drop sediment (fills the hollow it ran into).
        const amt = dh > 0 ? Math.min(dh, sed) : (sed - cap) * deposit;
        sed -= amt; dep[k] += amt;
        h[k] += amt * (1 - u) * (1 - v); h[k + 1] += amt * u * (1 - v); h[k + nx] += amt * (1 - u) * v; h[k + nx + 1] += amt * u * v;
      } else {
        // Downhill with room to carry: wear the ground away, spread over a small brush.
        // (At most a little per step: on a mountain face a droplet would otherwise carve a canyon in one run.)
        const amt = Math.min((cap - sed) * erode, -dh, 0.06 * cell * (0.4 + o.strength));
        let wsum = 0; const ws: [number, number][] = [];
        for (let b = -radius; b <= radius; b++) for (let a = -radius; a <= radius; a++) { const w = Math.max(0, radius - Math.hypot(a, b)); if (w > 0) { ws.push([(j + b) * nx + (i + a), w]); wsum += w; } }
        for (const [kk, w] of ws) { const take = Math.min(h[kk], (amt * w) / wsum); h[kk] -= take; }
        sed += amt;
      }
      speed = Math.min(6, Math.sqrt(Math.max(0, speed * speed + dh * -gravity)));
      water *= 1 - evaporate;
    }
    if (d % 4000 === 0) { if (progress(0.8 * (d / Math.max(1, drops))) === false) return null; await new Promise((r) => setTimeout(r, 0)); }
  }
  // Thermal: material above its resting slope slides to the lower neighbour.
  // (All points worked out from the same heights, then moved at once, shared among every lower neighbour: sweeping row
  // by row and moving into one neighbour at a time drew streaks along the grid.)
  const passes = Math.round(60 * Math.max(0, Math.min(1, o.thermal))), talus = Math.max(0.05, o.talus) * cell;
  const NB = [-1, 1, -nx, nx, -nx - 1, -nx + 1, nx - 1, nx + 1], ND = [1, 1, 1, 1, Math.SQRT2, Math.SQRT2, Math.SQRT2, Math.SQRT2];
  const move = new Float32Array(h.length);
  for (let p = 0; p < passes; p++) {
    move.fill(0);
    for (let j = 1; j < nz - 1; j++) for (let i = 1; i < nx - 1; i++) {
      const k = j * nx + i;
      let total = 0, most = 0;
      for (let q = 0; q < 8; q++) { const ex = h[k] - h[k + NB[q]] - talus * ND[q]; if (ex > 0) { total += ex; most = Math.max(most, ex); } }
      if (total <= 0) continue;
      const amt = most * 0.25;
      move[k] -= amt;
      for (let q = 0; q < 8; q++) { const ex = h[k] - h[k + NB[q]] - talus * ND[q]; if (ex > 0) { const m = (amt * ex) / total; move[k + NB[q]] += m; scree[k + NB[q]] += m; } }
    }
    for (let k = 0; k < h.length; k++) h[k] += move[k];
    if (p % 6 === 0) { if (progress(0.8 + 0.2 * (p / Math.max(1, passes))) === false) return null; await new Promise((r) => setTimeout(r, 0)); }
  }
  const out = new Float32Array(h.length);
  for (let k = 0; k < h.length; k++) out[k] = h[k] - start[k];
  // Masks to 0..1: flow on a log scale (a main channel carries thousands of times more than a hillside), sediment and
  // scree against a depth that reads as a full cover. Then a light blur, so the masks follow channels, not droplets.
  const norm = (a: Float32Array, f: (v: number) => number) => { for (let k = 0; k < a.length; k++) a[k] = Math.min(1, Math.max(0, f(a[k]))); };
  // (Each scaled by its own spread, the value most of the land stays under reading as full, so on any size of world only
  // the real channels, fans and worn faces stand out: a fixed depth turned most of a big world "worn" and "silted".)
  const pct = (a: Float32Array, p: number, f: (v: number) => number = (v) => v) => {
    const s: number[] = []; for (let k = 0; k < a.length; k += Math.max(1, Math.floor(a.length / 20000))) { const v = f(a[k]); if (v > 1e-6) s.push(v); }
    if (!s.length) return 1; s.sort((x, y) => x - y); return Math.max(1e-6, s[Math.min(s.length - 1, Math.floor(s.length * p))]);
  };
  const lf = (v: number) => Math.log(1 + v), fTop = pct(flow, 0.97, lf), fLow = pct(flow, 0.5, lf);
  norm(flow, (v) => (lf(v) - fLow) / Math.max(1e-6, fTop - fLow));
  const dTop = pct(dep, 0.9), sTop = pct(scree, 0.9);
  norm(dep, (v) => v / dTop); norm(scree, (v) => v / sTop);
  // Wear: where the land was worn down (rock exposed by water and sliding).
  const wear = new Float32Array(h.length);
  for (let k = 0; k < h.length; k++) wear[k] = Math.max(0, -out[k]);
  const wTop = pct(wear, 0.9); norm(wear, (v) => v / wTop);
  for (const a of [flow, dep, scree, wear]) {
    const b = Float32Array.from(a);
    for (let j = 1; j < nz - 1; j++) for (let i = 1; i < nx - 1; i++) { const k = j * nx + i; a[k] = (b[k] * 4 + b[k - 1] + b[k + 1] + b[k - nx] + b[k + nx]) / 8; }
  }
  progress(1);
  return { delta: out, flow, deposit: dep, scree, wear };
}
