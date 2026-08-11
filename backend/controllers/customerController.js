const Customer = require('../models/Customer');
const Order = require('../models/Order');
const OrderCounter = require('../models/OrderCounter');
const CustomerCounter = require('../models/CustomerCounter');
const WalletTransaction = require('../models/WalletTransaction');
const PaymentHistory = require('../models/PaymentHistory');
const { Bill } = require('../models/Billing');
const Reservation = require('../models/Reservation');
const Session = require('../models/Session');
const Wallet = require('../models/Wallet');
const { Inventory, MenuItem, StockTransaction, MenuCategory } = require('../models/Operations');
const Branch = require('../models/Branch');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { ROLES, BUSINESS_SHORT_CODE } = require('../config/constants');
const { createBranchNotification } = require('../services/notificationService');

const parseCurrencyValue = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  // Return exact value without any rounding - preserve user input
  return num;
};

const { getBusinessDayDateString } = require('../utils/businessDay');

/**
 * Ensures customer.walletBalance includes any un-refunded Wallet top-ups for their phone number if uninitialized.
 */
const syncCustomerWalletBalance = async (customer) => {
  if (!customer || !customer.phone) return 0;
  try {
    const phone = customer.phone.trim();
    if (customer.walletBalance === undefined || customer.walletBalance === null) {
      const walletDocs = await Wallet.find({
        mobileNumber: phone,
        paymentStatus: { $ne: 'refunded' },
      }).select('amount').lean();

      const walletSum = walletDocs.reduce((sum, w) => sum + (Number(w.amount) || 0), 0);

      if (walletSum > 0) {
        customer.walletBalance = walletSum;
        await customer.save();
      }
    }
  } catch (err) {
    console.error('Error syncing customer wallet balance:', err);
  }
  return customer.walletBalance || 0;
};

// Helper function to generate custom Order ID with thread-safety using atomic counter
const generateOrderId = async (branchId, date = new Date()) => {
  const dateStr = getBusinessDayDateString(date);

  let attempts = 0;
  while (attempts < 50) {
    attempts++;
    try {
      const counter = await OrderCounter.findOneAndUpdate(
        { branch: branchId, date: dateStr },
        { $inc: { sequence: 1 } },
        { new: true, upsert: true }
      );

      if (!counter) {
        throw new Error('Failed to generate order counter');
      }

      const sequence = counter.sequence;
      const sequenceStr = String(sequence).padStart(4, '0');
      const orderId = `${dateStr}/${sequenceStr}`;

      const exists = await Order.findOne({ branch: branchId, orderId });
      if (!exists) {
        return orderId;
      }
    } catch (error) {
      console.error('Error generating order ID:', error);
    }
  }

  const timestamp = Date.now();
  const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
  return `${dateStr}/${timestamp}-${random}`;
};

// Helper function to generate Customer ID atomically (per-branch counter, branch-configured prefix)
const generateCustomerId = async (branchId) => {
  // Look up the branch-specific Settings to get the configured Short Business Name
  let prefix = BUSINESS_SHORT_CODE; // fallback
  if (branchId) {
    try {
      const { Settings } = require('../models/System');
      const branchSettings = await Settings.findOne({ branch: branchId }).select('shortBusinessName').lean();
      if (branchSettings?.shortBusinessName?.trim()) {
        prefix = branchSettings.shortBusinessName.trim().toUpperCase();
      }
    } catch (_) { /* keep fallback prefix */ }
  }

  // Use a per-branch counter key so sequences are independent across branches
  const counterKey = branchId ? `customer_seq_branch_${branchId}` : 'customer_seq_global';

  let attempts = 0;
  while (attempts < 50) {
    attempts++;
    const counter = await CustomerCounter.findByIdAndUpdate(
      counterKey,
      { $inc: { seq: 1 } },
      { new: true, upsert: true }
    );
    const customerId = `${prefix}${String(counter.seq).padStart(5, '0')}`;

    // Uniqueness is enforced at schema level; this check is an extra safety guard
    const exists = await Customer.findOne({ customerId });
    if (!exists) {
      return customerId;
    }
  }

  return `${prefix}${Date.now()}`;
};

// Helper function to enrich order document with pendingPlayers list
const batchEnrichOrdersWithPendingPlayers = async (orders) => {
  if (!orders || orders.length === 0) return [];

  const ordersNeedingSubOrders = orders.filter(
    (o) => !o.pendingPlayers || o.pendingPlayers.length === 0
  );

  const subOrdersByParent = new Map();
  if (ordersNeedingSubOrders.length > 0) {
    const parentIds = ordersNeedingSubOrders.map((o) => o._id).filter(Boolean);
    const parentOrderIds = ordersNeedingSubOrders.map((o) => o.orderId).filter(Boolean);

    const subOrders = await Order.find({
      $or: [
        { parentOrder: { $in: parentIds } },
        { parentOrderId: { $in: parentOrderIds } },
      ],
      isActive: true,
    }).populate('customer', 'name phone').lean();

    subOrders.forEach((so) => {
      const key1 = so.parentOrder ? String(so.parentOrder) : null;
      const key2 = so.parentOrderId ? String(so.parentOrderId) : null;
      if (key1) {
        if (!subOrdersByParent.has(key1)) subOrdersByParent.set(key1, []);
        subOrdersByParent.get(key1).push(so);
      }
      if (key2 && key2 !== key1) {
        if (!subOrdersByParent.has(key2)) subOrdersByParent.set(key2, []);
        subOrdersByParent.get(key2).push(so);
      }
    });
  }

  return orders.map((orderDoc) => {
    let pendingPlayers = orderDoc.pendingPlayers || [];
    if (!pendingPlayers || pendingPlayers.length === 0) {
      const matched =
        subOrdersByParent.get(String(orderDoc._id)) ||
        subOrdersByParent.get(String(orderDoc.orderId)) ||
        [];

      if (matched.length > 0) {
        pendingPlayers = matched.map((so) => ({
          id: (so.customer?._id || so._id || '').toString(),
          playerName: so.customer?.name || 'Player',
          name: so.customer?.name || 'Player',
          mobileNumber: so.customer?.phone || '',
          mobile: so.customer?.phone || '',
          pendingAmount: so.billAmount || so.pendingPaymentAmount || 0,
          amount: so.billAmount || so.pendingPaymentAmount || 0,
          orderId: so.orderId,
        }));
      }
    }

    const formattedPlayers = (pendingPlayers || []).map((p) => ({
      id: (p.id || p._id || '').toString(),
      playerName: p.playerName || p.name || '',
      name: p.name || p.playerName || '',
      mobileNumber: p.mobileNumber || p.mobile || '',
      mobile: p.mobile || p.mobileNumber || '',
      pendingAmount: parseCurrencyValue(p.pendingAmount || p.amount) || 0,
      amount: parseCurrencyValue(p.amount || p.pendingAmount) || 0,
      orderId: p.orderId || '',
    }));

    return {
      ...orderDoc,
      name: orderDoc.customer?.name,
      phone: orderDoc.customer?.phone,
      email: orderDoc.customer?.email,
      customerId: orderDoc.customer?.customerId,
      walletBalance: orderDoc.customer?.walletBalance || 0,
      pendingPlayers: formattedPlayers,
    };
  });
};

const enrichOrderWithPendingPlayers = async (orderDoc) => {
  const [enriched] = await batchEnrichOrdersWithPendingPlayers([orderDoc]);
  return enriched;
};

// GET /api/customers/stats
// GET /api/customers/stats
exports.getCustomerStats = asyncHandler(async (req, res) => {
  const filter = { isActive: true, billAmount: { $gt: 0 } };
  const userBranchIds = (req.user.branches || []).map(b => (b._id || b).toString());
  
  if (req.user.role !== ROLES.SUPER_ADMIN && req.user.role !== ROLES.ADMIN) {
    filter.branch = { $in: userBranchIds };
  } else if (req.query.branch) {
    filter.branch = req.query.branch;
  }

  // Get date ranges
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekStart = new Date(todayStart);
  weekStart.setDate(weekStart.getDate() - weekStart.getDay()); // Start of week (Sunday)
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  // Get counts
  const [todayCount, weekCount, monthCount, totalCount] = await Promise.all([
    Order.countDocuments({ ...filter, createdAt: { $gte: todayStart } }),
    Order.countDocuments({ ...filter, createdAt: { $gte: weekStart } }),
    Order.countDocuments({ ...filter, createdAt: { $gte: monthStart } }),
    Order.countDocuments(filter),
  ]);

  res.status(200).json({
    success: true,
    data: {
      today: todayCount,
      week: weekCount,
      month: monthCount,
      total: totalCount,
    },
  });
});

