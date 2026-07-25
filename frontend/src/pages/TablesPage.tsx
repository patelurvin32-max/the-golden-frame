import { useState, useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { tableService, sessionService, customerService, billingService } from '@/services';
import { useAppStore } from '@/store';
import { useSocket } from '@/hooks/useSocket';
import type { Table, Customer } from '@/types';
import {
  Button, Card, CardContent, Badge, Modal, Input, Label,
  Select, EmptyState, Skeleton, PageHeader, useToast
} from '@/components/ui';
import {
  cn, formatCurrency, getCategoryColor, STATUS_COLORS,
  getElapsedMinutes, getRunningAmount
} from '@/utils';
import { useNavigate } from 'react-router-dom';
import PaymentForm, { PaymentFormValues } from '@/components/PaymentForm';

const getTableIcon = (type: string) => {
  const t = type.toLowerCase();
  if (t.includes('pool')) return '🎱';
  if (t.includes('snooker')) return '🟢';
  if (t.includes('ps') || t.includes('playstation') || t.includes('xbox')) return '🎮';
  if (t.includes('tennis')) return '🏓';
  if (t.includes('hockey')) return '🏒';
  return '🎯';
};

function getElapsedSeconds(startTime: string | Date, pauses: Array<{ pauseTime?: string | Date; resumeTime?: string | Date; pausedAt?: string | Date; resumedAt?: string | Date }> = []): number {
  if (!startTime) return 0;
  const start = new Date(startTime).getTime();
  const now = Date.now();
  let totalPauseMs = 0;

  for (const pause of pauses) {
    const pauseStart = new Date(pause.pauseTime || pause.pausedAt || 0).getTime();
    if (pauseStart > 0) {
      const pauseEnd = (pause.resumeTime || pause.resumedAt) ? new Date(pause.resumeTime || pause.resumedAt!).getTime() : now;
      totalPauseMs += Math.max(0, pauseEnd - pauseStart);
    }
  }

  const elapsedMs = Math.max(0, now - start - totalPauseMs);
  return Math.floor(elapsedMs / 1000);
}

function formatElapsedTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) {
    return `${h}h ${m}m ${s.toString().padStart(2, '0')}s`;
  }
  return `${m}m ${s.toString().padStart(2, '0')}s`;
}

// ── Live timer that updates every 1s ──────────────────────────────────────────
function useRunningTimer(session: any) {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    if (!session) {
      setSeconds(0);
      return;
    }
    if (session.status === 'paused') {
      const pausedSecs = getElapsedSeconds(session.startTime, session.pauses || []);
      setSeconds(pausedSecs);
      return;
    }
    const tick = () => {
      setSeconds(getElapsedSeconds(session.startTime, session.pauses || []));
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [session?.startTime, session?.status, JSON.stringify(session?.pauses || [])]);

  return seconds;
}

