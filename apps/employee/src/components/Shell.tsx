import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Bell, ClipboardList, Home, Receipt, User } from 'lucide-react';
import { initials } from '@adisys/shared';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { OfflineBanner, cx } from './ui';

const TABS = [
  { to: '/',              label: 'Home',    icon: Home,          end: true },
  { to: '/work',          label: 'My work', icon: ClipboardList, end: false },
  { to: '/expenses',      label: 'Expenses',icon: Receipt,       end: false },
  { to: '/notifications', label: 'Alerts',  icon: Bell,          end: false, badge: true },
  { to: '/profile',       label: 'Profile', icon: User,          end: false },
];

export function Shell() {
  const { user } = useAuth();
  const location = useLocation();

  const unread = useQuery({
    queryKey: ['unread'],
    queryFn: () => api.get<{ unread: number }>('/notifications/unread-count'),
    refetchInterval: 60_000,
  });

  const pendingAck = useQuery({
    queryKey: ['my-day'],
    queryFn: () => api.get('/dashboard/my-day'),
    refetchInterval: 120_000,
  });

  return (
    <div className="flex min-h-dvh flex-col bg-surface">
      <OfflineBanner />

      <main className="pb-nav min-w-0 flex-1">
        <Outlet />
      </main>

      <nav aria-label="Main"
        className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-line bg-card/95 backdrop-blur">
        <ul className="mx-auto flex max-w-lg">
          {TABS.map((tab) => {
            const count = tab.badge ? unread.data?.unread ?? 0
              : tab.to === '/work' ? pendingAck.data?.work?.pendingAckTotal ?? 0 : 0;
            return (
              <li key={tab.to} className="flex-1">
                <NavLink to={tab.to} end={tab.end}
                  className={({ isActive }) => cx(
                    'relative flex flex-col items-center gap-0.5 px-1 py-2 text-[12px] font-medium transition-colors',
                    isActive ? 'text-brand-600' : 'text-ink-500')}>
                  {({ isActive }: { isActive: boolean }) => (
                    <>
                      <span className="relative">
                        <tab.icon className={cx('h-5 w-5', isActive && 'stroke-[2.4]')} aria-hidden />
                        {count > 0 && (
                          <span className="absolute -right-2 -top-1 flex h-4 min-w-4 items-center justify-center
                                           rounded-full bg-brand-500 px-1 text-[11px] font-bold text-white">
                            {count > 9 ? '9+' : count}
                          </span>
                        )}
                      </span>
                      {tab.label}
                    </>
                  )}
                </NavLink>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}

/** Screen header used by every tab. */
export function ScreenHeader({ title, subtitle, action, sticky = true }: {
  title: string; subtitle?: string; action?: React.ReactNode; sticky?: boolean;
}) {
  return (
    <header className={cx('safe-top border-b border-line bg-card px-4 pb-3 pt-3',
      sticky && 'sticky top-0 z-30')}>
      <div className="mx-auto flex max-w-lg items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold tracking-tight text-ink-900">{title}</h1>
          {subtitle && <p className="mt-0.5 truncate text-xs text-ink-500">{subtitle}</p>}
        </div>
        {action}
      </div>
    </header>
  );
}

export function Screen({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto max-w-lg space-y-4 p-4">{children}</div>;
}
