// Simulation Mode solvers. These are offline/experimental simulations that run in ParticleCraft only; the games
// get them as baked flipbooks (sprite sheets) or as real-time particle approximations — never as live solvers.
//   smoke, fire   2D stable-fluids grid (Stam): advection, pressure projection, buoyancy, vorticity confinement
//   water         2D particle fluid (Clavet double-density relaxation)
//   tornado       3D particle swarm in a Rankine vortex with updraft and inflow
//   wind          particles in a curl-noise flow field around an obstacle (potential flow)
//   destruction   a brick wall hit by a projectile; unsupported bricks fall as debris

export interface SimParam { key: string; label: string; min: number; max: number; step: number; default: number }
export interface Simulation {
  step(dt: number): void;
  /** Draw into a w×h area. transparent: no background (for baking flipbooks). */
  draw(ctx: CanvasRenderingContext2D, w: number, h: number, transparent: boolean, view?: { yaw: number; pitch: number }): void;
  /** Click / drag in normalized coords (0..1, y down). */
  poke?(x: number, y: number): void;
}
export interface SimType {
  id: string; name: string; icon: string; description: string;
  params: SimParam[];
  create(p: Record<string, number>): Simulation;
  /** Real-time particle preset that approximates this simulation, and how its params map onto that preset. */
  approx?: { preset: string; note: string };
  view3d?: boolean;
}

const P = (key: string, label: string, min: number, max: number, step: number, def: number): SimParam => ({ key, label, min, max, step, default: def });

// ------------------------------------------------------------------ stable fluids

