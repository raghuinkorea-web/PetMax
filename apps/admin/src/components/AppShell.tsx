import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  BadgeIndianRupee, Bell, CalendarCheck2, ChevronDown, ClipboardList, FileBarChart,
  FolderKanban, Gauge, LogOut, Menu, MousePointer2, PanelLeft, PanelLeftClose,
  ScrollText, Settings as SettingsIcon, ShieldCheck, Stamp, Users, X,
} from 'lucide-react';
import type { PermissionKey } from '@adisys/shared';
import { useAuth } from '../lib/auth';
import { api } from '../lib/api';
import { Avatar } from './Avatar';
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

/**
 * How the side menu behaves on a desktop viewport.
 *
 *  pinned    always full width
 *  hover     an icon rail that expands while the pointer is over it
 *  collapsed an icon rail that stays an icon rail
 *
 * The choice is per browser rather than per account: it is a preference about
 * this screen, not a property of the employee, so it lives in localStorage.
 */
type NavMode = 'pinned' | 'hover' | 'collapsed';

const NAV_MODES: NavMode[] = ['pinned', 'hover', 'collapsed'];
const NAV_MODE_KEY = 'adisys.admin.navMode';

const NAV_MODE_META: Record<NavMode, { label: string; icon: typeof Gauge }> = {
  pinned: { label: 'Menu stays open', icon: PanelLeft },
  hover: { label: 'Menu expands on mouse-over', icon: MousePointer2 },
  collapsed: { label: 'Menu stays collapsed', icon: PanelLeftClose },
};

function readNavMode(): NavMode {
  try {
    const stored = localStorage.getItem(NAV_MODE_KEY);
    if (NAV_MODES.includes(stored as NavMode)) return stored as NavMode;
  } catch {
    // Private browsing, or storage blocked — fall through to the default.
  }
  return 'pinned';
}

