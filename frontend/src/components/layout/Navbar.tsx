import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAppStore, useAuthStore } from '@/store';
import { branchService, notificationService } from '@/services';
import type { Branch, Notification } from '@/types';
import { Button, Select } from '@/components/ui';
import { formatDateTime } from '@/utils';
import { useSocket } from '@/hooks/useSocket';

export const Navbar = () => {
  const { toggleSidebar, toggleDarkMode, isDarkMode, selectedBranch, setSelectedBranch } = useAppStore();
  const { user } = useAuthStore();
  const [showNotif, setShowNotif] = useState(false);
  const queryClient = useQueryClient();
  const { onNotification } = useSocket();

  // Listen for real-time notifications via Socket.IO
  useEffect(() => {
    const cleanup = onNotification(() => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    });
    return cleanup;
  }, [onNotification, queryClient]);

  const markAllReadMutation = useMutation({
    mutationFn: () => notificationService.markAllRead(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  const { data: branches = [] } = useQuery({
    queryKey: ['branches'],
    queryFn: () => branchService.getAll().then((r) => r.data.data.branches),
    enabled: Boolean(user),
  });

  const { data: notifData } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => notificationService.getAll().then((r) => r.data as any),
    enabled: Boolean(user),
    refetchInterval: 300000,
  });

  const notifications: Notification[] = notifData?.data?.notifications || [];
  const unread = notifications.filter((n) => !n.isRead).length;

  const assignedBranchId = user?.branches?.[0]
    ? typeof user.branches[0] === 'string'
      ? user.branches[0]
      : (user.branches[0] as any)._id
    : '';

  const assignedBranchName =
    (typeof user?.branches?.[0] === 'object' && (user.branches[0] as any)?.name)
      ? (user.branches[0] as any).name
      : branches.find((b: Branch) => b._id === assignedBranchId || b.code === assignedBranchId)?.name || '';

  return (
    <header className="h-14 border-b border-border bg-card flex items-center px-4 gap-4 relative z-40">
      {/* Sidebar toggle */}
      <button onClick={toggleSidebar} className="h-8 w-8 rounded-lg hover:bg-accent flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors">
        ☰
      </button>

      {/* Branch selector for super_admin and admin */}
      {(user?.role === 'super_admin' || user?.role === 'admin') && Array.isArray(branches) && branches.length > 0 && (
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

      {/* Branch display badge for manager / staff / branch admin */}
      {(user?.role !== 'super_admin' && user?.role !== 'admin') && (
        <span className="text-sm font-semibold text-foreground flex items-center gap-1.5 px-3 py-1 bg-accent/40 rounded-lg border border-border">
          🏢 {assignedBranchName || 'Branch'}
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
            <div className="fixed inset-0 z-40 bg-black/10" onClick={() => setShowNotif(false)} />
            <div className="absolute right-0 top-full mt-2 z-50 w-80 sm:w-96 max-w-[calc(100vw-2rem)] rounded-2xl border border-border bg-card shadow-2xl overflow-hidden">
              <div className="border-b border-border p-4 flex items-center justify-between bg-card">
                <p className="font-semibold text-sm text-foreground">Notifications</p>
                {unread > 0 && (
                  <button
                    onClick={() => markAllReadMutation.mutate()}
                    className="text-xs text-primary font-medium hover:underline"
                  >
                    Mark all as read
                  </button>
                )}
              </div>
              <div className="max-h-[70vh] sm:max-h-96 overflow-y-auto divide-y divide-border bg-card">
                {notifications.length === 0 ? (
                  <p className="p-8 text-center text-sm text-muted-foreground">No notifications</p>
                ) : (
                  notifications.slice(0, 3).map((n: any) => (
                    <div key={n._id} className={`p-4 transition-colors hover:bg-accent/40 ${!n.isRead ? 'bg-primary/10' : 'bg-card'}`}>
                      <div className="flex items-start gap-2.5">
                        {!n.isRead && <span className="h-2 w-2 rounded-full bg-primary mt-1.5 flex-shrink-0" />}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-foreground leading-tight break-words">{n.title}</p>
                          <p className="text-xs text-muted-foreground mt-1 break-words leading-relaxed">{n.message}</p>
                          <p className="text-[11px] text-muted-foreground/70 mt-1.5 font-medium">{formatDateTime(n.createdAt)}</p>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
              {notifications.length > 0 && (
                <div className="border-t border-border p-3 bg-card text-center">
                  <Link to="/notifications" onClick={() => setShowNotif(false)} className="inline-block w-full text-xs font-medium text-muted-foreground hover:text-primary transition-colors">
                    See More Notifications →
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
