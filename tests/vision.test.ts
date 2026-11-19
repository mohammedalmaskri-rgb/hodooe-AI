import { describe, expect, it } from 'vitest';
import { FaceTracker, iou } from '../src/vision/tracker';
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
