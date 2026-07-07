import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { reportService } from '@/services';
import { useAppStore } from '@/store';
import { Button, Card, CardContent, CardHeader, CardTitle, PageHeader, Skeleton, useToast } from '@/components/ui';
import { formatCurrency, formatDuration, downloadBlob, cn } from '@/utils';

type GroupBy = 'day' | 'week' | 'month';

export default function ReportsPage() {
  const toast = useToast();
  const { selectedBranch } = useAppStore();
  const [tab, setTab] = useState<'revenue' | 'tables' | 'pnl' | 'branches'>('revenue');
  const [groupBy, setGroupBy] = useState<GroupBy>('day');
  const [from, setFrom] = useState(() => { const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().slice(0, 10); });
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));

  const bp: Record<string, string> = {};
  if (selectedBranch) bp.branch = selectedBranch;

  const { data: revenueData, isLoading: revLoading } = useQuery({
    queryKey: ['report-revenue', selectedBranch, from, to, groupBy],
    queryFn: () => reportService.getRevenue({ ...bp, from, to, groupBy }).then((r) => r.data.data),
  });

  const { data: tableData } = useQuery({
    queryKey: ['report-tables', selectedBranch, from, to],
    queryFn: () => reportService.getTableUsage({ ...bp, from, to }).then((r) => r.data.data),
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

  const handleExport = async (type: string) => {
    try {
      const res = await reportService.exportExcel({ ...bp, from, to, type });
      downloadBlob(res.data as Blob, `thegoldenframe-${type}-${from}-to-${to}.xlsx`);
      toast.success(`${type} report exported!`);
    } catch { toast.error('Export failed'); }
  };

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
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => handleExport('revenue')}>📥 Revenue Excel</Button>
            <Button size="sm" variant="outline" onClick={() => handleExport('expenses')}>📥 Expenses Excel</Button>
          </div>
        }
      />

      {/* Date range + group by */}
      <div className="flex flex-wrap items-center gap-3">
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
          className="h-9 px-3 rounded-xl border border-input bg-background text-sm" />
        <span className="text-muted-foreground">to</span>
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
          className="h-9 px-3 rounded-xl border border-input bg-background text-sm" />
        {tab === 'revenue' && (
          <div className="flex gap-1">
            {(['day', 'week', 'month'] as GroupBy[]).map((g) => (
              <button key={g} onClick={() => setGroupBy(g)}
                className={cn('px-3 py-1.5 rounded-xl border text-xs font-semibold capitalize transition-colors',
                  groupBy === g ? 'gradient-brand text-white border-transparent' : 'border-border text-muted-foreground hover:bg-accent'
                )}
              >{g}</button>
            ))}
          </div>
        )}
      </div>

      {/* Quick summary */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Revenue', value: formatCurrency(totalRevenue), color: 'text-blue-400' },
          { label: 'Expenses', value: formatCurrency(totalExpenses), color: 'text-red-400' },
          { label: 'Net Profit', value: formatCurrency(totalProfit), color: totalProfit >= 0 ? 'text-emerald-400' : 'text-red-400' },
        ].map((s) => (
          <Card key={s.label}>
            <CardContent className="p-4 text-center">
              <p className="text-xs text-muted-foreground uppercase tracking-wider">{s.label}</p>
              <p className={cn('text-2xl font-bold mt-1', s.color)}>{s.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Tab nav */}
      <div className="flex gap-2 border-b border-border pb-0">
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id as any)}
            className={cn('px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px',
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
    </div>
  );
}
