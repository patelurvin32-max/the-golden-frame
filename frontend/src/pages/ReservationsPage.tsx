import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { reservationService, branchService, tableService, menuService, customerService } from '@/services';
import { useAppStore, useAuthStore } from '@/store';
import { useSocket } from '@/hooks/useSocket';
import {
  Button, Card, CardContent, Input, Label, Select, Badge,
  Modal, PageHeader, Skeleton, EmptyState, useToast,
  Table2, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from '@/components/ui';
import { formatDate, formatDateTime, formatCurrency, cn } from '@/utils';
import PaymentForm from '@/components/PaymentForm';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────
const STATUSES = ['pending','confirmed','seated','completed','cancelled','no_show'] as const;
type ResStatus = typeof STATUSES[number];

const STATUS_CONFIG: Record<ResStatus, { label: string; color: string; icon: string }> = {
  pending:   { label: 'Pending',   color: 'bg-amber-500/15 text-amber-400 border-amber-500/30',   icon: '⏳' },
  confirmed: { label: 'Confirmed', color: 'bg-blue-500/15  text-blue-400  border-blue-500/30',    icon: '✅' },
  seated:    { label: 'Seated',    color: 'bg-purple-500/15 text-purple-400 border-purple-500/30', icon: '🪑' },
  completed: { label: 'Completed', color: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30', icon: '🏁' },
  cancelled: { label: 'Cancelled', color: 'bg-red-500/15   text-red-400   border-red-500/30',     icon: '❌' },
  no_show:   { label: 'No Show',   color: 'bg-slate-500/15  text-slate-400  border-slate-500/30',  icon: '👻' },
};

const EMPTY_FORM = {
  customerName: '', phoneNumber: '', email: '',
  branch: '',
  reservationDate: '', reservationTime: '',
  durationMinutes: 60, numberOfGuests: 2,
  specialRequests: '', notes: '', status: 'pending',
  menuCategoryId: '', menuItemId: '',
  paymentStatus: 'paid',
  paymentMethod: '',
  cashAmount: 0,
  onlineAmount: 0,
  walletAmount: 0,
  amountReceived: '',
  billAmount: 0,
  additionalPlayers: [],
};

function useDelayedFlag(active: boolean, delayMs = 300) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!active) {
      setVisible(false);
      return undefined;
    }

    const timer = window.setTimeout(() => setVisible(true), delayMs);
    return () => window.clearTimeout(timer);
  }, [active, delayMs]);

  return visible;
}

