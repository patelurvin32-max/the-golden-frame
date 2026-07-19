import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAppStore, useAuthStore } from '@/store';
import { branchService, notificationService } from '@/services';
import type { Branch, Notification } from '@/types';
import { Button, Select } from '@/components/ui';
import { formatDateTime } from '@/utils';

export const Navbar = () => {
  const { toggleSidebar, toggleDarkMode, isDarkMode, selectedBranch, setSelectedBranch } = useAppStore();
  const { user } = useAuthStore();
  const [showNotif, setShowNotif] = useState(false);
  const queryClient = useQueryClient();

  const markAllReadMutation = useMutation({
    mutationFn: () => notificationService.markAllRead(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  const { data: branches = [] } = useQuery({
    queryKey: ['branches'],
    queryFn: () => branchService.getAll().then((r) => r.data.data.branches),
    enabled: user?.role === 'super_admin',
  });

  const { data: notifData } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => notificationService.getAll().then((r) => r.data as any),
    enabled: Boolean(user),
    refetchInterval: 300000,
  });

  const notifications: Notification[] = notifData?.data?.notifications || [];
  const unread = notifications.filter((n) => !n.isRead).length;

  return (
    <header className="h-14 border-b border-border bg-card/80 backdrop-blur-sm flex items-center px-4 gap-4">
      {/* Sidebar toggle */}
      <button onClick={toggleSidebar} className="h-8 w-8 rounded-lg hover:bg-accent flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors">
        ☰
      </button>

      {/* Branch selector (manager/staff restricted to assigned branches) */}
      {user?.role === 'super_admin' && Array.isArray(branches) && branches.length > 0 && (
        <Select
          value={selectedBranch || ''}
          onChange={(e) => setSelectedBranch(e.target.value || null)}
          className="w-40 h-8 text-xs"
        >
          <option value="">All Branches</option>
          {branches.map((b: Branch) => (
            <option key={b._id} value={b._id}>{b.name}</option>
          ))}
        </Select>
      )}

      {user?.role !== 'super_admin' && user?.branches?.[0] && (
        <span className="text-sm font-medium text-muted-foreground">
          🏢 {(user.branches[0] as any)?.name || 'Branch'}
        </span>
      )}

      <div className="flex-1" />

      {/* Theme toggle */}
      <button onClick={toggleDarkMode} className="h-8 w-8 rounded-lg hover:bg-accent flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors">
        {isDarkMode ? '☀️' : '🌙'}
      </button>

      {/* Notifications */}
      <div className="relative">
        <button onClick={() => setShowNotif((s) => !s)} className="h-8 w-8 rounded-lg hover:bg-accent flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors relative">
          🔔
          {unread > 0 && (
            <span className="absolute -top-1 -right-1 h-4 w-4 rounded-full gradient-brand text-white text-[10px] flex items-center justify-center font-bold">
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </button>

        {showNotif && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setShowNotif(false)} />
            <div className="absolute right-0 top-10 z-50 w-80 rounded-2xl border border-border bg-background shadow-2xl">
              <div className="border-b border-border p-4 flex items-center justify-between">
                <p className="font-semibold text-sm">Notifications</p>
                {unread > 0 && (
                  <button
                    onClick={() => markAllReadMutation.mutate()}
                    className="text-xs text-primary font-medium hover:underline"
                  >
                    Mark all as read
                  </button>
                )}
              </div>
              <div className="max-h-80 overflow-y-auto">
                {notifications.length === 0 ? (
                  <p className="p-8 text-center text-sm text-muted-foreground">No notifications</p>
                ) : (
                  notifications.slice(0, 10).map((n) => (
                    <div key={n._id} className={`p-4 border-b border-border last:border-0 ${!n.isRead ? 'bg-primary/5' : ''}`}>
                      <div className="flex items-start gap-2">
                        {!n.isRead && <span className="h-2 w-2 rounded-full bg-primary mt-1.5 flex-shrink-0" />}
                        <div className="flex-1">
                          <p className="text-sm font-medium">{n.title}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">{n.message}</p>
                          <p className="text-xs text-muted-foreground/60 mt-1">{formatDateTime(n.createdAt)}</p>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
              {notifications.length > 0 && (
                <div className="border-t border-border p-3">
                  <Link to="/notifications" onClick={() => setShowNotif(false)} className="block w-full text-xs text-center text-muted-foreground hover:text-foreground transition-colors">
                    See More
                  </Link>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </header>
  );
};
