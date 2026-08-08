import { Link, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, LogOut } from 'lucide-react';
import { cn, hasPermission } from '@/utils';
import { useAuthStore, useAppStore } from '@/store';
import { settingsService } from '@/services';

const NAV_ITEMS = [
  { path: '/', label: 'Dashboard', icon: '📊', roles: ['super_admin', 'admin', 'branch_manager', 'branch_admin', 'cashier'], permission: 'dashboard:view' },
  { path: '/tables', label: 'Live Tables', icon: '🎱', roles: ['super_admin', 'admin', 'branch_manager', 'branch_admin', 'staff', 'cashier'], permission: 'tables:view' },
  { path: '/billing', label: 'Billing', icon: '🧾', roles: ['super_admin', 'admin', 'branch_manager', 'branch_admin', 'staff', 'cashier'], permission: 'billing:manage' },
  { path: '/reservations', label: 'Bookings', icon: '🗓️', roles: ['super_admin', 'admin', 'branch_manager', 'branch_admin', 'staff', 'cashier'], permission: 'bookings:manage' },
  { path: '/customers', label: 'Customers', icon: '👥', roles: ['super_admin', 'admin', 'branch_manager', 'branch_admin', 'staff', 'cashier'], permission: 'customers:view' },
  { path: '/menu', label: 'Menu', icon: '🎯', roles: ['super_admin', 'admin', 'branch_manager', 'branch_admin'], parent: 'master', permission: 'menu:view' },
  { path: '/inventory', label: 'Inventory', icon: '📦', roles: ['super_admin', 'admin', 'branch_manager', 'branch_admin'], parent: 'master', permission: 'inventory:manage' },
  { path: '/pending-payments', label: 'Pending Payments', icon: '💳', roles: ['super_admin', 'admin', 'branch_manager', 'branch_admin', 'staff', 'cashier'], permission: 'customers:view' },
  { path: '/expenses', label: 'Expenses', icon: '💸', roles: ['super_admin', 'admin', 'branch_manager', 'branch_admin'], permission: 'expenses:manage' },
  { path: '/attendance', label: 'Attendance', icon: '✅', roles: ['super_admin', 'admin', 'branch_manager', 'branch_admin'], permission: 'attendance:manage' },
  { path: '/my-attendance', label: 'My Attendance', icon: '🕒', roles: ['staff'] },
  { path: '/reports', label: 'Reports', icon: '📈', roles: ['super_admin', 'admin', 'branch_admin'], permission: 'reports:view' },
  { path: '/users', label: 'Staff', icon: '👤', roles: ['super_admin', 'admin', 'branch_manager', 'branch_admin'], parent: 'master', permission: 'staff:view' },
  { path: '/branches', label: 'Branches', icon: '🏢', roles: ['super_admin'], parent: 'master' },
  { path: '/settings', label: 'Settings', icon: '⚙️', roles: ['super_admin', 'branch_admin'], parent: 'master' },
  { path: '/wallet', label: 'Wallet', icon: '💼', roles: ['super_admin', 'branch_admin'], parent: 'master' },
  { path: '/central-customers', label: 'Central Customers', icon: '📇', roles: ['super_admin'], parent: 'master' },
  { path: '/logs', label: 'Audit Logs', icon: '📋', roles: ['super_admin'], parent: 'master' },
  { id: 'master', label: 'Master', icon: '⚙️', roles: ['super_admin', 'admin', 'branch_manager', 'branch_admin'], isParent: true },
];

