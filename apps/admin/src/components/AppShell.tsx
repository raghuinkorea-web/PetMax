import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  BadgeIndianRupee, Bell, CalendarCheck2, ChevronDown, ClipboardList, FileBarChart,
  FolderKanban, Gauge, LogOut, Menu, ScrollText, Settings as SettingsIcon, ShieldCheck,
  Stamp, Users, X,
} from 'lucide-react';
import type { PermissionKey } from '@adisys/shared';
import { useAuth } from '../lib/auth';
import { api } from '../lib/api';
import { initials } from '@adisys/shared';
import { BrandMark, ProductName, Wordmark } from './Brand';
import { cx } from './ui';

interface NavItem {
  to: string;
  label: string;
  icon: typeof Gauge;
  permissions?: PermissionKey[];
  badge?: 'approvals' | 'notifications';
}

const NAV_GROUPS: Array<{ label: string; items: NavItem[] }> = [
  {
    label: 'Operations',
    items: [
      { to: '/', label: 'Dashboard', icon: Gauge, permissions: ['dashboard.view'] },
      { to: '/work', label: 'Work assignments', icon: ClipboardList, permissions: ['work.view.team', 'work.view.all'] },
      { to: '/productivity', label: 'Productivity', icon: CalendarCheck2, permissions: ['productivity.view.team', 'productivity.view.all'] },
      { to: '/projects', label: 'Projects', icon: FolderKanban, permissions: ['project.view.managed', 'project.view.all'] },
    ],
  },
  {
    label: 'Finance',
    items: [
      { to: '/expenses', label: 'Expenses', icon: BadgeIndianRupee, permissions: ['expense.view.team', 'expense.view.all'] },
      { to: '/approvals', label: 'Approval queue', icon: Stamp, badge: 'approvals',
        permissions: ['expense.approve.manager', 'expense.approve.finance'] },
      { to: '/reports', label: 'Reports', icon: FileBarChart, permissions: ['report.view.team', 'report.view.all'] },
    ],
  },
  {
    label: 'Administration',
    items: [
      { to: '/employees', label: 'Employees', icon: Users, permissions: ['employee.view.team', 'employee.view.all'] },
      { to: '/roles', label: 'Roles & permissions', icon: ShieldCheck, permissions: ['rbac.manage'] },
      { to: '/settings', label: 'Settings', icon: SettingsIcon, permissions: ['settings.view'] },
      { to: '/audit', label: 'Audit log', icon: ScrollText, permissions: ['audit.view'] },
    ],
  },
];

