import { Link, useLocation } from 'react-router-dom';
import { cn } from '@/utils';
import { useAuthStore } from '@/store';
import { hasPermission } from '@/utils';

const BOTTOM_NAV_ITEMS = [
  { path: '/tables', label: 'Tables', icon: '🎱', permission: 'tables:view' },
  { path: '/reservations', label: 'Bookings', icon: '🗓️', permission: 'bookings:manage' },
  { path: '/customers', label: 'Customers', icon: '👥', permission: 'customers:view' },
  { path: '/billing', label: 'Billing', icon: '🧾', permission: 'billing:manage' },
  { path: '/pending-payments', label: 'Pending', icon: '💳', permission: 'customers:view' },
];

export const BottomNav = () => {
  const { pathname } = useLocation();
  const { user } = useAuthStore();

  const visibleItems = BOTTOM_NAV_ITEMS.filter(item =>
    hasPermission(user, item.permission)
  );

  return (
    <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-20 bg-card border-t border-border safe-area-pb">
      <div className="flex items-stretch">
        {visibleItems.map((item) => {
          const isActive = pathname === item.path || pathname.startsWith(item.path + '/');
          return (
            <Link
              key={item.path}
              to={item.path}
              className={cn(
                'flex-1 flex flex-col items-center justify-center py-2 gap-0.5 min-h-[56px]',
                'text-muted-foreground transition-colors',
                isActive && 'text-primary bg-primary/5',
              )}
            >
              <span className="text-lg leading-none">{item.icon}</span>
              <span className="text-[10px] font-medium leading-none">{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
};
