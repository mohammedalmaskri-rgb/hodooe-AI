import { describe, expect, it } from 'vitest';
import { DEFAULT_TRACKER, FaceTracker, iou } from '../src/vision/tracker';
import { classifyFace, measurePixels } from '../src/vision/quality';
import { RollingMetrics } from '../src/vision/metrics';
import { mapContain, mapCover } from '../src/vision/geometry';
import type { Detection } from '../src/vision/types';

const det = (x: number, y: number, w = 100, score = 0.9): Detection => ({ x, y, w, h: w, score });

describe('tracker', () => {
  it('iou basics', () => {
    expect(iou({ x: 0, y: 0, w: 10, h: 10 }, { x: 0, y: 0, w: 10, h: 10 })).toBe(1);
    expect(iou({ x: 0, y: 0, w: 10, h: 10 }, { x: 20, y: 0, w: 10, h: 10 })).toBe(0);
  });

  it('counts a face once while the camera pans across it', () => {
    const tr = new FaceTracker();
    for (let f = 0; f < 60; f++) tr.update([det(100 + f * 25, 200)]); // fast pan, 25 px/frame
    expect(tr.stats.uniqueFaces).toBe(1);
    expect(tr.tracks).toHaveLength(1);
    expect(tr.tracks[0].id).toBe(1);
  });

  it('keeps identity of 4 faces moving together (camera motion)', () => {
    const tr = new FaceTracker();
    for (let f = 0; f < 40; f++) {
      const dx = f * 15;
      const dy = Math.sin(f / 3) * 20; // hand shake
      tr.update([det(50 + dx, 100 + dy), det(250 + dx, 110 + dy), det(450 + dx, 90 + dy), det(650 + dx, 100 + dy)]);
    }
    expect(tr.stats.uniqueFaces).toBe(4);
    expect(tr.tracks.map((t) => t.id).sort()).toEqual([1, 2, 3, 4]);
    expect(tr.stats.maxSimultaneous).toBe(4);
  });

  it('survives short detection dropouts without re-counting', () => {
    const tr = new FaceTracker();
    for (let f = 0; f < 10; f++) tr.update([det(100 + f * 10, 100)]);
    for (let f = 10; f < 14; f++) tr.update([]); // 4 missed frames (blur)
    for (let f = 14; f < 20; f++) tr.update([det(100 + f * 10, 100)]);
    expect(tr.stats.uniqueFaces).toBe(1);
    expect(tr.stats.lostEvents).toBe(0);
  });

  it('records a lost event when a face leaves, and a new face when another appears', () => {
    const tr = new FaceTracker();
    for (let f = 0; f < 10; f++) tr.update([det(100, 100)]);
    for (let f = 0; f < 12; f++) tr.update([]);
    expect(tr.stats.lostEvents).toBe(1);
    for (let f = 0; f < 5; f++) tr.update([det(800, 400)]);
    expect(tr.stats.uniqueFaces).toBe(2);
  });

  it('ignores one-frame false positives (needs confirmation)', () => {
    const tr = new FaceTracker();
    tr.update([det(10, 10)]);
    for (let f = 0; f < 12; f++) tr.update([]);
    expect(tr.stats.uniqueFaces).toBe(0);
    expect(tr.stats.lostEvents).toBe(0);
  });
});

describe('quality', () => {
  it('green / yellow / red', () => {
    expect(classifyFace({ score: 0.95, size: 120, sharpness: 300, brightness: 120 }).level).toBe('green');
    expect(classifyFace({ score: 0.7, size: 120, sharpness: 300 }).level).toBe('yellow');
    expect(classifyFace({ score: 0.95, size: 40, sharpness: 300 }).reasons).toContain('small');
    expect(classifyFace({ score: 0.95, size: 120, sharpness: 60 }).level).toBe('yellow');
    expect(classifyFace({ score: 0.95, size: 120, sharpness: 10 }).level).toBe('red');
    expect(classifyFace({ score: 0.4, size: 120 }).level).toBe('red');
    expect(classifyFace({ score: 0.95, size: 120, brightness: 20 }).reasons).toEqual(['dark']);
  });

  it('measurePixels: flat image is not sharp, checkerboard is sharp', () => {
    const W = 16;
    const flat = new Uint8ClampedArray(W * W * 4).fill(128);
    const checker = new Uint8ClampedArray(W * W * 4);
    for (let i = 0; i < W * W; i++) {
      const v = ((i % W) + Math.floor(i / W)) % 2 ? 255 : 0;
      checker.set([v, v, v, 255], i * 4);
    }
    expect(measurePixels(flat, W, W).sharpness).toBe(0);
    expect(measurePixels(flat, W, W).brightness).toBeCloseTo(128);
    expect(measurePixels(checker, W, W).sharpness).toBeGreaterThan(10000);
  });
});

