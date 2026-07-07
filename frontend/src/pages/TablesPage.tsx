import { useState, useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { tableService, sessionService, customerService } from '@/services';
import { useAppStore } from '@/store';
import { useSocket } from '@/hooks/useSocket';
import type { Table, Customer } from '@/types';
import {
  Button, Card, CardContent, Badge, Modal, Input, Label,
  Select, EmptyState, Skeleton, PageHeader, useToast
} from '@/components/ui';
import {
  cn, formatCurrency, TABLE_TYPE_COLORS, STATUS_COLORS,
  getElapsedMinutes, getRunningAmount
} from '@/utils';
import { useNavigate } from 'react-router-dom';

// ── Live timer that re-renders every 10s ──────────────────────────────────────
function useRunningTimer(session: any) {
  const [minutes, setMinutes] = useState(0);
  useEffect(() => {
    if (!session || session.status === 'paused') {
      setMinutes(session?.billableMinutes || 0);
      return;
    }
    const tick = () => setMinutes(getElapsedMinutes(session.startTime, session.pauses || []));
    tick();
    const id = setInterval(tick, 10000);
    return () => clearInterval(id);
  }, [session]);
  return minutes;
}

// ── Individual Table Card ─────────────────────────────────────────────────────
function TableCard({ table, onAction }: { table: Table; onAction: (action: string, table: Table) => void }) {
  const session = table.currentSession as any;
  const minutes = useRunningTimer(session);
  const amount = session ? getRunningAmount(minutes + (session.extendedMinutes || 0), session.hourlyRate) : 0;
  const isPaused = session?.status === 'paused';

  const statusConfig: Record<string, { dot: string; label: string }> = {
    available: { dot: 'bg-emerald-400', label: 'Available' },
    running: { dot: isPaused ? 'bg-orange-400 animate-none' : 'bg-blue-400 animate-pulse', label: isPaused ? 'Paused' : 'Running' },
    reserved: { dot: 'bg-amber-400', label: 'Reserved' },
    maintenance: { dot: 'bg-red-400', label: 'Maintenance' },
  };

  const cfg = statusConfig[table.status] || statusConfig.available;

  const formatMins = (m: number) => {
    const h = Math.floor(m / 60), min = m % 60;
    return h > 0 ? `${h}h ${min}m` : `${min}m`;
  };

  return (
    <motion.div layout initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.2 }}>
      <Card className={cn('overflow-hidden transition-all duration-300 hover:shadow-lg hover:shadow-primary/10 cursor-default',
        table.status === 'running' && !isPaused && 'border-blue-500/40',
        table.status === 'available' && 'border-emerald-500/20',
        isPaused && 'border-orange-500/40',
        table.status === 'maintenance' && 'border-red-500/30',
      )}>
        {/* Color stripe top */}
        <div className={cn('h-1.5', TABLE_TYPE_COLORS[table.type])} />

        <CardContent className="p-4 space-y-3">
          {/* Header */}
          <div className="flex items-start justify-between gap-2">
            <div>
              <h3 className="font-bold text-base leading-tight">{table.name}</h3>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className={cn('h-1.5 w-1.5 rounded-full', cfg.dot)} />
                <span className="text-xs text-muted-foreground">{cfg.label}</span>
                <span className="text-muted-foreground/40">·</span>
                <span className="text-xs text-muted-foreground capitalize">{table.type}</span>
              </div>
            </div>
            <span className="text-xs font-medium text-muted-foreground shrink-0">
              {formatCurrency(table.hourlyRate)}/hr
            </span>
          </div>

          {/* Session info */}
          {session && table.status === 'running' ? (
            <div className={cn('rounded-xl p-3 space-y-1.5', isPaused ? 'bg-orange-500/10 border border-orange-500/20' : 'bg-blue-500/10 border border-blue-500/20')}>
              {session.customer && (
                <p className="text-xs font-semibold text-foreground truncate">
                  👤 {session.customer.name}
                </p>
              )}
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-2xl font-bold text-foreground">{formatMins(minutes)}</p>
                  <p className="text-xs text-muted-foreground">elapsed</p>
                </div>
                <div className="text-right">
                  <p className="text-xl font-bold text-emerald-400">{formatCurrency(amount)}</p>
                  <p className="text-xs text-muted-foreground">current bill</p>
                </div>
              </div>
            </div>
          ) : (
            <div className="h-[84px] rounded-xl bg-muted/30 flex items-center justify-center">
              <span className="text-3xl opacity-30">
                {table.type === 'pool' ? '🎱' : table.type === 'snooker' ? '🟢' : '🎮'}
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
  const [modal, setModal] = useState<'start' | 'extend' | null>(null);
  const [startForm, setStartForm] = useState({ customerId: '', customerSearch: '' });
  const [extendMinutes, setExtendMinutes] = useState(30);
  const [customerResults, setCustomerResults] = useState<Customer[]>([]);

  const params: Record<string, string> = {};
  if (selectedBranch) params.branch = selectedBranch;

  const { data, isLoading } = useQuery({
    queryKey: ['tables', selectedBranch],
    queryFn: () => tableService.getAll(params).then((r) => r.data.data.tables),
    refetchInterval: 20000,
  });

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
    if (filterType !== 'all' && t.type !== filterType) return false;
    const effectiveStatus = (t.currentSession as any)?.status === 'paused' ? 'paused' : t.status;
    if (filterStatus !== 'all' && effectiveStatus !== filterStatus) return false;
    return true;
  });

  // Mutations
  const startMutation = useMutation({
    mutationFn: ({ tableId, customerId }: { tableId: string; customerId?: string }) =>
      sessionService.start(tableId, customerId || undefined),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['tables'] }); toast.success('Session started!'); setModal(null); },
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

  const stopMutation = useMutation({
    mutationFn: (sessionId: string) => sessionService.stop(sessionId),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['tables'] });
      toast.success('Session stopped!');
      const session = res.data.data.session;
      navigate(`/billing/new?sessionId=${session._id}&branch=${session.branch}`);
    },
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
    const sessionId = (table.currentSession as any)?._id;
    if (action === 'start') { setModal('start'); }
    else if (action === 'pause') { if (sessionId) pauseMutation.mutate(sessionId); }
    else if (action === 'resume') { if (sessionId) resumeMutation.mutate(sessionId); }
    else if (action === 'stop') { if (sessionId) stopMutation.mutate(sessionId); }
    else if (action === 'extend') { setModal('extend'); }
    else if (action === 'setAvailable') { updateTableMutation.mutate({ id: table._id, status: 'available' }); }
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
        {['all', 'pool', 'snooker', 'ps5'].map((type) => (
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
          <p className="text-sm text-muted-foreground">
            Rate: <strong>{formatCurrency(activeTable?.hourlyRate || 0)}/hr</strong> · Type: <strong className="capitalize">{activeTable?.type}</strong>
          </p>
          <div className="space-y-1.5">
            <Label>Customer (optional)</Label>
            <Input
              placeholder="Search by name or phone..."
              value={startForm.customerSearch}
              onChange={(e) => {
                setStartForm((f) => ({ ...f, customerSearch: e.target.value }));
                searchCustomers(e.target.value);
              }}
            />
            {customerResults.length > 0 && (
              <div className="mt-1 rounded-xl border border-border bg-card shadow-lg max-h-40 overflow-y-auto">
                {customerResults.map((c) => (
                  <button key={c._id}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-accent transition-colors flex items-center justify-between"
                    onClick={() => {
                      setStartForm({ customerId: c._id, customerSearch: `${c.name} (${c.phone})` });
                      setCustomerResults([]);
                    }}
                  >
                    <span className="font-medium">{c.name}</span>
                    <span className="text-muted-foreground">{c.phone}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="flex gap-2 pt-2">
            <Button variant="outline" className="flex-1" onClick={() => setModal(null)}>Cancel</Button>
            <Button className="flex-1"
              loading={startMutation.isPending}
              onClick={() => {
                if (activeTable) startMutation.mutate({ tableId: activeTable._id, customerId: startForm.customerId });
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
    </div>
  );
}
