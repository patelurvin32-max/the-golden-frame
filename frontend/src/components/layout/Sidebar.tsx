import { Link, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/utils';
import { useAuthStore, useAppStore } from '@/store';

const NAV_ITEMS = [
  { path: '/', label: 'Dashboard', icon: '📊', roles: ['super_admin', 'admin', 'branch_manager', 'staff', 'cashier'] },
  { path: '/tables', label: 'Live Tables', icon: '🎱', roles: ['super_admin', 'admin', 'branch_manager', 'staff', 'cashier'] },
  { path: '/billing', label: 'Billing', icon: '🧾', roles: ['super_admin', 'admin', 'branch_manager', 'staff', 'cashier'] },
  { path: '/bookings', label: 'Bookings', icon: '📅', roles: ['super_admin', 'admin', 'branch_manager'] },
  { path: '/reservations', label: 'Reservations', icon: '🗓️', roles: ['super_admin', 'admin', 'branch_manager', 'staff', 'cashier'] },
  { path: '/customers', label: 'Customers', icon: '👥', roles: ['super_admin', 'admin', 'branch_manager', 'staff', 'cashier'] },
  { path: '/menu', label: 'Menu', icon: '🍽️', roles: ['super_admin', 'admin', 'branch_manager'] },
  { path: '/inventory', label: 'Inventory', icon: '📦', roles: ['super_admin', 'admin', 'branch_manager'] },
  { path: '/pending-payments', label: 'Pending Payments', icon: '💳', roles: ['super_admin', 'admin', 'branch_manager', 'staff', 'cashier'] },
  { path: '/expenses', label: 'Expenses', icon: '💸', roles: ['super_admin', 'admin', 'branch_manager'] },
  { path: '/attendance', label: 'Attendance', icon: '✅', roles: ['super_admin', 'admin', 'branch_manager'] },
  { path: '/reports', label: 'Reports', icon: '📈', roles: ['super_admin', 'admin'] },
  { path: '/users', label: 'Staff', icon: '👤', roles: ['super_admin'] },
  { path: '/branches', label: 'Branches', icon: '🏢', roles: ['super_admin'] },
  { path: '/settings', label: 'Settings', icon: '⚙️', roles: ['super_admin'] },
  { path: '/logs', label: 'Audit Logs', icon: '📋', roles: ['super_admin'] },
];

export const Sidebar = () => {
  const { pathname } = useLocation();
  const { user, logout } = useAuthStore();
  const { sidebarOpen, toggleSidebar, setSidebarOpen } = useAppStore();
  const role = user?.role || 'staff';

  const filtered = NAV_ITEMS.filter((item) => item.roles.includes(role));

  const handleItemClick = () => {
    if (typeof window !== 'undefined' && window.matchMedia('(max-width: 1024px)').matches) {
      setSidebarOpen(false);
    }
  };

  return (
    <AnimatePresence>
      {sidebarOpen && (
        <motion.aside
          initial={{ x: -260 }} animate={{ x: 0 }} exit={{ x: -260 }} transition={{ type: 'spring', damping: 25, stiffness: 200 }}
          className="fixed left-0 top-0 z-30 h-screen w-64 flex flex-col border-r border-border bg-card"
        >
          {/* Logo */}
          <div className="flex items-center gap-3 px-6 py-5 border-b border-border">
            <img src="/assets/tgf.jpg" alt="The Golden Frame" className="h-9 w-9 rounded-xl object-contain" />
            <div>
              <p className="font-bold text-foreground leading-none">The Golden Frame</p>
            </div>
          </div>

          {/* Navigation */}
          <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-1">
            {filtered.map((item) => {
              const active = pathname === item.path || (item.path !== '/' && pathname.startsWith(item.path));
              return (
                <Link key={item.path} to={item.path} onClick={handleItemClick}
                  className={cn('flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200', active ? 'gradient-brand text-white shadow-lg shadow-blue-500/20' : 'text-muted-foreground hover:text-foreground hover:bg-accent')}
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
            <button onClick={() => logout()} className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-sm text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors">
              <span>🚪</span> Sign out
            </button>
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
};
