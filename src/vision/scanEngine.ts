import type { FaceDetector } from '@mediapipe/tasks-vision';
import { FaceTracker, type Track } from './tracker';
import { classifyFace, DEFAULT_THRESHOLDS, measurePixels } from './quality';
import { RollingMetrics } from './metrics';
import { mapContain } from './geometry';
import type { Detection, QualityLevel, QualityReason } from './types';

// Live scan loop: every new video frame is analysed in memory, drawn as boxes, and dropped.
// Nothing is stored, recorded or sent anywhere: the only state kept is numbers
// (boxes, scores, counters) for the current session.

export interface ScanStats {
  facesNow: number;
  quality: Record<QualityLevel, number>;
  uniqueFaces: number;
  maxSimultaneous: number;
  lostEvents: number;
  fps: number;
  avgMs: number;
  p95Ms: number;
  sessionAvgMs: number;
  frames: number;
  /** Mean luminance of the whole frame (0–255), sampled periodically. */
  frameBrightness?: number;
  /** ms from scan start to the first detected face (undefined until then). */
  firstFaceMs?: number;
  elapsedMs: number;
  videoW: number;
  videoH: number;
}

const COLORS: Record<QualityLevel, string> = { green: '#22c55e', yellow: '#facc15', red: '#ef4444' };
const SHARP_EVERY = 4; // re-measure sharpness of a face every N processed frames
const BRIGHT_EVERY = 15;
const CROP = 64;

type FrameCallbackVideo = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: () => void) => number;
  cancelVideoFrameCallback?: (id: number) => void;
};

export class LiveScanEngine {
  readonly tracker = new FaceTracker();
  readonly metrics = new RollingMetrics();
  private running = false;
  private handle = 0;
  private usingRVFC = false;
  private lastTs = 0;
  private startedAt = 0;
  private firstFaceMs?: number;
  private frameBrightness?: number;
  private lastStatsAt = 0;
  private sampler: CanvasRenderingContext2D;
  private samplerCanvas: HTMLCanvasElement;

  constructor(
    private video: FrameCallbackVideo,
    private overlay: HTMLCanvasElement,
    private detector: FaceDetector,
    private onStats: (s: ScanStats) => void,
    private reasonLabel: (r: QualityReason) => string,
  ) {
    this.samplerCanvas = document.createElement('canvas');
    this.samplerCanvas.width = CROP;
    this.samplerCanvas.height = CROP;
    const ctx = this.samplerCanvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('canvas2d unavailable');
    this.sampler = ctx;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.tracker.reset();
    this.metrics.reset();
    this.startedAt = performance.now();
    this.firstFaceMs = undefined;
    this.schedule();
  }

  stop() {
    this.running = false;
    if (this.usingRVFC) this.video.cancelVideoFrameCallback?.(this.handle);
    else cancelAnimationFrame(this.handle);
    const ctx = this.overlay.getContext('2d');
    ctx?.clearRect(0, 0, this.overlay.width, this.overlay.height);
    this.samplerCanvas.width = this.samplerCanvas.height = 0; // free memory
  }

  /** Final numbers for the session summary. */
  snapshot(): ScanStats {
    return this.buildStats(performance.now());
  }

  private schedule() {
    if (!this.running) return;
    // requestVideoFrameCallback fires once per NEW camera frame (Safari ≥ 15.4, Chrome);
    // requestAnimationFrame is the fallback.
    if (this.video.requestVideoFrameCallback) {
      this.usingRVFC = true;
      this.handle = this.video.requestVideoFrameCallback(() => this.tick());
    } else {
      this.usingRVFC = false;
      this.handle = requestAnimationFrame(() => this.tick());
    }
  }

  private tick() {
    if (!this.running) return;
    try {
      this.processFrame();
    } catch (e) {
      console.error('frame processing failed', e);
    }
    this.schedule();
  }

