import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

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

export const TABLE_TYPE_LABELS: Record<string, string> = { pool: 'Pool', snooker: 'Snooker', ps5: 'PS5' };
export const TABLE_TYPE_COLORS: Record<string, string> = { pool: 'bg-blue-500', snooker: 'bg-green-500', ps5: 'bg-purple-500' };
export const STATUS_COLORS: Record<string, string> = {
  available: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  running: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  reserved: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  maintenance: 'bg-red-500/20 text-red-400 border-red-500/30',
  paused: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
};
