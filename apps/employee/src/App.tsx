import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './lib/auth';
import { Shell } from './components/Shell';
import { Wordmark } from './components/Brand';
import { LoginScreen, ForgotPasswordScreen } from './pages/Login';
import { HomeScreen } from './pages/Home';
import { WorkScreen } from './pages/Work';
import { WorkDetailScreen } from './pages/WorkDetail';
import { ExpensesScreen } from './pages/Expenses';
import { AddExpenseScreen } from './pages/AddExpense';
import { ExpenseDetailScreen } from './pages/ExpenseDetail';
import { LeaveScreen } from './pages/Leave';
import { NotificationsScreen } from './pages/Notifications';
import { ProfileScreen, DevicesScreen } from './pages/Profile';

/** Splash — shown while the stored session is checked. */
function Splash() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-ink-900">
      <Wordmark height={34} variant="mono-light" />
      <span className="h-1 w-24 overflow-hidden rounded-full bg-white/15">
        <span className="block h-full w-1/3 animate-[adisys-shimmer_1.2s_linear_infinite] rounded-full bg-brand-500" />
      </span>
      <span className="sr-only">Loading ADISYS FieldOps</span>
    </div>
  );
}

export function App() {
  const { user, loading } = useAuth();

  if (loading) return <Splash />;

  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<LoginScreen />} />
        <Route path="/forgot-password" element={<ForgotPasswordScreen />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route path="/login" element={<Navigate to="/" replace />} />
      {/* Screens that own the full viewport sit outside the tab shell. */}
      <Route path="/work/:id" element={<WorkDetailScreen />} />
      <Route path="/expenses/new" element={<AddExpenseScreen />} />
      <Route path="/expenses/:id" element={<ExpenseDetailScreen />} />
      <Route element={<Shell />}>
        <Route index element={<HomeScreen />} />
        <Route path="work" element={<WorkScreen />} />
        <Route path="leave" element={<LeaveScreen />} />
        <Route path="expenses" element={<ExpensesScreen />} />
        <Route path="notifications" element={<NotificationsScreen />} />
        <Route path="profile" element={<ProfileScreen />} />
        <Route path="profile/devices" element={<DevicesScreen />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
