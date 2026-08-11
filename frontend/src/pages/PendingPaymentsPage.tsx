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
  paymentMethod: '' as 'cash' | 'upi' | 'mixed' | 'wallet' | '',
  amountReceived: '',
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
  const [detailsModal, setDetailsModal] = useState(false);
  const [detailsCustomer, setDetailsCustomer] = useState<Customer | null>(null);
  const [paymentForm, setPaymentForm] = useState(emptyPaymentForm);
  const [oldPaymentModal, setOldPaymentModal] = useState(false);
  const [oldPaymentForm, setOldPaymentForm] = useState({
    name: '',
    phone: '',
    amount: '',
    amountReceived: '',
    cashAmount: '',
    onlineAmount: '',
    walletAmount: '',
    paymentMethod: '' as 'cash' | 'upi' | 'mixed' | 'wallet' | '',
    paymentStatus: 'paid' as 'paid' | 'partial' | 'unpaid',
    notes: '',
    walletBalance: 0,
  });
  const [phoneError, setPhoneError] = useState('');
  const [isLookingUpCustomer, setIsLookingUpCustomer] = useState(false);
  const [oldPaymentMutation, setOldPaymentMutation] = useState(false);

  const userAssignedBranchId = user?.branches?.[0] ? (typeof user.branches[0] === 'string' ? user.branches[0] : (user.branches[0] as any)._id) : '';
  const effectiveBranch = selectedBranch || (user?.role !== 'super_admin' ? userAssignedBranchId : '');

  const params: Record<string, string> = {
    page: String(page),
    limit: String(rowsPerPage),
    paymentStatus: 'unpaid,partial',
    sortBy,
    sortOrder
  };
  if (effectiveBranch) params.branch = effectiveBranch;
  if (search) params.search = search;

  const { data, isLoading } = useQuery({
    queryKey: ['customers', effectiveBranch, search, page, rowsPerPage, 'unpaid,partial', sortBy, sortOrder],
    queryFn: () => customerService.getAll(params).then((r) => r.data),
    placeholderData: (prev) => prev,
  });

  const customers: Customer[] = (data as any)?.data?.customers || [];
  const total: number = (data as any)?.total || 0;
  const pages: number = (data as any)?.pages || 1;
  const filtered: number = (data as any)?.filtered || total;

  // Read summary statistics from backend response
  const summaryStats = useMemo(() => {
    if ((data as any)?.stats) {
      return (data as any).stats;
    }
    
    // Fallback if stats are not provided (shouldn't happen with updated backend)
    const totalPendingAmount = customers.reduce((sum, c) => {
      return sum + Math.max(0, ((c as any).billAmount || 0) - ((c as any).totalPaid || 0));
    }, 0);
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
  }, [customers, data]);

  const updatePaymentMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => customerService.receivePayment(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['customers', selectedBranch, search, page, rowsPerPage, 'unpaid,partial', sortBy, sortOrder] });
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

  const handleReceivePayment = async (customer: Customer) => {
    setSelectedCustomer(customer);
    const billAmount = (customer as any).billAmount || 0;
    const totalPaid = (customer as any).totalPaid || 0;
    const pendingAmount = Math.max(0, billAmount - totalPaid);

    setPaymentForm({
      paymentStatus: pendingAmount > 0 ? 'partial' : 'paid',
      paymentMethod: (customer.paymentMethod === 'mixed' || !customer.paymentMethod) ? 'cash' : customer.paymentMethod,
      amountReceived: '',
      cashAmount: '',
      onlineAmount: '',
      walletAmount: '',
      paymentNotes: '',
    });
    setPaymentModal(true);

    if (customer.phone && customer.phone.length === 10) {
      try {
        const branchToUse = (customer as any).branch?._id || (customer as any).branch || selectedBranch || undefined;
        const res = await customerService.lookup(customer.phone, branchToUse);
        const freshCustomer = res.data.data.customer;
        if (freshCustomer) {
          setSelectedCustomer((prev: any) => prev ? { ...prev, walletBalance: freshCustomer.walletBalance || 0 } : prev);
        }
      } catch (e) {
        // Fallback
      }
    }
  };

  const handleSavePayment = () => {
    if (!selectedCustomer) return;

    const billAmount = (selectedCustomer as any).billAmount || 0;
    const totalPaid = (selectedCustomer as any).totalPaid || 0;

    const amountReceived = Number(paymentForm.amountReceived) || 0;

    if (amountReceived === 0) {
      toast.error('Please enter amount received');
      return;
    }

    // Calculate new total paid (cumulative)
    const newTotalPaid = totalPaid + amountReceived;

    // Calculate remaining pending amount
    const remainingPending = Math.max(0, billAmount - newTotalPaid);

    // Determine payment status based on remaining amount
    let newPaymentStatus: 'paid' | 'partial' | 'unpaid' = 'unpaid';
    if (remainingPending === 0) {
      newPaymentStatus = 'paid';
    } else if (amountReceived > 0) {
      newPaymentStatus = 'partial';
    }

    // Get payment method specific amounts
    const cashAmount = Number(paymentForm.cashAmount) || 0;
    const onlineAmount = Number(paymentForm.onlineAmount) || 0;
    const walletAmount = Number(paymentForm.walletAmount) || 0;

    const payload = {
      paymentMethod: paymentForm.paymentMethod,
      amountReceived,
      totalPaid: newTotalPaid,
      cashAmount,
      onlineAmount,
      walletAmount,
      paymentStatus: newPaymentStatus,
      notes: paymentForm.paymentNotes,
    };

    updatePaymentMutation.mutate({ id: selectedCustomer._id, data: payload });
  };

  const handleViewDetails = (customer: Customer) => {
    setDetailsCustomer(customer);
    setDetailsModal(true);
  };

  const isHighValue = (customer: Customer) => ((customer as any).billAmount || 0) > HIGH_VALUE_THRESHOLD;
  const isOverdue = (customer: Customer) => {
    const createdDate = new Date(customer.createdAt || '');
    const daysSinceCreation = Math.floor((Date.now() - createdDate.getTime()) / (1000 * 60 * 60 * 24));
    return daysSinceCreation > OVERDUE_DAYS;
  };

  // Old Payment handlers
  const handleOldPaymentPhoneChange = async (phone: string) => {
    const cleaned = phone.replace(/\D/g, '').slice(0, 10);
    setOldPaymentForm((prev) => ({ ...prev, phone: cleaned }));

    if (cleaned.length > 0 && cleaned.length !== 10) {
      setPhoneError('Mobile number must be exactly 10 digits.');
    } else {
      setPhoneError('');
    }

    if (cleaned.length === 10) {
      setIsLookingUpCustomer(true);
      try {
        const branchToUse = effectiveBranch || undefined;
        const res = await customerService.lookup(cleaned, branchToUse);
        const customer = res.data.data.customer;
        if (customer) {
          setOldPaymentForm((prev) => ({
            ...prev,
            name: customer.name || prev.name,
            walletBalance: customer.walletBalance || 0,
          }));
        } else {
          setOldPaymentForm((prev) => ({ ...prev, walletBalance: 0 }));
        }
      } catch (e) {
        setOldPaymentForm((prev) => ({ ...prev, walletBalance: 0 }));
      } finally {
        setIsLookingUpCustomer(false);
      }
    } else {
      setOldPaymentForm((prev) => ({ ...prev, walletBalance: 0 }));
    }
  };

  const handleOldPaymentSave = async () => {
    if (!oldPaymentForm.name.trim()) {
      toast.error('Name is required');
      return;
    }
    if (!oldPaymentForm.phone || oldPaymentForm.phone.length !== 10) {
      setPhoneError('Mobile number must be exactly 10 digits');
      toast.error('Mobile number must be exactly 10 digits');
      return;
    }
    if (!oldPaymentForm.amount) {
      toast.error('Amount is required');
      return;
    }
    if (!oldPaymentForm.paymentStatus) {
      toast.error('Payment status is required');
      return;
    }

    // Only require payment method and amount received when status is not unpaid
    if (oldPaymentForm.paymentStatus !== 'unpaid') {
      if (!oldPaymentForm.paymentMethod) {
        toast.error('Payment method is required');
        return;
      }
      if (!oldPaymentForm.amountReceived) {
        toast.error('Amount received is required');
        return;
      }
    }

    const amount = Number(oldPaymentForm.amount);
    if (isNaN(amount) || amount <= 0) {
      toast.error('Amount must be a valid positive number');
      return;
    }

    // Validate amount received only when provided and status is not unpaid
    if (oldPaymentForm.paymentStatus !== 'unpaid' && oldPaymentForm.amountReceived) {
      const amountReceived = Number(oldPaymentForm.amountReceived);
      if (isNaN(amountReceived) || amountReceived <= 0) {
        toast.error('Amount received must be a valid positive number');
        return;
      }

      // For wallet payment, check balance
      if (oldPaymentForm.paymentMethod === 'wallet' && amountReceived > oldPaymentForm.walletBalance) {
        toast.error(`Insufficient wallet balance. Available: ${formatCurrency(oldPaymentForm.walletBalance)}`);
        return;
      }
    }

    setOldPaymentMutation(true);

    try {
      // Create the customer record with old payment data
      const payload = {
        name: oldPaymentForm.name.trim(),
        phone: oldPaymentForm.phone,
        billAmount: amount,
        totalPaid: oldPaymentForm.paymentStatus === 'paid' ? amount : (oldPaymentForm.paymentStatus === 'partial' ? Number(oldPaymentForm.amountReceived) : 0),
        amountReceived: oldPaymentForm.paymentStatus === 'paid' ? amount : (oldPaymentForm.paymentStatus === 'partial' ? Number(oldPaymentForm.amountReceived) : 0),
        paymentMethod: oldPaymentForm.paymentStatus !== 'unpaid' ? oldPaymentForm.paymentMethod : '',
        cashAmount: oldPaymentForm.paymentStatus !== 'unpaid' ? Number(oldPaymentForm.cashAmount) || 0 : 0,
        onlineAmount: oldPaymentForm.paymentStatus !== 'unpaid' ? Number(oldPaymentForm.onlineAmount) || 0 : 0,
        walletAmount: oldPaymentForm.paymentStatus !== 'unpaid' ? Number(oldPaymentForm.walletAmount) || 0 : 0,
        paymentStatus: oldPaymentForm.paymentStatus,
        notes: oldPaymentForm.notes.trim(),
        branch: effectiveBranch,
        isOldPayment: true, // Flag to identify old payment entries
      };

      await customerService.create(payload);

      // Invalidate queries to refresh the table
      qc.invalidateQueries({ queryKey: ['customers', effectiveBranch, search, page, rowsPerPage, 'unpaid,partial', sortBy, sortOrder] });
      qc.invalidateQueries({ queryKey: ['customers', effectiveBranch, search, page, rowsPerPage, 'paid', sortBy, sortOrder] });

      toast.success('Old payment recorded successfully!');
      setOldPaymentModal(false);
      setOldPaymentForm({
        name: '',
        phone: '',
        amount: '',
        amountReceived: '',
        cashAmount: '',
        onlineAmount: '',
        walletAmount: '',
        paymentMethod: '',
        paymentStatus: 'paid',
        notes: '',
        walletBalance: 0,
      });
      setPhoneError('');
    } catch (error: any) {
      toast.error(error?.response?.data?.message || 'Failed to record old payment');
    } finally {
      setOldPaymentMutation(false);
    }
  };

  const closeOldPaymentModal = () => {
    setOldPaymentModal(false);
    setOldPaymentForm({
      name: '',
      phone: '',
      amount: '',
      amountReceived: '',
      cashAmount: '',
      onlineAmount: '',
      walletAmount: '',
      paymentMethod: '',
      paymentStatus: 'paid',
      notes: '',
      walletBalance: 0,
    });
    setPhoneError('');
  };

  return (
    <div className="space-y-5 animate-fade-in">
      <PageHeader
        title="Pending Payments"
        subtitle={`${summaryStats.totalPendingCustomers} pending payment${summaryStats.totalPendingCustomers === 1 ? '' : 's'}`}
        actions={
          <Button size="sm" onClick={() => setOldPaymentModal(true)}>
            Old Payment
          </Button>
        }
      />

      {/* Search and Filter */}
      <div className="flex gap-3">
        <Input
          placeholder="Search by player name, phone, or ID..."
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
                  <TableHead>Pending ID</TableHead>
                  <TableHead>Player Name</TableHead>
                  <TableHead>Mobile Number</TableHead>
                  <TableHead>Pending Amount</TableHead>
                  {(user?.role === 'super_admin' || user?.role === 'admin') && <TableHead>Branch</TableHead>}
                  <TableHead>Table</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Created Date</TableHead>
                  <TableHead>Payment Status</TableHead>
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
                      <TableCell className="text-sm font-medium">{c.name || '—'}</TableCell>
                      <TableCell className="text-sm">{c.phone}</TableCell>
                      <TableCell className="text-sm font-medium">{formatCurrency(Math.max(0, ((c as any).billAmount || 0) - ((c as any).totalPaid || 0)))}</TableCell>
                      {(user?.role === 'super_admin' || user?.role === 'admin') && <TableCell className="text-sm">{(c as any).branch?.name || '—'}</TableCell>}
                      <TableCell className="text-sm">{(c as any).table?.name || '—'}</TableCell>
                      <TableCell className="text-sm">{(c as any).menuCategoryId?.name || '—'}</TableCell>
                      <TableCell className="text-sm">{formatDate(c.createdAt || '', 'MMM dd, yyyy')}</TableCell>
                      <TableCell>
                        <Badge variant={(c as any).paymentStatus === 'paid' ? 'success' : (c as any).paymentStatus === 'partial' ? 'warning' : 'danger'}>
                          {(c as any).paymentStatus === 'paid' ? 'Paid' : (c as any).paymentStatus === 'partial' ? 'Partial' : 'Unpaid'}
                        </Badge>
                      </TableCell>
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

      {/* View Details Modal */}
      <Modal
        open={detailsModal}
        onClose={() => {
          setDetailsModal(false);
          setDetailsCustomer(null);
        }}
        title="Payment Details"
        size="lg"
      >
        {detailsCustomer && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              {/* Order/Payment Info */}
              <div className="space-y-3 p-4 bg-muted/30 rounded-lg border border-border">
                <h3 className="text-sm font-semibold text-foreground">Order Information</h3>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-xs text-muted-foreground">Pending ID / Order ID</p>
                    <p className="text-sm font-mono text-foreground">{(detailsCustomer as any).orderId || detailsCustomer._id.slice(-8)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Created Date</p>
                    <p className="text-sm text-foreground">{formatDate(detailsCustomer.createdAt || '', 'MMM dd, yyyy hh:mm a')}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Category</p>
                    <p className="text-sm text-foreground">{(detailsCustomer as any).menuCategoryId?.name || '—'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Table</p>
                    <p className="text-sm text-foreground">{(detailsCustomer as any).table?.name || '—'}</p>
                  </div>
                  {(user?.role === 'super_admin' || user?.role === 'admin') && (
                    <div className="col-span-2">
                      <p className="text-xs text-muted-foreground">Branch</p>
                      <p className="text-sm text-foreground">{(detailsCustomer as any).branch?.name || '—'}</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Customer Info */}
              <div className="space-y-3 p-4 bg-muted/30 rounded-lg border border-border">
                <h3 className="text-sm font-semibold text-foreground">Customer Information</h3>
                <div className="grid grid-cols-1 gap-3">
                  <div>
                    <p className="text-xs text-muted-foreground">Name</p>
                    <p className="text-sm font-medium text-foreground">{detailsCustomer.name || '—'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Mobile Number</p>
                    <p className="text-sm text-foreground">{detailsCustomer.phone || '—'}</p>
                  </div>
                </div>
              </div>

              {/* Payment Info */}
              <div className="col-span-2 space-y-3 p-4 bg-muted/30 rounded-lg border border-border">
                <h3 className="text-sm font-semibold text-foreground">Payment Summary</h3>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <p className="text-xs text-muted-foreground">Bill Amount</p>
                    <p className="text-sm font-bold text-foreground">{formatCurrency((detailsCustomer as any).billAmount || 0)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Total Paid</p>
                    <p className="text-sm font-semibold text-foreground">{formatCurrency((detailsCustomer as any).totalPaid || 0)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Pending Amount</p>
                    <p className="text-sm font-bold text-amber-400">
                      {formatCurrency(Math.max(0, ((detailsCustomer as any).billAmount || 0) - ((detailsCustomer as any).totalPaid || 0)))}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Payment Status</p>
                    <div className="mt-1">
                      <Badge variant={(detailsCustomer as any).paymentStatus === 'paid' ? 'success' : (detailsCustomer as any).paymentStatus === 'partial' ? 'warning' : 'danger'}>
                        {(detailsCustomer as any).paymentStatus === 'paid' ? 'Paid' : (detailsCustomer as any).paymentStatus === 'partial' ? 'Partial' : 'Unpaid'}
                      </Badge>
                    </div>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Payment Method</p>
                    <p className="text-sm text-foreground capitalize">{(detailsCustomer as any).paymentMethod || '—'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Last Updated</p>
                    <p className="text-sm text-foreground">{formatDate((detailsCustomer as any).updatedAt || '', 'MMM dd, yyyy hh:mm a')}</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <Button onClick={() => {
                setDetailsModal(false);
                setDetailsCustomer(null);
              }}>
                Close
              </Button>
            </div>
          </div>
        )}
      </Modal>

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
                  <p className="text-xs text-muted-foreground">Name</p>
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
              {/* Amount Received */}
              <div className="space-y-1.5">
                <Label>Amount Received *</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={paymentForm.amountReceived}
                  onChange={(e) => setPaymentForm((f) => ({ ...f, amountReceived: e.target.value }))}
                  placeholder="Enter amount received"
                />
              </div>

              {/* Payment Method */}
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

              {/* Payment Method Specific Fields */}
              <div className="space-y-3 p-3 bg-muted/30 rounded-lg border border-border">
                {/* Cash Amount - shown when Cash or Mixed is selected */}
                {(paymentForm.paymentMethod === 'cash' || paymentForm.paymentMethod === 'mixed') && (
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
                )}

                {/* Online Amount - shown when Online (UPI) or Mixed is selected */}
                {(paymentForm.paymentMethod === 'upi' || paymentForm.paymentMethod === 'mixed') && (
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
                )}

                {/* Wallet Amount - shown when Wallet or Mixed is selected */}
                {(paymentForm.paymentMethod === 'wallet' || paymentForm.paymentMethod === 'mixed') && (
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
                    <p className="text-xs font-semibold text-emerald-400 mt-1">Available Wallet Balance: {formatCurrency((selectedCustomer as any).walletBalance || 0)}</p>
                  </div>
                )}

                {/* Payment Summary */}
                <div className="grid grid-cols-2 gap-3 pt-2 border-t border-border">
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">Today's Payment</p>
                    <p className="text-sm font-semibold">{formatCurrency(Number(paymentForm.amountReceived) || 0)}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">Remaining Pending</p>
                    <p className="text-sm font-semibold text-amber-400">
                      {formatCurrency(Math.max(0, ((selectedCustomer as any).billAmount || 0) - ((selectedCustomer as any).totalPaid || 0) - (Number(paymentForm.amountReceived) || 0)))}
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

      {/* Old Payment Modal */}
      <Modal
        open={oldPaymentModal}
        onClose={closeOldPaymentModal}
        title="Old Payment"
        size="lg"
      >
        <div className="space-y-4">
          {/* Name */}
          <div className="space-y-1.5">
            <Label htmlFor="oldPaymentName">
              Name <span className="text-destructive">*</span>
            </Label>
            <Input
              id="oldPaymentName"
              value={oldPaymentForm.name}
              onChange={(e) => setOldPaymentForm((prev) => ({ ...prev, name: e.target.value }))}
              placeholder="Enter customer name"
              autoFocus
            />
          </div>

          {/* Mobile Number */}
          <div className="space-y-1.5">
            <Label htmlFor="oldPaymentPhone">
              Mobile Number <span className="text-destructive">*</span>
            </Label>
            <Input
              id="oldPaymentPhone"
              type="tel"
              value={oldPaymentForm.phone}
              onChange={(e) => handleOldPaymentPhoneChange(e.target.value)}
              placeholder="Enter 10-digit mobile number"
              maxLength={10}
              className={phoneError ? 'border-destructive focus-visible:ring-destructive' : ''}
            />
            {phoneError && (
              <p className="text-xs text-destructive font-medium">{phoneError}</p>
            )}
            {isLookingUpCustomer && (
              <p className="text-xs text-muted-foreground">Looking up customer...</p>
            )}
          </div>

          {/* Amount */}
          <div className="space-y-1.5">
            <Label htmlFor="oldPaymentAmount">
              Amount <span className="text-destructive">*</span>
            </Label>
            <Input
              id="oldPaymentAmount"
              type="number"
              min="0"
              step="0.01"
              value={oldPaymentForm.amount}
              onChange={(e) => setOldPaymentForm((prev) => ({ ...prev, amount: e.target.value }))}
              placeholder="Enter payment amount"
            />
          </div>

          {/* Payment Status */}
          <div className="space-y-1.5">
            <Label htmlFor="oldPaymentStatus">
              Payment Status <span className="text-destructive">*</span>
            </Label>
            <Select
              id="oldPaymentStatus"
              value={oldPaymentForm.paymentStatus}
              onChange={(e) => setOldPaymentForm((prev) => ({ ...prev, paymentStatus: e.target.value as any }))}
            >
              <option value="paid">Paid</option>
              <option value="partial">Partial</option>
              <option value="unpaid">Unpaid</option>
            </Select>
          </div>

          {/* Payment Method Block - hidden when unpaid */}
          {oldPaymentForm.paymentStatus !== 'unpaid' && (
            <div className="space-y-3">
              {/* Amount Received */}
              <div className="space-y-1.5">
                <Label>Amount Received <span className="text-destructive">*</span></Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={oldPaymentForm.amountReceived}
                  onChange={(e) => setOldPaymentForm((prev) => ({ ...prev, amountReceived: e.target.value }))}
                  placeholder="Enter amount received"
                />
              </div>

              {/* Payment Method */}
              <div className="space-y-1.5">
                <Label>Payment Method <span className="text-destructive">*</span></Label>
                <Select
                  value={oldPaymentForm.paymentMethod}
                  onChange={(e) => setOldPaymentForm((prev) => ({ ...prev, paymentMethod: e.target.value as any }))}
                >
                  <option value="">Select payment method</option>
                  {PAYMENT_METHODS.map((method) => (
                    <option key={method} value={method} className="capitalize">
                      {method === 'wallet' ? 'Wallet / Advance Balance' : method === 'upi' ? 'Online (UPI)' : method}
                    </option>
                  ))}
                </Select>
              </div>

              {/* Payment Method Specific Fields */}
              <div className="space-y-3 p-3 bg-muted/30 rounded-lg border border-border">
                {/* Cash Amount - shown when Cash or Mixed is selected */}
                {(oldPaymentForm.paymentMethod === 'cash' || oldPaymentForm.paymentMethod === 'mixed') && (
                  <div className="space-y-1.5">
                    <Label>Cash Amount</Label>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      value={oldPaymentForm.cashAmount}
                      onChange={(e) => setOldPaymentForm((prev) => ({ ...prev, cashAmount: e.target.value }))}
                      placeholder="Enter cash amount"
                    />
                  </div>
                )}

                {/* Online Amount - shown when Online (UPI) or Mixed is selected */}
                {(oldPaymentForm.paymentMethod === 'upi' || oldPaymentForm.paymentMethod === 'mixed') && (
                  <div className="space-y-1.5">
                    <Label>Online Amount (UPI)</Label>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      value={oldPaymentForm.onlineAmount}
                      onChange={(e) => setOldPaymentForm((prev) => ({ ...prev, onlineAmount: e.target.value }))}
                      placeholder="Enter online amount"
                    />
                  </div>
                )}

                {/* Wallet Amount - shown when Wallet or Mixed is selected */}
                {(oldPaymentForm.paymentMethod === 'wallet' || oldPaymentForm.paymentMethod === 'mixed') && (
                  <div className="space-y-1.5">
                    <Label>Wallet Amount</Label>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      value={oldPaymentForm.walletAmount}
                      onChange={(e) => setOldPaymentForm((prev) => ({ ...prev, walletAmount: e.target.value }))}
                      placeholder="Enter wallet amount"
                    />
                    <p className="text-xs font-semibold text-emerald-400 mt-1">Available Wallet Balance: {formatCurrency(oldPaymentForm.walletBalance || 0)}</p>
                  </div>
                )}

                {/* Payment Summary */}
                <div className="grid grid-cols-2 gap-3 pt-2 border-t border-border">
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">Today's Payment</p>
                    <p className="text-sm font-semibold">{formatCurrency(Number(oldPaymentForm.amountReceived) || 0)}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">Remaining Pending</p>
                    <p className="text-sm font-semibold text-amber-400">
                      {formatCurrency(Math.max(0, (Number(oldPaymentForm.amount) || 0) - (oldPaymentForm.paymentStatus === 'paid' ? (Number(oldPaymentForm.amount) || 0) : (Number(oldPaymentForm.amountReceived) || 0))))}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Notes */}
          <div className="space-y-1.5">
            <Label htmlFor="oldPaymentNotes">Notes (Optional)</Label>
            <Input
              id="oldPaymentNotes"
              value={oldPaymentForm.notes}
              onChange={(e) => setOldPaymentForm((prev) => ({ ...prev, notes: e.target.value }))}
              placeholder="Add optional notes"
            />
          </div>

          {/* Action Buttons */}
          <div className="flex gap-2 pt-2">
            <Button variant="outline" className="flex-1" onClick={closeOldPaymentModal}>
              Cancel
            </Button>
            <Button
              className="flex-1"
              onClick={handleOldPaymentSave}
              loading={oldPaymentMutation}
              disabled={
                !oldPaymentForm.name.trim() ||
                !oldPaymentForm.phone ||
                oldPaymentForm.phone.length !== 10 ||
                !oldPaymentForm.amount ||
                (oldPaymentForm.paymentStatus !== 'unpaid' && !oldPaymentForm.amountReceived) ||
                (oldPaymentForm.paymentStatus !== 'unpaid' && !oldPaymentForm.paymentMethod) ||
                !!phoneError ||
                oldPaymentMutation
              }
            >
              Save Payment
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
