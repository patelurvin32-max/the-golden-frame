import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSearchParams, useNavigate, useLocation } from 'react-router-dom';
import { billingService, inventoryService, branchService } from '@/services';
import { useAppStore } from '@/store';
import type { Bill } from '@/types';
import {
  Button, Card, Badge, Modal, Input, Label, Select, PageHeader,
  Skeleton, EmptyState, Table2, TableHeader, TableBody, TableRow,
  TableHead, TableCell, useToast
} from '@/components/ui';
import { formatCurrency, formatDateTime, downloadBlob, cn } from '@/utils';

// ── New Bill Form (inside modal) ──────────────────────────────────────────────
function NewBillForm({ onClose }: { onClose: () => void }) {
  const [searchParams] = useSearchParams();
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const { selectedBranch } = useAppStore();

  const sessionId = searchParams.get('sessionId');
  const branchFromUrl = searchParams.get('branch');
  const branchId = branchFromUrl || selectedBranch || '';

  const [selectedBranchId, setSelectedBranchId] = useState(branchId);
  const [discountType, setDiscountType] = useState<'flat' | 'percent' | ''>('');
  const [discountValue, setDiscountValue] = useState(0);
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [showPayment, setShowPayment] = useState(false);
  const [createdBill, setCreatedBill] = useState<Bill | null>(null);
  const [selectedInventory, setSelectedInventory] = useState<
    { id: string; name: string; qty: number; price: number }[]
  >([]);

  // Load branches for selector when no branch is pre-selected
  const { data: branchData } = useQuery({
    queryKey: ['branches'],
    queryFn: () => branchService.getAll().then((r) => r.data.data.branches),
    enabled: !branchId,
  });

  // Load inventory for the selected branch
  const { data: inventoryData } = useQuery({
    queryKey: ['inventory', selectedBranchId],
    queryFn: () =>
      inventoryService.getAll({ branch: selectedBranchId }).then((r) => r.data.data.items),
    enabled: !!selectedBranchId,
  });

  const createBillMutation = useMutation({
    mutationFn: (data: any) => billingService.create(data),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['bills'] });
      setCreatedBill(res.data.data.bill);
      setShowPayment(true);
      toast.success('Bill created!');
    },
    onError: (e: any) =>
      toast.error(e?.response?.data?.message || 'Failed to create bill'),
  });

  const paymentMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) =>
      billingService.receivePayment(id, data),
    onSuccess: () => {
      toast.success('Payment received!');
      qc.invalidateQueries({ queryKey: ['bills'] });
      onClose();
      navigate('/billing');
    },
    onError: (e: any) =>
      toast.error(e?.response?.data?.message || 'Payment failed'),
  });

  const handleCreateBill = () => {
    if (!selectedBranchId) {
      toast.error('Please select a branch first');
      return;
    }
    createBillMutation.mutate({
      sessionId: sessionId || undefined,
      branch: selectedBranchId,
      inventoryItems: selectedInventory.map((i) => ({
        inventoryId: i.id,
        quantity: i.qty,
      })),
      discountType: discountType || null,
      discountValue: Number(discountValue),
    });
  };

  const addInventoryItem = (item: any) => {
    const exists = selectedInventory.find((i) => i.id === item._id);
    if (exists) {
      setSelectedInventory((prev) =>
        prev.map((i) => (i.id === item._id ? { ...i, qty: i.qty + 1 } : i))
      );
    } else {
      setSelectedInventory((prev) => [
        ...prev,
        { id: item._id, name: item.name, qty: 1, price: item.sellingPrice },
      ]);
    }
  };

  const inventoryTotal = selectedInventory.reduce(
    (s, i) => s + i.qty * i.price,
    0
  );

  // ── Payment screen (shown after bill is created) ──────────────────────────
  if (showPayment && createdBill) {
    return (
      <div className="space-y-5">
        <div className="rounded-xl bg-muted/30 p-4 space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Invoice</span>
            <span className="font-semibold">{createdBill.invoiceNumber}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Subtotal</span>
            <span>{formatCurrency(createdBill.subtotal)}</span>
          </div>
          {createdBill.discountAmount > 0 && (
            <div className="flex justify-between text-red-400">
              <span>Discount</span>
              <span>-{formatCurrency(createdBill.discountAmount)}</span>
            </div>
          )}
          {createdBill.membershipDiscount > 0 && (
            <div className="flex justify-between text-red-400">
              <span>Membership</span>
              <span>-{formatCurrency(createdBill.membershipDiscount)}</span>
            </div>
          )}
          {createdBill.tax > 0 && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Tax</span>
              <span>{formatCurrency(createdBill.tax)}</span>
            </div>
          )}
          <div className="flex justify-between font-bold text-base pt-2 border-t border-border">
            <span>Total</span>
            <span className="text-emerald-400">
              {formatCurrency(createdBill.total)}
            </span>
          </div>
        </div>

        <div className="space-y-2">
          <Label>Payment Method</Label>
          <div className="grid grid-cols-4 gap-2">
            {['cash', 'upi', 'mixed'].map((m) => (
              <button
                key={m}
                onClick={() => setPaymentMethod(m)}
                className={cn(
                  'py-2.5 rounded-xl border text-xs font-semibold capitalize transition-colors',
                  paymentMethod === m
                    ? 'gradient-brand text-white border-transparent'
                    : 'border-border hover:bg-accent'
                )}
              >
                {m === 'cash'
                  ? '💵'
                  : m === 'upi'
                  ? '📱'
                  : '🔀'}{' '}
                {m}
              </button>
            ))}
          </div>
        </div>

        <div className="flex gap-2">
          <Button
            variant="outline"
            className="flex-1"
            onClick={async () => {
              try {
                const res = await billingService.downloadPDF(createdBill._id);
                downloadBlob(
                  res.data as Blob,
                  `${createdBill.invoiceNumber}.pdf`
                );
              } catch {
                toast.error('PDF download failed');
              }
            }}
          >
            📄 Download PDF
          </Button>
          <Button
            className="flex-1"
            loading={paymentMutation.isPending}
            onClick={() =>
              paymentMutation.mutate({
                id: createdBill._id,
                data: { method: paymentMethod, amount: createdBill.total },
              })
            }
          >
            ✅ Confirm Payment {formatCurrency(createdBill.total)}
          </Button>
        </div>
      </div>
    );
  }

  // ── Bill creation form ────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {sessionId && (
        <div className="rounded-xl bg-blue-500/10 border border-blue-500/20 p-3 text-sm text-blue-400">
          📋 Billing for session:{' '}
          <code className="font-mono text-xs">{sessionId.slice(-8)}</code>
        </div>
      )}

      {/* Branch selector — shown when no branch is pre-selected */}
      {!branchId && (
        <div className="space-y-1.5">
          <Label>Branch *</Label>
          <Select
            value={selectedBranchId}
            onChange={(e) => setSelectedBranchId(e.target.value)}
          >
            <option value="">Select a branch</option>
            {(branchData || []).map((b: any) => (
              <option key={b._id} value={b._id}>
                {b.name}
              </option>
            ))}
          </Select>
        </div>
      )}

      {/* Inventory items */}
      {inventoryData && inventoryData.length > 0 && (
        <div className="space-y-2">
          <Label>Add Items (optional)</Label>
          <div className="grid grid-cols-2 gap-2 max-h-40 overflow-y-auto pr-1">
            {(inventoryData as any[])
              .filter((i) => i.sellingPrice > 0)
              .map((item) => (
                <button
                  key={item._id}
                  onClick={() => addInventoryItem(item)}
                  className="flex items-center justify-between px-3 py-2 rounded-xl border border-border hover:bg-accent text-xs transition-colors text-left"
                >
                  <span className="font-medium truncate">{item.name}</span>
                  <span className="text-muted-foreground ml-1 shrink-0">
                    {formatCurrency(item.sellingPrice)}
                  </span>
                </button>
              ))}
          </div>
        </div>
      )}

      {/* Selected items list */}
      {selectedInventory.length > 0 && (
        <div className="rounded-xl border border-border divide-y divide-border">
          {selectedInventory.map((item) => (
            <div
              key={item.id}
              className="flex items-center justify-between px-3 py-2 text-sm"
            >
              <span className="font-medium">{item.name}</span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() =>
                    setSelectedInventory((p) =>
                      p.map((i) =>
                        i.id === item.id
                          ? { ...i, qty: Math.max(1, i.qty - 1) }
                          : i
                      )
                    )
                  }
                  className="h-6 w-6 rounded-md bg-muted hover:bg-accent text-center font-bold"
                >
                  −
                </button>
                <span className="w-6 text-center font-semibold">{item.qty}</span>
                <button
                  onClick={() =>
                    setSelectedInventory((p) =>
                      p.map((i) =>
                        i.id === item.id ? { ...i, qty: i.qty + 1 } : i
                      )
                    )
                  }
                  className="h-6 w-6 rounded-md bg-muted hover:bg-accent text-center font-bold"
                >
                  +
                </button>
                <span className="w-16 text-right text-muted-foreground">
                  {formatCurrency(item.qty * item.price)}
                </span>
                <button
                  onClick={() =>
                    setSelectedInventory((p) =>
                      p.filter((i) => i.id !== item.id)
                    )
                  }
                  className="text-red-400 hover:text-red-300 ml-1 text-base leading-none"
                >
                  ✕
                </button>
              </div>
            </div>
          ))}
          <div className="flex justify-between px-3 py-2 text-sm font-semibold">
            <span>Items Total</span>
            <span className="text-emerald-400">{formatCurrency(inventoryTotal)}</span>
          </div>
        </div>
      )}

      {/* Discount */}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>Discount Type</Label>
          <Select
            value={discountType}
            onChange={(e) => setDiscountType(e.target.value as any)}
          >
            <option value="">None</option>
            <option value="flat">Flat Amount (₹)</option>
            <option value="percent">Percentage (%)</option>
          </Select>
        </div>
        {discountType && (
          <div className="space-y-1.5">
            <Label>Discount Value</Label>
            <Input
              type="number"
              min={0}
              value={discountValue}
              onChange={(e) => setDiscountValue(Number(e.target.value))}
            />
          </div>
        )}
      </div>

      <div className="flex gap-2 pt-1">
        <Button variant="outline" className="flex-1" onClick={onClose}>
          Cancel
        </Button>
        <Button
          className="flex-1"
          loading={createBillMutation.isPending}
          onClick={handleCreateBill}
          disabled={!selectedBranchId}
        >
          Create Bill →
        </Button>
      </div>
    </div>
  );
}

