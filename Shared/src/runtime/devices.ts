// The player's microphone and webcam, for bricks (Microphone: how loud the room is; Webcam: a live picture and how much
// moves in it). Everything stays on this computer: nothing here records or sends audio or pictures anywhere.
// A game asks only when a brick starts a device (the browser / app shows its permission prompt), and stopping the game
// releases both. Runs in the browser; without media devices (headless, old webviews) starting reports "unavailable".
export type DeviceState = 'off' | 'asking' | 'on' | 'denied' | 'unavailable';

class Mic {
  state: DeviceState = 'off';
  /** 0-100: how loud it is now, moving quickly up and slowly down. */
  level = 0;
  threshold = 30;
  private stream: MediaStream | null = null;
  private ctx: AudioContext | null = null;
  private an: AnalyserNode | null = null;
  private src: MediaStreamAudioSourceNode | null = null;
  private gain: GainNode | null = null;
  private buf: Float32Array | null = null;
  private asked = 0;

  async start(threshold: number) {
    this.threshold = threshold;
    if (this.state === 'on' || this.state === 'asking') return;
    const md = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined;
    if (!md?.getUserMedia) { this.state = 'unavailable'; return; }
    this.state = 'asking';
    const ticket = ++this.asked;
    try {
      const stream = await md.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: false } });
      if (ticket !== this.asked) { stream.getTracks().forEach((t) => t.stop()); return; } // stopped while it was asking
      this.stream = stream;
      this.ctx = new AudioContext();
      void this.ctx.resume();
      this.src = this.ctx.createMediaStreamSource(stream);
      this.an = this.ctx.createAnalyser(); this.an.fftSize = 1024;
      this.buf = new Float32Array(this.an.fftSize);
      this.src.connect(this.an);
      this.state = 'on';
    } catch { if (ticket === this.asked) this.state = 'denied'; }
  }
  /** Hear yourself through the game (use headphones: speakers feed back). */
  monitor(on: boolean, volume: number) {
    if (!this.ctx || !this.src) return;
    if (!this.gain) { this.gain = this.ctx.createGain(); this.src.connect(this.gain); this.gain.connect(this.ctx.destination); }
    this.gain.gain.value = on ? Math.max(0, volume) / 100 : 0;
  }
  sample() {
    if (this.state !== 'on' || !this.an || !this.buf) { this.level = this.state === 'on' ? this.level : 0; return; }
    this.an.getFloatTimeDomainData(this.buf);
    let sum = 0; for (let i = 0; i < this.buf.length; i++) sum += this.buf[i] * this.buf[i];
    const rms = Math.sqrt(sum / this.buf.length);
    // Speech at a normal distance reads about 20-40, shouting 60+: dB from -60 (silence) to 0, as 0-100.
    const now = rms > 1e-5 ? Math.max(0, Math.min(100, ((20 * Math.log10(rms) + 60) / 60) * 100)) : 0;
    this.level = now > this.level ? now : this.level + (now - this.level) * 0.15;
  }
  stop() {
    this.asked++;
    this.stream?.getTracks().forEach((t) => t.stop());
    void this.ctx?.close().catch(() => undefined);
    this.stream = null; this.ctx = null; this.an = null; this.src = null; this.gain = null; this.buf = null;
    this.state = 'off'; this.level = 0;
  }
}

class Webcam {
  state: DeviceState = 'off';
  /** The live picture (a renderer draws it onto objects). */
  video: HTMLVideoElement | null = null;
  /** 0-100: how much of the picture changed since a moment ago. */
  motion = 0;
  /** 0-100: how bright the room is. */
  brightness = 0;
  threshold = 15;
  /** Objects (by uid) showing the picture. */
  shownOn = new Set<number>();
  private stream: MediaStream | null = null;
  private asked = 0;
  private cv: CanvasRenderingContext2D | null = null;
  private prev: Uint8ClampedArray | null = null;
  private wait = 0;

