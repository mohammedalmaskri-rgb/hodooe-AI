// Real-time end-to-end performance: published build, real getUserMedia (Chromium fake camera
// fed with the 1080p classroom video), sampling FPS / CPU / memory while scanning.
const { chromium, devices } = require('playwright');
const { execSync } = require('child_process');
const fs = require('fs');
const [SP, FAR = 'balanced', SECS = '90', RES = '1080', FEED = 'class/class1080.mjpeg'] = process.argv.slice(2);
(async () => {
  const b = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${SP}/${FEED}`, '--enable-precise-memory-info'] });
  const ctx = await b.newContext({ ...devices['iPhone 15 Pro Max'], deviceScaleFactor: 1, permissions: ['camera'] });
  await ctx.addInitScript((cfg) => {
    window.__streams = []; const gum = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (c) => { const s = await gum(c); window.__streams.push(s); return s; };
    localStorage.setItem('hodoor.scanSettings', JSON.stringify({ model: 'full', delegate: 'CPU', resolution: cfg.res, far: cfg.far }));
  }, { far: FAR, res: RES });
  const p = await ctx.newPage();
  const errors = []; p.on('pageerror', e => errors.push(e.message));
  const cdp = await ctx.newCDPSession(p); await cdp.send('Performance.enable');
  const bcdp = await b.newBrowserCDPSession();
  const cpuTotal = async () => (await bcdp.send('SystemInfo.getProcessInfo')).processInfo.reduce((a, x) => a + x.cpuTime, 0);
  // Resident memory per Chromium process type (renderer = the web page incl. MediaPipe WASM).
  const rssByType = () => { const out = execSync("ps -eo rss,args").toString().split('\n'); const r = {}; for (const l of out) { if (!/chrom|headless_shell/i.test(l)) continue; const m = l.trim().match(/^(\d+)\s+(.*)$/); if (!m) continue; const ty = (m[2].match(/--type=([\w-]+)/) || [, 'browser'])[1]; const key = ty === 'utility' ? ((m[2].match(/--utility-sub-type=([\w.]+)/) || [, 'utility'])[1].split('.').pop()) : ty; r[key] = (r[key] || 0) + Math.round(+m[1] / 1024); } return r; };
  const rssMB = () => Object.values(rssByType()).reduce((a, b) => a + b, 0);
  const metric = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]));

  await p.goto('http://localhost:4173/#/teacher');
  await p.getByRole('button', { name: 'إنشاء الصف التجريبي على هذا الجهاز' }).click();
  const rssBefore = rssMB(); const rssBeforeByType = rssByType();
  await p.getByRole('button', { name: 'بدء المسح المباشر' }).click();
  await p.getByText('بث مباشر').waitFor({ timeout: 60000 });
  const samples = [];
  const t0 = Date.now(); let lastCpu = await cpuTotal(), lastWall = Date.now(), lastTask = (await metric()).TaskDuration;
  while (Date.now() - t0 < +SECS * 1000) {
    await p.waitForTimeout(2000);
    const now = Date.now(), cpu = await cpuTotal(), m = await metric();
    const hud = await p.evaluate(() => Object.fromEntries([...document.querySelectorAll('[data-hud]')].map(e => [e.dataset.hud, e.textContent])));
    samples.push({ t: +((now - t0) / 1000).toFixed(1), faces: +hud['faces-now'], unique: +hud.unique, fps: +hud.fps, ms: +hud.ms,
      cpuPct: Math.round((cpu - lastCpu) / ((now - lastWall) / 1000) * 100), mainThreadPct: Math.round((m.TaskDuration - lastTask) / ((now - lastWall) / 1000) * 100),
      heapMB: +(m.JSHeapUsedSize / 1048576).toFixed(1), rssMB: rssMB(), rss: rssByType() });
    lastCpu = cpu; lastWall = now; lastTask = m.TaskDuration;
  }
  await p.getByRole('button', { name: 'إنهاء المسح' }).click();
  await p.getByText('ملخص جلسة المسح').waitFor();
  const live = await p.evaluate(() => window.__streams.flatMap(s => s.getTracks()).filter(t => t.readyState === 'live').length);
  const summary = (await p.locator('[data-testid=summary]').innerText()).replace(/\n/g, ' | ');
  await p.waitForTimeout(3000);
  const rssAfterStop = rssMB();
  const avg = (k, from = 0) => { const a = samples.filter(s => s.t >= from); return +(a.reduce((x, s) => x + s[k], 0) / a.length).toFixed(1); };
  const res = { far: FAR, res: RES, secs: +SECS, avgFps: avg('fps', 4), avgFrameMs: avg('ms', 4), avgCpuPct: avg('cpuPct', 4), avgMainThreadPct: avg('mainThreadPct', 4),
    heapStartMB: samples[1]?.heapMB, heapEndMB: samples.at(-1).heapMB, heapMaxMB: Math.max(...samples.map(s => s.heapMB)),
    rssBeforeMB: rssBefore, rssMaxMB: Math.max(...samples.map(s => s.rssMB)), rssEndMB: samples.at(-1).rssMB, rssAfterStopMB: rssAfterStop,
    maxFacesNow: Math.max(...samples.map(s => s.faces)), finalUnique: samples.at(-1).unique, cameraLiveAfterEnd: live, errors: errors.length };
  console.log(JSON.stringify(res));
  console.log('rss by process before:', JSON.stringify(rssBeforeByType), ' during (last):', JSON.stringify(samples.at(-1).rss));
  console.log('summary:', summary);
  fs.mkdirSync(`${SP}/perf`, { recursive: true });
  fs.writeFileSync(`${SP}/perf/perf-${FAR}-${RES}-${SECS}s.json`, JSON.stringify({ ...res, samples }));
  await b.close();
})().catch(e => { console.error('CRASH', e); process.exit(2); });
