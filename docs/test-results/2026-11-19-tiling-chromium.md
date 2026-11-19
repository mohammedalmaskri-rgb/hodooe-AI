# Far-face tiling experiment (Chromium, 2026-11-19)

> Same 36 s moving-camera feed and environment as the baseline
> (`2026-11-19-baseline-chromium.md`). Model: full-range, CPU. **Not a real iPhone.**

## What tiling does
Besides the whole frame, the frame is split into a 3×2 grid of tiles overlapping by 20 %
(each ≈492×400 px at 1280×720). A face inside a tile is ≈2.6× larger for the model's 192 px input.
Tiles are cut from the live frame in memory and discarded immediately.

| Mode | What runs per frame |
|---|---|
| off | whole frame only (1 inference) |
| balanced | whole frame + 1 tile in rotation (2 inferences; each tile revisited every 6 frames) |
| max | whole frame + all 6 tiles (7 inferences) |

Merging & tracking rules:
- Duplicates (same face from frame and tile) merged by intersection-over-smaller-box > 0.5.
- Faces cut at an inner tile edge are ignored (the overlapping neighbour sees them whole).
- Tile detections need score ≥ 0.6 (measured: real faces in tiles 0.64–0.90; false positives on
  hair/poster edges 0.41–0.51).
- A small face is only counted as "missed" in frames where its tile was analysed.
- Only confirmed faces (3 detections) are drawn and counted.

## Results (per segment: average faces visible / max / new anonymous IDs)
| Segment (truth) | off | balanced | max |
|---|---|---|---|
| pan s1 (3) | 1.85 / 2 / +3 | 1.77 / 2 / +5 | 1.50 / 2 / +3 |
| pan s2 (3) | 1.77 / 2 / +3 | 1.67 / 2 / +1 | 1.67 / 2 / +3 |
| pan s3 (3) | 1.92 / 3 / +2 | 1.92 / 2 / +2 | 1.73 / 2 / +2 |
| pan s4 (4) | 2.69 / 3 / +3 | 2.75 / 3 / +3 | 2.58 / 3 / +3 |
| pan s5 (6) | 2.92 / 4 / +4 | 3.00 / 4 / +4 | 2.73 / 4 / +4 |
| pan s6 (4) | 2.08 / 3 / +3 | 2.15 / 4 / +7 | 1.90 / 3 / +3 |
| medium s4 (4) | 4.00 / 4 / +4 | 3.63 / 4 / +0 | 4.00 / 4 / +4 |
| medium s6 (4) | 4.00 / 4 / +3 | 3.56 / 4 / +3 | 3.43 / 4 / +4 |
| **far s5 (6)** | **0.00** / 0 / +0 | **4.43** / 5 / +5 | **4.88** / 5 / +5 |
| **far s3 (3)** | 2.00 / 2 / +2 | 2.67 / 3 / +1 | 3.00 / 3 / +1 |
| Processed FPS | 25.2 | 18.4 | 6.8 |
| Avg frame time | 32.5 ms | 52.3 ms | 150.4 ms |
| Segments over-counting faces | 0 | 0 | 0 |
| Distinct faces (whole feed) | 29 | 33 | 32 |

(Pan segments show only part of each photo at a time, so fewer faces than "truth" is expected there.)

## Conclusion
- **balanced** is the default: far faces go from 0 → 4.4 of 6 and 2 → 2.7 of 3, at ~27 % lower FPS.
- **max** finds slightly more far faces but drops to ~7 FPS here – too slow for live scanning.
- Cost to watch on the iPhone: in balanced mode re-counting while panning rose slightly
  (two segments with extra IDs). Real-device numbers decide the final setting.

## Earlier iterations (kept for transparency)
1. First tiling run counted up to 6 faces where 4 existed. Cause found with a dev-only tracker dump:
   unconfirmed one-off tile detections were counted. Fix: count/draw confirmed faces only.
2. Still 5–6 for 4 on one photo. Cause: a repeated false positive (hair + poster edge, score 0.50).
   Fix: tile score threshold 0.6, chosen from measured score ranges above.
