import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Navbar } from './Navbar';
import { BottomNav } from './BottomNav';
import { useAppStore } from '@/store';
import { cn } from '@/utils';
import { useIdleTimer } from '@/hooks/useIdleTimer';

export const AppLayout = () => {
  const { sidebarOpen, setSidebarOpen } = useAppStore();
  useIdleTimer();

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Sidebar — fixed on mobile (overlay), static on desktop */}
      <Sidebar />

      {/* Mobile backdrop — tap to close sidebar */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-20 bg-black/50 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Main content — full width on mobile, always shifted on desktop */}
      <div className={cn(
        'flex-1 flex flex-col overflow-hidden transition-all duration-300',
        'w-full',                      // full width on mobile
        'lg:ml-64',                   // always shifted on desktop (sidebar is static)
      )}>
        <Navbar />
        <main className="flex-1 overflow-y-auto p-3 sm:p-4 md:p-6 pb-20 lg:pb-6">
          <Outlet />
        </main>
      </div>
      <BottomNav />
    </div>
  );
};
