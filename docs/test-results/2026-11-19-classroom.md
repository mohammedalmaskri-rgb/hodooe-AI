# Large-class readiness test (38–43 students) – Chromium, 2026-11-19

> **Status: NOT yet validated for 43 students on a real iPhone.** All numbers below come from
> Chromium in a cloud container (4 vCPU, no GPU). Accuracy results (recall, duplicates) depend on
> the engine logic and transfer to the phone; **speed numbers do not** – the iPhone must be measured.

## Test material
- Synthetic classroom, 6 rows / 43 seats, perspective (back-row faces 70 px, front-row 185 px at
  3840×2160 scene resolution), desks, windows. Faces are crops of **adults** from public demo photos
  (21 distinct adults, reused). No minors, no real students.
- Ground truth: exact face box for every seat (`ground-truth-43.json`).
- Camera paths (rendered frame by frame, with hand shake):
  - **whole** – entire class in one 1080p frame (faces 35–93 px), 90 frames.
  - **sweep** – phone closer (half the class width per frame, faces 70–185 px), left→right→left, 272 frames.
  - **fastsweep** – same at double speed, 152 frames.
- A face is "required" when ≥ 50 % of it is inside the frame; detecting a partly visible face is not an error.

## Engine changes in this round
1. **Camera-motion estimation** from an 80-px grayscale copy of each frame (≈1.2 ms): every face box
   is shifted by the measured camera motion → tracking holds while the phone sweeps.
2. **Anonymous position memory**: a face that leaves and returns during the sweep keeps its number
   (scene position only – no image, no embedding).
3. **Adaptive tile grid** by resolution (≈440×400 px tiles: 3×2 at 720p, 4×3 at 1080p) and a time budget per frame.
4. **Two-stage detection**: faces inside tiles score lower (0.41–0.90 measured), so candidates from
   0.45 are kept but must pass a **centred re-check** (face ≈32 px in the model input, where real
   faces are found ≈95 %) before being counted. Max 3 re-checks per frame.
5. **Duplicate prevention**: a fresh track takes over the number of a stale track of the same face;
   two counted tracks on one face are merged and un-counted.
6. **Count only fully visible faces** (not cut by the frame edge) – avoids double counts at edges.
7. Quality measurement limited to 6 faces per frame; text labels hidden above 12 faces.

## Key finding: what limits detection
Detection rate vs. face size **in the model's 192 px input** (each of the 43 faces tested alone):

| Face size in model input | 12 px | 16 px | 20 px | 26 px | 34 px | 48 px | 64 px |
|---|---|---|---|---|---|---|---|
| Detected (of 43) | 19 | 25 | 38 | 40 | 41 | 42 | 43 |

→ a face needs ≈20–26 px in the model input. In a whole-class 1080p frame the back row is 35 px wide,
so it only reaches that inside small tiles. Bringing the phone closer (sweep) or more camera pixels
(4K, if Safari allows it) is what really helps.

## Results (final code)
| Scenario | Mode | Recall (per frame) | False boxes / frame | Faces detected (truth) | Counted | Duplicates | ID swaps | ms / frame (container) |
|---|---|---|---|---|---|---|---|---|
| whole, 1080p | max (12 tiles) | 0.738 | 0 | 36 / 43 | 36 | 0 | 0 | 265 |
| whole, 1080p | max, fine grid (24 tiles) | 0.756 | 0 | **40 / 43** | 40 | 0 | 0 | 406 |
| whole, 1080p | balanced (≈1 tile/frame here) | 0.364 | 0 | 34 / 43 | 34 | 0 | 0 | 55 |
| whole, 720p | max (6 tiles) | 0.434 | 0 | 31 / 43 | 31 | 0 | 0 | 134 |
| sweep, 1080p | max + motion | 0.617 | 0 | 30 | 31 | 1 | 0 | 232 |
| sweep, 1080p | max, **no motion** | 0.597 | 0 | 30 | **55** | **37** | **11** | 254 |
| sweep, 1080p | balanced + motion | 0.495 | 0.66* | 29 | 30 | 1 | 0 | 55 |
| fast sweep, 1080p | max + motion | 0.604 | 0 | 30 | 30 | 0 | 0 | 237 |

\* stale predicted boxes while waiting for a tile (≈12-frame cycle on this slow CPU), not false faces.

Sweep "faces detected" is 30 because the sweep path keeps the back row cut by the top frame edge;
those faces are deliberately not counted (rule 6). Before rule 6 the sweep detected 34 but counted 37.

### Cost vs. number of faces (whole, 1080p, all 12 tiles)
| Faces in scene | 1 | 5 | 10 | 20 | 30 | 43 |
|---|---|---|---|---|---|---|
| Frame time (ms) | 245 | 276 | 243 | 244 | 261 | 265 |
| Tracking (ms) | 0.05 | 0.06 | 0.09 | 0.12 | 0.18 | 0.23 |
| Re-check (ms) | 0.9 | 0.5 | 4.3 | 5.1 | 5.2 | 3.0 |
| Quality (ms) | 0.08 | 0.57 | 0.54 | 0.73 | 0.80 | 0.71 |

→ **Cost does not grow with the number of faces**; it is set by the number of model runs (tiles).
On this container one model run ≈ 18–35 ms.

### Real-time end-to-end (published build, real getUserMedia, 1080p classroom feed)
| Feed / mode | Duration | FPS | Frame ms | CPU (all processes, 4 cores) | Main thread | JS heap | Page process memory | Distinct counted |
|---|---|---|---|---|---|---|---|---|
| whole / balanced | 120 s | 12.7 | 79.5 | 148 % | 97.5 % | 7–11 MB | ≈830–870 MB stable | **43** (truth 43) |
| sweep loop / balanced | 60 s (≈3.6 round trips) | 13.1 | 78.5 | 146 % | 98.9 % | 8–10 MB | stable | 36 |
| whole / max | 60 s | 3.8 | 308 | 147 % | 98.7 % | 7–11 MB | stable | 37 |

- No memory leak: page memory flat over 3 minutes; engine alone stabilises at ≈384–390 MB after
  510 frames (two model instances ≈140 MB + working buffers). Headless Chromium decodes video in
  software, so absolute page memory is not representative of Safari.
- Camera tracks all ended after "End scan" in every run.
- Earlier (before duplicate fixes) a 3-minute whole-class run crept to 48 distinct for 43 faces;
  after the fixes: 43.

## What this means
- Accuracy: with enough tiles the engine found **36–40 of 43** faces of a whole class in one 1080p
  frame with **0 false boxes and 0 duplicates**; sweeping with motion estimation keeps duplicates at 0–1
  (vs 37 without).
- Speed is the open question: on this container only ~1 tile fits per frame at 12–13 FPS. Whether an
  iPhone 16 Pro Max can run enough tiles per frame at a usable FPS must be measured on the device.
- **We do not claim 43-student support** until real iPhone tests pass.

## Known limitations
- Walking towards students / large zoom changes break position memory → possible re-counting.
- Faces that stay cut by the frame edge are not counted (by design).
- Synthetic scene: flat composite, uniform lighting, no occlusion by other students, no motion blur.
