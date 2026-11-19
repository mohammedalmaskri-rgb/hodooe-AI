import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getDB } from '../../db/db';
import { ensureTrialClass, TRIAL_CLASS_NAME, TRIAL_SECTION_NAME } from '../../db/classes';
import { useI18n } from '../../i18n/I18nProvider';
import { useLoad } from '../../lib/useLoad';
import { useErrorText } from '../../lib/useErrorText';
import { Alert, Button, Card, PageTitle } from '../../components/ui';

const fmtBytes = (b: number) => (b < 1024 * 1024 ? `${(b / 1024).toFixed(0)} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`);

export function Dashboard() {
  const { t } = useI18n();
  const errText = useErrorText();
  const [error, setError] = useState('');
  const { data, reload, error: loadErr } = useLoad(async () => {
    const db = await getDB();
    const [students, classes, sections, photos, testRuns, allClasses, allSections] = await Promise.all([
      db.count('students'),
      db.count('classes'),
      db.count('sections'),
      db.count('photos'),
      db.count('testRuns'),
      db.getAll('classes'),
      db.getAll('sections'),
    ]);
    const trialClass = allClasses.find((c) => c.name === TRIAL_CLASS_NAME);
    const trialReady = !!trialClass && allSections.some((s) => s.classId === trialClass.id && s.name === TRIAL_SECTION_NAME);
    return { students, classes, sections, photos, testRuns, trialReady };
  });

  const [storage, setStorage] = useState<{ used?: number; persisted?: boolean }>({});
  useEffect(() => {
    const s = navigator.storage;
    if (!s) return;
    Promise.all([s.estimate?.().catch(() => undefined), s.persisted?.().catch(() => undefined)]).then(([est, persisted]) =>
      setStorage({ used: est?.usage, persisted }),
    );
  }, [data]);

  const stats = data
    ? [
        ['students', data.students],
        ['classes', data.classes],
        ['sections', data.sections],
        ['photos', data.photos],
        ['testRuns', data.testRuns],
      ]
    : [];

  return (
    <div className="flex flex-col gap-5">
      <PageTitle>{t('dashboard.title')}</PageTitle>
      {loadErr != null && <Alert kind="error">{errText(loadErr)}</Alert>}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {stats.map(([k, v]) => (
          <div key={k} className="rounded-2xl bg-navy-900 p-4 text-white">
            <div className="text-3xl font-bold tabular-nums" data-stat={k}>
              {v}
            </div>
            <div className="mt-1 text-xs text-brand-400">{t(`dashboard.${k}`)}</div>
          </div>
        ))}
      </div>

      <Card>
        <h2 className="font-bold">{t('dashboard.setupTitle')}</h2>
        <div className="mt-3 flex flex-col gap-3">
          {data?.trialReady ? (
            <Alert kind="success">{t('dashboard.setupDone')}</Alert>
          ) : (
            <Button
              className="self-start"
              onClick={async () => {
                setError('');
                try {
                  await ensureTrialClass(await getDB());
                  reload();
                } catch (e) {
                  setError(errText(e));
                }
              }}
            >
              {t('dashboard.setupTrial')}
            </Button>
          )}
          {data?.trialReady && data.students === 0 && (
            <Link to="/admin/students/new" className="self-start">
              <Button>{t('dashboard.addTrialStudent')}</Button>
            </Link>
          )}
          {error && <Alert kind="error">{error}</Alert>}
        </div>
      </Card>

      <Card>
        <h2 className="font-bold">{t('dashboard.storageTitle')}</h2>
        <div className="mt-2 flex flex-col gap-2 text-sm">
          {storage.used !== undefined && <p>{t('dashboard.storageUsed', { used: fmtBytes(storage.used) })}</p>}
          {storage.persisted ? (
            <Alert kind="success">{t('dashboard.persisted')}</Alert>
          ) : (
            <Alert kind="warning">{t('dashboard.notPersisted')}</Alert>
          )}
        </div>
      </Card>
    </div>
  );
}
