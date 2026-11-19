import type { FaceDetector } from '@mediapipe/tasks-vision';
import { DEFAULT_TRACKER, FaceTracker, type Track, type TrackerOptions } from './tracker';
import { classifyFace, DEFAULT_THRESHOLDS, measurePixels } from './quality';
import { MotionEstimator, type Shift } from './motion';
import { computeTiles, fullFrameMinFace, mergeDetections, touchesInnerEdge, type Tile } from './tiles';
import type { Box, Detection } from './types';

// Per-frame analysis pipeline, independent of <video>, timing loop and drawing, so the live
// app and the benchmark harness run exactly the same code.
// Input pixels (video frame or test canvas) are read in memory and never kept.

export type FarMode = 'off' | 'balanced' | 'max';

export interface AnalyzerConfig {
  /** Whole-frame detector (VIDEO mode). */
  detector: FaceDetector;
  /** Tile detector (IMAGE mode); required unless far = 'off'. */
  tileDetector?: FaceDetector;
  far: FarMode;
  /** balanced: keep running tiles until this much time has passed in the frame (ms). */
  tileBudgetMs?: number;
  /**
   * Detections below `strongScore` are candidates that must pass a centred re-check before
   * they are counted. Measured: faces inside tiles score 0.41–0.90 depending on position;
   * the earlier false positives (hair/poster edge) scored 0.41–0.51.
   */
  candidateScore?: number;
  strongScore?: number;
  /** Max centred re-checks per frame. */
  verifyPerFrame?: number;
  /** Use image-based camera-motion estimation (default true). */
  motion?: boolean;
  /** Override automatic tile grid. */
  grid?: { cols: number; rows: number };
  overlap?: number;
  /** Max faces whose sharpness is re-measured per frame (spreads the cost with many faces). */
  qualityPerFrame?: number;
  tracker?: Partial<TrackerOptions>;
}

export interface FrameTimings {
  totalMs: number;
  fullMs: number;
  tilesMs: number;
  tilesRun: number;
  motionMs: number;
  trackMs: number;
  qualityMs: number;
  verifyMs: number;
  verified: number;
}

export interface FrameResult {
  tracks: Track[];
  /** Confirmed + currently visible faces (what is drawn and counted). */
  visible: Track[];
  detections: number;
  motion: Shift | null;
  timings: FrameTimings;
}

/** Automatic tile grid: tiles ≈ 440×400 px whatever the resolution/orientation. */
export function autoGrid(w: number, h: number) {
  return { cols: Math.max(2, Math.round(w / 440)), rows: Math.max(1, Math.round(h / 400)) };
}

const CROP = 64;
const VERIFY_SIZE = 256;

export class FrameAnalyzer {
  readonly tracker: FaceTracker;
  private motion: MotionEstimator | null;
  private sampler: CanvasRenderingContext2D;
  private samplerCanvas = document.createElement('canvas');
  private tileCanvas = document.createElement('canvas');
  private tileCtx: CanvasRenderingContext2D;
  private verifyCanvas = document.createElement('canvas');
  private verifyCtx: CanvasRenderingContext2D;
  private tiles: Tile[] = [];
  private tilesFor = '';
  private tileCursor = 0;
  private avgTilesPerFrame = 1;
  private lastTs = 0;
  frameBrightness?: number;

  constructor(private cfg: AnalyzerConfig) {
    if (cfg.far !== 'off' && !cfg.tileDetector) throw new Error('tileDetector required for tiling');
    this.tracker = new FaceTracker({ ...DEFAULT_TRACKER, ...cfg.tracker });
    this.motion = cfg.motion === false ? null : new MotionEstimator();
    this.samplerCanvas.width = this.samplerCanvas.height = CROP;
    const s = this.samplerCanvas.getContext('2d', { willReadFrequently: true });
    const t = this.tileCanvas.getContext('2d');
    this.verifyCanvas.width = this.verifyCanvas.height = VERIFY_SIZE;
    const v = this.verifyCanvas.getContext('2d');
    if (!s || !t || !v) throw new Error('canvas2d unavailable');
    this.sampler = s;
    this.tileCtx = t;
    this.verifyCtx = v;
  }

  get tileCount() {
    return this.tiles.length;
  }

  get tilesPerFrame() {
    return this.avgTilesPerFrame;
  }

  reset() {
    this.tracker.reset();
    this.motion?.reset();
    this.tileCursor = 0;
  }

  dispose() {
    this.motion?.dispose();
    this.samplerCanvas.width = this.samplerCanvas.height = 0;
    this.tileCanvas.width = this.tileCanvas.height = 0;
    this.verifyCanvas.width = this.verifyCanvas.height = 0;
  }

