import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { getDB } from '../../db/db';
import { listClasses, listSections, TRIAL_CLASS_NAME, TRIAL_SECTION_NAME } from '../../db/classes';
import { createStudent, deleteStudent, getStudent, listStudents, updateStudent, type StudentInput } from '../../db/students';
import type { ClassRoom, Section } from '../../db/types';
import { useI18n } from '../../i18n/I18nProvider';
import { useErrorText } from '../../lib/useErrorText';
import { Alert, Button, Card, ConfirmDialog, Field, inputClass, PageTitle } from '../../components/ui';
import { PhotoManager } from './PhotoManager';
import { TRIAL_STUDENT_NO } from '../../db/photos';

const TRIAL_STUDENT = { name: 'محمد – طالب تجريبي 001', studentNo: 'TEST-001' };
const empty: StudentInput = { name: '', studentNo: '', classId: '', sectionId: '', notes: '' };

/** Create (/admin/students/new) or edit (/admin/students/:id) a student, including the reference photo. */
export function StudentForm() {
  const { id } = useParams();
  const isNew = !id;
  const navigate = useNavigate();
  const { t } = useI18n();
  const errText = useErrorText();
  const [form, setForm] = useState<StudentInput>(empty);
  const [classes, setClasses] = useState<ClassRoom[]>([]);
  const [sections, setSections] = useState<Section[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [prefilled, setPrefilled] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [savedNo, setSavedNo] = useState('');

  useEffect(() => {
    (async () => {
      const db = await getDB();
      const [cls, secs] = await Promise.all([listClasses(db), listSections(db)]);
      setClasses(cls);
      setSections(secs);
      if (id) {
        const s = await getStudent(db, id);
        if (!s) throw new Error(t('errors.studentNotFound'));
        setForm({ name: s.name, studentNo: s.studentNo, classId: s.classId, sectionId: s.sectionId, notes: s.notes ?? '' });
        setSavedNo(s.studentNo);
      } else if ((await listStudents(db)).length === 0) {
        // First student: pre-fill the trial student described in the requirements.
        const trialClass = cls.find((c) => c.name === TRIAL_CLASS_NAME);
        const trialSection = secs.find((s) => s.classId === trialClass?.id && s.name === TRIAL_SECTION_NAME);
        setForm({ ...empty, ...TRIAL_STUDENT, classId: trialClass?.id ?? '', sectionId: trialSection?.id ?? '' });
        setPrefilled(true);
      } else {
        setForm(empty);
      }
      setLoaded(true);
    })().catch((e) => setError(errText(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const set = (k: keyof StudentInput, v: string) =>
    setForm((f) => ({ ...f, [k]: v, ...(k === 'classId' ? { sectionId: '' } : {}) }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setMessage('');
    setBusy(true);
    try {
      const db = await getDB();
      if (isNew) {
        const s = await createStudent(db, form);
        navigate(`/admin/students/${s.id}`, { replace: true, state: { created: true } });
      } else {
        const u = await updateStudent(db, id, form);
        setSavedNo(u.studentNo);
        setMessage(t('common.saved'));
      }
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setConfirmDelete(false);
    try {
      await deleteStudent(await getDB(), id!);
      navigate('/admin/students', { replace: true });
    } catch (err) {
      setError(errText(err));
    }
  };

  const created = (history.state?.usr as { created?: boolean } | undefined)?.created;
  const classSections = sections.filter((s) => s.classId === form.classId);

  return (
    <div className="flex flex-col gap-5">
      <PageTitle
        actions={
          <Link to="/admin/students">
            <Button variant="secondary">{t('common.back')}</Button>
          </Link>
        }
      >
        {isNew ? t('students.newTitle') : t('students.editTitle')}
      </PageTitle>

      <Alert kind="warning">{t('students.realDataWarning')}</Alert>
      {created && !isNew && <Alert kind="success">{t('students.created')}</Alert>}
      {prefilled && <Alert kind="info">{t('students.trialPrefill')}</Alert>}

      {loaded && classes.length === 0 ? (
        <Card>
          <p className="mb-3">{t('students.noClasses')}</p>
          <Link to="/admin/classes">
            <Button>{t('students.goClasses')}</Button>
          </Link>
        </Card>
      ) : (
        <Card>
          <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
            <Field label={t('students.name')}>
              {(fid) => (
                <input id={fid} className={inputClass} value={form.name} onChange={(e) => set('name', e.target.value)} required />
              )}
            </Field>
            <Field label={t('students.studentNo')}>
              {(fid) => (
                <input
                  id={fid}
                  dir="ltr"
                  className={`${inputClass} font-mono`}
                  value={form.studentNo}
                  onChange={(e) => set('studentNo', e.target.value)}
                  autoCapitalize="characters"
                  autoCorrect="off"
                  spellCheck={false}
                  required
                />
              )}
            </Field>
            <Field label={t('students.class')}>
              {(fid) => (
                <select id={fid} className={inputClass} value={form.classId} onChange={(e) => set('classId', e.target.value)} required>
                  <option value="">{t('students.chooseClass')}</option>
                  {classes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field label={t('students.section')}>
              {(fid) => (
                <select
                  id={fid}
                  className={inputClass}
                  value={form.sectionId}
                  onChange={(e) => set('sectionId', e.target.value)}
                  disabled={!form.classId}
                  required
                >
                  <option value="">{t('students.chooseSection')}</option>
                  {classSections.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <div className="sm:col-span-2">
              <Field label={`${t('students.notes')} (${t('common.optional')})`}>
                {(fid) => (
                  <textarea
                    id={fid}
                    rows={2}
                    className={`${inputClass} py-2`}
                    value={form.notes}
                    onChange={(e) => set('notes', e.target.value)}
                  />
                )}
              </Field>
            </div>
            {(error || message) && (
              <div className="sm:col-span-2">
                {error && <Alert kind="error">{error}</Alert>}
                {message && <Alert kind="success">{message}</Alert>}
              </div>
            )}
            <div className="flex flex-wrap justify-between gap-2 sm:col-span-2">
              <Button type="submit" disabled={busy || !loaded}>
                {t('common.save')}
              </Button>
              {!isNew && (
                <Button variant="danger" onClick={() => setConfirmDelete(true)}>
                  {t('students.deleteTitle')}
                </Button>
              )}
            </div>
          </form>
        </Card>
      )}

      {isNew ? (
        <Card>
          <p className="text-sm text-slate-600">{t('photo.saveStudentFirst')}</p>
        </Card>
      ) : savedNo === TRIAL_STUDENT_NO ? (
        <PhotoManager studentId={id} />
      ) : savedNo ? (
        <Card>
          <p className="text-sm text-slate-600">{t('photo.trialOnly')}</p>
        </Card>
      ) : null}

      <ConfirmDialog
        open={confirmDelete}
        title={t('students.deleteTitle')}
        message={t('students.deleteConfirm', { name: form.name })}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        danger
        onCancel={() => setConfirmDelete(false)}
        onConfirm={remove}
      />
    </div>
  );
}
