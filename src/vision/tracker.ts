import type { Box, Detection, Quality } from './types';
import type { Shift } from './motion';

// Multi-face tracker for a moving phone camera in a classroom.
// - Links detections across frames so the SAME face is not counted repeatedly.
// - Uses the estimated camera motion to predict where every face moved.
// - Keeps a short-lived, anonymous POSITION memory (scene coordinates) of faces that
//   left the view, so a face that comes back during the same sweep keeps its number.
// Everything is numbers in memory for the current session: no image, no embedding, no identity.

export interface Track {
  /** Internal track id (every candidate gets one). */
  id: number;
  /** Anonymous session face number, assigned when confirmed (1, 2, 3, …). */
  faceNo?: number;
  box: Box;
  /** Residual velocity of the box centre on top of camera motion (px/frame). */
  vx: number;
  vy: number;
  score: number;
  hits: number;
  /** Consecutive frames in which the face SHOULD have been seen but was not. */
  misses: number;
  /** Frames since the last match (includes frames where its area was not analysed). */
  unseen: number;
  /** Pass that last found this face. */
  source: 'full' | 'tile';
  confirmed: boolean;
  /** Seen at strong confidence at least once, or passed a centred re-check. */
  verified: boolean;
  /** Failed centred re-checks (track is dropped after 2). */
  verifyFails: number;
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
  /** Hard limit on frames without any match (covers areas analysed only every few frames). */
  maxUnseen: number;
  /**
   * A face still counts as visible while unseen for up to this many frames
   * (0 without tiling; the tile-cycle length with round-robin tiling).
   */
  maxVisibleUnseen: number;
  /** Minimum IoU to match predicted box and detection. */
  minIoU: number;
  /** Fallback: max centre distance relative to face size (handles fast panning). */
  maxCenterDist: number;
  /** Box smoothing (0..1, higher = follow detection faster). */
  smoothing: number;
  /** How long a lost face's position is remembered for re-linking (frames, 0 = off). */
  memoryFrames: number;
  /** Max distance (relative to face size) between a new face and a remembered position to re-link. */
  relinkDist: number;
}

export const DEFAULT_TRACKER: TrackerOptions = {
  confirmHits: 3,
  maxMisses: 8,
  maxUnseen: 8,
  maxVisibleUnseen: 0,
  minIoU: 0.15,
  maxCenterDist: 0.9,
  smoothing: 0.65,
  memoryFrames: 900, // ≈30–60 s depending on FPS
  relinkDist: 0.6,
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
  /**
   * Distinct anonymous faces counted this session. Approximate: re-linking only works while
   * the camera motion estimate is good; walking/zooming or a long absence can count a face again.
   */
  uniqueFaces: number;
  /** Confirmed tracks that were lost (face left view or detection failed long enough). */
  lostEvents: number;
  /** Faces that came back and were re-linked to their earlier number instead of counted again. */
  relinked: number;
  /** Duplicate tracks of one face that were merged (and un-counted). */
  merged: number;
  /** Highest number of simultaneously visible confirmed faces. */
  maxSimultaneous: number;
}

interface Remembered {
  faceNo: number;
  /** Centre in scene coordinates (frame coordinates minus accumulated camera motion). */
  sx: number;
  sy: number;
  size: number;
  lostAt: number;
}

export class FaceTracker {
  tracks: Track[] = [];
  stats: TrackerStats = { uniqueFaces: 0, lostEvents: 0, relinked: 0, merged: 0, maxSimultaneous: 0 };
  private nextId = 1;
  private memory: Remembered[] = [];
  /** Accumulated camera motion since the session started (frame → scene offset). */
  private camX = 0;
  private camY = 0;
  /** Frame size (for 'fully inside the frame' checks); 0 = unknown. */
  private frameW = 0;
  private frameH = 0;
  frame = 0;

  constructor(private opt: TrackerOptions = DEFAULT_TRACKER) {}

  /** Frame size, so faces cut by the frame edge are tracked but not counted until fully visible. */
  setFrameSize(w: number, h: number) {
    this.frameW = w;
    this.frameH = h;
  }

  /** True when the box is fully inside the frame (with a small margin). */
  private fullyInside(b: Box) {
    if (!this.frameW) return true;
    const m = 2;
    return b.x > m && b.y > m && b.x + b.w < this.frameW - m && b.y + b.h < this.frameH - m;
  }

  /** Adjust timeouts at runtime (e.g. when the tile cycle length changes). */
  configure(patch: Partial<TrackerOptions>) {
    this.opt = { ...this.opt, ...patch };
  }

