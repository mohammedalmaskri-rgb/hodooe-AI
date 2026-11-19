import { DataError } from '../db/errors';
import { useI18n } from '../i18n/I18nProvider';

/** Maps any thrown value to a translated, user-facing message (never hides the real cause). */
export function useErrorText() {
  const { t } = useI18n();
  return (e: unknown): string => {
    if (e instanceof DataError) return t(`errors.${e.code}`);
    if (e instanceof Error && e.message === 'insecureContext') return t('errors.insecureContext');
    if (e instanceof Error && e.message === 'imageLoad') return t('errors.imageLoad');
    console.error(e);
    return t('errors.generic', { msg: e instanceof Error ? e.message : String(e) });
  };
}
