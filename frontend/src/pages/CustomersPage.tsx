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
import PaymentForm, { PaymentFormValues } from '@/components/PaymentForm';
import { formatCurrency, formatDate, parseCurrencyValue, cn, downloadBlob } from '@/utils';
import { Plus, Minus, Trash2, ShoppingCart, Utensils, Gamepad2, Tag, X } from 'lucide-react';

export interface CartItem {
  menuCategoryId: string;
  categoryName: string;
  menuItemId: string;
  itemName: string;
  quantity: number;
  unitPrice: number;
  totalAmount: number;
}

const TIERS: Record<string, { color: string; icon: string }> = {
  silver: { color: 'bg-slate-500/10 text-slate-300 border-slate-500/20', icon: '🥈' },
  gold: { color: 'bg-amber-500/10 text-amber-400 border-amber-500/20', icon: '🥇' },
  platinum: { color: 'bg-purple-500/10 text-purple-400 border-purple-500/20', icon: '💎' },
};

const emptyForm: PaymentFormValues & {
  customerId: string;
  name: string;
  phone: string;
  email: string;
  address: string;
  branch: string;
  notes: string;
  menuCategoryId: string;
  menuItemId: string;
  startTime: string;
  endTime: string;
  numberOfPlayers: string;
  additionalPlayers: string;
} = {
  customerId: '',
  name: '',
  phone: '',
  email: '',
  address: '',
  branch: '',
  notes: '',
  menuCategoryId: '',
  menuItemId: '',
  startTime: '',
  endTime: '',
  paymentStatus: 'paid',
  paymentMethod: '',
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

import { useDebounce } from '@/hooks/useDebounce';

export default function CustomersPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const { selectedBranch } = useAppStore();
  const { user } = useAuthStore();
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 300);
  const [page, setPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(25);
  const [modal, setModal] = useState<'create' | 'edit' | null>(null);
  const [selected, setSelected] = useState<Customer | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [deleteConfirm, setDeleteConfirm] = useState<Customer | null>(null);
  const [isLookingUp, setIsLookingUp] = useState(false);
  const [phoneError, setPhoneError] = useState('');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [cartCategoryId, setCartCategoryId] = useState<string>('');
  const [cartItemId, setCartItemId] = useState<string>('');
  const [validationError, setValidationError] = useState<{ field: string; message: string } | null>(null);

  const handleAddToCart = (item: MenuItem, categoryName: string) => {
    const price = item.price || item.fullPrice || 0;
    const catId = typeof item.category === 'object' && item.category !== null
      ? (item.category as any)._id
      : (item.category as string);

    setCart((prev) => {
      const idx = prev.findIndex((c) => c.menuItemId === item._id);
      if (idx > -1) {
        const updated = [...prev];
        const newQty = updated[idx].quantity + 1;
        updated[idx] = {
          ...updated[idx],
          quantity: newQty,
          totalAmount: newQty * price,
        };
        return updated;
      } else {
        return [
          ...prev,
          {
            menuCategoryId: catId || '',
            categoryName: categoryName || 'Menu',
            menuItemId: item._id,
            itemName: item.name,
            quantity: 1,
            unitPrice: price,
            totalAmount: price,
          },
        ];
      }
    });
  };

  const handleRemoveFromCart = (menuItemId: string) => {
    setCart((prev) => {
      const idx = prev.findIndex((c) => c.menuItemId === menuItemId);
      if (idx === -1) return prev;
      const existing = prev[idx];
      if (existing.quantity > 1) {
        const updated = [...prev];
        const newQty = existing.quantity - 1;
        updated[idx] = {
          ...existing,
          quantity: newQty,
          totalAmount: newQty * existing.unitPrice,
        };
        return updated;
      } else {
        return prev.filter((c) => c.menuItemId !== menuItemId);
      }
    });
  };

  const handleDeleteFromCart = (menuItemId: string) => {
    setCart((prev) => prev.filter((c) => c.menuItemId !== menuItemId));
  };

  const cartSubtotal = useMemo(() => {
    return cart.reduce((sum, item) => sum + (item.totalAmount || 0), 0);
  }, [cart]);

  const userAssignedBranchId = user?.branches?.[0] ? (typeof user.branches[0] === 'string' ? user.branches[0] : (user.branches[0] as any)._id) : '';
  const effectiveBranch = selectedBranch || (user?.role !== 'super_admin' ? userAssignedBranchId : '');
  const params: Record<string, string> = { page: String(page), limit: String(rowsPerPage) };
  if (effectiveBranch) params.branch = effectiveBranch;
  if (debouncedSearch) params.search = debouncedSearch;

  const { data, isLoading } = useQuery({
    queryKey: ['customers', effectiveBranch, debouncedSearch, page, rowsPerPage],
    queryFn: () => customerService.getAll(params).then((r) => r.data),
    staleTime: 30_000,
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

  // Fetch customer statistics for Super Admin and Branch Admin
  const { data: statsData } = useQuery({
    queryKey: ['customer-stats', effectiveBranch],
    queryFn: () => customerService.getStats(effectiveBranch ? { branch: effectiveBranch } : undefined).then((r) => r.data),
    enabled: user?.role === 'super_admin' || user?.role === 'branch_admin',
    staleTime: 60_000,
  });

  const stats = (statsData as any)?.data || { today: 0, week: 0, month: 0, total: 0 };

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

  // Only fetch menu items when create or edit modal is open
  const { data: allMenuItemsData, isFetching: isFetchingAllMenuItems } = useQuery({
    queryKey: ['all-menu-items', branchToFetch],
    queryFn: () => menuService.getAll({ limit: '1000', branch: branchToFetch, activeOnly: 'true' }).then((r) => r.data),
    enabled: modal !== null,
    staleTime: 10 * 60 * 1000, // Cache for 10 minutes
    gcTime: 15 * 60 * 1000, // Keep in cache for 15 minutes
  });

  const cartAllowedCategories = useMemo(() => {
    return categories.filter((cat) => {
      const name = (cat.name || '').trim().toLowerCase();
      return name === 'beverages' || name === 'beverage' || name === 'accessories' || name === 'accessory';
    });
  }, [categories]);

  const cartAllowedItems = useMemo(() => {
    if (!cartCategoryId) return [];
    const allItems: MenuItem[] = Array.isArray((allMenuItemsData as any)?.data?.items)
      ? (allMenuItemsData as any).data.items
      : [];

    return allItems.filter((item: any) => {
      if (item.status === 'Inactive') return false;
      const catId = typeof item.category === 'object' && item.category !== null
        ? item.category._id
        : item.category;
      return String(catId) === String(cartCategoryId);
    });
  }, [allMenuItemsData, cartCategoryId]);

  // Fetch menu items filtered by category and branch
  const menuParams: Record<string, string> = { limit: '1000', activeOnly: 'true' };
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
        setModal(null);
        setForm(emptyForm);
      } else {
        // New customer was created
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

  // Generic Customer lookup by term (Customer ID or Mobile Number)
  const lookupCustomerByTerm = async (term: string, isPhone: boolean) => {
    setIsLookingUp(true);
    try {
      const targetBranch = form.branch || selectedBranch || undefined;
      const response = await customerService.lookup(term, targetBranch);
      const customer = response.data.data.customer;
      if (customer) {
        setForm((f) => ({
          ...f,
          customerId: customer.customerId || f.customerId,
          name: customer.name || f.name,
          phone: customer.phone || f.phone,
          email: customer.email || f.email,
          address: customer.address || f.address,
          notes: customer.notes || f.notes,
          walletBalance: customer.walletBalance || 0,
        }));
        toast.success('Customer profile found! Details loaded.');
      } else {
        if (isPhone) {
          setForm((f) => ({ ...f, customerId: '', walletBalance: 0 }));
        } else {
          setForm((f) => ({ ...f, walletBalance: 0 }));
        }
      }
    } catch (error) {
      setForm((f) => ({ ...f, walletBalance: 0 }));
    } finally {
      setIsLookingUp(false);
    }
  };

  const handleCustomerIdChange = (val: string) => {
    const term = val.trim().toUpperCase();
    setForm((f) => ({ ...f, customerId: term }));
    if (/^[A-Za-z]{2,3}[0-9]{5}$/.test(term)) {
      lookupCustomerByTerm(term, false);
    }
  };

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
      lookupCustomerByTerm(numericPhone, true);
    } else {
      setForm((f) => ({ ...f, customerId: '', walletBalance: 0 }));
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
    // Resolve the branch to use for this customer record.
    // For super_admin / admin: use form.branch (they pick from dropdown).
    // For branch managers / staff: ALWAYS use their own assigned branch —
    // never trust selectedBranch which could be stale from an admin session.
    let branch: string;
    const isAdminRole = user?.role === 'super_admin' || user?.role === 'admin';

    if (isAdminRole) {
      branch = form.branch || selectedBranch || '';
    } else {
      // Branch manager / staff — use their assigned branch
      const b0 = user?.branches?.[0];
      branch = (typeof b0 === 'string' ? b0 : (b0 as any)?._id?.toString()) || selectedBranch || '';
    }

    // Validation
    setValidationError(null);

    if (isAdminRole && !branch) {
      setValidationError({ field: 'branch', message: 'Branch is required' });
      toast.error('Branch is required'); return;
    }
    if (!branch) {
      toast.error('Unable to determine your branch. Please contact an administrator.'); return;
    }
    if (!form.name.trim()) {
      setValidationError({ field: 'name', message: 'Full Name is required' });
      toast.error('Full Name is required'); return;
    }
    if (!form.phone.trim()) {
      setValidationError({ field: 'phone', message: 'Phone Number is required' });
      toast.error('Phone Number is required'); return;
    }
    if (form.phone.length > 0 && form.phone.length < 10) {
      setValidationError({ field: 'phone', message: 'Mobile number must contain exactly 10 digits.' });
      toast.error('Mobile number must contain exactly 10 digits.'); return;
    }
    if (!form.menuCategoryId) {
      setValidationError({ field: 'menuCategoryId', message: 'Playing Category is required' });
      toast.error('Playing Category is required'); return;
    }
    const isExtraCategory = categories.find(c => c._id === form.menuCategoryId)?.name?.toLowerCase() === 'extra';

    if (!isExtraCategory && !form.menuItemId) {
      setValidationError({ field: 'menuItemId', message: 'Playing Item is required' });
      toast.error('Playing Item is required'); return;
    }
    // Only require Start Time for session-based categories (not Accessories or Beverages or Extra)
    if (!isExtraCategory && !isProductCategory && !form.startTime) {
      setValidationError({ field: 'startTime', message: 'Start Time is required' });
      toast.error('Start Time is required'); return;
    }
    if (!isExtraCategory && !form.billAmount) {
      setValidationError({ field: 'billAmount', message: 'Total Amount is required' });
      toast.error('Total Amount is required'); return;
    }
    if (!form.paymentStatus) {
      setValidationError({ field: 'paymentStatus', message: 'Payment Status is required' });
      toast.error('Payment Status is required'); return;
    }
    if ((form.paymentStatus === 'paid' || form.paymentStatus === 'partial') && !form.paymentMethod) {
      setValidationError({ field: 'paymentMethod', message: 'Payment Method is required' });
      toast.error('Payment Method is required');
      return;
    }

    const billAmount = parseCurrencyValue(form.billAmount) + (cart.length > 0 ? cartSubtotal : 0);
    
    if (Number.isNaN(billAmount)) {
      toast.error('Total Amount must be a valid number with up to two decimals');
      return;
    }

    let cashAmount = parseCurrencyValue(form.cashAmount) || 0;
    let onlineAmount = parseCurrencyValue(form.onlineAmount) || 0;
    let walletAmount = parseCurrencyValue(form.walletAmount) || 0;
    const amountReceived = parseCurrencyValue(form.amountReceived) || 0;
    
    // For simple payment methods (cash, upi), override individual amounts with amountReceived
    // This ensures that when editing an entry (where cashAmount might not be 0), 
    // the newly entered amountReceived properly overrides it.
    if (form.paymentMethod === 'cash') {
      cashAmount = amountReceived > 0 ? amountReceived : cashAmount;
      onlineAmount = 0;
      walletAmount = 0;
    } else if (form.paymentMethod === 'upi') {
      onlineAmount = amountReceived > 0 ? amountReceived : onlineAmount;
      cashAmount = 0;
      walletAmount = 0;
    }
    
    // Calculate total paid from individual payment methods
    let totalPaid = cashAmount + onlineAmount + walletAmount;
    
    // Round values to avoid floating-point precision issues
    const roundedBillAmount = Math.round(billAmount * 100) / 100;
    const roundedTotalPaid = Math.round(totalPaid * 100) / 100;
    
    // Calculate pending amount
    const pendingAmount = Math.max(0, roundedBillAmount - roundedTotalPaid);
    
    // Validation based on payment status
    if (form.paymentStatus === 'paid') {
      const hasPendingPlayers = Array.isArray(form.pendingPlayers) && form.pendingPlayers.length > 0;
      const pendingPlayersTotal = hasPendingPlayers
        ? (form.pendingPlayers || []).reduce((sum: number, p: any) => sum + (parseCurrencyValue(p.amount) || 0), 0)
        : 0;

      if (hasPendingPlayers) {
        const totalAllocated = roundedTotalPaid + pendingPlayersTotal;
        if (Math.abs(totalAllocated - roundedBillAmount) > 0.01) {
          if (totalAllocated > roundedBillAmount) {
            toast.error(`Over-allocated Amount: ${formatCurrency(totalAllocated - roundedBillAmount)}\nTotal Allocated (${formatCurrency(totalAllocated)}) must equal Total Bill Amount (${formatCurrency(roundedBillAmount)}).`);
          } else {
            toast.error(`Remaining Amount: ${formatCurrency(roundedBillAmount - totalAllocated)}\nTotal Allocated (${formatCurrency(totalAllocated)}) must equal Total Bill Amount (${formatCurrency(roundedBillAmount)}).`);
          }
          return;
        }
      } else {
        // For paid status, total paid must be >= bill amount
        if (roundedTotalPaid < roundedBillAmount) {
          toast.error(`For Paid status, Amount Received must be greater than or equal to the Bill Amount (${formatCurrency(roundedBillAmount)})`);
          return;
        }
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

    // Validate Pending Players if provided
    if (form.pendingPlayers && form.pendingPlayers.length > 0) {
      for (let i = 0; i < form.pendingPlayers.length; i++) {
        const p = form.pendingPlayers[i];
        if (!p.mobile || p.mobile.length !== 10) {
          toast.error(`Player ${i + 1}: Mobile number must be exactly 10 digits`);
          return;
        }
        if (!p.amount || Number(p.amount) <= 0) {
          toast.error(`Player ${i + 1}: Pending amount must be greater than 0`);
          return;
        }
      }
      const mobSet = new Set<string>();
      for (const p of form.pendingPlayers) {
        if (mobSet.has(p.mobile)) {
          toast.error(`Duplicate mobile number found in pending players: ${p.mobile}`);
          return;
        }
        mobSet.add(p.mobile);
      }

      const sumPending = (form.pendingPlayers || []).reduce((s, p) => s + (Number(p.amount) || 0), 0);
      const totalAllocated = Math.round((amountReceived + walletAmount + sumPending) * 100) / 100;
      if (Math.abs(totalAllocated - roundedBillAmount) > 0.01) {
        const remaining = Math.round((roundedBillAmount - totalAllocated) * 100) / 100;
        if (remaining > 0) {
          toast.error(`Remaining Amount: ${formatCurrency(remaining)}. Total Allocated (${formatCurrency(totalAllocated)}) must equal Bill Amount (${formatCurrency(roundedBillAmount)})`);
        } else {
          toast.error(`Over-allocated Amount: ${formatCurrency(totalAllocated - roundedBillAmount)}. Total Allocated (${formatCurrency(totalAllocated)}) must equal Bill Amount (${formatCurrency(roundedBillAmount)})`);
        }
        return;
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

    const paymentMethodToSave = (form.paymentStatus === 'unpaid' && !form.paymentMethod) ? null : form.paymentMethod;

    const payload = {
      ...form,
      addedItems: cart,
      branch,
      billAmount,
      paymentMethod: paymentMethodToSave,
      amountReceived: (form.amountReceived !== '' && form.amountReceived !== undefined)
        ? parseCurrencyValue(form.amountReceived)
        : totalPaid,
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
    setCart([]);
    setCartCategoryId('');
    setCartItemId('');
    setValidationError(null);
    setModal('create');
  };

  const formatForDateTimeInput = (dateVal: any) => {
    if (!dateVal) return '';
    const d = new Date(dateVal);
    if (isNaN(d.getTime())) return '';
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day}T${hours}:${minutes}`;
  };

  const openEdit = (c: Customer) => {
    setSelected(c);

    const existingPendingPlayers = Array.isArray((c as any).pendingPlayers)
      ? (c as any).pendingPlayers.map((p: any) => ({
          id: p.id || p._id || '',
          name: p.name || p.playerName || '',
          mobile: p.mobile || p.mobileNumber || '',
          amount: String(p.amount || p.pendingAmount || ''),
        }))
      : [];
    
    const existingAddedItems = Array.isArray((c as any).addedItems) ? (c as any).addedItems : [];
    const initialCartSubtotal = existingAddedItems.reduce((sum: number, item: any) => sum + (Number(item.totalAmount) || 0), 0);
    
    setCart(existingAddedItems);
    setCartCategoryId('');
    setCartItemId('');
    setValidationError(null);

    const initialAmountReceived = ((c as any).amountReceived !== undefined && (c as any).amountReceived !== null && (c as any).amountReceived !== '')
      ? String((c as any).amountReceived)
      : (((c as any).cashAmount || (c as any).onlineAmount || (c as any).totalPaid) ? String((c as any).totalPaid || 0) : '0');

    const rawStartTime = c.startTime || (c as any).reservation?.startTime || c.createdAt;
    const rawEndTime = c.endTime || (c as any).reservation?.endTime || '';
    
    // c.billAmount is the total bill (session + cart).
    // The form's billAmount field represents the Session Bill Amount.
    const sessionBillAmount = Math.max(0, (Number((c as any).billAmount) || 0) - initialCartSubtotal);

    setForm({
      customerId: c.customerId || (c as any).customer?.customerId || '',
      name: c.name,
      phone: c.phone,
      email: c.email || '',
      address: c.address || '',
      branch: (c.branch as any)?._id || c.branch || '',
      notes: c.notes || '',
      menuCategoryId: (c.menuCategoryId as any)?._id || c.menuCategoryId || '',
      menuItemId: (c.menuItemId as any)?._id || c.menuItemId || '',
      startTime: formatForDateTimeInput(rawStartTime),
      endTime: formatForDateTimeInput(rawEndTime),
      paymentStatus: c.paymentStatus,
      paymentMethod: (c.paymentMethod as any) || '',
      cashAmount: (c as any).cashAmount ? String((c as any).cashAmount) : '',
      onlineAmount: (c as any).onlineAmount ? String((c as any).onlineAmount) : '',
      walletAmount: (c as any).walletAmount ? String((c as any).walletAmount) : '',
      amountReceived: initialAmountReceived,
      pendingPaymentAmount: (c as any).pendingPaymentAmount ? String((c as any).pendingPaymentAmount) : '',
      numberOfPlayers: c.numberOfPlayers ? String(c.numberOfPlayers) : '',
      additionalPlayers: (c as any).additionalPlayers || '',
      billAmount: String(sessionBillAmount || ''),
      addToWallet: false,
      extraAmount: '',
      walletBalance: (c as any).walletBalance || 0,
      pendingPlayers: existingPendingPlayers,
    });
    setModal('edit');

    // Fetch fresh customer data to get latest wallet balance & pending players in background
    customerService.getOne(c._id).then((res) => {
      const freshCustomer = res.data.data.customer;
      if (freshCustomer) {
        const freshAmountReceived = ((freshCustomer as any).amountReceived !== undefined && (freshCustomer as any).amountReceived !== null && (freshCustomer as any).amountReceived !== '')
          ? String((freshCustomer as any).amountReceived)
          : (((freshCustomer as any).totalPaid !== undefined) ? String((freshCustomer as any).totalPaid) : '0');

        if (Array.isArray((freshCustomer as any).pendingPlayers)) {
          const freshPendingPlayers = (freshCustomer as any).pendingPlayers.map((p: any) => ({
            id: p.id || p._id || '',
            name: p.name || p.playerName || '',
            mobile: p.mobile || p.mobileNumber || '',
            amount: String(p.amount || p.pendingAmount || ''),
          }));
          setForm((f) => ({
            ...f,
            amountReceived: freshAmountReceived,
            pendingPlayers: freshPendingPlayers,
            walletBalance: (freshCustomer as any).walletBalance || 0,
          }));
        } else {
          setForm((f) => ({
            ...f,
            amountReceived: freshAmountReceived,
            walletBalance: (freshCustomer as any).walletBalance || 0,
          }));
        }
      }
    }).catch(() => {/* ignore error */});
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
        actions={<Button size="sm" onClick={openCreate}>+ Add Customer</Button>}
      />

      {/* Statistics Cards - Only for Super Admin and Branch Admin */}
      {(user?.role === 'super_admin' || user?.role === 'branch_admin') && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card className="p-4 border-border/50 bg-gradient-to-br from-blue-500/5 to-blue-600/5 hover:from-blue-500/10 hover:to-blue-600/10 transition-all duration-300">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground font-medium">Today</p>
                <p className="text-2xl font-bold text-foreground mt-1">{stats.today}</p>
              </div>
              <div className="h-10 w-10 rounded-xl bg-blue-500/10 flex items-center justify-center text-lg">
                📅
              </div>
            </div>
          </Card>
          <Card className="p-4 border-border/50 bg-gradient-to-br from-green-500/5 to-green-600/5 hover:from-green-500/10 hover:to-green-600/10 transition-all duration-300">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground font-medium">Week</p>
                <p className="text-2xl font-bold text-foreground mt-1">{stats.week}</p>
              </div>
              <div className="h-10 w-10 rounded-xl bg-green-500/10 flex items-center justify-center text-lg">
                📊
              </div>
            </div>
          </Card>
          <Card className="p-4 border-border/50 bg-gradient-to-br from-purple-500/5 to-purple-600/5 hover:from-purple-500/10 hover:to-purple-600/10 transition-all duration-300">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground font-medium">Month</p>
                <p className="text-2xl font-bold text-foreground mt-1">{stats.month}</p>
              </div>
              <div className="h-10 w-10 rounded-xl bg-purple-500/10 flex items-center justify-center text-lg">
                📈
              </div>
            </div>
          </Card>
          <Card className="p-4 border-border/50 bg-gradient-to-br from-amber-500/5 to-amber-600/5 hover:from-amber-500/10 hover:to-amber-600/10 transition-all duration-300">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground font-medium">Total</p>
                <p className="text-2xl font-bold text-foreground mt-1">{stats.total}</p>
              </div>
              <div className="h-10 w-10 rounded-xl bg-amber-500/10 flex items-center justify-center text-lg">
                👥
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* Search */}
      <div className="flex flex-wrap gap-2 sm:gap-3">
        <Input
          placeholder="Search by name or phone..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          className="w-full sm:max-w-xs"
        />
      </div>

      <Card>
        {isLoading ? (
          <div className="p-4 space-y-3">{[...Array(6)].map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
        ) : customers.length === 0 ? (
          <EmptyState icon="👥" title="No customers found" description="Add your first customer to get started" action={<Button size="sm" onClick={openCreate}>+ Add Customer</Button>} />
        ) : (
          <>
            <div className="overflow-x-auto -mx-4 sm:mx-0 px-4 sm:px-0">
              <Table2>
              <TableHeader>
                <TableRow>
                  <TableHead>Order ID</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Item</TableHead>
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
                  const totalBillAmount = (c as any).billAmount || 0;
                  
                  return (
                    <TableRow key={c._id}>
                      <TableCell className="font-mono text-xs">{(c as any).orderId || c._id.slice(-8)}</TableCell>
                      <TableCell className="text-sm font-medium">{c.name}</TableCell>
                      <TableCell className="text-sm">{(c as any).menuCategoryId?.name || '—'}</TableCell>
                      <TableCell className="text-sm">{(c as any).menuItemId?.name || '—'}</TableCell>
                      <TableCell className="text-sm font-medium">{formatCurrency(totalBillAmount)}</TableCell>
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
            </div>

            {/* Pagination */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-4 border-t border-border">
              <div className="flex flex-wrap items-center gap-2 sm:gap-3">
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
                <div className="flex items-center gap-2 w-full sm:w-auto">
                  <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="flex-1 sm:flex-none">Previous</Button>
                  <span className="text-sm text-muted-foreground">Page {page} of {pages}</span>
                  <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => setPage((p) => p + 1)} className="flex-1 sm:flex-none">Next</Button>
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
        title={selected ? 'Edit Customer & Add Items' : 'Add New Customer Session'}
        size="lg"
      >
        <div className="space-y-4 sm:space-y-5 max-h-[75vh] sm:max-h-[80vh] overflow-y-auto px-0.5 sm:px-1">
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

          {/* ────────────────── CREATE WORKFLOW ────────────────── */}
          {modal === 'create' && (() => {
            const isExtraCategory = categories.find(c => c._id === form.menuCategoryId)?.name?.toLowerCase() === 'extra';
            return (
            <>
              <div className="space-y-3">
                {/* Top Row: Read-only Customer ID */}
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Customer ID
                  </Label>
                  <Input
                    value={form.customerId}
                    onChange={(e) => handleCustomerIdChange(e.target.value)}
                    placeholder="Enter Customer ID (e.g. TGF00001) or leave empty for auto-generation"
                    readOnly={Boolean(form.customerId && form.name)}
                    disabled={isLookingUp}
                    className={cn(
                      "font-mono text-sm font-semibold text-primary",
                      Boolean(form.customerId && form.name) && "bg-accent/40 cursor-not-allowed"
                    )}
                  />
                </div>
                {/* 1st Row: Full Name * | Phone Number * */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 sm:gap-3">
                  <div className="space-y-1.5">
                    <Label>Full Name *</Label>
                    <Input
                      value={form.name}
                      onChange={(e) => {
                        const val = e.target.value.replace(/[^a-zA-Z\s]/g, '');
                        setForm((f) => ({ ...f, name: val }));
                        if (validationError?.field === 'name') setValidationError(null);
                      }}
                      placeholder="Enter full name"
                    />
                    {validationError?.field === 'name' && (
                      <p className="text-xs text-red-400 mt-0.5">{validationError.message}</p>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <Label>Phone Number *</Label>
                    <Input
                      value={form.phone}
                      onChange={(e) => {
                        handlePhoneChange(e.target.value);
                        if (validationError?.field === 'phone') setValidationError(null);
                      }}
                      placeholder="Enter 10-digit mobile"
                      disabled={isLookingUp}
                      maxLength={10}
                    />
                    {validationError?.field === 'phone' ? (
                      <p className="text-xs text-red-400 mt-0.5">{validationError.message}</p>
                    ) : phoneError ? (
                      <p className="text-xs text-red-400 mt-0.5">{phoneError}</p>
                    ) : null}
                    {isLookingUp && <p className="text-xs text-muted-foreground">Looking up customer...</p>}
                    {form.phone && form.phone.length === 10 && !phoneError && !validationError && !isLookingUp && (
                      <p className="text-xs font-semibold text-emerald-400 mt-0.5">
                        Available Wallet Balance: {formatCurrency(form.walletBalance || 0)}
                      </p>
                    )}
                  </div>
                </div>

                {/* 2nd Row: Email (Optional) | Additional Players */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 sm:gap-3">
                  <div className="space-y-1.5">
                    <Label>Email (Optional)</Label>
                    <Input
                      type="email"
                      value={form.email}
                      onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                      placeholder="Enter email"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Additional Players</Label>
                    <Input
                      value={form.additionalPlayers}
                      onChange={(e) => setForm((f) => ({ ...f, additionalPlayers: e.target.value }))}
                      placeholder="Enter extra player names"
                    />
                  </div>
                </div>

                {/* 3rd Row: Playing Category * | Playing Item * */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 sm:gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium">Playing Category *</Label>
                    <Select
                      value={form.menuCategoryId}
                      onChange={(e) => {
                        setForm((f) => ({ ...f, menuCategoryId: e.target.value, menuItemId: '' }));
                        if (validationError?.field === 'menuCategoryId') setValidationError(null);
                      }}
                    >
                      <option value="">Select Category</option>
                      {categories.map((cat) => (
                        <option key={cat._id} value={cat._id}>{cat.name}</option>
                      ))}
                    </Select>
                    {validationError?.field === 'menuCategoryId' && (
                      <p className="text-xs text-red-400 mt-0.5">{validationError.message}</p>
                    )}
                  </div>
                  {!isExtraCategory && (
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium">Playing Item*</Label>
                    <Select
                      value={form.menuItemId}
                      onChange={(e) => {
                        const itemId = e.target.value;
                        const selectedItem = availableMenuItems.find((i: any) => i._id === itemId);
                        const itemPrice = selectedItem?.price || selectedItem?.fullPrice || 0;
                        setForm((f) => ({
                          ...f,
                          menuItemId: itemId,
                          ...(itemPrice > 0 && (!f.billAmount || f.billAmount === '0') ? { billAmount: String(itemPrice) } : {})
                        }));
                        if (validationError?.field === 'menuItemId') setValidationError(null);
                      }}
                      disabled={!form.menuCategoryId || availableMenuItems.length === 0}
                    >
                      <option value="">Select Playing Item</option>
                      {availableMenuItems.map((item) => (
                        <option key={item._id} value={item._id}>
                          {item.name} {item.price ? `(₹${item.price})` : ''}
                        </option>
                      ))}
                    </Select>
                    {validationError?.field === 'menuItemId' && (
                      <p className="text-xs text-red-400 mt-0.5">{validationError.message}</p>
                    )}
                    {form.menuCategoryId && availableMenuItems.length === 0 && !showMenuLoading && (
                      <p className="text-xs text-muted-foreground">No active items for this category</p>
                    )}
                    {showMenuLoading && (
                      <p className="text-xs text-blue-400 animate-pulse">Loading items...</p>
                    )}
                  </div>
                  )}
                </div>
              </div>

              {/* Step 4: Session Details */}
              {!isProductCategory && !isExtraCategory && (
                <div className="space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 sm:gap-3">
                    <div className="space-y-1.5">
                      <Label>Start Time *</Label>
                      <Input
                        type="datetime-local"
                        value={form.startTime}
                        onChange={(e) => {
                          setForm((f) => ({ ...f, startTime: e.target.value }));
                          if (validationError?.field === 'startTime') setValidationError(null);
                        }}
                      />
                      {validationError?.field === 'startTime' && (
                        <p className="text-xs text-red-400 mt-0.5">{validationError.message}</p>
                      )}
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

              {/* Step 5: Bill Amount & Payment Info */}
              <div className="space-y-3 pt-1 border-t border-border">
                <div className="space-y-1.5">
                  <Label>Total Bill Amount {isExtraCategory ? '' : '*'}</Label>
                  <Input
                    type="number"
                    min="0"
                    step="any"
                    value={form.billAmount}
                    onChange={(e) => {
                      setForm((f) => ({ ...f, billAmount: e.target.value }));
                      if (validationError?.field === 'billAmount') setValidationError(null);
                    }}
                    placeholder="Enter total bill amount"
                  />
                  {validationError?.field === 'billAmount' && (
                    <p className="text-xs text-red-400 mt-0.5">{validationError.message}</p>
                  )}
                </div>
                <PaymentForm
                  values={form}
                  hidePendingPlayers={isExtraCategory}
                  onChange={(paymentValues) => {
                    setForm((f) => ({ ...f, ...paymentValues }));
                    if (validationError?.field === 'paymentStatus' || validationError?.field === 'paymentMethod') {
                      setValidationError(null);
                    }
                  }}
                  validationError={validationError}
                />
                <div className="space-y-1.5">
                  <Label>Notes</Label>
                  <Input
                    value={form.notes}
                    onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                    placeholder="Enter notes (optional)"
                  />
                </div>
              </div>
            </>
            );
          })()}

          {/* ────────────────── EDIT WORKFLOW: Customer Details + Category & Item Cart Selection ────────────────── */}
          {modal === 'edit' && (
            <>
              {/* Customer & Playing Info Summary */}
              <div className="p-3 sm:p-3.5 rounded-xl border border-border bg-card/50 space-y-3">
                {/* Read-only Customer ID */}
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Customer ID</Label>
                  <Input
                    value={form.customerId || '—'}
                    readOnly
                    disabled
                    className="bg-accent/40 font-mono text-sm font-semibold cursor-not-allowed text-primary"
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 sm:gap-3">
                  <div className="space-y-1.5">
                    <Label>Full Name *</Label>
                    <Input
                      value={form.name}
                      onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                      placeholder="Full Name"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Phone Number *</Label>
                    <Input
                      value={form.phone}
                      onChange={(e) => handlePhoneChange(e.target.value)}
                      placeholder="10-digit mobile"
                      maxLength={10}
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label>Email</Label>
                  <Input
                    type="email"
                    value={form.email}
                    onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                    placeholder="Enter email"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 sm:gap-3">
                  <div className="space-y-1.5">
                    <Label>Playing Category *</Label>
                    <Select
                      value={form.menuCategoryId}
                      onChange={(e) => setForm((f) => ({ ...f, menuCategoryId: e.target.value, menuItemId: '' }))}
                    >
                      <option value="">Select Category</option>
                      {categories.map((cat) => (
                        <option key={cat._id} value={cat._id}>{cat.name}</option>
                      ))}
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Playing Item *</Label>
                    <Select
                      value={form.menuItemId}
                      onChange={(e) => setForm((f) => ({ ...f, menuItemId: e.target.value }))}
                      disabled={!form.menuCategoryId || availableMenuItems.length === 0}
                    >
                      <option value="">Select Item</option>
                      {availableMenuItems.map((item) => (
                        <option key={item._id} value={item._id}>{item.name}</option>
                      ))}
                    </Select>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 sm:gap-3">
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

                <div className="space-y-1.5 pt-1">
                  <Label>Session Bill Amount *</Label>
                  <Input
                    type="number"
                    min="0"
                    step="any"
                    value={form.billAmount}
                    onChange={(e) => setForm((f) => ({ ...f, billAmount: e.target.value }))}
                    placeholder="Enter session bill amount"
                  />
                </div>
              </div>

              {/* CATEGORY & ITEM DROPDOWN SELECTION */}
              <div className="p-3 sm:p-4 rounded-2xl border border-primary/20 bg-gradient-to-b from-primary/5 via-card to-card space-y-3.5 sm:space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-5 gap-2.5 sm:gap-3 items-end">
                  <div className="sm:col-span-2 space-y-1.5">
                    <Label className="text-xs font-medium">Category</Label>
                    <Select
                      value={cartCategoryId}
                      onChange={(e) => {
                        setCartCategoryId(e.target.value);
                        setCartItemId('');
                      }}
                    >
                      <option value="">Select Category</option>
                      {cartAllowedCategories.map((cat) => (
                        <option key={cat._id} value={cat._id}>
                          {cat.name}
                        </option>
                      ))}
                    </Select>
                  </div>

                  <div className="sm:col-span-2 space-y-1.5">
                    <Label className="text-xs font-medium">Item</Label>
                    <Select
                      value={cartItemId}
                      onChange={(e) => setCartItemId(e.target.value)}
                      disabled={!cartCategoryId || cartAllowedItems.length === 0}
                    >
                      <option value="">Select Item</option>
                      {cartAllowedItems.map((item) => {
                        const itemPrice = item.price || item.fullPrice || 0;
                        return (
                          <option key={item._id} value={item._id}>
                            {item.name} {itemPrice ? `(₹${itemPrice})` : ''}
                          </option>
                        );
                      })}
                    </Select>
                  </div>

                  <div className="sm:col-span-1">
                    <Button
                      type="button"
                      variant="success"
                      className="w-full h-9 bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white font-semibold border-0 shadow-md shadow-emerald-950/20 transition-all duration-150"
                      disabled={!cartItemId}
                      onClick={() => {
                        const itemToAdd = cartAllowedItems.find((i) => i._id === cartItemId);
                        const catObj = cartAllowedCategories.find((c) => c._id === cartCategoryId);
                        if (itemToAdd) {
                          handleAddToCart(itemToAdd, catObj?.name || 'Item');
                          setCartItemId('');
                        }
                      }}
                    >
                      <Plus className="h-4 w-4 mr-1" />
                      Add
                    </Button>
                  </div>
                </div>

                {/* 🛒 RUNNING CART SUMMARY AT THE BOTTOM */}
                <div className="mt-3 rounded-xl border border-border/80 bg-background/90 p-2.5 sm:p-3 space-y-2.5 sm:space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-1.5 pb-2 border-b border-border/60">
                    <div className="flex items-center gap-2 text-xs font-bold text-foreground">
                      <ShoppingCart className="h-4 w-4 text-emerald-400 flex-shrink-0" />
                      <span>Running Cart Items ({cart.length})</span>
                    </div>
                    <span className="text-xs font-semibold text-emerald-400">
                      Cart Total: ₹{cartSubtotal}
                    </span>
                  </div>

                  {cart.length === 0 ? (
                    <p className="text-xs text-muted-foreground text-center py-2">
                      No additional products added to cart yet. Select a category & item above and click <span className="text-emerald-400 font-semibold">Add</span>.
                    </p>
                  ) : (
                    <div className="space-y-2 max-h-40 overflow-y-auto pr-0.5">
                      {cart.map((c) => (
                        <div
                          key={c.menuItemId}
                          className="flex items-center justify-between gap-2 text-xs p-2 sm:p-2.5 rounded-lg bg-card/60 border border-border/40"
                        >
                          <div className="min-w-0 pr-1 flex-1">
                            <p className="font-semibold text-foreground truncate">{c.itemName}</p>
                            <p className="text-[11px] text-muted-foreground truncate">
                              {c.categoryName} · ₹{c.unitPrice} × {c.quantity}
                            </p>
                          </div>
                          <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
                            <div className="flex items-center gap-1 bg-secondary/80 rounded-md p-0.5">
                              <button
                                type="button"
                                onClick={() => handleRemoveFromCart(c.menuItemId)}
                                className="h-6 w-6 rounded flex items-center justify-center hover:bg-background text-foreground text-xs font-bold active:scale-95 transition-all"
                              >
                                <Minus className="h-3 w-3" />
                              </button>
                              <span className="font-bold px-1.5 text-foreground text-xs">{c.quantity}</span>
                              <button
                                type="button"
                                onClick={() => {
                                  const itemObj = (allMenuItemsData?.data?.items || []).find((i: any) => i._id === c.menuItemId);
                                  if (itemObj) handleAddToCart(itemObj, c.categoryName);
                                }}
                                className="h-6 w-6 rounded flex items-center justify-center hover:bg-background text-foreground text-xs font-bold active:scale-95 transition-all"
                              >
                                <Plus className="h-3 w-3" />
                              </button>
                            </div>
                            <span className="font-bold text-foreground min-w-[2.5rem] sm:min-w-[3rem] text-right text-xs">₹{c.totalAmount}</span>
                            <button
                              type="button"
                              onClick={() => handleDeleteFromCart(c.menuItemId)}
                              className="text-red-400 hover:text-red-300 transition-colors p-1 rounded hover:bg-red-500/10 active:scale-95"
                              title="Remove item"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                </div>
              </div>

              {/* Total Bill Amount & Payment Info */}
              <div className="space-y-3 pt-1 border-t border-border">
                <div className="flex items-center justify-between p-3 rounded-lg border border-border bg-card/50">
                  <span className="font-bold text-foreground">Total Bill Amount</span>
                  <span className="font-extrabold text-primary text-lg">
                    {formatCurrency(parseCurrencyValue(form.billAmount) + (cart.length > 0 ? cartSubtotal : 0))}
                  </span>
                </div>

                <PaymentForm
                  values={{
                    ...form,
                    billAmount: String(parseCurrencyValue(form.billAmount) + (cart.length > 0 ? cartSubtotal : 0))
                  }}
                  onChange={(paymentValues) => {
                    const { billAmount, ...rest } = paymentValues;
                    setForm((f) => ({ ...f, ...rest }));
                  }}
                />

                <div className="space-y-1.5">
                  <Label>Notes</Label>
                  <Input
                    value={form.notes}
                    onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                    placeholder="Enter notes (optional)"
                  />
                </div>
              </div>
            </>
          )}

          <div className="flex flex-col-reverse sm:flex-row gap-2.5 pt-3 border-t border-border/60">
            <Button variant="outline" className="w-full sm:flex-1 h-10" onClick={() => setModal(null)}>Cancel</Button>
            <Button
              className="w-full sm:flex-1 h-10"
              loading={createMutation.isPending || updateMutation.isPending}
              onClick={handleSave}
            >
              {selected ? 'Save Changes & Cart' : 'Add Customer'}
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