  analyze(src: CanvasImageSource, w: number, h: number, now = performance.now()): FrameResult {
    const t0 = performance.now();
    const ts = Math.max(now, this.lastTs + 1); // VIDEO mode needs strictly increasing timestamps
    this.lastTs = ts;

    // 1) Camera motion since the previous frame.
    const motion = this.motion ? this.motion.update(src, w, h) : null;
    const t1 = performance.now();

    // 2) Whole frame.
    const cand = this.cfg.candidateScore ?? 0.45;
    // Without a second (IMAGE-mode) detector there is no re-check, so nothing is held back.
    const strong = this.cfg.tileDetector ? (this.cfg.strongScore ?? 0.6) : cand;
    let dets = toDetections(this.cfg.detector.detectForVideo(src as HTMLVideoElement, ts).detections, w, h, 'full')
      .filter((d) => d.score >= cand)
      .map((d) => ({ ...d, weak: d.score < strong }));
    const t2 = performance.now();

    // 3) Tiles for far/small faces.
    const ran: Tile[] = [];
    if (this.cfg.far !== 'off' && this.cfg.tileDetector) {
      const key = `${w}x${h}`;
      if (this.tilesFor !== key) {
        const g = this.cfg.grid ?? autoGrid(w, h);
        this.tiles = computeTiles(w, h, g.cols, g.rows, this.cfg.overlap ?? 0.2);
        this.tilesFor = key;
        this.tileCursor = 0;
      }
      const n = this.tiles.length;
      const budget = this.cfg.tileBudgetMs ?? 40;
      while (ran.length < n) {
        if (this.cfg.far === 'balanced' && ran.length > 0 && performance.now() - t0 >= budget) break;
        const tile = this.tiles[this.tileCursor++ % n];
        if (this.tileCanvas.width !== tile.w || this.tileCanvas.height !== tile.h) {
          this.tileCanvas.width = tile.w;
          this.tileCanvas.height = tile.h;
        }
        // Crop of the frame, analysed then overwritten by the next tile – never kept.
        this.tileCtx.drawImage(src, tile.x, tile.y, tile.w, tile.h, 0, 0, tile.w, tile.h);
        const found = this.cfg.tileDetector.detect(this.tileCanvas).detections;
        for (const d of toDetections(found, tile.w, tile.h, 'tile')) {
          if (d.score >= cand && !touchesInnerEdge(d, tile, w, h)) dets.push({ ...d, x: d.x + tile.x, y: d.y + tile.y, weak: d.score < strong });
        }
        ran.push(tile);
      }
      dets = mergeDetections(dets);
      // Timeouts follow the real cycle length (how many frames until a tile comes round again).
      this.avgTilesPerFrame = 0.9 * this.avgTilesPerFrame + 0.1 * ran.length;
      const cycle = ran.length >= n ? 0 : Math.ceil(n / Math.max(1, this.avgTilesPerFrame));
      this.tracker.configure({ maxVisibleUnseen: cycle, maxUnseen: Math.max(DEFAULT_TRACKER.maxMisses, 2 * cycle + 2) });
    }
    const t3 = performance.now();

    // 4) Tracking. A face counts as missed only if this frame could have seen it.
    const minFull = fullFrameMinFace(w, h);
    const expected =
      this.cfg.far === 'off'
        ? undefined
        : (b: Box) => {
            if (Math.min(b.w, b.h) >= minFull) return true;
            const cx = b.x + b.w / 2;
            const cy = b.y + b.h / 2;
            return ran.some((t) => cx >= t.x && cx <= t.x + t.w && cy >= t.y && cy <= t.y + t.h);
          };
    this.tracker.setFrameSize(w, h);
    const tracks = this.tracker.update(dets, expected, motion);
    const t4 = performance.now();

    // 4b) Centred re-check of unverified candidates (bounded per frame).
    let verified = 0;
    const verifier = this.cfg.tileDetector ?? null;
    if (verifier) {
      const pending = tracks.filter((t) => !t.verified && t.unseen === 0 && t.verifyFails < 2).slice(0, this.cfg.verifyPerFrame ?? 3);
      for (const t of pending) {
        const res = this.verify(src, w, h, t, verifier, strong);
        this.tracker.applyVerification(t, !!res, res ?? undefined);
        if (res) verified++;
      }
    }
    const t4b = performance.now();

    // 5) Quality: re-measure only the faces measured longest ago (bounded cost with many faces).
    const visible = tracks.filter((t) => t.confirmed && this.tracker.isVisible(t));
    const fresh = visible.filter((t) => t.unseen === 0);
    const limit = this.cfg.qualityPerFrame ?? 6;
    const due = [...fresh].sort((a, b) => a.lastSharpAt - b.lastSharpAt).slice(0, limit);
    for (const t of due) this.measureFace(src, t);
    for (const t of tracks) {
      if (!this.tracker.isVisible(t)) t.quality = { level: 'red', reasons: ['lost'] };
      else if (t.unseen === 0)
        t.quality = classifyFace(
          { score: t.score, size: Math.min(t.box.w, t.box.h), sharpness: t.sharpness, brightness: t.brightness },
          DEFAULT_THRESHOLDS,
        );
    }
    if (this.tracker.frame % 15 === 1) this.measureFrameBrightness(src);
    const t5 = performance.now();

    return {
      tracks,
      visible,
      detections: dets.length,
      motion,
      timings: {
        totalMs: t5 - t0,
        motionMs: t1 - t0,
        fullMs: t2 - t1,
        tilesMs: t3 - t2,
        tilesRun: ran.length,
        trackMs: t4 - t3,
        verifyMs: t4b - t4,
        verified,
        qualityMs: t5 - t4b,
      },
    };
  }

