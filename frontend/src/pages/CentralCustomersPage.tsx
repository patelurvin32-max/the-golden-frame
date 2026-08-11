import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { customerService, branchService } from '@/services';
import { useAuthStore } from '@/store';
import {
  Button, Card, CardContent, Input, Label, Select,
  PageHeader, Skeleton, EmptyState, Table2, TableHeader, TableBody,
  TableRow, TableHead, TableCell, Badge, Modal, useToast
} from '@/components/ui';
import { Search, RefreshCw, Edit3, Phone, Building2, UserCheck, Plus, Mail, MapPin, Wallet, AlertCircle } from 'lucide-react';
import { formatCurrency, cn } from '@/utils';
import type { Customer } from '@/types';

export function CentralCustomersPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const { user } = useAuthStore();

  // Branch Admin: locked to their own branch(es)
  const isBranchAdmin = user?.role === 'branch_admin';
  const userBranchId = isBranchAdmin
    ? ((user?.branches?.[0] as any)?._id || user?.branches?.[0] || '') as string
    : '';

  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [selectedBranch, setSelectedBranch] = useState<string>('');

  // Modal state
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [editForm, setEditForm] = useState({ name: '', phone: '', email: '', address: '' });
  const [phoneError, setPhoneError] = useState('');

  // Add Customer modal state
  const [showAddModal, setShowAddModal] = useState(false);
  const [addForm, setAddForm] = useState({ name: '', phone: '', email: '', address: '', branch: '' });
  const [addPhoneError, setAddPhoneError] = useState('');

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  // Branch Admin: auto-lock selected branch to their assigned branch
  useEffect(() => {
    if (isBranchAdmin && userBranchId) {
      setSelectedBranch(userBranchId);
    }
  }, [isBranchAdmin, userBranchId]);

  // Fetch branches
  const { data: branches = [] } = useQuery({
    queryKey: ['branches'],
    queryFn: () => branchService.getAll().then((r) => r.data.data.branches),
  });

  // Fetch Super Admin central customer list
  const { data: queryData, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['superAdminCustomers', page, limit, debouncedSearch, selectedBranch],
    queryFn: () =>
      customerService.getSuperAdminCustomers({
        page: page.toString(),
        limit: limit.toString(),
        ...(debouncedSearch ? { search: debouncedSearch } : {}),
        ...(selectedBranch ? { branch: selectedBranch } : {}),
      }).then((r) => r.data),
  });

  const customers: Customer[] = (queryData as any)?.data?.customers || [];
  const total = (queryData as any)?.total || 0;
  const pages = (queryData as any)?.pages || 1;

  // Edit mutation
  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: { name: string; phone: string; email?: string; address?: string } }) =>
      customerService.updateSuperAdminCustomer(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['superAdminCustomers'] });
      qc.invalidateQueries({ queryKey: ['customers'] });
      const branchObj = typeof editingCustomer?.branch === 'object' ? editingCustomer.branch : null;
      const branchName = branchObj?.name || 'the selected branch';
      toast.success(`Customer information updated and synchronized across all modules in ${branchName}!`);
      closeEditModal();
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.message || 'Failed to update customer information.';
      toast.error(msg);
    },
  });

  // Create mutation (Super Admin)
  const createMutation = useMutation({
    mutationFn: (data: { name: string; phone: string; email?: string; address?: string; branch: string }) =>
      customerService.createSuperAdminCustomer(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['superAdminCustomers'] });
      qc.invalidateQueries({ queryKey: ['customers'] });
      toast.success('Customer created successfully!');
      closeAddModal();
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.message || 'Failed to create customer.';
      toast.error(msg);
    },
  });

  // ── Edit modal handlers ──
  const openEditModal = (customer: Customer) => {
    setEditingCustomer(customer);
    setEditForm({
      name: customer.name || '',
      phone: customer.phone || '',
      email: customer.email || '',
      address: customer.address || '',
    });
    setPhoneError('');
  };

  const closeEditModal = () => {
    setEditingCustomer(null);
    setEditForm({ name: '', phone: '', email: '', address: '' });
    setPhoneError('');
  };

  const handlePhoneChange = (val: string) => {
    const cleaned = val.replace(/\D/g, '').slice(0, 10);
    setEditForm((prev) => ({ ...prev, phone: cleaned }));
    if (cleaned.length > 0 && cleaned.length !== 10) {
      setPhoneError('Mobile number must be exactly 10 digits.');
    } else {
      setPhoneError('');
    }
  };

  const handleSave = () => {
    if (!editingCustomer) return;
    const nameTrimmed = editForm.name.trim();
    if (!nameTrimmed) {
      toast.error('Customer Name is required.');
      return;
    }
    if (!editForm.phone || editForm.phone.length !== 10) {
      setPhoneError('Mobile number must contain exactly 10 numeric digits.');
      toast.error('Mobile number must contain exactly 10 numeric digits.');
      return;
    }

    updateMutation.mutate({
      id: editingCustomer._id,
      data: {
        name: nameTrimmed,
        phone: editForm.phone,
        email: editForm.email.trim() || undefined,
        address: editForm.address,
      },
    });
  };

  // ── Add modal handlers ──
  const openAddModal = () => {
    // Branch Admin: pre-fill and lock the branch to their own
    setAddForm({ name: '', phone: '', email: '', address: '', branch: isBranchAdmin ? userBranchId : '' });
    setAddPhoneError('');
    setShowAddModal(true);
  };

  const closeAddModal = () => {
    setShowAddModal(false);
    setAddForm({ name: '', phone: '', email: '', address: '', branch: '' });
    setAddPhoneError('');
  };

  const handleAddPhoneChange = (val: string) => {
    const cleaned = val.replace(/\D/g, '').slice(0, 10);
    setAddForm((prev) => ({ ...prev, phone: cleaned }));
    if (cleaned.length > 0 && cleaned.length !== 10) {
      setAddPhoneError('Mobile number must be exactly 10 digits.');
    } else {
      setAddPhoneError('');
    }
  };

  const handleAddSave = () => {
    const nameTrimmed = addForm.name.trim();
    if (!nameTrimmed) {
      toast.error('Customer Name is required.');
      return;
    }
    if (!addForm.phone || addForm.phone.length !== 10) {
      setAddPhoneError('Mobile number must contain exactly 10 numeric digits.');
      toast.error('Mobile number must contain exactly 10 numeric digits.');
      return;
    }
    if (!addForm.branch) {
      toast.error('Please select a branch.');
      return;
    }

    createMutation.mutate({
      name: nameTrimmed,
      phone: addForm.phone,
      email: addForm.email.trim() || undefined,
      address: addForm.address,
      branch: addForm.branch,
    });
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Central Customers Management"
        actions={
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={openAddModal}>
              <Plus className="h-4 w-4 mr-1.5" />
              Add Customer
            </Button>
            <Button variant="outline" size="sm" onClick={() => refetch()} loading={isFetching}>
              <RefreshCw className={cn("h-4 w-4 mr-1.5", isFetching && "animate-spin")} />
              Refresh
            </Button>
          </div>
        }
      />

      {/* Search & Filter Bar */}
      <Card>
        <CardContent className="p-4 sm:p-5 flex flex-col md:flex-row gap-4 items-center justify-between">
          <div className="relative flex-1 w-full">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by customer name, mobile number, ID, or email..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 w-full"
            />
          </div>

          <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
            {/* Branch Filter — hidden for Branch Admin (they see only their branch) */}
            {!isBranchAdmin && (
              <div className="flex items-center gap-2 min-w-[200px] flex-1 md:flex-none">
                <Building2 className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                <Select
                  value={selectedBranch}
                  onChange={(e) => {
                    setSelectedBranch(e.target.value);
                    setPage(1);
                  }}
                  className="w-full"
                >
                  <option value="">All Branches</option>
                  {branches.map((b) => (
                    <option key={b._id} value={b._id}>
                      {b.name} ({b.code})
                    </option>
                  ))}
                </Select>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Customer Data Table */}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <Table2>
            <TableHeader>
              <TableRow>
                <TableHead>Customer ID</TableHead>
                <TableHead>Name</TableHead>
                {!isBranchAdmin && <TableHead>Branch</TableHead>}
                <TableHead>Mobile Number</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Address</TableHead>
                <TableHead className="text-right">Wallet Balance</TableHead>
                <TableHead className="text-right">Pending Payment</TableHead>
                <TableHead className="text-right">Edit</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                [...Array(5)].map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><Skeleton className="h-6 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-10 w-44" /></TableCell>
                    {!isBranchAdmin && <TableCell><Skeleton className="h-6 w-28" /></TableCell>}
                    <TableCell><Skeleton className="h-6 w-36" /></TableCell>
                    <TableCell><Skeleton className="h-6 w-32" /></TableCell>
                    <TableCell className="text-right"><Skeleton className="h-6 w-20 ml-auto" /></TableCell>
                    <TableCell className="text-right"><Skeleton className="h-6 w-20 ml-auto" /></TableCell>
                    <TableCell className="text-right"><Skeleton className="h-8 w-16 ml-auto" /></TableCell>
                  </TableRow>
                ))
              ) : customers.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={isBranchAdmin ? 7 : 8} className="h-48 text-center">
                    <EmptyState
                      icon={<UserCheck className="h-8 w-8" />}
                      title="No customers found"
                      description={
                        search || selectedBranch
                          ? 'Try adjusting your search query or branch filter.'
                          : 'No customer records have been created yet.'
                      }
                    />
                  </TableCell>
                </TableRow>
              ) : (
                customers.map((cust) => {
                  const branchObj = typeof cust.branch === 'object' ? cust.branch : null;

                  return (
                    <TableRow key={cust._id} className="hover:bg-accent/40 transition-colors">
                      {/* Customer ID */}
                      <TableCell className="font-mono text-sm text-muted-foreground">
                        {cust.customerId || '—'}
                      </TableCell>

                      {/* Name */}
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-3">
                          <div className="h-9 w-9 rounded-xl gradient-brand flex items-center justify-center text-white font-semibold text-sm flex-shrink-0 shadow-md shadow-blue-500/20">
                            {cust.name?.[0]?.toUpperCase() || 'C'}
                          </div>
                          <div>
                            <p className="font-semibold text-foreground leading-tight">{cust.name}</p>
                          </div>
                        </div>
                      </TableCell>

                      {/* Branch - only for Super Admin */}
                      {!isBranchAdmin && (
                        <TableCell className="text-sm">
                          {branchObj ? `${branchObj.name} (${branchObj.code})` : '—'}
                        </TableCell>
                      )}

                      {/* Mobile Number */}
                      <TableCell>
                        <div className="flex items-center gap-1.5 font-mono text-sm">
                          <Phone className="h-3.5 w-3.5 text-muted-foreground" />
                          <span>{cust.phone}</span>
                        </div>
                      </TableCell>

                      {/* Email */}
                      <TableCell className="text-sm text-muted-foreground">
                        {cust.email || '—'}
                      </TableCell>

                      {/* Address */}
                      <TableCell className="text-sm text-muted-foreground max-w-[200px] truncate" title={cust.address || ''}>
                        {cust.address || '—'}
                      </TableCell>

                      {/* Wallet Balance */}
                      <TableCell className="text-right">
                        <span className={cn(
                          'font-semibold text-sm tabular-nums',
                          (cust.walletBalance || 0) > 0 ? 'text-emerald-400' : 'text-muted-foreground'
                        )}>
                          {formatCurrency(cust.walletBalance || 0)}
                        </span>
                      </TableCell>

                      {/* Pending Payment */}
                      <TableCell className="text-right">
                        <span className={cn(
                          'font-semibold text-sm tabular-nums',
                          (cust.outstandingBalance || 0) > 0 ? 'text-red-400' : 'text-muted-foreground'
                        )}>
                          {formatCurrency(cust.outstandingBalance || 0)}
                        </span>
                      </TableCell>

                      {/* Edit */}
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => openEditModal(cust)}
                          className="text-blue-400 hover:text-blue-300 hover:bg-blue-500/10"
                        >
                          <Edit3 className="h-4 w-4 mr-1" />
                          Edit
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table2>
        </div>

        {/* Pagination Bar */}
        {!isLoading && customers.length > 0 && (
          <div className="p-4 border-t border-border flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-muted-foreground">
            <div>
              Showing <span className="font-semibold text-foreground">{(page - 1) * limit + 1}</span> to{' '}
              <span className="font-semibold text-foreground">{Math.min(page * limit, total)}</span> of{' '}
              <span className="font-semibold text-foreground">{total}</span> customers
            </div>

            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <span>Per page:</span>
                <Select
                  value={limit.toString()}
                  onChange={(e) => {
                    setLimit(Number(e.target.value));
                    setPage(1);
                  }}
                  className="h-8 text-xs w-20"
                >
                  <option value="10">10</option>
                  <option value="25">25</option>
                  <option value="50">50</option>
                  <option value="100">100</option>
                </Select>
              </div>

              <div className="flex items-center gap-1">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="h-8 px-3"
                >
                  Previous
                </Button>
                <span className="px-2 text-xs font-semibold">
                  {page} / {pages}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={page >= pages}
                  onClick={() => setPage((p) => Math.min(pages, p + 1))}
                  className="h-8 px-3"
                >
                  Next
                </Button>
              </div>
            </div>
          </div>
        )}
      </Card>

      {/* ── Edit Customer Modal ── */}
      {editingCustomer && (
        <Modal
          open={!!editingCustomer}
          onClose={closeEditModal}
          title="Edit Customer Information"
        >
          <div className="space-y-5 py-2">
            {/* Target Branch Alert */}
            <div className="p-3.5 rounded-xl border border-amber-500/20 bg-amber-500/10 text-amber-300 text-xs flex items-start gap-2.5">
              <Building2 className="h-4 w-4 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold">Target Branch: {typeof editingCustomer.branch === 'object' ? editingCustomer.branch.name : 'Selected Branch'}</p>
              </div>
            </div>

            {/* Customer Name */}
            <div className="space-y-1.5">
              <Label htmlFor="editName" className="font-semibold">
                Customer Name <span className="text-destructive">*</span>
              </Label>
              <Input
                id="editName"
                value={editForm.name}
                onChange={(e) => setEditForm((prev) => ({ ...prev, name: e.target.value }))}
                placeholder="Enter customer full name..."
                autoFocus
              />
            </div>

            {/* Mobile Number */}
            <div className="space-y-1.5">
              <Label htmlFor="editPhone" className="font-semibold">
                Mobile Number <span className="text-destructive">*</span>
              </Label>
              <Input
                id="editPhone"
                type="tel"
                value={editForm.phone}
                onChange={(e) => handlePhoneChange(e.target.value)}
                placeholder="Enter 10-digit mobile number..."
                maxLength={10}
                className={cn(phoneError && 'border-destructive focus-visible:ring-destructive')}
              />
              {phoneError && (
                <p className="text-xs text-destructive font-medium">{phoneError}</p>
              )}
            </div>

            {/* Email */}
            <div className="space-y-1.5">
              <Label htmlFor="editEmail" className="font-semibold">Email</Label>
              <Input
                id="editEmail"
                type="email"
                value={editForm.email}
                onChange={(e) => setEditForm((prev) => ({ ...prev, email: e.target.value }))}
                placeholder="Enter email address..."
              />
            </div>

            {/* Address */}
            <div className="space-y-1.5">
              <Label htmlFor="editAddress" className="font-semibold">Address</Label>
              <Input
                id="editAddress"
                value={editForm.address}
                onChange={(e) => setEditForm((prev) => ({ ...prev, address: e.target.value }))}
                placeholder="Enter address..."
              />
            </div>

            {/* Action Buttons */}
            <div className="flex items-center justify-end gap-3 pt-4 border-t border-border">
              <Button variant="outline" onClick={closeEditModal} disabled={updateMutation.isPending}>
                Cancel
              </Button>
              <Button
                variant="default"
                onClick={handleSave}
                loading={updateMutation.isPending}
                disabled={!editForm.name.trim() || editForm.phone.length !== 10 || !!phoneError}
              >
                Save & Synchronize Changes
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* ── Add Customer Modal ── */}
      <Modal
        open={showAddModal}
        onClose={closeAddModal}
        title="Add New Customer"
      >
        <div className="space-y-5 py-2">
          {/* Customer Name */}
          <div className="space-y-1.5">
            <Label htmlFor="addName" className="font-semibold">
              Customer Name <span className="text-destructive">*</span>
            </Label>
            <Input
              id="addName"
              value={addForm.name}
              onChange={(e) => setAddForm((prev) => ({ ...prev, name: e.target.value }))}
              placeholder="Enter customer full name..."
              autoFocus
            />
          </div>

          {/* Mobile Number */}
          <div className="space-y-1.5">
            <Label htmlFor="addPhone" className="font-semibold">
              Mobile Number <span className="text-destructive">*</span>
            </Label>
            <Input
              id="addPhone"
              type="tel"
              value={addForm.phone}
              onChange={(e) => handleAddPhoneChange(e.target.value)}
              placeholder="Enter 10-digit mobile number..."
              maxLength={10}
              className={cn(addPhoneError && 'border-destructive focus-visible:ring-destructive')}
            />
            {addPhoneError && (
              <p className="text-xs text-destructive font-medium">{addPhoneError}</p>
            )}
          </div>

          {/* Email */}
          <div className="space-y-1.5">
            <Label htmlFor="addEmail" className="font-semibold">Email</Label>
            <Input
              id="addEmail"
              type="email"
              value={addForm.email}
              onChange={(e) => setAddForm((prev) => ({ ...prev, email: e.target.value }))}
              placeholder="Enter email address..."
            />
          </div>

          {/* Address */}
          <div className="space-y-1.5">
            <Label htmlFor="addAddress" className="font-semibold">Address</Label>
            <Input
              id="addAddress"
              value={addForm.address}
              onChange={(e) => setAddForm((prev) => ({ ...prev, address: e.target.value }))}
              placeholder="Enter address..."
            />
          </div>

          {/* Branch — only shown for Super Admin */}
          {!isBranchAdmin && (
            <div className="space-y-1.5">
              <Label htmlFor="addBranch" className="font-semibold">
                Branch <span className="text-destructive">*</span>
              </Label>
              <Select
                value={addForm.branch}
                onChange={(e) => setAddForm((prev) => ({ ...prev, branch: e.target.value }))}
              >
                <option value="">Select branch</option>
                {branches.map((b) => (
                  <option key={b._id} value={b._id}>
                    {b.name} ({b.code})
                  </option>
                ))}
              </Select>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-border">
            <Button variant="outline" onClick={closeAddModal} disabled={createMutation.isPending}>
              Cancel
            </Button>
            <Button
              variant="default"
              onClick={handleAddSave}
              loading={createMutation.isPending}
              disabled={!addForm.name.trim() || addForm.phone.length !== 10 || !addForm.branch || !!addPhoneError}
            >
              Create Customer
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
