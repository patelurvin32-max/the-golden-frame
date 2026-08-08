import { useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Navbar } from './Navbar';
import { BottomNav } from './BottomNav';
import { useAppStore } from '@/store';
import { cn } from '@/utils';
import { useIdleTimer } from '@/hooks/useIdleTimer';

export const AppLayout = () => {
  const { sidebarOpen, setSidebarOpen } = useAppStore();
  const { pathname } = useLocation();
  useIdleTimer();

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const syncSidebarState = () => {
      setSidebarOpen(!window.matchMedia('(max-width: 1024px)').matches);
    };

    syncSidebarState();
    window.addEventListener('resize', syncSidebarState);

    return () => window.removeEventListener('resize', syncSidebarState);
  }, [setSidebarOpen]);

  useEffect(() => {
    if (typeof window !== 'undefined' && window.matchMedia('(max-width: 1024px)').matches) {
      setSidebarOpen(false);
    }
  }, [pathname, setSidebarOpen]);

  return (
    <div className="flex h-screen min-w-0 overflow-hidden bg-background">
      <Sidebar />

      {sidebarOpen && (
        <div
          className="fixed inset-0 z-20 bg-black/50 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <div className={cn(
        'flex-1 min-w-0 flex flex-col overflow-hidden transition-all duration-300',
        'w-full',
      )}>
        <Navbar />
        <main className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden p-3 sm:p-4 md:p-5 lg:p-6 pb-20 lg:pb-6">
          <Outlet />
        </main>
      </div>

      <BottomNav />
    </div>
  );
};