  reset() {
    this.tracks = [];
    this.memory = [];
    this.stats = { uniqueFaces: 0, lostEvents: 0, relinked: 0, merged: 0, maxSimultaneous: 0 };
    this.nextId = 1;
    this.camX = this.camY = 0;
    this.frame = 0;
  }

  /** Result of a centred re-check of an unverified candidate. */
  applyVerification(t: Track, ok: boolean, box?: Box) {
    if (ok) {
      t.verified = true;
      if (box) t.box = { ...box };
      if (!t.confirmed && t.hits >= this.opt.confirmHits && this.fullyInside(t.box)) {
        t.confirmed = true;
        this.assignFaceNo(t);
      }
    } else {
      t.verifyFails++;
    }
  }

  /** Currently on screen: not missed, and seen recently enough. */
  isVisible(t: Track): boolean {
    return t.misses === 0 && t.unseen <= this.opt.maxVisibleUnseen;
  }

  private sceneOf(b: Box) {
    const c = center(b);
    return { sx: c.cx - this.camX, sy: c.cy - this.camY };
  }

  /** Give a newly confirmed track its face number: re-link to a remembered face, or a new number. */
  private assignFaceNo(t: Track) {
    const { sx, sy } = this.sceneOf(t.box);
    const size = Math.max(t.box.w, t.box.h);
    // 1) An older track of the same face may still be alive but stale (waiting for its tile,
    //    prediction drifted). Take over its number instead of counting the face again.
    const c = center(t.box);
    let stale: Track | undefined;
    let staleD = Infinity;
    for (const o of this.tracks) {
      if (o === t || !o.confirmed || o.faceNo === undefined || (o.unseen === 0 && o.misses === 0)) continue;
      const oc = center(o.box);
      const os = Math.max(o.box.w, o.box.h);
      const ratio = Math.max(size, os) / Math.max(1, Math.min(size, os));
      const d = Math.hypot(c.cx - oc.cx, c.cy - oc.cy) / Math.max(size, os);
      // stale boxes may have drifted with prediction error: allow up to one face width
      if (ratio < 1.6 && d <= 1.0 && d < staleD) {
        stale = o;
        staleD = d;
      }
    }
    if (stale) {
      t.faceNo = stale.faceNo;
      stale.faceNo = undefined;
      stale.misses = Number.POSITIVE_INFINITY; // removed below without a lost event
      stale.confirmed = false;
      this.stats.relinked++;
      return;
    }
    const active = new Set(this.tracks.filter((x) => x.faceNo !== undefined).map((x) => x.faceNo));
    let bestI = -1;
    let bestD = Infinity;
    this.memory.forEach((m, i) => {
      if (active.has(m.faceNo)) return;
      const ratio = Math.max(size, m.size) / Math.max(1, Math.min(size, m.size));
      const d = Math.hypot(sx - m.sx, sy - m.sy) / Math.max(size, m.size);
      if (ratio < 1.6 && d <= this.opt.relinkDist && d < bestD) {
        bestD = d;
        bestI = i;
      }
    });
    if (bestI >= 0) {
      t.faceNo = this.memory[bestI].faceNo;
      this.memory.splice(bestI, 1);
      this.stats.relinked++;
    } else {
      t.faceNo = ++this.stats.uniqueFaces;
    }
  }

