const Customer = require('../models/Customer');
const Order = require('../models/Order');
const OrderCounter = require('../models/OrderCounter');
const WalletTransaction = require('../models/WalletTransaction');
const PaymentHistory = require('../models/PaymentHistory');
const { Inventory, MenuItem, StockTransaction } = require('../models/Operations');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { ROLES } = require('../config/constants');
const { createBranchNotification } = require('../services/notificationService');

const parseCurrencyValue = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  // Return exact value without any rounding - preserve user input
  return num;
};

const { getBusinessDayDateString } = require('../utils/businessDay');

// Helper function to generate custom Order ID with thread-safety using atomic counter
const generateOrderId = async (date = new Date()) => {
  const dateStr = getBusinessDayDateString(date);

  // Use findOneAndUpdate with atomic increment to prevent race conditions
  const counter = await OrderCounter.findOneAndUpdate(
    { date: dateStr },
    { $inc: { sequence: 1 } },
    { new: true, upsert: true }
  );

  const sequence = counter.sequence;
  const sequenceStr = String(sequence).padStart(4, '0');
  return `${dateStr}/${sequenceStr}`;
};

// Helper function to generate Customer ID
const generateCustomerId = async () => {
  const count = await Customer.countDocuments();
  const sequenceStr = String(count + 1).padStart(6, '0');
  return `CUST${sequenceStr}`;
};

