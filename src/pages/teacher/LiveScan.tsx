import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { getDB } from '../../db/db';
import { ensureTrialClass, listClasses, listSections } from '../../db/classes';
import { CameraError, openCamera, stopStream, type OpenedCamera } from '../../camera/camera';
import { loadDetector, type LoadedDetector } from '../../vision/detector';
import { LiveScanEngine, type ScanStats } from '../../vision/scanEngine';
import type { QualityReason } from '../../vision/types';
import { useI18n } from '../../i18n/I18nProvider';
import { useLoad } from '../../lib/useLoad';
import { Alert, Button, Card, inputClass } from '../../components/ui';
import { Logo } from '../../components/Logo';
import { loadScanSettings, saveScanSettings, type ScanSettings } from './scanSettings';

type Phase = 'setup' | 'loading' | 'live' | 'summary';
type StopReason = 'user' | 'left' | 'ended';

const fmtMs = (ms?: number) => (ms === undefined ? '—' : ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`);
const fmtDur = (ms: number) => {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

type WakeLockSentinelLike = { release: () => Promise<void> };

export function LiveScan() {
  const { t } = useI18n();
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<LiveScanEngine | null>(null);
  const camRef = useRef<OpenedCamera | null>(null);
  const detRef = useRef<{ key: string; loaded: LoadedDetector } | null>(null);
  const wakeRef = useRef<WakeLockSentinelLike | null>(null);
  const phaseRef = useRef<Phase>('setup');

  const [phase, setPhaseState] = useState<Phase>('setup');
  const setPhase = (p: Phase) => {
    phaseRef.current = p;
    setPhaseState(p);
  };
  const [settings, setSettings] = useState<ScanSettings>(loadScanSettings);
  const [showSettings, setShowSettings] = useState(false);
  const [classKey, setClassKey] = useState('');
  const [stats, setStats] = useState<ScanStats | null>(null);
  const [camInfo, setCamInfo] = useState<{ startMs: number; modelMs: number; delegate: string; facing?: string } | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loadingMsg, setLoadingMsg] = useState('');

  const { data: classes, reload } = useLoad(async () => {
    const db = await getDB();
    const [cls, secs] = await Promise.all([listClasses(db), listSections(db)]);
    return secs.map((s) => ({ key: s.id, label: `${cls.find((c) => c.id === s.classId)?.name ?? '?'} / ${s.name}` }));
  });
  useEffect(() => {
    if (classes?.length && !classKey) setClassKey(classes[0].key);
  }, [classes, classKey]);

  const reasonLabel = useCallback((r: QualityReason) => t(`scan.reasons.${r}`), [t]);

  /** Stops engine + camera + wake lock. Safe to call repeatedly. */
  const stopAll = useCallback((reason: StopReason | null) => {
    const engine = engineRef.current;
    if (engine) {
      setStats(engine.snapshot());
      engine.stop();
      engineRef.current = null;
    }
    stopStream(camRef.current?.stream, videoRef.current);
    camRef.current = null;
    wakeRef.current?.release().catch(() => undefined);
    wakeRef.current = null;
    if (reason && (phaseRef.current === 'live' || phaseRef.current === 'loading')) {
      setNotice(reason === 'left' ? t('scan.stoppedLeft') : reason === 'ended' ? t('scan.stoppedEnded') : '');
      setPhase('summary');
    }
  }, [t]);

  // Start sequence runs once the full-screen scan view (with <video>) is mounted.
  useEffect(() => {
    if (phase !== 'loading') return;
    let cancelled = false;
    (async () => {
      const video = videoRef.current!;
      const key = `${settings.model}:${settings.delegate}`;
      try {
        setLoadingMsg(t('scan.loadingModel'));
        // Load the model (cached between sessions) and open the camera in parallel.
        const detPromise = (async () => {
          if (detRef.current?.key === key) return { ...detRef.current.loaded, loadMs: 0 };
          detRef.current?.loaded.detector.close();
          detRef.current = null;
          const loaded = await loadDetector({ model: settings.model, delegate: settings.delegate, minConfidence: 0.4 });
          detRef.current = { key, loaded };
          return loaded;
        })().catch((e) => {
          throw new Error(t('scan.errors.model', { msg: e instanceof Error ? e.message : String(e) }));
        });
        setLoadingMsg(t('scan.openingCamera'));
        const cam = await openCamera(video, settings.resolution);
        camRef.current = cam;
        if (cancelled) return stopStream(cam.stream, video);
        const det = await detPromise;
        if (cancelled) return;
        if (det.delegate !== settings.delegate) setNotice(t('scan.gpuFallback'));
        setCamInfo({ startMs: cam.startMs, modelMs: det.loadMs, delegate: det.delegate, facing: cam.facingMode });
        cam.track.addEventListener('ended', () => stopAll('ended'));
        const engine = new LiveScanEngine(video, overlayRef.current!, det.detector, setStats, reasonLabel);
        engineRef.current = engine;
        engine.start();
        setPhase('live');
        // Keep the screen awake while scanning (Safari ≥ 16.4); optional.
        const wl = (navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<WakeLockSentinelLike> } }).wakeLock;
        wl?.request('screen').then((s) => (wakeRef.current = s), () => undefined);
      } catch (e) {
        stopAll(null);
        setError(
          e instanceof CameraError
            ? t(`scan.errors.${e.code}`, { msg: e.message })
            : e instanceof Error
              ? e.message
              : String(e),
        );
        setPhase('setup');
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // Leaving the page (navigation, hiding the app, closing the tab) always stops the camera.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') stopAll('left');
    };
    const onPageHide = () => stopAll('left');
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onPageHide);
      stopAll(null); // component unmount (route change)
    };
  }, [stopAll]);

  // Release the model when leaving the teacher view.
  useEffect(() => () => detRef.current?.loaded.detector.close(), []);

  const begin = () => {
    setError('');
    setNotice('');
    setStats(null);
    setCamInfo(null);
    setPhase('loading');
  };

  const updateSettings = (patch: Partial<ScanSettings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    saveScanSettings(next);
  };

  const lightLabel = (b?: number) =>
    b === undefined ? '—' : b < 50 ? t('scan.stats.dark') : b > 220 ? t('scan.stats.bright') : t('scan.stats.good');

  // ---------- Full-screen live view ----------
  if (phase === 'loading' || phase === 'live') {
    const s = stats;
    return (
      <div className="fixed inset-0 z-50 flex flex-col bg-black text-white" data-testid="live-view">
        <div className="relative min-h-0 flex-1 overflow-hidden">
          {/* object-contain: the whole analysed frame is shown, never cropped or stretched */}
          <video
            ref={videoRef}
            className="absolute inset-0 h-full w-full object-contain"
            playsInline
            muted
            autoPlay
            disablePictureInPicture
          />
          <canvas ref={overlayRef} className="pointer-events-none absolute inset-0 h-full w-full" data-testid="overlay" />

          {/* HUD */}
          <div className="absolute inset-x-0 top-0 p-3 pt-[max(env(safe-area-inset-top),0.75rem)]">
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2 rounded-full bg-black/60 px-3 py-1.5 text-sm font-semibold backdrop-blur">
                <span className={`size-2.5 rounded-full ${phase === 'live' ? 'animate-pulse bg-red-500' : 'bg-amber-400'}`} />
                {phase === 'live' ? t('scan.status.live') : loadingMsg}
              </span>
              <span className="rounded-full bg-black/60 px-3 py-1.5 text-xs backdrop-blur" dir="ltr">
                {s ? `${s.videoW}×${s.videoH}` : ''}
              </span>
            </div>
            {phase === 'live' && (
              <div className="mt-2 grid grid-cols-4 gap-1.5 text-center" data-testid="hud">
                {[
                  [t('scan.stats.facesNow'), s?.facesNow ?? 0, 'faces-now'],
                  [t('scan.stats.unique'), s?.uniqueFaces ?? 0, 'unique'],
                  [t('scan.stats.fps'), s?.fps ?? 0, 'fps'],
                  [t('scan.stats.ms'), s ? `${s.avgMs.toFixed(0)}` : '—', 'ms'],
                ].map(([label, value, id]) => (
                  <div key={id} className="rounded-xl bg-black/60 px-1 py-1.5 backdrop-blur">
                    <div className="text-xl font-bold tabular-nums" data-hud={id}>
                      {value}
                    </div>
                    <div className="text-[10px] leading-tight text-slate-300">{label}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Bottom bar */}
        <div className="bg-navy-950 px-4 pt-3 pb-[max(env(safe-area-inset-bottom),0.75rem)]">
          <div className="mb-2 flex items-center justify-center gap-4 text-xs">
            <span className="flex items-center gap-1">
              <span className="size-3 rounded-sm border-2 border-green-500" /> {t('scan.legendGreen')} {s?.quality.green ?? 0}
            </span>
            <span className="flex items-center gap-1">
              <span className="size-3 rounded-sm border-2 border-yellow-400" /> {t('scan.legendYellow')} {s?.quality.yellow ?? 0}
            </span>
            <span className="flex items-center gap-1">
              <span className="size-3 rounded-sm border-2 border-red-500" /> {t('scan.legendRed')} {s?.quality.red ?? 0}
            </span>
          </div>
          <div className="mb-2 flex justify-center gap-3 text-[11px] text-slate-400">
            <span>
              {t('scan.stats.light')}: {lightLabel(s?.frameBrightness)}
            </span>
            <span>
              {t('scan.stats.p95')}: <bdi dir="ltr">{s ? `${s.p95Ms.toFixed(0)} ms` : '—'}</bdi>
            </span>
            <span>{camInfo?.delegate}</span>
          </div>
          <button
            type="button"
            onClick={() => stopAll('user')}
            className="min-h-14 w-full rounded-2xl bg-red-600 text-lg font-bold active:bg-red-700"
          >
            {t('scan.end')}
          </button>
        </div>
      </div>
    );
  }

  // ---------- Setup / summary ----------
  return (
    <main className="mx-auto flex max-w-md flex-col gap-4 px-4 py-5">
      <div className="flex items-center gap-3">
        <Logo size={44} />
        <h1 className="text-2xl font-bold">{t('scan.title')}</h1>
      </div>

      {phase === 'summary' && stats && (
        <Card>
          <h2 className="text-lg font-bold">{t('scan.summaryTitle')}</h2>
          {notice && (
            <div className="mt-2">
              <Alert kind="warning">{notice}</Alert>
            </div>
          )}
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm" data-testid="summary">
            {[
              [t('scan.stats.duration'), fmtDur(stats.elapsedMs)],
              [t('scan.stats.unique'), stats.uniqueFaces],
              [t('scan.stats.maxFaces'), stats.maxSimultaneous],
              [t('scan.stats.lost'), stats.lostEvents],
              [t('scan.stats.frames'), stats.frames],
              [t('scan.stats.avgMs'), `${stats.sessionAvgMs.toFixed(1)} ms`],
              [t('scan.stats.startMs'), fmtMs(camInfo?.startMs)],
              [t('scan.stats.modelMs'), fmtMs(camInfo?.modelMs)],
              [t('scan.stats.firstFace'), fmtMs(stats.firstFaceMs)],
              [t('scan.stats.resolution'), `${stats.videoW}×${stats.videoH}`],
            ].map(([k, v]) => (
              <div key={String(k)} className="flex flex-col">
                <dt className="text-xs text-slate-500">{k}</dt>
                <dd className="font-semibold tabular-nums">
                  <bdi dir="ltr">{v}</bdi>
                </dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-xs text-slate-500">{t('scan.uniqueHint')}</p>
          <p className="mt-1 text-xs text-slate-500">{t('scan.summaryNote')}</p>
        </Card>
      )}

      <Card>
        <label className="text-sm font-semibold" htmlFor="class-select">
          {t('scan.classSection')}
        </label>
        {classes && classes.length === 0 ? (
          <div className="mt-2 flex flex-col gap-2">
            <p className="text-sm text-slate-600">{t('scan.noClasses')}</p>
            <Button
              variant="secondary"
              onClick={async () => {
                await ensureTrialClass(await getDB());
                reload();
              }}
            >
              {t('scan.createTrial')}
            </Button>
          </div>
        ) : (
          <select id="class-select" className={`${inputClass} mt-2`} value={classKey} onChange={(e) => setClassKey(e.target.value)}>
            {classes?.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </select>
        )}
      </Card>

      {error && <Alert kind="error">{error}</Alert>}

      <button
        type="button"
        onClick={begin}
        disabled={!classKey}
        className="min-h-16 rounded-2xl bg-brand-500 text-xl font-bold text-white shadow-lg active:bg-navy-700 disabled:bg-slate-300"
      >
        {phase === 'summary' ? t('scan.again') : t('scan.start')}
      </button>

      <div className="flex flex-col gap-2 text-xs text-slate-600">
        <p>{t('scan.permissionHint')}</p>
        <p>{t('scan.privacy')}</p>
        <p className="font-semibold text-navy-800">{t('scan.notIdentity')}</p>
      </div>

      <Card>
        <button
          type="button"
          className="flex min-h-11 w-full items-center justify-between text-sm font-semibold"
          onClick={() => setShowSettings((v) => !v)}
          aria-expanded={showSettings}
        >
          {t('scan.settings')}
          <span>{showSettings ? '▲' : '▼'}</span>
        </button>
        {showSettings && (
          <div className="mt-3 flex flex-col gap-3 text-sm">
            {(
              [
                ['model', t('scan.model'), [['full', t('scan.modelFull')], ['short', t('scan.modelShort')]]],
                ['delegate', t('scan.delegate'), [['CPU', 'CPU'], ['GPU', 'GPU']]],
                ['resolution', t('scan.resolution'), [['720', '720p'], ['1080', '1080p']]],
              ] as const
            ).map(([key, label, opts]) => (
              <div key={key}>
                <div className="mb-1 font-semibold">{label}</div>
                <div className="flex gap-2">
                  {opts.map(([v, l]) => (
                    <Button
                      key={v}
                      variant={settings[key] === v ? 'primary' : 'secondary'}
                      className="flex-1"
                      onClick={() => updateSettings({ [key]: v } as Partial<ScanSettings>)}
                    >
                      {l}
                    </Button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Link to="/" className="text-center text-sm text-navy-700 underline">
        {t('nav.home')}
      </Link>
    </main>
  );
}
