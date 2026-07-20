import { Suspense, lazy, useEffect, useRef } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore, useAppStore } from '@/store';
import { AppLayout } from '@/components/layout/AppLayout';
import { LoadingPage } from '@/components/ui';

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
const BranchesPage = lazy(() => import('@/pages/OtherPages').then((m) => ({ default: m.BranchesPage })));
const UsersPage = lazy(() => import('@/pages/OtherPages').then((m) => ({ default: m.UsersPage })));
const LogsPage = lazy(() => import('@/pages/OtherPages').then((m) => ({ default: m.LogsPage })));

// ── Auth guard ─────────────────────────────────────────────────────────────────
function ProtectedRoute({ children, roles }: { children: React.ReactNode; roles?: string[] }) {
  const { isAuthenticated, isLoading, user } = useAuthStore();
  if (isLoading) return <LoadingPage />;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (roles && user && !roles.includes(user.role)) return <Navigate to="/" replace />;
  return <>{children}</>;
}

// ── Dashboard redirect for Staff ────────────────────────────────────────────────
function DashboardGuard({ children }: { children: React.ReactNode }) {
  const { user } = useAuthStore();
  if (user?.role === 'staff') {
    return <Navigate to="/customers" replace />;
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
              <Route path="tables" element={<TablesPage />} />
              <Route path="billing" element={<BillingPage />} />
              <Route path="billing/new" element={<BillingPage />} />
              <Route path="billing/:id" element={<BillingPage />} />
              <Route path="customers" element={<CustomersPage />} />
              <Route path="menu" element={<ProtectedRoute roles={['super_admin', 'branch_manager']}><MenuPage /></ProtectedRoute>} />
              <Route path="inventory" element={<InventoryPage />} />
              <Route path="pending-payments" element={<PendingPaymentsPage />} />
              <Route path="expenses" element={<ExpensesPage />} />
              <Route path="attendance" element={<ProtectedRoute roles={['super_admin', 'admin', 'branch_manager']}><AttendancePage /></ProtectedRoute>} />
              <Route path="my-attendance" element={<ProtectedRoute roles={['staff']}><MyAttendancePage /></ProtectedRoute>} />
              <Route path="reservations" element={<ReservationsPage />} />
              <Route path="reports" element={<ProtectedRoute roles={['super_admin', 'admin']}><ReportsPage /></ProtectedRoute>} />
              {/* Super admin only */}
              <Route path="users" element={<ProtectedRoute roles={['super_admin', 'admin', 'branch_manager']}><UsersPage /></ProtectedRoute>} />
              <Route path="branches" element={<ProtectedRoute roles={['super_admin']}><BranchesPage /></ProtectedRoute>} />
              <Route path="settings" element={<ProtectedRoute roles={['super_admin']}><SettingsPage /></ProtectedRoute>} />
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