describe('metrics & geometry', () => {
  it('fps counts frames in the last second; averages processing time', () => {
    const m = new RollingMetrics();
    for (let i = 0; i < 30; i++) m.add(10 + (i % 3), 1000 + i * 33);
    expect(m.fps(1000 + 29 * 33)).toBe(30);
    expect(m.fps(5000)).toBe(0);
    expect(m.avgMs()).toBeCloseTo(11, 0);
    expect(m.frames).toBe(30);
  });

  it('maps cover-fitted boxes without distortion', () => {
    // 1280x720 video in a 400x800 portrait view: scale = 800/720
    const r = mapCover({ x: 640, y: 360, w: 72, h: 72 }, 1280, 720, 400, 800);
    const s = 800 / 720;
    expect(r.w).toBeCloseTo(72 * s);
    expect(r.h).toBeCloseTo(r.w); // square stays square
    expect(r.x + r.w / 2).toBeCloseTo(200 + 36 * s);
  });

  it('contain mapping keeps the whole frame visible (letterbox)', () => {
    // 1280x720 in 400x800: scale = 400/1280, frame height 225, top offset 287.5
    const r = mapContain({ x: 0, y: 0, w: 1280, h: 720 }, 1280, 720, 400, 800);
    expect(r.x).toBeCloseTo(0);
    expect(r.w).toBeCloseTo(400);
    expect(r.h).toBeCloseTo(225);
    expect(r.y).toBeCloseTo(287.5);
  });
});

import { computeTiles, fullFrameMinFace, iom, mergeDetections, touchesInnerEdge } from '../src/vision/tiles';

describe('tiling', () => {
  it('3×2 overlapping tiles cover the whole 1280×720 frame', () => {
    const tiles = computeTiles(1280, 720, 3, 2, 0.2);
    expect(tiles).toHaveLength(6);
    expect(Math.min(...tiles.map((t) => t.x))).toBe(0);
    expect(Math.max(...tiles.map((t) => t.x + t.w))).toBe(1280);
    expect(Math.max(...tiles.map((t) => t.y + t.h))).toBe(720);
    // neighbours overlap
    expect(tiles[0].x + tiles[0].w).toBeGreaterThan(tiles[1].x);
    // a tile is ~2.6× narrower than the frame → faces ~2.6× larger for the model
    expect(1280 / tiles[0].w).toBeGreaterThan(2.5);
  });

  it('flags faces cut at inner tile edges only', () => {
    const [t0] = computeTiles(1280, 720, 3, 2, 0.2); // top-left tile
    expect(touchesInnerEdge({ x: 0, y: 10, w: 40, h: 40 }, t0, 1280, 720)).toBe(false); // frame edge
    expect(touchesInnerEdge({ x: t0.w - 30, y: 10, w: 30, h: 40 }, t0, 1280, 720)).toBe(true); // inner edge
  });

  it('merges the same face found by full frame and tile', () => {
    const full = { x: 100, y: 100, w: 50, h: 50, score: 0.7, source: 'full' as const };
    const tile = { x: 102, y: 98, w: 48, h: 52, score: 0.9, source: 'tile' as const };
    const other = { x: 400, y: 100, w: 20, h: 20, score: 0.8, source: 'tile' as const };
    const m = mergeDetections([full, tile, other]);
    expect(m).toHaveLength(2);
    expect(m[0]).toBe(tile);
    expect(iom({ x: 0, y: 0, w: 10, h: 10 }, { x: 0, y: 0, w: 100, h: 100 })).toBe(1);
  });

  it('full-frame minimum face size grows with resolution', () => {
    expect(fullFrameMinFace(1280, 720)).toBeCloseTo(80);
    expect(fullFrameMinFace(1920, 1080)).toBeCloseTo(120);
  });

  it('tracker keeps a far face alive between its tile visits without counting it again', () => {
    const tr = new FaceTracker({ ...DEFAULT_TRACKER, maxVisibleUnseen: 6, maxUnseen: 14 });
    const far = { x: 900, y: 500, w: 22, h: 22, score: 0.8, source: 'tile' as const };
    // seen only every 6th frame (round-robin of 6 tiles); not expected in between
    for (let f = 0; f < 60; f++) {
      const visit = f % 6 === 0;
      tr.update(visit ? [far] : [], () => visit);
    }
    expect(tr.stats.uniqueFaces).toBe(1);
    expect(tr.stats.lostEvents).toBe(0);
    expect(tr.tracks[0].misses).toBe(0);
    expect(tr.isVisible(tr.tracks[0])).toBe(true);
  });

  it('a ghost (face gone, small, not re-checked) stops counting as visible within one cycle', () => {
    const tr = new FaceTracker({ ...DEFAULT_TRACKER, maxVisibleUnseen: 6, maxUnseen: 14 });
    const far = { x: 900, y: 500, w: 22, h: 22, score: 0.8 };
    for (let f = 0; f < 3; f++) tr.update([far]);
    for (let f = 0; f < 7; f++) tr.update([], () => false); // its tile never came round
    expect(tr.isVisible(tr.tracks[0])).toBe(false);
    for (let f = 0; f < 10; f++) tr.update([], () => false);
    expect(tr.tracks).toHaveLength(0); // removed after maxUnseen
    expect(tr.stats.lostEvents).toBe(1);
  });
});

