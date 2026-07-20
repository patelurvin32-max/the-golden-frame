import { useState, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { customerService, menuService, billingService, branchService } from '@/services';
import { useAppStore, useAuthStore } from '@/store';
import type { Customer, MenuCategoryDoc, MenuItem, Branch } from '@/types';
import {
  Button, Card, Input, Label, Select, PageHeader, Skeleton, EmptyState,
  Table2, TableHeader, TableBody, TableRow, TableHead, TableCell,
  Badge, Modal, useToast, ConfirmDialog
} from '@/components/ui';
import { formatCurrency, formatDate, parseCurrencyValue, cn, downloadBlob } from '@/utils';

const TIERS: Record<string, { color: string; icon: string }> = {
  silver: { color: 'bg-slate-500/10 text-slate-300 border-slate-500/20', icon: '🥈' },
  gold: { color: 'bg-amber-500/10 text-amber-400 border-amber-500/20', icon: '🥇' },
  platinum: { color: 'bg-purple-500/10 text-purple-400 border-purple-500/20', icon: '💎' },
};

const emptyForm = {
  name: '',
  phone: '',
  email: '',
  branch: '',
  notes: '',
  menuCategoryId: '',
  menuItemId: '',
  startTime: '',
  endTime: '',
  paymentStatus: 'unpaid' as 'paid' | 'partial' | 'unpaid' | 'refunded',
  paymentMethod: 'cash' as 'cash' | 'upi' | 'mixed' | 'wallet',
  cashAmount: '',
  onlineAmount: '',
  walletAmount: '',
  amountReceived: '',
  pendingPaymentAmount: '',
  numberOfPlayers: '',
  additionalPlayers: '',
  billAmount: '',
  addToWallet: false,
  extraAmount: '',
  walletBalance: 0,
};

const PAYMENT_STATUSES = ['paid', 'partial', 'unpaid', 'refunded'] as const;
const PAYMENT_METHODS = ['cash', 'upi', 'mixed', 'wallet'] as const;

export default function CustomersPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const { selectedBranch } = useAppStore();
  const { user } = useAuthStore();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(25);
  const [modal, setModal] = useState<'create' | 'edit' | null>(null);
  const [selected, setSelected] = useState<Customer | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [deleteConfirm, setDeleteConfirm] = useState<Customer | null>(null);
  const [isLookingUp, setIsLookingUp] = useState(false);
  const [phoneError, setPhoneError] = useState('');

  const params: Record<string, string> = { page: String(page), limit: String(rowsPerPage) };
  if (selectedBranch) params.branch = selectedBranch;
  if (search) params.search = search;

  const { data, isLoading } = useQuery({
    queryKey: ['customers', selectedBranch, search, page, rowsPerPage],
    queryFn: () => customerService.getAll(params).then((r) => r.data),
    placeholderData: (prev) => prev,
  });

  // Fetch menu categories
  const { data: categoriesData } = useQuery({
    queryKey: ['menu-categories'],
    queryFn: () => menuService.getCategories({ activeOnly: 'true' }).then((r) => r.data),
    staleTime: 10 * 60 * 1000, // Cache for 10 minutes
    gcTime: 15 * 60 * 1000, // Keep in cache for 15 minutes
  });

  const categories: MenuCategoryDoc[] = Array.isArray((categoriesData as any)?.data?.categories) ? (categoriesData as any).data.categories : [];

  // Check if selected category is Accessories or Beverage (product purchases, not session-based)
  const selectedCategory = categories.find((cat) => cat._id === form.menuCategoryId);
  const categoryName = selectedCategory?.name?.toLowerCase() || '';
  const isProductCategory = categoryName === 'accessories' || categoryName === 'beverage' || categoryName === 'beverages';

  // Fetch branches for admin/super admin
  const { data: branchesData } = useQuery({
    queryKey: ['branches'],
    queryFn: () => branchService.getAll().then((r) => r.data.data.branches),
    enabled: user?.role === 'admin' || user?.role === 'super_admin',
    staleTime: 15 * 60 * 1000,
    gcTime: 20 * 60 * 1000,
  });
  const branches: Branch[] = Array.isArray(branchesData) ? branchesData : [];

  const branchToFetch = form.branch || selectedBranch || '';

  // Preload all menu items for the branch to enable instant selection
  const { data: allMenuItemsData, isFetching: isFetchingAllMenuItems } = useQuery({
    queryKey: ['all-menu-items', branchToFetch],
    queryFn: () => menuService.getAll({ limit: '1000', branch: branchToFetch }).then((r) => r.data),
    staleTime: 10 * 60 * 1000, // Cache for 10 minutes
    gcTime: 15 * 60 * 1000, // Keep in cache for 15 minutes
  });

  // Fetch menu items filtered by category and branch
  const menuParams: Record<string, string> = { limit: '1000' };
  if (form.menuCategoryId) menuParams.category = form.menuCategoryId;
  if (branchToFetch) menuParams.branch = branchToFetch;

  const { data: menuItemsData, isFetching: isFetchingMenuItems } = useQuery({
    queryKey: ['menu-items', form.menuCategoryId, branchToFetch],
    queryFn: () => menuService.getAll(menuParams).then((r) => r.data),
    enabled: !!form.menuCategoryId,
    staleTime: 10 * 60 * 1000, // Cache for 10 minutes
    gcTime: 15 * 60 * 1000, // Keep in cache for 15 minutes
    placeholderData: (previousData) => {
      if (previousData) return previousData;
      if (!allMenuItemsData?.data?.items) return undefined;
      const filteredItems = allMenuItemsData.data.items.filter((item: any) => {
        const catId = typeof item.category === 'object' && item.category !== null
          ? item.category._id
          : item.category;
        return String(catId) === String(form.menuCategoryId);
      });
      return {
        success: true,
        message: '',
        data: {
          items: filteredItems,
          pagination: { page: 1, limit: 1000, total: filteredItems.length, pages: 1 }
        }
      } as any;
    },
  });

  const menuItems: MenuItem[] = Array.isArray((menuItemsData as any)?.data?.items) ? (menuItemsData as any).data.items : [];
  
  // Deduplicate menu items by name when viewing all branches (memoized)
  const availableMenuItems = useMemo(() => {
    return menuItems.reduce((unique: MenuItem[], item: MenuItem) => {
      const exists = unique.find((u) => u.name === item.name);
      if (!exists) {
        unique.push(item);
      }
      return unique;
    }, []);
  }, [menuItems]);

  const [showMenuLoading, setShowMenuLoading] = useState(false);
  const isFetchingMenu = isFetchingAllMenuItems || isFetchingMenuItems;

  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (isFetchingMenu) {
      timer = setTimeout(() => {
        setShowMenuLoading(true);
      }, 300);
    } else {
      setShowMenuLoading(false);
    }
    return () => clearTimeout(timer);
  }, [isFetchingMenu]);

  const customers: Customer[] = Array.isArray((data as any)?.data?.customers) ? (data as any).data.customers : [];
  const total: number = (data as any)?.total || 0;
  const pages: number = (data as any)?.pages || 1;
  const filtered: number = (data as any)?.filtered || total;

  const createMutation = useMutation({
    mutationFn: (d: any) => customerService.create(d),
    onSuccess: (response) => {
      const message = response.data.message;
      const newCustomer = response.data.data?.customer;
      
      if (newCustomer) {
        qc.setQueriesData({ queryKey: ['customers'] }, (old: any) => {
          if (!old || !old.data || !Array.isArray(old.data.customers)) return old;
          const exists = old.data.customers.some((c: any) => c._id === newCustomer._id);
          if (exists) {
            return {
              ...old,
              data: {
                ...old.data,
                customers: old.data.customers.map((c: any) => c._id === newCustomer._id ? newCustomer : c)
              }
            };
          }
          return {
            ...old,
            total: (old.total || 0) + 1,
            filtered: (old.filtered || 0) + 1,
            data: {
              ...old.data,
              customers: [newCustomer, ...old.data.customers].slice(0, rowsPerPage)
            }
          };
        });
      }

      if (message && message.includes('Existing customer found')) {
        // Existing customer was loaded
        toast.success(message);
        qc.invalidateQueries({ queryKey: ['customers'] });
        setModal(null);
        setForm(emptyForm);
      } else {
        // New customer was created
        qc.invalidateQueries({ queryKey: ['customers'] });
        toast.success('Customer added!');
        setModal(null);
        setForm(emptyForm);
      }
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed to add customer'),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => customerService.update(id, data),
    onSuccess: (response) => {
      const updatedCustomer = response.data.data?.customer;
      const updatedWalletBalance = updatedCustomer?.walletBalance || 0;
      
      if (updatedCustomer) {
        qc.setQueriesData({ queryKey: ['customers'] }, (old: any) => {
          if (!old || !old.data || !Array.isArray(old.data.customers)) return old;
          return {
            ...old,
            data: {
              ...old.data,
              customers: old.data.customers.map((c: any) => c._id === updatedCustomer._id ? updatedCustomer : c)
            }
          };
        });
      }

      qc.invalidateQueries({ queryKey: ['customers'] });
      // Update form with fresh wallet balance from response
      setForm((f) => ({ ...f, walletBalance: updatedWalletBalance }));
      toast.success('Customer updated');
      setModal(null);
      setSelected(null);
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed to update customer'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => customerService.delete(id),
    onSuccess: (response, id) => {
      qc.setQueriesData({ queryKey: ['customers'] }, (old: any) => {
        if (!old || !old.data || !Array.isArray(old.data.customers)) return old;
        return {
          ...old,
          total: Math.max(0, (old.total || 0) - 1),
          filtered: Math.max(0, (old.filtered || 0) - 1),
          data: {
            ...old.data,
            customers: old.data.customers.filter((c: any) => c._id !== id)
          }
        };
      });
      qc.invalidateQueries({ queryKey: ['customers'] });
      toast.success('Customer deleted');
      setDeleteConfirm(null);
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed to delete customer'),
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

  // Auto-lookup customer by phone number
  const handlePhoneChange = async (phone: string) => {
    // Only allow numeric digits (0-9), limit to 10 digits
    const numericPhone = phone.replace(/\D/g, '').slice(0, 10);
    setForm((f) => ({ ...f, phone: numericPhone }));
    
    // Set validation error if phone is provided but not 10 digits
    if (numericPhone.length > 0 && numericPhone.length < 10) {
      setPhoneError('Mobile number must contain exactly 10 digits.');
    } else {
      setPhoneError('');
    }
    
    if (numericPhone.length === 10) {
      setIsLookingUp(true);
      try {
        const response = await customerService.lookup(numericPhone, selectedBranch || undefined);
        const customer = response.data.data.customer;
        if (customer) {
          setForm((f) => ({
            ...f,
            name: customer.name,
            phone: customer.phone,
            email: customer.email || '',
            notes: customer.notes || '',
            walletBalance: customer.walletBalance || 0,
          }));
          toast.success('Customer found! Details populated.');
        }
      } catch (error) {
        // Customer not found, allow creating new
      } finally {
        setIsLookingUp(false);
      }
    }
  };

  // Auto-update wallet amount when payment method changes to wallet
  useEffect(() => {
    if (form.paymentMethod === 'wallet' && form.billAmount && form.walletBalance > 0) {
      const walletUsed = Math.min(form.walletBalance, Number(form.billAmount));
      setForm((f) => ({
        ...f,
        walletAmount: String(walletUsed),
        cashAmount: String(Math.max(0, Number(form.billAmount) - walletUsed)),
        onlineAmount: '0',
      }));
    } else if (form.paymentMethod !== 'wallet') {
      // Reset wallet fields when switching away from wallet payment
      setForm((f) => ({
        ...f,
        walletAmount: '',
      }));
    }
  }, [form.paymentMethod, form.billAmount, form.walletBalance]);

  const handleSave = () => {
    // Auto-assign branch from user's branches for Branch Manager/Staff
    let branch = form.branch || selectedBranch;
    if (!branch && user && user.branches && user.branches.length > 0) {
      branch = user.branches[0]._id;
    }
    
    // Validation
    if ((user?.role === 'admin' || user?.role === 'super_admin') && !form.branch) {
      toast.error('Branch is required'); return;
    }
    if (!form.name) { toast.error('Full Name is required'); return; }
    if (!form.phone) { toast.error('Phone Number is required'); return; }
    if (!form.menuCategoryId) { toast.error('Menu Category is required'); return; }
    if (!form.menuItemId) { toast.error('Menu Item is required'); return; }
    // Only require Start Time for session-based categories (not Accessories or Beverages)
    if (!isProductCategory && !form.startTime) { toast.error('Start Time is required'); return; }
    if (!form.billAmount) { toast.error('Total Amount is required'); return; }
    if (!form.paymentStatus) { toast.error('Payment Status is required'); return; }
    if (!form.paymentMethod) { toast.error('Payment Method is required'); return; }

    const billAmount = parseCurrencyValue(form.billAmount);
    
    if (Number.isNaN(billAmount)) {
      toast.error('Total Amount must be a valid number with up to two decimals');
      return;
    }

    let cashAmount = parseCurrencyValue(form.cashAmount) || 0;
    let onlineAmount = parseCurrencyValue(form.onlineAmount) || 0;
    let walletAmount = parseCurrencyValue(form.walletAmount) || 0;
    const amountReceived = parseCurrencyValue(form.amountReceived) || 0;
    
    // Calculate total paid from individual payment methods
    let totalPaid = cashAmount + onlineAmount + walletAmount;
    
    // For simple payment methods (cash, upi), use amountReceived if individual amounts are not provided
    if (form.paymentMethod === 'cash' && cashAmount === 0 && amountReceived > 0) {
      cashAmount = amountReceived;
      totalPaid = amountReceived;
    } else if (form.paymentMethod === 'upi' && onlineAmount === 0 && amountReceived > 0) {
      onlineAmount = amountReceived;
      totalPaid = amountReceived;
    }
    
    // Round values to avoid floating-point precision issues
    const roundedBillAmount = Math.round(billAmount * 100) / 100;
    const roundedTotalPaid = Math.round(totalPaid * 100) / 100;
    
    // Calculate pending amount
    const pendingAmount = Math.max(0, roundedBillAmount - roundedTotalPaid);
    
    // Validation based on payment status
    if (form.paymentStatus === 'paid') {
      // For paid status, total paid must be >= bill amount
      if (roundedTotalPaid < roundedBillAmount) {
        toast.error(`For Paid status, Amount Received must be greater than or equal to the Bill Amount (${formatCurrency(roundedBillAmount)})`);
        return;
      }
    } else if (form.paymentStatus === 'partial') {
      // For partial status, allow any amount less than bill amount
      // No validation error needed, just calculate pending
      if (roundedTotalPaid === 0) {
        toast.error('For Partial status, at least some payment must be received');
        return;
      }
    } else if (form.paymentStatus === 'unpaid') {
      // For unpaid status, allow zero payment
      // Set all amounts to 0 if not provided
      if (roundedTotalPaid === 0) {
        // This is valid for unpaid status
        cashAmount = 0;
        onlineAmount = 0;
        walletAmount = 0;
      }
    }
    
    // Automatic wallet deduction when payment method is wallet
    if (form.paymentMethod === 'wallet' && form.paymentStatus !== 'unpaid') {
      walletAmount = Math.min(form.walletBalance || 0, roundedBillAmount);
      cashAmount = 0;
      onlineAmount = 0;
      totalPaid = walletAmount;
      // If wallet doesn't cover full bill, remaining amount needs to be paid
      const remainingBill = Math.max(0, roundedBillAmount - walletAmount);
      if (remainingBill > 0) {
        // For now, we'll require manual input for remaining amount
        // or we could auto-set cashAmount to remainingBill
        cashAmount = remainingBill;
        totalPaid = walletAmount + cashAmount;
      }
    }
    
    const extraAmount = totalPaid > billAmount ? totalPaid - billAmount : 0;

    // Validate wallet balance
    if (walletAmount > 0) {
      if (walletAmount > form.walletBalance) {
        toast.error(`Insufficient wallet balance. Available: ${formatCurrency(form.walletBalance)}, Required: ${formatCurrency(walletAmount)}`);
        return;
      }
    }

    const payload = {
      ...form,
      branch,
      billAmount,
      amountReceived: totalPaid,
      cashAmount,
      onlineAmount,
      walletAmount,
      ...(form.startTime && { startTime: new Date(form.startTime).toISOString() }),
      ...(form.endTime && { endTime: new Date(form.endTime).toISOString() }),
      ...(form.numberOfPlayers && { numberOfPlayers: parseInt(form.numberOfPlayers, 10) }),
      ...(form.paymentMethod === 'mixed' && {
        cashAmount,
        onlineAmount,
        walletAmount,
        totalPaid,
      }),
      ...(form.paymentMethod === 'wallet' && {
        walletAmount,
        cashAmount,
        onlineAmount,
        totalPaid,
      }),
      ...(form.paymentMethod === 'cash' && {
        cashAmount: totalPaid,
        totalPaid,
      }),
      ...(form.paymentMethod === 'upi' && {
        onlineAmount: totalPaid,
        totalPaid,
      }),
      ...(form.addToWallet && extraAmount > 0 && {
        addToWallet: true,
        extraAmount,
      }),
    };

    if (selected) {
      updateMutation.mutate({ id: selected._id, data: payload });
    } else {
      createMutation.mutate(payload);
    }
  };

  const openCreate = () => {
    setSelected(null);
    setForm(emptyForm);
    setModal('create');
  };

  const openEdit = (c: Customer) => {
    setSelected(c);
    
    setForm({
      name: c.name,
      phone: c.phone,
      email: c.email || '',
      branch: (c.branch as any)?._id || c.branch || '',
      notes: c.notes || '',
      menuCategoryId: (c.menuCategoryId as any)?._id || c.menuCategoryId || '',
      menuItemId: (c.menuItemId as any)?._id || c.menuItemId || '',
      startTime: c.startTime ? new Date(c.startTime).toISOString().slice(0, 16) : '',
      endTime: c.endTime ? new Date(c.endTime).toISOString().slice(0, 16) : '',
      paymentStatus: c.paymentStatus,
      paymentMethod: c.paymentMethod as 'cash' | 'upi' | 'mixed' | 'wallet',
      cashAmount: (c as any).cashAmount ? String((c as any).cashAmount) : '',
      onlineAmount: (c as any).onlineAmount ? String((c as any).onlineAmount) : '',
      walletAmount: (c as any).walletAmount ? String((c as any).walletAmount) : '',
      amountReceived: (c as any).totalPaid ? String((c as any).totalPaid) : String((c as any).billAmount || ''),
      pendingPaymentAmount: (c as any).pendingPaymentAmount ? String((c as any).pendingPaymentAmount) : '',
      numberOfPlayers: c.numberOfPlayers ? String(c.numberOfPlayers) : '',
      additionalPlayers: (c as any).additionalPlayers || '',
      billAmount: String((c as any).billAmount || ''),
      addToWallet: false,
      extraAmount: '',
      walletBalance: (c as any).walletBalance || 0,
    });
    setModal('edit');

    // Fetch fresh customer data to get latest wallet balance in background
    if (c.phone) {
      customerService.lookup(c.phone, selectedBranch || undefined)
        .then((response) => {
          const customer = response.data.data.customer;
          if (customer) {
            setForm((f) => ({
              ...f,
              walletBalance: customer.walletBalance || 0,
            }));
          }
        })
        .catch((error) => {
          // If lookup fails, use the stale value already set
        });
    }
  };

  const handleDelete = () => {
    if (deleteConfirm) {
      deleteMutation.mutate(deleteConfirm._id);
    }
  };

  return (
    <div className="space-y-5 animate-fade-in">
      <PageHeader
        title="Customers"
        subtitle={`${total} total custome${total === 1 ? 'r' : 'rs'}`}
        actions={<Button size="sm" onClick={openCreate}>+ Add Customer</Button>}
      />

      {/* Search */}
      <div className="flex gap-3">
        <Input
          placeholder="Search by name or phone..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          className="max-w-xs"
        />
      </div>

      <Card>
        {isLoading ? (
          <div className="p-4 space-y-3">{[...Array(6)].map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
        ) : customers.length === 0 ? (
          <EmptyState icon="👥" title="No customers found" description="Add your first customer to get started" action={<Button size="sm" onClick={openCreate}>+ Add Customer</Button>} />
        ) : (
          <>
            <Table2>
              <TableHeader>
                <TableRow>
                  <TableHead>Order ID</TableHead>
                  <TableHead>Customer Name</TableHead>
                  <TableHead>Menu Category</TableHead>
                  <TableHead>Menu Item</TableHead>
                  <TableHead>Bill Amount</TableHead>
                  <TableHead>Payment Method</TableHead>
                  <TableHead>Payment Status</TableHead>
                  <TableHead>Created At</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {customers.map((c) => {
                  const canDelete = user?.role === 'super_admin' || user?.role === 'admin';
                  
                  return (
                    <TableRow key={c._id}>
                      <TableCell className="font-mono text-xs">{(c as any).orderId || c._id.slice(-8)}</TableCell>
                      <TableCell className="text-sm font-medium">{c.name}</TableCell>
                      <TableCell className="text-sm">{(c as any).menuCategoryId?.name || '—'}</TableCell>
                      <TableCell className="text-sm">{(c as any).menuItemId?.name || '—'}</TableCell>
                      <TableCell className="text-sm font-medium">{formatCurrency((c as any).billAmount || 0)}</TableCell>
                      <TableCell className="text-sm capitalize">{c.paymentMethod}</TableCell>
                      <TableCell>
                        <Badge variant={(c as any).paymentStatus === 'paid' ? 'success' : (c as any).paymentStatus === 'partial' ? 'warning' : 'danger'}>
                          {(c as any).paymentStatus === 'paid' ? 'Paid' : (c as any).paymentStatus === 'partial' ? 'Partial' : 'Unpaid'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm">{formatDate(c.createdAt || '', 'MMM dd, yyyy HH:mm')}</TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button size="sm" variant="ghost" onClick={() => openEdit(c)}>Edit</Button>
                          <Button 
                            size="sm" 
                            variant="ghost" 
                            onClick={() => generateInvoiceMutation.mutate(c._id)}
                            disabled={generateInvoiceMutation.isPending}
                          >
                            Generate Invoice
                          </Button>
                          {canDelete && (
                            <Button size="sm" variant="ghost" className="text-red-400 hover:text-red-300" onClick={() => setDeleteConfirm(c)}>Delete</Button>
                          )}
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

      {/* Create / Edit Modal */}
      <Modal
        open={modal === 'create' || modal === 'edit'}
        onClose={() => setModal(null)}
        title={selected ? 'Edit Customer' : 'Add New Customer'}
        size="lg"
      >
        <div className="space-y-4 max-h-[70vh] overflow-y-auto">
          {/* Customer Info */}
          <div className="space-y-3">
            {(user?.role === 'admin' || user?.role === 'super_admin') && (
              <div className="space-y-1.5">
                <Label>Branch *</Label>
                <Select
                  value={form.branch}
                  onChange={(e) => setForm((f) => ({ ...f, branch: e.target.value }))}
                >
                  <option value="">Select branch</option>
                  {branches.map((branch) => (
                    <option key={branch._id} value={branch._id}>{branch.name}</option>
                  ))}
                </Select>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Full Name *</Label>
                <Input
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="Enter full name"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Phone Number *</Label>
                <Input
                  value={form.phone}
                  onChange={(e) => handlePhoneChange(e.target.value)}
                  placeholder="Enter phone number"
                  disabled={isLookingUp}
                  maxLength={10}
                />
                {phoneError && <p className="text-xs text-red-400">{phoneError}</p>}
                {isLookingUp && <p className="text-xs text-muted-foreground">Looking up customer...</p>}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input
                type="email"
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                placeholder="Enter email (optional)"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Additional Players</Label>
              <Input
                value={form.additionalPlayers}
                onChange={(e) => setForm((f) => ({ ...f, additionalPlayers: e.target.value }))}
                placeholder="Enter player names (e.g., Jinesh)"
              />
            </div>
          </div>

          {/* Menu Selection */}
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Menu Category *</Label>
                <Select
                  value={form.menuCategoryId}
                  onChange={(e) => setForm((f) => ({ ...f, menuCategoryId: e.target.value, menuItemId: '' }))}
                >
                  <option value="">Select category</option>
                  {categories.map((cat) => (
                    <option key={cat._id} value={cat._id}>{cat.name}</option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Menu Item *</Label>
                <Select
                  value={form.menuItemId}
                  onChange={(e) => setForm((f) => ({ ...f, menuItemId: e.target.value }))}
                  disabled={!form.menuCategoryId || availableMenuItems.length === 0}
                >
                  <option value="">Select item</option>
                  {availableMenuItems.map((item) => (
                    <option key={item._id} value={item._id}>
                      {item.name}
                    </option>
                  ))}
                </Select>
                {form.menuCategoryId && availableMenuItems.length === 0 && !showMenuLoading && (
                  <p className="text-xs text-muted-foreground">No available items for this category</p>
                )}
                {showMenuLoading && (
                  <p className="text-xs text-blue-400 animate-pulse">Loading menu items...</p>
                )}
              </div>
            </div>
          </div>

          {/* Total Amount */}
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Total Amount / Bill Amount *</Label>
              <Input
                type="number"
                min="0"
                step="any"
                value={form.billAmount}
                onChange={(e) => {
                  const value = e.target.value;
                  // Preserve exact value entered by user
                  setForm((f) => ({ ...f, billAmount: value }));
                }}
                placeholder="Enter total bill amount"
              />
            </div>
          </div>

          {/* Session Details - Only show for session-based categories */}
          {!isProductCategory && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Start Time *</Label>
                  <Input
                    type="datetime-local"
                    value={form.startTime}
                    onChange={(e) => setForm((f) => ({ ...f, startTime: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>End Time</Label>
                  <Input
                    type="datetime-local"
                    value={form.endTime}
                    onChange={(e) => setForm((f) => ({ ...f, endTime: e.target.value }))}
                  />
                </div>
              </div>
            </div>
          )}

          {/* Payment Info */}
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Payment Status *</Label>
                <Select
                  value={form.paymentStatus}
                  onChange={(e) => setForm((f) => ({ ...f, paymentStatus: e.target.value as any }))}
                >
                  {PAYMENT_STATUSES.map((status) => (
                    <option key={status} value={status} className="capitalize">{status}</option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Payment Method *</Label>
                <Select
                  value={form.paymentMethod}
                  onChange={(e) => setForm((f) => ({ ...f, paymentMethod: e.target.value as any }))}
                >
                  {PAYMENT_METHODS.map((method) => (
                    <option key={method} value={method} className="capitalize">
                      {method === 'wallet' ? 'Wallet / Advance Balance' : method}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
            
            {/* Available Wallet Balance */}
            <div className="space-y-1.5">
              <Label>Available Wallet Balance</Label>
              <Input
                type="text"
                value={formatCurrency(form.walletBalance || 0)}
                readOnly
                className="bg-muted/50"
              />
            </div>

            {/* Wallet Calculation Display */}
            {form.paymentMethod === 'wallet' && form.billAmount && (
              <div className="space-y-2 p-3 bg-blue-500/10 rounded-lg border border-blue-500/20">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Wallet Used</span>
                  <span className="text-sm font-semibold text-blue-400">
                    {formatCurrency(Math.min(form.walletBalance || 0, Number(form.billAmount) || 0))}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Remaining Bill Amount</span>
                  <span className="text-sm font-semibold">
                    {formatCurrency(Math.max(0, (Number(form.billAmount) || 0) - Math.min(form.walletBalance || 0, Number(form.billAmount) || 0)))}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Remaining Wallet Balance</span>
                  <span className="text-sm font-semibold text-green-400">
                    {formatCurrency(Math.max(0, (form.walletBalance || 0) - Math.min(form.walletBalance || 0, Number(form.billAmount) || 0)))}
                  </span>
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <Label>Amount Received</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={form.amountReceived}
                onChange={(e) => setForm((f) => ({ ...f, amountReceived: e.target.value }))}
                placeholder="Enter amount received (optional)"
              />
              <p className="text-xs text-muted-foreground">
                Leave empty to assume full payment of {formatCurrency(Number(form.billAmount) || 0)}
              </p>
            </div>

            {/* Extra Amount Display */}
            {form.amountReceived && Number(form.amountReceived) > 0 && Number(form.billAmount) > 0 && (
              <div className="space-y-2 p-3 bg-muted/30 rounded-lg border border-border">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Bill Amount</span>
                  <span className="text-sm font-semibold">{formatCurrency(Number(form.billAmount) || 0)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Amount Received</span>
                  <span className="text-sm font-semibold">{formatCurrency(Number(form.amountReceived) || 0)}</span>
                </div>
                <div className="flex items-center justify-between pt-2 border-t border-border">
                  <span className="text-sm text-muted-foreground">Extra Amount</span>
                  <span className={`text-sm font-semibold ${Number(form.amountReceived) > Number(form.billAmount) ? 'text-green-400' : 'text-muted-foreground'}`}>
                    {formatCurrency(Math.max(0, (Number(form.amountReceived) || 0) - (Number(form.billAmount) || 0)))}
                  </span>
                </div>
              </div>
            )}

            {/* Wallet Confirmation for Extra Amount */}
            {form.amountReceived && Number(form.amountReceived) > Number(form.billAmount) && (
              <div className="space-y-2 p-3 bg-green-500/10 rounded-lg border border-green-500/20">
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <p className="text-sm text-muted-foreground">Customer paid extra</p>
                    <p className="text-sm font-semibold text-green-400">
                      {formatCurrency((Number(form.amountReceived) || 0) - (Number(form.billAmount) || 0))}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="addToWallet"
                      checked={form.addToWallet}
                      onChange={(e) => setForm((f) => ({ ...f, addToWallet: e.target.checked }))}
                      className="w-4 h-4"
                    />
                    <label htmlFor="addToWallet" className="text-sm cursor-pointer">
                      Add to Wallet Balance
                    </label>
                  </div>
                </div>
              </div>
            )}

            {/* Mixed Payment Fields */}
            {form.paymentMethod === 'mixed' && (
              <div className="space-y-3 mt-3 p-3 bg-muted/30 rounded-lg border border-border">
                {form.walletBalance > 0 && (
                  <div className="flex items-center justify-between pb-2 border-b border-border">
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">Available Wallet Balance</p>
                      <p className="text-sm font-semibold text-green-400">
                        {formatCurrency(form.walletBalance)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        id="useWallet"
                        checked={form.walletAmount !== ''}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setForm((f) => ({ ...f, walletAmount: String(Math.min(form.walletBalance, Number(form.billAmount) || 0)) }));
                          } else {
                            setForm((f) => ({ ...f, walletAmount: '' }));
                          }
                        }}
                        className="w-4 h-4"
                      />
                      <label htmlFor="useWallet" className="text-sm cursor-pointer">
                        Use Wallet Balance
                      </label>
                    </div>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>Cash Amount *</Label>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      value={form.cashAmount}
                      onChange={(e) => setForm((f) => ({ ...f, cashAmount: e.target.value }))}
                      placeholder="Enter cash amount"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Online Amount *</Label>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      value={form.onlineAmount}
                      onChange={(e) => setForm((f) => ({ ...f, onlineAmount: e.target.value }))}
                      placeholder="Enter online amount"
                    />
                  </div>
                </div>
                {form.walletAmount !== '' && (
                  <div className="space-y-1.5">
                    <Label>Wallet Amount</Label>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      max={form.walletBalance}
                      value={form.walletAmount}
                      onChange={(e) => setForm((f) => ({ ...f, walletAmount: e.target.value }))}
                      placeholder="Enter wallet amount"
                    />
                  </div>
                )}
                <div className="space-y-1.5">
                  <Label>Pending Payment Amount</Label>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.pendingPaymentAmount}
                    onChange={(e) => setForm((f) => ({ ...f, pendingPaymentAmount: e.target.value }))}
                    placeholder="Enter pending payment amount"
                  />
                </div>
                {/* Payment Summary */}
                <div className="grid grid-cols-3 gap-3 pt-2 border-t border-border">
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">Total Bill</p>
                    <p className="text-sm font-semibold">
                      {formatCurrency(Number(form.billAmount) || 0)}
                    </p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">Total Paid</p>
                    <p className="text-sm font-semibold">
                      {formatCurrency((Number(form.cashAmount) || 0) + (Number(form.onlineAmount) || 0) + (Number(form.walletAmount) || 0))}
                    </p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">Pending Payment</p>
                    <p className="text-sm font-semibold text-amber-400">
                      {formatCurrency(Math.max(0, (Number(form.billAmount) || 0) - ((Number(form.cashAmount) || 0) + (Number(form.onlineAmount) || 0) + (Number(form.walletAmount) || 0))))}
                    </p>
                  </div>
                </div>
                {/* Validation Error */}
                {(Number(form.cashAmount) || 0) + (Number(form.onlineAmount) || 0) + (Number(form.walletAmount) || 0) + (Number(form.pendingPaymentAmount) || 0) > 0 &&
                 (Number(form.cashAmount) || 0) + (Number(form.onlineAmount) || 0) + (Number(form.walletAmount) || 0) + (Number(form.pendingPaymentAmount) || 0) !== (Number(form.billAmount) || 0) && (
                  <p className="text-xs text-red-400">
                    Total payment (Cash + UPI + Wallet + Pending) must equal the bill amount ({formatCurrency(Number(form.billAmount) || 0)})
                  </p>
                )}
                {(Number(form.walletAmount) || 0) > form.walletBalance && (
                  <p className="text-xs text-red-400">
                    Insufficient wallet balance. Available: {formatCurrency(form.walletBalance)}
                  </p>
                )}
              </div>
            )}

            {/* Wallet Payment Fields */}
            {form.paymentMethod === 'wallet' && (
              <div className="space-y-3 mt-3 p-3 bg-muted/30 rounded-lg border border-border">
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">Available Wallet Balance</p>
                    <p className="text-lg font-semibold text-green-400">
                      {formatCurrency(form.walletBalance)}
                    </p>
                  </div>
                  <div className="space-y-1 text-right">
                    <p className="text-xs text-muted-foreground">Bill Amount</p>
                    <p className="text-sm font-semibold">
                      {formatCurrency(Number(form.billAmount) || 0)}
                    </p>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>Wallet Amount to Use *</Label>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    max={form.walletBalance}
                    value={form.walletAmount}
                    onChange={(e) => setForm((f) => ({ ...f, walletAmount: e.target.value }))}
                    placeholder="Enter wallet amount"
                  />
                  <p className="text-xs text-muted-foreground">
                    Maximum: {formatCurrency(form.walletBalance)}
                  </p>
                </div>
                {/* Payment Summary */}
                <div className="grid grid-cols-2 gap-3 pt-2 border-t border-border">
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">Wallet Amount Used</p>
                    <p className="text-sm font-semibold">
                      {formatCurrency(Number(form.walletAmount) || 0)}
                    </p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">Remaining Wallet Balance</p>
                    <p className="text-sm font-semibold">
                      {formatCurrency(form.walletBalance - (Number(form.walletAmount) || 0))}
                    </p>
                  </div>
                </div>
                {/* Validation Error */}
                {(Number(form.walletAmount) || 0) > form.walletBalance && (
                  <p className="text-xs text-red-400">
                    Insufficient wallet balance. Available: {formatCurrency(form.walletBalance)}
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Notes */}
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Notes</Label>
              <Input
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                placeholder="Enter notes (optional)"
              />
            </div>
          </div>

          <div className="flex gap-2 pt-2">
            <Button variant="outline" className="flex-1" onClick={() => setModal(null)}>Cancel</Button>
            <Button
              className="flex-1"
              loading={createMutation.isPending || updateMutation.isPending}
              onClick={handleSave}
            >
              {selected ? 'Update Customer' : 'Add Customer'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        open={!!deleteConfirm}
        onClose={() => setDeleteConfirm(null)}
        onConfirm={handleDelete}
        title="Delete Customer"
        description={`Are you sure you want to delete ${deleteConfirm?.name}? This action cannot be undone.`}
        confirmText="Delete"
        cancelText="Cancel"
      />
    </div>
  );
}
