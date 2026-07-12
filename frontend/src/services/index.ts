import api from './api';
import type { ApiResponse, AttendanceHistoryStats, AttendanceRecord, AttendanceStats, Bill, Branch, Customer, DashboardStats, Expense, InventoryCategoryDoc, InventoryItem, InventoryReportItem, InventoryReportSummary, MenuItem, Session, Table, User } from '@/types';

// ── Auth ─────────────────────────────────────────────────────────────────────
export const authService = {
  login: (email: string, password: string) => api.post<ApiResponse<{ user: User; accessToken: string }>>('/auth/login', { email, password }),
  logout: () => api.post('/auth/logout'),
  getMe: () => api.get<ApiResponse<{ user: User }>>('/auth/me'),
  changePassword: (currentPassword: string, newPassword: string) =>
    api.patch('/auth/change-password', { currentPassword, newPassword }),
  refresh: () => api.post<ApiResponse<{ accessToken: string }>>('/auth/refresh'),
};

// ── Branches ─────────────────────────────────────────────────────────────────
export const branchService = {
  getAll: () => api.get<ApiResponse<{ branches: Branch[] }>>('/branches'),
  getOne: (id: string) => api.get<ApiResponse<{ branch: Branch }>>(`/branches/${id}`),
  create: (data: Partial<Branch>) => api.post<ApiResponse<{ branch: Branch }>>('/branches', data),
  update: (id: string, data: Partial<Branch>) => api.patch<ApiResponse<{ branch: Branch }>>(`/branches/${id}`, data),
  delete: (id: string) => api.delete(`/branches/${id}`),
};

// ── Tables ────────────────────────────────────────────────────────────────────
export const tableService = {
  getAll: (params?: Record<string, string>) => api.get<ApiResponse<{ tables: Table[] }>>('/tables', { params }),
  getOne: (id: string) => api.get<ApiResponse<{ table: Table }>>(`/tables/${id}`),
  create: (data: Partial<Table>) => api.post<ApiResponse<{ table: Table }>>('/tables', data),
  update: (id: string, data: Partial<Table>) => api.patch<ApiResponse<{ table: Table }>>(`/tables/${id}`, data),
  delete: (id: string) => api.delete(`/tables/${id}`),
};

// ── Sessions ──────────────────────────────────────────────────────────────────
export const sessionService = {
  getLive: (branch?: string) => api.get<ApiResponse<{ sessions: Session[] }>>('/sessions/live', { params: branch ? { branch } : {} }),
  start: (tableId: string, customerId?: string) => api.post<ApiResponse<{ session: Session }>>('/sessions/start', { tableId, customerId }),
  pause: (id: string) => api.patch<ApiResponse<{ session: Session }>>(`/sessions/${id}/pause`),
  resume: (id: string) => api.patch<ApiResponse<{ session: Session }>>(`/sessions/${id}/resume`),
  extend: (id: string, minutes: number) => api.patch<ApiResponse<{ session: Session }>>(`/sessions/${id}/extend`, { minutes }),
  stop: (id: string) => api.patch<ApiResponse<{ session: Session }>>(`/sessions/${id}/stop`),
  transfer: (id: string, customerId: string) => api.patch<ApiResponse<{ session: Session }>>(`/sessions/${id}/transfer`, { customerId }),
};

// ── Customers ─────────────────────────────────────────────────────────────────
export const customerService = {
  getAll: (params?: Record<string, string>) => api.get<ApiResponse<{ customers: Customer[] }>>('/customers', { params }),
  getOne: (id: string) => api.get<ApiResponse<{ customer: Customer }>>(`/customers/${id}`),
  lookup: (phone: string, branch?: string) => api.get<ApiResponse<{ customer: Customer | null }>>(`/customers/lookup/${phone}`, { params: { ...branch ? { branch } : {}, _t: Date.now() } }),
  create: (data: Partial<Customer>) => api.post<ApiResponse<{ customer: Customer }>>('/customers', data),
  update: (id: string, data: Partial<Customer>) => api.patch<ApiResponse<{ customer: Customer }>>(`/customers/${id}`, data),
  delete: (id: string) => api.delete(`/customers/${id}`),
  receivePayment: (id: string, data: Record<string, unknown>) => api.post<ApiResponse<{ customer: Customer }>>(`/customers/${id}/receive-payment`, data),
  getPaymentHistory: (id: string) => api.get<ApiResponse<{ paymentHistory: any[] }>>(`/customers/${id}/payment-history`),
};

