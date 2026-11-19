import type { FaceDetector } from '@mediapipe/tasks-vision';
import { RollingMetrics } from './metrics';
import { mapContain } from './geometry';
import { FrameAnalyzer, type FarMode } from './analyzer';
import type { Track } from './tracker';
import type { QualityLevel, QualityReason } from './types';

export type { FarMode } from './analyzer';

// Live scan loop: every new video frame is analysed in memory, drawn as boxes, and dropped.
// Nothing is stored, recorded or sent anywhere: the only state kept is numbers
// (boxes, scores, counters) for the current session.

export interface TilingConfig {
  mode: FarMode;
  tileDetector?: FaceDetector;
}

export interface ScanStats {
  /** Faces visible at the same time right now. */
  facesNow: number;
  quality: Record<QualityLevel, number>;
  /** Distinct anonymous faces counted during the session (approximate). */
  uniqueFaces: number;
  /** Highest number of faces visible at the same time during the session. */
  maxSimultaneous: number;
  lostEvents: number;
  /** Faces that returned and kept their earlier number (not re-counted). */
  relinked: number;
  fps: number;
  avgMs: number;
  p95Ms: number;
  sessionAvgMs: number;
  frames: number;
  frameBrightness?: number;
  firstFaceMs?: number;
  elapsedMs: number;
  videoW: number;
  videoH: number;
  /** Model runs per processed frame (1 = whole frame only). */
  inferencesPerFrame: number;
  tileCount: number;
  /** Visible faces currently found only thanks to tiles. */
  facesViaTiles: number;
  /** JS heap in MB where the browser exposes it (Chromium); undefined on Safari. */
  heapMB?: number;
}

const COLORS: Record<QualityLevel, string> = { green: '#22c55e', yellow: '#facc15', red: '#ef4444' };
/** Above this many faces, per-box text labels are hidden to keep the view readable. */
const LABEL_MAX_FACES = 12;

type FrameCallbackVideo = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: () => void) => number;
  cancelVideoFrameCallback?: (id: number) => void;
};

export class LiveScanEngine {
  readonly analyzer: FrameAnalyzer;
  readonly metrics = new RollingMetrics();
  private running = false;
  private handle = 0;
  private usingRVFC = false;
  private startedAt = 0;
  private firstFaceMs?: number;
  private lastStatsAt = 0;
  private lastInferences = 1;

  constructor(
    private video: FrameCallbackVideo,
    private overlay: HTMLCanvasElement,
    detector: FaceDetector,
    private onStats: (s: ScanStats) => void,
    private reasonLabel: (r: QualityReason) => string,
    tiling: TilingConfig = { mode: 'off' },
  ) {
    this.analyzer = new FrameAnalyzer({ detector, tileDetector: tiling.tileDetector, far: tiling.mode });
  }

  get tracker() {
    return this.analyzer.tracker;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.analyzer.reset();
    this.metrics.reset();
    this.startedAt = performance.now();
    this.firstFaceMs = undefined;
    // Development-only hook for diagnosing tracking (stripped from production builds).
    if (import.meta.env.DEV) (window as unknown as { __hodoorEngine?: LiveScanEngine }).__hodoorEngine = this;
    this.schedule();
  }

  stop() {
    this.running = false;
    if (this.usingRVFC) this.video.cancelVideoFrameCallback?.(this.handle);
    else cancelAnimationFrame(this.handle);
    this.overlay.getContext('2d')?.clearRect(0, 0, this.overlay.width, this.overlay.height);
    this.analyzer.dispose();
  }

  /** Final numbers for the session summary. */
  snapshot(): ScanStats {
    return this.buildStats(performance.now());
  }

  private schedule() {
    if (!this.running) return;
    // requestVideoFrameCallback fires once per NEW camera frame (Safari ≥ 15.4, Chrome).
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
    const r = this.analyzer.analyze(v, vw, vh);
    const done = performance.now();
    this.metrics.add(r.timings.totalMs, done);
    this.lastInferences = 1 + r.timings.tilesRun;
    if (this.firstFaceMs === undefined && r.detections) this.firstFaceMs = done - this.startedAt;
    this.draw(r.tracks, r.visible.length, vw, vh);
    if (done - this.lastStatsAt > 250) {
      this.lastStatsAt = done;
      this.onStats(this.buildStats(done));
    }
  }

  private buildStats(now: number): ScanStats {
    const tr = this.analyzer.tracker;
    const visible = tr.tracks.filter((t) => t.confirmed && tr.isVisible(t));
    const quality = { green: 0, yellow: 0, red: 0 };
    for (const t of visible) quality[t.quality?.level ?? 'yellow']++;
    const mem = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
    return {
      facesNow: visible.length,
      quality,
      uniqueFaces: tr.stats.uniqueFaces,
      maxSimultaneous: tr.stats.maxSimultaneous,
      lostEvents: tr.stats.lostEvents,
      relinked: tr.stats.relinked,
      fps: this.metrics.fps(now),
      avgMs: this.metrics.avgMs(),
      p95Ms: this.metrics.p95Ms(),
      sessionAvgMs: this.metrics.sessionAvgMs(),
      frames: this.metrics.frames,
      frameBrightness: this.analyzer.frameBrightness,
      firstFaceMs: this.firstFaceMs,
      elapsedMs: now - this.startedAt,
      videoW: this.video.videoWidth,
      videoH: this.video.videoHeight,
      inferencesPerFrame: this.lastInferences,
      tileCount: this.analyzer.tileCount,
      facesViaTiles: visible.filter((t) => t.source === 'tile').length,
      heapMB: mem ? Math.round(mem.usedJSHeapSize / 1048576) : undefined,
    };
  }

  private draw(tracks: Track[], visibleCount: number, vw: number, vh: number) {
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
    const labels = visibleCount <= LABEL_MAX_FACES;
    const tr = this.analyzer.tracker;
    for (const t of tracks) {
      if (!t.confirmed) continue; // one-off detections are not drawn (avoids false-positive flashes)
      const lost = !tr.isVisible(t);
      const level = t.quality?.level ?? 'yellow';
      const r = mapContain(t.box, vw, vh, cw, ch);
      ctx.strokeStyle = COLORS[level];
      ctx.lineWidth = lost ? 2 : visibleCount > 20 ? 2 : 3;
      ctx.setLineDash(lost ? [6, 6] : []);
      ctx.beginPath();
      ctx.roundRect?.(r.x, r.y, r.w, r.h, Math.min(8, r.w / 4)) ?? ctx.rect(r.x, r.y, r.w, r.h);
      ctx.stroke();
      const reason = t.quality?.reasons[0];
      if (labels && reason) {
        const label = this.reasonLabel(reason);
        const tw = ctx.measureText(label).width + 10;
        ctx.setLineDash([]);
        ctx.fillStyle = COLORS[level];
        const ly = r.y >= 20 ? r.y - 20 : r.y;
        ctx.fillRect(r.x, ly, tw, 20);
        ctx.fillStyle = level === 'yellow' ? '#0b1b3a' : '#fff';
        ctx.fillText(label, r.x + 5, ly + 16);
      }
    }
  }
}
