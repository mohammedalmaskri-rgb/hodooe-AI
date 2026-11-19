# Classroom benchmark tools

Scripts used to test the live-scan engine on a synthetic **43-seat classroom** with exact ground truth.

- `gen-class.cjs` – builds the classroom scene (3840×2160) from **adult** demo photos of the
  `@vladmandic/face-api` npm package (`package/demo/sample1–6.jpg`), plus variants with 1–43 faces
  and ground-truth face boxes. Images are generated locally and are **not committed**
  (`.gitignore` excludes images).
- `bench.cjs` – deterministic, frame-by-frame benchmark: renders camera views of the scene
  (whole class / sweep there-and-back / fast sweep, with hand shake), runs the same
  `FrameAnalyzer` the app uses, and compares every box with the ground truth
  (recall, false boxes, duplicates, ID swaps, per-stage timings).
- `e2e-perf.cjs` – real-time test of the published build through real `getUserMedia`
  (Chromium fake camera fed with an MJPEG of the classroom), sampling FPS, CPU and memory via CDP.

Requirements: Playwright + Chromium, ffmpeg, a running `vite` dev server (bench) or `vite preview` (perf).
Usage examples are at the top of each script. Results are in `docs/test-results/2026-11-19-classroom/`.

No minors' images are used. Detection ≠ identity: nothing here identifies anyone.