class Fluid {
  n: number; size: number;
  u: Float32Array; v: Float32Array; u0: Float32Array; v0: Float32Array;
  d: Float32Array; d0: Float32Array; T: Float32Array; T0: Float32Array;
  t = 0;
  constructor(n: number, private p: Record<string, number>, private fire: boolean) {
    this.n = n; this.size = (n + 2) * (n + 2);
    const f = () => new Float32Array(this.size);
    this.u = f(); this.v = f(); this.u0 = f(); this.v0 = f(); this.d = f(); this.d0 = f(); this.T = f(); this.T0 = f();
  }
  IX(i: number, j: number) { return i + (this.n + 2) * j; }
  bnd(b: number, x: Float32Array) {
    const n = this.n, I = (i: number, j: number) => this.IX(i, j);
    for (let i = 1; i <= n; i++) {
      x[I(0, i)] = b === 1 ? -x[I(1, i)] : x[I(1, i)]; x[I(n + 1, i)] = b === 1 ? -x[I(n, i)] : x[I(n, i)];
      x[I(i, 0)] = b === 2 ? -x[I(i, 1)] : x[I(i, 1)]; x[I(i, n + 1)] = b === 2 ? -x[I(i, n)] : x[I(i, n)];
    }
  }
  advect(b: number, d: Float32Array, d0: Float32Array, u: Float32Array, v: Float32Array, dt: number) {
    const n = this.n, dt0 = dt * n;
    for (let j = 1; j <= n; j++) for (let i = 1; i <= n; i++) {
      let x = i - dt0 * u[this.IX(i, j)], y = j - dt0 * v[this.IX(i, j)];
      x = Math.max(0.5, Math.min(n + 0.5, x)); y = Math.max(0.5, Math.min(n + 0.5, y));
      const i0 = Math.floor(x), j0 = Math.floor(y), s1 = x - i0, t1 = y - j0, s0 = 1 - s1, t0 = 1 - t1;
      d[this.IX(i, j)] = s0 * (t0 * d0[this.IX(i0, j0)] + t1 * d0[this.IX(i0, j0 + 1)]) + s1 * (t0 * d0[this.IX(i0 + 1, j0)] + t1 * d0[this.IX(i0 + 1, j0 + 1)]);
    }
    this.bnd(b, d);
  }
  project() {
    const n = this.n, h = 1 / n, { u, v } = this, div = this.u0, p = this.v0;
    for (let j = 1; j <= n; j++) for (let i = 1; i <= n; i++) { div[this.IX(i, j)] = -0.5 * h * (u[this.IX(i + 1, j)] - u[this.IX(i - 1, j)] + v[this.IX(i, j + 1)] - v[this.IX(i, j - 1)]); p[this.IX(i, j)] = 0; }
    this.bnd(0, div); this.bnd(0, p);
    for (let k = 0; k < 16; k++) {
      for (let j = 1; j <= n; j++) for (let i = 1; i <= n; i++) p[this.IX(i, j)] = (div[this.IX(i, j)] + p[this.IX(i - 1, j)] + p[this.IX(i + 1, j)] + p[this.IX(i, j - 1)] + p[this.IX(i, j + 1)]) / 4;
      this.bnd(0, p);
    }
    for (let j = 1; j <= n; j++) for (let i = 1; i <= n; i++) { u[this.IX(i, j)] -= 0.5 * (p[this.IX(i + 1, j)] - p[this.IX(i - 1, j)]) / h; v[this.IX(i, j)] -= 0.5 * (p[this.IX(i, j + 1)] - p[this.IX(i, j - 1)]) / h; }
    this.bnd(1, u); this.bnd(2, v);
  }
  vorticity(eps: number, dt: number) {
    if (!eps) return;
    const n = this.n, w = this.d0;
    for (let j = 1; j <= n; j++) for (let i = 1; i <= n; i++) w[this.IX(i, j)] = 0.5 * (this.v[this.IX(i + 1, j)] - this.v[this.IX(i - 1, j)] - this.u[this.IX(i, j + 1)] + this.u[this.IX(i, j - 1)]);
    for (let j = 2; j < n; j++) for (let i = 2; i < n; i++) {
      const dx = Math.abs(w[this.IX(i + 1, j)]) - Math.abs(w[this.IX(i - 1, j)]), dy = Math.abs(w[this.IX(i, j + 1)]) - Math.abs(w[this.IX(i, j - 1)]);
      const len = Math.hypot(dx, dy) + 1e-5, c = w[this.IX(i, j)];
      this.u[this.IX(i, j)] += eps * dt * (dy / len) * c; this.v[this.IX(i, j)] -= eps * dt * (dx / len) * c;
    }
  }
  /** Add a source blob at grid coords. */
  splat(cx: number, cy: number, r: number, dens: number, heat: number, vx: number, vy: number) {
    const n = this.n;
    for (let j = Math.max(1, Math.floor(cy - r)); j <= Math.min(n, Math.ceil(cy + r)); j++) for (let i = Math.max(1, Math.floor(cx - r)); i <= Math.min(n, Math.ceil(cx + r)); i++) {
      const k = Math.exp(-((i - cx) ** 2 + (j - cy) ** 2) / (r * r));
      const id = this.IX(i, j);
      this.d[id] += dens * k; this.T[id] += heat * k; this.u[id] += vx * k; this.v[id] += vy * k;
    }
  }
  step(dt: number) {
    const p = this.p, n = this.n;
    this.t += dt;
    // Source at the bottom, flickering a little.
    const flick = 1 + 0.25 * Math.sin(this.t * 13) * Math.sin(this.t * 7.3);
    const r = (p.source ?? 0.12) * n;
    this.splat(n / 2 + Math.sin(this.t * 1.7) * r * 0.2, n - r * 0.7 - 2, r * 0.6, (this.fire ? p.smoke : p.density) * dt * 60 * flick, (this.fire ? p.heat : p.heat ?? 0.5) * dt * 60 * flick, 0, -(p.jet ?? 0.5) * dt * 30);
    for (let id = 0; id < this.size; id++) {
      this.v[id] -= (p.buoyancy * this.T[id] - (p.weight ?? 0.05) * this.d[id]) * dt;
      this.u[id] += (p.wind ?? 0) * dt;
    }
    this.vorticity(p.vorticity ?? 0, dt);
    this.u0.set(this.u); this.v0.set(this.v);
    this.advect(1, this.u, this.u0, this.u0, this.v0, dt); this.advect(2, this.v, this.v0, this.u0, this.v0, dt);
    this.project();
    this.d0.set(this.d); this.advect(0, this.d, this.d0, this.u, this.v, dt);
    this.T0.set(this.T); this.advect(0, this.T, this.T0, this.u, this.v, dt);
    const dd = Math.max(0, 1 - (p.dissipation ?? 0.3) * dt), td = Math.max(0, 1 - (p.cooling ?? 1) * dt);
    for (let id = 0; id < this.size; id++) { this.d[id] *= dd; this.T[id] *= td; }
    void n;
  }
  private img: ImageData | null = null;
  private tmp: HTMLCanvasElement | null = null;
  draw(ctx: CanvasRenderingContext2D, w: number, h: number, transparent: boolean) {
    const n = this.n;
    if (!this.tmp) { this.tmp = document.createElement('canvas'); this.tmp.width = n; this.tmp.height = n; this.img = this.tmp.getContext('2d')!.createImageData(n, n); }
    const data = this.img!.data;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const id = this.IX(i + 1, j + 1), o = (i + j * n) * 4;
      const d = Math.min(1, this.d[id]), t = Math.min(1.5, this.T[id]);
      if (this.fire) {
        // Blackbody-ish ramp for heat over a smoke color.
        const hr = Math.min(1, t * 1.6), hg = Math.min(1, Math.max(0, t * 1.4 - 0.35)), hb = Math.min(1, Math.max(0, t * 1.6 - 1.1));
        const a = Math.min(1, t * 1.4 + d * 0.6);
        const sm = 0.25 * (1 - Math.min(1, t * 2));
        data[o] = 255 * Math.min(1, hr + sm); data[o + 1] = 255 * Math.min(1, hg + sm); data[o + 2] = 255 * Math.min(1, hb + sm); data[o + 3] = 255 * a;
      } else {
        const g = 200 - 90 * d;
        data[o] = g; data[o + 1] = g; data[o + 2] = g + 8; data[o + 3] = 255 * Math.min(1, d * 1.3);
      }
    }
    this.tmp.getContext('2d')!.putImageData(this.img!, 0, 0);
    if (!transparent) { ctx.fillStyle = '#0d0f14'; ctx.fillRect(0, 0, w, h); }
    ctx.imageSmoothingEnabled = true;
    const s = Math.min(w, h);
    ctx.drawImage(this.tmp, (w - s) / 2, (h - s) / 2, s, s);
  }
  poke(x: number, y: number) { this.splat(x * this.n, y * this.n, this.n * 0.06, 2, this.fire ? 2 : 0.5, 0, 0); }
}

