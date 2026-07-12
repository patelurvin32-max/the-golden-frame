import { useState, useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { reservationService, branchService, tableService, menuService } from '@/services';
import { useAppStore, useAuthStore } from '@/store';
import {
  Button, Card, CardContent, Input, Label, Select, Badge,
  Modal, PageHeader, Skeleton, EmptyState, useToast,
  Table2, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from '@/components/ui';
import { formatDate, formatDateTime, cn } from '@/utils';

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
};

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
  const { user } = useAuthStore();

  const { data: branches } = useQuery({ queryKey: ['branches'], queryFn: () => branchService.getAll().then((r) => r.data.data.branches) });

  // Fetch menu categories
  const { data: categoriesData } = useQuery({
    queryKey: ['menu-categories'],
    queryFn: () => menuService.getCategories({ activeOnly: 'true' }).then((r) => r.data),
  });
  const categories: any[] = (categoriesData as any)?.data?.categories || [];
  const reservationCategories = categories.filter((cat: any) => cat.name?.trim().toLowerCase() !== 'beverage');

  // Fetch menu items filtered by category and branch
  const menuParams: Record<string, string> = { limit: '1000' };
  if (form.menuCategoryId) menuParams.category = form.menuCategoryId;
  if (form.branch) menuParams.branch = form.branch;

  const { data: menuItemsData } = useQuery({
    queryKey: ['menu-items', form.menuCategoryId, form.branch],
    queryFn: () => menuService.getAll(menuParams).then((r) => r.data),
    enabled: !!form.menuCategoryId,
  });
  const menuItems: any[] = (menuItemsData as any)?.data?.items || [];

  // Determine if user can select branch (Super Admin can, Branch Manager and Staff cannot)
  const canSelectBranch = user?.role === 'super_admin';
  
  // Auto-assign branch for Branch Manager and Staff
  useEffect(() => {
    if (!canSelectBranch && user?.branches?.[0] && !initial._id) {
      setForm((prev: any) => ({ ...prev, branch: user.branches[0]._id || user.branches[0] }));
    }
  }, [canSelectBranch, user, initial._id]);

  const set = (k: string, v: any) => setForm((p: any) => ({ ...p, [k]: v }));

  return (
    <div className="space-y-4 max-h-[75vh] overflow-y-auto pr-1">
      {/* Customer */}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>Customer Name *</Label>
          <Input value={form.customerName} onChange={(e) => set('customerName', e.target.value)} placeholder="Full name" />
        </div>
        <div className="space-y-1.5">
          <Label>Mobile Number *</Label>
          <Input 
            value={form.phoneNumber} 
            onChange={(e) => {
              const numericPhone = e.target.value.replace(/\D/g, '').slice(0, 10);
              set('phoneNumber', numericPhone);
              if (numericPhone.length > 0 && numericPhone.length < 10) {
                setPhoneError('Mobile number must contain exactly 10 digits.');
              } else {
                setPhoneError('');
              }
            }}
            placeholder="10-digit mobile number"
            maxLength={10}
          />
          {phoneError && <p className="text-xs text-red-400">{phoneError}</p>}
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
          <Select value={form.branch} onChange={(e) => { set('branch', e.target.value); }}>
            <option value="">Select branch</option>
            {(branches || []).map((b: any) => <option key={b._id} value={b._id}>{b.name}</option>)}
          </Select>
        </div>
      )}

      {/* Date / Time / Duration / Guests */}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>Reservation Date *</Label>
          <Input type="date" value={form.reservationDate} min={new Date().toISOString().slice(0,10)} onChange={(e) => set('reservationDate', e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Reservation Time *</Label>
          <Input type="time" value={form.reservationTime} onChange={(e) => set('reservationTime', e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Duration (minutes)</Label>
          <Select value={form.durationMinutes} onChange={(e) => set('durationMinutes', Number(e.target.value))}>
            {[30,60,90,120,150,180].map((m) => <option key={m} value={m}>{m} min</option>)}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Number of Guests *</Label>
          <Input type="number" min={1} max={20} value={form.numberOfGuests} onChange={(e) => set('numberOfGuests', Number(e.target.value))} />
        </div>
      </div>

      {/* Menu Category and Menu Item */}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>Menu Category *</Label>
          <Select
            value={form.menuCategoryId}
            onChange={(e) => set('menuCategoryId', e.target.value)}
          >
            <option value="">Select category</option>
            {reservationCategories.map((cat: any) => (
              <option key={cat._id} value={cat._id}>{cat.name}</option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Menu Item *</Label>
          <Select
            value={form.menuItemId}
            onChange={(e) => set('menuItemId', e.target.value)}
            disabled={!form.menuCategoryId || menuItems.length === 0}
          >
            <option value="">Select item</option>
            {menuItems.map((item: any) => (
              <option key={item._id} value={item._id}>
                {item.name}
              </option>
            ))}
          </Select>
          {form.menuCategoryId && menuItems.length === 0 && (
            <p className="text-xs text-muted-foreground">No available items for this category</p>
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

      <div className="flex gap-2 pt-2 sticky bottom-0 bg-card pb-1">
        <Button variant="outline" className="flex-1" onClick={onClose}>Cancel</Button>
        <Button className="flex-1" loading={loading}
          onClick={() => {
            if (!form.customerName || !form.phoneNumber || !form.menuCategoryId || !form.menuItemId || !form.reservationDate || !form.reservationTime) return;
            if (canSelectBranch && !form.branch) return;
            onSubmit(form);
          }}
        >
          {initial._id ? '💾 Update' : '+ Create Reservation'}
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
          { label: 'Branch',   value: res.branch?.name },
          { label: 'Table',    value: `${res.table?.name} (${res.table?.type})` },
          { label: 'Date',     value: formatDate(res.reservationDate) },
          { label: 'Time',     value: res.reservationTime },
          { label: 'Duration', value: `${res.durationMinutes} min` },
          { label: 'Guests',   value: res.numberOfGuests },
        ].map((f) => (
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
// MAIN PAGE
// ─────────────────────────────────────────────────────────────────────────────
export default function ReservationsPage() {
  const qc    = useQueryClient();
  const toast = useToast();
  const { selectedBranch } = useAppStore();
  const { user } = useAuthStore();

  // Determine if user can select branch (Super Admin and Admin can)
  const canSelectBranch = user?.role === 'super_admin' || user?.role === 'admin';

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
  const [sortBy,    setSortBy]    = useState('reservationDate');
  const [sortOrder, setSortOrder] = useState<'asc'|'desc'>('asc');

  // ── Modal state ───────────────────────────────────────────────────────────
  const [modal,    setModal]    = useState<'create'|'edit'|'view'|null>(null);
  const [selected, setSelected] = useState<any>(null);

  // Reset page on filter change
  useEffect(() => { setPage(1); }, [search, status, dateFrom, dateTo, branchFlt, menuCategoryFlt, sortBy, sortOrder]);

  const branch = branchFlt || selectedBranch || '';

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
    queryKey: ['reservations', queryParams],
    queryFn: () => reservationService.getAll(queryParams).then((r) => r.data),
    placeholderData: (prev) => prev,
  });

  const { data: statsData } = useQuery({
    queryKey: ['reservation-stats', branch],
    queryFn: () => reservationService.getStats(branch ? { branch } : {}).then((r) => (r.data as any).data),
    refetchInterval: 300000,
  });

  const { data: branchList } = useQuery({ queryKey: ['branches'], queryFn: () => branchService.getAll().then((r) => r.data.data.branches) });
  
  const { data: tableList }  = useQuery({
    queryKey: ['tables-filter', branch], enabled: !!branch,
    queryFn: () => tableService.getAll({ branch }).then((r) => r.data.data.tables),
  });
  const { data: categoriesData } = useQuery({
    queryKey: ['menu-categories'],
    queryFn: () => menuService.getCategories({ activeOnly: 'true' }).then((r) => r.data),
  });
  const categories: any[] = (categoriesData as any)?.data?.categories || [];
  const reservationCategories = categories.filter((cat: any) => cat.name?.trim().toLowerCase() !== 'beverage');

  const reservations: any[] = (listData as any)?.data || [];
  const totalRecords: number = (listData as any)?.totalRecords || 0;
  const totalPages: number   = (listData as any)?.totalPages   || 1;
  const stats = statsData || {};

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['reservations'] });
    qc.invalidateQueries({ queryKey: ['reservation-stats'] });
  };

  // ── Mutations ─────────────────────────────────────────────────────────────
  const createMutation = useMutation({
    mutationFn: (d: any) => reservationService.create(d),
    onSuccess: () => { invalidate(); toast.success('Reservation created!'); setModal(null); },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed to create'),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => reservationService.update(id, data),
    onSuccess: () => { invalidate(); toast.success('Reservation updated!'); setModal(null); },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed to update'),
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => reservationService.changeStatus(id, status),
    onSuccess: () => { invalidate(); toast.success('Status updated!'); setModal(null); },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => reservationService.delete(id),
    onSuccess: () => { invalidate(); toast.success('Reservation deleted'); },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Cannot delete'),
  });

  // ── Handlers ──────────────────────────────────────────────────────────────
  const openView   = (r: any) => { setSelected(r); setModal('view'); };
  const openEdit   = (r: any) => {
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
  const openCreate = () => { setSelected(null); setModal('create'); };

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
        title="Reservations"
        actions={<Button size="sm" onClick={openCreate}>+ Add Reservation</Button>}
      />

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
        {STAT_CARDS.map((s) => <StatCard key={s.label} {...s} />)}
      </div>

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
            <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-40" placeholder="To date" />
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
            action={<Button size="sm" onClick={openCreate}>+ Add Reservation</Button>}
          />
        ) : (
          <>
            <div className="overflow-x-auto">
              <Table2>
                <TableHeader>
                  <TableRow>
                    <TableHead className="cursor-pointer" onClick={() => handleSort('reservationDate')}>
                      Res. ID / Date <SortIcon col="reservationDate" />
                    </TableHead>
                    <TableHead className="cursor-pointer" onClick={() => handleSort('customerName')}>
                      Customer <SortIcon col="customerName" />
                    </TableHead>
                    <TableHead>Branch / Table</TableHead>
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
                          <p className="text-sm font-medium">{r.branch?.name}</p>
                          <p className="text-xs text-muted-foreground capitalize">{r.table?.name} · {r.table?.type}</p>
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
                          <button
                            onClick={() => { if (window.confirm('Delete permanently?')) deleteMutation.mutate(r._id); }}
                            title="Delete" className="h-7 w-7 rounded-lg hover:bg-red-500/20 text-red-400 flex items-center justify-center text-sm transition-colors">🗑</button>
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
      <Modal open={modal === 'create'} onClose={() => setModal(null)} title="New Reservation" size="lg">
        <ReservationForm
          initial={{ ...EMPTY_FORM, branch: selectedBranch || '' }}
          onSubmit={(d) => createMutation.mutate(d)}
          onClose={() => setModal(null)}
          loading={createMutation.isPending}
        />
      </Modal>

      {/* ── Edit modal ────────────────────────────────────────────────────── */}
      <Modal open={modal === 'edit'} onClose={() => setModal(null)} title="Edit Reservation" size="lg">
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
      <Modal open={modal === 'view'} onClose={() => setModal(null)} title="Reservation Details" size="lg">
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
