import { Suspense, lazy, useEffect, useRef } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore, useAppStore } from '@/store';
import { AppLayout } from '@/components/layout/AppLayout';
import { LoadingPage } from '@/components/ui';
import { hasPermission } from '@/utils';

const LoginPage = lazy(() => import('@/pages/LoginPage'));
const DashboardPage = lazy(() => import('@/pages/DashboardPage'));
const TablesPage = lazy(() => import('@/pages/TablesPage'));
const BillingPage = lazy(() => import('@/pages/BillingPage'));
const CustomersPage = lazy(() => import('@/pages/CustomersPage'));
const MenuPage = lazy(() => import('@/pages/MenuPage'));
const InventoryPage = lazy(() => import('@/pages/InventoryPage'));
const ExpensesPage = lazy(() => import('@/pages/ExpensesPage'));
const ReportsPage = lazy(() => import('@/pages/ReportsPage'));
const AttendancePage = lazy(() => import('@/pages/AttendancePage'));
const MyAttendancePage = lazy(() => import('@/pages/MyAttendancePage'));
const SettingsPage = lazy(() => import('@/pages/SettingsPage'));
const ReservationsPage = lazy(() => import('@/pages/ReservationsPage'));
const PendingPaymentsPage = lazy(() => import('@/pages/PendingPaymentsPage'));
const NotificationsPage = lazy(() => import('@/pages/OtherPages').then((m) => ({ default: m.NotificationsPage })));
const BranchesPage = lazy(() => import('@/pages/OtherPages').then((m) => ({ default: m.BranchesPage })));
const UsersPage = lazy(() => import('@/pages/OtherPages').then((m) => ({ default: m.UsersPage })));
const LogsPage = lazy(() => import('@/pages/OtherPages').then((m) => ({ default: m.LogsPage })));

// ── Auth guard ─────────────────────────────────────────────────────────────────
function ProtectedRoute({ children, roles, permission }: { children: React.ReactNode; roles?: string[]; permission?: string }) {
  const { isAuthenticated, isLoading, user } = useAuthStore();
  if (isLoading) return <LoadingPage />;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (user) {
    if (permission) {
      if (!hasPermission(user, permission)) return <Navigate to="/" replace />;
    } else if (roles && !roles.includes(user.role)) {
      return <Navigate to="/" replace />;
    }
  }
  return <>{children}</>;
}

// ── Dashboard redirect for Staff and Branch Admins without dashboard:view ─────
function DashboardGuard({ children }: { children: React.ReactNode }) {
  const { user } = useAuthStore();
  if (!user) return <>{children}</>;

  if (user.role === 'staff') {
    return <Navigate to="/customers" replace />;
  }

  if (user.role === 'branch_admin' && !hasPermission(user, 'dashboard:view')) {
    if (hasPermission(user, 'tables:view')) return <Navigate to="/tables" replace />;
    if (hasPermission(user, 'customers:view')) return <Navigate to="/customers" replace />;
    if (hasPermission(user, 'bookings:manage')) return <Navigate to="/reservations" replace />;
    if (hasPermission(user, 'billing:manage')) return <Navigate to="/billing" replace />;
    return <Navigate to="/notifications" replace />;
  }

  return <>{children}</>;
}

function PublicOnlyRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuthStore();
  if (isAuthenticated) return <Navigate to="/" replace />;
  return <>{children}</>;
}

// ── Theme applicator ───────────────────────────────────────────────────────────
function ThemeProvider({ children }: { children: React.ReactNode }) {
  const { isDarkMode } = useAppStore();
  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDarkMode);
  }, [isDarkMode]);
  return <>{children}</>;
}

// ── Root: silently re-hydrate user on first load ───────────────────────────────
function AuthHydrator({ children }: { children: React.ReactNode }) {
  const { fetchMe, isLoading } = useAuthStore();
  const hasAttemptedHydration = useRef(false);
  useEffect(() => {
    const token = localStorage.getItem('accessToken');
    if (token && !isLoading && !hasAttemptedHydration.current) {
      hasAttemptedHydration.current = true;
      fetchMe();
    }
  }, [fetchMe, isLoading]);
  return <>{children}</>;
}

export function AppRoutes() {
  return (
    <ThemeProvider>
      <AuthHydrator>
        <Suspense fallback={<LoadingPage />}>
          <Routes>
            {/* Public */}
            <Route path="/login" element={<PublicOnlyRoute><LoginPage /></PublicOnlyRoute>} />

            {/* Protected app shell */}
            <Route element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
              <Route index element={<DashboardGuard><DashboardPage /></DashboardGuard>} />
              <Route path="tables" element={<ProtectedRoute permission="tables:view"><TablesPage /></ProtectedRoute>} />
              <Route path="billing" element={<ProtectedRoute permission="billing:manage"><BillingPage /></ProtectedRoute>} />
              <Route path="billing/new" element={<ProtectedRoute permission="billing:manage"><BillingPage /></ProtectedRoute>} />
              <Route path="billing/:id" element={<ProtectedRoute permission="billing:manage"><BillingPage /></ProtectedRoute>} />
              <Route path="customers" element={<ProtectedRoute permission="customers:view"><CustomersPage /></ProtectedRoute>} />
              <Route path="menu" element={<ProtectedRoute roles={['super_admin', 'admin', 'branch_manager', 'branch_admin']} permission="menu:view"><MenuPage /></ProtectedRoute>} />
              <Route path="inventory" element={<ProtectedRoute roles={['super_admin', 'admin', 'branch_manager', 'branch_admin']} permission="inventory:manage"><InventoryPage /></ProtectedRoute>} />
              <Route path="pending-payments" element={<ProtectedRoute permission="customers:view"><PendingPaymentsPage /></ProtectedRoute>} />
              <Route path="expenses" element={<ProtectedRoute permission="expenses:manage"><ExpensesPage /></ProtectedRoute>} />
              <Route path="attendance" element={<ProtectedRoute roles={['super_admin', 'admin', 'branch_manager', 'branch_admin']} permission="attendance:manage"><AttendancePage /></ProtectedRoute>} />
              <Route path="my-attendance" element={<ProtectedRoute roles={['staff']}><MyAttendancePage /></ProtectedRoute>} />
              <Route path="reservations" element={<ProtectedRoute permission="bookings:manage"><ReservationsPage /></ProtectedRoute>} />
              <Route path="notifications" element={<NotificationsPage />} />
              <Route path="reports" element={<ProtectedRoute roles={['super_admin', 'admin', 'branch_admin']} permission="reports:view"><ReportsPage /></ProtectedRoute>} />
              {/* Super admin only */}
              <Route path="users" element={<ProtectedRoute roles={['super_admin', 'admin', 'branch_manager', 'branch_admin']} permission="staff:view"><UsersPage /></ProtectedRoute>} />
              <Route path="branches" element={<ProtectedRoute roles={['super_admin']}><BranchesPage /></ProtectedRoute>} />
              <Route path="settings" element={<ProtectedRoute roles={['super_admin', 'branch_admin']}><SettingsPage /></ProtectedRoute>} />
              <Route path="logs" element={<ProtectedRoute roles={['super_admin']}><LogsPage /></ProtectedRoute>} />
            </Route>

            {/* Fallback */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </AuthHydrator>
    </ThemeProvider>
  );
}