// ------------------------------------------------------------------ particle water

class Water {
  W = 10; H = 7;
  x: Float32Array; y: Float32Array; px: Float32Array; py: Float32Array; vx: Float32Array; vy: Float32Array;
  count = 0; max: number; t = 0;
  constructor(private p: Record<string, number>) {
    this.max = Math.round(p.count);
    const f = () => new Float32Array(this.max);
    this.x = f(); this.y = f(); this.px = f(); this.py = f(); this.vx = f(); this.vy = f();
    // Start with a block of water on the left.
    const h = p.radius;
    for (let k = 0; k < this.max * 0.6; k++) { const c = this.count++; this.x[c] = 0.3 + (k % 18) * h * 0.9; this.y[c] = 0.3 + Math.floor(k / 18) * h * 0.9; }
  }
  step(dt: number) {
    const p = this.p, h = p.radius, n = this.count;
    this.t += dt;
    if (p.pour > 0 && this.count < this.max) for (let k = 0; k < p.pour * dt * 60 && this.count < this.max; k++) { const c = this.count++; this.x[c] = this.W * 0.75 + Math.random() * 0.3; this.y[c] = this.H - 0.3; this.vx[c] = -1.5; this.vy[c] = -1; }
    for (let i = 0; i < n; i++) { this.vy[i] -= p.gravity * dt; this.px[i] = this.x[i]; this.py[i] = this.y[i]; this.x[i] += this.vx[i] * dt; this.y[i] += this.vy[i] * dt; }
    // Spatial hash.
    const cells = new Map<number, number[]>(); const key = (cx: number, cy: number) => cx * 4096 + cy;
    for (let i = 0; i < n; i++) { const k = key(Math.floor(this.x[i] / h), Math.floor(this.y[i] / h)); let l = cells.get(k); if (!l) cells.set(k, (l = [])); l.push(i); }
    const k0 = p.stiffness, kn = p.near, rho0 = p.rest;
    for (let i = 0; i < n; i++) {
      const cx = Math.floor(this.x[i] / h), cy = Math.floor(this.y[i] / h);
      const nb: number[] = [];
      let rho = 0, rhoN = 0;
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const j of cells.get(key(cx + a, cy + b)) ?? []) {
        if (j === i) continue;
        const q = Math.hypot(this.x[j] - this.x[i], this.y[j] - this.y[i]) / h;
        if (q < 1) { nb.push(j); rho += (1 - q) ** 2; rhoN += (1 - q) ** 3; }
      }
      const P = k0 * (rho - rho0), PN = kn * rhoN;
      let dx = 0, dy = 0;
      for (const j of nb) {
        const rx = this.x[j] - this.x[i], ry = this.y[j] - this.y[i], r = Math.hypot(rx, ry) || 1e-6, q = r / h;
        const D = dt * dt * (P * (1 - q) + PN * (1 - q) ** 2);
        const ux = (rx / r) * D * 0.5, uy = (ry / r) * D * 0.5;
        this.x[j] += ux; this.y[j] += uy; dx -= ux; dy -= uy;
        // Viscosity: pull velocities together.
        const vxr = this.vx[i] - this.vx[j], vyr = this.vy[i] - this.vy[j];
        const u = (vxr * rx + vyr * ry) / r;
        if (u > 0) { const I = dt * (1 - q) * p.viscosity * u * 0.5; this.vx[i] -= (I * rx) / r; this.vy[i] -= (I * ry) / r; this.vx[j] += (I * rx) / r; this.vy[j] += (I * ry) / r; }
      }
      this.x[i] += dx; this.y[i] += dy;
    }
    // Walls and the round obstacle.
    const ox = this.W * 0.55, oy = 1.4, orad = p.obstacle;
    for (let i = 0; i < n; i++) {
      if (this.x[i] < 0.05) this.x[i] = 0.05; if (this.x[i] > this.W - 0.05) this.x[i] = this.W - 0.05;
      if (this.y[i] < 0.05) this.y[i] = 0.05; if (this.y[i] > this.H) this.y[i] = this.H;
      if (orad > 0) { const ax = this.x[i] - ox, ay = this.y[i] - oy, r = Math.hypot(ax, ay); if (r < orad) { this.x[i] = ox + (ax / r) * orad; this.y[i] = oy + (ay / r) * orad; } }
      this.vx[i] = (this.x[i] - this.px[i]) / dt; this.vy[i] = (this.y[i] - this.py[i]) / dt;
    }
  }
  draw(ctx: CanvasRenderingContext2D, w: number, h: number, transparent: boolean) {
    if (!transparent) { ctx.fillStyle = '#0d0f14'; ctx.fillRect(0, 0, w, h); }
    const s = Math.min(w / this.W, h / this.H), ox = (w - this.W * s) / 2, oy = (h + this.H * s) / 2;
    if (!transparent) { ctx.strokeStyle = '#2a3140'; ctx.strokeRect(ox, oy - this.H * s, this.W * s, this.H * s); }
    if (this.p.obstacle > 0) { ctx.fillStyle = '#3a3f4a'; ctx.beginPath(); ctx.arc(ox + this.W * 0.55 * s, oy - 1.4 * s, this.p.obstacle * s, 0, Math.PI * 2); ctx.fill(); }
    const r = this.p.radius * s * 0.75;
    for (let i = 0; i < this.count; i++) {
      const sp = Math.min(1, Math.hypot(this.vx[i], this.vy[i]) / 6);
      ctx.fillStyle = `rgba(${60 + 170 * sp | 0},${150 + 90 * sp | 0},255,0.75)`;
      ctx.beginPath(); ctx.arc(ox + this.x[i] * s, oy - this.y[i] * s, r, 0, Math.PI * 2); ctx.fill();
    }
  }
  poke(x: number, y: number) {
    const cx = x * this.W, cy = (1 - y) * this.H;
    for (let k = 0; k < 25 && this.count < this.max; k++) { const c = this.count++; this.x[c] = cx + (Math.random() - 0.5) * 0.4; this.y[c] = cy + (Math.random() - 0.5) * 0.4; this.vx[c] = 0; this.vy[c] = -2; }
  }
}