// GET /api/customers?search=&branch=&page=&limit=&sortBy=&sortOrder=
// GET /api/customers?search=&branch=&page=&limit=&sortBy=&sortOrder=
exports.getCustomers = asyncHandler(async (req, res) => {
  const filter = { isActive: true, billAmount: { $gt: 0 } };
  const userBranchIds = (req.user.branches || []).map(b => (b._id || b).toString());
  
  if (req.user.role !== ROLES.SUPER_ADMIN && req.user.role !== ROLES.ADMIN) {
    if (req.query.branch && userBranchIds.includes(req.query.branch.toString())) {
      filter.branch = req.query.branch;
    } else {
      filter.branch = { $in: userBranchIds };
    }
  } else if (req.query.branch) {
    filter.branch = req.query.branch;
  }
  
  // Server-side search by customer name, phone, or email
  if (req.query.search) {
    const searchRegex = new RegExp(req.query.search, 'i');
    const matchingCustomers = await Customer.find({
      $or: [
        { name: searchRegex },
        { phone: searchRegex },
        { email: searchRegex },
      ]
    }).select('_id').lean();
    const customerIds = matchingCustomers.map(c => c._id);

    filter.$or = [
      { customer: { $in: customerIds } },
      { orderId: searchRegex },
    ];
  }

  // Filter by menu category if provided
  if (req.query.menuCategoryId) filter.menuCategoryId = req.query.menuCategoryId;
  
  // Filter by payment status if provided
  if (req.query.paymentStatus) {
    if (req.query.paymentStatus.includes(',')) {
      filter.paymentStatus = { $in: req.query.paymentStatus.split(',') };
    } else {
      filter.paymentStatus = req.query.paymentStatus;
    }
  } else {
    // On the main Customers page (no paymentStatus filter), exclude sub-orders generated for pending players,
    // as well as orders originating strictly from Billing/Sessions.
    filter.additionalPlayers = { $not: /^Pending player payment for order/ };
    filter.session = { $exists: false };
    filter.bill = { $exists: false };
  }

  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 25;
  const skip = (page - 1) * limit;

  // Sorting
  const sortBy = req.query.sortBy || 'createdAt';
  const sortOrder = req.query.sortOrder === 'asc' ? 1 : -1;
  const sort = { [sortBy]: sortOrder };

  const overdueDate = new Date();
  overdueDate.setDate(overdueDate.getDate() - 30); // 30 days ago

  const mongoose = require('mongoose');
  const aggregateFilter = { ...filter };
  
  if (aggregateFilter.branch) {
    if (aggregateFilter.branch.$in) {
      aggregateFilter.branch.$in = aggregateFilter.branch.$in.map(b => new mongoose.Types.ObjectId(b));
    } else {
      aggregateFilter.branch = new mongoose.Types.ObjectId(aggregateFilter.branch);
    }
  }
  
  if (aggregateFilter.menuCategoryId) {
    aggregateFilter.menuCategoryId = new mongoose.Types.ObjectId(aggregateFilter.menuCategoryId);
  }

  const [orders, total, statsResult] = await Promise.all([
    Order.find(filter)
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .populate('customer', 'name phone email customerId walletBalance')
      .populate('menuCategoryId', 'name status')
      .populate('menuItemId', 'name price status')
      .populate('branch', 'name code')
      .populate('table', 'name type')
      .lean(), // Use lean() for faster queries
    Order.countDocuments(filter),
    Order.aggregate([
      { $match: aggregateFilter },
      {
        $group: {
          _id: null,
          totalPendingAmount: { 
            $sum: { 
              $max: [0, { $subtract: [{ $ifNull: ["$billAmount", 0] }, { $ifNull: ["$totalPaid", 0] }] }] 
            } 
          },
          totalPendingCustomers: { $sum: 1 },
          overdueCustomersCount: {
            $sum: { $cond: [{ $lt: ["$createdAt", overdueDate] }, 1, 0] }
          },
          highValueCustomersCount: {
            $sum: { $cond: [{ $gt: [{ $ifNull: ["$billAmount", 0] }, 5000] }, 1, 0] }
          }
        }
      }
    ])
  ]);

  const stats = statsResult[0] || {
    totalPendingAmount: 0,
    totalPendingCustomers: 0,
    overdueCustomersCount: 0,
    highValueCustomersCount: 0
  };

  // Transform orders to match the expected customer structure for frontend compatibility
  const customers = await batchEnrichOrdersWithPendingPlayers(orders);

  res.status(200).json({
    success: true,
    results: customers.length,
    total,
    filtered: total,
    page,
    pages: Math.ceil(total / limit),
    limit,
    data: { customers },
    stats,
  });
});

// GET /api/customers/:id
exports.getCustomer = asyncHandler(async (req, res, next) => {
  const order = await Order.findById(req.params.id)
    .populate('customer', 'name phone email customerId walletBalance')
    .populate('menuCategoryId', 'name status')
    .populate('menuItemId', 'name price status')
    .populate('branch', 'name code')
    .lean(); // Use lean() for faster queries
  if (!order) return next(new AppError('Order not found.', 404));

  if (req.user.role !== ROLES.SUPER_ADMIN && req.user.role !== ROLES.ADMIN) {
    const userBranchIds = (req.user.branches || []).map(b => (b._id || b).toString());
    if (!userBranchIds.includes(order.branch?._id?.toString() || order.branch?.toString())) {
      return next(new AppError('You do not have access to this branch\'s data.', 403));
    }
  }
  
  // Transform to match expected structure
  const customer = await enrichOrderWithPendingPlayers(order);
  
  res.status(200).json({ success: true, data: { customer } });
});

// GET /api/customers/lookup/:phone?branch=...
exports.lookupCustomer = asyncHandler(async (req, res) => {
  const { phone } = req.params;
  const term = req.params.phone ? req.params.phone.trim() : '';
  const branchFilter = req.query.branch;

  const isPhoneSearch = /^\d{10}$/.test(term);
  const customerQuery = {
    isActive: true,
    ...(isPhoneSearch ? { phone: term } : { customerId: term.toUpperCase() })
  };

  if (branchFilter) {
    customerQuery.branch = branchFilter;
  }

  const [customerDoc, walletDocs] = await Promise.all([
    Customer.findOne(customerQuery)
      .select('customerId name phone email address branch walletBalance notes')
      .populate('branch', 'name code')
      .lean(),
    Wallet.find({
      mobileNumber: phone,
      ...(branchFilter ? { branch: branchFilter } : {}),
      paymentStatus: { $ne: 'refunded' },
    }).select('amount name branch').lean(),
  ]);

  // Branch access check for non-admin users
  if (customerDoc && req.user.role !== ROLES.SUPER_ADMIN && req.user.role !== ROLES.ADMIN) {
    const userBranchIds = (req.user.branches || []).map(b => (b._id || b).toString());
    const custBranchId = customerDoc.branch?._id?.toString() || customerDoc.branch?.toString();
    if (!userBranchIds.includes(custBranchId)) {
      return res.status(200).json({ success: true, data: { customer: null } });
    }
  }

  if (customerDoc) {
    return res.status(200).json({
      success: true,
      data: {
        customer: customerDoc,
      },
    });
  }

  const walletSum = walletDocs.reduce((sum, w) => sum + (Number(w.amount) || 0), 0);

  if (walletSum > 0) {
    const sampleWallet = walletDocs[0];
    return res.status(200).json({
      success: true,
      data: {
        customer: {
          name: sampleWallet?.name || '',
          phone,
          branch: sampleWallet?.branch,
          walletBalance: walletSum,
        },
      },
    });
  }

  res.status(200).json({ success: true, data: { customer: null } });
});

