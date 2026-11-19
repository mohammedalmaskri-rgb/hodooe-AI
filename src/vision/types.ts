/** Axis-aligned box in VIDEO pixel coordinates. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** One raw face detection from MediaPipe for a single frame. */
export interface Detection extends Box {
  score: number;
  /** Which pass found it: whole frame or a tile (far-face mode). */
  source?: 'full' | 'tile';
  /** Below the strong-confidence level: may only become a counted face after verification. */
  weak?: boolean;
}

export type QualityLevel = 'green' | 'yellow' | 'red';
export type QualityReason = 'lowConfidence' | 'small' | 'blurry' | 'dark' | 'bright' | 'lost';

export interface Quality {
  level: QualityLevel;
  reasons: QualityReason[];
}