// ------------------------------------------------------------------ tornado

class Tornado {
  n: number; x: Float32Array; y: Float32Array; z: Float32Array; kind: Uint8Array; t = 0;
  constructor(private p: Record<string, number>) {
    this.n = Math.round(p.particles + p.debris);
    this.x = new Float32Array(this.n); this.y = new Float32Array(this.n); this.z = new Float32Array(this.n); this.kind = new Uint8Array(this.n);
    for (let i = 0; i < this.n; i++) { this.kind[i] = i >= p.particles ? 1 : 0; this.respawn(i, Math.random() * p.height); }
  }
  respawn(i: number, y = 0) { const a = Math.random() * Math.PI * 2, r = this.p.core * (1.5 + Math.random() * 3); this.x[i] = Math.cos(a) * r; this.z[i] = Math.sin(a) * r; this.y[i] = y; }
  step(dt: number) {
    const p = this.p; this.t += dt;
    for (let i = 0; i < this.n; i++) {
      const x = this.x[i], z = this.z[i], y = this.y[i];
      const rc = p.core * (1 + (y / p.height) * p.flare);
      const r = Math.hypot(x, z) || 1e-4;
      // Rankine vortex: solid-body rotation inside the core, 1/r outside.
      const vt = (r < rc ? (p.swirl * r) / rc : (p.swirl * rc) / r) * (this.kind[i] ? 0.8 : 1);
      const inflow = -p.inflow * Math.max(0, 1 - y / (p.height * 0.35)) * Math.min(1, r / rc);
      const up = p.updraft * Math.exp(-((r / (rc * 1.6)) ** 2)) - (this.kind[i] ? 2.5 : 0);
      const tx = -z / r, tz = x / r;
      this.x[i] += (tx * vt + (x / r) * inflow + Math.sin(this.t * 3 + i) * 0.2) * dt;
      this.z[i] += (tz * vt + (z / r) * inflow) * dt;
      this.y[i] += up * dt;
      if (this.y[i] > p.height || this.y[i] < -0.1 || r > p.core * 8) this.respawn(i);
    }
  }
  draw(ctx: CanvasRenderingContext2D, w: number, h: number, transparent: boolean, view = { yaw: 0.5, pitch: 0.15 }) {
    if (!transparent) { const g = ctx.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#2b3442'); g.addColorStop(1, '#14171d'); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h); }
    const H = this.p.height, f = Math.min(w, h) * 1.2, dist = H * 1.6;
    const cy = Math.cos(view.yaw), sy = Math.sin(view.yaw), cp = Math.cos(view.pitch), sp = Math.sin(view.pitch);
    const proj = (x: number, y: number, z: number) => { const X = x * cy - z * sy, Z = x * sy + z * cy; const Y = (y - H * 0.45) * cp - Z * sp, Z2 = (y - H * 0.45) * sp + Z * cp; const d = dist + Z2; return d > 0.1 ? { x: w / 2 + (X * f) / d, y: h / 2 - (Y * f) / d, s: dist / d } : null; };
    if (!transparent) { ctx.strokeStyle = 'rgba(255,255,255,.06)'; for (let k = -4; k <= 4; k++) { const a = proj(k * 2, 0, -8), b = proj(k * 2, 0, 8), c = proj(-8, 0, k * 2), d = proj(8, 0, k * 2); if (a && b) { ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); } if (c && d) { ctx.beginPath(); ctx.moveTo(c.x, c.y); ctx.lineTo(d.x, d.y); ctx.stroke(); } } }
    for (let i = 0; i < this.n; i++) {
      const q = proj(this.x[i], this.y[i], this.z[i]); if (!q) continue;
      if (this.kind[i]) { ctx.fillStyle = 'rgba(70,52,34,0.95)'; ctx.fillRect(q.x - 2 * q.s, q.y - 2 * q.s, 4 * q.s, 3 * q.s); }
      else { const a = 0.18 + 0.25 * (1 - this.y[i] / H); ctx.fillStyle = `rgba(170,160,145,${a})`; ctx.beginPath(); ctx.arc(q.x, q.y, 5 * q.s, 0, Math.PI * 2); ctx.fill(); }
    }
  }
}