// POST /api/customers
exports.createCustomer = asyncHandler(async (req, res, next) => {
  const isAdminRole = req.user.role === ROLES.SUPER_ADMIN || req.user.role === ROLES.ADMIN;

  if (!isAdminRole) {
    // Branch manager / staff: always use their OWN assigned branch.
    // Ignore any branch sent from the frontend — it could be stale from an admin session.
    if (!req.user.branches || req.user.branches.length === 0) {
      return next(new AppError('You are not assigned to any branch.', 403));
    }
    const userBranch = req.user.branches[0];
    req.body.branch = (userBranch._id || userBranch).toString();
  } else {
    // Admin / super_admin: branch must be explicitly provided
    if (!req.body.branch) {
      return next(new AppError('Branch is required.', 400));
    }
  }

  // Normalize currency values
  const billAmount = parseCurrencyValue(req.body.billAmount) || 0;
  let cashAmount = parseCurrencyValue(req.body.cashAmount) || 0;
  let onlineAmount = parseCurrencyValue(req.body.onlineAmount) || 0;
  let walletAmount = parseCurrencyValue(req.body.walletAmount) || 0;
  const amountReceived = parseCurrencyValue(req.body.amountReceived) || 0;
  const paymentStatus = req.body.paymentStatus || 'unpaid';
  const paymentMethod = (paymentStatus === 'unpaid' && (!req.body.paymentMethod || req.body.paymentMethod === '')) 
    ? null 
    : req.body.paymentMethod;
  
  if ((paymentStatus === 'paid' || paymentStatus === 'partial') && !paymentMethod) {
    return next(new AppError('Payment Method is required', 400));
  }
  
  // Calculate total paid from individual payment methods
  let totalPaid = cashAmount + onlineAmount + walletAmount;
  
  // For simple payment methods (cash, upi), use amountReceived if individual amounts are not provided
  if (paymentMethod === 'cash' && cashAmount === 0 && amountReceived > 0) {
    cashAmount = amountReceived;
    totalPaid = amountReceived;
  } else if (paymentMethod === 'upi' && onlineAmount === 0 && amountReceived > 0) {
    onlineAmount = amountReceived;
    totalPaid = amountReceived;
  }
  
  // Round values to avoid floating-point precision issues
  const roundedBillAmount = Math.round(billAmount * 100) / 100;
  const roundedTotalPaid = Math.round(totalPaid * 100) / 100;
  
  // Calculate pending amount
  const pendingAmount = Math.max(0, roundedBillAmount - roundedTotalPaid);
  
  // Validation based on payment status
  if (paymentStatus === 'paid') {
    const hasPendingPlayers = Array.isArray(req.body.pendingPlayers) && req.body.pendingPlayers.length > 0;
    let pendingPlayersTotal = 0;
    if (hasPendingPlayers) {
      pendingPlayersTotal = req.body.pendingPlayers.reduce((sum, p) => sum + (parseCurrencyValue(p.amount) || 0), 0);
    }
    
    if (hasPendingPlayers) {
      const totalAllocated = roundedTotalPaid + pendingPlayersTotal;
      if (Math.abs(totalAllocated - roundedBillAmount) > 0.01) {
        if (totalAllocated > roundedBillAmount) {
          return next(new AppError(`Over-allocated Amount: ${(totalAllocated - roundedBillAmount).toFixed(2)}\nTotal Allocated (${totalAllocated.toFixed(2)}) must equal Total Bill Amount (${roundedBillAmount.toFixed(2)}).`, 400));
        } else {
          return next(new AppError(`Remaining Amount: ${(roundedBillAmount - totalAllocated).toFixed(2)}\nTotal Allocated (${totalAllocated.toFixed(2)}) must equal Total Bill Amount (${roundedBillAmount.toFixed(2)}).`, 400));
        }
      }
    } else {
      // For paid status, total paid must be >= bill amount
      if (roundedTotalPaid < roundedBillAmount) {
        return next(new AppError(`For Paid status, Amount Received must be greater than or equal to the Bill Amount (${roundedBillAmount})`, 400));
      }
    }
  } else if (paymentStatus === 'partial') {
    // For partial status, allow any amount less than bill amount
    // No validation error needed, just calculate pending
    if (roundedTotalPaid === 0) {
      return next(new AppError('For Partial status, at least some payment must be received', 400));
    }
  } else if (paymentStatus === 'unpaid') {
    // For unpaid status, allow zero payment
    // Set all amounts to 0 if not provided
    if (roundedTotalPaid === 0 && amountReceived === 0) {
      // This is valid for unpaid status
      cashAmount = 0;
      onlineAmount = 0;
      walletAmount = 0;
    }
  }
  
  // Validate mixed payment amounts if payment method is mixed
  if (paymentMethod === 'mixed') {
    // For mixed, we just need to ensure the breakdown is provided
    // No strict equality requirement anymore for partial payments
  }

  // Validate wallet balance if using wallet
  if (walletAmount > 0) {
    // Will validate after customer is found
  }

  // Validate stock and find customer concurrently
  const [menuItem, existingCustomer] = await Promise.all([
    req.body.menuItemId ? MenuItem.findById(req.body.menuItemId).populate('inventoryItem') : Promise.resolve(null),
    Customer.findOne({ phone: req.body.phone, isActive: true })
  ]);

  if (menuItem && menuItem.inventoryItem) {
    const inventoryItem = await Inventory.findById(menuItem.inventoryItem._id);
    if (inventoryItem && inventoryItem.currentStock < 1) {
      return next(new AppError(`Insufficient stock. Only ${inventoryItem.currentStock} items available.`, 400));
    }
  }
  
  let customer = existingCustomer;
  
  if (!customer) {
    // Create new customer if doesn't exist
    const customerId = await generateCustomerId(req.body.branch);
    customer = await Customer.create({
      customerId,
      name: req.body.name,
      phone: req.body.phone,
      email: req.body.email,
      address: req.body.address || '',
      branch: req.body.branch,
      notes: req.body.notes,
      favoriteGame: req.body.favoriteGame,
    });

    // Create customer notification for Super Admin and branch manager in background (no await)
    createBranchNotification({
      branchId: customer.branch,
      actor: req.user,
      title: 'New Customer Created',
      message: `${req.user.name} created a new customer (${customer.name}).`,
      superAdminOnly: req.user.role === ROLES.SUPER_ADMIN,
      req,
    }).catch(err => console.error('Error creating branch notification:', err));
  } else {
    let customerUpdated = false;
    if (req.body.name && req.body.name.trim() !== '' && req.body.name.trim() !== customer.name) {
      customer.name = req.body.name.trim();
      customerUpdated = true;
    }
    if (req.body.email && req.body.email.trim() !== '' && req.body.email.trim() !== customer.email) {
      customer.email = req.body.email.trim();
      customerUpdated = true;
    }
    if (customerUpdated) {
      await customer.save();
    }
  }

  // Check if it's "Extra" category
  let isExtra = false;
  if (req.body.menuCategoryId) {
    const category = await MenuCategory.findById(req.body.menuCategoryId).lean();
    if (category && category.name && category.name.toLowerCase() === 'extra') {
      isExtra = true;
    }
  }

  // Handle "Extra" automatic settlement
  if (isExtra) {
    // For "Extra", use the bill amount as the payment amount.
    let amountToProcess = billAmount;
    
    if (amountToProcess > 0) {
      // 1. Pay off pending payments
      const pendingOrders = await Order.find({
        customer: customer._id,
        paymentStatus: { $in: ['unpaid', 'partial'] },
        isActive: true
      }).sort({ createdAt: 1 }); // Oldest first

      for (const pOrder of pendingOrders) {
        if (amountToProcess <= 0) break;

        const pBill = parseCurrencyValue(pOrder.billAmount) || 0;
        const pPaid = parseCurrencyValue(pOrder.totalPaid) || 0;
        const pPending = Math.max(0, pBill - pPaid);

        if (pPending > 0) {
          const deduction = Math.min(pPending, amountToProcess);
          pOrder.totalPaid = pPaid + deduction;
          pOrder.amountReceived = parseCurrencyValue(pOrder.amountReceived || 0) + deduction;
          pOrder.paymentStatus = (pOrder.totalPaid >= pBill) ? 'paid' : 'partial';
          
          await pOrder.save();

          const lastPayment = await PaymentHistory.findOne({ order: pOrder._id }).sort('-paymentNumber');
          const nextPaymentNumber = lastPayment ? (lastPayment.paymentNumber || 0) + 1 : 1;

          // Log payment history for this order
          await PaymentHistory.create({
            order: pOrder._id,
            orderId: pOrder.orderId,
            customer: customer._id,
            customerName: customer.name,
            customerPhone: customer.phone,
            branch: pOrder.branch,
            paymentMethod: paymentMethod || 'cash',
            cashAmount: (!paymentMethod || paymentMethod === 'cash') ? deduction : 0,
            onlineAmount: paymentMethod === 'upi' ? deduction : 0,
            walletAmount: paymentMethod === 'wallet' ? deduction : 0,
            totalPaid: deduction,
            billAmount: pBill,
            pendingAmount: Math.max(0, pBill - pOrder.totalPaid),
            paymentStatus: pOrder.paymentStatus,
            notes: 'Automatic deduction from Extra category',
            createdBy: req.user._id,
            paymentNumber: nextPaymentNumber
          });

          amountToProcess -= deduction;
        }
      }

      // 2. Add remaining amount to wallet
      if (amountToProcess > 0) {
        await syncCustomerWalletBalance(customer);
        customer.walletBalance = (customer.walletBalance || 0) + amountToProcess;
        await customer.save();

        const { generateWalletId } = require('./walletManagementController');
        const walletId = await generateWalletId(req.body.branch);
        await Wallet.create({
          walletId,
          mobileNumber: customer.phone,
          name: customer.name,
          amount: amountToProcess,
          totalPaid: amountToProcess,
          paymentMethod: paymentMethod || 'cash',
          paymentStatus: 'paid',
          type: 'credit',
          transactionType: 'top_up',
          notes: 'Automatic wallet top-up from Extra category',
          createdBy: req.user._id,
          branch: req.body.branch
        });
      }
    }

    return res.status(201).json({
      success: true,
      data: {
        order: {
          _id: 'auto-settled',
          orderId: 'AUTO-SETTLED',
          message: 'Extra amount successfully processed automatically.'
        }
      }
    });
  }

  
  // Validate wallet balance if using wallet
  if (walletAmount > 0) {
    await syncCustomerWalletBalance(customer);
    if (customer.walletBalance < walletAmount) {
      return next(new AppError(`Insufficient wallet balance. Available: ₹${customer.walletBalance}, Required: ₹${walletAmount}`, 400));
    }
  }

  // Generate custom Order ID for the new order
  let orderId;
  let retryCount = 0;
  const maxRetries = 3;
  
  while (retryCount < maxRetries) {
    try {
      orderId = await generateOrderId(req.body.branch);
      
      // Validate that orderId was generated successfully
      if (!orderId || orderId === 'null' || orderId === null) {
        throw new Error('Generated orderId is null or invalid');
      }
      
      // Check if this orderId already exists (to handle race conditions)
      const existingOrder = await Order.findOne({ branch: req.body.branch, orderId });
      if (existingOrder) {
        retryCount++;
        continue;
      }
      
      // If we get here, orderId is valid and unique
      break;
    } catch (error) {
      console.error('Error generating order ID (attempt', retryCount + 1, '):', error);
      retryCount++;
      
      if (retryCount >= maxRetries) {
        return next(new AppError('Failed to generate unique order ID after multiple attempts. Please try again.', 500));
      }
      
      // Wait a bit before retrying
      await new Promise(resolve => setTimeout(resolve, 100 * retryCount));
    }
  }
  
  // Determine final payment status based on calculations
  let finalPaymentStatus = paymentStatus;
  if (totalPaid === 0) {
    finalPaymentStatus = 'unpaid';
  } else if (totalPaid >= billAmount) {
    finalPaymentStatus = 'paid';
  } else {
    finalPaymentStatus = 'partial';
  }
  
  // Create new order linked to the customer
  const order = await Order.create({
    orderId,
    customer: customer._id,
    branch: req.body.branch,
    menuCategoryId: req.body.menuCategoryId,
    menuItemId: req.body.menuItemId,
    startTime: req.body.startTime,
    endTime: req.body.endTime,
    paymentStatus: finalPaymentStatus,
    paymentMethod: paymentMethod,
    cashAmount,
    onlineAmount,
    walletAmount,
    pendingPaymentAmount: pendingAmount,
    amountReceived: (req.body.amountReceived !== undefined && req.body.amountReceived !== null && req.body.amountReceived !== '') 
      ? parseCurrencyValue(req.body.amountReceived) 
      : totalPaid,
    totalPaid,
    billAmount,
    additionalPlayers: req.body.additionalPlayers,
    createdBy: req.user._id,
  });
  
  const writePromises = [];

  // Create payment history record
  writePromises.push(PaymentHistory.create({
    order: order._id,
    orderId: order.orderId,
    customer: customer._id,
    customerName: customer.name,
    customerPhone: customer.phone,
    branch: req.body.branch,
    paymentMethod: paymentMethod,
    cashAmount,
    onlineAmount,
    walletAmount,
    totalPaid,
    billAmount,
    pendingAmount,
    paymentStatus: finalPaymentStatus,
    notes: req.body.notes || '',
    createdBy: req.user._id,
    paymentNumber: 1, // First payment for this order
  }));

  // Handle wallet debit
  if (walletAmount > 0) {
    customer.walletBalance -= walletAmount;
    
    // Add wallet transaction to customer
    customer.walletTransactions.push({
      type: 'debit',
      amount: walletAmount,
      balance: customer.walletBalance,
      orderId: order.orderId,
      billAmount,
      paymentMethod: req.body.paymentMethod,
      description: `Payment for order ${order.orderId}`,
      createdBy: req.user._id,
    });
    
    // Create separate wallet transaction record
    writePromises.push(WalletTransaction.create({
      customer: customer._id,
      customerName: customer.name,
      customerPhone: customer.phone,
      order: order._id,
      orderId: order.orderId,
      branch: req.body.branch,
      type: 'debit',
      amount: walletAmount,
      balance: customer.walletBalance,
      billAmount,
      walletAmountUsed: walletAmount,
      paymentMethod: req.body.paymentMethod,
      description: `Payment for order ${order.orderId}`,
      createdBy: req.user._id,
    }));
  }

  // Handle wallet credit (extra amount received)
  const addToWallet = req.body.addToWallet || false;
  const extraAmount = amountReceived > billAmount ? amountReceived - billAmount : 0;
  
  if (addToWallet && extraAmount > 0) {
    customer.walletBalance += extraAmount;
    
    // Add wallet transaction to customer
    customer.walletTransactions.push({
      type: 'credit',
      amount: extraAmount,
      balance: customer.walletBalance,
      orderId: order.orderId,
      billAmount,
      paymentMethod: req.body.paymentMethod,
      description: `Extra payment added to wallet for order ${order.orderId}`,
      createdBy: req.user._id,
    });
    
    // Create separate wallet transaction record
    writePromises.push(WalletTransaction.create({
      customer: customer._id,
      customerName: customer.name,
      customerPhone: customer.phone,
      order: order._id,
      orderId: order.orderId,
      branch: req.body.branch,
      type: 'credit',
      amount: extraAmount,
      balance: customer.walletBalance,
      billAmount,
      amountReceived,
      walletAmountAdded: extraAmount,
      paymentMethod: req.body.paymentMethod,
      description: `Extra payment added to wallet for order ${order.orderId}`,
      createdBy: req.user._id,
    }));
    
    // Create actual Wallet entry so it appears in Wallet Management
    const { generateWalletId } = require('./walletManagementController');
    const walletId = await generateWalletId(req.body.branch);
    writePromises.push(Wallet.create({
      walletId,
      name: customer.name,
      mobileNumber: customer.phone,
      amount: extraAmount,
      totalPaid: extraAmount,
      paymentMethod: req.body.paymentMethod || 'cash',
      paymentStatus: 'paid',
      branch: req.body.branch,
      createdBy: req.user._id,
      notes: `Auto top-up from extra payment for order ${order.orderId}`
    }));
  }

  // Handle pending payment - update customer outstanding balance
  if (pendingAmount > 0) {
    customer.outstandingBalance = (customer.outstandingBalance || 0) + pendingAmount;
  }

  // Update customer visit count and total spending
  customer.visits += 1;
  customer.totalSpending += billAmount;
  writePromises.push(customer.save());

  // Handle extra pending players if provided
  const pendingPlayers = Array.isArray(req.body.pendingPlayers) ? req.body.pendingPlayers : [];
  const savedPendingPlayersList = [];

  for (const player of pendingPlayers) {
    const playerMobile = String(player.mobile || player.phone || '').replace(/\D/g, '').slice(0, 10);
    const playerAmount = parseCurrencyValue(player.amount) || 0;
    const playerName = (player.name && player.name.trim()) ? player.name.trim() : `Player (${playerMobile})`;
    if (playerMobile.length === 10 && playerAmount > 0) {
      // Find or create customer for player
      let playerCustomer = await Customer.findOne({ phone: playerMobile, isActive: true });
      if (!playerCustomer) {
        const playerCustId = await generateCustomerId(req.body.branch);
        playerCustomer = await Customer.create({
          customerId: playerCustId,
          name: playerName,
          phone: playerMobile,
          branch: req.body.branch,
        });
      } else if (player.name && player.name.trim() && (playerCustomer.name.startsWith('Player (') || !playerCustomer.name)) {
        playerCustomer.name = player.name.trim();
        await playerCustomer.save();
      }

      // Generate order ID for pending player using parent orderId with suffix
      const pOrderId = `${order.orderId}-P${savedPendingPlayersList.length + 1}`;

      const playerOrder = await Order.create({
        orderId: pOrderId,
        customer: playerCustomer._id,
        parentOrder: order._id,
        parentOrderId: order.orderId,
        branch: req.body.branch,
        menuCategoryId: req.body.menuCategoryId,
        menuItemId: req.body.menuItemId,
        table: req.body.tableId || req.body.table,
        session: req.body.sessionId || req.body.session,
        startTime: req.body.startTime,
        endTime: req.body.endTime,
        paymentStatus: 'unpaid',
        paymentMethod: null,
        cashAmount: 0,
        onlineAmount: 0,
        walletAmount: 0,
        pendingPaymentAmount: playerAmount,
        amountReceived: 0,
        totalPaid: 0,
        billAmount: playerAmount,
        additionalPlayers: `Pending player payment for order ${orderId}`,
        createdBy: req.user._id,
      });

      savedPendingPlayersList.push({
        id: playerOrder._id.toString(),
        playerName,
        name: playerName,
        mobileNumber: playerMobile,
        mobile: playerMobile,
        pendingAmount: playerAmount,
        amount: playerAmount,
        orderId: pOrderId,
        customerId: playerCustomer._id.toString(),
      });

      writePromises.push(PaymentHistory.create({
        order: playerOrder._id,
        orderId: playerOrder.orderId,
        customer: playerCustomer._id,
        customerName: playerCustomer.name,
        customerPhone: playerCustomer.phone,
        branch: req.body.branch,
        paymentMethod: null,
        cashAmount: 0,
        onlineAmount: 0,
        walletAmount: 0,
        totalPaid: 0,
        billAmount: playerAmount,
        pendingAmount: playerAmount,
        paymentStatus: 'unpaid',
        notes: `Pending share for order ${orderId}`,
        createdBy: req.user._id,
        paymentNumber: 1,
      }));

      playerCustomer.outstandingBalance = (playerCustomer.outstandingBalance || 0) + playerAmount;
      writePromises.push(playerCustomer.save());
    }
  }

  if (savedPendingPlayersList.length > 0) {
    order.pendingPlayers = savedPendingPlayersList;
    writePromises.push(order.save());
  }

  // Deduct stock if menu item is linked to inventory
  if (menuItem && menuItem.inventoryItem) {
    const inventoryItem = await Inventory.findById(menuItem.inventoryItem._id);
    if (inventoryItem) {
      const previousStock = inventoryItem.currentStock;
      inventoryItem.currentStock -= 1;
      writePromises.push(inventoryItem.save());

      // Create stock transaction record
      writePromises.push(StockTransaction.create({
        inventoryItem: inventoryItem._id,
        customer: customer._id,
        order: order._id,
        quantity: 1,
        type: 'sale',
        previousStock,
        newStock: inventoryItem.currentStock,
        branch: inventoryItem.branch,
        notes: `Sold to customer ${customer.name}`,
        createdBy: req.user._id,
      }));

      // Check for low stock alert in background (no await)
      if (inventoryItem.currentStock <= inventoryItem.minimumStockAlert) {
        const { Notification } = require('../models/System');
        Notification.create({
          branch: inventoryItem.branch,
          type: 'low_inventory',
          title: 'Low Stock Alert',
          message: `${inventoryItem.name} is running low (${inventoryItem.currentStock} ${inventoryItem.unit} remaining).`,
          targetRoles: ['super_admin', 'branch_admin', 'branch_manager'],
          meta: { inventoryId: inventoryItem._id.toString() },
        }).catch(err => console.error('Error creating low stock notification:', err));
      }
    }
  }

  // Await all DB writes concurrently
  await Promise.all(writePromises);

  // Populate the order directly on the mongoose document to avoid redundant find query
  const populatedOrderDoc = await order.populate([
    { path: 'customer', select: 'name phone email customerId' },
    { path: 'menuCategoryId', select: 'name status' },
    { path: 'menuItemId', select: 'name price status' },
    { path: 'branch', select: 'name code' }
  ]);
  
  const populatedOrder = populatedOrderDoc.toObject();

  // Transform to match expected structure
  // Use the actual customer's current wallet balance (after any wallet credit/debit)
  const responseData = {
    ...populatedOrder,
    name: populatedOrder.customer?.name,
    phone: populatedOrder.customer?.phone,
    email: populatedOrder.customer?.email,
    customerId: populatedOrder.customer?.customerId,
    walletBalance: customer.walletBalance || 0, // Use the updated customer balance
  };

  res.status(201).json({ success: true, data: { customer: responseData } });
});

