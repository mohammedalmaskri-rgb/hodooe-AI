// Deterministic engine benchmark on the synthetic classroom with exact ground truth.
// Usage: node bench.cjs SP scenario N far motion(1/0) frameW [budget]
const { chromium } = require('playwright');
const fs = require('fs');
const [SP, SCEN = 'whole', N = '43', FAR = 'balanced', MOTION = '1', FW = '1920', BUDGET = '40', GRID = 'auto'] = process.argv.slice(2);
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage();
  p.on('console', m => m.type() === 'error' && !/INFO|Created TensorFlow/.test(m.text()) && console.log('ERR', m.text()));
  await p.goto('http://localhost:5173/');
  const img = 'data:image/jpeg;base64,' + fs.readFileSync(`${SP}/class/classroom-${N}.jpg`).toString('base64');
  const gt = JSON.parse(fs.readFileSync(`${SP}/class/gt-${N}.json`, 'utf8'));
  const res = await p.evaluate(async ({ img, gt, SCEN, FAR, MOTION, FW, BUDGET, GRID }) => {
    const { loadDetector } = await import('/src/vision/detector.ts');
    const { FrameAnalyzer } = await import('/src/vision/analyzer.ts');
    const { iou } = await import('/src/vision/tracker.ts');
    const base = { model: 'full', delegate: 'CPU', minConfidence: 0.4 };
    const det = (await loadDetector(base)).detector;
    const tileDet = (await loadDetector({ ...base, runningMode: 'IMAGE' })).detector; // tiles + verification (as in the app)
    const W0 = +FW, H0 = Math.round(W0 * 9 / 16);
    const grid = GRID === 'fine' ? { cols: Math.round(W0 / 300), rows: Math.round(H0 / 280) } : undefined;
    const an = new FrameAnalyzer({ detector: det, tileDetector: tileDet, far: FAR, motion: MOTION === '1', tileBudgetMs: +BUDGET, grid });
    const scene = new Image(); scene.src = img; await scene.decode();
    const SW = scene.width, SH = scene.height;
    const W = +FW, H = Math.round(W * 9 / 16);
    const fc = document.createElement('canvas'); fc.width = W; fc.height = H; const fx = fc.getContext('2d', { willReadFrequently: false });

    // Camera path: view rectangle (scene coords) per frame.
    const views = [];
    if (SCEN === 'whole') {
      for (let f = 0; f < 90; f++) views.push({ x: 6 * Math.sin(f * 0.5), y: 6 * Math.cos(f * 0.37), w: SW });
    } else {
      const speed = SCEN === 'fastsweep' ? 2 : 1; // sweep: 120 frames per direction; fast: 60
      const vw = SW / 2, steps = 120 / speed, travel = SW - vw;
      for (let f = 0; f < 10; f++) views.push({ x: 0, y: 500, w: vw });
      for (let i = 0; i <= steps; i++) views.push({ x: travel * i / steps, y: 500 + 12 * Math.sin(i * 0.4), w: vw });
      for (let f = 0; f < 10; f++) views.push({ x: travel, y: 500, w: vw });
      for (let i = steps; i >= 0; i--) views.push({ x: travel * i / steps, y: 500 + 12 * Math.sin(i * 0.4), w: vw });
      for (let f = 0; f < 10; f++) views.push({ x: 0, y: 500, w: vw });
    }

    const perGt = new Map(); const perFace = new Map();
    let tp = 0, fn = 0, fp = 0, gtSeen = new Set(); const times = []; const stage = { motionMs: 0, fullMs: 0, tilesMs: 0, tilesRun: 0, trackMs: 0, verifyMs: 0, verified: 0, qualityMs: 0 };
    let maxVisible = 0, maxGtIn = 0; let tsec = 0;
    for (const v of views) {
      const vh = v.w * 9 / 16, s = W / v.w;
      fx.drawImage(scene, v.x, v.y, v.w, vh, 0, 0, W, H);
      fx.getImageData(0, 0, 1, 1); // force the test frame to be rendered before timing (camera frames arrive ready)
      tsec += 33.3;
      const r = an.analyze(fc, W, H, tsec);
      times.push(r.timings.totalMs);
      for (const k of Object.keys(stage)) stage[k] += r.timings[k];
      // ground truth in frame
      // Ground truth in frame: 'required' if ≥50 % of the face is inside, 'optional' if partly inside
      // (detecting a half-visible face is neither required nor an error).
      const frac = g => { const ix = Math.max(0, Math.min(W, g.x + g.w) - Math.max(0, g.x)), iy = Math.max(0, Math.min(H, g.y + g.h) - Math.max(0, g.y)); return ix * iy / (g.w * g.h); };
      const all = gt.map(g => ({ id: g.id, x: (g.x - v.x) * s, y: (g.y - v.y) * s, w: g.w * s, h: g.h * s })).map(g => ({ ...g, f: frac(g) })).filter(g => g.f > 0);
      const gin = all;
      maxVisible = Math.max(maxVisible, r.visible.length);
      // greedy IoU matching visible tracks <-> GT
      const pairs = [];
      r.visible.forEach((t, ti) => gin.forEach((g, gi) => { const o = iou(t.box, g); if (o >= 0.3) pairs.push([o, ti, gi]); }));
      pairs.sort((a, b) => b[0] - a[0]);
      const ut = new Set(), ug = new Set();
      for (const [, ti, gi] of pairs) {
        if (ut.has(ti) || ug.has(gi)) continue; ut.add(ti); ug.add(gi);
        const g = gin[gi], t = r.visible[ti];
        if (g.f >= 0.5) gtSeen.add(g.id);
        if (!perGt.has(g.id)) perGt.set(g.id, new Set()); if (!perGt.get(g.id).has(t.faceNo)) (window.__firstSeen ||= {})[`${g.id}:${t.faceNo}`] = { frame: views.indexOf(v), x: Math.round(v.x), size: Math.round(g.w), frac: +g.f.toFixed(2) }; perGt.get(g.id).add(t.faceNo);
        if (!perFace.has(t.faceNo)) perFace.set(t.faceNo, new Set()); perFace.get(t.faceNo).add(g.id);
      }
      const req = gin.filter(g => g.f >= 0.5);
      tp += [...ug].filter(gi => gin[gi].f >= 0.5).length;
      fn += req.filter(g => ![...ug].some(gi => gin[gi].id === g.id)).length;
      fp += r.visible.length - ut.size;
      maxGtIn = Math.max(maxGtIn, req.length);
    }
    const st = an.tracker.stats;
    times.sort((a, b) => a - b);
    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    const dupes = [...perGt.values()].reduce((a, s) => a + s.size - 1, 0);
    const swaps = [...perFace.values()].filter(s => s.size > 1).length;
    for (const k of Object.keys(stage)) stage[k] = +(stage[k] / views.length).toFixed(2);
    return {
      frames: views.length, gtFaces: gt.length, maxGtInFrame: maxGtIn, maxVisible,
      recall: +(tp / (tp + fn)).toFixed(3), falsePerFrame: +(fp / views.length).toFixed(2),
      distinctCounted: st.uniqueFaces, distinctTruthDetected: gtSeen.size, duplicates: dupes, idSwaps: swaps,
      relinked: st.relinked, lost: st.lostEvents,
      avgMs: +avg.toFixed(1), p95Ms: +times[Math.floor(times.length * 0.95)].toFixed(1), computeFps: +(1000 / avg).toFixed(1),
      dupDetail: [...perGt.entries()].filter(([, s]) => s.size > 1).map(([id, s]) => ({ gt: id, row: gt.find(q => q.id === id).row, faceNos: [...s].map(f => ({ f, ...window.__firstSeen[`${id}:${f}`] })) })),
      tilesPerFrame: stage.tilesRun, tileGrid: an.tileCount, stage,
    };
  }, { img, gt, SCEN, FAR, MOTION, FW, BUDGET, GRID });
  const tag = `${SCEN}-N${N}-${FAR}-m${MOTION}-${FW}-b${BUDGET}-${GRID}`;
  console.log(tag, JSON.stringify(res));
  fs.mkdirSync(`${SP}/bench`, { recursive: true });
  fs.writeFileSync(`${SP}/bench/${tag}.json`, JSON.stringify({ scenario: SCEN, N: +N, far: FAR, motion: MOTION === '1', frameW: +FW, budget: +BUDGET, grid: GRID, ...res }));
  await b.close();
})().catch(e => { console.error('CRASH', e); process.exit(2); });