// ------------------------------------------------------------------ wind

class Wind {
  n: number; x: Float32Array; y: Float32Array; px: Float32Array; py: Float32Array; age: Float32Array; t = 0;
  ox = 0.4; oy = 0.5;
  constructor(private p: Record<string, number>) {
    this.n = Math.round(p.particles);
    const f = () => new Float32Array(this.n);
    this.x = f(); this.y = f(); this.px = f(); this.py = f(); this.age = f();
    for (let i = 0; i < this.n; i++) { this.x[i] = Math.random(); this.y[i] = Math.random(); this.px[i] = this.x[i]; this.py[i] = this.y[i]; this.age[i] = Math.random() * 3; }
  }
  vel(x: number, y: number): [number, number] {
    const p = this.p, s = p.scale, t = this.t;
    const gust = 1 + p.gust * Math.sin(t * 0.9) * Math.sin(t * 0.37 + 1);
    let u = p.speed * gust, v = 0;
    // Curl of a smooth potential gives swirling, incompressible-looking turbulence.
    const e = 0.002, pot = (a: number, b: number) => Math.sin(a * s * 6 + t * 0.7) * Math.cos(b * s * 5 - t * 0.5) + 0.5 * Math.sin((a + b) * s * 11 + t);
    u += p.turbulence * (pot(x, y + e) - pot(x, y - e)) / (2 * e) * 0.02;
    v -= p.turbulence * (pot(x + e, y) - pot(x - e, y)) / (2 * e) * 0.02;
    // Flow around a cylinder (potential flow), in normalized units.
    const R = p.obstacle; if (R > 0) { const dx = x - this.ox, dy = y - this.oy, r2 = dx * dx + dy * dy; if (r2 > R * R * 0.5) { const R2 = R * R, r4 = r2 * r2; u += p.speed * gust * (-(R2 * (dx * dx - dy * dy)) / r4); v += p.speed * gust * (-(2 * R2 * dx * dy) / r4); } }
    return [u, v];
  }
  step(dt: number) {
    this.t += dt;
    for (let i = 0; i < this.n; i++) {
      this.px[i] = this.x[i]; this.py[i] = this.y[i];
      const [u, v] = this.vel(this.x[i], this.y[i]);
      this.x[i] += u * dt * 0.1; this.y[i] += v * dt * 0.1; this.age[i] += dt;
      const R = this.p.obstacle;
      if (this.x[i] > 1.02 || this.x[i] < -0.02 || this.y[i] < -0.02 || this.y[i] > 1.02 || this.age[i] > 4 || (R > 0 && Math.hypot(this.x[i] - this.ox, this.y[i] - this.oy) < R * 0.9)) {
        this.x[i] = Math.random() * 0.05; this.y[i] = Math.random(); this.px[i] = this.x[i]; this.py[i] = this.y[i]; this.age[i] = 0;
      }
    }
  }
  draw(ctx: CanvasRenderingContext2D, w: number, h: number, transparent: boolean) {
    if (!transparent) { ctx.fillStyle = 'rgba(13,15,20,0.25)'; ctx.fillRect(0, 0, w, h); }
    if (this.p.obstacle > 0 && !transparent) { ctx.fillStyle = '#3a3f4a'; ctx.beginPath(); ctx.arc(this.ox * w, this.oy * h, this.p.obstacle * Math.min(w, h), 0, Math.PI * 2); ctx.fill(); }
    ctx.lineWidth = 1.4; ctx.lineCap = 'round';
    for (let i = 0; i < this.n; i++) {
      const a = Math.min(1, this.age[i]) * Math.max(0, 1 - this.age[i] / 4);
      ctx.strokeStyle = `rgba(190,220,255,${0.7 * a})`;
      ctx.beginPath(); ctx.moveTo(this.px[i] * w, this.py[i] * h); ctx.lineTo(this.x[i] * w + (this.x[i] - this.px[i]) * w * 3, this.y[i] * h + (this.y[i] - this.py[i]) * h * 3); ctx.stroke();
    }
  }
  poke(x: number, y: number) { this.ox = x; this.oy = y; }
}