// PATCH /api/customers/:id
exports.updateCustomer = asyncHandler(async (req, res, next) => {
  const existingOrder = await Order.findById(req.params.id);
  if (!existingOrder) return next(new AppError('Order not found.', 404));

  if (req.user.role !== ROLES.SUPER_ADMIN && req.user.role !== ROLES.ADMIN) {
    const userBranchIds = (req.user.branches || []).map(b => (b._id || b).toString());
    if (!userBranchIds.includes(existingOrder.branch?.toString())) {
      return next(new AppError('You do not have access to this branch\'s data.', 403));
    }
    if (req.body.branch && !userBranchIds.includes(req.body.branch.toString())) {
      return next(new AppError('You cannot assign to this branch.', 403));
    }
  }

  const targetPaymentStatus = req.body.paymentStatus || existingOrder.paymentStatus;
  if ((targetPaymentStatus === 'paid' || targetPaymentStatus === 'partial') && (req.body.paymentMethod === '' || (!req.body.paymentMethod && !existingOrder.paymentMethod))) {
    return next(new AppError('Payment Method is required', 400));
  }
  if (targetPaymentStatus === 'unpaid' && (!req.body.paymentMethod || req.body.paymentMethod === '')) {
    req.body.paymentMethod = null;
  }

  // Validate mixed payment amounts if payment method is mixed
  if (req.body.paymentMethod === 'mixed') {
    const cashAmount = parseCurrencyValue(req.body.cashAmount) || 0;
    const onlineAmount = parseCurrencyValue(req.body.onlineAmount) || 0;
    const walletAmount = parseCurrencyValue(req.body.walletAmount) || 0;
    const totalPaid = cashAmount + onlineAmount + walletAmount;
    const totalBill = parseCurrencyValue(req.body.billAmount) || 0;

    if (targetPaymentStatus === 'paid') {
      const hasPendingPlayers = Array.isArray(req.body.pendingPlayers) && req.body.pendingPlayers.length > 0;
      let pendingPlayersTotal = 0;
      if (hasPendingPlayers) {
        pendingPlayersTotal = req.body.pendingPlayers.reduce((sum, p) => sum + (parseCurrencyValue(p.amount || p.pendingAmount) || 0), 0);
      }
      const totalAllocated = totalPaid + pendingPlayersTotal;
      if (Math.abs(totalAllocated - totalBill) > 0.01) {
        return next(new AppError(`Total paid amount (${totalPaid}) + pending players amount (${pendingPlayersTotal}) must equal the total bill amount (${totalBill})`, 400));
      }
    } else if (targetPaymentStatus === 'partial') {
      const amountReceived = parseCurrencyValue(req.body.amountReceived) || 0;
      if (Math.abs(totalPaid - amountReceived) > 0.01) {
        return next(new AppError(`Cash Amount (${cashAmount}) + Online Amount (${onlineAmount}) + Wallet Amount (${walletAmount}) must equal the Amount Received (${amountReceived})`, 400));
      }
    }
  }

  // Handle stock restoration and deduction if menuItemId is changing
  if (req.body.menuItemId && req.body.menuItemId !== existingOrder.menuItemId?.toString()) {
    // Fetch both menu items concurrently
    const [previousMenuItem, newMenuItem] = await Promise.all([
      MenuItem.findById(existingOrder.menuItemId).populate('inventoryItem'),
      MenuItem.findById(req.body.menuItemId).populate('inventoryItem')
    ]);

    const stockPromises = [];

    if (previousMenuItem && previousMenuItem.inventoryItem) {
      const previousInventoryItem = await Inventory.findById(previousMenuItem.inventoryItem._id);
      if (previousInventoryItem) {
        const previousStock = previousInventoryItem.currentStock;
        previousInventoryItem.currentStock += 1;
        stockPromises.push(previousInventoryItem.save());

        // Create stock transaction record for refund
        stockPromises.push(StockTransaction.create({
          inventoryItem: previousInventoryItem._id,
          customer: existingOrder.customer,
          order: existingOrder._id,
          quantity: 1,
          type: 'refund',
          previousStock,
          newStock: previousInventoryItem.currentStock,
          branch: previousInventoryItem.branch,
          notes: `Restored from order update`,
          createdBy: req.user._id,
        }));
      }
    }

    if (newMenuItem && newMenuItem.inventoryItem) {
      const newInventoryItem = await Inventory.findById(newMenuItem.inventoryItem._id);
      if (newInventoryItem) {
        if (newInventoryItem.currentStock < 1) {
          return next(new AppError(`Insufficient stock. Only ${newInventoryItem.currentStock} items available.`, 400));
        }

        const previousStock = newInventoryItem.currentStock;
        newInventoryItem.currentStock -= 1;
        stockPromises.push(newInventoryItem.save());

        // Create stock transaction record for sale
        stockPromises.push(StockTransaction.create({
          inventoryItem: newInventoryItem._id,
          customer: existingOrder.customer,
          order: existingOrder._id,
          quantity: 1,
          type: 'sale',
          previousStock,
          newStock: newInventoryItem.currentStock,
          branch: newInventoryItem.branch,
          notes: `Sold to customer (order update)`,
          createdBy: req.user._id,
        }));

        // Check for low stock alert in background (no await)
        if (newInventoryItem.currentStock <= newInventoryItem.minimumStockAlert) {
          const { Notification } = require('../models/System');
          Notification.create({
            branch: newInventoryItem.branch,
            type: 'low_inventory',
            title: 'Low Stock Alert',
            message: `${newInventoryItem.name} is running low (${newInventoryItem.currentStock} ${newInventoryItem.unit} remaining).`,
            targetRoles: ['super_admin', 'branch_admin', 'branch_manager'],
            meta: { inventoryId: newInventoryItem._id.toString() },
          }).catch(err => console.error(err));
        }
      }
    }

    // Await all stock saves and transactions concurrently
    await Promise.all(stockPromises);
  }

  // Normalize currency values for storage on update
  if (req.body.billAmount !== undefined) {
    req.body.billAmount = parseCurrencyValue(req.body.billAmount);
  }
  let { paymentMethod, cashAmount, onlineAmount, amountReceived } = req.body;

  if (cashAmount !== undefined) cashAmount = parseCurrencyValue(cashAmount) || 0;
  if (onlineAmount !== undefined) onlineAmount = parseCurrencyValue(onlineAmount) || 0;
  if (amountReceived !== undefined) amountReceived = parseCurrencyValue(amountReceived) || 0;

  if (paymentMethod === 'cash' && cashAmount === 0 && amountReceived > 0) {
    cashAmount = amountReceived;
    req.body.cashAmount = cashAmount;
  } else if (paymentMethod === 'upi' && onlineAmount === 0 && amountReceived > 0) {
    onlineAmount = amountReceived;
    req.body.onlineAmount = onlineAmount;
  }

  if (req.body.cashAmount !== undefined || req.body.onlineAmount !== undefined) {
    req.body.totalPaid = (req.body.cashAmount || 0) + (req.body.onlineAmount || 0);
  }

  if (req.body.amountReceived !== undefined) {
    req.body.amountReceived = amountReceived;
  }

  const order = await Order.findByIdAndUpdate(req.params.id, req.body, {
    new: true,
    runValidators: true,
  });
  if (!order) return next(new AppError('Order not found.', 404));

  // Get the customer to fetch current wallet balance
  const customer = await Customer.findById(order.customer);

  // Update customer details if provided
  if (customer) {
    if (req.body.name !== undefined && req.body.name.trim() !== '') {
      customer.name = req.body.name.trim();
    }
    if (req.body.phone !== undefined) {
      const cleanedPhone = String(req.body.phone).replace(/\D/g, '').slice(0, 10);
      if (cleanedPhone.length === 10 && cleanedPhone !== customer.phone) {
        const phoneExists = await Customer.findOne({ phone: cleanedPhone, isActive: true });
        if (phoneExists && phoneExists._id.toString() !== customer._id.toString()) {
          return next(new AppError('Phone number already exists for another customer.', 400));
        }
        customer.phone = cleanedPhone;
      } else if (cleanedPhone.length !== 10) {
        return next(new AppError('Phone number must contain exactly 10 digits.', 400));
      }
    }
    if (req.body.email !== undefined) {
      customer.email = req.body.email.trim();
    }
    if (req.body.address !== undefined) {
      customer.address = req.body.address;
    }
    await customer.save();
  }

  // Handle wallet balance updates for edited orders
  const oldWalletAmount = existingOrder.walletAmount || 0;
  const newWalletAmount = order.walletAmount || 0;
  const walletDifference = newWalletAmount - oldWalletAmount;

  const writePromises = [];

  if (walletDifference !== 0) {
    // If wallet amount increased, debit more from wallet
    if (walletDifference > 0) {
      await syncCustomerWalletBalance(customer);
      if (customer.walletBalance < walletDifference) {
        return next(new AppError(`Insufficient wallet balance for update. Available: ₹${customer.walletBalance}, Required: ₹${walletDifference}`, 400));
      }
      customer.walletBalance -= walletDifference;
      
      // Add wallet transaction
      customer.walletTransactions.push({
        type: 'debit',
        amount: walletDifference,
        balance: customer.walletBalance,
        orderId: order.orderId,
        billAmount: order.billAmount,
        paymentMethod: order.paymentMethod,
        description: `Additional wallet payment for order ${order.orderId}`,
        createdBy: req.user._id,
      });
      
      // Create separate wallet transaction record
      writePromises.push(WalletTransaction.create({
        customer: customer._id,
        customerName: customer.name,
        customerPhone: customer.phone,
        order: order._id,
        orderId: order.orderId,
        branch: order.branch,
        type: 'debit',
        amount: walletDifference,
        balance: customer.walletBalance,
        billAmount: order.billAmount,
        walletAmountUsed: walletDifference,
        paymentMethod: order.paymentMethod,
        description: `Additional wallet payment for order ${order.orderId}`,
        createdBy: req.user._id,
      }));
    }
    // If wallet amount decreased, credit back to wallet
    else if (walletDifference < 0) {
      const creditAmount = Math.abs(walletDifference);
      customer.walletBalance += creditAmount;
      
      // Add wallet transaction
      customer.walletTransactions.push({
        type: 'credit',
        amount: creditAmount,
        balance: customer.walletBalance,
        orderId: order.orderId,
        billAmount: order.billAmount,
        paymentMethod: order.paymentMethod,
        description: `Wallet refund for order ${order.orderId}`,
        createdBy: req.user._id,
      });
      
      // Create separate wallet transaction record
      writePromises.push(WalletTransaction.create({
        customer: customer._id,
        customerName: customer.name,
        customerPhone: customer.phone,
        order: order._id,
        orderId: order.orderId,
        branch: order.branch,
        type: 'credit',
        amount: creditAmount,
        balance: customer.walletBalance,
        billAmount: order.billAmount,
        walletAmountAdded: creditAmount,
        paymentMethod: order.paymentMethod,
        description: `Wallet refund for order ${order.orderId}`,
        createdBy: req.user._id,
      }));
    }
    
    writePromises.push(customer.save());
  }

  if (writePromises.length > 0) {
    await Promise.all(writePromises);
  }

  // Synchronize pending player payments on update if pendingPlayers is provided
  if (Array.isArray(req.body.pendingPlayers)) {
    const incomingPlayers = req.body.pendingPlayers;
    const existingSubOrders = await Order.find({
      $or: [
        { parentOrder: order._id },
        { parentOrderId: order.orderId },
        { additionalPlayers: `Pending player payment for order ${order.orderId}` }
      ],
      isActive: true
    }).populate('customer');

    const updatedPendingPlayersList = [];
    const processedSubOrderIds = new Set();

    for (const p of incomingPlayers) {
      const playerMobile = String(p.mobile || p.mobileNumber || p.phone || '').replace(/\D/g, '').slice(0, 10);
      const playerAmount = parseCurrencyValue(p.amount || p.pendingAmount) || 0;
      const playerName = (p.name || p.playerName || '').trim() || `Player (${playerMobile})`;
      const targetId = p.id || p._id;

      if (playerMobile.length === 10 && playerAmount > 0) {
        let matchedSub = targetId ? existingSubOrders.find(so => so._id.toString() === targetId.toString()) : null;

        if (matchedSub) {
          processedSubOrderIds.add(matchedSub._id.toString());
          matchedSub.billAmount = playerAmount;
          matchedSub.pendingPaymentAmount = playerAmount;
          matchedSub.menuCategoryId = req.body.menuCategoryId || order.menuCategoryId;
          matchedSub.menuItemId = req.body.menuItemId || order.menuItemId;
          matchedSub.branch = req.body.branch || order.branch;
          await matchedSub.save();

          if (matchedSub.customer) {
            const pc = await Customer.findById(matchedSub.customer);
            if (pc) {
              pc.name = playerName;
              pc.phone = playerMobile;
              await pc.save();
            }
          }

          updatedPendingPlayersList.push({
            id: matchedSub._id.toString(),
            playerName,
            name: playerName,
            mobileNumber: playerMobile,
            mobile: playerMobile,
            pendingAmount: playerAmount,
            amount: playerAmount,
            orderId: matchedSub.orderId,
            customerId: matchedSub.customer ? (matchedSub.customer._id || matchedSub.customer).toString() : '',
          });
        } else {
          // Create new pending player sub-order
          let playerCustomer = await Customer.findOne({ phone: playerMobile, isActive: true });
          if (!playerCustomer) {
            const playerCustId = await generateCustomerId(req.body.branch || order.branch);
            playerCustomer = await Customer.create({
              customerId: playerCustId,
              name: playerName,
              phone: playerMobile,
              branch: req.body.branch || order.branch,
            });
          } else if (playerName && (playerCustomer.name.startsWith('Player (') || !playerCustomer.name)) {
            playerCustomer.name = playerName;
            await playerCustomer.save();
          }

          const pOrderId = `${order.orderId}-P${updatedPendingPlayersList.length + 1}`;
          const playerOrder = await Order.create({
            orderId: pOrderId,
            customer: playerCustomer._id,
            parentOrder: order._id,
            parentOrderId: order.orderId,
            branch: req.body.branch || order.branch,
            menuCategoryId: req.body.menuCategoryId || order.menuCategoryId,
            menuItemId: req.body.menuItemId || order.menuItemId,
            table: req.body.tableId || req.body.table || order.table,
            session: req.body.sessionId || req.body.session || order.session,
            startTime: req.body.startTime || order.startTime,
            endTime: req.body.endTime || order.endTime,
            paymentStatus: 'unpaid',
            paymentMethod: null,
            cashAmount: 0,
            onlineAmount: 0,
            walletAmount: 0,
            pendingPaymentAmount: playerAmount,
            amountReceived: 0,
            totalPaid: 0,
            billAmount: playerAmount,
            additionalPlayers: `Pending player payment for order ${order.orderId}`,
            createdBy: req.user._id,
          });

          updatedPendingPlayersList.push({
            id: playerOrder._id.toString(),
            playerName,
            name: playerName,
            mobileNumber: playerMobile,
            mobile: playerMobile,
            pendingAmount: playerAmount,
            amount: playerAmount,
            orderId: pOrderId,
            customerId: playerCustomer._id.toString(),
          });
        }
      }
    }

    // Soft delete removed pending player sub-orders
    for (const existingSub of existingSubOrders) {
      if (!processedSubOrderIds.has(existingSub._id.toString())) {
        existingSub.isActive = false;
        await existingSub.save();
      }
    }

    order.pendingPlayers = updatedPendingPlayersList;
    await order.save();
  }

  // Populate the order directly on the mongoose document to avoid redundant find query
  const populatedOrderDoc = await order.populate([
    { path: 'customer', select: 'name phone email customerId' },
    { path: 'menuCategoryId', select: 'name status' },
    { path: 'menuItemId', select: 'name price status' },
    { path: 'branch', select: 'name code' }
  ]);
  
  const populatedOrder = populatedOrderDoc.toObject();

  // Transform to match expected structure with enriched pendingPlayers
  const responseData = await enrichOrderWithPendingPlayers(populatedOrder);

  res.status(200).json({ success: true, data: { customer: responseData } });
});