// ── Billing ───────────────────────────────────────────────────────────────────
export const billingService = {
  getAll: (params?: Record<string, string>) => api.get<ApiResponse<{ bills: Bill[] }>>('/bills', { params }),
  getOne: (id: string) => api.get<ApiResponse<{ bill: Bill }>>(`/bills/${id}`),
  create: (data: Record<string, unknown>) => api.post<ApiResponse<{ bill: Bill }>>('/bills', data),
  createFromCustomer: (customerId: string) => api.post<ApiResponse<{ bill: Bill }>>('/bills/from-customer', { customerId }),
  receivePayment: (id: string, data: Record<string, unknown>) => api.post<ApiResponse<{ bill: Bill }>>(`/bills/${id}/payment`, data),
  downloadPDF: (id: string) => api.get(`/bills/${id}/pdf`, { responseType: 'blob' }),
};

// ── Expenses ──────────────────────────────────────────────────────────────────
export const expenseService = {
  getAll: (params?: Record<string, string>) => api.get<ApiResponse<{ expenses: Expense[] }>>('/expenses', { params }),
  create: (data: Partial<Expense>) => api.post<ApiResponse<{ expense: Expense }>>('/expenses', data),
  update: (id: string, data: Partial<Expense>) => api.patch<ApiResponse<{ expense: Expense }>>(`/expenses/${id}`, data),
  delete: (id: string) => api.delete(`/expenses/${id}`),
};

// ── Inventory ─────────────────────────────────────────────────────────────────
export const inventoryService = {
  getAll: (params?: Record<string, string>) => api.get<ApiResponse<{ items: InventoryItem[]; pagination: any }>>('/inventory', { params }),
  create: (data: Partial<InventoryItem> & { category: string }) => api.post<ApiResponse<{ item: InventoryItem }>>('/inventory', data),
  update: (id: string, data: Partial<InventoryItem> & { category?: string }) => api.patch<ApiResponse<{ item: InventoryItem }>>(`/inventory/${id}`, data),
  restock: (id: string, data: { quantity: number; cost: number; supplier?: string }) =>
    api.post<ApiResponse<{ item: InventoryItem }>>(`/inventory/${id}/restock`, data),
  delete: (id: string) => api.delete(`/inventory/${id}`),

  getCategories: (params?: Record<string, string>) => api.get<ApiResponse<{ categories: any[] }>>('/inventory/categories', { params }),
  createCategory: (data: { name: string; branch?: string; status: 'Active' | 'Inactive' }) => api.post<ApiResponse<{ category: any }>>('/inventory/categories', data),
  updateCategory: (id: string, data: { name?: string; status?: 'Active' | 'Inactive' }) => api.patch<ApiResponse<{ category: any }>>(`/inventory/categories/${id}`, data),
  deleteCategory: (id: string) => api.delete(`/inventory/categories/${id}`),

  getReport: (params?: Record<string, string>) => api.get<ApiResponse<{ summary: InventoryReportSummary; items: InventoryReportItem[] }>>('/inventory/report', { params }),
};

// ── Menu ───────────────────────────────────────────────────────────────────────
export const menuService = {
  getAll: (params?: Record<string, string>) => api.get<ApiResponse<{ items: MenuItem[]; pagination: any }>>('/menu', { params }),
  create: (data: Partial<MenuItem> & { category: string }) => api.post<ApiResponse<{ item: MenuItem }>>('/menu', data),
  update: (id: string, data: Partial<MenuItem> & { category?: string }) => api.patch<ApiResponse<{ item: MenuItem }>>(`/menu/${id}`, data),
  delete: (id: string) => api.delete(`/menu/${id}`),

  getCategories: (params?: Record<string, string>) => api.get<ApiResponse<{ categories: any[] }>>('/menu/categories', { params }),
  createCategory: (data: { name: string; status: 'Active' | 'Inactive' }) => api.post<ApiResponse<{ category: any }>>('/menu/categories', data),
  updateCategory: (id: string, data: { name?: string; status?: 'Active' | 'Inactive' }) => api.patch<ApiResponse<{ category: any }>>(`/menu/categories/${id}`, data),
  deleteCategory: (id: string) => api.delete(`/menu/categories/${id}`),
};

