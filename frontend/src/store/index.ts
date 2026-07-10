import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { User } from '@/types';
import { authService } from '@/services';

interface AuthState {
  user: User | null;
  accessToken: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  silentLogout: () => void;
  setUser: (user: User) => void;
  setToken: (token: string) => void;
  fetchMe: () => Promise<void>;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      accessToken: null,
      isAuthenticated: false,
      isLoading: false,

      login: async (email, password) => {
        set({ isLoading: true });
        try {
          const res = await authService.login(email, password);
          const { user, accessToken } = res.data.data;
          localStorage.setItem('accessToken', accessToken);
          set({ user, accessToken, isAuthenticated: true });
        } catch (error: any) {
          throw error;
        } finally {
          set({ isLoading: false });
        }
      },

      logout: async () => {
        try { await authService.logout(); } catch { /* ignore */ }
        localStorage.removeItem('accessToken');
        set({ user: null, accessToken: null, isAuthenticated: false, isLoading: false });
      },

      silentLogout: () => {
        localStorage.removeItem('accessToken');
        set({ user: null, accessToken: null, isAuthenticated: false, isLoading: false });
      },

      setUser: (user) => set({ user }),
      setToken: (token) => set({ accessToken: token }),

      fetchMe: async () => {
        set({ isLoading: true });
        try {
          const res = await authService.getMe();
          set({ user: res.data.data.user, isAuthenticated: true });
        } catch {
          set({ user: null, isAuthenticated: false });
        } finally {
          set({ isLoading: false });
        }
      },
    }),
    {
      name: 'thegoldenframe-auth',
      partialize: (state) => ({ user: state.user, accessToken: state.accessToken, isAuthenticated: state.isAuthenticated }),
    }
  )
);

if (typeof window !== 'undefined' && !(window as any).__authLogoutListenerInstalled) {
  (window as any).__authLogoutListenerInstalled = true;
  window.addEventListener('auth:logout', () => {
    useAuthStore.getState().silentLogout();
  });
}

// Global app store for branch selection & theme
interface AppState {
  selectedBranch: string | null;
  isDarkMode: boolean;
  sidebarOpen: boolean;
  setSelectedBranch: (id: string | null) => void;
  toggleDarkMode: () => void;
  toggleSidebar: () => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      selectedBranch: null,
      isDarkMode: true,
      sidebarOpen: true,
      setSelectedBranch: (id) => set({ selectedBranch: id }),
      toggleDarkMode: () => set((s) => ({ isDarkMode: !s.isDarkMode })),
      toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
    }),
    { name: 'thegoldenframe-app', partialize: (s) => ({ selectedBranch: s.selectedBranch, isDarkMode: s.isDarkMode }) }
  )
);
