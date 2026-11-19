// Prepares MediaPipe assets so the app never calls an external CDN at runtime:
//  1. Copies the WASM runtime from node_modules into public/mediapipe/wasm (git-ignored).
//  2. Downloads face-detector models into public/mediapipe/models if missing.
// Runs automatically before `dev` and `build` (see package.json "pre*" scripts).
import { cp, mkdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const wasmSrc = join(root, 'node_modules/@mediapipe/tasks-vision/wasm');
const wasmDst = join(root, 'public/mediapipe/wasm');
const modelsDir = join(root, 'public/mediapipe/models');

const MODELS = {
  'blaze_face_short_range.tflite':
    'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/latest/blaze_face_short_range.tflite',
  'blaze_face_full_range.tflite':
    'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_full_range/float16/latest/blaze_face_full_range.tflite',
};

const exists = (p) => stat(p).then(() => true, () => false);

await mkdir(wasmDst, { recursive: true });
await cp(wasmSrc, wasmDst, { recursive: true });
console.log('[mediapipe] WASM runtime copied');

await mkdir(modelsDir, { recursive: true });
for (const [file, url] of Object.entries(MODELS)) {
  const dst = join(modelsDir, file);
  if (await exists(dst)) continue;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`[mediapipe] failed to download ${file}: HTTP ${res.status}`);
  await writeFile(dst, Buffer.from(await res.arrayBuffer()));
  console.log(`[mediapipe] downloaded ${file}`);
}
