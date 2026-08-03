// ─────────────────────────────────────────────────────────────────────────────
// Shared TypeScript types for The Golden Frame frontend
// ─────────────────────────────────────────────────────────────────────────────

export type Role = 'super_admin' | 'admin' | 'branch_admin' | 'branch_manager' | 'staff' | 'cashier';
export type TableType = string;
export type TableStatus = 'available' | 'running' | 'reserved' | 'maintenance';
export type SessionStatus = 'running' | 'paused' | 'completed' | 'cancelled';
export type PaymentMethod = 'cash' | 'upi' | 'mixed' | 'wallet' | '' | null;
export type PaymentStatus = 'unpaid' | 'paid' | 'partial';
export type MembershipTier = 'silver' | 'gold' | 'platinum';
export type ExpenseCategory = 'rent' | 'electricity' | 'salary' | 'internet' | 'maintenance' | 'suppliers' | 'others';
export type InventoryCategoryType = 'cue_stick' | 'cue_tips' | 'balls' | 'chalk' | 'gloves' | 'food' | 'cold_drinks' | 'snacks' | 'other';
export type AttendanceStatus = 'present' | 'absent' | 'half_day' | 'leave' | 'weekly_off' | 'holiday';

export interface User {
  _id: string;
  name: string;
  email: string;
  phone?: string;
  address?: string;
  salary?: number;
  joiningDate?: string;
  employmentStatus?: string;
  notes?: string;
  role: Role;
  branches: Branch[];
  permissions?: string[];
  avatar?: string;
  isActive: boolean;
  lastLogin?: string;
  createdAt: string;
}

export interface Branch {
  _id: string;
  name: string;
  code: string;
  address?: string;
  phone?: string;
  isActive: boolean;
  openingTime: string;
  closingTime: string;
}

export interface Table {
  _id: string;
  name: string;
  branch: Branch;
  type: TableType;
  hourlyRate: number;
  status: TableStatus;
  qrCode?: string;
  notes?: string;
  isActive: boolean;
  currentSession?: Session;
}

export interface Reservation {
  _id: string;
  reservationId: string;
  customerName: string;
  phoneNumber: string;
  email?: string;
  branch: Branch;
  table: Table;
  menuCategoryId?: any;
  menuItemId?: any;
  reservationDate: string;
  reservationTime: string;
  durationMinutes: number;
  numberOfGuests: number;
  status: 'pending' | 'confirmed' | 'seated' | 'completed' | 'cancelled' | 'no_show';
  specialRequests?: string;
  notes?: string;
  createdBy: User;
  createdAt: string;
  statusHistory?: any[];
  paymentStatus?: 'paid' | 'partial' | 'unpaid' | 'refunded';
  paymentMethod?: 'cash' | 'upi' | 'mixed' | 'wallet' | '';
  cashAmount?: number;
  onlineAmount?: number;
  walletAmount?: number;
  totalPaid?: number;
  billAmount?: number;
  pendingPaymentAmount?: number;
  additionalPlayers?: any[];
}

export interface SessionItem {
  _id?: string;
  menuCategoryId?: string;
  menuItemId?: string;
  categoryName: string;
  itemName: string;
  quantity: number;
  unitPrice: number;
  totalAmount: number;
}

export interface Session {
  _id: string;
  table: Table;
  branch: string;
  customer?: Customer;
  startedBy: User;
  hourlyRate: number;
  startTime: string;
  endTime?: string;
  pauses: { pausedAt: string; resumedAt?: string }[];
  status: SessionStatus;
  extendedMinutes: number;
  billableMinutes: number;
  amount: number;
  bill?: string;
  menuCategoryId?: string | { _id: string; name: string };
  menuItemId?: string | { _id: string; name: string; price?: number };
  menuCategory?: string;
  menuItem?: string;
  addedItems?: SessionItem[];
}

export interface Customer {
  _id: string;
  name: string;
  phone: string;
  email?: string;
  branch: string;
  visits: number;
  totalSpending: number;
  favoriteGame?: TableType;
  membership: {
    tier?: MembershipTier;
    startDate?: string;
    expiryDate?: string;
    rewardPoints: number;
  };
  notes?: string;
  walletBalance?: number;
  outstandingBalance?: number;
  // Menu Management fields
  menuCategoryId: string;
  menuItemId: string;
  startTime: string;
  endTime?: string;
  paymentStatus: 'paid' | 'partial' | 'unpaid' | 'refunded';
  paymentMethod?: PaymentMethod;
  numberOfPlayers?: number;
  billAmount: number;
  createdAt?: string;
}

export interface BillItem {
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
  type: 'table_time' | 'inventory' | 'other';
}

export interface PendingPlayer {
  id?: string;
  playerName?: string;
  mobileNumber?: string;
  pendingAmount?: number;
  name?: string;
  mobile?: string;
  amount?: number;
  orderId?: string;
  customerId?: string;
}

