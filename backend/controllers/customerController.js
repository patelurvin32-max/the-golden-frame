const Customer = require('../models/Customer');
const OrderCounter = require('../models/OrderCounter');
const { Inventory, MenuItem, StockTransaction } = require('../models/Operations');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { ROLES } = require('../config/constants');
const { createBranchNotification } = require('../services/notificationService');

const parseCurrencyValue = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.round(num * 100) / 100;
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

// GET /api/customers?search=&branch=&page=&limit=&sortBy=&sortOrder=
exports.getCustomers = asyncHandler(async (req, res) => {
  const filter = { isActive: true };
  if (req.user.role !== ROLES.SUPER_ADMIN) filter.branch = { $in: req.user.branches };
  if (req.query.branch) filter.branch = req.query.branch;
  
  // Server-side search by name, phone, or email
  if (req.query.search) {
    const searchRegex = new RegExp(req.query.search, 'i');
    filter.$or = [
      { name: searchRegex },
      { phone: searchRegex },
      { email: searchRegex },
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

  const [customers, total] = await Promise.all([
    Customer.find(filter)
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .populate('menuCategoryId', 'name status')
      .populate('menuItemId', 'name price availability status')
      .populate('branch', 'name code')
      .lean(), // Use lean() for faster queries
    Customer.countDocuments(filter),
  ]);

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
  const customer = await Customer.findById(req.params.id)
    .populate('menuCategoryId', 'name status')
    .populate('menuItemId', 'name price availability status')
    .populate('branch', 'name code')
    .lean(); // Use lean() for faster queries
  if (!customer) return next(new AppError('Customer not found.', 404));
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
    .populate('menuCategoryId', 'name status')
    .populate('menuItemId', 'name price availability status')
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

  // Validate mixed payment amounts
  if (req.body.paymentMethod === 'mixed') {
    const cashAmount = parseCurrencyValue(req.body.cashAmount) || 0;
    const onlineAmount = parseCurrencyValue(req.body.onlineAmount) || 0;
    const totalPaid = Math.round((cashAmount + onlineAmount) * 100) / 100;
    const totalBill = parseCurrencyValue(req.body.billAmount) || 0;

    if (totalPaid !== totalBill) {
      return next(new AppError(`Cash Amount + Online Amount must equal the total bill amount (${totalBill})`, 400));
    }
  }

  // Validate stock if menu item is linked to inventory
  const menuItem = await MenuItem.findById(req.body.menuItemId).populate('inventoryItem');
  if (menuItem && menuItem.inventoryItem) {
    const inventoryItem = await Inventory.findById(menuItem.inventoryItem._id);
    if (inventoryItem && inventoryItem.currentStock < 1) {
      return next(new AppError(`Insufficient stock. Only ${inventoryItem.currentStock} items available.`, 400));
    }
  }
  
  // Check if customer with this phone number already exists in the same branch
  const existingCustomer = await Customer.findOne({ 
    phone: req.body.phone, 
    branch: req.body.branch,
    isActive: true 
  });
  
  if (existingCustomer) {
    // Return existing customer instead of creating duplicate in same branch
    return res.status(200).json({ 
      success: true, 
      message: 'Existing customer found. Customer details have been loaded.',
      data: { customer: existingCustomer }
    });
  }
  
  // Normalize currency values for storage
  req.body.billAmount = parseCurrencyValue(req.body.billAmount);
  req.body.cashAmount = parseCurrencyValue(req.body.cashAmount) || 0;
  req.body.onlineAmount = parseCurrencyValue(req.body.onlineAmount) || 0;
  req.body.totalPaid = Math.round((req.body.cashAmount + req.body.onlineAmount) * 100) / 100;

  // Generate custom Order ID for new customer
  const orderId = await generateOrderId();
  req.body.orderId = orderId;
  
  const customer = await Customer.create(req.body);

  // Create customer notification for Super Admin and branch manager when created by staff/branch manager
  await createBranchNotification({
    branchId: customer.branch,
    actor: req.user,
    title: 'New Customer Created',
    message: `${req.user.name} created a new customer (${customer.name}) in branch ${customer.branch}.`,
    superAdminOnly: req.user.role === ROLES.SUPER_ADMIN,
  });

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

  res.status(201).json({ success: true, data: { customer } });
});

// PATCH /api/customers/:id
exports.updateCustomer = asyncHandler(async (req, res, next) => {
  // Get the existing customer to check if menuItemId is changing
  const existingCustomer = await Customer.findById(req.params.id);
  if (!existingCustomer) return next(new AppError('Customer not found.', 404));

  // Validate mixed payment amounts if payment method is mixed
  if (req.body.paymentMethod === 'mixed') {
    const cashAmount = parseCurrencyValue(req.body.cashAmount) || 0;
    const onlineAmount = parseCurrencyValue(req.body.onlineAmount) || 0;
    const totalPaid = Math.round((cashAmount + onlineAmount) * 100) / 100;
    const totalBill = parseCurrencyValue(req.body.billAmount) || 0;

    if (totalPaid !== totalBill) {
      return next(new AppError(`Cash Amount + Online Amount must equal the total bill amount (${totalBill})`, 400));
    }
  }

  // Handle stock restoration and deduction if menuItemId is changing
  if (req.body.menuItemId && req.body.menuItemId !== existingCustomer.menuItemId.toString()) {
    // Restore stock for previous menu item
    const previousMenuItem = await MenuItem.findById(existingCustomer.menuItemId).populate('inventoryItem');
    if (previousMenuItem && previousMenuItem.inventoryItem) {
      const previousInventoryItem = await Inventory.findById(previousMenuItem.inventoryItem._id);
      if (previousInventoryItem) {
        const previousStock = previousInventoryItem.currentStock;
        previousInventoryItem.currentStock += 1;
        await previousInventoryItem.save();

        // Create stock transaction record for refund
        await StockTransaction.create({
          inventoryItem: previousInventoryItem._id,
          customer: existingCustomer._id,
          quantity: 1,
          type: 'refund',
          previousStock,
          newStock: previousInventoryItem.currentStock,
          branch: previousInventoryItem.branch,
          notes: `Restored from customer order update`,
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
          customer: existingCustomer._id,
          quantity: 1,
          type: 'sale',
          previousStock,
          newStock: newInventoryItem.currentStock,
          branch: newInventoryItem.branch,
          notes: `Sold to customer ${existingCustomer.name} (order update)`,
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
    req.body.totalPaid = Math.round(((req.body.cashAmount || 0) + (req.body.onlineAmount || 0)) * 100) / 100;
  }

  const customer = await Customer.findByIdAndUpdate(req.params.id, req.body, {
    new: true,
    runValidators: true,
  });
  if (!customer) return next(new AppError('Customer not found.', 404));
  res.status(200).json({ success: true, data: { customer } });
});

// DELETE /api/customers/:id (soft delete)
exports.deleteCustomer = asyncHandler(async (req, res, next) => {
  const customer = await Customer.findById(req.params.id);
  if (!customer) return next(new AppError('Customer not found.', 404));

  // Restore stock if menu item is linked to inventory
  const menuItem = await MenuItem.findById(customer.menuItemId).populate('inventoryItem');
  if (menuItem && menuItem.inventoryItem) {
    const inventoryItem = await Inventory.findById(menuItem.inventoryItem._id);
    if (inventoryItem) {
      const previousStock = inventoryItem.currentStock;
      inventoryItem.currentStock += 1;
      await inventoryItem.save();

      // Create stock transaction record for refund
      await StockTransaction.create({
        inventoryItem: inventoryItem._id,
        customer: customer._id,
        quantity: 1,
        type: 'refund',
        previousStock,
        newStock: inventoryItem.currentStock,
        branch: inventoryItem.branch,
        notes: `Restored from customer deletion`,
        createdBy: req.user._id,
      });
    }
  }

  await Customer.findByIdAndUpdate(req.params.id, { isActive: false }, { new: true });
  res.status(200).json({ success: true, message: 'Customer removed.' });
});
