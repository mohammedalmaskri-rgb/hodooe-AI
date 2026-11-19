// Builds a synthetic classroom (adult faces from public demo images) + exact ground-truth boxes.
const { chromium } = require('playwright');
const fs = require('fs');
const SP = process.argv[2];
const COUNTS = [1, 5, 10, 20, 30, 43];
(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  p.on('console', m => /error/i.test(m.type()) && !/INFO/.test(m.text()) && console.log('ERR', m.text()));
  await p.goto('http://localhost:5173/');
  const imgs = [1,2,3,4,5,6].map(i => 'data:image/jpeg;base64,' + fs.readFileSync(`${SP}/faceapi/package/demo/sample${i}.jpg`).toString('base64'));
  const outs = await p.evaluate(async ({ imgs, COUNTS }) => {
    const { loadDetector } = await import('/src/vision/detector.ts');
    const T = await import('/src/vision/tiles.ts');
    const det = (await loadDetector({ model: 'full', delegate: 'CPU', minConfidence: 0.5, runningMode: 'IMAGE' })).detector;
    // 1) Extract face crops (head region) from each photo.
    const faces = [];
    for (const src of imgs) {
      const im = new Image(); im.src = src; await im.decode();
      const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; c.getContext('2d').drawImage(im, 0, 0);
      let all = det.detect(c).detections.map(d => ({ ...d.boundingBox, score: d.categories[0].score }));
      const tc = document.createElement('canvas'); const tx = tc.getContext('2d');
      for (const t of T.computeTiles(im.width, im.height, 3, 2, 0.25)) {
        tc.width = t.w; tc.height = t.h; tx.drawImage(c, t.x, t.y, t.w, t.h, 0, 0, t.w, t.h);
        for (const d of det.detect(tc).detections) all.push({ originX: d.boundingBox.originX + t.x, originY: d.boundingBox.originY + t.y, width: d.boundingBox.width, height: d.boundingBox.height, score: d.categories[0].score });
      }
      const boxes = T.mergeDetections(all.filter(d => d.score >= 0.8).map(d => ({ x: d.originX, y: d.originY, w: d.width, h: d.height, score: d.score })));
      for (const bx of boxes) {
        // head region: generous margin around the face box
        const mx = bx.w * 0.28, top = bx.h * 0.5, bot = bx.h * 0.35;
        const x = Math.max(0, bx.x - mx), y = Math.max(0, bx.y - top);
        const w = Math.min(im.width - x, bx.w + 2 * mx), h = Math.min(im.height - y, bx.h + top + bot);
        const cc = document.createElement('canvas'); cc.width = w; cc.height = h;
        cc.getContext('2d').drawImage(c, x, y, w, h, 0, 0, w, h);
        faces.push({ canvas: cc, face: { x: bx.x - x, y: bx.y - y, w: bx.w, h: bx.h } });
      }
    }
    const results = {};
    for (const N of COUNTS) {
    // 2) Compose classroom 3840x2160: 6 rows, perspective scaling, 43 seats.
    const W = 3840, H = 2160;
    const sc = document.createElement('canvas'); sc.width = W; sc.height = H; const s = sc.getContext('2d');
    const g = s.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#d9dde3'); g.addColorStop(0.45, '#c9ced6'); g.addColorStop(1, '#8d8478');
    s.fillStyle = g; s.fillRect(0, 0, W, H);
    s.fillStyle = '#e9ecef'; for (let i = 0; i < 4; i++) s.fillRect(300 + i * 900, 120, 500, 260); // windows
    let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const rows = [ // back -> front: y of face centre, face size (px), seats
      { y: 520, size: 70, n: 8 }, { y: 690, size: 84, n: 8 }, { y: 880, size: 100, n: 7 },
      { y: 1100, size: 122, n: 7 }, { y: 1360, size: 150, n: 7 }, { y: 1660, size: 185, n: 6 },
    ];
    const gt = []; let k = 0; let seat = 0;
    // fixed order in which seats get filled, so smaller classes are subsets of larger ones
    let s2 = 99; const order = [...Array(43).keys()].map(i => [i, (s2 = (s2 * 48271) % 2147483647)]).sort((a, b) => a[1] - b[1]).map(a => a[0]);
    const filled = new Set(order.slice(0, N));
    for (const r of rows) {
      const span = W * (0.55 + 0.4 * (r.size - 70) / 115); // front rows wider
      for (let i = 0; i < r.n; i++) {
        const f = faces[k++ % faces.length];
        const seatNo = seat++;
        const cx = W / 2 - span / 2 + (i + 0.5) * span / r.n + (rnd() - 0.5) * r.size * 0.4;
        const cy = r.y + (rnd() - 0.5) * r.size * 0.2;
        const scale = r.size / f.face.w;
        const dw = f.canvas.width * scale, dh = f.canvas.height * scale;
        const dx = cx - (f.face.x + f.face.w / 2) * scale, dy = cy - (f.face.y + f.face.h / 2) * scale;
        // soft elliptical mask so the crop blends in
        if (!filled.has(seatNo)) continue;
        const tmp = document.createElement('canvas'); tmp.width = dw; tmp.height = dh; const t2 = tmp.getContext('2d');
        const flip = rnd() < 0.5;
        if (flip) { t2.translate(dw, 0); t2.scale(-1, 1); }
        t2.filter = `brightness(${0.85 + rnd() * 0.3})`;
        t2.drawImage(f.canvas, 0, 0, dw, dh); t2.setTransform(1, 0, 0, 1, 0, 0); t2.filter = 'none';
        const rg = t2.createRadialGradient(dw / 2, dh / 2, Math.min(dw, dh) * 0.36, dw / 2, dh / 2, Math.min(dw, dh) * 0.52);
        rg.addColorStop(0, 'rgba(0,0,0,1)'); rg.addColorStop(1, 'rgba(0,0,0,0)');
        t2.globalCompositeOperation = 'destination-in'; t2.fillStyle = rg; t2.fillRect(0, 0, dw, dh);
        s.drawImage(tmp, dx, dy);
        const fx = flip ? dx + dw - (f.face.x + f.face.w) * scale : dx + f.face.x * scale;
        gt.push({ id: gt.length + 1, row: rows.indexOf(r), x: Math.round(fx), y: Math.round(dy + f.face.y * scale), w: Math.round(f.face.w * scale), h: Math.round(f.face.h * scale) });
      }
      // desks in front of this row
      s.fillStyle = '#7a5a3c'; s.fillRect(W / 2 - span / 2 - 40, r.y + r.size * 1.05, span + 80, r.size * 0.55);
      s.fillStyle = '#5e4630'; s.fillRect(W / 2 - span / 2 - 40, r.y + r.size * 1.6, span + 80, r.size * 0.12);
    }
    results[N] = { png: sc.toDataURL('image/png'), gt };
    }
    return { results, facesExtracted: faces.length };
  }, { imgs, COUNTS });
  for (const N of COUNTS) {
    fs.writeFileSync(`${SP}/class/classroom-${N}.png`, Buffer.from(outs.results[N].png.split(',')[1], 'base64'));
    fs.writeFileSync(`${SP}/class/gt-${N}.json`, JSON.stringify(outs.results[N].gt));
    console.log(`N=${N}: placed ${outs.results[N].gt.length}`);
  }
  await b.close();
})();
