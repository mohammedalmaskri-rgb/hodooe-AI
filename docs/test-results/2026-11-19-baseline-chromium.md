# Baseline – Live Scan without tiling (Chromium, 2026-11-19)

> Automated test in Chromium (headless, cloud container CPU), iPhone 15 Pro Max viewport.
> **Not** measured on a real iPhone – real-device numbers are recorded separately.

## Test feed (36 s, 1280×720, 30 fps, delivered through real `getUserMedia` via Chromium's fake camera)
| Time | Content | Faces in scene |
|---|---|---|
| 0–24 s | Close: camera pans across 6 group photos with hand shake (±25 px, 7 rad/s) | 3,3,3,4,6,4 |
| 24–30 s | Medium: whole photo, slow drift | 4, 4 |
| 30–36 s | Far: photo occupies ~45–65 % of frame height (small faces) | 6, 3 |

Images: public demo images of adults from the `@vladmandic/face-api` package, used locally only, not committed.

## Results
| Metric | full-range (default) | short-range |
|---|---|---|
| Processed FPS (close) | 20.7 | 25.5 |
| Avg frame time | 33.8 ms | 21.4 ms |
| Close: max faces visible | 4 | 4 |
| Medium: avg / max faces (truth 4) | **4.00 / 4** | 1.05 / 2 |
| Far: avg / max faces (truth 6, 3) | 1.20 / 2 | 0.43 / 1 |
| Distinct faces counted (whole feed) | 29 | 24 |
| Camera start → first frame | 103 ms | 193 ms |
| Model load | 310 ms | 268 ms |
| First face after start | 214 ms | 168 ms |

### Tracking during camera motion (full-range): new anonymous IDs per segment
| Segment | Faces in photo | New IDs | Max visible |
|---|---|---|---|
| pan sample1 | 3 | 3 | 2 |
| pan sample2 | 3 | 3 | 2 |
| pan sample3 | 3 | 2 | 3 |
| pan sample4 | 4 | 5 | 3 |
| pan sample5 | 6 | 2 | 4 |
| pan sample6 | 4 | 3 | 4 |
| medium s4 | 4 | 4 | 4 |
| medium s6 | 4 | 3 | 4 |
| far s5 | 6 | 2 | 2 |
| far s3 | 3 | 2 | 2 |

## Conclusion
- Tracking does not re-count faces while panning (only one double count in 10 segments).
- Small/far faces are the main weakness: the whole 1280×720 frame is downscaled to the model's
  192 px input, so a far face becomes a few pixels. → Tiling experiment.

Raw per-250 ms samples: `2026-11-19-baseline-*.timeline.json` (t, faces now, distinct, fps, ms).
