import { useState, useEffect, useCallback, useMemo } from 'react';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

import { motion, AnimatePresence } from 'framer-motion';

import { tableService, sessionService, customerService, billingService, menuService } from '@/services';

import { useAppStore, useAuthStore } from '@/store';

import { useSocket } from '@/hooks/useSocket';

import type { Table, Customer, MenuCategoryDoc, MenuItem, SessionItem } from '@/types';

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



  // Serialize pauses to a string so any mutation (new pause entry, resumeTime added)

  // is detected immediately — not just array-length changes.

  const pausesKey = JSON.stringify(session?.pauses ?? []);



  useEffect(() => {

    if (!session) {

      setSeconds(0);

      return;

    }

    if (session.status === 'paused') {

      // Timer is frozen — compute the elapsed time at the moment of pause and hold it

      const pausedSecs = getElapsedSeconds(session.startTime, session.pauses || []);

      setSeconds(pausedSecs);

      return; // No interval — timer stays frozen

    }

    const tick = () => {

      setSeconds(getElapsedSeconds(session.startTime, session.pauses || []));

    };

    tick();

    const id = setInterval(tick, 1000);

    return () => clearInterval(id);

  // eslint-disable-next-line react-hooks/exhaustive-deps

  }, [session?.startTime, session?.status, pausesKey]);



  return seconds;

}



// ── Individual Table Card ─────────────────────────────────────────────────────

