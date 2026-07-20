import * as React from 'react';
import { cn } from '@/utils';
import { motion } from 'framer-motion';

// ── Button ────────────────────────────────────────────────────────────────────
interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'outline' | 'ghost' | 'destructive' | 'success';
  size?: 'sm' | 'md' | 'lg' | 'icon';
  loading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'default', size = 'md', loading, children, disabled, ...props }, ref) => {
    const variants = {
      default: 'gradient-brand text-white hover:opacity-90 shadow-lg shadow-blue-500/25',
      outline: 'border border-border bg-transparent hover:bg-accent text-foreground',
      ghost: 'hover:bg-accent text-foreground',
      destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
      success: 'bg-emerald-600 text-white hover:bg-emerald-700',
    };
    const sizes = {
      sm: 'h-8 px-3 text-xs rounded-lg',
      md: 'h-9 px-4 text-sm rounded-xl',
      lg: 'h-11 px-6 text-base rounded-xl',
      icon: 'h-9 w-9 rounded-xl',
    };
    return (
      <button
        ref={ref}
        className={cn('inline-flex items-center justify-center gap-2 font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 disabled:pointer-events-none', variants[variant], sizes[size], className)}
        disabled={disabled || loading}
        {...props}
      >
        {loading && <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />}
        {children}
      </button>
    );
  }
);
Button.displayName = 'Button';

// ── Card ──────────────────────────────────────────────────────────────────────
export const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('rounded-2xl border border-border bg-card text-card-foreground shadow-sm', className)} {...props} />
  )
);
Card.displayName = 'Card';

export const CardHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('flex flex-col space-y-1.5 p-6', className)} {...props} />
);
export const CardTitle = ({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) => (
  <h3 className={cn('text-lg font-semibold leading-none tracking-tight', className)} {...props} />
);
export const CardContent = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('p-6 pt-0', className)} {...props} />
);

// ── Badge ─────────────────────────────────────────────────────────────────────
interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: 'default' | 'success' | 'warning' | 'danger' | 'info' | 'outline';
}
export const Badge = ({ className, variant = 'default', ...props }: BadgeProps) => {
  const variants = {
    default: 'bg-primary/10 text-primary border border-primary/20',
    success: 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20',
    warning: 'bg-amber-500/10 text-amber-400 border border-amber-500/20',
    danger: 'bg-red-500/10 text-red-400 border border-red-500/20',
    info: 'bg-sky-500/10 text-sky-400 border border-sky-500/20',
    outline: 'border border-border text-muted-foreground',
  };
  return <span className={cn('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold', variants[variant], className)} {...props} />;
};

// ── Input ─────────────────────────────────────────────────────────────────────
export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => (
    <input
      ref={ref}
      type={type}
      className={cn(
        'flex h-9 w-full rounded-xl border border-input bg-background px-3 py-1 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 transition-colors',
        type === 'datetime-local' && 'pr-20 rounded-r-none overflow-visible',
        className
      )}
      style={type === 'date' ? { colorScheme: 'light' } : undefined}
      {...props}
    />
  )
);
Input.displayName = 'Input';

// ── Select ────────────────────────────────────────────────────────────────────
export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, children, ...props }, ref) => (
    <select
      ref={ref}
      className={cn('flex h-9 w-full rounded-xl border border-input bg-background px-3 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 transition-colors', className)}
      {...props}
    >
      {children}
    </select>
  )
);
Select.displayName = 'Select';

// ── Label ─────────────────────────────────────────────────────────────────────
export const Label = ({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) => (
  <label className={cn('text-sm font-medium text-foreground leading-none', className)} {...props} />
);

// ── Skeleton ──────────────────────────────────────────────────────────────────
export const Skeleton = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('animate-pulse rounded-xl bg-muted', className)} {...props} />
);

// ── Stat Card (dashboard metric) ──────────────────────────────────────────────
interface StatCardProps { title: string; value: string | number; icon: React.ReactNode; trend?: string; trendUp?: boolean; color?: string; className?: string; }
export const StatCard = ({ title, value, icon, trend, trendUp, color = 'from-blue-500/20 to-blue-600/5', className }: StatCardProps) => (
  <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
    <Card className={cn('overflow-hidden', className)}>
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{title}</p>
            <p className="text-2xl font-bold tracking-tight">{value}</p>
            {trend && (
              <p className={cn('text-xs font-medium flex items-center gap-1', trendUp ? 'text-emerald-400' : 'text-red-400')}>
                {trendUp ? '↑' : '↓'} {trend}
              </p>
            )}
          </div>
          <div className={cn('h-12 w-12 rounded-2xl flex items-center justify-center bg-gradient-to-br', color)}>
            {icon}
          </div>
        </div>
      </CardContent>
    </Card>
  </motion.div>
);

