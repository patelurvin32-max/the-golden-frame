import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { customerService, menuService, billingService, branchService } from '@/services';
import { useAppStore, useAuthStore } from '@/store';
import type { Customer, MenuCategoryDoc, MenuItem, Branch } from '@/types';
import {
  Button, Card, Input, Label, Select, PageHeader, Skeleton, EmptyState,
  Table2, TableHeader, TableBody, TableRow, TableHead, TableCell,
  Badge, Modal, useToast, ConfirmDialog
} from '@/components/ui';
import { formatCurrency, formatDate, cn } from '@/utils';

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
  paymentStatus: 'unpaid' as 'paid' | 'unpaid' | 'refunded',
  paymentMethod: 'cash' as 'cash' | 'upi' | 'mixed',
  cashAmount: '',
  onlineAmount: '',
  numberOfPlayers: '',
};

const PAYMENT_STATUSES = ['paid', 'unpaid', 'refunded'] as const;
const PAYMENT_METHODS = ['cash', 'upi', 'mixed'] as const;

export default function CustomersPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
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
  });

  const categories: MenuCategoryDoc[] = (categoriesData as any)?.data?.categories || [];

  // Fetch branches for admin/super admin
  const { data: branchesData } = useQuery({
    queryKey: ['branches'],
    queryFn: () => branchService.getAll().then((r) => r.data),
    enabled: user?.role === 'admin' || user?.role === 'super_admin',
  });

  const branches: Branch[] = Array.isArray(branchesData) ? branchesData : (branchesData as any)?.data?.branches || [];

  // Fetch menu items filtered by category and branch
  const menuParams: Record<string, string> = { limit: '1000' };
  if (form.menuCategoryId) menuParams.category = form.menuCategoryId;
  if (form.branch) menuParams.branch = form.branch;
  else if (selectedBranch) menuParams.branch = selectedBranch;

  const { data: menuItemsData } = useQuery({
    queryKey: ['menu-items', form.menuCategoryId, form.branch || selectedBranch],
    queryFn: () => menuService.getAll(menuParams).then((r) => r.data),
    enabled: !!form.menuCategoryId,
  });

  const menuItems: MenuItem[] = (menuItemsData as any)?.data?.items || [];
  const availableMenuItems = menuItems;

  const customers: Customer[] = (data as any)?.data?.customers || [];
  const total: number = (data as any)?.total || 0;
  const pages: number = (data as any)?.pages || 1;
  const filtered: number = (data as any)?.filtered || total;

  const createMutation = useMutation({
    mutationFn: (d: any) => customerService.create(d),
    onSuccess: (response) => {
      const message = response.data.message;
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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['customers'] });
      toast.success('Customer updated');
      setModal(null);
      setSelected(null);
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed to update customer'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => customerService.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['customers'] });
      toast.success('Customer deleted');
      setDeleteConfirm(null);
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed to delete customer'),
  });

  const generateInvoiceMutation = useMutation({
    mutationFn: (customerId: string) => billingService.createFromCustomer(customerId),
    onSuccess: (response) => {
      const billId = response.data.data.bill._id;
      toast.success('Invoice generated successfully!');
      navigate(`/billing/${billId}`);
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed to generate invoice'),
  });

  // Auto-lookup customer by phone number
  const handlePhoneChange = async (phone: string) => {
    setForm((f) => ({ ...f, phone }));
    if (phone.length >= 10 && selectedBranch) {
      setIsLookingUp(true);
      try {
        const response = await customerService.lookup(phone, selectedBranch);
        const customer = response.data.data.customer;
        if (customer) {
          setForm((f) => ({
            ...f,
            name: customer.name,
            phone: customer.phone,
            email: customer.email || '',
            notes: customer.notes || '',
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
    if (!form.startTime) { toast.error('Start Time is required'); return; }
    if (!form.paymentStatus) { toast.error('Payment Status is required'); return; }
    if (!form.paymentMethod) { toast.error('Payment Method is required'); return; }

    // Mixed payment validation
    if (form.paymentMethod === 'mixed') {
      const cashAmount = Number(form.cashAmount) || 0;
      const onlineAmount = Number(form.onlineAmount) || 0;
      const totalPaid = cashAmount + onlineAmount;
      const menuItem = availableMenuItems.find((i) => i._id === form.menuItemId);
      const totalBill = menuItem?.price || 0;

      if (totalPaid !== totalBill) {
        toast.error(`Cash Amount + Online Amount must equal the total bill amount (${formatCurrency(totalBill)})`);
        return;
      }
    }

    const payload = {
      ...form,
      branch,
      startTime: new Date(form.startTime).toISOString(),
      ...(form.endTime && { endTime: new Date(form.endTime).toISOString() }),
      ...(form.numberOfPlayers && { numberOfPlayers: parseInt(form.numberOfPlayers) }),
      ...(form.paymentMethod === 'mixed' && {
        cashAmount: Number(form.cashAmount) || 0,
        onlineAmount: Number(form.onlineAmount) || 0,
        totalPaid: (Number(form.cashAmount) || 0) + (Number(form.onlineAmount) || 0),
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
      branch: c.branch as any,
      notes: c.notes || '',
      menuCategoryId: (c.menuCategoryId as any)?._id || c.menuCategoryId || '',
      menuItemId: (c.menuItemId as any)?._id || c.menuItemId || '',
      startTime: c.startTime ? new Date(c.startTime).toISOString().slice(0, 16) : '',
      endTime: c.endTime ? new Date(c.endTime).toISOString().slice(0, 16) : '',
      paymentStatus: c.paymentStatus,
      paymentMethod: c.paymentMethod as 'cash' | 'upi' | 'mixed',
      cashAmount: (c as any).cashAmount ? String((c as any).cashAmount) : '',
      onlineAmount: (c as any).onlineAmount ? String((c as any).onlineAmount) : '',
      numberOfPlayers: c.numberOfPlayers ? String(c.numberOfPlayers) : '',
    });
    setModal('edit');
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
                      <TableCell className="text-sm font-medium">{formatCurrency((c as any).menuItemId?.price || 0)}</TableCell>
                      <TableCell className="text-sm capitalize">{c.paymentMethod}</TableCell>
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
            <h3 className="text-sm font-semibold text-muted-foreground">Customer Information</h3>
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
                />
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
              <Label>Notes</Label>
              <Input
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                placeholder="Enter notes (optional)"
              />
            </div>
          </div>

          {/* Menu Selection */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-muted-foreground">Menu Selection</h3>
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
                      {item.name} - {formatCurrency(item.price)}
                    </option>
                  ))}
                </Select>
                {form.menuCategoryId && availableMenuItems.length === 0 && (
                  <p className="text-xs text-muted-foreground">No available items for this category</p>
                )}
              </div>
            </div>
          </div>

          {/* Session Details */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-muted-foreground">Session Details</h3>
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
            <div className="space-y-1.5">
              <Label>Number of Players</Label>
              <Input
                type="number"
                min="1"
                value={form.numberOfPlayers}
                onChange={(e) => setForm((f) => ({ ...f, numberOfPlayers: e.target.value }))}
                placeholder="Enter number of players (optional)"
              />
            </div>
          </div>

          {/* Payment Info */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-muted-foreground">Payment Details</h3>
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
                    <option key={method} value={method} className="capitalize">{method}</option>
                  ))}
                </Select>
              </div>
            </div>

            {/* Mixed Payment Fields */}
            {form.paymentMethod === 'mixed' && (
              <div className="space-y-3 mt-3 p-3 bg-muted/30 rounded-lg border border-border">
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
                {/* Payment Summary */}
                <div className="grid grid-cols-2 gap-3 pt-2 border-t border-border">
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">Total Paid</p>
                    <p className="text-sm font-semibold">
                      {formatCurrency((Number(form.cashAmount) || 0) + (Number(form.onlineAmount) || 0))}
                    </p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">Remaining Balance</p>
                    <p className="text-sm font-semibold">
                      {formatCurrency(
                        (Number(form.cashAmount) || 0) + (Number(form.onlineAmount) || 0) > 0
                          ? Math.max(0, (availableMenuItems.find((i) => i._id === form.menuItemId)?.price || 0) - ((Number(form.cashAmount) || 0) + (Number(form.onlineAmount) || 0)))
                          : (availableMenuItems.find((i) => i._id === form.menuItemId)?.price || 0)
                      )}
                    </p>
                  </div>
                </div>
                {/* Validation Error */}
                {(Number(form.cashAmount) || 0) + (Number(form.onlineAmount) || 0) > 0 &&
                 (Number(form.cashAmount) || 0) + (Number(form.onlineAmount) || 0) !== (availableMenuItems.find((i) => i._id === form.menuItemId)?.price || 0) && (
                  <p className="text-xs text-red-400">
                    Cash Amount + Online Amount must equal the total bill amount ({formatCurrency(availableMenuItems.find((i) => i._id === form.menuItemId)?.price || 0)})
                  </p>
                )}
              </div>
            )}
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