// POST /api/customers/:id/receive-payment - Receive additional payment for an existing order
exports.receivePayment = asyncHandler(async (req, res, next) => {
  const order = await Order.findById(req.params.id);
  if (!order) return next(new AppError('Order not found.', 404));
  
  if (req.user.role !== ROLES.SUPER_ADMIN && req.user.role !== ROLES.ADMIN) {
    const userBranchIds = (req.user.branches || []).map(b => (b._id || b).toString());
    if (!userBranchIds.includes(order.branch?.toString())) {
      return next(new AppError('You do not have access to this branch\'s data.', 403));
    }
  }
  
  const customer = await Customer.findById(order.customer);
  if (!customer) return next(new AppError('Customer not found.', 404));
  
  // Normalize currency values
  const cashAmount = parseCurrencyValue(req.body.cashAmount) || 0;
  const onlineAmount = parseCurrencyValue(req.body.onlineAmount) || 0;
  const walletAmount = parseCurrencyValue(req.body.walletAmount) || 0;
  const paymentMethod = req.body.paymentMethod || order.paymentMethod;
  
  // Calculate today's payment
  const todayPayment = cashAmount + onlineAmount + walletAmount;
  
  // Calculate new totals
  const previousTotalPaid = order.totalPaid || 0;
  const newTotalPaid = previousTotalPaid + todayPayment;
  const billAmount = order.billAmount;
  const newPendingAmount = Math.max(0, billAmount - newTotalPaid);
  
  // Determine new payment status
  let newPaymentStatus = order.paymentStatus;
  if (newTotalPaid === 0) {
    newPaymentStatus = 'unpaid';
  } else if (newTotalPaid >= billAmount) {
    newPaymentStatus = 'paid';
  } else {
    newPaymentStatus = 'partial';
  }
  
  // Validate wallet balance if using wallet
  if (walletAmount > 0) {
    await syncCustomerWalletBalance(customer);
    if (customer.walletBalance < walletAmount) {
      return next(new AppError(`Insufficient wallet balance. Available: ₹${customer.walletBalance}, Required: ₹${walletAmount}`, 400));
    }
  }
  
  // Get the next payment number for this order
  const lastPaymentHistory = await PaymentHistory.findOne({ order: order._id })
    .sort('-paymentNumber')
    .lean();
  const nextPaymentNumber = (lastPaymentHistory?.paymentNumber || 0) + 1;
  
  // Update order with new payment information
  const updatedOrder = await Order.findByIdAndUpdate(
    order._id,
    {
      cashAmount: order.cashAmount + cashAmount,
      onlineAmount: order.onlineAmount + onlineAmount,
      walletAmount: order.walletAmount + walletAmount,
      totalPaid: newTotalPaid,
      pendingPaymentAmount: newPendingAmount,
      paymentStatus: newPaymentStatus,
      ...(paymentMethod && { paymentMethod }),
    },
    { new: true }
  );
  
  // Create payment history record
  await PaymentHistory.create({
    order: order._id,
    orderId: order.orderId,
    customer: customer._id,
    customerName: customer.name,
    customerPhone: customer.phone,
    branch: order.branch,
    paymentMethod: paymentMethod,
    cashAmount,
    onlineAmount,
    walletAmount,
    totalPaid: todayPayment,
    billAmount,
    pendingAmount: newPendingAmount,
    paymentStatus: newPaymentStatus,
    notes: req.body.notes || '',
    createdBy: req.user._id,
    paymentNumber: nextPaymentNumber,
  });
  
  // Handle wallet debit
  if (walletAmount > 0) {
    customer.walletBalance -= walletAmount;
    
    // Add wallet transaction to customer
    customer.walletTransactions.push({
      type: 'debit',
      amount: walletAmount,
      balance: customer.walletBalance,
      orderId: order.orderId,
      billAmount,
      paymentMethod: paymentMethod,
      description: `Additional payment for order ${order.orderId}`,
      createdBy: req.user._id,
    });
    
    // Create separate wallet transaction record
    await WalletTransaction.create({
      customer: customer._id,
      customerName: customer.name,
      customerPhone: customer.phone,
      order: order._id,
      orderId: order.orderId,
      branch: order.branch,
      type: 'debit',
      amount: walletAmount,
      balance: customer.walletBalance,
      billAmount,
      walletAmountUsed: walletAmount,
      paymentMethod: paymentMethod,
      description: `Additional payment for order ${order.orderId}`,
      createdBy: req.user._id,
    });
  }
  
  // Update customer outstanding balance
  const previousPending = order.pendingPaymentAmount || 0;
  if (newPendingAmount < previousPending) {
    customer.outstandingBalance = Math.max(0, (customer.outstandingBalance || 0) - (previousPending - newPendingAmount));
  }
  
  await customer.save();
  
  // Populate and return the updated order
  const populatedOrder = await Order.findById(updatedOrder._id)
    .populate('customer', 'name phone email customerId walletBalance')
    .populate('menuCategoryId', 'name status')
    .populate('menuItemId', 'name price availability status')
    .populate('branch', 'name code')
    .lean();
  
  // Transform to match expected structure
  const responseData = {
    ...populatedOrder,
    name: populatedOrder.customer?.name,
    phone: populatedOrder.customer?.phone,
    email: populatedOrder.customer?.email,
    customerId: populatedOrder.customer?.customerId,
    walletBalance: customer.walletBalance || 0,
  };
  
  res.status(200).json({ success: true, data: { customer: responseData } });
});

