import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import type { PermissionKey } from '@adisys/shared';
import { useAuth } from './lib/auth';
import { AppShell } from './components/AppShell';
import { EmptyState } from './components/ui';
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
  const { user, loading } = useAuth();
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

  return (
    <Routes>
      <Route path="/login" element={<Navigate to="/" replace />} />
      <Route element={<AppShell />}>
        <Route index element={<DashboardPage />} />
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