  private processFrame() {
    const v = this.video;
    if (v.readyState < 2 || !v.videoWidth) return;
    const vw = v.videoWidth;
    const vh = v.videoHeight;
    const t0 = performance.now();
    const ts = Math.max(t0, this.lastTs + 1); // MediaPipe needs strictly increasing timestamps
    this.lastTs = ts;

    const result = this.detector.detectForVideo(v, ts);
    const dets: Detection[] = [];
    for (const d of result.detections) {
      const b = d.boundingBox;
      if (!b) continue;
      const x = Math.max(0, b.originX);
      const y = Math.max(0, b.originY);
      const w = Math.min(vw, b.originX + b.width) - x;
      const h = Math.min(vh, b.originY + b.height) - y;
      if (w > 2 && h > 2) dets.push({ x, y, w, h, score: d.categories[0]?.score ?? 0 });
    }

    const tracks = this.tracker.update(dets);
    const frame = this.tracker.frame;
    for (const t of tracks) {
      if (t.misses > 0) {
        t.quality = { level: 'red', reasons: ['lost'] };
        continue;
      }
      if (frame - t.lastSharpAt >= SHARP_EVERY) this.measureFace(t);
      t.quality = classifyFace(
        { score: t.score, size: Math.min(t.box.w, t.box.h), sharpness: t.sharpness, brightness: t.brightness },
        DEFAULT_THRESHOLDS,
      );
    }
    if (frame % BRIGHT_EVERY === 1) this.measureFrameBrightness();

    const done = performance.now();
    this.metrics.add(done - t0, done);
    if (this.firstFaceMs === undefined && dets.length) this.firstFaceMs = done - this.startedAt;

    this.draw(tracks, vw, vh);
    if (done - this.lastStatsAt > 250) {
      this.lastStatsAt = done;
      this.onStats(this.buildStats(done));
    }
  }

  /** Measures sharpness/brightness of one face from the current frame; pixels are discarded at once. */
  private measureFace(t: Track) {
    const { x, y, w, h } = t.box;
    this.sampler.drawImage(this.video, x, y, w, h, 0, 0, CROP, CROP);
    const px = this.sampler.getImageData(0, 0, CROP, CROP);
    const m = measurePixels(px.data, CROP, CROP);
    t.sharpness = m.sharpness;
    t.brightness = m.brightness;
    t.lastSharpAt = this.tracker.frame;
  }

  private measureFrameBrightness() {
    this.sampler.drawImage(this.video, 0, 0, 32, 18);
    const px = this.sampler.getImageData(0, 0, 32, 18);
    this.frameBrightness = measurePixels(px.data, 32, 18).brightness;
  }

  private visible(tracks: Track[]) {
    return tracks.filter((t) => t.misses === 0);
  }

  private buildStats(now: number): ScanStats {
    const visible = this.visible(this.tracker.tracks);
    const quality = { green: 0, yellow: 0, red: 0 };
    for (const t of visible) quality[t.quality?.level ?? 'yellow']++;
    return {
      facesNow: visible.length,
      quality,
      uniqueFaces: this.tracker.stats.uniqueFaces,
      maxSimultaneous: this.tracker.stats.maxSimultaneous,
      lostEvents: this.tracker.stats.lostEvents,
      fps: this.metrics.fps(now),
      avgMs: this.metrics.avgMs(),
      p95Ms: this.metrics.p95Ms(),
      sessionAvgMs: this.metrics.sessionAvgMs(),
      frames: this.metrics.frames,
      frameBrightness: this.frameBrightness,
      firstFaceMs: this.firstFaceMs,
      elapsedMs: now - this.startedAt,
      videoW: this.video.videoWidth,
      videoH: this.video.videoHeight,
    };
  }

  private draw(tracks: Track[], vw: number, vh: number) {
    const c = this.overlay;
    const dpr = window.devicePixelRatio || 1;
    const cw = c.clientWidth;
    const ch = c.clientHeight;
    if (c.width !== Math.round(cw * dpr) || c.height !== Math.round(ch * dpr)) {
      c.width = Math.round(cw * dpr);
      c.height = Math.round(ch * dpr);
    }
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    ctx.font = '600 13px system-ui, -apple-system, sans-serif';
    ctx.textBaseline = 'bottom';
    for (const t of tracks) {
      const lost = t.misses > 0;
      if (lost && !t.confirmed) continue;
      const level = t.quality?.level ?? 'yellow';
      const r = mapContain(t.box, vw, vh, cw, ch);
      ctx.strokeStyle = COLORS[level];
      ctx.lineWidth = lost ? 2 : 3;
      ctx.setLineDash(lost ? [6, 6] : []);
      ctx.beginPath();
      ctx.roundRect?.(r.x, r.y, r.w, r.h, 8) ?? ctx.rect(r.x, r.y, r.w, r.h);
      ctx.stroke();
      const reason = t.quality?.reasons[0];
      if (reason) {
        const label = this.reasonLabel(reason);
        const tw = ctx.measureText(label).width + 10;
        ctx.setLineDash([]);
        ctx.fillStyle = COLORS[level];
        // Label above the box, or inside it when the box touches the top edge.
        const ly = r.y >= 20 ? r.y - 20 : r.y;
        ctx.fillRect(r.x, ly, tw, 20);
        ctx.fillStyle = level === 'yellow' ? '#0b1b3a' : '#fff';
        ctx.fillText(label, r.x + 5, ly + 16);
      }
    }
  }
}
