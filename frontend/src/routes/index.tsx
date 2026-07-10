import { useEffect, useRef } from 'react';
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { useAuthStore, useAppStore } from '@/store';
import { AppLayout } from '@/components/layout/AppLayout';
import { LoadingPage } from '@/components/ui';
import LoginPage from '@/pages/LoginPage';
import DashboardPage from '@/pages/DashboardPage';
import TablesPage from '@/pages/TablesPage';
import BillingPage from '@/pages/BillingPage';
import CustomersPage from '@/pages/CustomersPage';
import MenuPage from '@/pages/MenuPage';
import InventoryPage from '@/pages/InventoryPage';
import ExpensesPage from '@/pages/ExpensesPage';
import ReportsPage from '@/pages/ReportsPage';
import {
  BranchesPage, UsersPage,
  BookingsPage, LogsPage
} from '@/pages/OtherPages';
import AttendancePage from '@/pages/AttendancePage';
import SettingsPage from '@/pages/SettingsPage';
import ReservationsPage from '@/pages/ReservationsPage';
import PendingPaymentsPage from '@/pages/PendingPaymentsPage';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';

// ── Auth guard ─────────────────────────────────────────────────────────────────
function ProtectedRoute({ children, roles }: { children: React.ReactNode; roles?: string[] }) {
  const { isAuthenticated, isLoading, user } = useAuthStore();
  if (isLoading) return <LoadingPage />;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (roles && user && !roles.includes(user.role)) return <Navigate to="/" replace />;
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
  const { fetchMe, isAuthenticated, isLoading } = useAuthStore();
  const hasAttemptedHydration = useRef(false);
  useEffect(() => {
    const token = localStorage.getItem('accessToken');
    if (token && !isAuthenticated && !isLoading && !hasAttemptedHydration.current) {
      hasAttemptedHydration.current = true;
      fetchMe();
    }
  }, [fetchMe, isAuthenticated, isLoading]);
  return <>{children}</>;
}

export function AppRoutes() {
  return (
    <ThemeProvider>
      <AuthHydrator>
        <Routes>
          {/* Public */}
          <Route path="/login" element={<PublicOnlyRoute><LoginPage /></PublicOnlyRoute>} />

          {/* Protected app shell */}
          <Route element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
            <Route index element={<DashboardPage />} />
            <Route path="tables" element={<TablesPage />} />
            <Route path="billing" element={<BillingPage />} />
            <Route path="billing/new" element={<BillingPage />} />
            <Route path="billing/:id" element={<BillingPage />} />
            <Route path="customers" element={<CustomersPage />} />
            <Route path="menu" element={<ProtectedRoute roles={['super_admin', 'branch_manager']}><MenuPage /></ProtectedRoute>} />
            <Route path="inventory" element={<InventoryPage />} />
            <Route path="pending-payments" element={<PendingPaymentsPage />} />
            <Route path="expenses" element={<ExpensesPage />} />
            <Route path="attendance" element={<AttendancePage />} />
            <Route path="bookings" element={<BookingsPage />} />
            <Route path="reservations" element={<ReservationsPage />} />
            <Route path="reports" element={<ReportsPage />} />
            {/* Super admin only */}
            <Route path="users" element={<ProtectedRoute roles={['super_admin']}><UsersPage /></ProtectedRoute>} />
            <Route path="branches" element={<ProtectedRoute roles={['super_admin']}><BranchesPage /></ProtectedRoute>} />
            <Route path="settings" element={<ProtectedRoute roles={['super_admin']}><SettingsPage /></ProtectedRoute>} />
            <Route path="logs" element={<ProtectedRoute roles={['super_admin']}><LogsPage /></ProtectedRoute>} />
          </Route>

          {/* Fallback */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthHydrator>
    </ThemeProvider>
  );
}
