const Customer = require('../models/Customer');
const OrderCounter = require('../models/OrderCounter');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { ROLES } = require('../config/constants');

// Helper function to generate custom Order ID with thread-safety using atomic counter
const generateOrderId = async () => {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  const dateStr = `${year}/${month}/${day}`;

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
      .populate('branch', 'name code'),
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
    .populate('branch', 'name code');
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
    .populate('branch', 'name code');

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
    const cashAmount = Number(req.body.cashAmount) || 0;
    const onlineAmount = Number(req.body.onlineAmount) || 0;
    const totalPaid = cashAmount + onlineAmount;

    // Get the menu item price to validate against
    const MenuItem = require('../models/Operations').MenuItem;
    const menuItem = await MenuItem.findById(req.body.menuItemId);
    const totalBill = menuItem?.price || 0;

    if (totalPaid !== totalBill) {
      return next(new AppError(`Cash Amount + Online Amount must equal the total bill amount (${totalBill})`, 400));
    }
  }
  
  // Check if customer with this phone number already exists
  const existingCustomer = await Customer.findOne({ phone: req.body.phone, isActive: true });
  
  if (existingCustomer) {
    // Return existing customer instead of creating duplicate
    return res.status(200).json({ 
      success: true, 
      message: 'Existing customer found. Customer details have been loaded.',
      data: { customer: existingCustomer }
    });
  }
  
  // Generate custom Order ID for new customer
  const orderId = await generateOrderId();
  req.body.orderId = orderId;
  
  const customer = await Customer.create(req.body);
  res.status(201).json({ success: true, data: { customer } });
});

// PATCH /api/customers/:id
exports.updateCustomer = asyncHandler(async (req, res, next) => {
  // Validate mixed payment amounts if payment method is mixed
  if (req.body.paymentMethod === 'mixed') {
    const cashAmount = Number(req.body.cashAmount) || 0;
    const onlineAmount = Number(req.body.onlineAmount) || 0;
    const totalPaid = cashAmount + onlineAmount;

    // Get the menu item price to validate against
    const MenuItem = require('../models/Operations').MenuItem;
    const menuItem = await MenuItem.findById(req.body.menuItemId);
    const totalBill = menuItem?.price || 0;

    if (totalPaid !== totalBill) {
      return next(new AppError(`Cash Amount + Online Amount must equal the total bill amount (${totalBill})`, 400));
    }
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
  const customer = await Customer.findByIdAndUpdate(req.params.id, { isActive: false }, { new: true });
  if (!customer) return next(new AppError('Customer not found.', 404));
  res.status(200).json({ success: true, message: 'Customer removed.' });
});