import { estimateShift } from '../src/vision/motion';

describe('camera motion & position memory', () => {
  /** Smooth random texture, shifted by (dx, dy). */
  function texture(w: number, h: number, dx: number, dy: number) {
    const out = new Float32Array(w * h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const X = x - dx;
        const Y = y - dy;
        out[y * w + x] = Math.sin(X * 0.37) * 40 + Math.cos(Y * 0.29) * 30 + Math.sin((X + Y) * 0.11) * 50 + Math.cos(X * 0.13 - Y * 0.21) * 35;
      }
    return out;
  }

  it('estimates integer and sub-pixel shifts', () => {
    const a = texture(80, 45, 0, 0);
    const s1 = estimateShift(a, texture(80, 45, 3, -2), 80, 45, 7)!;
    expect(s1.dx).toBeCloseTo(3, 0);
    expect(s1.dy).toBeCloseTo(-2, 0);
    const s2 = estimateShift(a, texture(80, 45, 2.5, 0), 80, 45, 7)!;
    expect(Math.abs(s2.dx - 2.5)).toBeLessThan(0.35);
  });

  it('returns null for a flat image (no texture to track)', () => {
    const flat = new Float32Array(80 * 45);
    expect(estimateShift(flat, flat, 80, 45, 7)).toBeNull();
  });

  it('with camera motion, 40 faces seen only every 6th frame keep their numbers during a fast pan', () => {
    const tr = new FaceTracker({ ...DEFAULT_TRACKER, maxVisibleUnseen: 6, maxUnseen: 14 });
    const seats = Array.from({ length: 40 }, (_, i) => ({ x: (i % 10) * 90, y: Math.floor(i / 10) * 90 }));
    for (let f = 0; f < 60; f++) {
      const pan = f * 12; // camera pans 12 px/frame (fast)
      const visit = f % 6 === 0;
      const dets = visit ? seats.map((s) => ({ x: s.x - pan + 1000, y: s.y + 100, w: 30, h: 30, score: 0.9 })) : [];
      tr.update(dets, () => visit, f === 0 ? null : { dx: -12, dy: 0 });
    }
    expect(tr.stats.uniqueFaces).toBe(40);
  });

  it('without motion info the same scenario re-counts faces (shows why motion matters)', () => {
    const tr = new FaceTracker({ ...DEFAULT_TRACKER, maxVisibleUnseen: 6, maxUnseen: 14, memoryFrames: 0 });
    const seats = Array.from({ length: 40 }, (_, i) => ({ x: (i % 10) * 90, y: Math.floor(i / 10) * 90 }));
    for (let f = 0; f < 60; f++) {
      const pan = f * 12;
      const visit = f % 6 === 0;
      const dets = visit ? seats.map((s) => ({ x: s.x - pan + 1000, y: s.y + 100, w: 30, h: 30, score: 0.9 })) : [];
      tr.update(dets, () => visit, null);
    }
    expect(tr.stats.uniqueFaces).toBeGreaterThan(40);
  });

  it('re-links a face that leaves the view and comes back (sweep there and back)', () => {
    const tr = new FaceTracker();
    const face = (camX: number) => ({ x: 500 - camX, y: 300, w: 60, h: 60, score: 0.9 });
    let cam = 0;
    const step = (dx: number) => {
      cam += dx;
      const f = face(cam);
      const inView = f.x > 0 && f.x + f.w < 1280;
      tr.update(inView ? [f] : [], () => true, { dx: -dx, dy: 0 });
    };
    for (let i = 0; i < 10; i++) step(0); // seen
    for (let i = 0; i < 80; i++) step(15); // pan right: face leaves on the left
    for (let i = 0; i < 80; i++) step(-15); // pan back: face returns
    for (let i = 0; i < 10; i++) step(0);
    expect(tr.stats.lostEvents).toBe(1);
    expect(tr.stats.relinked).toBe(1);
    expect(tr.stats.uniqueFaces).toBe(1);
  });
});