function TableCard({ table, onAction, isPauseLoading, isResumeLoading }: { table: Table; onAction: (action: string, table: Table) => void; isPauseLoading?: boolean; isResumeLoading?: boolean }) {

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

              {session.addedItems && session.addedItems.length > 0 ? (

                <p className="text-xs text-muted-foreground truncate">

                  🛍️ Added: {session.addedItems.map((i: any) => `${i.itemName}${i.quantity > 1 ? ` (×${i.quantity})` : ''}`).join(', ')}

                </p>

              ) : (session.menuItem || session.menuItemId?.name || session.menuCategory) ? (

                <p className="text-xs text-muted-foreground truncate">

                  🏷️ {session.menuCategory || (typeof session.menuCategoryId === 'object' ? session.menuCategoryId?.name : '') ? `${session.menuCategory || (typeof session.menuCategoryId === 'object' ? session.menuCategoryId?.name : '')} · ` : ''}{session.menuItem || (typeof session.menuItemId === 'object' ? session.menuItemId?.name : '')}

                </p>

              ) : null}

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

              <Button size="sm" className="flex-1 h-10 text-sm font-medium" onClick={() => onAction('start', table)}>

                ▶ Start

              </Button>

            )}

            {table.status === 'running' && session && session.status === 'running' && (

              <>

                <Button size="sm" variant="outline" className="flex-1 h-10" loading={isPauseLoading} disabled={isPauseLoading} onClick={() => onAction('pause', table)}>

                  ⏸

                </Button>

                <Button size="sm" variant="outline" className="flex-1 h-10" disabled={isPauseLoading} onClick={() => onAction('extend', table)}>

                  +⏱

                </Button>

                <Button size="sm" variant="outline" className="flex-1 h-10" disabled={isPauseLoading} onClick={() => onAction('edit', table)}>

                  ✏️

                </Button>

                <Button size="sm" variant="destructive" className="flex-1 h-10" disabled={isPauseLoading} onClick={() => onAction('stop', table)}>

                  ■

                </Button>

              </>

            )}

            {table.status === 'running' && session && session.status === 'paused' && (

              <>

                <Button size="sm" className="flex-1 h-10" loading={isResumeLoading} disabled={isResumeLoading} onClick={() => onAction('resume', table)}>

                  ▶ Resume

                </Button>

                <Button size="sm" variant="outline" className="flex-1 h-10" disabled={isResumeLoading} onClick={() => onAction('edit', table)}>

                  ✏️

                </Button>

                <Button size="sm" variant="destructive" className="flex-1 h-10" disabled={isResumeLoading} onClick={() => onAction('stop', table)}>

                  ■

                </Button>

              </>

            )}

            {table.status === 'maintenance' && (

              <Button size="sm" variant="outline" className="flex-1 h-10" onClick={() => onAction('setAvailable', table)}>

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

  const { user } = useAuthStore();

  const { onTableUpdate } = useSocket();



  const [filterType, setFilterType] = useState('all');

  const [filterStatus, setFilterStatus] = useState('all');

  const [activeTable, setActiveTable] = useState<Table | null>(null);

  const [modal, setModal] = useState<'start' | 'extend' | 'stop' | 'editSession' | null>(null);

  const [editForm, setEditForm] = useState<{ menuCategoryId: string; menuItemId: string }>({

    menuCategoryId: '',

    menuItemId: '',

  });

  const [startForm, setStartForm] = useState({ customerDbId: '', customerDisplayId: '', customerSearch: '', customerName: '', phoneNumber: '', extraPlayers: '' });
  const [startSessionWalletBalance, setStartSessionWalletBalance] = useState(0);

  const [extendMinutes, setExtendMinutes] = useState(30);

  const [customerResults, setCustomerResults] = useState<Customer[]>([]);

  const [phoneError, setPhoneError] = useState('');

  const [isRefreshing, setIsRefreshing] = useState(false);

  // Determine branch context for tables

  const tableBranch = selectedBranch || (user?.role !== 'super_admin' && user?.role !== 'admin' 

    ? (typeof user?.branches?.[0] === 'string' ? user.branches[0] : user?.branches?.[0]?._id)

    : undefined);

  // Auto-lookup wallet balance and Customer ID for Start Session modal when 10-digit mobile number is entered
  useEffect(() => {
    if (startForm.phoneNumber && startForm.phoneNumber.length === 10) {
      const branchToUse = tableBranch || (activeTable?.branch as any)?._id || (activeTable?.branch as any) || selectedBranch || undefined;
      customerService.lookup(startForm.phoneNumber, branchToUse)
        .then((res) => {
          const customer = res.data.data.customer;
          if (customer) {
            setStartSessionWalletBalance(customer.walletBalance || 0);
            setStartForm((f) => ({ ...f, customerDbId: customer._id || '', customerDisplayId: customer.customerId || '', customerName: customer.name || '' }));
          } else {
            setStartSessionWalletBalance(0);
            setStartForm((f) => ({ ...f, customerDbId: '', customerDisplayId: '' }));
          }
        })
        .catch(() => {
          setStartSessionWalletBalance(0);
          setStartForm((f) => ({ ...f, customerDbId: '', customerDisplayId: '' }));
        });
    } else {
      setStartSessionWalletBalance(0);
      setStartForm((f) => ({ ...f, customerDbId: '', customerDisplayId: '' }));
    }
  }, [startForm.phoneNumber, tableBranch, activeTable?.branch, selectedBranch]);



  // Fetch menu categories for Edit Live Session modal

  const { data: categoriesData } = useQuery({

    queryKey: ['menu-categories'],

    queryFn: () => menuService.getCategories({ activeOnly: 'true' }).then((r) => r.data),

    staleTime: 10 * 60 * 1000,

    gcTime: 15 * 60 * 1000,

  });



  const categories: MenuCategoryDoc[] = Array.isArray((categoriesData as any)?.data?.categories)

    ? (categoriesData as any).data.categories

    : [];



  const allowedEditCategories = useMemo(() => {

    const allowedNames = ['beverage', 'beverages', 'accessory', 'accessories'];

    return categories.filter((cat) => allowedNames.includes(cat.name?.toLowerCase().trim()));

  }, [categories]);



  const branchToFetch = selectedBranch || '';



  const { data: editMenuItemsData, isFetching: isEditMenuItemsLoading } = useQuery({

    queryKey: ['edit-menu-items', editForm.menuCategoryId, branchToFetch],

    queryFn: () => menuService.getAll({ category: editForm.menuCategoryId, branch: branchToFetch, limit: '1000', activeOnly: 'true' }).then((r) => r.data),

    enabled: !!editForm.menuCategoryId && modal === 'editSession',

  });



  const editMenuItems: MenuItem[] = Array.isArray((editMenuItemsData as any)?.data?.items)

    ? (editMenuItemsData as any).data.items

    : [];



  const updateSessionMenuMutation = useMutation({

    mutationFn: (d: { sessionId: string; menuCategoryId: string; menuItemId: string }) =>

      sessionService.updateMenu(d.sessionId, d.menuCategoryId, d.menuItemId),

    onSuccess: () => {

      toast.success('Live session menu updated!');

      setModal(null);

      setActiveTable(null);

    },

    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed to update live session menu'),

  });



  const handleUpdateSessionMenu = () => {

    if (!activeTable || !activeTable.currentSession) return;

    if (!editForm.menuCategoryId) {

      toast.error('Menu Category is required');

      return;

    }

    if (!editForm.menuItemId) {

      toast.error('Menu Item is required');

      return;

    }

    const session = activeTable.currentSession as any;

    updateSessionMenuMutation.mutate({

      sessionId: session._id,

      menuCategoryId: editForm.menuCategoryId,

      menuItemId: editForm.menuItemId,

    });

  };



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

  if (tableBranch) params.branch = tableBranch;



  const { data, isLoading } = useQuery({

    queryKey: ['tables', tableBranch],

    queryFn: () => tableService.getAll(params).then((r) => r.data.data.tables),

    refetchInterval: 5 * 60_000,  // 5min safety fallback poll; socket handles real-time

    staleTime: Infinity,          // Socket.io pushes updates — don't mark stale between polls

  });



  const availableTypes = useMemo(() => Array.from(new Set((data || []).map((t: Table) => t.type.toLowerCase()))), [data]);



  // Real-time socket updates — patch whichever cache keys contain this table

  useEffect(() => {

    const off = onTableUpdate((updatedTable) => {

      console.log('[TablesPage] Received socket update:', updatedTable);



      const patchCache = (key: (string | undefined)[]) => {

        qc.setQueryData(key, (old: Table[] | undefined) => {

          if (!old) return old;

          // If this table exists in this cache, update it

          const exists = old.some((t) => t._id === updatedTable._id);

          if (!exists) return old;

          return old.map((t) => (t._id === updatedTable._id ? updatedTable : t));

        });

      };



      // Always patch the current view's cache key

      patchCache(['tables', tableBranch]);



      // Also patch the "all branches" cache (tableBranch = undefined) so super_admin

      // switching between "all" and a specific branch always sees fresh data

      if (tableBranch !== undefined) {

        patchCache(['tables', undefined]);

      }

    });

    return off;

  }, [tableBranch]);



  const tables = useMemo(() => (data || []).filter((t: Table) => {

    if (filterType !== 'all' && t.type.toLowerCase() !== filterType.toLowerCase()) return false;

    const effectiveStatus = (t.currentSession as any)?.status === 'paused' ? 'paused' : t.status;

    if (filterStatus !== 'all' && effectiveStatus !== filterStatus) return false;

    return true;

  }), [data, filterType, filterStatus]);



  // Mutations

  const startMutation = useMutation({

    mutationFn: (data: { tableId: string; customerId?: string; customerName: string; phoneNumber: string; extraPlayers: string[] }) =>

      sessionService.start(data.tableId, data.customerId, data.customerName, data.phoneNumber, data.extraPlayers),

    onSuccess: (res) => {

      // Socket will update the table card in real-time

      toast.success('Session started!');

      setModal(null);

      setStartForm({ customerDbId: '', customerDisplayId: '', customerSearch: '', customerName: '', phoneNumber: '', extraPlayers: '' });

      setPhoneError('');

    },

    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed to start session'),

  });



  const pauseMutation = useMutation({

    mutationFn: (sessionId: string) => sessionService.pause(sessionId),

    onSuccess: () => {

      // Socket (table:updated) handles cache update — no refetch needed here.

      // Calling refetchQueries races the socket push and can revert state.

      toast.info('Session paused');

    },

    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed'),

  });



  const resumeMutation = useMutation({

    mutationFn: (sessionId: string) => sessionService.resume(sessionId),

    onSuccess: () => {

      // Socket (table:updated) handles cache update — no refetch needed here.

      toast.success('Session resumed');

    },

    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed'),

  });



  const extendMutation = useMutation({

    mutationFn: ({ sessionId, minutes }: { sessionId: string; minutes: number }) =>

      sessionService.extend(sessionId, minutes),

    onSuccess: () => { toast.success(`Extended by ${extendMinutes} minutes`); setModal(null); },

    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed'),

  });



  const updateTableMutation = useMutation({

    mutationFn: ({ id, status }: { id: string; status: string }) => tableService.update(id, { status } as any),

    onSuccess: () => { toast.success('Table updated'); },

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

    else if (action === 'edit') {

      if (!session) return;

      const catId = typeof session.menuCategoryId === 'object' && session.menuCategoryId !== null

        ? session.menuCategoryId._id

        : session.menuCategoryId || '';

      const itemId = typeof session.menuItemId === 'object' && session.menuItemId !== null

        ? session.menuItemId._id

        : session.menuItemId || '';

      setEditForm({

        menuCategoryId: catId,

        menuItemId: itemId,

      });

      setModal('editSession');

    }

    else if (action === 'setAvailable') { updateTableMutation.mutate({ id: table._id, status: 'available' }); }

    else if (action === 'stop') {

      if (!session) return;

      const elapsedSecs = getElapsedSeconds(session.startTime, session.pauses || []);

      const billableMins = Math.ceil(elapsedSecs / 60) + (session.extendedMinutes || 0);

      const hourlyRate = session.hourlyRate || table.hourlyRate || 0;

      const computedGameAmount = Math.round((billableMins / 60) * hourlyRate);



      const addedItems: SessionItem[] = session.addedItems || [];

      const addedItemsTotal = addedItems.reduce((sum, item) => sum + (item.totalAmount || 0), 0);

      const computedGrandTotal = computedGameAmount + addedItemsTotal;



      const phone = session.phoneNumber || (typeof session.customer === 'object' ? (session.customer?.phone || session.customer?.mobileNumber) : '') || '';
      const initialWalletBal = (typeof session.customer === 'object' ? session.customer?.walletBalance : 0) || 0;

      setStopForm({

        paymentStatus: 'paid',

        paymentMethod: 'cash',

        cashAmount: '',

        onlineAmount: '',

        walletAmount: '',

        amountReceived: '',

        pendingPaymentAmount: '',

        billAmount: String(computedGrandTotal),

        addToWallet: false,

        extraAmount: '0',

        walletBalance: initialWalletBal,

        notes: '',

      });

      setModal('stop');

      if (phone && phone.length === 10) {
        const branchToUse = tableBranch || (table.branch as any)?._id || (table.branch as any) || selectedBranch || undefined;
        customerService.lookup(phone, branchToUse)
          .then((res) => {
            const customer = res.data.data.customer;
            if (customer) {
              setStopForm((f) => ({ ...f, walletBalance: customer.walletBalance || 0 }));
            }
          })
          .catch(() => {});
      }

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



      // Optimistically mark the table as available in the cache immediately —

      // don't wait for socket or refetch; this makes the UI instant.

      const optimisticallyFreeTable = (old: Table[] | undefined) => {

        if (!old) return old;

        return old.map((t) =>

          t._id === activeTable._id

            ? { ...t, status: 'available' as const, currentSession: null }

            : t

        );

      };

      qc.setQueryData(['tables', tableBranch], optimisticallyFreeTable);

      qc.setQueryData(['tables', undefined], optimisticallyFreeTable);



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

      setModal(null);

      setActiveTable(null);



      // Refetch in background to sync any server-side differences

      // qc.refetchQueries({ queryKey: ['tables', tableBranch] }); // Socket handles table update

      qc.invalidateQueries({ queryKey: ['bills'] });

      qc.invalidateQueries({ queryKey: ['customers'] });

      qc.invalidateQueries({ queryKey: ['pending-payments'] });

      qc.invalidateQueries({ queryKey: ['dashboard-stats'] });

    } catch (err: any) {

      toast.error(err?.response?.data?.message || 'Failed to complete stop and payment');

    } finally {

      setStopLoading(false);

    }

  };



  const statusCounts = useMemo(() => (data || []).reduce((acc: any, t: Table) => {

    const s = (t.currentSession as any)?.status === 'paused' ? 'paused' : t.status;

    acc[s] = (acc[s] || 0) + 1;

    return acc;

  }, {}), [data]);



  const handleRefresh = async () => {

    if (isRefreshing) return;

    setIsRefreshing(true);

    try {

      // qc.refetchQueries({ queryKey: ['tables', tableBranch] }); // Socket handles real-time updates

      toast.success('Live tables refreshed successfully');

    } catch (error) {

      toast.error('Failed to refresh live tables');

    } finally {

      setIsRefreshing(false);

    }

  };



  return (

    <div className="space-y-5 animate-fade-in">

      <PageHeader

        title="Live Tables"

        actions={

          <Button size="sm" onClick={handleRefresh} loading={isRefreshing || isLoading} disabled={isRefreshing || isLoading}>

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

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 sm:gap-4">

          {[...Array(10)].map((_, i) => <Skeleton key={i} className="h-52" />)}

        </div>

      ) : tables.length === 0 ? (

        <EmptyState icon="🎱" title="No tables found" description="Try adjusting your filters" />

      ) : (

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 sm:gap-4">

          <AnimatePresence>

            {tables.map((table: Table) => (

                <TableCard

                  key={table._id}

                  table={table}

                  onAction={handleAction}

                  isPauseLoading={pauseMutation.isPending && (activeTable?._id === table._id)}

                  isResumeLoading={resumeMutation.isPending && (activeTable?._id === table._id)}

                />

            ))}

          </AnimatePresence>

        </div>

      )}



      {/* Start Session Modal */}

      <Modal open={modal === 'start'} onClose={() => setModal(null)} title={`Start Session — ${activeTable?.name}`} size="md">

        <div className="space-y-4">

          <div className="space-y-1.5">
            <Label>Customer ID</Label>
            <Input
              value={startForm.customerDisplayId}
              placeholder="Will be auto-generated or fetched"
              readOnly
              className="bg-muted cursor-not-allowed font-mono text-primary font-semibold"
            />
          </div>

          <div className="space-y-1.5">

            <Label>Customer Name *</Label>

            <Input

              placeholder="Enter customer name"

              value={startForm.customerName}

              onChange={(e) => {

                const filtered = e.target.value.replace(/[^A-Za-z\s'-]/g, '');

                setStartForm((f) => ({ ...f, customerName: filtered }));

              }}

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

            {startForm.phoneNumber && startForm.phoneNumber.length === 10 && !phoneError && (

              <p className="text-xs font-semibold text-emerald-400 mt-1">

                Available Wallet Balance: {formatCurrency(startSessionWalletBalance)}

              </p>

            )}

          </div>

          <div className="space-y-1.5">

            <Label>Extra Players (optional)</Label>

            <Input

              placeholder="Enter player names separated by commas"

              value={startForm.extraPlayers}

              onChange={(e) => {

                const filtered = e.target.value.replace(/[^A-Za-z\s',-]/g, '');

                setStartForm((f) => ({ ...f, extraPlayers: filtered }));

              }}

            />

          </div>

          <div className="flex gap-2 pt-2">

            <Button variant="outline" className="flex-1" onClick={() => setModal(null)}>Cancel</Button>

            <Button className="flex-1"

              loading={startMutation.isPending}

              onClick={() => {

                if (!startForm.customerName) { toast.error('Customer Name is required'); return; }

                const trimmedName = startForm.customerName.trim();

                if (!trimmedName) { toast.error('Customer Name cannot be empty or whitespace only'); return; }

                

                const nameRegex = /^[A-Za-z\s'-]+$/;

                if (!nameRegex.test(trimmedName)) {

                  toast.error("Customer Name must only contain letters, spaces, hyphens (-), and apostrophes (')");

                  return;

                }

                

                if (!startForm.phoneNumber) { toast.error('Mobile Number is required'); return; }

                if (startForm.phoneNumber.length !== 10) { toast.error('Mobile Number must be exactly 10 digits'); return; }

                

                const players = startForm.extraPlayers.split(',').map(p => p.trim()).filter(p => p);

                for (const p of players) {

                  if (!nameRegex.test(p)) {

                    toast.error(`Extra Player name "${p}" must only contain letters, spaces, hyphens (-), and apostrophes (')`);

                    return;

                  }

                }

                

                if (activeTable) startMutation.mutate({ 

                  tableId: activeTable._id, 

                  customerId: startForm.customerDbId, 

                  customerName: trimmedName, 

                  phoneNumber: startForm.phoneNumber, 

                  extraPlayers: players

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
            {(activeTable?.currentSession as any)?.customer?.customerId && (
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">Customer ID</span>
                <strong className="text-foreground font-mono text-primary font-semibold">{(activeTable?.currentSession as any).customer.customerId}</strong>
              </div>
            )}

            <div className="flex justify-between items-center">

              <span className="text-muted-foreground">Duration Played</span>

              <strong className="text-foreground font-mono">{formatElapsedTime(getElapsedSeconds((activeTable?.currentSession as any)?.startTime, (activeTable?.currentSession as any)?.pauses || []))}</strong>

            </div>

            <div className="flex justify-between items-center pt-1 border-t border-blue-500/20">

              <span className="text-muted-foreground">Game / Table Amount</span>

              <strong className="text-foreground font-semibold">

                {formatCurrency(Math.round((Math.ceil(getElapsedSeconds((activeTable?.currentSession as any)?.startTime, (activeTable?.currentSession as any)?.pauses || []) / 60) + ((activeTable?.currentSession as any)?.extendedMinutes || 0)) / 60 * ((activeTable?.currentSession as any)?.hourlyRate || activeTable?.hourlyRate || 0)))}

              </strong>

            </div>

          </div>



          {/* Added Items Section (Read-Only) */}

          <div className="p-3 rounded-xl bg-muted/30 border border-border space-y-2.5">

            <div className="flex items-center justify-between">

              <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Added Items</h4>

              {((activeTable?.currentSession as any)?.addedItems || []).length > 0 && (

                <span className="text-xs font-semibold text-emerald-400">

                  Subtotal: {formatCurrency(((activeTable?.currentSession as any)?.addedItems || []).reduce((sum: number, item: any) => sum + (item.totalAmount || 0), 0))}

                </span>

              )}

            </div>



            {((activeTable?.currentSession as any)?.addedItems || []).length === 0 ? (

              <p className="text-xs text-muted-foreground italic">No beverages or accessories added during session.</p>

            ) : (

              <div className="space-y-2">

                {Object.entries(

                  ((activeTable?.currentSession as any)?.addedItems || []).reduce((groups: Record<string, any[]>, item: any) => {

                    const cat = item.categoryName || 'Other';

                    if (!groups[cat]) groups[cat] = [];

                    groups[cat].push(item);

                    return groups;

                  }, {})

                ).map(([categoryName, items]: [string, any]) => (

                  <div key={categoryName} className="space-y-1">

                    <p className="text-xs font-bold text-primary tracking-wide uppercase">{categoryName}</p>

                    <div className="space-y-1 pl-2">

                      {items.map((item: any, idx: number) => (

                        <div key={idx} className="flex justify-between items-center text-xs">

                          <span className="text-foreground">

                            • {item.itemName} <span className="text-muted-foreground font-mono">× {item.quantity}</span>

                          </span>

                          <span className="text-muted-foreground font-mono">

                            {item.quantity > 1 ? `₹${item.unitPrice} each — ` : ''}

                            <strong className="text-foreground font-semibold">{formatCurrency(item.totalAmount)}</strong>

                          </span>

                        </div>

                      ))}

                    </div>

                  </div>

                ))}

              </div>

            )}

          </div>



          {/* Billing Calculation Breakdown */}

          <div className="p-3 rounded-xl bg-primary/10 border border-primary/20 space-y-1 text-xs">

            <div className="flex justify-between items-center">

              <span className="text-muted-foreground">Game Amount</span>

              <span className="font-semibold">{formatCurrency(Math.round((Math.ceil(getElapsedSeconds((activeTable?.currentSession as any)?.startTime, (activeTable?.currentSession as any)?.pauses || []) / 60) + ((activeTable?.currentSession as any)?.extendedMinutes || 0)) / 60 * ((activeTable?.currentSession as any)?.hourlyRate || activeTable?.hourlyRate || 0)))}</span>

            </div>

            {((activeTable?.currentSession as any)?.addedItems || []).length > 0 && (

              <div className="flex justify-between items-center">

                <span className="text-muted-foreground">Added Items Total</span>

                <span className="font-semibold text-emerald-400">{formatCurrency(((activeTable?.currentSession as any)?.addedItems || []).reduce((sum: number, item: any) => sum + (item.totalAmount || 0), 0))}</span>

              </div>

            )}

            <div className="flex justify-between items-center pt-1.5 border-t border-primary/20 text-sm font-bold">

              <span>Final Bill Amount</span>

              <span className="text-primary font-mono text-base">{formatCurrency(Number(stopForm.billAmount) || 0)}</span>

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



      {/* Edit Live Session Modal */}

      <Modal open={modal === 'editSession'} onClose={() => setModal(null)} title={`Edit Live Session — ${activeTable?.name}`} size="md">

        <div className="space-y-4">

          <div className="space-y-1.5">

            <Label>Menu Category *</Label>

            <Select

              value={editForm.menuCategoryId}

              onChange={(e) => setEditForm((f) => ({ ...f, menuCategoryId: e.target.value, menuItemId: '' }))}

            >

              <option value="">Select Menu Category</option>

              {allowedEditCategories.map((cat) => (

                <option key={cat._id} value={cat._id}>

                  {cat.name}

                </option>

              ))}

            </Select>

          </div>



          <div className="space-y-1.5">

            <Label>Menu Item *</Label>

            <Select

              value={editForm.menuItemId}

              onChange={(e) => setEditForm((f) => ({ ...f, menuItemId: e.target.value }))}

              disabled={!editForm.menuCategoryId || isEditMenuItemsLoading}

            >

              <option value="">{isEditMenuItemsLoading ? 'Loading items...' : 'Select Menu Item'}</option>

              {editMenuItems.map((item) => (

                <option key={item._id} value={item._id}>

                  {item.name} {item.price ? `(${formatCurrency(item.price)})` : ''}

                </option>

              ))}

            </Select>

          </div>



          <div className="flex gap-2 pt-2">

            <Button variant="outline" className="flex-1" onClick={() => setModal(null)}>

              Cancel

            </Button>

            <Button

              className="flex-1"

              loading={updateSessionMenuMutation.isPending}

              onClick={handleUpdateSessionMenu}

            >

              Update

            </Button>

          </div>

        </div>

      </Modal>

    </div>

  );

}

