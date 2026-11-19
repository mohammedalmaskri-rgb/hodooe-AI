import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useI18n } from '../../i18n/I18nProvider';
import { lockAdmin } from './AdminGate';

type Item = { to: string; key: string; phase?: number; end?: boolean };
const items: Item[] = [
  { to: '/admin', key: 'dashboard', end: true },
  { to: '/admin/students', key: 'students', end: true },
  { to: '/admin/students/new', key: 'newStudent' },
  { to: '/admin/classes', key: 'classes' },
  { to: '', key: 'camera', phase: 4 },
  { to: '', key: 'tests', phase: 5 },
  { to: '', key: 'results', phase: 5 },
  { to: '/admin/settings', key: 'settings' },
];

/** Admin shell: sidebar on iPad/desktop, horizontal scroll bar on narrow screens. */
export function AdminLayout() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const link = ({ isActive }: { isActive: boolean }) =>
    `flex min-h-11 shrink-0 items-center rounded-xl px-3 text-sm font-medium whitespace-nowrap ${
      isActive ? 'bg-navy-800 text-white' : 'text-navy-900 hover:bg-navy-800/5'
    }`;
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-4 md:flex-row md:gap-6 md:py-6">
      <nav className="md:w-56 md:shrink-0" aria-label="admin">
        <div className="flex gap-1 overflow-x-auto pb-1 md:flex-col md:overflow-visible">
          {items.map((it) =>
            it.phase ? (
              <span
                key={it.key}
                aria-disabled="true"
                className="flex min-h-11 shrink-0 items-center justify-between gap-2 rounded-xl px-3 text-sm whitespace-nowrap text-slate-400"
              >
                {t(`nav.${it.key}`)}
                <span className="rounded-full bg-slate-100 px-2 text-[10px]">{t('common.phase', { n: it.phase })}</span>
              </span>
            ) : (
              <NavLink key={it.key} to={it.to} end={it.end} className={link}>
                {t(`nav.${it.key}`)}
              </NavLink>
            ),
          )}
          <button
            type="button"
            onClick={() => {
              lockAdmin();
              navigate('/');
            }}
            className="flex min-h-11 shrink-0 items-center rounded-xl px-3 text-sm font-medium whitespace-nowrap text-red-700 hover:bg-red-50 md:mt-4"
          >
            {t('gate.lock')}
          </button>
        </div>
      </nav>
      <div className="min-w-0 flex-1">
        <Outlet />
      </div>
    </div>
  );
}
