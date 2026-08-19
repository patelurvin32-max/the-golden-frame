import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { walletManagementService, branchService, settingsService } from '@/services';
import { useAppStore, useAuthStore } from '@/store';
import type { Wallet } from '@/types';
import {
  Button, Card, CardContent, CardHeader, CardTitle, Input, Label, Select,
  PageHeader, Skeleton, EmptyState, Table2, TableHeader, TableBody,
  TableRow, TableHead, TableCell, Modal, useToast
} from '@/components/ui';
import { formatCurrency, formatDate, formatDateTime, downloadBlob, cn } from '@/utils';
import PaymentForm, { PaymentFormValues } from '@/components/PaymentForm';

const emptyForm = { name: '', mobileNumber: '', email: '', amount: 0, discountPercent: 0, branch: '', notes: '' };
const initialPaymentForm: PaymentFormValues = {
  paymentStatus: 'paid',
  paymentMethod: '' as 'cash' | 'upi' | 'mixed' | 'wallet' | '',
  cashAmount: '',
  onlineAmount: '',
  walletAmount: '',
  amountReceived: '',
  pendingPaymentAmount: '',
  billAmount: '0',
  addToWallet: false,
  extraAmount: '',
  walletBalance: 0,
};

export default function WalletPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const { selectedBranch } = useAppStore();
  const { user } = useAuthStore();
  const [modal, setModal] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [selectedWalletInvoice, setSelectedWalletInvoice] = useState<Wallet | null>(null);
  const [form, setForm] = useState({ ...emptyForm });
  const [paymentForm, setPaymentForm] = useState<PaymentFormValues>({ ...initialPaymentForm });
  const [search, setSearch] = useState('');

  // Determine if user can select branch (Super Admin can, Branch Admin cannot)
  const canSelectBranch = user?.role === 'super_admin';

  // Auto-assign branch for Branch Admin when opening modal
  useEffect(() => {
    if (modal && !canSelectBranch && user?.branches?.[0]) {
      const branchId = typeof user.branches[0] === 'string' ? user.branches[0] : user.branches[0]._id;
      setForm((prev) => ({ ...prev, branch: branchId }));
    }
  }, [modal, canSelectBranch, user]);

  // Initialize form with user's branch for Branch Admin
  useEffect(() => {
    if (!canSelectBranch && user?.branches?.[0] && !form.branch) {
      const branchId = typeof user.branches[0] === 'string' ? user.branches[0] : user.branches[0]._id;
      setForm((prev) => ({ ...prev, branch: branchId }));
    }
  }, [canSelectBranch, user, form.branch]);

  const { data: branchData } = useQuery({ 
    queryKey: ['branches'], 
    queryFn: () => branchService.getAll().then((r) => r.data.data.branches),
    // Always fetch branches to get branch names for display
  });

  // Determine the branch to use for filtering
  const effectiveBranch = canSelectBranch ? selectedBranch : (user?.branches?.[0] ? (typeof user.branches[0] === 'string' ? user.branches[0] : user.branches[0]._id) : undefined);

  // Fetch settings for business name
  const { data: settingsData } = useQuery({
    queryKey: ['settings', effectiveBranch],
    queryFn: () => settingsService.get(effectiveBranch ? { branch: effectiveBranch } : undefined).then((r) => r.data),
    staleTime: 5 * 60 * 1000,
  });
  const businessName = (settingsData as any)?.data?.settings?.businessName || 'The Golden Frame';

  // Fetch wallet statistics
  const { data: statsData } = useQuery({
    queryKey: ['wallet-stats', effectiveBranch],
    queryFn: () => walletManagementService.getStats(effectiveBranch ? { branch: effectiveBranch } : undefined).then((r) => r.data),
    staleTime: 60_000,
  });

  const stats = (statsData as any)?.data || { today: 0, week: 0, month: 0, total: 0, todayAmount: 0, monthAmount: 0 };

  const params: Record<string, string> = {};
  if (effectiveBranch) params.branch = effectiveBranch;
  if (search) params.search = search;

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['wallets', effectiveBranch, search],
    queryFn: () => walletManagementService.getAll(params).then((r) => r.data),
    enabled: true,
  });

  const wallets: Wallet[] = (data as any)?.data?.wallets || [];
  const totalWalletAmount = wallets.reduce((s, w) => s + w.amount, 0);

  const createMutation = useMutation({
    mutationFn: (d: any) => walletManagementService.create(d),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['wallets'] }); qc.invalidateQueries({ queryKey: ['wallet-stats'] }); toast.success('Wallet added!'); setModal(false); setForm({ ...emptyForm }); setPaymentForm({ ...initialPaymentForm }); },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed'),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => walletManagementService.update(id, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['wallets'] }); qc.invalidateQueries({ queryKey: ['wallet-stats'] }); toast.success('Wallet updated!'); setModal(false); setForm({ ...emptyForm }); setPaymentForm({ ...initialPaymentForm }); setEditId(null); },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed to update wallet'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => walletManagementService.delete(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['wallets'] }); qc.invalidateQueries({ queryKey: ['wallet-stats'] }); toast.success('Deleted'); },
  });

  const handleSave = () => {
    const branch = form.branch || effectiveBranch;
    if (canSelectBranch && !branch) { toast.error('Select a branch'); return; }
    if (!canSelectBranch && !branch) { toast.error('Branch assignment error'); return; }
    
    // Validate mobile number
    if (!form.mobileNumber || !/^\d{10}$/.test(form.mobileNumber)) {
      toast.error('Mobile number must be exactly 10 digits');
      return;
    }

    // Validate required fields
    if (!form.name) { toast.error('Name is required'); return; }
    if (!form.amount || form.amount <= 0) { toast.error('Amount must be greater than 0'); return; }
    
    const paidAmount = Number(form.amount) || 0;
    const discountAmt = (paidAmount * (Number(form.discountPercent) || 0)) / 100;
    const finalBalance = paidAmount + discountAmt;

    const payload = { 
      ...form, 
      branch, 
      amount: finalBalance,
      paidAmount: paidAmount,
      discountPercent: Number(form.discountPercent) || 0,
      discountAmount: discountAmt,
      paymentStatus: paymentForm.paymentStatus,
      paymentMethod: paymentForm.paymentMethod,
      cashAmount: Number(paymentForm.cashAmount) || 0,
      onlineAmount: Number(paymentForm.onlineAmount) || 0,
      walletAmount: 0,
      totalPaid: (Number(paymentForm.cashAmount) || 0) + (Number(paymentForm.onlineAmount) || 0),
      pendingAmount: Number(paymentForm.pendingPaymentAmount) || 0,
    };

    if (editId) {
      updateMutation.mutate({ id: editId, data: payload });
    } else {
      createMutation.mutate(payload);
    }
  };

  const handleEdit = (wallet: Wallet) => {
    setEditId(wallet._id);
    const discPct = (wallet as any).discountPercent || 0;
    let rawPaid = (wallet as any).paidAmount;
    if (!rawPaid || rawPaid <= 0) {
      if (discPct > 0) {
        rawPaid = Math.round((wallet.amount / (1 + discPct / 100)) * 100) / 100;
      } else {
        rawPaid = wallet.amount;
      }
    }

    setForm({
      name: wallet.name,
      mobileNumber: wallet.mobileNumber,
      email: wallet.email || '',
      amount: rawPaid,
      discountPercent: discPct,
      notes: wallet.notes || '',
      branch: typeof wallet.branch === 'string' ? wallet.branch : wallet.branch?._id || '',
    });
    setPaymentForm({
      ...initialPaymentForm,
      paymentStatus: wallet.paymentStatus || 'paid',
      paymentMethod: (wallet.paymentMethod as any) || '',
      cashAmount: wallet.cashAmount ? String(wallet.cashAmount) : String(rawPaid),
      onlineAmount: wallet.onlineAmount ? String(wallet.onlineAmount) : '',
      walletAmount: '0',
      billAmount: String(rawPaid),
      pendingPaymentAmount: wallet.pendingAmount ? String(wallet.pendingAmount) : '',
    });
    setModal(true);
  };

  const handleSearch = () => {
    refetch();
  };

  const handlePrintInvoice = async (wallet: Wallet) => {
    try {
      toast.info('Generating Invoice PDF...');
      const res = await walletManagementService.downloadPDF(wallet._id);
      const blob = new Blob([res.data], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const win = window.open(url, '_blank');
      if (win) {
        win.focus();
      } else {
        downloadBlob(res.data, `Invoice-${(wallet.walletId || 'wallet').replace(/[/\\?%*:|"<>]/g, '_')}.pdf`);
      }
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Failed to generate invoice PDF');
    }
  };

  return (
    <div className="space-y-5 animate-fade-in">
      <PageHeader
        title="Wallet Management"
        actions={<Button size="sm" onClick={() => { setEditId(null); setForm({ ...emptyForm }); setPaymentForm({ ...initialPaymentForm }); setModal(true); }}>+ Add Wallet</Button>}
      />

      {/* Statistics Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="p-4 border-border/50 bg-gradient-to-br from-blue-500/5 to-blue-600/5 hover:from-blue-500/10 hover:to-blue-600/10 transition-all duration-300">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground font-medium">Today</p>
              <p className="text-2xl font-bold text-foreground mt-1">{formatCurrency(stats.todayAmount || 0)}</p>
              <p className="text-xs text-muted-foreground mt-1">{stats.today} wallet{stats.today === 1 ? '' : 's'}</p>
            </div>
            <div className="h-10 w-10 rounded-xl bg-blue-500/10 flex items-center justify-center text-lg">
              📅
            </div>
          </div>
        </Card>
        <Card className="p-4 border-border/50 bg-gradient-to-br from-green-500/5 to-green-600/5 hover:from-green-500/10 hover:to-green-600/10 transition-all duration-300">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground font-medium">This Week</p>
              <p className="text-2xl font-bold text-foreground mt-1">{formatCurrency(stats.weekAmount || 0)}</p>
              <p className="text-xs text-muted-foreground mt-1">{stats.week} wallet{stats.week === 1 ? '' : 's'}</p>
            </div>
            <div className="h-10 w-10 rounded-xl bg-green-500/10 flex items-center justify-center text-lg">
              📊
            </div>
          </div>
        </Card>
        <Card className="p-4 border-border/50 bg-gradient-to-br from-purple-500/5 to-purple-600/5 hover:from-purple-500/10 hover:to-purple-600/10 transition-all duration-300">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground font-medium">This Month</p>
              <p className="text-2xl font-bold text-foreground mt-1">{formatCurrency(stats.monthAmount || 0)}</p>
              <p className="text-xs text-muted-foreground mt-1">{stats.month} wallet{stats.month === 1 ? '' : 's'}</p>
            </div>
            <div className="h-10 w-10 rounded-xl bg-purple-500/10 flex items-center justify-center text-lg">
              📈
            </div>
          </div>
        </Card>
        <Card className="p-4 border-border/50 bg-gradient-to-br from-orange-500/5 to-orange-600/5 hover:from-orange-500/10 hover:to-orange-600/10 transition-all duration-300">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground font-medium">Total</p>
              <p className="text-2xl font-bold text-foreground mt-1">{formatCurrency(stats.totalAmount || 0)}</p>
              <p className="text-xs text-muted-foreground mt-1">{stats.total} wallet{stats.total === 1 ? '' : 's'}</p>
            </div>
            <div className="h-10 w-10 rounded-xl bg-orange-500/10 flex items-center justify-center text-lg">
              💼
            </div>
          </div>
        </Card>
      </div>

      {/* Search Bar */}
      <Card className="p-4">
        <div className="flex gap-3">
          <Input
            placeholder="Search by name, mobile number, or wallet ID..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1"
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          />
          <Button onClick={handleSearch}>Search</Button>
        </div>
      </Card>

      {/* Wallet Table */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 space-y-4">
              {[...Array(5)].map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : wallets.length === 0 ? (
            <div className="p-12">
              <EmptyState
                title="No wallets found"
                description="Get started by adding your first wallet entry."
                icon="💳"
              />
            </div>
          ) : (
            <Table2>
              <TableHeader>
                <TableRow>
                  <TableHead>Wallet ID</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Mobile Number</TableHead>
                  <TableHead>Top-Up Amount</TableHead>
                  <TableHead>Remaining Balance</TableHead>
                  <TableHead>Payment Status</TableHead>
                  <TableHead>Payment Method</TableHead>
                  <TableHead>Created At</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {wallets.map((wallet) => (
                  <TableRow key={wallet._id}>
                    <TableCell className="font-medium">{wallet.walletId}</TableCell>
                    <TableCell>{wallet.name}</TableCell>
                    <TableCell>{wallet.mobileNumber}</TableCell>
                    <TableCell className="font-semibold">{formatCurrency(wallet.amount)}</TableCell>
                    <TableCell className="font-bold text-emerald-400">
                      {formatCurrency((wallet as any).remainingBalance !== undefined ? (wallet as any).remainingBalance : wallet.amount)}
                    </TableCell>
                    <TableCell>
                      <span className={cn(
                        'px-2 py-1 rounded-full text-xs font-medium',
                        wallet.paymentStatus === 'paid' && 'bg-green-500/10 text-green-500',
                        wallet.paymentStatus === 'partial' && 'bg-yellow-500/10 text-yellow-500',
                        wallet.paymentStatus === 'unpaid' && 'bg-red-500/10 text-red-500',
                        wallet.paymentStatus === 'refunded' && 'bg-blue-500/10 text-blue-500'
                      )}>
                        {wallet.paymentStatus}
                      </span>
                    </TableCell>
                    <TableCell className="capitalize">{wallet.paymentMethod || '-'}</TableCell>
                    <TableCell className="whitespace-nowrap">{formatDateTime(wallet.createdAt)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1.5 items-center">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 gap-1 border-blue-500/30 text-blue-400 hover:bg-blue-500/10 hover:text-blue-300"
                          onClick={() => setSelectedWalletInvoice(wallet)}
                        >
                          📄 Invoice
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleEdit(wallet)}
                        >
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-destructive hover:text-destructive"
                          onClick={() => {
                            if (confirm('Are you sure you want to delete this wallet?')) {
                              deleteMutation.mutate(wallet._id);
                            }
                          }}
                        >
                          Delete
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table2>
          )}
        </CardContent>
      </Card>

      {/* Add/Edit Modal */}
      <Modal
        open={modal}
        onClose={() => setModal(false)}
        title={editId ? 'Edit Wallet' : 'Add Wallet'}
      >
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Name *</Label>
            <Input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Enter name"
            />
          </div>

          <div className="space-y-1.5">
            <Label>Mobile Number *</Label>
            <Input
              type="text"
              value={form.mobileNumber}
              onChange={(e) => {
                const value = e.target.value.replace(/\D/g, '').slice(0, 10);
                setForm({ ...form, mobileNumber: value });
              }}
              placeholder="Enter 10-digit mobile number"
              maxLength={10}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Email ID</Label>
            <Input
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              placeholder="Enter email (optional)"
            />
          </div>

          <div className="space-y-1.5">
            <Label>Amount *</Label>
            <Input
              type="number"
              min="0"
              step="0.01"
              value={form.amount || ''}
              onChange={(e) => setForm({ ...form, amount: Number(e.target.value) })}
              placeholder="Enter amount"
            />
          </div>

          <div className="space-y-1.5">
            <Label>Discount</Label>
            <Select
              value={form.discountPercent}
              onChange={(e) => setForm({ ...form, discountPercent: Number(e.target.value) })}
            >
              <option value={0}>None (0%)</option>
              <option value={10}>10%</option>
              <option value={20}>20%</option>
              <option value={30}>30%</option>
              <option value={40}>40%</option>
              <option value={50}>50%</option>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Discount Amount (Final Wallet Balance)</Label>
            <Input
              type="text"
              value={formatCurrency(Number(form.amount || 0) + (((Number(form.amount) || 0) * (Number(form.discountPercent) || 0)) / 100))}
              readOnly
              className="bg-muted/50 font-semibold text-emerald-400"
            />
            {form.discountPercent > 0 && form.amount > 0 && (
              <p className="text-xs font-medium text-emerald-400 mt-1">
                ✨ Customer pays: {formatCurrency(Number(form.amount))} | {form.discountPercent}% Discount Bonus: {formatCurrency((Number(form.amount) * Number(form.discountPercent)) / 100)}
              </p>
            )}
          </div>

          {canSelectBranch && (
            <div className="space-y-1.5">
              <Label>Branch *</Label>
              <Select
                value={form.branch}
                onChange={(e) => setForm({ ...form, branch: e.target.value })}
              >
                <option value="">Select Branch</option>
                {branchData?.map((branch: any) => (
                  <option key={branch._id} value={branch._id}>{branch.name}</option>
                ))}
              </Select>
            </div>
          )}

          <div className="space-y-1.5">
            <Label>Notes</Label>
            <Input
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              placeholder="Enter notes (optional)"
            />
          </div>

          <PaymentForm
            values={{ ...paymentForm, billAmount: String(form.amount) }}
            onChange={setPaymentForm}
            showBillAmountField={false}
            readOnlyBillAmount={true}
            hideWalletBalance={true}
            hideAmountReceived={true}
            hidePendingPlayers={true}
          />
        </div>

        <div className="flex justify-end gap-3 pt-4">
          <Button variant="outline" onClick={() => setModal(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={createMutation.isPending || updateMutation.isPending}>
            {createMutation.isPending || updateMutation.isPending ? 'Saving...' : (editId ? 'Update' : 'Add Wallet')}
          </Button>
        </div>
      </Modal>

      {/* Invoice Modal */}
      <Modal
        open={!!selectedWalletInvoice}
        onClose={() => setSelectedWalletInvoice(null)}
        title="Wallet Recharge Invoice"
      >
        {selectedWalletInvoice && (
          <div className="space-y-4">
            <div className="rounded-xl border border-border p-4 bg-muted/20 space-y-3 font-mono text-sm">
              <div className="text-center border-b border-border/60 pb-3">
                <h3 className="font-bold text-lg tracking-wide text-foreground">{businessName}</h3>
                <p className="text-xs text-muted-foreground uppercase font-semibold mt-0.5">Wallet Recharge Receipt</p>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <span className="text-muted-foreground">Wallet ID:</span>
                  <p className="font-semibold text-foreground">{selectedWalletInvoice.walletId}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Created At:</span>
                  <p className="font-semibold text-foreground">{formatDateTime(selectedWalletInvoice.createdAt)}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Customer Name:</span>
                  <p className="font-semibold text-foreground">{selectedWalletInvoice.name}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Mobile Number:</span>
                  <p className="font-semibold text-foreground">{selectedWalletInvoice.mobileNumber}</p>
                </div>
                {selectedWalletInvoice.email && (
                  <div className="col-span-2">
                    <span className="text-muted-foreground">Email:</span>
                    <p className="font-semibold text-foreground">{selectedWalletInvoice.email}</p>
                  </div>
                )}
              </div>

              <div className="border-t border-dashed border-border my-2" />

              <div className="flex justify-between items-center text-sm py-1 font-semibold">
                <span>Wallet Recharge Amount</span>
                <span>{formatCurrency(selectedWalletInvoice.amount)}</span>
              </div>

              <div className="border-t border-dashed border-border my-2" />

              <div className="space-y-1.5 text-xs">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Payment Status:</span>
                  <span className={cn(
                    'px-2 py-0.5 rounded-full font-bold uppercase text-[10px]',
                    selectedWalletInvoice.paymentStatus === 'paid' && 'bg-green-500/15 text-green-400',
                    selectedWalletInvoice.paymentStatus === 'partial' && 'bg-yellow-500/15 text-yellow-400',
                    selectedWalletInvoice.paymentStatus === 'unpaid' && 'bg-red-500/15 text-red-400'
                  )}>
                    {selectedWalletInvoice.paymentStatus || 'paid'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Payment Method:</span>
                  <span className="font-semibold capitalize text-foreground">{selectedWalletInvoice.paymentMethod || 'Cash'}</span>
                </div>
                {Boolean(selectedWalletInvoice.cashAmount) && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Cash Paid:</span>
                    <span>{formatCurrency(selectedWalletInvoice.cashAmount || 0)}</span>
                  </div>
                )}
                {Boolean(selectedWalletInvoice.onlineAmount) && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">UPI / Online Paid:</span>
                    <span>{formatCurrency(selectedWalletInvoice.onlineAmount || 0)}</span>
                  </div>
                )}
              </div>

              <div className="border-t border-border pt-2 flex justify-between items-center text-base font-bold text-foreground">
                <span>Total Amount</span>
                <span className="text-emerald-400">{formatCurrency(selectedWalletInvoice.amount)}</span>
              </div>
            </div>

            <div className="flex gap-2.5 pt-2">
              <Button variant="outline" className="flex-1" onClick={() => setSelectedWalletInvoice(null)}>
                Close
              </Button>
              <Button className="flex-1 gap-2" onClick={() => handlePrintInvoice(selectedWalletInvoice)}>
                🖨️ Print Invoice
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