// ------------------------------------------------------------------ destruction

interface Brick { x: number; y: number; vx: number; vy: number; a: number; av: number; loose: boolean; c: string; alive: boolean }
class Destruction {
  bricks: Brick[] = []; ball = { x: -1, y: 1.2, vx: 0, vy: 0, r: 0.35, on: false }; cols: number; rows: number; bw: number; bh: number; t = 0;
  constructor(private p: Record<string, number>) {
    this.cols = Math.round(p.cols); this.rows = Math.round(p.rows);
    this.bw = 4 / this.cols; this.bh = 3 / this.rows;
    for (let j = 0; j < this.rows; j++) for (let i = 0; i < this.cols; i++) {
      const shade = 150 + ((i * 7 + j * 13) % 5) * 12;
      this.bricks.push({ x: 4 + i * this.bw + (j % 2 ? this.bw / 2 : 0) + this.bw / 2, y: j * this.bh + this.bh / 2, vx: 0, vy: 0, a: 0, av: 0, loose: false, c: `rgb(${shade},${shade * 0.55 | 0},${shade * 0.4 | 0})`, alive: true });
    }
    this.fire();
  }
  fire() { this.ball = { x: -0.5, y: 1.2 + Math.random() * 1, vx: this.p.speed, vy: 1.5, r: 0.35, on: true }; }
  step(dt: number) {
    const p = this.p, g = p.gravity; this.t += dt;
    const b = this.ball;
    if (b.on) {
      b.vy -= g * dt; b.x += b.vx * dt; b.y += b.vy * dt;
      if (b.y < b.r) { b.y = b.r; b.vy = -b.vy * 0.4; b.vx *= 0.8; }
      for (const k of this.bricks) {
        if (k.loose) continue;
        if (Math.abs(k.x - b.x) < this.bw / 2 + b.r && Math.abs(k.y - b.y) < this.bh / 2 + b.r) {
          // Break everything within the blast radius and throw it.
          for (const q of this.bricks) {
            const d = Math.hypot(q.x - b.x, q.y - b.y);
            if (!q.loose && d < p.blast) { q.loose = true; const f = (1 - d / p.blast) * b.vx * 0.6; q.vx = f + (Math.random() - 0.3) * 2; q.vy = (q.y - b.y) * 2 + Math.random() * 2; q.av = (Math.random() - 0.5) * 12; }
          }
          b.vx *= 0.45;
          break;
        }
      }
    }
    // Unsupported bricks fall: a fixed brick needs the ground or a fixed brick under it.
    let changed = true;
    while (changed) {
      changed = false;
      for (const k of this.bricks) {
        if (k.loose || k.y < this.bh) continue;
        const supported = this.bricks.some((q) => !q.loose && q !== k && Math.abs(q.y - (k.y - this.bh)) < 0.01 && Math.abs(q.x - k.x) < this.bw * 0.95);
        if (!supported) { k.loose = true; k.vx = (Math.random() - 0.5) * 0.4; changed = true; }
      }
    }
    for (const k of this.bricks) {
      if (!k.loose) continue;
      k.vy -= g * dt; k.x += k.vx * dt; k.y += k.vy * dt; k.a += k.av * dt;
      const floor = this.bh / 2;
      if (k.y < floor) { k.y = floor; k.vy = -k.vy * p.bounce; k.vx *= 1 - p.friction; k.av *= 0.6; if (Math.abs(k.vy) < 0.3) k.vy = 0; }
    }
    // Keep loose pieces from sinking into each other (cheap pairwise push).
    const loose = this.bricks.filter((k) => k.loose);
    for (let i = 0; i < loose.length; i++) for (let j = i + 1; j < loose.length; j++) {
      const a = loose[i], c = loose[j], dx = c.x - a.x, dy = c.y - a.y, d = Math.hypot(dx, dy), m = this.bh * 0.9;
      if (d > 0 && d < m) { const push = (m - d) / 2; a.x -= (dx / d) * push; a.y -= (dy / d) * push; c.x += (dx / d) * push; c.y += (dy / d) * push; }
    }
  }
  draw(ctx: CanvasRenderingContext2D, w: number, h: number, transparent: boolean) {
    if (!transparent) { ctx.fillStyle = '#0d0f14'; ctx.fillRect(0, 0, w, h); }
    const s = Math.min(w / 11, h / 6), ox = w * 0.1, oy = h * 0.9;
    if (!transparent) { ctx.fillStyle = '#2a2f38'; ctx.fillRect(0, oy, w, h - oy); }
    for (const k of this.bricks) {
      ctx.save(); ctx.translate(ox + k.x * s, oy - k.y * s); ctx.rotate(-k.a);
      ctx.fillStyle = k.c; ctx.fillRect((-this.bw / 2) * s + 0.5, (-this.bh / 2) * s + 0.5, this.bw * s - 1, this.bh * s - 1);
      ctx.restore();
    }
    const b = this.ball;
    if (b.on) { ctx.fillStyle = '#c9d2de'; ctx.beginPath(); ctx.arc(ox + b.x * s, oy - b.y * s, b.r * s, 0, Math.PI * 2); ctx.fill(); }
  }
  poke() { this.fire(); }
}

