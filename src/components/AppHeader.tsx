import { useI18n } from '../i18n/I18nProvider';
import { Logo } from './Logo';

export function AppHeader() {
  const { t, lang, setLang } = useI18n();
  return (
    <header className="bg-navy-900 text-white">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
        <div className="flex items-center gap-3">
          <Logo size={40} />
          <div>
            <div className="text-lg font-bold leading-tight">{t('appName')}</div>
            <div className="text-xs text-brand-400">{t('tagline')}</div>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setLang(lang === 'ar' ? 'en' : 'ar')}
          className="min-h-11 rounded-lg border border-white/25 px-4 text-sm font-medium hover:bg-white/10"
        >
          {t('switchLang')}
        </button>
      </div>
    </header>
  );
}
