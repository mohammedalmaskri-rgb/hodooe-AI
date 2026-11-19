import { useState, type FormEvent } from 'react';
import { getDB } from '../../db/db';
import {
  createClass,
  createSection,
  deleteClass,
  deleteSection,
  listClasses,
  listSections,
  renameClass,
  renameSection,
} from '../../db/classes';
import { useI18n } from '../../i18n/I18nProvider';
import { useLoad } from '../../lib/useLoad';
import { useErrorText } from '../../lib/useErrorText';
import { Alert, Button, Card, ConfirmDialog, inputClass, PageTitle } from '../../components/ui';

/** Small inline form: one text input + submit button. */
function InlineAdd({ placeholder, label, onAdd }: { placeholder: string; label: string; onAdd: (v: string) => Promise<void> }) {
  const [v, setV] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    await onAdd(v);
    setV('');
  };
  return (
    <form onSubmit={submit} className="flex gap-2">
      <input className={inputClass} placeholder={placeholder} aria-label={placeholder} value={v} onChange={(e) => setV(e.target.value)} />
      <Button type="submit" variant="secondary" className="shrink-0">
        {label}
      </Button>
    </form>
  );
}

/** A name that can be renamed in place. */
function EditableName({ name, onRename, big }: { name: string; onRename: (v: string) => Promise<boolean>; big?: boolean }) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState(name);
  if (!editing)
    return (
      <div className="flex items-center gap-2">
        <span className={big ? 'text-lg font-bold' : 'font-medium'}>{name}</span>
        <Button variant="ghost" className="min-h-9 px-2 text-xs" onClick={() => (setV(name), setEditing(true))}>
          {t('common.rename')}
        </Button>
      </div>
    );
  return (
    <form
      className="flex flex-1 gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        if (await onRename(v)) setEditing(false);
      }}
    >
      <input className={inputClass} aria-label={t('classes.renamePrompt')} value={v} onChange={(e) => setV(e.target.value)} autoFocus />
      <Button type="submit" className="shrink-0">
        {t('common.save')}
      </Button>
      <Button variant="secondary" className="shrink-0" onClick={() => setEditing(false)}>
        {t('common.cancel')}
      </Button>
    </form>
  );
}

type Pending = { kind: 'class' | 'section'; id: string; name: string } | null;

export function Classes() {
  const { t } = useI18n();
  const errText = useErrorText();
  const [error, setError] = useState('');
  const [pending, setPending] = useState<Pending>(null);
  const { data, reload, error: loadErr } = useLoad(async () => {
    const db = await getDB();
    const [classes, sections, students] = await Promise.all([listClasses(db), listSections(db), db.getAll('students')]);
    return { classes, sections, students };
  });

  /** Runs a mutation, shows its error (if any) and refreshes. Returns success. */
  const run = async (fn: () => Promise<unknown>) => {
    setError('');
    try {
      await fn();
      reload();
      return true;
    } catch (e) {
      setError(errText(e));
      return false;
    }
  };

  const confirmDelete = async () => {
    const p = pending!;
    setPending(null);
    await run(async () => (p.kind === 'class' ? deleteClass(await getDB(), p.id) : deleteSection(await getDB(), p.id)));
  };

  return (
    <div className="flex flex-col gap-5">
      <PageTitle>{t('classes.title')}</PageTitle>
      <Card>
        <InlineAdd
          placeholder={t('classes.newClass')}
          label={t('classes.addClass')}
          onAdd={async (v) => void (await run(async () => createClass(await getDB(), v)))}
        />
      </Card>
      {(error || loadErr != null) && <Alert kind="error">{error || errText(loadErr)}</Alert>}
      {data?.classes.length === 0 && <p className="text-slate-600">{t('classes.empty')}</p>}
      {data?.classes.map((c) => {
        const secs = data.sections.filter((s) => s.classId === c.id);
        return (
          <Card key={c.id}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <EditableName big name={c.name} onRename={(v) => run(async () => renameClass(await getDB(), c.id, v))} />
              <Button variant="ghost" className="text-red-700" onClick={() => setPending({ kind: 'class', id: c.id, name: c.name })}>
                {t('common.delete')}
              </Button>
            </div>
            <ul className="mt-3 flex flex-col divide-y divide-slate-100 rounded-xl border border-slate-200">
              {secs.length === 0 && <li className="p-3 text-sm text-slate-500">{t('classes.noSections')}</li>}
              {secs.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
                  <EditableName name={s.name} onRename={(v) => run(async () => renameSection(await getDB(), s.id, v))} />
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-500">
                      {t('classes.studentsCount', { n: data.students.filter((st) => st.sectionId === s.id).length })}
                    </span>
                    <Button
                      variant="ghost"
                      className="text-red-700"
                      onClick={() => setPending({ kind: 'section', id: s.id, name: s.name })}
                    >
                      {t('common.delete')}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
            <div className="mt-3">
              <InlineAdd
                placeholder={t('classes.newSection')}
                label={t('classes.addSection')}
                onAdd={async (v) => void (await run(async () => createSection(await getDB(), c.id, v)))}
              />
            </div>
          </Card>
        );
      })}
      <ConfirmDialog
        open={!!pending}
        title={t('common.delete')}
        message={
          pending &&
          t(pending.kind === 'class' ? 'classes.deleteClassConfirm' : 'classes.deleteSectionConfirm', { name: pending.name })
        }
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        danger
        onCancel={() => setPending(null)}
        onConfirm={confirmDelete}
      />
    </div>
  );
}
