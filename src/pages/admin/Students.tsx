import { Link } from 'react-router-dom';
import { getDB } from '../../db/db';
import { listClasses, listSections } from '../../db/classes';
import { listStudents } from '../../db/students';
import { useI18n } from '../../i18n/I18nProvider';
import { useLoad } from '../../lib/useLoad';
import { useErrorText } from '../../lib/useErrorText';
import { Alert, Button, Card, PageTitle } from '../../components/ui';

export function Students() {
  const { t } = useI18n();
  const errText = useErrorText();
  const { data, error } = useLoad(async () => {
    const db = await getDB();
    const [students, classes, sections, photoKeys] = await Promise.all([
      listStudents(db),
      listClasses(db),
      listSections(db),
      db.getAllKeys('photos'),
    ]);
    const photoSet = new Set(photoKeys);
    const name = (list: { id: string; name: string }[], id: string) => list.find((x) => x.id === id)?.name ?? '—';
    return students.map((s) => ({
      ...s,
      className: name(classes, s.classId),
      sectionName: name(sections, s.sectionId),
      hasPhoto: photoSet.has(s.id),
    }));
  });

  return (
    <div>
      <PageTitle
        actions={
          <Link to="/admin/students/new">
            <Button>{t('students.add')}</Button>
          </Link>
        }
      >
        {t('students.title')}
      </PageTitle>
      {error != null && <Alert kind="error">{errText(error)}</Alert>}
      {data && data.length === 0 && (
        <Card>
          <p className="text-slate-600">{t('students.empty')}</p>
        </Card>
      )}
      <ul className="flex flex-col gap-3">
        {data?.map((s) => (
          <li key={s.id}>
            <Link
              to={`/admin/students/${s.id}`}
              className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm hover:border-brand-500"
            >
              <div>
                <div className="font-bold">{s.name}</div>
                <div className="mt-1 text-sm text-slate-600">
                  <span dir="ltr" className="font-mono">
                    {s.studentNo}
                  </span>{' '}
                  · {s.className} / {s.sectionName}
                </div>
              </div>
              <span
                className={`rounded-full px-3 py-1 text-xs font-semibold ${
                  s.hasPhoto ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'
                }`}
              >
                {s.hasPhoto ? t('students.hasPhoto') : t('students.noPhoto')}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