// GET /api/customers/:id/payment-history - Get payment history for an order
exports.getPaymentHistory = asyncHandler(async (req, res, next) => {
  const order = await Order.findById(req.params.id);
  if (!order) return next(new AppError('Order not found.', 404));
  
  if (req.user.role !== ROLES.SUPER_ADMIN && req.user.role !== ROLES.ADMIN) {
    const userBranchIds = (req.user.branches || []).map(b => (b._id || b).toString());
    if (!userBranchIds.includes(order.branch?.toString())) {
      return next(new AppError('You do not have access to this branch\'s data.', 403));
    }
  }
  
  const paymentHistory = await PaymentHistory.find({ order: order._id })
    .populate('createdBy', 'name')
    .sort('paymentNumber')
    .lean();
  
  res.status(200).json({ success: true, data: { paymentHistory } });
});

// DELETE /api/customers/:id (soft delete)
exports.deleteCustomer = asyncHandler(async (req, res, next) => {
  const order = await Order.findById(req.params.id);
  if (!order) return next(new AppError('Order not found.', 404));

  if (req.user.role !== ROLES.SUPER_ADMIN && req.user.role !== ROLES.ADMIN) {
    const userBranchIds = (req.user.branches || []).map(b => (b._id || b).toString());
    if (!userBranchIds.includes(order.branch?.toString())) {
      return next(new AppError('You do not have access to this branch\'s data.', 403));
    }
  }

  // Restore stock if menu item is linked to inventory
  const menuItem = await MenuItem.findById(order.menuItemId).populate('inventoryItem');
  if (menuItem && menuItem.inventoryItem) {
    const inventoryItem = await Inventory.findById(menuItem.inventoryItem._id);
    if (inventoryItem) {
      const previousStock = inventoryItem.currentStock;
      inventoryItem.currentStock += 1;
      await inventoryItem.save();

      // Create stock transaction record for refund
      await StockTransaction.create({
        inventoryItem: inventoryItem._id,
        customer: order.customer,
        order: order._id,
        quantity: 1,
        type: 'refund',
        previousStock,
        newStock: inventoryItem.currentStock,
        branch: inventoryItem.branch,
        notes: `Restored from order deletion`,
        createdBy: req.user._id,
      });
    }
  }

  // Update customer total spending
  const customer = await Customer.findById(order.customer);
  if (customer) {
    customer.totalSpending -= order.billAmount;
    customer.visits -= 1;
    await customer.save();
  }

  await Order.findByIdAndUpdate(req.params.id, { isActive: false }, { new: true });
  res.status(200).json({ success: true, message: 'Order removed.' });
});

