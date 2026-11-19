import type { Box, Detection } from './types';

// Frame tiling for far faces.
// The detector shrinks its whole input to 192 px, so a far face in a 1280×720 frame
// becomes only a few pixels. Analysing smaller OVERLAPPING crops (tiles) makes each face
// 2–3× larger for the model. Tiles are cut from the live frame in memory and discarded.

export interface Tile extends Box {
  index: number;
}

/** Overlapping grid covering the frame. overlap = fraction of a tile shared with its neighbour. */
export function computeTiles(frameW: number, frameH: number, cols: number, rows: number, overlap: number): Tile[] {
  const tw = frameW / (cols - (cols - 1) * overlap);
  const th = frameH / (rows - (rows - 1) * overlap);
  const tiles: Tile[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = cols === 1 ? 0 : (c * (frameW - tw)) / (cols - 1);
      const y = rows === 1 ? 0 : (r * (frameH - th)) / (rows - 1);
      tiles.push({ index: tiles.length, x: Math.round(x), y: Math.round(y), w: Math.round(tw), h: Math.round(th) });
    }
  }
  return tiles;
}

/**
 * True if a detection (in tile coordinates) touches a tile edge that is INSIDE the frame:
 * such faces are probably cut in half – the neighbouring tile (thanks to overlap) or the
 * full-frame pass sees them whole.
 */
export function touchesInnerEdge(d: Box, tile: Tile, frameW: number, frameH: number, margin = 2): boolean {
  if (d.x <= margin && tile.x > 0) return true;
  if (d.y <= margin && tile.y > 0) return true;
  if (d.x + d.w >= tile.w - margin && tile.x + tile.w < frameW) return true;
  if (d.y + d.h >= tile.h - margin && tile.y + tile.h < frameH) return true;
  return false;
}

/** Intersection over the SMALLER box (catches a partial box inside a full one). */
export function iom(a: Box, b: Box): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const small = Math.min(a.w * a.h, b.w * b.h);
  return small > 0 ? inter / small : 0;
}

/** Merges detections from the full frame and tiles: the same face found twice is kept once (highest score). */
export function mergeDetections<T extends Detection>(dets: T[], threshold = 0.5): T[] {
  const sorted = [...dets].sort((a, b) => b.score - a.score);
  const kept: T[] = [];
  for (const d of sorted) if (!kept.some((k) => iom(k, d) > threshold)) kept.push(d);
  return kept;
}

/** Smallest face size (px, in the frame) the full-frame pass can still reliably see. */
export function fullFrameMinFace(frameW: number, frameH: number, modelInput = 192, minModelPx = 12): number {
  return (minModelPx * Math.max(frameW, frameH)) / modelInput;
}
