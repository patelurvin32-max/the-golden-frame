import { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { reportService } from '@/services';
import { useAppStore, useAuthStore } from '@/store';
import { Button, Card, CardContent, CardHeader, CardTitle, PageHeader, Skeleton, useToast, Table2, TableHeader, TableBody, TableRow, TableHead, TableCell, Input, Badge } from '@/components/ui';
import { formatCurrency, formatDuration, downloadBlob, cn } from '@/utils';

type GroupBy = 'day' | 'week' | 'month';

export default function ReportsPage() {
  const toast = useToast();
  const qc = useQueryClient();
  const { selectedBranch } = useAppStore();
  const { user } = useAuthStore();
  const [tab, setTab] = useState<'revenue' | 'tables' | 'pnl' | 'branches'>('revenue');
  const [groupBy, setGroupBy] = useState<GroupBy>('day');
  const [shouldFetch, setShouldFetch] = useState(false);

  // User input states (can change without triggering refetch)
  const [inputFrom, setInputFrom] = useState(() => { const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().slice(0, 10); });
  const [inputTo, setInputTo] = useState(() => new Date().toISOString().slice(0, 10));

  // Active search query states (only updated when clicking "Search")
  const [searchFrom, setSearchFrom] = useState(inputFrom);
  const [searchTo, setSearchTo] = useState(inputTo);
  const [searchBranch, setSearchBranch] = useState('');

  // Determine if user can select branch (Super Admin and Admin can)
  const canSelectBranch = user?.role === 'super_admin' || user?.role === 'admin';

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
    queryKey: ['report-branches'],
    queryFn: () => reportService.getBranchComparison().then((r) => r.data.data),
  });

  const chartData = revenueData?.revenue?.map((r: any) => {
    const exp = revenueData?.expenses?.find((e: any) => e._id === r._id);
    return { date: r._id, revenue: r.total, expenses: exp?.total || 0, profit: r.total - (exp?.total || 0), invoices: r.count };
  }) || [];

  const totalRevenue = chartData.reduce((s: number, d: any) => s + d.revenue, 0);
  const totalExpenses = chartData.reduce((s: number, d: any) => s + d.expenses, 0);
  const totalProfit = totalRevenue - totalExpenses;
  const totalCash = revenueData?.summary?.totalCash || 0;
  const totalOnline = revenueData?.summary?.totalOnline || 0;
  const totalCustomers = revenueData?.summary?.totalCustomers || 0;

  const handleExport = async (type: string) => {
    try {
      const res = await reportService.exportExcel({ ...searchParams, type, groupBy });
      downloadBlob(res.data as Blob, `thegoldenframe-${type}-${searchFrom}-to-${searchTo}.xlsx`);
      toast.success(`${type} report exported!`);
    } catch { toast.error('Export failed'); }
  };

  const [orderPage, setOrderPage] = useState(1);
  const [orderSearch, setOrderSearch] = useState('');
  const [orderSortBy, setOrderSortBy] = useState('createdAt');
  const [orderSortOrder, setOrderSortOrder] = useState<'asc' | 'desc'>('desc');

  const { data: orderData, isLoading: ordersLoading } = useQuery({
    queryKey: ['report-orders', searchBranch, searchFrom, searchTo, orderPage, orderSearch, orderSortBy, orderSortOrder, shouldFetch],
    queryFn: () => reportService.getOrders({
      ...searchParams,
      page: String(orderPage),
      limit: '10',
      search: orderSearch,
      sortBy: orderSortBy,
      sortOrder: orderSortOrder,
    }).then((r) => r.data),
    enabled: shouldFetch,
  });

  const { data: orderSummaryData } = useQuery({
    queryKey: ['report-orders-summary', searchBranch, searchFrom, searchTo, shouldFetch],
    queryFn: () => reportService.getOrdersSummary({
      ...searchParams,
    }).then((r) => r.data.data),
    enabled: shouldFetch,
  });

  const handleExportOrders = async () => {
    try {
      const res = await reportService.exportExcel({
        ...searchParams,
        type: 'orders',
        search: orderSearch,
        sortBy: orderSortBy,
        sortOrder: orderSortOrder,
      });
      downloadBlob(res.data as Blob, `thegoldenframe-orders-${searchFrom}-to-${searchTo}.xlsx`);
      toast.success('Order details report exported!');
    } catch {
      toast.error('Export failed');
    }
  };

  const handleSearch = () => {
    const activeBranch = (selectedBranch && canSelectBranch) 
      ? String(selectedBranch) 
      : (!canSelectBranch && user?.branches?.[0] ? String(user.branches[0]) : '');

    setSearchBranch(activeBranch);
    setSearchFrom(inputFrom);
    setSearchTo(inputTo);
    setShouldFetch(true);
    setOrderPage(1);

    qc.invalidateQueries({ queryKey: ['report-revenue'] });
    qc.invalidateQueries({ queryKey: ['report-tables'] });
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

  // Trigger initial fetch on page load
  useEffect(() => {
    const initialBranch = (selectedBranch && canSelectBranch) 
      ? String(selectedBranch) 
      : (!canSelectBranch && user?.branches?.[0] ? String(user.branches[0]) : '');
    
    setSearchBranch(initialBranch);
    setSearchFrom(inputFrom);
    setSearchTo(inputTo);
    setShouldFetch(true);
  }, []);

  const TABS = [
    { id: 'revenue', label: '💰 Revenue' },
    { id: 'tables', label: '🎱 Tables' },
    { id: 'pnl', label: '📊 P&L' },
    { id: 'branches', label: '🏢 Branches' },
  ];

  return (
    <div className="space-y-5 animate-fade-in">
      <PageHeader
        title="Reports & Analytics"
        actions={
          <div className="flex flex-wrap gap-2 w-full sm:w-auto">
            <Button size="sm" variant="outline" className="flex-1 min-w-[130px] sm:flex-none text-center justify-center" onClick={() => handleExport('revenue')}>📥 Revenue Excel</Button>
            <Button size="sm" variant="outline" className="flex-1 min-w-[130px] sm:flex-none text-center justify-center" onClick={() => handleExport('expenses')}>📥 Expenses Excel</Button>
            <Button size="sm" variant="outline" className="flex-1 min-w-[130px] sm:flex-none text-center justify-center" onClick={handleExportOrders}>📥 Order Details Excel</Button>
          </div>
        }
      />

      {/* Date range + group by */}
      <div className="flex flex-col md:flex-row md:items-center gap-3 w-full">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 flex-1 w-full">
          <input type="date" value={inputFrom} onChange={(e) => setInputFrom(e.target.value)}
            className="h-9 px-3 rounded-xl border border-input bg-background text-sm w-full sm:w-auto flex-1" />
          <span className="text-muted-foreground text-center sm:text-left">to</span>
          <input type="date" value={inputTo} onChange={(e) => setInputTo(e.target.value)}
            className="h-9 px-3 rounded-xl border border-input bg-background text-sm w-full sm:w-auto flex-1" />
          <Button size="sm" onClick={handleSearch} className="w-full sm:w-auto">🔍 Search</Button>
        </div>
        {tab === 'revenue' && (
          <div className="flex gap-1 w-full md:w-auto justify-start">
            {(['day', 'week', 'month'] as GroupBy[]).map((g) => (
              <button key={g} onClick={() => setGroupBy(g)}
                className={cn('flex-1 md:flex-initial text-center px-3 py-1.5 rounded-xl border text-xs font-semibold capitalize transition-colors',
                  groupBy === g ? 'gradient-brand text-white border-transparent' : 'border-border text-muted-foreground hover:bg-accent'
                )}
              >{g}</button>
            ))}
          </div>
        )}
      </div>

      {/* Quick summary */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4">
        {[
          { label: 'Revenue', value: formatCurrency(totalRevenue), color: 'text-blue-400' },
          { label: 'Expenses', value: formatCurrency(totalExpenses), color: 'text-red-400' },
          { label: 'Net Profit', value: formatCurrency(totalProfit), color: totalProfit >= 0 ? 'text-emerald-400' : 'text-red-400' },
          { label: 'Total Cash', value: formatCurrency(totalCash), color: 'text-green-400' },
          { label: 'Total Online', value: formatCurrency(totalOnline), color: 'text-purple-400' },
          { label: 'Total Customers', value: totalCustomers.toString(), color: 'text-orange-400' },
        ].map((s) => (
          <Card key={s.label}>
            <CardContent className="p-3 sm:p-4 text-center">
              <p className="text-[10px] sm:text-xs text-muted-foreground uppercase tracking-wider truncate" title={s.label}>{s.label}</p>
              <p className={cn('text-base sm:text-lg md:text-xl lg:text-2xl font-bold mt-1 truncate', s.color)} title={s.value}>{s.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Tab nav */}
      <div className="flex gap-2 border-b border-border pb-0 overflow-x-auto whitespace-nowrap scrollbar-none">
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id as any)}
            className={cn('px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px flex-shrink-0',
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
          <CardHeader className="pb-2"><CardTitle>Revenue vs Expenses</CardTitle></CardHeader>
          <CardContent>
            {revLoading ? <Skeleton className="h-64" /> : (
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
                  <YAxis tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} tickFormatter={(v) => `₹${(v/1000).toFixed(0)}k`} />
                  <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '12px' }} formatter={(v: any) => [formatCurrency(v), '']} />
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
          <CardHeader className="pb-2"><CardTitle>Table Performance</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-3">
              {(tableData?.usage || []).map((t: any) => {
                const maxRevenue = Math.max(...(tableData?.usage || []).map((x: any) => x.totalRevenue));
                const pct = maxRevenue > 0 ? (t.totalRevenue / maxRevenue) * 100 : 0;
                return (
                  <div key={t._id.tableId} className="space-y-1.5">
                    <div className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <div className={cn('h-6 w-6 rounded-lg flex items-center justify-center text-white text-xs font-bold',
                          t._id.type === 'pool' ? 'bg-blue-500' : t._id.type === 'snooker' ? 'bg-emerald-500' : 'bg-purple-500'
                        )}>
                          {t._id.type?.[0]?.toUpperCase()}
                        </div>
                        <span className="font-medium">{t._id.tableName}</span>
                        <span className="text-xs text-muted-foreground">({t.totalSessions} sessions · {formatDuration(t.totalMinutes || 0)})</span>
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
          <CardHeader className="pb-2"><CardTitle>Profit & Loss</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} tickFormatter={(v) => `₹${(v/1000).toFixed(0)}k`} />
                <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '12px' }} formatter={(v: any) => [formatCurrency(v), '']} />
                <Legend />
                <Bar dataKey="revenue" name="Revenue" fill="#3b82f6" radius={[4,4,0,0]} />
                <Bar dataKey="profit" name="Profit" fill="#22c55e" radius={[4,4,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Branches Tab */}
      {tab === 'branches' && (
        <Card>
          <CardHeader className="pb-2"><CardTitle>Branch Comparison (This Month)</CardTitle></CardHeader>
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
                    <div><p className="text-muted-foreground text-xs">Revenue</p><p className="font-bold text-blue-400">{formatCurrency(b.revenue)}</p></div>
                    <div><p className="text-muted-foreground text-xs">Expenses</p><p className="font-bold text-red-400">{formatCurrency(b.expenses)}</p></div>
                    <div><p className="text-muted-foreground text-xs">Invoices</p><p className="font-bold">{b.bills}</p></div>
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
          {/* Summary Section */}
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7 gap-3 sm:gap-4">
            {[
              { label: 'Total Orders', value: orderSummaryData?.summary?.totalOrders ?? 0, color: 'text-blue-400' },
              { label: 'Total Revenue', value: formatCurrency(orderSummaryData?.summary?.totalRevenue ?? 0), color: 'text-emerald-400' },
              { label: 'Cash Collection', value: formatCurrency(orderSummaryData?.summary?.totalCashCollection ?? 0), color: 'text-green-400' },
              { label: 'UPI Collection', value: formatCurrency(orderSummaryData?.summary?.totalUPICollection ?? 0), color: 'text-purple-400' },
              { label: 'Wallet Payments', value: formatCurrency(orderSummaryData?.summary?.totalWalletPayments ?? 0), color: 'text-indigo-400' },
              { label: 'Pending Amount', value: formatCurrency(orderSummaryData?.summary?.totalPendingAmount ?? 0), color: 'text-red-400' },
              { label: 'Average Order Value', value: formatCurrency(orderSummaryData?.summary?.averageOrderValue ?? 0), color: 'text-amber-400' },
            ].map((s) => (
              <Card key={s.label}>
                <CardContent className="p-3 text-center">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold truncate" title={s.label}>{s.label}</p>
                  <p className={cn('text-sm sm:text-base md:text-lg font-bold mt-1 truncate', s.color)} title={s.value}>{s.value}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Order Details Section */}
          <Card>
            <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between pb-2 gap-3">
              <CardTitle>Order Details</CardTitle>
              <div className="flex items-center gap-3 w-full sm:w-auto">
                <Input
                  placeholder="Search orders..."
                  value={orderSearch}
                  onChange={(e) => { setOrderSearch(e.target.value); setOrderPage(1); }}
                  className="w-full sm:w-64 h-8 text-xs rounded-lg"
                />
              </div>
            </CardHeader>
            <CardContent>
              {ordersLoading ? (
                <div className="space-y-2">
                  {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-10 animate-pulse bg-muted" />)}
                </div>
              ) : !orderData?.data?.orders?.length ? (
                <p className="text-center text-muted-foreground py-8">No matching orders found</p>
              ) : (
                <>
                  <div className="overflow-x-auto border border-border rounded-xl">
                    <Table2>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="cursor-pointer select-none whitespace-nowrap" onClick={() => handleSort('orderId')}>
                            Order ID {orderSortBy === 'orderId' ? (orderSortOrder === 'asc' ? '▲' : '▼') : ''}
                          </TableHead>
                          <TableHead className="cursor-pointer select-none whitespace-nowrap" onClick={() => handleSort('customerName')}>
                            Customer Name {orderSortBy === 'customerName' ? (orderSortOrder === 'asc' ? '▲' : '▼') : ''}
                          </TableHead>
                          <TableHead className="whitespace-nowrap">Mobile Number</TableHead>
                          <TableHead className="cursor-pointer select-none whitespace-nowrap" onClick={() => handleSort('branchName')}>
                            Branch {orderSortBy === 'branchName' ? (orderSortOrder === 'asc' ? '▲' : '▼') : ''}
                          </TableHead>
                          <TableHead className="whitespace-nowrap">Category</TableHead>
                          <TableHead className="whitespace-nowrap">Item</TableHead>
                          <TableHead className="whitespace-nowrap">Qty</TableHead>
                          <TableHead className="cursor-pointer select-none whitespace-nowrap" onClick={() => handleSort('billAmount')}>
                            Bill Amount {orderSortBy === 'billAmount' ? (orderSortOrder === 'asc' ? '▲' : '▼') : ''}
                          </TableHead>
                          <TableHead className="whitespace-nowrap">Amount Recd</TableHead>
                          <TableHead className="whitespace-nowrap">Wallet Used</TableHead>
                          <TableHead className="whitespace-nowrap">Wallet Added</TableHead>
                          <TableHead className="whitespace-nowrap">Payment Method</TableHead>
                          <TableHead className="whitespace-nowrap">Status</TableHead>
                          <TableHead className="whitespace-nowrap">Created By</TableHead>
                          <TableHead className="cursor-pointer select-none whitespace-nowrap" onClick={() => handleSort('createdAt')}>
                            Created At {orderSortBy === 'createdAt' ? (orderSortOrder === 'asc' ? '▲' : '▼') : ''}
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {orderData.data.orders.map((o: any) => (
                          <TableRow key={o._id}>
                            <TableCell className="font-mono text-xs whitespace-nowrap">{o.orderId}</TableCell>
                            <TableCell className="text-sm font-medium whitespace-nowrap">{o.customerName}</TableCell>
                            <TableCell className="text-sm whitespace-nowrap">{o.mobileNumber || '—'}</TableCell>
                            <TableCell className="text-sm whitespace-nowrap">{o.branchName}</TableCell>
                            <TableCell className="text-xs whitespace-nowrap">{o.menuCategory || '—'}</TableCell>
                            <TableCell className="text-xs whitespace-nowrap">{o.menuItem || '—'}</TableCell>
                            <TableCell className="text-sm whitespace-nowrap">{o.quantity}</TableCell>
                            <TableCell className="text-sm font-medium whitespace-nowrap">{formatCurrency(o.billAmount)}</TableCell>
                            <TableCell className="text-sm whitespace-nowrap">{formatCurrency(o.amountReceived)}</TableCell>
                            <TableCell className="text-sm whitespace-nowrap">{formatCurrency(o.walletUsed)}</TableCell>
                            <TableCell className="text-sm whitespace-nowrap">{formatCurrency(o.walletAdded)}</TableCell>
                            <TableCell className="text-xs capitalize font-medium whitespace-nowrap">{o.paymentMethod}</TableCell>
                            <TableCell className="whitespace-nowrap">
                              <Badge variant={o.paymentStatus === 'paid' ? 'success' : o.paymentStatus === 'partial' ? 'warning' : 'danger'}>
                                {o.paymentStatus}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-sm whitespace-nowrap">{o.createdBy}</TableCell>
                            <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                              {new Date(o.createdAt).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' })}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table2>
                  </div>
                  
                  {/* Pagination */}
                  {orderData.pages > 1 && (
                    <div className="flex items-center justify-between mt-4">
                      <span className="text-xs text-muted-foreground">
                        Page {orderPage} of {orderData.pages} ({orderData.total} total orders)
                      </span>
                      <div className="flex gap-2">
                        <Button
                           size="sm"
                           variant="outline"
                           disabled={orderPage === 1}
                           onClick={() => setOrderPage((p) => Math.max(1, p - 1))}
                        >
                          Previous
                        </Button>
                        <Button
                           size="sm"
                           variant="outline"
                           disabled={orderPage === orderData.pages}
                           onClick={() => setOrderPage((p) => Math.min(orderData.pages, p + 1))}
                        >
                          Next
                        </Button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>

          {/* Pending Payment Details */}
          {orderSummaryData?.pendingPayments && orderSummaryData.pendingPayments.length > 0 && (
            <Card>
              <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between pb-2 gap-2">
                <CardTitle className="text-red-400">⚠️ Pending Payment Details</CardTitle>
                <div className="text-sm font-semibold text-red-400">
                  Total Pending Amount: {formatCurrency(orderSummaryData?.summary?.totalPendingAmount ?? 0)}
                </div>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto border border-border rounded-xl">
                  <Table2>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="whitespace-nowrap">Order ID</TableHead>
                        <TableHead className="whitespace-nowrap">Customer Name</TableHead>
                        <TableHead className="whitespace-nowrap">Mobile Number</TableHead>
                        <TableHead className="whitespace-nowrap">Bill Amount</TableHead>
                        <TableHead className="whitespace-nowrap">Amount Paid</TableHead>
                        <TableHead className="whitespace-nowrap">Pending Amount</TableHead>
                        <TableHead className="whitespace-nowrap">Payment Method</TableHead>
                        <TableHead className="whitespace-nowrap">Created At</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {orderSummaryData.pendingPayments.map((p: any) => (
                        <TableRow key={p._id}>
                          <TableCell className="font-mono text-xs whitespace-nowrap">{p.orderId}</TableCell>
                          <TableCell className="text-sm font-medium whitespace-nowrap">{p.customerName}</TableCell>
                          <TableCell className="text-sm whitespace-nowrap">{p.mobileNumber || '—'}</TableCell>
                          <TableCell className="text-sm font-medium whitespace-nowrap">{formatCurrency(p.billAmount)}</TableCell>
                          <TableCell className="text-sm whitespace-nowrap">{formatCurrency(p.amountPaid)}</TableCell>
                          <TableCell className="text-sm font-bold text-red-400 whitespace-nowrap">{formatCurrency(p.pendingAmount)}</TableCell>
                          <TableCell className="text-xs capitalize whitespace-nowrap">{p.paymentMethod}</TableCell>
                          <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                            {new Date(p.createdAt).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' })}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table2>
                </div>
              </CardContent>
            </Card>
          )}

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
                          <TableCell className="text-sm font-bold text-blue-400 whitespace-nowrap">{formatCurrency(tx.remainingBalance)}</TableCell>
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
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold truncate" title={item.category}>{item.category}</p>
                        <p className="text-base font-bold mt-1 text-foreground truncate" title={item.name}>{item.name}</p>
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
        </div>
      )}
    </div>
  );
}
