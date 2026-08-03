import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { User } from '@/types';
import { authService } from '@/services';

interface AuthState {
  user: User | null;
  accessToken: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<{ user: User; accessToken: string }>;
  logout: () => Promise<void>;
  silentLogout: () => void;
  setUser: (user: User) => void;
  setToken: (token: string) => void;
  fetchMe: () => Promise<void>;
}

let pendingLogin: Promise<{ user: User; accessToken: string }> | null = null;

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      accessToken: null,
      isAuthenticated: false,
      isLoading: false,

      login: async (email, password) => {
        if (pendingLogin) return pendingLogin;

        set({ isLoading: true });
        pendingLogin = (async () => {
          const res = await authService.login(email, password);
          if (res.status !== 200 || !res.data?.success) {
            const message = res.data?.message || 'Incorrect email or password';
            const error = Object.assign(new Error(message), {
              response: {
                status: res.status,
                data: { message },
              },
            });
            throw error;
          }
          const { user, accessToken } = res.data.data;
          localStorage.setItem('accessToken', accessToken);
          set({ user, accessToken, isAuthenticated: true });

          // Auto-set selectedBranch for non-super admin and non-admin users
          if (user.role !== 'super_admin' && user.role !== 'admin' && user.branches && user.branches.length > 0) {
            const defaultBranchId = typeof user.branches[0] === 'string' ? user.branches[0] : (user.branches[0] as any)._id;
            if (defaultBranchId) {
              useAppStore.getState().setSelectedBranch(defaultBranchId);
            }
          } else {
            useAppStore.getState().setSelectedBranch(null);
          }

          return { user, accessToken };
        })();

        try {
          return await pendingLogin;
        } finally {
          pendingLogin = null;
          set({ isLoading: false });
        }
      },

      logout: async () => {
        try { await authService.logout(); } catch { /* ignore */ }
        localStorage.removeItem('accessToken');
        useAppStore.getState().setSelectedBranch(null);
        set({ user: null, accessToken: null, isAuthenticated: false, isLoading: false });
      },

      silentLogout: () => {
        localStorage.removeItem('accessToken');
        useAppStore.getState().setSelectedBranch(null);
        set({ user: null, accessToken: null, isAuthenticated: false, isLoading: false });
      },

      setUser: (user) => set({ user }),
      setToken: (token) => set({ accessToken: token }),

      fetchMe: async () => {
        const currentUser = get().user;
        if (!currentUser) {
          set({ isLoading: true });
        }
        try {
          const res = await authService.getMe();
          const u = res.data.data.user;
          set({ user: u, isAuthenticated: true });
          if (u && u.role !== 'super_admin' && u.role !== 'admin' && u.branches && u.branches.length > 0) {
            const defaultBranchId = typeof u.branches[0] === 'string' ? u.branches[0] : (u.branches[0] as any)._id;
            if (defaultBranchId) {
              useAppStore.getState().setSelectedBranch(defaultBranchId);
            }
          }
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
  masterMenuOpen: boolean;
  setSelectedBranch: (id: string | null) => void;
  toggleDarkMode: () => void;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  toggleMasterMenu: () => void;
  setMasterMenuOpen: (open: boolean) => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      selectedBranch: null,
      isDarkMode: true,
      sidebarOpen: true,
      masterMenuOpen: false,
      setSelectedBranch: (id) => set({ selectedBranch: id }),
      toggleDarkMode: () => set((s) => ({ isDarkMode: !s.isDarkMode })),
      toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
      setSidebarOpen: (open) => set({ sidebarOpen: open }),
      toggleMasterMenu: () => set((s) => ({ masterMenuOpen: !s.masterMenuOpen })),
      setMasterMenuOpen: (open) => set({ masterMenuOpen: open }),
    }),
    { name: 'thegoldenframe-app', partialize: (s) => ({ selectedBranch: s.selectedBranch, isDarkMode: s.isDarkMode }) }
  )
);