  /**
   * Feed the detections of one processed frame. Returns the live track list.
   * `expected(box)` says whether a face at that position COULD have been detected in this
   * frame (with tiling, small faces are only analysed when their tile comes round).
   * `motion` is the camera-induced shift since the previous frame (null if unknown).
   */
  update(dets: Detection[], expected: (b: Box) => boolean = () => true, motion: Shift | null = null): Track[] {
    this.frame++;
    const { opt } = this;
    const mx = motion?.dx ?? 0;
    const my = motion?.dy ?? 0;
    this.camX += mx;
    this.camY += my;

    // 1) Predict: camera motion moves every face; plus each face's own small residual motion.
    for (const t of this.tracks) t.box = { ...t.box, x: t.box.x + mx + t.vx, y: t.box.y + my + t.vy };

    // 2) Score all track/detection pairs, then greedily take the best pairs.
    const pairs: { ti: number; di: number; cost: number }[] = [];
    this.tracks.forEach((p, ti) => {
      const pb = p.box;
      dets.forEach((d, di) => {
        const o = iou(pb, d);
        if (o >= opt.minIoU) return void pairs.push({ ti, di, cost: 1 - o });
        const a = center(pb);
        const b = center(d);
        const dist = Math.hypot(a.cx - b.cx, a.cy - b.cy) / Math.max(pb.w, d.w, 1);
        const sizeRatio = Math.max(pb.w, d.w) / Math.max(1, Math.min(pb.w, d.w));
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
      const prev = center(t.box); // predicted position
      const s = opt.smoothing;
      t.box = {
        x: t.box.x + (d.x - t.box.x) * s,
        y: t.box.y + (d.y - t.box.y) * s,
        w: t.box.w + (d.w - t.box.w) * s,
        h: t.box.h + (d.h - t.box.h) * s,
      };
      const now = center(t.box);
      // Residual velocity = what the prediction missed (spread over the frames it was unseen).
      const k = 1 / (t.unseen + 1);
      t.vx = 0.5 * t.vx + 0.5 * (now.cx - prev.cx) * k;
      t.vy = 0.5 * t.vy + 0.5 * (now.cy - prev.cy) * k;
      t.score = d.score;
      t.source = d.source ?? 'full';
      t.hits++;
      t.misses = 0;
      t.unseen = 0;
      if (!d.weak) t.verified = true;
      // Count a face only once it is fully inside the frame (edge-cut boxes are unreliable).
      if (!t.confirmed && t.verified && t.hits >= opt.confirmHits && this.fullyInside(d)) {
        t.confirmed = true;
        this.assignFaceNo(t);
      }
    }

    // 3) Unmatched tracks age; unmatched detections start new tracks.
    this.tracks.forEach((t, ti) => {
      if (usedT.has(ti)) return;
      t.vx *= 0.7;
      t.vy *= 0.7;
      t.unseen++;
      if (expected(t.box)) t.misses++;
    });
    const survivors: Track[] = [];
    for (const t of this.tracks) {
      if (!t.confirmed && t.verifyFails >= 2) continue; // rejected candidate (never counted)
      if (t.misses === Number.POSITIVE_INFINITY) continue; // number taken over by a fresh track of the same face
      if (t.misses <= opt.maxMisses && t.unseen <= opt.maxUnseen) {
        survivors.push(t);
      } else if (t.confirmed && t.faceNo !== undefined) {
        this.stats.lostEvents++;
        if (opt.memoryFrames > 0) {
          const { sx, sy } = this.sceneOf(t.box);
          this.memory.push({ faceNo: t.faceNo, sx, sy, size: Math.max(t.box.w, t.box.h), lostAt: this.frame });
        }
      }
    }
    this.memory = this.memory.filter((m) => this.frame - m.lostAt <= opt.memoryFrames);
    dets.forEach((d, di) => {
      if (usedD.has(di)) return;
      const t: Track = {
        id: this.nextId++,
        box: { x: d.x, y: d.y, w: d.w, h: d.h },
        vx: 0,
        vy: 0,
        score: d.score,
        hits: 1,
        misses: 0,
        unseen: 0,
        source: d.source ?? 'full',
        confirmed: opt.confirmHits <= 1 && !d.weak,
        verified: !d.weak,
        verifyFails: 0,
        lastSharpAt: -Infinity,
      };
      survivors.push(t);
      if (t.confirmed) this.assignFaceNo(t);
    });
    // 4) Two counted tracks on the same face (overlapping strongly): keep the older number,
    //    drop the other and un-count it.
    const counted = survivors.filter((x) => x.confirmed && x.faceNo !== undefined);
    for (let i = 0; i < counted.length; i++) {
      for (let j = i + 1; j < counted.length; j++) {
        const a = counted[i];
        const b = counted[j];
        if (a.faceNo === undefined || b.faceNo === undefined || iou(a.box, b.box) < 0.5) continue;
        const [keep, drop] = a.faceNo < b.faceNo ? [a, b] : [b, a];
        if (drop.unseen === 0 && keep.unseen > 0) keep.box = { ...drop.box };
        drop.faceNo = undefined;
        drop.confirmed = false;
        drop.misses = Number.POSITIVE_INFINITY;
        this.stats.uniqueFaces--;
        this.stats.merged++;
      }
    }
    this.tracks = survivors.filter((x) => x.misses !== Number.POSITIVE_INFINITY);

    const visible = survivors.filter((t) => t.confirmed && this.isVisible(t)).length;
    this.stats.maxSimultaneous = Math.max(this.stats.maxSimultaneous, visible);
    return survivors;
  }
}