// ── Modal / Dialog ────────────────────────────────────────────────────────────
interface ModalProps { open: boolean; onClose: () => void; title?: string; children: React.ReactNode; size?: 'sm' | 'md' | 'lg' | 'xl'; }
export const Modal = ({ open, onClose, title, children, size = 'md' }: ModalProps) => {
  if (!open) return null;
  const sizes = { sm: 'max-w-sm', md: 'max-w-md', lg: 'max-w-lg', xl: 'max-w-2xl' };
  const responsiveSizes = { sm: 'w-full max-w-sm sm:max-w-sm', md: 'w-full max-w-md sm:max-w-md', lg: 'w-full max-w-lg sm:max-w-lg', xl: 'w-full max-w-full sm:max-w-2xl' };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <motion.div 
        initial={{ opacity: 0, scale: 0.95, y: 10 }} 
        animate={{ opacity: 1, scale: 1, y: 0 }} 
        className={cn('relative max-h-[90vh] flex flex-col rounded-2xl border border-border bg-card shadow-2xl', responsiveSizes[size])}
      >
        {title && (
          <div className="flex items-center justify-between border-b border-border p-4 sm:p-5 flex-shrink-0">
            <h2 className="text-base sm:text-lg font-semibold">{title}</h2>
            <button onClick={onClose} className="h-8 w-8 rounded-lg hover:bg-accent flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors flex-shrink-0">✕</button>
          </div>
        )}
        <div className="p-4 sm:p-5 overflow-y-auto flex-1">{children}</div>
      </motion.div>
    </div>
  );
};

// ── Empty State ───────────────────────────────────────────────────────────────
interface EmptyStateProps { icon: React.ReactNode; title: string; description?: string; action?: React.ReactNode; }
export const EmptyState = ({ icon, title, description, action }: EmptyStateProps) => (
  <div className="flex flex-col items-center justify-center py-16 text-center space-y-4">
    <div className="h-16 w-16 rounded-2xl bg-muted flex items-center justify-center text-muted-foreground">{icon}</div>
    <div>
      <p className="font-semibold text-foreground">{title}</p>
      {description && <p className="text-sm text-muted-foreground mt-1">{description}</p>}
    </div>
    {action}
  </div>
);

// ── Table ─────────────────────────────────────────────────────────────────────
export const Table2 = ({ className, ...props }: React.HTMLAttributes<HTMLTableElement>) => (
  <div className="relative w-full overflow-auto">
    <table className={cn('w-full caption-bottom text-sm', className)} {...props} />
  </div>
);
export const TableHeader = ({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) => (
  <thead className={cn('[&_tr]:border-b border-border', className)} {...props} />
);
export const TableBody = ({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) => (
  <tbody className={cn('[&_tr:last-child]:border-0 [&_tr]:hover:bg-muted/30 [&_tr]:transition-colors', className)} {...props} />
);
export const TableRow = ({ className, ...props }: React.HTMLAttributes<HTMLTableRowElement>) => (
  <tr className={cn('border-b border-border transition-colors', className)} {...props} />
);
export const TableHead = ({ className, ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) => (
  <th className={cn('h-10 px-4 text-left align-middle font-medium text-muted-foreground text-xs uppercase tracking-wider', className)} {...props} />
);
export const TableCell = ({ className, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) => (
  <td className={cn('p-4 align-middle', className)} {...props} />
);

// ── Page Header ───────────────────────────────────────────────────────────────
interface PageHeaderProps { title: string; subtitle?: string; actions?: React.ReactNode; }
export const PageHeader = ({ title, subtitle, actions }: PageHeaderProps) => (
  <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-6">
    <div>
      <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
      {subtitle && <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>}
    </div>
    {actions && <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">{actions}</div>}
  </div>
);

// ── Loading spinner ───────────────────────────────────────────────────────────
export const Spinner = ({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) => {
  const s = { sm: 'h-4 w-4', md: 'h-6 w-6', lg: 'h-8 w-8' };
  return <div className={cn('animate-spin rounded-full border-2 border-primary border-t-transparent', s[size])} />;
};

export const LoadingPage = () => (
  <div className="flex h-full items-center justify-center">
    <div className="flex flex-col items-center gap-3">
      <Spinner size="lg" />
      <p className="text-sm text-muted-foreground">Loading...</p>
    </div>
  </div>
);

// ── Toast (simple) ────────────────────────────────────────────────────────────
interface ToastProps { message: string; type?: 'success' | 'error' | 'info'; }
export const useToast = () => {
  const show = (message: string, type: 'success' | 'error' | 'info' = 'info') => {
    const el = document.createElement('div');
    const colors = { success: 'bg-emerald-600', error: 'bg-red-600', info: 'bg-blue-600' };
    el.className = `fixed bottom-4 right-4 z-[9999] px-4 py-3 rounded-xl text-white text-sm font-medium shadow-lg ${colors[type]} animate-slide-up`;
    el.textContent = message;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3500);
  };
  return { success: (m: string) => show(m, 'success'), error: (m: string) => show(m, 'error'), info: (m: string) => show(m, 'info') };
};

// ── Confirm Dialog ────────────────────────────────────────────────────────────
interface ConfirmDialogProps { open: boolean; onClose: () => void; onConfirm: () => void; title: string; description?: string; confirmText?: string; cancelText?: string; }
export const ConfirmDialog = ({ open, onClose, onConfirm, title, description, confirmText = 'Confirm', cancelText = 'Cancel' }: ConfirmDialogProps) => {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <motion.div initial={{ opacity: 0, scale: 0.95, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} className="relative w-full max-w-md rounded-2xl border border-border bg-card shadow-2xl p-6">
        <h2 className="text-lg font-semibold mb-2">{title}</h2>
        {description && <p className="text-sm text-muted-foreground mb-6">{description}</p>}
        <div className="flex gap-3 justify-end">
          <Button variant="outline" onClick={onClose}>{cancelText}</Button>
          <Button variant="destructive" onClick={onConfirm}>{confirmText}</Button>
        </div>
      </motion.div>
    </div>
  );
};