// ------------------------------------------------------------------ catalog

export const SIM_TYPES: SimType[] = [
  { id: 'fire', name: 'Fire', icon: 'flame', description: 'Buoyant flames on a fluid grid: heat rises, cools and turns to smoke.', approx: { preset: 'campfire', note: 'Particle flames, embers and smoke' },
    params: [P('heat', 'Heat', 0, 3, 0.05, 1.2), P('smoke', 'Smoke', 0, 2, 0.05, 0.4), P('buoyancy', 'Buoyancy', 0, 40, 0.5, 14), P('cooling', 'Cooling', 0, 5, 0.05, 1.6), P('vorticity', 'Swirl detail', 0, 60, 1, 22), P('wind', 'Wind', -3, 3, 0.05, 0), P('source', 'Source size', 0.04, 0.3, 0.01, 0.12), P('dissipation', 'Smoke fade', 0, 3, 0.05, 0.5)],
    create: (p) => new Fluid(72, p, true) },
  { id: 'smoke', name: 'Smoke', icon: 'wind', description: 'Rising, curling smoke from a fluid simulation.', approx: { preset: 'smoke-plume', note: 'Particle smoke plume' },
    params: [P('density', 'Density', 0, 3, 0.05, 0.9), P('heat', 'Warmth', 0, 2, 0.05, 0.6), P('buoyancy', 'Buoyancy', 0, 30, 0.5, 8), P('weight', 'Weight', 0, 1, 0.01, 0.05), P('vorticity', 'Swirl detail', 0, 60, 1, 14), P('wind', 'Wind', -3, 3, 0.05, 0.3), P('dissipation', 'Fade', 0, 3, 0.05, 0.25), P('cooling', 'Cooling', 0, 5, 0.05, 0.6), P('source', 'Source size', 0.04, 0.3, 0.01, 0.1)],
    create: (p) => new Fluid(72, p, false) },
  { id: 'water', name: 'Water', icon: 'waves', description: 'Particle-based liquid that sloshes, pours and splashes around an obstacle. Click to drop water.', approx: { preset: 'splash', note: 'Splash droplets' },
    params: [P('count', 'Particles', 200, 1400, 50, 700), P('gravity', 'Gravity', 0, 20, 0.5, 9.8), P('radius', 'Particle spacing', 0.15, 0.5, 0.01, 0.28), P('stiffness', 'Stiffness', 5, 120, 1, 40), P('near', 'Near stiffness', 5, 200, 1, 80), P('rest', 'Rest density', 1, 10, 0.1, 4), P('viscosity', 'Viscosity', 0, 5, 0.05, 0.6), P('pour', 'Pour rate', 0, 8, 0.5, 2), P('obstacle', 'Obstacle', 0, 1.5, 0.05, 0.6)],
    create: (p) => new Water(p) },
  { id: 'tornado', name: 'Tornado', icon: 'tornado', description: 'A Rankine vortex with updraft and inflow that lifts dust and debris. Drag to orbit.', view3d: true, approx: { preset: 'tornado', note: 'Vortex particles with debris' },
    params: [P('swirl', 'Swirl speed', 1, 40, 0.5, 14), P('core', 'Core radius', 0.2, 2, 0.05, 0.6), P('flare', 'Funnel flare', 0, 6, 0.1, 2.5), P('updraft', 'Updraft', 0, 20, 0.5, 6), P('inflow', 'Inflow', 0, 10, 0.1, 2.5), P('height', 'Height', 3, 14, 0.5, 8), P('particles', 'Dust particles', 200, 3000, 100, 1600), P('debris', 'Debris', 0, 400, 10, 120)],
    create: (p) => new Tornado(p) },
  { id: 'wind', name: 'Wind', icon: 'wind', description: 'Gusty, turbulent air streaming around an obstacle. Click to move the obstacle.', approx: { preset: 'wind', note: 'Streaking wind particles' },
    params: [P('speed', 'Wind speed', 0, 6, 0.1, 2.5), P('turbulence', 'Turbulence', 0, 4, 0.05, 1.2), P('scale', 'Eddy scale', 0.2, 3, 0.05, 1), P('gust', 'Gusts', 0, 1, 0.05, 0.35), P('obstacle', 'Obstacle size', 0, 0.25, 0.01, 0.1), P('particles', 'Particles', 200, 3000, 100, 1200)],
    create: (p) => new Wind(p) },
  { id: 'destruction', name: 'Destruction', icon: 'brick-wall', description: 'A projectile smashes a brick wall; unsupported bricks collapse as debris. Click to fire again.', approx: { preset: 'explosion', note: 'Burst of debris and smoke' },
    params: [P('speed', 'Impact speed', 2, 30, 0.5, 14), P('blast', 'Break radius', 0.3, 3, 0.05, 1.2), P('cols', 'Bricks across', 4, 16, 1, 9), P('rows', 'Bricks high', 3, 14, 1, 9), P('gravity', 'Gravity', 0, 25, 0.5, 9.8), P('bounce', 'Bounce', 0, 0.9, 0.01, 0.25), P('friction', 'Ground friction', 0, 1, 0.01, 0.3)],
    create: (p) => new Destruction(p) },
];