export const Sidebar = () => {
  const { pathname } = useLocation();
  const { user, logout } = useAuthStore();
  const { sidebarOpen, setSidebarOpen, masterMenuOpen, toggleMasterMenu, selectedBranch } = useAppStore();
  const role = user?.role || 'staff';

  // Fetch branch-specific settings for business name
  const settingsBranch: string | undefined = selectedBranch || (user?.role === 'super_admin' ? undefined : (typeof user?.branches?.[0] === 'string' ? user.branches[0] : user?.branches?.[0]?._id));
  const { data: settingsData } = useQuery({
    queryKey: ['settings', settingsBranch],
    queryFn: () => settingsService.get(settingsBranch ? { branch: settingsBranch } : undefined).then((r) => r.data),
    staleTime: 5 * 60 * 1000,
  });

  const businessName = (settingsData as any)?.data?.settings?.businessName || 'The Golden Frame';

  const filtered = NAV_ITEMS.filter((item) => {
    // If it's the master parent item, show if they can see any of its children
    if (item.id === 'master') {
      const children = NAV_ITEMS.filter((c) => c.parent === 'master');
      return children.some((c) => {
        if (c.roles.includes(role)) {
          if (c.permission) {
            return hasPermission(user, c.permission);
          }
          return true;
        }
        return false;
      });
    }

    if (item.roles.includes(role)) {
      if (item.permission) {
        return hasPermission(user, item.permission);
      }
      return true;
    }
    return false;
  });

  // Custom ordering for Staff role
  const staffOrder = ['customers', 'reservations', 'pending-payments', 'tables', 'billing', 'my-attendance'];
  // Custom ordering for Branch Manager / Branch Admin role
  const branchManagerOrder = ['dashboard', 'customers', 'reservations', 'pending-payments', 'tables', 'billing', 'expenses', 'attendance', 'reports', 'master'];
  // Custom ordering for Super Admin / Admin role
  const superAdminOrder = ['dashboard', 'customers', 'reservations', 'pending-payments', 'tables', 'billing', 'expenses', 'attendance', 'reports', 'master'];
  // Custom ordering for Master children
  const masterChildOrder = ['menu', 'users', 'inventory', 'wallet', 'central-customers', 'branches', 'settings', 'logs'];

  const orderedFiltered = role === 'staff'
    ? filtered.filter((item) => !item.isParent).sort((a, b) => {
        const pathA = a.path?.replace('/', '') || '';
        const pathB = b.path?.replace('/', '') || '';
        const indexA = staffOrder.indexOf(pathA || 'dashboard');
        const indexB = staffOrder.indexOf(pathB || 'dashboard');
        return indexA - indexB;
      })
    : (role === 'branch_manager' || role === 'branch_admin' || role === 'admin' || role === 'super_admin')
    ? filtered.sort((a, b) => {
        const orderMap = (role === 'branch_manager' || role === 'branch_admin') ? branchManagerOrder : superAdminOrder;
        const keyA = a.isParent ? a.id : a.path?.replace('/', '') || '';
        const keyB = b.isParent ? b.id : b.path?.replace('/', '') || '';
        const indexA = orderMap.indexOf(keyA || 'dashboard');
        const indexB = orderMap.indexOf(keyB || 'dashboard');
        return (indexA === -1 ? 99 : indexA) - (indexB === -1 ? 99 : indexB);
      })
    : filtered.filter((item) => !item.isParent);

  const handleItemClick = () => {
    // Close sidebar on mobile after navigation
    if (typeof window !== 'undefined' && window.matchMedia('(max-width: 1024px)').matches) {
      setSidebarOpen(false);
    }
  };

  // Extract sidebar content into a component for reuse
  const SidebarContent = () => (
    <>
      {/* Business Name Header */}
      <div className="h-14 px-4 flex items-center justify-center border-b border-border flex-shrink-0">
        <h2 className="text-lg sm:text-xl font-extrabold text-foreground text-center truncate tracking-tight">
          {businessName}
        </h2>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-1">
        {orderedFiltered.map((item) => {
          if (item.isParent) {
            const children = orderedFiltered
              .filter((child) => child.parent === item.id)
              .sort((a, b) => {
                const keyA = a.path?.replace('/', '') || '';
                const keyB = b.path?.replace('/', '') || '';
                const indexA = masterChildOrder.indexOf(keyA);
                const indexB = masterChildOrder.indexOf(keyB);
                return (indexA === -1 ? 99 : indexA) - (indexB === -1 ? 99 : indexB);
              });
            return (
              <div key={item.id}>
                <button
                  onClick={toggleMasterMenu}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 text-muted-foreground hover:text-foreground hover:bg-accent"
                >
                  <span className="text-base w-5 text-center">{item.icon}</span>
                  {item.label}
                  <span className="ml-auto">
                    {masterMenuOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  </span>
                </button>
                <AnimatePresence>
                  {masterMenuOpen && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2, ease: 'easeInOut' }}
                      className="overflow-hidden pl-4 space-y-1"
                    >
                      {children.map((child) => {
                        if (!child.path) return null;
                        const active = pathname === child.path || (child.path !== '/' && pathname.startsWith(child.path));
                        return (
                          <Link
                            key={child.path}
                            to={child.path}
                            onClick={handleItemClick}
                            className={cn(
                              'flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200',
                              active ? 'gradient-brand text-white shadow-lg shadow-blue-500/20' : 'text-muted-foreground hover:text-foreground hover:bg-accent'
                            )}
                          >
                            <span className="text-base w-5 text-center">{child.icon}</span>
                            {child.label}
                            {active && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-white/60" />}
                          </Link>
                        );
                      })}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          }

          // Skip child items (they're rendered inside parent)
          if (item.parent && orderedFiltered.some((p) => p.isParent && p.id === item.parent)) return null;

          // Regular menu items
          if (!item.path) return null;
          const active = pathname === item.path || (item.path !== '/' && pathname.startsWith(item.path));
          return (
            <Link
              key={item.path}
              to={item.path}
              onClick={handleItemClick}
              className={cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200',
                active ? 'gradient-brand text-white shadow-lg shadow-blue-500/20' : 'text-muted-foreground hover:text-foreground hover:bg-accent'
              )}
            >
              <span className="text-base w-5 text-center">{item.icon}</span>
              {item.label}
              {active && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-white/60" />}
            </Link>
          );
        })}
      </nav>

      {/* User profile */}
      <div className="border-t border-border p-4">
        <div className="flex items-center gap-3 mb-3">
          <div className="h-9 w-9 rounded-xl gradient-brand flex items-center justify-center text-white font-semibold text-sm">
            {user?.name?.[0]?.toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{user?.name}</p>
            <p className="text-xs text-muted-foreground capitalize">{role.replace('_', ' ')}</p>
          </div>
        </div>
        <button onClick={() => logout()} className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm font-medium text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors group">
          <LogOut className="h-4 w-4 text-muted-foreground group-hover:text-red-400 transition-colors" />
          <span>Sign out</span>
        </button>
      </div>
    </>
  );

  return (
    <>
      {/* Desktop sidebar — always visible, static (not overlay) */}
      <div className={cn('hidden lg:flex flex-col h-screen flex-shrink-0 overflow-hidden border-r border-border bg-card transition-[width] duration-300 ease-in-out', sidebarOpen ? 'w-64' : 'w-0 border-r-0')} aria-hidden={!sidebarOpen}>
        {sidebarOpen && <SidebarContent />}
      </div>

      {/* Mobile sidebar — overlay drawer, only when open */}
      <AnimatePresence>
        {sidebarOpen && (
          <motion.aside
            initial={{ x: -260 }} animate={{ x: 0 }} exit={{ x: -260 }} transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            className="lg:hidden fixed left-0 top-0 z-30 h-screen w-64 flex flex-col border-r border-border bg-card"
          >
            {/* Close button — mobile only */}
            <button
              onClick={() => setSidebarOpen(false)}
              className="absolute top-3 right-3 p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted"
              aria-label="Close menu"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
            <SidebarContent />
          </motion.aside>
        )}
      </AnimatePresence>
    </>
  );
};