describe('candidate verification', () => {
  const weak = (x: number) => ({ x, y: 100, w: 40, h: 40, score: 0.5, weak: true });
  it('a weak candidate is not counted until a centred re-check confirms it', () => {
    const tr = new FaceTracker();
    for (let f = 0; f < 5; f++) tr.update([weak(100)]);
    expect(tr.stats.uniqueFaces).toBe(0);
    tr.applyVerification(tr.tracks[0], true);
    expect(tr.tracks[0].confirmed).toBe(true);
    expect(tr.stats.uniqueFaces).toBe(1);
  });
  it('a candidate that fails two re-checks is dropped without ever being counted', () => {
    const tr = new FaceTracker();
    tr.update([weak(100)]);
    tr.applyVerification(tr.tracks[0], false);
    tr.applyVerification(tr.tracks[0], false);
    tr.update([weak(100)]); // dropped; the same spot may start a fresh candidate
    expect(tr.stats.uniqueFaces).toBe(0);
    expect(tr.tracks.every((t) => t.verifyFails === 0)).toBe(true);
  });
  it('a strong detection verifies immediately', () => {
    const tr = new FaceTracker();
    for (let f = 0; f < 3; f++) tr.update([{ x: 100, y: 100, w: 40, h: 40, score: 0.9 }]);
    expect(tr.stats.uniqueFaces).toBe(1);
  });
});

describe('duplicate prevention', () => {
  it('a fresh track of a face whose old track went stale takes over the old number', () => {
    const tr = new FaceTracker({ ...DEFAULT_TRACKER, maxVisibleUnseen: 12, maxUnseen: 26 });
    const f = { x: 300, y: 200, w: 40, h: 40, score: 0.9 };
    for (let i = 0; i < 4; i++) tr.update([f]);
    // old track drifts away (bad prediction) while unseen
    tr.tracks[0].vx = 10; // ≈0.6 face width of drift over the unseen frames
    for (let i = 0; i < 3; i++) tr.update([], () => false);
    for (let i = 0; i < 4; i++) tr.update([f]); // same face detected again at its real place
    expect(tr.stats.uniqueFaces).toBe(1);
    expect(tr.tracks.filter((t) => t.confirmed)).toHaveLength(1);
  });
  it('two counted tracks on one face are merged and un-counted', () => {
    const tr = new FaceTracker();
    for (let i = 0; i < 3; i++) tr.update([{ x: 100, y: 100, w: 50, h: 50, score: 0.9 }, { x: 400, y: 100, w: 50, h: 50, score: 0.9 }]);
    expect(tr.stats.uniqueFaces).toBe(2);
    tr.tracks[1].box = { x: 104, y: 102, w: 50, h: 50 }; // second track wrongly jumps onto the first face
    tr.update([{ x: 100, y: 100, w: 50, h: 50, score: 0.9 }]);
    expect(tr.stats.merged).toBe(1);
    expect(tr.stats.uniqueFaces).toBe(1);
  });
});

describe('edge handling', () => {
  it('a face cut by the frame edge is tracked but only counted once fully inside', () => {
    const tr = new FaceTracker();
    tr.setFrameSize(1280, 720);
    for (let i = 0; i < 5; i++) tr.update([{ x: 0, y: 300, w: 50, h: 60, score: 0.9 }]); // touching left edge
    expect(tr.stats.uniqueFaces).toBe(0);
    for (let i = 0; i < 2; i++) tr.update([{ x: 20, y: 300, w: 60, h: 60, score: 0.9 }]); // fully inside
    expect(tr.stats.uniqueFaces).toBe(1);
  });
});
