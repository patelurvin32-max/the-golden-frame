const WalletTransaction = require('../models/WalletTransaction');
const Customer = require('../models/Customer');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { ROLES } = require('../config/constants');

// GET /api/wallet/transactions?customer=&branch=&page=&limit=&type=&sortBy=&sortOrder=
exports.getWalletTransactions = asyncHandler(async (req, res) => {
  const filter = {};
  
  // Branch filter
  if (req.user.role !== ROLES.SUPER_ADMIN) {
    filter.branch = { $in: req.user.branches };
  }
  if (req.query.branch) filter.branch = req.query.branch;
  
  // Customer filter
  if (req.query.customer) filter.customer = req.query.customer;
  
  // Type filter (credit/debit)
  if (req.query.type) filter.type = req.query.type;
  
  // Search by customer name, phone, or order ID
  if (req.query.search) {
    const searchRegex = new RegExp(req.query.search, 'i');
    filter.$or = [
      { customerName: searchRegex },
      { customerPhone: searchRegex },
      { orderId: searchRegex },
    ];
  }

  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 10;
  const skip = (page - 1) * limit;

  // Sorting
  const sortBy = req.query.sortBy || 'createdAt';
  const sortOrder = req.query.sortOrder === 'asc' ? 1 : -1;
  const sort = { [sortBy]: sortOrder };

  const [transactions, total] = await Promise.all([
    WalletTransaction.find(filter)
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .populate('customer', 'customerId name phone')
      .populate('branch', 'name code')
      .populate('createdBy', 'name')
      .lean(),
    WalletTransaction.countDocuments(filter),
  ]);

  res.status(200).json({
    success: true,
    results: transactions.length,
    total,
    filtered: total,
    page,
    pages: Math.ceil(total / limit),
    limit,
    data: { transactions },
  });
});

// GET /api/wallet/customer/:customerId
exports.getCustomerWalletHistory = asyncHandler(async (req, res, next) => {
  const { customerId } = req.params;
  
  const customer = await Customer.findOne({ customerId, isActive: true })
    .select('customerId name phone walletBalance walletTransactions')
    .lean();
  
  if (!customer) {
    return next(new AppError('Customer not found.', 404));
  }

  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 10;
  const skip = (page - 1) * limit;

  // Get paginated wallet transactions from customer document
  const transactions = customer.walletTransactions
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(skip, skip + limit);

  const total = customer.walletTransactions.length;

  res.status(200).json({
    success: true,
    results: transactions.length,
    total,
    filtered: total,
    page,
    pages: Math.ceil(total / limit),
    limit,
    data: {
      customer: {
        customerId: customer.customerId,
        name: customer.name,
        phone: customer.phone,
        walletBalance: customer.walletBalance,
      },
      transactions,
    },
  });
});

// POST /api/wallet/add-balance
exports.addWalletBalance = asyncHandler(async (req, res, next) => {
  const { customerId, amount, description, paymentMethod } = req.body;
  
  if (!amount || amount <= 0) {
    return next(new AppError('Amount must be greater than 0', 400));
  }

  const customer = await Customer.findOne({ customerId, isActive: true });
  if (!customer) {
    return next(new AppError('Customer not found.', 404));
  }

  const previousBalance = customer.walletBalance;
  customer.walletBalance += amount;
  
  // Add wallet transaction to customer
  customer.walletTransactions.push({
    type: 'credit',
    amount,
    balance: customer.walletBalance,
    paymentMethod,
    description: description || 'Manual balance addition',
    createdBy: req.user._id,
  });
  
  await customer.save();

  // Create separate wallet transaction record
  await WalletTransaction.create({
    customer: customer._id,
    customerName: customer.name,
    customerPhone: customer.phone,
    branch: customer.branch,
    type: 'credit',
    amount,
    balance: customer.walletBalance,
    walletAmountAdded: amount,
    paymentMethod,
    description: description || 'Manual balance addition',
    createdBy: req.user._id,
  });

  res.status(200).json({
    success: true,
    data: {
      customer: {
        customerId: customer.customerId,
        name: customer.name,
        phone: customer.phone,
        walletBalance: customer.walletBalance,
      },
      transaction: customer.walletTransactions[customer.walletTransactions.length - 1],
    },
  });
});

// GET /api/wallet/summary?branch=
exports.getWalletSummary = asyncHandler(async (req, res) => {
  const matchBranch = {};
  if (req.user.role !== ROLES.SUPER_ADMIN) {
    matchBranch.branch = { $in: req.user.branches };
  }
  if (req.query.branch) matchBranch.branch = req.query.branch;

  const [
    totalBalance,
    totalCredits,
    totalDebits,
    transactionCount,
    customerCount,
  ] = await Promise.all([
    Customer.aggregate([
      { $match: { ...matchBranch, isActive: true } },
      { $group: { _id: null, total: { $sum: '$walletBalance' } } },
    ]),
    WalletTransaction.aggregate([
      { $match: { ...matchBranch, type: 'credit' } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]),
    WalletTransaction.aggregate([
      { $match: { ...matchBranch, type: 'debit' } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]),
    WalletTransaction.countDocuments(matchBranch),
    Customer.countDocuments({ ...matchBranch, walletBalance: { $gt: 0 }, isActive: true }),
  ]);

  res.status(200).json({
    success: true,
    data: {
      totalBalance: totalBalance[0]?.total || 0,
      totalCredits: totalCredits[0]?.total || 0,
      totalDebits: totalDebits[0]?.total || 0,
      transactionCount,
      customersWithBalance: customerCount,
    },
  });
});
