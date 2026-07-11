import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { menuService, branchService, inventoryService } from '@/services';
import { useAppStore, useAuthStore } from '@/store';
import type { MenuItem, MenuCategoryDoc, InventoryItem } from '@/types';
import {
  Button, Card, Input, Label, Select, PageHeader, Skeleton, EmptyState,
  Table2, TableHeader, TableBody, TableRow, TableHead, TableCell,
  Badge, Modal, useToast
} from '@/components/ui';
import { formatCurrency, cn } from '@/utils';

const emptyForm = {
  name: '',
  category: '',
  inventoryItem: '',
  price: 0,
  halfPrice: '',
  fullPrice: '',
  description: '',
  availability: 'Available' as 'Available' | 'Unavailable',
  status: 'Active' as 'Active' | 'Inactive',
  branch: ''
};

export default function MenuPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const { selectedBranch } = useAppStore();
  const { user } = useAuthStore();

  // Determine if user can select branch (Super Admin can, Branch Manager and Staff cannot)
  const canSelectBranch = user?.role === 'super_admin';

  const [activeTab, setActiveTab] = useState<'items' | 'categories'>('items');

  // Items State
  const [modal, setModal] = useState<'create' | null>(null);
  const [selected, setSelected] = useState<MenuItem | null>(null);
  const [form, setForm] = useState({ ...emptyForm });

  const [search, setSearch] = useState('');
  const [filterCategory, setFilterCategory] = useState('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Categories State
  const [categoryModal, setCategoryModal] = useState<'create' | 'edit' | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<MenuCategoryDoc | null>(null);
  const [categoryForm, setCategoryForm] = useState({ name: '', status: 'Active' as 'Active' | 'Inactive' });

  // ── Queries ──────────────────────────────────────────────────────────────────
  const { data: branchData } = useQuery({
    queryKey: ['branches'],
    queryFn: () => branchService.getAll().then((r) => r.data.data.branches),
  });

  const { data: inventoryItems } = useQuery({
    queryKey: ['inventory-items'],
    queryFn: () => inventoryService.getAll({ limit: '1000' }).then((r) => r.data.data.items),
  });

  const { data: activeCategories } = useQuery({
    queryKey: ['menu-categories', 'active'],
    queryFn: () => menuService.getCategories({ activeOnly: 'true' }).then((r) => r.data.data.categories)
  });

  const { data: allCategories, isLoading: categoriesLoading } = useQuery({
    queryKey: ['menu-categories', 'all'],
    queryFn: () => menuService.getCategories().then((r) => r.data.data.categories),
    enabled: activeTab === 'categories'
  });

  const params: Record<string, string> = {
    page: String(page),
    limit: String(pageSize),
  };
  // For Branch Managers, use their assigned branch if selectedBranch is not set
  const branchToUse = selectedBranch || (!canSelectBranch && user?.branches?.[0] ? (typeof user.branches[0] === 'string' ? user.branches[0] : user.branches[0]._id) : null);
  if (branchToUse) params.branch = String(branchToUse);
  if (filterCategory !== 'all') params.category = String(filterCategory);
  if (search) params.search = search;

  const { data: menuData, isLoading: itemsLoading } = useQuery({
    queryKey: ['menu', branchToUse, filterCategory, search, page, pageSize],
    queryFn: () => menuService.getAll(params).then((r) => r.data.data),
    enabled: activeTab === 'items'
  });

  const items: MenuItem[] = menuData?.items || [];
  const pagination = menuData?.pagination || { page: 1, limit: pageSize, total: 0, pages: 1 };
  const totalRecords = pagination.total;
  const totalPages = Math.max(1, pagination.pages);

  // ── Form Syncing ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (selected) {
      setForm({
        name: selected.name,
        category: selected.category?._id || '',
        inventoryItem: selected.inventoryItem || '',
        price: selected.price,
        halfPrice: selected.halfPrice ? String(selected.halfPrice) : '',
        fullPrice: selected.fullPrice ? String(selected.fullPrice) : '',
        description: selected.description || '',
        availability: selected.availability,
        status: selected.status,
        branch: typeof selected.branch === 'string' ? selected.branch : selected.branch?._id || ''
      });
    } else {
      setForm({ ...emptyForm, category: activeCategories?.[0]?._id || '' });
      // Auto-assign branch for Branch Manager when creating new item
      if (!canSelectBranch && user?.branches?.[0]) {
        const branchId = typeof user.branches[0] === 'string' ? user.branches[0] : user.branches[0]._id;
        setForm((prev) => ({ ...prev, branch: branchId }));
      }
    }
  }, [selected, activeCategories, canSelectBranch, user]);

  useEffect(() => {
    if (selectedCategory) {
      setCategoryForm({
        name: selectedCategory.name,
        status: selectedCategory.status
      });
    } else {
      setCategoryForm({ name: '', status: 'Active' });
    }
  }, [selectedCategory]);

  // Reset page when filters change
  useEffect(() => {
    setPage(1);
  }, [branchToUse, filterCategory, search]);

  // ── Mutations ────────────────────────────────────────────────────────────────
  const createMutation = useMutation({
    mutationFn: (d: any) => menuService.create(d),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['menu'] });
      qc.invalidateQueries({ queryKey: ['menu-categories'] });
      toast.success('Menu item added!');
      setModal(null);
      setForm({ ...emptyForm });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed to add menu item'),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => menuService.update(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['menu'] });
      qc.invalidateQueries({ queryKey: ['menu-categories'] });
      toast.success('Menu item updated!');
      setModal(null);
      setSelected(null);
      setForm({ ...emptyForm });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed to update menu item'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => menuService.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['menu'] });
      qc.invalidateQueries({ queryKey: ['menu-categories'] });
      toast.success('Menu item deleted');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed to delete menu item'),
  });

  const saveCategoryMutation = useMutation({
    mutationFn: (data: { name: string; status: 'Active' | 'Inactive' }) => {
      if (selectedCategory) {
        return menuService.updateCategory(selectedCategory._id, data);
      }
      return menuService.createCategory(data);
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['menu-categories'] });
      qc.invalidateQueries({ queryKey: ['menu'] });
      toast.success(selectedCategory ? 'Category updated!' : 'Category created!');
      
      // Auto select newly created category if active
      if (!selectedCategory && res.data?.data?.category) {
        const newCat = res.data.data.category;
        if (newCat.status === 'Active') {
          setFilterCategory(newCat._id);
          setPage(1);
        }
      }

      setCategoryModal(null);
      setSelectedCategory(null);
      setCategoryForm({ name: '', status: 'Active' });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed to save category'),
  });

  const toggleCategoryStatusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'Active' | 'Inactive' }) =>
      menuService.updateCategory(id, { status }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['menu-categories'] });
      qc.invalidateQueries({ queryKey: ['menu'] });
      toast.success('Category status updated!');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed to toggle status'),
  });

  const deleteCategoryMutation = useMutation({
    mutationFn: (id: string) => menuService.deleteCategory(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['menu-categories'] });
      qc.invalidateQueries({ queryKey: ['menu'] });
      toast.success('Category deleted successfully!');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed to delete category'),
  });

  // ── Action Handlers ──────────────────────────────────────────────────────────
  const handleSaveItem = () => {
    const branch = form.branch || selectedBranch;
    if (!form.name.trim()) { toast.error('Item name is required'); return; }
    if (!form.category) { toast.error('Category is required'); return; }
    if (!form.price || isNaN(form.price) || Number(form.price) < 0) { toast.error('Valid price is required'); return; }
    if (canSelectBranch && !branch) { toast.error('Select a branch'); return; }
    if (!canSelectBranch && !branch) { toast.error('Branch assignment error'); return; }

    const payload = {
      ...form,
      name: form.name.trim(),
      price: Number(form.price),
      halfPrice: form.halfPrice ? Number(form.halfPrice) : undefined,
      fullPrice: form.fullPrice ? Number(form.fullPrice) : undefined,
      description: form.description.trim() || undefined,
      branch
    };

    if (selected) {
      updateMutation.mutate({ id: selected._id, data: payload });
    } else {
      createMutation.mutate(payload);
    }
  };

  const handleSaveCategory = () => {
    if (!categoryForm.name.trim()) { toast.error('Category name is required'); return; }
    saveCategoryMutation.mutate({
      name: categoryForm.name.trim(),
      status: categoryForm.status
    });
  };

  const handleDeleteCategory = (cat: MenuCategoryDoc) => {
    if (cat.totalItems && cat.totalItems > 0) {
      toast.error('This category contains menu items. Please move or delete them before deleting this category.');
      return;
    }
    if (window.confirm(`Are you sure you want to delete category "${cat.name}"?`)) {
      deleteCategoryMutation.mutate(cat._id);
    }
  };

  return (
    <div className="space-y-5 animate-fade-in">
      <PageHeader
        title="Menu"
        actions={
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => { setSelectedCategory(null); setCategoryForm({ name: '', status: 'Active' }); setCategoryModal('create'); }}>
              + Add Category
            </Button>
            <Button size="sm" onClick={() => { setSelected(null); setForm({ ...emptyForm }); setModal('create'); }}>
              + Add Menu Item
            </Button>
          </div>
        }
      />

      {/* Tab Navigation */}
      <div className="flex gap-2 border-b border-border pb-0">
        <button onClick={() => setActiveTab('items')}
          className={cn('px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px',
            activeTab === 'items' ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'
          )}
        >
          🍽️ Menu Items
        </button>
        <button onClick={() => setActiveTab('categories')}
          className={cn('px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px',
            activeTab === 'categories' ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'
          )}
        >
          🏷️ Categories
        </button>
      </div>

      {/* ITEMS TAB CONTENT */}
      {activeTab === 'items' && (
        <>
          {/* Top Controls */}
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              {/* Left Side: Search & Page size dropdown */}
              <div className="flex items-center gap-3 flex-wrap">
                <div className="w-64">
                  <Input placeholder="Search menu items..." value={search} onChange={(e) => setSearch(e.target.value)} />
                </div>
                <div className="flex items-center gap-2">
                  <Label className="text-xs text-muted-foreground whitespace-nowrap">Rows per page:</Label>
                  <Select value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))}>
                    <option value={10}>10</option>
                    <option value={25}>25</option>
                    <option value={50}>50</option>
                    <option value={100}>100</option>
                  </Select>
                </div>
              </div>
            </div>

            {/* Category Filter Chips */}
            <div className="flex gap-2 flex-wrap items-center">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mr-1">Categories:</span>
              <button onClick={() => setFilterCategory('all')}
                className={cn('px-3 py-1.5 rounded-xl border text-xs font-medium capitalize transition-colors',
                  filterCategory === 'all' ? 'gradient-brand text-white border-transparent' : 'border-border text-muted-foreground hover:bg-accent'
                )}
              >
                All
              </button>
              {(activeCategories || []).map((cat: any) => (
                <button key={cat._id} onClick={() => setFilterCategory(cat._id)}
                  className={cn('px-3 py-1.5 rounded-xl border text-xs font-medium capitalize transition-colors',
                    filterCategory === cat._id ? 'gradient-brand text-white border-transparent' : 'border-border text-muted-foreground hover:bg-accent'
                  )}
                >
                  {cat.name}
                </button>
              ))}
            </div>
          </div>

          {/* Items Table */}
          <Card>
            {itemsLoading ? (
              <div className="p-4 space-y-3">{[...Array(6)].map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
            ) : items.length === 0 ? (
              <EmptyState icon="🍽️" title="No menu items" description="Add your first menu item to the café menu" action={<Button size="sm" onClick={() => setModal('create')}>+ Add Menu Item</Button>} />
            ) : (
              <div className="overflow-x-auto">
                <Table2>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Category</TableHead>
                      <TableHead>Item Name</TableHead>
                      <TableHead>Price</TableHead>
                      <TableHead>Half Price</TableHead>
                      <TableHead>Full Price</TableHead>
                      <TableHead>Availability</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="w-[180px]">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map((item, index) => {
                      const prevItem = index > 0 ? items[index - 1] : null;
                      const isFirstOfCategory = !prevItem || prevItem.category?._id !== item.category?._id;

                      return (
                        <React.Fragment key={item._id}>
                          {isFirstOfCategory && (
                            <TableRow className="bg-muted/40 hover:bg-muted/40 border-b border-border">
                              <TableCell colSpan={8} className="py-2 px-4 font-bold text-xs text-muted-foreground tracking-wide uppercase">
                                📁 {item.category?.name || 'Unassigned'}
                              </TableCell>
                            </TableRow>
                          )}
                          <TableRow>
                            <TableCell className="text-muted-foreground text-xs">{item.category?.name || 'Unassigned'}</TableCell>
                            <TableCell className="font-semibold">{item.name}</TableCell>
                            <TableCell>{formatCurrency(item.price)}</TableCell>
                            <TableCell>{item.halfPrice ? formatCurrency(item.halfPrice) : '—'}</TableCell>
                            <TableCell>{item.fullPrice ? formatCurrency(item.fullPrice) : '—'}</TableCell>
                            <TableCell>
                              <Badge variant={item.availability === 'Available' ? 'success' : 'danger'}>
                                {item.availability}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <Badge variant={item.status === 'Active' ? 'success' : 'danger'}>
                                {item.status}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <div className="flex gap-1">
                                <Button size="sm" variant="ghost"
                                  onClick={() => { setSelected(item); setModal('create'); }}
                                >
                                  Edit
                                </Button>
                                <Button size="sm" variant="ghost" className="text-red-400 hover:bg-red-500/10"
                                  onClick={() => { if (window.confirm('Delete this menu item?')) deleteMutation.mutate(item._id); }}
                                >
                                  ✕
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        </React.Fragment>
                      );
                    })}
                  </TableBody>
                </Table2>
              </div>
            )}
          </Card>

          {/* Bottom Pagination */}
          <div className="flex items-center justify-between mt-4">
            {/* Left: Record Counter */}
            <p className="text-sm text-muted-foreground">
              Showing {totalRecords === 0 ? 0 : (page - 1) * pageSize + 1}–{Math.min(page * pageSize, totalRecords)} of {totalRecords} records
            </p>
            
            {/* Right: Pagination Controls */}
            <div className="flex items-center gap-4">
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
        </>
      )}

      {/* CATEGORIES TAB CONTENT */}
      {activeTab === 'categories' && (
        <Card>
          {categoriesLoading ? (
            <div className="p-4 space-y-3">{[...Array(6)].map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
          ) : (allCategories || []).length === 0 ? (
            <EmptyState icon="🏷️" title="No categories found" description="Add your first category to group menu items" action={<Button size="sm" onClick={() => { setSelectedCategory(null); setCategoryModal('create'); }}>+ Add Category</Button>} />
          ) : (
            <div className="overflow-x-auto">
              <Table2>
                <TableHeader>
                  <TableRow>
                    <TableHead>Category Name</TableHead>
                    <TableHead>Total Items</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-[280px]">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(allCategories || []).map((cat: any) => (
                    <TableRow key={cat._id}>
                      <TableCell className="font-semibold">{cat.name}</TableCell>
                      <TableCell className="font-medium text-sm text-muted-foreground">{cat.totalItems ?? 0}</TableCell>
                      <TableCell>
                        <Badge variant={cat.status === 'Active' ? 'success' : 'danger'}>
                          {cat.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-2">
                          <Button size="sm" variant="outline" onClick={() => { setSelectedCategory(cat); setCategoryModal('edit'); }}>
                            Edit
                          </Button>
                          {cat.status === 'Active' ? (
                            <Button size="sm" variant="outline" className="text-amber-400 hover:bg-amber-500/10 border-amber-500/20"
                              onClick={() => toggleCategoryStatusMutation.mutate({ id: cat._id, status: 'Inactive' })}
                              loading={toggleCategoryStatusMutation.isPending}
                            >
                              Deactivate
                            </Button>
                          ) : (
                            <Button size="sm" variant="outline" className="text-emerald-400 hover:bg-emerald-500/10 border-emerald-500/20"
                              onClick={() => toggleCategoryStatusMutation.mutate({ id: cat._id, status: 'Active' })}
                              loading={toggleCategoryStatusMutation.isPending}
                            >
                              Activate
                            </Button>
                          )}
                          <Button size="sm" variant="ghost" className="text-red-400 hover:bg-red-500/10"
                            onClick={() => handleDeleteCategory(cat)}
                            loading={deleteCategoryMutation.isPending}
                          >
                            ✕
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table2>
            </div>
          )}
        </Card>
      )}

      {/* Item Modal (Create & Edit) */}
      <Modal open={modal === 'create'} onClose={() => setModal(null)} title={selected ? 'Edit Menu Item' : 'Add Menu Item'} size="md">
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label>Item Name *</Label><Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} /></div>
            <div className="space-y-1.5">
              <Label>Category *</Label>
              <Select value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}>
                <option value="">Select category</option>
                {(activeCategories || []).map((c: any) => <option key={c._id} value={c._id}>{c.name}</option>)}
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Link to Inventory Item (Optional)</Label>
            <Select value={form.inventoryItem} onChange={(e) => setForm((f) => ({ ...f, inventoryItem: e.target.value }))}>
              <option value="">No inventory link</option>
              {(inventoryItems || []).map((item: InventoryItem) => (
                <option key={item._id} value={item._id}>
                  {item.name} ({item.currentStock || 0} {item.unit})
                </option>
              ))}
            </Select>
            <p className="text-xs text-muted-foreground">Linking to inventory will automatically track stock when this menu item is ordered.</p>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5"><Label>Price *</Label><Input type="number" step="0.01" min="0" value={form.price} onChange={(e) => setForm((f) => ({ ...f, price: Number(e.target.value) }))} /></div>
            <div className="space-y-1.5"><Label>Half Price</Label><Input type="number" step="0.01" min="0" value={form.halfPrice} onChange={(e) => setForm((f) => ({ ...f, halfPrice: e.target.value }))} /></div>
            <div className="space-y-1.5"><Label>Full Price</Label><Input type="number" step="0.01" min="0" value={form.fullPrice} onChange={(e) => setForm((f) => ({ ...f, fullPrice: e.target.value }))} /></div>
          </div>
          <div className="space-y-1.5"><Label>Description</Label><Input value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} placeholder="Optional description" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Availability</Label>
              <Select value={form.availability} onChange={(e) => setForm((f) => ({ ...f, availability: e.target.value as 'Available' | 'Unavailable' }))}>
                <option value="Available">Available</option>
                <option value="Unavailable">Unavailable</option>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as 'Active' | 'Inactive' }))}>
                <option value="Active">Active</option>
                <option value="Inactive">Inactive</option>
              </Select>
            </div>
          </div>
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
            <Button variant="outline" className="flex-1" onClick={() => setModal(null)}>Cancel</Button>
            <Button className="flex-1" loading={createMutation.isPending || updateMutation.isPending} onClick={handleSaveItem}>
              {selected ? 'Save Changes' : 'Add Item'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Category Modal (Create & Edit) */}
      <Modal open={categoryModal !== null} onClose={() => setCategoryModal(null)} title={selectedCategory ? 'Edit Category' : 'Add Category'} size="sm">
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Category Name *</Label>
            <Input value={categoryForm.name} onChange={(e) => setCategoryForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. Table" />
          </div>
          <div className="space-y-1.5">
            <Label>Category Status *</Label>
            <Select value={categoryForm.status} onChange={(e) => setCategoryForm((f) => ({ ...f, status: e.target.value as 'Active' | 'Inactive' }))}>
              <option value="Active">Active</option>
              <option value="Inactive">Inactive</option>
            </Select>
          </div>
          <div className="flex gap-2 pt-2">
            <Button variant="outline" className="flex-1" onClick={() => setCategoryModal(null)}>Cancel</Button>
            <Button className="flex-1" loading={saveCategoryMutation.isPending} onClick={handleSaveCategory}>
              Save
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
