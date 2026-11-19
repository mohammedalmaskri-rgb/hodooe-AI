import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { getDB } from '../../db/db';
import { deletePhoto, getPhoto, savePhoto } from '../../db/photos';
import type { StudentPhoto } from '../../db/types';
import { prepareReferenceImage, type PreparedImage } from '../../lib/image';
import { useI18n } from '../../i18n/I18nProvider';
import { useErrorText } from '../../lib/useErrorText';
import { Alert, Button, Card, ConfirmDialog } from '../../components/ui';

/** Object URL for a blob, revoked automatically when the blob changes or the component unmounts. */
function useObjectUrl(blob?: Blob) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (!blob) return setUrl(undefined);
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  return url;
}

export function PhotoManager({ studentId, onChange }: { studentId: string; onChange?: () => void }) {
  const { t } = useI18n();
  const errText = useErrorText();
  const uploadRef = useRef<HTMLInputElement>(null);
  const captureRef = useRef<HTMLInputElement>(null);
  const [current, setCurrent] = useState<StudentPhoto | null | undefined>(undefined);
  const [pending, setPending] = useState<PreparedImage | null>(null);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [confirmRemove, setConfirmRemove] = useState(false);
  const currentUrl = useObjectUrl(current?.blob);
  const pendingUrl = useObjectUrl(pending?.blob);

  const load = async () => setCurrent((await getPhoto(await getDB(), studentId)) ?? null);
  useEffect(() => {
    load().catch((e) => setError(errText(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentId]);

  const onPick = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow choosing the same file again
    if (!file) return;
    setError('');
    setMessage('');
    setBusy(true);
    try {
      setPending(await prepareReferenceImage(file));
      setConsent(false);
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!pending) return;
    setBusy(true);
    setError('');
    try {
      await savePhoto(await getDB(), studentId, pending, consent);
      setPending(null);
      await load();
      setMessage(t('common.saved'));
      onChange?.();
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setConfirmRemove(false);
    try {
      await deletePhoto(await getDB(), studentId);
      await load();
      setMessage(t('common.deleted'));
      onChange?.();
    } catch (err) {
      setError(errText(err));
    }
  };

  return (
    <Card>
      <h2 className="text-lg font-bold">{t('photo.title')}</h2>
      <p className="mt-1 text-xs text-slate-500">{t('photo.hint')}</p>

      {/* Hidden native pickers. "capture" opens the camera directly on iPhone/iPad. */}
      <input ref={uploadRef} type="file" accept="image/*" className="hidden" onChange={onPick} data-testid="photo-upload" />
      <input ref={captureRef} type="file" accept="image/*" capture="user" className="hidden" onChange={onPick} />

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <div className="mb-2 text-sm font-semibold">{t('photo.current')}</div>
          {currentUrl && current ? (
            <figure>
              <img src={currentUrl} alt={t('photo.current')} className="aspect-square w-full rounded-xl bg-slate-100 object-contain" />
              <figcaption className="mt-1 text-xs text-slate-500">
                {t('photo.size', { w: current.width, h: current.height, kb: Math.round(current.blob.size / 1024) })}
              </figcaption>
            </figure>
          ) : (
            <div className="flex aspect-square w-full items-center justify-center rounded-xl border-2 border-dashed border-slate-300 text-sm text-slate-500">
              {current === undefined ? t('common.loading') : t('photo.none')}
            </div>
          )}
        </div>

        {pending && pendingUrl ? (
          <div className="flex flex-col gap-3">
            <div className="text-sm font-semibold">{t('photo.preview')}</div>
            <img src={pendingUrl} alt={t('photo.preview')} className="aspect-square w-full rounded-xl bg-slate-100 object-contain" />
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-1 size-5" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
              <span>{t('photo.consent')}</span>
            </label>
            <div className="flex gap-2">
              <Button onClick={save} disabled={!consent || busy}>
                {t('photo.savePhoto')}
              </Button>
              <Button variant="secondary" onClick={() => setPending(null)}>
                {t('common.cancel')}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-2 sm:justify-end">
            <Button onClick={() => uploadRef.current?.click()} disabled={busy}>
              {current ? t('photo.replace') : t('photo.upload')}
            </Button>
            <Button variant="secondary" onClick={() => captureRef.current?.click()} disabled={busy}>
              {t('photo.capture')}
            </Button>
            {current && (
              <Button variant="danger" onClick={() => setConfirmRemove(true)} disabled={busy}>
                {t('photo.remove')}
              </Button>
            )}
          </div>
        )}
      </div>
      <div className="mt-3 flex flex-col gap-2">
        {error && <Alert kind="error">{error}</Alert>}
        {message && <Alert kind="success">{message}</Alert>}
      </div>
      <ConfirmDialog
        open={confirmRemove}
        title={t('photo.remove')}
        message={t('photo.removeConfirm')}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        danger
        onCancel={() => setConfirmRemove(false)}
        onConfirm={remove}
      />
    </Card>
  );
}