  async start(threshold: number) {
    this.threshold = threshold;
    if (this.state === 'on' || this.state === 'asking') return;
    const md = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined;
    if (!md?.getUserMedia || typeof document === 'undefined') { this.state = 'unavailable'; return; }
    this.state = 'asking';
    const ticket = ++this.asked;
    try {
      const stream = await md.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 } } });
      if (ticket !== this.asked) { stream.getTracks().forEach((t) => t.stop()); return; }
      this.stream = stream;
      const v = document.createElement('video');
      v.muted = true; v.playsInline = true; v.srcObject = stream;
      await v.play().catch(() => undefined);
      this.video = v;
      const c = document.createElement('canvas'); c.width = 32; c.height = 24;
      this.cv = c.getContext('2d', { willReadFrequently: true });
      this.state = 'on';
    } catch { if (ticket === this.asked) this.state = 'denied'; }
  }
  sample(dt: number) {
    if (this.state !== 'on' || !this.video || !this.cv || this.video.readyState < 2) return;
    this.wait -= dt; if (this.wait > 0) return;
    this.wait = 0.1; // ten looks a second are plenty
    this.cv.drawImage(this.video, 0, 0, 32, 24);
    const d = this.cv.getImageData(0, 0, 32, 24).data;
    let moved = 0, light = 0;
    for (let i = 0; i < d.length; i += 4) {
      const y = (d[i] * 54 + d[i + 1] * 183 + d[i + 2] * 19) >> 8;
      light += y;
      if (this.prev && Math.abs(y - this.prev[i]) > 24) moved++;
      d[i] = y;
    }
    this.prev = d;
    const n = d.length / 4;
    this.motion = (moved / n) * 100; this.brightness = (light / n / 255) * 100;
  }
  stop() {
    this.asked++;
    this.stream?.getTracks().forEach((t) => t.stop());
    if (this.video) this.video.srcObject = null;
    this.stream = null; this.video = null; this.cv = null; this.prev = null;
    this.shownOn.clear();
    this.state = 'off'; this.motion = 0; this.brightness = 0;
  }
}

/** One of each per game (they carry on across scene changes; the game's stop releases them). */
export const mic = new Mic();
export const webcam = new Webcam();
export function stopDevices() { mic.stop(); webcam.stop(); }

interface TriggerHost { queueTrigger(id: string, picks: Record<string, any[]>, data?: any): void }
/** What the last tick saw, to fire "on" triggers once per change. */
const seen = { micState: 'off' as DeviceState, camState: 'off' as DeviceState, micLoud: false, camMoving: false, micWait: 0, camWait: 0 };
export function tickDevices(rt: TriggerHost, dt: number) {
  if (mic.state !== 'off') mic.sample();
  if (webcam.state !== 'off') webcam.sample(dt);
  if (mic.state !== seen.micState) {
    seen.micState = mic.state;
    if (mic.state === 'on') rt.queueTrigger('mic.on_ready', {});
    if (mic.state === 'denied' || mic.state === 'unavailable') rt.queueTrigger('mic.on_denied', {});
  }
  if (webcam.state !== seen.camState) {
    seen.camState = webcam.state;
    if (webcam.state === 'on') rt.queueTrigger('webcam.on_ready', {});
    if (webcam.state === 'denied' || webcam.state === 'unavailable') rt.queueTrigger('webcam.on_denied', {});
  }
  // "Heard" once per noise: it has to die down (a little under the threshold) before it can fire again.
  seen.micWait = Math.max(0, seen.micWait - dt); seen.camWait = Math.max(0, seen.camWait - dt);
  if (!seen.micLoud && mic.level >= mic.threshold && mic.state === 'on' && seen.micWait <= 0) { seen.micLoud = true; seen.micWait = 0.25; rt.queueTrigger('mic.on_noise', {}, { level: mic.level }); }
  else if (seen.micLoud && mic.level < mic.threshold * 0.8) seen.micLoud = false;
  if (!seen.camMoving && webcam.motion >= webcam.threshold && webcam.state === 'on' && seen.camWait <= 0) { seen.camMoving = true; seen.camWait = 0.25; rt.queueTrigger('webcam.on_motion', {}, { motion: webcam.motion }); }
  else if (seen.camMoving && webcam.motion < webcam.threshold * 0.8) seen.camMoving = false;
}
