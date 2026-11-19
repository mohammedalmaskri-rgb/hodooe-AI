// Rear-camera access via getUserMedia (WebRTC). Video only – no audio, no recording.

export type CameraErrorCode = 'insecure' | 'unsupported' | 'denied' | 'notFound' | 'busy' | 'constraints' | 'unknown';

export class CameraError extends Error {
  constructor(public code: CameraErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'CameraError';
  }
}

export type Resolution = '720' | '1080';

export function constraintsFor(res: Resolution): MediaStreamConstraints {
  const [w, h] = res === '1080' ? [1920, 1080] : [1280, 720];
  return {
    audio: false,
    video: {
      facingMode: { ideal: 'environment' }, // rear camera on phones
      width: { ideal: w },
      height: { ideal: h },
      frameRate: { ideal: 30 },
    },
  };
}

function mapError(e: unknown): CameraError {
  const name = e instanceof DOMException || e instanceof Error ? e.name : '';
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return new CameraError('denied');
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return new CameraError('notFound');
    case 'NotReadableError':
    case 'TrackStartError':
    case 'AbortError':
      return new CameraError('busy');
    case 'OverconstrainedError':
      return new CameraError('constraints');
    default:
      return new CameraError('unknown', e instanceof Error ? e.message : String(e));
  }
}

export interface OpenedCamera {
  stream: MediaStream;
  track: MediaStreamTrack;
  width: number;
  height: number;
  facingMode?: string;
  label: string;
  /** getUserMedia call → first frame playing (ms). */
  startMs: number;
}

/** Opens the camera and starts playback in the given <video>. */
export async function openCamera(video: HTMLVideoElement, res: Resolution): Promise<OpenedCamera> {
  if (!window.isSecureContext) throw new CameraError('insecure');
  if (!navigator.mediaDevices?.getUserMedia) throw new CameraError('unsupported');
  const t0 = performance.now();
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia(constraintsFor(res));
  } catch (e) {
    throw mapError(e);
  }
  const track = stream.getVideoTracks()[0];
  // iOS Safari requirements for inline, autoplaying camera video.
  video.setAttribute('playsinline', '');
  video.muted = true;
  video.srcObject = stream;
  try {
    await video.play();
    if (video.readyState < 2) {
      await new Promise<void>((resolve) => video.addEventListener('loadeddata', () => resolve(), { once: true }));
    }
  } catch (e) {
    stopStream(stream, video);
    throw mapError(e);
  }
  const settings = track.getSettings();
  return {
    stream,
    track,
    width: video.videoWidth || settings.width || 0,
    height: video.videoHeight || settings.height || 0,
    facingMode: settings.facingMode,
    label: track.label,
    startMs: performance.now() - t0,
  };
}

/** Stops every track (turns the camera light off) and detaches the stream. */
export function stopStream(stream: MediaStream | null | undefined, video?: HTMLVideoElement | null) {
  stream?.getTracks().forEach((t) => t.stop());
  if (video) {
    video.pause();
    video.srcObject = null;
  }
}
