import { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { reportService } from '@/services';
import { useAppStore, useAuthStore } from '@/store';
import { Button, Card, CardContent, CardHeader, CardTitle, PageHeader, Skeleton, useToast, Table2, TableHeader, TableBody, TableRow, TableHead, TableCell, Input, Badge, Modal } from '@/components/ui';
import { formatCurrency, formatDuration, formatDateTime, downloadBlob, cn } from '@/utils';
import { useDebounce } from '@/hooks/useDebounce';

type GroupBy = 'day' | 'week' | 'month';

const toLocalDateString = (d: Date): string => {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export default function ReportsPage() {
  const toast = useToast();
  const qc = useQueryClient();
  const { selectedBranch } = useAppStore();
  const { user } = useAuthStore();
  const [tab, setTab] = useState<'revenue' | 'tables' | 'pnl' | 'branches'>('revenue');
  const [groupBy, setGroupBy] = useState<GroupBy>('day');
  const [activeFilter, setActiveFilter] = useState<'day' | 'week' | 'month' | null>('month');
  const [shouldFetch, setShouldFetch] = useState(false);

  // User input states (can change without triggering refetch)
  const [inputFrom, setInputFrom] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return toLocalDateString(d);
  });
  const [inputTo, setInputTo] = useState(() => toLocalDateString(new Date()));

  // Active search query states (only updated when clicking "Search" or quick filter)
  const [searchFrom, setSearchFrom] = useState(inputFrom);
  const [searchTo, setSearchTo] = useState(inputTo);
  const [searchBranch, setSearchBranch] = useState('');

  // Determine if user can select branch (Super Admin and Admin can)
  const canSelectBranch = user?.role === 'super_admin' || user?.role === 'admin';

  // Compute active branch ID
  const getActiveBranchId = () => {
    return (selectedBranch && canSelectBranch)
      ? String(selectedBranch)
      : (!canSelectBranch && user?.branches?.[0] ? (typeof user.branches[0] === 'string' ? user.branches[0] : (user.branches[0] as any)?._id || '') : '');
  };

  // Selected search params packaged for APIs
  const searchParams: Record<string, string> = {
    from: searchFrom,
    to: searchTo,
  };
  if (searchBranch) {
    searchParams.branch = searchBranch;
  }

  const { data: revenueData, isLoading: revLoading } = useQuery({
    queryKey: ['report-revenue', searchBranch, searchFrom, searchTo, groupBy, shouldFetch],
    queryFn: () => reportService.getRevenue({ ...searchParams, groupBy }).then((r) => r.data.data),
    enabled: shouldFetch,
  });

  const { data: tableData } = useQuery({
    queryKey: ['report-tables', searchBranch, searchFrom, searchTo, shouldFetch],
    queryFn: () => reportService.getTableUsage({ ...searchParams }).then((r) => r.data.data),
    enabled: shouldFetch,
  });

  const { data: branchData } = useQuery({
    queryKey: ['report-branches', searchFrom, searchTo, shouldFetch],
    queryFn: () => reportService.getBranchComparison(searchParams).then((r) => r.data.data),
    enabled: canSelectBranch && shouldFetch,
  });

  // Build unified chart data from both revenue and expenses timelines
  const allDates = Array.from(new Set([
    ...(revenueData?.revenue || []).map((r: any) => r._id),
    ...(revenueData?.expenses || []).map((e: any) => e._id),
  ])).sort();

  const chartData = allDates.map((date) => {
    const rev = (revenueData?.revenue || []).find((r: any) => r._id === date);
    const exp = (revenueData?.expenses || []).find((e: any) => e._id === date);
    const revenue = rev?.total || 0;
    const expenses = exp?.total || 0;
    return {
      date,
      revenue,
      expenses,
      profit: revenue - expenses,
      invoices: rev?.count || 0,
    };
  });

  const handleExport = async (type: string) => {
    try {
      const res = await reportService.exportExcel({ ...searchParams, type, groupBy });
      const filename = type === 'complete'
        ? `thegoldenframe-complete-report-${searchFrom}-to-${searchTo}.xlsx`
        : `thegoldenframe-${type}-${searchFrom}-to-${searchTo}.xlsx`;
      downloadBlob(res.data as Blob, filename);
      toast.success(type === 'complete' ? 'Complete report exported!' : `${type} report exported!`);
    } catch {
      toast.error('Export failed');
    }
  };

  const [orderPage, setOrderPage] = useState(1);
  const [orderSearch, setOrderSearch] = useState('');
  const debouncedOrderSearch = useDebounce(orderSearch, 300);
  const [orderSortBy, setOrderSortBy] = useState('createdAt');
  const [orderSortOrder, setOrderSortOrder] = useState<'asc' | 'desc'>('desc');
  const [selectedInvoice, setSelectedInvoice] = useState<any>(null);

  const { data: orderData, isLoading: ordersLoading } = useQuery({
    queryKey: ['report-orders', searchBranch, searchFrom, searchTo, orderPage, debouncedOrderSearch, orderSortBy, orderSortOrder, shouldFetch],
    queryFn: () => reportService.getOrders({
      ...searchParams,
      page: String(orderPage),
      limit: '10',
      search: debouncedOrderSearch,
      sortBy: orderSortBy,
      sortOrder: orderSortOrder,
    }).then((r) => r.data.data),
    enabled: shouldFetch,
  });

  const { data: orderSummaryData } = useQuery({
    queryKey: ['report-orders-summary', searchBranch, searchFrom, searchTo, shouldFetch],
    queryFn: () => reportService.getOrdersSummary({
      ...searchParams,
    }).then((r) => r.data.data),
    enabled: shouldFetch,
  });

  const handleExportPendingPayments = async () => {
    try {
      const res = await reportService.exportExcel({
        ...searchParams,
        type: 'pending_payments',
      });
      downloadBlob(res.data as Blob, `thegoldenframe-pending-payments-${searchFrom}-to-${searchTo}.xlsx`);
      toast.success('Pending payments report exported!');
    } catch {
      toast.error('Export failed');
    }
  };

  const handleSearch = () => {
    const activeBranch = getActiveBranchId();

    setActiveFilter(null);
    setSearchBranch(activeBranch);
    setSearchFrom(inputFrom);
    setSearchTo(inputTo);
    setShouldFetch(true);
    setOrderPage(1);

    qc.invalidateQueries({ queryKey: ['report-revenue'] });
    qc.invalidateQueries({ queryKey: ['report-tables'] });
    qc.invalidateQueries({ queryKey: ['report-branches'] });
    qc.invalidateQueries({ queryKey: ['report-orders'] });
    qc.invalidateQueries({ queryKey: ['report-orders-summary'] });
  };

  const applyFilter = (filter: 'day' | 'week' | 'month') => {
    setActiveFilter(filter);
    const toDate = new Date();
    const fromDate = new Date();
    if (filter === 'day') {
      // today
    } else if (filter === 'week') {
      fromDate.setDate(toDate.getDate() - 6);
    } else if (filter === 'month') {
      fromDate.setDate(toDate.getDate() - 29);
    }
    
    const fromStr = toLocalDateString(fromDate);
    const toStr = toLocalDateString(toDate);
    
    setInputFrom(fromStr);
    setInputTo(toStr);
    setSearchFrom(fromStr);
    setSearchTo(toStr);
    setGroupBy('day');
    setShouldFetch(true);
    setOrderPage(1);

    const activeBranch = getActiveBranchId();
    setSearchBranch(activeBranch);

    qc.invalidateQueries({ queryKey: ['report-revenue'] });
    qc.invalidateQueries({ queryKey: ['report-tables'] });
    qc.invalidateQueries({ queryKey: ['report-branches'] });
    qc.invalidateQueries({ queryKey: ['report-orders'] });
    qc.invalidateQueries({ queryKey: ['report-orders-summary'] });
  };

  const handleSort = (field: string) => {
    if (orderSortBy === field) {
      setOrderSortOrder(orderSortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setOrderSortBy(field);
      setOrderSortOrder('desc');
    }
    setOrderPage(1);
  };

  // Sync searchBranch whenever selectedBranch changes in store
  useEffect(() => {
    const activeBranch = getActiveBranchId();
    setSearchBranch(activeBranch);
  }, [selectedBranch, canSelectBranch, user]);

  // Trigger initial fetch on page load
  useEffect(() => {
    const initialBranch = getActiveBranchId();
    setSearchBranch(initialBranch);
    setSearchFrom(inputFrom);
    setSearchTo(inputTo);
    setShouldFetch(true);
  }, []);

  const TABS = [
    { id: 'revenue', label: '💰 Revenue' },
    { id: 'tables', label: '🎱 Tables' },
    { id: 'pnl', label: '📊 P&L' },
    ...(canSelectBranch ? [{ id: 'branches', label: '🏢 Branches' }] : []),
  ];

  return (
    <div className="space-y-5 animate-fade-in">
      <PageHeader
        title="Reports & Analytics"
        actions={
          <div className="flex flex-wrap gap-2 w-full sm:w-auto items-center">
            <Button
              size="sm"
              className="gradient-brand text-white flex-1 min-w-[150px] sm:flex-none text-center justify-center font-semibold shadow-md hover:opacity-90 transition-opacity"
              onClick={() => handleExport('complete')}
            >
              📥 Download Excel
            </Button>
            <Button size="sm" variant="outline" className="flex-1 min-w-[140px] sm:flex-none text-center justify-center" onClick={handleExportPendingPayments}>
              Pending Payments Excel
            </Button>
          </div>
        }
      />

      {/* Date range + quick filters */}
      <div className="flex flex-col md:flex-row md:items-center gap-3 w-full">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 flex-1 w-full">
          <input
            type="date"
            value={inputFrom}
            onChange={(e) => setInputFrom(e.target.value)}
            className="h-9 px-3 rounded-xl border border-input bg-background text-sm w-full sm:w-auto flex-1 focus:ring-1 focus:ring-primary focus:outline-none"
          />
          <span className="text-muted-foreground text-center sm:text-left text-sm font-medium">to</span>
          <input
            type="date"
            value={inputTo}
            onChange={(e) => setInputTo(e.target.value)}
            className="h-9 px-3 rounded-xl border border-input bg-background text-sm w-full sm:w-auto flex-1 focus:ring-1 focus:ring-primary focus:outline-none"
          />
          <Button size="sm" onClick={handleSearch} className="w-full sm:w-auto font-medium">
            🔍 Search
          </Button>
        </div>
        <div className="flex gap-1 w-full md:w-auto justify-start">
          {(['day', 'week', 'month'] as const).map((g) => (
            <button
              key={g}
              onClick={() => applyFilter(g)}
              className={cn(
                'flex-1 md:flex-initial text-center px-3 py-1.5 rounded-xl border text-xs font-semibold capitalize transition-colors',
                activeFilter === g ? 'gradient-brand text-white border-transparent' : 'border-border text-muted-foreground hover:bg-accent'
              )}
            >
              {g}
            </button>
          ))}
        </div>
      </div>

      {/* Tab nav */}
      <div className="flex gap-2 border-b border-border pb-0 overflow-x-auto whitespace-nowrap scrollbar-none">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id as any)}
            className={cn(
              'px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px flex-shrink-0',
              tab === t.id ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Revenue Tab */}
      {tab === 'revenue' && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle>Revenue vs Expenses ({searchFrom} to {searchTo})</CardTitle>
          </CardHeader>
          <CardContent>
            {revLoading ? (
              <Skeleton className="h-64" />
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <AreaChart data={chartData}>
                  <defs>
                    <linearGradient id="gr" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="ge" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                  <YAxis
                    tick={{ fontSize: 11, fill: '#64748b' }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`}
                  />
                  <Tooltip
                    contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '12px' }}
                    formatter={(v: any) => [formatCurrency(v), '']}
                  />
                  <Legend />
                  <Area type="monotone" dataKey="revenue" stroke="#3b82f6" fill="url(#gr)" strokeWidth={2} name="Revenue" />
                  <Area type="monotone" dataKey="expenses" stroke="#ef4444" fill="url(#ge)" strokeWidth={2} name="Expenses" />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      )}

      {/* Tables Tab */}
      {tab === 'tables' && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle>Table Performance ({searchFrom} to {searchTo})</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {(tableData?.usage || []).map((t: any) => {
                const maxRevenue = Math.max(...(tableData?.usage || []).map((x: any) => x.totalRevenue));
                const pct = maxRevenue > 0 ? (t.totalRevenue / maxRevenue) * 100 : 0;
                return (
                  <div key={t._id.tableId} className="space-y-1.5">
                    <div className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <div
                          className={cn(
                            'h-6 w-6 rounded-lg flex items-center justify-center text-white text-xs font-bold',
                            t._id.type?.toLowerCase() === 'pool'
                              ? 'bg-blue-500'
                              : t._id.type?.toLowerCase() === 'snooker'
                              ? 'bg-emerald-500'
                              : 'bg-purple-500'
                          )}
                        >
                          {t._id.type?.[0]?.toUpperCase()}
                        </div>
                        <span className="font-medium">{t._id.tableName}</span>
                        <span className="text-xs text-muted-foreground">
                          ({t.totalSessions} sessions · {formatDuration(t.totalMinutes || 0)})
                        </span>
                      </div>
                      <span className="font-bold text-emerald-400">{formatCurrency(t.totalRevenue)}</span>
                    </div>
                    <div className="h-2 rounded-full bg-muted overflow-hidden">
                      <div className="h-full rounded-full gradient-brand transition-all duration-500" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
              {!tableData?.usage?.length && (
                <p className="text-center text-muted-foreground py-8">No table data for this period</p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* P&L Tab */}
      {tab === 'pnl' && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle>Profit & Loss ({searchFrom} to {searchTo})</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                <YAxis
                  tick={{ fontSize: 11, fill: '#64748b' }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`}
                />
                <Tooltip
                  contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '12px' }}
                  formatter={(v: any) => [formatCurrency(v), '']}
                />
                <Legend />
                <Bar dataKey="revenue" name="Revenue" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                <Bar dataKey="profit" name="Profit" fill="#22c55e" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Branches Tab */}
      {tab === 'branches' && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle>Branch Comparison ({searchFrom} to {searchTo})</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {(branchData?.comparison || []).map((b: any) => (
                <div key={b._id} className="rounded-xl border border-border p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold">{b.branchName}</h3>
                    <span className={cn('text-sm font-bold', b.profit >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                      {b.profit >= 0 ? '+' : ''}{formatCurrency(b.profit)}
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-3 text-center text-sm">
                    <div>
                      <p className="text-muted-foreground text-xs">Revenue</p>
                      <p className="font-bold text-blue-400">{formatCurrency(b.revenue)}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground text-xs">Expenses</p>
                      <p className="font-bold text-red-400">{formatCurrency(b.expenses)}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground text-xs">Invoices</p>
                      <p className="font-bold">{b.bills}</p>
                    </div>
                  </div>
                </div>
              ))}
              {!branchData?.comparison?.length && (
                <p className="text-center text-muted-foreground py-8">No branch data available</p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {shouldFetch && (
        <div className="space-y-6">
          {/* Order Details & Summary Section */}
          <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-4 lg:grid-cols-8 gap-3 sm:gap-4">
            {[
              { label: 'Total Orders', value: orderSummaryData?.summary?.totalOrders ?? 0, color: 'text-blue-400' },
              { label: 'Total Bill Amount', value: formatCurrency(orderSummaryData?.summary?.totalBilled ?? 0), color: 'text-sky-400' },
              { label: 'Total Revenue', value: formatCurrency(orderSummaryData?.summary?.totalRevenue ?? 0), color: 'text-emerald-400' },
              { label: 'Cash Collection', value: formatCurrency(orderSummaryData?.summary?.totalCashCollection ?? 0), color: 'text-green-400' },
              { label: 'UPI Collection', value: formatCurrency(orderSummaryData?.summary?.totalUPICollection ?? 0), color: 'text-purple-400' },
              { label: 'Wallet Payments', value: formatCurrency(orderSummaryData?.summary?.totalWalletPayments ?? 0), color: 'text-indigo-400' },
              { label: 'Pending Amount', value: formatCurrency(orderSummaryData?.summary?.totalPendingAmount ?? 0), color: 'text-red-400' },
              { label: 'Average Order Value', value: formatCurrency(orderSummaryData?.summary?.averageOrderValue ?? 0), color: 'text-amber-400' },
            ].map((s) => (
              <Card key={s.label}>
                <CardContent className="p-3 text-center">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold truncate" title={s.label}>
                    {s.label}
                  </p>
                  <p className={cn('text-sm sm:text-base md:text-lg font-bold mt-1 break-words', s.color)} title={s.value}>
                    {s.value}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Wallet Transaction Details */}
          {orderSummaryData?.walletTransactions && orderSummaryData.walletTransactions.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-purple-400">💳 Wallet Transaction Details</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto border border-border rounded-xl">
                  <Table2>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="whitespace-nowrap">Order ID</TableHead>
                        <TableHead className="whitespace-nowrap">Customer Name</TableHead>
                        <TableHead className="whitespace-nowrap">Mobile Number</TableHead>
                        <TableHead className="whitespace-nowrap">Wallet Credit</TableHead>
                        <TableHead className="whitespace-nowrap">Wallet Debit</TableHead>
                        <TableHead className="whitespace-nowrap">Remaining Balance</TableHead>
                        <TableHead className="whitespace-nowrap">Transaction Time</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {orderSummaryData.walletTransactions.map((tx: any, idx: number) => (
                        <TableRow key={idx}>
                          <TableCell className="font-mono text-xs whitespace-nowrap">{tx.orderId}</TableCell>
                          <TableCell className="text-sm font-medium whitespace-nowrap">{tx.customerName}</TableCell>
                          <TableCell className="text-sm whitespace-nowrap">{tx.mobileNumber || '—'}</TableCell>
                          <TableCell className="text-sm font-semibold text-emerald-400 whitespace-nowrap">
                            {tx.walletCredit > 0 ? `+${formatCurrency(tx.walletCredit)}` : '—'}
                          </TableCell>
                          <TableCell className="text-sm font-semibold text-red-400 whitespace-nowrap">
                            {tx.walletDebit > 0 ? `-${formatCurrency(tx.walletDebit)}` : '—'}
                          </TableCell>
                          <TableCell className="text-sm font-bold text-blue-400 whitespace-nowrap">
                            {formatCurrency(tx.remainingBalance)}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                            {new Date(tx.createdAt).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' })}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table2>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Top Selling Items */}
          {orderSummaryData?.topSellingItems && orderSummaryData.topSellingItems.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-amber-400">🔥 Top Selling Items</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4">
                  {orderSummaryData.topSellingItems.map((item: any, idx: number) => (
                    <Card key={idx} className="bg-muted/30">
                      <CardContent className="p-4 text-center">
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold truncate" title={item.category}>
                          {item.category}
                        </p>
                        <p className="text-base font-bold mt-1 text-foreground truncate" title={item.name}>
                          {item.name}
                        </p>
                        <div className="inline-flex items-center gap-1.5 mt-2 bg-amber-500/10 text-amber-400 px-2.5 py-0.5 rounded-full text-xs font-bold border border-amber-500/25">
                          {item.quantitySold} sold
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Revenue & Invoices Table */}
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <CardTitle className="text-blue-400">💰 Revenue & Invoices</CardTitle>
                <div className="flex items-center gap-2">
                  <Input
                    placeholder="Search invoice, customer, phone..."
                    value={orderSearch}
                    onChange={(e) => { setOrderSearch(e.target.value); setOrderPage(1); }}
                    className="w-56 h-8 text-sm"
                  />
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto border border-border rounded-xl">
                <Table2>
                  <TableHeader>
                    <TableRow>
                      <TableHead 
                        className="whitespace-nowrap cursor-pointer hover:bg-accent"
                        onClick={() => handleSort('orderId')}
                      >
                        Invoice / Order # {orderSortBy === 'orderId' && (orderSortOrder === 'asc' ? '↑' : '↓')}
                      </TableHead>
                      <TableHead className="whitespace-nowrap">Customer</TableHead>
                      <TableHead className="whitespace-nowrap">Phone</TableHead>
                      <TableHead className="whitespace-nowrap">Branch</TableHead>
                      <TableHead 
                        className="whitespace-nowrap cursor-pointer hover:bg-accent"
                        onClick={() => handleSort('billAmount')}
                      >
                        Total Bill {orderSortBy === 'billAmount' && (orderSortOrder === 'asc' ? '↑' : '↓')}
                      </TableHead>
                      <TableHead className="whitespace-nowrap">Cash Received</TableHead>
                      <TableHead className="whitespace-nowrap">Online Received</TableHead>
                      <TableHead
                        className="whitespace-nowrap cursor-pointer hover:bg-accent"
                        onClick={() => handleSort('pendingAmount')}
                      >
                        Pending Amount {orderSortBy === 'pendingAmount' && (orderSortOrder === 'asc' ? '↑' : '↓')}
                      </TableHead>
                      <TableHead className="whitespace-nowrap">Payment Method</TableHead>
                      <TableHead className="whitespace-nowrap">Payment Status</TableHead>
                      <TableHead 
                        className="whitespace-nowrap cursor-pointer hover:bg-accent"
                        onClick={() => handleSort('createdAt')}
                      >
                        Date {orderSortBy === 'createdAt' && (orderSortOrder === 'asc' ? '↑' : '↓')}
                      </TableHead>
                      <TableHead className="whitespace-nowrap">Details</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {ordersLoading ? (
                      <TableRow>
                        <TableCell colSpan={12} className="text-center py-8">
                          <Skeleton className="h-8 w-full" />
                        </TableCell>
                      </TableRow>
                    ) : orderData?.data && orderData.data.length > 0 ? (
                      orderData.data.map((order: any, idx: number) => {
                        const cashAmt = order.cashAmount || 0;
                        const onlineAmt = order.onlineAmount || 0;
                        const totalReceived = order.totalReceived ?? order.totalPaid ?? order.amountReceived ?? (cashAmt + onlineAmt + (order.walletUsed || 0));
                        const pendingAmount = order.pendingAmount ?? Math.max(0, (order.billAmount || 0) - totalReceived);
                        const paymentMethodDisplay = order.paymentMethodDisplay || (order.paymentMethod === 'upi' || order.paymentMethod === 'card' ? 'Online' : order.paymentMethod || '—');
                        const paymentStatusDisplay = order.paymentStatusDisplay || (order.paymentStatus === 'paid' ? 'Paid' : order.paymentStatus === 'partial' ? 'Partially Paid' : order.paymentStatus === 'refunded' ? 'Refunded' : 'Unpaid');
                        return (
                          <TableRow key={order._id || idx} className="hover:bg-muted/20">
                            <TableCell className="font-mono text-xs whitespace-nowrap">
                              <div>{order.orderId}</div>
                              {order.recordType && (
                                <span className="text-[10px] text-muted-foreground">{order.recordType}</span>
                              )}
                            </TableCell>
                            <TableCell className="text-sm font-medium whitespace-nowrap">{order.customerName || 'Walk-in'}</TableCell>
                            <TableCell className="text-sm whitespace-nowrap">{order.mobileNumber || '—'}</TableCell>
                            <TableCell className="text-sm whitespace-nowrap">{order.branchName || '—'}</TableCell>
                            <TableCell className="text-sm font-bold text-blue-400 whitespace-nowrap">
                              {formatCurrency(order.billAmount || 0)}
                            </TableCell>
                            <TableCell className="text-sm font-semibold text-green-400 whitespace-nowrap">
                              {formatCurrency(cashAmt)}
                            </TableCell>
                            <TableCell className="text-sm font-semibold text-purple-400 whitespace-nowrap">
                              {formatCurrency(onlineAmt)}
                            </TableCell>
                            <TableCell className={cn('text-sm font-bold whitespace-nowrap', pendingAmount > 0 ? 'text-red-400' : 'text-muted-foreground')}>
                              {formatCurrency(pendingAmount)}
                            </TableCell>
                            <TableCell className="text-sm whitespace-nowrap">
                              <div>{paymentMethodDisplay}</div>
                              {paymentMethodDisplay === 'Mixed' && (
                                <span className="text-[10px] text-muted-foreground">
                                  C: {formatCurrency(cashAmt)} · O: {formatCurrency(onlineAmt)}
                                </span>
                              )}
                            </TableCell>
                            <TableCell className="whitespace-nowrap">
                              <Badge
                                variant={order.paymentStatus === 'paid' ? 'success' : order.paymentStatus === 'partial' ? 'warning' : 'danger'}
                              >
                                {paymentStatusDisplay}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                              {new Date(order.createdAt).toLocaleDateString('en-IN')}
                            </TableCell>
                            <TableCell className="whitespace-nowrap">
                              <Button size="sm" variant="ghost" onClick={() => setSelectedInvoice(order)}>
                                View
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      })
                    ) : (
                      <TableRow>
                        <TableCell colSpan={12} className="text-center py-8 text-muted-foreground">
                          No orders found for the selected date range
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table2>
              </div>
              {orderData?.pagination && (
                <div className="flex items-center justify-between mt-4">
                  <p className="text-sm text-muted-foreground">
                    Showing {orderData.pagination.total === 0 ? 0 : ((orderData.pagination.page - 1) * orderData.pagination.limit) + 1} to {Math.min(orderData.pagination.page * orderData.pagination.limit, orderData.pagination.total)} of {orderData.pagination.total} records
                  </p>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={orderData.pagination.page === 1}
                      onClick={() => setOrderPage(orderData.pagination.page - 1)}
                    >
                      Previous
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={orderData.pagination.page * orderData.pagination.limit >= orderData.pagination.total}
                      onClick={() => setOrderPage(orderData.pagination.page + 1)}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Invoice & Payment Breakdown Modal */}
          <Modal
            open={!!selectedInvoice}
            onClose={() => setSelectedInvoice(null)}
            title={`Invoice / Order Details — ${selectedInvoice?.orderId || ''}`}
            size="lg"
          >
            {selectedInvoice && (() => {
              const cashAmt = selectedInvoice.cashAmount || 0;
              const onlineAmt = selectedInvoice.onlineAmount || 0;
              const walletAmt = selectedInvoice.walletUsed || 0;
              const totalReceived = selectedInvoice.totalReceived ?? (cashAmt + onlineAmt + walletAmt);
              const pendingAmt = selectedInvoice.pendingAmount ?? Math.max(0, (selectedInvoice.billAmount || 0) - totalReceived);
              const methodLabel = selectedInvoice.paymentMethodDisplay || '—';
              const statusLabel = selectedInvoice.paymentStatusDisplay || (selectedInvoice.paymentStatus === 'paid' ? 'Paid' : selectedInvoice.paymentStatus === 'partial' ? 'Partially Paid' : 'Unpaid');
              return (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 p-3.5 rounded-xl bg-muted/30 border border-border text-sm">
                    <div>
                      <span className="text-xs text-muted-foreground block">Invoice / Order #</span>
                      <span className="font-mono font-semibold">{selectedInvoice.orderId}</span>
                    </div>
                    <div>
                      <span className="text-xs text-muted-foreground block">Type</span>
                      <span className="font-medium">{selectedInvoice.recordType || 'Direct Order'}</span>
                    </div>
                    <div>
                      <span className="text-xs text-muted-foreground block">Date & Time</span>
                      <span className="text-xs">{formatDateTime(selectedInvoice.createdAt)}</span>
                    </div>
                    <div>
                      <span className="text-xs text-muted-foreground block">Customer</span>
                      <span className="font-medium">{selectedInvoice.customerName || 'Walk-in'}</span>
                    </div>
                    <div>
                      <span className="text-xs text-muted-foreground block">Mobile Number</span>
                      <span>{selectedInvoice.mobileNumber || '—'}</span>
                    </div>
                    <div>
                      <span className="text-xs text-muted-foreground block">Branch</span>
                      <span>{selectedInvoice.branchName || '—'}</span>
                    </div>
                    {(selectedInvoice.menuCategory || selectedInvoice.menuItem) && (
                      <div className="col-span-2 sm:col-span-3">
                        <span className="text-xs text-muted-foreground block">Category / Item</span>
                        <span>{[selectedInvoice.menuCategory, selectedInvoice.menuItem].filter(Boolean).join(' — ')}</span>
                      </div>
                    )}
                  </div>

                  {/* Complete Payment Breakdown */}
                  <div className="p-4 rounded-xl bg-card border border-border space-y-3">
                    <div className="flex items-center justify-between">
                      <h4 className="text-sm font-semibold">Payment Breakdown</h4>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline">{methodLabel}</Badge>
                        <Badge variant={selectedInvoice.paymentStatus === 'paid' ? 'success' : selectedInvoice.paymentStatus === 'partial' ? 'warning' : 'danger'}>
                          {statusLabel}
                        </Badge>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
                      <div className="p-2.5 rounded-lg bg-muted/30 border border-border/60">
                        <span className="text-xs text-muted-foreground block">Total Bill Amount</span>
                        <span className="text-base font-bold text-blue-400">{formatCurrency(selectedInvoice.billAmount || 0)}</span>
                      </div>
                      <div className="p-2.5 rounded-lg bg-muted/30 border border-border/60">
                        <span className="text-xs text-muted-foreground block">Cash Received</span>
                        <span className="text-base font-bold text-green-400">{formatCurrency(cashAmt)}</span>
                      </div>
                      <div className="p-2.5 rounded-lg bg-muted/30 border border-border/60">
                        <span className="text-xs text-muted-foreground block">Online Payment Received</span>
                        <span className="text-base font-bold text-purple-400">{formatCurrency(onlineAmt)}</span>
                      </div>
                      {walletAmt > 0 && (
                        <div className="p-2.5 rounded-lg bg-muted/30 border border-border/60">
                          <span className="text-xs text-muted-foreground block">Wallet Used</span>
                          <span className="text-base font-bold text-indigo-400">{formatCurrency(walletAmt)}</span>
                        </div>
                      )}
                      <div className="p-2.5 rounded-lg bg-muted/30 border border-border/60">
                        <span className="text-xs text-muted-foreground block">Total Amount Received</span>
                        <span className="text-base font-bold text-emerald-400">{formatCurrency(totalReceived)}</span>
                      </div>
                      <div className="p-2.5 rounded-lg bg-muted/30 border border-border/60">
                        <span className="text-xs text-muted-foreground block">Pending Amount</span>
                        <span className={cn('text-base font-bold', pendingAmt > 0 ? 'text-red-400' : 'text-muted-foreground')}>
                          {formatCurrency(pendingAmt)}
                        </span>
                      </div>
                    </div>

                    {methodLabel === 'Mixed' && (
                      <div className="text-xs text-muted-foreground bg-muted/20 px-3 py-2 rounded-lg border border-border/50">
                        Mixed Payment Split: <strong className="text-green-400">Cash {formatCurrency(cashAmt)}</strong> + <strong className="text-purple-400">Online {formatCurrency(onlineAmt)}</strong>
                        {walletAmt > 0 && <> + <strong className="text-indigo-400">Wallet {formatCurrency(walletAmt)}</strong></>}
                      </div>
                    )}
                  </div>

                  {/* Partial / Payment History */}
                  {Array.isArray(selectedInvoice.paymentHistory) && selectedInvoice.paymentHistory.length > 0 && (
                    <div className="p-4 rounded-xl bg-muted/20 border border-border space-y-2.5">
                      <h4 className="text-sm font-semibold">Payment Transaction History</h4>
                      <div className="overflow-x-auto border border-border rounded-lg">
                        <Table2>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="text-xs">#</TableHead>
                              <TableHead className="text-xs">Date & Time</TableHead>
                              <TableHead className="text-xs">Method</TableHead>
                              <TableHead className="text-xs">Cash</TableHead>
                              <TableHead className="text-xs">Online</TableHead>
                              <TableHead className="text-xs">Total Paid</TableHead>
                              <TableHead className="text-xs">Pending</TableHead>
                              <TableHead className="text-xs">Status</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {selectedInvoice.paymentHistory.map((ph: any, i: number) => (
                              <TableRow key={i}>
                                <TableCell className="text-xs font-mono">{ph.paymentNumber}</TableCell>
                                <TableCell className="text-xs">{formatDateTime(ph.createdAt)}</TableCell>
                                <TableCell className="text-xs">{ph.paymentMethod}</TableCell>
                                <TableCell className="text-xs text-green-400">{formatCurrency(ph.cashAmount || 0)}</TableCell>
                                <TableCell className="text-xs text-purple-400">{formatCurrency(ph.onlineAmount || 0)}</TableCell>
                                <TableCell className="text-xs font-semibold">{formatCurrency(ph.totalPaid || 0)}</TableCell>
                                <TableCell className="text-xs text-amber-400">{formatCurrency(ph.pendingAmount || 0)}</TableCell>
                                <TableCell className="text-xs">{ph.paymentStatus}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table2>
                      </div>
                    </div>
                  )}

                  <div className="flex justify-end pt-2">
                    <Button onClick={() => setSelectedInvoice(null)}>Close</Button>
                  </div>
                </div>
              );
            })()}
          </Modal>
        </div>
      )}
    </div>
  );
}