// ── Individual Table Card ─────────────────────────────────────────────────────
function TableCard({ table, onAction }: { table: Table; onAction: (action: string, table: Table) => void }) {
  const session = table.currentSession as any;
  const seconds = useRunningTimer(session);
  const minutes = Math.ceil(seconds / 60);
  const amount = session ? getRunningAmount(minutes + (session.extendedMinutes || 0), session.hourlyRate) : 0;
  const isPaused = session?.status === 'paused';

  const statusConfig: Record<string, { dot: string; label: string }> = {
    available: { dot: 'bg-emerald-400', label: 'Available' },
    running: { dot: isPaused ? 'bg-orange-400 animate-none' : 'bg-blue-400 animate-pulse', label: isPaused ? 'Paused' : 'Running' },
    reserved: { dot: 'bg-amber-400', label: 'Reserved' },
    maintenance: { dot: 'bg-red-400', label: 'Maintenance' },
  };

  const cfg = statusConfig[table.status] || statusConfig.available;

  return (
    <motion.div layout initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.2 }}>
      <Card className={cn('overflow-hidden transition-all duration-300 hover:shadow-lg hover:shadow-primary/10 cursor-default',
        table.status === 'running' && !isPaused && 'border-blue-500/40',
        table.status === 'available' && 'border-emerald-500/20',
        isPaused && 'border-orange-500/40',
        table.status === 'maintenance' && 'border-red-500/30',
      )}>
        {/* Color stripe top */}
        <div className={cn('h-1.5', getCategoryColor(table.type))} />

        <CardContent className="p-4 space-y-3">
          {/* Header */}
          <div className="flex items-start justify-between gap-2">
            <div>
              <h3 className="font-bold text-base leading-tight">{table.name}</h3>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className={cn('h-1.5 w-1.5 rounded-full', cfg.dot)} />
                <span className="text-xs text-muted-foreground">{cfg.label}</span>
                <span className="text-muted-foreground/40">·</span>
                <span className="text-xs text-muted-foreground">{table.type}</span>
              </div>
            </div>
          </div>

          {/* Session info */}
          {session && table.status === 'running' ? (
            <div className={cn('rounded-xl p-3 space-y-1.5', isPaused ? 'bg-orange-500/10 border border-orange-500/20' : 'bg-blue-500/10 border border-blue-500/20')}>
              {(session.customerName || session.customer?.name) && (
                <p className="text-xs font-semibold text-foreground truncate">
                  👤 {session.customerName || session.customer?.name}
                </p>
              )}
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-2xl font-bold font-mono text-foreground">{formatElapsedTime(seconds)}</p>
                  <p className="text-xs text-muted-foreground">elapsed</p>
                </div>
              </div>
            </div>
          ) : (
            <div className="h-[84px] rounded-xl bg-muted/30 flex items-center justify-center">
              <span className="text-3xl opacity-30">
                {getTableIcon(table.type)}
              </span>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-1.5">
            {table.status === 'available' && (
              <Button size="sm" className="flex-1" onClick={() => onAction('start', table)}>
                ▶ Start
              </Button>
            )}
            {table.status === 'running' && !isPaused && (
              <>
                <Button size="sm" variant="outline" className="flex-1" onClick={() => onAction('pause', table)}>
                  ⏸
                </Button>
                <Button size="sm" variant="outline" className="flex-1" onClick={() => onAction('extend', table)}>
                  +
                </Button>
                <Button size="sm" variant="destructive" className="flex-1" onClick={() => onAction('stop', table)}>
                  ■ Stop
                </Button>
              </>
            )}
            {table.status === 'running' && isPaused && (
              <>
                <Button size="sm" className="flex-1" onClick={() => onAction('resume', table)}>
                  ▶ Resume
                </Button>
                <Button size="sm" variant="destructive" className="flex-1" onClick={() => onAction('stop', table)}>
                  ■ Stop
                </Button>
              </>
            )}
            {table.status === 'maintenance' && (
              <Button size="sm" variant="outline" className="flex-1" onClick={() => onAction('setAvailable', table)}>
                Mark Available
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function TablesPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const { selectedBranch } = useAppStore();
  const { onTableUpdate } = useSocket();

  const [filterType, setFilterType] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [activeTable, setActiveTable] = useState<Table | null>(null);
  const [modal, setModal] = useState<'start' | 'extend' | 'stop' | null>(null);
  const [startForm, setStartForm] = useState({ customerId: '', customerSearch: '', customerName: '', phoneNumber: '', extraPlayers: '' });
  const [extendMinutes, setExtendMinutes] = useState(30);
  const [customerResults, setCustomerResults] = useState<Customer[]>([]);
  const [phoneError, setPhoneError] = useState('');

  const emptyStopForm: PaymentFormValues & { notes: string } = {
    paymentStatus: 'paid',
    paymentMethod: 'cash',
    cashAmount: '0',
    onlineAmount: '0',
    walletAmount: '',
    amountReceived: '',
    pendingPaymentAmount: '0',
    billAmount: '0',
    addToWallet: false,
    extraAmount: '0',
    walletBalance: 0,
    notes: '',
  };

  const [stopForm, setStopForm] = useState<PaymentFormValues & { notes: string }>(emptyStopForm);
  const [stopLoading, setStopLoading] = useState(false);

  const params: Record<string, string> = {};
  if (selectedBranch) params.branch = selectedBranch;

  const { data, isLoading } = useQuery({
    queryKey: ['tables', selectedBranch],
    queryFn: () => tableService.getAll(params).then((r) => r.data.data.tables),
    refetchInterval: 300000,
  });

  const availableTypes = Array.from(new Set((data || []).map((t: Table) => t.type.toLowerCase())));

  // Real-time socket updates
  useEffect(() => {
    const off = onTableUpdate((updatedTable) => {
      qc.setQueryData(['tables', selectedBranch], (old: Table[] | undefined) =>
        old ? old.map((t) => (t._id === updatedTable._id ? updatedTable : t)) : old
      );
    });
    return off;
  }, [selectedBranch]);

  const tables = (data || []).filter((t: Table) => {
    if (filterType !== 'all' && t.type.toLowerCase() !== filterType.toLowerCase()) return false;
    const effectiveStatus = (t.currentSession as any)?.status === 'paused' ? 'paused' : t.status;
    if (filterStatus !== 'all' && effectiveStatus !== filterStatus) return false;
    return true;
  });

  // Mutations
  const startMutation = useMutation({
    mutationFn: (data: { tableId: string; customerId?: string; customerName: string; phoneNumber: string; extraPlayers: string[] }) =>
      sessionService.start(data.tableId, data.customerId, data.customerName, data.phoneNumber, data.extraPlayers),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['tables'] }); toast.success('Session started!'); setModal(null); setStartForm({ customerId: '', customerSearch: '', customerName: '', phoneNumber: '', extraPlayers: '' }); setPhoneError(''); },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed to start session'),
  });

  const pauseMutation = useMutation({
    mutationFn: (sessionId: string) => sessionService.pause(sessionId),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['tables'] }); toast.info('Session paused'); },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed'),
  });

  const resumeMutation = useMutation({
    mutationFn: (sessionId: string) => sessionService.resume(sessionId),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['tables'] }); toast.success('Session resumed'); },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed'),
  });

  const extendMutation = useMutation({
    mutationFn: ({ sessionId, minutes }: { sessionId: string; minutes: number }) =>
      sessionService.extend(sessionId, minutes),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['tables'] }); toast.success(`Extended by ${extendMinutes} minutes`); setModal(null); },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed'),
  });

  const updateTableMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => tableService.update(id, { status } as any),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['tables'] }); toast.success('Table updated'); },
  });

  const searchCustomers = useCallback(async (query: string) => {
    if (query.length < 2) { setCustomerResults([]); return; }
    try {
      const params: Record<string, string> = { search: query };
      if (selectedBranch) params.branch = selectedBranch;
      const res = await customerService.getAll(params);
      setCustomerResults(res.data.data.customers);
    } catch { setCustomerResults([]); }
  }, [selectedBranch]);

  const handleAction = (action: string, table: Table) => {
    setActiveTable(table);
    const session = table.currentSession as any;
    const sessionId = session?._id;
    if (action === 'start') { setModal('start'); }
    else if (action === 'pause') { if (sessionId) pauseMutation.mutate(sessionId); }
    else if (action === 'resume') { if (sessionId) resumeMutation.mutate(sessionId); }
    else if (action === 'extend') { setModal('extend'); }
    else if (action === 'setAvailable') { updateTableMutation.mutate({ id: table._id, status: 'available' }); }
    else if (action === 'stop') {
      if (!session) return;
      const elapsedSecs = getElapsedSeconds(session.startTime, session.pauses || []);
      const billableMins = Math.ceil(elapsedSecs / 60) + (session.extendedMinutes || 0);
      const hourlyRate = session.hourlyRate || table.hourlyRate || 0;
      const computedBillAmount = Math.round((billableMins / 60) * hourlyRate);

      setStopForm({
        paymentStatus: 'paid',
        paymentMethod: 'cash',
        cashAmount: '',
        onlineAmount: '',
        walletAmount: '',
        amountReceived: '',
        pendingPaymentAmount: '',
        billAmount: String(computedBillAmount),
        addToWallet: false,
        extraAmount: '0',
        walletBalance: (session.customer as any)?.walletBalance || 0,
        notes: '',
      });
      setModal('stop');
    }
  };

  const handleCompleteStopAndPay = async () => {
    if (!activeTable) return;
    const session = activeTable.currentSession as any;
    if (!session) return;

    setStopLoading(true);
    try {
      const billAmt = Number(stopForm.billAmount) || 0;
      const recAmt = stopForm.amountReceived === '' ? billAmt : (Number(stopForm.amountReceived) || 0);

      let computedStatus: 'paid' | 'partial' | 'unpaid' = 'paid';
      if (recAmt === 0 && billAmt > 0) computedStatus = 'unpaid';
      else if (recAmt < billAmt) computedStatus = 'partial';
      else computedStatus = 'paid';

      // 1. Stop session in backend (calculates final duration, frees table)
      const stopRes = await sessionService.stop(session._id);
      const stoppedSession = stopRes.data.data.session;

      // 2. Create Official Bill using billingService (initialize as 'unpaid' so receivePayment can record payment receipt)
      const billRes = await billingService.create({
        sessionId: stoppedSession._id,
        branch: stoppedSession.branch,
        branchId: stoppedSession.branch,
        customerId: stoppedSession.customer,
        manualAmount: billAmt,
        paymentStatus: 'unpaid',
        paymentMethod: stopForm.paymentMethod,
      });
      const bill = billRes.data.data.bill;

      // 3. Receive payment if status is paid or partial
      if (computedStatus !== 'unpaid' && bill) {
        let paidAmt = Math.min(recAmt, billAmt);
        if (stopForm.paymentMethod === 'mixed') {
          paidAmt = (Number(stopForm.cashAmount) || 0) + (Number(stopForm.onlineAmount) || 0) + (Number(stopForm.walletAmount) || 0);
        }

        const breakdownItems = [
          { method: 'cash', amount: Number(stopForm.cashAmount) || 0 },
          { method: 'upi', amount: Number(stopForm.onlineAmount) || 0 },
          { method: 'wallet', amount: Number(stopForm.walletAmount) || 0 }
        ].filter(item => item.amount > 0);

        await billingService.receivePayment(bill._id, {
          method: stopForm.paymentMethod,
          amount: paidAmt,
          breakdown: breakdownItems,
        });
      }

      // 4. Update customer wallet if customer paid extra and selected addToWallet
      if (stopForm.addToWallet && stoppedSession.customer && recAmt > billAmt) {
        const extra = recAmt - billAmt;
        const customerIdStr = typeof stoppedSession.customer === 'object' && stoppedSession.customer !== null
          ? (stoppedSession.customer as any)._id
          : String(stoppedSession.customer);

        await customerService.receivePayment(customerIdStr, {
          amount: extra,
          paymentMethod: stopForm.paymentMethod,
          notes: `Overpayment credit to wallet from table ${activeTable.name}`
        });
      }

      toast.success(`Session completed & Invoice ${bill?.invoiceNumber ? '#' + bill.invoiceNumber : ''} generated!`);
      qc.invalidateQueries({ queryKey: ['tables'] });
      qc.invalidateQueries({ queryKey: ['bills'] });
      qc.invalidateQueries({ queryKey: ['customers'] });
      qc.invalidateQueries({ queryKey: ['pending-payments'] });
      qc.invalidateQueries({ queryKey: ['dashboard-stats'] });
      setModal(null);
      setActiveTable(null);
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Failed to complete stop and payment');
    } finally {
      setStopLoading(false);
    }
  };

  const statusCounts = (data || []).reduce((acc: any, t: Table) => {
    const s = (t.currentSession as any)?.status === 'paused' ? 'paused' : t.status;
    acc[s] = (acc[s] || 0) + 1;
    return acc;
  }, {});

  return (
    <div className="space-y-5 animate-fade-in">
      <PageHeader
        title="Live Tables"
        actions={
          <Button size="sm" onClick={() => qc.invalidateQueries({ queryKey: ['tables'] })}>
            🔄 Refresh
          </Button>
        }
      />

      {/* Quick stats */}
      <div className="flex flex-wrap gap-2">
        {[
          { label: 'Running', count: statusCounts.running || 0, color: 'bg-blue-500/10 text-blue-400 border-blue-500/20' },
          { label: 'Available', count: statusCounts.available || 0, color: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' },
          { label: 'Paused', count: statusCounts.paused || 0, color: 'bg-orange-500/10 text-orange-400 border-orange-500/20' },
          { label: 'Reserved', count: statusCounts.reserved || 0, color: 'bg-amber-500/10 text-amber-400 border-amber-500/20' },
          { label: 'Maintenance', count: statusCounts.maintenance || 0, color: 'bg-red-500/10 text-red-400 border-red-500/20' },
        ].map((s) => (
          <button key={s.label} onClick={() => setFilterStatus(filterStatus === s.label.toLowerCase() ? 'all' : s.label.toLowerCase())}
            className={cn('px-3 py-1.5 rounded-xl border text-xs font-medium transition-colors', s.color, filterStatus === s.label.toLowerCase() && 'ring-2 ring-current')}
          >
            {s.label}: {s.count}
          </button>
        ))}
      </div>

      {/* Type filters */}
      <div className="flex flex-wrap gap-2">
        {['all', ...availableTypes].map((type) => (
          <button key={type} onClick={() => setFilterType(type)}
            className={cn('px-4 py-1.5 rounded-xl border text-xs font-semibold capitalize transition-colors',
              filterType === type ? 'gradient-brand text-white border-transparent' : 'border-border text-muted-foreground hover:bg-accent'
            )}
          >
            {type === 'all' ? 'All Types' : type.toUpperCase()}
          </button>
        ))}
      </div>

      {/* Tables Grid */}
      {isLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {[...Array(10)].map((_, i) => <Skeleton key={i} className="h-52" />)}
        </div>
      ) : tables.length === 0 ? (
        <EmptyState icon="🎱" title="No tables found" description="Try adjusting your filters" />
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          <AnimatePresence>
            {tables.map((table: Table) => (
              <TableCard key={table._id} table={table} onAction={handleAction} />
            ))}
          </AnimatePresence>
        </div>
      )}

      {/* Start Session Modal */}
      <Modal open={modal === 'start'} onClose={() => setModal(null)} title={`Start Session — ${activeTable?.name}`} size="md">
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Customer Name *</Label>
            <Input
              placeholder="Enter customer name"
              value={startForm.customerName}
              onChange={(e) => setStartForm((f) => ({ ...f, customerName: e.target.value }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Mobile Number *</Label>
            <Input
              placeholder="10-digit mobile number"
              value={startForm.phoneNumber}
              onChange={(e) => {
                const numericPhone = e.target.value.replace(/\D/g, '').slice(0, 10);
                setStartForm((f) => ({ ...f, phoneNumber: numericPhone }));
                if (numericPhone.length > 0 && numericPhone.length < 10) {
                  setPhoneError('Mobile number must contain exactly 10 digits.');
                } else {
                  setPhoneError('');
                }
              }}
              maxLength={10}
            />
            {phoneError && <p className="text-xs text-red-400">{phoneError}</p>}
          </div>
          <div className="space-y-1.5">
            <Label>Extra Players (optional)</Label>
            <Input
              placeholder="Enter player names separated by commas"
              value={startForm.extraPlayers}
              onChange={(e) => setStartForm((f) => ({ ...f, extraPlayers: e.target.value }))}
            />
          </div>
          <div className="flex gap-2 pt-2">
            <Button variant="outline" className="flex-1" onClick={() => setModal(null)}>Cancel</Button>
            <Button className="flex-1"
              loading={startMutation.isPending}
              onClick={() => {
                if (!startForm.customerName) { toast.error('Customer Name is required'); return; }
                if (!startForm.phoneNumber) { toast.error('Mobile Number is required'); return; }
                if (startForm.phoneNumber.length !== 10) { toast.error('Mobile Number must be exactly 10 digits'); return; }
                if (activeTable) startMutation.mutate({ 
                  tableId: activeTable._id, 
                  customerId: startForm.customerId, 
                  customerName: startForm.customerName, 
                  phoneNumber: startForm.phoneNumber, 
                  extraPlayers: startForm.extraPlayers.split(',').map(p => p.trim()).filter(p => p) 
                });
              }}
            >
              ▶ Start Session
            </Button>
          </div>
        </div>
      </Modal>

      {/* Extend Modal */}
      <Modal open={modal === 'extend'} onClose={() => setModal(null)} title={`Extend Session — ${activeTable?.name}`} size="sm">
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Additional Minutes</Label>
            <div className="flex gap-2">
              {[15, 30, 45, 60].map((m) => (
                <button key={m} onClick={() => setExtendMinutes(m)}
                  className={cn('flex-1 py-2 rounded-xl border text-sm font-semibold transition-colors',
                    extendMinutes === m ? 'gradient-brand text-white border-transparent' : 'border-border hover:bg-accent'
                  )}
                >
                  +{m}
                </button>
              ))}
            </div>
            <Input type="number" min={1} value={extendMinutes} onChange={(e) => setExtendMinutes(Number(e.target.value))} />
          </div>
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => setModal(null)}>Cancel</Button>
            <Button className="flex-1" loading={extendMutation.isPending}
              onClick={() => {
                const sessionId = (activeTable?.currentSession as any)?._id;
                if (sessionId) extendMutation.mutate({ sessionId, minutes: extendMinutes });
              }}
            >
              Extend
            </Button>
          </div>
        </div>
      </Modal>

      {/* Stop Session & Payment Modal */}
      <Modal open={modal === 'stop'} onClose={() => setModal(null)} title={`Stop Session & Payment — ${activeTable?.name}`} size="md">
        <div className="space-y-4">
          {/* Summary Header — Essential Information Only */}
          <div className="p-3 rounded-xl bg-blue-500/10 border border-blue-500/20 space-y-1.5 text-xs">
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">Table / Item</span>
              <strong className="text-foreground font-semibold">{activeTable?.name} ({activeTable?.type})</strong>
            </div>
            {((activeTable?.currentSession as any)?.customerName || (activeTable?.currentSession as any)?.customer?.name) && (
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">Customer</span>
                <strong className="text-foreground">{(activeTable?.currentSession as any)?.customerName || (activeTable?.currentSession as any)?.customer?.name}</strong>
              </div>
            )}
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">Duration Played</span>
              <strong className="text-foreground font-mono">{formatElapsedTime(getElapsedSeconds((activeTable?.currentSession as any)?.startTime, (activeTable?.currentSession as any)?.pauses || []))}</strong>
            </div>
          </div>

          {/* Exact Reused PaymentForm Component from Add New Customer (Editable prefilled Bill Amount) */}
          <PaymentForm
            values={stopForm}
            onChange={(paymentValues) => setStopForm((f) => ({ ...f, ...paymentValues }))}
            showBillAmountField={true}
            readOnlyBillAmount={false}
          />

          {/* Notes */}
          <div className="space-y-1.5">
            <Label>Notes</Label>
            <Input
              placeholder="Enter notes (optional)"
              value={stopForm.notes}
              onChange={(e) => setStopForm((f) => ({ ...f, notes: e.target.value }))}
            />
          </div>

          <div className="flex gap-2 pt-2">
            <Button variant="outline" className="flex-1" onClick={() => setModal(null)}>Cancel</Button>
            <Button className="flex-1" loading={stopLoading} onClick={handleCompleteStopAndPay}>
              Complete Stop & Pay
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
