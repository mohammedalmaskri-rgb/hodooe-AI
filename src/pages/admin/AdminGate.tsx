import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { getDB } from '../../db/db';
import { hasPin, setPin, verifyPin } from '../../db/settings';
import { wipeAllData } from '../../db/wipe';
import { PIN_PATTERN } from '../../lib/pin';
import { useI18n } from '../../i18n/I18nProvider';
import { useErrorText } from '../../lib/useErrorText';
import { Alert, Button, Card, ConfirmDialog, Field, inputClass } from '../../components/ui';

const UNLOCK_KEY = 'hodoor.adminUnlocked';
const LOCK_EVENT = 'hodoor:admin-lock';

export function isUnlocked() {
  try {
    return sessionStorage.getItem(UNLOCK_KEY) === '1';
  } catch {
    return false;
  }
}
/** Locks the admin area. Mounted gates are notified so they close immediately,
 * regardless of how/when the user navigates afterwards. */
export function lockAdmin() {
  try {
    sessionStorage.removeItem(UNLOCK_KEY);
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event(LOCK_EVENT));
}
function markUnlocked() {
  try {
    sessionStorage.setItem(UNLOCK_KEY, '1');
  } catch {
    /* ignore */
  }
}

/** Shows the PIN create/enter screen until the admin area is unlocked for this browser session. */
export function AdminGate({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const errText = useErrorText();
  const [mode, setMode] = useState<'loading' | 'create' | 'enter' | 'open'>('loading');
  const [pin, setPinValue] = useState('');
  const [pin2, setPin2] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [forgotOpen, setForgotOpen] = useState(false);

  useEffect(() => {
    if (isUnlocked()) return setMode('open');
    getDB()
      .then(hasPin)
      .then((exists) => setMode(exists ? 'enter' : 'create'))
      .catch((e) => setError(errText(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onLock = () => {
      setPinValue('');
      setPin2('');
      setError('');
      setMode('enter');
    };
    window.addEventListener(LOCK_EVENT, onLock);
    return () => window.removeEventListener(LOCK_EVENT, onLock);
  }, []);

  if (mode === 'open') return <>{children}</>;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (!PIN_PATTERN.test(pin)) return setError(t('gate.invalidPin'));
    setBusy(true);
    try {
      const db = await getDB();
      if (mode === 'create') {
        if (pin !== pin2) return setError(t('gate.mismatch'));
        await setPin(db, pin);
      } else if (!(await verifyPin(db, pin))) {
        setPinValue('');
        return setError(t('gate.wrongPin'));
      }
      markUnlocked();
      setMode('open');
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  };

  const pinInput = (id: string, value: string, set: (v: string) => void, auto: string) => (
    <input
      id={id}
      className={`${inputClass} text-center text-2xl tracking-[0.5em]`}
      type="password"
      inputMode="numeric"
      pattern="[0-9]*"
      autoComplete={auto}
      maxLength={8}
      value={value}
      onChange={(e) => set(e.target.value.replace(/\D/g, ''))}
    />
  );

  return (
    <main className="mx-auto max-w-md px-4 py-10">
      <Card>
        {mode === 'loading' ? (
          error ? <Alert kind="error">{error}</Alert> : <p>{t('common.loading')}</p>
        ) : (
          <form onSubmit={submit} className="flex flex-col gap-4">
            <div>
              <h1 className="text-xl font-bold">{mode === 'create' ? t('gate.createTitle') : t('gate.enterTitle')}</h1>
              <p className="mt-1 text-sm text-slate-600">{mode === 'create' ? t('gate.createHint') : t('gate.enterHint')}</p>
            </div>
            <Field label={t('gate.pin')}>{(id) => pinInput(id, pin, setPinValue, mode === 'create' ? 'new-password' : 'current-password')}</Field>
            {mode === 'create' && <Field label={t('gate.pinConfirm')}>{(id) => pinInput(id, pin2, setPin2, 'new-password')}</Field>}
            {error && <Alert kind="error">{error}</Alert>}
            <Button type="submit" disabled={busy}>
              {mode === 'create' ? t('gate.create') : t('gate.unlock')}
            </Button>
            <p className="text-xs text-slate-500">{t('gate.notice')}</p>
            {mode === 'enter' && (
              <Button variant="ghost" onClick={() => setForgotOpen(true)}>
                {t('gate.forgot')}
              </Button>
            )}
          </form>
        )}
      </Card>
      <ConfirmDialog
        open={forgotOpen}
        title={t('settings.wipeTitle')}
        message={t('gate.forgotHint')}
        confirmLabel={t('settings.wipe')}
        cancelLabel={t('common.cancel')}
        danger
        onCancel={() => setForgotOpen(false)}
        onConfirm={async () => {
          await wipeAllData();
          location.reload();
        }}
      />
    </main>
  );
}
