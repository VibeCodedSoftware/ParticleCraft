// Performance figures for the Debug tab: frame times with history, where the time goes, what the renderer drew, and
// warnings. It only reports what can really be measured: GPU time where the browser offers a timer, the JS heap where it
// offers one, and graphics memory as an estimate from sizes (clearly called that in the panel).
import * as THREE from 'three';

export interface FrameSample { frameMs: number; drawMs: number; logicMs: number; moveMs: number; gpuMs: number | null }
export interface PerfFigures {
  fps: number; frameMs: number; worstMs: number; lowFps: number; drawMs: number; logicMs: number; moveMs: number; gpuMs: number | null; gpuTimer: boolean;
  calls: number; triangles: number; textures: number; geometries: number; programs: number; heapMb: number | null; vramMb: number;
}

const HISTORY = 300;

/** Plain-language warnings for a set of figures; the thresholds are for a 60 frames-a-second game. */
export function perfWarnings(f: Pick<PerfFigures, 'fps' | 'logicMs' | 'moveMs' | 'drawMs' | 'gpuMs' | 'calls' | 'triangles' | 'worstMs' | 'frameMs'>): string[] {
  const out: string[] = [];
  if (f.fps > 0 && f.fps < 30) out.push(`Low frame rate (${f.fps} fps): under 30.`);
  if (f.logicMs > 8) out.push(`Event sheets take ${f.logicMs.toFixed(1)} ms a frame: look for heavy Every tick events.`);
  if (f.moveMs > 8) out.push(`Movement and physics take ${f.moveMs.toFixed(1)} ms a frame: many moving objects, or a high fixed timestep.`);
  if (f.gpuMs != null && f.gpuMs > 14) out.push(`The graphics card needs ${f.gpuMs.toFixed(1)} ms a frame: try a lower render scale, cheaper shadows or fewer effects.`);
  if (f.calls > 1500) out.push(`${f.calls} draw calls: lots of separate objects. Use LOD and visibility ranges, or fewer objects.`);
  if (f.triangles > 3_000_000) out.push(`${(f.triangles / 1e6).toFixed(1)} million triangles: heavy for laptops and phones. Turn on LOD or use lighter models.`);
  if (f.worstMs > Math.max(50, f.frameMs * 3)) out.push(`Stutter: the slowest recent frame took ${Math.round(f.worstMs)} ms.`);
  return out;
}

/** Estimated graphics memory of a set of textures: width × height × 4 bytes, a third more with mipmaps. */
export function estimateTextureBytes(list: Iterable<{ width: number; height: number; mipmaps: boolean }>): number {
  let n = 0;
  for (const t of list) n += t.width * t.height * 4 * (t.mipmaps ? 4 / 3 : 1);
  return n;
}

export class FrameProfiler {
  readonly history: FrameSample[] = [];
  private lastFrame = 0;
  private drawStart = 0;
  private gl: WebGL2RenderingContext | null = null;
  private timerExt: any = null;
  private query: WebGLQuery | null = null;
  private querying = false;
  private lastGpu: number | null = null;
  /** The panel turns detail on: the GPU timer and texture scan only run while someone is looking. */
  detail = false;

  constructor(private renderer: THREE.WebGLRenderer) {
    this.gl = renderer.getContext() as WebGL2RenderingContext;
    this.timerExt = this.gl.getExtension('EXT_disjoint_timer_query_webgl2');
  }
  get hasGpuTimer() { return !!this.timerExt; }

  beginDraw() {
    this.drawStart = performance.now();
    if (this.detail && this.timerExt && !this.query) {
      this.query = this.gl!.createQuery();
      this.gl!.beginQuery(this.timerExt.TIME_ELAPSED_EXT, this.query!);
      this.querying = true;
    }
  }

  endDraw(logicMs: number, moveMs: number) {
    const now = performance.now(), gl = this.gl!;
    if (this.querying) { gl.endQuery(this.timerExt.TIME_ELAPSED_EXT); this.querying = false; }
    else if (this.query && gl.getQueryParameter(this.query, gl.QUERY_RESULT_AVAILABLE)) {
      if (!gl.getParameter(this.timerExt.GPU_DISJOINT_EXT)) this.lastGpu = gl.getQueryParameter(this.query, gl.QUERY_RESULT) / 1e6;
      gl.deleteQuery(this.query); this.query = null;
    }
    if (this.lastFrame) {
      this.history.push({ frameMs: now - this.lastFrame, drawMs: now - this.drawStart, logicMs, moveMs, gpuMs: this.lastGpu });
      if (this.history.length > HISTORY) this.history.shift();
    }
    this.lastFrame = now;
  }

  reset() { this.history.length = 0; this.lastFrame = 0; this.lastGpu = null; }

  figures(scene: THREE.Scene, calls: number, triangles: number): PerfFigures {
    const recent = this.history.slice(-60), n = Math.max(1, recent.length);
    const avg = (k: 'frameMs' | 'drawMs' | 'logicMs' | 'moveMs') => recent.reduce((a, s) => a + s[k], 0) / n;
    const frameMs = avg('frameMs');
    const sorted = this.history.map((s) => s.frameMs).sort((a, b) => a - b);
    const onePct = sorted.length ? sorted.slice(Math.floor(sorted.length * 0.99)).reduce((a, b) => a + b, 0) / Math.max(1, sorted.length - Math.floor(sorted.length * 0.99)) : 0;
    const seen = new Set<THREE.Texture>();
    scene.traverse((o) => {
      const mats = (o as THREE.Mesh).material; if (!mats) return;
      for (const m of ([] as THREE.Material[]).concat(mats)) for (const v of Object.values(m)) if ((v as THREE.Texture)?.isTexture) seen.add(v as THREE.Texture);
    });
    // Shadow maps usually weigh more than a simple scene's pictures.
    const maps: { width: number; height: number; mipmaps: boolean }[] = [];
    scene.traverse((o) => { const m = (o as THREE.Light).shadow?.map; if (m) maps.push({ width: m.width, height: m.height, mipmaps: false }); });
    const bytes = estimateTextureBytes([...[...seen].map((t) => ({ width: t.image?.width ?? 0, height: t.image?.height ?? 0, mipmaps: t.generateMipmaps })), ...maps]);
    const info = this.renderer.info;
    const mem = (performance as any).memory?.usedJSHeapSize as number | undefined;
    return {
      fps: frameMs > 0 ? Math.round(1000 / frameMs) : 0, frameMs, worstMs: sorted[sorted.length - 1] ?? 0, lowFps: onePct > 0 ? Math.round(1000 / onePct) : 0,
      drawMs: avg('drawMs'), logicMs: avg('logicMs'), moveMs: avg('moveMs'), gpuMs: this.lastGpu, gpuTimer: this.hasGpuTimer,
      calls, triangles, textures: info.memory.textures, geometries: info.memory.geometries, programs: info.programs?.length ?? 0,
      heapMb: mem != null ? mem / 1048576 : null, vramMb: bytes / 1048576,
    };
  }
}
