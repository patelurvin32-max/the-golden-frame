import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { customerService, billingService } from '@/services';
import { useAppStore, useAuthStore } from '@/store';
import type { Customer } from '@/types';
import {
  Button, Card, Input, Label, Select, PageHeader, Skeleton, EmptyState,
  Table2, TableHeader, TableBody, TableRow, TableHead, TableCell,
  Badge, Modal, useToast
} from '@/components/ui';
import { formatCurrency, formatDate, cn, downloadBlob } from '@/utils';

const PAYMENT_METHODS = ['cash', 'upi', 'mixed', 'wallet'] as const;
const OVERDUE_DAYS = 7;
const HIGH_VALUE_THRESHOLD = 2000;

const emptyPaymentForm = {
  paymentStatus: 'paid' as 'paid' | 'partial' | 'unpaid',
  paymentMethod: 'cash' as 'cash' | 'upi' | 'mixed' | 'wallet',
  cashAmount: '',
  onlineAmount: '',
  walletAmount: '',
  paymentNotes: '',
};

export default function PendingPaymentsPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const { selectedBranch } = useAppStore();
  const { user } = useAuthStore();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(25);
  const [sortBy, setSortBy] = useState('createdAt');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [paymentModal, setPaymentModal] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [paymentForm, setPaymentForm] = useState(emptyPaymentForm);

  const params: Record<string, string> = { 
    page: String(page), 
    limit: String(rowsPerPage),
    paymentStatus: 'unpaid',
    sortBy,
    sortOrder
  };
  if (selectedBranch) params.branch = selectedBranch;
  if (search) params.search = search;

  const { data, isLoading } = useQuery({
    queryKey: ['customers', selectedBranch, search, page, rowsPerPage, 'unpaid', sortBy, sortOrder],
    queryFn: () => customerService.getAll(params).then((r) => r.data),
    placeholderData: (prev) => prev,
  });

  const customers: Customer[] = (data as any)?.data?.customers || [];
  const total: number = (data as any)?.total || 0;
  const pages: number = (data as any)?.pages || 1;
  const filtered: number = (data as any)?.filtered || total;

  // Memoized summary statistics
  const summaryStats = useMemo(() => {
    const totalPendingAmount = customers.reduce((sum, c) => sum + ((c as any).billAmount || 0), 0);
    const totalPendingCustomers = customers.length;
    
    const overdueCustomers = customers.filter(c => {
      const createdDate = new Date(c.createdAt || '');
      const daysSinceCreation = Math.floor((Date.now() - createdDate.getTime()) / (1000 * 60 * 60 * 24));
      return daysSinceCreation > OVERDUE_DAYS;
    });
    
    const highValueCustomers = customers.filter(c => ((c as any).billAmount || 0) > HIGH_VALUE_THRESHOLD);

    return {
      totalPendingAmount,
      totalPendingCustomers,
      overdueCustomersCount: overdueCustomers.length,
      highValueCustomersCount: highValueCustomers.length,
    };
  }, [customers]);

  const updatePaymentMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => customerService.receivePayment(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['customers', selectedBranch, search, page, rowsPerPage, 'unpaid', sortBy, sortOrder] });
      qc.invalidateQueries({ queryKey: ['customers', selectedBranch, search, page, rowsPerPage, 'partial', sortBy, sortOrder] });
      qc.invalidateQueries({ queryKey: ['reports'] });
      toast.success('Payment received successfully!');
      setPaymentModal(false);
      setSelectedCustomer(null);
      setPaymentForm(emptyPaymentForm);
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed to receive payment'),
  });

  const generateInvoiceMutation = useMutation({
    mutationFn: async (customerId: string) => {
      const created = await billingService.createFromCustomer(customerId);
      const bill = created.data.data.bill;
      const pdf = await billingService.downloadPDF(bill._id);
      downloadBlob(pdf.data as Blob, `${bill.invoiceNumber}.pdf`);
      return bill;
    },
    onSuccess: () => {
      toast.success('Invoice generated successfully!');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed to generate invoice'),
  });

  const handleReceivePayment = (customer: Customer) => {
    setSelectedCustomer(customer);
    const billAmount = (customer as any).billAmount || 0;
    const totalPaid = (customer as any).totalPaid || 0;
    const pendingAmount = Math.max(0, billAmount - totalPaid);
    
    setPaymentForm({
      paymentStatus: pendingAmount > 0 ? 'partial' : 'paid',
      paymentMethod: customer.paymentMethod === 'mixed' ? 'cash' : customer.paymentMethod,
      cashAmount: '',
      onlineAmount: '',
      walletAmount: '',
      paymentNotes: '',
    });
    setPaymentModal(true);
  };

  const handleSavePayment = () => {
    if (!selectedCustomer) return;

    const billAmount = (selectedCustomer as any).billAmount || 0;
    const totalPaid = (selectedCustomer as any).totalPaid || 0;
    
    const cashAmount = Number(paymentForm.cashAmount) || 0;
    const onlineAmount = Number(paymentForm.onlineAmount) || 0;
    const walletAmount = Number(paymentForm.walletAmount) || 0;
    const todayPayment = cashAmount + onlineAmount + walletAmount;
    
    if (todayPayment === 0) {
      toast.error('Please enter at least some payment amount');
      return;
    }

    const payload = {
      paymentMethod: paymentForm.paymentMethod,
      cashAmount,
      onlineAmount,
      walletAmount,
      notes: paymentForm.paymentNotes,
    };

    updatePaymentMutation.mutate({ id: selectedCustomer._id, data: payload });
  };

  const handleViewDetails = (customer: Customer) => {
    navigate(`/customers`);
  };

  const isHighValue = (customer: Customer) => ((customer as any).billAmount || 0) > HIGH_VALUE_THRESHOLD;
  const isOverdue = (customer: Customer) => {
    const createdDate = new Date(customer.createdAt || '');
    const daysSinceCreation = Math.floor((Date.now() - createdDate.getTime()) / (1000 * 60 * 60 * 24));
    return daysSinceCreation > OVERDUE_DAYS;
  };

  return (
    <div className="space-y-5 animate-fade-in">
      <PageHeader
        title="Pending Payments"
        subtitle={`${summaryStats.totalPendingCustomers} pending payment${summaryStats.totalPendingCustomers === 1 ? '' : 's'}`}
      />

      {/* Search and Filter */}
      <div className="flex gap-3">
        <Input
          placeholder="Search by name or phone..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          className="max-w-xs"
        />
        <Select
          value={sortBy}
          onChange={(e) => { setSortBy(e.target.value); setPage(1); }}
          className="w-40"
        >
          <option value="createdAt">Sort by Date</option>
          <option value="billAmount">Sort by Amount</option>
          <option value="name">Sort by Name</option>
          <option value="phone">Sort by Phone</option>
        </Select>
        <Select
          value={sortOrder}
          onChange={(e) => { setSortOrder(e.target.value as 'asc' | 'desc'); setPage(1); }}
          className="w-32"
        >
          <option value="desc">Descending</option>
          <option value="asc">Ascending</option>
        </Select>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Total Pending Amount</p>
              <p className="text-2xl font-bold mt-1">{formatCurrency(summaryStats.totalPendingAmount)}</p>
            </div>
            <div className="text-3xl">💰</div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Total Pending Customers</p>
              <p className="text-2xl font-bold mt-1">{summaryStats.totalPendingCustomers}</p>
            </div>
            <div className="text-3xl">👥</div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Total Overdue Customers</p>
              <p className="text-2xl font-bold mt-1 text-red-400">{summaryStats.overdueCustomersCount}</p>
            </div>
            <div className="text-3xl">⚠️</div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Above ₹2,000</p>
              <p className="text-2xl font-bold mt-1 text-amber-400">{summaryStats.highValueCustomersCount}</p>
            </div>
            <div className="text-3xl">📈</div>
          </div>
        </Card>
      </div>

      {/* Customer Table */}
      <Card>
        {isLoading ? (
          <div className="p-4 space-y-3">{[...Array(6)].map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
        ) : customers.length === 0 ? (
          <EmptyState 
            icon="💳" 
            title="No pending payments" 
            description="All customers have paid their bills" 
          />
        ) : (
          <>
            <Table2>
              <TableHeader>
                <TableRow>
                  <TableHead>Order ID</TableHead>
                  <TableHead>Customer Name</TableHead>
                  <TableHead>Mobile Number</TableHead>
                  <TableHead>Menu Category</TableHead>
                  <TableHead>Menu Item</TableHead>
                  <TableHead>Total Bill Amount</TableHead>
                  <TableHead>Payment Method</TableHead>
                  <TableHead>Payment Status</TableHead>
                  <TableHead>Created Date</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {customers.map((c) => {
                  const isHighValueCustomer = isHighValue(c);
                  const isOverdueCustomer = isOverdue(c);
                  
                  return (
                    <TableRow 
                      key={c._id} 
                      className={cn(
                        isHighValueCustomer && 'bg-amber-500/5',
                        isOverdueCustomer && 'bg-red-500/5'
                      )}
                    >
                      <TableCell className="font-mono text-xs">{(c as any).orderId || c._id.slice(-8)}</TableCell>
                      <TableCell className="text-sm font-medium">{c.name}</TableCell>
                      <TableCell className="text-sm">{c.phone}</TableCell>
                      <TableCell className="text-sm">{(c as any).menuCategoryId?.name || '—'}</TableCell>
                      <TableCell className="text-sm">{(c as any).menuItemId?.name || '—'}</TableCell>
                      <TableCell className="text-sm font-medium">{formatCurrency((c as any).billAmount || 0)}</TableCell>
                      <TableCell className="text-sm capitalize">{c.paymentMethod === 'mixed' ? 'Mixed' : c.paymentMethod}</TableCell>
                      <TableCell>
                        <Badge variant="danger">Unpaid</Badge>
                      </TableCell>
                      <TableCell className="text-sm">{formatDate(c.createdAt || '', 'MMM dd, yyyy')}</TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button size="sm" variant="ghost" onClick={() => handleViewDetails(c)}>
                            View Details
                          </Button>
                          <Button 
                            size="sm" 
                            variant="outline" 
                            onClick={() => handleReceivePayment(c)}
                          >
                            Receive Payment
                          </Button>
                          <Button 
                            size="sm" 
                            variant="ghost" 
                            onClick={() => generateInvoiceMutation.mutate(c._id)}
                            disabled={generateInvoiceMutation.isPending}
                          >
                            Generate Invoice
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table2>

            {/* Pagination */}
            <div className="flex items-center justify-between p-4 border-t border-border">
              <div className="flex items-center gap-3">
                <span className="text-sm text-muted-foreground">
                  Showing {(page - 1) * rowsPerPage + 1}–{Math.min(page * rowsPerPage, total)} of {total} records
                </span>
                <Select
                  value={String(rowsPerPage)}
                  onChange={(e) => { setRowsPerPage(Number(e.target.value)); setPage(1); }}
                  className="w-20"
                >
                  <option value="10">10</option>
                  <option value="25">25</option>
                  <option value="50">50</option>
                  <option value="100">100</option>
                </Select>
              </div>
              {pages > 1 && (
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
                  <span className="text-sm text-muted-foreground">Page {page} of {pages}</span>
                  <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Next</Button>
                </div>
              )}
            </div>
          </>
        )}
      </Card>

      {/* Receive Payment Modal */}
      <Modal
        open={paymentModal}
        onClose={() => {
          setPaymentModal(false);
          setSelectedCustomer(null);
          setPaymentForm(emptyPaymentForm);
        }}
        title="Receive Payment"
        size="lg"
      >
        {selectedCustomer && (
          <div className="space-y-4">
            {/* Customer Details */}
            <div className="space-y-3 p-4 bg-muted/30 rounded-lg border border-border">
              <h3 className="text-sm font-semibold text-muted-foreground">Customer Details</h3>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-xs text-muted-foreground">Customer Name</p>
                  <p className="text-sm font-medium">{selectedCustomer.name}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Mobile Number</p>
                  <p className="text-sm font-medium">{selectedCustomer.phone}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Bill Amount</p>
                  <p className="text-sm font-bold">{formatCurrency((selectedCustomer as any).billAmount || 0)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Total Paid</p>
                  <p className="text-sm font-semibold">{formatCurrency((selectedCustomer as any).totalPaid || 0)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Pending Amount</p>
                  <p className="text-sm font-bold text-amber-400">{formatCurrency(Math.max(0, ((selectedCustomer as any).billAmount || 0) - ((selectedCustomer as any).totalPaid || 0)))}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Current Status</p>
                  <Badge variant={(selectedCustomer as any).paymentStatus === 'paid' ? 'success' : (selectedCustomer as any).paymentStatus === 'partial' ? 'warning' : 'danger'}>
                    {(selectedCustomer as any).paymentStatus === 'paid' ? 'Paid' : (selectedCustomer as any).paymentStatus === 'partial' ? 'Partial' : 'Unpaid'}
                  </Badge>
                </div>
              </div>
            </div>

            {/* Payment Form */}
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-muted-foreground">Payment Details</h3>
              <div className="space-y-1.5">
                <Label>Payment Method *</Label>
                <Select
                  value={paymentForm.paymentMethod}
                  onChange={(e) => setPaymentForm((f) => ({ ...f, paymentMethod: e.target.value as any }))}
                >
                  {PAYMENT_METHODS.map((method) => (
                    <option key={method} value={method} className="capitalize">
                      {method === 'wallet' ? 'Wallet / Advance Balance' : method === 'upi' ? 'Online (UPI)' : method}
                    </option>
                  ))}
                </Select>
              </div>
              
              {/* Payment Amount Fields */}
              <div className="space-y-3 p-3 bg-muted/30 rounded-lg border border-border">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>Cash Amount</Label>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      value={paymentForm.cashAmount}
                      onChange={(e) => setPaymentForm((f) => ({ ...f, cashAmount: e.target.value }))}
                      placeholder="Enter cash amount"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Online Amount (UPI)</Label>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      value={paymentForm.onlineAmount}
                      onChange={(e) => setPaymentForm((f) => ({ ...f, onlineAmount: e.target.value }))}
                      placeholder="Enter online amount"
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>Wallet Amount</Label>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={paymentForm.walletAmount}
                    onChange={(e) => setPaymentForm((f) => ({ ...f, walletAmount: e.target.value }))}
                    placeholder="Enter wallet amount"
                  />
                  <p className="text-xs text-muted-foreground">Available: {formatCurrency((selectedCustomer as any).walletBalance || 0)}</p>
                </div>
                
                {/* Payment Summary */}
                <div className="grid grid-cols-2 gap-3 pt-2 border-t border-border">
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">Today's Payment</p>
                    <p className="text-sm font-semibold">{formatCurrency((Number(paymentForm.cashAmount) || 0) + (Number(paymentForm.onlineAmount) || 0) + (Number(paymentForm.walletAmount) || 0))}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">Remaining Pending</p>
                    <p className="text-sm font-semibold text-amber-400">
                      {formatCurrency(Math.max(0, ((selectedCustomer as any).billAmount || 0) - ((selectedCustomer as any).totalPaid || 0) - ((Number(paymentForm.cashAmount) || 0) + (Number(paymentForm.onlineAmount) || 0) + (Number(paymentForm.walletAmount) || 0))))}
                    </p>
                  </div>
                </div>
              </div>
              
              <div className="space-y-1.5">
                <Label>Payment Notes</Label>
                <Input
                  value={paymentForm.paymentNotes}
                  onChange={(e) => setPaymentForm((f) => ({ ...f, paymentNotes: e.target.value }))}
                  placeholder="Add optional notes (e.g., receipt number)"
                />
              </div>
            </div>

            <div className="flex gap-2 pt-2">
              <Button variant="outline" className="flex-1" onClick={() => {
                setPaymentModal(false);
                setSelectedCustomer(null);
                setPaymentForm(emptyPaymentForm);
              }}>
                Cancel
              </Button>
              <Button
                className="flex-1"
                loading={updatePaymentMutation.isPending}
                onClick={handleSavePayment}
              >
                Save Payment
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
