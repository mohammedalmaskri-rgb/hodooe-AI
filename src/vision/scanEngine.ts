import type { FaceDetector } from '@mediapipe/tasks-vision';
import { DEFAULT_TRACKER, FaceTracker, type Track } from './tracker';
import { classifyFace, DEFAULT_THRESHOLDS, measurePixels } from './quality';
import { RollingMetrics } from './metrics';
import { mapContain } from './geometry';
import type { Box, Detection, QualityLevel, QualityReason } from './types';
import { computeTiles, fullFrameMinFace, mergeDetections, touchesInnerEdge, type Tile } from './tiles';

export type FarMode = 'off' | 'balanced' | 'max';

export interface TilingConfig {
  mode: FarMode;
  /** Second detector (IMAGE mode) used on tile crops; required unless mode is 'off'. */
  tileDetector?: FaceDetector;
  cols?: number;
  rows?: number;
  overlap?: number;
  /**
   * Minimum confidence for detections found in tiles. Measured on the test feed: real faces in
   * tiles scored 0.64–0.90, false positives (hair/poster edges at higher zoom) 0.41–0.51.
   */
  tileMinScore?: number;
}

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
  /** Model runs per processed frame (1 = full frame only). */
  inferencesPerFrame: number;
  /** Visible faces currently found only thanks to tiles. */
  facesViaTiles: number;
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
  readonly tracker: FaceTracker;
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
  private tileCanvas: HTMLCanvasElement | null = null;
  private tileCtx: CanvasRenderingContext2D | null = null;
  private tiles: Tile[] = [];
  private tilesFor = '';
  private tileCursor = 0;
  private lastInferences = 1;

  constructor(
    private video: FrameCallbackVideo,
    private overlay: HTMLCanvasElement,
    private detector: FaceDetector,
    private onStats: (s: ScanStats) => void,
    private reasonLabel: (r: QualityReason) => string,
    private tiling: TilingConfig = { mode: 'off' },
  ) {
    // With round-robin tiling a small face is re-checked once per cycle, so the
    // visibility/lost timeouts scale with the cycle length.
    const cycle = tiling.mode === 'balanced' ? (tiling.cols ?? 3) * (tiling.rows ?? 2) : 0;
    this.tracker = new FaceTracker({
      ...DEFAULT_TRACKER,
      maxVisibleUnseen: cycle,
      maxUnseen: Math.max(DEFAULT_TRACKER.maxMisses, 2 * cycle + 2),
    });
    if (tiling.mode !== 'off') {
      if (!tiling.tileDetector) throw new Error('tileDetector required for tiling');
      this.tileCanvas = document.createElement('canvas');
      this.tileCtx = this.tileCanvas.getContext('2d');
    }
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
    // Development-only hook for diagnosing tracking (stripped from production builds).
    if (import.meta.env.DEV) (window as unknown as { __hodoorEngine?: LiveScanEngine }).__hodoorEngine = this;
    this.schedule();
  }

  stop() {
    this.running = false;
    if (this.usingRVFC) this.video.cancelVideoFrameCallback?.(this.handle);
    else cancelAnimationFrame(this.handle);
    const ctx = this.overlay.getContext('2d');
    ctx?.clearRect(0, 0, this.overlay.width, this.overlay.height);
    this.samplerCanvas.width = this.samplerCanvas.height = 0; // free memory
    if (this.tileCanvas) this.tileCanvas.width = this.tileCanvas.height = 0;
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

    // 1) Whole frame, every frame.
    let dets: Detection[] = this.toDetections(this.detector.detectForVideo(v, ts).detections, 0, 0, vw, vh, 'full');

    // 2) Far-face mode: overlapping tiles (one per frame in rotation, or all of them).
    const ran: Tile[] = [];
    if (this.tiling.mode !== 'off' && this.tileCtx && this.tileCanvas) {
      const key = `${vw}x${vh}`;
      if (this.tilesFor !== key) {
        this.tiles = computeTiles(vw, vh, this.tiling.cols ?? 3, this.tiling.rows ?? 2, this.tiling.overlap ?? 0.2);
        this.tilesFor = key;
      }
      const todo = this.tiling.mode === 'max' ? this.tiles : [this.tiles[this.tileCursor++ % this.tiles.length]];
      for (const tile of todo) {
        if (this.tileCanvas.width !== tile.w || this.tileCanvas.height !== tile.h) {
          this.tileCanvas.width = tile.w;
          this.tileCanvas.height = tile.h;
        }
        // Crop of the live frame, analysed and overwritten by the next tile – never kept.
        this.tileCtx.drawImage(v, tile.x, tile.y, tile.w, tile.h, 0, 0, tile.w, tile.h);
        const found = this.tiling.tileDetector!.detect(this.tileCanvas).detections;
        const minScore = this.tiling.tileMinScore ?? 0.6;
        const local = this.toDetections(found, 0, 0, tile.w, tile.h, 'tile').filter(
          (d) => d.score >= minScore && !touchesInnerEdge(d, tile, vw, vh),
        );
        for (const d of local) dets.push({ ...d, x: d.x + tile.x, y: d.y + tile.y });
        ran.push(tile);
      }
      dets = mergeDetections(dets);
    }
    this.lastInferences = 1 + ran.length;

    // A face counts as "missed" only if this frame could have seen it: big faces are visible
    // to the full-frame pass; small ones only when their tile was analysed.
    const minFull = fullFrameMinFace(vw, vh);
    const expected =
      this.tiling.mode === 'off'
        ? undefined
        : (b: Box) => {
            if (Math.min(b.w, b.h) >= minFull) return true;
            const cx = b.x + b.w / 2;
            const cy = b.y + b.h / 2;
            return ran.some((t) => cx >= t.x && cx <= t.x + t.w && cy >= t.y && cy <= t.y + t.h);
          };

    const tracks = this.tracker.update(dets, expected);
    const frame = this.tracker.frame;
    for (const t of tracks) {
      if (!this.tracker.isVisible(t)) {
        t.quality = { level: 'red', reasons: ['lost'] };
        continue;
      }
      if (t.unseen > 0) continue; // waiting for its tile: keep last quality
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

  private toDetections(
    raw: { boundingBox?: { originX: number; originY: number; width: number; height: number }; categories: { score: number }[] }[],
    ox: number,
    oy: number,
    maxW: number,
    maxH: number,
    source: 'full' | 'tile',
  ): Detection[] {
    const out: Detection[] = [];
    for (const d of raw) {
      const b = d.boundingBox;
      if (!b) continue;
      const x = Math.max(0, b.originX);
      const y = Math.max(0, b.originY);
      const w = Math.min(maxW, b.originX + b.width) - x;
      const h = Math.min(maxH, b.originY + b.height) - y;
      if (w > 2 && h > 2) out.push({ x: x + ox, y: y + oy, w, h, score: d.categories[0]?.score ?? 0, source });
    }
    return out;
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

  /** Faces shown and counted: confirmed (seen in several checks) and currently visible.
   * Unconfirmed one-off detections are never shown or counted. */
  private visible(tracks: Track[]) {
    return tracks.filter((t) => t.confirmed && this.tracker.isVisible(t));
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
      inferencesPerFrame: this.lastInferences,
      facesViaTiles: visible.filter((t) => t.source === 'tile').length,
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
      if (!t.confirmed) continue; // one-off detections are not drawn (avoids false-positive flashes)
      const lost = !this.tracker.isVisible(t);
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