// GET /api/customers/super-admin
exports.getSuperAdminCustomers = asyncHandler(async (req, res, next) => {
  const isSuperAdmin = req.user.role === ROLES.SUPER_ADMIN;
  const isBranchAdmin = req.user.role === ROLES.BRANCH_ADMIN;

  if (!isSuperAdmin && !isBranchAdmin) {
    return next(new AppError('Access denied.', 403));
  }

  // Branch Admin can only see their own assigned branches
  const userBranchIds = (req.user.branches || []).map((b) => (b._id || b).toString());

  const filter = { isActive: true };
  if (req.query.branch) {
    // For Branch Admin: make sure requested branch is in their allowed list
    if (isBranchAdmin && !userBranchIds.includes(req.query.branch.toString())) {
      return next(new AppError('Access denied to this branch.', 403));
    }
    filter.branch = req.query.branch;
  } else if (isBranchAdmin) {
    // Branch Admin with no branch filter: restrict to their branches only
    filter.branch = { $in: userBranchIds };
  }

  if (req.query.search) {
    const searchRegex = new RegExp(req.query.search.trim(), 'i');
    filter.$or = [
      { name: searchRegex },
      { phone: searchRegex },
      { email: searchRegex },
      { customerId: searchRegex },
    ];
  }

  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 25;
  const skip = (page - 1) * limit;

  const sortBy = req.query.sortBy || 'createdAt';
  const sortOrder = req.query.sortOrder === 'asc' ? 1 : -1;
  const sort = { [sortBy]: sortOrder };

  const [customerDocs, total] = await Promise.all([
    Customer.find(filter)
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .populate('branch', 'name code')
      .lean(),
    Customer.countDocuments(filter),
  ]);

  // For each customer, determine sourceModule dynamically if not set
  const customers = await Promise.all(
    customerDocs.map(async (cust) => {
      let sourceModule = cust.sourceModule;
      if (!sourceModule || sourceModule === 'Customer') {
        const branchId = cust.branch?._id || cust.branch;
        const [firstRes, firstSession, firstBill, firstOrder] = await Promise.all([
          Reservation.findOne({ branch: branchId, phoneNumber: cust.phone }).select('createdAt').sort({ createdAt: 1 }).lean(),
          Session.findOne({ branch: branchId, $or: [{ customer: cust._id }, { phoneNumber: cust.phone }] }).select('createdAt').sort({ createdAt: 1 }).lean(),
          Bill.findOne({ branch: branchId, $or: [{ customer: cust._id }, { customerPhone: cust.phone }] }).select('createdAt').sort({ createdAt: 1 }).lean(),
          Order.findOne({ branch: branchId, customer: cust._id }).select('createdAt paymentStatus additionalPlayers').sort({ createdAt: 1 }).lean(),
        ]);

        const candidates = [];
        if (firstRes) candidates.push({ module: 'Booking', date: new Date(firstRes.createdAt) });
        if (firstSession) candidates.push({ module: 'Live Tables', date: new Date(firstSession.createdAt) });
        if (firstBill) candidates.push({ module: 'Billing', date: new Date(firstBill.createdAt) });
        if (firstOrder) {
          const mod = (firstOrder.paymentStatus === 'unpaid' || firstOrder.paymentStatus === 'partial' || (firstOrder.additionalPlayers && firstOrder.additionalPlayers.includes('Pending')))
            ? 'Pending Payments'
            : 'Customer';
          candidates.push({ module: mod, date: new Date(firstOrder.createdAt) });
        }

        if (candidates.length > 0) {
          candidates.sort((a, b) => a.date - b.date);
          sourceModule = candidates[0].module;
        } else {
          sourceModule = 'Customer';
        }
      }

      return {
        ...cust,
        sourceModule,
      };
    })
  );

  res.status(200).json({
    success: true,
    results: customers.length,
    total,
    filtered: total,
    page,
    pages: Math.ceil(total / limit),
    limit,
    data: { customers },
  });
});

