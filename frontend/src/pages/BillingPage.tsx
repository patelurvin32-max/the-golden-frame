import { useState, useMemo, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { billingService, menuService } from '@/services';
import { useAppStore } from '@/store';
import type { Bill, MenuCategoryDoc, MenuItem, SessionItem } from '@/types';
import {
  Button, Card, Badge, PageHeader, Input, Label, Select, Modal,
  Skeleton, EmptyState, Table2, TableHeader, TableBody, TableRow,
  TableHead, TableCell, useToast
} from '@/components/ui';
import { formatCurrency, formatDateTime, downloadBlob, cn } from '@/utils';
import PaymentForm, { PaymentFormValues } from '@/components/PaymentForm';

// ── Main Billing Page ─────────────────────────────────────────────────────────
export default function BillingPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const { selectedBranch } = useAppStore();

  const [statusFilter, setStatusFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(25);
  const [search, setSearch] = useState('');

  // Edit Modal state
  const [selectedBill, setSelectedBill] = useState<Bill | null>(null);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editItems, setEditItems] = useState<SessionItem[]>([]);
  const [notes, setNotes] = useState('');

  const emptyPaymentValues: PaymentFormValues = {
    paymentStatus: 'paid',
    paymentMethod: 'cash',
    cashAmount: '',
    onlineAmount: '',
    walletAmount: '',
    amountReceived: '',
    pendingPaymentAmount: '0',
    billAmount: '0',
    addToWallet: false,
    extraAmount: '0',
    walletBalance: 0,
  };

  const [paymentValues, setPaymentValues] = useState<PaymentFormValues>(emptyPaymentValues);

  // New item selection state inside Edit Modal
  const [newItemCatId, setNewItemCatId] = useState('');
  const [newItemId, setNewItemId] = useState('');
  const [newItemQty, setNewItemQty] = useState(1);

  // ── Queries ──────────────────────────────────────────────────────────────────
  const params: Record<string, string> = {};
  if (selectedBranch) params.branch = selectedBranch;
  if (statusFilter !== 'all') params.status = statusFilter;
  if (search) params.search = search;
  params.page = String(page);
  params.limit = String(rowsPerPage);

  const { data, isLoading } = useQuery({
    queryKey: ['bills', selectedBranch, statusFilter, page, rowsPerPage, search],
    queryFn: () => billingService.getAll(params).then((r) => r.data),
    refetchOnWindowFocus: false,
    refetchOnMount: 'always',
    staleTime: 0,
    gcTime: 0,
  });

  const bills: Bill[] = (data as any)?.data?.bills || [];
  const total: number = (data as any)?.total || 0;
  const totalPages: number = (data as any)?.totalPages || 1;
  const hasNextPage: boolean = (data as any)?.hasNextPage || false;
  const hasPreviousPage: boolean = (data as any)?.hasPreviousPage || false;

  // Categories query for adding beverages/accessories
  const { data: categoriesData } = useQuery({
    queryKey: ['menu-categories'],
    queryFn: () => menuService.getCategories({ activeOnly: 'true' }).then((r) => r.data),
    staleTime: 10 * 60 * 1000,
  });

  const categories: MenuCategoryDoc[] = Array.isArray((categoriesData as any)?.data?.categories)
    ? (categoriesData as any).data.categories
    : [];

  const allowedEditCategories = useMemo(() => {
    const allowedNames = ['beverage', 'beverages', 'accessory', 'accessories'];
    return categories.filter((cat) => allowedNames.includes(cat.name?.toLowerCase().trim()));
  }, [categories]);

  const branchToFetch = selectedBranch || '';

  const { data: menuItemsData, isFetching: isMenuItemsLoading } = useQuery({
    queryKey: ['edit-bill-menu-items', newItemCatId, branchToFetch],
    queryFn: () => menuService.getAll({ category: newItemCatId, branch: branchToFetch, limit: '1000' }).then((r) => r.data),
    enabled: !!newItemCatId && editModalOpen,
  });

  const availableMenuItems: MenuItem[] = Array.isArray((menuItemsData as any)?.data?.items)
    ? (menuItemsData as any).data.items
    : [];

  const payStatusColor: Record<string, string> = {
    paid: 'success',
    unpaid: 'danger',
    partial: 'warning',
  };

  // Open Edit Modal for selected Bill
  const handleOpenEditModal = (bill: Bill) => {
    setSelectedBill(bill);

    // Extract session/inventory items
    const session = bill.session as any;
    let initialItems: SessionItem[] = [];

    if (session?.addedItems && Array.isArray(session.addedItems) && session.addedItems.length > 0) {
      initialItems = session.addedItems.map((item: any) => ({
        menuCategoryId: item.menuCategoryId?._id || item.menuCategoryId || '',
        menuItemId: item.menuItemId?._id || item.menuItemId || '',
        categoryName: item.categoryName || 'Item',
        itemName: item.itemName || 'Item',
        quantity: item.quantity || 1,
        unitPrice: item.unitPrice || 0,
        totalAmount: item.totalAmount || (item.quantity * item.unitPrice) || 0,
      }));
    } else if (bill.items && Array.isArray(bill.items)) {
      initialItems = bill.items
        .filter((i) => i.type === 'inventory')
        .map((i) => ({
          menuCategoryId: '',
          menuItemId: (i as any).menuItem || (i as any).inventoryItem || '',
          categoryName: i.description?.includes('-') ? i.description.split('-')[0].trim() : 'Item',
          itemName: i.description?.includes('-') ? i.description.split('-')[1].trim() : i.description,
          quantity: i.quantity || 1,
          unitPrice: i.unitPrice || 0,
          totalAmount: i.total || (i.quantity * i.unitPrice) || 0,
        }));
    }

    setEditItems(initialItems);
    setNewItemCatId('');
    setNewItemId('');
    setNewItemQty(1);
    setNotes('');

    setPaymentValues({
      paymentStatus: (bill.paymentStatus as any) || 'paid',
      paymentMethod: bill.paymentStatus === 'unpaid' ? null : 'cash',
      cashAmount: '',
      onlineAmount: '',
      walletAmount: '',
      amountReceived: '',
      pendingPaymentAmount: '0',
      billAmount: String(bill.total || 0),
      addToWallet: false,
      extraAmount: '0',
      walletBalance: (bill.customer as any)?.walletBalance || 0,
    });

    setEditModalOpen(true);
  };

  // Calculate base Game Amount (table session cost)
  const gameAmount = useMemo(() => {
    if (!selectedBill) return 0;
    const tableItem = (selectedBill.items || []).find((i) => i.type === 'table_time');
    if (tableItem) return tableItem.total;

    // Fallback: total minus inventory items
    const inventoryItemsTotal = (selectedBill.items || [])
      .filter((i) => i.type === 'inventory')
      .reduce((sum, item) => sum + item.total, 0);
    return Math.max(0, (selectedBill.subtotal || selectedBill.total || 0) - inventoryItemsTotal);
  }, [selectedBill]);

  // Subtotal of added beverages & accessories
  const addedItemsSubtotal = useMemo(() => {
    return editItems.reduce((sum, item) => sum + (item.totalAmount || 0), 0);
  }, [editItems]);

  // Recalculated Grand Total
  const computedGrandTotal = useMemo(() => {
    return gameAmount + addedItemsSubtotal;
  }, [gameAmount, addedItemsSubtotal]);

  // Keep paymentValues billAmount in sync with computedGrandTotal
  useEffect(() => {
    setPaymentValues((prev) => ({
      ...prev,
      billAmount: String(computedGrandTotal),
    }));
  }, [computedGrandTotal]);

  // Item modifications in modal
  const handleAddItem = () => {
    if (!newItemCatId || !newItemId) {
      toast.error('Please select both Menu Category and Menu Item');
      return;
    }
    const catDoc = categories.find((c) => c._id === newItemCatId);
    const itemDoc = availableMenuItems.find((i) => i._id === newItemId);
    if (!itemDoc) return;

    const categoryName = catDoc?.name || 'Item';
    const itemName = itemDoc.name;
    const unitPrice = itemDoc.price || 0;
    const qty = Math.max(1, Number(newItemQty) || 1);

    setEditItems((prev) => {
      const existingIndex = prev.findIndex(
        (i) => (i.menuItemId && i.menuItemId === newItemId) || i.itemName.toLowerCase() === itemName.toLowerCase()
      );
      if (existingIndex > -1) {
        const copy = [...prev];
        const updatedQty = copy[existingIndex].quantity + qty;
        copy[existingIndex] = {
          ...copy[existingIndex],
          quantity: updatedQty,
          totalAmount: updatedQty * unitPrice,
        };
        return copy;
      } else {
        return [
          ...prev,
          {
            menuCategoryId: newItemCatId,
            menuItemId: newItemId,
            categoryName,
            itemName,
            quantity: qty,
            unitPrice,
            totalAmount: qty * unitPrice,
          },
        ];
      }
    });

    setNewItemId('');
    setNewItemQty(1);
    toast.success(`Added ${itemName}`);
  };

  const handleRemoveItem = (index: number) => {
    setEditItems((prev) => prev.filter((_, i) => i !== index));
  };

  const handleUpdateQuantity = (index: number, delta: number) => {
    setEditItems((prev) => {
      const copy = [...prev];
      const newQty = Math.max(1, copy[index].quantity + delta);
      copy[index] = {
        ...copy[index],
        quantity: newQty,
        totalAmount: newQty * copy[index].unitPrice,
      };
      return copy;
    });
  };

  // Update Bill Mutation
  const updateBillMutation = useMutation({
    mutationFn: (data: { id: string; payload: any }) => billingService.update(data.id, data.payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bills'] });
      toast.success('Bill updated successfully!');
      setEditModalOpen(false);
      setSelectedBill(null);
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed to update bill'),
  });

  const handleSaveBill = () => {
    if (!selectedBill) return;

    if (paymentValues.paymentStatus !== 'unpaid' && !paymentValues.paymentMethod) {
      toast.error('Payment Method is required when payment status is Paid or Partial');
      return;
    }

    const tableItem = (selectedBill.items || []).find((i) => i.type === 'table_time') || {
      description: 'Table Session Time',
      quantity: 1,
      unitPrice: gameAmount,
      total: gameAmount,
      type: 'table_time',
    };

    const updatedBillItems = [
      tableItem,
      ...editItems.map((item) => ({
        description: `${item.categoryName} - ${item.itemName}`,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        total: item.totalAmount,
        type: 'inventory',
        menuItem: item.menuItemId,
      })),
    ];

    const payload = {
      items: updatedBillItems,
      subtotal: computedGrandTotal,
      total: computedGrandTotal,
      paymentStatus: paymentValues.paymentStatus,
      addedItems: editItems,
    };

    updateBillMutation.mutate({ id: selectedBill._id, payload });
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
      <PageHeader title="Billing" />

      {/* Search and Page Length */}
      <div className="flex gap-3">
        <Input
          placeholder="Search by invoice # or customer name..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          className="max-w-xs"
        />
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Rows per page:</span>
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
      </div>

      {/* Status filters */}
      <div className="flex gap-2 flex-wrap">
        {['all', 'paid', 'unpaid', 'partial'].map((s) => (
          <button
            key={s}
            onClick={() => { setStatusFilter(s); setPage(1); }}
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
            description="Stop a table session to generate a bill"
          />
        ) : (
          <Table2>
            <TableHeader>
              <TableRow>
                <TableHead>Invoice #</TableHead>
                <TableHead>Customer Name</TableHead>
                <TableHead>Date & Time</TableHead>
                <TableHead>Total Amount</TableHead>
                <TableHead>Payment Status</TableHead>
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
                    {bill.customer?.name || (bill.session as any)?.customerName || (
                      <span className="text-muted-foreground italic">
                        Walk-in
                      </span>
                    )}
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
                    <div className="flex gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleDownloadPDF(bill)}
                      >
                        Invoice
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleOpenEditModal(bill)}
                      >
                        Edit
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table2>
        )}

        {/* Pagination */}
        {total > 0 && (
          <div className="flex items-center justify-between p-4 border-t border-border">
            <span className="text-sm text-muted-foreground">
              Showing {(page - 1) * rowsPerPage + 1}–{Math.min(page * rowsPerPage, total)} of {total} records
            </span>
            {totalPages > 1 && (
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" disabled={!hasPreviousPage} onClick={() => setPage((p) => p - 1)}>Previous</Button>
                <span className="text-sm text-muted-foreground">Page {page} of {totalPages}</span>
                <Button size="sm" variant="outline" disabled={!hasNextPage} onClick={() => setPage((p) => p + 1)}>Next</Button>
              </div>
            )}
          </div>
        )}
      </Card>

      {/* Edit Billing Modal */}
      <Modal open={editModalOpen} onClose={() => setEditModalOpen(false)} title={`Edit Billing — ${selectedBill?.invoiceNumber}`} size="lg">
        <div className="space-y-4">
          {/* Read-Only Summary Header */}
          <div className="p-3 rounded-xl bg-blue-500/10 border border-blue-500/20 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <div>
              <span className="text-muted-foreground block">Invoice Number</span>
              <strong className="text-foreground font-mono font-semibold">{selectedBill?.invoiceNumber}</strong>
            </div>
            <div>
              <span className="text-muted-foreground block">Customer Name</span>
              <strong className="text-foreground font-semibold">
                {selectedBill?.customer?.name || (selectedBill?.session as any)?.customerName || 'Walk-in'}
              </strong>
            </div>
            <div>
              <span className="text-muted-foreground block">Table / Item</span>
              <strong className="text-foreground font-semibold">
                {(selectedBill?.session as any)?.table?.name ? `${(selectedBill?.session as any).table.name} (${(selectedBill?.session as any).table.type})` : 'N/A'}
              </strong>
            </div>
            <div>
              <span className="text-muted-foreground block">Session Duration</span>
              <strong className="text-foreground font-mono">
                {(selectedBill?.session as any)?.billableMinutes ? `${(selectedBill?.session as any).billableMinutes} min` : 'N/A'}
              </strong>
            </div>
          </div>

          {/* Session Items Section */}
          <div className="p-3.5 rounded-xl bg-card border border-border space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Session Items</h4>
              <span className="text-xs font-semibold text-emerald-400">
                Items Subtotal: {formatCurrency(addedItemsSubtotal)}
              </span>
            </div>

            {/* Display session items */}
            {editItems.length === 0 ? (
              <p className="text-xs text-muted-foreground italic p-3 text-center bg-muted/20 rounded-xl">
                No additional beverage or accessory items were added during this session.
              </p>
            ) : (
              <div className="overflow-x-auto border border-border rounded-xl">
                <Table2>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Menu Category</TableHead>
                      <TableHead>Menu Item</TableHead>
                      <TableHead className="text-center">Quantity</TableHead>
                      <TableHead>Unit Price</TableHead>
                      <TableHead>Total Price</TableHead>
                      <TableHead className="w-[60px]"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {editItems.map((item, idx) => (
                      <TableRow key={idx}>
                        <TableCell className="text-xs font-semibold text-primary">{item.categoryName}</TableCell>
                        <TableCell className="text-xs font-medium">{item.itemName}</TableCell>
                        <TableCell>
                          <div className="flex items-center justify-center gap-1.5">
                            <Button size="sm" variant="outline" className="h-6 w-6 p-0 text-xs" onClick={() => handleUpdateQuantity(idx, -1)}>-</Button>
                            <span className="text-xs font-mono font-bold w-6 text-center">{item.quantity}</span>
                            <Button size="sm" variant="outline" className="h-6 w-6 p-0 text-xs" onClick={() => handleUpdateQuantity(idx, 1)}>+</Button>
                          </div>
                        </TableCell>
                        <TableCell className="text-xs font-mono">{formatCurrency(item.unitPrice)}</TableCell>
                        <TableCell className="text-xs font-mono font-bold text-foreground">{formatCurrency(item.totalAmount)}</TableCell>
                        <TableCell>
                          <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-red-400 hover:bg-red-500/10" onClick={() => handleRemoveItem(idx)}>
                            ✕
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table2>
              </div>
            )}

            {/* Add New Item Controls */}
            <div className="pt-2 border-t border-border space-y-2">
              <span className="text-xs font-semibold text-muted-foreground block">Add Beverage or Accessory Item:</span>
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
                <Select
                  value={newItemCatId}
                  onChange={(e) => { setNewItemCatId(e.target.value); setNewItemId(''); }}
                >
                  <option value="">Select Category</option>
                  {allowedEditCategories.map((cat) => (
                    <option key={cat._id} value={cat._id}>{cat.name}</option>
                  ))}
                </Select>

                <Select
                  value={newItemId}
                  onChange={(e) => setNewItemId(e.target.value)}
                  disabled={!newItemCatId || isMenuItemsLoading}
                >
                  <option value="">{isMenuItemsLoading ? 'Loading items...' : 'Select Menu Item'}</option>
                  {availableMenuItems.map((item) => (
                    <option key={item._id} value={item._id}>
                      {item.name} ({formatCurrency(item.price || 0)})
                    </option>
                  ))}
                </Select>

                <Input
                  type="number"
                  min="1"
                  value={newItemQty}
                  onChange={(e) => setNewItemQty(Number(e.target.value))}
                  placeholder="Qty"
                />

                <Button size="sm" onClick={handleAddItem} disabled={!newItemCatId || !newItemId}>
                  + Add Item
                </Button>
              </div>
            </div>
          </div>

          {/* Bill Calculation Breakdown */}
          <div className="p-3 rounded-xl bg-primary/10 border border-primary/20 space-y-1 text-xs">
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">Game Amount</span>
              <span className="font-semibold">{formatCurrency(gameAmount)}</span>
            </div>
            {addedItemsSubtotal > 0 && (
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">Session Items Subtotal</span>
                <span className="font-semibold text-emerald-400">{formatCurrency(addedItemsSubtotal)}</span>
              </div>
            )}
            <div className="flex justify-between items-center pt-1.5 border-t border-primary/20 text-sm font-bold">
              <span>Final Total Bill Amount</span>
              <span className="text-primary font-mono text-base">{formatCurrency(computedGrandTotal)}</span>
            </div>
          </div>

          {/* Reused PaymentForm Component */}
          <PaymentForm
            values={paymentValues}
            onChange={(vals) => setPaymentValues((prev) => ({ ...prev, ...vals }))}
            showBillAmountField={true}
            readOnlyBillAmount={false}
          />

          {/* Notes Input */}
          <div className="space-y-1.5">
            <Label>Notes</Label>
            <Input
              placeholder="Enter notes (optional)"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          {/* Action Buttons */}
          <div className="flex gap-2 pt-2">
            <Button variant="outline" className="flex-1" onClick={() => setEditModalOpen(false)}>
              Cancel
            </Button>
            <Button className="flex-1" loading={updateBillMutation.isPending} onClick={handleSaveBill}>
              Save Changes
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