export const defaultsOf = (t: SimType) => Object.fromEntries(t.params.map((p) => [p.key, p.default]));

/**
 * Bake a simulation to a horizontal flipbook strip (game-ready sprite sheet): restart it, let it settle, then
 * capture `frames` frames on a transparent background.
 */
export function bakeFlipbook(t: SimType, params: Record<string, number>, o: { frames: number; size: number; fps: number; warmup: number; view?: { yaw: number; pitch: number } }) {
  const sim = t.create(params);
  const dt = 1 / 60;
  for (let k = 0; k < o.warmup * 60; k++) sim.step(dt);
  const sheet = document.createElement('canvas');
  sheet.width = o.size * o.frames; sheet.height = o.size;
  const ctx = sheet.getContext('2d')!;
  const per = Math.max(1, Math.round(60 / o.fps));
  for (let f = 0; f < o.frames; f++) {
    for (let k = 0; k < per; k++) sim.step(dt);
    ctx.save(); ctx.translate(f * o.size, 0); ctx.beginPath(); ctx.rect(0, 0, o.size, o.size); ctx.clip();
    sim.draw(ctx, o.size, o.size, true, o.view);
    ctx.restore();
  }
  return { image: sheet.toDataURL('image/png'), frames: o.frames, fps: o.fps, loop: true, width: sheet.width, height: sheet.height };
}