export interface Bill {
  _id: string;
  invoiceNumber: string;
  branch: Branch;
  customer?: Customer;
  session?: Session;
  order?: any;
  items: BillItem[];
  subtotal: number;
  discountType?: 'flat' | 'percent';
  discountValue: number;
  discountAmount: number;
  membershipDiscount: number;
  tax: number;
  total: number;
  paymentStatus: PaymentStatus;
  createdBy: User;
  createdAt: string;
  // Payment details stored directly on Bill
  paymentMethod?: PaymentMethod;
  cashAmount?: number;
  onlineAmount?: number;
  walletAmount?: number;
  amountReceived?: number;
  pendingPaymentAmount?: number;
  pendingPlayers?: PendingPlayer[];
  notes?: string;
  // Menu category/item from session for Live Tables billing
  menuCategoryId?: string | { _id: string; name: string };
  menuItemId?: string | { _id: string; name: string };
  menuCategory?: string;
  menuItem?: string;
}

export interface Expense {
  _id: string;
  branch: Branch;
  category: ExpenseCategory;
  title: string;
  amount: number;
  date: string;
  notes?: string;
  createdBy: User;
  createdAt: string;
  paymentStatus?: 'paid' | 'partial' | 'unpaid' | 'refunded';
  paymentMethod?: 'cash' | 'upi' | 'mixed' | 'wallet' | '';
  cashAmount?: number;
  onlineAmount?: number;
  walletAmount?: number;
  pendingAmount?: number;
}

export interface InventoryCategoryDoc {
  _id: string;
  name: string;
  status: 'Active' | 'Inactive';
  totalItems?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface InventoryItem {
  _id: string;
  name: string;
  branch: any;
  category: InventoryCategoryDoc;
  unit: string;
  stockQuantity?: number;
  lowStockThreshold?: number;
  purchasePrice: number;
  sellingPrice?: number;
  sku?: string;
  isActive: boolean;
  openingStock?: number;
  currentStock?: number;
  minimumStockAlert?: number;
}

export interface MenuCategoryDoc {
  _id: string;
  name: string;
  status: 'Active' | 'Inactive';
  totalItems?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface MenuItem {
  _id: string;
  name: string;
  branch: any;
  category: MenuCategoryDoc;
  inventoryItem?: string;
  price: number;
  halfPrice?: number;
  fullPrice?: number;
  description?: string;
  status: 'Active' | 'Inactive';
  createdAt?: string;
  updatedAt?: string;
}

export interface Notification {
  _id: string;
  type: string;
  title: string;
  message: string;
  isRead: boolean;
  createdAt: string;
}

export interface DashboardStats {
  revenue: { today: number; month: number; year: number };
  expenses: { today: number; month: number };
  profit: { today: number; month: number };
  tables: { running: number; available: number };
  customersToday: number;
}

export interface AttendanceRecord {
  _id: string;
  employee: User;
  branch: Branch;
  date: string;
  status: AttendanceStatus;
  checkIn?: string;
  checkOut?: string;
  workingHours?: number;
  overtimeHours?: number;
  lateMinutes?: number;
  earlyExitMinutes?: number;
  notes?: string;
  shift?: string;
  markedBy?: User;
  markedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AttendanceStats {
  totalStaff: number;
  present: number;
  absent: number;
  halfDay: number;
  leave: number;
  weeklyOff: number;
  holiday: number;
  totalWorkingMinutes: number;
  overtimeMinutes: number;
  lateMinutes: number;
  earlyExitMinutes: number;
}

export interface AttendanceHistoryStats {
  totalDays: number;
  present: number;
  absent: number;
  leave: number;
  halfDay: number;
  weeklyOff: number;
  holiday: number;
  lateArrivals: number;
  overtimeMinutes: number;
  workingMinutes: number;
  monthlyAttendancePercentage: number;
}

export interface MyAttendanceResponse {
  employee: User;
  todayAttendance: AttendanceRecord | null;
  records: AttendanceRecord[];
  stats?: AttendanceHistoryStats;
  totalRecords: number;
  currentPage: number;
  totalPages: number;
  pageSize: number;
  range: {
    from: string;
    to: string;
  };
}

export interface StockTransaction {
  _id: string;
  inventoryItem: string;
  customer?: string;
  quantity: number;
  type: 'sale' | 'refund' | 'restock' | 'adjustment';
  previousStock: number;
  newStock: number;
  branch: any;
  notes?: string;
  createdBy?: string;
  createdAt: string;
}

export interface InventoryReportItem {
  _id: string;
  name: string;
  category: InventoryCategoryDoc;
  openingStock: number;
  soldQuantity: number;
  remainingStock: number;
  status: 'normal' | 'low_stock' | 'out_of_stock';
  unit: string;
  purchasePrice: number;
  sellingPrice?: number;
}

export interface InventoryReportSummary {
  totalItems: number;
  lowStockItems: number;
  outOfStockItems: number;
  totalValue: number;
}

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
  results?: number;
  total?: number;
  page?: number;
  pages?: number;
}
