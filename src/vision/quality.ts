import type { Quality, QualityReason } from './types';

// Per-face quality rules (green / yellow / red).
// Inputs are measured on the live frame and discarded immediately afterwards.

export interface QualityThresholds {
  /** MediaPipe detection confidence. */
  scoreGreen: number;
  scoreRed: number;
  /** Face size: shorter side of the box in video pixels. */
  sizeGreen: number;
  sizeRed: number;
  /** Sharpness: variance of Laplacian on a 64×64 grayscale face crop. */
  sharpGreen: number;
  sharpRed: number;
  /** Mean luminance (0–255) of the face crop. */
  darkBelow: number;
  brightAbove: number;
}

export const DEFAULT_THRESHOLDS: QualityThresholds = {
  scoreGreen: 0.8,
  scoreRed: 0.55,
  sizeGreen: 60,
  sizeRed: 24,
  sharpGreen: 120,
  sharpRed: 35,
  darkBelow: 45,
  brightAbove: 225,
};

export interface FaceMeasure {
  score: number;
  size: number;
  /** undefined until first measured. */
  sharpness?: number;
  brightness?: number;
}

export function classifyFace(m: FaceMeasure, th: QualityThresholds = DEFAULT_THRESHOLDS): Quality {
  const red: QualityReason[] = [];
  const yellow: QualityReason[] = [];
  if (m.score < th.scoreRed) red.push('lowConfidence');
  else if (m.score < th.scoreGreen) yellow.push('lowConfidence');
  if (m.size < th.sizeRed) red.push('small');
  else if (m.size < th.sizeGreen) yellow.push('small');
  if (m.sharpness !== undefined) {
    if (m.sharpness < th.sharpRed) red.push('blurry');
    else if (m.sharpness < th.sharpGreen) yellow.push('blurry');
  }
  if (m.brightness !== undefined) {
    if (m.brightness < th.darkBelow) yellow.push('dark');
    else if (m.brightness > th.brightAbove) yellow.push('bright');
  }
  if (red.length) return { level: 'red', reasons: [...red, ...yellow] };
  if (yellow.length) return { level: 'yellow', reasons: yellow };
  return { level: 'green', reasons: [] };
}

/**
 * Sharpness + brightness of an RGBA pixel buffer (e.g. a 64×64 face crop).
 * Sharpness = variance of the 4-neighbour Laplacian on luminance (higher = sharper).
 */
export function measurePixels(rgba: Uint8ClampedArray, width: number, height: number) {
  const n = width * height;
  const lum = new Float32Array(n);
  let sum = 0;
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    const y = 0.299 * rgba[p] + 0.587 * rgba[p + 1] + 0.114 * rgba[p + 2];
    lum[i] = y;
    sum += y;
  }
  let lapSum = 0;
  let lapSq = 0;
  let count = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const l = lum[i - 1] + lum[i + 1] + lum[i - width] + lum[i + width] - 4 * lum[i];
      lapSum += l;
      lapSq += l * l;
      count++;
    }
  }
  const mean = count ? lapSum / count : 0;
  return { sharpness: count ? lapSq / count - mean * mean : 0, brightness: n ? sum / n : 0 };
}
