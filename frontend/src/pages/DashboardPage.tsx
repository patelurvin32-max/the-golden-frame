import { useQuery } from '@tanstack/react-query';
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { motion } from 'framer-motion';
import { reportService, tableService } from '@/services';
import { useAppStore } from '@/store';
import { formatCurrency, formatDuration } from '@/utils';
import { Card, CardContent, CardHeader, CardTitle, Skeleton, StatCard, Badge } from '@/components/ui';

const PIE_COLORS = ['#3b82f6', '#22c55e', '#a855f7', '#f59e0b'];

export default function DashboardPage() {
  const { selectedBranch } = useAppStore();
  const branchParam: Record<string, string> = {};
  if (selectedBranch) branchParam.branch = selectedBranch;

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['dashboard-stats', selectedBranch],
    queryFn: () => reportService.getDashboard(branchParam).then((r) => r.data.data),
    refetchInterval: 30000,
  });

  const { data: revenueData } = useQuery({
    queryKey: ['revenue-chart', selectedBranch],
    queryFn: () => reportService.getRevenue({ ...branchParam, groupBy: 'day' }).then((r) => r.data.data),
  });

  const { data: tableUsage } = useQuery({
    queryKey: ['table-usage', selectedBranch],
    queryFn: () => reportService.getTableUsage(branchParam).then((r) => r.data.data),
  });

  const { data: branchComp } = useQuery({
    queryKey: ['branch-comparison'],
    queryFn: () => reportService.getBranchComparison().then((r) => r.data.data),
  });

  const { data: tablesData } = useQuery({
    queryKey: ['tables-live', selectedBranch],
    queryFn: () => tableService.getAll(branchParam).then((r) => r.data.data.tables),
    refetchInterval: 15000,
  });

  // Chart data: merge revenue & expense by date
  const chartData = revenueData?.revenue?.map((r: any) => {
    const exp = revenueData?.expenses?.find((e: any) => e._id === r._id);
    return { date: r._id, revenue: r.total, expenses: exp?.total || 0, profit: r.total - (exp?.total || 0) };
  }) || [];

  // Table type distribution
  const typeDistribution = (tablesData || []).reduce((acc: any, t: any) => {
    acc[t.type] = (acc[t.type] || 0) + 1;
    return acc;
  }, {});
  const pieData = Object.entries(typeDistribution).map(([name, value]) => ({ name, value }));

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
      </div>

      {/* Stat Cards */}
      {statsLoading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(8)].map((_, i) => <Skeleton key={i} className="h-28 rounded-2xl" />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard title="Today's Revenue" value={formatCurrency(stats?.revenue?.today || 0)} icon="💰" color="from-blue-500/30 to-blue-600/10" />
          <StatCard title="Monthly Revenue" value={formatCurrency(stats?.revenue?.month || 0)} icon="📈" color="from-emerald-500/30 to-emerald-600/10" />
          <StatCard title="Yearly Revenue" value={formatCurrency(stats?.revenue?.year || 0)} icon="🏆" color="from-purple-500/30 to-purple-600/10" />
          <StatCard title="Monthly Profit" value={formatCurrency(stats?.profit?.month || 0)} icon="💎" color="from-amber-500/30 to-amber-600/10" trendUp={(stats?.profit?.month || 0) > 0} />
          <StatCard title="Running Tables" value={stats?.tables?.running || 0} icon="🎱" color="from-blue-500/30 to-blue-600/10" />
          <StatCard title="Available Tables" value={stats?.tables?.available || 0} icon="✅" color="from-emerald-500/30 to-emerald-600/10" />
          <StatCard title="Today's Customers" value={stats?.customersToday || 0} icon="👥" color="from-violet-500/30 to-violet-600/10" />
          <StatCard title="Today's Expenses" value={formatCurrency(stats?.expenses?.today || 0)} icon="💸" color="from-red-500/30 to-red-600/10" />
        </div>
      )}

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Revenue Area Chart */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle>Revenue vs Expenses (Last 30 Days)</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={240}>
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="expGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`} />
                <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '12px' }} formatter={(v: any) => [`₹${v.toFixed(0)}`, '']} />
                <Area type="monotone" dataKey="revenue" stroke="#3b82f6" fill="url(#revGrad)" strokeWidth={2} name="Revenue" />
                <Area type="monotone" dataKey="expenses" stroke="#ef4444" fill="url(#expGrad)" strokeWidth={2} name="Expenses" />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Table Type Distribution */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle>Table Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={pieData} cx="50%" cy="50%" innerRadius={55} outerRadius={80} paddingAngle={4} dataKey="value">
                  {pieData.map((_: any, i: number) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                </Pie>
                <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '12px' }} />
              </PieChart>
            </ResponsiveContainer>
            <div className="flex flex-wrap justify-center gap-2 mt-2">
              {pieData.map((d: any, i: number) => (
                <div key={d.name} className="flex items-center gap-1.5 text-xs">
                  <div className="h-2.5 w-2.5 rounded-full" style={{ background: PIE_COLORS[i] }} />
                  <span className="capitalize text-muted-foreground">{d.name} ({d.value})</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Bottom Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Branch Comparison */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle>Branch Comparison (This Month)</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={branchComp?.comparison || []}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="branchName" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`} />
                <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '12px' }} formatter={(v: any) => [`₹${v.toFixed(0)}`, '']} />
                <Bar dataKey="revenue" name="Revenue" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                <Bar dataKey="expenses" name="Expenses" fill="#ef4444" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Top Tables by Usage */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle>Top Tables by Revenue</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {(tableUsage?.usage || []).slice(0, 5).map((t: any) => (
                <div key={t._id.tableId} className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className={`h-8 w-8 rounded-lg flex items-center justify-center text-xs font-bold text-white ${t._id.type === 'pool' ? 'bg-blue-500' : t._id.type === 'snooker' ? 'bg-emerald-500' : 'bg-purple-500'}`}>
                      {t._id.type?.[0]?.toUpperCase()}
                    </div>
                    <div>
                      <p className="text-sm font-medium truncate">{t._id.tableName}</p>
                      <p className="text-xs text-muted-foreground">{t.totalSessions} sessions · {formatDuration(t.totalMinutes || 0)}</p>
                    </div>
                  </div>
                  <span className="text-sm font-semibold text-emerald-400 shrink-0">{formatCurrency(t.totalRevenue || 0)}</span>
                </div>
              ))}
              {(!tableUsage?.usage?.length) && (
                <p className="text-center text-sm text-muted-foreground py-8">No table usage data yet</p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