  /**
   * Re-detect a candidate in a square crop centred on it, scaled so the face is ≈32 px in the
   * model's 192 px input (where real faces are found ~95 % of the time). Returns the refined
   * box in frame coordinates, or null if no strong face is there. Pixels are overwritten next time.
   */
  private verify(src: CanvasImageSource, w: number, h: number, t: Track, det: FaceDetector, strong: number): Box | null {
    const size = Math.max(t.box.w, t.box.h);
    const side = (size * 192) / 32;
    const cx = t.box.x + t.box.w / 2;
    const cy = t.box.y + t.box.h / 2;
    const sx = cx - side / 2;
    const sy = cy - side / 2;
    const k = VERIFY_SIZE / side;
    const ctx = this.verifyCtx;
    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, VERIFY_SIZE, VERIFY_SIZE);
    // Clip the source rect to the frame (canvas drawImage needs it inside the source).
    const x0 = Math.max(0, sx);
    const y0 = Math.max(0, sy);
    const x1 = Math.min(w, sx + side);
    const y1 = Math.min(h, sy + side);
    if (x1 - x0 < 4 || y1 - y0 < 4) return null;
    ctx.drawImage(src, x0, y0, x1 - x0, y1 - y0, (x0 - sx) * k, (y0 - sy) * k, (x1 - x0) * k, (y1 - y0) * k);
    let best: Box | null = null;
    let bestD = Infinity;
    for (const d of toDetections(det.detect(this.verifyCanvas).detections, VERIFY_SIZE, VERIFY_SIZE, 'tile')) {
      if (d.score < strong) continue;
      const dx = d.x + d.w / 2 - VERIFY_SIZE / 2;
      const dy = d.y + d.h / 2 - VERIFY_SIZE / 2;
      const dist = Math.hypot(dx, dy);
      if (dist < VERIFY_SIZE * 0.12 && dist < bestD) {
        bestD = dist;
        best = { x: sx + d.x / k, y: sy + d.y / k, w: d.w / k, h: d.h / k };
      }
    }
    return best;
  }

  /** Sharpness/brightness of one face from the current frame; pixels discarded at once. */
  private measureFace(src: CanvasImageSource, t: Track) {
    const { x, y, w, h } = t.box;
    this.sampler.drawImage(src, x, y, w, h, 0, 0, CROP, CROP);
    const m = measurePixels(this.sampler.getImageData(0, 0, CROP, CROP).data, CROP, CROP);
    t.sharpness = m.sharpness;
    t.brightness = m.brightness;
    t.lastSharpAt = this.tracker.frame;
  }

  private measureFrameBrightness(src: CanvasImageSource) {
    this.sampler.drawImage(src, 0, 0, 32, 18);
    this.frameBrightness = measurePixels(this.sampler.getImageData(0, 0, 32, 18).data, 32, 18).brightness;
  }
}

type RawDetection = {
  boundingBox?: { originX: number; originY: number; width: number; height: number };
  categories: { score: number }[];
};

function toDetections(raw: RawDetection[], maxW: number, maxH: number, source: 'full' | 'tile'): Detection[] {
  const out: Detection[] = [];
  for (const d of raw) {
    const b = d.boundingBox;
    if (!b) continue;
    const x = Math.max(0, b.originX);
    const y = Math.max(0, b.originY);
    const w = Math.min(maxW, b.originX + b.width) - x;
    const h = Math.min(maxH, b.originY + b.height) - y;
    if (w > 2 && h > 2) out.push({ x, y, w, h, score: d.categories[0]?.score ?? 0, source });
  }
  return out;
}
