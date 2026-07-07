import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import { expenseService, branchService } from '@/services';
import { useAppStore, useAuthStore } from '@/store';
import type { Expense } from '@/types';
import {
  Button, Card, CardContent, CardHeader, CardTitle, Input, Label, Select,
  PageHeader, Skeleton, EmptyState, Table2, TableHeader, TableBody,
  TableRow, TableHead, TableCell, Modal, useToast
} from '@/components/ui';
import { formatCurrency, formatDate, cn } from '@/utils';

const CATEGORIES = ['rent','electricity','salary','internet','maintenance','suppliers','others'];
const COLORS = ['#3b82f6','#22c55e','#a855f7','#f59e0b','#ef4444','#06b6d4','#64748b'];

const emptyForm = { title: '', category: 'others', amount: 0, date: new Date().toISOString().slice(0,10), notes: '', branch: '' };

export default function ExpensesPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const { selectedBranch } = useAppStore();
  const { user } = useAuthStore();
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState({ ...emptyForm });
  const [dateFrom, setDateFrom] = useState(() => { const d = new Date(); d.setDate(1); return d.toISOString().slice(0,10); });
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().slice(0,10));

  // Determine if user can select branch (Super Admin can, Branch Manager and Staff cannot)
  const canSelectBranch = user?.role === 'super_admin';

  // Auto-assign branch for Branch Manager and Staff when opening modal
  useEffect(() => {
    if (modal && !canSelectBranch && user?.branches?.[0]) {
      const branchId = typeof user.branches[0] === 'string' ? user.branches[0] : user.branches[0]._id;
      setForm((prev) => ({ ...prev, branch: branchId }));
    }
  }, [modal, canSelectBranch, user]);

  const { data: branchData } = useQuery({ queryKey: ['branches'], queryFn: () => branchService.getAll().then((r) => r.data.data.branches) });

  const params: Record<string, string> = { from: dateFrom, to: dateTo };
  if (selectedBranch) params.branch = selectedBranch;

  const { data, isLoading } = useQuery({
    queryKey: ['expenses', selectedBranch, dateFrom, dateTo],
    queryFn: () => expenseService.getAll(params).then((r) => r.data),
  });

  const expenses: Expense[] = (data as any)?.data?.expenses || [];
  const totalExpenses = expenses.reduce((s, e) => s + e.amount, 0);

  // Category breakdown for pie chart
  const breakdown = CATEGORIES.map((cat, i) => ({
    name: cat, value: expenses.filter((e) => e.category === cat).reduce((s, e) => s + e.amount, 0), color: COLORS[i],
  })).filter((c) => c.value > 0);

  const createMutation = useMutation({
    mutationFn: (d: any) => expenseService.create(d),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['expenses'] }); toast.success('Expense added!'); setModal(false); setForm({ ...emptyForm }); },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => expenseService.delete(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['expenses'] }); toast.success('Deleted'); },
  });

  const handleSave = () => {
    const branch = form.branch || selectedBranch;
    if (canSelectBranch && !branch) { toast.error('Select a branch'); return; }
    if (!canSelectBranch && !branch) { toast.error('Branch assignment error'); return; }
    createMutation.mutate({ ...form, branch, amount: Number(form.amount) });
  };

  return (
    <div className="space-y-5 animate-fade-in">
      <PageHeader
        title="Expenses"
        subtitle={`Total: ${formatCurrency(totalExpenses)}`}
        actions={<Button size="sm" onClick={() => { setForm({ ...emptyForm }); setModal(true); }}>+ Add Expense</Button>}
      />

      {/* Date range */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 text-sm">
          <Label>From</Label>
          <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-36" />
        </div>
        <div className="flex items-center gap-2 text-sm">
          <Label>To</Label>
          <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-36" />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Pie chart */}
        {breakdown.length > 0 && (
          <Card>
            <CardHeader className="pb-2"><CardTitle>By Category</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={180}>
                <PieChart>
                  <Pie data={breakdown} cx="50%" cy="50%" outerRadius={70} dataKey="value" paddingAngle={3}>
                    {breakdown.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                  </Pie>
                  <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '12px' }} formatter={(v: any) => [formatCurrency(v), '']} />
                </PieChart>
              </ResponsiveContainer>
              <div className="space-y-1.5 mt-2">
                {breakdown.map((b) => (
                  <div key={b.name} className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-1.5">
                      <div className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: b.color }} />
                      <span className="capitalize text-muted-foreground">{b.name}</span>
                    </div>
                    <span className="font-semibold">{formatCurrency(b.value)}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Expense table */}
        <Card className="lg:col-span-2">
          {isLoading ? (
            <div className="p-4 space-y-3">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
          ) : expenses.length === 0 ? (
            <EmptyState icon="💸" title="No expenses found" description="Add expenses to track your costs" action={<Button size="sm" onClick={() => setModal(true)}>+ Add Expense</Button>} />
          ) : (
            <Table2>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {expenses.map((expense) => (
                  <TableRow key={expense._id}>
                    <TableCell className="text-xs text-muted-foreground">{formatDate(expense.date)}</TableCell>
                    <TableCell className="font-medium">{expense.title}</TableCell>
                    <TableCell><span className="capitalize text-xs text-muted-foreground">{expense.category}</span></TableCell>
                    <TableCell className="font-bold text-red-400">{formatCurrency(expense.amount)}</TableCell>
                    <TableCell>
                      <Button size="sm" variant="ghost" className="text-red-400 hover:bg-red-500/10"
                        onClick={() => { if (window.confirm('Delete this expense?')) deleteMutation.mutate(expense._id); }}
                      >✕</Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table2>
          )}
        </Card>
      </div>

      {/* Add Expense Modal */}
      <Modal open={modal} onClose={() => setModal(false)} title="Add Expense" size="md">
        <div className="space-y-3">
          <div className="space-y-1.5"><Label>Title *</Label><Input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Category *</Label>
              <Select value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}>
                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </Select>
            </div>
            <div className="space-y-1.5"><Label>Amount (₹) *</Label><Input type="number" step="0.01" min={0} value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: Number(e.target.value) }))} /></div>
          </div>
          <div className="space-y-1.5"><Label>Date</Label><Input type="date" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} /></div>
          <div className="space-y-1.5"><Label>Notes</Label><Input value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} /></div>
          {canSelectBranch && (
            <div className="space-y-1.5">
              <Label>Branch *</Label>
              <Select value={form.branch} onChange={(e) => setForm((f) => ({ ...f, branch: e.target.value }))}>
                <option value="">Select branch</option>
                {(branchData || []).map((b: any) => <option key={b._id} value={b._id}>{b.name}</option>)}
              </Select>
            </div>
          )}
          <div className="flex gap-2 pt-2">
            <Button variant="outline" className="flex-1" onClick={() => setModal(false)}>Cancel</Button>
            <Button className="flex-1" loading={createMutation.isPending} onClick={handleSave}>Add Expense</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