// ── Users ─────────────────────────────────────────────────────────────────────
export const userService = {
  getAll: (params?: Record<string, string>) => api.get<ApiResponse<{ users: User[] }>>('/users', { params }),
  create: (data: Partial<User> & { password: string }) => api.post<ApiResponse<{ user: User }>>('/users', data),
  update: (id: string, data: Partial<User>) => api.patch<ApiResponse<{ user: User }>>(`/users/${id}`, data),
  delete: (id: string) => api.delete(`/users/${id}`),
};

// ── Reports ───────────────────────────────────────────────────────────────────
export const reportService = {
  getDashboard: (params?: Record<string, string>) => api.get<ApiResponse<DashboardStats>>('/reports/dashboard', { params }),
  getRevenue: (params?: Record<string, string>) => api.get('/reports/revenue', { params }),
  getTableUsage: (params?: Record<string, string>) => api.get('/reports/table-usage', { params }),
  getBranchComparison: () => api.get('/reports/branch-comparison'),
  exportExcel: (params?: Record<string, string>) => api.get('/reports/export/excel', { params, responseType: 'blob' }),
};

// ── Notifications ─────────────────────────────────────────────────────────────
export const notificationService = {
  getAll: () => api.get('/notifications'),
  markRead: (id: string) => api.patch(`/notifications/${id}/read`),
};

// ── Settings ──────────────────────────────────────────────────────────────────
export const settingsService = {
  get: () => api.get('/settings'),
  update: (data: Record<string, unknown>) => api.patch('/settings', data),
};

// ── Activity Logs ─────────────────────────────────────────────────────────────
export const logsService = {
  getAll: (params?: Record<string, string>) => api.get('/logs', { params }),
};

// ── Bookings ──────────────────────────────────────────────────────────────────
export const bookingService = {
  getAll: (params?: Record<string, string>) => api.get('/bookings', { params }),
  create: (data: Record<string, unknown>) => api.post('/bookings', data),
  update: (id: string, data: Record<string, unknown>) => api.patch(`/bookings/${id}`, data),
  cancel: (id: string) => api.patch(`/bookings/${id}/cancel`),
};

// ── Attendance ────────────────────────────────────────────────────────────────
export const attendanceService = {
  getAll: (params?: Record<string, string>) => api.get<ApiResponse<{ records: AttendanceRecord[]; stats: AttendanceStats }>>('/attendance', { params }),
  mark: (data: Record<string, unknown>) => api.post('/attendance', data),
  update: (id: string, data: Record<string, unknown>) => api.patch(`/attendance/${id}`, data),
  bulkMark: (data: Record<string, unknown>) => api.post('/attendance/bulk', data),
  history: (employeeId: string, params?: Record<string, string>) =>
    api.get<ApiResponse<{ employee: User | null; records: AttendanceRecord[]; stats: AttendanceHistoryStats }>>(`/attendance/history/${employeeId}`, { params }),
  exportExcel: (params?: Record<string, string>) => api.get('/attendance/export/excel', { params, responseType: 'blob' }),
  exportPDF: (params?: Record<string, string>) => api.get('/attendance/export/pdf', { params, responseType: 'blob' }),
};

// Reservations
export const reservationService = {
  getAll: (params?: Record<string, string>) => api.get('/reservations', { params }),
  getStats: (params?: Record<string, string>) => api.get('/reservations/stats', { params }),
  getOne: (id: string) => api.get(`/reservations/${id}`),
  getAvailableTables: (params: Record<string, string>) => api.get('/reservations/available-tables', { params }),
  create: (data: Record<string, unknown>) => api.post('/reservations', data),
  update: (id: string, data: Record<string, unknown>) => api.patch(`/reservations/${id}`, data),
  changeStatus: (id: string, status: string, note?: string) => api.patch(`/reservations/${id}/status`, { status, note }),
  delete: (id: string) => api.delete(`/reservations/${id}`),
};

// ── Wallet ─────────────────────────────────────────────────────────────────────
export const walletService = {
  getTransactions: (params?: Record<string, string>) => api.get('/wallet/transactions', { params }),
  getCustomerHistory: (customerId: string, params?: Record<string, string>) => api.get(`/wallet/customer/${customerId}`, { params }),
  addBalance: (data: { customerId: string; amount: number; description?: string; paymentMethod?: string }) => api.post('/wallet/add-balance', data),
  getSummary: (params?: Record<string, string>) => api.get('/wallet/summary', { params }),
};