export function AppShell() {
  const { user, signOut, can } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [navMode, setNavMode] = useState<NavMode>(readNavMode);
  const [navRevealed, setNavRevealed] = useState(false);

  useEffect(() => {
    try { localStorage.setItem(NAV_MODE_KEY, navMode); } catch { /* not fatal */ }
  }, [navMode]);

  // Full width when pinned, or while hover mode is revealing the rail.
  const navExpanded = navMode === 'pinned' || (navMode === 'hover' && navRevealed);
  const cycleNavMode = () =>
    setNavMode((m) => NAV_MODES[(NAV_MODES.indexOf(m) + 1) % NAV_MODES.length]);

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

  // `expanded` only controls what is *visible*: labels stay in the document so
  // the rail remains navigable by screen reader and keyboard.
  const renderNav = (expanded: boolean) => (
    <nav className={cx('flex flex-1 flex-col gap-6 overflow-y-auto overflow-x-hidden py-4',
                       expanded ? 'px-3' : 'px-2')}>
      {visibleGroups.map((group) => (
        <div key={group.label}>
          <p className={cx('text-[12px] font-bold uppercase tracking-wider text-white/35',
                           expanded ? 'px-3 pb-1.5' : 'sr-only')}>
            {group.label}
          </p>
          <ul className="space-y-0.5">
            {group.items.map((item) => {
              const count = badgeFor(item);
              return (
                <li key={item.to}>
                  <NavLink to={item.to} end={item.to === '/'}
                    title={expanded ? undefined : item.label}
                    className={({ isActive }) => cx(
                      // Every item is bold; the current page is distinguished by
                      // the red edge, the lighter fill and full-strength white
                      // rather than by weight.
                      'relative flex items-center gap-2.5 rounded-lg border-l-2 py-2',
                      'text-[16px] font-bold transition-colors',
                      expanded ? 'pl-2.5 pr-3' : 'justify-center px-0',
                      isActive
                        ? 'border-brand-500 bg-white/10 text-white'
                        : 'border-transparent text-white/65 hover:bg-white/5 hover:text-white')}>
                    <item.icon className="h-4 w-4 shrink-0" aria-hidden />
                    <span className={expanded ? 'flex-1 truncate' : 'sr-only'}>{item.label}</span>
                    {count > 0 && (expanded ? (
                      <span className="tabular rounded-full bg-brand-500 px-1.5 py-0.5 text-[12px] font-bold text-white">
                        {count > 99 ? '99+' : count}
                      </span>
                    ) : (
                      // No room for a number on the rail — a dot carries the same signal.
                      <span aria-hidden
                        className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-brand-500" />
                    ))}
                  </NavLink>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );

  /** `showModeToggle` is false in the mobile drawer, where the rail never applies. */
  const renderSidebar = (expanded: boolean, showModeToggle: boolean) => {
    const ModeIcon = NAV_MODE_META[navMode].icon;
    return (
      <aside className={cx('flex h-full flex-col overflow-hidden bg-navy-900 transition-[width] duration-200 ease-out',
                           expanded ? 'w-64' : 'w-16')}>
        {/* The brand stays on screen in both states: the full lockup, tagline
            and all, when there is room; the "A" of the same artwork on the
            rail, where nothing wider fits. */}
        <div className={cx('flex h-16 shrink-0 items-center border-b border-white/10',
                           expanded ? 'px-4' : 'justify-center px-2')}>
          {expanded
            ? <Wordmark height={30} variant="mono-light" />
            : <BrandMark height={22} variant="mono-light" />}
        </div>

        {renderNav(expanded)}

        <div className={cx('shrink-0 border-t border-white/10 p-3',
                           expanded ? '' : 'flex justify-center px-2')}>
          {showModeToggle && (
            <button type="button" onClick={cycleNavMode}
              title={`${NAV_MODE_META[navMode].label} — click to change`}
              aria-label={`Side menu behaviour: ${NAV_MODE_META[navMode].label}. Activate to change.`}
              className={cx('flex items-center gap-2 rounded-lg text-white/45 transition-colors',
                            'hover:bg-white/5 hover:text-white',
                            expanded ? 'w-full px-2 py-1.5' : 'p-2')}>
              <ModeIcon className="h-4 w-4 shrink-0" aria-hidden />
              <span className={expanded ? 'truncate text-[13px] font-bold' : 'sr-only'}>
                {NAV_MODE_META[navMode].label}
              </span>
            </button>
          )}
          {expanded && (
            <p className="px-2 pt-2 text-[12px] font-bold leading-relaxed text-white/30">
              ADISYS FieldOps v1.0
            </p>
          )}
        </div>
      </aside>
    );
  };

  return (
    <div className="flex h-dvh overflow-hidden bg-surface">
      {/* The menu sits in the flow rather than over the page, so expanding it
          narrows the content instead of covering it: nothing is ever hidden
          behind the panel. The page area is min-w-0, so it reflows, and wide
          tables keep their own horizontal scroll rather than being clipped. */}
      <div
        className="hidden shrink-0 lg:block"
        onMouseEnter={() => { if (navMode === 'hover') setNavRevealed(true); }}
        onMouseLeave={() => { if (navMode === 'hover') setNavRevealed(false); }}
        // Keyboard users get the same reveal when focus enters the rail.
        onFocusCapture={() => { if (navMode === 'hover') setNavRevealed(true); }}
        onBlurCapture={(e) => {
          if (navMode !== 'hover') return;
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setNavRevealed(false);
        }}>
        {renderSidebar(navExpanded, true)}
      </div>

      {mobileNavOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div className="absolute inset-0 bg-ink-950/50" onClick={() => setMobileNavOpen(false)} />
          <div className="relative animate-fade-up">{renderSidebar(true, false)}</div>
          <button onClick={() => setMobileNavOpen(false)} aria-label="Close navigation"
            className="absolute right-4 top-4 rounded-lg bg-white/10 p-2 text-white">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 shrink-0 items-center gap-3 border-b border-line bg-card px-4 sm:px-6">
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
                                 rounded-full bg-brand-500 px-1 text-[11px] font-semibold text-white">
                  {unread!.unread > 9 ? '9+' : unread!.unread}
                </span>
              )}
            </button>

            <div className="relative">
              <button onClick={() => setMenuOpen((v) => !v)} aria-expanded={menuOpen}
                className="flex items-center gap-2 rounded-lg py-1 pl-1 pr-2 hover:bg-ink-100">
                <Avatar name={user?.fullName ?? '?'} fileId={user?.avatarFileId} size={32} />
                <span className="hidden text-left sm:block">
                  <span className="block text-xs font-medium leading-tight text-ink-900">{user?.fullName}</span>
                  <span className="block text-[12px] leading-tight text-ink-500">{user?.roleName}</span>
                </span>
                <ChevronDown className="h-3.5 w-3.5 text-ink-400" aria-hidden />
              </button>

              {menuOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
                  <div className="animate-fade-up absolute right-0 z-50 mt-1.5 w-60 rounded-lg bg-card p-1.5
                                  shadow-overlay ring-1 ring-line">
                    <div className="border-b border-line px-3 py-2.5">
                      <p className="truncate text-sm font-medium text-ink-900">{user?.fullName}</p>
                      <p className="truncate text-xs text-ink-500">{user?.email}</p>
                      <p className="tabular mt-1 text-[12px] text-ink-400">{user?.employeeCode}</p>
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
    <div className="border-b border-line bg-card px-4 py-5 sm:px-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-ink-900">{title}</h1>
          {description && <p className="mt-1 max-w-2xl text-sm text-ink-500">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2 no-print">{actions}</div>}
      </div>
      {children && <div className="mt-4">{children}</div>}
    </div>
  );
}
