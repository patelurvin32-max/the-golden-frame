// ─────────────────────────────────────────────────────────────────────────────
// Branches Page
// ─────────────────────────────────────────────────────────────────────────────
import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { branchService, userService, attendanceService, logsService, settingsService, notificationService } from '@/services';
import {
  Button, Card, CardContent, CardHeader, CardTitle, Input, Label, Select,
  PageHeader, Skeleton, EmptyState, Table2, TableHeader, TableBody,
  TableRow, TableHead, TableCell, Badge, Modal, useToast
} from '@/components/ui';
import { Eye, EyeOff, Calendar } from 'lucide-react';
import { formatDate, formatDateTime, cn } from '@/utils';
import type { Branch, User } from '@/types';
import { useAppStore, useAuthStore } from '@/store';
import { useSocket } from '@/hooks/useSocket';

type LogsResponse = {
  logs: any[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    pages: number;
  };
};

// ── Branches ──────────────────────────────────────────────────────────────────
export function BranchesPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const [modalMode, setModalMode] = useState<'create' | 'edit' | null>(null);
  const [selectedBranch, setSelectedBranch] = useState<Branch | null>(null);
  const [form, setForm] = useState({
    name: '',
    code: '',
    address: '',
    phone: '',
    openingTime: '10:00',
    closingTime: '23:00',
  });

  const { data: branches = [], isLoading } = useQuery({ queryKey: ['branches'], queryFn: () => branchService.getAll().then((r) => r.data.data.branches) });

  const createMutation = useMutation({
    mutationFn: (d: any) => branchService.create(d),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['branches'] });
      toast.success('Branch created!');
      closeModal();
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed'),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data: payload }: { id: string; data: any }) => branchService.update(id, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['branches'] });
      toast.success('Branch updated!');
      closeModal();
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed'),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) => branchService.update(id, { isActive } as any),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['branches'] }); toast.success('Branch updated'); },
  });

  const resetForm = () => ({
    name: '',
    code: '',
    address: '',
    phone: '',
    openingTime: '10:00',
    closingTime: '23:00',
  });

  const openCreateModal = () => {
    setSelectedBranch(null);
    setForm(resetForm());
    setModalMode('create');
  };

  const openEditModal = (branch: Branch) => {
    setSelectedBranch(branch);
    setForm({
      name: branch.name || '',
      code: branch.code || '',
      address: branch.address || '',
      phone: branch.phone || '',
      openingTime: branch.openingTime || '10:00',
      closingTime: branch.closingTime || '23:00',
    });
    setModalMode('edit');
  };

  const closeModal = () => {
    setModalMode(null);
    setSelectedBranch(null);
    setForm(resetForm());
  };

  const handleSave = () => {
    const payload = {
      name: form.name.trim(),
      code: form.code.trim().toUpperCase(),
      address: form.address.trim() || undefined,
      phone: form.phone.trim() || undefined,
      openingTime: form.openingTime,
      closingTime: form.closingTime,
    };

    if (modalMode === 'edit' && selectedBranch) {
      updateMutation.mutate({ id: selectedBranch._id, data: payload });
      return;
    }

    createMutation.mutate(payload);
  };

  return (
    <div className="space-y-5 animate-fade-in">
      <PageHeader title="Branches" 
        actions={<Button size="sm" onClick={openCreateModal}>+ Add Branch</Button>}
      />
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {isLoading ? [...Array(2)].map((_, i) => <Skeleton key={i} className="h-40" />) :
          branches.map((branch) => (
            <Card key={branch._id} className={cn(!branch.isActive && 'opacity-60')}>
              <CardContent className="p-5 space-y-3">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-bold text-lg">{branch.name}</h3>
                    <code className="text-xs text-muted-foreground">{branch.code}</code>
                  </div>
                  <Badge variant={branch.isActive ? 'success' : 'danger'}>{branch.isActive ? 'Active' : 'Inactive'}</Badge>
                </div>
                {branch.address && <p className="text-sm text-muted-foreground">{branch.address}</p>}
                {branch.phone && <p className="text-sm text-muted-foreground">📞 {branch.phone}</p>}
                <p className="text-xs text-muted-foreground">🕐 {branch.openingTime} – {branch.closingTime}</p>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="flex-1 text-blue-400 hover:text-blue-300"
                    onClick={() => openEditModal(branch)}
                  >
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1"
                    onClick={() => toggleMutation.mutate({ id: branch._id, isActive: !branch.isActive })}
                  >
                    {branch.isActive ? 'Deactivate' : 'Activate'}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))
        }
      </div>
      <Modal
        open={modalMode !== null}
        onClose={closeModal}
        title={modalMode === 'edit' ? `Edit Branch${selectedBranch ? ` - ${selectedBranch.name}` : ''}` : 'Add New Branch'}
        size="md"
      >
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label>Branch Name *</Label><Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} /></div>
            <div className="space-y-1.5"><Label>Code *</Label><Input placeholder="e.g. DNH" value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))} /></div>
          </div>
          <div className="space-y-1.5"><Label>Address</Label><Input value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label>Phone</Label><Input value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} /></div>
            <div className="space-y-1.5"><Label>Opening</Label><Input type="time" value={form.openingTime} onChange={(e) => setForm((f) => ({ ...f, openingTime: e.target.value }))} /></div>
          </div>
          <div className="space-y-1.5"><Label>Closing</Label><Input type="time" value={form.closingTime} onChange={(e) => setForm((f) => ({ ...f, closingTime: e.target.value }))} /></div>
          <div className="flex gap-2 pt-2">
            <Button variant="outline" className="flex-1" onClick={closeModal}>Cancel</Button>
            <Button className="flex-1" loading={createMutation.isPending || updateMutation.isPending} onClick={handleSave}>
              {modalMode === 'edit' ? 'Save Changes' : 'Create Branch'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// ── Users / Staff ─────────────────────────────────────────────────────────────
type StaffFormState = {
  name: string;
  email: string;
  phone: string;
  address: string;
  salary: string;
  joiningDate: string;
  employmentStatus: string;
  notes: string;
  password: string;
  role: 'admin' | 'branch_manager' | 'branch_admin' | 'staff' | 'cashier';
  branches: string[];
  isActive: boolean;
  permissions: string[];
};

const createEmptyStaffForm = (): StaffFormState => ({
  name: '',
  email: '',
  phone: '',
  address: '',
  salary: '',
  joiningDate: '',
  employmentStatus: 'active',
  notes: '',
  password: '',
  role: 'staff',
  branches: [],
  isActive: true,
  permissions: [],
});

const staffFormFromUser = (user: User): StaffFormState => ({
  name: user.name || '',
  email: user.email || '',
  phone: user.phone || '',
  address: user.address || '',
  salary: user.salary !== undefined && user.salary !== null ? String(user.salary) : '',
  joiningDate: user.joiningDate ? String(user.joiningDate).slice(0, 10) : '',
  employmentStatus: user.employmentStatus || 'active',
  notes: user.notes || '',
  password: '',
  role: (user.role === 'admin' || user.role === 'branch_manager' || user.role === 'branch_admin' || user.role === 'cashier' || user.role === 'staff') ? user.role : 'staff',
  branches: (user.branches || []).map((b: any) => (typeof b === 'string' ? b : b._id)),
  isActive: user.isActive,
  permissions: user.permissions || [],
});

const PencilIcon = () => (
  <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-3.5 w-3.5">
    <path
      d="M13.586 3a2 2 0 0 1 2.828 0l.586.586a2 2 0 0 1 0 2.828L7.5 15.914 3 17l1.086-4.5L13.586 3Z"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);
const MODULE_PERMISSIONS = [
  {
    module: 'Dashboard',
    permissions: [
      { key: 'dashboard:view', label: 'View Dashboard' }
    ]
  },
  {
    module: 'Live Tables',
    permissions: [
      { key: 'tables:view', label: 'View Tables' },
      { key: 'tables:operate', label: 'Operate Tables (Start/Stop Sessions)' }
    ]
  },
  {
    module: 'Billing',
    permissions: [
      { key: 'billing:manage', label: 'Manage Billing (Create Bills, Receive Payments)' }
    ]
  },
  {
    module: 'Reservations / Bookings',
    permissions: [
      { key: 'bookings:manage', label: 'Manage Reservations' },
      { key: 'bookings:delete', label: 'Delete Reservations' }
    ]
  },
  {
    module: 'Customers',
    permissions: [
      { key: 'customers:view', label: 'View Customers' },
      { key: 'customers:create', label: 'Create Customers' },
      { key: 'customers:manage', label: 'Manage Customers (Edit/Delete)' }
    ]
  },
  {
    module: 'Expenses',
    permissions: [
      { key: 'expenses:manage', label: 'Manage Expenses' }
    ]
  },
  {
    module: 'Inventory',
    permissions: [
      { key: 'inventory:manage', label: 'Manage Inventory' }
    ]
  },
  {
    module: 'Menu',
    permissions: [
      { key: 'menu:view', label: 'View Menu' },
      { key: 'menu:manage', label: 'Manage Menu Items/Categories' },
      { key: 'menu:delete', label: 'Delete Menu Items/Categories' }
    ]
  },
  {
    module: 'Reports',
    permissions: [
      { key: 'reports:view', label: 'View Reports' }
    ]
  },
  {
    module: 'Attendance',
    permissions: [
      { key: 'attendance:manage', label: 'Manage Staff Attendance' }
    ]
  },
  {
    module: 'Staff Management',
    permissions: [
      { key: 'staff:view', label: 'View Staff Accounts' },
      { key: 'staff:manage', label: 'Manage Staff Accounts (Create/Edit/Deactivate)' }
    ]
  }
];

const canEditUser = (currentUser: any, targetUser: any) => {
  if (!currentUser) return false;
  if (targetUser.role === 'super_admin') return false; // nobody can edit super_admin
  if (currentUser.role === 'super_admin') return true; // super_admin can edit anybody else
  if (currentUser.role === 'admin') {
    // admin can edit anyone except super_admin
    return targetUser.role !== 'super_admin';
  }
  if (currentUser.role === 'branch_manager') {
    // branch_manager can edit staff/cashiers, but not super_admin, admin, or branch_admin
    return targetUser.role !== 'branch_admin' && targetUser.role !== 'admin';
  }
  return false;
};

export function UsersPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const { user: currentUser } = useAuthStore();
  const isSuperAdminOrAdmin = currentUser?.role === 'super_admin' || currentUser?.role === 'admin';
  const isSuperAdmin = currentUser?.role === 'super_admin';
  const managerBranch = currentUser?.branches?.[0];
  const managerBranchId = managerBranch ? (typeof managerBranch === 'string' ? managerBranch : managerBranch._id) : '';

  const [modalMode, setModalMode] = useState<'create' | 'edit' | null>(null);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [form, setForm] = useState<StaffFormState>(createEmptyStaffForm());
  const [showPassword, setShowPassword] = useState(false);

  const { data: branchesData } = useQuery({ queryKey: ['branches'], queryFn: () => branchService.getAll().then((r) => r.data.data.branches) });
  const { data, isLoading } = useQuery({ queryKey: ['users'], queryFn: () => userService.getAll().then((r) => r.data.data.users) });

  const createMutation = useMutation({
    mutationFn: (d: any) => userService.create(d),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      toast.success('Staff created!');
      setModalMode(null);
      setSelectedUser(null);
      setForm(createEmptyStaffForm());
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed'),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data: payload }: { id: string; data: any }) => userService.update(id, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      toast.success('Staff updated!');
      setModalMode(null);
      setSelectedUser(null);
      setForm(createEmptyStaffForm());
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed'),
  });

  const deactivateMutation = useMutation({
    mutationFn: (id: string) => userService.delete(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['users'] }); toast.success('User deactivated'); },
  });

  const users: User[] = data || [];
  const branches: Branch[] = branchesData || [];
  const roleColor: Record<string, string> = { super_admin: 'default', admin: 'secondary', branch_admin: 'success', branch_manager: 'info', staff: 'outline', cashier: 'warning' };

  const openCreateModal = () => {
    setSelectedUser(null);
    const initialForm = createEmptyStaffForm();
    if (!isSuperAdminOrAdmin && managerBranchId) {
      initialForm.branches = [managerBranchId];
    }
    setForm(initialForm);
    setModalMode('create');
  };

  const openEditModal = (user: User) => {
    setSelectedUser(user);
    const initialForm = staffFormFromUser(user);
    if (!isSuperAdminOrAdmin && managerBranchId) {
      initialForm.branches = [managerBranchId];
    }
    setForm(initialForm);
    setModalMode('edit');
  };

  const closeModal = () => {
    setModalMode(null);
    setSelectedUser(null);
    setForm(createEmptyStaffForm());
    setShowPassword(false);
  };

  const buildPayload = () => {
    const payload: Record<string, unknown> = {
      name: form.name.trim(),
      email: form.email.trim(),
      phone: form.phone.trim() || undefined,
      address: form.address.trim() || undefined,
      salary: form.salary === '' ? undefined : Number(form.salary),
      joiningDate: form.joiningDate || undefined,
      employmentStatus: form.employmentStatus.trim() || undefined,
      notes: form.notes.trim() || undefined,
      role: form.role,
      branches: !isSuperAdminOrAdmin && managerBranchId ? [managerBranchId] : form.branches,
      isActive: form.isActive,
      permissions: form.role === 'branch_admin' ? form.permissions : undefined,
    };

    if (form.password.trim()) {
      payload.password = form.password.trim();
    }

    return payload;
  };

  const handleSave = () => {
    if (!form.name.trim()) {
      toast.error('Full Name is required.');
      return;
    }
    if (!form.email.trim()) {
      toast.error('Email address is required.');
      return;
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(form.email.trim())) {
      toast.error('Please enter a valid email address.');
      return;
    }
    if (modalMode === 'create' && (!form.password || form.password.trim().length < 8)) {
      toast.error('Password must be at least 8 characters long.');
      return;
    }
    if (form.role === 'branch_admin') {
      const formBranches = !isSuperAdminOrAdmin && managerBranchId ? [managerBranchId] : form.branches;
      if (!formBranches || formBranches.length !== 1) {
        toast.error('A Branch Admin must always be assigned to exactly one branch.');
        return;
      }
    }

    const payload = buildPayload();
    if (modalMode === 'edit' && selectedUser) {
      updateMutation.mutate({ id: selectedUser._id, data: payload });
      return;
    }

    createMutation.mutate({ ...payload, password: form.password.trim() });
  };

  return (
    <div className="space-y-3 sm:space-y-5 animate-fade-in">
      <PageHeader title="Staff Management" 
        actions={<Button size="sm" onClick={openCreateModal}>+ Add Staff</Button>}
      />
      <Card>
        {isLoading ? <div className="p-3 sm:p-4 space-y-3">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
          : users.length === 0 ? <EmptyState icon="👤" title="No staff accounts" action={<Button size="sm" onClick={openCreateModal}>+ Add Staff</Button>} />
          : (
            <>
              {/* Desktop table */}
              <div className="hidden sm:block">
                <Table2>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead>Branches</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {users.map((user) => (
                      <TableRow key={user._id}>
                        <TableCell className="font-semibold">{user.name}</TableCell>
                        <TableCell className="text-muted-foreground text-sm">{user.email}</TableCell>
                        <TableCell><Badge variant={roleColor[user.role] as any} className="capitalize">{user.role.replace('_', ' ')}</Badge></TableCell>
                        <TableCell className="text-xs text-muted-foreground">{(user.branches as any[]).map((b: any) => b.name || b).join(', ') || '—'}</TableCell>
                        <TableCell><Badge variant={user.isActive ? 'success' : 'danger'}>{user.isActive ? 'Active' : 'Inactive'}</Badge></TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-2">
                            {canEditUser(currentUser, user) && (
                              <Button size="sm" variant="ghost" className="text-blue-400 hover:text-blue-300" onClick={() => openEditModal(user)}>
                                <PencilIcon />
                                Edit
                              </Button>
                            )}
                            {user.isActive && canEditUser(currentUser, user) && (
                              <Button size="sm" variant="ghost" className="text-red-400 hover:text-red-300"
                                onClick={() => { if (window.confirm('Deactivate this user?')) deactivateMutation.mutate(user._id); }}
                              >
                                Deactivate
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table2>
              </div>
              {/* Mobile card layout */}
              <div className="sm:hidden divide-y divide-border">
                {users.map((user) => (
                  <div key={user._id} className="p-3">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="font-semibold text-sm truncate">{user.name}</span>
                      <Badge variant={user.isActive ? 'success' : 'danger'} className="shrink-0 ml-2">{user.isActive ? 'Active' : 'Inactive'}</Badge>
                    </div>
                    <div className="flex items-center gap-2 mb-1">
                      <Badge variant={roleColor[user.role] as any} className="capitalize text-[10px]">{user.role.replace('_', ' ')}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground truncate">{user.email}</p>
                    {(user.branches as any[]).length > 0 && (
                      <p className="text-xs text-muted-foreground mt-0.5">{(user.branches as any[]).map((b: any) => b.name || b).join(', ')}</p>
                    )}
                    {canEditUser(currentUser, user) && (
                      <div className="flex gap-2 mt-2">
                        <Button size="sm" variant="ghost" className="text-blue-400 hover:text-blue-300 h-8 text-xs px-2" onClick={() => openEditModal(user)}>
                          <PencilIcon />
                          Edit
                        </Button>
                        {user.isActive && (
                          <Button size="sm" variant="ghost" className="text-red-400 hover:text-red-300 h-8 text-xs px-2"
                            onClick={() => { if (window.confirm('Deactivate this user?')) deactivateMutation.mutate(user._id); }}
                          >
                            Deactivate
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
      </Card>

      <Modal
        open={modalMode !== null}
        onClose={closeModal}
        title={modalMode === 'edit' ? `Edit Staff Member${selectedUser ? ` - ${selectedUser.name}` : ''}` : 'Add Staff Member'}
        size="xl"
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Full Name *</Label>
              <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required />
            </div>
            <div className="space-y-1.5">
              <Label>Mobile Number</Label>
              <Input value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Email *</Label>
              <Input type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} required />
            </div>
            <div className="space-y-1.5">
              <Label>Address</Label>
              <Input value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>{modalMode === 'edit' ? 'Password (leave blank to keep current)' : 'Password *'}</Label>
              <div className="relative">
                <Input
                  type={showPassword ? 'text' : 'password'}
                  value={form.password}
                  onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                  required={modalMode === 'create'}
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Role *</Label>
              <Select value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value as StaffFormState['role'] }))}>
                {isSuperAdmin && <option value="admin">Admin</option>}
                {isSuperAdmin && <option value="branch_admin">Branch Admin</option>}
                <option value="branch_manager">Branch Manager</option>
                <option value="staff">Staff</option>
                <option value="cashier">Cashier</option>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Salary</Label>
              <Input type="number" min={0} value={form.salary} onChange={(e) => setForm((f) => ({ ...f, salary: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Joining Date</Label>
              <Input type="date" value={form.joiningDate} onChange={(e) => setForm((f) => ({ ...f, joiningDate: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Employment Status</Label>
              <Select value={form.employmentStatus} onChange={(e) => setForm((f) => ({ ...f, employmentStatus: e.target.value }))}>
                <option value="active">Active</option>
                <option value="probation">Probation</option>
                <option value="on_leave">On Leave</option>
                <option value="resigned">Resigned</option>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Account Status</Label>
              <Select value={form.isActive ? 'active' : 'inactive'} onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.value === 'active' }))}>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </Select>
            </div>
            {form.role === 'branch_admin' && (
              <div className="col-span-1 lg:col-span-2 space-y-2 border-t border-border pt-4">
                <Label className="text-base font-semibold text-foreground">Branch Admin Permissions</Label>
                <p className="text-xs text-muted-foreground mb-3">
                  Configure granular access permissions for this Branch Admin. Only configurable by Super Admin.
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {MODULE_PERMISSIONS.map((group) => (
                    <div key={group.module} className="rounded-xl border border-border p-3 space-y-2 bg-accent/10">
                      <span className="font-semibold text-xs text-muted-foreground uppercase tracking-wider">{group.module}</span>
                      <div className="space-y-1.5">
                        {group.permissions.map((p) => {
                          const checked = form.permissions.includes(p.key);
                          const disabled = currentUser?.role !== 'super_admin';
                          return (
                            <label key={p.key} className={cn("flex items-start gap-2 text-sm", disabled ? "opacity-70 cursor-not-allowed" : "cursor-pointer")}>
                              <input
                                type="checkbox"
                                className="rounded mt-0.5"
                                checked={checked}
                                disabled={disabled}
                                onChange={(e) => {
                                  if (disabled) return;
                                  setForm((f) => ({
                                    ...f,
                                    permissions: e.target.checked
                                      ? [...f.permissions, p.key]
                                      : f.permissions.filter((k) => k !== p.key)
                                  }));
                                }}
                              />
                              <span>{p.label}</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <Label>Notes</Label>
            <textarea
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              rows={4}
              className="flex min-h-[96px] w-full rounded-xl border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 transition-colors resize-y"
              placeholder="Internal notes, shift details, and other editable staff info"
            />
          </div>

          <div className="space-y-1.5">
            <Label>Assign Branches</Label>
            {isSuperAdminOrAdmin ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {branches.map((b) => (
                  <label key={b._id} className="flex items-center gap-2 text-sm cursor-pointer rounded-xl border border-border px-3 py-2">
                    <input
                      type={form.role === 'branch_admin' ? 'radio' : 'checkbox'}
                      name={form.role === 'branch_admin' ? 'branch_admin_branch' : undefined}
                      className="rounded"
                      checked={form.branches.includes(b._id)}
                      onChange={(e) => setForm((f) => ({
                        ...f,
                        branches: form.role === 'branch_admin'
                          ? (e.target.checked ? [b._id] : [])
                          : (e.target.checked ? [...f.branches, b._id] : f.branches.filter((id) => id !== b._id)),
                      }))}
                    />
                    {b.name}
                  </label>
                ))}
              </div>
            ) : (
              <Input
                value={
                  branches.find((b) => form.branches.includes(b._id))?.name ||
                  (typeof managerBranch === 'object' && managerBranch?.name ? managerBranch.name : 'Assigned Branch')
                }
                disabled
                readOnly
              />
            )}
          </div>

          <div className="flex flex-row gap-2 pt-3 sticky bottom-0 bg-card -mx-4 sm:-mx-5 px-4 sm:px-5 pb-4 sm:pb-5 -mb-4 sm:-mb-5 border-t border-border mt-4">
            <Button variant="outline" className="flex-1 h-12 sm:h-10 text-sm font-medium" onClick={closeModal}>Cancel</Button>
            <Button className="flex-1 h-12 sm:h-10 text-sm font-medium" loading={createMutation.isPending || updateMutation.isPending} onClick={handleSave}>
              {modalMode === 'edit' ? 'Save Changes' : 'Create Staff'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// ── Attendance ─────────────────────────────────────────────────────────────────
export function AttendancePage() {
  const qc = useQueryClient();
  const toast = useToast();
  const { selectedBranch } = useAppStore();
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));

  const { data: staffData } = useQuery({ queryKey: ['users'], queryFn: () => userService.getAll().then((r) => r.data.data.users) });
  const { data: attData, isLoading } = useQuery({
    queryKey: ['attendance', selectedBranch, date],
    queryFn: () => attendanceService.getAll({ from: date, to: date }).then((r) => r.data.data?.records || []),
  });

  const markMutation = useMutation({
    mutationFn: (d: any) => attendanceService.mark(d),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['attendance'] }); toast.success('Attendance marked'); },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed'),
  });

  const staff = (staffData || []).filter((u: User) => u.role !== 'super_admin' && u.isActive);
  const records = attData || [];

  const getStatus = (userId: string) => records.find((r: any) => r.employee?._id === userId)?.status || null;
  const statusColors: Record<string, string> = { present: 'success', absent: 'danger', half_day: 'warning', leave: 'info' };

  return (
    <div className="space-y-5 animate-fade-in">
      <PageHeader title="Attendance"/>
      <div className="flex items-center gap-3">
        <Label>Date</Label>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-9 px-3 rounded-xl border border-input bg-background text-sm" />
      </div>
      <Card>
        {isLoading ? <div className="p-4 space-y-3">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-14" />)}</div>
          : staff.length === 0 ? <EmptyState icon="👥" title="No staff members found" />
          : (
            <Table2>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Mark Attendance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {staff.map((user: User) => {
                  const status = getStatus(user._id);
                  return (
                    <TableRow key={user._id}>
                      <TableCell className="font-semibold">{user.name}</TableCell>
                      <TableCell className="capitalize text-muted-foreground text-xs">{user.role.replace('_', ' ')}</TableCell>
                      <TableCell>
                        {status ? <Badge variant={statusColors[status] as any} className="capitalize">{status.replace('_', ' ')}</Badge>
                          : <span className="text-muted-foreground text-xs">Not marked</span>}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          {['present', 'absent', 'half_day', 'leave'].map((s) => (
                            <button key={s}
                              className={cn('px-2 py-1 rounded-lg text-xs font-medium border transition-colors',
                                status === s ? (s === 'present' ? 'bg-emerald-500 text-white border-transparent' : s === 'absent' ? 'bg-red-500 text-white border-transparent' : 'gradient-brand text-white border-transparent') : 'border-border text-muted-foreground hover:bg-accent'
                              )}
                              onClick={() => {
                                const branch = selectedBranch || (user.branches?.[0] as any)?._id;
                                if (!branch) { toast.error('Branch required'); return; }
                                markMutation.mutate({ employee: user._id, date, branch, status: s });
                              }}
                            >
                              {s.replace('_', ' ')}
                            </button>
                          ))}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table2>
          )}
      </Card>
    </div>
  );
}

// ── Audit Logs ────────────────────────────────────────────────────────────────
export function LogsPage() {
  const { selectedBranch } = useAppStore();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<'createdAt' | 'action' | 'description'>('createdAt');
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc');
  const pageSize = 10;

  const params: Record<string, string> = {
    page: String(page),
    limit: String(pageSize),
    sortBy,
    sortOrder,
  };
  if (selectedBranch) params.branch = selectedBranch;
  if (search.trim()) params.search = search.trim();

  const { data, isLoading } = useQuery<LogsResponse, any>({
    queryKey: ['logs', selectedBranch, search, sortBy, sortOrder, page],
    queryFn: () => logsService.getAll(params).then((r) => (r.data as any).data || { logs: [], pagination: { total: 0, page: 1, limit: pageSize, pages: 1 } }),
  });

  const logs = (data?.logs || []) as any[];
  const pagination = data?.pagination || { total: 0, page: 1, limit: pageSize, pages: 1 };
  const totalPages = Math.max(1, pagination.pages);
  const from = pagination.total === 0 ? 0 : (pagination.page - 1) * pagination.limit + 1;
  const to = Math.min(pagination.page * pagination.limit, pagination.total);

  const pageItems: (number | '...')[] = [];
  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i += 1) pageItems.push(i);
  } else {
    pageItems.push(1);
    if (pagination.page > 3) pageItems.push('...');
    for (let i = Math.max(2, pagination.page - 1); i <= Math.min(totalPages - 1, pagination.page + 1); i += 1) {
      pageItems.push(i);
    }
    if (pagination.page < totalPages - 2) pageItems.push('...');
    pageItems.push(totalPages);
  }

  const handleSearch = (value: string) => {
    setSearch(value);
    setPage(1);
  };

  return (
    <div className="space-y-5 animate-fade-in">
      <PageHeader title="Audit Logs"  />
      <Card>
        <div className="flex flex-col gap-3 px-4 py-4 border-b border-border sm:flex-row sm:items-center sm:justify-between">
          <Input
            placeholder="Search logs"
            value={search}
            onChange={(e) => handleSearch(e.target.value)}
            className="min-w-0 flex-1 max-w-sm"
          />
          <div className="flex flex-wrap items-center gap-2">
            <Select value={sortBy} onChange={(e) => { setSortBy(e.target.value as 'createdAt' | 'action' | 'description'); setPage(1); }} className="h-9 text-sm">
              <option value="createdAt">Sort by Time</option>
              <option value="action">Sort by Action</option>
              <option value="description">Sort by Description</option>
            </Select>
            <Select value={sortOrder} onChange={(e) => { setSortOrder(e.target.value as 'asc' | 'desc'); setPage(1); }} className="h-9 text-sm">
              <option value="desc">Newest first</option>
              <option value="asc">Oldest first</option>
            </Select>
          </div>
        </div>
        {isLoading ? <div className="p-4 space-y-3">{[...Array(8)].map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
          : logs.length === 0 ? <EmptyState icon="📋" title="No logs yet" />
          : (
            <>
              <Table2>
              <TableHeader>
                <TableRow>
                  <TableHead>Time</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Description</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.map((log: any) => (
                  <TableRow key={log._id}>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{formatDateTime(log.createdAt)}</TableCell>
                    <TableCell className="text-sm font-medium">{log.user?.name || '—'}</TableCell>
                    <TableCell><code className="text-xs bg-muted px-2 py-0.5 rounded-md">{log.action}</code></TableCell>
                    <TableCell className="text-sm text-muted-foreground">{log.description}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table2>
              <div className="flex flex-col gap-3 px-4 py-3 border-t border-border sm:flex-row sm:items-center sm:justify-between">
                <div className="text-sm text-muted-foreground">
                  Showing <span className="text-foreground">{from}–{to}</span> of <span className="text-foreground">{pagination.total}</span> records
                </div>
                <div className="flex flex-wrap items-center gap-1">
                  <Button size="sm" variant="outline" disabled={pagination.page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>
                    Previous
                  </Button>
                  {pageItems.map((item, index) => item === '...' ? (
                    <span key={`dots-${index}`} className="inline-flex h-8 min-w-[32px] items-center justify-center rounded-lg border border-border px-2 text-xs text-muted-foreground">…</span>
                  ) : (
                    <Button
                      key={item}
                      size="sm"
                      variant={item === pagination.page ? 'default' : 'outline'}
                      className={item === pagination.page ? 'border-transparent bg-muted text-foreground' : ''}
                      onClick={() => setPage(item as number)}
                    >
                      {item}
                    </Button>
                  ))}
                  <Button size="sm" variant="outline" disabled={pagination.page >= totalPages} onClick={() => setPage((current) => Math.min(totalPages, current + 1))}>
                    Next
                  </Button>
                </div>
              </div>
            </>
          )}
      </Card>
    </div>
  );
}

export function SettingsPage() {
  const toast = useToast();
  const [form, setForm] = useState({ businessName: 'The Golden Frame', currency: 'INR', currencySymbol: '₹', taxPercent: 0, receiptFooterNote: 'Thank you for visiting!', timezone: 'Asia/Kolkata' });

  useQuery({
    queryKey: ['settings'],
    queryFn: () => settingsService.get().then((r) => { const s = (r.data as any).data?.settings; if (s) setForm({ businessName: s.businessName || '', currency: s.currency || 'INR', currencySymbol: s.currencySymbol || '₹', taxPercent: s.taxPercent || 0, receiptFooterNote: s.receiptFooterNote || '', timezone: s.timezone || 'Asia/Kolkata' }); return s; }),
  });

  const saveMutation = useMutation({
    mutationFn: (d: any) => settingsService.update(d),
    onSuccess: () => toast.success('Settings saved!'),
    onError: () => toast.error('Failed to save'),
  });

  return (
    <div className="space-y-5 animate-fade-in max-w-2xl">
      <PageHeader title="Settings" subtitle="Business configuration" />
      <Card>
        <CardContent className="p-6 space-y-5">
          <h3 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground">Business Profile</h3>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5"><Label>Business Name</Label><Input value={form.businessName} onChange={(e) => setForm((f) => ({ ...f, businessName: e.target.value }))} /></div>
            <div className="space-y-1.5"><Label>Timezone</Label><Input value={form.timezone} onChange={(e) => setForm((f) => ({ ...f, timezone: e.target.value }))} /></div>
          </div>
          <h3 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground pt-2">Currency & Tax</h3>
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-1.5"><Label>Currency Code</Label><Input value={form.currency} onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value }))} /></div>
            <div className="space-y-1.5"><Label>Symbol</Label><Input value={form.currencySymbol} onChange={(e) => setForm((f) => ({ ...f, currencySymbol: e.target.value }))} /></div>
            <div className="space-y-1.5"><Label>Tax %</Label><Input type="number" min={0} max={100} value={form.taxPercent} onChange={(e) => setForm((f) => ({ ...f, taxPercent: Number(e.target.value) }))} /></div>
          </div>
          <h3 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground pt-2">Receipt</h3>
          <div className="space-y-1.5"><Label>Footer Note</Label><Input value={form.receiptFooterNote} onChange={(e) => setForm((f) => ({ ...f, receiptFooterNote: e.target.value }))} /></div>
          <Button onClick={() => saveMutation.mutate(form)} loading={saveMutation.isPending}>Save Settings</Button>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Notifications ─────────────────────────────────────────────────────────────
export function NotificationsPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const { onNotification } = useSocket();

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'unread' | 'read'>('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  useEffect(() => {
    const cleanup = onNotification(() => {
      qc.invalidateQueries({ queryKey: ['notifications'] });
    });
    return cleanup;
  }, [onNotification, qc]);

  const params: Record<string, string> = {
    page: String(page),
    limit: String(pageSize),
  };
  if (statusFilter !== 'all') params.status = statusFilter;
  if (search) params.search = search;

  const { data: notifData, isLoading } = useQuery({
    queryKey: ['notifications', statusFilter, search, page, pageSize],
    queryFn: () => notificationService.getAll(params).then((r) => r.data as any),
  });

  const markAllReadMutation = useMutation({
    mutationFn: () => notificationService.markAllRead(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notifications'] });
      toast.success('All notifications marked as read');
    },
  });

  const markReadMutation = useMutation({
    mutationFn: (id: string) => notificationService.markRead(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  const notifications: any[] = notifData?.data?.notifications || [];
  const pagination = notifData?.data?.pagination || { total: 0, page: 1, limit: pageSize, pages: 1 };
  const totalRecords = pagination.total;
  const totalPages = Math.max(1, pagination.pages);

  return (
    <div className="space-y-5 animate-fade-in">
      <PageHeader
        title="Notifications"
        actions={
          notifications.length > 0 ? (
            <Button size="sm" variant="outline" onClick={() => markAllReadMutation.mutate()} loading={markAllReadMutation.isPending}>
              ✓ Mark All as Read
            </Button>
          ) : undefined
        }
      />

      {/* Filter Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 flex-wrap flex-1">
          <div className="w-64">
            <Input
              placeholder="Search notifications..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            />
          </div>
          <Select
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value as any); setPage(1); }}
            className="w-36 h-9 text-xs"
          >
            <option value="all">All Status</option>
            <option value="unread">Unread Only</option>
            <option value="read">Read Only</option>
          </Select>
        </div>

        <div className="flex items-center gap-2">
          <Label className="text-xs text-muted-foreground whitespace-nowrap">Rows:</Label>
          <Select value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}>
            <option value={10}>10</option>
            <option value={25}>25</option>
            <option value={50}>50</option>
          </Select>
        </div>
      </div>

      <Card>
        <CardContent className="p-0 divide-y divide-border">
          {isLoading ? (
            <div className="p-6 space-y-4">
              {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}
            </div>
          ) : notifications.length === 0 ? (
            <EmptyState icon="🔔" title="No notifications found" description="You have no notifications matching your filters." />
          ) : (
            notifications.map((n: any) => (
              <div key={n._id} className={`p-4 flex items-start justify-between gap-4 transition-colors ${!n.isRead ? 'bg-primary/5' : ''}`}>
                <div className="flex items-start gap-3 min-w-0 flex-1">
                  <div className={`h-2.5 w-2.5 rounded-full mt-1.5 shrink-0 ${!n.isRead ? 'bg-primary' : 'bg-muted'}`} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-semibold text-foreground">{n.title}</p>
                      <Badge variant="outline" className="text-[10px] uppercase font-bold tracking-wider">
                        🏢 {n.branchName || 'Unknown Branch'}
                      </Badge>
                      {!n.isRead ? (
                        <Badge variant="info" className="text-[10px]">Unread</Badge>
                      ) : (
                        <Badge variant="outline" className="text-[10px]">Read</Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1.5 break-words leading-relaxed">{n.message}</p>
                    <div className="flex items-center gap-3 mt-2 text-[11px] text-muted-foreground/70">
                      <span>👤 {n.actorName || n.meta?.actorName || 'System'}</span>
                      <span>•</span>
                      <span>🕒 {formatDateTime(n.createdAt)}</span>
                    </div>
                  </div>
                </div>

                {!n.isRead && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-xs text-primary shrink-0"
                    onClick={() => markReadMutation.mutate(n._id)}
                  >
                    Mark as read
                  </Button>
                )}
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {/* Pagination Footer */}
      <div className="flex items-center justify-between mt-4">
        <p className="text-sm text-muted-foreground">
          Showing {totalRecords === 0 ? 0 : (page - 1) * pageSize + 1}–{Math.min(page * pageSize, totalRecords)} of {totalRecords} notifications
        </p>
        <div className="flex items-center gap-3">
          <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Previous
          </Button>
          <span className="text-sm text-muted-foreground font-medium">
            Page {page} of {totalPages}
          </span>
          <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}
