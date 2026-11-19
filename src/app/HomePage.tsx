import { Link } from 'react-router-dom';
import { useI18n } from '../i18n/I18nProvider';

// Entry screen. Sections that are not built yet are shown as disabled – no placeholder screens.
export function HomePage() {
  const { t } = useI18n();
  const sections = [
    { title: t('home.adminTitle'), desc: t('home.adminDesc'), to: '/admin', phase: 2, ready: true },
    { title: t('home.teacherTitle'), desc: t('home.teacherDesc'), to: '/teacher', phase: 3, ready: true },
  ];
  return (
    <main className="mx-auto max-w-5xl px-4 py-6">
      <div className="grid gap-4 sm:grid-cols-2">
        {sections.map((s) =>
          s.ready ? (
            <Link
              key={s.phase}
              to={s.to}
              className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-brand-500 hover:shadow-md"
            >
              <h2 className="text-xl font-bold text-navy-900">{s.title}</h2>
              <p className="mt-2 text-sm text-slate-600">{s.desc}</p>
              <span className="mt-4 inline-flex min-h-11 items-center rounded-xl bg-navy-800 px-4 text-sm font-semibold text-white">
                {t('home.open')}
              </span>
            </Link>
          ) : (
            <section key={s.phase} aria-disabled="true" className="rounded-2xl border border-slate-200 bg-white p-5 opacity-70 shadow-sm">
              <h2 className="text-xl font-bold text-navy-900">{s.title}</h2>
              <p className="mt-2 text-sm text-slate-600">{s.desc}</p>
              <span className="mt-4 inline-block rounded-full bg-navy-800/10 px-3 py-1 text-xs font-semibold text-navy-700">
                {t('home.comingIn', { n: s.phase })}
              </span>
            </section>
          ),
        )}
      </div>
      <section className="mt-6 rounded-2xl bg-navy-900 p-5 text-white">
        <h2 className="font-bold text-brand-400">{t('home.privacyTitle')}</h2>
        <p className="mt-2 text-sm leading-relaxed text-slate-200">{t('home.privacy')}</p>
      </section>
      <p className="mt-6 text-center text-xs text-slate-400">{t('home.version', { v: __APP_VERSION__ })}</p>
    </main>
  );
}
