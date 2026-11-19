import type { Box, Detection, Quality } from './types';

// Lightweight multi-face tracker for a moving camera.
// It links detections across frames so the SAME face is not counted repeatedly.
// Tracks are anonymous numbers kept in memory only – no image, embedding or identity.

export interface Track {
  id: number;
  box: Box;
  /** Velocity of the box centre (px/frame), used to predict motion while panning. */
  vx: number;
  vy: number;
  score: number;
  hits: number;
  /** Consecutive frames without a matching detection. */
  misses: number;
  confirmed: boolean;
  quality?: Quality;
  /** Frame counter of the last sharpness measurement. */
  lastSharpAt: number;
  sharpness?: number;
  brightness?: number;
}

export interface TrackerOptions {
  /** Detections needed before a track counts as a real face (filters one-frame false positives). */
  confirmHits: number;
  /** Frames a track survives without detection (briefly shown red as "lost"). */
  maxMisses: number;
  /** Minimum IoU to match predicted box and detection. */
  minIoU: number;
  /** Fallback: max centre distance relative to face size (handles fast panning). */
  maxCenterDist: number;
  /** Box smoothing (0..1, higher = follow detection faster). */
  smoothing: number;
}

export const DEFAULT_TRACKER: TrackerOptions = {
  confirmHits: 3,
  maxMisses: 8,
  minIoU: 0.15,
  maxCenterDist: 0.9,
  smoothing: 0.65,
};

export function iou(a: Box, b: Box): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = a.w * a.h + b.w * b.h - inter;
  return union > 0 ? inter / union : 0;
}

const center = (b: Box) => ({ cx: b.x + b.w / 2, cy: b.y + b.h / 2 });

export interface TrackerStats {
  /** Distinct confirmed faces seen this session (approximate: a face that leaves and returns later counts again). */
  uniqueFaces: number;
  /** Confirmed tracks that were lost (face left view or detection failed long enough). */
  lostEvents: number;
  /** Highest number of simultaneously visible confirmed faces. */
  maxSimultaneous: number;
}

export class FaceTracker {
  tracks: Track[] = [];
  stats: TrackerStats = { uniqueFaces: 0, lostEvents: 0, maxSimultaneous: 0 };
  private nextId = 1;
  frame = 0;

  constructor(private opt: TrackerOptions = DEFAULT_TRACKER) {}

  reset() {
    this.tracks = [];
    this.stats = { uniqueFaces: 0, lostEvents: 0, maxSimultaneous: 0 };
    this.nextId = 1;
    this.frame = 0;
  }

  /** Feed the detections of one processed frame. Returns the live track list. */
  update(dets: Detection[]): Track[] {
    this.frame++;
    const { opt } = this;

    // 1) Predict where each track should be now (constant velocity).
    const predicted = this.tracks.map((t) => ({ ...t.box, x: t.box.x + t.vx, y: t.box.y + t.vy }));

    // 2) Score all track/detection pairs, then greedily take the best pairs.
    const pairs: { ti: number; di: number; cost: number }[] = [];
    predicted.forEach((p, ti) => {
      dets.forEach((d, di) => {
        const o = iou(p, d);
        if (o >= opt.minIoU) return void pairs.push({ ti, di, cost: 1 - o });
        const a = center(p);
        const b = center(d);
        const dist = Math.hypot(a.cx - b.cx, a.cy - b.cy) / Math.max(p.w, d.w, 1);
        const sizeRatio = Math.max(p.w, d.w) / Math.max(1, Math.min(p.w, d.w));
        if (dist <= opt.maxCenterDist && sizeRatio < 1.8) pairs.push({ ti, di, cost: 1 + dist });
      });
    });
    pairs.sort((a, b) => a.cost - b.cost);
    const usedT = new Set<number>();
    const usedD = new Set<number>();
    for (const { ti, di } of pairs) {
      if (usedT.has(ti) || usedD.has(di)) continue;
      usedT.add(ti);
      usedD.add(di);
      const t = this.tracks[ti];
      const d = dets[di];
      const prev = center(t.box);
      const s = opt.smoothing;
      t.box = {
        x: t.box.x + (d.x - t.box.x) * s,
        y: t.box.y + (d.y - t.box.y) * s,
        w: t.box.w + (d.w - t.box.w) * s,
        h: t.box.h + (d.h - t.box.h) * s,
      };
      const now = center(t.box);
      t.vx = 0.5 * t.vx + 0.5 * (now.cx - prev.cx);
      t.vy = 0.5 * t.vy + 0.5 * (now.cy - prev.cy);
      t.score = d.score;
      t.hits++;
      t.misses = 0;
      if (!t.confirmed && t.hits >= opt.confirmHits) {
        t.confirmed = true;
        this.stats.uniqueFaces++;
      }
    }

    // 3) Unmatched tracks age; unmatched detections start new tracks.
    this.tracks.forEach((t, ti) => {
      if (usedT.has(ti)) return;
      t.misses++;
      t.box = { ...t.box, x: t.box.x + t.vx, y: t.box.y + t.vy };
      t.vx *= 0.7;
      t.vy *= 0.7;
    });
    const survivors: Track[] = [];
    for (const t of this.tracks) {
      if (t.misses <= opt.maxMisses) survivors.push(t);
      else if (t.confirmed) this.stats.lostEvents++;
    }
    dets.forEach((d, di) => {
      if (usedD.has(di)) return;
      survivors.push({
        id: this.nextId++,
        box: { x: d.x, y: d.y, w: d.w, h: d.h },
        vx: 0,
        vy: 0,
        score: d.score,
        hits: 1,
        misses: 0,
        confirmed: opt.confirmHits <= 1,
        lastSharpAt: -Infinity,
      });
      if (opt.confirmHits <= 1) this.stats.uniqueFaces++;
    });
    this.tracks = survivors;

    const visible = survivors.filter((t) => t.confirmed && t.misses === 0).length;
    this.stats.maxSimultaneous = Math.max(this.stats.maxSimultaneous, visible);
    return survivors;
  }
}