// ─────────────────────────────────────────────────────────────────────────────
// StatusBadge
// ─────────────────────────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: ResStatus }) {
  const c = STATUS_CONFIG[status];
  return (
    <span className={cn('inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border', c.color)}>
      <span>{c.icon}</span>{c.label}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Stat card
// ─────────────────────────────────────────────────────────────────────────────
function StatCard({ label, value, icon, color }: { label: string; value: number; icon: string; color: string }) {
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
      <Card className="overflow-hidden">
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium">{label}</p>
              <p className="text-2xl font-bold mt-1">{value}</p>
            </div>
            <div className={cn('h-11 w-11 rounded-2xl flex items-center justify-center text-xl', color)}>{icon}</div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Pagination controls
// ─────────────────────────────────────────────────────────────────────────────
function Pagination({
  currentPage, totalPages, totalRecords, pageSize,
  onPage, onPageSize,
}: {
  currentPage: number; totalPages: number; totalRecords: number; pageSize: number;
  onPage: (p: number) => void; onPageSize: (s: number) => void;
}) {
  const from = totalRecords === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const to   = Math.min(currentPage * pageSize, totalRecords);

  // Build page number array with ellipsis
  const pages: (number | '...')[] = [];
  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) pages.push(i);
  } else {
    pages.push(1);
    if (currentPage > 3) pages.push('...');
    for (let i = Math.max(2, currentPage - 1); i <= Math.min(totalPages - 1, currentPage + 1); i++) pages.push(i);
    if (currentPage < totalPages - 2) pages.push('...');
    pages.push(totalPages);
  }

  return (
    <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-3 border-t border-border">
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <span>Showing <strong className="text-foreground">{from}–{to}</strong> of <strong className="text-foreground">{totalRecords}</strong> records</span>
        <Select value={String(pageSize)} onChange={(e) => onPageSize(Number(e.target.value))} className="h-8 w-20 text-xs">
          {[5,10,25,50,100].map((n) => <option key={n} value={n}>{n} / page</option>)}
        </Select>
      </div>
      <div className="flex items-center gap-1">
        <button onClick={() => onPage(currentPage - 1)} disabled={currentPage <= 1}
          className="h-8 px-3 rounded-lg border border-border text-xs font-medium disabled:opacity-40 hover:bg-accent transition-colors">
          ← Prev
        </button>
        {pages.map((p, i) =>
          p === '...' ? (
            <span key={`e${i}`} className="h-8 w-8 flex items-center justify-center text-muted-foreground text-xs">…</span>
          ) : (
            <button key={p} onClick={() => onPage(p as number)}
              className={cn('h-8 w-8 rounded-lg border text-xs font-semibold transition-colors',
                p === currentPage ? 'gradient-brand text-white border-transparent' : 'border-border hover:bg-accent'
              )}>
              {p}
            </button>
          )
        )}
        <button onClick={() => onPage(currentPage + 1)} disabled={currentPage >= totalPages}
          className="h-8 px-3 rounded-lg border border-border text-xs font-medium disabled:opacity-40 hover:bg-accent transition-colors">
          Next →
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Reservation Form (create + edit)
// ─────────────────────────────────────────────────────────────────────────────
function ReservationForm({
  initial, onSubmit, onClose, loading,
}: {
  initial: any; onSubmit: (data: any) => void; onClose: () => void; loading: boolean;
}) {
  const initialForm = { ...EMPTY_FORM, ...initial } as any;
  delete initialForm.table;
  const [form, setForm] = useState(initialForm);
  const [phoneError, setPhoneError] = useState('');
  const [validationError, setValidationError] = useState<{ field: string; message: string } | null>(null);
  const qc = useQueryClient();
  const toast = useToast();
  const { selectedBranch } = useAppStore();
  const { user } = useAuthStore();

  // ── Availability state ──────────────────────────────────────────────────
  const [availabilityMap, setAvailabilityMap] = useState<Record<string, { available: boolean; conflictTime?: string; conflictEnd?: string }>>({}); 
  const [isCheckingAvailability, setIsCheckingAvailability] = useState(false);
  const availabilityVersionRef = useRef(0);

  // Compute conflict error for the currently selected menu item
  const conflictError = useMemo(() => {
    if (!form.menuItemId) return '';
    const info = availabilityMap[form.menuItemId];
    if (info && !info.available) {
      const itemName = info.conflictTime ? '' : 'This table';
      // Find item name from availability map context or menu items
      return `Already booked from ${info.conflictTime} to ${info.conflictEnd}. Please select another table or choose a different time.`;
    }
    return '';
  }, [form.menuItemId, availabilityMap]);

  const { data: branches } = useQuery({
    queryKey: ['branches'],
    queryFn: () => branchService.getAll().then((r) => r.data.data.branches),
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
    placeholderData: (prev) => prev,
  });

  // Fetch menu categories
  const { data: categoriesData } = useQuery({
    queryKey: ['menu-categories', 'active'],
    queryFn: () => menuService.getCategories({ activeOnly: 'true' }).then((r) => r.data.data.categories),
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
    placeholderData: (prev) => prev,
  });
  const categories: any[] = categoriesData || [];
  const reservationCategories = useMemo(
    () => categories.filter((cat: any) => {
      const n = cat.name?.trim().toLowerCase();
      return n !== 'beverage' && n !== 'beverages' && n !== 'accessory' && n !== 'accessories';
    }),
    [categories]
  );

  // Fetch menu items filtered by category and branch
  const menuParams: Record<string, string> = { limit: '1000', activeOnly: 'true' };
  if (form.menuCategoryId) menuParams.category = form.menuCategoryId;
  if (form.branch) menuParams.branch = form.branch;

  const { data: menuItemsData, isFetching: isFetchingMenuItems } = useQuery({
    queryKey: ['reservation-menu-items', form.menuCategoryId, form.branch],
    queryFn: () => menuService.getAll(menuParams).then((r) => r.data.data.items),
    enabled: !!form.menuCategoryId,
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
    placeholderData: keepPreviousData,
  });
  const menuItems: any[] = menuItemsData || [];
  const showMenuItemsLoading = useDelayedFlag(isFetchingMenuItems && !!form.menuCategoryId, 300);

  // Determine if user can select branch (Super Admin can, Branch Manager and Staff cannot)
  const canSelectBranch = user?.role === 'super_admin';
  
  // Auto-assign branch for Branch Manager and Staff
  useEffect(() => {
    if (!canSelectBranch && user?.branches?.[0] && !initial._id) {
      setForm((prev: any) => ({ ...prev, branch: user.branches[0]._id || user.branches[0] }));
    }
  }, [canSelectBranch, user, initial._id]);

  const [resWalletBalance, setResWalletBalance] = useState(0);

  // Auto-lookup wallet balance when 10-digit mobile number is entered
  useEffect(() => {
    if (form.phoneNumber && form.phoneNumber.length === 10) {
      const targetBranch = form.branch || selectedBranch || undefined;
      customerService.lookup(form.phoneNumber, targetBranch)
        .then((res) => {
          const customer = res.data.data.customer;
          if (customer) {
            const bal = customer.walletBalance || 0;
            setResWalletBalance(bal);
            setForm((p: any) => ({
              ...p,
              walletBalance: bal,
              ...(!p.customerName && customer.name ? { customerName: customer.name } : {}),
            }));
          } else {
            setResWalletBalance(0);
            setForm((p: any) => ({ ...p, walletBalance: 0 }));
          }
        })
        .catch(() => {
          setResWalletBalance(0);
          setForm((p: any) => ({ ...p, walletBalance: 0 }));
        });
    } else {
      setResWalletBalance(0);
      setForm((p: any) => ({ ...p, walletBalance: 0 }));
    }
  }, [form.phoneNumber, form.branch, selectedBranch]);

  useEffect(() => {
    if (form.menuCategoryId && form.branch) {
      void qc.prefetchQuery({
        queryKey: ['reservation-menu-items', form.menuCategoryId, form.branch],
        queryFn: () => menuService.getAll({ limit: '1000', category: form.menuCategoryId, branch: form.branch, activeOnly: 'true' }).then((r) => r.data.data.items),
        staleTime: 5 * 60 * 1000,
      });
    }
  }, [qc, form.menuCategoryId, form.branch]);

  // ── Debounced availability check ────────────────────────────────────────
  const availabilityKey = useMemo(
    () => `${form.branch}|${form.reservationDate}|${form.reservationTime}|${form.durationMinutes}|${form.menuCategoryId}`,
    [form.branch, form.reservationDate, form.reservationTime, form.durationMinutes, form.menuCategoryId]
  );

  useEffect(() => {
    // Only check when all required fields are present
    if (!form.branch || !form.reservationDate || !form.reservationTime || !form.menuCategoryId) {
      setAvailabilityMap({});
      return;
    }

    const version = ++availabilityVersionRef.current;
    setIsCheckingAvailability(true);

    const timer = setTimeout(() => {
      const params: Record<string, string> = {
        branch: form.branch,
        date: form.reservationDate,
        time: form.reservationTime,
        durationMinutes: String(form.durationMinutes),
        menuCategoryId: form.menuCategoryId,
      };
      if (initial._id) params.excludeId = initial._id;

      reservationService.checkAvailability(params)
        .then((res: any) => {
          // Only apply if this is still the latest request
          if (version !== availabilityVersionRef.current) return;
          const items: any[] = res.data?.data?.items || [];
          const map: Record<string, { available: boolean; conflictTime?: string; conflictEnd?: string }> = {};
          for (const item of items) {
            map[item.menuItemId] = {
              available: item.available,
              ...(item.conflictTime ? { conflictTime: item.conflictTime, conflictEnd: item.conflictEnd } : {}),
            };
          }
          setAvailabilityMap(map);
        })
        .catch(() => {
          if (version === availabilityVersionRef.current) setAvailabilityMap({});
        })
        .finally(() => {
          if (version === availabilityVersionRef.current) setIsCheckingAvailability(false);
        });
    }, 300); // 300ms debounce

    return () => clearTimeout(timer);
  }, [availabilityKey, initial._id]);

  // ── Real-time socket sync for availability ──────────────────────────────
  const { onReservationChange } = useSocket();

  useEffect(() => {
    const cleanup = onReservationChange((data) => {
      // If the changed reservation matches our current form's branch, re-check availability
      const changedBranch = data.reservation?.branch;
      if (changedBranch && changedBranch.toString() === form.branch) {
        // Bump the version to trigger a re-fetch
        availabilityVersionRef.current++;
        const version = availabilityVersionRef.current;

        if (!form.reservationDate || !form.reservationTime || !form.menuCategoryId) return;

        const params: Record<string, string> = {
          branch: form.branch,
          date: form.reservationDate,
          time: form.reservationTime,
          durationMinutes: String(form.durationMinutes),
          menuCategoryId: form.menuCategoryId,
        };
        if (initial._id) params.excludeId = initial._id;

        reservationService.checkAvailability(params)
          .then((res: any) => {
            if (version !== availabilityVersionRef.current) return;
            const items: any[] = res.data?.data?.items || [];
            const map: Record<string, { available: boolean; conflictTime?: string; conflictEnd?: string }> = {};
            for (const item of items) {
              map[item.menuItemId] = {
                available: item.available,
                ...(item.conflictTime ? { conflictTime: item.conflictTime, conflictEnd: item.conflictEnd } : {}),
              };
            }
            setAvailabilityMap(map);
          })
          .catch(() => {});
      }
    });
    return cleanup;
  }, [onReservationChange, form.branch, form.reservationDate, form.reservationTime, form.durationMinutes, form.menuCategoryId, initial._id]);

  const set = (k: string, v: any) => setForm((p: any) => ({ ...p, [k]: v }));

  // Check if the selected item is blocked
  const isSelectedItemBlocked = form.menuItemId && availabilityMap[form.menuItemId] && !availabilityMap[form.menuItemId].available;
  const hasAvailabilityData = Object.keys(availabilityMap).length > 0;

  // Find the selected item name for the conflict message
  const selectedItemName = useMemo(() => {
    if (!form.menuItemId) return '';
    const item = menuItems.find((i: any) => i._id === form.menuItemId);
    return item?.name || '';
  }, [form.menuItemId, menuItems]);

  const conflictMessage = useMemo(() => {
    if (!isSelectedItemBlocked) return '';
    const info = availabilityMap[form.menuItemId];
    return `${selectedItemName || 'This table'} is already booked from ${info.conflictTime} to ${info.conflictEnd}. Please select another table or choose a different time.`;
  }, [isSelectedItemBlocked, availabilityMap, form.menuItemId, selectedItemName]);

  const handleSubmit = () => {
    setValidationError(null);

    // 1. Customer Name *
    if (!form.customerName?.trim()) {
      setValidationError({ field: 'customerName', message: 'Customer Name is required' });
      toast.error('Customer Name is required');
      return;
    }

    // 2. Mobile Number *
    if (!form.phoneNumber?.trim()) {
      setValidationError({ field: 'phoneNumber', message: 'Mobile Number is required' });
      toast.error('Mobile Number is required');
      return;
    }
    if (form.phoneNumber.length < 10) {
      setValidationError({ field: 'phoneNumber', message: 'Mobile number must contain exactly 10 digits.' });
      toast.error('Mobile number must contain exactly 10 digits.');
      return;
    }

    // 3. Branch * (if canSelectBranch)
    if (canSelectBranch && !form.branch) {
      setValidationError({ field: 'branch', message: 'Branch is required' });
      toast.error('Branch is required');
      return;
    }

    // 4. Booking Date *
    if (!form.reservationDate) {
      setValidationError({ field: 'reservationDate', message: 'Booking Date is required' });
      toast.error('Booking Date is required');
      return;
    }

    // 5. Booking Time *
    if (!form.reservationTime) {
      setValidationError({ field: 'reservationTime', message: 'Booking Time is required' });
      toast.error('Booking Time is required');
      return;
    }

    // 6. Booking Category / Menu Category *
    if (!form.menuCategoryId) {
      setValidationError({ field: 'menuCategoryId', message: 'Booking Category is required' });
      toast.error('Booking Category is required');
      return;
    }

    // 7. Booking Item / Menu Item *
    if (!form.menuItemId) {
      setValidationError({ field: 'menuItemId', message: 'Booking Item / Table is required' });
      toast.error('Booking Item / Table is required');
      return;
    }

    if (isSelectedItemBlocked) {
      setValidationError({ field: 'menuItemId', message: conflictMessage || 'Selected table/item is already booked for this time.' });
      toast.error(conflictMessage || 'Selected table/item is already booked for this time.');
      return;
    }

    // 8. Number of Guests *
    if (!form.numberOfGuests || Number(form.numberOfGuests) <= 0) {
      setValidationError({ field: 'numberOfGuests', message: 'Number of Guests is required' });
      toast.error('Number of Guests is required');
      return;
    }

    // 9. Payment Details
    if (!form.paymentStatus) {
      setValidationError({ field: 'paymentStatus', message: 'Payment Status is required' });
      toast.error('Payment Status is required');
      return;
    }
    if ((form.paymentStatus === 'paid' || form.paymentStatus === 'partial') && !form.paymentMethod) {
      setValidationError({ field: 'paymentMethod', message: 'Payment Method is required' });
      toast.error('Payment Method is required');
      return;
    }

    onSubmit(form);
  };

  return (
    <div className="space-y-4 max-h-[75vh] overflow-y-auto pr-1">
      {/* Customer */}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>Name *</Label>
          <Input
            value={form.customerName}
            onChange={(e) => {
              set('customerName', e.target.value);
              if (validationError?.field === 'customerName') setValidationError(null);
            }}
            placeholder="Full name"
          />
          {validationError?.field === 'customerName' && (
            <p className="text-xs text-red-400 mt-0.5">{validationError.message}</p>
          )}
        </div>
        <div className="space-y-1.5">
          <Label>Mobile Number *</Label>
          <Input 
            value={form.phoneNumber} 
            onChange={(e) => {
              const numericPhone = e.target.value.replace(/\D/g, '').slice(0, 10);
              set('phoneNumber', numericPhone);
              if (validationError?.field === 'phoneNumber') setValidationError(null);
              if (numericPhone.length > 0 && numericPhone.length < 10) {
                setPhoneError('Mobile number must contain exactly 10 digits.');
              } else {
                setPhoneError('');
              }
            }}
            placeholder="10-digit mobile number"
            maxLength={10}
          />
          {validationError?.field === 'phoneNumber' ? (
            <p className="text-xs text-red-400 mt-0.5">{validationError.message}</p>
          ) : phoneError ? (
            <p className="text-xs text-red-400 mt-0.5">{phoneError}</p>
          ) : null}
          {form.phoneNumber && form.phoneNumber.length === 10 && !phoneError && !validationError && (
            <p className="text-xs font-semibold text-emerald-400 mt-1">
              Available Wallet Balance: {formatCurrency(resWalletBalance)}
            </p>
          )}
        </div>
      </div>
      <div className="space-y-1.5">
        <Label>Email (optional)</Label>
        <Input type="email" value={form.email} onChange={(e) => set('email', e.target.value)} placeholder="customer@email.com" />
      </div>

      {/* Branch */}
      {canSelectBranch && (
        <div className="space-y-1.5">
          <Label>Branch *</Label>
          <Select
            value={form.branch}
            onChange={(e) => {
              set('branch', e.target.value);
              if (validationError?.field === 'branch') setValidationError(null);
            }}
          >
            <option value="">Select branch</option>
            {(branches || []).map((b: any) => <option key={b._id} value={b._id}>{b.name}</option>)}
          </Select>
          {validationError?.field === 'branch' && (
            <p className="text-xs text-red-400 mt-0.5">{validationError.message}</p>
          )}
        </div>
      )}

      {/* Date & Time */}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>Bookings  Date *</Label>
          <Input
            type="date"
            value={form.reservationDate}
            min={new Date().toISOString().slice(0,10)}
            onChange={(e) => {
              set('reservationDate', e.target.value);
              if (validationError?.field === 'reservationDate') setValidationError(null);
            }}
          />
          {validationError?.field === 'reservationDate' && (
            <p className="text-xs text-red-400 mt-0.5">{validationError.message}</p>
          )}
        </div>
        <div className="space-y-1.5">
          <Label>Bookings  Time *</Label>
          <Input
            type="time"
            value={form.reservationTime}
            onChange={(e) => {
              set('reservationTime', e.target.value);
              if (validationError?.field === 'reservationTime') setValidationError(null);
            }}
          />
          {validationError?.field === 'reservationTime' && (
            <p className="text-xs text-red-400 mt-0.5">{validationError.message}</p>
          )}
        </div>
      </div>

      {/* Menu Category and Menu Item */}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>Menu Category *</Label>
          <Select
            value={form.menuCategoryId}
            onChange={(e) => {
              const val = e.target.value;
              setForm((prev: any) => ({
                ...prev,
                menuCategoryId: val,
                menuItemId: prev.menuCategoryId === val ? prev.menuItemId : '',
              }));
              if (validationError?.field === 'menuCategoryId') setValidationError(null);
            }}
          >
            <option value="">Select category</option>
            {reservationCategories.map((cat: any) => (
              <option key={cat._id} value={cat._id}>{cat.name}</option>
            ))}
          </Select>
          {validationError?.field === 'menuCategoryId' && (
            <p className="text-xs text-red-400 mt-0.5">{validationError.message}</p>
          )}
        </div>
        <div className="space-y-1.5">
          <Label>Menu Item *</Label>
          <Select
            value={form.menuItemId}
            onChange={(e) => {
              set('menuItemId', e.target.value);
              if (validationError?.field === 'menuItemId') setValidationError(null);
            }}
            disabled={!form.menuCategoryId || menuItems.length === 0}
          >
            <option value="">Select item</option>
            {menuItems.map((item: any) => {
              const avail = availabilityMap[item._id];
              const isBooked = avail && !avail.available;
              const indicator = hasAvailabilityData ? (isBooked ? '🔴' : '🟢') : '';
              const suffix = isBooked
                ? ` — Booked (${avail.conflictTime} – ${avail.conflictEnd})`
                : hasAvailabilityData ? ' — Available' : '';
              return (
                <option key={item._id} value={item._id}>
                  {indicator} {item.name}{suffix}
                </option>
              );
            })}
          </Select>
          {validationError?.field === 'menuItemId' && (
            <p className="text-xs text-red-400 mt-0.5">{validationError.message}</p>
          )}
          {isCheckingAvailability && (
            <p className="text-xs text-muted-foreground">Checking availability...</p>
          )}
          {showMenuItemsLoading && (
            <p className="text-xs text-muted-foreground">Loading available items...</p>
          )}
          {form.menuCategoryId && !showMenuItemsLoading && menuItems.length === 0 && (
            <p className="text-xs text-muted-foreground">No available items for this category</p>
          )}
          {conflictMessage && (
            <p className="text-xs text-red-400 mt-1 font-medium">
              ⚠️ {conflictMessage}
            </p>
          )}
        </div>
      </div>

      {/* Duration and Guests */}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>Duration (minutes)</Label>
          <Select value={form.durationMinutes} onChange={(e) => set('durationMinutes', Number(e.target.value))}>
            {[30,60,90,120,150,180].map((m) => <option key={m} value={m}>{m} min</option>)}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Number of Guests *</Label>
          <Input
            type="number"
            min={1}
            max={20}
            value={form.numberOfGuests}
            onChange={(e) => {
              set('numberOfGuests', Number(e.target.value));
              if (validationError?.field === 'numberOfGuests') setValidationError(null);
            }}
          />
          {validationError?.field === 'numberOfGuests' && (
            <p className="text-xs text-red-400 mt-0.5">{validationError.message}</p>
          )}
        </div>
      </div>

      {/* Status */}
      <div className="space-y-1.5">
        <Label>Status</Label>
        <Select value={form.status} onChange={(e) => set('status', e.target.value)}>
          {STATUSES.map((s) => <option key={s} value={s}>{STATUS_CONFIG[s].label}</option>)}
        </Select>
      </div>

      {/* Special requests */}
      <div className="space-y-1.5">
        <Label>Special Requests (optional)</Label>
        <textarea value={form.specialRequests} onChange={(e) => set('specialRequests', e.target.value)}
          rows={2} placeholder="Birthday, dietary needs, seating preference…"
          className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none" />
      </div>

      {/* Notes */}
      <div className="space-y-1.5">
        <Label>Internal Notes (optional)</Label>
        <textarea value={form.notes} onChange={(e) => set('notes', e.target.value)}
          rows={2} placeholder="Staff-only notes…"
          className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none" />
      </div>

      {/* Payment Information */}
      <div className="rounded-xl border border-border p-4 bg-muted/20">
        <h4 className="text-sm font-semibold mb-3">Payment Details</h4>
        <PaymentForm 
          values={form} 
          onChange={(paymentValues) => {
            setForm(paymentValues);
            if (validationError?.field === 'paymentStatus' || validationError?.field === 'paymentMethod') {
              setValidationError(null);
            }
          }} 
          disabled={loading}
          showBillAmountField={true}
          validationError={validationError}
        />
      </div>

      <div className="flex gap-2 pt-2 sticky bottom-0 bg-card pb-1">
        <Button variant="outline" className="flex-1" onClick={onClose}>Cancel</Button>
        <Button className="flex-1" loading={loading}
          disabled={!!isSelectedItemBlocked}
          onClick={handleSubmit}
        >
          {initial._id ? '💾 Update' : '+ Create Bookings '}
        </Button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// View modal
// ─────────────────────────────────────────────────────────────────────────────
function ViewModal({ res, onClose, onEdit, onStatusChange }: {
  res: any; onClose: () => void; onEdit: () => void; onStatusChange: (s: string) => void;
}) {
  const { user } = useAuthStore();
  const ACTIONS: { status: ResStatus; label: string; variant: any }[] = [
    { status: 'confirmed' as const, label: '✅ Confirm',    variant: 'default' },
    { status: 'seated' as const,    label: '🪑 Seat',       variant: 'default' },
    { status: 'completed' as const, label: '🏁 Complete',   variant: 'success' },
    { status: 'cancelled' as const, label: '❌ Cancel',     variant: 'destructive' },
    { status: 'no_show' as const,   label: '👻 No Show',    variant: 'outline' },
  ].filter((a) => a.status !== res.status);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <p className="font-mono text-xs text-muted-foreground">{res.reservationId}</p>
          <h3 className="text-lg font-bold mt-0.5">{res.customerName}</h3>
          <p className="text-sm text-muted-foreground">{res.phoneNumber}{res.email && ` · ${res.email}`}</p>
        </div>
        <StatusBadge status={res.status} />
      </div>

      {/* Details grid */}
      <div className="grid grid-cols-2 gap-3">
        {[
          { label: 'Branch',   value: (user?.role === 'super_admin' || user?.role === 'admin') ? res.branch?.name : null },
          { label: 'Category', value: typeof res.menuCategoryId === 'object' ? res.menuCategoryId?.name : res.table?.type },
          { label: 'Item',     value: typeof res.menuItemId === 'object' ? res.menuItemId?.name : res.table?.name },
          { label: 'Date',     value: formatDate(res.reservationDate) },
          { label: 'Time',     value: res.reservationTime },
          { label: 'Duration', value: `${res.durationMinutes} min` },
          { label: 'Guests',   value: res.numberOfGuests },
        ].filter((f) => f.value).map((f) => (
          <div key={f.label} className="rounded-xl bg-muted/30 p-3">
            <p className="text-xs text-muted-foreground">{f.label}</p>
            <p className="font-semibold text-sm mt-0.5">{f.value}</p>
          </div>
        ))}
      </div>

      {res.specialRequests && (
        <div className="rounded-xl bg-amber-500/5 border border-amber-500/20 p-3">
          <p className="text-xs font-semibold text-amber-400 mb-1">Special Requests</p>
          <p className="text-sm">{res.specialRequests}</p>
        </div>
      )}
      {res.notes && (
        <div className="rounded-xl bg-muted/20 p-3">
          <p className="text-xs font-semibold text-muted-foreground mb-1">Internal Notes</p>
          <p className="text-sm">{res.notes}</p>
        </div>
      )}

      {/* Status history */}
      {res.statusHistory?.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider">Status History</p>
          <div className="space-y-1.5 max-h-32 overflow-y-auto">
            {[...res.statusHistory].reverse().map((h: any, i: number) => (
              <div key={i} className="flex items-center gap-2 text-xs">
                <span className="text-muted-foreground">{new Date(h.changedAt).toLocaleString('en-IN')}</span>
                <StatusBadge status={h.status} />
                {h.note && <span className="text-muted-foreground">— {h.note}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Quick actions */}
      <div className="flex flex-wrap gap-2 pt-1">
        <Button size="sm" variant="outline" onClick={onEdit}>✏️ Edit</Button>
        {ACTIONS.map((a) => (
          <Button key={a.status} size="sm" variant={a.variant} onClick={() => onStatusChange(a.status)}>
            {a.label}
          </Button>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Today's Live Table Availability Board
// ─────────────────────────────────────────────────────────────────────────────
function TodayTableAvailability({ branch }: { branch: string }) {
  const qc = useQueryClient();
  const { user } = useAuthStore();
  const { onReservationChange, onAvailabilityChange } = useSocket();
  const [statusFilter, setStatusFilter] = useState<'all' | 'available' | 'booked'>('all');
  const [selectedCatId, setSelectedCatId] = useState<string>('all');
  const [, setTick] = useState(0);

  // Auto-detect user's assigned branch for Branch Manager / Staff
  const userAssignedBranchId = useMemo(() => {
    if (!user?.branches || user.branches.length === 0) return '';
    const b = user.branches[0];
    return typeof b === 'string' ? b : (b as any)?._id || '';
  }, [user]);

  const isSuperOrAdmin = user?.role === 'super_admin' || user?.role === 'admin';

  // Branch Manager & Staff MUST automatically use their assigned branch
  // Admin & Super Admin use the selected branch prop, or fallback to assigned branch if available
  const effectiveBranch = isSuperOrAdmin
    ? (branch || userAssignedBranchId || '')
    : (userAssignedBranchId || branch || '');

  // Auto-refresh remaining time every 30s
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 30000);
    return () => clearInterval(timer);
  }, []);

  const queryKey = ['today-availability', effectiveBranch];

  const { data: availabilityData, isLoading } = useQuery({
    queryKey,
    queryFn: () => reservationService.getTodayAvailability({ branch: effectiveBranch }).then((r) => (r.data as any).data),
    enabled: !!effectiveBranch,
    refetchInterval: 30000,
    staleTime: 60_000,
  });

  // Socket listener for real-time live sync
  useEffect(() => {
    const off1 = onReservationChange((data) => {
      if (!data?.reservation?.branch || data.reservation.branch.toString() === effectiveBranch) {
        qc.invalidateQueries({ queryKey: ['today-availability'] });
      }
    });
    const off2 = onAvailabilityChange((data) => {
      if (!data?.branch || data.branch.toString() === effectiveBranch) {
        qc.invalidateQueries({ queryKey: ['today-availability'] });
      }
    });
    return () => {
      off1();
      off2();
    };
  }, [onReservationChange, onAvailabilityChange, effectiveBranch, qc]);

  const categories: any[] = availabilityData?.categories || [];

  const filteredCategories = useMemo(() => {
    return categories
      .map((cat: any) => {
        if (selectedCatId !== 'all' && cat.categoryId !== selectedCatId) {
          return null;
        }

        const items = cat.items.filter((item: any) => {
          if (statusFilter === 'available') return item.colorStatus === 'available';
          if (statusFilter === 'booked') return item.colorStatus === 'booked' || item.colorStatus === 'upcoming';
          return true;
        });

        if (items.length === 0 && selectedCatId !== 'all') return null;
        return { ...cat, items };
      })
      .filter(Boolean);
  }, [categories, selectedCatId, statusFilter]);

  if (!effectiveBranch) {
    return (
      <Card className="border border-border/80 bg-card/60">
        <CardContent className="p-4 text-center text-xs text-muted-foreground">
          Please select a branch to view Today's Live Table Availability.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border border-border/80 bg-card/60 backdrop-blur-sm">
      <CardContent className="p-4 space-y-4">
        {/* Title & Filters */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border/50 pb-3">
          <div className="flex items-center gap-2">
            <span className="relative flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
            </span>
            <h2 className="text-base font-bold tracking-tight text-foreground">
              Today's Table Availability
            </h2>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Quick Status Filter Pills */}
            <div className="flex items-center bg-muted/40 p-1 rounded-xl border border-border/40 text-xs">
              <button
                type="button"
                onClick={() => setStatusFilter('all')}
                className={cn(
                  'px-2.5 py-1 rounded-lg font-medium transition-colors',
                  statusFilter === 'all' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                )}
              >
                All
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('available')}
                className={cn(
                  'px-2.5 py-1 rounded-lg font-medium transition-colors flex items-center gap-1',
                  statusFilter === 'available' ? 'bg-background text-emerald-400 shadow-sm' : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <span>🟢</span> Available
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('booked')}
                className={cn(
                  'px-2.5 py-1 rounded-lg font-medium transition-colors flex items-center gap-1',
                  statusFilter === 'booked' ? 'bg-background text-red-400 shadow-sm' : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <span>🔴</span> Booked
              </button>
            </div>

            {/* Category Filter */}
            {categories.length > 1 && (
              <Select
                value={selectedCatId}
                onChange={(e) => setSelectedCatId(e.target.value)}
                className="h-8 text-xs w-40"
              >
                <option value="all">All Categories</option>
                {categories.map((cat: any) => (
                  <option key={cat.categoryId} value={cat.categoryId}>
                    {cat.categoryName}
                  </option>
                ))}
              </Select>
            )}
          </div>
        </div>

        {/* Content */}
        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {[1, 2, 3, 4].map((n) => (
              <Skeleton key={n} className="h-24 rounded-xl" />
            ))}
          </div>
        ) : filteredCategories.length === 0 ? (
          <div className="py-6 text-center text-xs text-muted-foreground">
            No tables match the selected status or category filter.
          </div>
        ) : (
          <div className="space-y-4">
            {filteredCategories.map((cat: any) => (
              <div key={cat.categoryId} className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                    {cat.categoryName}
                  </span>
                  <div className="h-px flex-1 bg-border/40" />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                  {cat.items.map((item: any) => {
                    const isBooked = item.colorStatus === 'booked';
                    const isUpcoming = item.colorStatus === 'upcoming';

                    const cardBorder = isBooked
                      ? 'border-red-500/30 bg-red-500/5'
                      : isUpcoming
                      ? 'border-amber-500/30 bg-amber-500/5'
                      : 'border-emerald-500/20 bg-emerald-500/5 hover:border-emerald-500/40';

                    const dotColor = isBooked ? '🔴' : isUpcoming ? '🟡' : '🟢';

                    return (
                      <div
                        key={item.menuItemId}
                        className={cn(
                          'p-3 rounded-2xl border transition-all duration-200 flex flex-col justify-between space-y-2 min-w-0 overflow-hidden',
                          cardBorder
                        )}
                      >
                        <div className="flex items-start justify-between gap-2 min-w-0">
                          <div className="flex items-center gap-1.5 font-semibold text-sm min-w-0 flex-1">
                            <span className="shrink-0">{dotColor}</span>
                            <span className="truncate">{item.name}</span>
                          </div>
                          <span
                            className={cn(
                              'text-[10px] font-bold px-2 py-0.5 rounded-full border uppercase tracking-wider shrink-0 whitespace-nowrap',
                              isBooked
                                ? 'bg-red-500/15 text-red-400 border-red-500/30'
                                : isUpcoming
                                ? 'bg-amber-500/15 text-amber-400 border-amber-500/30'
                                : 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                            )}
                          >
                            {isBooked ? 'Booked' : isUpcoming ? 'Starts Soon' : 'Available'}
                          </span>
                        </div>

                        {item.allBookings && item.allBookings.length > 0 ? (
                          <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                            {item.allBookings.map((bk: any, idx: number) => {
                              if (bk.isCurrent) {
                                return (
                                  <div key={bk._id || idx} className="text-xs space-y-1 bg-background/50 p-2 rounded-xl border border-border/30">
                                    <p className="font-semibold text-foreground truncate">
                                      Customer: {bk.customerName}
                                    </p>
                                    <p className="text-muted-foreground font-mono text-[11px]">
                                      {bk.startTime} – {bk.endTime}
                                    </p>
                                    {bk.remainingMinutes !== null && bk.remainingMinutes !== undefined && (
                                      <p className="text-[11px] font-medium text-amber-400">
                                        Remaining: {bk.remainingMinutes} minutes
                                      </p>
                                    )}
                                  </div>
                                );
                              }

                              const isNext = (item.booking && idx === 1) || (!item.booking && idx === 0);
                              return (
                                <div key={bk._id || idx} className="text-xs space-y-1 bg-amber-500/10 p-2 rounded-xl border border-amber-500/20">
                                  <p className="text-[10px] font-bold text-amber-400 uppercase tracking-wider">
                                    {isNext ? 'Next Booking' : 'Upcoming Booking'}
                                  </p>
                                  <p className="font-semibold text-foreground truncate">
                                    Customer: {bk.customerName}
                                  </p>
                                  <p className="text-muted-foreground font-mono text-[11px]">
                                    {bk.startTime} – {bk.endTime}
                                  </p>
                                  {bk.startsInMinutes !== undefined && bk.startsInMinutes !== null && (
                                    <p className="text-[11px] font-medium text-amber-300">
                                      Starts in: {bk.startsInMinutes} minutes
                                    </p>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <p className="text-xs text-muted-foreground/70 italic">Available</p>
                        )}




                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN PAGE
// ─────────────────────────────────────────────────────────────────────────────
export default function ReservationsPage() {
  const qc    = useQueryClient();
  const toast = useToast();
  const { selectedBranch } = useAppStore();
  const { user } = useAuthStore();
  const { onReservationChange } = useSocket();

  // Determine if user can select branch (Super Admin and Admin can)
  const canSelectBranch = user?.role === 'super_admin' || user?.role === 'admin';

  // ── Real-time socket sync: invalidate caches when any reservation changes ──
  useEffect(() => {
    const cleanup = onReservationChange(() => {
      qc.invalidateQueries({ queryKey: ['reservations'] });
      qc.invalidateQueries({ queryKey: ['reservation-stats'] });
    });
    return cleanup;
  }, [onReservationChange, qc]);

  // ── Pagination / filter state ─────────────────────────────────────────────
  const [page,      setPage]      = useState(1);
  const [pageSize,  setPageSize]  = useState(10);
  const [search,    setSearch]    = useState('');
  const [status,    setStatus]    = useState('');
  const [dateFrom,  setDateFrom]  = useState('');
  const [dateTo,    setDateTo]    = useState('');
  const [branchFlt, setBranchFlt] = useState('');
  const [tableFlt,  setTableFlt]  = useState('');
  const [menuCategoryFlt, setMenuCategoryFlt] = useState('');
  const [sortBy,    setSortBy]    = useState('createdAt');
  const [sortOrder, setSortOrder] = useState<'asc'|'desc'>('desc');

  // ── Modal state ───────────────────────────────────────────────────────────
  const [modal,    setModal]    = useState<'create'|'edit'|'view'|null>(null);
  const [selected, setSelected] = useState<any>(null);

  // Reset page on filter change
  useEffect(() => { setPage(1); }, [search, status, dateFrom, dateTo, branchFlt, menuCategoryFlt, sortBy, sortOrder]);

  const userAssignedBranchId = useMemo(() => {
    if (!user?.branches || user.branches.length === 0) return '';
    const b = user.branches[0];
    return typeof b === 'string' ? b : (b as any)?._id || '';
  }, [user]);

  const branch = branchFlt || selectedBranch || (!canSelectBranch ? userAssignedBranchId : '') || '';
  const reservationsQueryKey = ['reservations', page, pageSize, sortBy, sortOrder, branch, search, status, dateFrom, dateTo, tableFlt, menuCategoryFlt] as const;
  const reservationStatsKey = ['reservation-stats', branch] as const;
  const reservationCategoriesKey = ['menu-categories', 'active'] as const;

  const queryParams: Record<string, string> = {
    page: String(page), pageSize: String(pageSize),
    sortBy, sortOrder,
  };
  if (branch)   queryParams.branch   = branch;
  if (search)   queryParams.search   = search;
  if (status)   queryParams.status   = status;
  if (dateFrom) queryParams.dateFrom = dateFrom;
  if (dateTo)   queryParams.dateTo   = dateTo;
  if (tableFlt) queryParams.table    = tableFlt;
  if (menuCategoryFlt) queryParams.menuCategoryId = menuCategoryFlt;

  // ── Queries ───────────────────────────────────────────────────────────────
  const { data: listData, isLoading } = useQuery({
    queryKey: reservationsQueryKey,
    queryFn: () => reservationService.getAll(queryParams).then((r) => r.data),
    placeholderData: keepPreviousData,
    staleTime: 15 * 1000,
    gcTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const { data: statsData } = useQuery({
    queryKey: reservationStatsKey,
    queryFn: () => reservationService.getStats(branch ? { branch } : {}).then((r) => (r.data as any).data),
    enabled: user?.role === 'super_admin',
    refetchInterval: 300000,
    staleTime: 30 * 1000,
    gcTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const { data: branchList } = useQuery({
    queryKey: ['branches'],
    queryFn: () => branchService.getAll().then((r) => r.data.data.branches),
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
    placeholderData: (prev) => prev,
  });
  
  const { data: tableList }  = useQuery({
    queryKey: ['reservation-tables', branch], enabled: !!branch,
    queryFn: () => tableService.getAll({ branch }).then((r) => r.data.data.tables),
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
    placeholderData: keepPreviousData,
  });
  const { data: categoriesData } = useQuery({
    queryKey: reservationCategoriesKey,
    queryFn: () => menuService.getCategories({ activeOnly: 'true' }).then((r) => r.data.data.categories),
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
    placeholderData: (prev) => prev,
  });
  const categories: any[] = categoriesData || [];
  const reservationCategories = useMemo(
    () => categories.filter((cat: any) => {
      const n = cat.name?.trim().toLowerCase();
      return n !== 'beverage' && n !== 'beverages' && n !== 'accessory' && n !== 'accessories';
    }),
    [categories]
  );

  const reservations: any[] = (listData as any)?.data || [];
  const totalRecords: number = (listData as any)?.totalRecords || 0;
  const totalPages: number   = (listData as any)?.totalPages   || 1;
  const stats = statsData || {};

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['reservation-stats'] });
    qc.invalidateQueries({ queryKey: ['reservation-tables'] });
    qc.invalidateQueries({ queryKey: ['today-availability'] });
    qc.invalidateQueries({ queryKey: ['customers'] });
    qc.invalidateQueries({ queryKey: ['customer-orders'] });
  };

  const syncReservationCaches = useCallback((mode: 'create' | 'update' | 'delete', reservation: any) => {
    qc.setQueriesData({ queryKey: ['reservations'] }, (old: any) => {
      if (!old || !Array.isArray(old.data)) return old;

      const pageLimit = old.pageSize || pageSize;
      let next = old.data.slice();

      if (mode === 'create') {
        next = [reservation, ...next.filter((item: any) => item._id !== reservation._id)];
        if (next.length > pageLimit) next = next.slice(0, pageLimit);
        return {
          ...old,
          data: next,
          totalRecords: (old.totalRecords || 0) + 1,
        };
      }

      if (mode === 'update') {
        return {
          ...old,
          data: next.map((item: any) => (item._id === reservation._id ? reservation : item)),
        };
      }

      return {
        ...old,
        data: next.filter((item: any) => item._id !== reservation._id),
        totalRecords: Math.max((old.totalRecords || 1) - 1, 0),
      };
    });
  }, [qc, pageSize]);

  const prefetchReservationFormData = useCallback((reservation?: any) => {
    void qc.prefetchQuery({
      queryKey: reservationCategoriesKey,
      queryFn: () => menuService.getCategories({ activeOnly: 'true' }).then((r) => r.data.data.categories),
      staleTime: 10 * 60 * 1000,
    });

    const branchId = reservation?.branch?._id || reservation?.branch || branch;
    if (branchId) {
      void qc.prefetchQuery({
        queryKey: ['reservation-tables', branchId],
        queryFn: () => tableService.getAll({ branch: branchId }).then((r) => r.data.data.tables),
        staleTime: 5 * 60 * 1000,
      });
    }

    const categoryId = reservation?.menuCategoryId?._id || reservation?.menuCategoryId;
    if (branchId && categoryId) {
      void qc.prefetchQuery({
        queryKey: ['reservation-menu-items', categoryId, branchId],
        queryFn: () => menuService.getAll({ limit: '1000', branch: branchId, category: categoryId, activeOnly: 'true' }).then((r) => r.data.data.items),
        staleTime: 5 * 60 * 1000,
      });
    }
  }, [branch, qc, reservationCategoriesKey]);

  // ── Mutations ─────────────────────────────────────────────────────────────
  const createMutation = useMutation({
    mutationFn: (d: any) => reservationService.create(d),
    onSuccess: (res) => {
      syncReservationCaches('create', (res as any).data.data.reservation);
      invalidate();
      toast.success('Bookings  created!');
      setModal(null);
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed to create'),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => reservationService.update(id, data),
    onSuccess: (res) => {
      syncReservationCaches('update', (res as any).data.data.reservation);
      invalidate();
      toast.success('Bookings  updated!');
      setModal(null);
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed to update'),
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => reservationService.changeStatus(id, status),
    onSuccess: (res) => {
      syncReservationCaches('update', (res as any).data.data.reservation);
      invalidate();
      toast.success('Status updated!');
      setModal(null);
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => reservationService.delete(id),
    onSuccess: (_res, id) => {
      syncReservationCaches('delete', { _id: id });
      invalidate();
      toast.success('Bookings  deleted');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Cannot delete'),
  });

  // ── Handlers ──────────────────────────────────────────────────────────────
  const openView   = (r: any) => { setSelected(r); setModal('view'); };
  const openEdit   = (r: any) => {
    prefetchReservationFormData(r);
    setSelected({
      ...r,
      branch: r.branch?._id || r.branch,
      table: r.table?._id || r.table,
      menuCategoryId: r.menuCategoryId?._id || r.menuCategoryId,
      menuItemId: r.menuItemId?._id || r.menuItemId,
      reservationDate: new Date(r.reservationDate).toISOString().slice(0, 10),
    });
    setModal('edit');
  };
  const openCreate = () => {
    prefetchReservationFormData();
    setSelected(null);
    setModal('create');
  };

  const handleSort = (col: string) => {
    if (sortBy === col) setSortOrder((o) => o === 'asc' ? 'desc' : 'asc');
    else { setSortBy(col); setSortOrder('asc'); }
  };

  const SortIcon = ({ col }: { col: string }) =>
    sortBy === col ? <span className="ml-1">{sortOrder === 'asc' ? '↑' : '↓'}</span> : null;

  const STAT_CARDS = [
    { label: 'Total',      value: stats.total     || 0, icon: '📋', color: 'bg-blue-500/15' },
    { label: "Today's",    value: stats.today     || 0, icon: '📅', color: 'bg-indigo-500/15' },
    { label: 'Confirmed',  value: stats.confirmed || 0, icon: '✅', color: 'bg-blue-500/15' },
    { label: 'Pending',    value: stats.pending   || 0, icon: '⏳', color: 'bg-amber-500/15' },
    { label: 'Seated',     value: stats.seated    || 0, icon: '🪑', color: 'bg-purple-500/15' },
    { label: 'Completed',  value: stats.completed || 0, icon: '🏁', color: 'bg-emerald-500/15' },
    { label: 'Cancelled',  value: stats.cancelled || 0, icon: '❌', color: 'bg-red-500/15' },
    { label: 'No Show',    value: stats.no_show   || 0, icon: '👻', color: 'bg-slate-500/15' },
  ];

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Page header */}
      <PageHeader
        title="Bookings"
        actions={<Button size="sm" onClick={openCreate}>+ Add Bookings </Button>}
      />

      {/* Stats row - Only visible to Super Admin */}
      {user?.role === 'super_admin' && (
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
          {STAT_CARDS.map((s) => <StatCard key={s.label} {...s} />)}
        </div>
      )}

      {/* Today's Live Table Availability Timeline */}
      <TodayTableAvailability branch={branch} />

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6 gap-3">
            {/* Search */}
            <div className="xl:col-span-2">
              <Input
                placeholder="🔍 Name, phone, or reservation ID…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            {/* Status */}
            <Select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All Statuses</option>
              {STATUSES.map((s) => <option key={s} value={s}>{STATUS_CONFIG[s].label}</option>)}
            </Select>

            {/* Branch - only for Super Admin and Admin */}
            {canSelectBranch && (
              <Select value={branchFlt} onChange={(e) => setBranchFlt(e.target.value)}>
                <option value="">All Branches</option>
                {(branchList || []).map((b: any) => <option key={b._id} value={b._id}>{b.name}</option>)}
              </Select>
            )}

            {/* Menu Category */}
            <Select value={menuCategoryFlt} onChange={(e) => setMenuCategoryFlt(e.target.value)}>
              <option value="">All Categories</option>
              {reservationCategories.map((cat: any) => <option key={cat._id} value={cat._id}>{cat.name}</option>)}
            </Select>

            {/* Date from */}
            <div className="flex gap-2 xl:col-span-1">
              <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="flex-1" />
            </div>
          </div>

          {/* Second filter row */}
          <div className="flex flex-wrap items-center gap-3 mt-3">
            <div className="flex gap-1">
              {['reservationDate','customerName','createdAt'].map((col) => (
                <button key={col} onClick={() => handleSort(col)}
                  className={cn('px-3 py-1.5 rounded-xl border text-xs font-medium transition-colors',
                    sortBy === col ? 'gradient-brand text-white border-transparent' : 'border-border text-muted-foreground hover:bg-accent'
                  )}
                >
                  {col === 'reservationDate' ? 'Date' : col === 'customerName' ? 'Name' : 'Created'}
                  {sortBy === col && <span className="ml-1">{sortOrder === 'asc' ? '↑' : '↓'}</span>}
                </button>
              ))}
            </div>
            {(search || status || dateFrom || dateTo || branchFlt || menuCategoryFlt) && (
              <button onClick={() => { setSearch(''); setStatus(''); setDateFrom(''); setDateTo(''); setBranchFlt(''); setMenuCategoryFlt(''); }}
                className="text-xs text-red-400 hover:text-red-300 underline">
                Clear filters
              </button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Data table */}
      <Card>
        {isLoading ? (
          <div className="p-4 space-y-3">{[...Array(6)].map((_, i) => <Skeleton key={i} className="h-14 rounded-xl" />)}</div>
        ) : reservations.length === 0 ? (
          <EmptyState
            icon="📅"
            title="No reservations found"
            description={search || status ? 'Try adjusting your search or filters' : 'Create your first reservation to get started'}
            action={<Button size="sm" onClick={openCreate}>+ Add Bookings </Button>}
          />
        ) : (
          <>
            <div className="overflow-x-auto -mx-4 sm:mx-0 px-4 sm:px-0">
              <Table2>
                <TableHeader>
                  <TableRow>
                    <TableHead className="cursor-pointer" onClick={() => handleSort('reservationDate')}>
                      Res. ID / Date <SortIcon col="reservationDate" />
                    </TableHead>
                    <TableHead className="cursor-pointer" onClick={() => handleSort('customerName')}>
                      Customer <SortIcon col="customerName" />
                    </TableHead>
                    <TableHead>Category/Item</TableHead>
                    <TableHead>Time</TableHead>
                    <TableHead>Guests</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="cursor-pointer" onClick={() => handleSort('createdAt')}>
                      Created <SortIcon col="createdAt" />
                    </TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {reservations.map((r) => (
                    <TableRow key={r._id} className="cursor-pointer" onClick={() => openView(r)}>
                      <TableCell>
                        <div>
                          <p className="font-mono text-xs font-semibold text-primary">{r.reservationId}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">{formatDate(r.reservationDate)}</p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div>
                          <p className="font-semibold text-sm">{r.customerName}</p>
                          <p className="text-xs text-muted-foreground">{r.phoneNumber}</p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div>
                          {canSelectBranch && r.branch?.name ? (
                            <p className="text-xs text-muted-foreground font-medium mb-0.5">{r.branch?.name}</p>
                          ) : null}
                          <p className="text-sm font-semibold text-foreground">
                            {typeof r.menuCategoryId === 'object' && r.menuCategoryId?.name
                              ? r.menuCategoryId.name
                              : r.table?.type || '—'}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {typeof r.menuItemId === 'object' && r.menuItemId?.name
                              ? r.menuItemId.name
                              : r.table?.name || '—'}
                          </p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div>
                          <p className="font-semibold text-sm">{r.reservationTime}</p>
                          <p className="text-xs text-muted-foreground">{r.durationMinutes} min</p>
                        </div>
                      </TableCell>
                      <TableCell className="font-semibold">{r.numberOfGuests}</TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <StatusBadge status={r.status} />
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{formatDate(r.createdAt)}</TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <div className="flex gap-1">
                          <button onClick={() => openView(r)}
                            title="View" className="h-7 w-7 rounded-lg hover:bg-accent flex items-center justify-center text-sm transition-colors">👁</button>
                          <button onClick={() => openEdit(r)}
                            title="Edit" className="h-7 w-7 rounded-lg hover:bg-accent flex items-center justify-center text-sm transition-colors">✏️</button>
                          {r.status === 'pending' && (
                            <button onClick={() => statusMutation.mutate({ id: r._id, status: 'confirmed' })}
                              title="Confirm" className="h-7 w-7 rounded-lg hover:bg-blue-500/20 text-blue-400 flex items-center justify-center text-sm transition-colors">✅</button>
                          )}
                          {r.status === 'confirmed' && (
                            <button onClick={() => statusMutation.mutate({ id: r._id, status: 'seated' })}
                              title="Seat" className="h-7 w-7 rounded-lg hover:bg-purple-500/20 text-purple-400 flex items-center justify-center text-sm transition-colors">🪑</button>
                          )}
                          {!['completed','cancelled','no_show'].includes(r.status) && (
                            <button onClick={() => { if (window.confirm('Cancel this reservation?')) statusMutation.mutate({ id: r._id, status: 'cancelled' }); }}
                              title="Cancel" className="h-7 w-7 rounded-lg hover:bg-red-500/20 text-red-400 flex items-center justify-center text-sm transition-colors">❌</button>
                          )}
                          {canSelectBranch && (
                            <button
                              onClick={() => { if (window.confirm('Delete permanently?')) deleteMutation.mutate(r._id); }}
                              title="Delete" className="h-7 w-7 rounded-lg hover:bg-red-500/20 text-red-400 flex items-center justify-center text-sm transition-colors">🗑</button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table2>
            </div>
            <Pagination
              currentPage={page} totalPages={totalPages}
              totalRecords={totalRecords} pageSize={pageSize}
              onPage={setPage} onPageSize={(s) => { setPageSize(s); setPage(1); }}
            />
          </>
        )}
      </Card>

      {/* ── Create modal ──────────────────────────────────────────────────── */}
      <Modal open={modal === 'create'} onClose={() => setModal(null)} title="New Bookings " size="lg">
        <ReservationForm
          initial={{ ...EMPTY_FORM, branch: selectedBranch || '' }}
          onSubmit={(d) => createMutation.mutate(d)}
          onClose={() => setModal(null)}
          loading={createMutation.isPending}
        />
      </Modal>

      {/* ── Edit modal ────────────────────────────────────────────────────── */}
      <Modal open={modal === 'edit'} onClose={() => setModal(null)} title="Edit Bookings " size="lg">
        {selected && (
          <ReservationForm
            initial={selected}
            onSubmit={(d) => updateMutation.mutate({ id: selected._id, data: d })}
            onClose={() => setModal(null)}
            loading={updateMutation.isPending}
          />
        )}
      </Modal>

      {/* ── View modal ────────────────────────────────────────────────────── */}
      <Modal open={modal === 'view'} onClose={() => setModal(null)} title="Bookings  Details" size="lg">
        {selected && (
          <ViewModal
            res={selected}
            onClose={() => setModal(null)}
            onEdit={() => { openEdit(selected); }}
            onStatusChange={(s) => statusMutation.mutate({ id: selected._id, status: s })}
          />
        )}
      </Modal>
    </div>
  );
}
