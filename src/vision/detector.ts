import type { FaceDetector } from '@mediapipe/tasks-vision';

export type ModelKind = 'short' | 'full';
export type DelegateKind = 'CPU' | 'GPU';

export interface DetectorConfig {
  model: ModelKind;
  delegate: DelegateKind;
  minConfidence: number;
}

export interface LoadedDetector {
  detector: FaceDetector;
  /** Delegate actually in use (GPU may fall back to CPU). */
  delegate: DelegateKind;
  loadMs: number;
}

// The WASM runtime and models are served from this site (public/mediapipe) –
// no external CDN request is made at runtime.
const asset = (path: string) => new URL(path, document.baseURI).href;

/** Loads MediaPipe Face Detector in VIDEO mode. The library itself is lazy-loaded. */
export async function loadDetector(cfg: DetectorConfig): Promise<LoadedDetector> {
  const t0 = performance.now();
  const { FaceDetector, FilesetResolver } = await import('@mediapipe/tasks-vision');
  const fileset = await FilesetResolver.forVisionTasks(asset('./mediapipe/wasm'));
  const make = (delegate: DelegateKind) =>
    FaceDetector.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: asset(`./mediapipe/models/blaze_face_${cfg.model}_range.tflite`), delegate },
      runningMode: 'VIDEO',
      minDetectionConfidence: cfg.minConfidence,
      minSuppressionThreshold: 0.3,
    });
  let delegate = cfg.delegate;
  let detector: FaceDetector;
  try {
    detector = await make(delegate);
  } catch (e) {
    if (delegate !== 'GPU') throw e;
    console.warn('GPU delegate unavailable, falling back to CPU', e);
    delegate = 'CPU';
    detector = await make(delegate);
  }
  return { detector, delegate, loadMs: performance.now() - t0 };
}
