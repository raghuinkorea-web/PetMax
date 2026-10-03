import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import type { PermissionKey } from '@adisys/shared';
import { useAuth } from './lib/auth';
import { ADMIN_NAV_PERMISSIONS, AppShell } from './components/AppShell';
import { Button, EmptyState } from './components/ui';
import { LoginPage } from './pages/Login';
import { DashboardPage } from './pages/Dashboard';
import { EmployeesPage } from './pages/Employees';
import { EmployeeDetailPage } from './pages/EmployeeDetail';
import { ProjectsPage } from './pages/Projects';
import { ProjectDetailPage } from './pages/ProjectDetail';
import { WorkPage } from './pages/Work';
import { ProductivityPage } from './pages/Productivity';
import { ExpensesPage } from './pages/Expenses';
import { ExpenseDetailPage } from './pages/ExpenseDetail';
import { ApprovalsPage } from './pages/Approvals';
import { LeaveCalendarPage } from './pages/LeaveCalendar';
import { LeaveRequestsPage } from './pages/LeaveRequests';
import { ReportsPage } from './pages/Reports';
import { SettingsPage } from './pages/Settings';
import { RolesPage } from './pages/Roles';
import { AuditPage } from './pages/Audit';
import { NotificationsPage } from './pages/Notifications';
import { AccountPage } from './pages/Account';

/**
 * Where the field app lives, for pointing people at it. In development
 * the two run side by side on localhost; in production it is configured.
 * If neither applies we say where to go without inventing a link.
 */
function fieldAppUrl(): string | null {
  const configured = import.meta.env.VITE_FIELD_APP_URL as string | undefined;
  if (configured) return configured;
  const { hostname, protocol } = window.location;
  if (hostname === 'localhost' || hostname === '127.0.0.1') return `${protocol}//${hostname}:5174`;
  return null;
}

/**
 * Shown to an account that holds none of the portal's permissions —
 * field staff, in practice. They used to land on an unguarded dashboard
 * with an empty menu and no explanation, which looks like the product is
 * broken rather than like they are in the wrong place.
 */
function WrongPortal({ name, roleName, onSignOut }: {
  name: string; roleName: string; onSignOut: () => void;
}) {
  const url = fieldAppUrl();
  return (
    <div className="flex min-h-dvh items-center justify-center bg-surface p-4">
      <div className="w-full max-w-md rounded-card bg-card p-6 shadow-card ring-1 ring-line">
        <h1 className="text-xl font-semibold text-ink-900">This portal is for managers</h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-700">
          You are signed in as <strong>{name}</strong> ({roleName}). That role does its work in the
          ADISYS field app — recording time, submitting expenses and applying for leave — so there
          is nothing for it here.
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          {url
            ? <Button variant="primary" onClick={() => { window.location.href = url; }}>
                Open the field app
              </Button>
            : <p className="text-sm text-ink-600">Open the ADISYS field app on your phone instead.</p>}
          <Button onClick={onSignOut}>Sign out</Button>
        </div>
        <p className="mt-4 text-xs leading-relaxed text-ink-500">
          If you were expecting access to this portal, ask your administrator to check your role.
        </p>
      </div>
    </div>
  );
}

function FullPageSpinner() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-surface">
      <Loader2 className="h-6 w-6 animate-spin text-brand-500" aria-label="Loading" />
    </div>
  );
}

/** Blocks a route the caller's role does not include. */
function Guard({ permissions, children }: { permissions: PermissionKey[]; children: React.ReactNode }) {
  const { can } = useAuth();
  if (!can(...permissions)) {
    return (
      <EmptyState
        title="You do not have access to this area"
        description="Your ADISYS role does not include this module. If you believe this is wrong, contact your administrator."
      />
    );
  }
  return <>{children}</>;
}

export function App() {
  const { user, loading, can, signOut } = useAuth();
  const location = useLocation();

  if (loading) return <FullPageSpinner />;

  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="*" element={<Navigate to="/login" replace state={{ from: location.pathname }} />} />
      </Routes>
    );
  }

  // No menu item is open to this account, so the shell would render an
  // empty sidebar over a dashboard it cannot load. Say so instead.
  if (!can(...ADMIN_NAV_PERMISSIONS)) {
    return <WrongPortal name={user.fullName} roleName={user.roleName} onSignOut={() => void signOut()} />;
  }

  return (
    <Routes>
      <Route path="/login" element={<Navigate to="/" replace />} />
      <Route element={<AppShell />}>
        {/* Guarded like every other route: it was the one page anybody
            could land on regardless of permission. */}
        <Route index element={<Guard permissions={['dashboard.view']}><DashboardPage /></Guard>} />
        <Route path="work" element={<Guard permissions={['work.view.team', 'work.view.all']}><WorkPage /></Guard>} />
        <Route path="productivity" element={<Guard permissions={['productivity.view.team', 'productivity.view.all']}><ProductivityPage /></Guard>} />
        <Route path="projects" element={<Guard permissions={['project.view.managed', 'project.view.all', 'project.view.assigned']}><ProjectsPage /></Guard>} />
        <Route path="projects/:id" element={<ProjectDetailPage />} />
        <Route path="employees" element={<Guard permissions={['employee.view.team', 'employee.view.all']}><EmployeesPage /></Guard>} />
        <Route path="employees/:id" element={<EmployeeDetailPage />} />
        <Route path="expenses" element={<Guard permissions={['expense.view.own', 'expense.view.team', 'expense.view.all']}><ExpensesPage /></Guard>} />
        <Route path="expenses/:id" element={<ExpenseDetailPage />} />
        <Route path="approvals" element={<Guard permissions={['expense.approve.manager', 'expense.approve.finance']}><ApprovalsPage /></Guard>} />
        <Route path="leave/calendar" element={<Guard permissions={['leave.view.team', 'leave.view.all']}><LeaveCalendarPage /></Guard>} />
        <Route path="leave/requests" element={<Guard permissions={['leave.view.team', 'leave.view.all']}><LeaveRequestsPage /></Guard>} />
        <Route path="reports" element={<Guard permissions={['report.view.own', 'report.view.team', 'report.view.all']}><ReportsPage /></Guard>} />
        <Route path="settings" element={<Guard permissions={['settings.view']}><SettingsPage /></Guard>} />
        <Route path="roles" element={<Guard permissions={['rbac.manage']}><RolesPage /></Guard>} />
        <Route path="audit" element={<Guard permissions={['audit.view']}><AuditPage /></Guard>} />
        <Route path="notifications" element={<NotificationsPage />} />
        <Route path="account" element={<AccountPage />} />
        <Route path="*" element={
          <EmptyState title="Page not found"
            description="The page you asked for does not exist. Use the navigation on the left to continue." />
        } />
      </Route>
    </Routes>
  );
}
