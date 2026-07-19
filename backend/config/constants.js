/**
 * Centralized constants/enums used across models, middleware and controllers.
 * Keeping these in one place avoids magic strings scattered through the codebase.
 */

const ROLES = {
  SUPER_ADMIN: 'super_admin',
  ADMIN: 'admin',
  BRANCH_MANAGER: 'branch_manager',
  STAFF: 'staff',
  CASHIER: 'cashier',
};

const ROLE_LIST = Object.values(ROLES);

// Coarse permission map used by the requirePermission middleware.
// Super admin implicitly bypasses all checks (see middleware/auth.js).
const PERMISSIONS = {
  [ROLES.ADMIN]: [
    'dashboard:view',
    'tables:view',
    'tables:operate',
    'billing:manage',
    'customers:manage',
    'customers:create',
    'customers:view',
    'inventory:manage',
    'expenses:manage',
    'attendance:manage',
    'reports:view',
    'menu:manage',
    'menu:view',
    'bookings:manage',
  ],
  [ROLES.BRANCH_MANAGER]: [
    'dashboard:view',
    'tables:view',
    'tables:operate',
    'billing:manage',
    'customers:manage',
    'customers:create',
    'customers:view',
    'inventory:manage',
    'expenses:manage',
    'attendance:manage',
    'reports:view',
    'menu:manage',
    'menu:view',
    'bookings:manage',
  ],
  [ROLES.STAFF]: [
    'tables:view',
    'tables:operate',
    'billing:manage',
    'customers:view',
    'customers:create',
    'customers:manage',
    'menu:view',
    'bookings:manage',
  ],
  [ROLES.CASHIER]: [
    'tables:view',
    'billing:manage',
    'customers:create',
    'customers:manage',
  ],
};

const TABLE_TYPES = ['pool', 'snooker', 'ps5'];

const TABLE_STATUS = ['available', 'running', 'reserved', 'maintenance'];

const PAYMENT_METHODS = ['cash', 'upi', 'mixed', 'wallet'];

const MEMBERSHIP_TIERS = ['silver', 'gold', 'platinum'];

const EXPENSE_CATEGORIES = [
  'rent',
  'electricity',
  'salary',
  'internet',
  'maintenance',
  'suppliers',
  'others',
];

const INVENTORY_CATEGORIES = [
  'cue_stick',
  'cue_tips',
  'balls',
  'chalk',
  'gloves',
  'food',
  'cold_drinks',
  'snacks',
  'other',
];

const SESSION_STATUS = ['running', 'paused', 'completed', 'cancelled'];

const ATTENDANCE_STATUS = ['present', 'absent', 'half_day', 'leave', 'weekly_off', 'holiday'];

const DEFAULT_BRANCHES = ['Daman', 'DNH'];

module.exports = {
  ROLES,
  ROLE_LIST,
  PERMISSIONS,
  TABLE_TYPES,
  TABLE_STATUS,
  PAYMENT_METHODS,
  MEMBERSHIP_TIERS,
  EXPENSE_CATEGORIES,
  INVENTORY_CATEGORIES,
  SESSION_STATUS,
  ATTENDANCE_STATUS,
  DEFAULT_BRANCHES,
};
