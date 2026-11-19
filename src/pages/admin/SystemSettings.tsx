import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { getDB } from '../../db/db';
import { buildExport, importData, parseExport } from '../../db/exportImport';
import { DataError } from '../../db/errors';
import { setPin, verifyPin } from '../../db/settings';
import { wipeAllData } from '../../db/wipe';
import { PIN_PATTERN } from '../../lib/pin';
import { useI18n } from '../../i18n/I18nProvider';
import { useErrorText } from '../../lib/useErrorText';
import { Alert, Button, Card, Field, inputClass, PageTitle } from '../../components/ui';

type Msg = { kind: 'error' | 'success'; text: string } | null;

function downloadJson(data: unknown, filename: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function SystemSettings() {
  const { t, lang, setLang } = useI18n();
  const errText = useErrorText();

  // --- PIN ---
  const [oldPin, setOldPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [pinMsg, setPinMsg] = useState<Msg>(null);
  const changePin = async (e: FormEvent) => {
    e.preventDefault();
    setPinMsg(null);
    try {
      const db = await getDB();
      if (!(await verifyPin(db, oldPin))) return setPinMsg({ kind: 'error', text: t('gate.wrongPin') });
      if (!PIN_PATTERN.test(newPin)) return setPinMsg({ kind: 'error', text: t('gate.invalidPin') });
      await setPin(db, newPin);
      setOldPin('');
      setNewPin('');
      setPinMsg({ kind: 'success', text: t('settings.pinChanged') });
    } catch (err) {
      setPinMsg({ kind: 'error', text: errText(err) });
    }
  };

  // --- Export / import ---
  const importRef = useRef<HTMLInputElement>(null);
  const [xferMsg, setXferMsg] = useState<Msg>(null);
  const doExport = async () => {
    setXferMsg(null);
    try {
      const data = await buildExport(await getDB());
      downloadJson(data, `hodoor-export-${new Date().toISOString().slice(0, 10)}.json`);
    } catch (err) {
      setXferMsg({ kind: 'error', text: errText(err) });
    }
  };
  const doImport = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setXferMsg(null);
    try {
      let raw: unknown;
      try {
        raw = JSON.parse(await file.text());
      } catch {
        throw new DataError('invalidImport');
      }
      const summary = await importData(await getDB(), parseExport(raw));
      setXferMsg({ kind: 'success', text: t('settings.imported', { ...summary }) });
    } catch (err) {
      setXferMsg({ kind: 'error', text: errText(err) });
    }
  };

  // --- Persistent storage ---
  const [persisted, setPersisted] = useState<boolean | undefined>();
  useEffect(() => {
    navigator.storage?.persisted?.().then(setPersisted, () => undefined);
  }, []);
  const askPersist = async () => setPersisted(await navigator.storage?.persist?.().catch(() => false));

  // --- Wipe ---
  const [wipeText, setWipeText] = useState('');
  const [wiped, setWiped] = useState(false);
  const doWipe = async () => {
    await wipeAllData();
    setWiped(true);
    setTimeout(() => {
      location.hash = '#/';
      location.reload();
    }, 1500);
  };

  return (
    <div className="flex flex-col gap-5">
      <PageTitle>{t('settings.title')}</PageTitle>

      <Card>
        <h2 className="font-bold">{t('settings.language')}</h2>
        <div className="mt-3 flex gap-2">
          <Button variant={lang === 'ar' ? 'primary' : 'secondary'} onClick={() => setLang('ar')}>
            العربية
          </Button>
          <Button variant={lang === 'en' ? 'primary' : 'secondary'} onClick={() => setLang('en')}>
            English
          </Button>
        </div>
      </Card>

      <Card>
        <h2 className="font-bold">{t('settings.pinTitle')}</h2>
        <form onSubmit={changePin} className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <Field label={t('gate.pin')}>
            {(id) => (
              <input
                id={id}
                type="password"
                inputMode="numeric"
                autoComplete="current-password"
                className={inputClass}
                value={oldPin}
                onChange={(e) => setOldPin(e.target.value.replace(/\D/g, ''))}
                maxLength={8}
              />
            )}
          </Field>
          <Field label={t('settings.newPin')}>
            {(id) => (
              <input
                id={id}
                type="password"
                inputMode="numeric"
                autoComplete="new-password"
                className={inputClass}
                value={newPin}
                onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ''))}
                maxLength={8}
              />
            )}
          </Field>
          <Button type="submit">{t('settings.changePin')}</Button>
        </form>
        {pinMsg && (
          <div className="mt-3">
            <Alert kind={pinMsg.kind}>{pinMsg.text}</Alert>
          </div>
        )}
      </Card>

      <Card>
        <h2 className="font-bold">{t('settings.transferTitle')}</h2>
        <p className="mt-1 text-sm text-slate-600">{t('settings.transferHint')}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button onClick={doExport}>{t('settings.export')}</Button>
          <Button variant="secondary" onClick={() => importRef.current?.click()}>
            {t('settings.import')}
          </Button>
          <input
            ref={importRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={doImport}
            data-testid="import-input"
          />
        </div>
        {xferMsg && (
          <div className="mt-3">
            <Alert kind={xferMsg.kind}>{xferMsg.text}</Alert>
          </div>
        )}
      </Card>

      <Card>
        <h2 className="font-bold">{t('settings.persistTitle')}</h2>
        <div className="mt-3 flex flex-col gap-2">
          {persisted ? (
            <Alert kind="success">{t('dashboard.persisted')}</Alert>
          ) : (
            <>
              <Alert kind="warning">{t('dashboard.notPersisted')}</Alert>
              <Button variant="secondary" className="self-start" onClick={askPersist}>
                {t('settings.persistAsk')}
              </Button>
            </>
          )}
        </div>
      </Card>

      <Card className="border-red-200">
        <h2 className="font-bold text-red-700">{t('settings.wipeTitle')}</h2>
        <p className="mt-1 text-sm text-slate-600">{t('settings.wipeHint')}</p>
        {wiped ? (
          <div className="mt-3">
            <Alert kind="success">{t('settings.wiped')}</Alert>
          </div>
        ) : (
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <Field label={t('settings.wipeConfirm')}>
              {(id) => <input id={id} className={inputClass} value={wipeText} onChange={(e) => setWipeText(e.target.value)} />}
            </Field>
            <Button variant="danger" disabled={wipeText.trim() !== t('settings.wipeWord')} onClick={doWipe}>
              {t('settings.wipe')}
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}
