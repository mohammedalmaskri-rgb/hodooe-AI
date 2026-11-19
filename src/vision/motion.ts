// Global camera-motion estimate between consecutive frames.
// When the teacher moves the phone, the whole scene shifts; students are mostly still.
// We compare tiny grayscale copies of the current and previous frame (≈80 px wide),
// find the best shift, and use it to predict where every face box went.
// The tiny copies are plain numbers in memory, replaced every frame, never stored.

export interface Shift {
  /** Content movement since the previous frame, in SOURCE pixels (+x = scene moved right). */
  dx: number;
  dy: number;
}

/**
 * Best translation of `cur` relative to `prev` (both w×h luminance, mean-removed)
 * within ±R pixels, with sub-pixel refinement. Returns null for textureless input.
 */
export function estimateShift(prev: Float32Array, cur: Float32Array, w: number, h: number, R: number): Shift | null {
  const errs = new Float32Array((2 * R + 1) * (2 * R + 1));
  let best = Infinity;
  let bx = 0;
  let by = 0;
  for (let sy = -R; sy <= R; sy++) {
    for (let sx = -R; sx <= R; sx++) {
      let sum = 0;
      for (let y = R; y < h - R; y++) {
        const row = y * w;
        const prow = (y - sy) * w - sx;
        for (let x = R; x < w - R; x++) sum += Math.abs(cur[row + x] - prev[prow + x]);
      }
      errs[(sy + R) * (2 * R + 1) + (sx + R)] = sum;
      if (sum < best) {
        best = sum;
        bx = sx;
        by = sy;
      }
    }
  }
  const sorted = Array.from(errs).sort((a, b) => a - b);
  const median = sorted[sorted.length >> 1];
  if (median <= 0 || best / median > 0.92) return null; // flat image: no reliable motion

  const at = (sx: number, sy: number) => errs[(sy + R) * (2 * R + 1) + (sx + R)];
  const refine = (m: number, c: number, p: number) => {
    const d = m - 2 * c + p;
    return d > 0 ? (0.5 * (m - p)) / d : 0;
  };
  const fx = bx > -R && bx < R ? refine(at(bx - 1, by), best, at(bx + 1, by)) : 0;
  const fy = by > -R && by < R ? refine(at(bx, by - 1), best, at(bx, by + 1)) : 0;
  return { dx: bx + fx, dy: by + fy };
}

/** Stateful estimator working on any drawable source (video element or canvas). */
export class MotionEstimator {
  private canvas = document.createElement('canvas');
  private ctx: CanvasRenderingContext2D;
  private prev: Float32Array | null = null;
  private w: number;
  private h = 0;

  constructor(
    width = 80,
    private R = 7,
  ) {
    this.w = width;
    const ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('canvas2d unavailable');
    this.ctx = ctx;
  }

  /** Returns the shift since the previous call (source px), or null if unknown. */
  update(src: CanvasImageSource, srcW: number, srcH: number): Shift | null {
    const h = Math.max(8, Math.round((this.w * srcH) / srcW));
    if (h !== this.h) {
      this.h = h;
      this.canvas.width = this.w;
      this.canvas.height = h;
      this.prev = null;
    }
    this.ctx.drawImage(src, 0, 0, this.w, h);
    const px = this.ctx.getImageData(0, 0, this.w, h).data;
    const cur = new Float32Array(this.w * h);
    let mean = 0;
    for (let i = 0, p = 0; i < cur.length; i++, p += 4) {
      cur[i] = 0.299 * px[p] + 0.587 * px[p + 1] + 0.114 * px[p + 2];
      mean += cur[i];
    }
    mean /= cur.length;
    for (let i = 0; i < cur.length; i++) cur[i] -= mean; // robust to exposure changes
    const prev = this.prev;
    this.prev = cur;
    if (!prev) return null;
    const s = estimateShift(prev, cur, this.w, h, this.R);
    if (!s) return null;
    const scale = srcW / this.w;
    return { dx: s.dx * scale, dy: s.dy * scale };
  }

  reset() {
    this.prev = null;
  }

  dispose() {
    this.canvas.width = this.canvas.height = 0;
    this.prev = null;
  }
}