// PATCH /api/customers/super-admin/:id
exports.updateSuperAdminCustomer = asyncHandler(async (req, res, next) => {
  const isSuperAdmin = req.user.role === ROLES.SUPER_ADMIN;
  const isBranchAdmin = req.user.role === ROLES.BRANCH_ADMIN;

  if (!isSuperAdmin && !isBranchAdmin) {
    return next(new AppError('Access denied.', 403));
  }

  const { id } = req.params;
  const { name, phone, email, address } = req.body;

  if (!name || typeof name !== 'string' || name.trim() === '') {
    return next(new AppError('Customer Name is required.', 400));
  }

  if (!phone || typeof phone !== 'string') {
    return next(new AppError('Mobile Number is required.', 400));
  }

  const cleanedPhone = phone.trim().replace(/\D/g, '');
  if (!/^\d{10}$/.test(cleanedPhone)) {
    return next(new AppError('Mobile Number must contain exactly 10 numeric digits.', 400));
  }

  const newName = name.trim();
  const customer = await Customer.findById(id);
  if (!customer || !customer.isActive) {
    return next(new AppError('Customer not found.', 404));
  }

  // Branch Admin can only edit customers in their own branches
  if (isBranchAdmin) {
    const userBranchIds = (req.user.branches || []).map((b) => (b._id || b).toString());
    const custBranchId = (customer.branch?._id || customer.branch).toString();
    if (!userBranchIds.includes(custBranchId)) {
      return next(new AppError('Access denied: customer does not belong to your branch.', 403));
    }
  }

  const branchId = customer.branch; // Target branch only!
  const oldPhone = customer.phone;
  const oldName = customer.name;

  // Check phone uniqueness within the target branch only!
  if (cleanedPhone !== oldPhone) {
    const existingInBranch = await Customer.findOne({
      branch: branchId,
      phone: cleanedPhone,
      _id: { $ne: id },
      isActive: true,
    });

    if (existingInBranch) {
      return next(new AppError('Mobile number already exists in this branch.', 400));
    }
  }

  // Perform synchronized updates across all modules STRICTLY scoped to branchId!
  const targetIdStr = id.toString();
  const updatePromises = [];

  // 1. Update Customer doc
  customer.name = newName;
  customer.phone = cleanedPhone;
  if (email !== undefined) customer.email = email;
  if (address !== undefined) customer.address = address;
  updatePromises.push(customer.save());

  // 2. Update Bill collection (in this branch only)
  updatePromises.push(
    Bill.updateMany(
      { branch: branchId, $or: [{ customer: id }, { customerPhone: oldPhone }] },
      { $set: { customerName: newName, customerPhone: cleanedPhone } }
    )
  );

  // Update pendingPlayers in Bill (in this branch only)
  updatePromises.push(
    Bill.updateMany(
      {
        branch: branchId,
        $or: [
          { 'pendingPlayers.id': targetIdStr },
          { 'pendingPlayers.customerId': targetIdStr },
          { 'pendingPlayers.mobileNumber': oldPhone },
          { 'pendingPlayers.mobile': oldPhone },
        ],
      },
      {
        $set: {
          'pendingPlayers.$[elem].playerName': newName,
          'pendingPlayers.$[elem].name': newName,
          'pendingPlayers.$[elem].mobileNumber': cleanedPhone,
          'pendingPlayers.$[elem].mobile': cleanedPhone,
        },
      },
      {
        arrayFilters: [
          {
            $or: [
              { 'elem.id': targetIdStr },
              { 'elem.customerId': targetIdStr },
              { 'elem.mobileNumber': oldPhone },
              { 'elem.mobile': oldPhone },
            ],
          },
        ],
      }
    )
  );

  // 3. Update Reservation collection (in this branch only)
  updatePromises.push(
    Reservation.updateMany(
      { branch: branchId, $or: [{ phoneNumber: oldPhone }, { customerName: oldName }] },
      { $set: { customerName: newName, phoneNumber: cleanedPhone } }
    )
  );

  // Update pendingPlayers in Reservation (in this branch only)
  updatePromises.push(
    Reservation.updateMany(
      {
        branch: branchId,
        $or: [
          { 'pendingPlayers.mobileNumber': oldPhone },
          { 'pendingPlayers.mobile': oldPhone },
        ],
      },
      {
        $set: {
          'pendingPlayers.$[elem].playerName': newName,
          'pendingPlayers.$[elem].name': newName,
          'pendingPlayers.$[elem].mobileNumber': cleanedPhone,
          'pendingPlayers.$[elem].mobile': cleanedPhone,
        },
      },
      {
        arrayFilters: [
          {
            $or: [
              { 'elem.mobileNumber': oldPhone },
              { 'elem.mobile': oldPhone },
            ],
          },
        ],
      }
    )
  );

  // 4. Update Session collection (in this branch only)
  updatePromises.push(
    Session.updateMany(
      { branch: branchId, $or: [{ customer: id }, { phoneNumber: oldPhone }] },
      { $set: { customerName: newName, phoneNumber: cleanedPhone } }
    )
  );

  // 5. Update Order collection (in this branch only)
  updatePromises.push(
    Order.updateMany(
      {
        branch: branchId,
        $or: [
          { 'pendingPlayers.id': targetIdStr },
          { 'pendingPlayers.customerId': targetIdStr },
          { 'pendingPlayers.mobileNumber': oldPhone },
          { 'pendingPlayers.mobile': oldPhone },
        ],
      },
      {
        $set: {
          'pendingPlayers.$[elem].playerName': newName,
          'pendingPlayers.$[elem].name': newName,
          'pendingPlayers.$[elem].mobileNumber': cleanedPhone,
          'pendingPlayers.$[elem].mobile': cleanedPhone,
        },
      },
      {
        arrayFilters: [
          {
            $or: [
              { 'elem.id': targetIdStr },
              { 'elem.customerId': targetIdStr },
              { 'elem.mobileNumber': oldPhone },
              { 'elem.mobile': oldPhone },
            ],
          },
        ],
      }
    )
  );

  // 6. Update PaymentHistory collection (in this branch only)
  updatePromises.push(
    PaymentHistory.updateMany(
      { branch: branchId, $or: [{ customer: id }, { customerPhone: oldPhone }] },
      { $set: { customerName: newName, customerPhone: cleanedPhone } }
    )
  );

  // 7. Update Wallet collection (in this branch only)
  updatePromises.push(
    Wallet.updateMany(
      { branch: branchId, mobileNumber: oldPhone },
      { $set: { name: newName, mobileNumber: cleanedPhone } }
    )
  );

  // 8. Update WalletTransaction collection (in this branch only)
  updatePromises.push(
    WalletTransaction.updateMany(
      { branch: branchId, $or: [{ customer: id }, { customerPhone: oldPhone }] },
      { $set: { customerName: newName, customerPhone: cleanedPhone } }
    )
  );

  await Promise.all(updatePromises);

  // Log activity
  try {
    const { logActivity } = require('../services/activityLogService');
    await logActivity({
      userId: req.user._id,
      branchId,
      action: 'customer.super_admin_update',
      entity: 'Customer',
      entityId: id,
      description: `${req.user.name} (Super Admin) updated customer ${oldName} (${oldPhone}) -> ${newName} (${cleanedPhone}) in branch ${branchId}`,
      ipAddress: req.ip,
    });
  } catch (err) {
    console.error('Error logging super admin customer update:', err);
  }

  const updatedCustomer = await Customer.findById(id).populate('branch', 'name code').lean();
  res.status(200).json({
    success: true,
    message: 'Customer information updated and synchronized across all modules for this branch.',
    data: { customer: updatedCustomer },
  });
});

// POST /api/customers/super-admin — Super Admin creates a customer for any branch
exports.createSuperAdminCustomer = asyncHandler(async (req, res, next) => {
  const isSuperAdmin = req.user.role === ROLES.SUPER_ADMIN;
  const isBranchAdmin = req.user.role === ROLES.BRANCH_ADMIN;

  if (!isSuperAdmin && !isBranchAdmin) {
    return next(new AppError('Access denied.', 403));
  }

  const { name, phone, email, address, branch } = req.body;

  // Branch Admin can only create customers for their own branches
  if (isBranchAdmin) {
    const userBranchIds = (req.user.branches || []).map((b) => (b._id || b).toString());
    if (!userBranchIds.includes(branch.toString())) {
      return next(new AppError('Access denied: you can only create customers for your own branch.', 403));
    }
  }

  const existing = await Customer.findOne({ branch, phone });
  if (existing) {
    return next(new AppError('A customer with this phone number already exists in this branch.', 400));
  }

  const customerId = await generateCustomerId(branch);

  const customer = await Customer.create({
    customerId,
    name,
    phone,
    email: email || undefined,
    address: address || '',
    branch,
    sourceModule: 'Customer',
  });

  const populated = await Customer.findById(customer._id).populate('branch', 'name code').lean();

  res.status(201).json({
    success: true,
    message: 'Customer created successfully.',
    data: { customer: populated },
  });
});

exports.generateOrderId = generateOrderId;
exports.generateCustomerId = generateCustomerId;
exports.parseCurrencyValue = parseCurrencyValue;
