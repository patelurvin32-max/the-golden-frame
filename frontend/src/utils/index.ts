import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import type { User } from '@/types';
import { API_BASE_URL } from '@/services/api';

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));

export const formatCurrency = (amount: number, symbol = '₹') =>
  `${symbol}${amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const parseCurrencyValue = (value: string) => {
  if (typeof value !== 'string') return NaN;
  const normalized = value.trim();
  if (normalized === '') return NaN;
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return NaN;
  // Return exact value without any rounding - preserve user input
  return Number(normalized);
};

export const formatDate = (date: string | Date, format?: string) => {
  const d = new Date(date);
  if (format === 'MMM dd, yyyy HH:mm') {
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) + 
           ' ' + d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });
  }
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
};

export const formatTime = (date: string | Date) =>
  new Date(date).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });

export const formatDateTime = (date: string | Date) => `${formatDate(date)} ${formatTime(date)}`;

export const formatDuration = (minutes: number) => {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
};

export const getElapsedMinutes = (startTime: string, pauses: { pausedAt: string; resumedAt?: string }[]) => {
  const now = Date.now();
  let totalMs = now - new Date(startTime).getTime();
  for (const p of pauses) {
    const pauseEnd = p.resumedAt ? new Date(p.resumedAt).getTime() : now;
    totalMs -= pauseEnd - new Date(p.pausedAt).getTime();
  }
  return Math.max(0, Math.floor(totalMs / 60000));
};

export const getRunningAmount = (minutes: number, hourlyRate: number) =>
  (minutes / 60) * hourlyRate;

export const downloadBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
};

export const resolveApiUrl = (url?: string) => {
  if (!url) return '';
  if (/^(https?:|data:|blob:)/i.test(url)) return url;

  if (url.startsWith('/api/')) {
    try {
      return new URL(url, API_BASE_URL).toString();
    } catch {
      return url;
    }
  }

  return url;
};

export const getCategoryColor = (name: string) => {
  if (!name) return 'bg-slate-500';
  const colors = [
    'bg-blue-500', 'bg-emerald-500', 'bg-purple-500', 
    'bg-amber-500', 'bg-pink-500', 'bg-indigo-500', 
    'bg-teal-500', 'bg-cyan-500', 'bg-orange-500'
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const idx = Math.abs(hash) % colors.length;
  return colors[idx];
};

export const STATUS_COLORS: Record<string, string> = {
  available: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  running: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  reserved: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  maintenance: 'bg-red-500/20 text-red-400 border-red-500/30',
  paused: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
};

export function hasPermission(user: User | null, permission: string): boolean {
  if (!user) return false;
  if (user.role === 'super_admin' || user.role === 'admin') return true;
  if (user.role === 'branch_admin') {
    return user.permissions?.includes(permission) || false;
  }
  
  const staticPermissions: Record<string, string[]> = {
    branch_manager: [
      'dashboard:view',
      'tables:view',
      'tables:operate',
      'billing:manage',
      'customers:manage',
      'customers:create',
      'customers:view',
      'inventory:manage',
      'expenses:manage',
      'attendance:manage',
      'reports:view',
      'menu:manage',
      'menu:view',
      'bookings:manage',
      'staff:view',
      'staff:manage',
    ],
    staff: [
      'tables:view',
      'tables:operate',
      'billing:manage',
      'customers:view',
      'customers:create',
      'customers:manage',
      'menu:view',
      'bookings:manage',
    ],
    cashier: [
      'tables:view',
      'billing:manage',
      'customers:create',
      'customers:manage',
    ]
  };

  return staticPermissions[user.role]?.includes(permission) || false;
}

export function getPostLoginRoute(user: User): string {
  if (user.role === 'super_admin' || user.role === 'admin' || user.role === 'branch_manager') {
    return '/';
  }

  if (hasPermission(user, 'dashboard:view')) {
    return '/';
  }

  const preferredRoutes = [
    { path: '/tables', permission: 'tables:view' },
    { path: '/customers', permission: 'customers:view' },
    { path: '/reservations', permission: 'bookings:manage' },
    { path: '/billing', permission: 'billing:manage' },
    { path: '/pending-payments', permission: 'customers:view' },
    { path: '/my-attendance', permission: null },
    { path: '/notifications', permission: null },
  ];

  const landing = preferredRoutes.find((route) => !route.permission || hasPermission(user, route.permission));
  return landing?.path || '/';
}