export function AppShell() {
  const { user, signOut, can } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => { setMobileNavOpen(false); setMenuOpen(false); }, [location.pathname]);

  const { data: unread } = useQuery({
    queryKey: ['notifications', 'unread'],
    queryFn: () => api.get<{ unread: number }>('/notifications/unread-count'),
    refetchInterval: 60_000,
  });

  const { data: queue } = useQuery({
    queryKey: ['expenses', 'queue-count'],
    queryFn: () => api.get('/expenses', { queue: 'awaiting_me', size: 1 }),
    enabled: can('expense.approve.manager', 'expense.approve.finance'),
    refetchInterval: 60_000,
  });

  const visibleGroups = NAV_GROUPS
    .map((g) => ({ ...g, items: g.items.filter((i) => !i.permissions || can(...i.permissions)) }))
    .filter((g) => g.items.length);

  const badgeFor = (item: NavItem) =>
    item.badge === 'approvals' ? queue?.page?.total ?? 0 : 0;

  const nav = (
    <nav className="flex flex-1 flex-col gap-6 overflow-y-auto px-3 py-4">
      {visibleGroups.map((group) => (
        <div key={group.label}>
          <p className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-white/35">
            {group.label}
          </p>
          <ul className="space-y-0.5">
            {group.items.map((item) => {
              const count = badgeFor(item);
              return (
                <li key={item.to}>
                  <NavLink to={item.to} end={item.to === '/'}
                    className={({ isActive }) => cx(
                      'flex items-center gap-2.5 rounded-lg border-l-2 py-2 pl-2.5 pr-3 text-sm transition-colors',
                      isActive
                        ? 'border-brand-500 bg-white/10 font-medium text-white'
                        : 'border-transparent text-white/65 hover:bg-white/5 hover:text-white')}>
                    <item.icon className="h-4 w-4 shrink-0" aria-hidden />
                    <span className="flex-1 truncate">{item.label}</span>
                    {count > 0 && (
                      <span className="tabular rounded-full bg-brand-500 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                        {count > 99 ? '99+' : count}
                      </span>
                    )}
                  </NavLink>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );

  const sidebar = (
    <aside className="flex h-full w-64 flex-col bg-ink-900">
      <div className="flex h-16 items-center gap-2.5 border-b border-white/10 px-4">
        <BrandMark size={30} />
        <Wordmark height={17} variant="mono-light" showTagline={false} />
      </div>
      {nav}
      <div className="border-t border-white/10 p-3">
        <p className="px-2 text-[10px] leading-relaxed text-white/30">
          ADISYS FieldOps v1.0<br />Observation Driven Insights
        </p>
      </div>
    </aside>
  );

  return (
    <div className="flex h-dvh overflow-hidden bg-surface">
      <div className="hidden lg:block">{sidebar}</div>

      {mobileNavOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div className="absolute inset-0 bg-ink-950/50" onClick={() => setMobileNavOpen(false)} />
          <div className="relative animate-fade-up">{sidebar}</div>
          <button onClick={() => setMobileNavOpen(false)} aria-label="Close navigation"
            className="absolute right-4 top-4 rounded-lg bg-white/10 p-2 text-white">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 shrink-0 items-center gap-3 border-b border-line bg-white px-4 sm:px-6">
          <button onClick={() => setMobileNavOpen(true)} aria-label="Open navigation"
            className="rounded-lg p-2 text-ink-600 hover:bg-ink-100 lg:hidden">
            <Menu className="h-4.5 w-4.5" />
          </button>

          <div className="hidden min-w-0 flex-1 sm:block">
            <ProductName className="text-sm text-ink-400" />
          </div>

          <div className="flex flex-1 items-center justify-end gap-1.5 sm:flex-none">
            <button onClick={() => navigate('/notifications')} aria-label="Notifications"
              className="relative rounded-lg p-2 text-ink-600 hover:bg-ink-100">
              <Bell className="h-4.5 w-4.5" />
              {(unread?.unread ?? 0) > 0 && (
                <span className="absolute right-1.5 top-1.5 flex h-4 min-w-4 items-center justify-center
                                 rounded-full bg-brand-500 px-1 text-[10px] font-semibold text-white">
                  {unread!.unread > 9 ? '9+' : unread!.unread}
                </span>
              )}
            </button>

            <div className="relative">
              <button onClick={() => setMenuOpen((v) => !v)} aria-expanded={menuOpen}
                className="flex items-center gap-2 rounded-lg py-1 pl-1 pr-2 hover:bg-ink-100">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-ink-900 text-xs font-semibold text-white">
                  {user ? initials(user.fullName) : '?'}
                </span>
                <span className="hidden text-left sm:block">
                  <span className="block text-xs font-medium leading-tight text-ink-900">{user?.fullName}</span>
                  <span className="block text-[11px] leading-tight text-ink-500">{user?.roleName}</span>
                </span>
                <ChevronDown className="h-3.5 w-3.5 text-ink-400" aria-hidden />
              </button>

              {menuOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
                  <div className="animate-fade-up absolute right-0 z-50 mt-1.5 w-60 rounded-lg bg-white p-1.5
                                  shadow-overlay ring-1 ring-line">
                    <div className="border-b border-line px-3 py-2.5">
                      <p className="truncate text-sm font-medium text-ink-900">{user?.fullName}</p>
                      <p className="truncate text-xs text-ink-500">{user?.email}</p>
                      <p className="tabular mt-1 text-[11px] text-ink-400">{user?.employeeCode}</p>
                    </div>
                    <button onClick={() => navigate('/account')}
                      className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm text-ink-700 hover:bg-ink-50">
                      <SettingsIcon className="h-4 w-4" /> Account & security
                    </button>
                    <button onClick={() => { void signOut().then(() => navigate('/login')); }}
                      className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm
                                 text-danger hover:bg-danger-soft">
                      <LogOut className="h-4 w-4" /> Sign out
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </header>

        <main className="min-w-0 flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

/** Consistent page heading used by every screen. */
export function PageHeader({ title, description, actions, children }: {
  title: string; description?: string; actions?: React.ReactNode; children?: React.ReactNode;
}) {
  return (
    <div className="border-b border-line bg-white px-4 py-5 sm:px-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold tracking-tight text-ink-900">{title}</h1>
          {description && <p className="mt-0.5 max-w-2xl text-sm text-ink-500">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2 no-print">{actions}</div>}
      </div>
      {children && <div className="mt-4">{children}</div>}
    </div>
  );
}
