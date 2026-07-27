import { useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { AppRoutes } from '@/routes';
import { api } from '@/services/api';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 2 * 60_000,    // 2 minutes (was 60s) — halves background refetch traffic
      gcTime: 10 * 60_000,      // 10 minutes (was 5min) — keep cache longer
      retry: (failureCount, error: unknown) => {
        const status = (error as { response?: { status?: number } })?.response?.status;
        if (status === 401) return false;
        return failureCount < 1;
      },
      refetchOnWindowFocus: false,
    },
  },
});

export default function App() {
  // Bootstrap CSRF token on app load — the response interceptor in api.ts
  // captures the X-CSRF-Token header automatically from the health response.
  useEffect(() => {
    api.get('/health').catch(() => {
      // Silent — if health check fails, CSRF token will be captured on first real API call
    });
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <AppRoutes />
      </BrowserRouter>
    </QueryClientProvider>
  );
}