// GET /api/customers?search=&branch=&page=&limit=&sortBy=&sortOrder=
exports.getCustomers = asyncHandler(async (req, res) => {
  const filter = { isActive: true };
  if (req.user.role !== ROLES.SUPER_ADMIN) filter.branch = { $in: req.user.branches };
  if (req.query.branch) filter.branch = req.query.branch;
  
  // Server-side search by customer name, phone, or email
  if (req.query.search) {
    const searchRegex = new RegExp(req.query.search, 'i');
    filter.$or = [
      { 'customer.name': searchRegex },
      { 'customer.phone': searchRegex },
      { 'customer.email': searchRegex },
      { orderId: searchRegex },
    ];
  }

  // Filter by menu category if provided
  if (req.query.menuCategoryId) filter.menuCategoryId = req.query.menuCategoryId;
  
  // Filter by payment status if provided
  if (req.query.paymentStatus) filter.paymentStatus = req.query.paymentStatus;

  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 25;
  const skip = (page - 1) * limit;

  // Sorting
  const sortBy = req.query.sortBy || 'createdAt';
  const sortOrder = req.query.sortOrder === 'asc' ? 1 : -1;
  const sort = { [sortBy]: sortOrder };

  const [orders, total] = await Promise.all([
    Order.find(filter)
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .populate('customer', 'name phone email customerId walletBalance')
      .populate('menuCategoryId', 'name status')
      .populate('menuItemId', 'name price availability status')
      .populate('branch', 'name code')
      .lean(), // Use lean() for faster queries
    Order.countDocuments(filter),
  ]);

  // Transform orders to match the expected customer structure for frontend compatibility
  const customers = orders.map(order => ({
    ...order,
    name: order.customer?.name,
    phone: order.customer?.phone,
    email: order.customer?.email,
    customerId: order.customer?.customerId,
    walletBalance: order.customer?.walletBalance || 0,
  }));

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

// GET /api/customers/:id
exports.getCustomer = asyncHandler(async (req, res, next) => {
  const order = await Order.findById(req.params.id)
    .populate('customer', 'name phone email customerId walletBalance')
    .populate('menuCategoryId', 'name status')
    .populate('menuItemId', 'name price availability status')
    .populate('branch', 'name code')
    .lean(); // Use lean() for faster queries
  if (!order) return next(new AppError('Order not found.', 404));
  
  // Transform to match expected structure
  const customer = {
    ...order,
    name: order.customer?.name,
    phone: order.customer?.phone,
    email: order.customer?.email,
    customerId: order.customer?.customerId,
    walletBalance: order.customer?.walletBalance || 0,
  };
  
  res.status(200).json({ success: true, data: { customer } });
});

// GET /api/customers/lookup/:phone
exports.lookupCustomer = asyncHandler(async (req, res) => {
  const { phone } = req.params;
  // Phone is now globally unique, search without branch filter
  const customer = await Customer.findOne({
    phone,
    isActive: true,
  })
    .select('customerId name phone email branch walletBalance')
    .populate('branch', 'name code')
    .lean(); // Use lean() for faster queries

  if (!customer) {
    return res.status(200).json({ success: true, data: { customer: null } });
  }

  res.status(200).json({ success: true, data: { customer } });
});

// POST /api/customers
exports.createCustomer = asyncHandler(async (req, res, next) => {
  // Auto-assign branch from user if not provided (for Branch Manager/Staff)
  if (!req.body.branch && req.user.branches && req.user.branches.length > 0) {
    req.body.branch = req.user.branches[0];
  }

  // Normalize currency values
  const billAmount = parseCurrencyValue(req.body.billAmount) || 0;
  let cashAmount = parseCurrencyValue(req.body.cashAmount) || 0;
  let onlineAmount = parseCurrencyValue(req.body.onlineAmount) || 0;
  let walletAmount = parseCurrencyValue(req.body.walletAmount) || 0;
  const amountReceived = parseCurrencyValue(req.body.amountReceived) || 0;
  const paymentStatus = req.body.paymentStatus || 'unpaid';
  const paymentMethod = req.body.paymentMethod || 'cash';
  
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
    // For paid status, total paid must be >= bill amount
    if (roundedTotalPaid < roundedBillAmount) {
      return next(new AppError(`For Paid status, Amount Received must be greater than or equal to the Bill Amount (${roundedBillAmount})`, 400));
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

  // Validate stock if menu item is linked to inventory
  const menuItem = await MenuItem.findById(req.body.menuItemId).populate('inventoryItem');
  if (menuItem && menuItem.inventoryItem) {
    const inventoryItem = await Inventory.findById(menuItem.inventoryItem._id);
    if (inventoryItem && inventoryItem.currentStock < 1) {
      return next(new AppError(`Insufficient stock. Only ${inventoryItem.currentStock} items available.`, 400));
    }
  }
  
  // Check if customer with this phone number already exists (globally)
  let customer = await Customer.findOne({ 
    phone: req.body.phone, 
    isActive: true 
  });
  
  if (!customer) {
    // Create new customer if doesn't exist
    const customerId = await generateCustomerId();
    customer = await Customer.create({
      customerId,
      name: req.body.name,
      phone: req.body.phone,
      email: req.body.email,
      branch: req.body.branch,
      notes: req.body.notes,
      favoriteGame: req.body.favoriteGame,
    });

    // Create customer notification for Super Admin and branch manager when created by staff/branch manager
    await createBranchNotification({
      branchId: customer.branch,
      actor: req.user,
      title: 'New Customer Created',
      message: `${req.user.name} created a new customer (${customer.name}) in branch ${customer.branch}.`,
      superAdminOnly: req.user.role === ROLES.SUPER_ADMIN,
    });
  }
  
  // Validate wallet balance if using wallet
  if (walletAmount > 0) {
    if (customer.walletBalance < walletAmount) {
      return next(new AppError(`Insufficient wallet balance. Available: ₹${customer.walletBalance}, Required: ₹${walletAmount}`, 400));
    }
  }

  // Generate custom Order ID for the new order
  const orderId = await generateOrderId();
  
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
    amountReceived: totalPaid,
    totalPaid,
    billAmount,
    additionalPlayers: req.body.additionalPlayers,
  });
  
  // Create payment history record
  await PaymentHistory.create({
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
  });

  // Handle wallet debit
  if (walletAmount > 0) {
    const previousBalance = customer.walletBalance;
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
    await WalletTransaction.create({
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
    });
  }

  // Handle wallet credit (extra amount received)
  const addToWallet = req.body.addToWallet || false;
  const extraAmount = amountReceived > billAmount ? amountReceived - billAmount : 0;
  
  if (addToWallet && extraAmount > 0) {
    const previousBalance = customer.walletBalance;
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
    await WalletTransaction.create({
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
    });
  }

  // Handle pending payment - update customer outstanding balance
  if (pendingAmount > 0) {
    customer.outstandingBalance = (customer.outstandingBalance || 0) + pendingAmount;
  }

  // Update customer visit count and total spending
  customer.visits += 1;
  customer.totalSpending += billAmount;
  await customer.save();

  // Deduct stock if menu item is linked to inventory
  if (menuItem && menuItem.inventoryItem) {
    const inventoryItem = await Inventory.findById(menuItem.inventoryItem._id);
    if (inventoryItem) {
      const previousStock = inventoryItem.currentStock;
      inventoryItem.currentStock -= 1;
      await inventoryItem.save();

      // Create stock transaction record
      await StockTransaction.create({
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
      });

      // Check for low stock alert
      if (inventoryItem.currentStock <= inventoryItem.minimumStockAlert) {
        const { Notification } = require('../models/System');
        await Notification.create({
          branch: inventoryItem.branch,
          type: 'low_inventory',
          title: 'Low Stock Alert',
          message: `${inventoryItem.name} is running low (${inventoryItem.currentStock} ${inventoryItem.unit} remaining).`,
          targetRoles: ['super_admin', 'branch_manager'],
          meta: { inventoryId: inventoryItem._id.toString() },
        });
      }
    }
  }

  // Populate and return the order with customer details
  const populatedOrder = await Order.findById(order._id)
    .populate('customer', 'name phone email customerId')
    .populate('menuCategoryId', 'name status')
    .populate('menuItemId', 'name price availability status')
    .populate('branch', 'name code')
    .lean();

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
  // Get the existing order to check if menuItemId is changing
  const existingOrder = await Order.findById(req.params.id);
  if (!existingOrder) return next(new AppError('Order not found.', 404));

  // Validate mixed payment amounts if payment method is mixed
  if (req.body.paymentMethod === 'mixed') {
    const cashAmount = parseCurrencyValue(req.body.cashAmount) || 0;
    const onlineAmount = parseCurrencyValue(req.body.onlineAmount) || 0;
    const totalPaid = cashAmount + onlineAmount;
    const totalBill = parseCurrencyValue(req.body.billAmount) || 0;

    if (totalPaid !== totalBill) {
      return next(new AppError(`Cash Amount + Online Amount must equal the total bill amount (${totalBill})`, 400));
    }
  }

  // Handle stock restoration and deduction if menuItemId is changing
  if (req.body.menuItemId && req.body.menuItemId !== existingOrder.menuItemId.toString()) {
    // Restore stock for previous menu item
    const previousMenuItem = await MenuItem.findById(existingOrder.menuItemId).populate('inventoryItem');
    if (previousMenuItem && previousMenuItem.inventoryItem) {
      const previousInventoryItem = await Inventory.findById(previousMenuItem.inventoryItem._id);
      if (previousInventoryItem) {
        const previousStock = previousInventoryItem.currentStock;
        previousInventoryItem.currentStock += 1;
        await previousInventoryItem.save();

        // Create stock transaction record for refund
        await StockTransaction.create({
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
        });
      }
    }

    // Validate and deduct stock for new menu item
    const newMenuItem = await MenuItem.findById(req.body.menuItemId).populate('inventoryItem');
    if (newMenuItem && newMenuItem.inventoryItem) {
      const newInventoryItem = await Inventory.findById(newMenuItem.inventoryItem._id);
      if (newInventoryItem && newInventoryItem.currentStock < 1) {
        return next(new AppError(`Insufficient stock. Only ${newInventoryItem.currentStock} items available.`, 400));
      }

      if (newInventoryItem) {
        const previousStock = newInventoryItem.currentStock;
        newInventoryItem.currentStock -= 1;
        await newInventoryItem.save();

        // Create stock transaction record for sale
        await StockTransaction.create({
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
        });

        // Check for low stock alert
        if (newInventoryItem.currentStock <= newInventoryItem.minimumStockAlert) {
          const { Notification } = require('../models/System');
          await Notification.create({
            branch: newInventoryItem.branch,
            type: 'low_inventory',
            title: 'Low Stock Alert',
            message: `${newInventoryItem.name} is running low (${newInventoryItem.currentStock} ${newInventoryItem.unit} remaining).`,
            targetRoles: ['super_admin', 'branch_manager'],
            meta: { inventoryId: newInventoryItem._id.toString() },
          });
        }
      }
    }
  }

  // Normalize currency values for storage on update
  if (req.body.billAmount !== undefined) {
    req.body.billAmount = parseCurrencyValue(req.body.billAmount);
  }
  if (req.body.cashAmount !== undefined) {
    req.body.cashAmount = parseCurrencyValue(req.body.cashAmount);
  }
  if (req.body.onlineAmount !== undefined) {
    req.body.onlineAmount = parseCurrencyValue(req.body.onlineAmount);
  }
  if (req.body.cashAmount !== undefined || req.body.onlineAmount !== undefined) {
    req.body.totalPaid = (req.body.cashAmount || 0) + (req.body.onlineAmount || 0);
  }

  const order = await Order.findByIdAndUpdate(req.params.id, req.body, {
    new: true,
    runValidators: true,
  });
  if (!order) return next(new AppError('Order not found.', 404));

  // Get the customer to fetch current wallet balance
  const customer = await Customer.findById(order.customer);

  // Handle wallet balance updates for edited orders
  const oldWalletAmount = existingOrder.walletAmount || 0;
  const newWalletAmount = order.walletAmount || 0;
  const walletDifference = newWalletAmount - oldWalletAmount;

  if (walletDifference !== 0) {
    // If wallet amount increased, debit more from wallet
    if (walletDifference > 0) {
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
      await WalletTransaction.create({
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
      });
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
      await WalletTransaction.create({
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
      });
    }
    
    await customer.save();
  }

  // Populate and return the order with customer details
  const populatedOrder = await Order.findById(order._id)
    .populate('customer', 'name phone email customerId')
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
    walletBalance: customer?.walletBalance || 0, // Include current wallet balance
  };

  res.status(200).json({ success: true, data: { customer: responseData } });
});

// POST /api/customers/:id/receive-payment - Receive additional payment for an existing order
exports.receivePayment = asyncHandler(async (req, res, next) => {
  const order = await Order.findById(req.params.id);
  if (!order) return next(new AppError('Order not found.', 404));
  
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
  
  const paymentHistory = await PaymentHistory.find({ order: order._id })
    .populate('createdBy', 'name')
    .sort('paymentNumber');
  
  res.status(200).json({ success: true, data: { paymentHistory } });
});

// DELETE /api/customers/:id (soft delete)
exports.deleteCustomer = asyncHandler(async (req, res, next) => {
  const order = await Order.findById(req.params.id);
  if (!order) return next(new AppError('Order not found.', 404));

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
