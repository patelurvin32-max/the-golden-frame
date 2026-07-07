import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Navbar } from './Navbar';
import { useAppStore } from '@/store';
import { cn } from '@/utils';

export const AppLayout = () => {
  const { sidebarOpen } = useAppStore();
  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar />
      <div className={cn('flex-1 flex flex-col overflow-hidden transition-all duration-300', sidebarOpen ? 'ml-64' : 'ml-0')}>
        <Navbar />
        <main className="flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
};