// ── Main Billing Page ─────────────────────────────────────────────────────────
export default function BillingPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const qc = useQueryClient();
  const toast = useToast();
  const { selectedBranch } = useAppStore();

  const [statusFilter, setStatusFilter] = useState('all');

  // Modal is open when:
  // 1. Route is /billing/new
  // 2. sessionId is in the URL (redirected from stopping a table)
  const isNewRoute = location.pathname === '/billing/new';
  const hasSession = !!searchParams.get('sessionId');
  const [modalOpen, setModalOpen] = useState(isNewRoute || hasSession);

  // Sync modal state when route changes
  useEffect(() => {
    if (isNewRoute || hasSession) {
      setModalOpen(true);
    }
  }, [isNewRoute, hasSession]);

  const handleCloseModal = () => {
    setModalOpen(false);
    navigate('/billing');
  };

  const params: Record<string, string> = {};
  if (selectedBranch) params.branch = selectedBranch;
  if (statusFilter !== 'all') params.status = statusFilter;

  const { data, isLoading } = useQuery({
    queryKey: ['bills', selectedBranch, statusFilter],
    queryFn: () => billingService.getAll(params).then((r) => r.data),
  });

  const bills: Bill[] = (data as any)?.data?.bills || [];
  const payStatusColor: Record<string, string> = {
    paid: 'success',
    unpaid: 'danger',
    partial: 'warning',
  };

  const handleDownloadPDF = async (bill: Bill) => {
    try {
      const res = await billingService.downloadPDF(bill._id);
      downloadBlob(res.data as Blob, `${bill.invoiceNumber}.pdf`);
      toast.success('PDF downloaded');
    } catch {
      toast.error('PDF download failed');
    }
  };

  return (
    <div className="space-y-5 animate-fade-in">
      <PageHeader
        title="Billing"
        actions={
          <Button
            size="sm"
            onClick={() => {
              navigate('/billing/new');
              setModalOpen(true);
            }}
          >
            + New Bill
          </Button>
        }
      />

      {/* Status filters */}
      <div className="flex gap-2 flex-wrap">
        {['all', 'paid', 'unpaid', 'partial'].map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={cn(
              'px-3 py-1.5 rounded-xl border text-xs font-semibold capitalize transition-colors',
              statusFilter === s
                ? 'gradient-brand text-white border-transparent'
                : 'border-border text-muted-foreground hover:bg-accent'
            )}
          >
            {s === 'all' ? 'All' : s}
          </button>
        ))}
      </div>

      {/* Bills table */}
      <Card>
        {isLoading ? (
          <div className="p-4 space-y-3">
            {[...Array(5)].map((_, i) => (
              <Skeleton key={i} className="h-12" />
            ))}
          </div>
        ) : bills.length === 0 ? (
          <EmptyState
            icon="🧾"
            title="No bills found"
            description="Create a new bill or stop a table session to generate one"
            action={
              <Button
                size="sm"
                onClick={() => {
                  navigate('/billing/new');
                  setModalOpen(true);
                }}
              >
                + New Bill
              </Button>
            }
          />
        ) : (
          <Table2>
            <TableHeader>
              <TableRow>
                <TableHead>Invoice #</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Branch</TableHead>
                <TableHead>Date & Time</TableHead>
                <TableHead>Total</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {bills.map((bill) => (
                <TableRow key={bill._id}>
                  <TableCell className="font-mono text-xs font-semibold">
                    {bill.invoiceNumber}
                  </TableCell>
                  <TableCell>
                    {bill.customer?.name || (
                      <span className="text-muted-foreground italic">
                        Walk-in
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-xs">
                    {(bill.branch as any)?.name}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-xs">
                    {formatDateTime(bill.createdAt)}
                  </TableCell>
                  <TableCell className="font-bold text-emerald-400">
                    {formatCurrency(bill.total)}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={payStatusColor[bill.paymentStatus] as any}
                      className="capitalize"
                    >
                      {bill.paymentStatus}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleDownloadPDF(bill)}
                    >
                      📄 PDF
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table2>
        )}
      </Card>

      {/* New Bill Modal */}
      <Modal
        open={modalOpen}
        onClose={handleCloseModal}
        title="Create New Bill"
        size="lg"
      >
        <NewBillForm onClose={handleCloseModal} />
      </Modal>
    </div>
  );
}
